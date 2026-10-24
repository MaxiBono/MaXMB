//! Enumerates Photo / Music / Video folders and reads whatever metadata is
//! cheaply available: audio tags + duration via `lofty`, image dimensions via
//! `imagesize`. Video gets name/size (duration/res would need ffmpeg).

use crate::models::MediaItem;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::UNIX_EPOCH;

pub const PHOTO_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "webp", "avif", "jfif", "pjpeg", "pjp", "apng", "ico", "svg"];
/// documents / comics opened page by page in the Photo Viewer (custom sections)
pub const DOC_EXTS: &[&str] = &["pdf", "cbz", "cbt"];
/// programs and scripts started like games (custom sections), without the
/// game screen
pub const APP_EXTS: &[&str] = &["exe", "lnk", "url", "bat", "cmd", "ps1", "py", "pyw", "vbs", "vbe", "wsf", "js", "jar", "ahk", "msi", "appref-ms", "sh"];
pub const MUSIC_EXTS: &[&str] = &[
    "mp3", "ogg", "opus", "flac", "wav", "m4a", "aac", "wma",
    "dsf", "dff", "at3", "oma", "aa3", "aiff", "aif", "pcm", "cda",
];
pub const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "webm", "mkv", "avi", "mov", "wmv", "asf", "flv", "mpg", "mpeg",
    "m2ts", "mts", "ts", "vob", "3gp", "ogv", "divx",
    // played through a converted copy (ffmpeg)
    "3g2", "f4v", "rm", "rmvb", "mxf", "ogm", "dv", "mod", "tod", "m2v", "m1v", "mpe", "mpv", "m2t", "trp", "tp",
    "evo", "vro", "qt", "amv", "nsv", "xvid", "h264", "264", "hevc", "265", "y4m", "bik", "nut"];
pub const SUBTITLE_EXTS: &[&str] = &["srt", "vtt", "ass"];

pub fn kind_exts(kind: &str) -> &'static [&'static str] {
    match kind {
        "photo" | "background" => PHOTO_EXTS,
        "music" => MUSIC_EXTS,
        "video" => VIDEO_EXTS,
        "subtitle" => SUBTITLE_EXTS,
        _ => &[],
    }
}

/// List media under `paths`. For music, `ffmpeg` (when available) is used to
/// read tags from formats `lofty` can't parse (WMA / ATRAC / DSD …) so every
/// track organizes by title / artist / album even when it can't be played with
/// the webview's own decoders.
pub fn list(paths: &[String], kind: &str, ffmpeg: Option<&Path>) -> Vec<MediaItem> {
    let exts = kind_exts(kind);
    let mut items = Vec::new();
    for base in paths {
        collect(Path::new(base), exts, kind, ffmpeg, &mut items);
    }
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    items
}

fn collect(dir: &Path, exts: &[&str], kind: &str, ffmpeg: Option<&Path>, out: &mut Vec<MediaItem>) {
    collect_depth(dir, exts, kind, ffmpeg, out, 0);
}

// Walk `dir` recursively (subfolders included), so media dropped inside any
// nested folder of a content folder is still recognised. Depth-capped to avoid
// pathological/symlink loops.
fn collect_depth(dir: &Path, exts: &[&str], kind: &str, ffmpeg: Option<&Path>, out: &mut Vec<MediaItem>, depth: u32) {
    if depth > 12 {
        return;
    }
    let Ok(read) = fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_depth(&p, exts, kind, ffmpeg, out, depth + 1);
            continue;
        }
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !exts.contains(&ext.as_str()) {
            continue;
        }
        let Some(item) = media_item(&p, kind, ffmpeg, depth == 0) else { continue };
        out.push(item);
    }
}

