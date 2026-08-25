"use strict";
(() => {
  // session-engine.js — trái tim của bản port iOS Safari (PORTING.md B2/B3/B4).
  //
  // Trên Chrome, background service worker sở hữu WebSocket phiên và điều phối
  // đa tab + side panel. Safari trên iOS tắt service worker rất sớm và không có
  // side panel, nên script này (chạy TRƯỚC content.js, cùng isolated world,
  // cùng entry content_scripts) đảm nhận:
  //
  //   1. Shim chrome.runtime.sendMessage / onMessage.addListener để bắt các
  //      message của content.js và định tuyến NỘI BỘ TAB thay vì đi qua
  //      background — content.js giữ nguyên, không cần sửa.
  //   2. Sở hữu WebSocket tới agent-server (B4): claim handoff khi trang bán lẻ
  //      nạp (B3, single-tab), nhận dom_op/dom_guidance từ server và phát lại
  //      cho content.js như thể background gửi tabs.sendMessage.
  //   3. Render panel "Đơn hàng Zapee" (port từ sidepanel.js) thành overlay
  //      bottom-sheet trong shadow DOM (B2).
  //
  // Background chỉ còn giữ: storage.session, check-support, cấp/refresh token,
  // enrich Co.op, hàng đợi sự kiện trả về trang Zapee.
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;

  var realChrome = chrome;
  var realRuntime = chrome.runtime;
  var nativeSendMessage = realRuntime.sendMessage.bind(realRuntime);
  var nativeOnMessage = realRuntime.onMessage;
  var nativeAddListener = nativeOnMessage.addListener.bind(nativeOnMessage);
  var nativeRemoveListener = nativeOnMessage.removeListener ? nativeOnMessage.removeListener.bind(nativeOnMessage) : null;
  var nativeGetURL = realRuntime.getURL.bind(realRuntime);

  var DEBUG = false;
  function zLog(...args) {
    // Luôn đẩy xuống background (popup đọc lại được trên chính iPad — không cần
    // cáp/Web Inspector); console chỉ bật khi DEBUG.
    diagLog(args.map((a) => typeof a === "string" ? a : safeStringify(a)).join(" "));
    if (!DEBUG) return;
    try {
      console.debug("[Zapee engine]", ...args);
    } catch {
    }
  }

  // ------------------------------------------------------------- chẩn đoán
  // Không tự ghi storage: background là người ghi duy nhất (xem background.js),
  // ở đây chỉ gửi message và bỏ qua mọi lỗi (SW ngủ thì mất log, không sao).
  function safeStringify(value) {
    try {
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    } catch {
      return String(value);
    }
  }
  function diagLog(msg, extra) {
    try {
      nativeSendMessage({ type: "zapee_diag_log", src: "engine", msg: String(msg), extra }, () => {
        void realRuntime.lastError;
      });
    } catch {
    }
  }
  function diagState(patch) {
    try {
      nativeSendMessage({ type: "zapee_diag_state", patch }, () => {
        void realRuntime.lastError;
      });
    } catch {
    }
  }

  // ================================================================= config
  var DEFAULT_AGENT_SERVER_WS_URL = "wss://agent-server.timdaythay.com";
  var DEFAULT_ZAPEE_WEB_APP_URL = "https://zapee.timdaythay.com";
  var webAppUrl = DEFAULT_ZAPEE_WEB_APP_URL;

  function parseAgentServerWsUrl(baseUrlString) {
    const normalized = String(baseUrlString || "").trim().replace(/\/+$/, "");
    const url = new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
    const isSecure = url.protocol === "https:" || url.protocol === "wss:";
    return `${isSecure ? "wss:" : "ws:"}//${url.host}`;
  }

  async function getAgentServerWsUrl() {
    try {
      const data = await realChrome.storage.local.get("agentServerUrl");
      if (data?.agentServerUrl && typeof data.agentServerUrl === "string" && data.agentServerUrl.trim()) {
        return parseAgentServerWsUrl(data.agentServerUrl);
      }
    } catch {
    }
    return DEFAULT_AGENT_SERVER_WS_URL;
  }

  // ===================================================== messaging tới background
  function bgSend(message) {
    return new Promise((resolve) => {
      try {
        nativeSendMessage(message, (response) => {
          void realRuntime.lastError;
          resolve(response);
        });
      } catch {
        resolve(void 0);
      }
    });
  }

  // ============================================================ shim messaging
  var tabListeners = [];

  function shimAddListener(listener) {
    if (typeof listener !== "function") return;
    tabListeners.push(listener);
    // Vẫn đăng ký với runtime thật để tabs.sendMessage từ background (nếu có)
    // tới thẳng content.js như cũ.
    try {
      nativeAddListener(listener);
    } catch {
    }
  }

  function shimRemoveListener(listener) {
    const index = tabListeners.indexOf(listener);
    if (index >= 0) tabListeners.splice(index, 1);
    try {
      nativeRemoveListener?.(listener);
    } catch {
    }
  }

  function invokeCallback(callback, response) {
    if (typeof callback !== "function") return;
    try {
      callback(response);
    } catch {
    }
  }

  function forwardToBackground(message, callback) {
    try {
      nativeSendMessage(message, (response) => {
        void realRuntime.lastError;
        invokeCallback(callback, response);
      });
    } catch {
      invokeCallback(callback, void 0);
    }
  }

  function shimSendMessage(message, callback) {
    const type = message && typeof message.type === "string" ? message.type : "";
    switch (type) {
      case "zapee_dom_op_result":
        engineOnDomOpResult(message);
        invokeCallback(callback, void 0);
        return;
      case "zapee_live_cart":
        void engineOnLiveCart(message);
        invokeCallback(callback, void 0);
        return;
      case "zapee_url_changed":
        void engineOnUrlChanged(message);
        invokeCallback(callback, void 0);
        return;
      case "zapee_coop_account_ready":
        void engineOnCoopAccountReady(message).then((response) => invokeCallback(callback, response));
        return;
      case "zapee_patch_order_payload":
        // Vá in-memory cho retry 4001 RỒI vẫn chuyển xuống background (bản lưu).
        engineOnPatchOrderPayload(message);
        forwardToBackground(message, callback);
        return;
      case "zapee_open_sidebar":
        void engineOnOpenPanel();
        invokeCallback(callback, void 0);
        return;
      case "zapee_open_sidepanel_now":
        // Trên iOS không có side panel để chuẩn bị trước; panel là overlay
        // trong tab bán lẻ nên đây chỉ còn là bookkeeping.
        invokeCallback(callback, { ok: true, panel: "in-page" });
        return;
      case "zapee_continue_next_store":
        void engineContinueNextStore().then((response) => invokeCallback(callback, response));
        return;
      case "zapee_content_ready":
        kickEngineBoot();
        forwardToBackground(message, callback);
        return;
      default:
        forwardToBackground(message, callback);
    }
  }

  // Phát message "như từ background" cho các listener content.js đã đăng ký.
  function deliverToTab(message) {
    const sender = { id: realRuntime.id };
    for (const listener of tabListeners.slice()) {
      try {
        listener(message, sender, () => {
        });
      } catch {
      }
    }
  }

  // Cài shim: ưu tiên che global `chrome` bằng object mới (không đụng object
  // gốc); nếu môi trường không cho phép thì vá thẳng lên runtime thật.
  var shimInstalled = false;
  try {
    const shimOnMessage = Object.create(nativeOnMessage);
    Object.defineProperties(shimOnMessage, {
      addListener: { value: shimAddListener, configurable: true },
      removeListener: { value: shimRemoveListener, configurable: true },
      hasListener: { value: (listener) => tabListeners.includes(listener), configurable: true }
    });
    const shimRuntime = Object.create(realRuntime);
    Object.defineProperties(shimRuntime, {
      sendMessage: { value: shimSendMessage, configurable: true },
      onMessage: { value: shimOnMessage, configurable: true },
      getURL: { value: (path) => nativeGetURL(path), configurable: true },
      id: { get: () => realRuntime.id, configurable: true },
      lastError: { get: () => realRuntime.lastError, configurable: true }
    });
    const shimChrome = Object.create(realChrome);
    Object.defineProperty(shimChrome, "runtime", { value: shimRuntime, configurable: true });
    Object.defineProperty(globalThis, "chrome", { value: shimChrome, configurable: true, writable: true });
    shimInstalled = globalThis.chrome === shimChrome;
  } catch {
    shimInstalled = false;
  }
  if (!shimInstalled) {
    try {
      realRuntime.sendMessage = shimSendMessage;
      nativeOnMessage.addListener = shimAddListener;
      nativeOnMessage.removeListener = shimRemoveListener;
      shimInstalled = true;
    } catch {
    }
  }
  zLog("shim installed:", shimInstalled);
  // Heartbeat: nếu popup KHÔNG thấy mục này thì content script chưa hề chạy trên
  // trang đó (quyền website chưa cấp / manifest không khớp), chứ không phải lỗi
  // logic phía sau.
  diagState({
    sessionEngine: {
      at: new Date().toISOString(),
      url: String(location.href).slice(0, 300),
      host: location.host,
      shimInstalled,
      userAgent: String(navigator.userAgent).slice(0, 300),
      readyState: document.readyState
    }
  });

  // ====================================================== MAIN-world bridge RPC
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
      const requestId = `zse-${Date.now()}-${mainRequestSeq += 1}`;
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
      script.src = nativeGetURL("page-bridge-main.js");
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
      script.addEventListener("load", () => script.remove());
    } catch {
    }
  }

  async function ensureMainBridge() {
    // Chẩn đoán: phân biệt 3 trường hợp — vào được ngay (manifest world:"MAIN"
    // hoạt động), phải inject <script> mới được (Safari cũ), hoặc không thể
    // (CSP của trang chặn) → ảnh hưởng trực tiếp authenticated_request.
    if (await mainBridgePost("ping", {}, 300)) {
      diagState({ mainWorld: { ok: true, via: "manifest world:MAIN", at: new Date().toISOString() } });
      return true;
    }
    injectMainBridgeScript();
    const viaInject = Boolean(await mainBridgePost("ping", {}, 700));
    diagState({
      mainWorld: {
        ok: viaInject,
        via: viaInject ? "inject <script> (manifest world bị bỏ qua)" : "KHÔNG với tới được (nghi CSP của trang chặn)",
        at: new Date().toISOString()
      }
    });
    return viaInject;
  }

  // authenticated_request phải chạy ở MAIN world (đọc window.TekoID) — xem
  // PORTING.md B5. Trả null nếu bridge không sẵn sàng để engine rơi về
  // executor isolated-world của content.js (chỉ quét token trong storage).
  async function mainWorldAuthenticatedRequest(msg) {
    if (!await ensureMainBridge()) return null;
    return mainBridgePost("authenticated_request", {
      url: msg.url || "",
      method: msg.method || "POST",
      body: msg.body || {},
      lookup: msg.lookup
    }, 3e4);
  }

  // =============================================== helpers port từ background
  function allowsBlockingPresentation(payload) {
    return payload?.allowBlockingPresentation === true;
  }

  function applyPresentationPolicy(payload, message) {
    if (message.presentation?.kind !== "blocking" || allowsBlockingPresentation(payload)) {
      return message;
    }
    return {
      ...message,
      message: "",
      presentation: { ...message.presentation, visible: false }
    };
  }

  function shouldAcceptLiveCartSnapshot(items, payload) {
    if (items.length > 0) return true;
    return typeof payload.liveCartSyncedAt === "number" && Number.isFinite(payload.liveCartSyncedAt);
  }

  function normalizedName(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function skuOf(value) {
    return String(value || "").match(/--s(\d+)(?:[/?#]|$)/i)?.[1] || "";
  }

  function productUrlOf(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch {
      return raw.split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase();
    }
  }

  function scopeLiveCartToOrder(items, payload) {
    if (payload.liveCartScope === "selected") return items;
    const requested = Array.isArray(payload.requestedProducts) ? payload.requestedProducts : Array.isArray(payload.products) ? payload.products : Array.isArray(payload.items) ? payload.items : [];
    if (!requested.length) return items;
    const identities = requested.map((item) => ({
      sku: String(item.sku || skuOf(item.url || item.productUrl)),
      url: productUrlOf(item.url || item.productUrl),
      name: normalizedName(item.name || item.productName || item.title)
    }));
    return items.filter((item) => {
      const sku = String(item.sku || skuOf(item.url));
      const url = productUrlOf(item.url);
      const name = normalizedName(item.name);
      return identities.some((wanted) => {
        if (wanted.sku && sku) return wanted.sku === sku;
        if (wanted.url && url) return wanted.url === url;
        return Boolean(
          wanted.name && name && (wanted.name === name || wanted.name.includes(name) || name.includes(wanted.name))
        );
      });
    });
  }

  function isCoopCheckoutUrl(url) {
    try {
      const parsed = new URL(String(url || ""), "https://cooponline.vn/");
      return /(^|\.)cooponline\.vn$/i.test(parsed.hostname) && /\/checkout(?:\/|$)/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function isCoopRestartTargetUrl(url) {
    try {
      const parsed = new URL(String(url || ""), "https://cooponline.vn/");
      if (!/(^|\.)cooponline\.vn$/i.test(parsed.hostname)) return false;
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      return path === "/" || /^\/(?:account|login|signup|dang-nhap)(?:\/|$)/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function isStaleAuthenticatedCoopNarration(entry, message) {
    if (!entry.coopAuthenticated || !["coop", "cop"].includes(entry.chain.toLowerCase())) return false;
    const normalized = message.toLocaleLowerCase("vi");
    return /popup quảng cáo|nạp địa chỉ|cửa hàng gần nhất|chưa xác nhận tài khoản|tải trạng thái tài khoản|nhập otp|nhập mật khẩu|nhập số điện thoại/.test(normalized);
  }

  // ================================================ agent-connection (port nguyên)
  function assistantTextOf(message) {
    if (message.type === "status") {
      const phase = message.phase;
      if (phase === "assistant_message" && typeof message.message === "string") return message.message;
      if (phase === "waiting_user_input") {
        return typeof message.reason === "string" ? message.reason : "Trang đang chờ bạn thao tác.";
      }
      if (phase === "automation_mode") {
        return message.automationMode === "manual" ? "Bạn đang thao tác, Zapee sẽ theo dõi và hướng dẫn." : "Zapee đang tiếp tục hỗ trợ trên trình duyệt.";
      }
      if (phase === "completed") return "Đơn đã sẵn sàng để bạn kiểm tra trước khi xác nhận.";
      if (phase === "coop_payment_verifying") return "Co.op đang xác minh kết quả thanh toán.";
      if (phase === "coop_payment_failed") return "Thanh toán Co.op chưa thành công hoặc đã bị hủy. Bạn có thể thử lại trên trang thanh toán.";
      if (phase === "failed") return "Tự động hoá đang dừng để bạn kiểm tra trên màn hình.";
      return void 0;
    }
    if (message.type === "message" && typeof message.content === "string") return message.content;
    if (message.type === "log" && message.audience === "client" && typeof message.message === "string") return message.message;
    return void 0;
  }

  function buildAgentWsUrl(opts) {
    const baseUrl = opts.wsBaseUrl || DEFAULT_AGENT_SERVER_WS_URL;
    const params = new URLSearchParams({
      sessionId: opts.sessionId,
      chain: opts.chain,
      driverKind: "extension-dom",
      timestamp: String(opts.timestamp),
      token: opts.token
    });
    if (opts.initialUrl) params.set("pageUrl", opts.initialUrl);
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}${params.toString()}`;
  }

  function connectSession(opts) {
    const { sessionId, chain, token, timestamp, execMode, payload, initialUrl, wsBaseUrl, onDomOp, onDomGuidance, onAssistantMessage, onRuntimeConfig, onOrderCompleted, onStatus, onClose } = opts;
    const url = buildAgentWsUrl({ sessionId, chain, token, timestamp, initialUrl, wsBaseUrl });
    const ws = new WebSocket(url);
    const wsOpenedAt = Date.now();
    diagState({ ws: { phase: "connecting", chain, sessionId, at: new Date().toISOString() } });
    ws.onopen = () => {
      diagState({ ws: { phase: "open", chain, sessionId, ms: Date.now() - wsOpenedAt, at: new Date().toISOString() } });
      diagLog(`WS mở (${chain}, ${Date.now() - wsOpenedAt}ms)`);
    };
    let orderSent = false;
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === "status") onStatus?.(message);
      if (!orderSent && message.type === "status" && message.phase === "ready") {
        orderSent = true;
        ws.send(JSON.stringify({
          type: "run_order",
          payload: { ...payload, automationMode: execMode },
          automationMode: execMode
        }));
        return;
      }
      if (message.type === "dom_op") {
        onDomOp(message);
        return;
      }
      if (message.type === "dom_guidance") {
        onDomGuidance(message);
        return;
      }
      if (message.type === "retailer_runtime_config" && message.content && typeof message.content === "object") {
        onRuntimeConfig?.(message.content);
        return;
      }
      if (message.type === "status" && message.phase === "order_completed") {
        onOrderCompleted?.(message);
        return;
      }
      const text = assistantTextOf(message);
      if (text) onAssistantMessage?.(text);
    };
    ws.onclose = (event) => {
      // code 4001 = token hết hạn (engine tự retry); 1006 = đứt bất thường,
      // thường là mạng hoặc trang vừa điều hướng.
      diagState({ ws: { phase: "closed", chain, sessionId, code: event?.code, reason: String(event?.reason || "").slice(0, 200), at: new Date().toISOString() } });
      diagLog(`WS đóng code=${event?.code} reason=${String(event?.reason || "").slice(0, 120)}`);
      onClose?.(event?.code, event?.reason);
    };
    ws.onerror = () => {
      diagState({ ws: { phase: "error", chain, sessionId, at: new Date().toISOString() } });
      diagLog(`WS lỗi (${chain})`);
    };
    return {
      send(msg) {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(msg));
      },
      close() {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
    };
  }

  // ================================================================== engine
  var MAX_LOG_ENTRIES = 30;
  var session = null;
  var bootKicked = false;

  function pushSessionLog(entry, message) {
    entry.log.push(message);
    if (entry.log.length > MAX_LOG_ENTRIES) entry.log.shift();
    schedulePanelRender();
  }

  function persistPayloadPatch(entry) {
    void bgSend({ type: "zapee_engine_update", sessionId: entry.sessionId, payload: entry.payload });
  }

  function latchCoopCheckoutReached(entry, url) {
    if (entry.coopCheckoutReached || entry.payload.coopCheckoutReached === true) {
      entry.coopCheckoutReached = true;
      if (entry.payload.coopCheckoutReached !== true) {
        entry.payload = { ...entry.payload, coopCheckoutReached: true };
        persistPayloadPatch(entry);
      }
      return;
    }
    if (!["coop", "cop"].includes(entry.chain.toLowerCase()) || !isCoopCheckoutUrl(url)) return;
    entry.coopCheckoutReached = true;
    entry.payload = { ...entry.payload, coopCheckoutReached: true };
    persistPayloadPatch(entry);
  }

  function hideActivePresentation(entry) {
    const active = entry.activePresentation;
    if (!active?.presentation) return;
    deliverToTab({
      ...active,
      type: "zapee_dom_guidance",
      message: "",
      presentation: { ...active.presentation, visible: false }
    });
  }

  function relayProgress(entry, fields) {
    void bgSend({
      type: "zapee_progress_relay",
      progress: {
        sessionId: entry.sessionId,
        chain: entry.chain,
        ts: Date.now(),
        ...fields
      }
    });
  }

  async function sendDomOpResultToServer(entry, result) {
    if (!entry.active || session !== entry) return;
    entry.connection.send({
      type: "dom_op_result",
      opId: result.opId,
      ok: result.ok,
      error: result.error,
      visible: result.visible,
      text: result.text,
      currentUrl: result.currentUrl
    });
  }

  async function startLocalSession(handoff, initialUrl, authRetryCount = 0, observationOnly = false) {
    if (session && session.sessionId === handoff.sessionId && session.active) {
      const existing = session;
      existing.observationOnly ||= observationOnly;
      existing.chain = handoff.chain;
      existing.execMode = handoff.execMode || existing.execMode || "manual";
      existing.payload = handoff.payload;
      latchCoopCheckoutReached(existing, initialUrl);
      if (initialUrl) existing.connection.send({ type: "dom_context", url: initialUrl });
      announceSessionToTab(existing);
      schedulePanelRender();
      return;
    }
    if (session?.active) {
      try {
        session.connection.close();
      } catch {
      }
      session.active = false;
    }
    const entry = {
      active: true,
      observationOnly,
      chain: handoff.chain,
      sessionId: handoff.sessionId,
      sourceTabId: handoff.sourceTabId,
      execMode: handoff.execMode,
      payload: handoff.payload || { chain: handoff.chain },
      log: [],
      coopAuthenticated: false,
      coopCheckoutReached: handoff.payload?.coopCheckoutReached === true,
      connection: null,
      completionForwarded: Boolean(handoff.orderCompleted),
      orderCompleted: handoff.orderCompleted,
      activePresentation: void 0,
      runtimeConfig: void 0,
      handoff
    };
    latchCoopCheckoutReached(entry, initialUrl);
    const wsBaseUrl = await getAgentServerWsUrl();
    let closeHandled = false;
    const persistTerminalFailure = (code, reason) => {
      const safeCode = code || 1006;
      const safeReason = String(reason || "Không có lý do từ máy chủ");
      let endpoint = wsBaseUrl;
      try {
        endpoint = new URL(wsBaseUrl).origin;
      } catch {
      }
      const diagnostic = `Mã ${safeCode} · ${safeReason} · Gateway ${endpoint}`;
      pushSessionLog(entry, `❌ Phiên ngắt kết nối (${diagnostic}). Vui lòng tạo đơn mới.`);
      void bgSend({
        type: "zapee_save_failure",
        failure: {
          sessionId: entry.sessionId,
          chain: entry.chain,
          execMode: entry.execMode,
          payload: entry.payload,
          code: safeCode,
          reason: safeReason,
          endpoint,
          message: diagnostic
        }
      }).then(() => schedulePanelRender());
    };
    entry.connection = connectSession({
      sessionId: handoff.sessionId,
      chain: handoff.chain,
      token: handoff.token,
      timestamp: handoff.timestamp,
      execMode: handoff.execMode,
      payload: entry.payload,
      initialUrl,
      wsBaseUrl,
      onDomOp: (msg) => {
        if (!entry.active || session !== entry) return;
        if (entry.observationOnly) {
          entry.connection.send({
            type: "dom_op_result",
            opId: msg.opId,
            ok: false,
            error: "observation_only_document",
            currentUrl: location.href
          });
          return;
        }
        if (msg.kind === "navigate" && entry.coopCheckoutReached && isCoopRestartTargetUrl(typeof msg.url === "string" ? msg.url : void 0)) {
          entry.connection.send({
            type: "dom_op_result",
            opId: msg.opId,
            ok: false,
            error: "coop_checkout_locked",
            currentUrl: location.href
          });
          return;
        }
        if (msg.kind === "authenticated_request") {
          void mainWorldAuthenticatedRequest(msg).then((result) => {
            if (!entry.active || session !== entry) return;
            if (result) {
              entry.connection.send({
                type: "dom_op_result",
                opId: msg.opId,
                ok: result.ok === true,
                error: result.ok === true ? void 0 : result.error || "request_failed",
                currentUrl: result.currentUrl || location.href
              });
              return;
            }
            // MAIN world không khả dụng — rơi về executor isolated-world của
            // content.js (quét token storage, không đọc được TekoID).
            deliverToTab({ ...msg, type: "zapee_dom_op" });
          });
          return;
        }
        deliverToTab({ ...msg, type: "zapee_dom_op" });
      },
      onDomGuidance: (msg) => {
        if (!entry.active || session !== entry) return;
        if (entry.observationOnly) return;
        const filtered = applyPresentationPolicy(entry.payload, msg);
        if (filtered.presentation?.kind === "blocking") {
          if (filtered.presentation.visible) {
            entry.activePresentation = filtered;
          } else if (!entry.activePresentation || entry.activePresentation.checkpointId === msg.checkpointId) {
            entry.activePresentation = void 0;
          }
        }
        deliverToTab({ ...filtered, type: "zapee_dom_guidance" });
      },
      onRuntimeConfig: (config) => {
        if (!entry.active || session !== entry) return;
        entry.runtimeConfig = config;
        deliverToTab({
          type: "zapee_retailer_runtime_config",
          sessionId: entry.sessionId,
          config
        });
      },
      onOrderCompleted: (result) => {
        if (!entry.active || session !== entry || entry.completionForwarded) return;
        const expectedStoreKey = String(entry.payload.storeKey || "").trim();
        const resultStoreKey = String(result.storeKey || "").trim();
        if (result.sessionId !== entry.sessionId || !expectedStoreKey || resultStoreKey !== expectedStoreKey) return;
        entry.completionForwarded = true;
        entry.orderCompleted = {
          orderCode: result.orderCode,
          orderUrl: result.orderUrl
        };
        hideActivePresentation(entry);
        entry.activePresentation = void 0;
        const detail = {
          sessionId: entry.sessionId,
          storeKey: expectedStoreKey,
          chain: entry.chain,
          orderCode: result.orderCode,
          orderUrl: result.orderUrl
        };
        void bgSend({ type: "zapee_engine_update", sessionId: entry.sessionId, orderCompleted: entry.orderCompleted });
        void bgSend({
          type: "zapee_control_surface_event",
          name: "zapee:order-completed",
          detail,
          message: { type: "zapee_order_completed", ...detail }
        });
        openPanel();
        schedulePanelRender();
      },
      onAssistantMessage: (text) => {
        if (!entry.active || session !== entry) return;
        if (isStaleAuthenticatedCoopNarration(entry, text)) return;
        pushSessionLog(entry, text);
        if (entry.activePresentation) return;
        deliverToTab({ type: "zapee_assistant_message", message: text });
      },
      onStatus: (msg) => {
        if (!entry.active || session !== entry) return;
        relayProgress(entry, {
          phase: typeof msg.phase === "string" ? msg.phase : void 0,
          checkpointId: typeof msg.checkpointId === "string" ? msg.checkpointId : void 0,
          checkpointIndex: typeof msg.checkpointIndex === "number" ? msg.checkpointIndex : void 0,
          pauseReason: typeof msg.pauseReason === "string" ? msg.pauseReason : void 0,
          automationMode: msg.automationMode === "auto" || msg.automationMode === "manual" ? msg.automationMode : void 0
        });
      },
      onClose: (code, reason) => {
        if (closeHandled) return;
        closeHandled = true;
        if (!entry.active || session !== entry) return;
        relayProgress(entry, { phase: "disconnected" });
        hideActivePresentation(entry);
        entry.activePresentation = void 0;
        if (entry.orderCompleted) {
          schedulePanelRender();
          return;
        }
        entry.active = false;
        if (session === entry) session = null;
        const isTerminalError = Boolean(code && (code >= 4e3 && code <= 4999 || code === 1008));
        if (isTerminalError) {
          if (code === 4001 && authRetryCount === 0) {
            pushSessionLog(entry, "🔄 Phiên xác thực hết hiệu lực, Zapee đang xin token mới và nối lại một lần…");
            // Gửi payload HIỆN TẠI (đã latch coopCheckoutReached, live cart…)
            // thay vì bản gốc lúc claim — nếu không, phiên nối lại sẽ mất các
            // guard như coop_checkout_locked và bắt đầu lại từ đầu.
            void bgSend({ type: "zapee_refresh_token", handoff: { ...entry.handoff, payload: entry.payload, execMode: entry.execMode } }).then((response) => {
              const freshHandoff = response?.handoff;
              if (!freshHandoff) {
                persistTerminalFailure(code, reason);
                return;
              }
              void startLocalSession(freshHandoff, location.href, authRetryCount + 1, entry.observationOnly);
            });
            return;
          }
          persistTerminalFailure(code, reason);
        } else if (code === 1e3 || code === 1005 || code == null) {
          void bgSend({ type: "zapee_engine_session_ended", sessionId: entry.sessionId, chain: entry.chain });
          deliverToTab({ type: "zapee_session_end", sessionId: entry.sessionId });
          schedulePanelRender();
        }
      }
    });
    session = entry;
    announceSessionToTab(entry);
    schedulePanelRender();
  }

  function announceSessionToTab(entry) {
    const activePresentation = allowsBlockingPresentation(entry.payload) ? entry.activePresentation : void 0;
    deliverToTab({
      type: "zapee_session_start",
      sessionId: entry.sessionId,
      chain: entry.chain,
      execMode: entry.execMode || "manual",
      payload: entry.payload
    });
    if (entry.runtimeConfig) {
      deliverToTab({
        type: "zapee_retailer_runtime_config",
        sessionId: entry.sessionId,
        config: entry.runtimeConfig
      });
    }
    if (activePresentation) {
      deliverToTab({
        ...activePresentation,
        type: "zapee_dom_guidance"
      });
    }
  }

  // -------------------------------------------------------------- boot (B3)
  function kickEngineBoot() {
    if (bootKicked) return;
    bootKicked = true;
    // Nạp sẵn page-bridge-main (MAIN world) ngay từ đầu: content.js post
    // storage_event cho nó khi seed localStorage Co.op mà không tự ensure —
    // trên Safari bỏ qua world:"MAIN" thì phải inject trước thời điểm đó (B5).
    void ensureMainBridge();
    void (async () => {
      const response = await bgSend({ type: "zapee_engine_boot", url: location.href });
      // Đây là chỗ quyết định overlay có TỰ MỞ hay không: chỉ action "claim" mới
      // mở panel. action "none" = không có handoff nào khớp host này → panel im
      // lặng là ĐÚNG, và khi đó chỉ còn launcher của content.js phải hiện.
      diagState({
        engineBoot: {
          action: response?.action || (response ? "?" : "KHÔNG CÓ PHẢN HỒI (background ngủ?)"),
          hasHandoff: Boolean(response?.handoff),
          chain: response?.handoff?.chain,
          at: new Date().toISOString()
        }
      });
      diagLog(`engine_boot → ${response?.action || "không có phản hồi"}`);
      if (!response) return;
      if (typeof response.webAppUrl === "string" && response.webAppUrl) webAppUrl = response.webAppUrl;
      if ((response.action === "claim" || response.action === "resume") && response.handoff) {
        zLog("boot:", response.action, response.handoff.sessionId);
        await startLocalSession(response.handoff, location.href, 0, response.observationOnly === true);
        if (response.action === "claim") {
          // Handoff mới từ trang Zapee — mở panel để user thấy đơn của mình.
          whenDomReady(() => openPanel());
        }
      }
    })();
  }

  function whenDomReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => fn(), { once: true });
    } else {
      fn();
    }
  }

  // ------------------------------------------------- handlers từ content.js
  function engineOnDomOpResult(message) {
    if (!session?.active) return;
    void sendDomOpResultToServer(session, message);
  }

  // Content.js 0.1.35 (sync 2a4f94d): vá accountMode vào payload IN-MEMORY của
  // engine — retry 4001 gửi lại run_order bằng entry.payload hiện tại, thiếu
  // patch này thì reconnect quay về chế độ login/register cũ. Message vẫn được
  // forward xuống background để vá bản lưu trong storage.session.
  function engineOnPatchOrderPayload(message) {
    const accountMode = message && (message.accountMode === "register" || message.accountMode === "login") ? message.accountMode : "";
    if (!accountMode || !session || session.sessionId !== String(message.sessionId || "")) return;
    session.payload = { ...session.payload && typeof session.payload === "object" ? session.payload : {}, accountMode };
  }

  async function engineOnUrlChanged(message) {
    const url = String(message.url || "");
    const entry = session;
    if (entry?.active) {
      // Parity với tryAssociateTab (Chrome bg): URL không được hỗ trợ (redirect
      // cổng thanh toán…) → ẩn launcher, không gửi dom_context; ngược lại gửi
      // dom_context và announce lại phiên.
      const support = await bgSend({ type: "zapee_check_support", url, chain: entry.chain });
      if (entry !== session || !entry.active) return;
      if (!support?.supported) {
        deliverToTab({ type: "zapee_hide_launcher" });
        return;
      }
      latchCoopCheckoutReached(entry, url);
      entry.connection.send({ type: "dom_context", url });
      announceSessionToTab(entry);
      return;
    }
    // Không có phiên: SPA điều hướng đổi trạng thái hỗ trợ của trang — mirror
    // hành vi Chrome MỚI (sync 18/08): trang được hỗ trợ nhưng CHƯA có phiên
    // chỉ là điểm vào nhàn rỗi → gửi zapee_hide_launcher (handler mới tự boot
    // launcher trên host always-show như BHX/Co.op, host khác thì ẩn + dọn
    // guidance). Trước đây gửi zapee_session_start {chain} không sessionId —
    // bản content.js mới coi đó là "không có phiên" nên kết quả tương đương,
    // nhưng gửi hide_launcher là đúng nguyên bản upstream. Upstream gửi nó cho
    // CẢ trang hỗ trợ lẫn không (khác nhau nằm trong handler) → không cần hỏi
    // check-support ở đây nữa, đỡ một vòng fetch mỗi lần SPA điều hướng.
    if (session?.active) return;
    deliverToTab({ type: "zapee_hide_launcher" });
  }

  var liveCart = null;

  async function engineOnLiveCart(message) {
    const entry = session;
    if (!entry?.active) return;
    if (!Array.isArray(message.items)) return;
    const messageSessionId = String(message.sessionId || "");
    if (!messageSessionId || messageSessionId !== entry.sessionId) return;
    const mapped = scopeLiveCartToOrder(message.items.map((i) => ({
      name: String(i.name || "Sản phẩm"),
      qty: Math.max(0, Number(i.qty) || 0),
      lineTotal: typeof i.lineTotal === "number" ? i.lineTotal : void 0,
      unitPrice: typeof i.unitPrice === "number" ? i.unitPrice : void 0,
      image: typeof i.image === "string" ? i.image : void 0,
      sku: typeof i.sku === "string" ? i.sku : void 0,
      url: typeof i.url === "string" ? i.url : void 0
    })).filter((i) => i.qty > 0 && i.name), entry.payload);
    if (!shouldAcceptLiveCartSnapshot(mapped, entry.payload)) return;
    const itemTotal = mapped.reduce(
      (sum, i) => sum + (Number(i.lineTotal) || (Number(i.unitPrice) || 0) * i.qty || 0),
      0
    );
    const total = typeof message.total === "number" && message.total > 0 ? message.total : itemTotal;
    const source = String(message.source || "cart-dom");
    const cart = {
      sessionId: entry.sessionId,
      items: mapped,
      total,
      currency: "VND",
      source,
      capturedAt: new Date().toISOString()
    };
    liveCart = cart;
    entry.payload = {
      ...entry.payload,
      products: mapped,
      items: mapped,
      total,
      liveCartSource: source,
      liveCartSyncedAt: Date.now()
    };
    schedulePanelRender();
    void bgSend({
      type: "zapee_engine_live_cart",
      sessionId: entry.sessionId,
      cart,
      payload: entry.payload
    });
  }

  async function engineOnCoopAccountReady(message) {
    if (message.authenticated !== true) {
      return { ok: false, reason: "coop_account_not_authenticated" };
    }
    const messageSessionId = String(message.sessionId || "");
    if (!messageSessionId) {
      return { ok: false, reason: "missing_session_id" };
    }
    if (session && session.sessionId !== messageSessionId) {
      return { ok: false, reason: "stale_session" };
    }
    if (!session) {
      // Trang vừa nạp lại giữa chừng — thử nối lại phiên đang hoạt động.
      const response = await bgSend({ type: "zapee_engine_boot", url: location.href, force: true });
      if ((response?.action === "claim" || response?.action === "resume") && response.handoff) {
        if (String(response.handoff.sessionId || "") !== messageSessionId) {
          return { ok: false, reason: "stale_session" };
        }
        await startLocalSession(response.handoff, location.href, 0, response.observationOnly === true);
      }
    }
    if (session?.sessionId === messageSessionId && session.active) {
      const url = String(message.url || "") || "https://cooponline.vn/account";
      session.coopAuthenticated = true;
      session.connection.send({ type: "dom_context", url });
      session.connection.send({
        type: "coop_account_ready",
        url,
        authenticated: true
      });
      pushSessionLog(session, "Đã vào tài khoản — tiếp tục thêm vào giỏ.");
      return { ok: true, sessionId: session.sessionId };
    }
    return { ok: false, sessionId: session?.sessionId };
  }

  async function engineOnOpenPanel() {
    openPanel();
    if (session?.active) return;
    // Ưu tiên claim/resume handoff còn treo (phòng race lúc boot) trước khi
    // mở phiên standalone như luồng zapee_open_sidebar cũ của background.
    const boot = await bgSend({ type: "zapee_engine_boot", url: location.href });
    if ((boot?.action === "claim" || boot?.action === "resume") && boot.handoff) {
      if (typeof boot.webAppUrl === "string" && boot.webAppUrl) webAppUrl = boot.webAppUrl;
      await startLocalSession(boot.handoff, location.href, 0, boot.observationOnly === true);
      return;
    }
    const response = await bgSend({ type: "zapee_standalone_token", url: location.href });
    if (response?.handoff && !session?.active) {
      await startLocalSession(response.handoff, location.href, 0, false);
    }
  }

  async function engineContinueNextStore() {
    const entry = session;
    const payload = entry?.payload;
    const sessionId = entry?.sessionId;
    const storeKey = String(payload?.storeKey || "").trim();
    const nextStoreName = String(payload?.nextStoreName || "").trim();
    if (!entry || !entry.orderCompleted || !storeKey || !nextStoreName) {
      return { ok: false, error: "next_store_unavailable" };
    }
    const detail = { sessionId, storeKey };
    await bgSend({
      type: "zapee_control_surface_event",
      name: "zapee:continue-next-store",
      detail,
      message: { type: "zapee_continue_next_store", ...detail }
    });
    // Single-tab: quay lại trang Zapee để web app phát handoff cửa hàng kế.
    const returnUrl = String(payload?.returnUrl || payload?.zapeeReturnUrl || webAppUrl);
    window.setTimeout(() => {
      try {
        location.assign(returnUrl);
      } catch {
      }
    }, 150);
    return { ok: true };
  }

  // ============================================================ overlay panel
  // Port giao diện "Đơn hàng Zapee" từ sidepanel.js/sidepanel.html thành
  // bottom-sheet trong shadow DOM (PORTING.md B2).
  var PANEL_HOST_ID = "zapee-order-panel-root";
  var panelShadow = null;
  var panelWrapEl = null;
  var panelRootEl = null;
  var panelOpen = false;
  var renderTimer = null;

  var currentSessionId = null;
  var selectedStoreKey = null;
  var lastRenderKey = "";
  var lastScrolledStoreKey = null;
  var lastTabScrollLeft = 0;

  var PANEL_STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  position: fixed; inset: 0; z-index: 2147483647;
  display: flex; align-items: flex-end; justify-content: center;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #17241f;
  /* Host của shadow tree mang inline "pointer-events: none" (pattern overlay 0x0
     — xem ensurePanelRoot) và thuộc tính này KẾ THỪA xuống mọi phần tử con, nên
     phải bật lại ở đây. Thiếu dòng này thì TOÀN BỘ panel (nút đóng, backdrop, nút
     "Mở trang đặt hàng", copy, scroll) chết hit-testing — mọi cú chạm xuyên
     thẳng xuống trang bán hàng phía dưới (bug iPad 18/08). Khi .wrap[hidden] thì
     display:none nên trang phía dưới vẫn tương tác bình thường. */
  pointer-events: auto;
}
.wrap[hidden] { display: none; }
.backdrop { position: absolute; inset: 0; background: rgba(15, 32, 27, .42); }
.sheet {
  position: relative; width: 100%; max-width: 430px; max-height: 84vh; max-height: 84dvh;
  display: flex; flex-direction: column;
  border-radius: 20px 20px 0 0; background: #f5f7f6;
  box-shadow: 0 -14px 40px rgba(10, 34, 27, .28);
  overflow: hidden;
}
@media (min-width: 768px) {
  .wrap { align-items: stretch; justify-content: flex-end; }
  .sheet { max-width: 390px; max-height: none; height: 100%; border-radius: 0; }
}
.sheet-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px 8px; border-bottom: 1px solid #dce5e1; background: #fbfdfc;
}
.sheet-grip { position: absolute; top: 6px; left: 50%; width: 42px; height: 4px; margin-left: -21px; border-radius: 999px; background: #cfdad5; }
.sheet-title { flex: 1; margin: 0; padding-top: 4px; font-size: 14px; font-weight: 800; color: #105e52; }
.sheet-close {
  flex: 0 0 32px; width: 32px; height: 32px; display: grid; place-items: center;
  border: 1px solid #d9e3df; border-radius: 10px; background: #fff; color: #53645e;
  font: inherit; font-size: 15px; cursor: pointer;
}
.sheet-body { overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.panel-shell { min-height: 100%; padding: 0 12px 24px; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; }
.next-store-btn { width: calc(100% - 32px); margin: 4px 16px 16px; padding: 12px 14px; border: 0; border-radius: 12px; background: #087d68; color: #fff; font-weight: 800; cursor: pointer; box-shadow: 0 8px 20px rgba(8, 125, 104, .22); }
.next-store-btn:disabled { cursor: wait; opacity: .7; }
.store-tabs { display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden; padding: 12px 12px 10px; border-bottom: 1px solid #dce5e1; background: #fbfdfc; -webkit-overflow-scrolling: touch; }
.store-tabs::-webkit-scrollbar { height: 6px; }
.store-tabs::-webkit-scrollbar-track { background: transparent; }
.store-tabs::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(8, 125, 104, .48); }
.store-tab { display: flex; flex: 0 0 calc((100% - 8px) / 2); min-width: 160px; min-height: 62px; align-items: center; gap: 9px; padding: 9px 11px; border: 1px solid #d9e3df; border-radius: 13px; background: #fff; color: #596863; cursor: pointer; text-align: left; white-space: nowrap; }
.store-tab.active { border-color: #087d68; background: #effaf6; color: #105e52; box-shadow: 0 0 0 1px rgba(8, 125, 104, .08); }
.store-tab-dot { --store-dot-halo: transparent; flex: 0 0 9px; width: 9px; height: 9px; border-radius: 50%; background: #9ca3af; }
.store-tab.ordering .store-tab-dot { background: #f5a61d; --store-dot-halo: rgba(245, 166, 29, .24); }
.store-tab.done .store-tab-dot { background: #18a46f; --store-dot-halo: rgba(24, 164, 111, .24); }
.store-tab.ordering .store-tab-dot, .store-tab.done .store-tab-dot { animation: store-tab-pulse 1.45s ease-in-out infinite; }
.store-tab-logo { display: grid; flex: 0 0 28px; width: 28px; height: 28px; place-items: center; border-radius: 50%; background: #071eb4; color: #fff; font-size: 16px; font-weight: 500; box-shadow: 0 3px 8px rgba(0, 19, 156, .2); }
.store-tab-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; align-items: flex-start; gap: 2px; line-height: 1.2; }
.store-tab-copy strong { max-width: 100%; overflow: hidden; font-size: 13px; text-overflow: ellipsis; }
.store-tab-copy small { display: block; max-width: 100%; overflow: hidden; color: #7c8a85; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.store-tab.ordering .store-tab-copy small { color: #c97800; font-weight: 700; }
.store-tab.done .store-tab-copy small { color: #13865e; font-weight: 700; }
@keyframes store-tab-pulse {
  0%, 100% { opacity: .45; box-shadow: 0 0 0 0 currentColor; transform: scale(.88); }
  50% { opacity: 1; box-shadow: 0 0 0 4px var(--store-dot-halo); transform: scale(1.08); }
}
@media (prefers-reduced-motion: reduce) { .store-tab-dot { animation: none; } }
.order-success { display: flex; min-height: 320px; flex-direction: column; align-items: center; justify-content: center; padding: 34px 20px 26px; text-align: center; }
.order-success-check { display: grid; width: 72px; height: 72px; place-items: center; border-radius: 50%; background: #dff7ed; color: #087d68; font-size: 40px; font-weight: 900; box-shadow: 0 10px 25px rgba(8, 125, 104, .16); }
.order-success h1 { margin: 18px 0 0; font-size: 20px; line-height: 1.35; }
.order-success p { margin: 8px 0 0; color: #53645e; font-size: 13px; }
.order-success-code { display: flex; width: 100%; max-width: 300px; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; padding: 12px 14px; border: 1px solid #dce5e1; border-radius: 12px; background: #f8fbfa; }
.order-success-code span { color: #53645e; font-size: 12px; }
.order-success-code strong { overflow-wrap: anywhere; font-size: 14px; }
.order-success .next-store-btn { width: 100%; max-width: 300px; margin: 22px 0 0; }
.brand-header { display: flex; align-items: center; gap: 10px; margin: 0 -12px 12px; padding: 12px 14px 11px; border-bottom: 1px solid rgba(255, 255, 255, .5); background: rgba(255, 255, 255, .82); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.brand-header img { height: 32px; width: auto; max-width: 65px; object-fit: contain; flex-shrink: 0; display: block; }
.brand-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; line-height: 1.25; }
.brand-badge-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.brand-badge { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 999px; background: #059669; color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; box-shadow: 0 1px 3px rgba(5, 150, 105, .25); }
.brand-tagline { font-size: 11px; color: #64748b; }
.brand-tagline strong { color: #334155; font-weight: 600; }
.brand-tagline span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.empty-state { margin-top: 4px; padding: 22px; border: 1px solid #dce5e1; border-radius: 18px; background: #fff; }
.empty-state strong { font-size: 18px; }
.empty-state p { margin: 8px 0 0; color: #53645e; font-size: 13px; line-height: 1.5; }
.empty-steps { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.empty-steps li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; background: #f0f7f4; color: #3a4f49; font-size: 12.5px; line-height: 1.45; }
.empty-steps .n { flex: 0 0 22px; width: 22px; height: 22px; border-radius: 999px; background: #087d68; color: #fff; font-size: 12px; font-weight: 800; display: grid; place-items: center; }
.order-sheet { overflow: hidden; border: 1px solid #dce5e1; border-radius: 20px; background: #fff; box-shadow: 0 12px 30px rgba(22, 56, 45, .08); }
.order-header { padding: 16px 16px 12px; }
.order-header h1 { margin: 0; font-size: 17px; line-height: 1.35; letter-spacing: -.25px; }
.order-header small { color: #53645e; font-size: 13px; font-weight: 500; }
.info-section, .store-section { padding: 14px 16px; }
.info-section h2, .store-section > h2 { margin: 0 0 13px; color: #51635c; font-size: 12px; letter-spacing: .75px; }
.info-field { margin-top: 11px; }
.info-field > span { display: block; margin-bottom: 5px; color: #53645e; font-size: 13px; }
.info-field > div { display: flex; min-height: 48px; align-items: center; gap: 8px; padding: 9px 9px 9px 12px; border: 1px solid #dce5e1; border-radius: 12px; background: #fcfdfd; }
.info-field strong { min-width: 0; flex: 1; overflow-wrap: anywhere; color: #26342f; font-size: 15px; line-height: 1.4; }
.copy-button { display: grid; flex: 0 0 28px; width: 28px; height: 28px; padding: 0; place-items: center; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #64748b; cursor: pointer; transition: border-color .15s, background-color .15s, color .15s; }
.copy-icon-button svg { width: 16px; height: 16px; }
.copy-button:hover, .copy-button.is-copied { border-color: #6ee7b7; background: #ecfdf5; color: #059669; }
.store-section { padding-top: 20px; }
.store-card { padding: 13px; border: 1px solid #dce5e1; border-radius: 14px; background: #fff; }
.store-name-row { display: flex; align-items: center; gap: 10px; }
.store-logo { display: grid; flex: 0 0 38px; width: 38px; height: 38px; place-items: center; border-radius: 50%; box-shadow: 0 3px 8px rgba(0, 19, 156, .2); overflow: hidden; position: relative; }
.store-logo-text { position: absolute; left: 50%; transform: translateX(-50%); text-transform: capitalize; font-size: 11px; font-weight: 700; color: #000; white-space: nowrap; }
.store-name-row > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.store-name-row strong { font-size: 15px; }
.store-name-row span:last-child, .store-name-row .store-branch { overflow: hidden; color: #53645e; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.store-name-row .store-detail-state.ordering { color: #c97800; font-weight: 700; }
.store-name-row .store-detail-state.done { color: #13865e; font-weight: 700; }
.order-items { margin-top: 10px; }
.order-items-empty { margin: 10px 0 2px; padding: 10px 0; border-top: 1px solid #edf1ef; color: #53645e; font-size: 13px; }
.order-item { display: flex; align-items: center; gap: 9px; padding: 10px 0; border-top: 1px solid #edf1ef; }
.item-thumb { display: grid; flex: 0 0 36px; width: 36px; height: 36px; place-items: center; border: 1px solid #edf1ef; border-radius: 8px; background: #fff; }
.item-thumb img { display: block; width: 100%; height: 100%; border-radius: inherit; object-fit: contain; }
.item-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.item-copy strong { overflow: hidden; font-size: 13px; line-height: 1.35; text-overflow: ellipsis; }
.item-qty { color: #53645e; font-size: 13px; white-space: nowrap; }
.item-price { color: #db4242; font-size: 13px; white-space: nowrap; }
.store-total { display: flex; justify-content: space-between; padding-top: 11px; border-top: 1px solid #dce5e1; font-size: 14px; }
.store-total strong:last-child { color: #db4242; }
.store-card > p { margin: 11px 0 0; color: #53645e; font-size: 12px; line-height: 1.5; }
.order-status { display: flex; width: 100%; margin-top: 11px; padding: 8px 10px; border-radius: 8px; background: #e0f6ef; color: #0b6254; font-size: 12px; font-weight: 700; line-height: 1.4; }
.order-status.warn { background: #fff6e8; color: #9a6700; }
.order-status.error { background: #fff1ef; color: #a43a31; }
.connection-error-detail { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding: 8px 10px; border: 1px solid #f2c7c2; border-radius: 8px; background: #fff8f7; }
.connection-error-detail code { min-width: 0; color: #7d2e27; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.connection-error-detail .copy-button { width: auto; height: auto; flex: none; padding: 6px 8px; border: 1px solid #e4aaa4; border-radius: 6px; background: #fff; color: #7d2e27; font-size: 11px; }
.payment-note { margin: 5px 16px 16px; color: #53645e; font-size: 13px; line-height: 1.55; }
.disclaimer { margin: 0; padding: 12px 16px; border-bottom: 1px solid #d9ebe5; background: #eef9f5; color: #52645e; font-size: 11px; line-height: 1.5; }
.open-btn { display: block; width: calc(100% - 32px); margin: 0 16px 16px; padding: 12px; border: 0; border-radius: 12px; background: #087d68; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
.open-btn:hover { filter: brightness(1.05); }
.open-btn.secondary { background: #53645e; }
@media (max-width: 340px) {
  .panel-shell { padding-inline: 8px; }
  .info-section, .store-section { padding-inline: 12px; }
  .item-price { font-size: 12px; }
}
`;

  function ensurePanelRoot() {
    if (panelRootEl) return panelRootEl;
    const host = document.createElement("div");
    host.id = PANEL_HOST_ID;
    host.setAttribute("style", "all: initial; position: fixed; inset: 0; width: 0; height: 0; overflow: visible; pointer-events: none; z-index: 2147483647;");
    document.documentElement.appendChild(host);
    panelShadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = PANEL_STYLES;
    panelShadow.appendChild(style);
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.hidden = true;
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("click", () => closePanel());
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    const head = document.createElement("div");
    head.className = "sheet-head";
    const grip = document.createElement("span");
    grip.className = "sheet-grip";
    const title = document.createElement("h1");
    title.className = "sheet-title";
    title.textContent = "Đơn hàng Zapee";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "sheet-close";
    close.setAttribute("aria-label", "Đóng bảng đơn hàng");
    close.textContent = "✕";
    close.addEventListener("click", () => closePanel());
    head.append(title, close);
    const body = document.createElement("div");
    body.className = "sheet-body";
    const root = document.createElement("main");
    root.className = "panel-shell";
    body.appendChild(root);
    sheet.append(grip, head, body);
    wrap.append(backdrop, sheet);
    panelShadow.appendChild(wrap);
    panelWrapEl = wrap;
    panelRootEl = root;
    return root;
  }

  function openPanel() {
    whenDomReady(() => {
      const root = ensurePanelRoot();
      panelWrapEl.hidden = false;
      panelOpen = true;
      lastRenderKey = "";
      void refreshPanel(root);
    });
  }

  function closePanel() {
    if (panelWrapEl) panelWrapEl.hidden = true;
    panelOpen = false;
  }

  function schedulePanelRender(delayMs = 120) {
    if (!panelOpen || !panelRootEl) return;
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      if (panelOpen && panelRootEl) void refreshPanel(panelRootEl);
    }, delayMs);
  }

  // --------- các hàm render port từ sidepanel.js (đổi tầng dữ liệu + tabs API)
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

  function shouldPaint(root, key) {
    if (key === lastRenderKey && root.childElementCount > 0) return false;
    lastRenderKey = key;
    return true;
  }

  function withLiveCart(payload, sessionId) {
    const live = liveCart;
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

  function hasOrderInfo(payload) {
    if (!payload) return false;
    return Boolean(
      payload.shippingAddress?.name || payload.shippingAddress?.phone || payload.shippingAddress?.fullAddress || payload.buyerName || payload.buyerPhone || payload.buyerAddress || payload.name || payload.phone || payload.address || payload.productName || Array.isArray(payload.products) && payload.products.length > 0 || Array.isArray(payload.items) && payload.items.length > 0
    );
  }

  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `${Math.round(n).toLocaleString("vi-VN")}đ`;
  }

  // Ảnh sản phẩm: link Google Drive không hiển thị trực tiếp được trong thẻ <img>
  // (Drive trả HTML). Đổi sang host thumbnail lh3, rồi đi qua /api/proxy-img của
  // web app để tránh chặn referrer/CORS — port từ sidepanel.js bản Chrome.
  // Khác biệt duy nhất: dùng `webAppUrl` (đã đồng bộ từ background) thay hằng số,
  // để bản dev/staging trỏ đúng proxy.
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
    const appBase = String(webAppUrl || DEFAULT_ZAPEE_WEB_APP_URL).replace(/\/+$/, "");
    if (normalized.startsWith("/api/proxy-img?")) {
      return `${appBase}${normalized}`;
    }
    if (/^https:\/\/lh3\.googleusercontent\.com\/d\//i.test(normalized)) {
      return `${appBase}/api/proxy-img?u=${encodeURIComponent(normalized)}`;
    }
    return normalized;
  }

  function chainLabel(chain) {
    const c = String(chain || "").toLowerCase();
    if (c === "coop" || c === "cop" || c === "coopmart") return "Co.opmart";
    if (c === "bhx" || c === "bachhoaxanh" || c === "aff-bhx") return "Bách Hóa Xanh";
    if (c === "alibaba" || c === "aff-alibaba") return "Alibaba.com";
    if (c === "shopee" || c === "spe" || c === "aff-shopee") return "Shopee";
    return chain ? chain.toUpperCase() : "Nhà bán";
  }

  function chainInitial(chain) {
    const c = String(chain || "").toLowerCase();
    if (c === "coop" || c === "cop") return "C";
    if (c === "bhx" || c === "aff-bhx") return "B";
    if (c === "alibaba" || c === "aff-alibaba") return "A";
    if (c === "shopee" || c === "spe" || c === "aff-shopee") return "S";
    return (chain || "?").slice(0, 1).toUpperCase();
  }

  // Port từ sidepanel.js Chrome 0.1.35 (sync 2a4f94d): tên thẻ cửa hàng bỏ nhãn
  // "Mua online" chung chung, ưu tiên tên thật → chi nhánh → nhãn chuỗi; kèm
  // các helper đọc mã ZIP từ payload cho phần thông tin người nhận.
  function isGenericOnlineLabel(value) {
    return /^mua online$/i.test(String(value || "").trim());
  }

  function storeCardTitle(storeName, branch, chain) {
    if (storeName && !isGenericOnlineLabel(storeName)) return storeName;
    if (branch && !isGenericOnlineLabel(branch)) return branch;
    return chainLabel(chain);
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
    return String(record.postalCode || record.zip || record.zipCode || record.postcode || "").trim();
  }

  // Port từ sidepanel.js Chrome (sync 18/08, STV3-9995 "Set up logo zapee"):
  // logo cửa hàng đổi từ chữ cái đầu trên nền xanh dương sang vòng tròn màu
  // THEO CHUỖI + nhãn chữ nhỏ (.store-logo-text). chainInitial giữ lại cho
  // store-tab-logo (upstream không đổi tab).
  var CHAIN_LOGO = {
    bhx: { label: "Bách Hóa Xanh", color: "#1aa64b" },
    coop: { label: "Co.opmart", color: "#0067b1" },
    shopee: { label: "Shopee", color: "#ee4d2d" }
  };

  function storeStatusText(status, completed) {
    if (completed || status === "placed") return "✓ Đã đặt";
    if (status === "login") return "Đăng nhập";
    if (status === "filling") return "Đang điền…";
    if (status === "review") return "Chờ xác nhận";
    if (status === "otp") return "Nhập OTP";
    if (status === "assist") return "Trợ lý";
    return "Chờ";
  }

  function storeTabState(storeKey, currentStoreKey, completed) {
    if (completed) return "done";
    if (storeKey === currentStoreKey) return "ordering";
    return "waiting";
  }

  function storeTabStatusText(state) {
    if (state === "done") return "Đã đặt";
    if (state === "ordering") return "Đang đặt hàng";
    return "Chờ";
  }

  function disclaimerBody(chain) {
    const c = String(chain || "").toLowerCase();
    if (c === "coop" || c === "cop" || c === "coopmart") {
      return "Zapee không liên kết, không đại diện cho Co.opmart. Đơn hàng được xác lập trực tiếp giữa bạn và Co.opmart trên website chính chủ. Giá, phí giao hàng và khuyến mãi có thể thay đổi khi đặt đơn.";
    }
    return "Zapee không liên kết, không đại diện cho các nhà bán được hiển thị. Đơn hàng được xác lập trực tiếp giữa bạn và nhà bán trên website chính chủ của họ.";
  }

  function extractProducts(payload) {
    const liveFirst = payload.liveCartSource ? Array.isArray(payload.items) ? payload.items : Array.isArray(payload.products) ? payload.products : null : null;
    const raw = liveFirst || (Array.isArray(payload.products) ? payload.products : null) || (Array.isArray(payload.items) ? payload.items : null) || [];
    if (raw.length) {
      return raw.map((item) => {
        const name = String(item.name || item.productName || item.title || "Sản phẩm");
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

  // B7: navigator.clipboard cần secure context + user gesture trên WebKit —
  // giữ fallback textarea + execCommand("copy").
  function copyTextToClipboard(value) {
    return new Promise((resolve) => {
      const fallback = () => {
        try {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          (panelShadow || document.body).appendChild(textarea);
          textarea.focus();
          textarea.select();
          const ok = document.execCommand("copy");
          textarea.remove();
          resolve(ok);
        } catch {
          resolve(false);
        }
      };
      try {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(value).then(() => resolve(true), fallback);
          return;
        }
      } catch {
      }
      fallback();
    });
  }

  // Icon nút sao chép — khớp FieldCopyButton của components/OrderInfoSection.tsx
  // (port từ sidepanel.js bản Chrome).
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
    button.addEventListener("click", () => {
      void copyTextToClipboard(value).then((ok) => {
        if (!ok) return;
        // Nút icon đổi path thành dấu tick + class .is-copied; nút chữ (ví dụ trong
        // khối lỗi kết nối) vẫn dùng đường cũ đổi textContent.
        const icon = button.querySelector("svg");
        const prevText = icon ? null : button.textContent;
        if (icon) {
          icon.innerHTML = COPIED_ICON_MARKUP;
          button.classList.add("is-copied");
        } else {
          button.textContent = "✓";
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
      });
    });
  }

  function fieldRow(label, value) {
    const wrap = document.createElement("div");
    wrap.className = "info-field";
    const lab = document.createElement("span");
    lab.textContent = label;
    const row = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = value || "—";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-button copy-icon-button";
    btn.append(copyIconSvg());
    btn.setAttribute("aria-label", `Sao chép ${label}`);
    btn.title = "Sao chép để dán sang trang cửa hàng";
    btn.tabIndex = -1;
    if (value) attachCopy(btn, value);
    row.append(strong, btn);
    wrap.append(lab, row);
    return wrap;
  }

  function brandHeader(region) {
    const header = document.createElement("header");
    header.className = "brand-header";
    const logoUrl = nativeGetURL("brand/logo.png");
    const city = (region || "").trim() || "Zapee Assistant";
    header.innerHTML = `
    <img src="${logoUrl}" alt="Zapee" />
    <div class="brand-copy">
      <div class="brand-badge-row">
        <span class="brand-badge">${city}</span>
      </div>
      <div class="brand-tagline">
        <strong>Kết nối mua bán - Không thu phí</strong>
        <span>Tìm gì cũng có - Giá hời quanh đây</span>
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

  function renderIdle(root) {
    currentSessionId = null;
    selectedStoreKey = null;
    lastScrolledStoreKey = null;
    lastTabScrollLeft = 0;
    if (!shouldPaint(root, panelRenderKey({ mode: "idle" }))) return;
    root.replaceChildren();
    root.append(brandHeader(null));
    const empty = document.createElement("section");
    empty.className = "empty-state";
    empty.innerHTML = `
    <strong>Chưa có đơn dự thảo</strong>
    <p>Tại Zapee, chọn đơn rồi bấm “Mở trang cửa hàng” / “Mua ngay”.</p>
  `;
    const steps = document.createElement("ul");
    steps.className = "empty-steps";
    for (const [i, text] of [
      "Mở Zapee, chọn sản phẩm và bấm “Mua ngay”.",
      "Trang sẽ chuyển sang website cửa hàng — tiện ích tự nhận đơn.",
      "Hoặc bấm biểu tượng trợ lý trên trang bán hàng."
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
    root.append(empty);
  }

  function renderOrderSheet(root, opts) {
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
    const selectedStatusText = selectedIsCurrent ? statusText : selectedCompleted ? `✓ Đã đặt${preferredStore.orderCode ? ` · Mã đơn ${preferredStore.orderCode}` : ""}` : `● ${storeStatusText(preferredStore.status, false)}`;
    const buyerName = String(payload.shippingAddress?.name || payload.buyerName || payload.name || "—");
    const buyerPhone = String(payload.shippingAddress?.phone || payload.buyerPhone || payload.phone || "—");
    const buyerAddress = String(payload.shippingAddress?.fullAddress || payload.shippingAddress?.addressLine || payload.buyerAddress || payload.address || "—");
    const buyerEmail = String(payload.shippingAddress?.email || payload.buyerEmail || payload.email || "").trim();
    const buyerZip = String(
      postalCodeFromRecord(payload.shippingAddress) || payload.zip || payload.postalCode || payload.zipCode || payload.postcode || postalCodeFromRecord(payload.buyer) || postalCodeFromRecord(payload.customer) || postalCodeFromRecord(payload.address) || postalCodeFromAddress(buyerAddress) || ""
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
    if (!shouldPaint(root, paintKey)) return;
    root.replaceChildren();
    root.append(brandHeader(regionFromPayload(payload)));
    const sheet = document.createElement("section");
    sheet.className = "order-sheet";
    const disc = document.createElement("p");
    disc.className = "disclaimer";
    disc.innerHTML = `<strong>Miễn trừ:</strong> ${disclaimerBody(chain)}`;
    sheet.append(disc);
    if (stores.length > 1) {
      const tabs = document.createElement("nav");
      tabs.className = "store-tabs";
      tabs.setAttribute("aria-label", "Đơn theo cửa hàng");
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
          renderOrderSheet(root, opts);
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
      check.textContent = "✓";
      const title = document.createElement("h1");
      title.textContent = `Đặt hàng ${chainLabel(chain)} thành công`;
      const description = document.createElement("p");
      description.textContent = "Đơn đã được xác nhận trên website chính chủ.";
      const code = document.createElement("div");
      code.className = "order-success-code";
      const codeLabel = document.createElement("span");
      codeLabel.textContent = "Mã đơn";
      const codeValue = document.createElement("strong");
      codeValue.textContent = preferredStore.orderCode || orderCompleted?.orderCode || "—";
      code.append(codeLabel, codeValue);
      success.append(check, title, description, code);
      const nextStoreName = String(payload.nextStoreName || "").trim();
      if (sessionId && nextStoreName) {
        const next = document.createElement("button");
        next.type = "button";
        next.className = "next-store-btn";
        next.textContent = `Tiếp tục → ${nextStoreName}`;
        next.addEventListener("click", () => {
          if (next.disabled) return;
          next.disabled = true;
          next.textContent = `Đang mở ${nextStoreName}…`;
          void engineContinueNextStore().then((result) => {
            if (result?.ok) return;
            next.disabled = false;
            next.textContent = `Thử lại → ${nextStoreName}`;
          }).catch(() => {
            next.disabled = false;
            next.textContent = `Thử lại → ${nextStoreName}`;
          });
        });
        success.append(next);
      }
      sheet.append(success);
      root.append(sheet);
      return;
    }
    const header = document.createElement("header");
    header.className = "order-header";
    const isLive = selectedIsCurrent && Boolean(payload.liveCartSource);
    header.innerHTML = isLive ? `<h1>Giỏ ${chainLabel(chain)} <small>· đồng bộ live</small></h1>` : `<h1>Đơn hàng — ${chainLabel(chain)} <small>· ${selectedCompleted ? "đã đặt" : "đơn dự thảo"}</small></h1>`;
    sheet.append(header);
    if (isLive) {
      const liveNote = document.createElement("p");
      liveNote.className = "payment-note";
      liveNote.style.marginTop = "0";
      liveNote.textContent = `Đang hiển thị các dòng được chọn, số lượng và giá từ giỏ ${chainLabel(chain)} (cập nhật khi bạn đổi trên trang).`;
      sheet.append(liveNote);
    }
    const info = document.createElement("section");
    info.className = "info-section";
    info.innerHTML = `<h2>THÔNG TIN GIAO/NHẬN HÀNG</h2>`;
    info.append(
      fieldRow("Họ tên", buyerName === "—" ? "" : buyerName),
      fieldRow("Số điện thoại / Zalo", buyerPhone === "—" ? "" : buyerPhone),
      fieldRow("Email", buyerEmail),
      fieldRow("Địa chỉ giao hàng", buyerAddress === "—" ? "" : buyerAddress),
      fieldRow("Mã ZIP", buyerZip)
    );
    sheet.append(info);
    const storeSec = document.createElement("section");
    storeSec.className = "store-section";
    storeSec.innerHTML = isLive ? `<h2>GIỎ HÀNG ${chainLabel(chain).toUpperCase()} (ĐỒNG BỘ)</h2>` : `<h2>ĐƠN THEO CỬA HÀNG</h2>`;
    const card = document.createElement("div");
    card.className = "store-card";
    const nameRow = document.createElement("div");
    nameRow.className = "store-name-row";
    const storeDisplayName = storeCardTitle(storeName, branch, chain);
    const realBranch = branch && !isGenericOnlineLabel(branch) && branch !== storeDisplayName ? branch : "";
    nameRow.innerHTML = `
    <span class="store-logo" aria-hidden="true" style="background: ${CHAIN_LOGO[String(chain || "").toLowerCase()]?.color || "#071eb4"};">
      <p class="store-logo-text">${CHAIN_LOGO[String(chain || "").toLowerCase()]?.label || chain}</p>
    </span>
    <div><strong>${storeDisplayName}</strong>${realBranch ? `<span class="store-branch">${realBranch}</span>` : ""}<span class="store-detail-state ${selectedTabState}">${storeTabStatusText(selectedTabState)}</span></div>
  `;
    card.append(nameRow);
    const list = document.createElement("div");
    list.className = "order-items";
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "order-items-empty";
      empty.textContent = "Chưa có sản phẩm nào được chọn trong giỏ hàng.";
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
          thumb.textContent = "🛍️";
        }, { once: true });
        thumb.append(img);
      } else {
        thumb.textContent = "🛍️";
      }
      const copy = document.createElement("div");
      copy.className = "item-copy";
      const nm = document.createElement("strong");
      nm.textContent = item.name;
      copy.append(nm);
      const qty = document.createElement("span");
      qty.className = "item-qty";
      qty.textContent = `×${item.qty}`;
      const price = document.createElement("strong");
      price.className = "item-price";
      price.textContent = money(item.lineTotal ?? (item.unitPrice || 0) * item.qty);
      row.append(thumb, copy, qty, price);
      list.append(row);
    }
    card.append(list);
    const storeTotal = document.createElement("div");
    storeTotal.className = "store-total";
    storeTotal.innerHTML = `<strong>Tổng đơn</strong><strong>${money(total)}</strong>`;
    card.append(storeTotal);
    const shipNote = document.createElement("p");
    shipNote.textContent = "🛵 Tổng thanh toán chưa bao gồm phí vận chuyển — có thể thay đổi khi đặt đơn.";
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
      copy.textContent = "Sao chép lỗi";
      copy.setAttribute("aria-label", "Sao chép chi tiết lỗi kết nối");
      attachCopy(copy, errorDetail);
      detail.append(text, copy);
      card.append(detail);
    }
    storeSec.append(card);
    sheet.append(storeSec);
    const payNote = document.createElement("p");
    payNote.className = "payment-note";
    payNote.innerHTML = `💳 Thanh toán: <strong>${pay}</strong> — Bạn chọn và thực hiện thanh toán trên website nhà bán. Zapee không thu thập thông tin thanh toán.`;
    sheet.append(payNote);
    if (entryUrl) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "open-btn";
      open.textContent = "Mở trang đặt hàng";
      open.addEventListener("click", () => {
        // Single-tab trên iOS: điều hướng ngay trong tab hiện tại.
        closePanel();
        try {
          location.assign(entryUrl);
        } catch {
        }
      });
      sheet.append(open);
    }
    root.append(sheet);
  }

  function renderPending(root, sessionId, payload, chain, entryUrl) {
    if (currentSessionId !== sessionId) selectedStoreKey = String(payload.storeKey || "") || null;
    currentSessionId = sessionId;
    renderOrderSheet(root, {
      chain,
      payload: withLiveCart(payload, sessionId),
      statusText: "● Đơn dự thảo sẵn sàng — bấm “Mở trang đặt hàng” để tiếp tục",
      statusClass: "warn",
      entryUrl
    });
  }

  function renderActive(root, status) {
    if (currentSessionId !== status.sessionId) selectedStoreKey = String(status.payload.storeKey || "") || null;
    currentSessionId = status.sessionId;
    const payload = withLiveCart(status.payload, status.sessionId);
    if (!hasOrderInfo(payload)) {
      currentSessionId = status.sessionId;
      if (!shouldPaint(root, panelRenderKey({ mode: "guidance", sessionId: status.sessionId, statusText: status.chain }))) return;
      root.replaceChildren();
      root.append(brandHeader(null));
      const empty = document.createElement("section");
      empty.className = "empty-state";
      empty.innerHTML = `
      <strong>Đang hướng dẫn trên ${chainLabel(status.chain)}</strong>
      <p>Phiên manual không có đơn dự thảo — làm theo bong bóng trợ lý trên trang bán hàng.</p>
    `;
      root.append(empty);
      return;
    }
    const lastLog = status.log?.length ? status.log[status.log.length - 1] : "";
    const isLive = Boolean(payload.liveCartSource);
    renderOrderSheet(root, {
      chain: status.chain,
      payload,
      statusText: isLive ? `● Đã đồng bộ giỏ ${chainLabel(status.chain)}` : lastLog ? `● ${lastLog}` : "● Đang hỗ trợ trên trang cửa hàng",
      sessionId: status.sessionId,
      orderCompleted: status.orderCompleted
    });
  }

  function renderConnectionFailure(root, failure) {
    currentSessionId = failure.sessionId;
    const payload = withLiveCart(failure.payload, failure.sessionId);
    const detail = `Mã: ${failure.code}\nLý do: ${failure.reason}\nGateway: ${failure.endpoint}`;
    if (hasOrderInfo(payload)) {
      renderOrderSheet(root, {
        chain: failure.chain,
        payload,
        statusText: `● Kết nối thất bại — ${failure.message}`,
        statusClass: "error",
        errorDetail: detail
      });
      return;
    }
    if (!shouldPaint(root, panelRenderKey({ mode: "error", sessionId: failure.sessionId, errorDetail: detail }))) return;
    root.replaceChildren();
    root.append(brandHeader(null));
    const empty = document.createElement("section");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = "Không kết nối được Agent Server";
    const text = document.createElement("p");
    text.textContent = failure.message;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "open-btn secondary";
    copy.textContent = "Sao chép chi tiết lỗi";
    attachCopy(copy, detail);
    empty.append(title, text, copy);
    root.append(empty);
  }

  async function refreshPanel(root) {
    // Thứ tự phân giải giữ như sidepanel.js: live → pending → active(durable)
    // → failure → idle; phiên live giờ nằm ngay trong tab (engine).
    if (session?.active) {
      renderActive(root, {
        sessionId: session.sessionId,
        chain: session.chain,
        payload: session.payload,
        log: session.log,
        orderCompleted: session.orderCompleted
      });
      return;
    }
    const snapshot = await bgSend({ type: "zapee_engine_snapshot" });
    if (snapshot?.liveCart) liveCart = snapshot.liveCart;
    if (snapshot?.pending) {
      renderPending(root, snapshot.pending.sessionId, snapshot.pending.payload, snapshot.pending.chain, snapshot.pending.entryUrl);
      return;
    }
    if (snapshot?.active?.payload) {
      const payload = withLiveCart(snapshot.active.payload, snapshot.active.sessionId);
      renderOrderSheet(root, {
        chain: snapshot.active.chain,
        payload,
        statusText: payload.liveCartSource ? `● Đã đồng bộ giỏ ${chainLabel(snapshot.active.chain)}` : "● Đơn còn — đang nối lại phiên (add-cart / checkout)",
        statusClass: payload.liveCartSource ? void 0 : "warn",
        sessionId: snapshot.active.sessionId,
        orderCompleted: snapshot.active.orderCompleted
      });
      return;
    }
    if (snapshot?.failure) {
      renderConnectionFailure(root, snapshot.failure);
      return;
    }
    renderIdle(root);
  }

  // ------------------------------------------------------------------ khởi động
  // content.js gửi zapee_content_ready ngay khi nạp → kickEngineBoot chạy từ
  // shim. Phòng trường hợp shim không bắt được (không cài được), tự khởi động.
  kickEngineBoot();
})();
