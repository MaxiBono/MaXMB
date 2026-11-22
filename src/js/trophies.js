// XMB: trophies — PSN > Trophy Collection (the games with trophies, each
// game's trophies, a trophy's information), the trophy pop-ups and the
// notifications in the same look, and the trophy level counted from the
// trophies earned. The trophies themselves come from the back end
// (trophies.rs): only the games in the system have them.
import { assetUrl, call, cmpBase, listen, logLine, noExt } from "./api.js";
import { consoleBadge, esc } from "./xmb-shared.js";
import { gradeIcon, popFit, popHTML, popIn, popOut } from "./tpop.js";
import { avatarSrc, avatarFillStyle, isStockAvatar } from "./ui.js";
export { gradeIcon, popHTML };

const GRADE_NAME = { B: "Bronze", S: "Silver", G: "Gold", P: "Platinum" };
const POINTS = { B: 15, S: 30, G: 90, P: 180 };
const TI = "./assets/icons/trophy/trophy128_tex_grade_";
const HIDDEN_ICON = `${TI}hidden.png`;
// a trophy not earned yet (hidden or not): the console's grey picture with
// the padlock over it (Not Unlocked refs; the padlock is drawn by trophies.css)
const LOCKED_TILE = "./assets/icons/trophy/trophy_tex_default2.png";

// ---- the PS3's trophy level (1-100, before 2020) ---------------------------
// points: Bronze 15, Silver 30, Gold 90, Platinum 180. Level 2 at 200,
// 3 at 600, 4 at 1,200, 5 at 2,400, 6 at 4,000, then +2,000 a level to 12
// (16,000), +8,000 a level to 26 (128,000), +10,000 a level to 98
// (848,000), 99 at 858,000 and 100 at 880,000.
export function levelStart(l) {
  if (l <= 1) return 0;
  const first = [0, 0, 200, 600, 1200, 2400, 4000];
  if (l <= 6) return first[l];
  if (l <= 12) return 4000 + (l - 6) * 2000;
  if (l <= 26) return 16000 + (l - 12) * 8000;
  if (l <= 98) return 128000 + (l - 26) * 10000;
  return l === 99 ? 858000 : 880000;
}
export function levelFor(points) { let l = 1; while (l < 100 && points >= levelStart(l + 1)) l++; return l; }
export function setPoints(set) { return (set.trophies || []).reduce((n, t) => n + (t.earned != null ? POINTS[t.grade] || 15 : 0), 0); }
export function setProgress(set) {
  // (a game's progress: the share of its trophies won, by number -- the Platinum one of them --,
  // rounded down; the points count only for the Trophy Level)
  const all = (set.trophies || []).length;
  return all ? Math.floor(set.trophies.filter((t) => t.earned != null).length / all * 100) : 0;
}

// ---- a trophy's information (✕ on a trophy) --------------------------------
// The two rules, the trophy's picture, Title / Grade / Earned / Details and
// ○ Back (as the console's screen).
class TrophyInfo {
  constructor(audio) { this.audio = audio; this.el = document.createElement("div"); this.el.className = "tinfo"; document.body.appendChild(this.el); }
  // (not earned: "-" for when; a hidden one: its grade's glyph only, and "-" for its details)
  open({ icon, locked, addon, title, grade, secret, earned, details }, onClose) {
    this.onClose = onClose;
    const rows = [["Title", esc(title)],
      ["Grade", `<img class="tinfo-glyph" src="${secret ? HIDDEN_ICON : gradeIcon(grade)}" alt="">${secret ? "" : esc(GRADE_NAME[grade] || "")}`],
      ["Earned", esc(earned || "-")],
      ["Details", secret ? "-" : esc(details || "").replace(/\n/g, "<br>")]];
    this.el.innerHTML = `${icon ? `<div class="tinfo-icon${locked ? " troph-locked" : ""}${locked && addon ? " troph-addon" : ""}"><img src="${icon}" alt=""></div>` : ""}
      <div class="tinfo-rows">${rows.map(([k, v]) => `<div class="tinfo-row"><span class="tinfo-k">${k}</span><span class="tinfo-v">${v}</span></div>`).join("")}</div>
      <div class="tinfo-foot"><span class="tinfo-back"><span class="cf-glyph">○</span>Back</span></div>`;
    this.el.querySelector(".tinfo-back").addEventListener("click", () => this.onInput("back"));
    // (shown and closed as the game's Information screen)
    document.body.classList.add("menu-open");
    this.el.classList.add("show");
  }
  // a game's Information (△ > Information in Trophy Collection): its picture,
  // Title / Trophy Progress / Trophies (won / all, then each grade's count) /
  // Updated / Details, ○ Back
  openGame({ icon, title, pct, won, total, counts, updated, details }, onClose) {
    this.onClose = onClose;
    const g = (k) => `<span class="tinfo-cnt"><img class="tinfo-glyph" src="${gradeIcon(k)}" alt="">${counts[k] || 0}</span>`;
    const rows = [["Title", esc(title)], ["Trophy Progress", `${pct}%`], ["Trophies", `${won} / ${total}`],
      ["", ["P", "G", "S", "B"].map(g).join("")], ["Updated", esc(updated || "-")], ["Details", esc(details || "-").replace(/\n/g, "<br>")]];
    this.el.innerHTML = `${icon ? `<div class="tinfo-icon tinfo-gicon"><img src="${icon}" alt=""></div>` : ""}
      <div class="tinfo-rows tinfo-grows">${rows.map(([k, v]) => `<div class="tinfo-row"><span class="tinfo-k">${k}</span><span class="tinfo-v">${v}</span></div>`).join("")}</div>
      <div class="tinfo-foot"><span class="tinfo-back"><span class="cf-glyph">○</span>Back</span></div>`;
    this.el.querySelector(".tinfo-back").addEventListener("click", () => this.onInput("back"));
    document.body.classList.add("menu-open");
    this.el.classList.add("show");
  }
  close() { this.el.classList.remove("show"); this.el.innerHTML = ""; document.body.classList.remove("menu-open"); }
  onInput(a) { if (a === "back" || a === "enter") { this.audio.play("back", 0.5); this.close(); this.onClose && this.onClose(); } }
}

