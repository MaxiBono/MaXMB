//! Custom sections (System Settings > Sections).
//!
//! A section is a new category with its own subsections. Each subsection reads
//! the folders chosen for it (by default content/<Section>/<Subsection>).
//! Like games, every item has a folder of its own:
//!   • a game folder (game.json, info.txt, an .exe or a shortcut), read exactly
//!     like the Games folder;
//!   • an item folder holding one video, song or picture. Its "item.json" is
//!     made when the folder is first found: { "title": "…", "file": "…" }.
//!     icon.*, preview.* (a gif or a video), background.* and music.* put in
//!     the folder work like a game's.
//! A folder that holds item folders (not an item itself) is shown as a folder
//! of the section's folder type; `group` is its name ("" = none). A file put
//! loose in the section's own folder (content/<Section>) is given a folder of
//! its own first (named after it), and so are the files of a folder you made
//! there with several files in it (an album); elsewhere loose files aren't listed.

use crate::models::{Game, MediaItem};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemMeta {
    pub title: Option<String>,
    pub icon: Option<String>,
    pub gif: Option<String>,
    pub background: Option<String>,
    pub music: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionEntry {
    /// "game" | "video" | "music" | "photo"
    pub kind: String,
    /// the subfolder (directly under the subsection's folder) it's in; "" = none
    pub group: String,
    pub media: Option<MediaItem>,
    pub game: Option<Game>,
    pub meta: ItemMeta,
}

pub struct Ctx<'a> {
    pub icon_cache: &'a Path,
    pub covers: &'a Path,
    pub ffmpeg: Option<&'a Path>,
    pub video_icon: &'a dyn Fn(&Path) -> (Option<String>, Option<String>),
    /// loose files are given their own folder only inside this folder (content/)
    pub wrap_in: Option<&'a Path>,
}

pub fn list(roots: &[String], ctx: &Ctx) -> Vec<SectionEntry> {
    let mut out = Vec::new();
    for r in roots {
        let root = PathBuf::from(r);
        if !root.is_dir() { continue; }
        if ctx.wrap_in.map(|c| root.starts_with(c)).unwrap_or(false) { wrap_loose(&root); }
        walk(&root, "", 0, ctx, &mut out);
    }
    out
}

/// Every recognised file lying loose in `root` goes into a new folder named
/// after it (so it gets its item.json / game.json like the rest).
pub fn wrap_loose(root: &Path) {
    let Ok(rd) = fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_file() { continue; }
        let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        if kind_of(&ext).is_none() { continue; }
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let mut dir = root.join(safe_name(&stem));
        let mut n = 2;
        while dir.exists() { dir = root.join(format!("{} ({n})", safe_name(&stem))); n += 1; }
        if fs::create_dir_all(&dir).is_err() { continue; }
        let to = dir.join(p.file_name().unwrap_or_default());
        if fs::rename(&p, &to).is_err() { let _ = fs::remove_dir(&dir); }
    }
}

fn kind_of(ext: &str) -> Option<&'static str> {
    if crate::media::VIDEO_EXTS.contains(&ext) { Some("video") }
    else if crate::media::MUSIC_EXTS.contains(&ext) { Some("music") }
    else if crate::media::PHOTO_EXTS.contains(&ext) || crate::media::DOC_EXTS.contains(&ext) { Some("photo") }
    else if crate::media::APP_EXTS.contains(&ext) { Some("app") }
    else { None }
}

const ASSET_STEMS: [&str; 6] = ["icon", "preview", "background", "music", "icon0", "pic1"];

fn find_asset(dir: &Path, stem: &str, exts: &[&str]) -> Option<String> {
    let rd = fs::read_dir(dir).ok()?;
    let mut v: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
    v.sort();
    v.into_iter().find(|p| {
        p.file_stem().map(|s| s.to_string_lossy().eq_ignore_ascii_case(stem)).unwrap_or(false)
            && p.extension().map(|e| exts.contains(&e.to_string_lossy().to_lowercase().as_str())).unwrap_or(false)
    }).map(|p| p.display().to_string())
}

/// An item folder's main file (and its kind): the one item.json names, or
/// the first video / song / picture that isn't one of its icon, preview,
/// background or music files.
fn item_main(dir: &Path, json: Option<&Value>) -> Option<(PathBuf, &'static str)> {
    if let Some(f) = json.and_then(|j| j.get("file")).and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) {
        let p = dir.join(f.trim());
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if p.is_file() { if let Some(k) = kind_of(&ext).filter(|k| *k != "app") { return Some((p, k)); } }
    }
    let mut files: Vec<PathBuf> = fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
    files.sort();
    // videos first, then music, then pictures (a picture is often the cover)
    for want in ["video", "music", "photo"] {
        for p in &files {
            let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
            if ASSET_STEMS.contains(&stem.as_str()) { continue; }
            let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if kind_of(&ext) == Some(want) { return Some((p.clone(), want)); }
        }
    }
    None
}

