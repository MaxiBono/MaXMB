// Background + Overlay layers.
//
// The background (theme "wallpaper") can be an image, an animated GIF or a
// video; how it fills the screen is the theme's Background Display (fit.js).
// The Overlay sits on top of it: a transparent image, or a video whose
// green-screen green is keyed out in real time with a tiny WebGL shader.
// Videos are always muted and loop.

// every video type the system lists (the same list as media.rs VIDEO_EXTS)
export const VIDEO_RE = /\.(mp4|m4v|webm|mkv|avi|mov|wmv|asf|flv|mpg|mpeg|m2ts|mts|ts|vob|3gp|ogv|divx|3g2|f4v|rm|rmvb|mxf|ogm|dv|mod|tod|m2v|m1v|mpe|mpv|m2t|trp|tp|evo|vro|qt|amv|nsv|xvid|h264|264|hevc|265|y4m|bik|nut)$/i;
// (a "?" / "#" only starts a query / fragment in a web address: in a file's
// own name, "#" is just a letter, as in "Clip #greenscreen #mj.mp4", whose
// cut-off name used to make the video count as a picture and never show)
export const isVideoPath = (p) => {
  const s = String(p || "");
  return VIDEO_RE.test(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(blob|data):/i.test(s) ? s.split(/[?#]/)[0] : s);
};

// A background / overlay picture or video that fails to load (its request can
// lose out while a menu loads many small pictures at once) is asked for again
// a few times; once it's ready, a "bgmedia-ready" event lets a menu open over
// it draw what's behind it again (its blur would otherwise keep the black).
function retrying(el, src, ready) {
  let tries = 0;
  el.addEventListener("error", () => {
    if (tries >= 4 || !el.isConnected) return;
    tries++;
    setTimeout(() => { if (el.isConnected) { el.src = src + (src.includes("?") ? "&" : "?") + "retry=" + tries; if (el.play) el.play().catch(() => {}); } }, 600 * tries);
  });
  el.addEventListener(ready, () => {
    // the layer is black only once its picture is there (until then whatever
    // is behind it shows, never a black screen)
    el.parentElement?.classList.add("ready");
    const fire = () => window.dispatchEvent(new Event("bgmedia-ready"));
    // tell the menus once the picture is decoded, and again a little later
    // (a blurred menu re-draws what's behind it each time)
    Promise.resolve(el.decode ? el.decode().catch(() => {}) : null).then(() => { fire(); setTimeout(fire, 400); setTimeout(fire, 1500); });
  });
}
function mediaEl(src, path) {
  if (isVideoPath(path)) {
    const v = document.createElement("video");
    Object.assign(v, { src, muted: true, loop: true, autoplay: true, playsInline: true });
    v.defaultMuted = true; v.volume = 0;
    v.setAttribute("muted", "");
    retrying(v, src, "loadeddata");
    v.play().catch(() => {});
    return v;
  }
  const img = document.createElement("img");
  img.alt = "";
  retrying(img, src, "load");
  img.src = src;
  return img;
}

// Fill `el` with the media at `path` (src = its loadable URL). Returns true if shown.
export function setLayerMedia(el, src, path) {
  if (!el) return false;
  // already showing this picture / video: leave it (no reload or flicker)
  if (src && el._src === src && !el._chroma && el.firstChild) { el.classList.add("show"); return true; }
  if (el._chroma) { el._chroma.stop(); el._chroma = null; }
  el.innerHTML = ""; el._src = null; el._chromaSrc = null; el.classList.remove("ready");
  if (!src) { el.classList.remove("show"); return false; }
  el.appendChild(mediaEl(src, path));
  el._src = src;
  el.classList.add("show");
  return true;
}

// Overlay: images as they are; videos through the green-screen keyer.
// `key` = the colour removed: "green" (default), "blue" or a "#rrggbb" colour.
export function setOverlayMedia(el, src, path, strength = 0.5, key = "green") {
  if (!el) return false;
  // same video already keyed: just update the strength / key colour
  if (el._chroma && el._chromaSrc === src) { el._chroma.strength = strength; el._chroma.setKey(key); return true; }
  if (!src || !isVideoPath(path)) return setLayerMedia(el, src, path);   // images (or nothing)
  if (el._chroma) { el._chroma.stop(); el._chroma = null; }
  el.innerHTML = ""; el._src = null;
  const k = new ChromaKeyVideo(src);
  if (!k.ok) { return setLayerMedia(el, src, path); }   // no WebGL: plain video
  k.strength = strength; k.setKey(key);
  el.appendChild(k.canvas);
  el._chroma = k; el._chromaSrc = src;
  el.classList.add("show");
  return true;
}

const VS = `attribute vec2 p; varying vec2 uv;
void main(){ uv = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.0,1.0); }`;
// Colour key. Green / blue screens: how much a pixel's key channel (uCh)
// beats the other two decides its transparency; a soft edge plus spill
// removal keeps hair / edges clean. A custom colour (uMode 1): pixels whose
// colour (hue + saturation, brightness ignored) is close to uKey go.
// uS = strength 0..1: 0 keeps the video untouched, 1 removes the most.
const FS = `precision mediump float; varying vec2 uv; uniform sampler2D t; uniform float uS;
uniform float uMode; uniform vec3 uCh; uniform vec3 uKey;
vec2 chroma(vec3 c){ return vec2(dot(c, vec3(-0.169, -0.331, 0.5)), dot(c, vec3(0.5, -0.419, -0.081))); }
void main(){
  vec4 c = texture2D(t, uv);
  vec3 col = c.rgb;
  float a = 1.0;
  if (uS > 0.0) {
    if (uMode < 0.5) {
      float k = dot(c.rgb, uCh);
      vec3 o3 = c.rgb * (1.0 - uCh);
      float o = max(o3.r, max(o3.g, o3.b));
      float g = k - o;
      float lo = mix(0.32, 0.01, uS);
      a = 1.0 - smoothstep(lo, lo + mix(0.22, 0.08, uS), g);
      if (k < mix(0.45, 0.06, uS)) a = 1.0;
      float spill = (k - min(k, o + 0.02)) * smoothstep(0.0, 0.2, g) * uS;
      col -= uCh * spill;
    } else {
      float d = distance(chroma(c.rgb), chroma(uKey));
      float lo = mix(0.02, 0.16, uS);
      a = smoothstep(lo, lo + 0.07, d);
      float lk = dot(uKey, vec3(0.299, 0.587, 0.114)), lc = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      if (abs(lc - lk) > mix(0.25, 0.75, uS)) a = 1.0;
    }
  }
  gl_FragColor = vec4(col * a, a);
}`;

class ChromaKeyVideo {
  constructor(src) {
    this.video = document.createElement("video");
    Object.assign(this.video, { src, muted: true, loop: true, autoplay: true, playsInline: true, crossOrigin: "anonymous" });
    this.video.volume = 0; this.video.setAttribute("muted", "");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "chroma";
    const gl = this.gl = this.canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true });
    this.ok = !!gl;
    if (!gl) return;
    const sh = (type, txt) => { const s = gl.createShader(type); gl.shaderSource(s, txt); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); gl.useProgram(pr);
    this.uS = gl.getUniformLocation(pr, "uS");
    this.uMode = gl.getUniformLocation(pr, "uMode");
    this.uCh = gl.getUniformLocation(pr, "uCh");
    this.uKey = gl.getUniformLocation(pr, "uKey");
    this.strength = 0.5;
    this.setKey("green");
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.running = true;
    this.video.play().catch(() => {});
    const draw = () => {
      if (!this.running) return;
      const v = this.video;
      if (v.readyState >= 2 && v.videoWidth) {
        const w = Math.min(v.videoWidth, 1920), h = Math.round(v.videoHeight * w / v.videoWidth);
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; gl.viewport(0, 0, w, h); }
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
          gl.uniform1f(this.uS, Math.max(0, Math.min(1, this.strength)));
          gl.uniform1f(this.uMode, this._key.mode);
          gl.uniform3f(this.uCh, ...this._key.ch);
          gl.uniform3f(this.uKey, ...this._key.rgb);
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } catch (e) {
          // a cross-origin video can't be read by WebGL: reload it from an
          // in-memory copy (same origin) once
          if (e && e.name === "SecurityError" && !this._blobTried) this._toBlob(src);
        }
      }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw);
    };
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(draw); else requestAnimationFrame(draw);
  }
  setKey(key) {
    const k = String(key || "green").toLowerCase();
    if (k === "blue") this._key = { mode: 0, ch: [0, 0, 1], rgb: [0, 0, 1] };
    else if (/^#[0-9a-f]{6}/.test(k)) {
      const n = (i) => parseInt(k.slice(i, i + 2), 16) / 255;
      this._key = { mode: 1, ch: [0, 1, 0], rgb: [n(1), n(3), n(5)] };
    } else this._key = { mode: 0, ch: [0, 1, 0], rgb: [0, 1, 0] };
  }
  _toBlob(src) {
    this._blobTried = true;
    fetch(src).then((r) => r.blob()).then((b) => {
      if (!this.running) return;
      this._blobUrl = URL.createObjectURL(b);
      this.video.removeAttribute("crossorigin");
      this.video.src = this._blobUrl; this.video.play().catch(() => {});
    }).catch(() => {});
  }
  stop() {
    this.running = false;
    if (this._blobUrl) URL.revokeObjectURL(this._blobUrl);
    try { this.video.pause(); this.video.removeAttribute("src"); this.video.load(); } catch (e) {}
  }
}
