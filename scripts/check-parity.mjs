// Parity check: committed extension/*.js vs a fresh Chrome-extension build.
//
// This repo's source of truth is the committed JS in extension/ (there is no
// src/ tree yet), so the main risk is silent drift from the canonical Chrome
// extension. Run this after every upstream change:
//
//   cd <one-affree>/extension && npm install && npm run build   # produces dist/
//   cd <this repo> && npm run parity -- <one-affree>/extension/dist
//
// It reports three classes of file:
//
//   IDENTICAL   sidepanel.*, page-bridge.js — must match the Chrome build
//               byte-for-byte (sidepanel.* kept only as the reference the
//               overlay is ported from; page-bridge.js ships as-is).
//   PATCHED     content.js, popup.js, popup.html — the Chrome file plus the
//               documented mobile/Android additions in FILE_RULES (each
//               expected hunk is matched by an anchor; any other change fails).
//   PORTED      background.js / session-engine.js / bridge-content.js /
//               page-bridge-main.js are mobile rewrites (origin: the iOS port)
//               and cannot be diffed. Instead we assert the panel render layer
//               ported out of sidepanel.js still carries the markers upstream
//               introduced (see PANEL_MARKERS) so overlay drift surfaces here
//               instead of on a device.
//
// Extra Android gates: assets (icons/ brand/ mascot/) must be byte-identical to
// the Chrome build, no file may reference `window.chrome` (the chrome-shim in
// session-engine.js relies on bare-identifier resolution against the content
// script sandbox global), and `chrome.windows.*` (unsupported on Firefox for
// Android) may appear only in the never-loaded sidepanel.js baseline.
//
// Exit code 0 = in sync, 1 = drift found.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES = join(ROOT, "extension");

// Per-file rules against the Chrome build.
//   patches: []        → the file must match the Chrome build BYTE-FOR-BYTE.
//   patches: [ … ]     → the file must be the Chrome file PLUS exactly these
//                        documented insertions, matched by `anchor`. Anything
//                        else (an extra insertion, a removed or edited upstream
//                        line) fails.
// Add a row here — and a note in PORTING.md — whenever an Android-only change
// to a file that also exists in the Chrome build becomes deliberate.
const FILE_RULES = {
  "sidepanel.js": { patches: [] },
  "sidepanel.html": { patches: [] },
  "page-bridge.js": { patches: [] },
  "content.js": {
    patches: [
      {
        anchor: `cmd: "storage_event"`,
        why: "seed Co.op localStorage → phát lại StorageEvent qua page-bridge-main.js (MAIN world) — patch gốc iOS",
      },
      {
        anchor: "để không rơi xuống case dưới tạo bản postMessage trùng lặp",
        why: "bridge-content.js đã post bản postMessage cho trang — break để không trùng (patch gốc iOS)",
      },
    ],
  },
  // Màn chẩn đoán (gốc iOS) + mắt xích #0 kiểm tra quyền (Android, F2): popup là
  // surface duy nhất người dùng tự đọc được không cần máy tính. Xem PORTING.md.
  "popup.js": {
    patches: [
      { anchor: "màn chẩn đoán (iOS)", why: "khối chẩn đoán: đọc storage.session, tự kết luận mắt xích đứt, nút copy log" },
      { anchor: "Màn chẩn đoán chạy độc lập", why: "gắn màn chẩn đoán vào <body>, độc lập với renderPopup" },
      { anchor: "mắt xích #0: quyền <all_urls> (Android)", why: "F2 — permissions.contains kiểm tra quyền <all_urls> bị thu hồi trên Firefox MV3" },
    ],
  },
  "popup.html": {
    patches: [
      { anchor: "màn chẩn đoán (chỉ có ở bản iOS", why: "CSS cho khối chẩn đoán" },
      { anchor: "ghi đè 220px phía trên", why: "popup rộng hơn (320px) để đọc được chẩn đoán" },
      { anchor: "Android (F3)", why: "Fenix mở popup gần full màn hình — bỏ bề rộng cứng" },
    ],
  },
};