// ---- the pop-up (also every notification of the menus) ---------------------
// "You have earned a trophy." near the top right (the console's box: 422 x 102
// at 85 from the top and 103 from the right on a 1920 x 1080 screen).
let popEl = null, popT = 0, popQ = [], popBusy = false;
function popBox() {
  if (!popEl) { popEl = document.createElement("div"); popEl.className = "tpop"; document.body.appendChild(popEl); }
  return popEl;
}
// (nothing pops up before a user is signed in past the boot intro: the intro, the user list)
function popReady() {
  const x = window.__xmb, c = document.body.classList;
  return !!(x && x.user && !x.locked) && !c.contains("booting") && !c.contains("intro-hold") && !c.contains("intro-run");
}
// What a list of Trophy Collection shows (its rows' own data, without their drawn parts)
function trophyRowsSig(items) {
  try { return JSON.stringify(items || [], (k, v) => (typeof v === "function" || k === "tset" || (k && k[0] === "_")) ? undefined : v); } catch (e) { return String(Math.random()); }
}
/// A notification in the pop-up's look; `ms`: how long it stays.
// kind: "info", or "error" (something didn't go as expected); before a user is signed in: not shown
export function notify(text, ms = 2200, kind = "info") {
  if (!popReady()) return;
  const el = popBox();
  clearTimeout(popT);
  el.innerHTML = popHTML({ text, note: kind }); el.classList.toggle("tpop-plain", true); el.classList.remove("tpop-long", "tpop-multi"); el.style.removeProperty("height"); el.style.removeProperty("--tl");
  popIn(el);
  popT = setTimeout(() => popOut(el), ms);
}
let popWait = 0;
function nextPop(audio) {
  if (popBusy || !popQ.length) return;
  // (a trophy won before a user is signed in: it waits for the menus)
  if (!popReady()) { clearTimeout(popWait); popWait = setTimeout(() => nextPop(audio), 1000); return; }
  popBusy = true;
  const p = popQ.shift(), el = popBox();
  clearTimeout(popT);
  el.innerHTML = popHTML(p); el.classList.remove("tpop-plain"); popFit(el);
  // (shown once its picture is there)
  const img = el.querySelector(".tpop-icon img");
  let shown = false;
  const show = () => { if (shown) return; shown = true; popIn(el); if (p.kind === "trophy") audio.play("trophy", 0.9); };
  if (img && !img.complete) { img.addEventListener("load", show, { once: true }); img.addEventListener("error", show, { once: true }); setTimeout(show, 600); } else show();
  // (shown in full -- 5.2 s and its fade out, 5.6 s in all, as trophypop.rs counts it -- then
  // nothing for a second before the next one)
  popT = setTimeout(() => { popOut(el); setTimeout(() => { popBusy = false; nextPop(audio); }, 400 + 1000); }, 5200);
}

// RetroAchievements' console names → the system's console marks
const RA_CONSOLES = { "playstation": "PS1", "playstation 2": "PS2", "playstation portable": "PSP", "snes/super famicom": "SNES", "nes/famicom": "NES",
  "nintendo 64": "N64", "gamecube": "GameCube", "wii": "Wii", "wii u": "Wii U", "nintendo ds": "DS", "nintendo 3ds": "3DS", "game boy": "Game Boy",
  "game boy color": "Game Boy Color", "game boy advance": "GBA", "genesis/mega drive": "Genesis", "saturn": "Saturn", "dreamcast": "Dreamcast",
  "game gear": "Game Gear", "neo geo cd": "Neo Geo", "pc engine/turbografx-16": "PC Engine", "xbox": "Xbox" };
