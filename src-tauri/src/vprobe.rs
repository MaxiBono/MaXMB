//! Reads a video's format details straight from the file, without ffmpeg:
//! MP4 / MOV / M4V / 3GP (ISO boxes) and MKV / WebM (EBML). Gives the codecs,
//! picture size, frame rate, channels, sample rate, duration, the subtitle
//! tracks and (for MP4) each track's average bitrate, so the Video Player's
//! top bar shows the real format of what's playing.

use crate::video::{SubStream, VideoInfo};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub fn probe(path: &Path) -> Option<VideoInfo> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "mp4" | "m4v" | "mov" | "3gp" | "3g2" => probe_mp4(path),
        "mkv" | "webm" => probe_mkv(path),
        _ => None,
    }
}

// ------------------------------------------------------------------ MP4
fn be16(b: &[u8], i: usize) -> u32 { b.get(i..i + 2).map(|x| u16::from_be_bytes([x[0], x[1]]) as u32).unwrap_or(0) }
fn be32(b: &[u8], i: usize) -> u32 { b.get(i..i + 4).map(|x| u32::from_be_bytes([x[0], x[1], x[2], x[3]])).unwrap_or(0) }
fn be64(b: &[u8], i: usize) -> u64 { b.get(i..i + 8).map(|x| u64::from_be_bytes(x.try_into().unwrap())).unwrap_or(0) }

/// Children of a box body: (type, body)
fn boxes(b: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 8 <= b.len() {
        let mut size = be32(b, i) as usize;
        let ty = [b[i + 4], b[i + 5], b[i + 6], b[i + 7]];
        let mut hdr = 8;
        if size == 1 { size = be64(b, i + 8) as usize; hdr = 16; }
        else if size == 0 { size = b.len() - i; }
        if size < hdr || i + size > b.len() { break; }
        out.push((ty, &b[i + hdr..i + size]));
        i += size;
    }
    out
}
fn child<'a>(b: &'a [u8], ty: &[u8; 4]) -> Option<&'a [u8]> { boxes(b).into_iter().find(|(t, _)| t == ty).map(|(_, x)| x) }

fn read_moov(path: &Path) -> Option<Vec<u8>> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let mut pos = 0u64;
    let mut hdr = [0u8; 16];
    while pos + 8 <= len {
        f.seek(SeekFrom::Start(pos)).ok()?;
        f.read_exact(&mut hdr[..8]).ok()?;
        let mut size = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as u64;
        let ty = [hdr[4], hdr[5], hdr[6], hdr[7]];
        let mut h = 8u64;
        if size == 1 { f.read_exact(&mut hdr[8..16]).ok()?; size = u64::from_be_bytes(hdr[8..16].try_into().unwrap()); h = 16; }
        else if size == 0 { size = len - pos; }
        if size < h { return None; }
        if &ty == b"moov" {
            if size > 256 * 1024 * 1024 { return None; }
            let mut body = vec![0u8; (size - h) as usize];
            f.read_exact(&mut body).ok()?;
            return Some(body);
        }
        pos += size;
    }
    None
}