/// Read tags + duration for a music file.
///
/// `lofty` handles the webview-playable formats (mp3/flac/m4a/aac/ogg/opus/wav
/// and more). For the formats the app can't play on its own — WMA, ATRAC
/// (.at3/.oma/.aa3), DSD (.dsf/.dff) — `lofty` can't parse the container, so we
/// fall back to: (1) a tiny built-in ID3v2 reader (DSF files carry an ID3v2 tag,
/// and the app decodes DSD natively with no ffmpeg, so this keeps DSD organized
/// even without ffmpeg installed); (2) ffmpeg's own metadata output, which
/// covers every remaining format the app relies on ffmpeg to play anyway.
fn read_audio_meta(path: &Path, ffmpeg: Option<&Path>, item: &mut MediaItem) {
    use lofty::file::AudioFile;
    use lofty::tag::Accessor;
    if let Some(tagged) = read_tagged(path) {
        let props = tagged.properties();
        item.duration_secs = Some(props.duration().as_secs());
        // every tag the file has, its main one first: each field comes from the
        // first tag that has it. (MP3s often carry a small ID3v2 tag with only
        // the encoder's name, or only the cover, while the title, artist and
        // album are in an ID3v1 or APE tag.)
        let tags = all_tags(&tagged);
        let text = |f: &dyn Fn(&lofty::tag::Tag) -> Option<String>| tags.iter()
            .find_map(|t| f(t).map(|v| v.trim().to_string()).filter(|v| !v.is_empty()));
        item.title = text(&|t| t.title().map(|v| v.into_owned()));
        item.artist = text(&|t| t.artist().map(|v| v.into_owned()));
        item.album = text(&|t| t.album().map(|v| v.into_owned()));
        item.year = text(&|t| t.year().filter(|y| *y > 0).map(|y| y.to_string()));
        item.genre = text(&|t| t.genre().map(|v| v.into_owned()));
        item.track = tags.iter().find_map(|t| t.track().filter(|n| *n > 0));
        item.disc = tags.iter().find_map(|t| t.disk().filter(|n| *n > 0));
    }
    // If lofty produced no usable organizing tags, try the fallbacks.
    if tags_missing(item) {
        id3v2_meta(path, item);
    }
    if tags_missing(item) || item.duration_secs.is_none() {
        if let Some(ff) = ffmpeg {
            ffmpeg_meta(ff, path, item);
        }
    }
}

/// A song that FFmpeg could tell more about (no tags read, or no length):
/// read without FFmpeg, it's read again once FFmpeg is there (WMA, ATRAC...).
pub(crate) fn wants_ffmpeg(kind: &str, item: &MediaItem) -> bool {
    match kind {
        "music" => tags_missing(item) || item.duration_secs.is_none(),
        "video" => item.duration_secs.is_none() || item.width.is_none(),
        _ => false,
    }
}

/// True when none of the fields used to organize the library were filled.
fn tags_missing(item: &MediaItem) -> bool {
    item.title.is_none() && item.artist.is_none() && item.album.is_none()
}

// --------------------------- ID3v2 fallback --------------------------------
// A compact ID3v2.3 / 2.4 text-frame reader, used for formats lofty won't open.
// It locates the tag either at the very start of the file (ID3v2 prepended, as
// SonicStage does for ATRAC/OMA and as MP3 uses) or via the DSF metadata pointer
// (DSD files store an ID3v2 block whose offset sits in the DSD header).

fn id3v2_meta(path: &Path, item: &mut MediaItem) {
    let Ok(bytes) = read_head_and_tag(path) else { return };
    let Some((ver, tag)) = find_id3v2(&bytes) else { return };
    parse_id3v2(tag, ver, item);
}

/// Read enough of the file to reach an ID3v2 tag: the first 1 MiB (covers a
/// prepended tag), plus — for DSF — the ID3v2 block the header points at.
fn read_head_and_tag(path: &Path) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = fs::File::open(path)?;
    let mut head = vec![0u8; 1024 * 1024];
    let n = f.read(&mut head)?;
    head.truncate(n);
    // DSF: "DSD " chunk, metadata (ID3v2) pointer is a u64 at offset 20.
    if head.len() >= 28 && &head[0..4] == b"DSD " {
        let ptr = u64::from_le_bytes([head[20], head[21], head[22], head[23], head[24], head[25], head[26], head[27]]);
        if ptr >= 12 {
            if f.seek(SeekFrom::Start(ptr)).is_ok() {
                let mut tail = Vec::new();
                // cap the ID3 block we read so a corrupt pointer can't eat memory
                let mut limited = (&f).take(4 * 1024 * 1024);
                if limited.read_to_end(&mut tail).is_ok() && tail.len() >= 10 && &tail[0..3] == b"ID3" {
                    return Ok(tail);
                }
            }
        }
    }
    Ok(head)
}

/// Find an ID3v2 tag ("ID3") at the start of the buffer, returning the frame
/// region (after the 10-byte header) sized by the synchsafe tag-size field.
fn find_id3v2(buf: &[u8]) -> Option<(u8, &[u8])> {
    if buf.len() < 10 || &buf[0..3] != b"ID3" {
        return None;
    }
    let size = synchsafe(&buf[6..10]) as usize;
    let end = (10 + size).min(buf.len());
    Some((buf[3], &buf[10..end]))
}

