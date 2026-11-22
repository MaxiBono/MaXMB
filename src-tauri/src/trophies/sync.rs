//! Part of trophies.rs. Where each game's trophies come from (found once and kept), bringing them up to date (Trophy Collection's sync), and watching the games while they run.

use super::*;

// ---- Steam's pictures as the stand-in of the games the system recognizes
// (gameart.rs, done by Game Recognition while it gets the games' art): a
// recognized game (not a PS3 game) is looked for on Steam -- its own Steam app,
// or the Steam game with its name.
/// The Steam app whose pictures stand in for a game's. Err: the lookup by name
/// couldn't be made (offline, Steam's store not answering): asked again later.
pub fn steam_art_app(app: &AppHandle, folder: &Path) -> Result<Option<String>, ()> {
    let meta = meta_of(folder);
    let title = meta["title"].as_str().map(str::to_string).unwrap_or_else(|| folder.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
    let launch = meta["launch"].as_str().unwrap_or("").to_string();
    let dirs = game_dirs(&meta, folder, &launch);
    if let Some(l) = store_link(folder, &meta, &launch) {
        if let Some(id) = l.strip_prefix("steam://rungameid/").map(|r| r.chars().take_while(|c| c.is_ascii_digit()).collect::<String>()).filter(|i| !i.is_empty()) { return Ok(Some(id)); }
    }
    if meta["store"].as_str() == Some("Steam") { if let Some(id) = meta["steamAppId"].as_str() { return Ok(Some(id.to_string())); } }
    if let Some(id) = dirs.iter().find_map(|d| steam_appid_near(d)) { return Ok(Some(id)); }
    let tdir = crate::paths::trophies_dir(app);
    let online = net::online();
    LOOKUP_FAILED.with(|f| f.set(false));
    for name in names_of(&title, &meta, &dirs) {
        if let Some(id) = steam_by_name(&tdir, &name, online) { return Ok(Some(id)); }
    }
    if LOOKUP_FAILED.with(|f| f.get()) { Err(()) } else { Ok(None) }
}
pub(super) fn src_for_(app: &AppHandle, user: &str, acc: &Accounts, g: &GameRef) -> Option<Src> {
    let cached = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().filter(|s| s.user == user).and_then(|s| s.srcs.get(&g.folder).cloned());
    // (a PS3 game not played in RPCS3 yet -- no trophy folder of its own --: looked at again each
    // time, as RPCS3 makes its folder once it's played; only this computer's folders are looked at)
    let unsettled = |s: &Option<Src>| match s { None => true, Some(Src::Rpcs3(d)) => d.starts_with(crate::paths::trophies_dir(app).join("trp")), _ => false };
    if let Some(s) = cached { if !(unsettled(&s) && is_ps3_game(Path::new(&g.folder))) { return s; } }
    if is_acct(&g.folder) {
        let s = acct_src(&g.folder);
        if let Some(st) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { st.srcs.insert(g.folder.clone(), s.clone()); }
        return s;
    }
    let stamp = game_stamp(g);
    let kept = src_kept(app, user, &g.folder, &stamp, acc);
    // (an Epic copy that doesn't say its game, found before the Epic account listed it -- signed in
    // later --: the account's game now)
    let kept = match (kept, epic_by_account(app, acc, g)) { (Some(k), Some(ns)) if k != Some(Src::Epic(ns.clone())) => None, (k, _) => k };
    let s = match kept { Some(s) => s, None => {
        let online = net::online();
        LOOKUP_FAILED.with(|f| f.set(false));
        let s = source_of(app, acc, g, online);
        let failed = !online || LOOKUP_FAILED.with(|f| f.get());
        // The game changed since its source was found (renamed, say) and nothing is found
        // for it as it is now: it keeps the source it had. Found for sure that there's none
        // under the new name: kept so from now on. The lookup couldn't be made (offline, a
        // store not answering): the one it had for now, looked up again at the next start.
        let s = match (s, src_before(app, user, &g.folder, acc)) {
            (None, Some(prev)) => { if failed { if let Some(st) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { st.srcs.insert(g.folder.clone(), Some(prev.clone())); } return Some(prev); } Some(prev) }
            (s, _) => s,
        };
        // (nothing found because a lookup couldn't be made, offline or a store
        // not answering: not kept, looked at again at the next sync)
        if s.is_none() && failed { return None; }
        src_keep(app, user, &g.folder, &stamp, acc, &s);
        s
    } };
    if let Some(st) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { st.srcs.insert(g.folder.clone(), s.clone()); }
    s
}
pub(super) static SRC_FILE: Mutex<()> = Mutex::new(());
pub(super) fn src_file(app: &AppHandle, user: &str) -> PathBuf { crate::paths::trophies_dir(app).join("sources").join(format!("{}.json", safe(user))) }
/// A game's own details: what decides where its trophies come from.
pub(super) fn game_stamp(g: &GameRef) -> String {
    let m = fs::metadata(Path::new(&g.folder).join("game.json")).ok();
    format!("{:?}:{}:{}:{}", m.as_ref().and_then(|m| m.modified().ok()), m.map(|m| m.len()).unwrap_or(0), g.launch, g.title)
}
/// The accounts finding a game's source can use (RetroAchievements').
pub(super) fn acc_src_sig(acc: &Accounts) -> String {
    // (the Epic account too: an Epic copy without its .mancpn takes its game from it)
    if acc.epic_id.is_empty() { fnv(&format!("{}|{}", acc.ra_user, !acc.ra_key.is_empty())) }
    else { fnv(&format!("{}|{}|{}", acc.ra_user, !acc.ra_key.is_empty(), acc.epic_id)) }
}
/// The source a game had when it was last looked at, whatever changed in the game since
/// (None: it had none, or it was found with other accounts than the ones linked now).
pub(super) fn src_before(app: &AppHandle, user: &str, folder: &str, acc: &Accounts) -> Option<Src> {
    let _l = SRC_FILE.lock().unwrap_or_else(|e| e.into_inner());
    let v: Value = serde_json::from_str(&fs::read_to_string(src_file(app, user)).ok()?).ok()?;
    let e = &v[folder];
    if e["acct"].as_str()? != acc_src_sig(acc) { return None; }
    serde_json::from_value::<Option<Src>>(e["src"].clone()).ok()?
}
/// Whether a game is told apart by more than its name: its own IDs, a Steam emulator's or
/// Steam's files, a store's files, a PS3 game's own data... (its source is then found by
/// those, whatever it's called, so a new name changes nothing).
pub fn known_without_name(app: &AppHandle, user: &str, g: &GameRef) -> bool {
    let acc = accounts::get(app, user);
    let ctx = Ctx::of(app);
    source_in(&ctx, &acc, g, &Lookups { ra_has: &|_| None, steam_find: &|_| None }).is_some()
}
/// A game renamed by hand: its source is looked up again at the next read (src_for).
pub fn renamed(folder: &str) {
    if let Some(st) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { st.srcs.remove(folder); }
}
/// A game's folder renamed (Game Settings > Title): what's kept of it follows it -- its source
/// (sources\<user>.json) and its saved list (sets\<user>\<folder>.json), for every user, and
/// what's in memory --, so it isn't read again as a new game.
pub fn folder_renamed(app: &AppHandle, old: &str, new: &str) {
    let t = crate::paths::trophies_dir(app);
    {
        let _l = SRC_FILE.lock().unwrap_or_else(|e| e.into_inner());
        for e in fs::read_dir(t.join("sources")).into_iter().flatten().flatten() {
            let f = e.path();
            let Ok(Value::Object(mut m)) = fs::read_to_string(&f).map(|x| serde_json::from_str::<Value>(&x).unwrap_or(Value::Null)) else { continue };
            if let Some(v) = m.remove(old) { m.insert(new.to_string(), v); let _ = fs::write(&f, Value::Object(m).to_string()); }
        }
    }
    for e in fs::read_dir(t.join("sets")).into_iter().flatten().flatten() {
        let (from, to) = (e.path().join(format!("{}.json", fnv(old))), e.path().join(format!("{}.json", fnv(new))));
        let Ok(txt) = fs::read_to_string(&from) else { continue };
        if let Ok(mut set) = serde_json::from_str::<TrophySet>(&txt) {
            set.folder = new.to_string();
            if fs::write(&to, serde_json::to_string(&set).unwrap_or_default()).is_ok() { let _ = fs::remove_file(&from); }
        }
    }
    if let Some(st) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        if let Some(v) = st.srcs.remove(old) { st.srcs.insert(new.to_string(), v); }
        if let Some(mut v) = st.sets.remove(old) { v.folder = new.to_string(); st.sets.insert(new.to_string(), v); }
        if let Some(v) = st.stamps.remove(old) { st.stamps.insert(new.to_string(), v); }
        if let Some(v) = st.last_web.remove(old) { st.last_web.insert(new.to_string(), v); }
        for g in st.games.iter_mut().filter(|g| g.folder == old) { g.folder = new.to_string(); }
    }
}
/// Some(source) when the kept one still holds (Some(None): kept as having none).
/// Whether a game of the system is a PS3 game (its trophies from RPCS3).
pub(super) fn is_ps3_game(folder: &Path) -> bool {
    let m = meta_of(folder);
    m["ps3Key"].is_string() || m["titleId"].is_string() || m["console"].as_str().map(|c| c.to_uppercase().contains("PS3")).unwrap_or(false)
}
pub(super) fn src_kept(app: &AppHandle, user: &str, folder: &str, stamp: &str, acc: &Accounts) -> Option<Option<Src>> {
    // (a PS3 game kept as having none: looked at again, see src_for_)
    if is_ps3_game(Path::new(folder)) && fs::read_to_string(src_file(app, user)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).map(|v| v[folder]["src"].is_null()).unwrap_or(false) { return None; }
    let _l = SRC_FILE.lock().unwrap_or_else(|e| e.into_inner());
    let v: Value = serde_json::from_str(&fs::read_to_string(src_file(app, user)).ok()?).ok()?;
    let e = &v[folder];
    if e["stamp"].as_str()? != stamp || e["acct"].as_str()? != acc_src_sig(acc) { return None; }
    let src: Option<Src> = serde_json::from_value(e["src"].clone()).ok()?;
    match &src {
        // (kept as having none before v3 changes 56 -- a TENOKE game's app ID wasn't read then --,
        // or before 2.0.0's changes 24, when a store refusing
        // could be taken for "none" and fewer names were tried: looked at again)
        None => if now() - e["at"].as_i64().unwrap_or(0) > 7 * 86400 || e["v"].as_i64() != Some(4) { return None; },
        // (an RPCS3 trophy folder that isn't there any more: found again)
        // (a list unpacked from a TROPHY.TRP: looked for again, RPCS3's own
        // folder is there once the game is played)
        Some(Src::Rpcs3(d)) => if !d.is_dir() || d.starts_with(crate::paths::trophies_dir(app).join("trp")) { return None; },
        _ => {}
    }
    Some(src)
}
pub(super) fn src_keep(app: &AppHandle, user: &str, folder: &str, stamp: &str, acc: &Accounts, src: &Option<Src>) {
    let _l = SRC_FILE.lock().unwrap_or_else(|e| e.into_inner());
    let f = src_file(app, user);
    let mut v: serde_json::Map<String, Value> = fs::read_to_string(&f).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    v.insert(folder.to_string(), serde_json::json!({ "src": src, "stamp": stamp, "acct": acc_src_sig(acc), "at": now(), "v": 4 }));
    let _ = fs::create_dir_all(f.parent().unwrap());
    let tmp = f.with_extension("tmp");
    if fs::write(&tmp, Value::Object(v).to_string()).is_ok() { let _ = fs::rename(&tmp, &f); }
}
/// What a game's list is read from: its source, the accounts that source
/// uses, and the dates and sizes of its files on this computer.
pub(super) fn sig_of(acc: &Accounts, src: &Src) -> String {
    let files: Vec<String> = stamp_of_files(acc, src).iter().map(|f| {
        let m = fs::metadata(f).ok();
        format!("{}:{:?}:{}", f.display(), m.as_ref().and_then(|m| m.modified().ok()), m.map(|m| m.len()).unwrap_or(0))
    }).collect();
    let who = match src {
        Src::Steam(..) => format!("{}|{}", acc.steam_id, !acc.steam_key.is_empty()),
        Src::Ra | Src::RaGame(_) => format!("{}|{}", acc.ra_user, !acc.ra_key.is_empty()),
        // (signed in or not: read again when it changes -- signed in, Epic gives the account's own records)
        Src::Epic(_) => format!("{}|{}", acc.epic_id, !acc.epic_refresh.is_empty()),
        Src::Gog(..) => format!("{}|{}|{}", acc.gog_user_id, acc.gog_public, !acc.gog_refresh.is_empty()),
        // ("2": lists kept before add-on trophies were told apart are read again once)
        Src::Rpcs3(_) => "2".to_string(),
    };
    // (GreenLuma keeps its achievements in the registry, not in a file)
    let gl = match src { Src::Steam(id, _) => { let mut v: Vec<_> = greenluma_won(id).into_iter().collect(); v.sort(); format!("{v:?}") } _ => String::new() };
    fnv(&format!("{src:?}#{who}#{}#{gl}", files.join("|")))
}
/// A game's signature (an account game's: also what its store says changes when it's played).
pub(super) fn sig_for(acc: &Accounts, g: &GameRef, src: &Src) -> String {
    if is_acct(&g.folder) { fnv(&format!("{}#{}", sig_of(acc, src), g.stamp)) } else { sig_of(acc, src) }
}
/// An account game is read again when its store says it changed (its stamp), not every 10 minutes.
pub(super) fn asks_for(acc: &Accounts, g: &GameRef, src: &Src) -> bool { !is_acct(&g.folder) && asks_stores(acc, src) }
/// Whether a game's list needs the stores asked (not only its files here).
pub(super) fn asks_stores(acc: &Accounts, src: &Src) -> bool {
    // (a Steam game with its trophies kept on this computer -- Steam's own file for the account,
    // or an emulator's -- needs only those: Steam isn't asked for it)
    match src { Src::Rpcs3(_) => false, Src::Steam(id, dirs) => !acc.steam_id.is_empty() && !steam_local(acc, id, dirs), _ => true }
}
/// A Steam game's trophies won are in files on this computer (Steam's own for the
/// account, kept up to date by Steam, or a Steam emulator's).
pub(super) fn steam_local(acc: &Accounts, appid: &str, dirs: &[PathBuf]) -> bool {
    steam_user_file(appid, &acc.steam_id).is_some() || !emu_files(appid, dirs).is_empty() || !greenluma_won(appid).is_empty()
}
/// The stores asked again at most this often when nothing changed here (seconds).
pub(super) const STORES_EVERY: i64 = 600;

