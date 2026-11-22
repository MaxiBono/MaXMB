// PS3 games (for the RPCS3 emulator).
//
// A PS3 game folder is either a disc copy (PS3_GAME\PARAM.SFO, started from
// PS3_GAME\USRDIR\EBOOT.BIN) or an installed game (PARAM.SFO and
// USRDIR\EBOOT.BIN, as in RPCS3's dev_hdd0\game); a disc image (.iso) is a disc copy too. Its media is used for the
// game's folder in content\Games: ICON0.PNG → icon, PIC1.PNG → background,
// ICON1.PAM (the animated icon) → preview.mp4, SND0.AT3 → music.flac.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// ------------------------------------------------------------ PARAM.SFO ----

/// The entries of a PARAM.SFO (texts, and numbers written as text).
pub fn parse_sfo(b: &[u8]) -> Option<HashMap<String, String>> {
    if b.get(0..4)? != b"\0PSF" { return None; }
    let u16_at = |o: usize| b.get(o..o + 2).map(|x| u16::from_le_bytes([x[0], x[1]]));
    let u32_at = |o: usize| b.get(o..o + 4).map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]]));
    let keys = u32_at(8)? as usize;
    let data = u32_at(12)? as usize;
    let count = u32_at(16)? as usize;
    let mut out = HashMap::new();
    for i in 0..count.min(256) {
        let e = 20 + i * 16;
        let (Some(ko), Some(fmt), Some(len), Some(off)) = (u16_at(e), u16_at(e + 2), u32_at(e + 4), u32_at(e + 12)) else { break };
        let ks = keys + ko as usize;
        let Some(kb) = b.get(ks..) else { continue };
        let key = String::from_utf8_lossy(&kb[..kb.iter().position(|&c| c == 0).unwrap_or(kb.len())]).to_string();
        let ds = data + off as usize;
        let Some(db) = b.get(ds..ds + len as usize) else { continue };
        let val = match fmt {
            0x0404 => db.get(0..4).map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]]).to_string()).unwrap_or_default(),
            _ => String::from_utf8_lossy(&db[..db.iter().position(|&c| c == 0).unwrap_or(db.len())]).to_string(),
        };
        out.insert(key, val);
    }
    Some(out)
}

/// One PS3 game found on disk.
#[derive(Debug, Clone)]
pub struct Ps3Game {
    /// the game's folder (the one holding PS3_GAME, or the installed game's)
    pub dir: PathBuf,
    /// where PARAM.SFO, ICON0.PNG… are (PS3_GAME, or `dir` itself)
    pub content: PathBuf,
    pub eboot: Option<PathBuf>,
    pub title: String,
    pub title_id: String,
    #[allow(dead_code)]
    pub category: String,
    pub version: String,
    /// found inside an RPCS3 install (or in its games.yml): RPCS3 knows it
    /// by its Title ID
    pub in_rpcs3: bool,
}

pub fn child_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    let p = dir.join(name);
    if p.exists() { return Some(p); }
    fs::read_dir(dir).ok()?.flatten().map(|e| e.path())
        .find(|p| p.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(name)).unwrap_or(false))
}

