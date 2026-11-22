//! Part of trophies.rs. The trophy sets: kept, read and saved per user, the permanent record of the trophies won, and the trophies' pictures.

use super::*;

// ================================================================== the sets

pub(super) struct State {
    pub(super) user: String,
    pub(super) games: Vec<GameRef>,
    pub(super) sets: HashMap<String, TrophySet>,
    pub(super) srcs: HashMap<String, Option<Src>>,
    pub(super) stamps: HashMap<String, Vec<(PathBuf, Option<SystemTime>)>>,
    pub(super) last_web: HashMap<String, Instant>,
}
pub(super) static STATE: Mutex<Option<State>> = Mutex::new(None);
pub(super) static RUNNING: Mutex<Option<String>> = Mutex::new(None);

/// The game started from the system (its folder), watched closely while it runs.
/// (Without a sync this session, where its trophies come from is worked out
/// now, in the background, and its list read once from this computer, so
/// what's won while it runs pops up.)
pub fn set_running(app: &AppHandle, folder: Option<String>) {
    *RUNNING.lock().unwrap_or_else(|e| e.into_inner()) = folder.clone();
    let Some(folder) = folder else { return };
    // (the pop-up's window ready before the game's first trophy)
    crate::trophypop::prepare(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let Some((user, g, known)) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.games.iter().find(|g| g.folder == folder).cloned()
            .map(|g| (s.user.clone(), g, s.srcs.contains_key(&folder)))) else { return };
        // (a PS3 game without a trophy folder of its own yet: looked for again, see src_for_)
        let known = known && !(is_ps3_game(Path::new(&folder)) && STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.srcs.get(&folder).cloned()).map(|s| s.is_none()).unwrap_or(false));
        if known || user.is_empty() { return; }
        let acc = accounts::get(&app, &user);
        if src_for(&app, &user, &acc, &g).is_none() { return; }
        if load_cached(&app, &user, &folder).is_none() { refresh_one(&app, &user, &acc, &g, false, false); }
    });
}
/// A user's accounts changed: their trophies are read again.
pub fn forget_user(user: &str) {
    if let Some(s) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { if s.user == user { s.srcs.clear(); s.stamps.clear(); s.last_web.clear(); } }
}