/// One game read again: kept, its pictures fetched, newly won trophies popped up.
pub(super) fn refresh_one(app: &AppHandle, user: &str, acc: &Accounts, g: &GameRef, web: bool, pop: bool) -> Option<TrophySet> {
    let src = src_for(app, user, acc, g)?;
    let old = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.sets.get(&g.folder).cloned()).or_else(|| load_cached(app, user, &g.folder));
    let mut new = read_set(app, user, acc, g, &src, web)?;
    // (a picture fetched earlier stays)
    if let Some(o) = &old {
        let pics: HashMap<&str, &str> = o.trophies.iter().filter(|t| !t.icon.is_empty()).map(|t| (t.id.as_str(), t.icon.as_str())).collect();
        for t in new.trophies.iter_mut() { if t.icon.is_empty() { if let Some(p) = pics.get(t.id.as_str()) { if Path::new(p).is_file() { t.icon = p.to_string(); } } } }
    }
    // (read without the stores, offline or by the watching: what they said
    // before stays won until they're asked again)
    if !web && asks_for(acc, g, &src) {
        if let Some(o) = &old {
            let had: HashMap<&str, i64> = o.trophies.iter().filter_map(|t| Some((t.id.as_str(), t.earned?))).collect();
            for t in new.trophies.iter_mut() { if t.earned.is_none() { if let Some(e) = had.get(t.id.as_str()) { t.earned = Some(*e); } } }
        }
    }
    let won = old.as_ref().map(|o| newly_won(o, &new)).unwrap_or_default();
    new.sig = sig_for(acc, g, &src);
    new.checked = if web { now() } else { old.as_ref().map(|o| o.checked).unwrap_or(0) };
    save_set(app, user, &new);
    if let Some(s) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { s.sets.insert(g.folder.clone(), new.clone()); }
    if new.trophies.iter().any(|t| t.icon.is_empty() && !t.src.is_empty()) { fetch_icons(app, user, &g.folder); }
    if pop && !won.is_empty() {
        // (in the log: when the store says each was won, and how long after it was seen here)
        if web {
            let n = now();
            for t in &won { if let Some(e) = t.earned.filter(|e| *e > 0) {
                crate::log::line("INFO", "trophies", &format!("{}: \"{}\" won {} s before it was seen", new.source, t.name.chars().take(60).collect::<String>(), (n - e).max(0)));
            } }
        }
        let _ = app.emit("trophies-changed", serde_json::json!({ "folder": new.folder }));
        for t in won { crate::trophypop::trophy(app, &new, &t); }
    }
    Some(new)
}

