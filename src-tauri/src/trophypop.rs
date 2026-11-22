//! The trophy pop-up ("You have earned a trophy."), near the top right of
//! the screen, always in the same proportions (the console's: a 422 x 102
//! box, 85 from the top and 103 from the right on a 1920 x 1080 screen,
//! 535 wide and taller for a long name, shown whole as the console does),
//! with the trophy sound.
//!
//! In the menus the page shows it itself ("trophy-pop"). While a game runs
//! it shows in a small window of its own (popup.html) over the game: always
//! on top, never taking the focus or the clicks, out of the taskbar. A game
//! in exclusive full screen may cover it (as with other programs' pop-ups).
//! One at a time, in the order they were won (a game's Platinum after the trophy
//! that completed it): each is shown in full, then nothing for a second, then the next.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::trophies::{Trophy, TrophySet};

static QUEUE: Mutex<VecDeque<Value>> = Mutex::new(VecDeque::new());
static RUNNING: Mutex<bool> = Mutex::new(false);
/// How long one pop-up stays (its fades included), and the gap after it.
const SHOW_MS: u64 = 5600;
const GAP_MS: u64 = 1000;
const LABEL: &str = "trophypop";
/// The menus' Font, Text Size, Text Color and PS3 theme notification picture,
/// for the window's pop-ups (sent by the page whenever they change)
static STYLE: Mutex<Value> = Mutex::new(Value::Null);

#[tauri::command]
pub fn trophy_pop_style(style: Value) { *lock(&STYLE) = style; }
/// A lock that's taken even after something went wrong while it was held: the pop-ups go on.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }

pub fn trophy(app: &AppHandle, set: &TrophySet, t: &Trophy) {
    crate::log::line("INFO", "trophies", &format!("trophy won: \"{}\" ({}): its pop-up {}", short(&t.name), short(&set.title),
        if crate::focus::in_game() { "over the game" } else { "in the menus" }));
    push(app, json!({ "kind": "trophy", "name": t.name, "grade": t.grade, "icon": t.icon, "src": t.src,
        "autoPlat": t.auto_plat, "game": set.title, "folder": set.folder, "id": t.id }));
}

fn short(s: &str) -> String { s.chars().take(80).collect() }
fn push(app: &AppHandle, v: Value) {
    lock(&QUEUE).push_back(v);
    let mut r = lock(&RUNNING);
    if *r { return; }
    *r = true;
    drop(r);
    let app = app.clone();
    // (the pop-ups shown one after another; however that ends -- the queue empty, or something
    // in it gone wrong --, the next trophy starts them again)
    let started = std::thread::Builder::new().name("trophy-pop".into()).spawn(move || {
        struct Done;
        impl Drop for Done { fn drop(&mut self) { if std::thread::panicking() { *lock(&RUNNING) = false; } } }
        let _done = Done;
        loop {
            // (the queue found empty and the pop-ups ended in one step, so a trophy won meanwhile isn't left waiting)
            let next = { let mut q = lock(&QUEUE); let n = q.pop_front(); if n.is_none() { *lock(&RUNNING) = false; } n };
            let Some(v) = next else { break };
            if crate::focus::in_game() { show_window(&app, &v); } else { let _ = app.emit_to("main", "trophy-pop", &v); }
            std::thread::sleep(Duration::from_millis(SHOW_MS + GAP_MS));
            if crate::focus::in_game() { hide_window(&app); }
        }
    });
    if started.is_err() { *lock(&RUNNING) = false; crate::log::line("WARN", "trophies", "the pop-ups couldn't be started"); }
}

/// The window's place: the box's, on the screen the menus are on.
fn rect(app: &AppHandle) -> Option<(i32, i32, u32, u32)> {
    let main = app.get_webview_window("main")?;
    let m = main.current_monitor().ok().flatten().or_else(|| main.primary_monitor().ok().flatten())?;
    let (p, s) = (m.position(), m.size());
    let k = s.height as f64 / 1080.0;
    // (room for the biggest box -- a long name shown whole: 535 wide, up to 400 tall -- and 8 of
    // its pixels around it for its shadow; the box at the window's top right, see popup.html)
    let m = 8.0;
    let (w, h) = (((535.0 + 2.0 * m) * k).round() as u32, ((400.0 + 2.0 * m) * k).round() as u32);
    let x = p.x + s.width as i32 - (((103.0 - m) * k).round() as i32) - w as i32;
    let y = p.y + ((85.0 - m) * k).round() as i32;
    Some((x, y, w, h))
}

