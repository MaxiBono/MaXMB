// XMB icon material, baked per icon into a tinted glass image (see shadeIcon).
// Built only from each icon's own silhouette: no texture maps.

// Scratch space used again for every icon (shading runs one icon at a time):
// a shared canvas and working buffers instead of new ones each time, so
// shading a whole menu leaves little behind for the garbage collector (whose
// pauses are long on slow computers).
const _scratch = {};
function scratchF32(name, n) { const b = _scratch[name]; return b && b.length === n ? b : (_scratch[name] = new Float32Array(n)); }
function scratchU8(name, n) { const b = _scratch[name]; return b && b.length === n ? b : (_scratch[name] = new Uint8Array(n)); }
function scratchCanvas(S) {
  let c = _scratch.canvas;
  if (!c) { c = _scratch.canvas = document.createElement("canvas"); _scratch.ctx = null; }
  if (c.width !== S || c.height !== S) { c.width = S; c.height = S; }
  return [c, _scratch.ctx || (_scratch.ctx = c.getContext("2d", { willReadFrequently: true }))];
}

// separable box blur (repeated → approx Gaussian) of a single-channel field
// (the result is a scratch buffer: used before the next blur)
function boxBlur(src, W, H, radius, passes) {
  let a = scratchF32("blurA", W * H); a.set(src);
  let b = scratchF32("blurB", W * H);
  const norm = 1 / (radius * 2 + 1);
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += a[y * W + Math.max(0, Math.min(W - 1, x))];
      for (let x = 0; x < W; x++) {
        b[y * W + x] = sum * norm;
        const add = a[y * W + Math.min(W - 1, x + radius + 1)];
        const sub = a[y * W + Math.max(0, x - radius)];
        sum += add - sub;
      }
    }
    // vertical
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += b[Math.max(0, Math.min(H - 1, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum * norm;
        const add = b[Math.min(H - 1, y + radius + 1) * W + x];
        const sub = b[Math.max(0, y - radius) * W + x];
        sum += add - sub;
      }
    }
  }
  return a;
}


