//! MaXMB — backend entry point and command surface.

#[macro_use]
mod log;
mod audio;
mod copies;
mod browser;
mod cursorlock;
mod focus;
mod bootstart;
mod gameart;
mod screenshot;
mod gamepad;
mod gamesrc;
mod hidpad;
mod video;
mod vprobe;
mod launcher;
mod library;
mod media;
mod medialib;
mod models;
mod paths;
mod photo;
mod ps3;
mod iso;
mod psn;
mod quitkey;
mod sections;
mod settings;
mod secret;
mod themes;
mod thumbs;
mod p3t;
mod users;
mod net;
mod accounts;
mod trophies;
mod trophypop;
mod steamfriends;
mod cachesweep;
#[cfg(test)]
mod cache_tests;
#[cfg(test)]
mod system_tests;
#[cfg(test)]
mod campaign_tests;
#[cfg(test)]
mod resilience_tests;

use models::{
    Game, LaunchResult, MediaItem, PsnAccount, PsnFile, Settings, User, UsersFile,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

// ----------------------------- PSN avatars --------------------------------

/// The pictures in content/Avatars/PSN, newest file first (read at startup,
/// so new avatars only need a restart): { dir, files }.
#[tauri::command(async)]
fn list_psn_avatars(app: AppHandle) -> serde_json::Value {
    let dir = paths::psn_avatars_dir(&app);
    let mut v: Vec<(std::time::SystemTime, String)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_file() { continue; }
            let Some(name) = p.file_name().and_then(|n| n.to_str()).map(|n| n.to_string()) else { continue };
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
            if name.starts_with('.') || !["png", "jpg", "jpeg", "gif", "webp", "bmp"].contains(&ext.as_str()) { continue; }
            let t = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            v.push((t, name));
        }
    }
    v.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));   // newest first
    serde_json::json!({ "dir": dir.to_string_lossy(), "files": v.into_iter().map(|(_, n)| n).collect::<Vec<_>>() })
}

// ----------------------------- library ------------------------------------

/// The game source folders read as "Separate Apps" (settings.gameSourceModes:
/// { "<folder>": "apps" }); the rest are "Games in Folders".
fn app_sources(s: &models::Settings) -> Vec<String> {
    s.extra.get("gameSourceModes").and_then(|v| v.as_object())
        .map(|m| m.iter().filter(|(_, v)| v.as_str() == Some("apps")).map(|(k, _)| k.clone()).collect())
        .unwrap_or_default()
}

#[tauri::command(async)]
fn scan_library(app: AppHandle) -> Vec<Game> {
    let s = current_settings(&app);
    // games in the source folders: new ones get their folder first, so a game
    // added while the app runs shows when the Game column is next opened
    if !s.game_sources.is_empty() && sync_due("games") {
        // (only found: their art comes from Steam Game Art Scraping and Game Art Database Scraping)
        gamesrc::sync_modes(&s.game_sources, &app_sources(&s), &paths::games_dir(&app), &paths::game_sources_file(&app), audio::ffmpeg_path(&app).as_deref(), &|_, _| {});
    }
    // PS3 games put into the Games folder by hand: their media and RPCS3
    if sync_due("ps3") {
        gamesrc::fill_ps3_folders(&paths::games_dir(&app), &paths::game_sources_file(&app), audio::ffmpeg_path(&app).as_deref());
    }
    // shortcuts put loose into the Games folder get their own folder
    library::wrap_loose_shortcuts(&paths::games_dir(&app));
    library::scan(&s.library_paths, Some(&paths::shortcut_icons_dir(&app)))
}

/// Game Settings: change keys of one game's game.json. Setting isDisc on
/// turns it off for every other game (only one disc at a time).
#[tauri::command(async)]
fn game_meta_save(app: AppHandle, folder: String, patch: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&folder);
    if !dir.is_dir() { return Err("game folder not found".into()); }
    if patch.get("isDisc").and_then(|v| v.as_bool()) == Some(true) {
        let s = current_settings(&app);
        for g in library::scan(&s.library_paths, None) {
            if g.is_disc && !std::path::Path::new(&g.folder).eq(dir.as_path()) {
                let _ = library::patch_meta(std::path::Path::new(&g.folder), &[("isDisc", serde_json::Value::Bool(false))]);
            }
        }
    }
    let kv: Vec<(&str, serde_json::Value)> = patch.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
    library::patch_meta(&dir, &kv).map_err(|e| e.to_string())
}

/// The game menu's Delete: removes a game's folder (only inside the Games folder).
#[tauri::command(async)]
fn game_delete(app: AppHandle, folder: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&folder).canonicalize().map_err(|e| e.to_string())?;
    let root = paths::games_dir(&app).canonicalize().map_err(|e| e.to_string())?;
    if !p.starts_with(&root) || p == root || !p.is_dir() { return Err("only games in the Games folder can be deleted".into()); }
    std::fs::remove_dir_all(&p).map_err(|e| e.to_string())
}

/// Find games in the source folders now; returns how many were added. (Only found: their art
/// comes from Game Settings > Steam Game Art Scraping and Game Art Database Scraping.)
#[tauri::command(async)]
fn game_sources_sync(app: AppHandle) -> usize {
    let s = current_settings(&app);
    gamesrc::sync_modes(&s.game_sources, &app_sources(&s), &paths::games_dir(&app), &paths::game_sources_file(&app), audio::ffmpeg_path(&app).as_deref(), &progress_fn(&app, "games")).len()
}

/// The shape (width / height) of the app's picture: Display Settings >
/// Resolution, or with Native the screen the app is on.
fn screen_ratio(app: &AppHandle) -> f64 {
    let r = current_settings(app).behavior.resolution;
    if let Some((w, h)) = r.split_once('x') {
        if let (Ok(w), Ok(h)) = (w.trim().parse::<f64>(), h.trim().parse::<f64>()) { if h > 0.0 { return w / h; } }
    }
    app.get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .map(|m| { let s = m.size(); s.width as f64 / s.height.max(1) as f64 })
        .unwrap_or(16.0 / 9.0)
}
/// The games Steam's pictures were put in for once (gameart::steam_standin).
fn steam_art_done_file(app: &AppHandle) -> std::path::PathBuf { paths::data_dir(app).join("steam_art5.json") }
/// The games looked up online, as they were then (gameart::lookup_done).
fn lookups_file(app: &AppHandle) -> std::path::PathBuf { paths::data_dir(app).join("game_lookups.json") }
/// The game folders in the Games folder, in order.
fn game_folders(app: &AppHandle) -> Vec<std::path::PathBuf> {
    let mut out: Vec<std::path::PathBuf> = std::fs::read_dir(paths::games_dir(app)).into_iter().flatten().flatten().map(|e| e.path()).filter(|d| d.is_dir()).collect();
    out.sort();
    out
}
/// While Steam Game Art Scraping or Game Art Database Scraping runs: a missing icon, background
/// or banner is looked for again, even one removed before (gameart::may_fill).
struct Filling;
impl Filling { fn on() -> Self { gameart::set_fill_missing(true); Filling } }
impl Drop for Filling { fn drop(&mut self) { gameart::set_fill_missing(false); } }

