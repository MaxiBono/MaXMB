//! Getting the app back in front, and knowing when a game has ended.
//!
//! * `bring_to_front`: after a Windows folder / file window closes, or when a
//!   game ends, the app's window becomes the foreground window again, so the
//!   controller keeps working without touching the mouse or keyboard.
//!   (Windows only lets the foreground app hand the foreground over; the usual
//!   way round it is used: a tap of Alt, and attaching to the foreground
//!   window's input for the call.)
//! * Game mode: while a game runs, `in_game()` is true (the controller reader
//!   sends nothing and the app idles). `watch_game` follows the game: the
//!   process that was started, any program running from the game's folder,
//!   and the window that comes to the front after the launch. When all of
//!   them are gone, the app is told ("game-exited") and brought back.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Manager};
#[cfg(windows)]
use tauri::Emitter;

static IN_GAME: AtomicBool = AtomicBool::new(false);
static WATCH_ID: AtomicU64 = AtomicU64::new(0);
/// The page inside the app's window has the keyboard / controller focus
/// (told by the page itself on focus / blur).
static PAGE_FOCUSED: AtomicBool = AtomicBool::new(true);
/// When the last game was started (ms since the app started), see `start_pad_watch`.
static GAME_AT: AtomicU64 = AtomicU64::new(0);
fn now_ms() -> u64 {
    static T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    T0.get_or_init(std::time::Instant::now).elapsed().as_millis() as u64
}

#[tauri::command]
pub fn page_focus(focused: bool) { PAGE_FOCUSED.store(focused, Ordering::Relaxed); }

#[cfg_attr(not(windows), allow(dead_code))]
pub fn in_game() -> bool { IN_GAME.load(Ordering::Relaxed) }
pub fn set_in_game(on: bool) {
    let was = IN_GAME.swap(on, Ordering::Relaxed);
    if !on { WATCH_ID.fetch_add(1, Ordering::Relaxed); }   // any watcher stops
    // (while a game runs the app and its page step aside: they run at a lower
    // priority, so the game gets the processor first)
    #[cfg(windows)]
    if was != on { std::thread::spawn(move || win::set_priority(on)); }
    #[cfg(not(windows))]
    let _ = was;
}

/// Make the app the foreground window again (and focus its page), so the
/// controller works on it at once. Windows hands the foreground back to the
/// app a moment after a folder / file window closes (or may give it to the
/// program behind), so it's done now and again a few times shortly after,
/// until the app really is in front.
pub fn bring_to_front(app: &AppHandle) {
    // Taking the foreground is done from a thread of its own, never from the
    // window's thread: that one must never wait on another program (a game
    // closing, or its store's client, may not answer for a while, and the
    // window would freeze: black or see-through, deaf to keys and controller).
    // The window's thread only un-minimizes the window and focuses the page.
    let app = app.clone();
    std::thread::spawn(move || {
        for wait in [0u64, 120, 250, 450, 800] {
            std::thread::sleep(std::time::Duration::from_millis(wait));
            #[cfg(windows)]
            if let Some(h) = main_hwnd(&app) { win::force_foreground(h); }
            let a = app.clone();
            let _ = app.run_on_main_thread(move || front_now(&a));
        }
    });
}
#[cfg(windows)]
fn main_hwnd(app: &AppHandle) -> Option<isize> {
    // (asked each time: the window may have been made anew)
    let h = app.get_webview_window("main")?.hwnd().ok()?.0 as isize;
    (h != 0).then_some(h)
}
fn front_now(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_minimized().unwrap_or(false) { let _ = w.unminimize(); }
        let _ = w.set_focus();
        // the page inside the window gets the keyboard / controller focus too
        if let Some(v) = app.get_webview("main") { let _ = v.set_focus(); }
    }
}

