"use strict";
(() => {
  // src/content/locators.ts
  var ROLE_SELECTORS = {
    button: 'button, input[type="button"], input[type="submit"], [role="button"]',
    link: 'a[href], [role="link"]',
    textbox: 'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="search"], input[type="password"], textarea, [role="textbox"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    combobox: 'select, [role="combobox"]'
  };
  function normalizeText(raw) {
    return raw.trim().replace(/\s+/g, " ");
  }
  function elementText(el) {
    return normalizeText(el.textContent ?? "");
  }
  var renderedCache = null;
  var documentQueryCache = null;
  function isRenderedCandidate(el) {
    const cached = renderedCache?.get(el);
    if (cached !== void 0) return cached;
    const rendered = computeRendered(el);
    renderedCache?.set(el, rendered);
    return rendered;
  }
  function computeRendered(el) {
    let current = el;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || current.getAttribute("aria-hidden") === "true" || current.hasAttribute("hidden")) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }
  function pickRenderedFirst(candidates) {
    return candidates.find(isRenderedCandidate) ?? candidates[0] ?? null;
  }
  function matchesText(candidateText, value, exact) {
    return exact ? candidateText === value : candidateText.includes(value);
  }
  function labelTargetElement(label) {
    const forAttr = label.getAttribute("for");
    if (forAttr) {
      const byId = label.ownerDocument.getElementById(forAttr);
      if (byId) return byId;
    }
    return label.querySelector("input, select, textarea");
  }
  function unwrapQuotes(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("'") && trimmed.endsWith("'") || trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }
  function splitCommaSelectors(selector) {
    const parts = [];
    let current = "";
    let depth = 0;
    let inQuote = null;
    for (let i = 0; i < selector.length; i++) {
      const char = selector[i];
      if (inQuote) {
        current += char;
        if (char === inQuote && selector[i - 1] !== "\\") {
          inQuote = null;
        }
      } else {
        if (char === '"' || char === "'") {
          inQuote = char;
          current += char;
        } else if (char === "(") {
          depth++;
          current += char;
        } else if (char === ")") {
          depth--;
          current += char;
        } else if (char === "," && depth === 0) {
          parts.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
    }
    if (current.trim()) {
      parts.push(current.trim());
    }
    return parts;
  }
  function beginCustomFilter(selector, i, filters) {
    let baseSelector = selector.slice(0, i).trim();
    if (filters.length > 0) {
      return "";
    }
    if (!baseSelector || baseSelector.endsWith(">") || baseSelector.endsWith("+") || baseSelector.endsWith("~") || baseSelector.endsWith(" ")) {
      baseSelector = (baseSelector ? baseSelector + " " : "") + "*";
    }
    return baseSelector;
  }
  function extractPseudoClasses(selector) {
    const filters = [];
    const customPseudos = ["has-text", "text-is", "text", "has"];
    let i = 0;
    let baseSelector = "";
    while (i < selector.length) {
      if (selector[i] === ":") {
        const hasValueToken = selector.startsWith(":has-value", i);
        const afterHasValue = hasValueToken ? selector[i + ":has-value".length] : "";
        if (hasValueToken && (!afterHasValue || afterHasValue === "(" || afterHasValue === ":" || afterHasValue === " " || afterHasValue === ")" || afterHasValue === "," || afterHasValue === ">" || afterHasValue === "+" || afterHasValue === "~")) {
          if (filters.length === 0) baseSelector = beginCustomFilter(selector, i, filters) || baseSelector;
          i += ":has-value".length;
          if (selector[i] === "(") {
            i += 1;
            while (i < selector.length && selector[i] !== ")") i += 1;
            if (selector[i] === ")") i += 1;
          }
          filters.push({ name: "has-value", arg: "" });
          continue;
        }
        let matchedName = null;
        for (const name of customPseudos) {
          if (selector.startsWith(":" + name + "(", i)) {
            matchedName = name;
            break;
          }
        }
        if (matchedName) {
          if (filters.length === 0) {
            baseSelector = selector.slice(0, i).trim();
            if (!baseSelector || baseSelector.endsWith(">") || baseSelector.endsWith("+") || baseSelector.endsWith("~") || baseSelector.endsWith(" ")) {
              baseSelector = (baseSelector ? baseSelector + " " : "") + "*";
            }
          }
          i += matchedName.length + 2;
          const argStart = i;
          let depth = 1;
          let inQuote = null;
          while (i < selector.length && depth > 0) {
            const char = selector[i];
            if (inQuote) {
              if (char === inQuote && selector[i - 1] !== "\\") {
                inQuote = null;
              }
            } else {
              if (char === '"' || char === "'") {
                inQuote = char;
              } else if (char === "(") {
                depth++;
              } else if (char === ")") {
                depth--;
              }
            }
            if (depth > 0) i++;
          }
          const arg = selector.slice(argStart, i);
          if (i < selector.length && selector[i] === ")") {
            i++;
          }
          filters.push({ name: matchedName, arg });
          continue;
        }
      }
      if (filters.length === 0) {
        i++;
      } else {
        i++;
      }
    }
    if (filters.length === 0) {
      baseSelector = selector;
    }
    return { baseSelector, filters };
  }
  function splitCompoundSelectors(selector) {
    const tokens = [];
    let current = "";
    let pendingCombinator = null;
    let parenDepth = 0;
    let bracketDepth = 0;
    let inQuote = null;
    let i = 0;
    const flush2 = () => {
      const trimmed = current.trim();
      if (trimmed) {
        tokens.push({ combinator: pendingCombinator, compound: trimmed });
        pendingCombinator = null;
      }
      current = "";
    };
    while (i < selector.length) {
      const char = selector[i];
      if (inQuote) {
        current += char;
        if (char === inQuote && selector[i - 1] !== "\\") inQuote = null;
        i++;
        continue;
      }
      if (char === '"' || char === "'") {
        inQuote = char;
        current += char;
        i++;
        continue;
      }
      if (char === "(") {
        parenDepth++;
        current += char;
        i++;
        continue;
      }
      if (char === ")") {
        parenDepth--;
        current += char;
        i++;
        continue;
      }
      if (char === "[") {
        bracketDepth++;
        current += char;
        i++;
        continue;
      }
      if (char === "]") {
        bracketDepth--;
        current += char;
        i++;
        continue;
      }
      if (parenDepth === 0 && bracketDepth === 0) {
        if (char === ">" || char === "+" || char === "~") {
          flush2();
          pendingCombinator = char;
          i++;
          while (i < selector.length && /\s/.test(selector[i])) i++;
          continue;
        }
        if (/\s/.test(char)) {
          let lookahead = i;
          while (lookahead < selector.length && /\s/.test(selector[lookahead])) lookahead++;
          const next = selector[lookahead];
          if (next === ">" || next === "+" || next === "~") {
            i = lookahead;
            continue;
          }
          if (current.trim()) {
            flush2();
            pendingCombinator = " ";
          }
          i = lookahead;
          continue;
        }
      }
      current += char;
      i++;
    }
    flush2();
    return tokens;
  }
  function applyPseudoFilters(candidates, filters) {
    let result = candidates;
    for (const filter of filters) {
      if (filter.name === "has-text" || filter.name === "text") {
        const targetText = unwrapQuotes(filter.arg).toLowerCase();
        result = result.filter((el) => elementText(el).toLowerCase().includes(targetText));
      } else if (filter.name === "text-is") {
        const targetText = unwrapQuotes(filter.arg).toLowerCase();
        result = result.filter((el) => elementText(el).toLowerCase() === targetText);
      } else if (filter.name === "has") {
        const subSelector = filter.arg;
        result = result.filter((el) => queryCss(el, subSelector).length > 0);
      } else if (filter.name === "has-value") {
        result = result.filter((el) => {
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            return String(el.value || "").trim() !== "";
          }
          return false;
        });
      }
    }
    return result;
  }
  function resolveCompoundToken(contexts, token) {
    const { baseSelector, filters } = extractPseudoClasses(token.compound);
    const matched = [];
    const addUnique = (el) => {
      if (!matched.includes(el)) matched.push(el);
    };
    for (const context of contexts) {
      let found;
      try {
        if (token.combinator === null || token.combinator === " ") {
          found = Array.from(context.querySelectorAll(baseSelector));
        } else if (token.combinator === ">") {
          const parent = context;
          found = parent.children ? Array.from(parent.children).filter((child) => child.matches(baseSelector)) : [];
        } else if (token.combinator === "+") {
          const sibling = context.nextElementSibling;
          found = sibling && sibling.matches(baseSelector) ? [sibling] : [];
        } else {
          found = [];
          let sibling = context.nextElementSibling;
          while (sibling) {
            if (sibling.matches(baseSelector)) found.push(sibling);
            sibling = sibling.nextElementSibling;
          }
        }
      } catch {
        found = [];
      }
      for (const el of applyPseudoFilters(found, filters)) addUnique(el);
    }
    return matched;
  }
  function queryCss(root, selector) {
    if (!selector || !selector.trim()) return [];
    if (documentQueryCache && root === document) {
      const cached = documentQueryCache.get(selector);
      if (cached) return cached;
      const computed = queryCssUncached(root, selector);
      documentQueryCache.set(selector, computed);
      return computed;
    }
    return queryCssUncached(root, selector);
  }
  function queryCssUncached(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
    }
    const parts = splitCommaSelectors(selector);
    if (parts.length > 1) {
      const results = [];
      for (const part of parts) {
        const sub = queryCss(root, part);
        for (const el of sub) {
          if (!results.includes(el)) results.push(el);
        }
      }
      return results;
    }
    const tokens = splitCompoundSelectors(selector);
    let candidates = [root];
    for (const token of tokens) {
      candidates = resolveCompoundToken(candidates, token);
      if (candidates.length === 0) break;
    }
    return candidates;
  }
  function pickInnermost(candidates) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    let best = null;
    let bestCount = Infinity;
    for (const candidate of candidates) {
      let count = 0;
      for (const other of candidates) {
        if (other !== candidate && candidate.contains(other)) count++;
      }
      if (count < bestCount) {
        bestCount = count;
        best = candidate;
      }
    }
    return best;
  }
  function resolveByText(value, exact) {
    const all = queryCss(document, "body, body *");
    const candidates = all.filter((el) => matchesText(elementText(el), value, exact));
    const rendered = candidates.filter(isRenderedCandidate);
    return pickInnermost(rendered.length > 0 ? rendered : candidates);
  }
  function resolveByLabel(value, exact) {
    const labels = queryCss(document, "label");
    const renderedLabels = labels.filter(isRenderedCandidate);
    for (const label of renderedLabels.length > 0 ? renderedLabels : labels) {
      if (matchesText(elementText(label), value, exact)) {
        const target = labelTargetElement(label);
        if (target) return target;
      }
    }
    return null;
  }
  function accessibleName(el, role) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return normalizeText(ariaLabel);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter((node) => Boolean(node)).map(elementText).filter(Boolean).join(" ");
      if (text) return normalizeText(text);
    }
    if (role === "button" || role === "link") {
      return elementText(el);
    }
    const labels = queryCss(document, "label");
    for (const label of labels) {
      if (labelTargetElement(label) === el) return elementText(label);
    }
    return "";
  }
  function resolveByRole(role, name, exact) {
    if (!role) return null;
    const selector = ROLE_SELECTORS[role];
    if (!selector) return null;
    const candidates = queryCss(document, selector);
    const rendered = candidates.filter(isRenderedCandidate);
    const preferred = rendered.length > 0 ? rendered : candidates;
    if (!name) return preferred[0] ?? null;
    for (const candidate of preferred) {
      if (matchesText(accessibleName(candidate, role), name, exact)) return candidate;
    }
    return null;
  }
  function resolveLocator(locator) {
    switch (locator.strategy) {
      case "css":
        return locator.value ? pickRenderedFirst(queryCss(document, locator.value)) : null;
      case "test_id":
        return locator.value ? pickRenderedFirst(queryCss(document, `[data-testid="${CSS.escape(locator.value)}"]`)) : null;
      case "text":
        return locator.value ? resolveByText(locator.value, locator.exact) : null;
      case "label":
        return locator.value ? resolveByLabel(locator.value, locator.exact) : null;
      case "role":
        return resolveByRole(locator.role, locator.name, locator.exact);
      default:
        return null;
    }
  }
  var SUPPORTED_ROLES = Object.keys(ROLE_SELECTORS);

  // src/content/page-activate.ts
  var PAGE_ACTIVATE_EVENT = "zapee-assistant-page-activate";
  var PAGE_BRIDGE_ATTR = "data-zapee-page-bridge";
  var PAGE_CLICK_ATTR = "data-zapee-page-click";
  var PAGE_CLICK_MESSAGE = "zapee_page_click";

  // src/content/executor.ts
  var DEFAULT_TIMEOUT_MS = 5e3;
  var POLL_INTERVAL_MS = 150;
  var READ_TEXT_MAX_LENGTH = 4e3;
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function hasLaidOutBox(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (el instanceof HTMLElement && (el.offsetWidth > 0 || el.offsetHeight > 0)) return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }
  function isElementVisible(el) {
    if (hasLaidOutBox(el)) return true;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    for (const child of el.children) {
      const childStyle = window.getComputedStyle(child);
      if (childStyle.position !== "fixed" && childStyle.position !== "absolute") continue;
      if (hasLaidOutBox(child)) return true;
    }
    return false;
  }
  async function pollForElement(locator, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const el = resolveLocator(locator);
      if (el) return el;
      if (Date.now() >= deadline) return null;
      await sleep(POLL_INTERVAL_MS);
    }
  }
  async function pollForState(locator, state, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const el = resolveLocator(locator);
      const visible8 = el ? isElementVisible(el) : false;
      const matched = state === "hidden" ? !visible8 : visible8;
      if (matched) return true;
      if (Date.now() >= deadline) return false;
      await sleep(POLL_INTERVAL_MS);
    }
  }
  async function pollCurrentVisibility(locator, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const el = resolveLocator(locator);
      const visible8 = el ? isElementVisible(el) : false;
      if (visible8) return true;
      if (Date.now() >= deadline) return visible8;
      await sleep(POLL_INTERVAL_MS);
    }
  }
  function setNativeValue(el, value) {
    const prototype = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    try {
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: value
      }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function dispatchKeyEvents(target, key) {
    const isPrintable = key.length === 1;
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    if (isPrintable) {
      target.dispatchEvent(new KeyboardEvent("keypress", { key, bubbles: true }));
    }
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  }
  function newClickToken() {
    return `z${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
  function requestPageWorldClick(token, preventDefaultNavigation = false) {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
        resolve(false);
        return;
      }
      try {
        chrome.runtime.sendMessage({
          type: PAGE_CLICK_MESSAGE,
          token,
          ...preventDefaultNavigation ? { preventDefaultNavigation: true } : {}
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(Boolean(response && response.ok));
        });
      } catch {
        resolve(false);
      }
    });
  }
  function dispatchNativeClickFallback(el) {
    const mouseOptions = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 1,
      view: window
    };
    const PointerEventCtor = window.PointerEvent;
    if (typeof PointerEventCtor === "function") {
      el.dispatchEvent(new PointerEventCtor("pointerdown", { ...mouseOptions, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    }
    el.dispatchEvent(new window.MouseEvent("mousedown", mouseOptions));
    if (typeof PointerEventCtor === "function") {
      el.dispatchEvent(new PointerEventCtor("pointerup", { ...mouseOptions, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    }
    el.dispatchEvent(new window.MouseEvent("mouseup", { ...mouseOptions, buttons: 0 }));
    el.dispatchEvent(new window.MouseEvent("click", { ...mouseOptions, buttons: 0 }));
  }
  function isolatedClick(el, preventDefaultNavigation = false) {
    if (el instanceof HTMLElement) {
      const blockDefault = (event) => {
        const target = event.target;
        if (target === el || target instanceof Node && el.contains(target)) event.preventDefault();
      };
      if (preventDefaultNavigation) document.addEventListener("click", blockDefault);
      try {
        if (document.documentElement.hasAttribute(PAGE_BRIDGE_ATTR)) {
          el.dispatchEvent(new Event(PAGE_ACTIVATE_EVENT, { bubbles: true, cancelable: true, composed: true }));
        }
        el.click();
      } finally {
        if (preventDefaultNavigation) document.removeEventListener("click", blockDefault);
      }
      return;
    }
    dispatchNativeClickFallback(el);
  }
  async function clickElement(el, preventDefaultNavigation = false) {
    if (!(el instanceof HTMLElement)) {
      dispatchNativeClickFallback(el);
      return;
    }
    const token = newClickToken();
    el.setAttribute(PAGE_CLICK_ATTR, token);
    try {
      if (await requestPageWorldClick(token, preventDefaultNavigation)) return;
    } finally {
      el.removeAttribute(PAGE_CLICK_ATTR);
    }
    isolatedClick(el, preventDefaultNavigation);
  }
  async function executeDomOp(msg) {
    const timeoutMs = msg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (msg.contextUrl) {
      let expectedOrigin = "";
      let currentOrigin = "";
      try {
        const expected = new URL(msg.contextUrl);
        const current = new URL(location.href);
        if (/^https?:$/.test(expected.protocol)) expectedOrigin = expected.origin;
        if (/^https?:$/.test(current.protocol)) currentOrigin = current.origin;
      } catch {
      }
      if (expectedOrigin && currentOrigin && expectedOrigin !== currentOrigin) {
        return {
          type: "zapee_dom_op_result",
          opId: msg.opId,
          ok: false,
          error: "stale_document_context",
          currentUrl: location.href
        };
      }
    }
    switch (msg.kind) {
      case "wait_for": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "missing_locator", currentUrl: location.href };
        const state = msg.state ?? "visible";
        const matched = await pollForState(msg.locator, state, timeoutMs);
        return {
          type: "zapee_dom_op_result",
          opId: msg.opId,
          ok: matched,
          error: matched ? void 0 : "timeout",
          currentUrl: location.href
        };
      }
      case "is_visible": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, visible: false, currentUrl: location.href };
        const capped = Math.min(timeoutMs, 1e3);
        const visible8 = await pollCurrentVisibility(msg.locator, capped);
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, visible: visible8, currentUrl: location.href };
      }
      case "click": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        let el = await pollForElement(msg.locator, timeoutMs);
        if (!el) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        el.scrollIntoView({ block: "center" });
        el = resolveLocator(msg.locator) ?? el;
        await clickElement(el, msg.preventDefaultNavigation === true);
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, currentUrl: location.href };
      }
      case "fill": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        const el = await pollForElement(msg.locator, timeoutMs);
        if (!el) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const wanted = msg.value ?? "";
          const digitsOf = (value) => value.replace(/\D/g, "");
          const applied = () => el.value === wanted || digitsOf(wanted) !== "" && digitsOf(el.value) === digitsOf(wanted);
          setNativeValue(el, wanted);
          await sleep(0);
          if (!applied()) {
            setNativeValue(el, wanted);
            await sleep(0);
          }
          if (!applied()) {
            return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "value_not_applied", currentUrl: location.href };
          }
        } else {
          return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "unsupported_element", currentUrl: location.href };
        }
        if (msg.commit) el.blur();
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, currentUrl: location.href };
      }
      case "set_checked": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        const el = await pollForElement(msg.locator, timeoutMs);
        if (!el) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        if (el instanceof HTMLInputElement && el.checked !== msg.checked) {
          el.click();
        }
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, currentUrl: location.href };
      }
      case "press": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        const el = await pollForElement(msg.locator, timeoutMs);
        if (!el) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        el.focus();
        dispatchKeyEvents(el, msg.key ?? "");
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, currentUrl: location.href };
      }
      case "press_page": {
        const target = document.activeElement ?? document.body;
        dispatchKeyEvents(target, msg.key ?? "");
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, currentUrl: location.href };
      }
      case "scroll_into_view": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        const el = await pollForElement(msg.locator, timeoutMs);
        if (!el) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        el.scrollIntoView({ block: "center" });
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, currentUrl: location.href };
      }
      case "read_text": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "missing_locator", currentUrl: location.href };
        const el = await pollForElement(msg.locator, timeoutMs);
        if (!el) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        const text = el.textContent ?? "";
        return {
          type: "zapee_dom_op_result",
          opId: msg.opId,
          ok: true,
          text: text.slice(0, READ_TEXT_MAX_LENGTH),
          currentUrl: location.href
        };
      }
      case "read_attribute": {
        if (!msg.locator) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "missing_locator", currentUrl: location.href };
        if (!msg.attribute) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "missing_attribute", currentUrl: location.href };
        const el = await pollForElement(msg.locator, timeoutMs);
        if (!el) return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "element_not_found", currentUrl: location.href };
        const value = el.getAttribute(msg.attribute);
        return {
          type: "zapee_dom_op_result",
          opId: msg.opId,
          ok: true,
          text: (value ?? "").slice(0, READ_TEXT_MAX_LENGTH),
          currentUrl: location.href
        };
      }
      case "authenticated_request": {
        let target;
        try {
          target = new URL(msg.url ?? "");
        } catch {
          return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "invalid_request_url", currentUrl: location.href };
        }
        if (target.protocol !== "https:" || target.username || target.password || target.port) {
          return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "forbidden_request_url", currentUrl: location.href };
        }
        const storedValues = [];
        for (const storage of [window.localStorage, window.sessionStorage]) {
          try {
            for (let index = 0; index < storage.length; index += 1) {
              const key = storage.key(index) ?? "";
              if (/oauth|oidc|auth|user|access.?token/i.test(key) && !/cart/i.test(key)) {
                storedValues.push(storage.getItem(key) ?? "");
              }
            }
          } catch {
          }
        }
        const tokenFrom = (raw) => {
          const value = raw.trim();
          if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return value;
          try {
            const parsed = JSON.parse(value);
            const token = parsed.access_token ?? parsed.accessToken ?? parsed.id_token;
            return typeof token === "string" ? token.trim() : "";
          } catch {
            return "";
          }
        };
        const accessToken = storedValues.map(tokenFrom).find(Boolean) ?? "";
        if (!accessToken) {
          return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "auth_token_unavailable", currentUrl: location.href };
        }
        try {
          const response = await fetch(target.toString(), {
            method: msg.method ?? "POST",
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json"
            },
            body: JSON.stringify(msg.body ?? {}),
            cache: "no-store"
          });
          return {
            type: "zapee_dom_op_result",
            opId: msg.opId,
            ok: response.ok,
            error: response.ok ? void 0 : `http_${response.status}`,
            currentUrl: location.href
          };
        } catch {
          return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: "request_failed", currentUrl: location.href };
        }
      }
      case "navigate": {
        const url = msg.url ?? "";
        window.location.href = url;
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: true, currentUrl: url };
      }
      default: {
        const exhaustiveCheck = msg.kind;
        return { type: "zapee_dom_op_result", opId: msg.opId, ok: false, error: `unknown_kind:${String(exhaustiveCheck)}`, currentUrl: location.href };
      }
    }
  }

  // src/content/guide-viewport.ts
  function rectIntersectsViewport(rect, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight;
  }
  function elementIntersectsViewport(element) {
    return rectIntersectsViewport(element.getBoundingClientRect());
  }

  // src/content/guide-direction.ts
  var HAND_BY_PLACEMENT = {
    // The note sits on this side of the target, so the hand points back at it.
    left: "\u{1F449}",
    right: "\u{1F448}",
    top: "\u{1F447}",
    bottom: "\u{1F446}"
  };
  function pointAtTarget(label, placement) {
    const clean = String(label || "").replace(/^[👉👈👆👇]\s*/u, "").trim();
    return `${HAND_BY_PLACEMENT[placement]} ${clean}`;
  }

  // src/content/guide-note.ts
  var GUIDE_TOKENS = {
    accent: "#f5a623",
    noteBackground: "#fffaf0",
    noteText: "#7a4e00",
    actionBackground: "#11a84e",
    actionHover: "#0c8b43",
    fontStack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
  };
  function guideHighlightCss(selectors) {
    const { accent, noteBackground, noteText, actionBackground, actionHover, fontStack } = GUIDE_TOKENS;
    const blocks = [];
    if (selectors.target) {
      blocks.push(`
${selectors.target} {
  outline: 3px solid ${accent} !important;
  outline-offset: 3px !important;
  border-radius: 8px !important;
  box-shadow: 0 0 0 6px rgba(245, 166, 35, .28) !important;
}`);
    }
    if (selectors.ring) {
      blocks.push(`
${selectors.ring} {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  border: 3px solid ${accent};
  border-radius: 10px;
  box-shadow: 0 0 0 6px rgba(245, 166, 35, .35), 0 0 18px rgba(245, 166, 35, .55);
  background: transparent;
  animation: zapee-guide-pulse 1.4s ease-in-out infinite;
}
@keyframes zapee-guide-pulse {
  0%, 100% { box-shadow: 0 0 0 6px rgba(245, 166, 35, .35), 0 0 18px rgba(245, 166, 35, .5); }
  50% { box-shadow: 0 0 0 10px rgba(245, 166, 35, .16), 0 0 28px rgba(245, 166, 35, .32); }
}`);
    }
    if (selectors.note) {
      blocks.push(`
${selectors.note} {
  position: fixed;
  z-index: 2147483646;
  box-sizing: border-box;
  max-width: min(260px, calc(100vw - 24px));
  padding: 9px 12px;
  border: 1.5px solid ${accent};
  border-radius: 10px;
  background: ${noteBackground};
  color: ${noteText};
  font: 700 13.5px/1.35 ${fontStack};
  text-align: left;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .14);
  /* H\u1ED9p ch\u1EC9 \u0111\u1EC3 \u0111\u1ECDc; ch\u1EC9 n\xFAt b\xEAn trong m\u1EDBi b\u1EA5m \u0111\u01B0\u1EE3c. */
  pointer-events: none;
}`);
    }
    if (selectors.noteAction) {
      blocks.push(`
${selectors.noteAction} {
  display: none;
  margin-top: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: ${actionBackground};
  color: #fff;
  font: 800 13px/1.3 ${fontStack};
  cursor: pointer;
  pointer-events: auto;
}
${selectors.noteAction}.show { display: block; }
${selectors.noteAction}:hover { background: ${actionHover}; }
${selectors.noteAction}:focus-visible { outline: 3px solid rgba(245, 166, 35, .95); outline-offset: 2px; }`);
    }
    return blocks.join("\n");
  }
  function sideFits(side, rect, noteWidth, gap, viewportWidth) {
    if (side === "right") return rect.right + gap + noteWidth <= viewportWidth - 8;
    return rect.left - gap - noteWidth >= 8;
  }
  function pickNotePlacement(rect, noteWidth, gap = 12, preferred) {
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
    if (preferred === "right" && sideFits("right", rect, noteWidth, gap, viewportWidth)) return "right";
    if (preferred === "left" && sideFits("left", rect, noteWidth, gap, viewportWidth)) return "left";
    if (preferred === "bottom") return "bottom";
    if (preferred === "top") return "top";
    if (sideFits("right", rect, noteWidth, gap, viewportWidth)) return "right";
    if (sideFits("left", rect, noteWidth, gap, viewportWidth)) return "left";
    return "bottom";
  }
  function fillGuideNote(note, options) {
    const textEl = note.querySelector(options.textSelector || ".zapee-guide-note-text");
    const actionEl = note.querySelector(options.actionSelector || ".zapee-guide-note-action");
    const text = String(options.text || "").trim();
    note.dataset.placement = options.placement;
    if (textEl) textEl.textContent = text ? pointAtTarget(text, options.placement) : "";
    if (!actionEl) return;
    if (options.action) {
      actionEl.textContent = options.action.label;
      actionEl.classList.add("show");
      actionEl.onclick = options.action.onClick;
    } else {
      actionEl.textContent = "";
      actionEl.classList.remove("show");
      actionEl.onclick = null;
    }
  }
  function createGuideNote(className) {
    const note = document.createElement("div");
    note.className = className;
    note.setAttribute("role", "note");
    note.innerHTML = `
    <span class="zapee-guide-note-text"></span>
    <button type="button" class="zapee-guide-note-action"></button>
  `;
    return note;
  }

  // src/content/overlay-styles.ts
  var LAUNCHER_BOTTOM_GAP = 52;
  var PANEL_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; }

  /* \u2500\u2500 Panel (mzProgress): ti\xEAu \u0111\u1EC1 b\u01B0\u1EDBc + danh s\xE1ch b\u01B0\u1EDBc + tho\u1EA1i + ch\xE2n n\xFAt \u2500\u2500 */
  .mzProgress {
    position: fixed;
    right: 20px;
    bottom: 88px;
    display: none;
    flex-direction: column;
    gap: 6px;
    width: 300px;
    max-width: min(300px, calc(100vw - 32px));
    max-height: min(56vh, 440px);
    padding: 10px 12px 12px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, .14);
    color: #1f2937;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    pointer-events: auto;
    z-index: 2147483647;
    animation: mzPop .22s ease-out;
  }
  .mzPHead { display: flex; align-items: flex-start; gap: 8px; }
  /* \u0110\u1EA7u mascot \u0111\u1EE9ng tr\u01B0\u1EDBc ti\xEAu \u0111\u1EC1 \u2014 CH\u1EC8 hi\u1EC7n khi b\u1EA3ng x\u01B0ng t\xEAn "Tr\u1EE3 l\xFD Zapee" (kh\xF4ng c\xF3 t\xEAn b\u01B0\u1EDBc
     n\xE0o), \u0111\u1EC3 user nh\u1EADn ra ngay \u0111\xE2y l\xE0 Zapee ch\u1EE9 kh\xF4ng ph\u1EA3i h\u1ED9p tho\u1EA1i c\u1EE7a trang c\u1EEDa h\xE0ng. */
  .mzPHeadIcon { display: none; flex: none; width: 24px; height: 24px; object-fit: contain; margin-top: -1px; }
  .mzPHeadTxt { flex: 1; font-size: 16px; line-height: 1.35; font-weight: 800; color: #0E4C42; }
  .mzPCount { flex: none; font-size: 12.5px; font-weight: 800; color: #0E7C6B; background: #E1F5EE; border-radius: 999px; padding: 2px 8px; margin-top: 1px; }
  .mzPClose { flex: none; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: #9aa5a2; font-size: 14px; line-height: 1; cursor: pointer; border-radius: 6px; }
  .mzPClose:hover { background: #f1f5f4; color: #4A5A58; }

  /* Danh s\xE1ch b\u01B0\u1EDBc \u2014 vi\u1EC7c \u0111\xE3 xong \u1EDF l\u1EA1i l\xE0m l\u1ECBch s\u1EED, d\xE0i qu\xE1 th\xEC cu\u1ED9n trong khung.
     min-height:0 l\xE0 B\u1EAET BU\u1ED8C: .mzProgress l\xE0 flex column C\xD3 max-height, thi\u1EBFu n\xF3 danh s\xE1ch
     tr\xE0n ra ngo\xE0i panel thay v\xEC cu\u1ED9n (xem ch\xFA th\xEDch c\xF9ng ch\u1ED7 \u1EDF mascot-style.tsx). */
  .mzPSubList {
    display: none;
    flex-direction: column;
    gap: 8px;
    margin: 2px 0 0;
    padding: 8px 10px;
    list-style: none;
    background: rgba(30, 122, 51, .07);
    border-radius: 10px;
    max-height: 210px;
    min-height: 0;
    flex: 0 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .mzPSubList.has-content { display: flex; }
  .mzPSub { display: flex; align-items: center; gap: 8px; font-size: 15px; line-height: 1.3; color: #4A5A58; font-weight: 600; }
  .mzPSubDot {
    flex: none; width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid #c2ccca; display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 800; color: #fff;
  }
  .mzPSub.current { color: #0E7C6B; font-weight: 800; }
  .mzPSub.current .mzPSubDot { border-color: #0E7C6B; color: #0E7C6B; box-shadow: 0 0 0 3px rgba(14, 124, 107, .18); animation: mzHlPulse 1.4s ease-in-out infinite; }
  .mzPSub.done { color: #7a8a87; }
  .mzPSub.done .mzPSubDot { background: #1E7A33; border-color: #1E7A33; color: #fff; }
  .mzPSub.done .mzPSubLabel { text-decoration: line-through; }
  .mzPSub.running { color: #0E7C6B; font-weight: 800; }
  /* "\u0110\u1EBFn l\u01B0\u1EE3t b\u1EA1n": b\xE0n tay n\u1EB1m TRONG \xF4 tr\xF2n \u2014 c\xF9ng khu\xF4n v\u1EDBi c\xE1c d\xF2ng kh\xE1c, ch\u1EC9 \u0111\u1ED5i m\xE0u amber. */
  .mzPSub.handover { color: #BA7517; font-weight: 800; }
  .mzPSub.handover .mzPSubDot { border-color: #FAC775; background: #FAEEDA; color: #8a5a12; box-shadow: 0 0 0 3px rgba(250, 199, 117, .25); animation: none; }
  .mzPSpin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid rgba(14, 124, 107, .35); border-top-color: #0E7C6B; animation: mzSpin .7s linear infinite; }

  /* Tho\u1EA1i/n\u1ED9i dung c\u1EE7a checkpoint hi\u1EC7n t\u1EA1i \u2014 NGAY D\u01AF\u1EDAI danh s\xE1ch b\u01B0\u1EDBc. */
  .mzPSpeech { margin: 2px 0 0; padding: 8px 10px; background: #F3FAF8; border: 1px solid #d7ede7; border-radius: 10px; font-size: 15px; line-height: 1.4; color: #1f2937; white-space: pre-wrap; word-break: break-word; }

  .mzPFoot { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin-top: 2px; }
  .mzPActionBtn { display: none; border: 0; background: #0E7C6B; color: #fff; font: 800 14px/1.3 inherit; border-radius: 999px; padding: 7px 14px; cursor: pointer; }
  .mzPActionBtn.show { display: inline-block; }
  .mzPActionBtn:hover { background: #0A5A4E; }
  .mzPActionBtn:active { transform: scale(.97); }
  .mzPGuideOff { border: 0; background: transparent; color: #0E7C6B; font: 700 13.5px/1.3 inherit; text-decoration: underline; cursor: pointer; padding: 2px 0; }

  /* \u2500\u2500 D\u1EA1ng THU G\u1ECCN (mzPMini): pill xanh ngang h\xE0ng mascot, b\u1EA5m \u0111\u1EC3 bung l\u1EA1i \u2500\u2500 */
  .mzPMini {
    position: fixed;
    display: none;
    flex-direction: column;
    gap: 1px;
    max-width: min(320px, calc(100vw - 32px));
    background: #0E7C6B;
    border: 0;
    border-radius: 14px;
    box-shadow: 0 6px 20px rgba(14, 124, 107, .35);
    overflow: hidden;
    padding: 0;
    text-align: left;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    cursor: pointer;
    pointer-events: auto;
    z-index: 2147483647;
  }
  .mzPMiniHead { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 9px 12px; color: #fff; font-size: 13px; font-weight: 700; }
  .mzPMini:hover .mzPMiniHead { background: rgba(255, 255, 255, .08); }
  .mzPMiniNum { flex: none; width: 20px; height: 20px; border-radius: 50%; background: #F5A623; color: #fff; font-size: 12px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0, 0, 0, .25); margin-top: 1px; }
  .mzPMiniTxt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .mzPMiniLabel { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.25; }
  .mzPMiniSay { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 11.5px; font-weight: 600; line-height: 1.3; color: rgba(255, 255, 255, .86); }
  .mzPMiniCaret { flex: none; opacity: .8; font-size: 12px; margin-top: 2px; }

  /* \u2500\u2500 L\u1EDBp h\u01B0\u1EDBng d\u1EABn tr\xEAn trang c\u1EEDa h\xE0ng \u2500\u2500
     V\xF2ng t\xF4 s\xE1ng + h\u1ED9p ch\xFA th\xEDch + n\xFAt h\xE0nh \u0111\u1ED9ng l\u1EA5y T\u1EEA guide-note.ts (d\xF9ng chung v\u1EDBi c\xE1c guide
     Co.op) v\xE0 \u0111\u01B0\u1EE3c n\u1ED1i v\xE0o cu\u1ED1i chu\u1ED7i n\xE0y \u2014 \u1EDF \u0111\xE2y ch\u1EC9 khai ph\u1EA7n ri\xEAng c\u1EE7a overlay.
     (KH\xD4NG d\xF9ng d\u1EA5u backtick trong kh\u1ED1i CSS n\xE0y \u2014 n\xF3 \u0111\xF3ng s\u1EDBm template literal.) */
  .mzHl { display: none; }
  .mzHlNote { display: none; }
  .mzBadge {
    position: fixed;
    display: none;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #F5A623;
    color: #fff;
    font: 800 15px/26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, .25);
    pointer-events: none;
    z-index: 2147483647;
  }

  /* \u2500\u2500 Mascot (launcher) \u2500\u2500 */
  .launcher {
    position: fixed;
    right: 20px;
    bottom: ${LAUNCHER_BOTTOM_GAP}px;
    display: none;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0;
    cursor: grab;
    user-select: none;
    touch-action: none;
    box-shadow: none;
    pointer-events: auto;
    z-index: 2147483647;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    padding: 0;
    overflow: visible;
  }
  .launcher:active { cursor: grabbing; }
  .launcher:hover { transform: scale(1.08); }
  .launcher .mascot-img {
    width: 60px;
    height: 60px;
    object-fit: contain;
    filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.2));
    pointer-events: none;
  }
  .launcher .fallback-icon { font-size: 28px; line-height: 1; display: flex; align-items: center; justify-content: center; }
  .launcher[data-state="idle"] .mascot-img { animation: mzBreathe 4s ease-in-out infinite; }
  .launcher[data-state="success"] .mascot-img { animation: mzBounce .6s ease-out 1; }
  .launcher[data-state="error"] .mascot-img { animation: mzShake .5s ease-in-out 1; }

  /* \u2500\u2500 L\u1EDBp ph\u1EE7 to\xE0n trang khi engine \u0111ang t\u1EF1 ch\u1EA1y (kh\xF4ng c\xF3 n\xFAt \u0111\xF3ng) \u2500\u2500 */
  .blocking-presentation {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(18px, 3vh, 30px);
    padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
    overflow: hidden;
    overscroll-behavior: contain;
    touch-action: none;
    pointer-events: auto;
    outline: none;
    z-index: 2147483647;
    background:
      radial-gradient(circle at 50% 42%, rgba(33, 181, 92, 0.1), transparent 42%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.74) 0%, rgba(242, 251, 246, 0.78) 100%);
    -webkit-backdrop-filter: blur(2px) saturate(0.84);
    backdrop-filter: blur(2px) saturate(0.84);
    color: #14201f;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .blocking-presentation .presentation-mascot {
    display: block;
    width: min(240px, 46vw, 34vh);
    max-height: 38vh;
    object-fit: contain;
    filter: drop-shadow(0 16px 32px rgba(8, 79, 50, 0.14));
    animation: zapee-presentation-float 2.6s ease-in-out infinite;
  }
  .blocking-presentation .presentation-text {
    max-width: min(680px, calc(100vw - 40px));
    margin: 0;
    color: #145c43;
    font-size: clamp(18px, 2.5vw, 26px);
    font-weight: 750;
    line-height: 1.4;
    letter-spacing: -0.01em;
    text-align: center;
    text-wrap: balance;
  }
  /* Danh s\xE1ch b\u01B0\u1EDBc v\u1EABn hi\u1EC7n trong l\xFAc bot t\u1EF1 ch\u1EA1y: ng\u01B0\u1EDDi d\xF9ng lu\xF4n th\u1EA5y m\xECnh \u0111ang \u1EDF \u0111\xE2u. */
  .blocking-presentation .mzPSubList { background: rgba(255, 255, 255, .78); border: 1px solid #d7ede7; max-width: min(420px, calc(100vw - 40px)); width: 100%; }

  @keyframes zapee-presentation-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
  @keyframes mzPop { from { opacity: 0; transform: translateY(4px) scale(.96); } to { opacity: 1; transform: none; } }
  @keyframes mzSpin { to { transform: rotate(360deg); } }
  @keyframes mzHlPulse { 0%, 100% { box-shadow: 0 0 0 3px rgba(14, 124, 107, .18); } 50% { box-shadow: 0 0 0 7px rgba(14, 124, 107, 0); } }
  @keyframes mzBreathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.02); } }
  @keyframes mzBounce { 0% { transform: translateY(0); } 30% { transform: translateY(-8%); } 55% { transform: translateY(0); } 72% { transform: translateY(-3%); } 100% { transform: translateY(0); } }
  @keyframes mzShake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6%); } 40% { transform: translateX(6%); } 60% { transform: translateX(-4%); } 80% { transform: translateX(4%); } }

  @media (prefers-reduced-motion: reduce) {
    .blocking-presentation .presentation-mascot,
    .launcher .mascot-img,
    .mzHl,
    .mzPSub.current .mzPSubDot,
    .mzProgress { animation: none !important; }
  }
`;
  var OVERLAY_STYLES = `${PANEL_STYLES}
${guideHighlightCss({ ring: ".mzHl", note: ".mzHlNote", noteAction: ".mzHlNote .zapee-guide-note-action" })}
`;

  // src/content/overlay-steps.ts
  function currentStepOf(steps) {
    if (!steps?.length) return { position: 0 };
    const index = steps.findIndex((step) => step.state === "current");
    return index >= 0 ? { step: steps[index], position: index + 1 } : { position: 0 };
  }
  function advanceCurrentStep(steps) {
    if (!steps?.length) return steps;
    const current = steps.findIndex((step) => step.state === "current");
    if (current < 0) return steps;
    return steps.map((step, index) => {
      if (index <= current) {
        return { ...step, state: "done", handover: void 0, running: void 0 };
      }
      if (index === current + 1) {
        return { ...step, state: "current", handover: true, running: void 0 };
      }
      return step;
    });
  }
  function renderSteps(list, steps) {
    list.innerHTML = "";
    if (!steps?.length) {
      list.classList.remove("has-content");
      return;
    }
    for (const step of steps) {
      const handover = Boolean(step.handover) && step.state !== "done";
      const running2 = Boolean(step.running) && step.state !== "done";
      const row = document.createElement("li");
      row.className = `mzPSub ${step.state}${running2 ? " running" : ""}${handover ? " handover" : ""}`;
      const dot = document.createElement("span");
      dot.className = "mzPSubDot";
      dot.setAttribute("aria-hidden", "true");
      if (running2) dot.appendChild(Object.assign(document.createElement("span"), { className: "mzPSpin" }));
      else dot.textContent = step.state === "done" ? "\u2713" : handover ? "\u270B" : step.mark || "";
      const label = document.createElement("span");
      label.className = "mzPSubLabel";
      label.textContent = handover ? `\u0110\u1EBFn l\u01B0\u1EE3t b\u1EA1n: ${step.label}` : step.label;
      row.append(dot, label);
      list.appendChild(row);
    }
    list.classList.add("has-content");
  }

  // src/content/overlay.ts
  var ROOT_ID = "zapee-assistant-root";
  var HIGHLIGHT_POLL_MS = 500;
  var HIGHLIGHT_SCROLL_SETTLE_MS = 160;
  var GUIDANCE_OFF_KEY = "zapee_guidance_off";
  var shadowRoot = null;
  var panelEl = null;
  var panelTitleEl = null;
  var panelIconEl = null;
  var panelCountEl = null;
  var panelStepsEl = null;
  var panelSpeechEl = null;
  var panelActionEl = null;
  var miniEl = null;
  var miniNumEl = null;
  var miniLabelEl = null;
  var miniSayEl = null;
  var highlightEl = null;
  var badgeEl = null;
  var highlightNoteEl = null;
  var highlightNoteActionEl = null;
  var highlightInterval = null;
  var highlightScrollTimer = null;
  var highlightScrollActive = false;
  var currentHighlightLocator;
  var currentNoteText = "";
  var currentNoteAction = null;
  var currentBadgeMark = "";
  var extraHighlights = [];
  var extraSurfaces = [];
  var mainStickyNote = { key: "", placement: null };
  var extraStickyNotes = [];
  var launcherEl = null;
  var launcherMascotEl = null;
  var launcherFallbackEl = null;
  var launcherClickHandler = null;
  var panelActionHandler = null;
  var blockingPresentationEl = null;
  var blockingPresentationMascotEl = null;
  var blockingPresentationTextEl = null;
  var blockingPresentationStepsEl = null;
  var blockingPresentationCheckpointId = null;
  var activeGuidance = null;
  var collapsed = false;
  var guidanceOff = false;
  var ASSISTANT_NAME = "Tr\u1EE3 l\xFD Zapee";
  function getMascotUrl(state = "idle") {
    return getExtensionAssetUrl(`mascot/mascot_${state}.png`);
  }
  function getExtensionAssetUrl(path) {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      try {
        return chrome.runtime.getURL(path);
      } catch {
        return path;
      }
    }
    return path;
  }
  function readGuidanceOff() {
    try {
      return typeof sessionStorage !== "undefined" && sessionStorage.getItem(GUIDANCE_OFF_KEY) === "1";
    } catch {
      return false;
    }
  }
  function writeGuidanceOff(value) {
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem(GUIDANCE_OFF_KEY, value ? "1" : "0");
    } catch {
    }
  }
  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }
  function updatePanelPosition() {
    if (!launcherEl) return;
    const surface = collapsed ? miniEl : panelEl;
    if (!surface || surface.style.display === "none") return;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const launcherRect = launcherEl.getBoundingClientRect();
    const bw = surface.offsetWidth || 300;
    const bh = surface.offsetHeight || 120;
    const spaceAbove = launcherRect.top;
    const spaceBelow = vh - launcherRect.bottom;
    const placeAbove = spaceAbove >= bh + 14 || spaceAbove >= spaceBelow;
    const top = placeAbove ? clamp(launcherRect.top - bh - 12, 10, Math.max(10, vh - bh - 10)) : clamp(launcherRect.bottom + 12, 10, Math.max(10, vh - bh - 10));
    const isLeftHalf = launcherRect.left < vw / 2;
    const left = isLeftHalf ? clamp(launcherRect.left, 10, Math.max(10, vw - bw - 10)) : clamp(launcherRect.right - bw, 10, Math.max(10, vw - bw - 10));
    surface.style.position = "fixed";
    surface.style.left = `${left}px`;
    surface.style.top = `${top}px`;
    surface.style.right = "auto";
    surface.style.bottom = "auto";
  }
  var isDragging = false;
  var hasDragged = false;
  var startX = 0;
  var startY = 0;
  var startLeft = 0;
  var startTop = 0;
  function setupDraggable(launcher) {
    try {
      const saved = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("zapee_launcher_pos") : null;
      if (saved) {
        const pos = JSON.parse(saved);
        if (typeof pos.left === "number" && typeof pos.top === "number") {
          const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
          const vh = typeof window !== "undefined" ? window.innerHeight : 768;
          const cl = clamp(pos.left, 10, vw - 70);
          const ct = clamp(pos.top, 10, Math.max(10, vh - 60 - LAUNCHER_BOTTOM_GAP));
          launcher.style.left = `${cl}px`;
          launcher.style.top = `${ct}px`;
          launcher.style.right = "auto";
          launcher.style.bottom = "auto";
        }
      }
    } catch {
    }
    const onMove = (e) => {
      if (!isDragging) return;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.hypot(dx, dy) > 4) {
        hasDragged = true;
      }
      const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
      const vh = typeof window !== "undefined" ? window.innerHeight : 768;
      const launcherWidth = launcher.offsetWidth || 60;
      const launcherHeight = launcher.offsetHeight || 60;
      const newLeft = clamp(startLeft + dx, 10, vw - launcherWidth - 10);
      const newTop = clamp(
        startTop + dy,
        10,
        Math.max(10, vh - launcherHeight - LAUNCHER_BOTTOM_GAP)
      );
      launcher.style.left = `${newLeft}px`;
      launcher.style.top = `${newTop}px`;
      launcher.style.right = "auto";
      launcher.style.bottom = "auto";
      updatePanelPosition();
    };
    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      const rect = launcher.getBoundingClientRect();
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem("zapee_launcher_pos", JSON.stringify({ left: rect.left, top: rect.top }));
        }
      } catch {
      }
    };
    const onStart = (e) => {
      if ("button" in e && e.button !== void 0 && e.button !== 0) return;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const rect = launcher.getBoundingClientRect();
      startX = clientX;
      startY = clientY;
      startLeft = rect.left;
      startTop = rect.top;
      isDragging = true;
      hasDragged = false;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onEnd);
      window.addEventListener("touchmove", onMove, { passive: true });
      window.addEventListener("touchend", onEnd);
    };
    launcher.addEventListener("mousedown", onStart);
    launcher.addEventListener("touchstart", onStart, { passive: true });
    launcher.addEventListener("click", (e) => {
      if (hasDragged) {
        e.preventDefault();
        e.stopPropagation();
        hasDragged = false;
        return;
      }
      launcherClickHandler?.();
    });
  }
  function ensureRoot() {
    if (shadowRoot) return shadowRoot;
    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.setAttribute(
      "style",
      "all: initial; position: fixed; inset: 0; width: 0; height: 0; overflow: visible; pointer-events: none; z-index: 2147483647;"
    );
    document.documentElement.appendChild(host);
    const sr = host.attachShadow({ mode: "closed" });
    shadowRoot = sr;
    guidanceOff = readGuidanceOff();
    collapsed = guidanceOff;
    const style = document.createElement("style");
    style.textContent = OVERLAY_STYLES;
    sr.appendChild(style);
    const panel = document.createElement("div");
    panel.className = "mzProgress";
    panel.setAttribute("role", "status");
    panel.innerHTML = `
    <div class="mzPHead">
      <img class="mzPHeadIcon" alt="" aria-hidden="true" src="${getExtensionAssetUrl("mascot/mascot_head_48.png")}" />
      <span class="mzPHeadTxt"></span>
      <span class="mzPCount"></span>
      <button type="button" class="mzPClose" aria-label="Thu g\u1ECDn">\u2715</button>
    </div>
    <ol class="mzPSubList"></ol>
    <p class="mzPSpeech"></p>
    <div class="mzPFoot">
      <button type="button" class="mzPActionBtn"></button>
      <button type="button" class="mzPGuideOff">T\u1EAFt h\u01B0\u1EDBng d\u1EABn</button>
    </div>
  `;
    sr.appendChild(panel);
    panelEl = panel;
    panelTitleEl = panel.querySelector(".mzPHeadTxt");
    panelIconEl = panel.querySelector(".mzPHeadIcon");
    if (panelIconEl) {
      panelIconEl.onerror = () => {
        if (!panelIconEl) return;
        panelIconEl.dataset.failed = "1";
        panelIconEl.style.display = "none";
      };
    }
    panelCountEl = panel.querySelector(".mzPCount");
    panelStepsEl = panel.querySelector(".mzPSubList");
    panelSpeechEl = panel.querySelector(".mzPSpeech");
    panelActionEl = panel.querySelector(".mzPActionBtn");
    panelActionEl?.addEventListener("click", () => panelActionHandler?.());
    panel.querySelector(".mzPClose")?.addEventListener("click", () => setCollapsed(true));
    panel.querySelector(".mzPGuideOff")?.addEventListener("click", () => {
      guidanceOff = true;
      writeGuidanceOff(true);
      setCollapsed(true);
    });
    const mini = document.createElement("button");
    mini.type = "button";
    mini.className = "mzPMini";
    mini.setAttribute("aria-label", "M\u1EDF l\u1EA1i b\u1EA3ng h\u01B0\u1EDBng d\u1EABn Zapee");
    mini.innerHTML = `
    <span class="mzPMiniHead">
      <span class="mzPMiniNum" aria-hidden="true"></span>
      <span class="mzPMiniTxt">
        <span class="mzPMiniLabel"></span>
        <span class="mzPMiniSay"></span>
      </span>
      <span class="mzPMiniCaret" aria-hidden="true">\u25B4</span>
    </span>
  `;
    mini.addEventListener("click", () => {
      guidanceOff = false;
      writeGuidanceOff(false);
      setCollapsed(false);
    });
    sr.appendChild(mini);
    miniEl = mini;
    miniNumEl = mini.querySelector(".mzPMiniNum");
    miniLabelEl = mini.querySelector(".mzPMiniLabel");
    miniSayEl = mini.querySelector(".mzPMiniSay");
    const highlight = document.createElement("div");
    highlight.className = "mzHl";
    sr.appendChild(highlight);
    highlightEl = highlight;
    const badge = document.createElement("div");
    badge.className = "mzBadge";
    sr.appendChild(badge);
    badgeEl = badge;
    const highlightNote = createGuideNote("mzHlNote");
    sr.appendChild(highlightNote);
    highlightNoteEl = highlightNote;
    highlightNoteActionEl = highlightNote.querySelector(".zapee-guide-note-action");
    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "launcher";
    launcher.dataset.state = "idle";
    launcher.setAttribute("aria-label", "M\u1EDF tr\u1EE3 l\xFD Zapee");
    const mascotImg = document.createElement("img");
    mascotImg.className = "mascot-img";
    mascotImg.src = getMascotUrl("idle");
    mascotImg.alt = "Tr\u1EE3 l\xFD Zapee";
    const fallbackIcon = document.createElement("span");
    fallbackIcon.className = "fallback-icon";
    fallbackIcon.textContent = "\u{1F916}";
    fallbackIcon.style.display = "none";
    mascotImg.onerror = () => {
      mascotImg.style.display = "none";
      fallbackIcon.style.display = "flex";
    };
    launcher.appendChild(mascotImg);
    launcher.appendChild(fallbackIcon);
    setupDraggable(launcher);
    sr.appendChild(launcher);
    launcherEl = launcher;
    launcherMascotEl = mascotImg;
    launcherFallbackEl = fallbackIcon;
    const blockingPresentation = document.createElement("div");
    blockingPresentation.className = "blocking-presentation";
    blockingPresentation.tabIndex = -1;
    blockingPresentation.setAttribute("role", "status");
    blockingPresentation.setAttribute("aria-live", "polite");
    blockingPresentation.setAttribute("aria-busy", "true");
    const presentationMascot = document.createElement("img");
    presentationMascot.className = "presentation-mascot";
    presentationMascot.alt = "Tr\u1EE3 l\xFD Zapee";
    presentationMascot.src = getMascotUrl("processing");
    presentationMascot.onerror = () => {
      presentationMascot.style.display = "none";
    };
    const presentationText = document.createElement("p");
    presentationText.className = "presentation-text";
    const presentationSteps = document.createElement("ol");
    presentationSteps.className = "mzPSubList";
    blockingPresentation.append(presentationMascot, presentationText, presentationSteps);
    for (const eventName of ["wheel", "touchmove"]) {
      blockingPresentation.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
    }
    blockingPresentation.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    sr.appendChild(blockingPresentation);
    blockingPresentationEl = blockingPresentation;
    blockingPresentationMascotEl = presentationMascot;
    blockingPresentationTextEl = presentationText;
    blockingPresentationStepsEl = presentationSteps;
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => updatePanelPosition());
    }
    return sr;
  }
  function setLauncherClickHandler(handler) {
    launcherClickHandler = handler;
  }
  function showBotLauncher(state) {
    ensureRoot();
    if (state && launcherMascotEl) {
      launcherMascotEl.src = getMascotUrl(state);
      launcherMascotEl.style.display = "";
      if (launcherEl) launcherEl.dataset.state = state;
      if (launcherFallbackEl) launcherFallbackEl.style.display = "none";
    }
    if (launcherEl) launcherEl.style.display = "flex";
  }
  function hideBotLauncher() {
    if (launcherEl) launcherEl.style.display = "none";
  }
  function hideHighlightSurfaces() {
    if (highlightEl) highlightEl.style.display = "none";
    if (badgeEl) badgeEl.style.display = "none";
    if (highlightNoteEl) highlightNoteEl.style.display = "none";
    for (const surface of extraSurfaces) {
      surface.highlight.style.display = "none";
      surface.badge.style.display = "none";
      surface.note.style.display = "none";
    }
  }
  function ensureExtraSurfaces(count) {
    const sr = shadowRoot;
    if (!sr) return;
    while (extraSurfaces.length < count) {
      const highlight = document.createElement("div");
      highlight.className = "mzHl";
      const badge = document.createElement("div");
      badge.className = "mzBadge";
      const note = createGuideNote("mzHlNote");
      sr.append(highlight, badge, note);
      extraSurfaces.push({ highlight, badge, note });
    }
  }
  function noteLayoutBox(noteEl) {
    if (!noteEl || noteEl.style.display === "none") return null;
    const measured = noteEl.getBoundingClientRect();
    return {
      left: parseFloat(noteEl.style.left) || 0,
      top: parseFloat(noteEl.style.top) || 0,
      width: noteEl.offsetWidth || measured.width || 240,
      height: noteEl.offsetHeight || measured.height || 44
    };
  }
  function boxesOverlap(a, b, gap = 8) {
    return a.left < b.left + b.width + gap && a.left + a.width + gap > b.left && a.top < b.top + b.height + gap && a.top + a.height + gap > b.top;
  }
  function unstackGuideNotes(noteEls) {
    const items = noteEls.map((el) => {
      const box = noteLayoutBox(el);
      return el && box ? { el, ...box } : null;
    }).filter((item) => Boolean(item)).sort((a, b) => a.top - b.top || a.left - b.left);
    const placed = [];
    for (const item of items) {
      let top = item.top;
      let guard = 0;
      while (guard++ < 16) {
        const current = { left: item.left, top, width: item.width, height: item.height };
        const hit = placed.find((other) => boxesOverlap(current, other));
        if (!hit) break;
        top = hit.top + hit.height + 8;
      }
      top = clamp(top, 8, Math.max(8, window.innerHeight - item.height - 8));
      item.el.style.top = `${top}px`;
      placed.push({ left: item.left, top, width: item.width, height: item.height });
    }
  }
  function isCoveredByPageOverlay(el) {
    if (typeof document.elementFromPoint !== "function") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!top) return false;
    if (top === el || el.contains(top) || top.contains(el)) return false;
    const host = document.getElementById(ROOT_ID);
    if (host && (top === host || host.contains(top))) return false;
    return true;
  }
  function locatorKey(locator) {
    if (!locator) return "";
    return JSON.stringify({
      strategy: locator.strategy,
      value: locator.value || "",
      role: locator.role || "",
      name: locator.name || "",
      exact: Boolean(locator.exact)
    });
  }
  function stickyFor(key, slot) {
    if (slot && slot.key === key) return slot;
    return { key, placement: null };
  }
  function resetStickyNotes() {
    mainStickyNote = { key: "", placement: null };
    extraStickyNotes = [];
  }
  function layoutHighlight(el, highlight, badge, noteEl, noteText, mark, action, sticky) {
    const rect = el.getBoundingClientRect();
    if (!rectIntersectsViewport(rect) || isCoveredByPageOverlay(el)) {
      highlight.style.display = "none";
      if (badge) badge.style.display = "none";
      if (noteEl) noteEl.style.display = "none";
      return;
    }
    highlight.style.display = "block";
    highlight.style.left = `${rect.left - 4}px`;
    highlight.style.top = `${rect.top - 4}px`;
    highlight.style.width = `${rect.width + 8}px`;
    highlight.style.height = `${rect.height + 8}px`;
    if (badge) {
      if (mark) {
        badge.textContent = mark;
        badge.style.display = "block";
        badge.style.left = `${clamp(rect.left - 17, 4, Math.max(4, window.innerWidth - 30))}px`;
        badge.style.top = `${clamp(rect.top - 17, 4, Math.max(4, window.innerHeight - 30))}px`;
      } else {
        badge.style.display = "none";
      }
    }
    if (!noteEl || !noteText) {
      if (noteEl) noteEl.style.display = "none";
      sticky.placement = null;
      return;
    }
    noteEl.style.display = "block";
    const tentative = sticky.placement ?? "right";
    fillGuideNote(noteEl, { text: noteText, placement: tentative, action });
    const noteWidth = noteEl.offsetWidth || noteEl.getBoundingClientRect().width || 240;
    const noteHeight = noteEl.offsetHeight || noteEl.getBoundingClientRect().height || 44;
    const placement = pickNotePlacement(rect, noteWidth, 12, sticky.placement);
    if (placement !== tentative) fillGuideNote(noteEl, { text: noteText, placement, action });
    sticky.placement = placement;
    noteEl.style.left = `${placement === "right" ? rect.right + 12 : placement === "left" ? rect.left - noteWidth - 12 : clamp(rect.left, 8, Math.max(8, window.innerWidth - noteWidth - 8))}px`;
    noteEl.style.top = `${placement === "bottom" ? clamp(rect.bottom + 12, 8, Math.max(8, window.innerHeight - noteHeight - 8)) : clamp(rect.top + (rect.height - noteHeight) / 2, 8, Math.max(8, window.innerHeight - noteHeight - 8))}px`;
  }
  function updateHighlightPosition() {
    if (!highlightEl || !highlightNoteEl) return;
    if (highlightScrollActive || guidanceOff || !currentHighlightLocator) {
      hideHighlightSurfaces();
      return;
    }
    const el = resolveLocator(currentHighlightLocator);
    if (!el) {
      hideHighlightSurfaces();
      return;
    }
    mainStickyNote = stickyFor(locatorKey(currentHighlightLocator), mainStickyNote);
    layoutHighlight(el, highlightEl, badgeEl, highlightNoteEl, currentNoteText, currentBadgeMark, currentNoteAction, mainStickyNote);
    ensureExtraSurfaces(extraHighlights.length);
    extraSurfaces.forEach((surface, index) => {
      const extra = extraHighlights[index];
      if (!extra) {
        surface.highlight.style.display = "none";
        surface.badge.style.display = "none";
        surface.note.style.display = "none";
        extraStickyNotes[index] = { key: "", placement: null };
        return;
      }
      const extraEl = resolveLocator(extra.locator);
      if (!extraEl) {
        surface.highlight.style.display = "none";
        surface.badge.style.display = "none";
        surface.note.style.display = "none";
        extraStickyNotes[index] = { key: "", placement: null };
        return;
      }
      extraStickyNotes[index] = stickyFor(locatorKey(extra.locator), extraStickyNotes[index]);
      layoutHighlight(
        extraEl,
        surface.highlight,
        surface.badge,
        surface.note,
        String(extra.note || "").trim(),
        String(extra.mark || "").trim(),
        null,
        extraStickyNotes[index]
      );
    });
    extraStickyNotes.length = extraHighlights.length;
    unstackGuideNotes([highlightNoteEl, ...extraSurfaces.map((surface) => surface.note)]);
  }
  function onHighlightScroll() {
    highlightScrollActive = true;
    hideHighlightSurfaces();
    if (highlightScrollTimer !== null) window.clearTimeout(highlightScrollTimer);
    highlightScrollTimer = window.setTimeout(() => {
      highlightScrollTimer = null;
      highlightScrollActive = false;
      updateHighlightPosition();
    }, HIGHLIGHT_SCROLL_SETTLE_MS);
  }
  function startHighlightPoll() {
    updateHighlightPosition();
    window.addEventListener("scroll", onHighlightScroll, true);
    window.addEventListener("resize", updateHighlightPosition);
    if (highlightInterval === null) {
      highlightInterval = window.setInterval(updateHighlightPosition, HIGHLIGHT_POLL_MS);
    }
  }
  function stopHighlightPoll() {
    if (highlightInterval !== null) {
      window.clearInterval(highlightInterval);
      highlightInterval = null;
    }
    window.removeEventListener("scroll", onHighlightScroll, true);
    window.removeEventListener("resize", updateHighlightPosition);
    if (highlightScrollTimer !== null) {
      window.clearTimeout(highlightScrollTimer);
      highlightScrollTimer = null;
    }
    highlightScrollActive = false;
    hideHighlightSurfaces();
  }
  function stepsOf(payload) {
    return payload?.steps?.length ? payload.steps : payload?.flow?.steps;
  }
  function renderActiveGuidance() {
    const payload = activeGuidance;
    if (!payload || !panelEl || !miniEl) return;
    const steps = stepsOf(payload);
    const { step: current, position } = currentStepOf(steps);
    const total = payload.flow?.total ?? steps?.length ?? 0;
    const index = payload.flow?.index ?? position;
    if (collapsed) {
      panelEl.style.display = "none";
      miniEl.style.display = "flex";
      if (miniNumEl) {
        miniNumEl.textContent = index > 0 ? String(index) : "";
        miniNumEl.style.display = index > 0 ? "inline-flex" : "none";
      }
      if (miniLabelEl) {
        miniLabelEl.textContent = current ? `${current.handover ? "\u270B " : ""}${current.label}` : payload.title || payload.flow?.title || ASSISTANT_NAME;
      }
      if (miniSayEl) {
        miniSayEl.textContent = payload.message;
        miniSayEl.style.display = payload.message ? "block" : "none";
      }
      updatePanelPosition();
      return;
    }
    miniEl.style.display = "none";
    panelEl.style.display = "flex";
    const heading = payload.title || payload.flow?.title || current?.label || "";
    if (panelTitleEl) panelTitleEl.textContent = heading || ASSISTANT_NAME;
    if (panelIconEl) {
      panelIconEl.style.display = heading || panelIconEl.dataset.failed === "1" ? "none" : "block";
    }
    if (panelCountEl) {
      const showCount = index > 0 && total > 1;
      panelCountEl.textContent = showCount ? `${index}/${total}` : "";
      panelCountEl.style.display = showCount ? "inline-block" : "none";
    }
    if (panelStepsEl) renderSteps(panelStepsEl, steps);
    if (panelSpeechEl) {
      panelSpeechEl.textContent = payload.message;
      panelSpeechEl.style.display = payload.message ? "block" : "none";
    }
    updatePanelPosition();
  }
  function setCollapsed(next) {
    collapsed = next;
    if (!activeGuidance) {
      if (panelEl) panelEl.style.display = "none";
      if (miniEl) miniEl.style.display = "none";
      return;
    }
    renderActiveGuidance();
    if (guidanceOff) hideHighlightSurfaces();
    else updateHighlightPosition();
  }
  function clearPanelExtras() {
    panelActionHandler = null;
    if (panelStepsEl) renderSteps(panelStepsEl, void 0);
    if (panelActionEl) {
      panelActionEl.classList.remove("show");
      panelActionEl.textContent = "";
    }
    if (highlightNoteActionEl) {
      highlightNoteActionEl.classList.remove("show");
      highlightNoteActionEl.textContent = "";
    }
  }
  function showGuidance(payload) {
    ensureRoot();
    if (blockingPresentationCheckpointId) return;
    const steps = stepsOf(payload);
    const { step: current } = currentStepOf(steps);
    showBotLauncher(current?.handover ? "asking" : current?.running ? "processing" : "idle");
    clearPanelExtras();
    activeGuidance = payload;
    renderActiveGuidance();
    const actionBelongsToTarget = Boolean(payload.action && payload.highlightLocator);
    if (payload.action && !actionBelongsToTarget && panelActionEl) {
      panelActionHandler = payload.action.onClick;
      panelActionEl.textContent = payload.action.label;
      panelActionEl.classList.add("show");
    }
    currentHighlightLocator = payload.highlightLocator;
    extraHighlights = Array.isArray(payload.extraHighlights) ? payload.extraHighlights.slice(0, 3) : [];
    currentNoteText = String(payload.targetNote || "").trim() || String(payload.message || "").trim();
    currentNoteAction = actionBelongsToTarget && payload.action ? payload.action : null;
    currentBadgeMark = String(payload.flow?.index ?? current?.mark ?? "").trim();
    if (currentHighlightLocator) {
      startHighlightPoll();
    } else {
      stopHighlightPoll();
    }
  }
  function showAssistantMessage(message) {
    if (blockingPresentationCheckpointId) return;
    const text = String(message || "").trim();
    if (!text) return;
    const liveHighlight = Boolean(currentHighlightLocator && resolveLocator(currentHighlightLocator));
    if (liveHighlight) {
      ensureRoot();
      showBotLauncher("idle");
      renderActiveGuidance();
      return;
    }
    showGuidance({
      checkpointId: "assistant",
      message: text,
      title: activeGuidance?.title,
      steps: activeGuidance?.steps,
      flow: activeGuidance?.flow
    });
  }
  function showBlockingPresentation(payload) {
    ensureRoot();
    blockingPresentationCheckpointId = payload.checkpointId;
    stopHighlightPoll();
    currentHighlightLocator = void 0;
    currentNoteAction = null;
    clearPanelExtras();
    if (panelEl) panelEl.style.display = "none";
    if (miniEl) miniEl.style.display = "none";
    if (launcherEl) launcherEl.style.display = "none";
    if (blockingPresentationMascotEl) {
      blockingPresentationMascotEl.src = getMascotUrl(payload.mascot);
      blockingPresentationMascotEl.style.display = "block";
    }
    if (blockingPresentationTextEl) blockingPresentationTextEl.textContent = payload.message;
    if (blockingPresentationStepsEl) renderSteps(blockingPresentationStepsEl, payload.flow?.steps);
    if (blockingPresentationEl) {
      blockingPresentationEl.style.display = "flex";
      blockingPresentationEl.focus({ preventScroll: true });
    }
  }
  function hideBlockingPresentation(checkpointId) {
    if (!blockingPresentationCheckpointId) return;
    if (checkpointId && checkpointId !== blockingPresentationCheckpointId) return;
    blockingPresentationCheckpointId = null;
    if (blockingPresentationEl) blockingPresentationEl.style.display = "none";
    showBotLauncher("idle");
  }
  function clearGuidance() {
    hideBlockingPresentation();
    stopHighlightPoll();
    currentHighlightLocator = void 0;
    currentNoteText = "";
    currentNoteAction = null;
    currentBadgeMark = "";
    activeGuidance = null;
    resetStickyNotes();
    clearPanelExtras();
    if (panelEl) panelEl.style.display = "none";
    if (miniEl) miniEl.style.display = "none";
  }

  // src/content/guidance-action.ts
  function guidanceFillLocator(message) {
    return message.pasteLocator || message.highlightLocator;
  }
  function createGuidanceRevisionGuard() {
    let currentRevision = 0;
    return {
      advance: () => {
        currentRevision += 1;
        return currentRevision;
      },
      isCurrent: (revision) => revision === currentRevision
    };
  }

  // src/content/coop-ad-guide.ts
  var NOTE_ID = "zapee-coop-ad-guide-note";
  var RING_ID = "zapee-guide-ad-ring";
  var TARGET_CLASS = "zapee-guide-target-ad";
  var NOTE_STYLE_ID = "zapee-coop-ad-guide-style";
  var POLL_IDLE_MS = 900;
  var POLL_ACTIVE_MS = 500;
  var SCROLL_SETTLE_MS = 160;
  var NOTE_CSS = `
${guideHighlightCss({
    target: `.${TARGET_CLASS}`,
    ring: `#${RING_ID}`,
    note: `#${NOTE_ID}`
  })}
