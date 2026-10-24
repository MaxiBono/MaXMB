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


// ---- "Default" icon style: the earlier XMB material ------------------------
// A port of the PS3 icon shader used by github.com/1etu/XMP (two directional
// lights → Lambert diffuse + dual-lobe Blinn specular, ambient, a luminance
// "glass" curve, a constant bright refraction background and exposure tone
// mapping) on a soft bevel built from the icon's silhouette. Matte, without
// the glossy streak and translucency of the "Glossy" style.
const LOG2E = 1.4429434537887573;
const RFLOOR = 0.6669999957084656;
const LUM = [
  [0.2044299989938736, -0.7366139888763428],
  [0.5444409847259521, -0.2599810063838959],
  [1, 0],
];
function light(x, z) {
  const a = (x * Math.PI) / 180, b = (z * Math.PI) / 180;
  return [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)];
}
function lumCurve(glass) {
  const out = [];
  for (const [i, j, k] of [[0, 1, 2], [1, 0, 2], [2, 0, 1]]) {
    const x = LUM[i][0], y = LUM[i][1], a = LUM[j][0], b = LUM[k][0];
    out.push([a, b, (y * glass) / ((x - a) * (x - b))]);
  }
  return out;
}
const MAT = {
  ambient: 1.05025,
  lights: [light(92.4901, 22.4976), light(84.9909, 282.47)],
  diffuseGain: 3.12367,
  specGains: [0.484729, 2.45394],
  specPow: [44.8563, 74.1114],
  exposure: 1.1574,
  displayGain: 0.8,
  refrTweak: 0.0416622,
  lum: lumCurve(0.0624733),
  eye: [-278, -299, 1200, 37.485],
};
function shadeDefault(d, alpha, S, tintIn, pix = null) {
  // a 4th value lifts the brightness (bright backgrounds): the dark parts come
  // up more than the bright ones, so the shading's contrast stays
  const tint = tintIn.slice(0, 3), lift = Math.max(0, (tintIn[3] || 1) - 1);
  const BG = 0.85, STR = 2.2 * (S / 96);
  const h = boxBlur(alpha, S, S, Math.round(4 * S / 96), 2);
  const m = MAT;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = i * 4;
    const a = alpha[i];
    if (d[o + 3] === 0) { d[o] = d[o + 1] = d[o + 2] = 0; continue; }
    const xl = h[y * S + Math.max(0, x - 1)], xr = h[y * S + Math.min(S - 1, x + 1)];
    const yt = h[Math.max(0, y - 1) * S + x], yb = h[Math.min(S - 1, y + 1) * S + x];
    let nx = -((xr - xl) * 0.5) * STR, ny = -((yb - yt) * 0.5) * STR;
    const nn = nx * nx + ny * ny; if (nn > 1) { const s = 1 / Math.sqrt(nn); nx *= s; ny *= s; }
    const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx + ny * ny)));
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    const ex = m.eye[0] - (u - 0.5) * m.eye[3], ey = m.eye[1] - (v - 0.5) * m.eye[3], ez = m.eye[2];
    const el = Math.hypot(ex, ey, ez), vx = ex / el, vy = ey / el, vz = ez / el;
    const weight = RFLOOR + (1 - RFLOOR) * Math.pow(Math.max(0, Math.min(1, nz)), m.refrTweak * 10);
    const rr = 1 + (BG - 1) * weight;
    const Y = 0.299072 * rr + 0.586914 * rr + 0.114014 * rr;
    let remap = Y;
    for (const c of m.lum) remap += (Y - c[0]) * (Y - c[1]) * c[2];
    let lamb = 0, spec = 0;
    for (let k = 0; k < 2; k++) {
      const L = m.lights[k];
      const nl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]); lamb += nl;
      if (nl === 0) continue;
      const hx = vx + L[0], hy = vy + L[1], hz = vz + L[2];
      const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) / Math.hypot(hx, hy, hz));
      spec += Math.pow(nh, m.specPow[k]) * m.specGains[k];
    }
    const bodyk = remap * (m.ambient + lamb * m.diffuseGain);
    const linear = bodyk + spec;
    let out = m.displayGain * (1 - Math.pow(2, -linear * m.exposure * LOG2E));
    if (lift) out = out + (1 - out) * lift;
    // (a theme's picture keeps its own colours: they take the place of white)
    for (let k = 0; k < 3; k++) d[o + k] = Math.max(0, Math.min(255, Math.round(255 * out * tint[k] * (pix ? pix[i * 3 + k] / 255 * 1.2 : 1))));
    d[o + 3] = Math.round(255 * a);
  }
}

const _cache = new Map();
// bump when the look changes, so saved images from an older look aren't reused
const SHADE_VERSION = "g2";
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
    const b = _blobUrls.get(v);
    if (b) { URL.revokeObjectURL(b); _blobUrls.delete(v); }
  }
  return n;
}
export function shadeCacheSize() { return _cache.size; }
// how many new images were made since the last call (to know when to save)
export function takeNewShadeCount() { const n = _added; _added = 0; return n; }
// the shaded image for this icon + colour if it's been made already
// A shaded icon as the page uses it: a short blob: link to the same picture
// (made once per picture). The cache keeps the data: form, which is what's
// saved between launches; written into the page, that long text is parsed
// again and copied with every menu that's drawn, and the memory left behind
// makes for long clean-up pauses on slow computers.
const _blobUrls = new Map();
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
export function cachedShade(key, colorRgb, style = "glossy") { return _cache.get(_ck(style === "default" ? "d:" + key : key, colorRgb)) || null; }

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
  const ck = _ck(style === "default" ? "d:" + key : key, colorRgb);
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
  if (style === "default") {
    for (let i = 0; i < S * S; i++) alpha[i] = d[i * 4 + 3] / 255;
    shadeDefault(d, alpha, S, colorRgb, pix);
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
