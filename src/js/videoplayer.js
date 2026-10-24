// PS3-style video player.
//
//  • SELECT  – the Display: a top bar (title, audio + video format badges,
//              channels, sample rate, bitrates) and a bottom bar (status,
//              chapter, time, the green progress bar, total time).
//  • △       – the control panel (three rows of icons, the hovered icon's name
//              and its button underneath), laid out like the console's.
//  • Status  – the icons at the lower left (play / pause / ×10 / 90 / repeat…)
//              and the small box above them (audio channel, screen mode) are
//              independent of the two panels, like the Music Player's.
// Formats the webview can't play are remuxed / converted by ffmpeg first
// (video.rs), so MKV, AVI, WMV, MPEG, TS, FLV… work when ffmpeg is present.

import { playerIcon } from "./themes.js";
import { call, noExt } from "./api.js";
import { ListPicker, volMarkup, volGain, VOL_STEPS } from "./ui.js";
import { fitMedia } from "./fit.js";
import { PadNav, VIDEO_LINKS, nodeX } from "./padnav.js";

const VP = "./assets/icons/vp/";
// pictures shared with the music player (one copy each, in the system icons)
const VP_SHARED = { next: "system/mp_next", stop: "system/mp_stop", play: "system/mp_play", display: "system/mp_display", repeat: "system/mp_repeat", return_to_beginning: "system/mp_prev", delete: "system/mp_delete", pause: "system/mp_pause", fast_forward: "system/mp_ffwd", fast_reverse: "system/mp_frev", volume_control: "system/mp_volume" };
// (an Icon Theme can have its own, in its Video Player folder)
const vpIcon = (n) => playerIcon("vp", n, VP_SHARED[n] ? `./assets/icons/${VP_SHARED[n]}.png` : `${VP}${n}.png`);
const SYS = "./assets/icons/system/";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const p2 = (n) => String(n).padStart(2, "0");
const hms = (s) => { s = Math.max(0, Math.floor(isFinite(s) ? s : 0)); return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s % 3600 / 60))}:${p2(s % 60)}`; };

// formats the webview can't open at all: go straight to a remux
const REMUX_FIRST = /\.(avi|wmv|asf|flv|mpg|mpeg|m2ts|mts|ts|vob|divx|3gp|3g2|f4v|rm|rmvb|mxf|ogm|dv|mod|tod|m2v|m1v|mpe|mpv|m2t|trp|tp|evo|vro|qt|amv|nsv|xvid|h264|264|hevc|265|y4m|bik|nut)$/i;
const ROWS = [
  [{ id: "scene", icon: "scene_search", label: "Scene Search", hint: ["btn_mp_square"] },
    { id: "goto", icon: "go_to", label: "Go To" },
    { id: "audio", icon: "audio_options", label: "Audio Options" },
    { id: "subs", icon: "subtitle_options", label: "Subtitle Options" },
    { id: "vol", icon: "volume_control", label: "Volume Control" },
    { id: "av", icon: "av_settings", label: "AV Settings" },
    { id: "screen", icon: "screen_mode", label: "Screen Mode" },
    { id: "icon", icon: "change_icon", label: "Change Icon" },
    { id: "del", icon: "delete", label: "Delete" },
    { id: "display", icon: "display", label: "Display", hint: ["btn_mp_select"] }],
  [{ id: "begin", icon: "return_to_beginning", label: "Return to Beginning", hint: ["btn_mp_l1"] },
    { id: "next", icon: "next", label: "Next", hint: ["btn_mp_r1"] },
    { id: "frev", icon: "fast_reverse", label: "Fast Reverse", hint: ["btn_mp_l2"] },
    { id: "ffwd", icon: "fast_forward", label: "Fast Forward", hint: ["btn_mp_r2"] },
    { id: "play", icon: "play", label: "Play", hint: ["btn_mp_start"] },
    { id: "pause", icon: "pause", label: "Pause", hint: ["btn_mp_start"] },
    { id: "stop", icon: "stop", label: "Stop" },
    { id: "ireplay", icon: "instant_replay", label: "Instant Replay" },
    { id: "iadv", icon: "instant_advance", label: "Instant Advance" },
    { id: "slowrev", icon: "slow_reverse", label: "Slow (Reverse)" },
    { id: "slowfwd", icon: "slow_forward", label: "Slow (Forward)" },
    { id: "framerev", icon: "frame_reverse", label: "Frame Reverse" },
    { id: "frameadv", icon: "frame_advance", label: "Frame Advance" }],
  [{ id: "repeat", icon: "repeat", label: "Repeat" }],
];
const FAST = [1.5, 10, 30, 120];                      // Fast Reverse / Forward steps
const IAR = [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];   // Instant Replay / Advance
const SCENE_STEPS = [[15, "15 Second Intervals"], [30, "30 Second Intervals"], [60, "1 Minute Intervals"],
  [120, "2 Minute Intervals"], [300, "5 Minute Intervals"]];
const SCREEN = [["normal", "Normal"], ["zoom", "Zoom"], ["full", "Full Screen"], ["original", "Original"]];
const PAN = [["lr", "1 Left + Right"], ["l", "1 Left"], ["r", "1 Right"]];
const kbps = (k) => k ? (k >= 1000 ? `${(k / 1000).toFixed(1)} Mbps` : `${Math.round(k)} kbps`) : "- kbps";

export class VideoPlayer {
  constructor(sfx) {
    this.sfx = sfx;
    this.el = document.getElementById("mediaview");
    this.volLevel = 5;
    this.picker = new ListPicker(sfx);
    this._onResize = () => this._applyScreen();
  }

  // items: [{ path, name, … }], resolve(item) -> URL
  // opts: { subs: [{name, path}], subResolve(path), onDeleted(item) }
  open(items, startIndex, resolve, onClose, opts = {}) {
    this.items = items; this.idx = startIndex || 0; this.resolve = resolve; this.onClose = onClose; this.opts = opts;
    this.repeat = false; this.screen = 0; this.pan = 0;
    this.clusterOn = false; this.displayOn = false; this.volOpen = false;
    this.fr = 1; this.fc = 4;                              // the panel opens on Play
    this.nav?.reset();
    this._closed = false;
    this.sfx.pauseBg();
    document.body.classList.add("menu-open", "video-open");
    this.el.classList.add("show");
    window.addEventListener("resize", this._onResize);
    this._build();
    this._load();
  }

  close() {
    this._closed = true;
    this._normalSpeed(false);
    clearTimeout(this._statusT); clearTimeout(this._boxT); clearTimeout(this._iarT); clearInterval(this._scrubT);
    clearInterval(this._rateT); clearTimeout(this._lingerT);
    window.removeEventListener("resize", this._onResize);
    if (this._subs) this._closeSubs(false);
    try { this.video.pause(); this.video.removeAttribute("src"); this.video.load(); } catch (e) {}
    try { if (this._actx) this._actx.close(); } catch (e) {}
    this._actx = null; this._srcNode = null;
    this._resetThumbs();
    this.el.classList.remove("show"); this.el.innerHTML = "";
    document.body.classList.remove("menu-open", "video-open");
    this.sfx.resumeBg();
    this.onClose && this.onClose();
  }

  get item() { return this.items[this.idx] || {}; }

  // ------------------------------------------------------------------ layout
  _build() {
    this.el.innerHTML = `<div class="vp">
      <video class="vp-video" playsinline crossorigin="anonymous"></video>
      <div class="vp-top">
        <img class="vp-filmicon" src="${vpIcon("screen_mode")}" alt="">
        <span class="vp-title"></span>
        <span class="vp-fmt vp-afmt"></span>
        <span class="vp-fmt vp-vfmt"></span>
      </div>
      <div class="vp-bottom">
        <span class="vp-chapter">Chapter&nbsp;&nbsp;&nbsp;&nbsp;-</span>
        <span class="vp-time"></span>
        <div class="vp-barwrap"><div class="mp2-bar vp-bar"><div class="mp2-fill vp-fill"></div></div><img class="vp-target" src="${vpIcon("goto_arrow")}" alt=""></div>
        <span class="vp-total"></span>
      </div>
      <div class="vp-subs"></div>
      <div class="vp-box"></div>
      <div class="vp-status"></div>
      <div class="vp-note"></div>
      <div class="mp2-cluster vp-cluster">
        ${ROWS.map((row, r) => `<div class="mp2-crow">${row.map((b, c) =>
          `<button class="mp2-btn" data-r="${r}" data-c="${c}"><img class="mpi" src="${vpIcon(b.icon)}" alt=""></button>`).join("")}</div>`).join("")}
        <div class="mp2-sub"></div>
        <div class="mp2-vol"></div>
      </div>
      <div class="vp-layer"></div>
    </div>`;
    const q = (s) => this.el.querySelector(s);
    this.$ = { root: q(".vp"), top: q(".vp-top"), bottom: q(".vp-bottom"), title: q(".vp-title"), afmt: q(".vp-afmt"), vfmt: q(".vp-vfmt"),
      time: q(".vp-time"), total: q(".vp-total"), fill: q(".vp-fill"), box: q(".vp-box"), status: q(".vp-status"),
      note: q(".vp-note"), cluster: q(".vp-cluster"), sub: q(".mp2-sub"), vol: q(".mp2-vol"), layer: q(".vp-layer"),
      target: q(".vp-target"), subs: q(".vp-subs") };
    this.video = q(".vp-video");
    const v = this.video;
    v.addEventListener("timeupdate", () => this._tick());
    v.addEventListener("loadedmetadata", () => { this._tick(); this._applyScreen(); });
    v.addEventListener("play", () => { this._renderStatus(); this._renderRates(); });
    v.addEventListener("pause", () => { this._renderStatus(); this._renderRates(); });
    v.addEventListener("ended", () => this._ended());
    v.addEventListener("error", () => this._onError());
    v.volume = volGain(this.volLevel);
    // live bitrates (Chromium's decoded-byte counters), once a second while playing
    this._rateT = setInterval(() => this._sampleRates(), 1000);
    this._nodes = [...this.el.querySelectorAll(".mp2-btn")];
    this._nodes.forEach((n) => n.addEventListener("click", () => { this.fr = +n.dataset.r; this.fc = +n.dataset.c; this.nav?.reset(); this._syncSel(); this._act(); }));
    this._applyToggles(); this._syncSel(); this._renderVol();
  }

  async _load() {
    const it = this.item;
    this._normalSpeed(false);
    this._prepared = 0; this._converting = false; this.info = null;
    this._rates = null; this._rateLast = null;
    this._subActive = "off";
    this._resetThumbs();
    [...this.video.querySelectorAll("track")].forEach((t) => t.remove());
    this.$.title.textContent = noExt(it.title || it.name || "");
    this.$.afmt.innerHTML = ""; this.$.vfmt.innerHTML = "";
    this._note("");
    this._syncSel();
    // how to play it: straight from the file, or from ffmpeg's playable copy
    // (already there when the video was preloaded or played before)
    let plan = null;
    try { plan = await call("video_plan", { path: it.path }); } catch (e) {}
    if (this._closed || this.item !== it) return;
    if (plan && plan.cached) { this._prepared = 1; this.video.src = this.resolve({ path: plan.cached }); this.video.play().catch(() => {}); }
    else if (plan && plan.mode && plan.mode !== "direct") this._prepare(plan.mode === "convert");
    else if (!plan && REMUX_FIRST.test(it.path || "")) this._prepare(false);
    else { this.video.src = this.resolve(it); this.video.play().catch(() => {}); }
    try {
      const info = await call("video_info", { path: it.path });
      if (this._closed || this.item !== it) return;
      this.info = info; this._renderInfo();
    } catch (e) {}
  }
  // the webview couldn't play it: remux with ffmpeg, then (if that still
  // fails) convert the picture as well
  _onError() {
    if (this._closed || this._converting) return;
    if (this._prepared < 2) this._prepare(this._prepared === 1);
    else { this._note("This video can't be played."); this.sfx.play("error", 0.4); }
  }
  async _prepare(full) {
    const it = this.item;
    this._prepared = full ? 2 : 1; this._converting = true;
    this._note(full ? "Converting…" : "Preparing…");
    try {
      const out = await call("video_prepare", { path: it.path, full });
      if (this._closed || this.item !== it) return;
      this._converting = false; this._note("");
      this._resetThumbs();
      this.video.src = this.resolve({ path: out });
      this.video.play().catch(() => {});
    } catch (e) {
      if (this._closed || this.item !== it) return;
      this._converting = false;
      if (!full) { this._prepare(true); return; }
      this._note(String(e).includes("ffmpeg") ? String(e) : "This video can't be played.");
      this.sfx.play("error", 0.4);
    }
  }
  _note(t) { this.$.note.textContent = t; this.$.note.classList.toggle("on", !!t); }

  // top bar: the audio badge + channels + sample rate + bitrate, the video
  // badge + bitrate. Bitrates are live while playing ("- kbps" when paused).
  _renderInfo() {
    const i = this.info || {};
    const badge = (key, cls) => `<img class="vp-badge ${cls}" src="${key ? `${VP}fmt/${key}.png` : "./assets/icons/consoles/tex_vc_none.png"}" alt="">`;
    const ch = i.channels ? `${i.channels} Ch.` : "- Ch.";
    const hz = i.sampleRate ? `${(i.sampleRate / 1000).toFixed(i.sampleRate % 1000 ? 1 : 0)} kHz` : "- kHz";
    this.$.afmt.innerHTML = i.acodec ? `${badge(i.akey, "vp-abadge")}<span>${ch}</span><span>${hz}</span><span class="vp-akbps"></span>` : "";
    this.$.vfmt.innerHTML = `${badge(i.vkey, "vp-vbadge")}<span class="vp-vkbps"></span>`;
    this._renderRates();
  }
  _sampleRates() {
    const v = this.video; if (!v || this._closed) return;
    const vb = v.webkitVideoDecodedByteCount, ab = v.webkitAudioDecodedByteCount, now = performance.now();
    if (typeof vb !== "number") return;
    const last = this._rateLast; this._rateLast = { vb, ab: ab || 0, t: now, ct: v.currentTime };
    if (!last || v.paused || v.seeking) return;
    const dt = (v.currentTime - last.ct) || (now - last.t) / 1000;
    if (dt <= 0.2 || vb < last.vb) return;
    const vk = (vb - last.vb) * 8 / 1000 / dt, ak = ((ab || 0) - last.ab) * 8 / 1000 / dt;
    // smooth a little so the number doesn't jump around every second
    const sm = (o, n) => (o == null ? n : o * 0.5 + n * 0.5);
    this._rates = { v: sm(this._rates?.v, vk), a: ak > 0 ? sm(this._rates?.a, ak) : this._rates?.a };
    this._renderRates();
  }
  _renderRates() {
    const live = !this.video?.paused && this._rates;
    const vk = this.el.querySelector(".vp-vkbps"), ak = this.el.querySelector(".vp-akbps");
    if (vk) vk.textContent = kbps(live ? this._rates.v : 0);
    if (ak) ak.textContent = kbps(live ? this._rates.a : 0);
  }

  _applyToggles() {
    this.$.cluster.classList.toggle("on", this.clusterOn);
    const disp = this.displayOn || !!this._goto || !!this._linger;
    this.$.top.classList.toggle("on", this.displayOn);
    this.$.bottom.classList.toggle("on", disp);
    this.$.root.classList.toggle("disp", disp);
    this.$.root.classList.toggle("goto", !!this._goto);
    this.$.vol.classList.toggle("on", this.clusterOn && this.volOpen);
    this._renderSub();
  }
  _focused() { const row = ROWS[this.fr] || []; return row[this.fc] || row[row.length - 1]; }
  _syncSel() {
    this._nodes.forEach((n) => n.classList.toggle("sel", +n.dataset.r === this.fr && +n.dataset.c === this.fc));
    this._renderSub();
  }
  _renderSub() {
    if (!this.clusterOn) { this.$.sub.innerHTML = ""; return; }
    const f = this._focused();
    const hints = (f.hint || []).map((h) => `<img class="mp2-hintimg" src="${SYS}${h}.png" alt="">`).join("");
    this.$.sub.innerHTML = `<span class="mp2-subname">${esc(f.label)}</span>${hints}`;
  }
  _renderVol() { this.$.vol.innerHTML = volMarkup(this.volLevel); }

  _tick() {
    const v = this.video, cur = this._scrubPos ?? v.currentTime ?? 0, dur = v.duration || this.info?.duration || 0;
    if (!this._goto) this.$.time.textContent = hms(cur);
    this.$.total.textContent = hms(dur);
    this.$.fill.style.width = dur ? `${Math.min(100, cur / dur * 100)}%` : "0%";
    this._placeTarget();
  }
  // Go To: the green arrow under the bar marks the time being chosen
  _placeTarget() {
    const g = this._goto, dur = this.video.duration || this.info?.duration || 0;
    const on = !!g && g.stage === "edit" && dur > 0;
    this.$.target.classList.toggle("on", on);
    if (on) {
      const t = g.v[0] * 3600 + g.v[1] * 60 + g.v[2];
      this.$.target.style.left = `${Math.min(100, t / dur * 100)}%`;
    }
  }

  // ------------------------------------------------------------ status icons
  _statusIcons() {
    const s = this._speed;
    let main;
    if (this._iar) main = [this._iar.dir < 0 ? "instant_replay" : "instant_advance", `iar_${IAR[this._iar.i]}`];
    else if (s && (s.kind === "ff" || s.kind === "fr")) main = [s.kind === "ff" ? "fast_forward" : "fast_reverse", `frf_${String(FAST[s.i]).replace(".", "_")}`];
    else if (s && s.kind === "slowf") main = ["slow_forward"];
    else if (s && s.kind === "slowr") main = ["slow_reverse"];
    else main = [this.video.paused ? "pause" : "play"];
    let h = `<span class="vp-st-main">${main.map((n, i) => `<img class="${i ? "vp-st-num" : "vp-st"}" src="${vpIcon(n)}" alt="">`).join("")}</span>`;
    if (this.repeat) h += `<img class="vp-st-rep" src="${vpIcon("repeat")}" alt="">`;   // always in the same spot
    return h;
  }
  _renderStatus() { this.$.status.innerHTML = this._statusIcons(); this._statusVisibility(); }
  // shown while something isn't plain playback (paused, fast, slow, a jump
  // being chosen) and for ~1.5 s after any transport button
  _statusVisibility() {
    const sticky = this.video.paused || !!this._speed || !!this._iar;
    const on = sticky || this._flashOn;
    this.$.status.classList.toggle("on", !!on);
  }
  _flash() {
    this._renderStatus();
    this._flashOn = true; this._statusVisibility();
    clearTimeout(this._statusT);
    this._statusT = setTimeout(() => { this._flashOn = false; this._statusVisibility(); }, 2500);
  }
  // the small dark box above the status icons ("♪ 1 Right", "Zoom",
  // "Repeat On"…); icon = null for a text-only box
  _showBox(icon, text, ms = 3000) {
    this.$.box.innerHTML = `${icon ? `<img src="${vpIcon(icon)}" alt="">` : ""}<span>${esc(text)}</span>`;
    this.$.box.classList.toggle("txt", !icon);
    this.$.box.classList.add("on");
    clearTimeout(this._boxT);
    this._boxT = setTimeout(() => this.$.box.classList.remove("on"), ms);
  }

  // ------------------------------------------------------------ speed modes
  // ff / fr (×1.5, ×10, ×30, ×120), slow forward / reverse (×0.5). The
  // webview plays forwards at 1.5x and 0.5x itself; everything faster or
  // backwards is done by stepping the picture along.
  _setSpeed(kind) {
    const s = this._speed;
    if ((kind === "ff" || kind === "fr")) {
      const i = s && s.kind === kind ? s.i + 1 : 0;
      if (i >= FAST.length) { this._normalSpeed(true); return; }
      this._startSpeed({ kind, i, rate: (kind === "ff" ? 1 : -1) * FAST[i] });
    } else {
      if (s && s.kind === kind) { this._normalSpeed(true); return; }
      this._startSpeed({ kind, i: 0, rate: kind === "slowf" ? 0.5 : -0.5 });
    }
  }
  _startSpeed(sp) {
    const v = this.video;
    this._stopScrub();
    if (!this._speed) this._wasPlaying = !v.paused;
    this._speed = sp;
    if (sp.rate > 0 && sp.rate <= 1.5) {
      v.playbackRate = sp.rate; v.play().catch(() => {});
    } else {
      v.playbackRate = 1; v.pause();
      this._scrubPos = v.currentTime;
      let last = performance.now();
      this._scrubT = setInterval(() => {
        const now = performance.now(), dt = (now - last) / 1000; last = now;
        const dur = v.duration || 0;
        this._scrubPos = Math.max(0, Math.min(dur || 1e9, this._scrubPos + sp.rate * dt));
        if (!v.seeking) v.currentTime = this._scrubPos;
        this._tick();
        if (this._scrubPos <= 0 || (dur && this._scrubPos >= dur - 0.05)) this._normalSpeed(true);
      }, 80);
    }
    this._flash();
  }
  _stopScrub() { clearInterval(this._scrubT); this._scrubT = null; this._scrubPos = null; }
  _normalSpeed(resume) {
    const v = this.video;
    const had = !!this._speed;
    this._stopScrub();
    this._speed = null;
    if (v) v.playbackRate = 1;
    if (had && resume && v) { v.play().catch(() => {}); }
    if (v && this.$) this._flash();
  }

  // Instant Replay / Advance: each press steps the amount (15 → 180 s); the
  // jump happens once the presses stop; one more press after 180 cancels
  _instant(dir) {
    const cur = this._iar && this._iar.dir === dir ? this._iar.i + 1 : 0;
    clearTimeout(this._iarT);
    if (cur >= IAR.length) { this._iar = null; this._flash(); return; }
    this._iar = { dir, i: cur };
    this._flash();
    this._iarT = setTimeout(() => {
      const j = this._iar; this._iar = null;
      if (!j || this._closed) return;
      this._seekTo((this.video.currentTime || 0) + j.dir * IAR[j.i]);
      this._flash();
    }, 1200);
  }

  _seekTo(t) {
    const v = this.video, dur = v.duration || this.info?.duration || 0;
    v.currentTime = Math.max(0, dur ? Math.min(dur - 0.05, t) : t);
    this._tick();
  }
  _frame(dir) {
    const v = this.video;
    this._normalSpeed(false);
    v.pause();
    const fps = this.info?.fps || 30;
    this._seekTo((v.currentTime || 0) + dir / fps);
    this._flash();
  }
  _ended() {
    if (this.repeat) { this.video.currentTime = 0; this.video.play().catch(() => {}); return; }
    // the next video; after the last one, back round to the first
    if (this.items.length > 1) { this.idx = (this.idx + 1) % this.items.length; this._load(); }
    else { this._renderStatus(); }
  }

  // ------------------------------------------------------------ actions
  _actId(id) {
    const v = this.video;
    switch (id) {
      case "scene": this._openScene(); return;
      case "goto": this._openGoto(); return;
      case "audio": this._cyclePan(); return;
      case "subs": this._openSubs(); return;
      case "vol": this.volOpen = true; this._applyToggles(); this._renderVol(); return;
      case "av": return;                                     // placeholder
      case "screen": this.screen = (this.screen + 1) % SCREEN.length; this._applyScreen(); this._showBox("screen_mode", SCREEN[this.screen][1]); return;
      case "icon": this._askIcon(); return;
      case "del": this._askDelete(); return;
      case "display": this.displayOn = !this.displayOn; this._applyToggles(); return;
      // Return to Beginning: the start of this video, or, already at its
      // start (the first 1 s), the previous video
      case "begin":
        this._normalSpeed(false);
        // (the first video goes round to the last)
        if ((v.currentTime || 0) < 1 && this.items.length > 1) { this.idx = (this.idx - 1 + this.items.length) % this.items.length; this._load(); this._flash(); return; }
        this._seekTo(0); v.play().catch(() => {}); this._flash(); return;
      case "next": if (this.items.length > 1) { this.idx = (this.idx + 1) % this.items.length; this._load(); this._flash(); } else this.sfx.play("error", 0.3); return;
      case "frev": this._setSpeed("fr"); return;
      case "ffwd": this._setSpeed("ff"); return;
      case "play": this._normalSpeed(false); v.play().catch(() => {}); this._flash(); return;
      case "pause": this._normalSpeed(false); v.pause(); this._flash(); return;
      case "playpause": if (this._speed) { this._normalSpeed(false); v.play().catch(() => {}); } else if (v.paused) v.play().catch(() => {}); else v.pause(); this._flash(); return;
      case "stop": this.close(); return;
      case "ireplay": this._instant(-1); return;
      case "iadv": this._instant(1); return;
      case "slowrev": this._setSpeed("slowr"); return;
      case "slowfwd": this._setSpeed("slowf"); return;
      case "framerev": this._frame(-1); return;
      case "frameadv": this._frame(1); return;
      case "repeat": this.repeat = !this.repeat; this._flash(); this._showBox(null, this.repeat ? "Repeat On" : "Repeat Off", 1000); return;
    }
  }
  _act() { const f = this._focused(); if (!f) return; this.sfx.play("enter", 0.4); this._actId(f.id); }

  // Normal: the whole picture fitted in (black bars as needed). Zoom: fills the
  // screen, cut at the sides or top / bottom. Full Screen: stretched to the
  // screen. Original: the video's own pixel size (smaller when it's lower
  // resolution than the app; fitted in when it's bigger).
  _applyScreen() {
    if (!this.video) return;
    const m = SCREEN[this.screen][0];
    this.video.dataset.mode = m;
    fitMedia(this.video, m, this.$.root);
  }

  // Audio Options: which channel to hear (Left + Right / Left / Right)
  _cyclePan() {
    this.pan = (this.pan + 1) % PAN.length;
    this._showBox("audio_options", PAN[this.pan][1]);
    try {
      if (!this._actx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this._actx = new Ctx();
        this._srcNode = this._actx.createMediaElementSource(this.video);
        this._split = this._actx.createChannelSplitter(2);
        this._merge = this._actx.createChannelMerger(2);
        this._split.channelCountMode = "explicit"; this._split.channelInterpretation = "discrete";
        this._srcNode.connect(this._split);
        this._merge.connect(this._actx.destination);
      }
      this._actx.resume().catch(() => {});
      try { this._split.disconnect(); } catch (e) {}
      try { this._gL.disconnect(); this._gR.disconnect(); } catch (e) {}
      // Left / Right: everything goes to that speaker only (both channels mixed
      // into it), the other is silent. Left + Right: stereo as recorded.
      const mode = PAN[this.pan][0];
      if (!this._gL) { this._gL = this._actx.createGain(); this._gR = this._actx.createGain(); }
      if (mode === "lr") { this._split.connect(this._merge, 0, 0); this._split.connect(this._merge, 1, 1); }
      else {
        const out = mode === "l" ? 0 : 1;
        this._gL.gain.value = 0.7; this._gR.gain.value = 0.7;
        this._split.connect(this._gL, 0); this._split.connect(this._gR, 1);
        this._gL.connect(this._merge, 0, out); this._gR.connect(this._merge, 0, out);
      }
    } catch (e) { /* audio routing not available: the label still changes */ }
  }

  // ------------------------------------------------------------ Scene Search
  _openScene() {
    const dur = this.video.duration || this.info?.duration || 0;
    if (!dur) { this.sfx.play("error", 0.3); return; }
    this._closeLayers();
    this.video.pause();
    this._scene = { step: 2, sel: 0 };
    this.$.root.classList.add("scene");
    this._renderScene();
  }
  _sceneTimes() {
    const dur = this.video.duration || this.info?.duration || 0, st = SCENE_STEPS[this._scene.step][0];
    const out = []; for (let t = 0; t < dur; t += st) out.push(t);
    return out;
  }
  _renderScene() {
    const times = this._sceneTimes();
    const s = this._scene; s.sel = Math.max(0, Math.min(times.length - 1, s.sel));
    const want = [];
    const slot = (k) => {
      const i = s.sel + k; if (i < 0 || i >= times.length) return "";
      const t = times[i], url = this._thumbs.get(t);
      if (!url) want.push([Math.abs(k), t]);
      return `<div class="vp-thumb${k === 0 ? " sel" : ""}" style="--k:${k}" data-t="${t}">${url ? `<img src="${url}" alt="">` : ""}</div>`;
    };
    const dur = this.video.duration || this.info?.duration || 0, t = times[s.sel] || 0;
    this.$.layer.innerHTML = `<div class="vp-scene">
      <div class="vp-scene-label">${SCENE_STEPS[s.step][1]}<span class="vp-arrows">${s.step < SCENE_STEPS.length - 1 ? `<img class="up" src="${vpIcon("arrow_up")}" alt="">` : ""}${s.step > 0 ? `<img class="dn" src="${vpIcon("arrow_down")}" alt="">` : ""}</span></div>
      <div class="vp-thumbs">${[-4, -3, -2, -1, 0, 1, 2, 3, 4].map(slot).join("")}</div>
      <div class="vp-scene-name"><img class="vp-ssbtn" src="${vpIcon("ss_left")}" alt=""><span>Scene Search</span><img class="vp-ssbtn" src="${vpIcon("ss_right")}" alt=""></div>
      <div class="vp-scene-bar"><span class="vp-time">${hms(t)}</span><div class="mp2-bar vp-bar"><div class="mp2-fill" style="width:${dur ? t / dur * 100 : 0}%"></div></div><span class="vp-total">${hms(dur)}</span></div>
    </div>`;
    // the selected scene first, then outwards
    this._thumbQ = want.sort((a, b) => a[0] - b[0]).map((w) => w[1]);
    this._thumbWork();
  }
  // Scene pictures: one hidden copy of the video seeks to each time and the
  // frame is kept as a small JPEG (so moving along doesn't reload anything)
  async _thumbWork() {
    if (this._thumbBusy) return;
    this._thumbBusy = true;
    const it = this.item;
    try {
      if (!this._tv) {
        const tv = document.createElement("video");
        tv.muted = true; tv.preload = "auto"; tv.crossOrigin = "anonymous";
        tv.src = this.video.currentSrc || this.video.src;
        this._tv = tv;
      }
      const tv = this._tv;
      if (tv.readyState < 1) await new Promise((r) => { tv.addEventListener("loadedmetadata", r, { once: true }); setTimeout(r, 4000); });
      while (this._thumbQ && this._thumbQ.length && !this._closed && this.item === it) {
        const t = this._thumbQ.shift();
        if (this._thumbs.has(t)) continue;
        await new Promise((r) => {
          let done = false; const fin = () => { if (!done) { done = true; tv.removeEventListener("seeked", fin); r(); } };
          tv.addEventListener("seeked", fin); tv.currentTime = Math.min(t + 0.05, (tv.duration || t + 1) - 0.05); setTimeout(fin, 3000);
        });
        if (tv.readyState < 2) await new Promise((r) => { tv.addEventListener("loadeddata", r, { once: true }); setTimeout(r, 1500); });
        let url = "";
        try {
          const c = document.createElement("canvas"); c.width = 320; c.height = 180;
          c.getContext("2d").drawImage(tv, 0, 0, 320, 180); url = c.toDataURL("image/jpeg", 0.8);
        } catch (e) { url = ""; }
        if (!url) continue;
        this._thumbs.set(t, url);
        const box = this.$.layer.querySelector(`.vp-thumb[data-t="${t}"]`);
        if (box && !box.firstChild) box.innerHTML = `<img src="${url}" alt="">`;
      }
    } finally { this._thumbBusy = false; }
  }
  _resetThumbs() {
    this._thumbs = new Map(); this._thumbQ = [];
    if (this._tv) { try { this._tv.removeAttribute("src"); this._tv.load(); } catch (e) {} this._tv = null; }
  }
  _sceneInput(a) {
    const s = this._scene, n = this._sceneTimes().length;
    if (a === "left" && s.sel > 0) { s.sel--; this.sfx.play("cursor_up", 0.4); this._renderScene(); }
    else if (a === "right" && s.sel < n - 1) { s.sel++; this.sfx.play("cursor_down", 0.4); this._renderScene(); }
    else if (a === "up" || a === "down") {
      const t = this._sceneTimes()[s.sel] || 0;
      const ns = Math.max(0, Math.min(SCENE_STEPS.length - 1, s.step + (a === "up" ? 1 : -1)));
      if (ns !== s.step) { s.step = ns; s.sel = Math.floor(t / SCENE_STEPS[ns][0]); this.sfx.play("cursor_up", 0.4); this._renderScene(); }
    }
    else if (a === "enter") { const t = this._sceneTimes()[s.sel] || 0; this._closeScene(); this._seekTo(t); this.video.play().catch(() => {}); this.sfx.play("enter", 0.5); }
    else if (a === "back" || a === "square") { this._closeScene(); this.video.play().catch(() => {}); this.sfx.play("back", 0.4); }
  }
  _closeScene() { this._scene = null; this.$.root.classList.remove("scene"); this.$.layer.innerHTML = ""; }

  // ------------------------------------------------------------ Go To
  // first the time glows; ✕ again lets you set hours / minutes / seconds
  // (seconds first), ✕ jumps there (up to 99:59:59)
  _openGoto() {
    this._closeLayers();
    this._goto = { stage: "glow", f: 2, v: [0, 0, 0] };
    this._applyToggles(); this._renderGoto();
  }
  _renderGoto() {
    const g = this._goto, tm = this.$.time;
    tm.classList.toggle("glow", g.stage === "glow");
    if (g.stage === "glow") { tm.textContent = hms(this.video.currentTime); return; }
    tm.innerHTML = g.v.map((n, i) => `<span class="vp-gf${i === g.f ? " on" : ""}">${p2(n)}${i === g.f
      ? `<img class="vp-gup" src="${vpIcon("arrow_up")}" alt=""><img class="vp-gdn" src="${vpIcon("arrow_down")}" alt="">` : ""}</span>`).join(":");
    this._placeTarget();
  }
  _gotoInput(a) {
    const g = this._goto;
    if (a === "back") { this._closeGoto(); this.sfx.play("back", 0.4); return; }
    if (g.stage === "glow") {
      if (a === "enter") {
        const t = Math.floor(this.video.currentTime || 0);
        g.v = [Math.floor(t / 3600), Math.floor(t % 3600 / 60), t % 60];
        g.stage = "edit"; this.sfx.play("enter", 0.4); this._renderGoto();
      }
      return;
    }
    const max = [99, 59, 59];
    if (a === "left" && g.f > 0) { g.f--; this.sfx.play("cursor_up", 0.3); }
    else if (a === "right" && g.f < 2) { g.f++; this.sfx.play("cursor_down", 0.3); }
    else if (a === "up") { g.v[g.f] = (g.v[g.f] + 1) % (max[g.f] + 1); this.sfx.play("cursor_up", 0.3); }
    else if (a === "down") { g.v[g.f] = (g.v[g.f] + max[g.f]) % (max[g.f] + 1); this.sfx.play("cursor_down", 0.3); }
    else if (a === "enter") {
      const t = g.v[0] * 3600 + g.v[1] * 60 + g.v[2];
      this._closeGoto(); this._seekTo(t); this.sfx.play("enter", 0.5); return;
    }
    this._renderGoto();
  }
  // after Go To the lower half stays 1 s, then fades (when the Display is off)
  _closeGoto() {
    this._goto = null; this.$.time.classList.remove("glow");
    clearTimeout(this._lingerT);
    if (!this.displayOn) {
      this._linger = true;
      this._lingerT = setTimeout(() => { this._linger = false; this._applyToggles(); }, 1000);
    }
    this._applyToggles(); this._tick();
  }

  // ------------------------------------------------------------ Subtitles
  _subSources() {
    const out = [{ label: "Off", key: "off" }];
    (this.info?.subs || []).forEach((s, i) => out.push({ label: `Embedded ${i + 1}${s.lang ? ` (${s.lang})` : ""}`, key: "emb:" + s.index }));
    const base = (this.item.name || "").replace(/\.[^.]+$/, "").toLowerCase();
    const subs = [...(this.opts.subs || [])].sort((a, b) => (b.name || "").toLowerCase().startsWith(base) - (a.name || "").toLowerCase().startsWith(base));
    for (const s of subs) out.push({ label: s.title || s.name, key: "file:" + s.path, path: s.path });
    return out;
  }
  // Subtitle Options: the same list menu as Select Background Music
  _openSubs() {
    this._closeLayers();
    const srcs = this._subSources();
    this._subs = { srcs };
    document.body.classList.add("vp-form");
    this.picker.open({ title: "Subtitle Options", submit: "Select",
      items: srcs.map((x) => ({ label: x.label, id: x.key, sub: x.key === this._subActive ? "Current" : "" })) },
      (ch) => { const src = srcs.find((x) => x.key === ch.id); this._closeSubs(true); if (src) this._applySub(src); },
      () => this._closeSubs(true));
    const cur = Math.max(0, srcs.findIndex((x) => x.key === this._subActive));
    if (cur) { this.picker.i = cur; this.picker._upd && this.picker._upd(); }
  }
  _closeSubs(keepMenu) {
    this._subs = null;
    this.picker.close();
    document.body.classList.remove("vp-form");
    if (keepMenu !== false && !this._closed) document.body.classList.add("menu-open");
  }
  _subsInput(a) {
    this.picker.onInput(a);
  }
  async _applySub(src) {
    const v = this.video;
    [...v.querySelectorAll("track")].forEach((t) => t.remove());
    for (const tt of v.textTracks || []) tt.mode = "disabled";
    if (this.$.subs) this.$.subs.innerHTML = "";
    this._subActive = src.key;
    if (src.key === "off") return;
    let text = "";
    try {
      if (src.key.startsWith("emb:")) text = await call("video_subtitle", { path: this.item.path, index: +src.key.slice(4) });
      else {
        const url = this.opts.subResolve ? this.opts.subResolve(src.path) : src.path;
        text = await (await fetch(url)).text();
      }
    } catch (e) { this._showBox("subtitle_options", "Subtitles unavailable"); return; }
    if (!/^WEBVTT/.test(text)) text = "WEBVTT\n\n" + text.replace(/\r+/g, "").replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2");
    const tr = document.createElement("track");
    tr.kind = "subtitles"; tr.default = true;
    tr.src = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
    v.appendChild(tr);
    // the cues are drawn by the player itself (not the video's own captions,
    // which Windows can give a black box): no background, the font in use and
    // the Text Color, with an outline that's always black
    const show = (tt) => {
      if (!tt || tt._xmbSubs) return;
      tt._xmbSubs = true; tt.mode = "hidden";
      tt.addEventListener("cuechange", () => {
        if (this._subActive !== src.key || !this.$.subs) return;
        const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        this.$.subs.innerHTML = [...(tt.activeCues || [])].map((c) =>
          `<div class="vp-cue">${esc(String(c.text || "").replace(/<[^>]+>/g, "")).replace(/\n/g, "<br>")}</div>`).join("");
      });
    };
    tr.addEventListener("load", () => show(tr.track || v.textTracks[v.textTracks.length - 1]));
    if (tr.track) { tr.track.mode = "hidden"; show(tr.track); }
  }

  // ------------------------------------------------------------ dialogs
  // the console's confirmation screen: two rules, the message (with the scene
  // picture for Change Icon), Yes / No, and ✕ Enter / ○ Back
  _dialog(html, onYes, withThumb) {
    this._closeLayers();
    this.video.pause();
    this._dlg = { sel: 0, onYes };
    this.$.root.classList.add("dlg");
    this._shot = withThumb ? this._grab() : null;
    this.$.layer.innerHTML = `<div class="vp-dlg">
      ${withThumb ? `<div class="vp-dlg-thumb">${this._shot ? `<img src="${this._shot}" alt="">` : ""}</div>` : ""}
      <div class="vp-dlg-body"><div class="vp-dlg-text">${html}</div>
        <div class="vp-dlg-opts"><span class="vp-dlg-opt sel">Yes</span><span class="vp-dlg-opt">No</span></div></div>
      <div class="vp-dlg-foot"><span><span class="cf-glyph">✕</span>Enter</span><span><span class="cf-glyph">○</span>Back</span></div>
    </div>`;
  }
  _dlgInput(a) {
    const d = this._dlg, opts = [...this.$.layer.querySelectorAll(".vp-dlg-opt")];
    if (a === "left" || a === "right") { d.sel = a === "left" ? 0 : 1; opts.forEach((o, i) => o.classList.toggle("sel", i === d.sel)); this.sfx.play("cursor_up", 0.3); }
    else if (a === "enter") { const yes = d.sel === 0; this._closeDlg(); this.sfx.play(yes ? "enter" : "back", 0.5); if (yes) d.onYes(); else this.video.play().catch(() => {}); }
    else if (a === "back") { this._closeDlg(); this.sfx.play("back", 0.4); this.video.play().catch(() => {}); }
  }
  // the current picture as a JPEG data URL (null when it can't be read)
  _grab() {
    const v = this.video;
    try {
      if (!v.videoWidth) return null;
      const c = document.createElement("canvas"); const w = 480, h = Math.round(w * v.videoHeight / v.videoWidth);
      c.width = w; c.height = h; c.getContext("2d").drawImage(v, 0, 0, w, h); return c.toDataURL("image/jpeg", 0.88);
    } catch (e) { return null; }
  }
  _closeDlg() { this._dlg = null; this._shot = null; this.$.root.classList.remove("dlg"); this.$.layer.innerHTML = ""; }
  _askIcon() {
    this._dialog(`15 seconds of video starting from this scene will be set as the icon.<br>If an icon has already been set, it will be overwritten.<br>Do you want to continue?`,
      async () => {
        const v = this.video, t = v.currentTime || 0;
        const data = this._shot || null;    // a frame that can't be read: ffmpeg takes it
        const it = this.item;
        this._showBox("change_icon", "Setting the icon…", 60000);
        try {
          await call("video_set_icon", { path: it.path, time: t, dataUrl: data });
          const [cover, clip] = await call("video_icon_files", { path: it.path });
          it.cover = cover; it.clip = clip;
          this.opts.onIconChanged && this.opts.onIconChanged(it, cover, clip);
          this._showBox("change_icon", "The icon has been set.", 2000);
        } catch (e) { this.sfx.play("error", 0.4); this._showBox("change_icon", "The icon couldn't be set.", 2500); }
        v.play().catch(() => {});
      }, true);
  }
  async _askDelete() {
    let ok = false;
    try { ok = await call("video_deletable", { path: this.item.path }); } catch (e) {}
    if (!ok) { this.sfx.play("error", 0.4); this._showBox("delete", "Only videos in the system's Videos folder can be deleted"); return; }
    this._dialog(`The title that is currently playing will be deleted.<br>Are you sure you want to continue?`, async () => {
      const it = this.item;
      try { this.video.pause(); this.video.removeAttribute("src"); this.video.load(); } catch (e) {}
      try { await call("video_delete", { path: it.path }); } catch (e) { this.sfx.play("error", 0.4); this._load(); return; }
      this.items.splice(this.idx, 1);
      this.opts.onDeleted && this.opts.onDeleted(it);
      if (!this.items.length) { this.close(); return; }
      this.idx = Math.min(this.idx, this.items.length - 1); this._load();
    });
  }
  _closeLayers() {
    if (this._scene) this._closeScene();
    if (this._goto) this._closeGoto();
    this._subs = null; this._dlg = null; this.$.root.classList.remove("dlg"); this.$.layer.innerHTML = "";
  }

  // ------------------------------------------------------------ input
  onInput(a) {
    if (this._dlg) { this._dlgInput(a); return; }
    if (this._scene) { this._sceneInput(a); return; }
    if (this._goto) { this._gotoInput(a); return; }
    if (this._subs) { this._subsInput(a); return; }
    if (this.volOpen) {
      if (a === "left" || a === "right") {
        this.volLevel = Math.max(1, Math.min(VOL_STEPS, this.volLevel + (a === "right" ? 1 : -1)));
        this.video.volume = volGain(this.volLevel); this.sfx.play(a === "right" ? "cursor_down" : "cursor_up", 0.4); this._renderVol();
      } else if (a === "enter" || a === "back") { this.volOpen = false; this._applyToggles(); this.sfx.play(a === "back" ? "back" : "enter", 0.4); }
      else if (a === "options") { this.clusterOn = !this.clusterOn; this._applyToggles(); }
      return;
    }
    switch (a) {
      case "options": this.clusterOn = !this.clusterOn; this.sfx.play("enter", 0.4); this._applyToggles(); return;
      case "select": this.sfx.play("enter", 0.4); this._actId("display"); return;
      case "square": this.sfx.play("enter", 0.4); this._actId("scene"); return;
      case "l1": this.sfx.play("enter", 0.4); this._actId("begin"); return;
      case "r1": this.sfx.play("enter", 0.4); this._actId("next"); return;
      case "l2": this.sfx.play("enter", 0.4); this._actId("frev"); return;
      case "r2": this.sfx.play("enter", 0.4); this._actId("ffwd"); return;
      case "start": this.sfx.play("enter", 0.4); this._actId("playpause"); return;
      case "back": this.sfx.play("back", 0.5); this.close(); return;
    }
    if (this.clusterOn) {
      if (a === "left" || a === "right" || a === "up" || a === "down") {
        // the console's D-pad paths (padnav.js)
        const to = (this.nav ||= new PadNav(ROWS, VIDEO_LINKS)).move(a, this.fr, this.fc, (r, c) => nodeX(this._nodes, r, c));
        if (to) { [this.fr, this.fc] = to; this.sfx.play(a === "left" || a === "up" ? "cursor_up" : "cursor_down", 0.4); this._syncSel(); }
      }
      else if (a === "enter") this._act();
      return;
    }
    // panel closed: the D-pad's left / right are Fast Reverse / Forward
    if (a === "left") { this.sfx.play("enter", 0.4); this._actId("frev"); }
    else if (a === "right") { this.sfx.play("enter", 0.4); this._actId("ffwd"); }
  }
  // moving between rows keeps the cursor over the nearest icon
  _nearest(r) {
    const cur = this._nodes.find((n) => +n.dataset.r === this.fr && +n.dataset.c === this.fc) ||
      this._nodes.find((n) => n.classList.contains("sel"));
    const x = cur ? cur.getBoundingClientRect().left + cur.offsetWidth / 2 : 0;
    let best = 0, bd = Infinity;
    this._nodes.filter((n) => +n.dataset.r === r).forEach((n) => {
      const d = Math.abs(n.getBoundingClientRect().left + n.offsetWidth / 2 - x); if (d < bd) { bd = d; best = +n.dataset.c; }
    });
    return best;
  }
}
