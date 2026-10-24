//! Data structures shared across the backend and sent to the frontend.
//! Everything the webview receives is `camelCase` (serde rename).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub folder: String,
    pub title: String,
    /// the folder that holds this game's folder (inside the Games folder), if any
    #[serde(default)] pub album: Option<String>,
    // game.json: Title, Parental Control (1-11, set by hand), Created (the
    // .exe / .lnk's last-modified date), Size, Version, isDisc, Console
    #[serde(default)] pub parental_control: Option<u32>,
    #[serde(default)] pub created: String,
    #[serde(default)] pub size: String,
    #[serde(default)] pub version: String,
    #[serde(default)] pub starts: String,
    #[serde(default)] pub is_disc: bool,
    #[serde(default)] pub console: String,
    // Game Settings: Game Options Band / Hide Game Title on Background (this
    // game only; None = not chosen yet: the band on, the title shown)
    #[serde(default)] pub options_band: Option<bool>,
    #[serde(default)] pub hide_title: Option<bool>,
    #[serde(default)] pub launch: String,
    #[serde(default)] pub args: Vec<String>,
    pub icon: Option<String>,
    pub background: Option<String>,
    pub preview: Option<String>,
    pub music: Option<String>,
    /// among games with the same title: 1 for the one that has been there
    /// longest, 2, 3... for the others (shown as "Title (2)")
    #[serde(default)] pub copy: u32,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameMeta {
    pub title: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub release_date: Option<String>,
    pub genre: Option<String>,
    pub players: Option<String>,
    pub launch: Option<String>,
}

/// Per-user personalization (the classic XMB "each profile has its own theme").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeSettings {
    pub background_color: String, // hex or "auto" (month color)
    pub wave_color: String,       // hex or "auto" (white); colours the wave band
    pub waves_enabled: bool,      // draw the waves at all
    pub dot_color: String,        // hex or "auto" (white); colours the dots
    pub dots_enabled: bool,       // draw the drifting dots at all
    pub icon_color: String,
    pub wallpaper: Option<String>,
    // Overlay drawn over the background: a transparent image, or a video whose
    // green-screen green is keyed out.
    #[serde(default)] pub overlay: Option<String>,
    // green-screen strength for a video overlay, 0..1 (None = 0.5)
    #[serde(default)] pub chroma_strength: Option<f64>,
    // the colour keyed out of a video overlay: "green" | "blue" | "#rrggbb" (None = green)
    #[serde(default)] pub chroma_key: Option<String>,
    // how the background fills the screen: "normal" | "zoom" | "full" | "original"
    #[serde(default)] pub wallpaper_fit: Option<String>,
    // last custom colour picked per colour setting: { bgcolor: "#…", … }
    #[serde(default)] pub custom_colors: Option<serde_json::Value>,
    pub active_theme: Option<String>,
    #[serde(default)] pub icon_style: Option<String>,    // "normal" | "glossy"
    // PlayStation®Network icon + title: "original" | "modern"
    #[serde(default)] pub psn_style: Option<String>,
    // Font (a font file's path; None = the system font), text + info-box colours
    #[serde(default)] pub font: Option<String>,
    #[serde(default)] pub text_color: Option<String>,
    #[serde(default)] pub clock_color: Option<String>,
    // text size in percent (None = 100)
    #[serde(default)] pub font_size: Option<u32>,
    // background / overlay shuffle: "off" | "all" | "pl:<playlist name>"
    #[serde(default)] pub bg_shuffle: Option<String>,
    #[serde(default)] pub ov_shuffle: Option<String>,
    // how long a picture stays (seconds) before the next one
    #[serde(default)] pub bg_interval: Option<u32>,
    // Background Playlists: [{ name, items: [paths] }] (pictures + videos)
    #[serde(default)] pub bg_playlists: Option<serde_json::Value>,
    #[serde(default)] pub wave_style: Option<String>,    // "A" (linkev) | "B" (xmbwave)
    // Wave Personalization: linkev spline/particle overrides, keyed "group:key"
    // (e.g. "spline:flowSpeed", "particle:count"). null → all defaults.
    #[serde(default)] pub wave_params: Option<serde_json::Value>,
    // Saved wave presets: [{ name, params: {"group:key": value, …} }].
    #[serde(default)] pub wave_presets: Option<serde_json::Value>,
    // Saved full-theme presets: [{ name, theme: {…all Theme Settings…} }].
    #[serde(default)] pub theme_presets: Option<serde_json::Value>,
    // every other theme setting the app stores (Month and Time Colors, …):
    // kept as-is so nothing set in the app is ever dropped when saving
    #[serde(flatten)] pub extra: serde_json::Map<String, serde_json::Value>,
}
impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            background_color: "auto".into(),
            wave_color: "auto".into(),
            waves_enabled: true,
            dot_color: "auto".into(),
            dots_enabled: true,
            icon_color: "auto".into(),
            wallpaper: None,
            overlay: None,
            chroma_strength: None,
            chroma_key: None,
            wallpaper_fit: None,
            custom_colors: None,
            active_theme: None,
            icon_style: None,
            psn_style: None,
            font: None, text_color: None, clock_color: None, font_size: None,
            bg_shuffle: None, ov_shuffle: None, bg_interval: None, bg_playlists: None,
            wave_style: None,
            wave_params: None,
            wave_presets: None,
            theme_presets: None,
            extra: Default::default(),
        }
    }
}

