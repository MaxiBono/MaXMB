// Boot intro, measured frame by frame from a 1080p / 60 fps capture of the
// console's start-up (PlayStation 3 Slim Startup 2007), counted from the
// moment the boot sound starts:
//   0.0 - 1.7 s  black; only the wave, grey, lighting up (brighter than it
//                ever is in the menu by 1.7 s)
//   1.7 s        the PS mark starts to fade in; the background's colour
//                starts to come up behind the wave
//   2.0 - 2.6 s  "PS3" fades in from left to right (P, then S, then 3);
//                "PlayStation 3" below it from 2.45 s
//   2.6 - 4.1 s  the logo held while everything keeps getting brighter
//   4.1 - 5.2 s  the logo fades out (the PS mark and the "3" first)
//   5.7 s        the brightest moment: about 2.6 x the menu's own brightness
//   5.8 - 6.6 s  down to (just under) the menu's brightness
//   7.4 s        the menu comes in (the clock and the icons, 0.4 s fade)
//   7.7 s        the background settled at its normal brightness
// Each curve below is the measured value at that moment (1 = as in the menu).
// The background behind the wave is dimmed inside the wave's own drawing
// (wavegl.js setIntroBg), so the wave can show on black first; the rest is a
// filter on the background layers. Skippable (any key / click).
import { setIntroBg } from "./wavegl.js";

export const INTRO_MS = 7400;
const MARK = "./assets/icons/system/ps_logo.svg";
const WORD = "./assets/icons/system/ps3_logo.png";

// [seconds, value] — straight lines between the points
const BG = [[0, 0], [1.70, 0], [1.82, 0.05], [2.02, 0.15], [2.22, 0.26], [2.42, 0.38], [2.62, 0.48], [2.82, 0.61],
  [3.02, 0.80], [3.22, 0.95], [3.42, 1.10], [3.62, 1.28], [3.82, 1.43], [4.03, 1.56], [4.23, 1.72], [4.43, 1.86],
  [4.63, 1.99], [4.83, 2.16], [5.03, 2.28], [5.23, 2.41], [5.43, 2.50], [5.63, 2.61], [5.73, 2.63], [5.83, 2.55],
  [5.93, 2.38], [6.03, 2.15], [6.13, 1.88], [6.23, 1.59], [6.33, 1.35], [6.43, 1.10], [6.53, 0.94], [6.63, 0.90],
  [7.03, 0.90], [7.33, 0.93], [7.53, 0.97], [7.73, 1]];
// (the wave's brightest pixels, against the menu's own: 1.34 x by 1.7 s, on black)
const WAVE = [[0, 0], [0.12, 0.03], [0.22, 0.12], [0.32, 0.24], [0.42, 0.32], [0.52, 0.44], [0.62, 0.53], [0.72, 0.59],
  [0.82, 0.69], [0.92, 0.8], [1.02, 0.88], [1.12, 0.97], [1.22, 1.05], [1.32, 1.1], [1.42, 1.15], [1.52, 1.22],
  [1.62, 1.25], [1.72, 1.34], [2.62, 1.36], [2.82, 1.56], [3.02, 1.76], [3.22, 1.88], [3.42, 1.98], [3.62, 2.12],
  [3.82, 2.17], [4.03, 2.29], [4.23, 2.46], [4.43, 2.5], [4.63, 2.54], [4.83, 2.61], [5.03, 2.69], [5.23, 2.76],
  [5.43, 2.86], [5.63, 2.93], [5.73, 2.93], [5.83, 2.8], [5.93, 2.58], [6.03, 2.29], [6.13, 2.02], [6.23, 1.68],
  [6.33, 1.46], [6.43, 1.22], [6.53, 1.08], [6.63, 1.0], [7.73, 1]];
