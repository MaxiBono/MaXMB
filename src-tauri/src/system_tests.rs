//! Checks of whole parts of the System working on real files: media read
//! (metadata) and converted with FFmpeg, settings / users / themes saved and
//! read back, games and media recognized and kept up to date, and what
//! happens when things change suddenly under it (files, shortcuts, folders and
//! caches deleted or damaged while it runs).
#![cfg(test)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn ffmpeg() -> Option<PathBuf> {
    let ok = Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false);
    if ok { Some(PathBuf::from("ffmpeg")) } else { None }
}
fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("xmb_sys_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}
fn ff(args: &[&str]) -> bool {
    Command::new("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).status().map(|s| s.success()).unwrap_or(false)
}
fn s(p: &Path) -> String { p.to_string_lossy().to_string() }

// ------------------------------------------------------------ metadata ----
#[test]
fn metadata_of_real_files() {
    let Some(fm) = ffmpeg() else { eprintln!("(no ffmpeg on this machine: skipped)"); return; };
    let d = tmp("meta");
    let sine = ["-f", "lavfi", "-i", "sine=frequency=440:duration=3"];
    let tags = ["-metadata", "title=My Song", "-metadata", "artist=The Artist", "-metadata", "album=An Album", "-metadata", "date=2009", "-metadata", "track=7", "-metadata", "genre=Rock"];
    for (name, codec) in [("a.mp3", vec!["-c:a", "libmp3lame", "-id3v2_version", "3"]), ("b.flac", vec!["-c:a", "flac"]), ("c.m4a", vec!["-c:a", "aac"]), ("d.ogg", vec!["-c:a", "libvorbis"]), ("e.wav", vec!["-c:a", "pcm_s16le"])] {
        assert!(ff(&[&sine[..], &tags[..], &codec[..], &[&s(&d.join(name))]].concat()), "made {name}");
    }
    assert!(ff(&["-f", "lavfi", "-i", "testsrc=size=640x360:duration=4:rate=25", "-f", "lavfi", "-i", "sine=duration=4", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", &s(&d.join("v.mp4"))]));
    assert!(ff(&["-f", "lavfi", "-i", "testsrc=size=800x600", "-frames:v", "1", &s(&d.join("p.jpg"))]));
    assert!(ff(&["-f", "lavfi", "-i", "testsrc=size=321x123", "-frames:v", "1", &s(&d.join("p.png"))]));
    use crate::media::media_item;
    // songs: the tags, with and without FFmpeg (the built-in readers know these formats)
    for name in ["a.mp3", "b.flac", "c.m4a", "d.ogg"] {
        for f in [None, Some(fm.as_path())] {
            let it = media_item(&d.join(name), "music", f, false).unwrap_or_else(|| panic!("{name} read"));
            assert_eq!(it.title.as_deref(), Some("My Song"), "{name} title (ffmpeg: {})", f.is_some());
            assert_eq!(it.artist.as_deref(), Some("The Artist"), "{name} artist");
            assert_eq!(it.album.as_deref(), Some("An Album"), "{name} album");
            assert_eq!(it.track, Some(7), "{name} track");
            assert!(it.year.as_deref().map(|y| y.starts_with("2009")).unwrap_or(false), "{name} year {:?}", it.year);
            assert!(matches!(it.duration_secs, Some(2..=4)), "{name} length {:?}", it.duration_secs);
        }
    }
    // (a WAV: its length at least, whatever its tags)
    let w = media_item(&d.join("e.wav"), "music", Some(&fm), false).unwrap();
    assert!(matches!(w.duration_secs, Some(2..=4)), "wav length {:?}", w.duration_secs);
    // a video: its length and picture size; photos: their sizes
    let v = media_item(&d.join("v.mp4"), "video", Some(&fm), false).unwrap();
    assert!(matches!(v.duration_secs, Some(3..=5)), "video length {:?}", v.duration_secs);
    let vp = crate::vprobe::probe(&d.join("v.mp4")).expect("video probed");
    assert_eq!((vp.width, vp.height), (640, 360));
    for (name, kind) in [("p.jpg", "photo"), ("p.png", "photo")] { assert!(media_item(&d.join(name), kind, None, false).is_some(), "{name} read"); }
    // damaged files: empty, cut short, rubbish with a media name: read as far as they go, nothing breaks
    let good = fs::read(d.join("a.mp3")).unwrap();
    for (name, data) in [("empty.mp3", vec![]), ("cut.mp3", good[..good.len() / 3].to_vec()), ("junk.flac", vec![0xAB; 5000]), ("junk.m4a", b"ftypM4A \x00\x00\x00\x01".to_vec()),
        ("junk.mp4", vec![0x00; 4096]), ("junk.jpg", b"\xFF\xD8\xFF\xE1\xFF\xFFExif".to_vec()), ("junk.png", b"\x89PNG\r\n\x1a\n\x00\x00".to_vec()), ("junk.mkv", vec![0x1A, 0x45, 0xDF, 0xA3, 0xFF, 0xFF])] {
        fs::write(d.join(name), data).unwrap();
        let kind = if name.ends_with("mp4") || name.ends_with("mkv") { "video" } else if name.ends_with("jpg") || name.ends_with("png") { "photo" } else { "music" };
        for f in [None, Some(fm.as_path())] { let _ = media_item(&d.join(name), kind, f, false); }
        let _ = crate::vprobe::probe(&d.join(name));
    }
    // a file deleted between being listed and being read
    assert!(media_item(&d.join("gone.mp3"), "music", Some(&fm), false).is_none());
    let _ = fs::remove_dir_all(&d);
}

// ---------------------------------------------------------- conversion ----
#[test]
fn songs_are_decoded_for_playing() {
    let Some(fm) = ffmpeg() else { eprintln!("(no ffmpeg on this machine: skipped)"); return; };
    let d = tmp("decode");
    assert!(ff(&["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "wmav2", &s(&d.join("a.wma"))]));
    let out = d.join("a.wav");
    crate::audio::ffmpeg_decode(&fm, &d.join("a.wma"), &out).expect("WMA decoded");
    let b = fs::read(&out).unwrap();
    assert!(&b[..4] == b"RIFF" && &b[8..12] == b"WAVE", "a WAV file");
    let (ch, rate, bits) = (u16::from_le_bytes([b[22], b[23]]), u32::from_le_bytes([b[24], b[25], b[26], b[27]]), u16::from_le_bytes([b[34], b[35]]));
    assert_eq!((ch, rate, bits), (2, 44100, 16), "stereo, 44.1 kHz, 16 bit");
    let secs = (b.len() as f64 - 44.0) / (44100.0 * 4.0);
    assert!((1.8..2.3).contains(&secs), "its whole length ({secs:.2} s)");
    // a file that isn't a song, a file that's gone, no FFmpeg at that place: an error, and no half-made file left
    fs::write(d.join("junk.wma"), vec![7u8; 3000]).unwrap();
    for (src, ffp) in [(d.join("junk.wma"), fm.clone()), (d.join("gone.wma"), fm.clone()), (d.join("a.wma"), d.join("no_ffmpeg_here"))] {
        let o = d.join("bad.wav"); let _ = fs::remove_file(&o);
        assert!(crate::audio::ffmpeg_decode(&ffp, &src, &o).is_err());
        assert!(!o.is_file() || fs::metadata(&o).map(|m| m.len() < 100).unwrap_or(true), "nothing playable left behind");
    }
    let _ = fs::remove_dir_all(&d);
}

// ------------------------------------------------- settings and users ----
#[test]
fn settings_and_users_are_saved_and_read_back() {
    let d = tmp("settings");
    let f = d.join("settings.json");
    assert!(crate::settings::load(&f).is_none(), "no file yet");
    let mut st: crate::models::Settings = serde_json::from_value(serde_json::json!({
        "libraryPaths": [], "musicPaths": [], "photoPaths": [], "videoPaths": [], "backgroundPaths": [],
        "behavior": { "fullscreen": false, "volume": 42, "menuBlur": "all", "keepBootLook": false, "cacheInAppDir": true, "timeFormat": "12", "aNewOption": { "x": [1, 2, 3] } },
        "input": {}, "gameSources": ["D:\\Games"], "mediaFolders": { "music": ["E:\\Music"] },
        "bootLook": { "backgroundColor": "#102030", "waveEngine": "linkev", "p3tTheme": "p3t:x" }, "graphics": { "waveStyle": "linkev", "iconStyle": "flat" } })).expect("settings read");
    crate::settings::save(&f, &st).unwrap();
    let back = crate::settings::load(&f).expect("read back");
    let (a, b) = (serde_json::to_value(&st).unwrap(), serde_json::to_value(&back).unwrap());
    assert_eq!(a, b, "everything saved is read back the same");
    assert_eq!(b["behavior"]["menuBlur"], "all"); assert_eq!(b["behavior"]["keepBootLook"], false); assert_eq!(b["behavior"]["aNewOption"]["x"][2], 3);
    assert_eq!(b["bootLook"]["waveEngine"], "linkev"); assert_eq!(b["behavior"]["volume"], 42); assert_eq!(b["gameSources"][0], "D:\\Games");
    // saved again and again with changes: the last one stands
    for v in [0u8, 100, 55] { st.behavior.volume = v; crate::settings::save(&f, &st).unwrap(); }
    assert_eq!(crate::settings::load(&f).unwrap().behavior.volume, 55);
    // the file damaged (cut short), emptied, deleted while running: read as "none", nothing breaks
    let text = fs::read_to_string(&f).unwrap();
    for bad in [&text[..text.len() / 2], "", "null", "[1,2]"] { fs::write(&f, bad).unwrap(); assert!(crate::settings::load(&f).is_none(), "damaged settings ({} bytes)", bad.len()); }
    fs::remove_file(&f).unwrap(); assert!(crate::settings::load(&f).is_none());
    crate::settings::save(&f, &st).unwrap(); assert!(crate::settings::load(&f).is_some(), "saved again after being deleted");

    // users: made, their theme saved in full (every option, the ones this version doesn't name too)
    let uf = d.join("users.json");
    let u = crate::users::create(&uf, "Maxi", "stock:sphere_teal").unwrap();
    let mut v = serde_json::to_value(&u).unwrap();
    let theme = serde_json::json!({ "backgroundColor": "#112233", "waveColor": "#445566", "wavesEnabled": false, "dotColor": "auto", "dotsEnabled": true, "iconColor": "#abcdef",
        "iconStyle": "glasslive", "waveEngine": "linkev", "wallpaper": "C:\\bg.png", "overlay": "C:\\ov.webm", "font": "C:\\f.ttf", "fontSize": 140, "textColor": "#ffd000",
        "clockColor": "#00ff00", "folderColor": "#ff00ff", "p3tTheme": "p3t:abc", "iconTheme": "icon:Vice", "customTheme": "custom:mine", "soundTheme": "sound:x",
        "themeOpts": { "p3t:abc": { "tIcons": true, "tSounds": false } }, "waveParams": { "wave:speed": 0.5 }, "themePresets": [{ "name": "P", "theme": { "iconColor": "#000000" } }],
        "wavePresets": [{ "name": "W", "params": { "a": 1 } }], "bgPlaylists": [{ "name": "B", "items": ["x"] }], "monthColors": ["#111111"], "anOptionFromLater": { "k": true } });
    for (k, val) in theme.as_object().unwrap() { v["theme"][k] = val.clone(); }
    v["friendConfig"] = serde_json::json!({ "mode": "fixed", "count": 12, "cards": [{ "name": "A", "message": "x".repeat(256) }] });
    v["playlists"] = serde_json::json!([{ "name": "L", "tracks": ["a.mp3"] }]);
    let u2: crate::models::User = serde_json::from_value(v.clone()).expect("user read");
    crate::users::save_user(&uf, u2).unwrap();
    let got = serde_json::to_value(&crate::users::load(&uf).users[0]).unwrap();
    for (k, val) in theme.as_object().unwrap() { assert_eq!(&got["theme"][k], val, "theme option {k} saved in full"); }
    assert_eq!(got["friendConfig"]["cards"][0]["message"].as_str().unwrap().len(), 256);
    assert_eq!(got["playlists"][0]["tracks"][0], "a.mp3");
    // a second user, the active one set, one deleted
    let u3 = crate::users::create(&uf, "Other", "").unwrap();
    // (a new user starts at the defaults: the Icon Style and the Wave Style its own, not the ones last used)
    let t3 = serde_json::to_value(&u3.theme).unwrap();
    assert_eq!(t3["iconStyle"], "glasslive"); assert_eq!(t3["waveEngine"], "original"); assert_eq!(t3["backgroundColor"], "auto");
    crate::users::set_active(&uf, &u3.id).unwrap();
    assert_eq!(crate::users::load(&uf).users.len(), 2);
    crate::users::delete(&uf, &u.id).unwrap();
    let left = crate::users::load(&uf);
    assert_eq!(left.users.len(), 1); assert_eq!(left.users[0].name, "Other");
    // users.json damaged or deleted: an empty list, nothing breaks; a user can be made again
    fs::write(&uf, "{ \"users\": [ { \"id\": ").unwrap(); assert!(crate::users::load(&uf).users.is_empty());
    fs::remove_file(&uf).unwrap(); assert!(crate::users::load(&uf).users.is_empty());
    assert!(crate::users::create(&uf, "Again", "").is_ok());
    let _ = fs::remove_dir_all(&d);
}

// --------------------------------------------------------------- themes ----
#[test]
fn custom_themes_are_saved_in_full_and_survive_sudden_changes() {
    let d = tmp("themes");
    let (themes, cache) = (d.join("Themes"), d.join("cache"));
    fs::create_dir_all(&themes).unwrap(); fs::create_dir_all(&cache).unwrap();
    let pic = d.join("bg.png"); fs::write(&pic, b"\x89PNGfake-picture").unwrap();
    let snd = d.join("s.wav"); fs::write(&snd, b"RIFFfake").unwrap();
    let settings = serde_json::json!({ "backgroundColor": "#112233", "iconColor": "#ff0000", "iconColorAll": false, "iconStyle": "glassglow", "waveEngine": "linkev", "waveColor": "auto", "dotColor": "#00ff00",
        "wavesEnabled": false, "dotsEnabled": true, "wallpaper": "file:media/bg.png", "overlay": "file:media/ov.png", "chromaKey": "green", "chromaStrength": 0.7, "wallpaperFit": "stretch",
        "font": "file:media/font.ttf", "fontSize": 120, "textColor": "#ffd000", "clockColor": "#0000ff", "clockIconColor": "#00ffff", "folderColor": "#ff00ff", "folderColorAll": false,
        "themeFolders": true, "psnStyle": "modern", "homeStyle": "modern", "reactiveBackdrop": true, "waveParams": { "wave:speed": 0.25, "dots:count": 80 },
        "monthColors": ["#010101", "#020202"], "customColors": { "bgcolor": "#123456" }, "introIcon": "file:media/intro.png", "introTitle": "file:media/title.png",
        "bgShuffle": "all", "ovShuffle": null, "bgInterval": 30, "ovInterval": 45, "bgPlaylists": [{ "name": "L", "items": ["file:media/bg.png"] }] });
    let files: Vec<(String, PathBuf)> = ["media/bg.png", "media/ov.png", "media/font.ttf", "media/intro.png", "media/title.png", "icons/icon_game.png", "icons/tex_photo.png"].iter().map(|n| (n.to_string(), pic.clone()))
        .chain([("sounds/cursor.wav".to_string(), snd.clone()), ("sounds/coldboot.wav".to_string(), snd.clone())]).collect();
    let zip = crate::themes::create_custom(&themes, "Full Theme", &settings, &files).expect("theme made");
    let l = crate::themes::list_custom(&themes, &cache);
    assert_eq!(l.len(), 1);
    for (k, v) in settings.as_object().unwrap() { assert_eq!(&l[0]["settings"][k], v, "theme setting {k} kept in full"); }
    let dir = PathBuf::from(l[0]["dir"].as_str().unwrap());
    for (n, src) in &files { assert_eq!(fs::read(dir.join(n)).unwrap(), fs::read(src).unwrap(), "{n} kept"); }
    assert!(l[0]["icons"]["icon_game.png"].is_string() && l[0]["icons"]["tex_photo.png"].is_string(), "its icons listed");
    assert!(l[0]["sounds"].as_object().map(|m| m.len() == 2).unwrap_or(false), "its sounds listed: {}", l[0]["sounds"]);
    // listed again: the same (its unpacked copy used again)
    assert_eq!(crate::themes::list_custom(&themes, &cache), l);
    // its unpacked copy deleted while running (the cache cleared): unpacked again
    fs::remove_dir_all(&dir).unwrap();
    let l2 = crate::themes::list_custom(&themes, &cache);
    assert_eq!(l2.len(), 1); assert!(PathBuf::from(l2[0]["dir"].as_str().unwrap()).join("media/bg.png").is_file(), "unpacked again");
    // a damaged theme file beside it, an empty one, a file that isn't a theme: left out, the good one still listed
    fs::write(themes.join("Broken.zip"), &fs::read(&zip).unwrap()[..40]).unwrap();
    fs::write(themes.join("Empty.zip"), b"").unwrap();
    fs::write(themes.join("notes.txt"), b"hello").unwrap();
    let l3 = crate::themes::list_custom(&themes, &cache);
    assert_eq!(l3.iter().filter(|t| t["name"] == "Full Theme").count(), 1, "the good theme is still listed: {:?}", l3.iter().map(|t| t["name"].clone()).collect::<Vec<_>>());
    // the theme deleted while it's in use: no longer listed; the whole Themes folder deleted: an empty list
    fs::remove_file(&zip).unwrap();
    assert!(!crate::themes::list_custom(&themes, &cache).iter().any(|t| t["name"] == "Full Theme"));
    fs::remove_dir_all(&themes).unwrap();
    assert!(crate::themes::list_custom(&themes, &cache).is_empty());
    assert!(crate::themes::list_p3t(&themes, &cache).is_empty());
    assert!(crate::themes::list_icon_themes(&d.join("no_such")).is_empty() && crate::themes::list_sound_packs(&d.join("no_such")).is_empty());
    // PS3 themes: files that aren't themes (rubbish, cut short, empty) are left out, nothing breaks
    fs::create_dir_all(&themes).unwrap();
    for (n, data) in [("junk.p3t", vec![0x55u8; 2000]), ("empty.p3t", vec![]), ("short.p3t", b"P3TF\x00\x02".to_vec())] { fs::write(themes.join(n), data).unwrap(); }
    let _ = crate::themes::list_p3t(&themes, &cache);
    let _ = fs::remove_dir_all(&d);
}

// --------------------------------------------- media kept up to date ----
#[test]
fn media_follow_their_files() {
    let Some(_fm) = ffmpeg() else { eprintln!("(no ffmpeg on this machine: skipped)"); return; };
    let d = tmp("mediaup");
    let (lib, src, ix) = (d.join("Music"), d.join("src"), d.join("ix.json"));
    fs::create_dir_all(&lib).unwrap(); fs::create_dir_all(&src).unwrap();
    let song = |p: &Path, title: &str, secs: &str| assert!(ff(&["-f", "lavfi", "-i", &format!("sine=frequency=440:duration={secs}"), "-metadata", &format!("title={title}"), "-c:a", "libmp3lame", "-id3v2_version", "3", &s(p)]));
    song(&lib.join("one.mp3"), "One", "1"); song(&src.join("two.mp3"), "Two", "1");
    // (a song elsewhere, shown through a shortcut in the Music folder)
    let link = lib.join(format!("two.{}", crate::medialib::LINK_EXT));
    crate::medialib::write_link(&link, &src.join("two.mp3")).unwrap();
    let ex = crate::medialib::Extras { ffmpeg: None, covers: None };
    let list = || { let mut v: Vec<String> = crate::medialib::list(&[lib.clone()], "music", &ix, &ex, &|_, _| {}).into_iter().map(|m| m.title.unwrap_or(m.name)).collect(); v.sort(); v };
    assert_eq!(list(), vec!["One", "Two"]);
    // a song added while running; a song's tags changed (the file written again)
    song(&lib.join("three.mp3"), "Three", "1");
    assert_eq!(list(), vec!["One", "Three", "Two"]);
    std::thread::sleep(std::time::Duration::from_millis(1100));
    song(&lib.join("one.mp3"), "One (Remastered)", "2");
    assert_eq!(list(), vec!["One (Remastered)", "Three", "Two"], "a changed file is read again");
    // the song behind a shortcut deleted outside the System: gone from the list, nothing breaks
    fs::remove_file(src.join("two.mp3")).unwrap();
    assert_eq!(list(), vec!["One (Remastered)", "Three"]);
    // (put back: listed again)
    song(&src.join("two.mp3"), "Two", "1");
    assert_eq!(list(), vec!["One (Remastered)", "Three", "Two"]);
    // the shortcut itself deleted; a shortcut damaged
    fs::remove_file(&link).unwrap();
    fs::write(lib.join(format!("bad.{}", crate::medialib::LINK_EXT)), b"{ nope").unwrap();
    assert_eq!(list(), vec!["One (Remastered)", "Three"]);
    // the index (what's remembered of the files) damaged, then deleted: everything read again
    fs::write(&ix, b"{{{").unwrap();
    assert_eq!(list().len(), 2);
    let _ = fs::remove_file(&ix);
    assert_eq!(list().len(), 2);
    // the whole folder deleted while running: an empty list
    fs::remove_dir_all(&lib).unwrap();
    assert!(list().is_empty());
    let _ = fs::remove_dir_all(&d);
}

// ---------------------------------------------- games kept up to date ----
#[test]
fn games_follow_their_folders() {
    let d = tmp("gamesup");
    let (source, games, rec) = (d.join("PC Games"), d.join("Games"), d.join("rec.json"));
    for g in ["Alpha", "Beta", "Gamma"] { let gd = source.join(g); fs::create_dir_all(&gd).unwrap(); fs::write(gd.join(format!("{g}.exe")), vec![0u8; 2000]).unwrap(); }
    fs::create_dir_all(&games).unwrap();
    let srcs = vec![s(&source)];
    let sync = || crate::gamesrc::sync(&srcs, &games, &rec, None, &|_, _| {}).len();
    assert_eq!(sync(), 3, "three games recognized");
    assert_eq!(sync(), 0, "not made twice");
    let scan = || crate::library::scan(&[s(&games)], None);
    assert_eq!(scan().len(), 3);
    // a game added to the folder while running: recognized at the next look
    let gd = source.join("Delta"); fs::create_dir_all(&gd).unwrap(); fs::write(gd.join("Delta.exe"), vec![0u8; 2000]).unwrap();
    assert_eq!(sync(), 1); assert_eq!(scan().len(), 4);
    // a whole game deleted outside the System: its entry stays (it can't start: "missing"), nothing breaks
    fs::remove_dir_all(source.join("Beta")).unwrap();
    assert_eq!(sync(), 0);
    let all = scan();
    assert_eq!(all.len(), 4);
    let beta = all.iter().find(|g| g.title == "Beta").expect("Beta still listed");
    assert!(matches!(crate::launcher::plan(&beta.folder, &beta.launch), crate::launcher::LaunchPlan::Missing { .. }), "a deleted game's entry can't be started");
    // its shortcut deleted from inside the System's folder; another game's game.json damaged; a third's folder emptied
    let alpha = all.iter().find(|g| g.title == "Alpha").unwrap();
    for e in fs::read_dir(&alpha.folder).unwrap().flatten() { if e.path().extension().map(|x| x == crate::medialib::LINK_EXT).unwrap_or(false) { fs::remove_file(e.path()).unwrap(); } }
    let gamma = all.iter().find(|g| g.title == "Gamma").unwrap();
    fs::write(Path::new(&gamma.folder).join("game.json"), b"{ \"title\": ").unwrap();
    let after = scan();
    assert!(after.len() >= 2 && after.len() <= 4, "the Game column is still read ({} games)", after.len());
    let _ = sync();
    // a game's folder deleted from the Games folder by hand: gone, and not made again by itself
    let delta = all.iter().find(|g| g.title == "Delta").unwrap();
    fs::remove_dir_all(&delta.folder).unwrap();
    assert_eq!(sync(), 0, "a game deleted by hand isn't made again");
    assert!(!scan().iter().any(|g| g.title == "Delta"));
    // the list of what was recognized damaged, then the whole source folder gone: nothing breaks
    fs::write(&rec, b"[[[").unwrap();
    let _ = sync();
    fs::remove_dir_all(&source).unwrap();
    assert_eq!(sync(), 0);
    let _ = scan();
    // the Games folder itself deleted while running
    fs::remove_dir_all(&games).unwrap();
    assert!(scan().is_empty());
    let _ = fs::remove_dir_all(&d);
}

// ------------------------------------------------ caches and pictures ----
// A game renamed by hand: what the lookups may replace, and the list of the ones waiting for the internet
#[test]
fn a_renamed_game_is_looked_up_again() {
    let d = std::env::temp_dir().join(format!("xmb_renamed_{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    let g = d.join("Game"); fs::create_dir_all(&g).unwrap();
    fs::write(crate::library::meta_path(&g), r#"{"title":"Old","artSource":{"icon":"db","background":"user","preview":"ps3","music":"local"}}"#).unwrap();
    // (the databases' own and the program's icon may be replaced; chosen by hand or a PS3 game's own, never; none yet: yes)
    assert!(crate::gameart::renamed_may_replace(&g, "icon"));
    assert!(!crate::gameart::renamed_may_replace(&g, "background"));
    assert!(!crate::gameart::renamed_may_replace(&g, "preview"));
    assert!(crate::gameart::renamed_may_replace(&g, "music"));
    let bare = d.join("Bare"); fs::create_dir_all(&bare).unwrap();
    assert!(crate::gameart::renamed_may_replace(&bare, "icon"));
    // without a database set up, or a name: nothing is touched
    let r = crate::gameart::scrape_renamed(&g, "New Name", &Default::default(), None, 16.0 / 9.0);
    assert!(!r.icon && !r.background && !r.preview && r.name.is_none());
    assert!(fs::read_to_string(crate::library::meta_path(&g)).unwrap().contains("\"title\":\"Old\""));
    // the waiting list: added once, taken off, the file gone with the last one; damaged: as empty
    let f = d.join("renamed_pending.json");
    crate::renamed_pending_set(&f, "C:/g/a", true); crate::renamed_pending_set(&f, "C:/g/a", true); crate::renamed_pending_set(&f, "C:/g/b", true);
    assert_eq!(crate::renamed_pending(&f), vec!["C:/g/a".to_string(), "C:/g/b".to_string()]);
    crate::renamed_pending_set(&f, "C:/g/a", false); crate::renamed_pending_set(&f, "C:/g/zz", false);
    assert_eq!(crate::renamed_pending(&f), vec!["C:/g/b".to_string()]);
    crate::renamed_pending_set(&f, "C:/g/b", false);
    assert!(!f.exists() && crate::renamed_pending(&f).is_empty());
    fs::write(&f, b"{ not a list").unwrap();
    assert!(crate::renamed_pending(&f).is_empty());
    crate::renamed_pending_set(&f, "C:/g/c", true);
    assert_eq!(crate::renamed_pending(&f), vec!["C:/g/c".to_string()]);
    let _ = fs::remove_dir_all(&d);
}
#[test]
fn picture_copies_follow_their_pictures() {
    let Some(_fm) = ffmpeg() else { eprintln!("(no ffmpeg on this machine: skipped)"); return; };
    let d = tmp("thumbsup");
    assert!(ff(&["-f", "lavfi", "-i", "testsrc=size=1600x1200", "-frames:v", "1", &s(&d.join("a.jpg"))]));
    assert!(ff(&["-f", "lavfi", "-i", "testsrc2=size=1600x1200", "-frames:v", "1", &s(&d.join("b.jpg"))]));
    let dirs = crate::thumbs::Dirs { temp: d.join("t"), app: d.join("a") };
    let count = || fs::read_dir(&dirs.temp).map(|r| r.flatten().filter(|e| e.file_name() != "index.tsv").count()).unwrap_or(0);
    assert!(crate::thumbs::thumb(&d.join("a.jpg"), &dirs, false, None).is_some() && crate::thumbs::thumb(&d.join("b.jpg"), &dirs, false, None).is_some());
    assert_eq!(count(), 2);
    // the cache folder deleted while running: made again when asked
    fs::remove_dir_all(&dirs.temp).unwrap();
    assert!(crate::thumbs::thumb(&d.join("a.jpg"), &dirs, false, None).is_some());
    assert!(crate::thumbs::thumb(&d.join("b.jpg"), &dirs, false, None).is_some());
    // a picture deleted outside the System: no copy given, and its old copy goes at the next start
    fs::remove_file(d.join("b.jpg")).unwrap();
    assert!(crate::thumbs::thumb(&d.join("b.jpg"), &dirs, false, None).is_none());
    assert_eq!(crate::thumbs::sweep(&dirs), 1); assert_eq!(count(), 1);
    // a picture replaced by another under the same name: a new copy, the old one swept
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let before = crate::thumbs::thumb(&d.join("a.jpg"), &dirs, false, None).unwrap().0;
    assert!(ff(&["-f", "lavfi", "-i", "testsrc2=size=1200x1600", "-frames:v", "1", &s(&d.join("a.jpg"))]));
    let after = crate::thumbs::thumb(&d.join("a.jpg"), &dirs, false, None).unwrap().0;
    assert_ne!(before, after, "the new picture's copy");
    assert_eq!(crate::thumbs::sweep(&dirs), 1); assert_eq!(count(), 1);
    // a damaged copy in the cache, and a file that isn't a picture
    for e in fs::read_dir(&dirs.temp).unwrap().flatten() { if e.file_name() != "index.tsv" { fs::write(e.path(), b"xx").unwrap(); } }
    let _ = crate::thumbs::thumb(&d.join("a.jpg"), &dirs, false, None);
    fs::write(d.join("not.jpg"), b"hello").unwrap();
    let _ = crate::thumbs::thumb(&d.join("not.jpg"), &dirs, false, None);   // (given as it is, or nothing: nothing breaks)
    let _ = fs::remove_dir_all(&d);
}
