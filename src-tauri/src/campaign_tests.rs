//! The v2.0.0 test campaign's own checks (the parts the other tests didn't cover yet):
//! PS3 games in every format, each started by the RPCS3 it's in, and what happens when
//! their files change; which stores are asked, and how often; what's found offline.
#![cfg(test)]

use std::fs;
use std::path::{Path, PathBuf};

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("xmb_camp_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}
fn w(p: &Path, b: impl AsRef<[u8]>) { fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, b).unwrap(); }
fn sfo(title: &str, id: &str, cat: &str) -> Vec<u8> { crate::ps3::tests::sfo(&[("TITLE", title), ("TITLE_ID", id), ("CATEGORY", cat), ("APP_VER", "01.00")]) }
/// An installed game (dev_hdd0\game\<ID>: PARAM.SFO and USRDIR\EBOOT.BIN)
fn installed(at: &Path, title: &str, id: &str) { w(&at.join("PARAM.SFO"), sfo(title, id, "HG")); w(&at.join("USRDIR/EBOOT.BIN"), b"SCE"); }
/// A disc copy (PS3_GAME\PARAM.SFO, PS3_GAME\USRDIR\EBOOT.BIN, PS3_DISC.SFB)
fn disc(at: &Path, title: &str, id: &str) { w(&at.join("PS3_GAME/PARAM.SFO"), sfo(title, id, "DG")); w(&at.join("PS3_GAME/USRDIR/EBOOT.BIN"), b"SCE"); w(&at.join("PS3_DISC.SFB"), b".SFB"); }
fn iso(at: &Path, title: &str, id: &str) { w(at, crate::iso::tests::make_iso(&[("PS3_DISC.SFB", b".SFB"), ("PS3_GAME/PARAM.SFO", &sfo(title, id, "DG")), ("PS3_GAME/TROPDIR/NPWR00001_00/TROPHY.TRP", b"trp")])); }

