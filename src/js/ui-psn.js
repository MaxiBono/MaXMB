// PlayStation Network screens: Sign-In / Sign-Up and the profile card (ui.js gathers every ui-*.js)
import { gradeIcon } from "./tpop.js";
import { parseColor } from "./ui-color.js";
import { avatarFillStyle, avatarSrc, esc, isStockAvatar, spinAt } from "./ui-core.js";
import { OnScreenKeyboard, useOsk } from "./ui-text.js";

// ---------------------------------------------------- PSN Sign-In / Sign-Up screens
// Laid out from the console's Sign-In screen (1920x1080 captures): the two rules
// at 17.1 % / 82.1 %, the fields, the Auto-Sign-In / Save Password checkboxes,
// the buttons and the ✕ Enter / ○ Back hints under the bottom rule.
// Up / down moves; ✕ edits a field (on-screen keyboard with a controller,
// typing otherwise), ticks a box or presses a button; △ shows what the row does.
// Auto Sign-In ticks Save Password and greys it out (it can't be unticked then).
// loading(text) swaps the screen for "Signing in... / Please wait." with
// ○ Cancel (the clock at the top right is the XMB's loading clock).
const PS_CB = (on) => `./assets/icons/system/checkbox_${on ? "on" : "off"}.png`;
const PS_LAYOUT = {
  // label centres, field tops, checkbox centres, button tops (vh)
  signin: { lab: [32.96, 43.43], fld: [34.35, 44.81], chk: [51.94, 55.74], btn: [59.63, 67.31] },
  signup: { lab: [26.46, 36.93, 47.39], fld: [27.85, 38.31, 48.78], chk: [55.91, 59.71], btn: [63.6, 71.28] },
};
export class PsnSignIn {
  constructor(audio) { this.audio = audio; this.el = document.getElementById("form"); this.osk = new OnScreenKeyboard(audio); }
  // mode "signin": Sign-In ID (e-mail address or Online ID) + password,
  //   buttons Sign In / Forgot your password? (onAlt)
  // mode "signup": Online ID + Sign-In ID + password,
  //   buttons Sign Up / Sign In with an Existing Account (onAlt)
  open({ mode = "signin", onlineId = "", email = "", password = "", auto = false, save = false } = {}, onSubmit, onCancel, onAlt) {
    this.mode = mode;
    this.v = { onlineId, email, password, auto: !!auto, save: !!(save || auto) };
    this.onSubmit = onSubmit; this.onCancel = onCancel; this.onAlt = onAlt;
    this.fields = mode === "signup"
      ? [{ k: "onlineId", label: "Online ID", type: "text", max: 16 },
         { k: "email", label: "Sign-In ID (E-mail Address):", type: "email" },
         { k: "password", label: "Password", type: "password" }]
      : [{ k: "email", label: "Sign-In ID (E-mail Address):", type: "text" },
         { k: "password", label: "Password", type: "password" }];
    this.buttons = mode === "signup"
      ? [{ k: "go", label: "Sign Up" }, { k: "alt", label: "Sign In with an Existing Account" }]
      : [{ k: "go", label: "Sign In" }, { k: "alt", label: "Forgot your password?" }];
    this.rows = [...this.fields.map((f) => f.k), "auto", "save", "go", "alt"];
    // with everything filled in (Save Password) the cursor waits on Sign In
    const firstEmpty = this.fields.findIndex((f) => !this.v[f.k]);
    this.r = firstEmpty < 0 ? this.rows.indexOf("go") : firstEmpty;
    this._oskActive = false; this._loading = null;
    this._render();
  }
  _render() {
    const v = this.v, L = PS_LAYOUT[this.mode];
    this._loading = null; document.body.classList.remove("psn-loading");
    this.el.className = `form show psnsign ps-${this.mode}`; document.body.classList.add("menu-open");
    this.el.innerHTML = `
      <div class="ps-hold"></div>
      ${this.fields.map((f, i) => `
      <div class="ps-lab" style="top:${L.lab[i]}vh">${esc(f.label)}</div>
      <label class="ps-field" data-row="${f.k}" style="top:${L.fld[i]}vh"><input class="ps-in" data-k="${f.k}" type="${f.type}"${f.max ? ` maxlength="${f.max}"` : ""} spellcheck="false" autocomplete="off" value="${esc(v[f.k])}"></label>`).join("")}
      <div class="ps-check" data-row="auto" style="top:${L.chk[0]}vh"><img class="ps-box" alt="" src="${PS_CB(v.auto)}"><span>Sign In Automatically (Auto Sign-In)</span></div>
      <div class="ps-check${v.auto ? " dis" : ""}" data-row="save" style="top:${L.chk[1]}vh"><img class="ps-box" alt="" src="${PS_CB(v.save)}"><span>Save Password</span></div>
      ${this.buttons.map((b, i) => `<button class="ps-btn ps-b${i + 1}${b.k === "go" && !this._canGo() ? " off" : ""}" data-row="${b.k}" style="top:${L.btn[i]}vh">${esc(b.label)}</button>`).join("")}
      <div class="ps-foot"><span class="ps-hint ps-h1"><span class="ps-glyph">✕</span><span class="ps-act">Enter</span></span><span class="ps-hint ps-h2"><span class="ps-glyph">○</span>Back</span></div>`;
    this.el.querySelectorAll(".ps-in").forEach((inp) => {
      inp.addEventListener("input", () => { this.v[inp.dataset.k] = inp.value; this._syncBtn(); });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); inp.blur(); this._move(1); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); inp.blur(); }
        else e.stopPropagation();          // typing goes to the field, not the menu
      });
      inp.addEventListener("focus", () => { this.r = this.rows.indexOf(inp.dataset.k); this._focus(false); });
    });
    this.el.querySelectorAll("[data-row]").forEach((n) => n.addEventListener("pointerdown", (e) => {
      this.r = this.rows.indexOf(n.dataset.row); this._focus(false);
      if (n.tagName !== "LABEL") { e.preventDefault(); this._press(); }
    }));
    this._focus(false);
  }
  _canGo() { return this.fields.every((f) => String(this.v[f.k] || "").trim()); }
  _syncBtn() { const b = this.el.querySelector('[data-row="go"]'); if (b) b.classList.toggle("off", !this._canGo()); }
  _focus(sound = true) {
    const row = this.rows[this.r];
    this.el.querySelectorAll("[data-row]").forEach((n) => n.classList.toggle("sel", n.dataset.row === row));
    // ✕ Edit on a text field, ✕ Enter on a box or a button
    const act = this.el.querySelector(".ps-h1 .ps-act"); if (act) act.textContent = this.fields.some((f) => f.k === row) ? "Edit" : "Enter";
    // a greyed-out box can't be changed: no ✕ Enter on it
    // (✕ Enter stays shown on every row, the greyed Save Password too)
    if (sound) this.audio.play("cursor_down", 0.4);
  }
  _move(d) {
    const n = Math.max(0, Math.min(this.rows.length - 1, this.r + d));
    if (n !== this.r) { this.r = n; this._focus(); }
  }
  _hold() {
    const up = this.mode === "signup";
    const info = {
      onlineId: "Enter the Online ID (3 to 16 letters, numbers, hyphens or underscores) other players will see.",
      email: up ? "Enter the e-mail address to use as the Sign-In ID for this account."
                : "Enter the e-mail address you used to create your account, or its Online ID.",
      password: up ? "Enter a password for this account." : "Enter the password for your account.",
      auto: "Signs you in to PlayStation™Network automatically when this user logs in. Save Password is turned on too.",
      save: "Saves the Sign-In ID and password, so you only need to select Sign In next time.",
      go: up ? "Creates the account and signs in to PlayStation™Network." : "Signs in to PlayStation™Network.",
      alt: up ? "Sign in with an account that already exists." : "Set a new password for the account with the Sign-In ID entered above.",
    }[this.rows[this.r]];
    const t = this.el.querySelector(".ps-hold"); if (!t || !info) return;
    t.textContent = info; t.classList.add("on");
    clearTimeout(this._holdT);
    this._holdT = setTimeout(() => { if (t.isConnected) t.classList.remove("on"); }, 4000);
  }
  _setBox(row, on) {
    this.v[row] = on;
    const b = this.el.querySelector(`[data-row="${row}"] .ps-box`); if (b) b.src = PS_CB(on);
  }
  _press() {
    const row = this.rows[this.r];
    const fld = this.fields.find((f) => f.k === row);
    if (fld) {
      if (useOsk()) {
        this._oskActive = true;
        this.osk.open(this.el, { title: fld.label.replace(/:$/, ""), initial: this.v[row], password: fld.type === "password" },
          (text) => { this._oskActive = false; this.v[row] = fld.max ? text.slice(0, fld.max) : text; this._render(); if (text) this._move(1); },
          () => { this._oskActive = false; this._render(); });
      } else {
        const inp = this.el.querySelector(`.ps-in[data-k="${row}"]`); if (inp) inp.focus();
      }
      return;
    }
    if (row === "auto") {
      this.audio.play("enter", 0.4);
      this._setBox("auto", !this.v.auto);
      if (this.v.auto) this._setBox("save", true);       // Auto Sign-In needs the saved password
      this.el.querySelector('[data-row="save"]')?.classList.toggle("dis", this.v.auto);
      this._focus(false);
      return;
    }
    if (row === "save") {
      if (this.v.auto) { this.audio.play("error", 0.4); return; }   // greyed out
      this.audio.play("enter", 0.4); this._setBox("save", !this.v.save);
      return;
    }
    if (row === "go") {
      if (!this._canGo()) { this.audio.play("error", 0.4); return; }
      this.audio.play("enter", 0.6);
      const out = { ...this.v };
      for (const f of this.fields) if (f.type !== "password") out[f.k] = String(out[f.k]).trim();
      this.onSubmit && this.onSubmit(out);
      return;
    }
    if (row === "alt") { this.audio.play("enter", 0.5); this.onAlt && this.onAlt({ ...this.v, email: this.v.email.trim() }); }
  }
  // the "Signing in... / Please wait." screen; ○ cancels (onCancel)
  loading(text, onCancel) {
    this._oskActive = false; clearTimeout(this._holdT);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this._loading = { onCancel };
    this.el.className = "form show psnsign psload"; document.body.classList.add("menu-open", "psn-loading");
    this.el.innerHTML = `<div class="ps-wait">${String(text).split("\n").map((l) => `<div>${esc(l)}</div>`).join("")}</div>
      <div class="ps-foot"><span class="ps-hint ps-h2"><span class="ps-glyph">○</span>Cancel</span></div>`;
    this.el.querySelector(".ps-h2").addEventListener("pointerdown", () => this.onInput("back"));
  }
  close() {
    this._oskActive = false; this._loading = null; clearTimeout(this._holdT);
    this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open", "psn-loading");
  }
  onInput(a) {
    if (this._loading) {
      if (a === "back" && this._loading.onCancel) { const c = this._loading.onCancel; this._loading.onCancel = null; this.audio.play("back", 0.5); c(); }
      return;
    }
    if (this._oskActive) { this.osk.onInput(a); return; }
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("ps-in")) {
      const inp = document.activeElement;
      if (a === "enter") { inp.blur(); this._move(1); return; }
      if (a === "back") { inp.blur(); return; }
      if (a === "up" || a === "down") inp.blur(); else return;
    }
    switch (a) {
      case "up": this._move(-1); break;
      case "down": this._move(1); break;
      case "enter": this._press(); break;
      case "options": this._hold(); break;
      case "start": this.r = this.rows.indexOf("go"); this._focus(); this._press(); break;
      case "back": this.audio.play("back", 0.5); this.onCancel && this.onCancel(); break;
    }
  }
}

