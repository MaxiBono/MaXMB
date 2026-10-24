//! A game's own media (Game Settings) and the game databases.
//!
//! * `set_media`: a game's icon / background / video / music is a file named
//!   icon.*, background.*, preview.* or music.* in its folder. Choosing one
//!   copies the file there and deletes the one it replaces.
//! * `scrape`: the art and full name of a game from SteamGridDB, then
//!   TheGamesDB, then RAWG (each one only for what the ones before
//!   didn't have): an icon (the site's own, square or 16:9), a 16:9
//!   background, a 16:9 video or
//!   GIF (at most a minute) and the name. The closest match to the game's name
//!   (without words like "Launcher" or "Shortcut") is used. Needs the internet
//!   and each site's API key (Settings); downloads use Windows' own curl.exe.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const KINDS: &[(&str, &[&str])] = &[
    ("icon", &["png", "jpg", "jpeg", "webp", "gif"]),
    ("background", &["png", "jpg", "jpeg", "webp"]),
    ("preview", &["mp4", "webm", "mov", "gif"]),
    ("music", &["flac", "wav", "ogg", "mp3", "opus", "m4a", "aac"]),
];
fn exts_for(kind: &str) -> Option<&'static [&'static str]> { KINDS.iter().find(|(k, _)| *k == kind).map(|(_, e)| *e) }
fn ext_of(p: &Path) -> String { p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default() }

/// The files in `dir` that are the game's `kind` (icon.png, ICON0.PNG…).
fn current(dir: &Path, kind: &str) -> Vec<PathBuf> {
    let console = match kind { "icon" => Some("icon0"), "background" => Some("pic1"), _ => None };
    fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
            stem == kind || Some(stem.as_str()) == console
        }).collect()
}

/// Delete the game's current `kind` file(s) (it's being replaced or removed).
fn retire(dir: &Path, kind: &str) -> usize {
    current(dir, kind).into_iter().filter(|f| fs::remove_file(f).is_ok()).count()
}

/// Game Settings: use `src` as the game's `kind` (None: remove it).
pub fn set_media(folder: &Path, kind: &str, src: Option<&Path>) -> Result<(), String> {
    let exts = exts_for(kind).ok_or("unknown kind")?;
    if !folder.is_dir() { return Err("game folder not found".into()); }
    let src = match src {
        None => { retire(folder, kind); return Ok(()); }
        Some(s) => s,
    };
    // a shortcut made by the app: the file it points at
    let real = if ext_of(src) == crate::medialib::LINK_EXT { crate::medialib::read_link(src).ok_or("broken shortcut")? } else { src.to_path_buf() };
    let ext = ext_of(&real);
    if !exts.contains(&ext.as_str()) { return Err(format!("A {kind} can't be a .{ext} file.")); }
    if !real.is_file() { return Err("file not found".into()); }
    // copied first (so a file chosen from the game's own folder isn't lost)
    let tmp = folder.join(format!(".{kind}.new"));
    fs::copy(&real, &tmp).map_err(|e| e.to_string())?;
    retire(folder, kind);
    fs::rename(&tmp, folder.join(format!("{kind}.{ext}"))).map_err(|e| e.to_string())
}

// ------------------------------------------------------ where art came from ----
//
// game.json "artSource" keeps where each of a game's pictures / videos /
// music came from, from the least to the most important:
//   "local" (the program's own icon, taken from its .exe), "db" (the game
//   databases, found by themselves), "ps3" (a PS3 game's own ICON0 / PIC1 /
//   ICON1 / SND0), "user" (chosen, changed or removed in Game Settings).
// Something found later only takes the place of something less important;
// Get Art Online (asked for on that game) replaces everything but a PS3
// game's own art, and counts as the databases' from then on.

pub const SRC_LOCAL: &str = "local";
pub const SRC_DB: &str = "db";
pub const SRC_PS3: &str = "ps3";
pub const SRC_USER: &str = "user";
fn src_rank(s: &str) -> i32 { match s { SRC_LOCAL => 0, SRC_DB => 1, SRC_PS3 => 2, SRC_USER => 3, _ => 3 } }

