// Icon Style "Default" (reactive Liquid Glass): the real background seen
// through each icon, bent like through a thick drop of glass, drawn on the
// graphics card.
//
// Every frame the wave is drawn (wave.js calls window.__onWaveFrame with its
// canvas), its picture is copied into a texture here; then, for every icon on
// screen, a small tile is drawn into one shared off-screen canvas: the
// background behind the icon magnified and pulled in at the rim (each colour a
// little apart), cut to the icon's shape, with the icon's own glass image over
// it. Each icon shows its tile in a small canvas inside it, so it fades,
// dims, moves and grows with the icon like the rest of it. Icons moving while
// the wave holds still are drawn again from the last wave picture.
//
// (This replaced a backdrop-filter with an SVG filter per icon, which the
// browser worked out on the processor for every icon in every frame.)

import { loadIconImage, loadedIcon } from "./iconshade.js";
import { readableFrom } from "./chroma.js";

// the lens: how much bigger what's behind looks, how far it's pulled in at
// the rim (of the icon's size) and how far apart the colours go there
const MAG = 1.7, EDGE = 0.24, ABER = 0.025, GLOW = 0.7;
// Icon Style Default: how filled in the glass is (0: Icon Style Glass, clear),
// and how bright its fill is
const BODY = 0.78, BODY_K = 1.0;
const ATLAS = 1536, TILE_MAX = 192;
const VIS_OPTS = { opacityProperty: true, visibilityProperty: true };
const CHECK_VIS = typeof Element !== "undefined" && typeof Element.prototype.checkVisibility === "function";

const VS = `#version 300 es
in vec2 aPos; out vec2 vL;
void main() { vL = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uWave, uShade, uMap;
uniform vec4 uRect;      // the icon's box on screen (0..1, top left first)
uniform vec2 uBox;       // the icon's picture inside its box (letterboxed square: scale)
uniform float uMag, uEdge, uAber, uGlow, uHasWave, uSolid, uBody, uBodyK;
in vec2 vL; out vec4 o;
void main() {
  vec2 q = (vL - 0.5) / uBox + 0.5;                     // (the square picture's own coordinates)
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { o = vec4(0.0); return; }
  vec4 m = texture(uMap, q);
  vec4 s = texture(uShade, q);                          // the glass itself (straight alpha)
  float A = m.a;
  vec2 n = m.rg * 2.0 - 1.0;                            // the surface's tilt (x right, y down)
  float rim = m.b;
  vec3 c = vec3(0.0); float wa = 0.0;
  if (uHasWave > 0.5 && A > 0.002) {
    // magnified about the middle, and pulled in along the tilt at the rim
    vec2 L = 0.5 + (vL - 0.5) / uMag - n * uEdge * (0.35 + 0.65 * rim);
    vec2 p = uRect.xy + L * uRect.zw;
    vec2 ab = n * uAber * rim * uRect.zw;
    vec4 g = texture(uWave, p);
    c = vec3(texture(uWave, p - ab).r, g.g, texture(uWave, p + ab).b);
    wa = g.a;
  }
  // the glass over the bent background, both cut to the icon's shape
  // (premultiplied); the glass also gathers the light behind it, so the bright
  // wave shows brighter through it than around it, as on the console
  // (uSolid: an Icon Set with Transparency off: nothing seen through it)
  // (uBody: Icon Style Default: the glass filled in with its own pale colour,
  // nearly solid as on the console, the background still bent through it a
  // little; 0: Icon Style Glass, the clear glass)
  float see = (1.0 - uSolid) * (1.0 - 0.75 * uBody);
  float sa = mix(s.a, A, uBody);
  vec3 body = s.rgb * mix(1.0, uBodyK, uBody * (1.0 - s.a / max(A, 0.001)));
  float under = wa * A * (1.0 - 0.7 * sa) * see;
  vec3 rgb = body * sa * (1.0 - 0.45 * wa * A * see) + c * under + c * wa * A * sa * uGlow * see;
  o = vec4(min(rgb, vec3(1.0)), min(1.0, sa + under));
}`;

