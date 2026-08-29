# public/mascot — asset mascot chạy thật

⚠️ Thư mục này **ship ra production** (truy cập được qua URL `/mascot/...`).
Chỉ để asset app thực sự dùng: PNG/SVG/animation của mascot mà người dùng cuối nhìn thấy.

KHÔNG để mockup/ảnh tham chiếu ở đây — thứ đó nằm trong `docs/mascot/references/`.

Theo pattern của `public/brand/`, `public/logos/`.

## ⚠️ Đừng sửa tay — thư mục này được SINH RA

Mọi `mascot_*.png` ở đây (trừ `mascot_head_48.png`) là sản phẩm của
`scripts/build-mascot-assets.mjs` — chạy `npm run build:mascot`. Ảnh gốc tách nền nằm ở
`docs/mascot/references/poses/`.

Sửa tay hoặc thả ảnh mới trực tiếp vào đây sẽ **bị ghi đè** ở lần chạy script kế tiếp, và làm hỏng
việc chuẩn hoá khung (nội dung fit trong 396×396, canh giữa trong canvas 400×400). Thêm dáng mới:
bỏ ảnh gốc vào `docs/mascot/references/poses/` rồi thêm một dòng vào hằng `MAP` của script.

Chi tiết vì sao phải chuẩn hoá khung thay vì resize thẳng: `docs/MASCOT.md` §5.6.1.

`extension/build.mjs` copy nguyên thư mục này sang `extension/dist/mascot/` lúc build — extension
KHÔNG giữ bản sao riêng, nên đổi ảnh ở đây là extension tự ăn theo sau khi build lại.
