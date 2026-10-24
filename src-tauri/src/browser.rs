//! Bundled-engine Internet Browser (LibreWolf / Gecko).
//!
//! How it works:
//!   * LibreWolf runs on YOUR profile — the portable launcher's
//!     `content/Browser/Profiles/Default` — so your settings, default search
//!     engine, extensions and userscripts all apply. (Falls back to the older
//!     in-app profile only if that's the one that exists.)
//!   * The app opens a new LibreWolf window on a tiny local bootstrap page. The
//!     bundled helper extension turns that ONE window into the XMB window: it
//!     marks it (title preface "[XMB] "), sizes it to the centered panel and
//!     opens your default search engine / home page / URL. A scoped userChrome
//!     rule hides the toolbars in that window only; your normal windows are
//!     untouched.
//!   * The app finds the window by that title marker (LibreWolf's launcher
//!     process re-spawns the real browser, so the PID we start is useless),
//!     then a watchdog keeps it centered, sized and topmost and notices when it
//!     closes. Closing uses WM_CLOSE so LibreWolf shuts down cleanly.
//!   * Controller: read natively (gamepad.rs) because the webview gets no
//!     gamepad input while LibreWolf has focus. The right stick moves the real
//!     pointer, Cross presses / releases the left button (so drags work), L2/R2
//!     scroll, and every press is forwarded to the app as an `xmb-pad` event.
//!     Typing from the on-screen keyboard is inserted by the helper.
//!   * The pointer is confined to the page (ClipCursor) so the window's edges
//!     can't be grabbed to stretch or move it.
//!   * All commands run off the main thread (`command(async)`), and a launch
//!     guard prevents double launches.
//!
//! Window control and input synthesis are Windows-only (the shipping target);
//! elsewhere those parts are no-ops so the rest still builds.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::AppHandle;

// ---- bundled helper-extension sources (baked into the binary) --------------
const EXT_MANIFEST_TMPL: &str = include_str!("../browser-ext/manifest.json");
const EXT_BACKGROUND_JS: &str = include_str!("../browser-ext/background.js");
const EXT_HELPER_JS: &str = include_str!("../browser-ext/helper.js");

// Windows cursors swapped in while browsing (all share one tip position).
const CURF_ARROW: &[u8] = include_bytes!("../browser-ext/cursors/arrow.cur");
const CURF_FINGER: &[u8] = include_bytes!("../browser-ext/cursors/finger.cur");
const CURF_PEN: &[u8] = include_bytes!("../browser-ext/cursors/pen.cur");
const CURF_HAND: &[u8] = include_bytes!("../browser-ext/cursors/hand.cur");
// pressing (short index finger) and dragging (closed fist): swapped in by the
// helper while the button is down, the same way and size as the others
const CURF_CLICK: &[u8] = include_bytes!("../browser-ext/cursors/click.cur");
const CURF_GRAB: &[u8] = include_bytes!("../browser-ext/cursors/grab.cur");
/// Where the cursor files were written (for the press / drag swaps).
#[cfg_attr(not(windows), allow(dead_code))]
static CURSOR_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

const HELPER_EXT_ID: &str = "xmb-helper@ps3xmb.local";
const UBO_ID: &str = "uBlock0@raymondhill.net";
const UBO_XPI: &str = "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi";
const VM_ID: &str = "{aecec67f-0d10-4fa7-b7c7-609a2db280cf}";
const VM_XPI: &str = "https://addons.mozilla.org/firefox/downloads/latest/violentmonkey/latest.xpi";
const PORT: u16 = 48219;

const UJS_BEGIN: &str = "// >>> XMB launcher (managed block: edits inside it are overwritten)";
const UJS_END: &str = "// <<< XMB launcher";
const UCSS_BEGIN: &str = "/* >>> XMB launcher (managed block: edits inside it are overwritten) */";
const UCSS_END: &str = "/* <<< XMB launcher */";
// headers of the files older builds wrote wholesale (they get replaced)
const OLD_UJS_HEADER: &str = "// Managed by PS3 XMB Launcher";
const OLD_UCSS_HEADER: &str = "/* Managed by PS3 XMB Launcher";

const XUL_KEY: &str = "chrome://browser/content/browser.xhtml";

// ---------------------------------------------------------------------------
// session state
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Session {
    gen: u64,
    open: bool,
    phase: String,
    token: String,
    mode: String,
    value: String,
    rect: (i32, i32, i32, i32),     // panel in physical px
    css: (f64, f64, f64, f64),      // the same panel in CSS px (for the helper)
    hidden: bool,
    hwnd: isize,
    marked: bool,
    started: Option<Instant>,
    focus: bool,
    focus_seq: u64,
    focus_value: String,
    focus_replace: bool,
    focus_password: bool,
    title: String,
    url: String,
    hover: String,
    cmds: Vec<Value>,
    profile: PathBuf,
    // Some(prev) when we snapshotted the window geometry LibreWolf remembers,
    // so your own LibreWolf doesn't reopen at the panel's size afterwards.
    xul_snapshot: Option<Option<Value>>,
    // LibreWolf's folder: its windows are recognised by their program's path
    bin_dir: PathBuf,
    // LibreWolf windows that were already open before this launch (left alone)
    #[cfg_attr(not(windows), allow(dead_code))]
    pre_windows: Vec<isize>,
    // new LibreWolf windows kept hidden until they're in place (or closed at the end)
    parked: Vec<isize>,
    // L3: the page fills the whole screen (and the pointer may roam all of it)
    fullscreen: bool,
    // the window has reached its spot (until then it's kept behind the app)
    settled: bool,
    // LibreWolf's own full screen (F11, a video's full screen button)
    lw_fullscreen: bool,
}

fn session() -> &'static Mutex<Session> {
    static S: OnceLock<Mutex<Session>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Session::default()))
}
fn sess() -> MutexGuard<'static, Session> {
    session().lock().unwrap_or_else(|e| e.into_inner())
}

static LAUNCHING: AtomicBool = AtomicBool::new(false);
/// Virtual-key code of the screenshot key while the browser has focus (F12).
static SHOT_VK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0x7B);
/// The key (KeyboardEvent.code) that switches to the next tab while browsing
/// ("Tab"; "" = none). Handled inside the page by the helper.
static TAB_CODE: Mutex<String> = Mutex::new(String::new());
static TAB_CODE_SET: AtomicBool = AtomicBool::new(false);
/// The same key as a Windows virtual-key code, read directly while LibreWolf
/// has focus (Tab = 0x09; 0 = none)
static TAB_VK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0x09);
fn tab_code() -> String {
    if !TAB_CODE_SET.load(Ordering::SeqCst) { return "Tab".into(); }
    TAB_CODE.lock().map(|c| c.clone()).unwrap_or_default()
}
static SERVER_UP: AtomicBool = AtomicBool::new(false);

/// L3: full screen on / off. It's LibreWolf's own full screen (as F11): the
/// page is laid out again for the whole screen by LibreWolf itself. (Resizing
/// the window to the screen from outside left the page drawn at its old size
/// in the top left corner now and then, and from then on every time.) Only
/// without the helper extension is the window itself stretched over the screen.
fn toggle_fullscreen(gen: u64) {
    let mut st = sess();
    if st.gen != gen || !st.open { return; }
    if st.lw_fullscreen {
        st.fullscreen = false;
        st.cmds.push(json!({ "cmd": "exitfullscreen", "value": null }));
    } else if st.fullscreen {
        st.fullscreen = false;
    } else if st.phase == "nohelper" {
        st.fullscreen = true;
    } else {
        st.cmds.push(json!({ "cmd": "enterfullscreen", "value": null }));
    }
}

/// Where the page goes: the panel, or (full screen) the whole monitor.
fn page_rect(st: &Session) -> (i32, i32, i32, i32) {
    #[cfg(windows)]
    if (st.fullscreen || st.lw_fullscreen) && st.hwnd != 0 {
        let r = win::monitor_rect(st.hwnd);
        if r.2 > 0 && r.3 > 0 { return r; }
    }
    st.rect
}

fn set_phase(p: &str) {
    sess().phase = p.to_string();
}

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

/// The portable build the WinUpdater unpacks into content/Browser/LibreWolf
/// first, then common install locations.
fn find_librewolf(app: &AppHandle) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "librewolf.exe" } else { "librewolf" };
    let bdir = crate::paths::browser_dir(app);
    let mut cands: Vec<PathBuf> = vec![
        bdir.join("LibreWolf").join(exe),
        bdir.join("librewolf").join(exe),
        bdir.join(exe),
    ];
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Ok(base) = std::env::var(var) {
                cands.push(PathBuf::from(base).join("LibreWolf").join(exe));
            }
        }
    } else {
        for p in ["/usr/bin/librewolf", "/usr/local/bin/librewolf", "/opt/librewolf/librewolf"] {
            cands.push(PathBuf::from(p));
        }
    }
    cands.into_iter().find(|p| p.is_file())
}

/// The profile LibreWolf runs on: the portable launcher's Profiles\Default
/// (where you configure LibreWolf), or the older in-app profile if that's the
/// only one that has ever been used.
fn profile_dir(app: &AppHandle) -> PathBuf {
    let b = crate::paths::browser_dir(app);
    let portable = b.join("Profiles").join("Default");
    let legacy = b.join("profile");
    if portable.is_dir() {
        portable
    } else if legacy.join("prefs.js").is_file() {
        legacy
    } else {
        portable
    }
}

/// True while a LibreWolf instance holds the profile (it keeps parent.lock open
/// exclusively on Windows).
fn profile_in_use(prof: &Path) -> bool {
    if !cfg!(windows) {
        return false;
    }
    let lock = prof.join("parent.lock");
    match std::fs::OpenOptions::new().read(true).write(true).open(&lock) {
        Ok(_) => false,
        Err(e) => e.kind() != std::io::ErrorKind::NotFound,
    }
}

/// The LibreWolf binary (the app no longer runs LibreWolf's WinUpdater: it
/// popped up a window on the first launch of every day).
fn ensure_browser_binary(app: &AppHandle) -> Result<PathBuf, String> {
    find_librewolf(app).ok_or_else(|| "LibreWolf not found".to_string())
}

// ---------------------------------------------------------------------------
// setup: helper extension, policies, user.js, userChrome.css, cursors
// ---------------------------------------------------------------------------

