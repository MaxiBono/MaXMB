//! Part of trophies.rs. Steam: Steam's own files (appcache\stats), its public lists, the Steam
//! emulators' files, and a Steam game's list put together (steam_set).

use super::*;


pub(super) static STEAM_ROOT: Mutex<Option<Option<PathBuf>>> = Mutex::new(None);
/// Steam's own folder (Windows' record of it, or its usual place).
pub fn steam_root() -> Option<PathBuf> {
    let mut g = STEAM_ROOT.lock().unwrap();
    if let Some(r) = g.clone() { return r; }
    #[allow(unused_mut)]
    let mut found = None;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(o) = std::process::Command::new("reg").args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"]).creation_flags(0x0800_0000).output() {
            let t = String::from_utf8_lossy(&o.stdout);
            if let Some(p) = t.lines().find(|l| l.contains("SteamPath")).and_then(|l| l.split("REG_SZ").nth(1)) {
                let p = PathBuf::from(p.trim()); if p.is_dir() { found = Some(p); }
            }
        }
        // (installed for all users: the machine's record)
        if found.is_none() {
            if let Ok(o) = std::process::Command::new("reg").args(["query", r"HKLM\SOFTWARE\WOW6432Node\Valve\Steam", "/v", "InstallPath"]).creation_flags(0x0800_0000).output() {
                let t = String::from_utf8_lossy(&o.stdout);
                if let Some(p) = t.lines().find(|l| l.contains("InstallPath")).and_then(|l| l.split("REG_SZ").nth(1)) {
                    let p = PathBuf::from(p.trim()); if p.is_dir() { found = Some(p); }
                }
            }
        }
        if found.is_none() {
            for v in ["ProgramFiles(x86)", "ProgramFiles"] {
                if let Ok(p) = std::env::var(v) { let p = PathBuf::from(p).join("Steam"); if p.is_dir() { found = Some(p); break; } }
            }
        }
    }
    *g = Some(found.clone());
    found
}
/// steam_appid.txt / steam_emu.ini... next to an offline copy's program.
pub(super) fn steam_appid_near(dir: &Path) -> Option<String> {
    let digits = |s: &str| { let d: String = s.trim().chars().take_while(|c| c.is_ascii_digit()).collect(); (!d.is_empty() && d != "0").then_some(d) };
    let mut dirs = vec![dir.to_path_buf()];
    if let Ok(rd) = fs::read_dir(dir) { for e in rd.flatten() { if e.path().is_dir() { dirs.push(e.path()); } } }
    for d in dirs.iter().take(64) {
        for f in ["steam_appid.txt", "steam_settings/steam_appid.txt"] {
            if let Some(id) = fs::read_to_string(d.join(f)).ok().and_then(|t| digits(&t)) { return Some(id); }
        }
        // (TENOKE: tenoke.ini next to its steam_api64.dll -- in a Unity game's <name>_Data\Plugins\x86_64 --, "id = <app ID>")
        for f in ["tenoke.ini", "Plugins/x86_64/tenoke.ini", "Plugins/tenoke.ini"] {
            if let Ok(t) = fs::read_to_string(d.join(f)) {
                if let Some(id) = t.lines().filter_map(|l| l.trim().split_once('=')).find(|(k, _)| k.trim().eq_ignore_ascii_case("id")).and_then(|(_, v)| digits(v)) { return Some(id); }
            }
        }
        // (the emulators' own .ini: "AppId = <app ID>" -- ALI213, Hoodlum, DARKSiDERS and the others
        // that keep their files by it, see emu_ini_dirs --; OnlineFix: "RealAppId", its "FakeAppId"
        // being Spacewar's)
        for f in ["steam_emu.ini", "steam_api.ini", "cream_api.ini", "ColdClientLoader.ini", "SmartSteamEmu.ini",
                  "ALI213.ini", "valve.ini", "SteamConfig.ini", "hlm.ini", "ds.ini", "OnlineFix.ini"] {
            if let Ok(t) = fs::read_to_string(d.join(f)) {
                for l in t.lines() {
                    let l = l.trim();
                    if let Some((k, v)) = l.split_once('=') {
                        if k.trim().eq_ignore_ascii_case("appid") || k.trim().eq_ignore_ascii_case("realappid") { if let Some(id) = digits(v.split(" ;").next().unwrap_or("")) { return Some(id); } }
                    }
                }
            }
        }
    }
    None
}

