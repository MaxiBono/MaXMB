//! Connect with Steam Friends (Account Management): the Friends column with
//! the Steam account's friends, and the user's own card from the Steam
//! account (name, picture, profile description as the bubble comment, the
//! game being played).
//!
//! With the user's own Steam Web API key (Linked Accounts; its Steam ID typed, or
//! else the account signed in to Steam on this computer): ISteamUser/GetFriendList
//! and GetPlayerSummaries (name, picture, status, game); the profile descriptions
//! from each public profile's page. With only the Steam ID (a public profile with
//! a public friends list): the profile's own public pages, a friend at a time, so
//! the friends come in a few at a time and their status is brought up to date in
//! turns (see keyless_players). The
//! friends' pictures and descriptions are kept as every cache is (the Temp
//! folder, or the system's own with Cache in the App Directory) and only
//! fetched again when changed.

use serde_json::{json, Value};
use std::fs;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::net;

static CACHE: Mutex<Option<(String, Instant, Value)>> = Mutex::new(None);

/// Text from Steam made safe to show on a card: no control, invisible or
/// direction-changing characters, no pile of accents over one letter ("zalgo":
/// two kept per letter), spaces of every kind as one space, and no longer
/// than `max` characters ("…" included: cut at a whole character, "…" after it).
pub fn clean_text(s: &str, max: usize) -> String {
    let mut out = String::new(); let mut marks = 0; let mut space = true;
    for c in s.chars() {
        let u = c as u32;
        // (combining marks: accents put over / under the letter before them)
        let mark = matches!(u, 0x0300..=0x036F | 0x0483..=0x0489 | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F);
        if mark { marks += 1; if marks <= 2 && !space { out.push(c); } continue; }
        marks = 0;
        // (invisible: zero-width and direction marks, soft hyphen, tags, private use, "specials")
        let hidden = matches!(u, 0x00AD | 0x061C | 0x180E | 0x200B | 0x200E | 0x200F | 0x202A..=0x202E | 0x2060..=0x2069 | 0xFEFF | 0xFFF9..=0xFFFF | 0xE0000..=0xE007F | 0xE000..=0xF8FF | 0xF0000..=0x10FFFF);
        if hidden { continue; }
        if c.is_control() && !c.is_whitespace() { continue; }
        if c.is_whitespace() || matches!(u, 0x2800 | 0x3164 | 0x115F | 0x1160 | 0xFFA0) {
            if !space { out.push(' '); space = true; }
            continue;
        }
        out.push(c); space = false;
    }
    let out = out.trim_end().to_string();
    if out.chars().count() <= max { return out; }
    let mut cut: String = out.chars().take(max.saturating_sub(1)).collect();
    // (not in the middle of a joined emoji or a letter with its accents)
    while cut.chars().last().map(|c| matches!(c as u32, 0x200D | 0xFE0F | 0x0300..=0x036F)).unwrap_or(false) { cut.pop(); }
    format!("{}…", cut.trim_end())
}
/// A description's longest text, "…" included (the card's bubble scrolls a long one).
pub const COMMENT_MAX: usize = 256;
/// A name's longest text (Steam's own limit is 32).
pub const NAME_MAX: usize = 48;

fn entity(e: &str) -> Option<char> {
    match e { "amp" => Some('&'), "lt" => Some('<'), "gt" => Some('>'), "quot" => Some('"'), "apos" => Some('\''), "nbsp" => Some(' '), _ => {
        let n = e.strip_prefix('#')?;
        let v = if let Some(h) = n.strip_prefix(['x', 'X']) { u32::from_str_radix(h, 16).ok()? } else { n.parse().ok()? };
        char::from_u32(v)
    } }
}
fn strip_html(s: &str) -> String {
    let mut out = String::new(); let mut in_tag = false;
    let s = s.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n");
    for c in s.chars() { match c { '<' => in_tag = true, '>' if in_tag => in_tag = false, _ if !in_tag => out.push(c), _ => {} } }
    // (&amp; &#39; &#x1F600; ...: once, so "&amp;lt;" stays "&lt;")
    let mut dec = String::new(); let mut rest = out.as_str();
    while let Some(a) = rest.find('&') {
        dec.push_str(&rest[..a]);
        let tail = &rest[a + 1..];
        match tail.find(';').filter(|&e| e <= 10).and_then(|e| entity(&tail[..e]).map(|c| (c, e))) {
            Some((c, e)) => { dec.push(c); rest = &tail[e + 1..]; }
            None => { dec.push('&'); rest = tail; }
        }
    }
    dec.push_str(rest);
    // the first line that says something (a line of only decoration, as the
    // rows of drawings made of symbols, is passed over); none: the first with anything
    let lines: Vec<String> = dec.lines().map(|l| clean_text(l, COMMENT_MAX)).filter(|l| !l.is_empty()).collect();
    lines.iter().find(|l| l.chars().any(|c| c.is_alphanumeric() || (c as u32) >= 0x1F000)).or(lines.first()).cloned().unwrap_or_default()
}
/// A public profile's description ("" when private or empty; None when Steam didn't answer).
fn summary(id: &str) -> Option<String> {
    let r = net::request("GET", &format!("https://steamcommunity.com/profiles/{}/?xml=1", net::enc(id)), &[], None, 12)?;
    if !r.ok() { return None; }
    summary_of(&r.text())
}
fn summary_of(t: &str) -> Option<String> {
    if !t.contains("<profile>") && !t.contains("<steamID64>") { return None; }
    let Some(a) = t.find("<summary>") else { return Some(String::new()) };
    let rest = &t[a + 9..];
    let Some(b) = rest.find("</summary>") else { return Some(String::new()) };
    let raw = rest[..b].trim();
    let raw = raw.strip_prefix("<![CDATA[").and_then(|r| r.strip_suffix("]]>")).unwrap_or(raw);
    let s = strip_html(raw);
    Some(if s.eq_ignore_ascii_case("No information given.") { String::new() } else { s })
}

