// Build / validation tooling for the ZapAssist Firefox for Android extension.
//
// Two modes, chosen automatically by whether a TypeScript source tree exists:
//
//   1. No `src/` present (current state): the extension web files committed in
//      `extension/` ARE the source of truth. This script only validates
//      `manifest.json` (parses, Firefox-required keys present, no Chrome-only
//      keys, referenced files exist). `web-ext run` loads `extension/` directly
//      — you do NOT need to run this before loading the add-on.
//
//   2. `src/` present (once the canonical TypeScript source is dropped in): this
//      script bundles each entry point with esbuild (IIFE, no ESM) straight into
//      `extension/`, then runs the same manifest validation.
//
// Usage:
//   node scripts/build.mjs              # build (if src/) + validate
//   node scripts/build.mjs --watch      # rebuild on change (requires src/)
//   node scripts/build.mjs --check-only # validate manifest only
//
// See PORTING.md for the intended `src/` layout and the entry-point map below.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");
const RESOURCES = join(ROOT, "extension");

const args = new Set(process.argv.slice(2));
const WATCH = args.has("--watch");
const CHECK_ONLY = args.has("--check-only");

// Entry-point map used ONLY when src/ exists. Each TS entry compiles to a
// classic (IIFE) script at the given output path inside extension/.
// Keep these output names in sync with manifest.json.
const ENTRY_POINTS = {
  "background/index.ts": "background.js",
  "content/index.ts": "content.js",
  "session-engine/index.ts": "session-engine.js",
  "bridge/index.ts": "bridge-content.js",
  "page-main/index.ts": "page-bridge-main.js",
  "page-bridge/index.ts": "page-bridge.js",
  "popup/index.ts": "popup.js",
  "sidepanel/index.ts": "sidepanel.js",
};

// Compile-time constants (replace the Chrome build's buildAgentServerUrl / etc).
// Override via env when needed, e.g. AGENT_SERVER_URL=... npm run build
const DEFINE = {
  "process.env.AGENT_SERVER_URL": JSON.stringify(
    process.env.AGENT_SERVER_URL ?? "https://agent-server.timdaythay.com"
  ),
  "process.env.ZAPEE_WEB_APP_URL": JSON.stringify(
    process.env.ZAPEE_WEB_APP_URL ?? "https://zapee.timdaythay.com"
  ),
};

// Chrome-only manifest keys Firefox either rejects or silently mis-handles.
// `background.service_worker` is forbidden OUTRIGHT: this repo is Firefox-only,
// its MV3 background is an event page (`background.scripts`) — never dual-key.
const FORBIDDEN_MANIFEST_KEYS = ["key", "side_panel", "externally_connectable"];

