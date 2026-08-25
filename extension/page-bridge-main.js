"use strict";
(() => {
  // page-bridge-main.js — chạy trong MAIN world (thế giới của trang), phục vụ
  // các tác vụ bắt buộc phải thấy JS của trang (PORTING.md B5):
  //   - authenticated_request: đọc window.TekoID / token trong storage rồi fetch Bearer
  //   - dispatch_event: phát CustomEvent để React của trang nhận được
  //   - storage_event: phát StorageEvent thật sau khi seed localStorage Co.op
  //
  // Được khai báo trong manifest với "world": "MAIN" (Safari 17+). Trên Safari
  // cũ hơn, key "world" có thể bị bỏ qua và script này bị nạp vào isolated
  // world — khi đó phải thoát ngay để bản inject qua <script> tag (fallback của
  // session-engine.js / bridge-content.js) đảm nhận.
  try {
    if (typeof browser !== "undefined" && browser && browser.runtime && browser.runtime.id) return;
  } catch {
  }
  try {
    if (typeof chrome !== "undefined" && chrome && chrome.runtime && chrome.runtime.id) return;
  } catch {
  }
  if (window.__zapeePageBridgeLoaded) return;
  window.__zapeePageBridgeLoaded = true;

  var REQUEST_SOURCE = "zapee-ext-bridge";
  var RESPONSE_SOURCE = "zapee-page-bridge";

  function respond(requestId, response) {
    if (!requestId) return;
    try {
      window.postMessage({ source: RESPONSE_SOURCE, requestId, response }, window.location.origin);
    } catch {
    }
  }

  // Bản MAIN-world của executeAuthenticatedRequestInPage (Chrome build,
  // background.js L410–513): quét token OIDC trong local/sessionStorage, hỏi
  // window.TekoID, tuỳ chọn lookup GET rồi PATCH, cuối cùng fetch Bearer.
  async function runAuthenticatedRequest(rawUrl, method, body, lookup) {
    let target;
    try {
      target = new URL(String(rawUrl || ""));
    } catch {
      return { ok: false, error: "invalid_request_url", currentUrl: location.href };
    }
    if (target.protocol !== "https:" || target.username || target.password || target.port) {
      return { ok: false, error: "forbidden_request_url", currentUrl: location.href };
    }
    const tokenFrom = (raw) => {
      const text = String(raw || "").trim();
      if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) return text;
      try {
        const parsed = JSON.parse(text);
        const token = parsed.access_token ?? parsed.accessToken ?? parsed.id_token;
        return typeof token === "string" ? token.trim() : "";
      } catch {
        return "";
      }
    };
    const values = [];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index) || "";
          if (/oidc|oauth|token|teko|auth|user/i.test(key) && !/cart/i.test(key)) {
            values.push(storage.getItem(key) || "");
          }
        }
      } catch {
      }
    }
    let accessToken = values.map(tokenFrom).find(Boolean) || "";
    const tekoWindow = window;
    if (!accessToken && tekoWindow.TekoID?.user?.getAccessToken) {
      try {
        accessToken = String(await tekoWindow.TekoID.user.getAccessToken() || "");
      } catch {
        accessToken = "";
      }
    }
    if (!accessToken) return { ok: false, error: "auth_token_unavailable", currentUrl: location.href };
    try {
      let requestTarget = target;
      let requestMethod = String(method || "POST");
      if (lookup && typeof lookup === "object") {
        const lookupTarget = new URL(String(lookup.url || ""));
        if (lookupTarget.protocol !== "https:" || lookupTarget.username || lookupTarget.password || lookupTarget.port) {
          return { ok: false, error: "forbidden_lookup_url", currentUrl: location.href };
        }
        const lookupResponse = await fetch(lookupTarget.toString(), {
          method: "GET",
          headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
          cache: "no-store"
        });
        if (!lookupResponse.ok) {
          return { ok: false, error: `lookup_http_${lookupResponse.status}`, currentUrl: location.href };
        }
        const lookupData = await lookupResponse.json();
        const currentId = String(String(lookup.idPath || "").split(".").reduce(
          (value, key) => value && typeof value === "object" ? value[key] : void 0,
          lookupData
        ) || "").trim();
        if (currentId) {
          requestTarget = new URL(String(lookup.updateUrlTemplate || "").replace("{id}", encodeURIComponent(currentId)));
          if (requestTarget.protocol !== "https:" || requestTarget.username || requestTarget.password || requestTarget.port) {
            return { ok: false, error: "forbidden_update_url", currentUrl: location.href };
          }
          requestMethod = "PATCH";
        }
      }
      const response = await fetch(requestTarget.toString(), {
        method: requestMethod,
        headers: {
          accept: "*/*",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body || {}),
        cache: "no-store"
      });
      return {
        ok: response.ok,
        error: response.ok ? void 0 : `http_${response.status}`,
        currentUrl: location.href
      };
    } catch {
      return { ok: false, error: "request_failed", currentUrl: location.href };
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== REQUEST_SOURCE || typeof data.cmd !== "string") return;
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    switch (data.cmd) {
      case "ping": {
        respond(requestId, { ok: true, pong: true });
        return;
      }
      case "authenticated_request": {
        void runAuthenticatedRequest(data.url, data.method, data.body, data.lookup).then((result) => {
          respond(requestId, result);
        });
        return;
      }
      case "dispatch_event": {
        const name = String(data.name || "");
        if (!name.startsWith("zapee:")) {
          respond(requestId, { ok: false, error: "event_not_allowed" });
          return;
        }
        try {
          window.dispatchEvent(new CustomEvent(name, { detail: data.detail }));
          respond(requestId, { ok: true });
        } catch {
          respond(requestId, { ok: false, error: "dispatch_failed" });
        }
        return;
      }
      case "storage_event": {
        // StorageEvent giả phải phát từ MAIN world thì React của trang mới
        // thấy (PORTING.md B7) — bản phát từ isolated world bị WebKit chặn.
        try {
          window.dispatchEvent(new StorageEvent("storage", {
            key: String(data.key || ""),
            newValue: typeof data.newValue === "string" ? data.newValue : null,
            oldValue: typeof data.oldValue === "string" ? data.oldValue : null,
            storageArea: window.localStorage
          }));
          respond(requestId, { ok: true });
        } catch {
          respond(requestId, { ok: false, error: "storage_event_failed" });
        }
        return;
      }
      default:
        return;
    }
  });
})();
