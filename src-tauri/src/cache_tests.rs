//! Cache checks with real media files (made with FFmpeg when it's on this
//! machine), each run with and without FFmpeg: song covers (shared files,
//! pointers, "no cover" markers, read again once FFmpeg is there, made again
//! after the cache is deleted), photo / video thumbnails, game art that waits
//! for FFmpeg, and game folders made from game sources.
#![cfg(test)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn ffmpeg() -> Option<PathBuf> {
    let ok = Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false);
    if ok { Some(PathBuf::from("ffmpeg")) } else { None }
}
fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("xmb_cache_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}
fn ff(args: &[&str]) -> bool {
    Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).status().map(|s| s.success()).unwrap_or(false)
}
/// cover.jpg, songs with the cover (mp3, flac, m4a: tags the built-in readers
/// know; mka: only FFmpeg finds it), a song without one, a picture and a video
fn make_media(d: &Path) {
    let p = |n: &str| d.join(n).to_string_lossy().to_string();
    assert!(ff(&["-f", "lavfi", "-i", "testsrc=size=320x320", "-frames:v", "1", &p("cover.jpg")]));
    assert!(ff(&["-f", "lavfi", "-i", "testsrc2=size=300x300", "-frames:v", "1", &p("cover2.png")]));
    let sine = ["-f", "lavfi", "-i", "sine=frequency=440:duration=1"];
    assert!(ff(&[&sine[..], &["-i", &p("cover.jpg"), "-map", "0", "-map", "1", "-c:a", "libmp3lame", "-id3v2_version", "3", "-disposition:v", "attached_pic", &p("a.mp3")]].concat()));
    assert!(ff(&[&sine[..], &["-i", &p("cover.jpg"), "-map", "0", "-map", "1", "-c:a", "flac", "-disposition:v", "attached_pic", &p("b.flac")]].concat()));
    assert!(ff(&[&sine[..], &["-i", &p("cover2.png"), "-map", "0", "-map", "1", "-c:a", "aac", "-c:v", "png", "-disposition:v", "attached_pic", &p("c.m4a")]].concat()));
    assert!(ff(&[&sine[..], &["-i", &p("cover.jpg"), "-map", "0", "-map", "1", "-c:a", "libvorbis", "-c:v", "mjpeg", "-disposition:v", "attached_pic", &p("d.mka")]].concat()));
    assert!(ff(&[&sine[..], &["-c:a", "libmp3lame", &p("nocover.mp3")]].concat()));
    assert!(ff(&["-f", "lavfi", "-i", "testsrc=size=1600x1200", "-frames:v", "1", &p("photo.jpg")]));
    assert!(ff(&["-f", "lavfi", "-i", "testsrc=size=640x360:duration=2", "-pix_fmt", "yuv420p", &p("clip.mp4")]));
}
fn covers_in(d: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.starts_with("cov_")).collect();
    v.sort();
    v
}