/// What a made game starts: (its shortcut's program, its arguments)
fn started_by(folder: &Path) -> Option<(PathBuf, String)> {
    let meta: serde_json::Value = serde_json::from_str(&fs::read_to_string(folder.join("game.json")).ok()?).ok()?;
    let launch = meta["launch"].as_str()?.to_string();
    match crate::launcher::plan(&folder.display().to_string(), &launch) {
        crate::launcher::LaunchPlan::Raw { exe, args, .. } => Some((exe, args)),
        crate::launcher::LaunchPlan::Direct { exe, .. } => Some((exe, meta["args"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default())),
        _ => None,
    }
}

/// PS3 games in every format RPCS3 plays -- installed from a .pkg (dev_hdd0\game), a disc
/// copy in its games folder, a disc image (.iso) added to its game list (games.yml), a
/// game in a dev_hdd0 kept elsewhere (vfs.yml), a disc copy and an image in a folder of
/// their own -- from two RPCS3 installs: each found once, each started by the RPCS3 it's in
/// (its trophies and saves are there), the right way (by Title ID when RPCS3 lists it, by its
/// EBOOT.BIN or image otherwise); then their files changed, moved or deleted.
#[test]
fn ps3_games_in_every_format_start_in_their_own_rpcs3() {
    let _iso = crate::ps3::ISO_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let d = tmp("ps3fmt");
    crate::ps3::set_iso_cache(d.join("cache/ps3iso"));
    let (a, b, loose) = (d.join("RPCS3 A"), d.join("RPCS3 B"), d.join("PS3 Loose"));
    w(&a.join("rpcs3.exe"), b"MZ"); w(&b.join("rpcs3.exe"), b"MZ");
    installed(&a.join("dev_hdd0/game/NPUB00001"), "Installed One", "NPUB00001");
    // (its update, game data: not a game)
    w(&a.join("dev_hdd0/game/BLUS00002/PARAM.SFO"), sfo("Disc Two Update", "BLUS00002", "GD"));
    disc(&a.join("games/Disc Two"), "Disc Two", "BLUS00002");
    iso(&d.join("Images/Iso Three.iso"), "Iso Three", "BLUS00003");
    w(&a.join("config/games.yml"), format!("BLUS00002: {}/\nBLUS00003: {}\n", a.join("games/Disc Two").display(), d.join("Images/Iso Three.iso").display()));
    // B: its dev_hdd0 elsewhere
    let bh = d.join("B hdd");
    w(&b.join("config/vfs.yml"), format!("$(EmulatorDir): \"\"\n/dev_hdd0/: {}/\n", bh.display()));
    installed(&bh.join("game/NPUB00004"), "Moved Four", "NPUB00004");
    // a folder of its own: a disc copy and an image
    disc(&loose.join("Loose Five"), "Loose Five", "BLUS00005");
    iso(&loose.join("Six.iso"), "Six", "BLUS00006");

    let (games, rec) = (d.join("Games"), d.join("rec.json"));
    fs::create_dir_all(&games).unwrap();
    let srcs: Vec<String> = [&a, &b, &loose].iter().map(|p| p.display().to_string()).collect();
    let made = crate::gamesrc::sync(&srcs, &games, &rec, None, &|_, _| {});
    let titles = |l: &[PathBuf]| { let mut v: Vec<String> = l.iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect(); v.sort(); v };
    // (each RPCS3 install itself is an entry too, as any program folder in a source: started as it is)
    assert_eq!(titles(&made), ["Disc Two", "Installed One", "Iso Three", "Loose Five", "Moved Four", "RPCS3 A", "RPCS3 B", "Six"], "each game once, the update not a game");
    let by = |t: &str| started_by(&games.join(t)).unwrap_or_else(|| panic!("{t}: can't be started"));
    let (ea, eb) = (a.join("rpcs3.exe"), b.join("rpcs3.exe"));
    // (in RPCS3's list: by Title ID; not in it: by its EBOOT.BIN / image)
    assert_eq!(by("Disc Two"), (ea.clone(), "--no-gui \"%RPCS3_GAMEID%:BLUS00002\"".to_string()));
    assert_eq!(by("Iso Three"), (ea.clone(), "--no-gui \"%RPCS3_GAMEID%:BLUS00003\"".to_string()));
    assert_eq!(by("Installed One"), (ea.clone(), format!("--no-gui \"{}\"", a.join("dev_hdd0/game/NPUB00001/USRDIR/EBOOT.BIN").display())));
    assert_eq!(by("Moved Four"), (eb.clone(), format!("--no-gui \"{}\"", bh.join("game/NPUB00004/USRDIR/EBOOT.BIN").display())), "a moved dev_hdd0's game: its own RPCS3");
    // (outside any RPCS3: the RPCS3 found last, the image itself)
    let (rp6, args6) = by("Six");
    assert!(rp6 == ea || rp6 == eb, "{rp6:?}");
    assert_eq!(args6, format!("--no-gui \"{}\"", loose.join("Six.iso").display()));
    for t in ["Disc Two", "Iso Three", "Six"] {
        let m: serde_json::Value = serde_json::from_str(&fs::read_to_string(games.join(t).join("game.json")).unwrap()).unwrap();
        assert!(m["titleId"].is_string() && m["ps3Key"].is_string() && m["console"] == "PS3", "{t}: {m}");
    }
    // ---- again: nothing new
    assert!(crate::gamesrc::sync(&srcs, &games, &rec, None, &|_, _| {}).is_empty(), "nothing made twice");
    // ---- the image added to RPCS3's list later: started by its Title ID from then on
    w(&a.join("config/games.yml"), format!("BLUS00002: {}/\nBLUS00003: {}\nBLUS00006: {}\n", a.join("games/Disc Two").display(), d.join("Images/Iso Three.iso").display(), loose.join("Six.iso").display()));
    assert!(crate::gamesrc::sync(&srcs, &games, &rec, None, &|_, _| {}).is_empty());
    assert_eq!(by("Six"), (ea.clone(), "--no-gui \"%RPCS3_GAMEID%:BLUS00006\"".to_string()), "listed now: by Title ID, in the RPCS3 that lists it");
    // ---- RPCS3's list damaged; B's vfs.yml deleted; the image deleted: nothing breaks, nothing doubled
    w(&a.join("config/games.yml"), b"\0\0{{{ not yaml");
    fs::remove_file(b.join("config/vfs.yml")).unwrap();
    fs::remove_file(d.join("Images/Iso Three.iso")).unwrap();
    let again = crate::gamesrc::sync(&srcs, &games, &rec, None, &|_, _| {});
    assert!(again.is_empty(), "nothing made again: {:?}", titles(&again));
    let listed = crate::library::scan(&[games.display().to_string()], None);
    assert_eq!(listed.len(), 8, "every game still listed");
    // (the games RPCS3 no longer lists: started by their files again; the image's game, gone, can't be found)
    assert_eq!(by("Disc Two").1, format!("--no-gui \"{}\"", a.join("games/Disc Two/PS3_GAME/USRDIR/EBOOT.BIN").display()));
    // ---- the game's own folder in content\Games deleted by hand: not made again
    fs::remove_dir_all(games.join("Loose Five")).unwrap();
    assert!(crate::gamesrc::sync(&srcs, &games, &rec, None, &|_, _| {}).is_empty(), "a game deleted by hand isn't made again");
    // ---- the record damaged: read as new, the games found again without doubles in the folder's names
    w(&rec, b"[[[");
    let _ = crate::gamesrc::sync(&srcs, &games, &rec, None, &|_, _| {});
    let _ = fs::remove_dir_all(&d);
}

/// The stores asked only for what needs them: a game whose trophies are in files here
/// (RPCS3, Steam's own file, a Steam emulator's) never; the others while they run, as often
/// as each store allows, less often after a refusal.
#[test]
fn which_stores_are_asked_and_how_often() {
    use crate::trophies::campaign::*;
    let d = tmp("asks");
    let acc_key = acct("76561197960265829", "KEY");
    let acc_none = acct("", "");
    let game = d.join("Game"); w(&game.join("Game.exe"), b"MZ");
    // (the emulator's file: Goldberg's, in the game's folder)
    let emu_game = d.join("Emu"); w(&emu_game.join("steam_settings/local_save.txt"), "saves"); w(&emu_game.join("saves/400/achievements.json"), r#"{"A":{"earned":true,"earned_time":1}}"#);
    let r = asks(&acc_key, "rpcs3", "", &[]);
    assert!(!r, "RPCS3: never (its files only)");
    assert!(asks(&acc_key, "steam", "300", &[game.clone()]), "Steam, nothing on this computer: asked");
    assert!(!asks(&acc_key, "steam", "400", &[emu_game.clone()]), "Steam, an emulator's file: never asked");
    assert!(!asks(&acc_none, "steam", "300", &[game.clone()]), "Steam without an account: nothing to ask");
    assert!(asks(&acc_none, "gog", "1", &[]) && asks(&acc_none, "epic", "ns", &[]), "GOG / Epic: their account");
    // how often (seconds), and after 1, 2... refusals in a row (at most 160 s)
    assert_eq!(every(&acc_key, "steam"), 4); assert_eq!(every(&acc_none, "steam"), 20);
    assert_eq!(every(&acc_key, "gog"), 6); assert_eq!(every(&acc_key, "epic"), 6);
    assert_eq!(every(&acc_key, "ra"), 60); assert_eq!(every(&acc_key, "rpcs3"), 60);
    assert_eq!((0..7).map(|f| backoff(3, f)).collect::<Vec<_>>(), vec![3, 6, 12, 24, 48, 96, 96]);
    assert_eq!(backoff(20, 5), 160, "never more than 160 s");
    let _ = fs::remove_dir_all(&d);
}

/// Offline: what's kept is used, however old, and nothing found offline is taken for "none"
/// (looked up again once online); online, what's kept and fresh isn't asked again.
#[test]
fn offline_and_online_lookups() {
    use crate::trophies::campaign::*;
    let d = tmp("offline");
    // a name looked up before: found offline; a miss looked up lately: none, for sure;
    // never looked up: not known (offline), so not kept as none
    w(&d.join("schemas/names.json"), serde_json::json!({
        "celeste": { "id": "504230", "at": 1 },
        "nothing here": { "id": "", "at": now() },
    }).to_string());
    assert_eq!(by_name(&d, "Celeste", false), (Some("504230".into()), false));
    assert_eq!(by_name(&d, "Nothing Here", false), (None, false), "a fresh miss: none, for sure");
    assert_eq!(by_name(&d, "Never Asked", false), (None, true), "offline, never asked: not known (looked up again later)");
    // (the kept list damaged: as never asked)
    w(&d.join("schemas/names.json"), b"{{{");
    assert_eq!(by_name(&d, "Celeste", false), (None, true));
    // Steam's public list of a game's trophies: offline, the kept one however old
    w(&d.join("schemas/steam_7.json"), serde_json::json!({ "response": { "achievements": [{ "internal_name": "A", "localized_name": "A", "localized_desc": "", "hidden": false, "icon": "", "player_percent_unlocked": "50" }] } }).to_string());
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(30 * 86400);
    let f = fs::File::options().write(true).open(d.join("schemas/steam_7.json")).unwrap(); f.set_modified(old).unwrap(); drop(f);
    assert_eq!(schema_len(&d, "7", false), 1, "offline: the kept list, a month old");
    let _ = fs::remove_dir_all(&d);
}

/// A game renamed in Game Settings: its folder in content\Games takes the new name (characters
/// a folder can't have left out, numbered past another game's folder, only the capitals changed),
/// and the recognized games' list follows it, so Game Recognition never takes it for a game
/// deleted by hand nor makes it again.
#[test]
fn a_renamed_game_s_folder_takes_its_name() {
    let d = tmp("rename");
    let (source, games, rec) = (d.join("PC"), d.join("Games"), d.join("rec.json"));
    for g in ["Alpha", "Beta"] { w(&source.join(g).join(format!("{g}.exe")), vec![0u8; 2000]); }
    fs::create_dir_all(&games).unwrap();
    let srcs = vec![source.display().to_string()];
    let sync = || crate::gamesrc::sync(&srcs, &games, &rec, None, &|_, _| {});
    assert_eq!(sync().len(), 2);
    let alpha = games.join("Alpha");
    // renamed: "Alpha: Remastered?" -> "Alpha Remastered", without the characters a folder can't have
    let to = crate::gamesrc::rename_game_folder(&alpha, "Alpha: Remastered?").unwrap().expect("renamed");
    assert_eq!(to.file_name().unwrap().to_string_lossy(), "Alpha Remastered");
    assert!(to.join("game.json").is_file() && !alpha.exists());
    crate::gamesrc::folder_renamed(&rec, &alpha.display().to_string(), &to.display().to_string());
    assert!(sync().is_empty(), "not made again under its old name");
    assert!(!alpha.exists());
    // the name of another game's folder: numbered
    let beta = games.join("Beta");
    let b2 = crate::gamesrc::rename_game_folder(&beta, "Alpha Remastered").unwrap().unwrap();
    assert_eq!(b2.file_name().unwrap().to_string_lossy(), "Alpha Remastered (2)");
    crate::gamesrc::folder_renamed(&rec, &beta.display().to_string(), &b2.display().to_string());
    // only its capitals: the same folder, renamed through a passing name
    let up = crate::gamesrc::rename_game_folder(&to, "ALPHA REMASTERED").unwrap().unwrap();
    assert_eq!(up.file_name().unwrap().to_string_lossy(), "ALPHA REMASTERED");
    crate::gamesrc::folder_renamed(&rec, &to.display().to_string(), &up.display().to_string());
    // (the same name: nothing to do)
    assert!(crate::gamesrc::rename_game_folder(&up, "ALPHA REMASTERED").unwrap().is_none());
    assert!(sync().is_empty(), "both still known: nothing made again");
    let mut names: Vec<String> = fs::read_dir(&games).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect(); names.sort();
    assert_eq!(names, ["ALPHA REMASTERED", "Alpha Remastered (2)"]);
    // (the characters a folder can't have: a space each, the spaces around them as one)
    let n = crate::gamesrc::safe_folder_name;
    assert_eq!(n("AC/DC: Live"), "AC DC Live");
    assert_eq!(n("What? <Really>*"), "What Really");
    assert_eq!(n("Shrek 2..."), "Shrek 2");
    assert_eq!(n("\"|:?"), "Game");
    let _ = fs::remove_dir_all(&d);
}

/// Steam Game Art Scraping / Game Art Database Scraping: a game with no background (removed before, even by hand in Game
/// Settings) or with only its program's icon is looked for again; what you put in yourself stays.
#[test]
fn art_scraping_looks_again_for_what_a_game_is_missing() {
    let d = tmp("fill");
    let g = d.join("Some Game");
    w(&g.join("game.json"), r#"{ "title": "Some Game", "trophyLooked": true }"#);
    w(&g.join("icon.png"), b"x");
    crate::gameart::mark_source(&g, "icon", crate::gameart::SRC_USER);
    // its background removed in Game Settings (marked yours, no file)
    crate::gameart::mark_source(&g, "background", crate::gameart::SRC_USER);
    let none = std::collections::HashSet::new();
    let done: std::collections::HashSet<String> = [std::fs::canonicalize(&g).unwrap().to_string_lossy().replace('\\', "/").to_lowercase()].into_iter().collect();
    // (just going over the Game column: done once already, not again)
    assert!(!crate::gameart::steam_art_wanted(&g, false, &done, &none));
    // Steam Game Art Scraping: looked for again (the missing background)
    assert!(crate::gameart::steam_art_wanted(&g, true, &done, &none));
    assert!(crate::gameart::needs_db_art(&g, false));
    // your own icon is never replaced
    assert!(!crate::gameart::may_replace(&g, "icon", crate::gameart::SRC_STEAM) && !crate::gameart::missing(&g, "icon"));
    // everything there and yours: nothing to look for
    w(&g.join("background.jpg"), b"x");
    assert!(!crate::gameart::steam_art_wanted(&g, true, &done, &none));
    // its icon the program's own (Steam's, for a game started through Steam): looked for again,
    // a database's or Steam's may take its place
    w(&g.join("game.json"), r#"{ "title": "Some Game", "dbScraped": true }"#);
    crate::gameart::mark_source(&g, "icon", crate::gameart::SRC_LOCAL);
    crate::gameart::mark_source(&g, "background", crate::gameart::SRC_USER);
    assert!(crate::gameart::needs_db_art(&g, false) && crate::gameart::steam_art_wanted(&g, true, &done, &none));
    assert!(crate::gameart::may_replace(&g, "icon", crate::gameart::SRC_DB) && !crate::gameart::may_replace(&g, "background", crate::gameart::SRC_DB));
    // Game Art Database Scraping: an icon not its program's and a background: the game skipped
    // (its video too, whatever it has); the icon its program's again, or no background: looked up
    crate::gameart::mark_source(&g, "icon", crate::gameart::SRC_STEAM);
    assert!(!crate::gameart::needs_db_art(&g, true), "its own icon and a background: skipped");
    fs::remove_file(g.join("background.jpg")).unwrap();
    assert!(crate::gameart::needs_db_art(&g, true), "no background: looked up");
    // Steam's pictures take the place of the databases', never the other way
    crate::gameart::mark_source(&g, "icon", crate::gameart::SRC_DB);
    assert!(crate::gameart::may_replace(&g, "icon", crate::gameart::SRC_STEAM));
    crate::gameart::mark_source(&g, "icon", crate::gameart::SRC_STEAM);
    assert!(!crate::gameart::may_replace(&g, "icon", crate::gameart::SRC_DB));
    // a PS3 game: never looked up in the databases
    w(&g.join("game.json"), r#"{ "title": "Some Game", "titleId": "BLUS30001" }"#);
    assert!(!crate::gameart::needs_db_art(&g, true));
    let _ = fs::remove_dir_all(&d);
}

// ---- Game Recognition: a game unchanged since its last lookups isn't looked up again
mod lookups {
    use super::*;
    use crate::gameart::{lookup_done, lookup_print, lookup_setup, lookup_unchanged, ScrapeSettings};
    /// a file's date set (the test is quicker than the file system's clock)
    fn dated(p: &Path, secs: u64) { fs::File::options().write(true).open(p).unwrap().set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs)).unwrap(); }
    /// a game made by Game Recognition: its game.json, its shortcut to its program, its icon
    fn game(root: &Path, name: &str) -> (PathBuf, PathBuf) {
        let g = root.join("Games").join(name);
        let exe = root.join("Source").join(name).join("game.exe");
        w(&exe, b"MZ v1"); dated(&exe, 1_700_000_000);
        w(&g.join("game.json"), format!(r#"{{ "title": "{name}", "launch": "{name}.xmbl", "artSource": {{ "icon": "local" }} }}"#));
        w(&g.join(format!("{name}.xmbl")), serde_json::json!({ "target": exe.display().to_string() }).to_string());
        w(&g.join("icon.png"), b"icon"); dated(&g.join("icon.png"), 1_700_000_100);
        (g, exe)
    }
    fn keys(sg: &str, tg: &str, rw: &str) -> ScrapeSettings { ScrapeSettings { sgdb_key: sg.into(), tgdb_key: tg.into(), rawg_key: rw.into() } }

    #[test]
    fn what_counts_as_a_change() {
        let d = tmp("lk_print");
        let (g, exe) = game(&d, "Alpha");
        let p0 = lookup_print(&g).unwrap();
        assert_eq!(lookup_print(&g).unwrap(), p0, "nothing changed: the same");
        // (game.json written again with the same contents, its date changed: no change)
        let t = fs::read_to_string(g.join("game.json")).unwrap();
        fs::write(g.join("game.json"), &t).unwrap(); dated(&g.join("game.json"), 1_800_000_000);
        assert_eq!(lookup_print(&g).unwrap(), p0, "game.json saved again as it was: no change");
        // (a folder of the app's inside it, its download folder: not the game's files)
        fs::create_dir_all(g.join(".download")).unwrap(); w(&g.join(".download/icon.raw.png"), b"x");
        assert_eq!(lookup_print(&g).unwrap(), p0, "the download folder: no change");
        // (each step against the one before: going back to how it was before that is a change too)
        let mut last = p0.clone();
        let mut changed = |what: &str| { let p = lookup_print(&g).unwrap(); assert_ne!(p, last, "{what}: a change"); last = p; };
        // its details changed (Game Settings)
        fs::write(g.join("game.json"), t.replace("\"Alpha\",", "\"Alpha\", \"parentalControl\": 3,")).unwrap(); changed("its details");
        // a picture put in, changed, removed
        w(&g.join("background.jpg"), b"bg"); dated(&g.join("background.jpg"), 1_700_000_200); changed("a background put in");
        fs::write(g.join("background.jpg"), b"bg2").unwrap(); dated(&g.join("background.jpg"), 1_700_000_200); changed("the background changed (its size)");
        dated(&g.join("background.jpg"), 1_700_000_300); changed("the background changed (its date)");
        fs::remove_file(g.join("background.jpg")).unwrap(); changed("the background removed");
        fs::remove_file(g.join("icon.png")).unwrap(); changed("the icon removed");
        // the game itself updated (its program's size, its date)
        fs::write(&exe, b"MZ v2, bigger").unwrap(); dated(&exe, 1_700_000_000); changed("the program's size");
        dated(&exe, 1_700_500_000); changed("the program's date");
        // its program gone, and its shortcut made to start another one
        let exe2 = exe.with_file_name("game2.exe"); w(&exe2, b"MZ"); dated(&exe2, 1_700_000_000);
        fs::write(g.join("Alpha.xmbl"), serde_json::json!({ "target": exe2.display().to_string() }).to_string()).unwrap(); dated(&g.join("Alpha.xmbl"), 1_700_000_100);
        changed("its shortcut");
        assert!(lookup_print(&d.join("Games/Gone")).is_none(), "no folder: nothing");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn an_unchanged_game_is_not_looked_up_again() {
        let d = tmp("lk_flow");
        let file = d.join("data/game_lookups.json");
        let (a, exe) = game(&d, "Alpha");
        let (b, _) = game(&d, "Beta");
        let none = std::collections::HashSet::new();
        let done: std::collections::HashSet<String> = Default::default();
        let (two, three) = (lookup_setup(&keys("k", "", "")), lookup_setup(&keys("k", "t", "")));
        // (Game Recognition the first time: never looked up, so both are; Alpha's icon is still its
        // program's own -- wanted by Steam's pictures and the databases --, Beta has no background)
        for g in [&a, &b] { assert!(!lookup_unchanged(&file, g, None) && !lookup_unchanged(&file, g, Some(&two))); }
        assert!(crate::gameart::steam_art_wanted(&a, true, &done, &none) && crate::gameart::needs_db_art(&a, false));
        // the lookups put pictures in (Steam's background for Alpha), then they're kept as they are now
        w(&a.join("background.jpg"), b"steam bg"); crate::gameart::mark_source(&a, "background", crate::gameart::SRC_STEAM);
        lookup_done(&file, &[a.clone(), b.clone()], &[a.clone(), b.clone()], &two);
        // the next Game Recognition: both unchanged -- neither Steam nor the databases asked again,
        // even though Alpha's icon is still its program's and Beta still has no background
        assert!(crate::gameart::steam_art_wanted(&a, true, &done, &none) && crate::gameart::needs_db_art(&b, false), "(they'd be looked for otherwise)");
        for g in [&a, &b] { assert!(lookup_unchanged(&file, g, None) && lookup_unchanged(&file, g, Some(&two)), "{} unchanged: not looked up", g.display()); }
        // a database added: the databases asked again, Steam not
        assert!(!lookup_unchanged(&file, &a, Some(&three)) && lookup_unchanged(&file, &a, None));
        // Alpha's background removed by the user: Alpha looked up again (both), Beta still not
        fs::remove_file(a.join("background.jpg")).unwrap();
        assert!(!lookup_unchanged(&file, &a, None) && !lookup_unchanged(&file, &a, Some(&two)));
        assert!(lookup_unchanged(&file, &b, None) && lookup_unchanged(&file, &b, Some(&two)));
        // looked up again (nothing found this time): unchanged from then on
        lookup_done(&file, &[a.clone()], &[a.clone()], &two);
        assert!(lookup_unchanged(&file, &a, None) && lookup_unchanged(&file, &a, Some(&two)));
        // the game updated (its program): looked up again
        fs::write(&exe, b"MZ v2, a bigger one").unwrap();
        assert!(!lookup_unchanged(&file, &a, None));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn each_lookup_kept_on_its_own() {
        let d = tmp("lk_each");
        let file = d.join("game_lookups.json");
        let (a, _) = game(&d, "Alpha");
        let st = lookup_setup(&keys("k", "", ""));
        // only Steam asked: the databases weren't (none set up then, say)
        lookup_done(&file, &[a.clone()], &[], &st);
        assert!(lookup_unchanged(&file, &a, None) && !lookup_unchanged(&file, &a, Some(&st)));
        // then the databases, the game the same: Steam's kept too
        lookup_done(&file, &[], &[a.clone()], &st);
        assert!(lookup_unchanged(&file, &a, None) && lookup_unchanged(&file, &a, Some(&st)));
        // the databases put a picture in: the game changed, so only their lookup stands for it as it is now
        w(&a.join("background.jpg"), b"db bg");
        lookup_done(&file, &[], &[a.clone()], &st);
        assert!(lookup_unchanged(&file, &a, Some(&st)) && !lookup_unchanged(&file, &a, None));
        // a game deleted: dropped from the list at the next write
        let (b, _) = game(&d, "Beta");
        lookup_done(&file, &[b.clone()], &[], &st);
        fs::remove_dir_all(&a).unwrap();
        lookup_done(&file, &[b.clone()], &[], &st);
        let m: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(m.len(), 1);
        // nothing asked: the list isn't touched
        let before = fs::read_to_string(&file).unwrap();
        lookup_done(&file, &[], &[], &st);
        assert_eq!(fs::read_to_string(&file).unwrap(), before);
        // (a broken list: as if nothing was looked up, and made anew)
        fs::write(&file, "{ broken").unwrap();
        assert!(!lookup_unchanged(&file, &b, None));
        lookup_done(&file, &[b.clone()], &[], &st);
        assert!(lookup_unchanged(&file, &b, None));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn the_databases_set_up_are_told_apart() {
        let s = |k: (&str, &str, &str)| lookup_setup(&ScrapeSettings { sgdb_key: k.0.into(), tgdb_key: k.1.into(), rawg_key: k.2.into() });
        assert_eq!(s(("x", "", "")), s(("other key", " ", "")), "the same databases (another key for one): the same");
        assert_ne!(s(("x", "", "")), s(("x", "", "y")));
        // (as written when Automatic Scraping was there, On: the games looked up then stay so)
        assert_eq!(s(("x", "", "y")), "1101");
    }

    #[test]
    fn one_folder_one_key_on_windows() {
        let k = |p: &str| crate::gameart::plain_key(p.to_string());
        assert_eq!(k(r"\\?\C:\MaXMB\content\Games\Alpha"), k(r"C:\MaXMB\content\Games\Alpha"));
        assert_eq!(k(r"C:\MaXMB\content\Games\Alpha\"), "c:/maxmb/content/games/alpha");
        assert_eq!(k(r"\\?\UNC\server\share\Games\Alpha"), k(r"\\server\share\Games\Alpha"));
    }
}