// ---- "Liquid Glass" icon styles ---------------------------------------------
// Thick, rounded glass built from the icon's own silhouette (a wide soft bevel,
// like a drop of liquid): light bends at its rounded edges, so what's behind it
// is pulled in and magnified there, with a little colour fringing; a bright
// rim (Fresnel) and a highlight from the top left, a softer one at the bottom.
//   * "glass" (the filter): the background seen through the glass is a fixed
//     one, drawn into the picture (the icon colour, lit from above, with a
//     brighter band low down like the wave), so it costs nothing to show.
//   * "glasslive" (reactive): the picture has only the glass itself (a light
//     tint, the rim and the highlights); the real background behind the icon
//     is bent through it by the page (glassFilter: the same bend as a map).
// The bevel and the bend of one icon (shared by both styles and the map).
// wide: the filter version's bevel (~9 % of the glyph, thin strokes rounded
// all across); narrow (reactive): only the edge is rounded and bends what's
// behind, the flat face shows it as it is (~4.5 %)
function glassField(alpha, S, wide = true) {
  let x0 = S, y0 = S, x1 = 0, y1 = 0;
  for (let i = 0; i < S * S; i++) if (alpha[i] > 0.15) { const x = i % S, y = (i / S) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const glyph = Math.max(8, Math.max(x1 - x0, y1 - y0));
  // (a wide bevel: ~9 % of the glyph, so thin strokes are rounded all across)
  const rad = Math.max(2, Math.round(glyph * (wide ? 0.09 : 0.045)));
  const h = boxBlur(alpha, S, S, rad, wide ? 3 : 2);
  const STR = 1.25 * (2 * rad + 1);
  const nx = scratchF32("gnx", S * S), ny = scratchF32("gny", S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (alpha[i] <= 0) { nx[i] = ny[i] = 0; continue; }
    const xl = h[y * S + Math.max(0, x - 1)], xr = h[y * S + Math.min(S - 1, x + 1)];
    const yt = h[Math.max(0, y - 1) * S + x], yb = h[Math.min(S - 1, y + 1) * S + x];
    let a = -(xr - xl) * 0.5 * STR, b = -(yb - yt) * 0.5 * STR;
    const n = Math.hypot(a, b); if (n > 0.96) { a *= 0.96 / n; b *= 0.96 / n; }
    nx[i] = a; ny[i] = b;
  }
  return { nx, ny };
}
// how far the background is pulled in (a fraction of the icon's size) for a
// surface tilted by t (0 flat .. 1 on edge): nothing on the flat face, most at the rim
const GLASS_BEND = 0.035;
const bendOf = (t) => GLASS_BEND * Math.pow(t, 2.2);
const GL_L1 = (() => { const v = [-0.45, -0.75, 0.6], l = Math.hypot(...v); return v.map((c) => c / l); })();
const GL_L2 = (() => { const v = [0.5, 0.7, 0.55], l = Math.hypot(...v); return v.map((c) => c / l); })();
function shadeGlass(d, alpha, S, tintIn, pix, live, solid) {
  const tint = tintIn.slice(0, 3);
  const { nx, ny } = glassField(alpha, S, !live);
  // the fixed background of the filter version, at (u, v) of the icon
  const env = (u, v, k) => {
    const sky = 0.97 - 0.42 * Math.min(1, Math.max(0, v));                 // lit from above
    const band = 0.38 * Math.exp(-(((v - 0.68 + 0.08 * Math.sin(u * 5.2)) / 0.11) ** 2));   // the wave, low down
    return Math.min(1.15, sky + band) * tint[k];
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = i * 4, a = alpha[i];
    if (a <= 0) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; continue; }
    const X = nx[i], Y = ny[i], t = Math.min(1, Math.hypot(X, Y)), Z = Math.sqrt(Math.max(0, 1 - t * t));
    const F = Math.pow(1 - Z, 2.2);                                          // rim (Fresnel)
    const h1 = Math.max(0, -X * GL_L1[0] - Y * GL_L1[1] + Z * GL_L1[2]);    // (normals point out: x right, y down)
    const h2 = Math.max(0, -X * GL_L2[0] - Y * GL_L2[1] + Z * GL_L2[2]);
    const spec = Math.pow(h1, 28) * 0.95 * Math.min(1, F * 4 + 0.15) + Math.pow(h2, 18) * 0.35 * Math.min(1, F * 5);
    let r, g, b, al;
    if (live) {
      // the glass alone: a light tint over the bent background, a stronger rim
      // (lit from above like the console's glass: brighter at the top; a
      // fairly solid pale body, as in captures of the console, with what's
      // behind still showing through it)
      const v = (y + 0.5) / S, k = (0.66 + 0.22 * F) * (1.1 - 0.2 * v);
      r = tint[0] * k + spec + F * 0.18; g = tint[1] * k + spec + F * 0.18; b = tint[2] * k + spec + F * 0.18;
      al = solid ? 1 : Math.min(1, 0.42 + 0.42 * F + spec);
    } else {
      // the fixed background, pulled in at the rim, each colour a little apart
      const u = (x + 0.5) / S, v = (y + 0.5) / S, bend = bendOf(t) / Math.max(1e-6, t);
      const du = -X * bend, dv = -Y * bend, sp = 0.18;
      const base = [env(u + du * (1 - sp), v + dv * (1 - sp), 0), env(u + du, v + dv, 1), env(u + du * (1 + sp), v + dv * (1 + sp), 2)];
      const k = 0.82 + 0.18 * (1 - F);
      r = base[0] * k + spec + F * 0.32; g = base[1] * k + spec + F * 0.32; b = base[2] * k + spec + F * 0.32;
      al = solid ? 1 : Math.min(1, 0.58 + 0.38 * F + spec);
    }
    if (pix) { r *= pix[i * 3] / 255 * 1.15; g *= pix[i * 3 + 1] / 255 * 1.15; b *= pix[i * 3 + 2] / 255 * 1.15; }
    const m = Math.max(al, r, g, b, 1e-6), A = Math.min(1, m);
    d[o] = Math.round(255 * Math.min(1, r / A)); d[o + 1] = Math.round(255 * Math.min(1, g / A)); d[o + 2] = Math.round(255 * Math.min(1, b / A));
    d[o + 3] = Math.round(255 * Math.min(1, al > m ? al : A) * a);
  }
}
// The reactive style's lens, as data for the glass layer (glasslayer.js), which
// draws the real background bent through each icon on the graphics card: one
// RGBA picture per icon, made once: red / green the surface's tilt (mid grey:
// flat; the layer pulls what's behind in along it, most at the rim), blue the
// rim's strength, alpha the icon's own shape.
const _glassMaps = new Map();
const LENS_S = 96;
let _glassMapId = 0;
export function glassMap(key, img) {
  const hit = _glassMaps.get(key);
  if (hit) return hit;
  if (!img) return null;
  try {
    const S = LENS_S;
    const [, ctx] = scratchCanvas(S);
    ctx.clearRect(0, 0, S, S);
    const iw = img.naturalWidth || img.width || S, ih = img.naturalHeight || img.height || S;
    const sc = Math.min(S / iw, S / ih), dw = iw * sc, dh = ih * sc;
    ctx.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
    const d = ctx.getImageData(0, 0, S, S).data;
    const alpha = scratchF32("lalpha", S * S);
    for (let i = 0; i < S * S; i++) alpha[i] = d[i * 4 + 3] / 255;
    const { nx, ny } = glassField(alpha, S, true);
    const out = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      const X = nx[i], Y = ny[i], t = Math.min(1, Math.hypot(X, Y)), Z = Math.sqrt(Math.max(0, 1 - t * t));
      out[i * 4] = Math.round(127.5 + 127.5 * Math.max(-1, Math.min(1, X)));
      out[i * 4 + 1] = Math.round(127.5 + 127.5 * Math.max(-1, Math.min(1, Y)));
      out[i * 4 + 2] = Math.round(255 * Math.pow(1 - Z, 1.6));
      out[i * 4 + 3] = Math.round(255 * alpha[i]);
    }
    // (an id never used before, even after the cache is cleared: the glass
    // layer keeps each map's texture under its id, so a reused id would give an
    // icon another icon's glass shape)
    const m = { w: S, h: S, data: out, id: ++_glassMapId };
    _glassMaps.set(key, m);
    return m;
  } catch (e) {
    _scratch.canvas = null; _scratch.ctx = null;
    return null;
  }
}

