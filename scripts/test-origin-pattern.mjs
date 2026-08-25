// Regression test cho matcher origin — PHẢI chạy trong browser thật.
//
// Bug nó gác (bắt được 18/08/2026 khi debug iPad, giữ nguyên cho bản Android):
// new URL("https://*.host/*") trong browser (WebKit/Blink/Gecko) percent-encode
// "*" thành "%2A" nên check startsWith("*.") không bao giờ đúng → isAllowedOrigin
// từ chối lặng lẽ MỌI origin wildcard, bridge nuốt toàn bộ message từ trang
// Zapee. Test Node KHÔNG bắt được (Node giữ nguyên "*") — vì vậy test này bắt
// buộc chạy bằng Chromium qua playwright-core (matcher là JS thuần, kết quả
// đúng cho mọi engine).
//
// Chạy: npm run test:origin
// Cần: npm install (có playwright-core) + một Chromium (tự dò theo thứ tự:
// $PLAYWRIGHT_CHROMIUM → $PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux/chrome
// → chromium/google-chrome trên PATH). Không tìm thấy → SKIP kèm hướng dẫn,
// exit 0 (để npm install thiếu browser không làm đỏ pipeline khác).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES = join(ROOT, "extension");

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(base)) {
    for (const dir of readdirSync(base)) {
      if (!dir.startsWith("chromium")) continue;
      for (const sub of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = join(base, dir, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      const p = execSync(`command -v ${bin}`, { encoding: "utf8" }).trim();
      if (p) return p;
    } catch { /* thử bin kế */ }
  }
  return null;
}

const executablePath = findChromium();
if (!executablePath) {
  console.log("SKIP: không tìm thấy Chromium — cài playwright chromium hoặc đặt PLAYWRIGHT_CHROMIUM=<đường dẫn chrome>.");
  process.exit(0);
}
let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.log("SKIP: thiếu playwright-core — chạy `npm install` trước.");
  process.exit(0);
}
function extract(src, name) {
  const at = src.indexOf(`function ${name}(url, pattern) {`);
  if (at < 0) throw new Error(name + " không thấy");
  let depth = 0; const i = src.indexOf("{", at);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error("unbalanced");
}
const BG = readFileSync(join(RESOURCES, "background.js"), "utf8");
const BR = readFileSync(join(RESOURCES, "bridge-content.js"), "utf8");
const FNS = extract(BG, "matchesManifestOriginPattern") + "\n" + extract(BR, "matchesOriginPattern");

const CASES = [
  // [url, pattern, kỳ vọng]
  ["https://zapee.timdaythay.com", "https://*.timdaythay.com/*", true],
  ["https://zapee.timdaythay.com/don-hang?x=1", "https://*.timdaythay.com/*", true],
  ["https://timdaythay.com", "https://*.timdaythay.com/*", true],           // gốc trần cũng khớp (semantics cũ)
  ["https://agent-server.timdaythay.com", "https://*.timdaythay.com/*", true],
  ["https://zapee.timdaythay.com.evil.com", "https://*.timdaythay.com/*", false], // tấn công suffix
  ["https://eviltimdaythay.com", "https://*.timdaythay.com/*", false],
  ["http://zapee.timdaythay.com", "https://*.timdaythay.com/*", false],     // sai scheme
  ["https://shop.zapee.one", "https://*.zapee.one/*", true],
  ["https://gia-quanh-day.vercel.app", "https://gia-quanh-day.vercel.app/*", true],
  ["https://gia-quanh-day.vercel.app.evil.io", "https://gia-quanh-day.vercel.app/*", false],
  ["http://localhost:3000", "http://localhost:3000/*", true],
  ["http://localhost:3001", "http://localhost:3000/*", false],              // sai port
  ["http://sub.zapee.test", "http://*.zapee.test/*", true],
  ["https://www.bachhoaxanh.com", "<all_urls>", true],
  ["https://any.site", "*://*/*", true],
  ["not a url", "https://*.timdaythay.com/*", false],
];

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  const results = await page.evaluate(([fns, cases]) => {
    const run = new Function(fns + "\nreturn { a: matchesManifestOriginPattern, b: matchesOriginPattern };")();
    return cases.map(([url, pattern, want]) => ({
      url, pattern, want,
      bg: run.a(url, pattern),
      bridge: run.b(url, pattern),
    }));
  }, [FNS, CASES]);

  let bad = 0;
  for (const r of results) {
    const ok = r.bg === r.want && r.bridge === r.want;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${r.pattern}  ←  ${r.url}  (muốn ${r.want}, bg=${r.bg}, bridge=${r.bridge})`);
  }
  assert.equal(bad, 0, `${bad} case sai`);
  console.log(`\n✓ ${results.length} case khớp trên CẢ HAI matcher, chạy trong browser thật`);
} finally {
  await browser.close();
}
