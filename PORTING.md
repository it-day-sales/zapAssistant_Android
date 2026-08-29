# PORTING.md — Chrome → Firefox for Android (Fenix)

Bản port Firefox for Android của extension **Zap-XuXu** (tên cũ: ZapAssist / Zapee Assistant). Chuỗi
port: **Chrome Desktop** (repo `affree`, `extension/`, TypeScript → esbuild) →
**iOS Safari** (repo `zapeeAsistant_iOS` — đã giải các bài toán mobile B1–B7) →
**Firefox Android** (repo này — kế thừa kiến trúc iOS + delta Firefox F1–F8).

**Baseline:** bundle Chrome **v0.1.35** build từ affree `hytek_branch` @
`2a4f94d`; 4 file kiến trúc mobile (PORTED) lấy từ `zapeeAsistant_iOS` @
`056c398` rồi đồng bộ lên 0.1.35 (xem mục Sync log).

## Kiến trúc bản Android (đã hiện thực)

```
   trang Zapee (origin control-surface)                trang bán lẻ (Co.op, BHX, …)
   ┌──────────────────────────────────┐               ┌──────────────────────────────────────┐
   │ window.postMessage «zapee-web»   │               │ session-engine.js (isolated)          │
   │        ↕ bridge-content.js (B1)  │               │  · chrome-shim che runtime cho        │
   └───────────────┬──────────────────┘               │    content.js (giữ nguyên bundle)     │
                   │ chrome.runtime.sendMessage        │  · WebSocket ↔ agent-server (B4)     │
                   ▼                                   │  · panel bottom-sheet shadow-DOM (B2)│
   ┌──────────────────────────────────┐               │ content.js (bundle Chrome + 2 patch) │
   │ background.js — EVENT PAGE (F1)  │◀──────────────│ page-bridge.js (MAIN, click-activate)│
   │ stateless, state = storage.session│               │ page-bridge-main.js (MAIN, RPC — B5) │
   └──────────────────────────────────┘               └──────────────────────────────────────┘
```

Kế thừa nguyên vẹn từ bản iOS (các "B" — xem PORTING.md bên `zapeeAsistant_iOS`):

- **B1** — Firefox **cũng không có** `externally_connectable`/`onMessageExternal`
  → cầu `window.postMessage` (`bridge-content.js`) là đường duy nhất trang Zapee
  nói chuyện với extension. `CONTROL_SURFACE_MATCHES` hardcode trong bridge phải
  khớp `content_scripts[2].matches` của manifest.
- **B2** — Firefox Android **không có sidebar UI** → panel đơn hàng là overlay
  shadow-DOM bottom-sheet trong trang (side-sheet từ `min-width: 768px`),
  render trong `session-engine.js`.
- **B3** — **single-tab handoff**: `zapee_order_handoff` trả
  `{ok:true, claimedTabId:null, tabOwner:"page-navigation", entryUrl}`, trang tự
  `location.href = entryUrl`. Xem Quyết định D3.
- **B4** — WebSocket nằm trong content script (scope theo vòng đời trang), không
  nằm trong background → không phụ thuộc vòng đời event page.
- **B5** — RPC MAIN-world (`page-bridge-main.js`): tự phát hiện thế giới đang
  chạy (isolated có `browser.runtime.id` → thoát; MAIN world của Firefox không
  có `browser`/`chrome` → chạy), kèm đường dự phòng inject `<script>` qua
  `web_accessible_resources`.
- **B7** — các fix WebKit (clipboard `execCommand` fallback, synthetic
  click/fill, StorageEvent phát lại từ MAIN world) vô hại trên Gecko, giữ nguyên.

## Delta Firefox (F1–F8)

