//! Scans game library folders and builds `Game` records.
//!
//! A folder counts as a game when it contains a `game.json`, an `info.txt`,
//! an `.exe` or a shortcut (`.lnk` / `.url`). Game folders can sit straight in
//! the Games folder or inside another folder: that outer folder's name is the
//! games' Album.
//!
//! `game.json` holds: title, parentalControl (1-11, only ever set by hand),
//! created (the .exe / .lnk's last-modified date), size (only set by hand),
//! version, starts (the older of the .exe / .lnk's two dates; created is the newer), isDisc and
//! console (PS3 unless changed). When a game has no game.json (or an older one
//! missing these keys) the missing values are read from the game once and
//! written to the file; after that the file is the user's to edit.

use crate::models::{Game, GameMeta};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Scan every configured library path and return games sorted by title.
///
/// `icon_cache`: where icons pulled out of shortcuts are kept (a folder that
/// holds only a shortcut uses the shortcut's icon and name).
pub fn scan(paths: &[String], icon_cache: Option<&Path>) -> Vec<Game> {
    let mut games = Vec::new();
    for base in paths {
        let read = match fs::read_dir(base) {
            Ok(r) => r,
            Err(_) => continue, // path missing / unreadable -> skip, don't fail
        };
        for entry in read.flatten() {
            let p = entry.path();
            if !p.is_dir() { continue; }
            if is_game_dir(&p) {
                if let Some(game) = parse_game(&p, None, icon_cache) { games.push(game); }
            } else if let Ok(inner) = fs::read_dir(&p) {
                // an album: a folder of game folders
                let album = p.file_name().map(|n| n.to_string_lossy().to_string());
                for e in inner.flatten() {
                    let gp = e.path();
                    if gp.is_dir() && is_game_dir(&gp) {
                        if let Some(game) = parse_game(&gp, album.clone(), icon_cache) { games.push(game); }
                    }
                }
            }
        }
    }
    resolve_disc(&mut games);
    let keys: Vec<(String, u128, String)> = games.iter()
        .map(|g| (g.title.trim().to_lowercase(), crate::copies::born(Path::new(&g.folder)), g.folder.clone())).collect();
    for (g, n) in games.iter_mut().zip(crate::copies::number(&keys)) { g.copy = n; }
    games.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()).then(a.copy.cmp(&b.copy)));
    games
}

/// Only one game can be the disc: the one whose game.json was set most
/// recently wins, the others are switched back to false (in their files too).
fn resolve_disc(games: &mut [Game]) {
    let discs: Vec<usize> = (0..games.len()).filter(|&i| games[i].is_disc).collect();
    if discs.len() <= 1 { return; }
    let mtime = |g: &Game| fs::metadata(Path::new(&g.folder).join("game.json")).and_then(|m| m.modified()).ok();
    let keep = *discs.iter().max_by_key(|&&i| mtime(&games[i])).unwrap();
    for &i in &discs {
        if i == keep { continue; }
        games[i].is_disc = false;
        let _ = patch_meta(Path::new(&games[i].folder), &[("isDisc", Value::Bool(false))]);
    }
}

pub(crate) fn is_game_dir(dir: &Path) -> bool {
    dir.join("game.json").exists() || dir.join(PROGRAM_JSON).exists() || dir.join("info.txt").exists() || detect_launch(dir).is_some() || crate::ps3::game_at(dir).is_some()
}

/// A program in a custom section keeps its details in program.json (a game's
/// game.json without what only games use, such as isDisc).
pub(crate) const PROGRAM_JSON: &str = "program.json";
pub(crate) fn is_program(dir: &Path) -> bool { dir.join(PROGRAM_JSON).exists() }
pub(crate) fn meta_path(dir: &Path) -> PathBuf { if is_program(dir) { dir.join(PROGRAM_JSON) } else { dir.join("game.json") } }
/// what only games use (left out of a program's program.json)
const GAME_ONLY: [&str; 1] = ["isDisc"];