/// A local profile. Holds its own theme + which fake PSN account it's signed
/// into + a couple of personal toggles.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
    pub avatar: String, // "stock:sphere_teal" | "psn:psn_03" | absolute path
    #[serde(default)] pub psn_account_id: Option<String>,
    #[serde(default)] pub theme: ThemeSettings,
    #[serde(default = "yes")] pub sound_enabled: bool,
    #[serde(default = "yes")] pub music_enabled: bool,
    // background music selection: null | { mode, path?, name? } (per user, persisted)
    #[serde(default)] pub bg_music: Option<serde_json::Value>,
    #[serde(default)] pub psn_linked_id: Option<String>,   // last PSN account this user linked
    #[serde(default)] pub playlists: Option<serde_json::Value>, // [{ name, tracks: [path] }]
    #[serde(default)] pub photo_playlists: Option<serde_json::Value>, // [{ name, photos: [path] }]
    // Friend Personalization: { mode, count, min, max, cards: [{name,message,game,color}] }
    #[serde(default)] pub friend_config: Option<serde_json::Value>,
    // Media section sort mode, per kind: { music, photo, video }
    #[serde(default)] pub media_mode: Option<serde_json::Value>,
    // Game section order (game menu > Sort By): "title" | "created"
    #[serde(default)] pub game_sort: Option<String>,
    // this user's custom sections (System Settings > Sections)
    #[serde(default)] pub sections: Option<serde_json::Value>,
    // PSN Sign-In screen: Auto Sign-In and the saved Sign-In ID / password
    #[serde(default)] pub psn_auto_sign_in: Option<bool>,
    #[serde(default)] pub psn_saved: Option<serde_json::Value>,
    // this user's own copy of every system setting (behavior, keybinds, media /
    // game recognition modes): applied when they sign in
    #[serde(default)] pub settings_copy: Option<serde_json::Value>,

    #[serde(default)] pub created_at: String,
    #[serde(default)] pub last_login: String,
    // anything else the app stores on a user (kept as-is when saving)
    #[serde(flatten)] pub extra: serde_json::Map<String, serde_json::Value>,
}
fn yes() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsersFile {
    #[serde(default)] pub users: Vec<User>,
    #[serde(default)] pub active: Option<String>,
}

/// A fake PlayStation Network account the user can sign a profile into.
/// Email + password are stored locally and are entirely fake — this never
/// touches any real Sony service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsnAccount {
    pub id: String,
    pub online_id: String,       // the PSN "name"
    #[serde(default)] pub email: String,
    #[serde(default)] pub password: String, // fake/local only
    pub avatar: String,          // avatar ref, same scheme as User.avatar
    #[serde(default)] pub country: String,
    #[serde(default)] pub friends_online: u32, // fake count shown in the info box
    #[serde(default = "default_bg")] pub background: String, // profile card background colour
    #[serde(default)] pub comment: String,     // profile status/comment line
}

