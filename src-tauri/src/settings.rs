//! App-level settings persistence. Defaults (including the in-app content
//! folders) are seeded by the caller when the file doesn't exist yet.

use crate::models::Settings;
use std::fs;
use std::path::Path;

pub fn load(path: &Path) -> Option<Settings> {
    let mut s: Settings = fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())?;
    // (the game databases' API keys: kept sealed, secret.rs)
    for k in [&mut s.scrape.sgdb_key, &mut s.scrape.tgdb_key, &mut s.scrape.rawg_key] { *k = crate::secret::open(k); }
    Some(s)
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    let mut s = settings.clone();
    for k in [&mut s.scrape.sgdb_key, &mut s.scrape.tgdb_key, &mut s.scrape.rawg_key] { *k = crate::secret::seal(k); }
    let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    crate::paths::write_whole(path, json).map_err(|e| e.to_string())
}
