# Zap-XuXu — Firefox for Android

> ✅ **Trạng thái hiện tại** — port đầy đủ từ kiến trúc mobile của bản iOS Safari
> (repo `zapeeAsistant_iOS`), baseline bundle Chrome **v0.1.35** (affree
> `hytek_branch` @ `2a4f94d`). Toàn bộ khác biệt nền tảng Firefox (F1–F8), quyết
> định kiến trúc và checklist QA trên thiết bị nằm trong **[PORTING.md](PORTING.md)**.

Tiện ích Firefox for Android (Fenix) giúp trang web Zapee bàn giao đơn hàng
(`zapee_order_handoff`) và hướng dẫn/hỗ trợ người mua hoàn tất đơn ngay trên
website bán lẻ (Co.op Online, BHX, …) trong Firefox trên điện thoại Android.
Extension **không tự động hóa gì một mình** — nó thực thi các bước `dom_op` do
agent-server điều phối qua WebSocket, giống hệt bản Chrome/iOS.

## Yêu cầu

- **Node.js 18+** (tooling: validate manifest, parity, web-ext).
- **Firefox Nightly for Android** trên thiết bị (package `org.mozilla.fenix`).
  `web-ext run --target firefox-android` chỉ sideload được vào bản Nightly —
  bản release (`org.mozilla.firefox`) không nhận extension tạm.
- **adb** (Android platform-tools) + bật **USB debugging** trên điện thoại.
- Firefox ≥ **128** (ESR) — manifest dùng `world: "MAIN"` trong `content_scripts`,
  dưới 128 bị coi là vi phạm schema.

## Build & chạy trên thiết bị Android

```bash
npm install

# Kiểm tra manifest + file tham chiếu (không bắt buộc trước khi chạy)
npm run check

# Cắm điện thoại (USB debugging), tìm serial:
adb devices

# Sideload vào Firefox Nightly trên thiết bị:
npm run start:android -- --android-device <serial>

# Chạy nhanh trên Firefox desktop (kiểm tra logic, không thay được QA Android):
npm run start:desktop
```

`web-ext run` tự mở remote debugging — vào `about:debugging` trên Firefox desktop
→ **Setup** → kết nối thiết bị để xem console/inspector của extension đang chạy
trên điện thoại.

### Bật quyền truy cập trang web trên Fenix (bắt buộc — F2)

MV3 trên Firefox coi host permission `<all_urls>` là quyền **có thể thu hồi**:
nếu chưa cấp, content script lặng lẽ không chạy và extension "như chết".

1. Firefox Android → menu ⋮ → **Extensions** → **Zap-XuXu**.
2. Bật **Access your data for all websites** (Truy cập dữ liệu của bạn trên mọi
   trang web). Với site đang mở: biểu tượng mảnh ghép trên thanh địa chỉ →
   cấp quyền cho site.
3. Mở popup của extension (menu ⋮ → Extensions → Zap-XuXu) → màn chẩn đoán,
   mắt xích **#0 Quyền truy cập trang web** phải xanh.
4. Nếu trang đích nằm trong danh sách "restricted sites" của Mozilla (hiếm):
   bật thêm **Run in restricted sites** trong cài đặt extension.

## Bố cục repo

```
zapAssistant_Android/
├── README.md               # file này
├── PORTING.md              # tài liệu sống: kiến trúc, F1–F8, quyết định, hợp đồng message, QA
├── package.json            # tooling (esbuild/playwright-core/web-ext) — KHÔNG cần cho việc load extension
├── extension/              # ← EXTENSION THẬT, web-ext load thẳng thư mục này
│   ├── manifest.json       #    MV3 Firefox: background.scripts + browser_specific_settings.gecko/gecko_android
│   ├── background.js       #    event page — coordinator stateless (PORTED, gốc iOS)
│   ├── session-engine.js   #    WS engine + panel overlay + chrome-shim trong tab (PORTED, gốc iOS)
│   ├── bridge-content.js   #    cầu postMessage trên các origin Zapee (PORTED, gốc iOS)
│   ├── page-bridge-main.js #    RPC MAIN-world: TekoID, StorageEvent, dispatch event (PORTED, gốc iOS)
│   ├── page-bridge.js      #    click-activation MAIN-world (IDENTICAL, bundle Chrome 0.1.35)
│   ├── content.js          #    bundle Chrome 0.1.35 + 2 patch chèn (PATCHED)
│   ├── popup.html/.js      #    popup Chrome + màn chẩn đoán + delta Android (PATCHED)
│   ├── sidepanel.html/.js  #    KHÔNG được manifest tham chiếu — giữ làm baseline diff khi port panel
│   └── icons/ brand/ mascot/
└── scripts/
    ├── build.mjs           # validate manifest Firefox (+ esbuild khi có src/)
    ├── check-parity.mjs    # chống lệch với bundle Chrome (IDENTICAL/PATCHED/PORTED)
    └── test-origin-pattern.mjs # regression matcher origin — chạy trong Chromium thật
```

## Build tooling

```bash
npm run check        # validate manifest.json + file tham chiếu
npm run parity -- <one-affree>/extension/dist   # chống lệch với bundle Chrome (build dist trước)
npm run test:origin  # 16 case matcher origin wildcard trong browser thật
npm run lint         # web-ext lint (addons-linter) — yêu cầu 0 error
npm run build:xpi    # đóng gói .zip/.xpi vào web-ext-artifacts/ (để ký AMO)
```

## Phân phối (3 tầng)

1. **Dev (hiện tại)** — `npm run start:android` sideload tạm vào Firefox Nightly.
2. **Ký AMO unlisted** — `web-ext sign --channel unlisted` với API key AMO → file
   `.xpi` đã ký, cài từ file trên Firefox Android. Lưu ý: AMO có thể yêu cầu nộp
   source + hướng dẫn build vì `content.js` là bundle esbuild (source TypeScript
   nằm ở repo affree private). **`gecko.id` (`zapee-assistant@zapee.one`) sẽ cố
   định vĩnh viễn sau lần ký đầu tiên** — muốn đổi thì đổi trước khi ký.
3. **AMO listed (production)** — listing công khai trên addons.mozilla.org, chạy
   được trên Firefox Android bản release. Cần review người thật; cân nhắc chính
   sách "remote code" (extension nhận lệnh `dom_op` từ agent-server — xem
   `extension/CHROME-WEB-STORE.md` bên repo affree về vấn đề tương tự với Chrome).

## Dùng với trang Zapee thật (không cần sửa/chạy web)

Extension **tự nhặt đơn** từ trang Zapee production (D5 — `zapee-order-reader.js`
đọc giỏ hàng/hồ sơ/phiên đặt hàng từ storage của trang, tự mint token qua API
công khai của web): cứ mở `https://zapee.timdaythay.com` trên Firefox Nightly,
tạo đơn như bình thường tới màn đặt hàng, rồi mở trang cửa hàng — panel của
extension sẽ hiện trên trang bán lẻ với đúng sản phẩm/người nhận. Kiểm tra
nhanh: popup Zap-XuXu → Chẩn đoán → dòng **"Đơn từ trang Zapee"**.

## Việc còn lại

Xem mục **"Việc còn lại"** và **checklist QA trên thiết bị** trong
[PORTING.md](PORTING.md). Lưu ý D5: reader bám 3 khóa storage nội bộ của web
(`zapee_cbz_state`/`gqd_cart`/`gqd_buyer`) — web đổi cấu trúc thì chạy
`npm run test:reader` và sửa reader theo (PORTING.md mục "Tự nhặt đơn").