/// An ID3v2 frame's size. v2.2: 3 bytes; v2.3: plain; v2.4: synchsafe, but
/// some taggers (older iTunes among them) wrote v2.4 tags with v2.3's plain
/// sizes, so the reading that lands on the next frame (or the end) is taken.
fn id3_frame_size(b: &[u8], o: usize, ver: u8, end: usize) -> usize {
    if ver == 2 { return ((b[o + 3] as usize) << 16) | ((b[o + 4] as usize) << 8) | b[o + 5] as usize; }
    let s4 = &b[o + 4..o + 8];
    let plain = u32::from_be_bytes([s4[0], s4[1], s4[2], s4[3]]) as usize;
    if ver == 3 { return plain; }
    let ss = synchsafe(s4) as usize;
    if ss == plain { return ss; }
    // a frame starts with four letters / digits, or padding (zeros) follows
    let lands = |size: usize| -> bool {
        let next = o + 10 + size;
        if next == end { return true; }
        if next + 4 > end { return false; }
        let id = &b[next..next + 4];
        id.iter().all(|&c| c == 0) || id.iter().all(|&c| c.is_ascii_uppercase() || c.is_ascii_digit())
    };
    if !lands(ss) && lands(plain) { plain } else { ss }
}

fn synchsafe(b: &[u8]) -> u32 {
    ((b[0] as u32 & 0x7f) << 21) | ((b[1] as u32 & 0x7f) << 14) | ((b[2] as u32 & 0x7f) << 7) | (b[3] as u32 & 0x7f)
}

/// Walk ID3v2.3/2.4 frames and pull the fields the library organizes by.
fn parse_id3v2(frames: &[u8], ver: u8, item: &mut MediaItem) {
    if ver < 3 { return; }      // (v2.2's three-letter frames: read by the tag library)
    let mut i = 0usize;
    while i + 10 <= frames.len() {
        let id = &frames[i..i + 4];
        if id == [0, 0, 0, 0] {
            break; // padding
        }
        let size = id3_frame_size(frames, i, ver, frames.len());
        if size == 0 || i + 10 + size > frames.len() {
            break;
        }
        let body = &frames[i + 10..i + 10 + size];
        if id[0] == b'T' {
            if let Some(text) = decode_text_frame(body) {
                let id = std::str::from_utf8(id).unwrap_or("");
                assign_id3_text(id, &text, item);
            }
        }
        i += 10 + size;
    }
}

/// Map an ID3v2 text-frame id onto a MediaItem field (only when still empty, so
/// a tag already read by lofty is never clobbered).
fn assign_id3_text(id: &str, text: &str, item: &mut MediaItem) {
    let t = text.trim();
    if t.is_empty() {
        return;
    }
    match id {
        "TIT2" => if item.title.is_none() { item.title = Some(t.to_string()); },
        "TPE1" | "TPE2" => if item.artist.is_none() { item.artist = Some(t.to_string()); },
        "TALB" => if item.album.is_none() { item.album = Some(t.to_string()); },
        "TYER" | "TDRC" | "TDRL" => if item.year.is_none() {
            // keep just the leading year (TDRC may be a full timestamp)
            let y: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !y.is_empty() { item.year = Some(y); }
        },
        "TCON" => if item.genre.is_none() { item.genre = Some(t.to_string()); },
        "TRCK" => if item.track.is_none() { item.track = leading_num(t); },
        "TPOS" => if item.disc.is_none() { item.disc = leading_num(t); },
        _ => {}
    }
}

/// Parse the numerator of a "3" or "3/12" track/disc value.
fn leading_num(s: &str) -> Option<u32> {
    let num: String = s.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
    num.parse().ok()
}

