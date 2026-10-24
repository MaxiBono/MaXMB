// PS3-style Photo Viewer.
//
//  • △        – the control panel (three rows of icons, the focused icon's name
//               and its button underneath), laid out like the console's:
//               Display Mode, Change Effect, Trimming, Add to Playlist, Print,
//               Set as Wallpaper, Delete, Display / Zoom In, Zoom Out, Rotate
//               Left, Rotate Right, Up, Down, Left, Right / Previous, Next,
//               Slideshow. During a slideshow it's the slideshow panel instead.
//  • SELECT   – Display: the picture's details (EXIF), then the top bar
//               (name, number, date), then off.
//  • L1 / R1  – previous / next. L2 / R2 – rotate. START – slideshow.
//  • Left stick / D-pad / arrow keys – move around a zoomed picture (the small
//    picture at the lower left shows where you are); right stick up / down or
//    the mouse wheel – zoom in / out.
// PDF / CBZ / CBT files (custom sections) are shown page by page.

import { playerIcon } from "./themes.js";
import { call, Input, noExt } from "./api.js";
import { appPixelScale } from "./fit.js";
import { readExif, exifRows, exifDate } from "./exif.js";
import { isDocPath, openDoc } from "./docs.js";
import { PadNav, PHOTO_LINKS, SLIDESHOW_LINKS, nodeX } from "./padnav.js";

const PV = "./assets/icons/pv/";
// pictures shared with the music player (one copy each, in the system icons)
const PV_SHARED = { next: "system/mp_next", ss_next: "system/mp_next", slideshow: "system/mp_play", ss_play: "system/mp_play", previous: "system/mp_prev", ss_previous: "system/mp_prev", ss_stop: "system/mp_stop", display: "system/mp_display", ss_repeat: "system/mp_repeat", delete: "system/mp_delete", ss_pause: "system/mp_pause", add_to_playlist: "system/mp_addplaylist", display_mode: "vp/screen_mode" };
// (an Icon Theme can have its own, in its Photo Viewer folder)
const pvIcon = (n) => playerIcon("pv", n, PV_SHARED[n] ? `./assets/icons/${PV_SHARED[n]}.png` : `${PV}${n}.png`);
const SYS = "./assets/icons/system/";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ROWS = [
  [{ id: "dmode", icon: "display_mode", label: "Display Mode" },
    { id: "effect", icon: "change_effect", label: "Change Effect" },
    { id: "trim", icon: "trimming", label: "Trimming" },
    { id: "playlist", icon: "add_to_playlist", label: "Add to Playlist" },
    { id: "print", icon: "print", label: "Print" },
    { id: "wall", icon: "set_as_wallpaper", label: "Set as Wallpaper" },
    { id: "del", icon: "delete", label: "Delete" },
    { id: "display", icon: "display", label: "Display", hint: "btn_mp_select" }],
  [{ id: "zin", icon: "zoom_in", label: "Zoom In" },
    { id: "zout", icon: "zoom_out", label: "Zoom Out" },
    { id: "rotl", icon: "rotate_left", label: "Rotate Left", hint: "btn_mp_l2" },
    { id: "rotr", icon: "rotate_right", label: "Rotate Right", hint: "btn_mp_r2" },
    { id: "up", icon: "up", label: "Up", pan: true },
    { id: "down", icon: "down", label: "Down", pan: true },
    { id: "left", icon: "left", label: "Left", pan: true },
    { id: "right", icon: "right", label: "Right", pan: true }],
  [{ id: "prev", icon: "previous", label: "Previous", hint: "btn_mp_l1" },
    { id: "next", icon: "next", label: "Next", hint: "btn_mp_r1" },
    { id: "slide", icon: "slideshow", label: "Slideshow", hint: "btn_mp_start" }],
];
const SS_ROWS = [
  [{ id: "ssstyle", icon: "ss_slideshow_style", label: "Slideshow Style" },
    { id: "ssspeed", icon: "ss_slideshow_speed", label: "Slideshow Speed" }],
  [{ id: "prev", icon: "ss_previous", label: "Previous", hint: "btn_mp_l1" },
    { id: "next", icon: "ss_next", label: "Next", hint: "btn_mp_r1" },
    { id: "play", icon: "ss_play", label: "Play", hint: "btn_mp_start" },
    { id: "pause", icon: "ss_pause", label: "Pause", hint: "btn_mp_start" },
    { id: "stop", icon: "ss_stop", label: "Stop" }],
  [{ id: "repeat", icon: "ss_repeat", label: "Repeat" }],
];
const DMODES = [["normal", "Normal"], ["zoom", "Zoom"]];
const EFFECTS = [["normal", "Normal"], ["slide", "Slide"], ["fade", "Fade"]];
const SS_STYLES = [["normal", "Normal"], ["slide", "Slide"], ["portrait", "Portrait"], ["album", "Photo Album"], ["album2", "Photo Album 2"]];
const SS_SPEEDS = [["normal", "Normal", 4000], ["slow", "Slow", 7000], ["fast", "Fast", 2000]];
const SS_TR = 1000;        // a slideshow's transition (it starts once the picture's time is up)
const HUD_MS = 1000;       // the thumbnail / frame / % hide after this long without use
const DIRS = ["up", "down", "left", "right"];
const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const NO_REWRITE = /\.(gif|svg|ico|apng)$/i;   // rotating these would lose their animation / vectors

