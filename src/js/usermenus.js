// The Users screens, laid out from the console's captures (IMG_3578-3597):
//
//  • UserInfo – Users > △ > Information: the user's icon in a box (◆ beside
//    it for the user who's logged in), "User [name]" under it; ✕ Edit
//    (the icon: the icon chooser; the name: type a new one), ○ Back.
//  • IconChooser – "Select an image to use as an icon.": the preset icons in
//    one column, the chosen one in a big box, the others small above / below;
//    "Select from [Photo]" opens the photos (the same column, with their names:
//    All / By Month / By Year / By Album with □ Group Content, folders open
//    with ✕, "Select from Preset Images" goes back to the presets).
import { avatarSrc, isStockAvatar } from "./ui.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const foot = (enter) => `<div class="confirm-foot uc-foot"><span class="cf-hint" data-a="enter"><span class="cf-glyph cf-x">✕</span>${esc(enter)}</span>` +
  `<span class="cf-hint" data-a="back"><span class="cf-glyph cf-o">○</span>Back</span></div>`;
// a stock avatar sits well inside its box (as the console draws them); a photo fills it
const isStock = (ref) => isStockAvatar(ref);

// ------------------------------------------------------------ Information
export class UserInfo {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); }
  // user: { name, avatar }, current: is it the logged-in user (◆)
  open(user, current, { onIcon, onName, onBack }) {
    this.user = user; this.current = current; this.onIcon = onIcon; this.onName = onName; this.onBack = onBack;
    this.r = 0;
    this._render();
  }
  _render() {
    const u = this.user;
    this.el.className = "form show uinfo"; document.body.classList.add("menu-open");
    this.el.innerHTML = `
      ${this.current ? `<div class="ui-diamond"></div>` : ""}
      <div class="ui-box${isStock(u.avatar) ? " stock" : ""}${this.r === 0 ? " sel" : ""}" data-r="0"><img class="${isStock(u.avatar) ? "ui-stock" : "ui-photo"}" src="${avatarSrc(u.avatar)}" alt=""></div>
      <div class="ui-namerow"><span class="ui-lab">User</span><span class="ui-name${this.r === 1 ? " sel" : ""}" data-r="1">${esc(u.name)}</span></div>
      ${foot(this.r === 1 ? "Edit" : "Enter")}`;   // (✕ Edit on the name, ✕ Enter on the picture)
    this.el.querySelectorAll("[data-r]").forEach((n) => n.addEventListener("click", () => { this.r = +n.dataset.r; this.onInput("enter"); }));
    this.el.querySelectorAll(".uc-foot [data-a]").forEach((n) => n.addEventListener("click", () => this.onInput(n.dataset.a)));
  }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  onInput(a) {
    if ((a === "up" && this.r > 0) || (a === "down" && this.r < 1)) { this.r += a === "up" ? -1 : 1; this.audio.play(a === "up" ? "cursor_up" : "cursor_down", 0.4); this._render(); }
    else if (a === "enter") { this.audio.play("enter", 0.5); (this.r === 0 ? this.onIcon : this.onName)?.(); }
    else if (a === "back") { this.audio.play("back", 0.5); this.onBack?.(); }
  }
}

