//! Trophies (PSN > Trophy Collection, and the trophy pop-ups).
//!
//! Only the games in the system have trophies: the games in content\Games
//! (put there by hand or found by Game Recognition, and not deleted). Each
//! one's trophies come from where the game came from:
//!
//! - PS3 games (RPCS3): RPCS3's own trophy folder (dev_hdd0\home\<user>\
//!   trophy\<NP communication ID>: TROPCONF.SFM, TROPUSR.DAT, TROPxxx.PNG),
//!   found through the game's TROPDIR. Their own grades and Platinum.
//! - Steam games: the achievement list (names, descriptions, hidden ones,
//!   pictures, how many players have each) from Steam's public list (no
//!   account needed); which ones are won from Steam's own files on this
//!   computer (appcache\stats, also in Steam's Offline Mode), from the files
//!   Steam emulators keep (offline copies: Goldberg / GSE, CODEX, RUNE,
//!   SKIDROW...), or with a Steam Web API key from the Steam account.
//! - Epic Games, GOG: their stores' achievement lists, with the account
//!   signed in under Linked Accounts.
//! - Any other game: RetroAchievements, matched by name with the games
//!   played on the RetroAchievements account.
//!
//! How the stores are read follows SuccessStory (Lacro59, MIT License),
//! including its Steam emulator reading (removed from SuccessStory 3.7.1,
//! from its history).
//!
//! Trophies of stores without grades get one from how many players have
//! them (PS3 trophies' typical share by grade): under 8 % Gold, under 17 %
//! Silver, otherwise Bronze. Their games get a Platinum ("<Game> Platinum
//! Trophy"), won with the last of the others.
//!
//! Lists and pictures are kept in content\data\cache\trophies, so they're
//! there offline too. While a game runs its trophies are watched: a newly
//! won one shows its pop-up (trophypop.rs).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use crate::accounts::{self, Accounts};
use crate::net;

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Trophy {
    pub id: String,
    pub name: String,
    pub desc: String,
    /// "B", "S", "G" or "P"
    pub grade: String,
    pub hidden: bool,
    /// when it was won (Unix seconds); None: not yet
    pub earned: Option<i64>,
    /// the picture on this computer ("" while it's being fetched)
    pub icon: String,
    /// where the picture comes from (a web address, or a file)
    pub src: String,
    /// share of the players that have it (%), when known
    pub pct: Option<f32>,
    /// the Platinum the system adds to games of other stores
    pub auto_plat: bool,
    /// part of an add-on (DLC), not of the game itself: listed after the game's own, marked
    /// while not won, and not needed for the Platinum
    pub addon: bool,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct TrophySet {
    pub folder: String,
    pub title: String,
    /// rpcs3, steam, epic, gog, ra
    pub source: String,
    /// what the trophies are (source and its ID): games sharing them (copies
    /// of one game) have the same, and are numbered as copies are
    pub key: String,
    pub trophies: Vec<Trophy>,
    pub updated: i64,
    /// what the list was read from (its source, the accounts it used, its
    /// files' dates): the same at the next sync → nothing changed, not read again
    pub sig: String,
    /// when the stores were last asked (unix seconds)
    pub checked: i64,
    /// the list's own picture (a PS3 game's ICON0.PNG): shown when the game has none
    pub icon: String,
    /// an account game not in the system: its store ("steam", "ra", "epic", "gog", "ea")
    pub store: String,
    /// an account game's console (RetroAchievements), "PC" for the stores' games
    pub console: String,
    /// an account game's own icon, as it would be in the system (Steam's logo, else its header;
    /// another store's picture): its Information shows it, where its row shows its banner (`icon`)
    pub game_icon: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct GameRef {
    pub folder: String,
    pub title: String,
    /// how the game starts (its shortcut, program or link): tells a hand-added game's store or program
    #[serde(default)]
    pub launch: String,
    /// an account game's: what changes when it's played (see AcctGame)
    #[serde(default)]
    pub stamp: String,
}

/// Where the trophies' own files are (the cache) and Game Recognition's list (RPCS3 installs).
pub struct Ctx { pub tdir: PathBuf, pub sources: PathBuf }
impl Ctx {
    pub fn of(app: &AppHandle) -> Ctx { Ctx { tdir: crate::paths::trophies_dir(app), sources: crate::paths::game_sources_file(app) } }
}

pub fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) }