// Icon Styles "Glow" and "Glow (Pulsating)": the glow around an icon, as a mask
// (white where it glows): the icon's shape spread out and softened, with the
// icon itself cut out of it, so the glow is only around the icon and never
// shows through its glass. The picture is GLOW_PAD times the icon's box (the
// page puts it over a box that much bigger) and coloured by the page.
export const GLOW_PAD = 1.6;
// The colour of an icon's border as drawn (its shaded picture's outermost
// solid pixels, averaged): the Glow styles glow in it. "r,g,b" or null.
const _edgeColors = new Map();
export function edgeColor(img, key) {
  if (key && _edgeColors.has(key)) return _edgeColors.get(key);
  if (!img) return null;
  try {
    const S = 96;
    const [, ctx] = scratchCanvas(S);
    ctx.clearRect(0, 0, S, S);
    const iw = img.naturalWidth || img.width || S, ih = img.naturalHeight || img.height || S;
    const sc = Math.min(S / iw, S / ih), dw = iw * sc, dh = ih * sc;
    ctx.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
    const d = ctx.getImageData(0, 0, S, S).data;
    const A = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : d[(y * S + x) * 4 + 3]);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = A(x, y);
      if (a < 128) continue;
      // (a solid pixel next to a see-through one: the border)
      if (A(x - 1, y) >= 64 && A(x + 1, y) >= 64 && A(x, y - 1) >= 64 && A(x, y + 1) >= 64) continue;
      const o = (y * S + x) * 4;
      r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
    }
    const v = n ? [r, g, b].map((c) => Math.round(c / n)).join(",") : null;
    if (key) _edgeColors.set(key, v);
    return v;
  } catch (e) {
    _scratch.canvas = null; _scratch.ctx = null;
    return null;
  }
}
const _glowMasks = new Map();
export function glowMask(key, img) {
  const hit = _glowMasks.get(key);
  if (hit) return hit;
  if (!img) return null;
  try {
    const S = 128, P = Math.round(S * GLOW_PAD), off = (P - S) / 2;
    const [cv, ctx] = scratchCanvas(P);
    ctx.clearRect(0, 0, P, P);
    const iw = img.naturalWidth || img.width || S, ih = img.naturalHeight || img.height || S;
    const sc = Math.min(S / iw, S / ih), dw = iw * sc, dh = ih * sc;
    ctx.drawImage(img, off + (S - dw) / 2, off + (S - dh) / 2, dw, dh);
    const id = ctx.getImageData(0, 0, P, P), d = id.data;
    const a = scratchF32("galpha", P * P);
    for (let i = 0; i < P * P; i++) a[i] = d[i * 4 + 3] / 255;
    // two widths: a tight bright halo and a wide soft one
    const near = boxBlur(a, P, P, Math.max(2, Math.round(S * 0.035)), 3).slice();
    const far = boxBlur(a, P, P, Math.max(3, Math.round(S * 0.09)), 3).slice();
    // (everything see-through on and around the icon glows: its borders and
    // the gaps and holes inside it alike; the icon itself stays clear)
    for (let i = 0; i < P * P; i++) {
      const g = Math.min(1, near[i] * 1.6 + far[i] * 0.9) * (1 - a[i]);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(255 * g);
    }
    ctx.putImageData(id, 0, 0);
    const u = cv.toDataURL(), i = u.indexOf(","), bin = atob(u.slice(i + 1)), arr = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
    const url = URL.createObjectURL(new Blob([arr], { type: "image/png" }));
    _glowMasks.set(key, url);
    return url;
  } catch (e) {
    _scratch.canvas = null; _scratch.ctx = null;
    return null;
  }
}