export class GlassLayer {
  constructor() {
    this.ok = false; this.on = false; this.body = BODY;
    this.els = document.getElementsByClassName("lg-live");
    this.shades = new Map();   // url -> { tex, used }
    this.maps = new Map();     // map id -> tex
    this._frame = 0; this._sig = "";
    this._loop = this._loop.bind(this);
    try { this._init(); this.ok = true; } catch (e) { console.warn("glass layer unavailable:", e && e.message); this.ok = false; }
  }
  _init() {
    const c = this.canvas = document.createElement("canvas");
    // (only as big as the icons on screen need: grown and shrunk with them, see _draw;
    // every icon's tile is copied out of it every frame, so a smaller one costs less)
    c.width = 256; c.height = 256; this._shrink = 0;
    const gl = this.gl = c.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("no WebGL2");
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.u = {};
    for (const n of ["uWave", "uShade", "uMap", "uRect", "uBox", "uMag", "uEdge", "uAber", "uGlow", "uHasWave", "uSolid", "uBody", "uBodyK"]) this.u[n] = gl.getUniformLocation(p, n);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.waveTex = this._tex(); this.hasWave = false;
    this.backdrop = false; this._bd = null; this._bdAt = 0;
    c.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.ok = false; this.stop(); });
  }
  _tex() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  // Icon Settings > "Reactive Icons over Background/Overlay":
  // what's seen through the glass is everything behind the icons (a PS3
  // theme's background, your background and overlay, the wave), not the wave
  // alone. (Off to begin with: putting the layers together costs a little
  // every frame.)
  setBackdrop(on) {
    on = !!on; if (on === this.backdrop) return;
    this.backdrop = on; this._sig = ""; this._bdAt = 0;
    if (!on) this._freeBackdrop();
  }
  // Everything the backdrop used, given back (turned off, or the layer stopped)
  _freeBackdrop() {
    const gl = this.gl;
    if (gl && this.ok) {
      if (this._cfb) gl.deleteFramebuffer(this._cfb);
      if (this._ctex) gl.deleteTexture(this._ctex);
      if (this._white) gl.deleteTexture(this._white);
      if (this._lt) for (const v of this._lt.values()) gl.deleteTexture(v.tex);
    }
    this._cfb = null; this._ctex = null; this._white = null; this._cW = 0; this._cH = 0;
    this._lt = null; this._cssPic = null; this._geo = null; this._bdOk = false;
    if (window.__onLayerFrame === this._layerHook) window.__onLayerFrame = null;
  }
  // The layers behind the icons (a PS3 theme's background, your background
  // and overlay, the wave, an item's own background), bottom to top, put
  // together on the graphics card into one picture at half the wave's size,
  // which the glass then bends. Each picture / video / canvas is a texture: a
  // picture loaded once, a video's frame copied as it plays, an animated
  // canvas (the overlay's keyer, a PS3 theme's scene) copied right after it
  // draws (__onLayerFrame), the wave as it's drawn. Nothing is read back to
  // the processor.
  _compose() {
    const gl = this.gl, wave = this._waveCanvas;
    if (!gl || !wave) return false;
    const W = Math.max(2, Math.round(wave.width / 2)), H = Math.max(2, Math.round(wave.height / 2));
    if (!this._cprog) this._initCompose();
    if (!this._cprog) return false;
    if (!this._cfb || this._cW !== W || this._cH !== H) {
      if (this._cfb) gl.deleteFramebuffer(this._cfb);
      if (this._ctex) gl.deleteTexture(this._ctex);
      this._ctex = this._tex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this._cfb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._cfb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._ctex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); this._freeBackdrop(); this._cprog = null; return false; }
      this._cW = W; this._cH = H;
    }
    if (!this._lt) this._lt = new Map();
    if (!window.__onLayerFrame) window.__onLayerFrame = this._layerHook;
    // where each layer is and how it shows: looked at again at most every 0.1 s
    // (reading styles and boxes every frame makes the browser work the page out again)
    const now = performance.now();
    if (!this._geo || now - this._geo.at > 100) this._geo = { at: now, list: this._layers(wave) };
    const { list, wr } = this._geo.list;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._cfb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this._cprog); gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this._cu.uT, 0);
    const sx = W / Math.max(1, wr.width), sy = H / Math.max(1, wr.height);
    const seen = new Set();
    for (const L of list) {
      let tex = null;
      if (L.kind === "fill") tex = this._white || (this._white = this._whiteTex());
      else if (L.kind === "wave") tex = this.waveTex;
      else { tex = this._layerTex(L.el); seen.add(L.el); }
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform4f(this._cu.uCol, ...(L.col || [1, 1, 1, 1]));
      gl.uniform1f(this._cu.uA, L.a);
      // the picture's place (fitted as it's shown), cut to its box
      gl.uniform4f(this._cu.uDst, (L.dx - wr.left) * sx / W, (L.dy - wr.top) * sy / H, L.dw * sx / W, L.dh * sy / H);
      if (L.clip) {
        gl.enable(gl.SCISSOR_TEST);
        const x0 = Math.max(0, Math.floor((L.clip.left - wr.left) * sx)), y0 = Math.max(0, Math.floor((L.clip.top - wr.top) * sy));
        gl.scissor(x0, y0, Math.max(0, Math.ceil(L.clip.width * sx)), Math.max(0, Math.ceil(L.clip.height * sy)));
      } else gl.disable(gl.SCISSOR_TEST);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // (the textures of pictures no longer shown, let go of)
    for (const [el, v] of this._lt) if (!seen.has(el) && !el.isConnected) { gl.deleteTexture(v.tex); this._lt.delete(el); }
    this._bdOk = true;
    return true;
  }
  _initCompose() {
    const gl = this.gl;
    const VS2 = `#version 300 es
in vec2 aPos; uniform vec4 uDst; out vec2 vT;
void main() { vT = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vec2 p = uDst.xy + vT * uDst.zw; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
    const FS2 = `#version 300 es
precision mediump float; uniform sampler2D uT; uniform vec4 uCol; uniform float uA; in vec2 vT; out vec4 o;
void main() { vec4 c = texture(uT, vT) * uCol; o = vec4(c.rgb, c.a * uA); }`;
    try {
      const sh = (t, src) => { const x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS2)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS2));
      gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this._cprog = p; this._cu = {};
      for (const n of ["uT", "uDst", "uCol", "uA"]) this._cu[n] = gl.getUniformLocation(p, n);
    } catch (e) { console.warn("glass backdrop unavailable:", e && e.message); this._cprog = null; }
    // (an animated canvas has just drawn: its frame copied now, while it's there)
    this._layerHook = (cv) => { if (this.backdrop && this._lt && this._lt.has(cv)) this._upLayer(cv, this._lt.get(cv)); };
  }
  _whiteTex() {
    const gl = this.gl, t = this._tex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    return t;
  }
  // a layer's texture: a picture once (again if its picture changes), a video every time
  _layerTex(el) {
    if (el.__noRead) return null;
    let v = this._lt.get(el);
    const src = el.tagName === "CANVAS" ? "canvas" : (el.currentSrc || el.src || "");
    if (!v) { v = { tex: this._tex(), src: null, w: 0, h: 0 }; this._lt.set(el, v); }
    if (el.tagName === "VIDEO") {
      // (a video's frame copied only when it has a new one, at most 15 times a
      // second: what's seen through the glass needn't be smoother)
      if (!v.watch && el.requestVideoFrameCallback) {
        v.watch = true; v.fresh = true;
        const onFrame = () => { v.fresh = true; if (this._lt && this._lt.get(el) === v) el.requestVideoFrameCallback(onFrame); };
        el.requestVideoFrameCallback(onFrame);
      }
      const now = performance.now();
      if (el.readyState >= 2 && (v.fresh || !el.requestVideoFrameCallback) && now - (v.at || 0) >= 66) { v.fresh = false; v.at = now; this._upLayer(el, v); }
    }
    else if (el.tagName === "IMG") { if (v.src !== src && el.complete && el.naturalWidth) { if (this._upLayer(el, v)) v.src = src; } }
    // (a canvas: copied as it draws, see _layerHook; the first time, now)
    else if (!v.src) { this._upLayer(el, v); v.src = "canvas"; }
    return v.w ? v.tex : null;
  }
  _upLayer(el, v) {
    const gl = this.gl;
    let w = el.videoWidth || el.naturalWidth || el.width, h = el.videoHeight || el.naturalHeight || el.height;
    if (!w || !h) return false;
    // (a video's frame through a small copy, at most 640 x 360 (the backdrop is
    // half the screen's size): copied straight, the upload waits for all the
    // graphics work before it)
    if (el.tagName === "VIDEO") {
      const k = Math.min(1, 640 / w, 360 / h), cw = Math.max(2, Math.round(w * k)), ch = Math.max(2, Math.round(h * k));
      if (!v.cv || v.cv.width !== cw || v.cv.height !== ch) { v.cv = document.createElement("canvas"); v.cv.width = cw; v.cv.height = ch; v.cx = v.cv.getContext("2d"); }
      try { v.cx.drawImage(el, 0, 0, cw, ch); } catch (e) { return false; }
      el = v.cv; w = cw; h = ch;
    }
    gl.bindTexture(gl.TEXTURE_2D, v.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      if (v.w === w && v.h === h) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, el);
      else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el); v.w = w; v.h = h; }
      return true;
    } catch (e) {
      // (a picture from another address the page may not read: left out)
      el.__noRead = true; return false;
    }
  }
  // the layers as they're shown now, bottom to top: [{kind, el, dx, dy, dw, dh, clip, a, col}]
  _layers(wave) {
    const wr = wave.getBoundingClientRect(), list = [];
    const shown = (el) => { if (!el || !el.isConnected) return 0; let a = 1; for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return 0; a *= +cs.opacity; } return a; };
    const readable = (m) => {
      if (m.tagName === "CANVAS") return true;
      if (m.__noRead) return false;
      const s = m.currentSrc || m.src || "";
      try { const u = new URL(s, location.href); if (u.protocol === "data:" || u.protocol === "blob:" || u.origin === location.origin) return true; } catch (e) { return false; }
      return m.crossOrigin != null;
    };
    const put = (m, box = null) => {
      if (!readable(m)) return;
      const a = shown(box || m); if (a <= 0.01) return;
      const iw = m.videoWidth || m.naturalWidth || m.width, ih = m.videoHeight || m.naturalHeight || m.height;
      if (!iw || !ih) return;
      const r = (box || m).getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
      const fit = box ? "cover" : (getComputedStyle(m).objectFit || "fill");
      let dw = r.width, dh = r.height;
      if (m.tagName !== "CANVAS" && (fit === "cover" || fit === "contain")) {
        const k = fit === "cover" ? Math.max(r.width / iw, r.height / ih) : Math.min(r.width / iw, r.height / ih);
        dw = iw * k; dh = ih * k;
      } else if (m.tagName !== "CANVAS" && fit === "none") { dw = iw; dh = ih; }
      list.push({ kind: "el", el: m, dx: r.left + (r.width - dw) / 2, dy: r.top + (r.height - dh) / 2, dw, dh, clip: { left: r.left, top: r.top, width: r.width, height: r.height }, a });
    };
    for (const id of ["p3tbg", "wallpaper", "bgtint", "overlay"]) {
      const layer = document.getElementById(id);
      const la = shown(layer); if (la <= 0.01) continue;
      if (id === "bgtint") {
        const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(layer).backgroundColor || "");
        if (m) { const c = m[1].split(",").map((v) => parseFloat(v)); const al = c.length > 3 ? c[3] : 1;
          if (al > 0) list.push({ kind: "fill", dx: wr.left, dy: wr.top, dw: wr.width, dh: wr.height, a: la * al, col: [c[0] / 255, c[1] / 255, c[2] / 255, 1] }); }
        continue;
      }
      for (const m of layer.querySelectorAll("img, video, canvas")) put(m);
    }
    list.push({ kind: "wave", dx: wr.left, dy: wr.top, dw: wr.width, dh: wr.height, a: 1 });
    // (an item's own backdrop over all that: a game's background, What's New...)
    const ib = document.querySelector("#xmb .bg-layer");
    if (ib && shown(ib) > 0.01) {
      for (const m of ib.querySelectorAll("img, video, canvas")) put(m);
      const css = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(ib).backgroundImage || "");
      const im = css && this._cssPicture(css[1]);
      if (im) put(im, ib);
    }
    this._bdHasVideo = list.some((L) => L.el && (L.el.tagName === "VIDEO" || L.el.tagName === "CANVAS"));
    return { list, wr };
  }
  // a picture shown as a CSS background (a game's), loaded to be read; only
  // the one in use is kept
  _cssPicture(url) {
    const c = this._cssPic;
    if (c && c.url === url) return c.ok ? c.img : null;
    if (c && this._lt && this._lt.has(c.img)) { this.gl.deleteTexture(this._lt.get(c.img).tex); this._lt.delete(c.img); }
    const img = new Image(), rec = this._cssPic = { url, img, ok: false };
    img.decoding = "async";
    readableFrom(img, url);
    img.onload = () => { rec.ok = true; this._bdAt = 0; this._geo = null; };
    img.src = url;
    return null;
  }
  // the wave's picture, copied into its texture
  _upload(src) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // (the same size as last time: copied into the texture it has, not a new one)
    if (this._waveW === src.width && this._waveH === src.height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); this._waveW = src.width; this._waveH = src.height; }
  }
  // Icon Style Default (true) or Glass (false, the clear glass)
  setFilled(on) { const b = on ? (window.__lgBody ?? BODY) : 0; if (b !== this.body) { this.body = b; this._sig = ""; } }
  // on: the Default icon style is in use (the layer draws); off: everything put back
  start() {
    if (!this.ok || this.on) return;
    this.on = true;
    window.__onWaveFrame = (canvas) => this._onWave(canvas);
    requestAnimationFrame(this._loop);
  }
  stop() {
    this.on = false;
    if (window.__onWaveFrame) window.__onWaveFrame = null;
    for (const el of [...document.querySelectorAll(".lg-on, .lg-live")]) this.detach(el);
    this._freeBackdrop();
    if (this.ok) { const gl = this.gl; for (const v of this.shades.values()) gl.deleteTexture(v.tex); for (const t of this.maps.values()) gl.deleteTexture(t); }
    this.shades.clear(); this.maps.clear(); this._sig = "";
  }
  // the icons' glass shapes were made again (Delete Icon Shading / All Cache):
  // the old ones let go
  forgetMaps() {
    if (this.ok) for (const t of this.maps.values()) this.gl.deleteTexture(t);
    this.maps.clear(); this._sig = "";
  }
  // an icon to draw: key (its picture's name), map (iconshade glassMap), url (its glass image)
  attach(el, map, url) {
    if (!this.ok || !map || !url) { this.detach(el); return; }
    el.__lg = { map, url, solid: el.classList.contains("cust-solid") }; el.__lgKey = null;
    el.classList.add("lg-live");
    this._sig = "";
  }
  detach(el) {
    if (!el) return;
    el.classList.remove("lg-live", "lg-on");
    el.__lgKey = null;
    if (el.__lgc) { el.__lgc.remove(); el.__lgc = null; }
    el.__lg = null;
  }
  // (from the wave's own frame: its picture is there to copy only now)
  _onWave(canvas) {
    if (!this.on) return;
    try {
      this._waveCanvas = canvas;
      this._upload(canvas);
      this.hasWave = canvas.width > 1;
      this._waveRect = canvas.getBoundingClientRect();
      if (this.backdrop) { this._compose(); this._bdAt = performance.now(); }
    } catch (e) { this.hasWave = false; }
    this._draw(true); this._waveDrew = true;
  }
  _loop() {
    if (!this.on) return;
    // (a game running, or power saving with the window out of focus: nothing
    // moves, so the icons are only looked at twice a second)
    const b = document.body.classList;
    if (b.contains("in-game") || b.contains("lowpower")) { setTimeout(() => requestAnimationFrame(this._loop), 500); return; }
    // (the wave's own frame already drew the icons for this one)
    if (this._waveDrew) this._waveDrew = false;
    // (over backgrounds and overlays with the wave holding still: what's
    // behind is put together again anyway, about 30 times a second while a
    // video moves there (background, overlay, a PS3 theme's animation), a
    // couple of times a second otherwise (a new picture, the option turned on))
    else if (this.backdrop && this._waveCanvas && (!this._bdOk || performance.now() - this._bdAt > (this._bdHasVideo ? 66 : 400))) {
      try { if (this._compose()) this.hasWave = true; } catch (e) {}
      this._bdAt = performance.now(); this._draw(true);
    }
    else this._draw(false);
    requestAnimationFrame(this._loop);
  }
  _shadeTex(url) {
    let v = this.shades.get(url);
    if (v) { v.used = this._frame; return v.tex; }
    const img = loadedIcon(url);
    if (!img) { loadIconImage(url).then(() => { this._sig = ""; }).catch(() => {}); return null; }
    const gl = this.gl, tex = this._tex();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    this.shades.set(url, { tex, used: this._frame });
    return tex;
  }
  _mapTex(map) {
    let t = this.maps.get(map.id);
    if (t) return t;
    const gl = this.gl; t = this._tex();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, map.w, map.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, map.data);
    this.maps.set(map.id, t);
    return t;
  }
  // the shared canvas's size for w x h of tiles: grown at once (in steps of
  // 128, so a growing icon doesn't make a new one every frame), shrunk when
  // far too big for a while
  _fit(w, h) {
    const c = this.canvas, cw = Math.min(ATLAS, Math.ceil(w / 128) * 128), ch = Math.min(ATLAS, Math.ceil(h / 128) * 128);
    if (cw > c.width || ch > c.height) { c.width = Math.max(c.width, cw); c.height = Math.max(c.height, ch); this._shrink = 0; }
    else if (cw * ch * 2 < c.width * c.height) { if (++this._shrink > 120) { c.width = cw; c.height = ch; this._shrink = 0; } }
    else this._shrink = 0;
  }
  // force: a new wave picture (draw even if nothing moved)
  _draw(force) {
    if (!this.ok) return;
    this._frame++;
    const vw = window.innerWidth || 1, vh = window.innerHeight || 1, dpr = Math.min(2, window.devicePixelRatio || 1);
    const items = [];
    let sig = "";
    for (const el of this.els) {
      const lg = el.__lg; if (!lg) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) { if (el.__lgc) el.__lgc.style.display = "none"; el.__lgKey = null; continue; }
      // (fully faded out, by itself or its row / column: nothing of it shows,
      // so it isn't drawn; it is again the moment it starts showing)
      if (CHECK_VIS && !el.checkVisibility(VIS_OPTS)) { sig += "h;"; el.__lgKey = null; continue; }
      items.push([el, r, lg]);
      sig += `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0},${lg.url.length};`;
    }
    if (!force && sig === this._sig) return;
    this._sig = sig;
    if (!items.length) return;
    const gl = this.gl;
    // (the wave fills the window; a different box, e.g. while it's scaled: measured)
    const wr = this._waveRect && this._waveRect.width > 1 ? this._waveRect : { left: 0, top: 0, width: vw, height: vh };
    // A new wave picture: every icon is drawn again. Otherwise (icons moving
    // over a wave that holds still: Still Waves, power saving) only the ones
    // that moved, grew or changed picture; the others keep the glass they
    // have, as what's behind them is the same.
    // where each icon's tile goes (and its pictures, ready on the graphics card)
    let x = 0, y = 0, row = 0, needW = 0;
    const tiles = [];
    for (const [el, r, lg] of items) {
      const tw = Math.max(2, Math.min(TILE_MAX, Math.round(r.width * dpr))), th = Math.max(2, Math.min(TILE_MAX, Math.round(r.height * dpr)));
      const key = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)},${tw},${th},${lg.url},${lg.solid ? 1 : 0},${wr.left.toFixed(1)},${wr.top.toFixed(1)},${wr.width.toFixed(1)},${wr.height.toFixed(1)}`;
      if (!force && el.__lgKey === key) { if (el.__lgc) el.__lgc.style.display = ""; continue; }
      if (x + tw > ATLAS) { x = 0; y += row; row = 0; }
      if (y + th > ATLAS) break;            // (more icons than fit: the rest keep their plain glass)
      const st = this._shadeTex(lg.url), mt = this._mapTex(lg.map);
      if (!st || !mt) continue;
      tiles.push([el, r, lg, st, mt, x, y, tw, th, key]);
      x += tw; row = Math.max(row, th); needW = Math.max(needW, x);
    }
    if (!tiles.length) return;
    this._fit(needW, y + row);
    const c = this.canvas, CH = c.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, c.width, CH);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.uniform1i(this.u.uWave, 0); gl.uniform1i(this.u.uShade, 1); gl.uniform1i(this.u.uMap, 2);
    gl.uniform1f(this.u.uMag, MAG); gl.uniform1f(this.u.uEdge, EDGE); gl.uniform1f(this.u.uAber, ABER); gl.uniform1f(this.u.uGlow, GLOW);
    gl.uniform1f(this.u.uHasWave, this.hasWave ? 1 : 0);
    gl.uniform1f(this.u.uBody, this.body); gl.uniform1f(this.u.uBodyK, window.__lgBodyK ?? BODY_K);
    // (what's behind: everything put together, or the wave alone)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.backdrop && this._bdOk && this._ctex ? this._ctex : this.waveTex);
    const drawn = [];
    for (const [el, r, lg, st, mt, tx, ty, tw, th, key] of tiles) {
      gl.viewport(tx, CH - ty - th, tw, th);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, st);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mt);
      gl.uniform4f(this.u.uRect, (r.left - wr.left) / wr.width, (r.top - wr.top) / wr.height, r.width / wr.width, r.height / wr.height);
      // (the picture is a square letterboxed into the icon's box)
      const s = Math.min(r.width, r.height);
      gl.uniform2f(this.u.uBox, s / r.width, s / r.height);
      gl.uniform1f(this.u.uSolid, lg.solid ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      drawn.push([el, tx, ty, tw, th]); el.__lgKey = key;
    }
    for (const [el, sx, sy, tw, th] of drawn) {
      let c = el.__lgc;
      if (!c || c.parentNode !== el) {
        c = el.__lgc = document.createElement("canvas");
        c.className = "lg-canvas";
        el.appendChild(c);
      }
      if (c.width !== tw || c.height !== th) { c.width = tw; c.height = th; }
      c.style.display = "";
      const ctx = c.__ctx || (c.__ctx = c.getContext("2d"));
      ctx.clearRect(0, 0, tw, th);
      ctx.drawImage(this.canvas, sx, sy, tw, th, 0, 0, tw, th);
      if (!el.classList.contains("lg-on")) el.classList.add("lg-on");
    }
    // pictures no longer shown for a while: let go
    if (this._frame % 600 === 0) for (const [k, v] of this.shades) if (this._frame - v.used > 600) { gl.deleteTexture(v.tex); this.shades.delete(k); }
  }
}

let _layer = null;
export function glassLayer() { return _layer || (_layer = new GlassLayer()); }