// ------------------------------------------------------------ icon chooser
// The column: the chosen entry in the box, BOX_GAP from the box to the next
// small one, then STEP between the small ones (vh, from the captures).
// The rows stay on screen between moves and slide (and the chosen one grows
// into the box) the way the XMB's own columns do.
const STEP = 6.8, BOX_GAP = 9.75 + 4.6;   // (half the box + the gap to the first small one)
const WIN = 8;                            // rows kept either side of the chosen one
const offs = (d) => d === 0 ? 0 : Math.sign(d) * (BOX_GAP + (Math.abs(d) - 1) * STEP);
export class IconChooser {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); }
  // presets: [refs]; current: the icon in use; photos: { modes:[{id,label}],
  // build(modeId) -> [{ title, sub, thumb, ref?, html?, children?, playlists? }],
  // playlists({ onPick(entry), onCancel }) : the "Select a playlist." screen }
  open({ presets, current, photos }, onPick, onCancel) {
    this.presets = presets; this.current = current; this.photos = photos;
    this.onPick = onPick; this.onCancel = onCancel;
    this.view = "preset"; this.focus = "list"; this.btn = 0;
    this.i = Math.max(0, presets.indexOf(current));
    this.modeI = 0; this.stack = [];
    this._render();
  }
  _items() {
    if (this.view === "preset") return this.presets.map((ref) => ({ ref, thumb: avatarSrc(ref), stock: isStock(ref) }));
    return this.stack.length ? this.stack[this.stack.length - 1].items : (this._top ||= this.photos.build(this.photos.modes[this.modeI].id));
  }
  // (inside a folder only "Select from Preset Images", IMG_3610)
  _buttons() { return this.view === "preset" ? ["Select from [Photo]"] : this.stack.length ? ["Select from Preset Images"] : ["Group Content", "Select from Preset Images"]; }
  _thumb(it) {
    if (it.html) return it.html;                       // (the XMB's own folder, tinted like the menu's)
    if (it.sys) return `<img class="ic-img ic-sys" src="${it.thumb}" alt="">`;
    // (a photo: framed on its own edges when chosen; a preset icon: in the square box)
    return `<img class="ic-img${it.stock ? " ic-stock" : " ic-pic"}" src="${it.thumb || ""}" alt="" loading="lazy">`;
  }
  // a full redraw: a new list (another view, mode or folder)
  _render() {
    const items = this._items(), n = items.length, pv = this.view === "preset";
    this.i = Math.max(0, Math.min(this.i, n - 1));
    this.el.className = `form show ichoose ${pv ? "ic-preset" : "ic-photo"}`; document.body.classList.add("menu-open");
    const mode = this.photos.modes[this.modeI];
    this.el.innerHTML = `
      ${pv ? "" : `<div class="ic-mode"><img src="./assets/icons/system/tex_photo.png" alt="">${esc(mode.label)}</div>`}
      ${!pv && this.stack.length ? this._parentHTML() : ""}
      <div class="ic-col"><div class="ic-box"></div></div>
      ${!n ? `<div class="ic-empty">There are no images.</div>` : ""}
      <div class="ic-text">Select an image to use as an icon.</div>
      <div class="ic-btns${this._buttons().length === 1 && !pv ? " one" : ""}">${this._buttons().map((b, k) => `<button class="ui-btn ic-btn" data-b="${k}">${esc(b)}${
        b === "Group Content" ? `<img class="ic-sq" src="./assets/icons/system/btn_mp_square.png" alt="">` : ""}</button>`).join("")}</div>
      ${foot("Enter")}`;
    this.$col = this.el.querySelector(".ic-col"); this.$box = this.el.querySelector(".ic-box");
    this.rows = new Map();
    this.$box.addEventListener("click", () => { this.focus = "list"; this.onInput("enter"); });
    this.el.querySelectorAll(".ic-btn").forEach((b) => b.addEventListener("click", () => { this.focus = "btn"; this.btn = +b.dataset.b; this.onInput("enter"); }));
    this.el.querySelectorAll(".uc-foot [data-a]").forEach((n2) => n2.addEventListener("click", () => this.onInput(n2.dataset.a)));
    this._layout(null);
  }
  // place the rows around the chosen one; prev: the chosen index before the
  // move (new rows start where they were then, so they slide in)
  _layout(prev) {
    const items = this._items(), n = items.length, pv = this.view === "preset";
    const want = new Set();
    for (let k = Math.max(0, this.i - WIN); k <= Math.min(n - 1, this.i + WIN); k++) want.add(k);
    const fresh = [];
    for (const k of want) {
      let r = this.rows.get(k);
      if (!r) {
        const it = items[k];
        r = document.createElement("div");
        r.className = `ic-row${it.html ? " ic-fold" : ""}${it.stock ? " ic-st" : ""}`; r.dataset.k = k;
        r.innerHTML = `<div class="ic-th">${this._thumb(it)}</div>${pv ? "" : `<div class="ic-rtitle"><div class="ic-rt">${esc(it.title || "")}</div>${it.sub ? `<div class="ic-rsub">${esc(it.sub)}</div>` : ""}</div>`}`;
        r.addEventListener("click", () => { if (+r.dataset.k === this.i) { this.focus = "list"; this.onInput("enter"); return; }
          this.focus = "list"; const was = this.i; this.i = +r.dataset.k; this.audio.play("cursor_down", 0.35); this._layout(was); });
        const from = prev == null ? k - this.i : k - prev;
        r.style.top = `calc(50% + ${offs(Math.max(-WIN - 1, Math.min(WIN + 1, from)))}vh)`;
        r.classList.toggle("cur", from === 0);
        if (prev != null) r.classList.add("noanim");
        this.$col.appendChild(r); this.rows.set(k, r); fresh.push(r);
      }
    }
    if (fresh.length) { void this.$col.offsetHeight; fresh.forEach((r) => r.classList.remove("noanim")); }
    for (const [k, r] of this.rows) {
      const d = k - this.i;
      r.style.top = `calc(50% + ${offs(Math.max(-WIN - 1, Math.min(WIN + 1, d)))}vh)`;
      r.classList.toggle("cur", d === 0);
      if (!want.has(k)) { this.rows.delete(k); setTimeout(() => r.remove(), 320); }
    }
    this._focusMarks();
  }
  // inside a folder (IMG_3610): the opened folder on the left with ◀ beside
  // it, the rest of the list it came from dimmed in its own column
  _parentHTML() {
    const top = this.stack[this.stack.length - 1];
    const list = this.stack.length > 1 ? this.stack[this.stack.length - 2].items : this._top || [];
    const b = top.back, opened = list[b];
    let rows = "";
    for (let k = Math.max(0, b - WIN); k <= Math.min(list.length - 1, b + WIN); k++) {
      if (k === b) continue;
      rows += `<div class="ic-prow" style="top:calc(50% + ${offs(k - b)}vh)"><div class="ic-th">${this._thumb(list[k])}</div></div>`;
    }
    return `<div class="ic-pcol">${rows}</div>
      ${opened ? `<div class="ic-opened${opened.html ? " ic-fold" : ""}"><div class="ic-th">${this._thumb(opened)}</div></div><img class="ic-back" src="./assets/icons/system/tex_arrow_r.png" alt="">` : ""}`;
  }
  _focusMarks() {
    // (the square box is for folders and preset icons; a photo has its own frame;
    // nothing is framed while a button has the focus)
    const cur = this._items()[this.i];
    this.$box.classList.toggle("pic", !!cur && !cur.html && !cur.sys && !cur.stock);
    this.$box.classList.toggle("sel", this.focus === "list");
    this.$col.classList.toggle("onlist", this.focus === "list");
    this.el.querySelectorAll(".ic-btn").forEach((b, k) => b.classList.toggle("sel", this.focus === "btn" && this.btn === k));
  }
  _move(d) {
    const was = this.i; this.i += d;
    this.audio.play(d < 0 ? "cursor_up" : "cursor_down", 0.35);
    this._layout(was);
  }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  _press() {
    const items = this._items(), it = items[this.i];
    if (this.focus === "btn") {
      const b = this._buttons()[this.btn];
      this.audio.play("enter", 0.5);
      if (b === "Select from [Photo]") { this.view = "photo"; this.focus = "list"; this.i = 0; this.stack = []; this._top = null; this._render(); }
      else if (b === "Group Content") this._cycleMode();
      else { this.view = "preset"; this.focus = "list"; this.i = Math.max(0, this.presets.indexOf(this.current)); this._render(); }
      return;
    }
    if (!it) { this.audio.play("error", 0.4); return; }
    // Playlists: "Select a playlist." first, then that playlist's pictures
    if (it.playlists && this.photos.playlists) {
      this.audio.play("enter", 0.5);
      const back = this.i;
      this.photos.playlists({
        onPick: (pl) => { this.stack.push({ title: pl.title, items: pl.children, back }); this.i = 0; this.focus = "list"; this._render(); },
        onCancel: () => this._render(),
      });
      return;
    }
    if (it.children) {
      if (!it.children.length) { this.audio.play("error", 0.4); return; }
      this.audio.play("enter", 0.5);
      this.stack.push({ title: it.title, items: it.children, back: this.i }); this.i = 0; this._render(); return;
    }
    this.audio.play("enter", 0.6);
    this.onPick && this.onPick(it.ref);
  }
  _cycleMode() {
    if (this.view !== "photo") return;
    this.modeI = (this.modeI + 1) % this.photos.modes.length;
    this.stack = []; this._top = null; this.i = 0; this._render();
  }
  onInput(a) {
    const n = this._items().length;
    if (this.focus === "list") {
      if (a === "up" && this.i > 0) this._move(-1);
      else if (a === "down" && this.i < n - 1) this._move(1);
      else if (a === "right") { this.focus = "btn"; this.btn = 0; this.audio.play("cursor_down", 0.35); this._focusMarks(); }
      else if (a === "enter") this._press();
      else if (a === "square") { this.audio.play("enter", 0.4); this._cycleMode(); }
      else if (a === "back") this._back();
      return;
    }
    const nb = this._buttons().length;
    if (a === "left") { this.focus = "list"; this.audio.play("cursor_up", 0.35); this._focusMarks(); }
    else if (a === "up" && this.btn > 0) { this.btn--; this.audio.play("cursor_up", 0.35); this._focusMarks(); }
    else if (a === "down" && this.btn < nb - 1) { this.btn++; this.audio.play("cursor_down", 0.35); this._focusMarks(); }
    else if (a === "enter") this._press();
    else if (a === "square") { this.audio.play("enter", 0.4); this._cycleMode(); }
    else if (a === "back") this._back();
  }
  _back() {
    this.audio.play("back", 0.5);
    if (this.view === "photo" && this.stack.length) { const s = this.stack.pop(); this.i = s.back; this.focus = "list"; this._render(); return; }
    this.onCancel && this.onCancel();
  }
}