// Steam's binary KeyValues (appcache\stats\*.bin)
#[derive(Debug, Clone)]
pub(super) enum Kv { Map(Vec<(String, Kv)>), Str(String), Int(i64), Float(f32) }
impl Kv {
    fn get(&self, k: &str) -> Option<&Kv> { if let Kv::Map(m) = self { m.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v) } else { None } }
    fn str(&self) -> Option<String> { match self { Kv::Str(s) => Some(s.clone()), Kv::Int(i) => Some(i.to_string()), _ => None } }
    fn int(&self) -> Option<i64> { match self { Kv::Int(i) => Some(*i), Kv::Str(s) => s.trim().parse().ok(), Kv::Float(f) => Some(*f as i64), _ => None } }
    fn entries(&self) -> &[(String, Kv)] { if let Kv::Map(m) = self { m } else { &[] } }
}
pub(super) fn kv_parse(b: &[u8], i: &mut usize, depth: usize) -> Vec<(String, Kv)> {
    let mut out = Vec::new();
    // (a file cut short ends inside a name or a value: read as far as it goes, never past its end)
    let cstr = |i: &mut usize| -> String { let s = (*i).min(b.len()); *i = s; while *i < b.len() && b[*i] != 0 { *i += 1; } let r = String::from_utf8_lossy(&b[s..*i]).into_owned(); *i += 1; r };
    while *i < b.len() && depth < 32 {
        let t = b[*i]; *i += 1;
        if t == 8 || t == 0x0B { break; }
        let name = cstr(i);
        let rd = |i: &mut usize, n: usize| -> Option<&[u8]> { let s = b.get(*i..*i + n)?; *i += n; Some(s) };
        let v = match t {
            0 => Kv::Map(kv_parse(b, i, depth + 1)),
            1 => Kv::Str(cstr(i)),
            2 | 4 | 6 => match rd(i, 4) { Some(s) => Kv::Int(i32::from_le_bytes(s.try_into().unwrap()) as i64), None => break },
            3 => match rd(i, 4) { Some(s) => Kv::Float(f32::from_le_bytes(s.try_into().unwrap())), None => break },
            7 | 0x0A => match rd(i, 8) { Some(s) => Kv::Int(i64::from_le_bytes(s.try_into().unwrap())), None => break },
            5 => { while *i + 1 < b.len() && !(b[*i] == 0 && b[*i + 1] == 0) { *i += 2; } *i += 2; Kv::Str(String::new()) }
            _ => break,
        };
        out.push((name, v));
    }
    out
}
pub(super) fn kv_root(b: &[u8]) -> Kv { let mut i = 0; Kv::Map(kv_parse(b, &mut i, 0)) }

#[derive(Clone, Default, Debug)]
pub(super) struct SteamAch { pub(super) api: String, pub(super) name: String, pub(super) desc: String, pub(super) hidden: bool, pub(super) icon: String, pub(super) pct: Option<f32> }

