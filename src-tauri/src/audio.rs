//! On-demand audio decoding for formats the webview can't play natively.
//!
//! WebView2 (the Windows webview) plays mp3/aac/m4a/flac/wav/ogg out of the box,
//! but NOT WMA, ATRAC (.at3/.at9/.oma/.aa3) or DSD (.dsf/.dff). When the
//! `<audio>` element errors on one of those, the frontend calls `decode_audio`,
//! which transcodes the file to a temporary 16-bit PCM WAV and hands back its
//! path (loaded through the asset protocol like any other local file).
//!
//! Two decoders:
//!   * DSD `.dsf` — decoded natively here, no external tools. The 1-bit
//!     sigma-delta stream is low-pass filtered (windowed-sinc FIR, applied with
//!     a per-byte lookup table for speed) and decimated to 44.1 kHz PCM.
//!   * Everything else (WMA, ATRAC, .dff, …) — handed to an `ffmpeg` binary if
//!     one is available (bundled next to the app under `resources/ffmpeg/`, or
//!     on the system PATH). ffmpeg is the canonical decoder for those codecs.
//!
//! Results are cached in content/data/temp keyed by source path + size + mtime,
//! so repeat plays of the same track don't re-decode.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

#[tauri::command]
pub fn decode_audio(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("file not found: {}", path));
    }
    // Decoded WAVs are named by a hash of the source identity. They may live in
    // the OS temp dir (default) or, when "Keep Preloaded Songs Data" is on, in a
    // folder inside the app's own directory so they survive a restart.
    let fname = cache_name(&src);
    let temp_path = crate::paths::temp_dir(&app).join(&fname);
    let keep_path = crate::paths::preloaded_songs_dir(&app).join(&fname);
    // reuse an existing decode from either location, whatever the current setting
    if keep_path.is_file() {
        return Ok(keep_path.to_string_lossy().to_string());
    }
    if temp_path.is_file() {
        return Ok(temp_path.to_string_lossy().to_string());
    }
    let out = if keep_preloaded(&app) { keep_path } else { temp_path };

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let res = match ext.as_str() {
        "dsf" => decode_dsf(&src, &out),
        _ => decode_with_ffmpeg(&app, &src, &out),
    };

    match res {
        Ok(()) => Ok(out.to_string_lossy().to_string()),
        Err(e) => {
            let _ = fs::remove_file(&out);
            Err(e)
        }
    }
}

/// Decoded-WAV file name keyed by source identity so we decode each track once.
fn cache_name(src: &Path) -> String {
    let meta = src.metadata().ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h: u64 = 1469598103934665603; // FNV-1a
    for b in src.to_string_lossy().as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    for b in size.to_le_bytes().iter().chain(mtime.to_le_bytes().iter()) {
        h ^= *b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("xmb_decode_{:016x}.wav", h)
}

/// Whether decoded songs should be kept in the system's own directory. True when
/// either the song-specific "Keep Preloaded Songs Data" or the general "Save
/// Cache in System Directory" setting is on.
fn keep_preloaded(app: &tauri::AppHandle) -> bool {
    let sf = crate::paths::settings_file(app);
    crate::settings::load(&sf)
        .map(|s| s.behavior.keep_preloaded_songs || s.behavior.cache_in_app_dir)
        .unwrap_or(false)
}

/// Delete temporary working files the system created while running. Removes the
/// decoded WAVs left in the OS temp dir (`xmb_decode_*.wav`). The persistent
/// preloaded-songs folder inside the system directory is intentionally left
/// untouched, so songs kept via "Keep Preloaded Songs Data" / "Save Cache in
/// System Directory" are safe.
pub fn cleanup_temp_files(app: &tauri::AppHandle) {
    let mut files = Vec::new();
    temp_decodes(app, &mut files);
    files.push(crate::paths::icon_shades_temp_file(app));
    dir_files(&crate::paths::temp_dir(app).join("video"), &mut files);
    dir_files(&crate::paths::thumbs_dirs(app).temp, &mut files);
    for f in files { let _ = fs::remove_file(f); }
}

/// Remove the decoded WAVs in the app's temp folder (and any left in the OS
/// temp dir by older versions).
fn temp_decodes(app: &tauri::AppHandle, out: &mut Vec<PathBuf>) {
    for dir in [crate::paths::temp_dir(app), std::env::temp_dir()] {
        for e in fs::read_dir(dir).into_iter().flatten().flatten() {
            if let Some(name) = e.file_name().to_str() {
                if name.starts_with("xmb_decode_") && name.ends_with(".wav") { out.push(e.path()); }
            }
        }
    }
}

fn dir_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        if e.file_type().map(|t| t.is_file()).unwrap_or(false) { out.push(e.path()); }
    }
}

