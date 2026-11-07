//! The "Close System" key (F4 by default, Change Keybinds): closes the app at
//! once, as a safeguard when it has slowed down or got stuck. It's read here,
//! natively, so it works even when the page itself has stopped answering, but
//! only while one of the app's own windows (or its browser) is in front.
//!
//! Only a press that started while the app was in front counts: closing a
//! game or an emulator with Alt+F4 (or the Close System key) brings the app
//! to the front with the key still held, and that press isn't the user's for
//! the app. The same goes for Windows' own Alt+F4 on the app's window (see
//! `held_from_elsewhere`, used when the window is asked to close). Such a press
//! still counts as "from elsewhere" for a moment after it's let go (`GRACE_MS`):
//! the app, busy coming back from the game, can take the close it asked for
//! only after the key is up.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use tauri::AppHandle;

/// Windows virtual-key code of the Close System key (0 = none). F4 = 0x73.
static QUIT_VK: AtomicU32 = AtomicU32::new(0x73);
/// Set when the key changes: it then only counts once it's been seen up (a key
/// held down while it was being set doesn't close the system).
static CHANGED: AtomicBool = AtomicBool::new(false);
/// F4 is held down by a press that started while another program was in front.
static F4_ELSEWHERE: AtomicBool = AtomicBool::new(false);
/// The Close System key is held down by a press that started elsewhere.
static QUIT_ELSEWHERE: AtomicBool = AtomicBool::new(false);
/// Until when (`now_ms`) a press from elsewhere is still taken as such, once let go.
static F4_UNTIL: AtomicU64 = AtomicU64::new(0);
static QUIT_UNTIL: AtomicU64 = AtomicU64::new(0);
/// How long a press from elsewhere is still taken as such once it's let go.
const GRACE_MS: u64 = 1500;
/// How often the keys are looked at.
const POLL_MS: u64 = 10;
/// A press first seen this soon after the app came to the front is taken as
/// made in the program before it: a program that closes the moment Alt+F4 goes
/// down (PPSSPP) hands the front to the app before the press is first seen.
const FRESH_MS: u64 = 500;

/// Milliseconds since the app started.
fn now_ms() -> u64 {
    static T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    T0.get_or_init(std::time::Instant::now).elapsed().as_millis() as u64
}

/// A key held down now that was pressed while another program was in front
/// (F4: Alt+F4 closing a game or emulator; or the Close System key): the
/// window asked to close by it, or the page's Close System, is left alone.
pub fn held_from_elsewhere() -> bool {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" { fn GetAsyncKeyState(vk: i32) -> i16; }
        let down = |vk: i32| vk != 0 && (unsafe { GetAsyncKeyState(vk) } as u16) & 0x8000 != 0;
        let q = QUIT_VK.load(Ordering::SeqCst) as i32;
        let now = now_ms();
        return (down(0x73) && F4_ELSEWHERE.load(Ordering::SeqCst)) || now < F4_UNTIL.load(Ordering::SeqCst)
            || (down(q) && QUIT_ELSEWHERE.load(Ordering::SeqCst)) || now < QUIT_UNTIL.load(Ordering::SeqCst);
    }
    #[cfg(not(windows))]
    false
}

/// Set the key (from Change Keybinds; 0 turns it off, e.g. while the
/// keybinds menu is waiting for a key).
#[tauri::command(async)]
pub fn set_quit_key(vk: u32) {
    if QUIT_VK.swap(vk, Ordering::SeqCst) != vk { CHANGED.store(true, Ordering::SeqCst); }
}

/// One key, looked at every moment: whether it's newly pressed with the app
/// in front (`true`), whether the press it's held by started elsewhere, and
/// until when that press still counts as from elsewhere once let go (`until`).
#[derive(Default)]
struct KeyWatch { was: bool, elsewhere: bool, until: u64 }
impl KeyWatch {
    /// held: as seen now; front: the app (or its browser) in front now; fresh:
    /// it came to the front less than `FRESH_MS` ago; now: `now_ms`.
    fn update(&mut self, held: bool, front: bool, fresh: bool, now: u64) -> bool {
        let new = held && !self.was;
        if new { self.elsewhere = !front || fresh; }
        // (held from elsewhere, or let go while another program is still in
        // front: the moment counts from when the app is back in front)
        if self.elsewhere || (!front && now < self.until) { self.until = now + GRACE_MS; }
        if !held { self.elsewhere = false; }
        self.was = held;
        // (a new press with the app in front ends a moment left from one made elsewhere)
        if new && !self.elsewhere { self.until = 0; }
        new && !self.elsewhere
    }
    /// Taken as from elsewhere now (held, or let go a moment ago). (The app
    /// itself reads the same from F4_ELSEWHERE / F4_UNTIL: used by the tests.)
    #[cfg(test)]
    fn from_elsewhere(&self, now: u64) -> bool { self.elsewhere || now < self.until }
}

