// "Real Style Waves": a WebGL2 recreation of the PS3 XMB wave, adapted from
// linkev/PlayStation-3-XMB (MIT). The reverse-engineered spline displacement
// pipeline, wave mesh and particle field are ported near-verbatim; the wiring is
// wrapped in a RealWave class so the launcher can drive it from the same Theme
// Settings controls the procedural wave uses (wave colour, dot colour, waves /
// dots on-off, background colour, and wallpaper transparency).
//
// Source: https://github.com/linkev/PlayStation-3-XMB (MIT License)

// ---- default tuning (from spline-settings.js / particles-settings.js) ----
export const REAL_WAVE_DEFAULTS = {
  // linkev's spline-settings.js values, retuned for the "Complex" style so it
  // matches the reference PS3 captures (purple theme): a broad, gently rising
  // ribbon with a filled translucent body and fresnel-lit edges.
  colorR: 37, colorG: 89, colorB: 179,
  // a Background Color other than Auto: built like the Auto background (its
  // top about half as bright as its bottom, the same angle), so a colour
  // looks like Auto's gradient in that colour
  gradientTopMul: 0.5, gradientBotMul: 1.0,
  flowSpeed: 0.18, tension: 0.12, damping: 0.0001,
  length: 0.306001, spacing: 407.658, timeStep: 1.0,
  bandAmplitude: 0.200, bandSecondaryFreq: 7.0, bandSecondaryAmp: 0.025,
  travelSpeed1: 0.25, travelAmp1: 0.014, travelSpeed2: 0.15, travelAmp2: 0.008,
  perturbation: 0.0998587, perturbationScale: 0.07,
  waveCosAmp: 0.09, waveBias: -0.1, waveHeightScale: 0.5, waveSoftClip: 0.22,
  rePipelineBlend: 0.45, reDescriptorStrength: 0.7, reSyntheticDescriptorSeed: 1337,
  reSyntheticDescriptorMotion: 0.65, reKernelGain: 0.04, reNormalizeGain: 0.08,
  reKernelPhaseStep: 0.45, reIndexJitter: 0.006, reTemporalSmooth: 0.84,
  fresnelPower: 3.0, fresnelScale: 1.3, opacity: 0.65, brightness: 0.98, zDetailScale: 0.08,
  ffdScale1X: 1.5, ffdScale1Y: 1.00077, ffdScale1Z: 1.0,
  ffdScale2X: 2.82755, ffdScale2Y: 1.27579, ffdScale2Z: 2.88782,
  ffdOffsetX: 0.0, ffdOffsetY: -0.469999, ffdOffsetZ: 0.0,
  ffdYAmp: 0.06, ffdZAmp: 0.01,
};
// (checked against a capture of the console's purple background: sparkles
// above and below the wave, more of them, some larger)
export const REAL_PARTICLE_DEFAULTS = {
  count: 450, opacity: 1.0, sizeBase: 3.6, sizeVar: 6.0, flowSpeed: 0.18,
  posY: 0.1, spreadY: 1.1,
};
// "Complex" wave style (Style A) additions on top of the linkev settings:
// its own background (Gradient Preset 0 = the custom top / bottom colours,
// 1-24 = linkev's month day / night presets; a chosen Background Color uses
// linkev's "Original (RGB Sliders)" formula instead), and the wave's place on
// screen (height, tilt, thickness).
export const COMPLEX_EXTRA_DEFAULTS = {
  gradientPreset: 0,
  bgTopR: 62, bgTopG: 0, bgTopB: 77, bgBotR: 138, bgBotG: 26, bgBotB: 143, bgAngle: 102, bgSpan: 1, bgCurve: 1,
  posY: -0.2, tilt: 0.1, thickness: 1.9,
  bandFrequency: 2.0, rowSpread: 1.7, cosFrequency: 1.0, fill: 0.2,
  edgeSoft: 0.6,
  // Wave Color "Auto": the background's bottom colour, brightened, mixed toward white
  autoTintBoost: 1.45, autoTintWhite: 0.35,
};
// linkev's month gradients (background-gradients-day.js / -night.js):
// [label, angle in degrees, start rgb, end rgb]
export const COMPLEX_GRADIENT_PRESETS = [
  ["January (Day)", 90.25, [197,197,197], [201,201,201]],
  ["January (Night)", 89.75, [181,181,181], [0,0,0]],
  ["February (Day)", 67, [203,158,13], [219,214,41]],
  ["February (Night)", 93.75, [198,188,128], [0,0,0]],
  ["March (Day)", 106, [142,190,40], [104,168,22]],
  ["March (Night)", 90.25, [152,170,113], [0,0,0]],
  ["April (Day)", 136.75, [216,182,182], [231,66,117]],
  ["April (Night)", 90.25, [212,174,182], [10,8,8]],
  ["May (Day)", 1.5, [19,108,19], [24,156,24]],
  ["May (Night)", 116, [48,118,48], [11,3,11]],
  ["June (Day)", 148.75, [198,120,238], [103,77,161]],
  ["June (Night)", 91, [209,163,225], [0,0,0]],
  ["July (Day)", 26.5, [0,167,146], [10,240,239]],
  ["July (Night)", 109.75, [16,129,124], [17,0,0]],
  ["August (Day)", 62.5, [0,0,95], [33,217,255]],
  ["August (Night)", 69.5, [20,159,176], [0,0,31]],
  ["September (Day)", 148.5, [146,44,155], [217,98,236]],
  ["September (Night)", 51, [116,0,153], [12,0,11]],
  ["October (Day)", 128.5, [227,151,15], [224,187,2]],
  ["October (Night)", 89.75, [216,142,0], [0,0,0]],
  ["November (Day)", 90, [115,68,20], [154,118,47]],
  ["November (Night)", 90, [131,86,32], [18,20,17]],
  ["December (Day)", 170.5, [236,68,45], [214,63,43]],
  ["December (Night)", 118.25, [157,59,44], [0,0,3]],

];

