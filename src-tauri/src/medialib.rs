//! The media library: Music / Photos / Videos as the app sees them.
//!
//! * The app's own folders (content/Music, content/Photos, content/Videos)
//!   are the library. They hold real files and **shortcuts** (`.xmbl` files:
//!   one line of JSON naming a file somewhere else), so music, pictures and
//!   videos kept elsewhere can be sorted into the app's folders (and the
//!   user's own subfolders there) like games are.
//! * **File Recognition**: every file found in the source folders the user
//!   adds gets a shortcut in the matching app folder (keeping the source's
//!   subfolders under a folder named after the source). Shortcuts the user
//!   deletes are remembered and not made again; removing a source folder
//!   deletes the shortcuts made from it.
//! * An **index** remembers what was read from each file (tags, length,
//!   picture size, cover) together with its size and date, and is kept on
//!   disk: a file is only read again when it changes, so listing a big
//!   library after the first time is just a walk through the folders.

use crate::media;
use crate::models::MediaItem;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

pub const LINK_EXT: &str = "xmbl";

// ------------------------------------------------------------- the index ---

// How files are read: a newer reader reads every file again once (the index
// keeps what each file had, and old entries would keep what was missing).
// 2: song tags taken from every tag a file has (MP3s' ID3v1 / APE too).
// 3: MP3s whose tag the tag library can't read (v2.4 tags with v2.3-style
//    frame sizes, say) read leniently, their covers too.
pub(crate) const INDEX_VERSION: u32 = 3;

#[derive(Serialize, Deserialize, Clone)]
struct Entry { m: u64, s: u64, item: MediaItem, #[serde(default)] v: u32,
    /// whether FFmpeg was there when the file was read
    #[serde(default)] ff: bool }

#[derive(Default)]
struct Index { file: Option<PathBuf>, map: HashMap<String, Entry>, dirty: bool, loaded: bool }

static INDEX: OnceLock<Mutex<Index>> = OnceLock::new();
fn index() -> std::sync::MutexGuard<'static, Index> {
    INDEX.get_or_init(|| Mutex::new(Index::default())).lock().unwrap_or_else(|e| e.into_inner())
}

fn with_index<T>(file: &Path, f: impl FnOnce(&mut Index) -> T) -> T {
    let mut ix = index();
    if !ix.loaded || ix.file.as_deref() != Some(file) {
        ix.map = fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        ix.file = Some(file.to_path_buf()); ix.loaded = true; ix.dirty = false;
    }
    f(&mut ix)
}
fn save_index(file: &Path) {
    let mut ix = index();
    if !ix.dirty { return; }
    if let Ok(t) = serde_json::to_string(&ix.map) { let _ = fs::write(file, t); }
    ix.dirty = false;
}
/// Forget everything read so far: files are read again.
#[allow(dead_code)]
pub fn clear_index(file: &Path) {
    let mut ix = index();
    ix.map.clear(); ix.dirty = false; ix.loaded = true; ix.file = Some(file.to_path_buf());
    let _ = fs::remove_file(file);
}

/// Delete Song Covers: every song's cover read again from the song itself
/// now (with progress), so the songs show their covers at once afterwards and
/// nothing else has to be read again (forgetting the whole index made the
/// next look at the Music column read every song, photo and video again).
/// `made(cover)`: called once per cover file read (its small copy is made
/// there, so the lists show it at once too).
pub fn reread_covers(file: &Path, covers: &Path, ffmpeg: Option<&Path>, made: &dyn Fn(&Path), progress: &dyn Fn(usize, usize)) {
    let mut done_covers = std::collections::HashSet::new();
    let keys: Vec<String> = with_index(file, |ix| ix.map.keys().filter(|k| k.starts_with("music|")).cloned().collect());
    let total = keys.len();
    progress(0, total);
    for (i, k) in keys.iter().enumerate() {
        let p = PathBuf::from(&k["music|".len()..]);
        let c = if p.is_file() { media::cache_cover(&p, covers, ffmpeg) } else { None };
        if let Some(cp) = c.as_ref() { if done_covers.insert(cp.clone()) { made(Path::new(cp)); } }
        with_index(file, |ix| { if let Some(e) = ix.map.get_mut(k) { e.item.cover = c; ix.dirty = true; } });
        progress(i + 1, total);
    }
    save_index(file);
}

