"use strict";
(() => {
  // src/content/page-activate.ts
  var PAGE_ACTIVATE_EVENT = "zapee-assistant-page-activate";
  var PAGE_BRIDGE_ATTR = "data-zapee-page-bridge";

  // src/content/page-bridge.ts
  function activateControl(el) {
    try {
      el.focus({ preventScroll: true });
    } catch {
    }
    el.click();
  }
  document.documentElement.setAttribute(PAGE_BRIDGE_ATTR, "1");
  document.addEventListener(
    PAGE_ACTIVATE_EVENT,
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      event.stopImmediatePropagation();
      activateControl(target);
    },
    true
  );
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_ACTIVATE_EVENT) return;
    const token = typeof data.token === "string" ? data.token : "";
    if (!/^[a-zA-Z0-9_-]{4,32}$/.test(token)) return;
    const el = document.querySelector(`[data-zapee-page-click="${token}"]`);
    if (el instanceof HTMLElement) activateControl(el);
  });
})();