fn mp4_codec(fourcc: &[u8], entry: &[u8]) -> String {
    let s = String::from_utf8_lossy(fourcc).to_string();
    match s.as_str() {
        "avc1" | "avc3" => "h264".into(),
        "hvc1" | "hev1" => "hevc".into(),
        "av01" => "av1".into(),
        "vp09" => "vp9".into(),
        "vp08" => "vp8".into(),
        "mp4v" => "mpeg4".into(),
        "s263" | "h263" => "h263".into(),
        "jpeg" | "mjpa" | "mjpb" => "mjpeg".into(),
        "apcn" | "apch" | "apcs" | "apco" | "ap4h" => "prores".into(),
        "mp4a" => {
            // esds: objectTypeIndication 0x6B / 0x69 = MP3, otherwise AAC
            let oti = entry.windows(4).position(|w| w == b"esds").and_then(|p| {
                let e = &entry[p + 4..];
                e.iter().position(|&b| b == 0x04).and_then(|q| {
                    let mut k = q + 1;
                    while k < e.len() && e[k] & 0x80 != 0 { k += 1; }
                    e.get(k + 1).copied()
                })
            });
            if matches!(oti, Some(0x6B) | Some(0x69)) { "mp3".into() } else { "aac".into() }
        }
        ".mp3" => "mp3".into(),
        "ac-3" => "ac3".into(),
        "ec-3" => "eac3".into(),
        "Opus" => "opus".into(),
        "fLaC" => "flac".into(),
        "alac" => "alac".into(),
        "lpcm" | "sowt" | "twos" | "in24" | "in32" | "fl32" | "fl64" => "pcm_s16le".into(),
        "dtsc" | "dtsh" | "dtsl" => "dts".into(),
        "samr" => "amr_nb".into(),
        other => other.trim().to_lowercase(),
    }
}

fn probe_mp4(path: &Path) -> Option<VideoInfo> {
    let moov = read_moov(path)?;
    let mut v = VideoInfo { probed: true, ..Default::default() };
    if let Some(mvhd) = child(&moov, b"mvhd") {
        let (ts, dur) = if mvhd.first() == Some(&1) { (be32(mvhd, 20), be64(mvhd, 24) as f64) } else { (be32(mvhd, 12), be32(mvhd, 16) as f64) };
        if ts > 0 { v.duration = dur / ts as f64; }
    }
    let mut sub_n = 0;
    for (t, trak) in boxes(&moov) {
        if &t != b"trak" { continue; }
        let Some(mdia) = child(trak, b"mdia") else { continue };
        let hdlr = child(mdia, b"hdlr").map(|h| h.get(8..12).unwrap_or(b"    ").to_vec()).unwrap_or_default();
        let (ts, dur) = child(mdia, b"mdhd").map(|m| if m.first() == Some(&1) { (be32(m, 20), be64(m, 24) as f64) } else { (be32(m, 12), be32(m, 16) as f64) }).unwrap_or((0, 0.0));
        let secs = if ts > 0 { dur / ts as f64 } else { v.duration };
        let lang = child(mdia, b"mdhd").map(|m| {
            let l = be16(m, if m.first() == Some(&1) { 32 } else { 20 });
            if l == 0 || l == 0x7fff { String::new() } else {
                [((l >> 10) & 31) as u8 + 0x60, ((l >> 5) & 31) as u8 + 0x60, (l & 31) as u8 + 0x60].iter().map(|&c| c as char).collect()
            }
        }).unwrap_or_default();
        let Some(stbl) = child(mdia, b"minf").and_then(|m| child(m, b"stbl")) else { continue };
        let stsd = child(stbl, b"stsd");
        let entry = stsd.and_then(|s| boxes(s.get(8..).unwrap_or(&[])).into_iter().next());
        // total bytes of the track (stsz) -> average bitrate
        let (count, bytes) = child(stbl, b"stsz").map(|z| {
            let fixed = be32(z, 4) as u64; let n = be32(z, 8) as u64;
            if fixed > 0 { (n, fixed * n) } else { (n, (0..n as usize).map(|i| be32(z, 12 + i * 4) as u64).sum()) }
        }).unwrap_or((0, 0));
        let kb = if secs > 0.0 && bytes > 0 { Some((bytes as f64 * 8.0 / secs / 1000.0).round() as u32) } else { None };
        match &hdlr[..] {
            b"vide" if v.vcodec.is_empty() => {
                if let Some((fc, e)) = entry {
                    v.vcodec = mp4_codec(&fc, e);
                    v.width = be16(e, 24); v.height = be16(e, 26);
                }
                v.vkbps = kb;
                if secs > 0.0 && count > 0 { v.fps = (count as f64 / secs) as f32; }
            }
            b"soun" => {
                v.audio_tracks += 1;
                if v.audio_tracks > 1 { continue; }
                if let Some((fc, e)) = entry {
                    v.acodec = mp4_codec(&fc, e);
                    v.channels = be16(e, 16);
                    v.sample_rate = be32(e, 24) >> 16;
                    if v.sample_rate == 0 && ts > 0 { v.sample_rate = ts; }
                }
                v.akbps = kb;
            }
            b"sbtl" | b"text" | b"subt" | b"clcp" => {
                let codec = entry.map(|(fc, _)| String::from_utf8_lossy(&fc).to_string()).unwrap_or_default();
                v.subs.push(SubStream { index: sub_n, lang, title: String::new(), codec });
                sub_n += 1;
            }
            _ => {}
        }
    }
    if v.vcodec.is_empty() && v.acodec.is_empty() { None } else { Some(v) }
}

