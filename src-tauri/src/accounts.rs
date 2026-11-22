//! Linked Accounts (Account Management > Linked Accounts) and Connect with
//! Steam Friends: each MaXMB user's own store accounts, used for trophies
//! and Steam Friends.
//!
//! - Steam: the user's own Steam Web API key and Steam ID (blank until typed).
//! - RetroAchievements: username + the user's own Web API key.
//! - Epic Games, GOG: a sign-in window, as SuccessStory (Lacro59, MIT)
//!   and Playnite do: Epic's and GOG's launchers' own sign-in (the code the
//!   page hands back is exchanged for the account).
//!
//! Kept in content\data\accounts.dat, encrypted with Windows' own data
//! protection (DPAPI: only this Windows user on this computer can read it).
//! No passwords are ever seen or kept: the sign-ins happen on the stores'
//! own pages. Epic keeps only the account's ID and name (its session is
//! closed right after), GOG a renewal token. Sign Out deletes the store's cookies
//! (content\data\webview_login) too;
//! Remove All Accounts Information deletes everything (account_remove_all).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::net;

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Accounts {
    pub steam_key: String,
    pub steam_id: String,
    pub steam_friends: bool,
    pub ra_user: String,
    pub ra_key: String,
    pub epic_id: String,
    pub epic_name: String,
    /// Epic Games signed in: the session's refresh token (its achievements, private ones included)
    pub epic_refresh: String,
    pub gog_user_id: String,
    pub gog_name: String,
    pub gog_refresh: String,
    /// without signing in: a public GOG profile's username
    pub gog_public: String,
    /// (not saved) the Steam ID is the one of the account signed in to Steam on
    /// this computer, a key having been given alone (get)
    #[serde(skip)]
    pub steam_id_local: bool,
}
/// Whether the Steam ID is one typed in Linked Accounts (not the computer's own Steam account's).
pub fn steam_id_typed(a: &Accounts) -> bool { !a.steam_id.is_empty() && !a.steam_id_local }

static STORE: Mutex<Option<HashMap<String, Accounts>>> = Mutex::new(None);
static FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

fn file(app: &AppHandle) -> PathBuf {
    let p = crate::paths::data_dir(app).join("accounts.dat");
    *FILE.lock().unwrap_or_else(|e| e.into_inner()) = Some(p.clone());
    p
}
fn load(app: &AppHandle) -> HashMap<String, Accounts> {
    let mut g = STORE.lock().unwrap_or_else(|e| e.into_inner());
    if g.is_none() {
        let raw = std::fs::read(file(app)).ok().and_then(|b| dpapi::unprotect(&b));
        *g = Some(raw.and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default());
    }
    g.clone().unwrap_or_default()
}
fn save(app: &AppHandle, all: &HashMap<String, Accounts>) {
    *STORE.lock().unwrap_or_else(|e| e.into_inner()) = Some(all.clone());
    if let (Ok(b), p) = (serde_json::to_vec(all), file(app)) {
        if let Some(enc) = dpapi::protect(&b) {
            let _ = crate::paths::write_whole(&p, enc);
        }
    }
}
pub fn get(app: &AppHandle, user: &str) -> Accounts {
    let mut a = typed(app, user);
    // (a Steam Web API Key without a Steam ID: the key doesn't say whose it is, so the account
    // signed in to Steam on this computer is the one read; the option itself stays as typed, blank)
    if a.steam_id.is_empty() && !a.steam_key.is_empty() { a.steam_id = crate::trophies::steam_local_id().unwrap_or_default(); a.steam_id_local = !a.steam_id.is_empty(); }
    a
}
/// The Steam IDs some user's accounts read (typed, or with a key alone this computer's Steam account).
pub fn steam_ids(app: &AppHandle) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    for (_, a) in load(app) {
        if !a.steam_id.is_empty() { out.insert(a.steam_id.clone()); }
        else if !a.steam_key.is_empty() { if let Some(id) = crate::trophies::steam_local_id() { out.insert(id); } }
    }
    out
}
/// A user deleted: their accounts forgotten (keys, IDs, sign-ins: the stores' sessions closed).
pub fn forget_user(app: &AppHandle, user: &str) {
    let mut all = load(app);
    if all.remove(user).is_some() { save(app, &all); }
    GOG_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).drop_tok(user);
    epic_end_session(user);
}
/// What the user typed, as it is (the Steam ID blank until then, and blank if left blank).
fn typed(app: &AppHandle, user: &str) -> Accounts { load(app).get(user).cloned().unwrap_or_default() }
fn update(app: &AppHandle, user: &str, f: impl FnOnce(&mut Accounts)) {
    let mut all = load(app);
    f(all.entry(user.to_string()).or_default());
    save(app, &all);
}