const fmtKey = (c) => RA_CONSOLES[String(c || "").toLowerCase()] || c;
const isAcct = (f) => String(f || "").startsWith("acct:");

export const TrophyMethods = {
  // the games in the system (content\Games)
  _trophyGames() {
    // (how each starts too: a hand-added game's shortcut tells its store or its program)
    // (Game Settings > Trophies Off: left out)
    return (this._allGames || []).filter((g) => g.folder && g.trophies !== false).map((g) => ({ folder: g.folder, title: String(g.title || ""), launch: String(g.launch || "") }));
  },
  // the trophies: what's kept (saved lists: the level on the card, at once);
  // refresh: read again from their sources (only by the sync, Trophy Collection)
  async _trophyLoad(refresh = false) {
    const user = this.user && this.user.id;
    if (!user) return;
    const games = this._trophyGames();
    if (!this._allGames) return;   // (the games aren't there yet: asked again later)
    if (this._tUser !== user || !this._tSets) {
      this._tUser = user;
      try { this._tSets = new Map((await call("trophies_cached", { user, games }) || []).map((s) => [s.folder, s])); } catch (e) { this._tSets = new Map(); }
      this._trophyChanged();
    }
    if (!refresh || this._tBusy) return;
    this._tBusy = true;
    try {
      const sets = await call("trophies_refresh", { user, games }) || [];
      if (this._tUser !== user) return;
      this._trophyTake(sets, true);
    } catch (e) { console.warn("trophies", e); }
    finally { this._tBusy = false; }
    this._trophyChanged();
  },
  // ---- the trophy sync: entering Trophy Collection ("Performing the sync
  // operation for trophy information... Please wait.", its progress, ○ Cancel).
  // Each game read again only when something changed (trophies.rs). Then, with
  // any game's trophies, Trophy Collection opens; without, the error sound.
  // it: the Trophy Collection item to open after (null: only the sync)
  // Trophy Collection opened: the sync screen when something changed since the
  // last sync, or when the accounts' stores are due to be asked again (their new
  // games and trophies come in during it, not after; trophies.rs
  // trophies_sync_needed); otherwise straight in
  async _trophyEnter(it) {
    if (this._tSyncing || this._tEntering) return;
    const user = this.user && this.user.id; if (!user) return;
    this._tEntering = true;
    let need = { changed: true, stores: false };
    try {
      if (this._tUser !== user || !this._tSets) await this._trophyLoad(false);
      need = await call("trophies_sync_needed", { user, games: this._trophyGames() }) || need;
    } catch (e) {}
    this._tEntering = false;
    if (need.changed || need.stores) return this._trophySync(it);
    this._drill(it, true);
  },
  async _trophySync(it) {
    if (this._tSyncing) return;
    const user = this.user && this.user.id; if (!user) return;
    this._tSyncing = true;
    const scr = new TrophySync(this.audio);
    let cancelled = false, unlisten = null;
    // ○ Cancel: the screen closes at once (the games not read yet are left as
    // they were; the one being read finishes in the background)
    const finish = () => {
      scr.close(); if (this.overlay === scr) this.overlay = null;
      this._tSyncing = false; this._trophyProfileNow();
      if (typeof unlisten === "function") { unlisten(); unlisten = null; }
    };
    this.overlay = scr;
    scr.open(() => { cancelled = true; call("trophies_sync_cancel").catch(() => {}); finish(); this._trophyChanged(); });
    // the progress: told by the back end, and asked for 4 times a second too
    // (so the bar moves even if a message is missed)
    let told = 0, asked = 0;
    unlisten = await listen("trophy-sync", (p) => { told++; scr.progress(p.done, p.total); });
    if (cancelled && typeof unlisten === "function") { unlisten(); unlisten = null; }
    const poll = setInterval(() => {
      if (!scr.el) { clearInterval(poll); return; }
      call("trophies_sync_progress").then((p) => { if (p && p.total) { asked++; scr.progress(p.done, p.total); } }).catch(() => {});
    }, 250);
    const t0 = performance.now();
    try {
      if (this._tUser !== user || !this._tSets) await this._trophyLoad(false);
      const games = this._trophyGames();
      if (games.length && !cancelled) {
        this._tBusy = true;
        // (null: the read failed, so nothing is taken for gone)
        const sets = await call("trophies_refresh", { user, games }).catch((e) => { console.warn("trophies", e); return null; });
        if (this._tUser === user && sets) this._trophyTake(sets, !cancelled);
      }
      clearInterval(poll);
      if (cancelled) { this._trophyChanged(); return; }
      // (100% shown a moment before it closes; the screen shown a moment at least, as the console's)
      scr.progress(1, 1);
      const left = Math.max(400, 900 - (performance.now() - t0)); await new Promise((r) => setTimeout(r, left));
      // (in the log: how long, and how the progress arrived)
      logLine("info", `trophy sync screen: ${Math.round(performance.now() - t0)} ms, ${told} progress messages, ${asked} progress answers`);
    } finally { this._tBusy = false; clearInterval(poll); this._trophyProfileNow(); }
    if (cancelled) return;
    finish();
    this._trophyChanged();
    if (it) this._drill(it, true);
  },
  _trophyInit() {
    if (this._tInit) return; this._tInit = true;
    this.trophyInfo = new TrophyInfo(this.audio);
    // a won trophy (in the menus: the window of its own shows it during a game)
    listen("trophy-pop", (p) => { popQ.push(p); nextPop(this.audio); });
    listen("trophies-changed", () => this._trophyLoad(false).then(() => this._trophyReread()));
    // an account game's picture fetched: shown in place of the loading icon
    listen("trophy-game-art", (e) => {
      const p = e && e.payload; if (!p) return;
      const s = this._tSets && this._tSets.get(p.folder); if (s) s.icon = p.icon;
      for (const lvl of this.levels || []) for (const it of lvl.items || []) {
        if (!it.tgame || it.tset.folder !== p.folder) continue;
        it.icon.art = assetUrl(p.icon);
        const fr = it._el && it._el.querySelector(".art-frame"); if (!fr) continue;
        let img = fr.querySelector(".art-img");
        if (!img) { img = document.createElement("img"); img.className = "art-img"; img.alt = ""; fr.prepend(img); }
        img.src = it.icon.art;
        fr.classList.remove("art-loading"); fr.querySelectorAll(".art-spin, .art-flat").forEach((n) => n.remove());
      }
    });
    // a trophy's picture fetched
    listen("trophy-icon", (p) => {
      const s = this._tSets && this._tSets.get(p.folder);
      const t = s && s.trophies.find((x) => x.id === p.id);
      if (t) t.icon = p.icon;
      this._trophyProfileNow();
      for (const lvl of this.levels || []) for (const it of lvl.items || []) {
        if (it.troph && it.troph.id === p.id && it.tset && it.tset.folder === p.folder) this._trophyIconSet(it);
      }
    });
  },
  async _trophyReread() {
    const user = this.user && this.user.id; if (!user) return;
    try { this._trophyTake(await call("trophies_cached", { user, games: this._trophyGames() }) || [], true); } catch (e) {}
    this._trophyChanged();
  },
  // The lists the system gave: kept here. whole: it's every list there is now,
  // so an account's game that isn't among them any more (its account signed
  // out or changed, the game no longer on it) is dropped here too.
  _trophyTake(sets, whole = false) {
    this._tSets ||= new Map();
    if (whole) { const have = new Set(sets.map((s) => s.folder)); for (const f of [...this._tSets.keys()]) if (String(f).startsWith("acct:") && !have.has(f)) this._tSets.delete(f); }
    for (const s of sets) this._tSets.set(s.folder, s);
  },
  // the lists open: drawn again (the cursor stays); the level on the card
  // (the profile open: its trophies as they are now)
  _trophyProfileNow() {
    clearTimeout(this._tProfT);
    this._tProfT = setTimeout(() => { const pc = this.profileCard; if (pc && pc.isOpen) pc.setTrophies({ ...this._trophyProfile(), level: this._userLevel }); }, 150);
  },
  _trophyChanged() {
    this._trophyProfileNow();
    const lvl = this._level && this._level();
    // (drawn again only when something in them changed: drawing them anew -- every picture,
    // name and grade glyph made again, the chosen one growing to its size again -- each time
    // the lists were read or a game list was made, while nothing had changed, made the chosen
    // trophy's name and glyph jump about for a while)
    if (lvl && lvl.trophyFn) {
      const items = lvl.trophyFn.call(this);
      if (trophyRowsSig(items) !== trophyRowsSig(lvl.items)) { lvl.items = items; lvl.sel = Math.max(0, Math.min(lvl.sel, items.length - 1)); this._render(); this._onSelect(); }
    }
    // (Connect with Steam Friends on: always Automatic)
    const auto = this._friendCfg && (this._friendCfg().playerLevel == null || (this._steamOn && this._steamOn()));
    if (auto) {
      const lv = this._trophyLevel();
      // (the user's card in Friends takes it at once, wherever the cursor is: the column isn't
      // drawn anew when it's opened again, and its card could still have the level it was made with)
      const fcol = (this.columns || []).find((c) => c.id === "friends");
      const pc = fcol && (fcol.items || []).find((it) => it.kind === "playercard");
      const stale = pc && pc.level !== lv;
      if (pc) pc.level = lv;
      if (lv !== this._userLevel || stale) {
        this._userLevel = lv;
        if (this.columns && this.columns[this.selCat]?.id === "friends") this._refreshFriendsColumn?.();
      }
    }
  },
  // Game Settings > Trophies changed for a game
  _trophyToggled(folder, on) {
    // (Off: its trophy record and saved list forgotten too)
    const user = this.user && this.user.id;
    if (!on && user) call("trophies_game_off", { user, folder }).catch((e) => console.warn("trophies", e));
    if (!this._tSets) return;
    if (!on) { this._tSets.delete(folder); this._trophyChanged(); } else this._trophyReread();
  },
  _trophyLevel() {
    // (only the games in the system, with Trophies On: a game deleted from the
    // system takes its trophies with it; brought back, they're back)
    const on = new Set((this._allGames || []).filter((g) => g.folder && g.trophies !== false).map((g) => g.folder));
    // (the accounts' games, Account Games On: the sync only gives those)
    for (const f of (this._tSets || new Map()).keys()) if (isAcct(f)) on.add(f);
    let pts = 0; for (const s of (this._tSets || new Map()).values()) if (on.has(s.folder)) pts += setPoints(s);
    return levelFor(pts);
  },
  // PSN > Trophy Collection
  _trophyCollectionItem(signedIn) {
    this._trophyInit();
    const fn = this._trophyGameItems;
    return { kind: "drill", title: "Trophy Collection", icon: { sys: "icon_trophy.png" }, trophyRoot: true,
      sub: signedIn ? "Online Mode\nView trophy information saved on the server." : "",
      childrenFn() { return fn.call(this); } };
  },
  // the games with trophies, alphabetically
  _trophyGameItems() {
    const games = new Map((this._allGames || []).filter((g) => g.trophies !== false).map((g) => [g.folder, g]));
    // (the accounts' games not in the system: as games of their own, Account Games On)
    for (const s of (this._tSets || new Map()).values()) if (isAcct(s.folder)) games.set(s.folder, { folder: s.folder, title: s.title, acct: true });
    const sets = [...(this._tSets || new Map()).values()].filter((s) => s.trophies && s.trophies.length && games.has(s.folder));
    // (alphabetically, as the Game column; the same name: in its order, so "(2)" comes after)
    const pos = new Map((this._allGames || []).map((g, i) => [g.folder, i]));
    const nm = (s) => noExt(games.get(s.folder).title);
    sets.sort((a, b) => cmpBase(nm(a), nm(b)) || (pos.get(a.folder) ?? 0) - (pos.get(b.folder) ?? 0));
    // △ > Sort By: Title Name (above), or Update Date (the last trophy won) ▼ newest first / ▲ oldest first
    const sort = (this.user && this.user.trophySort) || "title";
    if (sort !== "title") {
      const upd = (s) => (s.trophies || []).reduce((m, t) => Math.max(m, t.earned || 0), 0);
      const by = new Map(sets.map((s, i) => [s, i]));
      sets.sort((a, b) => (sort === "upd_asc" ? upd(a) - upd(b) : upd(b) - upd(a)) || by.get(a) - by.get(b));
    }
    // games with the same name: numbered "(2)", "(3)"... in the Game column's
    // order, so no two show the same (whatever their folders are called)
    const order = new Map((this._allGames || []).map((g, i) => [g.folder, i]));
    const base = (s) => noExt(games.get(s.folder).title).replace(/\s*\(\d+\)$/, "").trim();
    const nth = new Map(), count = new Map();
    for (const s of sets) count.set(base(s).toLowerCase(), (count.get(base(s).toLowerCase()) || 0) + 1);
    for (const s of [...sets].sort((a, b) => (order.get(a.folder) ?? 0) - (order.get(b.folder) ?? 0))) {
      const k = base(s).toLowerCase(), n = (nth.get(k) || 0) + 1; nth.set(k, n); s._n = n;
    }
    const items = sets.map((s) => {
      const g = games.get(s.folder);
      const folder = s.folder, b = base(s);
      const title = count.get(b.toLowerCase()) > 1 && s._n > 1 ? `${b} (${s._n})` : b;
      // (its picture: its banner -- chosen, dropped in its folder as trophy.*, or Steam's main
      // capsule put in by Game Recognition --, else the game's icon, else its trophy list's own,
      // else the default game icon; shown whole, in its own shape)
      // (an account game's: Steam's main capsule, else its store's picture, the loading icon until it's fetched)
      const art = g.trophy ? assetUrl(g.trophy) : g.icon ? assetUrl(g.icon) : s.icon ? assetUrl(s.icon) : g.acct ? "" : "./assets/icons/system/default_game.png";
      return { kind: "drill", title, tgame: true, tset: s, tconsole: g.acct ? (s.console || "PC") : (g.console || "PS3"), icon: { art, gameArt: true },
        childrenFn() { return this._trophyItems(folder); } };
    });
    // (the level is drawn again when the trophies change)
    queueMicrotask(() => { const l = this._level(); if (l && l.items === items) l.trophyFn = this._trophyGameItems; });
    return items;
  },
  // one game's trophies
  _trophyItems(folder) {
    const s = this._tSets && this._tSets.get(folder);
    if (!s) return [];
    // (an add-on's trophies after the game's own, each part in its order)
    const list = [...s.trophies.filter((t) => !t.addon), ...s.trophies.filter((t) => t.addon)];
    const items = list.map((t) => {
      const secret = t.hidden && t.earned == null;
      const sub = secret ? "" : [t.desc, t.earned ? this._fmtDateTime(new Date(t.earned * 1000)) : ""].filter(Boolean).join("\n");
      return { kind: "action", act: "trophy_info", troph: t, tset: s, title: secret ? "Hidden Trophy" : t.name, sub,
        icon: { art: this._trophyIconUrl(t), gameArt: true, plainLabel: true, artCls: `troph-art${t.earned == null ? " troph-locked" : ""}${t.addon && t.earned == null ? " troph-addon" : ""}` } };
    });
    queueMicrotask(() => { const l = this._level(); if (l && l.items === items) l.trophyFn = () => this._trophyItems(folder); });
    return items;
  },
  _trophyIconUrl(t) {
    if (t.earned == null) return LOCKED_TILE;
    if (t.autoPlat) return gradeIcon("P");
    return t.icon ? assetUrl(t.icon) : "";
  },
  // a trophy's picture now there
  _trophyIconSet(it) {
    const url = this._trophyIconUrl(it.troph);
    it.icon.art = url;
    const fr = it._el && it._el.querySelector(".art-frame");
    if (!fr || !url) return;
    let img = fr.querySelector(".art-img");
    if (!img) { img = document.createElement("img"); img.className = "art-img"; img.alt = ""; fr.appendChild(img); }
    img.src = url;
    fr.classList.remove("art-loading"); fr.querySelectorAll(".art-spin, .art-flat").forEach((n) => n.remove());
  },
  // the rows' own parts (_makeItemEl): a game's progress, a trophy's grade
  _trophyDecorate(el, it) {
    if (it.tgame) {
      el.classList.add("item-tgame");
      // (its picture not there yet: the loading icon meanwhile)
      const gfr = el.querySelector(".art-frame");
      if (gfr && !it.icon.art) {
        gfr.classList.add("art-loading");
        gfr.insertAdjacentHTML("beforeend", `<img class="art-spin" src="./assets/icons/system/loading_icon.png" alt="">`);
      }
      // its format under its name (the selected one's), as the console's PS3 / PS4 / PS Vita marks
      const tl0 = el.querySelector(".il-title");
      if (tl0 && it.tconsole) tl0.insertAdjacentHTML("afterend", `<div class="tg-fmt">${consoleBadge(fmtKey(it.tconsole))}</div>`);
      const p = setProgress(it.tset);
      // (the Platinum glyph: only once the game's Platinum is earned)
      const plat = it.tset.trophies.find((t) => t.grade === "P" && t.earned != null);
      el.insertAdjacentHTML("beforeend", `<div class="tg-prog"><span class="tg-num">${plat ? `<img class="tg-plat" src="${gradeIcon("P")}" alt="">` : ""}`
        + `<span class="tg-pct">${p}%</span></span><div class="tg-bar"><div class="tg-fill" style="width:${p}%"></div></div></div>`);
    } else if (it.troph) {
      el.classList.add("item-trophy");
      const t = it.troph, secret = t.hidden && t.earned == null;
      const tl = el.querySelector(".il-title");
      if (tl) tl.insertAdjacentHTML("beforebegin", `<img class="tr-glyph" src="${secret ? HIDDEN_ICON : gradeIcon(t.grade)}" alt="">`);
      // (a picture still being fetched: the games' loading icon meanwhile)
      const fr = el.querySelector(".art-frame");
      if (fr && !it.icon.art) {
        fr.classList.add("art-loading");
        const flat = this._secFlat && this._secFlat();
        fr.insertAdjacentHTML("beforeend", `<img class="art-spin" src="./assets/icons/system/loading_icon.png" alt="">`
          + (flat ? `<span class="art-flat" style="--flat:url('${flat}')"></span>` : ""));
      }
    }
  },
  // ✕ on a trophy: its information
  _trophyInfo(it) {
    const t = it.troph; if (!t) return;
    const secret = t.hidden && t.earned == null;
    this.audio.play("enter", 0.5);
    this.overlay = this.trophyInfo;
    this.trophyInfo.open({ icon: this._trophyIconUrl(t), locked: t.earned == null, addon: !!t.addon, secret, title: secret ? "Hidden Trophy" : t.name, grade: t.grade,
      earned: t.earned ? this._fmtDateTime(new Date(t.earned * 1000)) : "", details: secret ? "" : t.desc }, () => { this.overlay = null; });
  },
  // In Trophy Collection, while signed in (to the PSN account here, or with
  // Connect with Steam Friends): the user's mini card at the top right, in the
  // card's colour: avatar, ★ trophy level, its % with the bar, Online ID
  _trophyMiniSync() {
    let el = document.getElementById("tmini");
    const inside = !!(this.levels && this.levels.some((l) => (l.items || []).some((i) => i.tgame || i.troph)));
    const fcol = (this.columns || []).find((c) => c.id === "friends");
    const pc = fcol && (fcol.items || []).find((it) => it.kind === "playercard");
    const signed = !!(this.user && this.user.psnAccountId) || !!(this._steamOn && this._steamOn());
    const on = inside && signed && !!pc;
    document.body.classList.toggle("tmini-on", on);
    if (!on) { if (el) el.classList.remove("show"); return; }
    if (!el) { el = document.createElement("div"); el.id = "tmini"; document.body.appendChild(el); }
    const a = pc.acct || {}, pts = this._trophyPoints ? this._trophyPoints() : 0;
    const lv = this._userLevel || levelFor(pts);
    const lo = levelStart(lv), hi = levelStart(Math.min(100, lv + 1));
    const pct = lv >= 100 || hi <= lo ? 100 : Math.max(0, Math.min(99, Math.floor((pts - lo) / (hi - lo) * 100)));
    const key = [a.avatar, a.onlineId, a.background, lv, pct].join("|");
    if (el._key !== key) {
      el._key = key;
      el.style.setProperty("--card-bg", a.background || "#868485");
      el.innerHTML = `<img class="tm-av${isStockAvatar(a.avatar) ? " tm-stock" : ""}" style="${avatarFillStyle(avatarSrc(a.avatar))}" src="${avatarSrc(a.avatar)}" alt=""><img class="tm-star" src="./assets/icons/system/trophy_level.png" alt="">`
        + `<span class="tm-lv">${lv}</span><span class="tm-pct">${pct}%</span><div class="mp2-bar tm-bar"><div class="mp2-fill tm-fill" style="width:${pct}%"></div></div>`
        + `<span class="tm-id">${esc(a.onlineId || "")}</span>`;
    }
    el.classList.add("show");
  },
  // the user's profile (✕ on the user's card): the last 8 trophies won (the
  // newest first), the % to the next level, the trophies won in all and by grade
  _trophyProfile() {
    const on = new Set((this._allGames || []).filter((g) => g.folder && g.trophies !== false).map((g) => g.folder));
    const won = [];
    for (const s of (this._tSets || new Map()).values()) if (on.has(s.folder) || isAcct(s.folder)) for (const t of s.trophies || []) if (t.earned != null) won.push(t);
    won.sort((a, b) => (b.earned || 0) - (a.earned || 0));
    const counts = {}; for (const t of won) counts[t.grade] = (counts[t.grade] || 0) + 1;
    const pts = this._trophyPoints(), lv = this._userLevel || levelFor(pts);
    const lo = levelStart(lv), hi = levelStart(Math.min(100, lv + 1));
    const pct = lv >= 100 || hi <= lo ? 100 : Math.max(0, Math.min(99, Math.floor((pts - lo) / (hi - lo) * 100)));
    // (loading: the trophies aren't all read yet -- the profile's empty places turn meanwhile)
    return { recent: won.slice(0, 8).map((t) => this._trophyIconUrl(t)), counts, total: won.length, pct, loading: !this._tSets || !!this._tBusy || !!this._tSyncing };
  },
  // the trophy points of the games counted in the level (as _trophyLevel)
  _trophyPoints() {
    const on = new Set((this._allGames || []).filter((g) => g.folder && g.trophies !== false).map((g) => g.folder));
    let pts = 0; for (const s of (this._tSets || new Map()).values()) if (on.has(s.folder) || isAcct(s.folder)) pts += setPoints(s);
    return pts;
  },
  // △ on a game in Trophy Collection: Sort By (Title Name, Update Date ▼ / ▲),
  // Privacy Settings, Information (the console's panel)
  _trophyGameOptions(it) {
    // (the panel open: the game goes as small and as dim as the ones not chosen; back when it closes)
    const relay = () => this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    const done = () => { this.overlay = null; if (it._held) { delete it._held; relay(); } };
    this.overlay = this.gameMenu;
    it._held = true; relay();
    this.gameMenu.open({ withBg: !!document.querySelector(".bg-layer.show"),
      top: [{ id: "sort", label: "Sort By", sub: true }],
      lower: [{ id: "privacy", label: "Privacy Settings" }, { id: "info", label: "Information" }],
      subs: { sort: { options: [{ id: "title", label: "Title Name" }, { id: "upd_desc", label: "Update Date", tri: "down" }, { id: "upd_asc", label: "Update Date", tri: "up" }],
        current: (this.user && this.user.trophySort) || "title" } } }, (id, val) => {
      if (id === "sort") {
        if (this.user) { this.user.trophySort = val; this._persistUser(); }
        this.gameMenu.close(); done();
        // (the list in its new order, the same game still chosen)
        const lvl = this._level(), f = it.tset.folder;
        if (lvl && lvl.trophyFn) { lvl.items = lvl.trophyFn.call(this); lvl.sel = Math.max(0, lvl.items.findIndex((x) => x.tset && x.tset.folder === f)); this._render(); this._onSelect(); }
        return;
      }
      if (id === "info") { this.audio.play("enter", 0.5); this.gameMenu.close(); done(); this._trophyGameInfo(it); return; }
      this.audio.play("error", 0.4);   // (not in this system)
    }, done);
  },
  _trophyGameInfo(it) {
    const s = it.tset, list = (s.trophies || []);
    const won = list.filter((t) => t.earned != null);
    const counts = {}; for (const t of won) counts[t.grade] = (counts[t.grade] || 0) + 1;
    const last = won.reduce((m, t) => Math.max(m, t.earned || 0), 0);
    const g = (this._allGames || []).find((x) => x.folder === s.folder);
    // (its own icon, not its banner in the list: the game's icon, an account game's own
    // (Steam's logo of it...), its trophy list's own picture, else what its row shows)
    const icon = g && g.icon ? assetUrl(g.icon) : s.gameIcon ? assetUrl(s.gameIcon) : s.icon && !(g && g.trophy) && !isAcct(s.folder) ? assetUrl(s.icon) : it.icon.art;
    this.overlay = this.trophyInfo;
    this.trophyInfo.openGame({ icon: icon || "./assets/icons/system/default_game.png", title: it.title, pct: setProgress(s), won: won.length, total: list.length, counts,
      updated: last ? this._fmtDateTime(new Date(last * 1000)) : "", details: (g && g.description) || "" }, () => { this.overlay = null; });
  },
  // the pop-up's window during a game takes the menus' Font, Text Size, Text
  // Color and PS3 theme notification picture too
  _trophyStyle() {
    const t = (this.user && this.user.theme) || {}, root = document.documentElement;
    const color = root.style.getPropertyValue("--text").trim();
    const tn = root.classList.contains("tnotify") ? root.style.getPropertyValue("--tnotify").trim() : "";
    call("trophy_pop_style", { style: { font: t.font || "", color, scale: (t.fontSize ?? 100) / 100, tnotify: tn } }).catch(() => {});
  },
  // the menus' notifications: the pop-up's look (top right)
};