/// Game Settings > Steam Game Art Scraping: Steam's pictures (gameart::steam_standin) for every
/// game in the Games folder recognized as a Steam game -- never a PS3 game or PlayStation®Home --
/// that has no icon, background or Trophy Collection banner, or whose icon or background is its
/// program's own or the game databases' (Steam's take their place); one chosen by you, a PS3
/// game's own or Steam's stays. A game unchanged since Steam was last asked about it isn't asked
/// again. Reports progress ("scrape"); how many got any. The folders that changed are told to the
/// page ("game-art-changed").
#[tauri::command(async)]
fn game_art_steam(app: AppHandle) -> Result<usize, String> {
    if !net::online() { return Err("No internet connection.".into()); }
    let _fill = Filling::on();
    let (root, done, looked) = (paths::content_root(&app), steam_art_done_file(&app), lookups_file(&app));
    let none = std::collections::HashSet::new();
    let games: Vec<std::path::PathBuf> = game_folders(&app).into_iter()
        .filter(|d| gameart::steam_art_wanted(d, true, &Default::default(), &none) && (gameart::banner_due(d) || !gameart::lookup_unchanged(&looked, d, None))).collect();
    let progress = progress_fn(&app, "scrape");
    progress(0, games.len());
    let (mut got, mut asked, mut changed) = (0, Vec::new(), Vec::new());
    for (i, dir) in games.iter().enumerate() {
        if !net::online() { break; }
        // (looked for again however many times it was before)
        gameart::standin_unmark(&done, dir);
        let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        match trophies::steam_art_app(&app, dir) {
            Ok(Some(id)) => { if gameart::steam_standin(&root, &done, dir, &id) { got += 1; changed.push(dir.display().to_string()); } if net::online() { asked.push(dir.clone()); } }
            Ok(None) => {
                asked.push(dir.clone());
                crate::log::line("INFO", "gameart", &format!("Steam pictures for {name}: no Steam game by its name"));
                gameart::standin_mark_done(&done, dir);
                // (and no banner of Steam's to put in Trophy Collection: its icon is shown there)
                gameart::banner_looked(dir);
            }
            Err(()) => crate::log::line("WARN", "gameart", &format!("Steam pictures for {name}: Steam's store didn't answer")),
        }
        progress(i + 1, games.len());
    }
    // (the games Steam was asked about: kept as they are after it, so an unchanged one isn't asked again)
    gameart::lookup_done(&looked, &asked, &[], &gameart::lookup_setup(&current_settings(&app).scrape));
    if !changed.is_empty() { let _ = app.emit("game-art-changed", changed); }
    Ok(got)
}

/// Game Settings > Game Art Databases > Game Art Database Scraping: the art and full name of
/// every game in the Games folder from the game databases set up (gameart::scrape): a game with
/// no icon, or only its program's own, gets one; one with no background gets one (and a video,
/// with none); one with both of its own is skipped (gameart::needs_db_art). Nothing chosen by you,
/// a PS3 game's own or Steam's is replaced. A game unchanged since the same databases were last
/// asked about it isn't asked again. Reports progress ("scrape"); how many got anything.
#[tauri::command(async)]
fn game_art_db(app: AppHandle) -> Result<usize, String> {
    let s = current_settings(&app).scrape;
    if !s.any_key() { return Err("No game database is set up (Game Settings > Game Art Databases).".into()); }
    if !net::online() { return Err("No internet connection.".into()); }
    let _fill = Filling::on();
    let ff = audio::ffmpeg_path(&app);
    let (looked, setup) = (lookups_file(&app), gameart::lookup_setup(&s));
    let games: Vec<std::path::PathBuf> = game_folders(&app).into_iter()
        .filter(|d| gameart::needs_db_art(d, ff.is_some()) && !gameart::lookup_unchanged(&looked, d, Some(&setup))).collect();
    let progress = progress_fn(&app, "scrape");
    progress(0, games.len());
    let (mut got, mut asked, mut changed) = (0, Vec::new(), Vec::new());
    for (i, dir) in games.iter().enumerate() {
        let term = std::fs::read_to_string(library::meta_path(dir)).ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v["title"].as_str().map(str::to_string))
            .unwrap_or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        let r = gameart::scrape(dir, &term, &s, ff.as_deref(), false, screen_ratio(&app));
        if r.message == "No internet connection." { break; }
        if r.message.is_empty() { got += 1; changed.push(dir.display().to_string()); }
        // (asked: something found, or nothing -- the internet still there, so it was asked)
        if (r.message.is_empty() || r.message == "Nothing was found for this game.") && net::online() { asked.push(dir.clone()); }
        progress(i + 1, games.len());
    }
    gameart::lookup_done(&looked, &[], &asked, &setup);
    if !changed.is_empty() { let _ = app.emit("game-art-changed", changed); }
    Ok(got)
}

/// Game Settings > Icon / Background / Video / Music: use `path` (None removes it).
#[tauri::command(async)]
fn game_media_set(folder: String, kind: String, path: Option<String>) -> Result<(), String> {
    let dir = std::path::Path::new(&folder);
    gameart::set_media(dir, &kind, path.as_deref().map(std::path::Path::new))?;
    // (yours now: nothing found later takes its place, a removed one stays removed)
    gameart::mark_source(dir, &kind, gameart::SRC_USER);
    Ok(())
}

/// Game Settings > Get Art Online: the game databases, replacing what it has.
#[tauri::command(async)]
fn game_scrape(app: AppHandle, folder: String, title: String) -> gameart::ScrapeResult {
    let s = current_settings(&app).scrape;
    let ff = audio::ffmpeg_path(&app);
    gameart::scrape(std::path::Path::new(&folder), &title, &s, ff.as_deref(), true, screen_ratio(&app))
}

