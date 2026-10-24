//! Content lives in the app's own folder, not in AppData.
//!
//! `content_root` resolves to:
//!   * a `content/` folder next to the executable in a real install, or
//!   * `<project>/content/` during `tauri dev` (detected via the target dir),
//!   * or an explicit `PS3XMB_CONTENT` override.
//!
//! Under it: `Games/`, `Music/`, `Photos/`, `Videos/`, `Themes/`, and a
//! `data/` folder for `settings.json`, `users.json`, `psn.json`.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

fn ensure(p: PathBuf) -> PathBuf {
    let _ = fs::create_dir_all(&p);
    p
}

pub fn content_root(_app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("PS3XMB_CONTENT") {
        return ensure(PathBuf::from(p));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let s = dir.to_string_lossy().replace('\\', "/");
            // Dev build: <project>/src-tauri/target/<profile>/exe
            if let Some(idx) = s.find("/target/") {
                let src_tauri = PathBuf::from(&s[..idx]); // <project>/src-tauri
                let project = src_tauri.parent().map(|p| p.to_path_buf()).unwrap_or(src_tauri);
                return ensure(project.join("content"));
            }
            return ensure(dir.join("content"));
        }
    }
    ensure(PathBuf::from("content"))
}

pub fn data_dir(app: &AppHandle) -> PathBuf {
    ensure(content_root(app).join("data"))
}

/// Cache folder for extracted embedded music cover art.
pub fn covers_dir(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("covers")) }
/// Small copies of photos and song covers (see thumbs.rs): the temporary
/// folder, or the system directory with "Save Cache in System Directory".
pub fn thumbs_dirs(app: &AppHandle) -> crate::thumbs::Dirs {
    crate::thumbs::Dirs { temp: temp_dir(app).join("thumbs"), app: data_dir(app).join("cache").join("thumbs") }
}
/// Videos converted for playback, kept in the system directory.
pub fn video_cache_app_dir(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("cache").join("video")) }
/// Icons chosen for videos ("Change Icon" in the video player).
pub fn video_icons_dir(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("video_icons")) }
/// Saved icon shading (the glossy icon images), in the system directory.
pub fn icon_shades_app_file(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("cache")).join("icon_shades.json") }
/// The same, in the temporary folder (the default).
pub fn icon_shades_temp_file(app: &AppHandle) -> PathBuf { temp_dir(app).join("icon_shades.json") }

/// Persistent folder (inside the app's own directory) for decoded song data,
/// used when "Keep Preloaded Songs Data" is on so preloaded songs survive a
/// restart instead of living in the OS temp dir.
pub fn preloaded_songs_dir(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("preloaded_songs")) }

/// Icons pulled out of shortcuts (game folders that only hold a shortcut).
pub fn shortcut_icons_dir(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("shortcut_icons")) }
/// Record of the games created from the game source folders.
pub fn game_sources_file(app: &AppHandle) -> PathBuf { data_dir(app).join("game_sources.json") }
/// The temporary place for caches: Windows' own Temp folder (%TEMP%, a
/// "MaXMB" folder in it), cleared when the system turns off with Delete
/// Temporary Files on; the kept caches stay in the system's own directory.
pub fn temp_dir(_app: &AppHandle) -> PathBuf { ensure(std::env::temp_dir().join("MaXMB")) }
/// The temporary folder of older versions (inside the system's own directory):
/// what's in it moves to the Temp folder once (see `move_old_temp`).
pub fn old_temp_dir(app: &AppHandle) -> PathBuf { data_dir(app).join("temp") }
/// Once, at start: the old temporary folder's files go to the Temp folder (moved
/// when it's on the same drive; otherwise left out, they were only temporary).
/// (also the Temp folder's "PS3 XMB" folder, from before the name MaXMB)
pub fn move_old_temp(app: &AppHandle) {
    let new = temp_dir(app);
    for old in [old_temp_dir(app), std::env::temp_dir().join("PS3 XMB")] {
        if old.is_dir() { move_tree(&old, &new); }
    }
}
fn move_tree(old: &std::path::Path, new: &std::path::Path) {
    fn mv(from: &std::path::Path, to: &std::path::Path) {
        let _ = fs::create_dir_all(to);
        for e in fs::read_dir(from).into_iter().flatten().flatten() {
            let p = e.path(); let t = to.join(e.file_name());
            if p.is_dir() { mv(&p, &t); } else if !t.exists() { let _ = fs::rename(&p, &t); }
        }
    }
    mv(old, new);
    let _ = fs::remove_dir_all(old);
}
/// The webview's own storage (WebView2 profile), also kept in the app folder.
pub fn webview_dir(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("webview")) }

