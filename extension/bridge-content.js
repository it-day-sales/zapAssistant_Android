"use strict";
(() => {
  // bridge-content.js — cầu nối window.postMessage thay cho externally_connectable
  // (PORTING.md B1). Chỉ được khai báo trong manifest cho đúng các origin
  // control-surface của Zapee (danh sách CONTROL_SURFACE_MATCHES bên dưới).
  //
  // Hợp đồng với trang web (xem PORTING.md "Hợp đồng message"):
  //   TRANG → EXT : window.postMessage({ source: "zapee-web", requestId, payload }, origin)
  //   EXT → TRANG : window.postMessage({ source: "zapee-extension", requestId, response }, origin)
  // Ngoài ra extension chủ động đẩy sự kiện (zapee_order_completed,
  // zapee_continue_next_store, zapee_progress_event) về trang qua cả hai kênh:
  // postMessage {source:"zapee-extension", ...message} và CustomEvent MAIN-world.
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;

  // Bản sao danh sách externally_connectable.matches của bản Chrome — Safari
  // không đọc được key này từ manifest nên giữ thành hằng (PORTING.md B1.3).
  var CONTROL_SURFACE_MATCHES = [
    "http://localhost:3000/*",
    "http://localhost:3002/*",
    "http://zapee.test/*",
    "http://*.zapee.test/*",
    "https://gia-quanh-day.vercel.app/*",
    "https://*.timdaythay.com/*",
    "https://*.zapee.one/*"
  ];

  // Cùng ngữ nghĩa với matchesManifestOriginPattern của bản Chrome (background.js L322).
  function matchesOriginPattern(url, pattern) {
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

  function isAllowedOrigin(origin) {
    return CONTROL_SURFACE_MATCHES.some((pattern) => matchesOriginPattern(origin, pattern));
  }

  // 5 message type ngoài + type dò hỏi; mọi type khác từ trang bị bỏ qua.
  var ALLOWED_INBOUND_TYPES = new Set([
    "zapee_ping",
    "zapee_open_sidepanel_now",
    "zapee_prepare_retailer_tab",
    "zapee_cancel_prepared_retailer_tab",
    "zapee_order_handoff"
  ]);

  function postToPage(payload) {
    try {
      window.postMessage(payload, window.location.origin);
    } catch {
    }
  }

  // ------------------------------------------------- MAIN-world bridge helper
  var MAIN_REQUEST_SOURCE = "zapee-ext-bridge";
  var MAIN_RESPONSE_SOURCE = "zapee-page-bridge";
  var mainPending = new Map();
  var mainInjected = false;
  var mainRequestSeq = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== MAIN_RESPONSE_SOURCE || typeof data.requestId !== "string") return;
    const entry = mainPending.get(data.requestId);
    if (!entry) return;
    mainPending.delete(data.requestId);
    window.clearTimeout(entry.timer);
    entry.resolve(data.response);
  });

  function mainBridgePost(cmd, fields, timeoutMs) {
    return new Promise((resolve) => {
      const requestId = `zpb-${Date.now()}-${mainRequestSeq += 1}`;
      const timer = window.setTimeout(() => {
        mainPending.delete(requestId);
        resolve(null);
      }, timeoutMs);
      mainPending.set(requestId, { resolve, timer });
      try {
        window.postMessage({ source: MAIN_REQUEST_SOURCE, cmd, requestId, ...fields }, window.location.origin);
      } catch {
        mainPending.delete(requestId);
        window.clearTimeout(timer);
        resolve(null);
      }
    });
  }

  function injectMainBridgeScript() {
    if (mainInjected) return;
    mainInjected = true;
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("page-bridge-main.js");
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
      script.addEventListener("load", () => script.remove());
    } catch {
    }
  }

  async function ensureMainBridge() {
    if (await mainBridgePost("ping", {}, 300)) return true;
    // Safari cũ có thể không hỗ trợ content script world MAIN — thử inject
    // page-bridge-main.js qua <script> tag (best-effort, có thể vướng CSP trang).
    injectMainBridgeScript();
    return Boolean(await mainBridgePost("ping", {}, 700));
  }

  async function dispatchPageEvent(name, detail) {
    if (!await ensureMainBridge()) return;
    void mainBridgePost("dispatch_event", { name, detail }, 1500);
  }

  // ------------------------------------------------------- trang → extension
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!isAllowedOrigin(event.origin) || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "zapee-web") return;
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    const payload = data.payload;
    if (!payload || typeof payload.type !== "string" || !ALLOWED_INBOUND_TYPES.has(payload.type)) return;
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        void chrome.runtime?.lastError;
        if (!requestId) return;
        postToPage({ source: "zapee-extension", requestId, response: response ?? null });
      });
    } catch {
      if (requestId) postToPage({ source: "zapee-extension", requestId, response: null });
    }
  });

  // ------------------------------------------------------- extension → trang
  var EVENT_NAME_BY_TYPE = {
    zapee_order_completed: "zapee:order-completed",
    zapee_continue_next_store: "zapee:continue-next-store"
  };

  function deliverExtensionEvent(message) {
    if (!message || typeof message.type !== "string") return;
    postToPage({ source: "zapee-extension", ...message });
    const eventName = EVENT_NAME_BY_TYPE[message.type];
    if (eventName) {
      const detail = { ...message };
      delete detail.type;
      void dispatchPageEvent(eventName, detail);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "zapee_order_completed" || message.type === "zapee_continue_next_store" || message.type === "zapee_progress_event") {
      deliverExtensionEvent(message);
    }
  });

  // Trên iOS luồng single-tab điều hướng NGAY TRONG tab của trang web, nên khi
  // đơn hoàn tất và user quay lại trang Zapee thì tab gốc không còn sống để
  // nhận tabs.sendMessage — background giữ hàng đợi sự kiện, bridge rút về khi
  // trang nạp (PORTING.md B3).
  function drainQueuedEvents() {
    try {
      chrome.runtime.sendMessage({ type: "zapee_drain_control_surface_events" }, (response) => {
        void chrome.runtime?.lastError;
        const events = Array.isArray(response?.events) ? response.events : [];
        for (const evt of events) {
          if (evt && evt.message && typeof evt.message.type === "string") deliverExtensionEvent(evt.message);
        }
      });
    } catch {
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", drainQueuedEvents, { once: true });
  } else {
    drainQueuedEvents();
  }
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) drainQueuedEvents();
  });
})();
