// XMB background. The ONLY wave style is "Real Style Waves": the WebGL2
// recreation of the PS3 XMB wave (linkev/PlayStation-3-XMB), rendered by
// RealWave in wavegl.js. This class is a thin theme-control shim: it converts
// the Theme Settings values (background colour, wave/dot colour + toggles,
// day/night mode, and the Wave and Sparkles Personalization spline/particle params) into
// calls on the RealWave renderer. The old procedural-canvas and classic-video
// styles have been removed.

import { RealWave } from "./wavegl.js";

export const MONTH_COLORS = {
  1: "#7a8391", 2: "#c76fa0", 3: "#5fa85a", 4: "#d98cc0",
  5: "#8ab84f", 6: "#3f8fd0", 7: "#8f7fd6", 8: "#2f9bd0",
  9: "#b5822e", 10: "#d5702a", 11: "#7a5230", 12: "#2f7d3f",
};
// "#rrggbb" or "#rrggbbaa": a custom colour's opacity fades it toward
// transparent (black behind the background, dimmer light for waves / dots).
const hexToRgb = (hex) => {
  const h = (hex || "#888").replace("#", "");
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: parseInt(h.slice(0, 2), 16) * a, g: parseInt(h.slice(2, 4), 16) * a, b: parseInt(h.slice(4, 6), 16) * a };
};