/// The window's page has loaded and listens for pop-ups ("trophy-pop-ready" from popup.js).
static READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static LISTENING: std::sync::Once = std::sync::Once::new();
/// The window made (hidden) as a game starts, so it's loaded before a first trophy: with the
/// game running and the app stepping aside (a lower priority), making it then could take
/// longer than the pop-up waits, its first pop-up lost -- no box, no sound.
pub fn prepare(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let had = app.get_webview_window(LABEL).is_some();
        let t = std::time::Instant::now();
        let ok = window(&app).is_some();
        if !had { crate::log::line(if ok { "INFO" } else { "WARN" }, "trophies", &format!("the pop-up window over the game: {} in {} ms", if ok { "ready" } else { "couldn't be made" }, t.elapsed().as_millis())); }
    });
}
/// The pop-up window closed, to be made again the next time it's needed: its page runs in the
/// same WebView2 as the app's own page (the same folder), so when that stopped during a game the
/// pop-up's page stopped with it. The app's window is made anew then (focus.rs remake_window),
/// and this one goes first, so nothing of the WebView2 that stopped is left in the app when the
/// new one starts.
pub fn close_window(app: &AppHandle) {
    READY.store(false, std::sync::atomic::Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(LABEL) { let _ = w.destroy(); }
}
fn window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    LISTENING.call_once(|| {
        use tauri::Listener;
        app.listen("trophy-pop-ready", |_| READY.store(true, std::sync::atomic::Ordering::SeqCst));
        // (what the window's page showed: in the log, to tell a pop-up shown but covered by a
        // game in exclusive full screen from one that never reached the page)
        app.listen("trophy-pop-shown", |e| crate::log::line("INFO", "trophies", &format!("pop-up shown over the game: {}", e.payload().chars().take(120).collect::<String>())));
        // (what went wrong in it: its sound, its picture)
        app.listen("trophy-pop-note", |e| crate::log::line("WARN", "trophies", &format!("pop-up over the game: {}", e.payload().chars().take(300).collect::<String>())));
    });
    if let Some(w) = app.get_webview_window(LABEL) {
        wait_ready();
        return Some(w);
    }
    READY.store(false, std::sync::atomic::Ordering::SeqCst);
    let w = tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("popup.html".into()))
        .title("MaXMB").decorations(false).transparent(true).shadow(false).resizable(false)
        .always_on_top(true).skip_taskbar(true).focused(false).visible(false)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .inner_size(551.0, 416.0)
        .additional_browser_args(&crate::webview_args(app))
        .data_directory(crate::paths::webview_dir(app))
        .build().ok()?;
    let _ = w.set_ignore_cursor_events(true);
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() { win::no_activate(h.0 as isize); }
    // (the page needs a moment to load before its first pop-up: until it says it's listening)
    if !wait_ready() { crate::log::line("WARN", "trophies", "the pop-up window over the game didn't load in time"); }
    Some(w)
}
/// Waits (at most 15 s) for the window's page to be listening.
fn wait_ready() -> bool {
    let t = std::time::Instant::now();
    while !READY.load(std::sync::atomic::Ordering::SeqCst) {
        if t.elapsed() > Duration::from_secs(15) { return false; }
        std::thread::sleep(Duration::from_millis(100));
    }
    true
}

fn show_window(app: &AppHandle, v: &Value) {
    let Some(w) = window(app) else { crate::log::line("WARN", "trophies", "the pop-up window over the game couldn't be made: the pop-up is lost"); return };
    let Some((x, y, cw, ch)) = rect(app) else { crate::log::line("WARN", "trophies", "the pop-up window over the game: no screen to put it on"); return };
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = w.set_size(tauri::PhysicalSize::new(cw, ch));
    let mut v = v.clone();
    v["style"] = lock(&STYLE).clone();
    let _ = w.emit_to(LABEL, "pop", &v);
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() { win::show(h.0 as isize, x, y, cw as i32, ch as i32); return; }
    #[cfg(not(windows))]
    { let _ = w.show(); }
}
fn hide_window(app: &AppHandle) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() { win::hide(h.0 as isize); return; }
    #[cfg(not(windows))]
    { let _ = w.hide(); }
}

#[cfg(windows)]
mod win {
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(h: isize, i: i32) -> isize;
        fn SetWindowLongPtrW(h: isize, i: i32, v: isize) -> isize;
        fn ShowWindow(h: isize, c: i32) -> i32;
        fn SetWindowPos(h: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, f: u32) -> i32;
    }
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOPMOST: isize = 0x8;
    const WS_EX_TRANSPARENT: isize = 0x20;
    const WS_EX_TOOLWINDOW: isize = 0x80;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;
    const SW_HIDE: i32 = 0;
    const SW_SHOWNOACTIVATE: i32 = 4;
    const HWND_TOPMOST: isize = -1;
    const SWP_NOACTIVATE: u32 = 0x10;
    const SWP_SHOWWINDOW: u32 = 0x40;
    /// never takes the focus, lets the clicks through, out of Alt+Tab
    pub fn no_activate(h: isize) {
        unsafe {
            let s = GetWindowLongPtrW(h, GWL_EXSTYLE);
            SetWindowLongPtrW(h, GWL_EXSTYLE, s | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST);
        }
    }
    pub fn show(h: isize, x: i32, y: i32, w: i32, hh: i32) {
        unsafe {
            ShowWindow(h, SW_SHOWNOACTIVATE);
            SetWindowPos(h, HWND_TOPMOST, x, y, w, hh, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }
    pub fn hide(h: isize) { unsafe { ShowWindow(h, SW_HIDE); } }
}
