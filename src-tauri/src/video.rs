//! Video player support.
//!
//! * `video_info`: codecs, channels, sample rate, bitrates and embedded
//!   subtitle streams (read from ffmpeg's own report when ffmpeg is present;
//!   otherwise just a best guess from the file extension).
//! * `video_prepare`: a version the webview can play. Containers / codecs it
//!   can't handle (AVI, WMV, FLV, MPEG-PS/TS, MKV with AC-3 / DTS audio, …) are
//!   remuxed (or, if needed, converted) by ffmpeg into an MP4 in the temporary
//!   folder (or the system directory with "Save Cache in System Directory").
//! * `video_subtitle`: an embedded subtitle stream as a WebVTT file.
//! * `video_set_icon`: the frame shown on screen becomes the video's icon.
//! * `video_delete`: delete the playing video (only inside the app's own
//!   Videos folder).

use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubStream { pub index: usize, pub lang: String, pub title: String, pub codec: String }

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub vcodec: String,
    pub vkbps: Option<u32>,
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub acodec: String,
    pub channels: u32,
    pub sample_rate: u32,
    pub akbps: Option<u32>,
    pub duration: f64,
    pub subs: Vec<SubStream>,
    pub audio_tracks: u32,
    pub probed: bool,
    /// badge keys (assets/icons/vp/fmt/<key>.png), "" = none
    pub vkey: String,
    pub akey: String,
    /// an H.264 picture the webview can't show: 10-bit, 4:2:2 or 4:4:4 (High 10 / High 4:2:2 /
    /// High 4:4:4; common in MKVs): converted, not only repacked
    pub hard_pic: bool,
}

fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn hash_of(p: &Path) -> u64 {
    let mut h = DefaultHasher::new();
    p.hash(&mut h);
    if let Ok(m) = std::fs::metadata(p) {
        m.len().hash(&mut h);
        m.modified().ok().hash(&mut h);
    }
    h.finish()
}

/// Codec name as ffmpeg reports it -> the key of the matching badge.
pub fn codec_key(c: &str) -> &'static str {
    let c = c.to_lowercase();
    let c = c.as_str();
    match c {
        _ if c.starts_with("h264") || c == "avc" || c.starts_with("avc1") => "avc",
        _ if c.starts_with("hevc") || c.starts_with("h265") => "hevc",
        "mpeg1video" => "mpeg1",
        "mpeg2video" => "mpeg2",
        "mpeg4" | "msmpeg4v3" | "msmpeg4v2" | "msmpeg4" => "mpeg4",
        "vc1" | "wmv3" => "vc1",
        "wmv1" | "wmv2" => "wmv",
        "vp8" => "vp8",
        "vp9" => "vp9",
        "av1" => "av1",
        "theora" => "theora",
        "mjpeg" => "mjpeg",
        "h263" | "flv1" => "h263",
        "prores" => "prores",
        _ if c.starts_with("aac") => "aac",
        "mp3" | "mp3float" => "mp3",
        "mp2" | "mp1" => "mp2",
        "ac3" => "ac3",
        "eac3" => "eac3",
        "dts" | "dca" => "dts",
        "truehd" | "mlp" => "truehd",
        "flac" => "flac",
        "alac" => "alac",
        "opus" => "opus",
        "vorbis" => "vorbis",
        _ if c.starts_with("wma") => "wma",
        _ if c.starts_with("pcm") => "pcm",
        _ if c.starts_with("atrac") => "atrac",
        _ => "",
    }
}

fn num_before(s: &str, unit: &str) -> Option<f64> {
    let i = s.find(unit)?;
    let head = s[..i].trim_end();
    let start = head.rfind(|c: char| !(c.is_ascii_digit() || c == '.')).map(|j| j + 1).unwrap_or(0);
    head[start..].parse().ok()
}