/// Started with Windows (bootstart.rs): for the first minute, while the
/// other programs that start with Windows open their windows (and take the
/// focus, so the controller and keyboard no longer reach the app), the app
/// takes the front back each time, unless the user chose the other window
/// (a key, click or touch just before it came to the front: then it's left
/// there and the watch ends). Not during a game.
pub fn boot_guard(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        let start = std::time::Instant::now();
        let own = std::process::id();
        let mut taken: Vec<String> = Vec::new();
        while start.elapsed() < std::time::Duration::from_secs(60) {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if in_game() { return; }
            let Some(front) = win::foreground_pid() else { continue };
            if front == own { continue; }
            let name = win::name_of(&win::processes(true), front);
            // (Windows' own parts the user may need, like the touch keyboard, are
            // left alone; the desktop and taskbar (Explorer) taking the front aren't)
            if win::is_shell_process(front) && !name.eq_ignore_ascii_case("explorer.exe") { continue; }
            // (the user's own choice: input in the last moment)
            if win::input_idle_ms() < 1500 { crate::log::line("INFO", "system", "startup: another window chosen by the user, left in front"); return; }
            let Some(h) = main_hwnd(&app) else { continue };
            if !taken.contains(&name) { crate::log::line("INFO", "system", &format!("startup: {name} took the front; the app takes it back")); taken.push(name); }
            win::force_foreground(h);
            let a = app.clone();
            let _ = app.run_on_main_thread(move || front_now(&a));
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}

/// Back from a game: game mode ends, the window is made to show again (see
/// `repair_window`), brought to the front, and the page is told ("game-exited").
#[cfg_attr(not(windows), allow(dead_code))]
fn return_from_game(app: &AppHandle, why: &str) {
    crate::log::line("INFO", "game", why);
    PAGE_ANSWERED.store(false, Ordering::SeqCst);
    set_in_game(false);
    repair_window(app);
    bring_to_front(app);
    #[cfg(windows)]
    { let _ = app.emit("game-exited", ()); }
    // the page answers (page_alive, or by ending its game mode). One that doesn't
    // answer within a few seconds stopped running during the game (it would stay
    // invisible or black, and deaf to the keyboard and controller): it's loaded again.
    // When the page's processes are already known to be gone, it's made anew
    // at once (nothing to wait for).
    let app = app.clone();
    std::thread::spawn(move || {
        if webview_gone() {
            crate::log::line("WARN", "game", "the page's processes ended during the game: the window is made anew");
            crash_reports(&app);
            remake_window(&app);
            return;
        }
        std::thread::sleep(std::time::Duration::from_secs(8));
        if PAGE_ANSWERED.load(Ordering::SeqCst) || in_game() { return; }
        // (is the window's own thread answering? If not, the window is frozen,
        // not only the page)
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = app.run_on_main_thread(move || { let _ = tx.send(()); });
        let thread_ok = rx.recv_timeout(std::time::Duration::from_secs(2)).is_ok();
        crate::log::line("WARN", "game", &format!("the page didn't answer after the game ({}; {}): the window is made anew",
            if thread_ok { "the window answers" } else { "the window doesn't answer either" }, webview_state()));
        crash_reports(&app);
        remake_window(&app);
    });
}

/// WebView2's crash reports (in the app's webview folder) written since the
/// game started, for the log: a report means its processes crashed; none, that
/// something ended them.
fn crash_reports(app: &AppHandle) {
    let since = std::time::UNIX_EPOCH + std::time::Duration::from_millis(GAME_WALL.load(Ordering::Relaxed));
    let dir = crate::paths::webview_dir(app).join("EBWebView").join("Crashpad").join("reports");
    let found: Vec<String> = std::fs::read_dir(&dir).map(|rd| rd.flatten().filter(|e| {
        e.metadata().and_then(|m| m.modified()).map(|t| t >= since).unwrap_or(false)
    }).map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
    crate::log::line("INFO", "game", &if found.is_empty() { "no crash report from the page's processes".to_string() }
        else { format!("crash reports from the page's processes: {}", found.join(", ")) });
}

/// None of the page's processes (WebView2's) is running.
fn webview_gone() -> bool {
    #[cfg(windows)]
    { win::webview_pids().is_empty() }
    #[cfg(not(windows))]
    { false }
}

/// The page's own processes (WebView2's), for the log.
fn webview_state() -> String {
    #[cfg(windows)]
    { format!("{} page processes", win::webview_pids().len()) }
    #[cfg(not(windows))]
    { String::from("page processes unknown") }
}

/// The game started last (its folder in content\Games), for the window made anew after it.
static LAST_GAME: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
pub fn set_last_game(folder: &str) { *LAST_GAME.lock().unwrap_or_else(|e| e.into_inner()) = Some(folder.to_string()); }
/// The window made anew after a game: who was signed in and the game played, for its page to
/// come back as from any game (main.js boot): no startup sound or intro, no user selection,
/// on the Game column with that game chosen. Told once.
static RESUME: std::sync::Mutex<Option<serde_json::Value>> = std::sync::Mutex::new(None);
#[tauri::command]
pub fn resume_after_game() -> Option<serde_json::Value> { RESUME.lock().unwrap_or_else(|e| e.into_inner()).take() }

/// When the game started (clock time, ms), for `crash_reports`.
static GAME_WALL: AtomicU64 = AtomicU64::new(0);
static REMAKING: AtomicBool = AtomicBool::new(false);
/// The window is being closed only to be made anew (the app must not quit).
pub fn remaking() -> bool { REMAKING.load(Ordering::SeqCst) }

/// A page that stopped for good during a game (reloading it didn't bring it
/// back: what runs it, WebView2, had stopped) is made anew with its window:
/// the old window is closed, what's left of its page's processes ended, and
/// a new window opened as at the start. Done from this thread (not the
/// window's), as Tauri asks for making windows.
fn remake_window(app: &AppHandle) {
    REMAKING.store(true, Ordering::SeqCst);
    // (the trophy pop-up's window too: its page ran in the WebView2 that stopped. Left open, a
    // window whose WebView2 was gone stayed in the app beside the new one -- the likeliest cause
    // of the app closing by itself a few minutes later, Windows finding its memory damaged)
    crate::trophypop::close_window(app);
    if let Some(w) = app.get_webview_window("main") { let _ = w.destroy(); }
    {
        let user = crate::users::load(&crate::paths::users_file(app)).active;
        let game = LAST_GAME.lock().unwrap_or_else(|e| e.into_inner()).clone();
        *RESUME.lock().unwrap_or_else(|e| e.into_inner()) = user.map(|u| serde_json::json!({ "user": u, "game": game }));
    }
    std::thread::sleep(std::time::Duration::from_millis(700));
    #[cfg(windows)]
    win::end_webview_processes();
    std::thread::sleep(std::time::Duration::from_millis(300));
    match crate::build_main_window(app) {
        Ok(()) => {
            crate::log::line("INFO", "game", "the window was made anew");
            let fs = crate::current_settings(app).behavior.fullscreen;
            crate::apply_fullscreen(app, fs);
        }
        Err(e) => crate::log::line("ERROR", "game", &format!("the window couldn't be made anew: {e}")),
    }
    REMAKING.store(false, Ordering::SeqCst);
    bring_to_front(app);
}

/// The window got the focus while a game runs (the user came back to it, with
/// Alt+Tab or a click): its page, hidden during the game, is shown at once, so
/// it notices it has the focus and ends game mode by itself (xmb.js).
pub fn window_focused(app: &AppHandle) {
    // (only a page this watch hid: the window getting the focus before the game
    // took the front is the game still starting, not the user coming back)
    if !in_game() || !PAGE_HIDDEN.swap(false, Ordering::SeqCst) { return; }
    if let Some(v) = app.get_webview("main") { let _ = v.show(); let _ = v.set_focus(); }
}
/// The page was hidden for the running game (see `watch_game`).
static PAGE_HIDDEN: AtomicBool = AtomicBool::new(false);

static PAGE_ANSWERED: AtomicBool = AtomicBool::new(true);
/// The page answers "game-exited" (main.js): it's running.
#[tauri::command]
pub fn page_alive() { page_answered(); }

/// The page ended its game mode, or answered (see `return_from_game`).
pub fn page_answered() {
    if !PAGE_ANSWERED.swap(true, Ordering::SeqCst) {
        crate::log::line("INFO", "game", "the page is back from the game");
    }
}

static REPAIRED: AtomicBool = AtomicBool::new(true);
/// After a game the window could come back showing nothing (black, or
/// see-through): a game that changes the screen's mode can leave the page's
/// picture behind. Once per game, the window is shown and un-minimized, and
/// the page inside it is hidden and shown again and set to the window's size,
/// so it draws itself anew; the window itself keeps its full screen and size
/// (taking it out of full screen and back left it as a black, framed window).
/// Done at once and again a second later (the game may still be giving the
/// screen back), and what state the window was in goes to the log.
pub fn repair_window(app: &AppHandle) {
    if REPAIRED.swap(true, Ordering::SeqCst) { return; }
    repair_now(app, true);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        repair_now(&app, false);
    });
}
fn repair_now(app: &AppHandle, log: bool) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(w) = a.get_webview_window("main") else { return };
        if log {
            crate::log::line("INFO", "game", &format!("window after the game: visible {:?}, minimized {:?}, full screen {:?}, size {:?}",
                w.is_visible().ok(), w.is_minimized().ok(), w.is_fullscreen().ok(), w.inner_size().ok()));
        }
        if w.is_minimized().unwrap_or(false) { let _ = w.unminimize(); }
        if !w.is_visible().unwrap_or(true) { let _ = w.show(); }
        if let Some(v) = a.get_webview("main") {
            PAGE_HIDDEN.store(false, Ordering::SeqCst);
            let _ = v.hide();
            let _ = v.show();
            if let Ok(sz) = w.inner_size() {
                let _ = v.set_bounds(tauri::Rect {
                    position: tauri::PhysicalPosition::new(0, 0).into(),
                    size: sz.into(),
                });
            }
            let _ = v.set_focus();
        }
    });
}

