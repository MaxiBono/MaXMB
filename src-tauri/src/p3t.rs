//! Reading real PS3 themes (.p3t).
//!
//! Adapted from DeckyXMB's `p3t.py` and `raf.py` (Callum Bell, BSD 3-Clause;
//! see README.md, Credits).
//!
//! A .p3t is a tree of named elements (theme > infotable / icontable /
//! bgimagetable / ...) whose attributes are ints, floats, strings, ids or
//! files; files are zlib-compressed and packed after the tree. Icons are GIM
//! images (turned into PNGs here); still backgrounds are JPEGs. Dynamic themes
//! carry an animated 3D scene (RAF: the same element tree, holding models,
//! skeletons, animations, textures, a camera, lights and a script), unpacked
//! into `scene.json`, `script.vsmx` and `texN.z` for the page to draw.
//!
//! `install` unpacks a theme into a folder:
//!   theme.json, icons/<PS3 icon id>.png, background.jpg|png, screenshot.png,
//!   thumb.png, and for a dynamic theme scene.json, script.vsmx, tex0.z ...

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

const NONE: u32 = 0xFFFF_FFFF;
type R<T> = Result<T, String>;

// ---- reading big-endian values with bounds checks ----

fn sl(d: &[u8], a: usize, n: usize) -> R<&[u8]> {
    d.get(a..a.checked_add(n).ok_or("bad offset")?).ok_or_else(|| "ran past the end of the data".to_string())
}
fn u8_(d: &[u8], a: usize) -> R<u8> { d.get(a).copied().ok_or_else(|| "ran past the end of the data".into()) }
fn u16_(d: &[u8], a: usize) -> R<u16> { let b = sl(d, a, 2)?; Ok(u16::from_be_bytes([b[0], b[1]])) }
fn u32_(d: &[u8], a: usize) -> R<u32> { let b = sl(d, a, 4)?; Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]])) }
fn f32_(d: &[u8], a: usize) -> R<f32> { Ok(f32::from_bits(u32_(d, a)?)) }
/// A slice that stops at the end of the data (like Python's slicing).
fn clip(d: &[u8], a: usize, b: usize) -> &[u8] {
    let a = a.min(d.len());
    &d[a..b.clamp(a, d.len())]
}
fn cstr(buf: &[u8], off: usize) -> String {
    let s = clip(buf, off, buf.len());
    let end = s.iter().position(|&c| c == 0).unwrap_or(s.len());
    String::from_utf8_lossy(&s[..end]).into_owned()
}
fn half(h: u16) -> f64 {
    let s = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let e = ((h >> 10) & 31) as i32;
    let m = (h & 1023) as f64;
    s * match e {
        0 => m * 2f64.powi(-24),
        31 => if m == 0.0 { f64::INFINITY } else { f64::NAN },
        _ => (1.0 + m / 1024.0) * 2f64.powi(e - 15),
    }
}
fn rnd(x: f64, k: i32) -> f64 { let p = 10f64.powi(k); (x * p).round() / p }
fn num(x: f64) -> Value { serde_json::Number::from_f64(x).map(Value::Number).unwrap_or(Value::from(0)) }

// ---- the element tree ----

#[derive(Clone)]
pub enum Attr {
    Int(i64),
    Float(f64),
    Str(String),
    Ints(Vec<i64>),
    Floats(Vec<f64>),
    File { raw: Vec<u8>, compressed: bool },
}

impl Attr {
    /// A packed file's bytes (zlib-compressed in a .p3t, unless stored as they are).
    pub fn read(&self) -> Option<Vec<u8>> {
        let Attr::File { raw, compressed } = self else { return None };
        if *compressed {
            let mut out = Vec::new();
            if flate2::read::ZlibDecoder::new(&raw[..]).read_to_end(&mut out).is_ok() { return Some(out); }
        }
        Some(raw.clone())
    }
    fn str(&self) -> Option<&str> { if let Attr::Str(s) = self { Some(s) } else { None } }
    fn int(&self) -> Option<i64> { match self { Attr::Int(i) => Some(*i), Attr::Float(f) => Some(*f as i64), _ => None } }
    fn json(&self) -> Value {
        match self {
            Attr::Int(i) => Value::from(*i),
            Attr::Float(f) => num(*f),
            Attr::Str(s) => Value::from(s.clone()),
            Attr::Ints(v) => Value::from(v.clone()),
            Attr::Floats(v) => Value::Array(v.iter().map(|x| num(*x)).collect()),
            Attr::File { .. } => Value::Null,
        }
    }
}

#[allow(dead_code)]
pub struct Elem { pub depth: usize, pub name: String, pub attrs: HashMap<String, Attr> }
impl Elem {
    fn get(&self, k: &str) -> Option<&Attr> { self.attrs.get(k) }
    fn s(&self, k: &str) -> String { self.get(k).and_then(|a| a.str()).unwrap_or("").to_string() }
    fn j(&self, k: &str, def: Value) -> Value {
        match self.get(k) {
            Some(a) => { let v = a.json(); if v.is_null() { def } else { v } }
            None => def,
        }
    }
    fn is_file(&self, k: &str) -> bool { matches!(self.get(k), Some(Attr::File { .. })) }
}

/// The element tree of a .p3t (or of a RAF scene), as a flat list in tree order.
pub fn parse(data: &[u8], compressed: bool) -> R<Vec<Elem>> {
    let magic = sl(data, 0, 4)?;
    if magic != b"P3TF" && magic != b"RAFO" { return Err("not a PS3 theme file".into()); }
    let h: Vec<usize> = (0..13).map(|i| u32_(data, 4 + 4 * i).map(|v| v as usize)).collect::<R<_>>()?;
    let (hs, ts, ido, idz, so, sz, io, iz, fo, fz, d_o, dz) = (h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8], h[9], h[10], h[11], h[12]);
    let tree = clip(data, hs, hs + ts);
    let ids = clip(data, ido, ido + idz);
    let strs = clip(data, so, so + sz);
    let files = clip(data, d_o, d_o + dz);
    let ints_b = clip(data, io, io + iz - iz % 4);
    let flts_b = clip(data, fo, fo + fz - fz % 4);
    let ints: Vec<i64> = ints_b.chunks_exact(4).map(|c| i32::from_be_bytes([c[0], c[1], c[2], c[3]]) as i64).collect();
    let floats: Vec<f64> = flts_b.chunks_exact(4).map(|c| f32::from_be_bytes([c[0], c[1], c[2], c[3]]) as f64).collect();
    let mut out = Vec::new();
    let mut stack = vec![(0usize, 0usize)];
    let mut seen = std::collections::HashSet::new();
    while let Some((off, depth)) = stack.pop() {
        if off + 28 > tree.len() || !seen.insert(off) { continue; }
        let w = |i: usize| u32_(tree, off + 4 * i).unwrap_or(NONE);
        let (name, n, nxt, first) = (w(0), w(1), w(4), w(5));
        let mut attrs = HashMap::new();
        for i in 0..n as usize {
            let a = off + 28 + 16 * i;
            if a + 16 > tree.len() { break; }
            let (an, kind, v1, v2) = (u32_(tree, a)?, u32_(tree, a + 4)?, u32_(tree, a + 8)?, u32_(tree, a + 12)?);
            let key = cstr(strs, an as usize);
            let (v1u, v2u) = (v1 as usize, v2 as usize);
            let val = match kind {
                1 => Attr::Int(v1 as i32 as i64),
                2 => Attr::Float(f32::from_bits(v1) as f64),
                3 => Attr::Str(cstr(strs, v1u)),
                4 => Attr::Ints(ints.get(v1u.min(ints.len())..(v1u + v2u).min(ints.len())).unwrap_or(&[]).to_vec()),
                5 => Attr::Floats(floats.get(v1u.min(floats.len())..(v1u + v2u).min(floats.len())).unwrap_or(&[]).to_vec()),
                6 => Attr::File { raw: clip(files, v1u, v1u + v2u).to_vec(), compressed },
                7 | 8 => Attr::Str(cstr(ids, v1u + 4)), // each id is stored after a 4-byte back reference
                _ => continue,
            };
            attrs.insert(key, val);
        }
        out.push(Elem { depth, name: cstr(strs, name as usize), attrs });
        if nxt != NONE { stack.push((nxt as usize, depth)); }
        if first != NONE { stack.push((first as usize, depth + 1)); }
    }
    Ok(out)
}