const _cache = new Map();
// bump when the look changes, so saved images from an older look aren't reused
const SHADE_VERSION = "g7";
export const colorKey = (rgb) => rgb.map((c) => Math.round(c * 255)).join(",");
const _ck = (key, rgb) => SHADE_VERSION + "|" + key + "|" + colorKey(rgb);
let _added = 0;
// saved shading (from the cache file): { "<version>|<icon>|<r,g,b>": dataURL }
export function importShades(obj) {
  if (!obj || typeof obj !== "object") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith(SHADE_VERSION + "|") && typeof v === "string" && v.startsWith("data:image/") && !_cache.has(k)) { _cache.set(k, v); n++; }
  }
  return n;
}
// everything made for the given colours (newest colours first), to save
export function exportShades(colorKeys) {
  const want = new Set(colorKeys), out = {};
  for (const [k, v] of _cache) { const c = k.slice(k.lastIndexOf("|") + 1); if (want.has(c)) out[k] = v; }
  return out;
}
// Only the colours still in use are kept in memory: the images made for the
// others (Original follows the background, which changes with the time of
// day, so new colours keep coming) are dropped, with their blob: links.
export function pruneShades(colorKeys) {
  const want = new Set(colorKeys);
  let n = 0;
  for (const [k, v] of _cache) {
    const c = k.slice(k.lastIndexOf("|") + 1);
    if (want.has(c)) continue;
    _cache.delete(k); n++;
    dropShaded(v);
  }
  return n;
}
export function shadeCacheSize() { return _cache.size; }
// Themes no longer in use (PS3 theme, Icon Set, Custom Theme): the shading made
// for their icons is dropped (with its blob: links), and so is everything made
// from their pictures that were let go of (`gone`: their blob: links), the
// decoded pictures included. live: the keys of the themes still in use.
export function dropThemeShades(live, gone = []) {
  const goneSet = new Set(gone);
  let n = 0;
  for (const [k, v] of _cache) {
    const name = k.slice(k.indexOf("|") + 1).replace(/^~[a-z]+~/, "");
    const tk = /^[tc]:/.test(name) ? name.slice(2).split("|")[0] : "";
    const oldTheme = /^(p3t|icon|custom):/.test(tk) && !live.has(tk);
    if (!oldTheme && !(goneSet.size && gone.some((u) => k.includes(u)))) continue;
    _cache.delete(k); n++;
    dropShaded(v);
  }
  for (const u of goneSet) { _imgCache.delete(u); _imgLoaded.delete(u); }
  return n;
}
// (what's in memory, for checking: the pictures' keys, how many lenses and glow shapes)
export function shadeCacheInfo() { return { keys: [..._cache.keys()], lenses: _glassMaps.size, glows: _glowMasks.size }; }
// Cache Management > Delete Icon Shading (or Delete All Cache): every shaded
// picture, lens and glow shape forgotten too (not only the saved file), so the
// icons are all made again
export function clearShades() {
  for (const v of _cache.values()) dropShaded(v);
  _cache.clear(); _added = 0;
  _glassMaps.clear();
  for (const u of _glowMasks.values()) { try { URL.revokeObjectURL(u); } catch (e) {} }
  _glowMasks.clear(); _edgeColors.clear();
}
// how many new images were made since the last call (to know when to save)
export function takeNewShadeCount() { const n = _added; _added = 0; return n; }
// the shaded image for this icon + colour if it's been made already
// A shaded icon as the page uses it: a short blob: link to the same picture
// (made once per picture). The cache keeps the data: form, which is what's
// saved between launches; written into the page, that long text is parsed
// again and copied with every menu that's drawn, and the memory left behind
// makes for long clean-up pauses on slow computers.
const _blobUrls = new Map();
// A shaded picture dropped: its blob: link let go of, and the picture loaded
// from it (or from its data: form) forgotten too (kept, every Icon Style /
// Color change left a whole set of decoded pictures behind for good)
function dropShaded(v) {
  const b = _blobUrls.get(v);
  if (b) { URL.revokeObjectURL(b); _blobUrls.delete(v); _imgCache.delete(b); _imgLoaded.delete(b); }
  _imgCache.delete(v); _imgLoaded.delete(v);
}
export function shadeSrc(u) {
  if (!u || !u.startsWith("data:")) return u;
  let b = _blobUrls.get(u);
  if (!b) {
    try {
      const i = u.indexOf(","), bin = atob(u.slice(i + 1)), a = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
      b = URL.createObjectURL(new Blob([a], { type: u.slice(5, i).split(";")[0] || "image/png" }));
    } catch (e) { return u; }
    _blobUrls.set(u, b);
  }
  return b;
}
// (each style's images under their own name; "~" can't start a picture's name or path)
const STYLE_PREFIX = { glossy: "~g~", glass: "~lg~", glasslive: "~lgl~" };
const _sk = (style, key) => (STYLE_PREFIX[style] || STYLE_PREFIX.glossy) + key;
// Another Icon Style chosen: the images made for every other style are dropped
// (with their blob: links), and so are the reactive glass's filters when it's
// no longer in use. keep: the styles still drawn (the reactive styles also
// keep the plain Liquid Glass, used for custom pictures). How many were dropped.
export function dropOtherStyles(keep) {
  const pre = keep.filter((s) => STYLE_PREFIX[s]).map((s) => STYLE_PREFIX[s]);
  let n = 0;
  for (const [k, v] of _cache) {
    const name = k.slice(k.indexOf("|") + 1);
    if (pre.some((p) => name.startsWith(p))) continue;
    _cache.delete(k); n++;
    dropShaded(v);
  }
  if (!keep.includes("glasslive")) _glassMaps.clear();
  if (!keep.includes("glow")) { for (const u of _glowMasks.values()) { try { URL.revokeObjectURL(u); } catch (e) {} } _glowMasks.clear(); _edgeColors.clear(); }
  return n;
}
export function cachedShade(key, colorRgb, style = "glossy") { return _cache.get(_ck(_sk(style, key), colorRgb)) || null; }

