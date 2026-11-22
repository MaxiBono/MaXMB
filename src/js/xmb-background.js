// XMB: background (the Xmb class's methods, from xmb.js; put on its prototype there)
import { FIT_MODES, fitMedia } from "./fit.js";
import { ORIGINAL_SHARED } from "./ps3wave/original.js";
import { ORIG_SQUARES, ORIG_SQUARE_SPARKLES, ORIG_SQUARE_WAVE, VISUALIZER_BG, VISUALIZER_WAVE, WAVE_PARAM_META, origMeta, squareLook, waveParamDefault } from "./xmb-shared.js";
import { assetUrl, call, noExt, stillUrl } from "./api.js";
import { colorHex, holdAccel, parseColor } from "./ui.js";
import { customizationOn } from "./themes.js";
import { isVideoPath, setLayerMedia, setOverlayMedia } from "./chroma.js";

export const BackgroundMethods = {
  // The look shown: the signed-in user's; before anyone signs in (the intro and
  // Log In), the last one the system showed (Keep Personalization Options when
  // Booting, On by default: settings.bootLook), or the original one
  _lookT() { return this.user?.theme || (this.locked ? this._bootTheme || null : null); },
  // (the original look before anyone signs in: Keep Personalization Options when Booting Off)
  _bootPlainNow() { return !this.user && this.locked && this._bootPlain; },

  // ------------------------------------------------------------- settings
  // Build the "Wave and Sparkles Personalization" submenu: one adjustable setting per linkev
  // spline/particle parameter, plus a reset action. Adjusted with Left/Right.
  // (with the Original wave: only the settings it follows)
  _activeWaveMeta() {
    const orig = this._waveIsOriginal();
    return orig ? WAVE_PARAM_META.filter((m) => ORIGINAL_SHARED.has(m[0] + ":" + m[1])).map(origMeta) : WAVE_PARAM_META;
  },
  _waveIsOriginal() { return this.wave?.activeWaveStyle ? this.wave.activeWaveStyle() === "original" : this._waveEngine() === "original"; },
  // Wave and Sparkles Personalization: the wave's colour settings (the
  // background gradient behind it and the wave's own colour and light), the
  // wave's other settings, the sparkles' colour settings, the sparkles' other
  // settings; then the presets and the reset
  _wavePersonalizationItems() {
    const SI = { sys: "icon_setting_item.png" };
    const WAVE_COLOR = new Set(["gradientPreset", "bgTopR", "bgTopG", "bgTopB", "bgBotR", "bgBotG", "bgBotB", "bgAngle", "bgSpan", "bgCurve",
      "gradientTopMul", "gradientBotMul", "opacity", "brightness", "autoTintBoost", "autoTintWhite"]);
    const SPARK_COLOR = new Set(["opacity"]);
    const row = ([group, key, label, , , , , desc]) => ({ kind: "setting", ctl: `wp:${group}:${key}`, title: label, icon: SI, ...(desc ? { sub: desc } : {}) });
    const meta = this._activeWaveMeta();
    const pick = (fn) => () => meta.filter(fn).map(row);
    return [
      { kind: "drill", title: "Wave Color Settings", icon: SI, childrenFn: pick((m) => m[0] === "spline" && WAVE_COLOR.has(m[1])) },
      { kind: "drill", title: "Wave Settings", icon: SI, childrenFn: pick((m) => m[0] === "spline" && !WAVE_COLOR.has(m[1])) },
      { kind: "drill", title: "Sparkles Color Settings", icon: SI, childrenFn: pick((m) => m[0] === "particle" && SPARK_COLOR.has(m[1])) },
      { kind: "drill", title: "Sparkle Settings", icon: SI, childrenFn: pick((m) => m[0] === "particle" && !SPARK_COLOR.has(m[1])) },
      { kind: "action", act: "wave_save", title: "Save Current Settings as a Preset\u2026", icon: SI },
      { kind: "drill", title: "Saved Presets", icon: SI, childrenFn: this._wavePresetItems },
      { kind: "action", act: "wave_reset", title: "Reset Wave and Sparkles Settings to Default", icon: SI },
    ];
  },
  // The saved-preset list (computed fresh whenever the submenu opens). Each
  // preset loads on Enter; Delete lives on its options (triangle) menu.
  _wavePresetItems() {
    const presets = (this.user?.theme?.wavePresets) || [];
    if (!presets.length) return [{ kind: "empty", title: "No presets saved",
      sub: "Adjust the wave and the sparkles, then choose “Save Current Settings as a Preset…”.", icon: { sys: "icon_setting_item.png" } }];
    return presets.map((p, i) => ({ kind: "action", act: "wave_load", title: p.name,
      icon: { sys: "icon_setting_item.png" }, preset: p, opts: [{ act: `wave_delete::${i}`, label: "Delete Preset" }] }));
  },
  _saveWavePreset() {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Save Wave Preset", fields: [{ key: "name", label: "Preset Name", required: true }], submit: "Save" },
      (out) => { this.textForm.close(); this.overlay = null; this._commitWavePreset((out.name || "").trim()); },
      () => { this.textForm.close(); this.overlay = null; });
  },
  _commitWavePreset(name) {
    if (!name) return;
    const params = {};
    for (const m of this._activeWaveMeta()) {
      const v = this.wave.getWaveParam ? this.wave.getWaveParam(m[0], m[1]) : undefined;
      params[`${m[0]}:${m[1]}`] = (v != null ? v : waveParamDefault(m[0], m[1]));
    }
    const u = this.user;
    if (!u.theme.wavePresets) u.theme.wavePresets = [];
    const existing = u.theme.wavePresets.findIndex((p) => p.name === name);
    const entry = { name, params };
    if (existing >= 0) u.theme.wavePresets[existing] = entry; else u.theme.wavePresets.push(entry);
    this.audio.play("enter", 0.5); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _loadWavePreset(preset) {
    if (!preset) { this.audio.play("error", 0.4); return; }
    this._dropActiveWaveParams();
    this.user.theme.waveParams = { ...this.user.theme.waveParams, ...(preset.params || {}) };
    this._applyWaveStyle();
    this.audio.play("enter", 0.6); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _deleteWavePreset(idx) {
    const u = this.user;
    if (!u.theme || !Array.isArray(u.theme.wavePresets)) return;
    u.theme.wavePresets.splice(idx, 1); this._persistUser(); this.audio.play("back", 0.5);
    // refresh the open Saved Presets submenu in place
    const lvl = this._level();
    lvl.items = this._wavePresetItems();
    lvl.sel = Math.min(lvl.sel, Math.max(0, lvl.items.length - 1));
    this._render(); this._onSelect();
  },
  _waveParamMeta(ctl) {
    const [, group, key] = ctl.split(":");
    let m = WAVE_PARAM_META.find((e) => e[0] === group && e[1] === key);
    if (!m) return null;
    if (this._waveIsOriginal() && ORIGINAL_SHARED.has(group + ":" + key)) m = origMeta(m);
    // the smallest step: 1 for whole numbers, 0.01 (or finer) otherwise
    const dec = m[6] === 0 ? 0 : Math.max(2, m[6]);
    return { group, key, min: m[3], max: m[4], step: Math.min(m[5], 10 ** -dec), dec, labels: m[8] || null };
  },
  _waveParamValue(ctl) {
    const m = this._waveParamMeta(ctl); if (!m) return 0;
    const stored = this._lookT()?.waveParams?.[`${m.group}:${m.key}`];
    const live = this.wave.getWaveParam ? this.wave.getWaveParam(m.group, m.key) : undefined;
    const v = stored != null ? stored : (live != null ? live : waveParamDefault(m.group, m.key));
    return Number(v) || 0;
  },
  _adjustWaveParam(it, dir) {
    const m = this._waveParamMeta(it.ctl); if (!m) return;
    // speed-up while held, capped at a 20th of the range per step
    let v = this._waveParamValue(it.ctl) + dir * m.step * holdAccel(it.ctl, (m.max - m.min) / 20 / m.step);
    v = Math.max(m.min, Math.min(m.max, v));
    // snap to the step grid to avoid float drift
    v = Math.round(v / m.step) * m.step;
    v = Math.max(m.min, Math.min(m.max, Number(v.toFixed(6))));
    const u = this.user;
    if (!u.theme.waveParams) u.theme.waveParams = {};
    u.theme.waveParams[`${m.group}:${m.key}`] = v;
    this.wave.setWaveParam(m.group, m.key, v);
    this.audio.play("cursor_up", 0.35); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _waveGroups() { return ["spline", "particle"]; },
  _dropActiveWaveParams() {
    const t = this.user.theme, gs = this._waveGroups(), out = {};
    for (const [k, v] of Object.entries(t.waveParams || {})) if (!gs.includes(k.split(":")[0])) out[k] = v;
    t.waveParams = out;
  },
  _resetWaveParams() {
    this._dropActiveWaveParams();
    this._applyWaveStyle();   // (defaults, the Visualizer Wave's when in use, then yours)
    this.audio.play("enter", 0.4); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight); this._onSelect();
  },
  // Apply the wave and the user's saved
  // Wave and Sparkles Personalization params to the running renderer.
  _applyWaveStyle() {
    const t = this._lookT() || {}, player = this._visPlayer(), bg = this._bgLook(), wl = this._waveLook();
    this._lookApplied = this._lookKey();
    this.wave.setStyle(this._waveEngine());
    const ov = this._origVisFiles();
    if (this.wave.setOverlay) this.wave.setOverlay(ov ? "music_1" : null, ov);
    this.wave.resetWaveParams();               // start from defaults…
    if (bg && !(ov && bg === VISUALIZER_BG)) this.wave.applyWaveParams(this._squareParams(bg));   // (a Background Color's own gradient)
    if (wl && !ov) this.wave.applyWaveParams(wl.params);   // (the Visualizer Wave's wave and sparkles)
    if (t.waveParams && !player) this.wave.applyWaveParams(t.waveParams);  // …then the user's overrides
    this._applyWaveLook();
  },
  // A Background Color square's settings for the Wave Style in use (the
  // Original wave has its own, fitted to the console: ORIG_SQUARES)
  _squareOrig(bg) { return bg && bg.name && this._waveEngine() === "original" && !(this.wave?.originalFailReason && this.wave.originalFailReason()) ? ORIG_SQUARES[bg.name] || null : null; },
  _squareParams(bg) {
    const o = this._squareOrig(bg);
    if (!o) return bg.params;
    // (the wave's own settings stay the same on every square)
    return { ...bg.params, "spline:bgTopR": o.top[0], "spline:bgTopG": o.top[1], "spline:bgTopB": o.top[2],
      "spline:bgBotR": o.bot[0], "spline:bgBotG": o.bot[1], "spline:bgBotB": o.bot[2], ...(o.curve ? { "spline:bgCurve": o.curve } : {}),
      ...(o.span ? { "spline:bgSpan": o.span } : {}) };
  },
  // the Music Player showing the Visualizer Wave (Music Settings > Music Player Visualizer Wave)
  _visPlayer() { return !!this._inMusicPlayer && this.settings?.behavior?.mpVisualizer !== false; },
  // the background's own look: a colour square, or the Visualizer Wave (null: Original, a custom colour)
  _bgLook() {
    if (this._visPlayer()) return VISUALIZER_BG;
    // (before anyone signs in: the look kept from the last start's, _lookT)
    if (!this._lookT()) return null;
    const c = this._tcol("backgroundColor");
    return c === "visualizer" ? VISUALIZER_BG : squareLook(c);
  },
  // Wave Color > Visualizer Wave: its wave and sparkles
  _waveLook() {
    if (this._visPlayer()) return this._visWave();
    return this._lookT() && this._tcol("waveColor") === "visualizer" ? this._visWave() : null;
  },
  _visWave() { return VISUALIZER_WAVE; },
  // With the Original wave, the Visualizer is the console's own: its Music
  // Player preset (lines.qrc override/music_1), faded in over the time of day,
  // for the parts that are on Visualizer: the background (BACKGROUND, HDR),
  // the wave and sparkles (LINE1, PARTICLES), or all of it (the Music Player).
  // null: not in use (linkev's draws its own Visualizer look instead)
  _origVisFiles() {
    const orig = this._waveEngine() === "original" && !(this.wave?.originalFailReason && this.wave.originalFailReason());
    if (!orig) return null;
    if (this._visPlayer()) return ["BACKGROUND", "HDR", "LINE1", "PARTICLES"];
    if (!this._lookT()) return null;
    const bgV = this._tcol("backgroundColor") === "visualizer", wV = this._tcol("waveColor") === "visualizer";
    if (bgV && wV) return ["BACKGROUND", "HDR", "LINE1", "PARTICLES"];
    if (bgV) return ["BACKGROUND", "HDR"];
    if (wV) return ["LINE1", "PARTICLES"];
    return null;
  },
  _lookKey() { return [this._visPlayer(), this._bgLook()?.params?.["spline:bgTopR"] ?? "", this._bgLook()?.swatch ?? (this._bgLook() ? "vis" : ""), !!this._waveLook()].join("|"); },
  // after a change of Background / Wave Color or the Music Player opening or
  // closing: the wave set up again when its look changes
  _syncVisualizer() {
    document.body.classList.toggle("mpvis", this._visPlayer());
    if (this._lookKey() !== this._lookApplied) this._applyWaveStyle();
  },
  // (one set of wave settings, shared by both Wave Styles)
  _wk(prop) { return prop; },
  // Wave Style: "original" (the PS3's own wave, the default) or "linkev"
  // (a user's own choice; before anyone signs in, or a user who never chose:
  // the one chosen last on this computer)
  _waveEngine() { const v = this._lookT()?.waveEngine || (this._bootPlainNow() ? null : this.settings?.graphics?.waveStyle); return v === "linkev" ? "linkev" : "original"; },
  // The old "Default" wave style is gone: the first time a user signs in, the
  // wave settings they had for "Complex" become the settings, and the old
  // Default-style ones are dropped.
  _migrateWaveSettings() {
    const t = this._lookT();
    if (!t || t.waveV2) return;
    // the old Default style's Wave and Sparkles Personalization values and presets go
    if (t.waveParams) for (const k of Object.keys(t.waveParams)) if (!/^(spline|particle):/.test(k)) delete t.waveParams[k];
    if (Array.isArray(t.wavePresets)) t.wavePresets = t.wavePresets.filter((p) => Object.keys(p.params || {}).some((k) => /^(spline|particle):/.test(k)))
      .map((p) => ({ name: p.name, params: Object.fromEntries(Object.entries(p.params).filter(([k]) => /^(spline|particle):/.test(k))) }));
    delete t.waveStyle; t.waveV2 = true; this._persistUser();
  },
  // v3: a Background Color's gradient is now shaded like Auto's; the old
  // default Gradient Top / Bottom (0.09 / 0.62, a near-black top) go back to
  // the new defaults (values someone changed by hand stay)
  _migrateWaveV3() {
    const t = this._lookT();
    if (!t || t.waveV3) return;
    const wp = t.waveParams || {};
    if (wp["spline:gradientTopMul"] === 0.09) delete wp["spline:gradientTopMul"];
    if (wp["spline:gradientBotMul"] === 0.62) delete wp["spline:gradientBotMul"];
    for (const p of t.wavePresets || []) {
      const q = p.params || {};
      if (q["spline:gradientTopMul"] === 0.09) delete q["spline:gradientTopMul"];
      if (q["spline:gradientBotMul"] === 0.62) delete q["spline:gradientBotMul"];
    }
    t.waveV3 = true; this._persistUser();
  },
  _applyWaveLook() {
    const t = this._lookT() || {};
    const ov = this._origVisFiles();
    if (this._visPlayer()) {
      const vw = this._visWave();
      // (Original: the console's own Music Player look: its own colours)
      this.wave.setWaveColor(ov ? "auto" : vw.wave); this.wave.setDotColor(ov ? "auto" : vw.dot);
      this.wave.setWavesEnabled(true); this.wave.setDotsEnabled(true); this.wave.setMonthMode(!!ov);
      return;
    }
    // Original: the Visualizer Wave's (Wave Color > Visualizer Wave), or the
    // background's own tint (a colour square's; the month's; with the Visualizer
    // Wave background, drawn from it)
    const bg = this._bgLook(), wl = this._waveLook();
    const own = (k) => { const c = this._tcol(k); return !c || c === "auto" || c === "visualizer" ? null : c; };
    const ovWave = !!ov && ov.includes("LINE1"), ovBg = !!ov && ov.includes("BACKGROUND");
    // (a colour square's wave: with linkev's, a little brighter than its
    // background; with the Original wave, the same white light on every square)
    this.wave.setWaveColor(own("waveColor") || (ovWave ? null : wl?.wave) || (ovBg ? null : (this._squareOrig(bg) ? ORIG_SQUARE_WAVE : bg?.wave)) || "auto");
    this.wave.setWavesEnabled(t.wavesEnabled !== false && customizationOn("waves"));
    // (Sparkles Color > Visualizer: the Visualizer Wave's sparkles)
    this.wave.setDotColor(this._tcol("dotColor") === "visualizer" && !ovWave ? this._visWave().dot : (own("dotColor") || (ovWave ? null : wl?.dot) || (ovBg ? null : (this._squareOrig(bg) ? ORIG_SQUARE_SPARKLES : bg?.dot)) || "auto"));
    this.wave.setDotsEnabled(t.dotsEnabled !== false && customizationOn("sparkles"));
    // Original: always the month's colour, brighter by day and darker by night
    // (always true / false: an unset value read as "on" kept the month's
    // background after choosing a Background Color)
    this.wave.setMonthMode(!bg || (!!ovBg && bg === VISUALIZER_BG));
  },

  // ---- Photo/Video Playlists + Background / Overlay Shuffle -----------------
  // One list of playlists for both shuffles (the overlay's own list from
  // before is merged in once: a playlist already there under the same name
  // with the same items is kept once, a different one gets "(Overlay)" added)
  _bgPlaylists() {
    // (before anyone signs in: the last start's, so its Background Shuffle shuffles them too)
    const t = this.user ? this.user.theme : (this._lookT() || {});
    const list = (t.bgPlaylists ||= []);
    if (Array.isArray(t.ovPlaylists)) {
      for (const p of t.ovPlaylists) {
        const same = list.find((x) => x.name === p.name);
        if (same && JSON.stringify(same.items) === JSON.stringify(p.items)) continue;
        let name = same ? `${p.name} (Overlay)` : p.name;
        while (list.some((x) => x.name === name)) name += " 2";
        if (t.ovShuffle === `pl:${p.name}`) t.ovShuffle = `pl:${name}`;
        list.push({ ...JSON.parse(JSON.stringify(p)), name });
      }
      delete t.ovPlaylists;
      this._persistUser && this._persistUser();
    }
    return list;
  },
  _bgPlaylistItems(which = "bg") {
    const SI = { sys: "icon_setting_item.png" };
    return [
      { kind: "action", act: `bgpl_new::${which}`, title: "Create Playlist", icon: SI },
      ...this._bgPlaylists(which).map((p, i) => ({ kind: "drill", title: p.name, sub: `${p.items.length} Item${p.items.length !== 1 ? "s" : ""}`,
        icon: SI, childrenFn: () => this._bgPlaylistDetail(which, i) })),
    ];
  },
  _bgPlaylistDetail(which, i) {
    const p = this._bgPlaylists(which)[i]; if (!p) return [];
    const SI = { sys: "icon_setting_item.png" };
    return [
      { kind: "action", act: `bgpl_edit::${which}::${i}`, title: "Edit Playlist", icon: SI, sub: "Add or remove pictures and videos." },
      { kind: "action", act: `bgpl_del::${which}::${i}`, title: "Delete Playlist", icon: SI },
      ...p.items.map((path) => ({ kind: "ph", title: String(path).split(/[\\/]/).pop(), sub: "", icon: SI })),
    ];
  },
  async _bgPlaylistPick(title, checked, done) {
    let media = [];
    try { media = await call("list_media", { kind: "background" }); } catch (e) {}
    if (!media.length) { this.audio.play("error", 0.5); return; }
    this.overlay = this.listPicker;
    this.listPicker.open({ title, multi: true, checked, submit: "Save", grid: true,
      items: media.map((m) => ({ label: noExt(m.name || String(m.path).split(/[\\/]/).pop()), id: m.path,
        thumb: stillUrl(m.path, m.cover), vsrc: isVideoPath(m.path) ? assetUrl(m.path) : null })) },
      async (ids) => { this.listPicker.close(); this.overlay = null; await this._convertForBackground(ids || []); done(ids || []); },
      () => { this.listPicker.close(); this.overlay = null; });
  },
  _bgPlaylistNew(which = "bg") {
    this._bgPlaylistPick("Create Playlist", [], (ids) => {
      if (!ids.length) return;
      this.overlay = this.textForm;
      const n = this._bgPlaylists(which).length + 1;
      this.textForm.open({ title: "Playlist Name", prompt: "Enter a name for the playlist.", fields: [{ key: "name", label: "Name", value: `Playlist ${n}`, required: true }], submit: "Create" },
        (out) => {
          this.textForm.close(); this.overlay = null;
          let name = String(out.name || "").trim() || `Playlist ${n}`;
          while (this._bgPlaylists(which).some((p) => p.name === name)) name += " 2";
          this._bgPlaylists(which).push({ name, items: ids }); this._persistUser();
          this.audio.play("enter", 0.5); this._rebuildLevel(() => this._bgPlaylistItems(which));
        }, () => { this.textForm.close(); this.overlay = null; });
    });
  },
  _bgPlaylistEdit(which, i) {
    const p = this._bgPlaylists(which)[i]; if (!p) return;
    this._bgPlaylistPick(p.name, p.items, (ids) => {
      p.items = ids; this._persistUser(); this._restartRotation();
      this._rebuildLevel(() => this._bgPlaylistDetail(which, i));
    });
  },
  _bgPlaylistDelete(which, i) {
    const p = this._bgPlaylists(which)[i]; if (!p) return;
    this.overlay = this.confirm;
    this.confirm.open(`Delete the playlist "${p.name}"?`, [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }], (ch) => {
      this.confirm.close(); this.overlay = null;
      if (!ch || ch.id !== "yes") return;
      const t = this.user.theme;
      this._bgPlaylists(which).splice(i, 1);
      for (const k of ["bgShuffle", "ovShuffle"]) if (t[k] === `pl:${p.name}`) t[k] = "off";
      this._persistUser(); this._restartRotation(); this.audio.play("enter", 0.5);
      this._back();
      this._rebuildLevel(() => this._bgPlaylistItems(which));
    }, () => { this.confirm.close(); this.overlay = null; });
  },
  _cycleShuffle(ctl, dir) {
    const key = ctl === "bgshuffle" ? "bgShuffle" : "ovShuffle", t = this.user.theme;
    const opts = ["off", "all", ...this._bgPlaylists(ctl === "bgshuffle" ? "bg" : "ov").map((p) => `pl:${p.name}`)];
    const i = Math.max(0, opts.indexOf(t[key] || "off"));
    t[key] = opts[(i + dir + opts.length) % opts.length];
    this.audio.play("cursor_up", 0.4); this._persistUser(); this._restartRotation();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  // ✕: type a number, then choose Seconds, Minutes or Hours
  _typeInterval(it) {
    this.overlay = this.textForm;
    this.textForm.open({ title: it.title, fields: [{ key: "n", label: "Number", value: "", type: "number" }], submit: "Next" },
      (out) => {
        this.textForm.close(); this.overlay = null;
        const n = parseInt(String(out.n || "").replace(/[^0-9]/g, ""), 10);
        if (!Number.isFinite(n) || n < 1) { this.audio.play("error", 0.4); return; }
        const pl = (w) => `${n} ${w}${n !== 1 ? "s" : ""}`;
        this.overlay = this.listPicker;
        this.listPicker.open({ title: it.title, submit: "Confirm", items: [
          { label: pl("Second"), id: 1 }, { label: pl("Minute"), id: 60 }, { label: pl("Hour"), id: 3600 }] },
          (ch) => {
            this.listPicker.close(); this.overlay = null;
            this.user.theme[it.ctl === "ovinterval" ? "ovInterval" : "bgInterval"] = n * ch.id; this._persistUser(); this._retimeRotation();
            this._layoutItems(this.root.clientWidth, this.root.clientHeight);
          }, () => { this.listPicker.close(); this.overlay = null; });
      }, () => { this.textForm.close(); this.overlay = null; });
  },
  // Photo Duration: the background's, or the overlay's own (the background's
  // until it's set)
  _rotSecs(k) { const t = this._lookT() || {}; return (k === "ov" ? t.ovInterval || t.bgInterval : t.bgInterval) || 10; },
  // a new Photo Duration applies to the picture on screen now
  _retimeRotation() {
    for (const [k, r] of Object.entries(this._rot || {})) {
      if (!r || !r.timer) continue;
      clearTimeout(r.timer);
      r.timer = setTimeout(() => this._rotNext(k), this._rotSecs(k) * 1000);
    }
  },
  // (re)start both shuffles from the theme's settings
  async _restartRotation() {
    const t = this._lookT() || {};
    const gen = (this._rotGen = (this._rotGen || 0) + 1);
    for (const r of Object.values(this._rot || {})) clearTimeout(r && r.timer);
    this._rot = {};
    let all = null;
    for (const [k, key] of [["bg", "bgShuffle"], ["ov", "ovShuffle"]]) {
      const mode = t[key] || "off";
      if (mode === "off") continue;
      let list = [];
      if (mode === "all") {
        if (!all) { try { all = (await call("list_media", { kind: "background" })).map((m) => m.path); } catch (e) { all = []; } }
        list = all;
      } else list = ((this._bgPlaylists(k).find((p) => `pl:${p.name}` === mode) || {}).items || []);
      if (gen !== this._rotGen) return;
      if (list.length) this._rot[k] = { list: [...list], cur: null, timer: null, last: null };
    }
    for (const k of Object.keys(this._rot)) this._rotNext(k, false);
    this._applyWallpaper();
  },
  // the next random item (never the same one twice in a row)
  _rotNext(k, apply = true) {
    const r = this._rot && this._rot[k]; if (!r) return;
    clearTimeout(r.timer);
    let pick = r.list[Math.floor(Math.random() * r.list.length)];
    if (r.list.length > 1) while (pick === r.cur) pick = r.list[Math.floor(Math.random() * r.list.length)];
    r.cur = pick;
    if (!isVideoPath(pick)) r.timer = setTimeout(() => this._rotNext(k), this._rotSecs(k) * 1000);
    if (apply) this._applyWallpaper();
  },
  // a shuffled video plays once, then the next item comes
  _hookRotationVideos() {
    for (const [k, id] of [["bg", "wallpaper"], ["ov", "overlay"]]) {
      const r = this._rot && this._rot[k]; if (!r || !isVideoPath(r.cur) || r.list.length < 2) continue;
      const el = document.getElementById(id);
      const v = (el && el._chroma && el._chroma.video) || (el && el.querySelector("video"));
      if (!v || v._rotHooked === r.cur) continue;
      v._rotHooked = r.cur; v.loop = false;
      v.addEventListener("ended", () => { if (this._rot && this._rot[k] === r && r.cur === v._rotHooked) this._rotNext(k); }, { once: true });
    }
  },
  // Background Display: Normal / Zoom / Full Screen / Original (same order as
  // the Video Player's Screen Mode)
  _cycleBgFit(dir) {
    const t = this.user.theme;
    const i = Math.max(0, FIT_MODES.findIndex((f) => f[0] === (t.wallpaperFit || "normal")));
    t.wallpaperFit = FIT_MODES[(i + dir + FIT_MODES.length) % FIT_MODES.length][0];
    this.audio.play("cursor_up", 0.4); this._persistUser(); this._fitWallpaper();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _fitWallpaper() {
    const el = document.getElementById("wallpaper"), m = el && el.firstElementChild;
    if (!m) return;
    fitMedia(m, this._lookT()?.wallpaperFit || "normal", el);
    if (!this._wpResize) { this._wpResize = () => this._fitWallpaper(); window.addEventListener("resize", this._wpResize); }
  },
  // Overlay green-screen strength, 0..1
  _adjustChroma(dir) {
    const t = this.user.theme;
    t.chromaStrength = Math.max(0, Math.min(1, Math.round(((t.chromaStrength ?? 0.5) + dir * 0.01 * holdAccel("chroma", 5)) * 100) / 100));
    this._applyWallpaper();
    this.audio.play("cursor_up", 0.4); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  // A background / overlay video in a format or codec the webview can't play
  // (HEVC, MPEG-2, AVI, WMV, MKV…) gets the same playable copy the Video
  // Player makes (ffmpeg); the original is used until it's ready.
  _playable(p) {
    if (!p || /^data:/.test(p) || !isVideoPath(p)) return p;
    const m = (this._vplay ||= new Map());
    if (m.has(p)) return m.get(p) || p;
    // (the preloaded videos were just deleted: not converted again by itself)
    if (this._noAutoConvert) return p;
    m.set(p, null);
    (async () => {
      let out = p;
      try {
        const plan = await call("video_plan", { path: p });
        if (plan && plan.cached) out = plan.cached;
        else if (plan && plan.mode && plan.mode !== "direct") out = await call("video_prepare", { path: p, full: plan.mode === "convert" });
      } catch (e) { out = p; }
      m.set(p, out || p);
      if (out && out !== p) this._applyWallpaper();
    })();
    return p;
  },
  // Background / Overlay / Background Playlist choices: every chosen video that
  // can't play as it is gets converted now, with the loading screen up and
  // the system waiting until it's done.
  async _convertForBackground(paths) {
    this._noAutoConvert = false;   // (chosen now: converted as usual)
    const m = (this._vplay ||= new Map());
    const todo = [];
    for (const p of new Set((paths || []).filter((x) => x && !/^data:/.test(x) && isVideoPath(x)))) {
      if (m.get(p)) continue;
      let plan = null;
      try { plan = await call("video_plan", { path: p }); } catch (e) {}
      if (plan && plan.cached) { m.set(p, plan.cached); continue; }
      if (!plan || !plan.mode || plan.mode === "direct") { m.set(p, p); continue; }
      todo.push([p, plan.mode]);
    }
    if (!todo.length) return true;
    this._busy = true; this._loadingBegin();
    let failed = 0;
    for (let i = 0; i < todo.length; i++) {
      const [p, mode] = todo[i];
      let out = null;
      try { out = await call("video_prepare", { path: p, full: mode === "convert" }); }
      catch (e) { if (mode !== "convert") { try { out = await call("video_prepare", { path: p, full: true }); } catch (e2) {} } }
      if (!out) failed++;
      m.set(p, out || p);
    }
    await this._loadingSettle(); this._loadingDone();
    this._busy = false;
    if (failed) { this.audio.play("error", 0.4); this._shotFeedback(failed > 1 ? `${failed} videos couldn't be converted (ffmpeg is needed)` : "This video couldn't be converted (ffmpeg is needed)", "error"); }
    return !failed;
  },
  _applyWallpaper() {
    const t = this._lookT() || {};
    // Background / Overlay Shuffle replace the chosen picture while they run
    // (videos the webview can't play as they are use a converted copy)
    // (a theme can hide them while it's on: its Background / Overlay options)
    const wp = customizationOn("background") ? this._playable(this._rot?.bg?.cur ?? t.wallpaper) : null;
    const ov = customizationOn("overlay") ? this._playable(this._rot?.ov?.cur ?? t.overlay) : null;
    // A wallpaper may be a disk path (via convertFileSrc) or a data: URL that a
    // .p3t import produced: pass data URLs straight through.
    const url = (p) => (p && /^data:/.test(p) ? p : (p ? assetUrl(p) : null));
    const on = setLayerMedia(document.getElementById("wallpaper"), url(wp), wp);
    this._fitWallpaper();
    setOverlayMedia(document.getElementById("overlay"), url(ov), ov, t.chromaStrength ?? 0.5, t.chromaKey || "green");
    this._hookRotationVideos();
    // (a new background / overlay video while the Photo Viewer / Video Player covers it waits for them to close)
    if (this._bgCovered) for (const v of this._bgVideos()) if (!v._cover) { v._cover = { t: 0, at: performance.now() }; v.pause(); v.addEventListener("play", () => { if (this._bgCovered) v.pause(); }, { once: true }); }
    // Background colour: an opaque one is drawn by the wave renderer as usual.
    // A see-through one (Opacity < 1) becomes a tint layer over the picture /
    // black, while the wave and dots keep drawing normally on top.
    const bc = parseColor(this._tcol("backgroundColor"));
    const tint = document.getElementById("bgtint");
    if (this._visPlayer()) {
      // the Music Player's Visualizer Wave: its own background, nothing over or under it
      if (tint) tint.classList.remove("show");
      this.wave.setColor("auto");
      this.wave.setWallpaper(false);
    } else if (bc && bc.a < 0.999) {
      this.wave.setColor(colorHex({ ...bc, a: 1 }));
      if (tint) { tint.style.background = `rgba(${bc.r},${bc.g},${bc.b},${bc.a})`; tint.classList.add("show"); }
      this.wave.setWallpaper(true);
    } else {
      if (tint) tint.classList.remove("show");
      // (a colour square or the Visualizer Wave: drawn from its own gradient, as Original is)
      this.wave.setColor(this._bgLook() ? "auto" : (this._tcol("backgroundColor") || "auto"));
      // a PS3 theme's background shows through the wave like a picture does
      this.wave.setWallpaper(on || !!this.themeBg?.coversBackground);
    }
    // An Overlay over the Background Color (no picture / video): the colour's
    // gradient is drawn under the overlay, the wave over it, as with a picture
    const ovOnColor = !!ov && !on && !this.themeBg?.coversBackground && !this._visPlayer() && !(bc && bc.a < 0.999);
    this.wave.setBgOff(ovOnColor);
    clearInterval(this._bgImgT); this._bgImgT = null;
    if (ovOnColor && tint) {
      const paint = () => {
        const u = this.wave.backgroundImage(); if (!u || u === this._bgImgUrl) return;
        this._bgImgUrl = u; tint.style.background = `url("${u}") center / 100% 100% no-repeat`;
      };
      this._bgImgUrl = null; paint(); tint.classList.add("show");
      // (kept up to date: the month / time colours and the gradient settings change it)
      this._bgImgT = setInterval(paint, 2000);
    }
    this._syncVisualizer();
  },
  async _themeBgImage() { return this._themePickLayer("wallpaper", "Choose a Background"); },
  async _themeOverlay() { return this._themePickLayer("overlay", "Choose an Overlay"); },
  // Pictures, GIFs and videos from the Photos and Videos folders.
  async _themePickLayer(key, title) {
    const bgs = await call("list_media", { kind: "background" });
    if (!bgs.length) { this.audio.play("error", 0.5); return; }  // nothing in Photos / Videos
    this.overlay = this.avatarPicker;
    const covers = Object.fromEntries(bgs.filter((b) => b.cover).map((b) => [b.path, b.cover]));
    this.avatarPicker.openImages(bgs.map((b) => b.path), this.user.theme[key], async (path) => {
      this.avatarPicker.close(); this.overlay = null;
      await this._convertForBackground([path]);       // (a video that needs it is converted first)
      this.user.theme[key] = path; this._applyWallpaper(); this._persistUser();
    }, () => { this.avatarPicker.close(); this.overlay = null; }, title, covers);
  },
  _themeBgRemove() {
    this.user.theme.wallpaper = null; this._applyWallpaper(); this._persistUser();
    this.audio.play("enter", 0.5);
  },
  _themeOverlayRemove() {
    this.user.theme.overlay = null; this._applyWallpaper(); this._persistUser();
    this.audio.play("enter", 0.5);
  },
};