/// Decode an ID3v2 text frame body: first byte is the encoding, the rest is the
/// string (latin-1, UTF-16 with BOM, UTF-16BE, or UTF-8).
fn decode_text_frame(body: &[u8]) -> Option<String> {
    let (enc, raw) = body.split_first()?;
    let s = match enc {
        0 => raw.iter().map(|&b| b as char).collect::<String>(), // latin-1
        3 => String::from_utf8_lossy(raw).to_string(),           // utf-8
        1 => decode_utf16(raw, None),                            // utf-16 + BOM
        2 => decode_utf16(raw, Some(true)),                      // utf-16be, no BOM
        _ => String::from_utf8_lossy(raw).to_string(),
    };
    // text frames may carry a trailing NUL (and list separators); keep the first
    let s = s.split(['\u{0}']).next().unwrap_or("").trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// Decode UTF-16. `force_be`: Some(true) = big-endian no BOM; None = detect BOM
/// (default little-endian if absent).
fn decode_utf16(raw: &[u8], force_be: Option<bool>) -> String {
    let mut be = force_be.unwrap_or(false);
    let mut start = 0;
    if force_be.is_none() && raw.len() >= 2 {
        match (raw[0], raw[1]) {
            (0xFF, 0xFE) => { be = false; start = 2; }
            (0xFE, 0xFF) => { be = true; start = 2; }
            _ => {}
        }
    }
    let units: Vec<u16> = raw[start..]
        .chunks_exact(2)
        .map(|c| if be { u16::from_be_bytes([c[0], c[1]]) } else { u16::from_le_bytes([c[0], c[1]]) })
        .collect();
    String::from_utf16_lossy(&units)
}

// --------------------------- ffmpeg fallback -------------------------------
// `ffmpeg -i <file> -f ffmetadata -` prints container tags in a simple
// key=value form on stdout and the stream Duration on stderr. This reads tags
// for any format ffmpeg understands (WMA, ATRAC, APE, …) — the same formats the
// app already relies on ffmpeg to decode for playback.

/// A program started with no window of its own (the installed System has no
/// console: without this, each one opens a command window for a moment).
pub(crate) fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);   // CREATE_NO_WINDOW
    }
    cmd
}

fn ffmpeg_meta(ffmpeg: &Path, src: &Path, item: &mut MediaItem) {
    let out = no_window(&mut Command::new(ffmpeg))
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(src)
        .args(["-f", "ffmetadata", "-"])
        .output();
    let Ok(out) = out else { return };
    // tags: stdout, ffmetadata key=value lines
    let meta = String::from_utf8_lossy(&out.stdout);
    for line in meta.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        let Some((key, val)) = line.split_once('=') else { continue };
        let key = key.trim().to_ascii_lowercase();
        let val = unescape_ffmeta(val.trim());
        if val.is_empty() {
            continue;
        }
        match key.as_str() {
            "title" => if item.title.is_none() { item.title = Some(val); },
            "artist" | "album_artist" => if item.artist.is_none() { item.artist = Some(val); },
            "album" => if item.album.is_none() { item.album = Some(val); },
            "date" | "year" => if item.year.is_none() {
                let y: String = val.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !y.is_empty() { item.year = Some(y); }
            },
            "genre" => if item.genre.is_none() { item.genre = Some(val); },
            "track" => if item.track.is_none() { item.track = leading_num(&val); },
            "disc" => if item.disc.is_none() { item.disc = leading_num(&val); },
            _ => {}
        }
    }
    // duration: stderr "  Duration: HH:MM:SS.xx, ..."
    if item.duration_secs.is_none() {
        let log = String::from_utf8_lossy(&out.stderr);
        if let Some(idx) = log.find("Duration:") {
            let rest = &log[idx + "Duration:".len()..];
            let ts = rest.trim_start().split(',').next().unwrap_or("").trim();
            if let Some(secs) = parse_hms(ts) {
                item.duration_secs = Some(secs);
            }
        }
    }
}

/// Undo ffmetadata escaping (`\`, `=`, `;`, `#`, and newline are backslash-escaped).
fn unescape_ffmeta(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut esc = false;
    for c in s.chars() {
        if esc {
            out.push(c);
            esc = false;
        } else if c == '\\' {
            esc = true;
        } else {
            out.push(c);
        }
    }
    out
}

/// Parse "HH:MM:SS.xx" into whole seconds (rounded).
fn parse_hms(ts: &str) -> Option<u64> {
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].trim().parse().ok()?;
    let m: f64 = parts[1].trim().parse().ok()?;
    let s: f64 = parts[2].trim().parse().ok()?;
    Some((h * 3600.0 + m * 60.0 + s).round() as u64)
}