// ------------------------------------------------------------------ MKV / WebM
fn vint(b: &[u8], i: usize, strip: bool) -> Option<(u64, usize)> {
    let first = *b.get(i)?;
    if first == 0 { return None; }
    let len = first.leading_zeros() as usize + 1;
    if i + len > b.len() || len > 8 { return None; }
    let mut val = if strip { (first & ((0xFFu16 >> len) as u8)) as u64 } else { first as u64 };
    for k in 1..len { val = (val << 8) | b[i + k] as u64; }
    Some((val, len))
}
/// Elements of an EBML body: (id, data). Unknown-size elements run to the end.
fn elems(b: &[u8]) -> Vec<(u64, &[u8])> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let Some((id, il)) = vint(b, i, false) else { break };
        let Some((size, sl)) = vint(b, i + il, true) else { break };
        let start = i + il + sl;
        let unknown = size == (1u64 << (7 * sl)) - 1;
        let end = if unknown { b.len() } else { (start as u64 + size).min(b.len() as u64) as usize };
        if start > b.len() { break; }
        out.push((id, &b[start..end]));
        if id == 0x1F43B675 { break; }   // first Cluster: the headers are done
        i = end;
    }
    out
}
fn uint(b: &[u8]) -> u64 { b.iter().fold(0u64, |a, &x| (a << 8) | x as u64) }
fn float(b: &[u8]) -> f64 {
    match b.len() { 4 => f32::from_be_bytes(b.try_into().unwrap()) as f64, 8 => f64::from_be_bytes(b.try_into().unwrap()), _ => 0.0 }
}
fn mkv_codec(id: &str) -> String {
    let m = |p: &str| id.starts_with(p);
    if m("V_MPEG4/ISO/AVC") { "h264" } else if m("V_MPEGH/ISO/HEVC") { "hevc" } else if m("V_VP8") { "vp8" }
    else if m("V_VP9") { "vp9" } else if m("V_AV1") { "av1" } else if m("V_MPEG4/ISO") || m("V_MPEG4/MS") { "mpeg4" }
    else if m("V_MPEG2") { "mpeg2video" } else if m("V_MPEG1") { "mpeg1video" } else if m("V_THEORA") { "theora" }
    else if m("V_MJPEG") { "mjpeg" } else if m("V_PRORES") { "prores" } else if m("V_MS/VFW") { "mpeg4" }
    else if m("A_AAC") { "aac" } else if m("A_MPEG/L3") { "mp3" } else if m("A_MPEG/L2") || m("A_MPEG/L1") { "mp2" }
    else if m("A_EAC3") { "eac3" } else if m("A_AC3") { "ac3" } else if m("A_DTS") { "dts" } else if m("A_TRUEHD") { "truehd" }
    else if m("A_FLAC") { "flac" } else if m("A_OPUS") { "opus" } else if m("A_VORBIS") { "vorbis" } else if m("A_ALAC") { "alac" }
    else if m("A_PCM") { "pcm_s16le" } else if m("A_MS/ACM") { "wmav2" } else { return id.to_lowercase() }.into()
}