/// The PS3 game in this folder, if it is one. Game data and updates (their
/// own PARAM.SFO next to the installed game) aren't games.
pub fn game_at(dir: &Path) -> Option<Ps3Game> {
    let content = child_ci(dir, "PS3_GAME").filter(|p| p.is_dir()).unwrap_or_else(|| dir.to_path_buf());
    let sfo_path = child_ci(&content, "PARAM.SFO")?;
    let sfo = parse_sfo(&fs::read(&sfo_path).ok()?)?;
    let category = sfo.get("CATEGORY").cloned().unwrap_or_default().trim().to_string();
    // GD: game data / an update; SD: save data
    if matches!(category.as_str(), "GD" | "SD") { return None; }
    let eboot = child_ci(&content, "USRDIR").and_then(|u| child_ci(&u, "EBOOT.BIN")).filter(|p| p.is_file());
    // an installed game needs its EBOOT.BIN; a disc copy has PS3_GAME
    if eboot.is_none() && content == dir { return None; }
    let title = sfo.get("TITLE").map(|t| t.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default();
    let title_id = sfo.get("TITLE_ID").cloned().unwrap_or_default();
    let version = sfo.get("APP_VER").or_else(|| sfo.get("VERSION")).cloned().unwrap_or_default()
        .trim().trim_start_matches('0').to_string();
    let version = if version.starts_with('.') { format!("0{version}") } else { version };
    Some(Ps3Game { dir: dir.to_path_buf(), content, eboot, title, title_id, category, version, in_rpcs3: false })
}

// ----------------------------------------------------------- disc images ----
// A PS3 disc image (.iso) RPCS3 loads as it is: its PARAM.SFO and the files the
// app uses (its pictures, preview, music and trophy list) are copied out of it
// once into the app's own cache (content\data\cache\ps3iso\<the image's mark>\PS3_GAME),
// the game's "content" from then on; the image itself is never changed.

static ISO_CACHE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);
/// Where the disc images' files are copied to (set when the app starts).
pub fn set_iso_cache(dir: PathBuf) { *ISO_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(dir); }
/// (the tests that set the images' cache folder: one at a time)
#[cfg(test)]
pub static ISO_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub fn is_iso(p: &Path) -> bool { p.extension().map(|x| x.eq_ignore_ascii_case("iso")).unwrap_or(false) && p.is_file() }
/// The copy of a disc image's files: its folder (the same image, the same size and date: the same folder).
pub fn iso_content(iso: &Path) -> Option<PathBuf> {
    let base = ISO_CACHE.lock().unwrap_or_else(|e| e.into_inner()).clone()?;
    let m = fs::metadata(iso).ok()?;
    let mark = format!("{}|{}|{:?}", iso.display().to_string().to_lowercase().replace('/', "\\"), m.len(), m.modified().ok());
    let mut h: u64 = 0xcbf29ce484222325;
    for b in mark.bytes() { h ^= b as u64; h = h.wrapping_mul(0x100000001b3); }
    Some(base.join(format!("{h:016x}")))
}
/// The game in a disc image (its files copied out of it the first time).
pub fn iso_game(iso: &Path) -> Option<Ps3Game> {
    if !is_iso(iso) { return None; }
    let root = iso_content(iso)?;
    let content = root.join("PS3_GAME");
    if !content.join("PARAM.SFO").is_file() && !root.join("PS3_DISC.SFB").is_file() {
        let mut img = crate::iso::Iso::open(iso)?;
        // (a PS3 disc: PS3_GAME, or PS3_DISC.SFB)
        let game = img.find("PS3_GAME").filter(|e| e.dir);
        let sfb = img.find("PS3_DISC.SFB");
        if game.is_none() && sfb.is_none() { return None; }
        let _ = fs::create_dir_all(&content);
        if let Some(e) = &sfb { if let Some(b) = img.read(e, 64 << 10) { let _ = fs::write(root.join("PS3_DISC.SFB"), b); } }
        if let Some(g) = &game {
            for e in img.list(g) {
                let n = e.name.to_uppercase();
                if !e.dir && ["PARAM.SFO", "ICON0.PNG", "PIC0.PNG", "PIC1.PNG", "ICON1.PAM", "SND0.AT3"].contains(&n.as_str()) {
                    if let Some(b) = img.read(&e, 64 << 20) { let _ = fs::write(content.join(&n), b); }
                }
            }
            // (its trophy list: TROPDIR\<NP ID>\TROPHY.TRP)
            if let Some(t) = img.find("PS3_GAME/TROPDIR") {
                for np in img.list(&t).into_iter().filter(|e| e.dir) {
                    if let Some(f) = img.list(&np).into_iter().find(|e| e.name.eq_ignore_ascii_case("TROPHY.TRP")) {
                        if let Some(b) = img.read(&f, 64 << 20) {
                            let d = content.join("TROPDIR").join(&np.name);
                            let _ = fs::create_dir_all(&d); let _ = fs::write(d.join("TROPHY.TRP"), b);
                        }
                    }
                }
            }
        }
    }
    let stem = iso.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let sfo = fs::read(content.join("PARAM.SFO")).ok().and_then(|b| parse_sfo(&b));
    let sfb_id = fs::read(root.join("PS3_DISC.SFB")).ok().and_then(|b| crate::iso::sfb_title_id(&b)).unwrap_or_default();
    let (title, title_id, category, version) = match &sfo {
        Some(sfo) => {
            let category = sfo.get("CATEGORY").cloned().unwrap_or_default().trim().to_string();
            if matches!(category.as_str(), "GD" | "SD") { return None; }
            let version = sfo.get("APP_VER").or_else(|| sfo.get("VERSION")).cloned().unwrap_or_default().trim().trim_start_matches('0').to_string();
            (sfo.get("TITLE").map(|t| t.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default(),
             sfo.get("TITLE_ID").cloned().filter(|t| !t.trim().is_empty()).unwrap_or(sfb_id), category,
             if version.starts_with('.') { format!("0{version}") } else { version })
        }
        // (its PARAM.SFO unreadable -- a dumped disc's region that's encrypted --: the image's
        // name, and the Title ID PS3_DISC.SFB gives)
        None => (stem.clone(), sfb_id, "DG".to_string(), String::new()),
    };
    let title = if title.is_empty() { stem } else { title };
    Some(Ps3Game { dir: iso.to_path_buf(), content, eboot: None, title, title_id, category, version, in_rpcs3: false })
}

// --------------------------------------------------------------- RPCS3 ----

/// An RPCS3 program, told by the name in its file details (Product name /
/// File description), or by its file name when it has none.
pub fn is_rpcs3(exe: &Path) -> bool {
    let vi = crate::gamesrc::version_info(exe);
    let says = [vi.product_name, vi.file_description].into_iter().flatten().any(|s| s.to_lowercase().contains("rpcs3"));
    says || exe.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case("rpcs3.exe")).unwrap_or(false)
}