/// Read game.json (program.json) as a JSON object (empty when missing / unreadable).
pub(crate) fn read_meta(dir: &Path) -> Option<Map<String, Value>> {
    let text = fs::read_to_string(meta_path(dir)).ok()?;
    match serde_json::from_str::<Value>(&text).ok()? { Value::Object(m) => Some(m), _ => None }
}
/// game.json is written with its keys in the order below (then any others).
pub(crate) fn write_meta(dir: &Path, m: &Map<String, Value>) -> std::io::Result<()> {
    let prog = is_program(dir);
    let skip = |k: &str| prog && GAME_ONLY.contains(&k);
    let mut order: Vec<&String> = KEYS.iter().filter_map(|k| m.get_key_value(*k).map(|(k, _)| k)).filter(|k| !skip(k)).collect();
    for k in m.keys() { if !KEYS.contains(&k.as_str()) && !skip(k) { order.push(k); } }
    let mut out = String::from("{\n");
    for (i, k) in order.iter().enumerate() {
        let v = serde_json::to_string_pretty(&m[k.as_str()]).unwrap_or_else(|_| "null".into()).replace('\n', "\n  ");
        out += &format!("  {}: {}{}\n", serde_json::to_string(k).unwrap_or_default(), v, if i + 1 < order.len() { "," } else { "" });
    }
    out += "}";
    fs::write(meta_path(dir), out)
}
/// A program or script in a custom section: its details go in program.json,
/// made once with the Format PC (an older game.json is moved into it, the
/// Format kept if it was chosen there, and what only games use left out), so
/// a Format chosen afterwards in Game Information stays.
pub(crate) fn section_program(dir: &Path) {
    if is_program(dir) { return; }
    let gj = dir.join("game.json");
    let mut m: Map<String, Value> = fs::read_to_string(&gj).ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default();
    let chosen = m.remove("sectionFormat").is_some();
    if !chosen { m.insert("console".into(), Value::String("PC".into())); }
    for k in GAME_ONLY { m.remove(k); }
    if fs::write(dir.join(PROGRAM_JSON), "{}").is_err() { return; }
    if write_meta(dir, &m).is_ok() && gj.exists() { let _ = fs::remove_file(&gj); }
}
/// Set some keys in a game's game.json (creating it if needed).
pub fn patch_meta(dir: &Path, kv: &[(&str, Value)]) -> std::io::Result<()> {
    let mut m = read_meta(dir).unwrap_or_default();
    for (k, v) in kv { m.insert((*k).to_string(), v.clone()); }
    write_meta(dir, &m)
}

const KEYS: [&str; 8] = ["title", "parentalControl", "created", "size", "version", "starts", "isDisc", "console"];
const LEGACY: [&str; 6] = ["description", "developer", "publisher", "releaseDate", "genre", "players"];