pub(super) fn begin(user: &str, games: &[GameRef]) {
    let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let same = g.as_ref().map(|s| s.user == user).unwrap_or(false);
    if !same { *g = Some(State { user: user.into(), games: vec![], sets: HashMap::new(), srcs: HashMap::new(), stamps: HashMap::new(), last_web: HashMap::new() }); }
    let s = g.as_mut().unwrap();
    s.games = games.to_vec();
    let keep: HashSet<&str> = games.iter().map(|g| g.folder.as_str()).collect();
    s.sets.retain(|k, _| keep.contains(k.as_str()));
}

/// What's known already (kept lists), at once; the watching starts.
#[tauri::command]
pub async fn trophies_cached(app: AppHandle, user: String, games: Vec<GameRef>) -> Vec<TrophySet> {
    tauri::async_runtime::spawn_blocking(move || cached_now(&app, &user, games)).await.unwrap_or_default()
}
pub(super) fn cached_now(app: &AppHandle, user: &str, games: Vec<GameRef>) -> Vec<TrophySet> {
    let (app, user) = (app.clone(), user.to_string());
    let games: Vec<GameRef> = games.into_iter().filter(enabled).collect();
    let acc = accounts::get(&app, &user);
    let games = with_acct(&app, &user, &acc, games, None);
    begin(&user, &games);
    let mut out = Vec::new();
    for g in &games {
        if let Some(mut s) = known_or(&g.folder, || load_cached(&app, &user, &g.folder)) {
            retitle(&mut s, &g.title);
            out.push(s);
        }
    }
    out
}
/// A game's list as known this session, or else as `load` gives it (then known).
/// (The state is locked only for a moment each time: kept locked through an
/// `if let` and locked again inside it, it waited on itself forever: what froze
/// the menus at startup, and kept the sync at 0%.)
pub(super) fn known_or(folder: &str, load: impl FnOnce() -> Option<TrophySet>) -> Option<TrophySet> {
    let have = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.sets.get(folder).cloned());
    let s = have.or_else(load)?;
    let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(st) = g.as_mut() { st.sets.entry(folder.to_string()).or_insert_with(|| s.clone()); }
    Some(s)
}