fn stamp(p: &Path) -> Option<(u64, u64)> {
    let md = fs::metadata(p).ok()?;
    let m = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    Some((m, md.len()))
}

/// What to do with a file read for the first time (music covers, …).
pub struct Extras<'a> {
    pub ffmpeg: Option<&'a Path>,
    pub covers: Option<&'a Path>,
}

/// One file's item, from the index when it hasn't changed.
fn item_for(index_file: &Path, p: &Path, kind: &str, ex: &Extras) -> Option<MediaItem> {
    let (m, s) = stamp(p)?;
    let key = format!("{kind}|{}", p.display());
    // (a song or video read before FFmpeg was there, missing what FFmpeg can
    // tell (tags, length, picture size): read again now that it is)
    let stale_ff = |e: &Entry| !e.ff && ex.ffmpeg.is_some() && media::wants_ffmpeg(kind, &e.item);
    if let Some(mut hit) = with_index(index_file, |ix| ix.map.get(&key).filter(|e| e.m == m && e.s == s && e.v == INDEX_VERSION && !stale_ff(e)).map(|e| e.item.clone())) {
        // (its cover file was deleted meanwhile: read again from the song)
        if kind == "music" && hit.cover.as_deref().map(|c| !Path::new(c).is_file()).unwrap_or(false) {
            if let Some(c) = ex.covers {
                hit.cover = media::cache_cover(p, c, ex.ffmpeg);
                let h2 = hit.clone();
                with_index(index_file, |ix| { if let Some(e) = ix.map.get_mut(&key) { e.item = h2; ix.dirty = true; } });
            }
        }
        return Some(hit);
    }
    let mut item = media::media_item(p, if kind == "background" { "photo" } else { kind }, ex.ffmpeg, false)?;
    if kind == "music" {
        if let Some(c) = ex.covers { item.cover = media::cache_cover(p, c, ex.ffmpeg); }
    }
    with_index(index_file, |ix| { ix.map.insert(key, Entry { m, s, item: item.clone(), v: INDEX_VERSION, ff: ex.ffmpeg.is_some() }); ix.dirty = true; });
    Some(item)
}

// ------------------------------------------------------------- shortcuts ---

#[derive(Serialize, Deserialize)]
struct LinkFile { target: String }

pub fn read_link(p: &Path) -> Option<PathBuf> {
    let t = fs::read_to_string(p).ok()?;
    let l: LinkFile = serde_json::from_str(t.trim()).ok()?;
    Some(PathBuf::from(l.target))
}
pub fn write_link(p: &Path, target: &Path) -> std::io::Result<()> {
    if let Some(d) = p.parent() { fs::create_dir_all(d)?; }
    fs::write(p, serde_json::to_string(&LinkFile { target: target.display().to_string() }).unwrap_or_default())
}

// --------------------------------------------------------------- listing ---