/// Where the game's `kind` came from: as recorded, else for a file made by
/// an older version: its icon counts as the program's own, anything else as
/// chosen by you (it was never replaced before either). None: it has none.
pub fn art_source(folder: &Path, kind: &str) -> Option<String> {
    let rec = fs::read_to_string(crate::library::meta_path(folder)).ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["artSource"][kind].as_str().map(str::to_string));
    if let Some(r) = rec { return Some(r); }
    if current(folder, kind).is_empty() { return None; }
    Some(if kind == "icon" { SRC_LOCAL } else { SRC_USER }.to_string())
}
/// Whether something from `src` may take the place of the game's `kind`.
pub fn may_replace(folder: &Path, kind: &str, src: &str) -> bool {
    match art_source(folder, kind) { None => true, Some(cur) => src_rank(&cur) < src_rank(src) }
}
/// PlayStation®Home (it starts from PSN > PlayStation®Home, with the system's
/// own look): no art is ever put in its folder by itself.
pub fn is_home_title(t: &str) -> bool {
    let n: String = t.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
    matches!(n.as_str(), "playstationhome" | "playstation3home" | "pshome" | "ps3home")
}
fn meta_of(folder: &Path) -> serde_json::Value {
    fs::read_to_string(crate::library::meta_path(folder)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(serde_json::Value::Null)
}
pub fn is_home(folder: &Path) -> bool {
    let v = meta_of(folder);
    is_home_title(v["title"].as_str().unwrap_or_else(|| folder.file_name().and_then(|n| n.to_str()).unwrap_or("")))
}
/// A recognized game the game databases haven't been asked about yet (with a
/// key and the internet) and that still has something they could fill in:
/// Game Recognition (with Automatic Scraping on) gets its art.
pub fn needs_db_art(folder: &Path, ffmpeg_now: bool) -> bool {
    if is_home(folder) { return false; }
    // (art that was put in whole, uncut, because FFmpeg wasn't there: made
    // again now that it is)
    if ffmpeg_now && !uncut_kinds(folder).is_empty() { return true; }
    if meta_of(folder)["dbScraped"].as_bool() == Some(true) { return false; }
    ["icon", "background", "preview"].iter().any(|k| may_replace(folder, k, SRC_DB))
}

/// The game's database art that needed FFmpeg (to be cut to its shape, or
/// made into a video) and was put in as it came because FFmpeg wasn't there.
fn uncut_kinds(folder: &Path) -> Vec<String> {
    meta_of(folder)["artNeedsFfmpeg"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// Record where the game's `kind` came from now.
pub fn mark_source(folder: &Path, kind: &str, src: &str) {
    let path = crate::library::meta_path(folder);
    let mut v: serde_json::Value = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !v.is_object() { return; }
    if !v["artSource"].is_object() { v["artSource"] = serde_json::json!({}); }
    v["artSource"][kind] = serde_json::Value::String(src.to_string());
    let a = v["artSource"].clone();
    let _ = crate::library::patch_meta(folder, &[("artSource", a)]);
}

// ------------------------------------------------------------- scraping ----

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScrapeSettings {
    /// get the art of newly recognized games by itself
    pub auto: Option<bool>,
    pub sgdb_key: String,
    pub tgdb_key: String,
    pub rawg_key: String,
}
impl ScrapeSettings {
    pub fn auto_on(&self) -> bool { self.auto.unwrap_or(true) }
    pub fn any_key(&self) -> bool { [&self.sgdb_key, &self.tgdb_key, &self.rawg_key].iter().any(|k| !k.trim().is_empty()) }
}

#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeResult {
    pub name: Option<String>,
    pub icon: bool,
    pub background: bool,
    pub preview: bool,
    pub console: Option<String>,
    pub message: String,
}

fn curl() -> Command {
    let mut c = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);   // CREATE_NO_WINDOW
    }
    c.args(["-sSfL", "-A", "MaXMB/1.0"]);
    c
}
fn get(url: &str, headers: &[String]) -> Option<serde_json::Value> {
    let mut c = curl();
    c.args(["--max-time", "25"]);
    for h in headers { c.args(["-H", h]); }
    let out = c.arg(url).output().ok()?;
    if !out.status.success() { return None; }
    serde_json::from_slice(&out.stdout).ok()
}
fn download(url: &str, to: &Path, headers: &[String]) -> bool {
    let mut c = curl();
    c.args(["--max-time", "180", "--max-filesize", "200000000", "-o"]).arg(to);
    for h in headers { c.args(["-H", h]); }
    matches!(c.arg(url).status(), Ok(s) if s.success()) && fs::metadata(to).map(|m| m.len() > 0).unwrap_or(false)
}
/// Is the internet there? (one quick request)
pub fn online() -> bool {
    let mut c = curl();
    c.args(["--max-time", "6", "-o"]).arg(if cfg!(windows) { "NUL" } else { "/dev/null" }).arg("https://www.steamgriddb.com/");
    matches!(c.status(), Ok(s) if s.success())
}
fn enc(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{b:02X}"),
    }).collect()
}