/// Parse ffmpeg's "-i" report (stderr).
pub fn parse_report(text: &str) -> VideoInfo {
    let mut v = VideoInfo { probed: true, ..Default::default() };
    let mut sub_n = 0;
    for line in text.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("Duration:") {
            let d = rest.split(',').next().unwrap_or("").trim();
            let p: Vec<f64> = d.split(':').filter_map(|x| x.parse().ok()).collect();
            if p.len() == 3 { v.duration = p[0] * 3600.0 + p[1] * 60.0 + p[2]; }
        }
        if !l.starts_with("Stream #") { continue; }
        let lang = l.split('(').nth(1).and_then(|x| x.split(')').next()).filter(|x| x.len() == 3).unwrap_or("").to_string();
        if let Some(i) = l.find("Video: ") {
            if !v.vcodec.is_empty() { continue; }
            let d = &l[i + 7..];
            v.vcodec = d.split(|c| c == ' ' || c == ',').next().unwrap_or("").to_string();
            v.hard_pic = v.vcodec == "h264" && (d.contains("(High 10") || d.contains("(High 4:2:2") || d.contains("(High 4:4:4")
                || d.contains("p10") || d.contains("p12") || d.contains("yuv422") || d.contains("yuv444"));
            v.vkbps = num_before(d, " kb/s").map(|x| x as u32);
            v.fps = num_before(d, " fps").unwrap_or(0.0) as f32;
            for part in d.split(',') {
                let p = part.trim().split(' ').next().unwrap_or("");
                if let Some((w, h)) = p.split_once('x') {
                    if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) { if w > 0 && h > 0 && v.width == 0 { v.width = w; v.height = h; } }
                }
            }
        } else if let Some(i) = l.find("Audio: ") {
            v.audio_tracks += 1;
            if v.audio_tracks > 1 { continue; }
            let d = &l[i + 7..];
            v.acodec = d.split(|c| c == ' ' || c == ',').next().unwrap_or("").to_string();
            v.sample_rate = num_before(d, " Hz").unwrap_or(0.0) as u32;
            v.akbps = num_before(d, " kb/s").map(|x| x as u32);
            v.channels = if d.contains("mono") { 1 } else if d.contains("stereo") { 2 } else if d.contains("5.1") { 6 }
                else if d.contains("7.1") { 8 } else if d.contains("quad") { 4 } else { num_before(d, " channels").unwrap_or(2.0) as u32 };
        } else if let Some(i) = l.find("Subtitle: ") {
            let codec = l[i + 10..].split(|c| c == ' ' || c == ',').next().unwrap_or("").to_string();
            v.subs.push(SubStream { index: sub_n, lang: lang.clone(), title: String::new(), codec });
            sub_n += 1;
        }
    }
    v
}

#[tauri::command(async)]
pub fn video_info(app: AppHandle, path: String) -> VideoInfo {
    let mut v = probe(&app, &path);
    v.vkey = codec_key(&v.vcodec).into();
    v.akey = codec_key(&v.acodec).into();
    v
}

fn probe(app: &AppHandle, path: &str) -> VideoInfo {
    let p = PathBuf::from(path);
    // MP4 / MOV / MKV / WebM: read straight from the file (no ffmpeg needed)
    if let Some(v) = crate::vprobe::probe(&p) { return v; }
    if let Some(ff) = crate::audio::ffmpeg_path(app) {
        if let Ok(o) = no_window(Command::new(ff).args(["-hide_banner", "-i"]).arg(&p)).output() {
            let info = parse_report(&String::from_utf8_lossy(&o.stderr));
            if !info.vcodec.is_empty() || !info.acodec.is_empty() { return info; }
        }
    }
    // no ffmpeg: a guess from the extension
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let (vc, ac) = match ext.as_str() {
        "mp4" | "m4v" | "mov" | "3gp" => ("h264", "aac"),
        "webm" => ("vp9", "opus"),
        "wmv" | "asf" => ("wmv3", "wmav2"),
        "mpg" | "mpeg" | "vob" | "m2ts" | "mts" | "ts" => ("mpeg2video", "ac3"),
        "ogv" => ("theora", "vorbis"),
        "flv" => ("h264", "aac"),
        "avi" | "divx" | "xvid" => ("mpeg4", "mp3"),
        "rm" | "rmvb" => ("rv40", "cook"),
        _ => ("", ""),
    };
    VideoInfo { vcodec: vc.into(), acodec: ac.into(), channels: 2, ..Default::default() }
}

