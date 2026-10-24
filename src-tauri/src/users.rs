//! Local profiles, persisted to `users.json`. Each profile carries its own
//! theme, personal toggles, and which fake PSN account it's signed into.

use crate::models::{ThemeSettings, User, UsersFile};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn load(path: &Path) -> UsersFile {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, file: &UsersFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn now_secs() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_default()
}
fn new_id() -> String {
    format!("u{}", SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0))
}

pub fn create(path: &Path, name: &str, avatar: &str) -> Result<User, String> {
    let mut file = load(path);
    let user = User {
        id: new_id(),
        name: name.trim().to_string(),
        avatar: avatar.to_string(),
        psn_account_id: None,
        theme: ThemeSettings::default(),
        sound_enabled: true,
        music_enabled: true,
        bg_music: None,
        psn_linked_id: None,
        playlists: None,
        photo_playlists: None,
        friend_config: None,
        media_mode: None,
        game_sort: None,
        sections: None,
        psn_auto_sign_in: None,
        psn_saved: None,
        settings_copy: None,
        created_at: now_secs(),
        last_login: String::new(),
        extra: Default::default(),
    };
    file.users.push(user.clone());
    if file.active.is_none() {
        file.active = Some(user.id.clone());
    }
    save(path, &file)?;
    Ok(user)
}

/// Upsert a full user object (used to persist per-user theme / psn / prefs).
pub fn save_user(path: &Path, user: User) -> Result<(), String> {
    let mut file = load(path);
    if let Some(existing) = file.users.iter_mut().find(|u| u.id == user.id) {
        *existing = user;
    } else {
        file.users.push(user);
    }
    save(path, &file)
}

pub fn delete(path: &Path, id: &str) -> Result<(), String> {
    let mut file = load(path);
    file.users.retain(|u| u.id != id);
    if file.active.as_deref() == Some(id) {
        file.active = file.users.first().map(|u| u.id.clone());
    }
    save(path, &file)
}

pub fn set_active(path: &Path, id: &str) -> Result<(), String> {
    let mut file = load(path);
    if !file.users.iter().any(|u| u.id == id) {
        return Err("user not found".into());
    }
    file.active = Some(id.to_string());
    if let Some(u) = file.users.iter_mut().find(|u| u.id == id) {
        u.last_login = now_secs();
    }
    save(path, &file)
}