fn words(s: &str) -> Vec<String> {
    s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(|w| w.to_string()).collect()
}
/// How alike two names are, 0..1 (shared words, with a bonus for the same text).
pub fn likeness(a: &str, b: &str) -> f32 {
    let (wa, wb) = (words(a), words(b));
    if wa.is_empty() || wb.is_empty() { return 0.0; }
    if wa == wb { return 1.0; }
    let common = wa.iter().filter(|w| wb.contains(w)).count() as f32;
    let base = 2.0 * common / (wa.len() + wb.len()) as f32;
    let joined = |w: &Vec<String>| w.join("");
    if joined(&wa) == joined(&wb) { 0.98 } else { base * 0.95 }
}
fn norm_name(s: &str) -> String { words(s).join(" ") }
fn best<'a, T>(term: &str, items: &'a [T], name: impl Fn(&T) -> Option<String>) -> Option<(&'a T, String)> {
    items.iter().filter_map(|it| name(it).map(|n| (likeness(term, &n), it, n)))
        .filter(|(s, _, _)| *s >= 0.5)
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(_, it, n)| (it, n))
}
fn url_ext(u: &str) -> String {
    let p = u.split(['?', '#']).next().unwrap_or(u);
    p.rsplit('/').next().and_then(|f| f.rsplit_once('.')).map(|(_, e)| e.to_lowercase()).unwrap_or_default()
}

// Every picture / video the databases have for the game is a candidate; the
// app then picks, for each kind, the biggest one already in the right shape
// (icon 1:1 or 16:9, background 16:9, video 16:9). When none is, the biggest
// one there is gets zoomed in (cut to the shape from its middle).
#[derive(Clone, Debug)]
struct Cand { url: String, w: u64, h: u64, logo: bool }
impl Cand {
    fn new(url: &str, w: u64, h: u64) -> Self { Cand { url: url.to_string(), w, h, logo: false } }
    fn logo(url: &str, w: u64, h: u64) -> Self { Cand { url: url.to_string(), w, h, logo: true } }
    fn ratio(&self) -> Option<f64> { (self.w > 0 && self.h > 0).then(|| self.w as f64 / self.h as f64) }
}
const R169: f64 = 16.0 / 9.0;
fn fits(r: f64, shapes: &[f64]) -> bool { shapes.iter().any(|t| (r / t - 1.0).abs() < 0.035) }

#[derive(Default)]
struct Found {
    name: Option<String>,
    /// the game's platforms, as the databases name them
    platforms: Vec<String>,
    /// the sites' own icons (SteamGridDB icons and grid pictures)
    icons: Vec<Cand>,
    /// big pictures of the game (backgrounds; also the icon when no site has one)
    backgrounds: Vec<Cand>,
    videos: Vec<Cand>,
}

fn steamgriddb(term: &str, key: &str, f: &mut Found) {
    let h = [format!("Authorization: Bearer {}", key.trim())];
    let base = "https://www.steamgriddb.com/api/v2";
    let Some(r) = get(&format!("{base}/search/autocomplete/{}", enc(term)), &h) else { return };
    let list = r["data"].as_array().cloned().unwrap_or_default();
    let Some((g, name)) = best(term, &list, |x| x["name"].as_str().map(str::to_string)) else { return };
    let Some(id) = g["id"].as_u64() else { return };
    if f.name.is_none() { f.name = Some(name); }
    let pic = |u: &str| matches!(url_ext(u).as_str(), "png" | "jpg" | "jpeg" | "webp");
    let vid = |u: &str| matches!(url_ext(u).as_str(), "webm" | "gif" | "mp4");
    // every result, in the site's own order (its first result first)
    let all = |path: &str, ok: &dyn Fn(&str) -> bool, logo: bool, out: &mut Vec<Cand>| {
        if let Some(r) = get(&format!("{base}/{path}"), &h) {
            for x in r["data"].as_array().cloned().unwrap_or_default() {
                if let Some(u) = x["url"].as_str().filter(|u| ok(u)) {
                    let (w, hh) = (x["width"].as_u64().unwrap_or(0), x["height"].as_u64().unwrap_or(0));
                    out.push(if logo { Cand::logo(u, w, hh) } else { Cand::new(u, w, hh) });
                }
            }
        }
    };
    // the icon: the Logos section; the background: the Grids section
    all(&format!("logos/game/{id}?types=static"), &pic, true, &mut f.icons);
    all(&format!("grids/game/{id}?types=static"), &pic, false, &mut f.backgrounds);
    all(&format!("grids/game/{id}?types=animated"), &vid, false, &mut f.videos);
    // (SteamGridDB doesn't say which platforms a game is on)
}