pub fn settings_file(app: &AppHandle) -> PathBuf { data_dir(app).join("settings.json") }
pub fn users_file(app: &AppHandle) -> PathBuf { data_dir(app).join("users.json") }
pub fn psn_file(app: &AppHandle) -> PathBuf { data_dir(app).join("psn.json") }

/// Your own PSN avatars, read at startup (any picture, any file name).
pub fn psn_avatars_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Avatars").join("PSN")) }
pub fn games_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Games")) }
pub fn music_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Music")) }
pub fn photos_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Photos")) }
pub fn videos_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Videos")) }
pub fn subtitles_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Subtitles")) }
pub fn themes_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Themes")) }
/// Icon Themes: one folder each, with the replacement icons and a .json naming it.
pub fn icon_themes_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Icon")) }
/// Sound Effects packs (a folder each: sounds named like the system's, and a .json with the pack's name).
pub fn sound_effects_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Sound Effects")) }
/// Where the PS3 themes (.p3t) are unpacked (made again when needed).
pub fn p3t_cache_dir(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("cache").join("p3t")) }
/// Where Custom Themes (.zip) are unpacked.
pub fn custom_theme_cache_dir(app: &AppHandle) -> PathBuf { ensure(data_dir(app).join("cache").join("custom_themes")) }
/// Where extracted PS3 themes go (Extract Theme). (It was called
/// "ThemeExtraction": a folder by that name is renamed, when there's no
/// "Themes Extracted" yet.)
pub fn theme_extraction_dir(app: &AppHandle) -> PathBuf {
    let dir = content_root(app).join("Themes Extracted");
    let old = content_root(app).join("ThemeExtraction");
    if !dir.exists() && old.is_dir() { let _ = fs::rename(&old, &dir); }
    ensure(dir)
}
/// Fonts the user can pick in Theme Settings > Font (.ttf / .otf / .woff / .woff2).
pub fn fonts_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Fonts")) }
/// Holds the bundled LibreWolf (content/Browser/librewolf), the managed profile,
/// the generated helper extension, policies.json, and any user-dropped .xpi.
pub fn browser_dir(app: &AppHandle) -> PathBuf { ensure(content_root(app).join("Browser")) }

/// Create the whole content tree on first run.
pub fn ensure_content_tree(app: &AppHandle) {
    games_dir(app); music_dir(app); photos_dir(app); videos_dir(app); subtitles_dir(app); themes_dir(app); icon_themes_dir(app); sound_effects_dir(app);
    browser_dir(app);
    // the old (unused) BrowserScripts folder is removed when it's empty
    let _ = fs::remove_dir(content_root(app).join("BrowserScripts"));
    data_dir(app);
    retire_backgrounds_folder(app);
    // the old ThemeExtraction folder gets its new name at start
    if content_root(app).join("ThemeExtraction").is_dir() { theme_extraction_dir(app); }
    remove_old_controls_txt(app);
}

/// Older versions had a separate Backgrounds folder. Backgrounds now come from
/// Photos / Videos, so move anything left in it into Photos and remove it.
fn retire_backgrounds_folder(app: &AppHandle) {
    let old = content_root(app).join("Backgrounds");
    if !old.is_dir() { return; }
    let photos = photos_dir(app);
    if let Ok(rd) = fs::read_dir(&old) {
        for e in rd.flatten() {
            let mut dest = photos.join(e.file_name());
            let mut n = 1;
            while dest.exists() {
                let stem = e.path().file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
                let ext = e.path().extension().map(|x| format!(".{}", x.to_string_lossy())).unwrap_or_default();
                dest = photos.join(format!("{stem} ({n}){ext}"));
                n += 1;
            }
            let _ = fs::rename(e.path(), dest);
        }
    }
    let _ = fs::remove_dir(&old);
}

/// Older versions wrote a CONTROLS.txt next to the content folder; the
/// controls are in the Manual now, so that copy is removed.
fn remove_old_controls_txt(app: &AppHandle) {
    let root = content_root(app);
    let Some(dir) = root.parent() else { return };
    let _ = std::fs::remove_file(dir.join("CONTROLS.txt"));
}
