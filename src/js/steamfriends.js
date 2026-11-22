// XMB: Steam Friends and Linked Accounts (Account Management).
// - Connect with Steam Friends (On / Off, whenever wanted): On, the Friends
//   column shows the Steam account's friends and the user's own card the
//   Steam account; Off, the offline (local) PSN account and its friends.
// - Linked Accounts: the accounts the trophies come from (as Game
//   Databases: each one's value, or "Not Set").
// The back end: accounts.rs (kept encrypted), steamfriends.rs.
import { call, listen } from "./api.js";
import { CARD_COLORS, FRIEND_ORDER } from "./xmb-shared.js";
import { cmpBase } from "./api.js";
import { notify } from "./trophies.js";
import { PSN_DEFAULT_AVATAR, setSteamAvatar, steamAvatar } from "./ui.js";

const SI = { sys: "icon_accountmanage.png" };
// (as Friend Personalization's)
const FI = { sys: "icon_friend.png" };
// (Linked Accounts: what the trophies come from)
const TI = { sys: "icon_trophy.png" };
// the friends this many places above and below the cursor have their levels counted
const SF_NEAR = 6;
// Account Games: the stores, in this order
const ACCT_STORES = [["steam", "Steam"], ["ra", "RetroAchievements"], ["epic", "Epic Games"], ["gog", "GOG"]];
// Steam's status → the PSN card's: 0 Offline → Signed Out; 1 Online, 5
// Looking to Trade, 6 Looking to Play → Online; 2 Busy, 3 Away, 4 Snooze → Away
export function psnIndicator(state) {
  if (!state) return "sign_out";
  return state === 2 || state === 3 || state === 4 ? "afk" : "sign_in";
}
// "Last Sign-In: … Ago", from when the friend was last online
export function lastSignInLabel(unix, now = Date.now() / 1000) {
  const mins = Math.max(0, Math.floor((now - (unix || 0)) / 60));
  const unit = (n, u) => `${n} ${u}${n === 1 ? "" : "s"}`;
  if (!unix || mins >= 2 * 525600) return { label: "2 or More Years", mins: 2 * 525600 };
  if (mins < 120) return { label: unit(mins, "Minute"), mins };
  if (mins < 48 * 60) return { label: unit(Math.floor(mins / 60), "Hour"), mins };
  if (mins < 60 * 1440) return { label: unit(Math.floor(mins / 1440), "Day"), mins };
  return { label: unit(Math.max(2, Math.floor(mins / 43200)), "Month"), mins };
}
const colorFor = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CARD_COLORS[h % CARD_COLORS.length].hex; };
// the colour Steam shows a private profile in: its "This profile is private." (sampled
// from a capture of one, 1794729573592_04963CC1: rgb 57, 131, 141)
export const STEAM_PRIVATE_BG = "#39838d";
// a Steam friend's card colour: a private profile's, the colour Steam shows
// those in; the colour most of their profile background is (as it is, not the
// nearest card colour); else one of the card colours by their ID
const friendColor = (id, bg, priv) => (priv && STEAM_PRIVATE_BG) || (/^#[0-9a-f]{6}$/i.test(String(bg || "")) ? bg.toLowerCase() : null) || colorFor(id);

export const SteamFriendMethods = {
  async _acctLoad() {
    if (!this.user) { this._acct = null; return null; }
    // (another user: what was remembered of the last one's Steam friends let go)
    if (this._sfUser !== this.user.id) { this._sfUser = this.user.id; this._sfKept = null; this._sfLevels = null; this._sfLevelAt = null; this._sfNoPic = null; this._sfSig = null; this._sfAvHash = null; }
    try { this._acct = await call("accounts_view", { user: this.user.id }); } catch (e) { this._acct = null; }
    if (this._steamOn()) this._sfPollStart(); else this._sfPollStop();
    this._steamAvatarSync();
    return this._acct;
  },
  // Delete Steam Cache: what's in memory of it let go, the picture and the friends read again
  async _steamCacheCleared() {
    this._sfKept = null; this._sfLevels = null; this._sfLevelAt = null; this._sfNoPic = null; this._sfSig = null; this._sfAvHash = null; this._steamAvAsked = null;
    setSteamAvatar("");
    await this._steamAvatarSync();
    if (this._refreshFriendsColumn) await this._refreshFriendsColumn();
  },
  // Signed in to Steam (Linked Accounts: its key and ID): its own picture is an
  // avatar (the first of Change Avatar's) and, once per Steam account, the
  // account's avatar
  async _steamAvatarSync() {
    const user = this.user; if (!user) return;
    // (either is enough: the ID alone reads the public profile; the key alone, the account signed in to Steam here)
    const id = this._steamHas() ? String(this._acct.steamId || "local") : "";
    const apply = (p) => {
      if ((p || "") === steamAvatar()) return;
      setSteamAvatar(p);
      // (where it shows: the info box, the user's own card)
      this.cbs.onProfileChange && this.cbs.onProfileChange(this.user);
      if (this.columns && this.columns.some((c) => c.id === "friends")) this._refreshFriendsCard?.();
    };
    if (!id) { apply(""); return; }
    apply(await call("steam_own_avatar", { user: user.id, refresh: false }).catch(() => ""));
    if (this._steamAvAsked !== `${user.id}:${id}`) {
      this._steamAvAsked = `${user.id}:${id}`;
      apply(await call("steam_own_avatar", { user: user.id, refresh: true }).catch(() => steamAvatar()));
    }
    if (!steamAvatar() || this.user !== user || user.steamAvatarFor === id || !user.psnAccountId) return;
    try {
      const psn = await call("list_psn_accounts");
      const acct = (psn.accounts || []).find((a) => a.id === user.psnAccountId); if (!acct) return;
      user.steamAvatarFor = id; this._persistUser();
      if (acct.avatar !== "steam") {
        await call("save_psn_account", { account: { ...acct, avatar: "steam" } });
        await this._refreshFriendsCard?.();
        this.cbs.onProfileChange && this.cbs.onProfileChange(this.user);
      }
    } catch (e) { console.warn("steam avatar", e); }
  },
  // A Steam account to read: its ID (a public profile), or its Web API key (with the ID typed, or
  // else the account signed in to Steam on this computer). Either one is enough.
  _steamHas() { const a = this._acct; return !!(a && (a.steamId || (a.steamKey && a.steamLocal))); },
  _steamOn() { return !!(this._acct && this._acct.steamFriends && this._steamHas()); },
  // Account Management: the two options (after Trophy Level)
  _acctItems() {
    return [
      { kind: "setting", ctl: "sf:connect", title: "Connect with Steam Friends", icon: FI,
        sub: "On: Your profile and friends come from your Steam account." },
      { kind: "drill", title: "Linked Accounts", icon: TI, childrenFn: this._linkedItems,
        sub: "Enter your accounts to see your trophies." },
      { kind: "drill", acctGames: true, title: "Account Games", icon: TI, childrenFn: this._acctGamesStores,
        sub: "Choose which games from your accounts appear in your Trophy Collection." },
    ];
  },
  // Account Games: the accounts' games that aren't in the system, by store
  // (the page they come from), each one's trophies On (default) or Off
  async _acctGamesEnter(it) {
    const user = this.user && this.user.id; if (!user) return;
    try { this._acctGames = await call("account_games", { user, games: this._trophyGames() }) || []; } catch (e) { this._acctGames = this._acctGames || []; }
    if (!this._acctGames.length) { this.audio.play("error", 0.4); return; }
    this._drill(it, true);
  },
  _acctGamesStores() {
    const all = this._acctGames || [];
    // (Account Games: the trophy icon; each launcher: Account Management's; their games: the Game column's)
    return ACCT_STORES.filter(([k]) => all.some((g) => g.store === k)).map(([k, title]) => ({ kind: "drill", title, icon: SI, sub: "",
      childrenFn() { return (this._acctGames || []).filter((g) => g.store === k).map((g) => ({ kind: "setting", ctl: `ag:${g.folder}`, title: g.title, icon: { sys: "icon_game.png" } })); } }));
  },
  _agValue(ctl) { const g = (this._acctGames || []).find((x) => `ag:${x.folder}` === ctl); return g && g.on === false ? "Off" : "On"; },
  async _agToggle(ctl) {
    const g = (this._acctGames || []).find((x) => `ag:${x.folder}` === ctl); if (!g) return;
    g.on = g.on === false;
    this.audio.play("cursor_up", 0.4);
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    await call("account_game_set", { user: this.user.id, folder: g.folder, on: g.on }).catch(() => {});
    // (Off: out of Trophy Collection and the level at once; On: read at the next sync)
    if (!g.on) { this._tSets && this._tSets.delete(g.folder); this._trophyChanged(); }
  },
  _sfValue(ctl) { return ctl === "sf:connect" ? (this._acct && this._acct.steamFriends ? "On" : "Off") : ""; },
  async _sfToggle(ctl) {
    if (ctl !== "sf:connect") return;
    const on = !(this._acct && this._acct.steamFriends);
    if (on && !this._steamHas()) {
      // (a key alone, and Steam isn't signed in on this computer: whose account it is can't be known)
      const keyOnly = !!(this._acct && this._acct.steamKey);
      this.audio.play("error", 0.4);
      notify(keyOnly ? "Enter your Steam ID in Linked Accounts too, as Steam isn't signed in on this computer." : "Enter your Steam Web API Key or your Steam ID in Linked Accounts first.", keyOnly ? 6000 : undefined, "error"); return;
    }
    await call("account_set", { user: this.user.id, field: "steamFriends", value: on }).catch(() => {});
    await this._acctLoad();
    // (Account Management without / with the options Steam takes over; the
    // cursor stays on this option)
    const lvl = this._level();
    if (lvl && lvl.items.some((x) => x.ctl === "sf:connect")) {
      lvl.items = this._acctMgmtItems();
      lvl.sel = Math.max(0, lvl.items.findIndex((x) => x.ctl === "sf:connect"));
      this._render(); this._onSelect();
    } else this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    await this._refreshFriendsColumn();
    // (the trophy level goes Automatic with it: the user's card in Friends takes it at once)
    if (this._trophyChanged) this._trophyChanged();
  },
  // Linked Accounts: Steam (trophies and Steam Friends), the accounts signed in
  // to or with a key, the public profiles by ID; each value as Game Art Databases
  // shows it (or "Not Set"); and Remove All Accounts Information
  _linkedItems() {
    // (one section a launcher, as Steam's: what it's signed in with or its key, then its public profile's ID)
    const sec = (title, fn, sub) => ({ kind: "drill", title, icon: SI, childrenFn: fn, sub });
    return [
      sec("Steam", this._linkedSteam, "Your Steam account, for your trophies and Steam Friends."),
      sec("RetroAchievements", this._linkedRa, "Your RetroAchievements account, for your trophies."),
      sec("Epic Games", this._linkedEpic, "Your Epic Games account, for your trophies."),
      sec("GOG", this._linkedGog, "Your GOG account, for your trophies."),
      { kind: "action", act: "acct_removeall", title: "Remove All Accounts Information", icon: SI,
        sub: "Sign out of every account and delete your keys, IDs and saved trophy information." },
    ];
  },
  _acctVal(v, secret) { return v ? (secret ? "\u2022".repeat(8) : String(v)) : "Not Set"; },
  _acctKey(field, title, v, secret) { return { kind: "action", act: `acct_set::${field}`, title, icon: SI, sub: this._acctVal(v, secret) }; },
  _linkedSteam() {
    const a = this._acct || {};
    return [this._acctKey("steamKey", "Steam Web API Key", a.steamKey, true), this._acctKey("steamId", "Steam ID", a.steamId)];
  },
  _acctLogin_(store, title, name) { return { kind: "action", act: `acct_login::${store}`, title, icon: SI, sub: this._acctVal(name) }; },
  _linkedRa() { const a = this._acct || {}; return [this._acctKey("raUser", "RetroAchievements Username", a.raUser), this._acctKey("raKey", "RetroAchievements Web API Key", a.raKey, true)]; },
  // (signed in only: Epic shows an account's achievements to that account alone, whatever its profile's privacy)
  _linkedEpic() { const a = this._acct || {}; return [this._acctLogin_("epic", "Epic Games Account", a.epic)]; },
  _linkedGog() { const a = this._acct || {}; return [this._acctLogin_("gog", "GOG Account", a.gog), this._acctKey("gogUser", "GOG Username", a.gogUser)]; },
  // the open Linked Accounts list drawn again (its values changed; the cursor stays)
  _acctRedraw() {
    const l = this._level();
    if (l && l.rebuild) { l.items = l.rebuild(); l.sel = Math.max(0, Math.min(l.sel, l.items.length - 1)); this._render(); this._onSelect(); }
  },
  // Account Management (open under the menus here) built again: with or without the options Steam takes over
  _acctMgmtRefresh() {
    for (const l of this.levels || []) {
      if (!(l.items || []).some((x) => x.ctl === "sf:connect")) continue;
      const cur = l.items[l.sel];
      l.items = this._acctMgmtItems();
      l.sel = Math.max(0, l.items.findIndex((x) => cur && x.title === cur.title));
    }
    this._render(); this._onSelect();
  },
  _acctRemoveAll() {
    this.overlay = this.confirm;
    this.confirm.open("All your accounts' information will be deleted. Continue?", [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }], async (ch) => {
      this.confirm.close(); this.overlay = null;
      if (!ch || ch.id !== "yes") return;
      this.audio.play("enter", 0.5);
      const r = await this._runLocked("acct_removeall", "Please wait...", () => call("account_remove_all", { user: this.user.id }).then(() => true, (e) => String(e)),
        async () => { await this._acctLoad(); this._acctRedraw(); this._acctMgmtRefresh(); this._sfKept = null; this._sfLevels = null; this._sfLevelAt = null; this._tSets = null; await this._trophyLoad(false);
          this._refreshFriendsColumn && await this._refreshFriendsColumn(); });
      if (r !== true) { this.audio.play("error", 0.4); notify(r || "The information couldn't be deleted", undefined, "error"); }
      else notify("All accounts' information deleted");
      // (the trophies read again from what's on the computer: the trophy sync, its own screen)
      await this._trophySync(null);
    }, () => { this.confirm.close(); this.overlay = null; });
  },
  _acctAction(act, it) {
    if (act.startsWith("acct_set::")) return this._acctEdit(act.slice(10), it);
    if (act.startsWith("acct_login::")) return this._acctLogin(act.slice(12), it);
    if (act === "acct_removeall") return this._acctRemoveAll();
  },
  _acctEdit(field, it) {
    const secret = field === "steamKey" || field === "raKey";
    const cur = secret ? "" : ((this._acct || {})[field] || "");
    this.overlay = this.textForm;
    this.textForm.open({ title: it.title, fields: [{ key: "v", label: it.title, value: cur, type: secret ? "password" : "text" }], submit: "Confirm" },
      async (out) => {
        this.textForm.close(); this.overlay = null;
        try {
          const r = await call("account_set", { user: this.user.id, field, value: String(out.v || "").trim() });
          // (a private Steam account: its progress only with the key)
          if (r === "private") { this.audio.play("error", 0.4); notify("This Steam account is private, so its progress can only be saved with a Steam Web API Key.", 6000, "error"); }
          else this.audio.play("enter", 0.5);
          // (the Steam ID alone: Steam shows a profile's games only to someone signed in)
          if (r !== "private" && field === "steamId" && String(out.v || "").trim() && !(this._acct || {}).steamKey) notify("With Steam ID alone, you can only use Connect with Steam Friends. You need the Steam Web API Key to access your Steam trophies.", 6000);
        }
        catch (e) { this.audio.play("error", 0.4); notify(String(e || "That can't be used"), undefined, "error"); }
        await this._acctLoad(); this._acctRedraw();
        // (the Steam ID / key gone, no Steam account left: Connect with Steam Friends goes Off with it,
        // the system's own friends and Account Management's own options back)
        if ((field === "steamId" || field === "steamKey") && this._acct && this._acct.steamFriends && !this._steamHas()) {
          await call("account_set", { user: this.user.id, field: "steamFriends", value: false }).catch(() => {});
          await this._acctLoad();
          this._acctMgmtRefresh();
          await this._refreshFriendsColumn();
          if (this._trophyChanged) this._trophyChanged();
        }
        // (RetroAchievements reads nothing without both: its Web API asks for the two together)
        const a = this._acct || {};
        if ((field === "raUser" || field === "raKey") && !!a.raUser !== !!a.raKey) notify("RetroAchievements needs both the Username and the Web API Key.", 6000);
        this._trophyReset();
      },
      () => { this.textForm.close(); this.overlay = null; });
  },
  async _acctLogin(store, it) {
    const signed = !!(this._acct || {})[store];
    const go = async () => {
      this.audio.play("enter", 0.5);
      const r = await this._runLocked(`acct_${store}`, "Please wait...", () => call("account_login", { user: this.user.id, store }).then(() => true, (e) => String(e)),
        async () => { await this._acctLoad(); this._acctRedraw(); await this._trophyReset(); });
      if (r === true) notify(`Signed in to ${it.title.replace(/ Account$/, "")}`); else { this.audio.play("error", 0.4); notify(r || "The sign-in didn't finish", undefined, "error"); }
    };
    if (!signed) return go();
    // signed in: sign out, or sign in with another account
    this.overlay = this.sideMenu;
    this.sideMenu.open([{ label: "Sign Out", id: "out" }, { label: "Sign In with Another Account", id: "in" }], { title: it.title }, async (c) => {
      this.sideMenu.close(); this.overlay = null;
      if (!c) return;
      if (c.id === "in") { await call("account_logout", { user: this.user.id, store }).catch(() => {}); return go(); }
      await call("account_logout", { user: this.user.id, store }).catch(() => {});
      this.audio.play("enter", 0.4);
      await this._acctLoad(); this._acctRedraw(); this._trophyReset();
    }, () => { this.sideMenu.close(); this.overlay = null; });
  },
  // accounts changed: the trophies read again
  // (the saved lists read again; the trophies themselves at the next sync)
  _trophyReset() { return this._trophyLoad ? this._trophyLoad(false).then(() => this._tSets && this._trophyReread && this._trophyReread()) : Promise.resolve(); },
  // The Friends column from Steam (Connect with Steam Friends on): the user's
  // own card and the friends' cards. null: not connected (or Steam didn't answer).
  async _steamFriendsCards(acct) {
    await this._acctLoad();
    if (!this._steamOn()) return null;
    let data;
    // (Steam slow to give them, or refusing for a while -- they come with a later update --: said, at
    // most every two minutes)
    const sayWait = () => { if (Date.now() - (this._sfRefusedAt || 0) > 120000) { this._sfRefusedAt = Date.now(); notify("Please wait while your Steam friends load. This could take some time.", 6000); } };
    const slow = setTimeout(sayWait, 2500);
    try { data = await call("steam_friends", { user: this.user.id }); } catch (e) {
      console.warn("steam friends", e);
      if (/refusing/.test(String(e))) sayWait();
      return null;
    } finally { clearTimeout(slow); }
    // the levels kept on this computer: shown at once, before Steam is asked
    if (!this._sfKept) {
      try { this._sfKept = new Map(Object.entries(await call("steam_friend_levels_kept", { user: this.user.id }) || {})); } catch (e) { this._sfKept = new Map(); }
    }
    const me = data.me || {};
    // (the picture: the account's avatar, Steam's own by default)
    // (the comment: the one written here, Steam's own summary without one)
    const player = { ...acct, onlineId: me.name || acct.onlineId, avatar: acct.avatar || me.avatar, comment: acct.comment || me.summary || "" };
    const friends = (data.friends || []).map((f) => {
      // (no internet: the friends exactly as they were last known -- status, game and all --
      // until Steam answers again)
      const ind = psnIndicator(f.state);
      const ls = ind === "sign_out" ? lastSignInLabel(f.lastLogoff) : null;
      // their trophy level, counted from their public games (null while it's
      // being counted; "-" when their games are private)
      // (counted this session, else as kept on this computer until it's checked)
      const lv = this._sfLevels && this._sfLevels.has(f.id) ? this._sfLevels.get(f.id) : (this._sfKept || new Map()).get(f.id);
      // (a picture Steam has but not kept here yet: the loading icon in its place until it comes)
      const wait = !f.avatar && !!f.avatarHash && !(this._sfNoPic && this._sfNoPic.has(f.id));
      return { sid: f.id, name: f.name, message: f.summary || "", color: friendColor(f.id, f.bg, f.private), avatar: f.avatar || (wait ? "wait:" : PSN_DEFAULT_AVATAR), game: f.game || "",
        trophyLevel: lv === undefined ? null : lv === null ? "-" : lv, priv: !!f.private, indicator: ind, showGame: !!f.game, lastSignIn: ls ? ls.label : null, lastSignInMins: ls ? ls.mins : null,
        hasPlus: false, hasMbox: false, mboxNum: 0 };
    });
    friends.sort((a, b) => {
      const ga = FRIEND_ORDER[a.indicator] ?? 1, gb = FRIEND_ORDER[b.indicator] ?? 1;
      if (ga !== gb) return ga - gb;
      if (a.indicator === "sign_out") return (a.lastSignInMins ?? Infinity) - (b.lastSignInMins ?? Infinity);
      return cmpBase(a.name, b.name);
    });
    // (only the friends near the cursor are counted: _sfLevelsNear, as it moves)
    // (once the column has these cards)
    setTimeout(() => this._sfLevelsNear(), 800);
    this._sfSig = this._sfSignature(data);
    this._sfAvHash = me.avatarHash || "";
    return { player, friends };
  },
  // The friends near the cursor (6 above and below it; the first ones while
  // another column is open): their levels counted, a moment after the cursor
  // rests (steamfriends.rs keeps each one, and asks Steam for little when
  // nothing changed). The others keep their kept level, or none, until reached.
  _sfLevelsNear() {
    clearTimeout(this._sfNearT);
    this._sfNearT = setTimeout(() => {
      if (!(this._steamOn && this._steamOn())) return;
      const fcol = (this.columns || []).find((c) => c.id === "friends"); if (!fcol) return;
      const here = this.columns[this.selCat] === fcol && this.levels.length === 1;
      const items = fcol.items || [], sel = here ? this._level().sel : 0;
      const ids = [];
      // (the cursor above the friends, on the user's card or the options over it: the first ones)
      const first = items.findIndex((it) => it.kind === "friendcard");
      for (let i = Math.max(0, sel - SF_NEAR); i <= Math.min(items.length - 1, Math.max(sel + SF_NEAR, first + SF_NEAR - 1)); i++) {
        const it = items[i]; if (it && it.kind === "friendcard" && it.friend && it.friend.sid) ids.push(it.friend.sid);
      }
      if (ids.length) { this._sfLevelsAsk(ids); this._sfDetailsAsk(ids); }
    }, 350);
  },
  // ---- the friends' pictures and descriptions (steamfriends.rs: kept on this
  // computer; the ones near the cursor checked with Steam, a changed one told here)
  _sfDetailsAsk(ids) {
    if (!this._sfDetailListen) {
      this._sfDetailListen = true;
      listen("steam-friend-detail", (p) => {
        const fcol = (this.columns || []).find((c) => c.id === "friends"); if (!fcol) return;
        let changed = false;
        for (const it of fcol.items || []) if (it.kind === "friendcard" && it.friend.sid === p.id) {
          if (p.avatar && it.friend.avatar !== p.avatar) { it.friend.avatar = p.avatar; it.icon = { avatar: p.avatar }; changed = true; }
          if ((it.friend.message || "") !== (p.summary || "")) { it.friend.message = p.summary || ""; changed = true; }
          if (p.private !== undefined) it.friend.priv = !!p.private || it.friend.priv;
          if (p.bg !== undefined) { const c = friendColor(p.id, p.bg, it.friend.priv); if (it.friend.color !== c) { it.friend.color = c; changed = true; } }
        }
        if (changed && this.columns[this.selCat]?.id === "friends" && this.levels.length === 1) this._renderItems(this.root.clientWidth, this.root.clientHeight);
      });
    }
    call("steam_friend_details", { user: this.user.id, ids }).catch(() => {});
    // (a picture that doesn't come -- Steam not answering, no internet: the default face after
    // a while, not the loading icon for good)
    clearTimeout(this._sfPicT);
    this._sfPicT = setTimeout(() => {
      const fcol = (this.columns || []).find((c) => c.id === "friends"); if (!fcol) return;
      let changed = false;
      for (const it of fcol.items || []) if (it.kind === "friendcard" && it.friend.avatar === "wait:" && ids.includes(it.friend.sid)) {
        (this._sfNoPic ||= new Set()).add(it.friend.sid); it.friend.avatar = PSN_DEFAULT_AVATAR; it.icon = { avatar: PSN_DEFAULT_AVATAR }; changed = true;
      }
      if (changed && this.columns[this.selCat]?.id === "friends" && this.levels.length === 1) this._renderItems(this.root.clientWidth, this.root.clientHeight);
    }, 15000);
  },
  // ---- the friends' trophy levels (steamfriends.rs: counted in the background)
  _sfLevelsAsk(ids) {
    this._sfLevels ||= new Map();
    if (!this._sfLevelListen) {
      this._sfLevelListen = true;
      listen("steam-friend-level", (p) => {
        this._sfLevels.set(p.id, p.level);
        const fcol = (this.columns || []).find((c) => c.id === "friends"); if (!fcol) return;
        let changed = false;
        for (const it of fcol.items || []) if (it.kind === "friendcard" && it.friend.sid === p.id) { it.friend.trophyLevel = p.level == null ? "-" : p.level; changed = true; }
        if (changed && this.columns[this.selCat]?.id === "friends" && this.levels.length === 1) this._renderItems(this.root.clientWidth, this.root.clientHeight);
      });
    }
    // (a friend with a public profile whose games or achievements were private ("-"): asked again an
    // hour after, while shown, to see whether they were made public -- only them: a counted level
    // stands, and a private profile's change is seen at the status checks; steamfriends.rs LEVEL_RECOUNT)
    const at = (this._sfLevelAt ||= new Map()), now = performance.now();
    const fcol = (this.columns || []).find((c) => c.id === "friends");
    const profPrivate = new Set(((fcol && fcol.items) || []).filter((it) => it.kind === "friendcard" && it.friend.priv).map((it) => it.friend.sid));
    const todo = ids.filter((id) => !this._sfLevels.has(id)
      || (this._sfLevels.get(id) == null && !profPrivate.has(id) && now - (at.get(id) ?? -Infinity) >= 3600e3));
    for (const id of todo) at.set(id, now);
    if (todo.length) call("steam_friend_levels", { user: this.user.id, ids: todo }).catch(() => {});
  },
  // ---- statuses kept up to date: Steam asked again every minute while
  // connected; a change (signed in / out, away, another game) updates the Friends column and the info box's count
  // (a profile gone public or private too: its card's colour, and its level counted again, steamfriends.rs)
  _sfSignature(d) { return (d.friends || []).map((f) => `${f.id}:${f.state}:${f.game}:${f.private ? 1 : 0}`).join("|") + "#" + JSON.stringify(d.me || {}); },
  // (its minute doesn't run while a screen that has nothing to do with the friends or the XMB is
  // open -- the Web Browser, the media players and viewers --: it goes on from where it was
  // once that's closed)
  _sfPollStart() {
    if (this._sfPollT) return;
    this._sfPollRan = 0; this._sfPollTick = Date.now();
    this._sfPollT = setInterval(() => {
      const now = Date.now(), d = Math.max(0, now - this._sfPollTick); this._sfPollTick = now;
      if (this._sfPollPaused()) return;
      this._sfPollRan += d;
      if (this._sfPollRan < 60000) return;
      this._sfPollRan = 0;
      this._sfPollOnce();
    }, 1000);
  },
  _sfPollPaused() {
    if (this._browserActive) return true;
    const o = this.overlay;
    return !!o && [this.photoViewer, this.videoViewer, this.musicPlayer, this.photoGrid].includes(o);
  },
  async _sfPollOnce() {
    {
      if (!this.user || !this.user.psnAccountId || !this._steamOn() || this._inGame || this._sfPollPaused()) return;
      let data; try { data = await call("steam_friends", { user: this.user.id }); } catch (e) { return; }
      // (the friends with a public profile whose games or achievements were private: asked again
      // once their hour is up, wherever the cursor is -- only them, _sfLevelsAsk)
      if (this._sfLevels) this._sfLevelsAsk((data.friends || []).filter((f) => !f.private && this._sfLevels.has(f.id) && this._sfLevels.get(f.id) == null).map((f) => f.id));
      const sig = this._sfSignature(data);
      if (sig === this._sfSig) return;
      this._sfSig = sig;
      const online = (data.friends || []).filter((f) => { const i = psnIndicator(f.state); return i === "sign_in" || i === "afk"; }).length;
      this.cbs.onFriendsOnline && this.cbs.onFriendsOnline(online, false);
      // (a new picture on the Steam account: the kept avatar replaced, steamfriends.rs)
      if (((data.me || {}).avatarHash || "") !== this._sfAvHash) { this._sfAvHash = (data.me || {}).avatarHash || ""; this._steamAvatarSync(); }
      // (the column drawn again unless a menu is open in it)
      if (!(this.columns[this.selCat]?.id === "friends" && this.levels.length > 1) && !this.overlay) await this._refreshFriendsColumn();
    }
  },
  _sfPollStop() { clearInterval(this._sfPollT); this._sfPollT = 0; },
};
