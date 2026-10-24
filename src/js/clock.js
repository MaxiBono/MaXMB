// Top-right info rectangle: a fixed-size white outline, open on the right. It
// always contains a reserved area for the PSN avatar + friends-online count on
// the left (kept clear when not signed in, so the rectangle length never
// changes), then the date and time (same size) and the analog clock.

import { avatarSrc } from "./ui.js";

export class InfoBox {
  constructor(el) {
    this.el = el; this.avatar = null; this.friends = 0; this.plus = false; this.timeFormat = "24";
    this.dateFormat = "DD/MM/YYYY";
    this._build(); this._tick(); setInterval(() => this._tick(), 10000);
  }
  setTimeFormat(fmt) { this.timeFormat = fmt === "12" ? "12" : "24"; this._tick(); }
  setDateFormat(fmt) { this.dateFormat = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD"].includes(fmt) ? fmt : "DD/MM/YYYY"; this._tick(); }
  setProfile({ avatar, friends, plus, mail } = {}) {
    if (mail !== undefined) this.mail = !!mail;
    if (avatar !== undefined) this.avatar = avatar;
    if (plus !== undefined) this.plus = !!plus;
    if (friends !== undefined) this.friends = friends;
    this._render();
  }
  _build() {
    this.el.innerHTML = `
      <div class="ib-box">
        <div class="ib-profile">
          <img class="ib-plus" src="./assets/icons/system/ps_plus.png" alt="">
          <img class="ib-avatar" alt="">
          <span class="ib-friends"><span class="ib-dot"></span><span class="ib-count">0</span></span>
          <img class="ib-mail" src="./assets/icons/theme/icon_mbox.png" alt="">
        </div>
        <span class="ib-dt"><span class="ib-date"></span><span class="ib-time"></span></span>
        <svg class="ib-clock" viewBox="0 0 40 40" width="26" height="26">
          <circle cx="20" cy="20" r="17.5" fill="none" stroke="currentColor" stroke-width="3.6"/>
          <line class="ib-hour" x1="20" y1="20" x2="20" y2="11" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>
          <line class="ib-min"  x1="20" y1="20" x2="20" y2="8"  stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        </svg>
      </div>`;
    this.$ = {
      avatar: this.el.querySelector(".ib-avatar"),
      count: this.el.querySelector(".ib-count"),
      date: this.el.querySelector(".ib-date"),
      time: this.el.querySelector(".ib-time"),
      hour: this.el.querySelector(".ib-hour"),
      min: this.el.querySelector(".ib-min"),
      profile: this.el.querySelector(".ib-profile"),
      plus: this.el.querySelector(".ib-plus"),
      mail: this.el.querySelector(".ib-mail"),
    };
    this._render();
  }
  _render() {
    // visibility (not display) so the reserved space: and box length: stay put
    if (this.avatar) { this.$.avatar.src = avatarSrc(this.avatar); this.$.profile.classList.remove("ib-hide"); }
    else this.$.profile.classList.add("ib-hide");
    this.$.count.textContent = String(this.friends);
    this.$.plus.classList.toggle("on", this.plus);
    this.$.mail.classList.toggle("on", !!this.mail);
  }
  _tick() {
    const d = new Date();
    // compact rectangle format: day + month only, month single-digit, NO year.
    // The Date Format setting only reorders day vs month here (its full phrases
    // are just the option labels, not applied literally to the rectangle).
    const dd = String(d.getDate());              // single digit when < 10 (2/10)
    const mo = d.getMonth() + 1; // single digit when < 10
    this.$.date.textContent = this.dateFormat === "MM/DD/YYYY" ? `${mo}/${dd}` : `${dd}/${mo}`;
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (this.timeFormat === "12") {
      const h = d.getHours(); const h12 = h % 12 === 0 ? 12 : h % 12;
      this.$.time.textContent = `${h12}:${mm} ${h < 12 ? "AM" : "PM"}`;
    } else {
      this.$.time.textContent = `${d.getHours()}:${mm}`;
    }
    if (!this._spin) { const a = this._angles(); this._setHands(a.h, a.m); }
  }
  _angles() {
    const d = new Date();
    return { m: (d.getMinutes() + d.getSeconds() / 60) * 6, h: ((d.getHours() % 12) + d.getMinutes() / 60) * 30 };
  }
  _setHands(h, m) {
    this.$.min.setAttribute("transform", `rotate(${m % 360} 20 20)`);
    this.$.hour.setAttribute("transform", `rotate(${h % 360} 20 20)`);
  }
  // Loading: both hands sweep quickly clockwise until stopSpin(), which brings
  // them smoothly round to the real time (the returned promise resolves then).
  startSpin() {
    if (this._spin && !this._spin.stopping) return;   // (a new spin takes over one still settling)
    const a = this._angles();
    const S = this._spin = { h: a.h, m: a.m, last: performance.now(), raf: 0 };
    const step = (now) => {
      if (this._spin !== S || S.stopping) return;
      const dt = Math.min(0.1, (now - S.last) / 1000); S.last = now;
      S.m += dt * 540; S.h += dt * 120;
      this._setHands(S.h, S.m);
      S.raf = requestAnimationFrame(step);
    };
    S.raf = requestAnimationFrame(step);
  }
  stopSpin() {
    const S = this._spin;
    if (!S) return Promise.resolve();
    S.stopping = true; cancelAnimationFrame(S.raf);
    const t = this._angles();
    // keep going clockwise to the real time (at least a little further)
    const to = (cur, real) => { let x = cur + ((real - cur) % 360 + 360) % 360; if (x - cur < 60) x += 360; return x; };
    const h0 = S.h, m0 = S.m, h1 = to(S.h, t.h), m1 = to(S.m, t.m);
    const dur = 900, t0 = performance.now();
    return new Promise((res) => {
      const step = (now) => {
        if (this._spin !== S) { res(); return; }
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        this._setHands(h0 + (h1 - h0) * e, m0 + (m1 - m0) * e);
        if (k < 1) requestAnimationFrame(step);
        else { this._spin = null; this._tick(); res(); }
      };
      requestAnimationFrame(step);
    });
  }
}
