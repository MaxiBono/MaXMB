// XMB: settings (the Xmb class's methods, from xmb.js; put on its prototype there)
import { CONSOLES, FPS_CAPS, ICON_STYLES, __set_PLAYER_OWN, RESOLUTIONS, SQUARE_CTLS, applyIconColorVar, colorListFor, colorName, fmtSecs, fpsCapLabel, fpsCapOf, gameName } from "./xmb-shared.js";
import { FIT_MODES } from "./fit.js";
import { ACTIONS as KEY_ACTIONS, Keybinds, codeToVk, keyLabel } from "./keybinds.js";
import { VIRTUAL_KB, holdAccel, parseColor } from "./ui.js";
import { call, cmpNatural, noExt, stillUrl } from "./api.js";
import { clearShades } from "./iconshade.js";
import { forgetWaveCache, moveWaveCache } from "./ps3wave/wavecache.js";
import { glassLayer } from "./glasslayer.js";

// the colour settings a PS3 theme's Theme Color sets while it's in use (see xmb-themes.js _tcol)
const THEME_COLOR_CTLS = ["bgcolor", "wavecolor", "dotcolor", "foldercolor"];
// Menu Blur (Power Save Settings): Original (the menus that always had it),
// All (the Web browser too), Off. (The older "Remove Menu Blur: On" is Off.)
const MENU_BLUR = [["original", "Original"], ["all", "All"], ["off", "Off"]];
const menuBlurOf = (b) => (["original", "all", "off"].includes(b?.menuBlur) ? b.menuBlur : b?.noMenuBlur ? "off" : "original");