/// The user's saved trophy lists deleted (Remove All Accounts Information);
/// the games' pictures and Steam's public lists stay (shared, not anyone's).
pub fn forget_saved(app: &AppHandle, user: &str) {
    let _ = fs::remove_dir_all(crate::paths::trophies_dir(app).join("sets").join(safe(user)));
    let _ = fs::remove_file(src_file(app, user));
    forget_user(user);
}
/// A user deleted: everything kept of their Trophy Collection goes with them (their
/// saved lists, their won trophies' record, their games' sources, their accounts'
/// games and which of them were shown).
pub fn forget_user_files(app: &AppHandle, user: &str) {
    let t = crate::paths::trophies_dir(app);
    let _ = fs::remove_dir_all(t.join("sets").join(safe(user)));
    let _ = fs::remove_dir_all(record_dir(app, user));
    let _ = fs::remove_file(src_file(app, user));
    { let _l = ACCT_LOCK.lock().unwrap_or_else(|e| e.into_inner()); let _ = fs::remove_file(acct_file(app, user)); let _ = fs::remove_file(acct_off_file(app, user)); }
    let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
    if g.as_ref().map(|s| s.user == user).unwrap_or(false) { *g = None; }
}
/// Delete Trophy Cache (Cache Management): the files of Trophy Collection that are
/// read again by themselves -- the saved trophy lists, the trophies' and games'
/// pictures, what the stores were asked about the games (their lists, their names,
/// their Steam app), where each game's trophies come from, the accounts' games
/// lists. Never the trophies won (earned) nor which account games are shown (_off).
pub fn cache_files(app: &AppHandle) -> Vec<PathBuf> { cache_files_in(&crate::paths::trophies_dir(app)) }
pub(super) fn cache_files_in(t: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn walk(d: &Path, out: &mut Vec<PathBuf>) {
        for e in fs::read_dir(d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() { walk(&p, out); } else { out.push(p); }
        }
    }
    for d in ["sets", "icons", "schemas", "sources"] { walk(&t.join(d), &mut out); }
    for e in fs::read_dir(t.join("accounts")).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_file() && !p.file_name().map(|n| n.to_string_lossy().ends_with("_off.json")).unwrap_or(false) { out.push(p); }
    }
    out
}
/// What's remembered this session of the deleted files let go (Delete Trophy Cache).
pub fn forget_memory() {
    *STATE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *RA_GAMES.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
/// After a whole sync (not cancelled), at most once a day: what's kept and nothing uses
/// any more deleted -- this user's saved lists and sources of games no longer in the
/// system; the pictures no saved list of any user shows (a day old at least: one being
/// fetched now isn't counted yet); online, Steam's and GOG's lists of games not read
/// for a month (a game still read has its list asked for again every week).
pub(super) fn prune_after_sync(app: &AppHandle, user: &str, games: &[GameRef], online: bool) {
    let _l = SRC_FILE.lock().unwrap_or_else(|e| e.into_inner());
    prune_in(&crate::paths::trophies_dir(app), user, games, online);
}
pub(super) fn prune_in(t: &Path, user: &str, games: &[GameRef], online: bool) {
    let stamp = t.join("pruned.txt");
    let day = Duration::from_secs(86400);
    if fs::metadata(&stamp).and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).map(|a| a < day).unwrap_or(false) { return; }
    let _ = fs::write(&stamp, now().to_string());
    let old = |p: &Path, age: Duration| fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).map(|a| a >= age).unwrap_or(false);
    let mut gone = 0usize;
    // (this user's lists and sources of games that are gone)
    let keep: HashSet<String> = games.iter().map(|g| format!("{}.json", fnv(&g.folder))).collect();
    for e in fs::read_dir(t.join("sets").join(safe(user))).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        if n.ends_with(".json") && !keep.contains(&n) && fs::remove_file(e.path()).is_ok() { gone += 1; }
    }
    {
        let f = t.join("sources").join(format!("{}.json", safe(user)));
        if let Some(mut m) = fs::read_to_string(&f).ok().and_then(|s| serde_json::from_str::<serde_json::Map<String, Value>>(&s).ok()) {
            let folders: HashSet<&str> = games.iter().map(|g| g.folder.as_str()).collect();
            let n = m.len();
            m.retain(|k, _| folders.contains(k.as_str()));
            if m.len() != n { gone += n - m.len(); let _ = fs::write(&f, Value::Object(m).to_string()); }
        }
    }
    // (the pictures every user's lists show)
    let mut shown: HashSet<String> = HashSet::new();
    for u in fs::read_dir(t.join("sets")).into_iter().flatten().flatten() {
        for e in fs::read_dir(u.path()).into_iter().flatten().flatten() {
            let Some(s) = fs::read_to_string(e.path()).ok().and_then(|x| serde_json::from_str::<TrophySet>(&x).ok()) else { continue };
            let name = |p: &str| Path::new(p).file_name().map(|n| n.to_string_lossy().to_lowercase());
            if let Some(n) = name(&s.icon) { shown.insert(n); }
            if let Some(n) = name(&s.game_icon) { shown.insert(n); }
            for tr in &s.trophies { if let Some(n) = name(&tr.icon) { shown.insert(n); } }
        }
    }
    for e in fs::read_dir(t.join("icons")).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().to_lowercase();
        if !shown.contains(&n) && old(&e.path(), day) && fs::remove_file(e.path()).is_ok() { gone += 1; }
    }
    if online {
        for e in fs::read_dir(t.join("schemas")).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if (n.starts_with("steam_") || n.starts_with("gog_client_")) && old(&e.path(), 30 * day) && fs::remove_file(e.path()).is_ok() { gone += 1; }
        }
    }
    if gone > 0 { crate::log::line("INFO", "trophies", &format!("cache: {gone} files nothing uses any more deleted")); }
}
pub(super) fn set_file(app: &AppHandle, user: &str, folder: &str) -> PathBuf {
    crate::paths::trophies_dir(app).join("sets").join(safe(user)).join(format!("{}.json", fnv(folder)))
}
pub(super) fn icon_file(app: &AppHandle, src: &str) -> PathBuf {
    let ext = if src.to_lowercase().ends_with(".jpg") || src.to_lowercase().ends_with(".jpeg") { "jpg" } else { "png" };
    crate::paths::trophies_dir(app).join("icons").join(format!("{}.{ext}", fnv(src)))
}