#[test]
fn song_covers_with_and_without_ffmpeg() {
    let Some(fm) = ffmpeg() else { eprintln!("(no ffmpeg on this machine: skipped)"); return; };
    let d = tmp("covers");
    make_media(&d);
    let cache = d.join("covers");
    fs::create_dir_all(&cache).unwrap();
    use crate::media::cache_cover;

    // ---- without FFmpeg: the tags the built-in readers know
    let a = cache_cover(&d.join("a.mp3"), &cache, None).expect("mp3 cover without ffmpeg");
    let b = cache_cover(&d.join("b.flac"), &cache, None).expect("flac cover without ffmpeg");
    assert_eq!(a, b, "the same picture is one shared file");
    assert!(cache_cover(&d.join("c.m4a"), &cache, None).is_some(), "m4a cover without ffmpeg");
    assert_eq!(covers_in(&cache).len(), 2, "two different pictures: two files");
    // (asked again: the pointer, nothing extracted again)
    assert_eq!(cache_cover(&d.join("a.mp3"), &cache, None).unwrap(), a);
    // a cover only FFmpeg can read: none for now, noted as "without FFmpeg"
    assert!(cache_cover(&d.join("d.mka"), &cache, None).is_none());
    assert!(fs::read_dir(&cache).unwrap().flatten().any(|e| e.file_name().to_string_lossy().ends_with(".noff")), "a no-ffmpeg marker");
    assert!(cache_cover(&d.join("nocover.mp3"), &cache, None).is_none());

    // ---- FFmpeg is there now: what it can read is read again
    let dk = cache_cover(&d.join("d.mka"), &cache, Some(&fm)).expect("mka cover read again with ffmpeg");
    assert!(Path::new(&dk).is_file());
    // (and FFmpeg gone again later: the cover found stays)
    assert_eq!(cache_cover(&d.join("d.mka"), &cache, None).as_deref(), Some(dk.as_str()), "mka cover kept without ffmpeg");
    assert!(cache_cover(&d.join("nocover.mp3"), &cache, Some(&fm)).is_none());
    assert!(!fs::read_dir(&cache).unwrap().flatten().any(|e| e.file_name().to_string_lossy().ends_with(".noff")), "no-ffmpeg markers gone once checked with ffmpeg");
    // (a song with no cover, checked with FFmpeg: not tried again without it)
    assert!(cache_cover(&d.join("nocover.mp3"), &cache, None).is_none());

    // ---- the cache deleted (Delete Song Covers): every cover made again
    for e in fs::read_dir(&cache).unwrap().flatten() { fs::remove_file(e.path()).unwrap(); }
    for (song, want) in [("a.mp3", true), ("b.flac", true), ("c.m4a", true), ("d.mka", true), ("nocover.mp3", false)] {
        let got = cache_cover(&d.join(song), &cache, Some(&fm));
        assert_eq!(got.is_some(), want, "{song} after the cache was deleted");
        if let Some(f) = got { assert!(Path::new(&f).is_file(), "{song}: its file is there"); }
    }
    // the same after deleting it with FFmpeg gone: the covers the built-in readers know come back
    for e in fs::read_dir(&cache).unwrap().flatten() { fs::remove_file(e.path()).unwrap(); }
    for (song, want) in [("a.mp3", true), ("b.flac", true), ("c.m4a", true), ("d.mka", false)] {
        assert_eq!(cache_cover(&d.join(song), &cache, None).is_some(), want, "{song} without ffmpeg after the cache was deleted");
    }
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn thumbnails_with_and_without_ffmpeg() {
    let Some(fm) = ffmpeg() else { eprintln!("(no ffmpeg on this machine: skipped)"); return; };
    let d = tmp("thumbs");
    make_media(&d);
    let dirs = crate::thumbs::Dirs { temp: d.join("t_temp"), app: d.join("t_app") };
    use crate::thumbs::thumb;
    // a big photo: a small copy, made once and kept
    let (b1, _) = thumb(&d.join("photo.jpg"), &dirs, false, None).expect("photo thumbnail");
    assert!(b1.len() < fs::metadata(d.join("photo.jpg")).unwrap().len() as usize, "smaller than the photo");
    let made = fs::read_dir(&dirs.temp).unwrap().flatten().count();
    assert!(made >= 1, "kept in the temporary folder");
    let (b2, _) = thumb(&d.join("photo.jpg"), &dirs, false, None).unwrap();
    assert_eq!(b1, b2, "the kept copy is used");
    // a video's still: needs FFmpeg; without it nothing (and nothing breaks)
    assert!(thumb(&d.join("clip.mp4"), &dirs, true, None).is_none(), "no video still without ffmpeg");
    assert!(thumb(&d.join("clip.mp4"), &dirs, true, Some(&fm)).is_some(), "video still with ffmpeg");
    // the cache deleted (Delete Photo Thumbnails): made again
    for e in fs::read_dir(&dirs.temp).unwrap().flatten() { fs::remove_file(e.path()).unwrap(); }
    assert!(thumb(&d.join("photo.jpg"), &dirs, false, None).is_some());
    assert!(thumb(&d.join("clip.mp4"), &dirs, true, Some(&fm)).is_some());
    assert!(fs::read_dir(&dirs.temp).unwrap().flatten().count() >= 2, "both made again");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn music_and_video_lists_with_and_without_ffmpeg() {
    let Some(fm) = ffmpeg() else { eprintln!("(no ffmpeg on this machine: skipped)"); return; };
    let d = tmp("lists");
    make_media(&d);
    let root = vec![d.to_string_lossy().to_string()];
    for f in [None, Some(fm.as_path())] {
        let songs = crate::media::list(&root, "music", f);
        for n in ["a.mp3", "b.flac", "c.m4a", "nocover.mp3"] {
            assert!(songs.iter().any(|s| s.path.ends_with(n)), "{n} listed (ffmpeg: {})", f.is_some());
        }
        let vids = crate::media::list(&root, "video", f);
        assert!(vids.iter().any(|v| v.path.ends_with("clip.mp4")), "the video listed (ffmpeg: {})", f.is_some());
    }
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn game_art_waiting_for_ffmpeg() {
    let d = tmp("gameart");
    let g = d.join("My Game");
    fs::create_dir_all(&g).unwrap();
    fs::write(g.join("My Game.lnk"), b"x").unwrap();
    // art put in uncut because FFmpeg wasn't there: asked for again once it is
    // (its icon and background there: only FFmpeg decides)
    for f in ["icon.png", "background.jpg"] { fs::write(g.join(f), b"x").unwrap(); }
    fs::write(g.join("game.json"), r#"{ "title": "My Game", "dbScraped": true, "artNeedsFfmpeg": ["icon", "background"] }"#).unwrap();
    assert!(!crate::gameart::needs_db_art(&g, false), "without ffmpeg: nothing to do yet");
    assert!(crate::gameart::needs_db_art(&g, true), "with ffmpeg: made again");
    // nothing waiting: a scraped game isn't asked about again
    fs::write(g.join("game.json"), r#"{ "title": "My Game", "dbScraped": true }"#).unwrap();
    assert!(!crate::gameart::needs_db_art(&g, true));
    // its background removed (or its icon only the program's own): looked for again at Game Recognition
    fs::remove_file(g.join("background.jpg")).unwrap();
    assert!(crate::gameart::needs_db_art(&g, true), "no background: looked for again");
    fs::write(g.join("background.jpg"), b"x").unwrap(); fs::remove_file(g.join("icon.png")).unwrap();
    assert!(crate::gameart::needs_db_art(&g, true), "only the program's icon: looked for again");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn game_sources_with_and_without_ffmpeg() {
    let ffm = ffmpeg();
    for (i, f) in [None, ffm.clone()].into_iter().enumerate() {
        if i == 1 && f.is_none() { break; }
        let d = tmp(&format!("gsrc{i}"));
        let src = d.join("Source");
        fs::create_dir_all(src.join("Cool Game")).unwrap();
        fs::write(src.join("Cool Game").join("CoolGame.exe"), b"MZ").unwrap();
        let games = d.join("Games");
        fs::create_dir_all(&games).unwrap();
        let rec = d.join("game_sources.json");
        let made = crate::gamesrc::sync(&[src.to_string_lossy().to_string()], &games, &rec, f.as_deref(), &|_, _| {});
        // (run again: nothing new, nothing broken)
        let again = crate::gamesrc::sync(&[src.to_string_lossy().to_string()], &games, &rec, f.as_deref(), &|_, _| {});
        let listed = crate::library::scan(&[games.to_string_lossy().to_string()], Some(&d.join("icons")));
        eprintln!("ffmpeg {}: made {:?}, again {:?}, listed {}", f.is_some(), made, again, listed.len());
        assert!(again.is_empty(), "a second sync makes nothing new");
        assert_eq!(listed.len(), made.len(), "every game folder made is listed");
        let _ = fs::remove_dir_all(&d);
    }
}

#[test]
fn bundled_icon_sets_are_listed() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../content/Icon");
    let sets = crate::themes::list_icon_themes(&dir);
    for name in ["Flat Icons", "Vice"] {
        let s = sets.iter().find(|s| s["name"] == name).unwrap_or_else(|| panic!("{name} not listed"));
        assert!(s["icons"]["icon_game.png"].is_string(), "{name}: its icons");
        assert!(s["icons"].as_object().unwrap().keys().any(|k| k.starts_with("mp:")), "{name}: its Music Player icons");
    }
}
