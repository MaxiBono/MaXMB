//! Themes.
//!
//! * **PS3 themes**: real `.p3t` files in the Themes folder. Each one is
//!   unpacked once (see p3t.rs) into the cache folder, in a folder named after
//!   the theme and a checksum of the file; a changed file is unpacked again and
//!   a removed one's folder is deleted.
//! * **Icon Themes**: folders in the Icon folder, each a set of replacement
//!   icons named like the system's (`icon_game.png`, ...) with a small .json
//!   giving the theme's name (`{ "name": "My Icons" }`). Only the icons a theme
//!   has replace the system's; the others stay as they are.

use crate::p3t;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Bump when what's unpacked changes, so themes are unpacked again.
const UNPACK_VERSION: u64 = 3;   // 3: Overlay layers told apart; models with unreadable pieces still shown

fn stamp(p: &Path) -> Option<(u64, u64)> {
    let m = fs::metadata(p).ok()?;
    let t = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some((m.len(), t))
}

fn p3t_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), 0)];
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { if depth < 3 { stack.push((p, depth + 1)); } continue; }
            if p.extension().map(|x| x.to_string_lossy().eq_ignore_ascii_case("p3t")).unwrap_or(false) { out.push(p); }
        }
    }
    out.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    out
}

/// What the page needs to show a theme: its theme.json plus the files' paths.
fn describe(dir: &Path, meta: &Value, source: &Path) -> Value {
    let f = |k: &str| meta[k].as_str().filter(|s| !s.is_empty()).map(|s| dir.join(s).display().to_string());
    let mut icons = serde_json::Map::new();
    for id in meta["icons"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
        icons.insert(format!("{id}.png"), Value::from(dir.join("icons").join(format!("{id}.png")).display().to_string()));
    }
    let mut sounds = serde_json::Map::new();
    for (id, f) in meta["sounds"].as_object().into_iter().flatten() {
        if let Some(f) = f.as_str() { sounds.insert(id.clone(), Value::from(dir.join(f).display().to_string())); }
    }
    let mut pointers = serde_json::Map::new();
    for (id, p) in meta["pointers"].as_object().into_iter().flatten() {
        if let Some(f) = p["file"].as_str() {
            pointers.insert(id.clone(), json!({ "file": dir.join(f).display().to_string(), "x": p["x"], "y": p["y"] }));
        }
    }
    json!({
        "key": format!("p3t:{}", meta["id"].as_str().unwrap_or("")),
        "sounds": sounds, "pointers": pointers, "notification": f("notification"),
        "font": meta["font"], "color": meta["color"],
        "id": meta["id"], "name": meta["name"], "author": meta["author"], "comment": meta["comment"],
        "file": source.display().to_string(), "dir": dir.display().to_string(),
        "icons": icons, "background": f("background"), "screenshot": f("screenshot"), "thumb": f("thumb"),
        "dynamic": meta["dynamic"], "scene": meta["scene"],
    })
}

/// Every .p3t in the Themes folder (and its subfolders), unpacked when needed.
pub fn list_p3t(themes_dir: &Path, cache: &Path) -> Vec<Value> {
    // one at a time: two lists at once would unpack the same theme together,
    // and one could delete the other's folder as "not listed"
    static BUSY: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let index_file = cache.join("index.json");
    let old: HashMap<String, Value> = fs::read_to_string(&index_file).ok()
        .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut index = serde_json::Map::new();
    let mut keep = HashSet::new();
    let mut out = Vec::new();
    for path in p3t_files(themes_dir) {
        let key = path.display().to_string();
        let Some((len, time)) = stamp(&path) else { continue };
        // unpacked before, from this very file: use it as it is
        let known = old.get(&key).filter(|v| v["len"] == len && v["time"] == time && v["v"] == UNPACK_VERSION)
            .and_then(|v| v["id"].as_str()).map(|id| cache.join(id))
            .filter(|d| d.join("theme.json").is_file());
        let meta = match known.as_ref().and_then(|d| fs::read_to_string(d.join("theme.json")).ok()).and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            Some(m) => m,
            None => match p3t::install(&path, cache) {
                Ok(m) => m,
                Err(e) => { warn_log!("theme {} can't be read: {e}", path.display()); continue; }
            },
        };
        let Some(id) = meta["id"].as_str().map(String::from) else { continue };
        index.insert(key, json!({ "len": len, "time": time, "id": id, "v": UNPACK_VERSION }));
        if !keep.insert(id.clone()) { continue; }   // the same theme twice
        out.push(describe(&cache.join(&id), &meta, &path));
    }
    // themes whose file is gone: their unpacked folders go too
    if let Ok(rd) = fs::read_dir(cache) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if e.path().is_dir() && !keep.contains(&n) { let _ = fs::remove_dir_all(e.path()); }
        }
    }
    let _ = fs::write(&index_file, serde_json::to_vec_pretty(&Value::Object(index)).unwrap_or_default());
    crate::copies::number_listed(&mut out, "file");
    out
}

