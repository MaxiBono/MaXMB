//! Game recognition helpers.
//!
//! * Shortcut-only game folders: a folder in content/Games that holds just a
//!   `.lnk` / `.url` shortcut uses the shortcut's name as the game name and the
//!   shortcut's icon as the game icon.
//! * Game source folders ("Game Recognition: Source Folders"): every game found
//!   in the folders the user adds (for example Steam's `steamapps/common`) gets
//!   its own folder in content/Games with a `game.json` (name, version and
//!   company read from the exe) and an `icon.png` taken from the exe. The user
//!   can then add a background, preview, music or a different icon as usual.
//!   Games the user deletes (from the settings list or by hand) are remembered
//!   and not created again.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

// ------------------------------------------------------------ shortcuts ----

/// What a shortcut points at and where its icon comes from.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ShortcutInfo {
    pub target: Option<String>,
    pub icon_file: Option<String>,
    pub icon_index: i32,
}

fn u16_at(b: &[u8], o: usize) -> Option<u16> { b.get(o..o + 2).map(|x| u16::from_le_bytes([x[0], x[1]])) }
fn u32_at(b: &[u8], o: usize) -> Option<u32> { b.get(o..o + 4).map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]])) }
fn cstr_at(b: &[u8], o: usize) -> Option<String> {
    let rest = b.get(o..)?;
    let end = rest.iter().position(|&c| c == 0)?;
    Some(rest[..end].iter().map(|&c| c as char).collect())
}
fn wstr_at(b: &[u8], o: usize) -> Option<String> {
    let mut v = Vec::new();
    let mut i = o;
    loop {
        let c = u16_at(b, i)?;
        if c == 0 { break; }
        v.push(c);
        i += 2;
    }
    Some(String::from_utf16_lossy(&v))
}

/// Read a Windows `.lnk` file (MS-SHLLINK). Pure Rust so it works anywhere.
pub fn parse_lnk(b: &[u8]) -> Option<ShortcutInfo> {
    if u32_at(b, 0)? != 0x4C { return None; }
    let flags = u32_at(b, 0x14)?;
    let icon_index = u32_at(b, 0x38)? as i32;
    let unicode = flags & 0x80 != 0;
    let mut o = 0x4Cusize;
    if flags & 0x01 != 0 { o += 2 + u16_at(b, o)? as usize; }          // LinkTargetIDList
    let mut target = None;
    if flags & 0x02 != 0 {                                               // LinkInfo
        let size = u32_at(b, o)? as usize;
        let hsize = u32_at(b, o + 4)?;
        let li_flags = u32_at(b, o + 8)?;
        if li_flags & 1 != 0 {
            let suffix_off = u32_at(b, o + 24)? as usize;
            let (base, suffix) = if hsize >= 0x24 {
                let bu = u32_at(b, o + 28)? as usize;
                let su = u32_at(b, o + 32)? as usize;
                (if bu > 0 { wstr_at(b, o + bu) } else { cstr_at(b, o + u32_at(b, o + 16)? as usize) },
                 if su > 0 { wstr_at(b, o + su) } else { cstr_at(b, o + suffix_off) })
            } else {
                (cstr_at(b, o + u32_at(b, o + 16)? as usize), cstr_at(b, o + suffix_off))
            };
            if let Some(base) = base {
                let mut t = base;
                if let Some(sx) = suffix.filter(|s| !s.is_empty()) {
                    if !t.ends_with('\\') { t.push('\\'); }
                    t.push_str(&sx);
                }
                if !t.is_empty() { target = Some(t); }
            }
        }
        o += size;
    }
    // StringData: name, relative path, working dir, arguments, icon location
    let mut strings: [Option<String>; 5] = Default::default();
    for (i, bit) in [0x04u32, 0x08, 0x10, 0x20, 0x40].iter().enumerate() {
        if flags & bit == 0 { continue; }
        let n = u16_at(b, o)? as usize;
        o += 2;
        let s = if unicode {
            let raw = b.get(o..o + n * 2)?;
            o += n * 2;
            String::from_utf16_lossy(&raw.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>())
        } else {
            let raw = b.get(o..o + n)?;
            o += n;
            raw.iter().map(|&c| c as char).collect()
        };
        strings[i] = Some(s);
    }
    // ExtraData: environment-variable versions of the target / icon path
    let mut env_target = None;
    let mut env_icon = None;
    while let Some(size) = u32_at(b, o) {
        if size < 8 { break; }
        let sig = u32_at(b, o + 4).unwrap_or(0);
        if sig == 0xA000_0001 || sig == 0xA000_0007 {
            let s = wstr_at(b, o + 8 + 260).filter(|s| !s.is_empty()).or_else(|| cstr_at(b, o + 8));
            if sig == 0xA000_0001 { env_target = s; } else { env_icon = s; }
        }
        o += size as usize;
    }
    let target = target.or(env_target).or_else(|| strings[1].clone());
    let icon_file = strings[4].clone().filter(|s| !s.is_empty()).or(env_icon);
    Some(ShortcutInfo { target, icon_file, icon_index })
}

/// Read a `.url` internet shortcut (`IconFile=` / `IconIndex=` / `URL=`).
pub fn parse_url_file(text: &str) -> ShortcutInfo {
    let mut info = ShortcutInfo::default();
    for line in text.lines() {
        let Some((k, v)) = line.split_once('=') else { continue };
        match k.trim().to_ascii_lowercase().as_str() {
            "iconfile" => info.icon_file = Some(v.trim().to_string()),
            "iconindex" => info.icon_index = v.trim().parse().unwrap_or(0),
            "url" => info.target = Some(v.trim().to_string()),
            _ => {}
        }
    }
    info
}

/// Expand `%VAR%` parts of a path.
fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find('%') {
        out.push_str(&rest[..a]);
        let after = &rest[a + 1..];
        match after.find('%') {
            Some(b) => {
                let name = &after[..b];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => { out.push('%'); out.push_str(name); out.push('%'); }
                }
                rest = &after[b + 1..];
            }
            None => { out.push('%'); rest = after; }
        }
    }
    out.push_str(rest);
    out
}

