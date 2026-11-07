// XMB: theme (the Xmb class's methods, from xmb.js; put on its prototype there)
import { MONTH_COLORS } from "./wave.js";
import { P3T_FOLDER_PICS, P3T_KEEP, THEME_OPTS, THEME_PARTS, activeThemes, setActiveThemes, setThemeFolders, sysUrl, themeIcon, themeOpt } from "./themes.js";
import { ICON_AUTO_RGB, PLAYER_OWN, __set_PLAYER_OWN, applyIconColorVar, forgetFolderFits } from "./xmb-shared.js";
import { ThemeBackground } from "./p3tbg.js";
import { assetUrl, call } from "./api.js";
import { cachedShade, colorKey, dropThemeShades, loadIconImage, loadedIcon, shadeIcon } from "./iconshade.js";
import { colorHex, holdAccel, parseColor } from "./ui.js";

export const ThemeMethods = {
  // ---- Full Theme Settings presets (every appearance selection) ----
  _themePresetItems() {
    const presets = (this.user?.theme?.themePresets) || [];
    if (!presets.length) return [{ kind: "empty", title: "No presets saved",
      sub: "Adjust Theme Settings, then choose “Save Theme Settings as a Preset…”.", icon: { sys: "icon_setting_item.png" } }];
    return presets.map((p, i) => ({ kind: "action", act: "theme_load", title: p.name,
      icon: { sys: "icon_setting_item.png" }, tpreset: p, opts: [{ act: `theme_delete::${i}`, label: "Delete Preset" }] }));
  },
  _saveThemePreset() {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Save Theme Preset", fields: [{ key: "name", label: "Preset Name", required: true }], submit: "Save" },
      (out) => { this.textForm.close(); this.overlay = null; this._commitThemePreset((out.name || "").trim()); },
      () => { this.textForm.close(); this.overlay = null; });
  },
  // all Theme Settings (not the themes in use), as a preset / Custom Theme keeps them
  _themeSnap() {
    const t = this.user.theme;
    return {
      // (the Icon Style and Wave Style in use, even for a user who never chose
      // one and so is shown this computer's last ones: a theme always carries them)
      backgroundColor: t.backgroundColor, iconColor: t.iconColor, iconColorAll: t.iconColorAll !== false, iconStyle: this._iconStyle(), waveEngine: this._waveEngine(),
      waveColor: t.waveColor, dotColor: t.dotColor, monthColors: t.monthColors ?? null,
      wavesEnabled: t.wavesEnabled, dotsEnabled: t.dotsEnabled, wallpaper: t.wallpaper || null, overlay: t.overlay || null,
      chromaKey: t.chromaKey || null, chromaStrength: t.chromaStrength ?? null, wallpaperFit: t.wallpaperFit || null,
      font: t.font || null, fontSize: t.fontSize ?? null, textColor: t.textColor || null, clockColor: t.clockColor || null, clockIconColor: t.clockIconColor || null,
      bgShuffle: t.bgShuffle || null, ovShuffle: t.ovShuffle || null, bgInterval: t.bgInterval || null, ovInterval: t.ovInterval || null,
      psnStyle: t.psnStyle || null, homeStyle: t.homeStyle || null, customColors: { ...(t.customColors || {}) },
      waveParams: { ...(t.waveParams || {}) }, bgPlaylists: JSON.parse(JSON.stringify(this._bgPlaylists())),
      reactiveBackdrop: !!t.reactiveBackdrop, folderColor: t.folderColor || null, folderColorAll: t.folderColorAll !== false, themeFolders: !!t.themeFolders,
      // (Icons > Intro Icon / Intro Title: kept with the system's settings, as the
      // intro plays before anyone signs in; a theme carries them too)
      introIcon: this.settings?.behavior?.introIcon || null, introTitle: this.settings?.behavior?.introTitle || null,
    };
  },
  _commitThemePreset(name) {
    if (!name) return;
    const t = this.user.theme, snap = this._themeSnap();
    delete snap.bgPlaylists; delete snap.ovPlaylists;
    if (!t.themePresets) t.themePresets = [];
    const existing = t.themePresets.findIndex((p) => p.name === name);
    const entry = { name, theme: snap };
    if (existing >= 0) t.themePresets[existing] = entry; else t.themePresets.push(entry);
    this.audio.play("enter", 0.5); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _loadThemePreset(preset) {
    if (!preset || !preset.theme) { this.audio.play("error", 0.4); return; }
    this._applyThemeSnap(preset.theme);
  },
  // put Theme Settings in place and show them (redraw: also the menus)
  _applyThemeSnap(s, redraw = true) {
    const t = this.user.theme;
    Object.assign(t, {
      backgroundColor: s.backgroundColor, iconColor: s.iconColor, iconStyle: s.iconStyle,
      waveColor: s.waveColor, dotColor: s.dotColor, monthColors: s.monthColors ?? undefined,
      wavesEnabled: s.wavesEnabled, dotsEnabled: s.dotsEnabled, wallpaper: s.wallpaper || undefined, overlay: s.overlay || undefined,
      chromaKey: s.chromaKey || undefined, chromaStrength: s.chromaStrength ?? undefined, wallpaperFit: s.wallpaperFit || undefined,
      font: s.font || undefined, fontSize: s.fontSize ?? undefined, textColor: s.textColor || undefined, clockColor: s.clockColor || undefined, clockIconColor: s.clockIconColor || undefined,
      bgShuffle: s.bgShuffle || undefined, ovShuffle: s.ovShuffle || undefined, bgInterval: s.bgInterval || undefined, ovInterval: s.ovInterval || undefined,
      waveParams: { ...(s.waveParams || {}) },
    });
    if ("waveEngine" in s) t.waveEngine = s.waveEngine || undefined;
    if ("iconColorAll" in s) t.iconColorAll = s.iconColorAll !== false;
    if ("psnStyle" in s) t.psnStyle = s.psnStyle || undefined;
    if ("homeStyle" in s) t.homeStyle = s.homeStyle || undefined;
    if (s.customColors) t.customColors = { ...s.customColors };
    if ("reactiveBackdrop" in s) t.reactiveBackdrop = !!s.reactiveBackdrop;
    if ("folderColor" in s) t.folderColor = s.folderColor || undefined;
    if ("themeFolders" in s) t.themeFolders = !!s.themeFolders;
    if ("folderColorAll" in s) t.folderColorAll = s.folderColorAll !== false;
    if (("introIcon" in s || "introTitle" in s) && this.settings) {
      const b = (this.settings.behavior ||= {});
      b.introIcon = s.introIcon || undefined; b.introTitle = s.introTitle || undefined;
      this._persistSettings();
    }
    if (Array.isArray(s.bgPlaylists)) t.bgPlaylists = JSON.parse(JSON.stringify(s.bgPlaylists));
    if (Array.isArray(s.ovPlaylists)) t.ovPlaylists = JSON.parse(JSON.stringify(s.ovPlaylists));
    else if (Array.isArray(s.bgPlaylists)) delete t.ovPlaylists;   // (made before Overlay Playlists: see _bgPlaylists)
    // apply everything (same order/API as sign-in)
    this.wave.setColor(t.backgroundColor || "auto");
    if (t.waveParams) this.wave.applyWaveParams(t.waveParams);
    this._applyWaveStyle();
    __set_PLAYER_OWN(t?.iconColorAll === false); applyIconColorVar(this._pickHex(t));
    this._applyFolderColor();
    this._applyIconStyle(); this._rememberIconStyle();
    this._applyTextLook();
    this._applyWallpaper();
    this._restartRotation();
    this._persistUser();
    if (!redraw) return;
    this.audio.play("enter", 0.6);
    this._render(); this._onSelect();
  },
  _deleteThemePreset(idx) {
    const list = this.user?.theme?.themePresets;
    if (!list || idx < 0 || idx >= list.length) return;
    list.splice(idx, 1); this.audio.play("back", 0.5); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  // Theme colour settings cycle through their named colours, "Auto" (where it
  // exists) and "Custom Color", which opens the colour wheel picker.
  _themeColorProp(ctl) { return { bgcolor: "backgroundColor", wavecolor: this._wk("waveColor"), dotcolor: this._wk("dotColor"), iconcolor: "iconColor", foldercolor: "folderColor", chromakey: "chromaKey", textcolor: "textColor", clockcolor: "clockColor", clockiconcolor: "clockIconColor" }[ctl]; },
  _ccKey(ctl) { return ctl; },
  _applyThemeColor(ctl, hex) {
    const u = this.user;
    u.theme[this._themeColorProp(ctl)] = hex;
    if (ctl === "bgcolor") {
      // (the background picture and overlay stay: they have their own None
      // option; a see-through colour (Opacity < 1) tints over the picture)
      this._applyWallpaper();
    } else if (ctl === "chromakey") this._applyWallpaper();
    else if (ctl === "textcolor" || ctl === "clockcolor" || ctl === "clockiconcolor") this._applyTextLook();
    else if (ctl === "wavecolor" || ctl === "dotcolor") { this._syncVisualizer(); this._applyWaveLook(); }
    else if (ctl === "foldercolor") this._applyFolderColor();
    else { __set_PLAYER_OWN(this.user?.theme?.iconColorAll === false); applyIconColorVar(this._pickHex()); this._applyXmbwShading(); }
  },
  // ---- PS3 Themes, Custom Themes and Icon Themes ----------------------------
  // The themes found (the Themes and Icon folders), read again each time
  // their menus open, so themes added while the system runs show up.
  async _loadThemes() {
    const [p3t, icon, custom, sound] = await Promise.all([call("themes_p3t").catch(() => []), call("themes_icon").catch(() => []),
      call("themes_custom").catch(() => []), call("themes_sound").catch(() => [])]);
    const arr = (v) => (Array.isArray(v) ? v : []);
    this._themeLists = { p3t: arr(p3t), icon: arr(icon), custom: arr(custom), sound: arr(sound) };
    return this._themeLists;
  },
  // Theme Settings > Reset Theme Settings: every Theme Setting back to its
  // default (after an "Are you sure" question). Themes in use stop (without
  // bringing back the settings from before a Custom Theme); saved theme / wave
  // presets, Background / Overlay Playlists and remembered custom colours stay.
  _resetThemeSettings() {
    this.overlay = this.confirm;
    this.confirm.open("Are you sure you want to reset every Theme Setting to its default?", [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }], async (ch) => {
      this.confirm.close(); this.overlay = null;
      if (!ch || ch.id !== "yes") return;
      const t = this.user.theme;
      for (const kind of ["p3t", "icon", "custom", "sound"]) t[this._themeProp(kind)] = null;
      delete t.customBackup; delete t.waveStyle;
      this.wave.resetWaveParams && this.wave.resetWaveParams();
      this._applyThemeSnap({
        backgroundColor: "auto", iconColor: "auto", iconStyle: "glasslive", waveColor: "auto", dotColor: "auto", monthColors: undefined,
        wavesEnabled: true, dotsEnabled: true, wallpaper: null, overlay: null, chromaKey: null, chromaStrength: null, wallpaperFit: null,
        font: null, fontSize: null, textColor: null, clockColor: null, clockIconColor: null, bgShuffle: null, ovShuffle: null, bgInterval: null, ovInterval: null,
        waveParams: {}, psnStyle: null, homeStyle: null, waveEngine: null, iconColorAll: true, folderColor: null, folderColorAll: true, themeFolders: false,
      }, false);
      this._persistUser();
      await this._runLocked("theme", "Please wait...", () => this._applyThemes(true).catch((e) => console.warn("theme", e)));
      this._applyPsnStyle(); this._applyHomeStyle();
      this.audio.play("enter", 0.6);
      this._render(); this._onSelect();
    }, () => { this.confirm.close(); this.overlay = null; });
  },
  _themeProp(kind) { return { p3t: "p3tTheme", icon: "iconTheme", custom: "customTheme", sound: "soundTheme" }[kind]; },
  _themeFind(kind, key) { return (this._themeLists?.[kind] || []).find((t) => t.key === key) || null; },
  // a theme's options, each as set in its menu or at its starting value
  _themeOpts(key) {
    const stored = ((this.user?.theme?.themeOpts) || {})[key] || {};
    return Object.fromEntries([...THEME_PARTS, ...THEME_OPTS].map(([k]) => [k, themeOpt(stored, k)]));
  },
  // A theme's icons loaded up front (as blob: copies, so they're drawn and
  // shaded like the system's own) and their shading made for the current Icon
  // Style and Color, so every menu shows them at once.
  async _themeIconUrls(th, skip = null) {
    const cache = this._themeBlobs || (this._themeBlobs = new Map());
    const out = {};
    await Promise.all(Object.entries(th.icons || {}).filter(([name]) => !skip || !skip.has(name)).map(async ([name, path]) => {
      let u = cache.get(path);
      if (!u) {
        try { u = URL.createObjectURL(await (await fetch(assetUrl(path))).blob()); cache.set(path, u); } catch (e) { return; }
      }
      try { await loadIconImage(u); out[name] = u; } catch (e) {}
    }));
    return out;
  },
  // Icon Set Transparency off: each picture with every see-through part made
  // solid (the edges stay smooth), kept for the next time
  async _solidIconUrls(icons) {
    const cache = this._solidBlobs || (this._solidBlobs = new Map());
    const out = {};
    await Promise.all(Object.entries(icons).map(async ([name, u]) => {
      let s = cache.get(u);
      if (!s) {
        try {
          const img = await loadIconImage(u);
          const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          const cx = cv.getContext("2d", { willReadFrequently: true });
          cx.drawImage(img, 0, 0);
          const id = cx.getImageData(0, 0, w, h), d = id.data;
          // the picture's body made fully solid, its edges as soft as they were:
          // every alpha raised by the same amount, so the body's usual alpha
          // (most of its solid-looking pixels) becomes 1 (raising them six times
          // over, as before, made the soft edge pixels hard: jagged icons)
          const body = [];
          for (let i = 3; i < d.length; i += 4) if (d[i] >= 96) body.push(d[i]);
          body.sort((a, b) => a - b);
          const typical = body.length ? body[Math.floor(body.length * 0.5)] : 255;
          const k = Math.min(6, 255 / Math.max(1, typical));
          for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, Math.round(d[i] * k));
          cx.putImageData(id, 0, 0);
          const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
          s = URL.createObjectURL(blob); cache.set(u, s);
          await loadIconImage(s);
        } catch (e) { s = u; }
      }
      out[name] = s;
    }));
    return out;
  },
  _preshadeTheme(layer) {
    // (not before the saved shading is in: the menus shade them from it then)
    if (!layer || !this._xsLoadDone || document.documentElement.getAttribute("data-icons") !== "xmbw") return;
    const c = layer.opts.iconColor, s = layer.opts.iconStyle;
    if (!s) return;
    const st = this._shadeStyle(), own = !c, rgb = own ? [1, 1, 1] : this._iconRgb();
    for (const [name, u] of Object.entries(layer.icons)) {
      const key = `t:${layer.key}|${name}${layer.opts.iconAlpha === false ? "|solid" : ""}${own ? "|own" : ""}`;
      const img = loadedIcon(u);
      if (img && !cachedShade(key, rgb, st)) { try { shadeIcon(img, rgb, key, st, own); } catch (e) {} }
    }
    this._xsScheduleSave(colorKey(rgb));
  },
  // Put the chosen themes in use: their icons, the PS3 theme's parts, the
  // Custom Theme's settings, and what their options turn off. rebuild: draw
  // the menus again (not at sign-in: they're built afterwards anyway); load:
  // read the folders first.
  async _applyThemes(rebuild = true, load = false) {
    const t = this.user?.theme || {};
    if (load || !this._themeLists) {
      // (unpacking a new theme takes a moment the first time)
      try { await this._loadThemes(); } catch (e) { this._themeLists = { p3t: [], icon: [], custom: [], sound: [] }; }
    }
    // (Icon Color is On unless turned off; the earlier key, Off to begin with, isn't used)
    if (this.user && "iconColorOn" in t) delete t.iconColorOn;
    // (only the pictures that will show are loaded: a lower layer's icon that
    // a higher one has too (Icon Set > Custom Theme > PS3 theme) is left out)
    const pick = async (kind, above = []) => {
      const key = t[this._themeProp(kind)], th = key ? this._themeFind(kind, key) : null;
      if (!th) return null;
      // (a Custom Theme's icons are part of it: always shown as it was made)
      const opts = kind === "custom" ? { iconStyle: true, waves: true, sparkles: true, background: true, overlay: true } : this._themeOpts(th.key);
      // (Icons > Icon Color: every theme's icons in your Icon Color Pick, or in their own colours)
      opts.iconColor = t.iconColorAll !== false;
      // (Transparency is an Icon Set's own option, Off to begin with; a PS3
      // theme's and a Custom Theme's icons stay see-through like the system's)
      if (kind !== "icon") opts.iconAlpha = true;
      // (an Icon Theme leaves the waves, sparkles, background and overlay alone)
      if (kind === "icon") Object.assign(opts, { waves: true, sparkles: true, background: true, overlay: true });
      // (a PS3 theme's background turned off: your own background and overlay take its place)
      if (kind === "p3t" && !opts.tBackground) Object.assign(opts, { background: true, overlay: true });
      const useIcons = kind !== "p3t" || opts.tIcons;
      const hidden = new Set(above.flatMap((l) => (l ? Object.keys(l.icons) : [])));
      // (a PS3 theme's folder pictures are loaded too: Theme Folders can show them)
      let icons = useIcons ? await this._themeIconUrls(th, hidden) : {};
      // (an Icon Set with Transparency off: its pictures made fully solid first)
      if (opts.iconAlpha === false) icons = await this._solidIconUrls(icons);
      // (a Custom Theme's pictures that came from a PS3 theme: they're the PS3
      // theme's, which never replace the folders' pictures; see themes.js themeIcon)
      return { key: th.key, icons, opts, theme: th, ...(kind === "custom" ? { fromP3t: this._customP3tIcons(th) } : {}) };
    };
    const ic = await pick("icon"), cu = await pick("custom", [ic]), p = await pick("p3t", [ic, cu]);
    // a Custom Theme made over a PS3 theme's background and / or overlay: its own
    // copy of them, each part as it was saved (and on unless turned off in the
    // Custom Theme's Theme Settings), shown in place of a PS3 theme's in use;
    // with them your own settings stay as they were with that PS3 theme (its
    // Custom Settings then: waves, sparkles, your background and overlay)
    const cps = this._customP3t(cu?.theme);
    if (cps) Object.assign(cu.opts, cps.opts);
    setThemeFolders(!!t.themeFolders);
    setActiveThemes(p, ic, cu);
    // (the pictures of layers no longer in use let go of, once the menus drawn with them are gone)
    // (an Icon Set with Transparency off shows solid copies: the pictures they
    // were made from are kept with them, to make them again without loading)
    if (this._themeBlobs) {
      const used = new Set([p, ic, cu].flatMap((l) => (l ? Object.values(l.icons) : [])));
      const solid = this._solidBlobs || new Map();
      const dropSolid = [...solid].filter(([, s]) => !used.has(s));
      for (const [k] of dropSolid) solid.delete(k);
      for (const k of solid.keys()) used.add(k);
      const drop = [...this._themeBlobs].filter(([, u]) => !used.has(u));
      for (const [k] of drop) this._themeBlobs.delete(k);
      const gone = [...drop.map(([, u]) => u), ...dropSolid.map(([, s]) => s)];
      if (gone.length) setTimeout(() => {
        for (const u of gone) URL.revokeObjectURL(u);
        // (and what was made from them: their shading, their decoded pictures)
        const live = new Set(activeThemes().map((l) => l.key));
        dropThemeShades(live, gone);
        // (and the folder pictures' measurements, see xmb-shared.js folderFit)
        forgetFolderFits(gone, live);
      }, 10000);
    }
    for (const l of [p, ic, cu]) this._preshadeTheme(l);
    // the PS3 theme's own parts that are on
    const on = (part) => (p && p.opts[part] ? p.theme : null);
    if (!this.themeBg) this.themeBg = new ThemeBackground(document.getElementById("p3tbg"));
    // its background and its overlay (an animated theme's moving effects), each on or off
    // (or a Custom Theme's own copy of a PS3 theme's: see above)
    const src = cps ? cps.theme : p?.theme;
    const bgOn = cps ? cps.bg : !!on("tBackground"), ovOn = cps ? cps.ov : !!(on("tOverlay") && p.theme.scene);
    const layers = bgOn && ovOn ? "all" : bgOn ? (src.scene ? "bg" : "all") : ovOn ? "ov" : null;
    this.themeBg.show(layers ? { ...src, key: `${src.key}|${layers}`, layers } : null);
    this._applyThemeSounds(on("tSounds"), cu?.theme, t.soundTheme ? this._themeFind("sound", t.soundTheme) : null);
    const col = on("tColor")?.color;
    this._themeColor = col == null ? null : (col >= 1 && col <= 12 ? MONTH_COLORS[col] : "auto");
    this.wave.setThemeMonth && this.wave.setThemeMonth(col >= 1 && col <= 12 ? col - 1 : null);
    // the folders' colour (Folder Color Pick; a PS3 theme's Theme Color while it's in use)
    const root = document.documentElement;
    this._applyFolderColor();
    // the info box's friends and message icons (an icon set can have them)
    const ibf = themeIcon("ib_friends.png");
    if (ibf) root.style.setProperty("--ib-friends-img", `url("${ibf.url}")`); else root.style.removeProperty("--ib-friends-img");
    const mail = document.querySelector(".ib-mail");
    if (mail) mail.src = sysUrl("icon_mbox.png");
    // the info box and the notification box: the theme's box and its colour
    const nt = on("tInfoBox")?.notification, nc = on("tClock")?.notification;
    this._themeInfoColor = nt ? await this._pictureColor(assetUrl(nt)) : null;
    // (the clock: the same colour, its own option)
    this._themeClockColor = nc ? (nc === nt ? this._themeInfoColor : await this._pictureColor(assetUrl(nc))) : null;
    if (nt) { root.style.setProperty("--tnotify", `url("${assetUrl(nt)}")`); root.classList.add("tnotify"); }
    else { root.style.removeProperty("--tnotify"); root.classList.remove("tnotify"); }
    this._applyTextLook();
    this._applyWaveLook();
    this._applyWallpaper();
    if (!rebuild) return;
    // the menus again, with the icons as they are now (the open submenus stay)
    if (this.columns && !this.locked) {
      const cat = this.columns[this.selCat]?.id;
      await this._buildColumns({ reuseGames: true });
      const ci = this.columns.findIndex((c) => c.id === cat);
      if (ci >= 0) { this.selCat = ci; if (this.levels[0]) this.levels[0].items = this.columns[ci].items; }
    }
    for (const l of this.levels.slice(1)) if (l.rebuild) { l.items = l.rebuild(); l.sel = Math.max(0, Math.min(l.sel, l.items.length - 1)); }
    this._render(); this._onSelect();
  },
  // a picture's main colour (its visible pixels, averaged and brightened a little)
  async _pictureColor(url) {
    try {
      const blob = await (await fetch(url)).blob(), img = await createImageBitmap(blob);
      const cv = document.createElement("canvas"); cv.width = 32; cv.height = 32;
      const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a; }
      if (n < 1) return null;
      const m = Math.max(r, g, b) / n, k = m > 0 ? Math.min(2.2, 220 / m) : 1;
      const h = (v) => Math.round(Math.min(255, v / n * k)).toString(16).padStart(2, "0");
      return `#${h(r)}${h(g)}${h(b)}`;
    } catch (e) { return null; }
  },
  // The sounds in use, by name (cursor, enter, back, coldboot, error, ok,
  // options) → file: a PS3 theme's (its Sounds part), then a Custom Theme's,
  // then a Sound Effects pack's, each over the one before.
  _soundFiles(p3t, custom, pack) {
    const PS3 = { se_cursor: "cursor", se_decide: "enter", se_cancel: "back", se_optionmenu: "options", se_system_ok: "ok" };
    const out = {};
    for (const [id, path] of Object.entries(p3t?.sounds || {})) if (PS3[id]) out[PS3[id]] = path;
    for (const l of [custom, pack]) for (const [n, path] of Object.entries(l?.sounds || {})) out[n] = path;
    return out;
  },
  _applyThemeSounds(p3t, custom, pack) {
    const ROLES = { cursor: ["cursor_up", "cursor_down"], enter: ["enter"], back: ["back"], options: ["options"], ok: ["ok"], error: ["error"] };
    const files = this._soundFiles(p3t, custom, pack), map = {};
    for (const [n, path] of Object.entries(files)) for (const r of ROLES[n] || []) map[r] = assetUrl(path);
    // (error is the enter sound: a Sound Set's / Custom Theme's enter sound is its
    // error sound too, unless it has one; a Sound Set's comes first, as all its sounds)
    for (const l of [pack, custom]) {
      const s = l?.sounds || {};
      if (s.error) break;
      if (s.enter) { map.error = assetUrl(s.enter); break; }
    }
    this.audio.setThemeSounds(Object.keys(map).length ? map : null);
    // the startup sound plays before anyone signs in: the last user's is kept for the next start
    if (this.user && this.settings) {
      const b = (this.settings.behavior ||= {}), boot = files.coldboot || null;
      if ((b.bootSoundFile || null) !== boot) { if (boot) b.bootSoundFile = boot; else delete b.bootSoundFile; this._persistSettings(); }
    }
  },
  // Text and Color > Folder Color Pick: every folder in this colour (--folder-color,
  // styles.css .ff-tint); Original: the background's colour, as Icon Color Pick's
  // Original (kept up to date with it: xmb.js onIconAuto)
  _applyFolderColor() {
    // (Folder Color Off: no tint, every folder in its own colours; white multiplies to nothing)
    if (this.user?.theme?.folderColorAll === false) { document.documentElement.style.setProperty("--folder-color", "#ffffff"); return; }
    const c = this._tcol("folderColor");
    let hex = c && c !== "auto" ? c : "#" + ICON_AUTO_RGB.map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, "0")).join("");
    const pc = parseColor(hex);
    if (pc) hex = colorHex({ ...pc, a: 1 });
    document.documentElement.style.setProperty("--folder-color", hex);
  },
  // a colour setting as it is now: the theme's colour (its Theme Color option) or yours
  _tcol(prop) { return this._themeColor != null ? this._themeColor : this.user?.theme?.[prop]; },
  _themeListItems(kind) {
    const SI = { sys: "icon_setting_item.png" };
    const lists = this._themeLists || { p3t: [], icon: [], custom: [], sound: [] };
    // read again in the background: a theme added meanwhile appears
    if (!this._themesLoading) {
      this._themesLoading = this._loadThemes().then((l) => {
        this._themesLoading = null;
        const lvl = this._level();
        const keys = (a) => (a || []).map((x) => x.key + "|" + x.name).join("/");
        if (lvl && lvl.items && lvl.items.kindList === kind && keys(lists[kind]) !== keys(l[kind])) this._rebuildLevel(() => this._themeListItems(kind));
      }).catch(() => { this._themesLoading = null; });
    }
    const list = lists[kind] || [], cur = this.user?.theme?.[this._themeProp(kind)] || null;
    const out = list.map((t) => ({
      kind: "drill", title: t.name, icon: t.thumb ? { art: assetUrl(t.thumb) } : SI,
      sub: [cur === t.key ? "In use." : "", kind === "p3t" ? [t.author, t.comment].filter(Boolean).join("\n")
        : kind === "custom" ? (t.author || "") : kind === "sound" ? `${Object.keys(t.sounds || {}).length} sounds`
        : `${Object.keys(t.icons || {}).length} icons`].filter(Boolean).join("\n"),
      childrenFn: () => this._themeMenu(kind, t.key),
    }));
    if (kind === "custom") out.unshift({ kind: "action", act: "theme_custom_create", title: "Create Custom Theme", icon: SI,
      sub: "Save your current Theme settings as a full custom theme." });
    if (!list.length) out.push({ kind: "ph", title: { p3t: "No PS3 Themes", icon: "No Icon Sets", custom: "No Custom Themes", sound: "No Sound Effect Sets" }[kind], icon: SI,
      sub: { p3t: "Put PS3 theme files (.p3t) in the content\\Themes folder.",
        icon: "Put a folder of icons in the Icon folder, named like the system's icons (icon_game.png...), with a .json file giving the theme's name.",
        custom: "Put custom themes (.zip) in the content\\Themes folder.",
        sound: "Put a folder of sounds in the Sound Effects folder, named like the system's sounds (cursor, enter, back, coldboot...), with a .json file giving the pack's name." }[kind] });
    out.kindList = kind;
    return out;
  },
  _p3tThemeItems() { return this._themeListItems("p3t"); },
  _iconThemeItems() { return this._themeListItems("icon"); },
  _customThemeItems() { return this._themeListItems("custom"); },
  _soundThemeItems() { return this._themeListItems("sound"); },
  // a theme's own menu: use it (or stop), then (PS3 / Icon Themes) its own
  // parts (Theme Settings) and which of your settings stay on (Custom Settings)
  _themeMenu(kind, key) {
    const SI = { sys: "icon_setting_item.png" };
    const t = this._themeFind(kind, key);
    if (!t) return [{ kind: "ph", title: "This theme isn't in its folder any more.", icon: SI }];
    const on = this.user?.theme?.[this._themeProp(kind)] === key;
    const snd = kind === "sound";
    const what = { p3t: "Theme", custom: "Theme", icon: "Icon Set", sound: "Sound Effect Set" }[kind];
    const use = { kind: "action", act: `theme_use::${kind}::${key}`, title: on ? `Stop Using This ${what}` : `Use This ${what}`, icon: SI };
    const setting = ([k, title, desc]) => ({ kind: "setting", ctl: `tho:${key}:${k}`, title, sub: desc, icon: SI });
    // a Custom Theme made over a PS3 theme's background / overlay: each can be
    // turned off (the parts it was saved with)
    if (kind === "custom") {
      const sv = t.settings?.p3t;
      const parts = sv && t.p3t ? [
        sv.background && ["tBackground", "PS3 Theme Background", "The background of the PS3 theme this theme was made with (its picture, or the pictures its animated scene is made of). Off: the theme's own background (picture, video or colour) is shown in its place."],
        sv.overlay && t.p3t.scene && ["tOverlay", "PS3 Theme Overlay", "The moving effects of the PS3 theme this theme was made with, drawn over its background (smoke, snow, lights, glows, logos...). With PS3 Theme Background off, they're drawn over the theme's own background and waves."],
      ].filter(Boolean) : [];
      return parts.length ? [use, { kind: "drill", title: "Theme Settings", icon: SI, sub: "The parts of this theme to use, each On or Off.", childrenFn: () => parts.map(setting) }] : [use];
    }
    if (snd) return [use];
    // an Icon Set: Icon Effects (its icons with your Icon Style, and see-through
    // like the others; their colour: Theme Settings > Icons > Icon Color)
    if (kind === "icon") return [use, { kind: "drill", title: "Icon Effects", icon: SI, childrenFn: () => [
      { kind: "setting", ctl: `tho:${key}:iconStyle`, title: "Icon Style", icon: SI,
        sub: "On: All icons in the set have the style selected on Theme Settings > Icon Style applied." },
      { kind: "setting", ctl: `tho:${key}:iconAlpha`, title: "Transparency", icon: SI },
    ] }];
    const items = [use];
    if (kind === "p3t") items.push({ kind: "drill", title: "Theme Settings", icon: SI, sub: "The parts of this theme to use, each On or Off.",
      childrenFn: () => THEME_PARTS.filter(([k]) => this._themeHasPart(t, k)).map(setting) });
    items.push({ kind: "drill", title: "Custom Settings", icon: SI, sub: "Which of your own Theme Settings stay on with this theme, each On or Off.",
      // (an Icon Theme only changes icons: just the icon settings)
      childrenFn: () => THEME_OPTS.filter(([k]) => k !== "iconAlpha").map(setting) });
    if (kind === "p3t") items.push({ kind: "action", act: `theme_extract::${key}`, title: "Extract Theme", icon: SI,
      sub: "Put everything this theme has (icons, background, preview, sounds, mouse pointers, notification box, animated scene and its textures) in a folder with its name, in the Themes Extracted folder." });
    return items;
  },
  // A Custom Theme's own PS3 background / overlay (saved with it), as shown
  // now: { theme, bg, ov, opts } (opts: your settings with them), or null
  _customP3t(th) {
    const sv = th?.settings?.p3t, pt = th?.p3t;
    if (!sv || !pt) return null;
    const o = this._themeOpts(th.key);
    const bg = !!(sv.background && o.tBackground), ov = !!(sv.overlay && o.tOverlay && pt.scene);
    if (!bg && !ov) return null;
    // (its PS3 background turned off: your own background and overlay take its place)
    const so = sv.opts || {};
    const opts = { waves: so.waves !== false, sparkles: so.sparkles !== false,
      background: !bg || so.background !== false, overlay: !bg || so.overlay !== false };
    return { theme: pt, bg, ov, opts };
  },
  _thoParse(ctl) { const r = ctl.slice(4), i = r.lastIndexOf(":"); return { key: r.slice(0, i), opt: r.slice(i + 1) }; },
  _thoGet(ctl) { const { key, opt } = this._thoParse(ctl); return this._themeOpts(key)[opt] !== false; },
  _themeHasPart(t, k) {
    return { tBackground: t.scene || !!t.background, tOverlay: !!t.scene, tIcons: Object.keys(t.icons || {}).length > 0, tSounds: Object.keys(t.sounds || {}).length > 0,
      tColor: t.color != null, tInfoBox: !!t.notification, tClock: !!t.notification }[k];
  },
  async _thoToggle(ctl) {
    const { key, opt } = this._thoParse(ctl), t = this.user.theme;
    const o = ((t.themeOpts ||= {})[key] ||= {});
    o[opt] = !this._themeOpts(key)[opt];
    this._persistUser();
    // only what a theme in use shows changes (the menus are drawn again when its icons change)
    if ([t.p3tTheme, t.iconTheme, t.customTheme].includes(key)) {
      const icons = ["iconColor", "iconStyle", "iconAlpha", "tIcons", "tColor"].includes(opt);
      if (icons) await this._runLocked("theme", "Please wait...", () => this._applyThemes(true).catch((e) => console.warn("theme", e)));
      else await this._applyThemes(false);
    }
    this.audio.play("enter", 0.4);
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  async _themeUse(kind, key) {
    const t = this.user.theme, prop = this._themeProp(kind);
    const starting = t[prop] !== key;
    if (kind === "custom") {
      const th = this._themeFind("custom", key);
      if (starting && th) {
        // your own settings are kept, to come back when you stop using it
        if (!t.customTheme) t.customBackup = this._themeSnap();
        this._applyThemeSnap(this._customSettings(th), false);
      } else if (t.customBackup) { this._applyThemeSnap(t.customBackup, false); delete t.customBackup; }
    }
    t[prop] = starting ? key : null;
    this._persistUser();
    await this._runLocked("theme", starting ? "Applying the theme..." : "Please wait...", () => this._applyThemes(true).catch((e) => console.warn("theme", e)));
  },
  // A Custom Theme's pictures that came from a PS3 theme (recorded when it's
  // made: settings.p3tIcons). One made before that was recorded: the pictures
  // a PS3 theme has that it never shows in folders, taken as from one
  _customP3tIcons(th) {
    const list = th?.settings?.p3tIcons;
    return new Set((Array.isArray(list) ? list : P3T_FOLDER_PICS).map((n) => String(n).toLowerCase()));
  },
  // a Custom Theme's settings, with its files where it was unpacked
  _customSettings(th) {
    const dir = th.dir, sep = dir.includes("\\") ? "\\" : "/";
    const fix = (v) => (typeof v === "string" && v.startsWith("file:") ? dir + sep + v.slice(5).split("/").join(sep) : v);
    const s = JSON.parse(JSON.stringify(th.settings || {}));
    for (const k of ["wallpaper", "overlay", "font", "introIcon", "introTitle"]) s[k] = fix(s[k]);
    for (const k of ["bgPlaylists", "ovPlaylists"]) if (Array.isArray(s[k])) for (const pl of s[k]) pl.items = (pl.items || []).map(fix);
    return s;
  },
  // Create Custom Theme: your Theme Settings and the files they use, as a .zip
  _createCustomTheme() {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Create Custom Theme", fields: [{ key: "name", label: "Theme Name", required: true }], submit: "Create" },
      async (out) => {
        this.textForm.close(); this.overlay = null;
        const name = String(out.name || "").trim(); if (!name) return;
        const snap = this._themeSnap(), files = {};
        const base = (p) => String(p).split(/[\\/]/).pop();
        const seen = new Map();   // (one copy of each file; same names get a number)
        const add = (p, dir) => {
          if (!p || /^(data:|blob:|https?:)/.test(p)) return p;
          if (seen.has(p)) return seen.get(p);
          let rel = `${dir}/${base(p)}`, n = 2;
          while (files[rel]) rel = `${dir}/${n++}-${base(p)}`;
          files[rel] = p; seen.set(p, `file:${rel}`); return `file:${rel}`;
        };
        snap.wallpaper = add(snap.wallpaper, "media"); snap.overlay = add(snap.overlay, "media"); snap.font = add(snap.font, "font");
        snap.introIcon = add(snap.introIcon, "media"); snap.introTitle = add(snap.introTitle, "media");
        // the Background / Overlay Playlists the shuffles use come along with their files
        const used = (v) => (typeof v === "string" && v.startsWith("pl:") ? v.slice(3) : null);
        const take = (which, name) => this._bgPlaylists(which).filter((p) => p.name === name).map((p) => ({ ...p, items: (p.items || []).map((i) => add(i, "media")) }));
        snap.bgPlaylists = take("bg", used(snap.bgShuffle));
        snap.ovPlaylists = take("ov", used(snap.ovShuffle));
        // the icons in use from an Icon Theme / PS3 theme / Custom Theme
        // (and which of them come from a PS3 theme, kept in its settings:
        // a PS3 theme's pictures never replace the folders', in a Custom
        // Theme made with them either)
        const origin = {}, cuNow = this._themeFind("custom", this.user.theme.customTheme), cuFromP3t = cuNow ? this._customP3tIcons(cuNow) : new Set();
        for (const layer of [cuNow, this._themeFind("p3t", this.user.theme.p3tTheme), this._themeFind("icon", this.user.theme.iconTheme)]) {
          if (!layer) continue;
          if (layer.key.startsWith("p3t:") && !this._themeOpts(layer.key).tIcons) continue;
          // (later layers come first; the players' icons go in their own folders)
          const PF = { mp: "Music Player", vp: "Video Player", pv: "Photo Viewer" };
          for (const [n, p] of Object.entries(layer.icons || {})) {
            const i = n.indexOf(":"), file = i > 0 ? `${PF[n.slice(0, i)] || n.slice(0, i)}/${n.slice(i + 1)}` : n;
            files[`icons/${file}`] = p;
            origin[n.toLowerCase()] = layer.key.startsWith("p3t:") || (layer === cuNow && cuFromP3t.has(n.toLowerCase()));
          }
        }
        snap.p3tIcons = Object.keys(origin).filter((n) => origin[n]);
        // the sounds in use (a PS3 theme's with its Sounds part on, a Custom Theme's, a Sound Effects pack's)
        const t = this.user.theme, p3 = this._themeFind("p3t", t.p3tTheme);
        // the PS3 theme's background and / or overlay shown now (a PS3 theme's in
        // use, or a Custom Theme's own copy of one) come along: the whole unpacked
        // theme goes in the theme's p3t folder, with which parts were on and your
        // settings as they were with it
        let p3tDir = null;
        {
          const cu = this._themeFind("custom", t.customTheme), cps = this._customP3t(cu);
          if (cps) {
            p3tDir = cps.theme.dir;
            snap.p3t = { background: cps.bg, overlay: cps.ov, opts: { ...cps.opts } };
          } else if (p3) {
            const o = this._themeOpts(p3.key), bg = !!(o.tBackground && this._themeHasPart(p3, "tBackground")), ov = !!(o.tOverlay && p3.scene);
            if (bg || ov) {
              p3tDir = p3.dir;
              snap.p3t = { background: bg, overlay: ov, opts: { waves: o.waves !== false, sparkles: o.sparkles !== false, background: o.background !== false, overlay: o.overlay !== false } };
            }
          }
        }
        const sounds = this._soundFiles(p3 && this._themeOpts(p3.key).tSounds ? p3 : null, this._themeFind("custom", t.customTheme), t.soundTheme ? this._themeFind("sound", t.soundTheme) : null);
        for (const [n, p] of Object.entries(sounds)) { const ext = (/\.([a-z0-9]+)$/i.exec(p) || [, "wav"])[1].toLowerCase(); files[`sounds/${n}.${ext}`] = p; }
        await this._runLocked("theme_custom_create", "Creating the theme...", async () => {
          try { await call("custom_theme_create", { name, settings: snap, files, p3t: p3tDir }); this._shotFeedback(`Theme "${name}" created`); }
          catch (e) { this.audio.play("error", 0.4); this._shotFeedback("The theme couldn't be created"); }
          await this._loadThemes();
          const lvl = this._level();
          if (lvl && lvl.items && lvl.items.kindList === "custom") this._rebuildLevel(() => this._themeListItems("custom"));
        });
      },
      () => { this.textForm.close(); this.overlay = null; });
  },
  async _extractTheme(key) {
    const th = this._themeFind("p3t", key);
    if (!th) return;
    await this._runLocked(`theme_extract::${key}`, "Extracting the theme...", async () => {
      try { await call("theme_extract", { dir: th.dir, name: th.name }); this._shotFeedback("Theme extracted to the Themes Extracted folder"); }
      catch (e) { this.audio.play("error", 0.4); this._shotFeedback("The theme couldn't be extracted"); }
    });
  },
  // ---- Font, Text Color, Info Box Color ------------------------------------
  _applyTextLook() {
    const t = this.user?.theme || {}, root = document.documentElement;
    const col = (v) => { const c = parseColor(v); return c && v !== "auto" ? colorHex({ ...c, a: 1 }) : null; };
    // (a PS3 theme's Info Box Color option colours the info box)
    const tc = col(t.textColor), cc = col(this._themeInfoColor || t.clockColor);
    if (tc) { root.style.setProperty("--text", tc); root.classList.add("tc-custom"); }
    else { root.style.removeProperty("--text"); root.classList.remove("tc-custom"); }
    if (cc) { root.style.setProperty("--ib-color", cc); root.classList.add("ib-custom"); }
    else { root.style.removeProperty("--ib-color"); root.classList.remove("ib-custom"); }
    // the clock's own colour (Clock Color), apart from the info box's
    const kc = col(this._themeClockColor || t.clockIconColor);
    if (kc) { root.style.setProperty("--clock-color", kc); root.classList.add("clk-custom"); }
    else { root.style.removeProperty("--clock-color"); root.classList.remove("clk-custom"); }
    this._scaleFontRules();
    this._textColorRules();
    root.style.setProperty("--font-scale", String((t.fontSize ?? 100) / 100));
    let st = document.getElementById("user-font");
    if (!st) { st = document.createElement("style"); st.id = "user-font"; document.head.appendChild(st); }
    const font = t.font;
    if (font) {
      st.textContent = `@font-face { font-family: "XmbUserFont"; src: url("${assetUrl(font)}"); font-display: swap; }`;
      root.style.setProperty("--ui-font", `"XmbUserFont", "Rodin", "Segoe UI", system-ui, sans-serif`);
      root.classList.add("user-font");
    } else { st.textContent = ""; root.style.removeProperty("--ui-font"); root.classList.remove("user-font"); }
  },
  // Text Color, everywhere: every rule in the stylesheet that paints text a
  // light, neutral colour (white, the light greys, see-through white…) gets a
  // twin that, with a Text Color chosen, uses that colour instead — just as
  // light (a grey stays as much darker) and just as see-through. Made once;
  // the colour itself comes from --text, so changing it is instant. (Not the
  // on-screen keyboard, the boot intro or the clock icon, which keep theirs.)
  _textColorRules() {
    if (this._tcRulesMade) return;
    this._tcRulesMade = true;
    const probe = document.createElement("span"); document.body.appendChild(probe);
    const memo = new Map();
    const conv = (v) => {
      if (memo.has(v)) return memo.get(v);
      let out = null;
      if (!/var\(|currentcolor|inherit|transparent|initial|unset/i.test(v)) {
        probe.style.color = ""; probe.style.color = v;
        const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(probe.style.color ? getComputedStyle(probe).color : "");
        if (m) {
          const [r, g, b] = [+m[1], +m[2], +m[3]], a = m[4] == null ? 1 : +m[4];
          const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
          if (hi >= 170 && hi - lo <= 40 && a > 0) {
            const f = Math.round(hi / 255 * 1000) / 10;
            let c = f >= 99.5 ? "var(--text)" : `color-mix(in srgb, var(--text) ${f}%, black)`;
            if (a < 1) c = `color-mix(in srgb, ${c} ${Math.round(a * 1000) / 10}%, transparent)`;
            out = c;
          }
        }
      }
      memo.set(v, out); return out;
    };
    const SKIP = /osk|intro|ps3-|ib-clock|browser-snap|shot-|tc-custom|ib-custom|clk-custom|\.gl\b/;
    const split = (sel) => {   // a selector list at its top-level commas
      const out = []; let depth = 0, cur = "";
      for (const ch of sel) {
        if (ch === "(") depth++; else if (ch === ")") depth--;
        if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    const pre = (sel) => /^:root\b/.test(sel) ? sel.replace(/^:root/, ":root.tc-custom")
      : /^html\b/.test(sel) ? sel.replace(/^html/, "html.tc-custom") : `:root.tc-custom ${sel}`;
    let css = "";
    const walk = (rules, wrap) => {
      for (const r of rules) {
        if (r.type === 4 && r.cssRules) { walk(r.cssRules, `@media ${r.conditionText || r.media.mediaText}`); continue; }
        if (!r.selectorText || !r.style) continue;
        const v = r.style.getPropertyValue("color");
        if (!v) continue;
        const c = conv(v.trim());
        if (!c) continue;
        const sels = split(r.selectorText).filter((x) => !SKIP.test(x));
        if (!sels.length) continue;
        const rule = `${sels.map(pre).join(", ")} { color: ${c}${r.style.getPropertyPriority("color") ? " !important" : ""}; }`;
        css += wrap ? `${wrap} { ${rule} }\n` : rule + "\n";
      }
    };
    for (const sh of document.styleSheets) { try { if (sh.ownerNode && sh.ownerNode.id) continue; walk(sh.cssRules, ""); } catch (e) {} }
    probe.remove();
    const st = document.createElement("style"); st.id = "tc-rules"; st.textContent = css; document.head.appendChild(st);
  },
  // Font Size: every absolute font-size in the stylesheet is multiplied by
  // --font-scale (done once; sizes relative to their parent (em / %) are left
  // alone so they don't scale twice).
  _scaleFontRules() {
    if (this._fontRulesScaled) return;
    this._fontRulesScaled = true;
    const walk = (rules) => {
      for (const r of rules) {
        const v = r.style && r.style.getPropertyValue("font-size");
        if (v && !v.includes("--font-scale") && !/(?<!r)em\b|%|inherit|initial|unset|smaller|larger/.test(v)) {
          r.style.setProperty("font-size", `calc(${v} * var(--font-scale, 1))`, r.style.getPropertyPriority("font-size"));
        }
        if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      }
    };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
  },
  _adjustFontSize(dir) {
    const t = this.user.theme;
    t.fontSize = Math.max(0, Math.min(300, (t.fontSize ?? 100) + dir * holdAccel("fontsize", 5)));
    this.audio.play("cursor_up", 0.4); this._persistUser(); this._applyTextLook();
    setTimeout(() => this._layoutItems(this.root.clientWidth, this.root.clientHeight), 60);
  },
  async _fontList() { try { return await call("list_fonts"); } catch (e) { return []; } },
  async _fontMenu() {
    const fonts = await this._fontList();
    const items = [{ label: "Default", id: "" },
      ...(fonts.length ? [{ label: "From the Fonts Folder\u2026", id: "__grid__" }] : []),
      { label: "Choose Font File\u2026", id: "__pick__" }];
    this.overlay = this.sideMenu;
    this.sideMenu.open(items, { title: "Font" }, async (ch) => {
      this.sideMenu.close(); this.overlay = null;
      let f = ch.id;
      if (f === "__grid__") { this._fontGrid(fonts); return; }
      if (f === "__pick__") { try { f = await call("pick_font"); } catch (e) { f = null; } if (!f) return; }
      this._setFont(f || null);
    }, () => { this.sideMenu.close(); this.overlay = null; });
  },
  // the fonts of the Fonts folder as a grid (like the Photo Gallery), each
  // showing "Aa" in itself
  _fontGrid(fonts) {
    const items = fonts.map((f) => ({ label: f.split(/[\\/]/).pop().replace(/\.[^.]+$/, ""), id: f,
      fontUrl: /^\.\//.test(f) ? f : assetUrl(f) }));
    this.overlay = this.listPicker;
    this.listPicker.open({ title: "Font", items, grid: true, submit: "Select" }, (it) => {
      this.listPicker.close(); this.overlay = null;
      if (it && it.id) this._setFont(it.id);
    }, () => { this.listPicker.close(); this.overlay = null; this._fontMenu(); });
  },
  _setFont(f) {
    this.user.theme.font = f || null; this._persistUser(); this._applyTextLook();
    setTimeout(() => this._layoutItems(this.root.clientWidth, this.root.clientHeight), 150);
  },
};