/// A game's trophies read now (None: it has none, or they couldn't be read).
/// The trophies of a game read from this computer's files (RPCS3, Steam and
/// its emulators; with `web`, Steam's lists and the account too), the added
/// Platinum included.
pub(super) fn local_list(tdir: &Path, acc: &Accounts, title: &str, src: &Src, web: bool) -> Option<(&'static str, Vec<Trophy>)> {
    match src {
        Src::Rpcs3(d) => Some(("rpcs3", rpcs3_set(d)?)),
        Src::Steam(id, dirs) => { let mut l = steam_set(tdir, acc, id, dirs, web)?; add_platinum(title, &mut l); Some(("steam", l)) }
        _ => None,
    }
}
/// An Epic or GOG game whose store gives no list (not signed in, or none
/// there): Steam's list of the same game by its name (what's won: from the
/// files of this computer, as for Steam games).
pub(super) fn steam_instead(app: &AppHandle, acc: &Accounts, g: &GameRef, dirs: &[PathBuf], web: bool) -> Option<(&'static str, Vec<Trophy>)> {
    let tdir = crate::paths::trophies_dir(app);
    let meta = meta_of(Path::new(&g.folder));
    let id = names_of(&g.title, &meta, dirs).iter().find_map(|n| steam_by_name(&tdir, n, web))?;
    local_list(&tdir, acc, &g.title, &Src::Steam(id, dirs.to_vec()), web)
}
pub(super) fn read_set(app: &AppHandle, user: &str, acc: &Accounts, g: &GameRef, src: &Src, web: bool) -> Option<TrophySet> {
    ACCT_WON.with(|a| a.borrow_mut().clear());
    if is_acct(&g.folder) {
        let r = acct_read(app, user, acc, g, src, web);
        if web && !LOOKUP_FAILED.with(|f| f.get()) { acct_mark(app, user, &g.folder, r.is_some()); }
        return r;
    }
    let (name, list) = match src {
        Src::Rpcs3(_) | Src::Steam(..) => local_list(&crate::paths::trophies_dir(app), acc, &g.title, src, web)?,
        Src::Epic(ns) => { if !web { return None; } match epic_set(app, acc, ns) { Some(l) if !l.is_empty() => ("epic", l), _ => steam_instead(app, acc, g, &[], web)? } }
        Src::Gog(pid, dirs) => { if !web { return None; } match gog_set(app, user, pid, dirs) { Some(l) if !l.is_empty() => ("gog", l), _ => steam_instead(app, acc, g, dirs, web)? } }
        // (found by an older version, by its name: under the name it was found with -- its kept
        // list's -- when it has been renamed since)
        Src::Ra => { if !web { return None; }
            let old = || load_cached(app, user, &g.folder).and_then(|s| s.key.strip_prefix("ra:").map(str::to_string)).filter(|t| !t.is_empty() && *t != g.title.to_lowercase());
            ("ra", ra_set(acc, &g.title).or_else(|| ra_set(acc, &old()?))?) }
        Src::RaGame(id) => { if !web { return None; } ("ra", ra_set_id(acc, *id)?) }
    };
    let mut list = list;
    let id = match src {
        Src::Rpcs3(d) => d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        Src::Steam(id, _) | Src::Gog(id, _) | Src::Epic(id) => id.clone(),
        Src::Ra => g.title.to_lowercase(),
        Src::RaGame(id) => id.to_string(),
    };
    // (the permanent record: what was once won stays won)
    record_merge(app, user, acc, g, name, &format!("{name}:{id}"), &mut list);
    if name != "rpcs3" { add_platinum(&g.title, &mut list); }
    // pictures already kept
    for t in list.iter_mut() {
        if !t.src.is_empty() { let f = icon_file(app, &t.src); if f.is_file() { t.icon = f.display().to_string(); } }
    }
    let icon = match src { Src::Rpcs3(d) if d.join("ICON0.PNG").is_file() => d.join("ICON0.PNG").display().to_string(), _ => String::new() };
    Some(TrophySet { folder: g.folder.clone(), title: g.title.clone(), source: name.into(), key: format!("{name}:{id}"), trophies: list, updated: now(), icon, ..Default::default() })
}
/// An account game's trophies: its store's list (and the account's won ones;
/// Steam's: this computer's files too, a copy of the game played elsewhere).
pub(super) fn acct_read(app: &AppHandle, user: &str, acc: &Accounts, g: &GameRef, src: &Src, web: bool) -> Option<TrophySet> {
    let (store, id) = acct_parts(&g.folder)?;
    let (name, mut list) = match src {
        Src::Steam(..) => ("steam", steam_set(&crate::paths::trophies_dir(app), acc, id, &[], web)?),
        Src::Epic(ns) => { if !web { return None; } ("epic", epic_set(app, acc, ns)?) }
        Src::Gog(pid, _) => { if !web { return None; } ("gog", gog_set(app, user, pid, &[])?) }
        Src::Ra | Src::RaGame(_) => { if !web { return None; } ("ra", ra_set_id(acc, id.parse().ok()?)?) }
        Src::Rpcs3(_) => return None,
    };
    let key = format!("{name}:{id}");
    record_merge(app, user, acc, g, name, &key, &mut list);
    add_platinum(&g.title, &mut list);
    for t in list.iter_mut() {
        if !t.src.is_empty() { let f = icon_file(app, &t.src); if f.is_file() { t.icon = f.display().to_string(); } }
    }
    let console = if store == "ra" {
        let _l = ACCT_LOCK.lock().unwrap_or_else(|e| e.into_inner()); acct_load(app, user).games.into_iter().find(|x| x.folder == g.folder).map(|x| x.console).unwrap_or_default()
    } else { "PC".into() };
    Some(TrophySet { folder: g.folder.clone(), title: g.title.clone(), source: name.into(), key, trophies: list, updated: now(),
        icon: acct_art(app, user, &g.folder), game_icon: acct_icon(app, user, &g.folder), store: store.into(), console, ..Default::default() })
}
pub(super) fn load_cached(app: &AppHandle, user: &str, folder: &str) -> Option<TrophySet> {
    let mut s: TrophySet = serde_json::from_str(&fs::read_to_string(set_file(app, user, folder)).ok()?).ok()?;
    // (a picture deleted from the cache: fetched again -- an account game's own picture too)
    for t in s.trophies.iter_mut() { if !t.icon.is_empty() && !Path::new(&t.icon).is_file() { t.icon.clear(); } }
    if is_acct(&s.folder) && !s.icon.is_empty() && !Path::new(&s.icon).is_file() { s.icon.clear(); }
    if !s.game_icon.is_empty() && !Path::new(&s.game_icon).is_file() { s.game_icon.clear(); }
    Some(s)
}
pub(super) fn save_set(app: &AppHandle, user: &str, s: &TrophySet) {
    let f = set_file(app, user, &s.folder);
    let _ = fs::create_dir_all(f.parent().unwrap());
    if let Ok(t) = serde_json::to_string(s) { let _ = crate::paths::write_whole(&f, t); }
}