/// What the menus show: names and IDs, never keys or tokens (only whether they're set).
#[tauri::command]
pub fn accounts_view(app: AppHandle, user: String) -> serde_json::Value {
    let a = typed(&app, &user);
    // (steamLocal: with a key and no ID typed, whether Steam on this computer tells whose account it is)
    let local = a.steam_id.is_empty() && !a.steam_key.is_empty() && crate::trophies::steam_local_id().is_some();
    serde_json::json!({
        "steamKey": !a.steam_key.is_empty(), "steamId": a.steam_id, "steamFriends": a.steam_friends, "steamLocal": local,
        "raUser": a.ra_user, "raKey": !a.ra_key.is_empty(),
        "epic": a.epic_name, "gog": a.gog_name, "epicId": a.epic_id, "gogUser": a.gog_public,
    })
}

/// A value of Linked Accounts set. Ok("private"): a Steam ID whose profile is
/// private (or friends only): its progress can only be read with a Steam Web
/// API Key (the page says so); Ok(""): nothing to tell.
#[tauri::command]
pub async fn account_set(app: AppHandle, user: String, field: String, value: serde_json::Value) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_value(&app, &user, &field, &value)?;
        // (a key typed with no Steam ID yet: a key doesn't tell whose it is -- Steam has no way
        // to ask -- so the ID of the account signed in to Steam on this computer is saved with it)
        if field == "steamKey" {
            let a = typed(&app, &user);
            if !a.steam_key.is_empty() && a.steam_id.is_empty() {
                if let Some(id) = crate::trophies::steam_local_id() { update(&app, &user, |a| a.steam_id = id); return Ok("steam-id".to_string()); }
            }
        }
        // (a Steam ID changed or removed: the picture kept of an account no user has any more goes)
        if field == "steamId" || field == "steamKey" { crate::steamfriends::prune_own(&app); }
        if field == "steamId" {
            let id = get(&app, &user).steam_id;
            if !id.is_empty() && steam_private(&id) == Some(true) { return Ok("private".to_string()); }
        }
        Ok(String::new())
    }).await.map_err(|e| e.to_string())?
}
/// Whether a Steam profile is private (its public page's privacyState is not
/// "public"); None: Steam didn't answer, or no such profile.
fn steam_private(id: &str) -> Option<bool> {
    let r = net::request("GET", &format!("https://steamcommunity.com/profiles/{}/?xml=1", net::enc(id)), &[], None, 12)?;
    if !r.ok() { return None; }
    let t = r.text();
    let a = t.find("<privacyState>")? + 14;
    let state = t[a..].split('<').next()?.trim().to_lowercase();
    Some(state != "public")
}
fn set_value(app: &AppHandle, user: &str, field: &str, value: &serde_json::Value) -> Result<(), String> {
    let (app, user) = (app.clone(), user.to_string());
    let s = value.as_str().unwrap_or("").trim().to_string();
    // (keys are letters and digits only: nothing else gets into an address)
    let clean = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>();
    match field {
        "steamKey" => update(&app, &user, |a| a.steam_key = clean(&s)),
        "steamId" => {
            let id = steam_id_from(&s).ok_or("That isn't a Steam ID")?;
            update(&app, &user, |a| a.steam_id = id)
        }
        "steamFriends" => { let on = value.as_bool().unwrap_or(false); update(&app, &user, |a| a.steam_friends = on) }
        "raUser" => update(&app, &user, |a| a.ra_user = s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '.').collect()),
        "raKey" => update(&app, &user, |a| a.ra_key = clean(&s)),
        // without signing in (a public profile): the GOG username (Epic's achievements are only
        // the account's own to see: the Epic account is signed in, its ID comes with it)
        "gogUser" => update(&app, &user, |a| a.gog_public = s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '.').collect()),
        _ => return Err("unknown".into()),
    }
    if field != "steamFriends" { crate::trophies::forget_user(&user); }
    Ok(())
}
/// A Steam ID from what was typed: the 17-digit ID, or a profile address with it.
fn steam_id_from(s: &str) -> Option<String> {
    if s.is_empty() { return Some(String::new()); }
    let digits: String = s.trim_end_matches('/').rsplit('/').next()?.chars().filter(|c| c.is_ascii_digit()).collect();
    (digits.len() == 17 && digits.starts_with("7656")).then_some(digits)
}