/// Follow a started game (see the module notes). `pid`: the process started,
/// when known; `dir`: the folder the game runs from, when known.
/// `hide_page`: a game (the page is hidden while it runs); false for a
/// program from a custom section (the app keeps showing its screen).
pub fn watch_game(app: AppHandle, pid: Option<u32>, dir: Option<PathBuf>, hide_page: bool) {
    set_in_game(true);
    REPAIRED.store(false, Ordering::SeqCst);
    PAGE_HIDDEN.store(false, Ordering::SeqCst);

    GAME_AT.store(now_ms().max(1), Ordering::Relaxed);
    GAME_WALL.store(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0), Ordering::Relaxed);
    let id = WATCH_ID.fetch_add(1, Ordering::Relaxed) + 1;
    // (the game may take the foreground from the app when its window opens; a
    // game started through its store's client otherwise opens behind the app's
    // focus, and needed a click before it got the keyboard)
    #[cfg(windows)]
    win::allow_any_foreground();
    std::thread::spawn(move || {
        #[cfg(windows)]
        {
            let dir = dir.filter(|d| win::usable_dir(d));
            let started = std::time::Instant::now();
            // (what was already running when the game started is never taken for it:
            // a chat program or a browser brought to the front meanwhile, a launcher
            // or an anti-cheat service that stays running afterwards)
            let own = std::process::id();
            let mut gw = GameWatch::new(Follow::new(pid, dir.as_deref(), &win::processes(true), own), own);
            crate::log::line("INFO", "game", &format!("following the game: pid {:?}, folder {:?} ({})", pid, dir, webview_state()));
            // (the page's processes, watched while the game runs: when they end, it's logged)
            let mut web_was = win::webview_pids().len();
            // (and held open, so how they ended (their exit codes) can be told)
            let mut web_held = win::hold(&win::webview_pids());
            // (what was running at the start and at the last look: when the page's
            // processes end, what had started meanwhile, and what had just ended
            // with them, goes in the log: whatever ended them may be among those)
            let at_start: std::collections::HashSet<u32> = win::processes(false).iter().map(|p| p.pid).collect();
            let mut last: Vec<Proc> = Vec::new();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                if WATCH_ID.load(Ordering::Relaxed) != id || !in_game() { win::release(&mut web_held); return; }   // back in the app some other way
                let front = win::foreground_pid();
                let now = win::processes(true);
                let look = gw.look(&now, front, started.elapsed(), win::is_shell_process, win::main_window_of);
                // (the page's processes: logged when they end)
                let web_now = win::webview_pids_in(&now).len();
                if web_now != web_was && (web_now == 0 || web_was == 0 || web_now + 2 < web_was) {
                    crate::log::line("WARN", "game", &format!("the page's processes went from {} to {} ({} in front)",
                        web_was, web_now, front.map(|f| win::name_of(&now, f)).unwrap_or_else(|| "nothing".into())));
                }
                if web_now == 0 && !web_held.is_empty() {
                    crate::log::line("WARN", "game", &format!("how the page's processes ended (exit codes): {}", win::exit_codes(&web_held)));
                    let web: Vec<u32> = web_held.iter().map(|w| w.0).collect();
                    let game = gw.follow.pids(&now, own);
                    let name = |p: &Proc| win::name_of(std::slice::from_ref(p), p.pid);
                    let mut started: Vec<String> = now.iter().filter(|p| !at_start.contains(&p.pid) && !game.contains(&p.pid)).map(name).collect();
                    let mut ended: Vec<String> = last.iter().filter(|p| !web.contains(&p.pid) && !now.iter().any(|q| q.pid == p.pid)).map(name).collect();
                    started.sort(); started.dedup(); ended.sort(); ended.dedup();
                    crate::log::line("INFO", "game", &format!("started since the game was: {}", if started.is_empty() { "nothing".into() } else { started.join(", ") }));
                    crate::log::line("INFO", "game", &format!("ended along with the page's processes: {}", if ended.is_empty() { "nothing".into() } else { ended.join(", ") }));
                    win::release(&mut web_held);
                }
                web_was = web_now;
                last = now.clone();
                if let Some(h) = look.hand_to {
                    crate::log::line("INFO", "game", &format!("the game's window opened without the focus (it was with {}): it's given the focus",
                        front.map(|f| win::name_of(&now, f)).unwrap_or_else(|| "nothing".into())));
                    win::force_foreground(h);
                }
                if look.hide_page && hide_page {
                    // The game is running: the page is hidden until it ends (the
                    // window shows black behind it), so it draws nothing and leaves
                    // the graphics card to the game. `repair_window` (or the window
                    // getting the focus, `window_focused`) shows it again. (Not
                    // before: while the game doesn't show up, a key press on the
                    // page still brings it back.)
                    PAGE_HIDDEN.store(true, Ordering::SeqCst);
                    let a = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Some(v) = a.get_webview("main") { let _ = v.hide(); }
                    });
                }
                let why = match look.step {
                    Step::Wait => continue,
                    Step::Back(k) if k.is_empty() => "back in the app (the game has ended)".to_string(),
                    Step::Back(k) => format!("back in the app while still running: {}", k.join(", ")),
                    Step::NeverShowed => "the game never showed up (3 minutes)".to_string(),
                    Step::Ended => "the game has ended".to_string(),
                };
                win::release(&mut web_held);
                return_from_game(&app, &why);
                return;
            }
        }
        #[cfg(not(windows))]
        { let _ = (app, pid, dir, id, hide_page); }
    });
}

/// What one look at the running programs decides (see `GameWatch`).
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, PartialEq)]
pub enum Step {
    /// Still running (or still starting): look again.
    Wait,
    /// The user is back in the app (with what of the game is still running).
    Back(Vec<String>),
    /// Nothing of the game is left.
    Ended,
    /// Nothing of the game ever showed up (3 minutes).
    NeverShowed,
}
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Look {
    pub step: Step,
    /// The game's window to give the focus to.
    pub hand_to: Option<isize>,
    /// The page is to be hidden now: the game's own window has taken the front
    /// (not before: hiding the page of the window in front would give the
    /// window the focus, taken for the user coming back; and not for a
    /// launcher's window, after which Windows hands the front back to the app).
    pub hide_page: bool,
}

/// The decisions of a game's watch, one look every 1.5 seconds (kept apart
/// from Windows so they can be tested): the user back in the app, the game's
/// window given the focus, the game seen, and the game ended (two looks in a
/// row without it) or never shown.
#[cfg_attr(not(windows), allow(dead_code))]
pub struct GameWatch { pub follow: Follow, back: BackWatch, seen: bool, gone: u8, handed: isize, own: u32, hidden: bool }
#[cfg_attr(not(windows), allow(dead_code))]
impl GameWatch {
    pub fn new(follow: Follow, own: u32) -> Self {
        GameWatch { follow, back: BackWatch::default(), seen: false, gone: 0, handed: 0, own, hidden: false }
    }
    /// `now`: the running programs; `front`: whose window is in front;
    /// `elapsed`: since the start; `is_shell`: Windows' own programs (never the
    /// game); `window_of`: the game's main window among these processes (0: none).
    pub fn look(&mut self, now: &[Proc], front: Option<u32>, elapsed: std::time::Duration,
                is_shell: impl Fn(u32) -> bool, window_of: impl Fn(&[u32]) -> isize) -> Look {
        let own = self.own;
        let mut look = Look { step: Step::Wait, hand_to: None, hide_page: false };
        let game_in_front = front.map(|f| f != own && self.follow.pids(now, own).contains(&f)).unwrap_or(false);
        if self.back.look(front, own, game_in_front, self.seen, elapsed > std::time::Duration::from_secs(6)) {
            look.step = Step::Back(self.follow.keeping(now));
            return look;
        }
        // the window in front, when it's a new program's (the game's, or its launcher's)
        let fg = front.filter(|&f| f != own && !is_shell(f));
        let alive = self.follow.step(now, fg);
        if alive {
            // the game's window is open but something else has the keyboard (it
            // opened behind the app's focus): it's given the focus, once per window
            let pids = self.follow.pids(now, own);
            let h = window_of(&pids);
            if hand_off(front, &pids, h, self.handed) { self.handed = h; look.hand_to = Some(h); }
            let game_front = front.map(|f| f != own && pids.contains(&f)).unwrap_or(false);
            if !self.hidden && game_front && look.hand_to.is_none() {
                self.hidden = true;
                look.hide_page = true;
            }
            self.seen = true;
            self.gone = 0;
            return look;
        }
        if !self.seen {
            // nothing to follow (the game never showed up): after a while the
            // app comes back by itself (it was waiting on a black screen)
            if elapsed > std::time::Duration::from_secs(180) { look.step = Step::NeverShowed; }
            return look;
        }
        self.gone += 1;
        if self.gone >= 2 { look.step = Step::Ended; }
        look
    }
}