// ------------------------------------------------------------------ GL utils
function compile(gl, src, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "shader compile failed";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}
function link(gl, vsSrc, fsSrc) {
  const program = gl.createProgram();
  const vs = compile(gl, vsSrc, gl.VERTEX_SHADER);
  const fs = compile(gl, fsSrc, gl.FRAGMENT_SHADER);
  gl.attachShader(program, vs); gl.attachShader(program, fs);
  gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "program link failed";
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}
const uloc = (gl, p, n) => gl.getUniformLocation(p, n);
function aloc(gl, p, n) {
  const loc = gl.getAttribLocation(p, n);
  if (loc < 0) throw new Error("Missing attribute: " + n);
  return loc;
}
function createFullscreenQuad(gl, program) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const posLoc = aloc(gl, program, "aPos");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}
function createGrid(gl, program, res) {
  const strips = res - 1;
  const vertsPerStrip = res * 2;
  const verts = new Float32Array(strips * vertsPerStrip * 2);
  let vi = 0;
  for (let y = 0; y < strips; y++) {
    for (let x = 0; x < res; x++) {
      const fx = (x / (res - 1)) * 2 - 1;
      verts[vi++] = fx; verts[vi++] = ((y + 1) / (res - 1)) * 2 - 1;
      verts[vi++] = fx; verts[vi++] = (y / (res - 1)) * 2 - 1;
    }
  }
  const idx = new Uint16Array(strips * (vertsPerStrip + 2) - 2);
  let ii = 0, base = 0;
  for (let s = 0; s < strips; s++) {
    if (s > 0) { idx[ii++] = base - 1; idx[ii++] = base; }
    for (let i = 0; i < vertsPerStrip; i++) idx[ii++] = base + i;
    base += vertsPerStrip;
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const posLoc = aloc(gl, program, "aPos");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 8, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, indexCount: ii };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function computeDirRange(dirX, dirY) {
  const t00 = 0, t10 = dirX, t01 = dirY, t11 = dirX + dirY;
  const tMin = Math.min(t00, t10, t01, t11);
  const tMax = Math.max(t00, t10, t01, t11);
  return { tMin, tSpan: Math.max(1e-6, tMax - tMin) };
}
// The XMB background is a fixed bright warm brown ("day" keyframe, measured from
// a genuine 1920x1080 capture). The day/night cycle has been removed: the wave
// is fully user-customizable, so it always renders at full brightness.
const DAY_TOP = [172 / 255, 142 / 255, 122 / 255];
const DAY_BOT = [190 / 255, 158 / 255, 96 / 255];

// Background gradient. Default ("auto") colour → the fixed XMB brown; a
// player-chosen colour → a bright gradient derived from it. `dayF` is kept in
// the signature for the caller but is always 1 (no dimming).
// "Month and Time Colors": the real XMB's background follows the month (each
// has its own colour) and the time of day (bright day, dark night, blending
// in the morning and evening). Uses the month's Day and Night gradients
// (linkev's captures of the console's own textures).
// 0 = night, 1 = day: full day 7:00-17:00, full night 20:00-4:00
export function xmbDayFactor(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return h < 12 ? ss(4, 7, h) : 1 - ss(17, 20, h);
}
export function monthGradient(d = new Date()) {
  const m = d.getMonth(), f = xmbDayFactor(d);
  const day = COMPLEX_GRADIENT_PRESETS[m * 2], night = COMPLEX_GRADIENT_PRESETS[m * 2 + 1];
  const mix = (a, b) => a.map((v, i) => (b[i] + (v - b[i]) * f) / 255);
  const ang = (night[1] + (day[1] - night[1]) * f) * Math.PI / 180;
  const dir = [Math.cos(ang), Math.sin(ang)], range = computeDirRange(dir[0], dir[1]);
  // (the console's gradient textures run from the bottom up: their first
  // colour is the bottom of the screen, so the dark part ends up on top)
  return { startRgb: mix(day[3], night[3]), endRgb: mix(day[2], night[2]), dir, tMin: range.tMin, tSpan: range.tSpan };
}
// the brighter end of a gradient, lightened: the wave's colour in month mode
function monthWaveTint(g, white) {
  const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const c = lum(g.startRgb) >= lum(g.endRgb) ? g.startRgb : g.endRgb;
  const m = Math.max(c[0], c[1], c[2], 1e-3), k = Math.min(1 / m, 1.6);   // as bright as it can get (same hue)
  return c.map((v) => { const b = Math.min(1, v * k); return b + (1 - b) * white; });
}

// Complex style: its own gradient (see COMPLEX_EXTRA_DEFAULTS)
function resolveComplexGradient(s, useOwn) {
  const angleDir = (deg) => { const r = deg * Math.PI / 180; return [Math.cos(r), Math.sin(r)]; };
  const c255 = (r, g, b) => [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
  let start, end, dir;
  const pi = Math.round(s.gradientPreset || 0);
  if (!useOwn) {
    // the chosen Background Color, shaded like the Auto background: Gradient
    // Top / Bottom set how bright each end is, at the Auto gradient's angle
    const cr = s.colorR / 255, cg = s.colorG / 255, cb = s.colorB / 255, tm = s.gradientTopMul, bm = s.gradientBotMul;
    start = [clamp01(cr * tm), clamp01(cg * tm), clamp01(cb * tm)]; end = [clamp01(cr * bm), clamp01(cg * bm), clamp01(cb * bm)];
    dir = angleDir(s.bgAngle ?? COMPLEX_EXTRA_DEFAULTS.bgAngle);
  } else if (pi >= 1 && pi <= COMPLEX_GRADIENT_PRESETS.length) {
    const pr = COMPLEX_GRADIENT_PRESETS[pi - 1];
    start = c255(...pr[3]); end = c255(...pr[2]); dir = angleDir(pr[1]);   // dark part on top, as on the console
  } else {
    start = c255(s.bgTopR, s.bgTopG, s.bgTopB); end = c255(s.bgBotR, s.bgBotG, s.bgBotB); dir = angleDir(s.bgAngle);
  }
  const range = computeDirRange(dir[0], dir[1]);
  // Gradient Length: the gradient reaches its end colour this share of the way across (the rest stays that colour)
  const span = Math.max(0.02, Math.min(1, s.bgSpan ?? 1));
  return { startRgb: start, endRgb: end, dir, tMin: range.tMin, tSpan: range.tSpan * span, curve: Math.max(0.2, Math.min(4, s.bgCurve ?? 1)) };
}
function resolveBackgroundGradient(s, useDefault, _dayF, month) {
  if (month && useDefault) return monthGradient();
  if ("bgTopR" in s) return resolveComplexGradient(s, useDefault);
  const dir = [0, 1];
  const range = computeDirRange(dir[0], dir[1]);
  if (useDefault) {
    return { startRgb: DAY_TOP, endRgb: DAY_BOT, dir, tMin: range.tMin, tSpan: range.tSpan };
  }
  const cr = s.colorR / 255, cg = s.colorG / 255, cb = s.colorB / 255;
  const top = [cr * 0.62, cg * 0.62, clamp01(cb * 0.62 + 0.12)];
  const bot = [cr * 0.82, cg * 0.82, cb * 0.82];
  return { startRgb: top, endRgb: bot, dir, tMin: range.tMin, tSpan: range.tSpan };
}

// ------------------------------------ reverse-engineered spline displacement
const PS3 = {
  B380_SIZE_BYTES: 0x2200, TABLE_ENTRY_COUNT: 0x169, LOOP_ITERS: 8,
  STORE_OFFSETS_BYTES: [0x000, 0x100, 0x200, 0x300, 0x010, 0x110, 0x210, 0x310],
  STRIDE_FLOATS: 0x400 >> 2,
};
const NORM_A = new Float32Array([0.39584, -0.0052389996, -0.58664495, 0.189007]);
const NORM_B = new Float32Array([-0.003751, -0.57536095, 0.161975, 0.417137]);
const R37_WORDS = [0x00, 0x11, 0x22, 0x33];
const rfract = (v) => v - Math.floor(v);
const hash01 = (x) => rfract(Math.sin(x) * 43758.5453123);
function bsplineBasis(t) {
  const t2 = t * t, t3 = t2 * t;
  return [(1 - 3 * t + 3 * t2 - t3) / 6, (4 - 6 * t2 + 3 * t3) / 6, (1 + 3 * t + 3 * t2 - 3 * t3) / 6, t3 / 6];
}
function evalSpline(cp, u) {
  const n = cp.length - 3;
  if (n < 1) return 0;
  const s = Math.max(0, Math.min(u * n, n - 1e-6));
  const seg = Math.floor(s), t = s - seg, b = bsplineBasis(t);
  return b[0] * cp[seg] + b[1] * cp[seg + 1] + b[2] * cp[seg + 2] + b[3] * cp[seg + 3];
}
function tableIndexFromWord(word) {
  const hi = (word >> 4) & 0xff, lo = word & 0xf;
  return (19 * hi + lo) % PS3.TABLE_ENTRY_COUNT;
}
function wrapIndexFloat(v, len) { let o = v % len; if (o < 0) o += len; return o; }
function sampleTableVec4(table, idxFloat, out) {
  const len = PS3.TABLE_ENTRY_COUNT;
  const i0 = Math.floor(idxFloat) % len, i1 = (i0 + 1) % len;
  const t = idxFloat - Math.floor(idxFloat), b0 = i0 * 4, b1 = i1 * 4;
  out[0] = table[b0] * (1 - t) + table[b1] * t;
  out[1] = table[b0 + 1] * (1 - t) + table[b1 + 1] * t;
  out[2] = table[b0 + 2] * (1 - t) + table[b1 + 2] * t;
  out[3] = table[b0 + 3] * (1 - t) + table[b1 + 3] * t;
}
function vec4Set(out, base, x, y, z, w) { out[base] = x; out[base + 1] = y; out[base + 2] = z; out[base + 3] = w; }
function vec4Mix(a, b, t, out) {
  const s = 1 - t;
  out[0] = a[0] * s + b[0] * t; out[1] = a[1] * s + b[1] * t;
  out[2] = a[2] * s + b[2] * t; out[3] = a[3] * s + b[3] * t;
}
class SyntheticDescriptorSource {
  constructor() { this.lastSeed = 0; this.cached = new Uint8Array(PS3.B380_SIZE_BYTES); }
  buildB380(s) {
    const seed = s.reSyntheticDescriptorSeed | 0;
    if (seed === this.lastSeed) return this.cached;
    this.lastSeed = seed;
    const out = this.cached, len = out.length;
    for (let i = 0; i < len; i++) {
      const f = i / len;
      const wave = Math.sin((f * 97.0) * (0.3 + s.length)) * 0.5 +
        Math.sin((f * 211.0) * (0.15 + s.tension * 3.0)) * 0.3 +
        Math.sin((f * 17.0) * (0.2 + s.perturbationScale * 2.0)) * 0.2;
      const noise = hash01(i * 13.37 + seed * 0.01) * 2.0 - 1.0;
      const v = clamp01((wave * s.reDescriptorStrength + noise * 0.35 + 1.0) * 0.5);
      out[i] = (v * 255) | 0;
    }
    return out;
  }
  decodeCoefficients(b380, s, timeSec, coeffOut) {
    const len = b380.length, stride = 0x130;
    const phase = timeSec * s.flowSpeed * s.timeStep * s.reSyntheticDescriptorMotion;
    for (let entry = 0; entry < PS3.TABLE_ENTRY_COUNT; entry++) {
      const entryBase = entry * 16, descBase = (entry * stride) % len;
      for (let blk = 0; blk < 4; blk++) {
        for (let lane = 0; lane < 4; lane++) {
          const byteIdx = (descBase + blk * 0x10 + lane * 4 + (entry % 7)) % len;
          const b = b380[byteIdx] / 255, centered = b * 2 - 1;
          const harmonic = Math.sin(entry * 0.07 + blk * 0.91 + lane * 1.37 + phase * 0.23);
          coeffOut[entryBase + blk * 4 + lane] = centered * 0.75 + harmonic * 0.25;
        }
      }
    }
  }
}
class PS3SplineReversePipeline {
  constructor() {
    this.source = new SyntheticDescriptorSource();
    this.b300 = new Float32Array(16);
    this.coeffs = new Float32Array(PS3.TABLE_ENTRY_COUNT * 16);
    this.table = new Float32Array(PS3.TABLE_ENTRY_COUNT * 4);
    this.kernel = new Float32Array(PS3.LOOP_ITERS * PS3.STRIDE_FLOATS);
    this.kernelPacked = new Float32Array(PS3.LOOP_ITERS * 8 * 4);
    this.kernelPackedPrev = new Float32Array(PS3.LOOP_ITERS * 8 * 4);
    this.controlPoints = new Float32Array(28);
  }
  buildRuntimeInputs(s) {
    const b = this.b300;
    b[0] = s.damping; b[1] = s.length; b[2] = s.tension; b[3] = s.spacing * 0.001;
    b[4] = s.waveCosAmp; b[5] = s.waveBias; b[6] = s.timeStep; b[7] = s.perturbation;
    b[8] = s.perturbationScale; b[9] = s.flowSpeed; b[10] = s.ffdScale1X; b[11] = s.ffdScale2X;
    b[12] = s.ffdOffsetY; b[13] = s.fresnelScale; b[14] = s.waveHeightScale; b[15] = 1.0;
    return { b300: b, b380: this.source.buildB380(s) };
  }
  buildSplineTable(runtime, s, timeSec) {
    this.source.decodeCoefficients(runtime.b380, s, timeSec, this.coeffs);
    const normalizeGain = s.reNormalizeGain;
    for (let i = 0; i < PS3.TABLE_ENTRY_COUNT; i++) {
      const cBase = i * 16, tBase = i * 4;
      for (let lane = 0; lane < 4; lane++) {
        const raw = this.coeffs[cBase + lane] * runtime.b300[0] +
          this.coeffs[cBase + 4 + lane] * runtime.b300[1] +
          this.coeffs[cBase + 8 + lane] * runtime.b300[2] +
          this.coeffs[cBase + 12 + lane] * runtime.b300[3];
        const denomAbs = Math.max(Math.abs(NORM_B[lane]), 0.05);
        const denom = NORM_B[lane] < 0 ? -denomAbs : denomAbs;
        const norm = ((raw - NORM_A[lane]) / denom) * normalizeGain;
        this.table[tBase + lane] = Math.tanh(norm);
      }
    }
    return this.table;
  }
  runKernel(table, s, timeSec) {
    this.kernel.fill(0);
    for (let iter = 0; iter < PS3.LOOP_ITERS; iter++) {
      const blockBaseFloats = iter * PS3.STRIDE_FLOATS;
      const phase = timeSec * s.reKernelPhaseStep + iter * 0.37;
      const idxFloat = [0, 0, 0, 0];
      for (let lane = 0; lane < 4; lane++) {
        const baseWord = (R37_WORDS[lane] + iter * 0x13) & 0xff;
        const baseIdx = tableIndexFromWord(baseWord);
        const smoothOffset = Math.sin(phase + lane * 0.77) * s.reIndexJitter * PS3.TABLE_ENTRY_COUNT;
        idxFloat[lane] = wrapIndexFloat(baseIdx + smoothOffset, PS3.TABLE_ENTRY_COUNT);
      }
      const v0 = new Float32Array(4), v1 = new Float32Array(4), v2 = new Float32Array(4), v3 = new Float32Array(4);
      sampleTableVec4(table, idxFloat[0], v0); sampleTableVec4(table, idxFloat[1], v1);
      sampleTableVec4(table, idxFloat[2], v2); sampleTableVec4(table, idxFloat[3], v3);
      const mixA = 0.5 + 0.5 * Math.sin(phase * 0.7), mixB = 0.5 + 0.5 * Math.cos(phase * 0.9);
      const r12 = new Float32Array(4), r13 = new Float32Array(4), r14 = new Float32Array(4), r15 = new Float32Array(4);
      const r9 = new Float32Array(4), r4 = new Float32Array(4), r87 = new Float32Array(4), r89 = new Float32Array(4);
      vec4Mix(v0, v1, mixA, r12); vec4Mix(v1, v2, mixB, r13); vec4Mix(v2, v3, mixA, r14); vec4Mix(v3, v0, mixB, r15);
      for (let lane = 0; lane < 4; lane++) {
        r9[lane] = v1[lane] - v0[lane]; r4[lane] = v2[lane] - v1[lane];
        r87[lane] = v3[lane] - v2[lane]; r89[lane] = v0[lane] - v3[lane];
      }
      const stores = [r12, r13, r14, r15, r9, r4, r87, r89];
      for (let st = 0; st < stores.length; st++) {
        const floatOffset = blockBaseFloats + (PS3.STORE_OFFSETS_BYTES[st] >> 2);
        const vec = stores[st];
        vec4Set(this.kernel, floatOffset, vec[0], vec[1], vec[2], vec[3]);
        const packedBase = (iter * 8 + st) * 4;
        this.kernelPacked[packedBase] = vec[0]; this.kernelPacked[packedBase + 1] = vec[1];
        this.kernelPacked[packedBase + 2] = vec[2]; this.kernelPacked[packedBase + 3] = vec[3];
      }
    }
    const temporal = Math.max(0, Math.min(0.999, s.reTemporalSmooth));
    for (let i = 0; i < this.kernelPacked.length; i++) {
      const smoothed = this.kernelPackedPrev[i] * temporal + this.kernelPacked[i] * (1 - temporal);
      this.kernelPacked[i] = smoothed; this.kernelPackedPrev[i] = smoothed;
    }
    return this.kernelPacked;
  }
  writeDisplacementTexture(s, timeSec, outData, width, height) {
    const runtime = this.buildRuntimeInputs(s);
    const table = this.buildSplineTable(runtime, s, timeSec);
    const kernelPacked = this.runKernel(table, s, timeSec);
    const cp = this.controlPoints, cpCount = cp.length;
    const kernelVecCount = PS3.LOOP_ITERS * 8;
    const flow = timeSec * s.flowSpeed * s.timeStep;
    for (let row = 0; row < height; row++) {
      const z = (row / Math.max(1, height - 1)) * 2 - 1;
      const rowBase = row * width, rowPhase = flow * 0.25 + z * (s.rowSpread ?? 1.7);
      for (let i = 0; i < cpCount; i++) {
        const x = i / Math.max(1, cpCount - 1);
        const kvf = row * 0.93 + i * 0.61 + flow * 0.35;
        const kv0 = ((Math.floor(kvf) % kernelVecCount) + kernelVecCount) % kernelVecCount;
        const kv1 = (kv0 + 1) % kernelVecCount, kt = kvf - Math.floor(kvf);
        const k0 = kv0 * 4, k1 = kv1 * 4;
        const kx = kernelPacked[k0] * (1 - kt) + kernelPacked[k1] * kt;
        const ky = kernelPacked[k0 + 1] * (1 - kt) + kernelPacked[k1 + 1] * kt;
        const kz = kernelPacked[k0 + 2] * (1 - kt) + kernelPacked[k1 + 2] * kt;
        const kw = kernelPacked[k0 + 3] * (1 - kt) + kernelPacked[k1 + 3] * kt;
        const reCore = (kx * 0.45 + ky * 0.25 + kz * 0.2 + kw * 0.1) * s.reKernelGain +
          Math.sin(rowPhase + x * (s.bandFrequency ?? 6.2)) * s.bandAmplitude +
          Math.cos(z * s.bandSecondaryFreq + x * 4.8 + flow * 0.09) * s.bandSecondaryAmp;
        const legacy =
          Math.sin((x * Math.PI * 1.3 + z * 0.8) - flow * s.travelSpeed1) * s.travelAmp1 * s.tension +
          Math.sin((x * Math.PI * 2.8 - z * 1.2) + flow * s.travelSpeed2) * s.travelAmp2 +
          s.perturbation * s.perturbationScale *
            Math.sin((x * (4.0 + s.length * 2.0) + z * 4.0 - flow * 0.6) * (s.spacing * 0.01));
        cp[i] = reCore * s.rePipelineBlend + legacy * (1.0 - s.rePipelineBlend);
      }
      for (let xi = 0; xi < width; xi++) outData[rowBase + xi] = evalSpline(cp, xi / Math.max(1, width - 1));
    }
  }
}

// The boot intro's background level (0 = black, 1 = as normal): only the
// background drawn here is dimmed, so the wave can show on black first, as on
// the console (intro.js sets it frame by frame; the brightness of the whole
// canvas is a CSS filter on top)
let INTRO_BG = 1;
const LIVE = new Set();
export function setIntroBg(v) {
  v = Math.max(0, Math.min(1, +v));
  if (Math.abs(v - INTRO_BG) < 1e-4) return;
  INTRO_BG = v;
  LIVE.forEach((w) => { w._lpDirty = true; w._sig = null; });
}

// ------------------------------------------------------------- layer builders
function createSplineLayer(gl, settings) {
  const bgProg = link(gl,
    `#version 300 es
     precision highp float;
     in vec2 aPos; out vec2 vUvYDown;
     void main(){ vUvYDown=vec2(aPos.x*0.5+0.5,1.0-(aPos.y*0.5+0.5)); gl_Position=vec4(aPos,0.0,1.0); }`,
    `#version 300 es
     precision highp float;
     in vec2 vUvYDown; out vec4 oColor;
     uniform vec3 uColorStart; uniform vec3 uColorEnd; uniform vec2 uDir; uniform float uTMin; uniform float uTSpan; uniform float uCurve;
     void main(){ float t=dot(vUvYDown,uDir); float u=clamp((t-uTMin)/max(uTSpan,1e-6),0.0,1.0);
       // Gradient Curve: 1 = the usual smooth blend; above 1 the start colour gives way quickly, then slowly
       float g=abs(uCurve-1.0)<1e-3 ? u*u*(3.0-2.0*u) : 1.0-pow(1.0-u,uCurve);
       oColor=vec4(mix(uColorStart,uColorEnd,g),1.0); }`);
  const waveProg = link(gl,
    `#version 300 es
     precision highp float;
     in vec2 aPos; uniform sampler2D uSplineTex; uniform float uTime;
     uniform float flowSpeed; uniform float tension; uniform float damping; uniform float length;
     uniform float spacing; uniform float perturbation; uniform float perturbationScale; uniform float timeStep;
     uniform float waveCosAmp; uniform float waveBias; uniform float waveHeightScale; uniform float waveSoftClip;
     uniform float ffdYAmp; uniform float ffdZAmp; uniform float zDetailScale;
     uniform vec3 ffdScale1; uniform vec3 ffdScale2; uniform vec3 ffdOffset;
     uniform float posY; uniform float tilt; uniform float thickness; uniform float cosFrequency;
     out vec3 vPos; out float vEdge;
     void main(){
       vec3 p=vec3(aPos.x,0.0,aPos.y); vec2 uv=(aPos+1.0)*0.5; p.y=texture(uSplineTex,uv).r;
       vec3 ffd1=p*ffdScale1+ffdOffset; vec3 ffd2=p*ffdScale2+ffdOffset;
       p.y+=sin(ffd1.x+uTime*flowSpeed)*ffdYAmp; p.z+=cos(ffd2.z+uTime*flowSpeed)*ffdZAmp;
       float baseWave=cos(p.x*cosFrequency-uTime*0.5*timeStep)*waveCosAmp+waveBias; baseWave*=(1.0-damping);
       baseWave+=tension*sin(p.x*length+uTime*flowSpeed*timeStep*0.25);
       float structured=perturbation*perturbationScale*(
         sin((p.x*length*6.0+p.z*0.5)*spacing*0.01+uTime*flowSpeed*timeStep*0.7)*0.5 +
         sin((p.x*length*10.0-p.z*0.8)*spacing*0.005-uTime*flowSpeed*timeStep*0.35)*0.25);
       float totalWave=(baseWave+structured)*waveHeightScale;
       totalWave=waveSoftClip*tanh(totalWave/max(waveSoftClip,1e-4)); p.y-=totalWave;
       vec2 uv2=uv; uv2.x=fract(uv2.x-uTime*flowSpeed*0.04*timeStep); p.z-=texture(uSplineTex,uv2).r*zDetailScale;
       p.y=p.y*thickness+posY+p.x*tilt;
       gl_Position=vec4(p,1.0); vPos=p; vEdge=aPos.y; }`,
    `#version 300 es
     precision highp float;
     in vec3 vPos; in float vEdge; out vec4 oColor;
     uniform float opacity; uniform float brightness; uniform float fresnelPower; uniform float fresnelScale;
     uniform vec3 uTint; uniform float fill; uniform float edgeSoft;
     void main(){
       vec3 dx=dFdx(vPos); vec3 dy=dFdy(vPos); vec3 N=normalize(cross(dx,dy));
       float F=fresnelScale*pow(1.0+dot(vec3(0.0,0.0,-1.0),N),fresnelPower);
       float edge=edgeSoft>0.0 ? 1.0-smoothstep(1.0-edgeSoft,1.0,abs(vEdge)) : 1.0;
       oColor=vec4(uTint, clamp((F+fill)*opacity*brightness*edge,0.0,1.0)); }`);

  const bgVAO = createFullscreenQuad(gl, bgProg);
  const grid = createGrid(gl, waveProg, 100);
  const STEX_W = 256, STEX_H = 64;
  const splineData = new Float32Array(STEX_W * STEX_H);
  const splineTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, splineTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, STEX_W, STEX_H, 0, gl.RED, gl.FLOAT, splineData);
  const pipeline = new PS3SplineReversePipeline();

  const bgU = { colorStart: uloc(gl, bgProg, "uColorStart"), colorEnd: uloc(gl, bgProg, "uColorEnd"),
    dir: uloc(gl, bgProg, "uDir"), tMin: uloc(gl, bgProg, "uTMin"), tSpan: uloc(gl, bgProg, "uTSpan"), curve: uloc(gl, bgProg, "uCurve") };
  const wU = {};
  for (const n of ["uSplineTex", "uTime", "flowSpeed", "tension", "damping", "length", "spacing",
    "perturbation", "perturbationScale", "timeStep", "waveCosAmp", "waveBias", "waveHeightScale",
    "waveSoftClip", "ffdScale1", "ffdScale2", "ffdOffset", "ffdYAmp", "ffdZAmp", "zDetailScale",
    "opacity", "brightness", "fresnelPower", "fresnelScale", "uTint", "posY", "tilt", "thickness", "cosFrequency", "fill", "edgeSoft"]) wU[n] = uloc(gl, waveProg, n);

  function render(timeSec, opts) {
    pipeline.writeDisplacementTexture(settings, timeSec, splineData, STEX_W, STEX_H);
    gl.bindTexture(gl.TEXTURE_2D, splineTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STEX_W, STEX_H, gl.RED, gl.FLOAT, splineData);

    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    if (!opts.wallpaper) {
      const bg = resolveBackgroundGradient(settings, opts.autoColor, opts.dayFactor, opts.month);
      gl.useProgram(bgProg); gl.bindVertexArray(bgVAO);
      const k = INTRO_BG;
      gl.uniform3f(bgU.colorStart, bg.startRgb[0] * k, bg.startRgb[1] * k, bg.startRgb[2] * k);
      gl.uniform3f(bgU.colorEnd, bg.endRgb[0] * k, bg.endRgb[1] * k, bg.endRgb[2] * k);
      gl.uniform2f(bgU.dir, bg.dir[0], bg.dir[1]);
      gl.uniform1f(bgU.tMin, bg.tMin); gl.uniform1f(bgU.tSpan, bg.tSpan); gl.uniform1f(bgU.curve, bg.curve ?? 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (!opts.waves) return;
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(waveProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, splineTex);
    gl.uniform1i(wU.uSplineTex, 0); gl.uniform1f(wU.uTime, timeSec);
    gl.uniform1f(wU.flowSpeed, settings.flowSpeed); gl.uniform1f(wU.tension, settings.tension);
    gl.uniform1f(wU.damping, settings.damping); gl.uniform1f(wU.length, settings.length);
    gl.uniform1f(wU.spacing, settings.spacing); gl.uniform1f(wU.perturbation, settings.perturbation);
    gl.uniform1f(wU.perturbationScale, settings.perturbationScale); gl.uniform1f(wU.timeStep, settings.timeStep);
    gl.uniform1f(wU.waveCosAmp, settings.waveCosAmp); gl.uniform1f(wU.waveBias, settings.waveBias);
    gl.uniform1f(wU.waveHeightScale, settings.waveHeightScale); gl.uniform1f(wU.waveSoftClip, settings.waveSoftClip);
    gl.uniform3f(wU.ffdScale1, settings.ffdScale1X, settings.ffdScale1Y, settings.ffdScale1Z);
    gl.uniform3f(wU.ffdScale2, settings.ffdScale2X, settings.ffdScale2Y, settings.ffdScale2Z);
    gl.uniform3f(wU.ffdOffset, settings.ffdOffsetX, settings.ffdOffsetY, settings.ffdOffsetZ);
    gl.uniform1f(wU.ffdYAmp, settings.ffdYAmp); gl.uniform1f(wU.ffdZAmp, settings.ffdZAmp);
    gl.uniform1f(wU.zDetailScale, settings.zDetailScale); gl.uniform1f(wU.opacity, settings.opacity);
    gl.uniform1f(wU.brightness, settings.brightness); gl.uniform1f(wU.fresnelPower, Math.max(0.001, settings.fresnelPower));
    gl.uniform1f(wU.fresnelScale, settings.fresnelScale);
    gl.uniform3f(wU.uTint, opts.tint[0], opts.tint[1], opts.tint[2]);
    gl.uniform1f(wU.posY, settings.posY ?? 0); gl.uniform1f(wU.tilt, settings.tilt ?? 0); gl.uniform1f(wU.thickness, settings.thickness ?? 1);
    gl.uniform1f(wU.cosFrequency, settings.cosFrequency ?? 2); gl.uniform1f(wU.fill, settings.fill ?? 0);
    gl.uniform1f(wU.edgeSoft, Math.min(1, settings.edgeSoft ?? 0));
    gl.bindVertexArray(grid.vao);
    gl.drawElements(gl.TRIANGLE_STRIP, grid.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
  // The wave's centre line (its middle row) at N points across the screen,
  // in clip space: the same maths as the vertex shader, for the sparkles to
  // follow. Uses the displacement written by the last render.
  const center = new Float32Array(WAVE_PTS);
  function centerline(timeSec) {
    const s = settings, t = timeSec, row = Math.floor(STEX_H / 2) * STEX_W;
    const flow = s.flowSpeed, ts = s.timeStep, soft = Math.max(s.waveSoftClip, 1e-4);
    for (let i = 0; i < WAVE_PTS; i++) {
      const x = i / (WAVE_PTS - 1) * 2 - 1, u = (x + 1) / 2;
      const fx = u * (STEX_W - 1), i0 = Math.floor(fx), i1 = Math.min(STEX_W - 1, i0 + 1), f = fx - i0;
      let y = splineData[row + i0] * (1 - f) + splineData[row + i1] * f;
      const z = 0 + Math.cos(0 * s.ffdScale2Z + s.ffdOffsetZ + t * flow) * s.ffdZAmp;
      y += Math.sin(x * s.ffdScale1X + s.ffdOffsetX + t * flow) * s.ffdYAmp;
      let base = Math.cos(x * (s.cosFrequency ?? 2) - t * 0.5 * ts) * s.waveCosAmp + s.waveBias;
      base *= (1 - s.damping);
      base += s.tension * Math.sin(x * s.length + t * flow * ts * 0.25);
      const st = s.perturbation * s.perturbationScale * (
        Math.sin((x * s.length * 6 + z * 0.5) * s.spacing * 0.01 + t * flow * ts * 0.7) * 0.5 +
        Math.sin((x * s.length * 10 - z * 0.8) * s.spacing * 0.005 - t * flow * ts * 0.35) * 0.25);
      let total = (base + st) * s.waveHeightScale;
      total = soft * Math.tanh(total / soft);
      y -= total;
      center[i] = y * (s.thickness ?? 1) + (s.posY ?? 0) + x * (s.tilt ?? 0);
    }
    return center;
  }
  return { render, centerline };
}
const WAVE_PTS = 48;

function createParticlesLayer(gl, canvas, settings) {
  const prog = link(gl,
    `#version 300 es
     precision highp float;
     in vec3 aSeed; uniform float uTime; uniform float flowSpeed; uniform float ratio; uniform vec2 uShift;
     uniform float ptSizeBase; uniform float ptSizeVar; uniform float uPosY; uniform float uSpreadY;
     #define WAVE_PTS ${WAVE_PTS}
     uniform float uWaveY[WAVE_PTS]; uniform float uFollow; out float vAlpha;
     void main(){
       gl_PointSize=aSeed.z*ptSizeVar+ptSizeBase; float time=uTime*flowSpeed;
       float x=fract(time*(aSeed.x-0.5)/15.0+aSeed.y*50.0)*2.0-1.0;
       float y=sin(sign(aSeed.y)*time*(aSeed.y+1.5)/4.0+aSeed.x*100.0)/((6.0-aSeed.x*4.0*aSeed.y)/ratio);
       float opVar=mix(sin(time*(aSeed.x+0.5)*12.0+aSeed.y*10.0),sin(time*(aSeed.y+1.5)*6.0+aSeed.x*4.0),y*0.5+0.5)*aSeed.x+aSeed.y;
       vAlpha=opVar*opVar*(1.0-fract(aSeed.x+time*0.00285));
       // controller motion: the sparkles drift the way the controller moves,
       // bigger (nearer) ones a little more; they wrap around the sides
       vec2 sh=uShift*(0.6+aSeed.z*0.8);
       x=fract((x+sh.x+1.0)*0.5)*2.0-1.0;
       // ride along the wave: its centre line where this sparkle is
       float fi=(x+1.0)*0.5*float(WAVE_PTS-1); int i0=int(floor(fi)); int i1=min(i0+1,WAVE_PTS-1);
       float wy=mix(uWaveY[i0],uWaveY[i1],fi-floor(fi))*uFollow;
       gl_Position=vec4(x,wy+y*uSpreadY+uPosY+sh.y,0.0,1.0); }`,
    `#version 300 es
     precision highp float;
     in float vAlpha; out vec4 oColor; uniform float particleOpacity; uniform vec3 uColor; uniform float uStraight;
     void main(){
       vec2 c=gl_PointCoord*2.0-1.0; float d=dot(c,c); if(d>1.0) discard;
       float sparkle=(1.0-d)*(1.0-d); float a=vAlpha*particleOpacity*sparkle;
       // over a see-through background (a picture or a theme behind) the canvas
       // keeps straight colour: the sparkle's full colour, its glow in alpha
       oColor=vec4(mix(uColor*a,uColor,uStraight),a); }`);
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  const seedLoc = aloc(gl, prog, "aSeed");
  let count = 0;
  function rebuild(newCount) {
    count = Math.max(1, newCount | 0);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seeds[i * 3] = Math.random(); seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.pow(Math.random(), 8) + 0.1;
    }
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(seedLoc); gl.vertexAttribPointer(seedLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
  rebuild(settings.count);
  const U = { time: uloc(gl, prog, "uTime"), flowSpeed: uloc(gl, prog, "flowSpeed"),
    ratio: uloc(gl, prog, "ratio"), opacity: uloc(gl, prog, "particleOpacity"),
    sizeBase: uloc(gl, prog, "ptSizeBase"), sizeVar: uloc(gl, prog, "ptSizeVar"), color: uloc(gl, prog, "uColor"),
    shift: uloc(gl, prog, "uShift"), posY: uloc(gl, prog, "uPosY"), spreadY: uloc(gl, prog, "uSpreadY"),
    waveY: uloc(gl, prog, "uWaveY"), follow: uloc(gl, prog, "uFollow"), straight: uloc(gl, prog, "uStraight") };
  function render(timeSec, opts) {
    if ((settings.count | 0) <= 0) return;      // Sparkle Count 0: none at all
    const desired = Math.max(1, settings.count | 0);
    if (desired !== count) rebuild(desired);
    const aspect = canvas.width / canvas.height;
    // Additive colour (unchanged look over the opaque background gradient), but
    // the alpha channel accumulates as coverage rather than being forced opaque.
    // Over a transparent framebuffer (wallpaper mode) this stops dots from
    // becoming solid dark specks that hide the background image.
    gl.enable(gl.BLEND);
    if (opts.wallpaper) {
      // straight colour: the brighter of the sparkle and what's there, alpha adds up
      gl.blendEquationSeparate(gl.MAX, gl.FUNC_ADD); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.uniform1f(U.straight, opts.wallpaper ? 1 : 0);
    gl.uniform1f(U.time, timeSec); gl.uniform1f(U.flowSpeed, settings.flowSpeed);
    gl.uniform1f(U.ratio, Math.max(1.0, Math.min(aspect, 2.0)) * 0.375);
    gl.uniform1f(U.opacity, settings.opacity);
    gl.uniform1f(U.sizeBase, settings.sizeBase); gl.uniform1f(U.sizeVar, settings.sizeVar);
    gl.uniform3f(U.color, opts.color[0], opts.color[1], opts.color[2]);
    const sh = opts.shift || [0, 0];
    gl.uniform2f(U.shift, sh[0], sh[1]);
    gl.uniform1f(U.posY, settings.posY ?? 0); gl.uniform1f(U.spreadY, settings.spreadY ?? 1);
    gl.uniform1fv(U.waveY, opts.waveY || new Float32Array(WAVE_PTS)); gl.uniform1f(U.follow, opts.waveY ? 1 : 0);
    gl.bindVertexArray(vao); gl.drawArrays(gl.POINTS, 0, count); gl.bindVertexArray(null);
    gl.blendEquation(gl.FUNC_ADD);
  }
  return { render };
}

export class RealWave {
  constructor(canvas) {
    this.canvas = canvas;
    LIVE.add(this);
    this.settings = { ...REAL_WAVE_DEFAULTS, ...COMPLEX_EXTRA_DEFAULTS };
    this.particleSettings = { ...REAL_PARTICLE_DEFAULTS };
    this.wavesEnabled = true;
    this.dotsEnabled = true;
    this.wallpaper = false;
    this.hidden = false;
    this.tint = [1, 1, 1];        // wave colour (white default)
    this.waveAuto = true;         // true → no custom wave colour chosen yet
    this.dotRgb = [1, 1, 1];      // particle colour
    this.autoColor = true;        // true → render the measured XMB brown gradient
    this.running = false;
    this.ok = false;
    this._loop = this._loop.bind(this);
    try {
      const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: "high-performance" });
      if (!gl) return;
      this.gl = gl;
      gl.getExtension("OES_texture_float_linear");
      gl.getExtension("EXT_color_buffer_float");
      this.splineLayer = createSplineLayer(gl, this.settings);
      this.particlesLayer = createParticlesLayer(gl, canvas, this.particleSettings);
      this._resize();
      this._onResize = () => this._resize();
      window.addEventListener("resize", this._onResize);
      this.ok = true;
    } catch (e) {
      console.error("RealWave init failed:", e && e.message);
      this.ok = false;
    }
  }
  _resize() {
    const gl = this.gl; if (!gl) return;
    // Display Settings > Resolution (full screen): the background renders at
    // the chosen resolution and is scaled to the screen
    const rs = window.__xmbRenderScale || 0;
    const dpr = rs ? (window.devicePixelRatio || 1) * rs : Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this._lpDirty = true;
    }
    gl.viewport(0, 0, w, h);
  }
  // ---- theme-control API (mirrors the procedural wave's setters) ----
  setBaseColor(rgb, isAuto) { this.autoColor = isAuto !== false; if (rgb) { this.settings.colorR = rgb.r; this.settings.colorG = rgb.g; this.settings.colorB = rgb.b; } }
  setWaveColor(rgb) { this.waveAuto = !rgb; this.tint = rgb ? [rgb.r / 255, rgb.g / 255, rgb.b / 255] : [1, 1, 1]; }
  setDotColor(rgb) { this.dotRgb = rgb ? [rgb.r / 255, rgb.g / 255, rgb.b / 255] : [1, 1, 1]; }
  setWavesEnabled(on) { this.wavesEnabled = on !== false; }
  setDotsEnabled(on) { this.dotsEnabled = on !== false; }
  // Controller motion (gyroscope): main.js feeds the current offset target
  // (screen units, -1..1); the sparkles ease toward it.
  // Sideways, a sweep of the controller pushes every sparkle that way: they
  // glide on (slowing down gently, as if in a vacuum), leave the screen on
  // that side and come back in on the other (like a marquee), the bigger,
  // nearer ones faster (a cylinder of sparkles turning). Up / down they still
  // lean with the controller and ease back to the middle.
  setMotion(_x, y) { this._motionT = [0, y]; if (!y && !_x) this._motionV = 0; }
  addMotionImpulse(dv) { this._motionV = (this._motionV || 0) + dv; }
  _motionShift() {
    const t = this._motionT || [0, 0], c = this._motionC || (this._motionC = [0, 0]);
    const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - (this._motionAt || now)) / 1000));
    this._motionAt = now;
    let v = this._motionV || 0;
    c[0] += v * dt;
    v *= Math.exp(-dt / 1.4);                 // the glide fades out over a second or two
    this._motionV = Math.abs(v) < 1e-4 ? 0 : v;
    if (Math.abs(c[0]) > 200) c[0] -= Math.sign(c[0]) * 200;   // keep the number small (wraps anyway)
    c[1] += (t[1] - c[1]) * 0.12;
    return c;
  }
  setMonthMode(on) { this.monthMode = !!on; }
  // The background's colour right now (0..1 rgb): the middle of its gradient,
  // leaning to the brighter end. Used to tint the option (△) menus.
  backgroundColor() {
    const g = resolveBackgroundGradient(this.settings, this.autoColor, 1, this.monthMode);
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const [hi, lo] = lum(g.startRgb) >= lum(g.endRgb) ? [g.startRgb, g.endRgb] : [g.endRgb, g.startRgb];
    return hi.map((v, i) => v * 0.7 + lo[i] * 0.3);
  }
  // the background's brighter end right now (0..1 rgb): Icon Color "Original"
  // is made from it
  backgroundBright() {
    const g = resolveBackgroundGradient(this.settings, this.autoColor, 1, this.monthMode);
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    return lum(g.startRgb) >= lum(g.endRgb) ? g.startRgb : g.endRgb;
  }
  setWallpaper(on) { this.wallpaper = !!on; }
  // the background gradient drawn by the page instead (an Overlay over the
  // Background Color: the overlay goes between the gradient and the wave)
  setBgOff(on) { this.bgOff = !!on; }
  // the background gradient as a small picture (the same formula as the
  // shader, in the same 0-1 space; stretched to the screen it's the same)
  backgroundImage(size = 128) {
    const g = resolveBackgroundGradient(this.settings, this.autoColor, 1, this.monthMode);
    const c = document.createElement("canvas"); c.width = c.height = size;
    const ctx = c.getContext("2d"), img = ctx.createImageData(size, size), d = img.data;
    const curve = g.curve ?? 1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const t = ((x + 0.5) / size) * g.dir[0] + ((y + 0.5) / size) * g.dir[1];
      const u = Math.max(0, Math.min(1, (t - g.tMin) / Math.max(g.tSpan, 1e-6)));
      const k = Math.abs(curve - 1) < 1e-3 ? u * u * (3 - 2 * u) : 1 - Math.pow(1 - u, curve);
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.round(255 * (g.startRgb[ch] + (g.endRgb[ch] - g.startRgb[ch]) * k));
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }
  setHidden(h) { this.hidden = !!h; }

  // ---- Wave and Sparkles Personalization (linkev spline + particle params) ----
  // The spline / particle layers read from these two objects live every frame
  // (the particle layer rebuilds its buffer when `count` changes), so a param
  // edit must MUTATE the object in place: never reassign it, or the layer's
  // captured reference goes stale.
  _groupTarget(group) {
    switch (group) {
      case "particle": return this.particleSettings;
      case "spline": return this.settings;
      default: return null;                          // (old Default-style keys: ignored)
    }
  }
  setParam(group, key, val) { const t = this._groupTarget(group); if (t && key in t) t[key] = val; }
  getParam(group, key) { const t = this._groupTarget(group); return t ? t[key] : undefined; }
  applyParams(map) {
    if (!map) return;
    for (const k in map) { const [group, key] = k.split(":"); this.setParam(group, key, map[k]); }
  }
  resetParams() {
    const { colorR, colorG, colorB } = this.settings;      // keep the theme base colour
    Object.assign(this.settings, REAL_WAVE_DEFAULTS, COMPLEX_EXTRA_DEFAULTS, { colorR, colorG, colorB });
    Object.assign(this.particleSettings, REAL_PARTICLE_DEFAULTS);
  }

  start() {
    if (!this.ok || this.running) return;
    this.running = true;
    this.canvas.classList.add("show");
    this._resize();
    this._prev = performance.now();
    this._tWave = 0;
    this._tPart = Math.random() * 1000;
    requestAnimationFrame(this._loop);
  }
  stop() {
    this.running = false;
    this.canvas.classList.remove("show");
  }
  // Low performance mode: 0 = normal; 1 (out of focus) / 2 (a game is
  // running) = the waves and sparkles stop dead: the last frame stays on
  // screen and nothing more is drawn (their time doesn't move on either)
  setLowPower(level) { this.lowPower = level | 0; }
  // Still Waves (Power Save Settings): the waves and sparkles hold still as a
  // picture. The frame is drawn again only when something about it changes
  // (colours, settings, the window's size), never just to move it on.
  setStill(on) { on = !!on; if (on === !!this.still) return; this.still = on; this._sig = null; }
  _stillSig() {
    return JSON.stringify([this.settings, this.particleSettings, this.tint, this.dotRgb, this.waveAuto, this.complexAuto, this.autoColor,
      this.wavesEnabled, this.dotsEnabled, this.wallpaper, this.bgOff, this.hidden, this.monthMode, this.canvas.width, this.canvas.height,
      Math.floor(Date.now() / 60000)]);   // (the month / time-of-day colour moves on by the minute)
  }
  _loop(now) {
    if (!this.running) return;
    const lp = this.lowPower || 0;
    if (lp || this.still) {
      // frozen: time doesn't move on; the same frame is drawn again only after
      // a resize (which clears the canvas) or, holding still, a change to it
      this._prev = now;
      let draw = this._lpDirty;
      if (this.still && !lp) { const sig = this._stillSig(); if (sig !== this._sig) { this._sig = sig; draw = true; } }
      if (draw) { this._lpDirty = false; this._render(); }
      setTimeout(() => requestAnimationFrame(this._loop), lp >= 2 ? 1000 : 250); return;
    }
    this._sig = null;
    // FPS Cap (Display Settings): frames in between are skipped (the motion
    // still follows the clock, so it keeps its speed)
    const cap = window.__xmbFpsCap || 0;
    if (cap) {
      if (this._due && now < this._due - 1) { requestAnimationFrame(this._loop); return; }
      const step = 1000 / cap;     // (fallen behind: start again from now)
      this._due = this._due && now - this._due < step ? this._due + step : now + step;
    } else this._due = 0;
    const dt = Math.max(0, (now - this._prev) / 1000);
    this._prev = now;
    this._tWave += dt; this._tPart += dt;
    this._render();
    requestAnimationFrame(this._loop);
  }
  _render() {
    const gl = this.gl; if (!gl) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.hidden) return;
    this._renderScene();
  }
  // Complex style, Wave Color "Auto": its background's lower colour, lightened
  _complexAutoTint() {
    if (this.monthMode && this.autoColor) return monthWaveTint(monthGradient(), Math.max(0, Math.min(1, this.settings.autoTintWhite ?? 0.35)));
    const g = resolveBackgroundGradient(this.settings, this.autoColor, 1), w = Math.max(0, Math.min(1, this.settings.autoTintWhite ?? 1));
    const k = this.settings.autoTintBoost ?? 1;
    return g.endRgb.map((c) => { const b = Math.min(1, c * k); return b + (1 - b) * w; });
  }
  _renderScene() {
    const gl = this.gl;
    // In wallpaper mode the bg gradient is skipped so the DOM wallpaper shows.
    // (Complex starts 36 s into its motion: the shape of the reference captures)
    this.splineLayer.render(this._tWave + 36, { wallpaper: this.wallpaper || this.bgOff, waves: this.wavesEnabled, tint: (this.complexAuto ?? this.waveAuto) ? this._complexAutoTint() : this.tint, autoColor: this.autoColor, dayFactor: 1, month: this.monthMode });
    // the sparkles follow the wave's centre line (even with the waves off)
    // with the waves off they stay level across the middle of the screen
    const waveY = this.wavesEnabled ? this.splineLayer.centerline(this._tWave + 36) : null;
    const sh = this._motionShift();
    if (this.dotsEnabled) this.particlesLayer.render(this._tPart, { color: this.dotRgb, shift: waveY ? sh : [sh[0], 0], waveY, wallpaper: this.wallpaper || this.bgOff });
  }
}
