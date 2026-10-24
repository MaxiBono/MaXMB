//! Small copies of pictures (photos, song covers) for lists and grids.
//!
//! A list row or a grid square is a few hundred pixels across, but a camera
//! photo is 4000 × 3000: shown as it is, each one is read and decoded whole
//! (tens of MB of memory apiece, and half a second before it appears). The
//! page asks for `thumb://…/<path>` instead and gets a copy at most SIZE
//! pixels on its longer side, made once and kept (made again when the picture
//! changes). JPEGs are decoded already shrunk (1/2, 1/4 or 1/8 of their size),
//! which is many times faster than decoding them whole. The picture's own
//! orientation (EXIF) is applied, as the page would.
//!
//! Where they're kept: Windows' Temp folder (%TEMP%/MaXMB/thumbs), or with "Save
//! Cache in System Directory" data/cache/thumbs, like the other caches. Each
//! folder has an index (index.tsv: copy, kind, picture) so the copies of
//! pictures that are gone (or changed since) are deleted at the next start.
//!
//! `still`: a still picture for a grid square: a video's frame at 0.5 s (with
//! ffmpeg), a GIF's first frame. Otherwise GIFs (they may move), pictures
//! that are small already and kinds that can't be read here are sent as they
//! are, so nothing shows less than before.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::UNIX_EPOCH;

/// "Save Cache in System Directory" (kept in step with the settings, so a
/// request doesn't read them from disk)
pub static IN_APP_DIR: AtomicBool = AtomicBool::new(false);

/// The two places copies can be: (where they go now, the other one).
#[derive(Clone)]
pub struct Dirs { pub temp: PathBuf, pub app: PathBuf }
impl Dirs {
    fn order(&self) -> (&Path, &Path) {
        if IN_APP_DIR.load(Ordering::Relaxed) { (&self.app, &self.temp) } else { (&self.temp, &self.app) }
    }
}

/// The longer side of a small copy, in pixels.
pub const SIZE: u32 = 480;
/// How copies are made: a change here makes them all again.
const VERSION: u32 = 1;
/// Copies made at the same time (the rest wait), so a slow computer isn't
/// swamped when a big folder is opened.
const AT_ONCE: usize = 2;

static SLOTS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());
struct Slot;
impl Slot {
    fn take() -> Slot {
        let (m, cv) = &SLOTS;
        let mut n = m.lock().unwrap_or_else(|e| e.into_inner());
        while *n >= AT_ONCE { n = cv.wait(n).unwrap_or_else(|e| e.into_inner()); }
        *n += 1;
        Slot
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        let (m, cv) = &SLOTS;
        let mut n = m.lock().unwrap_or_else(|e| e.into_inner());
        *n = n.saturating_sub(1);
        cv.notify_one();
    }
}

/// The kinds of pictures served (as small copies, or as they are).
const PICTURES: &[&str] = &["jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp", "png", "apng", "gif", "webp", "bmp", "avif", "svg", "ico", "tif", "tiff", "heic", "heif"];

pub fn mime_of(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("png") | Some("apng") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("tif") | Some("tiff") => "image/tiff",
        _ => "image/jpeg",
    }
}

/// A picture's copy name as it is now (its place, size and date, still or not).
fn key_of(src: &Path, still: bool) -> Option<String> {
    let md = fs::metadata(src).ok()?;
    let m = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let mut h = DefaultHasher::new();
    (src.to_string_lossy(), m, md.len(), SIZE, VERSION, still).hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// A copy already made, in `dir`: (its file, bytes, media type).
fn read_copy(dir: &Path, key: &str) -> Option<(PathBuf, Vec<u8>, &'static str)> {
    for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
        let f = dir.join(format!("{key}.{ext}"));
        if let Ok(b) = fs::read(&f) { return Some((f, b, mime)); }
    }
    None
}

static INDEX: Mutex<()> = Mutex::new(());
/// Notes in `dir`'s index which picture a copy belongs to.
fn note(dir: &Path, key: &str, still: bool, src: &Path) {
    use std::io::Write;
    let _g = INDEX.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join("index.tsv")) {
        let _ = writeln!(f, "{key}\t{}\t{}", if still { 1 } else { 0 }, src.display());
    }
}