/// A game renamed by hand (Game Settings > Title): looked up again under its new name, its
/// art in the game databases and its trophies' source -- only a game known by its name
/// alone (one with IDs of its own, a Steam emulator's or Steam's files, a store's files or a
/// PS3 game's data is found by those, whatever it's called). What's found replaces what the
/// lookups had given it; with nothing found, or the same, it keeps what it has. Without
/// the internet it waits (content\data\renamed_pending.json) for a start with it.
/// "id": known by more than its name, nothing to do; "pending": waiting for the internet;
/// "art": new art was put in; "done": looked up, its art as it was.
#[tauri::command(async)]
fn game_renamed(app: AppHandle, user: String, folder: String, title: String, launch: String) -> String {
    let g = trophies::GameRef { folder: folder.clone(), title: title.clone(), launch, stamp: String::new() };
    let file = paths::data_dir(&app).join("renamed_pending.json");
    if trophies::known_without_name(&app, &user, &g) { renamed_pending_set(&file, &folder, false); return "id".into(); }
    if !net::online() { renamed_pending_set(&file, &folder, true); return "pending".into(); }
    renamed_pending_set(&file, &folder, false);
    trophies::renamed(&folder);
    let s = current_settings(&app).scrape;
    let dir = std::path::Path::new(&folder);
    if !s.any_key() || !dir.is_dir() { return "done".into(); }
    let r = gameart::scrape_renamed(dir, &title, &s, audio::ffmpeg_path(&app).as_deref(), screen_ratio(&app));
    if r.icon || r.background || r.preview { "art".into() } else { "done".into() }
}
/// Game Settings > Title changed: the game's own folder in content\Games takes the name typed
/// (the characters a folder can't have left out; a name another game's folder has: " (2)"...),
/// and everything that names the folder follows it (the recognized games' list, Steam's pictures'
/// and the renamed games' lists, the trophies' kept source and list). Its new path; the same
/// one when nothing had to change (or it couldn't be renamed: in use, say).
#[tauri::command(async)]
fn game_folder_rename(app: AppHandle, folder: String, title: String) -> Result<String, String> {
    let dir = std::path::PathBuf::from(&folder);
    if !dir.is_dir() { return Err("game folder not found".into()); }
    let cur = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let key = |p: &std::path::Path| p.display().to_string().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let target = match gamesrc::rename_game_folder(&dir, &title) {
        Ok(Some(t)) => t,
        Ok(None) => return Ok(folder),
        Err(e) => {
            log::line("WARN", "games", &format!("the folder of \"{}\" couldn't take its new name: {e}", title.chars().take(80).collect::<String>()));
            return Ok(folder);
        }
    };
    let new = target.display().to_string();
    gamesrc::folder_renamed(&paths::game_sources_file(&app), &folder, &new);
    for f in [steam_art_done_file(&app), paths::data_dir(&app).join("renamed_pending.json")] {
        let Ok(t) = std::fs::read_to_string(&f) else { continue };
        let Ok(mut l) = serde_json::from_str::<Vec<String>>(&t) else { continue };
        let mut changed = false;
        for x in l.iter_mut() { if key(std::path::Path::new(x.as_str())) == key(&dir) { *x = new.clone(); changed = true; } }
        if changed { let _ = std::fs::write(&f, serde_json::to_string(&l).unwrap_or_default()); }
    }
    trophies::folder_renamed(&app, &folder, &new);
    log::line("INFO", "games", &format!("a game's folder renamed: \"{cur}\" -> \"{}\"", target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
    Ok(new)
}
/// Whether a game is told apart by more than its name (its own IDs, a Steam emulator's or
/// Steam's files, a store's files, a PS3 game's data): renaming it changes nothing then.
#[tauri::command(async)]
fn game_known_by_id(app: AppHandle, user: String, folder: String, title: String, launch: String) -> bool {
    trophies::known_without_name(&app, &user, &trophies::GameRef { folder, title, launch, stamp: String::new() })
}
/// The games renamed while there was no internet, looked up now that there is (at a start):
/// the folders of the ones done (none without the internet: they keep waiting).
#[tauri::command(async)]
fn game_renamed_pending(app: AppHandle, user: String) -> Vec<String> {
    let file = paths::data_dir(&app).join("renamed_pending.json");
    let list = renamed_pending(&file);
    if list.is_empty() || !net::online() { return Vec::new(); }
    let mut done = Vec::new();
    for folder in list {
        let dir = std::path::PathBuf::from(&folder);
        if !dir.is_dir() { renamed_pending_set(&file, &folder, false); continue; }
        let meta: serde_json::Value = std::fs::read_to_string(library::meta_path(&dir)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let title = meta["title"].as_str().map(str::to_string).unwrap_or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        let r = game_renamed(app.clone(), user.clone(), folder.clone(), title, String::new());
        if r != "pending" { done.push(folder); }
    }
    done
}
fn renamed_pending(file: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok()).unwrap_or_default()
}
fn renamed_pending_set(file: &std::path::Path, folder: &str, on: bool) {
    let mut list = renamed_pending(file);
    let had = list.iter().any(|f| f == folder);
    if on == had { return; }
    if on { list.push(folder.to_string()); } else { list.retain(|f| f != folder); }
    if list.is_empty() { let _ = std::fs::remove_file(file); return; }
    if let Some(d) = file.parent() { let _ = std::fs::create_dir_all(d); }
    let tmp = file.with_extension("tmp");
    if std::fs::write(&tmp, serde_json::to_string(&list).unwrap_or_default()).is_ok() { let _ = std::fs::rename(&tmp, file); }
}

/// Games created from the source folders (for the settings list).
#[tauri::command(async)]
fn game_sources_detected(app: AppHandle) -> Vec<gamesrc::Detected> {
    gamesrc::list_detected(&paths::game_sources_file(&app))
}

/// Delete a game created from a source folder (it won't be created again).
#[tauri::command(async)]
fn game_sources_delete(app: AppHandle, folder: String) -> Result<(), String> {
    gamesrc::delete_detected(&paths::game_sources_file(&app), &paths::games_dir(&app), &folder)
}

/// A source folder was removed: delete the game folders made from it.
#[tauri::command(async)]
fn game_sources_remove(app: AppHandle, source: String) -> usize {
    gamesrc::remove_source(&paths::game_sources_file(&app), &paths::games_dir(&app), &source)
}

/// A source folder added: its games whose folders are gone are made again (see gamesrc).
#[tauri::command(async)]
fn game_sources_added(app: AppHandle, source: String) -> usize {
    gamesrc::source_added(&paths::game_sources_file(&app), &source)
}

/// Native folder picker; None when cancelled.
#[tauri::command(async)]
fn pick_folder(app: AppHandle, title: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut d = app.dialog().file().set_title(title);
    if let Some(w) = app.get_webview_window("main") { d = d.set_parent(&w); }
    let _pointer = browser::picker_pointer(&app);   // the controller works as the mouse
    let path = d.blocking_pick_folder();
    focus::bring_to_front(&app);   // back in front, so the controller keeps working
    path?.into_path().ok().map(|p| p.display().to_string())
}

/// A custom section's subsection: everything recognised in its folders.
#[tauri::command(async)]
fn section_list(app: AppHandle, folders: Vec<String>) -> Vec<sections::SectionEntry> {
    let icons = paths::shortcut_icons_dir(&app);
    let covers = paths::covers_dir(&app);
    let ff = audio::ffmpeg_path(&app);
    let vi = |p: &std::path::Path| (video::icon_for(&app, p), video::clip_for(&app, p));
    let content = paths::content_root(&app);
    let ctx = sections::Ctx { icon_cache: &icons, covers: &covers, ffmpeg: ff.as_deref(), video_icon: &vi, wrap_in: Some(&content) };
    sections::list(&folders, &ctx)
}

/// Folders added to custom sections: the new items in them get their item
/// folders in the section's folder (see sections::sync_sources). Returns how
/// many were made.
#[tauri::command(async)]
fn section_sources_sync(app: AppHandle, sources: Vec<sections::SourceOpts>) -> usize {
    let content = paths::content_root(&app);
    sections::sync_sources(&sources, &content, &paths::data_dir(&app).join("section_sources.json"))
}
/// A folder removed from a section (or read differently now): the items made
/// from it are deleted from the section's folder (the folder itself isn't touched).
#[tauri::command(async)]
fn section_sources_remove(app: AppHandle, source: String, dest: String) -> usize {
    let content = paths::content_root(&app);
    sections::remove_source(&source, &dest, &content, &paths::data_dir(&app).join("section_sources.json"))
}

/// The PS3's own files (lines.qrc, canyon.qrc, earth.qrc): put in
/// src-tauri/resources/ps3 they're part of the build, like ffmpeg. Looked for in the app's resources, then next to the program.
/// None: not there (only these names are answered).
#[tauri::command]
fn ps3_file(app: AppHandle, name: String) -> Option<String> {
    let mut dirs = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        dirs.push(res.join("resources").join("ps3"));
        dirs.push(res.join("ps3"));
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|c| c.parent().map(|p| p.to_path_buf())) {
        dirs.push(dir.join("resources").join("ps3"));
    }
    // (running from source, not built: src-tauri/resources/ps3 itself, where
    // they're put, so they're found without building again; src-tauri/ps3 too)
    #[cfg(debug_assertions)]
    {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        dirs.insert(0, src.join("resources").join("ps3"));
        dirs.push(src.join("ps3"));
    }
    find_ps3_file(&dirs, &name)
}
/// The first of `dirs` that has the PS3 file `name` (only the known names).
fn find_ps3_file(dirs: &[std::path::PathBuf], name: &str) -> Option<String> {
    const KNOWN: [&str; 3] = ["lines.qrc", "canyon.qrc", "earth.qrc"];
    if !KNOWN.contains(&name) {
        return None;
    }
    dirs.iter().map(|d| d.join(name)).find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
}
#[cfg(test)]
#[test]
fn ps3_files_found_in_any_permutation() {
    let root = std::env::temp_dir().join(format!("xmb_ps3files_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (a, b) = (root.join("res/resources/ps3"), root.join("exe/resources/ps3"));
    std::fs::create_dir_all(&a).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    let dirs = vec![a.clone(), root.join("res/ps3"), b.clone()];
    let names = ["lines.qrc", "canyon.qrc", "earth.qrc"];
    // every combination of the three files, in either place
    for mask in 0..8u32 {
        for (i, n) in names.iter().enumerate() {
            let _ = std::fs::remove_file(a.join(n));
            let _ = std::fs::remove_file(b.join(n));
            if mask & (1 << i) != 0 { std::fs::write(if i % 2 == 0 { a.join(n) } else { b.join(n) }, b"x").unwrap(); }
        }
        for (i, n) in names.iter().enumerate() {
            let found = find_ps3_file(&dirs, n);
            assert_eq!(found.is_some(), mask & (1 << i) != 0, "mask {mask} {n}");
        }
    }
    // (only the PS3 files: nothing else is answered)
    std::fs::write(a.join("other.txt"), b"x").unwrap();
    assert!(find_ps3_file(&dirs, "other.txt").is_none());
    assert!(find_ps3_file(&dirs, "../ps3/lines.qrc").is_none());
    // (custom_render_plugin is no longer used)
    std::fs::write(a.join("custom_render_plugin.prx"), b"x").unwrap();
    assert!(find_ps3_file(&dirs, "custom_render_plugin.prx").is_none());
    let _ = std::fs::remove_dir_all(&root);
}

/// Whether the System can save in its own folder (installed in Program Files,
/// with the .msi, it can't): it keeps everything in its content folder.
#[tauri::command(async)]
fn content_writable(app: AppHandle) -> serde_json::Value {
    let dir = paths::content_root(&app);
    let data = dir.join("data");
    let test = data.join(".write_test");
    let ok = std::fs::create_dir_all(&data).is_ok() && std::fs::write(&test, b"x").is_ok();
    let _ = std::fs::remove_file(&test);
    if !ok { crate::log::line("ERROR", "system", &format!("can't save in {}", dir.display())); }
    serde_json::json!({ "ok": ok, "dir": dir.display().to_string() })
}

/// Create (if needed) content/<section> or content/<section>/<sub> and return it.
#[tauri::command(async)]
fn section_folder(app: AppHandle, section: String, sub: Option<String>) -> Result<String, String> {
    let mut p = paths::content_root(&app).join(sections::safe_name(&section));
    if let Some(s) = sub.filter(|s| !s.trim().is_empty()) { p = p.join(sections::safe_name(&s)); }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p.display().to_string())
}

/// Delete a custom section's folder (content/<section>) or one of its
/// subsection folders (content/<section>/<sub>) with everything in it.
#[tauri::command(async)]
fn section_delete_folder(app: AppHandle, section: String, sub: Option<String>) -> Result<bool, String> {
    let root = paths::content_root(&app);
    let mut p = root.join(sections::safe_name(&section));
    if let Some(s) = sub.filter(|s| !s.trim().is_empty()) { p = p.join(sections::safe_name(&s)); }
    // never anything outside the content folder, nor one of the system's own folders
    let reserved = ["Games", "Music", "Photos", "Videos", "Subtitles", "Themes", "Fonts", "Browser", "data"];
    if p == root || !p.starts_with(&root) || reserved.iter().any(|r| p == root.join(r)) { return Err("not a section folder".into()); }
    if !p.exists() { return Ok(false); }
    std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Does this picture have see-through parts? (A section icon with a
/// transparent background can take the Icon Color and Icon Style; a picture
/// without one would become a solid square, so it's shown as it is.)
#[tauri::command(async)]
fn image_has_alpha(path: String) -> bool {
    let p = std::path::Path::new(&path);
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" => (|| -> Option<bool> {
            let mut d = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(p).ok()?));
            d.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
            let mut r = d.read_info().ok()?;
            let mut buf = vec![0; r.output_buffer_size()];
            let info = r.next_frame(&mut buf).ok()?;
            let ch = match info.color_type { png::ColorType::Rgba => 4, png::ColorType::GrayscaleAlpha => 2, _ => return Some(false) };
            Some(buf[..info.buffer_size()].chunks(ch).any(|px| px[ch - 1] < 250))
        })().unwrap_or(false),
        "gif" => true,
        "webp" => std::fs::read(p).ok().map(|b| {
            // lossless (VP8L) or extended with the alpha flag (VP8X)
            b.len() > 21 && (&b[12..16] == b"VP8L" || (&b[12..16] == b"VP8X" && b[20] & 0x10 != 0))
        }).unwrap_or(false),
        _ => false,
    }
}