fn cache_dir(app: &AppHandle) -> PathBuf {
    let s = crate::settings::load(&crate::paths::settings_file(app));
    let d = if s.map(|s| s.behavior.cache_in_app_dir || s.behavior.keep_preloaded_videos).unwrap_or(false) {
        crate::paths::video_cache_app_dir(app)
    } else {
        crate::paths::temp_dir(app).join("video")
    };
    let _ = std::fs::create_dir_all(&d);
    d
}

/// How a video gets played: straight from the file, or from a copy made by
/// ffmpeg (a remux when the picture is already in a format the webview plays,
/// a full conversion otherwise). `cached` is that copy when it already exists
/// (preloaded or played before).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoPlan { pub mode: String, pub cached: Option<String> }

fn plan_mode(path: &Path, v: &VideoInfo) -> &'static str {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let vc = codec_key(&v.vcodec);
    let ac = codec_key(&v.acodec);
    let web_v = matches!(vc, "avc" | "vp8" | "vp9" | "av1") && !v.hard_pic;
    let web_a = v.acodec.is_empty() || matches!(ac, "aac" | "mp3" | "opus" | "vorbis" | "flac");
    if matches!(ext.as_str(), "mp4" | "m4v" | "mov" | "webm") && web_v && web_a { "direct" }
    else if web_v { "remux" }
    else { "convert" }
}

fn cached_copy(app: &AppHandle, src: &Path) -> Option<String> {
    let h = hash_of(src);
    let mut dirs = vec![crate::paths::video_cache_app_dir(app), crate::paths::temp_dir(app).join("video")];
    dirs.dedup();
    for d in dirs {
        for k in ["r", "c"] {
            let f = d.join(format!("v_{:016x}_{}.mp4", h, k));
            if f.is_file() { return Some(f.display().to_string()); }
        }
    }
    None
}

#[tauri::command(async)]
pub fn video_plan(app: AppHandle, path: String) -> VideoPlan {
    let src = PathBuf::from(&path);
    let v = probe(&app, &path);
    VideoPlan { mode: plan_mode(&src, &v).into(), cached: cached_copy(&app, &src) }
}

/// Preload: make the playable copy now for a video that needs one. Returns
/// false when the video plays straight from the file (nothing to do).
#[tauri::command(async)]
pub fn video_preload(app: AppHandle, path: String) -> Result<bool, String> {
    let src = PathBuf::from(&path);
    if cached_copy(&app, &src).is_some() { return Ok(true); }
    let v = probe(&app, &path);
    match plan_mode(&src, &v) {
        "direct" => Ok(false),
        m => video_prepare(app, path, m == "convert").map(|_| true),
    }
}

