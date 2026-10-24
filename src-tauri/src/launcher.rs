//! Launches a game. The target can be:
//!   * an `.exe`            — spawned directly with the folder as its cwd
//!   * a `.lnk` shortcut    — handed to the Windows shell, which resolves the
//!                            real target, arguments and working directory
//!   * a `.url` shortcut    — opened via the shell
//!   * a protocol / URL     — e.g. `steam://rungameid/12345` (opened via shell)
//!
//! The decision of *what* to do is split into a pure `plan()` function so it
//! can be unit-tested without spawning anything; `launch()` then executes it.

use crate::models::LaunchResult;
use std::path::{Path, PathBuf};
use std::process::Command;

/// What launching a given target will actually do. Pure/inspectable.
#[derive(Debug, Clone, PartialEq)]
pub enum LaunchPlan {
    /// Spawn an executable directly, with `cwd` as working directory.
    Direct { exe: PathBuf, cwd: PathBuf },
    /// Hand a shortcut/file to the OS shell to open, from `cwd`.
    Shell { target: PathBuf, cwd: PathBuf },
    /// Open a protocol or web URL (no filesystem target).
    Url { url: String },
    /// A script run by its interpreter: `exe pre… script args…`.
    Script { exe: String, pre: Vec<String>, script: PathBuf, cwd: PathBuf },
    /// Nothing to launch.
    Empty,
    /// A file target was named but doesn't exist on disk.
    Missing { path: PathBuf },
}

fn ext_lower(p: &Path) -> String {
    p.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Decide how a `launch` value (relative to `folder`) should be run.
pub fn plan(folder: &str, launch: &str) -> LaunchPlan {
    let launch = launch.trim();
    if launch.is_empty() {
        return LaunchPlan::Empty;
    }

    // Protocol or web URL (steam://, com.epicgames..., http://, ...)
    if launch.contains("://") {
        return LaunchPlan::Url { url: launch.to_string() };
    }

    let dir = Path::new(folder);
    let target = dir.join(launch);
    if !target.exists() {
        return LaunchPlan::Missing { path: target };
    }
    // the app's own shortcut (.xmbl): what it points at
    if ext_lower(&target) == crate::medialib::LINK_EXT {
        return match crate::medialib::read_link(&target) {
            Some(t) if t.exists() => plan(folder, &t.display().to_string()),
            Some(t) => LaunchPlan::Missing { path: t },
            None => LaunchPlan::Missing { path: target },
        };
    }

    match ext_lower(&target).as_str() {
        // run from the exe's own folder (games found in source folders live
        // outside the game's content folder)
        "exe" => {
            let cwd = target.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| dir.to_path_buf());
            LaunchPlan::Direct { exe: target, cwd }
        }
        // Shortcuts and internet-shortcuts go through the shell so Windows
        // resolves the underlying target/args/workingdir for us.
        "lnk" | "url" | "desktop" => LaunchPlan::Shell { target, cwd: dir.to_path_buf() },
        // scripts: run with their interpreter (a .ps1 would otherwise open in
        // Notepad); the rest go through the shell's own association
        "ps1" => LaunchPlan::Script { exe: "powershell.exe".into(), pre: vec!["-ExecutionPolicy".into(), "Bypass".into(), "-File".into()], script: target, cwd: dir.to_path_buf() },
        "jar" => LaunchPlan::Script { exe: "javaw.exe".into(), pre: vec!["-jar".into()], script: target, cwd: dir.to_path_buf() },
        // Anything else (e.g. a .bat, or an extensionless binary): let the
        // shell decide how to open it.
        _ => LaunchPlan::Shell { target, cwd: dir.to_path_buf() },
    }
}

/// The folder a started game runs from (to know when it has ended): the
/// exe's folder, or a shortcut's target folder. None for store links.
pub fn watch_dir(folder: &str, launch: &str) -> Option<PathBuf> {
    match plan(folder, launch) {
        LaunchPlan::Direct { exe, .. } => exe.parent().map(|p| p.to_path_buf()),
        LaunchPlan::Shell { target, .. } if ext_lower(&target) == "lnk" => {
            let info = crate::gamesrc::parse_lnk(&std::fs::read(&target).ok()?)?;
            let t = PathBuf::from(info.target?);
            if t.extension().map(|e| e.to_string_lossy().eq_ignore_ascii_case("exe")).unwrap_or(false) { t.parent().map(|p| p.to_path_buf()) } else { None }
        }
        _ => None,
    }
}