/// RPCS3's program in this folder (or one folder down).
pub fn find_rpcs3(dir: &Path) -> Option<PathBuf> {
    let exes = |d: &Path| -> Vec<PathBuf> {
        fs::read_dir(d).into_iter().flatten().flatten().map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().map(|x| x.eq_ignore_ascii_case("exe")).unwrap_or(false)).collect()
    };
    if let Some(e) = exes(dir).into_iter().find(|p| is_rpcs3(p)) { return Some(e); }
    for sub in fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        if let Some(e) = exes(&sub).into_iter().find(|p| is_rpcs3(p)) { return Some(e); }
    }
    None
}

/// Where an RPCS3 install keeps one of its folders (its Virtual File System settings,
/// config\vfs.yml -- vfs.yml in older versions --: "/dev_hdd0/: E:/PS3/dev_hdd0/" or
/// "$(EmulatorDir)dev_hdd0/"); None: where it always is, in its own folder.
pub fn vfs_dir(rpcs3_dir: &Path, key: &str) -> Option<PathBuf> {
    let t = ["config/vfs.yml", "vfs.yml"].iter().find_map(|f| fs::read_to_string(rpcs3_dir.join(f)).ok())?;
    let unq = |v: &str| v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
    let mut vals: HashMap<String, String> = HashMap::new();
    for l in t.lines() {
        // (only the top level: "  /dev_usb000:" and its "Path:" are a device's own settings)
        if l.starts_with(' ') || l.starts_with('\t') { continue; }
        let (k, v) = match l.split_once(": ") { Some((k, v)) => (k, v), None => match l.strip_suffix(':') { Some(k) => (k, ""), None => continue } };
        vals.insert(unq(k).to_lowercase(), unq(v));
    }
    let raw = vals.get(&key.to_lowercase())?.clone();
    if raw.is_empty() { return None; }
    // ($(EmulatorDir): the install's folder, or the one set for it)
    let emu = vals.get("$(emulatordir)").filter(|v| !v.is_empty()).map(|v| v.replace('\\', "/"))
        .unwrap_or_else(|| format!("{}/", rpcs3_dir.display().to_string().replace('\\', "/").trim_end_matches('/')));
    let emu = if emu.ends_with('/') { emu } else { format!("{emu}/") };
    let v = raw.replace("$(EmulatorDir)", &emu);
    let p = PathBuf::from(v.trim_end_matches(['/', '\\']));
    let p = if p.is_absolute() { p } else { rpcs3_dir.join(p) };
    Some(p)
}
/// An RPCS3 install's dev_hdd0 (its games installed from .pkg files, its trophies and
/// saves): its own, or the one its settings point at.
pub fn hdd_dir(rpcs3_dir: &Path) -> PathBuf {
    vfs_dir(rpcs3_dir, "/dev_hdd0/").filter(|d| d.is_dir()).unwrap_or_else(|| rpcs3_dir.join("dev_hdd0"))
}
/// An RPCS3 install's folders kept elsewhere that hold games (its dev_hdd0, its games folder),
/// that aren't inside it: read with it.
pub fn moved_dirs(rpcs3_dir: &Path) -> Vec<PathBuf> {
    let own = rpcs3_dir.canonicalize().unwrap_or_else(|_| rpcs3_dir.to_path_buf());
    ["/dev_hdd0/", "/games/"].iter().filter_map(|k| vfs_dir(rpcs3_dir, k)).filter(|d| d.is_dir())
        .filter(|d| !d.canonicalize().unwrap_or_else(|_| d.clone()).starts_with(&own)).collect()
}

/// Folders inside RPCS3 that never hold games.
const SKIP: &[&str] = &[
    "dev_flash", "dev_flash2", "dev_flash3", "dev_hdd1", "dev_bdvd", "home", "savedata", "cache", "shaderlog",
    "log", "logs", "config", "guiconfigs", "icons", "imageformats", "platforms", "styles", "iconengines",
    "qtwebengine_locales", "translations", "test", "patches", "captures", "screenshots", "recordings",
    "data", "vfs", "trophy", "photo", "music", "video", "tmp", "crash_report", "sounds", "git", "printsupport",
    "multimedia", "tls", "networkinformation",
];

