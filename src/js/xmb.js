// The XMB cross. Authentic category + sub-item structure with drill-in
// navigation (Circle backs out), flat/transparent styling, big icons, a
// Users-locked boot, right-side option menus for games/users (Reference_1),
// and a faithful PlayStation Network sign-up / sign-in flow.
//
// The XMB itself (this file): building the columns, drawing and laying out the
// rows, moving around, drilling in and out. Its other parts are mixins put on
// its prototype at the end: settings (xmb-settings.js), Icon Style and icon
// shading (xmb-iconstyle.js), themes (xmb-themes.js), background, wave and
// playlists (xmb-background.js), games (xmb-games.js), media (xmb-media.js),
// users (xmb-users.js), friends (xmb-friends.js), PlayStation®Network
// (xmb-psn.js), the Internet Browser (xmb-browser.js); sections (sections.js);
// what they share is in xmb-shared.js.
import { AvatarPicker, ColorPicker, Confirm, GameInfoPanel, KeybindMenu, ListPicker, MusicPlayer, PhotoGrid, PlaylistPicker, ProfileCard, PsnSignIn, SideMenu, TextForm, VIRTUAL_KB, avWaitCheck, holdAccel } from "./ui.js";
import { BASE_COLUMNS, CARD_COMPACT_X, CARD_X, CAT_GAP, CAT_GAP_SEL, CAT_SEL_Y, CAT_Y, DISC_HOLD_MS, DWELL_MS, GAME_PITCH, GHOST_DX, GRID_BOX, GRID_BOX_SEL, GRID_COLS, GRID_DX, GRID_X0, ICON_AUTO_DEFAULT, __set_ICON_AUTO_DEFAULT, ICON_AUTO_GAIN, __set_ICON_AUTO_GAIN, ICON_AUTO_RGB, __set_ICON_AUTO_RGB, IDLE_FADE_COLS, ITEM_ABOVE_Y, ITEM_BELOW_Y, ITEM_PITCH, ITEM_SPINE_Y, MEDIA_MODES, SPINE_X, applyIconColorVar, autoLogHTML, consoleBadge, dimTo, drillX, dropMedia, esc, iconHTML, isUserContent, itemIcon, labelHTML, resetLabel, setPlayerIconTint, spineNow, __set_spineNow, watchArtLoading, watchArtRatio } from "./xmb-shared.js";
import { GameConfirm, GameInfo, GameMenu } from "./gamemenu.js";
import { IconChooser, UserInfo } from "./usermenus.js";
import { Input, call } from "./api.js";
import { PhotoViewer } from "./photoviewer.js";
import { SECTION_MODES, SectionMethods } from "./sections.js";
import { VideoPlayer } from "./videoplayer.js";
import { sysBase, sysUrl } from "./themes.js";
import { SettingsMethods } from "./xmb-settings.js";
import { IconStyleMethods } from "./xmb-iconstyle.js";
import { ThemeMethods } from "./xmb-themes.js";
import { BackgroundMethods } from "./xmb-background.js";
import { FriendMethods } from "./xmb-friends.js";
import { PsnMethods } from "./xmb-psn.js";
import { GameMethods } from "./xmb-games.js";
import { MediaMethods } from "./xmb-media.js";
import { UserMethods } from "./xmb-users.js";
import { BrowserMethods } from "./xmb-browser.js";

export class Xmb {
  constructor(audio, wave, cbs) {
    this.audio = audio; this.wave = wave; this.cbs = cbs;
    // Icon Color "Original" follows the background: re-tint the icons when its
    // colour changes (and check every minute, for Month and Time Colors)
    if (wave) {
      wave.onIconAuto = (rgb, gain, def) => {
        __set_ICON_AUTO_RGB(rgb); __set_ICON_AUTO_GAIN(gain || 1); __set_ICON_AUTO_DEFAULT(def || rgb);
        if (this._pickHex() === "auto") { applyIconColorVar("auto"); if (this.root) this._applyXmbwShading(); }
        // (Folder Color Pick's Original follows the background too)
        if (this.user) this._applyFolderColor();
      };
      if (wave.iconAutoRgb) { __set_ICON_AUTO_RGB(wave.iconAutoRgb); __set_ICON_AUTO_GAIN(wave.iconAutoGain || 1); __set_ICON_AUTO_DEFAULT(wave.iconAutoDefault || wave.iconAutoRgb); }
      setInterval(() => { try { wave.updateMenuTint(); } catch (e) {} }, 60000);
      // the Original wave ready (or not available): its colours for the icons
      // and menus, and the Wave Style row reads what's really shown
      wave.onStyleChange = () => { try { wave.updateMenuTint(); if (this.root && this.levels) this._layoutItems(this.root.clientWidth, this.root.clientHeight); } catch (e) {} };
    }
    this.root = document.getElementById("xmb");
    this.sideMenu = new SideMenu(audio);
    // inside Settings every option menu has its rule where the console's Color
    // menu has it (x 1325 @1920), further right than elsewhere
    { const open = this.sideMenu.open.bind(this.sideMenu);
      this.sideMenu.open = (items, opts = {}, ...rest) => {
        open(items, opts, ...rest);
        const inSettings = this.columns && this.columns[this.selCat] && this.columns[this.selCat].id === "settings";
        this.sideMenu.el.classList.toggle("setline", !!inSettings);
      }; }
    this.gameInfo = new GameInfoPanel(audio);
    this.gameMenu = new GameMenu(audio);
    this.gameConfirm = new GameConfirm(audio);
    this.userInfo = new UserInfo(audio);
    this.iconChooser = new IconChooser(audio);
    this.gameInfo2 = new GameInfo(audio);
    this.textForm = new TextForm(audio);
    this.psnSignInForm = new PsnSignIn(audio);
    this.avatarPicker = new AvatarPicker(audio);
    this.listPicker = new ListPicker(audio);
    this.confirm = new Confirm(audio);
    this.musicPlayer = new MusicPlayer(audio);
    // (the Visualizers Cache kept between uses with Save Cache in System Directory)
    this.musicPlayer.keepVisuals = () => !!this.settings?.behavior?.cacheInAppDir;
    // a background that finishes loading while a menu is open over it (the
    // Photo Gallery opened right after signing in): the menu's blurred view of
    // what's behind it is made again, so it doesn't stay black
    // The blur is given a (tiny) new value, so it's really drawn again, then
    // put back to the menu's own a moment later.
    // a full-screen menu shows the user's own background (wave / wallpaper),
    // never the selected item's backdrop (Sign Up, Photo Gallery, a game's
    // picture): the wave comes back while a menu is open
    // (nor during the boot intro: the menu behind it is hidden, so an item's
    // backdrop chosen meanwhile — What's New with Automatic Login — would
    // leave only black; the user's background shows through the intro)
    const covered = () => { const c = document.body.classList; return c.contains("menu-open") || c.contains("intro-hold") || c.contains("intro-run") || c.contains("booting"); };
    this._syncWaveHidden = () => {
      const hide = !!this.$bg?.classList.contains("show") && !covered();
      // (the menu is still fading in: the wave goes once it has)
      const wait = (this._uncoverUntil || 0) - performance.now();
      if (hide && wait > 0) { clearTimeout(this._uncoverT); this._uncoverT = setTimeout(() => this._syncWaveHidden(), wait + 20); return; }
      this.wave.setHidden(hide);
    };
    // (uncovered: the wave stays until the menu, with the item's backdrop in
    // it, has faded in (0.5 s), or the screen goes dark for a moment, as at
    // the end of the boot intro with Automatic Login landing on What's New)
    new MutationObserver(() => {
      const open = covered();
      if (open === this._menuOpenSeen) return;
      this._menuOpenSeen = open;
      clearTimeout(this._uncoverT);
      if (!open) this._uncoverUntil = performance.now() + 650;
      this._syncWaveHidden();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("bgmedia-ready", () => {
      const menus = document.querySelectorAll(".form.show, .sidemenu, .loading.show, .colorpick.show, .vp-dlg");
      menus.forEach((f) => {
        const cur = getComputedStyle(f).backdropFilter;
        if (!cur || cur === "none") return;
        f._bfTick = !f._bfTick;
        f.style.backdropFilter = f.style.webkitBackdropFilter = cur.replace(/blur\(([\d.]+)px\)/, (m, v) => `blur(${(+v + (f._bfTick ? 0.01 : 0.02)).toFixed(2)}px)`);
        clearTimeout(f._bfT);
        f._bfT = setTimeout(() => { f.style.backdropFilter = f.style.webkitBackdropFilter = ""; }, 2500);
      });
    });
    // the Music Player shows the Visualizer Wave while it's open (Music Settings)
    { const mp = this.musicPlayer, open = mp.open.bind(mp), close = mp.close.bind(mp);
      mp.open = (...a) => { this._inMusicPlayer = true; const r = open(...a); this._applyWallpaper(); return r; };
      mp.close = (...a) => { this._inMusicPlayer = false; const r = close(...a); this._applyWallpaper(); return r; }; }
    this.photoViewer = new PhotoViewer(audio);
    this.playlistPicker = new PlaylistPicker(audio);
    this.photoGrid = new PhotoGrid(audio);
    this.videoViewer = new VideoPlayer(audio);
    // The Photo Viewer and the Video Player cover the whole screen: the
    // background / overlay videos behind them are paused meanwhile and, when
    // they show again, start right where they would be by then (a webview
    // that stops drawing a covered video otherwise fast-forwards it to catch up)
    new MutationObserver(() => this._coverBgVideos(document.body.classList.contains("pv-open") || document.body.classList.contains("video-open")))
      .observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.profileCard = new ProfileCard(audio);
    this.colorPicker = new ColorPicker(audio);
    this.keybindMenu = new KeybindMenu(audio);
    // (what a menu's choice starts and keeps working on is watched too: see _trackBusy)
    for (const ov of Object.values(this)) {
      if (!ov || typeof ov !== "object" || ov === this.root) continue;
      for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(ov) || {}).concat(Object.keys(ov))) {
        if (!/^open/.test(k) || typeof ov[k] !== "function" || ov[k]._busyWrapped) continue;
        const fn = ov[k].bind(ov);
        const w = (...a) => fn(...a.map((x) => (typeof x === "function" ? (...b) => this._trackBusy(x(...b)) : x)));
        w._busyWrapped = true; ov[k] = w;
      }
    }
    this.overlay = null;
    this.selCat = 0; this.locked = true;
    this.user = null;
    setPlayerIconTint({ r: 255, g: 255, b: 255, a: 1 });   // (the filter must exist before any player opens)
  }

  async start(manifest, { noAutoLogin = false } = {}) {
    this.manifest = manifest;
    this.locked = true; this.user = null;
    // (the Icon Style of the last session, from the start: see _iconStyle;
    // only how the icons are drawn: the icon images themselves are read from
    // the saved cache and made at log-in, as before, so the start isn't held up)
    this._iconStyleAttrs();
    await this._buildColumns();
    // (and drawn in it before anyone signs in, as well: the reactive glass is
    // started and the saved icon pictures loaded, without holding up the start)
    this._applyIconStyle().catch(() => {});
    // Automatic Login: that user is logged in at once, on What's New
    const auto = noAutoLogin ? null : (this.usersFile?.users || []).find((u) => u.autoLogin);
    if (auto) {
      this.show();
      await this._signIn(auto, { startAt: "whatsnew" });
      this._applyPerformance();
      setTimeout(() => this._applyResolution(), 400);
      return;
    }
    this.selCat = 0;                 // Users column only, while locked
    // Land on the first actual profile if one exists, otherwise Create New User.
    const uitems = this.columns[0].items;
    const iu = uitems.findIndex((it) => it.kind === "user");
    const firstUser = iu >= 0 ? iu : Math.max(0, uitems.findIndex((it) => it.kind === "newuser"));
    this.levels = [{ items: uitems, sel: firstUser }];
    this.show(); this._render(); this._onSelect();
    this._applyPerformance();
    setTimeout(() => this._applyResolution(), 400);
  }

