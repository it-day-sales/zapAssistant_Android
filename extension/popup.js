"use strict";
(() => {
  // src/background/session-store.ts
  var TTL_MS = 10 * 60 * 1e3;
  var PREPARED_HANDOFF_TAB_TTL_MS = 10 * 60 * 1e3;
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

  // src/popup/index.ts
  async function renderPopup(root2) {
    const [handoff] = await getAllPendingHandoffs();
    root2.innerHTML = "";
    const heading = document.createElement("h1");
    heading.textContent = "Zapee Assistant";
    root2.appendChild(heading);
    const body = document.createElement("p");
    root2.appendChild(body);
    if (!handoff) {
      body.textContent = "Ch\u01B0a c\xF3 y\xEAu c\u1EA7u \u0111\u1EB7t h\xE0ng t\u1EEB Zapee.";
      return;
    }
    const products = Array.isArray(handoff.payload.products) ? handoff.payload.products : Array.isArray(handoff.payload.items) ? handoff.payload.items : [];
    const productName = typeof handoff.payload.productName === "string" && handoff.payload.productName || (products[0] && typeof products[0].name === "string" ? products[0].name : "s\u1EA3n ph\u1EA9m");
    const chainLabel = String(handoff.chain || "").toLowerCase() === "coop" ? "Co.opmart" : String(handoff.chain || "").toUpperCase();
    body.textContent = `\u0110\u01A1n h\xE0ng ${productName}${products.length > 1 ? ` (+${products.length - 1})` : ""} \u0111ang ch\u1EDD t\u1EA1i ${chainLabel}.`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "M\u1EDF trang \u0111\u1EB7t h\xE0ng";
    button.addEventListener("click", () => {
      chrome.tabs.create({ url: handoff.entryUrl });
    });
    root2.appendChild(button);
  }
  // =================================================== màn chẩn đoán (iOS)
  // Bản iOS có 4 file viết riêng mà trên iPad không có cách nào xem log nếu
  // không nối cáp vào Mac. Khối này đọc lại những gì background đã ghi vào
  // storage.session và tự KẾT LUẬN mắt xích nào đứt, kèm nút copy toàn bộ.
  // Xem mục "Màn chẩn đoán" trong PORTING.md.
  function bgSend(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError;
          resolve(response);
        });
      } catch {
        resolve(void 0);
      }
    });
  }

  // ------------------------------------ mắt xích #0: quyền <all_urls> (Android)
  // F2: MV3 Firefox coi host permission là quyền thu hồi được — chưa cấp thì
  // content script lặng lẽ không chạy và MỌI mắt xích sau đứt theo.
  function checkAllUrlsPermission() {
    return new Promise((resolve) => {
      try {
        if (!chrome.permissions || !chrome.permissions.contains) {
          resolve(null);
          return;
        }
        chrome.permissions.contains({ origins: ["<all_urls>"] }, (granted) => {
          void chrome.runtime.lastError;
          resolve(granted === true);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function ageText(iso) {
    const t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return "";
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return `${sec}s trước`;
    if (sec < 3600) return `${Math.round(sec / 60)} phút trước`;
    return `${Math.round(sec / 3600)} giờ trước`;
  }

  function row(parent, label, value, cls) {
    const wrap = document.createElement("div");
    wrap.className = "diag-row";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("span");
    if (cls) v.className = cls;
    v.textContent = value;
    wrap.append(l, v);
    parent.appendChild(wrap);
    return wrap;
  }

  /**
   * Chấm điểm chuỗi nhân-quả dẫn tới "extension không hiện gì trên trang bán lẻ".
   * Trả về { verdict, cls } — câu kết luận đặt LÊN ĐẦU để không phải đọc log.
   */
  function diagnose(state, storageSession) {
    if (!storageSession) {
      return {
        verdict: "chrome.storage.session KHÔNG dùng được → cần Firefox 115+ (manifest đã khoá 128+). Mọi thứ phía sau sẽ hỏng theo.",
        cls: "diag-bad"
      };
    }
    const engine = state.sessionEngine;
    if (!engine) {
      return {
        verdict: "Content script CHƯA HỀ CHẠY trên trang nào → gần như chắc chắn chưa cấp quyền website (menu ⋮ → Extensions → ZapAssist → Access your data for all websites), hoặc site bị Mozilla quarantine — chứ không phải lỗi code.",
        cls: "diag-bad"
      };
    }
    if (engine.shimInstalled === false) {
      return {
        verdict: "Content script chạy nhưng SHIM MESSAGING KHÔNG CÀI ĐƯỢC → content.js không nói được với background, nên không có launcher/overlay.",
        cls: "diag-bad"
      };
    }
    const ready = state.contentReady;
    if (!ready) {
      return {
        verdict: "session-engine chạy nhưng background CHƯA NHẬN zapee_content_ready → hoặc content.js chưa nạp, hoặc shim không chuyển tiếp được xuống background.",
        cls: "diag-bad"
      };
    }
    if (ready.answered && ready.answered.supported === false) {
      const sc = state.supportCheck;
      if (sc && sc.error) {
        return {
          verdict: `Trang bị coi là KHÔNG được hỗ trợ vì check-support thất bại: ${sc.error}. Đây là lý do launcher không hiện — không phải trang không được hỗ trợ thật.`,
          cls: "diag-bad"
        };
      }
      if (sc && typeof sc.httpStatus === "number" && sc.httpStatus >= 400) {
        return {
          verdict: `agent-server trả HTTP ${sc.httpStatus} cho check-support → extension kết luận trang không được hỗ trợ.`,
          cls: "diag-bad"
        };
      }
      return {
        verdict: "agent-server trả lời rõ ràng là trang này KHÔNG được hỗ trợ (không phải lỗi mạng). Kiểm tra lại đúng host/chain của trang đang mở.",
        cls: "diag-warn"
      };
    }
    const boot = state.engineBoot;
    if (ready.answered && ready.answered.supported === true) {
      if (boot && boot.action === "none") {
        return {
          verdict: 'Trang ĐƯỢC hỗ trợ và launcher lẽ ra phải hiện. Không có handoff nào khớp host này (boot="none") nên overlay im lặng là ĐÚNG — mở panel bằng cách bấm launcher, hoặc tạo đơn lại từ zapee.one.',
          cls: "diag-warn"
        };
      }
      if (state.ws && state.ws.phase === "open") {
        return { verdict: "Chuỗi khởi động OK và WebSocket đang mở — phiên đang chạy bình thường.", cls: "diag-ok" };
      }
      if (state.ws && (state.ws.phase === "closed" || state.ws.phase === "error")) {
        return {
          verdict: `Đã nhận đơn nhưng WebSocket ${state.ws.phase === "error" ? "lỗi" : `đóng (code ${state.ws.code})`} → automation không chạy tiếp được.`,
          cls: "diag-bad"
        };
      }
      return { verdict: "Chuỗi khởi động OK. Nếu vẫn không thấy gì, bấm “Kiểm tra kết nối” rồi copy log.", cls: "diag-ok" };
    }
    return { verdict: "Chưa đủ dữ liệu — mở trang bán lẻ một lần rồi quay lại đây.", cls: "diag-warn" };
  }

  function buildReport(state, log, storageSession, verdict) {
    const lines = [];
    lines.push("=== ZAPASSIST — CHẨN ĐOÁN (FIREFOX ANDROID) ===");
    lines.push(`Thời điểm: ${new Date().toISOString()}`);
    lines.push(`Kết luận: ${verdict}`);
    lines.push(`User-Agent: ${navigator.userAgent}`);
    lines.push(`storage.session dùng được: ${storageSession ? "CÓ" : "KHÔNG"}`);
    lines.push("");
    lines.push("--- TRẠNG THÁI ---");
    lines.push(JSON.stringify(state, null, 2));
    lines.push("");
    lines.push(`--- NHẬT KÝ (${log.length} dòng) ---`);
    for (const entry of log) {
      lines.push(`${entry.t} [${entry.src}] ${entry.msg}${entry.x !== void 0 ? ` ${JSON.stringify(entry.x)}` : ""}`);
    }
    return lines.join("\n");
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function renderDiagnostics(host) {
    const data = await bgSend({ type: "zapee_diag_read" });
    const state = data?.state || {};
    const log = Array.isArray(data?.log) ? data.log : [];
    const storageSession = data?.storageSession !== false;
    const { verdict, cls } = diagnose(state, storageSession);
    // Android (F2): đưa trạng thái quyền vào state để "Copy log" mang theo luôn.
    const allUrlsGranted = await checkAllUrlsPermission();
    if (allUrlsGranted !== null) state.allUrlsPermission = allUrlsGranted ? "granted" : "MISSING";

    host.innerHTML = "";
    const details = document.createElement("details");
    details.className = "diag";
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "Chẩn đoán";
    details.appendChild(summary);

    row(details, "Kết luận", verdict, cls);

    // Android (F2): mắt xích #0 — đứng trước mọi mắt xích khác trong chuỗi.
    if (allUrlsGranted !== null) {
      row(
        details,
        "Quyền truy cập trang web",
        allUrlsGranted
          ? "đã cấp <all_urls>"
          : "CHƯA CẤP — bật “Access your data for all websites” trong menu ⋮ → Extensions → ZapAssist",
        allUrlsGranted ? "diag-ok" : "diag-bad"
      );
    }

    const engine = state.sessionEngine;
    row(
      details,
      "Content script",
      engine ? `đã chạy ${ageText(engine.at)} trên ${engine.host || "?"}` : "CHƯA chạy trên trang nào",
      engine ? "diag-ok" : "diag-bad"
    );
    if (engine) {
      row(details, "Shim messaging", engine.shimInstalled ? "đã cài" : "KHÔNG cài được", engine.shimInstalled ? "diag-ok" : "diag-bad");
    }
    const ready = state.contentReady;
    row(
      details,
      "content_ready",
      ready ? `${ready.answered?.supported === true ? `supported=true (${ready.answered.chain || "?"})` : "supported=false"} · ${ageText(ready.at)}` : "background chưa nhận",
      ready ? (ready.answered?.supported === true ? "diag-ok" : "diag-bad") : "diag-bad"
    );
    const sc = state.supportCheck;
    if (sc) {
      row(
        details,
        "check-support",
        sc.error ? sc.error : `HTTP ${sc.httpStatus} · ${sc.ms}ms`,
        sc.error || (sc.httpStatus >= 400) ? "diag-bad" : sc.ms > 1500 ? "diag-warn" : "diag-ok"
      );
    }
    if (state.engineBoot) {
      row(details, "engine_boot", String(state.engineBoot.action), state.engineBoot.action === "none" ? "diag-warn" : "diag-ok");
    }
    if (state.mainWorld) {
      row(details, "MAIN world", `${state.mainWorld.ok ? "OK" : "KHÔNG với tới"} — ${state.mainWorld.via}`, state.mainWorld.ok ? "diag-ok" : "diag-bad");
    }
    if (state.ws) {
      row(
        details,
        "WebSocket",
        `${state.ws.phase}${typeof state.ws.code === "number" ? ` code=${state.ws.code}` : ""} · ${ageText(state.ws.at)}`,
        state.ws.phase === "open" ? "diag-ok" : state.ws.phase === "connecting" ? "diag-warn" : "diag-bad"
      );
    }
    if (state.selfTest) {
      for (const probe of state.selfTest.probes || []) {
        row(
          details,
          probe.label.includes("agent-server") ? "agent-server" : "web app",
          probe.ok ? `OK ${probe.httpStatus} · ${probe.ms}ms` : probe.error || `HTTP ${probe.httpStatus} · ${probe.ms}ms`,
          probe.ok ? (probe.ms > 2000 ? "diag-warn" : "diag-ok") : "diag-bad"
        );
      }
    }
    row(details, "iPadOS/Safari", String(navigator.userAgent).replace(/^Mozilla\/5\.0 /, ""), "");

    const actions = document.createElement("div");
    actions.className = "diag-actions";
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.textContent = "Kiểm tra kết nối";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "secondary";
    copyBtn.textContent = "Copy log";
    actions.append(testBtn, copyBtn);
    details.appendChild(actions);

    const logBox = document.createElement("div");
    logBox.className = "diag-log";
    logBox.textContent = log.length
      ? log.slice(-40).map((entry) => `${String(entry.t).slice(11, 19)} [${entry.src}] ${entry.msg}`).join("\n")
      : "(chưa có nhật ký — mở một trang bán lẻ rồi quay lại)";
    details.appendChild(logBox);

    host.appendChild(details);

    testBtn.addEventListener("click", () => {
      testBtn.disabled = true;
      testBtn.textContent = "Đang kiểm…";
      void (async () => {
        let pageUrl = "";
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          pageUrl = tab?.url || "";
        } catch {
        }
        await bgSend({ type: "zapee_diag_selftest", url: pageUrl });
        await renderDiagnostics(host);
      })();
    });

    copyBtn.addEventListener("click", () => {
      void copyText(buildReport(state, log, storageSession, verdict)).then((ok) => {
        copyBtn.textContent = ok ? "Đã copy ✓" : "Copy thất bại";
        window.setTimeout(() => {
          copyBtn.textContent = "Copy log";
        }, 1600);
      });
    });
  }

  var root = document.getElementById("root");
  if (root) {
    void renderPopup(root);
  }
  // Màn chẩn đoán chạy độc lập với renderPopup: nó append vào <body>, không đụng
  // #root, nên không cần chờ — và vẫn hiện được kể cả khi renderPopup lỗi.
  var diagHost = document.createElement("div");
  document.body.appendChild(diagHost);
  void renderDiagnostics(diagHost);
})();