fn thegamesdb(term: &str, key: &str, f: &mut Found) {
    let k = enc(key.trim());
    // every platform in the database
    let Some(r) = get(&format!("https://api.thegamesdb.net/v1.1/Games/ByGameName?apikey={k}&name={}", enc(term)), &[]) else { return };
    let list = r["data"]["games"].as_array().cloned().unwrap_or_default();
    let Some((g, name)) = best(term, &list, |x| x["game_title"].as_str().map(str::to_string)) else { return };
    let Some(id) = g["id"].as_u64() else { return };
    if f.name.is_none() { f.name = Some(name.clone()); }
    // the platforms this game is on: every entry with the same name (one per
    // platform), named through the database's own platform list
    let ids: Vec<u64> = list.iter()
        .filter(|x| x["game_title"].as_str().map(|t| norm_name(t) == norm_name(&name)).unwrap_or(false))
        .filter_map(|x| x["platform"].as_u64()).collect();
    if !ids.is_empty() {
        if let Some(pl) = get(&format!("https://api.thegamesdb.net/v1/Platforms?apikey={k}"), &[]) {
            for pid in ids {
                if let Some(n) = pl["data"]["platforms"][pid.to_string()]["name"].as_str() { f.platforms.push(n.to_string()); }
            }
        }
    }
    let Some(im) = get(&format!("https://api.thegamesdb.net/v1/Games/Images?apikey={k}&games_id={id}&filter%5Btype%5D=fanart,clearlogo"), &[]) else { return };
    let base = im["data"]["base_url"]["original"].as_str().unwrap_or("https://cdn.thegamesdb.net/images/original/").to_string();
    for x in im["data"]["images"][id.to_string()].as_array().cloned().unwrap_or_default() {
        let Some(fname) = x["filename"].as_str() else { continue };
        let (w, hh) = x["resolution"].as_str().and_then(|r| r.split_once('x'))
            .map(|(a, b)| (a.trim().parse().unwrap_or(0), b.trim().parse().unwrap_or(0))).unwrap_or((0, 0));
        match x["type"].as_str() {
            Some("fanart") => f.backgrounds.push(Cand::new(&format!("{base}{fname}"), w, hh)),
            Some("clearlogo") => f.icons.push(Cand::logo(&format!("{base}{fname}"), w, hh)),
            _ => {}
        }
    }
}

/// RAWG (rawg.io): name, platforms, background, screenshots' sizes unknown
/// (read from the pictures themselves) and the trailers (.mp4).
fn rawg(term: &str, key: &str, f: &mut Found) {
    let k = enc(key.trim());
    let Some(r) = get(&format!("https://api.rawg.io/api/games?key={k}&search={}&page_size=10", enc(term)), &[]) else { return };
    let list = r["results"].as_array().cloned().unwrap_or_default();
    let Some((g, name)) = best(term, &list, |x| x["name"].as_str().map(str::to_string)) else { return };
    if f.name.is_none() { f.name = Some(name); }
    for p in g["platforms"].as_array().cloned().unwrap_or_default() {
        if let Some(n) = p["platform"]["name"].as_str() { f.platforms.push(n.to_string()); }
    }
    if let Some(u) = g["background_image"].as_str().filter(|u| !u.is_empty()) { f.backgrounds.push(Cand::new(u, 0, 0)); }
    if let Some(id) = g["id"].as_u64() {
        if let Some(m) = get(&format!("https://api.rawg.io/api/games/{id}/movies?key={k}"), &[]) {
            for mv in m["results"].as_array().cloned().unwrap_or_default() {
                let d = &mv["data"];
                // "max": the biggest version of the trailer
                if let Some(u) = d["max"].as_str().or(d["480"].as_str()) {
                    let big = d["max"].as_str().is_some();
                    f.videos.push(Cand::new(u, if big { 1920 } else { 854 }, if big { 1080 } else { 480 }));
                }
            }
        }
    }
}

