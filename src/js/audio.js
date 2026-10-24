// Loads the bundled XMB sounds and plays them by role. Short nav ticks are
// pooled so rapid cursor movement doesn't cut itself off.
//
// Two independent music channels:
//   • bg     : the user's chosen background song; persists across navigation
//   • preview: a focused game's looping music; ducks the bg while it plays
// A master volume (0..1) scales everything.

export class AudioManager {
  constructor(manifest) {
    this.enabled = true;
    this.musicEnabled = true;
    this.playInBackground = true;   // keep audio playing when app loses focus
    this.master = 1;                // 0..1 app-wide "System Volume" (on top of the two below)
    this.bufVol = 0.15;             // 0..1 "Buffering Sound Volume" (Sound Settings; 15 % by default)
    this.musicVol = 1;              // 0..1 "Music Volume"
    this.sfxVol = 1;                // 0..1 "Sound Effects Volume"
    this.sounds = {};
    this.bg = null; this.bgUrl = null; this.bgVol = 0.4;
    this.preview = null;

    // Sound effects play through Web Audio: each file is fetched and decoded
    // once, then every play is an instant, nearly free buffer source (HTML
    // audio elements start late on slow machines, and a pool of them per
    // sound cost dozens of loads at start). The intro's sound is decoded
    // first; the rest follow one by one.
    this.files = manifest.sounds || {};
    this.buffers = {};
    this._loading = {};
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" }); } catch (e) { this.ctx = null; }
    this._keepAlive(true);
    // the startup sound first, then the cursor / enter / back sounds the
    // first menu needs at once, then the rest
    const first = (r) => (/boot/.test(r) ? 0 : /cursor|enter|back|ok/.test(r) ? 1 : 2);
    const order = Object.keys(this.files).sort((a, b) => first(a) - first(b));
    (async () => { for (const role of order) { try { await this.load(role); } catch (e) {} } })();
  }
  // Keeps the sound output open: Chromium switches a Web Audio output that
  // has only been silent for a few seconds to a "silent" sink, and switching
  // back when the next sound plays costs a moment (on slow computers a long
  // one), so sound effects came late every so often. An inaudible constant
  // (-120 dB) keeps the output open; stopped while a game runs.
  _keepAlive(on) {
    if (!this.ctx) return;
    if (on && !this._alive) {
      try {
        const src = this.ctx.createConstantSource ? this.ctx.createConstantSource() : null;
        if (!src) return;
        src.offset.value = 0.000001;
        src.connect(this.ctx.destination); src.start();
        this._alive = src;
      } catch (e) {}
    } else if (!on && this._alive) {
      try { this._alive.stop(); this._alive.disconnect(); } catch (e) {}
      this._alive = null;
    }
  }
  // decode one sound (once); resolves when it can be played
  load(role) {
    if (this.buffers[role]) return Promise.resolve(this.buffers[role]);
    if (this._loading[role]) return this._loading[role];
    const file = this.files[role];
    if (!file || !this.ctx) return Promise.resolve(null);
    // (roles sharing one file decode it once)
    const url = /^(\.\/|https?:|blob:|data:|asset:)/.test(file) ? file : `./assets/sounds/${file}`;
    const dec = (this._decoded ||= {});
    dec[url] ||= fetch(url).then((r) => r.arrayBuffer())
      .then((b) => this._decode(b));
    const mine = this._loading[role] = dec[url]
      .then((buf) => (this._loading[role] === mine ? (this.buffers[role] = buf) : this.load(role)))
      .catch(() => {
        // (a replacement that can't be read: the system's own sound instead)
        if (this._loading[role] !== mine) return this.load(role);
        if (this._orig && this._orig[role] && this.files[role] !== this._orig[role]) { this.setFile(role, null); return this.load(role); }
        return null;
      });
    return mine;
  }
  // Another file for one of the system's sounds (null: its own again). Used
  // for the startup sound of a Sound Effects pack / Custom Theme.
  setFile(role, url) {
    (this._orig ||= { ...this.files });
    const file = url || this._orig[role];
    if (!file || this.files[role] === file) return;
    this.files[role] = file;
    delete this.buffers[role]; delete this._loading[role];
  }
  // (decodeAudioData also returns a promise: a file that can't be decoded is caught here, not left unhandled)
  _decode(b) { return new Promise((res, rej) => { const q = this.ctx.decodeAudioData(b, res, rej); if (q && q.catch) q.catch(() => {}); }); }
  // the intro waits for its sound (up to `ms`), so picture and sound start together
  ready(role, ms = 2500) { return Promise.race([this.load(role), new Promise((r) => setTimeout(r, ms))]); }

