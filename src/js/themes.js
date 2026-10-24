// The system's icons, by name, and the themes that replace them.
//
// The icons a PS3 theme (.p3t) can replace are in assets/icons/theme and
// carry the theme's own names for them (icon_game.png, icon_setting.png...);
// the rest are in assets/icons/system. A PS3 theme or an Icon Theme replaces
// the icons it has (an Icon Theme comes before a PS3 theme); the others stay.
import { assetUrl } from "./api.js";

// the names these icons had before (saved sections and settings may still use
// them), and copies of an icon that were merged into one picture
const RENAMED = {
  "accessory.png": "icon_accessory.png",
  "accountmanage.png": "icon_accountmanage.png",
  "addfriend.png": "icon_addfriend.png",
  "avatar_arrow.png": "tex_arrow_r.png",
  "bdvd_setting.png": "icon_bdvd_setting.png",
  "blocklist.png": "icon_blocklist.png",
  "browser.png": "icon_browser.png",
  "chat_room.png": "icon_chatroom_text.png",
  "chat_setting.png": "icon_chat_setting.png",
  "chatroom_text.png": "icon_chatroom_text.png",
  "datetime_setting.png": "icon_datetime_setting.png",
  "default_h.png": "icon_default_h.png",
  "default_video.png": "icon_video_default.png",
  "display_setting.png": "icon_display_setting.png",
  "dl_management.png": "icon_download.png",
  "friend.png": "icon_friend.png",
  "game.png": "icon_game.png",
  "game_setting.png": "icon_game_setting.png",
  "gamedata.png": "icon_gamedata.png",
  "inet_search.png": "icon_inet_search.png",
  "media_servers.png": "icon_mediaserver_search.png",
  "message_box.png": "icon_mbox.png",
  "music.png": "icon_music.png",
  "music_album_default.png": "icon_music_album_default.png",
  "music_default.png": "icon_music_default.png",
  "music_folder_default.png": "icon_music_album_default.png",
  "music_setting.png": "icon_music_setting.png",
  "network.png": "icon_network.png",
  "network_setting.png": "icon_network_setting.png",
  "newuser.png": "icon_newuser.png",
  "newuser_real.png": "icon_newuser.png",
  "onlinemanual.png": "icon_onlinemanual.png",
  "photo.png": "icon_photo.png",
  "photo_album_default.png": "icon_photo_album_default.png",
  "photo_default.png": "icon_photo_default.png",
  "photo_folder_default.png": "icon_photo_album_default.png",
  "photo_playlist.png": "icon_playlist.png",
  "playermet.png": "icon_playermet.png",
  "playlist.png": "icon_playlist.png",
  "playlist_add.png": "icon_playlist_add.png",
  "poweroff.png": "icon_poweroff.png",
  "powersave_setting.png": "icon_powersave_setting.png",
  "printer_setting.png": "icon_printer_setting.png",
  "remoteplay.png": "icon_remoteplay.png",
  "remoteplay_setting.png": "icon_remoteplay_setting.png",
  "savedata.png": "icon_savedata.png",
  "security_setting.png": "icon_security_setting.png",
  "setting.png": "icon_setting.png",
  "setting_generic.png": "icon_setting_item.png",
  "setting_item.png": "icon_setting_item.png",
  "sound_setting.png": "icon_sound_setting.png",
  "start_chat.png": "icon_chat.png",
  "system_setting.png": "icon_system_setting.png",
  "tex_friend.png": "icon_friend.png",
  "tex_music.png": "icon_music.png",
  "tex_network.png": "icon_network.png",
  "tex_tv.png": "icon_tv.png",
  "tex_upload_icon.png": "icon_video_upload.png",
  "tex_video.png": "icon_video.png",
  "theme_setting.png": "icon_theme_setting.png",
  "trophy.png": "icon_trophy.png",
  "tv.png": "icon_tv.png",
  "update.png": "icon_update.png",
  "user.png": "icon_user.png",
  "util_bddata.png": "icon_gamedata.png",
  "util_gamedata.png": "icon_gamedata.png",
  "util_memcard.png": "icon_vmc.png",
  "util_psvita.png": "icon_gamedata.png",
  "util_saved_ps3.png": "icon_savedata.png",
  "util_saved_psp.png": "icon_savedata_minis.png",
  "video.png": "icon_video.png",
  "video_album_default.png": "icon_video_album_default.png",
  "video_default.png": "icon_video_default.png",
  "video_folder_default.png": "icon_video_album_default.png",
};

// other system pictures showing the same thing as a theme icon (a bigger or
// wider version of it): a theme's icon replaces them too
const SAME_AS = {
  // the categories' icons (the same pictures, with the system's gloss on them)
  "tex_user.png": "icon_user.png",
  "tex_sysconf.png": "icon_setting.png",
  "tex_photo.png": "icon_photo.png",
  "tex_game.png": "icon_game.png",
  "tex_friend_small.png": "icon_friend.png",
  // the media sections' default pictures (wider versions)
  "default_photo.png": "icon_photo_default.png",
  "default_music.png": "icon_music_default.png",
};