// ------------------------------------------------------------- the trophy record

/// The permanent record of a game's won trophies (data\cache\trophies\earned):
/// a trophy once seen won stays won, even when its emulator's file is gone (a
/// reinstall, another copy, the saves deleted), like a game bought on a store.
/// A trophy only an account showed is kept as that account's, and forgotten
/// when the account is (its key or ID deleted, another ID set, signed out,
/// Remove All Accounts Information); a game with Trophies Off is forgotten.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub(super) struct Record {
    pub(super) key: String,
    pub(super) title: String,
    #[serde(default)]
    pub(super) folders: Vec<String>,
    pub(super) won: std::collections::BTreeMap<String, Won>,
}
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub(super) struct Won {
    /// when it was won (0: not known)
    pub(super) t: i64,
    /// "" this computer's files; "steam:<SteamID>", "ra:<user>", "epic:<id>",
    /// "gog:<id>": only that account showed it
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) by: String,
}
pub(super) fn record_dir(app: &AppHandle, user: &str) -> PathBuf { crate::paths::trophies_dir(app).join("earned").join(safe(user)) }
pub(super) fn record_file(app: &AppHandle, user: &str, key: &str) -> PathBuf { record_dir(app, user).join(format!("{}.json", fnv(key))) }
pub(super) fn record_load(f: &Path) -> Option<Record> { serde_json::from_str(&fs::read_to_string(f).ok()?).ok() }
pub(super) fn record_save(f: &Path, r: &Record) {
    if r.won.is_empty() { let _ = fs::remove_file(f); return; }
    let _ = fs::create_dir_all(f.parent().unwrap());
    if let Ok(t) = serde_json::to_string(r) { let _ = crate::paths::write_whole(f, t); }
}
/// The account a store's trophies came from ("" : none connected).
pub(super) fn acct_tag(acc: &Accounts, store: &str) -> String {
    let t = |p: &str, id: &str| if id.trim().is_empty() { String::new() } else { format!("{p}:{}", id.trim()) };
    match store {
        "steam" => t("steam", &acc.steam_id),
        "ra" => if acc.ra_key.is_empty() { String::new() } else { t("ra", &acc.ra_user.to_lowercase()) },
        "epic" => t("epic", &acc.epic_id),
        "gog" => t("gog", if acc.gog_user_id.is_empty() { &acc.gog_public } else { &acc.gog_user_id }),
        _ => String::new(),
    }
}
/// Whether the account a kept trophy came from is still the one connected.
pub(super) fn acct_still(acc: &Accounts, by: &str) -> bool {
    if by.is_empty() { return true; }
    let store = by.split(':').next().unwrap_or("");
    acct_tag(acc, store) == by
}
/// The record applied to a game just read (what it kept stays won) and brought
/// up to date with it (what's newly won added; an account's no longer connected dropped).
pub(super) fn record_merge(app: &AppHandle, user: &str, acc: &Accounts, g: &GameRef, store: &str, key: &str, list: &mut [Trophy]) {
    let f = record_file(app, user, key);
    let mut r = record_load(&f).unwrap_or_else(|| Record { key: key.into(), ..Default::default() });
    let before = r.clone();
    let acct: HashSet<String> = ACCT_WON.with(|a| a.borrow().iter().map(|k| k.to_lowercase()).collect());
    record_apply(&mut r, acc, store, &acct, list);
    r.title = g.title.clone();
    if !r.folders.contains(&g.folder) { r.folders.push(g.folder.clone()); }
    if serde_json::to_string(&r).ok() != serde_json::to_string(&before).ok() { record_save(&f, &r); }
}
/// A game's record and its list just read made one (see record_merge).
pub(super) fn record_apply(r: &mut Record, acc: &Accounts, store: &str, acct: &HashSet<String>, list: &mut [Trophy]) {
    r.won.retain(|_, w| acct_still(acc, &w.by));
    // (an account's store: everything it said is the account's)
    let all_acct = matches!(store, "epic" | "gog" | "ra");
    let tag = acct_tag(acc, if store == "rpcs3" { "" } else { store });
    for t in list.iter_mut().filter(|t| !t.auto_plat) {
        match t.earned {
            Some(e) => {
                let by = if (all_acct || acct.contains(&t.id.to_lowercase())) && !tag.is_empty() { tag.clone() } else { String::new() };
                let w = r.won.entry(t.id.clone()).or_insert(Won { t: e, by: by.clone() });
                // (seen here now: this computer's, kept whatever the account)
                if by.is_empty() { w.by.clear(); }
                if w.t == 0 || (e > 0 && e < w.t) { w.t = e; }
            }
            None => if let Some(w) = r.won.get(&t.id) { t.earned = Some(w.t); },
        }
    }
}
/// The records brought up to date with the accounts connected now (what a
/// removed or changed account had said is forgotten).
pub(super) fn record_prune(app: &AppHandle, user: &str, acc: &Accounts) {
    let Ok(rd) = fs::read_dir(record_dir(app, user)) else { return };
    for e in rd.flatten() {
        let f = e.path();
        if f.extension().map(|x| x != "json").unwrap_or(true) { continue; }
        let Some(mut r) = record_load(&f) else { continue };
        let n = r.won.len();
        r.won.retain(|_, w| acct_still(acc, &w.by));
        if r.won.len() != n { record_save(&f, &r); }
    }
}
/// The records brought up to date with the accounts now (Remove All Accounts Information).
pub fn records_prune(app: &AppHandle, user: &str) { record_prune(app, user, &accounts::get(app, user)); }
/// A game's records forgotten (its Trophies turned Off).
pub(super) fn record_forget(app: &AppHandle, user: &str, folder: &str) {
    let Ok(rd) = fs::read_dir(record_dir(app, user)) else { return };
    for e in rd.flatten() {
        let f = e.path();
        if record_load(&f).map(|r| r.folders.iter().any(|x| x == folder)).unwrap_or(false) { let _ = fs::remove_file(&f); }
    }
}
/// Whether turning a game's Trophies Off loses something that can't be read
/// again from an account: its record has trophies this computer's files showed.
#[tauri::command]
pub async fn trophies_game_has_local(app: AppHandle, user: String, folder: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(rd) = fs::read_dir(record_dir(&app, &user)) else { return false };
        rd.flatten().filter_map(|e| record_load(&e.path())).any(|r| r.folders.iter().any(|x| x == &folder) && r.won.values().any(|w| w.by.is_empty()))
    }).await.unwrap_or(false)
}
/// Game Settings > Trophies turned Off: the game's trophy record and saved
/// list forgotten (turned On again, it has what its files and accounts show).
#[tauri::command]
pub async fn trophies_game_off(app: AppHandle, user: String, folder: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        record_forget(&app, &user, &folder);
        let _ = fs::remove_file(set_file(&app, &user, &folder));
        if let Some(s) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { s.sets.remove(&folder); }
    }).await;
}

