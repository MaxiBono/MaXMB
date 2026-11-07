// XMB: browser (the Xmb class's methods, from xmb.js; put on its prototype there)
import { Input, assetUrl, bumpAsset, call } from "./api.js";
import { OnScreenKeyboard, VIRTUAL_KB } from "./ui.js";
import { scanMarquees } from "./marquee.js";
import { winPath } from "./xmb-shared.js";

export const BrowserMethods = {
  // a browser button from the app's own controller reading (no native feed)
  browserButton(a) { if (this._browserActive && !this._brOskOpen) this._browserCtl().onInput(a); },
  // keyboard exit (Esc held while the page has focus), sent by the backend
  exitBrowser() { if (this._brOskOpen) return; this._closeBrowser(); },

  async _openInternet(mode, url = null) {
    // one browser at a time; ignore repeat presses while one is starting
    if (this._browserActive || this._browserBusy) return;
    this._browserBusy = true;
    this.audio.play("enter", 0.6);
    let status = null;
    try { status = await call("browser_status"); } catch (e) {}
    if (!status || !status.ready) {
      this._browserBusy = false;
      this.audio.play("error", 0.4);
      const dir = (status && status.browserDir) || "content\\Browser";
      this.overlay = this.confirm;
      this.confirm.open(
        `LibreWolf not found. Put the LibreWolf Portable folder (with LibreWolf\\librewolf.exe inside) into ${winPath(dir)}, then open the Internet Browser again.`,
        [{ label: "OK", id: "ok" }],
        () => { this.confirm.close(); this.overlay = null; this._render(); this._onSelect(); },
        () => { this.confirm.close(); this.overlay = null; this._render(); this._onSelect(); });
      return;
    }
    this._browserFirstRun = !status.installed;
    if (mode === "search") {
      const cancel = () => { this._browserBusy = false; this.overlay = null; this._render(); this._onSelect(); };
      this.overlay = this.textForm;
      this.textForm.open(
        { title: "Internet Search", fields: [{ key: "q", label: "Search" }], submit: "Search" },
        (out) => {
          this.textForm.close();
          const q = (out.q || "").trim();
          if (!q) { cancel(); return; }
          this._browserStart("search", q);      // runs on YOUR default search engine
        },
        () => { this.textForm.close(); cancel(); });
      return;
    }
    if (mode === "url") { this._browserStart("url", url); return; }   // (YouTube)
    this._browserStart("browser", null);       // your home page
  },

  // The page panel, as on the real PS3 browser (1920x1080 capture): x 412-1505,
  // y 76-1002, between the two grey bars. Physical px for the window, CSS px
  // for the helper.
  _browserScreenRect() {
    const dpr = window.devicePixelRatio || 1;
    const sw = window.innerWidth || screen.width;
    const sh = window.innerHeight || screen.height;
    const w = Math.round(sw * 1094 / 1920), h = Math.round(sh * 927 / 1080);
    const cx = (window.screenX || 0) + Math.round((sw - w) / 2);
    const cy = (window.screenY || 0) + Math.round(sh * 76 / 1080);
    return {
      x: Math.round(cx * dpr), y: Math.round(cy * dpr),
      w: Math.round(w * dpr), h: Math.round(h * dpr),
      cx, cy, cw: w, ch: h,
    };
  },

  // Show the browser screen IMMEDIATELY (the backdrop + a status line), then
  // start LibreWolf in the background. ○ cancels at any time.
  async _browserStart(mode, value) {
    this._browserActive = true;
    this._br = { phase: "", live: false, ready: false, closing: false, seq: null, oskClosedAt: 0,
                 crossPrev: false, down: false, accX: 0, accY: 0, nextScroll: 0, scrollHeld: false, url: "" };
    this._showBrowserChrome();
    this._browserSetCenter(true);          // spinning loader until the page is up
    this.overlay = this._browserCtl();
    this._brTimer = setInterval(() => this._browserPoll(), 200);
    const r = this._browserScreenRect();
    try {
      await call("browser_open", { mode, url: value, x: r.x, y: r.y, w: r.w, h: r.h,
                                   cx: r.cx, cy: r.cy, cw: r.cw, ch: r.ch });
    } catch (e) {
      if (this._browserActive && String(e) !== "cancelled") {
        this.audio.play("error", 0.4);
        this._closeBrowser(true);
      }
    } finally {
      this._browserBusy = false;
    }
  },

  async _browserPoll() {
    if (!this._browserActive || this._brPolling) return;
    this._brPolling = true;
    let st = null;
    try { st = await call("browser_state"); } catch (e) {}
    this._brPolling = false;
    const b = this._br;
    if (!st || !this._browserActive || !b) return;
    if (["starting", "updating", "downloading", "ready", "nohelper"].includes(st.phase)) b.live = true;
    if (st.phase !== b.phase && b.live) {
      b.phase = st.phase;
      switch (st.phase) {
        case "updating": case "downloading": this._browserSetCenter(true); break;
        case "ready": b.ready = true; this._browserSetCenter(false); this._browserSetNote(null); break;
        case "nohelper":
          b.ready = true;
          this._browserSetCenter(false);
          this._browserSetNote("The browser helper isn't active yet: close every LibreWolf window, then open the Internet Browser again.");
          break;
        case "failed": this.audio.play("error", 0.4); this._closeBrowser(true); return;
        case "closed": if (!b.closing) { this._closeBrowser(true); } return;   // closed from LibreWolf itself
      }
    }
    this._browserMeta(st);
    // a page text field got focus → on-screen keyboard (controller users)
    if (b.seq === null) b.seq = st.focusSeq;
    else if (st.focusSeq !== b.seq) {
      b.seq = st.focusSeq;
      if (st.focus && b.ready && !this._brOskOpen && Input.lastKind === "controller" && VIRTUAL_KB.on
          && Date.now() - b.oskClosedAt > 1200) {
        this._browserTypeField(st);
      }
    }
  },

  // Discrete buttons while the browser is up (the sticks and ✕ are fed
  // continuously from the gamepad loop via browserStick(); with the native
  // feed the backend handles them all itself, START aside).
  _browserCtl() {
    if (!this._browserCtlObj) {
      this._browserCtlObj = { onInput: (a) => {
        const b = this._br;
        if (!b || !b.ready) { if (a === "back") this._closeBrowser(); return; }   // (still loading)
        switch (a) {
          case "back": this._browserCmd("closetab"); break;      // ○: close this window
          case "start": this._browserAddress(false); break;      // enter an address
          case "l1": this._browserCmd("back"); break;
          case "r1": this._browserCmd("forward"); break;
          case "l2": this._browserCmd("prevtab"); break;
          case "r2": case "brnexttab": this._browserCmd("nexttab"); break;
          case "l3": this._browserCmd("fullscreen"); break;
        }
      } };
    }
    return this._browserCtlObj;
  },

  _browserCmd(cmd, value) { call("browser_cmd", { cmd, value: value ?? null }).catch(() => {}); },
  _browserInput({ dx = 0, dy = 0, button = null, scroll = 0 }) {
    call("browser_input", { dx, dy, button, scroll }).catch(() => {});
  },

  // Every animation frame from the gamepad loop (no native feed): the left
  // stick → pointer (with a response curve for precision), ✕ → button
  // down/up (so grabbing / dragging works), the right stick → scroll.
  browserStick(lx, ly, ry, cross) {
    const b = this._br;
    if (!this._browserActive || !b) return;
    if (!b.ready || this._brOskOpen) { b.crossPrev = true; b.accX = b.accY = b.accW = 0; return; }
    const dz = 0.16;
    const curve = (v) => {
      const a = Math.abs(v);
      if (a < dz) return 0;
      return Math.sign(v) * Math.pow((a - dz) / (1 - dz), 1.7);
    };
    const speed = 22 * (window.devicePixelRatio || 1);   // px per frame at full tilt
    b.accX += curve(lx) * speed;
    b.accY += curve(ly) * speed;
    const dx = Math.trunc(b.accX), dy = Math.trunc(b.accY);
    b.accX -= dx; b.accY -= dy;
    let button = null;
    // (only a press that started on the page: not the ✕ that closed the keyboard)
    if (cross && !b.crossPrev && !b.down) { button = "down"; b.down = true; }
    else if (!cross && b.down) { button = "up"; b.down = false; }
    b.crossPrev = cross;
    // wheel notches per frame, + = up
    b.accW = (b.accW || 0) - curve(ry) * 0.27;
    const scroll = Math.trunc(b.accW * 120) / 120;
    b.accW -= scroll;
    if (dx || dy || button || scroll) this._browserInput({ dx, dy, button, scroll });
  },

  // On-screen keyboard over the app: the browser window steps aside while it's
  // up (it's a separate, always-on-top window), then comes back.
  // (the page behind it as a picture, as when typing in a page: see _browserSnap)
  async _browserOsk(opts, onDone) {
    const b = this._br;
    if (!b || this._brOskOpen) return;
    if (b.down) { b.down = false; this._browserInput({ button: "up" }); }
    this._brOskOpen = true;
    const snap = await this._browserSnap(true);
    if (!this._browserActive || !this._brOskOpen) { snap.classList.remove("show", "under"); return; }
    call("browser_visible", { visible: false }).catch(() => {});
    this.overlay = this.textForm;
    const finish = (text) => {
      this.textForm.close();
      this._brOskOpen = false;
      b.oskClosedAt = Date.now();
      const hide = () => snap.classList.remove("show", "under");
      if (!this._browserActive) { hide(); return; }
      // (the picture goes once the window is back over it)
      call("browser_visible", { visible: true }).catch(() => {}).finally(() => setTimeout(hide, 250));
      this.overlay = this._browserCtl();
      if (text != null) onDone(text);
    };
    const field = { key: "v", label: opts.label, value: opts.value || "" };
    if (opts.password) field.type = "password";
    this.textForm.open({ title: opts.title, fields: [field], submit: opts.submit },
      (out) => finish(String(out.v ?? "")), () => finish(null));
  },
  // (the current page's full address already in it: edited, or cleared and typed anew)
  _browserAddress(edit) {
    const url = (this._br && this._br.url) || "";
    this._browserOsk({ title: edit ? "Edit Address" : "Enter Address", label: "Address", value: url, submit: "Go" },
      (t) => { if (t.trim()) this._browserCmd("navigate", t.trim()); });
  },
  _browserSearch() {
    this._browserOsk({ title: "Search", label: "Search", value: "", submit: "Search" },
      (t) => { if (t.trim()) this._browserCmd("search", t.trim()); });
  },
  // a page text field chosen with the controller: the on-screen keyboard
  // straight away, in front of the page (no "Enter Text" box first)
  _browserTypeField(st) {
    this._browserOskDirect({ title: "Enter Text", value: st.focusValue || "", password: !!st.focusPassword },
      (t) => call("browser_type", { text: t, replace: !!st.focusReplace, enter: true }).catch(() => {}));
  },
  // the page as a picture (taken now), shown in the browser window's place;
  // under: behind the Enter Address / Search box (in front of everything else
  // otherwise, behind the on-screen keyboard)
  async _browserSnap(under) {
    let snap = document.getElementById("browser-snap");
    if (!snap) { snap = document.createElement("img"); snap.id = "browser-snap"; snap.alt = ""; document.body.appendChild(snap); }
    snap.classList.toggle("under", !!under);
    try {
      const p = await call("browser_snapshot");
      bumpAsset(p); snap.src = assetUrl(p);
      await snap.decode().catch(() => {});
      snap.classList.add("show");
    } catch (e) {}
    return snap;
  },
  // The browser is a separate window over the app, so the page is kept as a
  // picture (taken the moment before) behind the keyboard while the window
  // steps aside; the window comes back over it when the keyboard closes.
  async _browserOskDirect({ title, value = "", password = false }, onDone) {
    const b = this._br;
    if (!b || this._brOskOpen) return;
    if (b.down) { b.down = false; this._browserInput({ button: "up" }); }
    this._brOskOpen = true;
    const snap = await this._browserSnap(false);
    if (!this._browserActive || !this._brOskOpen) { snap.classList.remove("show"); return; }
    call("browser_visible", { visible: false }).catch(() => {});
    const osk = this._brOsk || (this._brOsk = new OnScreenKeyboard(this.audio));
    this.overlay = osk;
    const finish = (text) => {
      osk.close();
      this._brOskOpen = false;
      b.oskClosedAt = Date.now();
      const hide = () => snap.classList.remove("show");
      if (!this._browserActive) { hide(); return; }
      // (the picture goes once the window is back over it)
      call("browser_visible", { visible: true }).catch(() => {}).finally(() => setTimeout(hide, 250));
      this.overlay = this._browserCtl();
      if (text != null) onDone(text);
    };
    this._brOskFinish = finish;
    osk.open(null, { title, initial: value, password }, (t) => finish(String(t ?? "")), () => finish(null));
  },

  // ---- the XMB chrome around the panel (as on the PS3 browser): a grey bar on
  // top with the www icon, page title and address, a grey bar at the bottom
  // with the hovered link, and the spinning loader while LibreWolf starts.
  // (The controls are listed in the Manual.)
  _showBrowserChrome() {
    const el = document.getElementById("browser");
    if (!el) return;
    el.innerHTML =
      `<div class="br-bar br-bar-top"></div><div class="br-bar br-bar-bot"></div>` +
      `<div class="br-top"><span class="br-www"></span>` +
      `<span class="br-name"></span><span class="br-url"></span></div>` +
      `<div class="br-note"></div><div class="br-status"></div>`;
    el.classList.add("show");
    document.body.classList.add("menu-open", "browser-open");
  },
  // loading: the clock at the top right turns as the loading icon (as on the
  // console's browser), over the browser screen's top and bottom bars
  _browserSetCenter(on) {
    document.body.classList.toggle("clock-loading", !!on && !!this._browserActive);
  },
  _browserSetNote(msg) {
    const n = document.querySelector("#browser .br-note");
    if (n) { n.textContent = msg || ""; n.classList.toggle("on", !!msg); }
  },
  _browserMeta(st) {
    const el = document.getElementById("browser");
    const b = this._br;
    if (!el || !b) return;
    const local = (u) => /^https?:\/\/127\.0\.0\.1:48219\//.test(u || "");
    const url = local(st.url) ? "" : (st.url || "");
    const title = local(st.url) ? "" : (st.title || "");
    b.url = url;
    // (compared with the text set last: a rotating title holds a copy of its
    // text, so setting it again every update kept it from ever moving)
    const set = (sel, txt) => {
      const n = el.querySelector(sel);
      if (n && n._txt !== txt) { n._txt = txt; n.textContent = txt; scanMarquees(el); }
    };
    set(".br-name", title);
    set(".br-url", url);
    set(".br-status", st.hover || "");   // (scrolls too when it's wider than the screen)
  },
  _hideBrowserChrome() {
    const el = document.getElementById("browser");
    if (el) { el.classList.remove("show"); el.innerHTML = ""; }
    document.body.classList.remove("menu-open", "browser-open", "clock-loading");
  },

  _closeBrowser(silent) {
    if (!this._browserActive) return;
    const b = this._br;
    if (b) {
      b.closing = true;
      if (b.down) this._browserInput({ button: "up" });
    }
    if (!silent) this.audio.play("back", 0.5);
    call("browser_close").catch(() => {});
    if (this._brTimer) { clearInterval(this._brTimer); this._brTimer = null; }
    if (this._brOskOpen) { this.textForm.close(); if (this._brOsk) this._brOsk.close(); this._brOskOpen = false; }
    document.getElementById("browser-snap")?.classList.remove("show");
    this._browserActive = false;
    this._browserBusy = false;
    this._br = null;
    this._hideBrowserChrome();
    this.overlay = null;
    this._render(); this._onSelect();
  },
};