const PICTURES: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

/// Every Icon Theme: { key, name, dir, icons: { "icon_game.png": path } }.
/// A picture counts under its name with ".png" (so `icon_game.jpg` replaces
/// `icon_game.png` too).
/// The media players' icon folders inside an icon set, and the prefix their
/// icons get ("mp:mp_play.png", "vp:pause.png", "pv:zoom_in.png").
pub const PLAYER_FOLDERS: &[(&str, &str)] = &[("music player", "mp"), ("video player", "vp"), ("photo viewer", "pv")];

/// The pictures in an icon set's folder (and its Music Player / Video Player /
/// Photo Viewer folders), by name: "icon_game.png" → path. A picture counts
/// under its name with ".png" (so `icon_game.jpg` replaces `icon_game.png`
/// too); a .png wins over another picture with the same name.
pub fn collect_icons(dir: &Path) -> serde_json::Map<String, Value> {
    fn scan(d: &Path, prefix: &str, icons: &mut serde_json::Map<String, Value>) {
        let Ok(files) = fs::read_dir(d) else { return };
        for f in files.flatten() {
            let p = f.path();
            if p.is_dir() {
                if prefix.is_empty() {
                    let n = f.file_name().to_string_lossy().to_lowercase();
                    if let Some((_, pre)) = PLAYER_FOLDERS.iter().find(|(name, _)| *name == n.trim()) { scan(&p, pre, icons); }
                }
                continue;
            }
            let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !PICTURES.contains(&ext.as_str()) { continue; }
            let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
            let k = if prefix.is_empty() { format!("{stem}.png") } else { format!("{prefix}:{stem}.png") };
            if ext == "png" || !icons.contains_key(&k) { icons.insert(k, Value::from(p.display().to_string())); }
        }
    }
    let mut icons = serde_json::Map::new();
    scan(dir, "", &mut icons);
    icons
}

/// The name a pack's folder gives itself: "name" in a .json file inside it.
fn pack_name(d: &Path) -> Option<String> {
    fs::read_dir(d).ok().into_iter().flatten().flatten().map(|f| f.path())
        .filter(|p| p.extension().map(|x| x.to_string_lossy().eq_ignore_ascii_case("json")).unwrap_or(false))
        .find_map(|p| fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str::<Value>(s.trim_start_matches('\u{feff}')).ok())
            .and_then(|v| v["name"].as_str().map(|s| s.trim().to_string())).filter(|s| !s.is_empty()))
}

/// The sound effects a Sound Effects pack (or a Custom Theme) can replace, by
/// file name: the system's own sound files (cursor, enter, back, coldboot)
/// and the ones that share them today (error, ok: the enter sound; options: silent).
pub const SOUND_NAMES: &[&str] = &["cursor", "enter", "back", "coldboot", "error", "ok", "options"];
const SOUND_EXTS: &[&str] = &["ogg", "wav", "mp3", "flac", "m4a", "aac", "opus"];

/// The sounds in a folder, by name: "cursor" → path (an .ogg wins over
/// another file with the same name; other names are left out).
pub fn collect_sounds(dir: &Path) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    let Ok(files) = fs::read_dir(dir) else { return out };
    let mut files: Vec<PathBuf> = files.flatten().map(|f| f.path()).filter(|p| p.is_file()).collect();
    files.sort();
    for p in files {
        let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !SOUND_EXTS.contains(&ext.as_str()) { continue; }
        let stem = p.file_stem().map(|s| s.to_string_lossy().trim().to_lowercase()).unwrap_or_default();
        if !SOUND_NAMES.contains(&stem.as_str()) { continue; }
        if ext == "ogg" || !out.contains_key(&stem) { out.insert(stem, Value::from(p.display().to_string())); }
    }
    out
}

