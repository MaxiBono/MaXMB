// The PS3 Music Player's Earth visualizer (qgl_gaia_app, firmware 4.93), remade on WebGL2 from
// the console's earth.qrc: its pictures of the Earth (ground, sea and clouds: the 6 faces of a
// cube, each 2 x 2 tiles of 512 px, file "row_column"), its stars and sun disk, and its 30
// camera flights (earth/presets/*/earth/camera.path, each with its own settings). On every
// new song a flight is chosen at random (gaia::startRandomVisTrack) and played from its start.
//
// From the console: the pictures and how they fit on the cube, the flights and how they're
// played (qglbase's camera path: cubic segments, each key's slope the time-weighted mean of
// its neighbours'), the sun's direction (SUN ANG Y / Z), the field of view, the settings.
// Rebuilt: the drawing itself. The console draws the Earth in patches (CubeEarthLayer) and
// works its atmosphere out on an SPU every frame; here the atmosphere is the single
// scattering model the console's settings are made for (Sean O'Neil's, GPU Gems 2), with the
// console's wavelengths and sun intensity, worked out for every pixel.

import { Archive, parseMnu, decodeDds } from "./formats.js";
import { fetchPs3File } from "./files.js";


let _archive = null;
export function loadEarth() {
  if (_archive) return _archive;
  _archive = (async () => Archive.fromBytes(await fetchPs3File("earth.qrc")))();
  _archive.catch(() => { _archive = null; });
  return _archive;
}
// (the Visualizers Cache let go: read again when next needed)
export function dropEarth() { _archive = null; }

// ------------------------------------------------------------------ the cube's faces
// (worked out from the pictures: seams matched across all 12 cube edges, ground and clouds
// agreeing) GL cube slot -> [file face, orientation]; orientation bits: 4 transpose,
// 1 mirror left-right, 2 mirror top-bottom (applied in that order). -Y is north.
const SLOTS = [[0, 0], [2, 0], [4, 5], [5, 6], [1, 0], [3, 0]];
async function jpg(archive, id) {
  const blob = new Blob([archive.file(id)], { type: "image/jpeg" });
  return createImageBitmap(blob);
}
// one face (1024 x 1024) drawn on `c`: its 4 tiles, turned as SLOTS says (by the canvas: the
// same pixels as turning them by hand, without reading them back)
async function drawFace(c, archive, layer, f, o) {
  const g = c.getContext("2d"), n = 1024;
  g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.clearRect(0, 0, n, n);
  // canvas (u = column, v = row) -> face (x, y): flips (1: left-right, 2: top-bottom) after a transpose (4)
  const fx = o & 1 ? -1 : 1, ex = o & 1 ? n : 0, fy = o & 2 ? -1 : 1, ey = o & 2 ? n : 0;
  if (o & 4) g.setTransform(0, fy, fx, 0, ex, ey); else g.setTransform(fx, 0, 0, fy, ex, ey);
  const ims = await Promise.all([0, 1, 2, 3].map((k) =>
    jpg(archive, `earth/flashrom/${layer}/${f}/1/${String(k >> 1).padStart(3, "0")}_${String(k & 1).padStart(3, "0")}.jpg`)));
  ims.forEach((im, k) => { g.drawImage(im, (k & 1) * 512, (k >> 1) * 512, 512, 512); im.close && im.close(); });
  g.setTransform(1, 0, 0, 1, 0, 0);
}
const pause = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ camera flights
// "time=T eye x y z center x y z up x y z [fovy=F]" lines, then closed= / loop= / close_dt= / speed=
function parsePath(text) {
  const keys = [], opt = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim(); if (!s) continue;
    const m = /^time=([-\d.e]+)\s+eye\s+(\S+)\s+(\S+)\s+(\S+)\s+center\s+(\S+)\s+(\S+)\s+(\S+)\s+up\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+fovy=(\S+))?/.exec(s);
    if (m) {
      const v = m.slice(1).map((x) => (x === undefined ? NaN : parseFloat(x)));
      keys.push({ t: v[0], eye: v.slice(1, 4), center: v.slice(4, 7), up: v.slice(7, 10), fovy: v[10] });
    } else { const k = /^(\w+)=([-\d.e]+)/.exec(s); if (k) opt[k[1]] = parseFloat(k[2]); }
  }
  if (keys.length) { const t0 = keys[0].t; for (const k of keys) k.t -= t0; }
  return { keys, opt };
}
// qglbase's spline (0x36638): each key's slope is the mean of the slopes on either side,
// weighted by their lengths of time; the ends take their one slope; cubic between keys
function spline(times, vals) {
  const n = vals.length, T = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const d0 = i > 0 ? times[i] - times[i - 1] : 0, d1 = i < n - 1 ? times[i + 1] - times[i] : 0;
    const s0 = d0 ? (vals[i] - vals[i - 1]) / d0 : 0, s1 = d1 ? (vals[i + 1] - vals[i]) / d1 : 0;
    T[i] = !d0 ? s1 : !d1 ? s0 : (d0 * s0 + d1 * s1) / (d0 + d1);
  }
  return (t) => {
    if (n === 1 || t <= times[0]) return vals[0];
    if (t >= times[n - 1]) return vals[n - 1];
    let i = 0; while (i < n - 2 && t > times[i + 1]) i++;
    const dt = times[i + 1] - times[i], u = (t - times[i]) / dt, w = 1 - u;
    const p0 = vals[i], p1 = vals[i] + T[i] * dt / 3, p2 = vals[i + 1] - T[i + 1] * dt / 3, p3 = vals[i + 1];
    return w * w * w * p0 + 3 * w * w * u * p1 + 3 * w * u * u * p2 + u * u * u * p3;
  };
}
function makeFlight(path, fovDefault) {
  const k = path.keys, ts = k.map((x) => x.t);
  const ch = (f) => spline(ts, k.map(f));
  const E = [0, 1, 2].map((i) => ch((x) => x.eye[i])), C = [0, 1, 2].map((i) => ch((x) => x.center[i]));
  const U = [0, 1, 2].map((i) => ch((x) => x.up[i]));
  const F = ch((x) => (Number.isFinite(x.fovy) ? x.fovy : fovDefault));
  return { length: ts[ts.length - 1] || 0, at: (t) => ({ eye: E.map((s) => s(t)), center: C.map((s) => s(t)), up: U.map((s) => s(t)), fovy: F(t) }) };
}