/* V\xF2ng t\xF4 s\xE1ng c\u1EE7a guide n\xE0y ph\u1EA3i n\u1EB1m TR\xCAN m\u1ECDi l\u1EDBp modal c\u1EE7a Co.op. */
#${RING_ID} { z-index: 2147483647; display: none; }
`;
  var LOG_PREFIX = "[Zapee:coop-ad]";
  var DEBUG = true;
  var lastDebugKey = "";
  function log(...args) {
    if (!DEBUG) return;
    try {
      console.warn(LOG_PREFIX, ...args);
    } catch {
    }
  }
  function logOnce(key, ...args) {
    if (key === lastDebugKey) return;
    lastDebugKey = key;
    log(...args);
  }
  function describeEl(el) {
    if (!(el instanceof HTMLElement)) return null;
    const r = el.getBoundingClientRect();
    const styleAttr = (el.getAttribute("style") || "").slice(0, 180);
    return {
      tag: el.tagName,
      className: String(el.className || "").slice(0, 80),
      id: el.id || "",
      testId: el.getAttribute("data-testid") || "",
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      styleAttr,
      rect: {
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        left: Math.round(r.left)
      }
    };
  }
  var enabled = false;
  var timer = null;
  var latchedWrapper = null;
  var latchedClose = null;
  var activeTarget = null;
  var dismissed = false;
  var announced = false;
  var onAdVisible = null;
  var onAdDismissed = null;
  var dismissBound = false;
  var execMode = "manual";
  var autoClickAttempted = false;
  var scrollActive = false;
  var scrollTimer = null;
  var missingCloseSince = 0;
  var lastPaintRect = null;
  var TRANSIENT_REMOUNT_GRACE_MS = 320;
  var manualCloseIntent = false;
  function safeClick(el) {
    try {
      el.scrollIntoView({ block: "center", behavior: "auto" });
    } catch {
    }
    try {
      try {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      } catch {
      }
      el.click();
      const child = el.firstElementChild;
      if (child instanceof HTMLElement) {
        child.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    } catch {
      return false;
    }
  }
  function ensureStyles() {
    if (document.getElementById(NOTE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = NOTE_STYLE_ID;
    style.textContent = NOTE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }
  function isSmall(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 8 && rect.width <= 80 && rect.height > 8 && rect.height <= 80;
  }
  function styleBlob(el) {
    const attr = el.getAttribute("style") || "";
    try {
      const s = getComputedStyle(el);
      const webkit = s.webkitMaskImage || "";
      return `${attr} ${s.maskImage || ""} ${webkit} ${s.backgroundImage || ""}`.toLowerCase();
    } catch {
      return attr.toLowerCase();
    }
  }
  function hasCloseMaskIcon(el) {
    const blob = styleBlob(el);
    if (!/mask-image|maskimage|data:image\/svg/.test(blob)) return false;
    if (/m6\.813|clip-rule|fill-rule|viewbox=['"]0 0 24 24['"]|l10\.878|l13\.000/.test(blob)) return true;
    if (isSmall(el) && /rgb\(\s*255\s*,\s*4\s*,\s*4|#ff0404|background:\s*rgb\(255/.test(blob)) return true;
    if (isSmall(el) && /mask-image/.test(blob)) return true;
    return false;
  }
  function findAdCloseLegacyPopupWrapper() {
    const wrappers = Array.from(document.querySelectorAll(
      "[data-testid='popup-wrapper'], [data-testid='Popup-wrapper'], [data-testid*='popup' i]"
    )).filter((element) => element instanceof HTMLElement && isVisible(element));
    for (const wrapper of wrappers) {
      const content = Array.from(wrapper.children).find(
        (element) => element instanceof HTMLElement && (element.classList.contains("popup-content") || /popup-content|content/i.test(String(element.className)))
      );
      if (!(content instanceof HTMLElement) || !isVisible(content)) continue;
      const closeRegion = Array.from(wrapper.children).find(
        (element) => element instanceof HTMLElement && element !== content && isVisible(element)
      );
      if (!(closeRegion instanceof HTMLElement)) continue;
      const candidates = [
        closeRegion,
        ...Array.from(closeRegion.querySelectorAll("button, [role='button'], span, div, a"))
      ].filter((element) => element instanceof HTMLElement && isVisible(element));
      const ranked = candidates.map((element) => {
        const rect = element.getBoundingClientRect();
        const small = rect.width > 8 && rect.width <= 80 && rect.height > 8 && rect.height <= 80;
        if (!small) return null;
        const mask = hasCloseMaskIcon(element) || [...element.children].some((c) => c instanceof HTMLElement && hasCloseMaskIcon(c));
        return {
          element,
          area: rect.width * rect.height,
          // Prefer mask/red X over random small chips in the close region.
          score: (mask ? -1e4 : 0) + rect.width * rect.height
        };
      }).filter(Boolean);
      ranked.sort((a, b) => a.score - b.score);
      const close = ranked[0]?.element;
      if (close) {
        latchedWrapper = wrapper;
        if (close.tagName === "SPAN" && close.parentElement instanceof HTMLElement && isSmall(close.parentElement)) {
          latchedClose = close.parentElement;
          return close.parentElement;
        }
        latchedClose = close;
        return close;
      }
    }
    return null;
  }
  function findAdCloseByMaskImage() {
    const byAttr = document.querySelectorAll(
      "span[style*='mask-image'], span[style*='mask-image' i], div[style*='mask-image'], [style*='mask-image']"
    );
    const pool = [];
    const attrMax = Math.min(byAttr.length, 50);
    for (let i = 0; i < attrMax; i += 1) {
      const el = byAttr[i];
      if (el instanceof HTMLElement) pool.push(el);
    }
    if (pool.length < 3) {
      const loose = document.querySelectorAll("span, div");
      const looseMax = Math.min(loose.length, 200);
      for (let i = 0; i < looseMax; i += 1) {
        const el = loose[i];
        if (!(el instanceof HTMLElement) || !isVisible(el) || !isSmall(el)) continue;
        if (hasCloseMaskIcon(el)) pool.push(el);
      }
    }
    let best = null;
    let bestScore = Infinity;
    for (const el of pool) {
      if (!isVisible(el) || !isSmall(el)) continue;
      if (!hasCloseMaskIcon(el) && !hasCloseMaskIcon(
        el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el
      )) {
        if (!/mask-image/i.test(el.getAttribute("style") || "")) continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.top < 8 || rect.top > window.innerHeight * 0.7) continue;
      if (rect.left < window.innerWidth * 0.25) continue;
      const area2 = rect.width * rect.height;
      if (area2 < bestScore) {
        bestScore = area2;
        best = el.parentElement instanceof HTMLElement && isSmall(el.parentElement) && el.tagName === "SPAN" ? el.parentElement : el;
      }
    }
    if (best) {
      latchedWrapper = best.parentElement instanceof HTMLElement ? best.parentElement : best;
      latchedClose = best;
    }
    return best;
  }
  function findAdClose(_root = document) {
    if (dismissed) {
      logOnce("find:dismissed", "findAdClose \u2192 null (already dismissed)");
      return null;
    }
    if (latchedWrapper?.isConnected && latchedClose?.isConnected && isVisible(latchedWrapper) && isVisible(latchedClose)) {
      return latchedClose;
    }
    latchedWrapper = null;
    latchedClose = null;
    const wrapperCount = document.querySelectorAll(
      "[data-testid='popup-wrapper'], [data-testid='Popup-wrapper'], [data-testid*='popup' i]"
    ).length;
    const maskAttrCount = document.querySelectorAll(
      "[style*='mask-image'], [style*='mask-image' i]"
    ).length;
    const legacy = findAdCloseLegacyPopupWrapper();
    if (legacy) {
      logOnce(
        "find:legacy",
        "findAdClose \u2192 LEGACY hit",
        { wrapperCount, maskAttrCount, el: describeEl(legacy) }
      );
      return legacy;
    }
    const mask = findAdCloseByMaskImage();
    if (mask) {
      logOnce(
        "find:mask",
        "findAdClose \u2192 MASK hit",
        { wrapperCount, maskAttrCount, el: describeEl(mask) }
      );
      return mask;
    }
    const sampleWrappers = Array.from(document.querySelectorAll(
      "[data-testid*='popup' i], [class*='popup' i], [class*='modal' i], [role='dialog']"
    )).slice(0, 8).map((el) => describeEl(el));
    const sampleMasks = Array.from(document.querySelectorAll(
      "span, div"
    )).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const s = el.getAttribute("style") || "";
      if (/mask-image/i.test(s)) return true;
      try {
        const cs = getComputedStyle(el);
        return /url\(|svg/i.test(cs.maskImage || "");
      } catch {
        return false;
      }
    }).slice(0, 8).map((el) => describeEl(el));
    logOnce("find:miss", "findAdClose \u2192 MISS", {
      url: location.href,
      wrapperCount,
      maskAttrCount,
      sampleWrappers,
      sampleMasks
    });
    return null;
  }
  function clearNoteAndTarget() {
    document.getElementById(NOTE_ID)?.remove();
    document.getElementById(RING_ID)?.remove();
    if (activeTarget) {
      activeTarget.classList.remove(TARGET_CLASS);
      activeTarget = null;
    }
    lastPaintRect = null;
  }
  function hideManualDecorations() {
    const note = document.getElementById(NOTE_ID);
    if (note) note.style.display = "none";
    const ring = document.getElementById(RING_ID);
    if (ring) ring.style.display = "none";
    activeTarget?.classList.remove(TARGET_CLASS);
  }
  function onGuideScroll() {
    if (execMode !== "manual") return;
    if (activeTarget?.isConnected && elementIntersectsViewport(activeTarget) && lastPaintRect) {
      const rect = activeTarget.getBoundingClientRect();
      const stable = Math.abs(rect.left - lastPaintRect.left) < 1 && Math.abs(rect.top - lastPaintRect.top) < 1 && Math.abs(rect.width - lastPaintRect.width) < 1 && Math.abs(rect.height - lastPaintRect.height) < 1;
      if (stable) return;
    }
    scrollActive = true;
    hideManualDecorations();
    if (scrollTimer !== null) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      scrollTimer = null;
      scrollActive = false;
      tick();
    }, SCROLL_SETTLE_MS);
  }
  function ensureRing() {
    ensureStyles();
    let ring = document.getElementById(RING_ID);
    if (!ring) {
      ring = document.createElement("div");
      ring.id = RING_ID;
      document.documentElement.appendChild(ring);
    }
    return ring;
  }
  function paintHighlight(target) {
    if (scrollActive || execMode === "auto" || !elementIntersectsViewport(target)) {
      hideManualDecorations();
      return;
    }
    ensureStyles();
    target.classList.add(TARGET_CLASS);
    const rect = target.getBoundingClientRect();
    lastPaintRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    const pad = 6;
    const ring = ensureRing();
    ring.style.display = "block";
    ring.style.left = `${Math.max(0, rect.left - pad)}px`;
    ring.style.top = `${Math.max(0, rect.top - pad)}px`;
    ring.style.width = `${Math.max(24, rect.width + pad * 2)}px`;
    ring.style.height = `${Math.max(24, rect.height + pad * 2)}px`;
    logOnce("paint", "paintHighlight", {
      el: describeEl(target),
      ring: {
        left: ring.style.left,
        top: ring.style.top,
        width: ring.style.width,
        height: ring.style.height,
        inDom: Boolean(document.getElementById(RING_ID))
      }
    });
    let note = document.getElementById(NOTE_ID);
    if (!note) {
      note = document.createElement("span");
      note.id = NOTE_ID;
      document.documentElement.appendChild(note);
    }
    const noteWidth = 280;
    const fitsLeft = rect.left - 18 - noteWidth >= 8;
    const placement = fitsLeft ? "left" : "bottom";
    note.dataset.placement = placement;
    note.textContent = pointAtTarget("B\u1EA1n t\u1EF1 b\u1EA5m \u2715 \u0111\u1EC3 \u0111\xF3ng", placement);
    note.style.display = "block";
    note.style.left = `${fitsLeft ? rect.left - noteWidth - 18 : Math.max(8, Math.min(window.innerWidth - noteWidth - 8, rect.left))}px`;
    note.style.top = `${fitsLeft ? Math.max(8, rect.top + Math.max(0, (rect.height - 36) / 2)) : Math.min(window.innerHeight - 52, rect.bottom + 12)}px`;
  }
  function markDismissed() {
    if (dismissed) return;
    if (execMode === "manual" && !manualCloseIntent) return;
    dismissed = true;
    latchedWrapper = null;
    latchedClose = null;
    missingCloseSince = 0;
    clearNoteAndTarget();
    stopPolling();
    onAdDismissed?.();
  }
  function popupLooksGone(close) {
    if (!close || !close.isConnected || !isVisible(close)) return true;
    if (latchedWrapper) {
      if (!latchedWrapper.isConnected) return true;
      if (!isVisible(latchedWrapper)) return true;
    }
    if (!findAdClose()) return true;
    return false;
  }
  function waitForActualDismissal(close, attempt = 0) {
    if (dismissed) return;
    if (popupLooksGone(close)) {
      log("waitForActualDismissal: popup gone \u2192 markDismissed", { attempt });
      markDismissed();
      return;
    }
    if (attempt >= 40) {
      log("waitForActualDismissal: still visible, retry", { attempt, execMode });
      if (execMode === "auto") autoClickAttempted = false;
      else {
        dismissBound = false;
        attachDismissListener(close);
      }
      return;
    }
    window.setTimeout(() => waitForActualDismissal(close, attempt + 1), 80);
  }
  function attachDismissListener(close) {
    if (dismissBound) return;
    dismissBound = true;
    const onUserClose = (ev) => {
      if (execMode === "manual") manualCloseIntent = true;
      log("user click on \u2715", { type: ev.type, el: describeEl(close) });
      window.setTimeout(() => waitForActualDismissal(close, 0), 50);
      window.setTimeout(() => waitForActualDismissal(close, 1), 200);
      window.setTimeout(() => waitForActualDismissal(close, 2), 500);
    };
    close.addEventListener("click", onUserClose, { once: true, capture: true });
    close.addEventListener("pointerup", onUserClose, { once: true, capture: true });
    close.querySelectorAll("span, div, button").forEach((child) => {
      child.addEventListener("click", onUserClose, { once: true, capture: true });
      child.addEventListener("pointerup", onUserClose, { once: true, capture: true });
    });
  }
  function stopPolling() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }
  function schedulePoll(ms) {
    stopPolling();
    if (!enabled || dismissed) return;
    timer = window.setInterval(tick, ms);
  }
  function tick() {
    if (!enabled || dismissed) return;
    const close = findAdClose();
    if (!close) {
      if (announced || activeTarget || latchedClose || latchedWrapper) {
        const now = Date.now();
        if (!missingCloseSince) missingCloseSince = now;
        if (now - missingCloseSince < TRANSIENT_REMOUNT_GRACE_MS) {
          schedulePoll(80);
          return;
        }
        if (execMode === "manual" && !manualCloseIntent) {
          schedulePoll(120);
          return;
        }
        log("tick: close gone after we guided it \u2192 markDismissed", {
          announced,
          hadActive: Boolean(activeTarget),
          hadLatch: Boolean(latchedClose)
        });
        markDismissed();
        return;
      }
      logOnce("tick:miss", "tick: no close control (waiting for popup)", {
        enabled,
        dismissed,
        execMode,
        url: location.href
      });
      if (activeTarget) clearNoteAndTarget();
      dismissBound = false;
      autoClickAttempted = false;
      schedulePoll(POLL_IDLE_MS);
      return;
    }
    missingCloseSince = 0;
    if (activeTarget !== close) {
      log("tick: NEW target latched", describeEl(close));
      if (activeTarget) activeTarget.classList.remove(TARGET_CLASS);
      activeTarget = close;
      dismissBound = false;
      autoClickAttempted = false;
      if (execMode !== "auto") {
        attachDismissListener(close);
      }
      if (!announced && execMode === "manual") {
        announced = true;
        onAdVisible?.("B\u1EA1n vui l\xF2ng b\u1EA5m \u2715 tr\xEAn popup. Zapee kh\xF4ng t\u1EF1 \u0111\xF3ng.");
      }
    }
    if (execMode === "auto" && !autoClickAttempted) {
      autoClickAttempted = true;
      hideManualDecorations();
      log("tick: AUTO click \u2715 now (silent)", { el: describeEl(close) });
      safeClick(close);
      waitForActualDismissal(close);
    } else if (execMode === "manual") {
      paintHighlight(close);
    }
    schedulePoll(POLL_ACTIVE_MS);
  }
  function stopCoopAdGuide() {
    enabled = false;
    onAdVisible = null;
    onAdDismissed = null;
    stopPolling();
    clearNoteAndTarget();
    latchedWrapper = null;
    latchedClose = null;
    announced = false;
    dismissBound = false;
    autoClickAttempted = false;
    window.removeEventListener("scroll", onGuideScroll, true);
    if (scrollTimer !== null) {
      window.clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    scrollActive = false;
    missingCloseSince = 0;
    lastPaintRect = null;
    manualCloseIntent = false;
    document.getElementById(NOTE_STYLE_ID)?.remove();
  }
  function resetCoopAdGuideForNewSession() {
    dismissed = false;
    autoClickAttempted = false;
    manualCloseIntent = false;
    stopCoopAdGuide();
    dismissed = false;
  }
  function isCoopHost(hostname = location.hostname) {
    return /(^|\.)cooponline\.vn$/i.test(hostname) || /oauth-saigoncoop/i.test(hostname);
  }

  // src/content/coop-location-seed.ts
  var RELOAD_FLAG = "zapee_coop_location_reloaded";
  var ACCOUNT_NAV_FLAG = "zapee_coop_account_nav";
  var SHOW_PROFILE_MODAL_KEY = "showProfileModal";
  function disableCoopProfileModal() {
    try {
      sessionStorage.setItem(SHOW_PROFILE_MODAL_KEY, "false");
    } catch {
    }
  }
  function resetCoopLocationSessionState() {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
      sessionStorage.removeItem(ACCOUNT_NAV_FLAG);
    } catch {
    }
  }
  function locationStorageSuffixes() {
    return ["", "_mobile"];
  }
  function writeLocationCookie(key, value, encode = false) {
    if (value == null || value === "") return;
    const expires = new Date(Date.now() + 63072e6).toUTCString();
    const cookieValue = encode ? encodeURIComponent(String(value)) : String(value);
    document.cookie = `${key}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;`;
    document.cookie = `${key}=${cookieValue};expires=${expires};Path=/;SameSite=None;Secure;`;
  }
  function buyerAddressOf(payload) {
    return String(
      payload.shippingAddress?.fullAddress || payload.shippingAddress?.addressLine || payload.buyerAddress || payload.address || payload.buyer?.address || ""
    ).trim();
  }
  function prepareLocationStorage(payload) {
    disableCoopProfileModal();
    const checkout = payload.storeContext || payload.checkout || {};
    const buyerAddress = buyerAddressOf(payload);
    if (!checkout.terminalCode || !buyerAddress) {
      return { ready: false, changed: false };
    }
    try {
      const terminal = {
        terminalCode: checkout.terminalCode,
        code: checkout.terminalCode,
        terminalId: checkout.terminalId,
        id: checkout.terminalId,
        terminalName: checkout.terminalName,
        name: checkout.terminalName,
        address: checkout.terminalAddress,
        fullAddress: checkout.terminalAddress,
        siteId: checkout.siteId,
        provinceCode: checkout.provinceCode
      };
      const terminals = Array.isArray(checkout.terminals) && checkout.terminals.length ? checkout.terminals : [terminal];
      const locationValue = {
        provinceCode: checkout.provinceCode,
        districtCode: checkout.districtCode,
        wardCode: checkout.wardCode,
        address: payload.shippingAddress?.addressLine || payload.checkout?.addressLine || buyerAddress,
        fullAddress: buyerAddress,
        provinceName: checkout.provinceName,
        districtName: checkout.districtName,
        wardName: checkout.wardName,
        lat: checkout.lat,
        lng: checkout.lng,
        latitude: checkout.lat,
        longitude: checkout.lng
      };
      let changed = false;
      for (const suffix of locationStorageSuffixes()) {
        const nextTerminal = String(checkout.terminalCode);
        const prevTerminal = localStorage.getItem(`TERMINAL${suffix}`);
        const prevLoc = localStorage.getItem(`USER_LOCATION${suffix}`);
        if (prevTerminal !== nextTerminal || prevLoc !== JSON.stringify(locationValue)) changed = true;
        localStorage.setItem(`TERMINAL${suffix}`, nextTerminal);
        localStorage.setItem(`TERMINAL_ID${suffix}`, String(checkout.terminalId || ""));
        localStorage.setItem(`TERMINAL_NAME${suffix}`, String(checkout.terminalName || ""));
        localStorage.setItem(`TERMINALS${suffix}`, JSON.stringify(terminals));
        localStorage.setItem(`USER_LOCATION${suffix}`, JSON.stringify(locationValue));
        localStorage.setItem(`ISGETGEOLOCATION${suffix}`, "false");
        localStorage.setItem(`USERTERMINALCODE${suffix}`, nextTerminal);
        localStorage.setItem(`USERTERMINALID${suffix}`, String(checkout.terminalId || ""));
        writeLocationCookie(`terminal${suffix}`, nextTerminal);
        writeLocationCookie(`terminal_id${suffix}`, checkout.terminalId || "");
        writeLocationCookie(`terminal_name${suffix}`, checkout.terminalName || "", true);
        writeLocationCookie(`isGetGeoLocation${suffix}`, "false");
        writeLocationCookie(`userTerminalCode${suffix}`, nextTerminal);
        writeLocationCookie(`userTerminalId${suffix}`, checkout.terminalId || "");
      }
      localStorage.setItem("terminal", String(checkout.terminalCode));
      localStorage.setItem("terminalCode", String(checkout.terminalCode));
      localStorage.setItem("currentTerminal", String(checkout.terminalCode));
      try {
        window.dispatchEvent(new StorageEvent("storage", {
          key: "USER_LOCATION",
          newValue: JSON.stringify(locationValue),
          storageArea: localStorage
        }));
      } catch {
      }
      try {
        // iOS Safari: StorageEvent phát từ isolated world không tới được React
        // của trang — nhờ page-bridge-main.js (MAIN world) phát lại. B5/B7.
        window.postMessage({
          source: "zapee-ext-bridge",
          cmd: "storage_event",
          key: "USER_LOCATION",
          newValue: JSON.stringify(locationValue)
        }, location.origin);
      } catch {
      }
      return { ready: true, changed };
    } catch {
      return { ready: false, changed: false };
    }
  }
  function isAlreadyOnAccountOrAuth() {
    const href = location.href;
    if (/\/account(?:\/|$|\?)/i.test(href)) return true;
    if (/oauth-saigoncoop|\/dang-nhap|\/login/i.test(href)) return true;
    if (/\/cart|\/checkout/i.test(href)) return true;
    if (/--s\d+/i.test(location.pathname)) return true;
    return false;
  }
  function shouldNavigateToAccountAfterLocation() {
    if (!/(^|\.)cooponline\.vn$/i.test(location.hostname)) return false;
    if (isAlreadyOnAccountOrAuth()) return false;
    if (sessionStorage.getItem(ACCOUNT_NAV_FLAG) === "1") return false;
    return true;
  }
  function markAccountNavDone() {
    sessionStorage.setItem(ACCOUNT_NAV_FLAG, "1");
  }
  function bootstrapCoopLocation(payload) {
    if (!/(^|\.)cooponline\.vn$/i.test(location.hostname)) {
      return { ready: false, reloaded: false, goAccount: false, message: "" };
    }
    const result = prepareLocationStorage(payload);
    if (!result.ready) {
      const storeContext = payload.storeContext || payload.checkout;
      const err = storeContext?.locationResolveError ? ` (${storeContext.locationResolveError})` : "";
      return {
        ready: false,
        reloaded: false,
        goAccount: false,
        message: `Ch\u01B0a \u0111\u1ED3ng b\u1ED9 \u0111\u01B0\u1EE3c \u0111\u1ECBa ch\u1EC9/c\u1EEDa h\xE0ng Co.op${err}.`
      };
    }
    const alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === "1";
    if (result.changed && !alreadyReloaded) {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      return {
        ready: true,
        reloaded: true,
        goAccount: false,
        message: "\u0110\xE3 n\u1EA1p \u0111\u1ECBa ch\u1EC9/c\u1EEDa h\xE0ng. \u0110ang t\u1EA3i l\u1EA1i Co.op \u0111\u1EC3 \xE1p d\u1EE5ng\u2026"
      };
    }
    const goAccount = shouldNavigateToAccountAfterLocation();
    const storeLabel = (payload.storeContext || payload.checkout)?.terminalName || "c\u1EEDa h\xE0ng";
    return {
      ready: true,
      reloaded: false,
      goAccount,
      message: goAccount ? `\u0110\xE3 n\u1EA1p ${storeLabel}. \u0110ang m\u1EDF trang t\xE0i kho\u1EA3n\u2026` : ""
    };
  }

  // src/content/coop-login-guide.ts
  var STYLE_ID = "zapee-coop-login-guide-css";
  var POLL_MS = 500;
  var AUTO_HIGHLIGHT_HOLD_MS = 2800;
  var SCROLL_SETTLE_MS2 = 160;
  var PHONE_READY_DATASET_KEY = "zapeeCoopPhoneReady";
  var GUIDE_CSS = `