/// A picture's size from the first bytes of the file online (no full download).
fn probe_size(url: &str) -> Option<(u64, u64)> {
    let mut c = curl();
    c.args(["--max-time", "20", "-r", "0-262143"]);
    let out = c.arg(url).output().ok()?;
    let sz = imagesize::blob_size(&out.stdout).ok()?;
    Some((sz.width as u64, sz.height as u64))
}
fn fill_sizes(list: &mut [Cand]) {
    for c in list.iter_mut().filter(|c| c.w == 0 || c.h == 0) {
        if let Some((w, h)) = probe_size(&c.url) { c.w = w; c.h = h; }
    }
}
/// The first candidate (SteamGridDB's results, then TheGamesDB's, then
/// RAWG's, each in the site's own order) already in a fitting shape; else the
/// very first one (to be fitted to the shape). `true` = it needs fitting.
fn choose(list: &[Cand], fit: &dyn Fn(f64) -> bool) -> Option<(Cand, bool)> {
    if let Some(c) = list.iter().find(|c| c.ratio().map(|r| fit(r)).unwrap_or(false)) { return Some((c.clone(), false)); }
    list.first().map(|c| (c.clone(), true))
}
/// The icon frame takes any shape from 1:1 to 16:9.
fn icon_fits(r: f64) -> bool { r >= 0.965 && r <= R169 * 1.035 }