// ------------------------------------------------------------------ sign-in

const EPIC_CLIENT: &str = "34a02cf8f4414e29b15921876da36f9a";
const EPIC_SECRET: &str = "daafbccc737745039dffe53d94fc76cf";
const EPIC_OAUTH: &str = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth";
const GOG_CLIENT: &str = "46899977096215655";
const GOG_SECRET: &str = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
const GOG_REDIRECT: &str = "https://embed.gog.com/on_login_success?origin=client";

/// The page a sign-in window hands its answer to (never really opened: the
/// window's navigation is stopped and the answer read from its address).
const GRAB: &str = "https://maxmb.invalid/grab";
/// A page's text handed back once it's at `host` + `path` (the JSON answer
/// a store shows after its sign-in).
fn grab_script(host: &str, path: &str, before: &str) -> String {
    format!(r#"(function(){{try{{{before}
if(location.hostname==={h:?}&&location.pathname.indexOf({p:?})===0){{
 var go=function(){{var t=(document.body&&document.body.innerText)||"";if(t.trim())location.replace({g:?}+"?d="+encodeURIComponent(t.trim()));else setTimeout(go,150);}};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();}}}}catch(e){{}}}})();"#,
        h = host, p = path, g = GRAB, before = before)
}

static LOGIN_N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
/// A window on a store's page; `catch` reads the answer from an address
/// the page goes to. None: closed, or nothing after `secs`.
fn web_window(app: &AppHandle, url: &str, title: &str, visible: bool, script: String, secs: u64,
              catch: impl Fn(&str) -> Option<String> + Send + 'static) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    let label = format!("login{}", LOGIN_N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let tx2 = tx.clone();
    let w = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(url.parse().ok()?))
        .title(title).inner_size(980.0, 780.0).center().visible(visible).focused(visible).always_on_top(visible)
        .data_directory(crate::paths::login_webview_dir(app))
        .initialization_script(&script)
        .on_navigation(move |u| {
            let s = u.as_str();
            if s.starts_with(GRAB) { let _ = tx2.send(net::query_val(s, "d")); return false; }
            if let Some(v) = catch(s) { let _ = tx2.send(Some(v)); return false; }
            true
        })
        .build().ok()?;
    w.on_window_event(move |e| if let tauri::WindowEvent::Destroyed = e { let _ = tx.send(None); });
    let r = rx.recv_timeout(Duration::from_secs(secs)).ok().flatten();
    let _ = w.destroy();
    r
}

#[tauri::command]
pub async fn account_login(app: AppHandle, user: String, store: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = match store.as_str() {
            "epic" => epic_login(&app, &user),
            "gog" => gog_login(&app, &user),
            _ => None,
        };
        if let Some(w) = app.get_webview_window("main") { let _ = w.set_focus(); }
        crate::trophies::forget_user(&user);
        name.ok_or_else(|| "The sign-in didn't finish".to_string())
    }).await.map_err(|e| e.to_string())?
}

/// The stores' sites each sign-in leaves cookies for (in content\data\webview_login).
fn store_domains(store: &str) -> &'static [&'static str] {
    match store { "epic" => &["epicgames.com", "unrealengine.com"], "gog" => &["gog.com"], _ => &[] }
}
/// The sign-in windows' cookies deleted: the stores' (`domains`), or every one
/// (None: all their browsing data). A hidden window on the same data folder
/// reaches them; not on the main thread (Windows' WebView2 would wait forever).
fn clear_login_cookies(app: &AppHandle, domains: Option<&[&str]>) {
    let label = format!("login{}", LOGIN_N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let Ok(blank) = "about:blank".parse() else { return };
    let Ok(w) = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(blank))
        .title("MaXMB").visible(false).focused(false)
        .data_directory(crate::paths::login_webview_dir(app)).build() else { return };
    match domains {
        None => { let _ = w.clear_all_browsing_data(); }
        Some(ds) => {
            for c in w.cookies().unwrap_or_default() {
                let d = c.domain().unwrap_or("").trim_start_matches('.').to_lowercase();
                if ds.iter().any(|x| d == *x || d.ends_with(&format!(".{x}"))) { let _ = w.delete_cookie(c); }
            }
        }
    }
    let _ = w.destroy();
}