/// Extract the embedded cover of a music file into `cache_dir`, returning the
/// cached file path.
///
/// Covers are de-duplicated by IMAGE CONTENT: a given cover image is stored
/// exactly once (`cov_<contentHash>.<ext>`) and every song that carries that
/// exact image reuses the same file. So all songs in an album that share the
/// album's cover point at one file; a song whose cover differs gets its own
/// file, and any other songs sharing THAT image reuse it too, and so on.
///
/// To keep repeat scans fast (no re-extracting every file), each song also gets
/// a tiny pointer file (`ptr_<pathHash>`) naming the shared cover it resolved
/// to, and a `<pathHash>.nocover<N>` marker records "no cover".
pub fn cache_cover(path: &Path, cache_dir: &Path, ffmpeg: Option<&Path>) -> Option<String> {
    let pkey = path_hash(&path.to_string_lossy());
    // ("no cover" found without FFmpeg: noted apart, and tried again once
    // FFmpeg is there, which reads covers the built-in readers can't)
    let none_noff = cache_dir.join(format!("{pkey}.nocover{}.noff", crate::medialib::INDEX_VERSION));
    if ffmpeg.is_none() && none_noff.exists() { return None; }
    // ("no cover" is remembered too, per way of reading covers:
    // `<pathHash>.nocover<N>`. Markers from older ways are ignored: covers are
    // found in more places now, such as an MP3's ID3v1 / APE tag beside an
    // ID3v2 one, or an MP3 tag the tag library can't read)
    let none_marker = cache_dir.join(format!("{pkey}.nocover{}", crate::medialib::INDEX_VERSION));
    if none_marker.exists() {
        return None;
    }
    // per-song pointer: which shared cover file this song already resolved to
    let ptr = cache_dir.join(format!("ptr_{pkey}"));
    if let Ok(name) = fs::read_to_string(&ptr) {
        let name = name.trim();
        if !name.is_empty() {
            let f = cache_dir.join(name);
            if f.exists() {
                return Some(f.display().to_string());
            }
        }
    }
    match extract_cover(path).or_else(|| ffmpeg.and_then(|ff| ffmpeg_cover(ff, path))) {
        Some((mime, data)) => {
            let ext = if mime.contains("png") { "png" } else { "jpg" };
            // one shared file per unique cover image (content-addressed)
            let ckey = bytes_hash(&data);
            let name = format!("cov_{ckey:016x}.{ext}");
            let f = cache_dir.join(&name);
            if !f.exists() && fs::write(&f, &data).is_err() {
                return None;
            }
            let _ = fs::write(&ptr, name.as_bytes());
            Some(f.display().to_string())
        }
        None => {
            if ffmpeg.is_some() { let _ = fs::write(&none_marker, b""); let _ = fs::remove_file(&none_noff); }
            else { let _ = fs::write(&none_noff, b""); }
            None
        }
    }
}

/// A song's cover through FFmpeg (its attached picture), for files the
/// built-in readers can't take it from.
fn ffmpeg_cover(ffmpeg: &Path, src: &Path) -> Option<(String, Vec<u8>)> {
    let out = no_window(&mut Command::new(ffmpeg))
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"]).arg(src)
        .args(["-map", "0:v:0", "-c", "copy", "-frames:v", "1", "-f", "image2pipe", "-"])
        .output().ok()?;
    let d = out.stdout;
    if d.len() < 64 { return None; }
    let mime = if d.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else if d.starts_with(&[0xFF, 0xD8]) { "image/jpeg" } else { return None };
    Some((mime.to_string(), d))
}

fn path_hash(s: &str) -> u64 {
    // djb2
    let mut h: u64 = 5381;
    for b in s.bytes() {
        h = (h << 5).wrapping_add(h).wrapping_add(b as u64);
    }
    h
}

/// Content hash of a cover image (FNV-1a over the bytes, mixing in the length so
/// two images of different sizes never collide on prefix alone).
fn bytes_hash(data: &[u8]) -> u64 {
    let mut h: u64 = 1469598103934665603;
    for b in data {
        h ^= *b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    for b in (data.len() as u64).to_le_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    h
}

fn read_image_meta(path: &Path, item: &mut MediaItem) {
    if let Ok(dim) = imagesize::size(path) {
        item.width = Some(dim.width as u32);
        item.height = Some(dim.height as u32);
    }
}

/// Extract the first embedded cover-art picture from an audio file, if any.
pub fn extract_cover(path: &Path) -> Option<(String, Vec<u8>)> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let raw = matches!(ext.as_str(), "wma" | "asf" | "dsf" | "oma" | "aa3" | "omg" | "at3" | "at9");
    lofty_cover(path)
        .or_else(|| if raw { raw_cover(path) } else { None })
        // (an MP3, say, whose tag the tag library can't read at all: its
        // ID3v2 tag at the start is read here)
        .or_else(|| if raw { None } else { id3_head(path).and_then(|b| id3_picture(&b)) })
}

/// A file's tags as the tag library reads them; a file it can't read the
/// usual way is read again leniently (it skips what's broken and keeps the
/// rest), as many players do.
fn read_tagged(path: &Path) -> Option<lofty::file::TaggedFile> {
    use lofty::config::{ParseOptions, ParsingMode};
    lofty::read_from_path(path).ok().or_else(|| {
        lofty::probe::Probe::open(path).ok()?.options(ParseOptions::new().parsing_mode(ParsingMode::Relaxed)).read().ok()
    })
}