// The trophy sync's screen (the console's captures: the XMB blurred behind
// the two lines, the two text lines, the progress bar, its percentage, ○ Cancel)
export class TrophySync {
  constructor(audio) { this.audio = audio; }
  open(onCancel) {
    this.onCancel = onCancel;
    this.el = document.createElement("div"); this.el.className = "tsync";
    this.el.innerHTML = `<div class="tsync-text">Performing the sync operation for trophy information...<br>Please wait.</div>
      <div class="tsync-bar"><div class="tsync-fill"></div></div><div class="tsync-pct">0%</div>
      <div class="tsync-foot"><span class="cf-hint"><span class="cf-glyph cf-o">\u25CB</span>Cancel</span></div>`;
    this.el.querySelector(".tsync-foot").addEventListener("click", () => this.onInput("back"));
    document.body.appendChild(this.el); document.body.classList.add("menu-open");
    requestAnimationFrame(() => this.el && this.el.classList.add("on"));
  }
  progress(done, total) {
    if (!this.el) return;
    const pct = total ? Math.max(0, Math.min(100, Math.floor(done * 100 / total))) : 0;
    if (pct < (this.pct || 0)) return;
    this.pct = pct;
    this.el.querySelector(".tsync-fill").style.width = `${pct}%`;
    this.el.querySelector(".tsync-pct").textContent = `${pct}%`;
  }
  close() { if (this.el) { this.el.remove(); this.el = null; } document.body.classList.remove("menu-open"); }
  onInput(a) {
    if (a === "back" && this.el && !this.done) { this.done = true; this.audio.play("back", 0.5); this.onCancel && this.onCancel(); }
  }
}
