//! Part of trophies.rs. RPCS3: the trophy folders of the RPCS3 installs a game can be in, its NP ID,
//! a game's own TROPHY.TRP unpacked, and the lists read from TROPCONF.SFM / TROPUSR.DAT.

use super::*;


/// The RPCS3 dev_hdd0 folders a game's trophies can be in: the one it's in (its own install's,
/// or one kept elsewhere: a folder with home and game in it), and every install's Game
/// Recognition knows (its own dev_hdd0, or the one its settings point at, config\vfs.yml).
pub(super) fn rpcs3_roots(ctx: &Ctx, key: &Path) -> Vec<PathBuf> {
    let mut hdds: Vec<PathBuf> = key.ancestors().filter_map(|a| {
        if a.join("dev_hdd0").is_dir() { Some(a.join("dev_hdd0")) }
        else if a.join("home").is_dir() && a.join("game").is_dir() { Some(a.to_path_buf()) } else { None }
    }).collect();
    let mut roots: Vec<PathBuf> = Vec::new();
    // the RPCS3 installs Game Recognition knows
    if let Ok(t) = fs::read_to_string(&ctx.sources) {
        fn walk(v: &Value, out: &mut Vec<PathBuf>) {
            match v {
                Value::Object(m) => for (k, x) in m {
                    if k == "rpcs3" { if let Some(s) = x.as_str() { if let Some(p) = Path::new(s).parent() { out.push(p.to_path_buf()); } } }
                    else { walk(x, out); }
                },
                Value::Array(a) => for x in a { walk(x, out); },
                _ => {}
            }
        }
        if let Ok(v) = serde_json::from_str::<Value>(&t) { walk(&v, &mut roots); }
    }
    hdds.extend(roots.iter().map(|r| crate::ps3::hdd_dir(r)));
    hdds.retain(|r| r.is_dir());
    // (each once, however it's written)
    let mut seen = HashSet::new();
    hdds.retain(|r| seen.insert(r.canonicalize().unwrap_or_else(|_| r.clone()).display().to_string().to_lowercase()));
    hdds
}
/// The game's NP communication ID (NPWR12345_00), from its TROPDIR.
pub(super) fn np_comm_id(key: &Path) -> Option<String> {
    // (a disc image: the copy of its files, see ps3::iso_game)
    let copy = if crate::ps3::is_iso(key) { crate::ps3::iso_content(key) } else { None };
    let key = copy.as_deref().unwrap_or(key);
    for a in key.ancestors().take(4) {
        for c in [a.join("TROPDIR"), a.join("PS3_GAME").join("TROPDIR")] {
            let Ok(rd) = fs::read_dir(&c) else { continue };
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.len() >= 9 && n.chars().take(4).all(|c| c.is_ascii_alphabetic()) { return Some(n); }
            }
        }
    }
    None
}
/// A PS3 game's own TROPHY.TRP (PS3_GAME\TROPDIR\<NP ID>\TROPHY.TRP) near its
/// files: (NP ID, the file).
pub(super) fn trp_near(key: &Path) -> Option<(String, PathBuf)> {
    // (a disc image: the copy of its files, see ps3::iso_game)
    let copy = if crate::ps3::is_iso(key) { crate::ps3::iso_content(key) } else { None };
    let key = copy.as_deref().unwrap_or(key);
    for a in key.ancestors().take(4) {
        for c in [a.join("TROPDIR"), a.join("PS3_GAME").join("TROPDIR")] {
            let Ok(rd) = fs::read_dir(&c) else { continue };
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                let f = e.path().join("TROPHY.TRP");
                if n.len() >= 9 && n.chars().take(4).all(|c| c.is_ascii_alphabetic()) && f.is_file() { return Some((n, f)); }
            }
        }
    }
    None
}
/// The files in a TROPHY.TRP: header (magic DCA24D00, the number of files at
/// 0x10, each entry's size at 0x14; 0x40 bytes -- its SHA-1 and padding up to
/// there --, as RPCS3 reads it), then each entry: name (32 bytes), offset and
/// size (big-endian). (The entries are looked for after a 0x60-byte header too:
/// the one that gives the list, TROPCONF.SFM in it, is taken.)
pub(super) fn trp_files(b: &[u8]) -> Vec<(String, std::ops::Range<usize>)> {
    let be32 = |o: usize| b.get(o..o + 4).map(|x| u32::from_be_bytes([x[0], x[1], x[2], x[3]]) as usize);
    let be64 = |o: usize| b.get(o..o + 8).map(|x| u64::from_be_bytes([x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]]) as usize);
    if be32(0) != Some(0xDCA2_4D00) { return Vec::new(); }
    let (Some(count), Some(elem)) = (be32(0x10), be32(0x14)) else { return Vec::new() };
    if elem < 48 { return Vec::new(); }
    let from = |start: usize| {
        let mut out = Vec::new();
        for i in 0..count.min(1024) {
            let e = start + i * elem;
            let Some(raw) = b.get(e..e + 32) else { break };
            let name: String = raw.iter().take_while(|c| **c != 0).map(|c| *c as char).collect();
            let (Some(off), Some(size)) = (be64(e + 32), be64(e + 40)) else { break };
            if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_') { continue; }
            if off.checked_add(size).map(|end| end <= b.len()).unwrap_or(false) { out.push((name, off..off + size)); }
        }
        out
    };
    let has_conf = |l: &Vec<(String, std::ops::Range<usize>)>| l.iter().any(|(n, _)| n.eq_ignore_ascii_case("TROPCONF.SFM"));
    let a = from(0x40);
    if has_conf(&a) { return a; }
    let c = from(0x60);
    if has_conf(&c) || c.len() > a.len() { c } else { a }
}
/// A game's own trophy list (from its TROPHY.TRP), unpacked once into the
/// trophies' cache as RPCS3 keeps one (nothing won yet: until the game is
/// played in RPCS3, then RPCS3's own folder is used).
pub(super) fn trp_dir(tdir: &Path, np: &str, trp: &Path) -> Option<PathBuf> {
    let out = tdir.join("trp").join(safe(np));
    if out.join("TROPCONF.SFM").is_file() { return Some(out); }
    let b = fs::read(trp).ok()?;
    let files = trp_files(&b);
    if !files.iter().any(|(n, _)| n.eq_ignore_ascii_case("TROPCONF.SFM")) { return None; }
    fs::create_dir_all(&out).ok()?;
    for (n, r) in files { let _ = fs::write(out.join(n.to_uppercase()), &b[r]); }
    out.join("TROPCONF.SFM").is_file().then_some(out)
}
/// The games of an RPCS3 install (kept a few minutes: asked for every game of a sync).
pub(super) fn rpcs3_games(root: &Path) -> Vec<crate::ps3::Ps3Game> {
    static C: Mutex<Option<HashMap<PathBuf, (Instant, Vec<crate::ps3::Ps3Game>)>>> = Mutex::new(None);
    if let Some((t, v)) = C.lock().unwrap().as_ref().and_then(|m| m.get(root)) { if t.elapsed() < Duration::from_secs(300) { return v.clone(); } }
    let v = crate::ps3::games_in(root);
    C.lock().unwrap().get_or_insert_with(HashMap::new).insert(root.to_path_buf(), (Instant::now(), v.clone()));
    v
}
/// A PS3 game in the RPCS3 installs known with this name (its own list, from
/// its TROPHY.TRP: a game not played in RPCS3 yet, or an unofficial version
/// or recompilation of it).
pub(super) fn trp_by_name(ctx: &Ctx, roots: &[PathBuf], title: &str) -> Option<PathBuf> {
    let want = clean_title(title);
    let mut best: Option<(f32, PathBuf)> = None;
    for r in roots {
        for g in rpcs3_games(r) {
            let sc = crate::gameart::likeness(&want, &clean_title(&g.title));
            if sc >= 0.85 && best.as_ref().map(|(b, _)| sc > *b).unwrap_or(true) {
                if let Some((np, f)) = trp_near(&g.content.join("USRDIR")).or_else(|| trp_near(&g.content)) {
                    if let Some(d) = trp_dir(&ctx.tdir, &np, &f) { best = Some((sc, d)); }
                }
            }
        }
    }
    best.map(|(_, p)| p)
}
/// An RPCS3 install with only one game's trophies (a shortcut to the
/// emulator kept for that one game): that game's.
pub(super) fn rpcs3_only_set(roots: &[PathBuf]) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    for r in roots {
        for h in fs::read_dir(r.join("home")).into_iter().flatten().flatten() {
            for d in fs::read_dir(h.path().join("trophy")).into_iter().flatten().flatten() {
                if d.path().join("TROPCONF.SFM").is_file() && !found.contains(&d.path()) { found.push(d.path()); }
            }
        }
    }
    (found.len() == 1).then(|| found.remove(0))
}
#[cfg(test)]
pub(super) fn rpcs3_dir(ctx: &Ctx, meta: &Value) -> Option<PathBuf> {
    let key = PathBuf::from(meta["ps3Key"].as_str()?);
    rpcs3_dir_in(&np_comm_id(&key)?, &rpcs3_roots(ctx, &key))
}
/// The game's trophy folder (its NP ID's) in these RPCS3 dev_hdd0 folders.
pub(super) fn rpcs3_dir_in(np: &str, roots: &[PathBuf]) -> Option<PathBuf> {
    for r in roots {
        let Ok(homes) = fs::read_dir(r.join("home")) else { continue };
        for h in homes.flatten() {
            let d = h.path().join("trophy").join(np);
            if d.join("TROPCONF.SFM").is_file() { return Some(d); }
        }
    }
    None
}