  show() { this.root.classList.add("show"); }

  // ------------------------------------------------------------- data model
  // reuseGames: the game library read last time (nothing in it changed, as
  // after a theme change), instead of reading it again
  async _buildColumns({ reuseGames = false } = {}) {
    this.mediaMode ||= { music: "all", photo: "all", video: "all" };
    const games = reuseGames && this._lastGames ? this._lastGames : await call("scan_library");
    this._lastGames = games;
    this._loadDetected();
    const users = await this._buildColumn("users");
    if (this.locked) { this.columns = [users]; return; }
    this.psnAccounts = await call("list_psn_accounts");
    // the libraries' fingerprints as their lists are read now (see _liveRefresh)
    await this._takeMediaFingerprints(["photo", "video", "music"]);
    const cols = [users];
    for (const id of BASE_COLUMNS) cols.push(await this._buildColumn(id, games));
    // (custom sections from System Settings > Sections go where they were placed)
    this.columns = await this._withSections(cols);
  }
  // One column built on its own, so a change to one column (a new sort
  // order, a playlist, a user's picture...) only rebuilds that column instead
  // of reading every library again. `games`: the library just scanned (the
  // last one read when not given).
  async _buildColumn(id, games) {
    switch (id) {
      case "users": {
        const uf = await call("list_users");
        this.usersFile = uf;
        // The column is "Log In" until a user is chosen/created this session, then
        // "Users" for the rest of the session. Create New User sits directly under
        // Turn Off System, with the profiles below it.
        return { id: "users", label: this._loggedInOnce ? "Users" : "Log In", icon: "tex_user.png", items: [
          { kind: "action", act: "turnoff", title: "Turn Off System", sub: "", icon: { sys: "icon_poweroff.png" } },
          { kind: "newuser", title: "Create New User", sub: "", icon: { sys: "icon_newuser.png" } },
          ...uf.users.map((u) => ({ kind: "user", title: u.name, sub: "", icon: { avatar: u.avatar }, user: u })),
        ] };
      }
      case "settings": return { id: "settings", label: "Settings", icon: "tex_sysconf.png", items: this._settingsItems() };
      case "photo": return { id: "photo", label: "Photo", icon: "tex_photo.png", items: [
        this._mediaServersItem(),
        { kind: "action", act: "photo_gallery", title: "Photo Gallery", icon: { sys: "photo_gallery.png" }, bg: "cinfo-bg-photogallery.jpg",
          sub: "Create a space to enjoy and enhance your photos.\nTurn the photos on your PS3™ system into great albums in minutes.\nYou can sort your photos by themes, add music to enhance a slideshow or add custom frames to your photos. The more photos you add, the more fun you can have – the possibilities are endless!" },
        { kind: "drill", title: "Playlists", icon: { sys: "icon_playlist.png" }, children: await this._photoPlaylistItems() },
        ...await this._mediaSectionItems("photo"),
      ] };
      case "music": return { id: "music", label: "Music", icon: "icon_music.png", items: await this._musicItems() };
      case "video": return { id: "video", label: "Video", icon: "icon_video.png", items: [
        { kind: "ph", title: "BD Data Utility", sub: "", icon: { sys: "icon_gamedata.png" } },
        this._mediaServersItem(),
        { kind: "ph", title: "Video Editor & Uploader", sub: "", icon: { sys: "icon_video_upload.png" } },
        this._storeItem("cinfo-bg-storevideo.jpg"),
        ...await this._mediaSectionItems("video"),
      ] };
      case "game": {
        if (!games) games = this._lastGames || await call("scan_library");
        return { id: "game", label: "Game", icon: "tex_game.png", items: this._gameItems(games) };
      }
      case "network": return { id: "network", label: "Network", icon: "icon_network.png", items: [
        { kind: "ph", title: "Online Instruction Manuals", sub: "", icon: { sys: "icon_onlinemanual.png" } },
        { kind: "ph", title: "Remote Play", sub: "Use a device that supports remote play (such as a PS Vita or a PSP™ system) to operate this system over a network. Go to [Settings] > [Remote Play Settings] > [Register Device] and register the remote play device.", icon: { sys: "icon_remoteplay.png" } },
        { kind: "action", act: "inet_browser", title: "Internet Browser", sub: "", icon: { sys: "icon_browser.png" } },
        { kind: "action", act: "inet_search", title: "Internet Search", sub: "", icon: { sys: "icon_inet_search.png" } },
        { kind: "ph", title: "Download Management", sub: "", icon: { sys: "icon_download.png" } },
      ] };
      case "tvvideo": return { id: "tvvideo", label: "TV/Video Services", icon: "icon_tv.png", items: [
        { kind: "ph", title: "My Channels", sub: "", icon: { sys: "mychannels.png" }, bg: "cinfo-bg-whatsnew.jpg" },
        // YouTube (the console's TV/Video Services capture): opens the browser on youtube.com
        { kind: "action", act: "youtube", title: "YouTube", sub: "", icon: { art: "./assets/icons/system/youtube.png", gameArt: true, plainLabel: true, artCls: "yt-art" } },
      ] };
      case "psn": return { id: "psn", label: "PlayStation\u00aeNetwork", ...this._psnLook(), items: this._psnItems() };
      case "friends": return { id: "friends", label: "Friends", icon: "icon_friend.png", items: await this._friendsItems() };
    }
    return null;
  }
  // Put a column built again in place of the old one (same position); the
  // menu shown from it is pointed at the new items by the caller
  async _replaceColumn(id) {
    if (!this.columns) return null;
    const i = this.columns.findIndex((c) => c.id === id);
    if (i < 0) return null;
    if (this.columns[i].section) { await this._refreshSections(); return this.columns.find((c) => c.id === id) || null; }
    if (["photo", "video", "music"].includes(id)) await this._takeMediaFingerprints([id]);
    if (id === "psn") this.psnAccounts = await call("list_psn_accounts");
    const col = await this._buildColumn(id);
    if (!col) return null;
    const j = this.columns.findIndex((c) => c.id === id);   // (it may have moved meanwhile)
    if (j < 0) return null;
    // its place in the category row (drawn elements, remembered state) carries over
    for (const [k, v] of Object.entries(this.columns[j])) if (k.startsWith("_") && !(k in col)) col[k] = v;
    this.columns[j] = col;
    return col;
  }
  // A long job (deleting cache, recognizing files…): the option shows a
  // spinning loading icon and a counter (from the system's "xmb-progress"
  // reports) and a warning, and the menu stays locked on it until it's done.
  async _runLocked(act, title, fn) {
    if (this._preloadState === "loading") return undefined;
    this._preloadState = "loading"; this._preloadAct = act; this._preloadTitle = title;
    this._preloadDone = 0; this._preloadTotal = 0;
    // not started from an option on screen (new games found when the Game
    // column opened): the same loading icon, counter and warning in a box
    const lvl = this._level();
    const onItem = !!(lvl && lvl.items.some((x) => x.act === act));
    if (!onItem) this._lockBox(true);
    let raf = 0;
    const redraw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0;
      if (onItem) this._refreshDetail(this.root.clientWidth, this.root.clientHeight); else this._lockBox(true); }); };
    redraw();
    let un = null;
    const ev = window.__TAURI__?.event;
    if (ev?.listen) { try { un = await ev.listen("xmb-progress", (e) => { const p = e.payload || {}; this._preloadDone = p.done | 0; this._preloadTotal = p.total | 0; redraw(); }); } catch (e) {} }
    let r;
    try { r = await fn((t) => { this._preloadTitle = t; this._preloadDone = 0; this._preloadTotal = 0; redraw(); }); }
    finally { if (un) { try { un(); } catch (e) {} } }
    // (a redraw still waiting for its frame would put the box back up)
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    this._preloadState = "done"; this._preloadTitle = null;
    if (!onItem) { this._lockBox(false); this._preloadState = null; }
    this.audio.play("enter", 0.4);
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    return r;
  }
  _lockBox(on) {
    let el = document.getElementById("lockbox");
    if (!on) { if (el) el.classList.remove("show"); return; }
    if (!el) { el = document.createElement("div"); el.id = "lockbox"; document.body.appendChild(el); }
    const n = this._preloadTotal ? ` ${this._preloadDone}/${this._preloadTotal}` : "";
    el.innerHTML = `<div class="lb-panel"><div class="lb-title">${esc(this._preloadTitle || "Please wait...")}<span class="d-status"><img class="d-spin" src="./assets/icons/system/loading_icon.png" alt="">${n}</span></div>`
      + `<div class="lb-sub">Please wait. The system could slow down while this runs. Do not close or navigate away until it finishes.</div></div>`;
    el.classList.add("show");
  }
  // Newly recognized games waiting for their art (Automatic Scraping): fetched
  // now, with the menu waiting on it
  async _scrapeWaiting(act) {
    let n = 0; try { n = await call("game_scrape_waiting"); } catch (e) {}
    if (!n) return 0;
    const got = await this._runLocked(act || "__scrape__", "Getting game art online...", () => call("game_scrape_queued").catch(() => 0));
    await this._refreshGameColumn();
    return got || 0;
  }
  // re-derive the open submenu's items in place, keeping the cursor
  _rebuildLevel(fn) {
    const lvl = this._level();
    if (!lvl) return;
    lvl.items = fn.call(this);
    lvl.sel = Math.max(0, Math.min(lvl.sel, lvl.items.length - 1));
    this._render(); this._onSelect();
  }

  // right click on an item: choose it first (its △ menu opens next)
  selectAt(target) {
    const el = target && target.closest && target.closest("#xmb .item");
    if (!el || !el._xmbPick) return false;
    el._xmbPick(); return true;
  }
  // ------------------------------------------------------------- rendering
  _level() { return this.levels[this.levels.length - 1]; }

  _render() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    this.root.innerHTML = `
      <div class="bg-layer"></div>
      <div class="media-topbar"></div>
      <div class="media-sort"></div>
      <div class="crumb"></div>
      <div class="cat-row"></div>
      <div class="item-col"></div>
      <div class="item-detail"></div>`;
    this.$bg = this.root.querySelector(".bg-layer");
    this.$mediaSort = this.root.querySelector(".media-sort");
    this.$mediaTopbar = this.root.querySelector(".media-topbar");
    this.$cats = this.root.querySelector(".cat-row");
    this.$items = this.root.querySelector(".item-col");
    this.$detail = this.root.querySelector(".item-detail");
    this.$crumb = this.root.querySelector(".crumb");

    const drilled = this.levels.length > 1;
    this.columns.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "cat";
      el.innerHTML = `${iconHTML(c.icon)}<div class="cat-label">${esc(c.catLabel || c.label)}</div>`;
      el.addEventListener("click", () => { if (this.locked && i !== 0) return; this._gotoCat(i); });
      this.$cats.appendChild(el); c._el = el;
    });
    this._layoutCats(w, h);

    // No more icon-copy over the category: the drilled-in subsection is shown
    // by an anchor icon on the left (with a back arrow) built in _renderItems.
    this.$crumb.classList.remove("show");
    this._updateMediaSort();
    this._renderItems(w, h);
    this._applyXmbwShading();
  }
  // Top-left sort indicator: the section's small icon + the current mode name,
  // under a semi-transparent top bar. Shown only at the root of a media section.
  // The sort bar is shown ONLY when the user presses Square (flash === true).
  // On ordinary renders/navigation it stays hidden: it must not pop up just
  // because you backed out of a Music/Photo/Video submenu.
  _updateMediaSort(flash = false) {
    if (!this.$mediaSort) return;
    const col = this.columns[this.selCat];
    const id = col && col.id;
    const sc = this._secSortContext();                 // (a custom section's subsection)
    const atRoot = (this.levels.length === 1 && !!MEDIA_MODES[id]) || !!sc;
    clearTimeout(this._sortHideT);
    if (!flash || !atRoot) {
      // keep it hidden on every non-Square update
      this.$mediaSort.classList.remove("show"); this.$mediaTopbar.classList.remove("show");
      this.$mediaSort.classList.add("fade"); this.$mediaTopbar.classList.add("fade");
      this.$mediaSort.innerHTML = "";
      return;
    }
    const mode = sc ? (SECTION_MODES.find((m) => m.id === this._secMode(sc.sec)) || this._secModes(sc.sec)[0])
      : (MEDIA_MODES[id].find((m) => m.id === this._mediaMode(id)) || MEDIA_MODES[id][0]);
    this.$mediaSort.innerHTML = `${iconHTML(col.icon, "ms-icon")}<span class="ms-label">${esc(mode.label)}</span>`;
    // shown as it is for a moment, then it fades out
    this.$mediaSort.classList.add("show"); this.$mediaTopbar.classList.add("show");
    this.$mediaSort.classList.remove("fade"); this.$mediaTopbar.classList.remove("fade");
    this._sortHideT = setTimeout(() => {
      this.$mediaSort && this.$mediaSort.classList.add("fade");
      this.$mediaTopbar && this.$mediaTopbar.classList.add("fade");
    }, 1500);
  }

  _layoutCats(w, h) {
    __set_spineNow(this.locked ? 0.5 : SPINE_X);
    const drilled = this.levels.length > 1;
    this.$cats.classList.toggle("dim", false);
    this.$cats.classList.toggle("drilled", this.levels.length > 1);
    const cy = h * CAT_SEL_Y;
    // When drilled into a sub-menu, only the current section icon stays: moved
    // to sit directly above the drilled anchor, at the anchor's dimmed opacity -
    // and every other category icon disappears (like the real XMB).
    if (drilled) {
      const active = this.levels.length - 1;
      const anchorX = w * drillX(0, active);                 // the root level's anchor column
      this.columns.forEach((c, i) => {
        const isCur = i === this.selCat;
        c._el.style.left = `${anchorX}px`;
        c._el.style.top = `${cy}px`;
        c._el.classList.toggle("sel", isCur);
        dimTo(c._el, isCur ? "0.85" : "0");
        c._el.style.pointerEvents = isCur ? "auto" : "none";
      });
      return;
    }
    const cx = w * spineNow;
    this.columns.forEach((c, i) => {
      const d = i - this.selCat, ad = Math.abs(d);
      const off = ad === 0 ? 0 : Math.sign(d) * (CAT_GAP_SEL + (ad - 1) * CAT_GAP) * w;
      c._el.style.left = `${cx + off}px`;
      c._el.style.top = `${h * (d === 0 ? CAT_SEL_Y : CAT_Y)}px`;
      c._el.style.pointerEvents = "auto";
      c._el.classList.toggle("sel", d === 0);
      // captures: the others are only slightly dimmer (on a bright background
      // with Icon Style Default, barely at all, as on the console)
      const brightDef = document.documentElement.hasAttribute("data-bright-bg") && this._iconStyle() === "glasslive";
      dimTo(c._el, d === 0 ? "1" : (brightDef ? "0.95" : "0.78"));
    });
  }

  // The active sub-menu is the camera focus (drawn at the normal spine). Each
  // ancestor is reduced to a single anchor icon sitting to the LEFT, with a
  // back arrow (◄) marking where the sub-menu opened from: like the real XMB.
  // the settings' current choices beside them
  _fillSetVals(lvl) {
    for (const o of lvl.items) {
      if (o.kind !== "setting" || !o._el) continue;
      const n = o._el.querySelector(".item-setval"); if (!n) continue;
      let v = ""; try { v = this._ctlValue(o.ctl); } catch (e) {}
      v = v == null ? "" : String(v);
      if (n.textContent !== v) n.textContent = v;
    }
  }
  // the current section's icon as a flat picture (for the loading icon in its
  // lists): the user's own media and avatars (Users, Photo, Music, Video, Game,
  // Friends and custom sections), not the system's own sections
  _secFlat() {
    const c = this.columns && this.columns[this.selCat];
    if (!c || ["settings", "tvvideo", "network", "psn"].includes(c.id) || !c.icon) return null;
    const n = c.icon;
    if (n.startsWith("url:")) return n.slice(4);
    if (n.startsWith("cust:")) return n.slice(n.indexOf(":", 5) + 1);
    // (the system's own section icon: a theme's never takes its place here)
    return sysBase(n);
  }
  _renderItems(w, h) {
    this.$items.innerHTML = "";
    { const f = this._secFlat(); this.$items.classList.toggle("has-flat", !!f); if (f) this.$items.style.setProperty("--sec-flat", `url('${f}')`); else this.$items.style.removeProperty("--sec-flat"); }
    const active = this.levels.length - 1;
    this.levels.forEach((lvl, li) => {
      const isActive = li === active;
      if (isActive) {
        // only the rows around the selection exist (see _ensureWindow): a
        // library of thousands of songs builds ~30 rows, and only their
        // covers load
        for (const it of lvl.items) it._el = null;
        this._ensureWindow(lvl);
      } else {
        // ancestor anchor: the item that was drilled into, with the back arrow
        const it = lvl.items[lvl.sel];
        const el = document.createElement("div");
        el.className = "item item-anchor";
        el.innerHTML = `${itemIcon(it)}<img class="drill-arrow" src="./assets/icons/system/arrow_left.png" alt="">`;
        this.$items.appendChild(el); lvl._anchorEl = el; watchArtRatio(el);
        // the parent's other rows stay barely visible (icons only)
        lvl._ghosts = [];
        if (li === active - 1) {
          lvl.items.forEach((o, j) => {
            if (j === lvl.sel || Math.abs(j - lvl.sel) > 10 || o.kind === "playercard" || o.kind === "friendcard") return;
            const g = document.createElement("div");
            g.className = "item item-ghost";
            g.innerHTML = itemIcon(o); watchArtRatio(g);
            this.$items.appendChild(g); lvl._ghosts.push({ j, el: g });
          });
        }
      }
    });
    this._layoutItems(w, h);
  }

  // The rows of the active column that exist in the page: the selection and the
  // rows near it (what can be on screen, plus a margin). Moving the cursor adds
  // the rows coming into view and drops the far ones, so a big library costs
  // the same as a small one and media pictures load as they come near.
  _windowRange(lvl) {
    const n = lvl.items.length, s = lvl.sel;
    if (lvl.grid) { const r = Math.floor(s / GRID_COLS); return [Math.max(0, (r - 5) * GRID_COLS), Math.min(n - 1, (r + 6) * GRID_COLS - 1)]; }
    // (the media / game / Friends columns, which can be scrolled fast: as many
    // above as below, so going up fast the rows above are there too)
    return [Math.max(0, s - (this._snapScroll() ? 14 : 9)), Math.min(n - 1, s + 14)];
  }
  _ensureWindow(lvl) {
    if (!lvl || !this.$items) return;
    const [a, b] = this._windowRange(lvl);
    let made = false;
    lvl.items.forEach((it, j) => {
      const inside = j >= a && j <= b;
      // a little slack before dropping a row, so moving back and forth doesn't rebuild it
      const keep = j >= a - 4 && j <= b + 4;
      if (it._el && !keep) { dropMedia(it._el); it._el.remove(); it._el = null; }
      else if (!it._el && inside) { this._makeItemEl(lvl, it, j); made = true; }
    });
    // (scrolling fast: the pictures of the rows passing by wait, see _lazyArt)
    if (this._lazyEls && this._lazyEls.size) this._lazyArtSoon();
    if (lvl.inFolder && this._dynCovers(lvl)) this._coverSwap(lvl);
    // new rows' icons get their shading right away (no blank frame)
    if (made && !this._inWindowShade) { this._inWindowShade = true; try { this._applyXmbwShading(); } finally { this._inWindowShade = false; } }
  }
  // a row's media pictures held back while the list scrolls fast
  _lazyArt(el) {
    let any = false;
    for (const img of el.querySelectorAll("img.art-img, img.ff-thumb, img.item-avatar")) {
      const u = img.getAttribute("src");
      if (!u || /^(\.\/)?assets\//.test(u) || (img.complete && img.naturalWidth)) continue;
      img.dataset.lazy = u; img.removeAttribute("src"); any = true;
    }
    for (const v of el.querySelectorAll("video.preview-vid")) { const u = v.getAttribute("src"); if (u) { v.dataset.lazy = u; v.removeAttribute("src"); any = true; } }
    if (any) (this._lazyEls ||= new Set()).add(el);
  }
  // ...and loaded once it slows down (nearest the selection first)
  _lazyArtSoon() {
    clearTimeout(this._lazyT);
    this._lazyT = setTimeout(() => {
      if (this._gl && this.$items.classList.contains("glide-fast")) { this._lazyArtSoon(); return; }
      const els = [...this._lazyEls].filter((e) => e.isConnected);
      this._lazyEls.clear();
      const sel = this.$items.querySelector(".item.sel");
      const y0 = sel ? sel.offsetTop : 0;
      els.sort((a, b) => Math.abs(a.offsetTop - y0) - Math.abs(b.offsetTop - y0));
      for (const el of els) for (const m of el.querySelectorAll("[data-lazy]")) { m.setAttribute("src", m.dataset.lazy); delete m.dataset.lazy; }
    }, 120);
  }
  // songs in an opened folder: more than 15 → covers loaded as needed
  _dynCovers(lvl) {
    if (lvl._dynN === undefined) lvl._dynN = lvl.items.reduce((n, it) => n + (it.kind === "music" && it.icon && it.icon.full ? 1 : 0), 0);
    return lvl._dynN > 15;
  }
  // the selected song's full cover (once the cursor stays on it a moment, so
  // scrolling through doesn't load every one); the others back to small copies
  _coverSwap(lvl) {
    clearTimeout(this._coverT);
    const set = (it, url) => { const img = it._el && it._el.querySelector(".art-img"); if (img && url && img.getAttribute("src") !== url) img.src = url; };
    // (songs a few rows away go back to their small copies; the ones next to
    // the selection keep what they have, so going back and forth costs nothing)
    lvl.items.forEach((it, j) => { if (Math.abs(j - lvl.sel) > 3 && it._el && it.kind === "music" && it.icon && it.icon.full) set(it, it.icon.art); });
    const cur = lvl.items[lvl.sel];
    if (!cur || cur.kind !== "music" || !cur.icon || !cur.icon.full) return;
    this._coverT = setTimeout(() => {
      if (this._level() !== lvl || lvl.items[lvl.sel] !== cur) return;
      // (loaded first, then swapped in: the small copy stays until then, never a blank)
      const pre = new Image(); pre.decoding = "async";
      pre.onload = () => { if (lvl.items[lvl.sel] === cur) set(cur, cur.icon.full); };
      pre.src = cur.icon.full;
    }, 140);
  }
  _makeItemEl(lvl, it, j) {
    const el = document.createElement("div");
    const cardCls = (it.kind === "playercard" || it.kind === "friendcard") ? "item-card" : "";
    el.className = `item fresh ${it.kind === "game" ? "item-game" : ""}${it.secItem ? " sec-game" : ""}${it.kind === "video" ? " item-video" : ""} ${cardCls} ${isUserContent(it) ? "uc" : ""}`;
    // Every non-card item carries its own title label INSIDE the item, so
    // the title travels with its icon. The selected item's label also
    // holds its description (filled in by _refreshDetail).
    const isCardKind = it.kind === "playercard" || it.kind === "friendcard";
    // inside an opened folder a song shows its cover at full quality (the
    // lists outside folders show small copies)
    // (a folder of more than 15 songs: each cover is loaded as it's needed: the
    // rows show the small copies and only the selected song gets its full
    // cover, see _coverSwap)
    const dyn = lvl.inFolder && this._dynCovers(lvl);
    const shown = lvl.inFolder && !dyn && it.kind === "music" && it.icon && it.icon.full ? { ...it, icon: { ...it.icon, art: it.icon.full } } : it;
    el.innerHTML = itemIcon(shown) + (isCardKind ? "" : labelHTML(it)) + (it.kind === "game" && it.game ? consoleBadge(it.game.console) : "");
    if (isCardKind) avWaitCheck(el);   // (an avatar already loaded: no loading icon)
    if (it.kind === "user" && this.user && it.user && it.user.id === this.user.id) {
      el.insertAdjacentHTML("beforeend", `<div class="user-diamond"></div>`);
    }
    // a setting's current choice, on the right of its row (IMG_3605)
    if (it.kind === "setting" && it.ctl !== "sysinfo") el.insertAdjacentHTML("beforeend", `<div class="item-setval"></div>`);
    watchArtLoading(el, this._secFlat()); watchArtRatio(el);
    // (the list scrolling fast, held: the picture waits until the scrolling
    // slows down (the loading icon and the section's icon meanwhile), so the
    // rows going past don't each start loading one and the ones the cursor
    // stops at come first)
    if (this._gl && this.$items.classList.contains("glide-fast")) this._lazyArt(el);
    // left click: the item is chosen and opened (as ✕ does); right click: its △ menu (main.js)
    el.addEventListener("click", () => {
      if (this.overlay || this._level() !== lvl) return;
      if (lvl.sel !== j) { lvl.sel = j; this._layoutItems(this.root.clientWidth, this.root.clientHeight); this._onSelect(); }
      this.onInput("enter");
    });
    el._xmbPick = () => { if (lvl.sel !== j && this._level() === lvl) { lvl.sel = j; this._layoutItems(this.root.clientWidth, this.root.clientHeight); this._onSelect(); } };
    this.$items.appendChild(el); it._el = el; it._labelDirty = false;
    // placed without sliding in from the corner: transitions start next frame
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("fresh")));
    return el;
  }

  // Extra x offset (fraction of width) of the active column vs. the root spine.
  _drillOffset(active) { return drillX(active, active) - spineNow; }

  // Row centres (px) of a level's items around its selection, as on the XMB:
  // the selected row on the spine, the rows BELOW from a fixed line (≈680 @1080)
  // and the rows ABOVE jumping over the category row (≈120 @1080). In drilled
  // sub-menus (no category row) the gap above mirrors the one below.
  _rowTops(lvl, li, h) {
    const rowH = (it) => (it && it.kind === "game" ? GAME_PITCH : ITEM_PITCH) * h;
    const sy = h * ITEM_SPINE_Y;
    const sel = lvl.sel, n = lvl.items.length;
    const tops = new Array(n);
    tops[sel] = sy;
    const firstAbove = li === 0 ? h * ITEM_ABOVE_Y : sy - (h * ITEM_BELOW_Y - sy);
    for (let j = sel + 1; j < n; j++) {
      const r = rowH(lvl.items[j]);
      tops[j] = j === sel + 1 ? h * ITEM_BELOW_Y + (r - ITEM_PITCH * h) / 2
                              : tops[j - 1] + (rowH(lvl.items[j - 1]) + r) / 2;
    }
    for (let j = sel - 1; j >= 0; j--) {
      const r = rowH(lvl.items[j]);
      tops[j] = j === sel - 1 ? firstAbove - (r - ITEM_PITCH * h) / 2
                              : tops[j + 1] - (rowH(lvl.items[j + 1]) + r) / 2;
    }
    return tops;
  }

  _layoutItems(w, h) {
    const active = this.levels.length - 1;
    const isCardIt = (it) => it && (it.kind === "playercard" || it.kind === "friendcard");
    const sy = h * ITEM_SPINE_Y;
    const spineOf = (li) => w * drillX(li, active);
    this.levels.forEach((lvl, li) => {
      const isActive = li === active;
      if (!isActive) {
        if (lvl._anchorEl) {
          lvl._anchorEl.style.left = `${spineOf(li)}px`;
          lvl._anchorEl.style.top = `${sy}px`;
          dimTo(lvl._anchorEl, li === active - 1 ? "0.8" : "0.5");
          lvl._anchorEl.style.zIndex = "1";
        }
        if (lvl._ghosts && lvl._ghosts.length) {
          const tops = this._rowTops(lvl, li, h);
          const gx = spineOf(li) + GHOST_DX * w;
          for (const g of lvl._ghosts) {
            const t = tops[g.j];
            // pulled in a little toward the spine (as in the capture)
            const y = sy + (t - sy) * (t < sy ? 0.95 : 0.89);
            g.el.style.left = `${gx}px`;
            g.el.style.top = `${y}px`;
          }
        }
        return;
      }
      const sx = spineOf(li);
      const sel = lvl.sel;
      this._ensureWindow(lvl);
      this.$items.classList.toggle("grid", !!lvl.grid);
      if (lvl.grid) { this._layoutGrid(lvl, sx, sy, w, h); return; }
      const tops = this._rowTops(lvl, li, h);
      lvl.items.forEach((it, j) => {
        if (!it._el) return;
        const isSel = j === sel;
        const isCard = isCardIt(it);
        it._el.classList.toggle("sel", isSel);
        it._el.style.left = `${isCard ? sx - (isSel ? CARD_X : CARD_COMPACT_X) * w : sx}px`;
        it._el.style.top = `${tops[j]}px`;
        // every non-selected row is drawn at the same dim level (as in the refs)
        dimTo(it._el, isSel ? "1" : "0.55");
        it._el.style.zIndex = isSel ? "5" : "1";
        // songs / photos / videos / games: a title too long for the screen
        // scrolls (marquee) instead of running off the edge
        if (isUserContent(it)) {
          const t = it._el.querySelector(".il-title");
          if (t) {
            // (the label's margin is the same for every row of a kind: measured once)
            const lk = t.parentElement.className;
            // (a game's title moves out when it's chosen (styles.css): worked
            // out here, as the style is still moving)
            const ar = parseFloat(it._el.style.getPropertyValue("--ar")) || 0;
            const ml = t.parentElement.classList.contains("il-game")
              ? (isSel ? Math.max(0.1021 * w, ar ? 0.0466 * w * ar + 0.0155 * w : 0) : 0.0604 * w)
              : (this._mlCache ||= new Map()).get(lk) ?? (this._mlCache.set(lk, parseFloat(getComputedStyle(t.parentElement).marginLeft) || 0), this._mlCache.get(lk));
            const left = (parseFloat(it._el.style.left) || 0) + ml;
            t.style.maxWidth = `${Math.max(120, w * 0.975 - left)}px`;
            t.classList.add("mq");
          }
        } else if (it.kind === "setting") {
          // a setting's name too long for the room before its value (shown
          // while it's chosen): it scrolls (marquee) instead of running under it
          const t = it._el.querySelector(".il-title"), v = it._el.querySelector(".item-setval");
          if (t) {
            const room = isSel && v && v.textContent.trim() ? v.getBoundingClientRect().left - t.getBoundingClientRect().left - 0.012 * w : 0;
            if (room > 40) { t.style.maxWidth = `${room}px`; t.classList.add("mq"); }
            else if (t.classList.contains("mq") || t.style.maxWidth) {
              // (not chosen any more: back to its start, still)
              t.style.maxWidth = ""; t.classList.remove("mq", "mq-run"); t._mqSig = null;
              const inner = t.querySelector(":scope > .mq-inner");
              if (inner) { if (inner._mqAnim) { inner._mqAnim.cancel(); inner._mqAnim = null; inner._mqLap = 0; } inner.querySelector(":scope > .mq-dup")?.remove(); }
            }
          }
        }
      });
    });
    this._refreshDetail(w, h);
  }

  // A folder of pictures (captures: 5 columns 243 px apart, the first on the
  // spine; the selected row on the spine, the next rows 255 px away and then
  // 160 px apart). Each picture is shown whole and centred in its cell; the
  // selected one larger, with a see-through frame just outside it that glows
  // with its title, and its name and date underneath.
  _layoutGrid(lvl, sx, sy, w, h) {
    const sel = lvl.sel, row0 = Math.floor(sel / GRID_COLS);
    const dy = (r) => r === 0 ? 0 : Math.sign(r) * (255 + (Math.abs(r) - 1) * 160) / 1080 * h;
    lvl.items.forEach((it, j) => {
      const r = Math.floor(j / GRID_COLS) - row0, c = j % GRID_COLS, isSel = j === sel;
      const el = it._el; if (!el) return;
      el.classList.toggle("sel", isSel); el.classList.add("grid-cell");
      el.style.left = `${sx + (GRID_X0 + c * GRID_DX) / 1920 * w}px`;
      el.style.top = `${sy + dy(r)}px`;
      dimTo(el, "1");
      el.style.zIndex = isSel ? "5" : "1";
      el.style.visibility = Math.abs(r) > 4 ? "hidden" : "visible";
      this._gridCell(el, isSel, w, h);
    });
    this._refreshDetail(w, h);
  }
  // size one cell's picture (and the selected one's frame and title) to fit its box
  _gridCell(el, isSel, w, h) {
    const fr = el.querySelector(".art-frame"), img = fr && fr.querySelector(".art-img");
    if (!fr || !img) return;
    const [bw, bh] = (isSel ? GRID_BOX_SEL : GRID_BOX).map((v, i) => v / (i ? 1080 : 1920) * (i ? h : w));
    fr.style.width = `${bw}px`; fr.style.height = `${bh}px`;
    if (!img.naturalWidth) {
      if (!img._gridWait) { img._gridWait = true; img.addEventListener("load", () => { img._gridWait = false; this._gridCell(el, el.classList.contains("sel"), this.root.clientWidth, this.root.clientHeight); }, { once: true }); }
      return;
    }
    const k = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
    const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
    img.style.width = `${iw}px`; img.style.height = `${ih}px`;
    let hl = fr.querySelector(".grid-hl");
    if (!hl) { hl = document.createElement("div"); hl.className = "grid-hl"; fr.appendChild(hl); }
    const pad = 0.0065 * h;
    Object.assign(hl.style, { width: `${iw + 2 * pad}px`, height: `${ih + 2 * pad}px` });
    // the title starts at the frame's left edge, just under it
    const lab = el.querySelector(".item-label");
    if (lab) { lab.style.left = `${(bw - iw) / 2 - pad}px`; lab.style.top = `${bh / 2 + ih / 2 + pad + 0.004 * h}px`; }
  }

  // Fill in the selected item's label (title + description, which travel with
  // its icon) and reset the others. Content-info items (those with a cinfo
  // backdrop) show only their title until the dwell sets `this._reveal`; then
  // the PS3 description rectangle fades in (this.$detail) and every label
  // fades out, as on the real XMB.
  _refreshDetail(w, h) {
    w = w || this.root.clientWidth; h = h || this.root.clientHeight;
    const active = this.levels.length - 1;
    const sx = w * spineNow + this._drillOffset(active) * w;
    const lvl = this._level();
    const it = lvl.items[lvl.sel];
    lvl.items.forEach((o) => { if (o !== it && o._el && o._labelDirty) resetLabel(o); });
    this._fillSetVals(lvl);
    if (!it) { this._hidePanel(); return; }
    const isCard = it.kind === "playercard" || it.kind === "friendcard";
    // settings show their description; the value lives in the option (△) menu
    const val = it.kind === "setting" ? (it.ctl === "sysinfo" ? this._ctlValue(it.ctl) : "")
      : (lvl.grid && it.media && it.media.modified) ? this._fmtDateTime(new Date(it.media.modified * 1000)) : it.sub;
    const isBg = !!it.bg || !!it.panel;
    const revealed = !isBg || this._reveal;          // bg items wait for the dwell
    const panel = isBg && revealed && !!val;
    // Preload All Songs shows a spinning loader while decoding, then a tick.
    let status = "";
    const pAct = this._preloadAct || "preload";
    if (it.kind === "action" && it.act === pAct && this._preloadState) {
      if (this._preloadState === "loading") {
        const n = this._preloadTotal ? ` ${this._preloadDone}/${this._preloadTotal}` : "";
        status = `<span class="d-status"><img class="d-spin" src="./assets/icons/system/loading_icon.png" alt="">${n}</span>`;
      } else if (this._preloadState === "done") {
        status = `<span class="d-status"><img class="d-tick" src="./assets/icons/system/tick.png" alt=""></span>`;
      }
    }
    const preloading = it.kind === "action" && it.act === pAct && this._preloadState === "loading";
    const sub = preloading ? "Please wait. The system could slow down while this runs. Do not close or navigate away until it finishes." : val;
    const title = preloading ? (this._preloadTitle || (pAct === "preloadvideos" ? "Preloading videos..." : "Preloading songs...")) : it.title;
    // setting items may ALSO carry a description in `it.sub`; show it under the
    // value (the value itself is what `val` holds for settings).
    const settingDesc = (it.kind === "setting" && it.sub && revealed && !(it.act === "preload" || it.act === "preloadvideos"))
      ? `<div class="d-desc">${esc(it.sub)}</div>` : "";
    const warnLine = (it.kind === "action" && it.warn && revealed && !preloading)
      ? `<div class="d-warn-text">${esc(it.warn)}</div>` : "";
    if (!isCard && it._el) {
      const lab = it._el.querySelector(".item-label");
      if (lab) {
        lab.querySelector(".il-title").innerHTML = esc(title || "") + status;
        lab.querySelector(".il-body").innerHTML = (!panel && (sub || settingDesc) && revealed)
          ? (sub ? `<div class="d-sub${preloading ? " d-warn" : ""}${it.userSub ? " il-usub" : ""}">${esc(sub)}</div>` : "") + settingDesc + warnLine : autoLogHTML(it);
        it._labelDirty = true;
      }
    }
    if (panel) this._showPanel(it, sx, h, title, sub);
    else this._hidePanel();
  }

  // the description rectangle of a content-info item (PS Store, What's New,
  // Sign Up, Photo Gallery…): fades in, fixed beside the spine.
  _showPanel(it, sx, h, title, sub) {
    const d = this.$detail;
    const w = this.root.clientWidth;
    const html = `<div class="dp-title">${esc(title || "")}</div><div class="dp-body">${esc(sub || "")}</div>`;
    d.style.left = `${sx + (150 / 1920) * w}px`;
    d.style.top = `${h * (417 / 1080)}px`;
    d.classList.toggle("dp-gallery", it.act === "photogallery" || /gallery/i.test(it.title || ""));
    d.classList.toggle("dp-home", it.panel === "home");
    d.classList.toggle("dp-plain", !!it.panelPlain);
    if (d._html !== html) { d.innerHTML = html; d._html = html; }
    if (!d.classList.contains("d-panel")) {
      d.classList.add("d-panel");
      void d.offsetWidth;                              // start the fade from 0
    }
    d.classList.add("d-show");
    this.$items.classList.add("panel-on");
  }
  _hidePanel() {
    const d = this.$detail;
    if (!d) return;
    d.classList.remove("d-show", "d-panel");
    d.innerHTML = ""; d._html = "";
    this.$items && this.$items.classList.remove("panel-on");
  }

  // --------------------------------------------------------- selection FX
  _onSelect() {
    this._syncGlowPulse();
    if (window.__syncGlows) window.__syncGlows();   // (main.js: every glow on one clock)
    this._armIdle();
    clearTimeout(this.dwellTimer); this._stopGameMedia(); this._reveal = false;
    const it = this._level().items[this._level().sel];
    // the disc game shows the disc (no background or music) for its first 3 s
    // selected, then its own icon (or GIF), background and music
    if (this._discShown && this._discShown !== it) {
      const im = this._discShown._el && this._discShown._el.querySelector(".art-img");
      if (im) { im.src = this._discShown.icon.art; im.classList.add("disc-img"); }
      this._discShown = null;
    }
    if (this.$items) {
      this.$items.querySelectorAll(".item.cinfo-glow, .item.revealed, .item.bg-notitle").forEach((e) => e.classList.remove("cinfo-glow", "revealed", "bg-notitle"));
      this.$items.classList.remove("panel-home");
    }
    // Always clear any backdrop first, so a previous subsection's background /
    // description never lingers (e.g. moving into the empty Friends column).
    this.wave.setHidden(false); this.$bg.classList.remove("show"); this.$bg.style.backgroundImage = "";
    if (!it) { this._applyBgMusic(); this._refreshDetail(); return; }
    this._applyBgMusic();
    if (it.kind === "game" || it.extra) {
      const disc = !!(it.icon && it.icon.disc);
      this.dwellTimer = setTimeout(() => {
        if (disc && it.icon.real && it._el) {
          const im = it._el.querySelector(".art-img");
          if (im) { im.src = it.icon.real; im.classList.remove("disc-img"); }
          this._discShown = it;
        }
        this._revealGame(it);
      }, disc ? DISC_HOLD_MS : DWELL_MS);
      this._refreshDetail(); return;
    }
    // Content-info subsections (PSN / Store / Photo Gallery) reveal their
    // full-screen cinfo backdrop AND their description rectangle only after the
    // same dwell delay the games use.
    if (it.bg || it.panel) {
      this.dwellTimer = setTimeout(() => {
        if (this._level().items[this._level().sel] !== it) return;   // moved away
        this._reveal = true;
        if (it.bg) {
          // (the wave stays until the picture has actually loaded: no black gap)
          const url = `./assets/cinfo/${it.bg}`, im = new Image();
          im.onload = () => {
            const l = this._level(); if (l.items[l.sel] !== it || !this._reveal) return;
            this.$bg.style.backgroundImage = `url("${url}")`;
            this.$bg.classList.add("show"); this._syncWaveHidden();
          };
          im.src = url;
        }
        // What's New / My Channels: once their backdrop is up, the icon's
        // outline glows (twice as fast as a selected title's glow)
        if (it._el && /^(What's New|My Channels)$/.test(it.title || "")) it._el.classList.add("cinfo-glow");
        this._refreshDetail();
      }, DWELL_MS);
    }
    this._refreshDetail();
  }

  // ------------------------------------------------------------- navigation
  _gotoCat(i) {
    if (i === this.selCat) return;
    this.audio.play(i > this.selCat ? "cursor_down" : "cursor_up", 0.5);
    // Remember the top-level position in the column we're leaving, and restore
    // the remembered one for the column we're entering (T15).
    if (!this._colSel) this._colSel = {};
    if (this.levels.length === 1) this._colSel[this.columns[this.selCat].id] = this.levels[0].sel;
    this.selCat = i;
    const items = this.columns[i].items;
    let sel = this._colSel[this.columns[i].id] ?? 0;
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    this.levels = [{ items, sel }];
    const w = this.root.clientWidth, h = this.root.clientHeight;
    this._layoutCats(w, h);   // categories slide (CSS transition) rather than snap
    this.$crumb.classList.remove("show");
    this._renderItems(w, h);
    this._onSelect();
    this._liveRefresh(this.columns[i].id);
  }

  _drill(it) {
    this.audio.play("enter", 0.6);
    // childrenFn lets a submenu compute its items fresh each time it opens (used
    // by Saved Presets, which changes as presets are added/removed).
    const children = it.childrenFn ? it.childrenFn.call(this) : it.children;
    const friendMenu = it.childrenFn === this._friendPersonalizationItems;
    // a folder of pictures: shown as a grid, five to a row (as on the console)
    const grid = (children || []).length > 0 && children.every((c) => c.kind === "photo");
    const snap = this._drillSnap();
    this.levels.push({ items: children, sel: 0, head: { icon: it.icon, label: it.title }, friendMenu, grid, inFolder: true,
      rebuild: it.childrenFn ? () => it.childrenFn.call(this) : null });
    this._render(); this._onSelect();
    this._drillAnim(snap, 1);
  }
  _back() {
    if (this.overlay) return;
    if (this.levels.length > 1) {
      this.audio.play("back", 0.5);
      const snap = this._drillSnap();
      const leaving = this.levels.pop();
      // leaving Friend Personalization → apply count/mode/card changes now
      if (leaving && leaving.friendMenu && this._friendMenuDirty) this._refreshFriendsColumn();
      this._render(); this._onSelect();
      this._drillAnim(snap, -1);
    }
  }
  // Going into a menu and back out of it moves, as on the console: the chosen
  // row slides to its place on the left (or back to the middle), the rows
  // around it slide with it and dim, the categories gather (or spread out), and
  // the opened list comes in from the right (or goes back out to it). The menu
  // is drawn anew each time, so where everything was is noted first
  // (_drillSnap) and the new rows start from there (_drillAnim), using the
  // menu's own movement.
  _drillSnap() {
    const pos = (el) => el && el.isConnected ? { left: el.style.left, top: el.style.top, opacity: el.style.opacity } : null;
    const active = this.levels[this.levels.length - 1];
    const snap = { active, anchors: new Map(), ghosts: new Map(), items: new Map(), cats: new Map(), old: [] };
    for (const lvl of this.levels) {
      if (lvl !== active && lvl._anchorEl) snap.anchors.set(lvl, pos(lvl._anchorEl));
      if (lvl !== active && lvl._ghosts) for (const g of lvl._ghosts) snap.ghosts.set(lvl.items[g.j], pos(g.el));
    }
    if (active) for (const it of active.items) if (it && it._el && it._el.isConnected) { snap.items.set(it, pos(it._el)); snap.old.push(it._el); }
    (this.columns || []).forEach((c) => { if (c._el) snap.cats.set(c, pos(c._el)); });
    return snap;
  }
  _drillAnim(snap, dir) {
    if (!snap || !this.$items) return;
    const w = this.root.clientWidth;
    const moved = [];
    // (an element put where it was, then let go: it moves to its new place)
    const from = (el, p, dx = 0, opacity = null, stay = false) => {
      if (!el || !p || !p.left) return;
      // (stay: only fades, where it was)
      moved.push([el, stay ? null : el.style.left, stay ? null : el.style.top, el.style.opacity]);
      el.style.transition = "none"; el.classList.remove("fresh");   // (a new row: it moves at once)
      el.style.left = `${(parseFloat(p.left) || 0) + dx}px`; el.style.top = p.top;
      el.style.opacity = opacity != null ? opacity : p.opacity;
    };
    const active = this.levels[this.levels.length - 1];
    // the chosen category moves with the menu; the others fade where they are
    (this.columns || []).forEach((c, i) => {
      const p = snap.cats.get(c); if (!c._el || !p) return;
      if (i === this.selCat) from(c._el, p);
      else if (dir > 0) from(c._el, p, 0, null, true);
      else from(c._el, { left: c._el.style.left, top: c._el.style.top }, 0, "0");
    });
    for (const lvl of this.levels) {
      if (lvl !== active && lvl._anchorEl) {
        // an ancestor: from where it was, or (just opened) from its row in the list
        from(lvl._anchorEl, snap.anchors.get(lvl) || (lvl === snap.active ? snap.items.get(lvl.items[lvl.sel]) : null));
        if (lvl._ghosts) for (const g of lvl._ghosts) {
          const it = lvl.items[g.j];
          from(g.el, snap.ghosts.get(it) || snap.items.get(it));
        }
      }
    }
    if (active && !active.grid) {
      const back = dir < 0;
      for (const it of active.items) {
        if (!it || !it._el) continue;
        if (back) {
          // the list we're back in: its rows come back from the left
          const isSel = it === active.items[active.sel];
          const p = isSel ? snap.anchors.get(active) : snap.ghosts.get(it);
          if (p) from(it._el, p, 0, isSel ? null : "0");
          else if (!isSel && it._el.style.left) from(it._el, { left: it._el.style.left, top: it._el.style.top }, -0.04 * w, "0");
        } else {
          // the list just opened: in from the right
          const L = it._el.style.left, T = it._el.style.top;
          if (L) from(it._el, { left: L, top: T }, 0.06 * w, "0");
        }
      }
    } else if (active && active.grid) {
      for (const it of active.items) if (it && it._el) from(it._el, { left: it._el.style.left, top: it._el.style.top }, dir > 0 ? 0.06 * w : 0, "0");
    }
    // the list we left: back out to the right, fading
    const leaving = dir < 0 ? snap.old.filter((el) => !el.isConnected) : [];
    for (const el of leaving) { el.style.transition = "none"; this.$items.appendChild(el); el.style.pointerEvents = "none"; }
    if (!moved.length && !leaving.length) return;
    void this.$items.offsetWidth;
    for (const [el, L, T, O] of moved) { el.style.transition = ""; if (L != null) { el.style.left = L; el.style.top = T; } el.style.opacity = O; }
    for (const el of leaving) {
      el.style.transition = "";
      el.style.left = `${(parseFloat(el.style.left) || 0) + 0.06 * w}px`; el.style.opacity = "0";
      setTimeout(() => { if (!this.$items || !this.$items.contains(el)) return; el.remove(); }, 320);
    }
  }

  _activate() {
    const it = this._level().items[this._level().sel];
    if (!it) return;
    switch (it.kind) {
      case "drill": this._drill(it); break;
      case "game": this.audio.play("enter", 0.6); if (it.appMode) this._launchApp(it.game); else this._launch(it.game); break;
      case "user":
        // logged in: the user who's logged in asks to log out, another one asks to switch
        if (this.user && !this.locked) { if (it.user.id === this.user.id) this._askLogOut(it.user); else this._askSwitchUser(it.user); }
        else this._signIn(it.user);
        break;
      case "newuser": this._newUser(); break;
      case "setting": this._settingMenu(it); break;
      case "action": return this._runAction(it.act, it);
      case "playercard": this._psnProfile(); break;
      case "friendcard": this.audio.play("enter", 0.4); break;
      case "music": this._openMusicPlayer(); break;
      case "photo": this._openViewer("photo", it.media); break;
      case "video": this._openViewer("video", it.media); break;
      default: this.audio.play("error", 0.5);
    }
  }

  _options() {
    const it = this._level().items[this._level().sel];
    if (!it) return;
    if (it.kind === "game") this._gameOptions(it.game);
    else if (it.kind === "user") this._userOptions(it.user);
    else if (it.psnAuth) this._accountOptions(it);
    else if (it.kind === "playercard") this._psnProfile();
    else if (it.opts && it.opts.length) this._itemOptions(it);
  }
  // Generic options (triangle) menu for an item that carries `opts`
  // ([{act,label}]): e.g. Sign Out on Account Management.
  _itemOptions(it) {
    this.overlay = this.sideMenu;
    this.sideMenu.open(it.opts.map((o) => ({ label: o.label, id: o.act })), { title: it.title },
      (choice) => { this.sideMenu.close(); this.overlay = null; this._runAction(choice.id); },
      () => { this.sideMenu.close(); this.overlay = null; });
  }
  _persistUser() { call("save_user", { user: this.user }); this.cbs.onProfileChange(this.user); }
  // The System can't save in its own folder (installed in Program Files with
  // the .msi): users, settings, recognized games and media, and the log aren't kept
  warnNotWritable(dir) {
    const show = () => {
      if (this.overlay) { setTimeout(show, 500); return; }
      this.overlay = this.confirm;
      this.audio.play("error", 0.5);
      this.confirm.open(`MaXMB can't save anything in its folder:\n${dir}\n\nUsers, settings, recognized games and media, and the log won't be kept. This happens when it's installed in Program Files (the .msi installer). Install it with the .exe installer, or in a folder you can write to.`,
        [{ label: "OK", id: "ok" }], () => { this.confirm.close(); this.overlay = null; }, () => { this.confirm.close(); this.overlay = null; });
    };
    show();
  }
  _persistSettings() { const p = call("save_settings", { settings: this.settings }).catch(() => {}); this._snapshotUserSettings(); return p; }
  // Loading: only the background and the clock show, its hands sweeping round;
  // when it's done they return to the time and everything else fades back in.
  _loadingBegin() {
    if (this._loadingOn) return;
    this._loadingOn = true;
    document.body.classList.add("clock-loading");
    this.cbs.infobox && this.cbs.infobox.startSpin();
  }
  async _loadingSettle() { if (this._loadingOn && this.cbs.infobox) await this.cbs.infobox.stopSpin(); }
  // end the loading screen at once (the clock settles on its own, hidden by the menu)
  _loadingQuit() { if (this._loadingOn && this.cbs.infobox) this.cbs.infobox.stopSpin(); this._loadingDone(); }
  _loadingDone() { if (!this._loadingOn) return; this._loadingOn = false; document.body.classList.remove("clock-loading"); }
  // Something chosen (✕, △, □ or a menu's choice) that keeps working
  // afterwards (reading folders, grouping media, drawing the menus again...):
  // the menu doesn't move until it's done, and when it takes more than a
  // moment the clock's hands sweep round meanwhile (everything else stays as it is).
  // While it waits for you (a menu, a dialog, a file picker, a player) it
  // neither shows nor holds anything.
  _trackBusy(r) {
    if (!r || typeof r.then !== "function") return r;
    const job = {};
    (this._busyJobs ||= new Set()).add(job);
    const end = () => { this._busyJobs.delete(job); this._busyPump(); };
    r.then(end, end);
    this._busyPump();
    return r;
  }
  _busyWaitsForUser() {
    return !!(this.overlay || this._placing || Input.picking || this._launching || this._inGame || this._browserActive
      || this._signingIn || this._preloadState === "loading" || this.locked);
  }
  _busyPump() {
    const jobs = this._busyJobs && this._busyJobs.size;
    const active = !!jobs && !this._busyWaitsForUser();
    const now = performance.now();
    if (active && !this._actBusy) this._busySince = now;
    // (a safety: nothing holds the menu for more than a minute)
    const stuck = active && now - this._busySince > 60000;
    this._actBusy = active && !stuck;
    const ib = this.cbs.infobox;
    if (this._actBusy && !this._busyClock && !this._loadingOn && now - this._busySince > 300) { this._busyClock = true; ib && ib.startSpin(); }
    // done (or waiting for you): the hands come round to the time
    if (!this._actBusy && this._busyClock) { this._busyClock = false; if (!this._loadingOn) ib && ib.stopSpin(); }
    clearTimeout(this._busyT);
    if (jobs) this._busyT = setTimeout(() => this._busyPump(), 100);
  }

  // ------------------------------------------------------------- PSN flow
  _runAction(act, it) {
    if (act && act.startsWith("bgpl_new::")) return this._bgPlaylistNew(act.slice(10));
    if (act && act.startsWith("bgpl_edit::")) { const [w, i] = act.slice(11).split("::"); return this._bgPlaylistEdit(w, parseInt(i, 10)); }
    if (act && act.startsWith("bgpl_del::")) { const [w, i] = act.slice(10).split("::"); return this._bgPlaylistDelete(w, parseInt(i, 10)); }
    if (act === "theme_custom_create") return this._createCustomTheme();
    if (act && act.startsWith("theme_extract::")) return this._extractTheme(act.slice("theme_extract::".length));
    if (act && act.startsWith("theme_use::")) { const [kind, ...k] = act.slice(11).split("::"); return this._themeUse(kind, k.join("::")); }
    if (act && act.startsWith("wave_delete::")) return this._deleteWavePreset(parseInt(act.slice("wave_delete::".length), 10));
    if (act && act.startsWith("theme_delete::")) return this._deleteThemePreset(parseInt(act.slice("theme_delete::".length), 10));
    if (act && act.startsWith("playlist_add::")) return this._editPlaylistAdd(act.slice("playlist_add::".length));
    if (act && act.startsWith("playlist_remove::")) return this._editPlaylistRemove(act.slice("playlist_remove::".length));
    if (act && act.startsWith("friend_card_edit::")) return this._friendCardMenu(parseInt(act.slice("friend_card_edit::".length), 10));
    if (act && act.startsWith("cache_clear::")) return this._clearCache(act.slice("cache_clear::".length));
    if (act && act.startsWith("media_pick::")) return this._mediaPick(act.slice("media_pick::".length));
    if (act && act.startsWith("media_recog::")) return this._mediaRecognize(act.slice("media_recog::".length));
    if (act && act.startsWith("intro_art::")) return this._introArtMenu(act.slice("intro_art::".length));
    if (act && act.startsWith("gmm::")) { const [, k, ...f] = act.split("::"); return this._gameMediaMenu(k, f.join("::")); }
    if (act && act.startsWith("scrape_key::")) return this._scrapeKeyEdit(act.slice("scrape_key::".length));
    if (act && act.startsWith("gm_scrape::")) return this._gameScrape(act.slice("gm_scrape::".length));
    if (act && act.startsWith("media_rm::")) { const [k, i] = act.slice(10).split("::"); return this._mediaRemove(k, parseInt(i, 10)); }
    if (act && act.startsWith("gsrc_remove::")) return this._gsrcRemove(parseInt(act.slice("gsrc_remove::".length), 10));
    if (act && act.startsWith("gsrc_del::")) return this._gsrcDelete(act.slice("gsrc_del::".length));
    if (act && act.startsWith("gman_del::")) return this._gmanDelete(act.slice("gman_del::".length));
    if (act && /^(sec|sub)_/.test(act)) return this._sectionAction(act);
    if (act === "gsrc_add") return this._gsrcAdd();
    if (act === "gsrc_scan") return this._gsrcScan(false);
    switch (act) {
      case "psplus_toggle": {   // ✕ only: the player's own PS Plus mark (card + info box)
        const c = this._friendCfg(); c.playerPlus = !c.playerPlus; this.user.friendConfig = c; this._persistUser();
        this.audio.play("enter", 0.4); return;
      }
      case "friend_card_new": return this._friendCardEditor(null);
      case "player_level": return this._editPlayerLevel();
      case "wave_save": return this._saveWavePreset();
      case "wave_load": return this._loadWavePreset(it && it.preset);
      case "theme_save": return this._saveThemePreset();
      case "theme_reset": return this._resetThemeSettings();
      case "theme_load": return this._loadThemePreset(it && it.tpreset);
      case "inet_browser": return this._openInternet("browser");
      case "youtube": return this._openInternet("url", "https://www.youtube.com/");
      case "launch_home": if (this._homeGame) { this.audio.play("enter", 0.6); this._launch(this._homeGame); } return;
      case "inet_search": return this._openInternet("search");
      // (the old WebView2 in-app browser was removed; _openInternet is a
      //  placeholder until the new bundled-engine browser is built)
      case "psn_signup": return this._psnSignUp();
      case "psn_signin": return this._psnSignIn();
      case "psn_signout": return this._psnSignOut();
      case "psn_editid": return this._psnEditId();
      case "psn_avatar": return this._psnAvatar();
      case "theme_bgimage": return this._themeBgImage();
      case "bgpl_new": return this._bgPlaylistNew();
      case "keybinds": return this._openKeybinds();
      case "theme_overlay": return this._themeOverlay();
      case "theme_overlayremove": return this._themeOverlayRemove();
      case "theme_bgremove": return this._themeBgRemove();
      case "wave_reset": return this._resetWaveParams();
      case "turnoff": return this._turnOff();
      case "bgmusic": return this._selectBgMusic();
      case "preload": return this._preloadAllSongs();
      case "preloadvideos": return this._preloadAllVideos();
      case "playlist_create": return this._createPlaylist();
      case "photo_playlist_create": return this._createPhotoPlaylist();
      case "photo_slideshow": return this._playPhotoSlideshow(it && it.playlist);
      case "photo_gallery": return this._openPhotoGallery();
    }
  }
  // Internet Browser / Internet Search.
  //
  // LibreWolf runs on your own profile in a borderless, centered square window
  // that the Rust side keeps pinned over the app; the helper extension inside
  // LibreWolf opens your default search engine / home page and carries out the
  // controller commands. Controls while browsing:
  //   left stick = pointer, ✕ = press (hold and move to grab), right stick =
  //   scroll, ○ = close the current window (held: exit the browser), START =
  //   enter an address, L1/R1 = back/forward, L2/R2 = the window on the
  //   left/right, L3 = full screen on/off. Focusing a page text field (with a
  //   controller) opens the on-screen keyboard, prefilled with the field's text.
  get browserActive() { return !!this._browserActive; }
  // the page is up and showing (not loading, no on-screen keyboard over it)
  get browserLive() { return !!(this._browserActive && this._br && this._br.ready && !this._brOskOpen); }

  // ---- Screenshots: the whole app (and the browser window over it) is saved
  // to the Photos folder as "Screenshot - <date> <time>", following the chosen
  // Date Format / Time Format.
  async screenshot() {
    if (this._shotBusy) return;
    this._shotBusy = true;
    const b = this.settings?.behavior || {};
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    const dd = p2(d.getDate()), mm = p2(d.getMonth() + 1), yy = d.getFullYear();
    const fmt = b.dateFormat || "DD/MM/YYYY";
    // file names can't hold "/" or ":", so look-alike characters stand in:
    // "⧸" (big solidus) between the date's parts, "∶" (ratio) in the time
    const SL = "\u29F8", CO = "\u2236";
    const date = fmt === "MM/DD/YYYY" ? `${mm}${SL}${dd}${SL}${yy}` : fmt === "YYYY/MM/DD" ? `${yy}${SL}${mm}${SL}${dd}` : `${dd}${SL}${mm}${SL}${yy}`;
    const ss = p2(d.getSeconds());
    let time;
    if ((b.timeFormat || "24") === "12") { const h = d.getHours(), h12 = h % 12 || 12; time = `${p2(h12)}${CO}${p2(d.getMinutes())}${CO}${ss} ${h < 12 ? "AM" : "PM"}`; }
    else time = `${p2(d.getHours())}${CO}${p2(d.getMinutes())}${CO}${ss}`;
    try {
      await call("take_screenshot", { name: `Screenshot - ${date} ${time}` });
      this.audio.play("enter", 0.5);
      this._shotFeedback("Screenshot saved to Photos");
      this._refreshPhotoColumn();
    } catch (e) {
      this.audio.play("error", 0.4);
      this._shotFeedback("Couldn't take the screenshot");
    }
    setTimeout(() => { this._shotBusy = false; }, 600);
  }
  _shotFeedback(msg) {
    let fl = document.querySelector(".shot-flash"), t = document.querySelector(".shot-toast");
    if (!fl) { fl = document.createElement("div"); fl.className = "shot-flash"; document.body.appendChild(fl); }
    if (!t) { t = document.createElement("div"); t.className = "shot-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    fl.classList.add("on"); requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove("on")));
    t.classList.add("on"); clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove("on"), 2200);
  }
  _turnOff() {
    // PS3 asks before powering down; Yes closes the app. Centred title with a
    // horizontal Yes/No, matching the real XMB confirm dialog.
    this.overlay = this.confirm;
    this.confirm.open(
      "Do you want to turn off the system?",
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      (choice) => {
        this.confirm.close(); this.overlay = null;
        if (choice && choice.id === "yes") { this.audio.play("enter", 0.6); call("quit_app"); }
      },
      () => { this.confirm.close(); this.overlay = null; });
  }

  // Left/right handling. On a setting, adjust it in place and stay put. Inside a
  // drilled submenu the side keys do NOTHING else: a submenu is left ONLY with
  // Circle / Esc (the "back" action), never with Left. At the top level the side
  // keys move between category columns.
  // moving in a picture grid (rows of five; it's left only with Circle)
  _gridMove(d) {
    const lvl = this._level(), w = this.root.clientWidth, h = this.root.clientHeight;
    let n = lvl.sel + d;
    if (Math.abs(d) >= GRID_COLS && d % GRID_COLS === 0) {
      // (several rows at once while held: up to the first / last row)
      if (n < 0) { if (Math.abs(d) === GRID_COLS || lvl.sel < GRID_COLS) return; n = lvl.sel % GRID_COLS; }
      if (n >= lvl.items.length) { if (Math.floor(lvl.sel / GRID_COLS) === Math.floor((lvl.items.length - 1) / GRID_COLS)) return; n = lvl.items.length - 1; }
    } else if (n < 0 || n >= lvl.items.length) return;
    lvl.sel = n;
    this.audio.play(d < 0 ? "cursor_up" : "cursor_down", 0.5);
    this._layoutItems(w, h); this._onSelect();
  }
  _navSide(dir) {
    if (this._level().grid && !this.overlay) {
      const lvl = this._level();
      // only Circle leaves the folder: left stops at the first column
      if (dir < 0 && lvl.sel % GRID_COLS === 0) return;
      if (dir > 0 && (lvl.sel % GRID_COLS === GRID_COLS - 1 || lvl.sel >= lvl.items.length - 1)) return;
      this._gridMove(dir); return;
    }
    const it = this._level().items[this._level().sel];
    // settings are changed only from their menu (✕)
    if (it?.kind === "setting") {
      return;
    }
    if (this.levels.length > 1) return;   // inside a submenu: side keys do nothing
    const ni = this.selCat + dir;
    if (!this.locked && ni >= 0 && ni < this.columns.length) this._gotoCat(ni);
  }

  // ------------------------------------------------------------------ input
  // Low performance mode: 1 while the app is out of focus, 2 while a game runs
  // (the wave slows down / stops, animations and background videos pause)
  setLowPower(level) {
    if (this._inGame && level < 2) level = 2;
    // Power Save Settings: off (a running game still stops everything)
    if (!this.settings?.behavior?.lowPowerMode && !this._inGame) level = 0;
    if (this._lowPower === level) return;
    this._lowPower = level;
    this.wave.setLowPower(level);
    document.body.classList.toggle("lowpower", level > 0);
    // everything on screen holds still (sound, the clock box and loading icons
    // aside): muted videos (background, overlay, game / video previews) pause,
    // GIFs freeze on the frame they're showing, CSS animations pause (styles.css)
    for (const v of document.querySelectorAll("video")) {
      if (v.closest("#mediaview") || !v.muted && !v.closest("#wallpaper, #overlay")) continue;   // the Video Player keeps playing
      if (level > 0) { if (!v.paused) { v.pause(); v._lpPaused = true; } }
      else if (v._lpPaused) {
        v._lpPaused = false;
        // (covered by the Photo Viewer / Video Player: it starts when they close)
        if (this._bgCovered && v.closest("#wallpaper, #overlay")) v._cover = { t: v.currentTime || 0, at: performance.now() };
        else v.play().catch(() => {});
      }
    }
    if (level > 0) this._freezeGifs(); else this._thawGifs();
    if (!level && window.__syncGlows) window.__syncGlows();   // (the glows carry on together)
  }
  _bgVideos() { return [...document.querySelectorAll("#wallpaper video, #overlay video")]; }
  _coverBgVideos(on) {
    if (!!this._bgCovered === on) return;
    this._bgCovered = on;
    const now = performance.now();
    for (const v of this._bgVideos()) {
      if (on) {
        if (!v.paused) { v._cover = { t: v.currentTime || 0, at: now }; v.pause(); }
        continue;
      }
      const c = v._cover; if (!c) continue;
      v._cover = null;
      // where it would be by now (a looping video goes round)
      let t = c.t + (now - c.at) / 1000;
      const d = v.duration;
      if (isFinite(d) && d > 0) t = v.loop ? t % d : Math.min(t, d);
      try { v.currentTime = t; } catch (e) {}
      // (with low performance mode on, it stays paused until that ends)
      if (this._lowPower > 0) v._lpPaused = true; else v.play().catch(() => {});
    }
  }
  // A GIF can't be paused, so a canvas showing its current frame takes its
  // place (same box, transform and fit) until low performance mode ends.
  _freezeGifs() {
    const isGif = (src) => /\.gif([?#]|$)/i.test(src || "") || /^data:image\/gif/i.test(src || "");
    for (const img of document.querySelectorAll("img")) {
      if (img._lpCanvas || !isGif(img.currentSrc || img.src) || !img.complete || !img.naturalWidth) continue;
      if (img.closest("#infobox") || img.offsetParent === null) continue;
      const cs = getComputedStyle(img), w = img.offsetWidth, h = img.offsetHeight;
      if (!w || !h) continue;
      const c = document.createElement("canvas"), dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const ctx = c.getContext("2d"), nw = img.naturalWidth, nh = img.naturalHeight;
      const fit = cs.objectFit;
      let k = fit === "cover" ? Math.max(w / nw, h / nh) : fit === "contain" || fit === "scale-down" ? Math.min(w / nw, h / nh) : null;
      if (fit === "scale-down") k = Math.min(1, k);
      const dw = k ? nw * k : w, dh = k ? nh * k : h;
      try { ctx.drawImage(img, (w - dw) / 2 * dpr, (h - dh) / 2 * dpr, dw * dpr, dh * dpr); } catch (e) { continue; }
      Object.assign(c.style, { position: "absolute", left: `${img.offsetLeft}px`, top: `${img.offsetTop}px`, width: `${w}px`, height: `${h}px`,
        margin: "0", transform: cs.transform === "none" ? "" : cs.transform, transformOrigin: cs.transformOrigin, opacity: cs.opacity,
        filter: cs.filter === "none" ? "" : cs.filter, borderRadius: cs.borderRadius, zIndex: cs.zIndex === "auto" ? "" : cs.zIndex, pointerEvents: "none" });
      c.className = "lp-frozen";
      img.insertAdjacentElement("afterend", c);
      img._lpCanvas = c; img._lpVis = img.style.visibility; img.style.visibility = "hidden";
      this._frozen = this._frozen || new Set(); this._frozen.add(img);
    }
  }
  _thawGifs() {
    for (const img of this._frozen || []) {
      if (img._lpCanvas) img._lpCanvas.remove();
      img._lpCanvas = null; img.style.visibility = img._lpVis || "";
    }
    this._frozen = null;
  }
  setContext(settings, appInfo) { this.settings = settings; this.appInfo = appInfo; VIRTUAL_KB.on = settings?.behavior?.virtualKeyboard !== false; }

  // After 4 s without any action on one row, the other rows' titles fade out
  // (Photo, Music, Video, Game, Network and PSN). Any action brings them back.
  _armIdle() {
    clearTimeout(this._idleT);
    if (this.$items) this.$items.classList.remove("labels-idle");
    const col = this.columns && this.columns[this.selCat];
    if (!col || !IDLE_FADE_COLS.includes(col.id) || this.overlay) return;
    const lvl = this._level(); const it = lvl && lvl.items[lvl.sel];
    if (!it) return;
    this._idleT = setTimeout(() => {
      const l2 = this._level();
      if (!this.overlay && l2 && l2.items[l2.sel] === it && this.$items) this.$items.classList.add("labels-idle");
    }, 4000);
  }

  onInput(a) {
    this._armIdle(); this._inputAt = performance.now();
    // while Preload All Songs is running, the menu is locked: no navigation,
    // no leaving, no other action until it finishes.
    if (this._preloadState === "loading" || this._busy || this._signingIn || this._launching) return;
    if (this.overlay) { this.overlay.onInput(a); return; }
    if (this._placing) { this._placeInput(a); return; }     // moving a section
    if (this._busy) return;                                   // converting a video
    if (this._actBusy) return;                                // something chosen is still working (see _trackBusy)
    if (a !== "up" && a !== "down") this._glideEnd(true);
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const lvl = this._level();
    switch (a) {
      case "left": this._navSide(-1); break;
      case "right": this._navSide(1); break;
      // (held: long lists speed up step by step, like a number setting does:
      // a step of up to a tenth of the list, so short menus move one by one)
      case "up": case "down": {
        const d = a === "up" ? -1 : 1, n = lvl.items.length;
        const k = holdAccel("xmb-list:" + a, lvl.grid ? Math.floor(n / GRID_COLS / 10) : Math.floor(n / 10));
        // (sped up: the list scrolls there row by row, see _glide)
        if (k > 1 || (this._gl && this._gl.lvl === lvl && this._gl.d === d)) { this._glideBy(lvl, d, k); break; }
        this._heldStep(lvl);
        if (lvl.grid) { this._gridMove(d * GRID_COLS * k); break; }
        const to = Math.max(0, Math.min(n - 1, lvl.sel + d * k));
        if (to !== lvl.sel) {
          lvl.sel = to; this.audio.play(d < 0 ? "cursor_up" : "cursor_down", 0.5); this._layoutItems(w, h); this._onSelect();
        }
        break;
      }
      case "enter": this._trackBusy(this._activate()); break;
      case "options": this._trackBusy(this._options()); break;
      case "square": this._trackBusy(this._cycleMediaMode()); break;
      case "back": this._back(); break;
    }
  }

  // The columns where a held Up / Down can scroll far (Music, Photo, Video,
  // Game, Friends and your own sections): there, once the hovered row starts
  // to fall behind its place while scrolling, the rows are put in place at
  // once instead of sliding (see _glideStep); elsewhere they always slide
  _snapScroll() {
    const id = this.columns?.[this.selCat]?.id || "";
    return ["music", "photo", "video", "game", "friends"].includes(id) || id.startsWith("sec:");
  }
  // A held Up / Down (not separate presses, however quick) in those columns:
  // once the hovered row has fallen further behind its place than one step
  // slides it (see _behind), the rows are put in place at once until the
  // button is let go
  _heldStep(lvl) {
    if (!window.__inputRepeat || !this._snapScroll() || !this.$items) { this._holdSnap = false; return; }
    if (!this._holdSnap) {
      const drift = this._selDrift(lvl);
      if (drift == null || drift <= this._behind(lvl)) return;
      this._holdSnap = true;
    }
    this.$items.classList.add("glide", "glide-fast");
    clearTimeout(this._glideT);
    // (let go: the usual easing back once the last rows are in place)
    this._glideT = setTimeout(() => {
      this._holdSnap = false;
      if (!this._gl) { this.$items.classList.remove("glide", "glide-fast"); if (this._lazyEls && this._lazyEls.size) this._lazyArtSoon(); }
    }, 240);
  }
  // how far behind the hovered row may be: a step's own slide (from the next
  // row's place to the hovered one's) and half a row more; past it, it was
  // falling further behind with every step (the list looked shifted)
  _behind(lvl) {
    const k = lvl.grid ? GRID_COLS : 1, T = (i) => parseFloat(lvl.items[i]?._el?.style.top);
    const s = lvl.sel, n = lvl.items.length, o = s + 2 * k < n ? 1 : -1;
    const step = Math.abs(T(s + o * k) - T(s)), row = Math.abs(T(s + 2 * o * k) - T(s + o * k));
    return Number.isFinite(step) && Number.isFinite(row) && step > 0 ? step + row / 2 : this.root.clientHeight * 0.16;
  }
  // how far (px) the hovered row is from its place (where it's sliding to;
  // null: not on screen)
  _selDrift(lvl) {
    const el = lvl.items[lvl.sel]?._el;
    if (!el || !el.style.top) return null;
    return Math.abs(parseFloat(getComputedStyle(el).top) - parseFloat(el.style.top));
  }
  // Held Up / Down in a long list, sped up: instead of jumping several rows
  // at once (which looked like a few still pictures), the selection moves
  // row by row, a few rows a frame, spread over the time until the next
  // repeat, with the rows sliding linearly (.item-col.glide), so the list is
  // seen scrolling. The selected item's details (backdrop, preview, info)
  // follow once it stops.
  _glideBy(lvl, d, k) {
    let g = this._gl;
    if (!g || g.lvl !== lvl || g.d !== d) {
      if (g) this._glideEnd(true);
      // (still held: the details wait for the end)
      clearTimeout(this._glideSelT); this._glPend = null;
      g = this._gl = { lvl, d, left: 0, watch: this._snapScroll(), snap: !!this._holdSnap }; this.$items.classList.add("glide");
    }
    // (never far behind the button: what's left over a few repeats at most)
    g.left = Math.min(g.left + k, k * 3);
    // (spread over about one repeat's time, 130 ms, whatever the frame rate)
    g.last = performance.now(); g.until = g.last + 130;
    this.audio.play(d < 0 ? "cursor_up" : "cursor_down", 0.5);
    if (!g.raf) g.raf = requestAnimationFrame(() => this._glideStep());
  }
  _glideStep() {
    const g = this._gl; if (!g) return;
    g.raf = 0;
    const lvl = g.lvl;
    if (lvl !== this._level() || this.overlay) { this._glideEnd(); return; }
    const now = performance.now(), share = Math.min(1, (now - g.last) / Math.max(1, g.until - g.last));
    const steps = Math.min(g.left, Math.max(1, Math.round(g.left * share)));
    g.left -= steps; g.last = now;
    const n = lvl.items.length;
    let to;
    if (lvl.grid) {
      const rows = Math.ceil(n / GRID_COLS), row = Math.floor(lvl.sel / GRID_COLS), r2 = Math.max(0, Math.min(rows - 1, row + g.d * steps));
      to = Math.min(n - 1, r2 * GRID_COLS + lvl.sel % GRID_COLS);
    } else to = Math.max(0, Math.min(n - 1, lvl.sel + g.d * steps));
    const moved = to !== lvl.sel;
    // (more than a couple of rows this frame: they're put in place, not slid,
    // or every row would be in mid-flight and the list would look empty)
    // In the media / game / Friends columns, once the hovered row has fallen
    // behind its place (more than a step's slide: sliding, it trailed further and
    // further and the list looked empty in places), the rows are put in place
    // every frame for the rest of the scroll, so it stays where it rests
    if (!g.snap && g.watch) {
      const drift = this._selDrift(lvl);
      if (drift != null && drift > this._behind(lvl)) g.snap = true;
    }
    this.$items.classList.toggle("glide-fast", !!g.snap || steps > 2);
    if (moved) { lvl.sel = to; this._layoutItems(this.root.clientWidth, this.root.clientHeight); if (window.__syncGlows) window.__syncGlows(); }
    if (moved && g.left > 0) g.raf = requestAnimationFrame(() => this._glideStep());
    else this._glideEnd();
  }
  // now: something else was pressed (the details are needed right away);
  // otherwise they come a moment later, unless the button is still held
  _glideEnd(now = false) {
    const g = this._gl || this._glPend; if (!g) return;
    this._gl = null; this._glPend = null;
    if (g.raf) cancelAnimationFrame(g.raf);
    clearTimeout(this._glideT); clearTimeout(this._glideSelT);
    // (the rows finish their last slide before the usual easing is back)
    this._glideT = setTimeout(() => { if (!this._gl) this.$items.classList.remove("glide", "glide-fast"); }, 160);
    if (this._lazyEls && this._lazyEls.size) { this.$items.classList.remove("glide-fast"); this._lazyArtSoon(); }
    const sel = () => { if (!this._gl && g.lvl === this._level()) this._onSelect(); };
    if (now) sel();
    else { this._glPend = g; this._glideSelT = setTimeout(() => { if (this._glPend === g) { this._glPend = null; sel(); } }, 180); }
  }
}

Object.assign(Xmb.prototype, SectionMethods, SettingsMethods, IconStyleMethods, ThemeMethods, BackgroundMethods, FriendMethods, PsnMethods, GameMethods, MediaMethods, UserMethods, BrowserMethods);