/// Theme Settings > Font: the fonts in the content Fonts folder.
#[tauri::command(async)]
fn list_fonts(app: AppHandle) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(paths::fonts_dir(&app)).into_iter().flatten().flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| matches!(x.to_string_lossy().to_lowercase().as_str(), "ttf" | "otf" | "woff" | "woff2")).unwrap_or(false))
        .map(|p| p.display().to_string()).collect();
    v.sort_by_key(|s| s.to_lowercase());
    v
}

/// Theme Settings > Font > Choose Font File…
#[tauri::command(async)]
fn pick_font(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut d = app.dialog().file().set_title("Choose a Font").add_filter("Fonts", &["ttf", "otf", "woff", "woff2"]);
    if let Some(w) = app.get_webview_window("main") { d = d.set_parent(&w); }
    let _pointer = browser::picker_pointer(&app);   // the controller works as the mouse
    let path = d.blocking_pick_file();
    focus::bring_to_front(&app);
    path?.into_path().ok().map(|p| p.display().to_string())
}

/// Any single file (Game Settings: icon, background, video, music).
#[tauri::command(async)]
fn pick_file(app: AppHandle, title: String, name: String, exts: Vec<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let e: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
    let mut d = app.dialog().file().set_title(title);
    if !e.is_empty() { d = d.add_filter(name, &e); }
    if let Some(w) = app.get_webview_window("main") { d = d.set_parent(&w); }
    let _pointer = browser::picker_pointer(&app);
    let path = d.blocking_pick_file();
    focus::bring_to_front(&app);
    path?.into_path().ok().map(|p| p.display().to_string())
}

// (on a thread of its own, not the window's: a game that must run as administrator waits
// there for the answer to Windows' prompt, launcher.rs run_as_admin)
#[tauri::command(async)]
fn launch_game(app: AppHandle, folder: String, launch: String, args: Vec<String>, program: Option<bool>) -> LaunchResult {
    // the game's window may take the focus once it opens (the app keeps
    // showing black, silent, until then)
    #[cfg(windows)]
    launcher::allow_game_foreground();
    let r = launcher::launch(&folder, &launch, &args);
    // (in the log: what was started, or why it couldn't be)
    let name = std::path::Path::new(&folder).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if r.ok { log::line("INFO", "game", &format!("started \"{name}\" ({launch}), pid {:?}", r.pid)); if let Some(p) = r.pid { launcher::note_quick_exit(p, name.clone()); } }
    else { log::line("WARN", "game", &format!("\"{name}\" couldn't be started ({launch}): {}", r.message)); }
    if r.ok {
        // (the game played, for a window made anew after it: focus.rs resume_after_game)
        focus::set_last_game(&folder);
        // its trophies are watched closely while it runs
        trophies::set_running(&app, Some(folder.clone()));
        // game mode: the app idles until the game has ended, then comes back by itself
        // (a game started through its launcher: followed by its own folder,
        // and not by Battle.net, which keeps running after the game ends)
        let meta: serde_json::Value = std::fs::read_to_string(std::path::Path::new(&folder).join("game.json")).ok()
            .and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let store = meta["store"].as_str().unwrap_or("");
        let game_dir = meta["sourceDir"].as_str().map(std::path::PathBuf::from).filter(|d| !store.is_empty() && d.is_dir());
        let pid = if store == "Battle.net" { None } else { r.pid };
        // (a program from a custom section keeps the app's screen showing: the
        // page is hidden only while a game runs)
        focus::watch_game(app, pid, game_dir.or_else(|| launcher::watch_dir(&folder, &launch)), !program.unwrap_or(false));
    }
    r
}

/// The app is back from a game (the user returned to it some other way).
#[tauri::command]
fn game_mode_end(app: AppHandle) { focus::page_answered(); focus::set_in_game(false); focus::repair_window(&app); }

// ------------------------------ users -------------------------------------

#[tauri::command]
fn list_users(app: AppHandle) -> UsersFile {
    users::load(&paths::users_file(&app))
}