fn fnv64(parts: &[&[u8]]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for p in parts {
        for &b in *p {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
        h ^= 0xff;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Helper version: bumped (monotonically) whenever the helper's content
/// changes. Firefox skips a policy install when the version is unchanged, so
/// this is what makes updates to the helper actually land.
fn helper_version(app: &AppHandle) -> String {
    let hash = fnv64(&[
        EXT_MANIFEST_TMPL.as_bytes(), EXT_BACKGROUND_JS.as_bytes(), EXT_HELPER_JS.as_bytes(),
        CURF_CLICK, CURF_GRAB,
    ]);
    let state = crate::paths::browser_dir(app).join(".xmb_helper_state");
    let prev = std::fs::read_to_string(&state).unwrap_or_default();
    let mut it = prev.split_whitespace();
    let prev_hash = it.next().and_then(|s| u64::from_str_radix(s, 16).ok());
    let prev_patch = it.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    if prev_hash == Some(hash) && prev_patch > 0 {
        return format!("2.0.{prev_patch}");
    }
    let minutes = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() / 60).unwrap_or(1);
    let patch = minutes.max(prev_patch + 1);
    let _ = std::fs::write(&state, format!("{hash:016x} {patch}"));
    format!("2.0.{patch}")
}

/// Write the helper extension and pack it as a versioned .xpi; returns its path.
fn build_helper(app: &AppHandle) -> Result<PathBuf, String> {
    let bdir = crate::paths::browser_dir(app);
    let version = helper_version(app);
    let ext_dir = bdir.join("xmb-ext");
    let _ = std::fs::remove_dir_all(&ext_dir); // drop files older versions shipped
    std::fs::create_dir_all(ext_dir.join("cursors")).map_err(|e| format!("helper dir: {e}"))?;
    let manifest = EXT_MANIFEST_TMPL.replace("__ID__", HELPER_EXT_ID).replace("__VERSION__", &version);
    let w = |p: PathBuf, b: &[u8]| std::fs::write(p, b).map_err(|e| format!("helper file: {e}"));
    w(ext_dir.join("manifest.json"), manifest.as_bytes())?;
    w(ext_dir.join("background.js"), EXT_BACKGROUND_JS.as_bytes())?;
    w(ext_dir.join("helper.js"), EXT_HELPER_JS.as_bytes())?;

    let xpi = bdir.join(format!("xmb-helper-{version}.xpi"));
    if !xpi.is_file() {
        pack_xpi(&ext_dir, &xpi)?;
    }
    // remove superseded packages
    if let Ok(rd) = std::fs::read_dir(&bdir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("xmb-helper") && n.ends_with(".xpi") && e.path() != xpi {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(xpi)
}

fn file_url(p: &Path) -> String {
    let s = p.display().to_string().replace('\\', "/");
    if s.starts_with('/') { format!("file://{s}") } else { format!("file:///{s}") }
}

/// Merge our extension entries into an existing policies.json, keeping
/// everything LibreWolf (or you) already put there.
fn merge_policies(existing: Option<&str>, entries: &[(String, Value)]) -> String {
    let mut root: Value = existing
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}));
    let obj = root.as_object_mut().expect("object");
    let pol = obj.entry("policies").or_insert_with(|| json!({}));
    if !pol.is_object() {
        *pol = json!({});
    }
    // the screenshot key (F12 by default) must not open LibreWolf's dev tools
    pol.as_object_mut().expect("object").insert("DisableDeveloperTools".into(), json!(true));
    let es = pol.as_object_mut().expect("object").entry("ExtensionSettings").or_insert_with(|| json!({}));
    if !es.is_object() {
        *es = json!({});
    }
    let es = es.as_object_mut().expect("object");
    es.retain(|k, _| !k.starts_with("xmb-user-")); // re-added below from the current files
    for (id, v) in entries {
        es.insert(id.clone(), v.clone());
    }
    serde_json::to_string_pretty(&root).unwrap_or_else(|_| "{}".into())
}

fn user_xpis(bdir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(bdir.join("extensions")) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x.eq_ignore_ascii_case("xpi")).unwrap_or(false) {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

/// Replace (or append) our marked block inside a text file's content.
fn upsert_block(existing: &str, begin: &str, end: &str, body: &str) -> String {
    let mut text = existing.to_string();
    while let Some(b) = text.find(begin) {
        match text[b..].find(end) {
            Some(rel) => {
                let mut stop = b + rel + end.len();
                if text[stop..].starts_with("\r\n") { stop += 2; } else if text[stop..].starts_with('\n') { stop += 1; }
                text.replace_range(b..stop, "");
            }
            None => { text.truncate(b); }
        }
    }
    let mut out = text.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(begin);
    out.push('\n');
    out.push_str(body.trim_end());
    out.push('\n');
    out.push_str(end);
    out.push('\n');
    out
}

const USER_JS_BODY: &str = concat!(
    "user_pref(\"xpinstall.signatures.required\", false);\n",
    "user_pref(\"toolkit.legacyUserProfileCustomizations.stylesheets\", true);\n",
    // the XMB palm / fist / click cursors are bigger than 32 px: never block them
    "user_pref(\"layout.cursor.block.enabled\", false);\n",
    "user_pref(\"layout.cursor.block.max-size\", 128);\n"
);

// Hide the toolbars ONLY in the window the helper marked as the XMB window.
const USER_CHROME_BODY: &str = concat!(
    ":root[titlepreface^=\"[XMB]\"] #titlebar,\n",
    ":root[titlepreface^=\"[XMB]\"] #TabsToolbar,\n",
    ":root[titlepreface^=\"[XMB]\"] #toolbar-menubar,\n",
    ":root[titlepreface^=\"[XMB]\"] #nav-bar,\n",
    ":root[titlepreface^=\"[XMB]\"] #PersonalToolbar,\n",
    ":root[titlepreface^=\"[XMB]\"] #sidebar-main,\n",
    ":root[titlepreface^=\"[XMB]\"] #sidebar-box,\n",
    ":root[titlepreface^=\"[XMB]\"] #sidebar-splitter,\n",
    ":root[titlepreface^=\"[XMB]\"] #sidebar-launcher-splitter {\n",
    "  visibility: collapse !important;\n",
    "}\n",
    ":root[titlepreface^=\"[XMB]\"] #navigator-toolbox { border: 0 !important; }\n"
);

fn ensure_setup(app: &AppHandle, bin: &Path, prof: &Path) -> Result<(), String> {
    let bdir = crate::paths::browser_dir(app);
    std::fs::create_dir_all(prof).map_err(|e| format!("profile dir: {e}"))?;

    // 1. helper extension
    let xpi = build_helper(app)?;
    let _ = std::fs::remove_file(bdir.join("xmb-helper.xpi")); // pre-versioning name

    // 2. policies.json next to the binary: MERGED, never overwritten
    let mut entries: Vec<(String, Value)> = vec![
        (UBO_ID.into(), json!({ "installation_mode": "force_installed", "install_url": UBO_XPI })),
        (VM_ID.into(), json!({ "installation_mode": "force_installed", "install_url": VM_XPI })),
        (HELPER_EXT_ID.into(), json!({
            "installation_mode": "force_installed",
            "install_url": file_url(&xpi),
            "private_browsing": true
        })),
    ];
    for (i, p) in user_xpis(&bdir).iter().enumerate() {
        entries.push((format!("xmb-user-{i}@ps3xmb.local"),
            json!({ "installation_mode": "force_installed", "install_url": file_url(p) })));
    }
    if let Some(bin_dir) = bin.parent() {
        let dist = bin_dir.join("distribution");
        let _ = std::fs::create_dir_all(&dist);
        let pfile = dist.join("policies.json");
        let existing = std::fs::read_to_string(&pfile).ok();
        if let Some(s) = existing.as_deref() {
            if serde_json::from_str::<Value>(s).is_err() {
                let _ = std::fs::copy(&pfile, dist.join("policies.json.bak"));
            }
        }
        let merged = merge_policies(existing.as_deref(), &entries);
        if existing.as_deref() != Some(merged.as_str()) {
            std::fs::write(&pfile, merged.as_bytes()).map_err(|e| format!("policies.json: {e}"))?;
        }
    }
    let _ = std::fs::remove_file(bdir.join("policies.json")); // old reference copy

    // 3. user.js — only our block; the rest of the file is yours
    let ujs = prof.join("user.js");
    let cur = std::fs::read_to_string(&ujs).unwrap_or_default();
    let base = if cur.trim_start().starts_with(OLD_UJS_HEADER) { "" } else { cur.as_str() };
    let next = upsert_block(base, UJS_BEGIN, UJS_END, USER_JS_BODY);
    if next != cur {
        std::fs::write(&ujs, next.as_bytes()).map_err(|e| format!("user.js: {e}"))?;
    }

    // 4. userChrome.css — scoped rule appended to whatever you already have
    let chrome = prof.join("chrome");
    let _ = std::fs::create_dir_all(&chrome);
    let ucss = chrome.join("userChrome.css");
    let cur = std::fs::read_to_string(&ucss).unwrap_or_default();
    let base = if cur.trim_start().starts_with(OLD_UCSS_HEADER) { "" } else { cur.as_str() };
    let next = upsert_block(base, UCSS_BEGIN, UCSS_END, USER_CHROME_BODY);
    if next != cur {
        let _ = std::fs::write(&ucss, next.as_bytes());
    }

    // 5. Windows cursor files
    write_cursor_files(&bdir.join("cursors"));
    Ok(())
}

fn write_cursor_files(cdir: &Path) {
    let _ = std::fs::create_dir_all(cdir);
    for (name, bytes) in [
        ("arrow.cur", CURF_ARROW), ("finger.cur", CURF_FINGER),
        ("pen.cur", CURF_PEN), ("hand.cur", CURF_HAND),
        ("click.cur", CURF_CLICK), ("grab.cur", CURF_GRAB),
    ] {
        let _ = std::fs::write(cdir.join(name), bytes);
    }
}

// ---------------------------------------------------------------------------
// remembered window geometry (xulstore.json)
// ---------------------------------------------------------------------------

fn read_xul_geometry(prof: &Path) -> Option<Value> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(prof.join("xulstore.json")).ok()?).ok()?;
    v.get(XUL_KEY)?.get("main-window").cloned()
}

fn write_xul_geometry(prof: &Path, snap: &Option<Value>) {
    let p = prof.join("xulstore.json");
    let mut v: Value = std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(|v: &Value| v.is_object())
        .unwrap_or_else(|| json!({}));
    let root = v.as_object_mut().expect("object");
    let doc = root.entry(XUL_KEY).or_insert_with(|| json!({}));
    if !doc.is_object() {
        *doc = json!({});
    }
    let doc = doc.as_object_mut().expect("object");
    match snap {
        Some(m) => { doc.insert("main-window".into(), m.clone()); }
        None => { doc.remove("main-window"); }
    }
    if let Ok(s) = serde_json::to_string(&v) {
        let _ = std::fs::write(&p, s);
    }
}

// ---------------------------------------------------------------------------
// xpi packer (STORE zip) + crc32
// ---------------------------------------------------------------------------