/// Every PS3 game in an RPCS3 install: its games folder, dev_hdd0\game,
/// dev_hdd0\disc, any other folder in it, and the folders listed in its
/// games.yml (games added to RPCS3 from elsewhere).
pub fn games_in(rpcs3_dir: &Path) -> Vec<Ps3Game> {
    let mut out: Vec<Ps3Game> = Vec::new();
    fn walk(d: &Path, depth: usize, out: &mut Vec<Ps3Game>) {
        if let Some(g) = game_at(d) { out.push(g); return; }
        if depth >= 4 { return; }
        for e in fs::read_dir(d).into_iter().flatten().flatten() {
            let p = e.path();
            // (a disc image: its game)
            if is_iso(&p) { if let Some(g) = iso_game(&p) { out.push(g); } continue; }
            if !p.is_dir() { continue; }
            let n = e.file_name().to_string_lossy().to_lowercase();
            if SKIP.contains(&n.as_str()) || n.starts_with('.') { continue; }
            walk(&p, depth + 1, out);
        }
    }
    walk(rpcs3_dir, 0, &mut out);
    // (its dev_hdd0 or games folder kept elsewhere: the games there too)
    for d in moved_dirs(rpcs3_dir) { walk(&d, 0, &mut out); }
    // games.yml: "BLUS12345: C:/Games/Some Game/" (one per line): the games
    // RPCS3 has added to its list
    let mut listed: std::collections::HashSet<String> = std::collections::HashSet::new();
    for yml in ["games.yml", "config/games.yml"] {
        let Ok(t) = fs::read_to_string(rpcs3_dir.join(yml)) else { continue };
        for line in t.lines() {
            let Some((id, path)) = line.split_once(':') else { continue };
            let id = id.trim().trim_matches(|c| c == '"' || c == '\'').to_uppercase();
            let path = path.trim().trim_matches(|c| c == '"' || c == '\'');
            if path.is_empty() { continue; }
            let p = if Path::new(path).is_absolute() { PathBuf::from(path) } else { rpcs3_dir.join(path) };
            // (only an entry whose folder is still there: RPCS3 can't start
            // one that was moved or deleted by its Title ID either)
            if let Some(g) = iso_game(&p).or_else(|| game_at(&p)).or_else(|| p.parent().and_then(game_at)) {
                if !id.is_empty() && g.title_id.trim().eq_ignore_ascii_case(&id) { listed.insert(id); }
                out.push(g);
            }
        }
    }
    // RPCS3 starts a game by its Title ID only when it's in its list
    // (games.yml): one installed in its dev_hdd0 but never added there, or a
    // disc copy never added, answers "Invalid file or folder", so those are
    // started by their EBOOT.BIN (as RPCS3 itself does from its game list)
    for g in out.iter_mut() {
        g.in_rpcs3 = listed.contains(&g.title_id.trim().to_uppercase());
    }
    // each game once (the same game listed in games.yml and found in the folder)
    let mut seen = std::collections::HashSet::new();
    out.retain(|g| seen.insert(g.dir.canonicalize().unwrap_or_else(|_| g.dir.clone()).display().to_string().to_lowercase()));
    out
}

// --------------------------------------------------------------- media ----

fn ffmpeg_cmd(ffmpeg: &Path) -> Command {
    let mut c = Command::new(ffmpeg);
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    c.args(["-hide_banner", "-loglevel", "error", "-y"]);
    c
}
fn run_ok(mut c: Command, out: &Path) -> bool {
    let ok = c.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status()
        .map(|s| s.success()).unwrap_or(false);
    let good = ok && fs::metadata(out).map(|m| m.len() > 0).unwrap_or(false);
    if !good { let _ = fs::remove_file(out); }
    good
}

/// ICON1.PAM (a PAMF video) → an MP4 the app can play.
fn pam_to_mp4(ffmpeg: &Path, pam: &Path, out: &Path) -> bool {
    // the video as it is, then re-encoded, then read past the PAMF header
    let tries: [&[&str]; 3] = [
        &["-c:v", "copy"],
        &["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18"],
        &["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18"],
    ];
    for (i, enc) in tries.iter().enumerate() {
        let mut c = ffmpeg_cmd(ffmpeg);
        if i == 2 { c.args(["-skip_initial_bytes", "2048", "-f", "mpeg"]); }
        c.arg("-i").arg(pam).args(["-an", "-map", "0:v:0"]).args(*enc).args(["-movflags", "+faststart"]).arg(out);
        if run_ok(c, out) { return true; }
    }
    false
}

/// SND0.AT3 (ATRAC3) → FLAC (lossless from here on).
fn at3_to_flac(ffmpeg: &Path, at3: &Path, out: &Path) -> bool {
    let mut c = ffmpeg_cmd(ffmpeg);
    c.arg("-i").arg(at3).args(["-vn", "-c:a", "flac", "-compression_level", "8"]).arg(out);
    run_ok(c, out)
}


/// Put a PS3 game's media into its folder in content\Games: icon,
/// background, preview and music, in the place of the program's own icon or
/// what the game databases found by themselves (what you chose, changed or
/// removed in Game Settings, or Get Art Online found for it, is kept).
/// `over_only`: only where the game has something less important now (the
/// databases' art found for it earlier), nothing that's simply missing.
pub fn fill_media(out_dir: &Path, content: &Path, ffmpeg: Option<&Path>) { fill_media_ex(out_dir, content, ffmpeg, false) }
pub fn fill_media_ex(out_dir: &Path, content: &Path, ffmpeg: Option<&Path>, over_only: bool) {
    use crate::gameart::{art_source, mark_source, set_media, SRC_PS3};
    let may_replace = |dir: &Path, kind: &str, src: &str| {
        if over_only && art_source(dir, kind).is_none() { return false; }
        crate::gameart::may_replace(dir, kind, src)
    };
    // (an installed game put into content\Games itself: its ICON0.PNG and
    // PIC1.PNG are already where the library looks; they're never copied over
    // or deleted, only counted as the game's own)
    let same = out_dir.canonicalize().ok() == content.canonicalize().ok();
    let put = |kind: &str, file: &Path| {
        if same && file.parent().and_then(|p| p.canonicalize().ok()) == out_dir.canonicalize().ok() && matches!(kind, "icon" | "background") {
            mark_source(out_dir, kind, SRC_PS3); return;
        }
        if set_media(out_dir, kind, Some(file)).is_ok() { mark_source(out_dir, kind, SRC_PS3); }
    };
    if may_replace(out_dir, "icon", SRC_PS3) {
        if let Some(p) = child_ci(content, "ICON0.PNG") { put("icon", &p); }
    }
    if may_replace(out_dir, "background", SRC_PS3) {
        if let Some(p) = child_ci(content, "PIC1.PNG").or_else(|| child_ci(content, "PIC0.PNG")) { put("background", &p); }
    }
    let Some(ff) = ffmpeg else { return };
    let tmp = out_dir.join(".ps3media");
    if may_replace(out_dir, "preview", SRC_PS3) {
        if let Some(p) = child_ci(content, "ICON1.PAM") {
            let _ = fs::create_dir_all(&tmp);
            let out = tmp.join("preview.mp4");
            if pam_to_mp4(ff, &p, &out) { put("preview", &out); }
        }
    }
    if may_replace(out_dir, "music", SRC_PS3) {
        if let Some(p) = child_ci(content, "SND0.AT3") {
            let _ = fs::create_dir_all(&tmp);
            let out = tmp.join("music.flac");
            if at3_to_flac(ff, &p, &out) { put("music", &out); }
        }
    }
    let _ = fs::remove_dir_all(&tmp);
}