/// Whether the user is back in the app while the game runs: the app's window
/// in front for two looks in a row, after the game itself was in front, once
/// the game has been seen and the first seconds have passed (`settled`). Not
/// while the game is still loading behind the app's black screen, even when
/// its launcher's window (Steam's "launching" box) was in front meanwhile:
/// Windows hands the front back to the app when that closes, which isn't the
/// user coming back (on a slower PC the game's window shows only later).
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Default)]
pub struct BackWatch { left: bool, back: u8 }
#[cfg_attr(not(windows), allow(dead_code))]
impl BackWatch {
    /// One look. `front`: the process whose window is in front (None: none).
    /// `game_in_front`: that process is the game's.
    pub fn look(&mut self, front: Option<u32>, own: u32, game_in_front: bool, seen: bool, settled: bool) -> bool {
        if front != Some(own) {
            if game_in_front { self.left = true; }
            self.back = 0;
            false
        } else if self.left && seen && settled {
            self.back = self.back.saturating_add(1);
            self.back >= 2
        } else { false }
    }
}

/// Whether the game's window (`window`, 0: none found) should be given the
/// focus: it's open, it wasn't given it already (`handed`, once per window),
/// and the program in front isn't the game's.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn hand_off(front: Option<u32>, game: &[u32], window: isize, handed: isize) -> bool {
    window != 0 && window != handed && !front.map(|f| game.contains(&f)).unwrap_or(false)
}

#[cfg(test)]
mod watch_tests {
    use super::*;
    const OWN: u32 = 99;
    #[test]
    fn back_in_the_app_while_the_game_still_runs() {
        let mut b = BackWatch::default();
        assert!(!b.look(Some(OWN), OWN, false, true, true));        // the app in front before the game took it: nothing
        assert!(!b.look(Some(20), OWN, true, true, true));         // the game in front
        assert!(!b.look(Some(OWN), OWN, false, true, true));        // Alt+Tab back to the app: first look
        assert!(b.look(Some(OWN), OWN, false, true, true));         // second look: back
    }
    #[test]
    fn not_back_while_the_game_is_loading_or_just_started() {
        let mut b = BackWatch::default();
        assert!(!b.look(Some(20), OWN, true, false, true));        // a launcher in front, the game not seen yet
        assert!(!b.look(Some(OWN), OWN, false, false, true));
        assert!(!b.look(Some(OWN), OWN, false, false, true));       // still loading: stays in game mode
        let mut b = BackWatch::default();
        assert!(!b.look(Some(20), OWN, true, true, false));
        assert!(!b.look(Some(OWN), OWN, false, true, false));
        assert!(!b.look(Some(OWN), OWN, false, true, false));       // the first seconds: stays
    }
    #[test]
    fn a_launchers_window_closing_isnt_the_user_coming_back() {
        // Steam's "launching" box in front (11), the game's program running but its
        // window not shown yet (slow PC); the box closes and Windows hands the front
        // back to the app: game mode stays
        let mut b = BackWatch::default();
        assert!(!b.look(Some(11), OWN, false, true, true));
        for _ in 0..5 { assert!(!b.look(Some(OWN), OWN, false, true, true)); }
        // the game's window at last, then the user back in the app: back
        assert!(!b.look(Some(20), OWN, true, true, true));
        assert!(!b.look(Some(OWN), OWN, false, true, true));
        assert!(b.look(Some(OWN), OWN, false, true, true));
    }

    #[test]
    fn a_short_visit_to_the_app_doesnt_end_the_game() {
        let mut b = BackWatch::default();
        assert!(!b.look(Some(20), OWN, true, true, true));
        assert!(!b.look(Some(OWN), OWN, false, true, true));        // one look only (the game's window closing and opening)
        assert!(!b.look(Some(20), OWN, true, true, true));         // the game in front again
        assert!(!b.look(Some(OWN), OWN, false, true, true));
        assert!(!b.look(None, OWN, false, true, true));             // no window in front: starts over
        assert!(!b.look(Some(OWN), OWN, false, true, true));
        assert!(b.look(Some(OWN), OWN, false, true, true));
    }
    #[test]
    fn the_games_window_gets_the_focus_once() {
        let game = [20, 21];
        assert!(hand_off(Some(40), &game, 7, 0));             // opened while the touchpad helper had the focus
        assert!(hand_off(Some(OWN), &game, 7, 0));            // or the app
        assert!(hand_off(None, &game, 7, 0));                 // or nothing
        assert!(!hand_off(Some(21), &game, 7, 0));            // the game already has it
        assert!(!hand_off(Some(40), &game, 7, 7));            // given already: the user's choice is left alone
        assert!(hand_off(Some(40), &game, 8, 7));             // a new window of the game (a launcher, then the game)
        assert!(!hand_off(Some(40), &game, 0, 0));            // no window yet
    }
}

/// A running process, as the game's follower sees it: its id, its parent's,
/// and (when the game's folder is known) the program's full path.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone)]
pub struct Proc { pub pid: u32, pub parent: u32, pub path: Option<String> }

/// The started game's processes, followed until none is left: the process
/// started (when known), every process started from it (a launcher's game,
/// a game's helper), anything running from the game's folder, and a new
/// program whose window comes to the front (a store link's game). Programs
/// already running when the game started never count (a chat program or a
/// browser brought to the front meanwhile, a store client, an anti-cheat
/// service), so the app isn't left waiting for them after the game ends.
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Follow { roots: Vec<u32>, before: std::collections::HashSet<u32>, dir: Option<String>, before_paths: std::collections::HashSet<String> }
#[cfg_attr(not(windows), allow(dead_code))]
impl Follow {
    pub fn new(pid: Option<u32>, dir: Option<&std::path::Path>, now: &[Proc], own: u32) -> Self {
        let mut before: std::collections::HashSet<u32> = now.iter().map(|p| p.pid).collect();
        // (the programs already running, by their file: one that starts again under a
        // new process while the game runs (a touchpad or graphics helper restarting
        // when the screen mode changes) isn't the game either)
        let before_paths = now.iter().filter_map(|p| p.path.as_ref().map(|x| x.to_lowercase())).collect();
        before.insert(own);
        if let Some(p) = pid { before.remove(&p); }
        let dir = dir.map(|d| { let mut s = d.display().to_string().to_lowercase(); if !s.ends_with('\\') && !s.ends_with('/') { s.push(if s.contains('\\') { '\\' } else { std::path::MAIN_SEPARATOR }); } s });
        Follow { roots: pid.into_iter().collect(), before, dir, before_paths }
    }
    /// Whether the game is still running, with the processes running now and the new program in front (if any).
    pub fn step(&mut self, now: &[Proc], front: Option<u32>) -> bool {
        let known = |pid: u32| now.iter().find(|p| p.pid == pid).and_then(|p| p.path.as_ref()).map(|x| {
            let x = x.to_lowercase();
            self.before_paths.contains(&x) || x.starts_with("c:\\windows\\")
        }).unwrap_or(false);
        if let Some(f) = front { if !self.before.contains(&f) && !self.roots.contains(&f) && !known(f) { self.roots.push(f); } }
        // (started from the game's processes: theirs too)
        loop {
            let add: Vec<u32> = now.iter().filter(|p| !self.before.contains(&p.pid) && !self.roots.contains(&p.pid) && self.roots.contains(&p.parent)).map(|p| p.pid).collect();
            if add.is_empty() { break; }
            self.roots.extend(add);
        }
        let running = |pid: u32| now.iter().any(|p| p.pid == pid);
        let from_dir = self.dir.as_ref().map(|d| now.iter().any(|p| p.path.as_ref().map(|x| x.to_lowercase().starts_with(d.as_str())).unwrap_or(false))).unwrap_or(false);
        self.roots.iter().any(|&p| running(p)) || from_dir
    }
    /// The processes of the game (as `keeping`), but the app's own.
    pub fn pids(&self, now: &[Proc], own: u32) -> Vec<u32> {
        now.iter().filter(|p| p.pid != own && (self.roots.contains(&p.pid)
            || self.dir.as_ref().map(|d| p.path.as_ref().map(|x| x.to_lowercase().starts_with(d.as_str())).unwrap_or(false)).unwrap_or(false)))
            .map(|p| p.pid).collect()
    }
    /// What keeps the game counted as running (for the log): its processes still there.
    pub fn keeping(&self, now: &[Proc]) -> Vec<String> {
        let name = |p: &Proc| p.path.as_deref().map(|x| x.rsplit(['\\', '/']).next().unwrap_or(x).to_string()).unwrap_or_else(|| format!("pid {}", p.pid));
        now.iter().filter(|p| self.roots.contains(&p.pid)
            || self.dir.as_ref().map(|d| p.path.as_ref().map(|x| x.to_lowercase().starts_with(d.as_str())).unwrap_or(false)).unwrap_or(false))
            .map(|p| name(p)).collect()
    }
}