/// Where a shortcut's icon should be read from: (file, index).
pub fn shortcut_icon_source(shortcut: &Path) -> Option<(PathBuf, i32)> {
    let ext = shortcut.extension()?.to_string_lossy().to_lowercase();
    if ext == "exe" { return Some((shortcut.to_path_buf(), 0)); }   // a program: its own icon
    let info = match ext.as_str() {
        "lnk" => parse_lnk(&fs::read(shortcut).ok()?)?,
        "url" => parse_url_file(&fs::read_to_string(shortcut).ok()?),
        _ => return None,
    };
    let dir = shortcut.parent().unwrap_or(Path::new(""));
    let resolve = |s: &str| {
        let p = PathBuf::from(expand_env(s.trim().trim_matches('"')));
        if p.is_absolute() { p } else { dir.join(p) }
    };
    if let Some(f) = info.icon_file.as_deref().filter(|s| !s.trim().is_empty()) {
        return Some((resolve(f), info.icon_index));
    }
    let t = info.target.as_deref().filter(|t| !t.contains("://"))?;
    Some((resolve(t), 0))
}

/// Icon of a program or shortcut (.exe / .lnk / .url), cached as a PNG. None if it can't be read.
pub fn shortcut_icon(shortcut: &Path, cache_dir: &Path) -> Option<String> {
    let meta = fs::metadata(shortcut).ok()?;
    let mut h = DefaultHasher::new();
    shortcut.hash(&mut h);
    meta.len().hash(&mut h);
    meta.modified().ok().hash(&mut h);
    let out = cache_dir.join(format!("{:016x}.png", h.finish()));
    if out.exists() { return Some(out.display().to_string()); }
    let (src, idx) = shortcut_icon_source(shortcut)?;
    let png = icon_png(&src, idx)?;
    fs::create_dir_all(cache_dir).ok()?;
    fs::write(&out, png).ok()?;
    Some(out.display().to_string())
}

// ------------------------------------------------------- source folders ----

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub exe: String,
    pub folder: String,
    pub title: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Record {
    pub entries: Vec<Entry>,
    /// the RPCS3 program last found (starts PS3 games)
    pub rpcs3: String,
}

pub fn load_record(file: &Path) -> Record {
    fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
pub fn save_record(file: &Path, r: &Record) {
    if let Ok(s) = serde_json::to_string_pretty(r) { let _ = fs::write(file, s); }
}

/// A detected game shown in the settings list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    pub title: String,
    pub exe: String,
    pub folder: String,
    pub source: String,
}

/// Games created from source folders whose folder still exists.
pub fn list_detected(file: &Path) -> Vec<Detected> {
    let v: Vec<Detected> = load_record(file)
        .entries
        .into_iter()
        .filter(|e| Path::new(&e.folder).is_dir())
        .map(|e| Detected { title: e.title, exe: e.exe, folder: e.folder, source: e.source })
        .collect();
    // the same title twice: numbered like the games themselves, "Title (2)"
    let keys: Vec<(String, u128, String)> = v.iter()
        .map(|d| (d.title.trim().to_lowercase(), crate::copies::born(Path::new(&d.folder)), d.folder.clone())).collect();
    let mut v: Vec<(Detected, u32)> = v.into_iter().zip(crate::copies::number(&keys)).collect();
    v.sort_by(|a, b| a.0.title.to_lowercase().cmp(&b.0.title.to_lowercase()).then(a.1.cmp(&b.1)));
    v.into_iter().map(|(mut d, n)| { d.title = crate::copies::with_number(&d.title, n); d }).collect()
}

/// Delete a game created from a source folder. Only folders this module made
/// (and that sit inside content/Games) can be removed; the exe is remembered
/// so the game isn't created again.
pub fn delete_detected(file: &Path, games_dir: &Path, folder: &str) -> Result<(), String> {
    let rec = load_record(file);
    if !rec.entries.iter().any(|e| e.folder == folder) { return Err("not a detected game".into()); }
    let target = PathBuf::from(folder);
    let (Ok(t), Ok(g)) = (target.canonicalize(), games_dir.canonicalize()) else {
        return Ok(()); // already gone
    };
    if !t.starts_with(&g) || t == g { return Err("outside the Games folder".into()); }
    fs::remove_dir_all(&t).map_err(|e| e.to_string())
}

/// A source folder was removed: delete every game folder made from it (only
/// folders inside content/Games) and forget them, so adding the folder again
/// finds those games again. Returns how many were deleted.
pub fn remove_source(file: &Path, games_dir: &Path, source: &str) -> usize {
    let mut rec = load_record(file);
    let g = games_dir.canonicalize().ok();
    let mut n = 0;
    rec.entries.retain(|e| {
        if e.source != source { return true; }
        if let (Ok(t), Some(g)) = (Path::new(&e.folder).canonicalize(), g.as_ref()) {
            if t.starts_with(g) && &t != g && fs::remove_dir_all(&t).is_ok() { n += 1; }
        }
        false
    });
    save_record(file, &rec);
    n
}

const SKIP_DIRS: &[&str] = &[
    "_commonredist", "commonredist", "redist", "redistributables", "redistributable", "directx", "vcredist",
    "dotnet", "__installer", "installer", "installers", "support", "engine", "easyanticheat", "battleye",
    "tools", "prerequisites", "prereqs", "crashreporter", "crashpad", "steamworks shared", "steam controller configs",
    "mono", "monobleedingedge", "jre", "java", "python", "_redist", "dxsetup", "physx", "uninstall",
];
const SKIP_EXE: &[&str] = &[
    "unins", "setup", "install", "crash", "report", "redist", "vcredist", "directx", "dxsetup", "dotnet",
    "prereq", "easyanticheat", "eac_", "battleye", "beservice", "be_service", "helper", "update", "patch",
    "cefprocess", "webhelper", "dedicated", "server", "benchmark", "editor", "sdk", "7z", "python", "pythonw",
    "notification", "overlay", "touchup", "cleanup", "uploader", "register", "activation", "dxwebsetup",
    "quicksfv", "subprocess", "zfgamebrowser", "unitycrashhandler", "vc_redist", "oalinst", "physx",
];