fn pack_xpi(ext_dir: &Path, out: &Path) -> Result<(), String> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    collect_files(ext_dir, ext_dir, &mut files)?;
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut body: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for (name, data) in &files {
        let crc = crc32(data);
        let offset = body.len() as u32;
        let nb = name.as_bytes();
        body.extend_from_slice(&0x04034b50u32.to_le_bytes());
        body.extend_from_slice(&20u16.to_le_bytes());
        body.extend_from_slice(&0u16.to_le_bytes());
        body.extend_from_slice(&0u16.to_le_bytes());
        body.extend_from_slice(&0u16.to_le_bytes());
        body.extend_from_slice(&0u16.to_le_bytes());
        body.extend_from_slice(&crc.to_le_bytes());
        body.extend_from_slice(&(data.len() as u32).to_le_bytes());
        body.extend_from_slice(&(data.len() as u32).to_le_bytes());
        body.extend_from_slice(&(nb.len() as u16).to_le_bytes());
        body.extend_from_slice(&0u16.to_le_bytes());
        body.extend_from_slice(nb);
        body.extend_from_slice(data);
        central.extend_from_slice(&0x02014b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(nb.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u32.to_le_bytes());
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(nb);
    }
    let cd_offset = body.len() as u32;
    let cd_size = central.len() as u32;
    body.extend_from_slice(&central);
    body.extend_from_slice(&0x06054b50u32.to_le_bytes());
    body.extend_from_slice(&0u16.to_le_bytes());
    body.extend_from_slice(&0u16.to_le_bytes());
    body.extend_from_slice(&(files.len() as u16).to_le_bytes());
    body.extend_from_slice(&(files.len() as u16).to_le_bytes());
    body.extend_from_slice(&cd_size.to_le_bytes());
    body.extend_from_slice(&cd_offset.to_le_bytes());
    body.extend_from_slice(&0u16.to_le_bytes());
    std::fs::write(out, &body).map_err(|e| format!("write xpi: {e}"))
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) -> Result<(), String> {
    let rd = std::fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_files(root, &p, out)?;
        } else {
            let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            let data = std::fs::read(&p).map_err(|e| format!("read {}: {e}", p.display()))?;
            out.push((rel, data));
        }
    }
    Ok(())
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

// ---------------------------------------------------------------------------
// local server the helper talks to
// ---------------------------------------------------------------------------

const BOOT_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>[XMB]</title>
<style>html,body{margin:0;height:100%;background:#000;color:#ddd;font:16px/1.5 system-ui,sans-serif}
#m{display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;padding:0 12%}</style>
</head><body><div id="m">The XMB browser helper isn't active in LibreWolf yet.<br><br>
Close every LibreWolf window, then open the Internet Browser again.</div>
<script>setTimeout(function(){document.getElementById("m").style.display="flex"},9000)</script>
</body></html>"#;

fn start_server() {
    if SERVER_UP.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        let listener = match std::net::TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(l) => l,
            Err(_) => {
                SERVER_UP.store(false, Ordering::SeqCst);
                return;
            }
        };
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let _ = handle_conn(stream);
            });
        }
    });
}

fn read_request(s: &mut std::net::TcpStream) -> std::io::Result<(String, String, String)> {
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let mut chunk = [0u8; 4096];
    let header_end;
    loop {
        let n = s.read(&mut chunk)?;
        if n == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = i + 4;
            break;
        }
        if buf.len() > 64 * 1024 {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
    }
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.lines();
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let len = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse::<usize>().ok())
        .unwrap_or(0)
        .min(256 * 1024);
    let mut body = buf[header_end..].to_vec();
    while body.len() < len {
        let n = s.read(&mut chunk)?;
        if n == 0 { break; }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    Ok((method, target, String::from_utf8_lossy(&body).to_string()))
}

fn respond(s: &mut std::net::TcpStream, status: &str, ctype: &str, body: &str) -> std::io::Result<()> {
    let resp = format!(
        "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\nCache-Control: no-store\r\nContent-Type: {ctype}\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    s.write_all(resp.as_bytes())
}

fn query_param(query: &str, key: &str) -> String {
    query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.to_string())
        .unwrap_or_default()
}

fn handle_conn(mut s: std::net::TcpStream) -> std::io::Result<()> {
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let (method, target, body) = read_request(&mut s)?;
    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let jbody = || serde_json::from_str::<Value>(&body).unwrap_or(Value::Null);
    let ok = |s: &mut std::net::TcpStream| respond(s, "204 No Content", "text/plain", "");
    match (method.as_str(), path) {
        ("OPTIONS", _) => ok(&mut s),
        ("GET", "/ping") => respond(&mut s, "200 OK", "text/plain", "ok"),
        ("GET", "/xmb/open") => respond(&mut s, "200 OK", "text/html; charset=utf-8", BOOT_HTML),
        ("GET", "/xmb/job") => {
            let t = query_param(query, "t");
            let job = {
                let st = sess();
                if st.open && !st.token.is_empty() && st.token == t {
                    Some(json!({
                        "mode": st.mode, "value": st.value,
                        "left": st.css.0.round(), "top": st.css.1.round(),
                        "width": st.css.2.round(), "height": st.css.3.round(),
                        "tabKey": tab_code(),
                    }))
                } else {
                    None
                }
            };
            match job {
                Some(j) => respond(&mut s, "200 OK", "application/json", &j.to_string()),
                None => respond(&mut s, "404 Not Found", "text/plain", "no job"),
            }
        }
        ("GET", "/xmb/poll") => {
            let out = {
                let mut st = sess();
                let cmds = std::mem::take(&mut st.cmds);
                json!({ "open": st.open, "cmds": cmds, "tabKey": tab_code() })
            };
            respond(&mut s, "200 OK", "application/json", &out.to_string())
        }
        ("POST", "/xmb/focus") | ("POST", "/focus") => {
            let v = jbody();
            let mut st = sess();
            let f = v.get("focus").and_then(Value::as_bool).unwrap_or(false);
            st.focus = f;
            if f {
                st.focus_seq += 1;
                st.focus_value = v.get("value").and_then(Value::as_str).unwrap_or("").to_string();
                st.focus_replace = v.get("replace").and_then(Value::as_bool).unwrap_or(false);
                st.focus_password = v.get("password").and_then(Value::as_bool).unwrap_or(false);
            }
            drop(st);
            ok(&mut s)
        }
        ("POST", "/xmb/meta") => {
            let v = jbody();
            let mut st = sess();
            st.title = v.get("title").and_then(Value::as_str).unwrap_or("").to_string();
            st.url = v.get("url").and_then(Value::as_str).unwrap_or("").to_string();
            drop(st);
            ok(&mut s)
        }
        // the helper: a button went down on a link ("click"), the page is being
        // dragged ("grab"), or the button came back up ("normal")
        ("POST", "/xmb/cursor") => {
            let v = jbody();
            let mode = v.get("mode").and_then(Value::as_str).unwrap_or("normal").to_string();
            #[cfg(windows)]
            {
                let dir = CURSOR_DIR.lock().ok().and_then(|d| d.clone());
                // (only while the browser is up: a late message after it closed would
                // leave the browser's cursors in place for the rest of the session)
                let up = { let st = sess(); st.open && !st.hidden && st.phase != "closed" };
                if let Some(dir) = dir { if up { win::cursor_mode(&dir, &mode); } }
            }
            #[cfg(not(windows))]
            let _ = mode;
            ok(&mut s)
        }
        ("POST", "/xmb/hover") => {
            let v = jbody();
            sess().hover = v.get("href").and_then(Value::as_str).unwrap_or("").to_string();
            ok(&mut s)
        }
        ("POST", "/xmb/fs") => {
            let v = jbody();
            sess().lw_fullscreen = v.get("fullscreen").and_then(Value::as_bool).unwrap_or(false);
            ok(&mut s)
        }
        ("POST", "/xmb/marked") => {
            sess().marked = true;
            ok(&mut s)
        }
        ("POST", "/xmb/closed") => ok(&mut s),
        _ => respond(&mut s, "404 Not Found", "text/plain", "not found"),
    }
}

// ---------------------------------------------------------------------------
// launch / watchdog / close
// ---------------------------------------------------------------------------

fn new_token() -> String {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}", n ^ 0x5bd1_e995_u128.wrapping_mul(n >> 7))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn ui_marker(app: &AppHandle) -> PathBuf {
    crate::paths::browser_dir(app).join(".xmb_ui_active")
}

/// The app's window always on top (while the browser window gets into place
/// behind it), or back to normal.
#[cfg(windows)]
fn app_topmost(app: &AppHandle, on: bool) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") { let _ = w.set_always_on_top(on); }
}

/// The app back in front with its page focused (again a few times while
/// LibreWolf's window goes away), so the controller works on it at once.
#[cfg(windows)]
fn focus_app(app: &AppHandle) {
    crate::focus::bring_to_front(app);
}

/// A browser session is going on (starting, showing or closing).
pub fn session_active() -> bool { sess().open || LAUNCHING.load(Ordering::SeqCst) }
/// A Windows file / folder window is open (its controller pointer is on).
static PICKING: AtomicBool = AtomicBool::new(false);
pub fn picker_active() -> bool { PICKING.load(Ordering::SeqCst) }

fn launch(app: &AppHandle, mode: String, value: Option<String>,
          rect: (i32, i32, i32, i32), css: (f64, f64, f64, f64)) -> Result<(), String> {
    if LAUNCHING.swap(true, Ordering::SeqCst) {
        return Err("busy".into());
    }
    let r = launch_inner(app, mode, value, rect, css);
    LAUNCHING.store(false, Ordering::SeqCst);
    if let Err(e) = &r {
        {
            let mut st = sess();
            if st.open {
                st.open = false;
                st.gen += 1;
            }
            if e != "cancelled" {
                st.phase = "failed".into();
            }
        }
        // undo anything the failed launch already changed
        #[cfg(windows)]
        {
            if ui_marker(app).exists() {
                win::end_browser_ui();
                let _ = std::fs::remove_file(ui_marker(app));
            }
        }
    }
    r
}

fn launch_inner(app: &AppHandle, mode: String, value: Option<String>,
                rect: (i32, i32, i32, i32), css: (f64, f64, f64, f64)) -> Result<(), String> {
    if sess().open {
        close_session(app);
    }
    let (gen, token) = {
        let mut st = sess();
        st.gen += 1;
        st.open = true;
        st.phase = "starting".into();
        st.token = new_token();
        st.mode = mode;
        st.value = value.unwrap_or_default();
        st.rect = rect;
        st.css = css;
        st.hidden = false;
        st.hwnd = 0;
        st.marked = false;
        st.fullscreen = false;
        st.lw_fullscreen = false;
        st.settled = false;
        st.started = None;
        st.focus = false;
        st.focus_value.clear();
        st.title.clear();
        st.url.clear();
        st.hover.clear();
        st.cmds.clear();
        (st.gen, st.token.clone())
    };

    let bin = ensure_browser_binary(app)?;
    if !sess().open || sess().gen != gen {
        return Err("cancelled".into());
    }
    let prof = profile_dir(app);
    ensure_setup(app, &bin, &prof)?;
    {
        let mut st = sess();
        st.bin_dir = bin.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        st.parked.clear();
        #[cfg(windows)]
        { st.pre_windows = win::librewolf_windows(&st.bin_dir); }
    }
    start_server();
    let snap = if profile_in_use(&prof) { None } else { Some(read_xul_geometry(&prof)) };
    if snap.is_some() {
        // LibreWolf opens its window right where the panel is (no jump)
        let (x, y, w, h) = css;
        write_xul_geometry(&prof, &Some(json!({ "screenX": x.round().to_string(), "screenY": y.round().to_string(),
            "width": w.round().to_string(), "height": h.round().to_string(), "sizemode": "normal" })));
    }
    {
        let mut st = sess();
        st.profile = prof.clone();
        st.xul_snapshot = snap;
        st.started = Some(Instant::now());
    }

    #[cfg(windows)]
    {
        let _ = std::fs::write(ui_marker(app), b"1");
        let cdir = crate::paths::browser_dir(app).join("cursors");
        if let Ok(mut d) = CURSOR_DIR.lock() { *d = Some(cdir.clone()); }
        win::begin_browser_ui(&cdir);
    }

    let mut cmd = Command::new(&bin);
    cmd.arg("--profile").arg(&prof)
        .arg("--new-window").arg(format!("http://127.0.0.1:{PORT}/xmb/open?t={token}"))
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(dir) = bin.parent() {
        cmd.current_dir(dir);
    }
    // LibreWolf's launcher process hands off to the real browser and exits; we
    // don't keep its handle (the window is found by its title marker instead).
    cmd.spawn().map_err(|e| format!("launch LibreWolf: {e}"))?;

    start_watchdog(app.clone(), gen);
    start_pad_thread(app.clone(), gen);
    Ok(())
}