fn probe_mkv(path: &Path) -> Option<VideoInfo> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let mut buf = vec![0u8; len.min(3 * 1024 * 1024) as usize];
    f.read_exact(&mut buf).ok()?;
    let top = elems(&buf);
    let seg = top.iter().find(|(id, _)| *id == 0x18538067)?.1;
    let mut v = VideoInfo { probed: true, ..Default::default() };
    let mut scale = 1_000_000f64;
    let mut sub_n = 0;
    for (id, body) in elems(seg) {
        match id {
            0x1549A966 => {     // Info
                let mut dur = 0.0;
                for (i, d) in elems(body) {
                    if i == 0x2AD7B1 { scale = uint(d) as f64; }
                    if i == 0x4489 { dur = float(d); }
                }
                v.duration = dur * scale / 1e9;
            }
            0x1654AE6B => {     // Tracks
                for (i, te) in elems(body) {
                    if i != 0xAE { continue; }
                    let (mut ty, mut codec, mut lang, mut name) = (0u64, String::new(), String::new(), String::new());
                    let (mut w, mut h, mut sr, mut ch, mut dflt_dur) = (0u32, 0u32, 0f64, 0u32, 0u64);
                    for (k, d) in elems(te) {
                        match k {
                            0x83 => ty = uint(d),
                            0x86 => codec = String::from_utf8_lossy(d).trim_end_matches('\0').to_string(),
                            0x22B59C => lang = String::from_utf8_lossy(d).trim_end_matches('\0').to_string(),
                            0x536E => name = String::from_utf8_lossy(d).trim_end_matches('\0').to_string(),
                            0x23E383 => dflt_dur = uint(d),
                            0xE0 => for (q, x) in elems(d) { if q == 0xB0 { w = uint(x) as u32 } if q == 0xBA { h = uint(x) as u32 } },
                            0xE1 => for (q, x) in elems(d) { if q == 0xB5 { sr = float(x) } if q == 0x9F { ch = uint(x) as u32 } },
                            _ => {}
                        }
                    }
                    match ty {
                        1 if v.vcodec.is_empty() => {
                            v.vcodec = mkv_codec(&codec); v.width = w; v.height = h;
                            if dflt_dur > 0 { v.fps = (1e9 / dflt_dur as f64) as f32; }
                        }
                        2 => {
                            v.audio_tracks += 1;
                            if v.audio_tracks == 1 { v.acodec = mkv_codec(&codec); v.sample_rate = sr as u32; v.channels = if ch > 0 { ch } else { 1 }; }
                        }
                        0x11 => {
                            v.subs.push(SubStream { index: sub_n, lang, title: name, codec });
                            sub_n += 1;
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    // overall average bitrate (no per-track sizes in the headers)
    if v.duration > 0.0 { v.vkbps = Some((len as f64 * 8.0 / v.duration / 1000.0).round() as u32); }
    if v.vcodec.is_empty() && v.acodec.is_empty() { None } else { Some(v) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vint_reads_sizes() {
        assert_eq!(vint(&[0x81], 0, true), Some((1, 1)));
        assert_eq!(vint(&[0x40, 0x02], 0, true), Some((2, 2)));
        assert_eq!(vint(&[0x1A, 0x45, 0xDF, 0xA3], 0, false), Some((0x1A45DFA3, 4)));
    }
}

#[cfg(test)]
mod file_tests {
    #[test]
    fn probes_sample_files() {
        let Ok(dir) = std::env::var("VPROBE_DIR") else { return };
        for f in ["a.mp4", "a.mkv", "b.webm", "c.mp4"] {
            let p = std::path::Path::new(&dir).join(f);
            if !p.is_file() { continue; }
            let v = super::probe(&p);
            println!("{f}: {:?}", v.map(|v| (v.vcodec, v.width, v.height, v.fps, v.acodec, v.channels, v.sample_rate, v.vkbps, v.akbps, v.duration)));
        }
    }
}
