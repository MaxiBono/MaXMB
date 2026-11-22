// Auto-scrolling marquee for titles that are too long to show fully.
//
// Any element that is (a) tagged with class "mq", or (b) matches one of the
// AUTO selectors below, gets its text wrapped in a `.mq-inner` span. If that
// text overflows the element's box, it scrolls as the console's does: still
// for 2 s, then left until it has gone, then back at its start. Otherwise it
// stays put. A periodic scan
// re-measures after the app re-renders (which rebuilds the elements' innards).

const AUTO = [
  ".lp-label", ".lp-sub", // list-picker rows (bg music, playlists, add-to-playlist): name, artist / album
  ".mp2-title", ".mp2-artist", // music player now-playing
  ".mv-name",         // video viewer name
  ".vp-title",        // video player title (Display)
  ".mp-title",        // legacy music strip title
  ".osk-title",       // on-screen keyboard title
  ".br-name", ".br-url", // in-app browser: page title + address
  ".br-status",       // in-app browser: the address of the link under the pointer
];

function setup(el) {
  if (!el || !el.isConnected) return;
  // nothing changed since the last look (same text, same room, the text as wide as it was -- a
  // name that fits while its row isn't chosen is wider, and may not fit, once it is): skip it
  // (its text written anew -- the scrolling copy gone --: always looked at again, never taken
  // for "as before": a name written anew after each look would otherwise stay still for good)
  const txt = el.querySelector(":scope > .mq-inner > .mq-a");
  const sig = el.textContent + "|" + el.clientWidth + "|" + (txt ? txt.offsetWidth : -1);
  if (txt && el._mqSig === sig) return;
  el._mqSig = sig;
  let inner = el.querySelector(":scope > .mq-inner");
  if (!inner) {
    // move all current children into: inner > a (the text) [+ dup (its copy)]
    inner = document.createElement("span");
    inner.className = "mq-inner";
    const a = document.createElement("span");
    a.className = "mq-a";
    while (el.firstChild) a.appendChild(el.firstChild);
    inner.appendChild(a);
    el.appendChild(inner);
    el.classList.add("mq-box");
  }
  const a = inner.querySelector(":scope > .mq-a") || inner;
  // (the earlier full-lap copy, from before: not used any more)
  inner.querySelector(":scope > .mq-dup")?.remove();
  const cs = getComputedStyle(el);
  const inner_w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const overflow = a.offsetWidth - inner_w;
  if (overflow > 2 && inner_w > 0) {
    // As the console's (its capture, frame by frame): the name stays still for
    // 2 s, then moves left at a steady 89 px a second (on a 1080-line screen)
    // until its end has gone past the left edge, stays gone for about half a
    // second, comes back at its start with a short fade in, and so on.
    const run = a.offsetWidth + (parseFloat(cs.paddingLeft) || 0);
    const speed = 89 * (window.innerHeight || 1080) / 1080;
    if (inner._mqLap !== run || !inner._mqAnim) {
      if (inner._mqAnim) inner._mqAnim.cancel();
      const fade = 100, hold = 2000, travel = run / speed * 1000, gone = 470, dur = hold + travel + gone;
      inner._mqAnim = inner.animate([
        { transform: "translateX(0)", opacity: 0, offset: 0 },
        { transform: "translateX(0)", opacity: 1, offset: fade / dur },
        { transform: "translateX(0)", opacity: 1, offset: hold / dur },
        { transform: `translateX(${-run}px)`, opacity: 1, offset: (hold + travel) / dur },
        { transform: `translateX(${-run}px)`, opacity: 0, offset: 1 },
      // (the first time: already there, without the fade)
      ], { duration: dur, iterations: Infinity, easing: "linear", iterationStart: fade / dur });
      inner._mqLap = run;
    }
    if (!el.classList.contains("mq-run")) el.classList.add("mq-run");
  } else {
    if (inner._mqAnim) { inner._mqAnim.cancel(); inner._mqAnim = null; inner._mqLap = 0; }
    el.classList.remove("mq-run");
  }
}

export function scanMarquees(root = document) {
  const set = new Set();
  for (const sel of AUTO) root.querySelectorAll(sel).forEach((e) => set.add(e));
  root.querySelectorAll(".mq").forEach((e) => set.add(e));
  set.forEach(setup);
}

// Keep marquees in sync as the UI re-renders. A light periodic re-measure is
// simplest and robust (elements are rebuilt on navigation, dropping wrappers).
let _timer = null;
export function startMarquees() {
  if (_timer) return;
  // (not while the app is hidden, out of focus in low performance mode or a
  // game runs: nothing on screen changes then)
  const tick = () => {
    if (document.hidden || document.body.classList.contains("lowpower") || document.body.classList.contains("in-game")) return;
    try { scanMarquees(); } catch (_) {}
  };
  tick();
  _timer = setInterval(tick, 700);
  window.addEventListener("resize", tick);
}