/// UserGameStatsSchema_<appid>.bin: the achievements by (stat, bit), with their names.
pub(super) fn steam_local_schema(b: &[u8], appid: &str) -> Vec<((i64, i64), SteamAch)> {
    let root = kv_root(b);
    let mut out = Vec::new();
    fn find_stats<'a>(k: &'a Kv, out: &mut Vec<&'a Kv>) { for (n, v) in k.entries() { if n.eq_ignore_ascii_case("stats") { out.push(v); } else if matches!(v, Kv::Map(_)) { find_stats(v, out); } } }
    let mut stats = Vec::new(); find_stats(&root, &mut stats);
    for st in stats {
        for (sid, s) in st.entries() {
            let Ok(sid) = sid.parse::<i64>() else { continue };
            let Some(bits) = s.get("bits") else { continue };
            for (bit, a) in bits.entries() {
                let Ok(bit) = bit.parse::<i64>() else { continue };
                let api = a.get("name").and_then(|v| v.str()).unwrap_or_default();
                let d = a.get("display");
                let loc = |k: &str| d.and_then(|d| d.get(k)).and_then(|n| n.get("english").or_else(|| n.entries().first().map(|(_, v)| v))).and_then(|v| v.str()).unwrap_or_default();
                let hidden = d.and_then(|d| d.get("hidden")).and_then(|v| v.int()).unwrap_or(0) != 0;
                let icon = d.and_then(|d| d.get("icon")).and_then(|v| v.str()).filter(|s| !s.is_empty())
                    .map(|i| format!("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/{appid}/{i}")).unwrap_or_default();
                out.push(((sid, bit), SteamAch { api, name: loc("name"), desc: loc("desc"), hidden, icon, pct: None }));
            }
        }
    }
    out
}
/// UserGameStats_<account>_<appid>.bin: the won (stat, bit)s and when.
pub(super) fn steam_local_unlocks(b: &[u8]) -> HashMap<(i64, i64), i64> {
    let mut out = HashMap::new();
    fn walk(k: &Kv, out: &mut HashMap<(i64, i64), i64>) {
        for (n, v) in k.entries() {
            if let (Ok(sid), Some(data)) = (n.parse::<i64>(), v.get("data").and_then(|d| d.int())) {
                let times = v.get("AchievementTimes");
                for bit in 0..32i64 {
                    if data >> bit & 1 == 1 {
                        let t = times.and_then(|t| t.get(&bit.to_string())).and_then(|x| x.int()).unwrap_or(0);
                        out.insert((sid, bit), t);
                    }
                }
            } else if matches!(v, Kv::Map(_)) { walk(v, out); }
        }
    }
    walk(&kv_root(b), &mut out);
    out
}
pub(super) fn steam_stats_dir() -> Option<PathBuf> { Some(steam_root()?.join("appcache").join("stats")) }
/// The Steam ID of the account signed in to Steam on this computer (Steam's own
/// config\loginusers.vdf: the one marked as the most recent, else the only one listed).
pub fn steam_local_id() -> Option<String> {
    // (asked often -- every account read --: the answer kept for half a minute, a miss written in the log once a minute)
    static KEPT: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);
    if let Some((at, id)) = KEPT.lock().unwrap().as_ref() { if at.elapsed() < Duration::from_secs(30) { return id.clone(); } }
    // (the account signed in to Steam right now: Windows' record of Steam's running session)
    let id = steam_active_user().or_else(|| {
        // (else the one last signed in, from Steam's own list; read whatever its names are written in)
        steam_root().and_then(|r| fs::read(r.join("config").join("loginusers.vdf")).ok()).and_then(|b| local_id_from(&String::from_utf8_lossy(&b)))
    });
    if id.is_none() {
        static SAID: Mutex<Option<Instant>> = Mutex::new(None);
        let mut s = SAID.lock().unwrap();
        if s.map(|t| t.elapsed() >= Duration::from_secs(60)).unwrap_or(true) {
            *s = Some(Instant::now());
            crate::log::line("WARN", "steam", &format!("no Steam account found on this computer (Steam's folder: {})", steam_root().map(|p| p.display().to_string()).unwrap_or_else(|| "not found".into())));
        }
    }
    *KEPT.lock().unwrap() = Some((Instant::now(), id.clone()));
    id
}
/// The Steam account signed in now (HKCU\Software\Valve\Steam\ActiveProcess: ActiveUser, its account
/// number; 0 when nobody is): its Steam ID.
pub(super) fn steam_active_user() -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let o = std::process::Command::new("reg").args(["query", r"HKCU\Software\Valve\Steam\ActiveProcess", "/v", "ActiveUser"]).creation_flags(0x0800_0000).output().ok()?;
        return active_user_of(&String::from_utf8_lossy(&o.stdout));
    }
    #[allow(unreachable_code)]
    None
}
/// reg's answer ("ActiveUser    REG_DWORD    0x1a2b3c4d") as a Steam ID.
pub(super) fn active_user_of(t: &str) -> Option<String> {
    let v = t.lines().find(|l| l.contains("ActiveUser"))?.split("REG_DWORD").nth(1)?.trim().trim_start_matches("0x").to_string();
    let n = u64::from_str_radix(&v, 16).ok().filter(|n| *n > 0)?;
    Some((76561197960265728u64 + n).to_string())
}
/// The account Steam's loginusers.vdf marks as the one signed in: "MostRecent" "1"
/// (older Steam), else "AutoLogin" "1" (Steam now), else the latest "timestamp",
/// else the only one listed.
pub(super) fn local_id_from(text: &str) -> Option<String> {
    let mut accts: Vec<(String, bool, bool, i64)> = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split('"').collect();
        // ("7656119…" alone on its line: an account; its keys inside it)
        if parts.len() == 3 && parts[1].len() == 17 && parts[1].starts_with("7656") && parts[1].chars().all(|c| c.is_ascii_digit()) {
            accts.push((parts[1].to_string(), false, false, 0));
        } else if parts.len() >= 5 {
            let Some(a) = accts.last_mut() else { continue };
            let (k, v) = (parts[1].to_lowercase(), parts[3]);
            match k.as_str() { "mostrecent" => a.1 = v == "1", "autologin" => a.2 = v == "1", "timestamp" => a.3 = v.trim().parse().unwrap_or(0), _ => {} }
        }
    }
    if let Some(a) = accts.iter().find(|a| a.1) { return Some(a.0.clone()); }
    let auto: Vec<&(String, bool, bool, i64)> = accts.iter().filter(|a| a.2).collect();
    if auto.len() == 1 { return Some(auto[0].0.clone()); }
    if accts.len() == 1 { return Some(accts[0].0.clone()); }
    accts.iter().filter(|a| a.3 > 0).max_by_key(|a| a.3).map(|a| a.0.clone())
}
pub(super) fn steam_user_file(appid: &str, steam_id: &str) -> Option<PathBuf> {
    let dir = steam_stats_dir()?;
    if let Ok(id) = steam_id.parse::<u64>() {
        let acc = id.saturating_sub(76561197960265728);
        let p = dir.join(format!("UserGameStats_{acc}_{appid}.bin"));
        if p.is_file() { return Some(p); }
    }
    let suffix = format!("_{appid}.bin");
    fs::read_dir(&dir).ok()?.flatten().map(|e| e.path())
        .filter(|p| p.file_name().map(|n| { let n = n.to_string_lossy(); n.starts_with("UserGameStats_") && n.ends_with(&suffix) }).unwrap_or(false))
        .max_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok())
}