#[tauri::command]
fn create_user(app: AppHandle, name: String, avatar: String) -> Result<User, String> {
    users::create(&paths::users_file(&app), &name, &avatar)
}

/// Persist a full user object (per-user theme, psn link, prefs).
#[tauri::command]
fn save_user(app: AppHandle, user: User) -> Result<(), String> {
    users::save_user(&paths::users_file(&app), user)
}

#[tauri::command]
fn delete_user(app: AppHandle, id: String) -> Result<(), String> {
    users::delete(&paths::users_file(&app), &id)?;
    // (what was kept of the user's accounts, trophies and Steam Friends goes with them)
    let a = app.clone();
    std::thread::spawn(move || {
        accounts::forget_user(&a, &id);
        trophies::forget_user_files(&a, &id);
        steamfriends::forget_user_files(&a, &id);
        steamfriends::prune_own(&a);
    });
    Ok(())
}

#[tauri::command]
fn set_active_user(app: AppHandle, id: String) -> Result<(), String> {
    users::set_active(&paths::users_file(&app), &id)
}

// -------------------------- psn accounts ----------------------------------

#[tauri::command]
fn list_psn_accounts(app: AppHandle) -> PsnFile {
    psn::load(&paths::psn_file(&app))
}

#[tauri::command]
fn save_psn_account(app: AppHandle, account: PsnAccount) -> Result<PsnAccount, String> {
    psn::save_account(&paths::psn_file(&app), account)
}

// ----------------------------- settings -----------------------------------

#[tauri::command]
fn get_settings(app: AppHandle) -> Settings {
    current_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    thumbs::IN_APP_DIR.store(settings.behavior.cache_in_app_dir, std::sync::atomic::Ordering::Relaxed);
    apply_autostart(&app, settings.behavior.autostart);
    apply_fullscreen(&app, settings.behavior.fullscreen);
    settings::save(&paths::settings_file(&app), &settings)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enable: bool) -> Result<(), String> {
    apply_autostart(&app, enable);
    Ok(())
}

#[tauri::command]
fn set_fullscreen(app: AppHandle, enable: bool) {
    apply_fullscreen(&app, enable);
}

/// Windowed mode: size the window's inside to `width` x `height` pixels
/// (shrunk, keeping the ratio, if it doesn't fit the monitor) and centre it.
#[tauri::command]
fn set_window_resolution(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no window")?;
    if w.is_fullscreen().unwrap_or(false) || width == 0 || height == 0 { return Ok(()); }
    let (mut tw, mut th) = (width as f64, height as f64);
    if let Ok(Some(m)) = w.current_monitor() {
        let area = m.size();
        // leave room for the title bar and taskbar
        let (mw, mh) = (area.width as f64 * 0.97, area.height as f64 * 0.9);
        let k = (mw / tw).min(mh / th).min(1.0);
        tw *= k; th *= k;
    }
    let _ = w.unmaximize();
    w.set_size(tauri::PhysicalSize::new(tw.round() as u32, th.round() as u32)).map_err(|e| e.to_string())?;
    let _ = w.center();
    Ok(())
}

// ------------------------------ themes ------------------------------------

/// The PS3 themes (.p3t) in the Themes folder, unpacked (the first time) for use.
#[tauri::command(async)]
fn themes_p3t(app: AppHandle) -> Vec<serde_json::Value> {
    themes::list_p3t(&paths::themes_dir(&app), &paths::p3t_cache_dir(&app))
}

/// The Custom Themes (.zip) in the Themes folder.
#[tauri::command(async)]
fn themes_custom(app: AppHandle) -> Vec<serde_json::Value> {
    themes::list_custom(&paths::themes_dir(&app), &paths::custom_theme_cache_dir(&app))
}

/// Make a Custom Theme (.zip in the Themes folder) from the settings and the
/// files they use: `files` maps the path in the zip to the file on disk.
#[tauri::command(async)]
/// `p3t`: the folder of the PS3 theme (unpacked) whose background / overlay it
/// keeps, all of it going in the zip's p3t/ folder.
fn custom_theme_create(app: AppHandle, name: String, settings: serde_json::Value, files: std::collections::HashMap<String, String>, p3t: Option<String>) -> Result<String, String> {
    let mut list: Vec<(String, std::path::PathBuf)> = files.into_iter().map(|(k, v)| (k, std::path::PathBuf::from(v))).collect();
    if let Some(d) = p3t { list.extend(themes::p3t_folder_files(std::path::Path::new(&d))); }
    themes::create_custom(&paths::themes_dir(&app), &name, &settings, &list).map(|p| p.display().to_string())
}

/// A Custom Theme's Delete Theme: its .zip (only one in the Themes folder) deleted; its unpacked
/// copy goes at the next listing (themes::list_custom).
#[tauri::command(async)]
fn custom_theme_delete(app: AppHandle, file: String) -> Result<(), String> {
    let root = paths::themes_dir(&app).canonicalize().map_err(|e| e.to_string())?;
    let p = std::path::PathBuf::from(&file).canonicalize().map_err(|e| e.to_string())?;
    let zip = p.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false);
    if !zip || !p.is_file() || !p.starts_with(&root) { return Err("only a Custom Theme in the Themes folder can be deleted".into()); }
    std::fs::remove_file(&p).map_err(|e| e.to_string())
}

/// Put everything a PS3 theme has into content/Themes Extracted/<its name>.
#[tauri::command(async)]
fn theme_extract(app: AppHandle, dir: String, name: String) -> Result<String, String> {
    themes::extract_p3t(std::path::Path::new(&dir), &paths::theme_extraction_dir(&app), &name).map(|p| p.display().to_string())
}

/// The Icon Themes in the Icon folder.
#[tauri::command(async)]
fn themes_icon(app: AppHandle) -> Vec<serde_json::Value> {
    themes::list_icon_themes(&paths::icon_themes_dir(&app))
}

/// The Sound Effects packs in the Sound Effects folder.
#[tauri::command(async)]
fn themes_sound(app: AppHandle) -> Vec<serde_json::Value> {
    themes::list_sound_packs(&paths::sound_effects_dir(&app))
}

// ------------------------------ media -------------------------------------

/// A long job's progress for the screen that waits on it ("op": what runs).
fn progress_fn(app: &AppHandle, op: &str) -> impl Fn(usize, usize) {
    // at most ~12 updates a second (and always the first and the last)
    let a = app.clone(); let op = op.to_string();
    let last = std::sync::Mutex::new(None::<std::time::Instant>);
    move |done, total| {
        let mut l = last.lock().unwrap_or_else(|e| e.into_inner());
        let now = std::time::Instant::now();
        if done > 0 && done < total && l.map(|t| now.duration_since(t).as_millis() < 80).unwrap_or(false) { return; }
        *l = Some(now);
        let _ = a.emit("xmb-progress", serde_json::json!({ "op": op, "done": done, "total": total }));
    }
}

/// The app's own folder for a media kind, and the source folders feeding it.
fn media_dirs(app: &AppHandle, kind: &str) -> (std::path::PathBuf, Vec<String>) {
    let s = current_settings(app);
    match kind {
        "music" => (paths::music_dir(app), s.media_folders.music.clone()),
        "photo" => (paths::photos_dir(app), s.media_folders.photos.clone()),
        "video" => (paths::videos_dir(app), s.media_folders.videos.clone()),
        _ => (paths::subtitles_dir(app), s.media_folders.subtitles.clone()),
    }
}

fn sync_due(kind: &str) -> bool {
    use std::sync::{Mutex, OnceLock};
    static LAST: OnceLock<Mutex<std::collections::HashMap<String, std::time::Instant>>> = OnceLock::new();
    let mut m = LAST.get_or_init(|| Mutex::new(Default::default())).lock().unwrap_or_else(|e| e.into_inner());
    let now = std::time::Instant::now();
    if m.get(kind).map(|t| now.duration_since(*t).as_secs() < 8).unwrap_or(false) { return false; }
    m.insert(kind.to_string(), now);
    true
}

