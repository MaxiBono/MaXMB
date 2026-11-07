// XMB: media (the Xmb class's methods, from xmb.js; put on its prototype there)
import { FIXED_ITEMS, FORMAT_NAMES, MEDIA_MODES, discographyOrder, fmtDurClock, fmtSize, fmtTime, winPath } from "./xmb-shared.js";
import { assetUrl, bumpAsset, call, cmpBase, cmpNatural, cmpText, noExt, thumbUrl } from "./api.js";
import { docThumb, isDocPath } from "./docs.js";
import { sysUrl } from "./themes.js";

export const MediaMethods = {
  // Music / Photo / Video lists again (after the media folders change)
  // A library's fingerprint (a short code from its files' places, sizes and
  // dates, made without opening them) is noted each time its list is read, so
  // reading it again can be skipped while nothing changed
  async _takeMediaFingerprints(ids) {
    const fp = (this._mediaFp ||= {});
    await Promise.all(ids.map(async (id) => { try { fp[id] = await call("media_fingerprint", { kind: id }); } catch (e) { fp[id] = null; } }));
  },
  // force: build them again even when the same files are listed (their
  // pictures changed: covers read again)
  async _refreshMediaColumns(only, force = false) {
    await this._takeMediaFingerprints(only ? [only] : ["photo", "video", "music"]);
    for (const id of only ? [only] : ["photo", "video", "music"]) {
      const col = this.columns ? this.columns.find((c) => c.id === id) : null;
      if (!col) continue;
      const items = id === "music" ? await this._musicItems() : [...col.items.slice(0, FIXED_ITEMS[id]), ...await this._mediaSectionItems(id)];
      const same = items.length === col.items.length && items.every((x, i) => x.title === col.items[i].title && x.sub === col.items[i].sub);
      if (same && !force) continue;
      col.items = items;
      if (col.sel != null && col.sel >= col.items.length) col.sel = Math.max(0, col.items.length - 1);
      // the column on screen (at its top level) shows the new list in place
      if (this.columns[this.selCat] === col && this.levels.length === 1 && !this.overlay) {
        const cur = this.levels[0].items[this.levels[0].sel];
        let sel = cur ? items.findIndex((x) => x.title === cur.title) : -1;
        if (sel < 0) sel = Math.min(this.levels[0].sel, items.length - 1);
        this.levels[0].items = items; this.levels[0].sel = Math.max(0, sel); this._render(); this._onSelect();
      }
    }
  },
  // New files / games in the source folders (or put in the app's folders by
  // hand) show up when their column is opened, without a restart.
  _liveRefresh(id) {
    if (String(id).startsWith("sec:")) { this._liveRefreshSection(id); return; }
    if (!["game", "music", "photo", "video"].includes(id) || this._inGame) return;
    const now = Date.now(); this._liveAt ||= {};
    if (now - (this._liveAt[id] || 0) < 8000) return;
    this._liveAt[id] = now;
    setTimeout(async () => {
      if (this.columns[this.selCat]?.id !== id) return;
      if (id === "game") { this._refreshGameColumn().then(() => this._scrapeWaiting()); return; }
      // the whole list is read and built again only when the library's
      // fingerprint changed (files added, removed, renamed or changed): with a
      // big library that's a lot of work (and memory to clean up afterwards)
      let fp = null; try { fp = await call("media_fingerprint", { kind: id }); } catch (e) {}
      if (fp && fp === (this._mediaFp || {})[id]) return;
      if (this.columns[this.selCat]?.id !== id) return;
      this._refreshMediaColumns(id);
    }, 450);   // after the column has slid in
  },

  // A custom section, reached: its folders are read again, and when anything
  // in them changed (folders or files added, removed or renamed) it's drawn
  // again at once, the cursor staying on the same item
  _liveRefreshSection(id) {
    if (this._inGame) return;
    const now = Date.now(); this._liveAt ||= {};
    if (now - (this._liveAt[id] || 0) < 3000) return;
    this._liveAt[id] = now;
    setTimeout(async () => {
      const col = this.columns[this.selCat];
      if (!col || col.id !== id || this.levels.length !== 1 || this.overlay) return;
      const sec = this._sectionById(col.section); if (!sec) return;
      let fresh; try { fresh = await this._sectionColumn(sec); } catch (e) { return; }
      const sig = (c) => JSON.stringify([c.entries, c.subEntries]);
      if (sig(fresh) === sig(col)) return;
      // (only if nothing moved meanwhile)
      if (this.columns[this.selCat] !== col || this.levels.length !== 1 || this.overlay || this._placing) return;
      for (const [k, v] of Object.entries(col)) if (k.startsWith("_") && !(k in fresh)) fresh[k] = v;
      const selT = this.levels[0].items[this.levels[0].sel]?.title;
      this.columns[this.selCat] = fresh;
      const i = fresh.items.findIndex((x) => x.title === selT);
      this.levels = [{ items: fresh.items, sel: Math.max(0, Math.min(i >= 0 ? i : this.levels[0].sel, fresh.items.length - 1)) }];
      this._render(); this._onSelect();
    }, 450);
  },

  // ---- Media Folders submenu (System Settings) ------------------------------
  // Music, Videos and Photos are always read from the app's own folders. The
  // folders added here are their sources: File Recognition gives every file in
  // them a shortcut in the matching app folder (in a folder named after the
  // source), which can be moved into folders of your own there, like games.
  // Subtitles are read where they are.
  _mediaFolderItems() {
    const SI = { sys: "icon_setting_item.png" };
    const row = (key, title, app, what) => {
      const list = this._mediaList(key);
      return { kind: "drill", title, icon: SI, childrenFn: () => this._mediaFolderList(key, app),
        sub: list.length ? list.map(winPath).join("\n") : `No folders added. The system only reads the ${what} files from the system's content\\${app} directory.` };
    };
    return [
      row("music", "Music Folders", "Music", "music"),
      row("photos", "Photo Folders", "Photos", "photo"),
      row("videos", "Video Folders", "Videos", "video"),
      row("subtitles", "Subtitle Folders", "Subtitles", "subtitle"),
      { kind: "action", act: "media_recog::all", title: "File Recognition", icon: SI,
        sub: "The system looks through every chosen media folder to add their files to the system." },
    ];
  },
  // the folders chosen for one kind (older settings kept a single path)
  _mediaList(key) {
    const v = (this.settings?.mediaFolders || {})[key];
    return (Array.isArray(v) ? v : v ? [v] : []).filter((p) => p && String(p).trim());
  },
  _mediaKind(key) { return { music: "music", videos: "video", photos: "photo" }[key] || null; },
  _mediaFolderList(key, app) {
    const SI = { sys: "icon_setting_item.png" };
    const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
    const list = this._mediaList(key);
    const kind = this._mediaKind(key);
    return [
      { kind: "action", act: `media_pick::${key}`, title: "Add Folder", icon: SI,
        sub: kind ? `Choose a folder to read ${app.toLowerCase()} from. Its files get shortcuts in the ${app} folder in the app directory right away.`
          : "Choose a folder to read subtitles from." },
      ...(kind && list.length ? [{ kind: "action", act: `media_recog::${kind}`, title: "File Recognition", icon: SI,
        sub: `Looks through these folders now and makes shortcuts for the new files in the ${app} folder in the app directory.` }] : []),
      ...list.map((p, i) => ({ kind: "action", act: `media_rm::${key}::${i}`, title: base(p), icon: SI,
        sub: kind ? `${winPath(p)}\nPress \u2715 to remove this folder. The shortcuts made from it are removed too (its files aren't touched).`
          : `${winPath(p)}\nPress \u2715 to remove this folder (its files aren't touched).` })),
    ];
  },
  async _mediaPick(key) {
    if (this._picking) return;
    this._picking = true;
    const names = { music: "Music", videos: "Video", photos: "Photo", subtitles: "Subtitle" };
    const apps = { music: "Music", videos: "Videos", photos: "Photos", subtitles: "Subtitles" };
    let path = null;
    try { path = await call("pick_folder", { title: `Add a ${names[key]} Folder` }); } catch (e) {}
    this._picking = false;
    if (!path) return;
    const list = this._mediaList(key);
    if (!list.includes(path)) list.push(path);
    this.settings.mediaFolders = { ...(this.settings.mediaFolders || {}), [key]: list };
    await this._persistSettings(); this.audio.play("enter", 0.5);
    this._rebuildLevel(() => this._mediaFolderList(key, apps[key]));
    this._refreshParentMediaFolders();
    const kind = this._mediaKind(key);
    if (kind) {
      // its files are recognized right away (the menu waits, with a counter)
      const lvl = this._level(); const i = lvl.items.findIndex((x) => x.act === `media_recog::${kind}`);
      if (i >= 0) { lvl.sel = i; this._render(); this._onSelect(); }
      await this._mediaRecognize(kind);
    }
  },
  // File Recognition, with the menu locked and a counter beside the option
  async _mediaRecognize(kind) {
    const n = await this._runLocked(`media_recog::${kind}`, "Recognizing files...",
      () => call("media_recognize", { kind }).catch(() => 0));
    await this._refreshMediaColumns();
    this._shotFeedback(n ? `${n} new file${n === 1 ? "" : "s"} found` : "No new files found");
  },
  _refreshParentMediaFolders() {
    const parent = this.levels[this.levels.length - 2];
    if (parent && parent.items.some((x) => x.act === "media_recog::all")) parent.items = this._mediaFolderItems();
  },
  _mediaRemove(key, i) {
    const list = this._mediaList(key);
    if (!list[i]) return;
    const kind = this._mediaKind(key);
    this.overlay = this.confirm;
    const fname = list[i];   // (the whole path)
    this.confirm.open(kind ? `Remove the ${fname} folder? The shortcuts made from it are removed too (its files aren't touched).` : `Remove the ${fname} folder? (Its files aren't touched.)`,
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      async (c) => {
        this.confirm.close(); this.overlay = null;
        if (!c || c.id !== "yes") return;
        const src = list[i];
        list.splice(i, 1);
        this.settings.mediaFolders = { ...(this.settings.mediaFolders || {}), [key]: list };
        this._persistSettings(); this.audio.play("back", 0.5);
        if (kind) { try { await call("media_source_remove", { kind, source: src }); } catch (e) {} }
        const names = { music: "Music", videos: "Videos", photos: "Photos", subtitles: "Subtitles" };
        this._rebuildLevel(() => this._mediaFolderList(key, names[key]));
        this._refreshParentMediaFolders();
        if (kind) this._refreshMediaColumns();
      },
      () => { this.confirm.close(); this.overlay = null; });
  },


  // Build one media item (song/photo/video) with the right thumbnail:
  //  - photo → the image itself
  //  - music → the track's embedded album cover, else the Music Default icon
  //  - video → the default video icon
  _mediaItemObj(kind, m) {
    let icon;
    if (kind === "photo" && isDocPath(m.path)) icon = { art: sysUrl("icon_photo_default.png") };
    // (lists show a small copy of the picture; `full` is the picture itself:
    // songs shown inside an opened folder use it, see _makeItemEl)
    else if (kind === "photo") icon = { art: thumbUrl(m.path), full: assetUrl(m.path) };
    else if (kind === "music") icon = m.cover ? { art: thumbUrl(m.cover), full: assetUrl(m.cover) } : { sys: "icon_music_default.png" };
    else if (kind === "video" && (m.cover || m.clip)) icon = { art: m.cover ? assetUrl(m.cover) : "", clip: m.clip ? assetUrl(m.clip) : null };
    else icon = { sys: this.manifest.defaults?.[kind] || "icon_default_h.png" };
    // pictures / videos: the title from the file's tags, else its name, never with the extension
    const o = { kind, title: kind === "music" ? (m.title || m.name) : noExt(m.title || m.name), sub: this._mediaSub(kind, m), icon, media: m };
    // a PDF / comic: its first page becomes the icon once it's made
    if (kind === "photo" && isDocPath(m.path)) {
      o.sub = (m.ext || "").toUpperCase();
      docThumb(assetUrl(m.path), m.path).then((u) => {
        o.icon = { ...o.icon, art: u };
        const img = o._el && o._el.querySelector("img"); if (img) img.src = u;
      }).catch(() => {});
    }
    if (kind === "video") {
      // as on the console: the title without the extension, then
      // "28/9/2012  8:55 AM   2'12''" (date, time, length) on every row
      o.title = noExt(m.title || m.name);
      o.sub = this._videoSub(m);
    }
    if (kind === "music") {
      o.pre = [m.artist, m.album].filter(Boolean).join(" / ");
      o.sub = m.durationSecs ? fmtDurClock(m.durationSecs) : (m.ext || "").toUpperCase();
    }
    return o;
  },

  _videoSub(m) {
    const parts = [];
    if (m.modified) parts.push(this._fmtDateTime(new Date(m.modified * 1000)));
    if (m.durationSecs != null) {
      const t = Math.round(m.durationSecs), hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = String(t % 60).padStart(2, "0");
      parts.push(hh ? `${hh}'${String(mm).padStart(2, "0")}'${ss}''` : `${mm}'${ss}''`);
    }
    return parts.join("\u2002\u2002");
  },
  // Immediate parent folder name of a file path (used as the "album" for photos
  // / videos, which now come from nested content subfolders too).
  _parentFolder(path) {
    const parts = String(path || "").split(/[\\/]/).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : "Unknown";
  },

  // Group name for a media item under a given section + sort mode.
  _groupName(kind, modeId, m) {
    switch (modeId) {
      case "album": return (kind === "music" ? m.album : m.inRoot ? null : (m.folder || this._parentFolder(m.path))) || "Unknown";
      case "artist": return m.artist || "Unknown";
      case "genre": return m.genre || "Unknown";
      case "year": return (kind === "music" ? m.year : null)
        || (m.modified ? new Date(m.modified * 1000).getFullYear().toString() : "Unknown");
      case "title": {      // folders "0", "4", "A", "M"… by the first character
        const t = String(m.title || m.name || "").trim();
        const ch = t ? [...t][0].toLocaleUpperCase() : "#";
        return ch;
      }
      case "month": return m.modified
        ? new Date(m.modified * 1000).toLocaleString("en-US", { month: "long", year: "numeric" }) : "Unknown";
      default: return "Unknown";
    }
  },

  // Turn a flat list of media entries into either a flat list ("All"/flat modes)
  // or a set of folder drills, per the section's current sort mode.
  _groupMedia(kind, entries) {
    const modes = MEDIA_MODES[kind];
    const cfg = modes.find((x) => x.id === this._mediaMode(kind)) || modes[0];
    const byTitle = (a, b) => cmpNatural(String(a.title || ""), String(b.title || ""));
    if (cfg.id === "all") return [...entries].sort(byTitle);   // "All" = alphabetical
    if (cfg.flat) return [...entries].sort((a, b) =>
      cmpText(String(a.title || ""), String(b.title || "")));
    const loose = [];
    const groups = new Map();
    for (const e of entries) {
      const k = this._groupName(kind, cfg.id, e.media);
      if (k == null) { loose.push(e); continue; }
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const unit = kind === "music" ? "Track" : (kind === "photo" ? "Image" : "Title");
    const drills = [...groups.entries()].map(([name, items]) => {
      let children = items;
      if (cfg.id === "title") children = [...items].sort(byTitle);
      else if (kind === "music" && cfg.id === "artist") children = discographyOrder(items);
      else if (kind === "music" && cfg.id === "genre") {
        // artists A-Z, each artist's albums oldest → newest, songs in track order
        const byArtist = new Map();
        for (const e of items) { const a = (e.media.artist || "").trim() || "Unknown"; if (!byArtist.has(a)) byArtist.set(a, []); byArtist.get(a).push(e); }
        children = [...byArtist.keys()].sort((a, b) => cmpBase(a, b))
          .flatMap((a) => discographyOrder(byArtist.get(a)));
      } else if (kind === "music") children = [...items].sort((a, b) =>
        (a.media.disc || 0) - (b.media.disc || 0) ||
        (a.media.track || 0) - (b.media.track || 0) ||
        cmpText(String(a.title || ""), String(b.title || "")));
      const n = children.length;
      // folder shows a FOLDER graphic with the first item's thumbnail inside it
      const firstArt = children[0] && children[0].icon && children[0].icon.art;
      const folderIcon = { folder: kind, art: firstArt || null };
      let sub;
      if (kind === "music") {
        const total = children.reduce((s, c) => s + (c.media.durationSecs || 0), 0);
        sub = `${n} ${unit}${n !== 1 ? "s" : ""}${total ? "  " + fmtDurClock(total) : ""}`;
      } else {
        sub = `${n} ${unit}${n !== 1 ? "s" : ""}`;
      }
      return { kind: "drill", title: name, sub, icon: folderIcon, children };
    });
    drills.sort((a, b) => cmpNatural(a.title, b.title));
    return loose.length ? [...drills, ...loose.sort(byTitle)] : drills;
  },

  _formatName(c) { return FORMAT_NAMES[c] || c || "PS3"; },
  _mediaMode(kind) { return (this.mediaMode && this.mediaMode[kind]) || "all"; },

  // Section body (songs/photos/videos) for the current sort mode.
  async _mediaSectionItems(kind) {
    const media = await call("list_media", { kind });
    if (!media.length) return [];   // nothing found: nothing shown
    const entries = media.map((m) => this._mediaItemObj(kind, m));
    return this._groupMedia(kind, entries);
  },

  async _musicItems() {
    const media = await call("list_media", { kind: "music" });
    const entries = media.map((m) => this._mediaItemObj("music", m));
    const trackByPath = Object.fromEntries(entries.map((t) => [t.media.path, t]));
    const playlists = this.user?.playlists || [];
    const playlistChildren = [
      { kind: "action", act: "playlist_create", title: "Create Playlist", icon: { sys: "icon_playlist_add.png" } },
      ...playlists.map((p) => {
        const plTracks = p.tracks.map((path) => trackByPath[path]).filter(Boolean);
        // same rule as media folders: show the first track's cover on the music
        // folder, else the Default music folder when none has cover art.
        const firstArt = (plTracks.find((t) => t.icon && t.icon.art) || {}).icon?.art || null;
        // edit actions first, then the tracks
        const edit = [
          { kind: "action", act: "playlist_add::" + p.name, title: "Add Songs", icon: { sys: "icon_playlist_add.png" } },
          { kind: "action", act: "playlist_remove::" + p.name, title: "Remove Songs", icon: { sys: "icon_playlist.png" } },
        ];
        return { kind: "drill", title: p.name, sub: `${p.tracks.length} track${p.tracks.length !== 1 ? "s" : ""}`,
          icon: { folder: "music", art: firstArt },
          children: [...edit, ...plTracks] };
      }),
    ];
    const body = entries.length ? this._groupMedia("music", entries) : [];
    return [
      this._mediaServersItem(),
      { kind: "drill", title: "Playlists", icon: { sys: "icon_playlist.png" }, children: playlistChildren },
      ...body,
    ];
  },

  // Image playlists: mirror the music playlists: a "Create Playlist" action
  // plus each saved playlist as a drill of its photos, led by "Play Slideshow".
  async _photoPlaylistItems() {
    const media = await call("list_media", { kind: "photo" });
    const byPath = Object.fromEntries(media.map((m) => [m.path, m]));
    const playlists = this.user?.photoPlaylists || [];
    return [
      { kind: "action", act: "photo_playlist_create", title: "Create Playlist", icon: { sys: "icon_playlist_add.png" } },
      ...playlists.map((p) => {
        const photos = (p.photos || []).map((path) => byPath[path]).filter(Boolean);
        const firstArt = photos.length ? thumbUrl(photos[0].path) : null;
        const children = photos.length
          ? [{ kind: "action", act: "photo_slideshow", playlist: p.name, title: "Play Slideshow", icon: { sys: "icon_playlist.png" } },
             ...photos.map((m) => ({ kind: "photo", title: noExt(m.title || m.name), sub: this._mediaSub("photo", m), icon: { art: thumbUrl(m.path), full: assetUrl(m.path) }, media: m }))]
          : [{ kind: "empty", title: "No photos", icon: { sys: "photo_gallery.png" } }];
        return { kind: "drill", title: p.name, sub: `${photos.length} photo${photos.length !== 1 ? "s" : ""}`, icon: { folder: "photo", art: firstArt }, children };
      }),
    ];
  },

  _mediaSub(kind, m) {
    if (kind === "music") {
      const parts = [m.artist, m.album].filter(Boolean).join(" \u2014 ");
      const dur = m.durationSecs ? fmtTime(m.durationSecs) : "";
      return [parts, dur].filter(Boolean).join("  \u00b7  ") || m.ext.toUpperCase();
    }
    if (kind === "photo") return m.width ? `${m.width} \u00d7 ${m.height}` : m.ext.toUpperCase();
    return [m.ext.toUpperCase(), fmtSize(m.size)].filter(Boolean).join("  \u00b7  ");
  },
  // after the video player closes: drop deleted videos and show new icons
  // (Change Icon) in every open level of the Video column, then re-read it
  async _refreshVideos() {
    const del = this._vidDeleted, icons = this._vidIcons;
    this._vidDeleted = null; this._vidIcons = null;
    if (!del && !icons) return;
    const stamp = Date.now();
    const fix = (items) => items.filter((it) => !(it.media && del && del.has(it.media.path))).map((it) => {
      const ic = it.media && icons && icons.get(it.media.path);
      if (ic) {
        it.media.cover = ic.cover; it.media.clip = ic.clip;
        it.icon = { art: ic.cover ? assetUrl(ic.cover) + `?v=${stamp}` : "", clip: ic.clip ? assetUrl(ic.clip) + `?v=${stamp}` : null };
      }
      return it;
    });
    const col = this.columns ? this.columns.find((c) => c.id === "video") : null;
    if (col && this.columns[this.selCat] === col) {
      for (const lvl of this.levels) { lvl.items = fix(lvl.items); if (lvl.sel >= lvl.items.length) lvl.sel = Math.max(0, lvl.items.length - 1); }
      col.items = this.levels[0].items;
      this._render(); this._onSelect();
    }
    if (col && (this.levels.length === 1 || this.columns[this.selCat] !== col)) {
      try { col.items = [...col.items.slice(0, FIXED_ITEMS.video), ...await this._mediaSectionItems("video")]; } catch (e) {}
      if (col.sel != null && col.sel >= col.items.length) col.sel = Math.max(0, col.items.length - 1);
      if (this.columns[this.selCat] === col && this.levels.length === 1) { this.levels[0].items = col.items; this._render(); this._onSelect(); }
    }
  },
  // after the music player closes: deleted songs leave every open level of the
  // Music column and every playlist, then the column is read again
  async _refreshMusicAfterDelete() {
    const del = this._musDeleted; this._musDeleted = null;
    if (!del || !del.size) return;
    let plChanged = false;
    for (const pl of (this.user && this.user.playlists) || []) {
      const n = pl.tracks.length; pl.tracks = pl.tracks.filter((p) => !del.has(p)); if (pl.tracks.length !== n) plChanged = true;
    }
    if (plChanged) this._persistUser();
    const col = this.columns ? this.columns.find((c) => c.id === "music") : null;
    if (!col) return;
    const here = this.columns[this.selCat] === col;
    if (here) {
      for (const lvl of this.levels) {
        lvl.items = lvl.items.filter((it) => !(it.media && del.has(it.media.path)));
        if (lvl.sel >= lvl.items.length) lvl.sel = Math.max(0, lvl.items.length - 1);
      }
      if (this.levels.length === 1) col.items = this.levels[0].items;
      this._render(); this._onSelect();
    }
    if (!here || this.levels.length === 1) {
      try { col.items = await this._musicItems(); } catch (e) {}
      if (col.sel != null && col.sel >= col.items.length) col.sel = Math.max(0, col.items.length - 1);
      if (here && this.levels.length === 1) { this.levels[0].items = col.items; this._render(); this._onSelect(); }
    }
  },
  // new photos (screenshots) show up in the Photo column without a restart
  async _refreshPhotoColumn() {
    const ci = this.columns ? this.columns.findIndex((c) => c.id === "photo") : -1;
    if (ci < 0 || ci === this.selCat) return;
    const col = this.columns[ci];
    col.items = [...col.items.slice(0, FIXED_ITEMS.photo), ...await this._mediaSectionItems("photo")];
  },

  // Photo Gallery visor: a fullscreen viewer of every image saved on the system
  // (prev / next only: no slideshow play/pause; that lives in Playlists).
  async _openPhotoGallery() {
    const media = await call("list_media", { kind: "photo" });
    if (!media.length) { this.audio.play("error", 0.5); return; }
    this.audio.play("enter", 0.6);
    const url = (mm) => assetUrl(mm.path), small = (mm) => thumbUrl(mm.path);
    const openGrid = (start) => {
      this.overlay = this.photoGrid;
      this.photoGrid.open(media, small, (idx) => {
        // view the chosen photo; Back returns to the grid at that photo
        this.photoGrid.close();
        this.overlay = this.photoViewer;
        this.photoViewer.open(media, idx, url, () => { openGrid(idx); this._afterPhotoViewer(); }, this._pvOpts());
      }, () => { this.photoGrid.close(); this.overlay = null; }, start || 0);
    };
    openGrid(0);
  },
  // Which extensions the webview can't play natively and therefore need the
  // backend decoder (kept in sync with audio.rs / the Preload description).
  _needsDecode(pathOrName) {
    const m = /\.([a-z0-9]+)$/i.exec(pathOrName || ""); const e = (m ? m[1] : "").toLowerCase();
    return ["wma", "at3", "at9", "oma", "aa3", "dsf", "dff"].includes(e);
  },
  // Preload All Songs: decode every track in an unsupported format ahead of time
  // so playback is instant. Shows a spinning loader beside the option, then a
  // tick. Decoded WAV paths are cached in this._decoded and reused by the player.
  async _preloadAllSongs() {
    if (this._preloadState === "loading") return;
    this._decoded ||= {};
    // the loader shows (and the menu locks) right away, also while the songs
    // are being listed, so a second press can't start another preload
    this._preloadState = "loading"; this._preloadAct = "preload"; this._preloadTitle = null;
    this._preloadDone = 0; this._preloadTotal = 0;
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    let tracks = [];
    try { tracks = await call("list_media", { kind: "music" }); } catch (e) {}
    const todo = tracks.filter((t) => t && t.path && this._needsDecode(t.path) && !this._decoded[t.path]);
    this._preloadTotal = todo.length;
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    for (const t of todo) {
      try {
        const wav = await call("decode_audio", { path: t.path });
        if (wav) this._decoded[t.path] = wav;
      } catch (e) { /* leave undecoded; player will show the error at play time */ }
      this._preloadDone++;
      this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    }
    this._preloadState = "done";
    this.audio.play("enter", 0.4);
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
  },
  // Preload All Videos: make the playable copy of every video that needs one
  // (ffmpeg remux / conversion), with the same loader + tick as the songs.
  async _preloadAllVideos() {
    if (this._preloadState === "loading") return;
    this._preloadState = "loading"; this._preloadAct = "preloadvideos"; this._preloadTitle = null;
    this._preloadDone = 0; this._preloadTotal = 0;
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    let vids = [];
    this._noAutoConvert = false; this._vplay = new Map();
    try { vids = await call("list_media", { kind: "video" }); } catch (e) {}
    this._preloadTotal = vids.length;
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    let failed = 0;
    for (const v of vids) {
      try { await call("video_preload", { path: v.path }); } catch (e) { failed++; }
      this._preloadDone++;
      this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    }
    this._preloadState = "done";
    this.audio.play(failed && failed === vids.length ? "error" : "enter", 0.4);
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
  },
  async _selectBgMusic() {
    const tracks = await call("list_media", { kind: "music" });
    const playlists = this.user.playlists || [];
    const nSongs = (n) => `${n} song${n !== 1 ? "s" : ""}`;
    // The Square button cycles the list's mode: All songs, By Album (in order or
    // shuffled), or By Artist (albums in release order, or all songs shuffled).
    const MODES = ["all", "album_order", "album_shuffle", "artist_order", "artist_shuffle", "playlist"];
    const MODE_LABELS = {
      all: "All", album_order: "By Album (In Order)", album_shuffle: "By Album (Shuffled)",
      artist_order: "By Artist (In Order)", artist_shuffle: "By Artist (Shuffled)", playlist: "By Playlist",
    };
    let mode = this._bgSelMode && MODES.includes(this._bgSelMode) ? this._bgSelMode : "all";
    const off = { label: "Off", id: JSON.stringify(null) };
    const countBy = (keyFn) => {
      const m = new Map();
      for (const t of tracks) { const k = (keyFn(t) || "").trim(); if (!k) continue; m.set(k, (m.get(k) || 0) + 1); }
      return m;
    };
    const buildItems = () => {
      if (mode === "all") {
        return [off,
          { label: "Shuffle All Songs", id: JSON.stringify({ mode: "shuffleAll" }), sub: nSongs(tracks.length) },
          // every song, A to Z by its name
          // (each song's line under its name is worked out when its row comes into view)
          ...tracks.map((t) => ({ label: t.title || t.name || t.path.split(/[\\/]/).pop(), id: JSON.stringify({ mode: "song", path: t.path }), subFn: () => this._mediaSub("music", t) }))
            .sort((a, b) => cmpNatural(a.label, b.label)),
        ];
      }
      if (mode === "playlist") {
        // each saved playlist, played shuffled
        return [off, ...playlists.map((p) => ({ label: p.name, id: JSON.stringify({ mode: "shufflePlaylist", name: p.name }), sub: nSongs(p.tracks.length) }))];
      }
      if (mode === "album_order" || mode === "album_shuffle") {
        const am = countBy((t) => t.album);
        const albums = [...am.keys()].sort((a, b) => cmpText(a, b));
        const pm = mode === "album_shuffle" ? "albumShuffle" : "album";
        return [off, ...albums.map((a) => ({ label: a, id: JSON.stringify({ mode: pm, name: a }), sub: nSongs(am.get(a)) }))];
      }
      const arm = countBy((t) => t.artist);
      const artists = [...arm.keys()].sort((a, b) => cmpText(a, b));
      const pm = mode === "artist_shuffle" ? "artistShuffle" : "artistOrder";
      return [off, ...artists.map((a) => ({ label: a, id: JSON.stringify({ mode: pm, name: a }), sub: nSongs(arm.get(a)) }))];
    };
    const title = () => MODE_LABELS[mode];
    const cur = JSON.stringify(this.user.bgMusic ?? null);
    const first = buildItems();
    const startIdx = Math.max(0, first.findIndex((it) => it.id === cur));
    this.overlay = this.listPicker;
    this.listPicker.open({ title: title(), items: first, onSquare: () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      this._bgSelMode = mode;
      this.audio.play("enter", 0.4);
      this.listPicker.setList(buildItems(), title());
    } }, (choice) => {
      this.listPicker.close(); this.overlay = null;
      this.user.bgMusic = JSON.parse(choice.id);
      this._persistUser();
      this._applyBgMusic();
    }, () => { this.listPicker.close(); this.overlay = null; });
    this.listPicker.i = startIdx; this.listPicker._upd();
  },

  // Create a playlist: name it, then multi-select songs from a full-screen list.
  async _createPlaylist() {
    const tracks = await call("list_media", { kind: "music" });
    if (!tracks.length) return;
    this.overlay = this.textForm;
    this.textForm.open({ title: "Create Playlist", prompt: "Enter a name for the playlist.", fields: [{ key: "name", label: "Playlist Name", value: "Playlist", required: true }], submit: "Next" },
      ({ name }) => {
        this.textForm.close();
        const items = tracks.map((t) => ({ label: t.title || t.name, id: t.path, sub: this._mediaSub("music", t), thumb: t.cover ? thumbUrl(t.cover) : null }));
        this.overlay = this.listPicker;
        this.listPicker.open({ title: `${name}: pick songs`, items, multi: true, grid: true, submit: "Save Playlist" }, (chosen) => {
          this.listPicker.close(); this.overlay = null;
          if (chosen.length) {
            (this.user.playlists ||= []).push({ name, tracks: chosen });
            this._persistUser();
          }
          this._rebuildAndStay();
        }, () => { this.listPicker.close(); this.overlay = null; });
      }, () => { this.textForm.close(); this.overlay = null; });
  },

  // Add songs to an existing playlist: multi-select from the songs not already
  // in it; the chosen ones are appended.
  async _editPlaylistAdd(name) {
    const pl = (this.user.playlists || []).find((p) => p.name === name); if (!pl) return;
    const tracks = await call("list_media", { kind: "music" });
    const have = new Set(pl.tracks);
    const avail = tracks.filter((t) => !have.has(t.path));
    if (!avail.length) return;
    const items = avail.map((t) => ({ label: t.title || t.name, id: t.path, sub: this._mediaSub("music", t), thumb: t.cover ? thumbUrl(t.cover) : null }));
    this.overlay = this.listPicker;
    this.listPicker.open({ title: `${name}: add songs`, items, multi: true, grid: true, submit: "Add Selected" }, (chosen) => {
      this.listPicker.close(); this.overlay = null;
      if (chosen && chosen.length) { pl.tracks = [...pl.tracks, ...chosen]; this._persistUser(); }
      this._rebuildAndStay();
    }, () => { this.listPicker.close(); this.overlay = null; });
  },

  // Remove songs from a playlist: multi-select of its current tracks; the
  // checked ones are removed.
  async _editPlaylistRemove(name) {
    const pl = (this.user.playlists || []).find((p) => p.name === name); if (!pl) return;
    const tracks = await call("list_media", { kind: "music" });
    const byPath = Object.fromEntries(tracks.map((t) => [t.path, t]));
    const items = pl.tracks.map((path) => ({ label: (byPath[path]?.title) || (byPath[path]?.name) || path.split(/[\\/]/).pop(), id: path, sub: byPath[path] ? this._mediaSub("music", byPath[path]) : "", thumb: byPath[path]?.cover ? thumbUrl(byPath[path].cover) : null }));
    if (!items.length) return;
    this.overlay = this.listPicker;
    this.listPicker.open({ title: `${name}: remove songs`, items, multi: true, grid: true, submit: "Remove Selected" }, (chosen) => {
      this.listPicker.close(); this.overlay = null;
      if (chosen && chosen.length) { const rm = new Set(chosen); pl.tracks = pl.tracks.filter((p) => !rm.has(p)); this._persistUser(); }
      this._rebuildAndStay();
    }, () => { this.listPicker.close(); this.overlay = null; });
  },

  // Create an image playlist: name it, then multi-select photos.
  async _createPhotoPlaylist() {
    const photos = await call("list_media", { kind: "photo" });
    if (!photos.length) { this.audio.play("error", 0.5); return; }
    this.overlay = this.textForm;
    this.textForm.open({ title: "Create Playlist", prompt: "Enter a name for the playlist.", fields: [{ key: "name", label: "Playlist Name", value: "Playlist", required: true }], submit: "Next" },
      ({ name }) => {
        this.textForm.close();
        const items = photos.map((p) => ({ label: noExt(p.title || p.name), id: p.path, sub: this._mediaSub("photo", p), thumb: thumbUrl(p.path) }));
        this.overlay = this.listPicker;
        this.listPicker.open({ title: `${name}: pick photos`, items, multi: true, grid: true, submit: "Save Playlist" }, (chosen) => {
          this.listPicker.close(); this.overlay = null;
          if (chosen.length) {
            (this.user.photoPlaylists ||= []).push({ name, photos: chosen });
            this._persistUser();
          }
          this._rebuildAndStay();
        }, () => { this.listPicker.close(); this.overlay = null; });
      }, () => { this.textForm.close(); this.overlay = null; });
  },

  // Open a photo playlist as an auto-advancing slideshow.
  async _playPhotoSlideshow(name) {
    const pl = (this.user?.photoPlaylists || []).find((p) => p.name === name);
    if (!pl || !pl.photos?.length) { this.audio.play("error", 0.5); return; }
    const media = await call("list_media", { kind: "photo" });
    const byPath = Object.fromEntries(media.map((m) => [m.path, m]));
    const items = pl.photos.map((path) => byPath[path]).filter(Boolean);
    if (!items.length) { this.audio.play("error", 0.5); return; }
    this.audio.play("enter", 0.5);
    this.overlay = this.photoViewer;
    this.photoViewer.open(items, 0, (mm) => assetUrl(mm.path), () => { this.overlay = null; this._afterPhotoViewer(); }, this._pvOpts({ slideshow: true }));
  },

  // Rebuild columns (e.g. after a playlist changes) without losing the spot.
  async _rebuildAndStay() {
    const catId = this.columns[this.selCat]?.id;
    const lvl0 = this.levels[0], depth = this.levels.length, top = this.levels[this.levels.length - 1], ov = this.overlay;
    const sel0 = top && top.sel;
    const run = this._rebuildRun = (this._rebuildRun || 0) + 1;
    // (only this column: the others haven't changed)
    if (!await this._replaceColumn(catId)) await this._buildColumns();
    if (run !== this._rebuildRun) return;            // a newer rebuild took over
    const ci = this.columns.findIndex((c) => c.id === catId);
    // moved on meanwhile (another column, a submenu, a menu over it): the
    // column is up to date for when they come back, and nothing jumps
    const cur = this.levels[this.levels.length - 1];
    if (ci < 0 || this.columns[this.selCat]?.id !== catId || this.levels.length !== depth || this.levels[0] !== lvl0
        || cur !== top || (cur && cur.sel !== sel0) || this.overlay !== ov) {
      if (ci >= 0 && this.selCat === ci && this.levels.length === 1 && !this.overlay) { this.levels[0].items = this.columns[ci].items; this._render(); this._onSelect(); }
      return;
    }
    this.selCat = ci;
    // the Game section stays on its first game / folder after a regroup
    const first = catId === "game" ? Math.min(this._gameFixedCount || 0, this.columns[this.selCat].items.length - 1) : 0;
    this.levels = [{ items: this.columns[this.selCat].items, sel: first }];
    this._render(this.root.clientWidth, this.root.clientHeight); this._onSelect();
  },
  async _applyBgMusic(force = false) {
    const bm = this.user?.bgMusic;
    // Guard: _onSelect calls this on every cursor move, so don't restart (and
    // reshuffle) the same source repeatedly: only re-apply when it changed.
    const key = JSON.stringify(bm ?? null) + "|" + (this.user?.musicEnabled !== false);
    if (!force && key === this._bgKey) return;
    this._bgKey = key;
    if (!bm || this.user?.musicEnabled === false) { this.audio.stopMusic(); return; }
    // bgMusic is either a legacy path string, or { mode, path?, name? }
    const mode = typeof bm === "string" ? "song" : bm.mode;
    // resolve a track to its playable URL: preloaded/decoded WAV if we have one
    // (so unsupported formats play in the background too), else the raw file.
    const play = (p) => assetUrl((this._decoded && this._decoded[p]) || p);
    if (mode === "song") { const p = typeof bm === "string" ? bm : bm.path; this.audio.setMusic(play(p), 0.4); return; }
    const media = await call("list_media", { kind: "music" });
    const known = new Set(media.map((m) => m.path));
    let paths = [];
    let shuffle = true;
    if (mode === "shuffleAll") paths = media.map((m) => m.path);
    else if (mode === "shufflePlaylist") {
      const pl = (this.user.playlists || []).find((p) => p.name === bm.name);
      paths = (pl ? pl.tracks : []).filter((p) => known.has(p));
    } else if (mode === "album") {
      // play the album in track order (by disc/track), not shuffled
      const inAlbum = media.filter((m) => (m.album || "").trim() === bm.name);
      inAlbum.sort((a, b) => ((a.disc || 0) - (b.disc || 0)) || ((a.track || 0) - (b.track || 0)));
      paths = inAlbum.map((m) => m.path);
      shuffle = false;
    } else if (mode === "albumShuffle") {
      // all of the album's songs, shuffled
      paths = media.filter((m) => (m.album || "").trim() === bm.name).map((m) => m.path);
      shuffle = true;
    } else if (mode === "artistShuffle") {
      // all of the artist's songs, shuffled
      paths = media.filter((m) => (m.artist || "").trim() === bm.name).map((m) => m.path);
      shuffle = true;
    } else if (mode === "artistOrder") {
      // the artist's albums in release order (oldest to newest by year), each
      // album played in track order
      const inArtist = media.filter((m) => (m.artist || "").trim() === bm.name);
      const byAlbum = new Map();
      for (const m of inArtist) {
        const al = (m.album || "").trim() || "Unknown";
        if (!byAlbum.has(al)) byAlbum.set(al, []);
        byAlbum.get(al).push(m);
      }
      const albumYear = (arr) => {
        let y = Infinity;
        for (const m of arr) { const yy = parseInt(m.year || "", 10); if (!isNaN(yy)) y = Math.min(y, yy); }
        return y;
      };
      const ordered = [...byAlbum.entries()].sort((a, b) => {
        const ya = albumYear(a[1]), yb = albumYear(b[1]);
        if (ya !== yb) return ya - yb;
        return cmpText(a[0], b[0]);
      });
      paths = [];
      for (const [, arr] of ordered) {
        arr.sort((a, b) => ((a.disc || 0) - (b.disc || 0)) || ((a.track || 0) - (b.track || 0)));
        for (const m of arr) paths.push(m.path);
      }
      shuffle = false;
    }
    this.audio.setBgQueue(paths.map(play), { shuffle, volume: 0.4 });
  },

  // ------------------------------------------------------------- media view
  _openMusicPlayer() {
    const lvl = this._level();
    const tracks = lvl.items.filter((it) => it.kind === "music").map((it) => it.media);
    const start = lvl.items.slice(0, lvl.sel).filter((it) => it.kind === "music").length;
    this.overlay = this.musicPlayer;
    this.musicPlayer.open(tracks, start, (m) => assetUrl(m.path), () => { this.overlay = null; this._refreshMusicAfterDelete(); },
      { onAddToPlaylist: (track) => this._addTrackToPlaylist(track),
        onDeleted: (t) => { (this._musDeleted ||= new Set()).add(t.path); },
        decodedFor: (t) => (t && this._decoded && this._decoded[t.path]) || null });
  },

  // "Add to Playlist" from inside the music player: pick an existing playlist
  // (or create a new one) and add the current track to it. The player stays
  // open underneath and audio keeps playing.
  _addTrackToPlaylist(track) {
    if (!track || !track.path) return;
    const path = track.path;
    const pls = () => (this.user.playlists ||= []);
    const backToPlayer = () => { this.overlay = this.musicPlayer; document.body.classList.add("menu-open"); };
    this.overlay = this.playlistPicker;
    this.playlistPicker.open({ thumb: track.cover ? assetUrl(track.cover) : null, thumbTint: track.cover ? null : sysUrl("icon_music_default.png"),
      name: track.title || String(track.name || "").replace(/\.[^.]+$/, ""), date: [track.artist, track.album].filter(Boolean).join(" / "),
      playlists: pls().map((p) => ({ name: p.name, count: (p.tracks || []).length })), noun: ["Track", "Tracks"],
      folderIcon: "./assets/icons/theme/icon_playlist.png" }, (ch) => {
      this.playlistPicker.close();
      if (ch === "new") {
        this._askPlaylistName("Playlist", (name) => { pls().push({ name, tracks: [path] }); this._persistUser(); backToPlayer(); }, backToPlayer);
        return;
      }
      const pl = pls()[ch];
      if (pl && !(pl.tracks ||= []).includes(path)) { pl.tracks.push(path); this._persistUser(); }
      backToPlayer();
    }, () => { this.playlistPicker.close(); backToPlayer(); });
  },

  async _openViewer(kind, m) {
    const lvl = this._level();
    const items = lvl.items.filter((it) => it.kind === kind).map((it) => it.media);
    const start = lvl.items.slice(0, lvl.sel).filter((it) => it.kind === kind).length;
    const viewer = kind === "photo" ? this.photoViewer : this.videoViewer;
    this.overlay = viewer;
    if (kind === "video") {
      let subs = [];
      try { subs = await call("list_media", { kind: "subtitle" }) || []; } catch (e) {}
      viewer.open(items, start, (mm) => assetUrl(mm.path), () => { this.overlay = null; this._refreshVideos(); }, {
        subs, subResolve: (p) => assetUrl(p),
        onDeleted: (it) => { (this._vidDeleted ||= new Set()).add(it.path); },
        onIconChanged: (it, cover, clip) => { (this._vidIcons ||= new Map()).set(it.path, { cover, clip }); },
      });
      return;
    }
    viewer.open(items, start, (mm) => assetUrl(mm.path), () => { this.overlay = null; this._afterPhotoViewer(); }, this._pvOpts());
  },
  // ---- Photo Viewer hooks -------------------------------------------------
  _pvOpts(extra = {}) {
    return {
      fmtDate: (d) => this._fmtDateTime(d),
      onDeleted: () => { this._pvChanged = true; },
      // a rotated picture is written when the viewer closes (after onClose):
      // show the new file everywhere, refreshing again if the viewer is gone
      onSaved: (path, rewritten) => {
        if (rewritten) bumpAsset(path);
        this._pvChanged = true;
        if (this.overlay !== this.photoViewer) { clearTimeout(this._pvRefT); this._pvRefT = setTimeout(() => this._afterPhotoViewer(), 60); }
      },
      onWallpaper: (path) => {
        if (!this.user) return;
        this.user.theme.wallpaper = path; this._persistUser(); this._applyWallpaper();
      },
      onAddToPlaylist: (item, thumb) => this._addPhotoToPlaylist(item, thumb),
      ...extra,
    };
  },
  async _afterPhotoViewer() {
    if (!this._pvChanged) return;
    this._pvChanged = false;
    await this._refreshMediaColumns();
    if (this.columns[this.selCat] && this.columns[this.selCat].id === "photo") this._rebuildAndStay();
  },
  // Add to Playlist (Photo Viewer): pick a photo playlist or make a new one;
  // the viewer stays open underneath
  _addPhotoToPlaylist(item, thumb) {
    const path = item.path;
    const back = () => { this.overlay = this.photoViewer; document.body.classList.add("menu-open"); };
    const pls = () => (this.user.photoPlaylists ||= []);
    const d = item.modified ? new Date(item.modified * 1000) : null;
    this.overlay = this.playlistPicker;
    this.playlistPicker.open({ thumb, name: noExt(item.title || item.name || ""), date: d ? this._fmtDateTime(d) : "",
      playlists: pls().map((p) => ({ name: p.name, count: (p.photos || []).length })), noun: ["Image", "Images"],
      folderIcon: "./assets/icons/theme/icon_playlist.png" }, (ch) => {
      this.playlistPicker.close();
      if (ch === "new") {
        this._askPlaylistName(`Playlist`, (name) => { pls().push({ name, photos: [path] }); this._persistUser(); this._pvChanged = true; back(); }, back);
        return;
      }
      const pl = pls()[ch];
      if (pl && !(pl.photos ||= []).includes(path)) { pl.photos.push(path); this._persistUser(); this._pvChanged = true; }
      back();
    }, () => { this.playlistPicker.close(); back(); });
  },
  // "Enter a name for the playlist." (a name that's taken gets a number)
  _askPlaylistName(def, done, cancel) {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Create Playlist", prompt: "Enter a name for the playlist.", fields: [{ key: "name", label: "Playlist Name", value: def, required: true }], submit: "OK" },
      (out) => { this.textForm.close(); done(String(out.name || "").trim() || def); },
      () => { this.textForm.close(); cancel && cancel(); });
  },

  // Square, at the top level of Music / Photo / Video, cycles the sort mode
  // (All / By Album / …) and rebuilds that section in place.
  _cycleMediaMode() {
    if (this._secCycleMode()) return;                   // inside a custom section's subsection
    if (this.levels.length > 1) return;                 // only at the section root
    const id = this.columns[this.selCat] && this.columns[this.selCat].id;
    if (!MEDIA_MODES[id]) return;
    const modes = MEDIA_MODES[id];
    const cur = Math.max(0, modes.findIndex((m) => m.id === this._mediaMode(id)));
    this.mediaMode[id] = modes[(cur + 1) % modes.length].id;
    // persist the chosen media ordering so it survives a restart
    if (this.user) { this.user.mediaMode = this.mediaMode; this._persistUser(); }
    this.audio.play("enter", 0.4);
    return Promise.resolve(this._rebuildAndStay()).then(() => this._updateMediaSort(true));
  },
};