// ------------------------------------------------------------------ shaders
const VS = `#version 300 es
layout(location = 0) in vec2 p;
out vec2 v_p;
void main() { v_p = p; gl_Position = vec4(p, 0.0, 1.0); }
`;
// matched to a capture of the console (720p): stars (sparser), the air over the ground, the edge's
// rim, the glow outside the edge (strength, width), a bluer sea, the sun's glint on it
const EARTH_TUNE = [1.8, 0.8, 0.22, 0.5, 0.06, 0.008, 0.0, 2.6];
// Everything per pixel: the ray from the eye, the Earth (radius 1) with its ground, sea and
// clouds, the atmosphere (radius uAtm) in front of it and around it, the stars and the sun.
const FS = `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform vec3 uEye, uRight, uUp, uFwd;
uniform vec2 uTan;           // tan(fov / 2) * (aspect, 1)
uniform vec3 uSun;           // towards the sun
uniform samplerCube uGround, uSpec, uCloud;
uniform sampler2D uStars, uDisk;
uniform float uAtm, uKrESun, uKmESun, uKr4PI, uKm4PI, uG, uScale, uScaleDepth;
uniform vec3 uInvWave;       // 1 / wavelength^4
uniform vec3 uSunCol;
uniform float uExposure, uWhite, uCloudBright, uCloudBlend, uShadow, uParallax;
uniform float uSeaAlbedo, uSeaPow, uLandAlbedo, uLandPow, uStarsK, uSunVis, uGlare, uSunSize;
uniform float uTime, uCloudSpin;
uniform vec4 uTune0, uTune1;   // (looks matched to the console's captures)
#define TS_POW uTune0.x
#define TS_K uTune0.y
#define T_HAZE uTune0.z
#define T_RIM uTune0.w
#define T_HALO uTune1.x
#define T_HALOW uTune1.y
#define T_SEA uTune1.z
#define T_GLINT uTune1.w
const int NS = 6;
float scaleF(float c) { float x = 1.0 - c; return uScaleDepth * exp(-0.00287 + x * (0.459 + x * (3.83 + x * (-6.80 + x * 5.25)))); }
// ray / sphere (centre 0): near and far distances, or (-1, -1)
vec2 hit(vec3 o, vec3 d, float r) {
  float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h); return vec2(-b - h, -b + h);
}
// the atmosphere along eye -> eye + d * far (O'Neil's ground / sky from space and
// from inside it): in-scattered light (rayleigh, mie) and what reaches the eye of the far end
void atmo(vec3 eye, vec3 d, float far, bool ground, out vec3 cR, out vec3 cM, out vec3 att) {
  vec2 a = hit(eye, d, uAtm);
  float near = max(a.x, 0.0);
  vec3 start = eye + d * near; float len = far - near;
  cR = vec3(0.0); cM = vec3(0.0); att = vec3(1.0);
  if (len <= 0.0) return;
  float hs = length(start);
  float depth0 = exp((1.0 - hs) / (uScaleDepth * (uAtm - 1.0)));
  float sl = len / float(NS), scaled = sl * uScale;
  vec3 step = d * sl, s = start + step * 0.5;
  vec3 front = vec3(0.0);
  vec3 endP = eye + d * far;
  float camAngle = ground ? dot(-d, endP) / length(endP) : dot(d, start) / hs;
  float camOff = depth0 * scaleF(camAngle);
  for (int i = 0; i < NS; i++) {
    float h = length(s);
    float dep = exp((1.0 - h) / (uScaleDepth * (uAtm - 1.0)));
    float la = dot(uSun, s) / h;
    float ca = ground ? camAngle : dot(d, s) / h;
    float sc = ground ? dep * (scaleF(max(la, -0.2)) + scaleF(ca)) - camOff
                      : camOff + dep * (scaleF(max(la, -0.2)) - scaleF(ca));
    att = exp(-clamp(sc, 0.0, 50.0) * (uInvWave * uKr4PI + uKm4PI));
    front += att * (dep * scaled) * smoothstep(-0.12, 0.12, la);
    s += step;
  }
  cR = front * uInvWave * uKrESun;
  cM = front * uKmESun;
}
vec3 starsAt(vec3 d) {
  vec3 a = abs(d); vec2 uv;
  if (a.x >= a.y && a.x >= a.z) uv = d.zy / a.x; else if (a.y >= a.z) uv = d.xz / a.y; else uv = d.xy / a.z;
  vec3 s = texture(uStars, uv * 1.5 + 0.5).rgb;
  return pow(s, vec3(2.1493 * 2.6 * TS_POW)) * uStarsK * TS_K;
}
void main() {
  vec3 d = normalize(uFwd + uRight * v_p.x * uTan.x + uUp * v_p.y * uTan.y);
  vec3 col;
  vec2 e = hit(uEye, d, 1.0);
  float mu = dot(d, uSun);
  if (e.x > 0.0) {
    vec3 p = uEye + d * e.x, n = normalize(p);
    // the clouds: on a shell a little above, seen through (parallax) and their shadow towards the sun
    vec2 c = hit(uEye, d, 1.0 + 0.004 * uParallax / 0.15);
    vec3 cp = normalize(uEye + d * max(c.x, 0.0));
    float cloud = texture(uCloud, cp).r;
    float shade = texture(uCloud, normalize(n + uSun * 0.006 * uShadow)).r;
    vec3 g = pow(texture(uGround, n).rgb, vec3(2.2));
    float sea = texture(uSpec, n).r;
    vec3 alb = mix(g, mix(vec3(0.0599976, 0.150024, 0.225098) * 0.3, vec3(0.0, 0.10, 0.42), T_SEA), sea * mix(0.55, 0.88, T_SEA));
    float nl = dot(n, uSun);
    float lit = clamp(nl * 1.2 + 0.05, 0.0, 1.0);
    vec3 r = reflect(d, n);
    float rs = max(dot(r, uSun), 0.0);
    float spec = (pow(rs, uSeaPow * 6.0) + T_GLINT * (pow(rs, 40.0) * 0.6 + pow(rs, 8.0) * 0.08)) * (sea * uSeaAlbedo * 5.0 + (1.0 - sea) * uLandAlbedo * 2.0) * step(0.0, nl);
    vec3 surf = alb * lit * (1.0 - shade * 0.55 * uCloudBlend) + spec;
    vec3 cl = vec3(cloud * cloud) * (clamp(dot(cp, uSun) * 1.1 + 0.1, 0.0, 1.0)) * uCloudBright * 3.2;
    surf = mix(surf, cl, clamp(cloud * 1.15, 0.0, 1.0));
    vec3 cR, cM, att;
    atmo(uEye, d, e.x, true, cR, cM, att);
    col = surf * uSunCol * 1.4 * att + (cR + cM * 0.15) * T_HAZE;
    // the edge seen through the most air: a bright blue rim, lit by day
    float fr = pow(1.0 - clamp(dot(n, -d), 0.0, 1.0), 3.0);
    col += vec3(0.35, 0.75, 1.0) * fr * T_RIM * smoothstep(-0.25, 0.3, nl);
  } else {
    col = starsAt(d);
    vec2 a = hit(uEye, d, uAtm);
    if (a.y > 0.0) {
      vec3 cR, cM, att;
      atmo(uEye, d, a.y, false, cR, cM, att);
      float g2 = uG * uG;
      float mie = 1.5 * ((1.0 - g2) / (2.0 + g2)) * (1.0 + mu * mu) / pow(max(1.0 + g2 - 2.0 * uG * mu, 1e-4), 1.5);
      float ray = 0.75 * (1.0 + mu * mu);
      col = col * (1.0 - clamp(length(cR) * 4.0, 0.0, 1.0)) + cR * ray + cM * mie;
    }
    // the air's glow just outside the edge, fading into space (lit by day)
    float b0 = dot(uEye, d);
    if (b0 < 0.0) {
      vec3 cpt = uEye - d * b0; float rc = length(cpt);
      float lit2 = smoothstep(-0.3, 0.35, dot(cpt / rc, uSun));
      col += vec3(0.3, 0.7, 1.0) * T_HALO * exp(-max(rc - 1.0, 0.0) / T_HALOW) * lit2;
    }
    // the sun's disk (earth/flashrom/disk.dds) where it isn't behind the Earth
    float ang = acos(clamp(mu, -1.0, 1.0));
    if (ang < uSunSize * 2.0) {
      vec3 ax = normalize(cross(uSun, abs(uSun.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 ay = cross(uSun, ax);
      vec2 uv = vec2(dot(d, ax), dot(d, ay)) / (uSunSize * 2.0) * 0.5 + 0.5;
      col += texture(uDisk, uv).r * uSunCol * 40.0;
    }
  }
  // the sun's glare over everything (when the sun isn't behind the Earth)
  col += uSunCol * uSunVis * uGlare * (pow(max(mu, 0.0), 1400.0) * 5.0 + pow(max(mu, 0.0), 120.0) * 0.18 + pow(max(mu, 0.0), 12.0) * 0.012);
  // HDR.mnu: exposure and white level
  vec3 x = col * uExposure * 2.2;
  x = x * (1.0 + x / (uWhite * uWhite)) / (1.0 + x);
  x = pow(clamp(x, 0.0, 1.0), vec3(1.0 / 2.2));
  // (DITHER 1/255)
  x += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) * 43758.5453) - 0.5) / 255.0;
  o = vec4(x, 1.0);
}
`;