// ---- GIM → PNG ----

pub fn encode_png(w: u32, h: u32, rgba: &[u8]) -> R<Vec<u8>> { png(w, h, rgba) }

/// A scene texture's first level as RGBA (DXT1/3/5 blocks or RGBA already).
pub fn texture_rgba(format: &str, w: usize, h: usize, data: &[u8]) -> Option<Vec<u8>> {
    if w == 0 || h == 0 { return None; }
    if format == "rgba" { return (data.len() >= w * h * 4).then(|| data[..w * h * 4].to_vec()); }
    let block = match format { "dxt1" => 8, "dxt3" | "dxt5" => 16, _ => return None };
    let (bw, bh) = ((w + 3) / 4, (h + 3) / 4);
    if data.len() < bw * bh * block { return None; }
    let c565 = |c: u16| [((c >> 11) & 31) as u32 * 255 / 31, ((c >> 5) & 63) as u32 * 255 / 63, (c & 31) as u32 * 255 / 31];
    let mut out = vec![0u8; w * h * 4];
    for by in 0..bh {
        for bx in 0..bw {
            let b = &data[(by * bw + bx) * block..][..block];
            let col = if block == 16 { &b[8..16] } else { &b[0..8] };
            let (c0, c1) = (u16::from_le_bytes([col[0], col[1]]), u16::from_le_bytes([col[2], col[3]]));
            let (p0, p1) = (c565(c0), c565(c1));
            let mut pal = [[0u32; 4]; 4];
            pal[0] = [p0[0], p0[1], p0[2], 255];
            pal[1] = [p1[0], p1[1], p1[2], 255];
            if c0 > c1 || block == 16 {
                for k in 0..3 { pal[2][k] = (2 * p0[k] + p1[k]) / 3; pal[3][k] = (p0[k] + 2 * p1[k]) / 3; }
                pal[2][3] = 255; pal[3][3] = 255;
            } else {
                for k in 0..3 { pal[2][k] = (p0[k] + p1[k]) / 2; }
                pal[2][3] = 255; pal[3] = [0, 0, 0, 0];
            }
            let bits = u32::from_le_bytes([col[4], col[5], col[6], col[7]]);
            // alpha (DXT3: 4 bits each; DXT5: two values and 3-bit indexes)
            let mut alpha = [255u8; 16];
            if format == "dxt3" {
                for i in 0..16 { let v = (b[i / 2] >> (4 * (i % 2))) & 15; alpha[i] = v * 17; }
            } else if format == "dxt5" {
                let (a0, a1) = (b[0] as u32, b[1] as u32);
                let mut ap = [a0, a1, 0, 0, 0, 0, 0, 0];
                if a0 > a1 { for i in 1..7 { ap[i + 1] = ((7 - i as u32) * a0 + i as u32 * a1) / 7; } }
                else { for i in 1..5 { ap[i + 1] = ((5 - i as u32) * a0 + i as u32 * a1) / 5; } ap[6] = 0; ap[7] = 255; }
                let mut ab = 0u64;
                for k in 0..6 { ab |= (b[2 + k] as u64) << (8 * k); }
                for i in 0..16 { alpha[i] = ap[((ab >> (3 * i)) & 7) as usize] as u8; }
            }
            for py in 0..4 {
                for px in 0..4 {
                    let (x, y) = (bx * 4 + px, by * 4 + py);
                    if x >= w || y >= h { continue; }
                    let i = py * 4 + px;
                    let c = pal[((bits >> (2 * i)) & 3) as usize];
                    let o = (y * w + x) * 4;
                    out[o] = c[0] as u8; out[o + 1] = c[1] as u8; out[o + 2] = c[2] as u8;
                    out[o + 3] = if block == 16 { alpha[i] } else { c[3] as u8 };
                }
            }
        }
    }
    Some(out)
}

fn png(w: u32, h: u32, rgba: &[u8]) -> R<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().map_err(|e| e.to_string())?;
        wr.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// PSP "faststorage" order: 16-byte x 8-row tiles.
fn unswizzle(buf: &[u8], pitch: usize, rows: usize) -> Vec<u8> {
    let mut out = vec![0u8; buf.len()];
    let mut src = 0;
    let mut ty = 0;
    while ty < rows {
        let mut tx = 0;
        while tx < pitch {
            for y in ty..(ty + 8).min(rows) {
                let d = y * pitch + tx;
                let n = 16.min(out.len().saturating_sub(d)).min(buf.len().saturating_sub(src));
                out[d..d + n].copy_from_slice(&buf[src..src + n]);
                src += 16;
            }
            tx += 16;
        }
        ty += 8;
    }
    out
}