pub(crate) fn parse_game(dir: &Path, album: Option<String>, icon_cache: Option<&Path>) -> Option<Game> {
    let folder_name = dir.file_name()?.to_string_lossy().to_string();
    let info_txt = dir.join("info.txt");
    // a folder holding just a shortcut (no exe) is named after the shortcut
    let shortcut = if first_with_ext(dir, "exe").is_none() {
        first_with_ext(dir, "lnk").or_else(|| first_with_ext(dir, "url"))
    } else { None };

    let mut meta = read_meta(dir);
    let had_json = meta.is_some();
    let legacy_txt = if !had_json && info_txt.exists() { Some(parse_info_txt(&info_txt)) } else { None };
    let m = meta.get_or_insert_with(Map::new);

    let launch = m.get("launch").and_then(|v| v.as_str()).map(|s| s.to_string()).filter(|s| !s.trim().is_empty())
        .or_else(|| legacy_txt.as_ref().and_then(|t| t.launch.clone()))
        .or_else(|| detect_launch(dir))
        .unwrap_or_default();

    // scrape whatever game.json doesn't have yet (only once: it's written back)
    let prog = is_program(dir);
    if KEYS.iter().filter(|k| !(prog && GAME_ONLY.contains(*k))).any(|k| !m.contains_key(*k)) || LEGACY.iter().any(|k| m.contains_key(*k)) {
        // files from before "starts" existed had their size worked out by the
        // system: Size is now only ever set by hand, so it starts blank
        if !m.contains_key("starts") { m.insert("size".into(), Value::String(String::new())); }
        let target = launch_path(dir, &launch);
        let s = scrape(target.as_deref(), &folder_name, shortcut.as_deref(), legacy_txt.as_ref());
        for (k, v) in s { m.entry(k).or_insert(v); }
        for k in LEGACY { m.remove(k); }
        if legacy_txt.as_ref().and_then(|t| t.launch.as_ref()).is_some() && !m.contains_key("launch") {
            m.insert("launch".into(), Value::String(launch.clone()));
        }
        let _ = write_meta(dir, m);
    }

    // where the game / program comes from: the folder its .exe is in (through
    // the app's own shortcut too), or the folder a Windows shortcut (.lnk)
    // points to (kept up to date with the shortcut)
    if let Some(src) = source_dir(dir, &launch, shortcut.as_deref()) {
        let is_lnk = launch.to_lowercase().ends_with(".lnk") || shortcut.is_some();
        let now = m.get("sourceDir").and_then(|v| v.as_str()).map(str::to_string);
        if now.is_none() || (is_lnk && now.as_deref() != Some(src.as_str())) {
            m.insert("sourceDir".into(), Value::String(src));
            let _ = write_meta(dir, m);
        }
    }

    let gs = |k: &str| m.get(k).and_then(|v| v.as_str()).map(|s| s.trim().to_string()).unwrap_or_default();
    let title = Some(gs("title")).filter(|s| !s.is_empty()).unwrap_or_else(|| folder_name.clone());
    let pc = m.get("parentalControl").and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())))
        .map(|n| n.clamp(1, 11) as u32);
    let args = m.get("args").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let console = Some(gs("console")).filter(|s| !s.is_empty()).unwrap_or_else(|| (if prog { "PC" } else { "PS3" }).into());

    // no icon file: the .exe's / shortcut's own icon
    let own_icon = || -> Option<String> {
        let cache = icon_cache?;
        let target = launch_path(dir, &launch).or_else(|| shortcut.as_ref().map(|s| dir.join(s)))?;
        crate::gamesrc::shortcut_icon(&target, cache)
    };
    let icon = find_first(dir, &["icon.png", "icon.jpg", "icon.jpeg", "icon.webp", "icon.gif", "ICON0.PNG"]).or_else(own_icon);
    Some(Game {
        id: slug(&format!("{}-{}", album.clone().unwrap_or_default(), folder_name)),
        folder: dir.display().to_string(),
        title,
        album,
        parental_control: pc,
        created: gs("created"),
        size: gs("size"),
        version: gs("version"),
        starts: gs("starts"),
        is_disc: m.get("isDisc").and_then(|v| v.as_bool()).unwrap_or(false),
        console,
        options_band: m.get("optionsBand").and_then(|v| v.as_bool()),
        hide_title: m.get("hideTitleOnBackground").and_then(|v| v.as_bool()),
        launch,
        args,
        icon,
        background: find_first(
            dir,
            &["background.png", "background.jpg", "background.jpeg", "background.webp", "PIC1.PNG"],
        ),
        preview: find_first(dir, &["preview.mp4", "preview.webm", "preview.mov", "preview.gif"]),
        // Background music accepts lossless + common lossy formats (the webview
        // decodes flac/wav/m4a/aac in addition to ogg/mp3/opus).
        music: find_first(
            dir,
            &["music.flac", "music.wav", "music.ogg", "music.mp3", "music.opus", "music.m4a", "music.aac"],
        ),
        copy: 1,
    })
}

/// The folder a game comes from (see `parse_game`).
fn source_dir(dir: &Path, launch: &str, shortcut: Option<&str>) -> Option<String> {
    let file = if launch.trim().is_empty() || launch.contains("://") {
        shortcut.map(|s| dir.join(s))
    } else {
        let p = PathBuf::from(launch.trim().trim_matches('"'));
        Some(if p.is_absolute() { p } else { dir.join(p) })
    }?;
    let ext = file.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let target = match ext.as_str() {
        "lnk" => PathBuf::from(crate::gamesrc::parse_lnk(&fs::read(&file).ok()?)?.target?),
        e if e == crate::medialib::LINK_EXT => crate::medialib::read_link(&file)?,
        _ => file,
    };
    if target.display().to_string().contains("://") { return None; }
    target.parent().map(|p| p.display().to_string()).filter(|s| !s.is_empty())
}

/// The file `launch` points at (relative to the game folder, or absolute).
fn launch_path(dir: &Path, launch: &str) -> Option<PathBuf> {
    if launch.trim().is_empty() || launch.contains("://") { return None; }
    let p = PathBuf::from(launch.trim().trim_matches('"'));
    let p = if p.is_absolute() { p } else { dir.join(p) };
    // the app's own shortcut (.xmbl): the file it points at
    if p.extension().map(|e| e.to_string_lossy().eq_ignore_ascii_case(crate::medialib::LINK_EXT)).unwrap_or(false) {
        return crate::medialib::read_link(&p).filter(|t| t.exists());
    }
    p.exists().then_some(p)
}