// Shade one icon image to a tinted glass data URL (cached by name + colour).
//
// Only the icon's own silhouette is used. From it a narrow rounded bevel is
// built (like the console's icons: flat face, ~3 % wide rim) and lit the PS3
// way, matched by eye and by measured colours against real XMB captures:
//   * body: top-lit glass whose brightness depends on which way the surface
//     faces: rims facing up go darker, rims facing down catch light;
//   * gloss: a thin bright streak on the slopes facing slightly right;
//   * translucency: the flat face lets ~45 % of the background through and
//     the rim is more solid, so the theme colour behind tints the icon.
// The colour is the Icon Color setting ("Auto" = the theme colour, pale).
// own: keep the picture's own colours (a theme's icon), shaded the same way.
// crop: the result cut to the picture's own shape (not letterboxed into a square)
// (a picture that can't be read, such as one the page isn't allowed to look
// into: shown as it is instead, never stopping the menu from being drawn)
export function shadeIcon(img, colorRgb, key, style = "glossy", own = false, crop = false) {
  try { return _shadeIcon(img, colorRgb, key, style, own, crop); }
  catch (e) {
    // (the drawing surface can't be read any more after such a picture: a new one for the next icons)
    _scratch.canvas = null; _scratch.ctx = null;
    console.warn("icon shading", key, e); return img.currentSrc || img.src;
  }
}
function _shadeIcon(img, colorRgb, key, style, own, crop) {
  const ck = _ck(_sk(style, key), colorRgb);
  const hit = _cache.get(ck);
  if (hit) return hit;
  const S = 192;
  const [cv, ctx] = scratchCanvas(S);
  ctx.clearRect(0, 0, S, S);
  // preserve the icon's aspect ratio (letterbox into the square)
  const iw = img.naturalWidth || img.width || S, ih = img.naturalHeight || img.height || S;
  const sc = Math.min(S / iw, S / ih); const dw = iw * sc, dh = ih * sc;
  ctx.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
  const id = ctx.getImageData(0, 0, S, S); const d = id.data;
  const alpha = scratchF32("alpha", S * S);
  let pix = null;
  if (own) { pix = scratchU8("pix", S * S * 3); for (let i = 0; i < S * S; i++) { pix[i * 3] = d[i * 4]; pix[i * 3 + 1] = d[i * 4 + 1]; pix[i * 3 + 2] = d[i * 4 + 2]; } }
  if (style === "glass" || style === "glasslive") {
    for (let i = 0; i < S * S; i++) alpha[i] = d[i * 4 + 3] / 255;
    shadeGlass(d, alpha, S, colorRgb, pix, style === "glasslive", String(key).includes("|solid"));
    ctx.putImageData(id, 0, 0);
    const u = crop ? _cropUrl(cv, S, dw, dh) : cv.toDataURL(); _cache.set(ck, u); _added++;
    return u;
  }
  let x0 = S, y0 = S, x1 = 0, y1 = 0;
  for (let i = 0; i < S * S; i++) {
    const a = d[i * 4 + 3] / 255; alpha[i] = a;
    if (a > 0.15) { const x = i % S, y = (i / S) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  // bevel width: ~3 % of the glyph (2 px on a 70 px console glyph)
  const glyph = Math.max(8, Math.max(x1 - x0, y1 - y0));
  const rad = Math.max(1, Math.round(glyph * 0.028));
  const h = boxBlur(alpha, S, S, rad, 2);
  const STR = 1.6 / Math.max(0.05, 1 / (2 * rad + 1));     // slope gain: rim fully tilted
  // (an Icon Set with Transparency off: the same glass, fully solid)
  const solid = String(key).includes("|solid");
  const tint = colorRgb;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = i * 4;
    const a = alpha[i];
    if (a <= 0) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 0; continue; }
    const xl = h[y * S + Math.max(0, x - 1)], xr = h[y * S + Math.min(S - 1, x + 1)];
    const yt = h[Math.max(0, y - 1) * S + x], yb = h[Math.min(S - 1, y + 1) * S + x];
    // outward normal (x right, y down), steepest at the silhouette's edge
    let nx = -(xr - xl) * 0.5 * STR, ny = -(yb - yt) * 0.5 * STR;
    const nn = Math.hypot(nx, ny); if (nn > 0.97) { nx *= 0.97 / nn; ny *= 0.97 / nn; }
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    // body light: flat 0.87; up-facing rim darker, down-facing rim brighter
    const body = ny < 0
      ? 0.87 + ny * 0.49                                       // to 0.38 facing straight up
      : 0.87 + Math.min(ny, 0.3) * 0.1 - Math.max(0, ny - 0.3) * 0.5;
    const F = (1 - nz) * (1 - nz);                               // rim strength
    const gloss = Math.exp(-(((nx - 0.27) / 0.16) ** 2)) * Math.min(1, F * 6) * 0.45;
    const A = solid ? 1 : Math.min(1, 0.45 + 0.45 * F);          // opacity of the glass
    const k = Math.min(A * 2, 1);
    const lit = body * 1.28 * (0.7 + 0.3 * F) * k;
    const pr = pix ? pix[i * 3] / 255 : 1, pg = pix ? pix[i * 3 + 1] / 255 : 1, pb = pix ? pix[i * 3 + 2] / 255 : 1;
    const cr = lit * tint[0] * pr + gloss, cg = lit * tint[1] * pg + gloss, cb = lit * tint[2] * pb + gloss;
    // as an image over the background: alpha carries the translucency
    const al = Math.min(1, Math.max(A, cr, cg, cb));
    d[o] = Math.round(255 * Math.min(1, cr / al));
    d[o + 1] = Math.round(255 * Math.min(1, cg / al));
    d[o + 2] = Math.round(255 * Math.min(1, cb / al));
    d[o + 3] = Math.round(255 * al * a);
  }
  ctx.putImageData(id, 0, 0);
  const url = crop ? _cropUrl(cv, S, dw, dh) : cv.toDataURL();
  _cache.set(ck, url); _added++;
  return url;
}
// the middle dw x dh of a shaded square (the picture without the letterbox)
function _cropUrl(cv, S, dw, dh) {
  const w = Math.max(1, Math.round(dw)), h = Math.max(1, Math.round(dh));
  if (w >= S && h >= S) return cv.toDataURL();
  const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
  c2.getContext("2d").drawImage(cv, Math.round((S - w) / 2), Math.round((S - h) / 2), w, h, 0, 0, w, h);
  return c2.toDataURL();
}