/// A file's tags, its main one first.
fn all_tags(tagged: &lofty::file::TaggedFile) -> Vec<&lofty::tag::Tag> {
    use lofty::file::TaggedFileExt;
    let mut v: Vec<&lofty::tag::Tag> = tagged.primary_tag().into_iter().collect();
    for t in tagged.tags() { if !v.iter().any(|x| std::ptr::eq(*x, t)) { v.push(t); } }
    v
}

fn lofty_cover(path: &Path) -> Option<(String, Vec<u8>)> {
    use lofty::picture::PictureType;
    let tagged = read_tagged(path)?;
    // the front cover of any tag (the main tag first), else its first picture
    let tags = all_tags(&tagged);
    let pic = tags.iter().find_map(|t| t.pictures().iter().find(|p| p.pic_type() == PictureType::CoverFront))
        .or_else(|| tags.iter().find_map(|t| t.pictures().first()))?;
    let mime = pic.mime_type().map(|m| m.as_str().to_string()).unwrap_or_else(|| "image/jpeg".to_string());
    Some((mime, pic.data().to_vec()))
}

// ---- covers in formats the tag library can't read --------------------------
// WMA (ASF "WM/Picture"), DSD .dsf (ID3v2 block at the end), ATRAC .oma/.aa3
// ("ea3" tag, laid out like ID3v2) and .at3/.at9 (RIFF with an "id3 " chunk).

/// The ID3v2 tag at the start of a file, whole (its own size field says how
/// much to read; capped so a broken one can't eat memory).
fn id3_head(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut f = fs::File::open(path).ok()?;
    let mut h = [0u8; 10];
    f.read_exact(&mut h).ok()?;
    if &h[0..3] != b"ID3" { return None; }
    let size = synchsafe(&h[6..10]) as usize;
    if size > 64 * 1024 * 1024 { return None; }
    let mut b = h.to_vec(); b.resize(10 + size, 0);
    f.read_exact(&mut b[10..]).ok()?;
    Some(b)
}

fn raw_cover(path: &Path) -> Option<(String, Vec<u8>)> {
    let len = fs::metadata(path).ok()?.len();
    if len > 512 * 1024 * 1024 { return None; }
    let b = fs::read(path).ok()?;
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let found = match ext.as_str() {
        "wma" | "asf" | "wmv" => asf_picture(&b),
        "dsf" => dsf_id3(&b).and_then(id3_picture),
        "oma" | "aa3" | "omg" => id3_picture(&b),
        _ => None,
    };
    found.or_else(|| {
        // any ID3v2 / ea3 block in the file (RIFF "id3 " chunks, odd layouts)
        let mut i = 0;
        while i + 10 < b.len() {
            let w = &b[i..i + 3];
            if (w == b"ID3" || w == b"ea3") && (2..=4).contains(&b[i + 3]) {
                if let Some(p) = id3_picture(&b[i..]) { return Some(p); }
            }
            i += 1;
        }
        None
    })
}

fn dsf_id3(b: &[u8]) -> Option<&[u8]> {
    if b.get(0..4)? != b"DSD " { return None; }
    let ptr = u64::from_le_bytes(b.get(20..28)?.try_into().ok()?) as usize;
    if ptr == 0 { return None; }
    b.get(ptr..)
}

fn syncsafe(x: &[u8]) -> usize {
    ((x[0] as usize & 0x7f) << 21) | ((x[1] as usize & 0x7f) << 14) | ((x[2] as usize & 0x7f) << 7) | (x[3] as usize & 0x7f)
}

/// Skip a text terminated for its encoding (0/3 = 1 zero byte, 1/2 = 2 zero bytes).
fn skip_text(d: &[u8], enc: u8) -> Option<usize> {
    if enc == 1 || enc == 2 {
        let mut i = 0;
        while i + 1 < d.len() { if d[i] == 0 && d[i + 1] == 0 { return Some(i + 2); } i += 2; }
        None
    } else {
        d.iter().position(|&c| c == 0).map(|i| i + 1)
    }
}

fn sniff_mime(data: &[u8], declared: &str) -> String {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) { return "image/png".into(); }
    if data.starts_with(&[0xFF, 0xD8]) { return "image/jpeg".into(); }
    if declared.contains('/') { declared.to_string() } else { "image/jpeg".into() }
}