/// Every Sound Effects pack: { key, name, dir, sounds: { "cursor": path } }.
pub fn list_sound_packs(dir: &Path) -> Vec<Value> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    for d in dirs {
        let folder = d.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let sounds = collect_sounds(&d);
        if sounds.is_empty() { continue; }
        out.push(json!({ "key": format!("sound:{folder}"), "name": pack_name(&d).unwrap_or_else(|| folder.clone()), "dir": d.display().to_string(), "sounds": sounds }));
    }
    crate::copies::number_listed(&mut out, "dir");
    out
}

/// Every Icon Theme: { key, name, dir, icons: { "icon_game.png": path } }.
pub fn list_icon_themes(dir: &Path) -> Vec<Value> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    for d in dirs {
        let folder = d.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let name = pack_name(&d);
        let icons = collect_icons(&d);
        if icons.is_empty() { continue; }
        out.push(json!({ "key": format!("icon:{folder}"), "name": name.unwrap_or_else(|| folder.clone()), "dir": d.display().to_string(), "icons": icons }));
    }
    crate::copies::number_listed(&mut out, "dir");
    out
}

// ---- Custom Themes (.zip) ----------------------------------------------------
//
// A Custom Theme is a .zip in the Themes folder: theme.json
// ({ "format": "xmb-custom-theme", "name", "settings": {...} }) and the files
// its settings use (background, overlay, font, icons/...), referred to in the
// settings as "file:<path in the zip>". Each one is unpacked once, like a .p3t.

fn zip_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), 0)];
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { if depth < 3 { stack.push((p, depth + 1)); } continue; }
            if p.extension().map(|x| x.to_string_lossy().eq_ignore_ascii_case("zip")).unwrap_or(false) { out.push(p); }
        }
    }
    out.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    out
}

fn unzip_theme(zip_path: &Path, dest: &Path) -> Result<Value, String> {
    let f = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    // theme.json first: a zip without one isn't a theme
    let meta: Value = {
        let mut entry = z.by_name("theme.json").map_err(|_| "no theme.json".to_string())?;
        let mut s = String::new();
        std::io::Read::read_to_string(&mut entry, &mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(s.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?
    };
    if meta["settings"].is_null() { return Err("not a custom theme".into()); }
    let tmp = dest.with_extension("part");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    for i in 0..z.len() {
        let mut entry = z.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else { continue };   // (nothing outside its folder)
        let out = tmp.join(rel);
        if entry.is_dir() { let _ = fs::create_dir_all(&out); continue; }
        if let Some(parent) = out.parent() { let _ = fs::create_dir_all(parent); }
        let mut w = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut w).map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_dir_all(dest);
    fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(meta)
}

fn slug(name: &str) -> String {
    let mut s = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() { s.push(c) } else if !s.ends_with('-') { s.push('-') }
    }
    let s: String = s.trim_matches('-').chars().take(40).collect();
    if s.is_empty() { "theme".into() } else { s.trim_end_matches('-').to_string() }
}

/// Every Custom Theme (.zip) in the Themes folder, unpacked when needed.
pub fn list_custom(themes_dir: &Path, cache: &Path) -> Vec<Value> {
    static BUSY: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Vec::new();
    let mut keep = HashSet::new();
    for path in zip_files(themes_dir) {
        let Some((len, time)) = stamp(&path) else { continue };
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let id = format!("{}-{:x}-{:x}", slug(&stem), len, time);
        let dir = cache.join(&id);
        let meta = match fs::read_to_string(dir.join("theme.json")).ok().and_then(|s| serde_json::from_str::<Value>(s.trim_start_matches('\u{feff}')).ok()) {
            Some(m) => m,
            None => match unzip_theme(&path, &dir) { Ok(m) => m, Err(_) => continue },   // (other zips aren't themes)
        };
        keep.insert(id.clone());
        let icons = collect_icons(&dir.join("icons"));
        let sounds = collect_sounds(&dir.join("sounds"));
        let thumb = ["preview.png", "preview.jpg", "thumb.png"].iter().map(|f| dir.join(f)).find(|p| p.is_file()).map(|p| p.display().to_string());
        out.push(json!({
            "key": format!("custom:{id}"), "name": meta["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&stem),
            "author": meta["author"], "dir": dir.display().to_string(), "file": path.display().to_string(),
            "settings": meta["settings"], "icons": icons, "sounds": sounds, "thumb": thumb,
        }));
    }
    if let Ok(rd) = fs::read_dir(cache) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if e.path().is_dir() && !keep.contains(&n) { let _ = fs::remove_dir_all(e.path()); }
        }
    }
    crate::copies::number_listed(&mut out, "file");
    out
}