/// Controller support while the browser session is up. With LibreWolf in the
/// foreground the webview gets no gamepad input, so the controller is read
/// natively (see gamepad.rs). While the page is showing:
///   * left stick → pointer, ✕ → left button (hold and move = grab / drag),
///     right stick → scroll up / down;
///   * ○ → close the current window (tab), ○ held → exit the browser;
///   * START → enter an address (the app's on-screen keyboard);
///   * L1 / R1 → back / forward, L2 / R2 → the window on the left / right;
///   * L3 → full screen on / off (the pointer may then roam the whole screen).
/// Anywhere: R3 takes a screenshot. While the page isn't
/// showing (loading, or the on-screen keyboard is up) every press goes to the
/// app as an `xmb-pad` event (with the XMB's own auto-repeat) instead.
fn start_pad_thread(app: AppHandle, gen: u64) {
    use crate::gamepad::*;
    use tauri::Emitter;
    std::thread::spawn(move || {
        let mut reader = Reader::new();
        let mut prev = PadState::default();
        let mut announced = false;
        let (mut acc_x, mut acc_y, mut acc_w) = (0.0f32, 0.0f32, 0.0f32);
        let mut dir: Option<&'static str> = None;
        let mut dir_next = Instant::now();
        let mut rs_next = Instant::now();
        let mut rep_at: [Option<Instant>; 5] = [None; 5];
        let mut btn_down = false;
        #[cfg(windows)]
        let mut esc_since: Option<Instant> = None;
        #[cfg(windows)]
        let mut esc_fired = false;
        #[cfg(windows)]
        let mut shot_key_was = false;
        #[cfg(windows)]
        let mut tab_key_was = false;
        // ○: a tap closes the window (on release), holding it ~0.6 s exits
        let mut circ_since: Option<Instant> = None;
        let mut circ_fired = false;
        let tick = Duration::from_millis(8);
        loop {
            std::thread::sleep(tick);
            let (open, cur_gen, hwnd, hidden, rect, phase) = {
                let st = sess();
                (st.open, st.gen, st.hwnd, st.hidden, page_rect(&st), st.phase.clone())
            };
            if !open || cur_gen != gen {
                #[cfg(windows)]
                if btn_down { win::mouse_button(false); }
                break;
            }
            // Keyboard exit: holding Esc for ~0.8 s while the page is showing
            // closes the browser (a quick Esc still reaches the page as usual).
            #[cfg(windows)]
            {
                let showing = hwnd != 0 && !hidden;
                if showing && win::key_down(0x1B) {
                    let t = *esc_since.get_or_insert_with(Instant::now);
                    if !esc_fired && t.elapsed() >= Duration::from_millis(800) {
                        esc_fired = true;
                        let _ = app.emit("xmb-pad", json!({ "exit": true }));
                    }
                } else {
                    esc_since = None;
                    esc_fired = false;
                }
            }
            // the screenshot key, read directly while LibreWolf has focus
            #[cfg(windows)]
            {
                let vk = SHOT_VK.load(Ordering::SeqCst) as i32;
                let down = vk != 0 && hwnd != 0 && !hidden && win::key_down(vk);
                if down && !shot_key_was { let _ = app.emit("xmb-pad", json!({ "screenshot": true })); }
                shot_key_was = down;
                // the next-tab key (Tab): the next tab, left to right and round
                // (read here, so it works on every page; the helper only keeps
                // the page from also moving its focus); not with Ctrl / Alt / Shift
                let tvk = TAB_VK.load(Ordering::SeqCst) as i32;
                let mods = win::key_down(0x11) || win::key_down(0x12) || win::key_down(0x10);
                let tdown = tvk != 0 && hwnd != 0 && !hidden && !mods && win::foreground() == hwnd && win::key_down(tvk);
                if tdown && !tab_key_was {
                    let mut st = sess();
                    if st.open && st.gen == gen { st.cmds.push(json!({ "cmd": "nexttab", "value": null })); }
                }
                tab_key_was = tdown;
            }
            let Some(p) = reader.poll() else {
                prev = PadState::default();
                circ_since = None; circ_fired = false;
                continue;
            };
            if !announced {
                announced = true;
                let _ = app.emit("xmb-pad", json!({ "native": true }));
            }
            let emit = |a: &str| { let _ = app.emit("xmb-pad", json!({ "a": a })); };
            let shot = || { let _ = app.emit("xmb-pad", json!({ "screenshot": true })); };
            let cmd = |c: &str| { let mut st = sess(); if st.open && st.gen == gen { st.cmds.push(json!({ "cmd": c, "value": null })); } };
            let pressed = |bit: u32| p.buttons & bit != 0 && prev.buttons & bit == 0;
            // the page is showing (not loading, no on-screen keyboard over it)
            let live = hwnd != 0 && !hidden && (phase == "ready" || phase == "nohelper");
            let now = Instant::now();

            // ---- screenshots: R3
            if pressed(B_R3) { shot(); }
            if pressed(B_R1) { if live { cmd("forward"); } else { emit("r1"); } }

            if live {
                dir = None;
                // ○: tap = close this window, hold = exit (only a press that
                // started on the page counts)
                if pressed(B_CIRCLE) { circ_since = Some(now); circ_fired = false; }
                if p.buttons & B_CIRCLE != 0 {
                    if let Some(t) = circ_since {
                        if !circ_fired && t.elapsed() >= Duration::from_millis(600) {
                            circ_fired = true;
                            let _ = app.emit("xmb-pad", json!({ "exit": true }));
                        }
                    }
                } else if circ_since.take().is_some() {
                    if !circ_fired { cmd("closetab"); }
                    circ_fired = false;
                }
                if pressed(B_START) { emit("start"); }               // enter an address
                if pressed(B_L1) { cmd("back"); }
                if pressed(B_L2) { cmd("prevtab"); }
                if pressed(B_R2) { cmd("nexttab"); }
                if pressed(B_L3) { toggle_fullscreen(gen); }
            } else {
                // a ○ held from the page (exit) or the keyboard doesn't carry over
                if circ_since.take().is_some() { circ_fired = false; }
                let edges = [(B_CROSS, "enter"), (B_CIRCLE, "back"), (B_TRIANGLE, "options"), (B_SQUARE, "square"),
                             (B_SELECT, "select"), (B_START, "start"), (B_L1, "l1"),
                             (B_L2, "l2"), (B_R2, "r2"), (B_L3, "l3")];
                for (bit, a) in edges { if pressed(bit) { emit(a); } }
                // held buttons keep going on the on-screen keyboard (✕ typing,
                // □ deleting, L1 / R1 moving the cursor…): once, then after a
                // moment over and over until let go (the app only uses these
                // "rep" presses while the keyboard is open)
                let reps = [(B_CROSS, "enter"), (B_TRIANGLE, "options"), (B_SQUARE, "square"), (B_L1, "l1"), (B_R1, "r1")];
                for (k, (bit, a)) in reps.iter().enumerate() {
                    if pressed(*bit) { rep_at[k] = Some(now + Duration::from_millis(420)); }
                    else if p.buttons & bit == 0 { rep_at[k] = None; }
                    else if let Some(t) = rep_at[k] {
                        if now >= t { rep_at[k] = Some(now + Duration::from_millis(75)); let _ = app.emit("xmb-pad", json!({ "a": a, "rep": true })); }
                    }
                }
                let d = if p.buttons & B_UP != 0 { Some("up") } else if p.buttons & B_DOWN != 0 { Some("down") }
                    else if p.buttons & B_LEFT != 0 { Some("left") } else if p.buttons & B_RIGHT != 0 { Some("right") }
                    else if p.ly < -0.5 { Some("up") } else if p.ly > 0.5 { Some("down") }
                    else if p.lx < -0.5 { Some("left") } else if p.lx > 0.5 { Some("right") } else { None };
                match d {
                    Some(x) if dir != Some(x) => { dir = Some(x); emit(x); dir_next = now + Duration::from_millis(380); }
                    Some(x) => if now >= dir_next { emit(x); dir_next = now + Duration::from_millis(130); },
                    None => dir = None,
                }
                // the right stick (it moves the on-screen keyboard), about 60
                // times a second while it's pushed
                if (p.rx.abs() > 0.2 || p.ry.abs() > 0.2) && now >= rs_next {
                    rs_next = now + Duration::from_millis(16);
                    let _ = app.emit("xmb-pad", json!({ "rs": [p.rx, p.ry] }));
                }
            }

            // ---- the pointer and scrolling: only while the page is showing
            #[cfg(windows)]
            {
                if live {
                    let scale = win::dpi_scale(hwnd);
                    let dz = 0.16f32;
                    let curve = |v: f32| { let a = v.abs(); if a < dz { 0.0 } else { v.signum() * ((a - dz) / (1.0 - dz)).powf(1.7) } };
                    let speed = 13.0 * scale;   // px per 8 ms tick at full tilt
                    acc_x += curve(p.lx) * speed;
                    acc_y += curve(p.ly) * speed;
                    let (dx, dy) = (acc_x.trunc(), acc_y.trunc());
                    acc_x -= dx; acc_y -= dy;
                    if dx != 0.0 || dy != 0.0 { win::move_cursor(dx as i32, dy as i32, rect); }
                    // ✕: press / grab (only a press that started on the page)
                    if pressed(B_CROSS) && !btn_down { win::mouse_button(true); btn_down = true; }
                    else if p.buttons & B_CROSS == 0 && btn_down { win::mouse_button(false); btn_down = false; }
                    // right stick: scroll, faster the further it's pushed
                    // (wheel units per tick; 120 = one notch)
                    acc_w += -curve(p.ry) * 16.0;
                    let w = acc_w.trunc();
                    acc_w -= w;
                    if w != 0.0 { win::wheel_raw(w as i32); }
                } else {
                    acc_x = 0.0; acc_y = 0.0; acc_w = 0.0;
                    if btn_down { win::mouse_button(false); btn_down = false; }
                }
            }
            #[cfg(not(windows))]
            let _ = (rect, &mut acc_x, &mut acc_y, &mut acc_w, &mut btn_down);
            prev = p;
        }
    });
}