// ---- without a Steam Web API key: the profile's own public pages ----
fn cdata(s: &str) -> String {
    let s = s.trim();
    s.strip_prefix("<![CDATA[").and_then(|r| r.strip_suffix("]]>")).unwrap_or(s).trim().to_string()
}
/// The Steam IDs of a public profile's friends (its friends page as XML); None:
/// Steam didn't answer, or the friends list isn't public.
fn public_friends_of(t: &str) -> Option<Vec<String>> {
    if !t.contains("<friendsList>") { return None; }
    Some(t.split("<friend>").skip(1).filter_map(|b| {
        let id: String = b.split('<').next().unwrap_or("").trim().to_string();
        (id.len() == 17 && id.chars().all(|c| c.is_ascii_digit())).then_some(id)
    }).collect())
}
/// "Last Online 3 hrs, 12 mins ago" / "Last Online 5 days ago": how long ago, in seconds.
fn last_online_secs(msg: &str) -> Option<i64> {
    let low = msg.to_lowercase();
    let rest = low.split("last online").nth(1)?;
    let (mut total, mut num, mut any): (i64, Option<i64>, bool) = (0, None, false);
    for w in rest.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()) {
        if let Ok(n) = w.parse::<i64>() { num = Some(n); continue; }
        let unit = if w.starts_with("min") { 60 } else if w.starts_with("hr") || w.starts_with("hour") { 3600 } else if w.starts_with("day") { 86400 } else { 0 };
        if unit > 0 { if let Some(n) = num.take() { total += n * unit; any = true; } }
    }
    any.then_some(total)
}
/// A profile's public page (?xml=1) as the Web API's player summary would give it
/// (the same names: steamid, personaname, avatarhash, avatarfull, personastate,
/// gameextrainfo, lastlogoff, communityvisibilitystate), with its description
/// ("summary"). The page tells Online, In-Game or Offline only: Away and Busy
/// show as Online.
fn public_profile_of(t: &str, now: i64) -> Option<Value> {
    use crate::trophies::tag;
    if !t.contains("<profile>") { return None; }
    let id = cdata(tag(t, "steamID64")?);
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) { return None; }
    let get = |n: &str| tag(t, n).map(cdata).unwrap_or_default();
    let state = get("onlineState").to_lowercase();
    let msg = strip_html(&get("stateMessage"));
    let pic = get("avatarFull");
    // (…/avatars/ab/abcdef…_full.jpg: the picture's hash is its file's name)
    let hash: String = pic.rsplit('/').next().unwrap_or("").split(|c| c == '_' || c == '.').next().unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let game = if state == "in-game" { tag(t, "inGameInfo").and_then(|g| tag(g, "gameName")).map(cdata).unwrap_or_default() } else { String::new() };
    Some(json!({
        "steamid": id, "personaname": get("steamID"), "avatarhash": hash, "avatarfull": pic,
        "personastate": if state == "online" || state == "in-game" { 1 } else { 0 },
        "gameextrainfo": game,
        "lastlogoff": last_online_secs(&msg).map(|s| now - s).unwrap_or(0),
        "communityvisibilitystate": if get("privacyState").eq_ignore_ascii_case("public") { 3 } else { 1 },
        "summary": summary_of(t).unwrap_or_default(),
    }))
}
fn public_profile(id: &str) -> Option<Value> {
    let r = net::request("GET", &format!("https://steamcommunity.com/profiles/{}/?xml=1", net::enc(id)), &[], None, 12)?;
    if !r.ok() { return None; }
    public_profile_of(&r.text(), crate::trophies::now())
}
/// At most this many friends not known yet are read in one go, and this many of the
/// known ones (the ones read longest ago) brought up to date: Steam's pages give
/// one profile each, and too many asked for at once are refused.
const KEYLESS_NEW: usize = 48;
/// (the known ones: at most 2 a time, each read again 5 minutes after it was last at the
/// soonest -- every update of the friends (every 30 s then) asking Steam's pages for every one of them
/// made Steam refuse the computer, also at its next start)
const KEYLESS_TURN: usize = 2;
const KEYLESS_AGAIN: i64 = 300;
/// Which friends to read now: the ones not kept yet first (up to `new`), then the
/// ones read longest ago, 5 minutes ago at least (up to `turn`).
fn keyless_pick(ids: &[String], kept: &serde_json::Map<String, Value>, new: usize, turn: usize) -> Vec<String> {
    let mut out: Vec<String> = ids.iter().filter(|i| !kept.contains_key(*i)).take(new).cloned().collect();
    let now = crate::trophies::now();
    let mut old: Vec<(&String, i64)> = ids.iter().filter(|i| kept.contains_key(*i)).map(|i| (i, kept[i]["at"].as_i64().unwrap_or(0))).filter(|(_, at)| now - at >= KEYLESS_AGAIN).collect();
    old.sort_by_key(|(_, at)| *at);
    out.extend(old.into_iter().take(turn).map(|(i, _)| i.clone()));
    out
}
/// The players (the user first, then the friends known so far) from the public
/// pages: the friends' IDs from the user's friends page; each friend's profile
/// kept (players.json: { id: { "p": summary, "at": when read } }), the new ones
/// and the ones read longest ago read now. None: Steam didn't answer, or the
/// profile's friends list isn't public.
/// The Steam IDs on a public friends page itself (each friend's block carries its data-steamid).
fn friends_page_ids(t: &str) -> Option<Vec<String>> {
    if !t.contains("friends_content") && !t.contains("friend_block") && !t.contains("data-steamid") { return None; }
    let mut out: Vec<String> = Vec::new();
    for part in t.split("data-steamid=\"").skip(1) {
        let id: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
        if id.len() == 17 && !out.contains(&id) { out.push(id); }
    }
    Some(out)
}
fn keyless_players(dir: &std::path::Path, own: &str) -> Option<Vec<Value>> {
    // (the friends list read again every 5 minutes; the one read last meanwhile)
    static IDS: Mutex<Option<(String, Instant, Vec<String>)>> = Mutex::new(None);
    let recent = IDS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().filter(|(o, at, _)| o == own && at.elapsed() < Duration::from_secs(KEYLESS_AGAIN as u64)).map(|(_, _, l)| l.clone());
    let ids = match recent {
        Some(l) => l,
        None => match keyless_ids(own) {
            Some(l) => { *IDS.lock().unwrap_or_else(|e| e.into_inner()) = Some((own.to_string(), Instant::now(), l.clone())); l }
            // (Steam not giving the list now: the friends kept from before, asked again at the next update)
            None => {
                let kept: Vec<String> = read_json(&dir.join("players.json")).and_then(|v| v.as_object().map(|m| m.keys().filter(|k| k.as_str() != own).cloned().collect())).unwrap_or_default();
                if kept.is_empty() { return None; }
                kept
            }
        },
    };
    keyless_read(dir, own, ids)
}
/// The friends' Steam IDs from the user's friends list (its XML, else its page).
fn keyless_ids(own: &str) -> Option<Vec<String>> {
    // (the friends list as XML; Steam doesn't always give it any more: its page then)
    let xml = net::request("GET", &format!("https://steamcommunity.com/profiles/{}/friends/?xml=1", net::enc(own)), &[], None, 20);
    let mut ids = xml.as_ref().filter(|r| r.ok()).and_then(|r| public_friends_of(&r.text()));
    if ids.as_ref().map(|l| l.is_empty()).unwrap_or(true) {
        let page = net::request("GET", &format!("https://steamcommunity.com/profiles/{}/friends/", net::enc(own)), &[], None, 20);
        let from_page = page.as_ref().filter(|r| r.ok()).and_then(|r| friends_page_ids(&r.text())).map(|l| l.into_iter().filter(|i| i != own).collect::<Vec<_>>());
        if from_page.as_ref().map(|l| !l.is_empty()).unwrap_or(false) || ids.is_none() { ids = from_page; }
        if ids.is_none() {
            crate::log::line("WARN", "steam", &format!("Steam ID only: the friends list couldn't be read (its XML answered {}, its page {}): is the Friends List public?",
                xml.as_ref().map(|r| r.status.to_string()).unwrap_or_else(|| "nothing".into()), page.as_ref().map(|r| r.status.to_string()).unwrap_or_else(|| "nothing".into())));
        }
    }
    ids
}
fn keyless_read(dir: &std::path::Path, own: &str, ids: Vec<String>) -> Option<Vec<Value>> {
    let file = dir.join("players.json");
    let mut kept = read_json(&file).and_then(|v| v.as_object().cloned()).unwrap_or_default();
    let mut todo: Vec<String> = Vec::new();
    let own_at = kept.get(own).and_then(|k| k["at"].as_i64());
    if own_at.map(|at| crate::trophies::now() - at >= KEYLESS_AGAIN).unwrap_or(true) { todo.push(own.to_string()); }
    todo.extend(keyless_pick(&ids, &kept, KEYLESS_NEW, KEYLESS_TURN));
    let next = Mutex::new(todo.into_iter());
    let got: Mutex<Vec<Value>> = Mutex::new(Vec::new());
    std::thread::scope(|sc| for _ in 0..4 {
        let (next, got) = (&next, &got);
        sc.spawn(move || loop {
            let Some(id) = next.lock().unwrap_or_else(|e| e.into_inner()).next() else { break };
            if let Some(p) = public_profile(&id) { got.lock().unwrap_or_else(|e| e.into_inner()).push(p); }
        });
    });
    let now = crate::trophies::now();
    let got = got.into_inner().unwrap();
    if !got.is_empty() {
        // (their descriptions come with the page: kept as the ones asked for one by one are)
        let _g = SUMS.lock().unwrap_or_else(|e| e.into_inner());
        let mut sm = sums(dir); let before = sm.clone();
        for p in &got {
            let id = p["steamid"].as_str().unwrap_or("").to_string();
            sm.insert(id.clone(), p["summary"].clone());
            ASKED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(id.clone(), Instant::now());
            kept.insert(id, json!({ "p": p, "at": now }));
        }
        if sm != before { write_json(&dir.join("summaries.json"), &Value::Object(sm)); }
        // (friends no longer listed: forgotten)
        kept.retain(|k, _| k == own || ids.contains(k));
        write_json(&file, &Value::Object(kept.clone()));
    }
    let me = kept.get(own)?["p"].clone();
    let mut out = vec![me];
    out.extend(ids.iter().filter_map(|i| kept.get(i).map(|k| k["p"].clone())));
    Some(out)
}

