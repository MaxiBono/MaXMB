//! The copies the System makes of the user's files to play them (songs decoded
//! to WAV, videos converted to MP4) are named by their file's path, size and
//! date, so a changed or deleted file leaves its old copy behind. Each copy
//! made is noted next to it ("<what>.tsv": its name and its file), and at every
//! start the copies whose file is gone or has changed since are deleted, as
//! the pictures' small copies are (thumbs.rs sweep). Without it, the copies
//! kept in the System's folder (Save Cache in System Directory, Keep Preloaded
//! Songs / Videos Data) only ever grew.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

/// A copy made in `dir` (its file name) from `src`, noted in `dir/<index>`.
pub fn note(dir: &Path, index: &str, name: &str, src: &Path) {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join(index)) {
        let _ = writeln!(f, "{name}\t{}", src.display());
    }
}

/// The copies noted in `dir/<index>` whose file is gone, or whose name isn't
/// one `names(file)` gives now (the file changed), deleted; and the leftovers
/// of copies never finished (".part"). Copies made before they were noted are
/// left alone. Returns how many were deleted.
pub fn sweep(dir: &Path, index: &str, names: &dyn Fn(&Path) -> Vec<String>) -> usize {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let file = dir.join(index);
    let text = fs::read_to_string(&file).unwrap_or_default();
    let mut keep: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut gone = 0;
    for line in text.lines() {
        let Some((name, src)) = line.split_once('\t') else { continue };
        // (only a plain file name: never anything outside the folder)
        if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') { continue; }
        let path = dir.join(name);
        let src = Path::new(src);
        let current = src.is_file() && names(src).iter().any(|n| n == name);
        if current && path.is_file() {
            if seen.insert(name.to_string()) { keep.push(line.to_string()); }
        } else if !current && path.is_file() && fs::remove_file(&path).is_ok() {
            gone += 1;
        }
    }
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        if n.contains(".part.") && fs::remove_file(e.path()).is_ok() { gone += 1; }
    }
    let body: String = keep.iter().map(|l| format!("{l}\n")).collect();
    if body.is_empty() { let _ = fs::remove_file(&file); } else if body != text { let _ = fs::write(&file, body); }
    gone
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_copies_go() {
        let d = std::env::temp_dir().join(format!("xmb_sweep_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let (src, cache) = (d.join("src"), d.join("cache"));
        fs::create_dir_all(&src).unwrap(); fs::create_dir_all(&cache).unwrap();
        let name_of = |p: &Path| vec![format!("c_{}.wav", fs::read_to_string(p).unwrap_or_default().trim())];
        for (f, v) in [("a.wma", "1"), ("b.wma", "1"), ("c.wma", "1")] {
            fs::write(src.join(f), v).unwrap();
            let n = name_of(&src.join(f))[0].replace(".wav", &format!("_{f}.wav"));
            fs::write(cache.join(&n), "x").unwrap();
            note(&cache, "decoded.tsv", &n, &src.join(f));
        }
        let names = |p: &Path| vec![name_of(p)[0].replace(".wav", &format!("_{}.wav", p.file_name().unwrap().to_string_lossy()))];
        // a copy made before they were noted, a copy never finished, a line pointing outside
        fs::write(cache.join("old.wav"), "x").unwrap();
        fs::write(cache.join("v_1.part.mp4"), "x").unwrap();
        fs::write(d.join("outside.txt"), "x").unwrap();
        note(&cache, "decoded.tsv", "../outside.txt", &src.join("gone.wma"));
        // nothing changed: nothing deleted but the unfinished copy
        assert_eq!(sweep(&cache, "decoded.tsv", &names), 1);
        assert!(cache.join("c_1_a.wma.wav").is_file() && cache.join("old.wav").is_file() && d.join("outside.txt").is_file());
        // a.wma changed, b.wma deleted: their copies go; c's stays
        fs::write(src.join("a.wma"), "2").unwrap();
        fs::remove_file(src.join("b.wma")).unwrap();
        assert_eq!(sweep(&cache, "decoded.tsv", &names), 2);
        assert!(!cache.join("c_1_a.wma.wav").exists() && !cache.join("c_1_b.wma.wav").exists() && cache.join("c_1_c.wma.wav").is_file());
        assert_eq!(fs::read_to_string(cache.join("decoded.tsv")).unwrap().lines().count(), 1);
        let _ = fs::remove_dir_all(&d);
    }
}
