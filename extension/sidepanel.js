"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/background/session-store.ts
  var session_store_exports = {};
  __export(session_store_exports, {
    clearActiveHandoff: () => clearActiveHandoff,
    clearAgentConnectionFailure: () => clearAgentConnectionFailure,
    clearCoopLiveCart: () => clearCoopLiveCart,
    clearCoopLiveCartForSession: () => clearCoopLiveCartForSession,
    clearPendingHandoff: () => clearPendingHandoff,
    clearPreparedHandoffTab: () => clearPreparedHandoffTab,
    getActiveHandoff: () => getActiveHandoff,
    getAgentConnectionFailure: () => getAgentConnectionFailure,
    getAllPendingHandoffs: () => getAllPendingHandoffs,
    getCoopLiveCart: () => getCoopLiveCart,
    getPendingHandoff: () => getPendingHandoff,
    getPreparedHandoffTab: () => getPreparedHandoffTab,
    replaceOrderHandoff: () => replaceOrderHandoff,
    saveActiveHandoff: () => saveActiveHandoff,
    saveAgentConnectionFailure: () => saveAgentConnectionFailure,
    saveCoopLiveCart: () => saveCoopLiveCart,
    savePendingHandoff: () => savePendingHandoff,
    savePreparedHandoffTab: () => savePreparedHandoffTab
  });
  function preparedKey(sourceTabId) {
    return `${PREPARED_HANDOFF_TAB_PREFIX}${sourceTabId}`;
  }
  async function savePreparedHandoffTab(prepared) {
    await chrome.storage.session.set({
      [preparedKey(prepared.sourceTabId)]: { ...prepared, preparedAt: Date.now() }
    });
  }
  async function getPreparedHandoffTab(sourceTabId) {
    const key = preparedKey(sourceTabId);
    const result = await chrome.storage.session.get(key);
    const prepared = result[key];
    if (!prepared) return null;
    if (Date.now() - prepared.preparedAt > PREPARED_HANDOFF_TAB_TTL_MS) {
      await clearPreparedHandoffTab(sourceTabId);
      return null;
    }
    return prepared;
  }
  async function clearPreparedHandoffTab(sourceTabId) {
    await chrome.storage.session.remove(preparedKey(sourceTabId));
  }
  function keyFor(chain) {
    return `pendingHandoff:${chain}`;
  }
  async function savePendingHandoff(handoff, zapeeTabId) {
    const key = keyFor(handoff.chain);
    const stored = { ...handoff, receivedAt: Date.now(), zapeeTabId };
    await chrome.storage.session.set({ [key]: stored });
  }
  async function getPendingHandoff(chain) {
    const key = keyFor(chain);
    const result = await chrome.storage.session.get(key);
    const stored = result[key];
    if (!stored) return null;
    if (Date.now() - stored.receivedAt > TTL_MS) {
      await clearPendingHandoff(chain);
      return null;
    }
    return stored;
  }
  async function clearPendingHandoff(chain) {
    await chrome.storage.session.remove(keyFor(chain));
  }
  async function replaceOrderHandoff(handoff, zapeeTabId) {
    const all = await chrome.storage.session.get(null);
    const staleKeys = Object.keys(all).filter((key) => key.startsWith("pendingHandoff:"));
    staleKeys.push(ACTIVE_KEY, LIVE_CART_KEY, CONNECTION_FAILURE_KEY);
    await chrome.storage.session.remove([...new Set(staleKeys)]);
    await savePendingHandoff(handoff, zapeeTabId);
  }
  async function getAllPendingHandoffs() {
    const all = await chrome.storage.session.get(null);
    const result = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith("pendingHandoff:")) continue;
      const stored = value;
      if (Date.now() - stored.receivedAt > TTL_MS) {
        await chrome.storage.session.remove(key);
        continue;
      }
      result.push(stored);
    }
    return result;
  }
  async function saveActiveHandoff(handoff, tabId) {
    const record = {
      ...handoff,
      tabId,
      claimedAt: Date.now(),
      receivedAt: handoff.receivedAt || Date.now()
    };
    await chrome.storage.session.set({ [ACTIVE_KEY]: record });
  }
  async function getActiveHandoff() {
    const result = await chrome.storage.session.get(ACTIVE_KEY);
    const stored = result[ACTIVE_KEY];
    if (!stored) return null;
    if (Date.now() - (stored.claimedAt || stored.receivedAt) > TTL_MS) {
      await clearActiveHandoff();
      return null;
    }
    return stored;
  }
  async function clearActiveHandoff() {
    await chrome.storage.session.remove(ACTIVE_KEY);
  }
  async function saveAgentConnectionFailure(failure) {
    await chrome.storage.session.set({
      [CONNECTION_FAILURE_KEY]: { ...failure, failedAt: Date.now() }
    });
  }
  async function getAgentConnectionFailure() {
    const result = await chrome.storage.session.get(CONNECTION_FAILURE_KEY);
    const stored = result[CONNECTION_FAILURE_KEY];
    if (!stored) return null;
    if (Date.now() - stored.failedAt > TTL_MS) {
      await clearAgentConnectionFailure();
      return null;
    }
    return stored;
  }
  async function clearAgentConnectionFailure() {
    await chrome.storage.session.remove(CONNECTION_FAILURE_KEY);
  }
  async function saveCoopLiveCart(cart) {
    await chrome.storage.session.set({ [LIVE_CART_KEY]: cart });
  }
  async function getCoopLiveCart() {
    const result = await chrome.storage.session.get(LIVE_CART_KEY);
    const cart = result[LIVE_CART_KEY];
    if (!Array.isArray(cart?.items) || !cart.sessionId) return null;
    return cart;
  }
  async function clearCoopLiveCart() {
    await chrome.storage.session.remove(LIVE_CART_KEY);
  }
  async function clearCoopLiveCartForSession(sessionId) {
    const current = await getCoopLiveCart();
    if (!sessionId || current?.sessionId !== sessionId) return false;
    await chrome.storage.session.remove(LIVE_CART_KEY);
    return true;
  }
  var TTL_MS, PREPARED_HANDOFF_TAB_PREFIX, PREPARED_HANDOFF_TAB_TTL_MS, ACTIVE_KEY, LIVE_CART_KEY, CONNECTION_FAILURE_KEY;
  var init_session_store = __esm({
    "src/background/session-store.ts"() {
      "use strict";
      TTL_MS = 10 * 60 * 1e3;
      PREPARED_HANDOFF_TAB_PREFIX = "preparedHandoffTab:";
      PREPARED_HANDOFF_TAB_TTL_MS = 10 * 60 * 1e3;
      ACTIVE_KEY = "activeOrderHandoff";
      LIVE_CART_KEY = "coopLiveCart";
      CONNECTION_FAILURE_KEY = "agentConnectionFailure";
    }
  });

  // src/sidepanel/index.ts
  init_session_store();

  // src/config.ts
  var buildAgentServerUrl = "https://agent-server.timdaythay.com";
  var buildZapeeWebAppUrl = "https://zapee.timdaythay.com";
  function parseAgentServerUrls(baseUrlString) {
    const normalized = baseUrlString.trim().replace(/\/+$/, "");
    const url = new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
    const isSecure = url.protocol === "https:" || url.protocol === "wss:";
    const httpProtocol = isSecure ? "https:" : "http:";
    const wsProtocol = isSecure ? "wss:" : "ws:";
    return {
      httpUrl: `${httpProtocol}//${url.host}`,
      wsUrl: `${wsProtocol}//${url.host}`
    };
  }
  var DEFAULT_BASE_URL = buildAgentServerUrl || "https://agent-server.timdaythay.com";
  var defaultParsed = parseAgentServerUrls(DEFAULT_BASE_URL);
  var DEFAULT_AGENT_SERVER_HTTP_URL = defaultParsed.httpUrl;
  var DEFAULT_AGENT_SERVER_WS_URL = defaultParsed.wsUrl;
  var DEFAULT_ZAPEE_WEB_APP_URL = buildZapeeWebAppUrl || "https://zapee.timdaythay.com";
  var CHAIN_LOGO = {
    bhx: { label: "B\xE1ch H\xF3a Xanh", color: "#1aa64b" },
    coop: { label: "Co.opmart", color: "#0067b1" },
    shopee: { label: "Shopee", color: "#ee4d2d" }
  };

  // src/sidepanel/index.ts
  var currentSessionId = null;
  var activeLiveCart = null;
  var selectedStoreKey = null;
  var lastRenderKey = "";
  var lastScrolledStoreKey = null;
  var lastTabScrollLeft = 0;
  function panelRenderKey(parts) {
    const storeBits = (parts.stores || []).map((store) => `${store.key}:${store.status || ""}:${store.total}:${store.products.map((item) => `${item.name}x${item.qty}@${item.lineTotal ?? ""}:${item.image || ""}`).join(",")}`).join("|");
    return [
      parts.mode,
      parts.sessionId || "",
      parts.selectedStoreKey || "",
      parts.statusText || "",
      parts.statusClass || "",
      parts.storeKey || "",
      storeBits,
      parts.orderCode || "",
      parts.errorDetail || ""
    ].join("\n");
  }
  function shouldPaint(root2, key) {
    if (key === lastRenderKey && root2.childElementCount > 0) return false;
    lastRenderKey = key;
    return true;
  }
  function withLiveCart(payload, sessionId) {
    const live = activeLiveCart;
    if (!live || !Array.isArray(live.items)) return payload;
    if (!sessionId || !live.sessionId || live.sessionId !== sessionId) return payload;
    return {
      ...payload,
      products: live.items,
      items: live.items,
      total: live.total,
      liveCartSource: live.source || "cart-dom",
      liveCartSyncedAt: Date.parse(live.capturedAt) || Date.now()
    };
  }
  async function getSidePanelActiveTab() {
    try {
      const win = await chrome.windows.getCurrent();
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: win.id });
      return activeTab ?? null;
    } catch {
      return null;
    }
  }
  async function queryActiveSession() {
    try {
      const activeTab = await getSidePanelActiveTab();
      if (typeof activeTab?.id !== "number") return null;
      return await chrome.runtime.sendMessage({ type: "zapee_query_session", tabId: activeTab.id });
    } catch {
      return null;
    }
  }
  var lastClaimTabId = null;
  var lastClaimAt = 0;
  async function claimPendingIfTabMatches() {
    try {
      const activeTab = await getSidePanelActiveTab();
      if (typeof activeTab?.id !== "number" || !activeTab.url) return null;
      const now = Date.now();
      if (lastClaimTabId === activeTab.id && now - lastClaimAt < 3e3) return null;
      lastClaimTabId = activeTab.id;
      lastClaimAt = now;
      const result = await chrome.runtime.sendMessage({
        type: "zapee_claim_pending",
        tabId: activeTab.id
      });
      if (result && result.sessionId && result.payload) {
        return {
          sessionId: result.sessionId,
          chain: result.chain,
          execMode: result.execMode,
          payload: result.payload,
          log: result.log ?? [],
          orderCompleted: result.orderCompleted
        };
      }
    } catch {
    }
    return null;
  }
  function hasOrderInfo(payload) {
    if (!payload) return false;
    return Boolean(
      payload.shippingAddress?.name || payload.shippingAddress?.phone || payload.shippingAddress?.fullAddress || payload.buyerName || payload.buyerPhone || payload.buyerAddress || payload.name || payload.phone || payload.address || payload.productName || Array.isArray(payload.products) && payload.products.length > 0 || Array.isArray(payload.items) && payload.items.length > 0
    );
  }
  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "\u2014";
    return `${Math.round(n).toLocaleString("vi-VN")}\u0111`;
  }
  function chainLabel(chain) {
    const c = String(chain || "").toLowerCase();
    if (c === "coop" || c === "cop" || c === "coopmart") return "Co.opmart";
    if (c === "bhx" || c === "bachhoaxanh" || c === "aff-bhx") return "B\xE1ch H\xF3a Xanh";
    if (c === "alibaba" || c === "aff-alibaba") return "Alibaba.com";
    if (c === "shopee" || c === "spe" || c === "aff-shopee") return "Shopee";
    return chain ? chain.toUpperCase() : "Nh\xE0 b\xE1n";
  }
  function chainInitial(chain) {
    const c = String(chain || "").toLowerCase();
    if (c === "coop" || c === "cop") return "C";
    if (c === "bhx" || c === "aff-bhx") return "B";
    if (c === "alibaba" || c === "aff-alibaba") return "A";
    if (c === "shopee" || c === "spe" || c === "aff-shopee") return "S";
    return (chain || "?").slice(0, 1).toUpperCase();
  }
  function isGenericOnlineLabel(value) {
    return /^mua online$/i.test(String(value || "").trim());
  }
  function storeCardTitle(storeName, branch, chain) {
    if (storeName && !isGenericOnlineLabel(storeName)) return storeName;
    if (branch && !isGenericOnlineLabel(branch)) return branch;
    return chainLabel(chain);
  }
  function storeStatusText(status, completed) {
    if (completed || status === "placed") return "\u2713 \u0110\xE3 \u0111\u1EB7t";
    if (status === "login") return "\u0110\u0103ng nh\u1EADp";
    if (status === "filling") return "\u0110ang \u0111i\u1EC1n\u2026";
    if (status === "review") return "Ch\u1EDD x\xE1c nh\u1EADn";
    if (status === "otp") return "Nh\u1EADp OTP";
    if (status === "assist") return "Tr\u1EE3 l\xFD";
    return "Ch\u1EDD";
  }
  function storeTabState(storeKey, currentStoreKey, completed) {
    if (completed) return "done";
    if (storeKey === currentStoreKey) return "ordering";
    return "waiting";
  }
  function storeTabStatusText(state) {
    if (state === "done") return "\u0110\xE3 \u0111\u1EB7t";
    if (state === "ordering") return "\u0110ang \u0111\u1EB7t h\xE0ng";
    return "Ch\u1EDD";
  }
  function disclaimerBody(chain) {
    const c = String(chain || "").toLowerCase();
    if (c === "coop" || c === "cop" || c === "coopmart") {
      return "Zapee kh\xF4ng li\xEAn k\u1EBFt, kh\xF4ng \u0111\u1EA1i di\u1EC7n cho Co.opmart. \u0110\u01A1n h\xE0ng \u0111\u01B0\u1EE3c x\xE1c l\u1EADp tr\u1EF1c ti\u1EBFp gi\u1EEFa b\u1EA1n v\xE0 Co.opmart tr\xEAn website ch\xEDnh ch\u1EE7. Gi\xE1, ph\xED giao h\xE0ng v\xE0 khuy\u1EBFn m\xE3i c\xF3 th\u1EC3 thay \u0111\u1ED5i khi \u0111\u1EB7t \u0111\u01A1n.";
    }
    return "Zapee kh\xF4ng li\xEAn k\u1EBFt, kh\xF4ng \u0111\u1EA1i di\u1EC7n cho c\xE1c nh\xE0 b\xE1n \u0111\u01B0\u1EE3c hi\u1EC3n th\u1ECB. \u0110\u01A1n h\xE0ng \u0111\u01B0\u1EE3c x\xE1c l\u1EADp tr\u1EF1c ti\u1EBFp gi\u1EEFa b\u1EA1n v\xE0 nh\xE0 b\xE1n tr\xEAn website ch\xEDnh ch\u1EE7 c\u1EE7a h\u1ECD.";
  }
  function normalizePanelImageUrl(url) {
    const raw = (url || "").trim();
    if (!raw) return "";
    if (/drive\.google\.com\/(drive\/|.*\/folders\/)/i.test(raw)) return "";
    const fileMatch = raw.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
    if (fileMatch) return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileMatch[1])}=s0`;
    const idMatch = raw.match(/drive\.google\.com\/[^?]*\?[^#]*\bid=([^&#]+)/i);
    if (idMatch) return `https://lh3.googleusercontent.com/d/${encodeURIComponent(decodeURIComponent(idMatch[1]))}=s0`;
    return raw;
  }
  function panelDisplayImageSrc(url) {
    const normalized = normalizePanelImageUrl(url);
    if (!normalized) return "";
    const appBase = DEFAULT_ZAPEE_WEB_APP_URL.replace(/\/+$/, "");
    if (normalized.startsWith("/api/proxy-img?")) {
      return `${appBase}${normalized}`;
    }
    if (/^https:\/\/lh3\.googleusercontent\.com\/d\//i.test(normalized)) {
      return `${appBase}/api/proxy-img?u=${encodeURIComponent(normalized)}`;
    }
    return normalized;
  }
  function extractProducts(payload) {
    const liveFirst = payload.liveCartSource ? Array.isArray(payload.items) ? payload.items : Array.isArray(payload.products) ? payload.products : null : null;
    const raw = liveFirst || (Array.isArray(payload.products) ? payload.products : null) || (Array.isArray(payload.items) ? payload.items : null) || [];
    if (raw.length) {
      return raw.map((item) => {
        const name = String(item.name || item.productName || item.title || "S\u1EA3n ph\u1EA9m");
        const qty = Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1);
        const unitPrice = typeof item.unitPrice === "number" ? item.unitPrice : typeof item.price === "number" ? item.price : void 0;
        const lineTotal = typeof item.lineTotal === "number" ? item.lineTotal : unitPrice != null ? unitPrice * qty : void 0;
        const image = typeof item.image === "string" ? item.image : typeof item.productImage === "string" ? item.productImage : void 0;
        return { name, qty, unitPrice, lineTotal, image };
      });
    }
    if (payload.productName) {
      const name = String(payload.productName);
      const qty = Math.max(1, Number(payload.qty ?? payload.quantity ?? 1) || 1);
      const unitPrice = typeof payload.unitPrice === "number" ? payload.unitPrice : void 0;
      return [{ name, qty, unitPrice, lineTotal: unitPrice != null ? unitPrice * qty : void 0 }];
    }
    return [];
  }
  function totalOf(payload, items) {
    if (payload.liveCartSource && typeof payload.total === "number") return payload.total;
    if (typeof payload.total === "number" && !payload.liveCartSource) return payload.total;
    const sum = items.reduce((s, item) => s + (item.lineTotal ?? 0), 0);
    if (sum > 0) return sum;
    if (typeof payload.total === "number") return payload.total;
    return 0;
  }
  function orderStoresOf(payload, fallbackChain) {
    const rawStores = Array.isArray(payload.orderStores) ? payload.orderStores : [];
    const stores = rawStores.flatMap((raw) => {
      const key = String(raw.key || "").trim();
      if (!key) return [];
      const productsPayload = {
        products: Array.isArray(raw.products) ? raw.products : []
      };
      const products2 = extractProducts(productsPayload);
      const total = Number(raw.total);
      return [{
        key,
        chain: String(raw.chain || fallbackChain),
        name: String(raw.name || chainLabel(String(raw.chain || fallbackChain))),
        branch: String(raw.branch || "") || void 0,
        entryUrl: String(raw.entryUrl || "") || void 0,
        status: String(raw.status || "idle"),
        orderCode: String(raw.orderCode || "") || void 0,
        products: products2,
        total: Number.isFinite(total) ? total : products2.reduce((sum, product) => sum + (product.lineTotal ?? 0), 0)
      }];
    });
    if (stores.length) {
      const currentStoreKey = String(payload.storeKey || "").trim();
      if (payload.liveCartSource && currentStoreKey) {
        const liveProducts = extractProducts(payload);
        const liveTotal = totalOf(payload, liveProducts);
        return stores.map((store) => store.key === currentStoreKey ? { ...store, products: liveProducts, total: liveTotal } : store);
      }
      return stores;
    }
    const products = extractProducts(payload);
    return [{
      key: String(payload.storeKey || fallbackChain || "store"),
      chain: fallbackChain,
      name: String(payload.storeName || chainLabel(fallbackChain)),
      branch: String(payload.branch || payload.storeName || "") || void 0,
      entryUrl: String(payload.entryUrl || "") || void 0,
      status: "login",
      products,
      total: totalOf(payload, products)
    }];
  }
  var COPY_ICON_MARKUP = '<rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M6.5 15H5.5A1.5 1.5 0 0 1 4 13.5v-8A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5v1" />';
  var COPIED_ICON_MARKUP = '<path d="M5 12.5 10 17.5 19 7" />';
  function copyIconSvg() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = COPY_ICON_MARKUP;
    return svg;
  }
  function attachCopy(button, value) {
    let resetTimer = null;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(value);
        const icon = button.querySelector("svg");
        const prevText = icon ? null : button.textContent;
        if (icon) {
          icon.innerHTML = COPIED_ICON_MARKUP;
          button.classList.add("is-copied");
        } else {
          button.textContent = "\u2713";
        }
        if (resetTimer !== null) window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
          resetTimer = null;
          if (icon) {
            icon.innerHTML = COPY_ICON_MARKUP;
            button.classList.remove("is-copied");
          } else {
            button.textContent = prevText;
          }
        }, 1600);
      } catch {
      }
    });
  }
  function fieldRow(label, value) {
    const wrap = document.createElement("div");
    wrap.className = "info-field";
    const lab = document.createElement("span");
    lab.textContent = label;
    const row = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = value || "\u2014";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-button copy-icon-button";
    btn.append(copyIconSvg());
    btn.setAttribute("aria-label", `Sao ch\xE9p ${label}`);
    btn.title = "Sao ch\xE9p \u0111\u1EC3 d\xE1n sang trang c\u1EEDa h\xE0ng";
    btn.tabIndex = -1;
    if (value) attachCopy(btn, value);
    row.append(strong, btn);
    wrap.append(lab, row);
    return wrap;
  }
  function brandHeader(region) {
    const header = document.createElement("header");
    header.className = "brand-header";
    const logoUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("brand/logo.png") : "brand/logo.png";
    const city = (region || "").trim() || "Zapee Assistant";
    header.innerHTML = `
    <img src="${logoUrl}" alt="Zapee" />
    <div class="brand-copy">
      <div class="brand-badge-row">
        <span class="brand-badge">${city}</span>
      </div>
      <div class="brand-tagline">
        <strong>K\u1EBFt n\u1ED1i mua b\xE1n - Kh\xF4ng thu ph\xED</strong>
        <span>T\xECm g\xEC c\u0169ng c\xF3 - Gi\xE1 h\u1EDDi quanh \u0111\xE2y</span>
      </div>
    </div>
  `;
    return header;
  }
  function regionFromPayload(payload) {
    if (!payload) return null;
    const addr = String(payload.shippingAddress?.fullAddress || payload.buyerAddress || payload.address || "");
    const m = addr.match(/(Thành phố\s+[^,]+|TP\.?\s*H[CĐ]M|Hà Nội|Đà Nẵng|Cần Thơ)/i);
    if (!m) return null;
    return m[1].replace(/\s+/g, " ").trim().toUpperCase();
  }
  function postalCodeFromAddress(value) {
    return String(value || "").split(",").map((part) => part.trim()).find((part) => /^\d{4,6}$/.test(part)) || "";
  }
  function recordOf(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function postalCodeFromRecord(value) {
    const record = recordOf(value);
    if (!record) return "";
    return String(
      record.postalCode || record.zip || record.zipCode || record.postcode || ""
    ).trim();
  }
  function renderIdle(root2) {
    currentSessionId = null;
    selectedStoreKey = null;
    lastScrolledStoreKey = null;
    lastTabScrollLeft = 0;
    if (!shouldPaint(root2, panelRenderKey({ mode: "idle" }))) return;
    root2.replaceChildren();
    root2.append(brandHeader(null));
    const empty = document.createElement("section");
    empty.className = "empty-state";
    empty.innerHTML = `
    <strong>Ch\u01B0a c\xF3 \u0111\u01A1n d\u1EF1 th\u1EA3o</strong>
    <p>T\u1EA1i Zapee, ch\u1ECDn \u0111\u01A1n r\u1ED3i b\u1EA5m \u201CM\u1EDF trang c\u1EEDa h\xE0ng\u201D / \u201CMua ngay\u201D.</p>
  `;
    const steps = document.createElement("ul");
    steps.className = "empty-steps";
    for (const [i, text] of [
      "M\u1EDF Zapee, ch\u1ECDn s\u1EA3n ph\u1EA9m v\xE0 b\u1EA5m \u201CMua ngay\u201D.",
      "Quay l\u1EA1i tab c\u1EEDa h\xE0ng \u2014 ti\u1EC7n \xEDch t\u1EF1 nh\u1EADn \u0111\u01A1n.",
      "Ho\u1EB7c b\u1EA5m bi\u1EC3u t\u01B0\u1EE3ng tr\u1EE3 l\xFD tr\xEAn trang b\xE1n h\xE0ng."
    ].entries()) {
      const li = document.createElement("li");
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(i + 1);
      const span = document.createElement("span");
      span.textContent = text;
      li.append(n, span);
      steps.append(li);
    }
    empty.append(steps);
    root2.append(empty);
  }
  function renderOrderSheet(root2, opts) {
    const { payload, statusText, statusClass, errorDetail, sessionId, orderCompleted } = opts;
    const stores = orderStoresOf(payload, opts.chain);
    const currentStoreKey = String(payload.storeKey || stores[0]?.key || "");
    const preferredStore = stores.find((store) => store.key === selectedStoreKey) || stores.find((store) => store.key === currentStoreKey) || stores[0];
    selectedStoreKey = preferredStore.key;
    const chain = preferredStore.chain;
    const items = preferredStore.products;
    const total = preferredStore.total;
    const storeName = preferredStore.name;
    const branch = chain === "aff-shopee" ? preferredStore.name : preferredStore.branch || preferredStore.name;
    const selectedIsCurrent = preferredStore.key === currentStoreKey;
    const entryUrl = selectedIsCurrent ? preferredStore.entryUrl || opts.entryUrl : void 0;
    const selectedCompleted = Boolean(
      orderCompleted && preferredStore.key === currentStoreKey || preferredStore.status === "placed"
    );
    const selectedTabState = storeTabState(preferredStore.key, currentStoreKey, selectedCompleted);
    const showCurrentSuccess = selectedIsCurrent && selectedCompleted && Boolean(orderCompleted);
    const selectedStatusText = selectedIsCurrent ? statusText : selectedCompleted ? `\u2713 \u0110\xE3 \u0111\u1EB7t${preferredStore.orderCode ? ` \xB7 M\xE3 \u0111\u01A1n ${preferredStore.orderCode}` : ""}` : `\u25CF ${storeStatusText(preferredStore.status, false)}`;
    const buyerName = String(payload.shippingAddress?.name || payload.buyerName || payload.name || "\u2014");
    const buyerPhone = String(payload.shippingAddress?.phone || payload.buyerPhone || payload.phone || "\u2014");
    const buyerAddress = String(payload.shippingAddress?.fullAddress || payload.shippingAddress?.addressLine || payload.buyerAddress || payload.address || "\u2014");
    const buyerEmail = String(payload.shippingAddress?.email || payload.buyerEmail || payload.email || "").trim();
    const payloadRecord = payload;
    const buyerZip = String(
      postalCodeFromRecord(payload.shippingAddress) || payload.zip || payload.postalCode || payloadRecord.zipCode || payloadRecord.postcode || postalCodeFromRecord(payloadRecord.buyer) || postalCodeFromRecord(payloadRecord.customer) || postalCodeFromRecord(payloadRecord.address) || postalCodeFromAddress(buyerAddress) || ""
    ).trim();
    const pay = String(payload.paymentMethod || payload.pay || "QR").toUpperCase();
    const paintKey = panelRenderKey({
      mode: "sheet",
      sessionId,
      selectedStoreKey,
      statusText,
      statusClass,
      storeKey: currentStoreKey,
      stores,
      orderCode: orderCompleted?.orderCode,
      errorDetail
    });
    if (!shouldPaint(root2, paintKey)) return;
    root2.replaceChildren();
    root2.append(brandHeader(regionFromPayload(payload)));
    const sheet = document.createElement("section");
    sheet.className = "order-sheet";
    const disc = document.createElement("p");
    disc.className = "disclaimer";
    disc.innerHTML = `<strong>Mi\u1EC5n tr\u1EEB:</strong> ${disclaimerBody(chain)}`;
    sheet.append(disc);
    if (stores.length > 1) {
      const tabs = document.createElement("nav");
      tabs.className = "store-tabs";
      tabs.setAttribute("aria-label", "\u0110\u01A1n theo c\u1EEDa h\xE0ng");
      let selectedTab = null;
      for (const store of stores) {
        const completed = Boolean(
          orderCompleted && store.key === currentStoreKey || store.status === "placed"
        );
        const tabState = storeTabState(store.key, currentStoreKey, completed);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `store-tab ${tabState}${store.key === preferredStore.key ? " active" : ""}`;
        button.setAttribute("aria-pressed", store.key === preferredStore.key ? "true" : "false");
        if (store.key === preferredStore.key) selectedTab = button;
        button.innerHTML = `
        <span class="store-tab-dot" aria-hidden="true"></span>
        <span class="store-tab-logo" aria-hidden="true">${chainInitial(store.chain)}</span>
        <span class="store-tab-copy"><strong>${chainLabel(store.chain)}</strong><small>${storeTabStatusText(tabState)}</small></span>
      `;
        button.addEventListener("click", () => {
          if (selectedStoreKey === store.key) return;
          selectedStoreKey = store.key;
          renderOrderSheet(root2, opts);
        });
        tabs.append(button);
      }
      sheet.append(tabs);
      tabs.addEventListener("scroll", () => {
        lastTabScrollLeft = tabs.scrollLeft;
      }, { passive: true });
      const focusSelected = Boolean(selectedTab) && lastScrolledStoreKey !== preferredStore.key;
      if (focusSelected) lastScrolledStoreKey = preferredStore.key;
      requestAnimationFrame(() => {
        if (!tabs.isConnected) return;
        const max = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
        if (max <= 0) {
          lastTabScrollLeft = 0;
          return;
        }
        const target = focusSelected && selectedTab ? selectedTab.offsetLeft - (tabs.clientWidth - selectedTab.offsetWidth) / 2 : lastTabScrollLeft;
        const next = Math.min(max, Math.max(0, Math.round(target)));
        lastTabScrollLeft = next;
        if (Math.abs(tabs.scrollLeft - next) > 1) tabs.scrollLeft = next;
      });
    }
    if (showCurrentSuccess) {
      const success = document.createElement("section");
      success.className = "order-success";
      const check = document.createElement("div");
      check.className = "order-success-check";
      check.textContent = "\u2713";
      const title = document.createElement("h1");
      title.textContent = `\u0110\u1EB7t h\xE0ng ${chainLabel(chain)} th\xE0nh c\xF4ng`;
      const description = document.createElement("p");
      description.textContent = "\u0110\u01A1n \u0111\xE3 \u0111\u01B0\u1EE3c x\xE1c nh\u1EADn tr\xEAn website ch\xEDnh ch\u1EE7.";
      const code = document.createElement("div");
      code.className = "order-success-code";
      const codeLabel = document.createElement("span");
      codeLabel.textContent = "M\xE3 \u0111\u01A1n";
      const codeValue = document.createElement("strong");
      codeValue.textContent = preferredStore.orderCode || orderCompleted?.orderCode || "\u2014";
      code.append(codeLabel, codeValue);
      success.append(check, title, description, code);
      const nextStoreName = String(payload.nextStoreName || "").trim();
      if (sessionId && nextStoreName) {
        const next = document.createElement("button");
        next.type = "button";
        next.className = "next-store-btn";
        next.textContent = `Ti\u1EBFp t\u1EE5c \u2192 ${nextStoreName}`;
        next.addEventListener("click", () => {
          if (next.disabled) return;
          next.disabled = true;
          next.textContent = `\u0110ang m\u1EDF ${nextStoreName}\u2026`;
          void chrome.runtime.sendMessage({
            type: "zapee_continue_next_store",
            sessionId
          }).then((result) => {
            if (result?.ok) return;
            next.disabled = false;
            next.textContent = `Th\u1EED l\u1EA1i \u2192 ${nextStoreName}`;
          }).catch(() => {
            next.disabled = false;
            next.textContent = `Th\u1EED l\u1EA1i \u2192 ${nextStoreName}`;
          });
        });
        success.append(next);
      }
      sheet.append(success);
      root2.append(sheet);
      return;
    }
    const header = document.createElement("header");
    header.className = "order-header";
    const isLive = selectedIsCurrent && Boolean(payload.liveCartSource);
    header.innerHTML = isLive ? `<h1>Gi\u1ECF ${chainLabel(chain)} <small>\xB7 \u0111\u1ED3ng b\u1ED9 live</small></h1>` : `<h1>\u0110\u01A1n h\xE0ng \u2014 ${chainLabel(chain)} <small>\xB7 ${selectedCompleted ? "\u0111\xE3 \u0111\u1EB7t" : "\u0111\u01A1n d\u1EF1 th\u1EA3o"}</small></h1>`;
    sheet.append(header);
    if (isLive) {
      const liveNote = document.createElement("p");
      liveNote.className = "payment-note";
      liveNote.style.marginTop = "0";
      liveNote.textContent = `\u0110ang hi\u1EC3n th\u1ECB c\xE1c d\xF2ng \u0111\u01B0\u1EE3c ch\u1ECDn, s\u1ED1 l\u01B0\u1EE3ng v\xE0 gi\xE1 t\u1EEB gi\u1ECF ${chainLabel(chain)} (c\u1EADp nh\u1EADt khi b\u1EA1n \u0111\u1ED5i tr\xEAn trang).`;
      sheet.append(liveNote);
    }
    const info = document.createElement("section");
    info.className = "info-section";
    info.innerHTML = `<h2>TH\xD4NG TIN GIAO/NH\u1EACN H\xC0NG</h2>`;
    info.append(
      fieldRow("H\u1ECD t\xEAn", buyerName === "\u2014" ? "" : buyerName),
      fieldRow("S\u1ED1 \u0111i\u1EC7n tho\u1EA1i / Zalo", buyerPhone === "\u2014" ? "" : buyerPhone),
      fieldRow("Email", buyerEmail),
      fieldRow("\u0110\u1ECBa ch\u1EC9 giao h\xE0ng", buyerAddress === "\u2014" ? "" : buyerAddress),
      fieldRow("M\xE3 ZIP", buyerZip)
    );
    sheet.append(info);
    const storeSec = document.createElement("section");
    storeSec.className = "store-section";
    storeSec.innerHTML = isLive ? `<h2>GI\u1ECE H\xC0NG ${chainLabel(chain).toUpperCase()} (\u0110\u1ED2NG B\u1ED8)</h2>` : `<h2>\u0110\u01A0N THEO C\u1EECA H\xC0NG</h2>`;
    const card = document.createElement("div");
    card.className = "store-card";
    const nameRow = document.createElement("div");
    nameRow.className = "store-name-row";
    const storeDisplayName = storeCardTitle(storeName, branch, chain);
    const realBranch = branch && !isGenericOnlineLabel(branch) && branch !== storeDisplayName ? branch : "";
    nameRow.innerHTML = `
    <span class="store-logo" aria-hidden="true" style="background: ${CHAIN_LOGO[chain.toLowerCase()]?.color || "#071eb4"};">
      <p class="store-logo-text">${CHAIN_LOGO[chain.toLowerCase()]?.label || chain}</p>
    </span>
    <div><strong>${storeDisplayName}</strong>${realBranch ? `<span class="store-branch">${realBranch}</span>` : ""}<span class="store-detail-state ${selectedTabState}">${storeTabStatusText(selectedTabState)}</span></div>
  `;
    card.append(nameRow);
    const list = document.createElement("div");
    list.className = "order-items";
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "order-items-empty";
      empty.textContent = "Ch\u01B0a c\xF3 s\u1EA3n ph\u1EA9m n\xE0o \u0111\u01B0\u1EE3c ch\u1ECDn trong gi\u1ECF h\xE0ng.";
      list.append(empty);
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "order-item";
      const thumb = document.createElement("span");
      thumb.className = "item-thumb";
      const imageSrc = panelDisplayImageSrc(item.image);
      if (imageSrc) {
        const img = document.createElement("img");
        img.src = imageSrc;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => {
          thumb.textContent = "\u{1F6CD}\uFE0F";
        }, { once: true });
        thumb.append(img);
      } else {
        thumb.textContent = "\u{1F6CD}\uFE0F";
      }
      const copy = document.createElement("div");
      copy.className = "item-copy";
      const nm = document.createElement("strong");
      nm.textContent = item.name;
      copy.append(nm);
      const qty = document.createElement("span");
      qty.className = "item-qty";
      qty.textContent = `\xD7${item.qty}`;
      const price = document.createElement("strong");
      price.className = "item-price";
      price.textContent = money(item.lineTotal ?? (item.unitPrice || 0) * item.qty);
      row.append(thumb, copy, qty, price);
      list.append(row);
    }
    card.append(list);
    const storeTotal = document.createElement("div");
    storeTotal.className = "store-total";
    storeTotal.innerHTML = `<strong>T\u1ED5ng \u0111\u01A1n</strong><strong>${money(total)}</strong>`;
    card.append(storeTotal);
    const shipNote = document.createElement("p");
    shipNote.textContent = "\u{1F6F5} T\u1ED5ng thanh to\xE1n ch\u01B0a bao g\u1ED3m ph\xED v\u1EADn chuy\u1EC3n \u2014 c\xF3 th\u1EC3 thay \u0111\u1ED5i khi \u0111\u1EB7t \u0111\u01A1n.";
    card.append(shipNote);
    if (selectedStatusText) {
      const st = document.createElement("span");
      st.className = `order-status${selectedIsCurrent && statusClass ? ` ${statusClass}` : ""}`;
      st.textContent = selectedStatusText;
      card.append(st);
    }
    if (errorDetail) {
      const detail = document.createElement("div");
      detail.className = "connection-error-detail";
      const text = document.createElement("code");
      text.textContent = errorDetail;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-button";
      copy.textContent = "Sao ch\xE9p l\u1ED7i";
      copy.setAttribute("aria-label", "Sao ch\xE9p chi ti\u1EBFt l\u1ED7i k\u1EBFt n\u1ED1i");
      attachCopy(copy, errorDetail);
      detail.append(text, copy);
      card.append(detail);
    }
    storeSec.append(card);
    sheet.append(storeSec);
    const payNote = document.createElement("p");
    payNote.className = "payment-note";
    payNote.innerHTML = `\u{1F4B3} Thanh to\xE1n: <strong>${pay}</strong> \u2014 B\u1EA1n ch\u1ECDn v\xE0 th\u1EF1c hi\u1EC7n thanh to\xE1n tr\xEAn website nh\xE0 b\xE1n. Zapee kh\xF4ng thu th\u1EADp th\xF4ng tin thanh to\xE1n.`;
    sheet.append(payNote);
    if (entryUrl) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "open-btn";
      open.textContent = "M\u1EDF trang \u0111\u1EB7t h\xE0ng";
      open.addEventListener("click", () => {
        void chrome.tabs.create({ url: entryUrl });
      });
      sheet.append(open);
    }
    root2.append(sheet);
  }
  function renderPending(root2, sessionId, payload, chain, entryUrl) {
    if (currentSessionId !== sessionId) selectedStoreKey = String(payload.storeKey || "") || null;
    currentSessionId = sessionId;
    renderOrderSheet(root2, {
      chain,
      payload: withLiveCart(payload, sessionId),
      statusText: "\u25CF \u0110\u01A1n d\u1EF1 th\u1EA3o s\u1EB5n s\xE0ng \u2014 \u0111ang ch\u1EDD t\u1EA3i trang c\u1EEDa h\xE0ng",
      statusClass: "warn",
      entryUrl
    });
  }
  function renderActive(root2, status) {
    if (currentSessionId !== status.sessionId) selectedStoreKey = String(status.payload.storeKey || "") || null;
    currentSessionId = status.sessionId;
    const payload = withLiveCart(status.payload, status.sessionId);
    if (!hasOrderInfo(payload)) {
      currentSessionId = status.sessionId;
      if (!shouldPaint(root2, panelRenderKey({ mode: "guidance", sessionId: status.sessionId, statusText: status.chain }))) return;
      root2.replaceChildren();
      root2.append(brandHeader(null));
      const empty = document.createElement("section");
      empty.className = "empty-state";
      empty.innerHTML = `
      <strong>\u0110ang h\u01B0\u1EDBng d\u1EABn tr\xEAn ${chainLabel(status.chain)}</strong>
      <p>Phi\xEAn manual kh\xF4ng c\xF3 \u0111\u01A1n d\u1EF1 th\u1EA3o \u2014 l\xE0m theo bong b\xF3ng tr\u1EE3 l\xFD tr\xEAn trang b\xE1n h\xE0ng.</p>
    `;
      root2.append(empty);
      return;
    }
    const lastLog = status.log?.length ? status.log[status.log.length - 1] : "";
    const isLive = Boolean(payload.liveCartSource);
    renderOrderSheet(root2, {
      chain: status.chain,
      payload,
      // Single status under Tổng đơn only (no second progress block).
      statusText: isLive ? `\u25CF \u0110\xE3 \u0111\u1ED3ng b\u1ED9 gi\u1ECF ${chainLabel(status.chain)}` : lastLog ? `\u25CF ${lastLog}` : "\u25CF \u0110ang h\u1ED7 tr\u1EE3 tr\xEAn tab c\u1EEDa h\xE0ng",
      sessionId: status.sessionId,
      orderCompleted: status.orderCompleted
    });
  }
  function renderConnectionFailure(root2, failure) {
    currentSessionId = failure.sessionId;
    const payload = withLiveCart(failure.payload, failure.sessionId);
    const detail = `M\xE3: ${failure.code}
L\xFD do: ${failure.reason}
Gateway: ${failure.endpoint}`;
    if (hasOrderInfo(payload)) {
      renderOrderSheet(root2, {
        chain: failure.chain,
        payload,
        statusText: `\u25CF K\u1EBFt n\u1ED1i th\u1EA5t b\u1EA1i \u2014 ${failure.message}`,
        statusClass: "error",
        errorDetail: detail
      });
      return;
    }
    if (!shouldPaint(root2, panelRenderKey({ mode: "error", sessionId: failure.sessionId, errorDetail: detail }))) return;
    root2.replaceChildren();
    root2.append(brandHeader(null));
    const empty = document.createElement("section");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = "Kh\xF4ng k\u1EBFt n\u1ED1i \u0111\u01B0\u1EE3c Agent Server";
    const text = document.createElement("p");
    text.textContent = failure.message;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "open-btn secondary";
    copy.textContent = "Sao ch\xE9p chi ti\u1EBFt l\u1ED7i";
    attachCopy(copy, detail);
    empty.append(title, text, copy);
    root2.append(empty);
  }
  async function refresh(root2) {
    try {
      activeLiveCart = await getCoopLiveCart();
    } catch {
      activeLiveCart = null;
    }
    let active = await queryActiveSession();
    if (active) {
      renderActive(root2, active);
      return;
    }
    active = await claimPendingIfTabMatches();
    if (active) {
      renderActive(root2, active);
      return;
    }
    const [pending] = await getAllPendingHandoffs();
    if (pending) {
      renderPending(root2, pending.sessionId, pending.payload, pending.chain, pending.entryUrl);
      return;
    }
    try {
      const { getActiveHandoff: getActiveHandoff2 } = await Promise.resolve().then(() => (init_session_store(), session_store_exports));
      const durable = await getActiveHandoff2();
      if (durable?.payload) {
        const payload = withLiveCart(durable.payload, durable.sessionId);
        renderOrderSheet(root2, {
          chain: durable.chain,
          payload,
          statusText: payload.liveCartSource ? `\u25CF \u0110\xE3 \u0111\u1ED3ng b\u1ED9 gi\u1ECF ${chainLabel(durable.chain)}` : "\u25CF \u0110\u01A1n c\xF2n \u2014 \u0111ang n\u1ED1i l\u1EA1i phi\xEAn (add-cart / checkout)",
          statusClass: payload.liveCartSource ? void 0 : "warn",
          sessionId: durable.sessionId,
          orderCompleted: durable.orderCompleted
        });
        void claimPendingIfTabMatches();
        return;
      }
    } catch {
    }
    const failure = await getAgentConnectionFailure();
    if (failure) {
      renderConnectionFailure(root2, failure);
      return;
    }
    renderIdle(root2);
  }
  var root = document.getElementById("root");
  if (root) {
    void refresh(root);
    let refreshTimer = null;
    const scheduleRefresh = (delayMs = 160) => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refresh(root);
      }, delayMs);
    };
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "zapee_session_update") {
        currentSessionId = message.sessionId;
        scheduleRefresh(80);
      } else if (message?.type === "zapee_connection_failure_saved") {
        scheduleRefresh(80);
      }
    });
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged?.addListener) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "session") return;
        if (!changes.coopLiveCart && !changes.agentConnectionFailure) return;
        if (changes.coopLiveCart) {
          const next = changes.coopLiveCart.newValue || null;
          if (next?.sessionId && currentSessionId && next.sessionId !== currentSessionId) return;
          activeLiveCart = next;
        }
        scheduleRefresh(80);
      });
    }
    chrome.tabs.onActivated.addListener(() => {
      scheduleRefresh(200);
    });
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (info.status !== "complete") return;
      void getSidePanelActiveTab().then((tab) => {
        if (tab?.id === tabId) scheduleRefresh(200);
      });
    });
  }
})();
