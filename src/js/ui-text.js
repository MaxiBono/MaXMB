// Text entry: the console's text entry screen and its on-screen keyboard (ui.js gathers every ui-*.js)
import { Input } from "./api.js";
import { esc } from "./ui-core.js";
import { Confirm } from "./ui-pickers.js";

// Accessory Settings > On-Screen Keyboard: when off, the on-screen keyboard
// never opens (text is typed with the keyboard into the fields themselves).
export const VIRTUAL_KB = { on: true };
export const useOsk = () => VIRTUAL_KB.on && Input.lastKind === "controller";

// ------------------------------------------------------------- TextForm
// The console's text entry screen: the two rules, the prompt ("Enter a name
// for the playlist."), the field(s), OK, and ✕ Edit / ○ Back. With a
// controller, ✕ on a field opens the on-screen keyboard; with a keyboard the
// field is typed in directly (Enter = OK, Esc = Back).
const autoPrompt = (label) => {
  const l = String(label || "").replace(/\s*\(.*\)$/, "");
  if (!l) return "";
  // (names keep their capitals: GOG, Epic Games, Steam, RetroAchievements)
  const w = l.split(" ")[0];
  const keep = /^[A-Z0-9]{2,}$/.test(w) || /[A-Z]/.test(w.slice(1)) || /^(Epic|Steam|PlayStation|GOG|EA|Xbox|Nintendo|Windows)$/.test(w);
  return `Enter ${/^[aeiou]/i.test(l) ? "an" : "a"} ${keep ? l : l.charAt(0).toLowerCase() + l.slice(1)}.`;
};
export class TextForm {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); this.osk = new OnScreenKeyboard(audio); }
  // { title, prompt?, fields: [{ key, label, value, type, required }], submit, alt, hint }
  open({ title, prompt = null, fields, submit = "Confirm", alt = null, hint = null }, onSubmit, onCancel, onAlt) {
    this.title = title; this.fields = fields.map((f) => ({ ...f, value: f.value || "" }));
    this.prompt = prompt || (this.fields.length === 1 ? autoPrompt(this.fields[0].label) || title : title);
    this.submitLabel = this.fields.length === 1 ? "OK" : submit; this.altLabel = alt; this.hint = hint;
    this.onSubmit = onSubmit; this.onCancel = onCancel; this.onAlt = onAlt;
    this._oskActive = false;
    this.focus = 0;
    this._render();
    // keyboard: straight into the first field
    if (!useOsk()) setTimeout(() => { if (this.focus === 0 && this.inputs && this.inputs[0] && this.el.contains(this.inputs[0])) this.inputs[0].focus(); }, 30);
  }
  _btnCount() { return 1 + (this.altLabel ? 1 : 0); }
  _render() {
    this.el.className = "form show tfxform"; document.body.classList.add("menu-open");
    const many = this.fields.length > 1;
    this.el.innerHTML = `<div class="tfx">
      <div class="tfx-prompt">${esc(this.prompt)}</div>
      ${this.fields.map((f, i) => `<label class="tfx-row">${many ? `<span class="tfx-label">${esc(f.label)}</span>` : ""}
        <span class="tfx-field" data-i="${i}"><input data-i="${i}" type="${f.type === "number" ? "text" : (f.type || "text")}"${f.type === "number" ? ' inputmode="numeric" data-num="1"' : ""} value="${esc(f.value)}"${f.max ? ` maxlength="${f.max}"` : ""} spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off"></span></label>`).join("")}
      ${this.hint ? `<div class="tfx-hint">${esc(this.hint)}</div>` : ""}
      <div class="tfx-btns"><button class="tfx-btn tfx-ok">${esc(this.submitLabel)}</button>${this.altLabel ? `<button class="tfx-btn tfx-alt">${esc(this.altLabel)}</button>` : ""}</div>
    </div>
    <div class="confirm-foot tfx-foot">
      <span class="cf-hint"><span class="cf-glyph cf-x">✕</span><span class="cf-act">Edit</span></span>
      <span class="cf-hint"><span class="cf-glyph cf-o">○</span>Back</span>
    </div>`;
    this.inputs = [...this.el.querySelectorAll("input")];
    this._boxes = [...this.el.querySelectorAll(".tfx-field")];
    this._btns = [...this.el.querySelectorAll(".tfx-btn")];
    this.inputs.forEach((inp, i) => {
      inp.addEventListener("input", () => {
        if (inp.dataset.num && /[^0-9]/.test(inp.value)) inp.value = inp.value.replace(/[^0-9]/g, "");
        this.fields[i].value = inp.value;
      });
      inp.addEventListener("focus", () => { this.focus = i; this._upd(); });
    });
    this.el.querySelector(".tfx-ok").addEventListener("click", () => this._submit());
    // the mouse over a button selects it (and it glows, like the field)
    this._btns.forEach((b, i) => b.addEventListener("mouseenter", () => {
      if (this.focus === this.fields.length + i) return;
      this.focus = this.fields.length + i; this._blurIfButton(); this._upd();
    }));
    const altBtn = this.el.querySelector(".tfx-alt");
    if (altBtn) altBtn.addEventListener("click", () => { this.audio.play("enter", 0.5); this.onAlt && this.onAlt(); });
    this._upd();
  }
  _upd() {
    const nf = this.fields.length;
    this._boxes.forEach((b, i) => b.classList.toggle("sel", i === this.focus));
    this._btns.forEach((b, i) => b.classList.toggle("sel", nf + i === this.focus));
    // ✕ Edit on a text field, ✕ Enter on a button
    const act = this.el.querySelector(".tfx-foot .cf-act"); if (act) act.textContent = this.focus < nf ? "Edit" : "Enter";
  }
  // ✕ on a field: the on-screen keyboard (controller) or the field itself
  _edit(i) {
    const f = this.fields[i];
    if (!useOsk()) { this.inputs[i] && this.inputs[i].focus(); return; }
    this._oskActive = true;
    this.audio.play("enter", 0.5);
    this.osk.open(this.el, { title: f.label || this.title, initial: f.value, password: f.type === "password", maxLen: f.max || 0 },
      (text) => {
        this._oskActive = false;
        if (f.type === "number") text = String(text || "").replace(/[^0-9]/g, "");
        f.value = text;
        // the next field, or OK, once this one is filled in
        this.focus = Math.min(this.fields.length, i + 1);
        this._render();
      },
      () => { this._oskActive = false; this._render(); });
  }
  close() { this._oskActive = false; this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  _submit() {
    const out = {};
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      if (f.required && !String(f.value).trim()) { this.audio.play("error", 0.4); this.focus = i; this._upd(); return; }
      out[f.key] = String(f.value).trim();
    }
    this.audio.play("enter", 0.6); this.onSubmit && this.onSubmit(out);
  }
  _cancel() { this.audio.play("back", 0.5); this.onCancel && this.onCancel(); }
  onInput(a) {
    if (this._oskActive) { this.osk.onInput(a); return; }
    const nf = this.fields.length, total = nf + this._btnCount();
    const typing = document.activeElement && document.activeElement.tagName === "INPUT" && this.el.contains(document.activeElement);
    if (a === "up" && this.focus > 0) { this.focus = this.focus > nf ? nf - 1 : this.focus - 1; this.audio.play("cursor_up", 0.35); this._blurIfButton(); this._upd(); }
    else if (a === "down" && this.focus < nf) { this.focus++; this.audio.play("cursor_down", 0.35); this._blurIfButton(); this._upd(); }
    else if ((a === "left" || a === "right") && this.focus >= nf && !typing) {
      const n = Math.max(nf, Math.min(total - 1, this.focus + (a === "left" ? -1 : 1)));
      if (n !== this.focus) { this.focus = n; this.audio.play("cursor_up", 0.3); this._upd(); }
    }
    else if (a === "enter") {
      // a name typed in is only confirmed with OK: Enter in a field moves on
      // to the next field, or to OK
      if (typing && this.focus < nf) {
        this.focus = this.focus + 1; this.audio.play("cursor_down", 0.35); this._blurIfButton(); this._upd();
      }
      else if (this.focus === nf) this._submit();
      else if (this.focus < nf) this._edit(this.focus);
      else { this.audio.play("enter", 0.5); this.onAlt && this.onAlt(); }
    }
    else if (a === "back") this._cancel();
  }
  _blurIfButton() { if (this.focus >= this.fields.length && document.activeElement && document.activeElement.blur) document.activeElement.blur(); else if (!useOsk() && this.inputs[this.focus]) this.inputs[this.focus].focus(); }
}

// ---------------------------------------------------- on-screen keyboard (controllers)
// On-screen keyboard modelled on the PS3 XMB keyboard (built from scratch).
// The D-pad moves over the character grid; the controller buttons act directly:
//   Cross = select/type \u00b7 Triangle = Space \u00b7 Square = Backspace \u00b7
//   Start = Enter (confirm) \u00b7 Select = Input Mode (cycle) \u00b7 Circle = cancel.
// The lower two rows are a faithful button LEGEND (some tiles, like L2, are
// dummies that mirror the console but do nothing here).
// The console's on-screen keyboard (Playstation-3-Keyboard capture), drawn in
// its own layer in the middle of the screen over whatever is behind it (a
// form, a setting, a page), lightly darkened. Keys (a 10-column grid; the
// function keys span cells), the Prediction box on the right, the title bar
// and the text area are laid out in capture pixels (--u = one pixel of the
// 932-px-wide capture).
//   Cross types / presses the focused key (every key can be pressed);
//   □ Backspace, △ Space, L1 / R1 caret, L2 a/à accents, R2 a/A capitals,
//   SELECT Input Mode, START Enter, ○ cancel.
// the four keyboards (IMG_3536-3541): letters, capitals, accented letters and
// accented capitals (a/A switches case, a/à switches accents)
const OSK_LETTERS = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l","'"],
  ["z","x","c","v","b","n","m",",",".","?"],
];
const OSK_LETTERS_UP = [
  ["!","@","#","$","%","^","&","*","(",")"],
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L","\""],
  ["Z","X","C","V","B","N","M","-","_","/"],
];
const OSK_ACCENTS = [
  ["à","á","â","ã","ä","å","æ","ç","[","]"],
  ["è","é","ê","ë","ì","í","î","ï",";",":"],
  ["ñ","ò","ó","ô","õ","ö","ø","œ","`","¡"],
  ["ß","ù","ú","û","ü","ý","ÿ",",",".","¿"],
];
const OSK_ACCENTS_UP = [
  ["À","Á","Â","Ã","Ä","Å","Æ","Ç","<",">"],
  ["È","É","Ê","Ë","Ì","Í","Î","Ï","=","+"],
  ["Ñ","Ò","Ó","Ô","Õ","Ö","Ø","Œ","~","\""],
  ["ß","Ù","Ú","Û","Ü","Ý","Ÿ","-","_","/"],
];
// the @#: panel (IMG_3540 / 3541): every symbol, 7 to a row, 7 rows shown
const OSK_SYMBOL_PANEL = [
  "!","\"","#","$","%","&","'",
  "(",")","*","+",",","-",".",
  "/",":",";","<","=",">","?",
  "@","[","\\","]","^","_","`",
  "{","|","}","~","¡","¿","´",
  "‘","’","‚","“","”","„","°",
  "‹","›","«","»","ª","º","×",
  "÷","¤","¢","€","£","¥","§",
  "¦","µ",
];
const OSK_SYM_COLS = 7, OSK_SYM_ROWS = 7;
// the key icons, drawn from the capture (Playstation-3-Keyboard.png)
// 9 squares: three rows of three wide, short blocks
const OSK_GRID = `<svg viewBox="0 0 30 20" aria-hidden="true"><g fill="#102a33">${[0, 1, 2].map((r) => [0, 1, 2].map((c) =>
  `<rect x="${c * 10.4}" y="${r * 7.2}" width="8.6" height="5.6" rx="0.6"/>`).join("")).join("")}</g></svg>`;