pub fn launch(folder: &str, launch_rel: &str, args: &[String]) -> LaunchResult {
    match plan(folder, launch_rel) {
        LaunchPlan::Empty => fail("No launch target is defined for this game."),
        LaunchPlan::Missing { path } => {
            fail(&format!("Launch target not found: {}", path.display()))
        }
        LaunchPlan::Direct { exe, cwd } => {
            let mut cmd = Command::new(&exe);
            cmd.current_dir(&cwd);
            if !args.is_empty() {
                cmd.args(args);
            }
            spawn(cmd)
        }
        LaunchPlan::Shell { target, cwd } => shell_open(&target, Some(&cwd), args),
        LaunchPlan::Script { exe, pre, script, cwd } => {
            let mut cmd = Command::new(exe);
            cmd.current_dir(&cwd).args(pre).arg(script).args(args);
            spawn(cmd)
        }
        LaunchPlan::Url { url } => shell_open(Path::new(&url), None, args),
    }
}

fn fail(msg: &str) -> LaunchResult {
    LaunchResult { ok: false, pid: None, message: msg.to_string() }
}

fn spawn(mut cmd: Command) -> LaunchResult {
    match cmd.spawn() {
        Ok(child) => LaunchResult { ok: true, pid: Some(child.id()), message: "launched".into() },
        Err(e) => fail(&format!("Failed to launch: {e}")),
    }
}

/// A game is starting: let its window take the foreground when it opens (the
/// app stays where it is, showing black, until then).
#[cfg(windows)]
pub fn allow_game_foreground() {
    extern "system" { fn AllowSetForegroundWindow(pid: u32) -> i32; }
    const ASFW_ANY: u32 = 0xFFFF_FFFF;
    unsafe { AllowSetForegroundWindow(ASFW_ANY); }
}

/// Open a shortcut / file / URL through the platform shell.
#[cfg(windows)]
fn shell_open(target: &Path, cwd: Option<&Path>, args: &[String]) -> LaunchResult {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // `cmd /C start "" [/D dir] "target" [args...]` resolves .lnk/.url and
    // protocol strings, and start returns immediately (no blocking).
    let mut cmd = Command::new("cmd");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(["/C", "start", ""]);
    if let Some(dir) = cwd {
        cmd.arg("/D").arg(dir);
    }
    cmd.arg(target.as_os_str());
    for a in args {
        cmd.arg(a);
    }
    match cmd.spawn() {
        Ok(_) => LaunchResult { ok: true, pid: None, message: "launched via shell".into() },
        Err(e) => fail(&format!("Failed to launch shortcut: {e}")),
    }
}

/// Non-Windows fallback. `.exe`/`.lnk` are Windows concepts; `.desktop`
/// files and URLs can still be opened with the desktop's default handler.
#[cfg(not(windows))]
fn shell_open(target: &Path, cwd: Option<&Path>, _args: &[String]) -> LaunchResult {
    let mut cmd = Command::new("xdg-open");
    cmd.arg(target.as_os_str());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    match cmd.spawn() {
        Ok(child) => LaunchResult { ok: true, pid: Some(child.id()), message: "opened".into() },
        Err(e) => fail(&format!("Failed to open target: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn empty_launch_is_empty_plan() {
        assert_eq!(plan("/tmp", "   "), LaunchPlan::Empty);
    }

    #[test]
    fn protocol_url_is_url_plan() {
        assert_eq!(
            plan("/tmp", "steam://rungameid/7"),
            LaunchPlan::Url { url: "steam://rungameid/7".into() }
        );
    }

    #[test]
    fn missing_file_is_missing_plan() {
        match plan("/tmp", "nope.exe") {
            LaunchPlan::Missing { .. } => {}
            other => panic!("expected Missing, got {other:?}"),
        }
    }

    #[test]
    fn existing_exe_is_direct_and_lnk_is_shell() {
        let dir = std::env::temp_dir().join("xmb_launch_test");
        let _ = fs::create_dir_all(&dir);
        let exe = dir.join("game.exe");
        let lnk = dir.join("game.lnk");
        fs::write(&exe, b"x").unwrap();
        fs::write(&lnk, b"x").unwrap();
        let d = dir.to_string_lossy().to_string();

        assert!(matches!(plan(&d, "game.exe"), LaunchPlan::Direct { .. }));
        assert!(matches!(plan(&d, "game.lnk"), LaunchPlan::Shell { .. }));

        let _ = fs::remove_dir_all(&dir);
    }
}