/// Make a Custom Theme: `files` are (path in the zip, file on disk).
pub fn create_custom(themes_dir: &Path, name: &str, settings: &Value, files: &[(String, PathBuf)]) -> Result<PathBuf, String> {
    let clean: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let clean = clean.trim().trim_end_matches('.').to_string();
    let base = if clean.is_empty() { "Custom Theme".to_string() } else { clean };
    let mut path = themes_dir.join(format!("{base}.zip"));
    let mut n = 2;
    while path.exists() { path = themes_dir.join(format!("{base} ({n}).zip")); n += 1; }
    let f = fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let meta = json!({ "format": "xmb-custom-theme", "version": 1, "name": name, "settings": settings });
    z.start_file("theme.json", opts).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut z, &serde_json::to_vec_pretty(&meta).unwrap_or_default()).map_err(|e| e.to_string())?;
    let mut done = HashSet::new();
    for (rel, src) in files {
        if !done.insert(rel.clone()) { continue; }
        let Ok(mut r) = fs::File::open(src) else { continue };
        // pictures, videos and fonts are already compressed
        let ext = src.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        let o = if ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mkv", "mov", "avi", "ogg", "mp3", "m4a", "aac", "opus", "flac", "woff", "woff2"].contains(&ext.as_str()) { stored } else { opts };
        z.start_file(rel.replace('\\', "/"), o).map_err(|e| e.to_string())?;
        std::io::copy(&mut r, &mut z).map_err(|e| e.to_string())?;
    }
    z.finish().map_err(|e| e.to_string())?;
    Ok(path)
}

// ---- Extracting a PS3 theme ----------------------------------------------------