/// The values read from the game itself (each only used for a missing key).
fn scrape(target: Option<&Path>, folder_name: &str, shortcut: Option<&str>,
          txt: Option<&GameMeta>) -> Vec<(String, Value)> {
    let mut out: Vec<(String, Value)> = Vec::new();
    // Title: info.txt, then the shortcut's name, then the folder's name
    let title = txt.and_then(|t| t.title.clone()).filter(|s| !s.trim().is_empty())
        .or_else(|| shortcut.and_then(|f| Path::new(f).file_stem().map(|s| crate::gamesrc::clean_title(&s.to_string_lossy()))))
        .unwrap_or_else(|| crate::gamesrc::clean_title(folder_name));
    out.push(("title".into(), title.into()));
    out.push(("parentalControl".into(), Value::Null));
    // the .exe / .lnk's two dates (made, last changed): the older one is
    // Starts, the newer one Created
    let md = target.and_then(|t| fs::metadata(t).ok());
    let (a, b) = (md.as_ref().and_then(|m| m.created().ok()), md.as_ref().and_then(|m| m.modified().ok()));
    let (old, new) = match (a, b) {
        (Some(x), Some(y)) => if x <= y { (Some(x), Some(y)) } else { (Some(y), Some(x)) },
        (x, y) => (x.or(y), y.or(x)),
    };
    out.push(("created".into(), new.map(fmt_local).unwrap_or_default().into()));
    out.push(("starts".into(), old.map(fmt_local).unwrap_or_default().into()));
    // Size: never worked out (blank until set by hand)
    out.push(("size".into(), "".into()));
    // the real program behind a shortcut (for its version)
    let real: Option<PathBuf> = target.and_then(|t| {
        let ext = t.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if ext == "lnk" {
            let info = crate::gamesrc::parse_lnk(&fs::read(t).ok()?)?;
            let p = PathBuf::from(info.target?.trim().trim_matches('"'));
            p.exists().then_some(p)
        } else if ext == "exe" { Some(t.to_path_buf()) } else { None }
    });
    let version = txt.and_then(|t| t.version.clone()).filter(|s| !s.trim().is_empty())
        .or_else(|| real.as_ref().and_then(|r| {
            let vi = crate::gamesrc::version_info(r);
            vi.product_version.or(vi.file_version).map(|v| v.trim().to_string())
        }))
        .unwrap_or_default();
    out.push(("version".into(), version.into()));
    out.push(("isDisc".into(), false.into()));
    out.push(("console".into(), "PS3".into()));
    out
}

/// "2026-04-09 07:36" in local time
fn fmt_local(t: std::time::SystemTime) -> String {
    let dt: chrono::DateTime<chrono::Local> = t.into();
    dt.format("%Y-%m-%d %H:%M").to_string()
}

/// Minimal `key: value` parser for the `info.txt` fallback format.
fn parse_info_txt(path: &Path) -> GameMeta {
    let mut m = GameMeta::default();
    let Ok(text) = fs::read_to_string(path) else {
        return m;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let v = v.trim().to_string();
        match k.trim().to_lowercase().as_str() {
            "title" | "name" => m.title = Some(v),
            "description" | "desc" => m.description = Some(v),
            "version" => m.version = Some(v),
            "developer" | "dev" => m.developer = Some(v),
            "publisher" => m.publisher = Some(v),
            "releasedate" | "release_date" | "date" => m.release_date = Some(v),
            "genre" => m.genre = Some(v),
            "players" => m.players = Some(v),
            "launch" | "exe" => m.launch = Some(v),
            _ => {}
        }
    }
    m
}

/// Return the absolute path of the first candidate filename that exists,
/// matched case-insensitively so `Icon.PNG` still resolves.
fn find_first(dir: &Path, candidates: &[&str]) -> Option<String> {
    let entries: Vec<_> = fs::read_dir(dir).ok()?.flatten().collect();
    for cand in candidates {
        let want = cand.to_lowercase();
        for e in &entries {
            if e.file_name().to_string_lossy().to_lowercase() == want {
                return Some(e.path().display().to_string());
            }
        }
    }
    None
}

/// Auto-detect a launch target when `game.json` doesn't specify one.
/// Preference order: `.exe` (direct), then `.lnk`, then `.url` (shortcuts).
/// Returns a bare filename relative to the folder.
fn detect_launch(dir: &Path) -> Option<String> {
    // a program first, then a shortcut, then a script
    for ext in crate::media::APP_EXTS {
        if let Some(name) = first_with_ext(dir, ext) {
            return Some(name);
        }
    }
    first_with_ext(dir, crate::medialib::LINK_EXT)
}

