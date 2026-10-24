// Flat, transparent XMB-style overlays + media players.
import { sysBase, playerIcon } from "./themes.js";
const mpIcon = (n) => playerIcon("mp", n, `./assets/icons/system/${n}.png`);
import { call, Input, thumbUrl, stillUrl } from "./api.js";
import { PadNav, MUSIC_LINKS, nodeX } from "./padnav.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STOCK_STYLES = ["square", "person", "sphere"];
const STOCK_COLORS = ["grey", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
export const STOCK_AVATARS = STOCK_STYLES.flatMap((s) => STOCK_COLORS.map((c) => `stock:${s}_${c}`));

// PSN avatars: the pictures in content\Avatars\PSN (any file name), read at
// startup. No pictures there = no PSN avatars: everyone has the default grey
// face. These arrays are filled in place by loadPsnAvatars() so imported
// references stay live.
export const PSN_AVATARS = [];
export const ALL_AVATARS = [...STOCK_AVATARS];

// The default PSN avatar (the white square face): a new PSN account starts
// with it and 1 % of random PSN friends have it; it can't be chosen again
// once changed. The other system avatars are for Users only.
export const PSN_DEFAULT_AVATAR = "stock:square_grey";
export function randomPsnAvatar() {
  if (Math.random() < 0.01 || !PSN_AVATARS.length) return PSN_DEFAULT_AVATAR;
  return PSN_AVATARS[Math.floor(Math.random() * PSN_AVATARS.length)];
}

// Avatars loading (Avatar selection, PSN cards): a box with the class av-wait
// shows the media loading icon until its picture is there.
function avDone(img) { const p = img && img.parentElement; if (p && p.classList.contains("av-wait")) p.classList.remove("av-wait"); }
document.addEventListener("load", (e) => { if (e.target && e.target.tagName === "IMG") avDone(e.target); }, true);
document.addEventListener("error", (e) => { if (e.target && e.target.tagName === "IMG" && e.target.getAttribute("src")) avDone(e.target); }, true);
// (pictures already there when the box is made)
export function avWaitCheck(root) {
  for (const box of (root || document).querySelectorAll(".av-wait")) {
    const img = box.querySelector(":scope > img");
    if (img && img.getAttribute("src") && img.complete && img.naturalWidth) box.classList.remove("av-wait");
  }
}

let _avatarsLoaded = null;
let _psnDir = "";   // content\Avatars\PSN
export function loadPsnAvatars() {
  if (_avatarsLoaded) return _avatarsLoaded;
  _avatarsLoaded = (async () => {
    // only content\Avatars\PSN (read now, at startup: a restart picks up new
    // ones); the old built-in set isn't used, so an empty folder means none
    PSN_AVATARS.length = 0;
    try {
      const own = await call("list_psn_avatars");
      if (own && own.dir) _psnDir = own.dir;
      for (const f of (own && own.files) || []) PSN_AVATARS.push(`psnf:${f}`);
    } catch (e) {}
    ALL_AVATARS.length = 0;
    ALL_AVATARS.push(...STOCK_AVATARS, ...PSN_AVATARS);
    return PSN_AVATARS;
  })();
  return _avatarsLoaded;
}

// A video square in a grid: its first frame is loaded only once the square
// comes near the view (a grid can hold many videos, each one a player).
const lazyVideoHTML = (cls, src) => `<video class="${cls} lazyvid" data-src="${src}#t=0.5" muted preload="none" playsinline></video>`;
export function watchLazyVideos(root) {
  const vids = [...root.querySelectorAll("video.lazyvid[data-src]")];
  if (!vids.length) return;
  const load = (v) => { if (!v.dataset.src) return; v.preload = "metadata"; v.src = v.dataset.src; delete v.dataset.src; };
  if (!window.IntersectionObserver) { vids.forEach(load); return; }
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { load(e.target); io.unobserve(e.target); } },
    { root: root.querySelector(".avpick-scroll"), rootMargin: "200px 0px" });
  vids.forEach((v) => io.observe(v));
}
// The pictures of a grid (Photo Gallery, Choose an Image, the playlist
// pickers) are drawn at the size they're shown, once they come near the view,
// and let go once they're far from it (more than about a screen and a half
// away): the grid holds only small copies of the pictures around what's shown,
// whatever its size (a picture shown as an <img> would stay decoded at full
// size in the webview's picture memory long after it scrolled away).
// Scrolling back draws them again.
export function watchFarImages(root) {
  if (root._farIO) { root._farIO.disconnect(); root._farIO = null; }
  if (!window.IntersectionObserver) return;
  const imgs = [...root.querySelectorAll("img.avpick-av")];
  if (!imgs.length) return;
  for (const img of imgs) { const u = img.getAttribute("src"); if (u) { img.dataset.far = u; img.removeAttribute("src"); } }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const show = (img) => {
    if (img._cv || img._loading) return;
    const url = img.dataset.far; if (!url) return;
    img._loading = true;
    const src = new Image(); src.decoding = "async";
    src.onload = async () => {
      img._loading = false;
      if (!img.isConnected || !img._near) { src.onload = src.onerror = null; src.src = ""; return; }
      const box = img.getBoundingClientRect(), cover = getComputedStyle(img).objectFit === "cover";
      const bw = Math.max(1, Math.round((box.width || 140) * dpr)), bh = Math.max(1, Math.round((box.height || 140) * dpr));
      const fit = cover ? Math.max(bw / src.naturalWidth, bh / src.naturalHeight) : Math.min(bw / src.naturalWidth, bh / src.naturalHeight);
      const sc = Math.min(1, fit);
      const w = Math.max(1, Math.round(src.naturalWidth * sc)), h = Math.max(1, Math.round(src.naturalHeight * sc));
      try {
        const bmp = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
        src.onload = src.onerror = null; src.src = "";
        if (!img.isConnected || !img._near) { bmp.close(); return; }
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.className = img.className + " far-cv";
        cv.getContext("2d").drawImage(bmp, 0, 0); bmp.close();
        img.style.display = "none"; img.after(cv); img._cv = cv; avDone(img);
      } catch (e) { img.src = url; }   // (no bitmap: shown as a picture)
    };
    // (a still that can't be made: the picture's own error handling takes over)
    src.onerror = () => { img._loading = false; if (img.isConnected) img.src = url; };
    src.src = url;
  };
  const hide = (img) => {
    if (img._cv) { img._cv.width = 0; img._cv.remove(); img._cv = null; img.style.display = ""; }
    if (img.getAttribute("src") && !img.dataset.vsrc) { img.dataset.far = img.getAttribute("src"); img.removeAttribute("src"); }
  };
  // (the cells are watched: a picture's own element is hidden while its drawing shows)
  const io = new IntersectionObserver((es) => {
    for (const e of es) { const img = e.target._farImg; if (!img) continue; img._near = e.isIntersecting; if (e.isIntersecting) show(img); else hide(img); }
  }, { root: root.querySelector(".avpick-scroll"), rootMargin: "150% 0px" });
  imgs.forEach((i) => { const cell = i.parentElement; if (cell) { cell._farImg = i; io.observe(cell); } });
  root._farIO = io;
}
// A video's still in a grid (its Change Icon picture, or its own frame made
// by the system): if no still can be made (no ffmpeg), the video itself
// shows its frame there instead, as before.
export function watchStillFallback(root) {
  for (const img of root.querySelectorAll("img[data-vsrc]")) {
    img.addEventListener("error", () => {
      const v = document.createElement("template");
      v.innerHTML = lazyVideoHTML(img.className, img.dataset.vsrc);
      img.parentElement?.classList.remove("av-wait");
      img.replaceWith(v.content.firstChild);
      watchLazyVideos(root);
    }, { once: true });
  }
}
const VIDEO_RE = /\.(mp4|m4v|webm|mkv|avi|mov|wmv|asf|flv|mpg|mpeg|m2ts|mts|ts|vob|3gp|ogv|divx|3g2|f4v|rm|rmvb|mxf|ogm|dv|mod|tod|m2v|m1v|mpe|mpv|m2t|trp|tp|evo|vro|qt|amv|nsv|xvid|h264|264|hevc|265|y4m|bik|nut)$/i;
// A PSN avatar that isn't in content\Avatars\PSN (any more), or one of the
// old built-in set: the default grey face instead (friends, accounts, users)
export function liveAvatar(ref) {
  if (typeof ref === "string" && (ref.startsWith("psn:") || ref.startsWith("psnf:")) && !PSN_AVATARS.includes(ref)) return PSN_DEFAULT_AVATAR;
  return ref;
}
export const isStockAvatar = (ref) => /^stock:/.test(String(liveAvatar(ref) || ""));
export function avatarSrc(ref) {
  ref = liveAvatar(ref);
  if (!ref) return "./assets/icons/theme/icon_user.png";
  if (ref.startsWith("stock:")) return `./assets/icons/avatars/stock/${ref.slice(6)}.png`;
  if (ref.startsWith("psn:")) {
    // (an old save's avatar from the removed built-in set: the grey face)
    return "./assets/icons/avatars/stock/square_grey.png";
  }
  if (ref.startsWith("psnf:")) {
    const T = window.__TAURI__, p = `${_psnDir}${/[\\/]$/.test(_psnDir) ? "" : "\\"}${ref.slice(5)}`;
    return (T && T.core && _psnDir) ? T.core.convertFileSrc(p) : "./assets/icons/avatars/stock/square_grey.png";
  }
  if (ref.startsWith("sys:")) return sysBase(ref.slice(4));
  const T = window.__TAURI__;
  return (T && T.core) ? T.core.convertFileSrc(ref) : ref;
}
// Sliders move by their smallest step; holding the button speeds them up
// (x5 after ~1 s of repeats, then x25 and x100 on long ranges) so long ranges stay quick.
const _accel = { key: null, t: 0, n: 0 };
export function holdAccel(key, maxMult = 25) {
  const now = performance.now();
  if (_accel.key === key && now - _accel.t < 260) _accel.n++; else _accel.n = 0;
  _accel.key = key; _accel.t = now;
  const m = _accel.n < 8 ? 1 : _accel.n < 22 ? 5 : _accel.n < 40 ? 25 : 100;
  return Math.max(1, Math.min(m, Math.floor(maxMult)));
}
export function isMaskAvatar(ref) { return !ref || ref.startsWith("sys:"); }


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
    // over a background picture (a game's / a section's): the stripe version
    const withBg = !!document.querySelector(".bg-layer.show");
    this.el.className = `gamemenu show${withBg ? " bg" : ""}${swatches ? " swatches" : ""}`;
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
  close() { this.el.className = "sidemenu"; this.el.innerHTML = ""; this.spin = null; }
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
    this.el.className = "sidemenu info show";
    this.el.innerHTML = `<div class="gi-title">${esc(game.copy > 1 ? `${game.title} (${game.copy})` : game.title)}</div>
      <div class="gi-desc">${esc(game.description || "")}</div>
      <dl class="gi-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }
  close() { this.el.className = "sidemenu"; this.el.innerHTML = ""; }
  onInput(a) { if (a === "back") { this.audio.play("back", 0.5); this.close(); this.onClose && this.onClose(); } }
}

// Accessory Settings > On-Screen Keyboard: when off, the on-screen keyboard
// never opens (text is typed with the keyboard into the fields themselves).
export const VIRTUAL_KB = { on: true };
const useOsk = () => VIRTUAL_KB.on && Input.lastKind === "controller";

// ------------------------------------------------------------- TextForm
// The console's text entry screen: the two rules, the prompt ("Enter a name
// for the playlist."), the field(s), OK, and ✕ Edit / ○ Back. With a
// controller, ✕ on a field opens the on-screen keyboard; with a keyboard the
// field is typed in directly (Enter = OK, Esc = Back).
const autoPrompt = (label) => {
  const l = String(label || "").replace(/\s*\(.*\)$/, "");
  if (!l) return "";
  return `Enter ${/^[aeiou]/i.test(l) ? "an" : "a"} ${l.charAt(0).toLowerCase()}${l.slice(1)}.`;
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

// ------------------------------------------------------------ PlaylistPicker
// "Select a playlist.": the picture / song on the left (with its name and
// date), Create New Playlist and the playlists in the middle; ✕ Enter / ○ Back.
export class PlaylistPicker {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); }
  // { thumb, name, date, playlists: [{ name, count }], noun: ["Image", "Images"], folderIcon }
  open(o, onPick, onCancel) {
    this.o = o; this.onPick = onPick; this.onCancel = onCancel; this.sel = 0; this.top = 0;
    this._render();
  }
  _render() {
    const o = this.o, n = o.noun || ["Item", "Items"];
    this.el.className = "form show plpick"; document.body.classList.add("menu-open");
    // (noCreate: only the playlists, no "Create New Playlist" row)
    const rows = [...(o.noCreate ? [] : [{ icon: mpIcon("mp_addplaylist"), label: "Create New Playlist" }]),
      ...o.playlists.map((p) => ({ icon: o.folderIcon || "./assets/icons/theme/icon_photo_album_default.png", label: p.name,
        sub: `${p.count} ${p.count === 1 ? n[0] : n[1]}` }))];
    this.rows = rows;
    const VIS = 3;
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + VIS) this.top = this.sel - VIS + 1;
    this.el.innerHTML = `<div class="plp">
      <div class="plp-item">${o.thumbTint ? `<span class="plp-thumb plp-tint" style="--plp-mask:url('${o.thumbTint}')"></span>`
        : o.thumb ? `<img class="plp-thumb" src="${o.thumb}" alt="">` : ""}
        <div class="plp-name">${esc(o.name || "")}</div><div class="plp-date">${esc(o.date || "")}</div></div>
      <div class="plp-title">${esc(o.title || "Select a playlist.")}</div>
      ${!rows.length ? `<div class="plp-empty">${esc(o.empty || "There are no playlists.")}</div>` : ""}
      <div class="plp-list">${rows.slice(this.top, this.top + VIS).map((r, k) => { const i = this.top + k;
        return `<div class="plp-row${i === this.sel ? " sel" : ""}" data-i="${i}"><img class="plp-icon" src="${r.icon}" alt="">
          <div class="plp-text"><div class="plp-label">${esc(r.label)}</div>${r.sub ? `<div class="plp-sub">${esc(r.sub)}</div>` : ""}</div></div>`; }).join("")}
        ${this.top > 0 ? `<img class="plp-more up" src="./assets/icons/vp/arrow_up.png" alt="">` : ""}
        ${this.top + VIS < rows.length ? `<img class="plp-more dn" src="./assets/icons/vp/arrow_down.png" alt="">` : ""}</div>
    </div>
    <div class="confirm-foot">
      <span class="cf-hint"><span class="cf-glyph cf-x">✕</span>Enter</span>
      <span class="cf-hint"><span class="cf-glyph cf-o">○</span>Back</span>
    </div>`;
    this.el.querySelectorAll(".plp-row").forEach((r) => r.addEventListener("click", () => { this.sel = +r.dataset.i; this._pick(); }));
  }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  _pick() {
    if (!this.rows.length) { this.audio.play("error", 0.4); return; }
    this.audio.play("enter", 0.6);
    this.onPick && this.onPick(this.o.noCreate ? this.sel : this.sel === 0 ? "new" : this.sel - 1);
  }
  onInput(a) {
    if (a === "up" && this.sel > 0) { this.sel--; this.audio.play("cursor_up", 0.4); this._render(); }
    else if (a === "down" && this.sel < this.rows.length - 1) { this.sel++; this.audio.play("cursor_down", 0.4); this._render(); }
    else if (a === "enter") this._pick();
    else if (a === "back") { this.audio.play("back", 0.5); this.onCancel && this.onCancel(); }
  }
}

// ---------------------------------------------------- PSN Sign-In / Sign-Up screens
// Laid out from the console's Sign-In screen (1920x1080 captures): the two rules
// at 17.1 % / 82.1 %, the fields, the Auto-Sign-In / Save Password checkboxes,
// the buttons and the ✕ Enter / ○ Back hints under the bottom rule.
// Up / down moves; ✕ edits a field (on-screen keyboard with a controller,
// typing otherwise), ticks a box or presses a button; △ shows what the row does.
// Auto Sign-In ticks Save Password and greys it out (it can't be unticked then).
// loading(text) swaps the screen for "Signing in... / Please wait." with
// ○ Cancel (the clock at the top right is the XMB's loading clock).
const PS_CB = (on) => `./assets/icons/system/checkbox_${on ? "on" : "off"}.png`;
const PS_LAYOUT = {
  // label centres, field tops, checkbox centres, button tops (vh)
  signin: { lab: [32.96, 43.43], fld: [34.35, 44.81], chk: [51.94, 55.74], btn: [59.63, 67.31] },
  signup: { lab: [26.46, 36.93, 47.39], fld: [27.85, 38.31, 48.78], chk: [55.91, 59.71], btn: [63.6, 71.28] },
};
export class PsnSignIn {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); this.osk = new OnScreenKeyboard(audio); }
  // mode "signin": Sign-In ID (e-mail address or Online ID) + password,
  //   buttons Sign In / Forgot your password? (onAlt)
  // mode "signup": Online ID + Sign-In ID + password,
  //   buttons Sign Up / Sign In with an Existing Account (onAlt)
  open({ mode = "signin", onlineId = "", email = "", password = "", auto = false, save = false } = {}, onSubmit, onCancel, onAlt) {
    this.mode = mode;
    this.v = { onlineId, email, password, auto: !!auto, save: !!(save || auto) };
    this.onSubmit = onSubmit; this.onCancel = onCancel; this.onAlt = onAlt;
    this.fields = mode === "signup"
      ? [{ k: "onlineId", label: "Online ID", type: "text", max: 16 },
         { k: "email", label: "Sign-In ID (E-mail Address):", type: "email" },
         { k: "password", label: "Password", type: "password" }]
      : [{ k: "email", label: "Sign-In ID (E-mail Address):", type: "text" },
         { k: "password", label: "Password", type: "password" }];
    this.buttons = mode === "signup"
      ? [{ k: "go", label: "Sign Up" }, { k: "alt", label: "Sign In with an Existing Account" }]
      : [{ k: "go", label: "Sign In" }, { k: "alt", label: "Forgot your password?" }];
    this.rows = [...this.fields.map((f) => f.k), "auto", "save", "go", "alt"];
    // with everything filled in (Save Password) the cursor waits on Sign In
    const firstEmpty = this.fields.findIndex((f) => !this.v[f.k]);
    this.r = firstEmpty < 0 ? this.rows.indexOf("go") : firstEmpty;
    this._oskActive = false; this._loading = null;
    this._render();
  }
  _render() {
    const v = this.v, L = PS_LAYOUT[this.mode];
    this._loading = null; document.body.classList.remove("psn-loading");
    this.el.className = `form show psnsign ps-${this.mode}`; document.body.classList.add("menu-open");
    this.el.innerHTML = `
      <div class="ps-hold"></div>
      ${this.fields.map((f, i) => `
      <div class="ps-lab" style="top:${L.lab[i]}vh">${esc(f.label)}</div>
      <label class="ps-field" data-row="${f.k}" style="top:${L.fld[i]}vh"><input class="ps-in" data-k="${f.k}" type="${f.type}"${f.max ? ` maxlength="${f.max}"` : ""} spellcheck="false" autocomplete="off" value="${esc(v[f.k])}"></label>`).join("")}
      <div class="ps-check" data-row="auto" style="top:${L.chk[0]}vh"><img class="ps-box" alt="" src="${PS_CB(v.auto)}"><span>Sign In Automatically (Auto Sign-In)</span></div>
      <div class="ps-check${v.auto ? " dis" : ""}" data-row="save" style="top:${L.chk[1]}vh"><img class="ps-box" alt="" src="${PS_CB(v.save)}"><span>Save Password</span></div>
      ${this.buttons.map((b, i) => `<button class="ps-btn ps-b${i + 1}${b.k === "go" && !this._canGo() ? " off" : ""}" data-row="${b.k}" style="top:${L.btn[i]}vh">${esc(b.label)}</button>`).join("")}
      <div class="ps-foot"><span class="ps-hint ps-h1"><span class="ps-glyph">✕</span><span class="ps-act">Enter</span></span><span class="ps-hint ps-h2"><span class="ps-glyph">○</span>Back</span></div>`;
    this.el.querySelectorAll(".ps-in").forEach((inp) => {
      inp.addEventListener("input", () => { this.v[inp.dataset.k] = inp.value; this._syncBtn(); });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); inp.blur(); this._move(1); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); inp.blur(); }
        else e.stopPropagation();          // typing goes to the field, not the menu
      });
      inp.addEventListener("focus", () => { this.r = this.rows.indexOf(inp.dataset.k); this._focus(false); });
    });
    this.el.querySelectorAll("[data-row]").forEach((n) => n.addEventListener("pointerdown", (e) => {
      this.r = this.rows.indexOf(n.dataset.row); this._focus(false);
      if (n.tagName !== "LABEL") { e.preventDefault(); this._press(); }
    }));
    this._focus(false);
  }
  _canGo() { return this.fields.every((f) => String(this.v[f.k] || "").trim()); }
  _syncBtn() { const b = this.el.querySelector('[data-row="go"]'); if (b) b.classList.toggle("off", !this._canGo()); }
  _focus(sound = true) {
    const row = this.rows[this.r];
    this.el.querySelectorAll("[data-row]").forEach((n) => n.classList.toggle("sel", n.dataset.row === row));
    // ✕ Edit on a text field, ✕ Enter on a box or a button
    const act = this.el.querySelector(".ps-h1 .ps-act"); if (act) act.textContent = this.fields.some((f) => f.k === row) ? "Edit" : "Enter";
    // a greyed-out box can't be changed: no ✕ Enter on it
    // (✕ Enter stays shown on every row, the greyed Save Password too)
    if (sound) this.audio.play("cursor_down", 0.4);
  }
  _move(d) {
    const n = Math.max(0, Math.min(this.rows.length - 1, this.r + d));
    if (n !== this.r) { this.r = n; this._focus(); }
  }
  _hold() {
    const up = this.mode === "signup";
    const info = {
      onlineId: "Enter the Online ID (3 to 16 letters, numbers, hyphens or underscores) other players will see.",
      email: up ? "Enter the e-mail address to use as the Sign-In ID for this account."
                : "Enter the e-mail address you used to create your account, or its Online ID.",
      password: up ? "Enter a password for this account." : "Enter the password for your account.",
      auto: "Signs you in to PlayStation™Network automatically when this user logs in. Save Password is turned on too.",
      save: "Saves the Sign-In ID and password, so you only need to select Sign In next time.",
      go: up ? "Creates the account and signs in to PlayStation™Network." : "Signs in to PlayStation™Network.",
      alt: up ? "Sign in with an account that already exists." : "Set a new password for the account with the Sign-In ID entered above.",
    }[this.rows[this.r]];
    const t = this.el.querySelector(".ps-hold"); if (!t || !info) return;
    t.textContent = info; t.classList.add("on");
    clearTimeout(this._holdT);
    this._holdT = setTimeout(() => { if (t.isConnected) t.classList.remove("on"); }, 4000);
  }
  _setBox(row, on) {
    this.v[row] = on;
    const b = this.el.querySelector(`[data-row="${row}"] .ps-box`); if (b) b.src = PS_CB(on);
  }
  _press() {
    const row = this.rows[this.r];
    const fld = this.fields.find((f) => f.k === row);
    if (fld) {
      if (useOsk()) {
        this._oskActive = true;
        this.osk.open(this.el, { title: fld.label.replace(/:$/, ""), initial: this.v[row], password: fld.type === "password" },
          (text) => { this._oskActive = false; this.v[row] = fld.max ? text.slice(0, fld.max) : text; this._render(); if (text) this._move(1); },
          () => { this._oskActive = false; this._render(); });
      } else {
        const inp = this.el.querySelector(`.ps-in[data-k="${row}"]`); if (inp) inp.focus();
      }
      return;
    }
    if (row === "auto") {
      this.audio.play("enter", 0.4);
      this._setBox("auto", !this.v.auto);
      if (this.v.auto) this._setBox("save", true);       // Auto Sign-In needs the saved password
      this.el.querySelector('[data-row="save"]')?.classList.toggle("dis", this.v.auto);
      this._focus(false);
      return;
    }
    if (row === "save") {
      if (this.v.auto) { this.audio.play("error", 0.4); return; }   // greyed out
      this.audio.play("enter", 0.4); this._setBox("save", !this.v.save);
      return;
    }
    if (row === "go") {
      if (!this._canGo()) { this.audio.play("error", 0.4); return; }
      this.audio.play("enter", 0.6);
      const out = { ...this.v };
      for (const f of this.fields) if (f.type !== "password") out[f.k] = String(out[f.k]).trim();
      this.onSubmit && this.onSubmit(out);
      return;
    }
    if (row === "alt") { this.audio.play("enter", 0.5); this.onAlt && this.onAlt({ ...this.v, email: this.v.email.trim() }); }
  }
  // the "Signing in... / Please wait." screen; ○ cancels (onCancel)
  loading(text, onCancel) {
    this._oskActive = false; clearTimeout(this._holdT);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this._loading = { onCancel };
    this.el.className = "form show psnsign psload"; document.body.classList.add("menu-open", "psn-loading");
    this.el.innerHTML = `<div class="ps-wait">${String(text).split("\n").map((l) => `<div>${esc(l)}</div>`).join("")}</div>
      <div class="ps-foot"><span class="ps-hint ps-h2"><span class="ps-glyph">○</span>Cancel</span></div>`;
    this.el.querySelector(".ps-h2").addEventListener("pointerdown", () => this.onInput("back"));
  }
  close() {
    this._oskActive = false; this._loading = null; clearTimeout(this._holdT);
    this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open", "psn-loading");
  }
  onInput(a) {
    if (this._loading) {
      if (a === "back" && this._loading.onCancel) { const c = this._loading.onCancel; this._loading.onCancel = null; this.audio.play("back", 0.5); c(); }
      return;
    }
    if (this._oskActive) { this.osk.onInput(a); return; }
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("ps-in")) {
      const inp = document.activeElement;
      if (a === "enter") { inp.blur(); this._move(1); return; }
      if (a === "back") { inp.blur(); return; }
      if (a === "up" || a === "down") inp.blur(); else return;
    }
    switch (a) {
      case "up": this._move(-1); break;
      case "down": this._move(1); break;
      case "enter": this._press(); break;
      case "options": this._hold(); break;
      case "start": this.r = this.rows.indexOf("go"); this._focus(); this._press(); break;
      case "back": this.audio.play("back", 0.5); this.onCancel && this.onCancel(); break;
    }
  }
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
    return `<div class="osk-symp">${this.symTop > 0 ? `<span class="osk-symup"></span>` : ""}<div class="osk-symgrid">${cells}</div>
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