fn norm(s: &str) -> String { s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect() }

fn collect_exes(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, usize, u64)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_lowercase();
        if p.is_dir() {
            if depth < 3 && !SKIP_DIRS.contains(&name.as_str()) { collect_exes(&p, depth + 1, out); }
        } else if name.ends_with(".exe") {
            let stem = name.trim_end_matches(".exe");
            if SKIP_EXE.iter().any(|k| stem.contains(k)) { continue; }
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push((p, depth, size));
        }
    }
}

/// The exe that most likely starts the game in `dir`.
pub fn main_exe(dir: &Path) -> Option<PathBuf> {
    let mut exes = Vec::new();
    collect_exes(dir, 0, &mut exes);
    let folder = norm(&dir.file_name()?.to_string_lossy());
    exes.into_iter()
        .map(|(p, depth, size)| {
            let stem = norm(&p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
            let named = !stem.is_empty() && !folder.is_empty() && (folder.contains(&stem) || stem.contains(&folder));
            let score = if named { 1000 } else { 0 }
                + match depth { 0 => 500, 1 => 200, 2 => 50, _ => 0 }
                + (size / 1_000_000).min(300) as i64;
            (score, p)
        })
        .max_by_key(|(s, _)| *s)
        .map(|(_, p)| p)
}

/// Folder names found inside one game's own folder (not separate games).
const GAME_INNER_DIRS: &[&str] = &[
    "bin", "bin32", "bin64", "binaries", "win64", "win32", "x64", "x86", "data", "content", "assets", "resources",
    "game", "launcher", "plugins", "mods", "saves", "save", "config", "configs", "cfg", "logs", "localization",
    "movies", "videos", "music", "sound", "sounds", "audio", "shaders", "paks", "maps", "levels", "lib", "libs",
    "managed", "streamingassets", "_data", "docs", "manual", "extras", "soundtrack", "artbook",
];

/// Game folders inside a source folder: the folder itself when it is one
/// game (an exe in it, or the inside of a game such as "Binaries" / "Data"
/// next to the game's own files), otherwise each of its subfolders.
fn game_dirs(source: &Path) -> Vec<PathBuf> {
    let Ok(rd) = fs::read_dir(source) else { return vec![] };
    let entries: Vec<_> = rd.flatten().map(|e| e.path()).collect();
    let lname = |p: &PathBuf| p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let has_exe = entries.iter().any(|p| p.is_file() && p.extension().map(|x| x.eq_ignore_ascii_case("exe")).unwrap_or(false));
    let inner = entries.iter().filter(|p| p.is_dir() && (GAME_INNER_DIRS.contains(&lname(p).as_str()) || SKIP_DIRS.contains(&lname(p).as_str()))).count();
    let game_files = entries.iter().any(|p| p.is_file() && {
        let e = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        matches!(e.as_str(), "pak" | "dll" | "uproject" | "assets" | "resource" | "bin" | "dat" | "ini")
    });
    if has_exe || (inner > 0 && game_files) { return vec![source.to_path_buf()]; }
    let dirs: Vec<PathBuf> = entries.into_iter()
        .filter(|p| p.is_dir())
        .filter(|p| !SKIP_DIRS.contains(&lname(p).as_str()))
        .collect();
    // only a game's inner folders here (Binaries, Content…): it's one game
    if !dirs.is_empty() && dirs.iter().all(|p| GAME_INNER_DIRS.contains(&lname(p).as_str())) { return vec![source.to_path_buf()]; }
    dirs
}

const GENERIC_NAMES: &[&str] = &[
    "", "game", "application", "launcher", "ue4game", "ue5game", "unrealgame", "unrealengine", "unityplayer",
    "bootstrappackagedgame", "nwjs", "electron", "love", "godotengine", "gamemakerstudio", "renpy",
];

/// Words that are part of how a game is installed, not of its name ("Hades
/// Launcher", "Portal 2 - Shortcut", "Game x64", "Doom (DX12)"): taken out of
/// recognised names and of the names looked up online.
const NOISE_WORDS: &[&str] = &[
    "launcher", "shortcut", "executable", "exe", "x64", "x86", "x86_64", "amd64", "win64", "win32", "64bit", "32bit",
    "64-bit", "32-bit", "dx9", "dx10", "dx11", "dx12", "d3d9", "d3d11", "d3d12", "vulkan", "opengl", "shipping",
    "retail", "portable", "binaries", "bootstrap", "bootstrapper", "loader", "stub", "drm-free", "drmfree",
    "nosteam", "no-steam", "steamless",
];
/// Words taken out only at the very end of a name, and only when at least two
/// words are left ("Witcher 3 Manager" → "Witcher 3", but "Football Manager"
/// stays as it is): they're also part of real game names.
const TAIL_WORDS: &[&str] = &[
    "manager", "app", "application", "client", "start", "starter", "runner", "run", "play", "main", "game",
    "release", "final", "debug", "win", "windows", "pc", "steam", "gog", "epic", "standalone", "setup", "tool",
];
pub fn clean_title(s: &str) -> String {
    // separators used instead of spaces in file names
    let spaced: String = if s.contains(' ') { s.to_string() } else { s.replace(['_', '.'], " ") };
    let mut words: Vec<String> = Vec::new();
    for w in spaced.split_whitespace() {
        let bare: String = w.trim_matches(|c: char| "()[]{}-–—:,".contains(c)).to_lowercase();
        if NOISE_WORDS.contains(&bare.as_str()) { continue; }
        words.push(w.to_string());
    }
    while words.len() > 2 {
        let last = words.last().map(|w| w.trim_matches(|c: char| "()[]{}-–—:,".contains(c)).to_lowercase()).unwrap_or_default();
        if TAIL_WORDS.contains(&last.as_str()) { words.pop(); } else { break; }
    }
    let mut t = words.join(" ");
    // brackets / dashes left empty or dangling by what was taken out
    for e in ["()", "[]", "{}", "( )", "[ ]"] { t = t.replace(e, ""); }
    let t = t.trim().trim_end_matches(|c: char| " -–—:,".contains(c)).trim_start_matches(|c: char| " -–—:,".contains(c)).trim();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() { s.trim().to_string() } else { t }
}

fn good_name(s: &str) -> bool {
    let n = norm(s);
    !GENERIC_NAMES.contains(&n.as_str()) && !n.contains("bootstrap") && !n.contains("microsoftwindows")
        && !n.ends_with("exe")
}

fn safe_folder_name(s: &str) -> String {
    let c: String = s.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let c = c.split_whitespace().collect::<Vec<_>>().join(" ");
    let c = c.trim_end_matches('.').trim().to_string();
    if c.is_empty() { "Game".into() } else { c }
}

/// Find games in every source folder and create a content/Games folder for
/// each new one. Returns how many were added.
/// Returns the folders made for newly found games.
pub fn sync(sources: &[String], games_dir: &Path, record_file: &Path, ffmpeg: Option<&Path>, progress: &dyn Fn(usize, usize)) -> Vec<PathBuf> {
    // one search at a time: two at once (opening the Game column while a
    // folder is being added) would each make the same games and each save
    // only its own list, leaving games twice in the Game column
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut rec = load_record(record_file);
    repair(games_dir, &mut rec);
    let mut added = Vec::new();
    // each game folder once (a source inside another source finds it twice)
    let mut seen = std::collections::HashSet::new();
    let all: Vec<(String, PathBuf)> = sources.iter().filter(|s| Path::new(s).is_dir())
        .flat_map(|s| game_dirs(Path::new(s)).into_iter().map(move |d| (s.clone(), d)))
        .filter(|(_, d)| seen.insert(d.canonicalize().unwrap_or_else(|_| d.clone()).display().to_string().to_lowercase()))
        .collect();
    // PS3 games: every game inside an RPCS3 install, and PS3 game folders
    // found in a source folder themselves (or one folder down)
    let mut ps3_games: Vec<(String, crate::ps3::Ps3Game)> = Vec::new();
    for (src, gd) in &all {
        if let Some(rp) = crate::ps3::find_rpcs3(gd) {
            rec.rpcs3 = rp.display().to_string();
            let root = rp.parent().map(Path::to_path_buf).unwrap_or_else(|| gd.clone());
            for g in crate::ps3::games_in(&root) { ps3_games.push((src.clone(), g)); }
        } else if let Some(g) = crate::ps3::game_at(gd) {
            ps3_games.push((src.clone(), g));
        } else if main_exe(gd).is_none() {
            for e in fs::read_dir(gd).into_iter().flatten().flatten() {
                if let Some(g) = crate::ps3::game_at(&e.path()) { ps3_games.push((src.clone(), g)); }
            }
        }
    }
    let rpcs3 = Some(PathBuf::from(&rec.rpcs3)).filter(|p| p.is_file());
    let total = all.len() + ps3_games.len();
    progress(0, total);
    let base_n = all.len();
    for (j, (src, g)) in ps3_games.into_iter().enumerate() {
        progress(base_n + j, total);
        let key = crate::ps3::key(&g);
        if let Some(e) = rec.entries.iter().find(|e| e.exe.eq_ignore_ascii_case(&key)) {
            // (made before: started the way it should be now, e.g. by its
            // Title ID instead of its EBOOT.BIN, which RPCS3 couldn't decrypt)
            update_ps3_launch(Path::new(&e.folder), &g, rpcs3.as_deref());
            // (its own art over what the game databases found for it before)
            if !crate::gameart::is_home(Path::new(&e.folder)) { crate::ps3::fill_media_ex(Path::new(&e.folder), &g.content, ffmpeg, true); }
            continue;
        }
        let Some(dir) = make_ps3(&g, rpcs3.as_deref(), games_dir, ffmpeg) else { continue };
        let title = if g.title.is_empty() { g.title_id.clone() } else { g.title.clone() };
        rec.entries.push(Entry { exe: key, folder: dir.display().to_string(), title, source: src });
        added.push(dir);
    }
    for (i, (src, gd)) in all.into_iter().enumerate() {
        progress(i, total);
        let src = &src;
        {
            // a PS3 game folder (not a PC game)
            if crate::ps3::game_at(&gd).is_some() { continue; }
            let Some(exe) = main_exe(&gd) else { continue };
            let exe_s = exe.display().to_string();
            // already made (or deleted by the user): leave it alone
            if rec.entries.iter().any(|e| e.exe.eq_ignore_ascii_case(&exe_s)) { continue; }
            let vi = version_info(&exe);
            let folder_title = gd.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let title = [vi.product_name.clone(), vi.file_description.clone()]
                .into_iter()
                .flatten()
                .map(|s| s.trim().to_string())
                .find(|s| good_name(s))
                .unwrap_or_else(|| if folder_title.is_empty() {
                    exe.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
                } else { folder_title.clone() });
            let title = clean_title(&title);
            let base = safe_folder_name(&title);
            let mut dir = games_dir.join(&base);
            let mut n = 2;
            while dir.exists() { dir = games_dir.join(format!("{base} ({n})")); n += 1; }
            if fs::create_dir_all(&dir).is_err() { continue; }
            let mut meta = serde_json::Map::new();
            meta.insert("title".into(), title.clone().into());
            // the game's shortcut (a small file pointing at the .exe, like the
            // media shortcuts), started through its game.json
            let link = format!("{}.{}", safe_folder_name(&title), crate::medialib::LINK_EXT);
            let _ = crate::medialib::write_link(&dir.join(&link), &exe);
            meta.insert("launch".into(), link.into());
            // a program on this computer: PC (the game databases may say otherwise)
            meta.insert("console".into(), "PC".into());
            // the game's own folder, where it was found
            meta.insert("sourceDir".into(), gd.display().to_string().into());
            // the rest (created, size, version, console…) is filled in by the
            // library scan the first time it sees this folder
            let _ = fs::write(dir.join("game.json"), serde_json::to_string_pretty(&serde_json::Value::Object(meta)).unwrap_or_default());
            if let Some(png) = icon_png(&exe, 0) {
                if fs::write(dir.join("icon.png"), png).is_ok() { crate::gameart::mark_source(&dir, "icon", crate::gameart::SRC_LOCAL); }
            }
            rec.entries.push(Entry { exe: exe_s, folder: dir.display().to_string(), title, source: src.clone() });
            added.push(dir);
        }
    }
    progress(total, total);
    save_record(record_file, &rec);
    added
}

/// A folder in content\Games for a PS3 game: its name, RPCS3 to start it,
/// and its icon, background, preview and music.
fn make_ps3(g: &crate::ps3::Ps3Game, rpcs3: Option<&Path>, games_dir: &Path, ffmpeg: Option<&Path>) -> Option<PathBuf> {
    let folder_title = g.dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let title = [g.title.clone(), folder_title, g.title_id.clone()].into_iter().find(|s| !s.trim().is_empty())?;
    let base = safe_folder_name(&title);
    let mut dir = games_dir.join(&base);
    let mut n = 2;
    while dir.exists() { dir = games_dir.join(format!("{base} ({n})")); n += 1; }
    fs::create_dir_all(&dir).ok()?;
    let mut meta = serde_json::Map::new();
    meta.insert("title".into(), title.clone().into());
    if !g.version.is_empty() { meta.insert("version".into(), g.version.clone().into()); }
    meta.insert("console".into(), "PS3".into());
    if let Some(rp) = rpcs3 { set_rpcs3_launch(&mut meta, &dir, &title, rp, g); }
    if !g.title_id.is_empty() { meta.insert("titleId".into(), g.title_id.clone().into()); }
    meta.insert("sourceDir".into(), g.dir.display().to_string().into());
    let _ = fs::write(dir.join("game.json"), serde_json::to_string_pretty(&serde_json::Value::Object(meta)).unwrap_or_default());
    // (PlayStation®Home: started like the other PS3 games, but no art of its own)
    if !crate::gameart::is_home_title(&title) { crate::ps3::fill_media(&dir, &g.content, ffmpeg); }
    Some(dir)
}
fn set_rpcs3_launch(meta: &mut serde_json::Map<String, serde_json::Value>, dir: &Path, title: &str, rpcs3: &Path, g: &crate::ps3::Ps3Game) {
    let link = format!("{}.{}", safe_folder_name(title), crate::medialib::LINK_EXT);
    let _ = crate::medialib::write_link(&dir.join(&link), rpcs3);
    meta.insert("launch".into(), link.into());
    meta.insert("args".into(), crate::ps3::rpcs3_args(g).into());
    meta.insert("ps3Key".into(), crate::ps3::key(g).into());
}
/// A PS3 game's folder made earlier: its arguments brought up to date (and
/// RPCS3 to start it, once one has been found).
fn update_ps3_launch(dir: &Path, g: &crate::ps3::Ps3Game, rpcs3: Option<&Path>) {
    let Ok(t) = fs::read_to_string(dir.join("game.json")) else { return };
    let Ok(serde_json::Value::Object(mut meta)) = serde_json::from_str::<serde_json::Value>(&t) else { return };
    let want: serde_json::Value = crate::ps3::rpcs3_args(g).into();
    let has_launch = meta.get("launch").and_then(|v| v.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false);
    if has_launch && meta.get("args") == Some(&want) && meta.contains_key("ps3Key") { return; }
    if !has_launch {
        let Some(rp) = rpcs3 else { return };
        let title = meta.get("title").and_then(|v| v.as_str()).unwrap_or("Game").to_string();
        set_rpcs3_launch(&mut meta, dir, &title, rp, g);
    } else {
        meta.insert("args".into(), want);
        meta.insert("ps3Key".into(), crate::ps3::key(g).into());
    }
    let _ = crate::library::patch_meta(dir, &meta.into_iter().collect::<Vec<_>>().iter().map(|(k, v)| (k.as_str(), v.clone())).collect::<Vec<_>>());
}

/// PS3 games put into content\Games by hand (a game's own folder, with
/// PS3_GAME or PARAM.SFO in it): their icon, background, preview and music,
/// and RPCS3 to start them once it's been found.
pub fn fill_ps3_folders(games_dir: &Path, record_file: &Path, ffmpeg: Option<&Path>) {
    let rec = load_record(record_file);
    let rpcs3 = Some(PathBuf::from(&rec.rpcs3)).filter(|p| p.is_file());
    let mut dirs = Vec::new();
    for e in fs::read_dir(games_dir).into_iter().flatten().flatten() {
        let p = e.path();
        if !p.is_dir() { continue; }
        if p.join("game.json").exists() || crate::ps3::game_at(&p).is_some() { dirs.push(p); continue; }
        for e2 in fs::read_dir(&p).into_iter().flatten().flatten() { if e2.path().is_dir() { dirs.push(e2.path()); } }
    }
    for d in dirs {
        let Some(g) = crate::ps3::game_at(&d) else {
            // a recognized PS3 game (its folder points at the game): its
            // preview and music need FFmpeg, so one recognized before FFmpeg
            // was there gets them now (what's already set stays)
            if let Some(ff) = ffmpeg {
                let v: serde_json::Value = fs::read_to_string(d.join("game.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
                if let Some(src) = v["sourceDir"].as_str().filter(|s| !s.is_empty() && v["titleId"].as_str().map(|t| !t.is_empty()).unwrap_or(false)) {
                    if let Some(g) = crate::ps3::game_at(Path::new(src)) {
                        if !crate::gameart::is_home(&d) { crate::ps3::fill_media(&d, &g.content, Some(ff)); }
                    }
                }
            }
            continue
        };
        let mut meta: serde_json::Map<String, serde_json::Value> = fs::read_to_string(d.join("game.json")).ok()
            .and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let had = !meta.is_empty();
        let mut changed = false;
        let title = meta.get("title").and_then(|v| v.as_str()).map(str::to_string)
            .unwrap_or_else(|| if g.title.is_empty() { d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() } else { g.title.clone() });
        if !had {
            meta.insert("title".into(), title.clone().into());
            if !g.version.is_empty() { meta.insert("version".into(), g.version.clone().into()); }
            meta.insert("console".into(), "PS3".into());
            if !g.title_id.is_empty() { meta.insert("titleId".into(), g.title_id.clone().into()); }
            changed = true;
        }
        let no_launch = meta.get("launch").and_then(|v| v.as_str()).map(|s| s.trim().is_empty()).unwrap_or(true);
        if no_launch {
            if let Some(rp) = rpcs3.as_deref() { set_rpcs3_launch(&mut meta, &d, &title, rp, &g); changed = true; }
        }
        if changed {
            let _ = fs::write(d.join("game.json"), serde_json::to_string_pretty(&serde_json::Value::Object(meta)).unwrap_or_default());
        }
        if !crate::gameart::is_home(&d) { crate::ps3::fill_media(&d, &g.content, ffmpeg); }
    }
}

/// The .exe a game folder made by `sync` starts (through its shortcut, or the
/// exe path itself in older folders); for a PS3 game, its EBOOT.BIN.
fn folder_exe(dir: &Path) -> Option<String> {
    let t = fs::read_to_string(dir.join("game.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&t).ok()?;
    if let Some(k) = v["ps3Key"].as_str().filter(|k| !k.is_empty()) { return Some(k.to_string()); }
    if let Some(eb) = v["args"].as_array().and_then(|a| a.last()).and_then(|x| x.as_str())
        .filter(|a| a.to_lowercase().ends_with("eboot.bin")) { return Some(eb.to_string()); }
    let launch = v["launch"].as_str()?.trim().to_string();
    let p = if Path::new(&launch).is_absolute() { PathBuf::from(&launch) } else { dir.join(&launch) };
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if ext == crate::medialib::LINK_EXT { return crate::medialib::read_link(&p).map(|t| t.display().to_string()); }
    (ext == "exe").then(|| p.display().to_string())
}
/// Only what the app makes for a recognized game is in this folder.
fn only_app_files(dir: &Path) -> bool {
    fs::read_dir(dir).into_iter().flatten().flatten().all(|e| {
        let n = e.file_name().to_string_lossy().to_lowercase();
        n == "game.json" || n == "unused" || n == ".download" || n.ends_with(&format!(".{}", crate::medialib::LINK_EXT))
            || ["icon.", "background.", "preview.", "music."].iter().any(|k| n.starts_with(k))
    })
}
/// Games made twice by an older version (see `sync`): the copy that isn't in
/// the list is deleted when the folder only holds what the app made, and a
/// game the list forgot is put back in it.
fn repair(games_dir: &Path, rec: &mut Record) {
    let mut dirs = Vec::new();
    for e in fs::read_dir(games_dir).into_iter().flatten().flatten() {
        let p = e.path();
        if !p.is_dir() { continue; }
        if p.join("game.json").exists() { dirs.push(p); continue; }
        // a folder of games (By Album)
        for e2 in fs::read_dir(&p).into_iter().flatten().flatten() {
            if e2.path().join("game.json").exists() { dirs.push(e2.path()); }
        }
    }
    let known = |rec: &Record, d: &Path| rec.entries.iter().any(|e| Path::new(&e.folder) == d);
    for d in dirs {
        if known(rec, &d) { continue; }
        let Some(exe) = folder_exe(&d) else { continue };
        let twin = rec.entries.iter().find(|e| e.exe.eq_ignore_ascii_case(&exe)).map(|e| e.folder.clone());
        match twin {
            Some(f) if Path::new(&f).is_dir() => {
                // the same game made twice: drop the extra copy
                if only_app_files(&d) { let _ = fs::remove_dir_all(&d); }
            }
            Some(_) => {
                // its listed folder is gone (moved by the user?): this is the game now
                if let Some(e) = rec.entries.iter_mut().find(|e| e.exe.eq_ignore_ascii_case(&exe)) { e.folder = d.display().to_string(); }
            }
            None if Path::new(&exe).exists() => {
                let title = fs::read_to_string(d.join("game.json")).ok()
                    .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                    .and_then(|v| v["title"].as_str().map(str::to_string)).unwrap_or_default();
                rec.entries.push(Entry { exe, folder: d.display().to_string(), title, source: String::new() });
            }
            None => {}
        }
    }
}

// ---------------------------------------------------- exe icon / version ----

#[derive(Debug, Default, Clone)]
pub struct VersionInfo {
    pub product_name: Option<String>,
    pub file_description: Option<String>,
    pub product_version: Option<String>,
    pub file_version: Option<String>,
}

#[cfg(not(windows))]
pub fn icon_png(_file: &Path, _index: i32) -> Option<Vec<u8>> { None }
#[cfg(not(windows))]
pub fn version_info(_exe: &Path) -> VersionInfo { VersionInfo::default() }

#[cfg(windows)]
pub use win::{icon_png, version_info};

#[cfg_attr(not(windows), allow(dead_code))]
fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(rgba).ok()?;
    }
    Some(out)
}

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod win {
    use super::{encode_png, VersionInfo};
    use core::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    #[repr(C)]
    struct ICONINFO { f_icon: i32, x: u32, y: u32, hbm_mask: isize, hbm_color: isize }
    #[repr(C)]
    struct BITMAP { ty: i32, width: i32, height: i32, width_bytes: i32, planes: u16, bits_pixel: u16, bits: *mut c_void }
    #[repr(C)]
    struct BITMAPINFOHEADER { size: u32, width: i32, height: i32, planes: u16, bit_count: u16, compression: u32,
        size_image: u32, xppm: i32, yppm: i32, clr_used: u32, clr_important: u32 }
    #[repr(C)]
    struct BITMAPINFO { header: BITMAPINFOHEADER, colors: [u32; 3] }

    #[link(name = "user32")]
    extern "system" {
        fn PrivateExtractIconsW(file: *const u16, idx: i32, cx: i32, cy: i32, icons: *mut isize, ids: *mut u32, n: u32, flags: u32) -> u32;
        fn DestroyIcon(h: isize) -> i32;
        fn GetIconInfo(h: isize, info: *mut ICONINFO) -> i32;
        fn GetDC(h: isize) -> isize;
        fn ReleaseDC(h: isize, dc: isize) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn GetObjectW(h: isize, n: i32, out: *mut c_void) -> i32;
        fn GetDIBits(dc: isize, bm: isize, start: u32, lines: u32, bits: *mut c_void, bi: *mut BITMAPINFO, usage: u32) -> i32;
        fn DeleteObject(h: isize) -> i32;
    }
    #[link(name = "version")]
    extern "system" {
        fn GetFileVersionInfoSizeW(file: *const u16, handle: *mut u32) -> u32;
        fn GetFileVersionInfoW(file: *const u16, handle: u32, len: u32, data: *mut c_void) -> i32;
        fn VerQueryValueW(block: *const c_void, sub: *const u16, buf: *mut *mut c_void, len: *mut u32) -> i32;
    }

    fn wide(s: &std::ffi::OsStr) -> Vec<u16> { s.encode_wide().chain(std::iter::once(0)).collect() }

    unsafe fn bits32(dc: isize, bm: isize, w: i32, h: i32) -> Option<Vec<u8>> {
        let mut bi = BITMAPINFO {
            header: BITMAPINFOHEADER { size: 40, width: w, height: -h, planes: 1, bit_count: 32, compression: 0,
                size_image: 0, xppm: 0, yppm: 0, clr_used: 0, clr_important: 0 },
            colors: [0; 3],
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        if GetDIBits(dc, bm, 0, h as u32, buf.as_mut_ptr() as *mut c_void, &mut bi, 0) == 0 { return None; }
        Some(buf)
    }

    /// The icon at `index` of an exe / dll / ico file, as a 256 px PNG.
    pub fn icon_png(file: &Path, index: i32) -> Option<Vec<u8>> {
        let path = wide(file.as_os_str());
        unsafe {
            let mut icon: isize = 0;
            let mut id: u32 = 0;
            let n = PrivateExtractIconsW(path.as_ptr(), index, 256, 256, &mut icon, &mut id, 1, 0);
            if n == 0 || n == u32::MAX || icon == 0 { return None; }
            let mut info = ICONINFO { f_icon: 0, x: 0, y: 0, hbm_mask: 0, hbm_color: 0 };
            if GetIconInfo(icon, &mut info) == 0 { DestroyIcon(icon); return None; }
            let mut bm: BITMAP = std::mem::zeroed();
            let src = if info.hbm_color != 0 { info.hbm_color } else { info.hbm_mask };
            GetObjectW(src, std::mem::size_of::<BITMAP>() as i32, &mut bm as *mut _ as *mut c_void);
            let w = bm.width;
            let h = if info.hbm_color != 0 { bm.height } else { bm.height / 2 };
            let dc = GetDC(0);
            let mut out = None;
            if w > 0 && h > 0 && info.hbm_color != 0 {
                if let Some(mut px) = bits32(dc, info.hbm_color, w, h) {
                    let has_alpha = px.chunks(4).any(|c| c[3] != 0);
                    let mask = if has_alpha { None } else { bits32(dc, info.hbm_mask, w, h) };
                    for (i, c) in px.chunks_mut(4).enumerate() {
                        c.swap(0, 2); // BGRA -> RGBA
                        if let Some(m) = &mask { c[3] = if m[i * 4] == 0 { 255 } else { 0 }; }
                    }
                    out = encode_png(w as u32, h as u32, &px);
                }
            }
            ReleaseDC(0, dc);
            if info.hbm_color != 0 { DeleteObject(info.hbm_color); }
            if info.hbm_mask != 0 { DeleteObject(info.hbm_mask); }
            DestroyIcon(icon);
            out
        }
    }

    /// Name, company and version from the exe's version resource.
    pub fn version_info(exe: &Path) -> VersionInfo {
        let path = wide(exe.as_os_str());
        let mut vi = VersionInfo::default();
        unsafe {
            let mut handle = 0u32;
            let size = GetFileVersionInfoSizeW(path.as_ptr(), &mut handle);
            if size == 0 { return vi; }
            let mut data = vec![0u8; size as usize];
            if GetFileVersionInfoW(path.as_ptr(), 0, size, data.as_mut_ptr() as *mut c_void) == 0 { return vi; }
            let block = data.as_ptr() as *const c_void;
            let query = |sub: &str| -> Option<(*mut c_void, u32)> {
                let w: Vec<u16> = sub.encode_utf16().chain(std::iter::once(0)).collect();
                let mut p: *mut c_void = std::ptr::null_mut();
                let mut len = 0u32;
                if VerQueryValueW(block, w.as_ptr(), &mut p, &mut len) != 0 && !p.is_null() && len > 0 { Some((p, len)) } else { None }
            };
            let mut langs: Vec<String> = Vec::new();
            if let Some((p, len)) = query("\\VarFileInfo\\Translation") {
                let pairs = std::slice::from_raw_parts(p as *const u16, (len / 2) as usize);
                for c in pairs.chunks(2) { if c.len() == 2 { langs.push(format!("{:04x}{:04x}", c[0], c[1])); } }
            }
            langs.extend(["040904b0".to_string(), "040904e4".to_string(), "000004b0".to_string()]);
            let get = |key: &str| -> Option<String> {
                for l in &langs {
                    if let Some((p, len)) = query(&format!("\\StringFileInfo\\{l}\\{key}")) {
                        let s = std::slice::from_raw_parts(p as *const u16, len as usize);
                        let end = s.iter().position(|&c| c == 0).unwrap_or(s.len());
                        let v = String::from_utf16_lossy(&s[..end]).trim().to_string();
                        if !v.is_empty() { return Some(v); }
                    }
                }
                None
            };
            vi.product_name = get("ProductName");
            vi.file_description = get("FileDescription");
            vi.product_version = get("ProductVersion");
            vi.file_version = get("FileVersion");
        }
        vi
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_lose_install_words() {
        assert_eq!(clean_title("Hades Launcher"), "Hades");
        assert_eq!(clean_title("Portal 2 - Shortcut"), "Portal 2");
        assert_eq!(clean_title("Doom (DX12)"), "Doom");
        assert_eq!(clean_title("Hollow_Knight"), "Hollow Knight");
        assert_eq!(clean_title("SteamWorld Dig"), "SteamWorld Dig");
        assert_eq!(clean_title("Launcher"), "Launcher");
        assert_eq!(clean_title("Witcher3 Executable"), "Witcher3");
        assert_eq!(clean_title("The Witcher 3 Manager"), "The Witcher 3");
        assert_eq!(clean_title("Football Manager"), "Football Manager");
        assert_eq!(clean_title("Football Manager 2024"), "Football Manager 2024");
    }
    #[test]
    fn one_game_folder_is_one_game() {
        let root = std::env::temp_dir().join(format!("xmb_gd_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // a game whose exe is inside Binaries\Win64, with Content next to it
        let g = root.join("MyGame");
        fs::create_dir_all(g.join("Binaries").join("Win64")).unwrap();
        fs::create_dir_all(g.join("Content")).unwrap();
        fs::write(g.join("Binaries").join("Win64").join("MyGame.exe"), b"x").unwrap();
        assert_eq!(game_dirs(&g), vec![g.clone()]);
        // a library: one folder per game
        let lib = root.join("common");
        fs::create_dir_all(lib.join("A")).unwrap(); fs::create_dir_all(lib.join("B")).unwrap();
        assert_eq!(game_dirs(&lib).len(), 2);
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    fn url_file_icon() {
        let i = parse_url_file("[InternetShortcut]\nURL=steam://rungameid/1\nIconIndex=0\nIconFile=C:\\Steam\\steam\\games\\abc.ico\n");
        assert_eq!(i.icon_file.as_deref(), Some("C:\\Steam\\steam\\games\\abc.ico"));
        assert_eq!(i.target.as_deref(), Some("steam://rungameid/1"));
    }

    #[test]
    fn lnk_minimal_with_icon_location() {
        // header + LinkInfo-less shortcut with relative path + icon location (unicode)
        let mut b = vec![0u8; 0x4C];
        b[0] = 0x4C;
        let flags: u32 = 0x08 | 0x40 | 0x80;
        b[0x14..0x18].copy_from_slice(&flags.to_le_bytes());
        b[0x38..0x3C].copy_from_slice(&3i32.to_le_bytes());
        for s in [".\\game.exe", "C:\\icons\\g.ico"] {
            let w: Vec<u16> = s.encode_utf16().collect();
            b.extend_from_slice(&(w.len() as u16).to_le_bytes());
            for c in w { b.extend_from_slice(&c.to_le_bytes()); }
        }
        b.extend_from_slice(&0u32.to_le_bytes());
        let i = parse_lnk(&b).unwrap();
        assert_eq!(i.target.as_deref(), Some(".\\game.exe"));
        assert_eq!(i.icon_file.as_deref(), Some("C:\\icons\\g.ico"));
        assert_eq!(i.icon_index, 3);
    }

    #[test]
    fn picks_main_exe_and_syncs() {
        let root = std::env::temp_dir().join("xmb_gamesrc_test");
        let _ = fs::remove_dir_all(&root);
        let common = root.join("common");
        let g = common.join("Cool Game");
        fs::create_dir_all(g.join("_CommonRedist")).unwrap();
        fs::create_dir_all(g.join("bin")).unwrap();
        fs::write(g.join("CoolGame.exe"), b"x").unwrap();
        fs::write(g.join("unins000.exe"), b"x").unwrap();
        fs::write(g.join("bin").join("other.exe"), vec![0u8; 10]).unwrap();
        fs::write(g.join("_CommonRedist").join("vc.exe"), b"x").unwrap();
        fs::create_dir_all(common.join("Empty")).unwrap();
        assert_eq!(main_exe(&g).unwrap().file_name().unwrap(), "CoolGame.exe");

        let games = root.join("Games");
        fs::create_dir_all(&games).unwrap();
        let rec = root.join("rec.json");
        let srcs = vec![common.display().to_string()];
        assert_eq!(sync(&srcs, &games, &rec, None, &|_, _| {}).len(), 1);
        let made = games.join("Cool Game");
        assert!(made.join("game.json").exists());
        // second sync adds nothing; deleting keeps it deleted
        assert_eq!(sync(&srcs, &games, &rec, None, &|_, _| {}).len(), 0);
        assert_eq!(list_detected(&rec).len(), 1);
        delete_detected(&rec, &games, &made.display().to_string()).unwrap();
        assert!(!made.exists());
        assert_eq!(sync(&srcs, &games, &rec, None, &|_, _| {}).len(), 0);
        assert_eq!(list_detected(&rec).len(), 0);
        // removing the source deletes what it made and forgets it
        let g2 = common.join("Other Game");
        fs::create_dir_all(&g2).unwrap();
        fs::write(g2.join("Other.exe"), b"x").unwrap();
        assert_eq!(sync(&srcs, &games, &rec, None, &|_, _| {}).len(), 1);
        assert!(games.join("Other Game").exists());
        assert_eq!(remove_source(&rec, &games, &srcs[0]), 1);
        assert!(!games.join("Other Game").exists());
        assert_eq!(load_record(&rec).entries.len(), 0);
        let _ = fs::remove_dir_all(&root);
    }
}
