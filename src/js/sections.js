// Custom sections (Settings > System Settings > Sections).
//
// A section is a new category of its own (its icon is a picture from the
// Photos folder) placed anywhere between the others. It holds subsections,
// each with a title, a description, an icon and the folders its items come
// from (by default content\<Section>\<Subsection>). Every item has a folder
// of its own, like a game: a game folder, or a folder with one video, song or
// picture (its item.json is made when it's first found; icon, preview (gif
// or video), background and music files in it work like a game's). A folder
// holding item folders is shown as a folder of the section's folder type
// (Music, Photo, Video or Game, chosen once for the whole section) with the
// folder-count name chosen for it. Only the first layer of subsections holds
// files; inside them go more subsections (titles, descriptions and icons
// only, like the Settings menus), up to 50 layers deep. Square changes the
// order of a subsection's files: the orders of the section's folder type, as
// in that media section (Music, Photo, Video or Game).
//
// These methods are added to the Xmb class (see the end of xmb.js).

import { call, assetUrl, noExt, cmpNatural } from "./api.js";
const folderName = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || String(p || "");
// "Tools" → "Tools'", "Hades" → "Hades'", "Portal" → "Portal's"
const poss = (name) => { const n = String(name || "").trim(); return /s$/i.test(n) ? `${n}'` : `${n}'s`; };

