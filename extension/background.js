"use strict";
// background.js — bản iOS Safari (viết lại từ bản Chrome, xem PORTING.md).
//
// Trên Chrome, service worker này sở hữu WebSocket phiên, mở/điều khiển tab,
// side panel và nhận message ngoài (externally_connectable). Safari trên iOS
// tắt service worker rất sớm và không có các API đó, nên phiên WebSocket giờ
// sống trong session-engine.js (content script). Background chỉ còn là
// coordinator không trạng thái quanh chrome.storage:
//
//   - storage.session: pendingHandoff:<chain>, activeOrderHandoff, coopLiveCart,
//     agentConnectionFailure, controlSurfaceEvents (hàng đợi sự kiện trả về trang)
//   - fetch cần cross-origin: /api/check-support, /api/agent/token,
//     terminals-by-address (enrich Co.op)
//   - xác thực origin control-surface cho message tới từ bridge-content.js
//
// Mọi handler đều idempotent và không giữ state trong bộ nhớ — service worker
// có thể bị Safari kill giữa hai message mà không mất gì.

// ---------------------------------------------------------------- config
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
var DEFAULT_ZAPEE_WEB_APP_URL = buildZapeeWebAppUrl || "https://zapee.timdaythay.com";

// ------------------------------------------------------------- chẩn đoán
// Bản iOS có 4 file viết riêng (background/session-engine/bridge/page-bridge) mà
// trên iPad thì KHÔNG có cách nào xem log nếu không nối cáp vào máy Mac. Tầng này
// gom "chuyện gì đã xảy ra" vào chrome.storage.session để popup đọc lại và người
// dùng copy gửi đi — xem mục "Màn chẩn đoán" trong PORTING.md.
//
// Ràng buộc:
//   - background là NGƯỜI GHI DUY NHẤT (content script gửi qua zapee_diag_log /
//     zapee_diag_state) để hai content script cùng ghi không đè nhau.
//   - Vòng đệm có chặn trên, không để phình storage.session.
//   - KHÔNG BAO GIỜ ghi token/OTP/thông tin thanh toán — chỉ ok/status/lỗi.
var DIAG_LOG_KEY = "zapeeDiagLog";
var DIAG_STATE_KEY = "zapeeDiagState";
var DIAG_LOG_MAX = 140;