const _imgCache = new Map();
const _imgLoaded = new Map();
// the decoded image if it has finished loading (synchronous)
export function loadedIcon(url) { return _imgLoaded.get(url) || null; }
export function loadIconImage(url) {
  let p = _imgCache.get(url);
  if (p) return p;
  // a picture from another address (the user's own files, through the asset
  // link) is read as a blob: copy first, so it can be shaded like the
  // system's own icons (drawn straight from there, it couldn't be read back)
  const other = (() => { try { return !/^(data|blob):/i.test(url) && new URL(url, location.href).origin !== location.origin; } catch (e) { return false; } })();
  const src = other ? fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
    .then((b) => URL.createObjectURL(b)).catch(() => url) : Promise.resolve(url);
  p = src.then((s) => new Promise((resolve, reject) => {
    const img = new Image();
    // decoded right away (off the main thread), so drawing it later is instant
    img.onload = () => { _imgLoaded.set(url, img); (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img)); };
    img.onerror = reject;
    img.src = s;
  }));
  _imgCache.set(url, p);
  return p;
}

// The app's own pictures (assets/icons/index.json), all loaded and decoded up
// front (a few at a time) and kept, so menus show their icons at once. Pictures
// from the user's own files are not part of this: they load as they're shown.
export async function preloadAppIcons(urls, parallel = 6) {
  const list = [...(urls || [])];
  const worker = async () => { while (list.length) { const u = list.shift(); try { await loadIconImage(u); } catch (e) {} } };
  await Promise.all(Array.from({ length: parallel }, worker));
}
