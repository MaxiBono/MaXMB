//! Start at Windows Startup.
//!
//! A Task Scheduler task ("MaXMB") started when the user signs in, instead of
//! the Run key in the registry: it starts as soon as the user is signed in,
//! without the delay Windows gives Run-key programs, at normal priority (a
//! task's default is below normal), with no time limit and also on battery.
//! It runs with the user's own rights (not as administrator: everything
//! MaXMB starts, games and the browser included, would be too). It starts
//! MaXMB with `--autostart`, and then MaXMB keeps itself in front while the
//! other programs that start with Windows open their windows (see
//! focus::boot_guard).
//!
//! (Wallpaper Engine's "high priority" start does the same job with a small
//! Windows service; a task needs nothing installed.)

use std::path::Path;

/// The task's name in Task Scheduler.
pub const TASK: &str = "MaXMB";
/// What MaXMB is started with by the task.
pub const ARG: &str = "--autostart";

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// The task, as Task Scheduler's XML: at the sign-in of `user`
/// ("DOMAIN\\name"), `exe --autostart` from its own folder.
pub fn task_xml(exe: &Path, user: &str) -> String {
    let full = exe.display().to_string();
    let dir = full.rfind(['\\', '/']).map(|i| full[..i].to_string()).unwrap_or_default();
    format!(r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>MaXMB</Author>
    <Description>Starts MaXMB when you sign in to Windows (Settings &gt; System Settings &gt; Start at Windows Startup).</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"{exe}"</Command>
      <Arguments>{arg}</Arguments>
      <WorkingDirectory>{dir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"#, user = xml_escape(user), exe = xml_escape(&exe.display().to_string()), arg = ARG, dir = xml_escape(&dir))
}

/// Whether the task's XML (as `schtasks /Query /XML` prints it) starts this exe.
pub fn task_starts(xml: &str, exe: &Path) -> bool {
    let want = exe.display().to_string().to_lowercase();
    xml.to_lowercase().contains(&xml_escape(&want).to_lowercase()) || xml.to_lowercase().contains(&want)
}

/// Started by the task (at sign-in)?
pub fn started_at_boot() -> bool { std::env::args().any(|a| a == ARG) }

#[cfg(windows)]
mod win {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const NO_WINDOW: u32 = 0x0800_0000;
    pub fn schtasks(args: &[&str]) -> Option<(bool, String)> {
        let out = Command::new("schtasks.exe").args(args).creation_flags(NO_WINDOW).output().ok()?;
        Some((out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned()))
    }
}

/// Make the task (or leave it, if it's already there for this exe), or delete
/// it. Done on a thread of its own (schtasks takes a moment).
pub fn apply(enable: bool) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        let Ok(exe) = std::env::current_exe() else { return };
        let now = win::schtasks(&["/Query", "/TN", TASK, "/XML"]);
        let there = now.as_ref().map(|(ok, _)| *ok).unwrap_or(false);
        if !enable {
            if there {
                let ok = win::schtasks(&["/Delete", "/TN", TASK, "/F"]).map(|(ok, _)| ok).unwrap_or(false);
                crate::log::line(if ok { "INFO" } else { "WARN" }, "system", if ok { "Start at Windows Startup: the task was removed" } else { "Start at Windows Startup: the task couldn't be removed" });
            }
            return;
        }
        if there && now.as_ref().map(|(_, x)| task_starts(x, &exe)).unwrap_or(false) { return; }
        let user = format!("{}\\{}", std::env::var("USERDOMAIN").unwrap_or_default(), std::env::var("USERNAME").unwrap_or_default());
        // (written as UTF-16 with its mark, as schtasks reads task files; in the
        // Temp folder, deleted right after)
        let file = std::env::temp_dir().join(format!("maxmb-task-{}.xml", std::process::id()));
        let mut bytes = vec![0xFF, 0xFE];
        for u in task_xml(&exe, &user).encode_utf16() { bytes.extend_from_slice(&u.to_le_bytes()); }
        if std::fs::write(&file, &bytes).is_err() { return; }
        let ok = win::schtasks(&["/Create", "/TN", TASK, "/XML", &file.display().to_string(), "/F"]).map(|(ok, _)| ok).unwrap_or(false);
        let _ = std::fs::remove_file(&file);
        crate::log::line(if ok { "INFO" } else { "WARN" }, "system",
            if ok { "Start at Windows Startup: the task was made (Task Scheduler > MaXMB)" } else { "Start at Windows Startup: the task couldn't be made" });
    });
    #[cfg(not(windows))]
    let _ = enable;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_task_starts_maxmb_at_sign_in_with_the_users_rights() {
        let exe = Path::new(r"D:\Games & Apps\MaXMB\MaXMB.exe");
        let x = task_xml(exe, r"PC\Maxi");
        assert!(x.contains("<LogonTrigger>") && x.contains(r"<UserId>PC\Maxi</UserId>"));
        assert!(x.contains("<RunLevel>LeastPrivilege</RunLevel>"), "not as administrator");
        assert!(x.contains("<Priority>4</Priority>") && x.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
        assert!(x.contains("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"));
        assert!(x.contains(r#"<Command>"D:\Games &amp; Apps\MaXMB\MaXMB.exe"</Command>"#), "{x}");
        assert!(x.contains("<Arguments>--autostart</Arguments>"));
        assert!(x.contains(r"<WorkingDirectory>D:\Games &amp; Apps\MaXMB</WorkingDirectory>"));
        assert!(task_starts(&x, exe));
        assert!(!task_starts(&x, Path::new(r"C:\Old\MaXMB.exe")));
    }
}