/// Everything in `dirs` (the app's folders for `kind`): files and shortcuts,
/// subfolders included. `progress(done, total)` is called as files are read.
pub fn list(dirs: &[PathBuf], kind: &str, index_file: &Path, ex: &Extras, progress: &dyn Fn(usize, usize)) -> Vec<MediaItem> {
    let exts = media::kind_exts(if kind == "background" { "photo" } else { kind });
    // first the walk (cheap), then the reading (only new / changed files)
    let mut found: Vec<(PathBuf, PathBuf, Option<PathBuf>)> = Vec::new();   // (root, place, target-if-link)
    for d in dirs { walk(d, d, exts, &mut found, 0); }
    let total = found.len();
    let mut out = Vec::with_capacity(total);
    // (what's read is saved as it goes: closed halfway through a first long
    // read, the System carries on from there next time instead of from the start)
    let mut saved_at = std::time::Instant::now();
    for (i, (root, place, target)) in found.into_iter().enumerate() {
        if i % 25 == 0 { progress(i, total); }
        if saved_at.elapsed().as_secs() >= 5 { save_index(index_file); saved_at = std::time::Instant::now(); }
        let file = target.clone().unwrap_or_else(|| place.clone());
        let Some(mut item) = item_for(index_file, &file, kind, ex) else { continue };
        let parent = place.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        item.in_root = parent == root;
        item.folder = if item.in_root { None } else { parent.file_name().map(|n| n.to_string_lossy().to_string()) };
        if target.is_some() {
            // a shortcut: named like the file it stands for (Song.mp3.xmbl → Song.mp3)
            item.name = place.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or(item.name);
            item.link = Some(place.display().to_string());
        } else { item.link = None; }
        out.push(item);
    }
    progress(total, total);
    save_index(index_file);
    number_copies(out)
}

/// Files that are the same in every way (name or title, type, size and
/// everything read from them) but sit in different places: the one that has
/// been there longest keeps its name, the others become "Name (2)"...
/// (Sorted by name, each copy after the one it copies.)
fn number_copies(items: Vec<MediaItem>) -> Vec<MediaItem> {
    let keys: Vec<(String, u128, String)> = items.iter().map(|m| {
        let place = m.link.clone().unwrap_or_else(|| m.path.clone());
        let key = serde_json::to_string(&(
            m.title.as_deref().unwrap_or(&m.name).trim().to_lowercase(), &m.ext, m.size,
            (&m.artist, &m.album, &m.year, &m.genre, m.track, m.disc),
            (m.duration_secs, m.width, m.height))).unwrap_or_default();
        (key, crate::copies::born(Path::new(&place)), place)
    }).collect();
    let mut v: Vec<(MediaItem, u32)> = items.into_iter().zip(crate::copies::number(&keys)).collect();
    v.sort_by(|a, b| a.0.name.to_lowercase().cmp(&b.0.name.to_lowercase()).then(a.1.cmp(&b.1)));
    v.into_iter().map(|(mut m, n)| {
        if n > 1 {
            m.name = crate::copies::file_with_number(&m.name, n);
            if let Some(t) = &m.title { m.title = Some(crate::copies::with_number(t, n)); }
        }
        m
    }).collect()
}

/// A short fingerprint of what `list` would show for `dirs`: every file's (or
/// shortcut's) place, size and last change, found without opening any file.
/// The same fingerprint means the same list, so it only needs reading again
/// when this changes.
pub fn fingerprint(dirs: &[PathBuf], kind: &str) -> String {
    use std::hash::{Hash, Hasher};
    let exts = media::kind_exts(if kind == "background" { "photo" } else { kind });
    let mut found: Vec<(PathBuf, PathBuf, Option<PathBuf>)> = Vec::new();
    for d in dirs { walk(d, d, exts, &mut found, 0); }
    found.sort_by(|a, b| a.1.cmp(&b.1));
    // (a fixed-key hasher: the same files give the same fingerprint every time)
    let mut h = std::collections::hash_map::DefaultHasher::new();
    INDEX_VERSION.hash(&mut h);
    for (_, place, target) in &found {
        place.hash(&mut h);
        stamp(place).hash(&mut h);
        if let Some(t) = target { t.hash(&mut h); stamp(t).hash(&mut h); }
    }
    format!("{}-{:016x}", found.len(), h.finish())
}

fn walk(root: &Path, dir: &Path, exts: &[&str], out: &mut Vec<(PathBuf, PathBuf, Option<PathBuf>)>, depth: u32) {
    if depth > 12 { return; }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() { walk(root, &p, exts, out, depth + 1); continue; }
        let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        if ext == LINK_EXT {
            let Some(t) = read_link(&p) else { continue };
            let te = t.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if exts.contains(&te.as_str()) && t.is_file() { out.push((root.to_path_buf(), p, Some(t))); }
        } else if exts.contains(&ext.as_str()) {
            out.push((root.to_path_buf(), p, None));
        }
    }
}