// ---- what's kept on this computer, like every other cache: in the Temp folder
// (%TEMP%\MaXMB\steam_friends\<user>), or with Cache in the App Directory On in
// the system's own folder (content\data\cache\steam_friends\<user>):
// each friend's picture ("<Steam ID>_<picture's hash>.jpg": a new hash is a new
// picture, the old file deleted), the descriptions (summaries.json) and the
// list as Steam last gave it (list.json: shown, signed out, with no internet).
fn digits(id: &str) -> String { id.chars().filter(|c| c.is_ascii_digit()).collect() }
pub fn kept_dir(base: &std::path::Path, user: &str) -> std::path::PathBuf {
    let u: String = user.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    base.join("steam_friends").join(if u.is_empty() { "_".to_string() } else { u })
}
fn dir_of(app: &AppHandle, user: &str) -> std::path::PathBuf {
    let (temp, own) = (kept_dir(&crate::paths::temp_dir(app), user), kept_dir(&crate::paths::data_dir(app).join("cache"), user));
    let (main, other) = if crate::current_settings(app).behavior.cache_in_app_dir { (own, temp) } else { (temp, own) };
    // (the option changed: what was kept goes along, once; kept in both places -- changed
    // back and forth --: only the one in use stays)
    if !main.exists() && other.is_dir() { move_dir(&other, &main); }
    else if main.is_dir() && other.is_dir() { let _ = fs::remove_dir_all(&other); }
    main
}
/// A folder moved (copied then deleted when it's on another drive).
pub fn move_dir(from: &std::path::Path, to: &std::path::Path) {
    if let Some(p) = to.parent() { let _ = fs::create_dir_all(p); }
    if fs::rename(from, to).is_ok() { return; }
    let _ = fs::create_dir_all(to);
    for e in fs::read_dir(from).into_iter().flatten().flatten() { let _ = fs::copy(e.path(), to.join(e.file_name())); }
    let _ = fs::remove_dir_all(from);
}
/// What's remembered this session forgotten (its files deleted: Delete Cache).
pub fn forget_memory() {
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None; *META.lock().unwrap_or_else(|e| e.into_inner()) = None; *ASKED.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *BG_ASKED.lock().unwrap_or_else(|e| e.into_inner()) = None; *LEVELS.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
/// Delete Steam Cache (Cache Management): everything kept of Steam Friends (every
/// user's, both places: pictures, descriptions, card colours, the list, the friends'
/// trophy levels) and the Steam account's own picture -- all read again from Steam.
pub fn cache_files(app: &AppHandle) -> Vec<std::path::PathBuf> {
    let mut v = kept_files(app);
    for u in fs::read_dir(crate::paths::trophies_dir(app).join("friends")).into_iter().flatten().flatten() {
        for f in fs::read_dir(u.path()).into_iter().flatten().flatten() { if f.path().is_file() { v.push(f.path()); } }
    }
    for f in fs::read_dir(crate::paths::steam_avatar_dir(app)).into_iter().flatten().flatten() { if f.path().is_file() { v.push(f.path()); } }
    v
}
/// A user deleted: what's kept of their Steam Friends goes with them (both places, and their friends' levels).
pub fn forget_user_files(app: &AppHandle, user: &str) {
    forget_friends(app, user);
    let _ = fs::remove_dir_all(levels_dir(app, user));
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
/// Every user's kept files, both places (Delete Cache > All).
pub fn kept_files(app: &AppHandle) -> Vec<std::path::PathBuf> {
    let mut v = Vec::new();
    for base in [crate::paths::temp_dir(app), crate::paths::data_dir(app).join("cache")] {
        for u in fs::read_dir(base.join("steam_friends")).into_iter().flatten().flatten() {
            for f in fs::read_dir(u.path()).into_iter().flatten().flatten() { if f.path().is_file() { v.push(f.path()); } }
        }
    }
    v
}
fn write_json(f: &std::path::Path, v: &Value) {
    if let Some(d) = f.parent() { let _ = fs::create_dir_all(d); }
    let _ = crate::paths::write_whole(f, v.to_string());
}
fn read_json(f: &std::path::Path) -> Option<Value> { fs::read_to_string(f).ok().and_then(|t| serde_json::from_str(&t).ok()) }
/// A friend's kept pictures (the newest first).
pub fn pics_of(dir: &std::path::Path, id: &str) -> Vec<std::path::PathBuf> {
    let sid = digits(id); if sid.is_empty() { return vec![]; }
    let mut v: Vec<std::path::PathBuf> = fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with(&format!("{sid}_")) && n.ends_with(".jpg")).unwrap_or(false)).collect()).unwrap_or_default();
    v.sort_by_key(|p| std::cmp::Reverse(fs::metadata(p).and_then(|m| m.modified()).ok()));
    v
}
fn safe_hash(h: &str) -> String { h.chars().filter(|c| c.is_ascii_alphanumeric()).take(64).collect() }
/// The picture to show for a friend now: the kept one with this hash, else
/// the one kept before (until the new one is fetched), else none.
pub fn pic_shown(dir: &std::path::Path, id: &str, hash: &str) -> String {
    let want = dir.join(format!("{}_{}.jpg", digits(id), safe_hash(hash)));
    if !hash.is_empty() && want.is_file() { return want.display().to_string(); }
    pics_of(dir, id).into_iter().next().map(|p| p.display().to_string()).unwrap_or_default()
}
/// The kept files of players who aren't friends any more: deleted.
pub fn prune_pics(dir: &std::path::Path, keep: &std::collections::HashSet<String>) {
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        let Some(n) = p.file_name().and_then(|n| n.to_str()).map(str::to_string) else { continue };
        if !n.ends_with(".jpg") { continue; }
        let id = n.split('_').next().unwrap_or("").to_string();
        if !keep.contains(&id) { let _ = fs::remove_file(p); }
    }
}
static SUMS: Mutex<()> = Mutex::new(());
fn sums(dir: &std::path::Path) -> serde_json::Map<String, Value> {
    read_json(&dir.join("summaries.json")).and_then(|v| v.as_object().cloned()).unwrap_or_default()
}
/// (url, hash, public profile) of each player Steam last listed
static META: Mutex<Option<std::collections::HashMap<String, (String, String, bool)>>> = Mutex::new(None);
/// when each friend's description was last asked for (this session)
static ASKED: Mutex<Option<std::collections::HashMap<String, Instant>>> = Mutex::new(None);
static DBUSY: Mutex<Option<std::collections::HashSet<String>>> = Mutex::new(None);
/// A description is asked for again after this long (a card rested on again).
const SUMMARY_EVERY: Duration = Duration::from_secs(600);

/// One player's picture and description brought up to date: (picture's path, description, anything new?)
fn detail(dir: &std::path::Path, id: &str) -> Option<(String, String, bool)> {
    let (url, hash, open) = META.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(id).cloned())?;
    let mut changed = false;
    let hash = safe_hash(&hash);
    if url.starts_with("https://") && !hash.is_empty() {
        let f = dir.join(format!("{}_{hash}.jpg", digits(id)));
        if !f.is_file() {
            let _ = fs::create_dir_all(dir);
            if net::download(&url, &f) { changed = true; }
        }
        if f.is_file() { for old in pics_of(dir, id) { if old != f { let _ = fs::remove_file(old); } } }
    }
    let kept = sums(dir).get(id).and_then(|v| v.as_str().map(str::to_string));
    let due = ASKED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).get(id).map(|t| t.elapsed() > SUMMARY_EVERY).unwrap_or(true);
    let mut text = kept.clone().unwrap_or_default();
    if due {
        let now = if open { summary(id) } else { Some(String::new()) };
        if let Some(now) = now {
            ASKED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(id.to_string(), Instant::now());
            if kept.as_deref() != Some(now.as_str()) {
                let _g = SUMS.lock().unwrap_or_else(|e| e.into_inner());
                let mut m = sums(dir);
                m.insert(id.to_string(), json!(now));
                write_json(&dir.join("summaries.json"), &Value::Object(m));
                changed = changed || kept.unwrap_or_default() != now;
                text = now;
            }
        }
    }
    Some((pic_shown(dir, id, &hash), text, changed))
}
fn entry(dir: &std::path::Path, sm: &serde_json::Map<String, Value>, p: &Value) -> Value {
    let id = p["steamid"].as_str().unwrap_or("").to_string();
    let hash = p["avatarhash"].as_str().unwrap_or("");
    json!({
        "id": id, "name": clean_text(p["personaname"].as_str().unwrap_or(""), NAME_MAX),
        "avatar": pic_shown(dir, &id, hash),
        "state": p["personastate"].as_i64().unwrap_or(0),
        "game": clean_text(p["gameextrainfo"].as_str().unwrap_or(""), 120),
        "lastLogoff": p["lastlogoff"].as_i64().unwrap_or(0),
        "summary": sm.get(&id).and_then(|v| v.as_str()).unwrap_or(""),
        "avatarHash": hash,
        "bg": bg_kept(dir, &id),
        // (a private profile: its card in the colour Steam shows private profiles in)
        "private": p["communityvisibilitystate"].as_i64().map(|v| v != 3).unwrap_or(false) || private_kept(dir, &id),
    })
}
/// The kept list with the pictures and descriptions kept now.
fn kept_list(dir: &std::path::Path) -> Option<Value> {
    // (a list damaged meanwhile -- not what was kept -- counts as none kept)
    let mut v = read_json(&dir.join("list.json")).filter(|v| v.is_object())?;
    let sm = sums(dir);
    let fix = |p: &mut Value| {
        if !p.is_object() { return; }
        let id = p["id"].as_str().unwrap_or("").to_string(); if id.is_empty() { return; }
        let hash = p["avatarHash"].as_str().unwrap_or("").to_string();
        p["avatar"] = json!(pic_shown(dir, &id, &hash));
        p["summary"] = json!(sm.get(&id).and_then(|v| v.as_str()).unwrap_or(""));
        p["bg"] = json!(bg_kept(dir, &id));
        if private_kept(dir, &id) { p["private"] = json!(true); }
    };
    if let Some(me) = v.get_mut("me") { fix(me); }
    if let Some(a) = v.get_mut("friends").and_then(|f| f.as_array_mut()) { a.retain(|p| p.is_object()); for p in a { fix(p); } }
    Some(v)
}

