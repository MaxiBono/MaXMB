//! Photo Viewer: saving rotated / trimmed pictures, wallpapers, deleting.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

fn b64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return None,
        } as u32;
        buf = (buf << 6) | v; bits += 6;
        if bits >= 8 { bits -= 8; out.push((buf >> bits) as u8); buf &= (1 << bits) - 1; }
    }
    Some(out)
}
/// "data:image/png;base64,…" → (bytes, extension)
fn decode(data_url: &str) -> Result<(Vec<u8>, &'static str), String> {
    let (head, body) = data_url.split_once(',').ok_or("not a data URL")?;
    let ext = if head.contains("png") { "png" } else { "jpg" };
    Ok((b64(body).ok_or("bad data")?, ext))
}
fn in_content(app: &AppHandle, p: &Path) -> bool {
    match (p.canonicalize(), crate::paths::content_root(app).canonicalize()) {
        (Ok(p), Ok(r)) => p.starts_with(r) && p.is_file(),
        _ => false,
    }
}

/// Delete is offered only for pictures inside the app's own folders.
#[tauri::command]
pub fn photo_deletable(app: AppHandle, path: String) -> bool { in_content(&app, Path::new(&path)) }

#[tauri::command]
pub fn photo_delete(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !in_content(&app, &p) { return Err("only pictures inside the app's folders can be deleted".into()); }
    // (its small copies go with it)
    crate::thumbs::forget(&crate::paths::thumbs_dirs(&app), &p);
    fs::remove_file(&p).map_err(|e| e.to_string())
}

/// Rotate: the picture is written back over itself (same file, same format).
#[tauri::command]
pub fn photo_write(app: AppHandle, path: String, data_url: String) -> Result<(), String> {
    let (bytes, _) = decode(&data_url)?;
    let p = PathBuf::from(&path);
    if !p.is_file() { return Err("the picture is gone".into()); }
    // (its small copies are of the picture as it was: they go)
    crate::thumbs::forget(&crate::paths::thumbs_dirs(&app), &p);
    let tmp = p.with_extension("xmbtmp");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| { let _ = fs::remove_file(&tmp); e.to_string() })
}

/// Trimming: a new picture next to the original ("<name> (Trimmed).jpg");
/// when that folder can't be written, the app's Photos folder.
#[tauri::command]
pub fn photo_save_copy(app: AppHandle, path: String, data_url: String) -> Result<String, String> {
    let (bytes, ext) = decode(&data_url)?;
    let src = PathBuf::from(&path);
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Picture".into());
    let try_dir = |dir: &Path| -> Option<PathBuf> {
        let mut n = 1;
        loop {
            let name = if n == 1 { format!("{stem} (Trimmed).{ext}") } else { format!("{stem} (Trimmed {n}).{ext}") };
            let to = dir.join(name);
            if !to.exists() { return fs::write(&to, &bytes).ok().map(|_| to); }
            n += 1;
            if n > 999 { return None; }
        }
    };
    let out = src.parent().and_then(|d| try_dir(d)).or_else(|| try_dir(&crate::paths::photos_dir(&app)))
        .ok_or("the picture couldn't be saved")?;
    Ok(out.display().to_string())
}

/// Set as Wallpaper: the chosen range, kept in the app's data folder.
#[tauri::command]
pub fn photo_save_wallpaper(app: AppHandle, data_url: String) -> Result<String, String> {
    let (bytes, ext) = decode(&data_url)?;
    let dir = crate::paths::data_dir(&app).join("wallpapers");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let to = dir.join(format!("wallpaper_{stamp}.{ext}"));
    fs::write(&to, &bytes).map_err(|e| e.to_string())?;
    Ok(to.display().to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_data_urls() {
        let (b, e) = super::decode("data:image/png;base64,aGVsbG8=").unwrap();
        assert_eq!(b, b"hello"); assert_eq!(e, "png");
    }
}