  // The music channels are scaled by Music Volume x System Volume; sound effects
  // by Sound Effects Volume x System Volume. System Volume sits on top of both.
  _applyChannelVolumes() {
    if (this.bg) this.bg.volume = this.bgVol * this.musicVol * this.master;
    if (this.preview) this.preview.volume = this.previewVol * this.musicVol * this.master;
  }
  setMasterVolume(v) { this.master = Math.max(0, Math.min(1, v)); this._applyChannelVolumes(); this._bufLevel && this._bufLevel(0.1); }
  setMusicVolume(v) { this.musicVol = Math.max(0, Math.min(1, v)); this._applyChannelVolumes(); }
  // Sound effects get double headroom: the setting (0..1) maps to a 0..2 gain so
  // the default (100%) plays effects twice as loud as before. The per-sound
  // volume is still clamped to 1.0 at playback so nothing distorts.
  setSfxVolume(v) { this.sfxVol = Math.max(0, Math.min(2, v * 2)); }

  // A PS3 theme's sound effects (its Sounds option): role → file URL, or null
  // for the system's own. Roles a theme has no sound for keep the system's.
  setThemeSounds(map) {
    const key = JSON.stringify(map || null);
    if (key === this._themeKey) return;
    this._themeKey = key; this.themeBuffers = {};
    if (!map || !this.ctx) return;
    const want = this.themeBuffers;
    for (const [role, url] of Object.entries(map)) {
      fetch(url).then((r) => r.arrayBuffer()).then((b) => this._decode(b))
        .then((buf) => { if (this.themeBuffers === want) want[role] = buf; }).catch(() => {});
    }
  }

