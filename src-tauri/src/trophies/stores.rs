//! Part of trophies.rs. RetroAchievements, Epic Games and GOG: their lists and the trophies won.

use super::*;


pub(super) fn ra_get(acc: &Accounts, api: &str, args: &str) -> Option<Value> {
    net::get_json(&format!("https://retroachievements.org/API/API_{api}.php?u={}&y={}&{args}", net::enc(&acc.ra_user), net::enc(&acc.ra_key)), &[])
}
pub(super) static RA_GAMES: Mutex<Option<(String, Instant, Option<Vec<(u64, String)>>)>> = Mutex::new(None);
/// The RetroAchievements game played on the account with this title.
pub(super) fn ra_game(acc: &Accounts, title: &str) -> Option<u64> {
    let mut g = RA_GAMES.lock().unwrap();
    let stale = g.as_ref().map(|(u, t, _)| u != &acc.ra_user || t.elapsed() > Duration::from_secs(300)).unwrap_or(true);
    if stale {
        // (RetroAchievements not answering: nothing for 5 minutes, not asked again for every game)
        let list = ra_get(acc, "GetUserRecentlyPlayedGames", "c=50").and_then(|v| v.as_array().cloned()).map(|a| a.iter()
            .filter_map(|x| Some((x["GameID"].as_u64().or_else(|| x["GameID"].as_str()?.parse().ok())?, x["Title"].as_str()?.to_string()))).collect());
        *g = Some((acc.ra_user.clone(), Instant::now(), list));
    }
    let Some(list) = g.as_ref().and_then(|(_, _, l)| l.as_ref()) else { lookup_failed(); return None };
    list.iter().map(|(id, t)| (crate::gameart::likeness(title, t), *id)).filter(|(s, _)| *s >= 0.8)
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)).map(|(_, id)| id)
}
pub(super) fn ra_time(s: &str) -> Option<i64> {
    // "2024-01-31 18:05:09" (UTC)
    let s = s.trim(); if s.len() < 19 { return None; }
    let n = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    Some(days_from_civil(n(0, 4)?, n(5, 7)?, n(8, 10)?) * 86400 + n(11, 13)? * 3600 + n(14, 16)? * 60 + n(17, 19)?)
}
pub(super) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
pub(super) fn iso_time(s: &str) -> Option<i64> { ra_time(&s.replacen('T', " ", 1)) }
pub(super) fn ra_set(acc: &Accounts, title: &str) -> Option<Vec<Trophy>> { ra_set_id(acc, ra_game(acc, title)?) }
pub(super) fn ra_set_id(acc: &Accounts, id: u64) -> Option<Vec<Trophy>> {
    let v = ra_get(acc, "GetGameInfoAndUserProgress", &format!("g={id}"))?;
    let players = v["NumDistinctPlayers"].as_f64().or_else(|| v["NumDistinctPlayers"].as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0);
    let mut list: Vec<(i64, Trophy)> = v["Achievements"].as_object()?.values().filter_map(|a| {
        let n = a["NumAwarded"].as_f64().or_else(|| a["NumAwarded"].as_str().and_then(|s| s.parse().ok()));
        let pct = n.filter(|_| players > 0.0).map(|n| (n / players * 100.0) as f32);
        let earned = a["DateEarnedHardcore"].as_str().or(a["DateEarned"].as_str()).and_then(ra_time);
        Some((a["DisplayOrder"].as_i64().unwrap_or(0), Trophy {
            id: a["ID"].as_u64()?.to_string(), name: a["Title"].as_str().unwrap_or("").to_string(), desc: a["Description"].as_str().unwrap_or("").to_string(),
            grade: grade_for(pct).into(), hidden: false, earned, icon: String::new(),
            src: a["BadgeName"].as_str().map(|b| format!("https://media.retroachievements.org/Badge/{b}.png")).unwrap_or_default(), pct, auto_plat: false, addon: false
        }))
    }).collect();
    list.sort_by_key(|(o, t)| (*o, t.id.parse::<u64>().unwrap_or(0)));
    let list: Vec<Trophy> = list.into_iter().map(|(_, t)| t).collect();
    (!list.is_empty()).then_some(list)
}

// ------------------------------------------------------------------ Epic