// ---------------------------------------------------------- AvatarPicker
// kept decoded so the avatar menu's SELECT badge is never missing on a re-render
// (embedded: it can never be missing, even while other pictures are still loading)
const SELECT_BADGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGsAAAAfCAYAAADgDDPbAAAABGdBTUEAANbY1E9YMgAAABl0RVh0U29mdHdhcmUAQWRvYmUgSW1hZ2VSZWFkeXHJZTwAAAWxSURBVHja7FpdbxtFFL1BxNC4InaFQyHBjaN8IBvShJrSkvBRRJNKPLQqVPwE3uCZX8AzvCHxB1ABlQekhiI+k7aYtE4CiYgTNWmIQ4irOkVx2toPYc6wY12v1+ux401ttEca7cbxrufOmXvn3DvTtLOzQy4aAw9X8uUPPvr6qLgMiRYVLSxaUDS/aE3uUGrhtmgros2JNinaxIfvvxnTfbipnGcJglrF5Zxo7xokuagtQNonop0XxN2pmixB1Glx+djwIEqtLdP66qK8bt76i7bu3Kb79zLkhlI9PLpvP+1vPUC+x5+kwFOddLCjW14NwOPeE4R9VTFZgqgxcRmRb1mcoRtz12h5Pk7Z+3fdUa8RPI/so86+QeoKH6Fgd7/6+BtB2Kg2WYKoGXF57p90iuau/Uh/xH9ySXKYtGcGX6HwkVfpMX8AH/0mCOsvS5byqPU/F2n6ykW6mZh2R3OPcKj3MB0+fooOPt1t6WEFZBlr1AV41JVLn1VElMfTTD6fX97ncllKpzf/FwPY1ta2pzaBsOMn31EedoavYXmyDNWH8Be8+u3nNHN1TOvlfr+PIpEIPdEWKPg8m81RYmGBlpaW5D03/uXhl7Te/fvsHM3PJ+T9W2fPFH1mh+HhoaI+lcIXX14o+Nvr9dKzkTB1dLQX2bSaTNLs7GyBTapvujD/nhn9x0bp2BtvK9HRr1TiQ+w7kOdBiAmsUTqAMa+feM1yUOBpMHh4aEjeNwpCoU46NXqyiChlU5f4/+jIiJykTgHjDx4MFX7OKilGHiVVn66YABkAwkN8aiofJmBUb08P9fX1SqNCoZClN8BL7EJLJpPZteF4P35HN0o8PziQ/208t7qazNsEO2Az7l88+gJ99/0P0sN+Hr9c9B41NuVstALGHzwYChG8fJony6hMRJE/QZ7rGoZwASDc8Q7BAHTS5/dLrwt1HrIkC89sbGw46inZXE77N0CAIkoRwW1SNoAI2N7e3i7C/LLt+6u1ETyk1k4gD4uCH1Q6lGehhCQTXl2vam72sHvrMJdILFAqlWqI8Mcn37zoNyeKA4QFAgHD2zzOTTLBA/gwkmbwkycrqioUutjcTLNwGJEdR8jgoQszymnPqbXqA+Atdhgfn9iTPjE+onzNkgEWJSRt5o1Qp2I4rmgg6++NFG1vb0ui7OI1vp/t7bGeDOm09lpj6zE+n1SGpQBlhz4qb0Hf6wWMjzAnS9b+UOurBAgJIAdiQqkjhJKu0H/hhAQZMD4Wi1mGFScVFVdwdhI+kfDUrbczPoKcLOj5Aygy3ru7VdELEfrQVFIMAnytrTKsqIEaHBigX2K/Fj17Q4QbeKC152ZrYjAm09LyTUcVp1MAH4yfPFmINwOoBt9aX6luQczmCtYoEAWSkK+gQdqbvSuZXHN8TdvKbGsl0RBCmFg6iTTCN5QuntF5d7UAH4yffFKMPRVerteqECBzL7UegBg+o1Upql7BJw0SY7uwivxRtzqyGzA+JjlZUt5gfwUVYC2lYkhydFpJXjO83paGCDcqH1J97BOip1TVBYmxFcE1X2sFD+CD8yPDIBIukXhNIgHD/kpi5rLWWqWydNT6eLavSlGQ9EphWZFVTmDgGfNzLS0tBTLbzkOk0SIHtPs+f+Z6fFragsmHMlqpCoayycnCLngwPGtSbf3zchO2lqPYCNPZZMQgXo9PyfIMjEP2ryoA5nAIeWxXrioFq6ItanNdNmHKXCTFhChXOFbPgDQdm0ASFK6TXgUeGC/EwyBwHqoD9ShshOkAySPqYqVyE6g9lG0aabsENl0cu1QQJcy55fjERMkKRy2A8TfqgisGLxKO7Gc5Hc8fRGWjrvazGGHuTvEDQkU7xYww9wzGHqLqMxhmD5OB0z3d5BhJuz7dZFrD3HODNYJj5wYZYe6JXGdRmxO5FsS5Z913B2fPuruoH/wrwACgnkiG+g6VpQAAAABJRU5ErkJggg==";
const _selectBadge = new Image(); _selectBadge.src = SELECT_BADGE;
export class AvatarPicker {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); }
  // opts: { set: "stock"|"all", photos: [paths] } : user picker = stock (+photos), PSN = all
  open(current, opts, onPick, onCancel) {
    this.onPick = onPick; this.onCancel = onCancel;
    this.photos = (opts && opts.photos) || [];
    // PSN: the PSN avatars only (never the default white face: it only shows
    // as the one in use); Users: the system avatars (+ photos)
    this.list = (opts && opts.set === "psn") ? [...PSN_AVATARS]
      : (opts && opts.set === "all") ? ALL_AVATARS : STOCK_AVATARS;
    this.mode = "avatars";
    this.current = current;              // the avatar currently equipped
    this.items = this.list;
    this.i = Math.max(0, this.list.indexOf(current));
    this.chosen = null; this.act = -1;
    this._render("Choose a Picture", this.photos.length ? "Choose Photo" : null);
  }
  // generic image chooser (used for Theme background images)
  // covers: { video path: its Change Icon picture }
  openImages(paths, current, onPick, onCancel, title, covers = {}) {
    this.onPick = onPick; this.onCancel = onCancel; this.photos = []; this.covers = covers || {};
    this.mode = "images"; this.items = paths; this.current = current;
    this.i = Math.max(0, paths.indexOf(current));
    this.chosen = null; this.act = -1;
    this._render(title || "Choose an Image", null);
  }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  _srcOf(v) { return this.mode === "avatars" ? avatarSrc(v) : avatarSrc(v); }
  // a cell / preview picture: videos show their first frame, muted
  _media(v, cls) {
    // a small copy of a picture from the computer (the squares and the two
    // previews at the top are small; the system's own avatars are small
    // already); the grid's squares load as they come into view, videos too
    // videos and GIFs: a still (a video's Change Icon picture or its frame, a
    // GIF's first frame), small
    const grid = cls === "avpick-av", own = v != null && /^(stock|psnf?|sys):/.test(String(v));
    const vid = v != null && VIDEO_RE.test(String(v));
    const src = v == null ? "" : own ? this._srcOf(v) : stillUrl(String(v), (this.covers || {})[v]);
    const fallback = vid ? ` data-vsrc="${this._srcOf(v)}"` : "";
    return `<img class="${cls}" src="${src}" alt=""${fallback}${grid ? ' loading="lazy" decoding="async"' : ""}>`;
  }
  // XMB "Avatar Selection" (Avatar Selection XMB.png): a dark-navy translucent
  // rounded panel, header with a live preview of the selected avatar + a
  // "Select an avatar." label (no Premium-Avatars dropdown), a 6-wide grid
  // showing 2 rows at a time (the rest scroll) with the scroll rail on the LEFT,
  // and blue Cancel / Confirm buttons.
  _render(title, altLabel) {
    this.el.className = `form show avpick${this.mode === "images" ? " avimages" : ""}`; document.body.classList.add("menu-open");
    const cur = this.items[this.i];
    this.el.innerHTML = `<div class="avpick-title">${esc(title)}</div>
      <div class="avpick-panel">
        <div class="avpick-head">
          <div class="avpick-current av-wait">${this._media(this.current != null ? this.current : cur, "")}</div>
          <img class="avpick-arrow" src="./assets/icons/system/tex_arrow_r.png" alt="">
          <div class="avpick-preview av-wait">${this._media(cur, "")}</div>
          <div class="avpick-hint">${this.mode === "images" ? "Select an image." : "Select an avatar."}</div>
          <div class="avpick-dd">All<span class="avpick-dd-chev"></span></div>
        </div>
        <div class="avpick-rule r1"></div>
        <div class="avpick-rule r2"></div>
        <div class="avpick-scroll"><div class="avpick-grid">${this.items.map((a, i) =>
          `<div data-i="${i}" class="avpick-cell av-wait${i === this.i ? " sel" : ""}">${this._media(a, "avpick-av")}</div>`).join("")}</div></div>
        <div class="avpick-actions">
          <button class="form-cancel">Cancel</button>
          ${altLabel ? `<button class="form-alt">${esc(altLabel)}</button>` : ""}
          <button class="form-ok${this._canConfirm() ? "" : " disabled"}">Confirm</button></div>
      </div>
      <div class="avpick-foot"><div class="af-row"><span><span class="af-g">○</span>Back</span><span><span class="af-g">✕</span>Enter</span></div>
        <div class="af-sel"><img class="af-selimg" src="${SELECT_BADGE}" alt=""><span>Contact Us / Privacy Policy / Terms of Service</span></div></div>`;
    this.el.querySelectorAll(".avpick-cell").forEach((im) => im.addEventListener("click", () => { this.i = +im.dataset.i; this._choose(); }));
    watchLazyVideos(this.el); watchStillFallback(this.el); watchFarImages(this.el); avWaitCheck(this.el);
    this.el.querySelector(".form-ok").addEventListener("click", () => { if (this._canConfirm()) this._pick(); });
    this.el.querySelector(".form-cancel").addEventListener("click", () => this._cancel());
    const alt = this.el.querySelector(".form-alt");
    if (alt) alt.addEventListener("click", () => this._togglePhotos());
    // action buttons in DOM order (for controller navigation of the action row)
    this._acts = [...this.el.querySelectorAll(".avpick-actions button")];
    if (this.act == null) this.act = -1;   // -1 = grid focused
    this._applyActFocus();
    setTimeout(() => this.el.querySelector(".avpick-cell.sel")?.scrollIntoView({ block: "center" }), 30);
  }
  _applyActFocus() { (this._acts || []).forEach((b, i) => b.classList.toggle("act-focus", i === this.act)); }
  _togglePhotos() {
    this.audio.play("enter", 0.5); this.act = -1; this.chosen = null;
    if (this.mode === "avatars" && this.photos.length) { this.mode = "photos"; this.items = this.photos; this.i = 0; this._render("Choose a Photo", "Avatars"); }
    else { this.mode = "avatars"; this.items = this.list; this.i = 0; this._render("Choose a Picture", this.photos.length ? "Choose Photo" : null); }
  }
  _upd() {
    const cells = this.el.querySelectorAll(".avpick-cell");
    cells.forEach((im, i) => im.classList.toggle("sel", i === this.i));
    cells[this.i]?.scrollIntoView({ block: "nearest" });
    // the full-size preview once the cursor rests a moment (moving quickly
    // along the grid doesn't load every picture at full size)
    clearTimeout(this._prevT);
    this._prevT = setTimeout(() => {
      const prev = this.el.querySelector(".avpick-preview");
      if (prev && this.items[this.i] != null) { prev.classList.add("av-wait"); prev.innerHTML = this._media(this.items[this.i], ""); avWaitCheck(prev.parentElement); }
    }, 90);
  }
  // Confirm only lights up (and works) once a NEW picture has been pressed.
  _canConfirm() { return this.chosen != null && this.items[this.chosen] != null && this.items[this.chosen] !== this.current; }
  // Pressing a picture picks it and drops the focus onto Cancel / Confirm;
  // Up goes back to the picture.
  _choose() {
    this.chosen = this.i;
    this.audio.play("enter", 0.5);
    this.el.querySelectorAll(".avpick-cell").forEach((c, k) => c.classList.toggle("chosen", k === this.chosen));
    const ok = this.el.querySelector(".form-ok"); if (ok) ok.classList.toggle("disabled", !this._canConfirm());
    const prev = this.el.querySelector(".avpick-preview");
    if (prev && this.items[this.i] != null) { prev.classList.add("av-wait"); prev.innerHTML = this._media(this.items[this.i], ""); avWaitCheck(prev.parentElement); }
    const okIdx = this._acts.indexOf(ok);
    this.act = this._canConfirm() && okIdx >= 0 ? okIdx : 0;
    this._applyActFocus();
  }
  _pick() { if (!this._canConfirm()) return; this.audio.play("enter", 0.6); this.onPick && this.onPick(this.items[this.chosen]); }
  _cancel() { this.audio.play("back", 0.5); this.onCancel && this.onCancel(); }
  onInput(a) {
    const cols = 6;   // XMB Avatar Selection shows 6 columns (2 rows visible)
    // action row focused (Cancel / [alt] / Confirm) : reachable by controller
    if (this.act >= 0) {
      const usable = (k) => this._acts[k] && !this._acts[k].classList.contains("disabled");
      if (a === "left" && this.act > 0 && usable(this.act - 1)) { this.act--; this.audio.play("cursor_up", 0.3); this._applyActFocus(); }
      else if (a === "right" && this.act < this._acts.length - 1 && usable(this.act + 1)) { this.act++; this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
      else if (a === "up") { this.act = -1; this.audio.play("cursor_up", 0.3); this._applyActFocus(); }
      else if (a === "enter") { this._acts[this.act]?.click(); }
      else if (a === "back") this._cancel();
      return;
    }
    if (a === "left" && this.i > 0) { this.i--; this._upd(); }
    else if (a === "right" && this.i < this.items.length - 1) { this.i++; this._upd(); }
    else if (a === "up" && this.i - cols >= 0) { this.i -= cols; this._upd(); }
    else if (a === "down") {
      if (this.i + cols < this.items.length) { this.i += cols; this._upd(); }
      else if (this._acts && this._acts.length) {   // to Confirm when it's usable, else Cancel
        const last = this._acts.length - 1;
        this.act = this._acts[last].classList.contains("disabled") ? 0 : last;
        this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
    }
    else if (a === "enter") this._choose();
    else if (a === "back") this._cancel();
    else if (a === "options") this._togglePhotos();
  }
}

// -------------------------------------------------------- PhotoGrid
// A grid picker for the Photo Gallery: shows every saved photo as a thumbnail
// (same look as the avatar selector); picking one opens the fullscreen viewer.
export class PhotoGrid {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); }
  open(photos, resolveUrl, onPick, onCancel, startIndex = 0) {
    this.photos = photos || []; this.resolve = resolveUrl; this.onPick = onPick; this.onCancel = onCancel;
    this.i = Math.max(0, Math.min(startIndex | 0, this.photos.length - 1));
    this._render();
  }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  _render() {
    this.el.className = "form show avpick photogrid"; document.body.classList.add("menu-open");
    this.el.innerHTML = `<div class="avpick-title">Photo Gallery</div>
      <div class="avpick-panel">
        <div class="avpick-scroll"><div class="avpick-grid pg-grid">${this.photos.map((p, i) =>
          `<div data-i="${i}" class="avpick-cell${i === this.i ? " sel" : ""}"><img class="avpick-av" src="${this.resolve(p)}" alt="" loading="lazy" decoding="async"></div>`).join("")}</div></div>
        <div class="avpick-actions">
          <button class="form-cancel">Cancel</button>
          <button class="form-ok">View</button></div>
      </div>`;
    this.el.querySelectorAll(".avpick-cell").forEach((c) => c.addEventListener("click", () => { this.act = -1; this.i = +c.dataset.i; this._upd(); this._applyActFocus(); }));
    watchFarImages(this.el);
    this.el.querySelector(".form-ok").addEventListener("click", () => this._pick());
    this.el.querySelector(".form-cancel").addEventListener("click", () => this._cancel());
    this._acts = [...this.el.querySelectorAll(".avpick-actions button")];
    if (this.act == null) this.act = -1;
    this._applyActFocus();
    setTimeout(() => this.el.querySelector(".avpick-cell.sel")?.scrollIntoView({ block: "center" }), 30);
  }
  _applyActFocus() { (this._acts || []).forEach((b, i) => b.classList.toggle("act-focus", i === this.act)); }
  _upd() {
    const cells = this.el.querySelectorAll(".avpick-cell");
    cells.forEach((c, i) => c.classList.toggle("sel", i === this.i));
    cells[this.i]?.scrollIntoView({ block: "nearest" });
  }
  _pick() { this.audio.play("enter", 0.6); this.onPick && this.onPick(this.i); }
  _cancel() { this.audio.play("back", 0.5); this.onCancel && this.onCancel(); }
  onInput(a) {
    const cols = 6;
    if (this.act >= 0) {
      if (a === "left" && this.act > 0) { this.act--; this.audio.play("cursor_up", 0.3); this._applyActFocus(); }
      else if (a === "right" && this.act < this._acts.length - 1) { this.act++; this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
      else if (a === "up") { this.act = -1; this.audio.play("cursor_up", 0.3); this._applyActFocus(); }
      else if (a === "enter") { this._acts[this.act]?.click(); }
      else if (a === "back") this._cancel();
      return;
    }
    if (a === "left" && this.i > 0) { this.i--; this._upd(); }
    else if (a === "right" && this.i < this.photos.length - 1) { this.i++; this._upd(); }
    else if (a === "up" && this.i - cols >= 0) { this.i -= cols; this._upd(); }
    else if (a === "down") {
      if (this.i + cols < this.photos.length) { this.i += cols; this._upd(); }
      else if (this._acts && this._acts.length) { this.act = this._acts.length - 1; this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
    }
    else if (a === "enter") this._pick();
    else if (a === "back") this._cancel();
  }
}

// -------------------------------------------------------- Confirm
// Full-screen yes/no confirm (like the real XMB "Turn off the system?"): a
// centred title with the options laid out HORIZONTALLY below it, the current
// option glowing, and an X Enter / O Back footer.
export class Confirm {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); }
  // opts: [{ label, id }]
  open(title, opts, onDone, onCancel) {
    this.title = title; this.opts = opts; this.i = 0; this.onDone = onDone; this.onCancel = onCancel;
    this._render();
  }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  _render() {
    this.el.className = "form show"; document.body.classList.add("menu-open");
    this.el.innerHTML = `<div class="confirm">
      <div class="confirm-title">${esc(this.title)}</div>
      <div class="confirm-opts">${this.opts.map((o, i) =>
        `<button class="confirm-opt${i === this.i ? " sel" : ""}" data-i="${i}">${esc(o.label)}</button>`).join("")}</div>
    </div>
    <div class="confirm-foot">
      <span class="cf-hint"><span class="cf-glyph cf-x">✕</span>Enter</span>
      <span class="cf-hint"><span class="cf-glyph cf-o">○</span>Back</span>
    </div>`;
    this._nodes = [...this.el.querySelectorAll(".confirm-opt")];
    this._nodes.forEach((n) => n.addEventListener("click", () => { this.i = +n.dataset.i; this._done(); }));
  }
  _upd() { this._nodes.forEach((n, i) => n.classList.toggle("sel", i === this.i)); }
  _done() { this.audio.play("ok", 0.6); this.onDone && this.onDone(this.opts[this.i]); }
  _cancel() { this.audio.play("back", 0.5); this.onCancel && this.onCancel(); }
  onInput(a) {
    if (a === "left" && this.i > 0) { this.i--; this.audio.play("cursor_up", 0.35); this._upd(); }
    else if (a === "right" && this.i < this.opts.length - 1) { this.i++; this.audio.play("cursor_down", 0.35); this._upd(); }
    else if (a === "enter") this._done();
    else if (a === "back") this._cancel();
  }
}