/// The files Steam emulators keep their won achievements in (SuccessStory's
/// SteamEmulators.cs, ported; the places and names Achievement Watcher looks
/// in added: CreamAPI, SmartSteamEmu's stats.bin, ALI213, Hoodlum, DARKSiDERS,
/// RLD!/3DM, the Catherine-style steam_api.ini, a moved Documents folder).
pub(super) fn emu_files(appid: &str, dirs: &[PathBuf]) -> Vec<PathBuf> {
    let env = |v: &str| std::env::var(v).ok().map(PathBuf::from);
    // (the names an emulator's file can have inside its game's folder)
    const NAMES: [&str; 11] = ["achievements.json", "achievements.ini", "Achievements.ini", "achiev.ini", "stats.ini", "Achievements.Bin",
        "achieve.dat", "stats/achievements.ini", "stats/CreamAPI.Achievements.cfg", "stats.bin", "Stats/achievements.ini"];
    let mut v = Vec::new();
    let in_dir = |d: &Path, v: &mut Vec<PathBuf>| {
        if !d.is_dir() { return; }
        for sub in [PathBuf::new(), Path::new("remote").join(appid), "Stats".into(), Path::new("SteamEmu").join("UserStats"), "SteamEmu".into()] {
            let s = d.join(sub); if !s.is_dir() { continue; }
            for n in NAMES { v.push(s.join(n)); }
        }
    };
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Some(a) = env("APPDATA") {
        for g in ["Goldberg SteamEmu Saves", "GSE Saves", "SmartSteamEmu", "EMPRESS", "CreamAPI"] { bases.push(a.join(g)); }
        bases.push(a.join("Steam").join("CODEX"));
    }
    if let Some(p) = env("PUBLIC") {
        let docs = p.join("Documents");
        for g in ["CODEX", "RUNE", "EMPRESS"] { bases.push(docs.join("Steam").join(g)); }
        bases.push(docs.join("EMPRESS")); bases.push(docs.join("OnlineFix"));
    }
    if let Some(l) = env("LOCALAPPDATA") { bases.push(l.join("SKIDROW")); }
    let mut docs: Vec<PathBuf> = documents_dir().into_iter().collect();
    if let Some(h) = env("USERPROFILE") { let d = h.join("Documents"); if !docs.contains(&d) { docs.push(d); } }
    for d in &docs { for g in ["SKIDROW", "SkidRow", "DARKSiDERS"] { bases.push(d.join(g)); } }
    if let Some(pd) = env("ProgramData") {
        // (RLD! / 3DM: %ProgramData%\Steam\<any>\<appid>)
        if let Ok(rd) = fs::read_dir(pd.join("Steam")) { for e in rd.flatten() { bases.push(e.path()); } }
    }
    for b in &bases { in_dir(&b.join(appid), &mut v); }
    // (TENOKE set to keep its files in the user's folder: %APPDATA%\TENOKE\<app ID>)
    if let Some(a) = env("APPDATA") { tenoke_files(&a.join("TENOKE").join(appid), 0, &mut v); }
    for d in dirs {
        // Goldberg's saves kept in the game's own folder (steam_settings\local_save.txt)
        if let Ok(t) = fs::read_to_string(d.join("steam_settings").join("local_save.txt")) {
            let name = t.lines().next().unwrap_or("").trim().to_string();
            if !name.is_empty() && !name.contains("..") { v.push(d.join(name).join(appid).join("achievements.json")); }
        }
        v.push(d.join("steam_settings").join("achievements_unlocked.json"));
        // TENOKE: its SteamData folder next to the game's program (what its steam_api64.dll does)
        tenoke_files(&d.join("SteamData"), 0, &mut v);
        // the emulators set up by an .ini next to the game's program
        for s in emu_ini_dirs(appid, d, &docs) { in_dir(&s, &mut v); }
    }
    v.retain(|p| p.is_file());
    // (one file once, whatever the case of its name)
    let mut seen = HashSet::new();
    v.retain(|p| seen.insert(p.display().to_string().to_lowercase()));
    v
}
/// TENOKE's achievements.toml (and an older user_stats.ini), in its folder or the ones under it.
pub(super) fn tenoke_files(d: &Path, depth: usize, v: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(d) else { return };
    for e in rd.flatten().take(64) {
        let p = e.path();
        if p.is_dir() { if depth < 3 { tenoke_files(&p, depth + 1, v); } continue; }
        let n = e.file_name().to_string_lossy().to_lowercase();
        if n == "achievements.toml" || n == "user_stats.ini" { v.push(p); }
    }
}
/// Windows' Documents folder, wherever it was moved (OneDrive...).
pub(super) fn documents_dir() -> Option<PathBuf> {
    static D: Mutex<Option<Option<PathBuf>>> = Mutex::new(None);
    let mut g = D.lock().unwrap();
    if let Some(d) = g.clone() { return d; }
    #[allow(unused_mut)]
    let mut found = None;
    #[cfg(windows)]
    if let Some(p) = reg_values(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders").into_iter().find(|(n, _)| n == "Personal").map(|(_, v)| expand_env(&v)) {
        let p = PathBuf::from(p); if p.is_dir() { found = Some(p); }
    }
    if found.is_none() { found = std::env::var("USERPROFILE").ok().map(|h| PathBuf::from(h).join("Documents")).filter(|p| p.is_dir()); }
    *g = Some(found.clone());
    found
}
/// "%USERPROFILE%\Documents" → the folder itself.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn expand_env(s: &str) -> String {
    let mut out = String::new(); let mut rest = s;
    while let Some(a) = rest.find('%') {
        out.push_str(&rest[..a]);
        let after = &rest[a + 1..];
        match after.find('%') {
            Some(b) => { let name = &after[..b]; out.push_str(&std::env::var(name).unwrap_or_else(|_| format!("%{name}%"))); rest = &after[b + 1..]; }
            None => { out.push_str(&rest[a..]); rest = ""; }
        }
    }
    out.push_str(rest);
    out
}
/// A registry key's values (name, value as written by reg.exe: "0x1", text...).
#[cfg(windows)]
pub(super) fn reg_values(key: &str) -> Vec<(String, String)> {
    use std::os::windows::process::CommandExt;
    let Ok(o) = std::process::Command::new("reg").args(["query", key]).creation_flags(0x0800_0000).output() else { return Vec::new() };
    if !o.status.success() { return Vec::new(); }
    String::from_utf8_lossy(&o.stdout).lines().filter(|l| l.starts_with("    ")).filter_map(|l| {
        let l = l.trim();
        let (n, rest) = l.split_once("    REG_")?;
        let v = rest.split_once("    ").map(|(_, v)| v.trim().to_string()).unwrap_or_default();
        Some((n.trim().to_string(), v))
    }).collect()
}
/// A registry key's subkeys (their last names).
#[cfg(windows)]
pub(super) fn reg_subkeys(key: &str) -> Vec<String> {
    use std::os::windows::process::CommandExt;
    let Ok(o) = std::process::Command::new("reg").args(["query", key]).creation_flags(0x0800_0000).output() else { return Vec::new() };
    let low = key.to_lowercase();
    String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim()).filter(|l| l.to_lowercase().starts_with(&low) && l.len() > key.len() + 1)
        .map(|l| l[key.len() + 1..].to_string()).filter(|n| !n.contains('\\')).collect()
}
/// A small .ini read: section (lowercase) → key (lowercase) → value.
pub(super) fn ini_map(t: &str) -> HashMap<String, HashMap<String, String>> {
    let mut m: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut sec = String::new();
    for l in t.trim_start_matches('\u{feff}').lines() {
        let l = l.trim();
        if l.starts_with(';') || l.starts_with('#') { continue; }
        if l.starts_with('[') && l.ends_with(']') { sec = l[1..l.len() - 1].trim().to_lowercase(); continue; }
        if let Some((k, v)) = l.split_once('=') {
            let v = v.split(" ;").next().unwrap_or("").trim().trim_matches('"').to_string();
            m.entry(sec.clone()).or_default().insert(k.trim().to_lowercase(), v);
        }
    }
    m
}
/// The folder holding `rel`, looked for in `from` and the folders above it.
pub(super) fn up_find(from: &Path, rel: &Path) -> Option<PathBuf> {
    let mut d = Some(from);
    for _ in 0..6 { let c = d?; let p = c.join(rel); if p.is_dir() { return Some(p); } d = c.parent(); }
    None
}
/// Where the emulators set up by an .ini next to the game's program keep
/// their files (Achievement Watcher's userDir.js): ALI213 (ALI213.ini,
/// valve.ini, SteamConfig.ini), Hoodlum (hlm.ini), DARKSiDERS (ds.ini),
/// SKIDROW / Catherine-style (steam_api.ini).
pub(super) fn emu_ini_dirs(appid: &str, dir: &Path, docs: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut look = vec![dir.to_path_buf()];
    if let Ok(rd) = fs::read_dir(dir) { for e in rd.flatten().take(64) { if e.path().is_dir() { look.push(e.path()); } } }
    let same = |id: Option<&String>| id.map(|i| i.trim() == appid).unwrap_or(false);
    let ok = |s: &str| !s.is_empty() && !s.contains("..") && !s.contains(['/', '\\', ':']);
    for d in &look {
        for f in ["ALI213.ini", "valve.ini", "SteamConfig.ini", "hlm.ini", "ds.ini", "steam_api.ini"] {
            let Ok(t) = fs::read_to_string(d.join(f)) else { continue };
            let m = ini_map(&t);
            if let Some(s) = m.get("settings").filter(|s| same(s.get("appid"))) {
                let player = s.get("playername").cloned().unwrap_or_default();
                match s.get("savetype").map(|x| x.as_str()) {
                    Some("0") if ok(&player) => out.extend(up_find(d, &Path::new("Profile").join(&player).join("Stats"))),
                    Some("1") if ok(&player) => for dd in docs { out.push(dd.join("VALVE").join(appid).join(&player).join("Stats")); },
                    None | Some("") => {
                        out.extend(up_find(d, &Path::new("Profile").join("Stats")));
                        if let Some(sid) = s.get("steamid").filter(|x| ok(x)) { out.extend(up_find(d, &Path::new("SteamProfile").join(sid))); }
                    }
                    _ => {}
                }
            }
            if let Some(s) = m.get("gamesettings").filter(|s| same(s.get("appid"))) {
                match s.get("userdatafolder").map(|x| x.as_str()) {
                    Some(".") => {
                        let found = up_find(d, &Path::new("SteamEmu").join("UserStats")).or_else(|| up_find(d, Path::new("SteamEmu")));
                        match found {
                            Some(p) => out.push(p),
                            None if f == "hlm.ini" => out.extend(up_find(d, &Path::new("Profile").join("VALVE").join("Stats"))),
                            None => {}
                        }
                    }
                    Some(x) if x.eq_ignore_ascii_case("mydocs") => {
                        if let Some(u) = s.get("username").filter(|u| ok(u)) { for dd in docs { out.push(dd.join(u).join(appid).join("SteamEmu")); } }
                    }
                    _ => {}
                }
            }
        }
    }
    out
}
/// GreenLuma's won achievements (HKCU\SOFTWARE\GLR or GL2020\AppID\<appid>,
/// when its stats and achievements aren't skipped).
pub(super) fn greenluma_won(appid: &str) -> HashMap<String, i64> {
    #[allow(unused_mut)]
    let mut out = HashMap::new();
    #[cfg(windows)]
    {
        // (the games set up in GreenLuma: asked once a minute, not for every game)
        static GL: Mutex<Option<(Instant, Vec<(String, String)>)>> = Mutex::new(None);
        let list = {
            let mut g = GL.lock().unwrap();
            if g.as_ref().map(|(t, _)| t.elapsed() > Duration::from_secs(60)).unwrap_or(true) {
                let mut l = Vec::new();
                for root in [r"HKCU\SOFTWARE\GLR\AppID", r"HKCU\SOFTWARE\GL2020\AppID"] { for k in reg_subkeys(root) { l.push((root.to_string(), k)); } }
                *g = Some((Instant::now(), l));
            }
            g.as_ref().map(|(_, l)| l.clone()).unwrap_or_default()
        };
        let num = |v: &str| { let v = v.trim(); v.strip_prefix("0x").and_then(|h| i64::from_str_radix(h, 16).ok()).or_else(|| v.parse().ok()).unwrap_or(0) };
        for (root, k) in list.iter().filter(|(_, k)| k == appid) {
            let key = format!(r"{root}\{k}");
            if reg_values(&key).iter().find(|(n, _)| n.eq_ignore_ascii_case("SkipStatsAndAchievements")).map(|(_, v)| num(v)) != Some(0) { continue; }
            let vals = reg_values(&format!(r"{key}\Achievements"));
            let times: HashMap<&str, i64> = vals.iter().filter_map(|(n, v)| Some((n.strip_suffix("_Time")?, num(v)))).collect();
            for (n, v) in &vals { if !n.ends_with("_Time") && num(v) != 0 { out.insert(n.clone(), times.get(n.as_str()).copied().unwrap_or(0)); } }
        }
    }
    let _ = appid;
    out
}
/// SmartSteamEmu's stats.bin: entries of 24 bytes (CRC32 of the achievement's
/// name, its unlock time, its value), after a count.
pub(super) fn parse_sse(b: &[u8]) -> HashMap<String, i64> {
    let mut out = HashMap::new();
    if b.len() < 4 { return out; }
    let n = i32::from_le_bytes([b[0], b[1], b[2], b[3]]);
    let rest = &b[4..];
    if n < 0 || rest.len() != n as usize * 24 { return out; }
    for e in rest.chunks(24) {
        let val = i32::from_le_bytes([e[20], e[21], e[22], e[23]]);
        if val != 1 { continue; }
        let crc = u32::from_le_bytes([e[0], e[1], e[2], e[3]]);
        let time = i32::from_le_bytes([e[8], e[9], e[10], e[11]]) as i64;
        out.insert(format!("{SSE_CRC}{crc:08x}"), time.max(0));
    }
    out
}
/// (SmartSteamEmu names its achievements by CRC32: matched to the list's names later)
pub(super) const SSE_CRC: &str = "\u{1}crc:";
pub(super) fn crc32(s: &str) -> u32 { let mut c = flate2::Crc::new(); c.update(s.as_bytes()); c.sum() }
pub(super) fn parse_time(s: &str) -> i64 {
    let s = s.trim();
    // (CreamAPI can write a time missing its last 3 digits: 1700000 → 1700000000)
    if let Ok(n) = s.parse::<i64>() { return if (1_000_000..10_000_000).contains(&n) { n * 1000 } else { n }; }
    // "Time = 1A2B3C4D" (little-endian hex, SKIDROW / 3DM)
    let h: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if h.len() >= 8 { if let Ok(b) = (0..4).map(|i| u8::from_str_radix(&h[i * 2..i * 2 + 2], 16)).collect::<Result<Vec<_>, _>>() { return u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as i64; } }
    0
}
/// An emulator's file: achievement API name → when it was won.
pub(super) fn parse_emu(path: &Path) -> HashMap<String, i64> {
    let mut out = HashMap::new();
    if path.file_name().map(|n| n.eq_ignore_ascii_case("stats.bin")).unwrap_or(false) {
        return fs::read(path).map(|b| parse_sse(&b)).unwrap_or_default();
    }
    let Ok(t) = fs::read(path).map(|b| String::from_utf8_lossy(&b).to_string()) else { return out };
    let t = t.trim_start_matches('\u{feff}');
    // TENOKE's user_stats.ini (achievements.toml in other versions), TOML:
    // [ACHIEVEMENTS] "NAME" = {unlocked = true, time = <seconds>, unlocked_at_iso = "..."}
    if path.extension().map(|e| e.eq_ignore_ascii_case("toml")).unwrap_or(false) || t.lines().any(|l| l.contains("= {") || l.contains("={")) {
        for l in t.lines() {
            let l = l.trim();
            let Some((k, v)) = l.split_once('=') else { continue };
            let v = v.trim();
            if !v.starts_with('{') { continue; }
            let inner = v.trim_start_matches('{').trim_end_matches('}');
            let field = |name: &str| inner.split(',').filter_map(|p| p.split_once('=')).find(|(a, _)| a.trim() == name).map(|(_, b)| b.trim().trim_matches('"').to_string());
            if field("unlocked").map(|u| u.eq_ignore_ascii_case("true") || u == "1").unwrap_or(false) {
                let time = field("time").and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
                out.insert(k.trim().trim_matches('"').to_string(), time);
            }
        }
        return out;
    }
    if path.extension().map(|e| e.eq_ignore_ascii_case("json")).unwrap_or(false) {
        if let Ok(Value::Object(m)) = serde_json::from_str::<Value>(t) {
            for (k, v) in m {
                let earned = v["earned"].as_bool().unwrap_or(false) || v["earned"].as_i64().unwrap_or(0) != 0 || v["achieved"].as_bool().unwrap_or(false);
                let time = v["earned_time"].as_i64().or_else(|| v["earned_time"].as_str().and_then(|s| s.parse().ok())).unwrap_or(0);
                if earned || time > 0 { out.insert(k, time); }
            }
        }
        return out;
    }
    let on = |v: &str| { let v = v.trim().to_lowercase(); v == "1" || v == "true" || (v.len() >= 4 && v.chars().all(|c| c.is_ascii_hexdigit()) && v.chars().any(|c| c != '0')) };
    let mut sec = String::new(); let mut cur: HashMap<String, String> = HashMap::new();
    let flush = |sec: &str, cur: &mut HashMap<String, String>, out: &mut HashMap<String, i64>| {
        let low = sec.to_lowercase();
        if sec.is_empty() || ["steam", "steam64", "steamachievements", "achieve_data", "stats", "settings"].contains(&low.as_str()) { cur.clear(); return; }
        let get = |k: &[&str]| cur.iter().find(|(n, _)| k.iter().any(|x| n.eq_ignore_ascii_case(x))).map(|(_, v)| v.trim().to_string());
        let won = get(&["Achieved", "State", "unlocked", "achieved"]).map(|v| on(&v)).unwrap_or(false);
        let time = get(&["UnlockTime", "Time", "unlock_time", "earned_time", "timestamp"]).map(|v| parse_time(&v)).unwrap_or(0);
        if won { out.insert(sec.to_string(), time); }
        cur.clear();
    };
    // the lists (name = value): [Achievements] + [AchievementsUnlockTimes]
    // (Hoodlum, DARKSiDERS), [State] + [Time] (3DM)
    const LISTS: [&str; 4] = ["achievements", "achievementsunlocktimes", "state", "time"];
    let mut lists: HashMap<&str, Vec<(String, String)>> = HashMap::new();
    let mut list_sec: Option<&str> = None;
    for l in t.lines() {
        let l = l.trim();
        if l.starts_with('[') && l.ends_with(']') {
            flush(&sec, &mut cur, &mut out);
            sec = l[1..l.len() - 1].trim().to_string();
            list_sec = LISTS.iter().find(|x| sec.eq_ignore_ascii_case(x)).copied();
            continue;
        }
        let Some((k, v)) = l.split_once('=') else { continue };
        match list_sec {
            Some(ls) => lists.entry(ls).or_default().push((k.trim().to_string(), v.trim().to_string())),
            None => { cur.insert(k.trim().to_string(), v.trim().to_string()); }
        }
    }
    flush(&sec, &mut cur, &mut out);
    let times = |n: &str| -> HashMap<String, i64> { lists.get(n).map(|l| l.iter().map(|(k, v)| (k.clone(), parse_time(v))).collect()).unwrap_or_default() };
    let flags = lists.get("achievements").or_else(|| lists.get("state"));
    let t_of = if lists.contains_key("achievements") { times("achievementsunlocktimes") } else { times("time") };
    let listed: HashSet<&str> = flags.map(|f| f.iter().map(|(k, _)| k.as_str()).collect()).unwrap_or_default();
    for (k, v) in flags.into_iter().flatten() { if on(v) { out.insert(k.clone(), t_of.get(k).copied().unwrap_or(0)); } }
    // (a time and no flag saying otherwise: won)
    for (k, t) in &t_of { if *t > 0 && !listed.contains(k.as_str()) { out.insert(k.clone(), *t); } }
    out
}
/// An emulator's own list (steam_settings\achievements.json): names, descriptions, pictures.
pub(super) fn steam_emu_schema(dirs: &[PathBuf]) -> Vec<SteamAch> {
    for d in dirs {
        let p = d.join("steam_settings").join("achievements.json");
        let Ok(Value::Array(a)) = fs::read_to_string(&p).map(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).unwrap_or(Value::Null)) else { continue };
        let txt = |v: &Value| v.as_str().map(|s| s.to_string()).or_else(|| v["english"].as_str().map(|s| s.to_string())).unwrap_or_default();
        return a.iter().filter_map(|x| {
            let api = x["name"].as_str()?.to_string();
            // (only a picture inside steam_settings: nothing elsewhere on the computer)
            let icon = x["icon"].as_str().filter(|i| !i.contains("..") && !Path::new(i).is_absolute() && !i.contains(':'))
                .map(|i| d.join("steam_settings").join(i)).filter(|p| p.is_file()).map(|p| p.display().to_string()).unwrap_or_default();
            Some(SteamAch { api, name: txt(&x["displayName"]), desc: txt(&x["description"]),
                hidden: x["hidden"].as_i64().map(|h| h != 0).or_else(|| x["hidden"].as_str().map(|h| h != "0")).unwrap_or(false), icon, pct: None })
        }).collect();
    }
    Vec::new()
}