export const SettingsMethods = {
  _settingsItems() {
    // Full Settings column in the standard PS3 order. Items without a `drills`
    // entry below are visual-only placeholders (no functionality yet).
    const names = [
      ["System Update", "icon_update.png"],
      ["Game Settings", "icon_game_setting.png"],
      ["Video Settings", "icon_bdvd_setting.png"],
      ["Music Settings", "icon_music_setting.png"],
      ["Chat Settings", "icon_chat_setting.png"],
      ["System Settings", "icon_system_setting.png"],
      ["Theme Settings", "icon_theme_setting.png"],
      ["Date and Time Settings", "icon_datetime_setting.png"],
      ["Power Save Settings", "icon_powersave_setting.png"],
      ["Accessory Settings", "icon_accessory.png"],
      ["Printer Settings", "icon_printer_setting.png"],
      ["Display Settings", "icon_display_setting.png"],
      ["Sound Settings", "icon_sound_setting.png"],
      ["Security Settings", "icon_security_setting.png"],
      ["Remote Play Settings", "icon_remoteplay_setting.png"],
      ["Network Settings", "icon_network_setting.png"],
    ];
    // Icons shown INSIDE any Settings subsection are the generic Setting icon.
    const SI = { sys: "icon_setting_item.png" };
    const themeItems = [
      { kind: "drill", title: "PS3 Themes", icon: SI, childrenFn: this._p3tThemeItems },
      { kind: "drill", title: "Custom Themes", icon: SI, childrenFn: this._customThemeItems },
      { kind: "drill", title: "Icon Sets", icon: SI, childrenFn: this._iconThemeItems },
      { kind: "drill", title: "Sound Effect Sets", icon: SI, childrenFn: this._soundThemeItems },
      { kind: "drill", title: "Background", icon: SI, children: [
        { kind: "drill", title: "Background", icon: SI, children: [
          { kind: "setting", ctl: "bgcolor", title: "Background Color", icon: SI },
          { kind: "action", act: "theme_bgimage", title: "Background", icon: SI,
              sub: "Choose a photo or video as the background." },
          { kind: "setting", ctl: "bgfit", title: "Background Display", icon: SI,
              sub: "The way the background fits on the screen." },
          { kind: "setting", ctl: "bgshuffle", title: "Background Shuffle", icon: SI,
              sub: "The background shuffles around the full list of photo and video files of the system or around a Photo/Video playlist." },
          { kind: "setting", ctl: "bginterval", title: "Photo Duration", icon: SI,
              sub: "Set the time for how long each photo lasts when Background Shuffle is on." },
          { kind: "action", act: "theme_bgremove", title: "Remove Background", icon: SI },
        ] },
        { kind: "drill", title: "Overlay", icon: SI, children: [
          { kind: "action", act: "theme_overlay", title: "Overlay", icon: SI,
              sub: "Select a transparent photo or a video that uses chroma key (Green/Blue Screen) to go over the background." },
          { kind: "setting", ctl: "chromakey", title: "Overlay Key Color", icon: SI,
              sub: "The color to be removed from a video that uses chroma key." },
          { kind: "setting", ctl: "chroma", title: "Overlay Color Strength", icon: SI,
              sub: "How strongly the key color of a video that uses chroma key should be removed." },
          { kind: "setting", ctl: "ovshuffle", title: "Overlay Shuffle", icon: SI,
              sub: "The overlay shuffles around the full list of photo and video files of the system or around a Photo/Video playlist." },
          { kind: "setting", ctl: "ovinterval", title: "Photo Duration", icon: SI,
              sub: "Set the time for how long each photo lasts when Overlay Shuffle is on." },
          { kind: "action", act: "theme_overlayremove", title: "Remove Overlay", icon: SI },
        ] },
        { kind: "drill", title: "Photo/Video Playlists", icon: SI,
            sub: "Playlists of photos and videos to be used with Shuffling.",
            childrenFn: () => this._bgPlaylistItems("bg") },
      ] },
      { kind: "drill", title: "Wave and Sparkles", icon: SI, children: [
        { kind: "setting", ctl: "wavestyle", title: "Wave Style", icon: SI,
            sub: "The linkev Wave Style is recommended for better performance" },
        { kind: "setting", ctl: "waves", title: "Wave", icon: SI },
        { kind: "setting", ctl: "wavecolor", title: "Wave Color", icon: SI },
        { kind: "setting", ctl: "dots", title: "Sparkles", icon: SI },
        { kind: "setting", ctl: "dotcolor", title: "Sparkles Color", icon: SI },
        { kind: "drill", title: "Wave and Sparkles Personalization", icon: SI, childrenFn: this._wavePersonalizationItems },
      ] },
      { kind: "drill", title: "Icons", icon: SI, children: [
        { kind: "setting", ctl: "iconcoloron", title: "Icon Color", icon: SI, sub: "On: Make all icons share the same color." },
        { kind: "setting", ctl: "iconcolor", title: "Icon Color Pick", icon: SI },
        { kind: "setting", ctl: "iconstyle", title: "Icon Style", icon: SI },
        { kind: "setting", ctl: "reactivebg", title: "Reactive Icons over Background/Overlay", icon: SI,
          sub: "The Reactive Icon Styles effects work over Backgrounds and Overlays. This option could be very taxing on slower computers." },
        { kind: "setting", ctl: "introicon", title: "Intro Icon", icon: SI, sub: this._introArtSub("icon") },
        { kind: "setting", ctl: "introtitle", title: "Intro Title", icon: SI, sub: this._introArtSub("title") },
        { kind: "setting", ctl: "psnstyle", title: "PlayStation®Network Icon", icon: SI },
        { kind: "setting", ctl: "homestyle", title: "PlayStation®Home", icon: SI },
      ] },
      { kind: "drill", title: "Text and Color", icon: SI, children: [
        { kind: "setting", ctl: "font", title: "Font", icon: SI },
        { kind: "setting", ctl: "fontsize", title: "Text Size", icon: SI },
        { kind: "setting", ctl: "textcolor", title: "Text Color", icon: SI },
        { kind: "setting", ctl: "clockcolor", title: "Info Box and Buttons Color", icon: SI },
        { kind: "setting", ctl: "clockiconcolor", title: "Clock Color", icon: SI },
        { kind: "setting", ctl: "clockshadow", title: "Clock Shadow", icon: SI },
        { kind: "setting", ctl: "ibshadow", title: "Date and Time Shadows", icon: SI },
        { kind: "setting", ctl: "foldercoloron", title: "Folder Color", icon: SI, sub: "On: Make all folders share the same color." },
        { kind: "setting", ctl: "foldercolor", title: "Folder Color Pick", icon: SI },
        { kind: "setting", ctl: "themefolders", title: "Theme Folders", icon: SI,
          sub: "On: The folders of Custom Themes, Icon Sets and PS3 Themes are shown instead of the default ones." },
      ] },
      { kind: "action", act: "theme_save", title: "Save Theme Settings as a Preset…", icon: SI },
      { kind: "drill", title: "Saved Theme Presets", icon: SI, childrenFn: this._themePresetItems },
      { kind: "action", act: "theme_reset", title: "Reset Theme Settings", icon: SI },
    ];
    const drills = {
      "Theme Settings": themeItems,
      "Sound Settings": [
        { kind: "setting", ctl: "bgaudio", title: "Play Audio in Background", icon: SI,
          sub: "Keeps all the system's audio playing when the system is out of focus." },
        { kind: "setting", ctl: "startsound", title: "Console Startup Sound", icon: SI },
        { kind: "setting", ctl: "bufsound", title: "Buffering Sound", icon: SI,
          sub: "On: The console's buffering sound plays on loop." },
        { kind: "setting", ctl: "sfx", title: "Sound Effects", icon: SI },
        { kind: "setting", ctl: "bufvol", title: "Buffering Sound Volume", icon: SI },
        { kind: "setting", ctl: "sfxvol", title: "Sound Effects Volume", icon: SI },
        { kind: "setting", ctl: "musicvol", title: "Music Volume", icon: SI },
        { kind: "setting", ctl: "volume", title: "System Volume", icon: SI },
      ],
      "Video Settings": [
        { kind: "action", act: "preloadvideos", title: "Pre-Load All Videos", icon: SI,
          sub: "Converts every video the system can't play on its own to a playable format. This is recommended before doing any video playback.",
          warn: "Warning: Once the preload starts, the system stays on this menu until the preload of all video files finishes." },
        { kind: "setting", ctl: "keepvideos", title: "Keep Pre-Loaded Videos Data", icon: SI,
          sub: "On: Saves the converted videos after preloading on the system's directory instead of the Windows Temp folder. This means that the converted videos get saved instead of being deleted after turning off the system. This is recommended to not have to manually preload every time you enter into the system." },
      ],
      "Game Settings": [
        { kind: "drill", title: "Game Information", icon: SI, sub: "Edit each game's information.",
          childrenFn: this._gameSettingsList },
        { kind: "drill", title: "Game Recognition", icon: SI, sub: "Choose where to find games.",
          childrenFn: this._gameRecognitionItems },
        { kind: "action", act: "art_steam", title: "Steam Game Art Scraping", icon: SI },
        { kind: "drill", title: "Game Art Databases", icon: SI, childrenFn: this._scrapeItems,
          sub: "Enter the keys to access the game art in SteamGridDB, TheGamesDB or RAWG." },
        { kind: "drill", title: "Folder Console", icon: SI,
          sub: "Set the type of console for all games inside of a folder in the content\\Games directory.",
          childrenFn: this._folderConsoleList },
      ],
      "Music Settings": [
        { kind: "setting", ctl: "music", title: "Background Music", icon: SI },
        { kind: "action", act: "bgmusic", title: "Select Background Music", icon: SI },
        { kind: "action", act: "preload", title: "Pre-Load All Songs", icon: SI,
          sub: "Converts every song the system can't play on its own to a playable format. This is recommended before doing any music playback.",
          warn: "Warning: Once the preload starts, the system stays on this menu until the preload of all song files finishes." },
        { kind: "setting", ctl: "keepsongs", title: "Keep Pre-Loaded Songs Data", icon: SI,
          sub: "Saves the converted songs after preloading on the system's directory instead of the Windows Temp folder. This means that the converted songs get saved instead of being deleted after turning off the system. This is recommended to not have to manually preload every time you enter into the system." },
        { kind: "setting", ctl: "mpvisualizer", title: "Music Player Visualizer", icon: SI,
          sub: "On: The Music Player shows the Visualizer wave instead of the current background." },
      ],
      "Power Save Settings": [
        { kind: "setting", ctl: "lowpower", title: "Low Performance Mode", icon: SI,
          sub: "On: When the system is out of focus, everything on screen stops." },
        { kind: "setting", ctl: "stillwaves", title: "Still Wave and Sparkles", icon: SI,
          sub: "This gives a performance boost to slower computers." },
        { kind: "setting", ctl: "menublur", title: "Menu Blur", icon: SI,
          sub: "Off gives a performance boost to slower computers." },
      ],
      "Accessory Settings": [
        { kind: "setting", ctl: "vkb", title: "On-Screen Keyboard", icon: SI },
      ],
      "Date and Time Settings": [
        { kind: "setting", ctl: "dateformat", title: "Date Format", icon: SI,
          sub: "Sets the order of display for year, month and day." },
        { kind: "setting", ctl: "timeformat", title: "Time Format", icon: SI,
          sub: "Sets the time display to either a 12-hour or 24-hour clock." },
      ],
      "Display Settings": [
        { kind: "setting", ctl: "resolution", title: "Resolution", icon: SI },
        { kind: "setting", ctl: "fullscreen", title: "Full Screen", icon: SI },
        { kind: "setting", ctl: "brightness", title: "Brightness", icon: SI },
        { kind: "setting", ctl: "fpscap", title: "Framerate", icon: SI },
        { kind: "setting", ctl: "vsync", title: "VSync", icon: SI, sub: "Helps prevent screen tearing." },
      ],
      "System Settings": [
        { kind: "setting", ctl: "autostart", title: "Start at Windows Startup", icon: SI },
        { kind: "setting", ctl: "boot", title: "Boot Intro", icon: SI },
        { kind: "setting", ctl: "bootlook", title: "Keep Personalization Options when Booting", icon: SI,
          sub: "On: The intro and Log In screen use the last personalization options used on the system." },
        { kind: "drill", title: "Media Folders", icon: SI,
          sub: "Choose the folders from where the system recognizes media files.",
          childrenFn: this._mediaFolderItems },
        { kind: "drill", title: "Sections", icon: SI, sub: "Create and edit your own sections.",
          childrenFn: this._sectionsMenuItems },
        { kind: "drill", title: "Cache Management", icon: SI,
          sub: "Decide to either store the cache on the system's directory or in the Windows Temp folder.",
          childrenFn: this._cacheManagementItems },
        { kind: "setting", ctl: "deltemp", title: "Delete Temporary Files", icon: SI,
          sub: "On: The system automatically deletes every cached file created on the Windows Temp folder when the system turns off. Cache saved in the system's directory doesn't get deleted." },
        { kind: "action", act: "keybinds", title: "Change Keybinds", icon: SI },
        { kind: "setting", ctl: "sysinfo", title: "System Information", icon: SI },
      ],
    };
    // Descriptions shown under the selected item (match the real XMB wording).
    const descs = {
      "System Update": "Updates the system software on this system.",
      "Game Settings": "Adjusts settings for games.",
      "Video Settings": "Adjusts settings for video.",
      "Music Settings": "Adjusts settings for music.",
      "Chat Settings": "Adjusts settings for chat.",
      "System Settings": "Adjusts settings for this PS3™ system.",
      "Theme Settings": "Adjusts settings related to the appearance of the XMB™ screen.",
      "Date and Time Settings": "Adjusts date and time settings.",
      "Power Save Settings": "Adjusts settings to reduce power usage by this system.",
      "Accessory Settings": "Adjusts settings for accessories that are connected to this system.",
      "Printer Settings": "Adjusts settings for printers that are connected to this system.",
      "Display Settings": "Adjusts settings for video output.",
      "Sound Settings": "Adjusts settings for audio output.",
      "Security Settings": "Adjusts parental control settings.",
      "Remote Play Settings": "Adjusts settings for remote play. Remote play enables you to use a device that supports remote play (such as a PS Vita or a PSP™ system) to operate this system over a network.",
      "Network Settings": "Adjusts settings for the Internet connection.",
    };
    return names.map(([label, icon]) => drills[label]
      ? { kind: "drill", title: label, sub: descs[label], icon: { sys: icon }, children: drills[label] }
      : { kind: "ph", title: label, sub: descs[label], icon: { sys: icon } });
  },

  // Theme Settings > Icons > Intro Icon / Intro Title: your own picture in
  // place of the PlayStation mark / the "PlayStation 3" title of the Boot Intro
  _introArtSub(which) {
    return which === "icon" ? "Select a photo to replace the Playstation icon in the intro."
      : "Select a photo to replace the \"Playstation 3\" title in the intro.";
  },
  async _introArtMenu(which) {
    const key = which === "icon" ? "introIcon" : "introTitle";
    const title = which === "icon" ? "Intro Icon" : "Intro Title";
    const exts = ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"];
    const ext = (p) => (/\.([a-z0-9]+)$/i.exec(p || "") || [])[1]?.toLowerCase() || "";
    let files = [];
    try { files = await call("list_media", { kind: "photo" }); } catch (e) {}
    const seen = new Set();
    files = (files || []).filter((f) => f && f.path && exts.includes(ext(f.path)) && !seen.has(f.path) && seen.add(f.path))
      .sort((a, b) => cmpNatural(noExt(a.path.split(/[\\/]/).pop()), noExt(b.path.split(/[\\/]/).pop())));
    const cur = this.settings?.behavior?.[key];
    const items = [
      ...(cur ? [{ label: "Default", id: "__none__" }] : []),
      ...(files.length ? [{ label: "From the Photos Folder\u2026", id: "__grid__" }] : []),
      { label: "Choose File\u2026", id: "__pick__" },
    ];
    const apply = (path) => {
      this.settings.behavior = this.settings.behavior || {};
      if (path) this.settings.behavior[key] = path; else delete this.settings.behavior[key];
      this._persistSettings();
      this.audio.play(path ? "enter" : "back", 0.5);
      this._render(this.root.clientWidth, this.root.clientHeight); this._onSelect();
    };
    this.overlay = this.sideMenu;
    this.sideMenu.open(items, { title }, async (ch) => {
      this.sideMenu.close(); this.overlay = null;
      if (ch.id === "__none__") { apply(null); return; }
      if (ch.id === "__grid__") {
        const gi = files.map((f) => ({ label: noExt(f.title || f.path.split(/[\\/]/).pop()), id: f.path, thumb: stillUrl(f.path, f.cover) }));
        this.overlay = this.listPicker;
        this.listPicker.open({ title, items: gi, grid: true, submit: "Select" }, (it) => {
          this.listPicker.close(); this.overlay = null;
          if (it && it.id) apply(it.id);
        }, () => { this.listPicker.close(); this.overlay = null; this._introArtMenu(which); });
        return;
      }
      let path = null;
      try { path = await call("pick_file", { title: `Choose the ${title}`, name: title, exts }); } catch (e) { path = null; }
      if (path) apply(path);
    }, () => { this.sideMenu.close(); this.overlay = null; });
  },

  // ---- Cache Management submenu ---------------------------------------------
  _cacheManagementItems() {
    const SI = { sys: "icon_setting_item.png" };
    return [
      { kind: "setting", ctl: "cacheapp", title: "Save Cache in System Directory", icon: SI,
        sub: "On: All cache gets saved on the system's directory so next time the system turns on everything loads right away." },
      { kind: "action", act: "cache_clear::thumbs", title: "Delete Photo Thumbnails", icon: SI },
      { kind: "action", act: "cache_clear::covers", title: "Delete Song Covers", icon: SI },
      { kind: "action", act: "cache_clear::videos", title: "Delete Preloaded Videos Data", icon: SI },
      { kind: "action", act: "cache_clear::decoded", title: "Delete Preloaded Songs Data", icon: SI },
      { kind: "action", act: "cache_clear::icons", title: "Delete Icon Shading", icon: SI },
      { kind: "action", act: "cache_clear::wave", title: "Delete Wave Cache", icon: SI },
      { kind: "action", act: "cache_clear::visualizers", title: "Delete Visualizers Cache", icon: SI },
      { kind: "action", act: "cache_clear::trophies", title: "Delete Trophy Cache", icon: SI },
      { kind: "action", act: "cache_clear::steam", title: "Delete Steam Cache", icon: SI },
      { kind: "action", act: "cache_clear::all", title: "Delete All Cache", icon: SI },
    ];
  },
  _clearCache(category) {
    const names = { all: "all cached data", decoded: "the preloaded songs data", covers: "the song covers", icons: "the icon shading", videos: "the preloaded videos data", thumbs: "the photo thumbnails", wave: "the wave cache", visualizers: "the visualizers cache",
      trophies: "the trophy cache", steam: "the Steam cache" };
    this.overlay = this.confirm;
    this.confirm.open(
      `Delete ${names[category] || "this cache"}?`,
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      (choice) => {
        this.confirm.close(); this.overlay = null;
        if (choice && choice.id === "yes") this._runLocked(`cache_clear::${category}`, "Deleting...", async (title) => {
          // (the song covers are read again from the songs straight after)
          if (category === "covers" || category === "all") setTimeout(() => { if (this._preloadState === "loading") title("Reading song covers..."); }, 0);
          await call("clear_cache", { category }).catch(() => {});
          await this._afterCacheCleared(category);
        }).then(() => {
          // (the trophies read again at once, on the sync screen, so the trophy level is right again)
          if ((category === "trophies" || category === "all") && this.user && this._trophySync) this._trophySync(null);
        });
      },
      () => { this.confirm.close(); this.overlay = null; });
  },
  // Everything that used what was deleted works again at once (no restart):
  // the song lists get their newly read covers, a background / overlay video
  // that played from a converted copy is converted again, the songs decoded
  // for playing are decoded again when needed, the icons shaded again
  async _afterCacheCleared(category) {
    const all = category === "all";
    // (nothing is converted / decoded again by itself: only when you ask for
    // it, with Preload All Videos / Songs or by choosing that background again)
    if (all || category === "videos") { this._vplay = new Map(); this._noAutoConvert = true; this._applyWallpaper(); }
    if (all || category === "decoded") { this._decoded = {}; this._applyBgMusic(true); }
    if (all || category === "covers" || category === "thumbs") { try { await this._refreshMediaColumns(undefined, true); } catch (e) {} }
    // (the wave's prepared start is made again, and saved, at its next start)
    if (all || category === "wave") forgetWaveCache();
    if (all || category === "visualizers") this.musicPlayer.freeVisuals();
    // (Trophy Collection: nothing kept of it in memory either; read again straight after)
    if (all || category === "trophies") { this._tSets = null; this._tUser = null; }
    // (Steam Friends and the account's picture: read again from Steam)
    if (all || category === "steam") { if (this._steamCacheCleared) await this._steamCacheCleared(); }
    if (all || category === "icons") {
      // (the pictures in memory too, and every icon shaded again from nothing)
      clearShades();
      for (const el of document.querySelectorAll(".sysicon[data-xs]")) { delete el.dataset.xs; if (el.__lg) glassLayer().detach(el); }
      if (this._glassOn) glassLayer().forgetMaps();
      this._xsPreDone = null; this._applyXmbwShading();
    }
  },
  _ctlValue(ctl) {
    if (ctl && ctl.startsWith("gm:")) return this._gmValue(ctl);
    if (ctl && ctl.startsWith("gmf:")) return this._gmfValue(ctl);
    if (ctl && ctl.startsWith("secft:")) return this._secftValue(ctl);
    if (ctl && ctl.startsWith("secfx:")) return this._secfxValue(ctl);
    if (ctl && ctl.startsWith("tho:")) return this._thoGet(ctl) ? "On" : "Off";
    if (ctl && ctl.startsWith("wp:")) {
      const m = this._waveParamMeta(ctl); if (!m) return "";
      if (m.labels) return m.labels[Math.round(this._waveParamValue(ctl))] || m.labels[0];
      return this._waveParamValue(ctl).toFixed(m.dec);
    }
    const u = this.user, s = this.settings;
    switch (ctl) {
      case "bgcolor": return colorName(this._tcol("backgroundColor"), true);
      case "foldercolor": return colorName(this._tcol("folderColor"), true);
      case "font": { const f = u?.theme?.font; return f ? String(f).split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : "Default"; }
      case "fontsize": return `${u?.theme?.fontSize ?? 100}%`;
      case "textcolor": return colorName(u?.theme?.textColor, true);
      case "clockcolor": return colorName(u?.theme?.clockColor, true);
      case "clockiconcolor": return colorName(u?.theme?.clockIconColor, true);
      case "bgshuffle": case "ovshuffle": { const v = u?.theme?.[ctl === "bgshuffle" ? "bgShuffle" : "ovShuffle"] || "off";
        return v === "off" ? "Off" : v === "all" ? "All" : `Playlist: ${v.slice(3)}`; }
      case "bginterval": return fmtSecs(u?.theme?.bgInterval || 10);
      case "ovinterval": return fmtSecs(u?.theme?.ovInterval || u?.theme?.bgInterval || 10);
      case "bgfit": return (FIT_MODES.find((f) => f[0] === (u?.theme?.wallpaperFit || "normal")) || FIT_MODES[0])[1];
      case "chromakey": { const k = String(u?.theme?.chromaKey || "green").toLowerCase();
        return k === "green" ? "Green" : k === "blue" ? "Blue" : "Custom Color"; }
      case "iconcolor": return colorName(u?.theme?.iconColor, true);
      case "iconcoloron": return u?.theme?.iconColorAll === false ? "Off" : "On";
      case "foldercoloron": return u?.theme?.folderColorAll === false ? "Off" : "On";
      case "ibshadow": return u?.theme?.infoShadow === false ? "Off" : "On";
      case "clockshadow": return u?.theme?.clockShadow === false ? "Off" : "On";
      case "waves": return u?.theme?.[this._wk("wavesEnabled")] === false ? "Off" : "On";
      case "monthcolors": return u?.theme?.[this._wk("monthColors")] === false ? "Off" : "On";
      case "wavestyle": return this._waveEngine() === "linkev" ? "linkev" : (this.wave.originalFailReason && this.wave.originalFailReason() ? "Original (unavailable: linkev shown)" : "Original");
      case "wavecolor": return colorName(this._tcol(this._wk("waveColor")), true);
      case "dots": return u?.theme?.[this._wk("dotsEnabled")] === false ? "Off" : "On";
      case "dotcolor": return colorName(this._tcol(this._wk("dotColor")), true);
      case "sfx": return u?.soundEnabled === false ? "Off" : "On";
      case "bgaudio": return s?.behavior?.playAudioBackground === false ? "Off" : "On";
      case "keepsongs": return s?.behavior?.keepPreloadedSongs ? "On" : "Off";
      case "mpvisualizer": return s?.behavior?.mpVisualizer === false ? "Off" : "On";
      case "gamenotitle": return s?.behavior?.gameHideTitle ? "On" : "Off";
      case "gameband": return s?.behavior?.gameBand === false ? "Off" : "On";
      case "keepvideos": return s?.behavior?.keepPreloadedVideos ? "On" : "Off";
      case "deltemp": return s?.behavior?.deleteTempFiles ? "On" : "Off";
      case "cacheapp": return s?.behavior?.cacheInAppDir ? "On" : "Off";
      case "friendmode": { const m = this._friendCfg().mode; return m === "fixed" ? "Fixed" : m === "range" ? "Range" : "Randomized"; }
      case "friendcount": return String(this._friendCfg().count);
      case "psplus": return this._friendCfg().playerPlus ? "On" : "Off";
      case "friendmin": return String(this._friendCfg().min);
      case "friendmax": return String(this._friendCfg().max);
      case "music": return u?.musicEnabled === false ? "Off" : "On";
      case "fullscreen": return s?.behavior?.fullscreen ? "On" : "Off";
      case "autostart": return s?.behavior?.autostart ? "On" : "Off";
      case "boot": return s?.behavior?.bootAnimation ? "On" : "Off";
      case "bootlook": return s?.behavior?.keepBootLook === false ? "Off" : "On";
      case "startsound": return s?.behavior?.startupSound === false ? "Off" : "On";
      case "bufsound": return s?.behavior?.bufferingSound === true ? "On" : "Off";
      case "volume": return `${s?.behavior?.volume ?? 100}%`;
      case "musicvol": return `${s?.behavior?.musicVolume ?? 100}%`;
      case "sfxvol": return `${s?.behavior?.sfxVolume ?? 100}%`;
      case "bufvol": return `${s?.behavior?.bufferingVolume ?? 15}%`;
      case "brightness": return `${s?.behavior?.brightness ?? 100}%`;
      case "chroma": return (u?.theme?.chromaStrength ?? 0.5).toFixed(2);
      case "vsync": return s?.behavior?.vsync === false ? "Off" : "On";
      case "fpscap": return fpsCapLabel(s?.behavior?.fpsCap);
      case "stillwaves": return s?.behavior?.stillWaves ? "On" : "Off";
      case "menublur": return MENU_BLUR.find((m) => m[0] === menuBlurOf(s?.behavior))[1];
      case "lowpower": return s?.behavior?.lowPowerMode ? "On" : "Off";
      case "vkb": return s?.behavior?.virtualKeyboard === false ? "Off" : "On";
      case "iconstyle": return Object.fromEntries(ICON_STYLES)[this._iconStyle()];
      case "reactivebg": return u?.theme?.reactiveBackdrop ? "On" : "Off";
      case "themefolders": return u?.theme?.themeFolders ? "On" : "Off";
      case "resolution": { const r = s?.behavior?.resolution || "native"; return r === "native" ? "Native" : r.replace("x", " × "); }
      case "psnstyle": return u?.theme?.psnStyle === "modern" ? "Modern Version" : "Original Version";
      case "homestyle": return u?.theme?.homeStyle === "modern" ? "Modern Version" : "Original Version";
      case "timeformat": return (s?.behavior?.timeFormat || "24") === "12" ? "12-Hour Clock" : "24-Hour Clock";
      case "dateformat": return s?.behavior?.dateFormat || "DD/MM/YYYY";
      case "sysinfo": return `v${this.appInfo?.version || "?"}\nMade by Maxi Bono`;
      // Intro Icon / Intro Title: the picture's file name, or Default
      case "introicon": case "introtitle": {
        const p = s?.behavior?.[ctl === "introicon" ? "introIcon" : "introTitle"];
        return p ? String(p).split(/[\\/]/).pop() : "Default";
      }
      // Connect with Steam Friends (steamfriends.js)
      default: return ctl.startsWith("sf:") ? this._sfValue(ctl) : ctl.startsWith("ag:") ? this._agValue(ctl) : "";
    }
  },
  _toggleSetting(it) {
    const u = this.user, s = this.settings;
    if (it.ctl && it.ctl.startsWith("wp:")) { this._adjustWaveParam(it, 1); return; }
    if (it.ctl && it.ctl.startsWith("gm:")) { this._gmEdit(it.ctl); return; }
    if (it.ctl && it.ctl.startsWith("gmf:")) { this._gmfAdjust(it.ctl, 1); return; }
    if (it.ctl && it.ctl.startsWith("secft:")) { this._secftAdjust(it.ctl, 1); return; }
    if (it.ctl && it.ctl.startsWith("secfx:")) { this._secfxToggle(it.ctl); return; }
    if (it.ctl && it.ctl.startsWith("tho:")) { this._thoToggle(it.ctl); return; }
    if (it.ctl && it.ctl.startsWith("sf:")) { this._sfToggle(it.ctl); return; }
    if (it.ctl && it.ctl.startsWith("ag:")) { this._agToggle(it.ctl); return; }
    switch (it.ctl) {
      case "bgcolor": case "iconcolor": case "wavecolor": case "dotcolor": case "chromakey": case "foldercolor": this._cycleColor(it, 1); return;
      case "bgfit": this._cycleBgFit(1); return;
      case "font": this._fontMenu(); return;
      case "fontsize": this._adjustFontSize(1); return;
      case "textcolor": case "clockcolor": case "clockiconcolor": this._cycleColor(it, 1); return;
      case "bgshuffle": case "ovshuffle": this._cycleShuffle(it.ctl, 1); return;
      case "bginterval": case "ovinterval": this._typeInterval(it); return;
      case "monthcolors": { const k = this._wk("monthColors"); u.theme[k] = u.theme[k] === false; this.wave.setMonthMode(u.theme[k]); this._persistUser(); break; }
      case "wavestyle": {
        u.theme.waveEngine = this._waveEngine() === "linkev" ? "original" : "linkev";
        // (the system starts with the Wave Style chosen last: this computer's setting)
        (this.settings.graphics ||= {}).waveStyle = u.theme.waveEngine; this._persistSettings();
        // (Original chosen by hand: tried again, even if it couldn't run before)
        if (u.theme.waveEngine === "original" && this.wave.retryOriginal) this.wave.retryOriginal();
        this._applyWaveStyle(); this._applyWallpaper(); this._persistUser(); break;
      }
      case "waves": { const k = this._wk("wavesEnabled"); u.theme[k] = u.theme[k] === false; this._applyWaveLook(); this._persistUser(); break; }
      case "dots": { const k = this._wk("dotsEnabled"); u.theme[k] = u.theme[k] === false; this._applyWaveLook(); this._persistUser(); break; }
      case "sfx": u.soundEnabled = u.soundEnabled === false; this.audio.enabled = u.soundEnabled; this._persistUser(); break;
      case "bgaudio": s.behavior.playAudioBackground = s.behavior.playAudioBackground === false; this.audio.playInBackground = s.behavior.playAudioBackground; this._persistSettings(); break;
      case "keepsongs": s.behavior.keepPreloadedSongs = !s.behavior.keepPreloadedSongs; this._persistSettings(); break;
      case "mpvisualizer": s.behavior.mpVisualizer = s.behavior.mpVisualizer === false; this._persistSettings(); this._syncVisualizer(); break;
      case "iconcoloron": {
        u.theme.iconColorAll = u.theme.iconColorAll === false; this._persistUser();
        __set_PLAYER_OWN(this.user?.theme?.iconColorAll === false); applyIconColorVar(this._pickHex());
        this._runLocked("theme", "Please wait...", () => this._applyThemes(true).catch((e) => console.warn("theme", e)))
          .then(() => this._layoutItems(this.root.clientWidth, this.root.clientHeight));
        break;
      }
      // Folder Color: Off, every folder in its own colours (Folder Color Pick not used)
      case "foldercoloron": u.theme.folderColorAll = u.theme.folderColorAll === false; this._persistUser(); this._applyFolderColor(); break;
      // the info box's shadows: the date, time and friends' count's, and the clock's (On by default)
      case "ibshadow": u.theme.infoShadow = u.theme.infoShadow === false; this._persistUser(); this._applyTextLook(); break;
      case "clockshadow": u.theme.clockShadow = u.theme.clockShadow === false; this._persistUser(); this._applyTextLook(); break;
      case "gamenotitle": s.behavior.gameHideTitle = !s.behavior.gameHideTitle; this._persistSettings(); this._render(); this._onSelect(); break;
      case "gameband": s.behavior.gameBand = s.behavior.gameBand === false; this._persistSettings(); this._render(); this._onSelect(); break;
      case "keepvideos": s.behavior.keepPreloadedVideos = !s.behavior.keepPreloadedVideos; this._persistSettings(); break;
      case "deltemp": s.behavior.deleteTempFiles = !s.behavior.deleteTempFiles; this._persistSettings(); break;
      case "cacheapp": s.behavior.cacheInAppDir = !s.behavior.cacheInAppDir;
        // (the Wave Cache saved again in its new place; the Visualizers Cache let go when it's no longer kept)
        this._persistSettings().then(() => moveWaveCache());
        if (!s.behavior.cacheInAppDir) this.musicPlayer.freeVisuals();
        break;
      case "music": u.musicEnabled = u.musicEnabled === false; this.audio.musicEnabled = u.musicEnabled; this._applyBgMusic(); this._persistUser(); break;
      case "fullscreen": s.behavior.fullscreen = !s.behavior.fullscreen; call("set_fullscreen", { enable: s.behavior.fullscreen }); this.cbs.onFullscreen && this.cbs.onFullscreen(s.behavior.fullscreen); this._persistSettings();
        setTimeout(() => this._applyResolution(), 350); break;
      case "resolution": this._cycleResolution(1); return;
      case "iconstyle": this._cycleIconStyle(1); return;
      case "reactivebg": u.theme.reactiveBackdrop = !u.theme.reactiveBackdrop; this._persistUser(); glassLayer().setBackdrop(u.theme.reactiveBackdrop); break;
      // (the folders drawn again with their pictures)
      case "themefolders": u.theme.themeFolders = !u.theme.themeFolders; this._persistUser(); this._runLocked("theme", "Please wait...", () => this._applyThemes(true).catch((e) => console.warn("theme", e))); break;
      case "lowpower": s.behavior.lowPowerMode = !s.behavior.lowPowerMode; this._persistSettings();
        { const lvl = this._inGame ? 2 : (document.hasFocus() ? 0 : 1); this._lowPower = -1; this.setLowPower(lvl); } break;
      case "vkb": s.behavior.virtualKeyboard = s.behavior.virtualKeyboard === false; VIRTUAL_KB.on = s.behavior.virtualKeyboard; this._persistSettings(); break;
      case "autostart": s.behavior.autostart = !s.behavior.autostart; call("set_autostart", { enable: s.behavior.autostart }); this._persistSettings(); break;
      case "boot": s.behavior.bootAnimation = !s.behavior.bootAnimation; this._persistSettings(); break;
      case "bootlook": s.behavior.keepBootLook = s.behavior.keepBootLook === false; this._persistSettings(); break;
      case "startsound": s.behavior.startupSound = s.behavior.startupSound === false; this._persistSettings(); break;
      case "bufsound": s.behavior.bufferingSound = s.behavior.bufferingSound !== true; this.audio.setBuffering(s.behavior.bufferingSound); this._persistSettings(); break;
      case "psplus": {   // the player's own PS Plus mark (card + info box); friends stay as they are
        const c = this._friendCfg(); c.playerPlus = !c.playerPlus; u.friendConfig = c; this._persistUser();
        this.audio.play("enter", 0.4); break;
      }
      case "volume": this._adjustVolume(1); return;
      case "musicvol": this._adjustMusicVol(1); return;
      case "sfxvol": this._adjustSfxVol(1); return;
      case "bufvol": this._adjustBufVol(1); return;
      case "brightness": this._adjustBrightness(1); return;
      case "chroma": this._adjustChroma(1); return;
      case "vsync": s.behavior.vsync = s.behavior.vsync === false; this._persistSettings(); this._applyVsync(); break;
      case "fpscap": { const i = FPS_CAPS.indexOf(fpsCapOf(s.behavior.fpsCap));
        s.behavior.fpsCap = FPS_CAPS[(i + 1) % FPS_CAPS.length]; this._persistSettings(); this._applyPerformance(); break; }
      case "stillwaves": s.behavior.stillWaves = !s.behavior.stillWaves; this._persistSettings(); this._applyPerformance(); break;
      case "menublur": { const i = MENU_BLUR.findIndex((m) => m[0] === menuBlurOf(s.behavior));
        this._setMenuBlur(MENU_BLUR[(i + 1) % MENU_BLUR.length][0]); break; }
      case "psnstyle": u.theme.psnStyle = u.theme.psnStyle === "modern" ? "original" : "modern"; this._persistUser(); this._applyPsnStyle(); break;
      case "homestyle": u.theme.homeStyle = u.theme.homeStyle === "modern" ? "original" : "modern"; this._persistUser(); this._applyHomeStyle(); break;
      case "friendmode": this._adjustFriendSetting(it.ctl, 1); return;
      case "friendcount": case "friendmin": case "friendmax": this._typeFriendNumber(it); return;
      case "timeformat": s.behavior.timeFormat = (s.behavior.timeFormat || "24") === "12" ? "24" : "12"; this.cbs.onTimeFormat && this.cbs.onTimeFormat(s.behavior.timeFormat); this._persistSettings(); break;
      case "dateformat": {
        const opts = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD"];
        const i = (opts.indexOf(s.behavior.dateFormat || "DD/MM/YYYY") + 1) % opts.length;
        s.behavior.dateFormat = opts[i]; this.cbs.onDateFormat && this.cbs.onDateFormat(s.behavior.dateFormat); this._persistSettings(); break;
      }
      case "sysinfo": return;
    }
    this.audio.play("enter", 0.4);
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  // ---- every setting is changed from its option (△) menu ------------------
  // ✕ or △ on a setting opens the PS3 option menu down the right: its choices
  // with the current one highlighted; a number gets one row that up / down
  // change (○ puts it back); a typed value gets one row with the value, ✕ types.
  _settingMenu(it) {
    const ctl = it.ctl || "";
    if (ctl === "sysinfo") { this.audio.play("error", 0.4); return; }
    if (ctl === "font") { this._fontMenu(); return; }
    if (ctl === "introicon" || ctl === "introtitle") { this._introArtMenu(ctl === "introicon" ? "icon" : "title"); return; }
    const close = () => { this.sideMenu.close(); this.overlay = null; };
    const relayout = () => this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    const num = this._settingNumber(ctl);
    if (num) {
      const before = num.get();
      this.overlay = this.sideMenu;
      this.sideMenu.open([{ label: "" }], { title: it.title, spin: { label: () => this._ctlValue(ctl), step: (d) => num.step(d),
          // the arrow on a side disappears at the minimum / maximum
          canUp: () => num.max == null || num.get() < num.max - 1e-9, canDown: () => num.min == null || num.get() > num.min + 1e-9 } },
        () => { close(); relayout(); },
        () => { close(); if (num.get() !== before) { num.set(before); } relayout(); });
      return;
    }
    const ch = this._settingChoices(it);
    if (ch) {
      this.overlay = this.sideMenu;
      this.sideMenu.open(ch.items.map((c) => ({ label: c.label, swatch: c.swatch })), { title: it.title, sel: Math.max(0, ch.cur), swatches: !!ch.swatches },
        (_c, i) => { close(); const c = ch.items[i]; if (c && i !== ch.cur || c && c.always) c.apply(); relayout(); },
        () => close());
      return;
    }
    // typed values (Title, Created, Picture Duration, number of friends…):
    // the current value, then "Custom …" at the bottom to type a new one
    const what = this._customWhat(ctl), cur = this._ctlValue(ctl);
    const rows = (cur && cur !== "-") ? [{ label: cur, keep: true }] : [];
    rows.push({ label: `Custom ${what}\u2026` });
    this.overlay = this.sideMenu;
    this.sideMenu.open(rows, { title: it.title },
      (c) => { close(); if (!c.keep) this._toggleSetting(it); }, () => close());
  },
  // what a typed setting's "Custom …" option asks for
  _customWhat(ctl) {
    const k = ctl.startsWith("gm:") ? (this._gmParse(ctl) || {}).key : ctl;
    return { title: "Title", created: "Date", starts: "Date", size: "Size", version: "Version", bginterval: "Duration",
      friendcount: "Number", friendmin: "Number", friendmax: "Number" }[k] || "Value";
  },
  // a Console typed in (any name; one that isn't in the list gets the blank
  // badge with its name written on)
  _askConsole(title, cur, done) {
    this.overlay = this.textForm;
    this.textForm.open({ title: `${title}: Custom Console`, fields: [{ key: "c", label: "Console", value: cur && !CONSOLES.includes(cur) ? cur : "", required: true }], submit: "Confirm" },
      (out) => { this.textForm.close(); this.overlay = null; const v = String(out.c || "").trim(); if (v) done(v); },
      () => { this.textForm.close(); this.overlay = null; });
  },
  _consoleChoices(title, cur, set) {
    const names = [...CONSOLES];
    if (cur && cur !== "Mixed" && cur !== "-" && !names.includes(cur)) names.push(cur);   // a typed-in one stays a choice
    const items = names.map((c) => ({ label: c, apply: () => set(c) }));
    items.push({ label: "Custom Console\u2026", always: true, apply: () => this._askConsole(title, cur, set) });
    return { items, cur: names.indexOf(cur) };
  },
  // number settings: { get, set, step }
  _settingNumber(ctl) {
    const b = this.settings?.behavior || {}, t = this.user?.theme || {};
    const beh = (key, def, apply) => ({ min: 0, max: 100, get: () => b[key] ?? def, set: (v) => { b[key] = v; apply && apply(v); this._persistSettings(); } });
    switch (ctl) {
      case "volume": return { ...beh("volume", 100, (v) => this.audio.setMasterVolume(v / 100)), step: (d) => this._adjustVolume(d) };
      case "musicvol": return { ...beh("musicVolume", 100, (v) => this.audio.setMusicVolume(v / 100)), step: (d) => this._adjustMusicVol(d) };
      case "sfxvol": return { ...beh("sfxVolume", 100, (v) => this.audio.setSfxVolume(v / 100)), step: (d) => this._adjustSfxVol(d) };
      case "bufvol": return { ...beh("bufferingVolume", 15, (v) => this.audio.setBufferingVolume(v / 100)), step: (d) => this._adjustBufVol(d) };
      case "brightness": return { ...beh("brightness", 100, (v) => this._applyBrightness(v)), step: (d) => this._adjustBrightness(d) };
      case "chroma": return { min: 0, max: 1, get: () => t.chromaStrength ?? 0.5, set: (v) => { t.chromaStrength = v; this._applyWallpaper(); this._persistUser(); }, step: (d) => this._adjustChroma(d) };
      case "fontsize": return { min: 0, max: 300, get: () => t.fontSize ?? 100, set: (v) => { t.fontSize = v; this._persistUser(); this._applyTextLook(); }, step: (d) => this._adjustFontSize(d) };
    }
    if (ctl.startsWith("wp:")) {
      const m = this._waveParamMeta(ctl); if (!m || m.labels) return null;
      return { min: m.min, max: m.max, get: () => this._waveParamValue(ctl),
        set: (v) => { (t.waveParams ||= {})[`${m.group}:${m.key}`] = v; this.wave.setWaveParam(m.group, m.key, v); this._persistUser(); },
        step: (d) => this._adjustWaveParam({ ctl }, d) };
    }
    return null;
  },
  // option lists: { items: [{ label, apply, always? }], cur }
  _settingChoices(it) {
    const ctl = it.ctl || "", u = this.user, s = this.settings, b = s?.behavior || {}, t = u?.theme || {};
    const cur = this._ctlValue(ctl);
    const list = (pairs, now, set) => ({ items: pairs.map(([id, label]) => ({ label, apply: () => set(id) })), cur: pairs.findIndex((p) => p[0] === now) });
    // the colour settings: the named colours, the last custom colour, the colour wheel
    if (["bgcolor", "iconcolor", "wavecolor", "dotcolor", "chromakey", "textcolor", "clockcolor", "clockiconcolor", "foldercolor"].includes(ctl)) {
      const isKey = ctl === "chromakey", prop = this._themeColorProp(ctl), saved = this._savedCustom(ctl);
      // (a PS3 theme's Theme Color in use: shown as the current one where it applies)
      const themed = this._themeColor != null && THEME_COLOR_CTLS.includes(ctl);
      const now = String((themed ? this._themeColor : t[prop]) || (isKey ? "green" : "auto")).toLowerCase();
      const items = colorListFor(ctl).map((c) => ({ label: c.name, hex: c.hex, swatch: c.swatch }));
      if (themed && !items.some((c) => String(c.hex).toLowerCase() === now))
        items.unshift({ label: `Theme Color (${now.toUpperCase()})`, hex: now });
      if (saved && !items.some((c) => String(c.hex).toLowerCase() === String(saved).toLowerCase()))
        items.push({ label: `Custom Color (${String(saved).toUpperCase()})`, hex: saved });
      // Background Color: the console's Color menu (Original, then the colour
      // squares; Custom Color… at the end); the others by name
      const sq = SQUARE_CTLS.includes(ctl);
      const out = items.map((c) => ({ label: c.label, swatch: sq && c.hex !== "auto" && c.hex !== "visualizer" ? (c.swatch || c.hex) : null,
        apply: () => { this.audio.play("cursor_up", 0.4); this._applyThemeColor(ctl, c.hex); this._persistUser(); } }));
      out.push({ label: "Custom Color…", always: true, apply: () => this._customColor(it, t[prop]) });
      return { items: out, cur: items.findIndex((c) => String(c.hex).toLowerCase() === now), swatches: sq };
    }
    if (ctl.startsWith("wp:")) {
      const m = this._waveParamMeta(ctl);
      if (m && m.labels) return list(m.labels.map((l, i) => [i, l]), Math.round(this._waveParamValue(ctl)),
        (v) => { (t.waveParams ||= {})[`${m.group}:${m.key}`] = v; this.wave.setWaveParam(m.group, m.key, v); this._persistUser(); });
    }
    if (ctl.startsWith("gmf:")) return this._consoleChoices(it.title, cur, (v) => this._gmfSet(ctl, v));
    if (ctl.startsWith("secft:")) return this._secftChoices(ctl);
    if (ctl.startsWith("gm:")) {
      const p = this._gmParse(ctl), g = p && this._gameByFolder(p.folder);
      if (!g) return null;
      if (p.key === "console") return this._consoleChoices(gameName(g), g.console || "PS3", (v) => { g.console = v; this._gmSave(g.folder, { console: v }); });
      if (p.key === "parentalControl") return list([[0, "-"], ...Array.from({ length: 11 }, (_, i) => [i + 1, `Level ${i + 1}`])], g.parentalControl || 0,
        (v) => { g.parentalControl = v || null; this._gmSave(g.folder, { parentalControl: v || null }); });
      if (!["isDisc", "optionsBand", "hideTitle", "trophies"].includes(p.key)) return null;
    }
    // On / Off and the other two-way settings flip when the other one is chosen
    // (settings with a list of their own that can read "Off" aren't two-way)
    // (options with a list of their own, whatever their value says: Menu Blur's "Off" is one of three)
    const listed = ["bgshuffle", "ovshuffle", "menublur"].includes(ctl);
    if (ctl === "wavestyle") return { items: [["original", "Original"], ["linkev", "linkev"]].map(([id, label]) => ({ label, apply: () => {
        if (this._waveEngine() !== id) this._toggleSetting(it);
        // (Original chosen again while linkev's is shown in its place: try it again)
        else if (id === "original" && this.wave.originalFailReason && this.wave.originalFailReason() && this.wave.retryOriginal) { this.wave.retryOriginal(); this._applyWaveStyle(); this._render(); this._onSelect(); }
      } })),
      cur: this._waveEngine() === "linkev" ? 1 : 0 };
    const two = { timeformat: ["12-Hour Clock", "24-Hour Clock"], psnstyle: ["Original Version", "Modern Version"], homestyle: ["Original Version", "Modern Version"] }[ctl]
      || (!listed && (cur === "On" || cur === "Off") ? ["On", "Off"] : null);
    if (two) return { items: two.map((label) => ({ label, apply: () => { if (this._ctlValue(ctl) !== label) this._toggleSetting(it); } })), cur: two.indexOf(cur) };
    switch (ctl) {
      case "dateformat": return list(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD"].map((f) => [f, f]), b.dateFormat || "DD/MM/YYYY",
        (v) => { b.dateFormat = v; this.cbs.onDateFormat && this.cbs.onDateFormat(v); this._persistSettings(); });
      case "iconstyle": return list(ICON_STYLES, this._iconStyle(),
        (v) => { t.iconStyle = v; this._persistUser(); this._rememberIconStyle(); this._applyIconStyle(); this._render(); this._onSelect(); });
      case "menublur": return list(MENU_BLUR, menuBlurOf(b), (v) => this._setMenuBlur(v));
      case "fpscap": return list(FPS_CAPS.map((c) => [c, fpsCapLabel(c)]), fpsCapOf(b.fpsCap),
        (v) => { b.fpsCap = v; this._persistSettings(); this._applyPerformance(); });
      case "resolution": return list(RESOLUTIONS.map((r) => [r, r === "native" ? "Native" : r.replace("x", " × ")]), b.resolution || "native",
        (v) => { b.resolution = v; this._persistSettings(); this._applyResolution(); });
      case "bgfit": return list(FIT_MODES.map((f) => [f[0], f[1]]), t.wallpaperFit || "normal",
        (v) => { t.wallpaperFit = v; this._persistUser(); this._fitWallpaper(); });
      case "bgshuffle": case "ovshuffle": {
        const key = ctl === "bgshuffle" ? "bgShuffle" : "ovShuffle";
        return list([["off", "Off"], ["all", "All"], ...this._bgPlaylists(ctl === "bgshuffle" ? "bg" : "ov").map((p) => [`pl:${p.name}`, `Playlist: ${p.name}`])], t[key] || "off",
          (v) => { t[key] = v; this._persistUser(); this._restartRotation(); });
      }
      case "friendmode": return list([["random", "Randomized"], ["fixed", "Fixed"], ["range", "Range"]], this._friendCfg().mode,
        (v) => { this._friendPersistCfg((c) => { c.mode = v; }); this._rebuildFriendMenuLevel(); });
    }
    return null;
  },
  // the last custom colour picked for each colour setting is remembered, so it
  // stays one of the choices after switching to a named colour
  _savedCustom(ctl) { return (this.user.theme.customColors || {})[this._ccKey(ctl)] || null; },
  _cycleColor(it, dir) {
    const u = this.user, prop = this._themeColorProp(it.ctl);
    const saved = this._savedCustom(it.ctl);
    // (Icon Color "Auto" = the PS3 look: the glass takes the theme colour)
    const isKey = it.ctl === "chromakey";
    const list = [...colorListFor(it.ctl)];
    if (saved) list.push({ name: "Custom Color", hex: saved });
    const cur = u.theme[prop];
    let i = list.findIndex((c) => String(c.hex).toLowerCase() === String(cur || (isKey ? "green" : "auto")).toLowerCase());
    if (i < 0) i = 0;
    i = (i + dir + list.length) % list.length;
    this.audio.play("cursor_up", 0.4);
    this._applyThemeColor(it.ctl, list[i].hex);
    this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _customColor(it, cur) {
    const prev = cur;
    this._wpBeforePick = this.user.theme.wallpaper;
    const start = parseColor(cur) ? cur : (this._savedCustom(it.ctl) || (it.ctl === "chromakey" ? "#00b140" : "#ffffff"));
    const back = this.overlay;
    this.overlay = this.colorPicker;
    this.colorPicker.open({ title: `${it.title}: Custom Color`, value: start,
      onPreview: (hex) => this._applyThemeColor(it.ctl, hex) },
      (hex) => { this.overlay = back; document.body.classList.remove("menu-open");
        this.user.theme.customColors = { ...(this.user.theme.customColors || {}), [this._ccKey(it.ctl)]: hex };
        this._applyThemeColor(it.ctl, hex); this._persistUser();
        this._layoutItems(this.root.clientWidth, this.root.clientHeight); },
      () => { this.overlay = back; document.body.classList.remove("menu-open");
        this.user.theme.wallpaper = this._wpBeforePick ?? this.user.theme.wallpaper;
        this._applyThemeColor(it.ctl, prev || (it.ctl === "chromakey" ? "green" : "auto"));
        this._layoutItems(this.root.clientWidth, this.root.clientHeight); });
  },
  _adjustVolume(dir) {
    const b = this.settings.behavior;
    let v = (b.volume ?? 100) + dir * holdAccel("volume", 5);
    v = Math.max(0, Math.min(100, v));
    b.volume = v; this.audio.setMasterVolume(v / 100);
    this.audio.play("cursor_up", 0.4);
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _adjustMusicVol(dir) {
    const b = this.settings.behavior;
    let v = Math.max(0, Math.min(100, (b.musicVolume ?? 100) + dir * holdAccel("musicvol", 5)));
    b.musicVolume = v; this.audio.setMusicVolume(v / 100);
    this.audio.play("cursor_up", 0.4);
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _adjustSfxVol(dir) {
    const b = this.settings.behavior;
    let v = Math.max(0, Math.min(100, (b.sfxVolume ?? 100) + dir * holdAccel("sfxvol", 5)));
    b.sfxVolume = v; this.audio.setSfxVolume(v / 100);
    this.audio.play("cursor_up", 0.4);   // preview the new SFX level
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _adjustBufVol(dir) {
    const b = this.settings.behavior;
    const v = Math.max(0, Math.min(100, (b.bufferingVolume ?? 15) + dir * holdAccel("bufvol", 1)));
    b.bufferingVolume = v; this.audio.setBufferingVolume(v / 100);
    this.audio.play("cursor_up", 0.4);
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _applyVsync() { /* applied when the app starts (webview launch flag) */ },
  // FPS Cap, Still Waves (read by the waves and a PS3 theme's animated
  // background every frame) and Remove Menu Blur
  _applyPerformance() {
    const b = this.settings?.behavior || {};
    const cap = fpsCapOf(b.fpsCap);
    window.__xmbFpsCap = cap === "display" ? 0 : +cap;
    this.wave.setStill && this.wave.setStill(!!b.stillWaves);
    // Menu Blur (styles.css: body.nomenublur = Off, body.menublur-all = All)
    const mb = menuBlurOf(b);
    document.body.classList.toggle("nomenublur", mb === "off");
    document.body.classList.toggle("menublur-all", mb === "all");
  },
  _setMenuBlur(v) {
    const b = this.settings.behavior ||= {};
    b.menuBlur = v; delete b.noMenuBlur;
    this._persistSettings(); this._applyPerformance();
  },
  _cycleResolution(dir) {
    const b = this.settings.behavior;
    const i = Math.max(0, RESOLUTIONS.indexOf(b.resolution || "native"));
    b.resolution = RESOLUTIONS[(i + dir + RESOLUTIONS.length) % RESOLUTIONS.length];
    this._persistSettings(); this._applyResolution();
    this.audio.play("cursor_up", 0.4);
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  // Full screen: the wave / sparkles render at the chosen resolution (scaled to
  // the screen). Window: the window's inside becomes that size. The layout is
  // all in screen-relative units, so proportions and spacing never change.
  _applyResolution() {
    const b = this.settings?.behavior || {};
    const m = /^(\d+)x(\d+)$/.exec(b.resolution || "");
    const fs = b.fullscreen !== false;
    const physH = Math.max(1, window.innerHeight * (window.devicePixelRatio || 1));
    window.__xmbRenderScale = fs && m ? Math.min(2, +m[2] / physH) : 0;
    window.__xmbAppResH = m ? +m[2] : physH;     // the app's resolution (Original screen mode)
    window.dispatchEvent(new Event("resize"));
    if (!fs && m) call("set_window_resolution", { width: +m[1], height: +m[2] }).catch(() => {});
  },
  _adjustBrightness(dir) {
    const b = this.settings.behavior;
    let v = Math.max(0, Math.min(100, (b.brightness ?? 100) + dir * holdAccel("brightness", 5)));
    b.brightness = v; this._applyBrightness(v);
    this.audio.play("cursor_up", 0.4);
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _applyBrightness(v) {
    const dim = document.getElementById("dim");
    if (dim) dim.style.opacity = String(Math.max(0, Math.min(1, (100 - (v ?? 100)) / 100)));
  },
  // ---- Change Keybinds
  _openKeybinds() {
    this.audio.play("enter", 0.6);
    // (the Close System key is off while keys are being chosen, so pressing it
    // to bind it doesn't close the app; back on when the menu closes)
    call("set_quit_key", { vk: 0 }).catch(() => {});
    this.overlay = this.keybindMenu;
    this.keybindMenu.open({ actions: KEY_ACTIONS, keybinds: Keybinds, labelOf: keyLabel, onChange: () => {
      this.settings.input = this.settings.input || {};
      this.settings.input.keybinds = { ...JSON.parse(JSON.stringify(Keybinds.map)), _v2: true, _v3: true };
      this._persistSettings();
      // (the Close System key stays off while the menu is open: the key just
      // pressed to bind it is still down)
      this._syncHotkeys(false);
    } }, () => {
      this.overlay = null;
      // the Close System key back on as the menu closes
      this._syncHotkeys();
    });
  },
  // the screenshot key also works while LibreWolf has focus (read by the backend);
  // the Close System key is read by the backend too (it works even if the page is stuck)
  _syncHotkeys(quitOn = true) {
    const code = Keybinds.codesFor("screenshot").map(codeToVk).find((v) => v) || 0;
    // (the next-tab key is handled inside the page by the helper)
    const tabKey = Keybinds.codesFor("brnexttab").find((c) => !/^Mouse/.test(c)) || "";
    // keys bound to controller buttons act as the controller while the browser
    // has focus: [Windows key code, KeyboardEvent code, action]
    const PAD = ["up", "down", "left", "right", "ls_up", "ls_down", "ls_left", "ls_right", "enter", "back", "options", "square",
      "select", "start", "l1", "r1", "l2", "r2", "l3", "r3"];
    const padKeys = [];
    for (const a of PAD) for (const c of Keybinds.codesFor(a)) if (!/^Mouse/.test(c) && codeToVk(c)) padKeys.push([codeToVk(c), c, a]);
    const fsKey = Keybinds.codesFor("brfullscreen").find((c) => !/^Mouse/.test(c)) || "";
    call("browser_set_hotkeys", { screenshotVk: code, tabKey, tabVk: codeToVk(tabKey), padKeys, fsVk: codeToVk(fsKey) }).catch(() => {});
    const quit = quitOn ? Keybinds.codesFor("quit").map(codeToVk).find((v) => v) || 0 : 0;
    call("set_quit_key", { vk: quit }).catch(() => {});
  },
};
