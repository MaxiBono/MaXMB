//! The System's log: content\Logs\MaXMB.log, made fresh at every start (the
//! one before is kept as "MaXMB (previous).log"). It has what went wrong or
//! was left out (errors and warnings from the menus and from the back end,
//! and a crash's message), so a user can post it with a bug report.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// (the log stops growing past this size; a fresh one is made at the next start)
const MAX_BYTES: u64 = 5 * 1024 * 1024;

struct Log { file: Option<File>, size: u64, last: String, repeats: u32, full: bool }

fn state() -> &'static Mutex<Log> {
    static S: OnceLock<Mutex<Log>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Log { file: None, size: 0, last: String::new(), repeats: 0, full: false }))
}

pub fn dir(app: &tauri::AppHandle) -> PathBuf { crate::paths::content_root(app).join("Logs") }

/// Start the log (once, when the System starts).
pub fn init(app: &tauri::AppHandle) {
    let d = dir(app);
    let _ = fs::create_dir_all(&d);
    let cur = d.join("MaXMB.log");
    if cur.exists() { let _ = fs::rename(&cur, d.join("MaXMB (previous).log")); }
    let Ok(f) = OpenOptions::new().create(true).write(true).truncate(true).open(&cur) else { return };
    {
        let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
        s.file = Some(f);
    }
    let info = app.package_info();
    write_raw(&format!("MaXMB {} — started {}\nSystem: {} {}\n\n", info.version, now(), std::env::consts::OS, std::env::consts::ARCH));
    // a crash: its message goes in the log too
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |p| {
        line("CRASH", "system", &p.to_string());
        prev(p);
    }));
}

fn now() -> String { chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string() }

fn write_raw(text: &str) {
    let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
    if s.full { return; }
    let n = text.len() as u64;
    if s.size + n > MAX_BYTES {
        s.full = true;
        let msg = format!("{} [INFO] The log is full: nothing more is written until the next start.\n", now());
        if let Some(f) = s.file.as_mut() { let _ = f.write_all(msg.as_bytes()); let _ = f.flush(); }
        return;
    }
    if let Some(f) = s.file.as_mut() { if f.write_all(text.as_bytes()).is_ok() { let _ = f.flush(); } }
    s.size += n;
}

/// One line: "2026-10-23 20:52:01 [WARN] menus: ...". The same message many
/// times in a row is written once, with how many times it came.
pub fn line(level: &str, from: &str, msg: &str) {
    let msg = msg.trim();
    if msg.is_empty() { return; }
    let key = format!("{level}|{from}|{msg}");
    let flush_repeats = {
        let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
        if s.last == key { s.repeats += 1; return; }
        let r = s.repeats;
        s.last = key; s.repeats = 0;
        r
    };
    if flush_repeats > 0 { write_raw(&format!("{} [INFO] (the line above came {} more time{})\n", now(), flush_repeats, if flush_repeats == 1 { "" } else { "s" })); }
    write_raw(&format!("{} [{level}] {from}: {msg}\n", now()));
}

/// A warning from the back end: in the log, and in the console as before.
#[macro_export]
macro_rules! warn_log {
    ($($t:tt)*) => {{ let m = format!($($t)*); eprintln!("{}", m); $crate::log::line("WARN", "system", &m); }};
}

/// From the menus: errors, warnings and failed requests.
#[tauri::command]
pub fn log_write(level: String, msg: String) {
    let level = match level.to_lowercase().as_str() { "error" => "ERROR", "info" => "INFO", _ => "WARN" };
    line(level, "menus", &msg);
}
