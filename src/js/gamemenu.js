// The game options (△) menu and the game Information screen, as on the PS3.
//
//  • GameMenu – a panel down the right side (a theme-coloured stripe over the
//    game's background, or a lighter area with a thin line when there's no
//    background): "Sort By ▶" and "Group Content □ ▶" at the top, then Start,
//    Saved Data Auto-Upload, Internet Search, Delete, Check for Update, Health
//    Warnings, About this Game, Intellectual Property Notices, Information.
//    Every entry can be hovered; the lower list scrolls (▲ / ▼).
//  • GameInfo – the Information screen: the game's icon, then Title, Album,
//    Parental Control, Saved Data Auto-Upload, Created, Size, Version, Buyer,
//    Starts, Expires and Remaining Time between two rules (scrolls), ✕ Edit
//    (the title) / ○ Back.

const VP = "./assets/icons/vp/";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TOP = [
  { id: "sort", label: "Sort By", sub: true },
  { id: "group", label: "Group Content", sub: true, square: true },
];
const LOWER = [
  { id: "start", label: "Start" },
  { id: "autoupload", label: "Saved Data Auto-Upload", plus: true, sub: true },
  { id: "search", label: "Internet Search" },
  { id: "delete", label: "Delete" },
  { id: "update", label: "Check for Update" },
  { id: "health", label: "Health Warnings" },
  { id: "about", label: "About this Game" },
  { id: "ip", label: "Intellectual Property Notices" },
  { id: "info", label: "Information" },
];
const VISIBLE = 7;   // lower entries shown at once
// mini menus: Sort By's row top (vh), the step to Group Content, an option row
const SUB_TOP = 31.7, SUB_PARENT_STEP = 3.75, SUB_ROW = 3.7;
const LOWER_TOP = 51.5, LOWER_ROW = 3.4;   // (the lower list: its top and row, vh)

// While a △ panel (games, Users, Account Management, the settings' option
// lists) is open, what's behind the XMB is blurred: one layer between the
// background and the XMB (styles.css .tri-blur).
if (!document.querySelector(".tri-blur")) { const b = document.createElement("div"); b.className = "tri-blur"; document.body.appendChild(b); }

export class GameMenu {
  constructor(audio) {
    this.audio = audio;
    this.el = document.createElement("div");
    this.el.className = "gamemenu";
    document.body.appendChild(this.el);
  }
  // opts: { withBg, subs: { sort: {options:[{id,label}], current}, group: {...} },
  //   top / lower: other entries (the Users and Account Management panels use
  //   the same panel with their own), disabled: [ids] shown greyed out }
  open(opts, onPick, onClose) {
    this.opts = opts || {}; this.onPick = onPick; this.onClose = onClose;
    this.TOPL = this.opts.top || TOP; this.LOWL = this.opts.lower || LOWER;
    this.dis = new Set(this.opts.disabled || []);
    window.__menuTint && window.__menuTint();
    this.audio.play("options", 0.5);   // (a theme's option menu sound, if it has one)   // the menu takes the background's current colour
    this.items = [...this.TOPL, ...this.LOWL];
    this.sel = this.TOPL.length;      // Start (the first lower entry)
    this.top = 0;                     // first visible lower entry
    this.subOf = null;
    this.el.classList.toggle("bg", !!this.opts.withBg);
    if (this.opts.rgb) this.el.style.setProperty("--gm-rgb", this.opts.rgb.join(","));
    this.el.classList.add("show");
    this._render();
  }
  close() { this.el.classList.remove("show", "sub"); this.el.innerHTML = ""; this.subOf = null; document.body.classList.remove("gm-sub"); }
  get isOpen() { return this.el.classList.contains("show"); }

