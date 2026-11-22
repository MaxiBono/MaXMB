// Custom Color: the colour wheel panel and the colour helpers (ui.js gathers every ui-*.js)
import { esc, holdAccel } from "./ui-core.js";
import { Confirm } from "./ui-pickers.js";
import { OnScreenKeyboard, VIRTUAL_KB } from "./ui-text.js";

// ------------------------------------------------------------ ColorPicker
// "Custom Color": a Turn-Off-style panel (two white rules) with a colour wheel
// in the middle, Red / Green / Blue sliders (0-255), an Opacity slider (0-1)
// and an editable hex code (#RRGGBB, or #RRGGBBAA when opacity < 1). The wheel,
// sliders and hex all stay in sync. Controller: up/down picks a row, left/right
// changes it (on the wheel: hue), Cross on the hex row edits it, Cross on the
// buttons OK / Cancel.
export function parseColor(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
export function colorHex({ r, g, b, a = 1 }) {
  const h2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return "#" + h2(r) + h2(g) + h2(b) + (a < 0.999 ? h2(a * 255) : "");
}
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export class ColorPicker {
  constructor(sfx) {
    this.sfx = sfx;
    this.el = document.createElement("div");
    this.el.className = "colorpick";
    document.body.appendChild(this.el);
    this.osk = new OnScreenKeyboard(sfx);
  }
  get isOpen() { return this.el.classList.contains("show"); }
  // opts: { title, value (hex), onPreview(hex) }, onDone(hex), onCancel()
  open({ title = "Custom Color", value = "#ffffff", onPreview = null } = {}, onDone, onCancel) {
    const c = parseColor(value) || { r: 255, g: 255, b: 255, a: 1 };
    this.c = c; this.title = title; this.onPreview = onPreview; this.onDone = onDone; this.onCancel = onCancel;
    this.row = 0; this.btn = 1; this._oskActive = false;   // buttons: 0 Cancel, 1 Confirm
    // (hue, saturation and brightness kept apart: a colour taken down to
    // black by Brightness keeps its hue and saturation for coming back up)
    const hsv = rgb2hsv(c.r, c.g, c.b); this.hue = hsv.h; this.sat = hsv.s; this.val = hsv.v;
    this.el.classList.add("show"); document.body.classList.add("menu-open");
    ColorPicker.active = this;
    this._render();
  }
  close() { this.el.classList.remove("show"); this.el.innerHTML = ""; this._oskActive = false; if (ColorPicker.active === this) ColorPicker.active = null; }
  // the red / green / blue changed directly (sliders, hex): hue, saturation and brightness follow
  _fromRgb() {
    const h = rgb2hsv(this.c.r, this.c.g, this.c.b);
    this.val = h.v;
    if (h.v > 0) { this.sat = h.s; if (h.s > 0) this.hue = h.h; }
  }
  // Right stick: move the point over the colour wheel (direction = hue,
  // distance from the centre = saturation), from wherever the cursor is
  onStick(x, y) {
    if (!this.isOpen || this._oskActive) { this._stickT = 0; return; }
    const dz = 0.18, mag = Math.hypot(x, y);
    if (mag < dz) { this._stickT = 0; return; }
    const now = performance.now();
    const dt = this._stickT ? Math.min(0.05, (now - this._stickT) / 1000) : 1 / 60;
    this._stickT = now;
    const k = Math.pow((mag - dz) / (1 - dz), 1.5) / mag;   // gentle near the centre
    const a = this.hue * Math.PI / 180;
    let px = Math.cos(a) * this.sat + x * k * dt * 1.1, py = Math.sin(a) * this.sat + y * k * dt * 1.1;
    const d = Math.hypot(px, py);
    if (d > 1) { px /= d; py /= d; }
    const s = Math.min(1, Math.hypot(px, py));
    if (s > 0.002) this.hue = (Math.atan2(py, px) * 180 / Math.PI + 360) % 360;
    this.sat = s; this.val = this.val || 1;
    Object.assign(this.c, hsv2rgb(this.hue, this.sat, this.val));
    if (this._rows()[this.row] !== "wheel") { this.row = 0; this._focus(); }
    this._sync(null);
  }
  _rows() { return ["wheel", "r", "g", "b", "v", "a", "hex", "buttons"]; }
  _render() {
    const c = this.c;
    const slider = (k, label, max, step, val, shown) => `<div class="cp-row" data-row="${k}">
        <span class="cp-lab">${label}</span>
        <input class="cp-range cp-${k}" data-k="${k}" type="range" min="0" max="${max}" step="${step}" value="${val}">
        <span class="cp-val">${shown}</span></div>`;
    this.el.innerHTML = `<div class="cp-inner">
      <div class="cp-title">${esc(this.title)}</div>
      <div class="cp-top" data-row="wheel">
        <div class="cp-wheelwrap"><canvas class="cp-wheel" width="260" height="260"></canvas><div class="cp-knob"></div></div>
        <div class="cp-swatch"><div class="cp-swfill"></div></div>
      </div>
      ${slider("r", "Red", 255, 1, Math.round(c.r), Math.round(c.r))}
      ${slider("g", "Green", 255, 1, Math.round(c.g), Math.round(c.g))}
      ${slider("b", "Blue", 255, 1, Math.round(c.b), Math.round(c.b))}
      ${slider("v", "Brightness", 1, 0.01, this.val.toFixed(2), this.val.toFixed(2))}
      ${slider("a", "Opacity", 1, 0.01, c.a.toFixed(2), c.a.toFixed(2))}
      <div class="cp-row" data-row="hex"><span class="cp-lab">Hex</span>
        <input class="cp-hex" type="text" maxlength="9" spellcheck="false" value="${colorHex(c)}"></div>
      <div class="cp-btns" data-row="buttons"><button class="cp-cancel">Cancel</button><button class="cp-ok">Confirm</button></div>
    </div>
    <div class="confirm-foot"><span class="cf-hint"><span class="cf-glyph">✕</span><span class="cf-act">Enter</span></span><span class="cf-hint"><span class="cf-glyph">○</span>Back</span></div>`;
    this._drawWheel();
    // mouse: wheel drag, sliders, hex typing, buttons
    const wheel = this.el.querySelector(".cp-wheel");
    const pick = (e) => {
      const r = wheel.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
      const d = Math.min(1, Math.hypot(x, y));
      this.hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      this.sat = d; this.val = this.val || 1;
      Object.assign(this.c, hsv2rgb(this.hue, this.sat, this.val));
      this._sync("wheel");
    };
    let drag = false;
    wheel.addEventListener("pointerdown", (e) => { drag = true; wheel.setPointerCapture(e.pointerId); pick(e); });
    wheel.addEventListener("pointermove", (e) => { if (drag) pick(e); });
    wheel.addEventListener("pointerup", () => { drag = false; });
    this.el.querySelectorAll(".cp-range").forEach((inp) => inp.addEventListener("input", () => {
      const k = inp.dataset.k, v = parseFloat(inp.value);
      if (k === "v") { this.val = v; Object.assign(this.c, hsv2rgb(this.hue, this.sat, this.val)); }
      else { this.c[k] = v; if (k !== "a") this._fromRgb(); }
      this._sync(inp.dataset.k);
    }));
    const hex = this.el.querySelector(".cp-hex");
    hex.addEventListener("input", () => {
      const p = parseColor(hex.value);
      if (p) { this.c = p; this._fromRgb(); this._sync("hex"); }
    });
    hex.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); hex.blur(); } });
    this.el.querySelector(".cp-ok").addEventListener("click", () => this._ok());
    this.el.querySelector(".cp-cancel").addEventListener("click", () => this._cancel());
    this.el.querySelectorAll("[data-row]").forEach((n) => n.addEventListener("pointerdown", () => {
      this.row = this._rows().indexOf(n.dataset.row); this._focus();
    }));
    this._sync(null); this._focus();
  }
  _drawWheel() {
    const cv = this.el.querySelector(".cp-wheel"); if (!cv) return;
    const ctx = cv.getContext("2d"), W = cv.width, R = W / 2;
    const img = ctx.createImageData(W, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const dx = (x - R) / R, dy = (y - R) / R, d = Math.hypot(dx, dy), i = (y * W + x) * 4;
      if (d > 1) { img.data[i + 3] = 0; continue; }
      const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const c = hsv2rgb(h, d, 1);
      img.data[i] = c.r; img.data[i + 1] = c.g; img.data[i + 2] = c.b;
      img.data[i + 3] = d > 0.985 ? Math.round((1 - d) / 0.015 * 255) : 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  // reflect the colour everywhere except the control that changed it
  _sync(from) {
    const c = this.c, q = (s) => this.el.querySelector(s);
    for (const k of ["r", "g", "b", "v", "a"]) {
      const inp = q(`.cp-${k}`); if (!inp) continue;
      const v = k === "a" ? c.a.toFixed(2) : k === "v" ? this.val.toFixed(2) : String(Math.round(c[k]));
      if (from !== k) inp.value = v;
      inp.parentElement.querySelector(".cp-val").textContent = v;
    }
    const hex = q(".cp-hex"); if (hex && from !== "hex") hex.value = colorHex(c);
    const knob = q(".cp-knob");
    if (knob) {
      const a = this.hue * Math.PI / 180;
      knob.style.left = `${50 + Math.cos(a) * this.sat * 50}%`; knob.style.top = `${50 + Math.sin(a) * this.sat * 50}%`;
    }
    const wheel = q(".cp-wheel"); if (wheel) wheel.style.filter = `brightness(${Math.max(0.15, this.val)})`;
    const sw = q(".cp-swfill"); if (sw) sw.style.background = colorHex(c);
    // live preview, at most once per frame (the stick and the sliders can
    // change the colour every frame; the preview work is the expensive part)
    if (this.onPreview) {
      this._pvHex = colorHex(c);
      if (!this._pvRaf) this._pvRaf = requestAnimationFrame(() => { this._pvRaf = 0; if (this.isOpen && this.onPreview) this.onPreview(this._pvHex); });
    }
  }
  _focus() {
    const rows = this._rows();
    this.el.querySelectorAll("[data-row]").forEach((n) => n.classList.toggle("cp-focus", n.dataset.row === rows[this.row]));
    this.el.querySelectorAll(".cp-btns button").forEach((b, i) => b.classList.toggle("act-focus", rows[this.row] === "buttons" && i === this.btn));
    // ✕ Edit on the Hex field (typed in), ✕ Enter elsewhere
    const act = this.el.querySelector(".confirm-foot .cf-act"); if (act) act.textContent = rows[this.row] === "hex" ? "Edit" : "Enter";
  }
  _ok() { this.sfx.play("enter", 0.6); const hex = colorHex(this.c); this.close(); this.onDone && this.onDone(hex); }
  _cancel() { this.sfx.play("back", 0.5); this.close(); this.onCancel && this.onCancel(); }
  _editHex() {
    if (!VIRTUAL_KB.on) { const h = this.el.querySelector(".cp-hex"); if (h) { h.focus(); h.select(); } return; }
    this._oskActive = true;
    this.osk.open(null, { title: "Hex Color", initial: colorHex(this.c), maxLen: 9 },
      (text) => { this._oskActive = false; const p = parseColor(text); if (p) { this.c = p; this._fromRgb(); } this._sync(null); document.body.classList.add("menu-open"); },
      () => { this._oskActive = false; document.body.classList.add("menu-open"); });
  }
  onInput(a) {
    if (this._oskActive) { this.osk.onInput(a); return; }
    const rows = this._rows(), row = rows[this.row];
    if (a === "up" && this.row > 0) { this.row--; this.sfx.play("cursor_up", 0.3); this._focus(); return; }
    if (a === "down" && this.row < rows.length - 1) { this.row++; this.sfx.play("cursor_down", 0.3); this._focus(); return; }
    if (a === "back") { this._cancel(); return; }
    if (a === "start") { this._ok(); return; }
    if (a === "left" || a === "right") {
      const d = a === "right" ? 1 : -1;
      if (row === "buttons") { this.btn = d > 0 ? 1 : 0; this._focus(); return; }
      if (row === "wheel") {
        this.hue = (this.hue + d * holdAccel("cp-hue", 15) + 360) % 360;
        this.sat = this.sat || 1; this.val = this.val || 1;
        Object.assign(this.c, hsv2rgb(this.hue, this.sat, this.val));
      } else if (row === "v") {
        this.val = Math.max(0, Math.min(1, Math.round((this.val + d * 0.01 * holdAccel("cp-v", 5)) * 100) / 100));
        Object.assign(this.c, hsv2rgb(this.hue, this.sat, this.val));
      } else if (row === "a") this.c.a = Math.max(0, Math.min(1, Math.round((this.c.a + d * 0.01 * holdAccel("cp-a", 5)) * 100) / 100));
      else if (["r", "g", "b"].includes(row)) { this.c[row] = Math.max(0, Math.min(255, Math.round(this.c[row]) + d * holdAccel("cp-" + row, 15))); this._fromRgb(); }
      else return;
      this.sfx.play("cursor_up", 0.25); this._sync(null); return;
    }
    if (a === "enter") {
      if (row === "buttons") { if (this.btn === 1) this._ok(); else this._cancel(); }
      else if (row === "hex") this._editHex();
      else { this.row = rows.length - 1; this.btn = 1; this._focus(); }
    }
  }
}