/// The friends as Steam lists them now, with what's kept of each on this
/// computer (picture, description): nothing is fetched for them here, so a
/// long list is there at once; `steam_friend_details` brings the ones near the
/// cursor up to date. With no internet (also at a start without it): the list as it was
/// last kept, shown just as it was then until Steam answers again.
#[tauri::command]
pub async fn steam_friends(app: AppHandle, user: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let acc = crate::accounts::get(&app, &user);
        // (a key alone: the account signed in to Steam on this computer -- accounts::get; an ID alone: its public pages)
        if acc.steam_id.is_empty() { return Err("no account".to_string()); }
        if let Some((u, t, v)) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).clone() { if u == user && t.elapsed() < Duration::from_secs(25) { return Ok(v); } }
        let dir = dir_of(&app, &user);
        let offline = |why: &str| -> Result<Value, String> {
            match kept_list(&dir).filter(|v| v["me"]["id"].as_str() == Some(acc.steam_id.as_str())) {
                Some(mut v) => { v["offline"] = json!(true); Ok(v) }
                None => Err(why.to_string()),
            }
        };
        if !net::online() { return offline("offline"); }
        let mut players: Vec<Value> = Vec::new();
        if acc.steam_key.is_empty() {
            match keyless_players(&dir, &acc.steam_id) { Some(p) => players = p, None => return offline(if net::community_resting() {
                "Steam is refusing this computer for a few minutes (too many requests)" } else { "Steam didn't answer, or the profile's friends aren't public" }) }
        } else {
        let key = net::enc(&acc.steam_key);
        let list = net::get_json(&format!("https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key={key}&steamid={}&relationship=friend", net::enc(&acc.steam_id)), &[]);
        let mut ids: Vec<String> = list.as_ref().and_then(|v| v["friendslist"]["friends"].as_array().cloned()).unwrap_or_default()
            .iter().filter_map(|f| f["steamid"].as_str().map(|s| s.to_string())).collect();
        ids.insert(0, acc.steam_id.clone());
        for chunk in ids.chunks(100) {
            if let Some(v) = net::get_json(&format!("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={key}&steamids={}", chunk.join(",")), &[]) {
                players.extend(v["response"]["players"].as_array().cloned().unwrap_or_default());
            }
        }
        }
        if players.is_empty() { return offline("Steam didn't answer"); }
        // (the user's own picture: a changed one replaces the kept avatar)
        let sid = digits(&acc.steam_id);
        if let Some(p) = players.iter().find(|p| p["steamid"].as_str() == Some(acc.steam_id.as_str())) { keep_own(&app, &sid, p); }
        {
            let mut g = META.lock().unwrap_or_else(|e| e.into_inner()); let m = g.get_or_insert_with(Default::default); m.clear();
            for p in &players {
                m.insert(p["steamid"].as_str().unwrap_or("").to_string(), (p["avatarfull"].as_str().unwrap_or("").to_string(),
                    p["avatarhash"].as_str().unwrap_or("").to_string(), p["communityvisibilitystate"].as_i64().unwrap_or(1) == 3));
            }
        }
        // (the user's own card: brought up to date here)
        let _ = detail(&dir, &acc.steam_id);
        prune_pics(&dir, &players.iter().map(|p| digits(p["steamid"].as_str().unwrap_or(""))).collect());
        // (and the trophy levels kept of players who aren't friends any more)
        {
            let ids: std::collections::HashSet<String> = players.iter().map(|p| digits(p["steamid"].as_str().unwrap_or(""))).collect();
            for e in fs::read_dir(levels_dir(&app, &user)).into_iter().flatten().flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if let Some(id) = n.strip_suffix(".json") { if !ids.contains(id) { let _ = fs::remove_file(e.path()); } }
            }
        }
        // (the list read, compared and kept as one step, apart from a friend's own check of their
        // public page, list_private: each change of a profile's privacy found once, by one of them)
        let list_lock = LIST.lock().unwrap_or_else(|e| e.into_inner());
        let sm = sums(&dir);
        let all: Vec<Value> = players.iter().map(|p| entry(&dir, &sm, p)).collect();
        let me = all.iter().find(|p| p["id"] == acc.steam_id.as_str()).cloned().unwrap_or(Value::Null);
        let mut friends: Vec<Value> = all.into_iter().filter(|p| p["id"] != acc.steam_id.as_str()).collect();
        friends.sort_by_key(|p| p["name"].as_str().unwrap_or("").to_lowercase());
        let v = json!({ "me": me, "friends": friends });
        // (a friend whose profile went public or private since it was last checked: their trophy
        // level counted again -- or "-" --, see privacy_changed)
        let before = read_json(&dir.join("list.json"));
        let was: std::collections::HashMap<String, bool> = before.as_ref().and_then(|b| b["friends"].as_array().cloned()).unwrap_or_default().iter()
            .filter_map(|p| Some((p["id"].as_str()?.to_string(), p["private"].as_bool().unwrap_or(false)))).collect();
        let changed: Vec<String> = v["friends"].as_array().into_iter().flatten()
            .filter_map(|p| { let id = p["id"].as_str()?; let w = *was.get(id)?; (w != p["private"].as_bool().unwrap_or(false)).then(|| id.to_string()) }).collect();
        if before.as_ref() != Some(&v) { write_json(&dir.join("list.json"), &v); }
        *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((user.clone(), Instant::now(), v.clone()));
        drop(list_lock);
        if !changed.is_empty() { privacy_changed(&app, &user, changed); }
        Ok(v)
    }).await.map_err(|e| e.to_string())?
}

