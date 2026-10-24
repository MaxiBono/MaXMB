//! Things listed under the same name: the one that has been there longest
//! (its file's creation date) keeps the name, the others are shown as copies,
//! "Name (2)", "Name (3)"... in the order they came.

use std::collections::HashMap;
use std::hash::Hash;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// When a file or folder came to be: its creation date (its last change where
/// the system doesn't keep one), in milliseconds; 0 when it can't be read.
pub fn born(p: &Path) -> u128 {
    let Ok(md) = std::fs::metadata(p) else { return 0 };
    md.created().or_else(|_| md.modified()).ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0)
}

/// Each item's copy number among the items with the same key: 1 for the
/// oldest (by `born`; for ones made at the same moment the shorter path, so
/// "Name.zip" comes before "Name (2).zip", then the path), 2, 3... for the rest.
pub fn number<K: Eq + Hash>(items: &[(K, u128, String)]) -> Vec<u32> {
    let mut groups: HashMap<&K, Vec<usize>> = HashMap::new();
    for (i, (k, _, _)) in items.iter().enumerate() { groups.entry(k).or_default().push(i); }
    let mut out = vec![1; items.len()];
    for (_, mut idx) in groups {
        if idx.len() < 2 { continue; }
        idx.sort_by(|&a, &b| items[a].1.cmp(&items[b].1)
            .then_with(|| items[a].2.len().cmp(&items[b].2.len())).then_with(|| items[a].2.cmp(&items[b].2)));
        for (n, i) in idx.into_iter().enumerate() { out[i] = n as u32 + 1; }
    }
    out
}

/// A name with its copy number: "Name (2)".
pub fn with_number(name: &str, n: u32) -> String {
    if n > 1 { format!("{name} ({n})") } else { name.to_string() }
}

/// A file name with its copy number before the extension: "Song (2).mp3".
pub fn file_with_number(name: &str, n: u32) -> String {
    if n < 2 { return name.to_string(); }
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{} ({n}){}", &name[..i], &name[i..]),
        _ => with_number(name, n),
    }
}

/// Numbers the "name" of each listed theme (by name, any case) from the
/// creation date of its file or folder (`path_key`), and lists them by name,
/// each copy after the one it copies.
pub fn number_listed(list: &mut Vec<serde_json::Value>, path_key: &str) {
    let keys: Vec<(String, u128, String)> = list.iter().map(|t| {
        let path = t[path_key].as_str().unwrap_or("").to_string();
        (t["name"].as_str().unwrap_or("").trim().to_lowercase(), born(Path::new(&path)), path)
    }).collect();
    let nums = number(&keys);
    let mut v: Vec<(serde_json::Value, String, u32)> = std::mem::take(list).into_iter().zip(keys).zip(nums)
        .map(|((t, (k, _, _)), n)| (t, k, n)).collect();
    v.sort_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)));
    *list = v.into_iter().map(|(mut t, k, n)| {
        if n > 1 && !k.is_empty() {
            t["name"] = with_number(t["name"].as_str().unwrap_or(""), n).into();
            t["copy"] = n.into();
        }
        t
    }).collect();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn oldest_keeps_the_name() {
        let items = vec![("a", 30, "x".to_string()), ("b", 5, "y".to_string()), ("a", 10, "z".to_string()), ("a", 10, "w".to_string())];
        // "a": w and z came together (the path decides), x came last
        assert_eq!(number(&items), vec![3, 1, 2, 1]);
        assert_eq!(file_with_number("Song.mp3", 2), "Song (2).mp3");
        assert_eq!(file_with_number(".hidden", 3), ".hidden (3)");
        assert_eq!(file_with_number("Song.mp3", 1), "Song.mp3");
    }
}