/// Steam's public list of a game's achievements (no account): kept for a week.
pub(super) fn steam_web_schema(tdir: &Path, appid: &str, web: bool) -> Vec<SteamAch> {
    let file = tdir.join("schemas").join(format!("steam_{}.json", safe(appid)));
    let old = fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
    let age = fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).unwrap_or(Duration::MAX);
    // (offline: what's kept, however old)
    let v = if old.is_some() && (!web || age < Duration::from_secs(7 * 86400)) || !web { old } else {
        match net::get_json(&format!("https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid={}&language=english", net::enc(appid)), &[]) {
            Some(v) if v["response"]["achievements"].is_array() => {
                let _ = fs::create_dir_all(file.parent().unwrap()); let _ = fs::write(&file, v.to_string()); Some(v)
            }
            _ => old,
        }
    };
    let Some(v) = v else { return Vec::new() };
    v["response"]["achievements"].as_array().map(|a| a.iter().filter_map(|x| Some(SteamAch {
        api: x["internal_name"].as_str()?.to_string(),
        name: x["localized_name"].as_str().unwrap_or("").trim().to_string(),
        desc: x["localized_desc"].as_str().unwrap_or("").trim().to_string(),
        hidden: x["hidden"].as_bool().unwrap_or(false),
        icon: x["icon"].as_str().filter(|s| !s.is_empty()).map(|i| format!("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/{appid}/{i}")).unwrap_or_default(),
        pct: x["player_percent_unlocked"].as_str().and_then(|p| p.parse().ok()).or_else(|| x["player_percent_unlocked"].as_f64().map(|f| f as f32)),
    })).collect()).unwrap_or_default()
}

