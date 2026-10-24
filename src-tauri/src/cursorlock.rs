//! Before a user logs in, the mouse pointer is parked in the middle of the app
//! window and held there (ClipCursor to a 1-pixel box), so it can't be used.
//! Windows drops the clip whenever focus changes, so a small thread re-applies
//! it while the app is the foreground window; it is released on log-in.

use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::time::Duration;
use tauri::AppHandle;
#[cfg(windows)]
use tauri::Manager;

static LOCKED: AtomicBool = AtomicBool::new(false);
static THREAD: AtomicBool = AtomicBool::new(false);

/// Let the pointer go (used when the app closes).
pub fn release_now() {
    LOCKED.store(false, Ordering::SeqCst);
    #[cfg(windows)]
    win::release();
}

#[tauri::command(async)]
pub fn cursor_lock(app: AppHandle, lock: bool) {
    LOCKED.store(lock, Ordering::SeqCst);
    #[cfg(windows)]
    {
        if !lock {
            win::release();
            return;
        }
        if THREAD.swap(true, Ordering::SeqCst) {
            return;
        }
        std::thread::spawn(move || {
            let mut was = false;
            loop {
                let on = LOCKED.load(Ordering::SeqCst);
                if on {
                    let hwnd = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize).unwrap_or(0);
                    if hwnd != 0 && win::is_foreground(hwnd) {
                        win::park(hwnd);
                        was = true;
                    } else if was {
                        win::release();
                        was = false;
                    }
                } else if was {
                    win::release();
                    was = false;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (app, &THREAD);
}

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod win {
    #[repr(C)]
    #[derive(Default)]
    struct RECT { left: i32, top: i32, right: i32, bottom: i32 }
    #[repr(C)]
    #[derive(Default)]
    struct POINT { x: i32, y: i32 }
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> isize;
        fn GetClientRect(h: isize, r: *mut RECT) -> i32;
        fn ClientToScreen(h: isize, p: *mut POINT) -> i32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn ClipCursor(r: *const RECT) -> i32;
    }
    pub fn is_foreground(h: isize) -> bool { unsafe { GetForegroundWindow() == h } }
    pub fn park(h: isize) {
        unsafe {
            let mut r = RECT::default();
            if GetClientRect(h, &mut r) == 0 { return; }
            let mut p = POINT { x: (r.right - r.left) / 2, y: (r.bottom - r.top) / 2 };
            ClientToScreen(h, &mut p);
            SetCursorPos(p.x, p.y);
            let c = RECT { left: p.x, top: p.y, right: p.x + 1, bottom: p.y + 1 };
            ClipCursor(&c);
        }
    }
    pub fn release() { unsafe { ClipCursor(std::ptr::null()); } }
}