/// The pictures and descriptions of the friends asked for (the ones near the
/// cursor) brought up to date, a few at a time: a picture is fetched only when
/// Steam's hash for it isn't the kept one, a description asked for again at
/// most every 10 minutes and written only when it changed. Each one with
/// something new is told to the page ("steam-friend-detail": { id, avatar, summary }).
#[tauri::command]
pub fn steam_friend_details(app: AppHandle, user: String, ids: Vec<String>) {
    std::thread::spawn(move || {
        if !net::online() { return; }
        let dir = dir_of(&app, &user);
        // (with the Steam ID alone: the friends' privacy as their public pages gave it, players.json)
        let keyless = crate::accounts::get(&app, &user).steam_key.is_empty();
        let players = if keyless { read_json(&dir.join("players.json")).and_then(|v| v.as_object().cloned()).unwrap_or_default() } else { Default::default() };
        let players = &players;
        let next = Mutex::new(ids.into_iter().filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_digit())));
        std::thread::scope(|sc| for _ in 0..4 {
            let (app, dir, next, user) = (&app, &dir, &next, &user);
            sc.spawn(move || loop {
                let Some(id) = next.lock().unwrap_or_else(|e| e.into_inner()).next() else { break };
                if !DBUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(id.clone()) { continue; }
                let d = detail(dir, &id);
                let known = players.get(&id).and_then(|k| k["p"]["communityvisibilitystate"].as_i64()).map(|v| v != 3);
                let bg = bg_detail(dir, &id, known);
                // (their public page now says otherwise, and the list didn't show it yet: their
                // level counted again, or "-")
                if let Some((_, p)) = bg.as_ref() { if list_private(dir, user, &id, *p) { privacy_changed(app, user, vec![id.clone()]); } }
                DBUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).remove(&id);
                let Some((avatar, text, changed)) = d else { continue };
                if !changed && bg.is_none() { continue; }
                let (bg, private) = bg.unwrap_or_else(|| (bg_kept(dir, &id), private_kept(dir, &id)));
                // (the list kept this session too, so it isn't drawn back as it was)
                if let Some((u, _, v)) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                    if u == user { if let Some(a) = v["friends"].as_array_mut() {
                        for p in a.iter_mut().filter(|p| p["id"] == id.as_str()) { p["avatar"] = json!(avatar); p["summary"] = json!(text); p["bg"] = json!(bg); p["private"] = json!(private || api_private(&id)); }
                    } }
                }
                let _ = app.emit("steam-friend-detail", json!({ "id": id, "avatar": avatar, "summary": text, "bg": bg, "private": private }));
            });
        });
    });
}
// ---- the friends' card colours: their Steam profile background's main colour
// (the page matches it to the nearest card colour). Kept with the pictures
// (bgcolors.json: { id: { "img": the background's address, "color": "#rrggbb" or "" } }),
// asked again with the descriptions; the picture is fetched only when it changed.
static BGS: Mutex<()> = Mutex::new(());
static BG_ASKED: Mutex<Option<std::collections::HashMap<String, Instant>>> = Mutex::new(None);
const STEAM_IMAGES: &str = "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/";
fn bgs(dir: &std::path::Path) -> serde_json::Map<String, Value> {
    read_json(&dir.join("bgcolors.json")).and_then(|v| v.as_object().cloned()).unwrap_or_default()
}
/// The colour kept for a friend ("" when none: no background, or not known yet).
pub fn bg_kept(dir: &std::path::Path, id: &str) -> String { bgs(dir).get(id).and_then(|v| v["color"].as_str()).unwrap_or("").to_string() }
/// Whether a friend's profile is private to everyone but their friends (as their public page
/// says: Steam's Web API shows a friends-only profile as public to a friend's key), as kept.
pub fn private_kept(dir: &std::path::Path, id: &str) -> bool { bgs(dir).get(id).and_then(|v| v["private"].as_bool()).unwrap_or(false) }
/// A profile's privacy as anyone sees it (its public page): Some(true) private or friends only.
fn public_private(id: &str) -> Option<bool> {
    let r = net::request("GET", &format!("https://steamcommunity.com/profiles/{}/?xml=1", net::enc(id)), &[], None, 12)?;
    if !r.ok() { return None; }
    let t = r.text();
    if !t.contains("<profile>") { return None; }
    let state = crate::trophies::tag(&t, "privacyState").map(cdata).unwrap_or_default().to_lowercase();
    Some(!state.is_empty() && state != "public")
}
/// The address of a profile's background as GetProfileItemsEquipped gives it
/// (Some(""): none equipped; None: no answer).
fn equipped_bg_of(v: &Value) -> Option<String> {
    let r = v.get("response")?;
    let p = r["profile_background"]["image_large"].as_str().unwrap_or("").trim();
    Some(if p.is_empty() { String::new() } else if p.starts_with("https://") { p.to_string() } else { format!("{STEAM_IMAGES}{}", p.trim_start_matches('/')) })
}
/// The same from the profile's own page (its background picture, or an animated one's still).
fn page_bg_of(t: &str) -> Option<String> {
    if !t.contains("profile_page") { return None; }
    let Some(i) = t.find("has_profile_background") else { return Some(String::new()) };
    let rest = &t[i..t.len().min(i + 4000)];
    let url = |s: &str| -> Option<String> {
        let a = s.find("https://")?; let u: String = s[a..].chars().take_while(|c| !matches!(c, '\'' | '"' | ')' | ' ')).collect();
        (u.contains(".jpg") || u.contains(".png") || u.contains(".webp")).then_some(u)
    };
    if let Some(b) = rest.find("background-image") { if let Some(u) = url(&rest[b..rest.len().min(b + 400)]) { return Some(u); } }
    if let Some(b) = rest.find("poster=") { if let Some(u) = url(&rest[b..rest.len().min(b + 400)]) { return Some(u); } }
    Some(String::new())
}
fn equipped_bg(id: &str) -> Option<String> {
    if let Some(r) = net::request("GET", &format!("https://api.steampowered.com/IPlayerService/GetProfileItemsEquipped/v1/?steamid={}", net::enc(id)), &[], None, 12) {
        if r.ok() { if let Some(u) = r.json().as_ref().and_then(equipped_bg_of) { return Some(u); } }
    }
    let r = net::request("GET", &format!("https://steamcommunity.com/profiles/{}/", net::enc(id)), &[], None, 15)?;
    if !r.ok() { return None; }
    page_bg_of(&r.text())
}
/// A picture's main colour: its pixels in 512 groups of like colours, the
/// largest group's average ("#rrggbb").
pub fn main_color(px: &[[u8; 3]]) -> Option<String> {
    if px.is_empty() { return None; }
    let mut n = vec![0u32; 512]; let mut sum = vec![[0u64; 3]; 512];
    for p in px {
        let k = ((p[0] as usize >> 5) << 6) | ((p[1] as usize >> 5) << 3) | (p[2] as usize >> 5);
        n[k] += 1; for c in 0..3 { sum[k][c] += p[c] as u64; }
    }
    let k = (0..512).max_by_key(|&k| n[k])?;
    let a = |c: usize| (sum[k][c] / n[k].max(1) as u64) as u8;
    Some(format!("#{:02x}{:02x}{:02x}", a(0), a(1), a(2)))
}
fn picture_color(f: &std::path::Path) -> Option<String> {
    let img = image::open(f).ok()?.thumbnail(64, 64).to_rgb8();
    main_color(&img.pixels().map(|p| p.0).collect::<Vec<_>>())
}
/// A friend's card colour brought up to date: Some((colour, private)) when either changed.
fn bg_detail(dir: &std::path::Path, id: &str, known_private: Option<bool>) -> Option<(String, bool)> {
    let due = BG_ASKED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).get(id).map(|t| t.elapsed() > SUMMARY_EVERY).unwrap_or(true);
    if !due { return None; }
    let kept = bgs(dir).get(id).cloned().unwrap_or(Value::Null);
    // (private to everyone but their friends: the colour Steam shows private profiles in, steamfriends.js;
    // with the Steam ID alone their public page was read already, and says it)
    let private = known_private.or_else(|| public_private(id)).unwrap_or_else(|| kept["private"].as_bool().unwrap_or(false));
    let url = equipped_bg(id)?;
    BG_ASKED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(id.to_string(), Instant::now());
    if kept["img"].as_str() == Some(url.as_str()) && kept.get("color").is_some() {
        if kept["private"].as_bool().unwrap_or(false) == private { return None; }
        let _g = BGS.lock().unwrap_or_else(|e| e.into_inner());
        let mut m = bgs(dir);
        if let Some(e) = m.get_mut(id) { e["private"] = json!(private); }
        write_json(&dir.join("bgcolors.json"), &Value::Object(m));
        return Some((kept["color"].as_str().unwrap_or("").to_string(), private));
    }
    let color = if url.is_empty() { String::new() } else {
        let _ = fs::create_dir_all(dir);
        let f = dir.join(format!("bg_{}.part.jpg", digits(id)));
        let c = if net::download(&url, &f) { picture_color(&f) } else { None };
        let _ = fs::remove_file(&f);
        // (the picture couldn't be read: asked again next time)
        c?
    };
    let _g = BGS.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = bgs(dir);
    m.insert(id.to_string(), json!({ "img": url, "color": color, "private": private }));
    write_json(&dir.join("bgcolors.json"), &Value::Object(m));
    (kept["color"].as_str() != Some(color.as_str()) || kept["private"].as_bool().unwrap_or(false) != private).then_some((color, private))
}
/// Everything kept of the Steam friends deleted (Remove All Accounts Information).
pub fn forget_friends(app: &AppHandle, user: &str) {
    let _ = fs::remove_dir_all(kept_dir(&crate::paths::temp_dir(app), user));
    let _ = fs::remove_dir_all(kept_dir(&crate::paths::data_dir(app).join("cache"), user));
    *META.lock().unwrap_or_else(|e| e.into_inner()) = None; *ASKED.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// The Steam account's own pictures kept (content\data\cache\steam_avatar):
/// "<Steam ID>_<picture's hash>.jpg".
fn own_files(dir: &std::path::Path, sid: &str) -> Vec<std::path::PathBuf> {
    fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with(&format!("{sid}_")) && n.ends_with(".jpg")).unwrap_or(false)).collect()).unwrap_or_default()
}
/// The account's picture as Steam has it now (its summary: "avatarhash",
/// "avatarfull"): a picture not kept yet is saved and the old one deleted.
fn keep_own(app: &AppHandle, sid: &str, p: &Value) {
    let hash: String = p["avatarhash"].as_str().unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric()).take(64).collect();
    let pic = p["avatarfull"].as_str().unwrap_or("");
    if hash.is_empty() || !pic.starts_with("https://") || sid.is_empty() { return; }
    let dir = crate::paths::steam_avatar_dir(app);
    let f = dir.join(format!("{sid}_{hash}.jpg"));
    let new = !f.is_file();
    if !new || net::download(pic, &f) {
        for old in own_files(&dir, sid) { if old != f { let _ = fs::remove_file(old); } }
    }
    if new { prune_own(app); }
}
/// The Steam pictures kept of accounts no user here has any more (a Steam ID changed or removed, a user deleted): deleted.
pub fn prune_own(app: &AppHandle) {
    let ids = crate::accounts::steam_ids(app);
    for e in fs::read_dir(crate::paths::steam_avatar_dir(app)).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        let sid = n.split('_').next().unwrap_or("");
        if n.ends_with(".jpg") && !ids.contains(sid) { let _ = fs::remove_file(e.path()); }
    }
}

/// The kept Steam picture deleted (Remove All Accounts Information).
pub fn forget_own_avatar(app: &AppHandle, steam_id: &str) {
    let sid: String = steam_id.chars().filter(|c| c.is_ascii_digit()).collect();
    if sid.is_empty() { return; }
    for f in own_files(&crate::paths::steam_avatar_dir(app), &sid) { let _ = fs::remove_file(f); }
}