fn walk(dir: &Path, group: &str, depth: u32, ctx: &Ctx, out: &mut Vec<SectionEntry>) {
    if depth > 12 { return; }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    for d in dirs {
        // a game folder
        if crate::library::is_game_dir(&d) {
            // (a program or script, not a PS3 game: program.json, its Format PC)
            if crate::ps3::game_at(&d).is_none() { crate::library::section_program(&d); }
            if let Some(game) = crate::library::parse_game(&d, None, Some(ctx.icon_cache)) {
                out.push(SectionEntry { kind: "game".into(), group: group.into(), media: None, game: Some(game), meta: ItemMeta::default() });
            }
            continue;
        }
        // an item folder (one video / song / picture)
        let jpath = d.join("item.json");
        let json: Option<Value> = fs::read_to_string(&jpath).ok().and_then(|t| serde_json::from_str(&t).ok());
        // a folder you made with several files in it (not an item): an album.
        // Each of its files gets a folder of its own inside it (as loose files
        // in the section's folder do), and it's shown as a folder of items
        if json.is_none() && loose_count(&d) >= 2 && ctx.wrap_in.map(|c| d.starts_with(c)).unwrap_or(false) {
            wrap_loose(&d);
            let g = if depth == 0 { d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() } else { group.to_string() };
            walk(&d, &g, depth + 1, ctx, out);
            continue;
        }
        if let Some((main, kind)) = item_main(&d, json.as_ref()) {
            let stem = main.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let file = main.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            // the item.json is made the first time (title + file), then it's the user's
            let mut j = match json { Some(Value::Object(m)) => m, _ => serde_json::Map::new() };
            let mut changed = false;
            if !j.contains_key("title") { j.insert("title".into(), Value::String(stem.clone())); changed = true; }
            if !j.contains_key("file") { j.insert("file".into(), Value::String(file)); changed = true; }
            if changed { let _ = fs::write(&jpath, serde_json::to_string_pretty(&Value::Object(j.clone())).unwrap_or_default()); }
            let Some(mut item) = crate::media::media_item(&main, kind, ctx.ffmpeg, depth == 0) else { continue };
            if kind == "video" { let (c, k) = (ctx.video_icon)(&main); item.cover = c; item.clip = k; }
            if kind == "music" { item.cover = crate::media::cache_cover(&main, ctx.covers, ctx.ffmpeg); }
            const IMG: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];
            let meta = ItemMeta {
                title: j.get("title").and_then(|t| t.as_str()).map(|t| t.trim().to_string()).filter(|t| !t.is_empty()),
                icon: find_asset(&d, "icon", IMG).or_else(|| find_asset(&d, "icon0", IMG)),
                gif: find_asset(&d, "preview", &["gif", "mp4", "webm", "mov", "m4v"]),
                background: find_asset(&d, "background", IMG).or_else(|| find_asset(&d, "pic1", IMG)),
                music: find_asset(&d, "music", &["flac", "wav", "ogg", "mp3", "opus", "m4a", "aac"]),
            };
            out.push(SectionEntry { kind: kind.into(), group: group.into(), media: Some(item), game: None, meta });
            continue;
        }
        // a folder of items: shown as a folder (its subfolders are flattened into it)
        let g = if depth == 0 { d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() } else { group.to_string() };
        walk(&d, &g, depth + 1, ctx, out);
    }
}

/// How many videos, songs, pictures and documents lie loose in a folder (its
/// icon / preview / background / music files aside).
fn loose_count(dir: &Path) -> usize {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).filter(|p| {
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        !ASSET_STEMS.contains(&stem.as_str()) && matches!(kind_of(&ext), Some(k) if k != "app")
    }).count()
}