function diagSafe(value) {
  // Chống lộ bí mật: cắt chuỗi dài và loại các khoá nhạy cảm nếu lỡ truyền vào.
  const SECRET = /token|otp|password|secret|authorization|cookie|card|cvv/i;
  const walk = (v, depth) => {
    if (v === null || v === void 0) return v;
    if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…(+${v.length - 300})` : v;
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (depth > 3) return "…";
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => walk(x, depth + 1));
    if (typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v).slice(0, 30)) {
        out[k] = SECRET.test(k) ? "«đã ẩn»" : walk(val, depth + 1);
      }
      return out;
    }
    return String(v);
  };
  return walk(value, 0);
}

async function diagLog(src, msg, extra) {
  try {
    const entry = { t: new Date().toISOString(), src, msg };
    if (extra !== void 0) entry.x = diagSafe(extra);
    const data = await chrome.storage.session.get(DIAG_LOG_KEY);
    const log = Array.isArray(data?.[DIAG_LOG_KEY]) ? data[DIAG_LOG_KEY] : [];
    log.push(entry);
    await chrome.storage.session.set({
      [DIAG_LOG_KEY]: log.length > DIAG_LOG_MAX ? log.slice(log.length - DIAG_LOG_MAX) : log
    });
  } catch {
  }
}

async function diagSet(patch) {
  try {
    const data = await chrome.storage.session.get(DIAG_STATE_KEY);
    const state = data?.[DIAG_STATE_KEY] && typeof data[DIAG_STATE_KEY] === "object" ? data[DIAG_STATE_KEY] : {};
    await chrome.storage.session.set({
      [DIAG_STATE_KEY]: { ...state, ...diagSafe(patch), updatedAt: new Date().toISOString() }
    });
  } catch {
  }
}

async function diagRead() {
  try {
    const data = await chrome.storage.session.get([DIAG_LOG_KEY, DIAG_STATE_KEY]);
    return {
      log: Array.isArray(data?.[DIAG_LOG_KEY]) ? data[DIAG_LOG_KEY] : [],
      state: data?.[DIAG_STATE_KEY] || {},
      storageSession: true
    };
  } catch (err) {
    // storage.session không dùng được (Safari < 16.4) là một kết luận chẩn đoán,
    // không phải lỗi cần che.
    return { log: [], state: {}, storageSession: false, storageError: String(err?.message || err) };
  }
}

async function getAgentServerHttpUrl() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get("agentServerUrl");
      if (data?.agentServerUrl && typeof data.agentServerUrl === "string" && data.agentServerUrl.trim()) {
        return parseAgentServerUrls(data.agentServerUrl).httpUrl;
      }
    } catch {
    }
  }
  return DEFAULT_AGENT_SERVER_HTTP_URL;
}
async function getZapeeWebAppUrl() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get("zapeeWebAppUrl");
      if (data?.zapeeWebAppUrl && typeof data.zapeeWebAppUrl === "string" && data.zapeeWebAppUrl.trim()) {
        return data.zapeeWebAppUrl.trim().replace(/\/+$/, "");
      }
    } catch {
    }
  }
  return DEFAULT_ZAPEE_WEB_APP_URL;
}

// ---------------------------------------------------------- session-store
// Giữ nguyên khóa và TTL của bản Chrome; bỏ preparedHandoffTab:* (đa tab).
var TTL_MS = 10 * 60 * 1e3;
function keyFor(chain) {
  return `pendingHandoff:${chain}`;
}
async function savePendingHandoff(handoff, zapeeTabId) {
  const key = keyFor(handoff.chain);
  const stored = { ...handoff, receivedAt: Date.now(), zapeeTabId };
  await chrome.storage.session.set({ [key]: stored });
}
async function clearPendingHandoff(chain) {
  await chrome.storage.session.remove(keyFor(chain));
}
async function replaceOrderHandoff(handoff, zapeeTabId) {
  const all = await chrome.storage.session.get(null);
  const staleKeys = Object.keys(all).filter((key) => key.startsWith("pendingHandoff:"));
  // Xóa cả hàng đợi sự kiện của phiên trước — TTL của nó (30') dài hơn TTL
  // handoff (10'), nếu giữ lại thì đơn mới có thể nhận replay order-completed cũ.
  staleKeys.push(ACTIVE_KEY, LIVE_CART_KEY, CONNECTION_FAILURE_KEY, CONTROL_SURFACE_EVENTS_KEY);
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
var ACTIVE_KEY = "activeOrderHandoff";
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
var LIVE_CART_KEY = "coopLiveCart";
var CONNECTION_FAILURE_KEY = "agentConnectionFailure";
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

// -------------------------------------- hàng đợi sự kiện cho trang Zapee (B3)
// Single-tab: tab trang Zapee thường đã điều hướng sang trang bán lẻ, không còn
// sống để nhận tabs.sendMessage — sự kiện (order-completed, continue-next-store)
// được xếp hàng ở đây, bridge-content.js rút về khi trang Zapee nạp lại.
var CONTROL_SURFACE_EVENTS_KEY = "controlSurfaceEvents";
var CONTROL_SURFACE_EVENTS_MAX = 20;
var CONTROL_SURFACE_EVENTS_TTL_MS = 30 * 60 * 1e3;
async function queueControlSurfaceEvent(event) {
  const result = await chrome.storage.session.get(CONTROL_SURFACE_EVENTS_KEY);
  const now = Date.now();
  const existing = Array.isArray(result[CONTROL_SURFACE_EVENTS_KEY]) ? result[CONTROL_SURFACE_EVENTS_KEY] : [];
  const fresh = existing.filter((item) => now - (item?.queuedAt || 0) <= CONTROL_SURFACE_EVENTS_TTL_MS);
  fresh.push({ ...event, queuedAt: now });
  while (fresh.length > CONTROL_SURFACE_EVENTS_MAX) fresh.shift();
  await chrome.storage.session.set({ [CONTROL_SURFACE_EVENTS_KEY]: fresh });
}
async function drainControlSurfaceEvents() {
  const result = await chrome.storage.session.get(CONTROL_SURFACE_EVENTS_KEY);
  const now = Date.now();
  const existing = Array.isArray(result[CONTROL_SURFACE_EVENTS_KEY]) ? result[CONTROL_SURFACE_EVENTS_KEY] : [];
  await chrome.storage.session.remove(CONTROL_SURFACE_EVENTS_KEY);
  return existing.filter((item) => now - (item?.queuedAt || 0) <= CONTROL_SURFACE_EVENTS_TTL_MS);
}

// ------------------------------------------------- origin control-surface (B1)
// Safari không hỗ trợ externally_connectable — danh sách origin giữ thành hằng,
// đồng bộ với bridge-content.js và content_scripts.matches trong manifest.
var CONTROL_SURFACE_MATCHES = [
  "http://localhost:3000/*",
  "http://localhost:3002/*",
  "http://zapee.test/*",
  "http://*.zapee.test/*",
  "https://gia-quanh-day.vercel.app/*",
  "https://*.timdaythay.com/*",
  "https://*.zapee.one/*"
];
function matchesManifestOriginPattern(url, pattern) {
  if (!url) return false;
  try {
    const candidate = new URL(url);
    if (pattern === "<all_urls>") {
      return ["http:", "https:", "file:"].includes(candidate.protocol);
    }
    // KHÔNG parse pattern bằng new URL(): trong browser thật (WebKit/Blink),
    // new URL("https://*.timdaythay.com/*") percent-encode hostname thành
    // "%2A.timdaythay.com" nên check startsWith("*.") không bao giờ đúng và
    // MỌI origin wildcard bị từ chối lặng lẽ. Bug không lộ trong test Node vì
    // Node giữ nguyên "*". Pattern được tách bằng regex: scheme://host[:port][/path].
    const parsed = /^(\*|https?|file):\/\/([^\/]*)(?:\/.*)?$/.exec(pattern);
    if (!parsed) return false;
    const scheme = parsed[1];
    if (scheme === "*") {
      if (!["http:", "https:"].includes(candidate.protocol)) return false;
    } else if (candidate.protocol !== `${scheme}:`) {
      return false;
    }
    const hostPort = parsed[2];
    const colonAt = hostPort.lastIndexOf(":");
    const patternHost = (colonAt >= 0 ? hostPort.slice(0, colonAt) : hostPort).toLowerCase();
    const patternPort = colonAt >= 0 ? hostPort.slice(colonAt + 1) : "";
    const candidateHost = candidate.hostname.toLowerCase();
    const hostMatches = patternHost === "*" || patternHost === candidateHost || patternHost.startsWith("*.") && (candidateHost === patternHost.slice(2) || candidateHost.endsWith(`.${patternHost.slice(2)}`));
    if (!hostMatches) return false;
    return !patternPort || patternPort === candidate.port;
  } catch {
    return false;
  }
}
function originOf(url) {
  if (!url) return null;
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}
function isManifestControlSurfaceUrl(url) {
  return CONTROL_SURFACE_MATCHES.some((pattern) => matchesManifestOriginPattern(url, pattern));
}
async function isZapeeControlSurfaceUrl(url) {
  const origin = originOf(url);
  if (!origin) return false;
  if (origin === originOf(await getZapeeWebAppUrl())) return true;
  return isManifestControlSurfaceUrl(url);
}
function senderUrlOf(sender) {
  return sender?.url || sender?.tab?.url || "";
}
async function senderIsControlSurface(sender) {
  return isZapeeControlSurfaceUrl(senderUrlOf(sender));
}

// ----------------------------------------------------------------- helpers
function hostOf(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}
function hostsMatch(entryUrl, tabUrl) {
  const a = hostOf(entryUrl);
  const b = hostOf(tabUrl);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
function isClassifiableHttpUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ------------------------------------------------------- check-support (giữ nguyên)
function fallbackCheckUrlSupport(url) {
  if (!url) return { supported: false };
  try {
    const hostname = new URL(url).hostname.replace("www.", "").toLowerCase();
    const knownKeys = [
      { key: "bachhoaxanh", chain: "bhx" },
      { key: "bhx", chain: "bhx" },
      { key: "cooponline", chain: "coop" },
      { key: "coop", chain: "coop" },
      { key: "shopee", chain: "shopee" },
      { key: "walmart", chain: "walmart" },
      { key: "wm", chain: "walmart" },
      { key: "pnj", chain: "pnj" },
      { key: "costco", chain: "costco" },
      { key: "premiumoutlets", chain: "premiumoutlets" },
      { key: "tuoixanhnhanhngon", chain: "tuoixanhnhanhngon" }
    ];
    for (const item of knownKeys) {
      if (hostname.includes(item.key)) {
        return { supported: true, chain: item.chain, entryUrl: url };
      }
    }
  } catch {
  }
  return { supported: false };
}
async function checkUrlSupport(url, expectedChain) {
  if (!url) return { supported: false };
  let supportProbeUrl;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { supported: false };
    supportProbeUrl = parsed.origin;
  } catch {
    return { supported: false };
  }
  const host = hostOf(url);
  // Chẩn đoán: đây là cửa ải quyết định launcher có hiện hay không, và mọi lỗi ở
  // đây đều bị nuốt (catch rỗng) — nên phải ghi lại nguyên nhân thật + thời gian.
  const probeStartedAt = Date.now();
  let probeUrlForDiag = "";
  try {
    const httpBaseUrl = await getAgentServerHttpUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2e3);
    const params = new URLSearchParams({ url: supportProbeUrl });
    if (expectedChain) params.set("chain", expectedChain);
    probeUrlForDiag = `${httpBaseUrl}/api/check-support?${params.toString()}`;
    const res = await fetch(probeUrlForDiag, {
      signal: controller.signal
    });
    clearTimeout(timer);
    void diagSet({
      supportCheck: {
        host,
        probeUrl: probeUrlForDiag,
        httpStatus: res.status,
        ms: Date.now() - probeStartedAt,
        at: new Date().toISOString()
      }
    });
    if (!res.ok) {
      void diagLog("bg", `check-support HTTP ${res.status}`, { host, ms: Date.now() - probeStartedAt });
    }
    if (res.ok) {
      const data = await res.json();
      if (data.supported && data.chain) {
        const normalizedExpected = String(expectedChain || "").toLowerCase();
        const normalizedActual = String(data.chain).toLowerCase();
        if (normalizedExpected && normalizedActual !== normalizedExpected) {
          return { supported: false };
        }
        if (host && typeof chrome !== "undefined" && chrome.storage?.local) {
          void chrome.storage.local.set({
            [`supported_host:${host}`]: data.chain,
            [`supported_observation_only:${host}`]: data.observationOnly === true
          });
        }
        return {
          supported: true,
          chain: data.chain,
          entryUrl: data.entryUrl || url,
          observationOnly: data.observationOnly === true
        };
      }
      void diagLog("bg", "check-support: server trả supported=false", { host });
      return { supported: false };
    }
  } catch (err) {
    // Timeout 2s hoặc lỗi mạng — nguyên nhân số 1 khiến launcher không hiện.
    const ms = Date.now() - probeStartedAt;
    const name = String(err?.name || "");
    const reason = name === "AbortError" ? `TIMEOUT sau ${ms}ms (giới hạn 2000ms)` : `${name || "Error"}: ${String(err?.message || err)}`;
    void diagSet({
      supportCheck: { host, probeUrl: probeUrlForDiag, error: reason, ms, at: new Date().toISOString() }
    });
    void diagLog("bg", `check-support THẤT BẠI — ${reason}`, { host });
  }
  if (host && typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const cached = await chrome.storage.local.get([
        `supported_host:${host}`,
        `supported_observation_only:${host}`
      ]);
      const chain = cached[`supported_host:${host}`];
      if (chain && (!expectedChain || chain.toLowerCase() === expectedChain.toLowerCase())) {
        return {
          supported: true,
          chain,
          entryUrl: url,
          observationOnly: cached[`supported_observation_only:${host}`] === true
        };
      }
    } catch {
    }
  }
  const fallback = fallbackCheckUrlSupport(url);
  if (expectedChain && fallback.supported && fallback.chain?.toLowerCase() !== expectedChain.toLowerCase()) {
    return { supported: false };
  }
  return fallback;
}

// ------------------------------------------------------- token & enrich (giữ nguyên)
async function refreshHandoffToken(handoff) {
  try {
    const webAppUrl = await getZapeeWebAppUrl();
    const endpoint = new URL("/api/agent/token", webAppUrl);
    endpoint.searchParams.set("sessionId", handoff.sessionId);
    endpoint.searchParams.set("chain", handoff.chain);
    const response = await fetch(endpoint.toString(), { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    const token = String(data.token || "");
    const timestamp = Number(data.timestamp);
    if (!token || !Number.isFinite(timestamp)) return null;
    return { ...handoff, token, timestamp, receivedAt: Date.now() };
  } catch {
    return null;
  }
}
async function issueStandaloneHandoff(url) {
  const support = await checkUrlSupport(url);
  if (!support.supported || !support.chain) return null;
  const chain = support.chain;
  const entryUrl = support.entryUrl || url || "";
  const sessionId = `cbs-${chain}-standalone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const webAppUrl = await getZapeeWebAppUrl();
    const res = await fetch(`${webAppUrl}/api/agent/token?sessionId=${sessionId}&chain=${chain}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.token || !data.timestamp) return null;
    return {
      type: "zapee_order_handoff",
      sessionId,
      chain,
      token: data.token,
      timestamp: data.timestamp,
      execMode: "manual",
      entryUrl,
      payload: { chain },
      receivedAt: Date.now()
    };
  } catch {
    return null;
  }
}
async function enrichCoopHandoffCheckout(handoff) {
  const chain = String(handoff.chain || "").toLowerCase();
  if (chain !== "coop" && chain !== "cop") return handoff;
  let payload = handoff.payload || {};
  const shippingAddress = payload.shippingAddress && typeof payload.shippingAddress === "object" ? payload.shippingAddress : void 0;
  const address = String(
    shippingAddress?.fullAddress || shippingAddress?.addressLine || payload.buyerAddress || payload.address || ""
  ).trim();
  if (!shippingAddress && address) {
    payload = {
      ...payload,
      shippingAddress: {
        name: String(payload.buyerName || payload.name || ""),
        phone: String(payload.buyerPhone || payload.phone || ""),
        email: String(payload.buyerEmail || payload.email || ""),
        addressLine: address,
        fullAddress: address
      }
    };
  }
  const existing = payload.storeContext || payload.checkout;
  if (existing?.terminalCode) return { ...handoff, payload };
  if (!address) return handoff;
  try {
    const url = new URL("https://consumer-bff.tekoapis.com/api/v1/terminals-by-address");
    url.searchParams.set("fullAddress", address);
    url.searchParams.set("platformId", "2295");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "Accept-Language": "vi" },
      cache: "no-store"
    });
    if (!res.ok) {
      return {
        ...handoff,
        payload: {
          ...payload,
          storeContext: { ...existing || {}, locationResolveError: `terminal_lookup_http_${res.status}` },
          checkout: { ...existing || {}, locationResolveError: `terminal_lookup_http_${res.status}` }
        }
      };
    }
    const raw = await res.json();
    const list = raw?.data?.terminals || raw?.result?.terminals || [];
    const selected = Array.isArray(list) ? list[0] : null;
    const code = String(selected?.terminalCode || selected?.code || "").trim();
    if (!selected || !code) {
      return {
        ...handoff,
        payload: {
          ...payload,
          storeContext: { ...existing || {}, locationResolveError: "terminal_lookup_empty" },
          checkout: { ...existing || {}, locationResolveError: "terminal_lookup_empty" }
        }
      };
    }
    return {
      ...handoff,
      payload: {
        ...payload,
        buyer: payload.buyer || {
          name: payload.buyerName,
          phone: payload.buyerPhone,
          address
        },
        storeContext: {
          terminalCode: code,
          terminalId: String(selected.terminalId ?? selected.id ?? ""),
          terminalName: String(selected.terminalName ?? selected.name ?? ""),
          terminalAddress: String(selected.fullAddress ?? selected.address ?? ""),
          siteId: String(selected.siteId ?? ""),
          provinceCode: String(selected.provinceCode ?? ""),
          lat: selected.lat != null ? Number(selected.lat) : void 0,
          lng: selected.lng != null ? Number(selected.lng) : selected.long != null ? Number(selected.long) : void 0,
          terminals: list.slice(0, 20),
          locationResolveError: ""
        },
        // Compatibility alias while existing recipes migrate.
        checkout: {
          terminalCode: code,
          terminalId: selected.terminalId ?? selected.id ?? "",
          terminalName: selected.terminalName ?? selected.name ?? "",
          terminalAddress: selected.fullAddress ?? selected.address ?? "",
          siteId: selected.siteId ?? "",
          provinceCode: selected.provinceCode ?? "",
          addressLine: address,
          lat: selected.lat != null ? Number(selected.lat) : void 0,
          lng: selected.lng != null ? Number(selected.lng) : selected.long != null ? Number(selected.long) : void 0,
          terminals: list.slice(0, 20),
          locationResolveError: ""
        }
      }
    };
  } catch (err) {
    return {
      ...handoff,
      payload: {
        ...payload,
        storeContext: {
          ...existing || {},
          locationResolveError: err instanceof Error ? err.message : "terminal_lookup_failed"
        },
        checkout: {
          ...existing || {},
          locationResolveError: err instanceof Error ? err.message : "terminal_lookup_failed"
        }
      }
    };
  }
}

// ----------------------------------------------- boot cho session-engine (B3)
async function resolveEngineBoot(url, tabId) {
  const webAppUrl = await getZapeeWebAppUrl();
  if (!isClassifiableHttpUrl(url) || await isZapeeControlSurfaceUrl(url)) {
    return { action: "none", webAppUrl };
  }
  // 1) Claim pending handoff nếu URL khớp host entryUrl/navigationUrl.
  const pending = await getAllPendingHandoffs();
  const match = pending.find(
    (handoff) => hostsMatch(handoff.entryUrl, url) || handoff.navigationUrl && hostsMatch(handoff.navigationUrl, url)
  );
  if (match) {
    await clearPendingHandoff(match.chain);
    await clearAgentConnectionFailure();
    const support = await checkUrlSupport(url, match.chain);
    const enriched = await enrichCoopHandoffCheckout(match);
    const handoff = { ...enriched, receivedAt: match.receivedAt || Date.now() };
    await saveActiveHandoff(handoff, tabId);
    return {
      action: "claim",
      handoff,
      observationOnly: support.observationOnly === true,
      webAppUrl
    };
  }
  // 2) Nối lại phiên đang hoạt động (trang bán lẻ điều hướng/reload).
  const active = await getActiveHandoff();
  if (active) {
    const ageMs = Date.now() - (active.receivedAt || active.timestamp || 0);
    if (ageMs > 30 * 60 * 1e3) {
      await clearActiveHandoff();
      return { action: "none", webAppUrl };
    }
    const sameTab = typeof active.tabId === "number" && typeof tabId === "number" ? active.tabId === tabId : hostsMatch(active.entryUrl, url) || active.navigationUrl && hostsMatch(active.navigationUrl, url);
    if (sameTab) {
      const support = await checkUrlSupport(url, active.chain);
      if (support.supported) {
        await clearAgentConnectionFailure();
        const refreshed = { ...active, receivedAt: Date.now() };
        await saveActiveHandoff(refreshed, tabId);
        return {
          action: "resume",
          handoff: refreshed,
          observationOnly: support.observationOnly === true,
          webAppUrl
        };
      }
    }
  }
  return { action: "none", webAppUrl };
}

// ------------------------------------------------------ self-test chẩn đoán
// Popup gọi qua zapee_diag_selftest. Khác checkUrlSupport ở hai điểm cố ý:
//   - timeout rộng (8s) để phân biệt "mạng CHẬM" với "không tới được" — nếu ở đây
//     mất 3s thì check-support (giới hạn 2s) chắc chắn trượt dù server vẫn sống;
//   - không nuốt lỗi: trả nguyên tên/thông điệp lỗi cho người dùng copy đi.
async function diagProbe(label, url) {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8e3);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    let body = "";
    try {
      body = (await res.text()).slice(0, 200);
    } catch {
    }
    return { label, url, ok: res.ok, httpStatus: res.status, ms: Date.now() - startedAt, body };
  } catch (err) {
    const ms = Date.now() - startedAt;
    const name = String(err?.name || "Error");
    return {
      label,
      url,
      ok: false,
      ms,
      error: name === "AbortError" ? `TIMEOUT sau ${ms}ms (giới hạn 8000ms)` : `${name}: ${String(err?.message || err)}`
    };
  }
}

async function runDiagSelfTest(pageUrl) {
  const httpBaseUrl = await getAgentServerHttpUrl();
  const webAppUrl = await getZapeeWebAppUrl();
  let origin = "";
  try {
    origin = pageUrl ? new URL(pageUrl).origin : "";
  } catch {
  }
  const probes = [
    await diagProbe(
      "agent-server /api/check-support",
      `${httpBaseUrl}/api/check-support?url=${encodeURIComponent(origin || "https://cooponline.vn")}`
    ),
    await diagProbe("web app (gốc)", `${webAppUrl}/`)
  ];
  const result = {
    at: new Date().toISOString(),
    agentServerHttpUrl: httpBaseUrl,
    webAppUrl,
    pageOrigin: origin,
    probes
  };
  await diagSet({ selfTest: result });
  await diagLog("bg", "self-test xong", {
    ket_qua: probes.map((probe) => `${probe.label}: ${probe.ok ? `OK ${probe.httpStatus} (${probe.ms}ms)` : probe.error || `HTTP ${probe.httpStatus}`}`)
  });
  return { ok: true, result };
}

// ---------------------------------------------------------------- messages
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return void 0;
    const tabId = sender.tab?.id;

    switch (message.type) {
      // --------------------------------------------------------- chẩn đoán
      // Content script gửi nhật ký/heartbeat lên đây; popup đọc lại qua
      // zapee_diag_read. Background là người ghi duy nhất (xem tầng chẩn đoán).
      case "zapee_diag_log": {
        void diagLog(String(message.src || "?"), String(message.msg || ""), message.extra);
        return void 0;
      }
      case "zapee_diag_state": {
        void diagSet(message.patch && typeof message.patch === "object" ? message.patch : {});
        return void 0;
      }
      case "zapee_diag_read": {
        void diagRead().then(sendResponse).catch(() => sendResponse({ log: [], state: {}, storageSession: false }));
        return true;
      }
      case "zapee_diag_clear": {
        void chrome.storage.session.remove([DIAG_LOG_KEY, DIAG_STATE_KEY]).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
      }
      case "zapee_diag_selftest": {
        void runDiagSelfTest(String(message.url || "")).then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
        return true;
      }

      // ------------------------------------------ từ bridge-content.js (B1)
      case "zapee_ping": {
        sendResponse({ type: "zapee_pong" });
        return void 0;
      }
      case "zapee_order_handoff": {
        void (async () => {
          if (!await senderIsControlSurface(sender)) {
            sendResponse({ ok: false, error: "origin_not_allowed" });
            return;
          }
          const handoff = {
            ...message,
            receivedAt: Date.now(),
            // Luôn ghi đè field trùng tên từ payload ngoài.
            sourceTabId: typeof tabId === "number" ? tabId : void 0
          };
          await replaceOrderHandoff(handoff, tabId);
          // Single-tab trên iOS: extension KHÔNG mở tab — trang tự điều hướng
          // location.href = entryUrl sau khi nhận ok (xem hợp đồng PORTING.md).
          sendResponse({
            ok: true,
            claimedTabId: null,
            tabOwner: "page-navigation",
            entryUrl: handoff.entryUrl
          });
        })().catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
        return true;
      }
      case "zapee_prepare_retailer_tab": {
        // iOS không tạo được background tab (B3) — trang phải tự điều hướng.
        sendResponse({ ok: false, error: "prepare_unsupported_ios" });
        return void 0;
      }
      case "zapee_cancel_prepared_retailer_tab": {
        sendResponse({ ok: true });
        return void 0;
      }
      case "zapee_open_sidepanel_now": {
        // Panel là overlay trong tab bán lẻ, không cần gesture chuẩn bị trước.
        sendResponse({ ok: true, panel: "in-page" });
        return void 0;
      }
      case "zapee_drain_control_surface_events": {
        void (async () => {
          if (!await senderIsControlSurface(sender)) {
            sendResponse({ events: [] });
            return;
          }
          sendResponse({ events: await drainControlSurfaceEvents() });
        })().catch(() => sendResponse({ events: [] }));
        return true;
      }

      // ------------------------------------------------------ từ content.js
      case "zapee_content_ready": {
        void (async () => {
          const url = String(message.url || "");
          // content_ready TỚI ĐƯỢC ĐÂY = content.js đã chạy VÀ shim của
          // session-engine.js đã chuyển tiếp thành công. Ghi lại cả câu trả lời
          // vì đúng nó quyết định launcher hiện hay không.
          const answer = (res) => {
            void diagSet({
              contentReady: {
                url,
                host: hostOf(url),
                tabId: typeof tabId === "number" ? tabId : null,
                answered: res,
                at: new Date().toISOString()
              }
            });
            void diagLog("bg", `content_ready → supported=${res.supported === true}${res.chain ? ` chain=${res.chain}` : ""}`, { host: hostOf(url), reason: res.reason });
            delete res.reason;
            sendResponse(res);
          };
          if (await isZapeeControlSurfaceUrl(url)) {
            answer({ supported: false, reason: "url là control-surface của Zapee" });
            return;
          }
          const active = await getActiveHandoff();
          if (active && (typeof active.tabId === "number" && active.tabId === tabId || hostsMatch(active.entryUrl, url))) {
            // Mirror Chrome mới (sync 18/08): reply kèm sessionId khi tab có
            // phiên đang chạy — content.js mới chỉ boot UI phiên khi thấy nó.
            answer({ supported: true, chain: active.chain, sessionId: active.sessionId, reason: "khớp activeOrderHandoff" });
            return;
          }
          const pending = await getAllPendingHandoffs();
          const match = pending.find((handoff) => hostsMatch(handoff.entryUrl, url));
          if (match) {
            // Trả luôn sessionId của pending (phiên mà engine SẮP claim — cùng
            // record, cùng host): content.js mới deactivateOrderGuidance() vô
            // điều kiện khi reply thiếu sessionId, và reply này có thể về SAU
            // synthetic zapee_session_start của engine → giết guidance vừa
            // boot. Chrome không dính race vì claim xong mới trả lời;
            // setActiveOrderSession phía content idempotent nên trả trước an toàn.
            answer({ supported: true, chain: match.chain, sessionId: match.sessionId, reason: "khớp pendingHandoff" });
            return;
          }
          const support = await checkUrlSupport(url);
          answer({
            supported: support.supported === true,
            chain: support.chain,
            reason: support.supported === true ? "check-support OK" : "check-support nói không hỗ trợ (xem supportCheck)"
          });
        })().catch((err) => {
          void diagLog("bg", `content_ready NÉM LỖI: ${String(err?.message || err)}`);
          sendResponse({ supported: false });
        });
        return true;
      }

      // ------------------------------------------- từ session-engine.js (B4)
      case "zapee_engine_boot": {
        void resolveEngineBoot(String(message.url || ""), tabId).then(sendResponse).catch(() => sendResponse({ action: "none" }));
        return true;
      }
      case "zapee_engine_update": {
        void (async () => {
          const active = await getActiveHandoff();
          if (!active || active.sessionId !== message.sessionId) {
            sendResponse({ ok: false });
            return;
          }
          const next = { ...active };
          if (message.payload && typeof message.payload === "object") next.payload = message.payload;
          if (message.orderCompleted && typeof message.orderCompleted === "object") {
            next.orderCompleted = message.orderCompleted;
            next.receivedAt = Date.now();
          }
          await saveActiveHandoff(next, active.tabId);
          sendResponse({ ok: true });
        })().catch(() => sendResponse({ ok: false }));
        return true;
      }
      case "zapee_engine_live_cart": {
        void (async () => {
          const active = await getActiveHandoff();
          if (!active || active.sessionId !== message.sessionId || !message.cart) {
            sendResponse({ ok: false });
            return;
          }
          await saveCoopLiveCart(message.cart);
          if (message.payload && typeof message.payload === "object") {
            await saveActiveHandoff({ ...active, payload: message.payload, receivedAt: Date.now() }, active.tabId);
          }
          sendResponse({ ok: true });
        })().catch(() => sendResponse({ ok: false }));
        return true;
      }
      case "zapee_engine_session_ended": {
        void (async () => {
          const active = await getActiveHandoff();
          if (active?.sessionId === message.sessionId) {
            await Promise.all([
              clearActiveHandoff(),
              clearCoopLiveCart(),
              clearPendingHandoff(String(message.chain || active.chain || ""))
            ]);
          }
          sendResponse({ ok: true });
        })().catch(() => sendResponse({ ok: false }));
        return true;
      }
      case "zapee_save_failure": {
        void (async () => {
          if (message.failure && typeof message.failure === "object") {
            await Promise.all([
              clearActiveHandoff(),
              saveAgentConnectionFailure(message.failure)
            ]);
          }
          sendResponse({ ok: true });
        })().catch(() => sendResponse({ ok: false }));
        return true;
      }
      case "zapee_refresh_token": {
        void (async () => {
          const handoff = message.handoff && typeof message.handoff === "object" ? message.handoff : null;
          sendResponse({ handoff: handoff ? await refreshHandoffToken(handoff) : null });
        })().catch(() => sendResponse({ handoff: null }));
        return true;
      }
      case "zapee_standalone_token": {
        void (async () => {
          const handoff = await issueStandaloneHandoff(String(message.url || ""));
          if (handoff) {
            // Phải ghi activeOrderHandoff ngay: WebSocket sống trong content
            // script nên mỗi lần điều hướng full-page engine phải resume được
            // qua zapee_engine_boot — không có record này phiên standalone sẽ
            // chết ở lần điều hướng đầu tiên.
            await clearAgentConnectionFailure();
            await saveActiveHandoff(handoff, tabId);
          }
          sendResponse({ handoff });
        })().catch(() => sendResponse({ handoff: null }));
        return true;
      }
      case "zapee_check_support": {
        void checkUrlSupport(String(message.url || ""), message.chain ? String(message.chain) : void 0).then(sendResponse).catch(() => sendResponse({ supported: false }));
        return true;
      }
      case "zapee_engine_snapshot": {
        void (async () => {
          const [pending] = await getAllPendingHandoffs();
          const [active, liveCart, failure, webAppUrl] = await Promise.all([
            getActiveHandoff(),
            getCoopLiveCart(),
            getAgentConnectionFailure(),
            getZapeeWebAppUrl()
          ]);
          sendResponse({ pending: pending || null, active, liveCart, failure, webAppUrl });
        })().catch(() => sendResponse(null));
        return true;
      }
      case "zapee_control_surface_event": {
        void (async () => {
          const name = String(message.name || "");
          if (!name.startsWith("zapee:") || !message.message || typeof message.message.type !== "string") {
            sendResponse({ ok: false });
            return;
          }
          await queueControlSurfaceEvent({ name, detail: message.detail, message: message.message });
          // Best-effort: nếu tab trang Zapee gốc còn sống (iPad đa tab) thì đẩy
          // trực tiếp cho bridge của tab đó.
          const active = await getActiveHandoff();
          const sourceTabId = active?.sourceTabId ?? active?.zapeeTabId;
          if (typeof sourceTabId === "number" && sourceTabId !== tabId && chrome.tabs?.sendMessage) {
            try {
              await chrome.tabs.sendMessage(sourceTabId, message.message);
            } catch {
            }
          }
          sendResponse({ ok: true });
        })().catch(() => sendResponse({ ok: false }));
        return true;
      }
      case "zapee_progress_relay": {
        void (async () => {
          const active = await getActiveHandoff();
          const sourceTabId = active?.sourceTabId ?? active?.zapeeTabId;
          if (typeof sourceTabId === "number" && sourceTabId !== tabId && chrome.tabs?.sendMessage) {
            try {
              await chrome.tabs.sendMessage(sourceTabId, {
                type: "zapee_progress_event",
                ...message.progress && typeof message.progress === "object" ? message.progress : {}
              });
            } catch {
            }
          }
          sendResponse({ ok: true });
        })().catch(() => sendResponse({ ok: false }));
        return true;
      }

      // ------------------------------------------------- tương thích popup
      case "zapee_query_session": {
        void (async () => {
          const active = await getActiveHandoff();
          sendResponse(
            active ? {
              sessionId: active.sessionId,
              chain: active.chain,
              execMode: active.execMode,
              payload: active.payload,
              log: [],
              orderCompleted: active.orderCompleted
            } : null
          );
        })().catch(() => sendResponse(null));
        return true;
      }
      default:
        return void 0;
    }
  });
}

// Dọn state khi tab của phiên bị đóng (tabs API có trên iOS Safari, nhưng vẫn
// guard đầy đủ vì service worker có thể không nhận đủ sự kiện).
if (typeof chrome !== "undefined" && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void getActiveHandoff().then((active) => {
      if (!active || active.tabId !== tabId) return;
      return Promise.all([
        clearActiveHandoff(),
        clearCoopLiveCart(),
        clearPendingHandoff(active.chain)
      ]);
    });
  });
}