/// The arguments that start a game in RPCS3 (without its own window).
/// A game RPCS3 has in its own list is started by its Title ID, exactly as
/// RPCS3 starts it from its game list (its licences and the files it
/// installed are used, so nothing fails to decrypt); any other game by its
/// folder (a disc copy) or its EBOOT.BIN (an installed game).
pub fn rpcs3_args(g: &Ps3Game) -> Vec<String> {
    if g.in_rpcs3 && !g.title_id.trim().is_empty() {
        return vec!["--no-gui".into(), format!("%RPCS3_GAMEID%:{}", g.title_id.trim())];
    }
    // (the EBOOT.BIN: RPCS3 answers "Invalid file or folder" to a game's folder; a disc image: the image)
    let boot = g.eboot.clone().unwrap_or_else(|| g.dir.clone());
    vec!["--no-gui".into(), boot.display().to_string()]
}
/// What a PS3 game is known by in the list of recognized games.
pub fn key(g: &Ps3Game) -> String { g.eboot.clone().unwrap_or_else(|| g.dir.clone()).display().to_string() }

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn sfo(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut keys = Vec::new();
        let mut data = Vec::new();
        let mut idx = Vec::new();
        for (k, v) in entries {
            let ko = keys.len() as u16;
            keys.extend_from_slice(k.as_bytes()); keys.push(0);
            let off = data.len() as u32;
            let mut d = v.as_bytes().to_vec(); d.push(0);
            let len = d.len() as u32;
            while d.len() % 4 != 0 { d.push(0); }
            idx.extend_from_slice(&ko.to_le_bytes());
            idx.extend_from_slice(&0x0204u16.to_le_bytes());
            idx.extend_from_slice(&len.to_le_bytes());
            idx.extend_from_slice(&(d.len() as u32).to_le_bytes());
            idx.extend_from_slice(&off.to_le_bytes());
            data.extend(d);
        }
        while keys.len() % 4 != 0 { keys.push(0); }
        let kstart = 20 + idx.len() as u32;
        let dstart = kstart + keys.len() as u32;
        let mut b = b"\0PSF".to_vec();
        b.extend_from_slice(&0x0101u32.to_le_bytes());
        b.extend_from_slice(&kstart.to_le_bytes());
        b.extend_from_slice(&dstart.to_le_bytes());
        b.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        b.extend(idx); b.extend(keys); b.extend(data);
        b
    }

    // PS3 disc images (.iso), as RPCS3 loads them: in its folder, in its games.yml, or in
    // a source folder; their files copied once into the app's cache; started by the image
    #[test]
    fn disc_images_are_games() {
        let _iso = ISO_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = std::env::temp_dir().join(format!("xmb-ps3iso-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        set_iso_cache(root.join("cache"));
        let img = crate::iso::tests::make_iso(&[
            ("PS3_DISC.SFB", b".SFB"),
            ("PS3_GAME/PARAM.SFO", &sfo(&[("TITLE", "Iso\nGame"), ("TITLE_ID", "BLUS30443"), ("CATEGORY", "DG"), ("APP_VER", "01.02")])),
            ("PS3_GAME/ICON0.PNG", b"png"), ("PS3_GAME/PIC1.PNG", b"pic"),
            ("PS3_GAME/TROPDIR/NPWR00443_00/TROPHY.TRP", b"trp"),
            ("PS3_GAME/USRDIR/EBOOT.BIN", b"big"),
        ]);
        let rp = root.join("RPCS3"); fs::create_dir_all(rp.join("games")).unwrap();
        fs::write(rp.join("games").join("Iso Game.iso"), &img).unwrap();
        let g = iso_game(&rp.join("games").join("Iso Game.iso")).unwrap();
        assert_eq!((g.title.as_str(), g.title_id.as_str(), g.version.as_str()), ("Iso Game", "BLUS30443", "1.02"));
        assert!(g.content.join("ICON0.PNG").is_file() && g.content.join("PIC1.PNG").is_file());
        assert!(g.content.join("TROPDIR").join("NPWR00443_00").join("TROPHY.TRP").is_file());
        // (only the small files: not the game's program)
        assert!(!g.content.join("USRDIR").exists());
        assert_eq!(key(&g), rp.join("games").join("Iso Game.iso").display().to_string());
        assert_eq!(rpcs3_args(&g), vec!["--no-gui".to_string(), rp.join("games").join("Iso Game.iso").display().to_string()]);
        // found in RPCS3's folder; one listed in its games.yml from elsewhere, started by its Title ID
        let other = root.join("Elsewhere"); fs::create_dir_all(&other).unwrap();
        let img2 = crate::iso::tests::make_iso(&[("PS3_GAME/PARAM.SFO", &sfo(&[("TITLE", "Second"), ("TITLE_ID", "BLES00002"), ("CATEGORY", "DG")]))]);
        fs::write(other.join("second.ISO"), &img2).unwrap();
        fs::create_dir_all(rp.join("config")).unwrap();
        fs::write(rp.join("config").join("games.yml"), format!("BLES00002: {}\n", other.join("second.ISO").display())).unwrap();
        let mut all = games_in(&rp);
        all.sort_by(|a, b| a.title.cmp(&b.title));
        assert_eq!(all.iter().map(|g| g.title.as_str()).collect::<Vec<_>>(), vec!["Iso Game", "Second"]);
        assert!(all[1].in_rpcs3 && rpcs3_args(&all[1])[1] == "%RPCS3_GAMEID%:BLES00002");
        // a dumped disc whose PARAM.SFO can't be read: its name, and PS3_DISC.SFB's Title ID
        let mut sfb = vec![0u8; 0x300]; sfb[0..4].copy_from_slice(b".SFB"); sfb[0x20..0x28].copy_from_slice(b"TITLE_ID");
        sfb[0x30..0x34].copy_from_slice(&0x220u32.to_be_bytes()); sfb[0x34..0x38].copy_from_slice(&0x10u32.to_be_bytes()); sfb[0x220..0x22d].copy_from_slice(b"BLUS31606-ABC");
        let img3 = crate::iso::tests::make_iso(&[("PS3_DISC.SFB", &sfb), ("PS3_GAME/PARAM.SFO", b"encrypted....")]);
        fs::write(other.join("Dumped Disc.iso"), &img3).unwrap();
        let d = iso_game(&other.join("Dumped Disc.iso")).unwrap();
        assert_eq!((d.title.as_str(), d.title_id.as_str()), ("Dumped Disc", "BLUS31606"));
        // (not a PS3 disc, not an image: nothing)
        fs::write(other.join("data.iso"), crate::iso::tests::make_iso(&[("README.TXT", b"x")])).unwrap();
        assert!(iso_game(&other.join("data.iso")).is_none());
        fs::write(other.join("bad.iso"), b"nope").unwrap();
        assert!(iso_game(&other.join("bad.iso")).is_none());
        // Game Recognition: RPCS3's folder as a source, and a folder of images as another
        fs::write(rp.join("rpcs3.exe"), b"MZ").unwrap();
        let games = root.join("out"); fs::create_dir_all(&games).unwrap();
        let rec = root.join("rec.json");
        let made = crate::gamesrc::sync(&[rp.display().to_string(), other.display().to_string()], &games, &rec, None, &|_, _| {});
        let names: Vec<String> = made.iter().map(|d| d.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert!(names.contains(&"Iso Game".to_string()) && names.contains(&"Second".to_string()) && names.contains(&"Dumped Disc".to_string()), "{names:?}");
        assert_eq!(names.iter().filter(|n| n.as_str() == "Second").count(), 1, "one game, found twice: {names:?}");
        let ig = games.join("Iso Game");
        assert!(ig.join("icon.png").is_file() && ig.join("background.png").is_file());
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(ig.join("game.json")).unwrap()).unwrap();
        assert_eq!(v["ps3Key"], rp.join("games").join("Iso Game.iso").display().to_string());
        assert!(crate::gamesrc::sync(&[rp.display().to_string(), other.display().to_string()], &games, &rec, None, &|_, _| {}).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    // RPCS3's folders kept elsewhere (its Virtual File System settings): its games there found
    // with it, started by it; the same folder shared by two installs: each game once
    #[test]
    fn rpcs3_folders_kept_elsewhere() {
        let root = std::env::temp_dir().join(format!("xmb-ps3vfs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let rp = root.join("RPCS3"); let rp2 = root.join("RPCS3 Other");
        let hdd = root.join("Shared HDD"); let gms = root.join("Disc Games");
        for d in [&rp, &rp2] { fs::create_dir_all(d.join("config")).unwrap(); fs::write(d.join("rpcs3.exe"), b"MZ").unwrap(); }
        let fwd = |p: &Path| p.display().to_string().replace('\\', "/");
        fs::write(rp.join("config").join("vfs.yml"), format!("$(EmulatorDir): \"\"\n/dev_hdd0: x\n/dev_hdd0/: \"{}/\"\n/dev_flash/: $(EmulatorDir)dev_flash/\n/games/: {}/\n/dev_usb***/:\n  /dev_usb000:\n    Path: $(EmulatorDir)dev_usb000/\n", fwd(&hdd), fwd(&gms))).unwrap();
        // (an older RPCS3: vfs.yml in its own folder, the same dev_hdd0)
        fs::write(rp2.join("vfs.yml"), format!("/dev_hdd0/: {}\\\n", hdd.display())).unwrap();
        let hg = hdd.join("game").join("NPUB00009"); fs::create_dir_all(hg.join("USRDIR")).unwrap();
        fs::write(hg.join("PARAM.SFO"), sfo(&[("TITLE", "Shared Hdd Game"), ("TITLE_ID", "NPUB00009"), ("CATEGORY", "HG")])).unwrap();
        fs::write(hg.join("USRDIR").join("EBOOT.BIN"), b"x").unwrap();
        let dg = gms.join("Disc One").join("PS3_GAME"); fs::create_dir_all(dg.join("USRDIR")).unwrap();
        fs::write(dg.join("PARAM.SFO"), sfo(&[("TITLE", "Disc One"), ("TITLE_ID", "BLUS00010"), ("CATEGORY", "DG")])).unwrap();
        fs::write(dg.join("USRDIR").join("EBOOT.BIN"), b"x").unwrap();
        assert_eq!(hdd_dir(&rp), hdd); assert_eq!(hdd_dir(&rp2), hdd);
        assert_eq!(hdd_dir(&root.join("Nothing")), root.join("Nothing").join("dev_hdd0"));
        let mut t: Vec<String> = games_in(&rp).into_iter().map(|g| g.title).collect(); t.sort();
        assert_eq!(t, vec!["Disc One", "Shared Hdd Game"]);
        // Game Recognition with both installs: each game once, started by the first one read
        let games = root.join("out"); fs::create_dir_all(&games).unwrap();
        let made = crate::gamesrc::sync(&[rp.display().to_string(), rp2.display().to_string()], &games, &root.join("rec.json"), None, &|_, _| {});
        let names: Vec<String> = made.iter().map(|d| d.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names.iter().filter(|n| n.starts_with("Shared Hdd Game")).count(), 1, "{names:?}");
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(games.join("Shared Hdd Game").join("game.json")).unwrap()).unwrap();
        let li = crate::gamesrc::parse_lnk(&fs::read(games.join("Shared Hdd Game").join(v["launch"].as_str().unwrap())).unwrap()).unwrap();
        assert_eq!(li.target.as_deref().map(PathBuf::from), Some(rp.join("rpcs3.exe")));
        // (the moved folder on a drive that isn't there: as if it weren't set)
        fs::write(rp2.join("vfs.yml"), "/dev_hdd0/: Q:/Gone/dev_hdd0/\n").unwrap();
        assert_eq!(hdd_dir(&rp2), rp2.join("dev_hdd0"));
        assert!(moved_dirs(&rp2).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_sfo_and_finds_games() {
        let m = parse_sfo(&sfo(&[("TITLE", "My\nGame"), ("TITLE_ID", "BLUS00001"), ("CATEGORY", "DG")])).unwrap();
        assert_eq!(m["TITLE_ID"], "BLUS00001");

        let root = std::env::temp_dir().join(format!("xmb-ps3-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        // a disc copy in games\, an installed game and its update in dev_hdd0\game
        let disc = root.join("games").join("Disc Game").join("PS3_GAME");
        fs::create_dir_all(disc.join("USRDIR")).unwrap();
        fs::write(disc.join("PARAM.SFO"), sfo(&[("TITLE", "Disc\nGame"), ("TITLE_ID", "BLES00002"), ("CATEGORY", "DG")])).unwrap();
        fs::write(disc.join("USRDIR").join("EBOOT.BIN"), b"x").unwrap();
        let hdd = root.join("dev_hdd0").join("game").join("NPUB00003");
        fs::create_dir_all(hdd.join("USRDIR")).unwrap();
        fs::write(hdd.join("PARAM.SFO"), sfo(&[("TITLE", "Hdd Game"), ("TITLE_ID", "NPUB00003"), ("CATEGORY", "HG")])).unwrap();
        fs::write(hdd.join("USRDIR").join("EBOOT.BIN"), b"x").unwrap();
        let upd = root.join("dev_hdd0").join("game").join("BLES00002");
        fs::create_dir_all(upd.join("USRDIR")).unwrap();
        fs::write(upd.join("PARAM.SFO"), sfo(&[("TITLE", "Disc Game"), ("CATEGORY", "GD")])).unwrap();
        fs::write(upd.join("USRDIR").join("EBOOT.BIN"), b"x").unwrap();

        let mut g = games_in(&root);
        g.sort_by(|a, b| a.title.cmp(&b.title));
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].title, "Disc Game");
        assert!(g[0].content.ends_with("PS3_GAME"));
        assert!(g[0].eboot.is_some());
        assert_eq!(g[1].title_id, "NPUB00003");

        // RPCS3 in a source folder: both games get a folder that starts them in it
        fs::write(root.join("rpcs3.exe"), b"MZ").unwrap();
        fs::write(disc.join("ICON0.PNG"), b"png").unwrap();
        fs::write(disc.join("PIC1.PNG"), b"png").unwrap();
        let games = root.join("out");
        fs::create_dir_all(&games).unwrap();
        let rec = root.join("rec.json");
        let made = crate::gamesrc::sync(&[root.display().to_string()], &games, &rec, None, &|_, _| {});
        let names: Vec<String> = made.iter().map(|d| d.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert!(names.contains(&"Disc Game".to_string()) && names.contains(&"Hdd Game".to_string()), "{names:?}");
        let dg = games.join("Disc Game");
        assert!(dg.join("icon.png").exists() && dg.join("background.png").exists());
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(dg.join("game.json")).unwrap()).unwrap();
        assert_eq!(v["console"], "PS3");
        // started by a shortcut in its folder, like RPCS3's own: RPCS3 without its window
        let lnk = |d: &Path, v: &serde_json::Value| crate::gamesrc::parse_lnk(&fs::read(d.join(v["launch"].as_str().unwrap())).unwrap()).unwrap();
        assert!(v["launch"].as_str().unwrap().ends_with(".lnk"));
        let li = lnk(&dg, &v);
        assert!(li.target.as_deref().unwrap().ends_with("rpcs3.exe"));
        assert_eq!(li.work_dir.as_deref(), Some(root.display().to_string().as_str()));
        let a = li.args.unwrap();
        // (a disc copy RPCS3 hasn't added to its list: its EBOOT.BIN)
        assert!(a.starts_with("--no-gui \"") && a.ends_with("EBOOT.BIN\""), "{a}");
        assert_eq!(v["args"], serde_json::json!([]));
        // (installed in RPCS3's dev_hdd0 but not in its games.yml: its EBOOT.BIN too)
        let hv: serde_json::Value = serde_json::from_str(&fs::read_to_string(games.join("Hdd Game").join("game.json")).unwrap()).unwrap();
        assert!(lnk(&games.join("Hdd Game"), &hv).args.unwrap().ends_with("EBOOT.BIN\""));
        // added to RPCS3's list (games.yml): the next look starts it by its Title ID
        fs::write(root.join("games.yml"), "BLES00002: games/Disc Game/\n").unwrap();
        let _ = crate::gamesrc::sync(&[root.display().to_string()], &games, &rec, None, &|_, _| {});
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(dg.join("game.json")).unwrap()).unwrap();
        assert_eq!(lnk(&dg, &v).args.as_deref(), Some("--no-gui \"%RPCS3_GAMEID%:BLES00002\""));
        assert_eq!(v["ps3Lnk"][1], "%RPCS3_GAMEID%:BLES00002");
        // a game made by an older version (the app's link to RPCS3 and its
        // arguments) gets a shortcut too
        let old = games.join("Hdd Game");
        for e in fs::read_dir(&old).unwrap().flatten() { if e.path().extension().map(|x| x == "lnk").unwrap_or(false) { fs::remove_file(e.path()).unwrap(); } }
        crate::medialib::write_link(&old.join("Hdd Game.xmbl"), &root.join("rpcs3.exe")).unwrap();
        let mut ov: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&fs::read_to_string(old.join("game.json")).unwrap()).unwrap();
        ov.insert("launch".into(), "Hdd Game.xmbl".into()); ov.insert("args".into(), serde_json::json!(["--no-gui", "x"])); ov.remove("ps3Lnk");
        fs::write(old.join("game.json"), serde_json::to_string(&ov).unwrap()).unwrap();
        let _ = crate::gamesrc::sync(&[root.display().to_string()], &games, &rec, None, &|_, _| {});
        let hv: serde_json::Value = serde_json::from_str(&fs::read_to_string(old.join("game.json")).unwrap()).unwrap();
        assert!(hv["launch"].as_str().unwrap().ends_with(".lnk"), "{hv}");
        assert!(!old.join("Hdd Game.xmbl").exists());
        assert!(lnk(&old, &hv).args.unwrap().ends_with("EBOOT.BIN\""));
        // the library read: a PS3 game keeps its own source folder (not RPCS3's,
        // which its shortcut points at) and gives its Title ID
        let sd = |d: &Path| -> serde_json::Value { serde_json::from_str::<serde_json::Value>(&fs::read_to_string(d.join("game.json")).unwrap()).unwrap()["sourceDir"].clone() };
        let before = sd(&dg);
        let listed = crate::library::scan(&[games.display().to_string()], None);
        assert_eq!(sd(&dg), before, "the source folder stays the game's");
        assert_ne!(before.as_str(), Some(root.display().to_string().as_str()));
        assert_eq!(listed.iter().find(|g| g.title == "Disc Game").unwrap().title_id, "BLES00002");
        // a second look adds nothing
        assert!(crate::gamesrc::sync(&[root.display().to_string()], &games, &rec, None, &|_, _| {}).iter()
            .all(|d| !d.file_name().unwrap().to_string_lossy().contains("Game")));
        let _ = fs::remove_dir_all(&root);
    }
}