// ---------------------------------------------------------------------------
// native file / folder pickers: the controller as the mouse
// ---------------------------------------------------------------------------

/// While a Windows file / folder dialog is open the XMB gets no input, so the
/// controller drives the dialog with the same controls as the Internet
/// Browser (and the same XMB cursors):
///   * left stick → pointer, ✕ → left button (hold and move = grab / drag),
///     right stick → scroll;
///   * ○ → close the dialog (Esc; held, the same);
///   * START → the address bar (Alt+D), L1 / R1 → back / forward
///     (Alt+Left / Alt+Right), L2 / R2 → the previous / next pane of the
///     dialog (Shift+F6 / F6), L3 → maximize / restore the dialog;
///   * R3 → screenshot.
/// Everything stops (and the normal cursors come back) when the guard drops.
pub struct PickerPointer {
    stop: std::sync::Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    #[cfg_attr(not(windows), allow(dead_code))]
    marker: PathBuf,
}

impl Drop for PickerPointer {
    fn drop(&mut self) {
        PICKING.store(false, Ordering::SeqCst);
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() { let _ = t.join(); }
        #[cfg(windows)]
        {
            // the browser keeps its own cursors while it's up
            if !sess().open {
                win::end_picker_ui();
                let _ = std::fs::remove_file(&self.marker);
            }
        }
    }
}

#[cfg_attr(not(windows), allow(unused_variables, unused_mut, unused_assignments))]
pub fn picker_pointer(app: &AppHandle) -> PickerPointer {
    use crate::gamepad::*;
    let stop = std::sync::Arc::new(AtomicBool::new(false));
    PICKING.store(true, Ordering::SeqCst);
    let marker = ui_marker(app);
    #[cfg(windows)]
    {
        let cdir = crate::paths::browser_dir(app).join("cursors");
        write_cursor_files(&cdir);
        let _ = std::fs::write(&marker, b"1");
        if let Ok(mut d) = CURSOR_DIR.lock() { *d = Some(cdir.clone()); }
        win::begin_picker_ui(&cdir);
    }
    let flag = stop.clone();
    let app = app.clone();
    let thread = std::thread::spawn(move || {
        use tauri::Emitter;
        #[cfg(windows)]
        use tauri::Manager;
        let mut reader = Reader::new();
        let (mut acc_x, mut acc_y, mut acc_w) = (0.0f32, 0.0f32, 0.0f32);
        let mut btn_down = false;
        // the ✕ / ○ that opened the picker may still be held: wait for a release
        let mut cross_armed = false;
        let mut circle_armed = false;
        let mut circle_was = false;
        let mut centered = false;
        let mut prev_buttons = 0u32;
        let mut first = true;
        let started = Instant::now();
        while !flag.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(8));
            #[cfg(windows)]
            if !centered {
                // the file / folder window, once it's up: put in the middle of
                // the app's screen (Windows opens it at the top left), with the
                // pointer shown in its middle; without one after 1.5 s, the
                // pointer goes to the middle of the screen
                let dlg = win::own_dialog();
                if dlg != 0 {
                    centered = true;
                    let area = app.get_webview_window("main").and_then(|w| w.hwnd().ok())
                        .and_then(|h| win::window_area(h.0 as isize)).unwrap_or_else(win::screen_rect);
                    win::center_window(dlg, area);
                    win::center_on_foreground();
                } else if started.elapsed() >= Duration::from_millis(1500) {
                    centered = true;
                    win::center_on_foreground();
                }
            }
            let Some(p) = reader.poll() else { continue; };
            if first { first = false; prev_buttons = p.buttons; }   // nothing held from the XMB fires
            let edge = |bit: u32| p.buttons & bit != 0 && prev_buttons & bit == 0;
            let shot = || { let _ = app.emit("xmb-pad", json!({ "screenshot": true })); };
            // screenshots: R3
            if edge(B_R3) { shot(); }
            let r1_tap = edge(B_R1);
            #[cfg(windows)]
            {
                let rect = win::screen_rect();
                let scale = win::dpi_scale(win::foreground());
                let dz = 0.16f32;
                let curve = |v: f32| { let a = v.abs(); if a < dz { 0.0 } else { v.signum() * ((a - dz) / (1.0 - dz)).powf(1.7) } };
                let speed = 13.0 * scale;
                acc_x += curve(p.lx) * speed;
                acc_y += curve(p.ly) * speed;
                let (dx, dy) = (acc_x.trunc(), acc_y.trunc());
                acc_x -= dx; acc_y -= dy;
                if dx != 0.0 || dy != 0.0 { win::move_cursor(dx as i32, dy as i32, rect); }
                acc_w += -curve(p.ry) * 16.0;
                let w = acc_w.trunc();
                acc_w -= w;
                if w != 0.0 { win::wheel_raw(w as i32); }
                let cross = p.buttons & B_CROSS != 0;
                if !cross { cross_armed = true; }
                if cross && cross_armed && !btn_down {
                    win::mouse_button(true); btn_down = true;
                    if let Ok(d) = CURSOR_DIR.lock() { if let Some(d) = d.as_ref() { win::cursor_mode(d, "click"); } }
                } else if !cross && btn_down {
                    win::mouse_button(false); btn_down = false;
                    if let Ok(d) = CURSOR_DIR.lock() { if let Some(d) = d.as_ref() { win::cursor_mode(d, "normal"); } }
                }
                let circle = p.buttons & B_CIRCLE != 0;
                if !circle { circle_armed = true; }
                if circle && !circle_was && circle_armed { win::key_tap(0x1B); }   // Esc: close the dialog
                circle_was = circle;
                if edge(B_START) { win::key_combo(&[0x12, 0x44]); }       // Alt+D: address bar
                if edge(B_L1) { win::key_combo(&[0x12, 0x25]); }          // Alt+Left: back
                if r1_tap { win::key_combo(&[0x12, 0x27]); }              // Alt+Right: forward
                if edge(B_L2) { win::key_combo(&[0x10, 0x75]); }          // Shift+F6: previous pane
                if edge(B_R2) { win::key_tap(0x75); }                      // F6: next pane
                if edge(B_L3) { win::toggle_maximize(win::foreground()); }
            }
            prev_buttons = p.buttons;
            #[cfg(not(windows))]
            let _ = (p, r1_tap, &mut acc_x, &mut acc_y, &mut acc_w,
                     &mut cross_armed, &mut circle_armed, &mut circle_was, &mut centered, started);
        }
        #[cfg(windows)]
        {
            if btn_down { win::mouse_button(false); }
        }
        #[cfg(not(windows))]
        let _ = btn_down;
    });
    PickerPointer { stop, thread: Some(thread), marker }
}

fn start_watchdog(app: AppHandle, gen: u64) {
    std::thread::spawn(move || {
        #[cfg(windows)]
        let mut centered = false;
        #[cfg(windows)]
        let mut seen_window = false;
        #[cfg(windows)]
        let (bin_dir, pre) = { let st = sess(); (st.bin_dir.clone(), st.pre_windows.clone()) };
        #[cfg(windows)]
        let mut in_place_since: Option<Instant> = None;
        #[cfg(windows)]
        let mut app_on_top = false;
        loop {
            let waiting = { let st = sess(); st.hwnd == 0 || !st.settled };
            std::thread::sleep(Duration::from_millis(if waiting { 15 } else { 150 }));
            let (open, cur_gen, hwnd, hidden, rect, marked, started, phase, settled) = {
                let st = sess();
                // (in LibreWolf's own full screen the window is left to it, see
                // enforce(); the panel is where it goes back to)
                let r = if st.lw_fullscreen && !st.fullscreen { st.rect } else { page_rect(&st) };
                (st.open, st.gen, st.hwnd, st.hidden, r, st.marked, st.started, st.phase.clone(), st.settled)
            };
            if !open || cur_gen != gen {
                #[cfg(windows)]
                if app_on_top { app_topmost(&app, false); }
                break;
            }
            let elapsed = started.map(|t| t.elapsed()).unwrap_or_default();
            #[cfg(windows)]
            {
                // the app is kept on top until the window is in place, so
                // nothing LibreWolf does while it loads (like bringing itself
                // to the front) can show it early
                if !settled && !app_on_top { app_on_top = true; app_topmost(&app, true); }
                if hwnd == 0 {
                    let h = win::find_xmb_window();
                    if h != 0 {
                        let mut st = sess();
                        if st.gen == gen { st.hwnd = h; }
                        continue;
                    }
                    // Safeguard: every new LibreWolf window is hidden the moment
                    // it appears, so nothing can be seen, clicked or closed
                    // before it's in place; the page's own window ("[XMB]…",
                    // already opened at the panel's spot) is shown by
                    // enforce() below. If the windows vanish (closed, or
                    // LibreWolf quit), the browser screen closes instead of
                    // loading forever.
                    let mut parked = sess().parked.clone();
                    parked.retain(|h| win::is_window(*h));
                    for w in win::librewolf_windows(&bin_dir) {
                        if pre.contains(&w) { continue; }
                        win::hide(w);
                        if !parked.contains(&w) { parked.push(w); }
                    }
                    if let Some(&h) = parked.iter().find(|h| win::title_is_xmb(**h)) {
                        parked.retain(|x| *x != h);
                        let mut st = sess();
                        if st.gen == gen { st.hwnd = h; st.parked = parked; }
                        continue;
                    }
                    if !parked.is_empty() { seen_window = true; }
                    else if seen_window && elapsed > Duration::from_secs(2) {
                        finish_close(&app, gen);
                        break;
                    }
                    sess().parked = parked;
                    if elapsed > Duration::from_secs(45) {
                        set_phase("failed");
                    }
                    continue;
                }
                if !win::is_window(hwnd) {
                    // you (or LibreWolf) closed the window
                    {
                        let mut st = sess();
                        if st.gen == gen { st.hwnd = 0; }
                    }
                    finish_close(&app, gen);
                    break;
                }
                if !marked && phase == "starting" && elapsed > Duration::from_secs(10) {
                    set_phase("nohelper");
                }
                // Until the window has reached the panel (sized and placed by the
                // helper, then held there for a moment) it stays BEHIND the app,
                // so it's never seen jumping into place; then it comes forward.
                // (LibreWolf's own full screen: the window is its business)
                let lw_full = { let st = sess(); st.lw_fullscreen && !st.fullscreen };
                if lw_full && settled && !hidden { win::keep_topmost(hwnd); }
                else { win::enforce(hwnd, rect, hidden, !settled); }
                if !settled {
                    if (marked || phase == "nohelper") && win::at_rect(hwnd, rect) {
                        let t = *in_place_since.get_or_insert_with(Instant::now);
                        if t.elapsed() >= Duration::from_millis(250) {
                            let mut st = sess();
                            if st.gen == gen { st.settled = true; }
                        }
                    } else {
                        in_place_since = None;
                    }
                    win::unclip();
                    continue;
                }
                if app_on_top { app_on_top = false; app_topmost(&app, false); }
                if marked && phase != "ready" {
                    set_phase("ready");
                }
                if !centered && !hidden {
                    // the page gets keyboard focus (so typing works at once)
                    win::force_foreground(hwnd);
                    win::center_cursor(rect);
                    centered = true;
                }
                // the pointer stays on the page (in full screen it may go anywhere)
                let full = { let st = sess(); st.fullscreen || st.lw_fullscreen };
                if hidden || full || !(phase == "ready" || phase == "nohelper") {
                    win::unclip();
                } else {
                    win::clip_to(hwnd, rect);
                }
            }
            #[cfg(not(windows))]
            {
                let _ = (&app, hwnd, hidden, rect, settled);
                if marked && phase != "ready" {
                    set_phase("ready");
                } else if !marked && phase == "starting" && elapsed > Duration::from_secs(10) {
                    set_phase("nohelper");
                }
            }
        }
    });
}