fn expand(fmt: u16, px: &[u8], count: usize, big: bool) -> Vec<u8> {
    if fmt == 3 { let mut v = clip(px, 0, 4 * count).to_vec(); v.resize(4 * count, 0); return v; }
    let mut out = vec![0u8; 4 * count];
    for i in 0..count {
        let Some(b) = px.get(2 * i..2 * i + 2) else { break };
        let v = if big { u16::from_be_bytes([b[0], b[1]]) } else { u16::from_le_bytes([b[0], b[1]]) } as u32;
        let (r, g, bl, a) = match fmt {
            0 => ((v & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, ((v >> 11) & 31) * 255 / 31, 255),
            1 => ((v & 31) * 255 / 31, ((v >> 5) & 31) * 255 / 31, ((v >> 10) & 31) * 255 / 31, if v >> 15 != 0 { 255 } else { 0 }),
            _ => ((v & 15) * 17, ((v >> 4) & 15) * 17, ((v >> 8) & 15) * 17, (v >> 12) * 17),
        };
        out[4 * i..4 * i + 4].copy_from_slice(&[r as u8, g as u8, bl as u8, a as u8]);
    }
    out
}

/// The first image of a GIM as a PNG (direct colour and 4/8-bit palettes).
pub fn gim_to_png(gim: &[u8]) -> R<Vec<u8>> {
    let magic = sl(gim, 0, 4)?;
    let big = magic == b".GIM";
    if !big && magic != b"MIG." { return Err("not a GIM image".into()); }
    let rd16 = |a: usize| -> R<u16> { let b = sl(gim, a, 2)?; Ok(if big { u16::from_be_bytes([b[0], b[1]]) } else { u16::from_le_bytes([b[0], b[1]]) }) };
    let rd32 = |a: usize| -> R<u32> { let b = sl(gim, a, 4)?; Ok(if big { u32::from_be_bytes([b[0], b[1], b[2], b[3]]) } else { u32::from_le_bytes([b[0], b[1], b[2], b[3]]) }) };
    let (mut image, mut palette) = (None, None);
    let mut blocks = vec![(16usize, gim.len())];
    let mut guard = 0;
    while let Some((mut off, end)) = blocks.pop() {
        while off + 16 <= end {
            guard += 1;
            if guard > 10_000 { return Err("GIM blocks loop".into()); }
            let kind = rd16(off)?;
            let size = rd32(off + 4)? as usize;
            let doff = rd32(off + 12)? as usize;
            match kind {
                2 | 3 => blocks.push((off + doff, (off + size).min(gim.len()))),
                4 if image.is_none() => image = Some(off + doff),
                5 if palette.is_none() => palette = Some(off + doff),
                _ => {}
            }
            if size == 0 { break; }
            off += size;
        }
    }
    let image = image.ok_or("GIM has no image")?;
    let header = |at: usize| -> R<(u16, u16, usize, usize, usize, usize)> {
        let fmt = rd16(at + 4)?;
        let order = rd16(at + 6)?;
        let w = rd16(at + 8)? as usize;
        let h = rd16(at + 10)? as usize;
        let start = at + rd32(at + 0x1C)? as usize;
        let stop = at + rd32(at + 0x20)? as usize;
        Ok((fmt, order, w, h, start, stop))
    };
    let (fmt, order, w, h, start, stop) = header(image)?;
    let mut data = clip(gim, start, stop).to_vec();
    let bits = match fmt { 0..=2 => 16, 3 => 32, 4 => 4, 5 => 8, _ => return Err(format!("unsupported GIM format {fmt}")) };
    let rows = if h > 0 { h } else { 1 };
    let pitch = data.len() / rows;
    if order == 1 { data = unswizzle(&data, pitch, rows); }
    let mut rgba = Vec::with_capacity(w * h * 4);
    if fmt == 4 || fmt == 5 {
        let pal = palette.ok_or("indexed GIM without a palette")?;
        let (pfmt, _, pw, _, ps, pe) = header(pal)?;
        let colours = expand(pfmt, clip(gim, ps, pe), pw, big);
        for y in 0..h {
            let row = clip(&data, y * pitch, (y + 1) * pitch);
            for x in 0..w {
                let idx = if fmt == 4 { (row.get(x >> 1).copied().unwrap_or(0) >> (4 * (x & 1))) & 15 } else { row.get(x).copied().unwrap_or(0) } as usize;
                let c = colours.get(4 * idx..4 * idx + 4).unwrap_or(&[0, 0, 0, 0]);
                rgba.extend_from_slice(c);
            }
        }
    } else {
        let bpp = bits / 8;
        for y in 0..h {
            rgba.extend(expand(fmt, clip(&data, y * pitch, y * pitch + w * bpp), w, big));
        }
    }
    png(w as u32, h as u32, &rgba)
}

// ---- RAF: the animated scene of a dynamic theme ----

struct Bits<'a> { b: &'a [u8], n: usize, p: usize }
impl<'a> Bits<'a> {
    fn new(b: &'a [u8]) -> Self { Bits { b, n: b.len() * 8, p: 0 } }
    fn read(&mut self, k: usize) -> R<u64> {
        if k == 0 { return Ok(0); }
        if self.p + k > self.n { return Err("ran past the end of packed data".into()); }
        let mut r = 0u64;
        for _ in 0..k {
            let bit = (self.b[self.p >> 3] >> (7 - (self.p & 7))) & 1;
            r = (r << 1) | bit as u64;
            self.p += 1;
        }
        Ok(r)
    }
}

/// Edge compressed indexes (see raf.py for the layout).
fn indexes(blob: &[u8], num_indexes: usize) -> R<Vec<i64>> {
    let bias = u16_(blob, 2)? as i64;
    let seq_bytes = u16_(blob, 4)? as usize;
    let dbits = u8_(blob, 6)? as usize;
    let ntri = num_indexes / 3;
    let tri_bytes = (ntri * 2 + 7) / 8;
    let mut seq = Bits::new(clip(blob, 8, 8 + seq_bytes));
    let mut tri = Bits::new(clip(blob, 8 + seq_bytes, 8 + seq_bytes + tri_bytes));
    let mut deltas = Bits::new(clip(blob, 8 + seq_bytes + tri_bytes, blob.len()));
    let codes: Vec<u64> = (0..ntri).map(|_| tri.read(2)).collect::<R<_>>()?;
    let mut refs: Vec<i64> = Vec::new();
    let mut nxt = 0i64;
    let mut get = |seq: &mut Bits, deltas: &mut Bits, refs: &mut Vec<i64>| -> R<i64> {
        if seq.read(1)? == 0 { nxt += 1; return Ok(nxt - 1); }
        let base = if refs.len() >= 8 { refs[refs.len() - 8] } else { 0 };
        let v = deltas.read(dbits)? as i64 + base - bias;
        refs.push(v);
        Ok(v)
    };
    let mut out = Vec::with_capacity(ntri * 3);
    let mut prev: Option<[i64; 3]> = None;
    for c in codes {
        let t = match (c, prev) {
            (0..=2, Some(p)) => {
                let (i, j) = [(0, 2), (2, 1), (1, 0)][c as usize];
                [p[i], p[j], get(&mut seq, &mut deltas, &mut refs)?]
            }
            _ => {
                let a = get(&mut seq, &mut deltas, &mut refs)?;
                let b = get(&mut seq, &mut deltas, &mut refs)?;
                [a, b, get(&mut seq, &mut deltas, &mut refs)?]
            }
        };
        out.extend_from_slice(&t);
        prev = Some(t);
    }
    Ok(out)
}

struct AttrDesc { offset: usize, format: u8, count: usize, id: u8 }
fn stream_desc(data: &[u8], off: usize) -> R<(usize, Vec<AttrDesc>)> {
    let n = u8_(data, off)? as usize;
    let stride = u8_(data, off + 1)? as usize;
    let mut attrs = Vec::new();
    for i in 0..n {
        let o = off + 8 + 8 * i;
        attrs.push(AttrDesc { offset: u8_(data, o)? as usize, format: u8_(data, o + 1)?, count: u8_(data, o + 2)? as usize, id: u8_(data, o + 3)? });
    }
    Ok((stride, attrs))
}

fn read_attr(data: &[u8], base: usize, stride: usize, a: &AttrDesc, nverts: usize) -> R<Vec<f64>> {
    let mut out = Vec::with_capacity(nverts * a.count.max(3));
    let sx = |v: u32, n: u32| -> f64 { let v = v as i64; let s = if v >= 1 << (n - 1) { v - (1 << n) } else { v }; s as f64 / ((1i64 << (n - 1)) - 1) as f64 };
    for v in 0..nverts {
        let p = base + v * stride + a.offset;
        match a.format {
            2 => for k in 0..a.count { out.push(f32_(data, p + 4 * k)? as f64) },
            3 => for k in 0..a.count { out.push(half(u16_(data, p + 2 * k)?)) },
            4 => for k in 0..a.count { out.push(u8_(data, p + k)? as f64 / 255.0) },
            6 => {
                let w = u32_(data, p)?;
                out.extend([sx(w & 0x7FF, 11), sx((w >> 11) & 0x7FF, 11), sx(w >> 22, 10)]);
            }
            f => return Err(format!("unsupported vertex format {f}")),
        }
    }
    Ok(out)
}

struct Seg { positions: Vec<f64>, normals: Option<Vec<f64>>, uvs: Vec<f64>, colors: Option<Vec<f64>>, joints: Vec<i64>, weights: Vec<f64>, indexes: Vec<i64> }

fn segment(data: &[u8], seg: &[u8]) -> R<Seg> {
    if u8_(seg, 2)? != 0 { return Err(format!("unsupported input vertex format {}", seg[2])); }
    let nverts = u16_(seg, 8)? as usize;
    let nidx = u16_(seg, 10)? as usize;
    let idx_off = u32_(seg, 0x10)? as usize;
    let idx_size = u16_(seg, 0x14)? as usize;
    let v0 = u32_(seg, 0x18)? as usize;
    let v1 = u32_(seg, 0x1C)? as usize;
    let rsx_off = u32_(seg, 0x2C)? as usize;
    let mat_offs = [u16_(seg, 0x34)? as usize, u16_(seg, 0x36)? as usize];
    let mat_size0 = u16_(seg, 0x38)? as usize;
    let skin_size = u16_(seg, 0x3C)? as usize;
    let skin_off = u32_(seg, 0x40)? as usize;
    let spu_desc = u32_(seg, 0x6C)? as usize;
    let rsx_desc = u32_(seg, 0x74)? as usize;
    let positions = (0..3 * nverts).map(|i| f32_(data, v0 + 4 * i).map(|x| x as f64)).collect::<R<Vec<_>>>()?;
    let mut normals = None;
    if v1 != 0 && spu_desc != 0 {
        let (stride, attrs) = stream_desc(data, spu_desc)?;
        for a in &attrs { if a.id == 2 { normals = Some(read_attr(data, v1, stride, a, nverts)?); } }
    }
    let (mut uvs, mut colors) = (None, None);
    if rsx_desc != 0 {
        let (stride, attrs) = stream_desc(data, rsx_desc)?;
        for a in &attrs {
            if a.id == 5 && uvs.is_none() {
                uvs = Some(read_attr(data, rsx_off, stride, a, nverts)?);
            } else if a.id == 9 && a.count == 4 && colors.is_none() {
                let c = read_attr(data, rsx_off, stride, a, nverts)?;
                if c.iter().all(|&x| (-0.001..=1.001).contains(&x)) { colors = Some(c); }
            }
        }
    }
    let uvs = uvs.unwrap_or_else(|| vec![0.0; 2 * nverts]);
    let mut joints = vec![0i64; 4 * nverts];
    let mut weights = vec![0f64; 4 * nverts];
    if seg[6] & 0x0F != 0 && skin_off != 0 && skin_size != 0 {
        let per = ((skin_size / nverts.max(1)).min(8) & !1).max(2);
        let first = [mat_offs[0] / 48, mat_offs[1] / 48];
        let count0 = mat_size0 / 48;
        for v in 0..nverts {
            let rec = sl(data, skin_off + per * v, per)?;
            for k in 0..(per / 2).min(4) {
                weights[4 * v + k] = rec[2 * k] as f64 / 255.0;
                let l = rec[2 * k + 1] as usize;
                joints[4 * v + k] = (if l < count0 { first[0] + l } else { first[1] + (l - count0) }) as i64;
            }
        }
    } else {
        for v in 0..nverts { weights[4 * v] = 1.0; }
    }
    let indexes = indexes(clip(data, idx_off, idx_off + idx_size), nidx)?;
    Ok(Seg { positions, normals, uvs, colors, joints, weights, indexes })
}

fn floats(v: &[f64], k: i32) -> Value { Value::Array(v.iter().map(|x| num(rnd(*x, k))).collect()) }

fn geometry(data: &[u8]) -> R<Value> {
    let nseg = u32_(data, 0)? as usize;
    let seg_off = u32_(data, 4)? as usize;
    let (mut pos, mut nor, mut uvs, mut col, mut joi, mut wei, mut idx) = (vec![], vec![], vec![], vec![], vec![], vec![], vec![]);
    let (mut has_normals, mut has_colors) = (true, false);
    for s in 0..nseg {
        // a piece whose triangles can't be read (some theme makers leave
        // empty, zeroed index data for pieces that never show) is left out,
        // instead of losing the whole animated background
        let g = match segment(data, sl(data, seg_off + 0x80 * s, 0x80)?) {
            Ok(g) => g,
            Err(e) => { warn_log!("p3t: a piece of a model left out ({e})"); continue; }
        };
        let base = (pos.len() / 3) as i64;
        let n = g.positions.len() / 3;
        if g.indexes.iter().any(|&i| i < 0 || i >= n as i64) { warn_log!("p3t: a piece of a model left out (indexes out of range)"); continue; }
        pos.extend(g.positions);
        uvs.extend(g.uvs);
        joi.extend(g.joints);
        wei.extend(g.weights);
        idx.extend(g.indexes.iter().map(|i| i + base));
        match g.colors { Some(c) => { has_colors = true; col.extend(c) } None => col.extend(std::iter::repeat(1.0).take(4 * n)) }
        match g.normals { Some(v) => nor.extend(v), None => has_normals = false }
    }
    if !has_normals { nor.clear(); }
    let mut m = Map::new();
    m.insert("positions".into(), floats(&pos, 5));
    m.insert("normals".into(), floats(&nor, 5));
    m.insert("uvs".into(), floats(&uvs, 5));
    if has_colors { m.insert("colors".into(), floats(&col, 5)); }
    m.insert("joints".into(), Value::from(joi));
    m.insert("weights".into(), floats(&wei, 5));
    m.insert("indexes".into(), Value::from(idx));
    Ok(Value::Object(m))
}

fn skeleton(data: &[u8]) -> R<Value> {
    if sl(data, 0, 4)? != b"ES01" { return Err("not an Edge skeleton".into()); }
    let n = u16_(data, 12)? as usize;
    if n == 0 { return Ok(json!({"parents": [], "pose": []})); }
    let base = 0x14 + u32_(data, 0x14)? as usize;
    let mut pose = Vec::new();
    for j in 0..n {
        let v = (0..12).map(|k| f32_(data, base + 48 * j + 4 * k).map(|x| x as f64)).collect::<R<Vec<_>>>()?;
        pose.push(floats(&v, 6));
    }
    let mut parents = vec![-1i64; n];
    let mut o = 0x30;
    while o + 4 <= base {
        let (j, p) = (u16_(data, o)? as usize, u16_(data, o + 2)? as usize);
        if p != 0xFFFF && j < n && (p & 0x7FFF) < n { parents[j] = (p & 0x7FFF) as i64; }
        o += 4;
    }
    Ok(json!({"parents": parents, "pose": pose}))
}

fn comps(spec: u32) -> [(usize, usize, usize); 3] {
    let mut out = [(0, 0, 0); 3];
    for (c, o) in out.iter_mut().enumerate() {
        let v = (spec >> (32 - 10 * (c + 1))) & 1023;
        *o = (((v >> 9) & 1) as usize, ((v >> 5) & 15) as usize, (v & 31) as usize);
    }
    out
}
fn spec_bits(spec: u32) -> usize { comps(spec).iter().map(|(s, e, m)| s + e + m).sum() }

fn values(bits: &mut Bits, spec: u32) -> R<Vec<f64>> {
    let mut out = Vec::with_capacity(4);
    for (sb, eb, mb) in comps(spec) {
        if eb == 0 {
            let mut raw = bits.read(sb + mb)? as i64;
            if sb != 0 {
                if raw >= 1 << (sb + mb - 1) { raw -= 1 << (sb + mb); }
                out.push(raw as f64 / (1u64 << mb) as f64);
            } else {
                out.push(raw as f64 / ((1i64 << mb) - 1).max(1) as f64);
            }
            continue;
        }
        let s = bits.read(sb)?;
        let e = bits.read(eb)? as i32;
        let m = bits.read(mb)? as f64;
        let bias = (1i32 << (eb - 1)) - 1;
        let v = 2f64.powi(e - bias) * (1.0 + m / (1u64 << mb) as f64);
        out.push(if s != 0 { -v } else { v });
    }
    Ok(out)
}
fn key(bits: &mut Bits, spec: u32, rotation: bool) -> R<Vec<f64>> {
    let mut v = values(bits, spec)?;
    if rotation {
        let w = (1.0 - v.iter().map(|x| x * x).sum::<f64>()).max(0.0).sqrt();
        v.insert((spec & 3) as usize, w);
    }
    Ok(v)
}

const KINDS: [&str; 3] = ["rotation", "translation", "scale"];

fn animation(data: &[u8]) -> R<Map<String, Value>> {
    if sl(data, 0, 4)? != b"EA03" { return Err("not an Edge animation".into()); }
    let duration = f32_(data, 4)? as f64;
    let freq = f32_(data, 8)? as f64;
    let nframes = u16_(data, 16)?;
    let nsets = u16_(data, 18)? as usize;
    let counts: Vec<usize> = (0..8).map(|i| u16_(data, 0x16 + 2 * i).map(|v| v as usize)).collect::<R<_>>()?;
    if counts[7] != 0 { return Err("animation uses user channels".into()); }
    let rel = |at: usize| -> R<usize> { Ok(at + u32_(data, at)? as usize) };
    let (dma, info, spec_at) = (rel(0x34)?, rel(0x38)?, rel(0x4C)?);
    let const_at = [rel(0x3C)?, rel(0x40)?, rel(0x44)?];
    let pad4 = |n: usize| (n + 3) / 4 * 4;
    let rd_list = |t: usize, n: usize| -> R<Vec<usize>> { (0..n).map(|i| u16_(data, t + 2 * i).map(|v| v as usize)).collect() };
    let mut t = 0x60;
    let mut lists = Vec::new();
    for &n in &counts[..4] { lists.push(rd_list(t, n)?); t += 2 * pad4(n); }
    let anim_pad: usize = counts[4..7].iter().map(|&n| pad4(n)).sum();
    t = t.max(const_at[0].saturating_sub(2 * anim_pad));
    for &n in &counts[4..7] { lists.push(rd_list(t, n)?); t += 2 * pad4(n); }
    let mut keys: Vec<std::collections::BTreeMap<usize, Vec<Vec<f64>>>> = vec![Default::default(); 3];
    let mut groups: Vec<(usize, Vec<usize>, Vec<u32>)> = Vec::new();
    let mut o = spec_at;
    for g in 0..3 {
        let n = counts[4 + g];
        let const_spec = u32_(data, o)?;
        let specs = (0..n).map(|i| u32_(data, o + 4 + 4 * i)).collect::<R<Vec<_>>>()?;
        groups.push((g, lists[4 + g].clone(), specs));
        o += 4 + 4 * n;
        let nb = (lists[g].len() * spec_bits(const_spec) + 7) / 8;
        let mut b = Bits::new(clip(data, const_at[g], const_at[g] + nb));
        for &j in &lists[g] {
            let mut k = vec![0.0];
            k.extend(key(&mut b, const_spec, g == 0)?);
            keys[g].insert(j, vec![k]);
        }
    }
    let channels: Vec<(usize, usize, u32)> = groups.iter().flat_map(|(g, js, ss)| js.iter().zip(ss).map(move |(j, s)| (*g, *j, *s))).collect();
    for (g, js, _) in &groups { for j in js { keys[*g].insert(*j, vec![]); } }
    for i in 0..nsets {
        let size = u32_(data, dma + 8 * i)? as usize;
        let off = u32_(data, dma + 8 * i + 4)? as usize;
        let start = u16_(data, info + 4 * i)? as f64;
        let nintra = u16_(data, info + 4 * i + 2)? as usize;
        if size == 0 && off + 16 > data.len() { continue; }
        let h: Vec<usize> = (0..8).map(|k| u16_(data, off + 2 * k).map(|v| v as usize)).collect::<R<_>>()?;
        let mut p = off + 16;
        for (gi, (g, joints, specs)) in groups.iter().enumerate() {
            let nbits: usize = specs.iter().map(|s| spec_bits(*s)).sum();
            let nbytes = if gi < 2 { h[gi] } else { (nbits + 7) / 8 };
            let mut b = Bits::new(clip(data, p, p + nbytes));
            for (j, s) in joints.iter().zip(specs) {
                let mut k = vec![start];
                k.extend(key(&mut b, *s, *g == 0)?);
                keys[*g].get_mut(j).unwrap().push(k);
            }
            p += nbytes;
        }
        if size == 0 { continue; }
        let mask_at = off + 16 + h[0] + h[1] + h[2];
        let intra = [h[4], h[5]];
        if intra == [0, 0] && counts[6] == 0 { continue; }
        let nch = channels.len();
        let mbytes = (nch * nintra + 7) / 8;
        let mut mbits = Bits::new(clip(data, mask_at, mask_at + mbytes));
        let mut masks = Vec::with_capacity(nch);
        for _ in 0..nch {
            let mut m = Vec::new();
            for f in 0..nintra { if mbits.read(1)? != 0 { m.push(f); } }
            masks.push(m);
        }
        let mut need = [0usize; 3];
        for (c, (g, _, s)) in channels.iter().enumerate() { need[*g] += masks[c].len() * spec_bits(*s); }
        if (need[0] + 7) / 8 != intra[0] || (need[1] + 7) / 8 != intra[1] || (need[2] + 7) / 8 > h[6] {
            return Err("animation keyframe masks don't match".into());
        }
        let mut p = mask_at + mbytes;
        let mut streams = Vec::new();
        for g in 0..3 {
            let n = if g < 2 { intra[g] } else { (need[2] + 7) / 8 };
            streams.push(Bits::new(clip(data, p, p + n)));
            p += n;
        }
        for (c, (g, j, s)) in channels.iter().enumerate() {
            for &f in &masks[c] {
                let mut k = vec![start + 1.0 + f as f64];
                k.extend(key(&mut streams[*g], *s, *g == 0)?);
                keys[*g].get_mut(j).unwrap().push(k);
            }
        }
    }
    let mut out = Map::new();
    out.insert("duration".into(), num(duration));
    out.insert("fps".into(), num(freq));
    out.insert("frames".into(), Value::from(nframes));
    for (g, kind) in KINDS.iter().enumerate() {
        let mut m = Map::new();
        for (j, list) in keys[g].iter_mut() {
            list.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
            let arr: Vec<Value> = list.iter().map(|k| {
                let mut v = vec![Value::from(k[0] as i64)];
                v.extend(k[1..].iter().map(|x| num(rnd(*x, 5))));
                Value::Array(v)
            }).collect();
            m.insert(j.to_string(), Value::Array(arr));
        }
        out.insert((*kind).into(), Value::Object(m));
    }
    Ok(out)
}

fn swizzle_bits(w: usize, h: usize) -> (Vec<usize>, Vec<usize>) {
    let bl = |n: usize| if n <= 1 { 0 } else { (usize::BITS - (n - 1).leading_zeros()) as usize };
    let (lw, lh) = (bl(w), bl(h));
    let (mut xs, mut ys) = (vec![0usize; w], vec![0usize; h]);
    let mut shift = 0;
    for i in 0..lw.max(lh) {
        if i < lw { for (x, v) in xs.iter_mut().enumerate() { *v |= ((x >> i) & 1) << shift; } shift += 1; }
        if i < lh { for (y, v) in ys.iter_mut().enumerate() { *v |= ((y >> i) & 1) << shift; } shift += 1; }
    }
    (xs, ys)
}

/// (meta, payload): DXT blocks with their mipmap levels, or RGBA8; rows tightly packed.
fn texture(data: &[u8]) -> R<(Map<String, Value>, Vec<u8>)> {
    let off = u32_(data, 16)? as usize;
    let tsize = u32_(data, 20)? as usize;
    let fmt = u8_(data, 24)?;
    let mips = u8_(data, 25)? as usize;
    let cube = u8_(data, 27)?;
    let w = u16_(data, 32)? as usize;
    let h = u16_(data, 34)? as usize;
    let pitch = u32_(data, 40)? as usize;
    if cube != 0 { return Err("cube map texture".into()); }
    let base = fmt & !0x60;
    let linear = fmt & 0x20 != 0;
    let tex = clip(data, off, off + tsize);
    let mut meta = Map::new();
    if (0x86..=0x88).contains(&base) {
        let block = if base == 0x86 { 8 } else { 16 };
        let mut levels: Vec<u8> = Vec::new();
        let mut count = 0;
        let mut p = 0;
        let (mut lw, mut lh) = (w, h);
        for lvl in 0..mips.max(1) {
            let (bw, bh) = (((lw + 3) / 4).max(1), ((lh + 3) / 4).max(1));
            let row = if linear && pitch != 0 && lvl == 0 { pitch } else { bw * block };
            if p + row * bh > tex.len() { break; }
            for y in 0..bh { levels.extend_from_slice(&tex[p + y * row..p + y * row + bw * block]); }
            count += 1;
            p += row * bh;
            if lw == 1 && lh == 1 { break; }
            lw = (lw / 2).max(1);
            lh = (lh / 2).max(1);
        }
        let f = match base { 0x86 => "dxt1", 0x87 => "dxt3", _ => "dxt5" };
        meta.insert("format".into(), f.into());
        meta.insert("width".into(), w.into());
        meta.insert("height".into(), h.into());
        meta.insert("levels".into(), count.into());
        return Ok((meta, levels));
    }
    if base == 0x85 {
        let (xs, ys) = if linear { (vec![], vec![]) } else { swizzle_bits(w, h) };
        let row = if pitch != 0 { pitch } else { w * 4 };
        let mut px = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = if linear { y * row + 4 * x } else { 4 * (xs[x] | ys[y]) };
                let s = sl(tex, i, 4)?;
                let o = 4 * (w * y + x);
                px[o..o + 4].copy_from_slice(&[s[1], s[2], s[3], s[0]]);
            }
        }
        meta.insert("format".into(), "rgba".into());
        meta.insert("width".into(), w.into());
        meta.insert("height".into(), h.into());
        meta.insert("levels".into(), 1.into());
        return Ok((meta, px));
    }
    Err(format!("unsupported texture format {fmt:#x}"))
}