/// The first picture (APIC / PIC frame) in an ID3v2 or "ea3" tag.
pub(crate) fn id3_picture(b: &[u8]) -> Option<(String, Vec<u8>)> {
    let magic = b.get(0..3)?;
    if magic != b"ID3" && magic != b"ea3" { return None; }
    let ver = *b.get(3)?;
    let flags = *b.get(5)?;
    let size = syncsafe(b.get(6..10)?);
    let end = (10 + size).min(b.len());
    let mut o = 10;
    if flags & 0x40 != 0 && ver >= 3 {
        let ext = b.get(10..14)?;
        o += if ver == 4 { syncsafe(ext) } else { u32::from_be_bytes(ext.try_into().ok()?) as usize + 4 };
    }
    let (id_len, hdr) = if ver == 2 { (3, 6) } else { (4, 10) };
    while o + hdr <= end {
        let id = &b[o..o + id_len];
        if id[0] == 0 { break; }
        let fsize = id3_frame_size(b, o, ver, end);
        let body_start = o + hdr;
        let body = b.get(body_start..(body_start + fsize).min(end))?;
        if (ver == 2 && id == b"PIC") || (ver != 2 && id == b"APIC") {
            let enc = *body.first()?;
            let (mime, mut p) = if ver == 2 {
                (match body.get(1..4)? { f if f.eq_ignore_ascii_case(b"PNG") => "image/png".to_string(), _ => "image/jpeg".to_string() }, 4)
            } else {
                let m_end = 1 + body[1..].iter().position(|&c| c == 0)?;
                (String::from_utf8_lossy(&body[1..m_end]).to_string(), m_end + 1)
            };
            p += 1; // picture type
            p += skip_text(body.get(p..)?, enc)?;
            let data = body.get(p..)?.to_vec();
            if data.len() > 16 { return Some((sniff_mime(&data, &mime), data)); }
        }
        if fsize == 0 { break; }
        o = body_start + fsize;
    }
    None
}

/// WMA / ASF: the "WM/Picture" entry of the Extended Content Description object.
pub(crate) fn asf_picture(b: &[u8]) -> Option<(String, Vec<u8>)> {
    const ECD: [u8; 16] = [0x40, 0xA4, 0xD0, 0xD2, 0x07, 0xE3, 0xD2, 0x11, 0x97, 0xF0, 0x00, 0xA0, 0xC9, 0x5E, 0xA8, 0x50];
    let start = b.windows(16).position(|w| w == ECD)?;
    let osize = u64::from_le_bytes(b.get(start + 16..start + 24)?.try_into().ok()?) as usize;
    let end = (start + osize).min(b.len());
    let count = u16::from_le_bytes(b.get(start + 24..start + 26)?.try_into().ok()?);
    let mut o = start + 26;
    let u16at = |o: usize| -> Option<usize> { Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?) as usize) };
    for _ in 0..count {
        let nlen = u16at(o)?;
        let name: Vec<u16> = b.get(o + 2..o + 2 + nlen)?.chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let name = String::from_utf16_lossy(&name).trim_end_matches('\0').to_string();
        let vtype = u16at(o + 2 + nlen)?;
        let vlen = u16at(o + 4 + nlen)?;
        let v0 = o + 6 + nlen;
        if name == "WM/Picture" && vtype == 1 {
            let v = b.get(v0..(v0 + vlen).min(end))?;
            let dlen = u32::from_le_bytes(v.get(1..5)?.try_into().ok()?) as usize;
            let mut p = 5;
            let mut mime = String::new();
            // mime and description: UTF-16, zero-terminated
            for k in 0..2 {
                let mut q = p;
                let mut w = Vec::new();
                while q + 1 < v.len() { let c = u16::from_le_bytes([v[q], v[q + 1]]); q += 2; if c == 0 { break; } w.push(c); }
                if k == 0 { mime = String::from_utf16_lossy(&w); }
                p = q;
            }
            let data = v.get(p..(p + dlen).min(v.len()))?.to_vec();
            if data.len() > 16 { return Some((sniff_mime(&data, &mime), data)); }
        }
        o = v0 + vlen;
        if o >= end { break; }
    }
    None
}