// -------------------------------------------------------- ListPicker
// Full-screen titled list overlay (like the avatar picker) for choosing a
// background-music source, or multi-selecting songs to build a playlist.
const LP_ROW = 48;   // a list row's height (px), as styles.css draws it
// the Sign-In screen's footer hints: ✕ <enter> (left), □ <square> (middle, optional), ○ Back (right)
function usFoot(enter = "Enter", square = null, back = "Back") {
  return `<div class="us-foot">${enter ? `<span class="us-hint us-h1" data-a="enter"><span class="us-glyph">\u2715</span>${esc(enter)}</span>` : ""}` +
    `${square ? `<span class="us-hint us-hm" data-a="square"><span class="us-glyph">\u25A1</span>${esc(square)}</span>` : ""}` +
    `<span class="us-hint us-h2" data-a="back"><span class="us-glyph">\u25CB</span>${esc(back)}</span></div>`;
}
function usFootClicks(root, fn) {
  root.querySelectorAll(".us-hint[data-a]").forEach((h) => h.addEventListener("click", () => fn(h.dataset.a)));
}
export class ListPicker {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); }
  // opts: { title, items:[{label,id,sub?}], multi?, checked?:[ids], submit? }
  // opts.grid: show the items as thumbnails (item.thumb = picture URL,
  // item.video = true for a video's first frame), like the Photo Gallery
  open(opts, onDone, onCancel) {
    this.grid = !!opts.grid;
    this.items = opts.items; this.multi = !!opts.multi; this.i = 0; this.act = -1;
    this.checked = new Set(opts.checked || []); this.title = opts.title;
    this.submit = opts.submit || (this.multi ? "Save" : "Select");
    this.onDone = onDone; this.onCancel = onCancel;
    this.onSquare = opts.onSquare || null;   // Square cycles a mode, if provided
    this._render();
  }
  // Replace the list contents (and optionally the title) in place, keeping the
  // picker open. Used by the Square-cycled Background Music modes.
  setList(items, title) {
    this.items = items; this.i = 0;
    if (title != null) this.title = title;
    this._render();
  }
  _thumb(it) {
    // a font: "Aa" written in it
    if (it.fontUrl) {
      const fam = `lpgfont${(it.fontUrl.length * 31 + [...it.fontUrl].reduce((h, c) => (h * 33 + c.charCodeAt(0)) | 0, 7)) >>> 0}`;
      if (!document.getElementById(fam)) {
        const st = document.createElement("style"); st.id = fam;
        st.textContent = `@font-face { font-family: "${fam}"; src: url("${it.fontUrl}"); }`;
        document.head.appendChild(st);
      }
      return `<div class="avpick-av lpg-font" style="font-family: '${fam}', sans-serif">Aa</div>`;
    }
    const t = it.thumb;
    if (!t) return `<div class="avpick-av lpg-none"></div>`;
    if (it.vsrc) return `<img class="avpick-av" src="${t}" alt="" data-vsrc="${it.vsrc}" loading="lazy" decoding="async">`;
    if (it.video) return lazyVideoHTML("avpick-av", t);
    return `<img class="avpick-av" src="${t}" alt="" loading="lazy">`;
  }
  _renderGrid() {
    this.el.className = "form show avpick photogrid lpgrid"; document.body.classList.add("menu-open");
    const chk = (it) => this.multi ? `<img class="lpg-check" src="./assets/icons/system/${this.checked.has(it.id) ? "checkbox_on" : "checkbox_off"}.png" alt="">` : "";
    this.el.innerHTML = `<div class="avpick-title">${esc(this.title)}</div>
      <div class="avpick-panel">
        <div class="avpick-scroll"><div class="avpick-grid pg-grid">${this.items.map((it, i) =>
          `<div data-i="${i}" class="avpick-cell lpg-cell${i === this.i ? " sel" : ""}">${this._thumb(it)}${chk(it)}<div class="lpg-label">${esc(it.label)}</div></div>`).join("")}</div></div>
        <div class="avpick-actions">
          <button class="form-cancel">Cancel</button>
          <button class="form-ok">${esc(this.submit)}</button></div>
      </div>`;
    this._nodes = [...this.el.querySelectorAll(".lpg-cell")];
    this._nodes.forEach((n) => n.addEventListener("click", () => { this.act = -1; this._applyActFocus(); this.i = +n.dataset.i; this._upd(); this.multi ? this._toggle() : this._done(); }));
    watchLazyVideos(this.el); watchStillFallback(this.el); watchFarImages(this.el);
    this.el.querySelector(".form-ok").addEventListener("click", () => this._done());
    this.el.querySelector(".form-cancel").addEventListener("click", () => this._cancel());
    this._acts = [...this.el.querySelectorAll(".avpick-actions button")];
    this._applyActFocus();
    setTimeout(() => this.el.querySelector(".lpg-cell.sel")?.scrollIntoView({ block: "center" }), 20);
  }
  _applyActFocus() {
    const cls = this.grid ? "act-focus" : "sel";
    (this._acts || []).forEach((b, i) => b.classList.toggle(cls, i === this.act));
    if (!this.grid) this._updSel();
  }
  // The list: only the rows on screen (and a few around them) exist; the rest
  // are made as the list scrolls to them, with their song information (the
  // item's sub, or its subFn, worked out only then). Thousands of songs open
  // at once and scroll lightly.
  _render() {
    if (this.grid) { this._renderGrid(); return; }
    // laid out like the Sign-In screen: the title over the top rule, the list
    // and the buttons between the rules, ✕ / □ / ○ hints under the bottom one
    this.act = -1;
    this.el.className = "form show uisheet lpsheet"; document.body.classList.add("menu-open");
    this.el.innerHTML = `<div class="us-title">${esc(this.title)}</div>
      <div class="us-body">
        <div class="lp-list" style="height:${this.items.length * LP_ROW}px"><div class="lp-space" style="height:${this.items.length * LP_ROW}px"></div></div>
        <div class="us-btns"><button class="ui-btn form-cancel">Cancel</button><button class="ui-btn form-ok">${esc(this.submit)}</button></div>
      </div>
      ${usFoot(this.multi ? "Tick" : "Enter", this.onSquare ? "Change View" : null)}`;
    this._list = this.el.querySelector(".lp-list"); this._space = this.el.querySelector(".lp-space");
    this._rows = new Map();
    this._list.addEventListener("scroll", () => this._fill(), { passive: true });
    this._space.addEventListener("click", (e) => { const n = e.target.closest(".lp-item"); if (!n) return; this.act = -1; this._applyActFocus(); this.i = +n.dataset.i; this._updSel(); this.multi ? this._toggle() : this._done(); });
    this.el.querySelector(".form-ok").addEventListener("click", () => this._done());
    this.el.querySelector(".form-cancel").addEventListener("click", () => this._cancel());
    this._acts = [...this.el.querySelectorAll(".us-btns button")];
    usFootClicks(this.el, (a) => this.onInput(a));
    // the chosen row in the middle
    this._list.scrollTop = Math.max(0, this.i * LP_ROW - (this._list.clientHeight - LP_ROW) / 2);
    this._fill();
  }
  _rowHTML(it, i) {
    const sub = it.sub ?? (it.subFn ? (it.sub = it.subFn()) : "");
    return `<div class="lp-item${i === this.i ? " sel" : ""}" data-i="${i}" style="top:${i * LP_ROW}px">${this.multi ?
      `<img class="lp-check" src="./assets/icons/system/${this.checked.has(it.id) ? "checkbox_on" : "checkbox_off"}.png" alt="">` : ""}` +
      `<span class="lp-label">${esc(it.label)}</span>${sub ? `<span class="lp-sub">${esc(sub)}</span>` : ""}</div>`;
  }
  // the rows in view (and 8 around), the others removed
  _fill() {
    if (!this._list || this.grid) return;
    const top = this._list.scrollTop, h = this._list.clientHeight || 600;
    const a = Math.max(0, Math.floor(top / LP_ROW) - 8), b = Math.min(this.items.length - 1, Math.ceil((top + h) / LP_ROW) + 8);
    for (const [i, n] of this._rows) if (i < a || i > b) { n.remove(); this._rows.delete(i); }
    let html = "";
    const add = [];
    for (let i = a; i <= b; i++) if (!this._rows.has(i)) { html += this._rowHTML(this.items[i], i); add.push(i); }
    if (!add.length) return;
    const t = document.createElement("template"); t.innerHTML = html;
    const nodes = [...t.content.children];
    nodes.forEach((n, k) => this._rows.set(add[k], n));
    this._space.append(...nodes);
  }
  _updSel() { for (const [i, n] of this._rows) n.classList.toggle("sel", i === this.i && this.act < 0); }
  _upd() {
    if (this.grid) { this._nodes.forEach((n, i) => n.classList.toggle("sel", i === this.i)); this._nodes[this.i]?.scrollIntoView({ block: "nearest" }); return; }
    // keep the chosen row in view
    const l = this._list, y = this.i * LP_ROW;
    if (l) { if (y < l.scrollTop) l.scrollTop = y; else if (y + LP_ROW > l.scrollTop + l.clientHeight) l.scrollTop = y + LP_ROW - l.clientHeight; }
    this._fill(); this._updSel();
  }
  _toggle() { const it = this.items[this.i]; if (this.checked.has(it.id)) this.checked.delete(it.id); else this.checked.add(it.id);
    this.audio.play("enter", 0.35); const node = this.grid ? this._nodes[this.i] : this._rows.get(this.i);
    const c = node && node.querySelector(".lp-check, .lpg-check"); if (c) c.src = `./assets/icons/system/${this.checked.has(it.id) ? "checkbox_on" : "checkbox_off"}.png`; }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  _done() { this.audio.play("enter", 0.6); this.onDone && this.onDone(this.multi ? [...this.checked] : this.items[this.i]); }
  _cancel() { this.audio.play("back", 0.5); this.onCancel && this.onCancel(); }
  _gridInput(a) {
    const cols = 6, n = this.items.length;
    if (this.act >= 0) {
      if (a === "left" && this.act > 0) { this.act--; this.audio.play("cursor_up", 0.3); this._applyActFocus(); }
      else if (a === "right" && this.act < this._acts.length - 1) { this.act++; this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
      else if (a === "up") { this.act = -1; this.audio.play("cursor_up", 0.3); this._applyActFocus(); }
      else if (a === "enter") this._acts[this.act]?.click();
      else if (a === "back") this._cancel();
      return;
    }
    const mv = (j) => { this.i = j; this.audio.play("cursor_down", 0.3); this._upd(); };
    if (a === "left" && this.i > 0) mv(this.i - 1);
    else if (a === "right" && this.i < n - 1) mv(this.i + 1);
    else if (a === "up" && this.i - cols >= 0) mv(this.i - cols);
    else if (a === "down") {
      if (this.i + cols < n) mv(this.i + cols);
      else { this.act = this._acts.length - 1; this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
    }
    else if (a === "enter") { this.multi ? this._toggle() : this._done(); }
    else if (a === "start" && this.multi) this._done();
    else if (a === "square" && this.onSquare) this.onSquare();
    else if (a === "back") this._cancel();
  }
  onInput(a) {
    if (this.grid) { this._gridInput(a); return; }
    // the Cancel / Select buttons under the list (down from the last row)
    if (this.act >= 0) {
      if (a === "left" && this.act > 0) { this.act--; this.audio.play("cursor_up", 0.3); this._applyActFocus(); }
      else if (a === "right" && this.act < this._acts.length - 1) { this.act++; this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
      else if (a === "up") { this.act = -1; this.audio.play("cursor_up", 0.3); this._applyActFocus(); }
      else if (a === "enter") this._acts[this.act]?.click();
      else if (a === "start" && this.multi) this._done();
      else if (a === "square" && this.onSquare) this.onSquare();
      else if (a === "back") this._cancel();
      return;
    }
    if (a === "up" && this.i > 0) { this.i--; this.audio.play("cursor_up", 0.4); this._upd(); }
    else if (a === "down" && this.i < this.items.length - 1) { this.i++; this.audio.play("cursor_down", 0.4); this._upd(); }
    else if (a === "down" && this._acts && this._acts.length) { this.act = this._acts.length - 1; this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
    else if (a === "enter") { this.multi ? this._toggle() : this._done(); }
    else if (a === "start" && this.multi) this._done();  // confirm multi-select
    else if (a === "square" && this.onSquare) this.onSquare();                 // cycle mode
    else if (a === "back") this._cancel();
  }
}

// ------------------------------------------------------------- MusicPlayer
// Volume Control window (Music + Video players): "Normal" / "+n" / "-n" over a
// row of nine beans between "-" and "+"; the beans up to the level are lit and
// the current one has the pulsing yellow focus outline (console textures).
export const VOL_STEPS = 9, VOL_NORMAL = 5;
export const volGain = (level) => Math.max(0, Math.min(1, level / VOL_STEPS));
export function volMarkup(level) {
  const off = level - VOL_NORMAL;
  const label = off === 0 ? "Normal" : (off > 0 ? `+${off}` : `${off}`);
  let beans = "";
  for (let i = 1; i <= VOL_STEPS; i++) {
    beans += `<span class="vb"><img src="./assets/icons/vp/lv_${i <= level ? "on" : "off"}.png" alt="">${
      i === level ? `<img class="vb-focus" src="./assets/icons/vp/lv_focus.png" alt="">` : ""}</span>`;
  }
  return `<div class="mp2-vlabel">${label}</div><div class="mp2-vrow"><span class="mp2-vminus">-</span><span class="vbs">${beans}</span><span class="mp2-vplus">+</span></div>`;
}

export class MusicPlayer {
  // PS3 music player. Two independently-toggled overlays sit over the song info:
  //  - TRIANGLE toggles the icon control cluster (3 rows) + hover subtitle.
  //  - SELECT toggles the "display": the play/repeat/shuffle status indicators
  //    above the song info, plus the track counter, time and green progress bar.
  // On entry BOTH are hidden: only the song info shows. Transport also responds
  // to the physical buttons shown next to each hovered icon's name.
  constructor(sfx) {
    this.sfx = sfx; this.el = document.getElementById("musicplayer");
    this.audioEl = new Audio();
    this.audioEl.addEventListener("ended", () => this._onEnded());
    this.audioEl.addEventListener("timeupdate", () => this._tick());
    this.audioEl.addEventListener("play", () => this._renderStatus());
    this.audioEl.addEventListener("pause", () => this._renderStatus());
    this.audioEl.addEventListener("loadeddata", () => { this._err = false; this._tick(); });
    this.audioEl.addEventListener("error", () => this._onAudioError());
    this.shuffle = false; this.repeat = "off";
    this.volLevel = 5;                     // 1..9, 5 = "Normal"
    this.audioEl.volume = volGain(this.volLevel);
    this.volOpen = false;
    // control grid (row, col). Row0: header actions, Row1: transport, Row2: modes.
    // `hint` = the physical-button glyph shown next to the hovered name AND the
    // button that also triggers this action.
    this.rows = [
      [ { id: "vol", icon: "mp_volume", label: "Volume Control" },
        { id: "visual", icon: "mp_visual", label: "Visual Player", hint: "btn_mp_square" },
        { id: "addpl", icon: "mp_addplaylist", label: "Add to Playlist" },
        { id: "del", icon: "mp_delete", label: "Delete" },
        { id: "display", icon: "mp_display", label: "Display", hint: "btn_mp_select" } ],
      [ { id: "prev", icon: "mp_prev", label: "Previous", hint: "btn_mp_l1" },
        { id: "next", icon: "mp_next", label: "Next", hint: "btn_mp_r1" },
        { id: "frev", icon: "mp_frev", label: "Fast Reverse", hint: "btn_mp_l2" },
        { id: "ffwd", icon: "mp_ffwd", label: "Fast Forward", hint: "btn_mp_r2" },
        { id: "play", icon: "mp_play", label: "Play", hint: "btn_mp_start" },
        { id: "pause", icon: "mp_pause", label: "Pause", hint: "btn_mp_start" },
        { id: "stop", icon: "mp_stop", label: "Stop" } ],
      [ { id: "repeat", icon: "mp_repeat", label: "Repeat" },
        { id: "shuffle", icon: "mp_shuffle", label: "Shuffle" } ],
    ];
    this.fr = 1; this.fc = 4;              // default focus = Play
    this.clusterOn = false; this.displayOn = false;
    this.nav = new PadNav(this.rows, MUSIC_LINKS);   // the console's D-pad paths (padnav.js)
  }
  open(tracks, startIndex, resolveUrl, onClose, opts = {}) {
    this.tracks = tracks; this.resolve = resolveUrl; this.onClose = onClose; this.opts = opts || {};
    this._mm = () => this._wake(); window.addEventListener("mousemove", this._mm);
    this.idx = startIndex || 0; this.fr = 1; this.fc = 4; this.nav.reset();
    this.clusterOn = false; this.displayOn = false; this.volOpen = false; this._dlg = null;
    this._closed = false;
    this.sfx.pauseBg();
    document.body.classList.add("menu-open"); this.el.classList.add("show");
    this._render(); this._load(true);
  }
  close() {
    // hard-stop the player's audio so nothing keeps playing (or overlaps the
    // background music) after we leave. The _closed flag also cancels any
    // in-flight async work (cover fetch, on-the-fly decode) that would
    // otherwise resume playback once its promise resolves.
    this._closed = true;
    clearTimeout(this._idleT); clearTimeout(this._statusT); this._stopHold();
    if (this._mm) window.removeEventListener("mousemove", this._mm);
    if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
    try { this.audioEl.pause(); this.audioEl.removeAttribute("src"); this.audioEl.load(); } catch (_) {}
    clearTimeout(this._noteT); this._dlg = null;
    this.el.classList.remove("show", "dlg"); this.el.innerHTML = ""; document.body.classList.remove("menu-open");
    this.sfx.resumeBg();
    this.onClose && this.onClose();
  }
  async _load(autoplay) {
    const t = this.tracks[this.idx]; if (!t) return;
    this.coverUrl = null; this._err = false; this._decodeTried = false;
    if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
    this._wantPlay = !!autoplay;
    // if this track was preloaded (Preload All Songs), play the cached WAV
    // straight away instead of hitting the native error → decode round-trip.
    const pre = this.opts.decodedFor && this.opts.decodedFor(t);
    if (pre) this._decodeTried = true;
    this.audioEl.src = this.resolve(pre ? { path: pre } : t); this.audioEl.volume = volGain(this.volLevel);
    if (autoplay && !this._closed) this.audioEl.play().catch(() => {});
    this._render();
    try { const url = await call("music_cover", { path: t.path });
      if (url && !this._closed && this.tracks[this.idx] === t) { this.coverUrl = url; this._renderArt(); } } catch (e) {}
  }
  // WebView2 can't play WMA/ATRAC/DSD natively. On the first playback error for
  // a track, ask the backend to transcode it (native DSD decoder, or a bundled
  // ffmpeg for WMA/ATRAC) and retry with the decoded WAV before giving up.
  async _onAudioError() {
    if (this._closed) return;
    const t = this.tracks[this.idx];
    // if this track was already preloaded/decoded, just use the cached WAV
    const cached = this.opts.decodedFor && this.opts.decodedFor(t);
    if (t && !this._decodeTried && t.path && !/^(data:|blob:)/.test(t.path)) {
      this._decodeTried = true;
      this._err = false; this._decoding = true; this._tick();
      try {
        const wav = cached || await call("decode_audio", { path: t.path });
        if (wav && !this._closed && this.tracks[this.idx] === t) {
          this._decoding = false;
          this.audioEl.src = this.resolve({ path: wav });
          this.audioEl.volume = volGain(this.volLevel);
          if (this._wantPlay && !this._closed) this.audioEl.play().catch(() => {});
          return;
        }
      } catch (e) {}
      this._decoding = false;
    }
    if (this._closed) return;
    this._err = true; this.sfx.play("error", 0.4); this._tick();
  }
  _renderArt() {
    const art = this.el.querySelector(".mp2-art"); if (!art) return;
    art.innerHTML = this.coverUrl
      ? `<img class="mp2-cover" src="${this.coverUrl}" alt="">`
      : `<span class="sysicon" style="-webkit-mask-image:url('./assets/icons/theme/icon_music_default.png');mask-image:url('./assets/icons/theme/icon_music_default.png')"></span>`;
  }
  // file-type indicator: an image from Music Types when we have one, else a text tag.
  _typeKey(t) {
    const m = /\.([a-z0-9]+)$/i.exec(t && (t.path || t.name) || ""); const e = (m ? m[1] : "").toLowerCase();
    if (e === "m4a" || e === "aac" || e === "mp4") return "aac";
    if (e === "aif" || e === "aiff" || e === "pcm") return "pcm";
    if (e === "dsf" || e === "dsd") return "dsf";
    if (e === "dff") return "sacd";
    if (e === "at3" || e === "oma" || e === "aa3" || e === "atrac") return "atrac";
    if (e === "cda") return "cd";
    if (["flac", "wav", "wma", "mp3", "cd", "sacd"].includes(e)) return e;
    return e || "";
  }
  _typeHTML(t) {
    const k = this._typeKey(t);
    const known = ["aac", "atrac", "cd", "dsf", "flac", "mp3", "pcm", "sacd", "wav", "wma"];
    if (known.includes(k)) return `<img class="mp2-typeimg" src="./assets/icons/system/type_${k}.png" alt="${k}">`;
    return k ? `<span class="mp2-codec">${esc(k.toUpperCase())}</span>` : "";
  }
  _fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), c = Math.floor(s % 60);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(h)}:${p(m)}:${p(c)}`;
  }
  _render() {
    const t = this.tracks[this.idx] || {};
    const cluster = `<div class="mp2-cluster${this.clusterOn ? " on" : ""}">
      ${this.rows.map((row, r) => `<div class="mp2-crow">${row.map((b, c) =>
        `<button class="mp2-btn${r === this.fr && c === this.fc ? " sel" : ""}" data-r="${r}" data-c="${c}">
           <img class="mpi" src="${mpIcon(b.icon)}" alt=""></button>`).join("")}</div>`).join("")}
      <div class="mp2-sub"></div>
      <div class="mp2-vol${this.volOpen ? " on" : ""}"></div>
    </div>`;
    const artistLine = esc(t.artist || "") + (t.album ? ` / ${esc(t.album)}` : "");
    this.el.innerHTML = `<div class="mp2">
      ${cluster}
      <div class="mp2-bottom">
        <div class="mp2-status"></div>
        <div class="mp2-info">
          <div class="mp2-art">${this.coverUrl ? `<img class="mp2-cover" src="${this.coverUrl}" alt="">` : `<span class="sysicon" style="-webkit-mask-image:url('./assets/icons/theme/icon_music_default.png');mask-image:url('./assets/icons/theme/icon_music_default.png')"></span>`}</div>
          <div class="mp2-meta">
            <div class="mp2-title">${esc(t.title || t.name || "")}</div>
            <div class="mp2-artist">${artistLine}</div>
          </div>
        </div>
        <div class="mp2-display">
          <div class="mp2-count"></div>
          <div class="mp2-tline"><span class="mp2-time"></span><span class="mp2-type">${this._typeHTML(t)}</span></div>
          <div class="mp2-bar"><div class="mp2-fill"></div><div class="mp2-bargloss"></div></div>
        </div>
      </div>
    </div>`;
    this._nodes = [...this.el.querySelectorAll(".mp2-btn")];
    this._nodes.forEach((n) => n.addEventListener("click", () => {
      this.fr = +n.dataset.r; this.fc = +n.dataset.c; this.nav.reset(); this._syncSel(); this._act();
    }));
    this._applyToggles(); this._renderSub(); this._renderStatus(); this._renderVol(); this._tick();
  }
  _applyToggles() {
    const cl = this.el.querySelector(".mp2-cluster"); if (cl) cl.classList.toggle("on", this.clusterOn);
    const dp = this.el.querySelector(".mp2-display"); if (dp) dp.classList.toggle("on", this.displayOn);
    this._wake();
    const vol = this.el.querySelector(".mp2-vol"); if (vol) vol.classList.toggle("on", this.clusterOn && this.volOpen);
  }
  _focused() { const row = this.rows[this.fr] || []; return row[this.fc] || row[row.length - 1]; }
  _padMove(a) {
    const to = this.nav.move(a, this.fr, this.fc, (r, c) => nodeX(this._nodes, r, c));
    if (!to) return;
    [this.fr, this.fc] = to;
    this.sfx.play(a === "left" || a === "up" ? "cursor_up" : "cursor_down", 0.4); this._syncSel();
  }
  _syncSel() {
    this._nodes.forEach((n) => n.classList.toggle("sel", +n.dataset.r === this.fr && +n.dataset.c === this.fc));
    this._renderSub();
  }
  _renderSub() {
    const sub = this.el.querySelector(".mp2-sub"); if (!sub) return;
    if (!this.clusterOn) { sub.innerHTML = ""; return; }
    const f = this._focused();
    sub.innerHTML = f ? `<span class="mp2-subname">${esc(f.label)}</span>${f.hint ? `<img class="mp2-hintimg" src="./assets/icons/system/${f.hint}.png" alt="">` : ""}` : "";
  }
  _renderStatus() {
    const st = this.el.querySelector(".mp2-status"); if (!st) return;
    const playing = !this.audioEl.paused;
    let h = `<img class="mp2-st" src="${mpIcon(playing ? "mp_play" : "mp_pause")}" alt="">`;
    if (this.repeat === "one") h += `<span class="mp2-st-rep"><img class="mp2-st" src="${mpIcon("mp_repeat")}" alt=""><img class="mp2-st mp2-st-rep1" src="${mpIcon("mp_repeat1")}" alt=""></span>`;
    else if (this.repeat === "all") h += `<img class="mp2-st" src="${mpIcon("mp_repeat")}" alt="">`;
    if (this.shuffle) h += `<img class="mp2-st mp2-st-shuf" src="${mpIcon("mp_shuffle")}" alt="">`;
    st.innerHTML = h;
  }
  // The play / repeat / shuffle icons above the cover appear whenever one of
  // the transport buttons is used (independently of the △ and SELECT panels),
  // then fade out after ~1 s.
  _flashStatus() {
    this._renderStatus();
    const st = this.el.querySelector(".mp2-status"); if (!st) return;
    st.classList.add("on"); st.classList.remove("faded");
    clearTimeout(this._statusT);
    this._statusT = setTimeout(() => {
      const s2 = this.el.querySelector(".mp2-status"); if (s2) s2.classList.add("faded");
    }, 1000);
  }
  // With neither the △ panel nor the SELECT display up, the cover + song info
  // fade away after 1 s without any input, and come back on any button / move.
  _wake() {
    const info = this.el.querySelector(".mp2-info"); if (info) info.classList.remove("idle");
    clearTimeout(this._idleT);
    this._idleT = setTimeout(() => {
      if (this._closed || this.clusterOn || this.displayOn || this.volOpen) return;
      const i2 = this.el.querySelector(".mp2-info"); if (i2) i2.classList.add("idle");
    }, 1000);
  }
  // seek by `d` seconds. If the source can't seek (no range support), switch
  // to an in-memory copy of the file once, then seek.
  _seekBy(d) {
    const a = this.audioEl;
    const dur = isFinite(a.duration) ? a.duration : Infinity;
    const target = Math.max(0, Math.min(dur - 0.05, (a.currentTime || 0) + d));
    a.currentTime = target;
    this._tick();
    clearTimeout(this._seekChk);
    this._seekChk = setTimeout(() => {
      if (this._closed || this._blobUrl || this._blobLoading) return;
      if (Math.abs((a.currentTime || 0) - target) < 1.5) return;
      this._blobLoading = true;
      const wasPlaying = !a.paused, src = a.currentSrc || a.src, t = this.tracks[this.idx];
      fetch(src).then((r) => r.blob()).then((b) => {
        this._blobLoading = false;
        if (this._closed || this.tracks[this.idx] !== t) return;
        this._blobUrl = URL.createObjectURL(b);
        a.src = this._blobUrl;
        a.addEventListener("loadedmetadata", () => { a.currentTime = target; if (wasPlaying) a.play().catch(() => {}); this._tick(); }, { once: true });
      }).catch(() => { this._blobLoading = false; });
    }, 350);
  }
  // Fast Reverse / Fast Forward: 2 s per step, repeating while the button is held
  _startHold(dir, key) {
    this._stopHold();
    this._seekBy(2 * dir); this._flashStatus();
    if (!key) return;
    const t0 = setTimeout(() => {
      this._holdT = setInterval(() => {
        if (this._closed || !Input.held[key]) { this._stopHold(); return; }
        this._seekBy(2 * dir); this._flashStatus();
      }, 180);
    }, 380);
    this._holdT0 = t0;
  }
  _stopHold() { clearTimeout(this._holdT0); clearInterval(this._holdT); this._holdT0 = this._holdT = null; }
  _renderVol() {
    const vol = this.el.querySelector(".mp2-vol"); if (!vol) return;
    vol.innerHTML = volMarkup(this.volLevel);
  }
  _tick() {
    const cur = this.audioEl.currentTime || 0, dur = this.audioEl.duration || 0;
    const fill = this.el.querySelector(".mp2-fill"); if (fill) fill.style.width = dur ? `${(cur / dur) * 100}%` : "0%";
    const tm = this.el.querySelector(".mp2-time");
    if (tm) tm.textContent = this._decoding ? "Decoding…"
      : this._err ? "Format not supported" : `${this._fmt(cur)} / ${this._fmt(dur)}`;
    const ct = this.el.querySelector(".mp2-count"); if (ct) ct.textContent = `${this.idx + 1}/${this.tracks.length}`;
  }
  _openVol() { this.volOpen = true; this._applyToggles(); this._renderVol(); }
  _closeVol() { this.volOpen = false; this._applyToggles(); }
  _setVol(d) {
    this.volLevel = Math.max(1, Math.min(VOL_STEPS, this.volLevel + d));   // lowest: -4 (one bean left)
    this.audioEl.volume = volGain(this.volLevel);
    this.sfx.play(d > 0 ? "cursor_down" : "cursor_up", 0.4); this._renderVol();
  }
  // run an action by id (used by focus-enter, direct click, and physical buttons)
  _actId(id) {
    if (["prev", "next", "play", "pause", "playpause", "stop", "repeat", "shuffle"].includes(id)) setTimeout(() => this._flashStatus(), 0);
    switch (id) {
      case "vol": this._openVol(); return;
      case "visual": break;                 // placeholder (no visualiser yet)
      case "addpl": if (this.opts && this.opts.onAddToPlaylist) this.opts.onAddToPlaylist(this.tracks[this.idx]); return;
      case "del": this._askDelete(); return;
      case "display": this.displayOn = !this.displayOn; this._applyToggles(); this._tick(); break;
      case "prev": this._prev(); break;
      case "next": this._next(); break;
      case "frev": this._startHold(-1, this._holdKey); return;
      case "ffwd": this._startHold(1, this._holdKey); return;
      case "play": this.audioEl.play().catch(() => {}); this._renderStatus(); break;
      case "pause": this.audioEl.pause(); this._renderStatus(); break;
      case "playpause": if (this.audioEl.paused) this.audioEl.play().catch(() => {}); else this.audioEl.pause(); this._renderStatus(); break;
      case "stop": this.close(); return;          // like the Video Player: back to the menu
      case "repeat": this.repeat = this.repeat === "off" ? "all" : (this.repeat === "all" ? "one" : "off"); this._renderStatus(); break;
      case "shuffle": this.shuffle = !this.shuffle; this._renderStatus(); break;
    }
  }
  _act() { const f = this._focused(); if (!f) return; this.sfx.play("enter", 0.4); this._actId(f.id); }
  _next() {
    const n = this.tracks.length;
    // shuffle: any other song (never the one that's playing again)
    if (this.shuffle && n > 1) { let j = Math.floor(Math.random() * (n - 1)); if (j >= this.idx) j++; this.idx = j; }
    else this.idx = (this.idx + 1) % n;
    this._load(true);
  }
  _prev() { if (this.audioEl.currentTime > 3) { this.audioEl.currentTime = 0; this._tick(); return; } this.idx = (this.idx - 1 + this.tracks.length) % this.tracks.length; this._load(true); }
  _onEnded() {
    if (this.repeat === "one") { this.audioEl.currentTime = 0; this.audioEl.play().catch(() => {}); return; }
    if (this.repeat === "all" || this.shuffle) { this._next(); return; }
    if (this.idx < this.tracks.length - 1) this._next(); else { this.audioEl.pause(); this._renderStatus(); }
  }
  // Delete: the console's confirmation screen (like the Video Player's). Only
  // songs in the app's own Music folder can be deleted.
  async _askDelete() {
    const t = this.tracks[this.idx]; if (!t) return;
    let ok = false;
    try { ok = await call("music_deletable", { path: t.path }); } catch (e) {}
    if (this._closed) return;
    if (!ok) { this.sfx.play("error", 0.4); this._note("Only songs in the system's Music folder can be deleted"); return; }
    this._wasPlaying = !this.audioEl.paused;
    this.audioEl.pause();
    this._dlg = { sel: 0, track: t };
    const host = document.createElement("div");
    host.className = "mp-dlg-host";
    host.innerHTML = `<div class="vp-dlg">
      <div class="vp-dlg-body"><div class="vp-dlg-text">The title that is currently playing will be deleted.<br>Are you sure you want to continue?</div>
        <div class="vp-dlg-opts"><span class="vp-dlg-opt sel">Yes</span><span class="vp-dlg-opt">No</span></div></div>
      <div class="vp-dlg-foot"><span><span class="cf-glyph">✕</span>Enter</span><span><span class="cf-glyph">○</span>Back</span></div>
    </div>`;
    this.el.appendChild(host); this.el.classList.add("dlg");
  }
  _closeDlg(resume) {
    this._dlg = null; this.el.classList.remove("dlg");
    const h = this.el.querySelector(".mp-dlg-host"); if (h) h.remove();
    if (resume && this._wasPlaying) this.audioEl.play().catch(() => {});
  }
  async _dlgInput(a) {
    const d = this._dlg, opts = [...this.el.querySelectorAll(".mp-dlg-host .vp-dlg-opt")];
    if (a === "left" || a === "right") { d.sel = a === "left" ? 0 : 1; opts.forEach((o, i) => o.classList.toggle("sel", i === d.sel)); this.sfx.play("cursor_up", 0.3); return; }
    if (a === "back" || (a === "enter" && d.sel === 1)) { this.sfx.play("back", 0.4); this._closeDlg(true); return; }
    if (a !== "enter") return;
    this.sfx.play("enter", 0.5);
    this._closeDlg(false);
    const t = d.track;
    try { this.audioEl.pause(); this.audioEl.removeAttribute("src"); this.audioEl.load(); } catch (e) {}
    try { await call("music_delete", { path: t.path }); }
    catch (e) { this.sfx.play("error", 0.4); this._load(this._wasPlaying); return; }
    if (this._closed) return;
    const i = this.tracks.indexOf(t);
    if (i >= 0) this.tracks.splice(i, 1);
    this.opts.onDeleted && this.opts.onDeleted(t);
    if (!this.tracks.length) { this.close(); return; }
    this.idx = Math.min(i >= 0 ? i : this.idx, this.tracks.length - 1);
    this._load(true);
  }
  // a short message above the status icons (fades after 3 s)
  _note(text) {
    let n = this.el.querySelector(".mp-note");
    if (!n) { n = document.createElement("div"); n.className = "vp-box mp-note"; this.el.appendChild(n); }
    n.textContent = text; n.classList.add("on");
    clearTimeout(this._noteT); this._noteT = setTimeout(() => n.classList.remove("on"), 3000);
  }
  onInput(a) {
    this._wake();
    if (this._dlg) { this._dlgInput(a); return; }
    // volume mini-window captures the d-pad while open
    if (this.volOpen) {
      switch (a) {
        case "left": this._setVol(-1); return;
        case "right": this._setVol(1); return;
        case "enter": case "back": this.sfx.play(a === "back" ? "back" : "enter", 0.4); this._closeVol(); return;
        case "options": this.clusterOn = !this.clusterOn; this.sfx.play("enter", 0.4); this._applyToggles(); this._renderSub(); return;
      }
      return;
    }
    switch (a) {
      case "options": this.clusterOn = !this.clusterOn; this.sfx.play("enter", 0.4); this._applyToggles(); this._renderSub(); break;
      case "select": this._actId("display"); this.sfx.play("enter", 0.4); break;
      case "square": this.sfx.play("enter", 0.4); this._actId("visual"); break;
      case "l1": this.sfx.play("enter", 0.4); this._actId("prev"); break;
      case "r1": this.sfx.play("enter", 0.4); this._actId("next"); break;
      case "l2": this.sfx.play("enter", 0.4); this._holdKey = "l2"; this._actId("frev"); this._holdKey = null; break;
      case "r2": this.sfx.play("enter", 0.4); this._holdKey = "r2"; this._actId("ffwd"); this._holdKey = null; break;
      case "start": this.sfx.play("enter", 0.4); this._actId("playpause"); break;
      case "left": case "right": case "up": case "down": if (this.clusterOn) this._padMove(a); break;
      case "enter": if (this.clusterOn) { this._holdKey = "enter"; this._act(); this._holdKey = null; } break;
      case "back": this.sfx.play("back", 0.5); this.close(); break;
    }
  }
}


// (the Photo Viewer lives in photoviewer.js)



// ---------------------------------------------------- PSN profile card (Friends)
export class ProfileCard {
  constructor(sfx) { this.sfx = sfx; this.el = document.getElementById("form"); this.osk = new OnScreenKeyboard(sfx); }
  open(account, { colors, onChange, msgLimit = 63, level = 1, colorPicker = null }, onClose) {
    this.account = account; this.onChange = onChange; this.onClose = onClose;
    this.cp = colorPicker;
    // Left / right cycle the named colours (plus the custom colour, once one
    // has been picked); △ opens the colour wheel for a custom colour.
    this.baseColors = colors;
    const named = colors.some((c) => c.hex.toLowerCase() === String(account.background).toLowerCase());
    this.customHex = !named && parseColor(account.background) ? account.background : null;
    this._buildColors();
    this.msgLimit = msgLimit; this.level = level; this._oskActive = false;
    this.ci = this.colors.findIndex((c) => c.hex.toLowerCase() === String(account.background).toLowerCase());
    if (this.ci < 0) this.ci = 0;
    document.body.classList.add("menu-open"); this.el.className = "form show";
    this._render();
  }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); this.onClose && this.onClose(); }
  _buildColors() {
    this.colors = this.customHex ? [...this.baseColors, { name: "Custom Color", hex: this.customHex, custom: true }] : [...this.baseColors];
  }
  _render() {
    // preview the ACTUAL player card design. It must sit inside
    // .item.item-card.sel so the full-card CSS (background, bubble, trophy)
    // applies \u2014 those are only shown for a selected card.
    const a = this.account, cur = this.colors[this.ci], bg = cur.hex;
    this.el.innerHTML = `<div class="pc-wrap">
      <div class="item item-card sel pc-preview">
        <div class="fc-root player pc-editor" style="--card-bg:${bg}">
          <div class="friend-card"></div>
          <div class="fc-toprow${a.comment ? "" : " no-msg"}">
            ${a.comment ? `<div class="fc-msg"><span class="fc-msgtext">${esc(a.comment)}</span></div>` : ""}
            <div class="fc-trophy"><img class="fc-trophy-ic" src="./assets/icons/system/trophy_level.png" alt=""><span class="fc-level">${this.level}</span></div>
          </div>
          ${a.comment ? `<img class="fc-tail" src="./assets/icons/system/bubble_tail.png" alt="">` : ""}
          <div class="fc-avslot av-wait"><img class="fc-av${isStockAvatar(a.avatar) ? " fc-stock" : ""}" src="${avatarSrc(a.avatar)}" alt=""><div class="fc-glass"></div></div>
          <div class="fc-name"><span class="fc-dot" style="background-image:url('./assets/icons/system/tex_indi_Sign_in.png')"></span><span class="fc-nm">${esc(a.onlineId)}</span></div>
        </div>
      </div>
      <div class="pc-hint">Background: ${esc(cur.custom ? `Custom Color (${String(bg).toUpperCase()})` : cur.name)} &nbsp; \u2039 \u203a change &nbsp;\u2022&nbsp; ${this.cp ? "\u25B3 custom color &nbsp;\u2022&nbsp; " : ""}\u2715 edit comment</div>
    </div>`;
  }
  _editComment() {
    // keyboard / mouse users type straight into a text box; controllers get
    // the on-screen keyboard (like everywhere else in the app)
    if (!useOsk()) {
      this._typing = true;
      const hint = this.el.querySelector(".pc-hint");
      if (hint) hint.outerHTML = `<div class="pc-edit"><input class="pc-input" maxlength="${this.msgLimit}" spellcheck="false"
        placeholder="Comment (leave blank for no bubble)" value="${esc(this.account.comment || "")}">
        <button class="pc-cancel">Cancel</button><button class="pc-save">Confirm</button></div>`;
      const inp = this.el.querySelector(".pc-input");
      this.el.querySelector(".pc-save").addEventListener("click", () => this._commitTyping(true));
      this.el.querySelector(".pc-cancel").addEventListener("click", () => this._commitTyping(false));
      setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 20);
      return;
    }
    this._oskActive = true;
    this.osk.open(this.el, { title: "Comment", initial: this.account.comment || "", maxLen: this.msgLimit },
      (text) => { this._oskActive = false; this.account.comment = String(text || "").trim(); this.onChange && this.onChange(this.account); this.el.className = "form show"; this._render(); },
      () => { this._oskActive = false; this.el.className = "form show"; this._render(); });
  }
  _commitTyping(save) {
    const inp = this.el.querySelector(".pc-input");
    if (save && inp) { this.account.comment = String(inp.value || "").trim().slice(0, this.msgLimit); this.onChange && this.onChange(this.account); }
    this._typing = false; this.sfx.play(save ? "enter" : "back", 0.5); this._render();
  }
  onInput(action) {
    if (this.cp && this.cp.isOpen) { this.cp.onInput(action); return; }
    if (this._typing) { if (action === "enter") this._commitTyping(true); else if (action === "back") this._commitTyping(false); return; }
    if (this._oskActive) { this.osk.onInput(action); return; }
    if (action === "left" || action === "right") {
      this.ci = (this.ci + (action === "right" ? 1 : -1) + this.colors.length) % this.colors.length;
      this.account.background = this.colors[this.ci].hex;
      this.sfx.play("cursor_up", 0.4); this._render();
      this.onChange && this.onChange(this.account);
    } else if (action === "options" && this.cp) {
      // △: Custom Color (the colour wheel)
      const prev = this.account.background, prevCi = this.ci;
      this.sfx.play("enter", 0.5);
      this.cp.open({ title: "Card Background: Custom Color", value: parseColor(prev) ? prev : "#868485",
        onPreview: (hex) => { const r = this.el.querySelector(".fc-root"); if (r) r.style.setProperty("--card-bg", hex); } },
        (hex) => {
          this.account.background = hex;
          const hit = this.baseColors.findIndex((c) => c.hex.toLowerCase() === String(hex).toLowerCase());
          if (hit >= 0) this.ci = hit;
          else { this.customHex = hex; this._buildColors(); this.ci = this.colors.length - 1; }
          this.el.className = "form show"; document.body.classList.add("menu-open"); this._render(); this.onChange && this.onChange(this.account);
        },
        () => { this.account.background = prev; this.ci = prevCi; this.el.className = "form show"; document.body.classList.add("menu-open"); this._render(); });
    } else if (action === "enter") {
      this.sfx.play("enter", 0.5); this._editComment();
    } else if (action === "back") {
      this.sfx.play("back", 0.5); this.close();
    }
  }
}

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