/// Deletes the copies of pictures that are gone or have changed since (and
/// any file the index doesn't know), in both places. Run at start.
pub fn sweep(dirs: &Dirs) -> usize {
    let mut gone = 0;
    for dir in [&dirs.temp, &dirs.app] {
        let _g = INDEX.lock().unwrap_or_else(|e| e.into_inner());
        let text = fs::read_to_string(dir.join("index.tsv")).unwrap_or_default();
        let mut keep: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for line in text.lines() {
            let mut it = line.splitn(3, '\t');
            let (Some(k), Some(st), Some(p)) = (it.next(), it.next(), it.next()) else { continue };
            // still the same picture: the copy stays
            if key_of(Path::new(p), st == "1").as_deref() == Some(k) { keep.insert(k.to_string(), line.to_string()); }
        }
        let Ok(rd) = fs::read_dir(dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name == "index.tsv" { continue; }
            let stem = name.split('.').next().unwrap_or("");
            if !keep.contains_key(stem) { let _ = fs::remove_file(e.path()); gone += 1; }
        }
        let mut lines: Vec<&String> = keep.values().collect(); lines.sort();
        let body: String = lines.iter().map(|l| format!("{l}\n")).collect();
        if body.is_empty() { let _ = fs::remove_file(dir.join("index.tsv")); } else { let _ = fs::write(dir.join("index.tsv"), body); }
    }
    gone
}

/// Deletes a picture's copies now (before it's deleted or written over).
pub fn forget(dirs: &Dirs, src: &Path) {
    for still in [false, true] {
        let Some(k) = key_of(src, still) else { continue };
        for dir in [&dirs.temp, &dirs.app] {
            for ext in ["jpg", "png"] { let _ = fs::remove_file(dir.join(format!("{k}.{ext}"))); }
        }
    }
}

/// A picture's small copy (made now if needed) or, when one isn't worth it or
/// can't be made, the picture itself: (bytes, media type). `still`: see the
/// top of this file; a video needs `ffmpeg` for its frame.
pub fn thumb(src: &Path, dirs: &Dirs, still: bool, ffmpeg: Option<&Path>) -> Option<(Vec<u8>, &'static str)> {
    let original = || fs::read(src).ok().map(|b| (b, mime_of(src)));
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let video = crate::media::kind_exts("video").contains(&ext.as_str());
    // pictures (and, as stills, videos) only: anything else asked for here isn't sent
    if !video && !PICTURES.contains(&ext.as_str()) { return None; }
    if video && !still { return None; }
    if matches!(ext.as_str(), "svg" | "ico" | "avif" | "heic" | "heif") || (ext == "gif" && !still) { return original(); }
    let still = still && (video || ext == "gif");
    let key = key_of(src, still)?;
    let (main, other) = dirs.order();
    if let Some((_, b, m)) = read_copy(main, &key) { return Some((b, m)); }
    // made while the other place was in use: moved here
    if let Some((f, b, m)) = read_copy(other, &key) {
        let _ = fs::create_dir_all(main);
        let to = main.join(f.file_name()?);
        if fs::rename(&f, &to).is_ok() { note(main, &key, still, src); }
        return Some((b, m));
    }
    // small already: as it is (a copy would only cost)
    if !video && !still {
        if let Ok(d) = imagesize::size(src) {
            if d.width as u32 <= SIZE && d.height as u32 <= SIZE { return original(); }
        }
    }
    let _slot = Slot::take();
    // (made by another request for the same picture while this one waited)
    if let Some((_, b, m)) = read_copy(main, &key) { return Some((b, m)); }
    let made = if video { video_frame(src, ffmpeg?) }
        else if ext == "gif" { small_other(src) }   // (its first frame)
        else if matches!(ext.as_str(), "jpg" | "jpeg" | "jpe" | "jfif" | "pjpeg" | "pjp") { small_jpeg(src) } else { small_other(src) };
    let Some(img) = made else { return if video { None } else { original() } };
    let (bytes, mime) = encode(&img)?;
    let _ = fs::create_dir_all(main);
    // written whole, then put in place (a half-written copy is never read)
    let out = main.join(format!("{key}.{}", if mime == "image/png" { "png" } else { "jpg" }));
    let tmp = out.with_extension(format!("tmp{}", std::process::id()));
    if fs::write(&tmp, &bytes).is_ok() {
        if fs::rename(&tmp, &out).is_ok() { note(main, &key, still, src); } else { let _ = fs::remove_file(&tmp); }
    }
    Some((bytes, mime))
}