/// Close the XMB window gracefully (WM_CLOSE) and put everything back.
fn close_session(app: &AppHandle) {
    let gen = {
        let mut st = sess();
        if !st.open {
            return;
        }
        st.open = false;
        st.gen += 1;
        st.gen
    };
    #[cfg(windows)]
    {
        let hwnd = sess().hwnd;
        if hwnd != 0 && win::is_window(hwnd) {
            win::close_window(hwnd);
        } else {
            // closed while still starting: close the window when it shows up
            std::thread::spawn(move || {
                for _ in 0..80 {
                    std::thread::sleep(Duration::from_millis(250));
                    if sess().gen != gen || sess().open {
                        return;
                    }
                    let h = win::find_xmb_window();
                    if h != 0 {
                        win::close_window(h);
                        return;
                    }
                }
            });
        }
    }
    finish_close(app, gen);
}

/// Shared tail of closing (by the app or by the user closing the window).
fn finish_close(app: &AppHandle, _gen: u64) {
    let (prof, snap) = {
        let mut st = sess();
        st.open = false;
        st.phase = "closed".into();
        st.hwnd = 0;
        st.hidden = false;
        st.fullscreen = false;
        st.lw_fullscreen = false;
        st.settled = false;
        st.focus = false;
        st.cmds.clear();
        (st.profile.clone(), st.xul_snapshot.take())
    };
    #[cfg(windows)]
    {
        let parked = std::mem::take(&mut sess().parked);
        for h in parked { if win::is_window(h) { win::close_window(h); } }
        win::end_browser_ui();
        let _ = std::fs::remove_file(ui_marker(app));
        app_topmost(app, false);
        focus_app(app);
    }
    #[cfg(not(windows))]
    let _ = app;
    if let Some(snap) = snap {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1500));
            for _ in 0..60 {
                if !profile_in_use(&prof) {
                    write_xul_geometry(&prof, &snap);
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
    }
}

/// Called once when the app starts: undo a browser session the app didn't get
/// to clean up (cursors / taskbar).
#[cfg_attr(not(windows), allow(unused_variables))]
pub fn on_app_start(app: &AppHandle) {
    #[cfg(windows)]
    {
        if ui_marker(app).exists() {
            win::end_browser_ui();
            let _ = std::fs::remove_file(ui_marker(app));
        }
    }
}

/// Called when the app is closing.
pub fn on_app_exit(app: &AppHandle) {
    close_session(app);
    #[cfg(windows)]
    {
        if ui_marker(app).exists() {
            win::end_browser_ui();
            let _ = std::fs::remove_file(ui_marker(app));
        }
    }
}

// ---------------------------------------------------------------------------
// tauri commands (all off the main thread)
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn browser_status(app: AppHandle) -> Value {
    let bin = find_librewolf(&app);
    json!({
        "installed": bin.is_some(),
        "ready": bin.is_some(),
        "path": bin.map(|p| p.display().to_string()),
        "browserDir": crate::paths::browser_dir(&app).display().to_string(),
        "profile": profile_dir(&app).display().to_string(),
    })
}

/// Open the XMB browser window. mode "search" (url = the query, run on your
/// default engine), "url" (url = address), anything else = home page.
/// x/y/w/h: the panel in physical px; cx/cy/cw/ch: the same in CSS px.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn browser_open(app: AppHandle, mode: String, url: Option<String>,
                    x: f64, y: f64, w: f64, h: f64,
                    cx: f64, cy: f64, cw: f64, ch: f64) -> Result<(), String> {
    launch(&app, mode, url, (x as i32, y as i32, w as i32, h as i32), (cx, cy, cw, ch))
}

#[tauri::command(async)]
pub fn browser_close(app: AppHandle) {
    close_session(&app);
}

#[tauri::command(async)]
pub fn browser_state() -> Value {
    let st = sess();
    json!({
        "open": st.open, "phase": st.phase,
        "focus": st.focus, "focusSeq": st.focus_seq, "focusValue": st.focus_value,
        "focusReplace": st.focus_replace, "focusPassword": st.focus_password,
        "title": st.title, "url": st.url, "hover": st.hover,
    })
}

/// Controller pointer: relative move (physical px), button "down"/"up",
/// scroll in wheel notches (+ = up).
#[tauri::command(async)]
pub fn browser_input(dx: f64, dy: f64, button: Option<String>, scroll: f64) {
    let (hwnd, hidden, rect) = {
        let st = sess();
        (st.hwnd, st.hidden, page_rect(&st))
    };
    if hwnd == 0 || hidden {
        return;
    }
    #[cfg(windows)]
    {
        if dx != 0.0 || dy != 0.0 {
            win::move_cursor(dx.round() as i32, dy.round() as i32, rect);
        }
        if scroll != 0.0 {
            let u = (scroll * 120.0).round() as i32;
            if u != 0 { win::wheel_raw(u); }
        }
        match button.as_deref() {
            Some("down") => win::mouse_button(true),
            Some("up") => win::mouse_button(false),
            _ => {}
        }
    }
    #[cfg(not(windows))]
    let _ = (dx, dy, button, scroll, rect);
}