pub(super) static SYNC_STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// The sync's progress (games done, of how many), also asked for by the page
/// (trophies_sync_progress) besides being told ("trophy-sync").
pub(super) static SYNC_DONE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
pub(super) static SYNC_TOTAL: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[tauri::command]
pub fn trophies_sync_progress() -> serde_json::Value {
    serde_json::json!({ "done": SYNC_DONE.load(std::sync::atomic::Ordering::SeqCst), "total": SYNC_TOTAL.load(std::sync::atomic::Ordering::SeqCst) })
}
/// The trophy sync (Trophy Collection opened: "Performing the sync operation
/// for trophy information..."): each game's list read again only when
/// something changed (its files here, the accounts it uses), the stores asked
/// at most every 10 minutes; the progress told to the page
/// ("trophy-sync": { done, total }). Nothing pops up (no trophy was won now).
#[tauri::command]
pub async fn trophies_refresh(app: AppHandle, user: String, games: Vec<GameRef>) -> Vec<TrophySet> {
    // (a game with Trophies Off: its record forgotten)
    let (games, off): (Vec<GameRef>, Vec<GameRef>) = games.into_iter().partition(enabled);
    begin(&user, &games);
    SYNC_STOP.store(false, std::sync::atomic::Ordering::SeqCst);
    SYNC_DONE.store(0, std::sync::atomic::Ordering::SeqCst);
    SYNC_TOTAL.store(games.len(), std::sync::atomic::Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let acc = accounts::get(&app, &user);
        for g in &off { record_forget(&app, &user, &g.folder); }
        record_prune(&app, &user, &acc);
        let out = Mutex::new(Vec::new());
        let done = std::sync::atomic::AtomicUsize::new(0);
        let retry = std::sync::atomic::AtomicUsize::new(0);
        let started = Instant::now();
        // (offline: what's kept and what's on this computer; the stores aren't asked)
        let online = net::online();
        // (the accounts' games not in the system: read with them)
        let games = with_acct(&app, &user, &acc, games, Some(online));
        begin(&user, &games);
        let total = games.len();
        SYNC_TOTAL.store(total, std::sync::atomic::Ordering::SeqCst);
        let _ = app.emit("trophy-sync", serde_json::json!({ "done": 0, "total": total }));
        crate::log::line("INFO", "trophies", &format!("sync: {total} games{} (connection checked in {} ms)", if online { "" } else { " (offline)" }, started.elapsed().as_millis()));
        // (a few at a time, from one queue: most of the wait is the stores
        // answering; the games whose source is known go first, so the bar
        // moves at once)
        let kept: HashSet<String> = fs::read_to_string(src_file(&app, &user)).ok().and_then(|t| serde_json::from_str::<serde_json::Map<String, Value>>(&t).ok())
            .map(|m| m.keys().cloned().collect()).unwrap_or_default();
        let mut order: Vec<&GameRef> = games.iter().collect();
        order.sort_by_key(|g| !kept.contains(&g.folder));
        let next = Mutex::new(order.into_iter());
        std::thread::scope(|sc| {
            for _ in 0..6 {
                let (app, acc, user, out, done, next, online, retry) = (&app, &acc, &user, &out, &done, &next, online, &retry);
                sc.spawn(move || { ART_WAIT.with(|w| w.set(true)); loop {
                    let Some(g) = next.lock().unwrap_or_else(|e| e.into_inner()).next() else { break };
                    if SYNC_STOP.load(std::sync::atomic::Ordering::SeqCst) { break; }
                    let t0 = Instant::now();
                    let saved = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.sets.get(&g.folder).cloned()).or_else(|| load_cached(app, user, &g.folder));
                    let r = match (src_for(app, user, acc, g), saved) {
                        // nothing changed: as it is
                        (Some(src), Some(mut sv)) if sv.sig == sig_for(acc, g, &src) && (!asks_for(acc, g, &src) || !online || now() - sv.checked < STORES_EVERY) => {
                            // (nothing new to read; the game's name as it is now, if it was renamed)
                            retitle(&mut sv, &g.title);
                            // (an account game's picture as it is now: Steam's logo of it, from this version on)
                            if is_acct(&g.folder) {
                                let a = acct_art(app, user, &g.folder); let gi = acct_icon(app, user, &g.folder);
                                let mut ch = false;
                                if !a.is_empty() && a != sv.icon { sv.icon = a; ch = true; }
                                if !gi.is_empty() && gi != sv.game_icon { sv.game_icon = gi; ch = true; }
                                if ch { save_set(app, user, &sv); }
                            }
                            STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut().map(|s| s.sets.insert(g.folder.clone(), sv.clone()));
                            // (pictures still missing: fetched again)
                            if sv.trophies.iter().any(|t| t.icon.is_empty() && !t.src.is_empty()) { fetch_icons(app, user, &g.folder); }
                            Some(sv)
                        }
                        // (the game just played: its new trophies popped up, as the store may tell them late)
                        (Some(_), _) => refresh_one(app, user, acc, g, online, just_played(&g.folder))
                            .or_else(|| STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.sets.get(&g.folder).cloned())),
                        (None, _) => {
                            // (not kept: a lookup couldn't be made; tried again next time)
                            if !STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|s| s.srcs.contains_key(&g.folder)).unwrap_or(false) { retry.fetch_add(1, std::sync::atomic::Ordering::SeqCst); }
                            None
                        }
                    };
                    if let Some(s) = r { out.lock().unwrap_or_else(|e| e.into_inner()).push(s); }
                    STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut().map(|s| s.last_web.insert(g.folder.clone(), Instant::now()));
                    // (a slow game in the log: what to look at when a sync takes long)
                    if t0.elapsed() > Duration::from_secs(8) { crate::log::line("INFO", "trophies", &format!("sync: \"{}\" took {} s", g.title, t0.elapsed().as_secs())); }
                    let n = done.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    SYNC_DONE.store(n, std::sync::atomic::Ordering::SeqCst);
                    let _ = app.emit("trophy-sync", serde_json::json!({ "done": n, "total": total }));
                } });
            }
        });
        let mut v = out.into_inner().unwrap();
        let rt = retry.load(std::sync::atomic::Ordering::SeqCst);
        crate::log::line("INFO", "trophies", &format!("sync: done in {} s ({} of {total} games, {} with trophies{}{})", started.elapsed().as_secs(), done.load(std::sync::atomic::Ordering::SeqCst),
            v.len(),
            if rt > 0 { format!(", {rt} not looked up yet: a store didn't answer, tried again next time") } else { String::new() },
            if SYNC_STOP.load(std::sync::atomic::Ordering::SeqCst) { ", cancelled" } else { "" }));
        let order: HashMap<&str, usize> = games.iter().enumerate().map(|(i, g)| (g.folder.as_str(), i)).collect();
        v.sort_by_key(|s| order.get(s.folder.as_str()).copied().unwrap_or(usize::MAX));
        if !SYNC_STOP.load(std::sync::atomic::Ordering::SeqCst) { prune_after_sync(&app, &user, &games, online); }
        v
    }).await.unwrap_or_default()
}
/// Whether the sync is needed (Trophy Collection opened), told at once, without
/// asking anything online: { changed: something changed here since the last
/// sync (a game's files, its details, the accounts, a game new to the system:
/// the sync screen shows), stores: only the stores are due to be asked again
/// (every 10 minutes: done without the screen) }.
#[tauri::command]
pub async fn trophies_sync_needed(app: AppHandle, user: String, games: Vec<GameRef>) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let games: Vec<GameRef> = games.into_iter().filter(enabled).collect();
        let acc = accounts::get(&app, &user);
        let games = with_acct(&app, &user, &acc, games, None);
        begin(&user, &games);
        let offline = net::online_known() == Some(false);
        let (mut changed, mut stores) = (false, false);
        // (accounts changed since their games were listed, or due to be asked again)
        { let l = acct_load(&app, &user); if l.who != acct_who(&acc) && !offline { changed = true; } else if !offline && now() - l.at >= STORES_EVERY { stores = true; } }
        for g in &games {
            let known = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().filter(|s| s.user == user).and_then(|s| s.srcs.get(&g.folder).cloned());
            let src = match known { Some(s) => s, None => match src_kept(&app, &user, &g.folder, &game_stamp(g), &acc) { Some(s) => s, None => { changed = true; break; } } };
            let Some(src) = src else { continue };   // (a game without trophies, as known)
            let saved = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.sets.get(&g.folder).cloned()).or_else(|| load_cached(&app, &user, &g.folder));
            let Some(sv) = saved else { changed = true; break };
            if sv.sig != sig_for(&acc, g, &src) { changed = true; break; }
            if asks_for(&acc, g, &src) && !offline && now() - sv.checked >= STORES_EVERY { stores = true; }
        }
        serde_json::json!({ "changed": changed, "stores": stores })
    }).await.unwrap_or(serde_json::json!({ "changed": true, "stores": false }))
}