/// First file in `dir` with the given extension (case-insensitive),
/// returned as a bare filename relative to the folder.
fn first_with_ext(dir: &Path, ext: &str) -> Option<String> {
    let want = ext.to_lowercase();
    for e in fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.extension()
            .map(|x| x.to_string_lossy().to_lowercase() == want)
            .unwrap_or(false)
        {
            return Some(e.file_name().to_string_lossy().to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_is_url_safe() {
        assert_eq!(slug("Uncharted 2: Among Thieves!"), "uncharted-2-among-thieves");
        assert_eq!(slug("  Ratchet & Clank  "), "ratchet-clank");
    }

    #[test]
    fn info_txt_parses_key_values() {
        let dir = std::env::temp_dir().join("xmb_info_test");
        let _ = fs::create_dir_all(&dir);
        let f = dir.join("info.txt");
        fs::write(&f, "title: Demo Game\nlaunch: demo.exe\nversion: 2.0\n").unwrap();
        let m = parse_info_txt(&f);
        assert_eq!(m.title.as_deref(), Some("Demo Game"));
        assert_eq!(m.launch.as_deref(), Some("demo.exe"));
        assert_eq!(m.version.as_deref(), Some("2.0"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_reads_sample_game_and_resolves_assets() {
        // Build a temp game folder mirroring the real spec.
        let dir = std::env::temp_dir().join("xmb_scan_test");
        let game = dir.join("My Game");
        let _ = fs::create_dir_all(&game);
        fs::write(
            game.join("game.json"),
            r#"{"title":"My Game","launch":"Game.exe","version":"1.0"}"#,
        )
        .unwrap();
        fs::write(game.join("icon.png"), b"x").unwrap();
        fs::write(game.join("background.png"), b"x").unwrap();
        fs::write(game.join("Game.exe"), b"x").unwrap();

        let games = scan(&[dir.to_string_lossy().to_string()], None);
        assert_eq!(games.len(), 1);
        let g = &games[0];
        assert_eq!(g.title, "My Game");
        assert_eq!(g.launch, "Game.exe");
        assert!(g.icon.is_some(), "icon should resolve");
        assert!(g.background.is_some(), "background should resolve");
        assert!(g.preview.is_none(), "no preview present");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn album_folders_and_meta_are_written() {
        let dir = std::env::temp_dir().join("xmb_album_scan_test");
        let _ = fs::remove_dir_all(&dir);
        let a = dir.join("Favourites").join("Game A");
        let b = dir.join("Game B");
        fs::create_dir_all(&a).unwrap(); fs::create_dir_all(&b).unwrap();
        fs::write(a.join("A.exe"), b"xx").unwrap();
        fs::write(b.join("game.json"), r#"{"title":"B","launch":"B.exe","isDisc":true,"genre":"x"}"#).unwrap();
        fs::write(b.join("B.exe"), b"x").unwrap();
        let games = scan(&[dir.to_string_lossy().to_string()], None);
        assert_eq!(games.len(), 2);
        let ga = games.iter().find(|g| g.title == "Game A").unwrap();
        assert_eq!(ga.album.as_deref(), Some("Favourites"));
        assert_eq!(ga.console, "PS3");
        assert!(!ga.is_disc);
        assert!(!ga.created.is_empty());
        let m: Value = serde_json::from_str(&fs::read_to_string(a.join("game.json")).unwrap()).unwrap();
        assert!(m.get("parentalControl").unwrap().is_null());
        assert_eq!(m["size"], "");
        assert!(m.get("starts").is_some());
        let raw = fs::read_to_string(a.join("game.json")).unwrap();
        assert!(raw.find("\"version\"").unwrap() < raw.find("\"starts\"").unwrap());
        assert!(raw.trim_start().starts_with("{\n  \"title\""));
        let mb: Value = serde_json::from_str(&fs::read_to_string(b.join("game.json")).unwrap()).unwrap();
        assert!(mb.get("genre").is_none());
        assert_eq!(mb["title"], "B");
        assert!(games.iter().find(|g| g.title == "B").unwrap().is_disc);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn folder_with_only_shortcut_is_a_game() {
        let dir = std::env::temp_dir().join("xmb_lnk_scan_test");
        let game = dir.join("Shortcut Game");
        let _ = fs::create_dir_all(&game);
        fs::write(game.join("Play.lnk"), b"x").unwrap();
        let games = scan(&[dir.to_string_lossy().to_string()], None);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].launch, "Play.lnk");
        let _ = fs::remove_dir_all(&dir);
    }
}

/// A URL/id-safe slug derived from the folder name.
fn slug(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut prev_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}
