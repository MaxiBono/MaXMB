// Auto-scrolling marquee for titles that are too long to show fully.
//
// Any element that is (a) tagged with class "mq", or (b) matches one of the
// AUTO selectors below, gets its text wrapped in a `.mq-inner` span. If that
// text overflows the element's box, the text scrolls left in full laps: a
// copy follows it after a gap, so once the end has passed the start comes back
// in from the right (no ping-pong back). Otherwise it stays put. A periodic scan
// re-measures after the app re-renders (which rebuilds the elements' innards).

const AUTO = [
  ".lp-label",        // list-picker rows (bg music, playlists, add-to-playlist)
  ".mp2-title", ".mp2-artist", // music player now-playing
  ".mv-name",         // video viewer name
  ".vp-title",        // video player title (Display)
  ".mp-title",        // legacy music strip title
  ".osk-title",       // on-screen keyboard title
  ".br-name", ".br-url", // in-app browser: page title + address
];

const GAP = 64;   // px between the end of the text and its copy

function setup(el) {
  if (!el || !el.isConnected) return;
  // nothing changed since the last look (same text, same width): skip it
  const sig = el.textContent + "|" + el.clientWidth;
  if (el._mqSig === sig) return;
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
  let dup = inner.querySelector(":scope > .mq-dup");
  const cs = getComputedStyle(el);
  const inner_w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const overflow = a.offsetWidth - inner_w;
  if (overflow > 2 && inner_w > 0) {
    if (!dup) {
      dup = document.createElement("span");
      dup.className = "mq-dup"; dup.setAttribute("aria-hidden", "true");
      dup.style.paddingLeft = `${GAP}px`;
      inner.appendChild(dup);
    }
    if (dup.innerHTML !== a.innerHTML) dup.innerHTML = a.innerHTML;
    const lap = a.offsetWidth + GAP;
    // slow, readable pace (~40 px/s) with a 1.6 s hold at the start of each lap
    if (inner._mqLap !== lap || !inner._mqAnim) {
      if (inner._mqAnim) inner._mqAnim.cancel();
      const hold = 1600, travel = lap / 40 * 1000, dur = hold + travel;
      inner._mqAnim = inner.animate([
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: hold / dur },
        { transform: `translateX(${-lap}px)`, offset: 1 },
      ], { duration: dur, iterations: Infinity, easing: "linear" });
      inner._mqLap = lap;
    }
    if (!el.classList.contains("mq-run")) el.classList.add("mq-run");
  } else {
    if (dup) dup.remove();
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
