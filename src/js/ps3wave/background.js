// The console's own month and time-of-day background, on its own (no wave): what Month and
// Time Colors shows with linkev's wave. A small background-only renderer on its own canvas
// when the console's lines.qrc is there; without it, the same background from MaXMB's own
// measurements of it (monthbg.js). Asked again at most every 30 seconds.

import { loadFiles } from "./files.js";
import { Params } from "./params.js";
import { Renderer } from "./renderer.js";
import { monthBackground } from "./monthbg.js";

let _shared = null;
export function ps3Background() { return _shared || (_shared = new PS3Background()); }

class PS3Background {
  constructor() {
    this.ok = false;
    this.image = document.createElement("canvas"); this.image.width = 64; this.image.height = 36;
    this.version = 0;
    this.ready = loadFiles().then(async ({ archive, assets }) => {
      const c = document.createElement("canvas"); c.width = 64; c.height = 36;
      const gl = c.getContext("webgl2", { antialias: false });
      if (!gl) throw new Error("no WebGL2");
      this.p = new Params(); this.p.load(archive);
      this.r = new Renderer(gl); this.r.init(assets, true);
      await this.r.compiled(performance.now() + 15000);   // (prepared in the background)
      if (_shared !== this) return;
      this.ok = true;
      this.refresh(true);
    });
    // (no lines.qrc: the measured background instead)
    this.ready.catch(() => { if (_shared !== this) return; this.builtin = true; this.ok = true; this.refresh(true); });
  }
  // the measured background now (16 x 9, stretched smoothly to 64 x 36)
  _builtinPixels() {
    const now = new Date();
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const month = this.themeMonth != null ? this.themeMonth + 0.5 : now.getMonth() + (now.getDate() - 1) / dim;
    const dayFrac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
    const s = monthBackground(month, dayFrac), px = new Uint8Array(64 * 36 * 4);
    for (let y = 0; y < 36; y++) {
      const fy = Math.min(8, Math.max(0, (y + 0.5) / 4 - 0.5)), y0 = Math.min(7, Math.floor(fy)), ty = fy - y0;
      for (let x = 0; x < 64; x++) {
        const fx = Math.min(15, Math.max(0, (x + 0.5) / 4 - 0.5)), x0 = Math.min(14, Math.floor(fx)), tx = fx - x0;
        for (let k = 0; k < 3; k++) {
          const a = s[(y0 * 16 + x0) * 3 + k], b = s[(y0 * 16 + x0 + 1) * 3 + k], c = s[((y0 + 1) * 16 + x0) * 3 + k], d = s[((y0 + 1) * 16 + x0 + 1) * 3 + k];
          px[(y * 64 + x) * 4 + k] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
        }
        px[(y * 64 + x) * 4 + 3] = 255;
      }
    }
    return px;
  }
  // the background as it is now (64 x 36, top row first); true when it changed
  refresh(force = false) {
    if (!this.ok) return false;
    const now = Date.now();
    if (!force && now - (this._at || 0) < 30000) return false;
    this._at = now;
    try {
      let px;
      if (this.builtin) px = this._builtinPixels();
      else {
        const p = this.p, r = this.r, look = { gradient: null, bgLevel: 1 };
        p.S.monthOverride = this.themeMonth ?? null;
        p.forceTick(); p.advance(0); p.clk.paramT = p.clk.fadeDur;
        r.hdrBegin(p);
        px = r.backgroundPixels(p, look);
      }
      const ctx = this.image.getContext("2d"), img = ctx.createImageData(64, 36);
      img.data.set(px); for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      ctx.putImageData(img, 0, 0);
      this.pixels = px; this.version++;
      return true;
    } catch (e) { this.ok = false; return false; }
  }
  setThemeMonth(m) { if ((m ?? null) !== (this.themeMonth ?? null)) { this.themeMonth = m ?? null; this._at = 0; } }
  // the top and bottom rows' colours (0..1): the brighter is the background's light end
  ends() {
    const px = this.pixels; if (!px) return null;
    const row = (y) => { const c = [0, 0, 0]; for (let x = 0; x < 64; x++) for (let k = 0; k < 3; k++) c[k] += px[(y * 64 + x) * 4 + k] / 255 / 64; return c; };
    return [row(1), row(34)];
  }
}