  play(role, volume = 0.6) {
    if (!this.enabled || this._inGame || this.hold) return;
    const vol = Math.max(0, Math.min(1, volume * this.sfxVol * this.master));
    // a theme's sound first; "ok" (a dialog accepted) is the Cross sound
    // without one, and "options" (an option menu opening) is silent
    const buf = (this.themeBuffers || {})[role] || this.buffers[role] || (role === "ok" ? this.buffers.enter : null);
    if (role === "options" && !buf) return;
    if (buf && this.ctx) {
      try {
        if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
        const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
        src.buffer = buf; g.gain.value = vol;
        src.connect(g).connect(this.ctx.destination);
        src.start();
        // (a handle: fadeOut(s) lowers it to nothing quickly, e.g. a skipped intro)
        const ctx = this.ctx;
        return { fadeOut: (sec = 0.6) => { try { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n);
          g.gain.linearRampToValueAtTime(0.0001, n + sec); src.stop(n + sec + 0.05); } catch (e) {} } };
      } catch (_) {}
      return;
    }
    // not decoded yet (only in the first moments): skip it rather than play late
    if (this.files[role]) this.load(role);
  }

  // ---- Console Startup Sound / Buffering Sound (System Settings) ----
  // the console startup sound, decoded once (both use it)
  _consoleBuf() {
    if (!this.ctx) return Promise.resolve(null);
    return (this._consoleP ||= fetch("./assets/sounds/console_startup.ogg").then((r) => r.arrayBuffer())
      .then((b) => this._decode(b)).catch(() => null));
  }
  // Console Startup Sound: plays from its start (and, should the black screen
  // last that long, on through the same 5 s - 20 s loop the Buffering Sound
  // uses); returns a handle to halve it (when the intro starts) and to end it.
  // With the Buffering Sound on it doesn't end: it settles at the Buffering
  // Sound's volume and simply carries on as that loop (one unbroken sound).
  async startupSound(volume = 0.85) {
    this._startupCancelled = false;
    const buf = await this._consoleBuf();
    // (given up on before it could start: a slow first load mustn't start it
    // late, where nothing would ever lower or end it)
    if (!buf || !this.ctx || this._startupCancelled) return null;
    try {
      if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      const base = Math.max(0, Math.min(1, volume * this.sfxVol * this.master));
      src.buffer = buf; g.gain.value = base;
      src.loop = true; src.loopStart = 5; src.loopEnd = Math.min(20, buf.duration);
      src.connect(g).connect(this.ctx.destination);
      const t0 = this.ctx.currentTime; src.start();
      const ctx = this.ctx, self = this;
      // the level it's heading for (and when it gets there): a later change starts
      // from there instead of cancelling a drop that's still under way
      let level = base, levelAt = 0;
      const h = {
        elapsed: () => ctx.currentTime - t0,
        // down to the Buffering Sound Volume (its slider, 15 % by default, whether
        // that sound is on or not), smoothly, as the intro starts
        half: () => {
          const n = ctx.currentTime; level = Math.max(0.0001, (self.bufVol ?? 0.15) * self.master); levelAt = n + 0.4;
          g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(level, levelAt);
        },
        // the end, `inSec` s from now (over the last `fade` s): silent, or with
        // the Buffering Sound on, down to its 15 % and on as its loop
        fadeOutIn: (inSec, fade = 3) => {
          if (self._startup !== h) return;
          self._startup = null;
          const n = ctx.currentTime, end = n + Math.max(0.05, inSec);
          const keep = self._bufOn && !self._bufSrc;
          const to = keep ? Math.max(0.0001, self.bufVol * self.master) : 0.0001;
          g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n);
          // (finish the drop to 15 % first, if it's still going on)
          const at = Math.min(Math.max(levelAt, n), end);
          if (at > n) g.gain.linearRampToValueAtTime(level, at);
          const from = Math.max(at, end - fade);
          g.gain.setValueAtTime(at > n ? level : g.gain.value, from); g.gain.linearRampToValueAtTime(to, end);
          if (keep) self._bufSrc = { src, g };
          else try { src.stop(end + 0.05); } catch (e) {}
        },
      };
      this._startup = h;
      if (this._startupCancelled) { h.fadeOutIn(0.3, 0.3); return null; }
      return h;
    } catch (e) { return null; }
  }
  // the startup sound isn't wanted any more (it took too long to load)
  cancelStartup() {
    this._startupCancelled = true;
    if (this._startup) this._startup.fadeOutIn(0.3, 0.3);
  }
  // Buffering Sound: 5 s - 20 s of the startup sound, looping for as long as
  // it's on, at 15 % of full volume (the System Volume scales it); silent
  // while a game runs (and in the background with Play Audio in Background off)
  async setBuffering(on) {
    this._bufOn = !!on;
    if (!on) {
      if (this._bufSrc) { const { src, g } = this._bufSrc; this._bufSrc = null; const n = this.ctx.currentTime;
        g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0.0001, n + 0.6);
        try { src.stop(n + 0.65); } catch (e) {} }
      return;
    }
    if (this._bufSrc || this._startup) return;   // (the startup sound becomes the loop)
    const buf = await this._consoleBuf();
    if (!buf || !this._bufOn || this._bufSrc || this._startup) return;
    try {
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = buf; src.loop = true; src.loopStart = 5; src.loopEnd = Math.min(20, buf.duration);
      g.gain.value = 0.0001; src.connect(g).connect(this.ctx.destination);
      src.start(0, 5);
      this._bufSrc = { src, g };
      this._bufLevel(1.5);
    } catch (e) {}
  }
  setBufferingVolume(v) { this.bufVol = Math.max(0, Math.min(1, v)); this._bufLevel(0.1); }
  // the loop's level now (15 % x System Volume; 0 in a game / the background)
  _bufLevel(ramp = 0.4) {
    if (!this._bufSrc || !this.ctx) return;
    const want = this._inGame || this._bufMuted ? 0.0001 : Math.max(0.0001, this.bufVol * this.master);
    const g = this._bufSrc.g.gain, n = this.ctx.currentTime;
    g.cancelScheduledValues(n); g.setValueAtTime(g.value, n); g.linearRampToValueAtTime(want, n + ramp);
  }

  // ---- background music (persistent) ----
  /** Start/replace the background song. No-op if that same song is already
   *  playing, so it survives cursor navigation without restarting. */
  // While the first menu is made behind the black startup screen, sounds and
  // music wait (hold); release() starts the music that was asked for meanwhile
  release() {
    this.hold = false;
    const f = this._pendingMusic; this._pendingMusic = null; if (f) f();
  }
  setMusic(url, volume = 0.4) {
    if (this.hold) { this._pendingMusic = () => this.setMusic(url, volume); return; }
    this.bgVol = volume;
    if (url && this.bgUrl === url && this.bg && !this.bg.paused) return;
    this.stopMusic();
    if (!url || !this.musicEnabled) return;
    this.bgUrl = url;
    const a = new Audio(url);
    a.loop = true; a.volume = volume * this.musicVol * this.master;
    // (a game's own music is playing: this waits until it stops, see stopPreview)
    if (!this.preview) a.play().catch(() => {});
    this.bg = a;
  }
  stopMusic() {
    if (this.hold) this._pendingMusic = null;
    if (this.bg) { this.bg.pause(); this.bg = null; }
    this.bgUrl = null; this._queue = null;
  }
  // Play a list of songs as the background music, advancing on end and looping.
  // With shuffle, the order is randomised and reshuffled each time through.
  setBgQueue(urls, { shuffle = false, volume = 0.4 } = {}) {
    if (this.hold) { this._pendingMusic = () => this.setBgQueue(urls, { shuffle, volume }); return; }
    this.bgVol = volume;
    this.stopMusic();
    if (!urls || !urls.length || !this.musicEnabled) return;
    this._shuffleQ = !!shuffle;
    this._queue = shuffle ? this._shuffled(urls) : urls.slice();
    this._qi = 0;
    this._playQueueTrack();
  }
  _shuffled(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // advance to the next queue track and loop back to the start at the end. `skips`
  // guards against a whole queue of unplayable files spinning forever.
  _advanceQueue(skips = 0) {
    if (!this._queue || !this._queue.length) return;
    this._qi++;
    if (this._qi >= this._queue.length) {
      this._qi = 0;
      if (this._shuffleQ) {
        // a fresh order, but never starting with the song that just played
        const last = this._queue[this._queue.length - 1];
        this._queue = this._shuffled(this._queue);
        if (this._queue.length > 1 && this._queue[0] === last) [this._queue[0], this._queue[1]] = [this._queue[1], this._queue[0]];
      }
    }
    this._playQueueTrack(skips);
  }
  _playQueueTrack(skips = 0) {
    if (!this._queue || !this._queue.length || !this.musicEnabled || this._inGame) return;
    if (skips > this._queue.length) return; // every track failed: give up quietly
    const url = this._queue[this._qi];
    const a = new Audio(url); a.volume = this.bgVol * this.musicVol * this.master; a.preload = "auto";
    let done = false;
    const next = (failed) => {
      if (done || this.bg !== a) return; done = true;
      this._advanceQueue(failed ? skips + 1 : 0);
    };
    // advance on normal end, and SKIP on any load/decode error or a stall so one
    // bad file can't freeze the whole queue (the T10 "stops after a few songs").
    a.addEventListener("ended", () => next(false));
    a.addEventListener("error", () => next(true));
    a.addEventListener("stalled", () => { if (!done && a.networkState === a.NETWORK_NO_SOURCE) next(true); });
    this.bg = a; this.bgUrl = "__queue__";
    // a game's own music is playing (the song before just ended as it
    // started): the next song waits until it stops, never on top of it
    if (this.preview) return;
    a.play().catch(() => next(true));
  }
  // "Play Audio in Background" = Off: pause the bg/preview channels when the app
  // loses focus, and resume them when it returns.
  suspendForBackground() {
    if (this.playInBackground) return;
    this._bufMuted = true; this._bufLevel();
    this._bgSuspend = [];
    for (const a of [this.bg, this.preview]) if (a && !a.paused) { a.pause(); this._bgSuspend.push(a); }
  }
  resumeFromBackground() {
    if (this._inGame) return;          // a game is running: silent until the user is back
    this._bufMuted = false; this._bufLevel();
    for (const a of this._bgSuspend || []) a.play().catch(() => {});
    this._bgSuspend = [];
  }
  // A game was started: every sound stops (whatever Play Audio in Background
  // says) until the user comes back to the app.
  enterGame() {
    this._inGame = true; this._bufLevel(); this._keepAlive(false);
    this._gameSuspend = [];
    for (const a of [this.bg, this.preview]) if (a && !a.paused) { a.pause(); this._gameSuspend.push(a); }
  }
  leaveGame() {
    this._inGame = false; this._bufLevel(); this._keepAlive(true);
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    for (const a of this._gameSuspend || []) a.play().catch(() => {});
    this._gameSuspend = [];
  }
  // Pause the background song but KEEP its position, so it resumes where it left
  // off (used while a video/music-player track plays). Resume restarts playback
  // from the same spot.
  pauseBg() {
    if (this.bg && !this.bg.paused) { this.bg.pause(); this._bgWasPlaying = true; }
  }
  resumeBg() {
    if (this._bgWasPlaying && this.bg && this.musicEnabled) this.bg.play().catch(() => {});
    this._bgWasPlaying = false;
  }

  // ---- game preview music (ducks the bg) ----
  playPreview(url, volume = 0.5) {
    if (this._inGame || this.hold) return;
    this.previewVol = volume;
    this.stopPreview(true);
    if (!url || !this.musicEnabled) return;
    if (this.bg) this.bg.pause();          // duck the background
    const a = new Audio(url);
    a.loop = true; a.volume = volume * this.musicVol * this.master;
    a.play().catch(() => {});
    this.preview = a;
  }
  stopPreview(keepBgPaused = false) {
    if (this.preview) { this.preview.pause(); this.preview = null; }
    if (!keepBgPaused && this.bg && this.musicEnabled) this.bg.play().catch(() => {});
  }

  /** Alias kept for callers that focus a game. */
  playMusic(url, volume = 0.5) { this.playPreview(url, volume); }
}
