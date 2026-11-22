// The △ options menus, the game's information panel and Change Keybinds (ui.js gathers every ui-*.js)
import { fadeOut } from "./menufade.js";
import { esc } from "./ui-core.js";
import { usFoot, usFootClicks } from "./ui-pickers.js";

// ------------------------------------------------------------- SideMenu
// The △ options menus (Sign Out, Custom Color, item options…) use exactly the
// game options menu's design: the panel right of the thin line, the entries
// down from the selected row, ▲ / ▼ when there are more than fit.
const SM_VISIBLE = 7;
export class SideMenu {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("sidemenu"); }
  // `sel`: the option highlighted first (a setting's current value).
  // `spin`: a number setting: one row with its value; up / down change it
  // ({ label(), step(dir) }), ✕ keeps it, ○ / △ cancel.
  // `swatches`: the console's Color menu: every option in one column, colours
  // as small squares (text options such as Original stay text).
  open(items, { title, sel = 0, spin = null, swatches = false } = {}, onPick, onCancel) {
    this.items = items; this.sel = Math.max(0, Math.min(items.length - 1, sel | 0)); this.top = 0;
    this.onPick = onPick; this.onCancel = onCancel; this.title = title; this.spin = spin; this.swatches = swatches;
    this.audio.play("options", 0.5);   // (a theme's option menu sound, if it has one)
    window.__menuTint && window.__menuTint();   // the menu takes the background's current colour
    if (this.sel >= SM_VISIBLE) this.top = this.sel - SM_VISIBLE + 1;
    // (always the coloured stripe, with or without a background picture behind:
    // see GameMenu; "nobg": nothing behind)
    const withBg = !!document.querySelector(".bg-layer.show");
    // (opened again while the last one fades out: that one goes at once)
    if (this.el.__fadeStop) { this.el.__fadeStop(); this.el.__fadeStop = null; }
    this.el.className = `gamemenu show bg${withBg ? "" : " nobg"}${swatches ? " swatches" : ""}`;
    this._render();
  }
  _render() {
    if (this.swatches) {
      this.el.innerHTML = `<div class="gm-line"></div><div class="gm-swatch-list">${this.items.map((it, i) =>
        `<div class="gm-item${it.swatch ? " gm-sw" : ""}${i === this.sel ? " sel" : ""}" data-i="${i}">${it.swatch
          ? `<span class="gm-swatch" style="background:${esc(it.swatch)}"></span>` : `<span class="gm-label">${esc(it.label)}</span>`}</div>`).join("")}</div>`;
      this.el.querySelectorAll(".gm-item").forEach((n) => n.addEventListener("click", () => { this.sel = +n.dataset.i; this._pick(); }));
      return;
    }
    if (this.spin) {
      this.el.innerHTML = `<div class="gm-line"></div>
        <div class="gm-lower">
          <img class="gm-more up" src="./assets/icons/vp/arrow_up.png" alt=""${this.spin.canUp && !this.spin.canUp() ? ' style="visibility:hidden"' : ""}>
          <div class="gm-item sel spin"><span class="gm-label">${esc(this.spin.label())}</span></div>
          <img class="gm-more dn" src="./assets/icons/vp/arrow_down.png" alt=""${this.spin.canDown && !this.spin.canDown() ? ' style="visibility:hidden"' : ""}>
        </div>`;
      this.el.querySelector(".gm-item").addEventListener("click", () => this._pick());
      return;
    }
    const shown = this.items.slice(this.top, this.top + SM_VISIBLE);
    this.el.innerHTML = `<div class="gm-line"></div>
      <div class="gm-lower">
        ${this.top > 0 ? `<img class="gm-more up" src="./assets/icons/vp/arrow_up.png" alt="">` : ""}
        ${shown.map((it, k) => { const i = this.top + k;
          return `<div class="gm-item${i === this.sel ? " sel" : ""}" data-i="${i}"><span class="gm-label">${esc(it.label)}</span></div>`; }).join("")}
        ${this.top + SM_VISIBLE < this.items.length ? `<img class="gm-more dn" src="./assets/icons/vp/arrow_down.png" alt="">` : ""}
      </div>`;
    this.el.querySelectorAll(".gm-item").forEach((n) => n.addEventListener("click", () => { this.sel = +n.dataset.i; this._pick(); }));
  }
  // closing: it fades out where it is (styles.css gmOut, as the Triangle
  // menu), then it's emptied, unless something else opened in it meanwhile;
  // ended at once when something else opens elsewhere (see menufade.js)
  close() {
    this.spin = null;
    const el = this.el;
    if (!el.classList.contains("show")) { el.className = "sidemenu"; el.innerHTML = ""; return; }
    if (el.classList.contains("closing")) return;
    el.classList.add("closing");
    if (el.__fadeStop) el.__fadeStop();
    el.__fadeStop = fadeOut(el, () => { el.__fadeStop = null; if (el.classList.contains("closing")) { el.className = "sidemenu"; el.innerHTML = ""; } });
  }
  _upd() {
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + SM_VISIBLE) this.top = this.sel - SM_VISIBLE + 1;
    this._render();
  }
  _pick() { this.audio.play("enter", 0.6); this.onPick && this.onPick(this.items[this.sel], this.sel); }
  onInput(a) {
    if (this.spin && (a === "up" || a === "down")) { this.spin.step(a === "up" ? 1 : -1); this._render(); return; }
    if (a === "up" && this.sel > 0) { this.sel--; this.audio.play("cursor_up", 0.4); this._upd(); }
    else if (a === "down" && this.sel < this.items.length - 1) { this.sel++; this.audio.play("cursor_down", 0.4); this._upd(); }
    else if (a === "enter") this._pick();
    else if (a === "back") { this.audio.play("back", 0.4); this.close(); this.onCancel && this.onCancel(); }
  }
}