/// The trophies won in `new` that `old` didn't have (oldest first; an added Platinum last).
pub(super) fn newly_won(old: &TrophySet, new: &TrophySet) -> Vec<Trophy> {
    let had: HashSet<&str> = old.trophies.iter().filter(|t| t.earned.is_some()).map(|t| t.id.as_str()).collect();
    let mut v: Vec<Trophy> = new.trophies.iter().filter(|t| t.earned.is_some() && !had.contains(t.id.as_str())).cloned().collect();
    v.sort_by_key(|t| (t.grade == "P", t.earned.unwrap_or(0)));
    v
}

/// The stores' own picture servers: the only places trophy pictures are fetched from.
pub(super) fn icon_host_ok(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").split(':').next().unwrap_or("").to_lowercase();
    ["steamstatic.com", "steampowered.com", "steamcommunity.com", "epicgames.com", "epicgames.net", "unrealengine.com",
     "gog.com", "gog-statics.com", "retroachievements.org"]
        .iter().any(|d| host == *d || host.ends_with(&format!(".{d}")))
}
/// One picture fetched once at a time: games sharing a list (copies) fetch the
/// same pictures; the second waits for the first instead of failing on the same
/// file (what left some of a copy's pictures missing).
pub(super) fn icon_fetch_once(f: &Path, fetch: impl FnOnce() -> bool) -> bool {
    static BUSY: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
    loop {
        if f.is_file() { return true; }
        let mine = BUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashSet::new).insert(f.to_path_buf());
        if mine { break; }
        std::thread::sleep(Duration::from_millis(100));
    }
    let ok = f.is_file() || fetch();
    BUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashSet::new).remove(f);
    ok
}
/// Pictures not kept yet: fetched one by one (each one, when it's there, is told to the page).
pub(super) fn fetch_icons(app: &AppHandle, user: &str, folder: &str) {
    let app = app.clone(); let user = user.to_string(); let folder = folder.to_string();
    std::thread::spawn(move || {
        static BUSY: Mutex<Option<HashSet<String>>> = Mutex::new(None);
        if !BUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashSet::new).insert(folder.clone()) { return; }
        let todo: Vec<(String, String)> = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.sets.get(&folder))
            .map(|s| s.trophies.iter().filter(|t| t.icon.is_empty() && !t.src.is_empty()).map(|t| (t.id.clone(), t.src.clone())).collect()).unwrap_or_default();
        let _ = fs::create_dir_all(crate::paths::trophies_dir(&app).join("icons"));
        let mut changed = false;
        for (id, src) in todo {
            let f = icon_file(&app, &src);
            let ok = icon_fetch_once(&f, || if src.starts_with("https://") { icon_host_ok(&src) && net::download(&src, &f) }
                else if src.contains("://") { false } else {
                    // (copied under another name, then renamed: never half a picture)
                    let tmp = f.with_extension(format!("{}.tmp", std::process::id()));
                    fs::copy(&src, &tmp).is_ok() && (fs::rename(&tmp, &f).is_ok() || { let _ = fs::remove_file(&tmp); f.is_file() })
                });
            if !ok { continue; }
            let path = f.display().to_string();
            if let Some(s) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|s| s.sets.get_mut(&folder)) {
                for t in s.trophies.iter_mut().filter(|t| t.id == id) { t.icon = path.clone(); }
            }
            changed = true;
            let _ = app.emit("trophy-icon", serde_json::json!({ "folder": folder, "id": id, "icon": path }));
        }
        if changed { if let Some(s) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.sets.get(&folder)).cloned() { save_set(&app, &user, &s); } }
        BUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashSet::new).remove(&folder);
    });
}

/// Where a game's trophies come from: worked out once and kept
/// (trophies\sources\<user>.json), worked out again when the game's own
/// details (game.json, its shortcut) or the accounts it can depend on change;
/// a game found to have none is looked at again after a week.
pub(super) fn src_for(app: &AppHandle, user: &str, acc: &Accounts, g: &GameRef) -> Option<Src> {
    src_for_(app, user, acc, g)
}