#[cfg(test)]
mod cover_tests {
    use super::*;
    /// The MP3s in MP3_TEST_DIR: what is read from each (printed).
    #[test]
    fn mp3_tags() {
        let Ok(dir) = std::env::var("MP3_TEST_DIR") else { return };
        let mut files: Vec<_> = fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).collect(); files.sort();
        for p in files.iter().filter(|p| p.extension().map(|x| x == "mp3").unwrap_or(false)) {
            let lofty_err = lofty::read_from_path(p).err().map(|e| e.to_string());
            let m = media_item(p, "music", None, true).unwrap();
            println!("MP3 {:18} title={:?} artist={:?} album={:?} year={:?} genre={:?} track={:?} disc={:?} secs={:?} cover={} lofty_err={:?}",
                p.file_name().unwrap().to_string_lossy(), m.title, m.artist, m.album, m.year, m.genre, m.track, m.disc, m.duration_secs, extract_cover(p).is_some(), lofty_err);
        }
    }
    #[test]
    fn id3_apic_v3() {
        let img = [0xFFu8, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let mut body = vec![0u8];
        body.extend_from_slice(b"image/jpeg\0");
        body.push(3); body.extend_from_slice(b"cover\0"); body.extend_from_slice(&img);
        let mut frame = b"APIC".to_vec();
        frame.extend_from_slice(&(body.len() as u32).to_be_bytes()); frame.extend_from_slice(&[0, 0]); frame.extend_from_slice(&body);
        let n = frame.len();
        let mut tag = b"ea3".to_vec();
        tag.extend_from_slice(&[3, 0, 0, ((n >> 21) & 0x7f) as u8, ((n >> 14) & 0x7f) as u8, ((n >> 7) & 0x7f) as u8, (n & 0x7f) as u8]);
        tag.extend_from_slice(&frame);
        let (m, d) = id3_picture(&tag).unwrap();
        assert_eq!(m, "image/jpeg"); assert_eq!(d, img.to_vec());
    }
    #[test]
    fn asf_wm_picture() {
        let img = [0x89u8, b'P', b'N', b'G', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
        let w = |s: &str| -> Vec<u8> { s.encode_utf16().chain(std::iter::once(0)).flat_map(|c| c.to_le_bytes()).collect() };
        let mut val = vec![3u8]; val.extend_from_slice(&(img.len() as u32).to_le_bytes());
        val.extend(w("image/png")); val.extend(w("")); val.extend_from_slice(&img);
        let name = w("WM/Picture");
        let mut d = Vec::new();
        d.extend_from_slice(&(name.len() as u16).to_le_bytes()); d.extend(&name);
        d.extend_from_slice(&1u16.to_le_bytes()); d.extend_from_slice(&(val.len() as u16).to_le_bytes()); d.extend(&val);
        let mut obj = vec![0x40, 0xA4, 0xD0, 0xD2, 0x07, 0xE3, 0xD2, 0x11, 0x97, 0xF0, 0x00, 0xA0, 0xC9, 0x5E, 0xA8, 0x50];
        obj.extend_from_slice(&((26 + d.len()) as u64).to_le_bytes()); obj.extend_from_slice(&1u16.to_le_bytes()); obj.extend(d);
        let mut file = vec![0u8; 30]; file.extend(obj);
        let (m, data) = asf_picture(&file).unwrap();
        assert_eq!(m, "image/png"); assert_eq!(data, img.to_vec());
    }
}

/// One media file's item (metadata read per kind). `in_root`: the file sits
/// directly in a media folder.
pub fn media_item(p: &Path, kind: &str, ffmpeg: Option<&Path>, in_root: bool) -> Option<MediaItem> {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let meta = fs::metadata(p).ok()?;
        let modified = meta
            .modified().ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs()).unwrap_or(0);

        let mut item = MediaItem {
            name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            path: p.display().to_string(),
            ext: ext.clone(),
            size: meta.len(),
            modified,
            in_root,
            ..Default::default()
        };

        match kind {
            "music" => read_audio_meta(p, ffmpeg, &mut item),
            "photo" | "background" => read_image_meta(p, &mut item),
            "video" => {
                // duration + picture size straight from the file (MP4 / MKV / WebM)
                if let Some(v) = crate::vprobe::probe(p) {
                    if v.duration > 0.0 { item.duration_secs = Some(v.duration.round() as u64); }
                    if v.width > 0 { item.width = Some(v.width); item.height = Some(v.height); }
                }
                // (other kinds of video (AVI, WMV, MPG, FLV...): through FFmpeg)
                if item.duration_secs.is_none() || item.width.is_none() {
                    if let Some(ff) = ffmpeg {
                        if let Ok(o) = no_window(&mut Command::new(ff)).args(["-hide_banner", "-nostdin", "-i"]).arg(p).output() {
                            let v = crate::video::parse_report(&String::from_utf8_lossy(&o.stderr));
                            if item.duration_secs.is_none() && v.duration > 0.0 { item.duration_secs = Some(v.duration.round() as u64); }
                            if item.width.is_none() && v.width > 0 { item.width = Some(v.width); item.height = Some(v.height); }
                        }
                    }
                }
            }
            _ => {}
        }
        Some(item)
}