// -------------------------------------------------------- GameInfoPanel
export class GameInfoPanel {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("sidemenu"); }
  open(game, onClose) {
    this.onClose = onClose;
    const rows = [["Developer", game.developer], ["Publisher", game.publisher],
      ["Released", game.releaseDate], ["Genre", game.genre],
      ["Players", game.players], ["Version", game.version]].filter(([, v]) => v);
    if (this.el.__fadeStop) { this.el.__fadeStop(); this.el.__fadeStop = null; }
    this.el.className = "sidemenu info show";
    this.el.innerHTML = `<div class="gi-title">${esc(game.copy > 1 ? `${game.title} (${game.copy})` : game.title)}</div>
      <div class="gi-desc">${esc(game.description || "")}</div>
      <dl class="gi-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }
  close() { this.el.className = "sidemenu"; this.el.innerHTML = ""; }
  onInput(a) { if (a === "back") { this.audio.play("back", 0.5); this.close(); this.onClose && this.onClose(); } }
}

// ------------------------------------------------------------ KeybindMenu
// "Change Keybinds" (System Settings): a Turn-Off-style panel listing every
// PlayStation button next to its keyboard / mouse keys. Click a key (or move
// onto it and press Cross) and then press the new key / mouse button. "Default"
// (lower left) restores everything. Controller: up/down rows, left/right
// between the two key slots and the Default / Done buttons.
export class KeybindMenu {
  constructor(sfx) { this.sfx = sfx; this.el = document.getElementById("form"); }
  open({ actions, keybinds, labelOf, onChange }, onClose) {
    this.actions = actions; this.kb = keybinds; this.labelOf = labelOf; this.onChange = onChange; this.onClose = onClose;
    this.r = 0; this.c = 0; this.waiting = null;
    this.kb.resetHook = () => { this.kb.capture = null; this.waiting = null; this._default(); };
    this.el.className = "form show keybinds uisheet"; document.body.classList.add("menu-open");
    this._render();
  }
  close() {
    this.kb.capture = null; this.waiting = null; this.kb.resetHook = null;
    this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open");
  }
  _rowsN() { return this.actions.length + 1; }   // last row = Default / Done
  _render() {
    const rows = this.actions.map((a, i) => `<div class="kb-row" data-r="${i}">
        <span class="kb-pad">${esc(a.pad)}</span><span class="kb-name">${esc(a.label)}</span>
        ${[0, 1].map((s) => `<button class="kb-key" data-r="${i}" data-s="${s}">${esc(this.labelOf(this.kb.map[a.id][s]))}</button>`).join("")}
      </div>`).join("");
    this.el.innerHTML = `<div class="us-title">Change Keybinds</div>
    <div class="kb-inner">
      <div class="kb-head"><span>PlayStation Button</span><span></span><span>Key 1</span><span>Key 2</span></div>
      <div class="kb-list">${rows}</div>
      <div class="kb-mouse">F11 or SELECT + R2 restores the default keys &nbsp;•&nbsp; Mouse: Left Click = open (✕) &nbsp;•&nbsp; Right Click = △ Options &nbsp;•&nbsp; Wheel = Up / Down &nbsp;•&nbsp; Shift + Wheel = Left / Right</div>
    </div>
    <div class="kb-btns"><button class="ui-btn kb-default">Default</button><button class="ui-btn kb-done">Done</button></div>
    ${usFoot("Enter", null, "Back")}
    <div class="kb-wait"></div>`;
    usFootClicks(this.el, (a) => this.onInput(a));
    this.el.querySelectorAll(".kb-key").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = +b.dataset.r, c = +b.dataset.s;
      // clicking the key that's waiting again: out of the key choice, the slot
      // cleared (so Esc itself can be chosen as a key)
      if (this.waiting && this.waiting.action === this.actions[r]?.id && this.waiting.slot === c) { this._setKey(""); return; }
      this._stopListen();
      this.r = r; this.c = c; this._focus(); this._listen();
    }));
    this.el.querySelector(".kb-default").addEventListener("click", () => this._default());
    this.el.querySelector(".kb-done").addEventListener("click", () => this._done());
    this._focus();
  }
  _focus() {
    const last = this.r === this.actions.length;
    this.el.querySelectorAll(".kb-key").forEach((b) => b.classList.toggle("act-focus", !last && +b.dataset.r === this.r && +b.dataset.s === this.c));
    this.el.querySelector(".kb-default")?.classList.toggle("sel", last && this.c === 0);
    this.el.querySelector(".kb-done")?.classList.toggle("sel", last && this.c === 1);
    const cur = this.el.querySelector(`.kb-key[data-r="${this.r}"][data-s="${this.c}"]`);
    cur?.scrollIntoView({ block: "nearest" });
  }
  // wait for the next key / mouse button
  _listen() {
    const a = this.actions[this.r]; if (!a) return;
    this.sfx.play("enter", 0.4);
    this.waiting = { action: a.id, slot: this.c };
    const w = this.el.querySelector(".kb-wait");
    w.textContent = `Press a key or mouse button for "${a.label}"   (click the key again to clear it)`; w.classList.add("on");
    const btn = this.el.querySelector(`.kb-key[data-r="${this.r}"][data-s="${this.c}"]`); btn?.classList.add("listening");
    // capture on the next tick so the click / Enter that started it isn't taken
    const token = this.waiting;
    setTimeout(() => { if (this.waiting === token) this.kb.capture = (code) => this._setKey(code); }, 0);
  }
  // stop waiting without changing anything (the old key's mark goes too)
  _stopListen() {
    this.kb.capture = null; this.waiting = null;
    this.el.querySelectorAll(".kb-key.listening").forEach((b) => b.classList.remove("listening"));
    this.el.querySelector(".kb-wait")?.classList.remove("on");
  }
  _setKey(val) {
    this.kb.capture = null;
    const { action, slot } = this.waiting || {}; this.waiting = null;
    if (!action) return;
    // a key belongs to one action: drop it from anywhere else
    if (val) for (const k of Object.keys(this.kb.map)) this.kb.map[k] = this.kb.map[k].map((c) => (c === val ? "" : c));
    this.kb.map[action][slot] = val;
    this.sfx.play(val ? "enter" : "back", 0.5);
    this.onChange && this.onChange();
    this._render();
  }
  _default() { this.sfx.play("enter", 0.5); this.kb.load(null); this.onChange && this.onChange(); this._render(); }
  _done() { this.sfx.play("back", 0.5); this.close(); this.onClose && this.onClose(); }
  onInput(a) {
    // (the keyboard is handled by the capture; ○ on a controller stops waiting)
    if (this.waiting) { if (a === "back") { this.sfx.play("back", 0.4); this._stopListen(); } return; }
    const n = this._rowsN();
    if (a === "up" && this.r > 0) { this.r--; this.sfx.play("cursor_up", 0.3); this._focus(); }
    else if (a === "down" && this.r < n - 1) { this.r++; this.sfx.play("cursor_down", 0.3); this._focus(); }
    else if (a === "left" && this.c > 0) { this.c--; this.sfx.play("cursor_up", 0.3); this._focus(); }
    else if (a === "right" && this.c < 1) { this.c++; this.sfx.play("cursor_down", 0.3); this._focus(); }
    else if (a === "enter") {
      if (this.r === this.actions.length) { if (this.c === 0) this._default(); else this._done(); }
      else this._listen();
    } else if (a === "back") this._done();
  }
}