// ---------------------------------------------------- PSN profile card (Friends)
export class ProfileCard {
  // The user's own profile (✕ on the user's card in Friends; the console's
  // screen, measured on its captures 45D09CD2 / 420AD9EF / EA017303): the card
  // in its colour (avatar, comment bubble, Online ID) over three pages, L1 / R1
  // sliding between them: the last 8 trophies won (the newest on the left)
  // with the trophy level and the trophies; the trophies by grade; Online ID /
  // About Me / My Languages. Two parts can be chosen, and glow while chosen:
  // the colour icon left of the card (✕ the colours, △ a custom colour) and
  // the comment bubble (✕: the Comment form, the system's own text form).
  constructor(sfx) { this.sfx = sfx; this.el = document.getElementById("form"); }
  // editComment(current, done(text | null)): the system's text form (xmb-psn.js)
  open(account, { colors, onChange, level = 1, colorPicker = null, pct = 0, recent = [], counts = {}, total = 0, editComment = null, loading = false }, onClose) {
    this.account = account; this.onChange = onChange; this.onClose = onClose;
    this.cp = colorPicker; this.baseColors = colors; this.editComment = editComment;
    this.level = level; this.pct = pct; this.recent = recent; this.counts = counts; this.total = total; this.loading = !!loading;
    this.page = 0; this._lastPage = null; this.focus = "bubble"; this.mode = "card"; this._glowOf = null;
    this.pi = Math.max(0, colors.findIndex((c) => c.hex.toLowerCase() === String(account.background).toLowerCase()));
    this._show(); this._render();
  }
  _show() { document.body.classList.add("menu-open"); this.el.className = "form show pp"; }
  get isOpen() { return this.el.classList.contains("pp") && this.el.classList.contains("show"); }
  // the trophies read meanwhile (a sync finished, a picture fetched): shown at once
  setTrophies({ level, pct, recent, counts, total, loading }) {
    if (!this.isOpen) return;
    const sig = JSON.stringify([level, pct, recent, counts, total, !!loading]);
    if (sig === this._tSig) return;
    this._tSig = sig;
    if (level != null) this.level = level;
    this.pct = pct; this.recent = recent || []; this.counts = counts || {}; this.total = total || 0; this.loading = !!loading;
    if (!(this.cp && this.cp.isOpen)) this._render();
  }
  close() { this.el.className = "form"; this.el.innerHTML = ""; document.body.classList.remove("menu-open"); this.onClose && this.onClose(); }
  _card() {
    const a = this.account, bg = a.background || "#868485";
    const on = (k) => (this.focus === k && this.mode === "card" ? " pp-on" : "");
    // (8 places: the trophies won, then the empty ones' mark)
    const slots = [...this.recent.slice(0, 8)]; while (slots.length < 8) slots.push(null);
    const page1 = `<div class="pp-page pp-p1">
        <div class="pp-recent">${slots.map((t) => `<div class="pp-rt">${t ? `<img src="${t}" alt="">`
          // (no trophy there: the still mark; one whose picture isn't there yet, or the trophies still being read: turning)
          : `<img class="pp-none${t === "" || this.loading ? " pp-spin" : ""}" style="${spinAt()}" src="./assets/icons/system/loading_icon.png" alt="">`}</div>`).join("")}</div>
        <div class="pp-bar" style="top:calc(142 * var(--tu))"><span class="pp-tx" style="left:calc(27 * var(--tu))">Level</span><span class="pp-tx" style="left:calc(409 * var(--tu))">Trophies</span></div>
        <img class="pp-star" src="./assets/icons/system/trophy_level.png" alt="">
        <span class="pp-tx pp-big pp-lv">${this.level}</span><span class="pp-tx pp-pct">${this.pct}%</span>
        <div class="mp2-bar pp-lbar"><div class="mp2-fill pp-lfill" style="width:${this.pct}%"></div></div>
        <span class="pp-tx pp-big pp-tot">${this.total}</span></div>`;
    const G = [["P", "Platinum"], ["G", "Gold"], ["S", "Silver"], ["B", "Bronze"]];
    // (the steps: one shape, its outer corners rounded, lit along each tread)
    const R = 5, steps = `M0 276H${369 - 0}V${216 + R}Q369 216 ${369 + R} 216H474V${156 + R}Q474 156 ${474 + R} 156H579V${96 + R}Q579 96 ${579 + R} 96H784V286H0Z`;
    const page2 = `<div class="pp-page pp-p2">
        ${G.map(([k, n], i) => `<div class="pp-grow" style="top:calc(${48 + i * 60} * var(--tu))"><span class="pp-tx">${n}</span></div>`).join("")}
        <svg class="pp-steps" viewBox="0 0 784 286" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="ppStG" gradientUnits="userSpaceOnUse" x1="0" y1="98" x2="0" y2="285"><stop offset="0" stop-color="#b3b3b3"/><stop offset="1" stop-color="#696969"/></linearGradient>
            <clipPath id="ppStC"><path d="${steps}"/></clipPath></defs>
          <path d="${steps}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="2.4" stroke-linejoin="round"/>
          <path d="${steps}" fill="url(#ppStG)"/>
          <g clip-path="url(#ppStC)" fill="none">
            <path d="${steps}" stroke="rgba(255,255,255,0.13)" stroke-width="2.4"/>
            <path d="M${579 + R} 98.2H784M${474 + R} 158.2H579M${369 + R} 218.2H474M0 278.2H369" stroke="rgba(255,255,255,0.3)" stroke-width="2.6"/>
          </g></svg>
        ${G.map(([k], i) => `<img class="pp-gic" src="${gradeIcon(k)}" alt="" style="left:calc(${612.5 - i * 105.3} * var(--tu));top:calc(${34 + i * 60.3} * var(--tu))">`
          + `<span class="pp-tx pp-gn${i ? " pp-in" : ""}" style="left:calc(${696 - i * 104.7} * var(--tu));top:calc(${67 + i * 60} * var(--tu))">${this.counts[k] || 0}</span>`).join("")}
        <span class="pp-tx pp-gtot">${this.total}</span></div>`;
    const rows = [["Online ID", a.onlineId || ""], ["About Me", a.aboutMe || "-"], ["My Languages", a.languages || "English (United States)"]];
    const page3 = `<div class="pp-page pp-p3">${rows.map(([k, v], i) => `<div class="pp-bar" style="top:calc(${28 + i * 66} * var(--tu))"><span class="pp-tx" style="left:calc(27 * var(--tu))">${esc(k)}</span></div>`
        + `<span class="pp-tx pp-iv" style="top:calc(${80.5 + i * 66} * var(--tu))">${esc(v)}</span>`).join("")}
        <div class="pp-ie"></div></div>`;
    const comment = a.comment || "";
    // (the chosen part's light goes on from where it was when the card is drawn again -- another
    // page, the colours closed -- and starts anew only when another part is chosen)
    if (this._glowOf !== this.focus) { this._glowOf = this.focus; this._glowT0 = performance.now(); }
    const glowAt = -Math.round((performance.now() - this._glowT0) % 1700);
    return `<div class="pp-card" style="--card-bg:${bg};--ppd:${glowAt}ms">
      ${on("colors") ? `<div class="pp-cglow"></div>` : ""}<div class="pp-colors${on("colors")}"><i></i><i></i><i></i><i></i></div>
      <div class="pp-bg"></div>
      <div class="pp-av"><img class="${isStockAvatar(a.avatar) ? "fc-stock" : ""}" style="${avatarFillStyle(avatarSrc(a.avatar))}" src="${avatarSrc(a.avatar)}" alt=""><div class="fc-glass"></div></div>
      ${comment || this.focus === "bubble" ? `<div class="pp-bub${on("bubble")}"><div class="pp-msg${comment ? "" : " pp-empty"}"><span>${esc(comment || "Comment")}</span></div><i class="pp-tail"></i></div>` : ""}
      <div class="pp-name"><span class="pp-dot"></span><span class="pp-tx">${esc(a.onlineId || "")}</span></div>
      <div class="pp-panel">
        <div class="pp-tabs">${this.page > 0 ? `<span class="pp-l1"><img src="./assets/icons/system/arrow_left.png" alt="">L1</span>` : ""}
          <span class="pp-dots">${[0, 1, 2].map((i) => `<i class="${i === this.page ? "on" : ""}"></i>`).join("")}</span>
          ${this.page < 2 ? `<span class="pp-r1">R1<img src="./assets/icons/system/tex_arrow_r.png" alt=""></span>` : ""}</div>
        <div class="pp-view"><div class="pp-pages" style="transform:translateX(${-this.page * 100}%)">${page1}${page2}${page3}</div></div>
        <div class="pp-inset"></div>
      </div>
    </div>`;
  }
  _render() {
    const pal = this.mode === "palette";
    this.el.innerHTML = `<div class="pp-wrap">
      ${pal ? `<div class="pp-pal">${this.baseColors.map((c, i) => `<i class="${i === this.pi ? "on" : ""}" data-i="${i}" style="--sw:${c.hex}"></i>`).join("")}</div>` : ""}
      ${this._card()}</div>
      <div class="pp-foot"><span data-a="enter"><span class="cf-glyph">✕</span>Enter</span><span data-a="back"><span class="cf-glyph">○</span>Back</span></div>`;
    const pages = this.el.querySelector(".pp-pages");
    if (pages && this._lastPage != null && this._lastPage !== this.page) {
      // (sliding from the page before to this one)
      pages.style.transition = "none"; pages.style.transform = `translateX(${-this._lastPage * 100}%)`;
      void pages.offsetWidth; pages.style.transition = ""; pages.style.transform = `translateX(${-this.page * 100}%)`;
    }
    this._lastPage = this.page;
    this.el.querySelectorAll(".pp-foot [data-a]").forEach((n) => n.addEventListener("click", () => this.onInput(n.dataset.a)));
    this.el.querySelectorAll(".pp-pal i").forEach((n) => n.addEventListener("click", () => { this.pi = +n.dataset.i; this._palPreview(); this.onInput("enter"); }));
    const cl = this.el.querySelector(".pp-colors"); if (cl) cl.addEventListener("click", () => { this.focus = "colors"; this.onInput("enter"); });
    const bu = this.el.querySelector(".pp-msg"); if (bu) bu.addEventListener("click", () => { this.focus = "bubble"; this.onInput("enter"); });
  }
  _palPreview() {
    this.account.background = this.baseColors[this.pi].hex;
    const c = this.el.querySelector(".pp-card");
    if (c) c.style.setProperty("--card-bg", this.account.background);
    this.el.querySelectorAll(".pp-pal i").forEach((n, i) => n.classList.toggle("on", i === this.pi));
  }
  onInput(action) {
    if (this.cp && this.cp.isOpen) { this.cp.onInput(action); return; }
    if (this.mode === "palette") {
      const n = this.baseColors.length, cols = 5;
      let i = this.pi;
      if (action === "left" && i % cols > 0) i--; else if (action === "right" && i % cols < cols - 1 && i + 1 < n) i++;
      else if (action === "up" && i - cols >= 0) i -= cols; else if (action === "down" && i + cols < n) i += cols;
      if (i !== this.pi) { this.pi = i; this.sfx.play("cursor_up", 0.4); this._palPreview(); return; }
      if (action === "enter") { this.sfx.play("enter", 0.5); this.onChange && this.onChange(this.account); this.mode = "card"; this._render(); }
      else if (action === "back") { this.sfx.play("back", 0.5); this.account.background = this._palPrev; this.mode = "card"; this._render(); }
      return;
    }
    if (action === "l1" || action === "r1") {
      const p = Math.max(0, Math.min(2, this.page + (action === "r1" ? 1 : -1)));
      if (p !== this.page) { this.page = p; this.sfx.play("cursor_up", 0.4); this._render(); }
      return;
    }
    if (action === "left" || action === "down") { if (this.focus !== "colors") { this.focus = "colors"; this.sfx.play("cursor_up", 0.4); this._render(); } return; }
    if (action === "right" || action === "up") { if (this.focus !== "bubble") { this.focus = "bubble"; this.sfx.play("cursor_up", 0.4); this._render(); } return; }
    if (action === "back") { this.sfx.play("back", 0.5); this.close(); return; }
    if (action !== "enter" && action !== "options") return;
    if (this.focus === "bubble") {
      if (action !== "enter" || !this.editComment) return;
      // ✕ on the bubble: the Comment form (the system's text form), then back here
      this.sfx.play("enter", 0.5);
      this.editComment(this.account.comment || "", (text) => {
        if (text != null) { this.account.comment = String(text).trim(); this.onChange && this.onChange(this.account); }
        this._show(); this._render();
      });
      return;
    }
    if (action === "enter") {
      // ✕ on the colour icon: the colours (the card takes each one as it's chosen)
      this.sfx.play("enter", 0.5); this._palPrev = this.account.background; this.mode = "palette";
      const hit = this.baseColors.findIndex((c) => c.hex.toLowerCase() === String(this.account.background).toLowerCase());
      this.pi = hit >= 0 ? hit : 0; this._render(); return;
    }
    if (!this.cp) return;
    // △ on the colour icon: a custom colour (the colour wheel)
    const prev = this.account.background;
    this.sfx.play("enter", 0.5);
    this.cp.open({ title: "Card Background: Custom Color", value: parseColor(prev) ? prev : "#868485",
      onPreview: (hex) => { const c = this.el.querySelector(".pp-card"); if (c) c.style.setProperty("--card-bg", hex); } },
      (hex) => { this.account.background = hex; this._show(); this._render(); this.onChange && this.onChange(this.account); },
      () => { this.account.background = prev; this._show(); this._render(); });
  }
}