// Firefox needs `world: "MAIN"` in content_scripts, which is a manifest-schema
// violation below Firefox 128 (strict parsing) — hence the minimum version.
const MIN_GECKO_VERSION = 128;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function validateManifest() {
  const manifestPath = join(RESOURCES, "manifest.json");
  if (!existsSync(manifestPath)) return fail(`manifest.json not found at ${manifestPath}`);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    return fail(`manifest.json does not parse: ${err.message}`);
  }

  let ok = true;
  const check = (cond, msg) => {
    if (!cond) {
      fail(msg);
      ok = false;
    }
  };

  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    check(!(key in manifest), `manifest.json still contains Chrome-only key "${key}" (unsupported by Firefox)`);
  }
  check(!manifest.background?.service_worker, `manifest.json background must use "scripts" (Firefox MV3 event page), never "service_worker"`);
  check(!manifest.background?.type, `manifest.json background.type must be absent (classic scripts only)`);
  check(!("persistent" in (manifest.background ?? {})), `manifest.json background.persistent must be absent (implied by MV3 event page)`);
  check(!manifest.permissions?.includes?.("sidePanel"), `manifest.json permissions still request "sidePanel" (unsupported by Firefox)`);

  check(Array.isArray(manifest.background?.scripts) && manifest.background.scripts.length > 0,
    `manifest.json background.scripts is required (Firefox MV3 event page)`);

  const gecko = manifest.browser_specific_settings?.gecko;
  check(typeof gecko?.id === "string" && gecko.id.includes("@"),
    `manifest.json browser_specific_settings.gecko.id is required for Firefox MV3 (and permanent after first AMO signing)`);
  const minVer = parseFloat(gecko?.strict_min_version ?? "0");
  check(minVer >= MIN_GECKO_VERSION,
    `manifest.json gecko.strict_min_version must be >= ${MIN_GECKO_VERSION}.0 (content_scripts "world" key is a schema violation below that)`);
  check(!!manifest.browser_specific_settings?.gecko_android,
    `manifest.json browser_specific_settings.gecko_android is required to flag Android support on AMO`);
  check(!("id" in (manifest.browser_specific_settings?.gecko_android ?? {})),
    `manifest.json gecko_android takes no "id" — only strict_min_version`);

  const mainWorldEntries = (manifest.content_scripts ?? []).filter((cs) => cs.world === "MAIN");
  check(mainWorldEntries.length >= 1,
    `manifest.json must keep at least one content_scripts entry with "world": "MAIN" (page-bridge.js / page-bridge-main.js)`);
  const war = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? []);
  check(war.includes("page-bridge-main.js"),
    `manifest.json web_accessible_resources must expose page-bridge-main.js (the <script>-injection fallback path)`);

  // Referenced files must exist inside extension/.
  const refs = new Set();
  for (const s of manifest.background?.scripts ?? []) refs.add(s);
  for (const cs of manifest.content_scripts ?? []) for (const js of cs.js ?? []) refs.add(js);
  if (manifest.action?.default_popup) refs.add(manifest.action.default_popup);
  for (const [, p] of Object.entries(manifest.icons ?? {})) refs.add(p);
  for (const ref of refs) {
    if (!existsSync(join(RESOURCES, ref))) {
      fail(`manifest.json references "${ref}" but ${join("extension", ref)} is missing`);
      ok = false;
    }
  }

  if (ok) console.log(`✓ manifest.json OK (v${manifest.version}, gecko ${gecko.strict_min_version}+, ${refs.size} referenced files present)`);
  return ok;
}

async function bundleFromSrc() {
  const esbuild = await import("esbuild").catch(() => null);
  if (!esbuild) {
    return fail(`src/ exists but esbuild is not installed. Run: npm install`);
  }
  const entryPoints = [];
  for (const [rel, out] of Object.entries(ENTRY_POINTS)) {
    const abs = join(SRC, rel);
    if (existsSync(abs)) entryPoints.push({ in: abs, out: out.replace(/\.js$/, "") });
  }
  if (entryPoints.length === 0) {
    return fail(`src/ exists but no known entry points found (see ENTRY_POINTS in scripts/build.mjs)`);
  }

  const options = {
    entryPoints,
    outdir: RESOURCES,
    bundle: true,
    format: "iife",
    target: ["firefox128"],
    define: DEFINE,
    logLevel: "info",
    legalComments: "none",
  };

  if (WATCH) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("✓ esbuild watching src/ → extension/ (Ctrl+C to stop)");
    return true;
  }
  await esbuild.build(options);
  console.log(`✓ esbuild bundled ${entryPoints.length} entry point(s) → extension/`);
  return true;
}

async function main() {
  const hasSrc = existsSync(SRC);
  console.log(hasSrc ? "Mode: build from src/ (esbuild)" : "Mode: validate committed extension/ (no src/ yet)");

  if (!CHECK_ONLY && hasSrc) {
    await bundleFromSrc();
  } else if (!CHECK_ONLY && WATCH) {
    console.log("ℹ --watch requires a src/ tree; nothing to watch. Edit extension/ directly for now.");
  }

  if (!WATCH) validateManifest();
}

main().catch((err) => fail(err.stack || String(err)));
