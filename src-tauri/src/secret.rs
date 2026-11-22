//! Secrets kept in the system's plain data files, sealed with Windows' own data protection
//! (DPAPI, as content\data\accounts.dat is: only this Windows user on this computer can read
//! them): the game databases' API keys (settings.json). (The local accounts -- the users'
//! saved Sign-In, users.json, and the local PlayStation®Network accounts' IDs and passwords,
//! psn.json -- are written plain, to be read in the files: users.rs, psn.rs. The linked
//! accounts' keys, IDs and cookies stay sealed in accounts.dat, accounts.rs.)
//!
//! A sealed value is written as "dpapi:" and the sealed bytes in hex. A value written by an
//! older version (plain) is read as it is, and sealed the next time its file is saved. A value
//! that can't be unsealed (the file copied to another Windows user or computer) reads as empty.

const TAG: &str = "dpapi:";

pub fn seal(s: &str) -> String {
    if s.is_empty() || s.starts_with(TAG) { return s.to_string(); }
    match crate::accounts::dpapi::protect(s.as_bytes()) {
        Some(b) => format!("{TAG}{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>()),
        // (sealing failed: kept out of the file rather than written plain)
        None => String::new(),
    }
}
pub fn open(s: &str) -> String {
    let Some(h) = s.strip_prefix(TAG) else { return s.to_string() };
    // (the same sealed value opened again -- the settings are read often --: once a session)
    static KEPT: std::sync::Mutex<Option<std::collections::HashMap<String, String>>> = std::sync::Mutex::new(None);
    if let Some(v) = KEPT.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(s).cloned()) { return v; }
    let v = open_now(h);
    if !v.is_empty() { let mut g = KEPT.lock().unwrap_or_else(|e| e.into_inner()); let m = g.get_or_insert_with(Default::default); if m.len() > 64 { m.clear(); } m.insert(s.to_string(), v.clone()); }
    v
}
fn open_now(h: &str) -> String {
    if h.len() % 2 != 0 { return String::new(); }
    let bytes: Option<Vec<u8>> = (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).ok()).collect();
    bytes.and_then(|b| crate::accounts::dpapi::unprotect(&b)).and_then(|b| String::from_utf8(b).ok()).unwrap_or_default()
}
/// A JSON value kept sealed (as a string holding it). (Nothing is sealed this way any more --
/// the users' saved Sign-In is written plain --: kept for the tests of open_value.)
#[cfg(test)]
pub fn seal_value(v: &serde_json::Value) -> serde_json::Value {
    if v.is_null() { return v.clone(); }
    serde_json::Value::String(seal(&v.to_string()))
}
pub fn open_value(v: &serde_json::Value) -> serde_json::Value {
    match v.as_str() {
        Some(s) if s.starts_with(TAG) => serde_json::from_str(&open(s)).unwrap_or(serde_json::Value::Null),
        _ => v.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sealed_and_opened() {
        let s = seal("my-key-123");
        assert!(s.starts_with(TAG) && !s.contains("my-key"));
        assert_eq!(open(&s), "my-key-123");
        assert_eq!(seal(&s), s, "sealed once");
        assert_eq!(open("plain from before"), "plain from before");
        assert_eq!(seal(""), "");
        assert_eq!(open("dpapi:zz"), "");
        let v = serde_json::json!({ "email": "a@b.c", "password": "pw" });
        let sv = seal_value(&v);
        assert!(sv.is_string() && !sv.as_str().unwrap().contains("pw"));
        assert_eq!(open_value(&sv), v);
        assert_eq!(open_value(&v), v);
        assert!(seal_value(&serde_json::Value::Null).is_null());
    }
}
