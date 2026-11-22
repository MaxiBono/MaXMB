// XMB: user (the Xmb class's methods, from xmb.js; put on its prototype there)
import { Keybinds } from "./keybinds.js";
import { MEDIA_MODES, NAME_LIMIT, __set_PLAYER_OWN, USER_SETTING_KEYS, applyIconColorVar, itemIcon } from "./xmb-shared.js";
import { STOCK_AVATARS, VIRTUAL_KB, avatarSrc, isStockAvatar } from "./ui.js";
import { assetUrl, call } from "./api.js";
import { isVideoPath } from "./chroma.js";

export const UserMethods = {

  // △ on Account Management (IMG_3575): Sign Out and Auto Sign-In Off, in the
  // games' panel with the band behind the row; Auto Sign-In Off greys out once
  // used (until the column is made again)
  _accountOptions(it) {
    const el = it._el;
    this._triBand(el);
    const done = () => { this.overlay = null; if (el) { el.classList.remove("gm-band"); this._triZoom(el, false); } };
    this.overlay = this.gameMenu;
    this.gameMenu.open({ withBg: this.$bg.classList.contains("show"), top: [],
      lower: [{ id: "signout", label: "Sign Out" }, { id: "autooff", label: "Auto Sign-In Off" }],
      disabled: it._autoOffUsed ? ["autooff"] : [] }, async (id) => {
      if (id === "signout") { this.gameMenu.close(); done(); this._runAction("psn_signout"); return; }
      if (id === "autooff") {
        it._autoOffUsed = true;
        if (this.user) { this.user.psnAutoSignIn = false; await call("save_user", { user: this.user }); }
        this.audio.play("enter", 0.5);
        this.gameMenu.dis.add("autooff"); this.gameMenu._render();
      }
    }, done);
  },

  // ------------------------------------------------------------- users
  async _signIn(user, opts = {}) {
    if (this._signingIn) return;
    this.audio.play("enter", 0.6);
    // Show a loading screen (Turn-Off-System style) while this profile's
    // settings and themes load and its columns build. It only appears if the
    // load isn't near-instant, and is hidden the moment everything is ready;
    // the menu doesn't move meanwhile.
    this._signingIn = true;
    const showT = setTimeout(() => this._loadingBegin(), 60);
    try { await this._signInSteps(user, showT, opts); } finally { this._signingIn = false; }
  },
  async _signInSteps(user, showT, opts = {}) {
    const list = await call("list_users");
    const fresh = (list.users || []).find((u) => u.id === user.id) || user;
    call("set_active_user", { id: fresh.id });
    this.user = fresh; user = fresh; this.locked = false; this._loggedInOnce = true;
    await this._loadUserSettings(fresh);
    this._syncHotkeys();
    // restore this user's saved media ordering (Music / Photo / Video sections)
    this.mediaMode = Object.assign({ music: "all", photo: "all", video: "all" }, fresh.mediaMode || {});
    // PSN: without Auto Sign-In the user starts signed out of PlayStation Network
    // PSN: with Auto Sign-In the account signs in as the user logs in; otherwise
    // the user starts signed out of PlayStation Network
    { const want = fresh.psnAutoSignIn === true && fresh.psnLinkedId ? fresh.psnLinkedId : null;
      if ((fresh.psnAccountId || null) !== want) { fresh.psnAccountId = want; call("save_user", { user: fresh }); } }
    this.cbs.onProfileChange(user);
    this.audio.enabled = user.soundEnabled !== false;
    this.audio.musicEnabled = user.musicEnabled !== false;
    this._applyBgMusic();
    this._migrateWaveSettings(); this._migrateWaveV3();
    this.wave.setColor(user.theme?.backgroundColor || "auto");
    this._applyWaveStyle();
    __set_PLAYER_OWN(user.theme?.iconColorAll === false); applyIconColorVar(this._pickHex(user.theme));
    this._applyIconStyle(); this._rememberIconStyle();
    this._applyTextLook();
    await this._applyThemes(false, true);
    this._applyWallpaper();
    this._restartRotation();
    this._bootLookSave();
    await this._buildColumns();
    clearTimeout(showT);
    await this._loadingSettle();
    this.selCat = this.columns.findIndex((c) => c.id === "game");
    let sel0 = 0;
    // logging in (any way) starts on What's New
    if (opts.startAt !== "game") {
      const pi = this.columns.findIndex((c) => c.id === "psn");
      const wi = pi >= 0 ? this.columns[pi].items.findIndex((x) => x.title === "What's New") : -1;
      if (wi >= 0) { this.selCat = pi; sel0 = wi; }
    }
    if (this.selCat < 0) this.selCat = 0;
    // (back after a game whose page Windows ended: that game chosen, or the folder it's in)
    if (opts.game) {
      const at = (this.columns[this.selCat].items || []).findIndex((x) => x.game?.folder === opts.game || (x.children || []).some((c) => c.game?.folder === opts.game));
      if (at >= 0) sel0 = at;
    }
    this.levels = [{ items: this.columns[this.selCat].items, sel: sel0 }];
    this._render(); this._onSelect();
    this._loadingDone();
  },
  _newUser() {
    // XMB-style: only ask for a name; the profile gets the default white user icon.
    this.overlay = this.textForm;
    this.textForm.open({ title: "New User", fields: [{ key: "name", label: "Name", required: true, max: NAME_LIMIT }], submit: "Create" },
      async (out) => {
        this.textForm.close(); this.overlay = null;
        // (the loading screen at once: making the user and reading the users
        // again can take a moment, right after a restart above all, and the
        // menu would sit still meanwhile)
        this._loadingBegin();
        let u = null;
        try { u = await call("create_user", { name: out.name, avatar: "stock:square_grey" }); await this._reloadUsers(); } catch (e) { console.warn("create user", e); }
        // straight into the new user
        if (u && u.id) await this._signIn(u);
        else { this.audio.play("error", 0.5); this._loadingQuit(); }
      },
      () => { this.textForm.close(); this.overlay = null; });
  },
  // △ on a user (IMG_3576 / IMG_3577): the games' panel with Log Out (the
  // logged-in user), Automatic Login ▶ (On / Off), Delete and Information;
  // the band goes behind the row
  _userOptions(user) {
    const lvl = this._level(), it = lvl.items[lvl.sel], el = it && it._el;
    const current = !!(this.user && this.user.id === user.id);
    this._triBand(el);
    const done = () => { this.overlay = null; if (el) { el.classList.remove("gm-band"); this._triZoom(el, false); } };
    const lower = [
      ...(current ? [{ id: "logout", label: "Log Out" }] : []),
      { id: "autologin", label: "Automatic Login", sub: true },
      { id: "delete", label: "Delete" },
      { id: "info", label: "Information" },
    ];
    this.overlay = this.gameMenu;
    this.gameMenu.open({ withBg: this.$bg.classList.contains("show"), top: [], lower,
      subs: { autologin: { options: [{ id: "on", label: "On" }, { id: "off", label: "Off" }], current: user.autoLogin ? "on" : "off" } } },
      async (id, val) => {
        if (id === "autologin") { this.gameMenu.close(); done(); await this._setAutoLogin(user, val === "on"); return; }
        this.gameMenu.close(); done();
        if (id === "logout") this._askLogOut(user);
        else if (id === "delete") this._deleteUser(user);
        else if (id === "info") { this.audio.play("enter", 0.5); this._userInfoScreen(user); }
      }, done);
  },
  // Automatic Login: this user is logged in straight after the intro (only one
  // user can have it); the row shows the small arrow under its name
  async _setAutoLogin(user, on) {
    const list = await call("list_users");
    for (const u of list.users || []) {
      const want = on ? u.id === user.id : (u.id === user.id ? false : !!u.autoLogin);
      if (!!u.autoLogin !== want) await call("save_user", { user: { ...u, autoLogin: want } });
    }
    if (this.user) {
      const me = (list.users || []).find((u) => u.id === this.user.id);
      if (me) this.user.autoLogin = on ? me.id === user.id : (me.id === user.id ? false : !!this.user.autoLogin);
    }
    this.audio.play("enter", 0.5);
    await this._reloadUsersStay(user.id);
  },
  // rebuild the Users column and stay on the same user
  async _reloadUsersStay(userId) {
    // (only the Users column)
    if (!await this._replaceColumn("users")) await this._buildColumns();
    const ci = this.columns.findIndex((c) => c.id === "users");
    if (ci < 0) return;
    this.selCat = ci;
    const items = this.columns[ci].items;
    this.levels = [{ items, sel: Math.max(0, items.findIndex((x) => x.kind === "user" && x.user && x.user.id === userId)) }];
    this._render(); this._onSelect();
  },
  // "Do you want to log out?" (IMG_3598): Yes = back to the user selection
  _askLogOut(user) {
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ user: true, icon: avatarSrc(user.avatar), stock: isStockAvatar(user.avatar), diamond: true, meta: [user.name],
      text: "Do you want to log out?", sel: 0 }, (yes) => {
      this.gameConfirm.close(); this.overlay = null;
      if (yes) this._logOut();
    });
  },
  // "Do you want to log in as the selected user? ..." (IMG_3599): Yes = that
  // user is logged in (the loading clock shows meanwhile)
  _askSwitchUser(user) {
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ user: true, icon: avatarSrc(user.avatar), stock: isStockAvatar(user.avatar), meta: [user.name],
      text: "Do you want to log in as the selected user?\nThe currently logged in user will be logged out.", sel: 0 }, (yes) => {
      this.gameConfirm.close(); this.overlay = null;
      if (yes) this._signIn(user);
    });
  },
  // back to the user selection that follows the intro: the system starts again
  // (without the intro, and without Automatic Login)
  _logOut() {
    this.audio.play("back", 0.5);
    try { sessionStorage.setItem("xmbLogOut", "1"); } catch (e) {}
    setTimeout(() => location.reload(), 250);
  },
  // Information (IMG_3578 / IMG_3579): the user's icon and name; ✕ Edit
  _userInfoScreen(user) {
    const current = !!(this.user && this.user.id === user.id);
    const reopen = (u) => { this.overlay = this.userInfo; this.userInfo.open(u, current, handlers); };
    const handlers = {
      onIcon: () => { this.userInfo.close(); this._changeUserPicture(user, (u) => { user = u; reopen(u); }, () => reopen(user)); },
      onName: () => { this.userInfo.close(); this._editUserName(user, (u) => { user = u; reopen(u); }, () => reopen(user)); },
      onBack: async () => { this.userInfo.close(); this.overlay = null; await this._reloadUsersStay(user.id); },
    };
    reopen(user);
  },
  _editUserName(user, onDone, onCancel) {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Edit Name", fields: [{ key: "name", label: "Name", value: user.name, required: true, max: NAME_LIMIT }], submit: "Save" },
      async (out) => {
        this.textForm.close(); this.overlay = null;
        const u = { ...user, name: out.name };
        await call("save_user", { user: u });
        if (this.user && this.user.id === u.id) { this.user.name = u.name; this.cbs.onProfileChange(this.user); }
        if (onDone) onDone(u); else await this._reloadUsers();
      },
      () => { this.textForm.close(); this.overlay = null; onCancel && onCancel(); });
  },
  // the console's icon chooser (IMG_3580-3597): the preset icons, or a photo
  async _changeUserPicture(user, onDone, onCancel) {
    const photos = await call("list_media", { kind: "photo" }).catch(() => []);
    const pics = (photos || []).filter((m) => !isVideoPath(m.path));
    const photoEntry = (m) => {
      const o = this._mediaItemObj("photo", m);
      return { title: o.title, sub: o.sub || "", thumb: (o.icon && o.icon.art) || assetUrl(m.path), ref: m.path };
    };
    const modes = MEDIA_MODES.photo.map((m) => ({ id: m.id, label: m.label }));
    const build = (modeId) => {
      const entries = pics.map((m) => this._mediaItemObj("photo", m));
      const saved = this.mediaMode.photo; this.mediaMode.photo = modeId;
      let grouped; try { grouped = this._groupMedia("photo", entries); } finally { this.mediaMode.photo = saved; }
      const conv = (it) => it.children
        ? { title: it.title, sub: it.sub, folder: true, html: it.icon && it.icon.folder ? itemIcon(it) : null, thumb: it.icon && it.icon.art, children: it.children.map(conv) }
        : photoEntry(it.media);
      // Playlists first (the Photo column's playlists: "Select a playlist.")
      return [{ title: "Playlists", sys: true, playlists: true, thumb: "./assets/icons/theme/icon_playlist.png" }, ...grouped.map(conv)];
    };
    // the user's photo playlists, chosen the way Add to Playlist chooses one
    // (the user's icon and name on the left; no "Create New Playlist")
    const playlists = ({ onPick, onCancel }) => {
      const pls = (this.user?.photoPlaylists || []).map((p) => {
        const kids = (p.photos || []).filter((x) => !isVideoPath(x)).map((path) => {
          const m = pics.find((q) => q.path === path) || { path, name: String(path).split(/[\\/]/).pop() };
          return photoEntry(m);
        });
        return { title: p.name, children: kids };
      });
      this.overlay = this.playlistPicker;
      this.playlistPicker.open({ thumb: avatarSrc(user.avatar), name: user.name, date: "", noCreate: true,
        playlists: pls.map((p) => ({ name: p.title, count: p.children.length })), noun: ["Image", "Images"],
        folderIcon: "./assets/icons/theme/icon_playlist.png" }, (i) => {
        const pl = pls[i];
        this.overlay = this.iconChooser;
        if (!pl || !pl.children.length) { this.audio.play("error", 0.4); onCancel(); return; }
        onPick(pl);
      }, () => { this.overlay = this.iconChooser; onCancel(); });
    };
    this.overlay = this.iconChooser;
    this.iconChooser.open({ presets: STOCK_AVATARS, current: user.avatar, photos: { modes, build, playlists } }, async (ref) => {
      this.iconChooser.close(); this.overlay = null;
      const u = { ...user, avatar: ref };
      await call("save_user", { user: u });
      if (this.user && this.user.id === u.id) { this.user.avatar = ref; this.cbs.onProfileChange(this.user); }
      if (onDone) onDone(u); else await this._reloadUsers();
    }, () => { this.iconChooser.close(); this.overlay = null; onCancel && onCancel(); });
  },
  // Delete (IMG_3601): the user's icon (◆ for the logged-in user) and name,
  // the warning, Yes / No with Yes chosen first. Deleting the logged-in user
  // logs out (back to the user selection)
  _deleteUser(user) {
    const current = !!(this.user && this.user.id === user.id);
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ user: true, icon: avatarSrc(user.avatar), stock: isStockAvatar(user.avatar), diamond: current, meta: [user.name],
      text: "If you delete the User, saved data for PlayStation\u00AE3 format software,\nmessages, trophies and other information will also be deleted.\nAre you sure you want to continue?",
      sel: 0 }, async (yes) => {
      this.gameConfirm.close(); this.overlay = null;
      if (!yes) return;
      await call("delete_user", { id: user.id });
      if (current) { this._logOut(); return; }
      await this._reloadUsersStay(this.user ? this.user.id : null);
    });
  },
  async _reloadUsers() {
    // (the logged-in user no longer exists: back to the user selection)
    if (this.user && !this.locked) {
      const list = await call("list_users").catch(() => null);
      if (list && !(list.users || []).some((u) => u.id === this.user.id)) { this._logOut(); return; }
    }
    if (this.locked || !await this._replaceColumn("users")) await this._buildColumns();
    const ci = this.columns.findIndex((c) => c.id === "users");
    this.selCat = this.locked ? 0 : ci;
    this.levels = [{ items: this.columns[this.selCat].items, sel: 0 }];
    this._render(); this._onSelect();
  },
  // ---- every setting is kept per user ---------------------------------------
  // The system settings (volumes, brightness, formats, full screen, power save,
  // keyboard, keybinds, media / game recognition modes…) live in the settings
  // file, which the backend reads; each user also keeps their own copy, put
  // back in place (and applied) when they sign in. The folder lists (media
  // folders, game source folders, sections) stay shared.
  _snapshotUserSettings() {
    if (!this.user || !this.settings) return;
    const c = {};
    for (const k of USER_SETTING_KEYS) if (this.settings[k] !== undefined) c[k] = JSON.parse(JSON.stringify(this.settings[k]));
    this.user.settingsCopy = c;
    clearTimeout(this._usT); this._usT = setTimeout(() => { if (this.user) call("save_user", { user: this.user }); }, 300);
  },
  async _loadUserSettings(user) {
    const s = this.settings, c = user && user.settingsCopy;
    if (!s) return;
    // Low Performance Mode is off by default now: turned off once for settings
    // saved while it was on by default
    const lpOnce = () => { const bb = (s.behavior ||= {}); if (!bb.lowPowerOffOnce) { bb.lowPowerMode = false; bb.lowPowerOffOnce = true; return true; } return false; };
    if (!c) { if (lpOnce()) call("save_settings", { settings: s }).catch(() => {}); this._snapshotUserSettings(); { const lvl = this._inGame ? 2 : (document.hasFocus() ? 0 : 1); this._lowPower = -1; this.setLowPower(lvl); } this._applyPerformance(); return; }       // first sign-in: keeps the current settings
    const before = { fs: s.behavior?.fullscreen, auto: s.behavior?.autostart, res: s.behavior?.resolution };
    for (const k of USER_SETTING_KEYS) if (c[k] !== undefined) s[k] = JSON.parse(JSON.stringify(c[k]));
    if (lpOnce()) this._snapshotUserSettings();
    try { await call("save_settings", { settings: s }); } catch (e) {}
    const b = s.behavior || {};
    this.audio.setMasterVolume((b.volume ?? 100) / 100);
    this.audio.setMusicVolume((b.musicVolume ?? 100) / 100);
    this.audio.setSfxVolume((b.sfxVolume ?? 100) / 100);
    this.audio.playInBackground = b.playAudioBackground !== false;
    this.audio.setBufferingVolume((b.bufferingVolume ?? 15) / 100);
    this.audio.setBuffering(b.bufferingSound === true);
    this._applyBrightness(b.brightness ?? 100);
    this.cbs.onTimeFormat && this.cbs.onTimeFormat(b.timeFormat || "24");
    this.cbs.onDateFormat && this.cbs.onDateFormat(b.dateFormat || "DD/MM/YYYY");
    VIRTUAL_KB.on = b.virtualKeyboard !== false;
    Keybinds.load(s.input?.keybinds);
    { const lvl = this._inGame ? 2 : (document.hasFocus() ? 0 : 1); this._lowPower = -1; this.setLowPower(lvl); }
    this._applyPerformance();
    if ((before.fs !== false) !== (b.fullscreen !== false)) {
      call("set_fullscreen", { enable: b.fullscreen !== false }); this.cbs.onFullscreen && this.cbs.onFullscreen(b.fullscreen !== false);
      setTimeout(() => this._applyResolution(), 350);
    } else if (before.res !== b.resolution) this._applyResolution();
    if (!!before.auto !== !!b.autostart) call("set_autostart", { enable: !!b.autostart }).catch(() => {});
  },
};
