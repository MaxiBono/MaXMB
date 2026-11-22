// Documents and comics shown page by page in the Photo Viewer (custom
// sections): PDF (pdf.js), CBZ (zip, fflate) and CBT (tar). Each page becomes
// an image URL, made when it's first needed. What's kept is limited, so a long
// session reading many of them doesn't keep growing: the 3 documents opened
// last stay open (the others closed, their pages let go of), each keeping the
// 16 pages shown last; the small first-page pictures of the list are made
// from a copy opened only for that, and the last 400 of them are kept.
//   pdf.js © Mozilla (Apache-2.0), fflate © Arjun Barrett (MIT): src/vendor

import { cmpNatural } from "./api.js";

export const DOC_RE = /\.(pdf|cbz|cbt)$/i;
export const isDocPath = (p) => DOC_RE.test(String(p || ""));
const IMG_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const natural = cmpNatural;
const mime = (n) => /\.png$/i.test(n) ? "image/png" : /\.gif$/i.test(n) ? "image/gif" : /\.webp$/i.test(n) ? "image/webp"
  : /\.bmp$/i.test(n) ? "image/bmp" : /\.avif$/i.test(n) ? "image/avif" : "image/jpeg";

const docs = new Map();      // url -> Promise<{ count, page(i) -> Promise<url>, close() }> (the last used at the end)
const OPEN_KEEP = 3, PAGE_KEEP = 16, THUMB_KEEP = 400;
// (a Map in the order things were last used: the oldest are dropped past `max`)
function touch(m, k, v) { m.delete(k); m.set(k, v); }
function trim(m, max, drop) { while (m.size > max) { const [k, v] = m.entries().next().value; m.delete(k); try { drop && drop(v); } catch (e) {} } }
// a page's picture kept: the oldest let go of past PAGE_KEEP (its blob: link revoked)
function keepPage(made, i, pr) {
  touch(made, i, pr);
  trim(made, PAGE_KEEP, (old) => old.then((u) => { try { URL.revokeObjectURL(u); } catch (e) {} }, () => {}));
}

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
    count: doc.numPages, closed: false,
    close() { this.closed = true; for (const pr of made.values()) pr.then((u) => { try { URL.revokeObjectURL(u); } catch (e) {} }, () => {}); made.clear(); try { doc.destroy(); } catch (e) {} },
    page(i) {
      // (closed meanwhile, still shown in the viewer: opened again)
      if (this.closed) return this.reopen ? this.reopen().then((d) => d.page(i)) : Promise.reject(new Error("closed"));
      if (made.has(i)) { const pr = made.get(i); touch(made, i, pr); return pr; }
      keepPage(made, i, (async () => {
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
        pg.cleanup && pg.cleanup();
        c.width = c.height = 0;
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
    count: entries.length, closed: false,
    close() { this.closed = true; for (const u of urls.values()) { try { URL.revokeObjectURL(u); } catch (e) {} } urls.clear(); entries.length = 0; },
    page(i) {
      if (this.closed) return this.reopen ? this.reopen().then((d) => d.page(i)) : Promise.reject(new Error("closed"));
      const e = entries[i];
      if (!e) return Promise.reject(new Error("no page"));
      if (urls.has(i)) { const u = urls.get(i); touch(urls, i, u); return Promise.resolve(u); }
      touch(urls, i, URL.createObjectURL(new Blob([e.data], { type: mime(e.name) })));
      trim(urls, PAGE_KEEP, (u) => URL.revokeObjectURL(u));
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

function openNew(url, path) {
  const p = String(path || url);
  return /\.pdf$/i.test(p) ? openPdf(url) : /\.cbt$/i.test(p) ? openCbt(url) : openCbz(url);
}
export function openDoc(url, path) {
  let pr = docs.get(url);
  if (!pr) {
    pr = openNew(url, path).then((d) => { d.reopen = () => openDoc(url, path); return d; });
    pr.catch(() => docs.delete(url));
  }
  touch(docs, url, pr);
  // (past OPEN_KEEP: the one used longest ago closed)
  trim(docs, OPEN_KEEP, (old) => old.then((d) => d.close && d.close(), () => {}));
  return pr;
}

// the first page, small, for the item's icon
const thumbs = new Map();
export function docThumb(url, path) {
  if (thumbs.has(url)) { const t = thumbs.get(url); touch(thumbs, url, t); return t; }
  {
    const t = (async () => {
      // (open in the viewer: its page; otherwise a copy opened for this and closed after)
      const open = docs.get(url), d = open ? await open : await openNew(url, path);
      const src = await d.page(0);
      const img = new Image(); img.src = src;
      try { await img.decode(); } finally { if (!open) d.close && d.close(); }
      const k = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const out = c.toDataURL("image/jpeg", 0.85);
      c.width = c.height = 0;
      return out;
    })();
    t.catch(() => thumbs.delete(url));
    touch(thumbs, url, t);
    trim(thumbs, THUMB_KEEP);
  }
  return thumbs.get(url);
}