#[cfg(test)]
mod follow_tests {
    use super::*;
    fn p(pid: u32, parent: u32, path: &str) -> Proc { Proc { pid, parent, path: Some(path.into()) } }
    #[test]
    fn follows_the_game_not_programs_already_running() {
        let before = vec![p(10, 1, r"C:\Program Files\Discord\discord.exe"), p(11, 1, r"C:\Steam\steam.exe"), p(12, 1, r"C:\EAC\eac.exe")];
        // a Steam game: no process of its own known, its folder known
        let mut f = Follow::new(None, Some(std::path::Path::new(r"C:\Steam\steamapps\common\Game")), &before, 99);
        let mut now = before.clone();
        assert!(!f.step(&now, Some(10)));                                    // Discord in front: not the game
        now.push(p(20, 11, r"C:\Steam\steamapps\common\Game\game.exe"));
        assert!(f.step(&now, Some(20)));
        now.push(p(21, 20, r"C:\Steam\steamapps\common\Game\crashhandler.exe"));
        assert!(f.step(&now, Some(12)));                                     // the anti-cheat in front: not followed
        now.retain(|x| x.pid != 20 && x.pid != 21);
        assert!(!f.step(&now, None));                                        // ended (Steam, EAC, Discord still running)
        // (a folder with a similar name doesn't count)
        let mut g = Follow::new(None, Some(std::path::Path::new(r"C:\Games\Foo")), &[], 99);
        assert!(!g.step(&[p(5, 1, r"C:\Games\Foobar\x.exe")], None));
    }
    #[test]
    fn a_helper_restarting_while_the_game_runs_is_not_the_game() {
        // the touchpad helper was running; it starts again (new process) when the
        // game changes the screen mode, and comes to the front for a moment
        let before = vec![p(10, 1, r"C:\Program Files\Synaptics\SynTP\SynTPEnh.exe")];
        let mut f = Follow::new(None, Some(std::path::Path::new(r"D:\SteamLibrary\steamapps\common\Ambidextro")), &before, 99);
        let mut now = vec![p(40, 1, r"C:\Program Files\Synaptics\SynTP\SynTPEnh.exe"),
                           p(20, 11, r"D:\SteamLibrary\steamapps\common\Ambidextro\Ambidextro.exe")];
        assert!(f.step(&now, Some(20)));                                    // the game runs, in front
        assert!(f.step(&now, Some(40)));                                    // the helper in front for a moment
        now.retain(|x| x.pid != 20);
        assert!(!f.step(&now, Some(40)));                                   // closed: the helper doesn't keep it
        // a program in Windows' own folder isn't the game either
        let mut g = Follow::new(None, Some(std::path::Path::new(r"D:\Games\X")), &[], 99);
        assert!(!g.step(&[p(50, 1, r"C:\Windows\System32\dwm.exe")], Some(50)));
    }
    #[test]
    fn follows_a_launchers_children() {
        let before = vec![p(10, 1, r"C:\x\discord.exe")];
        let mut f = Follow::new(Some(30), None, &before, 99);
        let mut now = before.clone();
        now.push(p(30, 99, r"C:\RPCS3\rpcs3.exe"));
        assert!(f.step(&now, None));
        now.push(p(31, 30, r"C:\RPCS3\helper.exe"));
        now.retain(|x| x.pid != 30);
        assert!(f.step(&now, None));                                         // its child still runs
        now.retain(|x| x.pid != 31);
        assert!(!f.step(&now, Some(10)));
    }
}