/// Music / Photos / Videos: the app's folder (files and shortcuts). New files
/// in the source folders get their shortcuts first, so what was added shows
/// without a restart. Runs off the main thread; tags etc. are only read for
/// files that are new or changed (see medialib).
#[tauri::command(async)]
fn list_media(app: AppHandle, kind: String) -> Vec<MediaItem> {
    let index = paths::data_dir(&app).join("media_index.json");
    let record = paths::data_dir(&app).join("media_links.json");
    let covers = paths::covers_dir(&app);
    let ffmpeg = if kind == "music" { audio::ffmpeg_path(&app) } else { None };
    let ex = medialib::Extras { ffmpeg: ffmpeg.as_deref(), covers: if kind == "music" { Some(&covers) } else { None } };
    let none = |_: usize, _: usize| {};
    match kind.as_str() {
        "music" | "photo" | "video" => {
            let (dir, sources) = media_dirs(&app, &kind);
            // the source folders are looked through at most every few seconds
            // (a column opened twice in a row doesn't walk them twice)
            if !sources.is_empty() && sync_due(&kind) { medialib::sync_links(&kind, &sources, &dir, &record, &none); }
            let mut items = medialib::list(&[dir], &kind, &index, &ex, &none);
            if kind == "video" {
                // the icon picked with "Change Icon" in the video player
                for it in items.iter_mut() {
                    it.cover = video::icon_for(&app, std::path::Path::new(&it.path));
                    it.clip = video::clip_for(&app, std::path::Path::new(&it.path));
                }
            }
            items
        }
        // backgrounds / overlays come from the Photos and Videos folders
        "background" => {
            let mut v = medialib::list(&[paths::photos_dir(&app)], "photo", &index, &ex, &none);
            // (videos with their "Change Icon" picture, for the pickers' squares)
            v.extend(medialib::list(&[paths::videos_dir(&app)], "video", &index, &ex, &none).into_iter().map(|mut it| {
                it.cover = video::icon_for(&app, std::path::Path::new(&it.path)); it
            }));
            v.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            v
        }
        // subtitles are read where they are (the app's folder and the source folders)
        "subtitle" => {
            let (dir, mut sources) = media_dirs(&app, "subtitle");
            sources.insert(0, dir.display().to_string());
            media::list(&sources, "subtitle", None)
        }
        _ => vec![],
    }
}

/// A short fingerprint of a media library ("music" / "photo" / "video"): it
/// changes when its files do (added, removed, renamed, changed). The app reads
/// the whole list again only when it changed. New files in the source folders
/// get their shortcuts first, as list_media does.
#[tauri::command(async)]
fn media_fingerprint(app: AppHandle, kind: String) -> String {
    if !matches!(kind.as_str(), "music" | "photo" | "video") { return String::new(); }
    let record = paths::data_dir(&app).join("media_links.json");
    let (dir, sources) = media_dirs(&app, &kind);
    if !sources.is_empty() && sync_due(&kind) { medialib::sync_links(&kind, &sources, &dir, &record, &|_, _| {}); }
    medialib::fingerprint(&[dir], &kind)
}

/// File Recognition (Settings): make the shortcuts for every file in the
/// source folders of `kind` ("music" / "photo" / "video", or "all"), then read
/// every file of the library once, reporting progress. Returns how many
/// shortcuts were made.
#[tauri::command(async)]
fn media_recognize(app: AppHandle, kind: String) -> usize {
    let index = paths::data_dir(&app).join("media_index.json");
    let record = paths::data_dir(&app).join("media_links.json");
    let covers = paths::covers_dir(&app);
    let kinds: Vec<&str> = if kind == "all" { vec!["music", "photo", "video"] } else { vec![kind.as_str()] };
    let mut made = 0;
    for k in kinds {
        let (dir, sources) = media_dirs(&app, k);
        made += medialib::sync_links(k, &sources, &dir, &record, &progress_fn(&app, &format!("links:{k}")));
        let ffmpeg = if k == "music" { audio::ffmpeg_path(&app) } else { None };
        let ex = medialib::Extras { ffmpeg: ffmpeg.as_deref(), covers: if k == "music" { Some(&covers) } else { None } };
        medialib::list(&[dir], k, &index, &ex, &progress_fn(&app, &format!("read:{k}")));
    }
    made
}

/// A media source folder was removed: delete the shortcuts made from it.
#[tauri::command(async)]
fn media_source_remove(app: AppHandle, kind: String, source: String) -> usize {
    let record = paths::data_dir(&app).join("media_links.json");
    let (dir, _) = media_dirs(&app, &kind);
    medialib::remove_source(&kind, &source, &dir, &record)
}

// ------------------------------- misc -------------------------------------

#[tauri::command]
fn app_info(app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "MaXMB",
        "version": env!("CARGO_PKG_VERSION"),
        "contentRoot": paths::content_root(&app).display().to_string(),
    })
}

// ---------------------------- helpers -------------------------------------

/// The Photos folder (screenshots are saved in its "Screenshots" folder).
pub(crate) fn active_photos_dir(app: &AppHandle) -> std::path::PathBuf {
    paths::photos_dir(app)
}

/// The data files' secrets (the game databases' keys) written plain by an older version: written
/// again, sealed (secret.rs). The local accounts (the users' saved Sign-In, the local
/// PlayStation®Network accounts) sealed by an older version: written again, plain (users.rs, psn.rs).
fn secret_migrate(app: &AppHandle) {
    let plain = |f: &std::path::Path, keys: &[&str]| -> bool {
        let Ok(t) = std::fs::read_to_string(f) else { return false };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) else { return false };
        fn walk(v: &serde_json::Value, keys: &[&str]) -> bool {
            match v {
                serde_json::Value::Object(m) => m.iter().any(|(k, x)| (keys.contains(&k.as_str()) && match x {
                    serde_json::Value::String(s) => !s.is_empty() && !s.starts_with("dpapi:"),
                    serde_json::Value::Object(_) => true,
                    _ => false,
                }) || walk(x, keys)),
                serde_json::Value::Array(a) => a.iter().any(|x| walk(x, keys)),
                _ => false,
            }
        }
        walk(&v, keys)
    };
    let sf = paths::settings_file(app);
    if plain(&sf, &["sgdbKey", "tgdbKey", "rawgKey"]) { if let Some(s) = settings::load(&sf) { let _ = settings::save(&sf, &s); } }
    let pf = paths::psn_file(app);
    if std::fs::read_to_string(&pf).map(|t| t.contains("\"dpapi:")).unwrap_or(false) { let _ = psn::save(&pf, &psn::load(&pf)); }
    let uf = paths::users_file(app);
    if std::fs::read_to_string(&uf).map(|t| t.contains("\"dpapi:")).unwrap_or(false) { let _ = users::save(&uf, &users::load(&uf)); }
}

/// Load settings, always ensuring the in-app content folders are present so the
/// launcher self-heals even if the file is old, partial, or had its paths lost.

pub(crate) fn current_settings(app: &AppHandle) -> Settings {
    let mut s = settings::load(&paths::settings_file(app)).unwrap_or_default();
    let ensure = |list: &mut Vec<String>, dir: String| -> bool {
        if list.iter().any(|p| p == &dir) { false } else { list.push(dir); true }
    };
    let mut changed = false;
    changed |= ensure(&mut s.library_paths, paths::games_dir(app).display().to_string());
    changed |= ensure(&mut s.music_paths, paths::music_dir(app).display().to_string());
    changed |= ensure(&mut s.photo_paths, paths::photos_dir(app).display().to_string());
    changed |= ensure(&mut s.video_paths, paths::videos_dir(app).display().to_string());
    // the old Backgrounds folder is gone: drop it from saved settings
    if !s.background_paths.is_empty() { s.background_paths.clear(); changed = true; }
    changed |= ensure(&mut s.subtitle_paths, paths::subtitles_dir(app).display().to_string());
    if changed { let _ = settings::save(&paths::settings_file(app), &s); }
    s
}