fn default_bg() -> String { "#868485".to_string() }   // the console's grey card

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PsnFile {
    #[serde(default)] pub accounts: Vec<PsnAccount>,
}

/// App-level settings (shared across users): where content lives + behavior.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Behavior {
    pub fullscreen: bool,
    pub autostart: bool,
    pub boot_animation: bool,
    pub boot_sound: String, // "coldboot"
    #[serde(default = "vol_full")] pub volume: u8,       // System Volume 0..100 (on top of the two below)
    #[serde(default = "vol_full")] pub music_volume: u8, // Music Volume 0..100
    #[serde(default = "vol_full")] pub sfx_volume: u8,   // Sound Effects Volume 0..100
    #[serde(default = "vol_full")] pub brightness: u8,   // Screen brightness 20..100
    #[serde(default = "fmt24")] pub time_format: String, // "24" | "12"
    #[serde(default = "fmt_date")] pub date_format: String, // "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY/MM/DD"
    #[serde(default = "yes_bool")] pub play_audio_background: bool,
    // When true, temp working files (decoded WAVs in the OS temp dir) are
    // deleted when the system closes. Defaults ON.
    #[serde(default = "yes_bool")] pub delete_temp_files: bool,
    // When true, decoded song data is stored in a folder inside the system's own
    // directory (persists across restarts) instead of the OS temp dir.
    #[serde(default)] pub keep_preloaded_songs: bool,
    #[serde(default)] pub keep_preloaded_videos: bool,
    // When true, ALL cache/working data (decoded songs, covers) is stored in the
    // system's own directory so it persists and reloads instantly next launch.
    #[serde(default)] pub cache_in_app_dir: bool,
    // VSync (on by default). Off lifts the frame-rate cap; applied at start-up.
    #[serde(default = "yes_bool")] pub vsync: bool,
    // the sparkles follow a PlayStation controller's motion sensors
    #[serde(default = "yes_bool")] pub motion_sparkles: bool,
    // Power Save Settings > Low Performance Mode (out of focus / in a game)
    #[serde(default)] pub low_power_mode: bool,
    // Accessory Settings > On-Screen Keyboard (for text fields)
    #[serde(default = "yes_bool")] pub virtual_keyboard: bool,
    // how strongly the sparkles follow the controller, 0..100 % (default 5)
    #[serde(default = "motion5")] pub motion_strength: u8,
    // "native" or "WIDTHxHEIGHT": the window size in windowed mode, the
    // render resolution of the background in full screen
    #[serde(default = "res_native")] pub resolution: String,
    // anything else the app stores here (kept as-is when saving)
    #[serde(flatten)] pub extra: serde_json::Map<String, serde_json::Value>,
}
fn motion5() -> u8 { 5 }
fn res_native() -> String { "native".into() }
fn vol_full() -> u8 { 100 }
fn fmt24() -> String { "24".into() }
fn fmt_date() -> String { "DD/MM/YYYY".into() }
fn yes_bool() -> bool { true }
impl Default for Behavior {
    fn default() -> Self {
        Self { fullscreen: true, autostart: false, boot_animation: true, boot_sound: "coldboot".into(), volume: 100, music_volume: 100, sfx_volume: 100, brightness: 100, time_format: "24".into(), date_format: "DD/MM/YYYY".into(), play_audio_background: true, delete_temp_files: true, keep_preloaded_songs: false, keep_preloaded_videos: false, cache_in_app_dir: false, vsync: true, motion_sparkles: true, low_power_mode: false, virtual_keyboard: true, motion_strength: 5, resolution: res_native(), extra: Default::default() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InputSettings {
    pub controller: bool,
    pub keyboard: bool,
    pub mouse: bool,
    pub deadzone: f32,
    // Keyboard / mouse bindings per action: { "enter": "Enter", … } (null = defaults)
    #[serde(default)] pub keybinds: Option<serde_json::Value>,
}
impl Default for InputSettings {
    fn default() -> Self {
        Self { controller: true, keyboard: true, mouse: true, deadzone: 0.5, keybinds: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub library_paths: Vec<String>,
    pub music_paths: Vec<String>,
    pub photo_paths: Vec<String>,
    pub video_paths: Vec<String>,
    pub background_paths: Vec<String>,
    #[serde(default)]
    pub subtitle_paths: Vec<String>,
    pub behavior: Behavior,
    pub input: InputSettings,
    // Where Music / Videos / Photos / Subtitles are read from:
    // "app" = the folders inside the app directory, "custom" = the folders below
    #[serde(default = "mode_app")] pub media_mode: String,
    #[serde(default)] pub media_folders: MediaFolders,
    // Game recognition: "app" = only content/Games, "sources" = also detect
    // games in the source folders below (each gets a folder in content/Games)
    #[serde(default = "mode_app")] pub game_mode: String,
    #[serde(default)] pub game_sources: Vec<String>,
    // Game Databases (Settings): API keys and Automatic Scraping
    #[serde(default)] pub scrape: crate::gameart::ScrapeSettings,
    // custom sections (System Settings > Sections): [{ id, name, icon, after,
    // subs: [{ title, desc, icon, folders: [..], type }] }]
    #[serde(default)] pub sections: Option<serde_json::Value>,
    // anything else the app stores in the settings (kept as-is when saving)
    #[serde(flatten)] pub extra: serde_json::Map<String, serde_json::Value>,
}
fn mode_app() -> String { "app".into() }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaFolders {
    // each kind can have several folders (older settings stored one path)
    #[serde(deserialize_with = "str_or_list")] pub music: Vec<String>,
    #[serde(deserialize_with = "str_or_list")] pub videos: Vec<String>,
    #[serde(deserialize_with = "str_or_list")] pub photos: Vec<String>,
    #[serde(deserialize_with = "str_or_list")] pub subtitles: Vec<String>,
}
fn str_or_list<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match v {
        serde_json::Value::String(s) if !s.trim().is_empty() => vec![s],
        serde_json::Value::Array(a) => a.into_iter()
            .filter_map(|x| x.as_str().map(str::to_string)).filter(|s| !s.trim().is_empty()).collect(),
        _ => vec![],
    })
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            library_paths: vec![],
            music_paths: vec![],
            photo_paths: vec![],
            video_paths: vec![],
            background_paths: vec![],
            subtitle_paths: vec![],
            behavior: Behavior::default(),
            input: InputSettings::default(),
            media_mode: mode_app(),
            media_folders: MediaFolders::default(),
            game_mode: mode_app(),
            game_sources: vec![],
            scrape: Default::default(),
            sections: None,
            extra: Default::default(),
        }
    }
}

/// A media file with whatever metadata we could read from it.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaItem {
    pub name: String,
    pub path: String,
    pub ext: String,
    pub size: u64,
    pub modified: u64,
    // optional metadata (populated per kind)
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<String>,
    pub genre: Option<String>,
    pub track: Option<u32>,
    pub disc: Option<u32>,
    pub duration_secs: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// cached embedded cover-art file path (music only), when one exists
    pub cover: Option<String>,
    /// video only: the 15-second clip set with "Change Icon" (plays as the icon)
    pub clip: Option<String>,
    /// true when the file sits directly in a media folder (not in a subfolder):
    /// its "album" is then Unknown
    pub in_root: bool,
    /// the folder (inside the app's Music / Photos / Videos folder) the file or
    /// its shortcut sits in, for "By Folder" / "By Album"; None at the top
    pub folder: Option<String>,
    /// the app's shortcut file (.xmbl) when the file lives elsewhere
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub ok: bool,
    pub pid: Option<u32>,
    pub message: String,
}

#[cfg(test)]
mod keep_extra_tests {
    use super::*;
    #[test]
    fn theme_and_behavior_keep_unknown_fields() {
        let t: ThemeSettings = serde_json::from_str(r##"{"waveColor":"#ff0000","monthColors":false}"##).unwrap();
        let back = serde_json::to_value(&t).unwrap();
        assert_eq!(back["monthColors"], serde_json::json!(false));
        assert_eq!(back["waveColor"], serde_json::json!("#ff0000"));
        let b: Behavior = serde_json::from_str(r#"{"volume":40,"waveV2":true}"#).unwrap();
        let back = serde_json::to_value(&b).unwrap();
        assert_eq!(back["waveV2"], serde_json::json!(true));
        assert_eq!(back["volume"], serde_json::json!(40));
    }
}