- **F1 — manifest**: `background: { scripts: ["background.js"] }` (event page —
  Firefox MV3 **không có** service worker background; không dual-key, không
  `persistent`); thêm `browser_specific_settings.gecko` (`id:
  "zapee-assistant@zapee.one"` — bắt buộc với MV3, **vĩnh viễn sau lần ký AMO
  đầu**; `strict_min_version: "128.0"`) + `gecko_android` (đánh dấu hỗ trợ
  Android trên AMO; không có field `id`). Min 128 vì `world: "MAIN"` trong
  `content_scripts` là vi phạm schema với Firefox < 128 (parse strict) — 128
  cũng là ESR.
- **F2 — host permission là quyền thu hồi được**: MV3 Firefox cho user tắt
  `<all_urls>` (Fenix có cả per-site). Chưa cấp → content script **lặng lẽ không
  chạy**. Màn chẩn đoán thêm mắt xích **#0**: `chrome.permissions.contains(
  {origins:["<all_urls>"]})`. Kèm khả năng site nằm trong "quarantined domains"
  của Mozilla (extension chưa Recommended bị chặn) → bật "Run in restricted
  sites".
- **F3 — popup Fenix mở gần full màn hình**: thêm rule CSS chèn-thuần sau rule
  320px của iOS: `body { width: auto; max-width: 100%; min-width: 0; }`.
- **F4 — vòng đời event page**: background vốn stateless (di sản B4), mọi state
  trong `chrome.storage.session` (Firefox 115+; sống qua suspend, mất khi
  restart trình duyệt / OS kill process — cùng lớp ngữ nghĩa iOS đã chấp nhận).
  Listener đăng ký đồng bộ ở top-level → message từ content/popup đánh thức
  event page. Fetch token không có AbortController — chấp nhận (retry 4001 hấp
  thụ), sẽ vá ở lần sync chung với upstream.
- **F5 — `world: "MAIN"`**: chạy chính thức từ Firefox 128 (manifest lẫn
  `scripting.executeScript`). Giữ self-detect + fallback inject của iOS làm
  lưới an toàn (CSP trang có thể chặn fallback — chấp nhận như Safari < 17).
- **F6 — CSS**: `backdrop-filter` đã có bản không prefix; `-webkit-overflow-
  scrolling`/`::-webkit-scrollbar` là no-op thẩm mỹ trên Gecko — chấp nhận.
- **F7 — giữ nguyên namespace `chrome.*`**, không polyfill, không viết lại sang
  `browser.*`: Firefox hỗ trợ namespace `chrome` với **cả hai** style mà bundle
  dùng — callback (content/bridge/engine) lẫn promise/`await` khi bỏ callback
  (`await chrome.storage.session.*`, `await chrome.tabs.sendMessage` trong
  background/popup). Content script **không đụng** `storage.session` trực tiếp
  (chỉ background + popup — đều là trusted context) → **không cần**
  `storage.session.setAccessLevel`.
- **F8 — tooling**: Xcode/XcodeGen của iOS thay bằng `web-ext`. Dev loop:
  `npm run start:android -- --android-device <serial>` (cần **Firefox Nightly**
  — package `org.mozilla.fenix`; bản release không nhận sideload). Validator
  manifest trong `scripts/build.mjs` đảo luật: CẤM `key`/`side_panel`/
  `externally_connectable`/`background.service_worker`/`background.type`; BẮT
  BUỘC `background.scripts`, `gecko.id`, `strict_min_version ≥ 128`,
  `gecko_android`, giữ entry `world:"MAIN"`, `page-bridge-main.js` trong
  `web_accessible_resources`. esbuild (khi có `src/`) target `firefox128`.

### Từng file

- `manifest.json` — **VIẾT RIÊNG** cho Firefox (file duy nhất không nằm trong
  parity; `scripts/build.mjs` gác luật). 4 entry content_scripts theo thứ tự:
  `page-bridge.js` (MAIN) → `session-engine.js, content.js` (isolated — engine
  cài shim TRƯỚC khi content.js đọc `chrome.runtime`; Firefox chạy các content
  script cùng extension trong **một sandbox chung**, đúng thứ tự manifest) →
  `bridge-content.js` (7 origin Zapee) → `page-bridge-main.js` (MAIN, cuối).
- `background.js` — PORTED (gốc iOS, sync 0.1.35): coordinator stateless; đổi
  `prepare_unsupported_ios` → `prepare_unsupported_android`; thêm handler
  `zapee_page_click` (click MAIN-world xuyên frame qua `chrome.scripting`) và
  `zapee_patch_order_payload` (vá `accountMode` vào handoff) từ upstream 0.1.35.
- `session-engine.js` — PORTED (gốc iOS, sync 0.1.35): shim + WS + panel; lớp
  panel đã port các thay đổi `sidepanel.js` 0.1.29 → 0.1.35 (xem Sync log).
- `bridge-content.js`, `page-bridge-main.js` — PORTED, giữ nguyên từ iOS.
- `page-bridge.js` — IDENTICAL với bundle Chrome 0.1.35 (file mới của upstream:
  click-activation MAIN-world cho executor; khác vai trò với `page-bridge-main.js`).
- `content.js` — PATCHED: bundle Chrome 0.1.35 + đúng 2 patch chèn-thuần của iOS
  (phát lại StorageEvent qua MAIN world; break chống postMessage trùng khi
  bridge đã post).
- `popup.js` / `popup.html` — PATCHED: bundle Chrome + màn chẩn đoán (iOS) + mắt
  xích #0 kiểm tra quyền (Android, F2) + nới rộng popup (F3).
- `sidepanel.js` / `sidepanel.html` — IDENTICAL, **không được manifest tham
  chiếu** — giữ làm baseline để diff khi port panel. Lưu ý: `sidepanel.js` chứa
  `chrome.windows.getCurrent` (không có trên Android) — vô hại vì file không
  bao giờ được nạp; `web-ext lint` có thể cảnh báo, đã ghi nhận.

### Khác biệt hành vi so với bản Chrome (chấp nhận trên Android)

Giữ nguyên 4 khác biệt của bản iOS (single-tab; WS theo vòng đời trang; phiên bị
thay thế chỉ đóng WS khi tab điều hướng; `zapee_progress_event` best-effort) —
xem PORTING.md bên iOS. Thêm cho Android:

- Popup nằm sau menu ⋮ → Extensions (Fenix không có icon toolbar mặc định).
- Android có thể hiện "Open in app" khi trang tự điều hướng sang domain bán lẻ
  có app — user bấm nhầm là văng khỏi Firefox giữa luồng (ghi nhận ở QA).
- Sự kiện `zapee:order-completed`/`continue-next-store` vẫn giao khi trang Zapee
  nạp lại (hàng đợi + drain trên `pageshow` — bfcache Fenix khá hung hãn, đã có
  nhánh `event.persisted`).

## Đồng bộ khi bản Chrome cập nhật (`npm run parity`)

```bash
# 1. build bản Chrome để có dist/
cd <one-affree>/extension && npm install && npm run build