#[cfg(test)]
mod game_watch_tests {
    use super::*;
    use std::time::Duration;
    const OWN: u32 = 99;
    fn p(pid: u32, parent: u32, path: &str) -> Proc { Proc { pid, parent, path: Some(path.into()) } }
    fn shell(pid: u32) -> bool { pid == 5 }   // (Windows' own: explorer)
    /// The game's window: the first of its processes that has one (`windows`).
    fn win_of(windows: &[(u32, isize)]) -> impl Fn(&[u32]) -> isize + '_ {
        move |pids: &[u32]| windows.iter().find(|w| pids.contains(&w.0)).map(|w| w.1).unwrap_or(0)
    }
    fn s(secs: u64) -> Duration { Duration::from_secs(secs) }
    fn before() -> Vec<Proc> {
        vec![p(5, 1, r"C:\Windows\explorer.exe"), p(10, 1, r"C:\Steam\steam.exe"),
             p(11, 10, r"C:\Steam\bin\cef\steamwebhelper.exe"), p(12, 1, r"C:\Program Files\Synaptics\SynTP\SynTPEnh.exe"),
             p(13, 1, r"C:\Discord\Discord.exe"), p(OWN, 5, r"C:\MaXMB\MaXMB.exe")]
    }
    fn steam_game() -> GameWatch {
        GameWatch::new(Follow::new(None, Some(std::path::Path::new(r"D:\SteamLibrary\steamapps\common\Ambidextro")), &before(), OWN), OWN)
    }

    #[test]
    fn a_steam_game_from_start_to_end() {
        let mut g = steam_game();
        let mut now = before();
        let none: Vec<(u32, isize)> = vec![];
        // Steam starting it: nothing of the game yet, Steam's window in front
        let l = g.look(&now, Some(11), s(2), shell, win_of(&none));
        assert_eq!(l.step, Step::Wait); assert!(!l.hide_page);
        // the game's program runs (no window yet), the app still in front: the page stays
        now.push(p(20, 10, r"D:\SteamLibrary\steamapps\common\Ambidextro\Ambidextro.exe"));
        let l = g.look(&now, Some(OWN), s(4), shell, win_of(&none));
        assert_eq!(l.step, Step::Wait); assert!(!l.hide_page); assert_eq!(l.hand_to, None);
        // its window opens while the touchpad helper (started again) has the focus: given the focus
        now.retain(|x| x.pid != 12); now.push(p(40, 1, r"C:\Program Files\Synaptics\SynTP\SynTPEnh.exe"));
        let w = vec![(20, 777)];
        let l = g.look(&now, Some(40), s(6), shell, win_of(&w));
        assert_eq!(l.step, Step::Wait); assert_eq!(l.hand_to, Some(777)); assert!(!l.hide_page);
        // playing: the game in front: the page is hidden now, once
        let l = g.look(&now, Some(20), s(8), shell, win_of(&w));
        assert_eq!(l.step, Step::Wait); assert!(l.hide_page);
        for t in [10, 12] {
            let l = g.look(&now, Some(20), s(t), shell, win_of(&w));
            assert_eq!(l.step, Step::Wait); assert_eq!(l.hand_to, None); assert!(!l.hide_page);
        }
        // the player checks Discord for a moment: the game is still followed, its window not taken back
        let l = g.look(&now, Some(13), s(14), shell, win_of(&w));
        assert_eq!(l.step, Step::Wait); assert_eq!(l.hand_to, None);
        // the game is closed (Steam, its helper and Discord keep running)
        now.retain(|x| x.pid != 20);
        let l = g.look(&now, Some(11), s(16), shell, win_of(&none));
        assert_eq!(l.step, Step::Wait);                                  // one look without it
        let l = g.look(&now, Some(11), s(18), shell, win_of(&none));
        assert_eq!(l.step, Step::Ended);                                 // two: ended
    }

    #[test]
    fn back_in_the_app_with_the_game_still_open_in_another_window() {
        let mut g = steam_game();
        let mut now = before();
        now.push(p(20, 10, r"D:\SteamLibrary\steamapps\common\Ambidextro\Ambidextro.exe"));
        let w = vec![(20, 777)];
        assert_eq!(g.look(&now, Some(20), s(3), shell, win_of(&w)).step, Step::Wait);
        assert_eq!(g.look(&now, Some(20), s(9), shell, win_of(&w)).step, Step::Wait);
        // Alt+Tab to the app: after two looks with the app in front, game mode ends
        assert_eq!(g.look(&now, Some(OWN), s(11), shell, win_of(&w)).step, Step::Wait);
        let l = g.look(&now, Some(OWN), s(12), shell, win_of(&w));
        assert_eq!(l.step, Step::Back(vec!["Ambidextro.exe".into()]));
        assert_eq!(l.hand_to, None);                                     // (the game isn't handed the focus back)
    }

    #[test]
    fn the_app_in_front_while_the_game_loads_isnt_coming_back() {
        // a slow game: its program runs for a while before its window shows, the
        // app (black) still in front: game mode stays
        let mut g = steam_game();
        let mut now = before();
        now.push(p(20, 10, r"D:\SteamLibrary\steamapps\common\Ambidextro\Ambidextro.exe"));
        let none: Vec<(u32, isize)> = vec![];
        for t in [2, 3, 5, 6, 8, 9, 11] {
            assert_eq!(g.look(&now, Some(OWN), s(t), shell, win_of(&none)).step, Step::Wait);
        }
        // then its window shows (it takes the focus itself): nothing to hand over
        let w = vec![(20, 777)];
        let l = g.look(&now, Some(20), s(12), shell, win_of(&w));
        assert_eq!(l.step, Step::Wait); assert_eq!(l.hand_to, None);
    }

    #[test]
    fn a_local_game_starting_with_the_app_still_in_front() {
        // (a game or PS3 game started directly: its process runs at once, while the
        // app still has the front: the page isn't hidden then (that would give the
        // window the focus and end game mode before the game began); once the
        // game's window is in front, it is)
        let mut g = GameWatch::new(Follow::new(Some(30), Some(std::path::Path::new(r"C:\RPCS3")), &before(), OWN), OWN);
        let mut now = before();
        now.push(p(30, OWN, r"C:\RPCS3\rpcs3.exe"));
        let none: Vec<(u32, isize)> = vec![];
        for t in [2, 3, 5] {
            let l = g.look(&now, Some(OWN), s(t), shell, win_of(&none));
            assert_eq!(l.step, Step::Wait); assert!(!l.hide_page);
        }
        // its window opens behind the app's focus: handed the focus (the page waits)
        let l = g.look(&now, Some(OWN), s(6), shell, win_of(&[(30, 4)]));
        assert_eq!(l.hand_to, Some(4)); assert!(!l.hide_page); assert_eq!(l.step, Step::Wait);
        // the game in front: the page is hidden
        let l = g.look(&now, Some(30), s(8), shell, win_of(&[(30, 4)]));
        assert!(l.hide_page); assert_eq!(l.step, Step::Wait);
        // playing on: game mode stays
        for t in [9, 11, 12, 14] { assert_eq!(g.look(&now, Some(30), s(t), shell, win_of(&[(30, 4)])).step, Step::Wait); }
    }

    #[test]
    fn a_slow_pc_steam_game_with_the_app_in_front_while_it_loads() {
        let mut g = steam_game();
        let mut now = before();
        let none: Vec<(u32, isize)> = vec![];
        // Steam's launching box in front, the game's program starts
        assert_eq!(g.look(&now, Some(11), s(2), shell, win_of(&none)).step, Step::Wait);
        now.push(p(20, 10, r"D:\SteamLibrary\steamapps\common\Ambidextro\Ambidextro.exe"));
        let l = g.look(&now, Some(11), s(4), shell, win_of(&none));
        assert_eq!(l.step, Step::Wait); assert!(!l.hide_page);            // (Steam's box: the page isn't hidden)
        // the box closes: the app in front again for a long while (the game loading)
        for t in [6, 8, 9, 11, 12, 14, 15, 17, 20, 25] {
            let l = g.look(&now, Some(OWN), s(t), shell, win_of(&none));
            assert_eq!(l.step, Step::Wait); assert!(!l.hide_page);
        }
        // the game's window opens behind the app's focus: given the focus, then hidden page
        let w = vec![(20, 777)];
        assert_eq!(g.look(&now, Some(OWN), s(27), shell, win_of(&w)).hand_to, Some(777));
        let l = g.look(&now, Some(20), s(29), shell, win_of(&w));
        assert!(l.hide_page); assert_eq!(l.step, Step::Wait);
        // quitting the game: back by itself
        now.retain(|x| x.pid != 20);
        assert_eq!(g.look(&now, Some(11), s(31), shell, win_of(&none)).step, Step::Wait);
        assert_eq!(g.look(&now, Some(11), s(32), shell, win_of(&none)).step, Step::Ended);
    }

    #[test]
    fn a_game_that_never_shows_up() {
        let mut g = steam_game();
        let now = before();
        let none: Vec<(u32, isize)> = vec![];
        assert_eq!(g.look(&now, Some(OWN), s(60), shell, win_of(&none)).step, Step::Wait);
        assert_eq!(g.look(&now, Some(11), s(179), shell, win_of(&none)).step, Step::Wait);   // (Steam's window: not the game)
        assert_eq!(g.look(&now, Some(OWN), s(181), shell, win_of(&none)).step, Step::NeverShowed);
    }

    #[test]
    fn a_local_game_and_the_program_it_starts() {
        // a game started directly (its process known) that starts the real game and closes
        let mut g = GameWatch::new(Follow::new(Some(30), Some(std::path::Path::new(r"E:\Games\Foo")), &before(), OWN), OWN);
        let mut now = before();
        now.push(p(30, OWN, r"E:\Games\Foo\launcher.exe"));
        let l = g.look(&now, Some(30), s(2), shell, win_of(&[(30, 5)]));
        assert!(l.hide_page); assert_eq!(l.hand_to, None);
        now.push(p(31, 30, r"C:\Users\x\AppData\Foo\game.exe"));   // (outside the folder: followed as its child)
        now.retain(|x| x.pid != 30);
        let w = vec![(31, 9)];
        let l = g.look(&now, Some(OWN), s(4), shell, win_of(&w));
        assert_eq!(l.step, Step::Wait); assert_eq!(l.hand_to, Some(9));   // the real game's window gets the focus
        now.retain(|x| x.pid != 31);
        assert_eq!(g.look(&now, Some(OWN), s(6), shell, win_of(&[])).step, Step::Wait);
        assert_eq!(g.look(&now, Some(OWN), s(8), shell, win_of(&[])).step, Step::Ended);
    }

    #[test]
    fn explorer_in_front_doesnt_become_the_game() {
        // (a store link opened through Windows: explorer in front for a moment)
        let mut g = GameWatch::new(Follow::new(None, None, &before(), OWN), OWN);
        let mut now = before();
        assert_eq!(g.look(&now, Some(5), s(2), shell, win_of(&[])).step, Step::Wait);
        // the game started by its store shows its window: followed from the front
        now.push(p(50, 10, r"C:\Games\Bar\bar.exe"));
        let l = g.look(&now, Some(50), s(4), shell, win_of(&[(50, 3)]));
        assert!(l.hide_page);
        now.retain(|x| x.pid != 50);
        assert_eq!(g.look(&now, Some(5), s(6), shell, win_of(&[])).step, Step::Wait);
        assert_eq!(g.look(&now, Some(5), s(8), shell, win_of(&[])).step, Step::Ended);
    }
}