${guideHighlightCss({
    target: ".zapee-guide-target",
    note: "#zapee-guide-note",
    noteAction: "#zapee-guide-note .zapee-guide-note-action"
  })}
.zapee-guide-target {
  position: relative !important;
  z-index: 2147483643 !important;
}
.zapee-guide-badge {
  position: fixed;
  z-index: 2147483646;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 3px solid #fff;
  border-radius: 50%;
  background: #f5a623;
  color: #fff;
  box-shadow: 0 3px 10px rgba(0, 0, 0, .24);
  font: 800 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: none;
}
.zapee-guide-badge.current {
  transform: scale(1.1);
  box-shadow: 0 0 0 5px rgba(245, 166, 35, .2), 0 3px 10px rgba(0, 0, 0, .24);
}
@media (max-width: 600px) {
  #zapee-guide-note { display: none; }
}
`;
  var enabled2 = false;
  var timer2 = null;
  var phone = "";
  var execMode2 = "manual";
  var authMode = "login";
  var registerClickStarted = false;
  var recoveryClicksAttached = false;
  var onSignupOtpVisible;
  var onAccountModeChange;
  var autoPhoneFilled = false;
  var manualPasteDone = false;
  var autoPhoneHighlightSince = 0;
  var activeTarget2 = null;
  var badges = /* @__PURE__ */ new Map();
  var lastBubbleKey = "";
  var guideScrolling = false;
  var guideScrollTimer = null;
  function ensureStyles2() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = GUIDE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  function visible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }
  function isForgotContext() {
    if (/forgot|reset[-/]?password|quen-mat-khau|recover/i.test(location.href)) return true;
    if (pageMode() === "register") return false;
    const heading = document.querySelector("h1, h2, h3");
    return /quên mật khẩu|đặt lại mật khẩu|tạo mật khẩu mới/i.test(heading?.textContent || "");
  }
  function isLoginContext() {
    if (/oauth-saigoncoop|\/(?:dang-nhap|login|signup)(?:[/?#]|$)/i.test(location.href)) return true;
    if (isForgotContext()) return true;
    if (document.querySelector("input[type='password']")) return true;
    if (findOtpInputs().length === 6) return true;
    return false;
  }
  function pageMode() {
    return /\/signup(?:[/?#]|$)/i.test(location.href) ? "register" : "login";
  }
  function exactInteractiveText(pattern) {
    for (const el of Array.from(document.querySelectorAll("a, button, [role='button'], input[type='submit']"))) {
      if (!visible(el)) continue;
      const text = (el.textContent || el.value || "").replace(/\s+/g, " ").trim();
      if (pattern.test(text)) return el;
    }
    return null;
  }
  function findRegisterLink() {
    return exactInteractiveText(/^đăng ký ngay$/i);
  }
  function findForgotLink() {
    return exactInteractiveText(/^quên mật khẩu\??$/i);
  }
  function findSwitchLoginLink() {
    return exactInteractiveText(/^đăng nhập( ngay)?$/i);
  }
  function findMatchingTextElement(pattern, maxLen = 400) {
    let best = null;
    let bestLen = Infinity;
    for (const node of Array.from(document.querySelectorAll("p, span, div, li, small, label, strong"))) {
      if (!visible(node)) continue;
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > maxLen || !pattern.test(text)) continue;
      if (text.length < bestLen) {
        best = node;
        bestLen = text.length;
      }
    }
    return best;
  }
  function errorCard(pattern) {
    const leaf = findMatchingTextElement(pattern);
    if (!leaf) return null;
    let node = leaf;
    let found = leaf;
    for (let depth = 0; node && depth < 6; depth += 1) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 800) break;
      found = node;
      if (/quên mật khẩu|đăng ký ngay|đăng nhập/i.test(text) && node !== leaf) return node;
      node = node.parentElement;
    }
    return found;
  }
  function findLoginError() {
    return errorCard(
      /số điện thoại hoặc mật khẩu chưa đúng|đăng ký tài khoản nếu bạn chưa có|vui lòng kiểm tra lại/i
    );
  }
  function findRegisterExistsError() {
    return errorCard(/đã được đăng ký|đã tồn tại|số điện thoại đã đăng ký|tài khoản này đã có/i);
  }
  function findOtpInputs() {
    const modal = Array.from(document.querySelectorAll(".teko-modal.teko-modal-show")).find((node) => /mã xác thực|mã xác nhận otp/i.test(node.textContent || ""));
    if (!modal) return [];
    return Array.from(modal.querySelectorAll("input[type='number'], input[inputmode='numeric']")).filter((el) => el instanceof HTMLInputElement && visible(el));
  }
  function findPhoneInput() {
    const sels = [
      "input[type='tel']",
      "input[name*='username' i]",
      "input[placeholder*='s\u1ED1 \u0111i\u1EC7n tho\u1EA1i' i]",
      "input[placeholder*='\u0111i\u1EC7n tho\u1EA1i' i]",
      "input[placeholder*='phone' i]"
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el instanceof HTMLInputElement && visible(el)) return el;
    }
    const pass = document.querySelector("input[type='password']");
    if (pass) {
      const form = pass.closest("form") || pass.parentElement?.parentElement?.parentElement;
      const text = form?.querySelector("input[type='text'], input:not([type])");
      if (text && visible(text)) return text;
    }
    return null;
  }
  function findPassword() {
    const el = document.querySelector("input[type='password']");
    return el instanceof HTMLInputElement && visible(el) ? el : null;
  }
  function findConsent() {
    const boxes = Array.from(document.querySelectorAll("input[type='checkbox']"));
    for (const el of boxes) {
      if (!(el instanceof HTMLInputElement) || !visible(el)) continue;
      const wrap = el.closest("label") || el.parentElement;
      const text = wrap?.textContent || "";
      if (/điều khoản|chính sách|đồng ý|thành viên|privacy|terms|bảo mật/i.test(text)) return el;
    }
    const pass = findPassword();
    const form = pass?.closest("form") || pass?.parentElement?.parentElement;
    const near = form?.querySelector("input[type='checkbox']");
    if (near instanceof HTMLInputElement && visible(near)) return near;
    return boxes.find((el) => el instanceof HTMLInputElement && visible(el)) || null;
  }
  function findSubmit(mode) {
    if (isForgotContext()) {
      return exactInteractiveText(/^(gửi mã|gửi lại|tiếp tục|xác nhận|đặt lại mật khẩu)$/i) || exactInteractiveText(/^đăng nhập$/i);
    }
    return exactInteractiveText(mode === "register" ? /^đăng ký$/i : /^đăng nhập$/i);
  }
  function findFields() {
    const mode = pageMode();
    return {
      registerLink: findRegisterLink(),
      phone: findPhoneInput(),
      password: findPassword(),
      consent: findConsent(),
      submit: findSubmit(mode),
      otpInputs: findOtpInputs()
    };
  }
  function setNativeValue2(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function phoneFilled(el) {
    return Boolean(el && (el.value || "").replace(/\D/g, "").length >= 8);
  }
  function syncPhoneReadyMarker(fields) {
    const completed2 = phoneFilled(fields.phone) && (execMode2 === "auto" || manualPasteDone);
    if (completed2) document.documentElement.dataset[PHONE_READY_DATASET_KEY] = "true";
    else delete document.documentElement.dataset[PHONE_READY_DATASET_KEY];
  }
  function switchAccountMode(mode) {
    if (authMode === mode) {
      if (mode === "register") registerClickStarted = true;
      return;
    }
    authMode = mode;
    if (mode === "register") registerClickStarted = true;
    lastBubbleKey = "";
    onAccountModeChange?.(mode);
  }
  function onAuthRecoveryClick(event) {
    const source = event.target;
    const el = source instanceof Element ? source.closest("a, button, [role='button']") : null;
    if (!el) return;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (/^đăng ký ngay$/i.test(text)) {
      switchAccountMode("register");
      return;
    }
    if (/^đăng nhập( ngay)?$/i.test(text) && (pageMode() === "register" || findRegisterExistsError())) {
      switchAccountMode("login");
    }
  }
  function resolveStep(fields) {
    if (!isLoginContext()) return "done";
    if (isForgotContext()) {
      if (fields.otpInputs.length === 6) return "otp";
      if (execMode2 === "manual" && !manualPasteDone && fields.phone) return "paste";
      if (!phoneFilled(fields.phone) && fields.phone) return "paste";
      if (fields.password && !fields.password.value) return "password";
      if (fields.submit) return "submit";
      if (fields.phone) return phoneFilled(fields.phone) ? "password" : "paste";
      return "done";
    }
    if (authMode === "login" && findLoginError()) return "recover";
    if (authMode === "register" && pageMode() === "register" && findRegisterExistsError()) {
      return "switch-login";
    }
    if (authMode === "register" && pageMode() === "login" && fields.registerLink) return "switch-register";
    if (fields.otpInputs.length === 6) return "otp";
    if (execMode2 === "manual" && !manualPasteDone && fields.phone) return "paste";
    if (!phoneFilled(fields.phone) && fields.phone) return "paste";
    if (fields.password && !fields.password.value) return "password";
    if (fields.consent && !fields.consent.checked) return "consent";
    if (fields.submit || fields.password) return "submit";
    if (fields.phone) return phoneFilled(fields.phone) ? "password" : "paste";
    return "done";
  }
  function passwordControlTarget(input) {
    if (!input) return null;
    const inputRect = input.getBoundingClientRect();
    let node = input.parentElement;
    let fallback = input;
    for (let depth = 0; node && depth < 4; depth += 1) {
      if (node.matches("form, body, html")) break;
      const rect = node.getBoundingClientRect();
      const compact = rect.width >= inputRect.width && rect.width <= inputRect.width + 160 && rect.height >= inputRect.height && rect.height <= Math.max(96, inputRect.height * 2.2);
      if (!compact || !visible(node)) {
        node = node.parentElement;
        continue;
      }
      fallback = node;
      const adornment = node.querySelector("button, [role='button'], svg");
      if (adornment && !input.contains(adornment)) return node;
      node = node.parentElement;
    }
    return fallback;
  }
  function otpGroupTarget(inputs) {
    if (!inputs.length) return null;
    let node = inputs[0].parentElement;
    for (let depth = 0; node && depth < 6; depth += 1) {
      if (inputs.every((input) => node?.contains(input)) && visible(node)) {
        return node;
      }
      node = node.parentElement;
    }
    return inputs[0];
  }
  function targetFor(step, fields) {
    if (step === "switch-register") return fields.registerLink;
    if (step === "recover") return findLoginError() || findForgotLink() || findRegisterLink();
    if (step === "switch-login") return findSwitchLoginLink() || findRegisterExistsError();
    if (step === "paste") return fields.phone;
    if (step === "password") return passwordControlTarget(fields.password);
    if (step === "consent") {
      const c = fields.consent;
      if (!c) return null;
      let p = c;
      for (let i = 0; i < 5 && p; i += 1) {
        const t = (p.textContent || "").trim();
        if (t.length >= 20 && t.length <= 600) return p;
        p = p.parentElement;
      }
      return c;
    }
    if (step === "submit") return fields.submit;
    if (step === "otp") return otpGroupTarget(fields.otpInputs);
    return null;
  }
  function positionNear(element, node, offsetY = -12) {
    const rect = element.getBoundingClientRect();
    node.style.left = `${Math.max(8, rect.left - 10)}px`;
    node.style.top = `${Math.max(8, rect.top + offsetY)}px`;
  }
  function positionOutsideLeft(element, node) {
    const rect = element.getBoundingClientRect();
    node.style.left = `${Math.max(8, rect.left - 46)}px`;
    node.style.top = `${Math.max(8, rect.top + (rect.height - 30) / 2)}px`;
  }
  function syncBadge(number, element, current, used, placement = "corner") {
    if (!element || !visible(element) || !elementIntersectsViewport(element)) return;
    let badge = badges.get(number);
    if (!badge) {
      badge = document.createElement("span");
      badge.textContent = String(number);
      document.documentElement.appendChild(badge);
      badges.set(number, badge);
    }
    badge.className = `zapee-guide-badge${current ? " current" : ""}`;
    if (placement === "outside-left") positionOutsideLeft(element, badge);
    else positionNear(element, badge);
    used.add(number);
  }
  function renderBadges(step, fields) {
    const used = /* @__PURE__ */ new Set();
    const numberByStep = {
      paste: 1,
      password: 2,
      consent: 3,
      submit: 4,
      otp: 5
    };
    const number = numberByStep[step];
    if (number) {
      syncBadge(
        number,
        targetFor(step, fields),
        true,
        used,
        step === "consent" ? "outside-left" : "corner"
      );
    }
    badges.forEach((badge, n) => {
      if (!used.has(n)) {
        badge.remove();
        badges.delete(n);
      }
    });
  }
  function renderTargetOutline(target) {
    if (activeTarget2 && activeTarget2 !== target) {
      activeTarget2.classList.remove("zapee-guide-target");
    }
    activeTarget2 = target;
    if (target) target.classList.add("zapee-guide-target");
  }
  function renderTargetNote(step, target) {
    const labels = {
      "switch-register": "B\u1EA5m \u0110\u0103ng k\xFD ngay",
      recover: "Qu\xEAn m\u1EADt kh\u1EA9u? ho\u1EB7c \u0110\u0103ng k\xFD ngay n\u1EBFu ch\u01B0a c\xF3 t\xE0i kho\u1EA3n",
      "switch-login": "B\u1EA5m \u0110\u0103ng nh\u1EADp \u2014 s\u1ED1 n\xE0y \u0111\xE3 c\xF3 t\xE0i kho\u1EA3n",
      // Thủ công: chữ là LỜI HƯỚNG DẪN, việc dán nằm ở nút xanh bên dưới (đừng để chữ trùng nhãn nút).
      paste: execMode2 === "auto" ? autoPhoneFilled ? "\u26A1 Zapee \u0111\xE3 \u0111i\u1EC1n S\u0110T" : "\u26A1 Zapee s\u1EBD \u0111i\u1EC1n S\u0110T" : "\u0110i\u1EC1n s\u1ED1 \u0111i\u1EC7n tho\u1EA1i v\xE0o \xF4 n\xE0y",
      password: "\u270D\uFE0F B\u1EA1n t\u1EF1 nh\u1EADp m\u1EADt kh\u1EA9u",
      consent: "T\xEDch \xF4 \u0111i\u1EC1u kho\u1EA3n",
      submit: authMode === "register" ? "B\u1EA5m \u0111\u1EC3 \u0111\u0103ng k\xFD" : "B\u1EA5m \u0111\u1EC3 \u0111\u0103ng nh\u1EADp",
      otp: "\u{1F510} B\u1EA1n t\u1EF1 nh\u1EADp m\xE3 OTP"
    };
    let note = document.getElementById("zapee-guide-note");
    if (!target || !labels[step] || !elementIntersectsViewport(target)) {
      note?.remove();
      return;
    }
    if (!note) {
      note = createGuideNote("");
      note.id = "zapee-guide-note";
      document.documentElement.appendChild(note);
    }
    note.style.display = "block";
    let anchor = target;
    if (step === "consent") {
      let candidate = target;
      for (let depth = 0; candidate && depth < 5; depth += 1) {
        const text = (candidate.textContent || "").trim();
        if (text.length >= 10 && text.length <= 500) {
          anchor = candidate;
          break;
        }
        candidate = candidate.parentElement;
      }
    }
    const rect = anchor.getBoundingClientRect();
    note.dataset.step = step;
    const noteWidth = note.offsetWidth || 230;
    const placement = pickNotePlacement(rect, noteWidth, 18);
    fillGuideNote(note, {
      text: labels[step] || "",
      placement,
      action: step === "paste" && execMode2 === "manual" ? { label: "D\xE1n v\xE0o trang", onClick: pastePhone } : null
    });
    note.style.left = `${placement === "right" ? rect.right + 18 : placement === "left" ? rect.left - noteWidth - 18 : Math.max(8, Math.min(window.innerWidth - noteWidth - 8, rect.left))}px`;
    note.style.top = `${placement !== "bottom" ? Math.max(8, rect.top + Math.max(0, (rect.height - 36) / 2)) : Math.min(window.innerHeight - 52, rect.bottom + 12)}px`;
  }
  function pastePhone() {
    const input = findPhoneInput();
    if (!input || !phone) return;
    setNativeValue2(input, phone);
    input.focus({ preventScroll: true });
    if (execMode2 === "manual") manualPasteDone = true;
    document.documentElement.dataset[PHONE_READY_DATASET_KEY] = "true";
    lastBubbleKey = "";
    tick2();
  }
  function speechFor(step) {
    if (step === "recover") {
      return "Th\xF4ng tin t\xE0i kho\u1EA3n ch\u01B0a \u0111\xFAng. B\u1EA5m Qu\xEAn m\u1EADt kh\u1EA9u n\u1EBFu qu\xEAn m\u1EADt kh\u1EA9u, ho\u1EB7c \u0110\u0103ng k\xFD ngay n\u1EBFu b\u1EA1n ch\u01B0a c\xF3 t\xE0i kho\u1EA3n. Gi\u1EEF nguy\xEAn Th\u1EE7 c\xF4ng/T\u1EF1 \u0111\u1ED9ng nh\u01B0 \u0111\xE3 ch\u1ECDn.";
    }
    if (step === "switch-login") {
      return "S\u1ED1 \u0111i\u1EC7n tho\u1EA1i n\xE0y \u0111\xE3 c\xF3 t\xE0i kho\u1EA3n. B\u1EA5m \u0110\u0103ng nh\u1EADp; Zapee gi\u1EEF nguy\xEAn ch\u1EBF \u0111\u1ED9 Th\u1EE7 c\xF4ng/T\u1EF1 \u0111\u1ED9ng nh\u01B0 \u0111\xE3 ch\u1ECDn.";
    }
    if (isForgotContext() && (step === "paste" || step === "password" || step === "otp" || step === "submit")) {
      if (step === "paste") {
        return execMode2 === "auto" ? "\u2460 Qu\xEAn m\u1EADt kh\u1EA9u: Zapee \u0111i\u1EC1n S\u0110T v\xE0o \xF4 \u0111ang t\xF4 s\xE1ng." : "\u2460 Qu\xEAn m\u1EADt kh\u1EA9u: b\u1EA5m D\xE1n v\xE0o trang \u0111\u1EC3 \u0111i\u1EC1n S\u0110T.";
      }
      if (step === "otp") return "B\u1EA1n t\u1EF1 nh\u1EADp OTP \u0111\u1EC3 \u0111\u1EB7t l\u1EA1i m\u1EADt kh\u1EA9u. Zapee kh\xF4ng \u0111\u1ECDc ho\u1EB7c l\u01B0u m\xE3.";
      if (step === "password") return "B\u1EA1n t\u1EF1 t\u1EA1o m\u1EADt kh\u1EA9u m\u1EDBi. Zapee kh\xF4ng \u0111\u1ECDc ho\u1EB7c l\u01B0u m\u1EADt kh\u1EA9u.";
      return "B\u1EA1n t\u1EF1 b\u1EA5m n\xFAt \u0111ang t\xF4 s\xE1ng \u0111\u1EC3 ho\xE0n t\u1EA5t qu\xEAn m\u1EADt kh\u1EA9u, r\u1ED3i \u0111\u0103ng nh\u1EADp l\u1EA1i.";
    }
    if (step === "switch-register") {
      return execMode2 === "auto" ? "B\u1EA1n ch\u1ECDn ch\u01B0a c\xF3 t\xE0i kho\u1EA3n \u2014 Zapee \u0111ang m\u1EDF \u0111\xFAng form \u0110\u0103ng k\xFD." : "B\u1EA1n ch\u1ECDn ch\u01B0a c\xF3 t\xE0i kho\u1EA3n \u2014 b\u1EA5m \u201C\u0110\u0103ng k\xFD ngay\u201D (khung xanh) \u0111\u1EC3 m\u1EDF form \u0111\u0103ng k\xFD.";
    }
    if (step === "paste") {
      if (execMode2 === "auto") {
        return autoPhoneFilled ? "\u2460 \u0110\xE3 \u0111i\u1EC1n S\u0110T v\xE0o \xF4 t\xF4 xanh \u2014 b\u1EA1n ki\u1EC3m tra r\u1ED3i sang m\u1EADt kh\u1EA9u." : "\u2460 Khung v\xE0ng \u0111ang t\xF4 \xF4 S\u0110T \u2014 Zapee s\u1EBD \u0111i\u1EC1n gi\xFAp sau m\u1ED9t nh\u1ECBp \u0111\u1EC3 b\u1EA1n th\u1EA5y thao t\xE1c.";
      }
      return "B\u1EA1n vui l\xF2ng b\u1EA5m \u201CD\xE1n v\xE0o trang\u201D c\u1EA1nh \xF4 s\u1ED1 \u0111i\u1EC7n tho\u1EA1i.";
    }
    const map = {
      "switch-register": "",
      recover: "",
      "switch-login": "",
      paste: "",
      password: "\u2461 B\u1EA1n t\u1EF1 nh\u1EADp m\u1EADt kh\u1EA9u Co.op (khung v\xE0ng) \u2014 Zapee kh\xF4ng \u0111\u1ECDc ho\u1EB7c l\u01B0u.",
      consent: "\u2462 B\u1EA1n t\u1EF1 t\xEDch \xF4 \u0111i\u1EC1u kho\u1EA3n / ch\xEDnh s\xE1ch (khung v\xE0ng). Zapee kh\xF4ng t\u1EF1 t\xEDch.",
      submit: authMode === "register" ? "\u2463 B\u1EA1n t\u1EF1 b\u1EA5m \u0110\u0103ng k\xFD tr\xEAn Co.op (khung v\xE0ng). Zapee kh\xF4ng b\u1EA5m h\u1ED9." : "\u2463 B\u1EA1n t\u1EF1 b\u1EA5m \u0110\u0103ng nh\u1EADp tr\xEAn Co.op (khung v\xE0ng). Zapee kh\xF4ng b\u1EA5m h\u1ED9.",
      otp: "\u2464 B\u1EA1n t\u1EF1 nh\u1EADp \u0111\u1EE7 6 s\u1ED1 OTP trong popup M\xE3 x\xE1c th\u1EF1c. Zapee kh\xF4ng \u0111\u1ECDc ho\u1EB7c l\u01B0u OTP.",
      done: authMode === "register" ? "\u0110\u0103ng k\xFD xong \u2014 Zapee s\u1EBD ki\u1EC3m tra t\xE0i kho\u1EA3n r\u1ED3i ti\u1EBFp t\u1EE5c th\xEAm gi\u1ECF." : "\u0110\u0103ng nh\u1EADp xong \u2014 Zapee s\u1EBD ti\u1EBFp t\u1EE5c th\xEAm gi\u1ECF."
    };
    return map[step];
  }
  function checklistTitle() {
    if (isForgotContext()) return "Qu\xEAn m\u1EADt kh\u1EA9u Co.op";
    return authMode === "register" ? "\u0110\u0103ng k\xFD Co.op" : "\u0110\u0103ng nh\u1EADp Co.op";
  }
  function buildChecklist(step) {
    if (step === "recover") {
      return [
        { mark: "!", label: "C\u1EA3nh b\xE1o \u0111\u0103ng nh\u1EADp", state: "current" },
        { mark: "A", label: "Qu\xEAn m\u1EADt kh\u1EA9u", state: "pending" },
        { mark: "B", label: "\u0110\u0103ng k\xFD ngay n\u1EBFu ch\u01B0a c\xF3 t\xE0i kho\u1EA3n", state: "pending" }
      ];
    }
    if (step === "switch-login") {
      return [
        { mark: "!", label: "S\u1ED1 n\xE0y \u0111\xE3 c\xF3 t\xE0i kho\u1EA3n", state: "current" },
        { mark: "1", label: "B\u1EA5m \u0110\u0103ng nh\u1EADp", state: "pending" }
      ];
    }
    const order = isForgotContext() ? ["paste", "password", "otp", "submit"] : authMode === "register" ? ["paste", "password", "consent", "submit", "otp"] : ["paste", "password", "consent", "submit"];
    const labels = {
      paste: execMode2 === "auto" ? "Zapee \u0111i\u1EC1n S\u0110T" : "D\xE1n S\u0110T v\xE0o trang",
      password: isForgotContext() ? "B\u1EA1n t\u1EF1 t\u1EA1o m\u1EADt kh\u1EA9u m\u1EDBi" : "B\u1EA1n t\u1EF1 nh\u1EADp m\u1EADt kh\u1EA9u",
      consent: "B\u1EA1n t\u1EF1 t\xEDch \u0111i\u1EC1u kho\u1EA3n",
      submit: isForgotContext() ? "B\u1EA1n t\u1EF1 ho\xE0n t\u1EA5t qu\xEAn m\u1EADt kh\u1EA9u" : authMode === "register" ? "B\u1EA1n t\u1EF1 b\u1EA5m \u0110\u0103ng k\xFD" : "B\u1EA1n t\u1EF1 b\u1EA5m \u0110\u0103ng nh\u1EADp",
      otp: "B\u1EA1n t\u1EF1 nh\u1EADp OTP"
    };
    if (step === "done") {
      return order.map((id, i) => ({
        mark: String(i + 1),
        label: labels[id],
        state: "done"
      }));
    }
    const idx = order.indexOf(step);
    return order.map((id, i) => ({
      mark: String(i + 1),
      label: labels[id],
      state: i < idx ? "done" : i === idx ? "current" : "pending"
    }));
  }
  function clearOnPageUi() {
    if (activeTarget2) {
      activeTarget2.classList.remove("zapee-guide-target");
      activeTarget2 = null;
    }
    badges.forEach((b) => b.remove());
    badges.clear();
    document.getElementById("zapee-guide-note")?.remove();
  }
  function onGuideScroll2() {
    guideScrolling = true;
    clearOnPageUi();
    if (guideScrollTimer !== null) window.clearTimeout(guideScrollTimer);
    guideScrollTimer = window.setTimeout(() => {
      guideScrollTimer = null;
      guideScrolling = false;
      tick2();
    }, SCROLL_SETTLE_MS2);
  }
  function tick2() {
    if (!enabled2 || !phone) return;
    if (guideScrolling) {
      clearOnPageUi();
      return;
    }
    if (!isLoginContext()) {
      clearOnPageUi();
      return;
    }
    ensureStyles2();
    const fields = findFields();
    syncPhoneReadyMarker(fields);
    if (fields.otpInputs.length === 6) {
      document.documentElement.dataset.zapeeCoopSignupOtp = "true";
      onSignupOtpVisible?.();
    } else {
      delete document.documentElement.dataset.zapeeCoopSignupOtp;
    }
    if (authMode === "register" && pageMode() === "login" && fields.registerLink && !registerClickStarted) {
      registerClickStarted = true;
      fields.registerLink.click();
      return;
    }
    if (execMode2 === "auto" && !autoPhoneFilled && fields.phone && !phoneFilled(fields.phone)) {
      const phoneTarget = targetFor("paste", fields) || fields.phone;
      renderTargetOutline(phoneTarget);
      renderBadges("paste", fields);
      renderTargetNote("paste", phoneTarget);
      if (!autoPhoneHighlightSince) {
        autoPhoneHighlightSince = Date.now();
        lastBubbleKey = "";
      }
      const held = Date.now() - autoPhoneHighlightSince;
      if (held < AUTO_HIGHLIGHT_HOLD_MS) {
        showGuidance({
          checkpointId: "coop-login",
          title: checklistTitle(),
          message: speechFor("paste"),
          steps: buildChecklist("paste")
        });
        return;
      }
      setNativeValue2(fields.phone, phone);
      fields.phone.focus({ preventScroll: true });
      autoPhoneFilled = true;
      syncPhoneReadyMarker(fields);
      lastBubbleKey = "";
    }
    const step = resolveStep(fields);
    if (step === "done") {
      clearOnPageUi();
      return;
    }
    const target = targetFor(step, fields);
    renderTargetOutline(target);
    renderBadges(step, fields);
    renderTargetNote(step, target);
    const key = [
      step,
      execMode2,
      autoPhoneFilled ? 1 : 0,
      manualPasteDone ? 1 : 0,
      fields.phone?.value?.length || 0,
      fields.password?.value ? 1 : 0,
      fields.consent?.checked ? 1 : 0,
      Boolean(target)
    ].join(":");
    if (key === lastBubbleKey) return;
    lastBubbleKey = key;
    showGuidance({
      checkpointId: "coop-login",
      title: checklistTitle(),
      message: speechFor(step),
      steps: buildChecklist(step)
    });
  }
  function startCoopLoginGuide(opts) {
    if (!/(^|\.)cooponline\.vn$/i.test(location.hostname) && !/oauth-saigoncoop/i.test(location.hostname)) {
      return;
    }
    const next = String(opts.phone || "").trim();
    if (next) phone = next;
    if (!phone) return;
    if (opts.execMode === "auto" || opts.execMode === "manual") {
      execMode2 = opts.execMode;
    }
    authMode = opts.accountMode === "register" ? "register" : "login";
    onSignupOtpVisible = opts.onSignupOtpVisible;
    onAccountModeChange = opts.onAccountModeChange;
    enabled2 = true;
    lastBubbleKey = "";
    autoPhoneFilled = false;
    autoPhoneHighlightSince = 0;
    manualPasteDone = false;
    registerClickStarted = false;
    ensureStyles2();
    if (execMode2 === "manual") {
      const input = findPhoneInput();
      if (input) {
        const current = (input.value || "").replace(/\D/g, "");
        const want = phone.replace(/\D/g, "");
        if (!current || want && current === want || current.length >= 8) {
          setNativeValue2(input, "");
        }
      }
    }
    tick2();
    if (!recoveryClicksAttached) {
      recoveryClicksAttached = true;
      document.addEventListener("click", onAuthRecoveryClick, true);
    }
    if (timer2 === null) {
      timer2 = window.setInterval(tick2, POLL_MS);
      window.addEventListener("scroll", onGuideScroll2, true);
      window.addEventListener("resize", tick2);
    }
  }
  function stopCoopLoginGuide() {
    enabled2 = false;
    lastBubbleKey = "";
    autoPhoneFilled = false;
    autoPhoneHighlightSince = 0;
    manualPasteDone = false;
    registerClickStarted = false;
    onSignupOtpVisible = void 0;
    onAccountModeChange = void 0;
    if (recoveryClicksAttached) {
      recoveryClicksAttached = false;
      document.removeEventListener("click", onAuthRecoveryClick, true);
    }
    if (timer2 !== null) {
      window.clearInterval(timer2);
      timer2 = null;
    }
    window.removeEventListener("scroll", onGuideScroll2, true);
    window.removeEventListener("resize", tick2);
    if (guideScrollTimer !== null) {
      window.clearTimeout(guideScrollTimer);
      guideScrollTimer = null;
    }
    guideScrolling = false;
    clearOnPageUi();
    delete document.documentElement.dataset[PHONE_READY_DATASET_KEY];
    delete document.documentElement.dataset.zapeeCoopSignupOtp;
    document.getElementById(STYLE_ID)?.remove();
  }

  // src/content/coop-signup-onboarding.ts
  var POLICY_SEEN_KEY = "zapee_coop_signup_policy_seen_session";
  var ONBOARDING_DONE_KEY = "zapee_coop_signup_onboarding_done_session";
  var defaultAddressObserver = null;
  var defaultAddressRefreshQueued = false;
  var observedOnboardingPending = false;
  var observedOnboardingSessionId = "";
  function visible2(element) {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }
  function normalizedText(element) {
    return String(element.textContent || "").replace(/\s+/g, " ").trim();
  }
  function findPolicyDialog() {
    return Array.from(document.querySelectorAll(
      ".teko-modal.teko-modal-show,[role='dialog'],.teko-modal"
    )).find((element) => {
      if (!visible2(element)) return false;
      const text = normalizedText(element);
      return /Thông báo/i.test(text) && /Chính sách bảo mật|xử lý dữ liệu cá nhân/i.test(text) && /Xác nhận/i.test(text);
    }) || null;
  }
  function findDefaultAddressCard() {
    const title = Array.from(document.querySelectorAll("div,span,h1,h2,h3,h4")).find((element) => visible2(element) && /^Địa chỉ mặc định$/i.test(normalizedText(element)));
    if (!title) return null;
    return title.closest(".teko-card") || title.parentElement?.parentElement;
  }
  function findDefaultAddressFormSurface() {
    const save = Array.from(document.querySelectorAll("button,[role='button'],input[type='submit']")).find((element) => visible2(element) && /^Lưu địa chỉ$/i.test(normalizedText(element)));
    if (!save) return null;
    return save.closest(".teko-modal.teko-modal-show,[role='dialog'],form");
  }
  function fieldFrame(control) {
    if (control.id === "provinceCode" || control.id === "wardCode") return control;
    return control.parentElement?.closest(
      ".teko-input,.teko-select,[class*='input-wrapper'],[class*='InputWrapper'],[class*='select-wrapper'],[class*='SelectWrapper']"
    ) || control.parentElement || control;
  }
  function markDropdown(wrapper, controlKey, prefix) {
    const input = wrapper?.querySelector("input") || null;
    if (!wrapper || !input) return;
    wrapper.dataset[`zapeeCoop${prefix}${controlKey}Frame`] = "true";
    input.dataset[`zapeeCoop${prefix}${controlKey}`] = "true";
    if (input.value.trim() && !dropdownOpen(wrapper, input)) {
      input.dataset[`zapeeCoop${prefix}${controlKey}Selected`] = "true";
    } else {
      delete input.dataset[`zapeeCoop${prefix}${controlKey}Selected`];
    }
  }
  function markDefaultAddressFormControls() {
    const surface = findDefaultAddressFormSurface();
    if (!surface) return;
    const name = surface.querySelector("#name");
    const address = surface.querySelector("#address");
    const provinceWrapper = surface.querySelector("#provinceCode");
    const wardWrapper = surface.querySelector("#wardCode");
    if (name) {
      name.dataset.zapeeCoopDefaultAddressName = "true";
      fieldFrame(name).dataset.zapeeCoopDefaultAddressNameFrame = "true";
    }
    if (address) {
      address.dataset.zapeeCoopDefaultAddressStreet = "true";
      fieldFrame(address).dataset.zapeeCoopDefaultAddressStreetFrame = "true";
    }
    markDropdown(provinceWrapper, "Province", "DefaultAddress");
    markDropdown(wardWrapper, "Ward", "DefaultAddress");
    surface.querySelector("button[data-zapee-coop-default-address-save='true']")?.removeAttribute("data-zapee-coop-default-address-save");
    const save = Array.from(surface.querySelectorAll("button,[role='button'],input[type='submit']")).find((element) => visible2(element) && /^Lưu địa chỉ$/i.test(normalizedText(element)));
    if (save instanceof HTMLElement) save.dataset.zapeeCoopDefaultAddressSave = "true";
  }
  function markDefaultAddressState() {
    delete document.documentElement.dataset.zapeeCoopDefaultAddress;
    markDefaultAddressFormControls();
    const card = findDefaultAddressCard();
    if (!card || !visible2(card)) return "unknown";
    const text = normalizedText(card);
    const addAddress = Array.from(card.querySelectorAll("a,button,[role='button']")).find((element) => visible2(element) && /^Thêm địa chỉ nhận hàng$/i.test(normalizedText(element)));
    if (/chưa có địa chỉ nhận hàng mặc định/i.test(text) && addAddress instanceof HTMLElement) {
      addAddress.dataset.zapeeCoopAddDefaultAddress = "true";
      document.documentElement.dataset.zapeeCoopDefaultAddress = "missing";
      return "missing";
    }
    const values = Array.from(card.querySelectorAll("input[readonly]")).map((input) => String(input.value || "").trim()).filter(Boolean);
    if (values.length >= 2) {
      document.documentElement.dataset.zapeeCoopDefaultAddress = "present";
      return "present";
    }
    return "unknown";
  }
  function ensureDefaultAddressObserver() {
    if (defaultAddressObserver || !document.documentElement) return;
    const observedWindow = window;
    defaultAddressObserver = new MutationObserver(() => {
      if (defaultAddressRefreshQueued) return;
      defaultAddressRefreshQueued = true;
      observedWindow.requestAnimationFrame(() => {
        defaultAddressRefreshQueued = false;
        if (observedOnboardingPending && observedOnboardingSessionId) {
          refreshCoopSignupOnboarding(true, observedOnboardingSessionId);
        } else {
          markDefaultAddressState();
        }
      });
    });
    defaultAddressObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  function markPolicyControls(dialog) {
    const checkbox = Array.from(dialog.querySelectorAll("input[type='checkbox']")).find((element) => visible2(element));
    if (checkbox instanceof HTMLInputElement) {
      checkbox.dataset.zapeeCoopSignupPolicyCheckbox = "true";
    }
    const confirm = Array.from(dialog.querySelectorAll("button,[role='button'],input[type='submit']")).find((element) => visible2(element) && /^Xác nhận$/i.test(normalizedText(element)));
    if (confirm instanceof HTMLElement) {
      confirm.dataset.zapeeCoopSignupPolicyConfirm = "true";
    }
  }
  function dropdownOpen(wrapper, input) {
    if (!wrapper || !input) return false;
    return Array.from(wrapper.querySelectorAll("div")).some((element) => !element.contains(input) && visible2(element) && normalizedText(element).length > 0);
  }
  function readSession(key) {
    try {
      return String(sessionStorage.getItem(key) || "");
    } catch {
      return "";
    }
  }
  function writeSession(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
    }
  }
  function clearDomState() {
    delete document.documentElement.dataset.zapeeCoopSignupOnboardingPending;
    delete document.documentElement.dataset.zapeeCoopSignupPolicyVisible;
    delete document.documentElement.dataset.zapeeCoopSignupOnboardingDone;
    delete document.documentElement.dataset.zapeeCoopDefaultAddress;
  }
  function resetCoopSignupOnboarding() {
    defaultAddressObserver?.disconnect();
    defaultAddressObserver = null;
    defaultAddressRefreshQueued = false;
    observedOnboardingPending = false;
    observedOnboardingSessionId = "";
    try {
      sessionStorage.removeItem(POLICY_SEEN_KEY);
      sessionStorage.removeItem(ONBOARDING_DONE_KEY);
    } catch {
    }
    clearDomState();
  }
  function refreshCoopSignupOnboarding(pending, sessionId) {
    ensureDefaultAddressObserver();
    observedOnboardingPending = pending;
    observedOnboardingSessionId = pending ? sessionId : "";
    if (!pending || !sessionId) {
      clearDomState();
      markDefaultAddressState();
      return { complete: true, policyVisible: false };
    }
    document.documentElement.dataset.zapeeCoopSignupOnboardingPending = "true";
    const policyDialog = findPolicyDialog();
    const policyVisible = Boolean(policyDialog);
    const defaultAddressState = markDefaultAddressState();
    if (policyDialog) markPolicyControls(policyDialog);
    if (policyVisible) {
      writeSession(POLICY_SEEN_KEY, sessionId);
      document.documentElement.dataset.zapeeCoopSignupPolicyVisible = "true";
    } else {
      delete document.documentElement.dataset.zapeeCoopSignupPolicyVisible;
    }
    let complete = readSession(ONBOARDING_DONE_KEY) === sessionId;
    const policySeen = readSession(POLICY_SEEN_KEY) === sessionId;
    if (!complete && policySeen && !policyVisible) {
      writeSession(ONBOARDING_DONE_KEY, sessionId);
      complete = true;
    }
    if (!complete && !policyVisible && defaultAddressState !== "unknown") {
      writeSession(ONBOARDING_DONE_KEY, sessionId);
      complete = true;
    }
    if (complete) {
      document.documentElement.dataset.zapeeCoopSignupOnboardingDone = "true";
    } else {
      delete document.documentElement.dataset.zapeeCoopSignupOnboardingDone;
    }
    return { complete, policyVisible };
  }

  // src/content/coop-product-qty.ts
  function visible3(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left);
    const right = Math.min(window.innerWidth, r.right);
    const top = Math.max(0, r.top);
    const bottom = Math.min(window.innerHeight, r.bottom);
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return hit === el || hit !== null && el.contains(hit);
  }
  function findQtyInput() {
    const sels = [
      "input[type='number']",
      ".rc-input-number-input",
      "input[class*='quantity' i]",
      "main input[type='number']"
    ];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (el instanceof HTMLInputElement && visible3(el)) return el;
      }
    }
    return null;
  }
  function findPlus() {
    const sels = [
      ".rc-input-number-handler-up",
      "button[aria-label*='T\u0103ng' i]",
      "button.plus-btn",
      "button[class*='plus']"
    ];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (visible3(el)) return el;
      }
    }
    return null;
  }
  function findMinus() {
    const sels = [
      ".rc-input-number-handler-down",
      "button[aria-label*='Gi\u1EA3m' i]",
      "button.minus-btn",
      "button[class*='minus']"
    ];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (visible3(el)) return el;
      }
    }
    return null;
  }
  function setNativeValue3(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function readQty(input) {
    if (!input) return 1;
    const n = Number(String(input.value || "1").replace(/[^\d]/g, ""));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }
  async function setCoopProductQty(targetQty) {
    const target = Math.max(1, Math.min(20, Math.trunc(Number(targetQty) || 1)));
    const input = findQtyInput();
    if (!input) return false;
    try {
      input.scrollIntoView?.({ block: "center", behavior: "smooth" });
    } catch {
    }
    showGuidance({
      checkpointId: "coop-pdp-qty",
      message: `Zapee \u0111ang t\xF4 s\xE1ng s\u1ED1 l\u01B0\u1EE3ng (\u2192 ${target}) \u2014 \u0111\u1EE3i m\u1ED9t ch\xFAt r\u1ED3i ch\u1EC9nh\u2026`,
      highlightLocator: { strategy: "css", value: "input.rc-input-number-input, input[type='number']" }
    });
    await new Promise((r) => setTimeout(r, 2200));
    if (!visible3(input)) return false;
    input.focus();
    setNativeValue3(input, String(target));
    await new Promise((r) => setTimeout(r, 200));
    if (readQty(input) === target) return true;
    let current = readQty(findQtyInput());
    let guard = 0;
    while (current < target && guard < 25) {
      const plus = findPlus();
      if (!plus) break;
      plus.click();
      await new Promise((r) => setTimeout(r, 280));
      current = readQty(findQtyInput());
      guard += 1;
    }
    while (current > target && guard < 50) {
      const minus = findMinus();
      if (!minus) break;
      minus.click();
      await new Promise((r) => setTimeout(r, 280));
      current = readQty(findQtyInput());
      guard += 1;
    }
    const updatedInput = findQtyInput();
    return updatedInput !== null && readQty(updatedInput) === target;
  }
  function productSkuFromUrl(url) {
    try {
      const path = new URL(url, location.origin).pathname;
      return path.match(/--s(\d+)/i)?.[1] || "";
    } catch {
      return "";
    }
  }
  function pageMatchesProductUrl(productUrl) {
    if (!productUrl) return false;
    try {
      const want = new URL(productUrl, location.origin);
      const cur = new URL(location.href);
      if (want.pathname.replace(/\/+$/, "") === cur.pathname.replace(/\/+$/, "")) return true;
      const a = productSkuFromUrl(want.href);
      const b = productSkuFromUrl(cur.href);
      return Boolean(a && b && a === b);
    } catch {
      return false;
    }
  }

  // src/content/coop-slot-match.ts
  function foldSlotText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function timeRangeMinutes(value) {
    const match = String(value || "").match(/(\d{1,2})\s*[:h]\s*(\d{2})\s*[-–]\s*(\d{1,2})\s*[:h]\s*(\d{2})/i);
    if (!match) return null;
    return {
      start: Number(match[1]) * 60 + Number(match[2]),
      end: Number(match[3]) * 60 + Number(match[4])
    };
  }
  function parseZapeeCoopSlot(raw) {
    const slot = String(raw ?? "").trim();
    if (!slot) {
      return { dayOffset: 0, window: null, startMinutes: null, endMinutes: null };
    }
    const [head = "", ...rest] = slot.split(" \xB7 ");
    const encodedWindow = rest.join(" \xB7 ").trim();
    const folded = foldSlotText(slot);
    const headFolded = foldSlotText(head);
    const mentionsTomorrow = /ngay mai|\bmai\b/.test(encodedWindow ? headFolded : folded);
    const range = timeRangeMinutes(encodedWindow || slot);
    let window2 = encodedWindow || null;
    if (!window2 && range) {
      const pad = (n) => String(n).padStart(2, "0");
      window2 = `${pad(Math.floor(range.start / 60))}:${pad(range.start % 60)} - ${pad(Math.floor(range.end / 60))}:${pad(range.end % 60)}`;
    }
    if (!window2) {
      if (folded.includes("toi")) window2 = "17:00 - 20:00";
      else if (folded.includes("sang")) window2 = "08:00 - 11:00";
      else if (folded.includes("chieu")) window2 = "14:00 - 17:00";
    }
    const parsedRange = window2 ? timeRangeMinutes(window2) : range;
    return {
      dayOffset: mentionsTomorrow ? 1 : 0,
      window: window2,
      startMinutes: parsedRange?.start ?? null,
      endMinutes: parsedRange?.end ?? null
    };
  }
  function matchCoopTimeSlot(slots, wanted) {
    if (!slots.length) return null;
    const wantedRange = wanted.startMinutes != null && wanted.endMinutes != null ? { start: wanted.startMinutes, end: wanted.endMinutes } : timeRangeMinutes(wanted.window || "");
    if (!wantedRange) return null;
    return slots.find((slot) => {
      const range = timeRangeMinutes(slot.text);
      return Boolean(range && range.start === wantedRange.start && range.end === wantedRange.end);
    }) || slots.find((slot) => slot.start === wantedRange.start) || slots.find((slot) => slot.start >= wantedRange.start && slot.start < wantedRange.end) || null;
  }

  // src/content/coop-checkout-fill.ts
  var running = false;
  var completed = false;
  var autoStepsDone = false;
  var lastStatusKey = "";
  var attemptCount = 0;
  var checkoutLandedAt = 0;
  var recipientOk = false;
  var dateFilledOk = false;
  var slotSelectedOk = false;
  var paymentSelectedOk = false;
  var MAX_FILL_ATTEMPTS = 6;
  var CHECKOUT_SETTLE_MS = 2800;
  var STEP_HIGHLIGHT_HOLD_MS = 3200;
  var BETWEEN_STEPS_MS = 1200;
  var SCROLL_SETTLE_MS3 = 160;
  var STYLE_ID2 = "zapee-coop-checkout-fill-style";
  var RING_ID2 = "zapee-checkout-guide-ring";
  var NOTE_ID2 = "zapee-checkout-guide-note";
  var TARGET_CLASS2 = "zapee-guide-target-checkout";
  var STYLE = `
