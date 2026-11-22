// Parameters (lines.qrc .mnu files), the time-of-day schedule and the VSH clock. A port of
// moyou's sim/params.cpp (github.com/sagemono/moyou, MIT License, (c) 2026 sagemono).
//
// Keys are "FILE.NAME" ("LINE1.LENGTH", "PARTICLES.emit vel min"). Presets come straight from
// the archive: base = LINE1/BACKGROUND/HDR/PARTICLES.mnu, and night/yoake/day/higure =
// override/<preset>/*.mnu. The schedule (custom_render_plugin 0x9c98c) blends presets by hour
// with a smoothstep; the VSH samples the clock once a second and pushes each new time with a
// 1 s fade (5 s for the first), and parameters glide over that fade.

import { parseMnu } from "./formats.js";

const FILES = ["LINE1", "BACKGROUND", "HDR", "PARTICLES", "LINE2"];
const optional = (f) => f === "PARTICLES" || f === "LINE2";
const HOURS = [0, 1, 5, 7, 11, 13, 17, 19, 23, 24];
const HOURS100 = [0, 4.8, 6, 7.2, 8.4, 16.8, 18, 19.2, 20.4, 24];
const SCHED = ["night", "night", "yoake", "yoake", "day", "day", "higure", "higure", "night", "night"];
export const PRESET_NAMES = ["night", "yoake", "day", "higure", "base"];
const f32 = Math.fround;

