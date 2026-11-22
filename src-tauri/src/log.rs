//! The System's log: content\Logs\MaXMB.log, made fresh at every start (the
//! three before are kept: "MaXMB (previous).log", then "MaXMB (previous 2).log"
//! and "MaXMB (previous 3).log", the oldest). It has what went wrong or
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

/// The logs kept besides the one being written (the last 4 sessions' in all).
const KEPT: usize = 3;
fn kept_name(n: usize) -> String { if n == 1 { "MaXMB (previous).log".into() } else { format!("MaXMB (previous {n}).log") } }
/// Each log one place older (the oldest dropped); the last session's becomes "(previous)".
fn rotate(d: &std::path::Path) {
    let cur = d.join("MaXMB.log");
    if !cur.exists() { return; }
    let _ = fs::remove_file(d.join(kept_name(KEPT)));
    for n in (1..KEPT).rev() {
        let from = d.join(kept_name(n));
        if from.exists() { let _ = fs::rename(&from, d.join(kept_name(n + 1))); }
    }
    let _ = fs::rename(&cur, d.join(kept_name(1)));
}

/// Start the log (once, when the System starts).
pub fn init(app: &tauri::AppHandle) {
    let d = dir(app);
    let _ = fs::create_dir_all(&d);
    let cur = d.join("MaXMB.log");
    rotate(&d);
    let Ok(f) = OpenOptions::new().create(true).write(true).truncate(true).open(&cur) else { return };
    #[cfg(windows)]
    native::start(&f);
    {
        let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
        s.file = Some(f);
    }
    let info = app.package_info();
    write_raw(&format!("MaXMB {} — started {}\nSystem: {} {}\n\n", info.version, now(), std::env::consts::OS, std::env::consts::ARCH));
    // a crash: its message goes in the log too (which part of the system it was in: the thread's name).
    // Outside the main thread only that part stops (a background task, the pop-up's queue...): MaXMB goes on.
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |p| {
        let t = std::thread::current();
        let name = t.name().unwrap_or("unnamed");
        if name == "main" { line("CRASH", "system", &format!("{} (thread {})", p, name)); }
        else { line("ERROR", "system", &format!("a part of the system failed and stopped, MaXMB goes on: {} (thread {})", p, name)); }
        prev(p);
    }));
}