${guideHighlightCss({
    target: `.${TARGET_CLASS2}`,
    ring: `#${RING_ID2}`,
    note: `#${NOTE_ID2}`
  })}
.${TARGET_CLASS2} {
  position: relative;
  z-index: 5;
}
#${RING_ID2} { display: none; }
#${NOTE_ID2} { display: none; }
`;
  var guideScrolling2 = false;
  var guideScrollTimer2 = null;
  var scrollGuardInstalled = false;
  var lastPaintTarget = null;
  var lastPaintNote = "";
  var autoScrolledSteps = /* @__PURE__ */ new Set();
  function sleep2(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function ensureStyles3() {
    if (document.getElementById(STYLE_ID2)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID2;
    style.textContent = STYLE;
    (document.head || document.documentElement).appendChild(style);
  }
  function clearCheckoutDecorations() {
    for (const el of document.querySelectorAll(`.${TARGET_CLASS2}`)) {
      el.classList.remove(TARGET_CLASS2);
    }
    const ring = document.getElementById(RING_ID2);
    if (ring) ring.style.display = "none";
    const note = document.getElementById(NOTE_ID2);
    if (note) note.style.display = "none";
  }
  function onGuideScroll3() {
    guideScrolling2 = true;
    clearCheckoutDecorations();
    if (guideScrollTimer2 !== null) window.clearTimeout(guideScrollTimer2);
    guideScrollTimer2 = window.setTimeout(() => {
      guideScrollTimer2 = null;
      guideScrolling2 = false;
      if (lastPaintTarget?.isConnected && lastPaintNote) {
        paintCheckoutTarget(lastPaintTarget, lastPaintNote, { scroll: false });
      }
    }, SCROLL_SETTLE_MS3);
  }
  function installScrollGuard() {
    if (scrollGuardInstalled) return;
    scrollGuardInstalled = true;
    window.addEventListener("scroll", onGuideScroll3, true);
  }
  function removeScrollGuard() {
    if (scrollGuardInstalled) window.removeEventListener("scroll", onGuideScroll3, true);
    scrollGuardInstalled = false;
    if (guideScrollTimer2 !== null) {
      window.clearTimeout(guideScrollTimer2);
      guideScrollTimer2 = null;
    }
    guideScrolling2 = false;
    lastPaintTarget = null;
    lastPaintNote = "";
  }
  function pickHighlightBox(target) {
    const shipping = target.closest(
      "[data-content-region-name='shippingAddress'][data-content-name='homeDelivery'],[data-content-name='homeDelivery'][data-content-region-name='shippingAddress'],[data-content-name='homeDelivery']"
    );
    if (shipping) {
      const r = shipping.getBoundingClientRect();
      if (r.width >= 40 && r.height >= 20) return shipping;
    }
    const candidates = [
      target.closest("#selected-date-picker"),
      target.closest("#selected-time-picker"),
      target.closest("[data-content-region-name='paymentMethod']"),
      target.closest(".rc-picker"),
      target.closest("label"),
      target
    ];
    for (const el of candidates) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 40 && r.height >= 20 && r.width < window.innerWidth * 0.95 && r.height < 400) {
        return el;
      }
    }
    return target;
  }
  function scrollIntoViewIfNeeded(el) {
    try {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      const fullyVisible = r.top >= 8 && r.bottom <= vh - 8 && r.height > 0;
      if (fullyVisible) return;
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    } catch {
    }
  }
  function consumeFirstStepScroll(step) {
    if (autoScrolledSteps.has(step)) return false;
    autoScrolledSteps.add(step);
    return true;
  }
  function paintCheckoutTarget(target, noteText, opts = {}) {
    lastPaintTarget = target;
    lastPaintNote = noteText;
    if (guideScrolling2) {
      clearCheckoutDecorations();
      return;
    }
    ensureStyles3();
    const box = pickHighlightBox(target);
    for (const el of document.querySelectorAll(`.${TARGET_CLASS2}`)) {
      el.classList.remove(TARGET_CLASS2);
    }
    box.classList.add(TARGET_CLASS2);
    if (opts.scroll !== false) {
      scrollIntoViewIfNeeded(box);
    }
    if (!elementIntersectsViewport(box)) {
      clearCheckoutDecorations();
      return;
    }
    const rect = box.getBoundingClientRect();
    const pad = 6;
    const w = Math.max(120, rect.width + pad * 2);
    const h = Math.max(36, rect.height + pad * 2);
    const left = Math.max(4, rect.width < 8 ? rect.left - 40 : rect.left - pad);
    const top = Math.max(4, rect.height < 8 ? rect.top - 8 : rect.top - pad);
    let ring = document.getElementById(RING_ID2);
    if (!ring) {
      ring = document.createElement("div");
      ring.id = RING_ID2;
      document.documentElement.appendChild(ring);
    }
    ring.style.display = "block";
    ring.style.left = `${left}px`;
    ring.style.top = `${top}px`;
    ring.style.width = `${w}px`;
    ring.style.height = `${h}px`;
    let note = document.getElementById(NOTE_ID2);
    if (!note) {
      note = document.createElement("span");
      note.id = NOTE_ID2;
      document.documentElement.appendChild(note);
    }
    const fallbackNoteWidth = 240;
    note.textContent = pointAtTarget(noteText, "right");
    note.style.display = "block";
    note.style.left = "0px";
    const noteWidth = Math.ceil(note.getBoundingClientRect().width) || fallbackNoteWidth;
    const gap = 6;
    const placement = pickNotePlacement({ left, right: left + w }, noteWidth, gap);
    note.dataset.placement = placement;
    note.textContent = pointAtTarget(noteText, placement);
    note.style.left = `${placement === "right" ? left + w + gap : placement === "left" ? left - noteWidth - gap : Math.max(8, Math.min(window.innerWidth - noteWidth - 8, left))}px`;
    note.style.top = `${placement !== "bottom" ? Math.max(8, top + Math.max(0, (h - 40) / 2)) : Math.min(window.innerHeight - 56, top + h + 10)}px`;
  }
  var CHECKOUT_TITLE = "Thanh to\xE1n \u0111\u01A1n Co.opmart";
  var STEP_ORDER = ["recipient", "date", "slot", "pay", "place"];
  function checkoutSteps(current) {
    const labels = {
      recipient: "Zapee \u0111ang nh\u1EADp \u0111\u1ECBa ch\u1EC9 nh\u1EADn h\xE0ng",
      date: "Zapee \u0111ang nh\u1EADp ng\xE0y nh\u1EADn",
      slot: "Zapee \u0111ang nh\u1EADp khung gi\u1EDD",
      pay: "Zapee \u0111ang ch\u1ECDn Ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n",
      place: "B\u1EA1n b\u1EA5m THANH TO\xC1N"
    };
    const curIdx = current === "done" ? STEP_ORDER.length : STEP_ORDER.indexOf(current);
    return STEP_ORDER.map((id, i) => ({
      mark: String(i + 1),
      label: labels[id],
      state: current === "done" || i < curIdx ? "done" : i === curIdx ? "current" : "pending"
    }));
  }
  async function highlightAndHold(target, opts) {
    paintCheckoutTarget(target, opts.note, { scroll: consumeFirstStepScroll(opts.step) });
    showGuidance({
      checkpointId: "coop-checkout",
      message: opts.message,
      highlightLocator: void 0,
      title: CHECKOUT_TITLE,
      steps: checkoutSteps(opts.step)
    });
    lastStatusKey = opts.message;
    if (opts.hold === false) return;
    const started = Date.now();
    while (Date.now() - started < STEP_HIGHLIGHT_HOLD_MS) {
      paintCheckoutTarget(target, opts.note, { scroll: false });
      await sleep2(400);
    }
  }
  function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
  }
  function findRecipientCards() {
    const primary = [
      ...document.querySelectorAll(
        "[data-content-region-name='shippingAddress'][data-content-name='homeDelivery'],[data-content-name='homeDelivery'][data-content-region-name='shippingAddress']"
      )
    ].filter((el) => el instanceof HTMLElement && visible4(el));
    if (primary.length) return primary;
    const region = [
      ...document.querySelectorAll("[data-content-region-name='shippingAddress']")
    ].filter((el) => {
      if (!(el instanceof HTMLElement) || !visible4(el)) return false;
      const name = el.getAttribute("data-content-name") || "";
      if (/editAddress|addNewAddress/i.test(name)) return false;
      const t = elementText2(el);
      if (/them dia chi/.test(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 120 && r.height >= 48 && r.height < 280;
    });
    return region.filter((c) => !region.some((o) => o !== c && c.contains(o)));
  }
  function pickRecipientCard(payload) {
    const cards = findRecipientCards();
    if (!cards.length) return null;
    const phone2 = digitsOnly(String(payload.shippingAddress?.phone || payload.buyerPhone || ""));
    const name = String(payload.shippingAddress?.name || payload.buyerName || "").trim().toLowerCase();
    if (phone2) {
      const match = cards.find((c) => digitsOnly(c.textContent || "").includes(phone2.slice(-9)));
      if (match) return match;
    }
    if (name) {
      const match = cards.find((c) => elementText2(c).includes(name.toLowerCase()));
      if (match) return match;
    }
    return cards[0] || null;
  }
  function recipientLooksSelected(card) {
    if (card.getAttribute("aria-selected") === "true" || card.getAttribute("aria-checked") === "true") {
      return true;
    }
    if (card.matches("[data-selected='true'],[data-active='true'],[data-checked='true']")) return true;
    if (card.querySelector("input[type='radio']:checked,input[type='checkbox']:checked")) return true;
    const cls = String(card.className || "");
    return /(?:^|\s)(?:selected|active|checked|current)(?:\s|$)/i.test(cls);
  }
  async function selectRecipient(payload) {
    const card = pickRecipientCard(payload);
    if (!card) {
      const heading = document.getElementById("delivery-info-section") || [...document.querySelectorAll("[id='delivery-info-section'],div,span")].find((n) => n instanceof HTMLElement && /^thong tin nhan hang$/.test(elementText2(n)));
      if (heading instanceof HTMLElement) {
        await highlightAndHold(heading, {
          step: "recipient",
          message: "B\u01B0\u1EDBc 1/5: \u0110ang t\xECm th\u1EBB \u0111\u1ECBa ch\u1EC9 nh\u1EADn h\xE0ng\u2026 (t\xF4 m\u1EE5c Th\xF4ng tin nh\u1EADn h\xE0ng).",
          note: "Zapee \u0111ang nh\u1EADp \u0111\u1ECBa ch\u1EC9 nh\u1EADn h\xE0ng"
        });
      }
      return false;
    }
    const already = recipientLooksSelected(card);
    await highlightAndHold(card, {
      step: "recipient",
      message: "Zapee \u0111ang nh\u1EADp \u0111\u1ECBa ch\u1EC9 nh\u1EADn h\xE0ng (\u0111ang t\xF4 s\xE1ng).",
      note: "Zapee \u0111ang nh\u1EADp \u0111\u1ECBa ch\u1EC9 nh\u1EADn h\xE0ng"
    });
    if (!already) {
      paintCheckoutTarget(card, "Zapee \u0111ang nh\u1EADp \u0111\u1ECBa ch\u1EC9 nh\u1EADn h\xE0ng", { scroll: false });
      const clicked = safeClick2(card);
      await sleep2(500);
      if (!clicked) return false;
    }
    return true;
  }
  function findPlaceOrderButton() {
    const nodes = [...document.querySelectorAll("button,a,[role='button'],input[type='submit']")];
    const scored = [];
    for (const n of nodes) {
      if (!(n instanceof HTMLElement) || !visible4(n)) continue;
      const t = String(n.textContent || n.getAttribute("value") || "").replace(/\s+/g, " ").trim();
      const norm = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (!t) continue;
      if (/vnpay|qr|cod|khi nhan hang|internet banking/.test(norm) && !/^thanh toan$/.test(norm)) continue;
      let score = 0;
      if (/^thanh toan$/i.test(t) || /^thanh toán$/i.test(t)) score = 10;
      else if (/^dat hang$/i.test(norm) || /^đặt hàng$/i.test(t)) score = 9;
      else if (/thanh toan|dat hang/.test(norm) && t.length < 24) score = 6;
      if (score) scored.push({ el: n, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.el || null;
  }
  function guidePlaceOrderUserOnly() {
    const btn = findPlaceOrderButton();
    if (!btn) {
      showGuidance({
        checkpointId: "coop-checkout",
        message: "B\u01B0\u1EDBc 5/5: B\u1EA1n t\u1EF1 b\u1EA5m n\xFAt THANH TO\xC1N / \u0110\u1EB7t h\xE0ng tr\xEAn Co.op. Zapee kh\xF4ng b\u1EA5m h\u1ED9.",
        title: CHECKOUT_TITLE,
        steps: checkoutSteps("place")
      });
      return;
    }
    paintCheckoutTarget(btn, "\u{1F449} 5. B\u1EA1n b\u1EA5m THANH TO\xC1N", { scroll: consumeFirstStepScroll("place") });
    showGuidance({
      checkpointId: "coop-checkout",
      message: "Ki\u1EC3m tra \u0111\u01A1n r\u1ED3i b\u1EA1n t\u1EF1 b\u1EA5m THANH TO\xC1N (\u0111ang t\xF4 s\xE1ng). Zapee kh\xF4ng b\u1EA5m h\u1ED9, kh\xF4ng thanh to\xE1n thay b\u1EA1n.",
      title: CHECKOUT_TITLE,
      steps: checkoutSteps("place")
    });
    lastStatusKey = "place-order-user";
  }
  function visible4(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }
  function elementText2(el) {
    return String(el.textContent || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function safeClick2(el) {
    try {
      el.focus?.({ preventScroll: true });
      if (typeof PointerEvent === "function") {
        el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
        el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
      }
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      el.click();
      return true;
    } catch {
      return false;
    }
  }
  function vnDate(offsetDays) {
    const date = new Date(Date.now() + offsetDays * 864e5);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).formatToParts(date);
    const value = (type) => parts.find((p) => p.type === type)?.value || "";
    const day = value("day");
    const month = value("month");
    const year = value("year");
    return {
      display: `${day}/${month}/${year}`,
      displayLoose: `${Number(day)}/${Number(month)}/${year}`,
      iso: `${year}-${month}-${day}`,
      day: String(Number(day)),
      month: String(Number(month)),
      year
    };
  }
  function normalizeDateText(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/(\d{1,2})\D+(\d{1,2})\D+(\d{4})/);
    if (!match) return raw.replace(/\s+/g, "");
    return `${String(Number(match[1])).padStart(2, "0")}/${String(Number(match[2])).padStart(2, "0")}/${match[3]}`;
  }
  function dateLooksFilled(input) {
    return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalizeDateText(input.value));
  }
  function dateTargetLooksSelected(input, target) {
    if (input && normalizeDateText(input.value) === normalizeDateText(target.display)) return true;
    const selected = document.querySelector(
      `.rc-picker-cell-selected[title="${target.iso}"],.rc-picker-cell[aria-selected='true'][title="${target.iso}"],td[aria-selected='true'][title="${target.iso}"]`
    );
    return Boolean(selected);
  }
  function findDateInput() {
    const selectors = [
      "#selected-date-picker input",
      "#selected-date-picker .rc-picker-input input",
      ".rc-picker-input input",
      "input[placeholder*='dd/mm' i]",
      "input[placeholder*='DD/MM']",
      "input[placeholder*='ng\xE0y' i]",
      "input[placeholder*='ngay' i]"
    ];
    for (const s of selectors) {
      const nodes = [...document.querySelectorAll(s)].filter((n) => n instanceof HTMLInputElement);
      const vis = nodes.find(visible4);
      if (vis) return vis;
      if (nodes[0]?.isConnected) return nodes[0];
    }
    const labels = [...document.querySelectorAll("label,span,div,p,h1,h2,h3,h4")].filter((node) => /chon ngay nhan hang|ngay nhan hang|ngay giao|ngay nhan/i.test(elementText2(node)));
    for (const label of labels) {
      const scope = label.closest("section,form,div") || label.parentElement;
      const input = scope && [...scope.querySelectorAll("input")].find((n) => n instanceof HTMLInputElement);
      if (input instanceof HTMLInputElement) return input;
    }
    return null;
  }
  function setReactInputValue(input, value) {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "insertText",
      data: value
    }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function fireKey(target, key, code = key, keyCode = key === "Enter" ? 13 : key.charCodeAt(0)) {
    const init = {
      key,
      code,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    };
    const ev = (type) => {
      const e = new KeyboardEvent(type, init);
      Object.defineProperty(e, "keyCode", { get: () => keyCode });
      Object.defineProperty(e, "which", { get: () => keyCode });
      target.dispatchEvent(e);
    };
    ev("keydown");
    ev("keypress");
    ev("keyup");
  }
  async function typeAndCommitDate(input, value) {
    const picker = input.closest("#selected-date-picker,.rc-picker,.rc-picker-input") || input;
    safeClick2(picker);
    await new Promise((r) => setTimeout(r, 150));
    input.focus({ preventScroll: true });
    const wasReadOnly = input.readOnly;
    const wasDisabled = input.disabled;
    if (wasReadOnly) input.readOnly = false;
    if (wasDisabled) input.disabled = false;
    try {
      input.select?.();
      try {
        input.setSelectionRange(0, String(input.value || "").length);
      } catch {
      }
      for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "a",
          code: "KeyA",
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          ...mod
        }));
      }
      fireKey(input, "Backspace", "Backspace", 8);
      fireKey(input, "Delete", "Delete", 46);
      setReactInputValue(input, "");
      let ok = false;
      try {
        ok = document.execCommand("insertText", false, value);
      } catch {
        ok = false;
      }
      if (!ok || normalizeDateText(input.value) !== normalizeDateText(value)) {
        setReactInputValue(input, value);
      }
      if (!String(input.value || "").trim()) {
        setReactInputValue(input, "");
        for (const ch of value) {
          fireKey(input, ch, ch === "/" ? "Slash" : `Digit${ch}`, ch === "/" ? 191 : ch.charCodeAt(0));
          setReactInputValue(input, `${input.value || ""}${ch}`);
          await new Promise((r) => setTimeout(r, 12));
        }
      }
      input.focus({ preventScroll: true });
      fireKey(input, "Enter", "Enter", 13);
      if (picker !== input) fireKey(picker, "Enter", "Enter", 13);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      input.blur();
    } finally {
      if (wasReadOnly) input.readOnly = true;
      if (wasDisabled) input.disabled = true;
    }
    await new Promise((r) => setTimeout(r, 600));
    return normalizeDateText(input.value) === normalizeDateText(value);
  }
  function visibleDatePickerPanel() {
    const panels = Array.from(document.querySelectorAll(
      ".rc-picker-dropdown:not(.rc-picker-dropdown-hidden),.rc-picker-panel,.rc-picker-date-panel,[class*='picker-dropdown']:not([class*='hidden'])"
    ));
    return panels.find((node) => visible4(node)) || null;
  }
  async function openDatePicker(input) {
    const candidates = [
      input,
      input.closest(".rc-picker-input"),
      input.closest(".rc-picker"),
      input.closest("#selected-date-picker")
    ].filter((node, index, all) => node instanceof HTMLElement && all.indexOf(node) === index);
    for (const candidate of candidates) {
      safeClick2(candidate);
      await sleep2(220);
      if (visibleDatePickerPanel()) return true;
    }
    return Boolean(visibleDatePickerPanel());
  }
  function dateCellIsDisabled(cell) {
    return cell.matches("[disabled],[aria-disabled='true'],.rc-picker-cell-disabled") || Boolean(cell.closest("[disabled],[aria-disabled='true'],.rc-picker-cell-disabled")) || /disabled/i.test(String(cell.className || ""));
  }
  async function clickRelativeTomorrowCell(target) {
    const panel = visibleDatePickerPanel();
    if (!panel) return false;
    const cells = Array.from(panel.querySelectorAll(
      "td.rc-picker-cell,.rc-picker-cell,[role='gridcell']"
    )).filter((node) => node instanceof HTMLElement && visible4(node) && !dateCellIsDisabled(node) && !node.parentElement?.closest("td.rc-picker-cell,.rc-picker-cell,[role='gridcell']"));
    const currentIndex = cells.findIndex((cell) => cell.matches(".rc-picker-cell-selected,.rc-picker-cell-today,[aria-selected='true']"));
    if (currentIndex < 0) return false;
    const next = cells.slice(currentIndex + 1).find((cell) => {
      const title = String(cell.getAttribute("title") || cell.getAttribute("data-date") || "");
      if (title) return title === target.iso || title.startsWith(target.iso);
      return String(cell.textContent || "").trim() === target.day;
    });
    if (!next) return false;
    safeClick2(next.querySelector(".rc-picker-cell-inner") || next);
    await sleep2(650);
    return dateTargetLooksSelected(findDateInput(), target);
  }
  async function clickTodayOrCell(target) {
    const todayBtn = Array.from(document.querySelectorAll("a,button,.rc-picker-now-btn,.rc-picker-footer a,.rc-picker-footer button")).find((n) => visible4(n) && /today|hom nay|hôm nay/i.test(n.textContent || ""));
    if (todayBtn && target.display === vnDate(0).display) {
      safeClick2(todayBtn);
      await new Promise((r) => setTimeout(r, 450));
      const input = findDateInput();
      if (dateTargetLooksSelected(input, target)) return true;
    }
    const titles = [
      target.iso,
      target.display,
      target.displayLoose,
      `${target.day}/${target.month}/${target.year}`
    ];
    for (const title of titles) {
      const cells = Array.from(document.querySelectorAll(
        `.rc-picker-cell[title="${title}"],.rc-picker-cell-in-view[title="${title}"],td[title="${title}"],[role='gridcell'][data-date="${title}"],[role='gridcell'][aria-label*="${title}"]`
      ));
      const cell = cells.find((node) => node instanceof HTMLElement && visible4(node) && !dateCellIsDisabled(node));
      if (cell) {
        const inner = cell.querySelector(".rc-picker-cell-inner") || cell;
        safeClick2(inner);
        await new Promise((r) => setTimeout(r, 350));
        const ok = Array.from(document.querySelectorAll(".rc-picker-ok button,button")).find((n) => visible4(n) && /ok|xac nhan|áp dụng|ap dung|chon/i.test(elementText2(n)));
        if (ok) safeClick2(ok);
        await new Promise((r) => setTimeout(r, 400));
        const input = findDateInput();
        if (dateTargetLooksSelected(input, target)) return true;
      }
    }
    if (target.display === vnDate(1).display && await clickRelativeTomorrowCell(target)) {
      return true;
    }
    const dayCells = Array.from(document.querySelectorAll(".rc-picker-cell-in-view:not(.rc-picker-cell-disabled)")).filter((n) => visible4(n) && String(n.textContent || "").trim() === target.day);
    for (const cell of dayCells) {
      const inner = cell.querySelector(".rc-picker-cell-inner") || cell;
      safeClick2(inner);
      await new Promise((r) => setTimeout(r, 400));
      const input = findDateInput();
      if (dateTargetLooksSelected(input, target)) return true;
    }
    return false;
  }
  function findDateSectionLabel() {
    const hit = [...document.querySelectorAll("label,h2,h3,h4,div,span,p")].find((n) => {
      if (!(n instanceof HTMLElement)) return false;
      return /chon ngay nhan hang|ngay nhan hang|ngay giao hang/.test(elementText2(n));
    });
    return hit || document.querySelector("#selected-date-picker");
  }
  async function waitForDateInput(maxMs = 1e4) {
    const started = Date.now();
    let didSectionScroll = false;
    while (Date.now() - started < maxMs) {
      const input = findDateInput();
      if (input) return input;
      if (!didSectionScroll) {
        const section = findDateSectionLabel();
        if (section && consumeFirstStepScroll("date")) {
          scrollIntoViewIfNeeded(section);
          didSectionScroll = true;
        }
      }
      await sleep2(320);
    }
    return findDateInput();
  }
  async function fillDate(dayOffset) {
    const input0 = await waitForDateInput(1e4);
    if (!input0) return false;
    const paintTarget2 = input0.closest("#selected-date-picker,.rc-picker") || input0;
    const offsets = dayOffset === 1 ? [1, 0] : [0, 1];
    const preferred = vnDate(offsets[0]);
    await highlightAndHold(paintTarget2, {
      step: "date",
      message: "Zapee \u0111ang nh\u1EADp ng\xE0y nh\u1EADn (\u0111ang t\xF4 s\xE1ng).",
      note: "Zapee \u0111ang nh\u1EADp ng\xE0y nh\u1EADn",
      locator: { strategy: "css", value: "#selected-date-picker input" }
    });
    for (const offset of offsets) {
      const target = vnDate(offset);
      const input = findDateInput();
      if (!input) return false;
      if (dateTargetLooksSelected(input, target)) {
        return true;
      }
      await openDatePicker(input);
      if (await clickTodayOrCell(target)) return true;
      for (const value of [target.display, target.displayLoose]) {
        if (await typeAndCommitDate(input, value)) return true;
      }
      await openDatePicker(input);
      if (await clickTodayOrCell(target)) return true;
    }
    const final = findDateInput();
    return Boolean(final && dateLooksFilled(final));
  }
  function currentVnMinutes() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(/* @__PURE__ */ new Date());
    const value = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
    return value("hour") * 60 + value("minute");
  }
  function slotIsDisabled(el) {
    if (el.matches("[disabled],[aria-disabled='true']")) return true;
    if (el.querySelector("[disabled],[aria-disabled='true']")) return true;
    if (/disabled/i.test(String(el.className || ""))) return true;
    const parentDisabled = el.closest("[disabled],[aria-disabled='true'],[class*='disabled' i]");
    if (parentDisabled) return true;
    try {
      const style = getComputedStyle(el);
      if (style.pointerEvents === "none" || Number(style.opacity || "1") < 0.35) return true;
    } catch {
    }
    return false;
  }
  function collectEnabledTimeSlots(root) {
    const seen = /* @__PURE__ */ new Set();
    const slots = Array.from(root.querySelectorAll("button,[role='button'],label,div,span")).map((node) => {
      const raw = String(node.textContent || "").replace(/\s+/g, " ").trim();
      const match = raw.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
      if (!match || !visible4(node)) return null;
      let child = node;
      while (child.parentElement && child.parentElement !== document.body) {
        const parentText = String(child.parentElement.textContent || "").replace(/\s+/g, " ").trim();
        if (parentText !== raw) break;
        child = child.parentElement;
      }
      if (seen.has(child) || slotIsDisabled(child)) return null;
      seen.add(child);
      return { child, start: Number(match[1]) * 60 + Number(match[2]), text: raw };
    }).filter(Boolean);
    slots.sort((a, b) => a.start - b.start);
    return slots;
  }
  function chooseTimeSlot(slots, slotIndex, tomorrowFallback, nowMinutes = currentVnMinutes(), wanted) {
    if (!slots.length) return null;
    const matched = wanted ? matchCoopTimeSlot(slots, wanted) : null;
    if (matched) return matched;
    if (tomorrowFallback) return slots[0] || null;
    let candidates = slots;
    if (slotIndex < 2) {
      candidates = slots.filter((slot) => slot.start >= nowMinutes - 15);
      if (!candidates.length) return null;
    }
    return slotIndex % 2 === 1 ? candidates[candidates.length - 1] || null : candidates[0] || null;
  }
  async function switchToTomorrowForSlots() {
    const input = findDateInput();
    if (!input) return false;
    const tomorrow = vnDate(1);
    if (dateTargetLooksSelected(input, tomorrow)) return true;
    const target = input.closest("#selected-date-picker,.rc-picker") || input;
    paintCheckoutTarget(target, "2. Chuy\u1EC3n sang ng\xE0y mai", { scroll: false });
    showGuidance({
      checkpointId: "coop-checkout",
      message: `C\xE1c khung gi\u1EDD h\xF4m nay \u0111\xE3 h\u1EBFt. Zapee chuy\u1EC3n sang ng\xE0y mai ${tomorrow.display} v\xE0 ch\u1ECDn khung gi\u1EDD s\u1EDBm nh\u1EA5t.`,
      title: CHECKOUT_TITLE,
      steps: checkoutSteps("date")
    });
    await openDatePicker(input);
    if (await clickTodayOrCell(tomorrow)) return true;
    for (const value of [tomorrow.display, tomorrow.displayLoose]) {
      if (await typeAndCommitDate(input, value)) return true;
    }
    return dateTargetLooksSelected(findDateInput(), tomorrow);
  }
  async function selectTimeSlot(slotIndex, allowTomorrowFallback = true, tomorrowFallback = false, wanted) {
    let picker = null;
    for (let i = 0; i < 20; i += 1) {
      picker = document.querySelector("#selected-time-picker");
      if (picker && visible4(picker)) break;
      const label = [...document.querySelectorAll("label,h2,h3,div,span")].find((n) => visible4(n) && /chon khung gio|khung gio nhan/i.test(elementText2(n)));
      if (label) {
        picker = label.closest("section,div") || label.parentElement;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!picker) return false;
    safeClick2(picker);
    await sleep2(350);
    let slots = collectEnabledTimeSlots(document);
    if (tomorrowFallback && !slots.length) {
      for (let attempt = 0; attempt < 12 && !slots.length; attempt += 1) {
        await sleep2(250);
        slots = collectEnabledTimeSlots(document);
      }
    }
    if (!slots.length) {
      if (allowTomorrowFallback && await switchToTomorrowForSlots()) {
        await sleep2(500);
        return selectTimeSlot(0, false, true, wanted);
      }
      return false;
    }
    const chosen = chooseTimeSlot(slots, slotIndex, tomorrowFallback, currentVnMinutes(), wanted);
    if (!chosen) {
      if (allowTomorrowFallback && await switchToTomorrowForSlots()) {
        await sleep2(500);
        return selectTimeSlot(0, false, true, wanted);
      }
      return false;
    }
    await highlightAndHold(chosen.child, {
      step: "slot",
      message: "Zapee \u0111ang nh\u1EADp khung gi\u1EDD (\u0111ang t\xF4 s\xE1ng).",
      note: "Zapee \u0111ang nh\u1EADp khung gi\u1EDD",
      locator: { strategy: "css", value: "#selected-time-picker button:not([disabled])" }
    });
    paintCheckoutTarget(chosen.child, "Zapee \u0111ang nh\u1EADp khung gi\u1EDD", { scroll: false });
    const clicked = safeClick2(chosen.child);
    await sleep2(700);
    return clicked;
  }
  function paymentLooksSelected(root = document) {
    const selected = root.querySelector(
      "[data-content-region-name='paymentMethod'][class*='selected'],[data-content-region-name='paymentMethod'][class*='active'],[data-content-region-name='paymentMethod'][aria-checked='true'],[data-content-region-name='paymentMethod'] input:checked,input[name*='payment']:checked,input[type='radio'][name*='pay']:checked"
    );
    return Boolean(selected);
  }
  async function selectPayment(method) {
    const m = String(method || "qr").toLowerCase();
    const code = m === "card" || m === "atm" ? "VNPAY_GATEWAY_INTERNATIONAL_CARD" : m === "cod" ? "COD" : "VNPAY_GATEWAY_QR";
    await sleep2(300);
    const exact = document.querySelector(
      `[data-content-region-name='paymentMethod'][data-content-name='${code}']`
    );
    const needles = m === "cod" ? ["thanh toan khi nhan", "tien mat", "cod"] : m === "card" || m === "atm" ? ["the atm", "internet banking", "visa", "mastercard", "the quoc te"] : ["quet ma qr", "vnpay qr", "vnpay", "quet ma", "qr"];
    const nodes = Array.from(document.querySelectorAll(
      "label,[role='radio'],button,div,[data-content-region-name='paymentMethod'],[data-content-name*='VNPAY'],[data-content-name*='COD']"
    )).filter((el) => el instanceof HTMLElement).map((el) => {
      const text = elementText2(el);
      const name = `${el.getAttribute("data-content-name") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
      if (/dat hang|thanh toan ngay|hoan tat don|dat mua/.test(text)) return null;
      let score = needles.reduce((n, needle) => n + (text.includes(needle) || name.includes(needle) ? 1 : 0), 0);
      if (code && name.includes(code.toLowerCase())) score += 5;
      return score ? { el, score, len: text.length } : null;
    }).filter(Boolean);
    nodes.sort((a, b) => b.score - a.score || a.len - b.len);
    const already = paymentLooksSelected();
    const selectedEl = document.querySelector(
      "[data-content-region-name='paymentMethod'][class*='selected'],[data-content-region-name='paymentMethod'][class*='active'],[data-content-region-name='paymentMethod'][aria-checked='true']"
    );
    const payTarget = exact || selectedEl || nodes[0]?.el || null;
    if (!payTarget) return already;
    await highlightAndHold(payTarget, {
      step: "pay",
      message: already ? "\u0110ang ch\u1ECDn ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n (\u0111ang t\xF4 s\xE1ng)." : "\u0110ang ch\u1ECDn ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n (\u0111ang t\xF4 s\xE1ng).",
      note: "\u0110ang ch\u1ECDn ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n",
      locator: {
        strategy: "css",
        value: exact ? `[data-content-region-name='paymentMethod'][data-content-name='${code}']` : "[data-content-region-name='paymentMethod']"
      }
    });
    if (already) return true;
    paintCheckoutTarget(payTarget, "\u0110ang ch\u1ECDn ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n", { scroll: false });
    safeClick2(payTarget);
    const radio = payTarget.querySelector("input[type='radio']");
    if (radio && !radio.checked) {
      try {
        radio.click();
      } catch {
      }
    }
    await sleep2(600);
    return paymentLooksSelected() || Boolean(payTarget);
  }
  function checkoutDomReady() {
    if (!/\/checkout/i.test(location.pathname)) return false;
    const text = elementText2(document.body);
    const hasShellText = [
      "thong tin nhan hang",
      "nhan hang tai nha",
      "chon ngay nhan hang",
      "chon khung gio",
      "phuong thuc thanh toan",
      "thong tin don hang"
    ].some((m) => text.includes(m));
    if (!hasShellText) return false;
    const dateInput = findDateInput();
    const timePicker = document.querySelector("#selected-time-picker");
    const payment = document.querySelector(
      "[data-content-region-name='paymentMethod'],[data-content-name*='VNPAY'],[data-content-name*='COD']"
    );
    const placeOrder = [...document.querySelectorAll("button,a,[role='button']")].some((n) => visible4(n) && /dat hang|thanh toan/.test(elementText2(n)));
    return Boolean(dateInput || timePicker && visible4(timePicker) || payment || placeOrder);
  }
  function noteOnce(message) {
    if (message === lastStatusKey) return;
    lastStatusKey = message;
    showGuidance({ checkpointId: "coop-checkout", message });
  }
  function markCoopCheckoutLanded() {
    if (!/\/checkout/i.test(location.pathname)) return;
    installScrollGuard();
    if (!checkoutLandedAt) {
      checkoutLandedAt = Date.now();
    }
  }
  async function runCoopCheckoutFill(payload = {}) {
    if (completed) return true;
    if (running) return false;
    if (!/\/checkout/i.test(location.pathname)) return false;
    markCoopCheckoutLanded();
    if (autoStepsDone) {
      guidePlaceOrderUserOnly();
      return false;
    }
    if (attemptCount >= MAX_FILL_ATTEMPTS) {
      noteOnce(
        "Zapee \u0111\xE3 th\u1EED \u0111i\u1EC1n checkout nhi\u1EC1u l\u1EA7n. B\u1EA1n ch\u1ECDn ng\xE0y / khung gi\u1EDD / thanh to\xE1n r\u1ED3i t\u1EF1 b\u1EA5m THANH TO\xC1N \u2014 Zapee kh\xF4ng b\u1EA5m h\u1ED9."
      );
      autoStepsDone = true;
      guidePlaceOrderUserOnly();
      return false;
    }
    const elapsed = Date.now() - (checkoutLandedAt || Date.now());
    if (elapsed < CHECKOUT_SETTLE_MS) {
      noteOnce("Trang thanh to\xE1n \u0111ang t\u1EA3i\u2026 Zapee \u0111\u1EE3i form s\u1EB5n s\xE0ng r\u1ED3i m\u1EDBi: \u2460 \u0111\u1ECBa ch\u1EC9 \u2192 \u2461 ng\xE0y \u2192 \u2462 gi\u1EDD \u2192 \u2463 ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n \u2192 \u2464 b\u1EA1n b\u1EA5m THANH TO\xC1N.");
      return false;
    }
    if (!checkoutDomReady()) {
      noteOnce("Trang thanh to\xE1n ch\u01B0a hi\u1EC7n \u0111\u1EE7 form. Zapee \u0111ang ch\u1EDD load xong\u2026");
      return false;
    }
    running = true;
    attemptCount += 1;
    try {
      const wantedSlot = parseZapeeCoopSlot(payload.slot);
      const legacyIndex = Number(payload.checkout?.deliverySlotIndex);
      const slotIndex = Number.isFinite(legacyIndex) ? legacyIndex : 0;
      const dayOffset = wantedSlot.window || wantedSlot.dayOffset === 1 ? wantedSlot.dayOffset : slotIndex >= 2 ? 1 : 0;
      const pay = String(payload.checkout?.paymentMethod || payload.paymentMethod || "qr");
      showGuidance({
        checkpointId: "coop-checkout",
        message: "Checkout s\u1EB5n s\xE0ng. Zapee l\u1EA7n l\u01B0\u1EE3t: \u2460 \u0111\u1ECBa ch\u1EC9 nh\u1EADn \u2192 \u2461 ng\xE0y \u2192 \u2462 khung gi\u1EDD \u2192 \u2463 ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n (m\u1ED7i b\u01B0\u1EDBc t\xF4 s\xE1ng ~3s). B\u01B0\u1EDBc \u2464 THANH TO\xC1N do b\u1EA1n b\u1EA5m.",
        title: CHECKOUT_TITLE,
        steps: checkoutSteps("recipient")
      });
      lastStatusKey = "checkout-intro";
      await sleep2(1e3);
      if (!recipientOk) {
        recipientOk = await selectRecipient(payload);
        await sleep2(BETWEEN_STEPS_MS);
      }
      if (!recipientOk) {
        noteOnce("B\u01B0\u1EDBc 1/5: Ch\u01B0a th\u1EA5y th\u1EBB th\xF4ng tin nh\u1EADn h\xE0ng. Zapee s\u1EBD th\u1EED l\u1EA1i\u2026");
        return false;
      }
      if (!dateFilledOk) {
        dateFilledOk = await fillDate(dayOffset);
        await sleep2(BETWEEN_STEPS_MS);
      }
      if (!dateFilledOk) {
        noteOnce("B\u01B0\u1EDBc 2/5: Ch\u01B0a \u0111i\u1EC1n \u0111\u01B0\u1EE3c ng\xE0y nh\u1EADn. Zapee s\u1EBD th\u1EED l\u1EA1i\u2026");
        return false;
      }
      if (!slotSelectedOk) {
        slotSelectedOk = await selectTimeSlot(slotIndex, true, false, wantedSlot);
        await sleep2(BETWEEN_STEPS_MS);
      }
      if (!slotSelectedOk) {
        noteOnce("B\u01B0\u1EDBc 3/5: Ch\u01B0a ch\u1ECDn \u0111\u01B0\u1EE3c khung gi\u1EDD. Zapee s\u1EBD th\u1EED l\u1EA1i\u2026");
        return false;
      }
      if (!paymentSelectedOk) {
        paymentSelectedOk = await selectPayment(pay);
        await sleep2(BETWEEN_STEPS_MS);
      }
      if (!paymentSelectedOk) {
        noteOnce("B\u01B0\u1EDBc 4/5: Ch\u01B0a ch\u1ECDn \u0111\u01B0\u1EE3c ph\u01B0\u01A1ng th\u1EE9c thanh to\xE1n. Zapee s\u1EBD th\u1EED l\u1EA1i\u2026");
        return false;
      }
      autoStepsDone = true;
      guidePlaceOrderUserOnly();
      return false;
    } finally {
      running = false;
    }
  }
  function isCoopCheckoutFillComplete() {
    return completed;
  }
  function isCoopCheckoutFillRunning() {
    return running;
  }
  function resetCoopCheckoutFill() {
    completed = false;
    autoStepsDone = false;
    running = false;
    lastStatusKey = "";
    attemptCount = 0;
    checkoutLandedAt = 0;
    recipientOk = false;
    dateFilledOk = false;
    slotSelectedOk = false;
    paymentSelectedOk = false;
    autoScrolledSteps.clear();
    clearCheckoutDecorations();
    removeScrollGuard();
  }

  // src/content/retailer-live-cart.ts
  var activeSessionId = "";
  var activeConfig = null;
  var publishSnapshot = null;
  var observer = null;
  var timer3 = null;
  var pollTimer = null;
  var lastFingerprint = "";
  var hasPublishedSelection = false;
  var eventListenersAttached = false;
  function hrefMatches(config) {
    const needles = Array.isArray(config.urlIncludes) ? config.urlIncludes : [config.urlIncludes];
    return needles.some((needle) => Boolean(needle) && location.href.includes(needle));
  }
  function selfOrQuery(root, selector) {
    if (!selector) return root;
    try {
      if (root.matches(selector)) return root;
    } catch {
    }
    return query(root, selector);
  }
  function query(root, selector) {
    if (!selector) return null;
    try {
      return root.querySelector(selector);
    } catch {
      return null;
    }
  }
  function queryAll(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }
  function textOf(root, selector) {
    return String(query(root, selector)?.textContent || "").replace(/\s+/g, " ").trim();
  }
  function labelFrom(element) {
    if (!element) return "";
    const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text;
    return String(element.getAttribute("title") || element.getAttribute("aria-label") || element.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
  }
  function labelOf(root, selector) {
    return labelFrom(query(root, selector));
  }
  function labelOfBest(root, selector) {
    if (!selector) return "";
    try {
      if (root instanceof Element && root.matches(selector)) {
        const own = labelFrom(root);
        if (own) return own;
      }
    } catch {
    }
    for (const el of queryAll(root, selector)) {
      const label = labelFrom(el);
      if (label) return label;
    }
    return "";
  }
  function queryOwned(row, selector, rowSelector, maxDepth = 6) {
    if (!selector) return null;
    const inRow = selfOrQuery(row, selector);
    if (inRow) return inRow;
    let ancestor = row.parentElement;
    for (let depth = 0; ancestor && depth < maxDepth; depth += 1, ancestor = ancestor.parentElement) {
      try {
        if (ancestor.matches(selector)) return ancestor;
      } catch {
      }
      const owned = queryAll(ancestor, selector).filter((candidate) => {
        try {
          const ownerRow = candidate.closest(rowSelector);
          return !ownerRow || ownerRow === row;
        } catch {
          return true;
        }
      });
      if (owned.length === 1) return owned[0];
      if (owned.length > 1) return null;
    }
    return null;
  }
  function retailerMoneyAmounts(value) {
    const normalized = String(value || "").replace(/\s+/g, " ");
    const tagged = [
      ...normalized.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(?:đ|₫|vnd|usd)\b/gi),
      ...normalized.matchAll(/(?:vnd|usd|₫|đ)\s*(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{2})?)/gi)
    ].map((match) => Number(String(match[1]).replace(/[^0-9]/g, ""))).filter((amount2) => Number.isFinite(amount2) && amount2 > 0);
    if (tagged.length) return tagged;
    const strippedPct = normalized.replace(/\d+(?:[.,]\d+)?\s*%/g, " ");
    const grouped = strippedPct.match(/\d{1,3}(?:[.,]\d{3})+/);
    const token = grouped?.[0] || strippedPct.match(/\d{4,}/)?.[0];
    if (!token) return [];
    const amount = Number(token.replace(/[^0-9]/g, ""));
    return Number.isFinite(amount) && amount > 0 ? [amount] : [];
  }
  function parseRetailerMoney(value, pick = "first") {
    const amounts = retailerMoneyAmounts(value);
    if (!amounts.length) return void 0;
    if (pick === "min") return Math.min(...amounts);
    if (pick === "max") return Math.max(...amounts);
    return amounts[0];
  }
  function selectedControlOf(row, config) {
    const selector = config.selectedSelector;
    if (!selector) return null;
    const inRow = query(row, selector);
    if (inRow) return inRow;
    let sibling = row.previousElementSibling;
    while (sibling) {
      try {
        if (sibling.matches(selector)) return sibling;
      } catch {
      }
      const found = query(sibling, selector);
      if (found) return found;
      sibling = sibling.previousElementSibling;
    }
    return null;
  }
  function readCartLineSelection(scope, productLinks) {
    let row = scope;
    for (let depth = 0; row && row !== document.body && depth < 6; depth += 1, row = row.parentElement) {
      const currentRow = row;
      const products = new Set(productLinks.filter((link) => currentRow.contains(link)).map((link) => new URL(link.href).pathname.replace(/\/+$/, "")));
      if (products.size !== 1) return null;
      const inputs = row.querySelectorAll("input[type='checkbox']");
      if (inputs.length) return inputs.length === 1 ? inputs[0].checked : null;
      const controls = row.querySelectorAll("[role='checkbox'][aria-checked]");
      if (controls.length) {
        const state = controls[0].getAttribute("aria-checked");
        return controls.length === 1 && (state === "true" || state === "false") ? state === "true" : null;
      }
    }
    return null;
  }
  function isSelected(row, config) {
    if (!config.selectedSelector) return true;
    const control = selectedControlOf(row, config);
    if (!control) return false;
    const attribute = config.selectedAttribute || "aria-checked";
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      return control.checked || control.getAttribute(attribute) === "true";
    }
    return control.getAttribute(attribute) === "true";
  }
  function hasQuantityControl(row, selector) {
    if (!selector) return false;
    return Boolean(selfOrQuery(row, selector));
  }
  function rowHasProductName(row, config) {
    const named = selfOrQuery(row, config.nameSelector) || query(row, config.urlSelector);
    if (!named) return false;
    if (labelFrom(named)) return true;
    return named instanceof window.HTMLAnchorElement && Boolean(named.getAttribute("href"));
  }
  function innermost(rows) {
    return rows.filter((row) => !rows.some((other) => other !== row && row.contains(other)));
  }
  function selectLiveCartRows(config) {
    const all = queryAll(document, config.rowSelector);
    if (all.length <= 1) return all;
    const withQty = config.quantitySelector ? all.filter((row) => hasQuantityControl(row, config.quantitySelector)) : all;
    const pool = withQty.length ? withQty : all;
    const named = pool.filter((row) => rowHasProductName(row, config));
    return innermost(named.length ? named : pool);
  }
  function quantityOf(row, selector) {
    if (!selector) return 1;
    const input = selfOrQuery(row, selector);
    if (!input) return 1;
    const raw = input instanceof HTMLInputElement ? input.value || input.getAttribute("aria-valuenow") : input.getAttribute("aria-valuenow") || input.textContent;
    const direct = Number.parseInt(String(raw || "").trim(), 10);
    if (Number.isInteger(direct) && direct >= 0) return direct;
    const match = String(raw || "").match(/(\d{1,4})/);
    return Math.max(0, Number.parseInt(match?.[1] || "0", 10) || 0);
  }
  function absoluteUrl(value) {
    if (!value) return void 0;
    try {
      return new URL(value, location.href).toString();
    } catch {
      return void 0;
    }
  }
  function firstSrcsetUrl(value) {
    const first = String(value || "").split(",")[0] || "";
    return first.trim().split(/\s+/)[0] || "";
  }
  function isPlaceholderImageUrl(url) {
    const lower = url.toLowerCase();
    if (!url || url === location.href) return true;
    if (lower.startsWith("data:")) return true;
    if (/\/(?:blank|spacer|placeholder|transparent)\.(?:gif|png|svg|webp)/i.test(url)) return true;
    return false;
  }
  function isDecorativeImage(img, url) {
    const hay = [
      url,
      img.getAttribute("alt") || "",
      img.getAttribute("class") || "",
      img.getAttribute("title") || ""
    ].join(" ").toLowerCase();
    if (/guarant|badge|logo|icon|sprite|flag|trade.?assurance|watermark/.test(hay)) return true;
    const width = Number(img.getAttribute("width") || img.width || 0);
    const height = Number(img.getAttribute("height") || img.height || 0);
    if (width > 0 && width < 32 || height > 0 && height < 32) return true;
    return false;
  }
  function imageUrlFrom(img) {
    const candidates = [
      img.currentSrc,
      img.getAttribute("src"),
      img.src,
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-lazy-src"),
      img.getAttribute("data-lazy"),
      firstSrcsetUrl(img.getAttribute("srcset") || ""),
      firstSrcsetUrl(img.getAttribute("data-srcset") || "")
    ];
    for (const candidate of candidates) {
      const url = absoluteUrl(String(candidate || "").trim());
      if (url && !isPlaceholderImageUrl(url)) return url;
    }
    return void 0;
  }
  function imageOf(row, selector) {
    const ImageType = window.HTMLImageElement;
    const pick = (root) => {
      const nodes = selector ? queryAll(root, selector) : queryAll(root, "img");
      if (root instanceof Element && selector) {
        try {
          if (root.matches(selector) && root instanceof ImageType) nodes.unshift(root);
        } catch {
        }
      }
      let best;
      for (const node of nodes) {
        const img = node instanceof ImageType ? node : query(node, "img");
        if (!(img instanceof ImageType)) continue;
        const url = imageUrlFrom(img);
        if (!url || isDecorativeImage(img, url)) continue;
        const width = Number(img.getAttribute("width") || img.width || 80);
        const height = Number(img.getAttribute("height") || img.height || 80);
        const score = Math.max(width, 1) * Math.max(height, 1);
        if (!best || score > best.score) best = { url, score };
      }
      return best?.url;
    };
    const fromRow = pick(row);
    if (fromRow) return fromRow;
    let parent = row.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const fromParent = pick(parent);
      if (fromParent) return fromParent;
    }
    return void 0;
  }
  function readRetailerLiveCart(sessionId, config) {
    if (!sessionId || !hrefMatches(config)) return null;
    const items = selectLiveCartRows(config).filter((row) => isSelected(row, config)).map((row) => {
      const link = queryOwned(row, config.urlSelector, config.rowSelector);
      const named = queryOwned(row, config.nameSelector, config.rowSelector);
      const name = labelOfBest(row, config.nameSelector) || labelFrom(named) || labelOf(row, config.nameSelector);
      const qty = quantityOf(row, config.quantitySelector);
      return {
        name,
        qty,
        unitPrice: parseRetailerMoney(textOf(row, config.unitPriceSelector), "min"),
        lineTotal: parseRetailerMoney(textOf(row, config.lineTotalSelector), "max"),
        image: imageOf(row, config.imageSelector),
        url: link instanceof window.HTMLAnchorElement ? absoluteUrl(link.href) : absoluteUrl(link?.getAttribute("href") || "")
      };
    }).filter((item) => item.name && item.qty > 0);
    return {
      sessionId,
      items,
      total: items.reduce((sum, item) => sum + (item.lineTotal || (item.unitPrice || 0) * item.qty), 0),
      source: config.source || "retailer-cart-dom"
    };
  }
  function flush() {
    timer3 = null;
    if (!activeConfig || !publishSnapshot) return;
    const snapshot = readRetailerLiveCart(activeSessionId, activeConfig);
    if (!snapshot) return;
    if (!snapshot.items.length) {
      if (!hasPublishedSelection) return;
      if (!activeConfig.selectedSelector) return;
    }
    const fingerprint = JSON.stringify(snapshot);
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    if (snapshot.items.length) hasPublishedSelection = true;
    publishSnapshot(snapshot);
  }
  function refreshRetailerLiveCart(delayMs = 120) {
    if (timer3 != null) window.clearTimeout(timer3);
    timer3 = window.setTimeout(flush, delayMs);
  }
  function onRetailerCartInteraction() {
    if (!activeConfig || !hrefMatches(activeConfig)) return;
    refreshRetailerLiveCart(80);
  }
  function attachEventListeners() {
    if (eventListenersAttached) return;
    eventListenersAttached = true;
    document.addEventListener("click", onRetailerCartInteraction, true);
    document.addEventListener("change", onRetailerCartInteraction, true);
    document.addEventListener("input", onRetailerCartInteraction, true);
  }
  function detachEventListeners() {
    if (!eventListenersAttached) return;
    eventListenersAttached = false;
    document.removeEventListener("click", onRetailerCartInteraction, true);
    document.removeEventListener("change", onRetailerCartInteraction, true);
    document.removeEventListener("input", onRetailerCartInteraction, true);
  }
  function configureRetailerLiveCart(sessionId, config, publisher) {
    const sessionChanged = Boolean(activeSessionId && activeSessionId !== sessionId);
    activeSessionId = sessionId;
    activeConfig = config || null;
    publishSnapshot = publisher;
    lastFingerprint = "";
    if (sessionChanged) hasPublishedSelection = false;
    observer?.disconnect();
    observer = null;
    if (pollTimer != null) window.clearInterval(pollTimer);
    pollTimer = null;
    detachEventListeners();
    if (!activeConfig) {
      hasPublishedSelection = false;
      return;
    }
    attachEventListeners();
    observer = new MutationObserver(() => refreshRetailerLiveCart());
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [activeConfig.selectedAttribute || "aria-checked", "value", "checked"]
    });
    pollTimer = window.setInterval(() => refreshRetailerLiveCart(0), 1200);
    refreshRetailerLiveCart(0);
  }
  function resetRetailerLiveCart(sessionId) {
    if (sessionId && activeSessionId && sessionId !== activeSessionId) return;
    observer?.disconnect();
    observer = null;
    if (timer3 != null) window.clearTimeout(timer3);
    timer3 = null;
    if (pollTimer != null) window.clearInterval(pollTimer);
    pollTimer = null;
    activeSessionId = "";
    activeConfig = null;
    publishSnapshot = null;
    lastFingerprint = "";
    hasPublishedSelection = false;
    detachEventListeners();
  }

  // src/content/coop-live-cart.ts
  function visible5(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 1 && rect.height > 1;
  }
  function normalizePath(value) {
    try {
      return new URL(value, location.origin).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return "";
    }
  }
  function comparableText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function productSku(value) {
    return normalizePath(value).match(/--s(\d+)(?:$|\/)/i)?.[1] || "";
  }
  function parseMoney(value) {
    const normalized = String(value || "").replace(/\s+/g, " ");
    const matches = [...normalized.matchAll(/(\d[\d.,]*)\s*(?:đ|₫)(?!\p{L})/gu)];
    const amounts = matches.map((match) => Number(String(match[1]).replace(/[^\d]/g, ""))).filter((amount) => Number.isFinite(amount) && amount >= 0);
    return amounts.length ? Math.max(...amounts) : 0;
  }
  function parseUnitPrice(value) {
    const normalized = String(value || "").replace(/\s+/g, " ");
    const amounts = [...normalized.matchAll(/(\d[\d.,]*)\s*(?:đ|₫)(?!\p{L})/gu)].map((match) => Number(String(match[1]).replace(/[^\d]/g, ""))).filter((amount) => Number.isFinite(amount) && amount > 0);
    return amounts.length ? Math.min(...amounts) : 0;
  }
  function parseQuantity(scope) {
    if (!(scope instanceof Element)) return null;
    const inputs = [...scope.querySelectorAll("input")].filter(visible5);
    for (const input of inputs) {
      const rawValue = String(input.value ?? "").trim();
      const isQuantityInput = input.matches(
        "input[type='number'],[role='spinbutton'],.rc-input-number-input,[class*='quantity'] input"
      );
      if (!rawValue || !isQuantityInput) continue;
      const value = Number(rawValue);
      if (Number.isInteger(value) && value >= 0 && value <= 999) return value;
    }
    const controls = [...scope.querySelectorAll("button,[role='button']")].filter(visible5);
    const plus = controls.find((element) => {
      const label = `${String(element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase()} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`.trim().toLowerCase();
      return element.matches(".plus-btn,[class*='plus-btn']") || label === "+" || /tăng số lượng|increase quantity|quantity increase/.test(label);
    });
    if (!plus) return null;
    let quantityScope = plus.parentElement;
    for (let depth = 0; quantityScope && depth < 4; depth += 1, quantityScope = quantityScope.parentElement) {
      const text = String(quantityScope.innerText || quantityScope.textContent || "").replace(/\s+/g, " ").trim();
      const numbers = [...text.matchAll(/(?:^|\s)(\d{1,3})(?=\s|$)/g)].map((match) => Number(match[1])).filter((value) => Number.isInteger(value) && value >= 0 && value <= 999);
      if (numbers.length === 1) return numbers[0];
    }
    return null;
  }
  function findProductScope(anchor) {
    let scope = anchor;
    let fallback = anchor;
    for (let depth = 0; scope && depth < 9; depth += 1, scope = scope.parentElement) {
      fallback = scope;
      const text = String(scope.textContent || "");
      if (parseQuantity(scope) !== null && parseMoney(text) > 0) return scope;
    }
    return fallback;
  }
  function cartName(anchor, scope) {
    const slugName = decodeURIComponent(normalizePath(anchor.href).split("/").filter(Boolean).at(-1) || "").replace(/--s\d+$/i, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
    const hrefTokens = comparableText(normalizePath(anchor.href).replace(/--s\d+(?:$|\/)/i, " ")).split(/\s+/).filter((token) => token.length >= 3 && !/^(san|pham|cao|cap|hop|goi|chai|thung)$/.test(token));
    const candidates = [];
    const addCandidate = (value, priority = 0) => {
      const clean = String(value || "").replace(/\s+/g, " ").trim();
      const comparable = comparableText(clean);
      if (clean.length < 4 || clean.length > 180 || !/\p{L}/u.test(clean)) return;
      if (/^(san pham|product)$/.test(comparable)) return;
      if (/\d[\d.,]*\s*(?:đ|₫)/iu.test(clean)) return;
      if (/flashsale|giam\s*\d+|con lai|don vi tinh|them vao gio|mua ngay|sku\s*:|danh gia|top san pham/i.test(comparable)) return;
      const overlap = hrefTokens.filter((token) => comparable.includes(token)).length;
      candidates.push({ clean, score: priority + overlap * 5 - Math.max(0, clean.length - 100) / 20 });
    };
    const productHeading = anchor.querySelector("h1,h2,h3,h4,h5,[data-content-name*='productName'],[data-content-name*='product-name']");
    const productImage = anchor.querySelector("img[alt]");
    addCandidate(productHeading?.textContent, 40);
    addCandidate(productImage?.getAttribute("alt"), 36);
    const anchorPath = normalizePath(anchor.href);
    const anchorSku = productSku(anchor.href);
    const relatedLinks = [...scope.querySelectorAll("a[href]")].filter((link) => {
      const linkPath = normalizePath(link.href);
      const linkSku = productSku(link.href);
      return anchorPath && linkPath === anchorPath || anchorSku && linkSku === anchorSku;
    });
    for (const link of relatedLinks) {
      const heading = link.querySelector("h1,h2,h3,h4,h5,[data-content-name*='productName'],[data-content-name*='product-name']");
      const image = link.querySelector("img[alt]");
      addCandidate(heading?.textContent, 50);
      addCandidate(image?.getAttribute("alt"), 48);
      addCandidate(link.getAttribute("title"), 46);
      addCandidate(link.getAttribute("aria-label"), 44);
      addCandidate(link.textContent, 42);
    }
    addCandidate(scope.querySelector("img[alt]")?.getAttribute("alt"), 38);
    addCandidate(slugName, 20);
    addCandidate(anchor.getAttribute("title"), 12);
    addCandidate(anchor.getAttribute("aria-label"), 10);
    for (const node of scope.querySelectorAll("h1,h2,h3,h4,h5,strong,p,span,div")) {
      if (node.matches("span,div") && node.childElementCount > 2) continue;
      addCandidate(node.getAttribute("title"), 9);
      addCandidate(node.getAttribute("aria-label"), 8);
      addCandidate(node.textContent, node.matches("h1,h2,h3,h4,h5,strong") ? 7 : 3);
    }
    addCandidate(anchor.textContent, 1);
    candidates.sort((left, right) => right.score - left.score || left.clean.length - right.clean.length);
    if (candidates[0]?.clean) return candidates[0].clean;
    return slugName ? slugName.charAt(0).toUpperCase() + slugName.slice(1) : "S\u1EA3n ph\u1EA9m";
  }
  function readVisibleCartDom() {
    if (normalizePath(location.href) !== "/cart") return null;
    const anchors = [...document.querySelectorAll("a[href*='--s']")].filter(visible5);
    const seen = /* @__PURE__ */ new Set();
    const items = [];
    let hasDeselectedItems = false;
    for (const anchor of anchors) {
      const sku = productSku(anchor.href);
      const path = normalizePath(anchor.href);
      const key = sku || path;
      if (!key || seen.has(key)) continue;
      const scope = findProductScope(anchor);
      const quantity = parseQuantity(scope);
      if (!Number.isInteger(quantity) || !quantity || quantity <= 0) continue;
      seen.add(key);
      if (readCartLineSelection(scope, anchors) === false) {
        hasDeselectedItems = true;
        continue;
      }
      const name = cartName(anchor, scope);
      const image = scope.querySelector("img[src]");
      const lineTotal = parseMoney(scope.textContent || "");
      items.push({
        sku,
        name,
        qty: quantity,
        // Legacy: unitPrice = lineTotal / qty (not min money in row — avoids flash-sale noise).
        unitPrice: lineTotal > 0 ? Math.round(lineTotal / quantity) : 0,
        lineTotal,
        image: image?.currentSrc || image?.src || "",
        url: anchor.href
      });
    }
    if (!seen.size) return null;
    const totalCandidates = [...document.querySelectorAll("body *")].filter((element) => {
      const text = comparableText(element.textContent || "");
      return element.children.length <= 3 && /^(thanh tien|tong tam tinh|tong cong)/.test(text);
    }).map((element) => parseMoney(element.parentElement?.textContent || element.textContent || ""));
    const itemTotal = items.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
    return {
      items,
      total: hasDeselectedItems ? itemTotal : Math.max(itemTotal, ...totalCandidates, 0),
      currency: "VND",
      source: "cart-dom",
      pageUrl: location.href,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function readCheckoutSummaryDom() {
    if (!/\/checkout/i.test(location.pathname)) return null;
    const byLink = (() => {
      const anchors = [...document.querySelectorAll("a[href*='--s']")].filter(visible5);
      if (!anchors.length) return null;
      const path = normalizePath(location.href);
      if (path.includes("checkout")) {
        const seen = /* @__PURE__ */ new Set();
        const items = [];
        for (const anchor of anchors) {
          const sku = productSku(anchor.href);
          const key = sku || normalizePath(anchor.href);
          if (!key || seen.has(key)) continue;
          const scope = findProductScope(anchor);
          const quantity = parseQuantity(scope) || Number((scope.textContent || "").match(/[sS]ố lượng\s*(\d+)/)?.[1]) || 0;
          if (!quantity) continue;
          const lineTotal = parseMoney(scope.textContent || "");
          seen.add(key);
          items.push({
            sku,
            name: cartName(anchor, scope),
            qty: quantity,
            unitPrice: parseUnitPrice(scope.textContent || "") || (lineTotal ? Math.round(lineTotal / quantity) : 0),
            lineTotal: lineTotal || 0,
            image: scope.querySelector("img[src]")?.src || "",
            url: anchor.href
          });
        }
        if (!items.length) return null;
        const itemTotal = items.reduce((s, i) => s + (i.lineTotal || 0), 0);
        return {
          items,
          total: itemTotal,
          currency: "VND",
          source: "checkout-dom",
          pageUrl: location.href,
          capturedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      return null;
    })();
    return byLink;
  }
  function readCoopLiveCart() {
    return readVisibleCartDom() || readCheckoutSummaryDom();
  }
  async function reconcileOrderQtysOnCart(orderProducts) {
    if (normalizePath(location.href) !== "/cart") return;
    const snap = readVisibleCartDom();
    if (!snap) return;
    for (const order of orderProducts) {
      const wantQty = Math.max(1, Math.min(99, Number(order.qty) || 1));
      const wantSku = String(order.url || "").match(/--s(\d+)/i)?.[1] || "";
      const wantName = comparableText(String(order.name || ""));
      const line = snap.items.find(
        (i) => wantSku && i.sku === wantSku || wantName && comparableText(i.name).includes(wantName.slice(0, 16))
      );
      if (!line?.url) continue;
      const anchors = [...document.querySelectorAll(`a[href*='${wantSku ? `--s${wantSku}` : ""}']`)].filter(visible5);
      const anchor = anchors.find((a) => productSku(a.href) === (wantSku || productSku(line.url || ""))) || anchors[0];
      if (!anchor) continue;
      const scope = findProductScope(anchor);
      const input = scope.querySelector("input[type='number'], .rc-input-number-input");
      const plus = scope.querySelector(".rc-input-number-handler-up, button[aria-label*='T\u0103ng' i], .plus-btn");
      const minus = scope.querySelector(".rc-input-number-handler-down, button[aria-label*='Gi\u1EA3m' i]");
      const read = () => {
        if (input) return Math.max(1, Number(input.value) || 1);
        return parseQuantity(scope) || 1;
      };
      let cur = read();
      let guard = 0;
      while (cur < wantQty && plus && guard < 40) {
        plus.click();
        await new Promise((r) => setTimeout(r, 90));
        cur = read();
        guard += 1;
      }
      while (cur > wantQty && minus && guard < 80) {
        minus.click();
        await new Promise((r) => setTimeout(r, 90));
        cur = read();
        guard += 1;
      }
    }
  }

  // src/content/coop-cart-guide.ts
  var STYLE_ID3 = "zapee-coop-cart-guide-style";
  var RING_ID3 = "zapee-cart-guide-ring";
  var NOTE_ID3 = "zapee-cart-guide-note";
  var TARGET_MODAL = "zapee-guide-target-membership";
  var TARGET_BTN = "zapee-guide-target-cart-btn";
  var POLL_MS2 = 700;
  var SCROLL_SETTLE_MS4 = 160;
  var CONTINUE_CLICK_BLOCK_MS = 1e3;
  var STYLE2 = `
${guideHighlightCss({
    target: `.${TARGET_MODAL}, .${TARGET_BTN}`,
    ring: `#${RING_ID3}`,
    note: `#${NOTE_ID3}`
  })}
.${TARGET_BTN} {
  position: relative;
  z-index: 2;
}
#${RING_ID3} { display: none; }
#${NOTE_ID3} { display: none; }
`;
  var enabled3 = false;
  var timer4 = null;
  var phase = "idle";
  var membershipStepDone = false;
  var lastBubbleKey2 = "";
  var cartGuideStartedAt = 0;
  var continueBlockedUntil = 0;
  var ghostGuardInstalled = false;
  var ghostGuardHandler = null;
  var guideScrolling3 = false;
  var guideScrollTimer3 = null;
  function ensureStyles4() {
    if (document.getElementById(STYLE_ID3)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID3;
    style.textContent = STYLE2;
    (document.head || document.documentElement).appendChild(style);
  }
  function visible6(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const opacity = style.opacity === "" || style.opacity == null ? 1 : Number(style.opacity);
    return style.display !== "none" && style.visibility !== "hidden" && opacity > 0 && rect.width > 2 && rect.height > 2;
  }
  function bodyText() {
    return String(document.body?.innerText || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
  }
  function isCartPath() {
    return /\/cart(?:\/|$|\?)/i.test(location.pathname);
  }
  function isCheckoutPath() {
    return /\/checkout(?:\/|$|\?)/i.test(location.pathname);
  }
  function findMembershipModal() {
    if (!isCartPath()) return null;
    const modals = [...document.querySelectorAll(".teko-modal.teko-modal-show, .teko-modal-show, .teko-modal")];
    for (const modal of modals) {
      if (!(modal instanceof HTMLElement) || !visible6(modal)) continue;
      const text = String(modal.textContent || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
      if (/the thanh vien|lien ket\/dang ky|tich luy diem|thong bao/.test(text) && /dong|đóng|xem huong dan/.test(text)) {
        return modal;
      }
      if (/the thanh vien|lien ket\/dang ky|tich luy diem/.test(text)) return modal;
    }
    if (/chua lien ket\/dang ky the thanh vien|the thanh vien/.test(bodyText())) {
      const any = document.querySelector(".teko-modal.teko-modal-show, .teko-modal");
      if (any && visible6(any)) return any;
    }
    return null;
  }
  function findMembershipCloseButton(modal) {
    const root = modal || findMembershipModal();
    if (!root) return null;
    const buttons = [...root.querySelectorAll(".teko-modal-footer button, .teko-modal-footer [role='button'], button")];
    for (const btn of buttons) {
      if (!(btn instanceof HTMLElement) || !visible6(btn)) continue;
      const label = String(btn.textContent || "").replace(/\s+/g, " ").trim();
      const normalized = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (/^đóng$/i.test(label) || /^dong$/i.test(normalized)) return btn;
    }
    const footerFirst = root.querySelector(".teko-modal-footer button");
    if (footerFirst && visible6(footerFirst)) {
      const t = String(footerFirst.textContent || "");
      if (!/hướng dẫn|huong dan/i.test(t)) return footerFirst;
    }
    return null;
  }
  function findContinueButton() {
    if (!isCartPath()) return null;
    const selectors = [
      "[data-content-name='createOrder'] button.att-shopping-btn",
      "a[href*='checkout'] button.att-shopping-btn",
      "button.att-shopping-btn.css-pacifa",
      ".card-footer button.att-shopping-btn",
      "button.att-shopping-btn"
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (!(el instanceof HTMLElement) || !visible6(el)) continue;
        const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
        if (/tiếp tục|tiep tuc|thanh toán|thanh toan/i.test(text) || el.closest("a[href*='checkout']")) {
          return el;
        }
      }
    }
    const link = document.querySelector("a[href*='/checkout']");
    if (link && visible6(link)) {
      const btn = link.querySelector("button");
      if (btn && visible6(btn)) return btn;
      return link;
    }
    return null;
  }
  function isCheckoutNavTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest("a[href*='checkout']")) return true;
    if (target.closest("[data-content-name='createOrder']")) return true;
    const btn = target.closest("button.att-shopping-btn, button, a, [role='button']");
    if (!btn) return false;
    const text = String(btn.textContent || "").replace(/\s+/g, " ").trim();
    return /tiếp tục|tiep tuc|thanh toán|thanh toan|checkout/i.test(text);
  }
  function installGhostGuard() {
    if (ghostGuardInstalled || typeof document === "undefined") return;
    ghostGuardInstalled = true;
    ghostGuardHandler = (e) => {
      if (Date.now() >= continueBlockedUntil) return;
      if (!isCheckoutNavTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
    };
    for (const type of ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"]) {
      document.addEventListener(type, ghostGuardHandler, true);
    }
  }
  function removeGhostGuard() {
    if (!ghostGuardInstalled || !ghostGuardHandler) return;
    for (const type of ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"]) {
      document.removeEventListener(type, ghostGuardHandler, true);
    }
    ghostGuardInstalled = false;
    ghostGuardHandler = null;
  }
  function armGhostClickBlock() {
    continueBlockedUntil = Date.now() + CONTINUE_CLICK_BLOCK_MS;
    installGhostGuard();
  }
  function markMembershipClosed() {
    clearDecorations();
    membershipStepDone = true;
    phase = "continue";
    lastBubbleKey2 = "";
    armGhostClickBlock();
    setBubble(
      "coop-cart-continue",
      "B\u01B0\u1EDBc 2/2 gi\u1ECF: B\u1EA1n t\u1EF1 b\u1EA5m TI\u1EBEP T\u1EE4C (\u0111ang t\xF4 s\xE1ng) \u0111\u1EC3 v\xE0o checkout. Zapee kh\xF4ng b\u1EA5m h\u1ED9."
    );
  }
  function armCloseButton(closeBtn) {
    if (closeBtn.dataset.zapeeCloseArmed === "1") return;
    closeBtn.dataset.zapeeCloseArmed = "1";
    const onUserCloseGesture = () => {
      armGhostClickBlock();
    };
    closeBtn.addEventListener("pointerdown", onUserCloseGesture, { capture: true, once: true });
    closeBtn.addEventListener("mousedown", onUserCloseGesture, { capture: true, once: true });
    closeBtn.addEventListener("click", onUserCloseGesture, { capture: true, once: true });
  }
  function clearDecorations() {
    for (const el of document.querySelectorAll(`.${TARGET_MODAL}, .${TARGET_BTN}`)) {
      el.classList.remove(TARGET_MODAL, TARGET_BTN);
    }
    const ring = document.getElementById(RING_ID3);
    if (ring) ring.style.display = "none";
    const note = document.getElementById(NOTE_ID3);
    if (note) note.style.display = "none";
  }
  function paintTarget(target, noteText, preferredPlacement) {
    if (guideScrolling3) {
      clearDecorations();
      return;
    }
    ensureStyles4();
    if (!elementIntersectsViewport(target)) {
      clearDecorations();
      return;
    }
    for (const decorated of document.querySelectorAll(`.${TARGET_BTN}`)) {
      if (decorated !== target) decorated.classList.remove(TARGET_BTN);
    }
    target.classList.add(TARGET_BTN);
    const rect = target.getBoundingClientRect();
    const pad = 5;
    let ring = document.getElementById(RING_ID3);
    if (!ring) {
      ring = document.createElement("div");
      ring.id = RING_ID3;
      document.documentElement.appendChild(ring);
    }
    ring.style.display = "block";
    ring.style.left = `${Math.max(0, rect.left - pad)}px`;
    ring.style.top = `${Math.max(0, rect.top - pad)}px`;
    ring.style.width = `${Math.max(28, rect.width + pad * 2)}px`;
    ring.style.height = `${Math.max(28, rect.height + pad * 2)}px`;
    let note = document.getElementById(NOTE_ID3);
    if (!note) {
      note = document.createElement("span");
      note.id = NOTE_ID3;
      document.documentElement.appendChild(note);
    }
    const fallbackNoteWidth = 220;
    note.textContent = pointAtTarget(noteText, "right");
    note.style.display = "block";
    note.style.left = "0px";
    const noteWidth = Math.ceil(note.getBoundingClientRect().width) || fallbackNoteWidth;
    const gap = 6;
    const fitsLeft = rect.left - gap - noteWidth >= 8;
    const fitsRight = rect.right + gap + noteWidth <= window.innerWidth - 8;
    const placement = preferredPlacement === "left" && fitsLeft ? "left" : fitsRight ? "right" : fitsLeft ? "left" : "bottom";
    note.dataset.placement = placement;
    note.textContent = pointAtTarget(noteText, placement);
    note.style.left = `${placement === "left" ? rect.left - noteWidth - gap : placement === "right" ? rect.right + gap : Math.max(8, Math.min(window.innerWidth - noteWidth - 8, rect.left))}px`;
    note.style.top = `${placement !== "bottom" ? Math.max(8, rect.top + Math.max(0, (rect.height - 36) / 2)) : Math.min(window.innerHeight - 52, rect.bottom + 12)}px`;
  }
  function onGuideScroll4() {
    guideScrolling3 = true;
    clearDecorations();
    if (guideScrollTimer3 !== null) window.clearTimeout(guideScrollTimer3);
    guideScrollTimer3 = window.setTimeout(() => {
      guideScrollTimer3 = null;
      guideScrolling3 = false;
      tickWithGrace();
    }, SCROLL_SETTLE_MS4);
  }
  function setBubble(key, message) {
    if (lastBubbleKey2 === key) return;
    lastBubbleKey2 = key;
    showGuidance({
      checkpointId: key,
      message,
      steps: [
        {
          mark: "1",
          label: "B\u1EA5m \u0110\xF3ng tr\xEAn popup th\u1EBB th\xE0nh vi\xEAn",
          state: membershipStepDone || phase === "continue" || phase === "done" ? "done" : phase === "membership" ? "current" : "pending"
        },
        {
          mark: "2",
          label: "B\u1EA5m TI\u1EBEP T\u1EE4C \u0111\u1EC3 v\xE0o thanh to\xE1n",
          state: phase === "done" ? "done" : phase === "continue" ? "current" : "pending"
        }
      ]
    });
  }
  function tick3() {
    if (!enabled3) return;
    if (isCheckoutPath()) {
      if (Date.now() < continueBlockedUntil && membershipStepDone) {
        return;
      }
      phase = "done";
      clearDecorations();
      stopCoopCartGuide();
      return;
    }
    if (!isCartPath()) {
      clearDecorations();
      return;
    }
    ensureStyles4();
    const modal = findMembershipModal();
    const closeBtn = findMembershipCloseButton(modal);
    if (modal && closeBtn && !membershipStepDone) {
      const enteringMembership = phase !== "membership";
      phase = "membership";
      if (enteringMembership) clearDecorations();
      modal.classList.add(TARGET_MODAL);
      paintTarget(closeBtn, "B\u1EA5m \u0110\xF3ng", "left");
      armCloseButton(closeBtn);
      setBubble(
        "coop-cart-membership",
        "B\u01B0\u1EDBc 1/2 gi\u1ECF: B\u1EA5m n\xFAt \u0110\xF3ng tr\xEAn th\xF4ng b\xE1o th\u1EBB th\xE0nh vi\xEAn (\u0111ang t\xF4 s\xE1ng). Zapee kh\xF4ng t\u1EF1 \u0111\xF3ng."
      );
      return;
    }
    if (!modal && phase === "membership" && !membershipStepDone) {
      markMembershipClosed();
    }
    if (modal && !closeBtn && !membershipStepDone) {
      const enteringMembership = phase !== "membership";
      phase = "membership";
      if (enteringMembership) clearDecorations();
      modal.classList.add(TARGET_MODAL);
      setBubble(
        "coop-cart-membership-wait",
        "B\u01B0\u1EDBc 1/2 gi\u1ECF: \u0110ang t\xECm n\xFAt \u0110\xF3ng tr\xEAn popup th\u1EBB th\xE0nh vi\xEAn\u2026"
      );
      return;
    }
    if (!membershipStepDone && modal) return;
    if (!membershipStepDone) {
      membershipStepDone = true;
      phase = "continue";
      lastBubbleKey2 = "";
    }
    const continueBtn = findContinueButton();
    if (continueBtn) {
      const enteringContinue = phase !== "continue";
      phase = "continue";
      if (enteringContinue) clearDecorations();
      paintTarget(continueBtn, "B\u1EA5m TI\u1EBEP T\u1EE4C");
      setBubble(
        "coop-cart-continue",
        "B\u01B0\u1EDBc 2/2 gi\u1ECF: B\u1EA1n t\u1EF1 b\u1EA5m TI\u1EBEP T\u1EE4C (\u0111ang t\xF4 s\xE1ng) \u0111\u1EC3 v\xE0o checkout. Zapee kh\xF4ng b\u1EA5m h\u1ED9."
      );
      return;
    }
    phase = "continue";
    setBubble(
      "coop-cart-continue-wait",
      "B\u01B0\u1EDBc 2/2 gi\u1ECF: T\xECm n\xFAt TI\u1EBEP T\u1EE4C \u1EDF cu\u1ED1i gi\u1ECF \u2014 b\u1EA1n t\u1EF1 b\u1EA5m. Zapee kh\xF4ng t\u1EF1 chuy\u1EC3n sang checkout."
    );
  }
  function tickWithGrace() {
    if (!enabled3) return;
    if (isCheckoutPath()) {
      tick3();
      return;
    }
    if (!isCartPath()) return;
    const modal = findMembershipModal();
    if (modal) {
      cartGuideStartedAt = 0;
      tick3();
      return;
    }
    if (phase === "membership" && !membershipStepDone) {
      markMembershipClosed();
      tick3();
      return;
    }
    if (!membershipStepDone) {
      if (!cartGuideStartedAt) cartGuideStartedAt = Date.now();
      if (Date.now() - cartGuideStartedAt < 2500) {
        phase = "idle";
        setBubble(
          "coop-cart-wait-membership",
          "\u0110ang ch\u1EDD th\xF4ng b\xE1o th\u1EBB th\xE0nh vi\xEAn (n\u1EBFu c\xF3). Sau \u0111\xF3 Zapee s\u1EBD h\u01B0\u1EDBng d\u1EABn b\u1EA5m \u0110\xF3ng / TI\u1EBEP T\u1EE4C."
        );
        return;
      }
      membershipStepDone = true;
      phase = "continue";
      lastBubbleKey2 = "";
    }
    tick3();
  }
  function startCoopCartGuide() {
    if (!isCoopHostCart()) return;
    enabled3 = true;
    ensureStyles4();
    installGhostGuard();
    window.addEventListener("scroll", onGuideScroll4, true);
    if (timer4 !== null) return;
    cartGuideStartedAt = 0;
    lastBubbleKey2 = "";
    timer4 = window.setInterval(() => tickWithGrace(), POLL_MS2);
    window.setTimeout(() => tickWithGrace(), 150);
  }
  function stopCoopCartGuide() {
    enabled3 = false;
    if (timer4 !== null) {
      window.clearInterval(timer4);
      timer4 = null;
    }
    clearDecorations();
    window.removeEventListener("scroll", onGuideScroll4, true);
    if (guideScrollTimer3 !== null) {
      window.clearTimeout(guideScrollTimer3);
      guideScrollTimer3 = null;
    }
    guideScrolling3 = false;
    lastBubbleKey2 = "";
    if (Date.now() >= continueBlockedUntil) {
      removeGhostGuard();
    }
  }
  function resetCoopCartGuide() {
    stopCoopCartGuide();
    phase = "idle";
    membershipStepDone = false;
    cartGuideStartedAt = 0;
    lastBubbleKey2 = "";
    continueBlockedUntil = 0;
    removeGhostGuard();
    for (const el of document.querySelectorAll("[data-zapee-close-armed]")) {
      delete el.dataset.zapeeCloseArmed;
    }
  }
  function isCoopHostCart() {
    try {
      return /(^|\.)cooponline\.vn$/i.test(location.hostname);
    } catch {
      return false;
    }
  }

  // src/content/coop-guidance-filter.ts
  function isCoopPreAccountGuidance(checkpointId, message) {
    const normalized = `${checkpointId} ${message}`.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
    return /quảng cáo|địa chỉ|cửa hàng gần nhất|coop-location|coop-ad|handle-address-popup/.test(normalized);
  }

  // src/content/media-popup.ts
  var ACTIVE_ATTR = "data-zapee-media-popup-active";
  var TARGET_ATTR = "data-zapee-media-popup-target";
  var activeSessionId2 = "";
  var activeConfig2 = null;
  var observer2 = null;
  var timer5 = null;
  var pollTimer2 = null;
  var markedLayer = null;
  var markedTarget = null;
  function visible7(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
  }
  function area(el) {
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height;
  }
  function findPopup(config) {
    const layers = Array.from(document.querySelectorAll(config.overlaySelector)).filter(visible7);
    const layer = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2).find((el) => layers.includes(el));
    if (!layer) return null;
    const rect = layer.getBoundingClientRect();
    if (rect.width < window.innerWidth * 0.7 || rect.height < window.innerHeight * 0.7) return null;
    if (config.excludeSelector && (layer.matches(config.excludeSelector) || layer.querySelector(config.excludeSelector))) return null;
    const text = layer.innerText.replace(/\s+/g, " ").toLocaleLowerCase();
    if (config.excludeText?.some((phrase) => phrase.trim() && text.includes(phrase.trim().toLocaleLowerCase()))) return null;
    const media = [layer, ...Array.from(layer.querySelectorAll(config.mediaSelector))].filter((el) => {
      if (!el.matches(config.mediaSelector) || !visible7(el)) return false;
      const rect2 = el.getBoundingClientRect();
      if (rect2.width < 160 || rect2.height < 100) return false;
      return el instanceof HTMLImageElement || el instanceof HTMLVideoElement || getComputedStyle(el).backgroundImage !== "none";
    }).sort((a, b) => area(b) - area(a))[0];
    if (!media) return null;
    let target = media;
    while (target.parentElement && target.parentElement !== layer) {
      const parent = target.parentElement;
      if (!visible7(parent) || area(parent) > area(media) * 1.5) break;
      target = parent;
    }
    return { layer, target };
  }
  function refreshMediaPopup() {
    if (!activeSessionId2 || !activeConfig2) return;
    let popup = null;
    try {
      popup = findPopup(activeConfig2);
    } catch {
    }
    if (markedTarget !== popup?.target) {
      markedTarget?.removeAttribute(TARGET_ATTR);
      markedTarget = popup?.target || null;
      markedTarget?.setAttribute(TARGET_ATTR, "true");
    }
    if (markedLayer !== popup?.layer) {
      markedLayer?.removeAttribute(ACTIVE_ATTR);
      markedLayer = popup?.layer || null;
      markedLayer?.setAttribute(ACTIVE_ATTR, "true");
    }
  }
  function scheduleRefresh() {
    if (timer5 !== null) return;
    timer5 = window.setTimeout(() => {
      timer5 = null;
      refreshMediaPopup();
    }, 80);
  }
  function resetMediaPopup(sessionId) {
    if (sessionId && activeSessionId2 && sessionId !== activeSessionId2) return;
    observer2?.disconnect();
    observer2 = null;
    if (timer5 !== null) window.clearTimeout(timer5);
    if (pollTimer2 !== null) window.clearInterval(pollTimer2);
    timer5 = null;
    pollTimer2 = null;
    markedTarget?.removeAttribute(TARGET_ATTR);
    markedLayer?.removeAttribute(ACTIVE_ATTR);
    markedTarget = null;
    markedLayer = null;
    activeSessionId2 = "";
    activeConfig2 = null;
  }
  function configureMediaPopup(sessionId, config) {
    resetMediaPopup();
    if (!sessionId || !config?.overlaySelector || !config.mediaSelector || !config.excludeSelector) return;
    activeSessionId2 = sessionId;
    activeConfig2 = config;
    refreshMediaPopup();
    observer2 = new MutationObserver(scheduleRefresh);
    observer2.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      // Our own marker changes do not trigger another observer pass.
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "src"]
    });
    pollTimer2 = window.setInterval(refreshMediaPopup, 400);
  }

  // src/content/coop-flow-guard.ts
  function shouldBlockCoopPreAccountNavigation(state) {
    if (!state.hasActiveOrderSession || state.authenticated || state.locationReady) return false;
    let url;
    try {
      url = new URL(state.targetUrl, "https://cooponline.vn/");
    } catch {
      return false;
    }
    const coopAccountOrAuth = /(^|\.)cooponline\.vn$/i.test(url.hostname) && /^\/(?:account|login|signup|dang-nhap)(?:\/|$)/i.test(url.pathname);
    const tekoAuth = /oauth-saigoncoop/i.test(url.hostname);
    return coopAccountOrAuth || tekoAuth;
  }
  function parseCoopUrl(targetUrl) {
    try {
      return new URL(targetUrl, "https://cooponline.vn/");
    } catch {
      return null;
    }
  }
  function shouldBlockCoopPostCheckoutRestartNavigation(state) {
    if (!state.checkoutReached) return false;
    const url = parseCoopUrl(state.targetUrl);
    if (!url || !/(^|\.)cooponline\.vn$/i.test(url.hostname)) return false;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/") return true;
    return /^\/(?:account|login|signup|dang-nhap)(?:\/|$)/i.test(url.pathname);
  }

  // src/content/order-session-gate.ts
  function hasValidatedOrderSession(validated, sessionId) {
    return validated && Boolean(String(sessionId || "").trim());
  }

  // src/content/index.ts
  var URL_CHANGE_EVENT = "zapee:urlchange";
  var OPEN_SIDEPANEL_ATTR = "data-zapee-open-sidepanel";
  var URL_CHANGE_DEBOUNCE_MS = 300;
  var PAYLOAD_KEY = "zapee_coop_order_payload";
  var FLOW_GATE_VERSION_KEY = "zapee_coop_flow_gate_version";
  var FLOW_GATE_VERSION = "2026-08-06-v5";
  var guidanceRevisionGuard = createGuidanceRevisionGuard();
  function zLog(...args) {
    try {
      console.warn("[Zapee:content]", ...args);
    } catch {
    }
  }
  zLog("content.js loaded", {
    href: typeof location !== "undefined" ? location.href : "",
    host: typeof location !== "undefined" ? location.hostname : "",
    isCoop: typeof location !== "undefined" ? /(^|\.)cooponline\.vn$/i.test(location.hostname) : false,
    t: Date.now()
  });
  var ACTIVE_SESSION_KEY = "zapee_coop_active_order_session";
  var AD_DISMISSED_SESSION_KEY = "zapee_coop_ad_dismissed_session";
  var LOCATION_READY_SESSION_KEY = "zapee_coop_location_ready_session";
  var AUTHENTICATED_SESSION_KEY = "zapee_coop_authenticated_session";
  var CHECKOUT_REACHED_SESSION_KEY = "zapee_coop_checkout_reached_session";
  var SIGNUP_OTP_SESSION_KEY = "zapee_coop_signup_otp_session";
  var FLOW_PHASE_SESSION_KEY = "zapee_coop_flow_phase";
  var EXEC_MODE_KEY = "zapee_coop_exec_mode";
  var ACCOUNT_MODE_KEY = "zapee_coop_account_mode";
  var BLOCKED_ACCOUNT_NAV_SESSION_KEY = "zapee_coop_blocked_account_nav_session";
  function normalizeExecMode(value) {
    return value === "auto" ? "auto" : "manual";
  }
  function storeExecMode(mode) {
    writeSessionValue(EXEC_MODE_KEY, mode);
  }
  function loadExecMode() {
    return normalizeExecMode(readSessionValue(EXEC_MODE_KEY));
  }
  var COOP_FLOW_PHASE_RANK = {
    seeding_location: 0,
    await_ad: 1,
    await_account: 2,
    await_login: 3,
    authenticated: 4,
    ordering: 5
  };
  var activeOrderSessionId = "";
  var activeOrderSessionValidated = false;
  function readSessionValue(key) {
    try {
      return String(sessionStorage.getItem(key) || "");
    } catch {
      return "";
    }
  }
  function writeSessionValue(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
    }
  }
  function initializeFlowGateVersion() {
    try {
      if (sessionStorage.getItem(FLOW_GATE_VERSION_KEY) === FLOW_GATE_VERSION) return;
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      sessionStorage.removeItem(AD_DISMISSED_SESSION_KEY);
      sessionStorage.removeItem(LOCATION_READY_SESSION_KEY);
      sessionStorage.removeItem(AUTHENTICATED_SESSION_KEY);
      sessionStorage.removeItem(CHECKOUT_REACHED_SESSION_KEY);
      sessionStorage.removeItem(SIGNUP_OTP_SESSION_KEY);
      sessionStorage.removeItem(FLOW_PHASE_SESSION_KEY);
      sessionStorage.removeItem(PAYLOAD_KEY);
      sessionStorage.removeItem(EXEC_MODE_KEY);
      sessionStorage.removeItem(ACCOUNT_MODE_KEY);
      sessionStorage.removeItem(BLOCKED_ACCOUNT_NAV_SESSION_KEY);
      sessionStorage.setItem(FLOW_GATE_VERSION_KEY, FLOW_GATE_VERSION);
      resetCoopSignupOnboarding();
      resetCoopLocationSessionState();
    } catch {
    }
  }
  initializeFlowGateVersion();
  if (isCoopHost()) disableCoopProfileModal();
  function setActiveOrderSession(sessionId) {
    const next = String(sessionId || "").trim();
    if (!next) return false;
    const previous = currentOrderSessionId();
    const changed = previous !== next;
    if (changed) {
      try {
        sessionStorage.removeItem(AD_DISMISSED_SESSION_KEY);
        sessionStorage.removeItem(LOCATION_READY_SESSION_KEY);
        sessionStorage.removeItem(AUTHENTICATED_SESSION_KEY);
        sessionStorage.removeItem(CHECKOUT_REACHED_SESSION_KEY);
        sessionStorage.removeItem(SIGNUP_OTP_SESSION_KEY);
        sessionStorage.removeItem(FLOW_PHASE_SESSION_KEY);
        sessionStorage.removeItem(PAYLOAD_KEY);
        sessionStorage.removeItem(EXEC_MODE_KEY);
        sessionStorage.removeItem(ACCOUNT_MODE_KEY);
        sessionStorage.removeItem(BLOCKED_ACCOUNT_NAV_SESSION_KEY);
        resetCoopLocationSessionState();
        resetCoopSignupOnboarding();
      } catch {
      }
      delete document.documentElement.dataset.zapeeCoopAdDismissed;
      delete document.documentElement.dataset.zapeeCoopLocationReady;
      delete document.documentElement.dataset.zapeeCoopAuthenticated;
      delete document.documentElement.dataset.zapeeCoopCheckoutReached;
      delete document.documentElement.dataset.zapeeCoopFlowPhase;
    }
    activeOrderSessionId = next;
    activeOrderSessionValidated = true;
    writeSessionValue(ACTIVE_SESSION_KEY, next);
    if (readSessionValue(AUTHENTICATED_SESSION_KEY) !== next) {
      delete document.documentElement.dataset.zapeeCoopAuthenticated;
    }
    if (readSessionValue(AD_DISMISSED_SESSION_KEY) !== next) {
      delete document.documentElement.dataset.zapeeCoopAdDismissed;
    }
    if (readSessionValue(LOCATION_READY_SESSION_KEY) !== next) {
      delete document.documentElement.dataset.zapeeCoopLocationReady;
    }
    if (readSessionValue(CHECKOUT_REACHED_SESSION_KEY) !== next) {
      delete document.documentElement.dataset.zapeeCoopCheckoutReached;
    }
    return changed;
  }
  function currentOrderSessionId() {
    return activeOrderSessionId || readSessionValue(ACTIVE_SESSION_KEY);
  }
  function hasActiveOrderSession() {
    return hasValidatedOrderSession(activeOrderSessionValidated, currentOrderSessionId());
  }
  function clearActiveOrderSession() {
    activeOrderSessionId = "";
    activeOrderSessionValidated = false;
    try {
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      sessionStorage.removeItem(AD_DISMISSED_SESSION_KEY);
      sessionStorage.removeItem(LOCATION_READY_SESSION_KEY);
      sessionStorage.removeItem(AUTHENTICATED_SESSION_KEY);
      sessionStorage.removeItem(CHECKOUT_REACHED_SESSION_KEY);
      sessionStorage.removeItem(SIGNUP_OTP_SESSION_KEY);
      sessionStorage.removeItem(FLOW_PHASE_SESSION_KEY);
      sessionStorage.removeItem(PAYLOAD_KEY);
      sessionStorage.removeItem(EXEC_MODE_KEY);
      sessionStorage.removeItem(ACCOUNT_MODE_KEY);
      sessionStorage.removeItem(BLOCKED_ACCOUNT_NAV_SESSION_KEY);
      resetCoopLocationSessionState();
    } catch {
    }
    delete document.documentElement.dataset.zapeeCoopAdDismissed;
    delete document.documentElement.dataset.zapeeCoopLocationReady;
    delete document.documentElement.dataset.zapeeCoopAuthenticated;
    delete document.documentElement.dataset.zapeeCoopCheckoutReached;
    delete document.documentElement.dataset.zapeeCoopFlowPhase;
    resetCoopSignupOnboarding();
  }
  function readCoopFlowPhase() {
    const raw = readSessionValue(FLOW_PHASE_SESSION_KEY);
    return raw === "await_ad" || raw === "seeding_location" || raw === "await_account" || raw === "await_login" || raw === "authenticated" || raw === "ordering" ? raw : "";
  }
  function writeCoopFlowPhase(phase2) {
    const current = readCoopFlowPhase();
    if (current && COOP_FLOW_PHASE_RANK[current] > COOP_FLOW_PHASE_RANK[phase2]) {
      return;
    }
    writeSessionValue(FLOW_PHASE_SESSION_KEY, phase2);
    document.documentElement.dataset.zapeeCoopFlowPhase = phase2;
  }
  function wasAdDismissedForActiveSession() {
    const sessionId = currentOrderSessionId();
    return Boolean(sessionId) && readSessionValue(AD_DISMISSED_SESSION_KEY) === sessionId;
  }
  function isAuthenticatedForActiveSession() {
    const sessionId = currentOrderSessionId();
    return Boolean(sessionId) && readSessionValue(AUTHENTICATED_SESSION_KEY) === sessionId;
  }
  function isLocationReadyForActiveSession() {
    const sessionId = currentOrderSessionId();
    return Boolean(sessionId) && readSessionValue(LOCATION_READY_SESSION_KEY) === sessionId;
  }
  function isCheckoutReachedForActiveSession() {
    const sessionId = currentOrderSessionId();
    return Boolean(sessionId) && readSessionValue(CHECKOUT_REACHED_SESSION_KEY) === sessionId;
  }
  function persistCoopCheckoutReached() {
    const sessionId = currentOrderSessionId();
    if (!sessionId) return;
    writeSessionValue(CHECKOUT_REACHED_SESSION_KEY, sessionId);
    document.documentElement.dataset.zapeeCoopCheckoutReached = "true";
    writeCoopFlowPhase("ordering");
  }
  function wasPrematureAccountNavigationBlocked() {
    const sessionId = currentOrderSessionId();
    return Boolean(sessionId) && readSessionValue(BLOCKED_ACCOUNT_NAV_SESSION_KEY) === sessionId;
  }
  function clearPrematureAccountNavigationBlock() {
    try {
      sessionStorage.removeItem(BLOCKED_ACCOUNT_NAV_SESSION_KEY);
    } catch {
    }
  }
  function restoreCompletedCoopGates() {
    if (wasAdDismissedForActiveSession()) {
      document.documentElement.dataset.zapeeCoopAdDismissed = "true";
    }
    if (isLocationReadyForActiveSession()) {
      document.documentElement.dataset.zapeeCoopLocationReady = "true";
    }
    if (isAuthenticatedForActiveSession()) {
      document.documentElement.dataset.zapeeCoopAuthenticated = "true";
      writeCoopFlowPhase("authenticated");
    }
    if (isCheckoutReachedForActiveSession()) {
      document.documentElement.dataset.zapeeCoopCheckoutReached = "true";
      writeCoopFlowPhase("ordering");
    } else if (!isAuthenticatedForActiveSession() && !isLocationReadyForActiveSession()) {
      writeSessionValue(FLOW_PHASE_SESSION_KEY, "seeding_location");
      document.documentElement.dataset.zapeeCoopFlowPhase = "seeding_location";
    } else if (!wasAdDismissedForActiveSession()) {
      writeCoopFlowPhase("await_ad");
    } else {
      writeCoopFlowPhase("await_account");
    }
    if (wasAdDismissedForActiveSession() || isAuthenticatedForActiveSession()) {
      delete document.documentElement.dataset.zapeeCoopAdVisible;
    }
  }
  function isProtectedCoopOrderOp(message) {
    if (!isCoopHost()) return false;
    if (message.kind === "navigate") {
      const target = String(message.url || "");
      return /cooponline\.vn\/(?:cart|checkout)(?:[/?#]|$)/i.test(target) || /cooponline\.vn\/[^?#]*--s\d+/i.test(target);
    }
    if (/--s\d+/i.test(location.pathname)) {
      return message.kind === "click" || message.kind === "fill" || message.kind === "press";
    }
    const locatorText = JSON.stringify(message.locator || {});
    return message.kind === "click" && /Thêm vào giỏ|Mua ngay|add.{0,4}(?:to.{0,4})?cart/i.test(locatorText);
  }
  function isAlwaysShowHost() {
    return isCoopHost() || /(^|\.)bachhoaxanh\.com$/i.test(location.hostname);
  }
  var booted = false;
  var orderPayload = null;
  function storeOrderPayload(payload) {
    if (!payload) return;
    orderPayload = payload;
    try {
      sessionStorage.setItem(PAYLOAD_KEY, JSON.stringify(payload));
    } catch {
    }
  }
  function clearOrderPayload() {
    orderPayload = null;
    try {
      sessionStorage.removeItem(PAYLOAD_KEY);
    } catch {
    }
  }
  function loadOrderPayload() {
    if (orderPayload) return orderPayload;
    try {
      const raw = sessionStorage.getItem(PAYLOAD_KEY);
      if (!raw) return null;
      orderPayload = JSON.parse(raw);
      return orderPayload;
    } catch {
      return null;
    }
  }
  function valueFromPayloadPath(payload, path) {
    if (!payload || !path) return "";
    const parts = path.split(".").filter(Boolean);
    if (parts[0] === "payload") parts.shift();
    let current = payload;
    for (const part of parts) {
      if (!current || typeof current !== "object") return "";
      current = current[part];
    }
    return current === void 0 || current === null ? "" : String(current).trim();
  }
  function productsFromPayload(payload) {
    const raw = Array.isArray(payload.products) ? payload.products : Array.isArray(payload.items) ? payload.items : [];
    return raw.map((p) => ({
      url: typeof p.url === "string" ? p.url : typeof p.productUrl === "string" ? p.productUrl : void 0,
      qty: Math.max(1, Math.min(20, Number(p.qty ?? p.quantity ?? 1) || 1)),
      name: typeof p.name === "string" ? p.name : void 0
    }));
  }
  async function maybeSetProductQtyFromOrder() {
    if (!isCoopHost()) return;
    const payload = loadOrderPayload();
    if (!payload) return;
    const products = productsFromPayload(payload);
    const match = products.find((p) => p.url && pageMatchesProductUrl(p.url));
    if (!match) return;
    await setCoopProductQty(match.qty || 1);
  }
  async function maybeFillCheckout() {
    if (!isCoopHost() || !/\/checkout/i.test(location.pathname)) return;
    if (isCoopCheckoutFillComplete()) return;
    if (isCoopCheckoutFillRunning()) return;
    persistCoopCheckoutReached();
    markCoopCheckoutLanded();
    const payload = loadOrderPayload() || {};
    await runCoopCheckoutFill(payload);
  }
  var checkoutPollTimer = null;
  var checkoutKickTimer = null;
  function startCheckoutFillPolling() {
    if (!isCoopHost()) return;
    if (!/\/checkout/i.test(location.pathname)) {
      stopCheckoutFillPolling();
      return;
    }
    persistCoopCheckoutReached();
    markCoopCheckoutLanded();
    if (checkoutPollTimer !== null) return;
    if (checkoutKickTimer !== null) window.clearTimeout(checkoutKickTimer);
    checkoutKickTimer = window.setTimeout(() => {
      checkoutKickTimer = null;
      void maybeFillCheckout();
    }, 2800);
    checkoutPollTimer = window.setInterval(() => {
      if (!/\/checkout/i.test(location.pathname)) {
        stopCheckoutFillPolling();
        return;
      }
      if (isCoopCheckoutFillComplete()) {
        stopCheckoutFillPolling();
        return;
      }
      if (isCoopCheckoutFillRunning()) return;
      void maybeFillCheckout();
    }, 2800);
  }
  function stopCheckoutFillPolling() {
    if (checkoutPollTimer !== null) {
      window.clearInterval(checkoutPollTimer);
      checkoutPollTimer = null;
    }
    if (checkoutKickTimer !== null) {
      window.clearTimeout(checkoutKickTimer);
      checkoutKickTimer = null;
    }
  }
  async function maybeReconcileCartQtys() {
    if (!isCoopHost() || !/\/cart/i.test(location.pathname)) return;
    const payload = loadOrderPayload();
    if (!payload) return;
    const products = productsFromPayload(payload);
    if (!products.length) return;
    await reconcileOrderQtysOnCart(products);
  }
  var liveCartTimer = null;
  var lastLiveCartKey = "";
  var liveCartDebounce = null;
  var liveCartObserver = null;
  var liveCartListenersOn = false;
  function maybeSyncLiveCart(force = false) {
    if (!isCoopHost()) return;
    if (!/\/(cart|checkout)/i.test(location.pathname)) return;
    const snap = readCoopLiveCart();
    if (!snap) return;
    const sessionId = currentOrderSessionId();
    if (!sessionId) return;
    const key = JSON.stringify({
      s: snap.source,
      t: snap.total,
      i: snap.items.map((x) => [x.name, x.qty, x.lineTotal, x.unitPrice, x.sku])
    });
    if (!force && key === lastLiveCartKey) return;
    lastLiveCartKey = key;
    safeRuntimeSend({
      type: "zapee_live_cart",
      sessionId,
      items: snap.items,
      total: snap.total,
      source: snap.source
    });
  }
  function scheduleLiveCartSync(reason) {
    if (!isCoopHost()) return;
    if (!/\/(cart|checkout)/i.test(location.pathname)) return;
    if (liveCartDebounce !== null) window.clearTimeout(liveCartDebounce);
    liveCartDebounce = window.setTimeout(() => {
      liveCartDebounce = null;
      maybeSyncLiveCart(reason === "pageshow" || reason === "force" || reason === "load");
    }, 450);
  }
  function onLiveCartUserEvent() {
    maybeSyncLiveCart();
    scheduleLiveCartSync("user");
  }
  function startLiveCartPolling() {
    if (!isCoopHost()) return;
    if (!liveCartListenersOn) {
      liveCartListenersOn = true;
      document.addEventListener("click", onLiveCartUserEvent, true);
      document.addEventListener("change", onLiveCartUserEvent, true);
      document.addEventListener("input", onLiveCartUserEvent, true);
      window.addEventListener("pageshow", () => scheduleLiveCartSync("pageshow"));
    }
    if (!liveCartObserver && /\/(cart|checkout)/i.test(location.pathname)) {
      liveCartObserver = new MutationObserver((records) => {
        if (!/\/(cart|checkout)/i.test(location.pathname)) return;
        const changed = records.some(
          (r) => r.addedNodes.length || r.removedNodes.length || r.type === "characterData"
        );
        if (changed) scheduleLiveCartSync("dom-change");
      });
      const root = document.querySelector("main") || document.body || document.documentElement;
      liveCartObserver.observe(root, { childList: true, subtree: true, characterData: true });
    }
    if (liveCartTimer !== null) return;
    liveCartTimer = window.setInterval(() => {
      if (!/\/(cart|checkout)/i.test(location.pathname)) return;
      maybeSyncLiveCart(false);
    }, 1500);
    scheduleLiveCartSync("load");
  }
  function stopLiveCartPolling() {
    if (liveCartTimer !== null) {
      window.clearInterval(liveCartTimer);
      liveCartTimer = null;
    }
    if (liveCartDebounce !== null) {
      window.clearTimeout(liveCartDebounce);
      liveCartDebounce = null;
    }
    if (liveCartObserver) {
      liveCartObserver.disconnect();
      liveCartObserver = null;
    }
    lastLiveCartKey = "";
  }
  var pendingCoopLocationPayload = null;
  var coopLocationFlowStarted = false;
  var coopAccountNavigationFallbackTimer = null;
  function isCoopAccountPath() {
    return /\/account(?:\/|$)/i.test(location.pathname);
  }
  function isCoopAccountOrAuthPath() {
    return isCoopAccountPath() || /oauth-saigoncoop|\/(?:dang-nhap|login|signup)(?:[/?#]|$)/i.test(location.href);
  }
  function isCoopLoginSurfaceVisible() {
    return /oauth-saigoncoop|\/(?:dang-nhap|login|signup|forgot|quen-mat-khau)(?:[/?#]|$)/i.test(location.href) || /forgot|reset[-/]?password|quen-mat-khau|recover/i.test(location.href) || Boolean(document.querySelector(
      "input[type='password'], input[type='tel'], input[name*='username'], input[placeholder*='S\u1ED1 \u0111i\u1EC7n tho\u1EA1i'], input[placeholder*='s\u1ED1 \u0111i\u1EC7n tho\u1EA1i' i]"
    ));
  }
  function clearCoopAccountNavigationFallback() {
    if (coopAccountNavigationFallbackTimer !== null) {
      window.clearTimeout(coopAccountNavigationFallbackTimer);
      coopAccountNavigationFallbackTimer = null;
    }
  }
  function scheduleCoopAccountNavigationFallback() {
    clearCoopAccountNavigationFallback();
    coopAccountNavigationFallbackTimer = window.setTimeout(() => {
      coopAccountNavigationFallbackTimer = null;
      if (!currentOrderSessionId() || isAuthenticatedForActiveSession() || !isLocationReadyForActiveSession() || isCoopAccountOrAuthPath() || isCheckoutReachedForActiveSession() || /\/(?:cart|checkout)(?:\/|$)|--s\d+/i.test(location.pathname)) return;
      markAccountNavDone();
      location.assign("https://cooponline.vn/account");
    }, 1800);
  }
  function normalizeLocationValue(value) {
    return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
  }
  function hasMatchingCoopLocationStorage() {
    const payload = loadOrderPayload();
    if (!payload) return false;
    const checkoutSource = payload.storeContext || payload.checkout;
    const checkout = checkoutSource && typeof checkoutSource === "object" ? checkoutSource : null;
    const terminalCode = String(checkout?.terminalCode || "").trim();
    const expectedAddress = normalizeLocationValue(
      (payload.shippingAddress && typeof payload.shippingAddress === "object" ? payload.shippingAddress.fullAddress || payload.shippingAddress.addressLine : "") || payload.buyerAddress || payload.address || (payload.buyer && typeof payload.buyer === "object" ? payload.buyer.address : "")
    );
    if (!terminalCode || !expectedAddress) return false;
    try {
      const storedTerminal = String(localStorage.getItem("TERMINAL") || "").trim();
      const storedLocation = JSON.parse(localStorage.getItem("USER_LOCATION") || "null");
      const storedAddress = normalizeLocationValue(storedLocation?.fullAddress || storedLocation?.address);
      return storedTerminal === terminalCode && storedAddress === expectedAddress;
    } catch {
      return false;
    }
  }
  function hasCompletedCoopPreAccountGate() {
    if (isAuthenticatedForActiveSession() || isCoopAccountAuthenticated()) {
      return true;
    }
    if (document.documentElement.dataset.zapeeCoopAuthenticated === "true") {
      return true;
    }
    return isLocationReadyForActiveSession() || hasMatchingCoopLocationStorage() || document.documentElement.dataset.zapeeCoopLocationReady === "true";
  }
  function settleCoopPreAccountFlow() {
    pendingCoopLocationPayload = null;
    coopLocationFlowStarted = true;
    delete document.documentElement.dataset.zapeeCoopAdVisible;
    stopCoopAdGuide();
  }
  function shouldSuppressStaleCoopMessage(checkpointId, message) {
    if (!isCoopHost()) return false;
    const normalized = `${checkpointId} ${message}`.toLocaleLowerCase("vi");
    const cartGuideNarration = /dismiss-membership-notice|prepare-checkout|bước\s*[12]\/2\s*giỏ|popup thẻ thành viên|thông báo thẻ thành viên|đóng popup.*tiếp tục|tiếp tục.*checkout/.test(normalized);
    if (/\/cart(?:\/|$|\?)/i.test(location.pathname) && cartGuideNarration) return true;
    const preAccountMessage = isCoopPreAccountGuidance(checkpointId, message);
    if (hasCompletedCoopPreAccountGate() && preAccountMessage) return true;
    const phase2 = readCoopFlowPhase();
    if (loadExecMode() === "auto" && phase2 === "await_ad" && preAccountMessage) return true;
    const loginMessage = /otp|mật khẩu|sđt|số điện thoại|đăng nhập|xác nhận tài khoản|enter-phone|enter-password|enter-otp|wait-account-ready/.test(normalized);
    if ((isAuthenticatedForActiveSession() || isCoopAccountAuthenticated()) && loginMessage) return true;
    if (preAccountMessage && phase2 && phase2 !== "await_ad" && phase2 !== "seeding_location") return true;
    if (loginMessage && phase2 && phase2 !== "await_login" && phase2 !== "await_account") return true;
    return isCoopAccountPath() && isLocationReadyForActiveSession() && !isCoopLoginSurfaceVisible() && loginMessage;
  }
  function continueCoopLocationFlow(message) {
    if (isAuthenticatedForActiveSession() || isCoopAccountAuthenticated()) {
      settleCoopPreAccountFlow();
      return;
    }
    const locationReady = isLocationReadyForActiveSession() || hasMatchingCoopLocationStorage() || document.documentElement.dataset.zapeeCoopLocationReady === "true";
    if (locationReady) {
      const sessionId = currentOrderSessionId();
      if (sessionId) writeSessionValue(LOCATION_READY_SESSION_KEY, sessionId);
      document.documentElement.dataset.zapeeCoopLocationReady = "true";
      coopLocationFlowStarted = true;
      continueCoopAfterLocation();
      return;
    }
    if (coopLocationFlowStarted || !pendingCoopLocationPayload) return;
    coopLocationFlowStarted = true;
    writeCoopFlowPhase("seeding_location");
    showGuidance({ checkpointId: "coop-location", message });
    applyCoopLocationSeed(pendingCoopLocationPayload);
  }
  function completeOptionalCoopPromoGate() {
    const sessionId = currentOrderSessionId();
    zLog("completeOptionalCoopPromoGate", {
      sessionId,
      hasPendingPayload: Boolean(pendingCoopLocationPayload),
      hasStoredPayload: Boolean(loadOrderPayload()),
      phase: readCoopFlowPhase()
    });
    if (sessionId) {
      writeSessionValue(AD_DISMISSED_SESSION_KEY, sessionId);
    }
    document.documentElement.dataset.zapeeCoopAdDismissed = "true";
    delete document.documentElement.dataset.zapeeCoopAdVisible;
    if (isCheckoutReachedForActiveSession()) return;
    if (isAuthenticatedForActiveSession() || isCoopAccountAuthenticated()) {
      settleCoopPreAccountFlow();
      return;
    }
    if (!isLocationReadyForActiveSession()) {
      pendingCoopLocationPayload ||= loadOrderPayload();
      coopLocationFlowStarted = false;
      continueCoopLocationFlow("Zapee \u0111ang n\u1EA1p l\u1EA1i \u0111\u1ECBa ch\u1EC9 tr\u01B0\u1EDBc khi ki\u1EC3m tra t\xE0i kho\u1EA3n Co.op.");
      return;
    }
    writeCoopFlowPhase("await_account");
    settleCoopPreAccountFlow();
    clearGuidance();
    if (wasPrematureAccountNavigationBlocked() && !isCoopAccountOrAuthPath()) {
      clearPrematureAccountNavigationBlock();
      markAccountNavDone();
      location.assign("https://cooponline.vn/account");
    } else {
      scheduleCoopAccountNavigationFallback();
    }
  }
  function continueCoopAfterLocation() {
    if (!isCoopHost() || !isLocationReadyForActiveSession()) return;
    if (isCheckoutReachedForActiveSession()) return;
    stopCoopAdGuide();
    completeOptionalCoopPromoGate();
  }
  function startCoopLocationBeforeAccount(payload) {
    if (isCheckoutReachedForActiveSession()) return;
    zLog("startCoopLocationBeforeAccount", {
      hasPayload: Boolean(payload),
      authSession: isAuthenticatedForActiveSession(),
      authDom: isCoopAccountAuthenticated(),
      adDismissed: wasAdDismissedForActiveSession(),
      phase: readCoopFlowPhase(),
      url: location.href
    });
    if (!isCoopHost() || !payload) return;
    restoreCompletedCoopGates();
    pendingCoopLocationPayload = payload;
    if (isAuthenticatedForActiveSession() || isCoopAccountAuthenticated()) {
      zLog("skip ad: already authenticated");
      settleCoopPreAccountFlow();
      maybeNotifyAccountReady();
      return;
    }
    writeCoopFlowPhase("seeding_location");
    continueCoopLocationFlow("Zapee \u0111ang n\u1EA1p \u0111\u1ECBa ch\u1EC9 v\xE0 c\u1EEDa h\xE0ng g\u1EA7n nh\u1EA5t v\xE0o Co.op.");
  }
  function applyCoopLocationSeed(payload) {
    if (!isCoopHost() || !payload) return;
    const result = bootstrapCoopLocation(payload);
    if (result.message && (result.reloaded || result.goAccount || !result.ready)) {
      showGuidance({ checkpointId: "coop-location", message: result.message });
    }
    if (result.reloaded) {
      window.setTimeout(() => {
        location.reload();
      }, 80);
      return;
    }
    if (result.ready) {
      const sessionId = currentOrderSessionId();
      if (sessionId) {
        writeSessionValue(LOCATION_READY_SESSION_KEY, sessionId);
      }
      document.documentElement.dataset.zapeeCoopLocationReady = "true";
      continueCoopAfterLocation();
    }
  }
  function persistCoopAccountMode(mode) {
    const sessionId = currentOrderSessionId();
    if (sessionId) writeSessionValue(ACCOUNT_MODE_KEY, `${sessionId}:${mode}`);
    const current = loadOrderPayload() || {};
    storeOrderPayload({ ...current, accountMode: mode });
    if (sessionId) {
      safeRuntimeSend({
        type: "zapee_patch_order_payload",
        sessionId,
        accountMode: mode
      });
    }
  }
  function resolvedCoopAccountMode(payload) {
    const sessionId = currentOrderSessionId();
    const stored = readSessionValue(ACCOUNT_MODE_KEY);
    if (sessionId && stored.startsWith(`${sessionId}:`)) {
      const mode = stored.slice(sessionId.length + 1);
      if (mode === "register" || mode === "login") return mode;
    }
    return String(payload?.accountMode || "").toLowerCase() === "register" ? "register" : "login";
  }
  function applyCoopLoginGuide(payload) {
    if (!payload) return;
    storeOrderPayload(payload);
    const phone2 = String(payload.buyerPhone || payload.phone || "").trim();
    if (!phone2) return;
    writeCoopFlowPhase("await_login");
    const accountMode = resolvedCoopAccountMode(payload);
    startCoopLoginGuide({
      phone: phone2,
      execMode: loadExecMode(),
      accountMode,
      onSignupOtpVisible: () => {
        const sessionId = currentOrderSessionId();
        if (sessionId) writeSessionValue(SIGNUP_OTP_SESSION_KEY, sessionId);
      },
      onAccountModeChange: persistCoopAccountMode
    });
  }
  function shouldVerifyCompletedSignup(payload) {
    const sessionId = currentOrderSessionId();
    return Boolean(
      sessionId && resolvedCoopAccountMode(payload) === "register" && readSessionValue(SIGNUP_OTP_SESSION_KEY) === sessionId && !/\/(?:account|signup|login|dang-nhap)(?:[/?#]|$)/i.test(location.href)
    );
  }
  function hasPendingSignupOnboarding(payload) {
    const sessionId = currentOrderSessionId();
    const currentPayload = payload || orderPayload || loadOrderPayload();
    return Boolean(
      sessionId && resolvedCoopAccountMode(currentPayload || void 0) === "register" && readSessionValue(SIGNUP_OTP_SESSION_KEY) === sessionId
    );
  }
  function isCoopAccountAuthenticated() {
    if (!/\/account(?:\/|$|\?)/i.test(location.pathname)) return false;
    const text = String(document.body?.innerText || "").replace(/\s+/g, " ");
    const accountDomReady = /Thông tin tài khoản/i.test(text) && /Quản lý đơn hàng|Sổ địa chỉ|Đổi mật khẩu/i.test(text) && !document.querySelector("input[type='password']");
    if (!accountDomReady) return false;
    const sessionId = currentOrderSessionId();
    return refreshCoopSignupOnboarding(hasPendingSignupOnboarding(), sessionId).complete;
  }
  var accountReadySent = false;
  var accountReadyObserver = null;
  var accountReadyObserverTimer = null;
  function stopAccountReadyObserver() {
    accountReadyObserver?.disconnect();
    accountReadyObserver = null;
    if (accountReadyObserverTimer !== null) {
      window.clearTimeout(accountReadyObserverTimer);
      accountReadyObserverTimer = null;
    }
  }
  function maybeNotifyAccountReady() {
    if (!isCoopHost() || accountReadySent) return;
    if (!isCoopAccountAuthenticated()) return;
    delete document.documentElement.dataset.zapeeCoopAdVisible;
    document.documentElement.dataset.zapeeCoopAdDismissed = "true";
    document.documentElement.dataset.zapeeCoopLocationReady = "true";
    document.documentElement.dataset.zapeeCoopAuthenticated = "true";
    writeCoopFlowPhase("authenticated");
    pendingCoopLocationPayload = null;
    coopLocationFlowStarted = true;
    stopCoopAdGuide();
    stopCoopLoginGuide();
    const sessionId = currentOrderSessionId();
    if (!sessionId) return;
    accountReadySent = true;
    writeSessionValue(AD_DISMISSED_SESSION_KEY, sessionId);
    writeSessionValue(LOCATION_READY_SESSION_KEY, sessionId);
    writeSessionValue(AUTHENTICATED_SESSION_KEY, sessionId);
    safeRuntimeSend({
      type: "zapee_coop_account_ready",
      sessionId,
      url: location.href,
      authenticated: true
    });
  }
  function watchCoopAccountReady(payload) {
    if (!isCoopAccountPath()) {
      stopAccountReadyObserver();
      return;
    }
    if (isCoopAccountAuthenticated()) {
      maybeNotifyAccountReady();
      stopAccountReadyObserver();
      return;
    }
    if (isCoopLoginSurfaceVisible()) {
      applyCoopLoginGuide(payload);
      stopAccountReadyObserver();
      return;
    }
    if (accountReadyObserver) return;
    const inspect = () => {
      if (isCoopAccountAuthenticated()) {
        maybeNotifyAccountReady();
        stopAccountReadyObserver();
      } else if (isCoopLoginSurfaceVisible()) {
        applyCoopLoginGuide(payload);
        stopAccountReadyObserver();
      }
    };
    accountReadyObserver = new MutationObserver(inspect);
    accountReadyObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-hidden"]
    });
    if (!hasPendingSignupOnboarding(payload)) {
      accountReadyObserverTimer = window.setTimeout(stopAccountReadyObserver, 15e3);
    }
  }
  function resumeCoopAccountOrLogin(payload) {
    if (isCoopAccountPath()) {
      showGuidance({
        checkpointId: "coop-account-check",
        message: "Zapee \u0111ang ki\u1EC3m tra t\xE0i kho\u1EA3n v\xE0 \u0111\u1ECBa ch\u1EC9 m\u1EB7c \u0111\u1ECBnh tr\xEAn Co.op\u2026"
      });
    }
    if (isCoopAccountAuthenticated()) {
      maybeNotifyAccountReady();
      return;
    }
    if (shouldVerifyCompletedSignup(payload)) {
      writeCoopFlowPhase("await_account");
      location.assign("https://cooponline.vn/account");
      return;
    }
    if (isCoopLoginSurfaceVisible()) {
      applyCoopLoginGuide(payload);
      return;
    }
    if (!isCoopAccountPath()) return;
    writeCoopFlowPhase("await_account");
    stopCoopLoginGuide();
    watchCoopAccountReady(payload);
    for (const delay of [150, 400, 800, 1400, 2400, 4e3]) {
      window.setTimeout(() => {
        if (isCoopAccountAuthenticated()) {
          maybeNotifyAccountReady();
        } else if (isCoopLoginSurfaceVisible()) {
          applyCoopLoginGuide(payload);
        }
      }, delay);
    }
  }
  function bootLocalUi(force = false) {
    if (!isAlwaysShowHost()) return;
    if (booted && !force) {
      showBotLauncher();
      return;
    }
    booted = true;
    showBotLauncher();
  }
  function deactivateOrderGuidance() {
    guidanceRevisionGuard.advance();
    resetMediaPopup();
    clearGuidance();
    clearActiveOrderSession();
    clearOrderPayload();
    stopLiveCartPolling();
    stopCheckoutFillPolling();
    resetCoopCheckoutFill();
    resetCoopCartGuide();
    stopCoopLoginGuide();
    stopCoopAdGuide();
    pendingCoopLocationPayload = null;
    coopLocationFlowStarted = false;
    stopAccountReadyObserver();
    clearCoopAccountNavigationFallback();
  }
  bootLocalUi();
  if (hasActiveOrderSession()) {
    showBotLauncher("asking");
  }
  function safeRuntimeSend(message, callback) {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) {
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime?.lastError;
        callback?.(response);
      });
    } catch {
    }
  }
  document.addEventListener("click", (event) => {
    const source = event.target;
    const trigger = source instanceof Element ? source.closest(`[${OPEN_SIDEPANEL_ATTR}]`) : null;
    if (!trigger) return;
    zLog("real CTA click -> open side panel before retailer handoff");
    safeRuntimeSend({
      type: "zapee_open_sidepanel_now",
      entryUrl: trigger.getAttribute(OPEN_SIDEPANEL_ATTR) || void 0
    });
  }, true);
  safeRuntimeSend(
    {
      type: "zapee_content_ready",
      url: location.href
    },
    (response) => {
      const res = response;
      if (res?.sessionId) {
        setActiveOrderSession(res.sessionId);
        bootLocalUi();
      } else {
        deactivateOrderGuidance();
        if (isAlwaysShowHost()) bootLocalUi();
        else hideBotLauncher();
      }
    }
  );
  setLauncherClickHandler(() => {
    safeRuntimeSend({ type: "zapee_open_sidebar" });
  });
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case "zapee_dom_op":
        refreshMediaPopup();
        void (async () => {
          if (message.kind === "navigate" && shouldBlockCoopPostCheckoutRestartNavigation({
            checkoutReached: isCheckoutReachedForActiveSession(),
            targetUrl: String(message.url || "")
          })) {
            safeRuntimeSend({
              type: "zapee_dom_op_result",
              opId: message.opId,
              ok: false,
              error: "coop_checkout_locked",
              currentUrl: location.href
            });
            return;
          }
          if (message.kind === "navigate" && shouldBlockCoopPreAccountNavigation({
            targetUrl: String(message.url || ""),
            hasActiveOrderSession: Boolean(currentOrderSessionId()),
            authenticated: isAuthenticatedForActiveSession() || isCoopAccountAuthenticated(),
            locationReady: isLocationReadyForActiveSession() || hasMatchingCoopLocationStorage()
          })) {
            const sessionId = currentOrderSessionId();
            if (sessionId) writeSessionValue(BLOCKED_ACCOUNT_NAV_SESSION_KEY, sessionId);
            startCoopLocationBeforeAccount(loadOrderPayload() || void 0);
            safeRuntimeSend({
              type: "zapee_dom_op_result",
              opId: message.opId,
              ok: false,
              error: "coop_location_required",
              currentUrl: location.href
            });
            return;
          }
          if (isProtectedCoopOrderOp(message) && !isAuthenticatedForActiveSession()) {
            safeRuntimeSend({
              type: "zapee_dom_op_result",
              opId: message.opId,
              ok: false,
              error: "coop_auth_required",
              currentUrl: location.href
            });
            return;
          }
          if (isProtectedCoopOrderOp(message)) writeCoopFlowPhase("ordering");
          if (message.kind === "click" || message.kind === "fill") {
            await maybeSetProductQtyFromOrder();
          }
          if (isCoopHost() && message.kind === "click" && /Thêm vào giỏ|Mua ngay|add.{0,4}(?:to.{0,4})?cart/i.test(JSON.stringify(message.locator || {}))) {
            showAssistantMessage("Zapee \u0111ang t\xF4 s\xE1ng n\xFAt Th\xEAm v\xE0o gi\u1ECF \u2014 \u0111\u1EE3i m\u1ED9t ch\xFAt r\u1ED3i t\u1EF1 b\u1EA5m\u2026");
            await new Promise((r) => setTimeout(r, 2200));
          }
          const result = await executeDomOp(message);
          safeRuntimeSend(result);
        })();
        break;
      case "zapee_dom_guidance":
        if (isCoopHost() && currentOrderSessionId() && /^(?:confirm-signup-policy|wait-account-ready)$/.test(
          String(message.checkpointId || "")
        )) {
          refreshCoopSignupOnboarding(true, currentOrderSessionId());
        }
        if (message.presentation?.kind === "blocking") {
          guidanceRevisionGuard.advance();
          if (message.presentation.visible) {
            showBlockingPresentation({
              checkpointId: message.checkpointId,
              message: message.message,
              mascot: message.presentation.mascot,
              flow: message.flow
            });
          } else {
            hideBlockingPresentation(message.checkpointId);
          }
          break;
        }
        if (!shouldSuppressStaleCoopMessage(message.checkpointId, message.message)) {
          const guidanceRevision = guidanceRevisionGuard.advance();
          document.documentElement.dataset.zapeeGuidanceShown = message.checkpointId;
          const action = message.action && message.highlightLocator ? {
            label: message.action.label,
            onClick: () => {
              void (async () => {
                const actionValue = String(message.action?.value || "").trim() || valueFromPayloadPath(loadOrderPayload(), message.action?.valueRef);
                if (!actionValue) {
                  showGuidance({
                    checkpointId: message.checkpointId,
                    message: message.action?.failureMessage || "Ch\u01B0a c\xF3 d\u1EEF li\u1EC7u \u0111\u1EC3 d\xE1n v\xE0o trang.",
                    highlightLocator: message.highlightLocator,
                    targetNote: message.targetNote,
                    steps: message.steps,
                    flow: message.flow
                  });
                  return;
                }
                const fillLocator = guidanceFillLocator(message);
                if (!fillLocator) return;
                const result = await executeDomOp({
                  type: "zapee_dom_op",
                  opId: `guidance-fill-${message.checkpointId}-${Date.now()}`,
                  kind: "fill",
                  locator: fillLocator,
                  value: actionValue
                });
                if (!guidanceRevisionGuard.isCurrent(guidanceRevision)) return;
                if (result.ok) {
                  document.documentElement.dataset.zapeeGuidanceFilled = message.checkpointId;
                  const extras = Array.isArray(message.extraHighlights) ? message.extraHighlights : [];
                  const next = extras[0];
                  showGuidance({
                    checkpointId: message.checkpointId,
                    message: message.action?.successMessage || "\u0110\xE3 d\xE1n v\xE0o trang.",
                    highlightLocator: next?.locator || message.highlightLocator,
                    targetNote: next?.note || message.targetNote,
                    extraHighlights: next ? extras.slice(1) : extras,
                    steps: advanceCurrentStep(message.steps),
                    flow: message.flow
                  });
                  return;
                }
                showGuidance({
                  checkpointId: message.checkpointId,
                  message: message.action?.failureMessage || "Ch\u01B0a d\xE1n \u0111\u01B0\u1EE3c v\xE0o trang.",
                  highlightLocator: message.highlightLocator,
                  targetNote: message.targetNote,
                  extraHighlights: message.extraHighlights,
                  steps: message.steps,
                  flow: message.flow
                });
              })();
            }
          } : void 0;
          showGuidance({ ...message, action });
        }
        break;
      case "zapee_retailer_runtime_config":
        if (message.sessionId !== currentOrderSessionId()) break;
        if ("cart" in message.config) {
          configureRetailerLiveCart(message.sessionId, message.config.cart, (snapshot) => {
            safeRuntimeSend({ type: "zapee_live_cart", ...snapshot });
          });
        }
        if ("mediaPopup" in message.config) configureMediaPopup(message.sessionId, message.config.mediaPopup);
        break;
      case "zapee_session_start": {
        if (!String(message.sessionId || "").trim()) {
          deactivateOrderGuidance();
          if (isAlwaysShowHost()) bootLocalUi();
          break;
        }
        if (isCoopHost()) disableCoopProfileModal();
        const isNewSession = setActiveOrderSession(message.sessionId);
        zLog("zapee_session_start", {
          sessionId: message.sessionId,
          chain: message.chain,
          execMode: message.execMode,
          isNewSession,
          hasPayload: Boolean(message.payload),
          url: location.href
        });
        if (isNewSession) {
          guidanceRevisionGuard.advance();
          resetMediaPopup();
          stopLiveCartPolling();
          stopCheckoutFillPolling();
          resetCoopCheckoutFill();
          resetCoopCartGuide();
          clearOrderPayload();
          accountReadySent = false;
          pendingCoopLocationPayload = null;
          coopLocationFlowStarted = false;
          stopAccountReadyObserver();
          clearCoopAccountNavigationFallback();
          resetCoopAdGuideForNewSession();
          stopCoopLoginGuide();
          clearGuidance();
          try {
            sessionStorage.removeItem(AD_DISMISSED_SESSION_KEY);
          } catch {
          }
          delete document.documentElement.dataset.zapeeCoopAdDismissed;
          delete document.documentElement.dataset.zapeeCoopAdVisible;
          delete document.documentElement.dataset.zapeeGuidanceFilled;
          delete document.documentElement.dataset.zapeeGuidanceShown;
          writeCoopFlowPhase("seeding_location");
        }
        if (message.execMode === "auto" || message.execMode === "manual") {
          storeExecMode(message.execMode);
        } else if (!readSessionValue(EXEC_MODE_KEY)) {
          storeExecMode("manual");
        }
        storeOrderPayload(message.payload);
        if (hasMatchingCoopLocationStorage()) {
          const sessionId = currentOrderSessionId();
          if (sessionId) writeSessionValue(LOCATION_READY_SESSION_KEY, sessionId);
        }
        restoreCompletedCoopGates();
        if (/\/checkout/i.test(location.pathname) || message.payload?.coopCheckoutReached === true) {
          persistCoopCheckoutReached();
        }
        bootLocalUi();
        if (currentOrderSessionId()) {
          showBotLauncher("asking");
        }
        if (isCoopAccountPath() && !isCheckoutReachedForActiveSession()) {
          showGuidance({
            checkpointId: "coop-account-check",
            message: "Zapee \u0111ang ki\u1EC3m tra t\xE0i kho\u1EA3n v\xE0 \u0111\u1ECBa ch\u1EC9 m\u1EB7c \u0111\u1ECBnh tr\xEAn Co.op\u2026"
          });
        }
        const branch = isCheckoutReachedForActiveSession() ? "checkout-reached" : isCoopAccountAuthenticated() ? "authenticated-dom" : isAuthenticatedForActiveSession() ? "authenticated-session" : isLocationReadyForActiveSession() && wasAdDismissedForActiveSession() ? "location-ready-skip-ad" : "location-before-ad";
        zLog("session_start branch", {
          branch,
          phase: readCoopFlowPhase(),
          adDismissed: wasAdDismissedForActiveSession(),
          locationReady: isLocationReadyForActiveSession(),
          checkoutReached: isCheckoutReachedForActiveSession(),
          execMode: loadExecMode()
        });
        if (branch === "checkout-reached") {
          writeCoopFlowPhase("ordering");
        } else if (branch === "authenticated-dom") {
          const sessionId = currentOrderSessionId();
          if (sessionId) {
            writeSessionValue(LOCATION_READY_SESSION_KEY, sessionId);
            document.documentElement.dataset.zapeeCoopLocationReady = "true";
          }
          maybeNotifyAccountReady();
        } else if (branch === "authenticated-session") {
          document.documentElement.dataset.zapeeCoopAuthenticated = "true";
        } else if (branch === "location-ready-skip-ad") {
          document.documentElement.dataset.zapeeCoopLocationReady = "true";
          if (wasPrematureAccountNavigationBlocked() && !isCoopAccountOrAuthPath()) {
            clearPrematureAccountNavigationBlock();
            markAccountNavDone();
            location.assign("https://cooponline.vn/account");
          } else {
            resumeCoopAccountOrLogin(message.payload);
            if (!isCoopAccountOrAuthPath()) scheduleCoopAccountNavigationFallback();
          }
        } else {
          startCoopLocationBeforeAccount(message.payload);
        }
        window.setTimeout(() => maybeNotifyAccountReady(), 400);
        if (isCoopAccountPath()) watchCoopAccountReady(message.payload);
        window.setTimeout(() => {
          void maybeSetProductQtyFromOrder();
        }, 600);
        window.setTimeout(() => {
          void maybeReconcileCartQtys();
        }, 1e3);
        window.setTimeout(() => maybeSyncLiveCart(true), 1400);
        startLiveCartPolling();
        if (/\/cart/i.test(location.pathname)) {
          resetCoopCartGuide();
          startCoopCartGuide();
        } else {
          stopCoopCartGuide();
        }
        if (/\/checkout/i.test(location.pathname)) {
          persistCoopCheckoutReached();
          markCoopCheckoutLanded();
          startCheckoutFillPolling();
        } else {
          stopCheckoutFillPolling();
        }
        break;
      }
      case "zapee_hide_launcher":
        if (!hasActiveOrderSession()) deactivateOrderGuidance();
        if (isAlwaysShowHost()) bootLocalUi();
        else {
          hideBotLauncher();
          clearGuidance();
          stopCoopAdGuide();
        }
        break;
      case "zapee_assistant_message":
        if (!shouldSuppressStaleCoopMessage("assistant", message.message)) {
          showAssistantMessage(message.message);
        }
        break;
      case "zapee_order_completed":
        window.dispatchEvent(new CustomEvent("zapee:order-completed", {
          detail: {
            sessionId: message.sessionId,
            storeKey: message.storeKey,
            chain: message.chain,
            orderCode: message.orderCode,
            orderUrl: message.orderUrl
          }
        }));
        break;
      case "zapee_continue_next_store":
        window.dispatchEvent(new CustomEvent("zapee:continue-next-store", {
          detail: {
            sessionId: message.sessionId,
            storeKey: message.storeKey
          }
        }));
        // iOS: bridge-content.js đã post bản postMessage cho trang — thêm break
        // để không rơi xuống case dưới tạo bản postMessage trùng lặp.
        break;
      case "zapee_progress_event":
        window.postMessage({ source: "zapee-extension", ...message }, location.origin);
        break;
      case "zapee_session_end":
        if (message.sessionId && message.sessionId !== currentOrderSessionId()) break;
        guidanceRevisionGuard.advance();
        resetMediaPopup(message.sessionId);
        resetRetailerLiveCart(message.sessionId);
        clearGuidance();
        clearActiveOrderSession();
        clearOrderPayload();
        stopLiveCartPolling();
        stopCheckoutFillPolling();
        resetCoopCheckoutFill();
        resetCoopCartGuide();
        stopCoopLoginGuide();
        stopCoopCartGuide();
        pendingCoopLocationPayload = null;
        coopLocationFlowStarted = false;
        stopAccountReadyObserver();
        clearCoopAccountNavigationFallback();
        break;
      default:
        break;
    }
  });
  function patchHistoryMethod(methodName) {
    const original = history[methodName];
    history[methodName] = function historyPatch(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return result;
    };
  }
  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");
  var lastReportedUrl = location.href;
  var debounceTimer = null;
  function scheduleUrlChangeCheck() {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      if (location.href !== lastReportedUrl) {
        lastReportedUrl = location.href;
        accountReadySent = false;
        safeRuntimeSend({
          type: "zapee_url_changed",
          url: location.href
        });
        const activeOrder = hasActiveOrderSession();
        if (activeOrder) refreshRetailerLiveCart(250);
        if (isAlwaysShowHost()) showBotLauncher();
        if (activeOrder) window.setTimeout(() => maybeNotifyAccountReady(), 500);
        if (activeOrder && isCoopAccountPath()) watchCoopAccountReady(loadOrderPayload() || void 0);
        else stopAccountReadyObserver();
        if (activeOrder) window.setTimeout(() => {
          void maybeSetProductQtyFromOrder();
        }, 700);
        if (activeOrder && /\/checkout/i.test(location.pathname)) {
          stopCoopCartGuide();
          resetCoopCheckoutFill();
          persistCoopCheckoutReached();
          markCoopCheckoutLanded();
          startCheckoutFillPolling();
        } else {
          stopCheckoutFillPolling();
        }
        if (activeOrder && /\/cart/i.test(location.pathname)) {
          resetCoopCartGuide();
          startCoopCartGuide();
        } else if (!/\/checkout/i.test(location.pathname)) {
          stopCoopCartGuide();
        }
        if (activeOrder) {
          window.setTimeout(() => {
            void maybeReconcileCartQtys();
          }, 1200);
          window.setTimeout(() => maybeSyncLiveCart(true), 1600);
          window.setTimeout(() => maybeSyncLiveCart(true), 3200);
        }
        if (activeOrder && /\/(cart|checkout)/i.test(location.pathname)) startLiveCartPolling();
        else {
          stopLiveCartPolling();
          stopCheckoutFillPolling();
          stopCoopCartGuide();
          clearGuidance();
        }
      }
    }, URL_CHANGE_DEBOUNCE_MS);
  }
  if (isCoopHost()) {
    if (hasActiveOrderSession()) {
      loadOrderPayload();
      if (isCoopAccountPath()) watchCoopAccountReady(loadOrderPayload() || void 0);
      window.setTimeout(() => maybeNotifyAccountReady(), 800);
      window.setTimeout(() => maybeNotifyAccountReady(), 2500);
      window.setTimeout(() => {
        void maybeSetProductQtyFromOrder();
      }, 900);
      window.setTimeout(() => {
        void maybeReconcileCartQtys();
      }, 1200);
      window.setTimeout(() => maybeSyncLiveCart(true), 2e3);
      window.setTimeout(() => maybeSyncLiveCart(true), 4e3);
      if (/\/(cart|checkout)/i.test(location.pathname)) startLiveCartPolling();
      if (/\/cart/i.test(location.pathname)) startCoopCartGuide();
      if (/\/checkout/i.test(location.pathname)) {
        persistCoopCheckoutReached();
        markCoopCheckoutLanded();
        startCheckoutFillPolling();
      }
    }
    window.addEventListener("pageshow", () => {
      if (!hasActiveOrderSession()) {
        stopCoopCartGuide();
        stopCheckoutFillPolling();
        clearGuidance();
        return;
      }
      if (/\/cart/i.test(location.pathname)) startCoopCartGuide();
      if (/\/checkout/i.test(location.pathname) && !isCoopCheckoutFillComplete()) {
        persistCoopCheckoutReached();
        markCoopCheckoutLanded();
        startCheckoutFillPolling();
      }
    });
  }
  window.addEventListener(URL_CHANGE_EVENT, scheduleUrlChangeCheck);
  window.addEventListener("popstate", scheduleUrlChangeCheck);
  var titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(scheduleUrlChangeCheck).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
})();