/// The PS3's trophy level (1-100) from trophy points (Bronze 15, Silver 30,
/// Gold 90, Platinum 180), as trophies.js levelFor.
pub fn level_for(points: u64) -> u32 {
    let start = |l: u64| -> u64 { match l { 0 | 1 => 0, 2 => 200, 3 => 600, 4 => 1200, 5 => 2400, 6 => 4000,
        7..=12 => 4000 + (l - 6) * 2000, 13..=26 => 16000 + (l - 12) * 8000, 27..=98 => 128000 + (l - 26) * 10000, 99 => 858000, _ => 880000 } };
    let mut l = 1; while l < 100 && points >= start(l + 1) { l += 1; } l as u32
}
pub fn grade_points(g: &str) -> u64 { match g { "P" => 180, "G" => 90, "S" => 30, _ => 15 } }
/// A Steam friend's trophy points as kept on this computer (trophies\friends):
/// what each played game gave, and what its play time was then.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct FriendKept {
    /// the level counted last (None: the games are private)
    pub level: Option<u32>,
    /// the played games and their play times then: the same now → nothing changed
    pub sig: String,
    /// app → (play time in minutes, trophy points)
    pub games: HashMap<String, (u64, u64)>,
    /// how it was counted (KEPT_V: games whose achievements aren't shown aren't counted
    /// as none won; an older count is made again)
    pub v: u32,
    /// when their games or achievements were found private (seconds): until an hour has gone by,
    /// they aren't asked about again; or when a level was counted from all their games (their play
    /// time private): counted again after a day
    pub at: u64,
}
/// A friend found private (their games, or their achievements) less than an hour ago: not
/// counted again, nothing asked of Steam, until then.
pub fn kept_private_fresh(k: &FriendKept, now: u64) -> bool {
    k.v == KEPT_V && k.sig == "private" && k.level.is_none() && k.at > 0 && now >= k.at && now - k.at < PRIVATE_RECHECK
}
const PRIVATE_RECHECK: u64 = 3600;
fn secs_now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }
pub const KEPT_V: u32 = 2;
/// The played games of a friend's list (app, minutes played), at most 300.
pub fn friend_games(v: &Value) -> Option<Vec<(String, u64)>> {
    let games = v["response"]["games"].as_array()?;
    let mut l: Vec<(String, u64)> = games.iter().filter_map(|g| Some((g["appid"].as_u64()?.to_string(), g["playtime_forever"].as_u64().unwrap_or(0))))
        .filter(|(_, t)| *t > 0).collect();
    l.sort();
    l.truncate(300);
    Some(l)
}
/// Their play time kept private (Steam's "Always keep my total playtime private"): every game
/// listed, each at 0 minutes. Then every game they own counts (at most 300), not only the played
/// ones -- none would be, and their level was 1 --, see steam_level_kept.
pub fn friend_time_hidden(v: &Value) -> Option<Vec<(String, u64)>> {
    let games = v["response"]["games"].as_array()?;
    if games.is_empty() || games.iter().any(|g| g["playtime_forever"].as_u64().unwrap_or(0) > 0) { return None; }
    let mut l: Vec<(String, u64)> = games.iter().filter_map(|g| Some((g["appid"].as_u64()?.to_string(), 0))).collect();
    l.sort();
    l.truncate(300);
    Some(l)
}
/// A level counted from all of a friend's games (their play time private) is counted again
/// after a day: nothing tells which games they played since.
pub const HIDDEN_RECOUNT: u64 = 86_400;
pub fn friend_sig(games: &[(String, u64)]) -> String { fnv(&games.iter().map(|(a, t)| format!("{a}:{t}")).collect::<Vec<_>>().join(",")) }
/// A friend's level, asked as little as possible: one request for their games;
/// the same games with the same play times as kept → the kept level, nothing
/// else asked; otherwise only the games played since are read again.
/// None: Steam didn't answer (what's kept stays). Some(level): None = private.
pub fn steam_level_kept(tdir: &Path, key: &str, id: &str, kept: &mut FriendKept) -> Option<Option<u32>> {
    let v = net::get_json(&format!("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={}&steamid={}&include_played_free_games=1",
        net::enc(key), net::enc(id)), &[])?;
    if !v["response"].is_object() { return None; }
    let Some(mut games) = friend_games(&v) else {
        *kept = FriendKept { level: None, sig: "private".into(), games: HashMap::new(), v: KEPT_V, at: secs_now() };
        return Some(None);
    };
    // (their play time private: all their games, counted again once a day)
    let hidden = match friend_time_hidden(&v) { Some(all) => { games = all; true } None => false };
    let sig = if hidden { format!("hidden:{}", friend_sig(&games)) } else { friend_sig(&games) };
    if kept.v != KEPT_V { *kept = FriendKept { v: KEPT_V, ..Default::default() }; }
    let fresh = !hidden || secs_now().saturating_sub(kept.at) < HIDDEN_RECOUNT;
    if !kept.sig.is_empty() && kept.sig == sig && kept.level.is_some() && fresh { return Some(kept.level); }
    let (mut pts, mut failed) = (0u64, 0usize);
    let mut now: HashMap<String, (u64, u64)> = HashMap::new();
    for (app, mins) in &games {
        // (not played since: what it gave then -- with their play time private, nothing says so:
        // every game asked again)
        if !hidden { if let Some((m, p)) = kept.games.get(app) { if m == mins { pts += p; now.insert(app.clone(), (*mins, *p)); continue; } } }
        match steam_game_points(tdir, key, id, app) {
            GamePts::Won(p) => { pts += p; now.insert(app.clone(), (*mins, p)); }
            // (their achievements aren't shown, only their games: as a private profile, "-")
            GamePts::Private => { *kept = FriendKept { level: None, sig: "private".into(), games: HashMap::new(), v: KEPT_V, at: secs_now() }; return Some(None); }
            // (Steam not answering for this game: what's kept for it, asked again next time)
            GamePts::NoAnswer => { failed += 1; if let Some((m, p)) = kept.games.get(app) { pts += p; now.insert(app.clone(), (*m, *p)); } }
        }
    }
    // (Steam didn't answer for many of the games -- too many asked at once, say: not a level
    // made of part of them; the one kept stands, or none yet, and it's counted again later)
    if failed > (games.len() / 20).max(2) {
        crate::log::line("WARN", "steam", &format!("a friend's trophy level: Steam didn't answer for {failed} of {} games", games.len()));
        // (what was read is kept, so the next time only the rest is asked)
        let lv = kept.level;
        *kept = FriendKept { level: lv, sig: String::new(), games: now, v: KEPT_V, at: 0 };
        return lv.map(Some);
    }
    let level = level_for(pts);
    *kept = FriendKept { level: Some(level), sig: if failed == 0 { sig } else { String::new() }, games: now, v: KEPT_V, at: if hidden { secs_now() } else { 0 } };
    Some(Some(level))
}
/// One game's trophy points on a Steam account.
enum GamePts { Won(u64), Private, NoAnswer }
/// One game's trophy points on a Steam account (a game without achievements: 0;
/// too many asked at once: asked again after a moment, twice at most).
fn steam_game_points(tdir: &Path, key: &str, id: &str, app: &str) -> GamePts {
    let url = format!("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid={app}&steamid={}&key={}", net::enc(id), net::enc(key));
    let mut r = None;
    for wait in [0u64, 2000, 5000] {
        if wait > 0 { std::thread::sleep(Duration::from_millis(wait)); }
        r = net::request("GET", &url, &[], None, 20);
        match &r { Some(x) if x.status == 429 || x.status >= 500 => continue, _ => break }
    }
    let Some(r) = r else { return GamePts::NoAnswer };
    if r.status == 429 || r.status >= 500 { return GamePts::NoAnswer; }
    // (400 / 403: the game has no achievements, or they aren't shown: nothing, and that's an answer)
    let Ok(v) = serde_json::from_str::<Value>(&r.text()) else { return if r.ok() { GamePts::Won(0) } else { GamePts::NoAnswer } };
    let err = v["playerstats"]["error"].as_str().unwrap_or("").to_lowercase();
    if err.contains("not public") || err.contains("private") { return GamePts::Private; }
    let Some(list) = v["playerstats"]["achievements"].as_array() else { return GamePts::Won(0) };
    let schema: HashMap<String, Option<f32>> = steam_web_schema(tdir, app, true).into_iter().map(|a| (a.api, a.pct)).collect();
    let mut pts = 0u64;
    let mut all = !list.is_empty();
    for a in list {
        if a["achieved"].as_i64().unwrap_or(0) == 1 {
            let pct = a["apiname"].as_str().and_then(|n| schema.get(n).copied()).flatten();
            pts += grade_points(grade_for(pct));
        } else { all = false; }
    }
    if all { pts += 180; }
    GamePts::Won(pts)
}
/// A grade from how many players have the trophy (see the top of the file).
pub fn grade_for(pct: Option<f32>) -> &'static str {
    match pct { Some(p) if p < 8.0 => "G", Some(p) if p < 17.0 => "S", _ => "B" }
}