export class WaveBackground {
  constructor(canvas) {
    // `canvas` is the legacy 2D canvas (#wave); it stays fully transparent now
    // that Real Style Waves owns the whole background. Kept only so main.js can
    // pass it without changing its call site.
    this.canvas = canvas;
    if (this.canvas) { try { this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height); } catch (e) {} }
    this.hidden = false; this.wallpaper = false;
    this.wavesEnabled = true;
    this.dotsEnabled = true;
    this.waveColor = { r: 255, g: 255, b: 255 };
    this.dotColor = { r: 255, g: 255, b: 255 };
    this.setColor("auto");
    // "Real Style Waves": the WebGL2 recreation. This is the only style.
    const glc = document.getElementById("wavegl");
    this.real = glc ? new RealWave(glc) : null;
    this._syncReal();
    if (this.real) this.real.start();
    window.__menuTint = () => this.updateMenuTint();
    this.updateMenuTint();
  }

  setColor(color) {
    // (the Visualizer Wave background is drawn from its own gradient, as Original is)
    if (color === "visualizer") color = "auto";
    const isAuto = !color || color === "auto";
    const base = isAuto ? MONTH_COLORS[new Date().getMonth() + 1] : color;
    this.base = hexToRgb(base);
    // the "Black" Background Color is the system's own default background
    // (the same near-black gradient as Auto), not a black-tinted gradient
    this._autoColor = isAuto || String(color).toLowerCase() === "#1a1a1a";
    if (this.real) this.real.setBaseColor(this.base, this._autoColor);
    this.updateMenuTint();
  }
  // The option menus (△ menus, the game menu) are tinted with the background's
  // actual colour right now (month / time of day, the wave's own colours or the
  // Background Color), lighter. Refreshed whenever a menu opens.
  updateMenuTint() {
    let c = null;
    if (this.real && this.real.ok) { try { c = this.real.backgroundColor().map((v) => v * 255); } catch (e) { c = null; } }
    if (!c) { const b = this.base || { r: 58, g: 60, b: 68 }; c = [b.r, b.g, b.b]; }
    const lt = (v) => Math.round(Math.max(0, Math.min(255, v + (255 - v) * 0.35)));
    document.documentElement.style.setProperty("--menu-rgb", c.map(lt).join(","));
    this._updateIconAuto();
  }
  // Icon Color "Original" (as on the console): the icons take the background's
  // colour: its brighter end brought up to full brightness (same hue), then
  // mixed 55 % toward white, so the icons come out as pale
  // as in the captures (green → #6ba36b, blue → #7abed7, brown → khaki);
  // white over a background picture. Rounded so a slowly changing background
  // (Month and Time Colors) only re-shades the icons now and then.
  _updateIconAuto() {
    let hi = null;
    if (!this.wallpaper && this.real && this.real.ok) { try { hi = this.real.backgroundBright(); } catch (e) { hi = null; } }
    let rgb = [1, 1, 1], def = [1, 1, 1], gain = 1, bright = false;
    if (hi) {
      const k = Math.min(4, 0.92 / Math.max(1e-3, ...hi));
      rgb = hi.map((v) => { const b = Math.min(1, v * k); return Math.min(1, Math.round((b + (1 - b) * 0.55) * 32) / 32); });
      // Icon Style "Default" only: on a bright background (October's yellow,
      // February's gold, January's silver) the console's icons are a pale
      // cream, nearly white, and brighter, so they stand out from it
      const lum = 0.3 * hi[0] + 0.59 * hi[1] + 0.11 * hi[2];
      const t = Math.max(0, Math.min(1, (lum - 0.45) / 0.3)), e = t * t * (3 - 2 * t), white = 0.55 + 0.3 * e;
      def = hi.map((v) => { const b = Math.min(1, v * k); return Math.min(1, Math.round((b + (1 - b) * white) * 32) / 32); });
      gain = Math.round((1 + 0.7 * e) * 16) / 16;
      bright = t > 0.5;
    }
    document.documentElement.toggleAttribute("data-bright-bg", bright);
    const key = rgb.join(",") + "|" + def.join(",") + "|" + gain;
    if (key === this._iconAutoKey) return;
    this._iconAutoKey = key; this.iconAutoRgb = rgb; this.iconAutoDefault = def; this.iconAutoGain = gain;
    this.onIconAuto && this.onIconAuto(rgb, gain, def);
  }
  // The only style is "real"; kept as a no-op-ish entry point so callers that
  // still ask for a style don't break. Anything other than a stop request maps
  // to the running Real wave.
  setStyle(_style) {
    if (this.real) { this._syncReal(); this.real.start(); }
  }
  // Push the current theme colours/toggles into the Real-style renderer.
  _syncReal() {
    if (!this.real) return;
    this.real.setBaseColor(this.base, this._autoColor !== false);
    this.real.setWaveColor(this.waveColor);
    this.real.complexAuto = this.waveAuto !== false;
    this.real.setDotColor(this.dotColor);
    this.real.setWavesEnabled(this.wavesEnabled);
    this.real.setDotsEnabled(this.dotsEnabled);
    this.real.setWallpaper(this.wallpaper);
    if (this.real.setBgOff) this.real.setBgOff(!!this.bgOff);
    this.real.setHidden(this.hidden);
    this.real.setMonthMode(this.monthMode !== false);
  }
  // ---- Wave and Sparkles Personalization (spline + particle params) ----
  setWaveParam(group, key, val) { if (this.real) this.real.setParam(group, key, val); }
  getWaveParam(group, key) { return this.real ? this.real.getParam(group, key) : undefined; }
  applyWaveParams(map) { if (this.real) this.real.applyParams(map); this.updateMenuTint(); }
  resetWaveParams() { if (this.real) this.real.resetParams(); }

  setLowPower(level) { if (this.real) this.real.setLowPower(level); }
  setStill(on) { if (this.real) this.real.setStill(on); }
  setHidden(h) { this.hidden = h; if (this.real) this.real.setHidden(h); }
  setWallpaper(on) { this.wallpaper = !!on; if (this.real) this.real.setWallpaper(!!on); this._updateIconAuto(); }
  // (Overlay over the Background Color) the page draws the gradient instead
  setBgOff(on) { this.bgOff = !!on; if (this.real && this.real.setBgOff) this.real.setBgOff(!!on); }
  backgroundImage() { return this.real && this.real.ok && this.real.backgroundImage ? this.real.backgroundImage() : null; }
  setWavesEnabled(on) { this.wavesEnabled = on !== false; if (this.real) this.real.setWavesEnabled(on !== false); }
  setDotsEnabled(on) { this.dotsEnabled = on !== false; if (this.real) this.real.setDotsEnabled(on !== false); }
  setMotion(x, y) { if (this.real && this.real.setMotion) this.real.setMotion(x, y); }
  addMotionImpulse(dv) { if (this.real && this.real.addMotionImpulse) this.real.addMotionImpulse(dv); }
  // Month and Time Colors (the real XMB's month / time-of-day background)
  setMonthMode(on) { this.monthMode = on !== false; if (this.real) this.real.setMonthMode(this.monthMode); this.updateMenuTint(); }
  setDotColor(color) {
    this.dotColor = (!color || color === "auto") ? { r: 255, g: 255, b: 255 } : hexToRgb(color);
    if (this.real) this.real.setDotColor(this.dotColor);
  }
  setWaveColor(color) {
    this.waveAuto = !color || color === "auto";
    this.waveColor = this.waveAuto ? { r: 255, g: 255, b: 255 } : hexToRgb(color);
    if (this.real) { this.real.setWaveColor(this.waveColor); this.real.complexAuto = this.waveAuto; }
  }
}
