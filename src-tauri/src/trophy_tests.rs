//! Trophies: every way a game gets into the system (Game Recognition from
//! each store / RPCS3, added by hand with each kind of shortcut, offline
//! copies) against every account state (none, Steam ID / key, RetroAchievements),
//! and what each one shows offline. (Part of trophies.rs's tests.)

use super::*;
use std::fs;
use std::path::{Path, PathBuf};

fn kv(b: &mut Vec<u8>, t: u8, n: &str) { b.push(t); b.extend_from_slice(n.as_bytes()); b.push(0); }
/// UserGameStatsSchema: achievements ACH_0..ACH_{n-1} as bits of stat 1
fn steam_schema_bin(appid: &str, n: usize) -> Vec<u8> {
    let mut b = Vec::new();
    kv(&mut b, 0, appid); kv(&mut b, 0, "stats"); kv(&mut b, 0, "1"); kv(&mut b, 0, "bits");
    for i in 0..n {
        kv(&mut b, 0, &i.to_string());
        kv(&mut b, 1, "name"); b.extend_from_slice(format!("ACH_{i}\0").as_bytes());
        kv(&mut b, 0, "display"); kv(&mut b, 0, "name"); kv(&mut b, 1, "english"); b.extend_from_slice(format!("Ach {i}\0").as_bytes()); b.push(8);
        kv(&mut b, 1, "hidden"); b.extend_from_slice(if i == n - 1 { b"1\0" } else { b"0\0" }); b.push(8);
        b.push(8);
    }
    b.extend_from_slice(&[8, 8, 8, 8, 8]);
    b
}
/// UserGameStats: these bits of stat 1 won at 1,700,000,000 + bit
fn steam_user_bin(bits: &[i64]) -> Vec<u8> {
    let mut b = Vec::new();
    let mask: i32 = bits.iter().map(|x| 1i32 << x).sum();
    kv(&mut b, 0, "cache"); kv(&mut b, 0, "1"); kv(&mut b, 2, "data"); b.extend_from_slice(&mask.to_le_bytes());
    kv(&mut b, 0, "AchievementTimes");
    for x in bits { kv(&mut b, 2, &x.to_string()); b.extend_from_slice(&((1_700_000_000 + x) as i32).to_le_bytes()); }
    b.extend_from_slice(&[8, 8, 8, 8]);
    b
}
fn tropusr(won: &[(u32, i64)], total: u32) -> Vec<u8> {
    let mut b = vec![0u8; 80];
    b[0..4].copy_from_slice(&0x818F54ADu32.to_be_bytes()); b[8..12].copy_from_slice(&1u32.to_be_bytes());
    b[48..52].copy_from_slice(&6u32.to_be_bytes()); b[52..56].copy_from_slice(&0x60u32.to_be_bytes());
    b[60..64].copy_from_slice(&total.to_be_bytes()); b[64..72].copy_from_slice(&80u64.to_be_bytes());
    for id in 0..total {
        let mut e = vec![0u8; 0x70];
        e[16..20].copy_from_slice(&id.to_be_bytes());
        if let Some((_, t)) = won.iter().find(|(i, _)| *i == id) {
            e[20..24].copy_from_slice(&1u32.to_be_bytes());
            e[32..40].copy_from_slice(&((t * 1_000_000 + 62_135_596_800_000_000) as u64).to_be_bytes());
        }
        b.extend_from_slice(&e);
    }
    b
}
fn w(p: &Path, data: impl AsRef<[u8]>) { fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, data).unwrap(); }
fn game(root: &Path, name: &str, meta: Option<serde_json::Value>) -> PathBuf {
    let d = root.join("Games").join(name); fs::create_dir_all(&d).unwrap();
    if let Some(m) = meta { fs::write(d.join("game.json"), m.to_string()).unwrap(); }
    d
}
fn gref(d: &Path, title: &str, launch: &str) -> GameRef { GameRef { folder: d.display().to_string(), title: title.into(), launch: launch.into(), stamp: String::new() } }
fn link(at: &Path, target: &Path) { crate::medialib::write_link(at, target).unwrap(); }

