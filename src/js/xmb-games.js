// XMB: game (the Xmb class's methods, from xmb.js; put on its prototype there)
import { CONSOLES, FORMAT_NAMES, GAME_MEDIA, MEDIA_MODES, TRI_ZOOM, discIcon, fitArtRatio, folderName, gameName, isHomeGame, poss, winPath } from "./xmb-shared.js";
import { assetUrl, bumpAsset, call, cmpBase, cmpNatural, cmpText, logLine, noExt, stillUrl, thumbUrl } from "./api.js";
import { sysUrl } from "./themes.js";

export const GameMethods = {

  // Game column: the PlayStation Store, then the games alphabetically, top to
  // bottom (natural order: "Game 2" before "Game 10").
  _gameItems(games) {
    this._allGames = games || [];
    // a "PlayStation Home" game always starts from PSN > PlayStation®Home
    this._homeGame = (games || []).find(isHomeGame) || null;
    const list = [...(games || [])].filter((g) => g !== this._homeGame);
    const uname = this.user?.name || "User 1";
    const fixed = [
      { kind: "ph", title: "PS Vita System Application Utility", sub: uname, userSub: true, icon: { sys: "icon_gamedata.png" } },
      { kind: "ph", title: "Game Data Utility", sub: "", icon: { sys: "icon_gamedata.png" } },
      { kind: "ph", title: "Memory Card Utility", sub: "", icon: { sys: "icon_vmc.png" } },
      { kind: "ph", title: "Saved Data Utility (minis/PSP\u2122)", sub: uname, userSub: true, icon: { sys: "icon_savedata_minis.png" } },
      { kind: "ph", title: "Saved Data Utility (PS3\u2122)", sub: uname, userSub: true, icon: { sys: "icon_savedata.png" } },
      this._storeItem("cinfo-bg-storegame.jpg"),
    ];
    this._gameFixedCount = fixed.length;
    // the disc (only one) sits above every other game, without a date line
    const disc = list.find((g) => g.isDisc);
    const entries = list.filter((g) => g !== disc).map((g) => this._gameEntry(g));
    return [...fixed, ...(disc ? [this._gameEntry(disc)] : []), ...this._groupGames(entries)];
  },
  // one game row: its name and (not for the disc) the "Created" date + time
  _gameEntry(g) {
    const art = assetUrl(g.icon), prev = assetUrl(g.preview);
    const icon = g.isDisc
      ? { art: discIcon(g.console), disc: true, real: /\.gif$/i.test(g.preview || "") ? prev : art, preview: /\.gif$/i.test(g.preview || "") ? null : prev }
      : { art, preview: prev };
    return { kind: "game", title: gameName(g), sub: g.isDisc ? "" : this._fmtCreated(g.created), icon, game: g };
  },
  // Game section sort (Square): All / By Format (console) / By Album
  _groupGames(entries) {
    const byTitle = (a, b) => cmpNatural(String(a.title), String(b.title));
    const mode = this._mediaMode("game");
    // Sort By (the game options): Creation Date ▼ (newest first, the default),
    // Creation Date ▲, Recently Played (last started first), Format (console)
    const byCreated = (a, b) => cmpText(String(b.game.created || ""), String(a.game.created || "")) || byTitle(a, b);
    const byCreatedUp = (a, b) => cmpText(String(a.game.created || ""), String(b.game.created || "")) || byTitle(a, b);
    const played = this.user?.gamePlayed || {};
    const byPlayed = (a, b) => (played[b.game.folder] || 0) - (played[a.game.folder] || 0) || byCreated(a, b);
    const fmtName = (e) => FORMAT_NAMES[e.game.console] || e.game.console || "PS3";
    const byFormat = (a, b) => cmpBase(fmtName(a), fmtName(b)) || byCreated(a, b);
    const order = { created_asc: byCreatedUp, recent: byPlayed, format: byFormat }[this._gameSortId()] || byCreated;
    // a game with no icon that isn't inside a folder gets the default game icon
    const withDefault = (e) => e.icon.art ? e : { ...e, icon: { ...e.icon, art: "./assets/icons/system/default_game.png", noIcon: true } };
    if (mode !== "format" && mode !== "album") return [...entries].sort(order).map(withDefault);
    const groups = new Map();
    for (const e of entries) {
      const k = mode === "format" ? (FORMAT_NAMES[e.game.console] || e.game.console || "PS3") : (e.game.album || "Unknown");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    return [...groups.entries()].sort((a, b) => cmpBase(a[0], b[0])).map(([name, items]) => {
      const children = [...items].sort(order), n = children.length;
      return { kind: "drill", title: name, sub: `${n} Title${n !== 1 ? "s" : ""}`,
        icon: { folder: "game", art: children[0].icon.art || null }, children };
    });
  },
  // "2026-04-09 07:36" (game.json Created) → "9/4/2026  7:36 AM" in the
  // user's date / time formats
  _fmtCreated(c) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(c || "").trim());
    if (!m) return String(c || "").trim();
    return this._fmtDateTime(new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)), m[4] != null);
  },
  _fmtDateTime(d, withTime = true) {
    const b = this.settings?.behavior || {};
    const D = d.getDate(), M = d.getMonth() + 1, Y = d.getFullYear();
    const fmt = b.dateFormat || "DD/MM/YYYY";
    const date = fmt === "MM/DD/YYYY" ? `${M}/${D}/${Y}` : fmt === "YYYY/MM/DD" ? `${Y}/${M}/${D}` : `${D}/${M}/${Y}`;
    if (!withTime) return date;
    const h = d.getHours(), mi = String(d.getMinutes()).padStart(2, "0");
    const time = (b.timeFormat || "24") === "12" ? `${h % 12 || 12}:${mi} ${h < 12 ? "AM" : "PM"}` : `${h}:${mi}`;
    return `${date}\u2002\u2002${time}`;
  },
  async _refreshGameColumn() {
    const col = this.columns ? this.columns.find((c) => c.id === "game") : null;
    if (!col) return;
    const games = await call("scan_library");
    // (kept as the list read last: menus drawn again after a theme change use
    // it, and must show the games as they are now, not as they were at start)
    this._lastGames = games;
    const items = this._gameItems(games);
    const sig = (l) => l.map((x) => `${x.title}|${x.sub || ""}|${x.icon?.art || ""}`).join("\n");
    if (sig(items) === sig(col.items)) {
      // nothing new to draw: the games' own settings (Options Band, Hide Game
      // Title On Background…) still take effect at once
      const byFolder = new Map(items.filter((x) => x.game).map((x) => [x.game.folder, x.game]));
      for (const x of col.items) { const g = x.game && byFolder.get(x.game.folder); if (g) Object.assign(x.game, g); }
      return;
    }
    col.items = items;
    if (this.columns[this.selCat] === col && this.levels.length === 1 && !this.overlay) {
      const cur = this.levels[0].items[this.levels[0].sel];
      let sel = cur ? items.findIndex((x) => x.title === cur.title) : -1;
      if (sel < 0) sel = Math.min(this.levels[0].sel, items.length - 1);
      this.levels[0].items = col.items; this.levels[0].sel = Math.max(0, sel); this._render(); this._onSelect();
    }
    const psn = this.columns.find((c) => c.id === "psn"); if (psn) psn.items = this._psnItems();
    if (col.sel != null && col.sel >= col.items.length) col.sel = Math.max(0, col.items.length - 1);
  },

  // ---- Game Settings > Game Information: every game's game.json ------------
  _gameSettingsList() {
    const games = [...(this._allGames || [])].sort((a, b) => cmpNatural(String(a.title), String(b.title)));
    if (!games.length) return [{ kind: "ph", title: "No Games", sub: "", icon: { sys: "icon_setting_item.png" } }];
    return games.map((g) => ({ kind: "drill", title: gameName(g), sub: g.album ? `Album: ${g.album}` : "",
      // each game's own icon (never the disc, even for the disc game)
      icon: { art: g.icon ? assetUrl(g.icon) : "./assets/icons/system/default_game.png", gameArt: true },
      childrenFn: () => this._gameSettingItems(g.folder) }));
  },
  // Folder Console: one row per folder in content/Games that holds games
  _folderConsoleList() {
    const SI = { sys: "icon_setting_item.png" };
    const albums = [...new Set((this._allGames || []).map((g) => g.album).filter(Boolean))]
      .sort((a, b) => cmpBase(a, b));
    if (!albums.length) return [{ kind: "ph", title: "No Folders", icon: SI }];
    return albums.map((a) => {
      const n = (this._allGames || []).filter((g) => g.album === a).length;
      return { kind: "setting", ctl: `gmf:${a}`, title: a, icon: { sys: "item_tex_ps3game_folder.png" },
        sub: `${n} Title${n !== 1 ? "s" : ""}. Sets the Console of all of them.` };
    });
  },
  _gmfValue(ctl) {
    const games = (this._allGames || []).filter((g) => g.album === ctl.slice(4));
    const set = new Set(games.map((g) => g.console || "PS3"));
    return set.size === 1 ? [...set][0] : set.size ? "Mixed" : "-";
  },
  async _gmfAdjust(ctl, dir) {
    const cur = this._gmfValue(ctl);
    const i = CONSOLES.indexOf(cur);
    this._gmfSet(ctl, i < 0 ? CONSOLES[dir > 0 ? 0 : CONSOLES.length - 1] : CONSOLES[(i + dir + CONSOLES.length) % CONSOLES.length]);
  },
  _gmfSet(ctl, next) {
    const games = (this._allGames || []).filter((g) => g.album === ctl.slice(4));
    if (!games.length) return;
    this.audio.play("cursor_up", 0.4);
    for (const g of games) g.console = next;
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    clearTimeout(this._gmfT);   // save once the choice settles
    this._gmfT = setTimeout(async () => {
      for (const g of games) { try { await call("game_meta_save", { folder: g.folder, patch: { console: g.console } }); } catch (e) {} }
      await this._refreshGameColumn();
      const lvl = this._level();
      if (lvl && lvl.items.some((x) => x.ctl && x.ctl.startsWith("gmf:"))) this._rebuildLevel(this._folderConsoleList);
    }, 450);
  },
  _gameByFolder(folder) { return (this._allGames || []).find((g) => g.folder === folder); },
  _gameSettingItems(folder) {
    const SI = { sys: "icon_setting_item.png" };
    const k = (key) => `gm:${key}:${folder}`;
    return [
      { kind: "setting", ctl: k("title"), title: "Title", icon: SI },
      { kind: "setting", ctl: k("parentalControl"), title: "Parental Control", icon: SI },
      { kind: "setting", ctl: k("created"), title: "Created", icon: SI, sub: "year-month-day hour:minute" },
      { kind: "setting", ctl: k("size"), title: "Size", icon: SI },
      { kind: "setting", ctl: k("version"), title: "Version", icon: SI },
      { kind: "setting", ctl: k("starts"), title: "Starts", icon: SI, sub: "year-month-day hour:minute" },
      { kind: "setting", ctl: k("isDisc"), title: "Disc", icon: SI, sub: "On: Shown as the game inside the Disc." },
      { kind: "setting", ctl: k("console"), title: "Console", icon: SI },
      ...GAME_MEDIA.map((m) => ({ kind: "action", act: `gmm::${m.kind}::${folder}`, title: m.title, icon: SI })),
      { kind: "action", act: `gm_scrape::${folder}`, title: "Get Art Online", icon: SI,
        sub: "Looks for art for the game in SteamGridDB, TheGamesDB or RAWG." },
      { kind: "setting", ctl: k("optionsBand"), title: "Options Band", icon: SI,
        sub: "On: When a game's options are open, a black see-through band appears behind the game's icon and title." },
      { kind: "setting", ctl: k("hideTitle"), title: "Hide Game Title On Background", icon: SI,
        sub: "On: A game with a background hides its title once the background appears." },
    ];
  },
  // Game Settings > Icon / Background / Video / Music: a file from the app's
  // folders (picked from a grid of thumbnails, like the Photo Gallery), any
  // file on the computer, or none
  async _gameMediaMenu(kind, folder) {
    const m = GAME_MEDIA.find((x) => x.kind === kind); if (!m) return;
    const g = this._gameByFolder(folder);
    const ext = (p) => (/\.([a-z0-9]+)$/i.exec(p || "") || [])[1]?.toLowerCase() || "";
    let files = [];
    for (const src of m.from) { try { files.push(...await call("list_media", { kind: src })); } catch (e) {} }
    const seen = new Set();
    files = files.filter((f) => f && f.path && m.exts.includes(ext(f.path)) && !seen.has(f.path) && seen.add(f.path))
      .sort((a, b) => cmpNatural(noExt(a.path.split(/[\\/]/).pop()), noExt(b.path.split(/[\\/]/).pop())));
    const folderName = { icon: "Photos", background: "Photos", preview: "Videos", music: "Music" }[kind];
    const items = [
      ...(g && g[m.key] ? [{ label: "Remove", id: "__none__" }] : []),
      ...(files.length ? [{ label: `From the ${folderName} Folder\u2026`, id: "__grid__" }] : []),
      { label: "Choose File\u2026", id: "__pick__" },
    ];
    this.overlay = this.sideMenu;
    this.sideMenu.open(items, { title: m.title }, async (ch) => {
      this.sideMenu.close(); this.overlay = null;
      if (ch.id === "__grid__") { this._gameMediaGrid(folder, m, files); return; }
      let path = ch.id;
      if (path === "__pick__") {
        try { path = await call("pick_file", { title: `Choose the ${m.title}`, name: m.title, exts: m.exts }); } catch (e) { path = null; }
        if (!path) return;
      }
      await this._gameMediaApply(folder, m, path === "__none__" ? null : path);
    }, () => { this.sideMenu.close(); this.overlay = null; });
  },
  _gameMediaGrid(folder, m, files) {
    const isVid = (p) => /\.(mp4|webm|mov|mkv|m4v)$/i.test(p);
    const items = files.map((f) => {
      const art = m.kind === "music" ? (f.cover ? thumbUrl(f.cover) : sysUrl("icon_music_default.png")) : stillUrl(f.path, f.cover);
      return { label: noExt(f.title || f.path.split(/[\\/]/).pop()), id: f.path, thumb: art, vsrc: m.kind !== "music" && isVid(f.path) ? assetUrl(f.path) : null };
    });
    this.overlay = this.listPicker;
    this.listPicker.open({ title: m.title, items, grid: true, submit: "Select" }, async (it) => {
      this.listPicker.close(); this.overlay = null;
      if (it && it.id) await this._gameMediaApply(folder, m, it.id);
    }, () => { this.listPicker.close(); this.overlay = null; this._gameMediaMenu(m.kind, folder); });
  },
  async _gameMediaApply(folder, m, path) {
    const g = this._gameByFolder(folder);
    try { await call("game_media_set", { folder, kind: m.kind, path }); }
    catch (e) { this.audio.play("error", 0.5); this._shotFeedback(String(e || "That file can't be used")); return; }
    this.audio.play(path ? "enter" : "back", 0.5);
    if (g) for (const k of ["icon", "background", "preview", "music"]) bumpAsset(g[k]);
    await this._afterGameArt(folder);
  },
  // the Game column and the open Game Settings show the game's new art / name
  async _afterGameArt(folder) {
    await this._refreshGameColumn();
    const g = this._gameByFolder(folder);
    if (g) for (const k of ["icon", "background", "preview", "music"]) bumpAsset(g[k]);
    const lvl = this._level();
    if (lvl && lvl.items.some((x) => x.act === `gm_scrape::${folder}`)) this._rebuildLevel(() => this._gameSettingItems(folder));
    const up = this.levels[this.levels.length - 2];
    if (up && up.items.some((x) => x.childrenFn && x.title && x.icon?.gameArt)) {
      const sel = up.sel; up.items = this._gameSettingsList(); up.sel = Math.min(sel, up.items.length - 1);
    }
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  async _gameScrape(folder) {
    const g = this._gameByFolder(folder); if (!g) return;
    const r = await this._runLocked(`gm_scrape::${folder}`, "Looking the game up...",
      () => call("game_scrape", { folder, title: g.title }).catch(() => null));
    if (!r) { this.audio.play("error", 0.5); return; }
    const got = [r.icon && "icon", r.background && "background", r.preview && "video", r.name && "name", r.console && `console (${r.console})`].filter(Boolean);
    this._shotFeedback(r.message || `Found: ${got.join(", ")}`);
    if (r.message) this.audio.play("error", 0.4);
    await this._afterGameArt(folder);
  },
  _gmParse(ctl) { const m = /^gm:([^:]+):(.*)$/.exec(ctl || ""); return m ? { key: m[1], folder: m[2] } : null; },
  // Game Options Band / Hide Game Title on Background: each game's own choice
  // (its game.json); a game not set yet keeps what the old system-wide
  // setting said (band on, title shown by default)
  _gameBandOn(g) { return g && typeof g.optionsBand === "boolean" ? g.optionsBand : this.settings?.behavior?.gameBand !== false; },
  _gameHideTitle(g) { return g && typeof g.hideTitle === "boolean" ? g.hideTitle : !!this.settings?.behavior?.gameHideTitle; },
  _gmValue(ctl) {
    const p = this._gmParse(ctl), g = p && this._gameByFolder(p.folder);
    if (!g) return "";
    switch (p.key) {
      case "parentalControl": return g.parentalControl ? `Level ${g.parentalControl}` : "-";
      case "isDisc": return g.isDisc ? "On" : "Off";
      case "optionsBand": return this._gameBandOn(g) ? "On" : "Off";
      case "hideTitle": return this._gameHideTitle(g) ? "On" : "Off";
      case "created": case "starts": return g[p.key] ? this._fmtCreated(g[p.key]) : "-";
      default: return String(g[p.key] || "-");
    }
  },
  async _gmSave(folder, patch) {
    try { await call("game_meta_save", { folder, patch }); } catch (e) { this.audio.play("error", 0.4); return; }
    await this._refreshGameColumn();
    const lvl = this._level();
    if (lvl && lvl.items.some((i) => i.ctl && i.ctl.startsWith("gm:"))) this._rebuildLevel(() => this._gameSettingItems(folder));
  },
  _gmAdjust(ctl, dir) {
    const p = this._gmParse(ctl), g = p && this._gameByFolder(p.folder);
    if (!g) return;
    this.audio.play("cursor_up", 0.4);
    if (p.key === "parentalControl") {
      const v = ((g.parentalControl || 0) + dir + 12) % 12;          // 0 = not set
      g.parentalControl = v || null; this._gmSave(g.folder, { parentalControl: v || null });
    } else if (p.key === "console") {
      const i = Math.max(0, CONSOLES.indexOf(g.console));
      g.console = CONSOLES[(i + dir + CONSOLES.length) % CONSOLES.length]; this._gmSave(g.folder, { console: g.console });
    } else if (p.key === "isDisc") {
      g.isDisc = !g.isDisc; this._gmSave(g.folder, { isDisc: g.isDisc });
    } else if (p.key === "optionsBand") {
      g.optionsBand = !this._gameBandOn(g); this._gmSave(g.folder, { optionsBand: g.optionsBand });
    } else if (p.key === "hideTitle") {
      g.hideTitle = !this._gameHideTitle(g); this._gmSave(g.folder, { hideTitleOnBackground: g.hideTitle });
    }
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  _gmEdit(ctl) {
    const p = this._gmParse(ctl), g = p && this._gameByFolder(p.folder);
    if (!g) return;
    if (["parentalControl", "console", "isDisc", "optionsBand", "hideTitle"].includes(p.key)) { this._gmAdjust(ctl, 1); return; }
    const labels = { title: "Title", created: "Created", size: "Size", version: "Version", starts: "Starts" };
    this.overlay = this.textForm;
    this.textForm.open({ title: `${gameName(g)}: ${labels[p.key]}`, fields: [{ key: "v", label: labels[p.key], value: g[p.key] || "" }], submit: "Confirm" },
      async (out) => { this.textForm.close(); this.overlay = null; g[p.key] = String(out.v || "").trim(); await this._gmSave(g.folder, { [p.key]: g[p.key] }); },
      () => { this.textForm.close(); this.overlay = null; });
  },
  // ---- Game Recognition submenu (System Settings) ---------------------------
  // Games are always read from content/Games. Games found in the source
  // folders added here (Steam's "common" folder, for example) get a folder
  // there with a shortcut to the .exe, a game.json and the exe's icon; the
  // folders can be sorted into folders of your own inside the Games folder.
  _gameRecognitionItems() {
    const SI = { sys: "icon_setting_item.png" };
    const srcs = this.settings?.gameSources || [];
    const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
    return [
      { kind: "action", act: "gsrc_add", title: "Add Source Folder", icon: SI },
      { kind: "drill", title: "Recognized Games", icon: SI, childrenFn: this._detectedGameItems,
        sub: "Games found on your chosen game folders. Choose one to delete it from the system's content\\Games directory (The actual game doesn't get deleted)." },
      { kind: "drill", title: "Game Databases", icon: SI, childrenFn: this._scrapeItems,
        sub: "Enter the keys to automatically access the game art in SteamGridDB, TheGamesDB or RAWG." },
      ...(srcs.length ? [{ kind: "action", act: "gsrc_scan", title: "Game Recognition", icon: SI,
        sub: "Looks for new games in the source folders now. New games are also found every time you open the Game column." }] : []),
      ...srcs.map((p, i) => ({ kind: "action", act: `gsrc_remove::${i}`, title: base(p), icon: { sys: "icon_game.png" },
        sub: `${winPath(p)}\n${this._gsrcModeOf(p) === "apps" ? "By Executables" : "By Folders"}. Press \u2715 to change how the games are separated or to remove it.` })),
    ];
  },
  // How a source folder is read: "folders" (Games in Folders: each folder in
  // it is a game, or the folder itself is one) or "apps" (Separate Apps: each
  // program and shortcut lying in it is an entry of its own); kept in
  // settings.gameSourceModes (the backend reads it too)
  _gsrcModeOf(p) { return (this.settings.gameSourceModes || {})[p] === "apps" ? "apps" : "folders"; },
  _gsrcSetMode(p, mode) {
    const m = (this.settings.gameSourceModes ||= {});
    if (mode === "apps") m[p] = "apps"; else delete m[p];
  },
  _gsrcAskMode(path, cur) {
    return new Promise((res) => {
      this.overlay = this.listPicker;
      const items = [
        { id: "folders", label: "By Folders (Recommended)", sub: "The games in this folder are contained in their own folders." },
        { id: "apps", label: "By Executables", sub: "2 or more games share a folder." },
      ];
      this.listPicker.open({ title: `${String(path).split(/[\\/]/).filter(Boolean).pop() || path}: How the Games are separated`, items, submit: "Select" },
        (ch) => { this.listPicker.close(); this.overlay = null; res(ch ? ch.id : null); },
        () => { this.listPicker.close(); this.overlay = null; res(null); });
      if (cur) { const i = items.findIndex((x) => x.id === cur); if (i > 0) { this.listPicker.i = i; this.listPicker._render(); } }
    });
  },
  // ---- Game Databases (Game Recognition) -------------------------------------
  _scrapeCfg() { return (this.settings.scrape ||= {}); },
  _scrapeItems() {
    const SI = { sys: "icon_setting_item.png" };
    const c = this._scrapeCfg();
    const key = (k, title) => ({ kind: "action", act: `scrape_key::${k}`, title, icon: SI,
      sub: c[k] ? (/password/i.test(k) ? "\u2022".repeat(8) : c[k]) : "Not Set" });
    return [
      { kind: "setting", ctl: "scrapeauto", title: "Automatic Scraping", icon: SI,
        sub: "On: Automatically search game art when a game gets recognized by the system." },
      key("sgdbKey", "SteamGridDB API Key"),
      key("tgdbKey", "TheGamesDB API Key"),
      key("rawgKey", "RAWG API Key"),
    ];
  },
  _scrapeKeyEdit(k) {
    const c = this._scrapeCfg();
    const lvl = this._level(); const it = lvl && lvl.items[lvl.sel];
    const title = it ? it.title : k;
    this.overlay = this.textForm;
    this.textForm.open({ title, fields: [{ key: "v", label: title, value: c[k] || "" }], submit: "Confirm" },
      (out) => {
        this.textForm.close(); this.overlay = null;
        c[k] = String(out.v || "").trim(); this._persistSettings(); this.audio.play("enter", 0.5);
        this._rebuildLevel(this._scrapeItems);
      },
      () => { this.textForm.close(); this.overlay = null; });
  },
  _detectedGameItems() {
    const list = this._detected || [];
    // the games put in the Games folder by hand are listed too (with the
    // recognized ones, by title)
    const key = (f) => String(f || "").replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
    const known = new Set(list.map((g) => key(g.folder)));
    this._manualGames = (this._allGames || []).filter((g) => g.folder && !known.has(key(g.folder)));
    const rows = [
      // (each row names its game by its folder: a list drawn again meanwhile
      // can never make ✕ delete another game)
      ...list.map((g) => ({ kind: "action", act: `gsrc_del::${g.folder}`, title: g.title, icon: { sys: "tex_game.png" },
        sub: `${winPath(g.exe)}\nPress ✕ to delete this game.` })),
      ...this._manualGames.map((g) => ({ kind: "action", act: `gman_del::${g.folder}`, title: gameName(g), icon: { sys: "tex_game.png" },
        sub: `${winPath(g.folder)}\nPress ✕ to delete this game.` })),
    ].sort((a, b) => cmpNatural(String(a.title), String(b.title)));
    if (!rows.length) return [{ kind: "ph", title: "No Recognized Games", sub: "", icon: { sys: "icon_setting_item.png" } }];
    return rows;
  },
  // a game put in the Games folder by hand, deleted from Recognized Games: the
  // console's Delete screen, as from the game's own options
  _gmanDelete(folder) {
    const game = (this._manualGames || []).find((g) => g.folder === folder);
    if (!game) return;
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ icon: game.icon ? assetUrl(game.icon) : "./assets/icons/system/default_game.png",
      meta: [gameName(game), game.created ? this._fmtCreated(game.created) : "", game.size || ""].filter(Boolean),
      text: "The installed game will be deleted.\nAre you sure you want to continue?" },
      async (yes) => {
        this.gameConfirm.close(); this.overlay = null;
        if (!yes) return;
        try { await call("game_delete", { folder: game.folder }); }
        catch (e) { this.audio.play("error", 0.4); return; }
        this._allGames = (this._allGames || []).filter((g) => g.folder !== game.folder);
        // (the menu waits, with the loading clock, until the lists are drawn again)
        await this._refreshGameColumn();
        this._rebuildLevel(this._detectedGameItems);
      });
  },
  async _loadDetected() {
    try { this._detected = await call("game_sources_detected"); } catch (e) { this._detected = []; }
  },
  async _gsrcAdd() {
    if (this._picking) return;
    this._picking = true;
    let path = null;
    try { path = await call("pick_folder", { title: "Add a Game Source Folder" }); } catch (e) {}
    this._picking = false;
    if (!path) return;
    const list = this.settings.gameSources || (this.settings.gameSources = []);
    if (list.includes(path)) { this.audio.play("error", 0.4); this._shotFeedback("This folder is already a source folder"); return; }
    const mode = await this._gsrcAskMode(path);
    if (!mode) return;
    this._gsrcSetMode(path, mode);
    list.push(path);
    await this._persistSettings(); this.audio.play("enter", 0.5);
    this._rebuildLevel(this._gameRecognitionItems);
    const lvl = this._level(); const i = lvl.items.findIndex((x) => x.act === "gsrc_scan");
    if (i >= 0) { lvl.sel = i; this._render(); this._onSelect(); }
    this._gsrcScan(false);
  },
  // a source folder: how it's read changed, or removed
  async _gsrcRemove(i) {
    const list = this.settings.gameSources || [];
    if (!list[i]) return;
    const src = list[i], cur = this._gsrcModeOf(src);
    const ch = await this._askList(String(src).split(/[\\/]/).filter(Boolean).pop() || src, [
      { id: "mode", label: "Change How the Games are separated" },
      { id: "remove", label: "Remove Folder" },
    ]);
    if (!ch) return;
    if (ch.id === "mode") {
      const mode = await this._gsrcAskMode(src, cur);
      if (!mode || mode === cur) return;
      if (!(await this._askConfirm(`The games found in the ${src} folder are removed from the Games folder and it's read again ${mode === "apps" ? "By Executables" : "By Folders"} (the games themselves aren't touched). Any icon, background, preview or music you added to them goes too.\nAre you sure you want to continue?`))) return;
      try { await call("game_sources_remove", { source: src }); } catch (e) {}
      this._gsrcSetMode(src, mode);
      await this._persistSettings(); this.audio.play("enter", 0.5);
      await this._loadDetected();
      this._rebuildLevel(this._gameRecognitionItems);
      this._gsrcScan(false);
      return;
    }
    this.overlay = this.confirm;
    this.confirm.open(`Remove the ${list[i]} folder? The games found in it are removed from the Games folder too (the games themselves aren't touched).`,
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      async (c) => {
        this.confirm.close(); this.overlay = null;
        if (c && c.id === "yes") {
          list.splice(i, 1); this._gsrcSetMode(src, "folders"); this._persistSettings(); this.audio.play("back", 0.5);
          try { await call("game_sources_remove", { source: src }); } catch (e) {}
          await this._loadDetected();
          this._rebuildLevel(this._gameRecognitionItems);
          this._refreshGameColumn();
        }
      },
      () => { this.confirm.close(); this.overlay = null; });
  },
  async _gsrcScan(quiet) {
    if (this._scanning) return;
    this._scanning = true;
    let n = 0;
    // the games are recognized, then (Automatic Scraping) their art is fetched,
    // the menu waiting on both
    const run = async (retitle) => {
      const made = await call("game_sources_sync").catch(() => 0);
      let w = 0; try { w = await call("game_scrape_waiting"); } catch (e) {}
      if (w && retitle) { retitle("Getting game art online..."); await call("game_scrape_queued").catch(() => 0); }
      return made;
    };
    try { n = (quiet ? await run(null) : await this._runLocked("gsrc_scan", "Recognizing games...", run)) || 0; } catch (e) {}
    this._scanning = false;
    await this._loadDetected();
    await this._refreshGameColumn();
    if (!quiet || n) this._shotFeedback(n ? `${n} new game${n === 1 ? "" : "s"} added` : "No new games found");
    if (quiet) this._scrapeWaiting();
  },
  _gsrcDelete(folder) {
    const g = (this._detected || []).find((x) => x.folder === folder);
    if (!g) return;
    this.overlay = this.confirm;
    this.confirm.open(`The ${poss(gameName(g))} folder in the Games folder will be deleted. The game itself isn't touched.
Are you sure you want to continue?`,
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      async (c) => {
        this.confirm.close(); this.overlay = null;
        if (!c || c.id !== "yes") return;
        try { await call("game_sources_delete", { folder: g.folder }); this.audio.play("back", 0.5); }
        catch (e) { this.audio.play("error", 0.4); }
        await this._loadDetected();
        await this._refreshGameColumn();
        this._rebuildLevel(this._detectedGameItems);
      },
      () => { this.confirm.close(); this.overlay = null; });
  },
  // still the one revealed (the cursor hasn't moved on, no game started)
  _stillRevealed(it) { return !!(it && it._el && it._el.classList.contains("revealed") && !this._inGame); },
  // (games, and section items with a .json giving a gif / background / music)
  _revealGame(it) {
    const g = it.game || it.extra || {};
    if (it._el) it._el.classList.add("revealed");     // the game's name shows now
    if (g.background) {
      const url = assetUrl(g.background);
      // the picture is loaded and decoded first (off the main thread), and only
      // then shown in place of the wave: never a black moment while a big
      // picture (a PS3 game's PIC1.PNG) is still being read
      const im = new Image(); im.decoding = "async";
      const still = () => { const l = this._level(); return l.items[l.sel] === it && this._stillRevealed(it); };
      const show = () => {
        if (!still()) return;
        this.$bg.style.backgroundImage = `url("${url}")`; this.$bg.classList.add("show"); this._syncWaveHidden();
        // Hide Game Title on Background (Game Settings): the name goes once the background is up
        if ((it.game ? this._gameHideTitle(it.game) : this.settings?.behavior?.gameHideTitle) && it._el) it._el.classList.add("bg-notitle");
      };
      im.src = url;
      (im.decode ? im.decode() : new Promise((r, j) => { im.onload = r; im.onerror = j; })).then(show, () => show());
      this._bgKeep = im;   // (kept so the decoded picture stays in memory while shown)
    }
    if (it.icon.preview && it._el) {
      const gif = /\.gif([?#]|$)/i.test(it.icon.preview);
      const v = document.createElement(gif ? "img" : "video");
      v.src = it.icon.preview; v.className = "preview-vid";
      if (!gif) { v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; }
      const frame = it._el.querySelector(".art-frame");
      if (frame) {
        // the video / GIF shows in its own shape too (back to the icon's after)
        const fit = () => { frame._previewOn = true; fitArtRatio(frame, gif ? v.naturalWidth : v.videoWidth, gif ? v.naturalHeight : v.videoHeight); };
        v.addEventListener(gif ? "load" : "loadedmetadata", fit, { once: true });
        frame.appendChild(v); if (!gif) v.play().catch(() => {}); this._previewVid = v;
      }
    }
    // (the game's own music: not the Background Music, so it plays with that off too)
    if (g.music && this.user) this.audio.playMusic(assetUrl(g.music), 0.5, true);
  },
  _stopGameMedia() {
    if (this._previewVid) {
      const fr = this._previewVid.parentElement;
      this._previewVid.remove(); this._previewVid = null;
      if (fr) { fr._previewOn = false; if (fr._iconAr) fitArtRatio(fr, ...fr._iconAr); else fitArtRatio(fr, 16, 9); }
    }
    this.audio.stopPreview();
  },

  // ------------------------------------------------------------- game menus
  // △ on a game: the PS3 options panel down the right (the game's name hides
  // while it's open; the row gets the darker band and its format badge)
  _gameOptions(game) {
    const lvl = this._level(), it = lvl.items[lvl.sel];
    const el = it && it._el;
    const withBg = this.$bg.classList.contains("show");
    // Game Options Band (Game Settings, on by default): a see-through black band
    // behind the icon and the name, out to the panel; off: the name hides
    // (no band either for a game whose name hides on its background: Hide Game Title on Background)
    if (el && (!this._gameBandOn(game) || (this._gameHideTitle(game) && withBg))) el.classList.add("gm-open");
    else this._triBand(el);
    this.overlay = this.gameMenu;
    const done = () => { this.overlay = null; if (el) el.classList.remove("gm-open", "gm-band"); };
    this.gameMenu.open({ withBg, fmt: game.console || "PS3", subs: {
      sort: { options: [{ id: "created_desc", label: "Creation Date", tri: "down" }, { id: "created_asc", label: "Creation Date", tri: "up" },
        { id: "recent", label: "Recently Played" }, { id: "format", label: "Format" }], current: this._gameSortId() },
      // (listed By Format, By Album, All, as on the console)
      group: { options: ["format", "album", "all"].map((id) => MEDIA_MODES.game.find((m) => m.id === id)).filter(Boolean).map((m) => ({ id: m.id, label: m.label })),
        current: this._mediaMode("game") },
    } }, (id, val) => {
      if (id === "sort") { if (this.user) { this.user.gameSort = val; this._persistUser(); } this.gameMenu.close(); done(); this._refreshGameColumn(); return; }
      if (id === "group") {
        this.mediaMode.game = val; if (this.user) { this.user.mediaMode = this.mediaMode; this._persistUser(); }
        this.gameMenu.close(); done(); Promise.resolve(this._rebuildAndStay()).then(() => this._updateMediaSort(true)); return;
      }
      if (id === "start") { this.gameMenu.close(); done(); this.audio.play("enter", 0.6); this._launch(game); return; }
      if (id === "info") { this.audio.play("enter", 0.5); this.gameMenu.close(); done(); this._gameInfoPanel(game); return; }
      if (id === "search") { this.gameMenu.close(); done(); this._browserSearchFor(game.title); return; }
      if (id === "delete") { this.gameMenu.close(); done(); this._gameDelete(game); return; }
      this.audio.play("error", 0.4);          // not available in this system
    }, done);
  },
  // the see-through black band behind a row's icon and name while its △ panel
  // is open (games, Users, Account Management): centred on the screen (as
  // long on each side of the middle); it fades in from the picture's right
  // edge leftwards, and its right end (mirrored) sits behind the panel
  _triBand(el) {
    if (!el) return;
    const ir = el.getBoundingClientRect();
    const art = [...el.querySelectorAll(".art-img, .item-sys, .item-avatar, .art-frame")].map((n) => n.getBoundingClientRect()).find((r) => r.width > 4) || ir;
    const vw = innerWidth / 100, vh = innerHeight / 100;
    // (IMG_3679 / IMG_3680: the band is 23 % of the screen tall, centred 0.8 %
    // below the icon's middle; it starts 4.1 % left of a game's picture (grown
    // 1.36 x while the panel is open) and is fully in 5.8 % further right)
    // (IMG_3737: a game's band is exactly as tall as its picture, grown)
    // (IMG_3733 -> IMG_3734, IMG_3735 -> IMG_3736: a user's picture and
    // Account Management's icon grow 1.26 x too, see _triZoom)
    const game = el.classList.contains("item-game"), grow = game ? 1.36 : TRI_ZOOM;
    const artL = art.left + art.width / 2 - art.width * grow / 2;
    const left = Math.max(0, artL - 4.1 * vw), width = Math.max(1, (50 * vw - left) * 2);
    const fade = Math.min(48, Math.max(1, 5.8 * vw / width * 100));
    const midY = art.top + art.height / 2 + (game ? 0 : 0.8 * vh), bandH = game ? art.height * grow : 23 * vh;
    el.style.setProperty("--band-l", `${left - ir.left}px`);
    el.style.setProperty("--band-t", `${midY - bandH / 2 - ir.top}px`);
    el.style.setProperty("--band-h", `${bandH}px`);
    el.style.setProperty("--band-w", `${width}px`);
    el.style.setProperty("--band-f", `${fade.toFixed(2)}%`);
    el.classList.add("gm-band");
    if (!game) this._triZoom(el, true);
  },
  // a user's / Account Management's △ panel (IMG_3734, IMG_3736): its icon
  // grows 1.26 x about its middle and its name moves right; the rows above
  // move up and the rows below move down, their names hidden
  _triZoom(el, on) {
    const items = (this._level()?.items || []).map((it) => it._el).filter(Boolean), at = items.indexOf(el);
    items.forEach((e, j) => {
      e.classList.toggle("tri-zoom", on && j === at);
      e.classList.toggle("tri-up", on && at >= 0 && j < at);
      e.classList.toggle("tri-down", on && at >= 0 && j > at);
    });
  },
  // (a game's △ menu > Search: its title searched on the internet. This had the
  // same name as the browser's own Search (on-screen keyboard), which took its
  // place, so the game's title was never searched)
  _browserSearchFor(q) {
    if (this._browserActive || this._browserBusy) return;
    call("browser_status").then((st) => {
      if (!st || !st.ready) { this._openInternet("search"); return; }
      this._browserFirstRun = !st.installed; this.audio.play("enter", 0.6); this._browserStart("search", q);
    }).catch(() => {});
  },
  // the game's Sort By choice (older "title" / "created" choices: Creation Date ▼)
  _gameSortId() {
    const v = this.user?.gameSort;
    return ["created_desc", "created_asc", "recent", "format"].includes(v) ? v : "created_desc";
  },
  // Delete (the game options): the console's confirmation (IMG_3553): the
  // game's icon with its name / date / size under it, the message and Yes / No
  // (No chosen first) on the right
  _gameDelete(game) {
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ icon: game.icon ? assetUrl(game.icon) : "./assets/icons/system/default_game.png",
      meta: [gameName(game), game.created ? this._fmtCreated(game.created) : "", game.size || ""].filter(Boolean),
      text: "The installed game will be deleted.\nAre you sure you want to continue?" },
      async (yes) => {
        this.gameConfirm.close(); this.overlay = null;
        if (!yes) return;
        try { await call("game_delete", { folder: game.folder }); }
        catch (e) { this.audio.play("error", 0.4); }
        // (the menu waits, with the loading clock, until the list is drawn again)
        await this._refreshGameColumn();
      });
  },
  // Information: the game's icon and its details (Buyer = the signed-in user).
  // Read-only: the details are changed in Settings > Game Settings.
  _gameInfoPanel(game) {
    const dt = (v) => v ? this._fmtCreated(v) : "-";
    const rows = [
      ["Title", game.title], ["Album", game.album || "-"],
      ["Parental Control", game.parentalControl ? `Level ${game.parentalControl}` : "-"],
      ["Saved Data Auto-Upload", "Off"], ["Created", dt(game.created)], ["Size", game.size || "-"],
      ["Version", game.version || "-"], ["Buyer", this.user?.name || "-"], ["Starts", dt(game.starts)],
      ["Expires", "-"], ["Remaining Time", "No Time Limit"],
    ];
    this.overlay = this.gameInfo2;
    // a game with its own background: the system's background (wave /
    // wallpaper) shows behind Information, like the Sign In screen
    this.wave.setHidden(false);
    this.gameInfo2.open({ icon: game.icon ? assetUrl(game.icon) : null, rows }, () => {
      this.overlay = null;
      if (this.$bg.classList.contains("show")) this.wave.setHidden(true);
    });
  },
  // a program / script from a custom section: started like a game, but the
  // app keeps its sound and its screen (no black screen, nothing muted)
  async _launchApp(game) {
    // (program: the app's screen stays showing while it runs)
    const r = await call("launch_game", { folder: game.folder, launch: game.launch, args: game.args || [], program: true }).catch(() => null);
    if (!r || r.ok === false) { this.audio.play("error", 0.5); return; }
    // (the program is followed like a game, the app stepping aside; once the
    // user is back in the app, it's itself again at once: its priority, the
    // controller, even with the program still open)
    this._appWatchOff && this._appWatchOff();
    let left = false;
    const onBlur = () => { left = true; };
    const off = this._appWatchOff = () => { window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus); if (this._appWatchOff === off) this._appWatchOff = null; };
    const onFocus = () => { if (!left) return; off(); call("game_mode_end").catch(() => {}); };
    window.addEventListener("blur", onBlur); window.addEventListener("focus", onFocus);
  },
  async _launch(game) {
    // Game mode: fade to black, silence the whole app (whatever Play Audio in
    // Background says) and stop everything (wave, animations, videos, icon
    // loading, controller reading); the app stays full screen behind the game.
    // When the game ends the app notices by itself ("game-exited") and comes
    // back to the front; returning to it by hand works too.
    const fb = document.getElementById("fadeblack");
    // (for Sort By > Recently Played)
    if (this.user && game.folder) { (this.user.gamePlayed ||= {})[game.folder] = Date.now(); this._persistUser(); }
    // the screen dissolves into black first (the menu, the wave and the music
    // fading out with it), and only then does everything stop and the game start
    if (this._launching) return;
    this._appWatchOff && this._appWatchOff();   // (a program started before: the game's own watch from now on)
    this._launching = true;   // (no input meanwhile: see onInput)
    fb.classList.add("show");
    const music = [this.audio.bg, this.audio.preview].filter((a) => a && !a.paused);
    const vols = music.map((a) => a.volume), t0 = performance.now(), FADE = 900;
    await new Promise((res) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / FADE);
        music.forEach((a, i) => { a.volume = vols[i] * (1 - k); });
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
      setTimeout(res, FADE + 300);   // (frames may be slow: never wait much longer)
    });
    this._launching = false;
    this._stopGameMedia();
    this.audio.enabled = false; this.audio.musicEnabled = false;
    this.audio.enterGame(); this._inGame = true; this.setLowPower(2);
    music.forEach((a, i) => { a.volume = vols[i]; });   // (paused by enterGame; back at their volume for later)
    document.body.classList.add("in-game");
    // (the Music Player's sound graph, if it was used: stopped too, until the user is back)
    const tapCtx = this.musicPlayer?._tap?.ctx, tapWas = tapCtx && tapCtx.state === "running";
    if (tapWas) tapCtx.suspend().catch(() => {});
    const r = await call("launch_game", { folder: game.folder, launch: game.launch, args: game.args || [] }).catch(() => null);
    let unlisten = null, armed = false, vis = null, onKey = null;
    const startedAt = performance.now();
    const restore = () => {
      if (!this._inGame) return;
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", vis);
      if (unlisten) { try { unlisten(); } catch (e) {} }
      call("game_mode_end").catch(() => {});
      // (in the log: the page itself is back, not only the window)
      logLine("info", `back from the game: the menus show again (page ${document.visibilityState}, ${document.hasFocus() ? "with" : "without"} the focus)`);
      document.body.classList.remove("in-game");
      fb.classList.remove("show");
      this._inGame = false; this.setLowPower(document.hasFocus() ? 0 : 1);
      this.audio.enabled = this.user?.soundEnabled !== false;
      this.audio.musicEnabled = this.user?.musicEnabled !== false;
      this.audio.leaveGame();
      if (tapWas) tapCtx.resume().catch(() => {});
      this._onSelect();
    };
    if (!r || r.ok === false) { restore(); setTimeout(() => this.audio.play("error", 0.5), 300); return; }
    // The user back in the app: the backend tells (it hides the page once the
    // game's own window is in front, and shows it again when the window gets
    // the focus back: the page coming back into view ends game mode). The
    // window's focus alone doesn't: a launcher's window (Steam's "launching"
    // box) closing gives it back while the game is still loading.
    vis = () => { if (document.hidden) armed = true; else if (armed) restore(); };
    document.addEventListener("visibilitychange", vis);
    // (the app has the keyboard while the game should be running: the game
    // ended, or never showed, without the app noticing: a key brings it back)
    onKey = () => { if (performance.now() - startedAt > 6000 && document.hasFocus()) restore(); };
    window.addEventListener("keydown", onKey, true);
    const ev = window.__TAURI__?.event;
    if (ev?.listen) ev.listen("game-exited", restore).then((u) => { unlisten = u; if (!this._inGame) u(); });
  },
};