/// Close everything now: the pointer is let go and the browser closed (given
/// a moment at most), then the process ends.
pub fn quit_now(app: &AppHandle) {
    crate::log::line("INFO", "system", "Close System key pressed: closing");
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
        let ours = || {
            let fg = unsafe { GetForegroundWindow() };
            if fg == 0 { return false; }
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(fg, &mut pid); }
            pid == me || fg == crate::browser::browser_hwnd()
        };
        let down = |vk: i32| vk != 0 && (unsafe { GetAsyncKeyState(vk) } as u16) & 0x8000 != 0;
        // (a key already held at the start, or while it's being set, isn't a new press)
        let mut f4 = KeyWatch { was: down(0x73), ..Default::default() };
        let mut quit = KeyWatch { was: true, ..Default::default() };
        // (when the app last came to the front)
        let (mut was_front, mut front_at) = (false, 0u64);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(POLL_MS));
            let front = ours();
            let now = now_ms();
            if front && !was_front { front_at = now; }
            was_front = front;
            let fresh = front && now - front_at < FRESH_MS;
            // F4 (Alt+F4): where its press started
            f4.update(down(0x73), front, fresh, now);
            F4_ELSEWHERE.store(f4.elsewhere, Ordering::SeqCst);
            F4_UNTIL.store(f4.until, Ordering::SeqCst);
            // the Close System key: only a new press made with the app in front
            if CHANGED.swap(false, Ordering::SeqCst) { quit = KeyWatch { was: true, ..Default::default() }; }
            let vk = QUIT_VK.load(Ordering::SeqCst) as i32;
            if vk == 0 { quit.was = true; QUIT_ELSEWHERE.store(false, Ordering::SeqCst); QUIT_UNTIL.store(0, Ordering::SeqCst); continue; }
            let fire = quit.update(down(vk), front, fresh, now);
            QUIT_ELSEWHERE.store(quit.elsewhere, Ordering::SeqCst);
            QUIT_UNTIL.store(quit.until, Ordering::SeqCst);
            if fire { quit_now(&app); }
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::{KeyWatch, GRACE_MS};
    #[test]
    fn alt_f4_in_an_emulator_held_as_the_app_comes_back_does_nothing() {
        let mut k = KeyWatch::default();
        // pressed with the emulator in front, held while the app comes back
        assert!(!k.update(true, false, false, 0)); assert!(k.from_elsewhere(0));
        assert!(!k.update(true, true, false, 10)); assert!(k.from_elsewhere(10));
        assert!(!k.update(true, true, false, 20)); assert!(k.from_elsewhere(20));
        // let go: a new press with the app in front counts
        assert!(!k.update(false, true, false, 30)); assert!(!k.elsewhere);
        assert!(k.update(true, true, false, 40)); assert!(!k.from_elsewhere(40));
        // held: once only
        assert!(!k.update(true, true, false, 50));
    }
    #[test]
    fn the_close_taken_just_after_alt_f4_is_let_go_is_still_from_elsewhere() {
        let mut k = KeyWatch::default();
        assert!(!k.update(true, false, false, 0));      // Alt+F4 in the game
        assert!(!k.update(true, true, false, 80));      // the app back in front, still held
        assert!(!k.update(false, true, false, 100));    // let go
        // the close the app asked for, taken a moment later: still from elsewhere
        assert!(k.from_elsewhere(100)); assert!(k.from_elsewhere(100 + GRACE_MS - 1));
        // a while later: not any more
        assert!(!k.from_elsewhere(100 + GRACE_MS));
    }
    #[test]
    fn a_quick_alt_f4_let_go_before_the_app_is_in_front_is_still_from_elsewhere() {
        let mut k = KeyWatch::default();
        assert!(!k.update(true, false, false, 0));      // pressed in the game
        assert!(!k.update(false, false, false, 60));    // let go, the game still in front
        assert!(!k.update(false, false, false, 1400));  // the game takes a while to close
        assert!(!k.update(false, true, false, 2000));   // the app comes back
        assert!(k.from_elsewhere(2000)); assert!(k.from_elsewhere(1400 + GRACE_MS - 1));
        assert!(!k.from_elsewhere(1400 + GRACE_MS));
    }
    #[test]
    fn a_new_press_in_the_app_isnt_held_back_by_one_made_elsewhere() {
        let mut k = KeyWatch::default();
        assert!(!k.update(true, false, false, 0));
        assert!(!k.update(false, true, false, 100));
        assert!(k.update(true, true, false, 200));      // pressed again in the app
        assert!(!k.from_elsewhere(200));
    }
    #[test]
    fn alt_f4_in_a_program_that_closes_at_once_does_nothing() {
        // PPSSPP: gone the moment Alt+F4 goes down, the app in front before the
        // press is first seen; the app came to the front just now (fresh)
        let mut k = KeyWatch::default();
        assert!(!k.update(true, true, true, 0)); assert!(k.from_elsewhere(0));
        assert!(!k.update(true, true, false, 600));
        assert!(!k.update(false, true, false, 650)); assert!(k.from_elsewhere(650 + GRACE_MS - 1));
        // later, a real press in the app counts
        assert!(k.update(true, true, false, 5000)); assert!(!k.from_elsewhere(5000));
    }
    #[test]
    fn a_key_held_while_it_was_set_only_counts_after_its_let_go() {
        let mut k = KeyWatch { was: true, ..Default::default() };
        assert!(!k.update(true, true, false, 0));
        assert!(!k.update(false, true, false, 10));
        assert!(k.update(true, true, false, 20));
    }
}