// the wave is grey at first and takes its colour as the background comes up
const WAVE_SAT = [[0, 0], [0.5, 0], [1.2, 0.3], [1.9, 0.4], [2.4, 0.5], [3.2, 0.75], [4.4, 0.85], [5.8, 0.85], [6.6, 1]];
const BG_SAT = [[0, 1], [4.0, 1], [4.6, 0.85], [5.8, 0.85], [6.6, 1]];
const END = 7.73;
const PEAK = 2.63;   // (the console's purple at its brightest)
// the logo, part by part (opacity)
const MARK_A = [[0, 0], [1.70, 0], [1.82, 0.04], [1.86, 0.05], [1.92, 0.1], [1.99, 0.17], [2.06, 0.26], [2.12, 0.34],
  [2.19, 0.39], [2.26, 0.42], [2.32, 0.45], [2.39, 0.49], [2.42, 0.52], [2.46, 0.6], [2.49, 0.68], [2.56, 0.82],
  [2.59, 0.92], [2.66, 0.93], [2.72, 0.96], [2.79, 0.98], [2.86, 0.99], [3.0, 1], [4.09, 1], [4.12, 0.99],
  [4.16, 0.98], [4.19, 0.95], [4.23, 0.91], [4.26, 0.85], [4.29, 0.8], [4.33, 0.72], [4.36, 0.66], [4.39, 0.6],
  [4.43, 0.48], [4.46, 0.44], [4.49, 0.38], [4.53, 0.32], [4.56, 0.28], [4.59, 0.23], [4.63, 0.18], [4.66, 0.17],
  [4.69, 0.15], [4.73, 0.13], [4.76, 0.11], [4.81, 0.07], [4.86, 0.06], [4.91, 0.05], [4.96, 0.04], [5.01, 0.02],
  [5.11, 0.01], [5.16, 0]];
const P_A = [[0, 0], [1.92, 0], [1.99, 0.04], [2.06, 0.06], [2.12, 0.1], [2.16, 0.13], [2.19, 0.19], [2.22, 0.25],
  [2.26, 0.31], [2.29, 0.37], [2.32, 0.48], [2.36, 0.61], [2.39, 0.72], [2.42, 0.82], [2.46, 0.9], [2.49, 0.95],
  [2.56, 0.98], [2.66, 0.99], [3.0, 1], [4.23, 1], [4.29, 0.98], [4.33, 0.95], [4.36, 0.92], [4.39, 0.89],
  [4.43, 0.84], [4.46, 0.77], [4.49, 0.67], [4.53, 0.59], [4.56, 0.52], [4.59, 0.43], [4.63, 0.33], [4.66, 0.27],
  [4.69, 0.23], [4.73, 0.19], [4.76, 0.15], [4.81, 0.12], [4.86, 0.09], [4.91, 0.06], [4.96, 0.05], [5.01, 0.04],
  [5.06, 0.02], [5.11, 0.01], [5.16, 0]];
const S_A = [[0, 0], [1.96, 0], [1.99, 0.02], [2.12, 0.04], [2.16, 0.06], [2.19, 0.08], [2.22, 0.11], [2.26, 0.13],
  [2.29, 0.16], [2.32, 0.24], [2.36, 0.31], [2.39, 0.42], [2.42, 0.55], [2.46, 0.71], [2.49, 0.86], [2.56, 0.98],
  [2.66, 0.98], [3.0, 1], [4.26, 1], [4.29, 0.99], [4.33, 0.96], [4.39, 0.93], [4.43, 0.89], [4.46, 0.84],
  [4.49, 0.76], [4.53, 0.69], [4.56, 0.63], [4.59, 0.55], [4.63, 0.45], [4.66, 0.37], [4.69, 0.32], [4.73, 0.26],
  [4.76, 0.21], [4.81, 0.13], [4.86, 0.08], [4.91, 0.05], [4.96, 0.04], [5.01, 0.03], [5.16, 0]];
const T_A = [[0, 0], [2.09, 0], [2.12, 0.02], [2.19, 0.03], [2.22, 0.05], [2.29, 0.06], [2.32, 0.12], [2.36, 0.16],
  [2.39, 0.22], [2.42, 0.29], [2.46, 0.41], [2.49, 0.57], [2.56, 0.8], [2.59, 0.95], [2.69, 0.96], [3.0, 1],
  [4.05, 1], [4.09, 0.97], [4.16, 0.95], [4.23, 0.93], [4.26, 0.9], [4.29, 0.86], [4.33, 0.79], [4.36, 0.74],
  [4.39, 0.71], [4.43, 0.64], [4.46, 0.61], [4.49, 0.55], [4.53, 0.5], [4.56, 0.48], [4.59, 0.45], [4.63, 0.4],
  [4.66, 0.36], [4.69, 0.34], [4.73, 0.3], [4.76, 0.27], [4.81, 0.2], [4.86, 0.15], [4.91, 0.09], [4.96, 0.07],
  [5.01, 0.05], [5.06, 0.03], [5.1, 0.02], [5.36, 0.02], [5.41, 0]];