/// Start at Windows Startup: a Task Scheduler task on Windows (bootstart.rs;
/// the older Run-key entry is taken away), the usual autostart elsewhere.
fn apply_autostart(app: &AppHandle, enable: bool) {
    let mgr = app.autolaunch();
    #[cfg(windows)]
    {
        if mgr.is_enabled().unwrap_or(false) { let _ = mgr.disable(); }
        bootstart::apply(enable);
    }
    #[cfg(not(windows))]
    { let _ = if enable { mgr.enable() } else { mgr.disable() }; }
}

pub(crate) fn apply_fullscreen(app: &AppHandle, enable: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_fullscreen(enable);
    }
}

// ---------------------------- entry point ---------------------------------


// minimal base64 (standard alphabet) so cover art can be returned as a data URL
fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[tauri::command(async)]
fn music_cover(path: String) -> Option<String> {
    let (mime, data) = media::extract_cover(std::path::Path::new(&path))?;
    Some(format!("data:{};base64,{}", mime, b64(&data)))
}


#[tauri::command]
fn quit_app(app: AppHandle) {
    // (the page's Close System key, still held from a press in another program)
    if quitkey::held_from_elsewhere() { log::line("INFO", "system", "Close System pressed in another program: ignored"); return; }
    cursorlock::release_now();
    browser::on_app_exit(&app);
    maybe_cleanup_temp(&app);
    app.exit(0);
}

// ---------------------------- icon shading cache -----------------------------
// The glossy icon images are made in the webview; they're saved here so the
// next start (or a refresh) can show them right away. Kept in the temporary
// folder, or in the system directory with "Save Cache in System Directory".

fn icon_shades_file(app: &AppHandle) -> std::path::PathBuf {
    if current_settings(app).behavior.cache_in_app_dir { paths::icon_shades_app_file(app) } else { paths::icon_shades_temp_file(app) }
}

#[tauri::command(async)]
fn icon_shades_load(app: AppHandle) -> String {
    let main = icon_shades_file(&app);
    // fall back to the other place (the setting may have just been switched)
    let other = if main == paths::icon_shades_app_file(&app) { paths::icon_shades_temp_file(&app) } else { paths::icon_shades_app_file(&app) };
    std::fs::read_to_string(&main).or_else(|_| std::fs::read_to_string(&other)).unwrap_or_else(|_| "{}".into())
}

#[tauri::command(async)]
fn icon_shades_save(app: AppHandle, data: String) -> Result<(), String> {
    let f = icon_shades_file(&app);
    let tmp = f.with_extension("json.part");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())?;
    // only one copy: drop the one in the other place
    let other = if f == paths::icon_shades_app_file(&app) { paths::icon_shades_temp_file(&app) } else { paths::icon_shades_app_file(&app) };
    let _ = std::fs::remove_file(other);
    Ok(())
}

// ------------------------------ wave cache --------------------------------
// The Original wave's rope, run to its start state (a second of work at every
// start), saved so the next start skips it. Kept like the icon shading: in the
// temporary folder, or in the system directory with "Save Cache in System
// Directory".

fn wave_cache_file(app: &AppHandle) -> std::path::PathBuf {
    if current_settings(app).behavior.cache_in_app_dir { paths::wave_cache_app_file(app) } else { paths::wave_cache_temp_file(app) }
}
fn wave_cache_other(app: &AppHandle, f: &std::path::Path) -> std::path::PathBuf {
    if f == paths::wave_cache_app_file(app) { paths::wave_cache_temp_file(app) } else { paths::wave_cache_app_file(app) }
}

#[tauri::command(async)]
fn wave_cache_load(app: AppHandle) -> String {
    let main = wave_cache_file(&app);
    // (the setting may have just been switched: the other place then)
    std::fs::read_to_string(&main).or_else(|_| std::fs::read_to_string(wave_cache_other(&app, &main))).unwrap_or_else(|_| "{}".into())
}

#[tauri::command(async)]
fn wave_cache_save(app: AppHandle, data: String) -> Result<(), String> {
    let f = wave_cache_file(&app);
    let tmp = f.with_extension("json.part");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(wave_cache_other(&app, &f));
    Ok(())
}

/// Clear a cache category on demand ("decoded" | "covers" | "icons" | "videos"
/// | "thumbs" | "wave" | "visualizers" | "all"). (Covers and "all" read the song covers again at once.)
#[tauri::command(async)]
fn clear_cache(app: AppHandle, category: String) -> Result<(), String> {
    audio::clear_cache(&app, &category, &progress_fn(&app, &format!("cache:{category}")))?;
    // the song covers are read again from the songs right away (nothing else
    // of the media index is forgotten), so they show at once
    if category == "covers" || category == "all" {
        let covers = paths::covers_dir(&app);
        let _ = std::fs::create_dir_all(&covers);
        // (and their small copies, as shown in the folders' icons and the lists)
        let dirs = paths::thumbs_dirs(&app);
        medialib::reread_covers(&paths::data_dir(&app).join("media_index.json"), &covers, audio::ffmpeg_path(&app).as_deref(),
            &|c| { let _ = thumbs::thumb(c, &dirs, false, None); }, &progress_fn(&app, "cache:covers-read"));
    }
    Ok(())
}

/// Run temp-file cleanup on shutdown when the "Delete Temporary Files" setting
/// is on. Safe to call more than once.
fn maybe_cleanup_temp(app: &AppHandle) {
    let sf = paths::settings_file(app);
    let on = settings::load(&sf)
        .map(|s| s.behavior.delete_temp_files)
        .unwrap_or(false);
    if on {
        audio::cleanup_temp_files(app);
    }
}

