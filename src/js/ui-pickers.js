// The full-screen pickers: playlists, avatars, the Photo Gallery grid, yes / no questions and lists (ui.js gathers every ui-*.js)
import { stillUrl } from "./api.js";
import { ALL_AVATARS, PSN_AVATARS, STOCK_AVATARS, VIDEO_RE, _steamAv, avWaitCheck, avatarSrc, esc, gridStep, heldRows, lazyVideoHTML, mpIcon, watchFarImages, watchLazyVideos, watchStillFallback } from "./ui-core.js";

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

// ---------------------------------------------------------- AvatarPicker
// kept decoded so the avatar menu's SELECT badge is never missing on a re-render
// (embedded: it can never be missing, even while other pictures are still loading)
const SELECT_BADGE = "data:image/png;base64,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";
const _selectBadge = new Image(); _selectBadge.src = SELECT_BADGE;
export class AvatarPicker {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); }
  // opts: { set: "stock"|"all", photos: [paths] } : user picker = stock (+photos), PSN = all
  open(current, opts, onPick, onCancel) {
    this.onPick = onPick; this.onCancel = onCancel;
    this.photos = (opts && opts.photos) || [];
    // PSN: the PSN avatars only (never the default white face: it only shows
    // as the one in use); Users: the system avatars (+ photos)
    // (signed in to Steam: its own picture first)
    this.list = (opts && opts.set === "psn") ? [...(opts.steam && _steamAv ? ["steam"] : []), ...PSN_AVATARS]
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
    const grid = cls === "avpick-av", own = v != null && (/^(stock|psnf?|sys):/.test(String(v)) || v === "steam");
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
    const rows = Math.ceil(this.items.length / cols);
    if (a === "left" && this.i > 0) { this.i--; this._upd(); }
    else if (a === "right" && this.i < this.items.length - 1) { this.i++; this._upd(); }
    else if (a === "up" && this.i - cols >= 0) { this.i = gridStep(this.i, -heldRows("avpick:up", rows), cols, this.items.length); this._upd(); }
    else if (a === "down") {
      if (this.i + cols < this.items.length) { this.i = gridStep(this.i, heldRows("avpick:down", rows), cols, this.items.length); this._upd(); }
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
    // (a picture not drawn yet: the loading icon, the Photo section's icon in its middle, never
    // the webview's broken picture sign)
    const fl = this.flat ? ` style="--sec-flat:url('${String(this.flat).replace(/'/g, "%27")}')"` : "";
    this.el.innerHTML = `<div class="avpick-title">Photo Gallery</div>
      <div class="avpick-panel">
        <div class="avpick-scroll"><div class="avpick-grid pg-grid"${fl}>${this.photos.map((p, i) =>
          `<div data-i="${i}" class="avpick-cell av-wait${i === this.i ? " sel" : ""}"><img class="avpick-av" src="${this.resolve(p)}" alt="" loading="lazy" decoding="async">${this.flat ? `<i class="pg-flat"></i>` : ""}</div>`).join("")}</div></div>
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
    const rows = Math.ceil(this.photos.length / cols);
    if (a === "left" && this.i > 0) { this.i--; this._upd(); }
    else if (a === "right" && this.i < this.photos.length - 1) { this.i++; this._upd(); }
    else if (a === "up" && this.i - cols >= 0) { this.i = gridStep(this.i, -heldRows("pgrid:up", rows), cols, this.photos.length); this._upd(); }
    else if (a === "down") {
      if (this.i + cols < this.photos.length) { this.i = gridStep(this.i, heldRows("pgrid:down", rows), cols, this.photos.length); this._upd(); }
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
export function usFoot(enter = "Enter", square = null, back = "Back") {
  return `<div class="us-foot">${enter ? `<span class="us-hint us-h1" data-a="enter"><span class="us-glyph">\u2715</span>${esc(enter)}</span>` : ""}` +
    `${square ? `<span class="us-hint us-hm" data-a="square"><span class="us-glyph">\u25A1</span>${esc(square)}</span>` : ""}` +
    `<span class="us-hint us-h2" data-a="back"><span class="us-glyph">\u25CB</span>${esc(back)}</span></div>`;
}
export function usFootClicks(root, fn) {
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
    else if (a === "up" && this.i - cols >= 0) mv(gridStep(this.i, -heldRows("lpgrid:up", Math.ceil(n / cols)), cols, n));
    else if (a === "down") {
      if (this.i + cols < n) mv(gridStep(this.i, heldRows("lpgrid:down", Math.ceil(n / cols)), cols, n));
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
    const n = this.items.length;
    if (a === "up" && this.i > 0) { this.i = Math.max(0, this.i - heldRows("lp:up", n)); this.audio.play("cursor_up", 0.4); this._upd(); }
    else if (a === "down" && this.i < n - 1) { this.i = Math.min(n - 1, this.i + heldRows("lp:down", n)); this.audio.play("cursor_down", 0.4); this._upd(); }
    else if (a === "down" && this._acts && this._acts.length) { this.act = this._acts.length - 1; this.audio.play("cursor_down", 0.3); this._applyActFocus(); }
    else if (a === "enter") { this.multi ? this._toggle() : this._done(); }
    else if (a === "start" && this.multi) this._done();  // confirm multi-select
    else if (a === "square" && this.onSquare) this.onSquare();                 // cycle mode
    else if (a === "back") this._cancel();
  }
}