/** A saved icon name as it's called now. */
export const sysName = (n) => RENAMED[n] || n;

/** The system's own picture for an icon name. */
export function sysBase(n) {
  n = sysName(n);
  return `./assets/icons/${n.startsWith("icon_") ? "theme" : "system"}/${n}`;
}

// the themes in use: { key, icons: { "icon_game.png": url }, opts }
let p3t = null, iconTheme = null, customTheme = null;
export function setActiveThemes(ps3, icons, custom) { p3t = ps3 || null; iconTheme = icons || null; customTheme = custom || null; }
// (an Icon Theme's icons come first, then a Custom Theme's, then a PS3 theme's)
export const activeThemes = () => [iconTheme, customTheme, p3t].filter(Boolean);

const P3T_KEEP = new Set(["icon_music_album_default.png", "icon_photo_album_default.png", "icon_video_album_default.png",
  "icon_music_default.png", "icon_photo_default.png", "icon_video_default.png"]);
/** The active themes' picture for an icon, if one replaces it: { url, key, opts }. */
export function themeIcon(name) {
  if (!name) return null;
  const n = sysName(name), lower = n.toLowerCase(), alias = SAME_AS[n];
  for (const t of activeThemes()) {
    // a PS3 theme no longer replaces the media folders' pictures or the
    // pictures media without a thumbnail get (the system's stay)
    if (t === p3t && P3T_KEEP.has(lower)) continue;
    const file = t.icons[lower] ? lower : alias && t.icons[alias] ? alias : null;
    // (the themes' pictures are loaded up front: their blob: copies are used)
    const p = file && t.icons[file];
    if (p) return { url: /^(blob:|data:|https?:|\.\/)/.test(p) ? p : assetUrl(p), key: t.key, file, opts: t.opts || {} };
  }
  return null;
}

/** The picture shown for an icon name: a theme's, or the system's. */
export function sysUrl(name) {
  const t = themeIcon(name);
  return t ? t.url : sysBase(name);
}

// A PS3 theme's own parts ("Theme Settings" in its menu): each can be turned
// off (all on to begin with). [key, title, description]
export const THEME_PARTS = [
  ["tBackground", "Theme Background", "The theme's background: its picture, or the pictures its animated scene is made of. Off: your own background (picture, video or colour) is shown in its place."],
  ["tOverlay", "Theme Overlay", "An animated theme's moving effects, drawn over its background (smoke, snow, lights, glows, logos...). With Theme Background off, they're drawn over your own background and waves."],
  ["tIcons", "Theme Icons", "The theme's icons in place of the system's."],
  ["tSounds", "Theme Sounds", "The theme's sound effects (moving the cursor, choosing, going back, opening an option menu, accepting)."],
  ["tColor", "Theme Color", "The colour the theme chooses (a month's colour, or Original) for the background, the waves, the sparkles and the default folders."],
  ["tInfoBox", "Info Box Color", "The theme's notification box for the messages at the bottom left, and its colour for the info box at the top right."],
  ["tClock", "Clock Color", "The theme's colour (its notification box's) for the clock at the top right. Off: the clock keeps your own Clock Color."],
];
// Your own Theme Settings that can stay on with a theme ("Custom Settings" in
// its menu). They start off, so the theme looks as it was made.
export const THEME_OPTS = [
  ["iconColor", "Icon Color", "On: the theme's icons are filled with your Icon Color, like the other icons. Off: they keep the theme's own colours."],
  ["iconStyle", "Icon Style", "On: your Icon Style's shading is drawn on the theme's icons. Off: they're shown flat, as they are in the theme."],
  ["waves", "Waves", "On: your waves are drawn over the theme. Off: no waves while this theme is on."],
  ["sparkles", "Sparkles", "On: your sparkles are drawn over the theme. Off: no sparkles while this theme is on."],
  ["background", "Background", "On: your background picture or video (and Background Shuffle) is shown over the theme's background. Off: it's hidden while this theme is on (unless Theme Background is off)."],
  ["overlay", "Overlay", "On: your overlay (and Overlay Shuffle) is shown. Off: it's hidden while this theme is on."],
  // (Icon Sets only: their icons see-through like the system's; Off to begin with)
  ["iconAlpha", "Transparency", ""],
];

/** A theme option's value: as set in the theme's menu, or its starting value
 * (a theme's own parts on, your own settings off). */
export function themeOpt(stored, key) {
  if (stored && typeof stored[key] === "boolean") return stored[key];
  return THEME_PARTS.some((p) => p[0] === key);
}

/** Whether a customization stays on with the themes in use (off if any of them turns it off). */
export const customizationOn = (key) => activeThemes().every((t) => (t.opts || {})[key] !== false);

/** A media player's icon: an icon set's picture for it (its Music Player /
 * Video Player / Photo Viewer folder: "mp", "vp", "pv"), or the system's. */
export function playerIcon(player, name, fallback) {
  const t = themeIcon(`${player}:${name}.png`);
  return t ? t.url : fallback;
}