/// Sign Out: the store's account forgotten, and its site's cookies deleted
/// (the next sign-in asks for the account again).
#[tauri::command]
pub async fn account_logout(app: AppHandle, user: String, store: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        update(&app, &user, |a| match store.as_str() {
            "epic" => { a.epic_id.clear(); a.epic_name.clear(); a.epic_refresh.clear(); }
            "gog" => { a.gog_user_id.clear(); a.gog_name.clear(); a.gog_refresh.clear(); }
            _ => {}
        });
        if store == "gog" { GOG_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).drop_tok(&user); }
        if store == "epic" { epic_end_session(&user); }
        clear_login_cookies(&app, Some(store_domains(&store)));
        crate::trophies::forget_user(&user);
    }).await.map_err(|e| e.to_string())
}

/// Remove All Accounts Information: every account of this user forgotten (keys,
/// IDs, sign-ins, Connect with Steam Friends), the sign-in windows' cookies and
/// browsing data, the kept Steam picture and the saved trophy lists; the
/// trophies are then read again from what's on the computer (trophies.js).
#[tauri::command]
pub async fn account_remove_all(app: AppHandle, user: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let old = load(&app).get(&user).cloned().unwrap_or_default();
        let mut all = load(&app); all.remove(&user); save(&app, &all);
        GOG_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).drop_tok(&user);
        epic_end_session(&user);
        clear_login_cookies(&app, None);
        crate::steamfriends::forget_own_avatar(&app, &old.steam_id);
        crate::steamfriends::clear_cache(&app);
        crate::steamfriends::forget_levels(&app, &user);
        crate::steamfriends::forget_friends(&app, &user);
        crate::trophies::forget_saved(&app, &user);
        // (the trophy record keeps only what this computer's files showed)
        crate::trophies::records_prune(&app, &user);
    }).await.map_err(|e| e.to_string())
}

fn epic_login(app: &AppHandle, user: &str) -> Option<String> {
    let redirect = format!("https://www.epicgames.com/id/api/redirect?clientId={EPIC_CLIENT}&responseType=code");
    let url = format!("https://www.epicgames.com/id/login?redirectUrl={}", net::enc(&redirect));
    let text = web_window(app, &url, "Epic Games - Sign In", true, grab_script("www.epicgames.com", "/id/api/redirect", ""), 900, |_| None)?;
    let code = serde_json::from_str::<serde_json::Value>(&text).ok()?["authorizationCode"].as_str()?.to_string();
    let auth = format!("Authorization: basic {}", net::b64(format!("{EPIC_CLIENT}:{EPIC_SECRET}").as_bytes()));
    let tok = net::post_json(&format!("{EPIC_OAUTH}/token"), &[auth, "Content-Type: application/x-www-form-urlencoded".into()],
        &format!("grant_type=authorization_code&code={}&token_type=eg1", net::enc(&code)))?;
    let id = tok["account_id"].as_str()?.to_string();
    let name = tok["displayName"].as_str().unwrap_or("Epic Games").to_string();
    // (the session kept, as GOG's is: Epic shows an account's achievements to itself even when its profile
    // keeps them private; Sign Out closes it)
    let refresh = tok["refresh_token"].as_str().unwrap_or("").to_string();
    if let Some(t) = tok["access_token"].as_str() {
        let secs = tok["expires_in"].as_u64().unwrap_or(3600);
        EPIC_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).put_tok(user.to_string(), (t.to_string(), Instant::now() + Duration::from_secs(secs.saturating_sub(60))));
    }
    update(app, user, |a| { a.epic_id = id; a.epic_name = name.clone(); a.epic_refresh = refresh; });
    Some(name)
}