/// The Platinum added to a game of another store: won once every other
/// trophy is (on the day of the last one).
fn plat_text(title: &str) -> (String, String) { (format!("{title} Platinum Trophy"), format!("Unlock all {title} trophies")) }
/// A kept list given its game's name as it is now: the list's own, and the added Platinum's name
/// and description, which are made of it (a game renamed in the system since the list was kept).
fn retitle(s: &mut TrophySet, title: &str) {
    s.title = title.to_string();
    let (name, desc) = plat_text(title);
    for t in s.trophies.iter_mut().filter(|t| t.auto_plat) { t.name = name.clone(); t.desc = desc.clone(); }
}
fn add_platinum(title: &str, list: &mut Vec<Trophy>) {
    list.retain(|t| !t.auto_plat);
    if list.is_empty() || list.iter().any(|t| t.grade == "P") { return; }
    // (the game's own trophies: an add-on's aren't needed for it)
    let all = list.iter().filter(|t| !t.addon).all(|t| t.earned.is_some()) && list.iter().any(|t| !t.addon);
    let last = list.iter().filter(|t| !t.addon).filter_map(|t| t.earned).max();
    let (name, desc) = plat_text(title);
    list.insert(0, Trophy {
        id: "__platinum".into(), name, desc,
        grade: "P".into(), hidden: false, earned: if all { last } else { None }, icon: String::new(), src: String::new(),
        pct: None, auto_plat: true, addon: false
    });
}

fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.to_lowercase().bytes() { h ^= b as u64; h = h.wrapping_mul(0x100000001b3); }
    format!("{h:016x}")
}
fn safe(s: &str) -> String { s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect() }

fn meta_of(folder: &Path) -> Value {
    fs::read_to_string(folder.join("game.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

// ================================================================= sources

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
/// (RaGame: a game of this computer found on RetroAchievements by its name, with the game's
/// RetroAchievements ID, so it's still read after the game is renamed; Ra: an account game's,
/// its ID in its folder's name -- or one kept by an older version, read by its name)
enum Src { Rpcs3(PathBuf), Steam(String, Vec<PathBuf>), Epic(String), Gog(String, Vec<PathBuf>), Ra, RaGame(u64) }

/// The folders the game's own files are in (its install folder, its program's folder).
fn game_dirs(meta: &Value, folder: &Path, launch: &str) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(d) = meta["sourceDir"].as_str() { v.push(PathBuf::from(d)); }
    if let Some(e) = meta["sourceExe"].as_str() { if let Some(p) = Path::new(e).parent() { v.push(p.to_path_buf()); } }
    // a game added by hand: its program's folder (through its shortcut)
    let launch = if launch.is_empty() { meta["launch"].as_str().unwrap_or("") } else { launch };
    if !launch.is_empty() && !launch.contains("://") {
        if let Some(d) = crate::launcher::watch_dir(&folder.display().to_string(), launch) { v.push(d); }
        let t = folder.join(launch);
        if t.extension().map(|e| e.eq_ignore_ascii_case(crate::medialib::LINK_EXT)).unwrap_or(false) {
            if let Some(p) = crate::medialib::read_link(&t).and_then(|p| p.parent().map(|d| d.to_path_buf())) { v.push(p); }
        }
    }
    v.retain(|p| p.is_dir()); v.dedup(); v
}

/// The store link a game starts with (its own, or in its .url shortcut).
fn store_link(folder: &Path, meta: &Value, launch: &str) -> Option<String> {
    let launch = if launch.is_empty() { meta["launch"].as_str().unwrap_or("") } else { launch };
    if launch.contains("://") { return Some(launch.to_string()); }
    if launch.to_lowercase().ends_with(".url") {
        return fs::read_to_string(folder.join(launch)).ok().and_then(|t| crate::gamesrc::parse_url_file(&t).target);
    }
    None
}
/// The ways to look a game up by its name (the stores; the tests give their own).
pub struct Lookups<'a> {
    pub ra_has: &'a dyn Fn(&str) -> Option<u64>,
    pub steam_find: &'a dyn Fn(&str) -> Option<String>,
}
fn source_of(app: &AppHandle, acc: &Accounts, g: &GameRef, online: bool) -> Option<Src> {
    // an Epic Games copy without its .mancpn (only .egstore\*.manifest, as
    // Goat Simulator 3): the Epic account's game with its name, when there's one
    if let Some(ns) = epic_by_account(app, acc, g) { return Some(Src::Epic(ns)); }
    let ctx = Ctx::of(app);
    // (offline: only what's on this computer, and the names already looked up)
    source_in(&ctx, acc, g, &Lookups {
        ra_has: &|t: &str| if online { ra_game(acc, t) } else { None },
        steam_find: &|t: &str| steam_by_name(&ctx.tdir, t, online),
    })
}
thread_local! {
    /// A lookup that couldn't be made (offline, a store not answering or
    /// refusing for a while): "none found" then isn't kept as the game having none.
    static LOOKUP_FAILED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
fn lookup_failed() { LOOKUP_FAILED.with(|f| f.set(true)); }
thread_local! {
    /// The trophies of the game being read that only an account showed (not
    /// this computer's files): kept in the trophy record as that account's.
    static ACCT_WON: std::cell::RefCell<HashSet<String>> = std::cell::RefCell::new(HashSet::new());
}
/// Game Settings > Trophies: Off, the game has none (not listed, not in the level).
fn enabled(g: &GameRef) -> bool { is_acct(&g.folder) || meta_of(Path::new(&g.folder))["trophies"].as_bool() != Some(false) }

/// A game's Steam app ID by its name (closest match on Steam's store, very
/// close names only), kept in schemas\names.json: games without a list of their
/// own (unofficial versions, recompilations...) get the official game's.
fn steam_by_name(tdir: &Path, title: &str, online: bool) -> Option<String> {
    let file = tdir.join("schemas").join("names.json");
    let key = title.to_lowercase();
    let mut map: serde_json::Map<String, Value> = fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    if let Some(v) = map.get(&key) {
        // (a miss is asked again after a week)
        let fresh = v["at"].as_i64().map(|t| now() - t < 7 * 86400).unwrap_or(false);
        if v["id"].as_str().map(|s| !s.is_empty()).unwrap_or(false) || fresh { return v["id"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()); }
    }
    if !online { lookup_failed(); return None; }
    // (Steam's store not answering: not asked again this session for this name,
    // nor for any other name for a minute)
    static FAILED: Mutex<Option<(HashSet<String>, Option<Instant>)>> = Mutex::new(None);
    {
        let g = FAILED.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((names, last)) = g.as_ref() {
            if names.contains(&key) || last.map(|t| t.elapsed() < Duration::from_secs(60)).unwrap_or(false) { lookup_failed(); return None; }
        }
    }
    // (Steam's store refuses many searches in a row: one every 1.2 s at most)
    {
        static PACE: Mutex<Option<Instant>> = Mutex::new(None);
        let mut p = PACE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(t) = *p { let gap = Duration::from_millis(1200); if t.elapsed() < gap { std::thread::sleep(gap - t.elapsed()); } }
        *p = Some(Instant::now());
    }
    let Some(r) = net::get_json(&format!("https://store.steampowered.com/api/storesearch/?term={}&cc=us&l=en", net::enc(&clean_title(title))), &[]) else {
        let mut g = FAILED.lock().unwrap_or_else(|e| e.into_inner()); let e = g.get_or_insert_with(|| (HashSet::new(), None));
        e.0.insert(key); e.1 = Some(Instant::now());
        lookup_failed();
        return None;
    };
    let best = r["items"].as_array()?.iter().filter_map(|x| { let n = x["name"].as_str()?;
            let sc = crate::gameart::likeness(&clean_title(title), &clean_title(n));
            Some((if edition_of(title, n) { sc.max(0.95) } else { sc }, x["id"].as_u64()?)) })
        .filter(|(sc, _)| *sc >= 0.9).max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)).map(|(_, id)| id.to_string());
    map.insert(key, serde_json::json!({ "id": best.clone().unwrap_or_default(), "at": now() }));
    let _ = fs::create_dir_all(file.parent()?); let _ = fs::write(&file, Value::Object(map).to_string());
    best
}
/// The names a game can be looked up by: its title, then its folders' names
/// (the ones that look like a game's name).
fn other_names(title: &str, dirs: &[PathBuf]) -> Vec<String> {
    const GENERIC: &[&str] = &["bin", "binaries", "win64", "win32", "x64", "x86", "game", "games", "common", "steamapps", "retail", "system", "exe", "app"];
    let mut out = vec![title.to_string()];
    for d in dirs {
        let Some(n) = d.file_name().map(|n| n.to_string_lossy().replace('_', " ")) else { continue };
        let c = clean_title(&n);
        if c.chars().filter(|ch| ch.is_alphabetic()).count() < 3 || GENERIC.contains(&c.to_lowercase().as_str()) { continue; }
        if !out.iter().any(|o| clean_title(o).eq_ignore_ascii_case(&c)) { out.push(n); }
    }
    out.truncate(3);
    out
}
/// other_names, and the game's program's name ("Doki Doki Literature Club
/// Plus" for a game titled "DokiDokiLitClubPlus").
fn names_of(title: &str, meta: &Value, dirs: &[PathBuf]) -> Vec<String> {
    let mut out = other_names(title, dirs);
    if let Some(stem) = meta["sourceExe"].as_str().and_then(|e| Path::new(e).file_stem()).map(|s| s.to_string_lossy().replace('_', " ")) {
        let c = clean_title(&stem);
        if c.chars().filter(|ch| ch.is_alphabetic()).count() >= 3 && !out.iter().any(|o| clean_title(o).eq_ignore_ascii_case(&c)) { out.insert(1.min(out.len()), stem); }
    }
    out.truncate(3);
    out
}
/// Whether a store's name is the game's with only its edition added
/// ("Mafia III" and "Mafia III: Definitive Edition").
fn edition_of(title: &str, name: &str) -> bool {
    const ED: &[&str] = &["edition", "definitive", "complete", "goty", "game", "of", "the", "year", "remastered", "remaster", "deluxe", "ultimate",
        "enhanced", "director", "directors", "cut", "anniversary", "hd", "gold", "special", "standard", "digital", "classic", "legendary", "premium", "redux"];
    let w = |s: &str| clean_title(s).to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|x| !x.is_empty()).map(|x| x.to_string()).collect::<Vec<_>>();
    let (t, n) = (w(title), w(name));
    !t.is_empty() && n.len() > t.len() && n[..t.len()] == t[..] && n[t.len()..].iter().all(|x| ED.contains(&x.as_str()))
}
/// A title without what unofficial versions add to it ("[Recomp]", "(Decrypted)",
/// "- Unofficial Port", "v1.2"...).
fn clean_title(t: &str) -> String {
    let mut s = String::new(); let mut depth = 0;
    for c in t.chars() { match c { '(' | '[' | '{' => depth += 1, ')' | ']' | '}' => { if depth > 0 { depth -= 1; } } _ if depth == 0 => s.push(c), _ => {} } }
    const NOISE: &[&str] = &["unofficial", "recompiled", "recomp", "decomp", "port", "pc port", "fan port", "remastered mod", "decrypted", "repack", "native"];
    let words: Vec<&str> = s.split(|c: char| c.is_whitespace() || c == '-' || c == '_').filter(|w| !w.is_empty())
        .filter(|w| !NOISE.contains(&w.to_lowercase().as_str()))
        .filter(|w| !(w.len() > 1 && w.starts_with(['v', 'V']) && w[1..].chars().all(|c| c.is_ascii_digit() || c == '.')))
        .collect();
    words.join(" ")
}
/// An RPCS3 trophy folder whose game has this name (TROPCONF.SFM's title).
fn rpcs3_by_name(roots: &[PathBuf], title: &str) -> Option<PathBuf> {
    let want = clean_title(title);
    let mut best: Option<(f32, PathBuf)> = None;
    for r in roots {
        for h in fs::read_dir(r.join("home")).into_iter().flatten().flatten() {
            for d in fs::read_dir(h.path().join("trophy")).into_iter().flatten().flatten() {
                let Ok(b) = fs::read(d.path().join("TROPCONF.SFM")) else { continue };
                let txt = String::from_utf8_lossy(&b);
                let Some(name) = tag(&txt, "title-name").map(|n| xml_unescape(n.trim())) else { continue };
                let sc = crate::gameart::likeness(&want, &clean_title(&name));
                if sc >= 0.85 && best.as_ref().map(|(b, _)| sc > *b).unwrap_or(true) { best = Some((sc, d.path())); }
            }
        }
    }
    best.map(|(_, p)| p)
}
/// A game's trophy source: its store (from Game Recognition, or its shortcut),
/// an offline copy's Steam app ID, or RetroAchievements.
fn source_in(ctx: &Ctx, acc: &Accounts, g: &GameRef, look: &Lookups) -> Option<Src> {
    let folder = Path::new(&g.folder);
    let meta = meta_of(folder);
    if meta["trophies"].as_bool() == Some(false) { return None; }
    let dirs = game_dirs(&meta, folder, &g.launch);
    // a PS3 game: its own trophy folder in RPCS3, or (an unofficial version
    // without a trophy list of its own) the one of the game with its name
    let rp_target = dirs.iter().any(|d| crate::ps3::find_rpcs3(d).is_some() && crate::ps3::hdd_dir(d).is_dir());
    if meta["ps3Key"].is_string() || meta["titleId"].is_string() || meta["console"].as_str().map(|c| c.contains("PS3")).unwrap_or(false) || rp_target {
        let key = meta["ps3Key"].as_str().map(PathBuf::from).or_else(|| dirs.first().cloned()).unwrap_or_default();
        let mut roots = rpcs3_roots(ctx, &key);
        // (first, the RPCS3 the game's own shortcut starts: a disc image or a game kept outside
        // RPCS3 is played in the one its shortcut names, which needn't be the one Game
        // Recognition keeps -- another install's trophies)
        for d in dirs.iter().rev() {
            if crate::ps3::find_rpcs3(d).is_none() { continue; }
            let h = crate::ps3::hdd_dir(d);
            let same = |r: &PathBuf| r.canonicalize().unwrap_or_else(|_| r.clone()) == h.canonicalize().unwrap_or_else(|_| h.clone());
            if h.is_dir() { roots.retain(|r| !same(r)); roots.insert(0, h); }
        }
        if let Some(d) = meta["ps3Key"].as_str().and_then(|k| np_comm_id(Path::new(k))).and_then(|np| rpcs3_dir_in(&np, &roots)) { return Some(Src::Rpcs3(d)); }
        if let Some(d) = rpcs3_by_name(&roots, &g.title) { return Some(Src::Rpcs3(d)); }
        // (not played in RPCS3 yet: the game's own list, nothing won yet)
        if let Some((np, f)) = meta["ps3Key"].as_str().and_then(|k| trp_near(Path::new(k))) {
            if let Some(d) = trp_dir(&ctx.tdir, &np, &f) { return Some(Src::Rpcs3(d)); }
        }
        if let Some(d) = trp_by_name(ctx, &roots, &g.title) { return Some(Src::Rpcs3(d)); }
        // (a shortcut to an RPCS3 kept for one game, its name in another
        // language or shortened: that game's)
        if meta["ps3Key"].is_null() { if let Some(d) = rpcs3_only_set(&roots) { return Some(Src::Rpcs3(d)); } }
        return None;
    }
    // a hand-added game started by its store's link (Steam / Epic shortcuts)
    if meta["store"].is_null() {
        if let Some(l) = store_link(folder, &meta, &g.launch) {
            if let Some(id) = l.strip_prefix("steam://rungameid/").map(|r| r.chars().take_while(|c| c.is_ascii_digit()).collect::<String>()).filter(|i| !i.is_empty()) {
                return Some(Src::Steam(id, dirs));
            }
            if l.starts_with("com.epicgames.launcher://apps/") {
                if let Some(ns) = epic_namespace(&serde_json::json!({ "launch": l }), &dirs) { return Some(Src::Epic(ns)); }
            }
        }
    }
    match meta["store"].as_str().unwrap_or("") {
        "Steam" => if let Some(id) = meta["steamAppId"].as_str() { return Some(Src::Steam(id.to_string(), dirs)); },
        "Epic Games" => if let Some(ns) = epic_namespace(&meta, &dirs) { return Some(Src::Epic(ns)); },
        "GOG" => if let Some(pid) = gog_product(&dirs) { return Some(Src::Gog(pid, dirs)); },
        _ => {}
    }
    // (a copy Epic Games installed -- its .egstore folder --: Epic's game, never Steam's or another
    // store's of the same name; its namespace unknown, the Epic account's game of its name is
    // taken, see source_of)
    if dirs.iter().any(|d| d.join(".egstore").is_dir()) { return epic_namespace(&meta, &dirs).map(Src::Epic); }
    // offline copies of Steam games: their Steam app ID next to the game
    if let Some(id) = dirs.iter().find_map(|d| steam_appid_near(d)) { return Some(Src::Steam(id, dirs)); }
    // (GOG games added by hand: their goggame file in the program's folder)
    if let Some(pid) = gog_product(&dirs) { return Some(Src::Gog(pid, dirs)); }
    if !acc.ra_user.is_empty() && !acc.ra_key.is_empty() { if let Some(id) = (look.ra_has)(&g.title) { return Some(Src::RaGame(id)); } }
    // a game with no list of its own (an unofficial version, a recompilation...):
    // the official game's, by its name (an RPCS3 one played here, or Steam's)
    let roots = rpcs3_roots(ctx, folder);
    if let Some(d) = rpcs3_by_name(&roots, &g.title) { return Some(Src::Rpcs3(d)); }
    if let Some(d) = trp_by_name(ctx, &roots, &g.title) { return Some(Src::Rpcs3(d)); }
    // Steam's list by the game's name, or else by its folder's name ("Grand
    // Theft Auto IV - The Complete Edition" for a game titled "Grand Theft Auto IV")
    for name in names_of(&g.title, &meta, &dirs) {
        if let Some(id) = (look.steam_find)(&name) { return Some(Src::Steam(id, dirs)); }
    }
    None
}

