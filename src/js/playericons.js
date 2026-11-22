// The Icon Style on the media players' icons (Music Player, Video Player and
// Photo Viewer: their Control Panels, status icons and boxes).
//
// The players' pictures are the PS3's own (or an Icon Set's), already drawn
// as the console draws them, so the Original styles show them as they are.
// The other styles redraw each picture, keeping what's drawn inside it (the
// letters of SHUF, the marks on the buttons):
//   Glass (Reactive): clear glass; Glossy: the glossy sheen; Flat: one flat
//   colour; Glow / Glow (Pulsating): as they are, with a glow around them
//   (styles.css). The Icon Color is put on afterwards, as before (#icon-tint).
// Pictures are redrawn when they appear (the players draw their parts again
// as they change), from a cache, so only the first time costs anything.

import { shadeIcon, loadIconImage, loadedIcon } from "./iconshade.js";

// the players' icons (as styles.css tints them; not the format badges or the bar)
export const PLAYER_ICON_SEL = [
  ".mp2-btn .mpi", ".mp2-st", ".vp-st", ".vp-st-rep", ".vp-st-num", ".vp-filmicon", ".vp-box img", ".vp-arrows img",
  ".vp-ssbtn", ".vp-gup", ".vp-gdn", ".pv-box img", ".pv-ss img", ".pv-cam",
].join(", ");
const ROOTS = ["musicplayer", "mediaview"];

let STYLE = "glass";
// the Icon Color put on the players' icons (#icon-tint; null: their own colours)
let TINT = null;
const GLOWS = new Set(["glassglow", "glasspulse"]);
// Glow: the colour of the icon's own edge as it's drawn (its picture's edge,
// in the Icon Color when that's put on it: #icon-tint keeps each pixel's
// brightness in that colour)
// The players' pictures have a dark shadow drawn along their lower edge: the
// colour is the icon's own body at its edge (its light pixels), not the shadow
const _edges = new Map();
function iconEdge(img, key) {
  if (_edges.has(key)) return _edges.get(key);
  let v = null;
  try {
    const S = 64, cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (iw && ih) {
      const k = Math.min(S / iw, S / ih), dw = iw * k, dh = ih * k;
      cx.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
      const d = cx.getImageData(0, 0, S, S).data, A = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : d[(y * S + x) * 4 + 3]);
      const px = [];
      let top = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (A(x, y) < 160) continue;
        // (a solid pixel next to a see-through one: the edge)
        if (A(x - 2, y) >= 64 && A(x + 2, y) >= 64 && A(x, y - 2) >= 64 && A(x, y + 2) >= 64) continue;
        const o = (y * S + x) * 4, l = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
        px.push([d[o], d[o + 1], d[o + 2], l]); top = Math.max(top, l);
      }
      const body = px.filter((p) => p[3] >= top * 0.55);
      if (body.length) v = [0, 1, 2].map((i) => Math.round(body.reduce((s, p) => s + p[i], 0) / body.length)).join(",");
    }
  } catch (e) {}
  _edges.set(key, v);
  return v;
}
function glowColor(img, key) {
  const e = iconEdge(img, key);
  if (!e) return null;
  const [r, g, b] = e.split(",").map(Number);
  if (!TINT) return e;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return [TINT.r, TINT.g, TINT.b].map((v) => Math.round(Math.min(255, v * lum))).join(",");
}
function setGlow(el, img, key) {
  if (!GLOWS.has(STYLE)) { el.style.removeProperty("--pg-c"); return; }
  const c = glowColor(img, key);
  if (c) el.style.setProperty("--pg-c", c);
}
// how a style redraws the players' pictures: null = shown as they are
export function playerShade(st) {
  return { glassclear: "glass", glossy: "glossy", flat: "flat" }[st] || null;
}

const _flat = new Map();
// Flat: the picture's shape in one colour (white, tinted afterwards), with
// what's drawn dark inside it (letters, marks) left see-through
function flatten(img, key) {
  const hit = _flat.get(key);
  if (hit) return hit;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    // (light parts: the glyph, solid; dark parts inside it: cut out)
    const k = Math.max(0, Math.min(1, (lum - 0.35) / 0.25));
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(d[i + 3] * k);
  }
  cx.putImageData(id, 0, 0);
  const u = cv.toDataURL();
  _flat.set(key, u);
  return u;
}