fn gog_login(app: &AppHandle, user: &str) -> Option<String> {
    let url = format!("https://auth.gog.com/auth?client_id={GOG_CLIENT}&redirect_uri={}&response_type=code&layout=client2", net::enc(GOG_REDIRECT));
    let code = web_window(app, &url, "GOG - Sign In", true, String::new(), 900,
        |u| if u.starts_with("https://embed.gog.com/on_login_success") { net::query_val(u, "code") } else { None })?;
    let tok = net::get_json(&format!("https://auth.gog.com/token?client_id={GOG_CLIENT}&client_secret={GOG_SECRET}&grant_type=authorization_code&code={}&redirect_uri={}",
        net::enc(&code), net::enc(GOG_REDIRECT)), &[])?;
    let (access, refresh, uid) = (tok["access_token"].as_str()?.to_string(), tok["refresh_token"].as_str()?.to_string(), tok["user_id"].as_str()?.to_string());
    let name = net::get_json("https://embed.gog.com/userData.json", &[format!("Authorization: Bearer {access}")])
        .and_then(|v| v["username"].as_str().map(|s| s.to_string())).unwrap_or_else(|| "GOG".into());
    let secs = tok["expires_in"].as_u64().unwrap_or(3600);
    GOG_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).put_tok(user.to_string(), (access, Instant::now() + Duration::from_secs(secs.saturating_sub(60))));
    update(app, user, |a| { a.gog_user_id = uid; a.gog_name = name.clone(); a.gog_refresh = refresh; });
    Some(name)
}
static GOG_TOKEN: Mutex<Option<HashMap<String, (String, Instant)>>> = Mutex::new(None);
static EPIC_TOKEN: Mutex<Option<HashMap<String, (String, Instant)>>> = Mutex::new(None);
/// Epic Games signed in: a live access token (from the kept refresh token).
pub fn epic_token(app: &AppHandle, user: &str) -> Option<String> {
    let a = get(app, user);
    if a.epic_refresh.is_empty() { return None; }
    if let Some(t) = EPIC_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).live_tok(user) { return Some(t); }
    let auth = format!("Authorization: basic {}", net::b64(format!("{EPIC_CLIENT}:{EPIC_SECRET}").as_bytes()));
    let tok = net::post_json(&format!("{EPIC_OAUTH}/token"), &[auth, "Content-Type: application/x-www-form-urlencoded".into()],
        &format!("grant_type=refresh_token&refresh_token={}&token_type=eg1", net::enc(&a.epic_refresh)));
    let Some(tok) = tok else { crate::log::line("WARN", "trophies", "Epic Games: the sign-in couldn't be renewed (sign in again in Linked Accounts)"); return None };
    let access = tok["access_token"].as_str()?.to_string();
    if let Some(r) = tok["refresh_token"].as_str() { let r = r.to_string(); update(app, user, |a| a.epic_refresh = r); }
    let secs = tok["expires_in"].as_u64().unwrap_or(3600);
    EPIC_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).put_tok(user.to_string(), (access.clone(), Instant::now() + Duration::from_secs(secs.saturating_sub(60))));
    Some(access)
}
/// The kept Epic session closed (Sign Out, Remove All Accounts Information).
fn epic_end_session(user: &str) {
    let t = EPIC_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).live_tok(user);
    EPIC_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).drop_tok(user);
    if let Some(t) = t { let _ = net::request("DELETE", &format!("{EPIC_OAUTH}/sessions/kill/{}", net::enc(&t)), &[format!("Authorization: bearer {t}")], None, 10); }
}
trait MapExt { fn put_tok(&mut self, k: String, v: (String, Instant)); fn drop_tok(&mut self, k: &str); fn live_tok(&self, k: &str) -> Option<String>; }
impl MapExt for Option<HashMap<String, (String, Instant)>> {
    fn put_tok(&mut self, k: String, v: (String, Instant)) { self.get_or_insert_with(HashMap::new).insert(k, v); }
    fn drop_tok(&mut self, k: &str) { if let Some(m) = self { m.remove(k); } }
    fn live_tok(&self, k: &str) -> Option<String> { self.as_ref()?.get(k).filter(|(_, t)| *t > Instant::now()).map(|(s, _)| s.clone()) }
}
/// A GOG token (renewed with the kept renewal token when it has run out) and the user's GOG ID.
pub fn gog_token(app: &AppHandle, user: &str) -> Option<(String, String)> {
    let a = get(app, user);
    if a.gog_refresh.is_empty() { return None; }
    if let Some(t) = GOG_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).live_tok(user) { return Some((t, a.gog_user_id)); }
    let tok = net::get_json(&format!("https://auth.gog.com/token?client_id={GOG_CLIENT}&client_secret={GOG_SECRET}&grant_type=refresh_token&refresh_token={}",
        net::enc(&a.gog_refresh)), &[])?;
    let access = tok["access_token"].as_str()?.to_string();
    if let Some(r) = tok["refresh_token"].as_str() { let r = r.to_string(); update(app, user, |a| a.gog_refresh = r); }
    let secs = tok["expires_in"].as_u64().unwrap_or(3600);
    GOG_TOKEN.lock().unwrap_or_else(|e| e.into_inner()).put_tok(user.to_string(), (access.clone(), Instant::now() + Duration::from_secs(secs.saturating_sub(60))));
    Some((access, a.gog_user_id))
}