/// The sync cancelled (○ Cancel): the games not read yet are left as they were.
#[tauri::command]
pub fn trophies_sync_cancel() { SYNC_STOP.store(true, std::sync::atomic::Ordering::SeqCst); }

/// The files that change when a game's trophies do (only its own files on this computer).
pub(super) fn stamp_of_files(acc: &Accounts, src: &Src) -> Vec<PathBuf> {
    match src {
        Src::Rpcs3(d) => vec![d.join("TROPUSR.DAT")],
        Src::Steam(id, dirs) => steam_stamp_files(acc, id, dirs),
        _ => vec![],
    }
}
pub(super) fn stamp_of(app: &AppHandle, acc: &Accounts, src: &Src) -> Vec<(PathBuf, Option<SystemTime>)> {
    let _ = app;
    stamp_of_files(acc, src).into_iter().map(|f| { let m = fs::metadata(&f).and_then(|m| m.modified()).ok(); (f, m) }).collect()
}

/// The achievements a RetroAchievements account won lately: (achievement, its game).
/// Err(true): asked too often or refused (slow down); Err(false): no answer.
pub(super) fn ra_recent(acc: &Accounts) -> Result<Vec<(String, u64)>, bool> {
    let url = format!("https://retroachievements.org/API/API_GetUserRecentAchievements.php?u={}&y={}&m=10", net::enc(&acc.ra_user), net::enc(&acc.ra_key));
    let r = net::request("GET", &url, &[], None, 8).ok_or(false)?;
    if r.status == 429 || r.status == 401 || r.status == 403 { return Err(true); }
    if !r.ok() { return Err(false); }
    let v: Value = serde_json::from_str(&r.text()).map_err(|_| false)?;
    Ok(ra_recent_of(&v))
}
pub(super) fn ra_recent_of(v: &Value) -> Vec<(String, u64)> {
    let num = |x: &Value| x.as_u64().or_else(|| x.as_str().and_then(|s| s.trim().parse().ok()));
    v.as_array().into_iter().flatten().filter_map(|a| Some((num(&a["AchievementID"])?.to_string(), num(&a["GameID"]).unwrap_or(0)))).collect()
}
/// How often RetroAchievements is asked while one of its games runs: every second; asked
/// too often (it refuses) or not answering, every 5 seconds for the next minute.
/// The game that ended last and when: its store asked again a few times after it (a store
/// may take a while to have what was won at the end), its new trophies popping up.
pub(super) static LAST_PLAYED: Mutex<Option<(String, Instant)>> = Mutex::new(None);
pub(super) fn just_played(folder: &str) -> bool {
    LAST_PLAYED.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|(f, t)| f == folder && t.elapsed() < Duration::from_secs(600)).unwrap_or(false)
}
/// After a game whose trophies come from a store ends: its store asked again this long after (seconds).
pub(super) const AFTER_GAME: [u64; 4] = [8, 30, 90, 240];
/// How often the store of the game running is read (seconds), its trophies won popping up; a
/// store not answering: twice as long each time, at most 160 s.
/// - Steam with the Web API Key: one small question (the account's achievements of that game)
///   every 4 s, 900 an hour: far under the key's 100,000 a day.
/// - GOG, Epic Games: one question every 6 s, 600 an hour (Epic's list of the game's trophies kept for half an
///   hour: only the account's won ones asked); they publish no limits: kept well under one a second,
///   and a refusal (too many requests, say) makes the next wait twice as long (12, 24, 48 s...).
///   (3 s was tried in v3 changes 60: back to 6 s, the pace their pop-ups showed with.)
/// - Steam games with their trophies in files here (Steam's own, an emulator's): never asked.
/// - Steam without the key (its community pages, paced and resting on "too many requests"):
///   every 20 s; RetroAchievements: its own watch (every second), here every minute.
pub(super) fn web_every(acc: &Accounts, src: &Src) -> u64 {
    match src {
        Src::Ra | Src::RaGame(_) => 60,
        Src::Steam(..) => if acc.steam_key.is_empty() { 20 } else { 4 },
        // (one short answer each time -- GOG: the game's achievements; Epic: only the account's
        // won ones, the game's list kept 30 minutes --; a refusal slows it down at once, below)
        Src::Gog(..) | Src::Epic(_) => 6,
        Src::Rpcs3(_) => 60,
    }
}
/// The wait before the store is asked again after `fails` refusals in a row: twice as long
/// each time, at most 160 s.
pub(super) fn web_wait(every: u64, fails: u32) -> u64 { (every << fails.min(5)).min(160) }
pub(super) const RA_FAST: Duration = Duration::from_secs(1);
pub(super) const RA_SLOW: Duration = Duration::from_secs(5);
/// While a game whose trophies come from RetroAchievements runs, its trophies won are
/// noticed within a second or so (their list read again, and popped up, only then): its
/// recent achievements are asked for -- one short answer -- on their own thread, so the game
/// is never kept waiting.
pub(super) fn start_ra_watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut slow_until: Option<Instant> = None;
        // (the list read again at most every 3 seconds, whatever the answers say)
        let mut read_at: Option<Instant> = None;
        loop {
            std::thread::sleep(if slow_until.map(|t| t.elapsed() < Duration::from_secs(60)).unwrap_or(false) { RA_SLOW } else { RA_FAST });
            if !crate::focus::in_game() { continue; }
            let Some(folder) = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).clone() else { continue };
            let Some((user, g, src, won)) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| {
                let g = s.games.iter().find(|g| g.folder == folder)?.clone();
                let src = s.srcs.get(&folder)?.clone()?;
                let won: Option<HashSet<String>> = s.sets.get(&folder).map(|t| t.trophies.iter().filter(|t| t.earned.is_some()).map(|t| t.id.clone()).collect());
                Some((s.user.clone(), g, src, won))
            }) else { continue };
            // (its list not read this session: the kept one)
            let won: HashSet<String> = match won { Some(w) => w, None => match load_cached(&app, &user, &folder) {
                Some(t) => t.trophies.iter().filter(|t| t.earned.is_some()).map(|t| t.id.clone()).collect(), None => HashSet::new() } };
            let game = match src { Src::RaGame(id) => Some(id), Src::Ra => None, _ => continue };
            let acc = accounts::get(&app, &user);
            if acc.ra_user.is_empty() || acc.ra_key.is_empty() || net::online_known() == Some(false) { continue; }
            match ra_recent(&acc) {
                Ok(list) => {
                    let new = list.iter().any(|(a, gid)| game.map(|id| *gid == id).unwrap_or(true) && !won.contains(a));
                    if new && read_at.map(|t| t.elapsed() >= Duration::from_secs(3)).unwrap_or(true) { read_at = Some(Instant::now()); refresh_one(&app, &user, &acc, &g, true, true); STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut().map(|s| s.last_web.insert(folder.clone(), Instant::now())); }
                }
                Err(true) => slow_until = Some(Instant::now()),
                Err(false) => slow_until = Some(Instant::now()),
            }
        }
    });
}

