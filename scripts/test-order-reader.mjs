// Test fixture cho zapee-order-reader.js — phần DỰNG ĐƠN thuần (không DOM/chrome).
//
// Trích các hàm pure từ file built-output bằng brace-matching (như
// test-origin-pattern.mjs) rồi chạy fixture mô phỏng đúng shape storage của web
// (hytek 53fe94d): sessionStorage zapee_cbz_state (CbzPersisted), localStorage
// gqd_cart (CartItem[]), gqd_buyer (BuyerProfile). Web đổi shape thì sửa
// fixture + reader CÙNG NHAU và ghi vào PORTING.md (D5).
//
// Chạy: npm run test:reader
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "extension", "zapee-order-reader.js"), "utf8");

function extractFn(name) {
  const at = SRC.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name} không thấy trong zapee-order-reader.js`);
  let depth = 0;
  const open = SRC.indexOf("{", at);
  for (let j = open; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error(`${name}: ngoặc không cân`);
}

function extractVar(name) {
  const at = SRC.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`${name} không thấy`);
  const open = at + `var ${name} = `.length;
  const openChar = SRC[open];
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  for (let j = open; j < SRC.length; j++) {
    if (SRC[j] === openChar) depth++;
    else if (SRC[j] === closeChar && --depth === 0) return SRC.slice(at, j + 2);
  }
  throw new Error(`${name}: ngoặc không cân`);
}

const CODE = [
  extractVar("CHAIN_ENTRY"),
  extractVar("CHAIN_LABEL"),
  extractVar("HOST_CHAIN"),
  ...["executionChain", "chainOfCartItem", "chainFromUrl", "lineFromOrderKey", "cartGroupKey", "groupCart", "normName", "matchGroup", "productOf", "buildScrapedOrder", "buildPayload"].map(extractFn),
  "return { buildScrapedOrder, buildPayload, executionChain };",
].join("\n");
const { buildScrapedOrder, buildPayload, executionChain } = new Function(CODE)();

// ------------------------------------------------------------------ fixtures
const offer = (chain, id, name, productUrl, extra = {}) => ({
  productUrl,
  store: { chain, id, name, ...extra },
});
const cart = [
  { product: { name: "Nước mắm Nam Ngư 750ml", image: "https://img/nm.jpg" }, offer: offer("coop", "COOP_00019", "Co.opmart Nhiêu Lộc", "https://cooponline.vn/san-pham/nuoc-mam-nam-ngu", { terminalCode: "T123" }), qty: 2 },
  { product: { name: "Dầu ăn Tường An 1L" }, offer: offer("coop", "COOP_00019", "Co.opmart Nhiêu Lộc", "https://cooponline.vn/san-pham/dau-an-tuong-an", { terminalCode: "T123" }), qty: 1 },
  { product: { name: "Sữa tươi Vinamilk 180ml lốc 4" }, offer: offer("aff-bhx", "BHX_00777", "BHX 223 Nguyễn Trọng Tuyến", "https://www.bachhoaxanh.com/sua-vnm"), qty: 3 },
  { product: { name: "Món không hỗ trợ" }, offer: offer("lotte", "LOTTE_1", "Lotte", "https://lotte.vn/x"), qty: 1 },
];
const cbz = {
  orderKey: "legacy::coop:T123|sig1__BHX_00777|sig2__LOTTE_1|sig3",
  step: "session",
  active: 0,
  defaultMode: "zapee",
  status: ["idle", "idle", "idle"],
  carts: [
    [{ name: "Nước mắm Nam Ngư 750ml", qty: 2, unitPrice: 45000, image: "https://img/nm.jpg" }, { name: "Dầu ăn Tường An 1L", qty: 1, unitPrice: 52000 }],
    [{ name: "Sữa tươi Vinamilk 180ml lốc 4", qty: 3, unitPrice: 30000 }],
    [{ name: "Món không hỗ trợ", qty: 1, unitPrice: 10000 }],
  ],
  pays: ["qr", "cod", "cod"],
  slots: { 1: "bhx-pickup:sáng 8-9h" },
};
const buyer = { name: "Nguyễn Văn A", email: "a@example.com", phone: "0900000000", address: "1 Lê Lợi, Q1, TP.HCM", zip: "700000" };

let pass = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  pass++;
  console.log(`✓ ${label}`);
};

// 1. Chuẩn hóa chuỗi thi hành
ok(executionChain("aff-bhx") === "bhx" && executionChain("cop") === "coop" && executionChain("COOP_00019") === "coop" && executionChain("lotte") === "", "executionChain: aff-*/alias/id-prefix về đúng chuỗi, lạ → rỗng");

// 2. Dựng đơn từ 3 storage
const order = buildScrapedOrder(cbz, cart, buyer);
ok(order && order.stores.length === 2, "buildScrapedOrder: 2 cửa hàng hỗ trợ (coop, bhx) — bỏ chuỗi lạ");
ok(order.stores[0].chain === "coop" && order.stores[1].chain === "bhx", "thứ tự + chain khớp phiên");
ok(order.stores[0].products[0].url === "https://cooponline.vn/san-pham/nuoc-mam-nam-ngu", "dòng hàng được bơm lại URL từ giỏ (khớp tên)");
ok(order.stores[0].total === 45000 * 2 + 52000, "tổng tiền theo qty × unitPrice của phiên");
ok(order.stores[1].slot === "bhx-pickup:sáng 8-9h", "slot BHX đọc từ cbz.slots theo index");

// 3. Payload cho từng cửa hàng
const coopPayload = buildPayload(order, order.stores[0]);
ok(coopPayload.paymentMethod === "qr" && coopPayload.chain === "coop", "paymentMethod lấy từ pays[i]");
ok(coopPayload.allowBlockingPresentation === false, "coop không cho blocking presentation (luật web)");
ok(coopPayload.liveCartScope === "selected", "liveCartScope coop = selected");
ok(coopPayload.requestedProducts.length === 2 && coopPayload.requestedProducts === coopPayload.products, "requestedProducts = danh tính đơn bất biến");
ok(coopPayload.shippingAddress.fullAddress === buyer.address && coopPayload.buyerPhone === buyer.phone, "địa chỉ/SĐT người mua vào payload (nguồn cho enrich terminal Co.op)");
ok(coopPayload.nextStoreName === "Bách Hóa Xanh" && typeof coopPayload.nextStoreEntryUrl === "string", "nextStore trỏ cửa hàng chưa đặt kế tiếp");
ok(coopPayload.automationMode === "manual", "đơn nhặt từ storage chạy chế độ hướng dẫn (manual)");

// 4. Cửa hàng đã đặt bị loại khỏi drafts (reader lọc placed trước khi gửi)
const placedCbz = { ...cbz, status: ["placed", "idle", "idle"] };
const order2 = buildScrapedOrder(placedCbz, cart, buyer);
ok(order2.stores.find((s) => s.chain === "coop").placed === true, "status placed được đánh dấu để lọc");

// 5. Thiếu dữ liệu → null, không ném
ok(buildScrapedOrder(null, cart, buyer) === null && buildScrapedOrder({}, cart, buyer) === null, "storage thiếu/hỏng → null êm");

// 6. ĐƠN "MUA NGAY" BHX — không đi qua giỏ hàng (gqd_cart trống/không liên quan).
// orderKey đúng format persistOrderKey của web: `<orderCode>::<key>::<url|name|qty|price|v1|v2>::<streamSig>`
// → reader phải nhận diện chuỗi + URL trực tiếp từ orderKey (bug BHX 29/08).
const buyNowCbz = {
  orderKey: "legacy::BHX_00777::https://www.bachhoaxanh.com/sua-tuoi/sua-vnm-180ml|Sữa tươi Vinamilk 180ml lốc 4|3|30000||::",
  step: "session",
  active: 0,
  defaultMode: "zapee",
  status: ["idle"],
  carts: [[{ name: "Sữa tươi Vinamilk 180ml lốc 4", qty: 3, unitPrice: 30000 }]],
  pays: ["cod"],
};
const buyNow = buildScrapedOrder(buyNowCbz, [], buyer);
ok(buyNow && buyNow.stores.length === 1 && buyNow.stores[0].chain === "bhx", "Mua ngay BHX (giỏ trống): chain nhận từ URL trong orderKey");
ok(buyNow.stores[0].products[0].url === "https://www.bachhoaxanh.com/sua-tuoi/sua-vnm-180ml", "URL sản phẩm lấy thẳng từ orderKey, không cần giỏ");

// 7. User sửa QTY giữa phiên (orderKey giữ qty gốc) → anchor lùi xuống khớp theo tên, vẫn ra chuỗi + URL
const editedCbz = { ...buyNowCbz, carts: [[{ name: "Sữa tươi Vinamilk 180ml lốc 4", qty: 5, unitPrice: 30000 }]] };
const edited = buildScrapedOrder(editedCbz, [], buyer);
ok(edited && edited.stores[0].chain === "bhx" && edited.stores[0].products[0].qty === 5 && edited.stores[0].products[0].url.includes("bachhoaxanh.com"), "qty sửa giữa phiên: vẫn nhận chuỗi/URL, qty theo phiên (5)");

// 8. Hai cửa hàng có món TRÙNG TÊN + GIÁ — con trỏ tiến tách đúng URL theo từng cửa hàng
const dupCbz = {
  orderKey: "legacy::COOP_1::https://cooponline.vn/mi-gois|Mì gói|1|5000||::|BHX_2::https://www.bachhoaxanh.com/mi-goi|Mì gói|1|5000||::",
  step: "session",
  status: ["idle", "idle"],
  carts: [[{ name: "Mì gói", qty: 1, unitPrice: 5000 }], [{ name: "Mì gói", qty: 1, unitPrice: 5000 }]],
  pays: ["qr", "cod"],
};
const dup = buildScrapedOrder(dupCbz, [], buyer);
ok(dup && dup.stores.length === 2 && dup.stores[0].chain === "coop" && dup.stores[1].chain === "bhx", "món trùng tên/giá ở 2 cửa hàng: con trỏ tiến tách đúng chuỗi từng store");
ok(dup.stores[0].products[0].url.includes("cooponline.vn") && dup.stores[1].products[0].url.includes("bachhoaxanh.com"), "URL từng dòng về đúng cửa hàng của nó");

// 9. Nhóm giỏ khớp nhầm chuỗi khác URL → bỏ enrichment nhóm (không lây branch/ảnh sai)
const wrongCart = [{ product: { name: "Sữa tươi Vinamilk 180ml lốc 4", image: "https://img/coop.jpg" }, offer: offer("coop", "COOP_9", "Co.opmart X", "https://cooponline.vn/sua"), qty: 3 }];
const guarded = buildScrapedOrder(buyNowCbz, wrongCart, buyer);
ok(guarded.stores[0].chain === "bhx" && guarded.stores[0].products[0].url.includes("bachhoaxanh.com") && !guarded.stores[0].branch, "chain từ URL thắng nhóm giỏ khớp nhầm; enrichment nhóm sai bị bỏ");

console.log(`\n✓ ${pass} kiểm tra reader đều đạt`);