pub(super) fn steam_set(tdir: &Path, acc: &Accounts, appid: &str, dirs: &[PathBuf], web: bool) -> Option<Vec<Trophy>> {
    let local_schema = steam_stats_dir().map(|d| d.join(format!("UserGameStatsSchema_{appid}.bin")))
        .and_then(|p| fs::read(p).ok()).map(|b| steam_local_schema(&b, appid)).unwrap_or_default();
    let mut list = steam_web_schema(tdir, appid, web);
    if list.is_empty() { list = local_schema.iter().map(|(_, a)| a.clone()).collect(); }
    if list.is_empty() { list = steam_emu_schema(dirs); }
    if list.is_empty() { return None; }
    // which are won: Steam's own files, the emulators', the account (key)
    let mut won: HashMap<String, i64> = HashMap::new();
    fn add_to(won: &mut HashMap<String, i64>, api: String, t: i64) { let e = won.entry(api).or_insert(t); if *e == 0 || (t > 0 && t < *e) { *e = t; } }
    if let Some(f) = steam_user_file(appid, &acc.steam_id) {
        if let Ok(b) = fs::read(f) {
            let names: HashMap<(i64, i64), String> = local_schema.iter().map(|(k, a)| (*k, a.api.clone())).collect();
            for (k, t) in steam_local_unlocks(&b) { if let Some(n) = names.get(&k) { add_to(&mut won, n.clone(), t); } }
        }
    }
    for f in emu_files(appid, dirs) { for (k, t) in parse_emu(&f) { add_to(&mut won, k, t); } }
    for (k, t) in greenluma_won(appid) { add_to(&mut won, k, t); }
    // (what this computer shows; the rest is the account's: see ACCT_WON)
    let here: HashSet<String> = won.keys().cloned().collect();
    // (the account asked only for a game with nothing on this computer: Steam keeps its own
    // file up to date, and an emulator's is the game's own)
    if web && !acc.steam_key.is_empty() && !acc.steam_id.is_empty() && here.is_empty() && steam_user_file(appid, &acc.steam_id).is_none() && emu_files(appid, dirs).is_empty() {
        if let Some(v) = net::get_json(&format!("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid={}&steamid={}&key={}",
            net::enc(appid), net::enc(&acc.steam_id), net::enc(&acc.steam_key)), &[]) {
            for a in v["playerstats"]["achievements"].as_array().into_iter().flatten() {
                if a["achieved"].as_i64().unwrap_or(0) == 1 { if let Some(n) = a["apiname"].as_str() { add_to(&mut won, n.to_string(), a["unlocktime"].as_i64().unwrap_or(0)); } }
            }
        }
    }
    // (the Steam ID alone: nothing from the web -- Steam's pages show a profile's games and
    // achievements only to someone signed in --, only this computer's files)
    ACCT_WON.with(|a| a.borrow_mut().extend(won.keys().filter(|k| !here.contains(*k)).cloned()));
    // (SmartSteamEmu's: by the CRC32 of each name)
    let crcs: Vec<(String, i64)> = won.iter().filter_map(|(k, t)| Some((k.strip_prefix(SSE_CRC)?.to_string(), *t))).collect();
    if !crcs.is_empty() {
        won.retain(|k, _| !k.starts_with(SSE_CRC));
        let by: HashMap<String, &str> = list.iter().map(|a| (format!("{:08x}", crc32(&a.api)), a.api.as_str())).collect();
        for (c, t) in crcs { if let Some(n) = by.get(&c) { let e = won.entry(n.to_string()).or_insert(t); if *e == 0 { *e = t; } } }
    }
    // (names that differ only in case between the files)
    let low: HashMap<String, i64> = won.iter().map(|(k, v)| (k.to_lowercase(), *v)).collect();
    Some(list.into_iter().map(|a| Trophy {
        earned: won.get(&a.api).or_else(|| low.get(&a.api.to_lowercase())).copied(),
        grade: grade_for(a.pct).into(), id: a.api, name: a.name, desc: a.desc, hidden: a.hidden, icon: String::new(), src: a.icon, pct: a.pct, auto_plat: false, addon: false
    }).collect())
}
/// The files whose change means a Steam game's trophies changed.
pub(super) fn steam_stamp_files(acc: &Accounts, appid: &str, dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut v = emu_files(appid, dirs);
    if let Some(f) = steam_user_file(appid, &acc.steam_id) { v.push(f); }
    v
}