/// The user's own Steam picture (Linked Accounts: Steam Web API Key and Steam
/// ID), kept in the system's folder so it can be the account's avatar: its
/// path ("" without a Steam account or a picture). refresh: Steam asked for it
/// again first (a changed picture replaces the kept one). While Connect with
/// Steam Friends is On, it's also checked with every update of the friends
/// (steam_friends, every minute).
#[tauri::command]
pub async fn steam_own_avatar(app: AppHandle, user: String, refresh: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let acc = crate::accounts::get(&app, &user);
        let sid: String = acc.steam_id.chars().filter(|c| c.is_ascii_digit()).collect();
        if sid.is_empty() { return Ok(String::new()); }
        if refresh {
            if acc.steam_key.is_empty() {
                // (no key: the profile's public page)
                if let Some(p) = public_profile(&sid) { keep_own(&app, &sid, &p); }
            } else {
                let url = format!("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={}&steamids={sid}", net::enc(&acc.steam_key));
                if let Some(v) = net::get_json(&url, &[]) { keep_own(&app, &sid, &v["response"]["players"][0]); }
            }
        }
        let dir = crate::paths::steam_avatar_dir(&app);
        Ok(own_files(&dir, &sid).into_iter().next().map(|p| p.display().to_string()).unwrap_or_default())
    }).await.map_err(|e| e.to_string())?
}

