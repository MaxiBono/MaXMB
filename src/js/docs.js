// Documents and comics shown page by page in the Photo Viewer (custom
// sections): PDF (pdf.js), CBZ (zip, fflate) and CBT (tar). Each page becomes
// an image URL; pages are made when they're first needed and kept for the
// session.
//   pdf.js © Mozilla (Apache-2.0), fflate © Arjun Barrett (MIT): src/vendor

import { cmpNatural } from "./api.js";

export const DOC_RE = /\.(pdf|cbz|cbt)$/i;
export const isDocPath = (p) => DOC_RE.test(String(p || ""));
const IMG_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const natural = cmpNatural;
const mime = (n) => /\.png$/i.test(n) ? "image/png" : /\.gif$/i.test(n) ? "image/gif" : /\.webp$/i.test(n) ? "image/webp"
  : /\.bmp$/i.test(n) ? "image/bmp" : /\.avif$/i.test(n) ? "image/avif" : "image/jpeg";

const docs = new Map();      // url -> Promise<{ count, page(i) -> Promise<url> }>

let _pdfjs = null;
async function pdfjs() {
  if (!_pdfjs) {
    _pdfjs = import("../vendor/pdf.min.mjs").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
      return m;
    });
  }
  return _pdfjs;
}

async function openPdf(url) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ url, isEvalSupported: false }).promise;
  const made = new Map();
  return {
    count: doc.numPages,
    page(i) {
      if (!made.has(i)) made.set(i, (async () => {
        const pg = await doc.getPage(i + 1);
        const v1 = pg.getViewport({ scale: 1 });
        const k = Math.min(3, 2200 / Math.max(v1.width, v1.height));
        const vp = pg.getViewport({ scale: k });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
        return URL.createObjectURL(blob);
      })());
      return made.get(i);
    },
  };
}

// a comic: the pictures in the archive, in name order
function fromEntries(entries) {
  entries.sort((a, b) => natural(a.name, b.name));
  const urls = new Map();
  return {
    count: entries.length,
    page(i) {
      const e = entries[i];
      if (!e) return Promise.reject(new Error("no page"));
      if (!urls.has(i)) urls.set(i, URL.createObjectURL(new Blob([e.data], { type: mime(e.name) })));
      return Promise.resolve(urls.get(i));
    },
  };
}
async function openCbz(url) {
  const { unzipSync } = await import("../vendor/fflate.mjs");
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const files = unzipSync(buf, { filter: (f) => IMG_RE.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name) });
  return fromEntries(Object.entries(files).map(([name, data]) => ({ name, data })));
}
async function openCbt(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const out = [];
  const str = (o, n) => { let s = ""; for (let i = o; i < o + n && buf[i]; i++) s += String.fromCharCode(buf[i]); return s; };
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = str(off, 100);
    if (!name) break;
    const size = parseInt(str(off + 124, 12).trim() || "0", 8) || 0;
    const type = String.fromCharCode(buf[off + 156] || 48);
    const prefix = str(off + 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    if ((type === "0" || type === "\0") && IMG_RE.test(full)) out.push({ name: full, data: buf.slice(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return fromEntries(out);
}

export function openDoc(url, path) {
  if (!docs.has(url)) {
    const p = String(path || url);
    const pr = /\.pdf$/i.test(p) ? openPdf(url) : /\.cbt$/i.test(p) ? openCbt(url) : openCbz(url);
    pr.catch(() => docs.delete(url));
    docs.set(url, pr);
  }
  return docs.get(url);
}

// the first page, small, for the item's icon
const thumbs = new Map();
export function docThumb(url, path) {
  if (!thumbs.has(url)) {
    thumbs.set(url, (async () => {
      const d = await openDoc(url, path);
      const src = await d.page(0);
      const img = new Image(); img.src = src; await img.decode();
      const k = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.85);
    })());
  }
  return thumbs.get(url);
}