export class PhotoViewer {
  constructor(sfx) {
    this.sfx = sfx;
    this.el = document.getElementById("mediaview");
    this.rawLeftStick = true;       // the left stick pans (main.js leaves it to us)
    this._loop = this._loop.bind(this);
    this._onResize = () => { this._fitNow(); this._apply(false); };
    // the △ panel off: hold the left button and drag to move a zoomed picture
    // (it follows the pointer); a drag isn't a click
    let drag = null;
    this.el.addEventListener("pointerdown", (e) => {
      drag = null;
      if (e.button !== 0 || !this.el.classList.contains("show") || this.menuOn || this.dlg || this.slide || this.popup) return;
      if (!this.img || !(this._canPan() || this.crop)) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      if (this.img) this.img.style.transition = "";
    });
    window.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (!(e.buttons & 1) || this.menuOn || this.dlg) { drag = null; return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; drag.x = e.clientX; drag.y = e.clientY;
      this._pan(-dx, -dy);
    });
    window.addEventListener("pointerup", () => {
      if (drag && drag.moved) window.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
      drag = null;
    });
  }

  // items: [{ path, name, modified, … }], resolve(item) -> URL
  // opts: { slideshow, playlist, fmtDate(Date) -> text, onDeleted(item),
  //         onAddToPlaylist(item, done), onWallpaper(path, done), onSaved(path) }
  open(items, startIndex, resolve, onClose, opts = {}) {
    this.items = [...(items || [])]; this.idx = Math.max(0, Math.min(this.items.length - 1, startIndex || 0));
    this.resolve = resolve; this.onClose = onClose; this.opts = opts;
    this.menuOn = false; this.fr = 0; this.fc = 0; this.popup = null; this.info = 0;
    this.dmode = 0; this.effect = 0; this.rot = 0; this.rots = new Map();
    this.slide = null; this.crop = null; this.dlg = null; this._closed = false; this._ssSeen = false;
    this.page = 0; this.doc = null;
    document.body.classList.add("menu-open", "pv-open");
    this.el.classList.add("show");
    this._build();
    window.addEventListener("resize", this._onResize);
    this._lastStick = performance.now();
    requestAnimationFrame(this._loop);
    this._load(0);
    if (opts.slideshow || opts.playlist) this._startSlideshow();
  }
  async close() {
    if (this._closed) return;
    this._closed = true;
    clearTimeout(this._slideT); clearTimeout(this._boxT); clearTimeout(this._hudT); clearTimeout(this._ssT); clearTimeout(this._ssIconT);
    window.removeEventListener("resize", this._onResize);
    const rots = [...this.rots.entries()];
    this.el.classList.remove("show"); this.el.innerHTML = "";
    document.body.classList.remove("menu-open", "pv-open");
    this.onClose && this.onClose();
    // rotated pictures are saved rotated when the viewer closes
    for (const [it, deg] of rots) {
      const d = ((deg % 360) + 360) % 360;
      if (!d || isDocPath(it.path) || NO_REWRITE.test(it.path || "")) continue;
      try {
        const url = await this._rendered(this.resolve(it), d, /\.png$/i.test(it.path) ? "image/png" : "image/jpeg");
        await call("photo_write", { path: it.path, dataUrl: url });
        this.opts.onSaved && this.opts.onSaved(it.path, true);
      } catch (e) {}
    }
  }
  get item() { return this.items[this.idx] || {}; }

  // ------------------------------------------------------------------ layout
  _build() {
    this.el.innerHTML = `<div class="pv">
      <div class="pv-stage"></div>
      <div class="pv-top"><img class="pv-cam" src="./assets/icons/theme/icon_photo.png" alt=""><span class="pv-name"></span><span class="pv-count"></span></div>
      <div class="pv-info"></div>
      <div class="mp2-cluster pv-cluster"></div>
      <div class="pv-nav"><div class="pv-navbox"><img class="pv-navimg" alt=""><div class="pv-rect"></div></div></div>
      <div class="pv-box"></div>
      <div class="pv-ss"></div>
      <div class="pv-crop"></div>
      <div class="pv-layer"></div>
    </div>`;
    const q = (s) => this.el.querySelector(s);
    this.$ = { root: q(".pv"), stage: q(".pv-stage"), top: q(".pv-top"), name: q(".pv-name"), count: q(".pv-count"),
      info: q(".pv-info"), cluster: q(".pv-cluster"), nav: q(".pv-nav"), navbox: q(".pv-navbox"), navimg: q(".pv-navimg"),
      rect: q(".pv-rect"), box: q(".pv-box"), ss: q(".pv-ss"), crop: q(".pv-crop"), layer: q(".pv-layer") };
    this._buildCluster();
  }
  _rows() { return this.slide ? SS_ROWS : ROWS; }
  _buildCluster() {
    const rows = this._rows();
    this.$.cluster.innerHTML = rows.map((row, r) => `<div class="mp2-crow">${row.map((b, c) =>
      `<button class="mp2-btn" data-r="${r}" data-c="${c}"><img class="mpi" src="${pvIcon(b.icon)}" alt=""></button>`).join("")}</div>`).join("")
      + `<div class="mp2-sub"></div><div class="pv-pop"></div>`;
    this._nodes = [...this.$.cluster.querySelectorAll(".mp2-btn")];
    this._nodes.forEach((n) => n.addEventListener("click", () => { this.fr = +n.dataset.r; this.fc = +n.dataset.c; this._navFor = null; this._syncSel(); this._act(); }));
    this._navFor = null;
    this.fr = Math.min(this.fr, rows.length - 1); this.fc = Math.min(this.fc, rows[this.fr].length - 1);
    this._syncSel();
  }
  _focused() { const row = this._rows()[this.fr] || []; return row[this.fc] || row[row.length - 1]; }
  _syncSel() {
    this.$.cluster.classList.toggle("on", this.menuOn);
    const pan = this._canPan();
    this._nodes.forEach((n) => {
      const b = this._rows()[+n.dataset.r][+n.dataset.c];
      n.classList.toggle("sel", +n.dataset.r === this.fr && +n.dataset.c === this.fc);
      n.classList.toggle("btn-off", !!b.pan && !pan);
    });
    const f = this._focused(), sub = this.$.cluster.querySelector(".mp2-sub");
    sub.innerHTML = this.menuOn ? `<span class="mp2-subname">${esc(f.label)}</span>${f.hint ? `<img class="mp2-hintimg" src="${SYS}${f.hint}.png" alt="">` : ""}` : "";
    this._renderPop();
    this._hudCheck();
  }

  // ------------------------------------------------------------ the picture
  async _load(dir) {
    const it = this.item;
    this.rot = this.rots.get(it) || 0;
    this.dmode = 0; this.doc = null;
    let url = this.resolve(it);
    if (isDocPath(it.path)) {
      try {
        this.doc = await openDoc(url, it.path);
        if (this._closed || this.item !== it) return;
        this.page = dir < 0 ? this.doc.count - 1 : 0;
        url = await this.doc.page(this.page);
      } catch (e) { this._box("display", "This file can't be opened.", 3000); return; }
      if (this._closed || this.item !== it) return;
    } else this.page = 0;
    this._show(url, dir);
    this._renderTop();
    if (this.info === 1) this._renderInfo();
  }
  _show(url, dir) {
    const img = new Image();
    img.className = "pv-img"; img.alt = ""; img.decoding = "async";
    if (!/^(data|blob):/.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this._closed) return;
      const old = this.img;
      this.img = img; this.nw = img.naturalWidth || 1; this.nh = img.naturalHeight || 1;
      this.px = 0; this.py = 0;
      this._fitNow(); this.s = this._baseScale();
      this.$.stage.appendChild(img);
      this.$.navimg.src = url;
      this._apply(false);
      this._transition(old, img, dir);
      this._syncSel();
      if (this.slide && this.slide.style === "portrait") this._kenBurns();
    };
    img.onerror = () => { this._box("display", "This picture can't be shown.", 3000); };
    img.src = url;
    this._url = url;
    this._ahead();
  }
  // What comes next is made ready while this one shows, so turning a page
  // or going to the next picture is instant: a document's next two pages and
  // the one before (drawn one at a time), or the next and previous pictures
  // (loaded and decoded). Pages already made are kept for the session.
  _ahead() {
    const run = this._aheadRun = (this._aheadRun || 0) + 1;
    const live = () => !this._closed && this._aheadRun === run;
    const decode = (u) => { if (!u) return Promise.resolve(); const im = new Image(); if (!/^(data|blob):/.test(u)) im.crossOrigin = "anonymous"; im.src = u;
      (this._held ||= []).push(im); if (this._held.length > 8) this._held.shift();   // (kept a while, so they stay decoded)
      return im.decode().catch(() => {}); };
    setTimeout(async () => {
      if (!live()) return;
      const doc = this.doc;
      if (doc) {
        for (const i of [this.page + 1, this.page + 2, this.page - 1]) {
          if (!live() || this.doc !== doc) return;
          if (i >= 0 && i < doc.count) { try { await decode(await doc.page(i)); } catch (e) {} }
        }
      }
      // the next and previous items (a document: its first page)
      const n = this.items.length;
      if (n < 2) return;
      for (const d of [1, -1]) {
        if (!live()) return;
        const it = this.items[(this.idx + d + n) % n]; if (!it) continue;
        try {
          if (isDocPath(it.path)) { const dd = await openDoc(this.resolve(it), it.path); if (live()) await decode(await dd.page(d > 0 ? 0 : dd.count - 1)); }
          else await decode(this.resolve(it));
        } catch (e) {}
      }
    }, 60);
  }
  // Change Effect (and the slideshow styles): how the next picture comes in.
  //  Slide: the picture dims 10 %, slides out quickly with the next one coming
  //         in (dimmed too), which then brightens.
  //  Fade:  a slow cross-fade, the old picture dissolving as the new one appears.
  // Web animations, so a slideshow pause stops them right where they are.
  _anim(el, frames, opts) {
    const { tr, ...o } = opts;
    const a = el.animate(frames, { fill: "both", ...o });
    (this._anims ||= new Set()).add(a);
    const done = () => this._anims && this._anims.delete(a);
    a.addEventListener("finish", done); a.addEventListener("cancel", done);
    // a paused slideshow stays paused, even for a change that was already on
    // its way; only a picture the user moves to while paused comes in
    if (this.slide && !this.slide.playing && !(opts.tr && this._runNext)) a.pause();
    return a;
  }
  _pauseAnims(on) { for (const a of this._anims || []) { try { on ? a.pause() : a.play(); } catch (e) {} } }
  _transition(old, img, dir) {
    const eff = this.slide ? ({ slide: "slide", normal: "fade", portrait: "fade", album: "fade", album2: "fade" }[this.slide.style])
      : EFFECTS[this.effect][0];
    // a transition still running: finish it at once
    for (const a of [...(this._anims || [])]) { if (a._tr) { try { a.finish(); a.cancel(); } catch (e) {} } }
    [...this.$.stage.querySelectorAll(".pv-img")].forEach((n) => { if (n !== img && n !== old) n.remove(); });
    if (!old || !dir || eff === "normal") { if (old && old !== img) old.remove(); return; }
    const end = (a, f) => a.addEventListener("finish", f, { once: true });
    if (eff === "fade") {
      const ms = this.slide ? SS_TR : 1100, o = { duration: ms, easing: "ease-in-out", tr: true };
      const a1 = this._anim(img, [{ opacity: 0 }, { opacity: 1 }], o), a2 = this._anim(old, [{ opacity: 1 }, { opacity: 0 }], o);
      a1._tr = a2._tr = true;
      end(a1, () => { old.remove(); a1.cancel(); });
      return;
    }
    const W = this.W, sgn = dir > 0 ? 1 : -1, dim = 130, move = this.slide ? SS_TR - 2 * dim : 300, T = dim * 2 + move;
    const k1 = dim / T, k2 = (dim + move) / T, ease = "cubic-bezier(.3,0,.25,1)";
    const a1 = this._anim(old, [
      { offset: 0, filter: "brightness(1)", marginLeft: "0px" },
      { offset: k1, filter: "brightness(0.9)", marginLeft: "0px", easing: ease },
      { offset: k2, filter: "brightness(0.9)", marginLeft: `${-sgn * W}px` },
      { offset: 1, filter: "brightness(0.9)", marginLeft: `${-sgn * W}px` }], { duration: T, tr: true });
    const a2 = this._anim(img, [
      { offset: 0, filter: "brightness(0.9)", marginLeft: `${sgn * W}px` },
      { offset: k1, filter: "brightness(0.9)", marginLeft: `${sgn * W}px`, easing: ease },
      { offset: k2, filter: "brightness(0.9)", marginLeft: "0px" },
      { offset: 1, filter: "brightness(1)", marginLeft: "0px" }], { duration: T, tr: true });
    a1._tr = a2._tr = true;
    end(a2, () => { old.remove(); a2.cancel(); });
  }
  _fitNow() { this.W = this.el.clientWidth || window.innerWidth; this.H = this.el.clientHeight || window.innerHeight; }
  _odd() { return Math.round(this.rot / 90) % 2 !== 0; }
  _dims() { return this._odd() ? [this.nh, this.nw] : [this.nw, this.nh]; }
  _fit(b = { w: this.W, h: this.H }) { const [w, h] = this._dims(); return Math.min(b.w / w, b.h / h); }
  _fill(b = { w: this.W, h: this.H }) { const [w, h] = this._dims(); return Math.max(b.w / w, b.h / h); }
  _baseScale() { return DMODES[this.dmode][0] === "zoom" ? this._fill() : this._fit(); }
  _pct(s = this.s) { return Math.round(s / appPixelScale() * 100); }
  _sOf(p) { return p / 100 * appPixelScale(); }
  _bounds() { return this.crop ? this.crop.rect : { x: 0, y: 0, w: this.W, h: this.H }; }
  _canPan() {
    if (!this.img) return false;
    const [w, h] = this._dims(), b = this._bounds();
    return w * this.s > b.w + 1 || h * this.s > b.h + 1;
  }
  // keep the picture over the screen (or over the trimming rectangle)
  _clamp() {
    const [w, h] = this._dims(), b = this._bounds();
    const cx = b.x + b.w / 2 - this.W / 2, cy = b.y + b.h / 2 - this.H / 2;
    const ex = Math.max(0, (w * this.s - b.w) / 2), ey = Math.max(0, (h * this.s - b.h) / 2);
    this.px = Math.max(cx - ex, Math.min(cx + ex, this.px));
    this.py = Math.max(cy - ey, Math.min(cy + ey, this.py));
  }
  _apply(animate) {
    const img = this.img; if (!img) return;
    this._clamp();
    img.style.transition = typeof animate === "string" ? animate : animate ? "transform .35s ease, width .2s ease, height .2s ease" : /opacity|margin|filter/.test(img.style.transition || "") ? img.style.transition : "";
    img.style.width = `${this.nw * this.s}px`; img.style.height = `${this.nh * this.s}px`;
    img.style.transform = `translate(-50%, -50%) translate(${this.px}px, ${this.py}px) rotate(${this.rot}deg)`;
    this._renderNav();
  }

  // the small picture at the lower left with the white rectangle (where the
  // screen is on the zoomed picture)
  _renderNav() {
    const box = this.$.navbox; if (!box || !this.img) return;
    const [w, h] = this._dims();
    const maxW = this.W * 0.094, maxH = this.H * 0.084, k = Math.min(maxW / w, maxH / h);
    const bw = w * k, bh = h * k;
    box.style.width = `${bw}px`; box.style.height = `${bh}px`;
    const ni = this.$.navimg;
    ni.style.width = `${(this._odd() ? bh : bw)}px`; ni.style.height = `${(this._odd() ? bw : bh)}px`;
    ni.style.transform = `translate(-50%, -50%) rotate(${this.rot}deg)`;
    const b = this._bounds(), dw = w * this.s, dh = h * this.s;
    const ix = this.W / 2 + this.px - dw / 2, iy = this.H / 2 + this.py - dh / 2;
    const f = (v, a, len) => Math.max(0, Math.min(1, (v - a) / len));
    const l = f(b.x, ix, dw), r = f(b.x + b.w, ix, dw), t = f(b.y, iy, dh), btm = f(b.y + b.h, iy, dh);
    Object.assign(this.$.rect.style, { left: `${l * bw}px`, top: `${t * bh}px`, width: `${(r - l) * bw}px`, height: `${(btm - t) * bh}px` });
  }
  // The thumbnail with its white frame (where the screen is on a zoomed
  // picture) shows while the picture is moved or zoomed; the zoom % only with
  // something zoom-related (zoom in / out, the right stick / mouse wheel,
  // Display Mode, a new picture). All of it hides together after a second
  // without use. In trimming / wallpaper the thumbnail stays.
  _hud(kind) {
    if (!this.img || this.slide) return;
    const pannable = this._canPan() || !!this.crop;
    this.$.nav.classList.toggle("on", pannable);
    this.$.rect.classList.toggle("on", pannable);
    if (kind === "zoom") this._zoomBox();
    clearTimeout(this._hudT);
    this._hudT = setTimeout(() => this._hudOff(), HUD_MS);
  }
  _hudOff() {
    clearTimeout(this._hudT);
    if (!this.crop) { this.$.nav.classList.remove("on"); this.$.rect.classList.remove("on"); }
    if (this._boxKind === "zoom") { this.$.box.classList.remove("on"); this._boxKind = null; }
  }
  // after a change that may make the picture un-pannable: drop the thumbnail
  _hudCheck() {
    if (!this.img) return;
    if (this.crop) { this.$.nav.classList.add("on"); return; }
    if (!this._canPan()) { this.$.nav.classList.remove("on"); this.$.rect.classList.remove("on"); }
  }
  _zoomBox(label) {
    const dm = label !== undefined;
    this.$.box.innerHTML = `<img src="${pvIcon(dm ? "display_mode" : "zoom_in")}" alt=""><span>${this._pct()}%</span>${dm ? `<span class="pv-boxmode">${esc(label)}</span>` : ""}`;
    this.$.box.classList.add("on"); this._boxKind = "zoom";
    clearTimeout(this._boxT);
  }

  // ------------------------------------------------------------ status box
  _box(icon, text, ms = 3000) {
    this.$.box.innerHTML = `${icon ? `<img src="${pvIcon(icon)}" alt="">` : ""}<span>${esc(text)}</span>`;
    this.$.box.classList.add("on"); this._boxKind = "msg";
    clearTimeout(this._boxT);
    if (ms) this._boxT = setTimeout(() => this._boxOff(), ms);
  }
  _boxOff() { this.$.box.classList.remove("on"); this._boxKind = null; }

  // ------------------------------------------------------------ Display
  _renderTop() {
    const it = this.item, n = this.items.length;
    const nm = noExt(it.title || it.name || "");
    this.$.name.textContent = this.doc ? `${nm}  (${this.page + 1}/${this.doc.count})` : nm;
    const d = it._exifDate || (it.modified ? new Date(it.modified * 1000) : null);
    this.$.count.textContent = `(${this.idx + 1}/${n})${d ? ` ${this._fmt(d)}` : ""}`;
    this.$.top.classList.toggle("on", this.info === 2);
  }
  _fmt(d, sec) { return this.opts.fmtDate ? this.opts.fmtDate(d, sec) : d.toLocaleString(); }
  async _renderInfo() {
    const it = this.item;
    this.$.info.classList.toggle("on", this.info === 1);
    if (this.info !== 1) return;
    if (!it._exif) it._exif = isDocPath(it.path) ? {} : await readExif(this.resolve(it));
    if (this._closed || this.item !== it || this.info !== 1) return;
    const ed = exifDate(it._exif);
    if (ed) it._exifDate = ed;
    const d = ed || (it.modified ? new Date(it.modified * 1000) : null);
    const rows = exifRows(it._exif, { width: this.nw, height: this.nh, dateText: d ? this._fmt(d, true) : "" });
    this.$.info.innerHTML = rows.map(([k, v]) => `<div class="pv-irow"><span class="pv-ik">${esc(k)}</span><span class="pv-iv">${esc(v)}</span></div>`).join("");
    this._renderTop();
  }
  _display() {
    this.info = (this.info + 1) % 3;
    this.sfx.play("cursor_up", 0.4);
    this._renderInfo(); this._renderTop();
  }

  // ------------------------------------------------------------ zoom / pan
  // Zoom limits: from 100 % (or less, when Normal already shows the picture
  // smaller) up to 200 % — or up to the Zoom display mode's size when that's
  // bigger. Zoom In / Out move in 100 % steps, also stopping at the sizes the
  // Normal and Zoom display modes use. In trimming the picture always covers
  // the frame.
  _zoomRange() {
    const fitP = this._pct(this._fit()), fillP = this._pct(this._fill());
    if (this.crop) {
      const c = this._pct(this._fill(this.crop.rect));
      return { min: c, max: Math.max(c * 4, 200), stops: [] };
    }
    return { min: Math.min(100, fitP), max: Math.max(200, fillP, fitP), stops: [fitP, fillP] };
  }
  _zoomStops() {
    const r = this._zoomRange(), set = new Set([r.min, r.max, ...r.stops]);
    for (let p = Math.ceil(r.min / 100) * 100; p <= r.max; p += 100) set.add(p);
    return [...set].filter((p) => p >= r.min && p <= r.max).sort((x, y) => x - y);
  }
  _setScale(s, kind = "zoom") {
    const old = this.s; this.s = s;
    // keep the same spot in the middle of the screen (of the frame, in trimming)
    const b = this._bounds(), cx = b.x + b.w / 2 - this.W / 2, cy = b.y + b.h / 2 - this.H / 2;
    const k = s / old; this.px = cx + (this.px - cx) * k; this.py = cy + (this.py - cy) * k;
    if (this.img) this.img.style.transition = "";
    this._apply(false); this._syncSel(); this._hud(kind);
  }
  _zoomStep(dir) {
    if (!this.img) return;
    const p = this._pct(), stops = this._zoomStops();
    const t = dir > 0 ? stops.find((x) => x > p) : [...stops].reverse().find((x) => x < p);
    if (t === undefined) { this.sfx.play("error", 0.3); this._hud("zoom"); return; }
    this.sfx.play("cursor_up", 0.4);
    this._setScale(this._sOf(t));
  }
  _zoomFine(step) {
    if (!this.img) return;
    const p = this._pct(), r = this._zoomRange();
    const t = Math.max(r.min, Math.min(r.max, p + step));
    if (t === p) { this._hud("zoom"); return; }
    this._setScale(this._sOf(t));
  }
  // the mouse wheel: with the △ panel off, a zoomed picture moves up / down
  // (one that fits the screen zooms instead); with the panel on it zooms
  onWheel(dir) {
    if (this.dlg || this.slide || (this.popup && this.menuOn)) return false;
    if (!this.menuOn && !this.crop && this.img && this._canPan()) {
      this.img.style.transition = "";
      this._pan(0, (dir > 0 ? 1 : -1) * Math.min(this.W, this.H) * 0.08);
      return true;
    }
    this._zoomFine(dir < 0 ? 10 : -10);
    return true;
  }
  _pan(dx, dy) {
    if (!this.img || !this._canPan()) return false;
    this.px -= dx; this.py -= dy;
    this._apply(false); this._hud("pan");
    return true;
  }
  _panStep(id) {
    if (!this._canPan()) { this.sfx.play("error", 0.3); return; }
    const st = Math.min(this.W, this.H) * 0.05, d = DIRV[id];
    if (this.img) this.img.style.transition = "";
    this._pan(d[0] * st, d[1] * st);
  }
  _rotate(dir) {
    if (!this.img) return;
    this.rot += dir * 90;
    this.rots.set(this.item, this.rot);
    this.sfx.play("cursor_up", 0.4);
    // keep the zoom level (in Normal, fit the turned picture); a quick, small turn
    if (!this._canPanAt(this.s)) this.s = this._baseScale();
    this.px = 0; this.py = 0;
    this._apply("transform .16s ease-out, width .16s ease-out, height .16s ease-out"); this._syncSel();
  }
  _canPanAt(s) { const [w, h] = this._dims(); return w * s > this.W + 1 || h * s > this.H + 1; }

  // Held directions (D-pad / arrow keys, or Cross on the Up / Down / Left /
  // Right buttons) move the picture smoothly; the sticks: left = move around,
  // right (up / down) = zoom by 1 %.
  _heldDir() {
    const h = Input.held || {};
    if (this.menuOn) {
      const f = this._focused();
      return f && f.pan && h.enter && this._panHeldFrom === f.id ? f.id : null;
    }
    return DIRS.find((d) => h[d]) || null;
  }
  _loop(now) {
    if (this._closed) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(50, now - (this._lastT || now)); this._lastT = now;
    if (this.dlg || (this.popup && this.menuOn) || this.slide || !this.img) return;
    // held D-pad / keys / panel button: after a short delay keep moving
    const hd = this._heldDir();
    if (hd && (this._canPan() || this.crop)) {
      if (this._holdDir !== hd) { this._holdDir = hd; this._holdAt = now; }
      else if (now - this._holdAt > 220) {
        const sp = Math.min(this.W, this.H) * 0.9 * dt / 1000, d = DIRV[hd];
        if (this.img) this.img.style.transition = "";
        this._pan(d[0] * sp, d[1] * sp);
      }
    } else this._holdDir = null;
    const st = Input.sticks;
    if (!st || now - (st.at || 0) > 400) return;
    const dz = 0.22, cv = (v) => (Math.abs(v) < dz ? 0 : Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz)) ** 1.6);
    const lx = cv(st.lx), ly = cv(st.ly);
    if (lx || ly) {
      const sp = Math.min(this.W, this.H) * 0.018;
      if (this.img) this.img.style.transition = "";
      this._pan(lx * sp, ly * sp);
    }
    const ry = cv(st.ry);
    if (ry) {
      const gap = 90 - Math.abs(ry) * 70;
      if (now - (this._zoomAt || 0) >= gap) { this._zoomAt = now; this._zoomFine(ry < 0 ? 1 : -1); }
    }
  }

  // ------------------------------------------------------------ navigation
  _step(d, auto) {
    if (!this.items.length) return;
    this._runNext = !auto && !!(this.slide && !this.slide.playing);   // moved to while paused
    // a document / comic: its pages first
    if (this.doc && ((d > 0 && this.page < this.doc.count - 1) || (d < 0 && this.page > 0))) {
      this.page += d;
      const doc = this.doc, want = this.page;
      // (a page asked for while the one before was still being drawn: only the last one shows)
      doc.page(want).then((u) => { if (!this._closed && this.doc === doc && this.page === want) { this._show(u, d); this._renderTop(); } });
      return;
    }
    if (this.items.length < 2 && !this.doc) return;
    this.idx = (this.idx + d + this.items.length) % this.items.length;
    this.page = 0;
    this._load(d);
  }

  // ------------------------------------------------------------ popups
  _renderPop() {
    const el = this.$.cluster.querySelector(".pv-pop"); if (!el) return;
    const p = this.popup;
    el.classList.toggle("on", !!p && this.menuOn);
    el.innerHTML = p ? p.items.map((o, i) => `<div class="pv-popi${i === p.sel ? " sel" : ""}">${esc(o[1])}</div>`).join("") : "";
  }
  _openPop(items, cur, apply) { this.popup = { items, sel: Math.max(0, cur), apply }; this.sfx.play("enter", 0.5); this._renderPop(); }
  _popInput(a) {
    const p = this.popup;
    if (a === "up" && p.sel > 0) { p.sel--; this.sfx.play("cursor_up", 0.4); this._renderPop(); }
    else if (a === "down" && p.sel < p.items.length - 1) { p.sel++; this.sfx.play("cursor_down", 0.4); this._renderPop(); }
    else if (a === "enter") { const i = p.sel; this.popup = null; this._renderPop(); this.sfx.play("enter", 0.5); p.apply(i); }
    else if (a === "back") { this.popup = null; this._renderPop(); this.sfx.play("back", 0.4); }
  }

  // ------------------------------------------------------------ actions
  _act() {
    const f = this._focused(); if (!f) return;
    if (this.slide) { this._ssAct(f.id); return; }
    switch (f.id) {
      case "dmode":
        // Normal <-> Zoom straight away (no list), shown for a second
        this.sfx.play("enter", 0.4);
        this.dmode = (this.dmode + 1) % DMODES.length; this.px = 0; this.py = 0; this.s = this._baseScale();
        if (this.img) this.img.style.transition = "";
        this._apply(false); this._syncSel(); this._hud("pan");
        this._zoomBox(DMODES[this.dmode][1]);
        return;
      case "effect":
        this._openPop(EFFECTS, this.effect, (i) => { this.effect = i; this._box("change_effect", EFFECTS[i][1]); }); return;
      case "trim": this._startCrop("trim"); return;
      case "wall": this._startCrop("wall"); return;
      case "playlist":
        if (!this.opts.onAddToPlaylist || isDocPath(this.item.path)) { this.sfx.play("error", 0.4); return; }
        this.sfx.play("enter", 0.5);
        this.opts.onAddToPlaylist(this.item, this._url, () => {});
        return;
      case "print": this._print(); return;
      case "del": this._askDelete(); return;
      case "display": this._display(); return;
      case "zin": this._zoomStep(1); return;
      case "zout": this._zoomStep(-1); return;
      case "rotl": this._rotate(-1); return;
      case "rotr": this._rotate(1); return;
      case "up": case "down": case "left": case "right":
        if (!this._canPan()) { this.sfx.play("error", 0.3); return; }
        // the panel stays: holding Cross keeps the picture moving
        this._panHeldFrom = f.id; if (this._holdDir !== f.id) this._panStep(f.id); return;
      case "prev": this.sfx.play("cursor_up", 0.4); this._step(-1); this._ssIcons("prev"); return;
      case "next": this.sfx.play("cursor_down", 0.4); this._step(1); this._ssIcons("next"); return;
      case "slide": this._startSlideshow(); return;
    }
  }

  // ------------------------------------------------------------ print
  async _print() {
    if (!this._url) return;
    this.sfx.play("enter", 0.5);
    let src = this._url;
    const d = ((this.rot % 360) + 360) % 360;
    if (d) { try { src = await this._rendered(this._url, d, "image/png"); } catch (e) {} }
    let pa = document.getElementById("printarea");
    if (!pa) { pa = document.createElement("div"); pa.id = "printarea"; document.body.appendChild(pa); }
    pa.innerHTML = `<img src="${src}" alt="">`;
    const img = pa.querySelector("img");
    const go = () => setTimeout(() => { try { window.print(); } catch (e) {} }, 50);
    if (img.complete) go(); else img.onload = go;
  }
  // the picture turned by deg (90 / 180 / 270), as a data URL
  _rendered(url, deg, type) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const odd = deg % 180 !== 0, w = im.naturalWidth, h = im.naturalHeight;
        const c = document.createElement("canvas"); c.width = odd ? h : w; c.height = odd ? w : h;
        const ctx = c.getContext("2d");
        ctx.translate(c.width / 2, c.height / 2); ctx.rotate(deg * Math.PI / 180); ctx.drawImage(im, -w / 2, -h / 2);
        res(c.toDataURL(type, 0.95));
      };
      im.onerror = rej; im.src = url;
    });
  }

  // ------------------------------------------------------------ trimming / wallpaper
  _startCrop(kind) {
    if (!this.img) return;
    this.sfx.play("enter", 0.5);
    this.menuOn = false; this.popup = null;
    const rw = this.W * 0.64, rh = rw * 9 / 16, rx = (this.W - rw) / 2, ry = this.H * 0.46 - rh / 2;
    this.crop = { kind, rect: { x: rx, y: ry, w: rw, h: rh }, saved: { s: this.s, px: this.px, py: this.py } };
    this.s = this._fill(this.crop.rect); this.px = 0; this.py = this.crop.rect.y + rh / 2 - this.H / 2;
    this.$.root.classList.add("cropping");
    this.$.crop.innerHTML = `${kind === "wall" ? `<div class="pv-crop-title" style="top:${ry}px">Specify the range to use as wallpaper.</div>` : ""}
      <div class="pv-crop-rect" style="left:${rx}px;top:${ry}px;width:${rw}px;height:${rh}px"></div>
      <div class="pv-crop-foot" style="top:${ry + rh}px"><span><span class="cf-glyph">✕</span>Enter</span><span><span class="cf-glyph">○</span>Back</span></div>`;
    this.$.crop.classList.add("on");
    if (this.img) this.img.style.transition = "";
    this._apply(false); this._syncSel(); this._hud("pan");
  }
  _endCrop() {
    const c = this.crop; if (!c) return;
    this.crop = null;
    this.s = c.saved.s; this.px = c.saved.px; this.py = c.saved.py;
    this.$.root.classList.remove("cropping");
    this.$.crop.classList.remove("on"); this.$.crop.innerHTML = "";
    if (this.img) this.img.style.transition = "";
    this._apply(false); this._syncSel(); this._hudOff();
  }
  // the part of the picture inside the rectangle, at the picture's own size
  _cropData(type) {
    const r = this.crop.rect, s = this.s;
    const ow = Math.max(1, Math.min(4096, Math.round(r.w / s))), oh = Math.max(1, Math.min(4096, Math.round(r.h / s)));
    const c = document.createElement("canvas"); c.width = ow; c.height = oh;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, ow, oh);
    ctx.scale(ow / r.w, oh / r.h);
    ctx.translate(-r.x, -r.y);
    ctx.translate(this.W / 2 + this.px, this.H / 2 + this.py);
    ctx.rotate(this.rot * Math.PI / 180);
    ctx.drawImage(this.img, -this.nw * s / 2, -this.nh * s / 2, this.nw * s, this.nh * s);
    return c.toDataURL(type, 0.95);
  }
  async _cropEnter() {
    const c = this.crop;
    const it = this.item;
    if (c.kind === "trim") {
      let data;
      try { data = this._cropData(/\.png$/i.test(it.path) ? "image/png" : "image/jpeg"); } catch (e) { this.sfx.play("error", 0.4); return; }
      this.sfx.play("enter", 0.5);
      this._endCrop();
      try {
        const out = await call("photo_save_copy", { path: it.path, dataUrl: data });
        this._box("trimming", "The trimmed image has been saved.", 3000);
        this.opts.onSaved && this.opts.onSaved(out);
      } catch (e) { this.sfx.play("error", 0.4); this._box("trimming", "The image couldn't be saved.", 3000); }
      return;
    }
    let data;
    try { data = this._cropData("image/jpeg"); } catch (e) { this.sfx.play("error", 0.4); return; }
    this.sfx.play("enter", 0.5);
    this._dialog(`The selected range will be set as the wallpaper.<br>Do you want to continue?`, data, null, async () => {
      this._endCrop();
      try {
        const path = await call("photo_save_wallpaper", { dataUrl: data });
        this.opts.onWallpaper && this.opts.onWallpaper(path);
        this._box("set_as_wallpaper", "The wallpaper has been set.", 3000);
      } catch (e) { this.sfx.play("error", 0.4); this._box("set_as_wallpaper", "The wallpaper couldn't be set.", 3000); }
    }, () => {});
  }
  _cropInput(a) {
    if (a === "enter") this._cropEnter();
    else if (a === "back") { this.sfx.play("back", 0.4); this._endCrop(); }
    // move the picture under the frame (held: keeps moving), R1 / R2 bigger,
    // L1 / L2 smaller (also the sticks and the mouse wheel); the frame keeps
    // the screen's shape and the picture always fills it
    else if (DIRS.includes(a)) { if (this._holdDir !== a) this._panStep(a); }
    else if (a === "r2" || a === "r1") this._zoomFine(10);
    else if (a === "l2" || a === "l1") this._zoomFine(-10);
  }

  // ------------------------------------------------------------ dialogs
  // the console's confirmation screen: two rules, the picture with its name /
  // date / size, the message, Yes / No, ✕ Enter / ○ Back
  _dialog(html, thumb, meta, onYes, onNo) {
    this.dlg = { sel: 0, onYes, onNo };
    this.$.root.classList.add("dlg");
    this.$.layer.innerHTML = `<div class="vp-dlg pv-dlg">
      ${thumb ? `<div class="vp-dlg-thumb pv-dlg-thumb"><img src="${thumb}" alt=""></div>` : ""}
      ${meta ? `<div class="pv-dlg-meta">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>` : ""}
      <div class="vp-dlg-body"><div class="vp-dlg-text">${html}</div>
        <div class="vp-dlg-opts"><span class="vp-dlg-opt sel">Yes</span><span class="vp-dlg-opt">No</span></div></div>
      <div class="vp-dlg-foot"><span><span class="cf-glyph">✕</span>Enter</span><span><span class="cf-glyph">○</span>Back</span></div>
    </div>`;
  }
  _closeDlg() { this.dlg = null; this.$.root.classList.remove("dlg"); this.$.layer.innerHTML = ""; }
  _dlgInput(a) {
    const d = this.dlg, opts = [...this.$.layer.querySelectorAll(".vp-dlg-opt")];
    if (a === "left" || a === "right") { d.sel = a === "left" ? 0 : 1; opts.forEach((o, i) => o.classList.toggle("sel", i === d.sel)); this.sfx.play("cursor_up", 0.3); }
    else if (a === "enter") { const yes = d.sel === 0; this._closeDlg(); this.sfx.play(yes ? "enter" : "back", 0.5); if (yes) d.onYes(); else d.onNo && d.onNo(); }
    else if (a === "back") { this._closeDlg(); this.sfx.play("back", 0.4); d.onNo && d.onNo(); }
  }
  async _askDelete() {
    const it = this.item;
    let ok = false;
    try { ok = await call("photo_deletable", { path: it.path }); } catch (e) {}
    if (!ok) { this.sfx.play("error", 0.4); this._box("delete", "Only images inside the app's folders can be deleted.", 3000); return; }
    const d = it._exifDate || (it.modified ? new Date(it.modified * 1000) : null);
    const size = it.size ? (it.size >= 1048576 ? `${(it.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(it.size / 1024))} KB`) : "";
    const nm = noExt(it.title || it.name || "");
    this.sfx.play("enter", 0.5);
    this._dialog(`The image will be deleted.<br>Are you sure you want to continue?`, this._url, [nm, d ? this._fmt(d) : "", size].filter(Boolean), async () => {
      try { await call("photo_delete", { path: it.path }); } catch (e) { this.sfx.play("error", 0.4); this._box("delete", "The image couldn't be deleted.", 3000); return; }
      this.opts.onDeleted && this.opts.onDeleted(it);
      this.rots.delete(it);
      this.items.splice(this.idx, 1);
      if (!this.items.length) { this.close(); return; }
      this.idx = Math.min(this.idx, this.items.length - 1);
      this._load(1);
    });
  }

  // ------------------------------------------------------------ slideshow
  _startSlideshow() {
    if (!this.items.length) return;
    this.sfx.play("enter", 0.5);
    this.slide = { playing: true, style: "normal", speed: 0, repeat: true };
    this.menuOn = false; this.popup = null; this.info = 0; this._renderInfo(); this._renderTop();
    this.fr = 0; this.fc = 0;
    if (this.crop) this._endCrop();
    this._hudOff();
    this.dmode = 0; this.s = this._baseScale(); this.px = 0; this.py = 0; this._apply(false);
    this._buildCluster();
    // the style shows at the lower left only the first time (and when it's changed)
    if (!this._ssSeen) { this._ssSeen = true; this._ssStyleBox(); }
    this._ssSchedule();
  }
  // when the picture's time is up, the next one's transition starts
  // (after a change the transition's second is added, so every picture shows
  // fully for its whole time)
  _ssSchedule(afterStep) {
    clearTimeout(this._slideT);
    const s = this.slide; if (!s || !s.playing) return;
    this._slideT = setTimeout(() => {
      if (!this.slide || !this.slide.playing) return;
      const last = this.idx >= this.items.length - 1 && (!this.doc || this.page >= this.doc.count - 1);
      if (last && !s.repeat) { s.playing = false; this._ssIcons("pause"); return; }
      this._step(1, true); this._ssSchedule(true);
    }, SS_SPEEDS[s.speed][2] + (afterStep ? SS_TR : 0));
  }
  // Portrait: the picture drifts slowly — zooming in, or sliding in from the
  // left or the right (taking turns)
  _kenBurns() {
    const img = this.img; if (!img || !this.slide) return;
    const ms = SS_SPEEDS[this.slide.speed][2] + SS_TR;
    const kind = (this._kbN = ((this._kbN || 0) + 1) % 3);
    const base = `translate(-50%, -50%) translate(${this.px}px, ${this.py}px)`, rot = `rotate(${this.rot}deg)`;
    const span = Math.max(this.W * 0.05, (this.nw * this.s * 1.12 - this.W) / 2);
    const frames = kind === 0
      ? [{ transform: `${base} ${rot} scale(1)` }, { transform: `${base} ${rot} scale(1.12)` }]
      : [{ transform: `${base} translateX(${kind === 1 ? -span : span}px) ${rot} scale(1.12)` },
         { transform: `${base} translateX(${kind === 1 ? span : -span}px) ${rot} scale(1.12)` }];
    this._anim(img, frames, { duration: ms, easing: "linear" });
  }
  _ssStyleBox() {
    const st = SS_STYLES.find((x) => x[0] === this.slide.style);
    this._box("ss_slideshow_style", st[1], 1000);
  }
  // the icon(s) for the button just used, at the lower left for a second:
  // Previous / Next alone; Play / Pause / Stop / Repeat show the play state
  // with Repeat beside it when it's on
  _ssIcons(id) {
    let icons;
    if (id === "prev" || id === "next") icons = [id === "prev" ? "ss_previous" : "ss_next"];
    else {
      const s = this.slide;
      const st = id === "stop" ? "ss_stop" : s && s.playing ? "ss_play" : "ss_pause";
      icons = [st, ...(s && s.repeat ? ["ss_repeat"] : [])];
    }
    this.$.ss.innerHTML = icons.map((n) => `<img class="${n === "ss_repeat" ? "pv-ssrep" : ""}" src="${pvIcon(n)}" alt="">`).join("");
    this.$.ss.classList.add("on");
    clearTimeout(this._ssIconT);
    this._ssIconT = setTimeout(() => this.$.ss.classList.remove("on"), 1000);
  }
  _ssAct(id) {
    const s = this.slide;
    switch (id) {
      case "ssstyle":
        this._openPop(SS_STYLES, SS_STYLES.findIndex((x) => x[0] === s.style), (i) => { s.style = SS_STYLES[i][0]; this._ssStyleBox(); }); return;
      case "ssspeed":
        this._openPop(SS_SPEEDS, s.speed, (i) => { s.speed = i; this._box("ss_slideshow_speed", SS_SPEEDS[i][1], 1000); this._ssSchedule(); }); return;
      case "prev": this.sfx.play("cursor_up", 0.4); this._step(-1); this._ssSchedule(true); this._ssIcons("prev"); return;
      case "next": this.sfx.play("cursor_down", 0.4); this._step(1); this._ssSchedule(true); this._ssIcons("next"); return;
      case "play": s.playing = true; this.sfx.play("enter", 0.4); this._pauseAnims(false); this._ssIcons("play"); this._ssSchedule(); return;
      case "pause":
        // everything stops right where it is, mid-transition too
        s.playing = false; this._runNext = false; this.sfx.play("enter", 0.4); clearTimeout(this._slideT); this._pauseAnims(true); this._ssIcons("pause"); return;
      case "stop":
        s.playing = false; clearTimeout(this._slideT); this.sfx.play("enter", 0.4); this._pauseAnims(true);
        this.idx = 0; this.page = 0; this._load(1); this._ssIcons("stop"); return;
      case "repeat": s.repeat = !s.repeat; this.sfx.play("enter", 0.4); this._ssIcons("repeat"); return;
    }
  }

  // ------------------------------------------------------------ input
  onInput(a) {
    if (this.dlg) { this._dlgInput(a); return; }
    if (this.crop) { this._cropInput(a); return; }
    if (this.popup && this.menuOn) { this._popInput(a); return; }
    const s = this.slide;
    switch (a) {
      case "options":
        this.menuOn = !this.menuOn; this.popup = null;
        this.sfx.play(this.menuOn ? "enter" : "back", 0.4);
        this._syncSel();
        return;
      case "back":
        this.sfx.play("back", 0.5); this.close(); return;
      case "select": if (!s) this._display(); return;
      case "l1": this.sfx.play("cursor_up", 0.4); this._step(-1); if (s) this._ssSchedule(true); this._ssIcons("prev"); return;
      case "r1": this.sfx.play("cursor_down", 0.4); this._step(1); if (s) this._ssSchedule(true); this._ssIcons("next"); return;
      case "l2": if (!s) this._rotate(-1); return;
      case "r2": if (!s) this._rotate(1); return;
      case "start":
        if (s) this._ssAct(s.playing ? "pause" : "play"); else this._startSlideshow();
        return;
    }
    if (this.menuOn) {
      if (DIRS.includes(a)) {
        // the console's D-pad paths (padnav.js), the Slideshow panel its own
        const nav = this.slide ? (this._ssNav ||= new PadNav(SS_ROWS, SLIDESHOW_LINKS)) : (this._pvNav ||= new PadNav(ROWS, PHOTO_LINKS));
        if (this._navFor !== nav) { nav.reset(); this._navFor = nav; }
        const to = nav.move(a, this.fr, this.fc, (r, c) => nodeX(this._nodes, r, c));
        if (to) { [this.fr, this.fc] = to; this.sfx.play(a === "left" || a === "up" ? "cursor_up" : "cursor_down", 0.4); this._syncSel(); }
      }
      else if (a === "enter") this._act();
      return;
    }
    // panel off: a zoomed picture moves with the D-pad, otherwise left / right
    // go to the previous / next picture
    if (DIRS.includes(a) && !s && this._canPan()) { if (this._holdDir !== a) this._panStep(a); return; }
    if (a === "left") { this.sfx.play("cursor_up", 0.4); this._step(-1); if (s) this._ssSchedule(true); this._ssIcons("prev"); }
    else if (a === "right") { this.sfx.play("cursor_down", 0.4); this._step(1); if (s) this._ssSchedule(true); this._ssIcons("next"); }
  }
}