  _render() {
    const sub = this.subOf;
    // a mini menu (Sort By / Group Content) open: the panel moves left (the
    // XMB with it), the options open in a second panel on the right
    this.el.classList.toggle("sub", !!sub);
    document.body.classList.toggle("gm-sub", !!sub);
    const it = (x, i) => `<div class="gm-item${i === this.sel && !sub ? " sel" : ""}${this.dis.has(x.id) ? " dis" : ""}" data-i="${i}"><span class="gm-label">${esc(x.label)}</span>${
      x.square ? `<img class="gm-sq" src="./assets/icons/system/btn_mp_square.png" alt="">` : ""}${
      x.plus ? `<img class="gm-plus" src="./assets/icons/system/ps_plus.png" alt="">` : ""}${
      x.sub ? `<img class="gm-arrow" src="./assets/icons/system/tex_arrow_r.png" alt="">` : ""}</div>`;
    const TOPL = this.TOPL, LOWL = this.LOWL;
    const lower = LOWL.slice(this.top, this.top + VISIBLE);
    // the options: the one in use sits level with Sort By / Group Content
    // (IMG_3551 / IMG_3552), the others above / below it; ◄ beside that row
    let subHTML = "";
    if (sub) {
      const pi = TOPL.findIndex((x) => x.id === sub.id);
      const li = LOWL.findIndex((x) => x.id === sub.id);
      const rowTop = pi >= 0 ? SUB_TOP + pi * SUB_PARENT_STEP : LOWER_TOP + (li - this.top) * LOWER_ROW;
      const ci = Math.max(0, sub.options.findIndex((o) => o.id === sub.current));
      subHTML = `<div class="gm-sub-bg"></div><div class="gm-line gm-line2"></div>
        <img class="gm-back" src="./assets/icons/system/tex_arrow_r.png" alt="" style="top:${rowTop}vh">
        <div class="gm-subl" style="top:${rowTop - ci * SUB_ROW}vh">${sub.options.map((o, i) =>
          `<div class="gm-item gm-sopt${i === sub.sel ? " sel" : ""}" data-s="${i}"><span class="gm-label">${esc(o.label)}${
            o.tri ? `<span class="gm-tri">${o.tri === "down" ? "\u25BC" : "\u25B2"}</span>` : ""}</span></div>`).join("")}</div>`;
    }
    this.el.innerHTML = `${this._band()}<div class="gm-line"></div>
      <div class="gm-top">${TOPL.map((x, i) => it(x, i)).join("")}</div>
      <div class="gm-lower">
        ${this.top > 0 ? `<img class="gm-more up" src="${VP}arrow_up.png" alt="">` : ""}
        ${lower.map((x, k) => it(x, TOPL.length + this.top + k)).join("")}
        ${this.top + VISIBLE < LOWL.length ? `<img class="gm-more dn" src="${VP}arrow_down.png" alt="">` : ""}
      </div>${subHTML}`;
    this.el.querySelectorAll(".gm-item[data-i]").forEach((n) => n.addEventListener("click", () => {
      if (this.subOf) { this.subOf = null; }
      this.sel = +n.dataset.i; this._enter();
    }));
    this.el.querySelectorAll(".gm-item[data-s]").forEach((n) => n.addEventListener("click", () => { this.subOf.sel = +n.dataset.s; this._subEnter(); }));
  }
  // (no band behind the selected game: its console badge stays on the row)
  _band() { return ""; }
  _scrollIntoView() {
    const li = this.sel - this.TOPL.length;
    if (li < 0) return;
    if (li < this.top) this.top = li;
    if (li >= this.top + VISIBLE) this.top = li - VISIBLE + 1;
  }
  _enter() {
    const it = this.items[this.sel];
    if (this.dis.has(it.id)) { this.audio.play("error", 0.4); return; }   // greyed out
    const sub = this.opts.subs && this.opts.subs[it.id];
    if (sub) {
      this.audio.play("enter", 0.5);
      this.subOf = { id: it.id, label: it.label, options: sub.options, current: sub.current,
        sel: Math.max(0, sub.options.findIndex((o) => o.id === sub.current)) };
      this._render(); return;
    }
    this.onPick && this.onPick(it.id);
  }
  _subEnter() {
    const s = this.subOf, o = s.options[s.sel];
    this.audio.play("enter", 0.5);
    this.opts.subs[s.id].current = o.id;
    this.subOf = null; this._render();
    this.onPick && this.onPick(s.id, o.id);
  }
  onInput(a) {
    if (this.subOf) {
      const s = this.subOf;
      if (a === "up" && s.sel > 0) { s.sel--; this.audio.play("cursor_up", 0.4); this._render(); }
      else if (a === "down" && s.sel < s.options.length - 1) { s.sel++; this.audio.play("cursor_down", 0.4); this._render(); }
      else if (a === "enter" || a === "right") this._subEnter();   // (an arrow menu: right picks too)
      else if (a === "back" || a === "left") { this.audio.play("back", 0.4); this.subOf = null; this._render(); }
      return;
    }
    if (a === "up" && this.sel > 0) { this.sel--; this._scrollIntoView(); this.audio.play("cursor_up", 0.4); this._render(); }
    else if (a === "down" && this.sel < this.items.length - 1) { this.sel++; this._scrollIntoView(); this.audio.play("cursor_down", 0.4); this._render(); }
    else if (a === "enter") this._enter();
    // (Sort By / Group Content show an arrow: right opens them)
    else if (a === "right" && this.items[this.sel].sub) this._enter();
    else if (a === "back") { this.audio.play("back", 0.4); this.close(); this.onClose && this.onClose(); }
  }
}