const SUB_A = [[0, 0], [2.45, 0], [2.49, 0.07], [2.56, 0.18], [2.59, 0.26], [2.66, 0.39], [2.72, 0.48], [2.79, 0.57],
  [2.86, 0.64], [2.92, 0.69], [3.0, 0.71], [3.4, 0.72], [3.49, 0.79], [3.56, 0.87], [3.6, 0.92], [3.86, 0.95],
  [3.96, 0.99], [4.0, 1], [4.2, 1], [4.23, 0.99], [4.26, 0.95], [4.29, 0.94], [4.33, 0.87], [4.36, 0.79],
  [4.39, 0.77], [4.43, 0.66], [4.49, 0.54], [4.53, 0.46], [4.56, 0.41], [4.59, 0.38], [4.63, 0.25], [4.66, 0.2],
  [4.69, 0.16], [4.73, 0.14], [4.76, 0.08], [4.81, 0.05], [4.91, 0.03], [5.16, 0]];
// where the P, the S and the 3 sit across the "PS3" picture (its middles, %)
const XP = 17.2, XS = 43.8, X3 = 81.2;

function at(tab, s) {
  if (s <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    const [t1, v1] = tab[i];
    if (s <= t1) { const [t0, v0] = tab[i - 1]; return v0 + (v1 - v0) * ((s - t0) / (t1 - t0 || 1)); }
  }
  return tab[tab.length - 1][1];
}

const BG_LAYERS = ["p3tbg", "wallpaper", "bgtint", "overlay"];
const WAVE_LAYERS = ["wavegl", "wave"];