const FOLDER_TYPES = [["music", "Music"], ["photo", "Photo"], ["video", "Video"], ["game", "Game"]];
// folder-count names (the system's own ones; any other can be typed)
const NOUNS = [["Track", "Tracks"], ["Image", "Images"], ["Title", "Titles"]];
const TYPE_NOUN = { music: NOUNS[0], photo: NOUNS[1], video: NOUNS[2], game: NOUNS[2] };
const MAX_LAYERS = 50;
const SI = { sys: "icon_setting_item.png" };
const byTitle = (a, b) => cmpNatural(String(a.title || ""), String(b.title || ""));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Square orders inside a subsection (every order there is; a section offers
// the ones of its folder type, below)
export const SECTION_MODES = [
  { id: "all", label: "All" },
  { id: "album", label: "By Album" },
  { id: "title", label: "By Title" },
  { id: "artist", label: "By Artist" },
  { id: "genre", label: "By Genre" },
  { id: "track", label: "By Track" },
  { id: "ryear", label: "By Release Year" },
  { id: "year", label: "By Year" },
  { id: "month", label: "By Month" },
  { id: "format", label: "By Format" },
];
// each folder type's orders, as in its own media section (Music's "By Release
// Year" is the songs' year tag, Photo's "By Year" the files' date)
const TYPE_MODES = {
  music: ["all", "album", "artist", "genre", "track", "title", "ryear"],
  photo: ["all", "month", "year", "album"],
  video: ["all", "title", "month", "album"],
  game: ["all", "format", "album"],
};
const KIND_NAME = { music: "Music", photo: "Photo", video: "Video" };

export const SectionMethods = {
  // each user has their own sections (older ones, kept for everyone in the
  // settings, are copied to a user the first time they sign in)
  _sections() {
    if (!this.user) return [];
    if (!Array.isArray(this.user.sections)) {
      this.user.sections = JSON.parse(JSON.stringify((this.settings && this.settings.sections) || []));
      if (this.user.sections.length) this._persistUser();
    }
    return this.user.sections;
  },
  _sectionById(id) { return this._sections().find((s) => s.id === id); },

  // ------------------------------------------------------------ columns
  async _withSections(base) {
    const secs = this._sections();
    if (!secs.length) return base;
    const cols = [...base];
    const built = await Promise.all(secs.map((s) => this._sectionColumn(s)));
    let pending = secs.map((s, i) => ({ s, col: built[i] }));
    // each section goes right after the column it was placed after ("^" = first of all)
    for (let guard = 0; pending.length && guard < 30; guard++) {
      pending = pending.filter(({ s, col }) => {
        if (s.after === "^") { cols.splice(0, 0, col); return false; }
        if (!s.after) { cols.splice(1, 0, col); return false; }
        const k = cols.findIndex((c) => c.id === s.after);
        if (k < 0) return true;
        cols.splice(k + 1, 0, col); return false;
      });
    }
    for (const { col } of pending) cols.push(col);
    return cols;
  },
  // the section's folder type and folder-count name (chosen once for it;
  // older sections kept them on their first subsection)
  _secType(sec) { return sec.type || (sec.subs || []).map((x) => x.type).find(Boolean) || "game"; },
  _secNoun(sec) {
    const n = sec.noun || (sec.subs || []).map((x) => x.noun).find((x) => x && x.length === 2);
    return n && n.length === 2 ? n : TYPE_NOUN[this._secType(sec)];
  },
  // the Square orders this section has (those of its folder type), and the one
  // in use (an order its type doesn't have, chosen before, counts as By Album)
  _secModes(sec) { const ids = TYPE_MODES[this._secType(sec)] || TYPE_MODES.music; return ids.map((id) => SECTION_MODES.find((m) => m.id === id)); },
  _secMode(sec) {
    const m = this.mediaMode && this.mediaMode[`sec:${sec.id}`];
    return m && this._secModes(sec).some((x) => x.id === m) ? m : "album";
  },
  // The section's folder(s): content\<Section> (made when the section is made)
  // plus any added. Its items show in the section, under the subsections.
  async _secFolders(sec) {
    if (!Array.isArray(sec.folders) || !sec.folders.length) {
      try { sec.folders = [await call("section_folder", { section: sec.name, sub: null })]; this._persistUser(); } catch (e) { sec.folders = []; }
    }
    return sec.folders;
  },
  // A section's (or subsection's) picture as an icon, with the section's Icon
  // Effects (Icon Effects in its edit menu, all On unless turned off): Icon
  // Style (the shading / gloss), Icon Color (only for pictures with a
  // see-through background: any other one would become a solid square) and
  // Transparency (the see-through look of the app's icons).
  _secFx(sec) { return Object.assign({ style: true, color: true, alpha: true }, (sec && sec.fx) || {}); },
  _secIcon(sec, path) {
    const fx = this._secFx(sec);
    const see = this._secAlpha(path);
    const f = (fx.style ? "s" : "") + (fx.color && see ? "c" : "") + (fx.alpha ? "a" : "");
    return `cust:${f}:${assetUrl(path)}`;
  },
  // whether a picture has see-through parts (asked once, then remembered)
  _secAlpha(path) {
    const m = (this._alphaCache ||= new Map());
    if (m.has(path)) return m.get(path);
    m.set(path, false);
    call("image_has_alpha", { path }).then((v) => {
      if (!v) return;
      m.set(path, true);
      // (not while a section is being made or moved: it isn't saved yet, and a
      // refresh would take it off the screen; it's refreshed when that ends)
      const later = () => {
        if (this._secBusy || this._placing || this.overlay) { this._alphaT = setTimeout(later, 400); return; }
        this._secMenusRefresh();
      };
      clearTimeout(this._alphaT); this._alphaT = setTimeout(later, 150);
    }).catch(() => {});
    return false;
  },
  async _sectionColumn(sec) {
    const folders = await this._secFolders(sec);
    // every first-layer subsection has its own folder, content\<Section>\<Subsection>
    // (made now if it isn't there): its files show inside the subsection
    const subDirs = await Promise.all((sec.subs || []).map((n) => (String(n.title || "").trim()
      ? call("section_folder", { section: sec.name, sub: n.title }).catch(() => null) : Promise.resolve(null))));
    // (the subsections' folders first: a file put loose in one goes into a
    // folder of its own there, so the section's own list sees it as theirs)
    const subEntries = await Promise.all(subDirs.map((d) => (d ? call("section_list", { folders: [d] }).catch(() => []) : Promise.resolve([]))));
    let entries = [];
    try { entries = await call("section_list", { folders }); } catch (e) {}
    const subNames = new Set(subDirs.filter(Boolean).map((d) => folderName(d).toLowerCase()));
    entries = (entries || []).filter((e) => !(e.group && subNames.has(String(e.group).toLowerCase())));
    const col = { id: `sec:${sec.id}`, label: sec.name || "Section", section: sec.id, entries, subEntries,
      icon: sec.icon ? this._secIcon(sec, sec.icon) : "icon_setting.png" };
    col.items = this._secRootItems(sec, col.entries, col.subEntries);
    return col;
  },
  // the subsections (with their own files), then the section's other items
  _secRootItems(sec, entries, subEntries = []) {
    const type = this._secType(sec);
    const items = [...(sec.subs || []).map((n, i) => this._subItem(n, type, sec, subEntries[i] || [])), ...this._sectionChildren(sec, entries, this._secMode(sec))];
    return items;   // (empty: nothing shows, as in Friends before signing in)
  },
  // a subsection without an icon of its own: the section's icon (the folder
  // of the section's folder type for a section without one)
  _subIcon(n, type, sec) {
    const pic = n.icon || sec.icon;
    return pic ? { sys: this._secIcon(sec, pic) } : { folder: type || "game", art: null };
  },
  // a first-layer subsection: the subsections inside it, then its folder's
  // files (in the chosen Square order, made again each time it's opened)
  _subItem(n, type, sec, files) {
    const icon = this._subIcon(n, type, sec);
    const nested = (n.children || []).map((c) => this._nestedItem(c, type, sec));
    const base = { title: n.title || "Subsection", sub: n.desc || "", icon };
    if (!nested.length && !files.length) return { kind: "ph", ...base };
    return { kind: "drill", ...base, secSub: true,
      childrenFn: () => [...(n.children || []).map((c) => this._nestedItem(c, type, sec)), ...this._sectionChildren(sec, files, this._secMode(sec))] };
  },
  // a subsection inside a subsection: only a title, a description and an icon
  // (and maybe more of them inside), like the Settings menus
  _nestedItem(n, type, sec) {
    const icon = this._subIcon(n, type, sec);
    const kids = (n.children || []).map((c) => this._nestedItem(c, type, sec));
    return kids.length ? { kind: "drill", title: n.title || "Subsection", sub: n.desc || "", icon, children: kids }
      : { kind: "ph", title: n.title || "Subsection", sub: n.desc || "", icon };
  },
  // one recognised item (its own folder) as an XMB row, with its folder's
  // icon / preview / background / music
  _sectionItem(e, loose) {
    const m = e.meta || {};
    let o;
    if (e.kind === "game") {
      const g = { ...e.game, background: m.background || e.game.background, music: m.music || e.game.music };
      o = this._gameEntry(g);
      if (!g.created) o.sub = "";
    } else o = this._mediaItemObj(e.kind, e.media);
    if (m.title) o.title = e.kind === "music" ? m.title : noExt(m.title);
    if (m.icon) o.icon = { ...o.icon, art: assetUrl(m.icon), sys: undefined, clip: null };   // the folder's icon replaces the thumbnail
    if (m.gif) o.icon = { ...o.icon, preview: assetUrl(m.gif) };
    // (an item folder's preview / background / music play while it's selected, like a game's)
    if (e.kind !== "game" && (m.gif || m.background || m.music)) o.extra = { background: m.background || null, music: m.music || null };
    if (e.kind === "game" && !o.icon.art && loose) o.icon = { ...o.icon, art: "./assets/icons/system/default_game.png", noIcon: true };
    // programs and scripts in a section that isn't a Game section start like
    // apps: the sound stays on and the screen doesn't go black
    if (e.kind === "game" && this._secTypeNow && this._secTypeNow !== "game") o.appMode = true;
    // (programs in a section keep their titles shown, like the section's other items)
    if (e.kind === "game") o.secItem = true;
    return o;
  },
  // a subsection's files in the chosen Square order
  _sectionChildren(sec, entries, mode) {
    const type = this._secType(sec), noun = this._secNoun(sec);
    this._secTypeNow = type;
    const folder = (name, kids) => {
      const n = kids.length, first = kids[0];
      const art = first && first.icon && !first.icon.noIcon && first.icon.art ? first.icon.art : null;
      return { kind: "drill", title: name, sub: `${n} ${n === 1 ? noun[0] : noun[1]}`, icon: { folder: type, art }, children: kids };
    };
    const byName = (a, b) => cmpNatural(a[0], b[0]);
    if (mode === "all") return entries.map((e) => this._sectionItem(e, true)).sort(byTitle);
    if (mode === "track") return entries.map((e) => this._sectionItem(e, true)).sort((a, b) =>
      ((a.media && a.media.track) || 0) - ((b.media && b.media.track) || 0) || byTitle(a, b));
    if (mode === "album" || !mode) {      // the folders the items are in (loose ones stay loose)
      const loose = entries.filter((e) => !e.group).map((e) => this._sectionItem(e, true)).sort(byTitle);
      const groups = new Map();
      for (const e of entries) if (e.group) { if (!groups.has(e.group)) groups.set(e.group, []); groups.get(e.group).push(e); }
      const folders = [...groups.entries()].sort(byName).map(([name, arr]) => folder(name, arr.map((e) => this._sectionItem(e, false)).sort(byTitle)));
      return [...folders, ...loose];
    }
    const when = (e) => {
      if (e.media && e.media.modified) return new Date(e.media.modified * 1000);
      const c = e.game && e.game.created; const d = c ? new Date(String(c).replace(" ", "T")) : null;
      return d && !isNaN(d) ? d : null;
    };
    const key = (e, it) => {
      const m = e.media || {};
      switch (mode) {
        case "title": { const t = String(it.title || "").trim(); return t ? [...t][0].toLocaleUpperCase() : "#"; }
        case "artist": return m.artist || "Unknown";
        case "genre": return m.genre || "Unknown";
        case "ryear": return m.year || "Unknown";
        case "year": { const d = when(e); return d ? String(d.getFullYear()) : "Unknown"; }
        case "month": { const d = when(e); return d ? d.toLocaleString("en-US", { month: "long", year: "numeric" }) : "Unknown"; }
        case "format": return e.kind === "game" ? this._formatName(e.game && e.game.console) : (KIND_NAME[e.kind] || "Unknown");
        default: return "Unknown";
      }
    };
    const groups = new Map();
    for (const e of entries) { const it = this._sectionItem(e, false), k = key(e, it); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    return [...groups.entries()].sort(byName).map(([name, kids]) => folder(name, kids.sort(byTitle)));
  },
  // Square at the top of a section (where its items are): the next order
  _secSortContext() {
    const col = this.columns && this.columns[this.selCat];
    if (!col || !col.section || !this.levels) return null;
    const sec = this._sectionById(col.section);
    if (!sec) return null;
    if (this.levels.length === 1) return { col, sec };
    // inside a first-layer subsection (its files)
    const top = this.levels[0], it = top.items[top.sel];
    if (this.levels.length === 2 && it && it.secSub && this.levels[1].rebuild) return { col, sec, sub: this.levels[1] };
    return null;
  },
  _secCycleMode() {
    const c = this._secSortContext(); if (!c) return false;
    const modes = this._secModes(c.sec);
    const cur = Math.max(0, modes.findIndex((m) => m.id === this._secMode(c.sec)));
    (this.mediaMode ||= {})[`sec:${c.sec.id}`] = modes[(cur + 1) % modes.length].id;
    if (this.user) { this.user.mediaMode = this.mediaMode; this._persistUser(); }
    this.audio.play("enter", 0.4);
    c.col.items = this._secRootItems(c.sec, c.col.entries, c.col.subEntries);
    if (c.sub) {
      c.sub.items = c.sub.rebuild(); c.sub.sel = Math.max(0, Math.min(c.sub.sel, c.sub.items.length - 1));
      c.sub.grid = c.sub.items.length > 0 && c.sub.items.every((x) => x.kind === "photo");
    }
    else { this.levels[0].items = c.col.items; this.levels[0].sel = Math.min(this.levels[0].sel, c.col.items.length - 1); }
    this._render(); this._onSelect(); this._updateMediaSort(true);
    return true;
  },
  // (one at a time: two refreshes running together, such as the one after a
  // new section and the one after its icon is checked, each put its own
  // columns in place, and the menu ended up drawn from a mix of the two:
  // icons missing, the wrong category chosen)
  _refreshSections(selectId) {
    const run = (this._secRefreshQ || Promise.resolve()).then(() => this._refreshSectionsNow(selectId));
    this._secRefreshQ = run.catch(() => {});
    return run;
  },
  async _refreshSectionsNow(selectId) {
    if (this.locked || !this.columns) return;
    const curId = selectId || (this.columns[this.selCat] && this.columns[this.selCat].id);
    const base = this.columns.filter((c) => !c.section);
    this.columns = await this._withSections(base);
    const i = this.columns.findIndex((c) => c.id === curId);
    if (selectId && i >= 0) { this.selCat = i; this.levels = [{ items: this.columns[i].items, sel: 0 }]; }
    else {
      this.selCat = Math.max(0, i);
      if (this.columns[this.selCat].section && this.levels.length === 1) this.levels[0].items = this.columns[this.selCat].items;
    }
    this._render(); this._onSelect();
  },

  // ---------------------------------------------------- promise helpers
  _askText(title, fields, submit = "Next") {
    return new Promise((res) => {
      this.overlay = this.textForm;
      this.textForm.open({ title, fields, submit },
        (out) => { this.textForm.close(); this.overlay = null; res(out); },
        () => { this.textForm.close(); this.overlay = null; res(null); });
    });
  },
  _askList(title, items, submit = "Select") {
    return new Promise((res) => {
      this.overlay = this.listPicker;
      this.listPicker.open({ title, items, submit },
        (ch) => { this.listPicker.close(); this.overlay = null; res(ch); },
        () => { this.listPicker.close(); this.overlay = null; res(null); });
    });
  },
  async _askPhoto(title, current) {
    let photos = [];
    try { photos = await call("list_media", { kind: "photo" }); } catch (e) {}
    if (!photos.length) { this.audio.play("error", 0.5); return null; }
    return new Promise((res) => {
      this.overlay = this.avatarPicker;
      this.avatarPicker.openImages(photos.map((p) => p.path), current || null,
        (path) => { this.avatarPicker.close(); this.overlay = null; res(path); },
        () => { this.avatarPicker.close(); this.overlay = null; res(null); }, title);
    });
  },
  _askConfirm(text) {
    return new Promise((res) => {
      this.overlay = this.confirm;
      this.confirm.open(text, [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
        (c) => { this.confirm.close(); this.overlay = null; res(!!c && c.id === "yes"); },
        () => { this.confirm.close(); this.overlay = null; res(false); });
    });
  },
  async _askFolder(title) {
    try { return await call("pick_folder", { title }); } catch (e) { return null; }
  },

  // ------------------------------------------------------ create a section
  // Every step can go back (Circle / Cancel) to the one before; going back
  // from the first step leaves.
  async _runSteps(steps) {
    let i = 0;
    while (i < steps.length) {
      const ok = await steps[i]();
      if (ok) i++; else { if (i === 0) return false; i--; }
    }
    return true;
  },
  async _sectionCreate() {
    this._secBusy = true;
    try { return await this._sectionCreateSteps(); } finally { this._secBusy = false; }
  },
  async _sectionCreateSteps() {
    const sec = { id: uid(), name: "", icon: null, after: null, type: null, noun: null, subs: [] };
    const st = { n: 0 };   // (0 to begin with: a section of files only)
    const ok = await this._runSteps([
      async () => { const p = await this._askPhoto("Choose the Section's Icon", sec.icon); if (!p) return false; sec.icon = p; return true; },
      () => new Promise((res) => this._sectionPlace(sec, true, (placed) => res(!!placed))),
      async () => {
        const out = await this._askText("Section Name", [{ key: "name", label: "Name", value: sec.name, required: true }]);
        if (!out || !String(out.name || "").trim()) return false;
        sec.name = String(out.name).trim(); return true;
      },
      async () => {
        const t = await this._askList(`${sec.name}: Folder Type`, FOLDER_TYPES.map(([id, label]) => ({ label, id,
          sub: `The section's folders look like the ${label} section's folders.` })), "Next");
        if (!t) return false;
        if (sec.type !== t.id) sec.noun = null;
        sec.type = t.id; return true;
      },
      async () => { const nn = await this._askNoun(sec.name, TYPE_NOUN[sec.type]); if (!nn) return false; sec.noun = nn; return true; },
      async () => {
        for (;;) {
          const out = await this._askText("How many subsections?", [{ key: "n", label: "Number of Subsections", value: String(st.n || 0), type: "number", required: true }]);
          if (!out) return false;
          const n = parseInt(String(out.n || "").replace(/[^0-9]/g, ""), 10);
          if (Number.isFinite(n) && n >= 0) { st.n = n; sec.subs = sec.subs.slice(0, n); return true; }   // (0: no subsections, only the files)
          this.audio.play("error", 0.4);
        }
      },
      async () => {          // each subsection in turn (Back goes to the one before)
        let i = 0;
        while (i < st.n) {
          const r = await this._subsectionSetup(sec, i + 1, st.n, sec.subs[i]);
          if (!r) { if (i === 0) return false; i--; continue; }
          sec.subs[i] = r; i++;
        }
        return true;
      },
    ]);
    if (!ok) { this._sectionAbort(sec); return; }
    try { sec.folders = [await call("section_folder", { section: sec.name, sub: null })]; } catch (e) { sec.folders = []; }
    this._sections().push(sec);
    this._persistUser();
    this.audio.play("enter", 0.6);
    await this._refreshSections(`sec:${sec.id}`);
    // (drawn once more from scratch a moment later, once every menu of the
    // steps has closed, so nothing is left half-drawn)
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!this.overlay && !this._placing) { this._render(); this._onSelect(); } }));
  },
  _sectionAbort(sec) {
    // the half-made section's column goes away again
    const had = this.columns.some((c) => c.id === `sec:${sec.id}`);
    this.columns = this.columns.filter((c) => c.id !== `sec:${sec.id}`);
    this.selCat = Math.max(0, Math.min(this.selCat, this.columns.length - 1));
    if (had) this.levels = [{ items: this.columns[this.selCat].items, sel: 0 }];
    this.audio.play("back", 0.5); this._render(); this._onSelect();
  },
  // an icon: a picture from Photos, or none (Circle = back)
  async _askIcon(title, current) {
    for (;;) {
      const ch = await this._askList(`${title}: Icon`, [
        { label: "Choose an Icon\u2026", id: "pick", sub: "A picture from your Photos folder." },
        { label: "No Icon", id: "none", sub: "The same icon as the section's." }], "Next");
      if (!ch) return undefined;                       // back
      if (ch.id === "none") return null;
      const p = await this._askPhoto(`${title}: Choose an Icon`, current);
      if (p) return p;
    }
  },
  // one first-layer subsection: Title + Description, Icon and the subsections
  // inside it (only for show: no folders). Returns null to go back.
  async _subsectionSetup(sec, k, n, prev) {
    const tag = n > 1 ? ` (${k} of ${n})` : "";
    const sub = { title: prev?.title || "", desc: prev?.desc || "", icon: prev?.icon || null, children: prev?.children || [] };
    const ok = await this._runSteps([
      async () => {
        const out = await this._askText(`Subsection${tag}`, [
          { key: "title", label: "Title", value: sub.title, required: true },
          { key: "desc", label: "Description", value: sub.desc }]);
        if (!out || !String(out.title || "").trim()) return false;
        sub.title = String(out.title).trim(); sub.desc = String(out.desc || "").trim(); return true;
      },
      async () => { const ic = await this._askIcon(sub.title, sub.icon); if (ic === undefined) return false; sub.icon = ic; return true; },
      async () => { const kids = await this._askNested(sub.title, 2, sub.children); if (!kids) return false; sub.children = kids; return true; },
    ]);
    return ok ? sub : null;
  },
  // the folder-count name: one of the system's or a new one typed in
  async _askNoun(title, def) {
    for (;;) {
      const ch = await this._askList(`${title}: Folder Count Name`, [
        ...NOUNS.map((nn) => ({ label: nn[1], id: nn[1], sub: `"2 ${nn[1]}" under each folder.${nn === def ? " (Default)" : ""}` })),
        { label: "Custom Name\u2026", id: "__new__" }], "Next");
      if (!ch) return null;
      if (ch.id !== "__new__") return NOUNS.find((nn) => nn[1] === ch.id);
      const out = await this._askText(`${title}: Folder Count Name`, [
        { key: "one", label: "For one (e.g. Episode)", value: "", required: true },
        { key: "many", label: "For more (e.g. Episodes)", value: "", required: true }], "Confirm");
      const one = String(out?.one || "").trim(), many = String(out?.many || "").trim();
      if (one && many) return [one, many];
    }
  },
  // subsections inside a subsection (layer = their depth; 50 at most).
  // Returns the list, or null to go back.
  async _askNested(parentTitle, layer, start) {
    const kids = [...(start || [])];
    if (layer > MAX_LAYERS) return kids;
    for (;;) {
      const ch = await this._askList(`${parentTitle}: Subsections Inside`, [
        { label: "Done", id: "done", sub: kids.map((k) => k.title).join(", ") || "None." },
        { label: "Add a Subsection Inside\u2026", id: "add", sub: "Only a title, a description and an icon (like the Settings menus)." }], "Select");
      if (!ch) return null;
      if (ch.id === "done") return kids;
      const n = await this._nestedSetup(layer);
      if (n) kids.push(n);
    }
  },
  async _nestedSetup(layer) {
    const node = { title: "", desc: "", icon: null, children: [] };
    const ok = await this._runSteps([
      async () => {
        const out = await this._askText(`Subsection (layer ${layer})`, [
          { key: "title", label: "Title", value: node.title, required: true },
          { key: "desc", label: "Description", value: node.desc }]);
        if (!out || !String(out.title || "").trim()) return false;
        node.title = String(out.title).trim(); node.desc = String(out.desc || "").trim(); return true;
      },
      async () => { const ic = await this._askIcon(node.title, node.icon); if (ic === undefined) return false; node.icon = ic; return true; },
      async () => {
        if (layer >= MAX_LAYERS) return true;
        const kids = await this._askNested(node.title, layer + 1, node.children);
        if (!kids) return false; node.children = kids; return true;
      },
    ]);
    return ok ? node : null;
  },

  // ------------------------------------------- placing a section (moving)
  // The section's icon sits among the others; left / right move it (it
  // wobbles away from the way it moves), ✕ places it, ○ cancels.
  _sectionPlace(sec, isNew, done) {
    let col = this.columns.find((c) => c.id === `sec:${sec.id}`);
    const before = this.columns.map((c) => c.id);
    if (col && sec.icon) col.icon = this._secIcon(sec, sec.icon);
    if (!col) {
      col = { id: `sec:${sec.id}`, label: sec.name || "New Section", section: sec.id, icon: this._secIcon(sec, sec.icon), items: [] };
      const si = this.columns.findIndex((c) => c.id === "settings");
      this.columns.splice(Math.max(1, si + 1), 0, col);
    }
    this.levels = [{ items: col.items, sel: 0 }];
    this.selCat = this.columns.indexOf(col);
    this._placing = { sec, col, isNew, done, before };
    this._render(); this._onSelect();
    col._el && col._el.classList.add("placing");
    this._shotFeedback && this._shotFeedback("← → Move   ✕ Place   ○ Cancel");
  },
  _placeInput(a) {
    const P = this._placing, w = this.root.clientWidth, h = this.root.clientHeight;
    const i = this.columns.indexOf(P.col);
    if (a === "left" || a === "right") {
      const dir = a === "left" ? -1 : 1, j = i + dir;
      if (j < 0 || j >= this.columns.length) { this.audio.play("error", 0.3); return; }
      [this.columns[i], this.columns[j]] = [this.columns[j], this.columns[i]];
      this.selCat = j;
      this.audio.play(dir > 0 ? "cursor_down" : "cursor_up", 0.5);
      this._layoutCats(w, h);
      const ic = P.col._el && P.col._el.querySelector(".sysicon");
      // it swings like something hanging from its top: back against the move, then settles
      if (ic) { ic.classList.remove("wob-l", "wob-r"); void ic.offsetWidth; ic.classList.add(dir > 0 ? "wob-r" : "wob-l"); }
      return;
    }
    if (a === "enter") {
      this._placing = null; P.col._el && P.col._el.classList.remove("placing");
      const k = this.columns.indexOf(P.col);
      P.sec.after = k === 0 ? "^" : this.columns[k - 1].id;
      if (!P.isNew) this._persistUser();
      this.audio.play("enter", 0.6);
      P.done(true);
      return;
    }
    if (a === "back") {
      this._placing = null; P.col._el && P.col._el.classList.remove("placing");
      if (P.isNew) { this._sectionAbort(P.sec); P.done(false); return; }     // (back to choosing its icon)
      // put it back where it was
      this.columns.sort((x, y) => P.before.indexOf(x.id) - P.before.indexOf(y.id));
      this.selCat = this.columns.indexOf(P.col);
      this.audio.play("back", 0.5); this._render(); this._onSelect();
      P.done(false);
    }
  },

  // ------------------------------------- System Settings > Sections menus
  _sectionsMenuItems() {
    return [
      { kind: "action", act: "sec_new", title: "Create Section", icon: SI },
      ...this._sections().map((s) => ({ kind: "drill", title: s.name, icon: s.icon ? { sys: this._secIcon(s, s.icon) } : SI,
        sub: `${(s.subs || []).length} Subsection${(s.subs || []).length !== 1 ? "s" : ""}`, childrenFn: () => this._sectionEditItems(s.id) })),
    ];
  },
  _sectionEditItems(id) {
    const s = this._sectionById(id); if (!s) return [];
    return [
      { kind: "action", act: `sec_rename::${id}`, title: "Title", icon: SI },
      { kind: "action", act: `sec_icon::${id}`, title: "Change Icon", icon: SI },
      { kind: "drill", title: "Icon Effects", icon: SI, childrenFn: () => this._secFxItems(id) },
      { kind: "action", act: `sec_move::${id}`, title: "Move Section", icon: SI },
      { kind: "setting", ctl: `secft:${id}`, title: "Folder Type", icon: SI },
      { kind: "action", act: `sec_noun::${id}`, title: "Folder Count Name", icon: SI },
      { kind: "drill", title: "Folders", icon: SI, sub: "Folders from where the system recognizes media files to be saved in this section.",
        childrenFn: () => this._secFolderItems(id) },
      { kind: "action", act: `sec_addsub::${id}`, title: "Add Subsection", icon: SI },
      ...(s.subs || []).map((sub, j) => ({ kind: "drill", title: `Subsection: ${sub.title}`, icon: sub.icon ? { sys: this._secIcon(s, sub.icon) } : SI,
        childrenFn: () => this._nodeEditItems(id, String(j)) })),
      { kind: "action", act: `sec_del::${id}`, title: "Delete Section", icon: SI, sub: "This deletes the current section and the subsections included inside it." },
      { kind: "action", act: `sec_delall::${id}`, title: "Delete Folder", icon: SI,
        sub: "Deletes the section's folder with all the subsection's folders and all their content." },
    ];
  },
  _secFxItems(id) {
    return [
      { kind: "setting", ctl: `secfx:color:${id}`, title: "Icon Color", icon: SI,
        sub: "On: All icons in the section have the color selected on Theme Settings > Icon Color applied." },
      { kind: "setting", ctl: `secfx:style:${id}`, title: "Icon Style", icon: SI,
        sub: "On: All icons in the section have the style selected on Theme Settings > Icon Style applied." },
      { kind: "setting", ctl: `secfx:alpha:${id}`, title: "Transparency", icon: SI },
    ];
  },
  _secfxValue(ctl) {
    const [, key, id] = ctl.split(":");
    const s = this._sectionById(id);
    return s && this._secFx(s)[key] === false ? "Off" : "On";
  },
  _secfxToggle(ctl) {
    const [, key, id] = ctl.split(":");
    const s = this._sectionById(id); if (!s) return;
    s.fx = { ...this._secFx(s), [key]: !this._secFx(s)[key] };
    this.audio.play("cursor_up", 0.4); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    clearTimeout(this._secT); this._secT = setTimeout(() => this._secMenusRefresh(), 300);
  },
  _secFolderItems(id) {
    const s = this._sectionById(id); if (!s) return [];
    const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
    return [
      { kind: "action", act: `sec_fadd::${id}`, title: "Add Folder", icon: SI, sub: "Also read the items in another folder." },
      ...(s.folders || []).map((p, f) => ({ kind: "action", act: `sec_frm::${id}::${f}`, title: base(p), icon: SI,
        sub: `${p}\nPress \u2715 to remove this folder from the section (its files aren't touched).` })),
    ];
  },
  // a (sub)subsection by its path ("2" = the third subsection, "2/0/1" = …)
  _node(id, path) {
    const s = this._sectionById(id); if (!s) return null;
    const ix = String(path).split("/").map(Number);
    let arr = s.subs, node = null;
    for (let d = 0; d < ix.length; d++) {
      node = arr && arr[ix[d]]; if (!node) return null;
      if (d < ix.length - 1) arr = (node.children ||= []);
    }
    return { sec: s, node, arr, index: ix[ix.length - 1], depth: ix.length, top: s.subs[ix[0]] };
  },
  _nodeEditItems(id, path) {
    const r = this._node(id, path); if (!r) return [];
    const { node: n, depth } = r, k = `${id}::${path}`;
    const items = [
      { kind: "action", act: `sub_title::${k}`, title: "Title", icon: SI },
      { kind: "action", act: `sub_desc::${k}`, title: "Description", icon: SI },
      { kind: "action", act: `sub_icon::${k}`, title: "Change Icon", icon: SI },
    ];
    items.push(
      // (straight into the subsections inside this one)
      { kind: "drill", title: "Subsections Inside", icon: SI, childrenFn: () => this._nodeChildItems(id, path) },
      { kind: "action", act: `sub_del::${k}`, title: "Delete Subsection", icon: SI,
        sub: "Warning: This deletes the current subsection and the subsections included inside it." });
    // (subsections made by older versions had a folder of their own)
    if (depth === 1) items.push({ kind: "action", act: `sub_delall::${k}`, title: "Delete Folder", icon: SI,
      sub: "Deletes the subsection's folder and all its content." });
    return items;
  },
  _nodeChildItems(id, path) {
    const r = this._node(id, path); if (!r) return [];
    return [
      { kind: "action", act: `sub_addkid::${id}::${path}`, title: "Add Subsection", icon: SI },
      ...(r.node.children || []).map((c, k) => ({ kind: "drill", title: `Subsection: ${c.title}`,
        icon: c.icon ? { sys: this._secIcon(r.sec, c.icon) } : SI, childrenFn: () => this._nodeEditItems(id, `${path}/${k}`) })),
    ];
  },
  _subFolderItems(id, path) {
    const r = this._node(id, path); if (!r) return [];
    const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
    return [
      { kind: "action", act: `sub_fadd::${id}::${path}`, title: "Add Folder", icon: SI, sub: "Also read the items in another folder." },
      ...(r.node.folders || []).map((p, f) => ({ kind: "action", act: `sub_frm::${id}::${path}::${f}`, title: base(p), icon: SI,
        sub: `${p}\nPress \u2715 to remove this folder (its files aren't touched).` })),
    ];
  },
  _secftValue(ctl) {
    const s = this._sectionById(ctl.slice(6));
    return s ? (FOLDER_TYPES.find((t) => t[0] === this._secType(s)) || FOLDER_TYPES[3])[1] : "";
  },
  // Folder Type option (△) menu
  _secftChoices(ctl) {
    const s = this._sectionById(ctl.slice(6));
    if (!s) return null;
    const now = this._secType(s);
    return { cur: FOLDER_TYPES.findIndex((t) => t[0] === now), items: FOLDER_TYPES.map(([id, label]) => ({ label, apply: () => {
      s.type = id; this.audio.play("cursor_up", 0.4); this._persistUser();
      clearTimeout(this._secT); this._secT = setTimeout(() => this._refreshSections(), 400);
    } })) };
  },
  _secftAdjust(ctl, dir) {
    const s = this._sectionById(ctl.slice(6));
    if (!s) return;
    const i = Math.max(0, FOLDER_TYPES.findIndex((t) => t[0] === this._secType(s)));
    s.type = FOLDER_TYPES[(i + dir + FOLDER_TYPES.length) % FOLDER_TYPES.length][0];
    this.audio.play("cursor_up", 0.4); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    clearTimeout(this._secT); this._secT = setTimeout(() => this._refreshSections(), 400);
  },
  // re-derive the open menu and its parent after a change
  _secMenusRefresh(fn) {
    if (fn) this._rebuildLevel(fn);
    // the menus above keep their rows' titles / descriptions up to date
    for (const lvl of this.levels.slice(0, -1)) {
      if (lvl.rebuild) { const sel = lvl.sel; lvl.items = lvl.rebuild(); lvl.sel = Math.min(sel, lvl.items.length - 1); }
      else if (lvl.items.some((x) => x.act === "sec_new")) lvl.items = this._sectionsMenuItems();
    }
    this._refreshSections();
  },
  async _sectionAction(act) {
    const [op, id, path, f] = act.split("::");
    const s = this._sectionById(id);
    if (op === "sec_new") return this._sectionCreate();
    if (!s) return;
    const r = path != null ? this._node(id, path) : null;
    const n = r && r.node;
    const here = () => this._nodeEditItems(id, path);
    switch (op) {
      case "sec_rename": {
        const out = await this._askText("Section Name", [{ key: "v", label: "Name", value: s.name, required: true }], "Confirm");
        if (out && String(out.v || "").trim()) { s.name = String(out.v).trim(); this._persistUser(); this._secMenusRefresh(() => this._sectionEditItems(id)); }
        return;
      }
      case "sec_icon": {
        const p = await this._askPhoto("Choose the Section's Icon", s.icon);
        if (p) { s.icon = p; this._persistUser(); this._secMenusRefresh(() => this._sectionEditItems(id)); }
        return;
      }
      case "sec_move": {
        const levels = this.levels;
        this._sectionPlace(s, false, async () => {
          await this._refreshSections("settings");
          // back to where the move started (Settings > … > the section)
          this.levels = levels; this.selCat = this.columns.findIndex((c) => c.id === "settings");
          this._render(); this._onSelect();
        });
        return;
      }
      case "sec_fadd": {
        const p = await this._askFolder(`${s.name}: Add a Folder`);
        if (p && !(s.folders ||= []).includes(p)) { s.folders.push(p); this._persistUser(); }
        this._secMenusRefresh(() => this._secFolderItems(id));
        return;
      }
      case "sec_frm": {
        const p = (s.folders || [])[+path]; if (!p) return;
        if (!(await this._askConfirm(`Remove the ${p} folder from the section? (Its files aren't touched.)`))) return;
        s.folders.splice(+path, 1); this._persistUser();
        this._secMenusRefresh(() => this._secFolderItems(id));
        return;
      }
      case "sec_delall": {
        if (!(await this._askConfirm(`The ${poss(s.name)} folder (content\\${s.name}) and everything in it will be deleted for good.\nAre you sure you want to continue?`))) return;
        try { await call("section_delete_folder", { section: s.name, sub: null }); } catch (e) { this.audio.play("error", 0.4); this._shotFeedback(String(e)); return; }
        this.user.sections = this._sections().filter((x) => x !== s); this._persistUser();
        this.levels.pop();
        this._secMenusRefresh(() => this._sectionsMenuItems());
        return;
      }
      case "sec_noun": {
        const nn = await this._askNoun(s.name, TYPE_NOUN[this._secType(s)]);
        if (nn) { s.noun = nn; this._persistUser(); this._secMenusRefresh(() => this._sectionEditItems(id)); }
        return;
      }
      case "sec_addsub": {
        const ns = await this._subsectionSetup(s, 1, 1);
        if (ns) { s.subs.push(ns); this._persistUser(); this._secMenusRefresh(() => this._sectionEditItems(id)); }
        return;
      }
      case "sec_del": {
        if (!(await this._askConfirm(`Delete the section "${s.name}"?\nIts folder and files are kept.`))) return;
        this.user.sections = this._sections().filter((x) => x !== s); this._persistUser();
        this.levels.pop();
        this._secMenusRefresh(() => this._sectionsMenuItems());
        return;
      }
    }
    if (!n) return;
    switch (op) {
      case "sub_title": {
        const out = await this._askText("Subsection Title", [{ key: "v", label: "Title", value: n.title, required: true }], "Confirm");
        if (out && String(out.v || "").trim()) { n.title = String(out.v).trim(); this._persistUser(); this._secMenusRefresh(here); }
        return;
      }
      case "sub_desc": {
        const out = await this._askText("Subsection Description", [{ key: "v", label: "Description", value: n.desc || "" }], "Confirm");
        if (out) { n.desc = String(out.v || "").trim(); this._persistUser(); this._secMenusRefresh(here); }
        return;
      }
      case "sub_icon": {
        const ic = await this._askIcon(n.title, n.icon);
        if (ic === undefined) return;
        n.icon = ic; this._persistUser(); this._secMenusRefresh(here);
        return;
      }
      case "sub_addkid": {
        if (r.depth >= MAX_LAYERS) { this.audio.play("error", 0.5); this._shotFeedback(`Subsections can go ${MAX_LAYERS} layers deep at most`); return; }
        const kid = await this._nestedSetup(r.depth + 1);
        if (kid) { (n.children ||= []).push(kid); this._persistUser(); this._secMenusRefresh(() => this._nodeChildItems(id, path)); }
        return;
      }
      case "sub_delall": {
        if (!(await this._askConfirm(`The ${poss(n.title)} folder (content\\${s.name}\\${n.title}) and everything in it will be deleted for good.\nAre you sure you want to continue?`))) return;
        try { await call("section_delete_folder", { section: s.name, sub: n.title }); } catch (e) { this.audio.play("error", 0.4); return; }
        r.arr.splice(r.index, 1); this._persistUser();
        this.levels.pop();
        this._secMenusRefresh(() => this._sectionEditItems(id));
        return;
      }
      case "sub_del": {
        if (!(await this._askConfirm(`Delete the subsection "${n.title}"?`))) return;
        r.arr.splice(r.index, 1); this._persistUser();
        this.levels.pop();
        const parentPath = String(path).split("/").slice(0, -1).join("/");
        this._secMenusRefresh(parentPath ? () => this._nodeChildItems(id, parentPath) : () => this._sectionEditItems(id));
        return;
      }
      case "sub_fadd": {
        const p = await this._askFolder(`${n.title}: Add a Folder`);
        if (p && !(n.folders ||= []).includes(p)) { n.folders.push(p); this._persistUser(); }
        this._secMenusRefresh(() => this._subFolderItems(id, path));
        return;
      }
      case "sub_frm": {
        const p = (n.folders || [])[+f]; if (!p) return;
        if (!(await this._askConfirm(`Remove the ${p} folder? (Its files aren't touched.)`))) return;
        n.folders.splice(+f, 1); this._persistUser();
        this._secMenusRefresh(() => this._subFolderItems(id, path));
        return;
      }
    }
  },
};
