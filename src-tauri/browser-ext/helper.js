/* MaXMB Browser Helper — content script (document_start, all frames).
 *
 * Active ONLY in the XMB window (asks the background script first), so your
 * normal LibreWolf browsing is untouched. In the XMB window it:
 *   - reports text-field focus (with the field's current value) so the app can
 *     open its on-screen keyboard prefilled, and types the result back in;
 *   - reports the hovered link for the app's bottom status line;
 *   - makes the next-tab key (Tab) switch to the next tab;
 *   - asks the app for the XMB palm, fist (dragging) and click cursors. Arrow, text,
 *     link and move cursors are real Windows cursors the app swaps in, so the
 *     two sets share the same tip position.
 */
(function () {
  "use strict";
  if (window.__xmbHelper2) return;
  window.__xmbHelper2 = true;

  var api = typeof browser !== "undefined" ? browser : chrome;
  var on = false;
  var tabKey = "Tab";   // switches to the next tab (left to right, then around)

  function send(msg) {
    try { var p = api.runtime.sendMessage(msg); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  try {
    api.runtime.sendMessage({ type: "hello" }).then(function (r) {
      on = !!(r && r.xmb);
      if (r && typeof r.tabKey === "string") tabKey = r.tabKey;
    }, function () {});
  } catch (e) {}

  api.runtime.onMessage.addListener(function (m) {
    if (!m) return;
    if (m.type === "xmb-on") { on = true; if (typeof m.tabKey === "string") tabKey = m.tabKey; }
    else if (m.type === "xmb-key") { if (typeof m.tabKey === "string") tabKey = m.tabKey; }
    else if (m.type === "xmb-type" && on) doType(m);
  });

  // ---- the next-tab key (Tab): the next tab instead of the next link / field
  window.addEventListener("keydown", function (e) {
    if (!on || !tabKey || e.code !== tabKey || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    // (the app reads the key itself and changes the tab: here the page is
    // only kept from moving its focus to the next link / field)
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // ---- text fields ----------------------------------------------------------
  var TEXT_TYPES = ["text", "search", "url", "email", "tel", "password", "number", ""];
  function editable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === "TEXTAREA") return !el.readOnly && !el.disabled;
    if (tag === "INPUT") {
      var t = (el.getAttribute("type") || "text").toLowerCase();
      return TEXT_TYPES.indexOf(t) >= 0 && !el.readOnly && !el.disabled;
    }
    return !!el.isContentEditable;
  }
  function isTextControl(el) { return el.tagName === "INPUT" || el.tagName === "TEXTAREA"; }
  function isPassword(el) { return el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "password"; }

  var lastWinFocus = 0, lastEl = null;
  window.addEventListener("focus", function () { lastWinFocus = Date.now(); }, true);

  function reportFocus(el) {
    if (!on) return;
    if (el && editable(el)) {
      var ctl = isTextControl(el), pw = isPassword(el);
      send({
        type: "focus", focus: true,
        value: ctl && !pw ? String(el.value || "").slice(0, 2000) : "",
        replace: ctl, password: pw,
      });
    } else {
      send({ type: "focus", focus: false });
    }
  }
  document.addEventListener("focusin", function (e) {
    var el = e.target;
    if (!editable(el)) return;
    // the window getting re-activated re-focuses the same field: not a new request
    if (el === lastEl && Date.now() - lastWinFocus < 1000) return;
    lastEl = el;
    reportFocus(el);
  }, true);
  document.addEventListener("focusout", function () {
    setTimeout(function () { if (!editable(document.activeElement)) reportFocus(null); }, 40);
  }, true);
  // clicking a field that already has focus asks for the keyboard again
  document.addEventListener("click", function (e) {
    var el = e.target;
    if (on && editable(el) && document.activeElement === el) reportFocus(el);
  }, true);

  function pressEnter(el) {
    var o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    var notCancelled = el.dispatchEvent(new KeyboardEvent("keydown", o));
    el.dispatchEvent(new KeyboardEvent("keypress", o));
    el.dispatchEvent(new KeyboardEvent("keyup", o));
    if (notCancelled && el.tagName === "INPUT" && el.form) {
      try { el.form.requestSubmit(); } catch (e) { try { el.form.submit(); } catch (e2) {} }
    }
  }

  function doType(m) {
    var el = document.activeElement;
    if (!editable(el)) return;
    try { el.focus(); } catch (e) {}
    var text = String(m.text || "");
    if (isTextControl(el)) {
      var proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      var cur = String(el.value || ""), next;
      if (m.replace) next = text;
      else {
        var s = el.selectionStart != null ? el.selectionStart : cur.length;
        var t = el.selectionEnd != null ? el.selectionEnd : cur.length;
        next = cur.slice(0, s) + text + cur.slice(t);
      }
      setter.call(el, next);
      try { el.setSelectionRange(next.length, next.length); } catch (e) {}
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      if (m.replace) document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text);
    }
    if (m.enter) pressEnter(el);
  }

  // ---- hovered link (bottom status line) ------------------------------------
  var lastHref = null;
  document.addEventListener("mouseover", function (e) {
    if (!on) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    var h = a ? a.href : "";
    if (h !== lastHref) { lastHref = h; send({ type: "hover", href: h }); }
  }, true);

  // ---- palm / fist / click cursors --------------------------------------------
  // All of them are real Windows cursors the app swaps in (same size and tip as
  // the arrow and link finger): a palm where the page offers to grab, the
  // short-finger click while pressing something clickable, and the fist while
  // dragging. A page's own grab cursor is shown as the palm ("move" cursor).
  var grabEl = null, grabPrev = null, pressed = false, dragging = false, mode = "normal", downX = 0, downY = 0;
  function setMode(m) { if (m !== mode) { mode = m; send({ type: "cursor", mode: m }); } }
  function keyword(el) {
    try {
      var v = String(getComputedStyle(el).cursor || "");
      var parts = v.split(",");
      return parts[parts.length - 1].trim().toLowerCase();
    } catch (e) { return ""; }
  }
  function isGrab(k) { return k === "grab" || k === "-moz-grab" || k === "grabbing" || k === "-moz-grabbing"; }
  function clickable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (keyword(el) === "pointer") return true;
    return !!(el.closest && el.closest("a[href],button,summary,label,select,[role=button],[role=link],[role=tab],[role=menuitem],[onclick]," +
      "input[type=button],input[type=submit],input[type=reset],input[type=checkbox],input[type=radio],input[type=image]"));
  }
  function palmOff() {
    if (!grabEl) return;
    try { grabEl.style.removeProperty("cursor"); if (grabPrev && grabPrev.v) grabEl.style.setProperty("cursor", grabPrev.v, grabPrev.p); } catch (e) {}
    grabEl = null; grabPrev = null;
  }
  function palmOn(el) {
    if (grabEl === el) return;
    palmOff();
    try {
      grabPrev = { v: el.style.getPropertyValue("cursor"), p: el.style.getPropertyPriority("cursor") };
      el.style.setProperty("cursor", "move", "important");
      grabEl = el;
    } catch (e) {}
  }
  var rafPending = false, lastTarget = null;
  function update() {
    rafPending = false;
    var el = lastTarget;
    if (!on || !el || el.nodeType !== 1 || el === grabEl) return;
    palmOff();
    if (isGrab(keyword(el))) palmOn(el);
  }
  document.addEventListener("mousemove", function (e) {
    if (!on) return;
    if (pressed && !dragging && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) { dragging = true; setMode("grab"); }
    lastTarget = e.target;
    if (!rafPending) { rafPending = true; requestAnimationFrame(update); }
  }, true);
  document.addEventListener("mousedown", function (e) {
    if (!on || e.button !== 0) return;
    pressed = true; dragging = false; downX = e.clientX; downY = e.clientY;
    var el = e.target;
    if (el === grabEl || (el && el.nodeType === 1 && isGrab(keyword(el)))) { dragging = true; setMode("grab"); }
    else if (clickable(el)) setMode("click");
  }, true);
  function release() { pressed = false; dragging = false; setMode("normal"); }
  document.addEventListener("dragstart", function () { if (on && pressed) { dragging = true; setMode("grab"); } }, true);
  document.addEventListener("dragend", release, true);
  document.addEventListener("drop", release, true);
  document.addEventListener("mouseup", release, true);
  window.addEventListener("blur", function () { release(); palmOff(); }, true);
})();