// ------------------------------------------------------ file recognition ---

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LinkRec { pub target: String, pub link: String, pub source: String, pub kind: String }

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Record { pub entries: Vec<LinkRec> }

pub fn load_record(f: &Path) -> Record { fs::read_to_string(f).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default() }
fn save_record(f: &Path, r: &Record) { if let Ok(t) = serde_json::to_string_pretty(r) { let _ = fs::write(f, t); } }

fn safe(s: &str) -> String {
    let c: String = s.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let c = c.split_whitespace().collect::<Vec<_>>().join(" ");
    let c = c.trim_end_matches('.').trim().to_string();
    if c.is_empty() { "Folder".into() } else { c }
}

/// Make shortcuts in `kind_dir` for every `kind` file in `sources` that
/// doesn't have one yet. Returns how many were made.
pub fn sync_links(kind: &str, sources: &[String], kind_dir: &Path, record_file: &Path, progress: &dyn Fn(usize, usize)) -> usize {
    let exts = media::kind_exts(kind);
    let mut rec = load_record(record_file);
    let known: std::collections::HashSet<String> = rec.entries.iter().filter(|e| e.kind == kind).map(|e| e.target.to_lowercase()).collect();
    let mut todo: Vec<(String, PathBuf, PathBuf)> = Vec::new();   // (source, base, file)
    for src in sources {
        let sp = Path::new(src);
        if !sp.is_dir() { continue; }
        // the app's own folder as a source would point at itself
        if let (Ok(a), Ok(b)) = (sp.canonicalize(), kind_dir.canonicalize()) { if a.starts_with(&b) || b.starts_with(&a) { continue; } }
        let mut files = Vec::new();
        walk(sp, sp, exts, &mut files, 0);
        for (_, f, _) in files { todo.push((src.clone(), sp.to_path_buf(), f)); }
    }
    let total = todo.len();
    let mut made = 0;
    for (i, (src, base, f)) in todo.into_iter().enumerate() {
        if i % 50 == 0 { progress(i, total); }
        let fs_ = f.display().to_string();
        if known.contains(&fs_.to_lowercase()) { continue; }
        // content/<Kind>/<source name>/<the source's subfolders>/<file name>.xmbl
        let src_name = safe(&base.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Source".into()));
        let rel = f.parent().and_then(|p| p.strip_prefix(&base).ok()).map(|p| p.to_path_buf()).unwrap_or_default();
        let mut dir = kind_dir.join(&src_name);
        for c in rel.components() { dir = dir.join(safe(&c.as_os_str().to_string_lossy())); }
        let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let link = dir.join(format!("{name}.{LINK_EXT}"));
        if !link.exists() && write_link(&link, &f).is_err() { continue; }
        rec.entries.push(LinkRec { target: fs_, link: link.display().to_string(), source: src.clone(), kind: kind.into() });
        made += 1;
        // (saved as it goes: stopped halfway, the next time carries on)
        if made % 200 == 0 { save_record(record_file, &rec); }
    }
    progress(total, total);
    save_record(record_file, &rec);
    made
}

/// A source folder was removed: delete its shortcuts (only .xmbl files in the
/// app's folder) and forget them. Returns how many were deleted.
pub fn remove_source(kind: &str, source: &str, kind_dir: &Path, record_file: &Path) -> usize {
    let mut rec = load_record(record_file);
    let root = kind_dir.canonicalize().ok();
    let mut n = 0;
    rec.entries.retain(|e| {
        if e.kind != kind || e.source != source { return true; }
        let p = Path::new(&e.link);
        let inside = match (p.canonicalize(), root.as_ref()) { (Ok(a), Some(r)) => a.starts_with(r), _ => false };
        if inside && p.extension().map(|x| x == LINK_EXT).unwrap_or(false) && fs::remove_file(p).is_ok() { n += 1; }
        false
    });
    save_record(record_file, &rec);
    // folders the shortcuts lived in, now empty, go too
    prune_empty(kind_dir, kind_dir);
    n
}

fn prune_empty(root: &Path, dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(dir) else { return false };
    let mut empty = true;
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() { if !prune_empty(root, &p) { empty = false; } } else { empty = false; }
    }
    if empty && dir != root { let _ = fs::remove_dir(dir); }
    empty
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_are_listed_as_their_files() {
        let t = std::env::temp_dir().join(format!("xmb_ml_{}", std::process::id()));
        let _ = fs::remove_dir_all(&t);
        let src = t.join("src/Album A"); let lib = t.join("lib"); fs::create_dir_all(&src).unwrap(); fs::create_dir_all(&lib).unwrap();
        fs::write(src.join("pic.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        fs::write(lib.join("own.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        let rec = t.join("rec.json"); let ix = t.join("ix.json");
        let n = sync_links("photo", &[t.join("src").display().to_string()], &lib, &rec, &|_, _| {});
        assert_eq!(n, 1);
        assert!(lib.join("src/Album A/pic.png.xmbl").exists());
        // a second recognition makes nothing new
        assert_eq!(sync_links("photo", &[t.join("src").display().to_string()], &lib, &rec, &|_, _| {}), 0);
        let ex = Extras { ffmpeg: None, covers: None };
        let items = list(&[lib.clone()], "photo", &ix, &ex, &|_, _| {});
        assert_eq!(items.len(), 2);
        let l = items.iter().find(|i| i.link.is_some()).unwrap();
        assert_eq!(l.name, "pic.png");
        assert_eq!(l.folder.as_deref(), Some("Album A"));
        assert!(l.path.ends_with("pic.png"));
        assert_eq!(remove_source("photo", &t.join("src").display().to_string(), &lib, &rec), 1);
        assert!(!lib.join("src").exists());
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn old_index_entries_are_read_again() {
        let t = std::env::temp_dir().join(format!("xmb_iv_{}", std::process::id()));
        let _ = fs::remove_dir_all(&t); fs::create_dir_all(&t).unwrap();
        let f = t.join("pic.png"); fs::write(&f, b"\x89PNG\r\n\x1a\n0000").unwrap();
        let (m, sz) = stamp(&f).unwrap();
        // what an older version kept for this file (no version: 0)
        let stale = MediaItem { name: "STALE".into(), ..Default::default() };
        let mut map = HashMap::new();
        map.insert(format!("photo|{}", f.display()), serde_json::json!({ "m": m, "s": sz, "item": stale }));
        let ix = t.join("ix.json"); fs::write(&ix, serde_json::to_string(&map).unwrap()).unwrap();
        *index() = Index::default();
        let items = list(&[t.clone()], "photo", &ix, &Extras { ffmpeg: None, covers: None }, &|_, _| {});
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "pic.png");        // read again, not the old entry
        // and kept with the new version
        let saved: serde_json::Value = serde_json::from_str(&fs::read_to_string(&ix).unwrap()).unwrap();
        assert_eq!(saved[format!("photo|{}", f.display())]["v"], INDEX_VERSION);
        let _ = fs::remove_dir_all(&t);
    }
    #[test]
    fn same_files_are_numbered() {
        let t = std::env::temp_dir().join(format!("xmb_cp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&t);
        for d in ["A", "B", "C", "D"] { fs::create_dir_all(t.join(d)).unwrap(); }
        let png = b"\x89PNG\r\n\x1a\n0000".to_vec();
        // B's is the oldest, then A's: the same picture under the same name
        fs::write(t.join("B/pic.png"), &png).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(t.join("A/pic.png"), &png).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(t.join("D/pic.png"), &png).unwrap();
        // the same name but another size: a different file, left alone
        fs::write(t.join("C/pic.png"), b"\x89PNG\r\n\x1a\n1").unwrap();
        let ex = Extras { ffmpeg: None, covers: None };
        let items = list(&[t.clone()], "photo", &t.join("ix.json"), &ex, &|_, _| {});
        let name = |d: &str| items.iter().find(|i| i.folder.as_deref() == Some(d)).unwrap().name.clone();
        assert_eq!((name("B"), name("A"), name("D"), name("C")), ("pic.png".into(), "pic (2).png".into(), "pic (3).png".into(), "pic.png".into()));
        // listed by name, each copy after the one it copies
        let order: Vec<String> = items.iter().map(|i| i.name.clone()).collect();
        assert_eq!(&order[2..], &["pic (2).png".to_string(), "pic (3).png".to_string()]);
        let _ = fs::remove_dir_all(&t);
    }

    /// Times the listings on a big library in XMB_BENCH (Music / Photos /
    /// Videos / Games folders): the first time (nothing indexed) and again.
    #[test]
    fn bench_libraries() {
        let Ok(root) = std::env::var("XMB_BENCH") else { return };
        let root = PathBuf::from(root);
        let covers = root.join("covers");
        for (kind, dir) in [("music", "Music"), ("photo", "Photos"), ("video", "Videos")] {
            let ix = root.join(format!("ix_{kind}.json"));
            let _ = fs::remove_file(&ix); *index() = Index::default();
            let ex = Extras { ffmpeg: None, covers: Some(&covers) };
            let t = std::time::Instant::now();
            let a = list(&[root.join(dir)], kind, &ix, &ex, &|_, _| {});
            let cold = t.elapsed();
            *index() = Index::default();          // a new start: the index is read from disk
            let t = std::time::Instant::now();
            let b = list(&[root.join(dir)], kind, &ix, &ex, &|_, _| {});
            let warm_disk = t.elapsed();
            let t = std::time::Instant::now();
            let _ = list(&[root.join(dir)], kind, &ix, &ex, &|_, _| {});
            let warm = t.elapsed();
            let numbered = b.iter().filter(|m| m.name.contains(" (")).count();
            println!("BENCH {kind:6} {:5} files  first {:>8.1?}  next start {:>8.1?}  again {:>8.1?}  numbered as copies {}", a.len(), cold, warm_disk, warm, numbered);
        }
        let t = std::time::Instant::now();
        let g = crate::library::scan(&[root.join("Games").display().to_string()], None);
        println!("BENCH games  {:5} folders scan {:>8.1?}", g.len(), t.elapsed());
    }

    #[test]
    fn fingerprint_follows_the_files() {
        let t = std::env::temp_dir().join(format!("xmb_fp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&t); fs::create_dir_all(t.join("A")).unwrap();
        fs::write(t.join("A/a.png"), b"\x89PNG\r\n\x1a\n00").unwrap();
        fs::write(t.join("notes.txt"), b"not a picture").unwrap();
        let dirs = [t.clone()];
        let f1 = fingerprint(&dirs, "photo");
        assert_eq!(f1, fingerprint(&dirs, "photo"), "nothing changed: the same");
        assert!(f1.starts_with("1-"));
        fs::write(t.join("other.txt"), b"still not a picture").unwrap();
        assert_eq!(f1, fingerprint(&dirs, "photo"), "a file of another kind doesn't count");
        fs::write(t.join("A/b.png"), b"\x89PNG\r\n\x1a\n01").unwrap();
        let f2 = fingerprint(&dirs, "photo");
        assert!(f2 != f1 && f2.starts_with("2-"), "a new file");
        fs::write(t.join("A/b.png"), b"\x89PNG\r\n\x1a\n0123").unwrap();
        let f3 = fingerprint(&dirs, "photo");
        assert_ne!(f3, f2, "a file changed (its size)");
        fs::rename(t.join("A/b.png"), t.join("A/c.png")).unwrap();
        assert_ne!(fingerprint(&dirs, "photo"), f3, "a file renamed");
        fs::remove_file(t.join("A/c.png")).unwrap();
        assert_eq!(fingerprint(&dirs, "photo"), f1, "back to the same files: the same");
        let _ = fs::remove_dir_all(&t);
    }
    #[test]
    fn songs_read_without_ffmpeg_are_read_again_with_it() {
        // (needs an ffmpeg on PATH to make the WMA; skipped otherwise)
        let ff = std::path::PathBuf::from(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
        let root = std::env::temp_dir().join("xmb_wma_reread");
        let _ = fs::remove_dir_all(&root); fs::create_dir_all(&root).unwrap();
        let wma = root.join("song.wma");
        let made = std::process::Command::new(&ff).args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-c:a", "wmav2", "-metadata", "title=Song Title", "-metadata", "artist=Someone"]).arg(&wma).status().map(|s| s.success()).unwrap_or(false);
        if !made { return; }
        let ix = root.join("index.json");
        let without = list(&[root.clone()], "music", &ix, &Extras { ffmpeg: None, covers: None }, &|_, _| {});
        assert_eq!(without[0].title, None);
        let with = list(&[root.clone()], "music", &ix, &Extras { ffmpeg: Some(&ff), covers: None }, &|_, _| {});
        assert_eq!(with[0].title.as_deref(), Some("Song Title"));
        assert_eq!(with[0].artist.as_deref(), Some("Someone"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn videos_and_covers_read_without_ffmpeg_are_read_again_with_it() {
        // (needs an ffmpeg on PATH to make the files; skipped otherwise)
        let ff = std::path::PathBuf::from(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
        let root = std::env::temp_dir().join("xmb_ff_reread");
        let _ = fs::remove_dir_all(&root); fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| std::process::Command::new(&ff).args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).status().map(|s| s.success()).unwrap_or(false);
        // a video the built-in reader doesn't know (AVI)
        let vids = root.join("v"); fs::create_dir_all(&vids).unwrap();
        let avi = vids.join("clip.avi").to_string_lossy().to_string();
        if !run(&["-f", "lavfi", "-i", "testsrc=size=320x240:duration=3", "-c:v", "mpeg4", &avi]) { return; }
        let ix = root.join("vindex.json");
        let without = list(&[vids.clone()], "video", &ix, &Extras { ffmpeg: None, covers: None }, &|_, _| {});
        assert_eq!(without[0].duration_secs, None);
        let with = list(&[vids.clone()], "video", &ix, &Extras { ffmpeg: Some(&ff), covers: None }, &|_, _| {});
        assert_eq!(with[0].duration_secs, Some(3));
        assert_eq!((with[0].width, with[0].height), (Some(320), Some(240)));
        // a song whose cover only FFmpeg reads: no cover without it (and not
        // "none" for good), the cover with it
        let songs = root.join("s"); fs::create_dir_all(&songs).unwrap();
        let jpg = root.join("c.jpg").to_string_lossy().to_string();
        let wma = songs.join("song.wma").to_string_lossy().to_string();
        if !run(&["-f", "lavfi", "-i", "color=red:size=64x64", "-frames:v", "1", &jpg]) { return; }
        if !run(&["-f", "lavfi", "-i", "sine=duration=1", "-i", &jpg, "-map", "0", "-map", "1", "-c:a", "wmav2", "-c:v", "copy", "-disposition:v", "attached_pic", &wma]) { return; }
        let covers = root.join("covers"); fs::create_dir_all(&covers).unwrap();
        let sx = root.join("sindex.json");
        let without = list(&[songs.clone()], "music", &sx, &Extras { ffmpeg: None, covers: Some(&covers) }, &|_, _| {});
        let with = list(&[songs.clone()], "music", &sx, &Extras { ffmpeg: Some(&ff), covers: Some(&covers) }, &|_, _| {});
        if without[0].cover.is_none() { assert!(with[0].cover.is_some(), "the cover is read once FFmpeg is there"); }
        let _ = fs::remove_dir_all(&root);
    }
}