/// The controller always gets the app back. Windows sometimes doesn't hand
/// the foreground (or the page's focus) back to the app after the Internet
/// Browser, a file window or a game closes, and a page without the focus gets
/// no controller input, so the app looked stuck until the mouse was used. So
/// while the app (or its page) isn't the one in front, the controller is
/// watched here, and a press brings the app back to the front with its page
/// focused. While a game runs, a press only does that once the game has no
/// window in front any more (it ended without the app noticing): game mode
/// ends then too. Not during the Internet Browser or a file window (they
/// read the controller themselves).
pub fn start_pad_watch(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        use std::time::Duration;
        let mut reader = crate::gamepad::Reader::new();
        let mut prev: u32 = 0;
        let mut stick_was = false;
        let mut last_front = 0u64;
        loop {
            std::thread::sleep(Duration::from_millis(50));
            if crate::browser::session_active() || crate::browser::picker_active() { prev = u32::MAX; continue; }
            let Some(w) = app.get_webview_window("main") else { continue };
            let Ok(h) = w.hwnd() else { continue };
            let h = h.0 as isize;
            let fg = win::foreground();
            let fg_pid = win::foreground_pid().unwrap_or(0);
            let ours = fg == h || fg_pid == std::process::id();
            let game = in_game();
            if !game && ours && PAGE_FOCUSED.load(Ordering::Relaxed) {
                // all is well: look again in a moment (nothing is read)
                prev = u32::MAX;
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            let Some(p) = reader.poll() else { prev = 0; continue };
            // (buttons already held when the watch started don't count)
            if prev == u32::MAX { prev = p.buttons; stick_was = true; }
            let stick = p.lx.abs() > 0.6 || p.ly.abs() > 0.6;
            let pressed = (p.buttons & !prev) != 0 || (stick && !stick_was);
            prev = p.buttons; stick_was = stick;
            if !pressed { continue; }
            if game {
                // the game's window (or its launcher's) is still in front, or the
                // game was only just started: the controller is the game's
                if fg != 0 && !ours && !win::is_shell_process(fg_pid) { continue; }
                if now_ms().saturating_sub(GAME_AT.load(Ordering::Relaxed)) < 6000 { continue; }
                return_from_game(&app, "a controller button pressed in the app");
                continue;
            }
            let t = now_ms();
            if t.saturating_sub(last_front) > 500 { last_front = t; bring_to_front(&app); }
        }
    });
    #[cfg(not(windows))]
    { let _ = (app, &GAME_AT); }
}

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod win {
    use std::path::Path;
    type HWND = isize;
    type BOOL = i32;
    type HANDLE = isize;

    #[repr(C)]
    struct PROCESSENTRY32W {
        dwSize: u32, cntUsage: u32, th32ProcessID: u32, th32DefaultHeapID: usize, th32ModuleID: u32,
        cntThreads: u32, th32ParentProcessID: u32, pcPriClassBase: i32, dwFlags: u32, szExeFile: [u16; 260],
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowThreadProcessId(h: HWND, pid: *mut u32) -> u32;
        fn GetForegroundWindow() -> HWND;
        fn SwitchToThisWindow(h: HWND, alt_tab: BOOL);
        fn SetForegroundWindow(h: HWND) -> BOOL;
        fn BringWindowToTop(h: HWND) -> BOOL;
        fn ShowWindow(h: HWND, cmd: i32) -> BOOL;
        fn IsIconic(h: HWND) -> BOOL;
        fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
        fn EnumWindows(cb: extern "system" fn(HWND, isize) -> BOOL, l: isize) -> BOOL;
        fn IsWindowVisible(h: HWND) -> BOOL;
        fn GetWindow(h: HWND, cmd: u32) -> HWND;
        fn AllowSetForegroundWindow(pid: u32) -> BOOL;
        fn GetLastInputInfo(info: *mut LASTINPUTINFO) -> BOOL;
    }
    #[repr(C)]
    struct LASTINPUTINFO { cb_size: u32, dw_time: u32 }
    #[link(name = "kernel32")]
    extern "system" { fn GetTickCount() -> u32; }
    /// How long since the user last used the keyboard, mouse or touch (ms).
    pub fn input_idle_ms() -> u32 {
        let mut li = LASTINPUTINFO { cb_size: std::mem::size_of::<LASTINPUTINFO>() as u32, dw_time: 0 };
        unsafe { if GetLastInputInfo(&mut li) == 0 { return u32::MAX; } GetTickCount().wrapping_sub(li.dw_time) }
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn SetPriorityClass(h: HANDLE, class: u32) -> BOOL;
        fn OpenProcess(access: u32, inherit: BOOL, pid: u32) -> HANDLE;
        fn CloseHandle(h: HANDLE) -> BOOL;
        fn TerminateProcess(h: HANDLE, code: u32) -> BOOL;
        fn GetExitCodeProcess(h: HANDLE, code: *mut u32) -> BOOL;
        fn GetProcessTimes(h: HANDLE, creation: *mut u32, exit: *mut u32, kernel: *mut u32, user: *mut u32) -> BOOL;
        fn QueryFullProcessImageNameW(h: HANDLE, flags: u32, buf: *mut u16, len: *mut u32) -> BOOL;
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> HANDLE;
        fn Process32FirstW(snap: HANDLE, e: *mut PROCESSENTRY32W) -> BOOL;
        fn Process32NextW(snap: HANDLE, e: *mut PROCESSENTRY32W) -> BOOL;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const VK_MENU: u8 = 0x12;
    const KEYEVENTF_KEYUP: u32 = 0x2;
    const SW_RESTORE: i32 = 9;

    /// A process's program name, for the log.
    pub fn name_of(now: &[super::Proc], pid: u32) -> String {
        if pid == std::process::id() { return "the app".into(); }
        now.iter().find(|p| p.pid == pid).and_then(|p| p.path.as_deref())
            .map(|x| x.rsplit(['\\', '/']).next().unwrap_or(x).to_string()).unwrap_or_else(|| format!("pid {}", pid))
    }

    /// Any program may take the foreground from the app (until the next key or click).
    pub fn allow_any_foreground() {
        unsafe { AllowSetForegroundWindow(u32::MAX); }   // ASFW_ANY
    }

    /// The first visible, unowned window of these processes (0: none).
    pub fn main_window_of(pids: &[u32]) -> HWND {
        if pids.is_empty() { return 0; }
        struct Find { pids: Vec<u32>, found: HWND }
        extern "system" fn each(h: HWND, l: isize) -> BOOL {
            unsafe {
                let f = &mut *(l as *mut Find);
                let mut p = 0u32;
                GetWindowThreadProcessId(h, &mut p);
                if f.pids.contains(&p) && IsWindowVisible(h) != 0 && GetWindow(h, 4 /* GW_OWNER */) == 0 {
                    f.found = h;
                    return 0;
                }
                1
            }
        }
        let mut f = Find { pids: pids.to_vec(), found: 0 };
        unsafe { EnumWindows(each, &mut f as *mut Find as isize); }
        f.found
    }

    pub fn force_foreground(h: HWND) {
        if h == 0 { return; }
        unsafe {
            if IsIconic(h) != 0 { ShowWindow(h, SW_RESTORE); }
            if GetForegroundWindow() == h { return; }
            // (no joining of the foreground program's input (AttachThreadInput): a
            // program that doesn't answer, like a game closing, would freeze the
            // app with it.) A tap of Alt lets this process take the foreground.
            keybd_event(VK_MENU, 0, 0, 0);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
            BringWindowToTop(h);
            SetForegroundWindow(h);
            if GetForegroundWindow() != h { SwitchToThisWindow(h, 1); }
        }
    }

    pub fn foreground() -> HWND { unsafe { GetForegroundWindow() } }

    pub fn foreground_pid() -> Option<u32> {
        let h = unsafe { GetForegroundWindow() };
        if h == 0 { return None; }
        let mut p = 0u32;
        unsafe { GetWindowThreadProcessId(h, &mut p) };
        (p != 0).then_some(p)
    }


    fn image_path(pid: u32) -> Option<String> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h == 0 { return None; }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0;
            CloseHandle(h);
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// Programs that are part of Windows or of a store client, never "the game".
    pub fn is_shell_process(pid: u32) -> bool {
        let Some(p) = image_path(pid) else { return true };
        let n = Path::new(&p).file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        const SHELL: &[&str] = &["explorer.exe", "cmd.exe", "conhost.exe", "searchhost.exe", "searchapp.exe", "shellexperiencehost.exe",
            "startmenuexperiencehost.exe", "applicationframehost.exe", "taskmgr.exe", "steam.exe", "steamwebhelper.exe",
            "epicgameslauncher.exe", "galaxyclient.exe", "eadesktop.exe", "origin.exe", "ubisoftconnect.exe", "upc.exe",
            "battle.net.exe", "lockapp.exe", "textinputhost.exe", "msedgewebview2.exe",
            // (launchers' helpers: their windows aren't the game's either)
            "gameoverlayui.exe", "steamerrorreporter.exe", "steamservice.exe", "epicwebhelper.exe",
            "galaxyclient helper.exe", "eabackgroundservice.exe",
            // (a touchpad helper that comes to the front when the screen mode changes)
            "syntpenh.exe"];
        SHELL.contains(&n.as_str())
    }

    /// A folder specific enough to say "the game is running from here".
    pub fn usable_dir(d: &Path) -> bool {
        let s = d.display().to_string().to_lowercase();
        d.components().count() >= 3 && !s.contains("\\windows\\") && !s.ends_with("\\windows")
    }

    /// The app and its page's processes (the webview's, started by it) at a
    /// lower priority while a game runs (`low`), back to normal after.
    /// The app's own helper processes of these programs (by file name ending),
    /// found down from the app's process: never a game it started.
    fn own_tree(names: &[&str]) -> Vec<u32> { own_tree_in(&processes(true), names) }
    fn own_tree_in(all: &[super::Proc], names: &[&str]) -> Vec<u32> {
        let own = std::process::id();
        let is = |p: &super::Proc| p.path.as_ref().map(|x| { let x = x.to_lowercase(); names.iter().any(|n| x.ends_with(n)) }).unwrap_or(false);
        let mut ours: Vec<u32> = vec![own];
        loop {
            let add: Vec<u32> = all.iter().filter(|p| ours.contains(&p.parent) && !ours.contains(&p.pid) && is(p)).map(|p| p.pid).collect();
            if add.is_empty() { break; }
            ours.extend(add);
        }
        ours.retain(|&p| p != own);
        ours
    }
    /// The page's processes (WebView2's) under the app.
    pub fn webview_pids() -> Vec<u32> { own_tree_in(&processes(true), &["msedgewebview2.exe"]) }
    pub fn webview_pids_in(all: &[super::Proc]) -> Vec<u32> { own_tree_in(all, &["msedgewebview2.exe"]) }
    /// End what's left of the page's processes (before the window is made anew).
    /// Open these processes to read their exit codes later.
    /// (The main one, started by the app itself, is marked.)
    pub fn hold(pids: &[u32]) -> Vec<(u32, isize, bool)> {
        let own = std::process::id();
        let all = processes(false);
        pids.iter().filter_map(|&pid| {
            let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
            let main = all.iter().any(|p| p.pid == pid && p.parent == own);
            (h != 0).then_some((pid, h, main))
        }).collect()
    }
    /// "pid: code, +ms" for each held process (0x00000103, STILL_ACTIVE, while
    /// it runs), the main one (started by the app) marked, and when each ended,
    /// counted from the first to end: one after the other or all at once.
    pub fn exit_codes(held: &[(u32, isize, bool)]) -> String {
        let ended: Vec<Option<u64>> = held.iter().map(|&(_, h, _)| unsafe {
            let (mut c, mut e, mut k, mut u) = ([0u32; 2], [0u32; 2], [0u32; 2], [0u32; 2]);
            if GetProcessTimes(h, c.as_mut_ptr(), e.as_mut_ptr(), k.as_mut_ptr(), u.as_mut_ptr()) != 0 {
                let t = ((e[1] as u64) << 32) | e[0] as u64;
                (t != 0).then_some(t)
            } else { None }
        }).collect();
        let first = ended.iter().flatten().min().copied().unwrap_or(0);
        held.iter().zip(ended).map(|(&(pid, h, main), end)| {
            let mut code = 0u32;
            let ok = unsafe { GetExitCodeProcess(h, &mut code) } != 0;
            let what = if main { " (main)" } else { "" };
            let when = end.map(|t| format!(", +{} ms", (t - first) / 10_000)).unwrap_or_default();
            if ok { format!("{pid}{what}: 0x{code:08X}{when}") } else { format!("{pid}{what}: ?{when}") }
        }).collect::<Vec<_>>().join("; ")
    }
    pub fn release(held: &mut Vec<(u32, isize, bool)>) {
        for &(_, h, _) in held.iter() { unsafe { CloseHandle(h); } }
        held.clear();
    }

    pub fn end_webview_processes() {
        const PROCESS_TERMINATE: u32 = 0x0001;
        for pid in webview_pids() {
            unsafe {
                let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
                if h != 0 { TerminateProcess(h, 1); CloseHandle(h); }
            }
        }
    }

    pub fn set_priority(low: bool) {
        const PROCESS_SET_INFORMATION: u32 = 0x0200;
        let class: u32 = if low { 0x4000 } else { 0x20 };   // BELOW_NORMAL / NORMAL
        // (only the webview's processes under the app, and its own FFmpeg work (a
        // video or song being converted, a picture being made): never a game it started)
        let mut ours = own_tree(&["msedgewebview2.exe", "ffmpeg.exe"]);
        ours.push(std::process::id());
        for pid in ours {
            unsafe {
                let h = OpenProcess(PROCESS_SET_INFORMATION, 0, pid);
                if h != 0 { SetPriorityClass(h, class); CloseHandle(h); }
            }
        }
    }

    /// Every running process (with its program's path when `paths`).
    pub fn processes(paths: bool) -> Vec<super::Proc> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == -1 || snap == 0 { return out; }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e) != 0;
            while ok {
                if e.th32ProcessID != 0 {
                    let path = if paths { image_path(e.th32ProcessID) } else { None };
                    out.push(super::Proc { pid: e.th32ProcessID, parent: e.th32ParentProcessID, path });
                }
                ok = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
        }
        out
    }

}