// ------------------------------------------------------------ Information
const ROWS_VISIBLE = 8;
export class GameInfo {
  constructor(audio) {
    this.audio = audio;
    this.el = document.createElement("div");
    this.el.className = "gameinfo";
    document.body.appendChild(this.el);
  }
  // rows: [[label, value]], icon: url, onEdit(): edit the title
  open({ icon, rows, onEdit }, onClose) {
    this.rows = rows; this.icon = icon; this.onEdit = onEdit; this.onClose = onClose; this.top = 0;
    document.body.classList.add("menu-open");
    this.el.classList.add("show");
    this._render();
  }
  close() { this.el.classList.remove("show"); this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  get isOpen() { return this.el.classList.contains("show"); }
  _render() {
    const n = this.rows.length, max = Math.max(0, n - ROWS_VISIBLE);
    const shown = this.rows.slice(this.top, this.top + ROWS_VISIBLE);
    const thumbH = Math.max(12, ROWS_VISIBLE / n * 100), thumbT = max ? this.top / max * (100 - thumbH) : 0;
    const canEdit = this.top === 0 && !!this.onEdit;
    this.el.innerHTML = `
      ${this.icon ? `<img class="gi2-icon" src="${this.icon}" alt="">` : ""}
      <div class="gi2-scroll">
        ${this.top > 0 ? `<img class="gi2-arr up" src="${VP}arrow_up.png" alt="">` : ""}
        <div class="gi2-track"><div class="gi2-thumb" style="top:${thumbT}%;height:${thumbH}%"></div></div>
        ${this.top < max ? `<img class="gi2-arr dn" src="${VP}arrow_down.png" alt="">` : ""}
      </div>
      <div class="gi2-rows">${shown.map(([k, v]) => `<div class="gi2-row"><span class="gi2-k">${esc(k)}</span><span class="gi2-v">${esc(v)}</span></div>`).join("")}</div>
      <div class="gi2-note">This content can be used by users other than the buyers of the content. However, if all buyers are deleted, you will no longer be able to use the content.</div>
      <div class="gi2-foot">${canEdit ? `<span class="gi2-edit"><span class="cf-glyph">✕</span>Edit</span>` : ""}<span class="gi2-back"><span class="cf-glyph">○</span>Back</span></div>`;
  }
  onInput(a) {
    const max = Math.max(0, this.rows.length - ROWS_VISIBLE);
    if (a === "down" && this.top < max) { this.top++; this.audio.play("cursor_down", 0.4); this._render(); }
    else if (a === "up" && this.top > 0) { this.top--; this.audio.play("cursor_up", 0.4); this._render(); }
    else if (a === "enter" && this.top === 0 && this.onEdit) { this.audio.play("enter", 0.5); this.onEdit(); }
    else if (a === "back") { this.audio.play("back", 0.5); this.close(); this.onClose && this.onClose(); }
  }
}

// ------------------------------------------------------------ Delete (game)
// The console's "The installed game will be deleted." screen (IMG_3553): the
// two rules, the game's icon on the left with its name / date / size centred
// under it, the message with Yes / No (No chosen first) on the right and
// ✕ Enter / ○ Back under the lower rule. onDone(true) = Yes.
export class GameConfirm {
  constructor(audio) {
    this.audio = audio;
    this.el = document.createElement("div");
    this.el.className = "gamedlg";
    document.body.appendChild(this.el);
  }
  // sel: the answer chosen first (1 = No); diamond: ◆ beside the icon (the logged-in user)
  open({ icon, meta = [], text, sel = 1, diamond = false, stock = false, user = false }, onDone) {
    this.onDone = onDone; this.sel = sel;
    document.body.classList.add("menu-open");
    this.el.classList.add("show");
    this.el.innerHTML = `<div class="vp-dlg pv-dlg gm-dlg${user ? " ud-dlg" : ""}">
      ${icon ? `<div class="vp-dlg-thumb pv-dlg-thumb${stock ? " gd-stock" : ""}">${diamond ? `<span class="gd-diamond"></span>` : ""}<img src="${icon}" alt=""></div>` : ""}
      <div class="pv-dlg-meta">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>
      <div class="vp-dlg-body"><div class="vp-dlg-text">${String(text).split("\n").map(esc).join("<br>")}</div>
        <div class="vp-dlg-opts"><span class="vp-dlg-opt" data-i="0">Yes</span><span class="vp-dlg-opt" data-i="1">No</span></div></div>
      <div class="vp-dlg-foot"><span data-a="enter"><span class="cf-glyph">\u2715</span>Enter</span><span data-a="back"><span class="cf-glyph">\u25CB</span>Back</span></div>
    </div>`;
    this.el.querySelectorAll(".vp-dlg-opt").forEach((n) => n.addEventListener("click", () => { this.sel = +n.dataset.i; this._upd(); this.onInput("enter"); }));
    // ◆ just left of the picture (whatever its shape)
    const dm = this.el.querySelector(".gd-diamond"), im = dm && dm.parentElement.querySelector("img");
    if (dm && im) { const place = () => { dm.style.left = `${im.offsetLeft - innerWidth * 0.008}px`; }; if (im.complete) place(); else im.addEventListener("load", place, { once: true }); }
    this.el.querySelectorAll(".vp-dlg-foot [data-a]").forEach((n) => n.addEventListener("click", () => this.onInput(n.dataset.a)));
    // the question's lines centred on the picture's middle (Yes / No hang below)
    const body = this.el.querySelector(".vp-dlg-body"), tx = this.el.querySelector(".vp-dlg-text");
    if (user && body && tx && icon) body.style.top = `calc(50.3vh - ${tx.offsetHeight / 2}px)`;
    this._upd();
  }
  _upd() { this.el.querySelectorAll(".vp-dlg-opt").forEach((n, i) => n.classList.toggle("sel", i === this.sel)); }
  close() { this.el.classList.remove("show"); this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  get isOpen() { return this.el.classList.contains("show"); }
  onInput(a) {
    if ((a === "left" && this.sel > 0) || (a === "right" && this.sel < 1)) { this.sel += a === "left" ? -1 : 1; this.audio.play("cursor_up", 0.35); this._upd(); }
    else if (a === "enter") { const yes = this.sel === 0; this.audio.play(yes ? "enter" : "back", 0.5); this.onDone && this.onDone(yes); }
    else if (a === "back") { this.audio.play("back", 0.5); this.onDone && this.onDone(false); }
  }
}