export class Params {
  constructor() {
    this.firmware = 493;
    // follow: the local clock; dayFrac / month otherwise (month = index + day fraction)
    this.S = { follow: true, dayFrac: 0.5, month: 9.5, lapse: 0, preset: "schedule", particlesOn: true, brightLevel: 0, runClock100: false };
    this.edits = new Map();
    this.presets = new Map();
    this.clk = { acc: 1e9, first: true, dayFrac: 0.5, month: 9.5, fadeT: 0, fadeDur: 5, paramT: 0, snap: true, force: false, bootFade: 5 };
    this.seg = { a: "day", b: "day", s: 0 }; this.segPrev = null; this.hasPrev = false;
  }
  load(archive) {
    this.presets.clear();
    this.firmware = archive.contains("lib/glutils/Gaussian.vpo") ? 493 : 100;
    this.clk.bootFade = this.firmware === 100 ? 1 : 5;
    // (MaXMB: every preset in the file, also the console's own for other
    // screens: music_1 is the Music Player's Visualizer, coldboot1/2 the boot, ...)
    const names = new Set(PRESET_NAMES);
    for (const id of archive.ids()) { const m = /^override\/([^/]+)\//.exec(id); if (m) names.add(m[1]); }
    for (const name of names) {
      const t = new Map();
      for (const f of FILES) {
        const id = name === "base" ? f + ".mnu" : "override/" + name + "/" + f + ".mnu";
        if (!archive.contains(id)) {
          if (name === "base" && !optional(f)) throw new Error("lines.qrc has no " + id);
          continue;
        }
        for (const e of parseMnu(archive.text(id))) t.set(f + "." + e.name, e.value);
      }
      if (name === "base" && this.firmware !== 100) {
        const def = { "BACKGROUND.NIGHT BLEND": 1, "BACKGROUND.NIGHT2DAY BEGIN": 4, "BACKGROUND.NIGHT2DAY END": 6,
          "BACKGROUND.DAY2NIGHT BEGIN": 18, "BACKGROUND.DAY2NIGHT END": 20, "BACKGROUND.DAYSPREAD": 0, "BACKGROUND.NIGHT WHIT BIAS": 0.5 };
        for (const [k, v] of Object.entries(def)) if (!t.has(k)) t.set(k, v);
      }
      this.presets.set(name, t);
    }
    const base = this.presets.get("base");
    for (const t of this.presets.values()) for (const [k, v] of base) if (!t.has(k)) t.set(k, v);
  }
  preset(name) { return this.presets.get(name) || this.presets.get("day") || new Map(); }
  has(key) { const b = this.presets.get("base"); return !!b && b.has(key); }
  schedule(dayFrac) {
    const h = dayFrac * 24, hours = this.firmware === 100 ? HOURS100 : HOURS;
    let k = 0;
    while (k < 8 && h >= hours[k + 1]) k++;
    const t = Math.min(1, Math.max(0, (h - hours[k]) / (hours[k + 1] - hours[k])));
    return { a: SCHED[k], b: SCHED[k + 1], s: t * t * (3 - 2 * t) };
  }
  segValue(s, key) {
    const A = this.preset(s.a), B = this.preset(s.b), a = A.get(key), b = B.get(key);
    if (a === undefined || b === undefined) return a !== undefined ? a : b !== undefined ? b : NaN;
    return a + (b - a) * s.s;
  }
  scheduled(key) {
    const v = this._scheduled(key);
    // (MaXMB: a screen's own preset over the time of day, faded in and out:
    // S.overlay { name, files: which .mnu files it takes over (null: all), k: 0..1 })
    const o = this.S.overlay;
    if (!o || !(o.k > 0) || (o.files && !o.files.includes(key.slice(0, key.indexOf("."))))) return v;
    const w = this.preset(o.name).get(key);
    if (w === undefined || Number.isNaN(v)) return v;
    const k = o.k * o.k * (3 - 2 * o.k);
    return v + (w - v) * k;
  }
  _scheduled(key) {
    if (this.S.preset !== "schedule") { const v = this.preset(this.S.preset).get(key); return v === undefined ? NaN : v; }
    const v = this.segValue(this.seg, key);
    if (!this.hasPrev || this.clk.paramT >= this.clk.fadeDur) return v;
    const v0 = this.segValue(this.segPrev, key);
    return v0 + (v - v0) * (this.clk.paramT / this.clk.fadeDur);
  }
  // a screen's preset in (name) or out (null), over `secs`
  // (timed by the clock, not by frames: it also fades with Still Waves)
  setOverlay(name, files = null, secs = 1) {
    const o = this.S.overlay, now = performance.now();
    if (name && this.presets.has(name)) {
      if (o && o.name === name && String(o.files) === String(files)) { if (o.to !== 1) Object.assign(o, { from: o.k, to: 1, t0: now, secs }); return; }
      this.S.overlay = { name, files, k: 0, from: 0, to: 1, t0: now, secs };
    } else if (o && o.to !== 0) Object.assign(o, { from: o.k, to: 0, t0: now, secs });
  }
  // (MaXMB: mod scales / shifts a value from the file, so Wave and Sparkles Personalization
  // works on top of the time of day instead of replacing it)
  P(key) {
    const v = this.edits.has(key) ? this.edits.get(key) : this.scheduled(key);
    const m = this.mod && this.mod.get(key);
    return m ? v * m[0] + m[1] : v;
  }
  clockHeld() { return this.firmware === 100 && !this.S.runClock100; }
  syncClockFromDate(now = new Date()) {
    this.S.dayFrac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000) / 86400;
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    this.S.month = now.getMonth() + (now.getDate() - 1) / dim;
    // (MaXMB: a PS3 theme's colour is a month: that month's background, all month long)
    if (this.S.monthOverride != null) this.S.month = this.S.monthOverride + 0.5;
  }
  forceTick() { this.clk.force = true; }
  clockTick() {
    const c = this.clk;
    const secs = this.clockHeld() ? 0 : (Math.floor(this.S.dayFrac * 86400 + 1e-6) % 86400);
    c.dayFrac = f32(secs / 86400);
    c.month = this.S.month;
    this.hasPrev = !c.first;
    if (this.hasPrev) this.segPrev = this.seg;
    this.seg = this.schedule(c.dayFrac);
    c.paramT = 0; c.fadeT = 0;
    c.fadeDur = c.first ? c.bootFade : 1;
    c.first = false; c.snap = true;
  }
  // the screen preset's fade, by the clock (also when the wave isn't drawing)
  advanceOverlay() {
    const o = this.S.overlay;
    if (o && o.k !== o.to) {
      const t = o.secs > 0 ? Math.min(1, (performance.now() - o.t0) / (o.secs * 1000)) : 1;
      o.k = o.from + (o.to - o.from) * t;
      if (t >= 1) { o.k = o.to; if (o.to === 0) this.S.overlay = null; }
    }
  }
  advance(dt) {
    this.advanceOverlay();
    if (this.S.follow) this.syncClockFromDate(this.S.now ? this.S.now() : new Date());
    else if (this.S.lapse > 0) {
      this.S.dayFrac += dt * this.S.lapse / 86400;
      if (this.S.dayFrac >= 1) { this.S.dayFrac -= 1; this.S.month = (this.S.month + 1 / 30) % 12; }
    }
    const c = this.clk;
    c.acc += dt;
    if (c.acc >= 1 || c.force) {
      c.acc = c.force ? 0 : c.acc % 1;
      c.force = false;
      this.clockTick();
    } else c.paramT = Math.min(c.fadeDur, c.paramT + dt);
  }
}