/// A file / folder name made safe for Windows.
pub fn safe_name(s: &str) -> String {
    let t: String = s.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let t = t.trim().trim_end_matches('.').trim().to_string();
    if t.is_empty() { "Section".into() } else { t }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn items_need_their_own_folder() {
        let root = std::env::temp_dir().join("xmb_section_test");
        let _ = fs::remove_dir_all(&root);
        for d in ["Song", "Clip", "My Game", "Trips/Beach", "Trips/Hill"] { fs::create_dir_all(root.join(d)).unwrap(); }
        fs::write(root.join("loose.mp3"), b"x").unwrap();                // loose: not listed
        fs::write(root.join("Song").join("song.mp3"), b"x").unwrap();
        fs::write(root.join("Song").join("icon.png"), b"x").unwrap();
        fs::write(root.join("Clip").join("clip.mp4"), b"x").unwrap();
        fs::write(root.join("Clip").join("item.json"), r#"{"title":"My Clip"}"#).unwrap();
        fs::write(root.join("Clip").join("preview.gif"), b"x").unwrap();
        fs::write(root.join("My Game").join("Game.exe"), b"x").unwrap();
        fs::write(root.join("Trips/Beach").join("a.jpg"), b"x").unwrap();
        fs::write(root.join("Trips/Hill").join("b.jpg"), b"x").unwrap();
        let none = |_: &Path| (None, None);
        let ctx = Ctx { icon_cache: &root, covers: &root, ffmpeg: None, video_icon: &none, wrap_in: None };
        let v = list(&[root.display().to_string()], &ctx);
        let kinds: Vec<_> = v.iter().map(|e| format!("{}:{}", e.kind, e.group)).collect();
        assert_eq!(v.len(), 5, "{kinds:?}");
        assert_eq!(v.iter().filter(|e| e.kind == "photo" && e.group == "Trips").count(), 2);
        let song = v.iter().find(|e| e.kind == "music").unwrap();
        assert!(song.meta.icon.is_some());
        assert_eq!(song.meta.title.as_deref(), Some("song"));
        let clip = v.iter().find(|e| e.kind == "video").unwrap();
        assert_eq!(clip.meta.title.as_deref(), Some("My Clip"));
        assert!(clip.meta.gif.is_some());
        let j: Value = serde_json::from_str(&fs::read_to_string(root.join("Song").join("item.json")).unwrap()).unwrap();
        assert_eq!(j["file"], "song.mp3");
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    fn loose_files_get_a_folder() {
        let root = std::env::temp_dir().join("xmb_section_wrap");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("clip.mp4"), b"x").unwrap();
        fs::write(root.join("notes.txt"), b"x").unwrap();
        let none = |_: &Path| (None, None);
        let ctx = Ctx { icon_cache: &root, covers: &root, ffmpeg: None, video_icon: &none, wrap_in: Some(&root) };
        let v = list(&[root.display().to_string()], &ctx);
        assert!(root.join("clip").join("clip.mp4").is_file());
        assert!(root.join("clip").join("item.json").is_file());
        assert!(root.join("notes.txt").is_file());
        assert_eq!(v.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    fn a_folder_of_files_is_an_album() {
        let root = std::env::temp_dir().join("xmb_section_album");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Novels")).unwrap();
        fs::create_dir_all(root.join("One")).unwrap();
        fs::write(root.join("Novels").join("a.pdf"), b"x").unwrap();
        fs::write(root.join("Novels").join("b.pdf"), b"x").unwrap();
        fs::write(root.join("One").join("c.pdf"), b"x").unwrap();
        let none = |_: &Path| (None, None);
        let ctx = Ctx { icon_cache: &root, covers: &root, ffmpeg: None, video_icon: &none, wrap_in: Some(&root) };
        let v = list(&[root.display().to_string()], &ctx);
        assert_eq!(v.iter().filter(|e| e.group == "Novels").count(), 2);
        assert!(root.join("Novels").join("a").join("a.pdf").exists());
        assert_eq!(v.iter().filter(|e| e.group.is_empty()).count(), 1);   // "One": still one item
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    fn programs_get_program_json() {
        let root = std::env::temp_dir().join("xmb_section_prog");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Old")).unwrap();
        fs::create_dir_all(root.join("New")).unwrap();
        fs::write(root.join("Old").join("old.exe"), b"x").unwrap();
        fs::write(root.join("Old").join("game.json"), r#"{"title":"Old","isDisc":false,"console":"PS3"}"#).unwrap();
        fs::write(root.join("New").join("new.exe"), b"x").unwrap();
        let none = |_: &Path| (None, None);
        let ctx = Ctx { icon_cache: &root, covers: &root, ffmpeg: None, video_icon: &none, wrap_in: Some(&root) };
        let v = list(&[root.display().to_string()], &ctx);
        for d in ["Old", "New"] {
            assert!(root.join(d).join("program.json").exists() && !root.join(d).join("game.json").exists());
            let t = fs::read_to_string(root.join(d).join("program.json")).unwrap();
            assert!(!t.contains("isDisc") && t.contains("\"PC\""), "{t}");
        }
        assert!(v.iter().all(|e| e.game.as_ref().map(|g| g.console == "PC").unwrap_or(false)));
        let _ = fs::remove_dir_all(&root);
    }
}