/// The console a game belongs to, from what the databases say (PC when it's
/// on PC: a recognized game is a program on this computer; a console that
/// isn't in the app's list keeps its own name).
pub fn console_for(platforms: &[String]) -> Option<String> {
    let map = |p: &str| -> Option<&'static str> {
        let p = p.to_lowercase();
        Some(match p.as_str() {
            "pc" | "windows" | "pc (microsoft windows)" | "linux" | "macos" | "mac os" => "PC",
            "playstation" | "sony playstation" => "PS1", "playstation 2" | "sony playstation 2" => "PS2",
            "playstation 3" | "sony playstation 3" => "PS3", "playstation 4" | "sony playstation 4" => "PS4",
            "playstation 5" | "sony playstation 5" => "PS5", "psp" | "sony psp" | "sony playstation portable" => "PSP", "ps vita" | "sony playstation vita" => "PS Vita",
            "xbox" | "microsoft xbox" => "Xbox", "xbox 360" | "microsoft xbox 360" => "Xbox 360",
            "xbox one" | "microsoft xbox one" => "Xbox One", "xbox series s/x" | "microsoft xbox series s/x" => "Xbox Series X|S",
            "nintendo switch" => "Switch", "nintendo switch 2" => "Switch 2", "wii" | "nintendo wii" => "Wii", "wii u" | "nintendo wii u" => "Wii U",
            "gamecube" | "nintendo gamecube" => "GameCube", "nintendo 64" => "N64", "snes" | "super nintendo (snes)" => "SNES",
            "nes" | "nintendo entertainment system (nes)" => "NES", "game boy" => "Game Boy", "game boy color" => "Game Boy Color",
            "game boy advance" => "GBA", "nintendo ds" => "DS", "nintendo 3ds" => "3DS", "genesis" | "sega genesis" => "Genesis",
            "sega mega drive" => "Genesis", "sega saturn" => "Saturn", "dreamcast" | "sega dreamcast" => "Dreamcast", "game gear" | "sega game gear" => "Game Gear",
            "neo geo" | "neogeo" => "Neo Geo", "turbografx-16" | "pc engine" => "PC Engine",
            _ => return None,
        })
    };
    let all: Vec<&str> = platforms.iter().filter_map(|p| map(p)).collect();
    // a program on this computer: PC when the game is on PC at all
    if all.contains(&"PC") { return Some("PC".into()); }
    // a console that isn't in the app's list: its own name (a custom console)
    all.first().map(|c| c.to_string()).or_else(|| platforms.iter().map(|p| p.trim()).find(|p| !p.is_empty()).map(str::to_string))
}
/// Look the game up (`term`: its cleaned-up name) and put what was found in
/// its folder. `replace`: also replace the art it already has.
/// `screen`: the shape (width / height) of the app's picture, which the
/// background is made to fit.
pub fn scrape(folder: &Path, term: &str, s: &ScrapeSettings, ffmpeg: Option<&Path>, replace: bool, screen: f64) -> ScrapeResult {
    let mut res = ScrapeResult::default();
    let term = crate::gamesrc::clean_title(term);
    if term.trim().is_empty() { res.message = "No name to look for.".into(); return res; }
    if !s.any_key() { res.message = "No game database is set up (Settings > Game Databases).".into(); return res; }
    if !online() { res.message = "No internet connection.".into(); return res; }
    // (PlayStation®Home keeps the system's own look: found by itself, no art)
    if !replace && is_home(folder) { return res; }
    // found by itself (replace off): only where the game has nothing, or
    // only the program's own icon; Get Art Online (replace on): everything
    // (a PS3 game's own art always stays over the databases', even with Get
    // Art Online; only Game Settings changes it)
    let uncut = if ffmpeg.is_some() { uncut_kinds(folder) } else { Vec::new() };
    let can = |k: &str| if replace { art_source(folder, k).as_deref() != Some(SRC_PS3) }
        else { may_replace(folder, k, SRC_DB) || (uncut.iter().any(|u| u == k) && art_source(folder, k).as_deref() == Some(SRC_DB)) };
    // (what's put in as it came, for want of FFmpeg: made again once it's there)
    let mut needs_ff: Vec<&str> = Vec::new();
    // (a kind that's no longer set by the databases isn't waiting for FFmpeg)
    let keep_uncut = |k: &str| uncut_kinds(folder).iter().any(|u| u == k) && art_source(folder, k).as_deref() == Some(SRC_DB);
    let ps3_game = fs::read_to_string(crate::library::meta_path(folder)).ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .map(|v| v["titleId"].as_str().map(|t| !t.is_empty()).unwrap_or(false)).unwrap_or(false);
    // every database with a key is asked (the best picture may be on any);
    // the name comes from the first one that knows the game
    let mut f = Found::default();
    if !s.sgdb_key.trim().is_empty() { steamgriddb(&term, &s.sgdb_key, &mut f); }
    if !s.tgdb_key.trim().is_empty() { thegamesdb(&term, &s.tgdb_key, &mut f); }
    if !s.rawg_key.trim().is_empty() { rawg(&term, &s.rawg_key, &mut f); }
    fill_sizes(&mut f.icons);
    fill_sizes(&mut f.backgrounds);

    let tmpdir = folder.join(".download");
    let _ = fs::create_dir_all(&tmpdir);
    let fetch = |c: &Cand, kind: &str| -> Option<PathBuf> {
        let ext = { let e = url_ext(&c.url); if e.is_empty() { "bin".to_string() } else { e } };
        let raw = tmpdir.join(format!("{kind}.raw.{ext}"));
        download(&c.url, &raw, &[]).then_some(raw)
    };
    // cut a picture / video to a shape from its middle (no smaller than it is)
    let crop = |shape: f64| if (shape - 1.0).abs() < 0.01 { "crop='min(iw,ih)':'min(iw,ih)'".to_string() }
        else if (shape - R169).abs() < 0.001 { "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'".to_string() }
        else { format!("crop='trunc(min(iw,ih*{shape:.5})/2)*2':'trunc(min(ih,iw/{shape:.5})/2)*2'") };
    let screen = if screen.is_finite() && screen > 0.5 && screen < 5.0 { screen } else { R169 };

    // icon: the first logo (SteamGridDB's Logos, TheGamesDB's clear logos)
    // whose shape the icon frame takes (1:1 to 16:9); else the first logo,
    // put on a see-through 16:9 (or square) canvas, whole: a logo cut down
    // would lose its letters. With no logo anywhere, the first background
    // picture, cut to 16:9
    let icon_pick = if !f.icons.is_empty() { choose(&f.icons, &icon_fits) } else { choose(&f.backgrounds, &|r| fits(r, &[R169])) };
    if let Some((c, fix)) = icon_pick.filter(|_| can("icon")) {
        if let Some(raw) = fetch(&c, "icon") {
            let mut file = raw.clone();
            if fix {
                let r = c.ratio().unwrap_or(R169);
                let out = tmpdir.join("icon.png");
                let vf = if c.logo {
                    if r > R169 { "format=rgba,pad=iw:trunc(iw*9/16/2)*2:0:(oh-ih)/2:color=black@0".to_string() }
                    else { "format=rgba,pad='trunc(max(iw,ih)/2)*2':'trunc(max(iw,ih)/2)*2':(ow-iw)/2:(oh-ih)/2:color=black@0".to_string() }
                } else { crop(if r > 1.33 { R169 } else { 1.0 }) };
                if ffmpeg.map(|ff| ffmpeg_run(ff, &raw, &out, &["-vf", &vf, "-frames:v", "1"])).unwrap_or(false) { file = out; }
                if ffmpeg.is_none() { needs_ff.push("icon"); }
            }
            res.icon = set_media(folder, "icon", Some(&file)).is_ok();
            if res.icon { mark_source(folder, "icon", SRC_DB); }
        }
    }
    // background: the first picture in the shape of the app's picture (its
    // Resolution: 16:9 for 3840x2160, or the screen's own, 21:9 or 16:10, with
    // Native): SteamGridDB's Grids, TheGamesDB's fanart, RAWG's background, in
    // that order; else the first one zoomed in to that shape
    if can("background") {
        if let Some((c, zoom)) = choose(&f.backgrounds, &|r| fits(r, &[screen])) {
            if let Some(raw) = fetch(&c, "background") {
                let mut file = raw.clone();
                if zoom {
                    let out = tmpdir.join("background.jpg");
                    if ffmpeg.map(|ff| ffmpeg_run(ff, &raw, &out, &["-vf", &crop(screen), "-frames:v", "1", "-q:v", "2"])).unwrap_or(false) { file = out; }
                    if ffmpeg.is_none() { needs_ff.push("background"); }
                }
                res.background = set_media(folder, "background", Some(&file)).is_ok();
                if res.background { mark_source(folder, "background", SRC_DB); }
            }
        }
    }
    // video / GIF: the first 16:9 one (SteamGridDB's animated Grids, then
    // RAWG's trailers); else the first one zoomed in to 16:9; at most a minute
    if can("preview") {
        let mut vids = f.videos.clone();
        vids.sort_by_key(|c| !c.ratio().map(|r| fits(r, &[R169])).unwrap_or(false));   // (stable: the sites' order stays)
        for c in vids.iter().take(3) {
            let Some(raw) = fetch(c, "preview") else { continue };
            let mut file = raw.clone();
            if let Some(ff) = ffmpeg {
                // its real size, from the file itself
                let real = video_dims(ff, &raw).map(|(w, h)| w as f64 / h as f64).or(c.ratio()).unwrap_or(R169);
                let gif = ext_of(&raw) == "gif";
                let out = tmpdir.join(if gif { "preview.gif" } else { "preview.mp4" });
                let ok = if fits(real, &[R169]) {
                    ffmpeg_run(ff, &raw, &out, &["-t", "60", "-c", "copy", "-an"]) || ffmpeg_run(ff, &raw, &out, &["-t", "60", "-an"])
                } else if gif {
                    ffmpeg_run(ff, &raw, &out, &["-t", "60", "-vf", &crop(R169)])
                } else {
                    ffmpeg_run(ff, &raw, &out, &["-t", "60", "-vf", &format!("{},scale=trunc(iw/2)*2:trunc(ih/2)*2", crop(R169)), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"])
                };
                if ok { file = out; }
            } else { needs_ff.push("preview"); }
            res.preview = set_media(folder, "preview", Some(&file)).is_ok();
            if res.preview { mark_source(folder, "preview", SRC_DB); break; }
        }
    }
    let _ = fs::remove_dir_all(&tmpdir);
    let mut patch: Vec<(&str, serde_json::Value)> = Vec::new();
    if let Some(n) = f.name.as_ref().filter(|n| !n.trim().is_empty()) {
        patch.push(("title", serde_json::Value::String(n.trim().to_string())));
        res.name = Some(n.trim().to_string());
    }
    // the console it belongs to (a PS3 game found by itself stays PS3)
    if let Some(c) = console_for(&f.platforms).filter(|_| replace || !ps3_game) {
        patch.push(("console", serde_json::Value::String(c.clone())));
        res.console = Some(c);
    }
    // (asked: Game Recognition doesn't ask about it again; only what was put
    // in uncut for want of FFmpeg is made again, once FFmpeg is there)
    patch.push(("dbScraped", serde_json::Value::Bool(true)));
    let mut waiting: Vec<String> = needs_ff.iter().filter(|k| match **k { "icon" => res.icon, "background" => res.background, _ => res.preview }).map(|k| k.to_string()).collect();
    if ffmpeg.is_none() {
        for k in ["icon", "background", "preview"] { if !waiting.iter().any(|w| w == k) && keep_uncut(k) && !(match k { "icon" => res.icon, "background" => res.background, _ => res.preview }) { waiting.push(k.into()); } }
    }
    if !waiting.is_empty() { patch.push(("artNeedsFfmpeg", serde_json::json!(waiting))); }
    if !patch.is_empty() { let _ = crate::library::patch_meta(folder, &patch); }
    if waiting.is_empty() && meta_of(folder).get("artNeedsFfmpeg").is_some() {
        if let Some(mut m) = crate::library::read_meta(folder) { m.remove("artNeedsFfmpeg"); let _ = crate::library::write_meta(folder, &m); }
    }
    res.message = if res.name.is_none() && !res.icon && !res.background && !res.preview { "Nothing was found for this game.".into() } else { String::new() };
    res
}

/// A video's width / height, from what ffmpeg says about it.
fn video_dims(ff: &Path, p: &Path) -> Option<(u64, u64)> {
    let mut c = Command::new(ff);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let out = c.arg("-hide_banner").arg("-i").arg(p).output().ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let line = text.lines().find(|l| l.contains("Video:"))?;
    line.split(|c: char| c == ',' || c == ' ').find_map(|tok| {
        let (w, h) = tok.split_once('x')?;
        let (w, h) = (w.parse::<u64>().ok()?, h.parse::<u64>().ok()?);
        (w >= 16 && h >= 16).then_some((w, h))
    })
}

fn ffmpeg_run(ff: &Path, input: &Path, out: &Path, args: &[&str]) -> bool {
    let mut c = Command::new(ff);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c.args(["-y", "-v", "error", "-i"]).arg(input).args(args).arg(out);
    matches!(c.status(), Ok(s) if s.success()) && fs::metadata(out).map(|m| m.len() > 0).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closest_name_wins() {
        assert!(likeness("Hollow Knight", "Hollow Knight") > 0.99);
        assert!(likeness("hollow_knight", "Hollow Knight") > 0.99);
        assert!(likeness("Hollow Knight", "Hollow Knight: Silksong") > likeness("Hollow Knight", "Knight Squad"));
        assert!(likeness("Portal 2", "Portal") < likeness("Portal 2", "Portal 2"));
        assert_eq!(url_ext("https://x/y/abc.WEBM?x=1"), "webm");
    }
    #[test]
    fn first_in_shape_then_first() {
        let l = vec![Cand::new("a", 1920, 620), Cand::new("b", 1280, 720), Cand::new("c", 3840, 2160), Cand::new("d", 4000, 1300)];
        let f169 = |r: f64| fits(r, &[R169]);
        // the first one in the right shape (not the biggest)
        let (c, zoom) = choose(&l, &f169).unwrap();
        assert_eq!((c.url.as_str(), zoom), ("b", false));
        let (c, zoom) = choose(&l[..1], &f169).unwrap();
        assert_eq!((c.url.as_str(), zoom), ("a", true));
        let icons = vec![Cand::logo("wide", 1200, 300), Cand::logo("sq", 512, 512)];
        assert_eq!(choose(&icons, &icon_fits).unwrap().0.url, "sq");
        assert!(choose(&icons[..1], &icon_fits).unwrap().1);
        assert_eq!(console_for(&["Atari 2600".into()]).as_deref(), Some("Atari 2600"));
        assert_eq!(console_for(&["PlayStation 4".into(), "PC".into()]).as_deref(), Some("PC"));
        assert_eq!(console_for(&["PlayStation 4".into()]).as_deref(), Some("PS4"));
    }
    #[test]
    fn art_sources_rank() {
        let d = std::env::temp_dir().join(format!("xmb-artsrc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d); fs::create_dir_all(&d).unwrap();
        fs::write(d.join("game.json"), "{\"title\":\"G\"}").unwrap();
        // nothing yet: anything goes
        assert!(may_replace(&d, "icon", SRC_LOCAL));
        // an older icon file: the program's own; the databases may replace it
        fs::write(d.join("icon.png"), b"x").unwrap();
        assert!(may_replace(&d, "icon", SRC_DB));
        mark_source(&d, "icon", SRC_DB);
        assert!(!may_replace(&d, "icon", SRC_DB) && may_replace(&d, "icon", SRC_PS3));
        mark_source(&d, "icon", SRC_PS3);
        assert!(!may_replace(&d, "icon", SRC_DB) && may_replace(&d, "icon", SRC_USER));
        // removed by you: stays removed
        mark_source(&d, "background", SRC_USER);
        assert!(!may_replace(&d, "background", SRC_PS3));
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(d.join("game.json")).unwrap()).unwrap();
        assert_eq!(v["title"], "G");
        let _ = fs::remove_dir_all(&d);
    }
    #[test]
    fn media_is_replaced_and_kept() {
        let d = std::env::temp_dir().join(format!("xmb_gameart_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("icon.png"), b"old").unwrap();
        let src = d.join("new.jpg"); fs::write(&src, b"new").unwrap();
        set_media(&d, "icon", Some(&src)).unwrap();
        assert!(d.join("icon.jpg").exists() && !d.join("icon.png").exists());
        assert!(!d.join("unused").exists());
        assert!(set_media(&d, "background", Some(&d.join("icon.jpg"))).is_ok());
        set_media(&d, "icon", None).unwrap();
        assert!(current(&d, "icon").is_empty());
        assert!(set_media(&d, "music", Some(&src)).is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