// Markers upstream added to sidepanel.js that the mobile overlay
// (session-engine.js) must carry too. Add a row here whenever a sidepanel
// change is ported.
const PANEL_MARKERS = [
  { marker: "normalizePanelImageUrl", why: "ảnh Drive → host thumbnail lh3" },
  { marker: "panelDisplayImageSrc", why: "ảnh đi qua /api/proxy-img của web app" },
  { marker: "COPY_ICON_MARKUP", why: "nút sao chép dạng icon SVG" },
  { marker: "COPIED_ICON_MARKUP", why: "trạng thái đã-sao-chép (tick)" },
  { marker: "is-copied", why: "class phản hồi của nút sao chép" },
  // Fix gốc iOS, không có ở bản Chrome: host overlay mang pointer-events:none
  // kế thừa xuống shadow tree — thiếu dòng bật lại thì toàn bộ panel chết chạm
  // (bug iPad 18/08: không tắt được panel bằng nút ✕).
  { marker: "pointer-events: auto", why: "bật lại hit-testing trong panel (host là pointer-events:none)" },
  // Sync 18/08 (STV3-9995): logo cửa hàng theo màu chuỗi + nhãn chữ nhỏ.
  { marker: "CHAIN_LOGO", why: "logo cửa hàng màu theo chuỗi (port sidepanel.js)" },
  { marker: "store-logo-text", why: "nhãn chữ trong vòng tròn logo (port sidepanel.html)" },
  // Sync 25/08 (upstream 2a4f94d, 0.1.35): tên thẻ cửa hàng + Email/ZIP + chuỗi aff-*.
  { marker: "storeCardTitle", why: "tên thẻ cửa hàng bỏ nhãn 'Mua online' chung chung (port sidepanel.js 0.1.35)" },
  { marker: "store-branch", why: "chi nhánh thật hiện thành dòng phụ dưới tên cửa hàng (port sidepanel.js 0.1.35)" },
  { marker: "Mã ZIP", why: "phần người nhận thêm Email + Mã ZIP (port sidepanel.js 0.1.35)" },
  { marker: "aff-shopee", why: "nhận diện chuỗi affiliate aff-bhx/aff-alibaba/aff-shopee (port sidepanel.js 0.1.35)" },
];

// Asset folders that must stay byte-identical to the Chrome build.
const ASSET_DIRS = ["icons", "brand", "mascot"];

const distArg = process.argv[2];
let failures = 0;
let notes = 0;

function fail(msg) {
  console.error(`✗ ${msg}`);
  failures++;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}
function note(msg) {
  console.log(`ℹ ${msg}`);
  notes++;
}

function read(path) {
  return readFileSync(path, "utf8");
}

/**
 * Contiguous blocks present in `b` but not in `a` (added by the port).
 * The port only ever ADDS whole blocks, so a two-pointer scan over `b` against
 * `a` is exact: a removal or an edit to an upstream line cannot be explained as
 * an insertion and is reported as a divergence.
 */
function addedHunks(a, b) {
  const A = a.split("\n");
  const B = b.split("\n");
  const hunks = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      i++;
      j++;
      continue;
    }
    // Look ahead in B for the next line matching A[i] (i.e. B inserted a block).
    // Only a non-blank, non-trivial anchor counts as a resync point, otherwise a
    // modified line could "resync" on an unrelated later `}` and hide the edit.
    let resync = -1;
    if (A[i].trim().length > 2) {
      for (let k = j; k < B.length; k++) {
        if (B[k] === A[i]) {
          resync = k;
          break;
        }
      }
    }
    if (resync === -1) return { hunks, diverged: { line: i + 1, expected: A[i], got: B[j] } };
    hunks.push({ atUpstreamLine: i + 1, lines: B.slice(j, resync) });
    j = resync;
  }
  if (i < A.length) return { hunks, diverged: { line: i + 1, expected: A[i], got: "<end of file>" } };
  if (j < B.length) hunks.push({ atUpstreamLine: A.length, lines: B.slice(j) });
  return { hunks, diverged: null };
}

function checkPanelMarkers() {
  const engine = read(join(RESOURCES, "session-engine.js"));
  for (const { marker, why } of PANEL_MARKERS) {
    if (engine.includes(marker)) ok(`session-engine.js carries "${marker}" (${why})`);
    else fail(`session-engine.js is missing "${marker}" (${why}) — panel layer drifted from sidepanel.js`);
  }
}

// The chrome-shim only works because every bundle reference is the bare
// identifier `chrome` (resolved against the sandbox global Firefox gives
// content scripts). A `window.chrome` read would bypass the shim entirely.
function checkGlobalUsage() {
  for (const name of readdirSync(RESOURCES)) {
    if (!name.endsWith(".js")) continue;
    const src = read(join(RESOURCES, name));
    if (src.includes("window.chrome")) {
      fail(`${name} references window.chrome — must use the bare \`chrome\` identifier (chrome-shim contract)`);
    }
    if (name !== "sidepanel.js" && src.includes("chrome.windows.")) {
      fail(`${name} calls chrome.windows.* — unsupported on Firefox for Android (allowed only in the unreferenced sidepanel.js baseline)`);
    }
  }
  ok("global-usage gates OK (no window.chrome; chrome.windows.* only in sidepanel.js)");
}

/**
 * Mọi file (ĐỆ QUY) dưới `root`, trả đường dẫn tương đối theo root.
 *
 * Bản đầu chỉ quét 1 tầng và `continue` khi gặp thư mục con — đúng lúc upstream
 * 0.1.48 thêm `mascot/than-dau/`, `mascot/tieng/` và 20 file `mascot/trang-phuc/*`
 * thì checker vẫn báo "✓ mascot/ identical" trong khi bản Android thiếu 49 file
 * (mascot vỡ ảnh + mất file tiếng). Dương tính giả kiểu đó tệ hơn không kiểm.
 */
function filesUnder(root, prefix = "") {
  const out = [];
  for (const entry of readdirSync(join(root, prefix))) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(join(root, rel)).isDirectory()) out.push(...filesUnder(root, rel));
    else out.push(rel);
  }
  return out;
}

