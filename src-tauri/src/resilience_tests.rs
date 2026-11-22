//! The v2.0.0 test campaign, part 2: what happens when things go wrong around the system --
//! the disk filling up while it saves, several saves at once, a scraping stopped in the middle --,
//! that what's secret never lands plain on disk, and that the friends' trophy levels only ask
//! Steam about the friends that need it.
#![cfg(test)]

use std::fs;
use std::path::{Path, PathBuf};

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("xmb_res_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}
fn user(id: &str, name: &str) -> crate::models::User {
    serde_json::from_value(serde_json::json!({ "id": id, "name": name, "avatar": "stock:square_grey", "theme": {}, "soundEnabled": true, "musicEnabled": true, "createdAt": "1", "lastLogin": "" })).unwrap()
}
/// The disk full in the middle of saving (MAXMB_TINYFS: a small file system of its own, made for
/// the test): the settings, the users, the PSN accounts and a game's details are each either saved
/// whole or kept as they were -- never left cut in the middle, read back empty.
#[test]
fn saves_survive_a_full_disk() {
    let Ok(root) = std::env::var("MAXMB_TINYFS") else { eprintln!("(no small file system to fill: skipped)"); return };
    let d = PathBuf::from(root).join("full");
    let _ = fs::remove_dir_all(&d); fs::create_dir_all(&d).unwrap();
    // what's there before
    let users = d.join("users.json");
    let mut uf = crate::models::UsersFile::default();
    uf.users.push(user("u1", "Maxi")); uf.active = Some("u1".into());
    crate::users::save(&users, &uf).unwrap();
    let settings = d.join("settings.json");
    let mut s: crate::models::Settings = serde_json::from_str("{}").unwrap();
    s.game_sources = vec!["D:\\Games".into()];
    crate::settings::save(&settings, &s).unwrap();
    let game = d.join("Game"); fs::create_dir_all(&game).unwrap();
    crate::library::patch_meta(&game, &[("title", serde_json::json!("My Game"))]).unwrap();
    // the disk filled up
    let mut n = 0;
    while fs::write(d.join(format!("fill{n}")), vec![7u8; 4096]).is_ok() { n += 1; if n > 10_000 { break; } }
    let _ = fs::write(d.join("fill_last"), vec![7u8; 512]);
    // saving more than there's room for
    for i in 0..40 { uf.users.push(user(&format!("u{}", i + 2), &"Somebody With A Long Name ".repeat(4))); }
    let r1 = crate::users::save(&users, &uf);
    s.game_sources = (0..200).map(|i| format!("D:\\A Long Folder Name\\{i}")).collect();
    let r2 = crate::settings::save(&settings, &s);
    let r3 = crate::library::patch_meta(&game, &[("description", serde_json::json!("x".repeat(20_000)))]);
    assert!(r1.is_err() && r2.is_err() && r3.is_err(), "no room: the saves fail ({r1:?} {r2:?} {r3:?})");
    // what was there is still there, whole
    let back = crate::users::load(&users);
    assert_eq!(back.users.len(), 1, "the users as they were");
    assert_eq!(back.users[0].name, "Maxi");
    assert_eq!(crate::settings::load(&settings).expect("the settings still read").game_sources, vec!["D:\\Games".to_string()]);
    assert_eq!(crate::library::read_meta(&game).expect("game.json still reads")["title"], "My Game");
    // (and nothing half-written left taking room)
    let left: Vec<String> = fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".tmp")).collect();
    assert!(left.is_empty(), "{left:?}");
    // room again: saved
    for e in fs::read_dir(&d).unwrap().flatten() { if e.file_name().to_string_lossy().starts_with("fill") { let _ = fs::remove_file(e.path()); } }
    crate::users::save(&users, &uf).unwrap();
    assert_eq!(crate::users::load(&users).users.len(), 41);
    let _ = fs::remove_dir_all(&d);
}

/// Several saves of the same file at once (a setting changed while another is being saved):
/// the file is always one of them, whole.
#[test]
fn saves_at_the_same_time_stay_whole() {
    let d = tmp("together");
    let users = d.join("users.json");
    let settings = d.join("settings.json");
    std::thread::scope(|sc| {
        for t in 0..8 {
            let (users, settings) = (&users, &settings);
            sc.spawn(move || for i in 0..40 {
                let mut uf = crate::models::UsersFile::default();
                for k in 0..(1 + (t + i) % 7) { uf.users.push(user(&format!("u{k}"), &format!("User {t}-{i}-{k} {}", "x".repeat(200 * ((t + i) % 5))))); }
                crate::users::save(users, &uf).unwrap();
                let mut s: crate::models::Settings = serde_json::from_str("{}").unwrap();
                s.game_sources = (0..(t * 10 + i)).map(|n| format!("D:\\{n}")).collect();
                crate::settings::save(settings, &s).unwrap();
                // (read while the others write: always whole)
                assert!(serde_json::from_str::<serde_json::Value>(&fs::read_to_string(users).unwrap()).is_ok(), "users.json read whole");
                assert!(crate::settings::load(settings).is_some(), "settings.json read whole");
            });
        }
    });
    let _ = fs::remove_dir_all(&d);
}