/// Clear a cache category on demand. Categories:
///   "decoded" — decoded song data (temp dir + the persistent app-dir copies)
///   "covers"  — extracted song cover images
///   "icons"   — the icon shading
///   "videos"  — converted videos
///   "all"     — every category above
/// The files are listed first, then deleted one by one, reporting progress.
pub fn clear_cache(app: &tauri::AppHandle, category: &str, progress: &dyn Fn(usize, usize)) -> Result<(), String> {
    let mut files: Vec<PathBuf> = Vec::new();
    let all = category == "all";
    if !matches!(category, "decoded" | "covers" | "icons" | "videos" | "thumbs" | "all") { return Err(format!("unknown cache category: {category}")); }
    if all || category == "decoded" { temp_decodes(app, &mut files); dir_files(&crate::paths::preloaded_songs_dir(app), &mut files); }
    if all || category == "covers" { dir_files(&crate::paths::covers_dir(app), &mut files); }
    if all || category == "videos" { dir_files(&crate::paths::temp_dir(app).join("video"), &mut files); dir_files(&crate::paths::video_cache_app_dir(app), &mut files); }
    if all || category == "icons" { files.push(crate::paths::icon_shades_temp_file(app)); files.push(crate::paths::icon_shades_app_file(app)); }
    if all || category == "thumbs" { let d = crate::paths::thumbs_dirs(app); dir_files(&d.temp, &mut files); dir_files(&d.app, &mut files); }
    let total = files.len();
    progress(0, total);
    for (i, f) in files.iter().enumerate() {
        let _ = fs::remove_file(f);
        progress(i + 1, total);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// WAV writer (16-bit PCM)
// ---------------------------------------------------------------------------

fn write_wav(out: &Path, channels: u16, rate: u32, samples: &[i16]) -> Result<(), String> {
    let mut f = fs::File::create(out).map_err(|e| format!("create wav: {e}"))?;
    let byte_rate = rate * channels as u32 * 2;
    let block_align = channels * 2;
    let data_bytes = (samples.len() * 2) as u32;
    let riff_size = 36 + data_bytes;
    let mut hdr: Vec<u8> = Vec::with_capacity(44);
    hdr.extend_from_slice(b"RIFF");
    hdr.extend_from_slice(&riff_size.to_le_bytes());
    hdr.extend_from_slice(b"WAVE");
    hdr.extend_from_slice(b"fmt ");
    hdr.extend_from_slice(&16u32.to_le_bytes());
    hdr.extend_from_slice(&1u16.to_le_bytes()); // PCM
    hdr.extend_from_slice(&channels.to_le_bytes());
    hdr.extend_from_slice(&rate.to_le_bytes());
    hdr.extend_from_slice(&byte_rate.to_le_bytes());
    hdr.extend_from_slice(&block_align.to_le_bytes());
    hdr.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    hdr.extend_from_slice(b"data");
    hdr.extend_from_slice(&data_bytes.to_le_bytes());
    f.write_all(&hdr).map_err(|e| format!("write wav: {e}"))?;
    // interleaved i16 LE
    let mut buf: Vec<u8> = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        buf.extend_from_slice(&s.to_le_bytes());
    }
    f.write_all(&buf).map_err(|e| format!("write wav: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// DSD (.dsf) native decoder
// ---------------------------------------------------------------------------

fn le_u32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn le_u64(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes([
        b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7],
    ])
}

fn decode_dsf(src: &Path, out: &Path) -> Result<(), String> {
    let mut buf = Vec::new();
    fs::File::open(src)
        .and_then(|mut f| f.read_to_end(&mut buf))
        .map_err(|e| format!("read dsf: {e}"))?;
    if buf.len() < 28 || &buf[0..4] != b"DSD " {
        return Err("not a DSF file".into());
    }
    // fmt chunk immediately follows the 28-byte DSD chunk
    let fmt = 28usize;
    if buf.len() < fmt + 52 || &buf[fmt..fmt + 4] != b"fmt " {
        return Err("DSF fmt chunk missing".into());
    }
    // fmt fields (offsets from the "fmt " chunk start):
    //   +12 version, +16 format id, +20 channel type, +24 channel num,
    //   +28 sampling freq, +32 bits/sample, +36 sample count (u64),
    //   +44 block size per channel, +48 reserved.
    let channel_num = le_u32(&buf, fmt + 24) as usize;
    let freq = le_u32(&buf, fmt + 28);
    let bits = le_u32(&buf, fmt + 32);
    let sample_count = le_u64(&buf, fmt + 36); // 1-bit samples per channel
    let block_size = le_u32(&buf, fmt + 44) as usize; // bytes per channel per block
    if bits != 1 {
        return Err("unsupported DSD bit depth".into());
    }
    if channel_num == 0 || channel_num > 8 || block_size == 0 {
        return Err("bad DSF header".into());
    }
    if freq % 44100 != 0 {
        return Err(format!("unsupported DSD rate {freq}"));
    }

    // data chunk
    let data_hdr = fmt + le_u64(&buf, fmt + 4) as usize;
    if buf.len() < data_hdr + 12 || &buf[data_hdr..data_hdr + 4] != b"data" {
        return Err("DSF data chunk missing".into());
    }
    let data = &buf[data_hdr + 12..];

    // De-interleave the block-interleaved DSD bytes into one stream per channel.
    let bytes_per_ch = (sample_count / 8) as usize;
    let mut chans: Vec<Vec<u8>> = vec![Vec::with_capacity(bytes_per_ch); channel_num];
    let group = block_size * channel_num;
    let mut g = 0usize;
    while g < data.len() {
        for c in 0..channel_num {
            let start = g + c * block_size;
            if start >= data.len() {
                break;
            }
            let end = (start + block_size).min(data.len());
            chans[c].extend_from_slice(&data[start..end]);
        }
        g += group;
    }
    for c in chans.iter_mut() {
        c.truncate(bytes_per_ch.max(0));
    }

    let factor = (freq / 44100) as usize; // 64 for DSD64, 128 for DSD128
    let advance_bytes = factor / 8; // input bytes consumed per output sample
    let fir_bytes = (advance_bytes * 4).max(advance_bytes + 1); // ~4x overlap
    let taps = fir_bytes * 8;

    // Windowed-sinc low-pass, DC gain normalised to 1, ~20 kHz cutoff.
    let fc = 20000.0f64 / freq as f64;
    let mut h = vec![0.0f64; taps];
    let mid = (taps as f64 - 1.0) / 2.0;
    let mut sum = 0.0;
    for i in 0..taps {
        let m = i as f64 - mid;
        let sinc = if m.abs() < 1e-9 {
            2.0 * fc
        } else {
            (2.0 * std::f64::consts::PI * fc * m).sin() / (std::f64::consts::PI * m)
        };
        let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (taps as f64 - 1.0)).cos();
        h[i] = sinc * w;
        sum += h[i];
    }
    for v in h.iter_mut() {
        *v /= sum;
    }

    // Per-byte lookup table: table[byte_pos][byte_value] = sum of that byte's 8
    // bits (LSB first — DSF is little-endian bit order) weighted by the FIR.
    // DSD bit 1 → +1, 0 → −1.
    let mut table = vec![[0.0f64; 256]; fir_bytes];
    for bp in 0..fir_bytes {
        for val in 0..256usize {
            let mut acc = 0.0;
            for bit in 0..8 {
                let tap = bp * 8 + bit;
                let s = if (val >> bit) & 1 == 1 { 1.0 } else { -1.0 };
                acc += h[tap] * s;
            }
            table[bp][val] = acc;
        }
    }

    let out_frames = (bytes_per_ch.saturating_sub(fir_bytes)) / advance_bytes;
    let mut samples: Vec<i16> = vec![0i16; out_frames * channel_num];
    let scale = 32767.0 * 0.92; // small headroom for filter ripple
    for c in 0..channel_num {
        let ch = &chans[c];
        for n in 0..out_frames {
            let base = n * advance_bytes;
            let mut acc = 0.0f64;
            for bp in 0..fir_bytes {
                acc += table[bp][ch[base + bp] as usize];
            }
            let v = (acc * scale).round();
            let v = v.max(-32768.0).min(32767.0) as i16;
            samples[n * channel_num + c] = v;
        }
    }

    write_wav(out, channel_num as u16, 44100, &samples)
}

// ---------------------------------------------------------------------------
// ffmpeg fallback (WMA, ATRAC, .dff, anything else)
// ---------------------------------------------------------------------------

fn decode_with_ffmpeg(app: &tauri::AppHandle, src: &Path, out: &Path) -> Result<(), String> {
    let ff = find_ffmpeg(app).ok_or_else(|| {
        "no decoder available for this format — drop an ffmpeg binary into \
         resources/ffmpeg/ (or install ffmpeg on PATH) to enable WMA/ATRAC playback"
            .to_string()
    })?;
    let status = crate::media::no_window(&mut Command::new(&ff))
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
        ])
        .arg(src)
        .args(["-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", "-f", "wav"])
        .arg(out)
        .status()
        .map_err(|e| format!("failed to run ffmpeg: {e}"))?;
    if !status.success() || !out.is_file() {
        return Err("ffmpeg could not decode this file".into());
    }
    Ok(())
}