function checkAssets(dist) {
  for (const dir of ASSET_DIRS) {
    const theirs = join(dist, dir);
    const mine = join(RESOURCES, dir);
    if (!existsSync(theirs)) {
      note(`${dir}/: not in the Chrome build, skipped`);
      continue;
    }
    if (!existsSync(mine)) {
      fail(`${dir}/: missing from extension/`);
      continue;
    }
    let same = true;
    const upstreamFiles = filesUnder(theirs);
    for (const rel of upstreamFiles) {
      const a = join(theirs, rel);
      const b = join(mine, rel);
      if (!existsSync(b)) {
        fail(`${dir}/${rel}: MISSING from extension/ (có trong bản Chrome)`);
        same = false;
      } else if (!readFileSync(a).equals(readFileSync(b))) {
        fail(`${dir}/${rel}: differs from the Chrome build`);
        same = false;
      }
    }
    // File thừa bên mobile cũng là drift (asset upstream đã bỏ mà mình còn giữ).
    for (const rel of filesUnder(mine)) {
      if (!existsSync(join(theirs, rel))) {
        note(`${dir}/${rel}: chỉ có ở bản Android (không có trong bản Chrome)`);
      }
    }
    if (same) ok(`${dir}/ identical to the Chrome build (${upstreamFiles.length} file, đệ quy)`);
  }
}

function checkFile(name, rule, dist) {
  const mine = join(RESOURCES, name);
  const theirs = join(dist, name);
  if (!existsSync(theirs)) {
    note(`${name}: not in the Chrome build, skipped`);
    return;
  }
  if (!existsSync(mine)) {
    fail(`${name}: missing from extension/`);
    return;
  }
  const upstream = read(theirs);
  const ours = read(mine);

  // No documented patches → must be byte-identical.
  if (rule.patches.length === 0) {
    if (upstream === ours) ok(`${name} identical to the Chrome build`);
    else fail(`${name} differs from the Chrome build — copy it over (no Android changes expected here)`);
    return;
  }

  if (upstream === ours) {
    fail(`${name} is identical to the Chrome build but ${rule.patches.length} patch(es) are declared — they were lost`);
    return;
  }

  const { hunks, diverged } = addedHunks(upstream, ours);
  if (diverged) {
    fail(
      `${name} diverges from the Chrome build at Chrome line ${diverged.line}:\n` +
        `    Chrome:  ${diverged.expected.trim().slice(0, 120)}\n` +
        `    Android: ${diverged.got.trim().slice(0, 120)}\n` +
        `    ${name} must stay the Chrome file plus the documented insertions only.\n` +
        `    Re-copy it from dist/ and re-apply the patches listed in PORTING.md.`
    );
    return;
  }

  // Every added block must be attributable to a documented patch, and every
  // documented patch must still be there — so neither a lost patch nor an
  // undocumented insertion can slip through.
  const claimed = new Set();
  for (const hunk of hunks) {
    if (!hunk.lines.some((line) => line.trim())) continue; // blank-line shuffle
    // A single hunk can legitimately carry SEVERAL documented patches (adjacent
    // insertions get merged into one hunk), so claim every anchor it contains.
    const matches = rule.patches.filter(({ anchor }) => hunk.lines.some((line) => line.includes(anchor)));
    if (matches.length > 0) {
      for (const match of matches) {
        claimed.add(match.anchor);
        ok(`${name} keeps the patch: ${match.why}`);
      }
    } else {
      fail(
        `${name} has an UNDOCUMENTED insertion at Chrome line ${hunk.atUpstreamLine} ` +
          `(${hunk.lines.length} line(s)):\n` +
          hunk.lines.slice(0, 4).map((l) => `    + ${l.trim().slice(0, 110)}`).join("\n") +
          `\n    Either revert it, or add it to FILE_RULES["${name}"] in this script and document it in PORTING.md.`
      );
    }
  }
  for (const { anchor, why } of rule.patches) {
    if (!claimed.has(anchor)) fail(`${name} lost the patch: ${why} (anchor "${anchor}" not found)`);
  }
}

function checkAgainstDist(dist) {
  for (const [name, rule] of Object.entries(FILE_RULES)) checkFile(name, rule, dist);
  checkAssets(dist);
}

console.log(`Extension: ${RESOURCES}`);
if (!existsSync(RESOURCES)) {
  fail(`extension/ not found`);
} else {
  checkPanelMarkers();
  checkGlobalUsage();
  if (distArg) {
    const dist = resolve(process.cwd(), distArg);
    if (!existsSync(dist)) fail(`Chrome build dir not found: ${dist}`);
    else {
      console.log(`Chrome build: ${dist} (${readdirSync(dist).length} entries)`);
      checkAgainstDist(dist);
    }
  } else {
    note(
      `no Chrome build path given — ran panel-marker + global-usage checks only.\n` +
        `    Full check: npm run parity -- <one-affree>/extension/dist`
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} drift issue(s) found.`);
  process.exit(1);
}
console.log(`\n✓ in sync${notes ? " (with notes above)" : ""}`);
