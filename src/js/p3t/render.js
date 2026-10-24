// PS3 dynamic theme player: render. Adapted from DeckyXMB (src/dynamic/render.ts),
// Copyright (c) Callum Bell, BSD 3-Clause License (see README.md, Credits).
// Draws a dynamic theme's scene with WebGL, one textured draw per actor, lit per pixel (with
// the material's normal and specular maps) where its effect is lit. Rigid actors (each vertex
// on one joint) stay on the GPU as they are and are moved by a matrix; skinned actors (vertices
// blended between joints) are skinned on the CPU (a few thousand vertices at most).
import { actorMatrix, mul34 } from "./scene.js";
// DXT → RGBA
function rgb565(c) {
    return [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
}
/** Level 0 of a texture as RGBA. */
export function decodeTexture(t) {
    if (t.format === "rgba")
        return t.data;
    const { width: w, height: h, data: d } = t;
    const out = new Uint8Array(w * h * 4);
    const bw = Math.ceil(w / 4);
    const bh = Math.ceil(h / 4);
    const block = t.format === "dxt1" ? 8 : 16;
    const pal = new Uint8Array(16);
    const alpha = new Uint8Array(16);
    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            let o = (by * bw + bx) * block;
            alpha.fill(255);
            if (t.format === "dxt3") {
                for (let i = 0; i < 16; i++)
                    alpha[i] = ((d[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
                o += 8;
            }
            else if (t.format === "dxt5") {
                const a0 = d[o], a1 = d[o + 1];
                const lut = [a0, a1];
                for (let i = 1; i < 7; i++)
                    lut.push(a0 > a1 ? ((7 - i) * a0 + i * a1) / 7 : i < 5 ? ((5 - i) * a0 + i * a1) / 5 : i === 5 ? 0 : 255);
                if (a0 <= a1)
                    lut.splice(6, 2, 0, 255);
                let bits = 0;
                for (let i = 0; i < 6; i++)
                    bits += d[o + 2 + i] * 2 ** (8 * i);
                for (let i = 0; i < 16; i++)
                    alpha[i] = lut[Math.floor(bits / 2 ** (3 * i)) & 7];
                o += 8;
            }
            const c0 = d[o] | (d[o + 1] << 8);
            const c1 = d[o + 2] | (d[o + 3] << 8);
            const bits = (d[o + 4] | (d[o + 5] << 8) | (d[o + 6] << 16) | (d[o + 7] << 24)) >>> 0;
            const a = rgb565(c0);
            const b = rgb565(c1);
            const four = c0 > c1 || t.format !== "dxt1";
            for (let k = 0; k < 3; k++) {
                pal[k] = a[k];
                pal[4 + k] = b[k];
                pal[8 + k] = four ? (2 * a[k] + b[k]) / 3 : (a[k] + b[k]) / 2;
                pal[12 + k] = four ? (a[k] + 2 * b[k]) / 3 : 0;
            }
            pal[3] = pal[7] = pal[11] = 255;
            pal[15] = four ? 255 : 0;
            for (let py = 0; py < 4; py++) {
                const y = by * 4 + py;
                if (y >= h)
                    break;
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px;
                    if (x >= w)
                        continue;
                    const i = py * 4 + px;
                    const c = ((bits >>> (2 * i)) & 3) * 4;
                    const p = (y * w + x) * 4;
                    out[p] = pal[c];
                    out[p + 1] = pal[c + 1];
                    out[p + 2] = pal[c + 2];
                    out[p + 3] = Math.min(pal[c + 3], alpha[i]);
                }
            }
        }
    }
    return out;
}
// WebGL
// Texels: how far inside its atlas rectangle a card samples, far enough to miss its neighbours
// (the packing is off by up to ~2.3). Not for a card whose edges are solid in a theme whose cards
// fade theirs out: it carries on the page's strokes there, which that smears into streaks; it's
// cut out cleanly, so just enough that filtering doesn't blend its neighbours in.
const EDGE_INSET = 3;
const EDGE_INSET_SOLID = 0.5;
// Film-grain overlays (LittleBigPlanet's "actor_noise"), left undrawn: scaled up to the screen, the grain is heavy.
// The script still moves them; they just aren't shown.
const UNDRAWN = /noise|grain/i;
const VS = `
attribute vec3 aPos;
attribute vec2 aUv;
attribute vec4 aRect; // the UV rectangle of everything on this vertex's joint (its card in an atlas)
attribute vec4 aColor; // vertex colour (atlas themes fade their cards' edges out with its alpha)
attribute vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uModel; // rigid actors: model → world (skinned actors are already in world space)
uniform mat3 uNormalMat;
uniform vec2 uUvShift; // the script's change to the actor's texture offset
varying vec2 vUv;
varying vec4 vRect;
varying vec4 vColor;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vUv = aUv + uUvShift;
  vRect = aRect;
  vColor = aColor;
  vWorld = (uModel * vec4(aPos, 1.0)).xyz;
  vNormal = uNormalMat * aNormal;
  gl_Position = uProj * vec4(vWorld, 1.0);
}`;
/** Lit effects: ambient plus point lights (diffuse and specular), with an optional normal map in
 *  object space or tangent space (its frame from screen-space derivatives, where available). */
const fs = (derivatives) => `${derivatives ? "#extension GL_OES_standard_derivatives : enable\n#define DERIV 1" : ""}
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
varying vec4 vRect;
varying vec4 vColor;
varying vec3 vWorld;
varying vec3 vNormal;
uniform sampler2D uTex;
uniform int uRepeat; // tile in the shader (WebGL can't repeat a non-power-of-two texture)
uniform vec2 uInset; // keep sampling this far inside vRect (0: don't), so a card never picks up its atlas neighbours
uniform int uPass; // 0 all; 1 only where the vertex colour is opaque; 2 only its faded edges
uniform sampler2D uNormalTex;
uniform sampler2D uSpecTex;
uniform vec4 uColor;
uniform float uDim;
uniform int uLit;
uniform int uNormalMode; // 0 none, 1 object space, 2 tangent space
uniform int uHasSpec;
uniform int uEdgeLit;
uniform mat3 uObjRot; // object → world rotation, for object-space normal maps
uniform vec3 uCamPos;
uniform vec3 uAmbient;
uniform int uLights;
uniform vec3 uLightPos[4];
uniform vec3 uLightColor[4];
uniform vec3 uLightAtt[4];
void main() {
  if (uPass == 1 && vColor.a < 0.999) discard;
  if (uPass == 2 && vColor.a >= 0.999) discard;
  vec2 lo = vRect.xy + uInset, hi = vRect.zw - uInset;
  vec2 uv = uRepeat == 1 ? fract(vUv) : uInset.x > 0.0 && hi.x > lo.x && hi.y > lo.y ? clamp(vUv, lo, hi) : vUv;
  vec4 c = texture2D(uTex, uv) * uColor * vColor;
  if (c.a < 0.02) discard;
  if (uLit == 1) {
    vec3 N = normalize(vNormal);
    if (uNormalMode == 1) N = normalize(uObjRot * (texture2D(uNormalTex, vUv).rgb * 2.0 - 1.0));
#ifdef DERIV
    if (uNormalMode == 2) {
      vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld);
      vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
      vec3 p2 = cross(dp2, N), p1 = cross(N, dp1);
      vec3 T = p2 * du1.x + p1 * du2.x;
      vec3 B = p2 * du1.y + p1 * du2.y;
      float k = inversesqrt(max(1e-12, max(dot(T, T), dot(B, B))));
      N = normalize(mat3(T * k, B * k, N) * (texture2D(uNormalTex, vUv).rgb * 2.0 - 1.0));
    }
#endif
    float shine = uHasSpec == 1 ? texture2D(uSpecTex, vUv).r : 0.0;
    vec3 V = normalize(uCamPos - vWorld);
    vec3 light = uAmbient;
    vec3 spec = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      if (i >= uLights) break;
      vec3 L = uLightPos[i] - vWorld;
      float d = length(L);
      L /= max(d, 1e-4);
      float att = 1.0 / max(1e-3, uLightAtt[i].x + uLightAtt[i].y * d + uLightAtt[i].z * d * d);
      light += uLightColor[i] * max(dot(N, L), 0.0) * att;
      spec += uLightColor[i] * pow(max(dot(N, normalize(L + V)), 0.0), 24.0) * shine * att;
    }
    // "edge_lit" effects: a rim of light around the silhouette, in the main light's colour.
    if (uEdgeLit == 1) light += pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.9 * (uLights > 0 ? uLightColor[0] : vec3(1.0));
    c.rgb = c.rgb * light + spec;
  }
  gl_FragColor = vec4(c.rgb * uDim, c.a);
}`;
const OVERSCAN_MAX = 1.1; // zoom at most this much to fill the screen (a TV's overscan was a few percent a side)
const IDENTITY4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const isPow2 = (n) => (n & (n - 1)) === 0;
const FLAT_DENSITY = 0.002; // how closely a cut-out's texels must match the page's in size
const FLAT_DEPTH = 0.03; // how near the page it must be (a share of the camera's distance to it)
/**
 * Atlas themes stack cut-outs of a painted page just in front of it, each one its piece of the
 * page painted over: it only blends in if it lands exactly where that piece is. The tool that
 * made them places them for the camera, and shrinks most of them about their centre to make up
 * for being nearer it, but leaves some at scale 1; those come out up to 1% too big, and their
 * edges (where the page's own strokes carry on) step out of line. Those are shrunk the same
 * way: the joints at scale 1 whose texels are the page's size, that sit near it. The page:
 * the model's largest flat card.
 */
function flatCards(g, pose) {
    if (pose.length < 3 || !g.joints?.length)
        return null;
    const box = new Map(); // x0 x1 y0 y1 u0 u1 v0 v1 z0 z1, first vertex
    const skip = new Set();
    for (let i = 0; i < g.positions.length / 3; i++) {
        const j = g.joints[4 * i];
        if (g.weights && g.weights[4 * i] < 0.999)
            skip.add(j);
        const b = box.get(j) ?? [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, i];
        const v = [g.positions[3 * i], g.positions[3 * i + 1], g.uvs[2 * i], g.uvs[2 * i + 1], g.positions[3 * i + 2]];
        for (let k = 0; k < 5; k++) {
            b[2 * k] = Math.min(b[2 * k], v[k]);
            b[2 * k + 1] = Math.max(b[2 * k + 1], v[k]);
        }
        box.set(j, b);
    }
    const ok = (j) => {
        const b = box.get(j);
        return !skip.has(j) && b[9] - b[8] < 1e-4 && b[1] > b[0] && b[3] > b[2] && b[5] > b[4] && b[7] > b[6];
    };
    let page = -1;
    for (const [j, b] of box)
        if (ok(j) && (page < 0 || (b[1] - b[0]) * (b[3] - b[2]) > (box.get(page)[1] - box.get(page)[0]) * (box.get(page)[3] - box.get(page)[2])))
            page = j;
    if (page < 0)
        return null;
    const density = (b) => [(b[1] - b[0]) / (b[5] - b[4]), (b[3] - b[2]) / (b[7] - b[6])];
    const [px, py] = density(box.get(page));
    const centres = new Map(); // (in the model, before skinning)
    for (const [j, b] of box) {
        const s = pose[j]?.slice(8, 11) ?? [];
        if (j === page || !ok(j) || s.some((v) => Math.abs(v - 1) > 1e-4))
            continue;
        const [dx, dy] = density(b);
        if (Math.abs(dx / px - 1) < FLAT_DENSITY && Math.abs(dy / py - 1) < FLAT_DENSITY)
            centres.set(j, [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, b[8]]);
    }
    return centres.size ? { page, pageVertex: box.get(page)[10], centres } : null;
}
/** Every vertex in one plane (a flat picture: a card or a page), within a small share of its size. */
function isPlanar(p) {
    const n = p.length / 3;
    if (n < 3)
        return true;
    // the plane of the first three vertices that aren't in a line
    const v = (i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
    const a = v(0);
    let size = 0;
    for (let i = 1; i < n; i++)
        size = Math.max(size, Math.hypot(p[3 * i] - a[0], p[3 * i + 1] - a[1], p[3 * i + 2] - a[2]));
    if (!size)
        return true;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 1; i < n && !(nx || ny || nz); i++)
        for (let j = i + 1; j < n; j++) {
            const b = v(i), c = v(j);
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            const x = u[1] * w[2] - u[2] * w[1], y = u[2] * w[0] - u[0] * w[2], z = u[0] * w[1] - u[1] * w[0];
            const l = Math.hypot(x, y, z);
            if (l > 1e-6 * size * size) { nx = x / l; ny = y / l; nz = z / l; break; }
        }
    if (!(nx || ny || nz))
        return true;
    for (let i = 0; i < n; i++)
        if (Math.abs((p[3 * i] - a[0]) * nx + (p[3 * i + 1] - a[1]) * ny + (p[3 * i + 2] - a[2]) * nz) > 1e-3 * size)
            return false;
    return true;
}
export class Renderer {
    /** opts.transparent: drawn on a see-through canvas (a theme's overlay over your own background). */
    constructor(canvas, scene, opts = {}) {
        this.canvas = canvas;
        this.transparent = !!opts.transparent;
        this.scene = scene;
        this.models = new Map(); // per actor (UVs depend on the actor's uv scale/offset)
        this.textures = new Map();
        this.npot = new Set(); // textures WebGL can't repeat
        this.texSize = new Map();
        this.proj = new Float32Array(16);
        this.viewKey = ""; // the projection, as a key: still actors are re-measured when it changes
        this.fit = { aspect: 0, zoom: 1 }; // the overscan zoom (see fitZoom), for the screen's current shape
        this.posed = new Map(); // this frame's poses, by model and what they were posed from
        // (see-through: the colours are kept premultiplied, as the page puts the canvas together with what's behind)
        const gl = this.transparent ? canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true })
            : canvas.getContext("webgl", { alpha: false, antialias: true, premultipliedAlpha: false });
        if (!gl || gl.isContextLost())
            throw new Error("WebGL unavailable");
        this.gl = gl;
        this.uint32 = !!gl.getExtension("OES_element_index_uint");
        this.s3tc = gl.getExtension("WEBGL_compressed_texture_s3tc") ?? gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");
        this.aniso = gl.getExtension("EXT_texture_filter_anisotropic") ?? gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(s) ?? "shader");
            return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
        gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs(!!gl.getExtension("OES_standard_derivatives"))));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(p) ?? "program");
        this.prog = p;
        const names = ["uProj", "uModel", "uNormalMat", "uUvShift", "uTex", "uRepeat", "uInset", "uPass", "uNormalTex", "uSpecTex", "uColor", "uDim", "uLit", "uNormalMode", "uHasSpec", "uEdgeLit", "uObjRot", "uCamPos", "uAmbient", "uLights", "uLightPos", "uLightColor", "uLightAtt"];
        this.loc = {
            pos: gl.getAttribLocation(p, "aPos"),
            uv: gl.getAttribLocation(p, "aUv"),
            rect: gl.getAttribLocation(p, "aRect"),
            color: gl.getAttribLocation(p, "aColor"),
            normal: gl.getAttribLocation(p, "aNormal"),
            u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])),
        };
        this.white = this.upload({ format: "rgba", width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
    }
    /** A texture with its mipmaps: the file's own (DXT, uploaded compressed) or generated. */
    upload(t) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        const pot = isPow2(t.width) && isPow2(t.height);
        let mipmapped = false;
        const direct = this.s3tc && t.format !== "rgba" && t.width % 4 === 0 && t.height % 4 === 0;
        if (direct) {
            const fmt = { dxt1: this.s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, dxt3: this.s3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT, dxt5: this.s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT }[t.format];
            const block = t.format === "dxt1" ? 8 : 16;
            const levels = pot ? (t.levels ?? 1) : 1; // (WebGL 1 takes only the top level of a non-power-of-two one: PixelJunk's 640-wide survivors)
            let off = 0;
            let w = t.width;
            let h = t.height;
            for (let l = 0; l < levels; l++) {
                const size = Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * block;
                gl.compressedTexImage2D(gl.TEXTURE_2D, l, fmt, w, h, 0, t.data.subarray(off, off + size));
                off += size;
                w = Math.max(1, w >> 1);
                h = Math.max(1, h >> 1);
            }
            mipmapped = pot && levels > 1 && levels >= Math.log2(Math.max(t.width, t.height)) + 1;
        }
        else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.width, t.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodeTexture(t));
            if (pot && t.width > 1) {
                gl.generateMipmap(gl.TEXTURE_2D);
                mipmapped = true;
            }
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (!pot)
            this.npot.add(tex);
        this.texSize.set(tex, [t.width, t.height]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        if (this.aniso && mipmapped)
            gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        return tex;
    }
    hasTexture(i) {
        return this.textures.has(i);
    }
    setTexture(i, t) {
        this.textures.set(i, this.upload(t));
    }
    buffers(a) {
        const key = a.data.id;
        const have = this.models.get(key);
        if (have)
            return have;
        const m = a.data.model != null ? this.scene.data.models[a.data.model] : undefined;
        if (!m)
            return null;
        const gl = this.gl;
        const g = m.geometry;
        const n = g.positions.length / 3;
        // Texture coordinates with the actor's scale/offset; a flipped axis maps to 1 - v.
        const uv = new Float32Array(n * 2);
        const [su, sv] = a.data.uvScale;
        const [ou, ov] = a.data.uvOffset;
        for (let i = 0; i < n; i++) {
            const u = g.uvs[2 * i] * su + ou;
            const v = g.uvs[2 * i + 1] * sv + ov;
            uv[2 * i] = su < 0 ? u + 1 : u;
            uv[2 * i + 1] = sv < 0 ? v + 1 : v;
        }
        // Atlas themes cut their pictures out of one big texture, packed edge to edge: each joint's
        // pieces (a card) cover one rectangle of it. Sampling is kept inside that rectangle, so the
        // card's edges don't pick up the next picture over as a light or dark line. Not for UVs
        // beyond the texture (tiling), which wrap.
        const rect = new Float32Array(n * 4);
        const joint = (i) => (g.joints?.length ? g.joints[4 * i] : 0);
        const bounds = new Map();
        for (let i = 0; i < n; i++) {
            const r = bounds.get(joint(i)) ?? [Infinity, Infinity, -Infinity, -Infinity];
            r[0] = Math.min(r[0], uv[2 * i]);
            r[1] = Math.min(r[1], uv[2 * i + 1]);
            r[2] = Math.max(r[2], uv[2 * i]);
            r[3] = Math.max(r[3], uv[2 * i + 1]);
            bounds.set(joint(i), r);
        }
        let tiles = false;
        for (const r of bounds.values())
            if (r[0] < -1e-3 || r[1] < -1e-3 || r[2] > 1 + 1e-3 || r[3] > 1 + 1e-3) {
                r.splice(0, 4, -1e4, -1e4, 1e4, 1e4);
                tiles = true;
            }
        // Solid cards in a theme of fading ones: their rectangle grows so they sample just inside it.
        const colors = g.colors?.length === n * 4 ? g.colors : null;
        const faded = (i) => !!colors && colors[4 * i + 3] < 0.999;
        const solid = new Set(bounds.keys());
        for (let i = 0; i < n; i++)
            if (faded(i))
                solid.delete(joint(i));
        const meta = a.data.texture != null ? this.scene.data.textures[a.data.texture] : undefined;
        if (colors && solid.size < bounds.size && meta) {
            const gx = (EDGE_INSET - EDGE_INSET_SOLID) / meta.width, gy = (EDGE_INSET - EDGE_INSET_SOLID) / meta.height;
            for (const j of solid) {
                const r = bounds.get(j);
                if (r[0] === -1e4)
                    continue; // (tiling)
                r.splice(0, 4, r[0] - gx, r[1] - gy, r[2] + gx, r[3] + gy);
            }
        }
        for (let i = 0; i < n; i++)
            rect.set(bounds.get(joint(i)), 4 * i);
        const mk = (target, data, usage) => {
            const b = gl.createBuffer();
            gl.bindBuffer(target, b);
            gl.bufferData(target, data, usage);
            return b;
        };
        const big = n > 65535;
        if (big && !this.uint32)
            return null;
        // Rigid if every vertex follows a single joint at full weight (or there's no skeleton).
        let rigid = m.skeleton?.pose.length ? (g.joints[0] ?? 0) : 0;
        if (m.skeleton?.pose.length)
            for (let i = 0; i < n && rigid >= 0; i++) {
                if (g.joints[4 * i] !== rigid || (g.weights && g.weights[4 * i] < 0.999))
                    rigid = -1;
            }
        const normalData = new Float32Array(n * 3);
        if (rigid >= 0 && g.normals?.length)
            normalData.set(g.normals.slice(0, n * 3));
        const step = Math.max(1, Math.floor(n / 256));
        const bufs = {
            pos: mk(gl.ARRAY_BUFFER, rigid >= 0 ? new Float32Array(g.positions) : new Float32Array(n * 3), rigid >= 0 ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW),
            uv: mk(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW),
            rect: mk(gl.ARRAY_BUFFER, rect, gl.STATIC_DRAW),
            color: mk(gl.ARRAY_BUFFER, colors ? new Float32Array(colors) : new Float32Array(n * 4).fill(1), gl.STATIC_DRAW),
            normal: mk(gl.ARRAY_BUFFER, normalData, rigid >= 0 ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW),
            idx: mk(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(g.indexes) : new Uint16Array(g.indexes), gl.STATIC_DRAW),
            count: g.indexes.length,
            posData: new Float32Array(n * 3),
            normalData,
            objRot: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
            rigid,
            model: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
            samples: Array.from({ length: Math.ceil(n / step) }, (_, k) => k * step),
            big,
            edges: null,
            wraps: tiles,
            flat: rigid < 0 && m.skeleton ? flatCards(g, m.skeleton.pose) : null,
            planar: rigid >= 0 && isPlanar(g.positions),
            poseKey: "",
            viewKey: "",
            share: 0,
            near: Infinity,
            far: -Infinity,
            dirty: false,
        };
        if (solid.size < bounds.size) {
            const tris = [];
            for (let t = 0; t < g.indexes.length; t += 3)
                if (faded(g.indexes[t]) || faded(g.indexes[t + 1]) || faded(g.indexes[t + 2]))
                    tris.push(g.indexes[t], g.indexes[t + 1], g.indexes[t + 2]);
            bufs.edges = { idx: mk(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(tris) : new Uint16Array(tris), gl.STATIC_DRAW), count: tris.length };
        }
        this.models.set(key, bufs);
        return bufs;
    }
    /** Skin an actor's vertices (and normals, if lit) for this frame; returns the share of them in view
     *  (or a token share if it covers the view without any vertex inside it), 0 if out of view. */
    pose(a, b) {
        // Static actors (no animation playing, not moved) keep last frame's result.
        const viewKey = this.viewKey;
        // (Cut-outs are sized by their distance from the camera, so for them the view is part of the pose.)
        const key = [a.animState(), a.position, a.rotation, a.direction, a.up, a.scale, b.flat ? viewKey : ""].join("|");
        if (key === b.poseKey) {
            if (viewKey !== b.viewKey) {
                b.viewKey = viewKey;
                b.share = this.measure(b, this.scene.data.models[a.data.model].geometry.positions);
            }
            return b.share;
        }
        b.poseKey = key;
        b.viewKey = viewKey;
        b.dirty = true;
        // Copies of one model posed alike (a character's faces, cross-faded) are skinned once.
        const same = `${a.data.model}|${!!a.data.lit}|${key}`;
        const twin = this.posed.get(same);
        if (twin) {
            b.posData.set(twin.posData);
            b.normalData.set(twin.normalData);
            b.objRot.set(twin.objRot);
            b.model.set(twin.model);
            b.share = twin.share;
            b.near = twin.near;
            b.far = twin.far;
        }
        else
            b.share = this.computePose(a, b);
        this.posed.set(same, b);
        return b.share;
    }
    computePose(a, b) {
        const m = this.scene.data.models[a.data.model];
        const g = m.geometry;
        const place = actorMatrix(a);
        const mats = this.scene.skin(a).map((s) => mul34(place, s));
        const p = g.positions;
        const out = b.posData;
        const nrm = g.normals?.length ? g.normals : null;
        const lit = !!a.data.lit && !!nrm;
        if (lit && mats[0]) {
            // Object-space normal maps turn with the actor (its joint, if rigid; else its first).
            const R = mats[b.rigid] ?? mats[0];
            for (let c = 0; c < 3; c++) {
                const l = Math.hypot(R[c], R[4 + c], R[8 + c]) || 1;
                for (let r = 0; r < 3; r++)
                    b.objRot[3 * c + r] = R[4 * r + c] / l;
            }
        }
        if (b.rigid >= 0) {
            // One matrix for the whole actor; the vertices stay as they are on the GPU.
            const R = mats[b.rigid] ?? mats[0];
            b.model.set([R[0], R[4], R[8], 0, R[1], R[5], R[9], 0, R[2], R[6], R[10], 0, R[3], R[7], R[11], 1]);
            return this.measure(b, p);
        }
        const depth = this.depth();
        const M = new Float32Array(12);
        // Cut-outs sized as if on the page: shrunk about their centre by how much nearer than the page they are.
        const shrink = new Map(); // joint → its centre (posed) and how much it's shrunk
        if (b.flat) {
            const at = (Q, c) => [0, 4, 8].map((r) => Q[r] * c[0] + Q[r + 1] * c[1] + Q[r + 2] * c[2] + Q[r + 3]);
            const k = 3 * b.flat.pageVertex;
            const pageDepth = depth(...at(mats[b.flat.page] ?? mats[0], [p[k], p[k + 1], p[k + 2]]));
            for (const [j, c] of b.flat.centres) {
                const centre = at(mats[j] ?? mats[0], c);
                const s = depth(centre[0], centre[1], centre[2]) / pageDepth;
                if (pageDepth > 0 && s > 0 && Math.abs(s - 1) < FLAT_DEPTH)
                    shrink.set(j, [...centre, s]);
            }
        }
        for (let i = 0, n = p.length / 3; i < n; i++) {
            // Linear blend of up to 4 joints.
            M.fill(0);
            for (let k = 0; k < 4; k++) {
                const w = g.weights ? g.weights[4 * i + k] : k === 0 ? 1 : 0;
                if (!w)
                    continue;
                const J = mats[g.joints[4 * i + k]] ?? mats[0];
                for (let e = 0; e < 12; e++)
                    M[e] += J[e] * w;
            }
            const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
            let wx = M[0] * x + M[1] * y + M[2] * z + M[3];
            let wy = M[4] * x + M[5] * y + M[6] * z + M[7];
            let wz = M[8] * x + M[9] * y + M[10] * z + M[11];
            const c = shrink.size ? shrink.get(g.joints[4 * i]) : undefined;
            if (c) {
                wx = c[0] + (wx - c[0]) * c[3];
                wy = c[1] + (wy - c[1]) * c[3];
                wz = c[2] + (wz - c[2]) * c[3];
            }
            out[3 * i] = wx;
            out[3 * i + 1] = wy;
            out[3 * i + 2] = wz;
            if (lit) {
                let nx = M[0] * nrm[3 * i] + M[1] * nrm[3 * i + 1] + M[2] * nrm[3 * i + 2];
                let ny = M[4] * nrm[3 * i] + M[5] * nrm[3 * i + 1] + M[6] * nrm[3 * i + 2];
                let nz = M[8] * nrm[3 * i] + M[9] * nrm[3 * i + 1] + M[10] * nrm[3 * i + 2];
                const nl = Math.hypot(nx, ny, nz) || 1;
                b.normalData[3 * i] = nx / nl;
                b.normalData[3 * i + 1] = ny / nl;
                b.normalData[3 * i + 2] = nz / nl;
            }
        }
        return this.measure(b, p);
    }
    /** Distance along the camera's direction (view depth). */
    depth() {
        const cam = this.scene.camera;
        const dir = cam.direction.map((v) => v / (Math.hypot(...cam.direction) || 1));
        return (x, y, z) => (x - cam.position[0]) * dir[0] + (y - cam.position[1]) * dir[1] + (z - cam.position[2]) * dir[2];
    }
    /**
     * Where a posed actor is in the current view: sets its near/far and returns the share of it on screen
     * (or a token share if it covers the view without any vertex inside it), 0 if out of view.
     * A rigid one is measured from a sample of its vertices (p, the model's) placed by its matrix; a skinned one from its posed vertices.
     */
    measure(b, p) {
        const P = this.proj;
        const depth = this.depth();
        let inside = 0;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        b.near = Infinity;
        b.far = -Infinity;
        const view = (wx, wy, wz) => {
            const cw = P[3] * wx + P[7] * wy + P[11] * wz + P[15]; // (1 for an orthographic camera)
            if (cw <= 0)
                return;
            const d = depth(wx, wy, wz);
            b.near = Math.min(b.near, d);
            b.far = Math.max(b.far, d);
            const cx = (P[0] * wx + P[4] * wy + P[8] * wz + P[12]) / cw;
            const cy = (P[1] * wx + P[5] * wy + P[9] * wz + P[13]) / cw;
            if (cx >= -1.05 && cx <= 1.05 && cy >= -1.05 && cy <= 1.05)
                inside++;
            minX = Math.min(minX, cx);
            maxX = Math.max(maxX, cx);
            minY = Math.min(minY, cy);
            maxY = Math.max(maxY, cy);
        };
        let count;
        if (b.rigid >= 0) {
            const M = b.model; // (column-major)
            for (const i of b.samples) {
                const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
                view(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
            }
            count = b.samples.length;
        }
        else {
            const q = b.posData;
            count = q.length / 3;
            for (let i = 0; i < count; i++)
                view(q[3 * i], q[3 * i + 1], q[3 * i + 2]);
        }
        return inside ? inside / Math.max(1, count) : maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1 ? 0.001 : 0;
    }
    /** The actors in view now (enabled, not fully faded), most on screen first, with the share in view. */
    visible() {
        this.updateProjection();
        this.viewKey = this.proj.join(",");
        this.posed.clear();
        const out = [];
        for (const a of this.scene.actors) {
            if (!a.enable || a.color[3] <= 0.004 || a.data.model == null || UNDRAWN.test(a.data.id))
                continue;
            const b = this.buffers(a);
            const share = b ? this.pose(a, b) : 0;
            if (share > 0)
                out.push({ actor: a, share });
        }
        return out.sort((x, y) => y.share - x.share);
    }
    updateProjection() {
        const aspect = this.canvas.width / Math.max(1, this.canvas.height);
        if (aspect !== this.fit.aspect)
            this.fit = { aspect, zoom: this.fitZoom(aspect) };
        this.proj = this.viewProj(aspect, this.fit.zoom);
    }
    /**
     * How far to zoom in so the scene's backdrop fills the screen. Some themes' backdrops stop a little short of
     * the edges (Heavy Rain's by about 2% a side), which a TV's overscan hid on the PS3. The best-fitting solid
     * layer decides; more than OVERSCAN_MAX short, the black is meant (a logo on black) and it's left as it is.
     */
    fitZoom(aspect) {
        const P = this.viewProj(aspect);
        let best = Infinity;
        for (const a of this.scene.actors) {
            const m = a.data.model != null ? this.scene.data.models[a.data.model] : undefined;
            if (!m || a.data.blend === "add" || a.data.color[3] < 1)
                continue; // glows and see-through layers don't count
            const g = m.geometry;
            const mats = this.scene.skin(a).map((sk) => mul34(actorMatrix(a), sk));
            const n = g.positions.length / 3;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, behind = false;
            for (let i = 0; i < n && !behind; i += Math.max(1, Math.floor(n / 2000))) {
                const M = mats[g.joints?.[4 * i] ?? 0] ?? mats[0];
                const x = g.positions[3 * i], y = g.positions[3 * i + 1], z = g.positions[3 * i + 2];
                const wx = M[0] * x + M[1] * y + M[2] * z + M[3], wy = M[4] * x + M[5] * y + M[6] * z + M[7], wz = M[8] * x + M[9] * y + M[10] * z + M[11];
                const cw = P[3] * wx + P[7] * wy + P[11] * wz + P[15];
                if (cw <= 0)
                    behind = true; // (reaches behind the camera: can't be bounded on screen)
                const cx = (P[0] * wx + P[4] * wy + P[8] * wz + P[12]) / cw, cy = (P[1] * wx + P[5] * wy + P[9] * wz + P[13]) / cw;
                minX = Math.min(minX, cx);
                maxX = Math.max(maxX, cx);
                minY = Math.min(minY, cy);
                maxY = Math.max(maxY, cy);
            }
            if (behind || !(minX < 0 && maxX > 0 && minY < 0 && maxY > 0))
                continue;
            best = Math.min(best, Math.max(1, -1 / minX, 1 / maxX, -1 / minY, 1 / maxY));
        }
        return best > 1.001 && best <= OVERSCAN_MAX ? best : 1;
    }
    /** Draw the actors in view; dim darkens everything (the trophy page dims the background). */
    draw(dim, actors) {
        const drawn = new Set(actors);
        const gl = this.gl;
        const u = this.loc.u;
        const { canvas } = this;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, this.transparent ? 0 : 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.prog);
        gl.uniformMatrix4fv(u.uProj, false, this.proj);
        gl.uniform1f(u.uDim, dim);
        gl.uniform1i(u.uTex, 0);
        gl.uniform1i(u.uNormalTex, 1);
        gl.uniform1i(u.uSpecTex, 2);
        // The scene's lights: ambient summed, then up to 4 point lights.
        const ambient = [0, 0, 0];
        const points = [];
        for (const l of this.scene.lights) {
            if (l.data.type === 2)
                for (let k = 0; k < 3; k++)
                    ambient[k] += l.color[k];
            else
                points.push(l);
        }
        const lights = points.slice(0, 4);
        gl.uniform3fv(u.uAmbient, ambient);
        gl.uniform1i(u.uLights, lights.length);
        if (lights.length) {
            gl.uniform3fv(u.uLightPos, lights.flatMap((l) => l.position.slice(0, 3)));
            gl.uniform3fv(u.uLightColor, lights.flatMap((l) => l.color.slice(0, 3)));
            gl.uniform3fv(u.uLightAtt, lights.flatMap((l) => l.data.attenuation.slice(0, 3)));
        }
        gl.uniform3fv(u.uCamPos, this.scene.camera.position);
        gl.depthFunc(gl.LEQUAL);
        // Back faces are culled: with depth testing off (depth_0 layers), they would otherwise
        // draw over the front ones (a cloud's far side showing as a rim around it).
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.enable(gl.BLEND);
        // In the scene's own order, as its author arranged it (backgrounds first, overlays last), except
        // that see-through actors (fading in or out, or added on) wait for the solid ones up to the next depth_0 layer:
        // they don't write depth, so a solid one drawn after would paint over them even when behind them.
        // One wholly behind the next solid one is drawn before it, as arranged (Heavy Rain's clouds, seen through its
        // skyline: the skyline's faint haze would otherwise hide them).
        const order = [];
        let waiting = [];
        for (const a of this.scene.actors) {
            if (!drawn.has(a))
                continue;
            if (a.data.depth === false) {
                order.push(...waiting, a);
                waiting = [];
            }
            else if (a.color[3] < 1 || a.data.blend === "add")
                waiting.push(a);
            else {
                const far = this.buffers(a).far;
                order.push(...waiting.filter((w) => this.buffers(w).near >= far), a);
                waiting = waiting.filter((w) => this.buffers(w).near < far);
            }
        }
        order.push(...waiting);
        // A scene without lights draws its lit effects as they are (rather than black).
        const unlit = !this.scene.lights.length;
        for (const a of order) {
            const b = this.buffers(a);
            const tex = a.data.texture != null ? this.textures.get(a.data.texture) : undefined;
            if (!tex && a.data.texture != null)
                continue; // not loaded yet
            const lit = !!a.data.lit && !!this.scene.data.models[a.data.model]?.geometry.normals?.length && !unlit;
            gl.bindBuffer(gl.ARRAY_BUFFER, b.pos);
            if (b.dirty && b.rigid < 0)
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.posData);
            gl.enableVertexAttribArray(this.loc.pos);
            gl.vertexAttribPointer(this.loc.pos, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, b.uv);
            gl.enableVertexAttribArray(this.loc.uv);
            gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, b.rect);
            gl.enableVertexAttribArray(this.loc.rect);
            gl.vertexAttribPointer(this.loc.rect, 4, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, b.color);
            gl.enableVertexAttribArray(this.loc.color);
            gl.vertexAttribPointer(this.loc.color, 4, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, b.normal);
            if (lit && b.dirty && b.rigid < 0)
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.normalData);
            b.dirty = false;
            gl.enableVertexAttribArray(this.loc.normal);
            gl.vertexAttribPointer(this.loc.normal, 3, gl.FLOAT, false, 0, 0);
            // Maps: colour, and for lit actors their normal and specular maps once loaded.
            const nmap = lit && a.data.normalMap != null ? this.textures.get(a.data.normalMap) : undefined;
            const smap = lit && a.data.specularMap != null ? this.textures.get(a.data.specularMap) : undefined;
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, nmap ?? this.white);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, smap ?? this.white);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex ?? this.white);
            gl.uniform1i(u.uLit, lit ? 1 : 0);
            gl.uniform1i(u.uNormalMode, nmap ? (a.data.normalSpace === "object" ? 1 : 2) : 0);
            gl.uniform1i(u.uHasSpec, smap ? 1 : 0);
            gl.uniform1i(u.uEdgeLit, a.data.edgeLit ? 1 : 0);
            // Mirrored (a negative scale: WipEout's far side of the tunnel) turns its faces round: the back is then the front.
            gl.frontFace(a.scale[0] * a.scale[1] * a.scale[2] < 0 ? gl.CW : gl.CCW);
            // A single flat picture (a slideshow's pages: Go-Tobun no Hanayome, scaled -1 on every axis) has no
            // inside to hide, and the PS3 shows it from either side: it isn't culled.
            if (b.planar)
                gl.disable(gl.CULL_FACE);
            else
                gl.enable(gl.CULL_FACE);
            gl.uniformMatrix3fv(u.uObjRot, false, b.objRot);
            gl.uniformMatrix4fv(u.uModel, false, b.rigid >= 0 ? b.model : IDENTITY4);
            gl.uniformMatrix3fv(u.uNormalMat, false, b.rigid >= 0 ? b.objRot : IDENTITY3);
            gl.uniform4fv(u.uColor, a.color.map((v) => Math.max(0, Math.min(1, v))));
            const du = (Number(a.uv_offset[0]) || 0) - a.data.uvOffset[0];
            const dv = (Number(a.uv_offset[1]) || 0) - a.data.uvOffset[1];
            gl.uniform2f(u.uUvShift, du, dv);
            // A tiled or scrolled texture wraps (the film grain jumps about every frame). Once scrolled it keeps
            // wrapping, even when the scroll comes round to 0 (a looping scroll would otherwise jump there).
            if (du || dv)
                b.wraps = true;
            gl.uniform1i(u.uRepeat, b.wraps && tex && this.npot.has(tex) ? 1 : 0);
            // A card samples EDGE_INSET texels inside its rectangle; not a wrapping texture.
            const size = !b.wraps && tex && this.texSize.get(tex);
            gl.uniform2f(u.uInset, size ? EDGE_INSET / size[0] : 0, size ? EDGE_INSET / size[1] : 0);
            // "depth_0" effects (backgrounds, overlays) ignore depth; the rest test it, and write it unless see-through.
            if (a.data.depth === false)
                gl.disable(gl.DEPTH_TEST);
            else
                gl.enable(gl.DEPTH_TEST);
            const add = a.data.blend === "add";
            if (this.transparent)
                // premultiplied: the colour as usual, the coverage built up "over" (added-on light leaves it as it
                // is, so it adds to what's behind the canvas)
                gl.blendFuncSeparate(gl.SRC_ALPHA, add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA, add ? gl.ZERO : gl.ONE, add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
            else
                gl.blendFunc(gl.SRC_ALPHA, add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
            const writes = a.data.depth !== false && a.color[3] >= 1 && !add;
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
            const type = b.big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
            if (writes && b.edges) {
                // Cards with faded edges: the solid parts first, then the edges without writing depth, so
                // a card's fade doesn't hide (cut off) the cards behind it wherever it was drawn first.
                gl.depthMask(true);
                gl.uniform1i(u.uPass, 1);
                gl.drawElements(gl.TRIANGLES, b.count, type, 0);
                gl.depthMask(false);
                gl.uniform1i(u.uPass, 2);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.edges.idx);
                gl.drawElements(gl.TRIANGLES, b.edges.count, type, 0);
            }
            else {
                gl.depthMask(writes);
                gl.uniform1i(u.uPass, 0);
                gl.drawElements(gl.TRIANGLES, b.count, type, 0);
            }
        }
        gl.depthMask(true);
        gl.frontFace(gl.CCW);
    }
    /** Perspective × look-at from the scene's camera (column-major for WebGL). */
    viewProj(aspect, zoom = 1) {
        const c = this.scene.camera;
        const nf = 1 / (c.near - c.far);
        // Perspective, or orthographic (ymag high) for a camera without it.
        const f = c.ymag ? (2 * zoom) / c.ymag : zoom / Math.tan(c.yfov / 2);
        const P = c.ymag
            ? [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 2 * nf, 0, 0, 0, (c.far + c.near) * nf, 1]
            : [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (c.far + c.near) * nf, -1, 0, 0, 2 * c.far * c.near * nf, 0];
        const [ex, ey, ez] = c.position;
        const norm = (v) => {
            const l = Math.hypot(...v) || 1;
            return v.map((x) => x / l);
        };
        const zf = norm(c.direction.map((x) => -x)); // camera looks down -z
        const xs = norm([c.up[1] * zf[2] - c.up[2] * zf[1], c.up[2] * zf[0] - c.up[0] * zf[2], c.up[0] * zf[1] - c.up[1] * zf[0]]);
        const ys = [zf[1] * xs[2] - zf[2] * xs[1], zf[2] * xs[0] - zf[0] * xs[2], zf[0] * xs[1] - zf[1] * xs[0]];
        const dot = (a) => a[0] * ex + a[1] * ey + a[2] * ez;
        const V = [xs[0], ys[0], zf[0], 0, xs[1], ys[1], zf[1], 0, xs[2], ys[2], zf[2], 0, -dot(xs), -dot(ys), -dot(zf), 1];
        const out = new Float32Array(16);
        for (let col = 0; col < 4; col++)
            for (let row = 0; row < 4; row++) {
                let s = 0;
                for (let k = 0; k < 4; k++)
                    s += P[k * 4 + row] * V[col * 4 + k];
                out[col * 4 + row] = s;
            }
        return out;
    }
    dispose() {
        const gl = this.gl;
        for (const t of this.textures.values())
            gl.deleteTexture(t);
        gl.deleteTexture(this.white);
        for (const b of this.models.values())
            [b.pos, b.uv, b.rect, b.color, b.normal, b.idx, b.edges?.idx ?? null].forEach((x) => gl.deleteBuffer(x));
        gl.deleteProgram(this.prog);
        // Given back at once, not when it's collected: each background shown (home, trophy page, a theme switched to) makes
        // one, and Chrome loses the oldest once there are too many.
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
}
