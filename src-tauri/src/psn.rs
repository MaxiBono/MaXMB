//! Fake PlayStation Network accounts. Purely local — a profile can be "signed
//! into" one of these to show an online id, avatar and a friends-online count.

use crate::models::{PsnAccount, PsnFile};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn load(path: &Path) -> PsnFile {
    let mut f: PsnFile = fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    // (each sign-in's ID and password: written plain, to be read in the file itself; one sealed
    // by an older version (secret.rs) is opened, and written plain the next time it's saved)
    for a in f.accounts.iter_mut() { a.email = crate::secret::open(&a.email); a.password = crate::secret::open(&a.password); }
    f
}
pub fn save(path: &Path, file: &PsnFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    crate::paths::write_whole(path, json).map_err(|e| e.to_string())
}

/// Upsert a fake account. If `id` is empty, a new one is generated.
pub fn save_account(path: &Path, mut acct: PsnAccount) -> Result<PsnAccount, String> {
    let mut file = load(path);
    if acct.id.trim().is_empty() {
        acct.id = format!("p{}", SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    }
    if let Some(e) = file.accounts.iter_mut().find(|a| a.id == acct.id) {
        *e = acct.clone();
    } else {
        file.accounts.push(acct.clone());
    }
    save(path, &file)?;
    Ok(acct)
}