/// What's secret is never written plain: the game databases' keys (settings.json); read back,
/// they're as they were. The local accounts -- each user's saved Sign-In (users.json), the local
/// PSN accounts' IDs and passwords (psn.json) -- are written plain, one sealed by an older version
/// read and written plain when saved.
#[test]
fn secrets_never_land_plain_on_disk() {
    let d = tmp("secrets");
    let mut s: crate::models::Settings = serde_json::from_str("{}").unwrap();
    s.scrape.sgdb_key = "SGDB-SECRET-KEY-1234".into(); s.scrape.rawg_key = "RAWG-KEY-5678".into();
    crate::settings::save(&d.join("settings.json"), &s).unwrap();
    let raw = fs::read_to_string(d.join("settings.json")).unwrap();
    assert!(!raw.contains("SGDB-SECRET") && !raw.contains("RAWG-KEY") && raw.contains("dpapi:"), "keys sealed");
    let back = crate::settings::load(&d.join("settings.json")).unwrap();
    assert_eq!((back.scrape.sgdb_key.as_str(), back.scrape.rawg_key.as_str(), back.scrape.tgdb_key.as_str()), ("SGDB-SECRET-KEY-1234", "RAWG-KEY-5678", ""));
    // PSN accounts
    let acct: crate::models::PsnAccount = serde_json::from_value(serde_json::json!({ "id": "a1", "onlineId": "MaxiB", "email": "maxi@example.com", "password": "hunter2-pass", "avatar": "x" })).unwrap();
    crate::psn::save(&d.join("psn.json"), &crate::models::PsnFile { accounts: vec![acct] }).unwrap();
    let raw = fs::read_to_string(d.join("psn.json")).unwrap();
    assert!(raw.contains("maxi@example.com") && raw.contains("hunter2-pass") && !raw.contains("dpapi:"), "the sign-in plain, in the file");
    let p = crate::psn::load(&d.join("psn.json"));
    assert_eq!((p.accounts[0].email.as_str(), p.accounts[0].password.as_str()), ("maxi@example.com", "hunter2-pass"));
    // a user's saved Sign-In
    let mut u = user("u1", "Maxi"); u.psn_saved = Some(serde_json::json!({ "email": "maxi@example.com", "password": "hunter2-pass" }));
    crate::users::save(&d.join("users.json"), &crate::models::UsersFile { users: vec![u], active: None }).unwrap();
    let raw = fs::read_to_string(d.join("users.json")).unwrap();
    assert!(raw.contains("hunter2-pass") && raw.contains("maxi@example") && !raw.contains("dpapi:"), "saved Sign-In plain, in the file");
    assert_eq!(crate::users::load(&d.join("users.json")).users[0].psn_saved.as_ref().unwrap()["password"], "hunter2-pass");
    // an older version's sealed file: opened, and written plain once saved again
    let sealed = crate::secret::seal("sealedpw");
    fs::write(d.join("old.json"), format!(r#"{{"accounts":[{{"id":"a","onlineId":"Old","email":"old@x.y","password":"{sealed}","avatar":"x"}}]}}"#)).unwrap();
    let old = crate::psn::load(&d.join("old.json"));
    assert_eq!(old.accounts[0].password, if sealed.is_empty() { "" } else { "sealedpw" });
    crate::psn::save(&d.join("old.json"), &old).unwrap();
    assert!(!fs::read_to_string(d.join("old.json")).unwrap().contains("dpapi:"));
    // a sealed value that can't be opened (copied from another computer): empty, never garbage
    assert_eq!(crate::secret::open("dpapi:0g"), "");
    let _ = fs::remove_dir_all(&d);
}

/// The system closed in the middle of getting a game's art (Steam's pictures, the databases'):
/// what was being downloaded (.download\, .icon.steam.png) is never taken for the game's art, and
/// doesn't count as a change of the game; the next scraping finds the game as it was.
#[test]
fn art_scraping_stopped_in_the_middle() {
    let d = tmp("stopped");
    let g = d.join("Game");
    fs::create_dir_all(&g).unwrap();
    fs::write(g.join("game.json"), r#"{ "title": "Game", "artSource": { "icon": "local" } }"#).unwrap();
    fs::write(g.join("icon.png"), b"exe icon").unwrap();
    let before = crate::gameart::lookup_print(&g).unwrap();
    // half-made files of a scraping stopped by the system closing
    fs::create_dir_all(g.join(".download")).unwrap();
    fs::write(g.join(".download/background.raw.jpg"), b"half").unwrap();
    fs::write(g.join(".icon.steam.png"), b"half").unwrap();
    fs::write(g.join(".background.steam.jpg"), b"half").unwrap();
    assert_eq!(crate::gameart::lookup_print(&g).unwrap(), before, "not a change of the game");
    assert!(crate::gameart::missing(&g, "background"), "a half-downloaded background isn't its background");
    assert!(!crate::gameart::missing(&g, "icon"));
    assert!(crate::gameart::needs_db_art(&g, false), "looked up again by the next scraping");
    let _ = fs::remove_dir_all(&d);
}

/// The friends' trophy levels: a level counted this session isn't asked again; a friend whose
/// games or achievements were private ("-") is asked again only once an hour has gone by; one
/// never counted is asked.
#[test]
fn friend_levels_ask_only_the_friends_that_need_it() {
    use std::time::{Duration, Instant};
    use crate::steamfriends::{level_due, LEVEL_RECOUNT};
    assert!(level_due(None), "never counted: asked");
    assert!(!level_due(Some(&(Some(12), Instant::now()))), "counted: not asked again");
    assert!(!level_due(Some(&(Some(12), Instant::now() - Duration::from_secs(5 * 3600)))), "counted hours ago: still not asked");
    assert!(!level_due(Some(&(None, Instant::now()))), "private a moment ago: not asked");
    assert!(!level_due(Some(&(None, Instant::now() - Duration::from_secs(1800)))), "private half an hour ago: not asked");
    assert!(level_due(Some(&(None, Instant::now() - LEVEL_RECOUNT))), "private an hour ago: asked again");
}