/// Everything a PS3 theme has, as ordinary files, in `out_root/<theme name>`:
/// its icons, background, preview, own icon, sounds (WAV), mouse pointers,
/// notification box, animated scene (scene.json + script) and the scene's
/// textures as pictures.
pub fn extract_p3t(unpacked: &Path, out_root: &Path, name: &str) -> Result<PathBuf, String> {
    let clean: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let clean = clean.trim().trim_end_matches('.').to_string();
    let out = out_root.join(if clean.is_empty() { "Theme".to_string() } else { clean });
    let _ = fs::remove_dir_all(&out);
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    fn copy_dir(a: &Path, b: &Path) {
        let Ok(rd) = fs::read_dir(a) else { return };
        let _ = fs::create_dir_all(b);
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { copy_dir(&p, &b.join(e.file_name())); }
            else { let _ = fs::copy(&p, b.join(e.file_name())); }
        }
    }
    let rd = fs::read_dir(unpacked).map_err(|e| e.to_string())?;
    let mut textures = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        let n = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() { copy_dir(&p, &out.join(&n)); continue; }
        if n.ends_with(".z") { textures.push(p); continue; }
        let target = match n.as_str() { "theme.json" => "info.json".to_string(), "screenshot.png" => "preview.png".into(), "thumb.png" => "theme_icon.png".into(), _ => n.clone() };
        let _ = fs::copy(&p, out.join(target));
    }
    // the scene's textures, as pictures
    if !textures.is_empty() {
        let scene: Value = fs::read_to_string(unpacked.join("scene.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
        let tdir = out.join("textures");
        let _ = fs::create_dir_all(&tdir);
        for (i, meta) in scene["textures"].as_array().into_iter().flatten().enumerate() {
            let Ok(z) = fs::read(unpacked.join(format!("tex{i}.z"))) else { continue };
            let mut raw = Vec::new();
            if std::io::Read::read_to_end(&mut flate2::read::ZlibDecoder::new(&z[..]), &mut raw).is_err() { continue; }
            let (w, h) = (meta["width"].as_u64().unwrap_or(0) as usize, meta["height"].as_u64().unwrap_or(0) as usize);
            let Some(rgba) = crate::p3t::texture_rgba(meta["format"].as_str().unwrap_or(""), w, h, &raw) else { continue };
            let label = meta["id"].as_str().filter(|s| !s.is_empty()).map(slug).unwrap_or_else(|| format!("texture{i}"));
            if let Ok(png) = crate::p3t::encode_png(w as u32, h as u32, &rgba) { let _ = fs::write(tdir.join(format!("{i:02}-{label}.png")), png); }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_roundtrip() {
        let root = std::env::temp_dir().join(format!("xmbct-{}", std::process::id()));
        let themes = root.join("Themes"); let cache = root.join("cache");
        fs::create_dir_all(&themes).unwrap(); fs::create_dir_all(&cache).unwrap();
        let pic = root.join("bg.png"); fs::write(&pic, b"\x89PNGfake").unwrap();
        let p = create_custom(&themes, "My: Theme", &json!({"wallpaper": "file:media/bg.png", "iconColor": "#ff0000"}),
            &[("media/bg.png".into(), pic.clone()), ("icons/icon_game.png".into(), pic.clone())]).unwrap();
        assert!(p.file_name().unwrap().to_string_lossy().ends_with(".zip"));
        let l = list_custom(&themes, &cache);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0]["name"], "My: Theme");
        assert_eq!(l[0]["settings"]["iconColor"], "#ff0000");
        assert!(l[0]["icons"]["icon_game.png"].is_string());
        let dir = PathBuf::from(l[0]["dir"].as_str().unwrap());
        assert_eq!(fs::read(dir.join("media/bg.png")).unwrap(), b"\x89PNGfake");
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    fn sound_packs() {
        let root = std::env::temp_dir().join(format!("xmbsnd-{}", std::process::id()));
        let packs = root.join("Sound Effects"); let themes = root.join("Themes"); let cache = root.join("cache");
        let a = packs.join("Mine"); let b = packs.join("Empty");
        for d in [&a, &b, &themes, &cache] { fs::create_dir_all(d).unwrap(); }
        fs::write(a.join("pack.json"), r#"{"name": "My Sounds"}"#).unwrap();
        for f in ["cursor.wav", "Enter.ogg", "enter.mp3", "back.mp3", "coldboot.ogg", "ok.wav", "unknown.ogg", "cursor.txt"] { fs::write(a.join(f), f).unwrap(); }
        fs::write(b.join("pack.json"), r#"{"name": "Nothing"}"#).unwrap();
        let l = list_sound_packs(&packs);
        assert_eq!(l.len(), 1, "{l:#?}");
        assert_eq!(l[0]["name"], "My Sounds");
        let s = l[0]["sounds"].as_object().unwrap();
        let mut keys: Vec<&str> = s.keys().map(|k| k.as_str()).collect(); keys.sort();
        assert_eq!(keys, ["back", "coldboot", "cursor", "enter", "ok"]);
        assert!(s["enter"].as_str().unwrap().ends_with("Enter.ogg"));
        // a Custom Theme with them: listed back under "sounds"
        let files: Vec<(String, PathBuf)> = s.iter().map(|(k, v)| { let p = PathBuf::from(v.as_str().unwrap());
            (format!("sounds/{k}.{}", p.extension().unwrap().to_string_lossy()), p) }).collect();
        create_custom(&themes, "Loud", &json!({}), &files).unwrap();
        let c = list_custom(&themes, &cache);
        let cs = c[0]["sounds"].as_object().unwrap();
        assert_eq!(cs.len(), 5);
        assert_eq!(fs::read(cs["cursor"].as_str().unwrap()).unwrap(), b"cursor.wav");
        let _ = fs::remove_dir_all(&root);
    }
    /// Makes Custom Themes from the dummy files in XMB_DUMMY (when set) and
    /// reads them and the dummy Icon Themes back, writing what was listed to
    /// XMB_DUMMY/listing.json.
    #[test]
    fn dummy_packs() {
        let Ok(root) = std::env::var("XMB_DUMMY") else { return };
        let root = PathBuf::from(root);
        let (src, themes, cache) = (root.join("src"), root.join("Themes"), root.join("cache"));
        let f = |n: &str| src.join(n);
        create_custom(&themes, "Blue Night", &json!({
            "backgroundColor": "#102040", "wallpaper": "file:media/bg_blue.png", "wallpaperFit": "zoom",
            "iconColor": "#80c0ff", "iconStyle": "default", "waveColor": "#4080ff", "dotColor": "#ffffff",
            "wavesEnabled": true, "dotsEnabled": true, "font": "file:font/font.otf", "fontSize": 110, "textColor": "#e0f0ff",
            "waveParams": { "spline:speed": 1.5 } }),
            &[("media/bg_blue.png".into(), f("bg_blue.png")), ("font/font.otf".into(), f("font.otf")),
              ("icons/icon_game.png".into(), f("icons/icon_game.png")), ("icons/Music Player/mp_play.png".into(), f("icons/mp_play.png"))]).unwrap();
        create_custom(&themes, "Plain Purple", &json!({
            "backgroundColor": "#6a1b9a", "iconColor": "auto", "iconStyle": "glossy", "wavesEnabled": false, "dotsEnabled": false }), &[]).unwrap();
        create_custom(&themes, "Shuffle Show", &json!({
            "backgroundColor": "auto", "iconStyle": "flat", "iconColor": "#ffcc00", "bgShuffle": "pl:Mine", "bgInterval": 5,
            "bgPlaylists": [{ "name": "Mine", "items": ["file:media/bg_red.png", "file:media/bg_green.png"] }] }),
            &[("media/bg_red.png".into(), f("bg_red.png")), ("media/bg_green.png".into(), f("bg_green.png"))]).unwrap();
        // the same name again: a second file, not an overwrite
        create_custom(&themes, "Plain Purple", &json!({ "backgroundColor": "#4a148c" }), &[]).unwrap();
        let custom = list_custom(&themes, &cache);
        let icons = list_icon_themes(&root.join("Icon"));
        assert_eq!(custom.len(), 4, "{custom:#?}");
        // the same name twice: the first one made keeps it
        let pp: Vec<(&str, &str)> = custom.iter().filter(|t| t["name"].as_str().unwrap().starts_with("Plain Purple"))
            .map(|t| (t["name"].as_str().unwrap(), t["file"].as_str().unwrap())).collect();
        assert!(pp.contains(&("Plain Purple", themes.join("Plain Purple.zip").to_str().unwrap()))
            && pp.contains(&("Plain Purple (2)", themes.join("Plain Purple (2).zip").to_str().unwrap())), "{pp:?}");
        let blue = custom.iter().find(|t| t["name"] == "Blue Night").unwrap();
        assert!(blue["icons"]["icon_game.png"].is_string() && blue["icons"]["mp:mp_play.png"].is_string(), "{blue}");
        let bdir = PathBuf::from(blue["dir"].as_str().unwrap());
        assert!(bdir.join("media/bg_blue.png").is_file() && bdir.join("font/font.otf").is_file());
        let show = custom.iter().find(|t| t["name"] == "Shuffle Show").unwrap();
        assert_eq!(show["settings"]["bgPlaylists"][0]["items"].as_array().unwrap().len(), 2);
        assert_eq!(icons.len(), 3, "{icons:#?}");
        let red = icons.iter().find(|t| t["name"] == "Dummy Red Icons").unwrap();
        for k in ["icon_game.png", "mp:mp_play.png", "mp:mp_pause.png", "vp:pause.png", "vp:play.png", "pv:zoom_in.png"] {
            assert!(red["icons"][k].is_string(), "{k} missing in {red}");
        }
        let only = icons.iter().find(|t| t["name"] == "Dummy Players Only").unwrap();
        assert_eq!(only["icons"].as_object().unwrap().len(), 3);
        let jpg = icons.iter().find(|t| t["name"] == "Dummy Jpg").unwrap();
        assert!(jpg["icons"]["icon_video.png"].as_str().unwrap().ends_with(".jpg"));
        // listing again uses what was unpacked (and keeps it)
        assert_eq!(list_custom(&themes, &cache).len(), 4);
        fs::write(root.join("listing.json"), serde_json::to_vec_pretty(&json!({ "custom": custom, "icon": icons })).unwrap()).unwrap();
    }
    /// A full Custom Theme as the app sends it (XMB_CT_JSON: { name, settings,
    /// files } from Create Custom Theme, paths relative to XMB_CT_BASE), plus a
    /// background, font and icons: made, listed back and checked.
    #[test]
    fn custom_full_with_sounds() {
        let (Ok(js), Ok(base)) = (std::env::var("XMB_CT_JSON"), std::env::var("XMB_CT_BASE")) else { return };
        let v: Value = serde_json::from_str(&fs::read_to_string(js).unwrap()).unwrap();
        let root = std::env::temp_dir().join(format!("xmbfull-{}", std::process::id()));
        let (themes, cache) = (root.join("Themes"), root.join("cache"));
        fs::create_dir_all(&themes).unwrap(); fs::create_dir_all(&cache).unwrap();
        let pic = root.join("bg.png"); fs::write(&pic, b"\x89PNGbg").unwrap();
        let font = root.join("f.otf"); fs::write(&font, b"OTTOfont").unwrap();
        let mut settings = v["settings"].clone();
        settings["wallpaper"] = json!("file:media/bg.png"); settings["font"] = json!("file:font/f.otf");
        let mut files: Vec<(String, PathBuf)> = v["files"].as_object().unwrap().iter()
            .map(|(k, p)| (k.clone(), Path::new(&base).join(p.as_str().unwrap().trim_start_matches("./")))).collect();
        files.push(("media/bg.png".into(), pic)); files.push(("font/f.otf".into(), font.clone()));
        files.push(("icons/icon_game.png".into(), root.join("bg.png"))); files.push(("icons/Music Player/mp_play.png".into(), root.join("bg.png")));
        let zip = create_custom(&themes, v["name"].as_str().unwrap(), &settings, &files).unwrap();
        let l = list_custom(&themes, &cache);
        assert_eq!(l.len(), 1);
        let t = &l[0];
        let sounds = t["sounds"].as_object().unwrap();
        let mut names: Vec<&str> = sounds.keys().map(|k| k.as_str()).collect(); names.sort();
        println!("zip: {} ({} bytes)\nsounds: {names:?}\nicons: {:?}\nsettings: {}", zip.display(), fs::metadata(&zip).unwrap().len(),
            t["icons"].as_object().unwrap().keys().collect::<Vec<_>>(), t["settings"].as_object().unwrap().len());
        for (k, p) in v["files"].as_object().unwrap() {
            let name = k.trim_start_matches("sounds/").rsplit_once('.').unwrap().0;
            let orig = fs::read(Path::new(&base).join(p.as_str().unwrap().trim_start_matches("./"))).unwrap();
            assert_eq!(fs::read(sounds[name].as_str().unwrap()).unwrap(), orig, "{name}");
        }
        assert!(t["icons"]["icon_game.png"].is_string() && t["icons"]["mp:mp_play.png"].is_string());
        let dir = PathBuf::from(t["dir"].as_str().unwrap());
        assert!(dir.join("media/bg.png").is_file() && dir.join("font/f.otf").is_file());
        assert_eq!(t["settings"]["wallpaper"], "file:media/bg.png");
        let _ = fs::remove_dir_all(&root);
    }
    /// Extracts the unpacked themes in P3T_TEST_OUT (when set) to P3T_EXTRACT_OUT.
    #[test]
    fn extract_real() {
        let (Ok(dir), Ok(out)) = (std::env::var("P3T_TEST_OUT"), std::env::var("P3T_EXTRACT_OUT")) else { return };
        for e in fs::read_dir(dir).unwrap().flatten() {
            if e.path().join("theme.json").is_file() {
                let p = extract_p3t(&e.path(), Path::new(&out), &e.file_name().to_string_lossy()).unwrap();
                assert!(p.join("textures").is_dir());
            }
        }
    }
}
