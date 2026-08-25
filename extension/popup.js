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
  var root = document.getElementById("root");
  if (root) {
    void renderPopup(root);
  }
})();
