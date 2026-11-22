// The Music Player and the Volume Control window (ui.js gathers every ui-*.js)
import { call, Input } from "./api.js";
import { PadNav, MUSIC_LINKS, nodeX } from "./padnav.js";
import { SpectrumTap } from "./ps3wave/spectrum.js";
import { esc, mpIcon } from "./ui-core.js";

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

// the Music Player's visualizers after the Visualizer Wave, picked at random (Visual Player)
const VISUALIZERS = ["canyon"];

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
    // (read with CORS from the start, so the visualizers can read the music
    // without loading the song again: switching to one never interrupts it)
    this.audioEl.crossOrigin = "anonymous";
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
    // the music goes through the visualizers' sound graph before it starts (no
    // switch of its path later, mid-song), and the visualizers are made ready
    // a moment after it starts, a piece at a time (the Visualizers Cache): the
    // Visual Player then switches to them at once
    this._spectrumTap();
    this._render(); this._load(true);
    clearTimeout(this._prepT); this._prepT = setTimeout(() => this._prepareVisuals(), 1500);
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
    this._visualOff(); this._visStep = 0;
    clearTimeout(this._prepT);
    // (the Visualizers Cache: let go when the player closes, unless Save Cache in
    // System Directory keeps it for the next time; the sound graph rests meanwhile)
    if (!(this.keepVisuals && this.keepVisuals())) this.freeVisuals();
    if (this._tap && this._tap.ctx && this._tap.ctx.state === "running") this._tap.ctx.suspend().catch(() => {});
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
    if (this._visOn === "canyon") this._canyon.newTrack();
    if (this._visOn === "earth") this._earth.newTrack();
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
    this._holdKeyOn = key; this._holdAt = performance.now();
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
      case "visual": this._nextVisual(); break;
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
  // Visual Player (□): the player's visualizers in turn. First the Visualizer
  // Wave (the background instead, with Music Settings > Music Player Visualizer
  // off), then one of the others picked at random, each as likely (only Canyon
  // for now), then always the Earth (one of its flights at random), then back to
  // the Visualizer Wave.
  _nextVisual() {
    const step = ((this._visStep || 0) + 1) % 3;
    this._visualOff();
    this._visStep = step;
    if (step === 1) {
      const pick = VISUALIZERS[Math.floor(Math.random() * VISUALIZERS.length)];
      if (pick === "canyon") this._showCanyon();
    } else if (step === 2) this._showEarth();
  }
  _visCanvas(key) {
    const k = "_cv_" + key;
    if (!this[k]) { this[k] = document.createElement("canvas"); this[k].className = "mp-visual"; document.body.appendChild(this[k]); }
    return this[k];
  }
  _visCanvasFor(key) {
    const k = "_cv_" + key;
    this._visCanvas(key).classList.add("show");
    // (the whole screen covered: the wave and the background hold still meanwhile)
    document.body.classList.add("mpfull");
    return this[k];
  }
  // a visualizer that can't be shown: the next one in turn instead (Canyon
  // missing: the Earth; the Earth missing: back to the Visualizer Wave), and
  // what's missing said once
  _visFail(e, file) {
    console.warn("Visual Player:", e);
    const missing = new RegExp(file.replace(".", "\\.")).test(String(e && e.message));
    const step = this._visStep;
    this._visualOff();
    if (missing) (this._visMissing ||= new Set()).add(file);
    if (step === 1) { this._visStep = 2; this._showEarth(); return; }
    this._visStep = 0;
    this.sfx.play("error", 0.4);
    const m = [...(this._visMissing || [])];
    this._note(m.length ? `The Visual Player needs the PS3's ${m.join(" and ")} in resources\\ps3` : "The Visual Player can't be shown");
    this._visMissing = null;
  }
  // The Visualizers Cache: each visualizer made once (its pictures and programs
  // ready, drawn once while hidden), then kept until the player closes
  _canyonReady() {
    return this._canyonP ||= (async () => {
      const { Canyon, loadCanyon } = await import("./ps3wave/canyon.js");
      const archive = await loadCanyon();
      if (this._closed) throw new Error("closed");
      const c = new Canyon(this._visCanvas("canyon"), archive);
      c.onError = (e) => this._visFail(e, "canyon.qrc");
      c.prepare();
      return c;
    })().catch((e) => { this._canyonP = null; throw e; });
  }
  _earthReady() {
    return this._earthP ||= (async () => {
      const { Earth, loadEarth } = await import("./ps3wave/earth.js");
      const archive = await loadEarth();
      if (this._closed) throw new Error("closed");
      const e = await Earth.create(this._visCanvas("earth"), archive);
      e.onError = (x) => this._visFail(x, "earth.qrc");
      e.prepare();
      return e;
    })().catch((e) => { this._earthP = null; throw e; });
  }
  // (a moment after the player opens: Canyon, then the Earth, while the music plays)
  async _prepareVisuals() {
    try { if (!this._closed) await this._canyonReady(); } catch (e) {}
    try { if (!this._closed) await this._earthReady(); } catch (e) {}
  }
  // the Visualizers Cache let go: their pictures, programs and the PS3 files read for them
  freeVisuals() {
    this._visualOff();
    const drop = (p, k) => { if (p) p.then((v) => { try { v.destroy(); } catch (e) {} }).catch(() => {}); if (this[k]) { this[k].remove(); this[k] = null; } };
    drop(this._canyonP, "_cv_canyon"); drop(this._earthP, "_cv_earth");
    this._canyonP = this._earthP = null; this._canyon = this._earth = null;
    import("./ps3wave/canyon.js").then((m) => m.dropCanyon()).catch(() => {});
    import("./ps3wave/earth.js").then((m) => m.dropEarth()).catch(() => {});
  }
  // Canyon: full screen behind the player, shaped by the music
  // (ps3wave/canyon.js, from the console's canyon.qrc)
  async _showCanyon() {
    const token = this._visToken = {};
    try {
      const c = await this._canyonReady();
      if (this._visToken !== token || this._closed) return;
      this._canyon = c;
      this._visCanvasFor("canyon");
      if (c._shown) c.newTrack();
      c._shown = true;
      c.start(this._spectrumTap());
      this._visOn = "canyon";
    } catch (e) { if (this._visToken === token) this._visFail(e, "canyon.qrc"); }
  }
  // the Earth: full screen behind the player, a camera flight around the Earth
  // picked at random, again on every new song (ps3wave/earth.js, from earth.qrc)
  async _showEarth() {
    const token = this._visToken = {};
    try {
      const e = await this._earthReady();
      if (this._visToken !== token || this._closed) return;
      this._earth = e;
      this._visCanvasFor("earth");
      if (e._shown) e.newTrack();
      e._shown = true;
      e.start();
      this._visOn = "earth";
      if (this._visMissing) { const m = [...this._visMissing]; this._visMissing = null; this._note(`The Visual Player needs the PS3's ${m.join(" and ")} in resources\\ps3`); }
    } catch (e) { if (this._visToken === token) this._visFail(e, "earth.qrc"); }
  }
  _visualOff() {
    this._visOn = null; this._visToken = null;
    if (this._canyon) this._canyon.stop();
    if (this._earth) this._earth.stop();
    for (const k of ["_cv_canyon", "_cv_earth"]) if (this[k]) this[k].classList.remove("show");
    document.body.classList.remove("mpfull");
  }
  // the music as it plays, for the visualizer: the player's audio goes through
  // a Web Audio graph from now on (read with CORS, so the samples can be read)
  _spectrumTap() {
    if (!this._tap) this._tap = new SpectrumTap(this.audioEl);
    this._tap.resume();
    return this._tap;
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
      // (with the control panel hidden, left / right do what L2 / R2 do:
      // rewind and fast-forward, for as long as they're held)
      case "left": case "right":
        if (this.clusterOn) { this._padMove(a); break; }
        // (the d-pad repeats while held: the hold already under way carries on)
        // (a repeat comes 380 ms or more after the press, the button still down)
        if (this._holdKeyOn === a && (this._holdT0 || this._holdT) && Input.held[a] && performance.now() - this._holdAt >= 300) break;
        this.sfx.play("enter", 0.4); this._holdKey = a; this._actId(a === "left" ? "frev" : "ffwd"); this._holdKey = null; break;
      case "up": case "down": if (this.clusterOn) this._padMove(a); break;
      case "enter": if (this.clusterOn) { this._holdKey = "enter"; this._act(); this._holdKey = null; } break;
      case "back": this.sfx.play("back", 0.5); this.close(); break;
    }
  }
}


// (the Photo Viewer lives in photoviewer.js)