# 2. đối chiếu
cd <repo này> && npm run parity -- <one-affree>/extension/dist
```

| Nhóm | File | Luật |
|---|---|---|
| IDENTICAL | `sidepanel.js`, `sidepanel.html`, `page-bridge.js` | byte-for-byte với dist Chrome |
| PATCHED | `content.js`, `popup.js`, `popup.html` | dist Chrome **+ đúng các patch chèn-thuần** khai trong `FILE_RULES` (mất patch, chèn lậu, sửa/xóa dòng upstream đều fail) |
| PORTED | `background.js`, `session-engine.js`, `bridge-content.js`, `page-bridge-main.js` | không diff được — gác bằng `PANEL_MARKERS` (marker upstream đưa vào `sidepanel.js` mà overlay phải mang theo) + grep-gate (`window.chrome` cấm tuyệt đối; `chrome.windows.` chỉ được có trong `sidepanel.js`) |

Bất biến: patch vào file PATCHED phải **chèn-thuần** (không sửa dòng upstream —
ví dụ nới popup bằng rule CSS thêm phía sau chứ không sửa `220px`/`320px` gốc).
Thêm patch mới = thêm row `FILE_RULES` **và** ghi chú vào file này, nếu không
parity báo "UNDOCUMENTED insertion".

### Lớp panel: mỗi thay đổi `sidepanel.js` phải port sang `session-engine.js`

Thủ tục 4 bước giữ nguyên như iOS: (1) diff `sidepanel.js`/`sidepanel.html` cũ
↔ mới trong dist; (2) port từng hunk vào lớp panel của `session-engine.js`;
(3) thêm marker nhận diện vào `PANEL_MARKERS`; (4) chạy `npm run parity`.

## Màn chẩn đoán (debug ngay trên điện thoại)

Kế thừa nguyên khối chẩn đoán của iOS (background là **người ghi duy nhất**;
`zapeeDiagLog` vòng đệm 140 dòng trong `storage.session`; `diagSafe()` che
`token|otp|password|secret|authorization|cookie|card|cvv` → `«đã ẩn»`, cắt chuỗi
300 ký tự). Trên Android còn thêm đường debug thứ hai: `about:debugging` qua USB
(web-ext mở sẵn) — nhưng màn chẩn đoán vẫn là surface duy nhất không cần máy tính.

Chuỗi nhân-quả (dừng ở mắt xích đứt đầu tiên) — **thêm mắt xích #0 cho Android**:

| # | Mắt xích | Nếu đứt thì kết luận là |
|---|---|---|
| 0 | quyền `<all_urls>` (`permissions.contains`) | **user chưa cấp/đã thu hồi quyền truy cập trang web** (F2) — bật trong Extensions → Zap-XuXu |
| 1 | `chrome.storage.session` dùng được | cần Firefox 115+ (manifest đã khoá 128+) |
| 2 | `sessionEngine` heartbeat | content script chưa hề chạy → gần như chắc chắn mắt xích #0, hoặc site bị quarantine |
| 3 | `shimInstalled` | shim messaging không cài được → content.js không nói được với background |
| 4 | `contentReady` | background chưa nhận `zapee_content_ready` → content.js chưa nạp, hoặc shim không chuyển tiếp |
| 5 | `supportCheck` | launcher không hiện vì check-support thất bại (timeout 2s/HTTP/mạng) |
| 6 | `engineBoot` | `action:"none"` → không có handoff khớp host, overlay im lặng là đúng |
| 7 | `mainWorld` | MAIN world vào trực tiếp / phải inject `<script>` / bị CSP chặn |
| 8 | `ws` | WebSocket `open`/`closed code=…`/`error` — **chú ý Android**: nếu fail ngay handshake, nghi agent-server validate header `Origin` (content script Gecko gửi Origin khác WebKit) → báo team server |

## Quyết định kiến trúc

- **D1 — giữ `chrome.*`, không polyfill**: Firefox hỗ trợ native cả callback lẫn
  promise-style trên namespace `chrome` — đổi sang `browser.*` sẽ phá bất biến
  "content.js = bundle Chrome nguyên bản + patch chèn" mà toàn bộ mô hình parity
  dựa vào.
- **D2 — baseline upstream mới nhất**: bundle lấy từ affree `2a4f94d` (0.1.35)
  theo yêu cầu; 4 file PORTED lấy từ iOS `056c398` (kiến trúc đã QA trên iPad
  thật 18/08) rồi sync lên 0.1.35 trong repo này. iOS hiện vẫn ở 0.1.29 — lần
  sync tới của iOS có thể tham khảo mục Sync log ở đây (việc trùng nhau).
- **D3 — giữ single-tab handoff dù Fenix có `tabs.create`**: giữ MỘT code path
  cho mọi bản mobile để web app không phân nhánh hành vi (đúng quyết định đã
  chốt bên iOS). `zapee_prepare_retailer_tab` trả
  `{ok:false, error:"prepare_unsupported_android"}` — chuỗi chỉ để chẩn đoán,
  trang phải coi **mọi** `!ok` là "không có prepared tab" (đừng feature-detect
  theo đúng chuỗi `_ios`/`_android`; sẽ thống nhất chuỗi trung tính
  `prepare_unsupported` cho cả ba bản ở lần sync chung, breaking change hai bên).
- **D4 — `sidepanel.*` giữ lại không tham chiếu** làm baseline diff (như iOS).

## Hợp đồng message (bridge ↔ trang web — cho team web app)

Giữ **nguyên vẹn** hợp đồng §8 của bản iOS (`zapeeAsistant_iOS/PORTING.md`) —
cùng envelope `{source:"zapee-web", requestId, payload}` ↔
`{source:"zapee-extension", requestId, response}`, cùng 5 type
(`zapee_ping` → `zapee_pong`, `zapee_open_sidepanel_now`,
`zapee_prepare_retailer_tab`, `zapee_cancel_prepared_retailer_tab`,
`zapee_order_handoff`), cùng hành vi single-tab. Khác duy nhất:

- `zapee_prepare_retailer_tab` trả `error:"prepare_unsupported_android"`
  (xem D3 — trang nên xử lý theo `!ok`, không theo chuỗi).

⚠️ **Web app affree HIỆN CHƯA CÓ phía gửi này** — `lib/order-agent/
extension-handoff.ts` chỉ dùng `window.chrome.runtime.sendMessage(EXT_ID, …)`
(không tồn tại trên Firefox lẫn Safari). Extension test được đầy đủ qua
postMessage tay (xem QA #3). Khi chạy thử end-to-end xác nhận cần, bước kế là
viết bridge client dùng chung iOS + Firefox trong affree theo hợp đồng trên.

## Sync log

### Sync upstream 28/08 (hytek_branch `53fe94d`, 0.1.35 → 0.1.45 "Zap-XuXu") — 29/08/2026

- Đổi tên hiển thị `ZapAssist` → **`Zap-XuXu`** + bộ icon/brand mới (manifest,
  icons/, brand/ theo upstream). Bundle build lại từ `53fe94d`:
  `content.js` (+media-popup.ts, preventDefaultNavigation cho dom_op click,
  mascot 10 trạng thái — mascot/ có thêm alert/delivery/thinking/writing +
  thư mục `trang-phuc/`), `page-bridge.js`, re-áp đúng 2 patch chèn-thuần
  (context còn nguyên). `sidepanel.*` KHÔNG đổi → panel không phải port gì.
- `background.js`: handler `zapee_page_click` nhận `preventDefaultNavigation`
  (chặn điều hướng mặc định của anchor/form trong lúc click MAIN-world, không
  stopPropagation); thêm `alibaba` vào fallback check-support.
- `session-engine.js` port 2 fix upstream: (1) `onRuntimeConfig` MERGE thay vì
  ghi đè — recipe cấu hình reader độc lập ở các checkpoint khác nhau, replay
  sau document load phải còn reader cũ; (2) WS đóng sạch (1000/1005/null)
  KHÔNG gửi `zapee_engine_session_ended` nữa — đóng sạch không phải bằng chứng
  đơn kết thúc (OAuth/điều hướng sau đăng ký), giữ activeOrderHandoff để
  reconnect ở URL hỗ trợ kế tiếp.
- **Hunk upstream SKIP có chủ đích** (cùng nhóm multi-tab desktop đã skip ở
  sync trước): `findSessionOwningTab`/`adoptRetailerSuccessorTab`/
  `findSupportedOpenTab`/`ownerTabIsOpen` + listener `chrome.tabs.onReplaced`
  (Firefox không phát sự kiện này; mô hình mobile: tab kế vị tự claim/resume
  qua `zapee_engine_boot`); `navigationDocumentIsReady`/`executeNavigateInTab`;
  `observationOnly ||=` → `=` (entry engine tạo lại theo trang, không tái claim).

### Baseline khởi tạo (25/08/2026)

- Bundle Chrome: affree `hytek_branch` @ `2a4f94d`, manifest `ZapAssist` 0.1.35,
  build `npm run build` (esbuild, URL production mặc định).
- Kiến trúc mobile: `zapeeAsistant_iOS` @ `056c398` (đã QA iPad thật 18/08,
  baseline Chrome khi đó là `c5aa8dc`/0.1.29).
- Đồng bộ 0.1.29 → 0.1.35 vào file PORTED (diff `c5aa8dc..2a4f94d`):
  - `background.js`: + handler `zapee_page_click` (PAGE_CLICK_MESSAGE — click
    MAIN-world xuyên frame bằng `chrome.scripting.executeScript`, cần vì
    `content.js` 0.1.35 gửi message này khi click cùng frame không ăn);
    + handler `zapee_patch_order_payload` (user đổi login↔register giữa luồng —
    vá `accountMode` vào handoff đang lưu trong `storage.session`).
  - `session-engine.js`: shim thêm route `zapee_patch_order_payload` — vá
    `accountMode` vào payload IN-MEMORY của engine (retry 4001 gửi lại
    run_order bằng payload hiện tại) RỒI vẫn forward xuống background; port
    thay đổi panel `sidepanel/index.ts` +66 / `sidepanel.html` +3: nhãn chuỗi
    aff-bhx/aff-alibaba/aff-shopee, tên thẻ cửa hàng bỏ nhãn "Mua online"
    (`storeCardTitle` + dòng phụ `.store-branch`), phần người nhận thêm Email +
    Mã ZIP (chi tiết marker trong `PANEL_MARKERS`).
  - **Hunk upstream SKIP có chủ đích** (ghi để lần sync sau khỏi tìm lại):
    `migrateSessionExecutorToTab` (di trú executor sang child-tab qua
    `openerTabId` — mô hình mobile: engine sống trong chính trang, tab mới tự
    claim/resume qua `zapee_engine_boot`); `executeNavigateInTab` (background
    điều hướng hộ — engine mobile navigate trong trang); `parkCompletedSession`/
    `noopConnection` (đóng băng session sau completed cho Side Panel desktop —
    panel overlay sống trong trang, không cần); toàn bộ choreography
    `sidePanel.open`/gesture; `tabOpenPolicy` đi xuyên qua handoff verbatim,
    không cần code.

## Checklist QA trên thiết bị (Firefox Nightly Android + adb)

0. Cài **Firefox Nightly** (`org.mozilla.fenix`), bật USB debugging →
   `npm run start:android -- --android-device <serial>`.
1. **F2 trước tiên**: menu ⋮ → Extensions → Zap-XuXu → bật *Access your data
   for all websites* → mở popup: mắt xích **#0 xanh**. Site đích không bị
   restricted/quarantine.
2. **Shim**: mở một trang bán lẻ → popup chẩn đoán có heartbeat `sessionEngine`
   với **`shimInstalled: true`** và `contentReady` (chứng minh shim + forward +
   event page wake + promise-storage chạy trên Gecko). Đây là mục PHẢI kiểm tra
   đầu tiên trước mọi mục sau.
3. **Bridge**: mở trang thuộc origin control-surface (vd `zapee.timdaythay.com`)
   → từ console remote-debugging chạy:
   `window.postMessage({source:"zapee-web",requestId:"t1",payload:{type:"zapee_ping"}}, location.origin)`
   → nhận `{source:"zapee-extension", requestId:"t1", response:{type:"zapee_pong"}}`.
   Gửi tiếp một `zapee_order_handoff` giả → response
   `{ok:true, claimedTabId:null, tabOwner:"page-navigation", entryUrl}` →
   tự `location.href = entryUrl`.
4. **Engine + WS**: trang bán lẻ claim handoff (`zapee_engine_boot` →
   `claim`), panel bottom-sheet hiện; xoay ngang/máy tablet → side-sheet; panel
   không đè lên URL bar thu gọn của Fenix; **WS mở được** (mắt xích #8 —
   nếu fail handshake xem ghi chú Origin); `dom_op` chạy; reload giữa chừng →
   resume; back rồi forward (bfcache) → sự kiện vẫn drain.
5. **MAIN world**: `authenticated_request` (TekoID) chạy; chẩn đoán mắt xích #7
   ghi "MAIN trực tiếp" (không phải fallback inject) — chứng minh
   `world:"MAIN"` manifest hoạt động trên Fx 128+.
6. **Click xuyên frame** (mới 0.1.35): bước nào executor phải nhờ
   `zapee_page_click` → click ăn (background `scripting.executeScript` MAIN).
7. **Đường về**: hoàn tất đơn → quay lại trang Zapee → `zapee:order-completed` /
   `zapee:continue-next-store` drain khi trang nạp.
8. **Vòng đời**: bỏ máy >30s giữa phiên (panel mở) → thao tác tiếp vẫn chạy
   (event page wake); swipe-kill Firefox → mở lại → `storage.session` sạch,
   extension về idle gọn, không kẹt handoff cũ.
9. **Popup**: full-width đọc được (F3), nút "Kiểm tra kết nối" + "Copy log"
   chạy; để ý Android "Open in app" cướp navigation → ghi nhận nếu gặp.

## Bố cục `src/` dự kiến (khi đưa TypeScript gốc vào)

Giữ đúng map `ENTRY_POINTS` trong `scripts/build.mjs`:
`src/background/`, `src/content/`, `src/session-engine/`, `src/bridge/`,
`src/page-main/`, `src/page-bridge/`, `src/popup/`, `src/sidepanel/` — mỗi thư
mục một `index.ts`, esbuild IIFE target `firefox128` xuất thẳng vào `extension/`.

## Baseline `web-ext lint` (25/08/2026 — yêu cầu giữ 0 error)

`npm run lint`: **0 error / 25 warning / 1 notice**.

- 25 × `UNSAFE_VAR_ASSIGNMENT` (innerHTML với giá trị động) trong
  `session-engine.js`, `content.js`, `sidepanel.js` — kế thừa nguyên từ bundle
  Chrome/iOS (cùng pattern upstream đang ship); nội dung đều do extension tự
  sinh, không phải input trang. Chấp nhận; giảm dần khi upstream refactor.
- 1 × notice `MISSING_DATA_COLLECTION_PERMISSIONS` —
  `browser_specific_settings.gecko.data_collection_permissions` là thuộc tính
  AMO yêu cầu cho submission mới: PHẢI khai trước khi ký AMO (extension gửi
  thông tin người nhận/giỏ hàng tới agent-server → thuộc nhóm khai báo thu
  thập dữ liệu, đối chiếu `extension/CHROME-WEB-STORE.md` bên affree).

## Việc còn lại

1. QA trên thiết bị thật theo checklist trên (chưa chạy — repo này dựng trong
   môi trường không có Firefox/Android).
2. Web app: bridge client postMessage dùng chung iOS + Firefox (hợp đồng §8) —
   làm khi chạy thử end-to-end xác nhận cần.
3. Ký AMO unlisted (`web-ext sign --channel unlisted`, cần API key AMO): khai
   `gecko.data_collection_permissions` (xem baseline lint ở trên) + chuẩn bị
   source-submission cho bundle esbuild. Sau đó cân nhắc AMO listed.
4. Lần sync chung với upstream + iOS: chuỗi `prepare_unsupported` trung tính,
   AbortController cho fetch token, hợp nhất cách reconcile `page-bridge.js`
   (upstream) ↔ `page-bridge-main.js` (mobile).