/// A playable MP4 of `src` made at `out` by this FFmpeg (full: the picture
/// converted too; otherwise only repacked, its sound converted).
pub(crate) fn make_copy(ff: &Path, src: &Path, out: &Path, full: bool) -> Result<(), String> {
    let part = out.with_extension("part.mp4");
    let mut cmd = Command::new(ff);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-i"]).arg(src)
        // (0:V: the video itself, never a cover picture kept with it)
        .args(["-map", "0:V:0?", "-map", "0:a:0?", "-sn", "-dn", "-max_muxing_queue_size", "4096"]);
    if full {
        // H.264 needs even picture sizes: odd ones (common with videos that
        // aren't 16:9) are rounded down by a pixel
        cmd.args(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-profile:v", "high"]);
    } else {
        cmd.args(["-c:v", "copy"]);
    }
    // (its sound in one of AAC's standard channel layouts: mono, stereo or 5.1. Others -- an
    // MKV's 5.1 "side", 7.1 -- were written with a layout of their own, which Windows' AAC
    // decoder, the one the webview uses, refuses: the copy didn't play)
    cmd.args(["-af", "aformat=channel_layouts=mono|stereo|5.1", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]).arg(&part);
    let started = std::time::Instant::now();
    let o = no_window(&mut cmd).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped()).output().map_err(|e| format!("ffmpeg: {e}"))?;
    if !o.status.success() || !part.is_file() {
        let _ = std::fs::remove_file(&part);
        // (what ffmpeg said, in MaXMB.log: why a video couldn't be made playable)
        let err = String::from_utf8_lossy(&o.stderr); let err: String = err.trim().lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" | ");
        crate::log::line("WARN", "video", &format!("{} {} failed: {}", if full { "converting" } else { "repacking" }, src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), err.chars().take(400).collect::<String>()));
        return Err("ffmpeg could not convert this video".into());
    }
    crate::log::line("INFO", "video", &format!("{} {} took {} s", if full { "converted" } else { "repacked" }, src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), started.elapsed().as_secs()));
    std::fs::rename(&part, out).map_err(|e| e.to_string())?;
    Ok(())
}
/// A playable MP4 of `path`. `full` = convert the picture too (when even a
/// remux wasn't playable).
#[tauri::command(async)]
pub fn video_prepare(app: AppHandle, path: String, full: bool) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() { return Err("file not found".into()); }
    let ff = crate::audio::ffmpeg_path(&app).ok_or("ffmpeg is needed to play this video (put ffmpeg in resources/ffmpeg)")?;
    let out = cache_dir(&app).join(format!("v_{:016x}_{}.mp4", hash_of(&src), if full { "c" } else { "r" }));
    if out.is_file() { return Ok(out.display().to_string()); }
    make_copy(&ff, &src, &out, full)?;
    if let (Some(d), Some(n)) = (out.parent(), out.file_name()) { crate::cachesweep::note(d, COPIES_INDEX, &n.to_string_lossy(), &src); }
    Ok(out.display().to_string())
}
/// The playable copies of `path` deleted (both kinds, in both folders): one the player couldn't
/// play, so the video is made playable again instead of failing at once every time. `why`: the
/// player's reason, in MaXMB.log. Returns whether any were there.
#[tauri::command(async)]
pub fn video_drop_copy(app: AppHandle, path: String, why: String) -> bool {
    let src = PathBuf::from(&path);
    let h = hash_of(&src);
    let mut dirs = vec![crate::paths::video_cache_app_dir(&app), crate::paths::temp_dir(&app).join("video")];
    dirs.dedup();
    let mut gone = false;
    for d in dirs {
        for k in ["r", "c"] {
            let f = d.join(format!("v_{:016x}_{}.mp4", h, k));
            if f.is_file() && std::fs::remove_file(&f).is_ok() { gone = true; }
        }
    }
    if gone {
        crate::log::line("WARN", "video", &format!("the playable copy of {} wouldn't play ({}): deleted",
            src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), why.chars().take(300).collect::<String>()));
    }
    gone
}
/// The converted copies noted (cachesweep.rs), in each of their two folders.
const COPIES_INDEX: &str = "videos.tsv";
/// The converted copies of videos changed or gone since: deleted (at start).
pub fn sweep_copies(app: &AppHandle) -> usize {
    let f = |p: &Path| { let h = hash_of(p); vec![format!("v_{h:016x}_r.mp4"), format!("v_{h:016x}_c.mp4")] };
    crate::cachesweep::sweep(&crate::paths::temp_dir(app).join("video"), COPIES_INDEX, &f) + crate::cachesweep::sweep(&crate::paths::video_cache_app_dir(app), COPIES_INDEX, &f)
}

/// Embedded subtitle stream `index` as WebVTT text.
#[tauri::command(async)]
pub fn video_subtitle(app: AppHandle, path: String, index: usize) -> Result<String, String> {
    let ff = crate::audio::ffmpeg_path(&app).ok_or("ffmpeg is needed for embedded subtitles")?;
    let o = no_window(Command::new(ff).args(["-hide_banner", "-loglevel", "error", "-i"]).arg(&path)
        .args(["-map", &format!("0:s:{index}"), "-f", "webvtt", "-"]))
        .output().map_err(|e| e.to_string())?;
    let t = String::from_utf8_lossy(&o.stdout).to_string();
    if t.trim().is_empty() { return Err("this subtitle stream can't be shown (picture-based subtitles aren't supported)".into()); }
    Ok(t)
}