/// Hide the window while the app's on-screen keyboard is up (and give the app
/// focus), or show it again.
#[tauri::command(async)]
pub fn browser_visible(app: AppHandle, visible: bool) {
    let hwnd = {
        let mut st = sess();
        st.hidden = !visible;
        st.hwnd
    };
    #[cfg(windows)]
    {
        if hwnd != 0 {
            if visible {
                win::show(hwnd);
                win::force_foreground(hwnd);
            } else {
                win::unclip();
                win::hide(hwnd);
                focus_app(&app);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (app, hwnd);
}

/// The browser's window while it's open (0 = none).
pub fn browser_hwnd() -> isize {
    let st = sess();
    if st.open { st.hwnd } else { 0 }
}

/// The key that takes a screenshot while the browser has focus (Windows
/// virtual-key code; 0 = none).
#[tauri::command(async)]
pub fn browser_set_hotkeys(screenshot_vk: u32, tab_key: Option<String>, tab_vk: Option<u32>) {
    SHOT_VK.store(screenshot_vk, Ordering::SeqCst);
    if let Some(v) = tab_vk { TAB_VK.store(v, Ordering::SeqCst); }
    if let Some(k) = tab_key {
        if let Ok(mut c) = TAB_CODE.lock() { *c = k; }
        TAB_CODE_SET.store(true, Ordering::SeqCst);
    }
}

/// Queue a command for the helper: back, forward, reload, closetab, nexttab, prevtab,
/// navigate (value = address or search text), search (value = text); "fullscreen"
/// (L3) toggles full screen instead.
#[tauri::command(async)]
pub fn browser_cmd(cmd: String, value: Option<String>) {
    let mut st = sess();
    if st.open && cmd == "fullscreen" {
        // (done here: the window's size is the watchdog's business)
        let gen = st.gen;
        drop(st);
        toggle_fullscreen(gen);
        return;
    }
    if st.open {
        st.cmds.push(json!({ "cmd": cmd, "value": value }));
    }
}

/// Type text into the focused page field (inserted by the helper).
#[tauri::command(async)]
pub fn browser_type(text: String, replace: bool, enter: bool) {
    let mut st = sess();
    if st.open {
        st.cmds.push(json!({ "cmd": "type", "text": text, "replace": replace, "enter": enter }));
    }
}

// ---------------------------------------------------------------------------
// Windows glue
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[allow(dead_code, non_snake_case, clippy::upper_case_acronyms)]
mod win {
    use std::path::Path;

    pub type HWND = isize;
    type BOOL = i32;
    type DWORD = u32;
    type LPARAM = isize;
    type WPARAM = usize;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct RECT { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct POINT { pub x: i32, pub y: i32 }
    #[repr(C)]
    struct MSG { hwnd: isize, message: u32, wparam: usize, lparam: isize, time: u32, pt: POINT, l_private: u32 }
    #[repr(C)]
    struct MOUSEINPUT { dx: i32, dy: i32, mouse_data: u32, flags: u32, time: u32, extra: usize }
    // INPUT with the mouse member only: MOUSEINPUT is the union's largest
    // member, so the layout/size match the Win32 INPUT struct.
    #[repr(C)]
    struct INPUT { kind: u32, mi: MOUSEINPUT }

    const GWL_EXSTYLE: i32 = -20;
    const GWL_STYLE: i32 = -16;
    const WS_THICKFRAME: u32 = 0x0004_0000;
    const WS_EX_TOPMOST: u32 = 0x0000_0008;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const HWND_TOPMOST: isize = -1;
    const HWND_NOTOPMOST: isize = -2;
    const HWND_BOTTOM: isize = 1;
    const SW_HIDE: i32 = 0;
    const SW_SHOWNOACTIVATE: i32 = 4;
    const SW_SHOW: i32 = 5;
    const WM_CLOSE: u32 = 0x0010;
    const PM_NOREMOVE: u32 = 0x0000;
    const INPUT_MOUSE: u32 = 0;
    const MOUSEEVENTF_MOVE: u32 = 0x0001;
    const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
    const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
    const MOUSEEVENTF_WHEEL: u32 = 0x0800;
    const LR_LOADFROMFILE: u32 = 0x0010;
    const IMAGE_CURSOR: u32 = 2;
    const SPI_SETCURSORS: u32 = 0x0057;
    const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
    const OCR_NORMAL: u32 = 32512;
    const OCR_IBEAM: u32 = 32513;
    const OCR_WAIT: u32 = 32514;
    const OCR_SIZEALL: u32 = 32646;
    const OCR_HAND: u32 = 32649;
    const OCR_APPSTARTING: u32 = 32650;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(cb: extern "system" fn(HWND, LPARAM) -> BOOL, l: LPARAM) -> BOOL;
        fn GetClassNameW(h: HWND, buf: *mut u16, max: i32) -> i32;
        fn GetWindowTextW(h: HWND, buf: *mut u16, max: i32) -> i32;
        fn IsWindowVisible(h: HWND) -> BOOL;
        fn IsWindow(h: HWND) -> BOOL;
        fn IsIconic(h: HWND) -> BOOL;
        fn IsZoomed(h: HWND) -> BOOL;
        fn GetWindowRect(h: HWND, r: *mut RECT) -> BOOL;
        fn GetWindowLongW(h: HWND, idx: i32) -> i32;
        fn SetWindowPos(h: HWND, after: HWND, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> BOOL;
        fn ShowWindow(h: HWND, cmd: i32) -> BOOL;
        fn PostMessageW(h: HWND, msg: u32, w: WPARAM, l: LPARAM) -> BOOL;
        fn GetForegroundWindow() -> HWND;
        fn SetForegroundWindow(h: HWND) -> BOOL;
        fn BringWindowToTop(h: HWND) -> BOOL;
        fn SwitchToThisWindow(h: HWND, alt_tab: BOOL);
        fn GetWindowThreadProcessId(h: HWND, pid: *mut DWORD) -> DWORD;
        fn AttachThreadInput(attach: DWORD, to: DWORD, a: BOOL) -> BOOL;
        fn PeekMessageW(msg: *mut MSG, h: HWND, min: u32, max: u32, remove: u32) -> BOOL;
        fn GetCursorPos(p: *mut POINT) -> BOOL;
        fn SetCursorPos(x: i32, y: i32) -> BOOL;
        fn SendInput(n: u32, inputs: *const INPUT, cb: i32) -> u32;
        fn FindWindowW(class: *const u16, title: *const u16) -> HWND;
        fn LoadImageW(hinst: isize, name: *const u16, typ: u32, cx: i32, cy: i32, fu: u32) -> isize;
        fn SetSystemCursor(hcur: isize, id: u32) -> BOOL;
        fn SystemParametersInfoW(action: u32, ui: u32, pv: *mut core::ffi::c_void, winini: u32) -> BOOL;
        fn ClipCursor(r: *const RECT) -> BOOL;
        fn GetAsyncKeyState(vk: i32) -> i16;
        fn GetDpiForWindow(h: HWND) -> u32;
        fn GetSystemMetrics(index: i32) -> i32;
        fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
        fn MonitorFromWindow(h: HWND, flags: u32) -> isize;
        fn GetMonitorInfoW(m: isize, mi: *mut MONITORINFO) -> BOOL;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> DWORD;
        fn OpenProcess(access: DWORD, inherit: BOOL, pid: DWORD) -> isize;
        fn QueryFullProcessImageNameW(h: isize, flags: DWORD, buf: *mut u16, size: *mut DWORD) -> BOOL;
        fn CloseHandle(h: isize) -> BOOL;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;

    fn process_path(h: HWND) -> String {
        unsafe {
            let mut pid: DWORD = 0;
            GetWindowThreadProcessId(h, &mut pid);
            if pid == 0 { return String::new(); }
            let ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if ph == 0 { return String::new(); }
            let mut buf = [0u16; 1024];
            let mut n: DWORD = buf.len() as DWORD;
            let ok = QueryFullProcessImageNameW(ph, 0, buf.as_mut_ptr(), &mut n);
            CloseHandle(ph);
            if ok == 0 { String::new() } else { String::from_utf16_lossy(&buf[..n as usize]) }
        }
    }
    struct LwFinder { dir: String, out: Vec<HWND> }
    extern "system" fn lw_cb(h: HWND, l: LPARAM) -> BOOL {
        unsafe {
            let f = &mut *(l as *mut LwFinder);
            if IsWindowVisible(h) != 0 && class_name(h).starts_with("MozillaWindowClass")
                && process_path(h).to_lowercase().starts_with(&f.dir) {
                f.out.push(h);
            }
        }
        1
    }
    /// The visible top-level windows of the LibreWolf in `dir` (the one the
    /// app runs: your own Firefox / LibreWolf elsewhere isn't touched).
    pub fn librewolf_windows(dir: &std::path::Path) -> Vec<HWND> {
        let d = dir.to_string_lossy().to_lowercase();
        if d.is_empty() { return Vec::new(); }
        let mut f = LwFinder { dir: d, out: Vec::new() };
        unsafe { EnumWindows(lw_cb, &mut f as *mut LwFinder as LPARAM); }
        f.out
    }
    pub fn title_is_xmb(h: HWND) -> bool { is_window(h) && window_text(h).starts_with("[XMB]") }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(h: HWND, attr: u32, pv: *mut core::ffi::c_void, cb: u32) -> i32;
        fn DwmSetWindowAttribute(h: HWND, attr: u32, pv: *const core::ffi::c_void, cb: u32) -> i32;
    }
    /// Square corners (Windows 11 rounds them by default; the panel is square).
    fn square_corners(h: HWND) {
        let pref: u32 = 1;   // DWMWCP_DONOTROUND
        unsafe { DwmSetWindowAttribute(h, 33, &pref as *const u32 as *const core::ffi::c_void, 4); }   // DWMWA_WINDOW_CORNER_PREFERENCE
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    fn class_name(h: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(h, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
    fn window_text(h: HWND) -> String {
        let mut buf = [0u16; 512];
        let n = unsafe { GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    struct Finder { found: HWND }
    extern "system" fn find_cb(h: HWND, l: LPARAM) -> BOOL {
        unsafe {
            let f = &mut *(l as *mut Finder);
            if IsWindowVisible(h) == 0 {
                return 1;
            }
            if !class_name(h).starts_with("MozillaWindowClass") {
                return 1;
            }
            if window_text(h).starts_with("[XMB]") {
                f.found = h;
                return 0;
            }
        }
        1
    }

    /// The LibreWolf window marked "[XMB] …" (by its bootstrap page title, then
    /// by the helper's title preface).
    pub fn find_xmb_window() -> HWND {
        let mut f = Finder { found: 0 };
        unsafe { EnumWindows(find_cb, &mut f as *mut Finder as LPARAM); }
        f.found
    }

    pub fn is_window(h: HWND) -> bool {
        h != 0 && unsafe { IsWindow(h) } != 0
    }

    /// Keep the window at the panel rect (compensating for the invisible
    /// resize borders Windows adds around it), restored, visible and topmost.
    pub fn enforce(h: HWND, rect: (i32, i32, i32, i32), hidden: bool, behind: bool) {
        unsafe {
            if hidden {
                if IsWindowVisible(h) != 0 {
                    ShowWindow(h, SW_HIDE);
                }
                return;
            }
            square_corners(h);
            if IsIconic(h) != 0 || IsZoomed(h) != 0 || IsWindowVisible(h) == 0 {
                ShowWindow(h, SW_SHOWNOACTIVATE);
            }
            let mut wr = RECT::default();
            if GetWindowRect(h, &mut wr) == 0 {
                return;
            }
            let mut er = RECT::default();
            let ok = DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut er as *mut RECT as *mut core::ffi::c_void, std::mem::size_of::<RECT>() as u32) == 0;
            let sane = |v: i32| if (0..=24).contains(&v) { v } else { 0 };
            let (ml, mt, mr, mb) = if ok {
                (sane(er.left - wr.left), sane(er.top - wr.top), sane(wr.right - er.right), sane(wr.bottom - er.bottom))
            } else {
                (0, 0, 0, 0)
            };
            let (x, y, w, hh) = rect;
            let (tx, ty, tw, th) = (x - ml, y - mt, w + ml + mr, hh + mt + mb);
            // LibreWolf's own full screen (F11 / a video's button): it drops the
            // window's frame and covers the monitor; left as it is (the app
            // hears about it from the helper a moment later)
            let thick = (GetWindowLongW(h, GWL_STYLE) as u32) & WS_THICKFRAME != 0;
            if !thick && !behind {
                let (mx, my, mw, mh) = monitor_rect(h);
                if mw > 0 && wr.left == mx && wr.top == my && wr.right - wr.left == mw && wr.bottom - wr.top == mh {
                    let topmost = (GetWindowLongW(h, GWL_EXSTYLE) as u32) & WS_EX_TOPMOST != 0;
                    if !topmost { SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
                    return;
                }
            }
            if behind {
                // in place, but under every other window (the app covers it)
                SetWindowPos(h, HWND_BOTTOM, tx, ty, tw, th, SWP_NOACTIVATE | SWP_SHOWWINDOW);
                return;
            }
            let topmost = (GetWindowLongW(h, GWL_EXSTYLE) as u32) & WS_EX_TOPMOST != 0;
            let off = wr.left != tx || wr.top != ty || wr.right - wr.left != tw || wr.bottom - wr.top != th;
            if off || !topmost {
                SetWindowPos(h, HWND_TOPMOST, tx, ty, tw, th, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            }
        }
    }

    pub fn keep_topmost(h: HWND) {
        unsafe {
            if (GetWindowLongW(h, GWL_EXSTYLE) as u32) & WS_EX_TOPMOST == 0 {
                SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
    }
    /// Is the page area of the window exactly at `rect`?
    pub fn at_rect(h: HWND, rect: (i32, i32, i32, i32)) -> bool {
        unsafe {
            let mut er = RECT::default();
            let ok = DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut er as *mut RECT as *mut core::ffi::c_void, std::mem::size_of::<RECT>() as u32) == 0;
            if !ok && GetWindowRect(h, &mut er) == 0 { return false; }
            let (x, y, w, hh) = rect;
            (er.left - x).abs() <= 2 && (er.top - y).abs() <= 2
                && (er.right - (x + w)).abs() <= 2 && (er.bottom - (y + hh)).abs() <= 2
        }
    }

    #[repr(C)]
    struct MONITORINFO { cb: u32, monitor: RECT, work: RECT, flags: u32 }
    /// The whole monitor the window is on (physical px).
    pub fn monitor_rect(h: HWND) -> (i32, i32, i32, i32) {
        unsafe {
            let m = MonitorFromWindow(h, 2);   // MONITOR_DEFAULTTONEAREST
            let mut mi = MONITORINFO { cb: std::mem::size_of::<MONITORINFO>() as u32,
                                       monitor: RECT::default(), work: RECT::default(), flags: 0 };
            if m == 0 || GetMonitorInfoW(m, &mut mi) == 0 { return (0, 0, 0, 0); }
            let r = mi.monitor;
            (r.left, r.top, r.right - r.left, r.bottom - r.top)
        }
    }

    /// Is this virtual key held right now (works whichever window has focus)?
    pub fn key_down(vk: i32) -> bool {
        (unsafe { GetAsyncKeyState(vk) } as u16) & 0x8000 != 0
    }

    /// Display scale of the window (1.0 = 96 dpi).
    pub fn dpi_scale(h: HWND) -> f32 {
        let d = unsafe { GetDpiForWindow(h) };
        if d == 0 { 1.0 } else { d as f32 / 96.0 }
    }

    /// Confine the pointer to the page, a little inside the window edges.
    /// LibreWolf answers its own resize hit-test along the window border (it
    /// ignores the window styles), so keeping the pointer off that strip is
    /// what makes the window impossible to stretch or drag. Windows drops the
    /// clip on focus changes, so the watchdog re-applies it every tick.
    pub fn clip_to(h: HWND, rect: (i32, i32, i32, i32)) {
        let (x, y, w, hh) = rect;
        if w <= 40 || hh <= 40 { return; }
        let s = dpi_scale(h);
        let side = (4.0 * s).ceil() as i32;
        let top = (10.0 * s).ceil() as i32;
        let r = RECT { left: x + side, top: y + top, right: x + w - side, bottom: y + hh - side };
        unsafe { ClipCursor(&r); }
    }
    pub fn unclip() {
        unsafe { ClipCursor(std::ptr::null()); }
    }

    pub fn close_window(h: HWND) {
        unsafe {
            SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            PostMessageW(h, WM_CLOSE, 0, 0);
        }
    }

    pub fn hide(h: HWND) {
        unsafe { ShowWindow(h, SW_HIDE); }
    }
    pub fn show(h: HWND) {
        unsafe {
            ShowWindow(h, SW_SHOWNOACTIVATE);
            SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    /// Bring a window to the front even when our process isn't the foreground
    /// one (input from a controller doesn't count as user input for Windows).
    pub fn force_foreground(h: HWND) {
        if h == 0 {
            return;
        }
        unsafe {
            if GetForegroundWindow() == h {
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            PeekMessageW(&mut msg, 0, 0, 0, PM_NOREMOVE); // make sure this thread has a queue
            let fg = GetForegroundWindow();
            let me = GetCurrentThreadId();
            let fg_tid = if fg != 0 { GetWindowThreadProcessId(fg, std::ptr::null_mut()) } else { 0 };
            let attached = fg_tid != 0 && fg_tid != me && AttachThreadInput(me, fg_tid, 1) != 0;
            BringWindowToTop(h);
            SetForegroundWindow(h);
            if attached {
                AttachThreadInput(me, fg_tid, 0);
            }
            if GetForegroundWindow() != h {
                SwitchToThisWindow(h, 1);
            }
        }
    }

    fn send_mouse(flags: u32, data: u32) {
        let inp = INPUT { kind: INPUT_MOUSE, mi: MOUSEINPUT { dx: 0, dy: 0, mouse_data: data, flags, time: 0, extra: 0 } };
        unsafe { SendInput(1, &inp, std::mem::size_of::<INPUT>() as i32); }
    }
    /// A one-pixel move there and back, as a real mouse would make: Windows
    /// shows a pointer it had hidden (it stays hidden for moves made by
    /// SetCursorPos alone until a mouse moves, so with only a controller it
    /// would never show) and the window under it sets its cursor shape.
    pub fn wake_pointer() {
        for dx in [1, -1] {
            let inp = INPUT { kind: INPUT_MOUSE, mi: MOUSEINPUT { dx, dy: 0, mouse_data: 0, flags: MOUSEEVENTF_MOVE, time: 0, extra: 0 } };
            unsafe { SendInput(1, &inp, std::mem::size_of::<INPUT>() as i32); }
        }
    }
    /// A window of this app's own (a file / folder window) that's in front.
    pub fn own_dialog() -> HWND {
        let h = foreground();
        if h == 0 { return 0; }
        let mut pid: DWORD = 0;
        unsafe { GetWindowThreadProcessId(h, &mut pid); }
        if pid != std::process::id() { return 0; }
        let mut buf = [0u16; 64];
        let n = unsafe { GetClassNameW(h, buf.as_mut_ptr(), 64) };
        if n <= 0 { return 0; }
        // (#32770: the Windows dialog class the file / folder windows use)
        if String::from_utf16_lossy(&buf[..n as usize]) == "#32770" { h } else { 0 }
    }
    /// Put a window in the middle of the area (x, y, w, h), its size kept.
    pub fn center_window(h: HWND, area: (i32, i32, i32, i32)) {
        let mut r = RECT::default();
        if h == 0 || unsafe { GetWindowRect(h, &mut r) } == 0 { return; }
        let (ww, wh) = (r.right - r.left, r.bottom - r.top);
        let (x, y, w, hh) = area;
        if ww <= 0 || wh <= 0 || w <= 0 || hh <= 0 { return; }
        let nx = x + (w - ww).max(0) / 2;
        let ny = y + (hh - wh).max(0) / 2;
        unsafe { SetWindowPos(h, 0, nx, ny, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE); }
    }
    /// A window's rectangle as (x, y, w, h).
    pub fn window_area(h: HWND) -> Option<(i32, i32, i32, i32)> {
        let mut r = RECT::default();
        (h != 0 && unsafe { GetWindowRect(h, &mut r) } != 0 && r.right > r.left).then(|| (r.left, r.top, r.right - r.left, r.bottom - r.top))
    }

    /// Move the real pointer by (dx, dy), clamped inside the panel.
    pub fn move_cursor(dx: i32, dy: i32, rect: (i32, i32, i32, i32)) {
        let (x, y, w, h) = rect;
        if w <= 0 || h <= 0 {
            return;
        }
        unsafe {
            let mut p = POINT::default();
            GetCursorPos(&mut p);
            let nx = (p.x + dx).clamp(x, x + w - 1);
            let ny = (p.y + dy).clamp(y, y + h - 1);
            SetCursorPos(nx, ny);
        }
        // a zero-distance move so the page gets a mouse-move (hover, cursor shape)
        send_mouse(MOUSEEVENTF_MOVE, 0);
    }

    pub fn center_cursor(rect: (i32, i32, i32, i32)) {
        let (x, y, w, h) = rect;
        unsafe { SetCursorPos(x + w / 2, y + h / 2); }
        wake_pointer();
    }

    pub fn wheel(notches: i32) {
        send_mouse(MOUSEEVENTF_WHEEL, (notches * 120) as u32);
    }
    /// Scroll by raw wheel units (120 = one notch; + = up), for smooth scrolling.
    pub fn wheel_raw(units: i32) {
        send_mouse(MOUSEEVENTF_WHEEL, units as u32);
    }

    pub fn right_button(down: bool) {
        send_mouse(if down { 0x0008 } else { 0x0010 }, 0);   // MOUSEEVENTF_RIGHTDOWN / RIGHTUP
    }
    pub fn mouse_button(down: bool) {
        send_mouse(if down { MOUSEEVENTF_LEFTDOWN } else { MOUSEEVENTF_LEFTUP }, 0);
    }

    // ---- system cursors + taskbar while browsing ---------------------------
    fn set_cursor(dir: &Path, file: &str, ids: &[u32]) {
        let w = wide(&dir.join(file).to_string_lossy());
        for &id in ids {
            // SetSystemCursor takes ownership, so load a fresh handle per id
            let h = unsafe { LoadImageW(0, w.as_ptr(), IMAGE_CURSOR, 0, 0, LR_LOADFROMFILE) };
            if h != 0 {
                unsafe { SetSystemCursor(h, id); }
            }
        }
    }

    fn taskbars(show: bool) {
        for class in ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"] {
            let c = wide(class);
            let h = unsafe { FindWindowW(c.as_ptr(), std::ptr::null()) };
            if h != 0 {
                unsafe { ShowWindow(h, if show { SW_SHOW } else { SW_HIDE }); }
            }
        }
    }

    /// Press / drag cursors: swap the XMB click (short finger) or fist in
    /// for the arrow, link and text cursors until the button is released.
    pub fn cursor_mode(cursor_dir: &Path, mode: &str) {
        match mode {
            "click" => set_cursor(cursor_dir, "click.cur", &[OCR_HAND, OCR_NORMAL]),
            "grab" => set_cursor(cursor_dir, "grab.cur", &[OCR_NORMAL, OCR_HAND, OCR_IBEAM, OCR_SIZEALL]),
            _ => {
                set_cursor(cursor_dir, "arrow.cur", &[OCR_NORMAL]);
                set_cursor(cursor_dir, "pen.cur", &[OCR_IBEAM]);
                set_cursor(cursor_dir, "finger.cur", &[OCR_HAND]);
                set_cursor(cursor_dir, "hand.cur", &[OCR_SIZEALL]);
            }
        }
    }
    pub fn begin_browser_ui(cursor_dir: &Path) {
        taskbars(false);
        set_cursor(cursor_dir, "arrow.cur", &[OCR_NORMAL, OCR_WAIT, OCR_APPSTARTING]);
        set_cursor(cursor_dir, "pen.cur", &[OCR_IBEAM]);
        set_cursor(cursor_dir, "finger.cur", &[OCR_HAND]);
        set_cursor(cursor_dir, "hand.cur", &[OCR_SIZEALL]);
    }

    /// File / folder pickers: the XMB cursors, the taskbar left alone.
    pub fn begin_picker_ui(cursor_dir: &Path) {
        set_cursor(cursor_dir, "arrow.cur", &[OCR_NORMAL, OCR_WAIT, OCR_APPSTARTING]);
        set_cursor(cursor_dir, "pen.cur", &[OCR_IBEAM]);
        set_cursor(cursor_dir, "finger.cur", &[OCR_HAND]);
        set_cursor(cursor_dir, "hand.cur", &[OCR_SIZEALL]);
    }
    pub fn end_picker_ui() {
        unsafe { SystemParametersInfoW(SPI_SETCURSORS, 0, std::ptr::null_mut(), 0); }
    }
    /// The whole desktop (every monitor) as (x, y, w, h).
    pub fn screen_rect() -> (i32, i32, i32, i32) {
        unsafe { (GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79)) }
    }
    pub fn foreground() -> HWND {
        unsafe { GetForegroundWindow() }
    }
    /// Put the pointer in the middle of the foreground window (the dialog).
    /// Maximize the window, or restore it if it already is.
    pub fn toggle_maximize(h: HWND) {
        if h == 0 { return; }
        unsafe { ShowWindow(h, if IsZoomed(h) != 0 { 9 } else { 3 }); }   // SW_RESTORE / SW_MAXIMIZE
    }
    pub fn center_on_foreground() {
        let h = foreground();
        let mut r = RECT::default();
        if h != 0 && unsafe { GetWindowRect(h, &mut r) } != 0 && r.right > r.left && r.bottom > r.top {
            center_cursor((r.left, r.top, r.right - r.left, r.bottom - r.top));
        } else {
            center_cursor(screen_rect());
        }
    }
    /// Hold the keys in order, then release them in reverse (a shortcut).
    pub fn key_combo(vks: &[u8]) {
        unsafe {
            for &vk in vks { keybd_event(vk, 0, 0, 0); }
            for &vk in vks.iter().rev() { keybd_event(vk, 0, 0x0002, 0); }
        }
    }
    /// Press and release one key.
    pub fn key_tap(vk: u8) {
        unsafe {
            keybd_event(vk, 0, 0, 0);
            keybd_event(vk, 0, 0x0002, 0);   // KEYEVENTF_KEYUP
        }
    }

    pub fn end_browser_ui() {
        unclip();
        unsafe { SystemParametersInfoW(SPI_SETCURSORS, 0, std::ptr::null_mut(), 0); }
        taskbars(true);
    }
}
