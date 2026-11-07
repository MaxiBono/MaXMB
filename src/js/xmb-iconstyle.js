// XMB: iconstyle (the Xmb class's methods, from xmb.js; put on its prototype there)
import { ICON_AUTO_DEFAULT, __set_ICON_AUTO_DEFAULT, ICON_AUTO_GAIN, __set_ICON_AUTO_GAIN, ICON_AUTO_RGB, __set_ICON_AUTO_RGB, ICON_STYLES, hexToRgb01, iconHTML } from "./xmb-shared.js";
import { activeThemes, sysBase } from "./themes.js";
import { cachedShade, colorKey, dropOtherStyles, edgeColor, exportShades, glassMap, glowMask, importShades, loadIconImage, loadedIcon, pruneShades, shadeIcon, shadeSrc, takeNewShadeCount } from "./iconshade.js";
import { call } from "./api.js";
import { glassLayer } from "./glasslayer.js";
import { setPlayerIconStyle } from "./playericons.js";

export const IconStyleMethods = {

  // PlayStation®Network icon + title: "original" (the sphere, two-line title)
  // or "modern" (tex_psn, "PlayStation™Network" on one line) — Theme Settings
  _psnLook() {
    return this.user?.theme?.psnStyle === "modern"
      ? { catLabel: "PlayStation\u2122Network", icon: "tex_psn.png" }
      : { catLabel: "PlayStation\u00ae\nNetwork", icon: "psn_sphere.png" };
  },
  _applyPsnStyle() {
    const col = this.columns && this.columns.find((c) => c.id === "psn");
    if (!col) return;
    Object.assign(col, this._psnLook());
    this._render(); this._onSelect();
  },
  // PlayStation®Home's icon, backdrop and description box: "original" (the
  // Home icon, the blue backdrop, the description on its white rectangle)
  // or "modern" (the newer icon, the lounge backdrop, no rectangle) — Theme
  // Settings > Icons > PlayStation®Home Icon
  _homeLook() {
    return this.user?.theme?.homeStyle === "modern"
      ? { icon: { art: "./assets/icons/system/pshome_modern.png", gameArt: true, plainLabel: true }, bg: "cinfo-bg-home-modern.jpg", panelPlain: true }
      : { icon: { sys: "pshome.png" }, bg: "cinfo-bg-home.jpg", panelPlain: false };
  },
  _applyHomeStyle() {
    for (const col of this.columns || []) for (const it of col.items || []) {
      if (!it.homeItem) continue;
      Object.assign(it, this._homeLook());
      if (it._el) { it._el.remove(); it._el = null; }       // (drawn again with its new icon)
    }
    this._render(); this._onSelect();
  },

  // XMBW icon style: replace each tintable icon's flat CSS fill with the
  // shaded glossy-glass image (iconshade.js), cached per icon + colour.
  // "Auto" icons are glossy white glass: the theme colour comes through their
  // translucency, like on the PS3. An icon is kept invisible until its glass
  // image is ready (no flash of the plain fill), and every icon is shaded
  // ahead of time in the background so new submenus appear finished.
  // Icons > Icon Color off: every icon in its own colours (the system's white),
  // Icon Color Pick not used
  _pickHex(t = this.user?.theme) { return t?.iconColorAll === false ? "#ffffff" : (t?.iconColor || "#ffffff"); },
  _iconRgb() {
    const hex = this._pickHex();
    // "Original" with Icon Style Default: paler and brighter on a bright
    // background (the brightness is a lift, not a multiply, so the shading stays)
    if (hex !== "auto") return hexToRgb01(hex);
    return this._iconStyle() === "glasslive" ? [...ICON_AUTO_DEFAULT, ICON_AUTO_GAIN] : ICON_AUTO_RGB.slice();
  },
  // saved icon shading from the last run (temp folder, or the system directory
  // with "Save Cache in System Directory"), loaded once at start; nothing is
  // shaded before it's in (_xsLoadDone: see _applyXmbwShading), or the log-in
  // screen's icons were made again at every start
  _xsLoadSaved() { return this._xsLoadP || (this._xsLoadP = this._xsLoadNow()); },
  async _xsLoadNow() {
    try { importShades(JSON.parse(await call("icon_shades_load") || "{}")); } catch (e) {}
    this._xsLoadDone = true;
    // any icon added to the menu later (submenus, refreshed lists) gets its
    // shading too, whichever code path drew it (only when an icon was added)
    if (this.root && !this._xsObs) {
      const hasIcon = (n) => n.nodeType === 1 && (n.classList.contains("sysicon") || !!n.querySelector?.(".sysicon"));
      this._xsObs = new MutationObserver((recs) => {
        if (this._xsRaf || document.body.classList.contains("in-game")) return;
        if (!recs.some((r) => [...r.addedNodes].some(hasIcon))) return;
        this._xsRaf = requestAnimationFrame(() => { this._xsRaf = 0; this._applyXmbwShading(); });
      });
      this._xsObs.observe(this.root, { childList: true, subtree: true });
    }
  },
  // save the shading a few seconds after new images were made (the colours in
  // use most recently are kept: up to 3)
  _xsScheduleSave(rk) {
    // (not before anyone has signed in: the log-in screen's own style and colour
    // are only for the moment, and the saved shading of the user's must stay)
    if (!this.user) return;
    const used = this._xsColors || (this._xsColors = []);
    const i = used.indexOf(rk);
    if (i >= 0) used.splice(i, 1);
    used.unshift(rk);
    used.length = Math.min(used.length, 3);
    clearTimeout(this._xsSaveT);
    this._xsSaveT = setTimeout(() => {
      // (memory keeps the same colours as the saved file: the 3 used last, the current one among them)
      pruneShades([...this._xsColors, colorKey(this._iconRgb()), colorKey([1, 1, 1])]);   // (a theme's own-coloured icons use white)
      if (this._keepStyles) dropOtherStyles(this._keepStyles);   // (only the style in use is kept)
      if (!takeNewShadeCount()) return;
      call("icon_shades_save", { data: JSON.stringify(exportShades(this._xsColors)) }).catch(() => {});
    }, 3000);
  },
  _applyXmbwShading() {
    const on = document.documentElement.getAttribute("data-icons") === "xmbw";
    if (!this.root) return;
    // (the saved shading still loading: shaded once it's in, from it)
    if (on && !this._xsLoadDone) {
      if (!this._xsLoadWait) { this._xsLoadWait = true; this._xsLoadSaved().then(() => { this._xsLoadWait = false; this._applyXmbwShading(); }); }
      return;
    }
    this._shadeCustomIcons(on);
    if (!on) {
      // Flat (pure CSS): icons shaded before get their own shape back
      for (const el of this.root.querySelectorAll(".sysicon[data-sys][data-xs]")) {
        const u = `url('${el.dataset.tsrc || sysBase(el.getAttribute("data-sys"))}')`;
        el.style.background = ""; el.style.webkitMaskImage = u; el.style.maskImage = u;
        if (el.__lg) glassLayer().detach(el);
        if (el.classList.contains("ig-glow")) { el.classList.remove("ig-glow"); el.style.removeProperty("--glow-mask"); el.style.removeProperty("--glow-c"); }
        delete el.dataset.xs; el.classList.remove("xs-ready", "xs-late");
      }
      return;
    }
    const st = this._shadeStyle();
    const rgbAll = this._iconRgb();
    const queue = this._xsQueue || (this._xsQueue = new Map());
    const previewing = this.overlay === this.colorPicker;
    this.root.querySelectorAll(".sysicon[data-sys]:not(.coloricon)").forEach((el) => {
      const job = this._xsJob(el, st, rgbAll); if (!job) return;
      const { own, src, name, rgb, ck } = job, rk = colorKey(rgb);
      if (el.dataset.xs === ck) return;
      const hit = cachedShade(name, rgb, st);
      if (hit) { this._xsSet(el, hit, ck); queue.delete(el); return; }
      // picture already loaded: shade it right now (~10 ms), so a new menu
      // appears finished; while a colour is being previewed, spread the work out
      const img = !previewing && loadedIcon(src);
      if (img) { this._xsSet(el, shadeIcon(img, rgb, name, st, own), ck); queue.delete(el); this._xsScheduleSave(rk); return; }
      queue.set(el, { name, src, own, rgb, ck, st });
      // still not shaded after a moment: show the plain icon meanwhile (never a blank space)
      setTimeout(() => { if (!el.classList.contains("xs-ready")) el.classList.add("xs-late"); }, 120);
    });
    this._xsPump();
    this._xsPrewarmSoon();
    // Glow styles: the full-colour pictures (Photo Gallery, PlayStation®Network,
    // PlayStation®Plus, PlayStation®Home, What's New...) glow too, in the
    // colour of their own border (styles.css: .coloricon under data-glow)
    if (this._shadeStyle() === "glass" && this._iconStyle() !== "glass") {
      this.root.querySelectorAll(".coloricon:not([data-gc])").forEach((el) => {
        const src = el.tagName === "IMG" ? el.getAttribute("src") : el.querySelector("img")?.getAttribute("src");
        if (!src) return;
        el.dataset.gc = "1";
        loadIconImage(src).then((im) => { const c = edgeColor(im, "c|" + src); if (c && el.isConnected) el.style.setProperty("--glow-c", c); this._syncGlowPulse(); }).catch(() => {});
      });
    }
  },
  // custom section pictures with their Icon Style effect: shaded exactly like
  // the system's icons (in the Icon Color, or in their own colours), kept in
  // their own shape; Flat style: the plain picture (or its shape in the Icon
  // Color, by the CSS)
  _shadeCustomIcons(on) {
    // (custom pictures are drawn as pictures, which can't bend what's behind
    // them: with the reactive Liquid Glass they get the filter version)
    // (a square-ish picture gets the reactive glass like the system's icons:
    // the glass layer draws a square picture fitted in the icon's box, so a
    // much wider or taller one keeps the filter version)
    const sh = this._shadeStyle(), rgbAll = this._iconRgb();
    const squarish = (im) => { const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height; return w && h && Math.max(w / h, h / w) <= 1.15; };
    for (const el of this.root.querySelectorAll(".custwrap[data-tsrc]")) {
      const img = el.querySelector(".cust-img"); if (!img) continue;
      const src = el.dataset.tsrc, own = !!el.dataset.own;
      if (!on) {
        if (img.getAttribute("src") !== src) img.src = src;
        el.classList.remove("cs-ready"); delete el.dataset.xs;
        if (el.__lg) glassLayer().detach(el);
        if (el.classList.contains("ig-glow")) { el.classList.remove("ig-glow"); el.style.removeProperty("--glow-mask"); el.style.removeProperty("--glow-c"); }
        continue;
      }
      const rgb = own ? [1, 1, 1] : rgbAll;
      const name = `c:${el.dataset.tkey || src}${own ? "|own" : ""}`;
      const shade = (im) => {
        const live = sh === "glasslive" && squarish(im), st = sh === "glasslive" && !live ? "glass" : sh;
        const ck = st + "|" + name + "|" + colorKey(rgb);
        if (el.dataset.xs === ck || !el.isConnected) return;
        const u = cachedShade(name, rgb, st) || (this._xsScheduleSave(colorKey(rgb)), shadeIcon(im, rgb, name, st, own, true));
        const bg = shadeSrc(u);
        img.src = bg; el.dataset.xs = ck; el.classList.add("cs-ready");
        this._iconExtras(el, src, name, ck, bg, live);
      };
      const ready = loadedIcon(src);
      if (ready) { shade(ready); continue; }
      loadIconImage(src).then(shade).catch(() => {});
    }
  },
  // what an icon element is shaded as: its picture, its cache name, its colour
  _xsJob(el, st, rgbAll) {
    const sys = el.getAttribute("data-sys"); if (!sys) return null;
    // a theme's picture: shaded from it (in its own colours with data-own)
    const own = !!el.dataset.own, src = el.dataset.tsrc || sysBase(sys);
    const name = el.dataset.tsrc ? `t:${el.dataset.tkey || src}${own ? "|own" : ""}` : sys;
    // (in its own colours, the Icon Color isn't used)
    const rgb = own ? [1, 1, 1] : rgbAll;
    return { own, src, name, rgb, st, ck: st + "|" + name + "|" + colorKey(rgb) };
  },
  // Every icon of every category shaded ahead of time, a little at a time
  // while nothing else is happening, so opening a category for the first
  // time (or after a colour / style / theme change) doesn't stall on it.
  // Runs a moment after the icons were last shaded on screen.
  _xsPrewarmSoon() {
    clearTimeout(this._xsPreT);
    this._xsPreT = setTimeout(() => this._xsPrewarm(), 1500);
  },
  async _xsPrewarm() {
    if (document.documentElement.getAttribute("data-icons") !== "xmbw" || !this.columns) return;
    const run = this._xsPreRun = (this._xsPreRun || 0) + 1;
    const names = new Set();
    const walk = (items, depth) => { for (const it of items || []) {
      if (it && it.icon && it.icon.sys) names.add(it.icon.sys);
      if (depth < 2 && Array.isArray(it.children)) walk(it.children, depth + 1);
    } };
    for (const c of this.columns) { if (c.icon) names.add(c.icon); walk(c.items, 0); }
    const st = this._shadeStyle(), rgbAll = this._iconRgb(), seen = new Set();
    // (nothing changed since the last full pass: nothing to do)
    const ist = this._iconStyle(), live = this._shadeStyle() === "glasslive", glow = ist === "glassglow" || ist === "glasspulse";
    const sig = `${ist}|${colorKey(rgbAll)}|${activeThemes().map((t) => t.key).join(",")}|${[...names].join(",")}`;
    // (the reactive glass's lens and the glow's shape, ready before they're shown, too)
    // (the icon's own name: a theme's icon names hold "|" themselves)
    const extraKey = (j) => j.name;
    const needs = (j) => !cachedShade(j.name, j.rgb, j.st) || (live && !glassMap(extraKey(j), null)) || (glow && !glowMask(extraKey(j), null));
    if (sig === this._xsPreDone) return;
    const box = document.createElement("div");
    box.innerHTML = [...names].map((n) => iconHTML(n)).join("");
    const jobs = [...box.querySelectorAll(".sysicon[data-sys]:not(.coloricon)")].map((el) => this._xsJob(el, st, rgbAll))
      .filter((j) => j && !seen.has(j.ck) && seen.add(j.ck) && needs(j));
    if (!jobs.length) { this._xsPreDone = sig; return; }
    // the pictures first (loading is off the main thread), then the shading, a
    // few at a time in the gaps between frames, never while buttons are being
    // pressed (one at a time when the system is too busy to have gaps)
    const imgs = await Promise.all(jobs.map((j) => loadIconImage(j.src).catch(() => null)));
    if (run !== this._xsPreRun) return;
    const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 300 }) : setTimeout(() => r(null), 50)));
    let done = 0, i = 0;
    const calm = () => performance.now() - (this._inputAt || 0) > 1500 && !this.overlay;
    while (i < jobs.length) {
      const dl = await idle();
      if (run !== this._xsPreRun) return;            // the colours changed meanwhile: a newer pass takes over
      if (!calm()) { await new Promise((r) => setTimeout(r, 500)); continue; }
      for (let n = 0; i < jobs.length; n++) {
        if (n >= 1 && (!dl || dl.didTimeout || dl.timeRemaining() < 6)) break;
        const j = jobs[i], img = imgs[i]; i++;
        if (img && !cachedShade(j.name, j.rgb, j.st)) { shadeIcon(img, j.rgb, j.name, j.st, j.own); done++; }
        if (img && live) glassMap(extraKey(j), img);
        if (img && glow) glowMask(extraKey(j), img);
      }
    }
    this._xsPreDone = sig;
    if (done) this._xsScheduleSave(colorKey(rgbAll));
  },
  _xsSet(el, url, ck) {
    const bg = shadeSrc(url);
    el.style.background = `url("${bg}") center/contain no-repeat`;
    el.dataset.xs = ck; el.classList.add("xs-ready"); el.classList.remove("xs-late");
    el.style.webkitMaskImage = "none"; el.style.maskImage = "none";
    const sys = el.getAttribute("data-sys");
    // (the icon's name inside "<style>|<name>|<colour>": a theme's icon names
    // hold "|" themselves, so only the first and last parts are taken off; taking
    // the second part gave every theme icon the first one's glass and glow shape)
    const src = sys ? (el.dataset.tsrc || sysBase(sys)) : null, name = ck.slice(ck.indexOf("|") + 1, ck.lastIndexOf("|"));
    this._iconExtras(el, src, name, ck, bg, this._shadeStyle() === "glasslive");
  },
  // The parts of an Icon Style drawn around / through a shaded icon: the
  // reactive glass (`live`: the background bent through it, by the glass
  // layer) and the Glow styles' glow. For the XMB's icons (_xsSet) and the
  // custom sections' pictures (_shadeCustomIcons). `src`: its picture; `name`:
  // its cache name; `bg`: the shaded picture shown.
  _iconExtras(el, src, name, ck, bg, live) {
    const st = this._iconStyle();
    // Default (reactive Liquid Glass): the background behind the icon bent
    // through it, drawn by the glass layer (glasslayer.js)
    const gl = live && src ? glassLayer() : null;
    if (gl && gl.ok) {
      const put = (im) => { if (el.isConnected && el.dataset.xs === ck) gl.attach(el, glassMap(name, im), bg); };
      const im = loadedIcon(src);
      if (im) put(im); else loadIconImage(src).then(put).catch(() => {});
    } else if (el.__lg) glassLayer().detach(el);
    // Glow / Glow (Pulsating): a glow around the icon's shape (outside it only)
    if ((st === "glassglow" || st === "glasspulse") && src) {
      const put = (im) => { const u = glowMask(name, im); if (u && el.isConnected && el.dataset.xs === ck) { el.style.setProperty("--glow-mask", `url("${u}")`); el.classList.add("ig-glow"); this._syncGlowPulse(); } };
      // (the glow takes the colour of the icon's own border, as drawn in this
      // style and colour; a theme's picture drawn in your Icon Color glows in
      // that colour, whatever colours the picture itself has inside)
      if (el.dataset.tsrc && !el.dataset.own) {
        const rgb = this._iconRgb(), k = rgb[3] || 1;
        el.style.setProperty("--glow-c", rgb.slice(0, 3).map((v) => Math.round(Math.min(1, v * k) * 255)).join(","));
      } else loadIconImage(bg).then((im) => { const c = edgeColor(im, bg); if (c && el.isConnected && el.dataset.xs === ck) el.style.setProperty("--glow-c", c); }).catch(() => {});
      const im = loadedIcon(src);
      if (im) put(im); else loadIconImage(src).then(put).catch(() => {});
    } else if (el.classList.contains("ig-glow")) { el.classList.remove("ig-glow"); el.style.removeProperty("--glow-mask"); el.style.removeProperty("--glow-c"); }
  },
  // shade the icons still waiting, a few per frame (keeps the UI smooth while a
  // colour is being previewed)
  _xsPump() {
    if (this._xsBusy || !this._xsQueue || !this._xsQueue.size) return;
    this._xsBusy = true;
    const step = async () => {
      const t0 = performance.now();
      // load the pictures still needed all at once, then shade
      const jobs = [...this._xsQueue].filter(([el]) => el.isConnected);
      await Promise.all(jobs.map(([, j]) => loadIconImage(j.src).catch(() => null)));
      for (const [el, job] of this._xsQueue) {
        this._xsQueue.delete(el);
        if (!el.isConnected) continue;
        const hit = cachedShade(job.name, job.rgb, job.st);
        const img = hit ? null : loadedIcon(job.src);
        if (hit || img) this._xsSet(el, hit || shadeIcon(img, job.rgb, job.name, job.st, job.own), job.ck);
        else el.classList.add("xs-ready");      // picture missing: show the plain icon
        if (performance.now() - t0 > 12) break;
      }
      if (this._xsQueue.size) requestAnimationFrame(step);
      else { this._xsBusy = false; this._xsScheduleSave(colorKey(this._iconRgb())); }
    };
    step();
  },
  // Icon Style (Theme Settings, ICON_STYLES): the user's own choice; before anyone signs in (or for a
  // user who never chose), the one in use in the last session on this
  // computer, so the system starts with it, as with the Wave Style
  _iconStyle() {
    const v = this.user?.theme?.iconStyle || this.settings?.graphics?.iconStyle;
    return ICON_STYLES.some(([k]) => k === v) ? v : "glasslive";
  },
  // (the Icon Style in use now is the one the system starts with next time)
  _rememberIconStyle() {
    if (!this.user || !this.settings) return;
    const g = (this.settings.graphics ||= {}), v = this._iconStyle();
    if (g.iconStyle !== v) { g.iconStyle = v; this._persistSettings(); }
  },
  // Glow (Pulsating): every icon's glow pulses in step with the selected
  // title's (the same 3.4 s glow, started together); checked after the frame
  // in which the selection (or the icons) changed
  _syncGlowPulse() {
    if (this._iconStyle() !== "glasspulse" || this._pulseRaf) return;
    this._pulseRaf = requestAnimationFrame(() => requestAnimationFrame(() => {
      this._pulseRaf = 0;
      try {
        const all = document.getAnimations();
        const ttl = all.find((a) => a.animationName === "xmbLabelGlow" && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest("#xmb .item.sel"));
        const icons = all.filter((a) => a.animationName === "iconGlowPulse" || a.animationName === "colorGlowPulse");
        const st = ttl && ttl.startTime != null ? ttl.startTime : icons.length && icons[0].startTime;
        if (st == null) return;
        for (const a of icons) if (a.startTime !== st) a.startTime = st;
      } catch (e) {}
    }));
  },
  // the icon images a style is drawn with (Reactive Glow: the reactive glass's own)
  _shadeStyle() { const s = this._iconStyle(); return s === "glassglow" || s === "glasspulse" ? "glass" : s === "glassclear" ? "glasslive" : s; },
  _iconStyleAttrs() {
    const st = this._iconStyle();
    document.documentElement.setAttribute("data-icons", st === "flat" ? "flat" : "xmbw");
    document.documentElement.setAttribute("data-istyle", st);
    document.documentElement.toggleAttribute("data-glow", st === "glassglow" || st === "glasspulse");
  },
  async _applyIconStyle() {
    const st = this._iconStyle(), sh = this._shadeStyle();
    this._iconStyleAttrs();
    // (the media players' icons too, see playericons.js)
    setPlayerIconStyle(st);
    // (Liquid Glass (Reactive): the icons bend the real background behind them)
    document.documentElement.removeAttribute("data-glass");   // (no longer needed: the glass layer draws inside each icon)
    // (the reactive glass: drawn by the glass layer while this style is in use)
    // (Glass: the same, clear; Default: filled in with the glass's own pale colour)
    if (sh === "glasslive") { glassLayer().setFilled(st !== "glassclear"); glassLayer().setBackdrop(!!this.user?.theme?.reactiveBackdrop); glassLayer().start(); } else if (this._glassOn) glassLayer().stop();
    this._glassOn = sh === "glasslive";
    // (Glow styles: each icon glows in its own border's colour; the background's
    // light only until that's known)
    clearInterval(this._glowT); this._glowT = 0;
    const glow = st === "glassglow" || st === "glasspulse";
    document.documentElement.toggleAttribute("data-glow", glow);
    if (glow && this.wave.updateGlow) this.wave.updateGlow();
    await this._xsLoadSaved();
    // another style chosen: the icon images (and the reactive glass's filters)
    // made for the previous one are deleted, from memory and from the saved cache
    // (not before anyone has signed in: the log-in screen's style is only for
    // the moment, and dropping the others threw away the saved shading of the
    // user who then signed in, every icon shaded again)
    if (this.user && this._lastShadeStyle !== sh) {
      const first = this._lastShadeStyle == null;
      this._lastShadeStyle = sh;
      // (work still queued or running for the previous style is stopped)
      this._xsPreRun = (this._xsPreRun || 0) + 1; clearTimeout(this._xsPreT);
      if (this._xsQueue) this._xsQueue.clear();
      const n = dropOtherStyles(this._keepStyles = sh === "glasslive" ? ["glasslive", "glass"] : st === "glassglow" || st === "glasspulse" ? ["glass", "glow"] : [sh]);
      if (!first || n) call("icon_shades_save", { data: JSON.stringify(exportShades(this._xsColors || [])) }).catch(() => {});
    }
    this._applyXmbwShading();
  },
  _cycleIconStyle(dir) {
    const order = ICON_STYLES.map(([k]) => k);
    const i = (order.indexOf(this._iconStyle()) + dir + order.length) % order.length;
    this.user.theme.iconStyle = order[i];
    this._persistUser(); this._rememberIconStyle(); this.audio.play("cursor_up", 0.4);
    this._applyIconStyle();
    this._render(); this._onSelect();    // redraw the icons in the new style
  },
};