/// Watches the trophies: the files of games with trophies on this computer
/// (every 1.5 s while their game runs, every 10 s otherwise); the stores of
/// the game running (web_every).
pub fn start_watch(app: AppHandle) {
    start_ra_watch(app.clone());
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        // (the games already looked for in the kept sources: once a session)
        let mut tried: HashSet<(String, String)> = HashSet::new();
        // (the stores that didn't answer, in a row, for each game)
        let mut web_fails: HashMap<String, u32> = HashMap::new();
        // (the game running at the last look; the game that ended, its store asked again: when, how many times)
        let mut was_running: Option<String> = None;
        let mut after: Option<(String, Instant, usize)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            tick += 1;
            let Some((user, games, srcs)) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|s| (s.user.clone(), s.games.clone(), s.srcs.clone())) else { continue };
            if user.is_empty() || games.is_empty() { continue; }
            let running = if crate::focus::in_game() { RUNNING.lock().unwrap_or_else(|e| e.into_inner()).clone() } else { None };
            let acc = accounts::get(&app, &user);
            // (a game ended: a store's game is asked again a few times, what it won at the end popping up)
            if was_running.is_some() && running != was_running {
                let f = was_running.take().unwrap();
                *LAST_PLAYED.lock().unwrap_or_else(|e| e.into_inner()) = Some((f.clone(), Instant::now()));
                if srcs.get(&f).cloned().flatten().map(|s| asks_stores(&acc, &s)).unwrap_or(false) { after = Some((f, Instant::now(), 0)); }
            }
            was_running = running.clone();
            if let Some((f, at, n)) = after.clone() {
                if at.elapsed() >= Duration::from_secs(AFTER_GAME[n]) {
                    after = if n + 1 < AFTER_GAME.len() { Some((f.clone(), at, n + 1)) } else { None };
                    if let Some(g) = games.iter().find(|g| g.folder == f) {
                        if net::online() { refresh_one(&app, &user, &acc, g, true, true); }
                        STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut().map(|s| s.last_web.insert(f.clone(), Instant::now()));
                    }
                }
            }
            // (the games whose source isn't known this session yet -- Trophy Collection not opened
            // since the start: only the levels' kept lists were read -- take the one kept on this
            // computer, so a trophy won before the first sync still pops up)
            let mut srcs = srcs;
            let missing: Vec<&GameRef> = games.iter().filter(|g| !srcs.contains_key(&g.folder) && !is_acct(&g.folder) && tried.insert((user.clone(), g.folder.clone()))).collect();
            for g in missing {
                if let Some(k) = src_kept(&app, &user, &g.folder, &game_stamp(g), &acc) {
                    srcs.insert(g.folder.clone(), k.clone());
                    if let Some(st) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { if st.user == user { st.srcs.entry(g.folder.clone()).or_insert(k); } }
                }
            }
            // (the PS3 game running without a trophy folder of its own yet -- its first play: RPCS3
            // makes the folder once the game starts --: looked for every 6 s, any trophy already won then popping up)
            if let Some(g) = running.as_deref().filter(|_| tick % 4 == 0).and_then(|r| games.iter().find(|g| g.folder == r)) {
                let before = srcs.get(&g.folder).cloned().flatten();
                let unsettled = match &before { None => true, Some(Src::Rpcs3(d)) => d.starts_with(crate::paths::trophies_dir(&app).join("trp")), _ => false };
                if unsettled && is_ps3_game(Path::new(&g.folder)) {
                    let now_src = src_for(&app, &user, &acc, g);
                    if now_src != before {
                        if let Some(s) = &now_src { if let Some(st) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { st.stamps.insert(g.folder.clone(), stamp_of(&app, &acc, s)); } }
                        srcs.insert(g.folder.clone(), now_src.clone());
                        if now_src.is_some() { refresh_one(&app, &user, &acc, g, false, true); }
                    }
                }
            }
            for g in &games {
                let Some(Some(src)) = srcs.get(&g.folder) else { continue };
                let is_run = running.as_deref() == Some(g.folder.as_str());
                let local = matches!(src, Src::Rpcs3(_) | Src::Steam(..));
                if local && (is_run || tick % 7 == 0) {
                    let st = stamp_of(&app, &acc, src);
                    let prev = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|s| s.stamps.insert(g.folder.clone(), st.clone()));
                    if prev.is_some() && prev.as_ref() != Some(&st) { refresh_one(&app, &user, &acc, g, false, true); }
                }
                let web = is_run && (!local || (matches!(src, Src::Steam(..)) && asks_stores(&acc, src)));
                if web {
                    // (the stores read while their game runs, as often as web_every says -- RetroAchievements has
                    // its own watch, every minute here --; a store not answering: twice as long each time, at most 160 s)
                    let fails = *web_fails.get(&g.folder).unwrap_or(&0);
                    let every = web_wait(web_every(&acc, src), fails);
                    let due = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|s| s.last_web.get(&g.folder).copied()).map(|t| t.elapsed() > Duration::from_secs(every)).unwrap_or(true);
                    if due {
                        STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut().map(|s| s.last_web.insert(g.folder.clone(), Instant::now()));
                        if net::online() {
                            if refresh_one(&app, &user, &acc, g, true, true).is_some() { web_fails.remove(&g.folder); } else { web_fails.insert(g.folder.clone(), fails + 1); }
                        }
                    }
                }
            }
        }
    });
}