/// Public accessor: the path to a usable ffmpeg (bundled or on PATH), if any.
/// Used by the media scanner to read tags from formats `lofty` can't parse
/// (WMA / ATRAC / DSD …) so those still organize in the library.
pub fn ffmpeg_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    find_ffmpeg(app)
}

/// Look for ffmpeg bundled with the app first, then on PATH.
fn find_ffmpeg(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(res) = app.path().resource_dir() {
        for cand in [
            res.join("resources").join("ffmpeg").join(exe),
            res.join("ffmpeg").join(exe),
            res.join(exe),
        ] {
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    // next to the running executable
    if let Ok(cur) = std::env::current_exe() {
        if let Some(dir) = cur.parent() {
            for cand in [
                dir.join("resources").join("ffmpeg").join(exe),
                dir.join("ffmpeg").join(exe),
                dir.join(exe),
            ] {
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
    }
    // finally the system PATH — Command will resolve a bare name (asked once:
    // this is looked up for every file read)
    static ON_PATH: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if *ON_PATH.get_or_init(|| crate::media::no_window(&mut Command::new(exe)).arg("-version").output().is_ok()) {
        return Some(PathBuf::from(exe));
    }
    None
}

/// Music Player "Delete": only songs inside the app's own Music folder.
#[tauri::command(async)]
pub fn music_deletable(app: tauri::AppHandle, path: String) -> bool {
    match (PathBuf::from(&path).canonicalize(), crate::paths::music_dir(&app).canonicalize()) {
        (Ok(p), Ok(r)) => p.starts_with(r) && p.is_file(),
        _ => false,
    }
}

/// Deletes the song file (inside the app's Music folder only) and its decoded copy.
#[tauri::command(async)]
pub fn music_delete(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    let p = src.canonicalize().map_err(|e| e.to_string())?;
    let root = crate::paths::music_dir(&app).canonicalize().map_err(|e| e.to_string())?;
    if !p.starts_with(&root) || !p.is_file() {
        return Err("only songs saved in the app's own Music folder can be deleted".into());
    }
    let fname = cache_name(&src);               // before the file goes (size + date are part of it)
    fs::remove_file(&p).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(crate::paths::temp_dir(&app).join(&fname));
    let _ = fs::remove_file(crate::paths::preloaded_songs_dir(&app).join(&fname));
    Ok(())
}