// The sources: RPCS3 (trophies/rpcs3.rs), Steam and its emulators (trophies/steam.rs),
// RetroAchievements, Epic Games and GOG (trophies/stores.rs).
#[path = "trophies/rpcs3.rs"] mod rpcs3;
#[path = "trophies/steam.rs"] mod steam;
#[path = "trophies/stores.rs"] mod stores;
pub(crate) use rpcs3::*;
pub use steam::*;
use stores::*;

// The rest, each in its own file: Account Games (trophies/account_games.rs), the sets and the
// record of the trophies won (trophies/sets.rs), and where each game's trophies come from, the
// sync and the games watched while they run (trophies/sync.rs).
#[path = "trophies/account_games.rs"] mod account_games;
#[path = "trophies/sets.rs"] mod sets;
#[path = "trophies/sync.rs"] mod sync;
pub use account_games::*;
pub use sets::*;
pub use sync::*;

#[cfg(test)]
#[path = "trophy_tests.rs"]
mod perm_tests;

#[cfg(test)]
#[path = "trophies/tests.rs"]
mod tests;

/// The pieces the test campaign checks (campaign_tests.rs).
#[cfg(test)]
pub mod campaign {
    use super::*;
    pub fn acct(id: &str, key: &str) -> Accounts { Accounts { steam_id: id.into(), steam_key: key.into(), ..Default::default() } }
    fn src(kind: &str, id: &str, dirs: &[PathBuf]) -> Src {
        match kind { "rpcs3" => Src::Rpcs3(PathBuf::new()), "steam" => Src::Steam(id.into(), dirs.to_vec()), "gog" => Src::Gog(id.into(), dirs.to_vec()),
            "epic" => Src::Epic(id.into()), _ => Src::Ra }
    }
    pub fn asks(acc: &Accounts, kind: &str, id: &str, dirs: &[PathBuf]) -> bool { asks_stores(acc, &src(kind, id, dirs)) }
    pub fn every(acc: &Accounts, kind: &str) -> u64 { web_every(acc, &src(kind, "1", &[])) }
    pub fn backoff(every: u64, fails: u32) -> u64 { web_wait(every, fails) }
    pub fn now() -> i64 { super::now() }
    /// (the app ID, whether the lookup couldn't be made)
    pub fn by_name(tdir: &Path, name: &str, online: bool) -> (Option<String>, bool) {
        LOOKUP_FAILED.with(|f| f.set(false));
        let r = steam_by_name(tdir, name, online);
        (r, LOOKUP_FAILED.with(|f| f.get()))
    }
    pub fn schema_len(tdir: &Path, appid: &str, web: bool) -> usize { steam_web_schema(tdir, appid, web).len() }
}