// ------------------------------------------------------------------- DPAPI

#[cfg(windows)]
pub(crate) mod dpapi {
    use std::ffi::c_void;
    #[repr(C)] struct Blob { cb: u32, pb: *mut u8 }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(i: *const Blob, d: *const u16, e: *const Blob, r: *mut c_void, p: *mut c_void, f: u32, o: *mut Blob) -> i32;
        fn CryptUnprotectData(i: *const Blob, d: *mut *mut u16, e: *const Blob, r: *mut c_void, p: *mut c_void, f: u32, o: *mut Blob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" { fn LocalFree(h: *mut c_void) -> *mut c_void; }
    const UI_FORBIDDEN: u32 = 1;
    // (a fixed extra secret: another program running as the same user must
    // know it too to read the file)
    const ENTROPY: &[u8] = b"MaXMB accounts v1";
    fn run(data: &[u8], protect: bool) -> Option<Vec<u8>> {
        let inp = Blob { cb: data.len() as u32, pb: data.as_ptr() as *mut u8 };
        let ent = Blob { cb: ENTROPY.len() as u32, pb: ENTROPY.as_ptr() as *mut u8 };
        let mut out = Blob { cb: 0, pb: std::ptr::null_mut() };
        let ok = unsafe {
            if protect { CryptProtectData(&inp, std::ptr::null(), &ent, std::ptr::null_mut(), std::ptr::null_mut(), UI_FORBIDDEN, &mut out) }
            else { CryptUnprotectData(&inp, std::ptr::null_mut(), &ent, std::ptr::null_mut(), std::ptr::null_mut(), UI_FORBIDDEN, &mut out) }
        };
        if ok == 0 || out.pb.is_null() { return None; }
        let v = unsafe { std::slice::from_raw_parts(out.pb, out.cb as usize).to_vec() };
        unsafe { LocalFree(out.pb as *mut c_void); }
        Some(v)
    }
    pub fn protect(d: &[u8]) -> Option<Vec<u8>> { run(d, true) }
    pub fn unprotect(d: &[u8]) -> Option<Vec<u8>> { run(d, false) }
}
#[cfg(not(windows))]
pub(crate) mod dpapi {
    pub fn protect(d: &[u8]) -> Option<Vec<u8>> { Some(d.to_vec()) }
    pub fn unprotect(d: &[u8]) -> Option<Vec<u8>> { Some(d.to_vec()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn steam_ids() {
        assert_eq!(steam_id_from("76561197960287930").as_deref(), Some("76561197960287930"));
        assert_eq!(steam_id_from("https://steamcommunity.com/profiles/76561197960287930/").as_deref(), Some("76561197960287930"));
        assert_eq!(steam_id_from("gabe"), None);
        assert_eq!(steam_id_from("").as_deref(), Some(""));
    }
    #[test]
    fn script_has_targets() {
        let s = grab_script("www.epicgames.com", "/id/api/redirect", "");
        assert!(s.contains("\"www.epicgames.com\"") && s.contains(GRAB));
    }
}