pub(super) fn xml_unescape(s: &str) -> String {
    let mut out = String::new(); let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]); rest = &rest[i..];
        let Some(j) = rest.find(';').filter(|j| *j < 10) else { out.push('&'); rest = &rest[1..]; continue };
        let ent = &rest[1..j];
        let ch = match ent { "amp" => Some('&'), "lt" => Some('<'), "gt" => Some('>'), "quot" => Some('"'), "apos" => Some('\''),
            _ if ent.starts_with("#x") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32), _ => None };
        match ch { Some(c) => { out.push(c); rest = &rest[j + 1..]; } None => { out.push('&'); rest = &rest[1..]; } }
    }
    out.push_str(rest); out
}
pub(crate) fn tag<'a>(s: &'a str, name: &str) -> Option<&'a str> {
    let a = s.find(&format!("<{name}>"))? + name.len() + 2;
    let b = s[a..].find(&format!("</{name}>"))? + a;
    Some(&s[a..b])
}
pub(super) fn attr<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    let a = head.find(&format!("{name}=\""))? + name.len() + 2;
    let b = head[a..].find('"')? + a;
    Some(&head[a..b])
}
/// TROPCONF.SFM: (id, grade, hidden, name, detail, add-on) of each trophy. An add-on's
/// trophies are the ones in a group (gid="001"...): the game's own have none (or "000").
pub(super) fn parse_tropconf(xml: &str) -> Vec<(u32, String, bool, String, String, bool)> {
    let mut out = Vec::new(); let mut rest = xml;
    while let Some(i) = rest.find("<trophy ") {
        rest = &rest[i..];
        let Some(end) = rest.find("</trophy>") else { break };
        let block = &rest[..end];
        let head = &block[..block.find('>').unwrap_or(block.len())];
        if let Some(id) = attr(head, "id").and_then(|v| v.trim().parse::<u32>().ok()) {
            let grade = attr(head, "ttype").unwrap_or("B").trim().to_uppercase();
            let hidden = attr(head, "hidden").map(|v| v.trim().eq_ignore_ascii_case("yes")).unwrap_or(false);
            let name = xml_unescape(tag(block, "name").unwrap_or("").trim());
            let detail = xml_unescape(tag(block, "detail").unwrap_or("").trim());
            let addon = attr(head, "gid").and_then(|v| v.trim().parse::<i64>().ok()).map(|g| g > 0).unwrap_or(false);
            out.push((id, grade, hidden, name, detail, addon));
        }
        rest = &rest[end + 9..];
    }
    out
}
/// TROPUSR.DAT (big-endian; RPCS3's Loader/TROPUSR): the won trophies and when (Unix seconds).
pub(super) fn parse_tropusr(b: &[u8]) -> HashMap<u32, i64> {
    let be32 = |o: usize| -> Option<u32> { Some(u32::from_be_bytes(b.get(o..o + 4)?.try_into().ok()?)) };
    let be64 = |o: usize| -> Option<u64> { Some(u64::from_be_bytes(b.get(o..o + 8)?.try_into().ok()?)) };
    let mut out = HashMap::new();
    if be32(0) != Some(0x818F_54AD) { return out; }
    let tables = be32(8).unwrap_or(0).min(16) as usize;
    for t in 0..tables {
        let h = 48 + t * 32;
        let (Some(ty), Some(size), Some(count), Some(off)) = (be32(h), be32(h + 4), be32(h + 12), be64(h + 16)) else { break };
        if ty != 6 { continue; }
        let stride = size as usize + 16;
        for i in 0..count.min(4096) as usize {
            let e = off as usize + i * stride;
            let (Some(id), Some(state), Some(tick)) = (be32(e + 16), be32(e + 20), be64(e + 32)) else { break };
            if state == 1 {
                // (PS3 time: microseconds since 0001-01-01)
                let unix = (tick as i64 - 62_135_596_800_000_000) / 1_000_000;
                out.insert(id, if unix > 0 { unix } else { 0 });
            }
        }
    }
    out
}
pub(super) fn rpcs3_set(dir: &Path) -> Option<Vec<Trophy>> {
    let conf = fs::read(dir.join("TROPCONF.SFM")).ok()?;
    let text = String::from_utf8_lossy(&conf);
    let won = fs::read(dir.join("TROPUSR.DAT")).map(|b| parse_tropusr(&b)).unwrap_or_default();
    let mut list: Vec<Trophy> = parse_tropconf(&text).into_iter().map(|(id, grade, hidden, name, desc, addon)| {
        let pic = dir.join(format!("TROP{id:03}.PNG"));
        Trophy { id: id.to_string(), name, desc, grade: if ["B", "S", "G", "P"].contains(&grade.as_str()) { grade } else { "B".into() },
            hidden, earned: won.get(&id).copied(), icon: String::new(), src: pic.display().to_string(), pct: None, auto_plat: false, addon }
    }).collect();
    // (an add-on's trophies after the game's own, each part in its order)
    list.sort_by_key(|t| t.addon);
    (!list.is_empty()).then_some(list)
}
