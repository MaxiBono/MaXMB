//! The "Close System" key (F4 by default, Change Keybinds): closes the app at
//! once, as a safeguard when it has slowed down or got stuck. It's read here,
//! natively, so it works even when the page itself has stopped answering, but
//! only while one of the app's own windows (or its browser) is in front.

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::AppHandle;

/// Windows virtual-key code of the Close System key (0 = none). F4 = 0x73.
static QUIT_VK: AtomicU32 = AtomicU32::new(0x73);

/// Set the key (from Change Keybinds; 0 turns it off, e.g. while the
/// keybinds menu is waiting for a key).
#[tauri::command(async)]
pub fn set_quit_key(vk: u32) {
    QUIT_VK.store(vk, Ordering::SeqCst);
}

/// Close everything now: the pointer is let go and the browser closed (given
/// a moment at most), then the process ends.
pub fn quit_now(app: &AppHandle) {
    let a = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        crate::cursorlock::release_now();
        crate::browser::on_app_exit(&a);
        crate::maybe_cleanup_temp(&a);
        let _ = tx.send(());
    });
    let _ = rx.recv_timeout(std::time::Duration::from_millis(1500));
    std::process::exit(0);
}

/// Watch the key (Windows).
pub fn start(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        #[link(name = "user32")]
        extern "system" {
            fn GetAsyncKeyState(vk: i32) -> i16;
            fn GetForegroundWindow() -> isize;
            fn GetWindowThreadProcessId(h: isize, pid: *mut u32) -> u32;
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetCurrentProcessId() -> u32;
        }
        let me = unsafe { GetCurrentProcessId() };
        loop {
            std::thread::sleep(std::time::Duration::from_millis(40));
            let vk = QUIT_VK.load(Ordering::SeqCst) as i32;
            if vk == 0 || (unsafe { GetAsyncKeyState(vk) } as u16) & 0x8000 == 0 { continue; }
            let fg = unsafe { GetForegroundWindow() };
            if fg == 0 { continue; }
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(fg, &mut pid); }
            if pid == me || fg == crate::browser::browser_hwnd() {
                quit_now(&app);
            }
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}