/// A video's frame at 0.5 s (the frame shown before), or its first one when
/// it's shorter, through ffmpeg.
fn video_frame(src: &Path, ffmpeg: &Path) -> Option<image::DynamicImage> {
    use std::process::Command;
    for at in ["0.5", "0"] {
        let mut cmd = Command::new(ffmpeg);
        cmd.args(["-hide_banner", "-loglevel", "error", "-ss", at, "-i"]).arg(src)
            .args(["-frames:v", "1", "-an", "-sn", "-vf", &format!("scale='min({SIZE},iw)':'min({SIZE},ih)':force_original_aspect_ratio=decrease"),
                "-f", "image2pipe", "-vcodec", "png", "-"]);
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); }
        let out = cmd.stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output().ok()?;
        if out.status.success() && !out.stdout.is_empty() {
            if let Ok(img) = image::load_from_memory(&out.stdout) { return Some(fit(img)); }
        }
    }
    None
}

fn encode(img: &image::DynamicImage) -> Option<(Vec<u8>, &'static str)> {
    let mut out = Vec::new();
    if img.color().has_alpha() {
        img.write_with_encoder(image::codecs::png::PngEncoder::new(&mut out)).ok()?;
        Some((out, "image/png"))
    } else {
        let rgb = img.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85).encode_image(&rgb).ok()?;
        Some((out, "image/jpeg"))
    }
}

/// Fits a picture within SIZE × SIZE (keeping its shape).
fn fit(img: image::DynamicImage) -> image::DynamicImage {
    if img.width() <= SIZE && img.height() <= SIZE { img } else { img.thumbnail(SIZE, SIZE) }
}

fn small_jpeg(src: &Path) -> Option<image::DynamicImage> {
    use jpeg_decoder::{Decoder, PixelFormat};
    let f = fs::File::open(src).ok()?;
    let mut d = Decoder::new(std::io::BufReader::new(f));
    d.read_info().ok()?;
    let info = d.info()?;
    let (w, h) = (info.width as u32, info.height as u32);
    // the smallest of 1/1, 1/2, 1/4, 1/8 still at least SIZE on its longer side
    let k = (w.max(h) as f32 / SIZE as f32).max(1.0);
    let (rw, rh) = (((w as f32 / k).ceil() as u16).max(1), ((h as f32 / k).ceil() as u16).max(1));
    d.scale(rw, rh).ok()?;
    let px = d.decode().ok()?;
    let info = d.info()?;
    let (sw, sh) = (info.width as u32, info.height as u32);
    let orientation = d.exif_data().and_then(exif_orientation);
    let img = match info.pixel_format {
        PixelFormat::RGB24 => image::DynamicImage::ImageRgb8(image::RgbImage::from_raw(sw, sh, px)?),
        PixelFormat::L8 => image::DynamicImage::ImageLuma8(image::GrayImage::from_raw(sw, sh, px)?),
        PixelFormat::L16 => {
            let v: Vec<u8> = px.chunks_exact(2).map(|c| c[0]).collect();
            image::DynamicImage::ImageLuma8(image::GrayImage::from_raw(sw, sh, v)?)
        }
        PixelFormat::CMYK32 => {
            // (Adobe JPEGs store CMYK inverted)
            let v: Vec<u8> = px.chunks_exact(4).flat_map(|c| {
                let k = c[3] as u16;
                [(c[0] as u16 * k / 255) as u8, (c[1] as u16 * k / 255) as u8, (c[2] as u16 * k / 255) as u8]
            }).collect();
            image::DynamicImage::ImageRgb8(image::RgbImage::from_raw(sw, sh, v)?)
        }
    };
    let mut img = fit(img);
    if let Some(o) = orientation.and_then(image::metadata::Orientation::from_exif) { img.apply_orientation(o); }
    Some(img)
}

fn small_other(src: &Path) -> Option<image::DynamicImage> {
    use image::ImageDecoder;
    let reader = image::ImageReader::open(src).ok()?.with_guessed_format().ok()?;
    let mut dec = reader.into_decoder().ok()?;
    let orientation = dec.orientation().ok();
    let img = image::DynamicImage::from_decoder(dec).ok()?;
    let mut img = fit(img);
    if let Some(o) = orientation { img.apply_orientation(o); }
    Some(img)
}

