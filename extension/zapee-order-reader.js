"use strict";
(() => {
  // zapee-order-reader.js — "tự nhặt đơn" từ trang Zapee (Android, quyết định D5).
  //
  // Bối cảnh: web app production KHÔNG có phía gửi postMessage (hợp đồng §8) và
  // còn tắt luồng extension trên mobile — user đã cấm sửa repo web. Thay vào đó
  // content script này (chỉ chạy trên các origin control-surface, cùng entry
  // manifest với bridge-content.js) TỰ ĐỌC dữ liệu đơn từ storage của trang:
  //
  //   sessionStorage["zapee_cbz_state"]  — CbzPersisted của CobrowseSession
  //     (orderKey, step, active, status, carts: Line[][], pays, slots, defaultMode…)
  //   localStorage["gqd_cart"]           — CartItem[] { product, offer, qty }
  //     (nguồn chain/url/ảnh chính xác cho từng dòng hàng)
  //   localStorage["gqd_buyer"]          — BuyerProfile { name, email, phone, address, zip }
  //
  // rồi gửi zapee_scraped_order xuống background — background mint token qua
  // GET {webApp}/api/agent/token (route này CHÍNH THỨC cho phép extension tự
  // mint, xem comment trong app/api/agent/token/route.ts của web) và lưu
  // pendingHandoff:<chain>. Khi user mở trang bán lẻ (web mobile window.open
  // trang chủ chuỗi), zapee_engine_boot khớp host → claim → panel + WS chạy
  // với ĐẦY ĐỦ payload, không cần web hợp tác.
  //
  // ĐÁNH ĐỔI (ghi ở PORTING.md D5): các key/shape trên là chi tiết nội bộ của
  // web (CobrowseSession.tsx, lib/cart.ts, lib/profile.ts @ hytek 53fe94d) —
  // web đổi cấu trúc là reader mù. Mọi lần đọc đều bọc try/catch + heartbeat
  // chẩn đoán (orderReader) để việc "mù" nhìn thấy được trong popup.
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;

  var CBZ_KEY = "zapee_cbz_state";
  var CART_KEY = "gqd_cart";
  var BUYER_KEY = "gqd_buyer";
  var POLL_MS = 1500;

  // Chuỗi extension hỗ trợ (khớp extensionChains của web + recipe agent-server).
  // Entry URL replicate từ getStoreEntryUrl (lib/order-agent/extension-handoff.ts,
  // nhánh isMobile) — chỉ subset các chuỗi này.
  var CHAIN_ENTRY = {
    coop: "https://cooponline.vn/",
    bhx: "https://www.bachhoaxanh.com/dang-nhap",
    shopee: "https://shopee.vn/",
    alibaba: "https://login.alibaba.com/newlogin/icbuLogin.htm?lang=vi_VN&_lang=vi_VN"
  };
  var CHAIN_LABEL = {
    coop: "Co.opmart",
    bhx: "Bách Hóa Xanh",
    shopee: "Shopee",
    alibaba: "Alibaba.com"
  };

  function diag(msg, extra) {
    try {
      chrome.runtime.sendMessage({ type: "zapee_diag_log", src: "reader", msg, extra }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
    }
  }

  function parseJson(raw) {
    if (!raw || typeof raw !== "string") return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // Chuẩn hóa về CHUỖI THI HÀNH — bám chainKey/normalizeChainKey của web
  // (lib/cobrowse-build.ts): aff-* quy về chuỗi thật, alias thường gặp, cuối
  // cùng thử prefix chữ cái của store.id (vd "COOP_00019" → coop).
  function executionChain(raw) {
    const c = String(raw || "").trim().toLowerCase();
    if (!c) return "";
    const noAff = c.startsWith("aff-") ? c.slice(4) : c;
    if (noAff === "cop" || noAff === "coopmart" || noAff === "cooponline") return "coop";
    if (noAff === "bachhoaxanh" || noAff === "bach-hoa-xanh") return "bhx";
    if (noAff === "spe") return "shopee";
    if (CHAIN_ENTRY[noAff]) return noAff;
    const alpha = (noAff.match(/^[a-z]+/) || [""])[0];
    return CHAIN_ENTRY[alpha] ? alpha : "";
  }

  function chainOfCartItem(item) {
    const offer = item && item.offer || {};
    const store = offer.store || {};
    for (const cand of [store.chain, store.id, store.name]) {
      const k = executionChain(cand);
      if (k) return k;
    }
    return "";
  }

  // Replicate cartGroupKey (lib/cobrowse-build.ts): Co.op gom theo terminal,
  // còn lại theo store.id; kênh bán chèn hậu tố ::ch:<id>. Thứ tự nhóm =
  // first-encounter (newestFirst:false — đúng nhánh checkout).
  function cartGroupKey(offer) {
    const store = offer && offer.store || {};
    const terminalCode = String(store.terminalCode || "").trim();
    const baseKey = String(store.chain || "").toLowerCase() === "coop" && terminalCode ? `coop:${terminalCode}` : String(store.id || "");
    const channelId = String(offer && offer.salesChannelId || "");
    return channelId ? `${baseKey}::ch:${channelId}` : baseKey;
  }

  function groupCart(items) {
    const groups = [];
    const byKey = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || !item.offer) continue;
      const key = cartGroupKey(item.offer);
      let group = byKey.get(key);
      if (!group) {
        group = { key, chain: chainOfCartItem(item), items: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }

  function normName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  // Ghép store index i của phiên (cbz.carts[i]) với nhóm giỏ: ưu tiên key nhóm
  // xuất hiện trong orderKey (persistOrderKey chứa store.key), rồi tới độ trùng
  // tên sản phẩm — carts[i] là bản Line đã rút gọn (name/qty/unitPrice) của
  // đúng nhóm đó.
  function matchGroup(groups, used, orderKey, lines) {
    let best = null;
    let bestScore = 0;
    for (const group of groups) {
      if (used.has(group.key)) continue;
      let score = 0;
      if (group.key && orderKey.includes(group.key)) score += 100;
      const names = new Set(group.items.map((item) => normName(item.product && item.product.name)));
      for (const line of lines) if (names.has(normName(line && line.name))) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = group;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function productOf(line, group) {
    const name = String(line && line.name || "");
    const qty = Math.max(1, Number(line && line.qty) || 1);
    const unitPrice = Number(line && line.unitPrice) || 0;
    const product = { name, qty, unitPrice, lineTotal: unitPrice * qty };
    if (line && line.image) product.image = String(line.image);
    if (line && line.emoji) product.emoji = String(line.emoji);
    const match = group && group.items.find((item) => normName(item.product && item.product.name) === normName(name));
    const offer = match && match.offer || null;
    const url = offer && (offer.productUrl || offer.url) || match && match.product && match.product.url;
    if (url) product.url = String(url);
    if (!product.image && match && match.product && match.product.image) product.image = String(match.product.image);
    return product;
  }

  // ------------------------------------------------------------ dựng bản nháp
  // Pure trên (cbz, cart, buyer) — scripts/test-order-reader.mjs trích hàm này
  // chạy fixture trong Node, đừng đụng DOM/chrome bên trong.
  function buildScrapedOrder(cbz, cartItems, buyer) {
    if (!cbz || typeof cbz !== "object" || !Array.isArray(cbz.carts) || !cbz.orderKey) return null;
    const orderKey = String(cbz.orderKey);
    const groups = groupCart(cartItems);
    const used = new Set();
    const stores = [];
    for (let i = 0; i < cbz.carts.length; i++) {
      const lines = Array.isArray(cbz.carts[i]) ? cbz.carts[i] : [];
      if (!lines.length) continue;
      const group = matchGroup(groups, used, orderKey, lines);
      if (group) used.add(group.key);
      const chain = group ? group.chain : "";
      if (!chain || !CHAIN_ENTRY[chain]) continue;
      const placed = Array.isArray(cbz.status) && cbz.status[i] === "placed";
      const products = lines.map((line) => productOf(line, group));
      const firstOffer = group && group.items[0] && group.items[0].offer || null;
      const storeRaw = firstOffer && firstOffer.store || {};
      stores.push({
        index: i,
        key: group ? group.key : `${chain}-${i}`,
        chain,
        placed,
        entryUrl: CHAIN_ENTRY[chain],
        name: CHAIN_LABEL[chain] || chain,
        branch: String(storeRaw.name || "") || void 0,
        storeId: String(storeRaw.id || "") || void 0,
        pay: typeof cbz.pays?.[i] === "string" ? cbz.pays[i] : void 0,
        slot: cbz.slots && typeof cbz.slots[i] === "string" ? cbz.slots[i] : null,
        products,
        total: products.reduce((sum, p) => sum + (p.lineTotal || 0), 0)
      });
    }
    if (!stores.length) return null;
    const buyerInfo = {
      name: String(buyer && buyer.name || ""),
      email: String(buyer && buyer.email || ""),
      phone: String(buyer && buyer.phone || ""),
      address: String(buyer && buyer.address || ""),
      zip: String(buyer && buyer.zip || "")
    };
    // Chữ ký đổi là re-import: bám các trường ảnh hưởng payload, bỏ qua step/active
    // (chuyển màn không cần re-import).
    const signature = `${orderKey}|${JSON.stringify([cbz.carts, cbz.pays, cbz.slots, cbz.status, buyerInfo])}`;
    return { orderKey, signature, buyer: buyerInfo, defaultMode: String(cbz.defaultMode || "zapee"), stores };
  }

  function buildPayload(order, store) {
    const buyer = order.buyer;
    const shippingAddress = {
      name: buyer.name,
      phone: buyer.phone,
      email: buyer.email,
      addressLine: buyer.address,
      fullAddress: buyer.address,
      postalCode: buyer.zip || void 0
    };
    const pending = order.stores.filter((s) => !s.placed);
    const nextStore = pending.find((s) => s.index !== store.index);
    const orderStores = order.stores.map((s) => ({
      key: s.key,
      chain: s.chain,
      name: s.name,
      branch: s.branch,
      entryUrl: s.entryUrl,
      status: s.placed ? "placed" : "idle",
      products: s.products,
      total: s.total
    }));
    return {
      storeKey: store.key,
      entryUrl: store.entryUrl,
      products: store.products,
      items: store.products,
      // Danh tính đơn bất biến — live cart không được thay bằng dòng lạ (khớp web).
      requestedProducts: store.products,
      orderStores,
      buyerName: buyer.name,
      buyerEmail: buyer.email,
      buyerPhone: buyer.phone,
      buyerAddress: buyer.address,
      zip: buyer.zip || void 0,
      postalCode: buyer.zip || void 0,
      shippingAddress,
      buyer: { name: buyer.name, phone: buyer.phone, address: buyer.address, zip: buyer.zip },
      customer: { name: buyer.name, phone: buyer.phone, address: buyer.address, zip: buyer.zip },
      name: buyer.name,
      email: buyer.email,
      phone: buyer.phone,
      address: buyer.address,
      chain: store.chain,
      storeId: store.storeId,
      paymentMethod: store.pay || (store.chain === "coop" ? "qr" : "cod"),
      slot: store.slot,
      storeName: store.name,
      ...nextStore ? { nextStoreName: nextStore.name, nextStoreEntryUrl: nextStore.entryUrl } : {},
      branch: store.branch,
      deliveryMode: "delivery",
      note: null,
      defaultMode: order.defaultMode,
      accountMode: "login",
      // Cùng luật với web (startExtensionOrder): Co.op/Shopee chỉ hướng dẫn
      // trên trang, không phủ blocking frame.
      allowBlockingPresentation: store.chain !== "coop" && store.chain !== "shopee",
      liveCartScope: store.chain === "shopee" || store.chain === "bhx" || store.chain === "coop" || store.chain === "alibaba" ? "selected" : "requested",
      // Đơn nhặt từ storage: chạy chế độ HƯỚNG DẪN (manual) — lựa chọn
      // auto/manual của user không được CobrowseSession persist nên không đọc
      // lại được; manual an toàn (không tự bấm gì ngoài ý muốn).
      automationMode: "manual",
      userLanguage: "vi"
    };
  }

  // ------------------------------------------------------------- vòng quan sát
  var lastSignature = "";
  var importing = false;

  function tick() {
    if (importing) return;
    if (document.visibilityState !== "visible") return;
    let order = null;
    try {
      order = buildScrapedOrder(
        parseJson(sessionStorage.getItem(CBZ_KEY)),
        parseJson(localStorage.getItem(CART_KEY)),
        parseJson(localStorage.getItem(BUYER_KEY))
      );
    } catch (err) {
      diag(`đọc storage lỗi: ${String(err && err.message || err)}`);
      return;
    }
    if (!order || order.signature === lastSignature) return;
    const drafts = order.stores.filter((s) => !s.placed).map((s) => ({
      chain: s.chain,
      entryUrl: s.entryUrl,
      storeKey: s.key,
      payload: buildPayload(order, s)
    }));
    if (!drafts.length) {
      lastSignature = order.signature;
      return;
    }
    importing = true;
    try {
      chrome.runtime.sendMessage(
        { type: "zapee_scraped_order", orderKey: order.orderKey, drafts },
        (response) => {
          void chrome.runtime.lastError;
          importing = false;
          if (response && response.ok) {
            lastSignature = order.signature;
            diag(`import ${drafts.length} cửa hàng: ${drafts.map((d) => d.chain).join(", ")}`, { orderKey: order.orderKey.slice(0, 80) });
          } else {
            diag(`import bị từ chối/lỗi${response && response.error ? `: ${response.error}` : ""}`);
          }
        }
      );
    } catch (err) {
      importing = false;
      diag(`sendMessage lỗi: ${String(err && err.message || err)}`);
    }
  }

  setInterval(tick, POLL_MS);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick, { once: true });
  } else {
    tick();
  }
})();