/// The friends' levels known this session, with when they were counted. Only a friend whose
/// profile is public but whose games or achievements were found private is asked about again,
/// an hour after (LEVEL_RECOUNT, and trophies.rs PRIVATE_RECHECK: one request, their games), to
/// see whether they were made public; a counted level stands for the session, and a private
/// profile is never asked about (a change of it is seen at the status checks: privacy_changed).
static LEVELS: Mutex<Option<std::collections::HashMap<String, (Option<u32>, Instant)>>> = Mutex::new(None);
pub const LEVEL_RECOUNT: Duration = Duration::from_secs(3600);
/// Whether a friend's level is to be counted (asked of Steam, unless their profile is private):
/// never counted this session, or found private ("-") an hour or more ago.
pub(crate) fn level_due(known: Option<&(Option<u32>, Instant)>) -> bool {
    match known { None => true, Some((Some(_), _)) => false, Some((None, at)) => at.elapsed() >= LEVEL_RECOUNT }
}
/// The friends' trophy levels, counted as the system counts the user's (their
/// public game details: every played game's achievements by grade, plus the
/// Platinum of a completed one). Only the friends asked for (the ones near the
/// cursor) are counted. Each is kept on this computer (trophies\friends\<user>)
/// with the play time of every game it was counted from: asked again, one
/// request tells whether anything changed; unchanged, the kept level stands,
/// otherwise only the games played since are read again. Each is told to the
/// page as it's known ("steam-friend-level": { id, level }, level null when private).
#[tauri::command]
pub fn steam_friend_levels(app: AppHandle, user: String, ids: Vec<String>) {
    std::thread::spawn(move || {
        let acc = crate::accounts::get(&app, &user);
        if acc.steam_key.is_empty() { return; }
        let tdir = crate::paths::trophies_dir(&app);
        let todo: Vec<String> = {
            let mut g = LEVELS.lock().unwrap_or_else(|e| e.into_inner()); let m = g.get_or_insert_with(Default::default);
            for id in &ids { if let Some((l, _)) = m.get(id) { let _ = app.emit("steam-friend-level", json!({ "id": id, "level": l })); } }
            ids.into_iter().filter(|i| level_due(m.get(i)) && i.chars().all(|c| c.is_ascii_digit())).collect()
        };
        // (offline: not counted now, so not taken for private: asked again later)
        if !net::online() { return; }
        // (the friends whose profile is private, as the kept list and their pages say)
        let private = private_ids(&dir_of(&app, &user));
        let private = &private;
        let next = Mutex::new(todo.into_iter());
        std::thread::scope(|sc| for _ in 0..3 {
            let (app, acc, tdir, next, user) = (&app, &acc, &tdir, &next, &user);
            sc.spawn(move || loop {
                let Some(id) = next.lock().unwrap_or_else(|e| e.into_inner()).next() else { break };
                // (being counted by another request: not twice)
                if !BUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(id.clone()) { continue; }
                let f = level_file(app, user, &id);
                let mut kept: crate::trophies::FriendKept = fs::read_to_string(&f).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
                // (a private friend -- the whole profile, or only their games and achievements, found
                // so the last time --: not counted, nothing asked of Steam; "-" on their card)
                if private.contains(&id) || crate::trophies::kept_private_fresh(&kept, now_secs()) {
                    BUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).remove(&id);
                    LEVELS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(id.clone(), (None, Instant::now()));
                    let _ = app.emit("steam-friend-level", json!({ "id": id, "level": Value::Null }));
                    continue;
                }
                let before = kept.clone();
                let lv = crate::trophies::steam_level_kept(tdir, &acc.steam_key, &id, &mut kept);
                BUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).remove(&id);
                // (what was read is kept, a count Steam stopped answering in the middle of too)
                if kept != before {
                    let _ = fs::create_dir_all(f.parent().unwrap());
                    if let Ok(t) = serde_json::to_string(&kept) { let _ = crate::paths::write_whole(&f, t); }
                }
                // (Steam didn't answer: what's kept stays shown, asked again later)
                let Some(lv) = lv else { continue };
                LEVELS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(id.clone(), (lv, Instant::now()));
                let _ = app.emit("steam-friend-level", json!({ "id": id, "level": lv }));
            });
        });
    });
}
static BUSY: Mutex<Option<std::collections::HashSet<String>>> = Mutex::new(None);
/// The kept list (list.json) read and written by one at a time: the list itself (steam_friends)
/// and a friend's own check of their public page (list_private).
static LIST: Mutex<()> = Mutex::new(());
/// Private as Steam's Web API last listed the friend (not public to everyone).
fn api_private(id: &str) -> bool { META.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(id)).map(|m| !m.2).unwrap_or(false) }
/// A friend's privacy as their public page now says, put in the kept list (list.json) and this
/// session's: true when the list showed otherwise. Both checks found every change before --
/// the public page first, then the list a minute later, which shows the page's answer too --,
/// so each friend whose profile changed had their level counted twice (two "changed their
/// profile's privacy" lines, Steam asked twice for a profile gone public); now only the check
/// that finds it first counts it.
fn list_private(dir: &std::path::Path, user: &str, id: &str, private: bool) -> bool {
    let shown = private || api_private(id);
    let _g = LIST.lock().unwrap_or_else(|e| e.into_inner());
    let f = dir.join("list.json");
    let Some(mut v) = read_json(&f) else { return false };
    let mut changed = false;
    for p in v["friends"].as_array_mut().into_iter().flatten().filter(|p| p["id"] == id) {
        if p["private"].as_bool().unwrap_or(false) != shown { p["private"] = json!(shown); changed = true; }
    }
    if changed { write_json(&f, &v); }
    if let Some((u, _, c)) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        if u == user { for p in c["friends"].as_array_mut().into_iter().flatten().filter(|p| p["id"] == id) { p["private"] = json!(shown); } }
    }
    changed
}
/// Friends whose profile went public or private (seen as their status and game are checked,
/// or on their public page): what was known of their level let go -- the level of this
/// session, a "private" kept from their games or achievements --, and counted again now
/// (a private one: "-" at once, nothing asked of Steam).
fn privacy_changed(app: &AppHandle, user: &str, ids: Vec<String>) {
    {
        let mut g = LEVELS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(m) = g.as_mut() { for id in &ids { m.remove(id); } }
    }
    for id in &ids {
        let f = level_file(app, user, id);
        let k: Option<crate::trophies::FriendKept> = fs::read_to_string(&f).ok().and_then(|t| serde_json::from_str(&t).ok());
        if k.map(|k| k.sig == "private").unwrap_or(false) { let _ = fs::remove_file(&f); }
    }
    crate::log::line("INFO", "steam", &format!("{} Steam friend(s) changed their profile's privacy: their trophy level counted again", ids.len()));
    steam_friend_levels(app.clone(), user.to_string(), ids);
}
/// The friends whose profile is private (or friends only), as the kept list says (Steam's
/// visibility) and as their public pages were found.
fn private_ids(dir: &std::path::Path) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    if let Some(v) = read_json(&dir.join("list.json")) {
        for p in v["friends"].as_array().into_iter().flatten() {
            if p["private"].as_bool() == Some(true) { if let Some(id) = p["id"].as_str() { out.insert(id.to_string()); } }
        }
    }
    for (id, b) in bgs(dir) { if b["private"].as_bool() == Some(true) { out.insert(id); } }
    out
}
fn now_secs() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }
fn levels_dir(app: &AppHandle, user: &str) -> std::path::PathBuf {
    let u: String = user.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    crate::paths::trophies_dir(app).join("friends").join(u)
}
fn level_file(app: &AppHandle, user: &str, id: &str) -> std::path::PathBuf {
    let i: String = id.chars().filter(|c| c.is_ascii_digit()).collect();
    levels_dir(app, user).join(format!("{i}.json"))
}
/// The friends' levels kept on this computer (shown at once, before Steam is asked):
/// { id: level } (a private one: null).
#[tauri::command]
pub async fn steam_friend_levels_kept(app: AppHandle, user: String) -> Value {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = serde_json::Map::new();
        for e in fs::read_dir(levels_dir(&app, &user)).into_iter().flatten().flatten() {
            let p = e.path();
            if p.extension().map(|x| x != "json").unwrap_or(true) { continue; }
            let Some(id) = p.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
            let Some(k) = fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<crate::trophies::FriendKept>(&t).ok()) else { continue };
            if k.sig.is_empty() && k.level.is_none() { continue; }
            // (counted by an older version: counted again before it's shown)
            if k.v != crate::trophies::KEPT_V { continue; }
            out.insert(id, json!(k.level));
        }
        Value::Object(out)
    }).await.unwrap_or(Value::Null)
}
/// The kept levels deleted (Remove All Accounts Information).
pub fn forget_levels(app: &AppHandle, user: &str) {
    let _ = fs::remove_dir_all(levels_dir(app, user));
    *LEVELS.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// What's remembered this session let go (the system closing, or starting after
/// a crash), and the pictures older versions kept in Temp\MaXMB\friends deleted.
pub fn clear_cache(app: &AppHandle) {
    let d = crate::paths::friends_cache_dir(app);
    let _ = fs::remove_dir_all(&d);
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *LEVELS.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_privacy_change_is_counted_once() {
        // (the public page finds it: the list shows it at once, so the list's own check, a minute
        // later, finds nothing new; found again with nothing changed: not counted again)
        let d = std::env::temp_dir().join(format!("xmb_sfonce_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d); fs::create_dir_all(&d).unwrap();
        write_json(&d.join("list.json"), &json!({ "me": {}, "friends": [{ "id": "7", "private": false }, { "id": "8", "private": false }] }));
        assert!(list_private(&d, "u", "7", true));
        assert!(!list_private(&d, "u", "7", true));
        let v = read_json(&d.join("list.json")).unwrap();
        assert_eq!(v["friends"][0]["private"], json!(true));
        assert_eq!(v["friends"][1]["private"], json!(false));
        // (public again: once more, once)
        assert!(list_private(&d, "u", "7", false));
        assert!(!list_private(&d, "u", "7", false));
        // (no list kept yet: nothing to compare, nothing counted)
        let _ = fs::remove_file(d.join("list.json"));
        assert!(!list_private(&d, "u", "7", true));
        let _ = fs::remove_dir_all(&d);
    }
    #[test]
    fn descriptions() {
        assert_eq!(strip_html("  <b>Hi</b> &amp; welcome<br>second"), "Hi & welcome");
        assert_eq!(strip_html("\n\n  just   text "), "just text");
        // entities once, numbered ones, a stray "&" and ">"
        assert_eq!(strip_html("a &amp;lt; b &#39;x&#x27; &#128512; & c > d"), "a &lt; b 'x' \u{1F600} & c > d");
        // a drawing's rows of symbols are passed over for the line that says something
        assert_eq!(strip_html("░░░▄▄▄░░░<br>▀▀▀███▀▀▀<br>hello there"), "hello there");
        assert_eq!(strip_html("░░░▄▄▄░░░<br>▀▀▀███▀▀▀"), "░░░▄▄▄░░░");
        assert_eq!(strip_html("\u{1F600}\u{1F525}"), "\u{1F600}\u{1F525}");
        assert_eq!(strip_html("<script>alert(1)</script><img src=x onerror=y>hi"), "alert(1)hi");
    }
    #[test]
    fn odd_text() {
        // control and invisible characters, direction overrides, odd spaces
        assert_eq!(clean_text("a\u{0}b\u{7}\tc\u{200B}d\u{202E}e\u{FEFF}  f\u{3000}g\u{2800}h", 99), "ab cde f g h");
        // a pile of accents: two kept
        let z = format!("Z{}a", "\u{0301}".repeat(40));
        assert_eq!(clean_text(&z, 99), "Z\u{0301}\u{0301}a");
        assert_eq!(clean_text("\u{0301}\u{0301}x", 99), "x");
        // too long: cut at a character, not inside a joined emoji
        let long = "é".repeat(500);
        let c = clean_text(&long, COMMENT_MAX); assert_eq!(c.chars().count(), 256); assert!(c.ends_with('…'));
        let exact = "é".repeat(256); assert_eq!(clean_text(&exact, COMMENT_MAX), exact);
        let fam = format!("{}\u{1F468}\u{200D}\u{1F469}", "a".repeat(8));
        assert_eq!(clean_text(&fam, 10), format!("{}\u{1F468}…", "a".repeat(8)));
        // other alphabets, right-to-left text and emoji are kept as they are
        for t in ["こんにちは 世界", "مرحبا بالعالم", "Привет", "🎮🔥 gg", "¯\\_(ツ)_/¯", "★彡 Maxi 彡★"] { assert_eq!(clean_text(t, 99), t); }
        assert_eq!(clean_text("   \n\t ", 99), "");
    }
    // Without a key: the profile's public pages read as the Web API's answers are
    #[test]
    fn public_pages() {
        let friends = "<?xml version=\"1.0\"?><friendsList><steamID64>76561197960287930</steamID64><steamID><![CDATA[Me]]></steamID><friends>\n<friend>76561197960265731</friend>\n<friend>76561197960265738</friend>\n<friend>bad</friend></friends></friendsList>";
        assert_eq!(public_friends_of(friends).unwrap(), vec!["76561197960265731".to_string(), "76561197960265738".to_string()]);
        // (a private friends list, an error page, nothing: not a list)
        assert!(public_friends_of("<response><error>This profile is private.</error></response>").is_none() && public_friends_of("").is_none());
        assert_eq!(public_friends_of("<friendsList><friends></friends></friendsList>").unwrap().len(), 0);
        let page = |state: &str, msg: &str, extra: &str| format!("<?xml version=\"1.0\"?><profile><steamID64>76561197960265731</steamID64><steamID><![CDATA[Ann & Co]]></steamID>\
            <onlineState>{state}</onlineState><stateMessage><![CDATA[{msg}]]></stateMessage><privacyState>public</privacyState><visibilityState>3</visibilityState>\
            <avatarIcon><![CDATA[https://avatars.steamstatic.com/abc123def.jpg]]></avatarIcon><avatarFull><![CDATA[https://avatars.steamstatic.com/abc123def_full.jpg]]></avatarFull>{extra}\
            <summary><![CDATA[Hello <b>there</b>]]></summary></profile>");
        let now = 1_800_000_000;
        let on = public_profile_of(&page("in-game", "In-Game<br/>Portal 2", "<inGameInfo><gameName><![CDATA[Portal 2]]></gameName><gameLink><![CDATA[x]]></gameLink></inGameInfo>"), now).unwrap();
        assert_eq!(on["steamid"], "76561197960265731"); assert_eq!(on["personastate"], 1); assert_eq!(on["gameextrainfo"], "Portal 2");
        assert_eq!(on["avatarhash"], "abc123def"); assert_eq!(on["avatarfull"], "https://avatars.steamstatic.com/abc123def_full.jpg");
        assert_eq!(on["communityvisibilitystate"], 3); assert_eq!(on["summary"], "Hello there");
        let online = public_profile_of(&page("online", "Online", ""), now).unwrap();
        assert_eq!(online["personastate"], 1); assert_eq!(online["gameextrainfo"], ""); assert_eq!(online["lastlogoff"], 0);
        let off = public_profile_of(&page("offline", "Last Online 3 hrs, 12 mins ago", ""), now).unwrap();
        assert_eq!(off["personastate"], 0); assert_eq!(off["lastlogoff"], now - (3 * 3600 + 12 * 60));
        assert_eq!(last_online_secs("Last Online 325 days ago"), Some(325 * 86400));
        assert_eq!(last_online_secs("Last Online 1 hr, 1 min ago"), Some(3660));
        assert_eq!(last_online_secs("Offline"), None); assert_eq!(last_online_secs("Online"), None);
        // (the entry made of it: as one made of the Web API's summary)
        let d = std::env::temp_dir().join(format!("xmb_sfpub_{}", std::process::id()));
        let e = entry(&d, &serde_json::Map::new(), &on);
        assert_eq!(e["id"], "76561197960265731"); assert_eq!(e["name"], "Ann & Co"); assert_eq!(e["state"], 1); assert_eq!(e["game"], "Portal 2");
        // (a private profile: its name and picture, signed out; not a profile at all: nothing)
        let private = "<profile><steamID64>76561197960265738</steamID64><steamID><![CDATA[Bob]]></steamID><onlineState>offline</onlineState><stateMessage><![CDATA[Offline]]></stateMessage><privacyState>private</privacyState><avatarFull><![CDATA[https://avatars.steamstatic.com/ff00_full.jpg]]></avatarFull></profile>";
        let p = public_profile_of(private, now).unwrap();
        assert_eq!(p["personaname"], "Bob"); assert_eq!(p["communityvisibilitystate"], 1); assert_eq!(p["summary"], "");
        assert!(public_profile_of("<response><error>The specified profile could not be found.</error></response>", now).is_none());
        assert!(public_profile_of("", now).is_none() && public_profile_of("<profile><steamID64>", now).is_none());
        // which friends are read now: the unknown ones first, then the ones read longest ago
        let ids: Vec<String> = (1..=8).map(|i| format!("{i}")).collect();
        let mut kept = serde_json::Map::new();
        for (i, at) in [("1", 50), ("2", 10), ("3", 30)] { kept.insert(i.into(), json!({ "p": {}, "at": at })); }
        assert_eq!(keyless_pick(&ids, &kept, 3, 2), vec!["4", "5", "6", "2", "3"]);
        assert_eq!(keyless_pick(&ids[..3].to_vec(), &kept, 3, 2), vec!["2", "3"]);
        assert!(keyless_pick(&[], &kept, 3, 2).is_empty());
    }
    // The kept friends: saved, read back, and read when their files were damaged or deleted meanwhile
    #[test]
    fn kept_friends_are_saved_and_read_back() {
        let d = std::env::temp_dir().join(format!("xmb_sfkept_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        // nothing kept yet
        assert!(kept_list(&d).is_none());
        let list = json!({ "me": { "id": "1", "name": "Me", "avatarHash": "aa", "state": 1 },
            "friends": [{ "id": "2", "name": "Ann", "avatarHash": "bb", "state": 1, "game": "A Game", "lastLogoff": 5 }, { "id": "3", "name": "Bob", "avatarHash": "", "state": 0 }] });
        write_json(&d.join("list.json"), &list);
        write_json(&d.join("summaries.json"), &json!({ "2": "Hello there", "1": "Mine" }));
        fs::write(d.join("2_bb.jpg"), b"pic").unwrap();
        let v = kept_list(&d).unwrap();
        assert_eq!(v["friends"].as_array().unwrap().len(), 2);
        assert_eq!(v["friends"][0]["summary"], "Hello there");
        assert!(v["friends"][0]["avatar"].as_str().unwrap().ends_with("2_bb.jpg"));
        assert_eq!(v["me"]["summary"], "Mine");
        assert_eq!(v["friends"][1]["summary"], "");
        // a friend's picture deleted meanwhile: the friend stays, without it
        fs::remove_file(d.join("2_bb.jpg")).unwrap();
        assert_eq!(kept_list(&d).unwrap()["friends"][0]["avatar"], "");
        // the descriptions damaged, then deleted: the friends stay, without them
        fs::write(d.join("summaries.json"), b"{ \"2\": \"Hel").unwrap();
        assert_eq!(kept_list(&d).unwrap()["friends"][0]["summary"], "");
        fs::write(d.join("summaries.json"), b"[1, 2]").unwrap();
        assert_eq!(kept_list(&d).unwrap()["friends"][0]["name"], "Ann");
        fs::remove_file(d.join("summaries.json")).unwrap();
        assert_eq!(kept_list(&d).unwrap()["friends"].as_array().unwrap().len(), 2);
        // the list itself damaged in every way a file can be: read as nothing kept, or as what's left of it
        for bad in [&b"{ \"me\": { \"id\""[..], b"", b"[1, 2, 3]", b"\"text\"", b"12", b"null", b"{}", b"{ \"me\": 5, \"friends\": 7 }", b"{ \"friends\": [1, \"x\", null, {}] }", &[0xff, 0xfe, 0x00][..]] {
            fs::write(d.join("list.json"), bad).unwrap();
            let _ = kept_list(&d);
        }
        fs::remove_file(d.join("list.json")).unwrap();
        assert!(kept_list(&d).is_none());
        // its whole folder deleted
        let _ = fs::remove_dir_all(&d);
        assert!(kept_list(&d).is_none() && sums(&d).is_empty() && pics_of(&d, "2").is_empty());
    }
    #[test]
    fn kept_files_move_with_the_option() {
        let d = std::env::temp_dir().join(format!("xmb_sfmv_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let (temp, own) = (kept_dir(&d.join("temp"), "u1"), kept_dir(&d.join("app"), "u1"));
        fs::create_dir_all(&temp).unwrap();
        fs::write(temp.join("765_aa.jpg"), b"1").unwrap(); fs::write(temp.join("list.json"), b"{}").unwrap();
        // Save Cache in System Directory turned On: what Temp kept goes to the system's folder
        move_dir(&temp, &own);
        assert!(own.join("765_aa.jpg").is_file() && own.join("list.json").is_file() && !temp.exists());
        // and back again when it's turned Off
        move_dir(&own, &temp);
        assert!(temp.join("765_aa.jpg").is_file() && !own.exists());
        let _ = fs::remove_dir_all(&d);
    }
    #[test]
    fn kept_pictures() {
        let d = std::env::temp_dir().join(format!("xmb_sf_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let dir = kept_dir(&d, "user-1"); fs::create_dir_all(&dir).unwrap();
        assert_eq!(kept_dir(&d, "../x"), d.join("steam_friends").join("x"));
        assert_eq!(pic_shown(&dir, "765", "aa"), "");
        fs::write(dir.join("765_aa.jpg"), b"1").unwrap();
        fs::write(dir.join("7650_aa.jpg"), b"1").unwrap();
        assert!(pic_shown(&dir, "765", "aa").ends_with("765_aa.jpg"));
        // a new hash: the one kept before is shown until the new one is there
        assert!(pic_shown(&dir, "765", "bb").ends_with("765_aa.jpg"));
        assert_eq!(pics_of(&dir, "765").len(), 1);
        // (a hash can't name a file somewhere else)
        assert!(pic_shown(&dir, "765", "../../x").ends_with("765_aa.jpg"));
        // not friends any more: their pictures deleted
        prune_pics(&dir, &["765".to_string()].into_iter().collect());
        assert!(dir.join("765_aa.jpg").exists() && !dir.join("7650_aa.jpg").exists());
        // the kept list: shown with the pictures and descriptions kept now
        write_json(&dir.join("summaries.json"), &json!({ "765": "hi" }));
        write_json(&dir.join("list.json"), &json!({ "me": { "id": "1", "avatarHash": "" }, "friends": [{ "id": "765", "avatarHash": "aa", "avatar": "gone.jpg", "summary": "old" }] }));
        let v = kept_list(&dir).unwrap();
        assert!(v["friends"][0]["avatar"].as_str().unwrap().ends_with("765_aa.jpg"));
        assert_eq!(v["friends"][0]["summary"], "hi");
        let _ = fs::remove_dir_all(&d);
    }
    #[test]
    fn friends_from_their_page() {
        let page = r#"<div id="friends_list"><div class="friends_content"><div class="selectable friend_block_v2 persona online " data-steamid="76561198000000011" data-miniprofile="39734283">
            <a class="selectable_overlay" href="https://steamcommunity.com/profiles/76561198000000011"></a></div><div class="selectable friend_block_v2 persona offline " data-steamid="76561198000000012" data-miniprofile="1"></div>
            <div class="friend_block_v2" data-steamid="76561198000000011"></div></div></div>"#;
        assert_eq!(friends_page_ids(page), Some(vec!["76561198000000011".to_string(), "76561198000000012".to_string()]));
        assert_eq!(friends_page_ids("<html>This profile is private.</html>"), None);
    }
    #[test]
    fn background_colours() {
        // (GetProfileItemsEquipped: the picture's address; none equipped: ""; not its answer: None)
        let v = json!({ "response": { "profile_background": { "image_large": "items/1263950/abc.jpg", "movie_webm": "items/1263950/abc.webm" } } });
        assert_eq!(equipped_bg_of(&v).as_deref(), Some("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/items/1263950/abc.jpg"));
        assert_eq!(equipped_bg_of(&json!({ "response": { "profile_background": {} } })).as_deref(), Some(""));
        assert_eq!(equipped_bg_of(&json!({ "error": 1 })), None);
        // (the profile's own page: its background, an animated one's still, or none)
        let page = r#"<div class="no_header profile_page has_profile_background " style="background-image: url( 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/items/730/bg.jpg' );">"#;
        assert_eq!(page_bg_of(page).as_deref(), Some("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/items/730/bg.jpg"));
        let anim = r#"<div class="profile_page has_profile_background"><div class="profile_animated_background"><video playsinline autoplay muted loop poster="https://cdn.akamai.steamstatic.com/steamcommunity/public/images/items/1/still.jpg"><source src="x.webm">"#;
        assert_eq!(page_bg_of(anim).as_deref(), Some("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/items/1/still.jpg"));
        assert_eq!(page_bg_of(r#"<div class="no_header profile_page private_profile">"#).as_deref(), Some(""));
        assert_eq!(page_bg_of("<html>Sorry!</html>"), None);
        // (the largest group of like colours, not the average of them all)
        let mut px = vec![[20u8, 40, 160]; 60]; px.extend(vec![[250u8, 250, 250]; 30]); px.extend(vec![[200u8, 10, 10]; 10]);
        assert_eq!(main_color(&px).as_deref(), Some("#1428a0"));
        assert_eq!(main_color(&[]), None);
    }
}
