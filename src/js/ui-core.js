// Shared pieces of the menus and players: avatars, lazy pictures and videos, held-button speed-up (ui.js gathers every ui-*.js)
import { sysBase, playerIcon } from "./themes.js";
import { call } from "./api.js";

export const mpIcon = (n) => playerIcon("mp", n, `./assets/icons/system/${n}.png`);

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STOCK_STYLES = ["square", "person", "sphere"];
const STOCK_COLORS = ["grey", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
export const STOCK_AVATARS = STOCK_STYLES.flatMap((s) => STOCK_COLORS.map((c) => `stock:${s}_${c}`));

// PSN avatars: the pictures in content\Avatars\PSN (any file name), read at
// startup. No pictures there = no PSN avatars: everyone has the default grey
// face. These arrays are filled in place by loadPsnAvatars() so imported
// references stay live.
export const PSN_AVATARS = [];
export const ALL_AVATARS = [...STOCK_AVATARS];

// The default PSN avatar (the white square face): a new PSN account starts
// with it and 1 % of random PSN friends have it; it can't be chosen again
// once changed. The other system avatars are for Users only.
export const PSN_DEFAULT_AVATAR = "stock:square_grey";
export function randomPsnAvatar() {
  if (Math.random() < 0.01 || !PSN_AVATARS.length) return PSN_DEFAULT_AVATAR;
  return PSN_AVATARS[Math.floor(Math.random() * PSN_AVATARS.length)];
}

// The system's loading icons turn together, and one drawn again goes on from where it was: each
// starts at the place in the turn (0.9 s) that the clock gives, not at its start.
export const spinAt = () => `animation-delay:-${Math.round(performance.now() % 900)}ms`;
// Avatars loading (Avatar selection, PSN cards): a box with the class av-wait
// shows the media loading icon until its picture is there.
function avDone(img) { const p = img && img.parentElement; if (p && p.classList.contains("av-wait")) p.classList.remove("av-wait"); }
document.addEventListener("load", (e) => { if (e.target && e.target.tagName === "IMG") { avDone(e.target); avatarFill(e.target); } }, true);
// A card's avatar fills its window: a picture saved with a thin empty strip along an edge (a
// square picture a few pixels short of its file) is shown from where the picture itself starts,
// so no strip of what's behind the card shows beside it. A picture whose figure stands on an
// empty background (a PSN avatar's head and shoulders) is a shape of its own: shown whole, as
// in Change Avatar. The edge is found once per picture.
const _avEdge = new Map();
const AV_FILL = ".fc-av:not(.fc-stock), .pp-av > img:not(.fc-stock), .tm-av";
function avatarEdge(src) {
  let p = _avEdge.get(src);
  if (p !== undefined) return p;
  if (_avEdge.size > 600) _avEdge.clear();
  p = fetch(src).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }).then((b) => (/jpe?g|bmp/i.test(b.type) ? null : createImageBitmap(b))).then((bm) => {
    if (!bm) return "";
    const k = Math.min(1, 256 / Math.max(bm.width, bm.height)), w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(bm, 0, 0, w, h); bm.close && bm.close();
    const d = cx.getImageData(0, 0, w, h).data, on = (x, y) => d[(y * w + x) * 4 + 3] >= 200; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    cv.width = cv.height = 0;
    if (x1 < 0) return "";
    const m = [y0 / h, (w - 1 - x1) / w, (h - 1 - y1) / h, x0 / w];
    // (no edge; a wide one; or the picture's own edge not a straight line where the strip ends
    // -- a figure on an empty background, not a square with a strip: left as it is)
    if (Math.max(...m) < 0.004 || Math.max(...m) > 0.06) return "";
    const full = (n, f) => { let k = 0; for (let i = 0; i < n; i++) if (f(i)) k++; return k / n; };
    const rows = y1 - y0 + 1, cols = x1 - x0 + 1;
    const sides = [[m[0], () => full(cols, (i) => on(x0 + i, y0))], [m[1], () => full(rows, (i) => on(x1, y0 + i))],
      [m[2], () => full(cols, (i) => on(x0 + i, y1))], [m[3], () => full(rows, (i) => on(x0, y0 + i))]];
    if (sides.some(([mg, line]) => mg >= 0.004 && line() < 0.9)) return "";
    return `inset(${m.map((v) => (v * 100).toFixed(2) + "%").join(" ")})`;
  }).catch(() => "");
  _avEdge.set(src, p); p.then((v) => _avEdge.set(src, v));
  return p;
}
// (the edge already known: drawn trimmed from the start, so a card drawn again doesn't show
// the picture whole for a moment first)
export function avatarFillStyle(src) { const v = _avEdge.get(src); return typeof v === "string" && v ? `object-view-box:${v}` : ""; }
// The selected friend card's avatar: the card's colour under the avatar's edge only where the
// picture is drawn (the picture itself as its mask, styles.css .fc-avunder); a picture filling its
// window (trimmed of a thin empty strip, "av-trim") is drawn all over it.
export function avatarSlotAttrs(src) {
  const trim = !!avatarFillStyle(src);
  return { cls: trim ? " av-trim" : "", style: src ? `--avm:url('${String(src).replace(/'/g, "%27")}')` : "" };
}
export function avatarFill(img) {
  if (!img || !img.matches || !img.matches(AV_FILL)) return;
  // (the system's own pictures -- the default faces -- are drawn as they are)
  const src = img.currentSrc || img.getAttribute("src"); if (!src || /^data:/.test(src) || /assets\/icons\//.test(src)) return;
  const set = (v) => {
    if (!img.isConnected || (img.currentSrc || img.getAttribute("src")) !== src) return;
    img.style.objectViewBox = v || "";
    // (trimmed: the picture fills its window, the light over all of it)
    const slot = img.parentElement; if (slot && slot.matches(".fc-avslot")) slot.classList.toggle("av-trim", !!v);
  };
  const e = avatarEdge(src);
  if (typeof e === "string") set(e); else e.then(set);
}
document.addEventListener("error", (e) => { if (e.target && e.target.tagName === "IMG" && e.target.getAttribute("src")) avDone(e.target); }, true);
// (pictures already there when the box is made)
export function avWaitCheck(root) {
  for (const box of (root || document).querySelectorAll(".av-wait")) {
    const img = box.querySelector(":scope > img");
    if (img && img.getAttribute("src") && img.complete && img.naturalWidth) { box.classList.remove("av-wait"); avatarFill(img); }
  }
}

let _avatarsLoaded = null;
let _psnDir = "";   // content\Avatars\PSN
export function loadPsnAvatars() {
  if (_avatarsLoaded) return _avatarsLoaded;
  _avatarsLoaded = (async () => {
    // only content\Avatars\PSN (read now, at startup: a restart picks up new
    // ones); the old built-in set isn't used, so an empty folder means none
    PSN_AVATARS.length = 0;
    try {
      const own = await call("list_psn_avatars");
      if (own && own.dir) _psnDir = own.dir;
      for (const f of (own && own.files) || []) PSN_AVATARS.push(`psnf:${f}`);
    } catch (e) {}
    ALL_AVATARS.length = 0;
    ALL_AVATARS.push(...STOCK_AVATARS, ...PSN_AVATARS);
    return PSN_AVATARS;
  })();
  return _avatarsLoaded;
}

// A video square in a grid: its first frame is loaded only once the square
// comes near the view (a grid can hold many videos, each one a player).
export const lazyVideoHTML = (cls, src) => `<video class="${cls} lazyvid" data-src="${src}#t=0.5" muted preload="none" playsinline></video>`;
export function watchLazyVideos(root) {
  const vids = [...root.querySelectorAll("video.lazyvid[data-src]")];
  if (!vids.length) return;
  const load = (v) => { if (!v.dataset.src) return; v.preload = "metadata"; v.src = v.dataset.src; delete v.dataset.src; };
  if (!window.IntersectionObserver) { vids.forEach(load); return; }
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { load(e.target); io.unobserve(e.target); } },
    { root: root.querySelector(".avpick-scroll"), rootMargin: "200px 0px" });
  vids.forEach((v) => io.observe(v));
}
// The pictures of a grid (Photo Gallery, Choose an Image, the playlist
// pickers) are drawn at the size they're shown, once they come near the view,
// and let go once they're far from it (more than about a screen and a half
// away): the grid holds only small copies of the pictures around what's shown,
// whatever its size (a picture shown as an <img> would stay decoded at full
// size in the webview's picture memory long after it scrolled away).
// Scrolling back draws them again.
export function watchFarImages(root) {
  if (root._farIO) { root._farIO.disconnect(); root._farIO = null; }
  if (!window.IntersectionObserver) return;
  const imgs = [...root.querySelectorAll("img.avpick-av")];
  if (!imgs.length) return;
  for (const img of imgs) { const u = img.getAttribute("src"); if (u) { img.dataset.far = u; img.removeAttribute("src"); } }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const show = (img) => {
    if (img._cv || img._loading) return;
    const url = img.dataset.far; if (!url) return;
    img._loading = true;
    const src = img._src = new Image(); src.decoding = "async";
    src.onload = async () => {
      img._loading = false;
      if (!img.isConnected || !img._near) { src.onload = src.onerror = null; src.src = ""; return; }
      const box = img.getBoundingClientRect(), cover = getComputedStyle(img).objectFit === "cover";
      const bw = Math.max(1, Math.round((box.width || 140) * dpr)), bh = Math.max(1, Math.round((box.height || 140) * dpr));
      const fit = cover ? Math.max(bw / src.naturalWidth, bh / src.naturalHeight) : Math.min(bw / src.naturalWidth, bh / src.naturalHeight);
      const sc = Math.min(1, fit);
      const w = Math.max(1, Math.round(src.naturalWidth * sc)), h = Math.max(1, Math.round(src.naturalHeight * sc));
      try {
        const bmp = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
        src.onload = src.onerror = null; src.src = "";
        if (!img.isConnected || !img._near) { bmp.close(); return; }
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.className = img.className + " far-cv";
        cv.getContext("2d").drawImage(bmp, 0, 0); bmp.close();
        img.style.display = "none"; img.after(cv); img._cv = cv; avDone(img);
      } catch (e) { img.src = url; }   // (no bitmap: shown as a picture)
    };
    // (a still that can't be made: the picture's own error handling takes over)
    src.onerror = () => { img._loading = false; if (img.isConnected) img.src = url; };
    src.src = url;
  };
  const hide = (img) => {
    // (still loading when it went out of reach: stopped)
    if (img._loading && img._src) { img._src.onload = img._src.onerror = null; img._src.src = ""; img._src = null; img._loading = false; }
    if (img._cv) { img._cv.width = 0; img._cv.remove(); img._cv = null; img.style.display = ""; }
    if (img.getAttribute("src") && !img.dataset.vsrc) { img.dataset.far = img.getAttribute("src"); img.removeAttribute("src"); }
    // (the Photo Gallery's: the loading icon again until it's drawn again)
    if (img.parentElement && img.parentElement.classList.contains("avpick-cell") && img.parentElement.closest(".photogrid")) img.parentElement.classList.add("av-wait");
  };
  // (the cells are watched: a picture's own element is hidden while its drawing shows)
  const io = new IntersectionObserver((es) => {
    // (a moment's wait before loading: scrolling quickly past, held, the cells
    // going by don't each start a picture; the ones it stops near load first)
    for (const e of es) {
      const img = e.target._farImg; if (!img) continue;
      img._near = e.isIntersecting; clearTimeout(img._nearT);
      if (e.isIntersecting) img._nearT = setTimeout(() => { if (img._near) show(img); }, 90); else hide(img);
    }
  }, { root: root.querySelector(".avpick-scroll"), rootMargin: "150% 0px" });
  imgs.forEach((i) => { const cell = i.parentElement; if (cell) { cell._farImg = i; io.observe(cell); } });
  root._farIO = io;
}
// A video's still in a grid (its Change Icon picture, or its own frame made
// by the system): if no still can be made (no ffmpeg), the video itself
// shows its frame there instead, as before.
export function watchStillFallback(root) {
  for (const img of root.querySelectorAll("img[data-vsrc]")) {
    img.addEventListener("error", () => {
      const v = document.createElement("template");
      v.innerHTML = lazyVideoHTML(img.className, img.dataset.vsrc);
      img.parentElement?.classList.remove("av-wait");
      img.replaceWith(v.content.firstChild);
      watchLazyVideos(root);
    }, { once: true });
  }
}
export const VIDEO_RE = /\.(mp4|m4v|webm|mkv|avi|mov|wmv|asf|flv|mpg|mpeg|m2ts|mts|ts|vob|3gp|ogv|divx|3g2|f4v|rm|rmvb|mxf|ogm|dv|mod|tod|m2v|m1v|mpe|mpv|m2t|trp|tp|evo|vro|qt|amv|nsv|xvid|h264|264|hevc|265|y4m|bik|nut)$/i;
// A PSN avatar that isn't in content\Avatars\PSN (any more), or one of the
// old built-in set: the default grey face instead (friends, accounts, users)
// The signed-in Steam account's own picture (Linked Accounts): the avatar
// "steam", its file kept by the system (steamfriends.rs); none → the grey face
export let _steamAv = "";
export function setSteamAvatar(path) { _steamAv = path || ""; }
export const steamAvatar = () => _steamAv;
export function liveAvatar(ref) {
  if (ref === "steam" && !_steamAv) return PSN_DEFAULT_AVATAR;
  // (a Steam friend's picture still being fetched: the default face wherever it's drawn as a picture)
  if (ref === "wait:") return null;
  if (typeof ref === "string" && (ref.startsWith("psn:") || ref.startsWith("psnf:")) && !PSN_AVATARS.includes(ref)) return PSN_DEFAULT_AVATAR;
  return ref;
}
export const isStockAvatar = (ref) => /^stock:/.test(String(liveAvatar(ref) || ""));
export function avatarSrc(ref) {
  ref = liveAvatar(ref);
  if (!ref) return "./assets/icons/theme/icon_user.png";
  if (ref.startsWith("stock:")) return `./assets/icons/avatars/stock/${ref.slice(6)}.png`;
  if (ref.startsWith("psn:")) {
    // (an old save's avatar from the removed built-in set: the grey face)
    return "./assets/icons/avatars/stock/square_grey.png";
  }
  if (ref.startsWith("psnf:")) {
    const T = window.__TAURI__, p = `${_psnDir}${/[\\/]$/.test(_psnDir) ? "" : "\\"}${ref.slice(5)}`;
    return (T && T.core && _psnDir) ? T.core.convertFileSrc(p) : "./assets/icons/avatars/stock/square_grey.png";
  }
  if (ref.startsWith("sys:")) return sysBase(ref.slice(4));
  const T = window.__TAURI__;
  if (ref === "steam") return (T && T.core) ? T.core.convertFileSrc(_steamAv) : _steamAv;
  return (T && T.core) ? T.core.convertFileSrc(ref) : ref;
}
// Sliders move by their smallest step; holding the button speeds them up
// (x5 after ~1 s of repeats, then x25 and x100 on long ranges) so long ranges stay quick.
const _accel = { key: null, t: 0, n: 0 };
// Held Up / Down in a long menu (Select Background Music, Change Avatar, the
// Photo Gallery...): faster and faster, like the XMB's own lists, a step of up
// to a tenth of the rows
export const heldRows = (key, rows) => holdAccel(key, Math.max(1, Math.floor(rows / 10)));
// the cell `rows` rows up (-) or down (+) from i in a grid of `cols`, in the same column where it can
export function gridStep(i, rows, cols, n) {
  let j = i + rows * cols;
  if (j < 0) j = i % cols;
  while (j >= n && j - cols >= 0) j -= cols;
  return Math.min(n - 1, j);
}
export function holdAccel(key, maxMult = 25) {
  const now = performance.now();
  // (only a button held down speeds up: quick separate presses, however many,
  // move one step each)
  if (!window.__inputRepeat) { _accel.key = key; _accel.t = now; _accel.n = 0; return 1; }
  if (_accel.key === key && now - _accel.t < 260) _accel.n++; else _accel.n = 0;
  _accel.key = key; _accel.t = now;
  const m = _accel.n < 8 ? 1 : _accel.n < 22 ? 5 : _accel.n < 40 ? 25 : 100;
  return Math.max(1, Math.min(m, Math.floor(maxMult)));
}
export function isMaskAvatar(ref) { return !ref || ref.startsWith("sys:"); }