// ------------------------------------------------------------------ the visualizer
export class Earth {
  static async create(canvas, archive) { const e = new Earth(canvas, archive); await e._load(); return e; }
  constructor(canvas, archive) {
    this.canvas = canvas; this.archive = archive;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 isn't available");
    this.gl = gl; this.raf = 0; this.t = 0;
    this.presets = archive.ids().map((id) => /^earth\/presets\/([^/]+)\/earth\/camera\.path$/.exec(id)).filter(Boolean)
      .map((m) => m[1]).filter((n) => n !== "tz").sort();
    if (!this.presets.length) throw new Error("earth.qrc has no camera flights");
    this.base = this._mnu("earth/");
  }
  _mnu(dir) {
    const m = new Map();
    for (const id of this.archive.ids()) {
      if (!id.startsWith(dir) || !id.endsWith(".mnu") || id.slice(dir.length).includes("/")) continue;
      const f = id.slice(dir.length, -4);
      for (const e of parseMnu(this.archive.text(id))) m.set(f + "." + e.name, e.value);
    }
    return m;
  }
  P(k, d = 0) { const v = this.cur.get(k); return v === undefined || Number.isNaN(v) ? d : v; }
  async _load() {
    const gl = this.gl, A = this.archive;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error("Earth: " + gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Earth: " + gl.getProgramInfoLog(p));
    this.prog = p; this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); this.u[a.name] = gl.getUniformLocation(p, a.name); }
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // the three cubes
    // (a face at a time, the window getting its frames in between: the music never waits)
    const c = new OffscreenCanvas(1024, 1024);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const cube = async (layer) => {
      const t = gl.createTexture();
      for (let s = 0; s < 6; s++) {
        await drawFace(c, A, layer, SLOTS[s][0], SLOTS[s][1]);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + s, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
        await pause();
      }
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      await pause();
      return t;
    };
    this.tGround = await cube("ground_cm"); this.tSpec = await cube("specular"); this.tCloud = await cube("clouds");
    const tex2d = (img, wrap) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.pixels);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return t;
    };
    this.tStars = tex2d(decodeDds(A.file("earth/flashrom/face_neg_z_ul.dds")), gl.REPEAT);
    this.tDisk = tex2d(decodeDds(A.file("earth/flashrom/disk.dds")), gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    this.newTrack();
  }
  // a new song: a flight picked at random, each as likely, from its start
  newTrack() {
    const name = this.presets[Math.floor(Math.random() * this.presets.length)];
    this.preset = name;
    this.cur = new Map(this.base);
    for (const [k, v] of this._mnu("earth/presets/" + name + "/earth/")) this.cur.set(k, v);
    const path = parsePath(this.archive.text("earth/presets/" + name + "/earth/camera.path"));
    this.flight = makeFlight(path, this.P("EARTH.FOVY SPACE", 42.5));
    this.speed = (path.opt.speed || 1) * this.P("EARTH.ANIM SPEED", 1);
    this.t = 0;
  }
  _sunDir() {
    // SUN.mnu: SUN ANG Y from the poles' axis (90: over the equator), SUN ANG Z around it
    // (the way round that puts the sun in the shots made to look at it: flights 7a, 8, 8a, 8b)
    const y = this.P("SUN.SUN ANG Y", 90) * Math.PI / 180, z = this.P("SUN.SUN ANG Z", 0) * Math.PI / 180;
    return [Math.sin(y) * Math.sin(z), Math.cos(y), Math.sin(y) * Math.cos(z)];
  }
  render() {
    const gl = this.gl, c = this.canvas, dpr = window.devicePixelRatio || 1;
    let w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    const k = Math.min(1, 1920 / Math.max(1, w)); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const cam = this.flight.at(this.t);
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const fwd = nrm(sub(cam.center, cam.eye)), right = nrm(cross(fwd, cam.up)), up = cross(right, fwd);
    const ty = Math.tan(cam.fovy * Math.PI / 360);
    const L = nrm(this._sunDir());
    // is the sun behind the Earth (for its glare)?
    const e = cam.eye, b = e[0] * L[0] + e[1] * L[1] + e[2] * L[2], cc = e[0] * e[0] + e[1] * e[1] + e[2] * e[2] - 1;
    const sunVis = b > 0 || b * b - cc < 0 ? 1 : 0;
    const P = (x, d) => this.P(x, d), u = this.u;
    const atm = 1.025, wl = [P("ATM.R WAVELENGTH", 0.65), P("ATM.G WAVELENGTH", 0.57), P("ATM.B WAVELENGTH", 0.475)];
    const esun = P("ATM.SUN INTENSITY", 16), kr = 0.0025, km = 0.0010;
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.uniform3fv(u.uEye, cam.eye); gl.uniform3fv(u.uFwd, fwd); gl.uniform3fv(u.uRight, right); gl.uniform3fv(u.uUp, up);
    gl.uniform2f(u.uTan, ty * w / h, ty); gl.uniform3fv(u.uSun, L);
    gl.uniform1f(u.uAtm, atm); gl.uniform1f(u.uScale, 1 / (atm - 1)); gl.uniform1f(u.uScaleDepth, 0.25);
    gl.uniform1f(u.uKrESun, kr * esun); gl.uniform1f(u.uKmESun, km * esun);
    gl.uniform1f(u.uKr4PI, kr * 4 * Math.PI); gl.uniform1f(u.uKm4PI, km * 4 * Math.PI); gl.uniform1f(u.uG, -0.95);
    gl.uniform3f(u.uInvWave, ...wl.map((x) => 1 / Math.pow(x, 4)));
    gl.uniform3f(u.uSunCol, P("ATM.SUN R", 1), P("ATM.SUN G", 1), P("ATM.SUN B", 1));
    gl.uniform1f(u.uExposure, P("HDR.EXPOSURE", 0.789)); gl.uniform1f(u.uWhite, P("HDR.WHITE LEVEL", 3.4));
    gl.uniform1f(u.uCloudBright, P("CLOUDS.BRIGHTNESS", 0.305)); gl.uniform1f(u.uCloudBlend, P("CLOUDS.BLEND", 0.353));
    gl.uniform1f(u.uShadow, P("CLOUDS.SHADOW BIAS", 0.81) * P("CLOUDS.SHADOW STREN", 1)); gl.uniform1f(u.uParallax, P("CLOUDS.PARALLAX", 0.15));
    gl.uniform1f(u.uSeaAlbedo, P("EARTH.SEA ALBEDO", 0.058)); gl.uniform1f(u.uSeaPow, P("EARTH.SEA POW", 10));
    gl.uniform1f(u.uLandAlbedo, P("EARTH.LAND ALBEDO", 0.036)); gl.uniform1f(u.uLandPow, P("EARTH.LAND POW", 20));
    gl.uniform1f(u.uStarsK, 0.35 + P("EARTH.STARS WHITENESS", 0.217)); gl.uniform1f(u.uSunVis, sunVis);
    gl.uniform1f(u.uGlare, P("SUN.BRIGHTNESS", 3.4) / 3.4); gl.uniform1f(u.uSunSize, 0.0047 * P("SUN.SOLID ANGLE", 1));
    gl.uniform1f(u.uTime, this.t % 100);
    const T = window.__earthTune || EARTH_TUNE;
    gl.uniform4f(u.uTune0, T[0], T[1], T[2], T[3]); gl.uniform4f(u.uTune1, T[4], T[5], T[6], T[7]);
    const bind = (unit, target, t, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t); gl.uniform1i(u[name], unit); };
    bind(0, gl.TEXTURE_CUBE_MAP, this.tGround, "uGround"); bind(1, gl.TEXTURE_CUBE_MAP, this.tSpec, "uSpec");
    bind(2, gl.TEXTURE_CUBE_MAP, this.tCloud, "uCloud"); bind(3, gl.TEXTURE_2D, this.tStars, "uStars"); bind(4, gl.TEXTURE_2D, this.tDisk, "uDisk");
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  start() {
    if (this.raf) return;
    let last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now;
      // (the flight plays at its own speed, and stays at its end)
      this.t = Math.min(this.flight.length, this.t + dt * this.speed);
      // (drawn about 60 times a second, like the console, however fast the screen)
      if (now - this._drawn < 12.5) return;
      this._drawn = now;
      try { this.render(); } catch (e) { console.warn("Earth:", e); this.stop(); if (this.onError) this.onError(e); }
    };
    this._drawn = 0;
    this.raf = requestAnimationFrame(loop);
  }
  // (made ready while hidden: one drawing compiles what it uses)
  prepare() { try { this.render(); } catch (e) {} }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  destroy() { this.stop(); const x = this.gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); }
}