/// Save the current frame (a JPEG/PNG data URL from the player) as the video's
/// icon, or take it with ffmpeg at `time` when the frame couldn't be captured.
#[tauri::command(async)]
pub fn video_set_icon(app: AppHandle, path: String, time: f64, data_url: Option<String>) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let key = path_key(&src);
    let dir = crate::paths::video_icons_dir(&app);
    // (a new name each time: the old picture and clip aren't shown again from
    // the webview's cache; the old ones are deleted once the new one is made)
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let old = icon_files_of(&dir, key);
    let out = dir.join(format!("{key:016x}_{stamp}.jpg"));
    let clip = dir.join(format!("{key:016x}_{stamp}.mp4"));
    let ff = crate::audio::ffmpeg_path(&app);
    // the still (shown until the clip is ready, and when there's no ffmpeg)
    let mut still = false;
    if let Some(d) = data_url.filter(|d| d.starts_with("data:image/")) {
        let b64 = d.split(',').nth(1).ok_or("bad image")?;
        std::fs::write(&out, b64_decode(b64).ok_or("bad image")?).map_err(|e| e.to_string())?;
        still = true;
    } else if let Some(ff) = &ff {
        let st = no_window(Command::new(ff).args(["-y", "-hide_banner", "-loglevel", "error", "-ss", &format!("{time:.3}"), "-i"]).arg(&src)
            .args(["-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "3"]).arg(&out)).status().map_err(|e| e.to_string())?;
        still = st.success() && out.is_file();
    }
    // the icon itself: 15 seconds of video from this scene, silent, small
    if let Some(ff) = &ff {
        let part = dir.join(format!("{key:016x}_{stamp}.part.mp4"));
        let st = no_window(Command::new(ff).args(["-y", "-hide_banner", "-loglevel", "error", "-ss", &format!("{time:.3}"), "-i"]).arg(&src)
            .args(["-t", "15", "-an", "-sn", "-dn", "-vf", "scale=-2:360", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart"]).arg(&part)).status();
        if matches!(st, Ok(s) if s.success()) && part.is_file() { let _ = std::fs::rename(&part, &clip); }
        else { let _ = std::fs::remove_file(&part); }
    }
    if clip.is_file() || still {
        // the icon set before: deleted (its picture and its clip)
        for f in old { let _ = std::fs::remove_file(f); }
        Ok(out.display().to_string())
    } else {
        let _ = std::fs::remove_file(&out);
        Err("the icon couldn't be made".into())
    }
}

/// A video's icon files ("<key>.jpg/.mp4" from before, "<key>_<when>.jpg/.mp4").
fn icon_files_of(dir: &Path, key: u64) -> Vec<PathBuf> {
    let base = format!("{key:016x}");
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten().map(|e| e.path()).filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| {
        n.starts_with(&base) && (n.len() == base.len() + 4 || n[base.len()..].starts_with('_'))
    }).unwrap_or(false)).collect()
}
/// The newest icon file of a video with this extension. (The folder read once
/// for all videos, again only when it changed; older ones left behind, e.g.
/// still open when the new one was set, are deleted then.)
fn newest_icon(app: &AppHandle, video: &Path, ext: &str) -> Option<String> {
    use std::collections::HashMap;
    use std::sync::Mutex;
    type Index = (Option<std::time::SystemTime>, HashMap<String, (String, u128)>);
    static IDX: Mutex<Option<Index>> = Mutex::new(None);
    let dir = crate::paths::video_icons_dir(app);
    let stamp = std::fs::metadata(&dir).and_then(|m| m.modified()).ok();
    let mut g = IDX.lock().unwrap_or_else(|e| e.into_inner());
    if g.as_ref().map(|(t, _)| *t != stamp || stamp.is_none()).unwrap_or(true) {
        let mut m: HashMap<String, (String, u128)> = HashMap::new();
        let mut older = Vec::new();
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = e.path();
            let Some(n) = p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()) else { continue };
            if n.contains(".part.") || n.len() < 20 { continue; }
            let Some((stem, x)) = n.rsplit_once('.') else { continue };
            let (k, when) = match stem.split_once('_') { Some((k, w)) => (k, w.parse::<u128>().unwrap_or(0)), None => (stem, 0) };
            let id = format!("{k}.{}", x.to_lowercase());
            match m.get(&id) {
                Some((_, w)) if *w >= when => older.push(p.clone()),
                Some((f, _)) => { older.push(PathBuf::from(f)); m.insert(id, (p.display().to_string(), when)); }
                None => { m.insert(id, (p.display().to_string(), when)); }
            }
        }
        for f in older { let _ = std::fs::remove_file(f); }
        *g = Some((std::fs::metadata(&dir).and_then(|m| m.modified()).ok(), m));
    }
    let id = format!("{:016x}.{ext}", path_key(video));
    g.as_ref().and_then(|(_, m)| m.get(&id)).map(|(f, _)| f.clone()).filter(|f| Path::new(f).is_file())
}
/// Icon file chosen for a video, if any (keyed by the video's path).
pub fn icon_for(app: &AppHandle, video: &Path) -> Option<String> { newest_icon(app, video, "jpg") }
/// The 15-second icon clip made by "Change Icon", if any.
pub fn clip_for(app: &AppHandle, video: &Path) -> Option<String> { newest_icon(app, video, "mp4") }

/// The icon files of a video (after "Change Icon").
#[tauri::command]
pub fn video_icon_files(app: AppHandle, path: String) -> (Option<String>, Option<String>) {
    let p = PathBuf::from(&path);
    (icon_for(&app, &p), clip_for(&app, &p))
}

fn path_key(p: &Path) -> u64 {
    let mut h = DefaultHasher::new();
    p.to_string_lossy().to_lowercase().hash(&mut h);
    h.finish()
}

/// Delete the playing video, only when it's inside the app's own Videos folder.
#[tauri::command]
pub fn video_delete(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    let root = crate::paths::videos_dir(&app).canonicalize().map_err(|e| e.to_string())?;
    if !p.starts_with(&root) || !p.is_file() {
        return Err("only videos saved in the app's own Videos folder can be deleted".into());
    }
    std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    for f in icon_files_of(&crate::paths::video_icons_dir(&app), path_key(Path::new(&path))) { let _ = std::fs::remove_file(f); }
    Ok(())
}

/// Whether a video can be deleted from the player (it's in the app's Videos folder).
#[tauri::command]
pub fn video_deletable(app: AppHandle, path: String) -> bool {
    match (PathBuf::from(&path).canonicalize(), crate::paths::videos_dir(&app).canonicalize()) {
        (Ok(p), Ok(r)) => p.starts_with(r),
        _ => false,
    }
}

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' => continue,
            _ => return None,
        } as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 { bits -= 8; out.push((buf >> bits) as u8); buf &= (1 << bits) - 1; }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plans_playback() {
        let v = |vc: &str, ac: &str| VideoInfo { vcodec: vc.into(), acodec: ac.into(), ..Default::default() };
        assert_eq!(plan_mode(Path::new("a.mp4"), &v("h264", "aac")), "direct");
        assert_eq!(plan_mode(Path::new("a.webm"), &v("vp9", "opus")), "direct");
        assert_eq!(plan_mode(Path::new("a.mkv"), &v("h264", "aac")), "remux");
        assert_eq!(plan_mode(Path::new("a.mp4"), &v("h264", "ac3")), "remux");
        assert_eq!(plan_mode(Path::new("a.mp4"), &v("hevc", "aac")), "convert");
        assert_eq!(plan_mode(Path::new("a.avi"), &v("mpeg4", "mp3")), "convert");
    }

    /// Real videos the page can't play, made playable by FFmpeg: repacked
    /// when only the container or the sound is the problem, converted when the
    /// picture is; and what's left when it can't be done.
    #[test]
    fn videos_are_made_playable() {
        let ok = Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false);
        if !ok { eprintln!("(no ffmpeg on this machine: skipped)"); return; }
        let ff = PathBuf::from("ffmpeg");
        let d = std::env::temp_dir().join(format!("xmb_vconv_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap();
        let make = |args: &[&str], out: &str| assert!(Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=321x241:duration=2:rate=25", "-f", "lavfi", "-i", "sine=duration=2", "-shortest"])
            .args(args).arg(d.join(out)).status().unwrap().success(), "made {out}");
        make(&["-c:v", "mpeg4", "-c:a", "libmp3lame"], "old.avi");                                   // picture and container not playable
        make(&["-vf", "scale=320:240", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "ac3"], "movie.mkv");   // only the container and sound
        make(&["-vf", "scale=320:240", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"], "fine.mp4");    // plays as it is
        let info = |p: &Path| crate::vprobe::probe(p).unwrap_or_else(|| ffprobe_info(&ff, p));
        assert_eq!(plan_mode(&d.join("fine.mp4"), &info(&d.join("fine.mp4"))), "direct");
        assert_eq!(plan_mode(&d.join("movie.mkv"), &info(&d.join("movie.mkv"))), "remux");
        assert_eq!(plan_mode(&d.join("old.avi"), &info(&d.join("old.avi"))), "convert");
        // repacked: the same picture (not converted), sound the page plays, a file that plays as it is
        let r = d.join("v_r.mp4");
        make_copy(&ff, &d.join("movie.mkv"), &r, false).expect("repacked");
        let vi = crate::vprobe::probe(&r).expect("the copy is read");
        assert_eq!(plan_mode(&r, &vi), "direct", "the repacked copy plays ({} / {})", vi.vcodec, vi.acodec);
        assert_eq!((vi.width, vi.height), (320, 240));
        // converted: an odd picture size (321 x 241) made even, H.264 + AAC
        let c = d.join("v_c.mp4");
        make_copy(&ff, &d.join("old.avi"), &c, true).expect("converted");
        let vi = crate::vprobe::probe(&c).expect("the copy is read");
        assert_eq!(plan_mode(&c, &vi), "direct", "the converted copy plays ({} / {})", vi.vcodec, vi.acodec);
        assert_eq!((vi.width, vi.height), (320, 240), "odd sizes rounded down to even");
        // H.264 the webview can't show (10-bit, 4:4:4: common in MKVs), in an MKV or an MP4: converted, not repacked;
        // the same picture in 8-bit 4:2:0 still only repacked
        make(&["-vf", "scale=320:240", "-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-c:a", "aac"], "hi10.mkv");
        make(&["-vf", "scale=320:240", "-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-c:a", "aac"], "hi10.mp4");
        make(&["-vf", "scale=320:240", "-c:v", "libx264", "-pix_fmt", "yuv444p", "-c:a", "aac"], "full444.mkv");
        for f in ["hi10.mkv", "hi10.mp4", "full444.mkv"] {
            assert!(info(&d.join(f)).hard_pic, "{f} read as not playable");
            assert_eq!(plan_mode(&d.join(f), &info(&d.join(f))), "convert", "{f}");
            assert!(ffprobe_info(&ff, &d.join(f)).hard_pic, "{f} from ffmpeg's report too");
        }
        assert!(!info(&d.join("movie.mkv")).hard_pic && !ffprobe_info(&ff, &d.join("movie.mkv")).hard_pic);
        let c10 = d.join("v_c10.mp4");
        make_copy(&ff, &d.join("hi10.mkv"), &c10, true).expect("converted");
        assert_eq!(plan_mode(&c10, &crate::vprobe::probe(&c10).unwrap()), "direct", "the 10-bit video's copy plays");
        // a cover picture kept with the video (an MKV's attached cover.jpg, read as a picture stream): the video itself is what's copied
        assert!(Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=red:size=64x64", "-frames:v", "1"]).arg(d.join("cover.jpg")).status().unwrap().success());
        assert!(Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-y", "-i"]).arg(d.join("movie.mkv")).arg("-attach").arg(d.join("cover.jpg"))
            .args(["-metadata:s:t", "mimetype=image/jpeg", "-metadata:s:t", "filename=cover.jpg", "-c", "copy"]).arg(d.join("with_cover.mkv")).status().unwrap().success());
        let cf = d.join("v_cf.mp4");
        make_copy(&ff, &d.join("with_cover.mkv"), &cf, false).expect("repacked");
        let vi = crate::vprobe::probe(&cf).expect("the copy is read");
        assert_eq!((vi.vcodec.as_str(), vi.width, vi.height), ("h264", 320, 240), "the video, not its cover");
        // sound in a layout AAC has no standard one for (an MKV's 5.1 "side", E-AC-3 / Atmos films; 7.1): written as
        // standard 5.1 -- with a layout of its own, Windows' AAC decoder (the webview's) refused it
        let layout = |p: &Path| String::from_utf8_lossy(&Command::new("ffprobe").args(["-v", "error", "-select_streams", "a", "-show_entries", "stream=channel_layout", "-of", "csv=p=0"]).arg(p).output().unwrap().stdout).trim().to_string();
        for (lay, src) in [("5.1(side)", "side.mkv"), ("7.1", "wide.mkv")] {
            make(&["-vf", "scale=320:240", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-af", &format!("aformat=channel_layouts={lay}"), "-c:a", "eac3"], src);
            let o = d.join(format!("v_{src}.mp4"));
            make_copy(&ff, &d.join(src), &o, false).expect("repacked");
            assert_eq!(layout(&o), "5.1", "{lay} sound written as standard 5.1");
        }
        let o = d.join("v_st.mp4");
        make_copy(&ff, &d.join("movie.mkv"), &o, false).expect("repacked");
        assert_eq!(layout(&o), "mono", "a mono sound left mono");
        // a file that isn't a video, a file gone meanwhile, FFmpeg not there: an error, and nothing half-made left
        std::fs::write(d.join("junk.avi"), "this is not a video at all\n".repeat(200)).unwrap();
        for (src, ffp) in [(d.join("junk.avi"), ff.clone()), (d.join("gone.avi"), ff.clone()), (d.join("old.avi"), d.join("no_ffmpeg"))] {
            let o = d.join("bad.mp4");
            assert!(make_copy(&ffp, &src, &o, true).is_err(), "{} with {}", src.display(), ffp.display());
            assert!(!o.exists() && !o.with_extension("part.mp4").exists(), "nothing left behind");
        }
        let _ = std::fs::remove_dir_all(&d);
    }
    fn ffprobe_info(ff: &Path, p: &Path) -> VideoInfo {
        let o = Command::new(ff).args(["-hide_banner", "-i"]).arg(p).output().unwrap();
        parse_report(&String::from_utf8_lossy(&o.stderr))
    }

    #[test]
    fn parses_ffmpeg_report() {
        let r = "  Duration: 00:01:31.50, start: 0.000000, bitrate: 18200 kb/s\n\
          Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 18101 kb/s, 29.97 fps, 29.97 tbr\n\
          Stream #0:1(eng): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 124 kb/s (default)\n\
          Stream #0:2(spa): Subtitle: subrip\n";
        let v = parse_report(r);
        assert_eq!(codec_key(&v.vcodec), "avc");
        assert_eq!(v.vkbps, Some(18101));
        assert_eq!((v.width, v.height), (1920, 1080));
        assert!((v.fps - 29.97).abs() < 0.01);
        assert_eq!(codec_key(&v.acodec), "aac");
        assert_eq!((v.channels, v.sample_rate, v.akbps), (2, 44100, Some(124)));
        assert!((v.duration - 91.5).abs() < 0.01);
        assert_eq!(v.subs.len(), 1);
        assert_eq!(v.subs[0].lang, "spa");
        assert_eq!(b64_decode("aGVsbG8=").unwrap(), b"hello");
    }
}

#[cfg(test)]
mod icon_tests {
    use super::*;
    #[test]
    fn icon_files_found_by_video() {
        let d = std::env::temp_dir().join(format!("maxmb_vi_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap();
        let k = 0x1234u64;
        for n in ["0000000000001234.jpg", "0000000000001234_17000.jpg", "0000000000001234_17000.mp4", "00000000000012345.jpg", "0000000000009999_1.jpg"] { std::fs::write(d.join(n), b"x").unwrap(); }
        let mut f: Vec<String> = icon_files_of(&d, k).iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
        f.sort();
        assert_eq!(f, ["0000000000001234.jpg", "0000000000001234_17000.jpg", "0000000000001234_17000.mp4"]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