/// The Orientation tag (0x0112) of a JPEG's EXIF block, if it has one.
fn exif_orientation(exif: &[u8]) -> Option<u8> {
    let t = exif.strip_prefix(b"Exif\0\0").unwrap_or(exif);
    let le = match t.get(0..2)? { b"II" => true, b"MM" => false, _ => return None };
    let u16_at = |o: usize| -> Option<u16> { let b = t.get(o..o + 2)?; Some(if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) }) };
    let u32_at = |o: usize| -> Option<u32> { let b = t.get(o..o + 4)?; let a = [b[0], b[1], b[2], b[3]]; Some(if le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) }) };
    let ifd = u32_at(4)? as usize;
    let n = u16_at(ifd)? as usize;
    for i in 0..n.min(512) {
        let e = ifd + 2 + i * 12;
        if u16_at(e)? == 0x0112 { return u16_at(e + 8).map(|v| v as u8).filter(|v| (1..=8).contains(v)); }
    }
    None
}

/// "%2Fhome%2Fme%2Fa.jpg" → "/home/me/a.jpg" (a thumb:// address's path).
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let hex = |c: u8| -> Option<u8> { (c as char).to_digit(16).map(|v| v as u8) };
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) { out.push(h * 16 + l); i += 3; continue; }
        }
        out.push(b[i]); i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn photo(path: &Path, w: u32, h: u32, orientation: Option<u8>) {
        // a picture whose top-left corner is red and the rest blue
        let img = image::RgbImage::from_fn(w, h, |x, y| if x < w / 4 && y < h / 4 { image::Rgb([255, 0, 0]) } else { image::Rgb([0, 0, 255]) });
        let mut jpg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 90).encode_image(&img).unwrap();
        if let Some(o) = orientation {
            // an APP1 EXIF block with only the Orientation tag, right after SOI
            let mut tiff = b"MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01".to_vec();
            tiff.extend_from_slice(&[0, o, 0, 0]); tiff.extend_from_slice(&[0, 0, 0, 0]);
            let mut app1 = b"Exif\0\0".to_vec(); app1.extend(tiff);
            let len = (app1.len() + 2) as u16;
            let mut out = jpg[..2].to_vec(); out.extend_from_slice(&[0xFF, 0xE1]); out.extend_from_slice(&len.to_be_bytes()); out.extend(app1); out.extend_from_slice(&jpg[2..]);
            jpg = out;
        }
        fs::write(path, jpg).unwrap();
    }

    #[test]
    fn small_copies() {
        let t = std::env::temp_dir().join(format!("xmb_th_{}", std::process::id()));
        let _ = fs::remove_dir_all(&t); fs::create_dir_all(&t).unwrap();
        let dirs = Dirs { temp: t.join("temp_thumbs"), app: t.join("app_thumbs") };
        let files = |d: &Path| fs::read_dir(d).map(|r| r.flatten().filter(|e| e.file_name() != "index.tsv").count()).unwrap_or(0);
        let big = t.join("big.jpg"); photo(&big, 4000, 3000, None);
        let (b, mime) = thumb(&big, &dirs, false, None).unwrap();
        assert_eq!(mime, "image/jpeg");
        let im = image::load_from_memory(&b).unwrap();
        assert_eq!((im.width(), im.height()), (480, 360));
        assert!(b.len() < 100_000, "small: {} bytes", b.len());
        // kept in the temporary folder (the default), and read from there the second time
        assert_eq!((files(&dirs.temp), files(&dirs.app)), (1, 0));
        assert_eq!(thumb(&big, &dirs, false, None).unwrap().0, b);
        // "Save Cache in System Directory": moved there when next asked for
        IN_APP_DIR.store(true, Ordering::Relaxed);
        assert_eq!(thumb(&big, &dirs, false, None).unwrap().0, b);
        assert_eq!((files(&dirs.temp), files(&dirs.app)), (0, 1));
        IN_APP_DIR.store(false, Ordering::Relaxed);
        // the picture changes: a new copy; the old one goes at the next sweep
        photo(&big, 3000, 4000, None);
        let im2 = image::load_from_memory(&thumb(&big, &dirs, false, None).unwrap().0).unwrap();
        assert_eq!((im2.width(), im2.height()), (360, 480));
        // turned by its EXIF orientation (6 = turn right): 4000 × 3000 shows 3000 × 4000,
        // the red corner ending up top right
        let turned = t.join("turned.jpg"); photo(&turned, 4000, 3000, Some(6));
        let im3 = image::load_from_memory(&thumb(&turned, &dirs, false, None).unwrap().0).unwrap().to_rgb8();
        assert_eq!((im3.width(), im3.height()), (360, 480));
        let tr = im3.get_pixel(350, 10); let tl = im3.get_pixel(10, 10);
        assert!(tr[0] > 200 && tr[2] < 80, "top right red: {tr:?}");
        assert!(tl[2] > 200 && tl[0] < 80, "top left blue: {tl:?}");
        // a small picture: sent as it is
        let small = t.join("small.jpg"); photo(&small, 300, 200, None);
        assert_eq!(thumb(&small, &dirs, false, None).unwrap().0, fs::read(&small).unwrap());
        // a GIF: as it is (it may move); as a still, its first frame, small
        let gif = t.join("a.gif");
        image::RgbaImage::from_fn(800, 600, |_, _| image::Rgba([0, 200, 0, 255])).save(&gif).unwrap();
        assert_eq!(thumb(&gif, &dirs, false, None).unwrap().1, "image/gif");
        let (gb, _) = thumb(&gif, &dirs, true, None).unwrap();
        let gi = image::load_from_memory(&gb).unwrap();
        assert_eq!((gi.width(), gi.height()), (480, 360));
        // a PNG with see-through parts stays a PNG
        let png = t.join("cover.png");
        image::RgbaImage::from_fn(1200, 1200, |x, _| image::Rgba([255, 255, 255, if x < 600 { 0 } else { 255 }])).save(&png).unwrap();
        let (pb, pm) = thumb(&png, &dirs, false, None).unwrap();
        assert_eq!(pm, "image/png");
        let pim = image::load_from_memory(&pb).unwrap();
        assert_eq!((pim.width(), pim.height()), (480, 480));
        // something that isn't a picture: sent as it is (the page decides)
        let bad = t.join("broken.jpg"); fs::write(&bad, vec![0xFFu8; 5000]).unwrap();
        assert_eq!(thumb(&bad, &dirs, false, None).unwrap().0.len(), 5000);
        // a video: nothing unless as a still, and then its frame (with ffmpeg)
        let vid = t.join("clip.mp4");
        assert!(thumb(&vid, &dirs, false, None).is_none());
        let ff = Path::new("/usr/bin/ffmpeg");
        if ff.is_file() {
            let ok = std::process::Command::new(ff).args(["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=1280x720:d=2", "-pix_fmt", "yuv420p"]).arg(&vid).status().unwrap().success();
            assert!(ok);
            let (vb, vm) = thumb(&vid, &dirs, true, Some(ff)).unwrap();
            assert_eq!(vm, "image/jpeg");
            let vi = image::load_from_memory(&vb).unwrap().to_rgb8();
            assert_eq!((vi.width(), vi.height()), (480, 270));
            assert!(vi.get_pixel(240, 135)[0] > 200, "the red frame");
        }
        // the sweep: the copy of the changed picture goes, the others stay
        let before = files(&dirs.temp) + files(&dirs.app);
        assert_eq!(sweep(&dirs), 1, "the copy made before big.jpg changed");
        assert_eq!(files(&dirs.temp) + files(&dirs.app), before - 1);
        // a picture deleted outside the app: its copy goes at the next sweep
        fs::remove_file(&turned).unwrap();
        assert_eq!(sweep(&dirs), 1);
        // forget: the copies of a picture deleted (or rotated) in the app go now
        let n = files(&dirs.temp) + files(&dirs.app);
        forget(&dirs, &big);
        assert_eq!(files(&dirs.temp) + files(&dirs.app), n - 1);
        assert_eq!(sweep(&dirs), 0);
        assert_eq!(percent_decode("C%3A%5CUsers%5Cme%5Cfoto%20%C3%B1.jpg"), "C:\\Users\\me\\foto ñ.jpg");
        let _ = fs::remove_dir_all(&t);
    }
}
