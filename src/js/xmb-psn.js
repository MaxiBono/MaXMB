// XMB: psn (the Xmb class's methods, from xmb.js; put on its prototype there)
import { CARD_COLORS, HOME_DESC, MSG_LIMIT, NAME_LIMIT } from "./xmb-shared.js";
import { call } from "./api.js";

export const PsnMethods = {

  _psnItems() {
    const signedIn = !!(this.user && this.user.psnAccountId);
    // (the linked accounts and the trophies, read in the background)
    if (this.user && this._acctFor !== this.user.id) {
      this._acctFor = this.user.id; this._tSets = null;
      // (only the saved lists, for the level: the trophies are read again by
      // the trophy sync, when Trophy Collection is opened)
      this._acctLoad().then(() => setTimeout(() => { this._trophyLoad(false); this._gamesRenamedPending && this._gamesRenamedPending(); }, 2500));
    }
    // The auth entry that leads the column. Its identity depends on state, but
    // its position (top) and the four content items below it never change.
    let authItem;
    if (signedIn) {
      // Sign Out lives on this item's options (triangle) menu, not as a child.
      authItem = { kind: "drill", title: "Account Management", sub: "Adjust settings for your account or for purchases made at PlayStation\u00aeStore.", icon: { sys: "icon_accountmanage.png" }, psnAuth: true,
        childrenFn: this._acctMgmtItems, acctMgmt: true };
    } else {
      // Sign In once THIS user has signed in to (or made) a PSN account
      // before; a user that never has, Sign Up (whatever accounts other users
      // have: its Sign-Up screen can still go to "Sign In with an Existing
      // Account"). They never appear together.
      const u = this.user || {};
      const linked = !!(u.psnLinkedId || (u.psnSaved && u.psnSaved.email)) && (this.psnAccounts?.accounts || []).length > 0;
      authItem = linked
        ? { kind: "action", act: "psn_signin", title: "Sign In", icon: { sys: "signin.png" }, sub: "" }
        : { kind: "action", act: "psn_signup", title: "Sign Up", icon: { sys: "signup.png" }, bg: "cinfo-bg-signup.jpg",
            sub: "PSN is all about entertainment and interaction.\nEnjoy FREE* online gaming, download amazing new games, game expansion packs for a host of top titles, watch trailers and get your hands on exclusive content, chat with friends, and compare Trophies.\n\nSign up today \u2013 it's easy and it's FREE!\n\n* Broadband Internet connection required." };
    }
    // Fixed vertical order below the auth item: What's New, Trophy Collection,
    // PlayStation\u00aePlus, PlayStation\u00aeStore (PlayStation\u00aeHome removed).
    return [
      authItem,
      { kind: "ph", title: "What's New", icon: { sys: "whatsnew.png" }, bg: "cinfo-bg-whatsnew.jpg",
        sub: "Welcome to PlayStation\u00ae3.\nThe \"What's New\" screen is where to find all the latest PlayStation\u00ae news, updates, plus easy access to the games you've most recently played.\nTo access the \"What's New\" screen, connect to PSN* \u2013 it's free to join and it's your gateway to a world of entertainment, so sign up today!\n\n* Broadband Internet connection required." },
      // Trophy Collection: description only when signed in to PSN; the
      // games with trophies and their trophies (trophies.js)
      this._trophyCollectionItem(signedIn),
      // ✕ turns your PlayStation Plus mark (card + top-right box) on and off
      { kind: "action", act: "psplus_toggle", title: "PlayStation\u00aePlus", icon: { sys: "ps_plus.png" } },
      // PlayStation\u00aeHome: its backdrop and description (Original / Modern
      // Version, see _homeLook); starts the "PlayStation Home" game when one is installed
      this._homeGame
        ? { kind: "action", act: "launch_home", title: "PlayStation\u00aeHome", homeItem: true, panel: "home", sub: HOME_DESC, ...this._homeLook() }
        : { kind: "ph", title: "PlayStation\u00aeHome", homeItem: true, panel: "home", sub: HOME_DESC, ...this._homeLook() },
      this._storeItem("cinfo-bg-storemain.jpg"),
    ];
  },
  // The PlayStation\u00aeStore subsection, reused in the PSN, Game and Video columns.
  // `bg` picks the matching cinfo backdrop (storemain / storegame / storevideo).
  // "Search for Media Servers" \u2014 first item in Music / Photo / Video.
  _mediaServersItem() { return { kind: "ph", title: "Search for Media Servers", sub: "", icon: { sys: "icon_mediaserver_search.png" } }; },
  _storeItem(bg) {
    return { kind: "ph", title: "PlayStation\u00aeStore", icon: { sys: "store.png" }, bg,
      sub: "FREE* to access, PlayStation\u00aeStore is the only place to download new and exclusive PS3\u2122 games, FREE playable demos, add-on packs, and high-definition videos.\n\nGet more for your PS3\u2122 and visit PlayStation\u00aeStore today.\n\n* Broadband Internet connection required." };
  },
  async _psnProfile() {
    // edit the SAME acct object the inline playercard item holds, so changes show
    // live without a backend round-trip (fixes stale/refresh-only updates).
    const fcol = this.columns.find((c) => c.id === "friends");
    const pcItem = fcol && fcol.items.find((it) => it.kind === "playercard");
    // (Connect with Steam Friends: the card shows the Steam account; its colour
    // and comment are this system's, kept on the PSN account here)
    const steam = !!(pcItem && pcItem.steam);
    let acct = pcItem && pcItem.acct;
    if (!acct) { const psn = await call("list_psn_accounts"); acct = psn.accounts.find((a) => a.id === this.user.psnAccountId); }
    if (!acct) return;
    const colors = CARD_COLORS.slice();
    this._userLevel ||= 1;
    this.overlay = this.profileCard;
    const tp = this._trophyProfile ? this._trophyProfile() : {};
    const save = async () => {
      if (!steam) { call("save_psn_account", { account: { ...acct } }); return; }
      // (only the colour and the comment go to the account here: its Online ID and avatar stay its own)
      const psn = await call("list_psn_accounts"), own = psn.accounts.find((a) => a.id === this.user.psnAccountId);
      if (own) call("save_psn_account", { account: { ...own, background: acct.background, comment: acct.comment } });
    };
    // ✕ on the comment bubble: the system's text form, then back to the profile
    const editComment = (cur, done) => {
      this.overlay = this.textForm;
      const back = (v) => { this.textForm.close(); this.overlay = this.profileCard; done(v); };
      this.textForm.open({ title: "Comment", prompt: "Comment", fields: [{ key: "v", label: "Comment", value: cur, max: MSG_LIMIT }] },
        (out) => back(String(out.v || "")), () => back(null));
    };
    this.profileCard.open(acct, { colors, colorPicker: this.colorPicker, level: this._userLevel, editComment, ...tp, onChange: (a) => {
      acct.background = a.background; acct.comment = a.comment;       // live-mutate the item's data
      if (this.columns[this.selCat]?.id === "friends")
        this._renderItems(this.root.clientWidth, this.root.clientHeight); // reflect immediately
      save();                                                         // persist in background
    } }, () => { this.overlay = null; this._render(); this._onSelect(); });
  },
  // PSN Sign-Up / Sign-In: the console's Sign-In screen (ui.js PsnSignIn).
  // Both end on the "Signing in... / Please wait." screen with the loading
  // clock while the PSN column (account, friends) loads; ○ cancels it.
  _psnFormValues(extra = {}) {
    const saved = this.user.psnSaved || {};
    return { email: saved.email || "", password: saved.password || "",
      auto: this.user.psnAutoSignIn === true && !!saved.password, save: !!saved.password, ...extra };
  },
  // an error message over the form; OK goes back to it
  _psnFormError(msg) {
    const form = this.psnSignInForm;
    this.audio.play("error", 0.6);
    this.overlay = this.confirm;
    const back = () => { this.confirm.close(); this.overlay = form; form._render(); };
    this.confirm.open(msg, [{ label: "OK", id: "ok" }], back, back);
  },
  // the loading screen: at least ~1 s (like the console); resolves false if cancelled
  async _psnWait(text) {
    const form = this.psnSignInForm;
    let cancelled = false, wake;
    const cancelP = new Promise((r) => { wake = r; });
    form.loading(text, () => { cancelled = true; wake(); });
    this._loadingBegin();
    await Promise.race([new Promise((r) => setTimeout(r, 1100)), cancelP]);
    if (cancelled) { this._loadingQuit(); return false; }
    return true;
  },
  async _psnFinish(acct, out) {
    const form = this.psnSignInForm;
    this.user.psnAccountId = acct.id; this.user.psnLinkedId = acct.id;
    this.user.psnAutoSignIn = !!out.auto;
    // Save Password (always on with Auto Sign-In) keeps the ID and password; the ID is kept either way
    this.user.psnSaved = { email: out.email, password: out.save || out.auto ? out.password : "" };
    await call("save_user", { user: this.user });
    this.cbs.onProfileChange(this.user);
    await this._reloadPsn();
    await this._loadingSettle(); this._loadingDone();
    form.close(); this.overlay = null; this._render(); this._onSelect();
  },
  _psnSignUp(prefill = {}) {
    const form = this.psnSignInForm;
    this.overlay = form;
    form.open({ mode: "signup", onlineId: "", email: "", password: "", ...prefill },
      async (out) => {
        const psn = await call("list_psn_accounts");
        const all = psn.accounts || [];
        const low = (x) => String(x || "").toLowerCase();
        // (signing up: the console's rules; edited afterwards (Edit Online
        // ID), up to 255 characters of any kind)
        if (!/^[A-Za-z0-9_-]{3,16}$/.test(out.onlineId))
          return this._psnFormError("The Online ID must be 3 to 16 characters long, using only letters, numbers, hyphens (-) and underscores (_).");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) return this._psnFormError("The Sign-In ID (E-mail Address) is not valid.");
        if (all.some((a) => low(a.onlineId) === low(out.onlineId))) return this._psnFormError("This Online ID is already in use.");
        if (all.some((a) => low(a.email) === low(out.email))) return this._psnFormError("This Sign-In ID (E-mail Address) is already in use.");
        if (!(await this._psnWait("Signing up...\nPlease wait."))) { form._render(); return; }
        const acct = await call("save_psn_account", { account: {
          id: "", onlineId: out.onlineId.slice(0, 16), email: out.email, password: out.password,
          avatar: "stock:square_grey", country: "CL", friendsOnline: Math.floor(Math.random() * 8) } });
        await this._psnFinish(acct, out);
      },
      () => { form.close(); this.overlay = null; },
      (v) => { this._psnSignIn({ email: v.email || "", password: "" }); });
  },
  async _psnSignIn(prefill = null) {
    const form = this.psnSignInForm;
    this.overlay = form;
    form.open({ mode: "signin", ...this._psnFormValues(prefill || {}) },
      async (out) => {
        // the Sign-In ID is the e-mail address or the Online ID
        const id = out.email.toLowerCase();
        if (!(await this._psnWait("Signing in...\nPlease wait."))) { form._render(); return; }
        const psn = await call("list_psn_accounts");
        const acct = (psn.accounts || []).find((a) =>
          (String(a.email || "").toLowerCase() === id || String(a.onlineId || "").toLowerCase() === id) && a.password === out.password);
        if (!acct) {
          this._loadingQuit();
          form._render();
          return this._psnFormError("The Sign-In ID or password is incorrect.");
        }
        await this._psnFinish(acct, out);
      },
      () => { form.close(); this.overlay = null; },
      (v) => this._psnForgot(v.email));
  },
  // "Forgot your password?": set a new password for that Sign-In ID (e-mail or Online ID)
  async _psnForgot(email) {
    const psn = await call("list_psn_accounts");
    const id = String(email || "").toLowerCase();
    const acct = id && (psn.accounts || []).find((a) => String(a.email || "").toLowerCase() === id || String(a.onlineId || "").toLowerCase() === id);
    if (!acct) return this._psnFormError(id ? "There is no account with this Sign-In ID." : "Enter your Sign-In ID first.");
    const back = () => { this.overlay = this.psnSignInForm; this.psnSignInForm._render(); };
    this.overlay = this.textForm;
    this.textForm.open({ title: "Set a New Password", submit: "Confirm",
      fields: [{ key: "password", label: `New password for ${acct.email}`, type: "password", required: true }] },
      async (out) => {
        this.textForm.close();
        acct.password = out.password;
        await call("save_psn_account", { account: acct });
        this.psnSignInForm.v.password = ""; back();
      },
      () => { this.textForm.close(); back(); });
  },
  async _psnSignOut() {
    this.user.psnAccountId = null; await call("save_user", { user: this.user });
    this.cbs.onProfileChange(this.user); await this._reloadPsn();
  },
  async _psnEditId() {
    const psn = await call("list_psn_accounts");
    const acct = psn.accounts.find((a) => a.id === this.user.psnAccountId); if (!acct) return;
    this.overlay = this.textForm;
    this.textForm.open({ title: "Edit Online ID", submit: "Save", fields: [{ key: "onlineId", label: "Online ID", value: acct.onlineId, required: true, max: NAME_LIMIT }] },
      async (out) => { this.textForm.close(); this.overlay = null; await call("save_psn_account", { account: { ...acct, onlineId: [...String(out.onlineId).trim()].slice(0, NAME_LIMIT).join("") || acct.onlineId } }); await this._refreshFriendsCard(); this.cbs.onProfileChange(this.user); },
      () => { this.textForm.close(); this.overlay = null; });
  },
  // Account Management's options (Connect with Steam Friends on: the name, the
  // trophy level and the friends come from Steam, so their options aren't there)
  _acctMgmtItems() {
    const steam = this._steamOn && this._steamOn();
    return [
      ...(steam ? [] : [{ kind: "action", act: "psn_editid", title: "Edit Online ID", icon: { sys: "icon_accountmanage.png" } }]),
      { kind: "action", act: "psn_avatar", title: "Change Avatar", icon: { sys: "icon_accountmanage.png" } },
      ...(steam ? [] : [
        { kind: "action", act: "player_level", title: "Trophy Level", icon: { sys: "icon_accountmanage.png" },
          sub: "Set the trophy level shown on your own card." },
        { kind: "drill", title: "Friend Personalization", icon: { sys: "icon_friend.png" },
          sub: "Choose how many friends appear and design your own friend cards.",
          childrenFn: this._friendPersonalizationItems }]),
      // Connect with Steam Friends, Linked Accounts (steamfriends.js)
      ...this._acctItems(),
    ];
  },
  async _psnAvatar() {
    const psn = await call("list_psn_accounts");
    const acct = psn.accounts.find((a) => a.id === this.user.psnAccountId); if (!acct) return;
    this.overlay = this.avatarPicker;
    this.avatarPicker.open(acct.avatar, { set: "psn", steam: true }, async (ref) => {
      this.avatarPicker.close(); this.overlay = null;
      await call("save_psn_account", { account: { ...acct, avatar: ref } });
      await this._refreshFriendsCard();
      this._render(); this._onSelect();
      this.cbs.onProfileChange(this.user);
    }, () => { this.avatarPicker.close(); this.overlay = null; });
  },
  async _reloadPsn() {
    // (the PlayStation Network and Friends columns)
    if (!await this._replaceColumn("psn")) await this._buildColumns();
    else await this._replaceColumn("friends");
    this.selCat = this.columns.findIndex((c) => c.id === "psn");
    this.levels = [{ items: this.columns[this.selCat].items, sel: 0 }];
    this._render(); this._onSelect();
  },
};