// The Internet Browser / Internet Search commands live in `browser.rs`: a
// bundled LibreWolf (Gecko) instance run as a pinned borderless window with
// force-installed extensions, controller-as-mouse, a custom cursor and an
// on-screen keyboard. (See that module.)

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// The app's window and its page (at the start, and again when the page has
/// to be made anew after a game; see focus.rs).
pub(crate) fn build_main_window(handle: &AppHandle) -> tauri::Result<()> {
    // The main window is created here (not in tauri.conf.json) so the
    // webview keeps its data in content/data/webview inside the app
    // folder instead of AppData.
    // sounds (the boot chime) may play before any click or key press.
    // CalculateNativeWinOcclusion off: the page doesn't stop drawing when
    // Windows reports its window as covered; after a full screen game that
    // report could stay stuck, leaving the window invisible (see-through)
    // and the page asleep once the game had closed. Losing the focus or
    // being minimized still quiets the app (see main.js).
    let args = webview_args(handle);
    tauri::WebviewWindowBuilder::new(handle, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("MaXMB")
        .inner_size(1280.0, 720.0)
        .min_inner_size(960.0, 540.0)
        .resizable(true)
        .fullscreen(true)
        .decorations(true)
        .center()
        .focused(true)
        // (black behind the page: what shows while the page is hidden during a game)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .additional_browser_args(&args)
        .data_directory(paths::webview_dir(handle))
        .build()?;
    Ok(())
}

/// The menus' browser settings (the trophy pop-up's window shares its browser data, so it uses the same).
pub fn webview_args(handle: &AppHandle) -> String {
    // (--disable-lcd-text: every text smoothed alike, in shades of grey. Without it, text drawn
    // on something solid -- a friend's comment in its white bubble, some names and games -- was
    // drawn with Windows' coloured edges (ClearType), sharp and jagged beside the rest, which is
    // drawn over see-through layers and smoothed in grey)
    let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,RestrictGamepadAccess,CalculateNativeWinOcclusion --autoplay-policy=no-user-gesture-required --disable-lcd-text");
    if !current_settings(handle).behavior.vsync {
        // VSync off: don't tie frames to the display refresh
        args.push_str(" --disable-gpu-vsync --disable-frame-rate-limit");
    }
    args
}

pub fn run() {
    tauri::Builder::default()
        // thumb://…/<path>: a picture's small copy for lists and grids (thumbs.rs),
        // made on its own thread so the page never waits on it
        .register_asynchronous_uri_scheme_protocol("thumb", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let raw = request.uri().path().trim_start_matches('/').to_string();
            // ?still=1: a still picture for a grid square (a video's frame, a GIF's first frame)
            let still = request.uri().query().map(|q| q.split('&').any(|kv| kv == "still=1")).unwrap_or(false);
            std::thread::spawn(move || {
                let path = std::path::PathBuf::from(thumbs::percent_decode(&raw));
                let dirs = paths::thumbs_dirs(&app);
                let ff = if still { audio::ffmpeg_path(&app) } else { None };
                let res = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
                let res = match thumbs::thumb(&path, &dirs, still, ff.as_deref()) {
                    Some((bytes, mime)) => res.status(200).header("Content-Type", mime).header("Cache-Control", "no-cache").body(bytes),
                    None => res.status(404).body(Vec::new()),
                };
                if let Ok(r) = res { responder.respond(r); }
            });
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // the log (content\Logs\MaXMB.log), first of all
            log::init(app.handle());
            // (secrets written plain by an older version: sealed now, secret.rs)
            { let h = app.handle().clone(); std::thread::spawn(move || secret_migrate(&h)); }
            // small picture copies: where they're kept, and the ones of pictures
            // that are gone (or changed) deleted, in the background
            // (the temporary caches live in Windows' Temp folder now: an older
            // version's go there first)
            paths::move_old_temp(app.handle());
            {
                let h = app.handle().clone();
                thumbs::IN_APP_DIR.store(current_settings(&h).behavior.cache_in_app_dir, std::sync::atomic::Ordering::Relaxed);
                std::thread::spawn(move || {
                    thumbs::sweep(&paths::thumbs_dirs(&h));
                    // (the decoded songs and converted videos of files changed or gone since)
                    audio::sweep_decoded(&h);
                    video::sweep_copies(&h);
                    // (the media files read before that are gone: forgotten)
                    medialib::forget_missing(&paths::data_dir(&h).join("media_index.json"));
                });
            }
            let handle = app.handle();
            paths::ensure_content_tree(handle);
            // PlayStation controllers read natively (DualShock 3 / 4, DualSense)
            hidpad::start(handle.clone());
            // the controller always gets the app back in front (see focus.rs)
            focus::start_pad_watch(handle.clone());
            // started with Windows (the Start at Windows Startup task): kept in
            // front while the other startup programs open (focus.rs)
            if bootstart::started_at_boot() { focus::boot_guard(handle.clone()); }
            // the Close System key (F4): closes the app at once, even if the page is stuck
            quitkey::start(handle.clone());
            build_main_window(handle)?;
            // (PS3 disc images: their files copied into the app's own cache)
            ps3::set_iso_cache(paths::data_dir(handle).join("cache").join("ps3iso"));
            // trophies: watched while their games run (trophies.rs); Steam
            // Friends' pictures from a session that didn't close cleanly: gone
            trophies::start_watch(handle.clone());
            steamfriends::clear_cache(handle);
            // undo a browser session that didn't get cleaned up + daily LibreWolf update
            browser::on_app_start(handle);
            let s = current_settings(handle);
            apply_fullscreen(handle, s.behavior.fullscreen);
            // Focus the WEBVIEW (not just the window) at startup so the Gamepad API
            // starts polling — the documented root cause of "only works when the
            // window is inactive" is the webview never receiving focus (tauri #11569).
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.set_focus();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Whenever the window is (re)activated, hand focus to the webview so the
            // gamepad keeps polling while the app is the active window.
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                // (back in the window while a game runs: its hidden page shows again)
                focus::window_focused(&window.app_handle());
                if let Some(w) = window.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            }
            // Closing the window (the X button) also triggers temp-file cleanup
            // when "Delete Temporary Files" is on.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // (Alt+F4 that closed a game or an emulator, still held as the
                // app comes back to the front: not meant for the app)
                if quitkey::held_from_elsewhere() {
                    api.prevent_close();
                    log::line("INFO", "system", "close asked by Alt+F4 pressed in another program: ignored");
                    return;
                }
                log::line("INFO", "system", "the window was asked to close: closing");
                cursorlock::release_now();
                browser::on_app_exit(&window.app_handle());
                maybe_cleanup_temp(&window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            log::log_write,
            ps3_file,
            content_writable,
            scan_library,
            section_list,
            section_sources_sync,
            section_sources_remove,
            section_folder,
            section_delete_folder,
            game_meta_save,
            list_fonts,
            pick_font,
            photo::photo_deletable, photo::photo_delete, photo::photo_write, photo::photo_save_copy, photo::photo_save_wallpaper,
            game_delete,
            game_sources_sync,
            game_sources_detected,
            game_sources_delete,
            game_sources_remove,
            game_sources_added,
            pick_folder,
            launch_game, game_mode_end, focus::page_focus, focus::page_alive, focus::resume_after_game, pick_file, image_has_alpha, game_media_set, game_scrape, game_art_steam, game_art_db, game_renamed, game_renamed_pending, game_known_by_id, game_folder_rename,
            list_users,
            create_user,
            save_user,
            delete_user,
            set_active_user,
            list_psn_accounts,
            save_psn_account,
            get_settings,
            save_settings,
            set_autostart,
            set_fullscreen,
            set_window_resolution,
            icon_shades_load,
            wave_cache_load,
            wave_cache_save,
            video::video_info,
            video::video_prepare,
            video::video_drop_copy,
            video::video_plan,
            audio::music_deletable,
            audio::music_delete,
            video::video_preload,
            video::video_subtitle,
            video::video_set_icon,
            video::video_icon_files,
            video::video_delete,
            video::video_deletable,
            icon_shades_save,
            themes_p3t,
            themes_icon,
            themes_sound,
            themes_custom,
            custom_theme_create, custom_theme_delete,
            theme_extract,
            list_media,
            media_fingerprint,
            media_recognize,
            media_source_remove,
            music_cover,
            audio::decode_audio,
            app_info,
            quit_app,
            quitkey::set_quit_key,
            clear_cache,
            browser::browser_status,
            browser::browser_open,
            browser::browser_close,
            browser::browser_state,
            browser::browser_input,
            browser::browser_visible,
            browser::browser_cmd,
            browser::browser_type,
            browser::browser_set_hotkeys,
            cursorlock::cursor_lock,
            screenshot::take_screenshot,
            screenshot::browser_snapshot,
            list_psn_avatars,
            accounts::accounts_view,
            accounts::account_set,
            accounts::account_login,
            accounts::account_logout,
            accounts::account_remove_all,
            trophies::trophies_cached,
            trophies::trophies_refresh,
            trophies::trophies_sync_cancel,
            trophies::trophies_game_off,
            trophies::trophies_game_has_local,
            trophies::account_games,
            trophies::account_game_set,
            trophies::trophies_sync_progress,
            trophies::trophies_sync_needed,
            steamfriends::steam_friends,
            steamfriends::steam_friend_levels,
            steamfriends::steam_friend_levels_kept, steamfriends::steam_friend_details,
            steamfriends::steam_own_avatar,
            trophypop::trophy_pop_style,
        ])
        .build(tauri::generate_context!())
        .expect("error while running MaXMB")
        .run(|app, ev| {
            // (the window closed only to be made anew: the app keeps running)
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = &ev {
                if focus::remaking() { api.prevent_exit(); }
            }
            // closing: Steam Friends' pictures deleted
            if let tauri::RunEvent::Exit = ev { steamfriends::clear_cache(app); }
        });
}