pub(super) fn epic_namespace(meta: &Value, dirs: &[PathBuf]) -> Option<String> {
    if let Some(l) = meta["launch"].as_str() {
        if let Some(r) = l.strip_prefix("com.epicgames.launcher://apps/") { if let Some(ns) = r.split("%3A").next().filter(|s| !s.is_empty()) { return Some(net::dec(ns)); } }
    }
    for d in dirs {
        for e in fs::read_dir(d.join(".egstore")).into_iter().flatten().flatten() {
            if e.path().extension().map(|x| x.eq_ignore_ascii_case("mancpn")).unwrap_or(false) {
                if let Some(ns) = fs::read_to_string(e.path()).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v["CatalogNamespace"].as_str().map(|s| s.to_string())) { return Some(ns); }
            }
        }
    }
    None
}
/// An Epic Games copy that doesn't say its namespace (an .egstore folder without
/// a .mancpn): the Epic account's game with the same name (Account Games' list).
pub(super) fn epic_by_account(app: &AppHandle, acc: &Accounts, g: &GameRef) -> Option<String> {
    if acc.epic_id.is_empty() || is_acct(&g.folder) { return None; }
    let folder = Path::new(&g.folder);
    let meta = meta_of(folder);
    let dirs = game_dirs(&meta, folder, &g.launch);
    if epic_namespace(&meta, &dirs).is_some() || !dirs.iter().any(|d| d.join(".egstore").is_dir()) { return None; }
    let user = STATE.lock().unwrap().as_ref().map(|s| s.user.clone())?;
    let l = acct_load(app, &user);
    l.games.iter().filter(|a| a.store == "epic").map(|a| (crate::gameart::likeness(&g.title, &a.title), a)).filter(|(sc, _)| *sc >= 0.85)
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)).map(|(_, a)| a.id.clone())
}
pub(super) const EPIC_GQL: &str = "https://launcher.store.epicgames.com/graphql";
/// The same, signed in (Linked Accounts > Epic Games Account): asked as the account itself.
pub(super) fn epic_hdr_for(app: &AppHandle, user: &str) -> Vec<String> {
    let mut h = epic_hdr();
    if !user.is_empty() { if let Some(t) = accounts::epic_token(app, user) { h.push(format!("Authorization: bearer {t}")); } }
    h
}
/// The headers Epic's store answers its launcher's questions with.
pub(super) fn epic_hdr() -> Vec<String> {
    vec!["Content-Type: application/json".to_string(), "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) EpicGamesLauncher".to_string()]
}
/// A store's request (Epic Games, GOG) whose trouble is written in the log
/// (MaXMB.log): the store, the address without its query, what it answered,
/// and a GraphQL answer's own error. Never a key or a token.
pub(super) fn store_req(store: &str, method: &str, url: &str, hdr: &[String], body: Option<&str>) -> Option<Value> {
    let place = url.split('?').next().unwrap_or("").trim_start_matches("https://");
    let Some(r) = net::request(method, url, hdr, body, 25) else { crate::log::line("WARN", "trophies", &format!("{store}: {place} didn't answer")); return None };
    if !r.ok() {
        // (a GraphQL / store refusal says why in its answer: the first message, never more than 200 letters)
        let why = r.json().and_then(|v| v["errors"].as_array().and_then(|e| e.first()).and_then(|e| e["message"].as_str().map(str::to_string))
            .or_else(|| v["errorMessage"].as_str().map(str::to_string)).or_else(|| v["error_description"].as_str().map(str::to_string)).or_else(|| v["message"].as_str().map(str::to_string)))
            .map(|m| format!(": {}", m.chars().take(200).collect::<String>())).unwrap_or_default();
        crate::log::line("WARN", "trophies", &format!("{store}: {place} answered {}{why}", r.status)); return None;
    }
    let Some(v) = r.json() else { crate::log::line("WARN", "trophies", &format!("{store}: {place} didn't answer with data")); return None };
    if let Some(e) = v["errors"].as_array().and_then(|e| e.first()) {
        let m: String = e["message"].as_str().unwrap_or("").chars().take(200).collect();
        crate::log::line("WARN", "trophies", &format!("{store}: {place}: {m}"));
    }
    Some(v)
}
pub(super) fn epic_set(app: &AppHandle, acc: &Accounts, ns: &str) -> Option<Vec<Trophy>> {
    let user = STATE.lock().unwrap().as_ref().map(|s| s.user.clone()).unwrap_or_default();
    let hdr = epic_hdr_for(app, &user);
    // (the game's list: asked once in 30 minutes -- while it runs only the account's won ones are asked)
    static EPIC_LISTS: Mutex<Option<HashMap<String, (Instant, Value)>>> = Mutex::new(None);
    let kept = EPIC_LISTS.lock().unwrap().get_or_insert_with(HashMap::new).get(ns).filter(|(t, _)| t.elapsed() < Duration::from_secs(1800)).map(|(_, v)| v.clone());
    let v = match kept { Some(v) => v, None => {
        let q = r#"query Achievement($SandboxId: String!, $Locale: String!) { Achievement { productAchievementsRecordBySandbox(sandboxId: $SandboxId, locale: $Locale) { productId achievements { achievement { name hidden unlockedDisplayName unlockedDescription lockedDescription unlockedIconLink lockedIconLink rarity { percent } } } } } }"#;
        let v = store_req("Epic Games", "POST", EPIC_GQL, &hdr, Some(&serde_json::json!({ "query": q, "variables": { "SandboxId": ns, "Locale": "en-US" } }).to_string()))?;
        if v["data"]["Achievement"]["productAchievementsRecordBySandbox"]["productId"].is_string() {
            EPIC_LISTS.lock().unwrap().get_or_insert_with(HashMap::new).insert(ns.to_string(), (Instant::now(), v.clone()));
        }
        v
    } };
    let rec = &v["data"]["Achievement"]["productAchievementsRecordBySandbox"];
    // (no product: no list of its own)
    rec["productId"].as_str()?;
    let mut won: HashMap<String, i64> = HashMap::new();
    // (signed in: the account's own records of the game; not signed in: the list alone)
    if !acc.epic_id.is_empty() && hdr.iter().any(|h| h.starts_with("Authorization:")) {
        let q2 = r#"query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) { PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) { records { playerAchievements { playerAchievement { achievementName unlocked unlockDate } } } } } }"#;
        let vars = serde_json::json!({ "epicAccountId": acc.epic_id, "sandboxId": ns });
        if let Some(p) = store_req("Epic Games", "POST", EPIC_GQL, &hdr, Some(&serde_json::json!({ "query": q2, "variables": vars }).to_string())) {
            let list: Vec<Value> = p["data"]["PlayerAchievement"]["playerAchievementGameRecordsBySandbox"]["records"].as_array().into_iter().flatten()
                .flat_map(|r| r["playerAchievements"].as_array().cloned().unwrap_or_default()).collect();
            for a in &list {
                let a = &a["playerAchievement"];
                if a["unlocked"].as_bool().unwrap_or(false) { if let Some(n) = a["achievementName"].as_str() { won.insert(n.to_string(), a["unlockDate"].as_str().and_then(iso_time).unwrap_or(0)); } }
            }
        }
    }
    let list: Vec<Trophy> = rec["achievements"].as_array()?.iter().filter_map(|a| {
        let a = &a["achievement"];
        let id = a["name"].as_str()?.to_string();
        let pct = a["rarity"]["percent"].as_f64().map(|p| p as f32);
        Some(Trophy { earned: won.get(&id).copied(), name: a["unlockedDisplayName"].as_str().unwrap_or("").trim().to_string(),
            desc: a["unlockedDescription"].as_str().or(a["lockedDescription"].as_str()).unwrap_or("").trim().to_string(),
            hidden: a["hidden"].as_bool().unwrap_or(false), grade: grade_for(pct).into(), icon: String::new(),
            src: a["unlockedIconLink"].as_str().unwrap_or("").to_string(), pct, auto_plat: false, addon: false, id })
    }).collect();
    (!list.is_empty()).then_some(list)
}

