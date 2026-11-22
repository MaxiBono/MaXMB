//! Part of trophies.rs: its unit tests.

// RetroAchievements' recent achievements, as its answer gives them
#[test]
fn ra_recent_achievements() {
    let v: Value = serde_json::from_str(r#"[{"Date":"2026-11-14 20:00:00","AchievementID":123,"GameID":"55","Title":"A"},{"AchievementID":"124","GameID":55},{"AchievementID":"x"},{"GameID":9}]"#).unwrap();
    assert_eq!(ra_recent_of(&v), vec![("123".to_string(), 55), ("124".to_string(), 55)]);
    assert!(ra_recent_of(&serde_json::json!({"error": "nope"})).is_empty() && ra_recent_of(&Value::Null).is_empty());
}
// A key without an ID: the account signed in to Steam on this computer
#[test]
fn steam_without_a_key_or_an_id() {
    let vdf = "\"users\"\n{\n\t\"76561198000000001\"\n\t{\n\t\t\"AccountName\"\t\t\"old\"\n\t\t\"MostRecent\"\t\t\"0\"\n\t}\n\t\"76561198000000002\"\n\t{\n\t\t\"AccountName\"\t\t\"now\"\n\t\t\"PersonaName\"\t\t\"A \\\"quoted\\\" name\"\n\t\t\"MostRecent\"\t\t\"1\"\n\t}\n}\n";
    assert_eq!(local_id_from(vdf).as_deref(), Some("76561198000000002"));
    // (one account, never marked: that one; two, none marked: not known; nothing: not known)
    assert_eq!(local_id_from("\"users\"\n{\n\t\"76561198000000009\"\n\t{\n\t\t\"AccountName\"\t\t\"a\"\n\t}\n}").as_deref(), Some("76561198000000009"));
    assert_eq!(local_id_from(&vdf.replace("\"MostRecent\"\t\t\"1\"", "\"MostRecent\"\t\t\"0\"")), None);
    assert_eq!(local_id_from(""), None); assert_eq!(local_id_from("\"users\"\n{\n}"), None); assert_eq!(local_id_from("\u{0}\u{1}garbage \"MostRecent\" \"1\""), None);
}
use super::*;

// RPCS3 with its dev_hdd0 kept elsewhere (config\vfs.yml): its trophies found there
#[test]
fn rpcs3_with_its_dev_hdd0_elsewhere() {
    let root = std::env::temp_dir().join(format!("xmb-vfs-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let rp = root.join("RPCS3"); let hdd = root.join("PS3 Data").join("hdd");
    fs::create_dir_all(rp.join("config")).unwrap(); fs::write(rp.join("rpcs3.exe"), b"MZ").unwrap();
    fs::write(rp.join("config").join("vfs.yml"), format!("$(EmulatorDir): \"\"\n/dev_hdd0/: {}/\n/games/: $(EmulatorDir)games/\n", hdd.display().to_string().replace('\\', "/"))).unwrap();
    let tro = hdd.join("home").join("00000001").join("trophy").join("NPWR00001_00");
    fs::create_dir_all(&tro).unwrap(); fs::write(tro.join("TROPCONF.SFM"), "<trophyconf><title-name>Moved Game</title-name></trophyconf>").unwrap();
    let game = hdd.join("game").join("NPUB00001"); fs::create_dir_all(game.join("TROPDIR").join("NPWR00001_00")).unwrap();
    let sources = root.join("game_sources.json");
    fs::write(&sources, serde_json::json!({ "entries": [], "rpcs3": rp.join("rpcs3.exe").display().to_string() }).to_string()).unwrap();
    let ctx = Ctx { tdir: root.join("cache"), sources };
    // (the game in the moved dev_hdd0; another one, found by name, through the install)
    let key = game.join("USRDIR").join("EBOOT.BIN");
    let r = rpcs3_roots(&ctx, &key);
    assert_eq!(r.len(), 1, "{r:?}"); assert!(r[0].ends_with("hdd"));
    assert_eq!(rpcs3_dir(&ctx, &serde_json::json!({ "ps3Key": key })), Some(tro.clone()));
    assert_eq!(rpcs3_by_name(&rpcs3_roots(&ctx, &root.join("Elsewhere").join("x.exe")), "Moved Game"), Some(tro));
    let _ = fs::remove_dir_all(&root);
}
// A PS3 disc image: its NP ID and trophy list from the copy of its files
#[test]
fn a_disc_image_trophy_list() {
    let _iso = crate::ps3::ISO_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = std::env::temp_dir().join(format!("xmb-isotrp-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    crate::ps3::set_iso_cache(root.join("cache"));
    let img = crate::iso::tests::make_iso(&[("PS3_GAME/PARAM.SFO", b"x"), ("PS3_GAME/TROPDIR/NPWR07653_00/TROPHY.TRP", b"trp")]);
    fs::create_dir_all(&root).unwrap();
    let iso = root.join("Game.iso"); fs::write(&iso, img).unwrap();
    let _ = crate::ps3::iso_game(&iso);
    assert_eq!(np_comm_id(&iso).as_deref(), Some("NPWR07653_00"));
    let (np, f) = trp_near(&iso).unwrap();
    assert_eq!(np, "NPWR07653_00"); assert_eq!(fs::read(f).unwrap(), b"trp");
    let _ = fs::remove_dir_all(&root);
}
#[test]
fn trp_unpacked_and_names_matched() {
    // a TROPHY.TRP with TROPCONF.SFM and ICON0.PNG
    let conf = b"<?xml version=\"1.0\"?><trophyconf><title-name>Test Game</title-name><trophy id=\"000\" hidden=\"no\" ttype=\"B\"><name>First</name><detail>Do it</detail></trophy></trophyconf>";
    let icon = b"PNGDATA";
    let mut b = vec![0u8; 0x60 + 2 * 0x40];
    b[0..4].copy_from_slice(&0xDCA2_4D00u32.to_be_bytes());
    b[0x10..0x14].copy_from_slice(&2u32.to_be_bytes()); b[0x14..0x18].copy_from_slice(&0x40u32.to_be_bytes());
    let mut put = |i: usize, name: &str, data: &[u8], b: &mut Vec<u8>| {
        let off = b.len() as u64; b.extend_from_slice(data);
        let e = 0x60 + i * 0x40; b[e..e + name.len()].copy_from_slice(name.as_bytes());
        b[e + 32..e + 40].copy_from_slice(&off.to_be_bytes()); b[e + 40..e + 48].copy_from_slice(&(data.len() as u64).to_be_bytes());
    };
    put(0, "TROPCONF.SFM", conf, &mut b); put(1, "ICON0.PNG", icon, &mut b);
    let names: Vec<String> = trp_files(&b).into_iter().map(|(n, _)| n).collect();
    assert_eq!(names, vec!["TROPCONF.SFM", "ICON0.PNG"]);
    // (as a real one: its entries right after a 0x40-byte header, TROPCONF.SFM the first --
    // read from 0x60, it was skipped and the list never unpacked)
    let mut r = vec![0u8; 0x40 + 2 * 0x40];
    r[0..4].copy_from_slice(&0xDCA2_4D00u32.to_be_bytes());
    r[0x10..0x14].copy_from_slice(&2u32.to_be_bytes()); r[0x14..0x18].copy_from_slice(&0x40u32.to_be_bytes());
    for (i, (name, data)) in [("TROPCONF.SFM", &conf[..]), ("ICON0.PNG", &icon[..])].into_iter().enumerate() {
        let off = r.len() as u64; r.extend_from_slice(data);
        let e = 0x40 + i * 0x40; r[e..e + name.len()].copy_from_slice(name.as_bytes());
        r[e + 32..e + 40].copy_from_slice(&off.to_be_bytes()); r[e + 40..e + 48].copy_from_slice(&(data.len() as u64).to_be_bytes());
    }
    let names: Vec<String> = trp_files(&r).into_iter().map(|(n, _)| n).collect();
    assert_eq!(names, vec!["TROPCONF.SFM", "ICON0.PNG"]);
    let t = std::env::temp_dir().join(format!("maxmb-trp-{}", std::process::id()));
    let game = t.join("Game").join("PS3_GAME").join("TROPDIR").join("NPWR99999_00");
    fs::create_dir_all(&game).unwrap(); fs::write(game.join("TROPHY.TRP"), &b).unwrap();
    let (np, f) = trp_near(&t.join("Game").join("PS3_GAME").join("USRDIR").join("EBOOT.BIN")).unwrap();
    assert_eq!(np, "NPWR99999_00");
    let d = trp_dir(&t.join("cache"), &np, &f).unwrap();
    let l = rpcs3_set(&d).unwrap();
    assert_eq!((l.len(), l[0].name.as_str(), l[0].earned), (1, "First", None));
    assert!(d.join("ICON0.PNG").is_file());
    let _ = fs::remove_dir_all(&t);
    // editions and folder names
    assert!(edition_of("Mafia III", "Mafia III: Definitive Edition"));
    assert!(edition_of("Grand Theft Auto IV", "Grand Theft Auto IV: The Complete Edition"));
    assert!(!edition_of("Mafia III", "Mafia III: Faster, Baby!"));
    assert!(!edition_of("Mafia", "Mafia III"));
    let n = other_names("Grand Theft Auto IV", &[PathBuf::from("G:/Games/Grand Theft Auto IV - The Complete Edition"), PathBuf::from("G:/Games/x/bin")]);
    assert_eq!(n, vec!["Grand Theft Auto IV".to_string(), "Grand Theft Auto IV - The Complete Edition".to_string()]);
}
#[test]
fn saved_list_read_without_waiting_on_itself() {
    // (a list not known yet, then known: neither waits forever)
    begin("lock-test", &[]);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let a = known_or("/lock/test", || Some(TrophySet { folder: "/lock/test".into(), ..Default::default() }));
        let b = known_or("/lock/test", || None);
        let _ = tx.send((a.is_some(), b.is_some()));
    });
    assert_eq!(rx.recv_timeout(Duration::from_secs(5)).expect("locked forever"), (true, true));
}

fn kv_bytes() -> Vec<u8> {
    // { "123": { "stats": { "1": { "bits": { "0": { "name": "ACH_A", "display": { "name": { "english": "First" }, "hidden": "1" } } } } } } }
    let mut b = Vec::new();
    let s = |b: &mut Vec<u8>, t: u8, n: &str| { b.push(t); b.extend_from_slice(n.as_bytes()); b.push(0); };
    s(&mut b, 0, "123"); s(&mut b, 0, "stats"); s(&mut b, 0, "1"); s(&mut b, 0, "bits"); s(&mut b, 0, "0");
    s(&mut b, 1, "name"); b.extend_from_slice(b"ACH_A\0");
    s(&mut b, 0, "display"); s(&mut b, 0, "name"); s(&mut b, 1, "english"); b.extend_from_slice(b"First\0"); b.push(8);
    s(&mut b, 1, "hidden"); b.extend_from_slice(b"1\0"); b.push(8);
    b.extend_from_slice(&[8, 8, 8, 8, 8, 8]);
    b
}
#[test]
fn steam_local_files() {
    let sch = steam_local_schema(&kv_bytes(), "123");
    assert_eq!(sch.len(), 1);
    assert_eq!(sch[0].0, (1, 0));
    assert_eq!(sch[0].1.api, "ACH_A"); assert_eq!(sch[0].1.name, "First"); assert!(sch[0].1.hidden);
    // user stats: { "cache": { "1": { "data": 5, "AchievementTimes": { "0": 1700000000 } } } }
    let mut b = Vec::new();
    let s = |b: &mut Vec<u8>, t: u8, n: &str| { b.push(t); b.extend_from_slice(n.as_bytes()); b.push(0); };
    s(&mut b, 0, "cache"); s(&mut b, 0, "1"); s(&mut b, 2, "data"); b.extend_from_slice(&5i32.to_le_bytes());
    s(&mut b, 0, "AchievementTimes"); s(&mut b, 2, "0"); b.extend_from_slice(&1_700_000_000i32.to_le_bytes()); b.extend_from_slice(&[8, 8, 8, 8]);
    let u = steam_local_unlocks(&b);
    assert_eq!(u.get(&(1, 0)), Some(&1_700_000_000));
    assert_eq!(u.get(&(1, 2)), Some(&0));
    assert_eq!(u.len(), 2);
}
#[test]
fn tropusr_and_conf() {
    let mut b = vec![0u8; 48 + 32];
    b[0..4].copy_from_slice(&0x818F54ADu32.to_be_bytes());
    b[8..12].copy_from_slice(&1u32.to_be_bytes());
    let off = 80u64;
    b[48..52].copy_from_slice(&6u32.to_be_bytes()); b[52..56].copy_from_slice(&0x60u32.to_be_bytes());
    b[60..64].copy_from_slice(&2u32.to_be_bytes()); b[64..72].copy_from_slice(&off.to_be_bytes());
    for (i, (st, unix)) in [(1u32, 1_389_971_100i64), (0, 0)].iter().enumerate() {
        let mut e = vec![0u8; 0x70];
        e[0..4].copy_from_slice(&6u32.to_be_bytes()); e[4..8].copy_from_slice(&0x60u32.to_be_bytes());
        e[16..20].copy_from_slice(&(i as u32).to_be_bytes()); e[20..24].copy_from_slice(&st.to_be_bytes());
        let tick = (unix * 1_000_000 + 62_135_596_800_000_000) as u64;
        e[32..40].copy_from_slice(&tick.to_be_bytes());
        b.extend_from_slice(&e);
    }
    let won = parse_tropusr(&b);
    assert_eq!(won.len(), 1); assert_eq!(won.get(&0), Some(&1_389_971_100));
    let xml = r#"<?xml version="1.0"?><trophyconf><title-name>X</title-name><trophy id="000" hidden="no" ttype="P" pid="000"><name>Lord &amp; King</name><detail>All of them.</detail></trophy><trophy id="001" hidden="yes" ttype="b"><name>Two</name><detail>D</detail></trophy></trophyconf>"#;
    let c = parse_tropconf(xml);
    assert_eq!(c.len(), 2); assert_eq!(c[0].3, "Lord & King"); assert_eq!(c[0].1, "P"); assert!(c[1].2); assert_eq!(c[1].1, "B"); assert!(!c[0].5 && !c[1].5);
    // an add-on's trophies (in a group): told apart, listed after the game's own, marked in what the page gets
    let dlc = r#"<trophyconf><title-name>X</title-name><trophy id="000" hidden="no" ttype="P" pid="-1"><name>Plat</name><detail>d</detail></trophy><trophy id="001" hidden="no" ttype="B" pid="000" gid="000"><name>Base one</name><detail>d</detail></trophy><trophy id="002" hidden="no" ttype="B" pid="-1" gid="001"><name>Add-on one</name><detail>d</detail></trophy><trophy id="003" hidden="no" ttype="S" pid="000"><name>Base two</name><detail>d</detail></trophy><trophy id="004" hidden="no" ttype="G" pid="-1" gid="002"><name>Add-on two</name><detail>d</detail></trophy><group id="001"><name>Pack</name></group></trophyconf>"#;
    assert_eq!(parse_tropconf(dlc).iter().map(|t| t.5).collect::<Vec<_>>(), vec![false, false, true, false, true]);
    let d = std::env::temp_dir().join(format!("maxmb_dlc_{}", std::process::id()));
    fs::create_dir_all(&d).unwrap(); fs::write(d.join("TROPCONF.SFM"), dlc).unwrap();
    let set = rpcs3_set(&d).unwrap();
    assert_eq!(set.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["Plat", "Base one", "Base two", "Add-on one", "Add-on two"]);
    assert_eq!(set.iter().map(|t| t.addon).collect::<Vec<_>>(), vec![false, false, false, true, true]);
    assert!(serde_json::to_string(&set[3]).unwrap().contains("\"addon\":true"));
    let _ = fs::remove_dir_all(&d);
    // the Platinum the system adds: won with the game's own trophies, whatever an add-on's are
    let tr = |id: &str, e: Option<i64>, addon: bool| Trophy { id: id.into(), grade: "B".into(), earned: e, addon, ..Default::default() };
    let mut l = vec![tr("a", Some(10), false), tr("b", Some(30), false), tr("x", None, true)];
    add_platinum("G", &mut l);
    assert!(l[0].auto_plat && l[0].earned == Some(30));
    let mut l = vec![tr("a", Some(10), false), tr("b", None, false), tr("x", Some(99), true)];
    add_platinum("G", &mut l);
    assert!(l[0].auto_plat && l[0].earned.is_none());
    // (won on the day of the last of the game's own, not of an add-on's won later)
    let mut l = vec![tr("a", Some(10), false), tr("x", Some(99), true)];
    add_platinum("G", &mut l);
    assert_eq!(l[0].earned, Some(10));
}
#[test]
fn emulators() {
    let d = std::env::temp_dir().join(format!("maxmb_emu_{}", std::process::id()));
    fs::create_dir_all(&d).unwrap();
    let j = d.join("achievements.json");
    fs::write(&j, r#"{"ACH_WIN":{"earned":true,"earned_time":1700000001},"ACH_NO":{"earned":false,"earned_time":0},"ACH_S":{"earned":true,"earned_time":"5"}}"#).unwrap();
    let m = parse_emu(&j);
    assert_eq!(m.get("ACH_WIN"), Some(&1700000001)); assert_eq!(m.get("ACH_S"), Some(&5)); assert!(!m.contains_key("ACH_NO"));
    let i = d.join("achievements.ini");
    fs::write(&i, "[SteamAchievements]\nCount=2\n[ACH_1]\nAchieved=1\nUnlockTime=1600000000\n[ACH_2]\nAchieved=0\n").unwrap();
    let m = parse_emu(&i);
    assert_eq!(m.get("ACH_1"), Some(&1600000000)); assert!(!m.contains_key("ACH_2")); assert_eq!(m.len(), 1);
    fs::write(&i, "[Steam]\nAppID=1\n[AchievementsUnlockTimes]\nACH_X=1500000000\n[Achievements]\nACH_Y=1\n").unwrap();
    let m = parse_emu(&i);
    assert_eq!(m.get("ACH_X"), Some(&1500000000)); assert!(m.contains_key("ACH_Y"));
    fs::write(&i, "[ACH_H]\nState = 0101000000\nTime = 00F1536500\n").unwrap();
    let m = parse_emu(&i);
    assert!(m.contains_key("ACH_H"));
    fs::write(d.join("steam_appid.txt"), "480\n").unwrap();
    assert_eq!(steam_appid_near(&d).as_deref(), Some("480"));
    let _ = fs::remove_dir_all(&d);
}
#[test]
fn friend_levels_kept() {
    let v: Value = serde_json::json!({ "response": { "games": [{ "appid": 20, "playtime_forever": 5 }, { "appid": 10, "playtime_forever": 90 }, { "appid": 30, "playtime_forever": 0 }] } });
    let g = friend_games(&v).unwrap();
    assert_eq!(g, vec![("10".to_string(), 90), ("20".to_string(), 5)]);
    // (the same games and play times: the same signature; one played since: another)
    assert_eq!(friend_sig(&g), friend_sig(&[("10".into(), 90), ("20".into(), 5)]));
    assert_ne!(friend_sig(&g), friend_sig(&[("10".into(), 91), ("20".into(), 5)]));
    // (a private profile: no list of games)
    assert!(friend_games(&serde_json::json!({ "response": {} })).is_none());
    let k = FriendKept { level: Some(7), sig: friend_sig(&g), games: [("10".to_string(), (90, 300))].into_iter().collect(), v: KEPT_V, at: 0 };
    let back: FriendKept = serde_json::from_str(&serde_json::to_string(&k).unwrap()).unwrap();
    assert_eq!(back, k);
    // (found private: not asked about again for an hour; a count, or a kept file from before: asked)
    let p = FriendKept { level: None, sig: "private".into(), games: HashMap::new(), v: KEPT_V, at: 1_000_000 };
    assert!(kept_private_fresh(&p, 1_000_000 + 1800) && !kept_private_fresh(&p, 1_000_000 + PRIVATE_RECHECK));
    assert_eq!(PRIVATE_RECHECK, 3600, "an hour");
    assert!(!kept_private_fresh(&FriendKept { at: 0, ..p.clone() }, 1_000_000) && !kept_private_fresh(&k, 1_000_000));
    let old: FriendKept = serde_json::from_str(r#"{"level":null,"sig":"private","games":{},"v":2}"#).unwrap();
    assert_eq!(old.at, 0);
    // (their play time private: every game at 0 minutes -- all of them count, not none)
    let h: Value = serde_json::json!({ "response": { "games": [{ "appid": 20, "playtime_forever": 0 }, { "appid": 10, "playtime_forever": 0 }] } });
    assert_eq!(friend_games(&h).unwrap(), vec![]);
    assert_eq!(friend_time_hidden(&h).unwrap(), vec![("10".to_string(), 0), ("20".to_string(), 0)]);
    // (one game with play time: shown as usual; none at all: nothing hidden)
    assert!(friend_time_hidden(&v).is_none());
    assert!(friend_time_hidden(&serde_json::json!({ "response": { "games": [] } })).is_none());
    assert!(friend_time_hidden(&serde_json::json!({ "response": {} })).is_none());
    assert_eq!(HIDDEN_RECOUNT, 86_400, "a day");
}
#[test]
fn steam_signed_in_account() {
    assert_eq!(active_user_of("\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\\ActiveProcess\r\n    ActiveUser    REG_DWORD    0x4ae9c34\r\n").as_deref(), Some("76561198038817844"));
    assert_eq!(active_user_of("    ActiveUser    REG_DWORD    0x0\r\n"), None);
    assert_eq!(active_user_of("ERROR: The system was unable to find the specified registry key or value."), None);
    let vdf = "\"users\"\n{\n\t\"76561198000000001\"\n\t{\n\t\t\"AccountName\"\t\t\"a\"\n\t\t\"MostRecent\"\t\t\"0\"\n\t}\n\t\"76561198000000002\"\n\t{\n\t\t\"PersonaName\"\t\t\"Jos\u{e9}\"\n\t\t\"MostRecent\"\t\t\"1\"\n\t}\n}\n";
    assert_eq!(local_id_from(vdf).as_deref(), Some("76561198000000002"));
    // (names not in UTF-8: read anyway)
    let mut b = vdf.replace("Jos\u{e9}", "Jos").into_bytes(); b.extend_from_slice(&[0xE9, b'\n']);
    assert_eq!(local_id_from(&String::from_utf8_lossy(&b)).as_deref(), Some("76561198000000002"));
    // (Steam now: no "MostRecent", the signed-in one "AutoLogin" "1"; without it, the latest "timestamp")
    let now_vdf = |a1: &str, a2: &str| format!("\"users\"\n{{\n\t\"76561199000000011\"\n\t{{\n\t\t\"AccountName\"\t\t\"a\"\n\t\t\"AutoLogin\"\t\t\"{a1}\"\n\t\t\"timestamp\"\t\t\"1794759089\"\n\t}}\n\t\"76561199000000022\"\n\t{{\n\t\t\"AccountName\"\t\t\"b\"\n\t\t\"AutoLogin\"\t\t\"{a2}\"\n\t\t\"timestamp\"\t\t\"1708639949\"\n\t}}\n}}\n");
    assert_eq!(local_id_from(&now_vdf("1", "0")).as_deref(), Some("76561199000000011"));
    assert_eq!(local_id_from(&now_vdf("0", "1")).as_deref(), Some("76561199000000022"));
    assert_eq!(local_id_from(&now_vdf("0", "0")).as_deref(), Some("76561199000000011"));
}
#[test]
fn trophy_cache_kept_tidy() {
    let t = std::env::temp_dir().join(format!("mx_tcache_{}", std::process::id()));
    let _ = fs::remove_dir_all(&t);
    for d in ["sets/u1", "sets/u2", "icons", "schemas", "sources", "earned/u1", "accounts"] { fs::create_dir_all(t.join(d)).unwrap(); }
    let g = |f: &str| GameRef { folder: f.into(), title: f.into(), launch: String::new(), stamp: String::new() };
    let games = vec![g("D:/Games/here"), g("acct:steam:10")];
    let set = |folder: &str, icon: &str, troph: &str| { let mut s = TrophySet { folder: folder.into(), icon: icon.into(), ..Default::default() };
        s.trophies.push(Trophy { icon: troph.into(), ..Default::default() }); serde_json::to_string(&s).unwrap() };
    let ic = |n: &str| t.join("icons").join(n).display().to_string();
    fs::write(t.join("sets/u1").join(format!("{}.json", fnv("D:/Games/here"))), set("D:/Games/here", "D:/Games/here/icon.png", &ic("a.png"))).unwrap();
    fs::write(t.join("sets/u1").join(format!("{}.json", fnv("acct:steam:10"))), set("acct:steam:10", &ic("logo.png"), "")).unwrap();
    fs::write(t.join("sets/u1").join(format!("{}.json", fnv("D:/Games/gone"))), set("D:/Games/gone", "", &ic("gone.png"))).unwrap();
    fs::write(t.join("sets/u2").join("x.json"), set("E:/other", "", &ic("u2.png"))).unwrap();
    let old = std::time::SystemTime::now() - Duration::from_secs(40 * 86400);
    for n in ["a.png", "logo.png", "gone.png", "u2.png", "unused.png"] {
        let f = t.join("icons").join(n); fs::write(&f, b"x").unwrap(); fs::File::options().write(true).open(&f).unwrap().set_modified(old).unwrap();
    }
    fs::write(t.join("icons").join("fresh.png"), b"x").unwrap();
    for n in ["steam_1.json", "gog_client_2.txt"] { let f = t.join("schemas").join(n); fs::write(&f, b"{}").unwrap(); fs::File::options().write(true).open(&f).unwrap().set_modified(old).unwrap(); }
    fs::write(t.join("schemas").join("steam_3.json"), b"{}").unwrap(); fs::write(t.join("schemas").join("names.json"), b"{}").unwrap();
    fs::write(t.join("sources").join("u1.json"), serde_json::json!({ "D:/Games/here": {}, "D:/Games/gone": {} }).to_string()).unwrap();
    fs::write(t.join("earned/u1/r.json"), b"{}").unwrap(); fs::write(t.join("accounts/u1.json"), b"{}").unwrap(); fs::write(t.join("accounts/u1_off.json"), b"[]").unwrap();
    // (Delete Trophy Cache: everything read again by itself; never the trophies won, nor which account games are shown)
    let files = cache_files_in(&t);
    assert!(files.iter().any(|f| f.ends_with("accounts/u1.json")) && files.iter().any(|f| f.ends_with("icons/a.png")) && files.iter().any(|f| f.ends_with("sources/u1.json")));
    assert!(!files.iter().any(|f| f.ends_with("accounts/u1_off.json") || f.starts_with(t.join("earned"))));
    // (after a sync: the lists and sources of games gone, the pictures nobody's list shows, the store lists not read for a month)
    prune_in(&t, "u1", &games, true);
    let has = |p: &str| t.join(p).exists();
    assert!(has(&format!("sets/u1/{}.json", fnv("D:/Games/here"))) && !has(&format!("sets/u1/{}.json", fnv("D:/Games/gone"))) && has("sets/u2/x.json"));
    assert!(has("icons/a.png") && has("icons/logo.png") && has("icons/u2.png") && has("icons/fresh.png") && !has("icons/gone.png") && !has("icons/unused.png"));
    assert!(!has("schemas/steam_1.json") && !has("schemas/gog_client_2.txt") && has("schemas/steam_3.json") && has("schemas/names.json"));
    let src: Value = serde_json::from_str(&fs::read_to_string(t.join("sources/u1.json")).unwrap()).unwrap();
    assert!(src.get("D:/Games/here").is_some() && src.get("D:/Games/gone").is_none());
    assert!(has("earned/u1/r.json") && has("accounts/u1_off.json"));
    // (once a day at most)
    fs::write(t.join("icons").join("later.png"), b"x").unwrap(); fs::File::options().write(true).open(t.join("icons").join("later.png")).unwrap().set_modified(old).unwrap();
    prune_in(&t, "u1", &games, true);
    assert!(has("icons/later.png"));
    let _ = fs::remove_dir_all(&t);
}
#[test]
fn steam_names_kept() {
    let d = std::env::temp_dir().join(format!("mx_names_{}", std::process::id()));
    let _ = fs::create_dir_all(d.join("schemas"));
    fs::write(d.join("schemas").join("names.json"), serde_json::json!({ "hollow knight": { "id": "367520", "at": now() }, "nothing here": { "id": "", "at": now() },
        "old miss": { "id": "", "at": now() - 8 * 86400 } }).to_string()).unwrap();
    assert_eq!(steam_name_kept(&d, "Hollow Knight"), Some(Some("367520".into())));
    assert_eq!(steam_name_kept(&d, "Nothing Here"), Some(None));
    assert_eq!(steam_name_kept(&d, "Old Miss"), None);
    assert_eq!(steam_name_kept(&d, "Never Asked"), None);
    let _ = fs::remove_dir_all(&d);
}
#[test]
fn gog_products_as_account_games() {
    let v = serde_json::json!([
        { "id": 1207658924, "title": "Unreal Tournament 2004 Editor's Choice Edition", "game_type": "game", "images": { "logo2x": "//images-1.gog-statics.com/abc_glx_logo_2x.jpg" } },
        { "id": 2, "title": "A Soundtrack", "game_type": "dlc", "images": {} },
        { "id": 3, "title": "", "game_type": "game" }]);
    let l = gog_products_of(&v, "20000");
    assert_eq!(l.len(), 1);
    assert_eq!(l[0].folder, "acct:gog:1207658924"); assert_eq!(l[0].store, "gog"); assert_eq!(l[0].has, None);
    assert_eq!(l[0].art, "https://images-1.gog-statics.com/abc_glx_logo_2x.jpg"); assert_eq!(l[0].stamp, "20000");
    assert!(icon_host_ok(&l[0].art));
}
#[test]
fn account_games_parts() {
    assert!(is_acct("acct:steam:10")); assert!(!is_acct("D:/Games/x"));
    assert_eq!(acct_parts("acct:epic:abc"), Some(("epic", "abc")));
    assert_eq!(acct_src("acct:steam:10"), Some(Src::Steam("10".into(), vec![])));
    assert_eq!(acct_src("acct:gog:7"), Some(Src::Gog("7".into(), vec![])));
    assert_eq!(acct_src("acct:ra:5"), Some(Src::Ra)); assert_eq!(acct_src("acct:xx:5"), None);
    // (the Steam ID alone: no games asked for -- Steam shows them only to someone signed in --, Steam Friends only)
    assert_eq!(steam_owned(&Accounts { steam_id: "76561199000000011".into(), ..Default::default() }).map(|l| l.len()), Some(0));
    assert_eq!(num_s(&serde_json::json!(10)), "10"); assert_eq!(num_s(&serde_json::json!("7")), "7");
    // (an account game's signature changes with what its store says, not every 10 minutes)
    let acc = Accounts { steam_id: "7656".into(), ..Default::default() };
    let g = |stamp: &str| GameRef { folder: "acct:steam:10".into(), title: "CS".into(), launch: String::new(), stamp: stamp.into() };
    let src = Src::Steam("10".into(), vec![]);
    assert_ne!(sig_for(&acc, &g("5:1"), &src), sig_for(&acc, &g("6:2"), &src));
    assert!(!asks_for(&acc, &g("5:1"), &src));
}
#[test]
fn more_emulators_and_record() {
    let d = std::env::temp_dir().join(format!("maxmb_emu2_{}", std::process::id()));
    let _ = fs::remove_dir_all(&d); fs::create_dir_all(&d).unwrap();
    // 3DM: [State] + [Time]; an unwon one with a zero time isn't won
    let i = d.join("achievements.ini");
    fs::write(&i, "[State]\nACH_A = 0101\nACH_B = 0000\n[Time]\nACH_A = 00F15365\nACH_B = 00000000\n").unwrap();
    let m = parse_emu(&i);
    assert!(m.contains_key("ACH_A")); assert!(!m.contains_key("ACH_B")); assert_eq!(m.len(), 1);
    // Hoodlum / DARKSiDERS: [Achievements] + [AchievementsUnlockTimes]
    fs::write(&i, "[Achievements]\nA1=1\nA2=0\n[AchievementsUnlockTimes]\nA1=1600000000\nA2=0\n").unwrap();
    let m = parse_emu(&i);
    assert_eq!(m.get("A1"), Some(&1600000000)); assert_eq!(m.len(), 1);
    // CreamAPI (a time missing its last digits)
    let c = d.join("CreamAPI.Achievements.cfg");
    fs::write(&c, "[ACH_C]\nachieved=true\nunlocktime=1700000\n[ACH_D]\nachieved=false\nunlocktime=0\n").unwrap();
    let m = parse_emu(&c);
    assert_eq!(m.get("ACH_C"), Some(&1700000000)); assert_eq!(m.len(), 1);
    // SmartSteamEmu's stats.bin: names by CRC32
    let mut b = 2i32.to_le_bytes().to_vec();
    for (n, v, t) in [("ACH_WIN", 1i32, 1650000000i32), ("ACH_LOSE", 0, 0)] {
        let mut e = vec![0u8; 24];
        e[0..4].copy_from_slice(&crc32(n).to_le_bytes()); e[8..12].copy_from_slice(&t.to_le_bytes()); e[20..24].copy_from_slice(&v.to_le_bytes());
        b.extend(e);
    }
    let sb = d.join("stats.bin"); fs::write(&sb, &b).unwrap();
    let m = parse_emu(&sb);
    assert_eq!(m.len(), 1); assert_eq!(m.get(&format!("{SSE_CRC}{:08x}", crc32("ACH_WIN"))), Some(&1650000000));
    assert_eq!(crc32("The quick brown fox jumps over the lazy dog"), 0x414fa339);
    // ALI213 (SaveType 0: Profile\<player>\Stats above the game's program)
    let game = d.join("Game").join("Bin"); fs::create_dir_all(&game).unwrap();
    fs::write(game.join("ALI213.ini"), "[Settings]\nAppID = 1234\nPlayerName = Maxi\nSaveType = 0\n").unwrap();
    let stats = d.join("Game").join("Profile").join("Maxi").join("Stats"); fs::create_dir_all(&stats).unwrap();
    assert_eq!(emu_ini_dirs("1234", &d.join("Game"), &[]), vec![stats.clone()]);
    assert!(emu_ini_dirs("999", &d.join("Game"), &[]).is_empty());
    // Hoodlum (UserDataFolder = .)
    fs::write(game.join("hlm.ini"), "[GameSettings]\nAppId=1234\nUserDataFolder=.\n").unwrap();
    let us = d.join("Game").join("SteamEmu").join("UserStats"); fs::create_dir_all(&us).unwrap();
    fs::write(us.join("achiev.ini"), "[Achievements]\nX=1\n").unwrap();
    assert!(emu_files("1234", &[d.join("Game")]).iter().any(|p| p.ends_with("achiev.ini")));
    // TENOKE: SteamData next to the game's program, its achievements.toml
    let tk = d.join("Game").join("SteamData").join("user");
    fs::create_dir_all(&tk).unwrap();
    fs::write(tk.join("achievements.toml"), "# TENOKE workshop runtime state - regenerated automatically\n# achievement 'time' field is UTC Unix epoch (seconds)\n\n[ACHIEVEMENTS]\n\"ALL_QUESTS_HOMELANDA\" = {unlocked = true, time = 1794821000, unlocked_at_iso = \"2026-11-16T09:23:20Z\"}\n\"MAKE_TOAST\" = {unlocked = false, time = 0, unlocked_at_iso = \"\"}\n").unwrap();
    let f = emu_files("1234", &[d.join("Game")]).into_iter().find(|p| p.ends_with("achievements.toml")).expect("TENOKE's file found");
    let won = parse_emu(&f);
    assert_eq!(won.get("ALL_QUESTS_HOMELANDA"), Some(&1794821000)); assert!(!won.contains_key("MAKE_TOAST"));
    // (TOEM 2's own: SteamData\user_stats.ini, Windows line ends, a stat; nothing won yet, then one)
    let us = d.join("Game").join("SteamData").join("user_stats.ini");
    fs::write(&us, "# achievement 'time' field is UTC Unix epoch (seconds)\r\n[STATS]\r\n\"leave_your_mark_progress\" = 1\r\n\r\n[ACHIEVEMENTS]\r\n").unwrap();
    assert!(emu_files("1234", &[d.join("Game")]).iter().any(|p| p == &us));
    assert!(parse_emu(&us).is_empty());
    fs::write(&us, "[STATS]\r\n\"leave_your_mark_progress\" = 1\r\n\r\n[ACHIEVEMENTS]\r\n\"LEAVE_YOUR_MARK\" = {unlocked = true, time = 1794923695, unlocked_at_iso = \"2026-11-17T13:48:15Z\"}\r\n").unwrap();
    let won = parse_emu(&us);
    assert_eq!(won.get("LEAVE_YOUR_MARK"), Some(&1794923695)); assert_eq!(won.len(), 1);
    // (its app ID: tenoke.ini in the Unity game's Plugins folder, "id = 3507100 # the game's name")
    // (in a folder of its own: the one above has the other emulators' .ini files, with app 1234)
    let pl = d.join("Tenoke").join("Game_Data").join("Plugins").join("x86_64"); fs::create_dir_all(&pl).unwrap();
    fs::write(pl.join("tenoke.ini"), "[TENOKE]\r\n# appid\r\nid = 3507100 # HIDDEN CATS 3: Steampunk\r\n\r\n# account id\r\naccount = 0x1234\r\n").unwrap();
    assert_eq!(steam_appid_near(&d.join("Tenoke")).as_deref(), Some("3507100"));
    assert_eq!(expand_env("%MAXMB_NOPE%\\x"), "%MAXMB_NOPE%\\x");
    // the record: kept won, an account's forgotten with the account
    let acc = Accounts { steam_id: "7656".into(), ..Default::default() };
    let tr = |id: &str, e: Option<i64>| Trophy { id: id.into(), grade: "B".into(), earned: e, ..Default::default() };
    let mut r = Record::default();
    let mut l = vec![tr("A", Some(10)), tr("B", Some(20)), tr("C", None)];
    record_apply(&mut r, &acc, "steam", &["b".to_string()].into_iter().collect(), &mut l);
    assert_eq!(r.won["A"], Won { t: 10, by: String::new() }); assert_eq!(r.won["B"].by, "steam:7656"); assert!(!r.won.contains_key("C"));
    // the emulator's file gone: still won
    let mut l = vec![tr("A", None), tr("B", None), tr("C", None)];
    record_apply(&mut r, &acc, "steam", &HashSet::new(), &mut l);
    assert_eq!((l[0].earned, l[1].earned, l[2].earned), (Some(10), Some(20), None));
    // another Steam ID (or none): the account's trophy forgotten, this computer's kept
    let other = Accounts::default();
    let mut l = vec![tr("A", None), tr("B", None)];
    record_apply(&mut r, &other, "steam", &HashSet::new(), &mut l);
    assert_eq!((l[0].earned, l[1].earned), (Some(10), None)); assert_eq!(r.won.len(), 1);
    let _ = fs::remove_dir_all(&d);
}
#[test]
fn grades_platinum_times() {
    assert_eq!((level_for(0), level_for(199), level_for(200), level_for(2400), level_for(16000), level_for(128000), level_for(880000)), (1, 1, 2, 5, 12, 26, 100));
    assert_eq!(grade_for(Some(3.0)), "G"); assert_eq!(grade_for(Some(10.0)), "S"); assert_eq!(grade_for(Some(40.0)), "B"); assert_eq!(grade_for(None), "B");
    let t = |id: &str, e: Option<i64>| Trophy { id: id.into(), grade: "B".into(), earned: e, ..Default::default() };
    let mut l = vec![t("a", Some(10)), t("b", None)];
    add_platinum("Hollow Knight", &mut l);
    assert_eq!(l[0].name, "Hollow Knight Platinum Trophy"); assert_eq!(l[0].desc, "Unlock all Hollow Knight trophies");
    // (the game renamed in the system: its kept list's name, and the added Platinum's words, follow)
    let mut set = TrophySet { folder: "/g/hk".into(), title: "Hollow Knight".into(), trophies: l.clone(), ..Default::default() };
    retitle(&mut set, "HK: Voidheart");
    assert_eq!(set.title, "HK: Voidheart"); assert_eq!(set.trophies[0].name, "HK: Voidheart Platinum Trophy"); assert_eq!(set.trophies[0].desc, "Unlock all HK: Voidheart trophies");
    assert!(set.trophies[1..].iter().zip(&l[1..]).all(|(a, b)| a.name == b.name && a.desc == b.desc));
    assert_eq!(l[0].earned, None);
    l[2].earned = Some(20);
    add_platinum("Hollow Knight", &mut l);
    assert_eq!(l.len(), 3); assert_eq!(l[0].earned, Some(20));
    let old = TrophySet { trophies: vec![t("a", Some(10)), t("b", None)], ..Default::default() };
    let new = TrophySet { trophies: l.clone(), ..Default::default() };
    let w = newly_won(&old, &new);
    assert_eq!(w.len(), 2); assert_eq!(w[0].id, "b"); assert_eq!(w[1].id, "__platinum");
    assert_eq!(ra_time("1970-01-02 00:00:01"), Some(86401));
    assert_eq!(iso_time("2014-01-17T15:05:00.000Z"), Some(1389971100));
    assert_eq!(xml_unescape("a&amp;b&#65;&lt;"), "a&bA<");
    assert!(icon_host_ok("https://cdn.akamai.steamstatic.com/a.jpg") && icon_host_ok("https://media.retroachievements.org/Badge/1.png"));
    assert!(!icon_host_ok("https://evil.example/x.png") && !icon_host_ok("https://steamstatic.com.evil.io/x") && !icon_host_ok("http://cdn.akamai.steamstatic.com/a"));
}