// the picture drawn in the style in use (null: as it is)
export function playerIconSrc(img, src, st = STYLE) {
  const sh = playerShade(st);
  if (!sh) return null;
  if (sh === "flat") return flatten(img, src);
  // (in its own colours, so its inside stays; the Icon Color comes after)
  return shadeIcon(img, [1, 1, 1], `p:${src}`, sh, true, true);
}

function styleOne(el) {
  if (!el || el.tagName !== "IMG") return;
  const cur = el.getAttribute("src") || "";
  // (its picture, as the player gave it: kept to draw it again in another style)
  if (cur !== el.dataset.psh) el.dataset.psrc = cur;
  const src = el.dataset.psrc;
  if (!src) return;
  el.classList.toggle("pi-clear", STYLE === "glassclear");
  const apply = (img) => {
    if (!el.isConnected || el.dataset.psrc !== src) return;
    const u = playerIconSrc(img, src);
    const want = u || src;
    if (el.getAttribute("src") !== want) { el.dataset.psh = want; el.setAttribute("src", want); }
  };
  if (!playerShade(STYLE)) {
    if (cur !== src) { el.dataset.psh = src; el.setAttribute("src", src); }
    if (GLOWS.has(STYLE)) { const im = loadedIcon(src); if (im) setGlow(el, im, src); else loadIconImage(src).then((i) => { if (el.isConnected && el.dataset.psrc === src) setGlow(el, i, src); }).catch(() => {}); }
    else el.style.removeProperty("--pg-c");
    return;
  }
  el.style.removeProperty("--pg-c");
  const im = loadedIcon(src);
  if (im) apply(im); else loadIconImage(src).then(apply).catch(() => {});
}

function styleIn(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.matches && node.matches(PLAYER_ICON_SEL)) styleOne(node);
  if (node.querySelectorAll) node.querySelectorAll(PLAYER_ICON_SEL).forEach(styleOne);
}

let _obs = null;
function watch() {
  if (_obs) return;
  _obs = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === "attributes") { if (r.target.matches && r.target.matches(PLAYER_ICON_SEL) && r.target.getAttribute("src") !== r.target.dataset.psh) styleOne(r.target); continue; }
      r.addedNodes.forEach(styleIn);
    }
  });
  for (const id of ROOTS) {
    const el = document.getElementById(id);
    if (el) _obs.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  }
}

// Glow (Pulsating): the glow's strength, 0.3 to 1 and back every 3.4 s,
// set on the players about 6 times a second while one is on screen (their
// icons take it from there, see styles.css); nothing runs otherwise
let _pulseT = 0;
function pulse() {
  const on = STYLE === "glasspulse";
  if (on && !_pulseT) _pulseT = setInterval(pulseStep, 166);
  if (!on && _pulseT) { clearInterval(_pulseT); _pulseT = 0; }
  if (!on) for (const id of ROOTS) document.getElementById(id)?.style.removeProperty("--pga");
}
function pulseStep() {
  if (document.hidden || document.body.classList.contains("lowpower") || document.body.classList.contains("in-game")) return;
  const v = (0.3 + 0.7 * (0.5 - 0.5 * Math.cos(2 * Math.PI * (performance.now() % 3400) / 3400))).toFixed(2);
  for (const id of ROOTS) {
    const el = document.getElementById(id);
    // (only a player on screen)
    if (el && el.getClientRects().length && el.style.getPropertyValue("--pga") !== v) el.style.setProperty("--pga", v);
  }
}
/** The Icon Style in use (xmb.js _applyIconStyle): every player icon on screen redrawn. */
export function setPlayerIconStyle(st) {
  STYLE = st || "glass";
  // (what was made for another style isn't kept: Flat's redrawn pictures, the glows' colours)
  if (STYLE !== "flat") _flat.clear();
  if (!GLOWS.has(STYLE)) _edges.clear();
  watch(); pulse();
  for (const id of ROOTS) styleIn(document.getElementById(id));
}
/** The Icon Color put on the players' icons changed (xmb-shared.js setPlayerIconTint): the glows follow. */
export function setPlayerGlowTint(c) {
  const k = c ? `${c.r},${c.g},${c.b}` : "", was = TINT ? `${TINT.r},${TINT.g},${TINT.b}` : "";
  TINT = c ? { r: c.r, g: c.g, b: c.b } : null;
  if (k !== was && GLOWS.has(STYLE)) for (const id of ROOTS) styleIn(document.getElementById(id));
}