/// (scene, texture payloads, script) of a decompressed RAF ("RAFO").
fn export_scene(raf: &[u8]) -> R<(Value, Vec<Vec<u8>>, Vec<u8>)> {
    let tree = parse(raf, false)?;
    let file_list: Vec<&Elem> = tree.iter().filter(|e| e.name == "file").collect();
    let files: HashMap<String, &Elem> = file_list.iter().filter(|e| e.is_file("src")).map(|e| (e.s("id"), *e)).collect();
    let fdata = |e: &Elem| -> R<Vec<u8>> {
        if let Some(i) = e.get("fileindex").and_then(|a| a.int()) {
            return file_list.get(i as usize).and_then(|f| f.get("src")).and_then(|a| a.read()).ok_or_else(|| "missing file".to_string());
        }
        if let Some(r) = e.get("fileref").and_then(|a| a.str()) {
            return files.get(r).and_then(|f| f.get("src")).and_then(|a| a.read()).ok_or_else(|| "missing file".to_string());
        }
        Err("missing file reference".into())
    };
    let ty = |e: &Elem| e.get("type").and_then(|a| a.int()).unwrap_or(0);

    let (mut textures, mut payloads) = (Vec::new(), Vec::new());
    let (mut tex_index, mut tex_type) = (HashMap::new(), HashMap::new());
    for e in tree.iter().filter(|e| e.name == "texture" && (0..=3).contains(&ty(e))) {
        let (mut meta, payload) = texture(&fdata(e)?)?;
        // how much of the picture is solid (0..1): a backdrop or a cut-out piece of
        // scenery has plenty; smoke, snow, beams and glows are see-through
        // throughout (the theme's Overlay part tells them apart with it)
        let (fw, fh) = (meta["width"].as_u64().unwrap_or(0) as usize, meta["height"].as_u64().unwrap_or(0) as usize);
        let solid = texture_rgba(meta["format"].as_str().unwrap_or(""), fw, fh, &payload).map(|px| {
            let n = px.len() / 4;
            px.chunks_exact(4).filter(|c| c[3] >= 250).count() as f64 / n.max(1) as f64
        }).unwrap_or(0.0);
        meta.insert("solid".into(), num(rnd(solid, 3)));
        let id = e.s("id");
        tex_index.insert(id.clone(), textures.len());
        tex_type.insert(id.clone(), ty(e));
        meta.insert("id".into(), id.into());
        textures.push(Value::Object(meta));
        payloads.push(payload);
    }

    // materials: effect, first colour / normal / specular map
    struct Mat { effect: String, texture: Option<usize>, normal: Option<usize>, space: Option<&'static str>, spec: Option<usize> }
    let mut materials: HashMap<String, Mat> = HashMap::new();
    let mut cur: Option<String> = None;
    for e in &tree {
        if e.name == "material" {
            let id = e.s("id");
            let effect = e.get("effect").and_then(|a| a.str()).unwrap_or("pure_texture").to_string();
            materials.insert(id.clone(), Mat { effect, texture: None, normal: None, space: None, spec: None });
            cur = Some(id);
        } else if e.name == "_texture" {
            let Some(m) = cur.as_ref().and_then(|c| materials.get_mut(c)) else { continue };
            let r = e.s("texref");
            let Some(&kind) = tex_type.get(&r) else { continue };
            let idx = tex_index[&r];
            match kind {
                0 => { if m.texture.is_none() { m.texture = Some(idx) } }
                1 | 3 => { if m.normal.is_none() { m.normal = Some(idx); m.space = Some(if kind == 1 { "object" } else { "tangent" }); } }
                2 => { if m.spec.is_none() { m.spec = Some(idx) } }
                _ => {}
            }
        }
    }

    let mut models: Vec<Map<String, Value>> = Vec::new();
    let mut model_index = HashMap::new();
    let mut in_model = false;
    for e in &tree {
        if e.name == "model" {
            let mut m = Map::new();
            m.insert("id".into(), e.s("id").into());
            model_index.insert(e.s("id"), models.len());
            models.push(m);
            in_model = true;
        } else if in_model && ["geometry", "inv-bind", "skeleton", "animation"].contains(&e.name.as_str()) {
            let blob = fdata(e)?;
            let cur = models.last_mut().unwrap();
            let ctx = |err: String| format!("{} {}: {err}", e.name, e.s("id"));
            match e.name.as_str() {
                "geometry" => { cur.insert("geometry".into(), geometry(&blob).map_err(ctx)?); }
                "inv-bind" => {
                    let v: Vec<f64> = blob.chunks_exact(4).map(|c| f32::from_be_bytes([c[0], c[1], c[2], c[3]]) as f64).collect();
                    cur.insert("invBind".into(), floats(&v, 6));
                }
                "skeleton" => { cur.insert("skeleton".into(), skeleton(&blob)?); }
                _ => {
                    let mut a = animation(&blob).map_err(ctx)?;
                    a.insert("id".into(), e.s("id").into());
                    a.insert("start".into(), e.j("start", json!(0.0)));
                    a.insert("end".into(), e.j("end", json!(0.0)));
                    let list = cur.entry("animations").or_insert_with(|| json!([]));
                    list.as_array_mut().unwrap().push(Value::Object(a));
                }
            }
        }
    }

    let nonempty = |e: &Elem, k: &str| -> Value {
        let v = e.j(k, Value::Null);
        if v.as_array().map(|a| a.is_empty()).unwrap_or(true) { json!([1]) } else { v }
    };
    let mut actors = Vec::new();
    for e in tree.iter().filter(|e| e.name == "actor") {
        let mat = materials.get(&e.s("material"));
        let mut a = Map::new();
        a.insert("id".into(), e.s("id").into());
        a.insert("model".into(), model_index.get(&e.s("model")).map(|&i| Value::from(i)).unwrap_or(Value::Null));
        a.insert("texture".into(), mat.and_then(|m| m.texture).map(Value::from).unwrap_or(Value::Null));
        let eff = mat.map(|m| m.effect.as_str());
        a.insert("lit".into(), Value::from(eff.map(|f| !f.starts_with("pure_texture")).unwrap_or(false)));
        a.insert("depth".into(), Value::from(!eff.map(|f| f.contains("depth_0")).unwrap_or(false)));
        a.insert("edgeLit".into(), Value::from(eff.map(|f| f.contains("edge_lit")).unwrap_or(false)));
        if eff.map(|f| f.ends_with("_add")).unwrap_or(false) { a.insert("blend".into(), "add".into()); }
        if let Some(m) = mat {
            if let Some(n) = m.normal { a.insert("normalMap".into(), n.into()); a.insert("normalSpace".into(), m.space.unwrap_or("tangent").into()); }
            if let Some(s) = m.spec { a.insert("specularMap".into(), s.into()); }
        }
        a.insert("position".into(), e.j("position", json!([0, 0, 0])));
        a.insert("rotation".into(), e.j("rotation", json!([0, 0, 0])));
        a.insert("scale".into(), e.j("scale", json!([1, 1, 1])));
        a.insert("color".into(), e.j("color", json!([1, 1, 1, 1])));
        a.insert("uvScale".into(), e.j("uv_scale", json!([1, 1])));
        a.insert("uvOffset".into(), e.j("uv_offset", json!([0, 0])));
        a.insert("animSpeeds".into(), nonempty(e, "anim_speed"));
        let t = e.j("anim_time", Value::Null);
        a.insert("animTimes".into(), if t.as_array().map(|a| a.is_empty()).unwrap_or(true) { json!([0]) } else { t });
        a.insert("animWeights".into(), nonempty(e, "anim_weight"));
        actors.push(Value::Object(a));
    }
    let lights: Vec<Value> = tree.iter().filter(|e| e.name == "light").map(|e| json!({
        "id": e.s("id"), "type": e.j("type", json!(0)), "color": e.j("color", json!([1, 1, 1])),
        "position": e.j("position", json!([0, 0, 0])), "direction": e.j("direction", json!([0, 0, -1])),
        "attenuation": e.j("attenuation", json!([1, 0, 0])),
    })).collect();
    let empty = Elem { depth: 0, name: String::new(), attrs: HashMap::new() };
    let cam = tree.iter().find(|e| e.name == "camera").unwrap_or(&empty);
    let mut camera = json!({
        "id": cam.s("id"), "yfov": cam.j("yfov", json!(0.6)), "near": cam.j("znear", json!(0.1)), "far": cam.j("zfar", json!(1000.0)),
        "position": cam.j("position", json!([0, 0, 10])), "direction": cam.j("direction", json!([0, 0, -1])), "up": cam.j("up", json!([0, 1, 0])),
    });
    if cam.get("type").and_then(|a| a.int()) == Some(1) { camera["ymag"] = cam.j("ymag", json!(1.0)); }
    let script = match tree.iter().find(|e| e.name == "script") { Some(e) => fdata(e)?, None => vec![] };
    let scene = json!({ "camera": camera, "actors": actors, "models": models, "textures": textures, "lights": lights });
    Ok((scene, payloads, script))
}

fn install_scene(blob: &[u8], dest: &Path) -> R<()> {
    let raf = if blob.starts_with(b"_RAF") {
        let mut out = Vec::new();
        flate2::read::ZlibDecoder::new(clip(blob, 8, blob.len())).read_to_end(&mut out).map_err(|e| e.to_string())?;
        out
    } else { blob.to_vec() };
    if !raf.starts_with(b"RAFO") { return Err("not a RAF scene".into()); }
    let (scene, payloads, script) = export_scene(&raf)?;
    fs::write(dest.join("scene.json"), serde_json::to_vec(&scene).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::write(dest.join("script.vsmx"), script).map_err(|e| e.to_string())?;
    for (i, t) in payloads.iter().enumerate() {
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
        z.write_all(t).map_err(|e| e.to_string())?;
        fs::write(dest.join(format!("tex{i}.z")), z.finish().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---- VAG (PlayStation ADPCM) → WAV ----

/// A PS3 sound effect (VAG: mono 4-bit ADPCM, 28 samples per 16-byte block)
/// as a 16-bit WAV; with `right`, the two make a stereo sound.
pub fn vag_to_wav(left: &[u8], right: Option<&[u8]>) -> R<Vec<u8>> {
    fn decode(v: &[u8]) -> R<(Vec<i16>, u32)> {
        let (rate, start) = if v.starts_with(b"VAGp") { (u32_(v, 16)?, 48) } else { (44100, 0) };
        const K: [(f64, f64); 5] = [(0.0, 0.0), (60.0, 0.0), (115.0, -52.0), (98.0, -55.0), (122.0, -60.0)];
        let (mut s1, mut s2) = (0f64, 0f64);
        let mut out = Vec::new();
        let mut p = start;
        while p + 16 <= v.len() {
            let b = &v[p..p + 16];
            p += 16;
            let flags = b[1];
            if flags == 7 { break; }   // end of the sound
            let shift = (b[0] & 15) as i32;
            let (c0, c1) = K[((b[0] >> 4) as usize).min(4)];
            for k in 0..28 {
                let byte = b[2 + k / 2];
                let nib = if k % 2 == 0 { byte & 15 } else { byte >> 4 };
                let raw = ((nib as i16) << 12) >> 4;          // sign-extended, scaled to 12 bits
                let sample = ((raw as i32) << 4 >> shift.min(12)) as f64 + (s1 * c0 + s2 * c1) / 64.0;
                let x = sample.round().clamp(-32768.0, 32767.0);
                out.push(x as i16);
                s2 = s1; s1 = x;
            }
            if flags == 1 { break; }   // (last block, no loop)
        }
        if out.is_empty() { return Err("empty sound".into()); }
        Ok((out, if rate == 0 { 44100 } else { rate }))
    }
    let (l, rate) = decode(left)?;
    let r = match right { Some(r) => Some(decode(r)?.0), None => None };
    let ch: u16 = if r.is_some() { 2 } else { 1 };
    let frames = r.as_ref().map(|r| r.len().min(l.len())).unwrap_or(l.len());
    let data_len = frames as u32 * ch as u32 * 2;
    let mut w = Vec::with_capacity(44 + data_len as usize);
    w.extend_from_slice(b"RIFF"); w.extend_from_slice(&(36 + data_len).to_le_bytes()); w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes()); w.extend_from_slice(&1u16.to_le_bytes()); w.extend_from_slice(&ch.to_le_bytes());
    w.extend_from_slice(&rate.to_le_bytes()); w.extend_from_slice(&(rate * ch as u32 * 2).to_le_bytes());
    w.extend_from_slice(&(ch * 2).to_le_bytes()); w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data"); w.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..frames {
        w.extend_from_slice(&l[i].to_le_bytes());
        if let Some(r) = &r { w.extend_from_slice(&r[i].to_le_bytes()); }
    }
    Ok(w)
}

/// The folder name a theme is unpacked into: its name and a checksum of the file.
pub fn theme_id(name: &str, data: &[u8]) -> String {
    let mut slug = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() { slug.push(c) } else if !slug.ends_with('-') { slug.push('-') }
    }
    let slug: String = slug.trim_matches('-').chars().take(40).collect();
    let slug = slug.trim_end_matches('-');
    let mut crc = flate2::Crc::new();
    crc.update(data);
    format!("{}-{:08x}", if slug.is_empty() { "theme" } else { slug }, crc.sum())
}

/// Unpack a .p3t into `root/<id>/` (see the module notes). Returns its theme.json.
pub fn install(path: &Path, root: &Path) -> R<Value> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let tree = parse(&data, true)?;
    let empty = Elem { depth: 0, name: String::new(), attrs: HashMap::new() };
    let info = tree.iter().find(|e| e.name == "info").unwrap_or(&empty);
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let name = Some(info.s("name")).filter(|s| !s.is_empty()).unwrap_or(stem);
    let tid = theme_id(&name, &data);
    let dest = root.join(&tid);
    let tmp = root.join(format!("{tid}.part"));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(tmp.join("icons")).map_err(|e| e.to_string())?;

    let mut icons = Vec::new();
    for e in tree.iter().filter(|e| e.name == "icon") {
        let id = e.s("id");
        let Some(raw) = e.get("src").and_then(|a| a.read()) else { continue };
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') { continue; }
        let Ok(p) = gim_to_png(&raw) else { continue };   // skip an icon that can't be read
        if fs::write(tmp.join("icons").join(format!("{id}.png")), p).is_ok() { icons.push(id); }
    }

    let (mut background, mut dynamic, mut scene) = (String::new(), false, false);
    for e in tree.iter().filter(|e| e.name == "bgimage") {
        if let Some(anim) = e.get("anim").and_then(|a| a.read()) {
            if !scene {
                dynamic = true;
                match install_scene(&anim, &tmp) {
                    Ok(()) => scene = true,
                    Err(err) => warn_log!("p3t: animated background of {} can't be shown ({err})", path.display()),
                }
            }
        }
        if background.is_empty() {
            if let Some(img) = e.get("hd").and_then(|a| a.read()).or_else(|| e.get("sd").and_then(|a| a.read())) {
                let ext = if img.starts_with(b"\x89PNG") { "png" } else { "jpg" };
                let f = format!("background.{ext}");
                if fs::write(tmp.join(&f), img).is_ok() { background = f; }
            }
        }
    }
    let mut screenshot = String::new();
    if let Some(p) = info.get("preview").and_then(|a| a.read()).and_then(|g| gim_to_png(&g).ok()) {
        if fs::write(tmp.join("screenshot.png"), p).is_ok() { screenshot = "screenshot.png".into(); }
    }
    let mut thumb = String::new();
    if let Some(p) = info.get("icon").and_then(|a| a.read()).and_then(|g| gim_to_png(&g).ok()) {
        if fs::write(tmp.join("thumb.png"), p).is_ok() { thumb = "thumb.png".into(); }
    }
    // sound effects (VAG → WAV), mouse pointers (with their tips), the
    // notification box, the font style and the colour
    let ok_id = |id: &str| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    let mut sounds = serde_json::Map::new();
    for e in tree.iter().filter(|e| e.name == "se") {
        let id = e.s("id");
        if !ok_id(&id) { continue; }
        let mono = e.get("src").and_then(|a| a.read());
        let (l, r) = (e.get("left").and_then(|a| a.read()), e.get("right").and_then(|a| a.read()));
        let wav = match (mono, l, r) {
            (Some(m), _, _) => vag_to_wav(&m, None),
            (None, Some(l), Some(r)) => vag_to_wav(&l, Some(&r)),
            (None, Some(l), None) => vag_to_wav(&l, None),
            _ => continue,
        };
        let Ok(wav) = wav else { continue };
        let _ = fs::create_dir_all(tmp.join("sounds"));
        let f = format!("sounds/{id}.wav");
        if fs::write(tmp.join(&f), wav).is_ok() { sounds.insert(id, Value::from(f)); }
    }
    let mut pointers = serde_json::Map::new();
    for e in tree.iter().filter(|e| e.name == "pointer") {
        let id = e.s("id");
        if !ok_id(&id) { continue; }
        let Some(p) = e.get("src").and_then(|a| a.read()).and_then(|g| gim_to_png(&g).ok()) else { continue };
        let _ = fs::create_dir_all(tmp.join("pointers"));
        let f = format!("pointers/{id}.png");
        if fs::write(tmp.join(&f), p).is_ok() {
            let xy = |k: &str| e.get(k).and_then(|a| a.int()).unwrap_or(0);
            pointers.insert(id, json!({ "file": f, "x": xy("base_x"), "y": xy("base_y") }));
        }
    }
    let mut notification = String::new();
    if let Some(p) = tree.iter().find(|e| e.name == "notification").and_then(|e| e.get("src")).and_then(|a| a.read()).and_then(|g| gim_to_png(&g).ok()) {
        if fs::write(tmp.join("notification.png"), p).is_ok() { notification = "notification.png".into(); }
    }
    let sel = |n: &str| tree.iter().find(|e| e.name == n).and_then(|e| e.get("selection")).and_then(|a| a.int());
    let meta = json!({
        "id": tid, "name": name, "author": info.s("author"), "comment": info.s("comment"),
        "file": path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        "icons": icons, "background": background, "screenshot": screenshot, "thumb": thumb,
        "dynamic": dynamic, "scene": scene, "sounds": sounds, "pointers": pointers,
        "notification": notification, "font": sel("font"), "color": sel("color"), "version": 2,
    });
    fs::write(tmp.join("theme.json"), serde_json::to_vec_pretty(&meta).unwrap_or_default()).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn halves() {
        assert_eq!(half(0x3C00), 1.0);
        assert_eq!(half(0xC000), -2.0);
        assert_eq!(half(0x3800), 0.5);
    }
    #[test]
    fn ids() {
        assert_eq!(theme_id("BATMAN V SUPERMAN: DAWN", b"x").split('-').take(4).collect::<Vec<_>>().join("-"), "batman-v-superman-dawn");
    }
    /// Unpacks the themes in P3T_TEST_DIR (when set) into P3T_TEST_OUT.
    #[test]
    fn real_themes() {
        let (Ok(dir), Ok(out)) = (std::env::var("P3T_TEST_DIR"), std::env::var("P3T_TEST_OUT")) else { return };
        for e in fs::read_dir(dir).unwrap().flatten() {
            if e.path().extension().map(|x| x == "p3t").unwrap_or(false) {
                let m = install(&e.path(), Path::new(&out)).unwrap();
                println!("{}", m);
                assert!(m["scene"].as_bool().unwrap());
            }
        }
    }
}