// ------------------------------------------------------------------- GOG

pub(super) fn gog_info(dirs: &[PathBuf]) -> Option<Value> {
    for d in dirs {
        for e in fs::read_dir(d).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().to_lowercase();
            if n.starts_with("goggame-") && n.ends_with(".info") {
                if let Some(v) = fs::read_to_string(e.path()).ok().and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()) { return Some(v); }
            }
        }
    }
    None
}
pub(super) fn gog_product(dirs: &[PathBuf]) -> Option<String> { gog_info(dirs)?["gameId"].as_str().map(|s| s.to_string()) }
/// The game's GOG Galaxy client ID: in its goggame files, or in its build's manifest.
pub(super) fn gog_client(app: &AppHandle, pid: &str, dirs: &[PathBuf]) -> Option<String> {
    if let Some(c) = gog_info(dirs).and_then(|v| v["clientId"].as_str().map(|s| s.to_string())) { return Some(c); }
    for d in dirs {
        if let Some(c) = fs::read_to_string(d.join(format!("goggame-{pid}.id"))).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v["clientId"].as_str().map(|s| s.to_string())) { return Some(c); }
    }
    let file = crate::paths::trophies_dir(app).join("schemas").join(format!("gog_client_{}.txt", safe(pid)));
    if let Ok(c) = fs::read_to_string(&file) { return Some(c.trim().to_string()); }
    let b = net::get_json(&format!("https://content-system.gog.com/products/{}/os/windows/builds?generation=2", net::enc(pid)), &[])?;
    let link = b["items"][0]["link"].as_str()?.to_string();
    let r = net::request("GET", &link, &[], None, 30)?;
    let mut raw = Vec::new();
    use std::io::Read;
    if flate2::read::ZlibDecoder::new(&r.body[..]).read_to_end(&mut raw).is_err() { raw = r.body; }
    let c = serde_json::from_slice::<Value>(&raw).ok()?["clientId"].as_str()?.to_string();
    let _ = fs::create_dir_all(file.parent()?); let _ = fs::write(&file, &c);
    Some(c)
}
/// A public GOG profile's achievements for the game (no sign-in: its page, as SuccessStory reads it).
pub(super) fn gog_public_set(name: &str, pid: &str) -> Option<Vec<Trophy>> {
    let r = net::request("GET", &format!("https://www.gog.com/u/{}/game/{}?sort=user_unlock_date", net::enc(name), net::enc(pid)), &[], None, 25)?;
    if !r.ok() { return None; }
    let t = r.text();
    let at = t.find("window.profilesData.achievements")?;
    let rest = &t[at..]; let start = rest.find('[')?;
    // (the JSON array: up to its closing bracket)
    let mut depth = 0i32; let mut end = None; let mut in_str = false; let mut esc_ = false;
    for (i, c) in rest[start..].char_indices() {
        if in_str { if esc_ { esc_ = false } else if c == '\\' { esc_ = true } else if c == '"' { in_str = false } continue; }
        match c { '"' => in_str = true, '[' | '{' => depth += 1, ']' | '}' => { depth -= 1; if depth == 0 { end = Some(start + i + 1); break; } } _ => {} }
    }
    let arr: Value = serde_json::from_str(&rest[start..end?]).ok()?;
    let list: Vec<Trophy> = arr.as_array()?.iter().filter_map(|x| {
        let a = &x["achievement"];
        let st = x["stats"].as_object().and_then(|m| m.values().next().cloned()).unwrap_or(Value::Null);
        let pct = a["rarity"].as_f64().map(|p| p as f32);
        Some(Trophy { id: a["achievement_key"].as_str().or(a["id"].as_str())?.to_string(),
            name: a["name"].as_str().unwrap_or("").trim().to_string(), desc: a["description"].as_str().unwrap_or("").trim().to_string(),
            hidden: !a["visible"].as_bool().unwrap_or(true),
            earned: if st["isUnlocked"].as_bool().unwrap_or(false) { Some(st["unlockDate"].as_i64().unwrap_or(0)) } else { None },
            grade: grade_for(pct).into(), icon: String::new(),
            src: a["image_url_unlocked_2"].as_str().or(a["imageUrlUnlocked2"].as_str()).or(a["image_url_unlocked"].as_str()).unwrap_or("").to_string(), pct, auto_plat: false, addon: false })
    }).collect();
    (!list.is_empty()).then_some(list)
}
/// GOG's achievements of a game for the account, asked for fresh each time: a new address each
/// time (a number GOG doesn't read) and no-cache headers, so no copy kept on the way -- by GOG's
/// servers or anything between -- is answered instead (a trophy won seen ~20 s late while the
/// game ran, v3 changes 67). An address GOG refuses with that number: asked without it from then on.
/// While a game runs every look is in the log: how long it took, what GOG answered, how many were
/// won and the newest one's time, and how old GOG says its answer is.
static GOG_PLAIN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
fn gog_achievements(client: &str, uid: &str, token: &str) -> Option<Value> {
    let base = format!("https://gameplay.gog.com/clients/{}/users/{}/achievements", net::enc(client), net::enc(uid));
    let hdr = [format!("Authorization: Bearer {token}"), "Cache-Control: no-cache, no-store, max-age=0".to_string(), "Pragma: no-cache".to_string()];
    let fresh = !GOG_PLAIN.load(std::sync::atomic::Ordering::SeqCst);
    let url = if fresh { format!("{base}?_={}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)) } else { base.clone() };
    let t = Instant::now();
    let Some((r, head)) = net::request_with_headers("GET", &url, &hdr, 25) else {
        crate::log::line("WARN", "trophies", "GOG: gameplay.gog.com didn't answer"); return None };
    let ms = t.elapsed().as_millis();
    // (the number refused: without it, now and from then on)
    if fresh && matches!(r.status, 400 | 404 | 422) {
        GOG_PLAIN.store(true, std::sync::atomic::Ordering::SeqCst);
        crate::log::line("INFO", "trophies", &format!("GOG: the achievements' address with a number refused ({}): asked without it from now on", r.status));
        return gog_achievements(client, uid, token);
    }
    let v = r.json();
    if crate::focus::in_game() {
        let hv = |k: &str| head.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str()).unwrap_or("-");
        let items: Vec<&Value> = v.as_ref().and_then(|v| v["items"].as_array()).map(|a| a.iter().collect()).unwrap_or_default();
        let won: Vec<i64> = items.iter().filter_map(|a| a["date_unlocked"].as_str().and_then(iso_time)).collect();
        let newest = won.iter().max().map(|t| { let s = now() - t; format!("{s} s ago") }).unwrap_or_else(|| "none".into());
        crate::log::line("INFO", "trophies", &format!("GOG: looked ({ms} ms, {}): {} of {} won, the newest {newest}; GOG's answer: age {}, date {}, cache-control {}, x-cache {}",
            r.status, won.len(), items.len(), hv("age"), hv("date"), hv("cache-control"), hv("x-cache")));
    }
    if !r.ok() {
        let why = v.as_ref().and_then(|v| v["error_description"].as_str().or(v["message"].as_str()).map(str::to_string)).map(|m| format!(": {}", m.chars().take(200).collect::<String>())).unwrap_or_default();
        crate::log::line("WARN", "trophies", &format!("GOG: gameplay.gog.com/clients/…/achievements answered {}{why}", r.status)); return None;
    }
    let Some(v) = v else { crate::log::line("WARN", "trophies", "GOG: gameplay.gog.com didn't answer with data"); return None };
    Some(v)
}
pub(super) fn gog_set(app: &AppHandle, user: &str, pid: &str, dirs: &[PathBuf]) -> Option<Vec<Trophy>> {
    let Some((token, uid)) = accounts::gog_token(app, user) else {
        let a = accounts::get(app, user);
        return if a.gog_public.is_empty() { None } else { gog_public_set(&a.gog_public, pid) };
    };
    let client = gog_client(app, pid, dirs)?;
    let v = gog_achievements(&client, &uid, &token)?;
    let list: Vec<Trophy> = v["items"].as_array()?.iter().filter_map(|a| {
        let pct = a["rarity"].as_f64().map(|p| p as f32);
        Some(Trophy { id: a["achievement_key"].as_str().or(a["achievement_id"].as_str())?.to_string(),
            name: a["name"].as_str().unwrap_or("").trim().to_string(), desc: a["description"].as_str().unwrap_or("").trim().to_string(),
            hidden: !a["visible"].as_bool().unwrap_or(true), earned: a["date_unlocked"].as_str().and_then(iso_time),
            grade: grade_for(pct).into(), icon: String::new(), src: a["image_url_unlocked"].as_str().unwrap_or("").to_string(), pct, auto_plat: false, addon: false })
    }).collect();
    (!list.is_empty()).then_some(list)
}
