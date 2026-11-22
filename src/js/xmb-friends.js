// XMB: friend (the Xmb class's methods, from xmb.js; put on its prototype there)
import { CARD_COLORS, CARD_DEFAULT, CARD_INDICATORS, FRIEND_MAX, FRIEND_MSGS, FRIEND_ORDER, MSG_LIMIT, NAME_LIMIT, SIGNOUT_TIME_OPTIONS, gameFor, lastSignInForBucket, randomFriendName, randomLastSignIn, randomMboxNum, randomTrophyLevel, signInMins } from "./xmb-shared.js";
import { PSN_AVATARS, PSN_DEFAULT_AVATAR, parseColor, randomPsnAvatar } from "./ui.js";
import { call, cmpBase } from "./api.js";

export const FriendMethods = {

  async _friendsItems() {
    // Empty until signed in to PSN: matches the real XMB Friends screen when
    // not signed up / signed in (Friends XMB.png).
    if (!this.user?.psnAccountId) return [];
    // Order (all without descriptions): Block List, Add a Friend, Players Met,
    // Start New Chat, Chat Room (Text Only), Message Box, then the user card and
    // friend cards.
    const base = [
      { kind: "ph", title: "Block List", icon: { sys: "icon_blocklist.png" } },
      { kind: "ph", title: "Add a Friend", icon: { sys: "icon_addfriend.png" } },
      { kind: "ph", title: "Players Met", icon: { sys: "icon_playermet.png" } },
      { kind: "ph", title: "Start New Chat", icon: { sys: "icon_chat.png" } },
      { kind: "ph", title: "Chat Room (Text Only)", icon: { sys: "icon_chatroom_text.png" } },
      { kind: "ph", title: "Message Box", icon: { sys: "icon_mbox.png" } },
    ];
    {
      const psn = await call("list_psn_accounts");
      const acct = (psn.accounts || []).find((a) => a.id === this.user.psnAccountId);
      if (acct) {
        // the player's own card; its trophy level comes from Friend
        // Personalization when set, otherwise a stable random value.
        // (2.0.0: Automatic becomes the Trophy Level of every user once, a level
        // chosen before it existed included; chosen again afterwards, it stays)
        if (!this._friendCfg().levelAuto) {
          const c = { ...this._friendCfg(), levelAuto: true }; delete c.playerLevel;
          this.user.friendConfig = c; this._persistUser();
        }
        const pl = this._friendCfg().playerLevel;
        // Automatic (not chosen): counted from the trophies earned (trophies.js);
        // "random" = a random level from 1 to 30
        if (pl === "random") this._userLevel ||= 1 + Math.floor(Math.random() * 30);
        else this._userLevel = pl != null ? pl : this._trophyLevel();
        // Connect with Steam Friends on: the card and the friends from Steam (steamfriends.js)
        const steam = await this._steamFriendsCards(acct);
        if (steam) {
          // (Connect with Steam Friends: the trophy level is always Automatic)
          this._userLevel = this._trophyLevel();
          base.push({ kind: "playercard", title: steam.player.onlineId, acct: steam.player, steam: true, icon: { avatar: steam.player.avatar }, level: this._userLevel,
            plusFn: () => !!this._friendCfg().playerPlus });
          for (const f of steam.friends) base.push({ kind: "friendcard", title: f.name, friend: f, icon: { avatar: f.avatar } });
          const online = steam.friends.filter((f) => f.indicator === "sign_in" || f.indicator === "afk").length;
          this.cbs.onFriendsOnline && this.cbs.onFriendsOnline(online, false);
          return base;
        }
        base.push({ kind: "playercard", title: acct.onlineId, acct, icon: { avatar: acct.avatar }, level: this._userLevel,
          plusFn: () => !!this._friendCfg().playerPlus });
        // how many friends to show comes from Friend Personalization (falls back
        // to the info-box counter when set to "random")
        const friends = this._genFakeFriends(this._friendTargetCount(acct.friendsOnline || 0));
        for (const f of friends) base.push({ kind: "friendcard", title: f.name, friend: f, icon: { avatar: f.avatar } });
        // The info-box "friends online" count is the number of friends whose
        // indicator is Online (blue) or Away (AFK): the ones actually signed in.
        const onlineCount = friends.filter((f) => f.indicator === "sign_in" || f.indicator === "afk").length;
        // any card with the message mark → the message icon in the top-right box too
        const hasMail = friends.some((f) => f.indicator === "none" || (f.indicator !== "sent_request" && f.hasMbox));
        this.cbs.onFriendsOnline && this.cbs.onFriendsOnline(onlineCount, hasMail);
      }
    }
    return base;
  },

  // The Friend Personalization config on the user (with sane defaults).
  _friendCfg() {
    const c = (this.user && this.user.friendConfig) || {};
    return { mode: c.mode || "random", count: c.count ?? 8, min: c.min ?? 2, max: c.max ?? 30,
      cards: Array.isArray(c.cards) ? c.cards : [], playerLevel: c.playerLevel, playerPlus: !!c.playerPlus, levelAuto: !!c.levelAuto };
  },
  // How many friends to show, based on the chosen mode. Cached per session so it
  // doesn't reshuffle on every render.
  _friendTargetCount(fallback) {
    const c = this._friendCfg();
    if (c.mode === "fixed") return Math.max(0, Math.min(FRIEND_MAX, c.count));
    if (c.mode === "range") {
      const lo = Math.min(c.min, c.max), hi = Math.max(c.min, c.max);
      if (this._friendCountCache == null) this._friendCountCache = lo + Math.floor(Math.random() * (hi - lo + 1));
      return Math.max(0, Math.min(FRIEND_MAX, this._friendCountCache));
    }
    // Randomized: a random number between 0 and 30 (kept for the session)
    if (this._friendCountCache == null) this._friendCountCache = Math.floor(Math.random() * 31);
    return this._friendCountCache;
  },
  // Generate the set of fake online friends. Saved Friend Cards are used first
  // (in order), then the remaining slots are filled with randomized friends.
  // Cached until the count or the saved cards change.
  _genFakeFriends(n) {
    const cfg = this._friendCfg();
    const key = n + "|" + JSON.stringify(cfg.cards);
    if (this._fakeFriends && this._fakeFriendsKey === key) return this._fakeFriends;
    this._fakeFriendsKey = key;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const RAND = "random";
    // weighted indicator pick: received friend request ("none") 2 %, sent
    // request 5 %; otherwise the blue circle is 3× as likely as away or
    // signed out
    const pickIndicator = () => {
      // (one roll: none 2 %, sent request 5 %, away 10 %, then the blue
      // circle 3x as likely as signed out)
      const r = Math.random();
      if (r < 0.02) return "none";
      if (r < 0.07) return "sent_request";
      if (r < 0.17) return "afk";
      return Math.random() < 0.75 ? "sign_in" : "sign_out";
    };
    const used = new Set();
    const uniqueName = () => {
      let nm = randomFriendName(); let g = 0;
      while (used.has(nm) && g++ < 12) nm = randomFriendName();
      while (used.has(nm)) nm = randomFriendName() + String(Math.floor(Math.random() * 900) + 10);
      used.add(nm); return nm;
    };
    const out = [];
    // 1) the player's saved friend cards, up to n (each field may be a fixed
    //    value or "random", resolved here)
    for (let i = 0; i < Math.min(cfg.cards.length, n); i++) {
      const c = cfg.cards[i];
      const ind = c.indicator === RAND ? pickIndicator() : (CARD_INDICATORS[c.indicator] ? c.indicator : "sign_in");
      const name = (c.name && c.name !== RAND) ? c.name : uniqueName();
      if (c.name && c.name !== RAND) used.add(name);
      const msgPick = (c.message && c.message !== RAND) ? c.message : pick(FRIEND_MSGS);
      // only Online / Away friends have a bubble; a random one is left off 10% of the time
      const bubbleOk = ind === "sign_in" || ind === "afk";
      let message = !bubbleOk ? "" : ((c.message && c.message !== RAND) ? c.message : (Math.random() < 0.10 ? "" : msgPick));
      const color = (c.color && c.color !== RAND) ? c.color : pick(CARD_COLORS).hex;
      const avatar = (c.avatar && c.avatar !== RAND) ? c.avatar : randomPsnAvatar();
      // 20% of random cards don't show a trophy level (the card shows "–")
      const level = (c.level != null && c.level !== RAND) ? c.level : (Math.random() < 0.2 ? "-" : randomTrophyLevel());
      if (level === "-") message = "";      // a hidden trophy level never has a bubble
      const showGame = ind === "sign_in" ? (c.showGame === RAND ? (Math.random() < 0.75) : (c.showGame !== false)) : false;
      const game = showGame ? ((c.game && c.game !== RAND) ? c.game : gameFor(msgPick, name)) : "";
      const hasPlus = ind === "none" ? false : (c.hasPlus === RAND ? (Math.random() < 0.30) : !!c.hasPlus);
      const hasMbox = (ind === "none" || ind === "sent_request") ? false : (c.hasMbox === RAND ? (Math.random() < 0.5) : !!c.hasMbox);
      const mboxNum = (c.mboxNum != null && c.mboxNum !== RAND) ? c.mboxNum : randomMboxNum();
      const ls = ind === "sign_out"
        ? (c.signOutTime && c.signOutTime !== RAND ? lastSignInForBucket(c.signOutTime)
          : (c.lastSignIn && c.lastSignIn !== RAND ? { label: c.lastSignIn, mins: signInMins(c.lastSignIn) } : randomLastSignIn()))
        : null;
      out.push({ name, message, color, game, avatar, trophyLevel: level, indicator: ind, showGame,
        lastSignIn: ls ? ls.label : null, lastSignInMins: ls ? ls.mins : null,
        hasPlus, hasMbox, mboxNum });
    }
    // 2) fill the rest with randomized friends (generated PSN-style handles)
    const remaining = n - out.length;
    for (let k = 0; k < remaining; k++) {
      const name = uniqueName();
      const msgPick = pick(FRIEND_MSGS);
      const ind = pickIndicator();
      // bubble: Online / Away only, and even then 10% of them have none
      // a hidden trophy level (20%) never has a bubble
      const trophyLevel = Math.random() < 0.2 ? "-" : randomTrophyLevel();
      const message = trophyLevel !== "-" && (ind === "sign_in" || ind === "afk") && Math.random() >= 0.10 ? msgPick : "";
      // blue circle: usually shows a game, but sometimes none. Others: no game.
      const showGame = ind === "sign_in" ? (Math.random() < 0.75) : false;
      // PS Plus 30%, message badge 10% (PS Plus never on received-request)
      const hasPlus = ind !== "none" && Math.random() < 0.30;
      const hasMbox = (ind !== "none" && ind !== "sent_request") && Math.random() < 0.10;
      const ls = ind === "sign_out" ? randomLastSignIn() : null;
      out.push({ name, message, avatar: randomPsnAvatar(), color: pick(CARD_COLORS).hex,
        game: showGame ? gameFor(msgPick, name) : "", trophyLevel,
        indicator: ind, showGame, lastSignIn: ls ? ls.label : null, lastSignInMins: ls ? ls.mins : null,
        hasPlus, hasMbox, mboxNum: randomMboxNum() });
    }
    // Group order: Received Request → Online → Away → Signed Out → Sent Request.
    // Within each group order alphabetically by name, EXCEPT the Signed Out group
    // which orders by how long ago they signed in (least time ago at the top).
    out.sort((a, b) => {
      const ga = FRIEND_ORDER[a.indicator] ?? 1, gb = FRIEND_ORDER[b.indicator] ?? 1;
      if (ga !== gb) return ga - gb;
      if (a.indicator === "sign_out") return (a.lastSignInMins ?? Infinity) - (b.lastSignInMins ?? Infinity);
      return cmpBase(a.name, b.name);
    });
    this._fakeFriends = out;
    return out;
  },
  // ---- Friend Personalization submenu ---------------------------------------
  _friendPersonalizationItems() {
    const SI = { sys: "icon_setting_item.png" }, FI = { sys: "icon_friend.png" };
    const cfg = this._friendCfg();
    const items = [
      { kind: "setting", ctl: "friendmode", title: "Friend Count", icon: FI,
        sub: "Randomized: a random number of friends. Fixed: a set number. Range: a random number between a minimum and maximum you choose." },
    ];
    if (cfg.mode === "fixed") {
      items.push({ kind: "setting", ctl: "friendcount", title: "Number of Friends", icon: SI,
        sub: "How many friends appear on the Friends screen." });
    } else if (cfg.mode === "range") {
      items.push({ kind: "setting", ctl: "friendmin", title: "Minimum Friends", icon: SI,
        sub: "The lowest number of friends that can appear." });
      items.push({ kind: "setting", ctl: "friendmax", title: "Maximum Friends", icon: SI,
        sub: "The highest number of friends that can appear." });
    }
    items.push({ kind: "action", act: "friend_card_new", title: "Create Friend Card", icon: FI,
      sub: "Design a friend card: name, card color, status message and the game they're playing. Saved cards are used before randomized friends." });
    items.push({ kind: "drill", title: "Friend Card Collection", icon: FI,
      sub: `${cfg.cards.length} saved card${cfg.cards.length !== 1 ? "s" : ""}. View, edit or delete your friend cards.`,
      childrenFn: this._friendCardCollectionItems });
    return items;
  },
  _friendCardCollectionItems() {
    const cards = this._friendCfg().cards;
    if (!cards.length) return [{ kind: "empty", title: "No Friend Cards", sub: "Create one from Friend Personalization.", icon: { sys: "icon_friend.png" } }];
    return cards.map((c, i) => {
      const nm = (c.name && c.name !== "random") ? c.name : "(Random Name)";
      const gm = (c.game && c.game !== "random") ? `Playing ${c.game}` : ((c.message && c.message !== "random") ? c.message : "Randomized card");
      return { kind: "action", act: "friend_card_edit::" + i, title: nm, sub: gm, icon: { sys: "icon_friend.png" } };
    });
  },
  _friendPersistCfg(mut) {
    const c = this._friendCfg();
    mut(c);
    (this.user.friendConfig = c);
    this._friendCountCache = null;      // recompute the range count next time
    this._fakeFriendsKey = null;        // force friends to regenerate
    this._friendMenuDirty = true;       // Friends column refreshes on menu exit
    this._persistUser();
    // (and right away too, a moment after the change: the player card's trophy
    // level and the friends show as they are now, however the menu is left)
    clearTimeout(this._friendRefreshT);
    this._friendRefreshT = setTimeout(() => this._refreshFriendsColumn(), 250);
  },
  // Create/edit a friend card. A multi-step flow builds the card object. Every
  // option offers a "Random" choice (resolved when friends are generated); the
  // text fields randomize when left blank.
  _friendCardEditor(idx) {
    const RAND = "random";
    const existing = idx != null ? this._friendCfg().cards[idx] : null;
    const card = {
      name: existing?.name || "", message: existing?.message || "", game: existing?.game || "",
      color: existing?.color || CARD_DEFAULT, avatar: existing?.avatar || PSN_AVATARS[0] || PSN_DEFAULT_AVATAR,
      indicator: existing?.indicator || "sign_in",
      showGame: existing?.showGame == null ? true : existing.showGame,
      hasPlus: existing?.hasPlus == null ? false : existing.hasPlus,
      hasMbox: existing?.hasMbox == null ? false : existing.hasMbox,
      mboxNum: existing?.mboxNum != null ? existing.mboxNum : RAND,
      level: (existing?.level != null ? existing.level : (existing?.trophyLevel != null ? existing.trophyLevel : RAND)),
      signOutTime: existing?.signOutTime || RAND,
    };
    const cancel = () => { this.overlay = null; this._rebuildAndStay(); };
    const save = () => {
      this._friendPersistCfg((c) => {
        c.cards = Array.isArray(c.cards) ? c.cards.slice() : [];
        if (idx != null) c.cards[idx] = card; else c.cards.push(card);
      });
      cancel();
    };
    // On/Off/Random picker → true | false | "random"
    const onOffRandom = (title, cur, next) => {
      this.overlay = this.listPicker;
      this.listPicker.open({ title, items: [{ label: "Off", id: "off" }, { label: "On", id: "on" }, { label: "Random", id: RAND }], submit: "Next" }, (ch) => {
        this.listPicker.close(); const id = ch && ch.id; next(id === "on" ? true : id === RAND ? RAND : false);
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = cur === RAND ? 2 : cur ? 1 : 0; this.listPicker._upd();
    };
    // final step: trophy level (1-30 or Random)
    const stepLevel = () => {
      this._askTrophyLevel(`${cardName()}: Trophy Level`, card.level == null ? RAND : card.level, "Save Card",
        (lv) => { card.level = lv === "random" ? RAND : lv; save(); }, () => cancel());
    };
    // signed-out last-sign-in time (only for Signed Out or Random indicator)
    const stepSignOut = () => {
      if (card.indicator !== "sign_out" && card.indicator !== RAND) { stepLevel(); return; }
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Last Sign-In Time`, items: SIGNOUT_TIME_OPTIONS, submit: "Next" }, (ch) => {
        this.listPicker.close(); card.signOutTime = (ch && ch.id) || RAND; stepLevel();
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = Math.max(0, SIGNOUT_TIME_OPTIONS.findIndex((o) => o.id === card.signOutTime)); this.listPicker._upd();
    };
    // message-icon number (only when the message icon can be on)
    const stepMboxNum = () => {
      const canMbox = card.indicator !== "none" && card.indicator !== "sent_request";
      if (!canMbox || card.hasMbox === false) { stepSignOut(); return; }
      this._askNumberOrRandom(`${cardName()}: Message Number`, card.mboxNum == null ? RAND : card.mboxNum, "Next",
        (n) => { card.mboxNum = n === "random" ? RAND : n; stepSignOut(); }, () => cancel(),
        { min: 0, what: "Number", randomSub: "A random number, like the other random cards." });
    };
    // message badge (skipped for Received/Sent Friend Request)
    const stepMbox = () => {
      if (card.indicator === "none" || card.indicator === "sent_request") { stepSignOut(); return; }
      onOffRandom(`${cardName()}: Message Icon`, card.hasMbox, (v) => { card.hasMbox = v; stepMboxNum(); });
    };
    // PS Plus badge (not available on Received Friend Request)
    const stepPlus = () => {
      if (card.indicator === "none") { stepMbox(); return; }
      onOffRandom(`${cardName()}: PlayStation Plus`, card.hasPlus, (v) => { card.hasPlus = v; stepMbox(); });
    };
    // whether the currently-playing game is visible (Online or Random only)
    const stepShowGame = () => {
      if (card.indicator !== "sign_in" && card.indicator !== RAND) { stepPlus(); return; }
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Show Playing Game`,
        items: [{ label: "No", id: "no" }, { label: "Yes", id: "yes" }, { label: "Random", id: RAND }], submit: "Next" }, (ch) => {
        this.listPicker.close(); const id = ch && ch.id; card.showGame = id === "yes" ? true : id === RAND ? RAND : false; stepPlus();
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = card.showGame === RAND ? 2 : card.showGame ? 1 : 0; this.listPicker._upd();
    };
    // status indicator next to the name
    const stepIndicator = () => {
      const inds = [
        { label: "Online", id: "sign_in" }, { label: "Away", id: "afk" },
        { label: "Received Friend Request", id: "none" }, { label: "Signed Out", id: "sign_out" },
        { label: "Sent Friend Request", id: "sent_request" }, { label: "Random", id: RAND }];
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Indicator`, items: inds, submit: "Next" }, (ch) => {
        this.listPicker.close(); card.indicator = (ch && ch.id) || "sign_in"; stepShowGame();
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = Math.max(0, inds.findIndex((o) => o.id === card.indicator)); this.listPicker._upd();
    };
    // avatar: choose one, or Random
    const stepAvatar = () => {
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Avatar`,
        items: [{ label: "Choose an Avatar", id: "choose" }, { label: "Random", id: RAND }], submit: "Next" }, (ch) => {
        this.listPicker.close();
        if (ch && ch.id === RAND) { card.avatar = RAND; stepIndicator(); return; }
        this.overlay = this.avatarPicker;
        this.avatarPicker.open(card.avatar === RAND ? (PSN_AVATARS[0] || PSN_DEFAULT_AVATAR) : card.avatar, { set: "psn" }, (ref) => {
          this.avatarPicker.close(); card.avatar = ref || card.avatar; stepIndicator();
        }, () => { this.avatarPicker.close(); cancel(); });
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = card.avatar === RAND ? 1 : 0; this.listPicker._upd();
    };
    // card colour (no Auto; Random available)
    const stepColor = () => {
      const colorItems = [{ label: "Random", id: RAND }, ...CARD_COLORS.map((c) => ({ label: c.name, id: c.hex })),
        { label: "Custom Color", id: "custom" }];
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Card Color`, items: colorItems, submit: "Next" }, (ch) => {
        this.listPicker.close();
        if (ch && ch.id === "custom") {
          this.overlay = this.colorPicker;
          this.colorPicker.open({ title: `${cardName()}: Custom Color`, value: parseColor(card.color) ? card.color : CARD_DEFAULT },
            (hex) => { card.color = hex; stepAvatar(); }, () => stepColor());
          return;
        }
        card.color = (ch && ch.id) || CARD_DEFAULT; stepAvatar();
      }, () => { this.listPicker.close(); cancel(); });
      let ci = colorItems.findIndex((c) => c.id === card.color);
      if (ci < 0 && parseColor(card.color)) ci = colorItems.length - 1;
      this.listPicker.i = Math.max(0, ci); this.listPicker._upd();
    };
    const cardName = () => card.name || "New Friend";
    // step 1: text fields (blank name/message/game = randomized)
    this.overlay = this.textForm;
    this.textForm.open({
      title: existing ? "Edit Friend Card" : "Create Friend Card",
      fields: [
        { key: "name", label: "PSN Name (blank for random)", value: card.name, max: NAME_LIMIT },
        { key: "message", label: "Status Message (blank for random)", value: card.message, max: MSG_LIMIT },
        { key: "game", label: "Playing Now (blank for random)", value: card.game },
      ], submit: "Next",
    }, (out) => {
      this.textForm.close();
      card.name = (out.name || "").trim(); card.message = (out.message || "").trim(); card.game = (out.game || "").trim();
      stepColor();
    }, () => { this.textForm.close(); this.overlay = null; });
  },
  // Set the trophy level shown on the player's own card (1-30).
  // A trophy level: type any number (1 or more), or Random (1-30, as before)
  _askTrophyLevel(title, cur, submit, done, cancel, auto = false) {
    this._askNumberOrRandom(title, cur, submit, done, cancel, { min: 1, what: "Level", randomSub: "A random level from 1 to 30.", auto });
  },
  // type a number (min or more), or Random (with its usual limits)
  _askNumberOrRandom(title, cur, submit, done, cancel, { min = 0, what = "Number", randomSub = "", auto = false } = {}) {
    const again = () => this._askNumberOrRandom(title, cur, submit, done, cancel, { min, what, randomSub, auto });
    this.overlay = this.listPicker;
    this.listPicker.open({ title, submit: "Next", items: [
      // (your own Trophy Level: Automatic, from the trophies earned, first)
      ...(auto ? [{ label: "Automatic", id: "auto", sub: "" }] : []),
      { label: "Random", id: "random", sub: randomSub },
      { label: `Custom ${what}\u2026`, id: "type", sub: cur != null && cur !== "random" && cur !== "auto" ? `Now: ${what === "Level" ? "Level " : ""}${cur}` : "" }] }, (ch) => {
      this.listPicker.close();
      if (ch.id === "random") { done("random"); return; }
      if (ch.id === "auto") { done("auto"); return; }
      this.overlay = this.textForm;
      this.textForm.open({ title, fields: [{ key: "n", label: what, value: cur != null && cur !== "random" && cur !== "auto" ? String(cur) : "", type: "number", required: true }], submit },
        (out) => {
          this.textForm.close();
          const n = parseInt(String(out.n || "").replace(/[^0-9]/g, ""), 10);
          if (!Number.isFinite(n) || n < min) { this.audio.play("error", 0.4); again(); return; }
          done(n);
        }, () => { this.textForm.close(); again(); });
    }, () => { this.listPicker.close(); cancel(); });
    this.listPicker.i = (auto ? 1 : 0) + (cur === "random" ? 0 : 1) - (auto && cur === "auto" ? 2 : 0); this.listPicker._upd();
  },
  _editPlayerLevel() {
    const cur = this._friendCfg().playerLevel ?? "auto";
    this._askTrophyLevel("Trophy Level", cur, "Set Level", (lv) => {
      this.overlay = null;
      this._userLevel = lv === "random" ? 1 + Math.floor(Math.random() * 30) : lv === "auto" ? this._trophyLevel() : lv;
      this._friendPersistCfg((c) => { if (lv === "auto") delete c.playerLevel; else c.playerLevel = lv; });
      this.audio.play("enter", 0.4);
      this._rebuildAndStay();
    }, () => { this.overlay = null; this._rebuildAndStay(); }, true);
  },
  // Options for an existing card: Edit or Delete.
  _friendCardMenu(idx) {
    this.overlay = this.sideMenu;
    this.sideMenu.open([{ label: "Edit Card", id: "edit" }, { label: "Delete Card", id: "delete" }],
      { title: "Friend Card" }, (choice) => {
        this.sideMenu.close(); this.overlay = null;
        if (!choice) return;
        if (choice.id === "edit") this._friendCardEditor(idx);
        else if (choice.id === "delete") {
          this._friendPersistCfg((c) => { c.cards = c.cards.slice(); c.cards.splice(idx, 1); });
          this._rebuildAndStay();
        }
      }, () => { this.sideMenu.close(); this.overlay = null; });
  },
  // Friend Personalization numeric / mode adjustment (left/right or enter).
  // Number of friends / minimum / maximum: typed in (left / right still step it).
  _typeFriendNumber(it) {
    const key = { friendcount: "count", friendmin: "min", friendmax: "max" }[it.ctl];
    const cur = String(this._friendCfg()[key] ?? "");
    this.overlay = this.textForm;
    this.textForm.open({ title: it.title, fields: [{ key: "n", label: "Number", value: cur, type: "number" }], submit: "Confirm" },
      (out) => {
        this.textForm.close(); this.overlay = null;
        const n = parseInt(String(out.n || "").replace(/[^0-9]/g, ""), 10);
        if (!Number.isFinite(n)) { this.audio.play("error", 0.4); return; }
        this._friendPersistCfg((c) => { c[key] = Math.max(0, Math.min(FRIEND_MAX, n)); });
        this._layoutItems(this.root.clientWidth, this.root.clientHeight);
      }, () => { this.textForm.close(); this.overlay = null; });
  },
  _adjustFriendSetting(ctl, dir) {
    this._friendPersistCfg((c) => {
      if (ctl === "friendmode") {
        const order = ["random", "fixed", "range"];
        const i = (order.indexOf(c.mode) + dir + order.length) % order.length;
        c.mode = order[i];
      } else if (ctl === "friendcount") {
        c.count = Math.max(0, Math.min(FRIEND_MAX, (c.count ?? 8) + dir));
      } else if (ctl === "friendmin") {
        c.min = Math.max(0, Math.min(FRIEND_MAX, (c.min ?? 2) + dir));
      } else if (ctl === "friendmax") {
        c.max = Math.max(0, Math.min(FRIEND_MAX, (c.max ?? 30) + dir));
      }
    });
    this.audio.play("cursor_up", 0.4);
    // friendmode changes which sub-settings show → rebuild ONLY this submenu
    // level in place (so we don't leave the Friend Personalization menu). The
    // generated friends aren't rebuilt here; they refresh when the player backs
    // out of the menu (see _back).
    if (ctl === "friendmode") this._rebuildFriendMenuLevel();
    else this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  },
  // Re-derive the Friend Personalization submenu items in place, keeping the
  // drill stack and (clamped) cursor so the player stays in the menu.
  _rebuildFriendMenuLevel() {
    const lvl = this._level();
    if (!lvl) return;
    const sel = lvl.sel;
    lvl.items = this._friendPersonalizationItems();
    lvl.sel = Math.max(0, Math.min(sel, lvl.items.length - 1));
    this._render(); this._onSelect();
  },
  // Rebuild just the Friends column's data (used when leaving Friend
  // Personalization so count/mode/card changes take effect without a full XMB
  // rebuild that would collapse the menu).
  async _refreshFriendsColumn() {
    this._friendMenuDirty = false;
    const fcol = this.columns.find((c) => c.id === "friends");
    if (!fcol) return;
    fcol.items = await this._friendsItems();
    if (this.columns[this.selCat]?.id === "friends" && this.levels.length === 1) {
      const lvl = this.levels[0];
      lvl.items = fcol.items;
      if (lvl.sel >= lvl.items.length) lvl.sel = Math.max(0, lvl.items.length - 1);
      this._render(); this._onSelect();
    }
  },
  async _refreshFriendsCard() {
    const fcol = this.columns.find((c) => c.id === "friends");
    if (!fcol) return;
    fcol.items = await this._friendsItems();
    if (this.columns[this.selCat]?.id === "friends")
      this._renderItems(this.root.clientWidth, this.root.clientHeight);
  },
};