// onSound(seconds): the boot sound has started (its length); onSkip(): skipped
// icon / title: your own pictures in place of the PlayStation mark and the
// "PS3" title (System Settings > Intro Icon / Intro Title)
export function playIntro(audio, { enabled = true, bootSound = "coldboot", onSound = null, onSkip = null, icon = null, title = null } = {}) {
  // the picture and the boot sound start together: wait (briefly) for the
  // sound, and for the logo's pictures to be decoded (on a first start they
  // weren't read yet, and the logo popped in with a stutter)
  const pic = (u, fb) => new Promise((r) => {
    const im = new Image(); im.decoding = "async";
    im.onload = () => (im.decode ? im.decode() : Promise.resolve()).then(() => r(u), () => r(u));
    im.onerror = () => (fb && u !== fb ? pic(fb).then(() => r(fb)) : r(u));
    im.src = u;
  });
  const pics = enabled ? Promise.race([Promise.all([pic(icon || MARK, MARK), pic(title || WORD, WORD)]), new Promise((r) => setTimeout(() => r(null), 2500))]) : Promise.resolve(null);
  return (enabled ? Promise.all([audio.ready(bootSound), pics]) : Promise.resolve([])).then(([, ok] = []) => new Promise((resolve) => {
    if (ok) { icon = ok[0] === MARK ? null : ok[0]; title = ok[1] === WORD ? null : ok[1]; }
    const root = document.getElementById("intro");
    if (!enabled) { root.classList.add("gone"); resolve(); return; }

    root.classList.remove("gone");
    root.innerHTML = `
      <div class="intro-logo">
        <img class="il-mark${icon ? " own" : ""}" src="${icon || MARK}" alt="">
        <img class="il-word${title ? " own" : ""}" src="${title || WORD}" alt="">
        ${title ? "" : `<img class="il-sub" src="${WORD}" alt="">`}
      </div>`;
    const $mark = root.querySelector(".il-mark"), $word = root.querySelector(".il-word"), $sub = root.querySelector(".il-sub");
    // (a picture that can't be loaded: the default one instead)
    $mark.addEventListener("error", (e) => { if (!e.target.src.endsWith(MARK.slice(1))) e.target.src = MARK; }, { once: true });
    $word.addEventListener("error", (e) => { if (!e.target.src.endsWith(WORD.slice(1))) { e.target.src = WORD; e.target.classList.remove("own"); } }, { once: true });

    const body = document.body;
    const layers = (ids) => ids.map((id) => document.getElementById(id)).filter(Boolean);
    const bgEls = layers(BG_LAYERS), waveEls = layers(WAVE_LAYERS);
    // How far above normal it goes: on the console's dark purple, 2.63 x; a
    // brighter background would turn white, so it goes only as far as its
    // colour can before reaching white (a picture or a theme's background: as
    // on the console)
    let lit = 0.35;
    try { const w = window.__wave, r = w && w.real; if (r && r.ok && !w.wallpaper && !r.wallpaper) lit = Math.max(...r.backgroundColor()); } catch (e) {}
    const top = Math.max(1, Math.min(PEAK, 1 / Math.max(0.05, lit)));
    const over = (v) => (v <= 1 ? v : 1 + (v - 1) * (top - 1) / (PEAK - 1));
    let done = false, resolved = false, raf = 0, t0 = 0;
    const timers = [];

    // the background back to normal; the intro's own layer gone
    const cleanup = () => {
      cancelAnimationFrame(raf);
      setIntroBg(1);
      for (const el of [...bgEls, ...waveEls]) { el.style.filter = ""; el.style.transition = ""; }
      body.classList.remove("intro-run");
      root.classList.add("gone");
    };
    const finish = () => { if (resolved) return; resolved = true; window.removeEventListener("keydown", skip); window.removeEventListener("pointerdown", skip); resolve(); };
    const frame = (now) => {
      if (done) return;
      const s = (now - t0) / 1000;
      const B = over(at(BG, s)), K = Math.max(over(at(WAVE, s)), B);
      setIntroBg(K > 0 ? B / K : 0);
      const fw = `brightness(${K.toFixed(3)}) saturate(${at(WAVE_SAT, s).toFixed(3)})`;
      const fb = `brightness(${B.toFixed(3)}) saturate(${at(BG_SAT, s).toFixed(3)})`;
      for (const el of waveEls) el.style.filter = fw;
      for (const el of bgEls) el.style.filter = fb;
      $mark.style.opacity = at(MARK_A, s).toFixed(3);
      if (title) $word.style.opacity = at(P_A, s).toFixed(3);
      else {
        const a = (v) => `rgba(0,0,0,${v.toFixed(3)})`, p = at(P_A, s), q = at(S_A, s), r = at(T_A, s);
        const m = `linear-gradient(90deg, ${a(p)} 0%, ${a(p)} ${XP}%, ${a(q)} ${XS}%, ${a(r)} ${X3}%, ${a(r)} 100%)`;
        $word.style.webkitMaskImage = m; $word.style.maskImage = m;
        $sub.style.opacity = at(SUB_A, s).toFixed(3);
      }
      if (s >= END) { done = true; cleanup(); return; }
      raf = requestAnimationFrame(frame);
    };
    // skipped: straight to the menu at normal brightness, the intro's sound
    // lowered quickly to nothing
    const skip = () => {
      if (resolved) return;
      done = true; timers.forEach(clearTimeout);
      if (boot) boot.fadeOut(0.6); if (onSkip) onSkip();
      cleanup(); finish();
    };

    // (the boot sound always plays, whatever the user's sound setting and while
    // the menu's own sounds still wait)
    let boot = null;
    { const en = audio.enabled, hold = audio.hold; audio.enabled = true; audio.hold = false;
      boot = audio.play(bootSound, 0.85); audio.enabled = en; audio.hold = hold; }
    if (onSound) { const b = (audio.themeBuffers || {})[bootSound] || audio.buffers[bootSound]; onSound(b ? b.duration : 10); }

    // (the filters change every frame: no easing of their own meanwhile)
    for (const el of [...bgEls, ...waveEls]) el.style.transition = "none";
    body.classList.add("intro-run");
    t0 = performance.now();
    frame(t0);
    // the menu comes in at 7.4 s; the background settles behind it until 7.7 s
    timers.push(setTimeout(finish, INTRO_MS));

    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
  }));
}
