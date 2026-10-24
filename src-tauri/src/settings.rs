//! App-level settings persistence. Defaults (including the in-app content
//! folders) are seeded by the caller when the file doesn't exist yet.

use crate::models::Settings;
use std::fs;
use std::path::Path;

pub fn load(path: &Path) -> Option<Settings> {
    fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}