/// (the tests here set the same folders of the "computer": one at a time)
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn permutations() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = std::env::temp_dir().join(format!("maxmb_tperm_{}", std::process::id()));
    let _ = fs::remove_dir_all(&t);
    let p = |s: &str| t.join(s);
    // ---- the computer: Steam (appcache), the emulators' folders, RPCS3
    let steam = p("Steam");
    *STEAM_ROOT.lock().unwrap() = Some(Some(steam.clone()));
    for (k, v) in [("APPDATA", "AppData"), ("PUBLIC", "Public"), ("LOCALAPPDATA", "Local"), ("USERPROFILE", "User"), ("ProgramData", "ProgramData")] {
        std::env::set_var(k, p(v));
    }
    let me = "76561197960265829"; // account 101
    w(&steam.join("config/loginusers.vdf"), format!("\"users\"\n{{\n\"{me}\"\n{{\n\"MostRecent\"\t\t\"1\"\n}}\n}}\n"));
    let stats = steam.join("appcache/stats");
    // app 100: Steam's own files (3 achievements, the last hidden); won: bits 0 and 2
    w(&stats.join("UserGameStatsSchema_100.bin"), steam_schema_bin("100", 3));
    w(&stats.join("UserGameStats_101_100.bin"), steam_user_bin(&[0, 2]));
    // (another Steam account on this computer won only bit 1)
    w(&stats.join("UserGameStats_999_100.bin"), steam_user_bin(&[1]));
    let ctx = Ctx { tdir: p("cache"), sources: p("game_sources.json") };
    // app 200: only Steam's public list, kept (rarity for the grades)
    w(&ctx.tdir.join("schemas/steam_200.json"), serde_json::json!({ "response": { "achievements": [
        { "internal_name": "A_COMMON", "localized_name": "Common", "localized_desc": "d", "hidden": false, "icon": "c.jpg", "player_percent_unlocked": "55.0" },
        { "internal_name": "A_SILVER", "localized_name": "Uncommon", "localized_desc": "d", "hidden": false, "icon": "s.jpg", "player_percent_unlocked": "12.5" },
        { "internal_name": "A_GOLD", "localized_name": "Rare", "localized_desc": "d", "hidden": true, "icon": "g.jpg", "player_percent_unlocked": "3.1" } ] } }).to_string());

    let none = Accounts::default();
    let with_id = Accounts { steam_id: me.into(), ..Default::default() };
    let with_ra = Accounts { ra_user: "u".into(), ra_key: "k".into(), ..Default::default() };
    // (the stores' name lookups: RetroAchievements knows "Battlefield" and "Other",
    // Steam's store knows "Celeste" as app 504230)
    let ra_has = |t: &str| (t == "Battlefield" || t == "Other").then_some(77u64);
    let steam_find = |t: &str| (clean_title(t).to_lowercase() == "celeste").then(|| "504230".to_string());
    let nl = Lookups { ra_has: &ra_has, steam_find: &steam_find };
    let all = Lookups { ra_has: &|_| Some(77), steam_find: &|_| Some("1".into()) };
    let src = |g: &GameRef, a: &Accounts| source_in(&ctx, a, g, &nl);
    let list = |g: &GameRef, a: &Accounts| source_in(&ctx, a, g, &nl).and_then(|s| local_list(&ctx.tdir, a, &g.title, &s, false)).map(|(_, l)| l);
    let earned = |l: &Vec<Trophy>| { let mut v: Vec<String> = l.iter().filter(|t| t.earned.is_some()).map(|t| t.id.clone()).collect(); v.sort(); v };
    let mut r: Vec<String> = Vec::new();
    let mut ok = |name: &str, c: bool, info: String| { if !c { r.push(format!("FAIL {name}: {info}")); } };

    // ---- 1. Game Recognition: a Steam library game (Steam's own files)
    let lib = p("Lib/steamapps/common/Game100"); fs::create_dir_all(&lib).unwrap();
    let g1 = gref(&game(&t, "G100", Some(serde_json::json!({ "title": "Game One", "store": "Steam", "steamAppId": "100", "launch": "steam://rungameid/100", "sourceDir": lib }))), "Game One", "steam://rungameid/100");
    ok("recognized Steam game: Steam source", src(&g1, &none) == Some(Src::Steam("100".into(), vec![lib.clone()])), format!("{:?}", src(&g1, &none)));
    let l = list(&g1, &with_id).unwrap();
    ok("Steam's own files: the list, hidden one, earned by this account", l.len() == 4 && l.iter().any(|t| t.id == "ACH_2" && t.hidden)
        && earned(&l) == vec!["ACH_0", "ACH_2"], format!("{:?}", earned(&l)));
    ok("no rarity known: Bronze, and the added Platinum (not earned)", l.iter().filter(|t| !t.auto_plat).all(|t| t.grade == "B")
        && l[0].auto_plat && l[0].name == "Game One Platinum Trophy" && l[0].earned.is_none(), String::new());
    // (an ID with no file of its own: the newest file is used)
    let other = Accounts { steam_id: "76561197960265730".into(), ..Default::default() };
    let l2 = list(&g1, &other).unwrap();
    ok("an account without its own file: the newest one on the computer", !earned(&l2).is_empty(), format!("{:?}", earned(&l2)));

    // ---- 2. Recognized Steam game Steam never ran here, nothing kept: no trophies (offline)
    let g2 = gref(&game(&t, "G300", Some(serde_json::json!({ "title": "Never Ran", "store": "Steam", "steamAppId": "300" }))), "Never Ran", "");
    ok("Steam game without any list (offline): not shown", src(&g2, &none).is_some() && list(&g2, &none).is_none(), String::new());

    // ---- 3. Recognized Steam game with only the kept public list + an emulator file (GSE)
    w(&p("AppData/GSE Saves/200/achievements.json"), r#"{"A_SILVER":{"earned":true,"earned_time":1700000100}}"#);
    let g3 = gref(&game(&t, "G200", Some(serde_json::json!({ "title": "Two", "store": "Steam", "steamAppId": "200" }))), "Two", "");
    let l = list(&g3, &none).unwrap();
    let grade = |id: &str| l.iter().find(|t| t.id == id).map(|t| t.grade.clone()).unwrap_or_default();
    ok("grades from rarity: 55% Bronze, 12.5% Silver, 3.1% Gold", grade("A_COMMON") == "B" && grade("A_SILVER") == "S" && grade("A_GOLD") == "G", String::new());
    ok("emulator file read without any account", earned(&l) == vec!["A_SILVER"], format!("{:?}", earned(&l)));

    // ---- 4. Added by hand: an offline copy (shortcut to its program; steam_appid.txt next to it)
    let cp = p("Copies/Two"); w(&cp.join("two.exe"), b"MZ"); w(&cp.join("steam_appid.txt"), "200\n");
    let d4 = game(&t, "Two (copy)", None); link(&d4.join("Two.xmbl"), &cp.join("two.exe"));
    let g4 = gref(&d4, "Two", "Two.xmbl");
    ok("hand-added offline copy: Steam app 200 found next to its program", matches!(src(&g4, &none), Some(Src::Steam(ref i, _)) if i == "200"), format!("{:?}", src(&g4, &none)));
    let l = list(&g4, &none).unwrap();
    ok("the copy shares the recognized game's trophies (same key)", earned(&l) == vec!["A_SILVER"], String::new());
    // (also with steam_emu.ini in a subfolder)
    let cp2 = p("Copies/Emu"); w(&cp2.join("bin/game.exe"), b"MZ"); w(&cp2.join("bin/steam_emu.ini"), "[Settings]\nAppId=100\n");
    let d4b = game(&t, "Emu", None); link(&d4b.join("Emu.xmbl"), &cp2.join("bin/game.exe"));
    ok("hand-added copy with steam_emu.ini", matches!(src(&gref(&d4b, "Emu", "Emu.xmbl"), &none), Some(Src::Steam(ref i, _)) if i == "100"), String::new());

    // ---- 5. An offline copy whose list is only its own steam_settings (no Steam, nothing kept)
    let cp3 = p("Copies/Four"); w(&cp3.join("four.exe"), b"MZ"); w(&cp3.join("steam_appid.txt"), "400");
    w(&cp3.join("steam_settings/achievements.json"), r#"[{"name":"F_ONE","displayName":"First","description":"d","hidden":0,"icon":"img/a.png"},{"name":"F_TWO","displayName":{"english":"Second"},"description":"d","hidden":"1","icon":"../../../secret.txt"}]"#);
    w(&cp3.join("steam_settings/img/a.png"), b"png");
    w(&p("AppData/Goldberg SteamEmu Saves/400/achievements.json"), r#"{"F_ONE":{"earned":true,"earned_time":"1700000200"}}"#);
    let d5 = game(&t, "Four", None); link(&d5.join("Four.xmbl"), &cp3.join("four.exe"));
    let l = list(&gref(&d5, "Four", "Four.xmbl"), &none).unwrap();
    ok("steam_settings list + Goldberg file", l.len() == 3 && earned(&l) == vec!["F_ONE"] && l.iter().any(|t| t.id == "F_TWO" && t.hidden && t.name == "Second"), format!("{l:?}"));
    ok("a picture outside steam_settings is never used", l.iter().find(|t| t.id == "F_TWO").map(|t| t.src.is_empty()).unwrap_or(false)
        && l.iter().find(|t| t.id == "F_ONE").map(|t| t.src.ends_with("a.png")).unwrap_or(false), String::new());

    // ---- 6. Added by hand with Steam's own .url shortcut
    let d6 = game(&t, "Url100", None); w(&d6.join("Game One.url"), "[InternetShortcut]\nURL=steam://rungameid/100\n");
    let g6 = gref(&d6, "Game One", "Game One.url");
    ok("hand-added Steam shortcut (.url): Steam app 100", matches!(src(&g6, &none), Some(Src::Steam(ref i, _)) if i == "100"), format!("{:?}", src(&g6, &none)));
    ok("…with the same trophies as the recognized one", list(&g6, &with_id).map(|l| earned(&l)) == Some(vec!["ACH_0".into(), "ACH_2".into()]), String::new());

    // ---- 7. Epic: recognized (its link) and by hand (.url); offline nothing is read
    let g7 = gref(&game(&t, "Fort", Some(serde_json::json!({ "title": "Fort", "store": "Epic Games", "launch": "com.epicgames.launcher://apps/fn%3A4fe7%3AFortnite?action=launch&silent=true" }))), "Fort", "");
    ok("recognized Epic game: Epic namespace", src(&g7, &none) == Some(Src::Epic("fn".into())), format!("{:?}", src(&g7, &none)));
    let d7 = game(&t, "Fort2", None); w(&d7.join("Fort.url"), "[InternetShortcut]\nURL=com.epicgames.launcher://apps/ns2%3Aitem%3AApp?action=launch\n");
    ok("hand-added Epic shortcut: Epic namespace", src(&gref(&d7, "Fort", "Fort.url"), &none) == Some(Src::Epic("ns2".into())), String::new());
    ok("Epic offline: nothing read (kept list shown instead)", list(&g7, &none).is_none(), String::new());

    // ---- 8. GOG: recognized, and by hand (goggame file next to its program)
    let gd = p("GOG/Quake"); w(&gd.join("goggame-1.info"), "\u{feff}{\"gameId\":\"1\",\"clientId\":\"c1\",\"name\":\"Quake\"}"); w(&gd.join("q.exe"), b"MZ");
    let g8 = gref(&game(&t, "Quake", Some(serde_json::json!({ "title": "Quake", "store": "GOG", "sourceDir": gd }))), "Quake", "");
    ok("recognized GOG game: product 1", matches!(src(&g8, &none), Some(Src::Gog(ref i, _)) if i == "1"), format!("{:?}", src(&g8, &none)));
    let d8 = game(&t, "Quake2", None); link(&d8.join("Quake.xmbl"), &gd.join("q.exe"));
    ok("hand-added GOG game: product 1", matches!(src(&gref(&d8, "Quake", "Quake.xmbl"), &none), Some(Src::Gog(ref i, _)) if i == "1"), String::new());

    // ---- 9. PS3 (RPCS3): installed in RPCS3, a disc copy elsewhere (Game Recognition's RPCS3), no trophies yet
    let rp = p("RPCS3"); w(&rp.join("rpcs3.exe"), b"MZ");
    let inst = rp.join("dev_hdd0/game/BLUS00001");
    w(&inst.join("USRDIR/EBOOT.BIN"), b"x"); fs::create_dir_all(inst.join("TROPDIR/NPWR00001_00")).unwrap();
    let tro = rp.join("dev_hdd0/home/00000001/trophy/NPWR00001_00");
    w(&tro.join("TROPCONF.SFM"), r#"<trophyconf><trophy id="000" hidden="no" ttype="P"><name>All</name><detail>d</detail></trophy><trophy id="001" hidden="no" ttype="G"><name>Big</name><detail>d</detail></trophy><trophy id="002" hidden="yes" ttype="B"><name>Sec</name><detail>d</detail></trophy></trophyconf>"#);
    w(&tro.join("TROPUSR.DAT"), tropusr(&[(1, 1_400_000_000)], 3));
    let g9 = gref(&game(&t, "PS3a", Some(serde_json::json!({ "title": "PS3 A", "titleId": "BLUS00001", "ps3Key": inst.join("USRDIR/EBOOT.BIN") }))), "PS3 A", "");
    ok("RPCS3-installed game: its trophy folder", src(&g9, &none) == Some(Src::Rpcs3(tro.clone())), format!("{:?}", src(&g9, &none)));
    let l = list(&g9, &none).unwrap();
    ok("PS3: own grades, own Platinum (none added), earned from TROPUSR", l.len() == 3 && l[0].grade == "P" && !l.iter().any(|t| t.auto_plat)
        && earned(&l) == vec!["1"] && l[2].hidden, format!("{l:?}"));
    let disc = p("Discs/BLUS00002");
    w(&disc.join("PS3_GAME/USRDIR/EBOOT.BIN"), b"x"); fs::create_dir_all(disc.join("PS3_GAME/TROPDIR/NPWR00001_00")).unwrap();
    let g9b = gref(&game(&t, "PS3b", Some(serde_json::json!({ "title": "PS3 B", "titleId": "BLUS00002", "ps3Key": disc.join("PS3_GAME/USRDIR/EBOOT.BIN") }))), "PS3 B", "");
    ok("disc copy outside RPCS3, RPCS3 unknown: no trophies", src(&g9b, &none).is_none(), String::new());
    w(&ctx.sources, serde_json::json!({ "records": [{ "rpcs3": rp.join("rpcs3.exe") }] }).to_string());
    ok("…found once Game Recognition knows RPCS3", src(&g9b, &none) == Some(Src::Rpcs3(tro.clone())), format!("{:?}", src(&g9b, &none)));
    let inst3 = rp.join("dev_hdd0/game/BLUS00003"); w(&inst3.join("USRDIR/EBOOT.BIN"), b"x"); fs::create_dir_all(inst3.join("TROPDIR/NPWR00003_00")).unwrap();
    let g9c = gref(&game(&t, "PS3c", Some(serde_json::json!({ "title": "PS3 C", "titleId": "BLUS00003", "ps3Key": inst3.join("USRDIR/EBOOT.BIN") }))), "PS3 C", "");
    ok("PS3 game never started (no trophy folder yet): none", src(&g9c, &with_ra).is_none(), String::new());

    // ---- 10. A plain game added by hand (no store, no Steam ID next to it): the accounts decide
    let pd = p("Plain"); w(&pd.join("x.exe"), b"MZ");
    let d10 = game(&t, "Battlefield", None); link(&d10.join("bf.xmbl"), &pd.join("x.exe"));
    let g10 = gref(&d10, "Battlefield", "bf.xmbl");
    ok("plain game, no accounts: no trophies", src(&g10, &none).is_none(), String::new());
    ok("plain game, Steam account only: no trophies", src(&g10, &with_id).is_none(), String::new());
    ok("plain game, RetroAchievements linked: RetroAchievements", src(&g10, &with_ra) == Some(Src::RaGame(77)), String::new());
    ok("plain game on RetroAchievements: RetroAchievements", source_in(&ctx, &with_ra, &gref(&d10, "Other", "bf.xmbl"), &nl) == Some(Src::RaGame(77)), String::new());
    // (a store game never falls to RetroAchievements)
    ok("recognized Steam game with RA linked: still Steam", matches!(source_in(&ctx, &with_ra, &g1, &all), Some(Src::Steam(..))), String::new());

    ok("plain game RetroAchievements doesn't know: no trophies", src(&gref(&d10, "Unknown Thing", "bf.xmbl"), &with_ra).is_none(), String::new());

    // ---- 10b. A copy Epic Games installed (its .egstore, no .mancpn, as Goat Simulator 3) shipping a
    // Steam app ID too: never Steam's list (by its ID or its name); with its .mancpn, Epic's
    let ed = p("Epic/Celeste"); w(&ed.join("Celeste.exe"), b"MZ"); w(&ed.join("steam_appid.txt"), b"504230");
    w(&ed.join(".egstore/99D8.manifest"), b"x");
    let de = game(&t, "CelesteEpic", None); link(&de.join("c.xmbl"), &ed.join("Celeste.exe"));
    let ge = gref(&de, "Celeste", "c.xmbl");
    ok("Epic copy without its .mancpn: not Steam's (its steam_appid.txt, its name)", src(&ge, &with_id).is_none(), format!("{:?}", src(&ge, &with_id)));
    w(&ed.join(".egstore/AB.mancpn"), br#"{"CatalogNamespace":"celns","AppName":"Celeste"}"#);
    ok("Epic copy with its .mancpn: Epic's", src(&ge, &with_id) == Some(Src::Epic("celns".into())), format!("{:?}", src(&ge, &with_id)));

    // ---- 12. Games with no list of their own: the official game's by name
    // (an unofficial PS3 version: RPCS3's trophy folder of the game with its name, so it can be won)
    let uo = p("Mods/Big Game [Unofficial]"); w(&uo.join("USRDIR/EBOOT.BIN"), b"x");
    w(&tro.join("TROPCONF.SFM"), r#"<trophyconf><title-name>Big Game&#8482;</title-name><trophy id="000" hidden="no" ttype="P"><name>All</name><detail>d</detail></trophy><trophy id="001" hidden="no" ttype="G"><name>Big</name><detail>d</detail></trophy><trophy id="002" hidden="yes" ttype="B"><name>Sec</name><detail>d</detail></trophy></trophyconf>"#);
    let g12 = gref(&game(&t, "BigUnofficial", Some(serde_json::json!({ "title": "Big Game (Unofficial Port)", "titleId": "BLUS99999", "ps3Key": uo.join("USRDIR/EBOOT.BIN") }))), "Big Game (Unofficial Port)", "");
    ok("unofficial PS3 version (no TROPDIR): the official game's RPCS3 trophies by name", src(&g12, &none) == Some(Src::Rpcs3(tro.clone())), format!("{:?}", src(&g12, &none)));
    ok("…earned in RPCS3 count", list(&g12, &none).map(|l| earned(&l)) == Some(vec!["1".into()]), String::new());
    // (a PC recompilation named like a PS3 game played in RPCS3)
    let rc = p("Recomp"); w(&rc.join("big.exe"), b"MZ");
    let d12 = game(&t, "Big Recomp", None); link(&d12.join("Big.xmbl"), &rc.join("big.exe"));
    ok("hand-added recompilation: the RPCS3 game with its name", src(&gref(&d12, "Big Game - Recompiled v1.2", "Big.xmbl"), &none) == Some(Src::Rpcs3(tro.clone())), String::new());
    // (a game named like a Steam game: Steam's list, won through its emulator files / the account)
    let ce = p("Celeste"); w(&ce.join("celeste.exe"), b"MZ");
    let d12b = game(&t, "Celeste", None); link(&d12b.join("c.xmbl"), &ce.join("celeste.exe"));
    ok("hand-added game known on Steam by name: Steam app", matches!(src(&gref(&d12b, "Celeste (Decrypted)", "c.xmbl"), &none), Some(Src::Steam(ref i, _)) if i == "504230"), String::new());
    ok("titles cleaned for matching", clean_title("Big Game - Recompiled v1.2 [PC]") == "Big Game" && clean_title("Celeste (Decrypted)") == "Celeste", clean_title("Big Game - Recompiled v1.2 [PC]"));

    // ---- 13. Game Settings > Trophies Off: no trophies, whatever the source
    let off = game(&t, "Off100", Some(serde_json::json!({ "title": "Game One", "store": "Steam", "steamAppId": "100", "trophies": false })));
    ok("Trophies Off: none", src(&gref(&off, "Game One", ""), &with_id).is_none() && !enabled(&gref(&off, "Game One", "")), String::new());
    ok("Trophies On (or not set): listed", enabled(&g1), String::new());

    // ---- 11. Winning while the game runs: the files change, the new ones (and the Platinum last)
    let before = TrophySet { trophies: list(&g3, &none).unwrap(), ..Default::default() };
    w(&p("AppData/GSE Saves/200/achievements.json"), r#"{"A_SILVER":{"earned":true,"earned_time":1700000100},"A_COMMON":{"earned":true,"earned_time":1700000300},"A_GOLD":{"earned":true,"earned_time":1700000400}}"#);
    let after = TrophySet { trophies: list(&g3, &none).unwrap(), ..Default::default() };
    let won: Vec<String> = newly_won(&before, &after).iter().map(|t| t.id.clone()).collect();
    ok("new trophies in order, the added Platinum last", won == vec!["A_COMMON", "A_GOLD", "__platinum"], format!("{won:?}"));
    let st = stamp_of_files(&with_id, &Src::Steam("200".into(), vec![]));
    ok("the watched files include the emulator file", st.iter().any(|f| f.ends_with("GSE Saves/200/achievements.json") || f.ends_with("GSE Saves\\200\\achievements.json")), format!("{st:?}"));
    ok("PS3: TROPUSR.DAT is watched", stamp_of_files(&none, &Src::Rpcs3(tro.clone())) == vec![tro.join("TROPUSR.DAT")], String::new());

    *STEAM_ROOT.lock().unwrap() = None;
    let _ = fs::remove_dir_all(&t);
    assert!(r.is_empty(), "\n{}", r.join("\n"));
}

/// Sudden changes while the System runs: Steam's and the emulators' trophy
/// files deleted or damaged, the kept lists deleted, a game deleted outside
/// the System, Trophies turned off, and trophies won in several ways.
#[test]
fn sudden_changes_and_winning() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = std::env::temp_dir().join(format!("maxmb_tsud_{}", std::process::id()));
    let _ = fs::remove_dir_all(&t);
    let p = |s: &str| t.join(s);
    let steam = p("Steam");
    *STEAM_ROOT.lock().unwrap() = Some(Some(steam.clone()));
    for (k, v) in [("APPDATA", "AppData"), ("PUBLIC", "Public"), ("LOCALAPPDATA", "Local"), ("USERPROFILE", "User"), ("ProgramData", "ProgramData")] { std::env::set_var(k, p(v)); }
    let me = "76561197960265829";
    w(&steam.join("config/loginusers.vdf"), format!("\"users\"\n{{\n\"{me}\"\n{{\n\"MostRecent\"\t\t\"1\"\n}}\n}}\n"));
    let stats = steam.join("appcache/stats");
    w(&stats.join("UserGameStatsSchema_100.bin"), steam_schema_bin("100", 4));
    w(&stats.join("UserGameStats_101_100.bin"), steam_user_bin(&[0]));
    let ctx = Ctx { tdir: p("cache"), sources: p("game_sources.json") };
    let acc = Accounts { steam_id: me.into(), ..Default::default() };
    let nl = Lookups { ra_has: &|_| None, steam_find: &|_| None };
    let lib = p("Lib/steamapps/common/Game100"); fs::create_dir_all(&lib).unwrap();
    let gdir = game(&t, "G100", Some(serde_json::json!({ "title": "Game One", "store": "Steam", "steamAppId": "100", "sourceDir": lib })));
    let g = gref(&gdir, "Game One", "steam://rungameid/100");
    let read = || source_in(&ctx, &acc, &g, &nl).and_then(|s| local_list(&ctx.tdir, &acc, &g.title, &s, false)).map(|(_, l)| l);
    let won = |l: &Vec<Trophy>| { let mut v: Vec<String> = l.iter().filter(|t| t.earned.is_some()).map(|t| t.id.clone()).collect(); v.sort(); v };
    let mut rec = Record::default();
    let none: HashSet<String> = HashSet::new();

    // ---- winning: one at first, then two more, then all (the Platinum comes with the last)
    let mut l = read().unwrap(); record_apply(&mut rec, &acc, "steam", &none, &mut l);
    assert_eq!(won(&l), vec!["ACH_0"], "one trophy won");
    let t0 = l.iter().find(|t| t.id == "ACH_0").unwrap().earned;
    w(&stats.join("UserGameStats_101_100.bin"), steam_user_bin(&[0, 1, 2]));
    let mut l = read().unwrap(); record_apply(&mut rec, &acc, "steam", &none, &mut l);
    assert_eq!(won(&l), vec!["ACH_0", "ACH_1", "ACH_2"], "two more won");
    assert_eq!(l.iter().find(|t| t.id == "ACH_0").unwrap().earned, t0, "the first one keeps its time");
    assert!(l.iter().find(|t| t.auto_plat).unwrap().earned.is_none(), "no Platinum before the last one");
    w(&stats.join("UserGameStats_101_100.bin"), steam_user_bin(&[0, 1, 2, 3]));
    let mut l = read().unwrap(); record_apply(&mut rec, &acc, "steam", &none, &mut l);
    assert!(l.iter().all(|t| t.earned.is_some()), "all won: the Platinum too ({:?})", won(&l));

    // ---- Steam's file with the won trophies deleted: nothing in the files, the record keeps them
    fs::remove_file(stats.join("UserGameStats_101_100.bin")).unwrap();
    let mut l = read().expect("the list is still there");
    assert!(l.iter().filter(|t| !t.auto_plat).all(|t| t.earned.is_none()), "the files show nothing won");
    record_apply(&mut rec, &acc, "steam", &none, &mut l);
    assert_eq!(l.iter().filter(|t| !t.auto_plat && t.earned.is_some()).count(), 4, "the record keeps them won");

    // ---- the same file damaged (cut short, rubbish): nothing breaks
    for bad in [&b""[..], &b"\x00\x01\x02"[..], &[0xffu8; 300][..]] {
        w(&stats.join("UserGameStats_101_100.bin"), bad);
        let _ = read();
    }
    let _ = fs::remove_file(stats.join("UserGameStats_101_100.bin"));
    // ---- Steam's list of the game's trophies deleted / damaged: no list, nothing breaks
    let schema = fs::read(stats.join("UserGameStatsSchema_100.bin")).unwrap();
    w(&stats.join("UserGameStatsSchema_100.bin"), &schema[..schema.len() / 3]);
    let _ = read();
    fs::remove_file(stats.join("UserGameStatsSchema_100.bin")).unwrap();
    assert!(read().is_none(), "no list without Steam's file (and no kept one)");
    // (back again: read again as before)
    w(&stats.join("UserGameStatsSchema_100.bin"), &schema);
    assert_eq!(read().unwrap().iter().filter(|t| !t.auto_plat).count(), 4);

    // ---- a kept public list damaged or deleted
    w(&ctx.tdir.join("schemas/steam_200.json"), "{ not json");
    let g2 = gref(&game(&t, "G200", Some(serde_json::json!({ "title": "Two", "store": "Steam", "steamAppId": "200" }))), "Two", "");
    let read2 = || source_in(&ctx, &acc, &g2, &nl).and_then(|s| local_list(&ctx.tdir, &acc, &g2.title, &s, false)).map(|(_, l)| l);
    assert!(read2().is_none(), "a damaged kept list is no list");
    w(&ctx.tdir.join("schemas/steam_200.json"), serde_json::json!({ "response": { "achievements": [
        { "internal_name": "A", "localized_name": "A", "localized_desc": "d", "hidden": false, "icon": "a.jpg", "player_percent_unlocked": "50.0" },
        { "internal_name": "B", "localized_name": "B", "localized_desc": "d", "hidden": false, "icon": "b.jpg", "player_percent_unlocked": "2.0" } ] } }).to_string());
    // ---- an emulator's file: won, then the file damaged, then deleted
    let emu = p("AppData/GSE Saves/200/achievements.json");
    w(&emu, r#"{"A":{"earned":true,"earned_time":1700000100},"B":{"earned":false,"earned_time":0}}"#);
    let mut rec2 = Record::default();
    let mut l = read2().unwrap(); record_apply(&mut rec2, &acc, "steam", &none, &mut l);
    assert_eq!(won(&l), vec!["A"]);
    w(&emu, "{\"A\":{\"earned\":tr");
    let mut l = read2().unwrap(); record_apply(&mut rec2, &acc, "steam", &none, &mut l);
    assert_eq!(won(&l), vec!["A"], "a damaged emulator file: the record keeps what was won");
    fs::remove_file(&emu).unwrap();
    let mut l = read2().unwrap(); record_apply(&mut rec2, &acc, "steam", &none, &mut l);
    assert_eq!(won(&l), vec!["A"], "the emulator file deleted: still won");
    // (won again on another emulator, with another time: the first time stays)
    w(&p("Public/Documents/Steam/CODEX/200/achievements.ini"), "[A]\nAchieved=1\nUnlockTime=1800000000\n[B]\nAchieved=1\nUnlockTime=1800000001\n");
    let mut l = read2().unwrap(); record_apply(&mut rec2, &acc, "steam", &none, &mut l);
    assert!(won(&l).contains(&"B".to_string()), "another emulator's file read too ({:?})", won(&l));
    assert_eq!(rec2.won["A"].t, 1700000100, "the time first seen stays");

    // ---- Trophies turned off for the game, then on
    assert!(enabled(&g));
    crate::library::patch_meta(&gdir, &[("trophies", serde_json::json!(false))]).unwrap();
    assert!(!enabled(&g), "Trophies Off: the game isn't read");
    crate::library::patch_meta(&gdir, &[("trophies", serde_json::json!(true))]).unwrap();
    assert!(enabled(&g));
    // ---- its game.json damaged, then the whole game folder deleted outside the System
    w(&gdir.join("game.json"), "{{{{");
    let _ = source_in(&ctx, &acc, &g, &nl); let _ = enabled(&g);
    fs::remove_dir_all(&gdir).unwrap();
    let _ = enabled(&g);
    assert!(source_in(&ctx, &acc, &g, &nl).and_then(|s| local_list(&ctx.tdir, &acc, &g.title, &s, false)).map(|(_, l)| l.len()).unwrap_or(0) <= 5, "a deleted game: nothing breaks");
    // ---- the record's file: written, read back, damaged, deleted
    let rf = p("cache/earned/u/x.json");
    fs::create_dir_all(rf.parent().unwrap()).unwrap();
    record_save(&rf, &rec);
    assert_eq!(record_load(&rf).unwrap().won.len(), rec.won.len());
    w(&rf, "nope"); assert!(record_load(&rf).is_none(), "a damaged record is read as none");
    fs::remove_file(&rf).unwrap(); assert!(record_load(&rf).is_none());
    let _ = fs::remove_dir_all(&t);
}

/// Every kind of Steam emulator: its game found to be its Steam game (the app ID from
/// its own files), its file of trophies won found and read, Steam never asked for it,
/// and a trophy won while it runs seen (the file watched, read again).
#[test]
fn every_steam_emulator() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = std::env::temp_dir().join(format!("maxmb_temu_{}", std::process::id()));
    let _ = fs::remove_dir_all(&t);
    let p = |s: &str| t.join(s);
    *STEAM_ROOT.lock().unwrap() = Some(Some(p("Steam")));
    for (k, v) in [("APPDATA", "AppData"), ("PUBLIC", "Public"), ("LOCALAPPDATA", "Local"), ("USERPROFILE", "User"), ("ProgramData", "ProgramData")] { std::env::set_var(k, p(v)); }
    let ctx = Ctx { tdir: p("cache"), sources: p("game_sources.json") };
    // (a Steam ID and a key: Steam could be asked, but isn't for these)
    let acc = Accounts { steam_id: "76561197960265829".into(), steam_key: "k".into(), ..Default::default() };
    let nl = Lookups { ra_has: &|_| None, steam_find: &|_| None };
    let (t1, t2) = (1_700_000_001i64, 1_700_000_002i64);
    let json = |b: bool| format!(r#"{{"A":{{"earned":true,"earned_time":{t1}}},"B":{{"earned":{b},"earned_time":{}}}}}"#, if b { t2 } else { 0 });
    let sect = |b: bool| format!("[A]\nAchieved=1\nUnlockTime={t1}\n[B]\nAchieved={}\nUnlockTime={}\n", b as u8, if b { t2 } else { 0 });
    let hex = |x: i64| (x as u32).to_le_bytes().iter().map(|b| format!("{b:02X}")).collect::<String>();
    let sse = |b: bool| { let mut v = Vec::new(); let n = if b { 2 } else { 1 }; v.extend_from_slice(&(n as i32).to_le_bytes());
        for (name, tm) in [("A", t1), ("B", t2)].into_iter().take(n) { let mut e = [0u8; 24]; e[0..4].copy_from_slice(&crc32(name).to_le_bytes()); e[8..12].copy_from_slice(&(tm as i32).to_le_bytes()); e[20..24].copy_from_slice(&1i32.to_le_bytes()); v.extend_from_slice(&e); } v };
    struct Emu { name: &'static str, id: &'static str, game: Vec<(String, String)>, save: String, one: Vec<u8>, two: Vec<u8> }
    let e = |name, id: &'static str, game: &[(&str, String)], save: String, one: Vec<u8>, two: Vec<u8>| Emu { name, id, game: game.iter().map(|(a, b)| (a.to_string(), b.clone())).collect(), save, one, two };
    let emus = vec![
        e("Goldberg", "301", &[("steam_appid.txt", "301".into())], "AppData/Goldberg SteamEmu Saves/301/achievements.json".into(), json(false).into(), json(true).into()),
        e("Goldberg (GSE)", "302", &[("steam_settings/steam_appid.txt", "302".into())], "AppData/GSE Saves/302/achievements.json".into(), json(false).into(), json(true).into()),
        e("Goldberg (saves in the game's folder)", "303", &[("steam_appid.txt", "303".into()), ("steam_settings/local_save.txt", "saves".into())], "GAME/saves/303/achievements.json".into(), json(false).into(), json(true).into()),
        e("CODEX", "304", &[("steam_emu.ini", "[Settings]\nAppId=304\n".into())], "Public/Documents/Steam/CODEX/304/achievements.ini".into(), sect(false).into(), sect(true).into()),
        e("CODEX (AppData)", "305", &[("steam_emu.ini", "[Settings]\nAppId=305\n".into())], "AppData/Steam/CODEX/305/achievements.ini".into(), sect(false).into(), sect(true).into()),
        e("RUNE", "306", &[("steam_emu.ini", "[Settings]\nAppId=306\n".into())], "Public/Documents/Steam/RUNE/306/achievements.ini".into(), sect(false).into(), sect(true).into()),
        e("EMPRESS", "307", &[("steam_emu.ini", "[Settings]\nAppId=307\n".into())], "AppData/EMPRESS/307/remote/307/achievements.json".into(), json(false).into(), json(true).into()),
        e("EMPRESS (Public)", "308", &[("steam_appid.txt", "308".into())], "Public/Documents/EMPRESS/308/remote/308/achievements.json".into(), json(false).into(), json(true).into()),
        e("OnlineFix", "309", &[("OnlineFix.ini", "[Main]\nRealAppId=309\nFakeAppId=480\n".into())], "Public/Documents/OnlineFix/309/Stats/Achievements.ini".into(),
            format!("[A]\nachieved=true\ntimestamp={t1}\n").into(), format!("[A]\nachieved=true\ntimestamp={t1}\n[B]\nachieved=true\ntimestamp={t2}\n").into()),
        e("SKIDROW", "310", &[("steam_api.ini", "[Settings]\nAppId=310\n".into())], "Local/SKIDROW/310/Stats/achiev.ini".into(),
            format!("[SteamAchievements]\nCount=2\n[A]\nAchieved=1\nUnlockTime={}\n", hex(t1)).into(), format!("[SteamAchievements]\nCount=2\n[A]\nAchieved=1\nUnlockTime={}\n[B]\nAchieved=1\nUnlockTime={}\n", hex(t1), hex(t2)).into()),
        e("SKIDROW (Documents)", "311", &[("steam_api.ini", "[Settings]\nAppId=311\n".into())], "User/Documents/SKIDROW/311/SteamEmu/UserStats/achiev.ini".into(), sect(false).into(), sect(true).into()),
        e("CreamAPI", "312", &[("cream_api.ini", "[config]\nappid = 312\n".into())], "AppData/CreamAPI/312/stats/CreamAPI.Achievements.cfg".into(),
            format!("[A]\nachieved=true\nunlocktime={t1}\n").into(), format!("[A]\nachieved=true\nunlocktime={t1}\n[B]\nachieved=true\nunlocktime={t2}\n").into()),
        e("SmartSteamEmu", "313", &[("SmartSteamEmu.ini", "[Launcher]\nAppId = 313\n".into())], "AppData/SmartSteamEmu/313/stats.bin".into(), sse(false), sse(true)),
        e("ALI213", "314", &[("ALI213.ini", "[Settings]\nAppID = 314\nSaveType = 0\nPlayerName = Maxi\n".into())], "GAME/Profile/Maxi/Stats/achievements.ini".into(), sect(false).into(), sect(true).into()),
        e("Hoodlum", "315", &[("hlm.ini", "[GameSettings]\nAppId=315\nUserDataFolder=.\n".into())], "GAME/SteamEmu/UserStats/achiev.ini".into(),
            format!("[Achievements]\nA=1\nB=0\n[AchievementsUnlockTimes]\nA={t1}\nB=0\n").into(), format!("[Achievements]\nA=1\nB=1\n[AchievementsUnlockTimes]\nA={t1}\nB={t2}\n").into()),
        e("DARKSiDERS", "316", &[("ds.ini", "[GameSettings]\nAppId=316\nUserDataFolder=mydocs\nUserName=Maxi\n".into())], "User/Documents/Maxi/316/SteamEmu/achiev.ini".into(),
            format!("[Achievements]\nA=1\n[AchievementsUnlockTimes]\nA={t1}\n").into(), format!("[Achievements]\nA=1\nB=1\n[AchievementsUnlockTimes]\nA={t1}\nB={t2}\n").into()),
        e("RLD! / 3DM", "317", &[("steam_appid.txt", "317".into())], "ProgramData/Steam/RLD!/317/Stats/achievements.ini".into(),
            format!("[State]\nA=0101\nB=0000\n[Time]\nA={}\n", hex(t1)).into(), format!("[State]\nA=0101\nB=0101\n[Time]\nA={}\nB={}\n", hex(t1), hex(t2)).into()),
        e("TENOKE", "318", &[("Game_Data/Plugins/x86_64/tenoke.ini", "[TENOKE]\nid = 318\n".into())], "GAME/SteamData/user_stats.ini".into(),
            format!("[ACHIEVEMENTS]\n\"A\" = {{unlocked = true, time = {t1}}}\n").into(), format!("[ACHIEVEMENTS]\n\"A\" = {{unlocked = true, time = {t1}}}\n\"B\" = {{unlocked = true, time = {t2}}}\n").into()),
        e("TENOKE (AppData)", "319", &[("tenoke.ini", "id = 319\n".into())], "AppData/TENOKE/319/achievements.toml".into(),
            format!("\"A\" = {{unlocked = true, time = {t1}}}\n").into(), format!("\"A\" = {{unlocked = true, time = {t1}}}\n\"B\" = {{unlocked = true, time = {t2}}}\n").into()),
    ];
    let mut fails: Vec<String> = Vec::new();
    for em in &emus {
        // (Steam's public list of the game's trophies, kept: A, B, C)
        let achs: Vec<serde_json::Value> = ["A", "B", "C"].iter().map(|n|
            serde_json::json!({ "internal_name": n, "localized_name": n, "localized_desc": "d", "hidden": false, "icon": "", "player_percent_unlocked": "50.0" })).collect();
        w(&ctx.tdir.join(format!("schemas/steam_{}.json", em.id)), serde_json::json!({ "response": { "achievements": achs } }).to_string());
        let gd = p(&format!("Games/{}", em.id));
        w(&gd.join("Game.exe"), b"MZ");
        for (rel, c) in &em.game { w(&gd.join(rel), c); }
        let save = if let Some(r) = em.save.strip_prefix("GAME/") { gd.join(r) } else { p(&em.save) };
        w(&save, &em.one);
        let g = gref(&game(&t, &format!("E{}", em.id), Some(serde_json::json!({ "title": em.name, "sourceDir": gd, "sourceExe": gd.join("Game.exe") }))), em.name, "");
        let src = source_in(&ctx, &acc, &g, &nl);
        let Some(Src::Steam(id, dirs)) = src.clone() else { fails.push(format!("{}: not found to be a Steam game ({src:?})", em.name)); continue };
        if id != em.id { fails.push(format!("{}: app ID {id}, not {}", em.name, em.id)); continue; }
        let files = steam_stamp_files(&acc, &id, &dirs);
        if !files.iter().any(|f| f == &save) { fails.push(format!("{}: its file isn't found ({files:?})", em.name)); continue; }
        if asks_stores(&acc, src.as_ref().unwrap()) { fails.push(format!("{}: Steam would be asked", em.name)); }
        let won = || { let l = local_list(&ctx.tdir, &acc, em.name, src.as_ref().unwrap(), false).map(|(_, l)| l).unwrap_or_default();
            let mut v: Vec<(String, Option<i64>)> = l.iter().filter(|t| t.earned.is_some() && !t.auto_plat).map(|t| (t.id.clone(), t.earned)).collect(); v.sort(); v };
        let a = won();
        if a != vec![("A".to_string(), Some(t1))] { fails.push(format!("{}: won at first {a:?}", em.name)); continue; }
        // (B won while the game runs: the file changes, read again)
        w(&save, &em.two);
        let b = won();
        if b != vec![("A".to_string(), Some(t1)), ("B".to_string(), Some(t2))] { fails.push(format!("{}: won after {b:?}", em.name)); }
    }
    let _ = fs::remove_dir_all(&t);
    assert!(fails.is_empty(), "{} of {} emulators failed:\n{}", fails.len(), emus.len(), fails.join("\n"));
}

/// A PS3 disc image Game Recognition found in one RPCS3's game list, its shortcut starting
/// that RPCS3 (Minecraft, with "Little Big Planet 2"'s), while the RPCS3 Game Recognition
/// keeps is another one: its trophies are in the first one's dev_hdd0, found by the game's NP ID.
#[test]
fn a_disc_image_played_in_another_rpcs3() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _iso = crate::ps3::ISO_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = std::env::temp_dir().join(format!("maxmb_tiso_{}", std::process::id()));
    let _ = fs::remove_dir_all(&t);
    let p = |s: &str| t.join(s);
    crate::ps3::set_iso_cache(p("cache/ps3iso"));
    // the RPCS3 the game is played in (its trophies there, under a name of RPCS3's own), and the one kept
    let used = p("Little Big Planet 2"); w(&used.join("rpcs3.exe"), b"MZ");
    let tro = used.join("dev_hdd0/home/00000001/trophy/NPWR05636_00");
    w(&tro.join("TROPCONF.SFM"), "<trophyconf><title-name>MC PS3 Ed.</title-name><trophy id=\"000\" ttype=\"B\"><name>Taking Inventory</name></trophy></trophyconf>");
    w(&tro.join("TROPUSR.DAT"), tropusr(&[(0, 1_700_000_000)], 1));
    let kept = p("Uncharted 3"); w(&kept.join("rpcs3.exe"), b"MZ"); fs::create_dir_all(kept.join("dev_hdd0/home/00000001/trophy")).unwrap();
    let ctx = Ctx { tdir: p("cache/trophies"), sources: p("game_sources.json") };
    w(&ctx.sources, serde_json::json!({ "entries": [], "rpcs3": kept.join("rpcs3.exe").display().to_string() }).to_string());
    // the image (its files copied once, as Game Recognition does)
    let iso = p("Minecraft (USA).dec.iso");
    w(&iso, crate::iso::tests::make_iso(&[("PS3_GAME/PARAM.SFO", b"sfo"), ("PS3_GAME/TROPDIR/NPWR05636_00/TROPHY.TRP", b"trp")]));
    let _ = crate::ps3::iso_game(&iso);
    let gd = game(&t, "Minecraft", Some(serde_json::json!({ "title": "Minecraft: PlayStation®3 Edition", "console": "PS3", "titleId": "BLUS31426",
        "ps3Key": iso.display().to_string().replace('\\', "/"), "sourceDir": iso.display().to_string(), "launch": "Minecraft.xmbl" })));
    link(&gd.join("Minecraft.xmbl"), &used.join("rpcs3.exe"));
    let g = gref(&gd, "Minecraft: PlayStation®3 Edition", "Minecraft.xmbl");
    let nl = Lookups { ra_has: &|_| None, steam_find: &|_| None };
    let src = source_in(&ctx, &Accounts::default(), &g, &nl);
    assert_eq!(src, Some(Src::Rpcs3(tro.clone())), "the shortcut's RPCS3's trophy folder");
    let l = local_list(&ctx.tdir, &Accounts::default(), &g.title, src.as_ref().unwrap(), false).map(|(_, l)| l).unwrap();
    assert!(l.iter().any(|t| t.name == "Taking Inventory" && t.earned.is_some()));
    let _ = fs::remove_dir_all(&t);
}
