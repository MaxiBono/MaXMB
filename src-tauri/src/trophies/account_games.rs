//! Part of trophies.rs. Account Games: the games of the user's accounts that aren't in the system, listed in Trophy Collection.

use super::*;

// ============================================================ Account Games

/// A game of one of the user's accounts (Steam, RetroAchievements, Epic Games,
/// GOG) that isn't in the system: listed in Trophy Collection like the
/// system's games (Account Management > Account Games turns each On or Off).
/// Its "folder" is "acct:<store>:<id>".
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AcctGame {
    pub folder: String,
    pub store: String,
    pub id: String,
    pub title: String,
    /// its picture on the store (a web address)
    pub art: String,
    /// what changes when it's played (play time, last played, trophies won): the same → not read again
    pub stamp: String,
    /// Some(false): read, and it has no trophies (not listed)
    pub has: Option<bool>,
    /// Account Games: On (default) / Off
    pub on: bool,
    /// what it's played on (RetroAchievements: its console; the stores: PC)
    pub console: String,
}
pub fn is_acct(folder: &str) -> bool { folder.starts_with("acct:") }
pub(super) fn acct_parts(folder: &str) -> Option<(&str, &str)> { folder.strip_prefix("acct:")?.split_once(':') }
pub(super) fn acct_file(app: &AppHandle, user: &str) -> PathBuf { crate::paths::trophies_dir(app).join("accounts").join(format!("{}.json", safe(user))) }
pub(super) fn acct_off_file(app: &AppHandle, user: &str) -> PathBuf { crate::paths::trophies_dir(app).join("accounts").join(format!("{}_off.json", safe(user))) }
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub(super) struct AcctList { pub(super) at: i64, pub(super) who: String, pub(super) games: Vec<AcctGame> }
pub(super) static ACCT_LOCK: Mutex<()> = Mutex::new(());
pub(super) fn acct_load(app: &AppHandle, user: &str) -> AcctList {
    let mut l: AcctList = fs::read_to_string(acct_file(app, user)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let off: HashSet<String> = fs::read_to_string(acct_off_file(app, user)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    for g in l.games.iter_mut() { g.on = !off.contains(&g.folder); }
    l
}
pub(super) fn acct_save(app: &AppHandle, user: &str, l: &AcctList) {
    let f = acct_file(app, user);
    let _ = fs::create_dir_all(f.parent().unwrap());
    if let Ok(t) = serde_json::to_string(l) { let _ = crate::paths::write_whole(&f, t); }
}
/// The accounts the list was made with (another account, or one removed: made again).
pub(super) fn acct_who(acc: &Accounts) -> String {
    fnv(&format!("{}|{}|{}|{}|{}|{}|{}|{}", acc.steam_id, !acc.steam_key.is_empty(), acc.ra_user, !acc.ra_key.is_empty(), acc.epic_id,
        if acc.gog_user_id.is_empty() { &acc.gog_public } else { &acc.gog_name }, acc.gog_public, !acc.epic_refresh.is_empty()))
}
pub(super) fn num_s(v: &Value) -> String { v.as_i64().map(|n| n.to_string()).or_else(|| v.as_str().map(|s| s.to_string())).unwrap_or_default() }

/// Steam: the account's games (with a key: Steam's own list, only the games
/// with achievements; with only the ID: the public profile's games page).
pub(super) fn steam_owned(acc: &Accounts) -> Option<Vec<AcctGame>> {
    if acc.steam_id.is_empty() { return Some(vec![]); }
    let mk = |id: String, title: String, stamp: String, has: Option<bool>| AcctGame { folder: format!("acct:steam:{id}"), store: "steam".into(),
        art: format!("https://cdn.akamai.steamstatic.com/steam/apps/{id}/header.jpg"), id, title, stamp, has, on: true, console: "PC".into() };
    if !acc.steam_key.is_empty() {
        // (whose: the Steam ID typed, or with the key alone the account signed in to Steam here -- its last digits only in the log)
        let whose = format!("{} …{}", if accounts::steam_id_typed(acc) { "the Steam ID typed" } else { "the account signed in to Steam here" },
            &acc.steam_id[acc.steam_id.len().saturating_sub(4)..]);
        let Some(r) = net::request("GET", &format!("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={}&steamid={}&include_appinfo=1&include_played_free_games=1",
            net::enc(&acc.steam_key), net::enc(&acc.steam_id)), &[], None, 25) else {
            crate::log::line("WARN", "steam", &format!("Steam Web API Key: the games list of {whose} didn't answer")); return None };
        if !r.ok() {
            crate::log::line("WARN", "steam", &format!("Steam Web API Key: the games list of {whose} answered {}{}", r.status,
                if r.status == 401 || r.status == 403 { " (is the key right?)" } else if r.status == 429 { " (too many asked for: tried again later)" } else { "" }));
            return None;
        }
        let v = r.json().unwrap_or(Value::Null);
        let games = v["response"]["games"].as_array().cloned().unwrap_or_default();
        let out: Vec<AcctGame> = games.iter().filter(|g| g["has_community_visible_stats"].as_bool().unwrap_or(false)).filter_map(|g| {
            let id = num_s(&g["appid"]); if id.is_empty() { return None; }
            Some(mk(id, g["name"].as_str().unwrap_or("").trim().to_string(), format!("{}:{}", num_s(&g["playtime_forever"]), num_s(&g["rtime_last_played"])), None))
        }).collect();
        // (an empty answer: Steam gives none for an account whose Game details aren't public, unless the key is that account's own)
        if games.is_empty() { crate::log::line("WARN", "steam", &format!("Steam Web API Key: no games for {whose} (is the key this account's own, or are its Game details public?)")); }
        else { crate::log::line("INFO", "steam", &format!("Steam Web API Key: {} games for {whose}, {} with achievements", games.len(), out.len())); }
        return Some(out);
    }
    // (no key: none. Steam shows a profile's games only to someone signed in, so the Steam ID
    // alone connects Steam Friends only)
    Some(vec![])
}
/// RetroAchievements: every game played on the account.
pub(super) fn ra_owned(acc: &Accounts) -> Option<Vec<AcctGame>> {
    if acc.ra_user.is_empty() || acc.ra_key.is_empty() { return Some(vec![]); }
    let mut out = Vec::new();
    let mut off = 0;
    loop {
        let v = ra_get(acc, "GetUserCompletionProgress", &format!("c=500&o={off}"))?;
        let res = v["Results"].as_array().cloned().unwrap_or_default();
        for g in &res {
            let id = num_s(&g["GameID"]); if id.is_empty() { continue; }
            out.push(AcctGame { folder: format!("acct:ra:{id}"), store: "ra".into(), id,
                title: g["Title"].as_str().unwrap_or("").trim().to_string(),
                art: g["ImageIcon"].as_str().map(|i| format!("https://media.retroachievements.org{i}")).unwrap_or_default(),
                stamp: format!("{}:{}:{}", num_s(&g["NumAwarded"]), num_s(&g["NumAwardedHardcore"]), g["MostRecentAwardedDate"].as_str().unwrap_or("")),
                has: Some(true), on: true, console: g["ConsoleName"].as_str().unwrap_or("").to_string() });
        }
        let total = v["Total"].as_u64().unwrap_or(0) as usize;
        off += res.len();
        if res.is_empty() || off >= total || off > 5000 { break; }
    }
    Some(out)
}
/// Epic Games: the games with achievements on the account (its achievement
/// records, a game a record), their names and pictures from Epic's store (kept
/// in schemas\epic_names.json, asked for once).
pub(super) fn epic_owned(app: &AppHandle, user: &str, acc: &Accounts) -> Option<Vec<AcctGame>> {
    // (signed in only: an Epic account's achievements are its own to see, whatever its profile shows)
    if acc.epic_id.is_empty() || acc.epic_refresh.is_empty() { return Some(vec![]); }
    let q = r#"query PlayerGameAchievementProgress($epicAccountId: String!) { PlayerAchievement { playerAchievementGameRecords(epicAccountId: $epicAccountId, includeAchievements: false) { records { sandboxId totalUnlocked totalXP } } } }"#;
    let hdr = epic_hdr_for(app, user);
    let v = store_req("Epic Games", "POST", EPIC_GQL, &hdr, Some(&serde_json::json!({ "query": q, "variables": { "epicAccountId": acc.epic_id } }).to_string()))?;
    let recs = &v["data"]["PlayerAchievement"]["playerAchievementGameRecords"];
    // (nothing listed: Epic's answer written in the log as it came -- names of fields and games only)
    if recs["records"].as_array().map(|a| a.is_empty()).unwrap_or(true) {
        let raw: String = v.to_string().chars().take(300).collect();
        crate::log::line("WARN", "trophies", &format!("Epic Games: no achievement records ({}): {raw}", if hdr.len() > 2 { "signed in" } else { "the sign-in has expired" }));
    }
    // (no data: the answer was an error, written in the log by store_req; the games stay as they were)
    if recs.is_null() { crate::log::line("WARN", "trophies", "Epic Games: the account's achievement records weren't given (a private profile?)"); return None; }
    let list = recs["records"].as_array().cloned().unwrap_or_default();
    let file = crate::paths::trophies_dir(app).join("schemas").join("epic_names.json");
    let mut names: serde_json::Map<String, Value> = fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let before = names.len();
    let mut out = Vec::new();
    for g in &list {
        let Some(ns) = g["sandboxId"].as_str().filter(|s| !s.is_empty()) else { continue };
        if !names.contains_key(ns) { if let Some(n) = epic_store_name(ns) { names.insert(ns.to_string(), n); } }
        let n = names.get(ns).cloned().unwrap_or(Value::Null);
        let title = n["title"].as_str().unwrap_or("").trim().to_string();
        if title.is_empty() { continue; }
        out.push(AcctGame { folder: format!("acct:epic:{ns}"), store: "epic".into(), id: ns.to_string(), title, art: n["art"].as_str().unwrap_or("").to_string(),
            stamp: format!("{}:{}", num_s(&g["totalUnlocked"]), num_s(&g["totalXP"])), has: None, on: true, console: "PC".into() });
    }
    if names.len() != before { let _ = fs::create_dir_all(file.parent()?); let _ = fs::write(&file, Value::Object(names).to_string()); }
    crate::log::line("INFO", "trophies", &format!("Epic Games: {} achievement records, {} games named", list.len(), out.len()));
    Some(out)
}
/// A game's name and wide picture on Epic's store, by its namespace (sandbox).
pub(super) fn epic_store_name(ns: &str) -> Option<Value> {
    let q = r#"query searchStoreQuery($namespace: String, $country: String!, $locale: String, $count: Int) { Catalog { searchStore(namespace: $namespace, country: $country, locale: $locale, count: $count) { elements { title keyImages { type url } categories { path } } } } }"#;
    let v = store_req("Epic Games", "POST", EPIC_GQL, &epic_hdr(), Some(&serde_json::json!({ "query": q, "variables": { "namespace": ns, "country": "US", "locale": "en-US", "count": 10 } }).to_string()))?;
    let els = v["data"]["Catalog"]["searchStore"]["elements"].as_array().cloned().unwrap_or_default();
    // (the base game first, else any game, else the first thing listed)
    let is = |e: &Value, p: &str| e["categories"].as_array().map(|c| c.iter().any(|x| x["path"].as_str() == Some(p))).unwrap_or(false);
    let e = els.iter().find(|e| is(e, "games/edition/base")).or_else(|| els.iter().find(|e| is(e, "games"))).or_else(|| els.first())?;
    let imgs = e["keyImages"].as_array().cloned().unwrap_or_default();
    let pick = |t: &str| imgs.iter().find(|i| i["type"].as_str() == Some(t)).and_then(|i| i["url"].as_str()).map(|s| s.to_string());
    let art = pick("OfferImageWide").or_else(|| pick("DieselStoreFrontWide")).or_else(|| pick("Thumbnail")).or_else(|| imgs.first().and_then(|i| i["url"].as_str()).map(|s| s.to_string())).unwrap_or_default();
    Some(serde_json::json!({ "title": e["title"].as_str().unwrap_or(""), "art": art }))
}
/// GOG: the account's games. Signed in: every game it owns (embed.gog.com's
/// list, their names and pictures from api.gog.com), whether anything was won
/// in it or not; the games' stats page of the profile adds what changes when
/// they're played (and is the list for a public profile without signing in).
/// Whether a game has achievements is known once it's read.
pub(super) fn gog_owned(app: &AppHandle, user: &str, acc: &Accounts) -> Option<Vec<AcctGame>> {
    let name = if !acc.gog_public.is_empty() { acc.gog_public.clone() } else { acc.gog_name.clone() };
    if name.is_empty() { return Some(vec![]); }
    let tok = accounts::gog_token(app, user);
    let mut out = gog_stats(&name, &tok.as_ref().map(|(t, _)| vec![format!("Authorization: Bearer {t}")]).unwrap_or_default());
    if let Some((t, _)) = &tok {
        let owned = gog_owned_ids(t);
        if owned.is_none() { crate::log::line("WARN", "trophies", "GOG: the account's games couldn't be read"); }
        if let Some(ids) = owned {
            let have: HashSet<String> = out.as_ref().map(|l| l.iter().map(|g| g.id.clone()).collect()).unwrap_or_default();
            let todo: Vec<String> = ids.into_iter().filter(|i| !have.contains(i)).collect();
            let day = (now() / 86400).to_string();
            let mut more = Vec::new();
            for chunk in todo.chunks(50) {
                let Some(v) = net::get_json(&format!("https://api.gog.com/products?ids={}", chunk.join(",")), &[]) else { continue };
                more.extend(gog_products_of(&v, &day));
            }
            out = Some(out.unwrap_or_default().into_iter().chain(more).collect());
        }
    }
    out
}
/// The IDs of the games a signed-in GOG account owns.
pub(super) fn gog_owned_ids(token: &str) -> Option<Vec<String>> {
    let v = store_req("GOG", "GET", "https://embed.gog.com/user/data/games", &[format!("Authorization: Bearer {token}")], None)?;
    Some(v["owned"].as_array()?.iter().map(num_s).filter(|s| !s.is_empty()).collect())
}
/// api.gog.com's products: the games among them (not add-ons, packs or films) as account games.
pub(super) fn gog_products_of(v: &Value, stamp: &str) -> Vec<AcctGame> {
    v.as_array().into_iter().flatten().filter(|p| p["game_type"].as_str().map(|t| t == "game").unwrap_or(true)).filter_map(|p| {
        let id = num_s(&p["id"]); if id.is_empty() { return None; }
        let title = p["title"].as_str().unwrap_or("").trim().to_string(); if title.is_empty() { return None; }
        let img = p["images"]["logo2x"].as_str().or(p["images"]["logo"].as_str()).unwrap_or("");
        let art = if img.starts_with("//") { format!("https:{img}") } else { img.to_string() };
        Some(AcctGame { folder: format!("acct:gog:{id}"), store: "gog".into(), id, title, art, stamp: stamp.to_string(), has: None, on: true, console: "PC".into() })
    }).collect()
}
/// A GOG profile's games' stats page (public, or the signed-in account's own).
pub(super) fn gog_stats(name: &str, auth: &[String]) -> Option<Vec<AcctGame>> {
    let mut out = Vec::new();
    for page in 1..=40 {
        let r = net::request("GET", &format!("https://www.gog.com/u/{}/games/stats?sort=recent_playtime&order=desc&page={page}", net::enc(name)), auth, None, 25);
        let Some(v) = r.as_ref().filter(|r| r.ok()).and_then(|r| r.json()) else {
            if page == 1 {
                // (what GOG answered: 401 / 403 a profile only its owner or friends see, 404 no such username)
                let st = r.as_ref().map(|r| r.status.to_string()).unwrap_or_else(|| "nothing".into());
                let why = match r.as_ref().map(|r| r.status) { Some(401) | Some(403) => " (the profile isn't public: GOG's Privacy settings)", Some(404) => " (no profile with that username?)", Some(200) => " (not the games list)", _ => "" };
                crate::log::line("WARN", "trophies", &format!("GOG: the profile's games page answered {st}{why}{}", if auth.is_empty() { "" } else { ", signed in" }));
                return None;
            }
            break;
        };
        let items = v["_embedded"]["items"].as_array().cloned().unwrap_or_default();
        for it in &items {
            let g = &it["game"];
            let id = num_s(&g["id"]); if id.is_empty() { continue; }
            // (no achievements: kept as known to have none, not listed)
            let none = g["achievementSupport"].as_bool() == Some(false);
            let st = it["stats"].as_object().and_then(|o| o.values().next().cloned()).unwrap_or(Value::Null);
            let art = g["image"].as_str().map(|i| if i.starts_with("//") { format!("https:{i}_392.jpg") } else { format!("{i}_392.jpg") }).unwrap_or_default();
            out.push(AcctGame { folder: format!("acct:gog:{id}"), store: "gog".into(), id, title: g["title"].as_str().unwrap_or("").trim().to_string(), art,
                stamp: format!("{}:{}", num_s(&st["achievements"]), num_s(&st["playtime"])), has: if none { Some(false) } else { None }, on: true, console: "PC".into() });
        }
        if page as u64 >= v["pages"].as_u64().unwrap_or(1) || items.is_empty() { break; }
    }
    Some(out)
}
/// The account games read again from the stores (at most every 10 minutes, or
/// when the accounts changed); offline or a store not answering: what was kept.
pub(super) fn acct_refresh(app: &AppHandle, user: &str, acc: &Accounts, online: bool) -> AcctList {
    let _l = ACCT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut l = acct_load(app, user);
    let who = acct_who(acc);
    if l.who != who {
        // (accounts changed: the games of an account no longer connected go)
        let keep = |s: &str| match s { "steam" => !acc.steam_id.is_empty(), "ra" => !acc.ra_key.is_empty(), "epic" => !acc.epic_id.is_empty(),
            "gog" => !acc.gog_public.is_empty() || !acc.gog_name.is_empty(), _ => false };
        l.games.retain(|g| keep(&g.store));
    }
    if online && (l.who != who || now() - l.at >= STORES_EVERY) {
        let (mut got, mut failed) = (0, false);
        for (store, list) in [("steam", steam_owned(acc)), ("ra", ra_owned(acc)), ("epic", epic_owned(app, user, acc)), ("gog", gog_owned(app, user, acc))] {
            // (a store not answering: its games as they were)
            let Some(list) = list else { failed = true; continue };
            got += 1;
            let old: HashMap<String, AcctGame> = l.games.iter().filter(|g| g.store == store).map(|g| (g.folder.clone(), g.clone())).collect();
            l.games.retain(|g| g.store != store);
            for mut g in list {
                if g.title.is_empty() { continue; }
                if let Some(o) = old.get(&g.folder) { if g.has.is_none() { g.has = o.has; } }
                l.games.push(g);
            }
        }
        // (one that didn't answer -- a key not accepted yet, say --: all asked again in a minute, not in 10)
        if got > 0 { l.at = if failed { now() - STORES_EVERY + 60 } else { now() }; l.who = who; }
        acct_save(app, user, &l);
        crate::log::line("INFO", "trophies", &format!("account games: {} ({})", l.games.len(),
            ["steam", "ra", "epic", "gog"].iter().map(|s| format!("{s} {}", l.games.iter().filter(|g| &g.store == s).count())).collect::<Vec<_>>().join(", ")));
    }
    acct_load_off(app, user, &mut l);
    l
}
pub(super) fn acct_load_off(app: &AppHandle, user: &str, l: &mut AcctList) {
    let off: HashSet<String> = fs::read_to_string(acct_off_file(app, user)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    for g in l.games.iter_mut() { g.on = !off.contains(&g.folder); }
}
/// The account games that are in the system already (the same store's game, or
/// one with its name): left out (the system's copy has them).
pub(super) fn acct_in_system(app: &AppHandle, user: &str, acc: &Accounts, games: &[GameRef], list: &[AcctGame]) -> HashSet<String> {
    let mut ids: HashSet<String> = HashSet::new();
    for g in games.iter().filter(|g| !is_acct(&g.folder)) {
        let known = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().filter(|s| s.user == user).and_then(|s| s.srcs.get(&g.folder).cloned())
            .or_else(|| src_kept(app, user, &g.folder, &game_stamp(g), acc));
        match known.flatten() {
            Some(Src::Steam(id, _)) => { ids.insert(format!("acct:steam:{id}")); }
            Some(Src::Epic(ns)) => { ids.insert(format!("acct:epic:{ns}")); }
            Some(Src::Gog(id, _)) => { ids.insert(format!("acct:gog:{id}")); }
            _ => {}
        }
    }
    let titles: Vec<String> = games.iter().filter(|g| !is_acct(&g.folder)).map(|g| g.title.clone()).collect();
    list.iter().filter(|a| ids.contains(&a.folder) || titles.iter().any(|t| crate::gameart::likeness(t, &a.title) >= 0.92)).map(|a| a.folder.clone()).collect()
}
/// The system's games and the account games to read (On, not in the system,
/// not known to have no trophies), as the sync reads them.
pub(super) fn with_acct(app: &AppHandle, user: &str, acc: &Accounts, games: Vec<GameRef>, online: Option<bool>) -> Vec<GameRef> {
    let l = match online { Some(o) => acct_refresh(app, user, acc, o), None => { let mut l = acct_load(app, user); acct_load_off(app, user, &mut l); l } };
    let inside = acct_in_system(app, user, acc, &games, &l.games);
    let mut games = games;
    for a in l.games.iter().filter(|a| a.on && a.has != Some(false) && !inside.contains(&a.folder)) {
        games.push(GameRef { folder: a.folder.clone(), title: a.title.clone(), launch: String::new(), stamp: a.stamp.clone() });
    }
    games
}
/// An account game's source.
pub(super) fn acct_src(folder: &str) -> Option<Src> {
    let (store, id) = acct_parts(folder)?;
    Some(match store { "steam" => Src::Steam(id.into(), vec![]), "epic" => Src::Epic(id.into()), "gog" => Src::Gog(id.into(), vec![]), "ra" => Src::Ra, _ => return None })
}
/// After an account game was read: known to have trophies or not (one without isn't listed).
pub(super) fn acct_mark(app: &AppHandle, user: &str, folder: &str, has: bool) {
    let _l = ACCT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut l = acct_load(app, user);
    let mut changed = false;
    for g in l.games.iter_mut().filter(|g| g.folder == folder) { if g.has != Some(has) { g.has = Some(has); changed = true; } }
    if changed { acct_save(app, user, &l); }
}
/// Account Management > Account Games: the account games not in the system,
/// by store, each On or Off (the ones known to have no trophies left out).
#[tauri::command]
pub async fn account_games(app: AppHandle, user: String, games: Vec<GameRef>) -> Vec<AcctGame> {
    tauri::async_runtime::spawn_blocking(move || {
        let acc = accounts::get(&app, &user);
        let mut l = acct_load(&app, &user);
        acct_load_off(&app, &user, &mut l);
        let inside = acct_in_system(&app, &user, &acc, &games, &l.games);
        let mut v: Vec<AcctGame> = l.games.into_iter().filter(|g| g.has != Some(false) && !inside.contains(&g.folder)).collect();
        v.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        v
    }).await.unwrap_or_default()
}
/// An account game turned On or Off (Off: out of Trophy Collection and the level).
#[tauri::command]
pub async fn account_game_set(app: AppHandle, user: String, folder: String, on: bool) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let f = acct_off_file(&app, &user);
        let mut off: Vec<String> = fs::read_to_string(&f).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        off.retain(|x| x != &folder);
        // (Off: its trophy record and saved list forgotten too)
        if !on {
            off.push(folder.clone());
            if let Some(s) = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut() { s.sets.remove(&folder); }
            record_forget(&app, &user, &folder);
            let _ = fs::remove_file(set_file(&app, &user, &folder));
        }
        let _ = fs::create_dir_all(f.parent().unwrap());
        let _ = fs::write(&f, serde_json::to_string(&off).unwrap_or_default());
    }).await;
}
thread_local! {
    /// The sync's own threads: an account game's picture is fetched there and then, so the
    /// Trophy Collection's loading screen ends with the pictures in (acct_art).
    pub(super) static ART_WAIT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
/// An account game's picture: kept with the trophies' ones; not there yet:
/// fetched in the sync (its loading screen), or else in the background, then told
/// to the page ("trophy-game-art"). Steam's main capsule of the game, its banner (a Steam
/// game's own; another store's, the Steam game with its name); without one, as it would be in
/// the system: its logo (its header when it has no logo); else its store's.
pub(super) fn acct_art(app: &AppHandle, user: &str, folder: &str) -> String {
    let Some(g) = ({ let _l = ACCT_LOCK.lock().unwrap_or_else(|e| e.into_inner()); acct_load(app, user).games.into_iter().find(|g| g.folder == folder) }) else { return String::new() };
    let tdir = crate::paths::trophies_dir(app);
    let steam = if g.store == "steam" { Some(Some(g.id.clone())) } else if g.store == "ra" { Some(None) } else { steam_name_kept(&tdir, &g.title) };
    let wait = ART_WAIT.with(|w| w.get());
    let shown = move |app: &AppHandle, user: &str, folder: &str, path: String| {
        // (in the sync: the game's set takes it as it's made; after it: told to the page)
        if wait { return; }
        let set = STATE.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|s| s.sets.get_mut(folder)).map(|s| { s.icon = path.clone(); s.clone() });
        if let Some(s) = set { save_set(app, user, &s); }
        let _ = app.emit("trophy-game-art", serde_json::json!({ "folder": folder, "icon": path }));
    };
    // (fetched in the sync itself, or in the background with the header shown meanwhile)
    let run = |job: Box<dyn FnOnce() -> Option<String> + Send>| -> Option<String> { if wait { job() } else { std::thread::spawn(job); None } };
    // (Steam's picture of it: the game's main capsule; without one, its logo, the icon it would
    // have in the system; Steam's header when the game has no logo)
    if let Some(Some(id)) = &steam {
        let files = steam_icon_files(app, id);
        if files[0].is_file() { return files[0].display().to_string(); }
        // (no capsule kept: looked for once a session -- the games of the last years keep theirs
        // where older versions didn't look --, the logo or the header shown meanwhile and when there's none)
        static LOGO_ASKED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
        let ask = net::online() && LOGO_ASKED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashSet::new).insert(id.clone());
        let have = files.iter().find(|f| f.is_file()).map(|f| f.display().to_string());
        if ask || have.is_none() {
            let (app, user, folder, id, have2) = (app.clone(), user.to_string(), folder.to_string(), id.clone(), have.clone());
            let got = run(Box::new(move || {
                for (f, p) in files.iter().zip(STEAM_ICON_PICS) {
                    if have2.as_deref() == Some(f.display().to_string().as_str()) { return None; }
                    let _ = fs::create_dir_all(f.parent().unwrap());
                    if icon_fetch_once(f, || steam_icon_fetch(&id, p, f)) { let s = f.display().to_string(); shown(&app, &user, &folder, s.clone()); return Some(s); }
                }
                None
            }));
            if let Some(s) = got { return s; }
        }
        return have.unwrap_or_default();
    }
    // (its store's picture; not looked for on Steam yet: looked for, and Steam's
    // picture takes its place when there's one)
    let url = g.art.clone();
    let f = (!url.is_empty() && icon_host_ok(&url)).then(|| icon_file(app, &url));
    let have = f.as_ref().filter(|f| f.is_file()).map(|f| f.display().to_string());
    let (app2, user2, folder2, title) = (app.clone(), user.to_string(), folder.to_string(), g.title.clone());
    let unknown = steam.is_none();
    if have.is_none() || unknown {
        let got = run(Box::new(move || {
            if unknown && net::online() {
                if let Some(id) = steam_by_name(&crate::paths::trophies_dir(&app2), &title, true) {
                    for (h, p) in steam_icon_files(&app2, &id).into_iter().zip(STEAM_ICON_PICS) {
                        let _ = fs::create_dir_all(h.parent().unwrap());
                        if icon_fetch_once(&h, || steam_icon_fetch(&id, p, &h)) { let s = h.display().to_string(); shown(&app2, &user2, &folder2, s.clone()); return Some(s); }
                    }
                }
            }
            if let Some(f) = f { if !f.is_file() {
                let _ = fs::create_dir_all(f.parent().unwrap());
                if icon_fetch_once(&f, || net::download(&url, &f)) { let s = f.display().to_string(); shown(&app2, &user2, &folder2, s.clone()); return Some(s); }
            } }
            None
        }));
        if let Some(s) = got { return s; }
    }
    have.unwrap_or_default()
}
/// An account game's own icon (its Information in Trophy Collection): Steam's logo of it, else
/// its header (a Steam game's own; another store's, the Steam game with its name), else its
/// store's picture -- as kept with the trophies' pictures; one not kept yet is fetched (in the
/// sync itself, or in the background for the next time its list is read).
pub(super) fn acct_icon(app: &AppHandle, user: &str, folder: &str) -> String {
    let Some(g) = ({ let _l = ACCT_LOCK.lock().unwrap_or_else(|e| e.into_inner()); acct_load(app, user).games.into_iter().find(|g| g.folder == folder) }) else { return String::new() };
    let tdir = crate::paths::trophies_dir(app);
    let steam = if g.store == "steam" { Some(g.id.clone()) } else if g.store == "ra" { None } else { steam_name_kept(&tdir, &g.title).flatten() };
    let store_pic = (!g.art.is_empty() && icon_host_ok(&g.art)).then(|| (icon_file(app, &g.art), g.art.clone()));
    let mut want: Vec<(PathBuf, Box<dyn FnOnce(&Path) -> bool + Send>)> = Vec::new();
    if let Some(id) = steam {
        for (f, p) in steam_icon_files(app, &id).into_iter().zip(STEAM_ICON_PICS).skip(1) {
            let id = id.clone();
            want.push((f, Box::new(move |f: &Path| steam_icon_fetch(&id, p, f))));
        }
    }
    if let Some((f, url)) = store_pic { want.push((f, Box::new(move |f: &Path| net::download(&url, f)))); }
    if let Some((f, _)) = want.iter().find(|(f, _)| f.is_file()) { return f.display().to_string(); }
    if want.is_empty() || !net::online() { return String::new(); }
    let job = move || -> Option<String> {
        for (f, fetch) in want {
            let _ = fs::create_dir_all(f.parent().unwrap_or(Path::new(".")));
            if icon_fetch_once(&f, || fetch(&f)) { return Some(f.display().to_string()); }
        }
        None
    };
    if ART_WAIT.with(|w| w.get()) { job().unwrap_or_default() } else { std::thread::spawn(job); String::new() }
}
/// The Steam pictures an account game is shown with in Trophy Collection, in order: its main
/// capsule (its banner), else its logo (the icon it would have in the system), else its header.
pub(super) const STEAM_ICON_PICS: [&str; 3] = [crate::gameart::STEAM_BANNER, "logo.png", "header.jpg"];
/// Where they're kept (the logo with its see-through border cut off: kept under a name
/// of its own, so the ones kept uncut by older versions are fetched again).
pub(super) fn steam_icon_files(app: &AppHandle, id: &str) -> Vec<PathBuf> {
    STEAM_ICON_PICS.iter().map(|p| { let u = crate::gameart::steam_pic_url(id, p); icon_file(app, &if p.ends_with(".png") { format!("{u}#trim") } else { u }) }).collect()
}
pub(super) fn steam_icon_fetch(id: &str, p: &str, f: &Path) -> bool {
    let ok = crate::gameart::steam_pic(id, p, f);
    if ok && p.ends_with(".png") { crate::gameart::trim_transparent(f); }
    ok
}
/// A name's Steam game as kept by `steam_by_name` (no request): Some(Some(id)),
/// Some(None) when Steam has no game with that name, None when not looked for yet.
pub(super) fn steam_name_kept(tdir: &Path, title: &str) -> Option<Option<String>> {
    let map: serde_json::Map<String, Value> = fs::read_to_string(tdir.join("schemas").join("names.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let v = map.get(&title.to_lowercase())?;
    let id = v["id"].as_str().unwrap_or("");
    if !id.is_empty() { return Some(Some(id.to_string())); }
    v["at"].as_i64().filter(|t| now() - t < 7 * 86400).map(|_| None)
}