// the arrows: flat triangles (up / down wide and short, left / right tall and narrow)
const OSK_ARROW = {
  up: `<svg class="osk-ar osk-ar-v" viewBox="0 0 20 10" aria-hidden="true"><path d="M0 10 10 0 20 10z" fill="#0d2f55"/></svg>`,
  down: `<svg class="osk-ar osk-ar-v" viewBox="0 0 20 10" aria-hidden="true"><path d="M0 0h20L10 10z" fill="#0d2f55"/></svg>`,
  left: `<svg class="osk-ar osk-ar-h" viewBox="0 0 11 18" aria-hidden="true"><path d="M11 0v18L0 9z" fill="#0d2f55"/></svg>`,
  right: `<svg class="osk-ar osk-ar-h" viewBox="0 0 11 18" aria-hidden="true"><path d="M0 0v18L11 9z" fill="#0d2f55"/></svg>`,
};
// @/☻: the symbols key (the smiley a dark disc with the key's colour for its face)
const OSK_SMILE = `<svg class="osk-smile" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9.5" fill="#2b2a24"/><circle cx="6.8" cy="7.6" r="1.8" fill="#d8cfa6"/><circle cx="13.2" cy="7.6" r="1.8" fill="#d8cfa6"/><path d="M5 11.2c1.3 3.1 8.7 3.1 10 0" fill="none" stroke="#d8cfa6" stroke-width="2" stroke-linecap="round"/></svg>`;
// copy: the front sheet at the top left, the one behind it showing as an L at
// the lower right; the key's own colour shows in the gap between them
const OSK_COPY = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="13" height="13" fill="#0d2f55"/><path d="M17.6 8H21v13H8v-3.4h9.6z" fill="#0d2f55"/></svg>`;
// paste (IMG_3611): the clipboard drawn as an outline (its clip solid on top)
// with a solid sheet in front of it at the lower right, a gap around the sheet
let _pasteN = 0;
const oskPaste = () => { const id = `oskpm${++_pasteN}`; return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><mask id="${id}"><rect width="24" height="24" fill="#fff"/><rect x="8.6" y="8.6" width="13.4" height="15" fill="#000"/></mask></defs><g mask="url(#${id})"><rect x="3.4" y="5" width="11.6" height="15.6" rx="1.1" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="6.2" y="2.6" width="6" height="3.9" rx="0.9" fill="currentColor"/></g><rect x="10.2" y="10.2" width="10.2" height="11.8" fill="currentColor"/></svg>`; };
let _oskClip = "";
// the console's button labels (OSK Icons): a key's badge → its picture
const OSK_BADGE = { L1: "l1", L2: "l2", R1: "r1", R2: "r2", SELECT: "select", START: "start", "\u25b3": "triangle", "\u25a1": "square" };
export class OnScreenKeyboard {
  // (the open keyboard, for the controller code: held buttons repeat on it and
  // the right stick moves it; where it was moved to)
  static active = null;
  static pos = { x: 0, y: 0 };
  constructor(sfx) { this.sfx = sfx; }
  // `host` is kept for the callers; the keyboard draws in its own layer
  open(host, { title, initial = "", password = false, maxLen = 0, multiline = false }, onAccept, onCancel) {
    this.title = title; this.text = String(initial || ""); this.password = password; this.multiline = multiline;
    this.maxLen = maxLen || 0; this.caret = this.text.length;
    this.onAccept = onAccept; this.onCancel = onCancel;
    this.mode = "letters"; this.caps = false;
    this.k = 24; this.col = 4;            // (the cursor starts on "g", as on the console)
    this.symOpen = false; this.sym = 0; this.symTop = 0;
    OnScreenKeyboard.active = this;
    // (always opens in the middle of the screen; the right stick moves it
    // around only while it's open)
    OnScreenKeyboard.pos.x = 0; OnScreenKeyboard.pos.y = 0; this._rsBase = null;
    let el = document.getElementById("osk-layer");
    if (!el) { el = document.createElement("div"); el.id = "osk-layer"; document.body.appendChild(el); }
    this.el = el;
    document.body.classList.add("menu-open", "osk-open");
    this._render();
  }
  close() {
    if (OnScreenKeyboard.active === this) OnScreenKeyboard.active = null;
    if (this.el) { this.el.className = ""; this.el.innerHTML = ""; }
    document.body.classList.remove("osk-open");
  }
  // the right stick moves the keyboard around the screen (kept where it was
  // left for the next time it opens)
  onRightStick(rx, ry) {
    const dz = 0.22;
    const v = (a) => Math.abs(a) < dz ? 0 : Math.sign(a) * ((Math.abs(a) - dz) / (1 - dz)) ** 1.6;
    const dx = v(rx), dy = v(ry);
    const now = performance.now();
    // (the speed goes by the time since the last move, not by how often it's
    // asked: as quick on a slow computer, and from the browser's own feed)
    const dt = this._rsAt ? Math.min(0.1, (now - this._rsAt) / 1000) : 1 / 60;
    this._rsAt = (dx || dy) ? now : 0;
    if (!dx && !dy) return;
    const box = this.el && this.el.querySelector(".osk"); if (!box) return;
    const p = OnScreenKeyboard.pos;
    const sp = Math.min(window.innerWidth, window.innerHeight) * 0.022 * 60 * dt;
    // where it sits unmoved, measured once per keyboard (not every frame)
    if (!this._rsBase || this._rsBase.box !== box) {
      const r = box.getBoundingClientRect();
      this._rsBase = { box, x: r.left - p.x, y: r.top - p.y, w: r.width, h: r.height };
    }
    const b = this._rsBase;
    p.x = Math.max(-b.x, Math.min(window.innerWidth - b.w - b.x, p.x + dx * sp));
    p.y = Math.max(-b.y, Math.min(window.innerHeight - b.h - b.y, p.y + dy * sp));
    box.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
  }
  _finish(ok) {
    const text = this.text;
    this.close();
    // (the menu stays hidden while the form the keyboard was typing into is
    // still open: the card editor, a text form...)
    if (!document.querySelector(".form.show, .gamemenu.show, .gamedlg.show")) document.body.classList.remove("menu-open");
    if (ok) { this.sfx.play("enter", 0.5); this.onAccept && this.onAccept(text); }
    else { this.sfx.play("back", 0.5); this.onCancel && this.onCancel(); }
  }
  // every key: { r, c (first cell), w (cells), kind, … }
  _keys() {
    const acc = this.mode === "accents";
    const page = acc ? (this.caps ? OSK_ACCENTS_UP : OSK_ACCENTS) : (this.caps ? OSK_LETTERS_UP : OSK_LETTERS);
    const keys = [];
    page.forEach((row, r) => row.forEach((ch, c) => keys.push({ r, c, w: 1, kind: "char", ch })));
    // the bases: the console's own key pictures (OSK Icons)
    const f = (r, c, w, act, base, html, badge, cls = "") => keys.push({ r, c, w, kind: "fn", act, base, html, badge, cls });
    f(4, 0, 1, "symbols", "o", `<span class="osk-sym">@/${OSK_SMILE}</span>`, null, this.symOpen ? "on" : "");
    f(4, 1, 1, null, "e", "");
    f(4, 2, 1, "accents", "e", `<span class="osk-cap">a/à</span>`, "L2");
    f(4, 3, 1, "caps", "e", `<span class="osk-cap">a/A</span>`, "R2");
    f(4, 4, 2, "backspace", "b", "Backspace", "□");
    f(4, 6, 2, "space", "b", "Space", "△");
    f(4, 8, 2, "linebreak", "b", "Line Break");
    f(5, 0, 1, "home", "b_s", OSK_ARROW.up, null, "rt");
    f(5, 1, 1, "end", "b_s", OSK_ARROW.down, null, "rt");
    f(5, 2, 1, "caretleft", "b_s", OSK_ARROW.left, "L1", "rt");
    f(5, 3, 1, "caretright", "b_s", OSK_ARROW.right, "R1", "rt");
    f(5, 4, 1, null, "p", `<span class="osk-ico">${OSK_GRID}</span>`);         // (placeholder)
    f(5, 5, 1, null, "p", "");
    f(5, 6, 2, null, "g", "Input Mode", "SELECT");                           // (placeholder)
    f(5, 8, 2, "enter", "g", "Enter", "START");
    f(5, 10, 1, "copy", "b_s", `<span class="osk-ico osk-copy">${OSK_COPY}</span>`, null, "cp");
    // Paste lights up (blue, like Copy) only when there's something to paste
    f(5, 11, 1, "paste", "b_s", `<span class="osk-ico osk-paste${_oskClip ? " can" : ""}">${oskPaste()}</span>`, null, "cp");
    return keys;
  }
  _render() {
    this.keys = this._keys();
    this.k = Math.max(0, Math.min(this.keys.length - 1, this.k));
    const modeTxt = this.mode === "accents" ? (this.caps ? "À" : "à") : (this.caps ? "A" : "a");
    const P = OnScreenKeyboard.pos;
    this.el.className = "show";
    this.el.innerHTML = `<div class="osk" style="transform: translate(${P.x}px, ${P.y}px)">
      <div class="osk-bar"><img class="osk-pen" src="./assets/icons/osk/osk_icon.png" alt=""><span class="osk-title">${esc(this.title || "Message")}</span></div>
      <div class="osk-screen">${this._screenHTML()}</div>
      <div class="osk-strip"></div>
      <div class="osk-board">
        ${this.keys.map((k, i) => `<div class="osk-k ${k.kind === "char" ? "ch" : `fn b-${k.base} ${k.cls}`}${i === this.k && !this.symOpen ? " sel" : ""}" data-i="${i}"
          style="--x:${k.c < 10 ? k.c * 72 + 1 : 723 + (k.c - 10) * 105};--y:${(k.r * 53.6 + 1).toFixed(1)};--kw:${k.c < 10 ? k.w * 72 - 7 : 99};--base:url('./assets/icons/osk/button_base_${k.kind === "char" ? "white" : k.base}.png')">${k.badge ? `<img class="osk-badge" src="./assets/icons/osk/label_${OSK_BADGE[k.badge]}.png" alt="">` : ""}${k.kind === "char" ? `<span class="osk-ch">${esc(k.ch)}</span>` : `<span class="osk-fl">${k.html}</span>`}</div>`).join("")}
        ${this.symOpen ? this._symHTML() : ""}
        <div class="osk-pred"><div class="osk-predbox"><span class="osk-scroll"></span></div>
          <div class="osk-predbar"><span>Prediction</span><span class="osk-modes"><b>${esc(modeTxt)}</b><b>0</b></span></div></div>
      </div>
      <div class="osk-foot"></div>
    </div>`;
    this.el.querySelectorAll(".osk-k").forEach((n) => n.addEventListener("click", () => {
      if (this.symOpen) { this.symOpen = false; }
      this.k = +n.dataset.i; this.col = this.keys[this.k].c; this._sel(); this._press();
    }));
    this.el.querySelectorAll(".osk-sy").forEach((n) => n.addEventListener("click", () => { this.sym = +n.dataset.s; this._insert(OSK_SYMBOL_PANEL[this.sym]); this._render(); }));
  }
  // the @#: panel: the symbols, 7 to a row, scrolled so the focused one shows
  _symHTML() {
    const rows = Math.ceil(OSK_SYMBOL_PANEL.length / OSK_SYM_COLS);
    const row = Math.floor(this.sym / OSK_SYM_COLS);
    if (row < this.symTop) this.symTop = row;
    if (row >= this.symTop + OSK_SYM_ROWS) this.symTop = row - OSK_SYM_ROWS + 1;
    const first = this.symTop * OSK_SYM_COLS;
    const cells = OSK_SYMBOL_PANEL.slice(first, first + OSK_SYM_ROWS * OSK_SYM_COLS).map((ch, j) => {
      const i = first + j;
      return `<div class="osk-sy${i === this.sym ? " sel" : ""}" data-s="${i}" style="--sx:${j % OSK_SYM_COLS};--sy:${Math.floor(j / OSK_SYM_COLS)}">${esc(ch)}</div>`;
    }).join("");
    // (the scroll bar on the right: its bright part is the rows on show; the ▲
    // over the panel once it's scrolled down, as on the console)
    const thumbH = OSK_SYM_ROWS / rows, thumbT = this.symTop / rows;
    return `<div class="osk-symp">${this.symTop > 0 ? `<img class="osk-symup" src="./assets/icons/vp/arrow_up.png" alt="">` : ""}<div class="osk-symgrid">${cells}</div>
      <div class="osk-symbar"><span class="osk-symthumb" style="top:${(thumbT * 100).toFixed(2)}%;height:${(thumbH * 100).toFixed(2)}%"></span></div></div>`;
  }
  _disptext() { return this.password ? "•".repeat(this.text.length) : this.text; }
  // the caret (the green I-beam) sits where the next character goes, taking
  // no room (the letters never move); the white ◁ always marks the end
  _screenHTML() {
    const t = this._disptext();
    return `<span class="osk-txt">${esc(t.slice(0, this.caret))}<span class="osk-caret"></span>${esc(t.slice(this.caret))}<span class="osk-end"></span></span>`;
  }
  _sel() { this.el.querySelectorAll(".osk-k").forEach((n) => n.classList.toggle("sel", +n.dataset.i === this.k)); }
  _refresh() { const sc = this.el.querySelector(".osk-screen"); if (sc) sc.innerHTML = this._screenHTML(); }
  _full() { return this.maxLen && this.text.length >= this.maxLen; }
  _insert(str) {
    if (this._full()) { this.sfx.play("error", 0.3); return; }
    this.text = this.text.slice(0, this.caret) + str + this.text.slice(this.caret);
    this.caret += str.length; this.sfx.play("enter", 0.3); this._refresh();
  }
  _press() {
    const k = this.keys[this.k]; if (!k) return;
    if (k.kind === "char") { this._insert(k.ch); return; }
    if (!k.act) { this.sfx.play("error", 0.3); return; }
    this._act(k.act);
  }
  _act(act) {
    switch (act) {
      case "space": this._insert(" "); break;
      case "linebreak": if (this.multiline) this._insert("\n"); else this.sfx.play("error", 0.3); break;   // (one-line fields: no line breaks)
      case "backspace":
        if (this.caret > 0) { this.text = this.text.slice(0, this.caret - 1) + this.text.slice(this.caret); this.caret--; this.sfx.play("back", 0.3); }
        else this.sfx.play("error", 0.3);
        this._refresh(); break;
      case "caretleft": if (this.caret > 0) this.caret--; this.sfx.play("cursor_up", 0.25); this._refresh(); break;
      case "caretright": if (this.caret < this.text.length) this.caret++; this.sfx.play("cursor_down", 0.25); this._refresh(); break;
      case "home": this.caret = 0; this.sfx.play("cursor_up", 0.25); this._refresh(); break;
      case "end": this.caret = this.text.length; this.sfx.play("cursor_down", 0.25); this._refresh(); break;
      // the keyboard's own state: what the keys show is what they type
      case "caps": this.caps = !this.caps; this.sfx.play("enter", 0.3); this._render(); break;
      case "accents": this.mode = this.mode === "accents" ? "letters" : "accents"; this.sfx.play("enter", 0.3); this._render(); break;
      case "symbols": this.symOpen = !this.symOpen; this.sfx.play(this.symOpen ? "enter" : "back", 0.3); this._render(); break;
      case "copy":
        _oskClip = this.text; try { navigator.clipboard && navigator.clipboard.writeText(this.text).catch(() => {}); } catch (e) {}
        this.sfx.play("enter", 0.3); this._render(); break;
      case "paste":
        if (_oskClip) this._insert(this.maxLen ? _oskClip.slice(0, Math.max(0, this.maxLen - this.text.length)) : _oskClip);
        else this.sfx.play("error", 0.3);
        break;
      case "enter": this._finish(true); break;
    }
  }
  // moving: left / right go key by key along the row; up / down keep the column
  _move(dir) {
    const cur = this.keys[this.k];
    if (dir === "left" || dir === "right") {
      const row = this.keys.filter((k) => k.r === cur.r).sort((a, b) => a.c - b.c);
      let i = row.indexOf(cur) + (dir === "left" ? -1 : 1);
      i = (i + row.length) % row.length;
      this.k = this.keys.indexOf(row[i]); this.col = row[i].c;
    } else {
      const rows = 6;
      let r = cur.r;
      for (let n = 0; n < rows; n++) {
        r = (r + (dir === "up" ? -1 : 1) + rows) % rows;
        const hit = this.keys.find((k) => k.r === r && this.col >= k.c && this.col < k.c + k.w)
          || this.keys.filter((k) => k.r === r).sort((a, b) => Math.abs(a.c - this.col) - Math.abs(b.c - this.col))[0];
        if (hit) { this.k = this.keys.indexOf(hit); break; }
      }
    }
    this.sfx.play(dir === "left" || dir === "up" ? "cursor_up" : "cursor_down", 0.3);
    this._sel();
  }
  // in the @#: panel: the d-pad moves among the symbols, ✕ types one, ○ closes it
  _symMove(dir) {
    const n = OSK_SYMBOL_PANEL.length, c = this.sym % OSK_SYM_COLS;
    let i = this.sym;
    if (dir === "left") { if (c > 0) i--; }
    else if (dir === "right") { if (c < OSK_SYM_COLS - 1 && i + 1 < n) i++; }
    else if (dir === "up") { if (i - OSK_SYM_COLS >= 0) i -= OSK_SYM_COLS; }
    else if (dir === "down") { if (i + OSK_SYM_COLS < n) i += OSK_SYM_COLS; else if (Math.floor(i / OSK_SYM_COLS) < Math.floor((n - 1) / OSK_SYM_COLS)) i = n - 1; }
    if (i === this.sym) return;
    this.sym = i; this.sfx.play(dir === "left" || dir === "up" ? "cursor_up" : "cursor_down", 0.3); this._render();
  }
  onInput(a) {
    if (this.symOpen) {
      if (a === "up" || a === "down" || a === "left" || a === "right") { this._symMove(a); return; }
      if (a === "enter") { this._insert(OSK_SYMBOL_PANEL[this.sym]); return; }
      if (a === "back") { this.symOpen = false; this.sfx.play("back", 0.3); this._render(); return; }
    }
    if (a === "up" || a === "down" || a === "left" || a === "right") { this._move(a); return; }
    switch (a) {
      case "enter": this._press(); break;                  // Cross: the focused key
      case "options": this._act("space"); break;           // △ Space
      case "square": this._act("backspace"); break;        // □ Backspace
      case "start": this._act("enter"); break;             // START Enter
      case "l1": this._act("caretleft"); break;
      case "r1": this._act("caretright"); break;
      case "l2": this._act("accents"); break;              // a/à
      case "r2": this._act("caps"); break;                 // a/A
      case "back": this._finish(false); break;             // ○ cancel
    }
  }
}