/// A crash that isn't a Rust panic (Windows ends the program: a bad memory access, heap
/// corruption, a stack overflow...): its code, where it was (the program file the address is
/// in) and the time, written in the log before Windows closes the system -- straight to the
/// file, with nothing allocated and no lock taken (the memory may be damaged by then).
#[cfg(test)]
mod tests {
    #[test]
    fn the_last_four_sessions_logs_are_kept() {
        let d = std::env::temp_dir().join(format!("xmb_logs_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap();
        let w = |n: &str, t: &str| std::fs::write(d.join(n), t).unwrap();
        let r = |n: &str| std::fs::read_to_string(d.join(n)).ok();
        // (no log yet: nothing to keep)
        super::rotate(&d);
        assert!(std::fs::read_dir(&d).unwrap().next().is_none());
        for i in 1..=6 { w("MaXMB.log", &format!("s{i}")); super::rotate(&d); }
        assert_eq!(r("MaXMB (previous).log").as_deref(), Some("s6"));
        assert_eq!(r("MaXMB (previous 2).log").as_deref(), Some("s5"));
        assert_eq!(r("MaXMB (previous 3).log").as_deref(), Some("s4"));
        assert!(r("MaXMB (previous 4).log").is_none() && r("MaXMB.log").is_none());
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 3);
        let _ = std::fs::remove_dir_all(&d);
    }
}

#[cfg(windows)]
mod native {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
    static FILE: AtomicIsize = AtomicIsize::new(0);
    static SAID: AtomicU32 = AtomicU32::new(0);
    #[repr(C)]
    struct ExceptionRecord { code: u32, flags: u32, next: *mut ExceptionRecord, addr: *mut c_void, n: u32, info: [usize; 15] }
    #[repr(C)]
    struct ExceptionPointers { rec: *mut ExceptionRecord, ctx: *mut c_void }
    type Handler = unsafe extern "system" fn(*mut ExceptionPointers) -> i32;
    #[link(name = "kernel32")]
    extern "system" {
        fn AddVectoredExceptionHandler(first: u32, h: Handler) -> *mut c_void;
        fn WriteFile(h: isize, buf: *const u8, n: u32, written: *mut u32, ov: *mut c_void) -> i32;
        fn FlushFileBuffers(h: isize) -> i32;
        fn GetModuleHandleExW(flags: u32, addr: *const c_void, out: *mut isize) -> i32;
        fn GetModuleFileNameW(m: isize, buf: *mut u16, n: u32) -> u32;
        fn GetCurrentThreadId() -> u32;
        fn GetLocalTime(t: *mut [u16; 8]);
        fn RtlCaptureStackBackTrace(skip: u32, n: u32, frames: *mut *mut c_void, hash: *mut u32) -> u16;
    }
    pub fn start(f: &std::fs::File) {
        use std::os::windows::io::AsRawHandle;
        FILE.store(f.as_raw_handle() as isize, Ordering::SeqCst);
        unsafe { AddVectoredExceptionHandler(1, on_exception); }
    }
    /// (a line built in a fixed buffer)
    struct Buf { b: [u8; 2400], n: usize }
    impl Buf {
        fn s(&mut self, t: &[u8]) { for &c in t { if self.n < self.b.len() { self.b[self.n] = c; self.n += 1; } } }
        fn hex(&mut self, v: u64, digits: u32) { for i in (0..digits).rev() { let d = ((v >> (i * 4)) & 0xF) as u8; self.s(&[if d < 10 { b'0' + d } else { b'A' + d - 10 }]); } }
        fn dec(&mut self, mut v: u64) { let mut t = [0u8; 20]; let mut i = 0; loop { t[i] = b'0' + (v % 10) as u8; v /= 10; i += 1; if v == 0 { break; } } while i > 0 { i -= 1; self.s(&[t[i]]); } }
    }
    unsafe extern "system" fn on_exception(p: *mut ExceptionPointers) -> i32 {
        const CONTINUE_SEARCH: i32 = 0;
        if p.is_null() || (*p).rec.is_null() { return CONTINUE_SEARCH; }
        let r = &*(*p).rec;
        // (only the ones that end a program: access violation, heap corruption, a stack
        // buffer overrun / fail fast, stack overflow, illegal instruction, division by zero)
        let fatal = matches!(r.code, 0xC0000005 | 0xC0000374 | 0xC0000409 | 0xC00000FD | 0xC000001D | 0xC0000094 | 0xC0000096);
        if !fatal || SAID.fetch_add(1, Ordering::SeqCst) >= 3 { return CONTINUE_SEARCH; }
        let h = FILE.load(Ordering::SeqCst);
        if h == 0 { return CONTINUE_SEARCH; }
        let mut b = Buf { b: [0; 2400], n: 0 };
        // (the time as the other lines have it: 2026-11-18 08:43:07)
        let mut t = [0u16; 8];
        GetLocalTime(&mut t);
        let two = |b: &mut Buf, v: u16| { if v < 10 { b.s(b"0"); } b.dec(v as u64); };
        b.dec(t[0] as u64); b.s(b"-"); two(&mut b, t[1]); b.s(b"-"); two(&mut b, t[3]); b.s(b" ");
        two(&mut b, t[4]); b.s(b":"); two(&mut b, t[5]); b.s(b":"); two(&mut b, t[6]);
        b.s(b" [CRASH] system: Windows exception 0x"); b.hex(r.code as u64, 8);
        b.s(match r.code { 0xC0000005 => b" (access violation)" as &[u8], 0xC0000374 => b" (heap corruption)", 0xC0000409 => b" (stack buffer overrun / fail fast)",
            0xC00000FD => b" (stack overflow)", 0xC000001D => b" (illegal instruction)", _ => b"" });
        b.s(b" at 0x"); b.hex(r.addr as u64, 16);
        // (the program file it happened in: the system's own, Windows', WebView2's, a driver's...)
        let mut m: isize = 0;
        if GetModuleHandleExW(0x4 | 0x2, r.addr as *const c_void, &mut m) != 0 && m != 0 {
            let mut w = [0u16; 260];
            let n = GetModuleFileNameW(m, w.as_mut_ptr(), 260) as usize;
            b.s(b" in ");
            for &c in &w[..n.min(260)] { b.s(&[if c < 128 { c as u8 } else { b'?' }]); }
            b.s(b" +0x"); b.hex((r.addr as usize).wrapping_sub(m as usize) as u64, 8);
        }
        if r.code == 0xC0000005 && r.n >= 2 { b.s(if r.info[0] == 0 { b", reading 0x" } else if r.info[0] == 1 { b", writing 0x" } else { b", running 0x" }); b.hex(r.info[1] as u64, 16); }
        b.s(b" (thread "); b.dec(GetCurrentThreadId() as u64); b.s(b"); the system may close now\r\n");
        // (and the calls that led to it, each as its program file and the place in it: which part
        // -- the system's own, Windows', WebView2's, a driver's -- was freeing or writing the memory)
        b.s(b"    its calls, newest first:");
        let mut frames = [std::ptr::null_mut::<c_void>(); 40];
        let n = RtlCaptureStackBackTrace(0, 40, frames.as_mut_ptr(), std::ptr::null_mut()) as usize;
        for &f in &frames[..n.min(40)] {
            let mut m: isize = 0;
            b.s(b" ");
            if GetModuleHandleExW(0x4 | 0x2, f as *const c_void, &mut m) != 0 && m != 0 {
                let mut w = [0u16; 260];
                let k = (GetModuleFileNameW(m, w.as_mut_ptr(), 260) as usize).min(260);
                let start = w[..k].iter().rposition(|&c| c == b'\\' as u16).map(|i| i + 1).unwrap_or(0);
                for &c in &w[start..k] { b.s(&[if c < 128 { c as u8 } else { b'?' }]); }
                b.s(b"+0x"); b.hex((f as usize).wrapping_sub(m as usize) as u64, 8);
            } else { b.s(b"0x"); b.hex(f as u64, 16); }
        }
        b.s(b"\r\n");
        let mut wr = 0u32;
        WriteFile(h, b.b.as_ptr(), b.n as u32, &mut wr, std::ptr::null_mut());
        FlushFileBuffers(h);
        CONTINUE_SEARCH
    }
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
