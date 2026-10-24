// The XMB cross. Authentic category + sub-item structure with drill-in
// navigation (Circle backs out), flat/transparent styling, big icons, a
// Users-locked boot, right-side option menus for games/users (Reference_1),
// and a faithful PlayStation Network sign-up / sign-in flow.

import { call, assetUrl, thumbUrl, stillUrl, bumpAsset, noExt, Input, cmpText, cmpBase, cmpNatural } from "./api.js";
import { sysName, sysBase, sysUrl, themeIcon, setActiveThemes, THEME_OPTS, THEME_PARTS, themeOpt, customizationOn, activeThemes } from "./themes.js";
import { MONTH_COLORS } from "./wave.js";
import { ThemeBackground } from "./p3tbg.js";
import { setLayerMedia, setOverlayMedia, isVideoPath } from "./chroma.js";
import { fitMedia, FIT_MODES } from "./fit.js";
import { shadeIcon, cachedShade, shadeSrc, loadIconImage, loadedIcon, importShades, exportShades, takeNewShadeCount, colorKey, pruneShades } from "./iconshade.js";
import { REAL_WAVE_DEFAULTS, REAL_PARTICLE_DEFAULTS, COMPLEX_EXTRA_DEFAULTS, COMPLEX_GRADIENT_PRESETS } from "./wavegl.js";
import { Keybinds, ACTIONS as KEY_ACTIONS, keyLabel, codeToVk } from "./keybinds.js";
import { VideoPlayer } from "./videoplayer.js";
import { PhotoViewer } from "./photoviewer.js";
import { isDocPath, docThumb } from "./docs.js";
import { GameMenu, GameInfo, GameConfirm } from "./gamemenu.js";
import { UserInfo, IconChooser } from "./usermenus.js";
import { SectionMethods, SECTION_MODES } from "./sections.js";
import { KeybindMenu, ColorPicker, parseColor, colorHex, SideMenu, GameInfoPanel, TextForm, AvatarPicker, ListPicker, Confirm, MusicPlayer, PlaylistPicker, PhotoGrid, ProfileCard, PsnSignIn, holdAccel, VIRTUAL_KB, avatarSrc, isMaskAvatar, ALL_AVATARS, PSN_AVATARS, PSN_DEFAULT_AVATAR, randomPsnAvatar, avWaitCheck, STOCK_AVATARS, isStockAvatar, OnScreenKeyboard } from "./ui.js";

// Layout metrics as FRACTIONS of the viewport, measured pixel-for-pixel from
// real 1920x1080 XMB captures (Settings / Network / Game / PSN / Friends), so
// the cross keeps the same proportions at any window size / display scale.
// Horizontal values are /1920 of the width, vertical values /1080 of the height.
const SPINE_X = 0.295;        // selected category icon + sub-item spine, x (≈566px)
// Before anyone logs in the single "Log In" column sits in the centre of the
// screen (x 960, Log In capture); afterwards the cross uses SPINE_X.
let spineNow = SPINE_X;
const CAT_Y = 290 / 1080;     // UNselected category icon centres, y
const CAT_SEL_Y = 281 / 1080; // selected category icon centre (bigger icon, same baseline)
const CAT_GAP_SEL = 210 / 1920; // selected category ↔ its neighbours, x
const CAT_GAP = 199 / 1920;     // pitch between the other category icons, x
const ITEM_SPINE_Y = 505 / 1080;  // selected sub-item centre, y
const ITEM_BELOW_Y = 680 / 1080;  // first sub-item BELOW the selection, centre y
const ITEM_ABOVE_Y = 120 / 1080;  // first sub-item ABOVE the selection (above the category row), centre y
const ITEM_PITCH = 80 / 1080;     // pitch between non-selected sub-items (and compact friend cards)
const GAME_PITCH = 96 / 1080;     // game icons are 16:9 art, slightly taller rows
const CARD_X = 86 / 1920;         // selected friend card: left edge sits this far left of the spine
const CARD_COMPACT_X = 36 / 1920; // compact card: avatar frame starts this far left of the spine
// Drilled sub-menus (measured from a real capture, Music > album): the open
// list's icons sit at x 625, the parent's anchor icon at x 303 with the back
// arrow at x 425, and the parent's other rows stay barely visible at x 455.
const DRILL_ACTIVE_X = 625 / 1920;
const DRILL_ANCHOR_X = 303 / 1920;
const DRILL_STEP = 322 / 1920;     // further ancestors step left by this much
const GHOST_DX = 152 / 1920;       // parent's other rows, right of its anchor
const DWELL_MS = 1200;
const IDLE_FADE_COLS = ["photo", "music", "video", "game", "network", "psn"];
// fixed subsections at the top of the Photo / Video columns (before the media)
const FIXED_ITEMS = { photo: 3, video: 4 };
const HOME_DESC = "Play games and meet friends in PlayStation\u00aeHome,\nthe definitive social gaming network only on PlayStation\u00ae3 system.";
// a game folder named any way as "PlayStation Home" (PlayStation®Home,
// playstation_home, PS3 Home…) can be launched from PSN > PlayStation®Home
// a game's name as listed: games with the same title are numbered, "Title (2)"
// (the one that has been there longest keeps the title)
const gameName = (g) => { const t = noExt(g.title); return g.copy > 1 ? `${t} (${g.copy})` : t; };
// a folder path as Windows shows it (one "\\" between folders)
const winPath = (p) => String(p == null ? "" : p).replace(/\//g, "\\").replace(/\\{2,}/g, (m, o) => o === 0 ? m : "\\");
// the system's own columns after Users, in their order
const BASE_COLUMNS = ["settings", "photo", "music", "video", "tvvideo", "game", "network", "psn", "friends"];
const isHomeGame = (g) => /^(playstation|playstation3|ps|ps3)home$/.test(String(g && (g.title || g.folder) || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
// game.json "console" values (Game Settings) and their "By Format" folder names
// Console (game.json "console"): [key, format name (By Format folders), badge]
const CONSOLE_TABLE = [
  ["PC", "PC", "tex_vc_pc.png"],
  ["PS1", "PlayStation\u00ae", "item_tex_ps1format.png"],
  ["PS2", "PlayStation\u00ae2", "item_tex_ps2format.png"],
  ["PS3", "PlayStation\u00ae3", "item_tex_ps3format.png"],
  ["PS4", "PlayStation\u00ae4", "item_tex_ps4format.png"],
  ["PS5", "PlayStation\u00ae5", "item_tex_ps5format.png"],
  ["PSP", "PSP\u2122", "item_tex_pspformat.png"],
  ["PSP Remaster", "PSP\u2122 Remaster", "item_tex_pspemuformat.png"],
  ["PS minis", "minis", "item_tex_minisformat.png"],
  ["PS Vita", "PS Vita", "item_tex_vitaformat.png"],
  ["Xbox", "Xbox", "tex_vc_xbox.png"],
  ["Xbox 360", "Xbox 360", "tex_vc_xbox360.png"],
  ["Xbox One", "Xbox One", "tex_vc_xboxone.png"],
  ["Xbox Series X|S", "Xbox Series X|S", "tex_vc_xboxseries.png"],
  ["Switch", "Nintendo Switch", "tex_vc_switch.png"],
  ["Switch 2", "Nintendo Switch 2", "tex_vc_switch2.png"],
  ["Wii", "Wii", "tex_vc_wii.png"],
  ["Wii U", "Wii U", "tex_vc_wiiu.png"],
  ["GameCube", "Nintendo GameCube", "tex_vc_gamecube.png"],
  ["N64", "Nintendo 64", "tex_vc_n64.png"],
  ["SNES", "Super Nintendo", "tex_vc_snes.png"],
  ["NES", "Nintendo Entertainment System", "tex_vc_nes.png"],
  ["Game Boy", "Game Boy", "tex_vc_gb.png"],
  ["Game Boy Color", "Game Boy Color", "tex_vc_gbc.png"],
  ["GBA", "Game Boy Advance", "tex_vc_gba.png"],
  ["DS", "Nintendo DS", "tex_vc_ds.png"],
  ["3DS", "Nintendo 3DS", "tex_vc_3ds.png"],
  ["Genesis", "Sega Genesis / Mega Drive", "tex_vc_genesis.png"],
  ["Saturn", "Sega Saturn", "tex_vc_saturn.png"],
  ["Dreamcast", "Dreamcast", "tex_vc_dreamcast.png"],
  ["Game Gear", "Game Gear", "tex_vc_gamegear.png"],
  ["Neo Geo", "NEOGEO", "item_tex_neogeoformat.png"],
  ["PC Engine", "PC Engine", "item_tex_pceformat.png"],
];
const CONSOLES = CONSOLE_TABLE.map((c) => c[0]);
const FORMAT_NAMES = Object.fromEntries(CONSOLE_TABLE.map((c) => [c[0], c[1]]));
// the console badge shown on the right of the selected game (PS3-style); a
// console that isn't in the list gets the blank badge with its name written on
function consoleBadge(c) {
  const key = String(c || "PS3");
  const row = CONSOLE_TABLE.find((r) => r[0].toLowerCase() === key.toLowerCase());
  return row
    ? `<img class="game-fmt" src="./assets/icons/consoles/${row[2]}" alt="">`
    : `<span class="game-fmt game-fmt-txt" style="background-image:url('./assets/icons/consoles/tex_vc_none.png')"><span style="font-size:${
      key.length <= 6 ? 1.35 : key.length <= 9 ? 1.1 : key.length <= 13 ? 0.85 : 0.7}vh">${esc(key)}</span></span>`;
}
// the disc shown for a game set as "Disc" (PS1 / PS2 / PS3, otherwise the default)
const discIcon = (c) => `./assets/icons/discs/${["PS1", "PS2", "PS3"].includes(c) ? c : "default"}.png`;
const DISC_HOLD_MS = 2000;   // the disc game keeps its disc this long when selected
// (names, Online IDs and messages: up to 255 characters, any character)
const MSG_LIMIT = 255;
const NAME_LIMIT = 255;
const FRIEND_MAX = 99;  // most friends that can be shown

// Sort/group modes for the media sections, cycled with the Square button.
// `flat: true` means a flat list (no folders), just re-sorted. Others group the
// items into folder drills by a key derived in _groupName().
// Game Settings: the game's own files (icon.*, background.*, preview.*, music.*)
const GAME_MEDIA = [
  { kind: "icon", key: "icon", title: "Icon", from: ["photo"], exts: ["png", "jpg", "jpeg", "webp", "gif"],
    desc: "The game's icon: square or 16:9, shown in its own shape. Choose a picture from the Photos folder, any file, or remove it." },
  { kind: "background", key: "background", title: "Background", from: ["photo"], exts: ["png", "jpg", "jpeg", "webp"],
    desc: "The picture shown behind the menu while the game is selected." },
  { kind: "preview", key: "preview", title: "Video", from: ["video", "photo"], exts: ["mp4", "webm", "mov", "gif"],
    desc: "The video or GIF that plays in place of the icon while the game is selected." },
  { kind: "music", key: "music", title: "Music", from: ["music"], exts: ["flac", "wav", "ogg", "mp3", "opus", "m4a", "aac"],
    desc: "The song that plays while the game is selected." },
];
// the last part of a folder's path ("D:\\SteamLibrary\\steamapps\\common" → "common")
const folderName = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || String(p || "");
// "Tools" → "Tools'", "Hades" → "Hades'", "Portal" → "Portal's"
const poss = (name) => { const n = String(name || "").trim(); return /s$/i.test(n) ? `${n}'` : `${n}'s`; };
const MEDIA_MODES = {
  music: [
    { id: "all", label: "All" },
    { id: "album", label: "By Album" },
    { id: "artist", label: "By Artist" },
    { id: "genre", label: "By Genre" },
    { id: "track", label: "By Track", flat: true },
    { id: "title", label: "By Title" },
    { id: "year", label: "By Release Year" },
  ],
  photo: [
    { id: "all", label: "All" },
    { id: "month", label: "By Month" },
    { id: "year", label: "By Year" },
    { id: "album", label: "By Album" },
  ],
  game: [
    { id: "all", label: "All" },
    { id: "format", label: "By Format" },
    { id: "album", label: "By Album" },
  ],
  video: [
    { id: "all", label: "All" },
    { id: "title", label: "By Title" },
    { id: "month", label: "By Month" },
    { id: "album", label: "By Album" },
  ],
};

// Wave and Sparkles Personalization: the linkev/PlayStation-3-XMB spline + particle controls,
// exposed as adjustable numeric settings. Each entry: [group, key, label, min,
// max, step, decimals]. `group` is "spline" (RealWave.settings) or "particle"
// (RealWave.particleSettings). These mirror the sliders in the original GitHub
// test so the wave can be tuned exactly as it is there.
// the parts of the settings each user keeps their own copy of
const USER_SETTING_KEYS = ["behavior", "input", "mediaMode", "gameMode"];
// Display Settings > Resolution
// picture folders: the grid (see _layoutGrid)
// column centres at x 630 + 243·n @1920 (the first one on the item spine);
// each picture fits a 207×155 box, the selected one a 255×190 box (captures)
const GRID_COLS = 5, GRID_X0 = 5, GRID_DX = 243;
const GRID_BOX = [207, 155], GRID_BOX_SEL = [255, 190];
// Display Settings > FPS Cap: "display" = the display's own refresh rate
const FPS_CAPS = ["display", "30", "60", "120"];
const fpsCapOf = (v) => FPS_CAPS.includes(String(v)) ? String(v) : "display";
const fpsCapLabel = (v) => { const c = fpsCapOf(v); return c === "display" ? "Display Refresh Rate" : `${c} FPS`; };
const RESOLUTIONS = ["native", "1280x720", "1600x900", "1920x1080", "2560x1440", "3840x2160"];
// "Complex" wave style (linkev/PlayStation-3-XMB, MIT): every setting of the
// original's Spline and Particles panels, plus the ones added here (its own
// background colours, the wave's height / tilt / thickness, band frequency,
// body fill, sparkle height). Each linkev range goes from 0 (or below, for
// the settings that can be negative) up to twice its original maximum.
// Entry: [group, key, label, min, max, step, decimals, description?, labels?]
const COMPLEX_GRADIENT_LABELS = ["Custom Colors", ...COMPLEX_GRADIENT_PRESETS.map((p) => p[0])];
const WAVE_PARAM_META = [
  // --- Background ---
  ["spline", "gradientPreset", "Gradient Preset", 0, COMPLEX_GRADIENT_PRESETS.length, 1, 0,
    "Custom Colors uses the Top / Bottom colours below; the others are the original month gradients (Day / Night). A Background Color other than Original uses that colour instead (with Gradient Top / Bottom).", COMPLEX_GRADIENT_LABELS],
  ["spline", "bgTopR", "Top Color: Red", 0, 255, 1, 0],
  ["spline", "bgTopG", "Top Color: Green", 0, 255, 1, 0],
  ["spline", "bgTopB", "Top Color: Blue", 0, 255, 1, 0],
  ["spline", "bgBotR", "Bottom Color: Red", 0, 255, 1, 0],
  ["spline", "bgBotG", "Bottom Color: Green", 0, 255, 1, 0],
  ["spline", "bgBotB", "Bottom Color: Blue", 0, 255, 1, 0],
  ["spline", "bgAngle", "Gradient Angle", 0, 360, 1, 0, "90 = top to bottom; higher leans the bright side to the left."],
  ["spline", "bgSpan", "Gradient Length", 0.02, 1, 0.01, 2, "How far across the screen the gradient goes before it reaches its end colour (1 = all the way)."],
  ["spline", "bgCurve", "Gradient Curve", 0.2, 4, 0.05, 2, "1 = the usual smooth blend. Higher: the start colour fades quickly at first, then slowly into the end colour (lower: the other way)."],
  ["spline", "gradientTopMul", "Gradient Top", 0, 2.4, 0.005, 3, "With a Background Color other than Original: how bright the top is (1 = the colour itself)."],
  ["spline", "gradientBotMul", "Gradient Bottom", 0, 2.4, 0.005, 3, "With a Background Color other than Original: how bright the bottom is (1 = the colour itself)."],
  // --- Placement ---
  ["spline", "posY", "Wave Height", -2, 2, 0.01, 2, "Moves the whole wave up or down."],
  ["spline", "tilt", "Wave Tilt", -2, 2, 0.01, 2, "Raises the right side and lowers the left (negative: the other way)."],
  ["spline", "thickness", "Wave Thickness", 0, 6, 0.01, 2],
  // --- Flow & motion ---
  ["spline", "flowSpeed", "Flow Speed", 0, 2.4, 0.005, 3],
  ["spline", "tension", "Tension", 0, 1, 0.005, 3],
  ["spline", "damping", "Damping", 0, 0.004, 0.00001, 5],
  ["spline", "length", "Length", 0, 2.4, 0.001, 3],
  ["spline", "spacing", "Spacing", 0, 1600, 1, 0],
  ["spline", "timeStep", "Time Step", 0, 8, 0.05, 2],
  // --- Shape ---
  ["spline", "bandAmplitude", "Band Amplitude", 0, 1.2, 0.002, 3],
  ["spline", "bandFrequency", "Band Frequency", 0, 24, 0.1, 1, "How many curves the wave makes across the screen."],
  ["spline", "rowSpread", "Band Twist", 0, 6, 0.05, 2, "How much the wave's strands spread and cross."],
  ["spline", "bandSecondaryFreq", "Band 2nd Frequency", 0, 32, 0.1, 1],
  ["spline", "bandSecondaryAmp", "Band 2nd Amplitude", 0, 0.24, 0.002, 3],
  ["spline", "travelSpeed1", "Travel Speed 1", 0, 3, 0.01, 2],
  ["spline", "travelAmp1", "Travel Amplitude 1", 0, 0.16, 0.001, 3],
  ["spline", "travelSpeed2", "Travel Speed 2", 0, 3, 0.01, 2],
  ["spline", "travelAmp2", "Travel Amplitude 2", 0, 0.16, 0.001, 3],
  ["spline", "perturbation", "Perturbation", 0, 0.6, 0.001, 3],
  ["spline", "perturbationScale", "Perturbation Scale", 0, 0.6, 0.001, 3],
  ["spline", "waveCosAmp", "Wave Cosine Amplitude", 0, 0.6, 0.001, 3],
  ["spline", "cosFrequency", "Wave Cosine Frequency", 0, 8, 0.05, 2],
  ["spline", "waveBias", "Wave Bias", -0.6, 0.6, 0.001, 3],
  ["spline", "waveHeightScale", "Wave Height Scale", 0, 2, 0.005, 3],
  ["spline", "waveSoftClip", "Wave Soft Clip", 0, 1, 0.005, 3],
  // --- Reverse-engineered pipeline ---
  ["spline", "rePipelineBlend", "Pipeline Blend", 0, 2, 0.01, 2],
  ["spline", "reDescriptorStrength", "Descriptor Strength", 0, 4, 0.01, 2],
  ["spline", "reSyntheticDescriptorSeed", "Descriptor Seed", 0, 200000, 1, 0],
  ["spline", "reSyntheticDescriptorMotion", "Descriptor Motion", 0, 10, 0.05, 2],
  ["spline", "reKernelGain", "Kernel Gain", 0, 2, 0.005, 3],
  ["spline", "reNormalizeGain", "Normalize Gain", 0, 4, 0.01, 2],
  ["spline", "reKernelPhaseStep", "Kernel Phase Step", 0, 16, 0.05, 2],
  ["spline", "reIndexJitter", "Index Jitter", 0, 1, 0.001, 3],
  ["spline", "reTemporalSmooth", "Temporal Smoothing", 0, 1.96, 0.01, 2],
  // --- Look (the "3D" fresnel shading) ---
  ["spline", "opacity", "Wave Opacity", 0, 2, 0.005, 3],
  ["spline", "brightness", "Wave Brightness", 0, 4, 0.01, 2],
  ["spline", "fill", "Wave Body", 0, 2, 0.01, 2, "How solid the inside of the wave is (0 = only the lit edges)."],
  ["spline", "fresnelPower", "Fresnel Power", 0, 16, 0.05, 2],
  ["spline", "fresnelScale", "Fresnel Scale", 0, 4, 0.01, 2],
  ["spline", "zDetailScale", "Z Detail Scale", 0, 0.5, 0.001, 3],
  ["spline", "edgeSoft", "Edge Softness", 0, 1, 0.01, 2, "How gently the wave's outer edges fade out."],
  ["spline", "autoTintBoost", "Original Wave Color Brightness", 0, 3, 0.01, 2, "With Wave Color on Original, the wave is the background's lower colour made this much brighter…"],
  ["spline", "autoTintWhite", "Original Wave Color Whiteness", 0, 1, 0.01, 2, "…and then mixed with this much white."],
  // --- Free-form deformation ---
  ["spline", "ffdScale1X", "FFD Scale 1 X", 0, 16, 0.01, 2],
  ["spline", "ffdScale1Y", "FFD Scale 1 Y", 0, 6, 0.01, 2],
  ["spline", "ffdScale1Z", "FFD Scale 1 Z", 0, 6, 0.01, 2],
  ["spline", "ffdScale2X", "FFD Scale 2 X", 0, 16, 0.01, 2],
  ["spline", "ffdScale2Y", "FFD Scale 2 Y", 0, 6, 0.01, 2],
  ["spline", "ffdScale2Z", "FFD Scale 2 Z", 0, 12, 0.01, 2],
  ["spline", "ffdOffsetX", "FFD Offset X", -4, 4, 0.01, 2],
  ["spline", "ffdOffsetY", "FFD Offset Y", -4, 4, 0.01, 2],
  ["spline", "ffdOffsetZ", "FFD Offset Z", -4, 4, 0.01, 2],
  ["spline", "ffdYAmp", "FFD Y Amplitude", 0, 0.6, 0.001, 3],
  ["spline", "ffdZAmp", "FFD Z Amplitude", 0, 0.6, 0.001, 3],
  // --- Sparkles ---
  ["particle", "count", "Sparkle Count", 0, 8000, 1, 0],
  ["particle", "opacity", "Sparkle Opacity", 0, 2, 0.01, 2],
  ["particle", "sizeBase", "Sparkle Size", 0, 80, 0.1, 1],
  ["particle", "sizeVar", "Sparkle Size Variance", 0, 100, 0.1, 1],
  ["particle", "flowSpeed", "Sparkle Flow Speed", 0, 6, 0.01, 2],
  ["particle", "posY", "Sparkle Height", -2, 2, 0.01, 2, "The sparkles ride along the wave; this moves them above (+) or below (-) it."],
  ["particle", "spreadY", "Sparkle Spread", 0, 4, 0.01, 2, "How far above and below the wave the sparkles spread."],
];
// The Visualizer Wave: a purple background fading to black, quickly at first
// (Background Color > Visualizer), and a soft see-through lilac-pink wave
// with fine white sparkles (Wave Color > Visualizer: the wave's and the
// sparkles' colours and settings). Your Sparkle Color (when not Original) and
// Wave and Sparkles Personalization still apply over them. The Music Player
// shows both as they are (Music Settings > Music Player Visualizer Wave).
const VISUALIZER_BG = {
  // (fitted to the reference picture's colours, top to bottom and left to right)
  params: {
    "spline:gradientPreset": 0, "spline:bgTopR": 106, "spline:bgTopG": 45, "spline:bgTopB": 118,
    "spline:bgBotR": 2, "spline:bgBotG": 0, "spline:bgBotB": 4, "spline:bgAngle": 94, "spline:bgSpan": 0.62, "spline:bgCurve": 2,
  },
};
const VISUALIZER_WAVE = {
  // (a see-through wave: its purple comes as much from the background showing through as from its own colour)
  wave: "#c06cc8", dot: "#ffeefc",
  params: {
    "spline:posY": -0.2, "spline:tilt": 0.12, "spline:thickness": 2.8, "spline:rowSpread": 1.3, "spline:fill": 0.6,
    "spline:edgeSoft": 0.8, "spline:bandAmplitude": 0.07, "spline:bandFrequency": 1.0,
    "spline:opacity": 0.4, "spline:brightness": 0.85,
    "particle:posY": 0.4, "particle:spreadY": 1.5, "particle:sizeBase": 2.4, "particle:sizeVar": 2.0, "particle:count": 260, "particle:opacity": 0.8,
  },
};
// Background Color's squares: each one the console's own background for that
// colour (measured from captures of it: the gradient, darker at the top, and
// the wave's and sparkles' tint, used while Wave / Sparkle Color are on
// Original). [name, id (what's saved), top rgb, bottom rgb, wave, sparkles,
// angle?, curve?, length?]. The squares kept from before keep their ids, so
// a colour chosen earlier stays chosen.
const SQUARE_LOOKS = [
  ["Red", "#b83524", [89, 0, 0], [232, 38, 63], "#fe8798", "#ffd0d8", 97, 0.6],
  ["Orange", "#c39011", [76, 39, 0], [154, 102, 21], "#b88f4d", "#f0dcb0", 97, 0.65],
  ["Brown", "#644317", [23, 7, 0], [112, 79, 65], "#9f886f", "#e8dccc", 97, 0.55],
  ["Olive", "#8a8c1e", [105, 106, 18], [157, 163, 43], "#c4c75e", "#e8eab4", 97, 0.7],
  ["Green", "#1d7b1d", [0, 66, 0], [34, 162, 10], "#62c553", "#c4f0bc", 97, 0.6],
  ["Turquoise", "#24b8ab", [0, 91, 73], [44, 164, 146], "#5cc2b1", "#c4ece6", 97, 0.7],
  ["Blue", "#0837a6", [0, 6, 74], [50, 78, 179], "#6f87d9", "#cdd8ff", 97, 0.65],
  ["Royal Blue", "#2a3cc0", [28, 44, 148], [50, 84, 238], "#6d8cfd", "#c4d0ff", 97, 0.8],
  ["Purple", "#8d359b", [57, 0, 73], [155, 22, 159], "#c560d0", "#f0c8f4", 97, 0.65],
  ["Silver", "#b8bfca", [104, 104, 104], [152, 152, 152], "#b2b2b2", "#eeeeee", 97, 0.65],
  ["Black", "#101010", [24, 24, 24], [0, 0, 0], "#676767", "#d8d8d8", 270, 2, 0.35],
].map(([name, hex, top, bot, wave, dot, angle = 97, curve = 0.6, span = 1]) => ({
  name, hex, wave, dot,
  // (the swatch: the colour halfway down)
  swatch: "#" + top.map((v, i) => Math.round((v + bot[i]) / 2).toString(16).padStart(2, "0")).join(""),
  params: {
    "spline:gradientPreset": 0, "spline:bgTopR": top[0], "spline:bgTopG": top[1], "spline:bgTopB": top[2],
    "spline:bgBotR": bot[0], "spline:bgBotG": bot[1], "spline:bgBotB": bot[2],
    "spline:bgAngle": angle, "spline:bgCurve": curve, "spline:bgSpan": span,
  },
}));
const squareLook = (hex) => SQUARE_LOOKS.find((q) => q.hex.toLowerCase() === String(hex || "").toLowerCase()) || null;
const waveParamDefault = (group, key) => ({
  particle: REAL_PARTICLE_DEFAULTS, spline: { ...REAL_WAVE_DEFAULTS, ...COMPLEX_EXTRA_DEFAULTS },
}[group] || REAL_WAVE_DEFAULTS)[key];

export class Xmb {
  constructor(audio, wave, cbs) {
    this.audio = audio; this.wave = wave; this.cbs = cbs;
    // Icon Color "Original" follows the background: re-tint the icons when its
    // colour changes (and check every minute, for Month and Time Colors)
    if (wave) {
      wave.onIconAuto = (rgb, gain, def) => {
        ICON_AUTO_RGB = rgb; ICON_AUTO_GAIN = gain || 1; ICON_AUTO_DEFAULT = def || rgb;
        if ((this.user?.theme?.iconColor || "#ffffff") === "auto") { applyIconColorVar("auto"); if (this.root) this._applyXmbwShading(); }
      };
      if (wave.iconAutoRgb) { ICON_AUTO_RGB = wave.iconAutoRgb; ICON_AUTO_GAIN = wave.iconAutoGain || 1; ICON_AUTO_DEFAULT = wave.iconAutoDefault || wave.iconAutoRgb; }
      setInterval(() => { try { wave.updateMenuTint(); } catch (e) {} }, 60000);
    }
    this.root = document.getElementById("xmb");
    this.sideMenu = new SideMenu(audio);
    // inside Settings every option menu has its rule where the console's Color
    // menu has it (x 1325 @1920), further right than elsewhere
    { const open = this.sideMenu.open.bind(this.sideMenu);
      this.sideMenu.open = (items, opts = {}, ...rest) => {
        open(items, opts, ...rest);
        const inSettings = this.columns && this.columns[this.selCat] && this.columns[this.selCat].id === "settings";
        this.sideMenu.el.classList.toggle("setline", !!inSettings);
      }; }
    this.gameInfo = new GameInfoPanel(audio);
    this.gameMenu = new GameMenu(audio);
    this.gameConfirm = new GameConfirm(audio);
    this.userInfo = new UserInfo(audio);
    this.iconChooser = new IconChooser(audio);
    this.gameInfo2 = new GameInfo(audio);
    this.textForm = new TextForm(audio);
    this.psnSignInForm = new PsnSignIn(audio);
    this.avatarPicker = new AvatarPicker(audio);
    this.listPicker = new ListPicker(audio);
    this.confirm = new Confirm(audio);
    this.musicPlayer = new MusicPlayer(audio);
    // a background that finishes loading while a menu is open over it (the
    // Photo Gallery opened right after signing in): the menu's blurred view of
    // what's behind it is made again, so it doesn't stay black
    // The blur is given a (tiny) new value, so it's really drawn again, then
    // put back to the menu's own a moment later.
    // a full-screen menu shows the user's own background (wave / wallpaper),
    // never the selected item's backdrop (Sign Up, Photo Gallery, a game's
    // picture): the wave comes back while a menu is open
    // (nor during the boot intro: the menu behind it is hidden, so an item's
    // backdrop chosen meanwhile — What's New with Automatic Login — would
    // leave only black; the user's background shows through the intro)
    const covered = () => { const c = document.body.classList; return c.contains("menu-open") || c.contains("intro-hold") || c.contains("intro-run") || c.contains("booting"); };
    this._syncWaveHidden = () => {
      const hide = !!this.$bg?.classList.contains("show") && !covered();
      // (the menu is still fading in: the wave goes once it has)
      const wait = (this._uncoverUntil || 0) - performance.now();
      if (hide && wait > 0) { clearTimeout(this._uncoverT); this._uncoverT = setTimeout(() => this._syncWaveHidden(), wait + 20); return; }
      this.wave.setHidden(hide);
    };
    // (uncovered: the wave stays until the menu, with the item's backdrop in
    // it, has faded in (0.5 s), or the screen goes dark for a moment, as at
    // the end of the boot intro with Automatic Login landing on What's New)
    new MutationObserver(() => {
      const open = covered();
      if (open === this._menuOpenSeen) return;
      this._menuOpenSeen = open;
      clearTimeout(this._uncoverT);
      if (!open) this._uncoverUntil = performance.now() + 650;
      this._syncWaveHidden();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("bgmedia-ready", () => {
      const menus = document.querySelectorAll(".form.show, .sidemenu, .loading.show, .colorpick.show, .vp-dlg");
      menus.forEach((f) => {
        const cur = getComputedStyle(f).backdropFilter;
        if (!cur || cur === "none") return;
        f._bfTick = !f._bfTick;
        f.style.backdropFilter = f.style.webkitBackdropFilter = cur.replace(/blur\(([\d.]+)px\)/, (m, v) => `blur(${(+v + (f._bfTick ? 0.01 : 0.02)).toFixed(2)}px)`);
        clearTimeout(f._bfT);
        f._bfT = setTimeout(() => { f.style.backdropFilter = f.style.webkitBackdropFilter = ""; }, 2500);
      });
    });
    // the Music Player shows the Visualizer Wave while it's open (Music Settings)
    { const mp = this.musicPlayer, open = mp.open.bind(mp), close = mp.close.bind(mp);
      mp.open = (...a) => { this._inMusicPlayer = true; const r = open(...a); this._applyWallpaper(); return r; };
      mp.close = (...a) => { this._inMusicPlayer = false; const r = close(...a); this._applyWallpaper(); return r; }; }
    this.photoViewer = new PhotoViewer(audio);
    this.playlistPicker = new PlaylistPicker(audio);
    this.photoGrid = new PhotoGrid(audio);
    this.videoViewer = new VideoPlayer(audio);
    // The Photo Viewer and the Video Player cover the whole screen: the
    // background / overlay videos behind them are paused meanwhile and, when
    // they show again, start right where they would be by then (a webview
    // that stops drawing a covered video otherwise fast-forwards it to catch up)
    new MutationObserver(() => this._coverBgVideos(document.body.classList.contains("pv-open") || document.body.classList.contains("video-open")))
      .observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.profileCard = new ProfileCard(audio);
    this.colorPicker = new ColorPicker(audio);
    this.keybindMenu = new KeybindMenu(audio);
    // (what a menu's choice starts and keeps working on is watched too: see _trackBusy)
    for (const ov of Object.values(this)) {
      if (!ov || typeof ov !== "object" || ov === this.root) continue;
      for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(ov) || {}).concat(Object.keys(ov))) {
        if (!/^open/.test(k) || typeof ov[k] !== "function" || ov[k]._busyWrapped) continue;
        const fn = ov[k].bind(ov);
        const w = (...a) => fn(...a.map((x) => (typeof x === "function" ? (...b) => this._trackBusy(x(...b)) : x)));
        w._busyWrapped = true; ov[k] = w;
      }
    }
    this.overlay = null;
    this.selCat = 0; this.locked = true;
    this.user = null;
    setPlayerIconTint({ r: 255, g: 255, b: 255, a: 1 });   // (the filter must exist before any player opens)
  }

  async start(manifest, { noAutoLogin = false } = {}) {
    this.manifest = manifest;
    this.locked = true; this.user = null;
    await this._buildColumns();
    // Automatic Login: that user is logged in at once, on What's New
    const auto = noAutoLogin ? null : (this.usersFile?.users || []).find((u) => u.autoLogin);
    if (auto) {
      this.show();
      await this._signIn(auto, { startAt: "whatsnew" });
      this._applyPerformance();
      setTimeout(() => this._applyResolution(), 400);
      return;
    }
    this.selCat = 0;                 // Users column only, while locked
    // Land on the first actual profile if one exists, otherwise Create New User.
    const uitems = this.columns[0].items;
    const iu = uitems.findIndex((it) => it.kind === "user");
    const firstUser = iu >= 0 ? iu : Math.max(0, uitems.findIndex((it) => it.kind === "newuser"));
    this.levels = [{ items: uitems, sel: firstUser }];
    this.show(); this._render(); this._onSelect();
    this._applyPerformance();
    setTimeout(() => this._applyResolution(), 400);
  }

  show() { this.root.classList.add("show"); }

  // ------------------------------------------------------------- data model
  // reuseGames: the game library read last time (nothing in it changed, as
  // after a theme change), instead of reading it again
  async _buildColumns({ reuseGames = false } = {}) {
    this.mediaMode ||= { music: "all", photo: "all", video: "all" };
    const games = reuseGames && this._lastGames ? this._lastGames : await call("scan_library");
    this._lastGames = games;
    this._loadDetected();
    const users = await this._buildColumn("users");
    if (this.locked) { this.columns = [users]; return; }
    this.psnAccounts = await call("list_psn_accounts");
    // the libraries' fingerprints as their lists are read now (see _liveRefresh)
    await this._takeMediaFingerprints(["photo", "video", "music"]);
    const cols = [users];
    for (const id of BASE_COLUMNS) cols.push(await this._buildColumn(id, games));
    // (custom sections from System Settings > Sections go where they were placed)
    this.columns = await this._withSections(cols);
  }
  // One column built on its own, so a change to one column (a new sort
  // order, a playlist, a user's picture...) only rebuilds that column instead
  // of reading every library again. `games`: the library just scanned (the
  // last one read when not given).
  async _buildColumn(id, games) {
    switch (id) {
      case "users": {
        const uf = await call("list_users");
        this.usersFile = uf;
        // The column is "Log In" until a user is chosen/created this session, then
        // "Users" for the rest of the session. Create New User sits directly under
        // Turn Off System, with the profiles below it.
        return { id: "users", label: this._loggedInOnce ? "Users" : "Log In", icon: "tex_user.png", items: [
          { kind: "action", act: "turnoff", title: "Turn Off System", sub: "", icon: { sys: "icon_poweroff.png" } },
          { kind: "newuser", title: "Create New User", sub: "", icon: { sys: "icon_newuser.png" } },
          ...uf.users.map((u) => ({ kind: "user", title: u.name, sub: "", icon: { avatar: u.avatar }, user: u })),
        ] };
      }
      case "settings": return { id: "settings", label: "Settings", icon: "tex_sysconf.png", items: this._settingsItems() };
      case "photo": return { id: "photo", label: "Photo", icon: "tex_photo.png", items: [
        this._mediaServersItem(),
        { kind: "action", act: "photo_gallery", title: "Photo Gallery", icon: { sys: "photo_gallery.png" }, bg: "cinfo-bg-photogallery.jpg",
          sub: "Create a space to enjoy and enhance your photos.\nTurn the photos on your PS3™ system into great albums in minutes.\nYou can sort your photos by themes, add music to enhance a slideshow or add custom frames to your photos. The more photos you add, the more fun you can have – the possibilities are endless!" },
        { kind: "drill", title: "Playlists", icon: { sys: "icon_playlist.png" }, children: await this._photoPlaylistItems() },
        ...await this._mediaSectionItems("photo"),
      ] };
      case "music": return { id: "music", label: "Music", icon: "icon_music.png", items: await this._musicItems() };
      case "video": return { id: "video", label: "Video", icon: "icon_video.png", items: [
        { kind: "ph", title: "BD Data Utility", sub: "", icon: { sys: "icon_gamedata.png" } },
        this._mediaServersItem(),
        { kind: "ph", title: "Video Editor & Uploader", sub: "", icon: { sys: "icon_video_upload.png" } },
        this._storeItem("cinfo-bg-storevideo.jpg"),
        ...await this._mediaSectionItems("video"),
      ] };
      case "game": {
        if (!games) games = this._lastGames || await call("scan_library");
        return { id: "game", label: "Game", icon: "tex_game.png", items: this._gameItems(games) };
      }
      case "network": return { id: "network", label: "Network", icon: "icon_network.png", items: [
        { kind: "ph", title: "Online Instruction Manuals", sub: "", icon: { sys: "icon_onlinemanual.png" } },
        { kind: "ph", title: "Remote Play", sub: "Use a device that supports remote play (such as a PS Vita or a PSP™ system) to operate this system over a network. Go to [Settings] > [Remote Play Settings] > [Register Device] and register the remote play device.", icon: { sys: "icon_remoteplay.png" } },
        { kind: "action", act: "inet_browser", title: "Internet Browser", sub: "", icon: { sys: "icon_browser.png" } },
        { kind: "action", act: "inet_search", title: "Internet Search", sub: "", icon: { sys: "icon_inet_search.png" } },
        { kind: "ph", title: "Download Management", sub: "", icon: { sys: "icon_download.png" } },
      ] };
      case "tvvideo": return { id: "tvvideo", label: "TV/Video Services", icon: "icon_tv.png", items: [
        { kind: "ph", title: "My Channels", sub: "", icon: { sys: "mychannels.png" }, bg: "cinfo-bg-whatsnew.jpg" },
        // YouTube (the console's TV/Video Services capture): opens the browser on youtube.com
        { kind: "action", act: "youtube", title: "YouTube", sub: "", icon: { art: "./assets/icons/system/youtube.png", gameArt: true, plainLabel: true, artCls: "yt-art" } },
      ] };
      case "psn": return { id: "psn", label: "PlayStation\u00aeNetwork", ...this._psnLook(), items: this._psnItems() };
      case "friends": return { id: "friends", label: "Friends", icon: "icon_friend.png", items: await this._friendsItems() };
    }
    return null;
  }
  // Put a column built again in place of the old one (same position); the
  // menu shown from it is pointed at the new items by the caller
  async _replaceColumn(id) {
    if (!this.columns) return null;
    const i = this.columns.findIndex((c) => c.id === id);
    if (i < 0) return null;
    if (this.columns[i].section) { await this._refreshSections(); return this.columns.find((c) => c.id === id) || null; }
    if (["photo", "video", "music"].includes(id)) await this._takeMediaFingerprints([id]);
    if (id === "psn") this.psnAccounts = await call("list_psn_accounts");
    const col = await this._buildColumn(id);
    if (!col) return null;
    const j = this.columns.findIndex((c) => c.id === id);   // (it may have moved meanwhile)
    if (j < 0) return null;
    // its place in the category row (drawn elements, remembered state) carries over
    for (const [k, v] of Object.entries(this.columns[j])) if (k.startsWith("_") && !(k in col)) col[k] = v;
    this.columns[j] = col;
    return col;
  }

  // PlayStation®Network icon + title: "original" (the sphere, two-line title)
  // or "modern" (tex_psn, "PlayStation™Network" on one line) — Theme Settings
  _psnLook() {
    return this.user?.theme?.psnStyle === "modern"
      ? { catLabel: "PlayStation\u2122Network", icon: "tex_psn.png" }
      : { catLabel: "PlayStation\u00ae\nNetwork", icon: "psn_sphere.png" };
  }
  _applyPsnStyle() {
    const col = this.columns && this.columns.find((c) => c.id === "psn");
    if (!col) return;
    Object.assign(col, this._psnLook());
    this._render(); this._onSelect();
  }
  // PlayStation®Home's icon, backdrop and description box: "original" (the
  // Home icon, the blue backdrop, the description on its white rectangle)
  // or "modern" (the newer icon, the lounge backdrop, no rectangle) — Theme
  // Settings > Icons > PlayStation®Home Icon
  _homeLook() {
    return this.user?.theme?.homeStyle === "modern"
      ? { icon: { art: "./assets/icons/system/pshome_modern.png", gameArt: true, plainLabel: true }, bg: "cinfo-bg-home-modern.jpg", panelPlain: true }
      : { icon: { sys: "pshome.png" }, bg: "cinfo-bg-home.jpg", panelPlain: false };
  }
  _applyHomeStyle() {
    for (const col of this.columns || []) for (const it of col.items || []) {
      if (!it.homeItem) continue;
      Object.assign(it, this._homeLook());
      if (it._el) { it._el.remove(); it._el = null; }       // (drawn again with its new icon)
    }
    this._render(); this._onSelect();
  }
  _settingsItems() {
    // Full Settings column in the standard PS3 order. Items without a `drills`
    // entry below are visual-only placeholders (no functionality yet).
    const names = [
      ["System Update", "icon_update.png"],
      ["Game Settings", "icon_game_setting.png"],
      ["Video Settings", "icon_bdvd_setting.png"],
      ["Music Settings", "icon_music_setting.png"],
      ["Chat Settings", "icon_chat_setting.png"],
      ["System Settings", "icon_system_setting.png"],
      ["Theme Settings", "icon_theme_setting.png"],
      ["Date and Time Settings", "icon_datetime_setting.png"],
      ["Power Save Settings", "icon_powersave_setting.png"],
      ["Accessory Settings", "icon_accessory.png"],
      ["Printer Settings", "icon_printer_setting.png"],
      ["Display Settings", "icon_display_setting.png"],
      ["Sound Settings", "icon_sound_setting.png"],
      ["Security Settings", "icon_security_setting.png"],
      ["Remote Play Settings", "icon_remoteplay_setting.png"],
      ["Network Settings", "icon_network_setting.png"],
    ];
    // Icons shown INSIDE any Settings subsection are the generic Setting icon.
    const SI = { sys: "icon_setting_item.png" };
    const themeItems = [
      { kind: "drill", title: "PS3 Themes", icon: SI, childrenFn: this._p3tThemeItems },
      { kind: "drill", title: "Custom Themes", icon: SI, childrenFn: this._customThemeItems },
      { kind: "drill", title: "Icon Sets", icon: SI, childrenFn: this._iconThemeItems },
      { kind: "drill", title: "Sound Effect Sets", icon: SI, childrenFn: this._soundThemeItems },
      { kind: "drill", title: "Background", icon: SI, children: [
        { kind: "drill", title: "Background", icon: SI, children: [
          { kind: "setting", ctl: "bgcolor", title: "Background Color", icon: SI },
          { kind: "action", act: "theme_bgimage", title: "Background", icon: SI,
              sub: "Choose a photo or video as the background." },
          { kind: "setting", ctl: "bgfit", title: "Background Display", icon: SI,
              sub: "The way the background fits on the screen." },
          { kind: "setting", ctl: "bgshuffle", title: "Background Shuffle", icon: SI,
              sub: "The background shuffles around the full list of photo and video files of the system or around a Photo/Video playlist." },
          { kind: "setting", ctl: "bginterval", title: "Photo Duration", icon: SI,
              sub: "Set the time for how long each photo lasts when Background Shuffle is on." },
          { kind: "action", act: "theme_bgremove", title: "Remove Background", icon: SI },
        ] },
        { kind: "drill", title: "Overlay", icon: SI, children: [
          { kind: "action", act: "theme_overlay", title: "Overlay", icon: SI,
              sub: "Select a transparent photo or a video that uses chroma key (Green/Blue Screen) to go over the background." },
          { kind: "setting", ctl: "chromakey", title: "Overlay Key Color", icon: SI,
              sub: "The color to be removed from a video that uses chroma key." },
          { kind: "setting", ctl: "chroma", title: "Overlay Color Strength", icon: SI,
              sub: "How strongly the key color of a video that uses chroma key should be removed." },
          { kind: "setting", ctl: "ovshuffle", title: "Overlay Shuffle", icon: SI,
              sub: "The overlay shuffles around the full list of photo and video files of the system or around a Photo/Video playlist." },
          { kind: "setting", ctl: "ovinterval", title: "Photo Duration", icon: SI,
              sub: "Set the time for how long each photo lasts when Overlay Shuffle is on." },
          { kind: "action", act: "theme_overlayremove", title: "Remove Overlay", icon: SI },
        ] },
        { kind: "drill", title: "Photo/Video Playlists", icon: SI,
            sub: "Playlists of photos and videos to be used with Shuffling.",
            childrenFn: () => this._bgPlaylistItems("bg") },
      ] },
      { kind: "drill", title: "Wave and Sparkles", icon: SI, children: [
        { kind: "setting", ctl: "waves", title: "Wave", icon: SI },
        { kind: "setting", ctl: "wavecolor", title: "Wave Color", icon: SI },
        { kind: "setting", ctl: "dots", title: "Sparkles", icon: SI },
        { kind: "setting", ctl: "dotcolor", title: "Sparkles Color", icon: SI },
        { kind: "drill", title: "Wave and Sparkles Personalization", icon: SI, childrenFn: this._wavePersonalizationItems },
      ] },
      { kind: "drill", title: "Icons", icon: SI, children: [
        { kind: "setting", ctl: "iconcolor", title: "Icon Color", icon: SI },
        { kind: "setting", ctl: "iconstyle", title: "Icon Style", icon: SI },
        { kind: "setting", ctl: "introicon", title: "Intro Icon", icon: SI, sub: this._introArtSub("icon") },
        { kind: "setting", ctl: "introtitle", title: "Intro Title", icon: SI, sub: this._introArtSub("title") },
        { kind: "setting", ctl: "psnstyle", title: "PlayStation®Network Icon", icon: SI },
        { kind: "setting", ctl: "homestyle", title: "PlayStation®Home", icon: SI },
      ] },
      { kind: "drill", title: "Text and Color", icon: SI, children: [
        { kind: "setting", ctl: "font", title: "Font", icon: SI },
        { kind: "setting", ctl: "fontsize", title: "Text Size", icon: SI },
        { kind: "setting", ctl: "textcolor", title: "Text Color", icon: SI },
        { kind: "setting", ctl: "clockcolor", title: "Info Box and Buttons Color", icon: SI },
        { kind: "setting", ctl: "clockiconcolor", title: "Clock Color", icon: SI },
      ] },
      { kind: "action", act: "theme_save", title: "Save Theme Settings as a Preset…", icon: SI },
      { kind: "drill", title: "Saved Theme Presets", icon: SI, childrenFn: this._themePresetItems },
      { kind: "action", act: "theme_reset", title: "Reset Theme Settings", icon: SI },
    ];
    const drills = {
      "Theme Settings": themeItems,
      "Sound Settings": [
        { kind: "setting", ctl: "bgaudio", title: "Play Audio in Background", icon: SI,
          sub: "Keeps all the system's audio playing when the system is out of focus." },
        { kind: "setting", ctl: "startsound", title: "Console Startup Sound", icon: SI },
        { kind: "setting", ctl: "bufsound", title: "Buffering Sound", icon: SI,
          sub: "On: The console's buffering sound plays on loop." },
        { kind: "setting", ctl: "sfx", title: "Sound Effects", icon: SI },
        { kind: "setting", ctl: "bufvol", title: "Buffering Sound Volume", icon: SI },
        { kind: "setting", ctl: "sfxvol", title: "Sound Effects Volume", icon: SI },
        { kind: "setting", ctl: "musicvol", title: "Music Volume", icon: SI },
        { kind: "setting", ctl: "volume", title: "System Volume", icon: SI },
      ],
      "Video Settings": [
        { kind: "action", act: "preloadvideos", title: "Pre-Load All Videos", icon: SI,
          sub: "Converts every video the system can't play on its own to a playable format. This is recommended before doing any video playback.",
          warn: "Warning: Once the preload starts, the system stays on this menu until the preload of all video files finishes." },
        { kind: "setting", ctl: "keepvideos", title: "Keep Pre-Loaded Videos Data", icon: SI,
          sub: "On: Saves the converted videos after preloading on the system's directory instead of the Windows Temp folder. This means that the converted videos get saved instead of being deleted after turning off the system. This is recommended to not have to manually preload every time you enter into the system." },
      ],
      "Game Settings": [
        { kind: "drill", title: "Game Information", icon: SI, sub: "Edit each game's information.",
          childrenFn: this._gameSettingsList },
        { kind: "drill", title: "Game Recognition", icon: SI, sub: "Choose where to find games.",
          childrenFn: this._gameRecognitionItems },
        { kind: "drill", title: "Folder Console", icon: SI,
          sub: "Set the type of console for all games inside of a folder in the content\\Games directory.",
          childrenFn: this._folderConsoleList },
      ],
      "Music Settings": [
        { kind: "setting", ctl: "music", title: "Background Music", icon: SI },
        { kind: "action", act: "bgmusic", title: "Select Background Music", icon: SI },
        { kind: "action", act: "preload", title: "Pre-Load All Songs", icon: SI,
          sub: "Converts every song the system can't play on its own to a playable format. This is recommended before doing any music playback.",
          warn: "Warning: Once the preload starts, the system stays on this menu until the preload of all song files finishes." },
        { kind: "setting", ctl: "keepsongs", title: "Keep Pre-Loaded Songs Data", icon: SI,
          sub: "Saves the converted songs after preloading on the system's directory instead of the Windows Temp folder. This means that the converted songs get saved instead of being deleted after turning off the system. This is recommended to not have to manually preload every time you enter into the system." },
        { kind: "setting", ctl: "mpvisualizer", title: "Music Player Visualizer", icon: SI,
          sub: "On: The Music Player shows the Visualizer wave instead of the current background." },
      ],
      "Power Save Settings": [
        { kind: "setting", ctl: "lowpower", title: "Low Performance Mode", icon: SI,
          sub: "On: When the system is out of focus, everything on screen stops." },
        { kind: "setting", ctl: "stillwaves", title: "Still Wave and Sparkles", icon: SI,
          sub: "This gives a performance boost to slower computers." },
        { kind: "setting", ctl: "nomenublur", title: "Remove Menu Blur", icon: SI,
          sub: "This gives a performance boost to slower computers." },
      ],
      "Accessory Settings": [
        { kind: "setting", ctl: "vkb", title: "On-Screen Keyboard", icon: SI },
      ],
      "Date and Time Settings": [
        { kind: "setting", ctl: "dateformat", title: "Date Format", icon: SI,
          sub: "Sets the order of display for year, month and day." },
        { kind: "setting", ctl: "timeformat", title: "Time Format", icon: SI,
          sub: "Sets the time display to either a 12-hour or 24-hour clock." },
      ],
      "Display Settings": [
        { kind: "setting", ctl: "resolution", title: "Resolution", icon: SI },
        { kind: "setting", ctl: "fullscreen", title: "Full Screen", icon: SI },
        { kind: "setting", ctl: "brightness", title: "Brightness", icon: SI },
        { kind: "setting", ctl: "fpscap", title: "Framerate", icon: SI },
        { kind: "setting", ctl: "vsync", title: "VSync", icon: SI, sub: "Helps prevent screen tearing." },
      ],
      "System Settings": [
        { kind: "setting", ctl: "autostart", title: "Start at Windows Startup", icon: SI },
        { kind: "setting", ctl: "boot", title: "Boot Intro", icon: SI },
        { kind: "drill", title: "Media Folders", icon: SI,
          sub: "Choose the folders from where the system recognizes media files.",
          childrenFn: this._mediaFolderItems },
        { kind: "drill", title: "Sections", icon: SI, sub: "Create and edit your own sections.",
          childrenFn: this._sectionsMenuItems },
        { kind: "drill", title: "Cache Management", icon: SI,
          sub: "Decide to either store the cache on the system's directory or in the Windows Temp folder.",
          childrenFn: this._cacheManagementItems },
        { kind: "setting", ctl: "deltemp", title: "Delete Temporary Files", icon: SI,
          sub: "On: The system automatically deletes every cached file created on the Windows Temp folder when the system turns off. Cache saved in the system's directory doesn't get deleted." },
        { kind: "action", act: "keybinds", title: "Change Keybinds", icon: SI },
        { kind: "setting", ctl: "sysinfo", title: "System Information", icon: SI },
      ],
    };
    // Descriptions shown under the selected item (match the real XMB wording).
    const descs = {
      "System Update": "Updates the system software on this system.",
      "Game Settings": "Adjusts settings for games.",
      "Video Settings": "Adjusts settings for video.",
      "Music Settings": "Adjusts settings for music.",
      "Chat Settings": "Adjusts settings for chat.",
      "System Settings": "Adjusts settings for this PS3™ system.",
      "Theme Settings": "Adjusts settings related to the appearance of the XMB™ screen.",
      "Date and Time Settings": "Adjusts date and time settings.",
      "Power Save Settings": "Adjusts settings to reduce power usage by this system.",
      "Accessory Settings": "Adjusts settings for accessories that are connected to this system.",
      "Printer Settings": "Adjusts settings for printers that are connected to this system.",
      "Display Settings": "Adjusts settings for video output.",
      "Sound Settings": "Adjusts settings for audio output.",
      "Security Settings": "Adjusts parental control settings.",
      "Remote Play Settings": "Adjusts settings for remote play. Remote play enables you to use a device that supports remote play (such as a PS Vita or a PSP™ system) to operate this system over a network.",
      "Network Settings": "Adjusts settings for the Internet connection.",
    };
    return names.map(([label, icon]) => drills[label]
      ? { kind: "drill", title: label, sub: descs[label], icon: { sys: icon }, children: drills[label] }
      : { kind: "ph", title: label, sub: descs[label], icon: { sys: icon } });
  }

  async _friendsItems() {
    // Empty until signed in to PSN: matches the real XMB Friends screen when
    // not signed up / signed in (Friends XMB.png).
    if (!this.user?.psnAccountId) return [];
    // Order (all without descriptions): Block List, Add a Friend, Players Met,
    // Start New Chat, Chat Room (Text Only), Message Box, then the user card and
    // friend cards.
    const base = [
      { kind: "ph", title: "Block List", icon: { sys: "icon_blocklist.png" } },
      { kind: "ph", title: "Add a Friend", icon: { sys: "icon_addfriend.png" } },
      { kind: "ph", title: "Players Met", icon: { sys: "icon_playermet.png" } },
      { kind: "ph", title: "Start New Chat", icon: { sys: "icon_chat.png" } },
      { kind: "ph", title: "Chat Room (Text Only)", icon: { sys: "icon_chatroom_text.png" } },
      { kind: "ph", title: "Message Box", icon: { sys: "icon_mbox.png" } },
    ];
    {
      const psn = await call("list_psn_accounts");
      const acct = (psn.accounts || []).find((a) => a.id === this.user.psnAccountId);
      if (acct) {
        // the player's own card; its trophy level comes from Friend
        // Personalization when set, otherwise a stable random value.
        const pl = this._friendCfg().playerLevel;
        // a new account starts at level 1; "random" = a random level from 1 to 30
        if (pl === "random") this._userLevel ||= 1 + Math.floor(Math.random() * 30);
        else this._userLevel = pl != null ? pl : 1;
        base.push({ kind: "playercard", title: acct.onlineId, acct, icon: { avatar: acct.avatar }, level: this._userLevel,
          plusFn: () => !!this._friendCfg().playerPlus });
        // how many friends to show comes from Friend Personalization (falls back
        // to the info-box counter when set to "random")
        const friends = this._genFakeFriends(this._friendTargetCount(acct.friendsOnline || 0));
        for (const f of friends) base.push({ kind: "friendcard", title: f.name, friend: f, icon: { avatar: f.avatar } });
        // The info-box "friends online" count is the number of friends whose
        // indicator is Online (blue) or Away (AFK): the ones actually signed in.
        const onlineCount = friends.filter((f) => f.indicator === "sign_in" || f.indicator === "afk").length;
        // any card with the message mark → the message icon in the top-right box too
        const hasMail = friends.some((f) => f.indicator === "none" || (f.indicator !== "sent_request" && f.hasMbox));
        this.cbs.onFriendsOnline && this.cbs.onFriendsOnline(onlineCount, hasMail);
      }
    }
    return base;
  }

  // The Friend Personalization config on the user (with sane defaults).
  _friendCfg() {
    const c = (this.user && this.user.friendConfig) || {};
    return { mode: c.mode || "random", count: c.count ?? 8, min: c.min ?? 2, max: c.max ?? 30,
      cards: Array.isArray(c.cards) ? c.cards : [], playerLevel: c.playerLevel, playerPlus: !!c.playerPlus };
  }
  // How many friends to show, based on the chosen mode. Cached per session so it
  // doesn't reshuffle on every render.
  _friendTargetCount(fallback) {
    const c = this._friendCfg();
    if (c.mode === "fixed") return Math.max(0, Math.min(FRIEND_MAX, c.count));
    if (c.mode === "range") {
      const lo = Math.min(c.min, c.max), hi = Math.max(c.min, c.max);
      if (this._friendCountCache == null) this._friendCountCache = lo + Math.floor(Math.random() * (hi - lo + 1));
      return Math.max(0, Math.min(FRIEND_MAX, this._friendCountCache));
    }
    // Randomized: a random number between 0 and 30 (kept for the session)
    if (this._friendCountCache == null) this._friendCountCache = Math.floor(Math.random() * 31);
    return this._friendCountCache;
  }
  // Generate the set of fake online friends. Saved Friend Cards are used first
  // (in order), then the remaining slots are filled with randomized friends.
  // Cached until the count or the saved cards change.
  _genFakeFriends(n) {
    const cfg = this._friendCfg();
    const key = n + "|" + JSON.stringify(cfg.cards);
    if (this._fakeFriends && this._fakeFriendsKey === key) return this._fakeFriends;
    this._fakeFriendsKey = key;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const RAND = "random";
    // weighted indicator pick: received friend request ("none") 2 %, sent
    // request 5 %; otherwise the blue circle is 3× as likely as away or
    // signed out
    const pickIndicator = () => {
      // (one roll: none 2 %, sent request 5 %, away 10 %, then the blue
      // circle 3x as likely as signed out)
      const r = Math.random();
      if (r < 0.02) return "none";
      if (r < 0.07) return "sent_request";
      if (r < 0.17) return "afk";
      return Math.random() < 0.75 ? "sign_in" : "sign_out";
    };
    const used = new Set();
    const uniqueName = () => {
      let nm = randomFriendName(); let g = 0;
      while (used.has(nm) && g++ < 12) nm = randomFriendName();
      while (used.has(nm)) nm = randomFriendName() + String(Math.floor(Math.random() * 900) + 10);
      used.add(nm); return nm;
    };
    const out = [];
    // 1) the player's saved friend cards, up to n (each field may be a fixed
    //    value or "random", resolved here)
    for (let i = 0; i < Math.min(cfg.cards.length, n); i++) {
      const c = cfg.cards[i];
      const ind = c.indicator === RAND ? pickIndicator() : (CARD_INDICATORS[c.indicator] ? c.indicator : "sign_in");
      const name = (c.name && c.name !== RAND) ? c.name : uniqueName();
      if (c.name && c.name !== RAND) used.add(name);
      const msgPick = (c.message && c.message !== RAND) ? c.message : pick(FRIEND_MSGS);
      // only Online / Away friends have a bubble; a random one is left off 10% of the time
      const bubbleOk = ind === "sign_in" || ind === "afk";
      let message = !bubbleOk ? "" : ((c.message && c.message !== RAND) ? c.message : (Math.random() < 0.10 ? "" : msgPick));
      const color = (c.color && c.color !== RAND) ? c.color : pick(CARD_COLORS).hex;
      const avatar = (c.avatar && c.avatar !== RAND) ? c.avatar : randomPsnAvatar();
      // 20% of random cards don't show a trophy level (the card shows "–")
      const level = (c.level != null && c.level !== RAND) ? c.level : (Math.random() < 0.2 ? "-" : randomTrophyLevel());
      if (level === "-") message = "";      // a hidden trophy level never has a bubble
      const showGame = ind === "sign_in" ? (c.showGame === RAND ? (Math.random() < 0.75) : (c.showGame !== false)) : false;
      const game = showGame ? ((c.game && c.game !== RAND) ? c.game : gameFor(msgPick, name)) : "";
      const hasPlus = ind === "none" ? false : (c.hasPlus === RAND ? (Math.random() < 0.30) : !!c.hasPlus);
      const hasMbox = (ind === "none" || ind === "sent_request") ? false : (c.hasMbox === RAND ? (Math.random() < 0.5) : !!c.hasMbox);
      const mboxNum = (c.mboxNum != null && c.mboxNum !== RAND) ? c.mboxNum : randomMboxNum();
      const ls = ind === "sign_out"
        ? (c.signOutTime && c.signOutTime !== RAND ? lastSignInForBucket(c.signOutTime)
          : (c.lastSignIn && c.lastSignIn !== RAND ? { label: c.lastSignIn, mins: signInMins(c.lastSignIn) } : randomLastSignIn()))
        : null;
      out.push({ name, message, color, game, avatar, trophyLevel: level, indicator: ind, showGame,
        lastSignIn: ls ? ls.label : null, lastSignInMins: ls ? ls.mins : null,
        hasPlus, hasMbox, mboxNum });
    }
    // 2) fill the rest with randomized friends (generated PSN-style handles)
    const remaining = n - out.length;
    for (let k = 0; k < remaining; k++) {
      const name = uniqueName();
      const msgPick = pick(FRIEND_MSGS);
      const ind = pickIndicator();
      // bubble: Online / Away only, and even then 10% of them have none
      // a hidden trophy level (20%) never has a bubble
      const trophyLevel = Math.random() < 0.2 ? "-" : randomTrophyLevel();
      const message = trophyLevel !== "-" && (ind === "sign_in" || ind === "afk") && Math.random() >= 0.10 ? msgPick : "";
      // blue circle: usually shows a game, but sometimes none. Others: no game.
      const showGame = ind === "sign_in" ? (Math.random() < 0.75) : false;
      // PS Plus 30%, message badge 10% (PS Plus never on received-request)
      const hasPlus = ind !== "none" && Math.random() < 0.30;
      const hasMbox = (ind !== "none" && ind !== "sent_request") && Math.random() < 0.10;
      const ls = ind === "sign_out" ? randomLastSignIn() : null;
      out.push({ name, message, avatar: randomPsnAvatar(), color: pick(CARD_COLORS).hex,
        game: showGame ? gameFor(msgPick, name) : "", trophyLevel,
        indicator: ind, showGame, lastSignIn: ls ? ls.label : null, lastSignInMins: ls ? ls.mins : null,
        hasPlus, hasMbox, mboxNum: randomMboxNum() });
    }
    // Group order: Received Request → Online → Away → Signed Out → Sent Request.
    // Within each group order alphabetically by name, EXCEPT the Signed Out group
    // which orders by how long ago they signed in (least time ago at the top).
    out.sort((a, b) => {
      const ga = FRIEND_ORDER[a.indicator] ?? 1, gb = FRIEND_ORDER[b.indicator] ?? 1;
      if (ga !== gb) return ga - gb;
      if (a.indicator === "sign_out") return (a.lastSignInMins ?? Infinity) - (b.lastSignInMins ?? Infinity);
      return cmpBase(a.name, b.name);
    });
    this._fakeFriends = out;
    return out;
  }

  // Game column: the PlayStation Store, then the games alphabetically, top to
  // bottom (natural order: "Game 2" before "Game 10").
  _gameItems(games) {
    this._allGames = games || [];
    // a "PlayStation Home" game always starts from PSN > PlayStation®Home
    this._homeGame = (games || []).find(isHomeGame) || null;
    const list = [...(games || [])].filter((g) => g !== this._homeGame);
    const uname = this.user?.name || "User 1";
    const fixed = [
      { kind: "ph", title: "PS Vita System Application Utility", sub: uname, userSub: true, icon: { sys: "icon_gamedata.png" } },
      { kind: "ph", title: "Game Data Utility", sub: "", icon: { sys: "icon_gamedata.png" } },
      { kind: "ph", title: "Memory Card Utility", sub: "", icon: { sys: "icon_vmc.png" } },
      { kind: "ph", title: "Saved Data Utility (minis/PSP\u2122)", sub: uname, userSub: true, icon: { sys: "icon_savedata_minis.png" } },
      { kind: "ph", title: "Saved Data Utility (PS3\u2122)", sub: uname, userSub: true, icon: { sys: "icon_savedata.png" } },
      this._storeItem("cinfo-bg-storegame.jpg"),
    ];
    this._gameFixedCount = fixed.length;
    // the disc (only one) sits above every other game, without a date line
    const disc = list.find((g) => g.isDisc);
    const entries = list.filter((g) => g !== disc).map((g) => this._gameEntry(g));
    return [...fixed, ...(disc ? [this._gameEntry(disc)] : []), ...this._groupGames(entries)];
  }
  // one game row: its name and (not for the disc) the "Created" date + time
  _gameEntry(g) {
    const art = assetUrl(g.icon), prev = assetUrl(g.preview);
    const icon = g.isDisc
      ? { art: discIcon(g.console), disc: true, real: /\.gif$/i.test(g.preview || "") ? prev : art, preview: /\.gif$/i.test(g.preview || "") ? null : prev }
      : { art, preview: prev };
    return { kind: "game", title: gameName(g), sub: g.isDisc ? "" : this._fmtCreated(g.created), icon, game: g };
  }
  // Game section sort (Square): All / By Format (console) / By Album
  _groupGames(entries) {
    const byTitle = (a, b) => cmpNatural(String(a.title), String(b.title));
    const mode = this._mediaMode("game");
    // Sort By (the game options): Creation Date ▼ (newest first, the default),
    // Creation Date ▲, Recently Played (last started first), Format (console)
    const byCreated = (a, b) => cmpText(String(b.game.created || ""), String(a.game.created || "")) || byTitle(a, b);
    const byCreatedUp = (a, b) => cmpText(String(a.game.created || ""), String(b.game.created || "")) || byTitle(a, b);
    const played = this.user?.gamePlayed || {};
    const byPlayed = (a, b) => (played[b.game.folder] || 0) - (played[a.game.folder] || 0) || byCreated(a, b);
    const fmtName = (e) => FORMAT_NAMES[e.game.console] || e.game.console || "PS3";
    const byFormat = (a, b) => cmpBase(fmtName(a), fmtName(b)) || byCreated(a, b);
    const order = { created_asc: byCreatedUp, recent: byPlayed, format: byFormat }[this._gameSortId()] || byCreated;
    // a game with no icon that isn't inside a folder gets the default game icon
    const withDefault = (e) => e.icon.art ? e : { ...e, icon: { ...e.icon, art: "./assets/icons/system/default_game.png", noIcon: true } };
    if (mode !== "format" && mode !== "album") return [...entries].sort(order).map(withDefault);
    const groups = new Map();
    for (const e of entries) {
      const k = mode === "format" ? (FORMAT_NAMES[e.game.console] || e.game.console || "PS3") : (e.game.album || "Unknown");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    return [...groups.entries()].sort((a, b) => cmpBase(a[0], b[0])).map(([name, items]) => {
      const children = [...items].sort(order), n = children.length;
      return { kind: "drill", title: name, sub: `${n} Title${n !== 1 ? "s" : ""}`,
        icon: { folder: "game", art: children[0].icon.art || null }, children };
    });
  }
  // "2026-04-09 07:36" (game.json Created) → "9/4/2026  7:36 AM" in the
  // user's date / time formats
  _fmtCreated(c) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(c || "").trim());
    if (!m) return String(c || "").trim();
    return this._fmtDateTime(new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)), m[4] != null);
  }
  _fmtDateTime(d, withTime = true) {
    const b = this.settings?.behavior || {};
    const D = d.getDate(), M = d.getMonth() + 1, Y = d.getFullYear();
    const fmt = b.dateFormat || "DD/MM/YYYY";
    const date = fmt === "MM/DD/YYYY" ? `${M}/${D}/${Y}` : fmt === "YYYY/MM/DD" ? `${Y}/${M}/${D}` : `${D}/${M}/${Y}`;
    if (!withTime) return date;
    const h = d.getHours(), mi = String(d.getMinutes()).padStart(2, "0");
    const time = (b.timeFormat || "24") === "12" ? `${h % 12 || 12}:${mi} ${h < 12 ? "AM" : "PM"}` : `${h}:${mi}`;
    return `${date}\u2002\u2002${time}`;
  }
  async _refreshGameColumn() {
    const col = this.columns ? this.columns.find((c) => c.id === "game") : null;
    if (!col) return;
    const games = await call("scan_library");
    // (kept as the list read last: menus drawn again after a theme change use
    // it, and must show the games as they are now, not as they were at start)
    this._lastGames = games;
    const items = this._gameItems(games);
    const sig = (l) => l.map((x) => `${x.title}|${x.sub || ""}|${x.icon?.art || ""}`).join("\n");
    if (sig(items) === sig(col.items)) {
      // nothing new to draw: the games' own settings (Options Band, Hide Game
      // Title On Background…) still take effect at once
      const byFolder = new Map(items.filter((x) => x.game).map((x) => [x.game.folder, x.game]));
      for (const x of col.items) { const g = x.game && byFolder.get(x.game.folder); if (g) Object.assign(x.game, g); }
      return;
    }
    col.items = items;
    if (this.columns[this.selCat] === col && this.levels.length === 1 && !this.overlay) {
      const cur = this.levels[0].items[this.levels[0].sel];
      let sel = cur ? items.findIndex((x) => x.title === cur.title) : -1;
      if (sel < 0) sel = Math.min(this.levels[0].sel, items.length - 1);
      this.levels[0].items = col.items; this.levels[0].sel = Math.max(0, sel); this._render(); this._onSelect();
    }
    const psn = this.columns.find((c) => c.id === "psn"); if (psn) psn.items = this._psnItems();
    if (col.sel != null && col.sel >= col.items.length) col.sel = Math.max(0, col.items.length - 1);
  }
  // Music / Photo / Video lists again (after the media folders change)
  // A library's fingerprint (a short code from its files' places, sizes and
  // dates, made without opening them) is noted each time its list is read, so
  // reading it again can be skipped while nothing changed
  async _takeMediaFingerprints(ids) {
    const fp = (this._mediaFp ||= {});
    await Promise.all(ids.map(async (id) => { try { fp[id] = await call("media_fingerprint", { kind: id }); } catch (e) { fp[id] = null; } }));
  }
  // force: build them again even when the same files are listed (their
  // pictures changed: covers read again)
  async _refreshMediaColumns(only, force = false) {
    await this._takeMediaFingerprints(only ? [only] : ["photo", "video", "music"]);
    for (const id of only ? [only] : ["photo", "video", "music"]) {
      const col = this.columns ? this.columns.find((c) => c.id === id) : null;
      if (!col) continue;
      const items = id === "music" ? await this._musicItems() : [...col.items.slice(0, FIXED_ITEMS[id]), ...await this._mediaSectionItems(id)];
      const same = items.length === col.items.length && items.every((x, i) => x.title === col.items[i].title && x.sub === col.items[i].sub);
      if (same && !force) continue;
      col.items = items;
      if (col.sel != null && col.sel >= col.items.length) col.sel = Math.max(0, col.items.length - 1);
      // the column on screen (at its top level) shows the new list in place
      if (this.columns[this.selCat] === col && this.levels.length === 1 && !this.overlay) {
        const cur = this.levels[0].items[this.levels[0].sel];
        let sel = cur ? items.findIndex((x) => x.title === cur.title) : -1;
        if (sel < 0) sel = Math.min(this.levels[0].sel, items.length - 1);
        this.levels[0].items = items; this.levels[0].sel = Math.max(0, sel); this._render(); this._onSelect();
      }
    }
  }
  // New files / games in the source folders (or put in the app's folders by
  // hand) show up when their column is opened, without a restart.
  _liveRefresh(id) {
    if (String(id).startsWith("sec:")) { this._liveRefreshSection(id); return; }
    if (!["game", "music", "photo", "video"].includes(id) || this._inGame) return;
    const now = Date.now(); this._liveAt ||= {};
    if (now - (this._liveAt[id] || 0) < 8000) return;
    this._liveAt[id] = now;
    setTimeout(async () => {
      if (this.columns[this.selCat]?.id !== id) return;
      if (id === "game") { this._refreshGameColumn().then(() => this._scrapeWaiting()); return; }
      // the whole list is read and built again only when the library's
      // fingerprint changed (files added, removed, renamed or changed): with a
      // big library that's a lot of work (and memory to clean up afterwards)
      let fp = null; try { fp = await call("media_fingerprint", { kind: id }); } catch (e) {}
      if (fp && fp === (this._mediaFp || {})[id]) return;
      if (this.columns[this.selCat]?.id !== id) return;
      this._refreshMediaColumns(id);
    }, 450);   // after the column has slid in
  }

  // A custom section, reached: its folders are read again, and when anything
  // in them changed (folders or files added, removed or renamed) it's drawn
  // again at once, the cursor staying on the same item
  _liveRefreshSection(id) {
    if (this._inGame) return;
    const now = Date.now(); this._liveAt ||= {};
    if (now - (this._liveAt[id] || 0) < 3000) return;
    this._liveAt[id] = now;
    setTimeout(async () => {
      const col = this.columns[this.selCat];
      if (!col || col.id !== id || this.levels.length !== 1 || this.overlay) return;
      const sec = this._sectionById(col.section); if (!sec) return;
      let fresh; try { fresh = await this._sectionColumn(sec); } catch (e) { return; }
      const sig = (c) => JSON.stringify([c.entries, c.subEntries]);
      if (sig(fresh) === sig(col)) return;
      // (only if nothing moved meanwhile)
      if (this.columns[this.selCat] !== col || this.levels.length !== 1 || this.overlay || this._placing) return;
      for (const [k, v] of Object.entries(col)) if (k.startsWith("_") && !(k in fresh)) fresh[k] = v;
      const selT = this.levels[0].items[this.levels[0].sel]?.title;
      this.columns[this.selCat] = fresh;
      const i = fresh.items.findIndex((x) => x.title === selT);
      this.levels = [{ items: fresh.items, sel: Math.max(0, Math.min(i >= 0 ? i : this.levels[0].sel, fresh.items.length - 1)) }];
      this._render(); this._onSelect();
    }, 450);
  }

  // ---- Media Folders submenu (System Settings) ------------------------------
  // Music, Videos and Photos are always read from the app's own folders. The
  // folders added here are their sources: File Recognition gives every file in
  // them a shortcut in the matching app folder (in a folder named after the
  // source), which can be moved into folders of your own there, like games.
  // Subtitles are read where they are.
  _mediaFolderItems() {
    const SI = { sys: "icon_setting_item.png" };
    const row = (key, title, app, what) => {
      const list = this._mediaList(key);
      return { kind: "drill", title, icon: SI, childrenFn: () => this._mediaFolderList(key, app),
        sub: list.length ? list.map(winPath).join("\n") : `No folders added. The system only reads the ${what} files from the system's content\\${app} directory.` };
    };
    return [
      row("music", "Music Folders", "Music", "music"),
      row("photos", "Photo Folders", "Photos", "photo"),
      row("videos", "Video Folders", "Videos", "video"),
      row("subtitles", "Subtitle Folders", "Subtitles", "subtitle"),
      { kind: "action", act: "media_recog::all", title: "File Recognition", icon: SI,
        sub: "The system looks through every chosen media folder to add their files to the system." },
    ];
  }
  // the folders chosen for one kind (older settings kept a single path)
  _mediaList(key) {
    const v = (this.settings?.mediaFolders || {})[key];
    return (Array.isArray(v) ? v : v ? [v] : []).filter((p) => p && String(p).trim());
  }
  _mediaKind(key) { return { music: "music", videos: "video", photos: "photo" }[key] || null; }
  _mediaFolderList(key, app) {
    const SI = { sys: "icon_setting_item.png" };
    const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
    const list = this._mediaList(key);
    const kind = this._mediaKind(key);
    return [
      { kind: "action", act: `media_pick::${key}`, title: "Add Folder", icon: SI,
        sub: kind ? `Choose a folder to read ${app.toLowerCase()} from. Its files get shortcuts in the ${app} folder in the app directory right away.`
          : "Choose a folder to read subtitles from." },
      ...(kind && list.length ? [{ kind: "action", act: `media_recog::${kind}`, title: "File Recognition", icon: SI,
        sub: `Looks through these folders now and makes shortcuts for the new files in the ${app} folder in the app directory.` }] : []),
      ...list.map((p, i) => ({ kind: "action", act: `media_rm::${key}::${i}`, title: base(p), icon: SI,
        sub: kind ? `${winPath(p)}\nPress \u2715 to remove this folder. The shortcuts made from it are removed too (its files aren't touched).`
          : `${winPath(p)}\nPress \u2715 to remove this folder (its files aren't touched).` })),
    ];
  }
  async _mediaPick(key) {
    if (this._picking) return;
    this._picking = true;
    const names = { music: "Music", videos: "Video", photos: "Photo", subtitles: "Subtitle" };
    const apps = { music: "Music", videos: "Videos", photos: "Photos", subtitles: "Subtitles" };
    let path = null;
    try { path = await call("pick_folder", { title: `Add a ${names[key]} Folder` }); } catch (e) {}
    this._picking = false;
    if (!path) return;
    const list = this._mediaList(key);
    if (!list.includes(path)) list.push(path);
    this.settings.mediaFolders = { ...(this.settings.mediaFolders || {}), [key]: list };
    await this._persistSettings(); this.audio.play("enter", 0.5);
    this._rebuildLevel(() => this._mediaFolderList(key, apps[key]));
    this._refreshParentMediaFolders();
    const kind = this._mediaKind(key);
    if (kind) {
      // its files are recognized right away (the menu waits, with a counter)
      const lvl = this._level(); const i = lvl.items.findIndex((x) => x.act === `media_recog::${kind}`);
      if (i >= 0) { lvl.sel = i; this._render(); this._onSelect(); }
      await this._mediaRecognize(kind);
    }
  }
  // File Recognition, with the menu locked and a counter beside the option
  async _mediaRecognize(kind) {
    const n = await this._runLocked(`media_recog::${kind}`, "Recognizing files...",
      () => call("media_recognize", { kind }).catch(() => 0));
    await this._refreshMediaColumns();
    this._shotFeedback(n ? `${n} new file${n === 1 ? "" : "s"} found` : "No new files found");
  }
  _refreshParentMediaFolders() {
    const parent = this.levels[this.levels.length - 2];
    if (parent && parent.items.some((x) => x.act === "media_recog::all")) parent.items = this._mediaFolderItems();
  }
  _mediaRemove(key, i) {
    const list = this._mediaList(key);
    if (!list[i]) return;
    const kind = this._mediaKind(key);
    this.overlay = this.confirm;
    const fname = list[i];   // (the whole path)
    this.confirm.open(kind ? `Remove the ${fname} folder? The shortcuts made from it are removed too (its files aren't touched).` : `Remove the ${fname} folder? (Its files aren't touched.)`,
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      async (c) => {
        this.confirm.close(); this.overlay = null;
        if (!c || c.id !== "yes") return;
        const src = list[i];
        list.splice(i, 1);
        this.settings.mediaFolders = { ...(this.settings.mediaFolders || {}), [key]: list };
        this._persistSettings(); this.audio.play("back", 0.5);
        if (kind) { try { await call("media_source_remove", { kind, source: src }); } catch (e) {} }
        const names = { music: "Music", videos: "Videos", photos: "Photos", subtitles: "Subtitles" };
        this._rebuildLevel(() => this._mediaFolderList(key, names[key]));
        this._refreshParentMediaFolders();
        if (kind) this._refreshMediaColumns();
      },
      () => { this.confirm.close(); this.overlay = null; });
  }
  // A long job (deleting cache, recognizing files…): the option shows a
  // spinning loading icon and a counter (from the system's "xmb-progress"
  // reports) and a warning, and the menu stays locked on it until it's done.
  async _runLocked(act, title, fn) {
    if (this._preloadState === "loading") return undefined;
    this._preloadState = "loading"; this._preloadAct = act; this._preloadTitle = title;
    this._preloadDone = 0; this._preloadTotal = 0;
    // not started from an option on screen (new games found when the Game
    // column opened): the same loading icon, counter and warning in a box
    const lvl = this._level();
    const onItem = !!(lvl && lvl.items.some((x) => x.act === act));
    if (!onItem) this._lockBox(true);
    let raf = 0;
    const redraw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0;
      if (onItem) this._refreshDetail(this.root.clientWidth, this.root.clientHeight); else this._lockBox(true); }); };
    redraw();
    let un = null;
    const ev = window.__TAURI__?.event;
    if (ev?.listen) { try { un = await ev.listen("xmb-progress", (e) => { const p = e.payload || {}; this._preloadDone = p.done | 0; this._preloadTotal = p.total | 0; redraw(); }); } catch (e) {} }
    let r;
    try { r = await fn((t) => { this._preloadTitle = t; this._preloadDone = 0; this._preloadTotal = 0; redraw(); }); }
    finally { if (un) { try { un(); } catch (e) {} } }
    // (a redraw still waiting for its frame would put the box back up)
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    this._preloadState = "done"; this._preloadTitle = null;
    if (!onItem) { this._lockBox(false); this._preloadState = null; }
    this.audio.play("enter", 0.4);
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    return r;
  }
  _lockBox(on) {
    let el = document.getElementById("lockbox");
    if (!on) { if (el) el.classList.remove("show"); return; }
    if (!el) { el = document.createElement("div"); el.id = "lockbox"; document.body.appendChild(el); }
    const n = this._preloadTotal ? ` ${this._preloadDone}/${this._preloadTotal}` : "";
    el.innerHTML = `<div class="lb-panel"><div class="lb-title">${esc(this._preloadTitle || "Please wait...")}<span class="d-status"><img class="d-spin" src="./assets/icons/system/loading_icon.png" alt="">${n}</span></div>`
      + `<div class="lb-sub">Please wait. The system could slow down while this runs. Do not close or navigate away until it finishes.</div></div>`;
    el.classList.add("show");
  }
  // Newly recognized games waiting for their art (Automatic Scraping): fetched
  // now, with the menu waiting on it
  async _scrapeWaiting(act) {
    let n = 0; try { n = await call("game_scrape_waiting"); } catch (e) {}
    if (!n) return 0;
    const got = await this._runLocked(act || "__scrape__", "Getting game art online...", () => call("game_scrape_queued").catch(() => 0));
    await this._refreshGameColumn();
    return got || 0;
  }
  // re-derive the open submenu's items in place, keeping the cursor
  _rebuildLevel(fn) {
    const lvl = this._level();
    if (!lvl) return;
    lvl.items = fn.call(this);
    lvl.sel = Math.max(0, Math.min(lvl.sel, lvl.items.length - 1));
    this._render(); this._onSelect();
  }

  // ---- Game Settings > Game Information: every game's game.json ------------
  _gameSettingsList() {
    const games = [...(this._allGames || [])].sort((a, b) => cmpNatural(String(a.title), String(b.title)));
    if (!games.length) return [{ kind: "ph", title: "No Games", sub: "", icon: { sys: "icon_setting_item.png" } }];
    return games.map((g) => ({ kind: "drill", title: gameName(g), sub: g.album ? `Album: ${g.album}` : "",
      // each game's own icon (never the disc, even for the disc game)
      icon: { art: g.icon ? assetUrl(g.icon) : "./assets/icons/system/default_game.png", gameArt: true },
      childrenFn: () => this._gameSettingItems(g.folder) }));
  }
  // Folder Console: one row per folder in content/Games that holds games
  _folderConsoleList() {
    const SI = { sys: "icon_setting_item.png" };
    const albums = [...new Set((this._allGames || []).map((g) => g.album).filter(Boolean))]
      .sort((a, b) => cmpBase(a, b));
    if (!albums.length) return [{ kind: "ph", title: "No Folders", icon: SI }];
    return albums.map((a) => {
      const n = (this._allGames || []).filter((g) => g.album === a).length;
      return { kind: "setting", ctl: `gmf:${a}`, title: a, icon: { sys: "item_tex_ps3game_folder.png" },
        sub: `${n} Title${n !== 1 ? "s" : ""}. Sets the Console of all of them.` };
    });
  }
  _gmfValue(ctl) {
    const games = (this._allGames || []).filter((g) => g.album === ctl.slice(4));
    const set = new Set(games.map((g) => g.console || "PS3"));
    return set.size === 1 ? [...set][0] : set.size ? "Mixed" : "-";
  }
  async _gmfAdjust(ctl, dir) {
    const cur = this._gmfValue(ctl);
    const i = CONSOLES.indexOf(cur);
    this._gmfSet(ctl, i < 0 ? CONSOLES[dir > 0 ? 0 : CONSOLES.length - 1] : CONSOLES[(i + dir + CONSOLES.length) % CONSOLES.length]);
  }
  _gmfSet(ctl, next) {
    const games = (this._allGames || []).filter((g) => g.album === ctl.slice(4));
    if (!games.length) return;
    this.audio.play("cursor_up", 0.4);
    for (const g of games) g.console = next;
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    clearTimeout(this._gmfT);   // save once the choice settles
    this._gmfT = setTimeout(async () => {
      for (const g of games) { try { await call("game_meta_save", { folder: g.folder, patch: { console: g.console } }); } catch (e) {} }
      await this._refreshGameColumn();
      const lvl = this._level();
      if (lvl && lvl.items.some((x) => x.ctl && x.ctl.startsWith("gmf:"))) this._rebuildLevel(this._folderConsoleList);
    }, 450);
  }
  _gameByFolder(folder) { return (this._allGames || []).find((g) => g.folder === folder); }
  _gameSettingItems(folder) {
    const SI = { sys: "icon_setting_item.png" };
    const k = (key) => `gm:${key}:${folder}`;
    return [
      { kind: "setting", ctl: k("title"), title: "Title", icon: SI },
      { kind: "setting", ctl: k("parentalControl"), title: "Parental Control", icon: SI },
      { kind: "setting", ctl: k("created"), title: "Created", icon: SI, sub: "year-month-day hour:minute" },
      { kind: "setting", ctl: k("size"), title: "Size", icon: SI },
      { kind: "setting", ctl: k("version"), title: "Version", icon: SI },
      { kind: "setting", ctl: k("starts"), title: "Starts", icon: SI, sub: "year-month-day hour:minute" },
      { kind: "setting", ctl: k("isDisc"), title: "Disc", icon: SI, sub: "On: Shown as the game inside the Disc." },
      { kind: "setting", ctl: k("console"), title: "Console", icon: SI },
      ...GAME_MEDIA.map((m) => ({ kind: "action", act: `gmm::${m.kind}::${folder}`, title: m.title, icon: SI })),
      { kind: "action", act: `gm_scrape::${folder}`, title: "Get Art Online", icon: SI,
        sub: "Looks for art for the game in SteamGridDB, TheGamesDB or RAWG." },
      { kind: "setting", ctl: k("optionsBand"), title: "Options Band", icon: SI,
        sub: "On: When a game's options are open, a black see-through band appears behind the game's icon and title." },
      { kind: "setting", ctl: k("hideTitle"), title: "Hide Game Title On Background", icon: SI,
        sub: "On: A game with a background hides its title once the background appears." },
    ];
  }

  // Theme Settings > Icons > Intro Icon / Intro Title: your own picture in
  // place of the PlayStation mark / the "PlayStation 3" title of the Boot Intro
  _introArtSub(which) {
    return which === "icon" ? "Select a photo to replace the Playstation icon in the intro."
      : "Select a photo to replace the \"Playstation 3\" title in the intro.";
  }
  async _introArtMenu(which) {
    const key = which === "icon" ? "introIcon" : "introTitle";
    const title = which === "icon" ? "Intro Icon" : "Intro Title";
    const exts = ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"];
    const ext = (p) => (/\.([a-z0-9]+)$/i.exec(p || "") || [])[1]?.toLowerCase() || "";
    let files = [];
    try { files = await call("list_media", { kind: "photo" }); } catch (e) {}
    const seen = new Set();
    files = (files || []).filter((f) => f && f.path && exts.includes(ext(f.path)) && !seen.has(f.path) && seen.add(f.path))
      .sort((a, b) => cmpNatural(noExt(a.path.split(/[\\/]/).pop()), noExt(b.path.split(/[\\/]/).pop())));
    const cur = this.settings?.behavior?.[key];
    const items = [
      ...(cur ? [{ label: "Default", id: "__none__" }] : []),
      ...(files.length ? [{ label: "From the Photos Folder\u2026", id: "__grid__" }] : []),
      { label: "Choose File\u2026", id: "__pick__" },
    ];
    const apply = (path) => {
      this.settings.behavior = this.settings.behavior || {};
      if (path) this.settings.behavior[key] = path; else delete this.settings.behavior[key];
      this._persistSettings();
      this.audio.play(path ? "enter" : "back", 0.5);
      this._render(this.root.clientWidth, this.root.clientHeight); this._onSelect();
    };
    this.overlay = this.sideMenu;
    this.sideMenu.open(items, { title }, async (ch) => {
      this.sideMenu.close(); this.overlay = null;
      if (ch.id === "__none__") { apply(null); return; }
      if (ch.id === "__grid__") {
        const gi = files.map((f) => ({ label: noExt(f.title || f.path.split(/[\\/]/).pop()), id: f.path, thumb: stillUrl(f.path, f.cover) }));
        this.overlay = this.listPicker;
        this.listPicker.open({ title, items: gi, grid: true, submit: "Select" }, (it) => {
          this.listPicker.close(); this.overlay = null;
          if (it && it.id) apply(it.id);
        }, () => { this.listPicker.close(); this.overlay = null; this._introArtMenu(which); });
        return;
      }
      let path = null;
      try { path = await call("pick_file", { title: `Choose the ${title}`, name: title, exts }); } catch (e) { path = null; }
      if (path) apply(path);
    }, () => { this.sideMenu.close(); this.overlay = null; });
  }
  // Game Settings > Icon / Background / Video / Music: a file from the app's
  // folders (picked from a grid of thumbnails, like the Photo Gallery), any
  // file on the computer, or none
  async _gameMediaMenu(kind, folder) {
    const m = GAME_MEDIA.find((x) => x.kind === kind); if (!m) return;
    const g = this._gameByFolder(folder);
    const ext = (p) => (/\.([a-z0-9]+)$/i.exec(p || "") || [])[1]?.toLowerCase() || "";
    let files = [];
    for (const src of m.from) { try { files.push(...await call("list_media", { kind: src })); } catch (e) {} }
    const seen = new Set();
    files = files.filter((f) => f && f.path && m.exts.includes(ext(f.path)) && !seen.has(f.path) && seen.add(f.path))
      .sort((a, b) => cmpNatural(noExt(a.path.split(/[\\/]/).pop()), noExt(b.path.split(/[\\/]/).pop())));
    const folderName = { icon: "Photos", background: "Photos", preview: "Videos", music: "Music" }[kind];
    const items = [
      ...(g && g[m.key] ? [{ label: "Remove", id: "__none__" }] : []),
      ...(files.length ? [{ label: `From the ${folderName} Folder\u2026`, id: "__grid__" }] : []),
      { label: "Choose File\u2026", id: "__pick__" },
    ];
    this.overlay = this.sideMenu;
    this.sideMenu.open(items, { title: m.title }, async (ch) => {
      this.sideMenu.close(); this.overlay = null;
      if (ch.id === "__grid__") { this._gameMediaGrid(folder, m, files); return; }
      let path = ch.id;
      if (path === "__pick__") {
        try { path = await call("pick_file", { title: `Choose the ${m.title}`, name: m.title, exts: m.exts }); } catch (e) { path = null; }
        if (!path) return;
      }
      await this._gameMediaApply(folder, m, path === "__none__" ? null : path);
    }, () => { this.sideMenu.close(); this.overlay = null; });
  }
  _gameMediaGrid(folder, m, files) {
    const isVid = (p) => /\.(mp4|webm|mov|mkv|m4v)$/i.test(p);
    const items = files.map((f) => {
      const art = m.kind === "music" ? (f.cover ? thumbUrl(f.cover) : sysUrl("icon_music_default.png")) : stillUrl(f.path, f.cover);
      return { label: noExt(f.title || f.path.split(/[\\/]/).pop()), id: f.path, thumb: art, vsrc: m.kind !== "music" && isVid(f.path) ? assetUrl(f.path) : null };
    });
    this.overlay = this.listPicker;
    this.listPicker.open({ title: m.title, items, grid: true, submit: "Select" }, async (it) => {
      this.listPicker.close(); this.overlay = null;
      if (it && it.id) await this._gameMediaApply(folder, m, it.id);
    }, () => { this.listPicker.close(); this.overlay = null; this._gameMediaMenu(m.kind, folder); });
  }
  async _gameMediaApply(folder, m, path) {
    const g = this._gameByFolder(folder);
    try { await call("game_media_set", { folder, kind: m.kind, path }); }
    catch (e) { this.audio.play("error", 0.5); this._shotFeedback(String(e || "That file can't be used")); return; }
    this.audio.play(path ? "enter" : "back", 0.5);
    if (g) for (const k of ["icon", "background", "preview", "music"]) bumpAsset(g[k]);
    await this._afterGameArt(folder);
  }
  // the Game column and the open Game Settings show the game's new art / name
  async _afterGameArt(folder) {
    await this._refreshGameColumn();
    const g = this._gameByFolder(folder);
    if (g) for (const k of ["icon", "background", "preview", "music"]) bumpAsset(g[k]);
    const lvl = this._level();
    if (lvl && lvl.items.some((x) => x.act === `gm_scrape::${folder}`)) this._rebuildLevel(() => this._gameSettingItems(folder));
    const up = this.levels[this.levels.length - 2];
    if (up && up.items.some((x) => x.childrenFn && x.title && x.icon?.gameArt)) {
      const sel = up.sel; up.items = this._gameSettingsList(); up.sel = Math.min(sel, up.items.length - 1);
    }
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  async _gameScrape(folder) {
    const g = this._gameByFolder(folder); if (!g) return;
    const r = await this._runLocked(`gm_scrape::${folder}`, "Looking the game up...",
      () => call("game_scrape", { folder, title: g.title }).catch(() => null));
    if (!r) { this.audio.play("error", 0.5); return; }
    const got = [r.icon && "icon", r.background && "background", r.preview && "video", r.name && "name", r.console && `console (${r.console})`].filter(Boolean);
    this._shotFeedback(r.message || `Found: ${got.join(", ")}`);
    if (r.message) this.audio.play("error", 0.4);
    await this._afterGameArt(folder);
  }
  _gmParse(ctl) { const m = /^gm:([^:]+):(.*)$/.exec(ctl || ""); return m ? { key: m[1], folder: m[2] } : null; }
  // Game Options Band / Hide Game Title on Background: each game's own choice
  // (its game.json); a game not set yet keeps what the old system-wide
  // setting said (band on, title shown by default)
  _gameBandOn(g) { return g && typeof g.optionsBand === "boolean" ? g.optionsBand : this.settings?.behavior?.gameBand !== false; }
  _gameHideTitle(g) { return g && typeof g.hideTitle === "boolean" ? g.hideTitle : !!this.settings?.behavior?.gameHideTitle; }
  _gmValue(ctl) {
    const p = this._gmParse(ctl), g = p && this._gameByFolder(p.folder);
    if (!g) return "";
    switch (p.key) {
      case "parentalControl": return g.parentalControl ? `Level ${g.parentalControl}` : "-";
      case "isDisc": return g.isDisc ? "On" : "Off";
      case "optionsBand": return this._gameBandOn(g) ? "On" : "Off";
      case "hideTitle": return this._gameHideTitle(g) ? "On" : "Off";
      case "created": case "starts": return g[p.key] ? this._fmtCreated(g[p.key]) : "-";
      default: return String(g[p.key] || "-");
    }
  }
  async _gmSave(folder, patch) {
    try { await call("game_meta_save", { folder, patch }); } catch (e) { this.audio.play("error", 0.4); return; }
    await this._refreshGameColumn();
    const lvl = this._level();
    if (lvl && lvl.items.some((i) => i.ctl && i.ctl.startsWith("gm:"))) this._rebuildLevel(() => this._gameSettingItems(folder));
  }
  _gmAdjust(ctl, dir) {
    const p = this._gmParse(ctl), g = p && this._gameByFolder(p.folder);
    if (!g) return;
    this.audio.play("cursor_up", 0.4);
    if (p.key === "parentalControl") {
      const v = ((g.parentalControl || 0) + dir + 12) % 12;          // 0 = not set
      g.parentalControl = v || null; this._gmSave(g.folder, { parentalControl: v || null });
    } else if (p.key === "console") {
      const i = Math.max(0, CONSOLES.indexOf(g.console));
      g.console = CONSOLES[(i + dir + CONSOLES.length) % CONSOLES.length]; this._gmSave(g.folder, { console: g.console });
    } else if (p.key === "isDisc") {
      g.isDisc = !g.isDisc; this._gmSave(g.folder, { isDisc: g.isDisc });
    } else if (p.key === "optionsBand") {
      g.optionsBand = !this._gameBandOn(g); this._gmSave(g.folder, { optionsBand: g.optionsBand });
    } else if (p.key === "hideTitle") {
      g.hideTitle = !this._gameHideTitle(g); this._gmSave(g.folder, { hideTitleOnBackground: g.hideTitle });
    }
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _gmEdit(ctl) {
    const p = this._gmParse(ctl), g = p && this._gameByFolder(p.folder);
    if (!g) return;
    if (["parentalControl", "console", "isDisc", "optionsBand", "hideTitle"].includes(p.key)) { this._gmAdjust(ctl, 1); return; }
    const labels = { title: "Title", created: "Created", size: "Size", version: "Version", starts: "Starts" };
    this.overlay = this.textForm;
    this.textForm.open({ title: `${gameName(g)}: ${labels[p.key]}`, fields: [{ key: "v", label: labels[p.key], value: g[p.key] || "" }], submit: "Confirm" },
      async (out) => { this.textForm.close(); this.overlay = null; g[p.key] = String(out.v || "").trim(); await this._gmSave(g.folder, { [p.key]: g[p.key] }); },
      () => { this.textForm.close(); this.overlay = null; });
  }
  // ---- Game Recognition submenu (System Settings) ---------------------------
  // Games are always read from content/Games. Games found in the source
  // folders added here (Steam's "common" folder, for example) get a folder
  // there with a shortcut to the .exe, a game.json and the exe's icon; the
  // folders can be sorted into folders of your own inside the Games folder.
  _gameRecognitionItems() {
    const SI = { sys: "icon_setting_item.png" };
    const srcs = this.settings?.gameSources || [];
    const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
    return [
      { kind: "action", act: "gsrc_add", title: "Add Source Folder", icon: SI },
      { kind: "drill", title: "Recognized Games", icon: SI, childrenFn: this._detectedGameItems,
        sub: "Games found on your chosen game folders. Choose one to delete it from the system's content\\Games directory (The actual game doesn't get deleted)." },
      { kind: "drill", title: "Game Databases", icon: SI, childrenFn: this._scrapeItems,
        sub: "Enter the keys to automatically access the game art in SteamGridDB, TheGamesDB or RAWG." },
      ...(srcs.length ? [{ kind: "action", act: "gsrc_scan", title: "Game Recognition", icon: SI,
        sub: "Looks for new games in the source folders now. New games are also found every time you open the Game column." }] : []),
      ...srcs.map((p, i) => ({ kind: "action", act: `gsrc_remove::${i}`, title: base(p), icon: { sys: "icon_game.png" },
        sub: `${winPath(p)}\nPress \u2715 to remove this source folder. The games found in it are removed from the Games folder (the games themselves aren't touched).` })),
    ];
  }
  // ---- Game Databases (Game Recognition) -------------------------------------
  _scrapeCfg() { return (this.settings.scrape ||= {}); }
  _scrapeItems() {
    const SI = { sys: "icon_setting_item.png" };
    const c = this._scrapeCfg();
    const key = (k, title) => ({ kind: "action", act: `scrape_key::${k}`, title, icon: SI,
      sub: c[k] ? (/password/i.test(k) ? "\u2022".repeat(8) : c[k]) : "Not Set" });
    return [
      { kind: "setting", ctl: "scrapeauto", title: "Automatic Scraping", icon: SI,
        sub: "On: Automatically search game art when a game gets recognized by the system." },
      key("sgdbKey", "SteamGridDB API Key"),
      key("tgdbKey", "TheGamesDB API Key"),
      key("rawgKey", "RAWG API Key"),
    ];
  }
  _scrapeKeyEdit(k) {
    const c = this._scrapeCfg();
    const lvl = this._level(); const it = lvl && lvl.items[lvl.sel];
    const title = it ? it.title : k;
    this.overlay = this.textForm;
    this.textForm.open({ title, fields: [{ key: "v", label: title, value: c[k] || "" }], submit: "Confirm" },
      (out) => {
        this.textForm.close(); this.overlay = null;
        c[k] = String(out.v || "").trim(); this._persistSettings(); this.audio.play("enter", 0.5);
        this._rebuildLevel(this._scrapeItems);
      },
      () => { this.textForm.close(); this.overlay = null; });
  }
  _detectedGameItems() {
    const list = this._detected || [];
    // the games put in the Games folder by hand are listed too (with the
    // recognized ones, by title)
    const key = (f) => String(f || "").replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
    const known = new Set(list.map((g) => key(g.folder)));
    this._manualGames = (this._allGames || []).filter((g) => g.folder && !known.has(key(g.folder)));
    const rows = [
      // (each row names its game by its folder: a list drawn again meanwhile
      // can never make ✕ delete another game)
      ...list.map((g) => ({ kind: "action", act: `gsrc_del::${g.folder}`, title: g.title, icon: { sys: "tex_game.png" },
        sub: `${winPath(g.exe)}\nPress ✕ to delete this game.` })),
      ...this._manualGames.map((g) => ({ kind: "action", act: `gman_del::${g.folder}`, title: gameName(g), icon: { sys: "tex_game.png" },
        sub: `${winPath(g.folder)}\nPress ✕ to delete this game.` })),
    ].sort((a, b) => cmpNatural(String(a.title), String(b.title)));
    if (!rows.length) return [{ kind: "ph", title: "No Recognized Games", sub: "", icon: { sys: "icon_setting_item.png" } }];
    return rows;
  }
  // a game put in the Games folder by hand, deleted from Recognized Games: the
  // console's Delete screen, as from the game's own options
  _gmanDelete(folder) {
    const game = (this._manualGames || []).find((g) => g.folder === folder);
    if (!game) return;
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ icon: game.icon ? assetUrl(game.icon) : "./assets/icons/system/default_game.png",
      meta: [gameName(game), game.created ? this._fmtCreated(game.created) : "", game.size || ""].filter(Boolean),
      text: "The installed game will be deleted.\nAre you sure you want to continue?" },
      async (yes) => {
        this.gameConfirm.close(); this.overlay = null;
        if (!yes) return;
        try { await call("game_delete", { folder: game.folder }); }
        catch (e) { this.audio.play("error", 0.4); return; }
        this._allGames = (this._allGames || []).filter((g) => g.folder !== game.folder);
        // (the menu waits, with the loading clock, until the lists are drawn again)
        await this._refreshGameColumn();
        this._rebuildLevel(this._detectedGameItems);
      });
  }
  async _loadDetected() {
    try { this._detected = await call("game_sources_detected"); } catch (e) { this._detected = []; }
  }
  async _gsrcAdd() {
    if (this._picking) return;
    this._picking = true;
    let path = null;
    try { path = await call("pick_folder", { title: "Add a Game Source Folder" }); } catch (e) {}
    this._picking = false;
    if (!path) return;
    const list = this.settings.gameSources || (this.settings.gameSources = []);
    if (!list.includes(path)) list.push(path);
    await this._persistSettings(); this.audio.play("enter", 0.5);
    this._rebuildLevel(this._gameRecognitionItems);
    const lvl = this._level(); const i = lvl.items.findIndex((x) => x.act === "gsrc_scan");
    if (i >= 0) { lvl.sel = i; this._render(); this._onSelect(); }
    this._gsrcScan(false);
  }
  _gsrcRemove(i) {
    const list = this.settings.gameSources || [];
    if (!list[i]) return;
    this.overlay = this.confirm;
    this.confirm.open(`Remove the ${list[i]} folder? The games found in it are removed from the Games folder too (the games themselves aren't touched).`,
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      async (c) => {
        this.confirm.close(); this.overlay = null;
        if (c && c.id === "yes") {
          const src = list[i];
          list.splice(i, 1); this._persistSettings(); this.audio.play("back", 0.5);
          try { await call("game_sources_remove", { source: src }); } catch (e) {}
          await this._loadDetected();
          this._rebuildLevel(this._gameRecognitionItems);
          this._refreshGameColumn();
        }
      },
      () => { this.confirm.close(); this.overlay = null; });
  }
  async _gsrcScan(quiet) {
    if (this._scanning) return;
    this._scanning = true;
    let n = 0;
    // the games are recognized, then (Automatic Scraping) their art is fetched,
    // the menu waiting on both
    const run = async (retitle) => {
      const made = await call("game_sources_sync").catch(() => 0);
      let w = 0; try { w = await call("game_scrape_waiting"); } catch (e) {}
      if (w && retitle) { retitle("Getting game art online..."); await call("game_scrape_queued").catch(() => 0); }
      return made;
    };
    try { n = (quiet ? await run(null) : await this._runLocked("gsrc_scan", "Recognizing games...", run)) || 0; } catch (e) {}
    this._scanning = false;
    await this._loadDetected();
    await this._refreshGameColumn();
    if (!quiet || n) this._shotFeedback(n ? `${n} new game${n === 1 ? "" : "s"} added` : "No new games found");
    if (quiet) this._scrapeWaiting();
  }
  _gsrcDelete(folder) {
    const g = (this._detected || []).find((x) => x.folder === folder);
    if (!g) return;
    this.overlay = this.confirm;
    this.confirm.open(`The ${poss(gameName(g))} folder in the Games folder will be deleted. The game itself isn't touched.
Are you sure you want to continue?`,
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      async (c) => {
        this.confirm.close(); this.overlay = null;
        if (!c || c.id !== "yes") return;
        try { await call("game_sources_delete", { folder: g.folder }); this.audio.play("back", 0.5); }
        catch (e) { this.audio.play("error", 0.4); }
        await this._loadDetected();
        await this._refreshGameColumn();
        this._rebuildLevel(this._detectedGameItems);
      },
      () => { this.confirm.close(); this.overlay = null; });
  }

  // ---- Cache Management submenu ---------------------------------------------
  _cacheManagementItems() {
    const SI = { sys: "icon_setting_item.png" };
    return [
      { kind: "setting", ctl: "cacheapp", title: "Save Cache in System Directory", icon: SI,
        sub: "On: All cache gets saved on the system's directory so next time the system turns on everything loads right away." },
      { kind: "action", act: "cache_clear::thumbs", title: "Delete Photo Thumbnails", icon: SI },
      { kind: "action", act: "cache_clear::covers", title: "Delete Song Covers", icon: SI },
      { kind: "action", act: "cache_clear::videos", title: "Delete Preloaded Videos Data", icon: SI },
      { kind: "action", act: "cache_clear::decoded", title: "Delete Preloaded Songs Data", icon: SI },
      { kind: "action", act: "cache_clear::icons", title: "Delete Icon Shading", icon: SI },
      { kind: "action", act: "cache_clear::all", title: "Delete All Cache", icon: SI },
    ];
  }
  _clearCache(category) {
    const names = { all: "all cached data", decoded: "the preloaded songs data", covers: "the song covers", icons: "the icon shading", videos: "the preloaded videos data", thumbs: "the photo thumbnails" };
    this.overlay = this.confirm;
    this.confirm.open(
      `Delete ${names[category] || "this cache"}?`,
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      (choice) => {
        this.confirm.close(); this.overlay = null;
        if (choice && choice.id === "yes") this._runLocked(`cache_clear::${category}`, "Deleting...", async (title) => {
          // (the song covers are read again from the songs straight after)
          if (category === "covers" || category === "all") setTimeout(() => { if (this._preloadState === "loading") title("Reading song covers..."); }, 0);
          await call("clear_cache", { category }).catch(() => {});
          await this._afterCacheCleared(category);
        });
      },
      () => { this.confirm.close(); this.overlay = null; });
  }
  // Everything that used what was deleted works again at once (no restart):
  // the song lists get their newly read covers, a background / overlay video
  // that played from a converted copy is converted again, the songs decoded
  // for playing are decoded again when needed, the icons shaded again
  async _afterCacheCleared(category) {
    const all = category === "all";
    // (nothing is converted / decoded again by itself: only when you ask for
    // it, with Preload All Videos / Songs or by choosing that background again)
    if (all || category === "videos") { this._vplay = new Map(); this._noAutoConvert = true; this._applyWallpaper(); }
    if (all || category === "decoded") { this._decoded = {}; this._applyBgMusic(true); }
    if (all || category === "covers" || category === "thumbs") { try { await this._refreshMediaColumns(undefined, true); } catch (e) {} }
    if (all || category === "icons") { this._xsPreDone = null; this._applyXmbwShading(); }
  }
  // ---- Friend Personalization submenu ---------------------------------------
  _friendPersonalizationItems() {
    const SI = { sys: "icon_setting_item.png" }, FI = { sys: "icon_friend.png" };
    const cfg = this._friendCfg();
    const items = [
      { kind: "setting", ctl: "friendmode", title: "Friend Count", icon: FI,
        sub: "Randomized: a random number of friends. Fixed: a set number. Range: a random number between a minimum and maximum you choose." },
    ];
    if (cfg.mode === "fixed") {
      items.push({ kind: "setting", ctl: "friendcount", title: "Number of Friends", icon: SI,
        sub: "How many friends appear on the Friends screen." });
    } else if (cfg.mode === "range") {
      items.push({ kind: "setting", ctl: "friendmin", title: "Minimum Friends", icon: SI,
        sub: "The lowest number of friends that can appear." });
      items.push({ kind: "setting", ctl: "friendmax", title: "Maximum Friends", icon: SI,
        sub: "The highest number of friends that can appear." });
    }
    items.push({ kind: "action", act: "friend_card_new", title: "Create Friend Card", icon: FI,
      sub: "Design a friend card: name, card color, status message and the game they're playing. Saved cards are used before randomized friends." });
    items.push({ kind: "drill", title: "Friend Card Collection", icon: FI,
      sub: `${cfg.cards.length} saved card${cfg.cards.length !== 1 ? "s" : ""}. View, edit or delete your friend cards.`,
      childrenFn: this._friendCardCollectionItems });
    return items;
  }
  _friendCardCollectionItems() {
    const cards = this._friendCfg().cards;
    if (!cards.length) return [{ kind: "empty", title: "No Friend Cards", sub: "Create one from Friend Personalization.", icon: { sys: "icon_friend.png" } }];
    return cards.map((c, i) => {
      const nm = (c.name && c.name !== "random") ? c.name : "(Random Name)";
      const gm = (c.game && c.game !== "random") ? `Playing ${c.game}` : ((c.message && c.message !== "random") ? c.message : "Randomized card");
      return { kind: "action", act: "friend_card_edit::" + i, title: nm, sub: gm, icon: { sys: "icon_friend.png" } };
    });
  }
  _friendPersistCfg(mut) {
    const c = this._friendCfg();
    mut(c);
    (this.user.friendConfig = c);
    this._friendCountCache = null;      // recompute the range count next time
    this._fakeFriendsKey = null;        // force friends to regenerate
    this._friendMenuDirty = true;       // Friends column refreshes on menu exit
    this._persistUser();
    // (and right away too, a moment after the change: the player card's trophy
    // level and the friends show as they are now, however the menu is left)
    clearTimeout(this._friendRefreshT);
    this._friendRefreshT = setTimeout(() => this._refreshFriendsColumn(), 250);
  }
  // Create/edit a friend card. A multi-step flow builds the card object. Every
  // option offers a "Random" choice (resolved when friends are generated); the
  // text fields randomize when left blank.
  _friendCardEditor(idx) {
    const RAND = "random";
    const existing = idx != null ? this._friendCfg().cards[idx] : null;
    const card = {
      name: existing?.name || "", message: existing?.message || "", game: existing?.game || "",
      color: existing?.color || CARD_DEFAULT, avatar: existing?.avatar || PSN_AVATARS[0] || PSN_DEFAULT_AVATAR,
      indicator: existing?.indicator || "sign_in",
      showGame: existing?.showGame == null ? true : existing.showGame,
      hasPlus: existing?.hasPlus == null ? false : existing.hasPlus,
      hasMbox: existing?.hasMbox == null ? false : existing.hasMbox,
      mboxNum: existing?.mboxNum != null ? existing.mboxNum : RAND,
      level: (existing?.level != null ? existing.level : (existing?.trophyLevel != null ? existing.trophyLevel : RAND)),
      signOutTime: existing?.signOutTime || RAND,
    };
    const cancel = () => { this.overlay = null; this._rebuildAndStay(); };
    const save = () => {
      this._friendPersistCfg((c) => {
        c.cards = Array.isArray(c.cards) ? c.cards.slice() : [];
        if (idx != null) c.cards[idx] = card; else c.cards.push(card);
      });
      cancel();
    };
    // On/Off/Random picker → true | false | "random"
    const onOffRandom = (title, cur, next) => {
      this.overlay = this.listPicker;
      this.listPicker.open({ title, items: [{ label: "Off", id: "off" }, { label: "On", id: "on" }, { label: "Random", id: RAND }], submit: "Next" }, (ch) => {
        this.listPicker.close(); const id = ch && ch.id; next(id === "on" ? true : id === RAND ? RAND : false);
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = cur === RAND ? 2 : cur ? 1 : 0; this.listPicker._upd();
    };
    // final step: trophy level (1-30 or Random)
    const stepLevel = () => {
      this._askTrophyLevel(`${cardName()}: Trophy Level`, card.level == null ? RAND : card.level, "Save Card",
        (lv) => { card.level = lv === "random" ? RAND : lv; save(); }, () => cancel());
    };
    // signed-out last-sign-in time (only for Signed Out or Random indicator)
    const stepSignOut = () => {
      if (card.indicator !== "sign_out" && card.indicator !== RAND) { stepLevel(); return; }
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Last Sign-In Time`, items: SIGNOUT_TIME_OPTIONS, submit: "Next" }, (ch) => {
        this.listPicker.close(); card.signOutTime = (ch && ch.id) || RAND; stepLevel();
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = Math.max(0, SIGNOUT_TIME_OPTIONS.findIndex((o) => o.id === card.signOutTime)); this.listPicker._upd();
    };
    // message-icon number (only when the message icon can be on)
    const stepMboxNum = () => {
      const canMbox = card.indicator !== "none" && card.indicator !== "sent_request";
      if (!canMbox || card.hasMbox === false) { stepSignOut(); return; }
      this._askNumberOrRandom(`${cardName()}: Message Number`, card.mboxNum == null ? RAND : card.mboxNum, "Next",
        (n) => { card.mboxNum = n === "random" ? RAND : n; stepSignOut(); }, () => cancel(),
        { min: 0, what: "Number", randomSub: "A random number, like the other random cards." });
    };
    // message badge (skipped for Received/Sent Friend Request)
    const stepMbox = () => {
      if (card.indicator === "none" || card.indicator === "sent_request") { stepSignOut(); return; }
      onOffRandom(`${cardName()}: Message Icon`, card.hasMbox, (v) => { card.hasMbox = v; stepMboxNum(); });
    };
    // PS Plus badge (not available on Received Friend Request)
    const stepPlus = () => {
      if (card.indicator === "none") { stepMbox(); return; }
      onOffRandom(`${cardName()}: PlayStation Plus`, card.hasPlus, (v) => { card.hasPlus = v; stepMbox(); });
    };
    // whether the currently-playing game is visible (Online or Random only)
    const stepShowGame = () => {
      if (card.indicator !== "sign_in" && card.indicator !== RAND) { stepPlus(); return; }
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Show Playing Game`,
        items: [{ label: "No", id: "no" }, { label: "Yes", id: "yes" }, { label: "Random", id: RAND }], submit: "Next" }, (ch) => {
        this.listPicker.close(); const id = ch && ch.id; card.showGame = id === "yes" ? true : id === RAND ? RAND : false; stepPlus();
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = card.showGame === RAND ? 2 : card.showGame ? 1 : 0; this.listPicker._upd();
    };
    // status indicator next to the name
    const stepIndicator = () => {
      const inds = [
        { label: "Online", id: "sign_in" }, { label: "Away", id: "afk" },
        { label: "Received Friend Request", id: "none" }, { label: "Signed Out", id: "sign_out" },
        { label: "Sent Friend Request", id: "sent_request" }, { label: "Random", id: RAND }];
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Indicator`, items: inds, submit: "Next" }, (ch) => {
        this.listPicker.close(); card.indicator = (ch && ch.id) || "sign_in"; stepShowGame();
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = Math.max(0, inds.findIndex((o) => o.id === card.indicator)); this.listPicker._upd();
    };
    // avatar: choose one, or Random
    const stepAvatar = () => {
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Avatar`,
        items: [{ label: "Choose an Avatar", id: "choose" }, { label: "Random", id: RAND }], submit: "Next" }, (ch) => {
        this.listPicker.close();
        if (ch && ch.id === RAND) { card.avatar = RAND; stepIndicator(); return; }
        this.overlay = this.avatarPicker;
        this.avatarPicker.open(card.avatar === RAND ? (PSN_AVATARS[0] || PSN_DEFAULT_AVATAR) : card.avatar, { set: "psn" }, (ref) => {
          this.avatarPicker.close(); card.avatar = ref || card.avatar; stepIndicator();
        }, () => { this.avatarPicker.close(); cancel(); });
      }, () => { this.listPicker.close(); cancel(); });
      this.listPicker.i = card.avatar === RAND ? 1 : 0; this.listPicker._upd();
    };
    // card colour (no Auto; Random available)
    const stepColor = () => {
      const colorItems = [{ label: "Random", id: RAND }, ...CARD_COLORS.map((c) => ({ label: c.name, id: c.hex })),
        { label: "Custom Color", id: "custom" }];
      this.overlay = this.listPicker;
      this.listPicker.open({ title: `${cardName()}: Card Color`, items: colorItems, submit: "Next" }, (ch) => {
        this.listPicker.close();
        if (ch && ch.id === "custom") {
          this.overlay = this.colorPicker;
          this.colorPicker.open({ title: `${cardName()}: Custom Color`, value: parseColor(card.color) ? card.color : CARD_DEFAULT },
            (hex) => { card.color = hex; stepAvatar(); }, () => stepColor());
          return;
        }
        card.color = (ch && ch.id) || CARD_DEFAULT; stepAvatar();
      }, () => { this.listPicker.close(); cancel(); });
      let ci = colorItems.findIndex((c) => c.id === card.color);
      if (ci < 0 && parseColor(card.color)) ci = colorItems.length - 1;
      this.listPicker.i = Math.max(0, ci); this.listPicker._upd();
    };
    const cardName = () => card.name || "New Friend";
    // step 1: text fields (blank name/message/game = randomized)
    this.overlay = this.textForm;
    this.textForm.open({
      title: existing ? "Edit Friend Card" : "Create Friend Card",
      fields: [
        { key: "name", label: "PSN Name (blank for random)", value: card.name, max: NAME_LIMIT },
        { key: "message", label: "Status Message (blank for random)", value: card.message, max: MSG_LIMIT },
        { key: "game", label: "Playing Now (blank for random)", value: card.game },
      ], submit: "Next",
    }, (out) => {
      this.textForm.close();
      card.name = (out.name || "").trim(); card.message = (out.message || "").trim(); card.game = (out.game || "").trim();
      stepColor();
    }, () => { this.textForm.close(); this.overlay = null; });
  }
  // Set the trophy level shown on the player's own card (1-30).
  // A trophy level: type any number (1 or more), or Random (1-30, as before)
  _askTrophyLevel(title, cur, submit, done, cancel) {
    this._askNumberOrRandom(title, cur, submit, done, cancel, { min: 1, what: "Level", randomSub: "A random level from 1 to 30." });
  }
  // type a number (min or more), or Random (with its usual limits)
  _askNumberOrRandom(title, cur, submit, done, cancel, { min = 0, what = "Number", randomSub = "" } = {}) {
    const again = () => this._askNumberOrRandom(title, cur, submit, done, cancel, { min, what, randomSub });
    this.overlay = this.listPicker;
    this.listPicker.open({ title, submit: "Next", items: [
      { label: "Random", id: "random", sub: randomSub },
      { label: `Custom ${what}\u2026`, id: "type", sub: cur != null && cur !== "random" ? `Now: ${what === "Level" ? "Level " : ""}${cur}` : "" }] }, (ch) => {
      this.listPicker.close();
      if (ch.id === "random") { done("random"); return; }
      this.overlay = this.textForm;
      this.textForm.open({ title, fields: [{ key: "n", label: what, value: cur != null && cur !== "random" ? String(cur) : "", type: "number", required: true }], submit },
        (out) => {
          this.textForm.close();
          const n = parseInt(String(out.n || "").replace(/[^0-9]/g, ""), 10);
          if (!Number.isFinite(n) || n < min) { this.audio.play("error", 0.4); again(); return; }
          done(n);
        }, () => { this.textForm.close(); again(); });
    }, () => { this.listPicker.close(); cancel(); });
    this.listPicker.i = cur === "random" ? 0 : 1; this.listPicker._upd();
  }
  _editPlayerLevel() {
    const cur = this._friendCfg().playerLevel ?? this._userLevel ?? 1;
    this._askTrophyLevel("Trophy Level", cur, "Set Level", (lv) => {
      this.overlay = null;
      this._userLevel = lv === "random" ? 1 + Math.floor(Math.random() * 30) : lv;
      this._friendPersistCfg((c) => { c.playerLevel = lv; });
      this.audio.play("enter", 0.4);
      this._rebuildAndStay();
    }, () => { this.overlay = null; this._rebuildAndStay(); });
  }
  // Options for an existing card: Edit or Delete.
  _friendCardMenu(idx) {
    this.overlay = this.sideMenu;
    this.sideMenu.open([{ label: "Edit Card", id: "edit" }, { label: "Delete Card", id: "delete" }],
      { title: "Friend Card" }, (choice) => {
        this.sideMenu.close(); this.overlay = null;
        if (!choice) return;
        if (choice.id === "edit") this._friendCardEditor(idx);
        else if (choice.id === "delete") {
          this._friendPersistCfg((c) => { c.cards = c.cards.slice(); c.cards.splice(idx, 1); });
          this._rebuildAndStay();
        }
      }, () => { this.sideMenu.close(); this.overlay = null; });
  }

  _psnItems() {
    const signedIn = !!(this.user && this.user.psnAccountId);
    // The auth entry that leads the column. Its identity depends on state, but
    // its position (top) and the four content items below it never change.
    let authItem;
    if (signedIn) {
      // Sign Out lives on this item's options (triangle) menu, not as a child.
      authItem = { kind: "drill", title: "Account Management", sub: "Adjust settings for your account or for purchases made at PlayStation\u00aeStore.", icon: { sys: "icon_accountmanage.png" }, psnAuth: true, children: [
          { kind: "action", act: "psn_editid", title: "Edit Online ID", icon: { sys: "icon_accountmanage.png" } },
          { kind: "action", act: "psn_avatar", title: "Change Avatar", icon: { sys: "icon_accountmanage.png" } },
          { kind: "action", act: "player_level", title: "Trophy Level", icon: { sys: "icon_accountmanage.png" },
            sub: "Set the trophy level shown on your own card." },
          { kind: "drill", title: "Friend Personalization", icon: { sys: "icon_friend.png" },
            sub: "Choose how many friends appear and design your own friend cards.",
            childrenFn: this._friendPersonalizationItems },
        ] };
    } else {
      // Sign In once THIS user has signed in to (or made) a PSN account
      // before; a user that never has, Sign Up (whatever accounts other users
      // have: its Sign-Up screen can still go to "Sign In with an Existing
      // Account"). They never appear together.
      const u = this.user || {};
      const linked = !!(u.psnLinkedId || (u.psnSaved && u.psnSaved.email)) && (this.psnAccounts?.accounts || []).length > 0;
      authItem = linked
        ? { kind: "action", act: "psn_signin", title: "Sign In", icon: { sys: "signin.png" }, sub: "" }
        : { kind: "action", act: "psn_signup", title: "Sign Up", icon: { sys: "signup.png" }, bg: "cinfo-bg-signup.jpg",
            sub: "PSN is all about entertainment and interaction.\nEnjoy FREE* online gaming, download amazing new games, game expansion packs for a host of top titles, watch trailers and get your hands on exclusive content, chat with friends, and compare Trophies.\n\nSign up today \u2013 it's easy and it's FREE!\n\n* Broadband Internet connection required." };
    }
    // Fixed vertical order below the auth item: What's New, Trophy Collection,
    // PlayStation\u00aePlus, PlayStation\u00aeStore (PlayStation\u00aeHome removed).
    return [
      authItem,
      { kind: "ph", title: "What's New", icon: { sys: "whatsnew.png" }, bg: "cinfo-bg-whatsnew.jpg",
        sub: "Welcome to PlayStation\u00ae3.\nThe \"What's New\" screen is where to find all the latest PlayStation\u00ae news, updates, plus easy access to the games you've most recently played.\nTo access the \"What's New\" screen, connect to PSN* \u2013 it's free to join and it's your gateway to a world of entertainment, so sign up today!\n\n* Broadband Internet connection required." },
      // Trophy Collection: description only when signed in to PSN.
      { kind: "ph", title: "Trophy Collection", icon: { sys: "icon_trophy.png" },
        sub: signedIn ? "Online Mode\nView trophy information saved on the server." : "" },
      // ✕ turns your PlayStation Plus mark (card + top-right box) on and off
      { kind: "action", act: "psplus_toggle", title: "PlayStation\u00aePlus", icon: { sys: "ps_plus.png" } },
      // PlayStation\u00aeHome: its backdrop and description (Original / Modern
      // Version, see _homeLook); starts the "PlayStation Home" game when one is installed
      this._homeGame
        ? { kind: "action", act: "launch_home", title: "PlayStation\u00aeHome", homeItem: true, panel: "home", sub: HOME_DESC, ...this._homeLook() }
        : { kind: "ph", title: "PlayStation\u00aeHome", homeItem: true, panel: "home", sub: HOME_DESC, ...this._homeLook() },
      this._storeItem("cinfo-bg-storemain.jpg"),
    ];
  }
  // The PlayStation\u00aeStore subsection, reused in the PSN, Game and Video columns.
  // `bg` picks the matching cinfo backdrop (storemain / storegame / storevideo).
  // "Search for Media Servers" \u2014 first item in Music / Photo / Video.
  _mediaServersItem() { return { kind: "ph", title: "Search for Media Servers", sub: "", icon: { sys: "icon_mediaserver_search.png" } }; }
  _storeItem(bg) {
    return { kind: "ph", title: "PlayStation\u00aeStore", icon: { sys: "store.png" }, bg,
      sub: "FREE* to access, PlayStation\u00aeStore is the only place to download new and exclusive PS3\u2122 games, FREE playable demos, add-on packs, and high-definition videos.\n\nGet more for your PS3\u2122 and visit PlayStation\u00aeStore today.\n\n* Broadband Internet connection required." };
  }


  // Build one media item (song/photo/video) with the right thumbnail:
  //  - photo → the image itself
  //  - music → the track's embedded album cover, else the Music Default icon
  //  - video → the default video icon
  _mediaItemObj(kind, m) {
    let icon;
    if (kind === "photo" && isDocPath(m.path)) icon = { art: sysUrl("icon_photo_default.png") };
    // (lists show a small copy of the picture; `full` is the picture itself:
    // songs shown inside an opened folder use it, see _makeItemEl)
    else if (kind === "photo") icon = { art: thumbUrl(m.path), full: assetUrl(m.path) };
    else if (kind === "music") icon = m.cover ? { art: thumbUrl(m.cover), full: assetUrl(m.cover) } : { sys: "icon_music_default.png" };
    else if (kind === "video" && (m.cover || m.clip)) icon = { art: m.cover ? assetUrl(m.cover) : "", clip: m.clip ? assetUrl(m.clip) : null };
    else icon = { sys: this.manifest.defaults?.[kind] || "icon_default_h.png" };
    // pictures / videos: the title from the file's tags, else its name, never with the extension
    const o = { kind, title: kind === "music" ? (m.title || m.name) : noExt(m.title || m.name), sub: this._mediaSub(kind, m), icon, media: m };
    // a PDF / comic: its first page becomes the icon once it's made
    if (kind === "photo" && isDocPath(m.path)) {
      o.sub = (m.ext || "").toUpperCase();
      docThumb(assetUrl(m.path), m.path).then((u) => {
        o.icon = { ...o.icon, art: u };
        const img = o._el && o._el.querySelector("img"); if (img) img.src = u;
      }).catch(() => {});
    }
    if (kind === "video") {
      // as on the console: the title without the extension, then
      // "28/9/2012  8:55 AM   2'12''" (date, time, length) on every row
      o.title = noExt(m.title || m.name);
      o.sub = this._videoSub(m);
    }
    if (kind === "music") {
      o.pre = [m.artist, m.album].filter(Boolean).join(" / ");
      o.sub = m.durationSecs ? fmtDurClock(m.durationSecs) : (m.ext || "").toUpperCase();
    }
    return o;
  }

  _videoSub(m) {
    const parts = [];
    if (m.modified) parts.push(this._fmtDateTime(new Date(m.modified * 1000)));
    if (m.durationSecs != null) {
      const t = Math.round(m.durationSecs), hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = String(t % 60).padStart(2, "0");
      parts.push(hh ? `${hh}'${String(mm).padStart(2, "0")}'${ss}''` : `${mm}'${ss}''`);
    }
    return parts.join("\u2002\u2002");
  }
  // Immediate parent folder name of a file path (used as the "album" for photos
  // / videos, which now come from nested content subfolders too).
  _parentFolder(path) {
    const parts = String(path || "").split(/[\\/]/).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : "Unknown";
  }

  // Group name for a media item under a given section + sort mode.
  _groupName(kind, modeId, m) {
    switch (modeId) {
      case "album": return (kind === "music" ? m.album : m.inRoot ? null : (m.folder || this._parentFolder(m.path))) || "Unknown";
      case "artist": return m.artist || "Unknown";
      case "genre": return m.genre || "Unknown";
      case "year": return (kind === "music" ? m.year : null)
        || (m.modified ? new Date(m.modified * 1000).getFullYear().toString() : "Unknown");
      case "title": {      // folders "0", "4", "A", "M"… by the first character
        const t = String(m.title || m.name || "").trim();
        const ch = t ? [...t][0].toLocaleUpperCase() : "#";
        return ch;
      }
      case "month": return m.modified
        ? new Date(m.modified * 1000).toLocaleString("en-US", { month: "long", year: "numeric" }) : "Unknown";
      default: return "Unknown";
    }
  }

  // Turn a flat list of media entries into either a flat list ("All"/flat modes)
  // or a set of folder drills, per the section's current sort mode.
  _groupMedia(kind, entries) {
    const modes = MEDIA_MODES[kind];
    const cfg = modes.find((x) => x.id === this._mediaMode(kind)) || modes[0];
    const byTitle = (a, b) => cmpNatural(String(a.title || ""), String(b.title || ""));
    if (cfg.id === "all") return [...entries].sort(byTitle);   // "All" = alphabetical
    if (cfg.flat) return [...entries].sort((a, b) =>
      cmpText(String(a.title || ""), String(b.title || "")));
    const loose = [];
    const groups = new Map();
    for (const e of entries) {
      const k = this._groupName(kind, cfg.id, e.media);
      if (k == null) { loose.push(e); continue; }
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const unit = kind === "music" ? "Track" : (kind === "photo" ? "Image" : "Title");
    const drills = [...groups.entries()].map(([name, items]) => {
      let children = items;
      if (cfg.id === "title") children = [...items].sort(byTitle);
      else if (kind === "music" && cfg.id === "artist") children = discographyOrder(items);
      else if (kind === "music" && cfg.id === "genre") {
        // artists A-Z, each artist's albums oldest → newest, songs in track order
        const byArtist = new Map();
        for (const e of items) { const a = (e.media.artist || "").trim() || "Unknown"; if (!byArtist.has(a)) byArtist.set(a, []); byArtist.get(a).push(e); }
        children = [...byArtist.keys()].sort((a, b) => cmpBase(a, b))
          .flatMap((a) => discographyOrder(byArtist.get(a)));
      } else if (kind === "music") children = [...items].sort((a, b) =>
        (a.media.disc || 0) - (b.media.disc || 0) ||
        (a.media.track || 0) - (b.media.track || 0) ||
        cmpText(String(a.title || ""), String(b.title || "")));
      const n = children.length;
      // folder shows a FOLDER graphic with the first item's thumbnail inside it
      const firstArt = children[0] && children[0].icon && children[0].icon.art;
      const folderIcon = { folder: kind, art: firstArt || null };
      let sub;
      if (kind === "music") {
        const total = children.reduce((s, c) => s + (c.media.durationSecs || 0), 0);
        sub = `${n} ${unit}${n !== 1 ? "s" : ""}${total ? "  " + fmtDurClock(total) : ""}`;
      } else {
        sub = `${n} ${unit}${n !== 1 ? "s" : ""}`;
      }
      return { kind: "drill", title: name, sub, icon: folderIcon, children };
    });
    drills.sort((a, b) => cmpNatural(a.title, b.title));
    return loose.length ? [...drills, ...loose.sort(byTitle)] : drills;
  }

  _formatName(c) { return FORMAT_NAMES[c] || c || "PS3"; }
  _mediaMode(kind) { return (this.mediaMode && this.mediaMode[kind]) || "all"; }

  // Section body (songs/photos/videos) for the current sort mode.
  async _mediaSectionItems(kind) {
    const media = await call("list_media", { kind });
    if (!media.length) return [];   // nothing found: nothing shown
    const entries = media.map((m) => this._mediaItemObj(kind, m));
    return this._groupMedia(kind, entries);
  }

  async _musicItems() {
    const media = await call("list_media", { kind: "music" });
    const entries = media.map((m) => this._mediaItemObj("music", m));
    const trackByPath = Object.fromEntries(entries.map((t) => [t.media.path, t]));
    const playlists = this.user?.playlists || [];
    const playlistChildren = [
      { kind: "action", act: "playlist_create", title: "Create Playlist", icon: { sys: "icon_playlist_add.png" } },
      ...playlists.map((p) => {
        const plTracks = p.tracks.map((path) => trackByPath[path]).filter(Boolean);
        // same rule as media folders: show the first track's cover on the music
        // folder, else the Default music folder when none has cover art.
        const firstArt = (plTracks.find((t) => t.icon && t.icon.art) || {}).icon?.art || null;
        // edit actions first, then the tracks
        const edit = [
          { kind: "action", act: "playlist_add::" + p.name, title: "Add Songs", icon: { sys: "icon_playlist_add.png" } },
          { kind: "action", act: "playlist_remove::" + p.name, title: "Remove Songs", icon: { sys: "icon_playlist.png" } },
        ];
        return { kind: "drill", title: p.name, sub: `${p.tracks.length} track${p.tracks.length !== 1 ? "s" : ""}`,
          icon: { folder: "music", art: firstArt },
          children: [...edit, ...plTracks] };
      }),
    ];
    const body = entries.length ? this._groupMedia("music", entries) : [];
    return [
      this._mediaServersItem(),
      { kind: "drill", title: "Playlists", icon: { sys: "icon_playlist.png" }, children: playlistChildren },
      ...body,
    ];
  }

  // Image playlists: mirror the music playlists: a "Create Playlist" action
  // plus each saved playlist as a drill of its photos, led by "Play Slideshow".
  async _photoPlaylistItems() {
    const media = await call("list_media", { kind: "photo" });
    const byPath = Object.fromEntries(media.map((m) => [m.path, m]));
    const playlists = this.user?.photoPlaylists || [];
    return [
      { kind: "action", act: "photo_playlist_create", title: "Create Playlist", icon: { sys: "icon_playlist_add.png" } },
      ...playlists.map((p) => {
        const photos = (p.photos || []).map((path) => byPath[path]).filter(Boolean);
        const firstArt = photos.length ? thumbUrl(photos[0].path) : null;
        const children = photos.length
          ? [{ kind: "action", act: "photo_slideshow", playlist: p.name, title: "Play Slideshow", icon: { sys: "icon_playlist.png" } },
             ...photos.map((m) => ({ kind: "photo", title: noExt(m.title || m.name), sub: this._mediaSub("photo", m), icon: { art: thumbUrl(m.path), full: assetUrl(m.path) }, media: m }))]
          : [{ kind: "empty", title: "No photos", icon: { sys: "photo_gallery.png" } }];
        return { kind: "drill", title: p.name, sub: `${photos.length} photo${photos.length !== 1 ? "s" : ""}`, icon: { folder: "photo", art: firstArt }, children };
      }),
    ];
  }

  _mediaSub(kind, m) {
    if (kind === "music") {
      const parts = [m.artist, m.album].filter(Boolean).join(" \u2014 ");
      const dur = m.durationSecs ? fmtTime(m.durationSecs) : "";
      return [parts, dur].filter(Boolean).join("  \u00b7  ") || m.ext.toUpperCase();
    }
    if (kind === "photo") return m.width ? `${m.width} \u00d7 ${m.height}` : m.ext.toUpperCase();
    return [m.ext.toUpperCase(), fmtSize(m.size)].filter(Boolean).join("  \u00b7  ");
  }

  // right click on an item: choose it first (its △ menu opens next)
  selectAt(target) {
    const el = target && target.closest && target.closest("#xmb .item");
    if (!el || !el._xmbPick) return false;
    el._xmbPick(); return true;
  }
  // ------------------------------------------------------------- rendering
  _level() { return this.levels[this.levels.length - 1]; }

  _render() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    this.root.innerHTML = `
      <div class="bg-layer"></div>
      <div class="media-topbar"></div>
      <div class="media-sort"></div>
      <div class="crumb"></div>
      <div class="cat-row"></div>
      <div class="item-col"></div>
      <div class="item-detail"></div>`;
    this.$bg = this.root.querySelector(".bg-layer");
    this.$mediaSort = this.root.querySelector(".media-sort");
    this.$mediaTopbar = this.root.querySelector(".media-topbar");
    this.$cats = this.root.querySelector(".cat-row");
    this.$items = this.root.querySelector(".item-col");
    this.$detail = this.root.querySelector(".item-detail");
    this.$crumb = this.root.querySelector(".crumb");

    const drilled = this.levels.length > 1;
    this.columns.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "cat";
      el.innerHTML = `${iconHTML(c.icon)}<div class="cat-label">${esc(c.catLabel || c.label)}</div>`;
      el.addEventListener("click", () => { if (this.locked && i !== 0) return; this._gotoCat(i); });
      this.$cats.appendChild(el); c._el = el;
    });
    this._layoutCats(w, h);

    // No more icon-copy over the category: the drilled-in subsection is shown
    // by an anchor icon on the left (with a back arrow) built in _renderItems.
    this.$crumb.classList.remove("show");
    this._updateMediaSort();
    this._renderItems(w, h);
    this._applyXmbwShading();
  }

  // XMBW icon style: replace each tintable icon's flat CSS fill with the
  // shaded glossy-glass image (iconshade.js), cached per icon + colour.
  // "Auto" icons are glossy white glass: the theme colour comes through their
  // translucency, like on the PS3. An icon is kept invisible until its glass
  // image is ready (no flash of the plain fill), and every icon is shaded
  // ahead of time in the background so new submenus appear finished.
  _iconRgb() {
    const hex = (this.user?.theme?.iconColor) || "#ffffff";
    // "Original" with Icon Style Default: paler and brighter on a bright
    // background (the brightness is a lift, not a multiply, so the shading stays)
    if (hex !== "auto") return hexToRgb01(hex);
    return this._iconStyle() === "default" ? [...ICON_AUTO_DEFAULT, ICON_AUTO_GAIN] : ICON_AUTO_RGB.slice();
  }
  // saved icon shading from the last run (temp folder, or the system directory
  // with "Save Cache in System Directory"), loaded once at start
  async _xsLoadSaved() {
    if (this._xsLoaded) return; this._xsLoaded = true;
    try { importShades(JSON.parse(await call("icon_shades_load") || "{}")); } catch (e) {}
    // any icon added to the menu later (submenus, refreshed lists) gets its
    // shading too, whichever code path drew it (only when an icon was added)
    if (this.root && !this._xsObs) {
      const hasIcon = (n) => n.nodeType === 1 && (n.classList.contains("sysicon") || !!n.querySelector?.(".sysicon"));
      this._xsObs = new MutationObserver((recs) => {
        if (this._xsRaf || document.body.classList.contains("in-game")) return;
        if (!recs.some((r) => [...r.addedNodes].some(hasIcon))) return;
        this._xsRaf = requestAnimationFrame(() => { this._xsRaf = 0; this._applyXmbwShading(); });
      });
      this._xsObs.observe(this.root, { childList: true, subtree: true });
    }
  }
  // save the shading a few seconds after new images were made (the colours in
  // use most recently are kept: up to 3)
  _xsScheduleSave(rk) {
    const used = this._xsColors || (this._xsColors = []);
    const i = used.indexOf(rk);
    if (i >= 0) used.splice(i, 1);
    used.unshift(rk);
    used.length = Math.min(used.length, 3);
    clearTimeout(this._xsSaveT);
    this._xsSaveT = setTimeout(() => {
      // (memory keeps the same colours as the saved file: the 3 used last, the current one among them)
      pruneShades([...this._xsColors, colorKey(this._iconRgb()), colorKey([1, 1, 1])]);   // (a theme's own-coloured icons use white)
      if (!takeNewShadeCount()) return;
      call("icon_shades_save", { data: JSON.stringify(exportShades(this._xsColors)) }).catch(() => {});
    }, 3000);
  }
  _applyXmbwShading() {
    const on = document.documentElement.getAttribute("data-icons") === "xmbw";
    if (!this.root) return;
    this._shadeCustomIcons(on);
    if (!on) {
      // Flat (pure CSS): icons shaded before get their own shape back
      for (const el of this.root.querySelectorAll(".sysicon[data-sys][data-xs]")) {
        const u = `url('${el.dataset.tsrc || sysBase(el.getAttribute("data-sys"))}')`;
        el.style.background = ""; el.style.webkitMaskImage = u; el.style.maskImage = u;
        delete el.dataset.xs; el.classList.remove("xs-ready", "xs-late");
      }
      return;
    }
    const st = this._iconStyle();
    const rgbAll = this._iconRgb();
    const queue = this._xsQueue || (this._xsQueue = new Map());
    const previewing = this.overlay === this.colorPicker;
    this.root.querySelectorAll(".sysicon[data-sys]:not(.coloricon)").forEach((el) => {
      const job = this._xsJob(el, st, rgbAll); if (!job) return;
      const { own, src, name, rgb, ck } = job, rk = colorKey(rgb);
      if (el.dataset.xs === ck) return;
      const hit = cachedShade(name, rgb, st);
      if (hit) { this._xsSet(el, hit, ck); queue.delete(el); return; }
      // picture already loaded: shade it right now (~10 ms), so a new menu
      // appears finished; while a colour is being previewed, spread the work out
      const img = !previewing && loadedIcon(src);
      if (img) { this._xsSet(el, shadeIcon(img, rgb, name, st, own), ck); queue.delete(el); this._xsScheduleSave(rk); return; }
      queue.set(el, { name, src, own, rgb, ck, st });
      // still not shaded after a moment: show the plain icon meanwhile (never a blank space)
      setTimeout(() => { if (!el.classList.contains("xs-ready")) el.classList.add("xs-late"); }, 120);
    });
    this._xsPump();
    this._xsPrewarmSoon();
  }
  // custom section pictures with their Icon Style effect: shaded exactly like
  // the system's icons (in the Icon Color, or in their own colours), kept in
  // their own shape; Flat style: the plain picture (or its shape in the Icon
  // Color, by the CSS)
  _shadeCustomIcons(on) {
    const st = this._iconStyle(), rgbAll = this._iconRgb();
    for (const el of this.root.querySelectorAll(".custwrap[data-tsrc]")) {
      const img = el.querySelector(".cust-img"); if (!img) continue;
      const src = el.dataset.tsrc, own = !!el.dataset.own;
      if (!on) {
        if (img.getAttribute("src") !== src) img.src = src;
        el.classList.remove("cs-ready"); delete el.dataset.xs; continue;
      }
      const rgb = own ? [1, 1, 1] : rgbAll;
      const name = `c:${el.dataset.tkey || src}${own ? "|own" : ""}`;
      const ck = st + "|" + name + "|" + colorKey(rgb);
      if (el.dataset.xs === ck) continue;
      const apply = (u) => { if (!el.isConnected) return; img.src = shadeSrc(u); el.dataset.xs = ck; el.classList.add("cs-ready"); };
      const hit = cachedShade(name, rgb, st);
      if (hit) { apply(hit); continue; }
      const ready = loadedIcon(src);
      if (ready) { apply(shadeIcon(ready, rgb, name, st, own, true)); this._xsScheduleSave(colorKey(rgb)); continue; }
      loadIconImage(src).then((im) => {
        if (!el.isConnected || el.dataset.xs === ck) return;
        apply(cachedShade(name, rgb, st) || shadeIcon(im, rgb, name, st, own, true)); this._xsScheduleSave(colorKey(rgb));
      }).catch(() => {});
    }
  }
  // what an icon element is shaded as: its picture, its cache name, its colour
  _xsJob(el, st, rgbAll) {
    const sys = el.getAttribute("data-sys"); if (!sys) return null;
    // a theme's picture: shaded from it (in its own colours with data-own)
    const own = !!el.dataset.own, src = el.dataset.tsrc || sysBase(sys);
    const name = el.dataset.tsrc ? `t:${el.dataset.tkey || src}${own ? "|own" : ""}` : sys;
    // (in its own colours, the Icon Color isn't used)
    const rgb = own ? [1, 1, 1] : rgbAll;
    return { own, src, name, rgb, st, ck: st + "|" + name + "|" + colorKey(rgb) };
  }
  // Every icon of every category shaded ahead of time, a little at a time
  // while nothing else is happening, so opening a category for the first
  // time (or after a colour / style / theme change) doesn't stall on it.
  // Runs a moment after the icons were last shaded on screen.
  _xsPrewarmSoon() {
    clearTimeout(this._xsPreT);
    this._xsPreT = setTimeout(() => this._xsPrewarm(), 1500);
  }
  async _xsPrewarm() {
    if (document.documentElement.getAttribute("data-icons") !== "xmbw" || !this.columns) return;
    const run = this._xsPreRun = (this._xsPreRun || 0) + 1;
    const names = new Set();
    const walk = (items, depth) => { for (const it of items || []) {
      if (it && it.icon && it.icon.sys) names.add(it.icon.sys);
      if (depth < 2 && Array.isArray(it.children)) walk(it.children, depth + 1);
    } };
    for (const c of this.columns) { if (c.icon) names.add(c.icon); walk(c.items, 0); }
    const st = this._iconStyle(), rgbAll = this._iconRgb(), seen = new Set();
    // (nothing changed since the last full pass: nothing to do)
    const sig = `${st}|${colorKey(rgbAll)}|${activeThemes().map((t) => t.key).join(",")}|${[...names].join(",")}`;
    if (sig === this._xsPreDone) return;
    const box = document.createElement("div");
    box.innerHTML = [...names].map((n) => iconHTML(n)).join("");
    const jobs = [...box.querySelectorAll(".sysicon[data-sys]:not(.coloricon)")].map((el) => this._xsJob(el, st, rgbAll))
      .filter((j) => j && !seen.has(j.ck) && seen.add(j.ck) && !cachedShade(j.name, j.rgb, j.st));
    if (!jobs.length) { this._xsPreDone = sig; return; }
    // the pictures first (loading is off the main thread), then the shading, a
    // few at a time in the gaps between frames, never while buttons are being
    // pressed (one at a time when the system is too busy to have gaps)
    const imgs = await Promise.all(jobs.map((j) => loadIconImage(j.src).catch(() => null)));
    if (run !== this._xsPreRun) return;
    const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 300 }) : setTimeout(() => r(null), 50)));
    let done = 0, i = 0;
    const calm = () => performance.now() - (this._inputAt || 0) > 1500 && !this.overlay;
    while (i < jobs.length) {
      const dl = await idle();
      if (run !== this._xsPreRun) return;            // the colours changed meanwhile: a newer pass takes over
      if (!calm()) { await new Promise((r) => setTimeout(r, 500)); continue; }
      for (let n = 0; i < jobs.length; n++) {
        if (n >= 1 && (!dl || dl.didTimeout || dl.timeRemaining() < 6)) break;
        const j = jobs[i], img = imgs[i]; i++;
        if (img && !cachedShade(j.name, j.rgb, j.st)) { shadeIcon(img, j.rgb, j.name, j.st, j.own); done++; }
      }
    }
    this._xsPreDone = sig;
    if (done) this._xsScheduleSave(colorKey(rgbAll));
  }
  _xsSet(el, url, ck) {
    el.style.webkitMaskImage = "none"; el.style.maskImage = "none";
    el.style.background = `url("${shadeSrc(url)}") center/contain no-repeat`;
    el.dataset.xs = ck; el.classList.add("xs-ready"); el.classList.remove("xs-late");
  }
  // shade the icons still waiting, a few per frame (keeps the UI smooth while a
  // colour is being previewed)
  _xsPump() {
    if (this._xsBusy || !this._xsQueue || !this._xsQueue.size) return;
    this._xsBusy = true;
    const step = async () => {
      const t0 = performance.now();
      // load the pictures still needed all at once, then shade
      const jobs = [...this._xsQueue].filter(([el]) => el.isConnected);
      await Promise.all(jobs.map(([, j]) => loadIconImage(j.src).catch(() => null)));
      for (const [el, job] of this._xsQueue) {
        this._xsQueue.delete(el);
        if (!el.isConnected) continue;
        const hit = cachedShade(job.name, job.rgb, job.st);
        const img = hit ? null : loadedIcon(job.src);
        if (hit || img) this._xsSet(el, hit || shadeIcon(img, job.rgb, job.name, job.st, job.own), job.ck);
        else el.classList.add("xs-ready");      // picture missing: show the plain icon
        if (performance.now() - t0 > 12) break;
      }
      if (this._xsQueue.size) requestAnimationFrame(step);
      else { this._xsBusy = false; this._xsScheduleSave(colorKey(this._iconRgb())); }
    };
    step();
  }
  // Top-left sort indicator: the section's small icon + the current mode name,
  // under a semi-transparent top bar. Shown only at the root of a media section.
  // The sort bar is shown ONLY when the user presses Square (flash === true).
  // On ordinary renders/navigation it stays hidden: it must not pop up just
  // because you backed out of a Music/Photo/Video submenu.
  _updateMediaSort(flash = false) {
    if (!this.$mediaSort) return;
    const col = this.columns[this.selCat];
    const id = col && col.id;
    const sc = this._secSortContext();                 // (a custom section's subsection)
    const atRoot = (this.levels.length === 1 && !!MEDIA_MODES[id]) || !!sc;
    clearTimeout(this._sortHideT);
    if (!flash || !atRoot) {
      // keep it hidden on every non-Square update
      this.$mediaSort.classList.remove("show"); this.$mediaTopbar.classList.remove("show");
      this.$mediaSort.classList.add("fade"); this.$mediaTopbar.classList.add("fade");
      this.$mediaSort.innerHTML = "";
      return;
    }
    const mode = sc ? (SECTION_MODES.find((m) => m.id === this._secMode(sc.sec)) || this._secModes(sc.sec)[0])
      : (MEDIA_MODES[id].find((m) => m.id === this._mediaMode(id)) || MEDIA_MODES[id][0]);
    this.$mediaSort.innerHTML = `${iconHTML(col.icon, "ms-icon")}<span class="ms-label">${esc(mode.label)}</span>`;
    // shown as it is for a moment, then it fades out
    this.$mediaSort.classList.add("show"); this.$mediaTopbar.classList.add("show");
    this.$mediaSort.classList.remove("fade"); this.$mediaTopbar.classList.remove("fade");
    this._sortHideT = setTimeout(() => {
      this.$mediaSort && this.$mediaSort.classList.add("fade");
      this.$mediaTopbar && this.$mediaTopbar.classList.add("fade");
    }, 1500);
  }

  _layoutCats(w, h) {
    spineNow = this.locked ? 0.5 : SPINE_X;
    const drilled = this.levels.length > 1;
    this.$cats.classList.toggle("dim", false);
    this.$cats.classList.toggle("drilled", this.levels.length > 1);
    const cy = h * CAT_SEL_Y;
    // When drilled into a sub-menu, only the current section icon stays: moved
    // to sit directly above the drilled anchor, at the anchor's dimmed opacity -
    // and every other category icon disappears (like the real XMB).
    if (drilled) {
      const active = this.levels.length - 1;
      const anchorX = w * drillX(0, active);                 // the root level's anchor column
      this.columns.forEach((c, i) => {
        const isCur = i === this.selCat;
        c._el.style.left = `${anchorX}px`;
        c._el.style.top = `${cy}px`;
        c._el.classList.toggle("sel", isCur);
        c._el.style.opacity = isCur ? "0.85" : "0";
        c._el.style.pointerEvents = isCur ? "auto" : "none";
      });
      return;
    }
    const cx = w * spineNow;
    this.columns.forEach((c, i) => {
      const d = i - this.selCat, ad = Math.abs(d);
      const off = ad === 0 ? 0 : Math.sign(d) * (CAT_GAP_SEL + (ad - 1) * CAT_GAP) * w;
      c._el.style.left = `${cx + off}px`;
      c._el.style.top = `${h * (d === 0 ? CAT_SEL_Y : CAT_Y)}px`;
      c._el.style.pointerEvents = "auto";
      c._el.classList.toggle("sel", d === 0);
      // captures: the others are only slightly dimmer (on a bright background
      // with Icon Style Default, barely at all, as on the console)
      const brightDef = document.documentElement.hasAttribute("data-bright-bg") && this._iconStyle() === "default";
      c._el.style.opacity = d === 0 ? "1" : (brightDef ? "0.95" : "0.78");
    });
  }

  // The active sub-menu is the camera focus (drawn at the normal spine). Each
  // ancestor is reduced to a single anchor icon sitting to the LEFT, with a
  // back arrow (◄) marking where the sub-menu opened from: like the real XMB.
  // the settings' current choices beside them
  _fillSetVals(lvl) {
    for (const o of lvl.items) {
      if (o.kind !== "setting" || !o._el) continue;
      const n = o._el.querySelector(".item-setval"); if (!n) continue;
      let v = ""; try { v = this._ctlValue(o.ctl); } catch (e) {}
      v = v == null ? "" : String(v);
      if (n.textContent !== v) n.textContent = v;
    }
  }
  // the current section's icon as a flat picture (for the loading icon in its
  // lists): the user's own media and avatars (Users, Photo, Music, Video, Game,
  // Friends and custom sections), not the system's own sections
  _secFlat() {
    const c = this.columns && this.columns[this.selCat];
    if (!c || ["settings", "tvvideo", "network", "psn"].includes(c.id) || !c.icon) return null;
    const n = c.icon;
    if (n.startsWith("url:")) return n.slice(4);
    if (n.startsWith("cust:")) return n.slice(n.indexOf(":", 5) + 1);
    return sysUrl(n);
  }
  _renderItems(w, h) {
    this.$items.innerHTML = "";
    { const f = this._secFlat(); this.$items.classList.toggle("has-flat", !!f); if (f) this.$items.style.setProperty("--sec-flat", `url('${f}')`); else this.$items.style.removeProperty("--sec-flat"); }
    const active = this.levels.length - 1;
    this.levels.forEach((lvl, li) => {
      const isActive = li === active;
      if (isActive) {
        // only the rows around the selection exist (see _ensureWindow): a
        // library of thousands of songs builds ~30 rows, and only their
        // covers load
        for (const it of lvl.items) it._el = null;
        this._ensureWindow(lvl);
      } else {
        // ancestor anchor: the item that was drilled into, with the back arrow
        const it = lvl.items[lvl.sel];
        const el = document.createElement("div");
        el.className = "item item-anchor";
        el.innerHTML = `${itemIcon(it)}<img class="drill-arrow" src="./assets/icons/system/arrow_left.png" alt="">`;
        this.$items.appendChild(el); lvl._anchorEl = el; watchArtRatio(el);
        // the parent's other rows stay barely visible (icons only)
        lvl._ghosts = [];
        if (li === active - 1) {
          lvl.items.forEach((o, j) => {
            if (j === lvl.sel || Math.abs(j - lvl.sel) > 10 || o.kind === "playercard" || o.kind === "friendcard") return;
            const g = document.createElement("div");
            g.className = "item item-ghost";
            g.innerHTML = itemIcon(o); watchArtRatio(g);
            this.$items.appendChild(g); lvl._ghosts.push({ j, el: g });
          });
        }
      }
    });
    this._layoutItems(w, h);
  }

  // The rows of the active column that exist in the page: the selection and the
  // rows near it (what can be on screen, plus a margin). Moving the cursor adds
  // the rows coming into view and drops the far ones, so a big library costs
  // the same as a small one and media pictures load as they come near.
  _windowRange(lvl) {
    const n = lvl.items.length, s = lvl.sel;
    if (lvl.grid) { const r = Math.floor(s / GRID_COLS); return [Math.max(0, (r - 5) * GRID_COLS), Math.min(n - 1, (r + 6) * GRID_COLS - 1)]; }
    return [Math.max(0, s - 9), Math.min(n - 1, s + 14)];
  }
  _ensureWindow(lvl) {
    if (!lvl || !this.$items) return;
    const [a, b] = this._windowRange(lvl);
    let made = false;
    lvl.items.forEach((it, j) => {
      const inside = j >= a && j <= b;
      // a little slack before dropping a row, so moving back and forth doesn't rebuild it
      const keep = j >= a - 4 && j <= b + 4;
      if (it._el && !keep) { it._el.remove(); it._el = null; }
      else if (!it._el && inside) { this._makeItemEl(lvl, it, j); made = true; }
    });
    if (lvl.inFolder && this._dynCovers(lvl)) this._coverSwap(lvl);
    // new rows' icons get their shading right away (no blank frame)
    if (made && !this._inWindowShade) { this._inWindowShade = true; try { this._applyXmbwShading(); } finally { this._inWindowShade = false; } }
  }
  // songs in an opened folder: more than 15 → covers loaded as needed
  _dynCovers(lvl) {
    if (lvl._dynN === undefined) lvl._dynN = lvl.items.reduce((n, it) => n + (it.kind === "music" && it.icon && it.icon.full ? 1 : 0), 0);
    return lvl._dynN > 15;
  }
  // the selected song's full cover (once the cursor stays on it a moment, so
  // scrolling through doesn't load every one); the others back to small copies
  _coverSwap(lvl) {
    clearTimeout(this._coverT);
    const set = (it, url) => { const img = it._el && it._el.querySelector(".art-img"); if (img && url && img.getAttribute("src") !== url) img.src = url; };
    // (songs a few rows away go back to their small copies; the ones next to
    // the selection keep what they have, so going back and forth costs nothing)
    lvl.items.forEach((it, j) => { if (Math.abs(j - lvl.sel) > 3 && it._el && it.kind === "music" && it.icon && it.icon.full) set(it, it.icon.art); });
    const cur = lvl.items[lvl.sel];
    if (!cur || cur.kind !== "music" || !cur.icon || !cur.icon.full) return;
    this._coverT = setTimeout(() => {
      if (this._level() !== lvl || lvl.items[lvl.sel] !== cur) return;
      // (loaded first, then swapped in: the small copy stays until then, never a blank)
      const pre = new Image(); pre.decoding = "async";
      pre.onload = () => { if (lvl.items[lvl.sel] === cur) set(cur, cur.icon.full); };
      pre.src = cur.icon.full;
    }, 140);
  }
  _makeItemEl(lvl, it, j) {
    const el = document.createElement("div");
    const cardCls = (it.kind === "playercard" || it.kind === "friendcard") ? "item-card" : "";
    el.className = `item fresh ${it.kind === "game" ? "item-game" : ""}${it.secItem ? " sec-game" : ""}${it.kind === "video" ? " item-video" : ""} ${cardCls} ${isUserContent(it) ? "uc" : ""}`;
    // Every non-card item carries its own title label INSIDE the item, so
    // the title travels with its icon. The selected item's label also
    // holds its description (filled in by _refreshDetail).
    const isCardKind = it.kind === "playercard" || it.kind === "friendcard";
    // inside an opened folder a song shows its cover at full quality (the
    // lists outside folders show small copies)
    // (a folder of more than 15 songs: each cover is loaded as it's needed: the
    // rows show the small copies and only the selected song gets its full
    // cover, see _coverSwap)
    const dyn = lvl.inFolder && this._dynCovers(lvl);
    const shown = lvl.inFolder && !dyn && it.kind === "music" && it.icon && it.icon.full ? { ...it, icon: { ...it.icon, art: it.icon.full } } : it;
    el.innerHTML = itemIcon(shown) + (isCardKind ? "" : labelHTML(it)) + (it.kind === "game" && it.game ? consoleBadge(it.game.console) : "");
    if (isCardKind) avWaitCheck(el);   // (an avatar already loaded: no loading icon)
    if (it.kind === "user" && this.user && it.user && it.user.id === this.user.id) {
      el.insertAdjacentHTML("beforeend", `<div class="user-diamond"></div>`);
    }
    // a setting's current choice, on the right of its row (IMG_3605)
    if (it.kind === "setting" && it.ctl !== "sysinfo") el.insertAdjacentHTML("beforeend", `<div class="item-setval"></div>`);
    watchArtLoading(el, this._secFlat()); watchArtRatio(el);
    // left click: the item is chosen and opened (as ✕ does); right click: its △ menu (main.js)
    el.addEventListener("click", () => {
      if (this.overlay || this._level() !== lvl) return;
      if (lvl.sel !== j) { lvl.sel = j; this._layoutItems(this.root.clientWidth, this.root.clientHeight); this._onSelect(); }
      this.onInput("enter");
    });
    el._xmbPick = () => { if (lvl.sel !== j && this._level() === lvl) { lvl.sel = j; this._layoutItems(this.root.clientWidth, this.root.clientHeight); this._onSelect(); } };
    this.$items.appendChild(el); it._el = el; it._labelDirty = false;
    // placed without sliding in from the corner: transitions start next frame
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("fresh")));
    return el;
  }

  // Extra x offset (fraction of width) of the active column vs. the root spine.
  _drillOffset(active) { return drillX(active, active) - spineNow; }

  // Row centres (px) of a level's items around its selection, as on the XMB:
  // the selected row on the spine, the rows BELOW from a fixed line (≈680 @1080)
  // and the rows ABOVE jumping over the category row (≈120 @1080). In drilled
  // sub-menus (no category row) the gap above mirrors the one below.
  _rowTops(lvl, li, h) {
    const rowH = (it) => (it && it.kind === "game" ? GAME_PITCH : ITEM_PITCH) * h;
    const sy = h * ITEM_SPINE_Y;
    const sel = lvl.sel, n = lvl.items.length;
    const tops = new Array(n);
    tops[sel] = sy;
    const firstAbove = li === 0 ? h * ITEM_ABOVE_Y : sy - (h * ITEM_BELOW_Y - sy);
    for (let j = sel + 1; j < n; j++) {
      const r = rowH(lvl.items[j]);
      tops[j] = j === sel + 1 ? h * ITEM_BELOW_Y + (r - ITEM_PITCH * h) / 2
                              : tops[j - 1] + (rowH(lvl.items[j - 1]) + r) / 2;
    }
    for (let j = sel - 1; j >= 0; j--) {
      const r = rowH(lvl.items[j]);
      tops[j] = j === sel - 1 ? firstAbove - (r - ITEM_PITCH * h) / 2
                              : tops[j + 1] - (rowH(lvl.items[j + 1]) + r) / 2;
    }
    return tops;
  }

  _layoutItems(w, h) {
    const active = this.levels.length - 1;
    const isCardIt = (it) => it && (it.kind === "playercard" || it.kind === "friendcard");
    const sy = h * ITEM_SPINE_Y;
    const spineOf = (li) => w * drillX(li, active);
    this.levels.forEach((lvl, li) => {
      const isActive = li === active;
      if (!isActive) {
        if (lvl._anchorEl) {
          lvl._anchorEl.style.left = `${spineOf(li)}px`;
          lvl._anchorEl.style.top = `${sy}px`;
          lvl._anchorEl.style.opacity = li === active - 1 ? "0.8" : "0.5";
          lvl._anchorEl.style.zIndex = "1";
        }
        if (lvl._ghosts && lvl._ghosts.length) {
          const tops = this._rowTops(lvl, li, h);
          const gx = spineOf(li) + GHOST_DX * w;
          for (const g of lvl._ghosts) {
            const t = tops[g.j];
            // pulled in a little toward the spine (as in the capture)
            const y = sy + (t - sy) * (t < sy ? 0.95 : 0.89);
            g.el.style.left = `${gx}px`;
            g.el.style.top = `${y}px`;
          }
        }
        return;
      }
      const sx = spineOf(li);
      const sel = lvl.sel;
      this._ensureWindow(lvl);
      this.$items.classList.toggle("grid", !!lvl.grid);
      if (lvl.grid) { this._layoutGrid(lvl, sx, sy, w, h); return; }
      const tops = this._rowTops(lvl, li, h);
      lvl.items.forEach((it, j) => {
        if (!it._el) return;
        const isSel = j === sel;
        const isCard = isCardIt(it);
        it._el.classList.toggle("sel", isSel);
        it._el.style.left = `${isCard ? sx - (isSel ? CARD_X : CARD_COMPACT_X) * w : sx}px`;
        it._el.style.top = `${tops[j]}px`;
        // every non-selected row is drawn at the same dim level (as in the refs)
        it._el.style.opacity = isSel ? "1" : "0.55";
        it._el.style.zIndex = isSel ? "5" : "1";
        // songs / photos / videos / games: a title too long for the screen
        // scrolls (marquee) instead of running off the edge
        if (isUserContent(it)) {
          const t = it._el.querySelector(".il-title");
          if (t) {
            // (the label's margin is the same for every row of a kind: measured once)
            const lk = t.parentElement.className;
            // (a game's title moves out when it's chosen (styles.css): worked
            // out here, as the style is still moving)
            const ar = parseFloat(it._el.style.getPropertyValue("--ar")) || 0;
            const ml = t.parentElement.classList.contains("il-game")
              ? (isSel ? Math.max(0.1021 * w, ar ? 0.0466 * w * ar + 0.0155 * w : 0) : 0.0604 * w)
              : (this._mlCache ||= new Map()).get(lk) ?? (this._mlCache.set(lk, parseFloat(getComputedStyle(t.parentElement).marginLeft) || 0), this._mlCache.get(lk));
            const left = (parseFloat(it._el.style.left) || 0) + ml;
            t.style.maxWidth = `${Math.max(120, w * 0.975 - left)}px`;
            t.classList.add("mq");
          }
        }
      });
    });
    this._refreshDetail(w, h);
  }

  // A folder of pictures (captures: 5 columns 243 px apart, the first on the
  // spine; the selected row on the spine, the next rows 255 px away and then
  // 160 px apart). Each picture is shown whole and centred in its cell; the
  // selected one larger, with a see-through frame just outside it that glows
  // with its title, and its name and date underneath.
  _layoutGrid(lvl, sx, sy, w, h) {
    const sel = lvl.sel, row0 = Math.floor(sel / GRID_COLS);
    const dy = (r) => r === 0 ? 0 : Math.sign(r) * (255 + (Math.abs(r) - 1) * 160) / 1080 * h;
    lvl.items.forEach((it, j) => {
      const r = Math.floor(j / GRID_COLS) - row0, c = j % GRID_COLS, isSel = j === sel;
      const el = it._el; if (!el) return;
      el.classList.toggle("sel", isSel); el.classList.add("grid-cell");
      el.style.left = `${sx + (GRID_X0 + c * GRID_DX) / 1920 * w}px`;
      el.style.top = `${sy + dy(r)}px`;
      el.style.opacity = "1";
      el.style.zIndex = isSel ? "5" : "1";
      el.style.visibility = Math.abs(r) > 4 ? "hidden" : "visible";
      this._gridCell(el, isSel, w, h);
    });
    this._refreshDetail(w, h);
  }
  // size one cell's picture (and the selected one's frame and title) to fit its box
  _gridCell(el, isSel, w, h) {
    const fr = el.querySelector(".art-frame"), img = fr && fr.querySelector(".art-img");
    if (!fr || !img) return;
    const [bw, bh] = (isSel ? GRID_BOX_SEL : GRID_BOX).map((v, i) => v / (i ? 1080 : 1920) * (i ? h : w));
    fr.style.width = `${bw}px`; fr.style.height = `${bh}px`;
    if (!img.naturalWidth) {
      if (!img._gridWait) { img._gridWait = true; img.addEventListener("load", () => { img._gridWait = false; this._gridCell(el, el.classList.contains("sel"), this.root.clientWidth, this.root.clientHeight); }, { once: true }); }
      return;
    }
    const k = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
    const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
    img.style.width = `${iw}px`; img.style.height = `${ih}px`;
    let hl = fr.querySelector(".grid-hl");
    if (!hl) { hl = document.createElement("div"); hl.className = "grid-hl"; fr.appendChild(hl); }
    const pad = 0.0065 * h;
    Object.assign(hl.style, { width: `${iw + 2 * pad}px`, height: `${ih + 2 * pad}px` });
    // the title starts at the frame's left edge, just under it
    const lab = el.querySelector(".item-label");
    if (lab) { lab.style.left = `${(bw - iw) / 2 - pad}px`; lab.style.top = `${bh / 2 + ih / 2 + pad + 0.004 * h}px`; }
  }

  // Fill in the selected item's label (title + description, which travel with
  // its icon) and reset the others. Content-info items (those with a cinfo
  // backdrop) show only their title until the dwell sets `this._reveal`; then
  // the PS3 description rectangle fades in (this.$detail) and every label
  // fades out, as on the real XMB.
  _refreshDetail(w, h) {
    w = w || this.root.clientWidth; h = h || this.root.clientHeight;
    const active = this.levels.length - 1;
    const sx = w * spineNow + this._drillOffset(active) * w;
    const lvl = this._level();
    const it = lvl.items[lvl.sel];
    lvl.items.forEach((o) => { if (o !== it && o._el && o._labelDirty) resetLabel(o); });
    this._fillSetVals(lvl);
    if (!it) { this._hidePanel(); return; }
    const isCard = it.kind === "playercard" || it.kind === "friendcard";
    // settings show their description; the value lives in the option (△) menu
    const val = it.kind === "setting" ? (it.ctl === "sysinfo" ? this._ctlValue(it.ctl) : "")
      : (lvl.grid && it.media && it.media.modified) ? this._fmtDateTime(new Date(it.media.modified * 1000)) : it.sub;
    const isBg = !!it.bg || !!it.panel;
    const revealed = !isBg || this._reveal;          // bg items wait for the dwell
    const panel = isBg && revealed && !!val;
    // Preload All Songs shows a spinning loader while decoding, then a tick.
    let status = "";
    const pAct = this._preloadAct || "preload";
    if (it.kind === "action" && it.act === pAct && this._preloadState) {
      if (this._preloadState === "loading") {
        const n = this._preloadTotal ? ` ${this._preloadDone}/${this._preloadTotal}` : "";
        status = `<span class="d-status"><img class="d-spin" src="./assets/icons/system/loading_icon.png" alt="">${n}</span>`;
      } else if (this._preloadState === "done") {
        status = `<span class="d-status"><img class="d-tick" src="./assets/icons/system/tick.png" alt=""></span>`;
      }
    }
    const preloading = it.kind === "action" && it.act === pAct && this._preloadState === "loading";
    const sub = preloading ? "Please wait. The system could slow down while this runs. Do not close or navigate away until it finishes." : val;
    const title = preloading ? (this._preloadTitle || (pAct === "preloadvideos" ? "Preloading videos..." : "Preloading songs...")) : it.title;
    // setting items may ALSO carry a description in `it.sub`; show it under the
    // value (the value itself is what `val` holds for settings).
    const settingDesc = (it.kind === "setting" && it.sub && revealed && !(it.act === "preload" || it.act === "preloadvideos"))
      ? `<div class="d-desc">${esc(it.sub)}</div>` : "";
    const warnLine = (it.kind === "action" && it.warn && revealed && !preloading)
      ? `<div class="d-warn-text">${esc(it.warn)}</div>` : "";
    if (!isCard && it._el) {
      const lab = it._el.querySelector(".item-label");
      if (lab) {
        lab.querySelector(".il-title").innerHTML = esc(title || "") + status;
        lab.querySelector(".il-body").innerHTML = (!panel && (sub || settingDesc) && revealed)
          ? (sub ? `<div class="d-sub${preloading ? " d-warn" : ""}${it.userSub ? " il-usub" : ""}">${esc(sub)}</div>` : "") + settingDesc + warnLine : autoLogHTML(it);
        it._labelDirty = true;
      }
    }
    if (panel) this._showPanel(it, sx, h, title, sub);
    else this._hidePanel();
  }

  // the description rectangle of a content-info item (PS Store, What's New,
  // Sign Up, Photo Gallery…): fades in, fixed beside the spine.
  _showPanel(it, sx, h, title, sub) {
    const d = this.$detail;
    const w = this.root.clientWidth;
    const html = `<div class="dp-title">${esc(title || "")}</div><div class="dp-body">${esc(sub || "")}</div>`;
    d.style.left = `${sx + (150 / 1920) * w}px`;
    d.style.top = `${h * (417 / 1080)}px`;
    d.classList.toggle("dp-gallery", it.act === "photogallery" || /gallery/i.test(it.title || ""));
    d.classList.toggle("dp-home", it.panel === "home");
    d.classList.toggle("dp-plain", !!it.panelPlain);
    if (d._html !== html) { d.innerHTML = html; d._html = html; }
    if (!d.classList.contains("d-panel")) {
      d.classList.add("d-panel");
      void d.offsetWidth;                              // start the fade from 0
    }
    d.classList.add("d-show");
    this.$items.classList.add("panel-on");
  }
  _hidePanel() {
    const d = this.$detail;
    if (!d) return;
    d.classList.remove("d-show", "d-panel");
    d.innerHTML = ""; d._html = "";
    this.$items && this.$items.classList.remove("panel-on");
  }

  // --------------------------------------------------------- selection FX
  _onSelect() {
    this._armIdle();
    clearTimeout(this.dwellTimer); this._stopGameMedia(); this._reveal = false;
    const it = this._level().items[this._level().sel];
    // the disc game shows the disc (no background or music) for its first 3 s
    // selected, then its own icon (or GIF), background and music
    if (this._discShown && this._discShown !== it) {
      const im = this._discShown._el && this._discShown._el.querySelector(".art-img");
      if (im) { im.src = this._discShown.icon.art; im.classList.add("disc-img"); }
      this._discShown = null;
    }
    if (this.$items) {
      this.$items.querySelectorAll(".item.cinfo-glow, .item.revealed, .item.bg-notitle").forEach((e) => e.classList.remove("cinfo-glow", "revealed", "bg-notitle"));
      this.$items.classList.remove("panel-home");
    }
    // Always clear any backdrop first, so a previous subsection's background /
    // description never lingers (e.g. moving into the empty Friends column).
    this.wave.setHidden(false); this.$bg.classList.remove("show"); this.$bg.style.backgroundImage = "";
    if (!it) { this._applyBgMusic(); this._refreshDetail(); return; }
    this._applyBgMusic();
    if (it.kind === "game" || it.extra) {
      const disc = !!(it.icon && it.icon.disc);
      this.dwellTimer = setTimeout(() => {
        if (disc && it.icon.real && it._el) {
          const im = it._el.querySelector(".art-img");
          if (im) { im.src = it.icon.real; im.classList.remove("disc-img"); }
          this._discShown = it;
        }
        this._revealGame(it);
      }, disc ? DISC_HOLD_MS : DWELL_MS);
      this._refreshDetail(); return;
    }
    // Content-info subsections (PSN / Store / Photo Gallery) reveal their
    // full-screen cinfo backdrop AND their description rectangle only after the
    // same dwell delay the games use.
    if (it.bg || it.panel) {
      this.dwellTimer = setTimeout(() => {
        if (this._level().items[this._level().sel] !== it) return;   // moved away
        this._reveal = true;
        if (it.bg) {
          // (the wave stays until the picture has actually loaded: no black gap)
          const url = `./assets/cinfo/${it.bg}`, im = new Image();
          im.onload = () => {
            const l = this._level(); if (l.items[l.sel] !== it || !this._reveal) return;
            this.$bg.style.backgroundImage = `url("${url}")`;
            this.$bg.classList.add("show"); this._syncWaveHidden();
          };
          im.src = url;
        }
        // What's New / My Channels: once their backdrop is up, the icon's
        // outline glows (twice as fast as a selected title's glow)
        if (it._el && /^(What's New|My Channels)$/.test(it.title || "")) it._el.classList.add("cinfo-glow");
        this._refreshDetail();
      }, DWELL_MS);
    }
    this._refreshDetail();
  }
  // still the one revealed (the cursor hasn't moved on, no game started)
  _stillRevealed(it) { return !!(it && it._el && it._el.classList.contains("revealed") && !this._inGame); }
  // (games, and section items with a .json giving a gif / background / music)
  _revealGame(it) {
    const g = it.game || it.extra || {};
    if (it._el) it._el.classList.add("revealed");     // the game's name shows now
    if (g.background) {
      const url = assetUrl(g.background);
      // the picture is loaded and decoded first (off the main thread), and only
      // then shown in place of the wave: never a black moment while a big
      // picture (a PS3 game's PIC1.PNG) is still being read
      const im = new Image(); im.decoding = "async";
      const still = () => { const l = this._level(); return l.items[l.sel] === it && this._stillRevealed(it); };
      const show = () => {
        if (!still()) return;
        this.$bg.style.backgroundImage = `url("${url}")`; this.$bg.classList.add("show"); this._syncWaveHidden();
        // Hide Game Title on Background (Game Settings): the name goes once the background is up
        if ((it.game ? this._gameHideTitle(it.game) : this.settings?.behavior?.gameHideTitle) && it._el) it._el.classList.add("bg-notitle");
      };
      im.src = url;
      (im.decode ? im.decode() : new Promise((r, j) => { im.onload = r; im.onerror = j; })).then(show, () => show());
      this._bgKeep = im;   // (kept so the decoded picture stays in memory while shown)
    }
    if (it.icon.preview && it._el) {
      const gif = /\.gif([?#]|$)/i.test(it.icon.preview);
      const v = document.createElement(gif ? "img" : "video");
      v.src = it.icon.preview; v.className = "preview-vid";
      if (!gif) { v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; }
      const frame = it._el.querySelector(".art-frame");
      if (frame) {
        // the video / GIF shows in its own shape too (back to the icon's after)
        const fit = () => { frame._previewOn = true; fitArtRatio(frame, gif ? v.naturalWidth : v.videoWidth, gif ? v.naturalHeight : v.videoHeight); };
        v.addEventListener(gif ? "load" : "loadedmetadata", fit, { once: true });
        frame.appendChild(v); if (!gif) v.play().catch(() => {}); this._previewVid = v;
      }
    }
    if (g.music && this.user && this.user.musicEnabled !== false) this.audio.playMusic(assetUrl(g.music));
  }
  _stopGameMedia() {
    if (this._previewVid) {
      const fr = this._previewVid.parentElement;
      this._previewVid.remove(); this._previewVid = null;
      if (fr) { fr._previewOn = false; if (fr._iconAr) fitArtRatio(fr, ...fr._iconAr); else fitArtRatio(fr, 16, 9); }
    }
    this.audio.stopPreview();
  }

  // ------------------------------------------------------------- navigation
  _gotoCat(i) {
    if (i === this.selCat) return;
    this.audio.play(i > this.selCat ? "cursor_down" : "cursor_up", 0.5);
    // Remember the top-level position in the column we're leaving, and restore
    // the remembered one for the column we're entering (T15).
    if (!this._colSel) this._colSel = {};
    if (this.levels.length === 1) this._colSel[this.columns[this.selCat].id] = this.levels[0].sel;
    this.selCat = i;
    const items = this.columns[i].items;
    let sel = this._colSel[this.columns[i].id] ?? 0;
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    this.levels = [{ items, sel }];
    const w = this.root.clientWidth, h = this.root.clientHeight;
    this._layoutCats(w, h);   // categories slide (CSS transition) rather than snap
    this.$crumb.classList.remove("show");
    this._renderItems(w, h);
    this._onSelect();
    this._liveRefresh(this.columns[i].id);
  }

  _drill(it) {
    this.audio.play("enter", 0.6);
    // childrenFn lets a submenu compute its items fresh each time it opens (used
    // by Saved Presets, which changes as presets are added/removed).
    const children = it.childrenFn ? it.childrenFn.call(this) : it.children;
    const friendMenu = it.childrenFn === this._friendPersonalizationItems;
    // a folder of pictures: shown as a grid, five to a row (as on the console)
    const grid = (children || []).length > 0 && children.every((c) => c.kind === "photo");
    this.levels.push({ items: children, sel: 0, head: { icon: it.icon, label: it.title }, friendMenu, grid, inFolder: true,
      rebuild: it.childrenFn ? () => it.childrenFn.call(this) : null });
    this._render(); this._onSelect();
  }
  _back() {
    if (this.overlay) return;
    if (this.levels.length > 1) {
      this.audio.play("back", 0.5);
      const leaving = this.levels.pop();
      // leaving Friend Personalization → apply count/mode/card changes now
      if (leaving && leaving.friendMenu && this._friendMenuDirty) this._refreshFriendsColumn();
      this._render(); this._onSelect();
    }
  }

  _activate() {
    const it = this._level().items[this._level().sel];
    if (!it) return;
    switch (it.kind) {
      case "drill": this._drill(it); break;
      case "game": this.audio.play("enter", 0.6); if (it.appMode) this._launchApp(it.game); else this._launch(it.game); break;
      case "user":
        // logged in: the user who's logged in asks to log out, another one asks to switch
        if (this.user && !this.locked) { if (it.user.id === this.user.id) this._askLogOut(it.user); else this._askSwitchUser(it.user); }
        else this._signIn(it.user);
        break;
      case "newuser": this._newUser(); break;
      case "setting": this._settingMenu(it); break;
      case "action": return this._runAction(it.act, it);
      case "playercard": this._psnProfile(); break;
      case "friendcard": this.audio.play("enter", 0.4); break;
      case "music": this._openMusicPlayer(); break;
      case "photo": this._openViewer("photo", it.media); break;
      case "video": this._openViewer("video", it.media); break;
      default: this.audio.play("error", 0.5);
    }
  }

  _options() {
    const it = this._level().items[this._level().sel];
    if (!it) return;
    if (it.kind === "game") this._gameOptions(it.game);
    else if (it.kind === "user") this._userOptions(it.user);
    else if (it.psnAuth) this._accountOptions(it);
    else if (it.kind === "playercard") this._psnProfile();
    else if (it.opts && it.opts.length) this._itemOptions(it);
  }

  // △ on Account Management (IMG_3575): Sign Out and Auto Sign-In Off, in the
  // games' panel with the band behind the row; Auto Sign-In Off greys out once
  // used (until the column is made again)
  _accountOptions(it) {
    const el = it._el;
    this._triBand(el);
    const done = () => { this.overlay = null; if (el) el.classList.remove("gm-band"); };
    this.overlay = this.gameMenu;
    this.gameMenu.open({ withBg: this.$bg.classList.contains("show"), top: [],
      lower: [{ id: "signout", label: "Sign Out" }, { id: "autooff", label: "Auto Sign-In Off" }],
      disabled: it._autoOffUsed ? ["autooff"] : [] }, async (id) => {
      if (id === "signout") { this.gameMenu.close(); done(); this._runAction("psn_signout"); return; }
      if (id === "autooff") {
        it._autoOffUsed = true;
        if (this.user) { this.user.psnAutoSignIn = false; await call("save_user", { user: this.user }); }
        this.audio.play("enter", 0.5);
        this.gameMenu.dis.add("autooff"); this.gameMenu._render();
      }
    }, done);
  }
  // Generic options (triangle) menu for an item that carries `opts`
  // ([{act,label}]): e.g. Sign Out on Account Management.
  _itemOptions(it) {
    this.overlay = this.sideMenu;
    this.sideMenu.open(it.opts.map((o) => ({ label: o.label, id: o.act })), { title: it.title },
      (choice) => { this.sideMenu.close(); this.overlay = null; this._runAction(choice.id); },
      () => { this.sideMenu.close(); this.overlay = null; });
  }

  // ------------------------------------------------------------- game menus
  // △ on a game: the PS3 options panel down the right (the game's name hides
  // while it's open; the row gets the darker band and its format badge)
  _gameOptions(game) {
    const lvl = this._level(), it = lvl.items[lvl.sel];
    const el = it && it._el;
    const withBg = this.$bg.classList.contains("show");
    // Game Options Band (Game Settings, on by default): a see-through black band
    // behind the icon and the name, out to the panel; off: the name hides
    // (no band either for a game whose name hides on its background: Hide Game Title on Background)
    if (el && (!this._gameBandOn(game) || (this._gameHideTitle(game) && withBg))) el.classList.add("gm-open");
    else this._triBand(el);
    this.overlay = this.gameMenu;
    const done = () => { this.overlay = null; if (el) el.classList.remove("gm-open", "gm-band"); };
    this.gameMenu.open({ withBg, fmt: game.console || "PS3", subs: {
      sort: { options: [{ id: "created_desc", label: "Creation Date", tri: "down" }, { id: "created_asc", label: "Creation Date", tri: "up" },
        { id: "recent", label: "Recently Played" }, { id: "format", label: "Format" }], current: this._gameSortId() },
      // (listed By Format, By Album, All, as on the console)
      group: { options: ["format", "album", "all"].map((id) => MEDIA_MODES.game.find((m) => m.id === id)).filter(Boolean).map((m) => ({ id: m.id, label: m.label })),
        current: this._mediaMode("game") },
    } }, (id, val) => {
      if (id === "sort") { if (this.user) { this.user.gameSort = val; this._persistUser(); } this.gameMenu.close(); done(); this._refreshGameColumn(); return; }
      if (id === "group") {
        this.mediaMode.game = val; if (this.user) { this.user.mediaMode = this.mediaMode; this._persistUser(); }
        this.gameMenu.close(); done(); Promise.resolve(this._rebuildAndStay()).then(() => this._updateMediaSort(true)); return;
      }
      if (id === "start") { this.gameMenu.close(); done(); this.audio.play("enter", 0.6); this._launch(game); return; }
      if (id === "info") { this.audio.play("enter", 0.5); this.gameMenu.close(); done(); this._gameInfoPanel(game); return; }
      if (id === "search") { this.gameMenu.close(); done(); this._browserSearch(game.title); return; }
      if (id === "delete") { this.gameMenu.close(); done(); this._gameDelete(game); return; }
      this.audio.play("error", 0.4);          // not available in this system
    }, done);
  }
  // the see-through black band behind a row's icon and name while its △ panel
  // is open (games, Users, Account Management): centred on the screen (as
  // long on each side of the middle); it fades in from the picture's right
  // edge leftwards, and its right end (mirrored) sits behind the panel
  _triBand(el) {
    if (!el) return;
    const ir = el.getBoundingClientRect();
    const art = [...el.querySelectorAll(".art-img, .item-sys, .item-avatar, .art-frame")].map((n) => n.getBoundingClientRect()).find((r) => r.width > 4) || ir;
    const vw = innerWidth / 100, vh = innerHeight / 100;
    // (IMG_3679 / IMG_3680: the band is 23 % of the screen tall, centred 0.8 %
    // below the icon's middle; it starts 4.1 % left of a game's picture (grown
    // 1.36 x while the panel is open) and is fully in 5.8 % further right)
    const grow = el.classList.contains("item-game") ? 1.36 : 1;
    const artL = art.left + art.width / 2 - art.width * grow / 2;
    const left = Math.max(0, artL - 4.1 * vw), width = Math.max(1, (50 * vw - left) * 2);
    const fade = Math.min(48, Math.max(1, 5.8 * vw / width * 100));
    const midY = art.top + art.height / 2 + 0.8 * vh, bandH = 23 * vh;
    el.style.setProperty("--band-l", `${left - ir.left}px`);
    el.style.setProperty("--band-t", `${midY - bandH / 2 - ir.top}px`);
    el.style.setProperty("--band-h", `${bandH}px`);
    el.style.setProperty("--band-w", `${width}px`);
    el.style.setProperty("--band-f", `${fade.toFixed(2)}%`);
    el.classList.add("gm-band");
  }
  _browserSearch(q) {
    if (this._browserActive || this._browserBusy) return;
    call("browser_status").then((st) => {
      if (!st || !st.ready) { this._openInternet("search"); return; }
      this._browserFirstRun = !st.installed; this.audio.play("enter", 0.6); this._browserStart("search", q);
    }).catch(() => {});
  }
  // the game's Sort By choice (older "title" / "created" choices: Creation Date ▼)
  _gameSortId() {
    const v = this.user?.gameSort;
    return ["created_desc", "created_asc", "recent", "format"].includes(v) ? v : "created_desc";
  }
  // Delete (the game options): the console's confirmation (IMG_3553): the
  // game's icon with its name / date / size under it, the message and Yes / No
  // (No chosen first) on the right
  _gameDelete(game) {
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ icon: game.icon ? assetUrl(game.icon) : "./assets/icons/system/default_game.png",
      meta: [gameName(game), game.created ? this._fmtCreated(game.created) : "", game.size || ""].filter(Boolean),
      text: "The installed game will be deleted.\nAre you sure you want to continue?" },
      async (yes) => {
        this.gameConfirm.close(); this.overlay = null;
        if (!yes) return;
        try { await call("game_delete", { folder: game.folder }); }
        catch (e) { this.audio.play("error", 0.4); }
        // (the menu waits, with the loading clock, until the list is drawn again)
        await this._refreshGameColumn();
      });
  }
  // Information: the game's icon and its details (Buyer = the signed-in user).
  // Read-only: the details are changed in Settings > Game Settings.
  _gameInfoPanel(game) {
    const dt = (v) => v ? this._fmtCreated(v) : "-";
    const rows = [
      ["Title", game.title], ["Album", game.album || "-"],
      ["Parental Control", game.parentalControl ? `Level ${game.parentalControl}` : "-"],
      ["Saved Data Auto-Upload", "Off"], ["Created", dt(game.created)], ["Size", game.size || "-"],
      ["Version", game.version || "-"], ["Buyer", this.user?.name || "-"], ["Starts", dt(game.starts)],
      ["Expires", "-"], ["Remaining Time", "No Time Limit"],
    ];
    this.overlay = this.gameInfo2;
    // a game with its own background: the system's background (wave /
    // wallpaper) shows behind Information, like the Sign In screen
    this.wave.setHidden(false);
    this.gameInfo2.open({ icon: game.icon ? assetUrl(game.icon) : null, rows }, () => {
      this.overlay = null;
      if (this.$bg.classList.contains("show")) this.wave.setHidden(true);
    });
  }
  // a program / script from a custom section: started like a game, but the
  // app keeps its sound and its screen (no black screen, nothing muted)
  async _launchApp(game) {
    const r = await call("launch_game", { folder: game.folder, launch: game.launch, args: game.args || [] }).catch(() => null);
    if (!r || r.ok === false) this.audio.play("error", 0.5);
  }
  async _launch(game) {
    // Game mode: fade to black, silence the whole app (whatever Play Audio in
    // Background says) and stop everything (wave, animations, videos, icon
    // loading, controller reading); the app stays full screen behind the game.
    // When the game ends the app notices by itself ("game-exited") and comes
    // back to the front; returning to it by hand works too.
    const fb = document.getElementById("fadeblack");
    // (for Sort By > Recently Played)
    if (this.user && game.folder) { (this.user.gamePlayed ||= {})[game.folder] = Date.now(); this._persistUser(); }
    // the screen dissolves into black first (the menu, the wave and the music
    // fading out with it), and only then does everything stop and the game start
    if (this._launching) return;
    this._launching = true;   // (no input meanwhile: see onInput)
    fb.classList.add("show");
    const music = [this.audio.bg, this.audio.preview].filter((a) => a && !a.paused);
    const vols = music.map((a) => a.volume), t0 = performance.now(), FADE = 900;
    await new Promise((res) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / FADE);
        music.forEach((a, i) => { a.volume = vols[i] * (1 - k); });
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
      setTimeout(res, FADE + 300);   // (frames may be slow: never wait much longer)
    });
    this._launching = false;
    this._stopGameMedia();
    this.audio.enabled = false; this.audio.musicEnabled = false;
    this.audio.enterGame(); this._inGame = true; this.setLowPower(2);
    music.forEach((a, i) => { a.volume = vols[i]; });   // (paused by enterGame; back at their volume for later)
    document.body.classList.add("in-game");
    const r = await call("launch_game", { folder: game.folder, launch: game.launch, args: game.args || [] }).catch(() => null);
    let unlisten = null, armed = false, onFocus = null, vis = null;
    const restore = () => {
      if (!this._inGame) return;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", vis);
      if (unlisten) { try { unlisten(); } catch (e) {} }
      call("game_mode_end").catch(() => {});
      document.body.classList.remove("in-game");
      fb.classList.remove("show");
      this._inGame = false; this.setLowPower(document.hasFocus() ? 0 : 1);
      this.audio.enabled = this.user?.soundEnabled !== false;
      this.audio.musicEnabled = this.user?.musicEnabled !== false;
      this.audio.leaveGame();
      this._onSelect();
    };
    if (!r || r.ok === false) { restore(); setTimeout(() => this.audio.play("error", 0.5), 300); return; }
    // the app still has the focus right after the launch: only a focus that
    // comes back after the game took it counts as "the user is back"
    onFocus = () => { if (armed) restore(); };
    vis = () => { if (document.hidden) armed = true; else if (armed) restore(); };
    window.addEventListener("blur", () => { armed = true; }, { once: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", vis);
    const ev = window.__TAURI__?.event;
    if (ev?.listen) ev.listen("game-exited", restore).then((u) => { unlisten = u; if (!this._inGame) u(); });
  }

  // ------------------------------------------------------------- users
  async _signIn(user, opts = {}) {
    if (this._signingIn) return;
    this.audio.play("enter", 0.6);
    // Show a loading screen (Turn-Off-System style) while this profile's
    // settings and themes load and its columns build. It only appears if the
    // load isn't near-instant, and is hidden the moment everything is ready;
    // the menu doesn't move meanwhile.
    this._signingIn = true;
    const showT = setTimeout(() => this._loadingBegin(), 60);
    try { await this._signInSteps(user, showT, opts); } finally { this._signingIn = false; }
  }
  async _signInSteps(user, showT, opts = {}) {
    const list = await call("list_users");
    const fresh = (list.users || []).find((u) => u.id === user.id) || user;
    call("set_active_user", { id: fresh.id });
    this.user = fresh; user = fresh; this.locked = false; this._loggedInOnce = true;
    await this._loadUserSettings(fresh);
    this._syncHotkeys();
    // restore this user's saved media ordering (Music / Photo / Video sections)
    this.mediaMode = Object.assign({ music: "all", photo: "all", video: "all" }, fresh.mediaMode || {});
    // PSN: without Auto Sign-In the user starts signed out of PlayStation Network
    // PSN: with Auto Sign-In the account signs in as the user logs in; otherwise
    // the user starts signed out of PlayStation Network
    { const want = fresh.psnAutoSignIn === true && fresh.psnLinkedId ? fresh.psnLinkedId : null;
      if ((fresh.psnAccountId || null) !== want) { fresh.psnAccountId = want; call("save_user", { user: fresh }); } }
    this.cbs.onProfileChange(user);
    this.audio.enabled = user.soundEnabled !== false;
    this.audio.musicEnabled = user.musicEnabled !== false;
    this._applyBgMusic();
    this._migrateWaveSettings(); this._migrateWaveV3();
    this.wave.setColor(user.theme?.backgroundColor || "auto");
    this._applyWaveStyle();
    applyIconColorVar(user.theme?.iconColor || "#ffffff");
    this._applyIconStyle();
    this._applyTextLook();
    await this._applyThemes(false, true);
    this._applyWallpaper();
    this._restartRotation();
    await this._buildColumns();
    clearTimeout(showT);
    await this._loadingSettle();
    this.selCat = this.columns.findIndex((c) => c.id === "game");
    let sel0 = 0;
    // logging in (any way) starts on What's New
    if (opts.startAt !== "game") {
      const pi = this.columns.findIndex((c) => c.id === "psn");
      const wi = pi >= 0 ? this.columns[pi].items.findIndex((x) => x.title === "What's New") : -1;
      if (wi >= 0) { this.selCat = pi; sel0 = wi; }
    }
    if (this.selCat < 0) this.selCat = 0;
    this.levels = [{ items: this.columns[this.selCat].items, sel: sel0 }];
    this._render(); this._onSelect();
    this._loadingDone();
  }
  _newUser() {
    // XMB-style: only ask for a name; the profile gets the default white user icon.
    this.overlay = this.textForm;
    this.textForm.open({ title: "New User", fields: [{ key: "name", label: "Name", required: true, max: NAME_LIMIT }], submit: "Create" },
      async (out) => {
        this.textForm.close(); this.overlay = null;
        // (the loading screen at once: making the user and reading the users
        // again can take a moment, right after a restart above all, and the
        // menu would sit still meanwhile)
        this._loadingBegin();
        let u = null;
        try { u = await call("create_user", { name: out.name, avatar: "stock:square_grey" }); await this._reloadUsers(); } catch (e) { console.warn("create user", e); }
        // straight into the new user
        if (u && u.id) await this._signIn(u);
        else { this.audio.play("error", 0.5); this._loadingQuit(); }
      },
      () => { this.textForm.close(); this.overlay = null; });
  }
  // △ on a user (IMG_3576 / IMG_3577): the games' panel with Log Out (the
  // logged-in user), Automatic Login ▶ (On / Off), Delete and Information;
  // the band goes behind the row
  _userOptions(user) {
    const lvl = this._level(), it = lvl.items[lvl.sel], el = it && it._el;
    const current = !!(this.user && this.user.id === user.id);
    this._triBand(el);
    const done = () => { this.overlay = null; if (el) el.classList.remove("gm-band"); };
    const lower = [
      ...(current ? [{ id: "logout", label: "Log Out" }] : []),
      { id: "autologin", label: "Automatic Login", sub: true },
      { id: "delete", label: "Delete" },
      { id: "info", label: "Information" },
    ];
    this.overlay = this.gameMenu;
    this.gameMenu.open({ withBg: this.$bg.classList.contains("show"), top: [], lower,
      subs: { autologin: { options: [{ id: "on", label: "On" }, { id: "off", label: "Off" }], current: user.autoLogin ? "on" : "off" } } },
      async (id, val) => {
        if (id === "autologin") { this.gameMenu.close(); done(); await this._setAutoLogin(user, val === "on"); return; }
        this.gameMenu.close(); done();
        if (id === "logout") this._askLogOut(user);
        else if (id === "delete") this._deleteUser(user);
        else if (id === "info") { this.audio.play("enter", 0.5); this._userInfoScreen(user); }
      }, done);
  }
  // Automatic Login: this user is logged in straight after the intro (only one
  // user can have it); the row shows the small arrow under its name
  async _setAutoLogin(user, on) {
    const list = await call("list_users");
    for (const u of list.users || []) {
      const want = on ? u.id === user.id : (u.id === user.id ? false : !!u.autoLogin);
      if (!!u.autoLogin !== want) await call("save_user", { user: { ...u, autoLogin: want } });
    }
    if (this.user) {
      const me = (list.users || []).find((u) => u.id === this.user.id);
      if (me) this.user.autoLogin = on ? me.id === user.id : (me.id === user.id ? false : !!this.user.autoLogin);
    }
    this.audio.play("enter", 0.5);
    await this._reloadUsersStay(user.id);
  }
  // rebuild the Users column and stay on the same user
  async _reloadUsersStay(userId) {
    // (only the Users column)
    if (!await this._replaceColumn("users")) await this._buildColumns();
    const ci = this.columns.findIndex((c) => c.id === "users");
    if (ci < 0) return;
    this.selCat = ci;
    const items = this.columns[ci].items;
    this.levels = [{ items, sel: Math.max(0, items.findIndex((x) => x.kind === "user" && x.user && x.user.id === userId)) }];
    this._render(); this._onSelect();
  }
  // "Do you want to log out?" (IMG_3598): Yes = back to the user selection
  _askLogOut(user) {
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ user: true, icon: avatarSrc(user.avatar), stock: isStockAvatar(user.avatar), diamond: true, meta: [user.name],
      text: "Do you want to log out?", sel: 0 }, (yes) => {
      this.gameConfirm.close(); this.overlay = null;
      if (yes) this._logOut();
    });
  }
  // "Do you want to log in as the selected user? ..." (IMG_3599): Yes = that
  // user is logged in (the loading clock shows meanwhile)
  _askSwitchUser(user) {
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ user: true, icon: avatarSrc(user.avatar), stock: isStockAvatar(user.avatar), meta: [user.name],
      text: "Do you want to log in as the selected user?\nThe currently logged in user will be logged out.", sel: 0 }, (yes) => {
      this.gameConfirm.close(); this.overlay = null;
      if (yes) this._signIn(user);
    });
  }
  // back to the user selection that follows the intro: the system starts again
  // (without the intro, and without Automatic Login)
  _logOut() {
    this.audio.play("back", 0.5);
    try { sessionStorage.setItem("xmbLogOut", "1"); } catch (e) {}
    setTimeout(() => location.reload(), 250);
  }
  // Information (IMG_3578 / IMG_3579): the user's icon and name; ✕ Edit
  _userInfoScreen(user) {
    const current = !!(this.user && this.user.id === user.id);
    const reopen = (u) => { this.overlay = this.userInfo; this.userInfo.open(u, current, handlers); };
    const handlers = {
      onIcon: () => { this.userInfo.close(); this._changeUserPicture(user, (u) => { user = u; reopen(u); }, () => reopen(user)); },
      onName: () => { this.userInfo.close(); this._editUserName(user, (u) => { user = u; reopen(u); }, () => reopen(user)); },
      onBack: async () => { this.userInfo.close(); this.overlay = null; await this._reloadUsersStay(user.id); },
    };
    reopen(user);
  }
  _editUserName(user, onDone, onCancel) {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Edit Name", fields: [{ key: "name", label: "Name", value: user.name, required: true, max: NAME_LIMIT }], submit: "Save" },
      async (out) => {
        this.textForm.close(); this.overlay = null;
        const u = { ...user, name: out.name };
        await call("save_user", { user: u });
        if (this.user && this.user.id === u.id) { this.user.name = u.name; this.cbs.onProfileChange(this.user); }
        if (onDone) onDone(u); else await this._reloadUsers();
      },
      () => { this.textForm.close(); this.overlay = null; onCancel && onCancel(); });
  }
  // the console's icon chooser (IMG_3580-3597): the preset icons, or a photo
  async _changeUserPicture(user, onDone, onCancel) {
    const photos = await call("list_media", { kind: "photo" }).catch(() => []);
    const pics = (photos || []).filter((m) => !isVideoPath(m.path));
    const photoEntry = (m) => {
      const o = this._mediaItemObj("photo", m);
      return { title: o.title, sub: o.sub || "", thumb: (o.icon && o.icon.art) || assetUrl(m.path), ref: m.path };
    };
    const modes = MEDIA_MODES.photo.map((m) => ({ id: m.id, label: m.label }));
    const build = (modeId) => {
      const entries = pics.map((m) => this._mediaItemObj("photo", m));
      const saved = this.mediaMode.photo; this.mediaMode.photo = modeId;
      let grouped; try { grouped = this._groupMedia("photo", entries); } finally { this.mediaMode.photo = saved; }
      const conv = (it) => it.children
        ? { title: it.title, sub: it.sub, folder: true, html: it.icon && it.icon.folder ? itemIcon(it) : null, thumb: it.icon && it.icon.art, children: it.children.map(conv) }
        : photoEntry(it.media);
      // Playlists first (the Photo column's playlists: "Select a playlist.")
      return [{ title: "Playlists", sys: true, playlists: true, thumb: "./assets/icons/theme/icon_playlist.png" }, ...grouped.map(conv)];
    };
    // the user's photo playlists, chosen the way Add to Playlist chooses one
    // (the user's icon and name on the left; no "Create New Playlist")
    const playlists = ({ onPick, onCancel }) => {
      const pls = (this.user?.photoPlaylists || []).map((p) => {
        const kids = (p.photos || []).filter((x) => !isVideoPath(x)).map((path) => {
          const m = pics.find((q) => q.path === path) || { path, name: String(path).split(/[\\/]/).pop() };
          return photoEntry(m);
        });
        return { title: p.name, children: kids };
      });
      this.overlay = this.playlistPicker;
      this.playlistPicker.open({ thumb: avatarSrc(user.avatar), name: user.name, date: "", noCreate: true,
        playlists: pls.map((p) => ({ name: p.title, count: p.children.length })), noun: ["Image", "Images"],
        folderIcon: "./assets/icons/theme/icon_playlist.png" }, (i) => {
        const pl = pls[i];
        this.overlay = this.iconChooser;
        if (!pl || !pl.children.length) { this.audio.play("error", 0.4); onCancel(); return; }
        onPick(pl);
      }, () => { this.overlay = this.iconChooser; onCancel(); });
    };
    this.overlay = this.iconChooser;
    this.iconChooser.open({ presets: STOCK_AVATARS, current: user.avatar, photos: { modes, build, playlists } }, async (ref) => {
      this.iconChooser.close(); this.overlay = null;
      const u = { ...user, avatar: ref };
      await call("save_user", { user: u });
      if (this.user && this.user.id === u.id) { this.user.avatar = ref; this.cbs.onProfileChange(this.user); }
      if (onDone) onDone(u); else await this._reloadUsers();
    }, () => { this.iconChooser.close(); this.overlay = null; onCancel && onCancel(); });
  }
  // Delete (IMG_3601): the user's icon (◆ for the logged-in user) and name,
  // the warning, Yes / No with Yes chosen first. Deleting the logged-in user
  // logs out (back to the user selection)
  _deleteUser(user) {
    const current = !!(this.user && this.user.id === user.id);
    this.overlay = this.gameConfirm;
    this.gameConfirm.open({ user: true, icon: avatarSrc(user.avatar), stock: isStockAvatar(user.avatar), diamond: current, meta: [user.name],
      text: "If you delete the User, saved data for PlayStation\u00AE3 format software,\nmessages, trophies and other information will also be deleted.\nAre you sure you want to continue?",
      sel: 0 }, async (yes) => {
      this.gameConfirm.close(); this.overlay = null;
      if (!yes) return;
      await call("delete_user", { id: user.id });
      if (current) { this._logOut(); return; }
      await this._reloadUsersStay(this.user ? this.user.id : null);
    });
  }
  async _reloadUsers() {
    // (the logged-in user no longer exists: back to the user selection)
    if (this.user && !this.locked) {
      const list = await call("list_users").catch(() => null);
      if (list && !(list.users || []).some((u) => u.id === this.user.id)) { this._logOut(); return; }
    }
    if (this.locked || !await this._replaceColumn("users")) await this._buildColumns();
    const ci = this.columns.findIndex((c) => c.id === "users");
    this.selCat = this.locked ? 0 : ci;
    this.levels = [{ items: this.columns[this.selCat].items, sel: 0 }];
    this._render(); this._onSelect();
  }

  // ------------------------------------------------------------- settings
  // Build the "Wave and Sparkles Personalization" submenu: one adjustable setting per linkev
  // spline/particle parameter, plus a reset action. Adjusted with Left/Right.
  _activeWaveMeta() { return WAVE_PARAM_META; }
  // Wave and Sparkles Personalization: the wave's colour settings (the
  // background gradient behind it and the wave's own colour and light), the
  // wave's other settings, the sparkles' colour settings, the sparkles' other
  // settings; then the presets and the reset
  _wavePersonalizationItems() {
    const SI = { sys: "icon_setting_item.png" };
    const WAVE_COLOR = new Set(["gradientPreset", "bgTopR", "bgTopG", "bgTopB", "bgBotR", "bgBotG", "bgBotB", "bgAngle", "bgSpan", "bgCurve",
      "gradientTopMul", "gradientBotMul", "opacity", "brightness", "autoTintBoost", "autoTintWhite"]);
    const SPARK_COLOR = new Set(["opacity"]);
    const row = ([group, key, label, , , , , desc]) => ({ kind: "setting", ctl: `wp:${group}:${key}`, title: label, icon: SI, ...(desc ? { sub: desc } : {}) });
    const meta = this._activeWaveMeta();
    const pick = (fn) => () => meta.filter(fn).map(row);
    return [
      { kind: "drill", title: "Wave Color Settings", icon: SI, childrenFn: pick((m) => m[0] === "spline" && WAVE_COLOR.has(m[1])) },
      { kind: "drill", title: "Wave Settings", icon: SI, childrenFn: pick((m) => m[0] === "spline" && !WAVE_COLOR.has(m[1])) },
      { kind: "drill", title: "Sparkles Color Settings", icon: SI, childrenFn: pick((m) => m[0] === "particle" && SPARK_COLOR.has(m[1])) },
      { kind: "drill", title: "Sparkle Settings", icon: SI, childrenFn: pick((m) => m[0] === "particle" && !SPARK_COLOR.has(m[1])) },
      { kind: "action", act: "wave_save", title: "Save Current Settings as a Preset\u2026", icon: SI },
      { kind: "drill", title: "Saved Presets", icon: SI, childrenFn: this._wavePresetItems },
      { kind: "action", act: "wave_reset", title: "Reset Wave and Sparkles Settings to Default", icon: SI },
    ];
  }
  // The saved-preset list (computed fresh whenever the submenu opens). Each
  // preset loads on Enter; Delete lives on its options (triangle) menu.
  _wavePresetItems() {
    const presets = (this.user?.theme?.wavePresets) || [];
    if (!presets.length) return [{ kind: "empty", title: "No presets saved",
      sub: "Adjust the wave and the sparkles, then choose “Save Current Settings as a Preset…”.", icon: { sys: "icon_setting_item.png" } }];
    return presets.map((p, i) => ({ kind: "action", act: "wave_load", title: p.name,
      icon: { sys: "icon_setting_item.png" }, preset: p, opts: [{ act: `wave_delete::${i}`, label: "Delete Preset" }] }));
  }
  _saveWavePreset() {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Save Wave Preset", fields: [{ key: "name", label: "Preset Name", required: true }], submit: "Save" },
      (out) => { this.textForm.close(); this.overlay = null; this._commitWavePreset((out.name || "").trim()); },
      () => { this.textForm.close(); this.overlay = null; });
  }
  _commitWavePreset(name) {
    if (!name) return;
    const params = {};
    for (const m of this._activeWaveMeta()) {
      const v = this.wave.getWaveParam ? this.wave.getWaveParam(m[0], m[1]) : undefined;
      params[`${m[0]}:${m[1]}`] = (v != null ? v : waveParamDefault(m[0], m[1]));
    }
    const u = this.user;
    if (!u.theme.wavePresets) u.theme.wavePresets = [];
    const existing = u.theme.wavePresets.findIndex((p) => p.name === name);
    const entry = { name, params };
    if (existing >= 0) u.theme.wavePresets[existing] = entry; else u.theme.wavePresets.push(entry);
    this.audio.play("enter", 0.5); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _loadWavePreset(preset) {
    if (!preset) { this.audio.play("error", 0.4); return; }
    this._dropActiveWaveParams();
    this.user.theme.waveParams = { ...this.user.theme.waveParams, ...(preset.params || {}) };
    this._applyWaveStyle();
    this.audio.play("enter", 0.6); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  // ---- Full Theme Settings presets (every appearance selection) ----
  _themePresetItems() {
    const presets = (this.user?.theme?.themePresets) || [];
    if (!presets.length) return [{ kind: "empty", title: "No presets saved",
      sub: "Adjust Theme Settings, then choose “Save Theme Settings as a Preset…”.", icon: { sys: "icon_setting_item.png" } }];
    return presets.map((p, i) => ({ kind: "action", act: "theme_load", title: p.name,
      icon: { sys: "icon_setting_item.png" }, tpreset: p, opts: [{ act: `theme_delete::${i}`, label: "Delete Preset" }] }));
  }
  _saveThemePreset() {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Save Theme Preset", fields: [{ key: "name", label: "Preset Name", required: true }], submit: "Save" },
      (out) => { this.textForm.close(); this.overlay = null; this._commitThemePreset((out.name || "").trim()); },
      () => { this.textForm.close(); this.overlay = null; });
  }
  // all Theme Settings (not the themes in use), as a preset / Custom Theme keeps them
  _themeSnap() {
    const t = this.user.theme;
    return {
      backgroundColor: t.backgroundColor, iconColor: t.iconColor, iconStyle: t.iconStyle,
      waveColor: t.waveColor, dotColor: t.dotColor, monthColors: t.monthColors ?? null,
      wavesEnabled: t.wavesEnabled, dotsEnabled: t.dotsEnabled, wallpaper: t.wallpaper || null, overlay: t.overlay || null,
      chromaKey: t.chromaKey || null, chromaStrength: t.chromaStrength ?? null, wallpaperFit: t.wallpaperFit || null,
      font: t.font || null, fontSize: t.fontSize ?? null, textColor: t.textColor || null, clockColor: t.clockColor || null, clockIconColor: t.clockIconColor || null,
      bgShuffle: t.bgShuffle || null, ovShuffle: t.ovShuffle || null, bgInterval: t.bgInterval || null, ovInterval: t.ovInterval || null,
      psnStyle: t.psnStyle || null, homeStyle: t.homeStyle || null, customColors: { ...(t.customColors || {}) },
      waveParams: { ...(t.waveParams || {}) }, bgPlaylists: JSON.parse(JSON.stringify(this._bgPlaylists())),
    };
  }
  _commitThemePreset(name) {
    if (!name) return;
    const t = this.user.theme, snap = this._themeSnap();
    delete snap.bgPlaylists; delete snap.ovPlaylists;
    if (!t.themePresets) t.themePresets = [];
    const existing = t.themePresets.findIndex((p) => p.name === name);
    const entry = { name, theme: snap };
    if (existing >= 0) t.themePresets[existing] = entry; else t.themePresets.push(entry);
    this.audio.play("enter", 0.5); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _loadThemePreset(preset) {
    if (!preset || !preset.theme) { this.audio.play("error", 0.4); return; }
    this._applyThemeSnap(preset.theme);
  }
  // put Theme Settings in place and show them (redraw: also the menus)
  _applyThemeSnap(s, redraw = true) {
    const t = this.user.theme;
    Object.assign(t, {
      backgroundColor: s.backgroundColor, iconColor: s.iconColor, iconStyle: s.iconStyle,
      waveColor: s.waveColor, dotColor: s.dotColor, monthColors: s.monthColors ?? undefined,
      wavesEnabled: s.wavesEnabled, dotsEnabled: s.dotsEnabled, wallpaper: s.wallpaper || undefined, overlay: s.overlay || undefined,
      chromaKey: s.chromaKey || undefined, chromaStrength: s.chromaStrength ?? undefined, wallpaperFit: s.wallpaperFit || undefined,
      font: s.font || undefined, fontSize: s.fontSize ?? undefined, textColor: s.textColor || undefined, clockColor: s.clockColor || undefined, clockIconColor: s.clockIconColor || undefined,
      bgShuffle: s.bgShuffle || undefined, ovShuffle: s.ovShuffle || undefined, bgInterval: s.bgInterval || undefined, ovInterval: s.ovInterval || undefined,
      waveParams: { ...(s.waveParams || {}) },
    });
    if ("psnStyle" in s) t.psnStyle = s.psnStyle || undefined;
    if ("homeStyle" in s) t.homeStyle = s.homeStyle || undefined;
    if (s.customColors) t.customColors = { ...s.customColors };
    if (Array.isArray(s.bgPlaylists)) t.bgPlaylists = JSON.parse(JSON.stringify(s.bgPlaylists));
    if (Array.isArray(s.ovPlaylists)) t.ovPlaylists = JSON.parse(JSON.stringify(s.ovPlaylists));
    else if (Array.isArray(s.bgPlaylists)) delete t.ovPlaylists;   // (made before Overlay Playlists: see _bgPlaylists)
    // apply everything (same order/API as sign-in)
    this.wave.setColor(t.backgroundColor || "auto");
    if (t.waveParams) this.wave.applyWaveParams(t.waveParams);
    this._applyWaveStyle();
    applyIconColorVar(t.iconColor || "#ffffff");
    this._applyIconStyle();
    this._applyTextLook();
    this._applyWallpaper();
    this._restartRotation();
    this._persistUser();
    if (!redraw) return;
    this.audio.play("enter", 0.6);
    this._render(); this._onSelect();
  }
  _deleteThemePreset(idx) {
    const list = this.user?.theme?.themePresets;
    if (!list || idx < 0 || idx >= list.length) return;
    list.splice(idx, 1); this.audio.play("back", 0.5); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _deleteWavePreset(idx) {
    const u = this.user;
    if (!u.theme || !Array.isArray(u.theme.wavePresets)) return;
    u.theme.wavePresets.splice(idx, 1); this._persistUser(); this.audio.play("back", 0.5);
    // refresh the open Saved Presets submenu in place
    const lvl = this._level();
    lvl.items = this._wavePresetItems();
    lvl.sel = Math.min(lvl.sel, Math.max(0, lvl.items.length - 1));
    this._render(); this._onSelect();
  }
  _waveParamMeta(ctl) {
    const [, group, key] = ctl.split(":");
    const m = WAVE_PARAM_META.find((e) => e[0] === group && e[1] === key)
      ;
    if (!m) return null;
    // the smallest step: 1 for whole numbers, 0.01 (or finer) otherwise
    const dec = m[6] === 0 ? 0 : Math.max(2, m[6]);
    return { group, key, min: m[3], max: m[4], step: Math.min(m[5], 10 ** -dec), dec, labels: m[8] || null };
  }
  _waveParamValue(ctl) {
    const m = this._waveParamMeta(ctl); if (!m) return 0;
    const stored = this.user?.theme?.waveParams?.[`${m.group}:${m.key}`];
    const live = this.wave.getWaveParam ? this.wave.getWaveParam(m.group, m.key) : undefined;
    const v = stored != null ? stored : (live != null ? live : waveParamDefault(m.group, m.key));
    return Number(v) || 0;
  }
  _adjustWaveParam(it, dir) {
    const m = this._waveParamMeta(it.ctl); if (!m) return;
    // speed-up while held, capped at a 20th of the range per step
    let v = this._waveParamValue(it.ctl) + dir * m.step * holdAccel(it.ctl, (m.max - m.min) / 20 / m.step);
    v = Math.max(m.min, Math.min(m.max, v));
    // snap to the step grid to avoid float drift
    v = Math.round(v / m.step) * m.step;
    v = Math.max(m.min, Math.min(m.max, Number(v.toFixed(6))));
    const u = this.user;
    if (!u.theme.waveParams) u.theme.waveParams = {};
    u.theme.waveParams[`${m.group}:${m.key}`] = v;
    this.wave.setWaveParam(m.group, m.key, v);
    this.audio.play("cursor_up", 0.35); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _waveGroups() { return ["spline", "particle"]; }
  _dropActiveWaveParams() {
    const t = this.user.theme, gs = this._waveGroups(), out = {};
    for (const [k, v] of Object.entries(t.waveParams || {})) if (!gs.includes(k.split(":")[0])) out[k] = v;
    t.waveParams = out;
  }
  _resetWaveParams() {
    this._dropActiveWaveParams();
    this._applyWaveStyle();   // (defaults, the Visualizer Wave's when in use, then yours)
    this.audio.play("enter", 0.4); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight); this._onSelect();
  }
  _ctlValue(ctl) {
    if (ctl && ctl.startsWith("gm:")) return this._gmValue(ctl);
    if (ctl && ctl.startsWith("gmf:")) return this._gmfValue(ctl);
    if (ctl && ctl.startsWith("secft:")) return this._secftValue(ctl);
    if (ctl && ctl.startsWith("secfx:")) return this._secfxValue(ctl);
    if (ctl && ctl.startsWith("tho:")) return this._thoGet(ctl) ? "On" : "Off";
    if (ctl && ctl.startsWith("wp:")) {
      const m = this._waveParamMeta(ctl); if (!m) return "";
      if (m.labels) return m.labels[Math.round(this._waveParamValue(ctl))] || m.labels[0];
      return this._waveParamValue(ctl).toFixed(m.dec);
    }
    const u = this.user, s = this.settings;
    switch (ctl) {
      case "bgcolor": return colorName(u?.theme?.backgroundColor, true);
      case "font": { const f = u?.theme?.font; return f ? String(f).split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : "Default"; }
      case "fontsize": return `${u?.theme?.fontSize ?? 100}%`;
      case "textcolor": return colorName(u?.theme?.textColor, true);
      case "clockcolor": return colorName(u?.theme?.clockColor, true);
      case "clockiconcolor": return colorName(u?.theme?.clockIconColor, true);
      case "bgshuffle": case "ovshuffle": { const v = u?.theme?.[ctl === "bgshuffle" ? "bgShuffle" : "ovShuffle"] || "off";
        return v === "off" ? "Off" : v === "all" ? "All" : `Playlist: ${v.slice(3)}`; }
      case "bginterval": return fmtSecs(u?.theme?.bgInterval || 10);
      case "ovinterval": return fmtSecs(u?.theme?.ovInterval || u?.theme?.bgInterval || 10);
      case "bgfit": return (FIT_MODES.find((f) => f[0] === (u?.theme?.wallpaperFit || "normal")) || FIT_MODES[0])[1];
      case "chromakey": { const k = String(u?.theme?.chromaKey || "green").toLowerCase();
        return k === "green" ? "Green" : k === "blue" ? "Blue" : "Custom Color"; }
      case "iconcolor": return colorName(u?.theme?.iconColor, true);
      case "waves": return u?.theme?.[this._wk("wavesEnabled")] === false ? "Off" : "On";
      case "monthcolors": return u?.theme?.[this._wk("monthColors")] === false ? "Off" : "On";
      case "wavecolor": return colorName(u?.theme?.[this._wk("waveColor")], true);
      case "dots": return u?.theme?.[this._wk("dotsEnabled")] === false ? "Off" : "On";
      case "dotcolor": return colorName(u?.theme?.[this._wk("dotColor")], true);
      case "sfx": return u?.soundEnabled === false ? "Off" : "On";
      case "bgaudio": return s?.behavior?.playAudioBackground === false ? "Off" : "On";
      case "keepsongs": return s?.behavior?.keepPreloadedSongs ? "On" : "Off";
      case "mpvisualizer": return s?.behavior?.mpVisualizer === false ? "Off" : "On";
      case "gamenotitle": return s?.behavior?.gameHideTitle ? "On" : "Off";
      case "gameband": return s?.behavior?.gameBand === false ? "Off" : "On";
      case "keepvideos": return s?.behavior?.keepPreloadedVideos ? "On" : "Off";
      case "deltemp": return s?.behavior?.deleteTempFiles ? "On" : "Off";
      case "scrapeauto": return s?.scrape?.auto === false ? "Off" : "On";
      case "cacheapp": return s?.behavior?.cacheInAppDir ? "On" : "Off";
      case "friendmode": { const m = this._friendCfg().mode; return m === "fixed" ? "Fixed" : m === "range" ? "Range" : "Randomized"; }
      case "friendcount": return String(this._friendCfg().count);
      case "psplus": return this._friendCfg().playerPlus ? "On" : "Off";
      case "friendmin": return String(this._friendCfg().min);
      case "friendmax": return String(this._friendCfg().max);
      case "music": return u?.musicEnabled === false ? "Off" : "On";
      case "fullscreen": return s?.behavior?.fullscreen ? "On" : "Off";
      case "autostart": return s?.behavior?.autostart ? "On" : "Off";
      case "boot": return s?.behavior?.bootAnimation ? "On" : "Off";
      case "startsound": return s?.behavior?.startupSound === false ? "Off" : "On";
      case "bufsound": return s?.behavior?.bufferingSound === true ? "On" : "Off";
      case "volume": return `${s?.behavior?.volume ?? 100}%`;
      case "musicvol": return `${s?.behavior?.musicVolume ?? 100}%`;
      case "sfxvol": return `${s?.behavior?.sfxVolume ?? 100}%`;
      case "bufvol": return `${s?.behavior?.bufferingVolume ?? 15}%`;
      case "brightness": return `${s?.behavior?.brightness ?? 100}%`;
      case "chroma": return (u?.theme?.chromaStrength ?? 0.5).toFixed(2);
      case "vsync": return s?.behavior?.vsync === false ? "Off" : "On";
      case "fpscap": return fpsCapLabel(s?.behavior?.fpsCap);
      case "stillwaves": return s?.behavior?.stillWaves ? "On" : "Off";
      case "nomenublur": return s?.behavior?.noMenuBlur ? "On" : "Off";
      case "lowpower": return s?.behavior?.lowPowerMode ? "On" : "Off";
      case "vkb": return s?.behavior?.virtualKeyboard === false ? "Off" : "On";
      case "iconstyle": return { default: "Default", glossy: "Glossy", flat: "Flat" }[this._iconStyle()];
      case "resolution": { const r = s?.behavior?.resolution || "native"; return r === "native" ? "Native" : r.replace("x", " × "); }
      case "psnstyle": return u?.theme?.psnStyle === "modern" ? "Modern Version" : "Original Version";
      case "homestyle": return u?.theme?.homeStyle === "modern" ? "Modern Version" : "Original Version";
      case "timeformat": return (s?.behavior?.timeFormat || "24") === "12" ? "12-Hour Clock" : "24-Hour Clock";
      case "dateformat": return s?.behavior?.dateFormat || "DD/MM/YYYY";
      case "sysinfo": return `v${this.appInfo?.version || "?"}\nMade by Maxi Bono`;
      // Intro Icon / Intro Title: the picture's file name, or Default
      case "introicon": case "introtitle": {
        const p = s?.behavior?.[ctl === "introicon" ? "introIcon" : "introTitle"];
        return p ? String(p).split(/[\\/]/).pop() : "Default";
      }
      default: return "";
    }
  }
  _toggleSetting(it) {
    const u = this.user, s = this.settings;
    if (it.ctl && it.ctl.startsWith("wp:")) { this._adjustWaveParam(it, 1); return; }
    if (it.ctl && it.ctl.startsWith("gm:")) { this._gmEdit(it.ctl); return; }
    if (it.ctl && it.ctl.startsWith("gmf:")) { this._gmfAdjust(it.ctl, 1); return; }
    if (it.ctl && it.ctl.startsWith("secft:")) { this._secftAdjust(it.ctl, 1); return; }
    if (it.ctl && it.ctl.startsWith("secfx:")) { this._secfxToggle(it.ctl); return; }
    if (it.ctl && it.ctl.startsWith("tho:")) { this._thoToggle(it.ctl); return; }
    switch (it.ctl) {
      case "bgcolor": case "iconcolor": case "wavecolor": case "dotcolor": case "chromakey": this._cycleColor(it, 1); return;
      case "bgfit": this._cycleBgFit(1); return;
      case "font": this._fontMenu(); return;
      case "fontsize": this._adjustFontSize(1); return;
      case "textcolor": case "clockcolor": case "clockiconcolor": this._cycleColor(it, 1); return;
      case "bgshuffle": case "ovshuffle": this._cycleShuffle(it.ctl, 1); return;
      case "bginterval": case "ovinterval": this._typeInterval(it); return;
      case "monthcolors": { const k = this._wk("monthColors"); u.theme[k] = u.theme[k] === false; this.wave.setMonthMode(u.theme[k]); this._persistUser(); break; }
      case "waves": { const k = this._wk("wavesEnabled"); u.theme[k] = u.theme[k] === false; this._applyWaveLook(); this._persistUser(); break; }
      case "dots": { const k = this._wk("dotsEnabled"); u.theme[k] = u.theme[k] === false; this._applyWaveLook(); this._persistUser(); break; }
      case "sfx": u.soundEnabled = u.soundEnabled === false; this.audio.enabled = u.soundEnabled; this._persistUser(); break;
      case "bgaudio": s.behavior.playAudioBackground = s.behavior.playAudioBackground === false; this.audio.playInBackground = s.behavior.playAudioBackground; this._persistSettings(); break;
      case "keepsongs": s.behavior.keepPreloadedSongs = !s.behavior.keepPreloadedSongs; this._persistSettings(); break;
      case "mpvisualizer": s.behavior.mpVisualizer = s.behavior.mpVisualizer === false; this._persistSettings(); this._syncVisualizer(); break;
      case "gamenotitle": s.behavior.gameHideTitle = !s.behavior.gameHideTitle; this._persistSettings(); this._render(); this._onSelect(); break;
      case "gameband": s.behavior.gameBand = s.behavior.gameBand === false; this._persistSettings(); this._render(); this._onSelect(); break;
      case "keepvideos": s.behavior.keepPreloadedVideos = !s.behavior.keepPreloadedVideos; this._persistSettings(); break;
      case "deltemp": s.behavior.deleteTempFiles = !s.behavior.deleteTempFiles; this._persistSettings(); break;
      case "scrapeauto": this._scrapeCfg().auto = s.scrape.auto === false; this._persistSettings(); break;
      case "cacheapp": s.behavior.cacheInAppDir = !s.behavior.cacheInAppDir; this._persistSettings(); break;
      case "music": u.musicEnabled = u.musicEnabled === false; this.audio.musicEnabled = u.musicEnabled; this._applyBgMusic(); this._persistUser(); break;
      case "fullscreen": s.behavior.fullscreen = !s.behavior.fullscreen; call("set_fullscreen", { enable: s.behavior.fullscreen }); this.cbs.onFullscreen && this.cbs.onFullscreen(s.behavior.fullscreen); this._persistSettings();
        setTimeout(() => this._applyResolution(), 350); break;
      case "resolution": this._cycleResolution(1); return;
      case "iconstyle": this._cycleIconStyle(1); return;
      case "lowpower": s.behavior.lowPowerMode = !s.behavior.lowPowerMode; this._persistSettings();
        { const lvl = this._inGame ? 2 : (document.hasFocus() ? 0 : 1); this._lowPower = -1; this.setLowPower(lvl); } break;
      case "vkb": s.behavior.virtualKeyboard = s.behavior.virtualKeyboard === false; VIRTUAL_KB.on = s.behavior.virtualKeyboard; this._persistSettings(); break;
      case "autostart": s.behavior.autostart = !s.behavior.autostart; call("set_autostart", { enable: s.behavior.autostart }); this._persistSettings(); break;
      case "boot": s.behavior.bootAnimation = !s.behavior.bootAnimation; this._persistSettings(); break;
      case "startsound": s.behavior.startupSound = s.behavior.startupSound === false; this._persistSettings(); break;
      case "bufsound": s.behavior.bufferingSound = s.behavior.bufferingSound !== true; this.audio.setBuffering(s.behavior.bufferingSound); this._persistSettings(); break;
      case "psplus": {   // the player's own PS Plus mark (card + info box); friends stay as they are
        const c = this._friendCfg(); c.playerPlus = !c.playerPlus; u.friendConfig = c; this._persistUser();
        this.audio.play("enter", 0.4); break;
      }
      case "volume": this._adjustVolume(1); return;
      case "musicvol": this._adjustMusicVol(1); return;
      case "sfxvol": this._adjustSfxVol(1); return;
      case "bufvol": this._adjustBufVol(1); return;
      case "brightness": this._adjustBrightness(1); return;
      case "chroma": this._adjustChroma(1); return;
      case "vsync": s.behavior.vsync = s.behavior.vsync === false; this._persistSettings(); this._applyVsync(); break;
      case "fpscap": { const i = FPS_CAPS.indexOf(fpsCapOf(s.behavior.fpsCap));
        s.behavior.fpsCap = FPS_CAPS[(i + 1) % FPS_CAPS.length]; this._persistSettings(); this._applyPerformance(); break; }
      case "stillwaves": s.behavior.stillWaves = !s.behavior.stillWaves; this._persistSettings(); this._applyPerformance(); break;
      case "nomenublur": s.behavior.noMenuBlur = !s.behavior.noMenuBlur; this._persistSettings(); this._applyPerformance(); break;
      case "psnstyle": u.theme.psnStyle = u.theme.psnStyle === "modern" ? "original" : "modern"; this._persistUser(); this._applyPsnStyle(); break;
      case "homestyle": u.theme.homeStyle = u.theme.homeStyle === "modern" ? "original" : "modern"; this._persistUser(); this._applyHomeStyle(); break;
      case "friendmode": this._adjustFriendSetting(it.ctl, 1); return;
      case "friendcount": case "friendmin": case "friendmax": this._typeFriendNumber(it); return;
      case "timeformat": s.behavior.timeFormat = (s.behavior.timeFormat || "24") === "12" ? "24" : "12"; this.cbs.onTimeFormat && this.cbs.onTimeFormat(s.behavior.timeFormat); this._persistSettings(); break;
      case "dateformat": {
        const opts = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD"];
        const i = (opts.indexOf(s.behavior.dateFormat || "DD/MM/YYYY") + 1) % opts.length;
        s.behavior.dateFormat = opts[i]; this.cbs.onDateFormat && this.cbs.onDateFormat(s.behavior.dateFormat); this._persistSettings(); break;
      }
      case "sysinfo": return;
    }
    this.audio.play("enter", 0.4);
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  // Apply the wave and the user's saved
  // Wave and Sparkles Personalization params to the running renderer.
  _applyWaveStyle() {
    const t = this.user?.theme || {}, player = this._visPlayer(), bg = this._bgLook(), wl = this._waveLook();
    this._lookApplied = this._lookKey();
    this.wave.setStyle("real");
    this.wave.resetWaveParams();               // start from defaults…
    if (bg) this.wave.applyWaveParams(bg.params);   // (a Background Color's own gradient)
    if (wl) this.wave.applyWaveParams(wl.params);   // (the Visualizer Wave's wave and sparkles)
    if (t.waveParams && !player) this.wave.applyWaveParams(t.waveParams);  // …then the user's overrides
    this._applyWaveLook();
  }
  // the Music Player showing the Visualizer Wave (Music Settings > Music Player Visualizer Wave)
  _visPlayer() { return !!this._inMusicPlayer && this.settings?.behavior?.mpVisualizer !== false; }
  // the background's own look: a colour square, or the Visualizer Wave (null: Original, a custom colour)
  _bgLook() {
    if (this._visPlayer()) return VISUALIZER_BG;
    if (!this.user) return null;
    const c = this._tcol("backgroundColor");
    return c === "visualizer" ? VISUALIZER_BG : squareLook(c);
  }
  // Wave Color > Visualizer Wave: its wave and sparkles
  _waveLook() {
    if (this._visPlayer()) return VISUALIZER_WAVE;
    return this.user && this._tcol("waveColor") === "visualizer" ? VISUALIZER_WAVE : null;
  }
  _lookKey() { return [this._visPlayer(), this._bgLook()?.params?.["spline:bgTopR"] ?? "", this._bgLook()?.swatch ?? (this._bgLook() ? "vis" : ""), !!this._waveLook()].join("|"); }
  // after a change of Background / Wave Color or the Music Player opening or
  // closing: the wave set up again when its look changes
  _syncVisualizer() {
    document.body.classList.toggle("mpvis", this._visPlayer());
    if (this._lookKey() !== this._lookApplied) this._applyWaveStyle();
  }
  // (there is one wave style now; kept as a helper so the setting code stays simple)
  _wk(prop) { return prop; }
  // The old "Default" wave style is gone: the first time a user signs in, the
  // wave settings they had for "Complex" become the settings, and the old
  // Default-style ones are dropped.
  _migrateWaveSettings() {
    const t = this.user?.theme;
    if (!t || t.waveV2) return;
    // the old Default style's Wave and Sparkles Personalization values and presets go
    if (t.waveParams) for (const k of Object.keys(t.waveParams)) if (!/^(spline|particle):/.test(k)) delete t.waveParams[k];
    if (Array.isArray(t.wavePresets)) t.wavePresets = t.wavePresets.filter((p) => Object.keys(p.params || {}).some((k) => /^(spline|particle):/.test(k)))
      .map((p) => ({ name: p.name, params: Object.fromEntries(Object.entries(p.params).filter(([k]) => /^(spline|particle):/.test(k))) }));
    delete t.waveStyle; t.waveV2 = true; this._persistUser();
  }
  // v3: a Background Color's gradient is now shaded like Auto's; the old
  // default Gradient Top / Bottom (0.09 / 0.62, a near-black top) go back to
  // the new defaults (values someone changed by hand stay)
  _migrateWaveV3() {
    const t = this.user?.theme;
    if (!t || t.waveV3) return;
    const wp = t.waveParams || {};
    if (wp["spline:gradientTopMul"] === 0.09) delete wp["spline:gradientTopMul"];
    if (wp["spline:gradientBotMul"] === 0.62) delete wp["spline:gradientBotMul"];
    for (const p of t.wavePresets || []) {
      const q = p.params || {};
      if (q["spline:gradientTopMul"] === 0.09) delete q["spline:gradientTopMul"];
      if (q["spline:gradientBotMul"] === 0.62) delete q["spline:gradientBotMul"];
    }
    t.waveV3 = true; this._persistUser();
  }
  _applyWaveLook() {
    const t = this.user?.theme || {};
    if (this._visPlayer()) {
      this.wave.setWaveColor(VISUALIZER_WAVE.wave); this.wave.setDotColor(VISUALIZER_WAVE.dot);
      this.wave.setWavesEnabled(true); this.wave.setDotsEnabled(true); this.wave.setMonthMode(false);
      return;
    }
    // Original: the Visualizer Wave's (Wave Color > Visualizer Wave), or the
    // background's own tint (a colour square's; the month's; with the Visualizer
    // Wave background, drawn from it)
    const bg = this._bgLook(), wl = this._waveLook();
    const own = (k) => { const c = this._tcol(k); return !c || c === "auto" || c === "visualizer" ? null : c; };
    this.wave.setWaveColor(own("waveColor") || wl?.wave || bg?.wave || "auto");
    this.wave.setWavesEnabled(t.wavesEnabled !== false && customizationOn("waves"));
    // (Sparkles Color > Visualizer: the Visualizer Wave's sparkles)
    this.wave.setDotColor(this._tcol("dotColor") === "visualizer" ? VISUALIZER_WAVE.dot : (own("dotColor") || wl?.dot || bg?.dot || "auto"));
    this.wave.setDotsEnabled(t.dotsEnabled !== false && customizationOn("sparkles"));
    // Original: always the month's colour, brighter by day and darker by night
    this.wave.setMonthMode(!bg);
  }
  // Theme colour settings cycle through their named colours, "Auto" (where it
  // exists) and "Custom Color", which opens the colour wheel picker.
  _themeColorProp(ctl) { return { bgcolor: "backgroundColor", wavecolor: this._wk("waveColor"), dotcolor: this._wk("dotColor"), iconcolor: "iconColor", chromakey: "chromaKey", textcolor: "textColor", clockcolor: "clockColor", clockiconcolor: "clockIconColor" }[ctl]; }
  _ccKey(ctl) { return ctl; }
  _applyThemeColor(ctl, hex) {
    const u = this.user;
    u.theme[this._themeColorProp(ctl)] = hex;
    if (ctl === "bgcolor") {
      // (the background picture and overlay stay: they have their own None
      // option; a see-through colour (Opacity < 1) tints over the picture)
      this._applyWallpaper();
    } else if (ctl === "chromakey") this._applyWallpaper();
    else if (ctl === "textcolor" || ctl === "clockcolor" || ctl === "clockiconcolor") this._applyTextLook();
    else if (ctl === "wavecolor" || ctl === "dotcolor") { this._syncVisualizer(); this._applyWaveLook(); }
    else { applyIconColorVar(hex); this._applyXmbwShading(); }
  }
  // ---- every setting is changed from its option (△) menu ------------------
  // ✕ or △ on a setting opens the PS3 option menu down the right: its choices
  // with the current one highlighted; a number gets one row that up / down
  // change (○ puts it back); a typed value gets one row with the value, ✕ types.
  _settingMenu(it) {
    const ctl = it.ctl || "";
    if (ctl === "sysinfo") { this.audio.play("error", 0.4); return; }
    if (ctl === "font") { this._fontMenu(); return; }
    if (ctl === "introicon" || ctl === "introtitle") { this._introArtMenu(ctl === "introicon" ? "icon" : "title"); return; }
    const close = () => { this.sideMenu.close(); this.overlay = null; };
    const relayout = () => this._layoutItems(this.root.clientWidth, this.root.clientHeight);
    const num = this._settingNumber(ctl);
    if (num) {
      const before = num.get();
      this.overlay = this.sideMenu;
      this.sideMenu.open([{ label: "" }], { title: it.title, spin: { label: () => this._ctlValue(ctl), step: (d) => num.step(d),
          // the arrow on a side disappears at the minimum / maximum
          canUp: () => num.max == null || num.get() < num.max - 1e-9, canDown: () => num.min == null || num.get() > num.min + 1e-9 } },
        () => { close(); relayout(); },
        () => { close(); if (num.get() !== before) { num.set(before); } relayout(); });
      return;
    }
    const ch = this._settingChoices(it);
    if (ch) {
      this.overlay = this.sideMenu;
      this.sideMenu.open(ch.items.map((c) => ({ label: c.label, swatch: c.swatch })), { title: it.title, sel: Math.max(0, ch.cur), swatches: !!ch.swatches },
        (_c, i) => { close(); const c = ch.items[i]; if (c && i !== ch.cur || c && c.always) c.apply(); relayout(); },
        () => close());
      return;
    }
    // typed values (Title, Created, Picture Duration, number of friends…):
    // the current value, then "Custom …" at the bottom to type a new one
    const what = this._customWhat(ctl), cur = this._ctlValue(ctl);
    const rows = (cur && cur !== "-") ? [{ label: cur, keep: true }] : [];
    rows.push({ label: `Custom ${what}\u2026` });
    this.overlay = this.sideMenu;
    this.sideMenu.open(rows, { title: it.title },
      (c) => { close(); if (!c.keep) this._toggleSetting(it); }, () => close());
  }
  // what a typed setting's "Custom …" option asks for
  _customWhat(ctl) {
    const k = ctl.startsWith("gm:") ? (this._gmParse(ctl) || {}).key : ctl;
    return { title: "Title", created: "Date", starts: "Date", size: "Size", version: "Version", bginterval: "Duration",
      friendcount: "Number", friendmin: "Number", friendmax: "Number" }[k] || "Value";
  }
  // a Console typed in (any name; one that isn't in the list gets the blank
  // badge with its name written on)
  _askConsole(title, cur, done) {
    this.overlay = this.textForm;
    this.textForm.open({ title: `${title}: Custom Console`, fields: [{ key: "c", label: "Console", value: cur && !CONSOLES.includes(cur) ? cur : "", required: true }], submit: "Confirm" },
      (out) => { this.textForm.close(); this.overlay = null; const v = String(out.c || "").trim(); if (v) done(v); },
      () => { this.textForm.close(); this.overlay = null; });
  }
  _consoleChoices(title, cur, set) {
    const names = [...CONSOLES];
    if (cur && cur !== "Mixed" && cur !== "-" && !names.includes(cur)) names.push(cur);   // a typed-in one stays a choice
    const items = names.map((c) => ({ label: c, apply: () => set(c) }));
    items.push({ label: "Custom Console\u2026", always: true, apply: () => this._askConsole(title, cur, set) });
    return { items, cur: names.indexOf(cur) };
  }
  // number settings: { get, set, step }
  _settingNumber(ctl) {
    const b = this.settings?.behavior || {}, t = this.user?.theme || {};
    const beh = (key, def, apply) => ({ min: 0, max: 100, get: () => b[key] ?? def, set: (v) => { b[key] = v; apply && apply(v); this._persistSettings(); } });
    switch (ctl) {
      case "volume": return { ...beh("volume", 100, (v) => this.audio.setMasterVolume(v / 100)), step: (d) => this._adjustVolume(d) };
      case "musicvol": return { ...beh("musicVolume", 100, (v) => this.audio.setMusicVolume(v / 100)), step: (d) => this._adjustMusicVol(d) };
      case "sfxvol": return { ...beh("sfxVolume", 100, (v) => this.audio.setSfxVolume(v / 100)), step: (d) => this._adjustSfxVol(d) };
      case "bufvol": return { ...beh("bufferingVolume", 15, (v) => this.audio.setBufferingVolume(v / 100)), step: (d) => this._adjustBufVol(d) };
      case "brightness": return { ...beh("brightness", 100, (v) => this._applyBrightness(v)), step: (d) => this._adjustBrightness(d) };
      case "chroma": return { min: 0, max: 1, get: () => t.chromaStrength ?? 0.5, set: (v) => { t.chromaStrength = v; this._applyWallpaper(); this._persistUser(); }, step: (d) => this._adjustChroma(d) };
      case "fontsize": return { min: 0, max: 300, get: () => t.fontSize ?? 100, set: (v) => { t.fontSize = v; this._persistUser(); this._applyTextLook(); }, step: (d) => this._adjustFontSize(d) };
    }
    if (ctl.startsWith("wp:")) {
      const m = this._waveParamMeta(ctl); if (!m || m.labels) return null;
      return { min: m.min, max: m.max, get: () => this._waveParamValue(ctl),
        set: (v) => { (t.waveParams ||= {})[`${m.group}:${m.key}`] = v; this.wave.setWaveParam(m.group, m.key, v); this._persistUser(); },
        step: (d) => this._adjustWaveParam({ ctl }, d) };
    }
    return null;
  }
  // option lists: { items: [{ label, apply, always? }], cur }
  _settingChoices(it) {
    const ctl = it.ctl || "", u = this.user, s = this.settings, b = s?.behavior || {}, t = u?.theme || {};
    const cur = this._ctlValue(ctl);
    const list = (pairs, now, set) => ({ items: pairs.map(([id, label]) => ({ label, apply: () => set(id) })), cur: pairs.findIndex((p) => p[0] === now) });
    // the colour settings: the named colours, the last custom colour, the colour wheel
    if (["bgcolor", "iconcolor", "wavecolor", "dotcolor", "chromakey", "textcolor", "clockcolor", "clockiconcolor"].includes(ctl)) {
      const isKey = ctl === "chromakey", prop = this._themeColorProp(ctl), saved = this._savedCustom(ctl);
      const now = String(t[prop] || (isKey ? "green" : "auto")).toLowerCase();
      const items = colorListFor(ctl).map((c) => ({ label: c.name, hex: c.hex, swatch: c.swatch }));
      if (saved && !items.some((c) => String(c.hex).toLowerCase() === String(saved).toLowerCase()))
        items.push({ label: `Custom Color (${String(saved).toUpperCase()})`, hex: saved });
      // Background Color: the console's Color menu (Original, then the colour
      // squares; Custom Color… at the end); the others by name
      const sq = SQUARE_CTLS.includes(ctl);
      const out = items.map((c) => ({ label: c.label, swatch: sq && c.hex !== "auto" && c.hex !== "visualizer" ? (c.swatch || c.hex) : null,
        apply: () => { this.audio.play("cursor_up", 0.4); this._applyThemeColor(ctl, c.hex); this._persistUser(); } }));
      out.push({ label: "Custom Color…", always: true, apply: () => this._customColor(it, t[prop]) });
      return { items: out, cur: items.findIndex((c) => String(c.hex).toLowerCase() === now), swatches: sq };
    }
    if (ctl.startsWith("wp:")) {
      const m = this._waveParamMeta(ctl);
      if (m && m.labels) return list(m.labels.map((l, i) => [i, l]), Math.round(this._waveParamValue(ctl)),
        (v) => { (t.waveParams ||= {})[`${m.group}:${m.key}`] = v; this.wave.setWaveParam(m.group, m.key, v); this._persistUser(); });
    }
    if (ctl.startsWith("gmf:")) return this._consoleChoices(it.title, cur, (v) => this._gmfSet(ctl, v));
    if (ctl.startsWith("secft:")) return this._secftChoices(ctl);
    if (ctl.startsWith("gm:")) {
      const p = this._gmParse(ctl), g = p && this._gameByFolder(p.folder);
      if (!g) return null;
      if (p.key === "console") return this._consoleChoices(gameName(g), g.console || "PS3", (v) => { g.console = v; this._gmSave(g.folder, { console: v }); });
      if (p.key === "parentalControl") return list([[0, "-"], ...Array.from({ length: 11 }, (_, i) => [i + 1, `Level ${i + 1}`])], g.parentalControl || 0,
        (v) => { g.parentalControl = v || null; this._gmSave(g.folder, { parentalControl: v || null }); });
      if (!["isDisc", "optionsBand", "hideTitle"].includes(p.key)) return null;
    }
    // On / Off and the other two-way settings flip when the other one is chosen
    // (settings with a list of their own that can read "Off" aren't two-way)
    const listed = ["bgshuffle", "ovshuffle"].includes(ctl);
    const two = { timeformat: ["12-Hour Clock", "24-Hour Clock"], psnstyle: ["Original Version", "Modern Version"], homestyle: ["Original Version", "Modern Version"] }[ctl]
      || (!listed && (cur === "On" || cur === "Off") ? ["On", "Off"] : null);
    if (two) return { items: two.map((label) => ({ label, apply: () => { if (this._ctlValue(ctl) !== label) this._toggleSetting(it); } })), cur: two.indexOf(cur) };
    switch (ctl) {
      case "dateformat": return list(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD"].map((f) => [f, f]), b.dateFormat || "DD/MM/YYYY",
        (v) => { b.dateFormat = v; this.cbs.onDateFormat && this.cbs.onDateFormat(v); this._persistSettings(); });
      case "iconstyle": return list([["default", "Default"], ["glossy", "Glossy"], ["flat", "Flat"]], this._iconStyle(),
        (v) => { t.iconStyle = v; this._persistUser(); this._applyIconStyle(); this._render(); this._onSelect(); });
      case "fpscap": return list(FPS_CAPS.map((c) => [c, fpsCapLabel(c)]), fpsCapOf(b.fpsCap),
        (v) => { b.fpsCap = v; this._persistSettings(); this._applyPerformance(); });
      case "resolution": return list(RESOLUTIONS.map((r) => [r, r === "native" ? "Native" : r.replace("x", " × ")]), b.resolution || "native",
        (v) => { b.resolution = v; this._persistSettings(); this._applyResolution(); });
      case "bgfit": return list(FIT_MODES.map((f) => [f[0], f[1]]), t.wallpaperFit || "normal",
        (v) => { t.wallpaperFit = v; this._persistUser(); this._fitWallpaper(); });
      case "bgshuffle": case "ovshuffle": {
        const key = ctl === "bgshuffle" ? "bgShuffle" : "ovShuffle";
        return list([["off", "Off"], ["all", "All"], ...this._bgPlaylists(ctl === "bgshuffle" ? "bg" : "ov").map((p) => [`pl:${p.name}`, `Playlist: ${p.name}`])], t[key] || "off",
          (v) => { t[key] = v; this._persistUser(); this._restartRotation(); });
      }
      case "friendmode": return list([["random", "Randomized"], ["fixed", "Fixed"], ["range", "Range"]], this._friendCfg().mode,
        (v) => { this._friendPersistCfg((c) => { c.mode = v; }); this._rebuildFriendMenuLevel(); });
    }
    return null;
  }
  // the last custom colour picked for each colour setting is remembered, so it
  // stays one of the choices after switching to a named colour
  _savedCustom(ctl) { return (this.user.theme.customColors || {})[this._ccKey(ctl)] || null; }
  _cycleColor(it, dir) {
    const u = this.user, prop = this._themeColorProp(it.ctl);
    const saved = this._savedCustom(it.ctl);
    // (Icon Color "Auto" = the PS3 look: the glass takes the theme colour)
    const isKey = it.ctl === "chromakey";
    const list = [...colorListFor(it.ctl)];
    if (saved) list.push({ name: "Custom Color", hex: saved });
    const cur = u.theme[prop];
    let i = list.findIndex((c) => String(c.hex).toLowerCase() === String(cur || (isKey ? "green" : "auto")).toLowerCase());
    if (i < 0) i = 0;
    i = (i + dir + list.length) % list.length;
    this.audio.play("cursor_up", 0.4);
    this._applyThemeColor(it.ctl, list[i].hex);
    this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _customColor(it, cur) {
    const prev = cur;
    this._wpBeforePick = this.user.theme.wallpaper;
    const start = parseColor(cur) ? cur : (this._savedCustom(it.ctl) || (it.ctl === "chromakey" ? "#00b140" : "#ffffff"));
    const back = this.overlay;
    this.overlay = this.colorPicker;
    this.colorPicker.open({ title: `${it.title}: Custom Color`, value: start,
      onPreview: (hex) => this._applyThemeColor(it.ctl, hex) },
      (hex) => { this.overlay = back; document.body.classList.remove("menu-open");
        this.user.theme.customColors = { ...(this.user.theme.customColors || {}), [this._ccKey(it.ctl)]: hex };
        this._applyThemeColor(it.ctl, hex); this._persistUser();
        this._layoutItems(this.root.clientWidth, this.root.clientHeight); },
      () => { this.overlay = back; document.body.classList.remove("menu-open");
        this.user.theme.wallpaper = this._wpBeforePick ?? this.user.theme.wallpaper;
        this._applyThemeColor(it.ctl, prev || (it.ctl === "chromakey" ? "green" : "auto"));
        this._layoutItems(this.root.clientWidth, this.root.clientHeight); });
  }
  // XMBW is the only icon style: the masked icons are replaced with the shaded
  // glass material (XMP normal-mapped look). Full-colour brand icons are
  // unaffected.
  // ---- PS3 Themes, Custom Themes and Icon Themes ----------------------------
  // The themes found (the Themes and Icon folders), read again each time
  // their menus open, so themes added while the system runs show up.
  async _loadThemes() {
    const [p3t, icon, custom, sound] = await Promise.all([call("themes_p3t").catch(() => []), call("themes_icon").catch(() => []),
      call("themes_custom").catch(() => []), call("themes_sound").catch(() => [])]);
    const arr = (v) => (Array.isArray(v) ? v : []);
    this._themeLists = { p3t: arr(p3t), icon: arr(icon), custom: arr(custom), sound: arr(sound) };
    return this._themeLists;
  }
  // Theme Settings > Reset Theme Settings: every Theme Setting back to its
  // default (after an "Are you sure" question). Themes in use stop (without
  // bringing back the settings from before a Custom Theme); saved theme / wave
  // presets, Background / Overlay Playlists and remembered custom colours stay.
  _resetThemeSettings() {
    this.overlay = this.confirm;
    this.confirm.open("Are you sure you want to reset every Theme Setting to its default?", [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }], async (ch) => {
      this.confirm.close(); this.overlay = null;
      if (!ch || ch.id !== "yes") return;
      const t = this.user.theme;
      for (const kind of ["p3t", "icon", "custom", "sound"]) t[this._themeProp(kind)] = null;
      delete t.customBackup; delete t.waveStyle;
      this.wave.resetWaveParams && this.wave.resetWaveParams();
      this._applyThemeSnap({
        backgroundColor: "auto", iconColor: "auto", iconStyle: undefined, waveColor: "auto", dotColor: "auto", monthColors: undefined,
        wavesEnabled: true, dotsEnabled: true, wallpaper: null, overlay: null, chromaKey: null, chromaStrength: null, wallpaperFit: null,
        font: null, fontSize: null, textColor: null, clockColor: null, clockIconColor: null, bgShuffle: null, ovShuffle: null, bgInterval: null, ovInterval: null,
        waveParams: {}, psnStyle: null, homeStyle: null,
      }, false);
      this._persistUser();
      await this._runLocked("theme", "Please wait...", () => this._applyThemes(true).catch((e) => console.warn("theme", e)));
      this._applyPsnStyle(); this._applyHomeStyle();
      this.audio.play("enter", 0.6);
      this._render(); this._onSelect();
    }, () => { this.confirm.close(); this.overlay = null; });
  }
  _themeProp(kind) { return { p3t: "p3tTheme", icon: "iconTheme", custom: "customTheme", sound: "soundTheme" }[kind]; }
  _themeFind(kind, key) { return (this._themeLists?.[kind] || []).find((t) => t.key === key) || null; }
  // a theme's options, each as set in its menu or at its starting value
  _themeOpts(key) {
    const stored = ((this.user?.theme?.themeOpts) || {})[key] || {};
    return Object.fromEntries([...THEME_PARTS, ...THEME_OPTS].map(([k]) => [k, themeOpt(stored, k)]));
  }
  // A theme's icons loaded up front (as blob: copies, so they're drawn and
  // shaded like the system's own) and their shading made for the current Icon
  // Style and Color, so every menu shows them at once.
  async _themeIconUrls(th) {
    const cache = this._themeBlobs || (this._themeBlobs = new Map());
    const out = {};
    await Promise.all(Object.entries(th.icons || {}).map(async ([name, path]) => {
      let u = cache.get(path);
      if (!u) {
        try { u = URL.createObjectURL(await (await fetch(assetUrl(path))).blob()); cache.set(path, u); } catch (e) { return; }
      }
      try { await loadIconImage(u); out[name] = u; } catch (e) {}
    }));
    return out;
  }
  // Icon Set Transparency off: each picture with every see-through part made
  // solid (the edges stay smooth), kept for the next time
  async _solidIconUrls(icons) {
    const cache = this._solidBlobs || (this._solidBlobs = new Map());
    const out = {};
    await Promise.all(Object.entries(icons).map(async ([name, u]) => {
      let s = cache.get(u);
      if (!s) {
        try {
          const img = await loadIconImage(u);
          const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          const cx = cv.getContext("2d", { willReadFrequently: true });
          cx.drawImage(img, 0, 0);
          const id = cx.getImageData(0, 0, w, h), d = id.data;
          // (alpha x 6: faint glass becomes solid, the outermost edge pixels stay soft)
          for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, d[i] * 6);
          cx.putImageData(id, 0, 0);
          const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
          s = URL.createObjectURL(blob); cache.set(u, s);
          await loadIconImage(s);
        } catch (e) { s = u; }
      }
      out[name] = s;
    }));
    return out;
  }
  _preshadeTheme(layer) {
    if (!layer || document.documentElement.getAttribute("data-icons") !== "xmbw") return;
    const c = layer.opts.iconColor, s = layer.opts.iconStyle;
    if (!s) return;
    const st = this._iconStyle(), own = !c, rgb = own ? [1, 1, 1] : this._iconRgb();
    for (const [name, u] of Object.entries(layer.icons)) {
      const key = `t:${layer.key}|${name}${layer.opts.iconAlpha === false ? "|solid" : ""}${own ? "|own" : ""}`;
      const img = loadedIcon(u);
      if (img && !cachedShade(key, rgb, st)) { try { shadeIcon(img, rgb, key, st, own); } catch (e) {} }
    }
    this._xsScheduleSave(colorKey(rgb));
  }
  // Put the chosen themes in use: their icons, the PS3 theme's parts, the
  // Custom Theme's settings, and what their options turn off. rebuild: draw
  // the menus again (not at sign-in: they're built afterwards anyway); load:
  // read the folders first.
  async _applyThemes(rebuild = true, load = false) {
    const t = this.user?.theme || {};
    if (load || !this._themeLists) {
      // (unpacking a new theme takes a moment the first time)
      try { await this._loadThemes(); } catch (e) { this._themeLists = { p3t: [], icon: [], custom: [], sound: [] }; }
    }
    const pick = async (kind) => {
      const key = t[this._themeProp(kind)], th = key ? this._themeFind(kind, key) : null;
      if (!th) return null;
      // (a Custom Theme's icons are part of it: always shown as it was made)
      const opts = kind === "custom" ? { iconColor: true, iconStyle: true, waves: true, sparkles: true, background: true, overlay: true } : this._themeOpts(th.key);
      // (Transparency is an Icon Set's own option, Off to begin with; a PS3
      // theme's and a Custom Theme's icons stay see-through like the system's)
      if (kind !== "icon") opts.iconAlpha = true;
      // (an Icon Theme leaves the waves, sparkles, background and overlay alone)
      if (kind === "icon") Object.assign(opts, { waves: true, sparkles: true, background: true, overlay: true });
      // (a PS3 theme's background turned off: your own background and overlay take its place)
      if (kind === "p3t" && !opts.tBackground) Object.assign(opts, { background: true, overlay: true });
      const useIcons = kind !== "p3t" || opts.tIcons;
      let icons = useIcons ? await this._themeIconUrls(th) : {};
      // (an Icon Set with Transparency off: its pictures made fully solid first)
      if (opts.iconAlpha === false) icons = await this._solidIconUrls(icons);
      return { key: th.key, icons, opts, theme: th };
    };
    const [p, ic, cu] = await Promise.all([pick("p3t"), pick("icon"), pick("custom")]);
    setActiveThemes(p, ic, cu);
    for (const l of [p, ic, cu]) this._preshadeTheme(l);
    // the PS3 theme's own parts that are on
    const on = (part) => (p && p.opts[part] ? p.theme : null);
    if (!this.themeBg) this.themeBg = new ThemeBackground(document.getElementById("p3tbg"));
    // its background and its overlay (an animated theme's moving effects), each on or off
    const bgOn = !!on("tBackground"), ovOn = !!(on("tOverlay") && p.theme.scene);
    const layers = bgOn && ovOn ? "all" : bgOn ? (p.theme.scene ? "bg" : "all") : ovOn ? "ov" : null;
    this.themeBg.show(layers ? { ...p.theme, key: `${p.theme.key}|${layers}`, layers } : null);
    this._applyThemeSounds(on("tSounds"), cu?.theme, t.soundTheme ? this._themeFind("sound", t.soundTheme) : null);
    const col = on("tColor")?.color;
    this._themeColor = col == null ? null : (col >= 1 && col <= 12 ? MONTH_COLORS[col] : "auto");
    // the default folders take the theme's colour while its icons are shown
    // as they are (until your own Icon Color / Style is turned on)
    const root = document.documentElement;
    const ft = this._themeColor && p && !p.opts.iconColor && !p.opts.iconStyle
      ? (this._themeColor === "auto" ? MONTH_COLORS[new Date().getMonth() + 1] : this._themeColor) : null;
    if (ft) root.style.setProperty("--folder-tint", ft); else root.style.removeProperty("--folder-tint");
    // the info box's friends and message icons (an icon set can have them)
    const ibf = themeIcon("ib_friends.png");
    if (ibf) root.style.setProperty("--ib-friends-img", `url("${ibf.url}")`); else root.style.removeProperty("--ib-friends-img");
    const mail = document.querySelector(".ib-mail");
    if (mail) mail.src = sysUrl("icon_mbox.png");
    // the info box and the notification box: the theme's box and its colour
    const nt = on("tInfoBox")?.notification, nc = on("tClock")?.notification;
    this._themeInfoColor = nt ? await this._pictureColor(assetUrl(nt)) : null;
    // (the clock: the same colour, its own option)
    this._themeClockColor = nc ? (nc === nt ? this._themeInfoColor : await this._pictureColor(assetUrl(nc))) : null;
    if (nt) { root.style.setProperty("--tnotify", `url("${assetUrl(nt)}")`); root.classList.add("tnotify"); }
    else { root.style.removeProperty("--tnotify"); root.classList.remove("tnotify"); }
    this._applyTextLook();
    this._applyWaveLook();
    this._applyWallpaper();
    if (!rebuild) return;
    // the menus again, with the icons as they are now (the open submenus stay)
    if (this.columns && !this.locked) {
      const cat = this.columns[this.selCat]?.id;
      await this._buildColumns({ reuseGames: true });
      const ci = this.columns.findIndex((c) => c.id === cat);
      if (ci >= 0) { this.selCat = ci; if (this.levels[0]) this.levels[0].items = this.columns[ci].items; }
    }
    for (const l of this.levels.slice(1)) if (l.rebuild) { l.items = l.rebuild(); l.sel = Math.max(0, Math.min(l.sel, l.items.length - 1)); }
    this._render(); this._onSelect();
  }
  // a picture's main colour (its visible pixels, averaged and brightened a little)
  async _pictureColor(url) {
    try {
      const blob = await (await fetch(url)).blob(), img = await createImageBitmap(blob);
      const cv = document.createElement("canvas"); cv.width = 32; cv.height = 32;
      const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a; }
      if (n < 1) return null;
      const m = Math.max(r, g, b) / n, k = m > 0 ? Math.min(2.2, 220 / m) : 1;
      const h = (v) => Math.round(Math.min(255, v / n * k)).toString(16).padStart(2, "0");
      return `#${h(r)}${h(g)}${h(b)}`;
    } catch (e) { return null; }
  }
  // The sounds in use, by name (cursor, enter, back, coldboot, error, ok,
  // options) → file: a PS3 theme's (its Sounds part), then a Custom Theme's,
  // then a Sound Effects pack's, each over the one before.
  _soundFiles(p3t, custom, pack) {
    const PS3 = { se_cursor: "cursor", se_decide: "enter", se_cancel: "back", se_optionmenu: "options", se_system_ok: "ok" };
    const out = {};
    for (const [id, path] of Object.entries(p3t?.sounds || {})) if (PS3[id]) out[PS3[id]] = path;
    for (const l of [custom, pack]) for (const [n, path] of Object.entries(l?.sounds || {})) out[n] = path;
    return out;
  }
  _applyThemeSounds(p3t, custom, pack) {
    const ROLES = { cursor: ["cursor_up", "cursor_down"], enter: ["enter"], back: ["back"], options: ["options"], ok: ["ok"], error: ["error"] };
    const files = this._soundFiles(p3t, custom, pack), map = {};
    for (const [n, path] of Object.entries(files)) for (const r of ROLES[n] || []) map[r] = assetUrl(path);
    // (error is the enter sound: a pack's / Custom Theme's enter sound is its error sound too, unless it has one)
    const own = { ...(custom?.sounds || {}), ...(pack?.sounds || {}) };
    if (own.enter && !own.error) map.error = assetUrl(own.enter);
    this.audio.setThemeSounds(Object.keys(map).length ? map : null);
    // the startup sound plays before anyone signs in: the last user's is kept for the next start
    if (this.user && this.settings) {
      const b = (this.settings.behavior ||= {}), boot = files.coldboot || null;
      if ((b.bootSoundFile || null) !== boot) { if (boot) b.bootSoundFile = boot; else delete b.bootSoundFile; this._persistSettings(); }
    }
  }
  // a colour setting as it is now: the theme's colour (its Theme Color option) or yours
  _tcol(prop) { return this._themeColor != null ? this._themeColor : this.user?.theme?.[prop]; }
  _themeListItems(kind) {
    const SI = { sys: "icon_setting_item.png" };
    const lists = this._themeLists || { p3t: [], icon: [], custom: [], sound: [] };
    // read again in the background: a theme added meanwhile appears
    if (!this._themesLoading) {
      this._themesLoading = this._loadThemes().then((l) => {
        this._themesLoading = null;
        const lvl = this._level();
        const keys = (a) => (a || []).map((x) => x.key + "|" + x.name).join("/");
        if (lvl && lvl.items && lvl.items.kindList === kind && keys(lists[kind]) !== keys(l[kind])) this._rebuildLevel(() => this._themeListItems(kind));
      }).catch(() => { this._themesLoading = null; });
    }
    const list = lists[kind] || [], cur = this.user?.theme?.[this._themeProp(kind)] || null;
    const out = list.map((t) => ({
      kind: "drill", title: t.name, icon: t.thumb ? { art: assetUrl(t.thumb) } : SI,
      sub: [cur === t.key ? "In use." : "", kind === "p3t" ? [t.author, t.comment].filter(Boolean).join("\n")
        : kind === "custom" ? (t.author || "") : kind === "sound" ? `${Object.keys(t.sounds || {}).length} sounds`
        : `${Object.keys(t.icons || {}).length} icons`].filter(Boolean).join("\n"),
      childrenFn: () => this._themeMenu(kind, t.key),
    }));
    if (kind === "custom") out.unshift({ kind: "action", act: "theme_custom_create", title: "Create Custom Theme", icon: SI,
      sub: "Save your current Theme settings as a full custom theme." });
    if (!list.length) out.push({ kind: "ph", title: { p3t: "No PS3 Themes", icon: "No Icon Sets", custom: "No Custom Themes", sound: "No Sound Effect Sets" }[kind], icon: SI,
      sub: { p3t: "Put PS3 theme files (.p3t) in the content\\Themes folder.",
        icon: "Put a folder of icons in the Icon folder, named like the system's icons (icon_game.png...), with a .json file giving the theme's name.",
        custom: "Put custom themes (.zip) in the content\\Themes folder.",
        sound: "Put a folder of sounds in the Sound Effects folder, named like the system's sounds (cursor, enter, back, coldboot...), with a .json file giving the pack's name." }[kind] });
    out.kindList = kind;
    return out;
  }
  _p3tThemeItems() { return this._themeListItems("p3t"); }
  _iconThemeItems() { return this._themeListItems("icon"); }
  _customThemeItems() { return this._themeListItems("custom"); }
  _soundThemeItems() { return this._themeListItems("sound"); }
  // a theme's own menu: use it (or stop), then (PS3 / Icon Themes) its own
  // parts (Theme Settings) and which of your settings stay on (Custom Settings)
  _themeMenu(kind, key) {
    const SI = { sys: "icon_setting_item.png" };
    const t = this._themeFind(kind, key);
    if (!t) return [{ kind: "ph", title: "This theme isn't in its folder any more.", icon: SI }];
    const on = this.user?.theme?.[this._themeProp(kind)] === key;
    const snd = kind === "sound";
    const what = { p3t: "Theme", custom: "Theme", icon: "Icon Set", sound: "Sound Effect Set" }[kind];
    const use = { kind: "action", act: `theme_use::${kind}::${key}`, title: on ? `Stop Using This ${what}` : `Use This ${what}`, icon: SI };
    if (kind === "custom" || snd) return [use];
    const setting = ([k, title, desc]) => ({ kind: "setting", ctl: `tho:${key}:${k}`, title, sub: desc, icon: SI });
    // an Icon Set: Icon Effects (its icons with your Icon Color / Icon Style,
    // and see-through like the others)
    if (kind === "icon") return [use, { kind: "drill", title: "Icon Effects", icon: SI, childrenFn: () => [
      { kind: "setting", ctl: `tho:${key}:iconColor`, title: "Icon Color", icon: SI,
        sub: "On: All icons in the set have the color selected on Theme Settings > Icon Color applied." },
      { kind: "setting", ctl: `tho:${key}:iconStyle`, title: "Icon Style", icon: SI,
        sub: "On: All icons in the set have the style selected on Theme Settings > Icon Style applied." },
      { kind: "setting", ctl: `tho:${key}:iconAlpha`, title: "Transparency", icon: SI },
    ] }];
    const items = [use];
    if (kind === "p3t") items.push({ kind: "drill", title: "Theme Settings", icon: SI, sub: "The parts of this theme to use, each On or Off.",
      childrenFn: () => THEME_PARTS.filter(([k]) => this._themeHasPart(t, k)).map(setting) });
    items.push({ kind: "drill", title: "Custom Settings", icon: SI, sub: "Which of your own Theme Settings stay on with this theme, each On or Off.",
      // (an Icon Theme only changes icons: just the icon settings)
      childrenFn: () => THEME_OPTS.filter(([k]) => k !== "iconAlpha" && (kind === "p3t" || k === "iconColor" || k === "iconStyle")).map(setting) });
    if (kind === "p3t") items.push({ kind: "action", act: `theme_extract::${key}`, title: "Extract Theme", icon: SI,
      sub: "Put everything this theme has (icons, background, preview, sounds, mouse pointers, notification box, animated scene and its textures) in a folder with its name, in the Themes Extracted folder." });
    return items;
  }
  _thoParse(ctl) { const r = ctl.slice(4), i = r.lastIndexOf(":"); return { key: r.slice(0, i), opt: r.slice(i + 1) }; }
  _thoGet(ctl) { const { key, opt } = this._thoParse(ctl); return this._themeOpts(key)[opt] !== false; }
  _themeHasPart(t, k) {
    return { tBackground: t.scene || !!t.background, tOverlay: !!t.scene, tIcons: Object.keys(t.icons || {}).length > 0, tSounds: Object.keys(t.sounds || {}).length > 0,
      tColor: t.color != null, tInfoBox: !!t.notification, tClock: !!t.notification }[k];
  }
  async _thoToggle(ctl) {
    const { key, opt } = this._thoParse(ctl), t = this.user.theme;
    const o = ((t.themeOpts ||= {})[key] ||= {});
    o[opt] = !this._themeOpts(key)[opt];
    this._persistUser();
    // only what a theme in use shows changes (the menus are drawn again when its icons change)
    if ([t.p3tTheme, t.iconTheme].includes(key)) {
      const icons = ["iconColor", "iconStyle", "iconAlpha", "tIcons", "tColor"].includes(opt);
      if (icons) await this._runLocked("theme", "Please wait...", () => this._applyThemes(true).catch((e) => console.warn("theme", e)));
      else await this._applyThemes(false);
    }
    this.audio.play("enter", 0.4);
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  async _themeUse(kind, key) {
    const t = this.user.theme, prop = this._themeProp(kind);
    const starting = t[prop] !== key;
    if (kind === "custom") {
      const th = this._themeFind("custom", key);
      if (starting && th) {
        // your own settings are kept, to come back when you stop using it
        if (!t.customTheme) t.customBackup = this._themeSnap();
        this._applyThemeSnap(this._customSettings(th), false);
      } else if (t.customBackup) { this._applyThemeSnap(t.customBackup, false); delete t.customBackup; }
    }
    t[prop] = starting ? key : null;
    this._persistUser();
    await this._runLocked("theme", starting ? "Applying the theme..." : "Please wait...", () => this._applyThemes(true).catch((e) => console.warn("theme", e)));
  }
  // a Custom Theme's settings, with its files where it was unpacked
  _customSettings(th) {
    const dir = th.dir, sep = dir.includes("\\") ? "\\" : "/";
    const fix = (v) => (typeof v === "string" && v.startsWith("file:") ? dir + sep + v.slice(5).split("/").join(sep) : v);
    const s = JSON.parse(JSON.stringify(th.settings || {}));
    for (const k of ["wallpaper", "overlay", "font"]) s[k] = fix(s[k]);
    for (const k of ["bgPlaylists", "ovPlaylists"]) if (Array.isArray(s[k])) for (const pl of s[k]) pl.items = (pl.items || []).map(fix);
    return s;
  }
  // Create Custom Theme: your Theme Settings and the files they use, as a .zip
  _createCustomTheme() {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Create Custom Theme", fields: [{ key: "name", label: "Theme Name", required: true }], submit: "Create" },
      async (out) => {
        this.textForm.close(); this.overlay = null;
        const name = String(out.name || "").trim(); if (!name) return;
        const snap = this._themeSnap(), files = {};
        const base = (p) => String(p).split(/[\\/]/).pop();
        const seen = new Map();   // (one copy of each file; same names get a number)
        const add = (p, dir) => {
          if (!p || /^(data:|blob:|https?:)/.test(p)) return p;
          if (seen.has(p)) return seen.get(p);
          let rel = `${dir}/${base(p)}`, n = 2;
          while (files[rel]) rel = `${dir}/${n++}-${base(p)}`;
          files[rel] = p; seen.set(p, `file:${rel}`); return `file:${rel}`;
        };
        snap.wallpaper = add(snap.wallpaper, "media"); snap.overlay = add(snap.overlay, "media"); snap.font = add(snap.font, "font");
        // the Background / Overlay Playlists the shuffles use come along with their files
        const used = (v) => (typeof v === "string" && v.startsWith("pl:") ? v.slice(3) : null);
        const take = (which, name) => this._bgPlaylists(which).filter((p) => p.name === name).map((p) => ({ ...p, items: (p.items || []).map((i) => add(i, "media")) }));
        snap.bgPlaylists = take("bg", used(snap.bgShuffle));
        snap.ovPlaylists = take("ov", used(snap.ovShuffle));
        // the icons in use from an Icon Theme / PS3 theme / Custom Theme
        for (const layer of [this._themeFind("custom", this.user.theme.customTheme), this._themeFind("p3t", this.user.theme.p3tTheme), this._themeFind("icon", this.user.theme.iconTheme)]) {
          if (!layer) continue;
          if (layer.key.startsWith("p3t:") && !this._themeOpts(layer.key).tIcons) continue;
          // (later layers come first; the players' icons go in their own folders)
          const PF = { mp: "Music Player", vp: "Video Player", pv: "Photo Viewer" };
          for (const [n, p] of Object.entries(layer.icons || {})) {
            const i = n.indexOf(":"), file = i > 0 ? `${PF[n.slice(0, i)] || n.slice(0, i)}/${n.slice(i + 1)}` : n;
            files[`icons/${file}`] = p;
          }
        }
        // the sounds in use (a PS3 theme's with its Sounds part on, a Custom Theme's, a Sound Effects pack's)
        const t = this.user.theme, p3 = this._themeFind("p3t", t.p3tTheme);
        const sounds = this._soundFiles(p3 && this._themeOpts(p3.key).tSounds ? p3 : null, this._themeFind("custom", t.customTheme), t.soundTheme ? this._themeFind("sound", t.soundTheme) : null);
        for (const [n, p] of Object.entries(sounds)) { const ext = (/\.([a-z0-9]+)$/i.exec(p) || [, "wav"])[1].toLowerCase(); files[`sounds/${n}.${ext}`] = p; }
        await this._runLocked("theme_custom_create", "Creating the theme...", async () => {
          try { await call("custom_theme_create", { name, settings: snap, files }); this._shotFeedback(`Theme "${name}" created`); }
          catch (e) { this.audio.play("error", 0.4); this._shotFeedback("The theme couldn't be created"); }
          await this._loadThemes();
          const lvl = this._level();
          if (lvl && lvl.items && lvl.items.kindList === "custom") this._rebuildLevel(() => this._themeListItems("custom"));
        });
      },
      () => { this.textForm.close(); this.overlay = null; });
  }
  async _extractTheme(key) {
    const th = this._themeFind("p3t", key);
    if (!th) return;
    await this._runLocked(`theme_extract::${key}`, "Extracting the theme...", async () => {
      try { await call("theme_extract", { dir: th.dir, name: th.name }); this._shotFeedback("Theme extracted to the Themes Extracted folder"); }
      catch (e) { this.audio.play("error", 0.4); this._shotFeedback("The theme couldn't be extracted"); }
    });
  }
  // Icon Style (Theme Settings): "default" (the matte XMB material), "glossy"
  // (glossy translucent glass) or "flat" (the plain icon, no shading)
  _iconStyle() {
    const v = this.user?.theme?.iconStyle;
    return v === "glossy" || v === "flat" ? v : "default";
  }
  async _applyIconStyle() {
    document.documentElement.setAttribute("data-icons", this._iconStyle() === "flat" ? "flat" : "xmbw");
    document.documentElement.setAttribute("data-istyle", this._iconStyle());
    await this._xsLoadSaved();
    this._applyXmbwShading();
  }
  _adjustVolume(dir) {
    const b = this.settings.behavior;
    let v = (b.volume ?? 100) + dir * holdAccel("volume", 5);
    v = Math.max(0, Math.min(100, v));
    b.volume = v; this.audio.setMasterVolume(v / 100);
    this.audio.play("cursor_up", 0.4);
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _adjustMusicVol(dir) {
    const b = this.settings.behavior;
    let v = Math.max(0, Math.min(100, (b.musicVolume ?? 100) + dir * holdAccel("musicvol", 5)));
    b.musicVolume = v; this.audio.setMusicVolume(v / 100);
    this.audio.play("cursor_up", 0.4);
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _adjustSfxVol(dir) {
    const b = this.settings.behavior;
    let v = Math.max(0, Math.min(100, (b.sfxVolume ?? 100) + dir * holdAccel("sfxvol", 5)));
    b.sfxVolume = v; this.audio.setSfxVolume(v / 100);
    this.audio.play("cursor_up", 0.4);   // preview the new SFX level
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _adjustBufVol(dir) {
    const b = this.settings.behavior;
    const v = Math.max(0, Math.min(100, (b.bufferingVolume ?? 15) + dir * holdAccel("bufvol", 1)));
    b.bufferingVolume = v; this.audio.setBufferingVolume(v / 100);
    this.audio.play("cursor_up", 0.4);
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _applyVsync() { /* applied when the app starts (webview launch flag) */ }
  // FPS Cap, Still Waves (read by the waves and a PS3 theme's animated
  // background every frame) and Remove Menu Blur
  _applyPerformance() {
    const b = this.settings?.behavior || {};
    const cap = fpsCapOf(b.fpsCap);
    window.__xmbFpsCap = cap === "display" ? 0 : +cap;
    this.wave.setStill && this.wave.setStill(!!b.stillWaves);
    // Remove Menu Blur (styles.css: body.nomenublur)
    document.body.classList.toggle("nomenublur", !!b.noMenuBlur);
  }
  _cycleIconStyle(dir) {
    const order = ["default", "glossy", "flat"];
    const i = (order.indexOf(this._iconStyle()) + dir + order.length) % order.length;
    this.user.theme.iconStyle = order[i];
    this._persistUser(); this.audio.play("cursor_up", 0.4);
    this._applyIconStyle();
    this._render(); this._onSelect();    // redraw the icons in the new style
  }
  _cycleResolution(dir) {
    const b = this.settings.behavior;
    const i = Math.max(0, RESOLUTIONS.indexOf(b.resolution || "native"));
    b.resolution = RESOLUTIONS[(i + dir + RESOLUTIONS.length) % RESOLUTIONS.length];
    this._persistSettings(); this._applyResolution();
    this.audio.play("cursor_up", 0.4);
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  // Full screen: the wave / sparkles render at the chosen resolution (scaled to
  // the screen). Window: the window's inside becomes that size. The layout is
  // all in screen-relative units, so proportions and spacing never change.
  _applyResolution() {
    const b = this.settings?.behavior || {};
    const m = /^(\d+)x(\d+)$/.exec(b.resolution || "");
    const fs = b.fullscreen !== false;
    const physH = Math.max(1, window.innerHeight * (window.devicePixelRatio || 1));
    window.__xmbRenderScale = fs && m ? Math.min(2, +m[2] / physH) : 0;
    window.__xmbAppResH = m ? +m[2] : physH;     // the app's resolution (Original screen mode)
    window.dispatchEvent(new Event("resize"));
    if (!fs && m) call("set_window_resolution", { width: +m[1], height: +m[2] }).catch(() => {});
  }
  // ---- Font, Text Color, Info Box Color ------------------------------------
  _applyTextLook() {
    const t = this.user?.theme || {}, root = document.documentElement;
    const col = (v) => { const c = parseColor(v); return c && v !== "auto" ? colorHex({ ...c, a: 1 }) : null; };
    // (a PS3 theme's Info Box Color option colours the info box)
    const tc = col(t.textColor), cc = col(this._themeInfoColor || t.clockColor);
    if (tc) { root.style.setProperty("--text", tc); root.classList.add("tc-custom"); }
    else { root.style.removeProperty("--text"); root.classList.remove("tc-custom"); }
    if (cc) { root.style.setProperty("--ib-color", cc); root.classList.add("ib-custom"); }
    else { root.style.removeProperty("--ib-color"); root.classList.remove("ib-custom"); }
    // the clock's own colour (Clock Color), apart from the info box's
    const kc = col(this._themeClockColor || t.clockIconColor);
    if (kc) { root.style.setProperty("--clock-color", kc); root.classList.add("clk-custom"); }
    else { root.style.removeProperty("--clock-color"); root.classList.remove("clk-custom"); }
    this._scaleFontRules();
    this._textColorRules();
    root.style.setProperty("--font-scale", String((t.fontSize ?? 100) / 100));
    let st = document.getElementById("user-font");
    if (!st) { st = document.createElement("style"); st.id = "user-font"; document.head.appendChild(st); }
    const font = t.font;
    if (font) {
      st.textContent = `@font-face { font-family: "XmbUserFont"; src: url("${assetUrl(font)}"); font-display: swap; }`;
      root.style.setProperty("--ui-font", `"XmbUserFont", "Rodin", "Segoe UI", system-ui, sans-serif`);
      root.classList.add("user-font");
    } else { st.textContent = ""; root.style.removeProperty("--ui-font"); root.classList.remove("user-font"); }
  }
  // Text Color, everywhere: every rule in the stylesheet that paints text a
  // light, neutral colour (white, the light greys, see-through white…) gets a
  // twin that, with a Text Color chosen, uses that colour instead — just as
  // light (a grey stays as much darker) and just as see-through. Made once;
  // the colour itself comes from --text, so changing it is instant. (Not the
  // on-screen keyboard, the boot intro or the clock icon, which keep theirs.)
  _textColorRules() {
    if (this._tcRulesMade) return;
    this._tcRulesMade = true;
    const probe = document.createElement("span"); document.body.appendChild(probe);
    const memo = new Map();
    const conv = (v) => {
      if (memo.has(v)) return memo.get(v);
      let out = null;
      if (!/var\(|currentcolor|inherit|transparent|initial|unset/i.test(v)) {
        probe.style.color = ""; probe.style.color = v;
        const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(probe.style.color ? getComputedStyle(probe).color : "");
        if (m) {
          const [r, g, b] = [+m[1], +m[2], +m[3]], a = m[4] == null ? 1 : +m[4];
          const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
          if (hi >= 170 && hi - lo <= 40 && a > 0) {
            const f = Math.round(hi / 255 * 1000) / 10;
            let c = f >= 99.5 ? "var(--text)" : `color-mix(in srgb, var(--text) ${f}%, black)`;
            if (a < 1) c = `color-mix(in srgb, ${c} ${Math.round(a * 1000) / 10}%, transparent)`;
            out = c;
          }
        }
      }
      memo.set(v, out); return out;
    };
    const SKIP = /osk|intro|ps3-|ib-clock|browser-snap|shot-|tc-custom|ib-custom|clk-custom|\.gl\b/;
    const split = (sel) => {   // a selector list at its top-level commas
      const out = []; let depth = 0, cur = "";
      for (const ch of sel) {
        if (ch === "(") depth++; else if (ch === ")") depth--;
        if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    const pre = (sel) => /^:root\b/.test(sel) ? sel.replace(/^:root/, ":root.tc-custom")
      : /^html\b/.test(sel) ? sel.replace(/^html/, "html.tc-custom") : `:root.tc-custom ${sel}`;
    let css = "";
    const walk = (rules, wrap) => {
      for (const r of rules) {
        if (r.type === 4 && r.cssRules) { walk(r.cssRules, `@media ${r.conditionText || r.media.mediaText}`); continue; }
        if (!r.selectorText || !r.style) continue;
        const v = r.style.getPropertyValue("color");
        if (!v) continue;
        const c = conv(v.trim());
        if (!c) continue;
        const sels = split(r.selectorText).filter((x) => !SKIP.test(x));
        if (!sels.length) continue;
        const rule = `${sels.map(pre).join(", ")} { color: ${c}${r.style.getPropertyPriority("color") ? " !important" : ""}; }`;
        css += wrap ? `${wrap} { ${rule} }\n` : rule + "\n";
      }
    };
    for (const sh of document.styleSheets) { try { if (sh.ownerNode && sh.ownerNode.id) continue; walk(sh.cssRules, ""); } catch (e) {} }
    probe.remove();
    const st = document.createElement("style"); st.id = "tc-rules"; st.textContent = css; document.head.appendChild(st);
  }
  // Font Size: every absolute font-size in the stylesheet is multiplied by
  // --font-scale (done once; sizes relative to their parent (em / %) are left
  // alone so they don't scale twice).
  _scaleFontRules() {
    if (this._fontRulesScaled) return;
    this._fontRulesScaled = true;
    const walk = (rules) => {
      for (const r of rules) {
        const v = r.style && r.style.getPropertyValue("font-size");
        if (v && !v.includes("--font-scale") && !/(?<!r)em\b|%|inherit|initial|unset|smaller|larger/.test(v)) {
          r.style.setProperty("font-size", `calc(${v} * var(--font-scale, 1))`, r.style.getPropertyPriority("font-size"));
        }
        if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      }
    };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
  }
  _adjustFontSize(dir) {
    const t = this.user.theme;
    t.fontSize = Math.max(0, Math.min(300, (t.fontSize ?? 100) + dir * holdAccel("fontsize", 5)));
    this.audio.play("cursor_up", 0.4); this._persistUser(); this._applyTextLook();
    setTimeout(() => this._layoutItems(this.root.clientWidth, this.root.clientHeight), 60);
  }
  async _fontList() { try { return await call("list_fonts"); } catch (e) { return []; } }
  async _fontMenu() {
    const fonts = await this._fontList();
    const items = [{ label: "Default", id: "" },
      ...(fonts.length ? [{ label: "From the Fonts Folder\u2026", id: "__grid__" }] : []),
      { label: "Choose Font File\u2026", id: "__pick__" }];
    this.overlay = this.sideMenu;
    this.sideMenu.open(items, { title: "Font" }, async (ch) => {
      this.sideMenu.close(); this.overlay = null;
      let f = ch.id;
      if (f === "__grid__") { this._fontGrid(fonts); return; }
      if (f === "__pick__") { try { f = await call("pick_font"); } catch (e) { f = null; } if (!f) return; }
      this._setFont(f || null);
    }, () => { this.sideMenu.close(); this.overlay = null; });
  }
  // the fonts of the Fonts folder as a grid (like the Photo Gallery), each
  // showing "Aa" in itself
  _fontGrid(fonts) {
    const items = fonts.map((f) => ({ label: f.split(/[\\/]/).pop().replace(/\.[^.]+$/, ""), id: f,
      fontUrl: /^\.\//.test(f) ? f : assetUrl(f) }));
    this.overlay = this.listPicker;
    this.listPicker.open({ title: "Font", items, grid: true, submit: "Select" }, (it) => {
      this.listPicker.close(); this.overlay = null;
      if (it && it.id) this._setFont(it.id);
    }, () => { this.listPicker.close(); this.overlay = null; this._fontMenu(); });
  }
  _setFont(f) {
    this.user.theme.font = f || null; this._persistUser(); this._applyTextLook();
    setTimeout(() => this._layoutItems(this.root.clientWidth, this.root.clientHeight), 150);
  }

  // ---- Photo/Video Playlists + Background / Overlay Shuffle -----------------
  // One list of playlists for both shuffles (the overlay's own list from
  // before is merged in once: a playlist already there under the same name
  // with the same items is kept once, a different one gets "(Overlay)" added)
  _bgPlaylists() {
    const t = this.user.theme;
    const list = (t.bgPlaylists ||= []);
    if (Array.isArray(t.ovPlaylists)) {
      for (const p of t.ovPlaylists) {
        const same = list.find((x) => x.name === p.name);
        if (same && JSON.stringify(same.items) === JSON.stringify(p.items)) continue;
        let name = same ? `${p.name} (Overlay)` : p.name;
        while (list.some((x) => x.name === name)) name += " 2";
        if (t.ovShuffle === `pl:${p.name}`) t.ovShuffle = `pl:${name}`;
        list.push({ ...JSON.parse(JSON.stringify(p)), name });
      }
      delete t.ovPlaylists;
      this._persistUser && this._persistUser();
    }
    return list;
  }
  _bgPlaylistItems(which = "bg") {
    const SI = { sys: "icon_setting_item.png" };
    return [
      { kind: "action", act: `bgpl_new::${which}`, title: "Create Playlist", icon: SI },
      ...this._bgPlaylists(which).map((p, i) => ({ kind: "drill", title: p.name, sub: `${p.items.length} Item${p.items.length !== 1 ? "s" : ""}`,
        icon: SI, childrenFn: () => this._bgPlaylistDetail(which, i) })),
    ];
  }
  _bgPlaylistDetail(which, i) {
    const p = this._bgPlaylists(which)[i]; if (!p) return [];
    const SI = { sys: "icon_setting_item.png" };
    return [
      { kind: "action", act: `bgpl_edit::${which}::${i}`, title: "Edit Playlist", icon: SI, sub: "Add or remove pictures and videos." },
      { kind: "action", act: `bgpl_del::${which}::${i}`, title: "Delete Playlist", icon: SI },
      ...p.items.map((path) => ({ kind: "ph", title: String(path).split(/[\\/]/).pop(), sub: "", icon: SI })),
    ];
  }
  async _bgPlaylistPick(title, checked, done) {
    let media = [];
    try { media = await call("list_media", { kind: "background" }); } catch (e) {}
    if (!media.length) { this.audio.play("error", 0.5); return; }
    this.overlay = this.listPicker;
    this.listPicker.open({ title, multi: true, checked, submit: "Save", grid: true,
      items: media.map((m) => ({ label: noExt(m.name || String(m.path).split(/[\\/]/).pop()), id: m.path,
        thumb: stillUrl(m.path, m.cover), vsrc: isVideoPath(m.path) ? assetUrl(m.path) : null })) },
      async (ids) => { this.listPicker.close(); this.overlay = null; await this._convertForBackground(ids || []); done(ids || []); },
      () => { this.listPicker.close(); this.overlay = null; });
  }
  _bgPlaylistNew(which = "bg") {
    this._bgPlaylistPick("Create Playlist", [], (ids) => {
      if (!ids.length) return;
      this.overlay = this.textForm;
      const n = this._bgPlaylists(which).length + 1;
      this.textForm.open({ title: "Playlist Name", prompt: "Enter a name for the playlist.", fields: [{ key: "name", label: "Name", value: `Playlist ${n}`, required: true }], submit: "Create" },
        (out) => {
          this.textForm.close(); this.overlay = null;
          let name = String(out.name || "").trim() || `Playlist ${n}`;
          while (this._bgPlaylists(which).some((p) => p.name === name)) name += " 2";
          this._bgPlaylists(which).push({ name, items: ids }); this._persistUser();
          this.audio.play("enter", 0.5); this._rebuildLevel(() => this._bgPlaylistItems(which));
        }, () => { this.textForm.close(); this.overlay = null; });
    });
  }
  _bgPlaylistEdit(which, i) {
    const p = this._bgPlaylists(which)[i]; if (!p) return;
    this._bgPlaylistPick(p.name, p.items, (ids) => {
      p.items = ids; this._persistUser(); this._restartRotation();
      this._rebuildLevel(() => this._bgPlaylistDetail(which, i));
    });
  }
  _bgPlaylistDelete(which, i) {
    const p = this._bgPlaylists(which)[i]; if (!p) return;
    this.overlay = this.confirm;
    this.confirm.open(`Delete the playlist "${p.name}"?`, [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }], (ch) => {
      this.confirm.close(); this.overlay = null;
      if (!ch || ch.id !== "yes") return;
      const t = this.user.theme;
      this._bgPlaylists(which).splice(i, 1);
      for (const k of ["bgShuffle", "ovShuffle"]) if (t[k] === `pl:${p.name}`) t[k] = "off";
      this._persistUser(); this._restartRotation(); this.audio.play("enter", 0.5);
      this._back();
      this._rebuildLevel(() => this._bgPlaylistItems(which));
    }, () => { this.confirm.close(); this.overlay = null; });
  }
  _cycleShuffle(ctl, dir) {
    const key = ctl === "bgshuffle" ? "bgShuffle" : "ovShuffle", t = this.user.theme;
    const opts = ["off", "all", ...this._bgPlaylists(ctl === "bgshuffle" ? "bg" : "ov").map((p) => `pl:${p.name}`)];
    const i = Math.max(0, opts.indexOf(t[key] || "off"));
    t[key] = opts[(i + dir + opts.length) % opts.length];
    this.audio.play("cursor_up", 0.4); this._persistUser(); this._restartRotation();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  // ✕: type a number, then choose Seconds, Minutes or Hours
  _typeInterval(it) {
    this.overlay = this.textForm;
    this.textForm.open({ title: it.title, fields: [{ key: "n", label: "Number", value: "", type: "number" }], submit: "Next" },
      (out) => {
        this.textForm.close(); this.overlay = null;
        const n = parseInt(String(out.n || "").replace(/[^0-9]/g, ""), 10);
        if (!Number.isFinite(n) || n < 1) { this.audio.play("error", 0.4); return; }
        const pl = (w) => `${n} ${w}${n !== 1 ? "s" : ""}`;
        this.overlay = this.listPicker;
        this.listPicker.open({ title: it.title, submit: "Confirm", items: [
          { label: pl("Second"), id: 1 }, { label: pl("Minute"), id: 60 }, { label: pl("Hour"), id: 3600 }] },
          (ch) => {
            this.listPicker.close(); this.overlay = null;
            this.user.theme[it.ctl === "ovinterval" ? "ovInterval" : "bgInterval"] = n * ch.id; this._persistUser(); this._retimeRotation();
            this._layoutItems(this.root.clientWidth, this.root.clientHeight);
          }, () => { this.listPicker.close(); this.overlay = null; });
      }, () => { this.textForm.close(); this.overlay = null; });
  }
  // Photo Duration: the background's, or the overlay's own (the background's
  // until it's set)
  _rotSecs(k) { const t = this.user?.theme || {}; return (k === "ov" ? t.ovInterval || t.bgInterval : t.bgInterval) || 10; }
  // a new Photo Duration applies to the picture on screen now
  _retimeRotation() {
    for (const [k, r] of Object.entries(this._rot || {})) {
      if (!r || !r.timer) continue;
      clearTimeout(r.timer);
      r.timer = setTimeout(() => this._rotNext(k), this._rotSecs(k) * 1000);
    }
  }
  // (re)start both shuffles from the theme's settings
  async _restartRotation() {
    const t = this.user?.theme || {};
    const gen = (this._rotGen = (this._rotGen || 0) + 1);
    for (const r of Object.values(this._rot || {})) clearTimeout(r && r.timer);
    this._rot = {};
    let all = null;
    for (const [k, key] of [["bg", "bgShuffle"], ["ov", "ovShuffle"]]) {
      const mode = t[key] || "off";
      if (mode === "off") continue;
      let list = [];
      if (mode === "all") {
        if (!all) { try { all = (await call("list_media", { kind: "background" })).map((m) => m.path); } catch (e) { all = []; } }
        list = all;
      } else list = ((this._bgPlaylists(k).find((p) => `pl:${p.name}` === mode) || {}).items || []);
      if (gen !== this._rotGen) return;
      if (list.length) this._rot[k] = { list: [...list], cur: null, timer: null, last: null };
    }
    for (const k of Object.keys(this._rot)) this._rotNext(k, false);
    this._applyWallpaper();
  }
  // the next random item (never the same one twice in a row)
  _rotNext(k, apply = true) {
    const r = this._rot && this._rot[k]; if (!r) return;
    clearTimeout(r.timer);
    let pick = r.list[Math.floor(Math.random() * r.list.length)];
    if (r.list.length > 1) while (pick === r.cur) pick = r.list[Math.floor(Math.random() * r.list.length)];
    r.cur = pick;
    if (!isVideoPath(pick)) r.timer = setTimeout(() => this._rotNext(k), this._rotSecs(k) * 1000);
    if (apply) this._applyWallpaper();
  }
  // a shuffled video plays once, then the next item comes
  _hookRotationVideos() {
    for (const [k, id] of [["bg", "wallpaper"], ["ov", "overlay"]]) {
      const r = this._rot && this._rot[k]; if (!r || !isVideoPath(r.cur) || r.list.length < 2) continue;
      const el = document.getElementById(id);
      const v = (el && el._chroma && el._chroma.video) || (el && el.querySelector("video"));
      if (!v || v._rotHooked === r.cur) continue;
      v._rotHooked = r.cur; v.loop = false;
      v.addEventListener("ended", () => { if (this._rot && this._rot[k] === r && r.cur === v._rotHooked) this._rotNext(k); }, { once: true });
    }
  }
  // Background Display: Normal / Zoom / Full Screen / Original (same order as
  // the Video Player's Screen Mode)
  _cycleBgFit(dir) {
    const t = this.user.theme;
    const i = Math.max(0, FIT_MODES.findIndex((f) => f[0] === (t.wallpaperFit || "normal")));
    t.wallpaperFit = FIT_MODES[(i + dir + FIT_MODES.length) % FIT_MODES.length][0];
    this.audio.play("cursor_up", 0.4); this._persistUser(); this._fitWallpaper();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _fitWallpaper() {
    const el = document.getElementById("wallpaper"), m = el && el.firstElementChild;
    if (!m) return;
    fitMedia(m, this.user?.theme?.wallpaperFit || "normal", el);
    if (!this._wpResize) { this._wpResize = () => this._fitWallpaper(); window.addEventListener("resize", this._wpResize); }
  }
  // Overlay green-screen strength, 0..1
  _adjustChroma(dir) {
    const t = this.user.theme;
    t.chromaStrength = Math.max(0, Math.min(1, Math.round(((t.chromaStrength ?? 0.5) + dir * 0.01 * holdAccel("chroma", 5)) * 100) / 100));
    this._applyWallpaper();
    this.audio.play("cursor_up", 0.4); this._persistUser();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _adjustBrightness(dir) {
    const b = this.settings.behavior;
    let v = Math.max(0, Math.min(100, (b.brightness ?? 100) + dir * holdAccel("brightness", 5)));
    b.brightness = v; this._applyBrightness(v);
    this.audio.play("cursor_up", 0.4);
    this._persistSettings();
    this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  _applyBrightness(v) {
    const dim = document.getElementById("dim");
    if (dim) dim.style.opacity = String(Math.max(0, Math.min(1, (100 - (v ?? 100)) / 100)));
  }
  // Friend Personalization numeric / mode adjustment (left/right or enter).
  // Number of friends / minimum / maximum: typed in (left / right still step it).
  _typeFriendNumber(it) {
    const key = { friendcount: "count", friendmin: "min", friendmax: "max" }[it.ctl];
    const cur = String(this._friendCfg()[key] ?? "");
    this.overlay = this.textForm;
    this.textForm.open({ title: it.title, fields: [{ key: "n", label: `Number (0-${FRIEND_MAX})`, value: cur, type: "number" }], submit: "Confirm" },
      (out) => {
        this.textForm.close(); this.overlay = null;
        const n = parseInt(String(out.n || "").replace(/[^0-9]/g, ""), 10);
        if (!Number.isFinite(n)) { this.audio.play("error", 0.4); return; }
        this._friendPersistCfg((c) => { c[key] = Math.max(0, Math.min(FRIEND_MAX, n)); });
        this._layoutItems(this.root.clientWidth, this.root.clientHeight);
      }, () => { this.textForm.close(); this.overlay = null; });
  }
  _adjustFriendSetting(ctl, dir) {
    this._friendPersistCfg((c) => {
      if (ctl === "friendmode") {
        const order = ["random", "fixed", "range"];
        const i = (order.indexOf(c.mode) + dir + order.length) % order.length;
        c.mode = order[i];
      } else if (ctl === "friendcount") {
        c.count = Math.max(0, Math.min(FRIEND_MAX, (c.count ?? 8) + dir));
      } else if (ctl === "friendmin") {
        c.min = Math.max(0, Math.min(FRIEND_MAX, (c.min ?? 2) + dir));
      } else if (ctl === "friendmax") {
        c.max = Math.max(0, Math.min(FRIEND_MAX, (c.max ?? 30) + dir));
      }
    });
    this.audio.play("cursor_up", 0.4);
    // friendmode changes which sub-settings show → rebuild ONLY this submenu
    // level in place (so we don't leave the Friend Personalization menu). The
    // generated friends aren't rebuilt here; they refresh when the player backs
    // out of the menu (see _back).
    if (ctl === "friendmode") this._rebuildFriendMenuLevel();
    else this._layoutItems(this.root.clientWidth, this.root.clientHeight);
  }
  // Re-derive the Friend Personalization submenu items in place, keeping the
  // drill stack and (clamped) cursor so the player stays in the menu.
  _rebuildFriendMenuLevel() {
    const lvl = this._level();
    if (!lvl) return;
    const sel = lvl.sel;
    lvl.items = this._friendPersonalizationItems();
    lvl.sel = Math.max(0, Math.min(sel, lvl.items.length - 1));
    this._render(); this._onSelect();
  }
  // Rebuild just the Friends column's data (used when leaving Friend
  // Personalization so count/mode/card changes take effect without a full XMB
  // rebuild that would collapse the menu).
  async _refreshFriendsColumn() {
    this._friendMenuDirty = false;
    const fcol = this.columns.find((c) => c.id === "friends");
    if (!fcol) return;
    fcol.items = await this._friendsItems();
    if (this.columns[this.selCat]?.id === "friends" && this.levels.length === 1) {
      const lvl = this.levels[0];
      lvl.items = fcol.items;
      if (lvl.sel >= lvl.items.length) lvl.sel = Math.max(0, lvl.items.length - 1);
      this._render(); this._onSelect();
    }
  }
  _persistUser() { call("save_user", { user: this.user }); this.cbs.onProfileChange(this.user); }
  // The System can't save in its own folder (installed in Program Files with
  // the .msi): users, settings, recognized games and media, and the log aren't kept
  warnNotWritable(dir) {
    const show = () => {
      if (this.overlay) { setTimeout(show, 500); return; }
      this.overlay = this.confirm;
      this.audio.play("error", 0.5);
      this.confirm.open(`MaXMB can't save anything in its folder:\n${dir}\n\nUsers, settings, recognized games and media, and the log won't be kept. This happens when it's installed in Program Files (the .msi installer). Install it with the .exe installer, or in a folder you can write to.`,
        [{ label: "OK", id: "ok" }], () => { this.confirm.close(); this.overlay = null; }, () => { this.confirm.close(); this.overlay = null; });
    };
    show();
  }
  _persistSettings() { const p = call("save_settings", { settings: this.settings }).catch(() => {}); this._snapshotUserSettings(); return p; }
  // ---- every setting is kept per user ---------------------------------------
  // The system settings (volumes, brightness, formats, full screen, power save,
  // keyboard, keybinds, media / game recognition modes…) live in the settings
  // file, which the backend reads; each user also keeps their own copy, put
  // back in place (and applied) when they sign in. The folder lists (media
  // folders, game source folders, sections) stay shared.
  _snapshotUserSettings() {
    if (!this.user || !this.settings) return;
    const c = {};
    for (const k of USER_SETTING_KEYS) if (this.settings[k] !== undefined) c[k] = JSON.parse(JSON.stringify(this.settings[k]));
    this.user.settingsCopy = c;
    clearTimeout(this._usT); this._usT = setTimeout(() => { if (this.user) call("save_user", { user: this.user }); }, 300);
  }
  async _loadUserSettings(user) {
    const s = this.settings, c = user && user.settingsCopy;
    if (!s) return;
    // Low Performance Mode is off by default now: turned off once for settings
    // saved while it was on by default
    const lpOnce = () => { const bb = (s.behavior ||= {}); if (!bb.lowPowerOffOnce) { bb.lowPowerMode = false; bb.lowPowerOffOnce = true; return true; } return false; };
    if (!c) { if (lpOnce()) call("save_settings", { settings: s }).catch(() => {}); this._snapshotUserSettings(); { const lvl = this._inGame ? 2 : (document.hasFocus() ? 0 : 1); this._lowPower = -1; this.setLowPower(lvl); } return; }       // first sign-in: keeps the current settings
    const before = { fs: s.behavior?.fullscreen, auto: s.behavior?.autostart, res: s.behavior?.resolution };
    for (const k of USER_SETTING_KEYS) if (c[k] !== undefined) s[k] = JSON.parse(JSON.stringify(c[k]));
    if (lpOnce()) this._snapshotUserSettings();
    try { await call("save_settings", { settings: s }); } catch (e) {}
    const b = s.behavior || {};
    this.audio.setMasterVolume((b.volume ?? 100) / 100);
    this.audio.setMusicVolume((b.musicVolume ?? 100) / 100);
    this.audio.setSfxVolume((b.sfxVolume ?? 100) / 100);
    this.audio.playInBackground = b.playAudioBackground !== false;
    this.audio.setBufferingVolume((b.bufferingVolume ?? 15) / 100);
    this.audio.setBuffering(b.bufferingSound === true);
    this._applyBrightness(b.brightness ?? 100);
    this.cbs.onTimeFormat && this.cbs.onTimeFormat(b.timeFormat || "24");
    this.cbs.onDateFormat && this.cbs.onDateFormat(b.dateFormat || "DD/MM/YYYY");
    VIRTUAL_KB.on = b.virtualKeyboard !== false;
    Keybinds.load(s.input?.keybinds);
    { const lvl = this._inGame ? 2 : (document.hasFocus() ? 0 : 1); this._lowPower = -1; this.setLowPower(lvl); }
    this._applyPerformance();
    if ((before.fs !== false) !== (b.fullscreen !== false)) {
      call("set_fullscreen", { enable: b.fullscreen !== false }); this.cbs.onFullscreen && this.cbs.onFullscreen(b.fullscreen !== false);
      setTimeout(() => this._applyResolution(), 350);
    } else if (before.res !== b.resolution) this._applyResolution();
    if (!!before.auto !== !!b.autostart) call("set_autostart", { enable: !!b.autostart }).catch(() => {});
  }
  // A background / overlay video in a format or codec the webview can't play
  // (HEVC, MPEG-2, AVI, WMV, MKV…) gets the same playable copy the Video
  // Player makes (ffmpeg); the original is used until it's ready.
  _playable(p) {
    if (!p || /^data:/.test(p) || !isVideoPath(p)) return p;
    const m = (this._vplay ||= new Map());
    if (m.has(p)) return m.get(p) || p;
    // (the preloaded videos were just deleted: not converted again by itself)
    if (this._noAutoConvert) return p;
    m.set(p, null);
    (async () => {
      let out = p;
      try {
        const plan = await call("video_plan", { path: p });
        if (plan && plan.cached) out = plan.cached;
        else if (plan && plan.mode && plan.mode !== "direct") out = await call("video_prepare", { path: p, full: plan.mode === "convert" });
      } catch (e) { out = p; }
      m.set(p, out || p);
      if (out && out !== p) this._applyWallpaper();
    })();
    return p;
  }
  // Loading: only the background and the clock show, its hands sweeping round;
  // when it's done they return to the time and everything else fades back in.
  _loadingBegin() {
    if (this._loadingOn) return;
    this._loadingOn = true;
    document.body.classList.add("clock-loading");
    this.cbs.infobox && this.cbs.infobox.startSpin();
  }
  async _loadingSettle() { if (this._loadingOn && this.cbs.infobox) await this.cbs.infobox.stopSpin(); }
  // end the loading screen at once (the clock settles on its own, hidden by the menu)
  _loadingQuit() { if (this._loadingOn && this.cbs.infobox) this.cbs.infobox.stopSpin(); this._loadingDone(); }
  _loadingDone() { if (!this._loadingOn) return; this._loadingOn = false; document.body.classList.remove("clock-loading"); }
  // Something chosen (✕, △, □ or a menu's choice) that keeps working
  // afterwards (reading folders, grouping media, drawing the menus again...):
  // the menu doesn't move until it's done, and when it takes more than a
  // moment the clock's hands sweep round meanwhile (everything else stays as it is).
  // While it waits for you (a menu, a dialog, a file picker, a player) it
  // neither shows nor holds anything.
  _trackBusy(r) {
    if (!r || typeof r.then !== "function") return r;
    const job = {};
    (this._busyJobs ||= new Set()).add(job);
    const end = () => { this._busyJobs.delete(job); this._busyPump(); };
    r.then(end, end);
    this._busyPump();
    return r;
  }
  _busyWaitsForUser() {
    return !!(this.overlay || this._placing || Input.picking || this._launching || this._inGame || this._browserActive
      || this._signingIn || this._preloadState === "loading" || this.locked);
  }
  _busyPump() {
    const jobs = this._busyJobs && this._busyJobs.size;
    const active = !!jobs && !this._busyWaitsForUser();
    const now = performance.now();
    if (active && !this._actBusy) this._busySince = now;
    // (a safety: nothing holds the menu for more than a minute)
    const stuck = active && now - this._busySince > 60000;
    this._actBusy = active && !stuck;
    const ib = this.cbs.infobox;
    if (this._actBusy && !this._busyClock && !this._loadingOn && now - this._busySince > 300) { this._busyClock = true; ib && ib.startSpin(); }
    // done (or waiting for you): the hands come round to the time
    if (!this._actBusy && this._busyClock) { this._busyClock = false; if (!this._loadingOn) ib && ib.stopSpin(); }
    clearTimeout(this._busyT);
    if (jobs) this._busyT = setTimeout(() => this._busyPump(), 100);
  }
  // Background / Overlay / Background Playlist choices: every chosen video that
  // can't play as it is gets converted now, with the loading screen up and
  // the system waiting until it's done.
  async _convertForBackground(paths) {
    this._noAutoConvert = false;   // (chosen now: converted as usual)
    const m = (this._vplay ||= new Map());
    const todo = [];
    for (const p of new Set((paths || []).filter((x) => x && !/^data:/.test(x) && isVideoPath(x)))) {
      if (m.get(p)) continue;
      let plan = null;
      try { plan = await call("video_plan", { path: p }); } catch (e) {}
      if (plan && plan.cached) { m.set(p, plan.cached); continue; }
      if (!plan || !plan.mode || plan.mode === "direct") { m.set(p, p); continue; }
      todo.push([p, plan.mode]);
    }
    if (!todo.length) return true;
    this._busy = true; this._loadingBegin();
    let failed = 0;
    for (let i = 0; i < todo.length; i++) {
      const [p, mode] = todo[i];
      let out = null;
      try { out = await call("video_prepare", { path: p, full: mode === "convert" }); }
      catch (e) { if (mode !== "convert") { try { out = await call("video_prepare", { path: p, full: true }); } catch (e2) {} } }
      if (!out) failed++;
      m.set(p, out || p);
    }
    await this._loadingSettle(); this._loadingDone();
    this._busy = false;
    if (failed) { this.audio.play("error", 0.4); this._shotFeedback(failed > 1 ? `${failed} videos couldn't be converted (ffmpeg is needed)` : "This video couldn't be converted (ffmpeg is needed)"); }
    return !failed;
  }
  _applyWallpaper() {
    const t = this.user?.theme || {};
    // Background / Overlay Shuffle replace the chosen picture while they run
    // (videos the webview can't play as they are use a converted copy)
    // (a theme can hide them while it's on: its Background / Overlay options)
    const wp = customizationOn("background") ? this._playable(this._rot?.bg?.cur ?? t.wallpaper) : null;
    const ov = customizationOn("overlay") ? this._playable(this._rot?.ov?.cur ?? t.overlay) : null;
    // A wallpaper may be a disk path (via convertFileSrc) or a data: URL that a
    // .p3t import produced: pass data URLs straight through.
    const url = (p) => (p && /^data:/.test(p) ? p : (p ? assetUrl(p) : null));
    const on = setLayerMedia(document.getElementById("wallpaper"), url(wp), wp);
    this._fitWallpaper();
    setOverlayMedia(document.getElementById("overlay"), url(ov), ov, t.chromaStrength ?? 0.5, t.chromaKey || "green");
    this._hookRotationVideos();
    // (a new background / overlay video while the Photo Viewer / Video Player covers it waits for them to close)
    if (this._bgCovered) for (const v of this._bgVideos()) if (!v._cover) { v._cover = { t: 0, at: performance.now() }; v.pause(); v.addEventListener("play", () => { if (this._bgCovered) v.pause(); }, { once: true }); }
    // Background colour: an opaque one is drawn by the wave renderer as usual.
    // A see-through one (Opacity < 1) becomes a tint layer over the picture /
    // black, while the wave and dots keep drawing normally on top.
    const bc = parseColor(this._tcol("backgroundColor"));
    const tint = document.getElementById("bgtint");
    if (this._visPlayer()) {
      // the Music Player's Visualizer Wave: its own background, nothing over or under it
      if (tint) tint.classList.remove("show");
      this.wave.setColor("auto");
      this.wave.setWallpaper(false);
    } else if (bc && bc.a < 0.999) {
      this.wave.setColor(colorHex({ ...bc, a: 1 }));
      if (tint) { tint.style.background = `rgba(${bc.r},${bc.g},${bc.b},${bc.a})`; tint.classList.add("show"); }
      this.wave.setWallpaper(true);
    } else {
      if (tint) tint.classList.remove("show");
      // (a colour square or the Visualizer Wave: drawn from its own gradient, as Original is)
      this.wave.setColor(this._bgLook() ? "auto" : (this._tcol("backgroundColor") || "auto"));
      // a PS3 theme's background shows through the wave like a picture does
      this.wave.setWallpaper(on || !!this.themeBg?.coversBackground);
    }
    // An Overlay over the Background Color (no picture / video): the colour's
    // gradient is drawn under the overlay, the wave over it, as with a picture
    const ovOnColor = !!ov && !on && !this.themeBg?.coversBackground && !this._visPlayer() && !(bc && bc.a < 0.999);
    this.wave.setBgOff(ovOnColor);
    clearInterval(this._bgImgT); this._bgImgT = null;
    if (ovOnColor && tint) {
      const paint = () => {
        const u = this.wave.backgroundImage(); if (!u || u === this._bgImgUrl) return;
        this._bgImgUrl = u; tint.style.background = `url("${u}") center / 100% 100% no-repeat`;
      };
      this._bgImgUrl = null; paint(); tint.classList.add("show");
      // (kept up to date: the month / time colours and the gradient settings change it)
      this._bgImgT = setInterval(paint, 2000);
    }
    this._syncVisualizer();
  }

  // ------------------------------------------------------------- PSN flow
  _runAction(act, it) {
    if (act && act.startsWith("bgpl_new::")) return this._bgPlaylistNew(act.slice(10));
    if (act && act.startsWith("bgpl_edit::")) { const [w, i] = act.slice(11).split("::"); return this._bgPlaylistEdit(w, parseInt(i, 10)); }
    if (act && act.startsWith("bgpl_del::")) { const [w, i] = act.slice(10).split("::"); return this._bgPlaylistDelete(w, parseInt(i, 10)); }
    if (act === "theme_custom_create") return this._createCustomTheme();
    if (act && act.startsWith("theme_extract::")) return this._extractTheme(act.slice("theme_extract::".length));
    if (act && act.startsWith("theme_use::")) { const [kind, ...k] = act.slice(11).split("::"); return this._themeUse(kind, k.join("::")); }
    if (act && act.startsWith("wave_delete::")) return this._deleteWavePreset(parseInt(act.slice("wave_delete::".length), 10));
    if (act && act.startsWith("theme_delete::")) return this._deleteThemePreset(parseInt(act.slice("theme_delete::".length), 10));
    if (act && act.startsWith("playlist_add::")) return this._editPlaylistAdd(act.slice("playlist_add::".length));
    if (act && act.startsWith("playlist_remove::")) return this._editPlaylistRemove(act.slice("playlist_remove::".length));
    if (act && act.startsWith("friend_card_edit::")) return this._friendCardMenu(parseInt(act.slice("friend_card_edit::".length), 10));
    if (act && act.startsWith("cache_clear::")) return this._clearCache(act.slice("cache_clear::".length));
    if (act && act.startsWith("media_pick::")) return this._mediaPick(act.slice("media_pick::".length));
    if (act && act.startsWith("media_recog::")) return this._mediaRecognize(act.slice("media_recog::".length));
    if (act && act.startsWith("intro_art::")) return this._introArtMenu(act.slice("intro_art::".length));
    if (act && act.startsWith("gmm::")) { const [, k, ...f] = act.split("::"); return this._gameMediaMenu(k, f.join("::")); }
    if (act && act.startsWith("scrape_key::")) return this._scrapeKeyEdit(act.slice("scrape_key::".length));
    if (act && act.startsWith("gm_scrape::")) return this._gameScrape(act.slice("gm_scrape::".length));
    if (act && act.startsWith("media_rm::")) { const [k, i] = act.slice(10).split("::"); return this._mediaRemove(k, parseInt(i, 10)); }
    if (act && act.startsWith("gsrc_remove::")) return this._gsrcRemove(parseInt(act.slice("gsrc_remove::".length), 10));
    if (act && act.startsWith("gsrc_del::")) return this._gsrcDelete(act.slice("gsrc_del::".length));
    if (act && act.startsWith("gman_del::")) return this._gmanDelete(act.slice("gman_del::".length));
    if (act && /^(sec|sub)_/.test(act)) return this._sectionAction(act);
    if (act === "gsrc_add") return this._gsrcAdd();
    if (act === "gsrc_scan") return this._gsrcScan(false);
    switch (act) {
      case "psplus_toggle": {   // ✕ only: the player's own PS Plus mark (card + info box)
        const c = this._friendCfg(); c.playerPlus = !c.playerPlus; this.user.friendConfig = c; this._persistUser();
        this.audio.play("enter", 0.4); return;
      }
      case "friend_card_new": return this._friendCardEditor(null);
      case "player_level": return this._editPlayerLevel();
      case "wave_save": return this._saveWavePreset();
      case "wave_load": return this._loadWavePreset(it && it.preset);
      case "theme_save": return this._saveThemePreset();
      case "theme_reset": return this._resetThemeSettings();
      case "theme_load": return this._loadThemePreset(it && it.tpreset);
      case "inet_browser": return this._openInternet("browser");
      case "youtube": return this._openInternet("url", "https://www.youtube.com/");
      case "launch_home": if (this._homeGame) { this.audio.play("enter", 0.6); this._launch(this._homeGame); } return;
      case "inet_search": return this._openInternet("search");
      // (the old WebView2 in-app browser was removed; _openInternet is a
      //  placeholder until the new bundled-engine browser is built)
      case "psn_signup": return this._psnSignUp();
      case "psn_signin": return this._psnSignIn();
      case "psn_signout": return this._psnSignOut();
      case "psn_editid": return this._psnEditId();
      case "psn_avatar": return this._psnAvatar();
      case "theme_bgimage": return this._themeBgImage();
      case "bgpl_new": return this._bgPlaylistNew();
      case "keybinds": return this._openKeybinds();
      case "theme_overlay": return this._themeOverlay();
      case "theme_overlayremove": return this._themeOverlayRemove();
      case "theme_bgremove": return this._themeBgRemove();
      case "wave_reset": return this._resetWaveParams();
      case "turnoff": return this._turnOff();
      case "bgmusic": return this._selectBgMusic();
      case "preload": return this._preloadAllSongs();
      case "preloadvideos": return this._preloadAllVideos();
      case "playlist_create": return this._createPlaylist();
      case "photo_playlist_create": return this._createPhotoPlaylist();
      case "photo_slideshow": return this._playPhotoSlideshow(it && it.playlist);
      case "photo_gallery": return this._openPhotoGallery();
    }
  }
  // Internet Browser / Internet Search.
  //
  // LibreWolf runs on your own profile in a borderless, centered square window
  // that the Rust side keeps pinned over the app; the helper extension inside
  // LibreWolf opens your default search engine / home page and carries out the
  // controller commands. Controls while browsing:
  //   left stick = pointer, ✕ = press (hold and move to grab), right stick =
  //   scroll, ○ = close the current window (held: exit the browser), START =
  //   enter an address, L1/R1 = back/forward, L2/R2 = the window on the
  //   left/right, L3 = full screen on/off. Focusing a page text field (with a
  //   controller) opens the on-screen keyboard, prefilled with the field's text.
  get browserActive() { return !!this._browserActive; }
  // the page is up and showing (not loading, no on-screen keyboard over it)
  get browserLive() { return !!(this._browserActive && this._br && this._br.ready && !this._brOskOpen); }
  // a browser button from the app's own controller reading (no native feed)
  browserButton(a) { if (this._browserActive && !this._brOskOpen) this._browserCtl().onInput(a); }
  // keyboard exit (Esc held while the page has focus), sent by the backend
  exitBrowser() { if (this._brOskOpen) return; this._closeBrowser(); }

  async _openInternet(mode, url = null) {
    // one browser at a time; ignore repeat presses while one is starting
    if (this._browserActive || this._browserBusy) return;
    this._browserBusy = true;
    this.audio.play("enter", 0.6);
    let status = null;
    try { status = await call("browser_status"); } catch (e) {}
    if (!status || !status.ready) {
      this._browserBusy = false;
      this.audio.play("error", 0.4);
      const dir = (status && status.browserDir) || "content\\Browser";
      this.overlay = this.confirm;
      this.confirm.open(
        `LibreWolf not found. Put the LibreWolf Portable folder (with LibreWolf\\librewolf.exe inside) into ${winPath(dir)}, then open the Internet Browser again.`,
        [{ label: "OK", id: "ok" }],
        () => { this.confirm.close(); this.overlay = null; this._render(); this._onSelect(); },
        () => { this.confirm.close(); this.overlay = null; this._render(); this._onSelect(); });
      return;
    }
    this._browserFirstRun = !status.installed;
    if (mode === "search") {
      const cancel = () => { this._browserBusy = false; this.overlay = null; this._render(); this._onSelect(); };
      this.overlay = this.textForm;
      this.textForm.open(
        { title: "Internet Search", fields: [{ key: "q", label: "Search" }], submit: "Search" },
        (out) => {
          this.textForm.close();
          const q = (out.q || "").trim();
          if (!q) { cancel(); return; }
          this._browserStart("search", q);      // runs on YOUR default search engine
        },
        () => { this.textForm.close(); cancel(); });
      return;
    }
    if (mode === "url") { this._browserStart("url", url); return; }   // (YouTube)
    this._browserStart("browser", null);       // your home page
  }

  // The page panel, as on the real PS3 browser (1920x1080 capture): x 412-1505,
  // y 76-1002, between the two grey bars. Physical px for the window, CSS px
  // for the helper.
  _browserScreenRect() {
    const dpr = window.devicePixelRatio || 1;
    const sw = window.innerWidth || screen.width;
    const sh = window.innerHeight || screen.height;
    const w = Math.round(sw * 1094 / 1920), h = Math.round(sh * 927 / 1080);
    const cx = (window.screenX || 0) + Math.round((sw - w) / 2);
    const cy = (window.screenY || 0) + Math.round(sh * 76 / 1080);
    return {
      x: Math.round(cx * dpr), y: Math.round(cy * dpr),
      w: Math.round(w * dpr), h: Math.round(h * dpr),
      cx, cy, cw: w, ch: h,
    };
  }

  // Show the browser screen IMMEDIATELY (the backdrop + a status line), then
  // start LibreWolf in the background. ○ cancels at any time.
  async _browserStart(mode, value) {
    this._browserActive = true;
    this._br = { phase: "", live: false, ready: false, closing: false, seq: null, oskClosedAt: 0,
                 crossPrev: false, down: false, accX: 0, accY: 0, nextScroll: 0, scrollHeld: false, url: "" };
    this._showBrowserChrome();
    this._browserSetCenter(true);          // spinning loader until the page is up
    this.overlay = this._browserCtl();
    this._brTimer = setInterval(() => this._browserPoll(), 200);
    const r = this._browserScreenRect();
    try {
      await call("browser_open", { mode, url: value, x: r.x, y: r.y, w: r.w, h: r.h,
                                   cx: r.cx, cy: r.cy, cw: r.cw, ch: r.ch });
    } catch (e) {
      if (this._browserActive && String(e) !== "cancelled") {
        this.audio.play("error", 0.4);
        this._closeBrowser(true);
      }
    } finally {
      this._browserBusy = false;
    }
  }

  async _browserPoll() {
    if (!this._browserActive || this._brPolling) return;
    this._brPolling = true;
    let st = null;
    try { st = await call("browser_state"); } catch (e) {}
    this._brPolling = false;
    const b = this._br;
    if (!st || !this._browserActive || !b) return;
    if (["starting", "updating", "downloading", "ready", "nohelper"].includes(st.phase)) b.live = true;
    if (st.phase !== b.phase && b.live) {
      b.phase = st.phase;
      switch (st.phase) {
        case "updating": case "downloading": this._browserSetCenter(true); break;
        case "ready": b.ready = true; this._browserSetCenter(false); this._browserSetNote(null); break;
        case "nohelper":
          b.ready = true;
          this._browserSetCenter(false);
          this._browserSetNote("The browser helper isn't active yet: close every LibreWolf window, then open the Internet Browser again.");
          break;
        case "failed": this.audio.play("error", 0.4); this._closeBrowser(true); return;
        case "closed": if (!b.closing) { this._closeBrowser(true); } return;   // closed from LibreWolf itself
      }
    }
    this._browserMeta(st);
    // a page text field got focus → on-screen keyboard (controller users)
    if (b.seq === null) b.seq = st.focusSeq;
    else if (st.focusSeq !== b.seq) {
      b.seq = st.focusSeq;
      if (st.focus && b.ready && !this._brOskOpen && Input.lastKind === "controller" && VIRTUAL_KB.on
          && Date.now() - b.oskClosedAt > 1200) {
        this._browserTypeField(st);
      }
    }
  }

  // Discrete buttons while the browser is up (the sticks and ✕ are fed
  // continuously from the gamepad loop via browserStick(); with the native
  // feed the backend handles them all itself, START aside).
  _browserCtl() {
    if (!this._browserCtlObj) {
      this._browserCtlObj = { onInput: (a) => {
        const b = this._br;
        if (!b || !b.ready) { if (a === "back") this._closeBrowser(); return; }   // (still loading)
        switch (a) {
          case "back": this._browserCmd("closetab"); break;      // ○: close this window
          case "start": this._browserAddress(false); break;      // enter an address
          case "l1": this._browserCmd("back"); break;
          case "r1": this._browserCmd("forward"); break;
          case "l2": this._browserCmd("prevtab"); break;
          case "r2": case "brnexttab": this._browserCmd("nexttab"); break;
          case "l3": this._browserCmd("fullscreen"); break;
        }
      } };
    }
    return this._browserCtlObj;
  }

  _browserCmd(cmd, value) { call("browser_cmd", { cmd, value: value ?? null }).catch(() => {}); }
  _browserInput({ dx = 0, dy = 0, button = null, scroll = 0 }) {
    call("browser_input", { dx, dy, button, scroll }).catch(() => {});
  }

  // Every animation frame from the gamepad loop (no native feed): the left
  // stick → pointer (with a response curve for precision), ✕ → button
  // down/up (so grabbing / dragging works), the right stick → scroll.
  browserStick(lx, ly, ry, cross) {
    const b = this._br;
    if (!this._browserActive || !b) return;
    if (!b.ready || this._brOskOpen) { b.crossPrev = true; b.accX = b.accY = b.accW = 0; return; }
    const dz = 0.16;
    const curve = (v) => {
      const a = Math.abs(v);
      if (a < dz) return 0;
      return Math.sign(v) * Math.pow((a - dz) / (1 - dz), 1.7);
    };
    const speed = 22 * (window.devicePixelRatio || 1);   // px per frame at full tilt
    b.accX += curve(lx) * speed;
    b.accY += curve(ly) * speed;
    const dx = Math.trunc(b.accX), dy = Math.trunc(b.accY);
    b.accX -= dx; b.accY -= dy;
    let button = null;
    // (only a press that started on the page: not the ✕ that closed the keyboard)
    if (cross && !b.crossPrev && !b.down) { button = "down"; b.down = true; }
    else if (!cross && b.down) { button = "up"; b.down = false; }
    b.crossPrev = cross;
    // wheel notches per frame, + = up
    b.accW = (b.accW || 0) - curve(ry) * 0.27;
    const scroll = Math.trunc(b.accW * 120) / 120;
    b.accW -= scroll;
    if (dx || dy || button || scroll) this._browserInput({ dx, dy, button, scroll });
  }

  // On-screen keyboard over the app: the browser window steps aside while it's
  // up (it's a separate, always-on-top window), then comes back.
  _browserOsk(opts, onDone) {
    const b = this._br;
    if (!b || this._brOskOpen) return;
    if (b.down) { b.down = false; this._browserInput({ button: "up" }); }
    this._brOskOpen = true;
    call("browser_visible", { visible: false }).catch(() => {});
    this.overlay = this.textForm;
    const finish = (text) => {
      this.textForm.close();
      this._brOskOpen = false;
      b.oskClosedAt = Date.now();
      if (!this._browserActive) return;
      call("browser_visible", { visible: true }).catch(() => {});
      this.overlay = this._browserCtl();
      if (text != null) onDone(text);
    };
    const field = { key: "v", label: opts.label, value: opts.value || "" };
    if (opts.password) field.type = "password";
    this.textForm.open({ title: opts.title, fields: [field], submit: opts.submit },
      (out) => finish(String(out.v ?? "")), () => finish(null));
  }
  _browserAddress(edit) {
    const url = edit ? (this._br && this._br.url) || "" : "";
    this._browserOsk({ title: edit ? "Edit Address" : "Enter Address", label: "Address", value: url, submit: "Go" },
      (t) => { if (t.trim()) this._browserCmd("navigate", t.trim()); });
  }
  _browserSearch() {
    this._browserOsk({ title: "Search", label: "Search", value: "", submit: "Search" },
      (t) => { if (t.trim()) this._browserCmd("search", t.trim()); });
  }
  // a page text field chosen with the controller: the on-screen keyboard
  // straight away, in front of the page (no "Enter Text" box first)
  _browserTypeField(st) {
    this._browserOskDirect({ title: "Enter Text", value: st.focusValue || "", password: !!st.focusPassword },
      (t) => call("browser_type", { text: t, replace: !!st.focusReplace, enter: true }).catch(() => {}));
  }
  // The browser is a separate window over the app, so the page is kept as a
  // picture (taken the moment before) behind the keyboard while the window
  // steps aside; the window comes back over it when the keyboard closes.
  async _browserOskDirect({ title, value = "", password = false }, onDone) {
    const b = this._br;
    if (!b || this._brOskOpen) return;
    if (b.down) { b.down = false; this._browserInput({ button: "up" }); }
    this._brOskOpen = true;
    let snap = document.getElementById("browser-snap");
    if (!snap) { snap = document.createElement("img"); snap.id = "browser-snap"; snap.alt = ""; document.body.appendChild(snap); }
    try {
      const p = await call("browser_snapshot");
      bumpAsset(p); snap.src = assetUrl(p);
      await snap.decode().catch(() => {});
      snap.classList.add("show");
    } catch (e) {}
    if (!this._browserActive || !this._brOskOpen) { snap.classList.remove("show"); return; }
    call("browser_visible", { visible: false }).catch(() => {});
    const osk = this._brOsk || (this._brOsk = new OnScreenKeyboard(this.audio));
    this.overlay = osk;
    const finish = (text) => {
      osk.close();
      this._brOskOpen = false;
      b.oskClosedAt = Date.now();
      const hide = () => snap.classList.remove("show");
      if (!this._browserActive) { hide(); return; }
      // (the picture goes once the window is back over it)
      call("browser_visible", { visible: true }).catch(() => {}).finally(() => setTimeout(hide, 250));
      this.overlay = this._browserCtl();
      if (text != null) onDone(text);
    };
    this._brOskFinish = finish;
    osk.open(null, { title, initial: value, password }, (t) => finish(String(t ?? "")), () => finish(null));
  }

  // ---- the XMB chrome around the panel (as on the PS3 browser): a grey bar on
  // top with the www icon, page title and address, a grey bar at the bottom
  // with the hovered link, and the spinning loader while LibreWolf starts.
  // (The controls are listed in the Manual.)
  _showBrowserChrome() {
    const el = document.getElementById("browser");
    if (!el) return;
    el.innerHTML =
      `<div class="br-bar br-bar-top"></div><div class="br-bar br-bar-bot"></div>` +
      `<div class="br-top"><span class="br-www"></span>` +
      `<span class="br-name"></span><span class="br-url"></span></div>` +
      `<div class="br-note"></div><div class="br-status"></div>`;
    el.classList.add("show");
    document.body.classList.add("menu-open", "browser-open");
  }
  // loading: the clock at the top right turns as the loading icon (as on the
  // console's browser), over the browser screen's top and bottom bars
  _browserSetCenter(on) {
    document.body.classList.toggle("clock-loading", !!on && !!this._browserActive);
  }
  _browserSetNote(msg) {
    const n = document.querySelector("#browser .br-note");
    if (n) { n.textContent = msg || ""; n.classList.toggle("on", !!msg); }
  }
  _browserMeta(st) {
    const el = document.getElementById("browser");
    const b = this._br;
    if (!el || !b) return;
    const local = (u) => /^https?:\/\/127\.0\.0\.1:48219\//.test(u || "");
    const url = local(st.url) ? "" : (st.url || "");
    const title = local(st.url) ? "" : (st.title || "");
    b.url = url;
    const set = (sel, txt) => {
      const n = el.querySelector(sel);
      if (n && n.textContent !== txt) n.textContent = txt;
    };
    set(".br-name", title);
    set(".br-url", url);
    set(".br-status", st.hover || "");
  }
  _hideBrowserChrome() {
    const el = document.getElementById("browser");
    if (el) { el.classList.remove("show"); el.innerHTML = ""; }
    document.body.classList.remove("menu-open", "browser-open", "clock-loading");
  }

  _closeBrowser(silent) {
    if (!this._browserActive) return;
    const b = this._br;
    if (b) {
      b.closing = true;
      if (b.down) this._browserInput({ button: "up" });
    }
    if (!silent) this.audio.play("back", 0.5);
    call("browser_close").catch(() => {});
    if (this._brTimer) { clearInterval(this._brTimer); this._brTimer = null; }
    if (this._brOskOpen) { this.textForm.close(); if (this._brOsk) this._brOsk.close(); this._brOskOpen = false; }
    document.getElementById("browser-snap")?.classList.remove("show");
    this._browserActive = false;
    this._browserBusy = false;
    this._br = null;
    this._hideBrowserChrome();
    this.overlay = null;
    this._render(); this._onSelect();
  }
  // ---- Change Keybinds
  _openKeybinds() {
    this.audio.play("enter", 0.6);
    // (the Close System key is off while keys are being chosen, so pressing it
    // to bind it doesn't close the app; back on when the menu closes)
    call("set_quit_key", { vk: 0 }).catch(() => {});
    this.overlay = this.keybindMenu;
    this.keybindMenu.open({ actions: KEY_ACTIONS, keybinds: Keybinds, labelOf: keyLabel, onChange: () => {
      this.settings.input = this.settings.input || {};
      this.settings.input.keybinds = { ...JSON.parse(JSON.stringify(Keybinds.map)), _v2: true, _v3: true };
      this._persistSettings();
      this._syncHotkeys();
    } }, () => { this.overlay = null; this._syncHotkeys(); });
  }
  // the screenshot key also works while LibreWolf has focus (read by the backend);
  // the Close System key is read by the backend too (it works even if the page is stuck)
  _syncHotkeys() {
    const code = Keybinds.codesFor("screenshot").map(codeToVk).find((v) => v) || 0;
    // (the next-tab key is handled inside the page by the helper)
    const tabKey = Keybinds.codesFor("brnexttab").find((c) => !/^Mouse/.test(c)) || "";
    call("browser_set_hotkeys", { screenshotVk: code, tabKey, tabVk: codeToVk(tabKey) }).catch(() => {});
    const quit = Keybinds.codesFor("quit").map(codeToVk).find((v) => v) || 0;
    call("set_quit_key", { vk: quit }).catch(() => {});
  }

  // ---- Screenshots: the whole app (and the browser window over it) is saved
  // to the Photos folder as "Screenshot - <date> <time>", following the chosen
  // Date Format / Time Format.
  async screenshot() {
    if (this._shotBusy) return;
    this._shotBusy = true;
    const b = this.settings?.behavior || {};
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    const dd = p2(d.getDate()), mm = p2(d.getMonth() + 1), yy = d.getFullYear();
    const fmt = b.dateFormat || "DD/MM/YYYY";
    // file names can't hold "/" or ":", so look-alike characters stand in:
    // "⧸" (big solidus) between the date's parts, "∶" (ratio) in the time
    const SL = "\u29F8", CO = "\u2236";
    const date = fmt === "MM/DD/YYYY" ? `${mm}${SL}${dd}${SL}${yy}` : fmt === "YYYY/MM/DD" ? `${yy}${SL}${mm}${SL}${dd}` : `${dd}${SL}${mm}${SL}${yy}`;
    const ss = p2(d.getSeconds());
    let time;
    if ((b.timeFormat || "24") === "12") { const h = d.getHours(), h12 = h % 12 || 12; time = `${p2(h12)}${CO}${p2(d.getMinutes())}${CO}${ss} ${h < 12 ? "AM" : "PM"}`; }
    else time = `${p2(d.getHours())}${CO}${p2(d.getMinutes())}${CO}${ss}`;
    try {
      await call("take_screenshot", { name: `Screenshot - ${date} ${time}` });
      this.audio.play("enter", 0.5);
      this._shotFeedback("Screenshot saved to Photos");
      this._refreshPhotoColumn();
    } catch (e) {
      this.audio.play("error", 0.4);
      this._shotFeedback("Couldn't take the screenshot");
    }
    setTimeout(() => { this._shotBusy = false; }, 600);
  }
  _shotFeedback(msg) {
    let fl = document.querySelector(".shot-flash"), t = document.querySelector(".shot-toast");
    if (!fl) { fl = document.createElement("div"); fl.className = "shot-flash"; document.body.appendChild(fl); }
    if (!t) { t = document.createElement("div"); t.className = "shot-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    fl.classList.add("on"); requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove("on")));
    t.classList.add("on"); clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove("on"), 2200);
  }
  // after the video player closes: drop deleted videos and show new icons
  // (Change Icon) in every open level of the Video column, then re-read it
  async _refreshVideos() {
    const del = this._vidDeleted, icons = this._vidIcons;
    this._vidDeleted = null; this._vidIcons = null;
    if (!del && !icons) return;
    const stamp = Date.now();
    const fix = (items) => items.filter((it) => !(it.media && del && del.has(it.media.path))).map((it) => {
      const ic = it.media && icons && icons.get(it.media.path);
      if (ic) {
        it.media.cover = ic.cover; it.media.clip = ic.clip;
        it.icon = { art: ic.cover ? assetUrl(ic.cover) + `?v=${stamp}` : "", clip: ic.clip ? assetUrl(ic.clip) + `?v=${stamp}` : null };
      }
      return it;
    });
    const col = this.columns ? this.columns.find((c) => c.id === "video") : null;
    if (col && this.columns[this.selCat] === col) {
      for (const lvl of this.levels) { lvl.items = fix(lvl.items); if (lvl.sel >= lvl.items.length) lvl.sel = Math.max(0, lvl.items.length - 1); }
      col.items = this.levels[0].items;
      this._render(); this._onSelect();
    }
    if (col && (this.levels.length === 1 || this.columns[this.selCat] !== col)) {
      try { col.items = [...col.items.slice(0, FIXED_ITEMS.video), ...await this._mediaSectionItems("video")]; } catch (e) {}
      if (col.sel != null && col.sel >= col.items.length) col.sel = Math.max(0, col.items.length - 1);
      if (this.columns[this.selCat] === col && this.levels.length === 1) { this.levels[0].items = col.items; this._render(); this._onSelect(); }
    }
  }
  // after the music player closes: deleted songs leave every open level of the
  // Music column and every playlist, then the column is read again
  async _refreshMusicAfterDelete() {
    const del = this._musDeleted; this._musDeleted = null;
    if (!del || !del.size) return;
    let plChanged = false;
    for (const pl of (this.user && this.user.playlists) || []) {
      const n = pl.tracks.length; pl.tracks = pl.tracks.filter((p) => !del.has(p)); if (pl.tracks.length !== n) plChanged = true;
    }
    if (plChanged) this._persistUser();
    const col = this.columns ? this.columns.find((c) => c.id === "music") : null;
    if (!col) return;
    const here = this.columns[this.selCat] === col;
    if (here) {
      for (const lvl of this.levels) {
        lvl.items = lvl.items.filter((it) => !(it.media && del.has(it.media.path)));
        if (lvl.sel >= lvl.items.length) lvl.sel = Math.max(0, lvl.items.length - 1);
      }
      if (this.levels.length === 1) col.items = this.levels[0].items;
      this._render(); this._onSelect();
    }
    if (!here || this.levels.length === 1) {
      try { col.items = await this._musicItems(); } catch (e) {}
      if (col.sel != null && col.sel >= col.items.length) col.sel = Math.max(0, col.items.length - 1);
      if (here && this.levels.length === 1) { this.levels[0].items = col.items; this._render(); this._onSelect(); }
    }
  }
  // new photos (screenshots) show up in the Photo column without a restart
  async _refreshPhotoColumn() {
    const ci = this.columns ? this.columns.findIndex((c) => c.id === "photo") : -1;
    if (ci < 0 || ci === this.selCat) return;
    const col = this.columns[ci];
    col.items = [...col.items.slice(0, FIXED_ITEMS.photo), ...await this._mediaSectionItems("photo")];
  }

  // Photo Gallery visor: a fullscreen viewer of every image saved on the system
  // (prev / next only: no slideshow play/pause; that lives in Playlists).
  async _openPhotoGallery() {
    const media = await call("list_media", { kind: "photo" });
    if (!media.length) { this.audio.play("error", 0.5); return; }
    this.audio.play("enter", 0.6);
    const url = (mm) => assetUrl(mm.path), small = (mm) => thumbUrl(mm.path);
    const openGrid = (start) => {
      this.overlay = this.photoGrid;
      this.photoGrid.open(media, small, (idx) => {
        // view the chosen photo; Back returns to the grid at that photo
        this.photoGrid.close();
        this.overlay = this.photoViewer;
        this.photoViewer.open(media, idx, url, () => { openGrid(idx); this._afterPhotoViewer(); }, this._pvOpts());
      }, () => { this.photoGrid.close(); this.overlay = null; }, start || 0);
    };
    openGrid(0);
  }
  // Which extensions the webview can't play natively and therefore need the
  // backend decoder (kept in sync with audio.rs / the Preload description).
  _needsDecode(pathOrName) {
    const m = /\.([a-z0-9]+)$/i.exec(pathOrName || ""); const e = (m ? m[1] : "").toLowerCase();
    return ["wma", "at3", "at9", "oma", "aa3", "dsf", "dff"].includes(e);
  }
  // Preload All Songs: decode every track in an unsupported format ahead of time
  // so playback is instant. Shows a spinning loader beside the option, then a
  // tick. Decoded WAV paths are cached in this._decoded and reused by the player.
  async _preloadAllSongs() {
    if (this._preloadState === "loading") return;
    this._decoded ||= {};
    // the loader shows (and the menu locks) right away, also while the songs
    // are being listed, so a second press can't start another preload
    this._preloadState = "loading"; this._preloadAct = "preload"; this._preloadTitle = null;
    this._preloadDone = 0; this._preloadTotal = 0;
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    let tracks = [];
    try { tracks = await call("list_media", { kind: "music" }); } catch (e) {}
    const todo = tracks.filter((t) => t && t.path && this._needsDecode(t.path) && !this._decoded[t.path]);
    this._preloadTotal = todo.length;
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    for (const t of todo) {
      try {
        const wav = await call("decode_audio", { path: t.path });
        if (wav) this._decoded[t.path] = wav;
      } catch (e) { /* leave undecoded; player will show the error at play time */ }
      this._preloadDone++;
      this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    }
    this._preloadState = "done";
    this.audio.play("enter", 0.4);
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
  }
  // Preload All Videos: make the playable copy of every video that needs one
  // (ffmpeg remux / conversion), with the same loader + tick as the songs.
  async _preloadAllVideos() {
    if (this._preloadState === "loading") return;
    this._preloadState = "loading"; this._preloadAct = "preloadvideos"; this._preloadTitle = null;
    this._preloadDone = 0; this._preloadTotal = 0;
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    let vids = [];
    this._noAutoConvert = false; this._vplay = new Map();
    try { vids = await call("list_media", { kind: "video" }); } catch (e) {}
    this._preloadTotal = vids.length;
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    let failed = 0;
    for (const v of vids) {
      try { await call("video_preload", { path: v.path }); } catch (e) { failed++; }
      this._preloadDone++;
      this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
    }
    this._preloadState = "done";
    this.audio.play(failed && failed === vids.length ? "error" : "enter", 0.4);
    this._refreshDetail(this.root.clientWidth, this.root.clientHeight);
  }
  async _selectBgMusic() {
    const tracks = await call("list_media", { kind: "music" });
    const playlists = this.user.playlists || [];
    const nSongs = (n) => `${n} song${n !== 1 ? "s" : ""}`;
    // The Square button cycles the list's mode: All songs, By Album (in order or
    // shuffled), or By Artist (albums in release order, or all songs shuffled).
    const MODES = ["all", "album_order", "album_shuffle", "artist_order", "artist_shuffle", "playlist"];
    const MODE_LABELS = {
      all: "All", album_order: "By Album (In Order)", album_shuffle: "By Album (Shuffled)",
      artist_order: "By Artist (In Order)", artist_shuffle: "By Artist (Shuffled)", playlist: "By Playlist",
    };
    let mode = this._bgSelMode && MODES.includes(this._bgSelMode) ? this._bgSelMode : "all";
    const off = { label: "Off", id: JSON.stringify(null) };
    const countBy = (keyFn) => {
      const m = new Map();
      for (const t of tracks) { const k = (keyFn(t) || "").trim(); if (!k) continue; m.set(k, (m.get(k) || 0) + 1); }
      return m;
    };
    const buildItems = () => {
      if (mode === "all") {
        return [off,
          { label: "Shuffle All Songs", id: JSON.stringify({ mode: "shuffleAll" }), sub: nSongs(tracks.length) },
          // every song, A to Z by its name
          // (each song's line under its name is worked out when its row comes into view)
          ...tracks.map((t) => ({ label: t.title || t.name || t.path.split(/[\\/]/).pop(), id: JSON.stringify({ mode: "song", path: t.path }), subFn: () => this._mediaSub("music", t) }))
            .sort((a, b) => cmpNatural(a.label, b.label)),
        ];
      }
      if (mode === "playlist") {
        // each saved playlist, played shuffled
        return [off, ...playlists.map((p) => ({ label: p.name, id: JSON.stringify({ mode: "shufflePlaylist", name: p.name }), sub: nSongs(p.tracks.length) }))];
      }
      if (mode === "album_order" || mode === "album_shuffle") {
        const am = countBy((t) => t.album);
        const albums = [...am.keys()].sort((a, b) => cmpText(a, b));
        const pm = mode === "album_shuffle" ? "albumShuffle" : "album";
        return [off, ...albums.map((a) => ({ label: a, id: JSON.stringify({ mode: pm, name: a }), sub: nSongs(am.get(a)) }))];
      }
      const arm = countBy((t) => t.artist);
      const artists = [...arm.keys()].sort((a, b) => cmpText(a, b));
      const pm = mode === "artist_shuffle" ? "artistShuffle" : "artistOrder";
      return [off, ...artists.map((a) => ({ label: a, id: JSON.stringify({ mode: pm, name: a }), sub: nSongs(arm.get(a)) }))];
    };
    const title = () => MODE_LABELS[mode];
    const cur = JSON.stringify(this.user.bgMusic ?? null);
    const first = buildItems();
    const startIdx = Math.max(0, first.findIndex((it) => it.id === cur));
    this.overlay = this.listPicker;
    this.listPicker.open({ title: title(), items: first, onSquare: () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      this._bgSelMode = mode;
      this.audio.play("enter", 0.4);
      this.listPicker.setList(buildItems(), title());
    } }, (choice) => {
      this.listPicker.close(); this.overlay = null;
      this.user.bgMusic = JSON.parse(choice.id);
      this._persistUser();
      this._applyBgMusic();
    }, () => { this.listPicker.close(); this.overlay = null; });
    this.listPicker.i = startIdx; this.listPicker._upd();
  }

  // Create a playlist: name it, then multi-select songs from a full-screen list.
  async _createPlaylist() {
    const tracks = await call("list_media", { kind: "music" });
    if (!tracks.length) return;
    this.overlay = this.textForm;
    this.textForm.open({ title: "Create Playlist", prompt: "Enter a name for the playlist.", fields: [{ key: "name", label: "Playlist Name", value: "Playlist", required: true }], submit: "Next" },
      ({ name }) => {
        this.textForm.close();
        const items = tracks.map((t) => ({ label: t.title || t.name, id: t.path, sub: this._mediaSub("music", t), thumb: t.cover ? thumbUrl(t.cover) : null }));
        this.overlay = this.listPicker;
        this.listPicker.open({ title: `${name}: pick songs`, items, multi: true, grid: true, submit: "Save Playlist" }, (chosen) => {
          this.listPicker.close(); this.overlay = null;
          if (chosen.length) {
            (this.user.playlists ||= []).push({ name, tracks: chosen });
            this._persistUser();
          }
          this._rebuildAndStay();
        }, () => { this.listPicker.close(); this.overlay = null; });
      }, () => { this.textForm.close(); this.overlay = null; });
  }

  // Add songs to an existing playlist: multi-select from the songs not already
  // in it; the chosen ones are appended.
  async _editPlaylistAdd(name) {
    const pl = (this.user.playlists || []).find((p) => p.name === name); if (!pl) return;
    const tracks = await call("list_media", { kind: "music" });
    const have = new Set(pl.tracks);
    const avail = tracks.filter((t) => !have.has(t.path));
    if (!avail.length) return;
    const items = avail.map((t) => ({ label: t.title || t.name, id: t.path, sub: this._mediaSub("music", t), thumb: t.cover ? thumbUrl(t.cover) : null }));
    this.overlay = this.listPicker;
    this.listPicker.open({ title: `${name}: add songs`, items, multi: true, grid: true, submit: "Add Selected" }, (chosen) => {
      this.listPicker.close(); this.overlay = null;
      if (chosen && chosen.length) { pl.tracks = [...pl.tracks, ...chosen]; this._persistUser(); }
      this._rebuildAndStay();
    }, () => { this.listPicker.close(); this.overlay = null; });
  }

  // Remove songs from a playlist: multi-select of its current tracks; the
  // checked ones are removed.
  async _editPlaylistRemove(name) {
    const pl = (this.user.playlists || []).find((p) => p.name === name); if (!pl) return;
    const tracks = await call("list_media", { kind: "music" });
    const byPath = Object.fromEntries(tracks.map((t) => [t.path, t]));
    const items = pl.tracks.map((path) => ({ label: (byPath[path]?.title) || (byPath[path]?.name) || path.split(/[\\/]/).pop(), id: path, sub: byPath[path] ? this._mediaSub("music", byPath[path]) : "", thumb: byPath[path]?.cover ? thumbUrl(byPath[path].cover) : null }));
    if (!items.length) return;
    this.overlay = this.listPicker;
    this.listPicker.open({ title: `${name}: remove songs`, items, multi: true, grid: true, submit: "Remove Selected" }, (chosen) => {
      this.listPicker.close(); this.overlay = null;
      if (chosen && chosen.length) { const rm = new Set(chosen); pl.tracks = pl.tracks.filter((p) => !rm.has(p)); this._persistUser(); }
      this._rebuildAndStay();
    }, () => { this.listPicker.close(); this.overlay = null; });
  }

  // Create an image playlist: name it, then multi-select photos.
  async _createPhotoPlaylist() {
    const photos = await call("list_media", { kind: "photo" });
    if (!photos.length) { this.audio.play("error", 0.5); return; }
    this.overlay = this.textForm;
    this.textForm.open({ title: "Create Playlist", prompt: "Enter a name for the playlist.", fields: [{ key: "name", label: "Playlist Name", value: "Playlist", required: true }], submit: "Next" },
      ({ name }) => {
        this.textForm.close();
        const items = photos.map((p) => ({ label: noExt(p.title || p.name), id: p.path, sub: this._mediaSub("photo", p), thumb: thumbUrl(p.path) }));
        this.overlay = this.listPicker;
        this.listPicker.open({ title: `${name}: pick photos`, items, multi: true, grid: true, submit: "Save Playlist" }, (chosen) => {
          this.listPicker.close(); this.overlay = null;
          if (chosen.length) {
            (this.user.photoPlaylists ||= []).push({ name, photos: chosen });
            this._persistUser();
          }
          this._rebuildAndStay();
        }, () => { this.listPicker.close(); this.overlay = null; });
      }, () => { this.textForm.close(); this.overlay = null; });
  }

  // Open a photo playlist as an auto-advancing slideshow.
  async _playPhotoSlideshow(name) {
    const pl = (this.user?.photoPlaylists || []).find((p) => p.name === name);
    if (!pl || !pl.photos?.length) { this.audio.play("error", 0.5); return; }
    const media = await call("list_media", { kind: "photo" });
    const byPath = Object.fromEntries(media.map((m) => [m.path, m]));
    const items = pl.photos.map((path) => byPath[path]).filter(Boolean);
    if (!items.length) { this.audio.play("error", 0.5); return; }
    this.audio.play("enter", 0.5);
    this.overlay = this.photoViewer;
    this.photoViewer.open(items, 0, (mm) => assetUrl(mm.path), () => { this.overlay = null; this._afterPhotoViewer(); }, this._pvOpts({ slideshow: true }));
  }

  // Rebuild columns (e.g. after a playlist changes) without losing the spot.
  async _rebuildAndStay() {
    const catId = this.columns[this.selCat]?.id;
    const lvl0 = this.levels[0], depth = this.levels.length, top = this.levels[this.levels.length - 1], ov = this.overlay;
    const sel0 = top && top.sel;
    const run = this._rebuildRun = (this._rebuildRun || 0) + 1;
    // (only this column: the others haven't changed)
    if (!await this._replaceColumn(catId)) await this._buildColumns();
    if (run !== this._rebuildRun) return;            // a newer rebuild took over
    const ci = this.columns.findIndex((c) => c.id === catId);
    // moved on meanwhile (another column, a submenu, a menu over it): the
    // column is up to date for when they come back, and nothing jumps
    const cur = this.levels[this.levels.length - 1];
    if (ci < 0 || this.columns[this.selCat]?.id !== catId || this.levels.length !== depth || this.levels[0] !== lvl0
        || cur !== top || (cur && cur.sel !== sel0) || this.overlay !== ov) {
      if (ci >= 0 && this.selCat === ci && this.levels.length === 1 && !this.overlay) { this.levels[0].items = this.columns[ci].items; this._render(); this._onSelect(); }
      return;
    }
    this.selCat = ci;
    // the Game section stays on its first game / folder after a regroup
    const first = catId === "game" ? Math.min(this._gameFixedCount || 0, this.columns[this.selCat].items.length - 1) : 0;
    this.levels = [{ items: this.columns[this.selCat].items, sel: first }];
    this._render(this.root.clientWidth, this.root.clientHeight); this._onSelect();
  }
  async _applyBgMusic(force = false) {
    const bm = this.user?.bgMusic;
    // Guard: _onSelect calls this on every cursor move, so don't restart (and
    // reshuffle) the same source repeatedly: only re-apply when it changed.
    const key = JSON.stringify(bm ?? null) + "|" + (this.user?.musicEnabled !== false);
    if (!force && key === this._bgKey) return;
    this._bgKey = key;
    if (!bm || this.user?.musicEnabled === false) { this.audio.stopMusic(); return; }
    // bgMusic is either a legacy path string, or { mode, path?, name? }
    const mode = typeof bm === "string" ? "song" : bm.mode;
    // resolve a track to its playable URL: preloaded/decoded WAV if we have one
    // (so unsupported formats play in the background too), else the raw file.
    const play = (p) => assetUrl((this._decoded && this._decoded[p]) || p);
    if (mode === "song") { const p = typeof bm === "string" ? bm : bm.path; this.audio.setMusic(play(p), 0.4); return; }
    const media = await call("list_media", { kind: "music" });
    const known = new Set(media.map((m) => m.path));
    let paths = [];
    let shuffle = true;
    if (mode === "shuffleAll") paths = media.map((m) => m.path);
    else if (mode === "shufflePlaylist") {
      const pl = (this.user.playlists || []).find((p) => p.name === bm.name);
      paths = (pl ? pl.tracks : []).filter((p) => known.has(p));
    } else if (mode === "album") {
      // play the album in track order (by disc/track), not shuffled
      const inAlbum = media.filter((m) => (m.album || "").trim() === bm.name);
      inAlbum.sort((a, b) => ((a.disc || 0) - (b.disc || 0)) || ((a.track || 0) - (b.track || 0)));
      paths = inAlbum.map((m) => m.path);
      shuffle = false;
    } else if (mode === "albumShuffle") {
      // all of the album's songs, shuffled
      paths = media.filter((m) => (m.album || "").trim() === bm.name).map((m) => m.path);
      shuffle = true;
    } else if (mode === "artistShuffle") {
      // all of the artist's songs, shuffled
      paths = media.filter((m) => (m.artist || "").trim() === bm.name).map((m) => m.path);
      shuffle = true;
    } else if (mode === "artistOrder") {
      // the artist's albums in release order (oldest to newest by year), each
      // album played in track order
      const inArtist = media.filter((m) => (m.artist || "").trim() === bm.name);
      const byAlbum = new Map();
      for (const m of inArtist) {
        const al = (m.album || "").trim() || "Unknown";
        if (!byAlbum.has(al)) byAlbum.set(al, []);
        byAlbum.get(al).push(m);
      }
      const albumYear = (arr) => {
        let y = Infinity;
        for (const m of arr) { const yy = parseInt(m.year || "", 10); if (!isNaN(yy)) y = Math.min(y, yy); }
        return y;
      };
      const ordered = [...byAlbum.entries()].sort((a, b) => {
        const ya = albumYear(a[1]), yb = albumYear(b[1]);
        if (ya !== yb) return ya - yb;
        return cmpText(a[0], b[0]);
      });
      paths = [];
      for (const [, arr] of ordered) {
        arr.sort((a, b) => ((a.disc || 0) - (b.disc || 0)) || ((a.track || 0) - (b.track || 0)));
        for (const m of arr) paths.push(m.path);
      }
      shuffle = false;
    }
    this.audio.setBgQueue(paths.map(play), { shuffle, volume: 0.4 });
  }
  _turnOff() {
    // PS3 asks before powering down; Yes closes the app. Centred title with a
    // horizontal Yes/No, matching the real XMB confirm dialog.
    this.overlay = this.confirm;
    this.confirm.open(
      "Do you want to turn off the system?",
      [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }],
      (choice) => {
        this.confirm.close(); this.overlay = null;
        if (choice && choice.id === "yes") { this.audio.play("enter", 0.6); call("quit_app"); }
      },
      () => { this.confirm.close(); this.overlay = null; });
  }
  async _themeBgImage() { return this._themePickLayer("wallpaper", "Choose a Background"); }
  async _themeOverlay() { return this._themePickLayer("overlay", "Choose an Overlay"); }
  // Pictures, GIFs and videos from the Photos and Videos folders.
  async _themePickLayer(key, title) {
    const bgs = await call("list_media", { kind: "background" });
    if (!bgs.length) { this.audio.play("error", 0.5); return; }  // nothing in Photos / Videos
    this.overlay = this.avatarPicker;
    const covers = Object.fromEntries(bgs.filter((b) => b.cover).map((b) => [b.path, b.cover]));
    this.avatarPicker.openImages(bgs.map((b) => b.path), this.user.theme[key], async (path) => {
      this.avatarPicker.close(); this.overlay = null;
      await this._convertForBackground([path]);       // (a video that needs it is converted first)
      this.user.theme[key] = path; this._applyWallpaper(); this._persistUser();
    }, () => { this.avatarPicker.close(); this.overlay = null; }, title, covers);
  }
  _themeBgRemove() {
    this.user.theme.wallpaper = null; this._applyWallpaper(); this._persistUser();
    this.audio.play("enter", 0.5);
  }
  _themeOverlayRemove() {
    this.user.theme.overlay = null; this._applyWallpaper(); this._persistUser();
    this.audio.play("enter", 0.5);
  }
  async _refreshFriendsCard() {
    const fcol = this.columns.find((c) => c.id === "friends");
    if (!fcol) return;
    fcol.items = await this._friendsItems();
    if (this.columns[this.selCat]?.id === "friends")
      this._renderItems(this.root.clientWidth, this.root.clientHeight);
  }
  async _psnProfile() {
    // edit the SAME acct object the inline playercard item holds, so changes show
    // live without a backend round-trip (fixes stale/refresh-only updates).
    const fcol = this.columns.find((c) => c.id === "friends");
    const pcItem = fcol && fcol.items.find((it) => it.kind === "playercard");
    let acct = pcItem && pcItem.acct;
    if (!acct) { const psn = await call("list_psn_accounts"); acct = psn.accounts.find((a) => a.id === this.user.psnAccountId); }
    if (!acct) return;
    const colors = CARD_COLORS.slice();
    this._userLevel ||= 1;
    this.overlay = this.profileCard;
    this.profileCard.open(acct, { colors, colorPicker: this.colorPicker, msgLimit: MSG_LIMIT, level: this._userLevel, onChange: (a) => {
      acct.background = a.background; acct.comment = a.comment;       // live-mutate the item's data
      if (this.columns[this.selCat]?.id === "friends")
        this._renderItems(this.root.clientWidth, this.root.clientHeight); // reflect immediately
      call("save_psn_account", { account: { ...acct } });            // persist in background
    } }, () => { this.overlay = null; this._render(); this._onSelect(); });
  }
  // PSN Sign-Up / Sign-In: the console's Sign-In screen (ui.js PsnSignIn).
  // Both end on the "Signing in... / Please wait." screen with the loading
  // clock while the PSN column (account, friends) loads; ○ cancels it.
  _psnFormValues(extra = {}) {
    const saved = this.user.psnSaved || {};
    return { email: saved.email || "", password: saved.password || "",
      auto: this.user.psnAutoSignIn === true && !!saved.password, save: !!saved.password, ...extra };
  }
  // an error message over the form; OK goes back to it
  _psnFormError(msg) {
    const form = this.psnSignInForm;
    this.audio.play("error", 0.6);
    this.overlay = this.confirm;
    const back = () => { this.confirm.close(); this.overlay = form; form._render(); };
    this.confirm.open(msg, [{ label: "OK", id: "ok" }], back, back);
  }
  // the loading screen: at least ~1 s (like the console); resolves false if cancelled
  async _psnWait(text) {
    const form = this.psnSignInForm;
    let cancelled = false, wake;
    const cancelP = new Promise((r) => { wake = r; });
    form.loading(text, () => { cancelled = true; wake(); });
    this._loadingBegin();
    await Promise.race([new Promise((r) => setTimeout(r, 1100)), cancelP]);
    if (cancelled) { this._loadingQuit(); return false; }
    return true;
  }
  async _psnFinish(acct, out) {
    const form = this.psnSignInForm;
    this.user.psnAccountId = acct.id; this.user.psnLinkedId = acct.id;
    this.user.psnAutoSignIn = !!out.auto;
    // Save Password (always on with Auto Sign-In) keeps the ID and password; the ID is kept either way
    this.user.psnSaved = { email: out.email, password: out.save || out.auto ? out.password : "" };
    await call("save_user", { user: this.user });
    this.cbs.onProfileChange(this.user);
    await this._reloadPsn();
    await this._loadingSettle(); this._loadingDone();
    form.close(); this.overlay = null; this._render(); this._onSelect();
  }
  _psnSignUp(prefill = {}) {
    const form = this.psnSignInForm;
    this.overlay = form;
    form.open({ mode: "signup", onlineId: "", email: "", password: "", ...prefill },
      async (out) => {
        const psn = await call("list_psn_accounts");
        const all = psn.accounts || [];
        const low = (x) => String(x || "").toLowerCase();
        // (signing up: the console's rules; edited afterwards (Edit Online
        // ID), up to 255 characters of any kind)
        if (!/^[A-Za-z0-9_-]{3,16}$/.test(out.onlineId))
          return this._psnFormError("The Online ID must be 3 to 16 characters long, using only letters, numbers, hyphens (-) and underscores (_).");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) return this._psnFormError("The Sign-In ID (E-mail Address) is not valid.");
        if (all.some((a) => low(a.onlineId) === low(out.onlineId))) return this._psnFormError("This Online ID is already in use.");
        if (all.some((a) => low(a.email) === low(out.email))) return this._psnFormError("This Sign-In ID (E-mail Address) is already in use.");
        if (!(await this._psnWait("Signing up...\nPlease wait."))) { form._render(); return; }
        const acct = await call("save_psn_account", { account: {
          id: "", onlineId: out.onlineId.slice(0, 16), email: out.email, password: out.password,
          avatar: "stock:square_grey", country: "CL", friendsOnline: Math.floor(Math.random() * 8) } });
        await this._psnFinish(acct, out);
      },
      () => { form.close(); this.overlay = null; },
      (v) => { this._psnSignIn({ email: v.email || "", password: "" }); });
  }
  async _psnSignIn(prefill = null) {
    const form = this.psnSignInForm;
    this.overlay = form;
    form.open({ mode: "signin", ...this._psnFormValues(prefill || {}) },
      async (out) => {
        // the Sign-In ID is the e-mail address or the Online ID
        const id = out.email.toLowerCase();
        if (!(await this._psnWait("Signing in...\nPlease wait."))) { form._render(); return; }
        const psn = await call("list_psn_accounts");
        const acct = (psn.accounts || []).find((a) =>
          (String(a.email || "").toLowerCase() === id || String(a.onlineId || "").toLowerCase() === id) && a.password === out.password);
        if (!acct) {
          this._loadingQuit();
          form._render();
          return this._psnFormError("The Sign-In ID or password is incorrect.");
        }
        await this._psnFinish(acct, out);
      },
      () => { form.close(); this.overlay = null; },
      (v) => this._psnForgot(v.email));
  }
  // "Forgot your password?": set a new password for that Sign-In ID (e-mail or Online ID)
  async _psnForgot(email) {
    const psn = await call("list_psn_accounts");
    const id = String(email || "").toLowerCase();
    const acct = id && (psn.accounts || []).find((a) => String(a.email || "").toLowerCase() === id || String(a.onlineId || "").toLowerCase() === id);
    if (!acct) return this._psnFormError(id ? "There is no account with this Sign-In ID." : "Enter your Sign-In ID first.");
    const back = () => { this.overlay = this.psnSignInForm; this.psnSignInForm._render(); };
    this.overlay = this.textForm;
    this.textForm.open({ title: "Set a New Password", submit: "Confirm",
      fields: [{ key: "password", label: `New password for ${acct.email}`, type: "password", required: true }] },
      async (out) => {
        this.textForm.close();
        acct.password = out.password;
        await call("save_psn_account", { account: acct });
        this.psnSignInForm.v.password = ""; back();
      },
      () => { this.textForm.close(); back(); });
  }
  async _psnSignOut() {
    this.user.psnAccountId = null; await call("save_user", { user: this.user });
    this.cbs.onProfileChange(this.user); await this._reloadPsn();
  }
  async _psnEditId() {
    const psn = await call("list_psn_accounts");
    const acct = psn.accounts.find((a) => a.id === this.user.psnAccountId); if (!acct) return;
    this.overlay = this.textForm;
    this.textForm.open({ title: "Edit Online ID", submit: "Save", fields: [{ key: "onlineId", label: "Online ID", value: acct.onlineId, required: true, max: NAME_LIMIT }] },
      async (out) => { this.textForm.close(); this.overlay = null; await call("save_psn_account", { account: { ...acct, onlineId: [...String(out.onlineId).trim()].slice(0, NAME_LIMIT).join("") || acct.onlineId } }); await this._refreshFriendsCard(); this.cbs.onProfileChange(this.user); },
      () => { this.textForm.close(); this.overlay = null; });
  }
  async _psnAvatar() {
    const psn = await call("list_psn_accounts");
    const acct = psn.accounts.find((a) => a.id === this.user.psnAccountId); if (!acct) return;
    this.overlay = this.avatarPicker;
    this.avatarPicker.open(acct.avatar, { set: "psn" }, async (ref) => {
      this.avatarPicker.close(); this.overlay = null;
      await call("save_psn_account", { account: { ...acct, avatar: ref } });
      await this._refreshFriendsCard();
      this._render(); this._onSelect();
      this.cbs.onProfileChange(this.user);
    }, () => { this.avatarPicker.close(); this.overlay = null; });
  }
  async _reloadPsn() {
    // (the PlayStation Network and Friends columns)
    if (!await this._replaceColumn("psn")) await this._buildColumns();
    else await this._replaceColumn("friends");
    this.selCat = this.columns.findIndex((c) => c.id === "psn");
    this.levels = [{ items: this.columns[this.selCat].items, sel: 0 }];
    this._render(); this._onSelect();
  }

  // ------------------------------------------------------------- media view
  _openMusicPlayer() {
    const lvl = this._level();
    const tracks = lvl.items.filter((it) => it.kind === "music").map((it) => it.media);
    const start = lvl.items.slice(0, lvl.sel).filter((it) => it.kind === "music").length;
    this.overlay = this.musicPlayer;
    this.musicPlayer.open(tracks, start, (m) => assetUrl(m.path), () => { this.overlay = null; this._refreshMusicAfterDelete(); },
      { onAddToPlaylist: (track) => this._addTrackToPlaylist(track),
        onDeleted: (t) => { (this._musDeleted ||= new Set()).add(t.path); },
        decodedFor: (t) => (t && this._decoded && this._decoded[t.path]) || null });
  }

  // "Add to Playlist" from inside the music player: pick an existing playlist
  // (or create a new one) and add the current track to it. The player stays
  // open underneath and audio keeps playing.
  _addTrackToPlaylist(track) {
    if (!track || !track.path) return;
    const path = track.path;
    const pls = () => (this.user.playlists ||= []);
    const backToPlayer = () => { this.overlay = this.musicPlayer; document.body.classList.add("menu-open"); };
    this.overlay = this.playlistPicker;
    this.playlistPicker.open({ thumb: track.cover ? assetUrl(track.cover) : null, thumbTint: track.cover ? null : sysUrl("icon_music_default.png"),
      name: track.title || String(track.name || "").replace(/\.[^.]+$/, ""), date: [track.artist, track.album].filter(Boolean).join(" / "),
      playlists: pls().map((p) => ({ name: p.name, count: (p.tracks || []).length })), noun: ["Track", "Tracks"],
      folderIcon: "./assets/icons/theme/icon_playlist.png" }, (ch) => {
      this.playlistPicker.close();
      if (ch === "new") {
        this._askPlaylistName("Playlist", (name) => { pls().push({ name, tracks: [path] }); this._persistUser(); backToPlayer(); }, backToPlayer);
        return;
      }
      const pl = pls()[ch];
      if (pl && !(pl.tracks ||= []).includes(path)) { pl.tracks.push(path); this._persistUser(); }
      backToPlayer();
    }, () => { this.playlistPicker.close(); backToPlayer(); });
  }

  async _openViewer(kind, m) {
    const lvl = this._level();
    const items = lvl.items.filter((it) => it.kind === kind).map((it) => it.media);
    const start = lvl.items.slice(0, lvl.sel).filter((it) => it.kind === kind).length;
    const viewer = kind === "photo" ? this.photoViewer : this.videoViewer;
    this.overlay = viewer;
    if (kind === "video") {
      let subs = [];
      try { subs = await call("list_media", { kind: "subtitle" }) || []; } catch (e) {}
      viewer.open(items, start, (mm) => assetUrl(mm.path), () => { this.overlay = null; this._refreshVideos(); }, {
        subs, subResolve: (p) => assetUrl(p),
        onDeleted: (it) => { (this._vidDeleted ||= new Set()).add(it.path); },
        onIconChanged: (it, cover, clip) => { (this._vidIcons ||= new Map()).set(it.path, { cover, clip }); },
      });
      return;
    }
    viewer.open(items, start, (mm) => assetUrl(mm.path), () => { this.overlay = null; this._afterPhotoViewer(); }, this._pvOpts());
  }
  // ---- Photo Viewer hooks -------------------------------------------------
  _pvOpts(extra = {}) {
    return {
      fmtDate: (d) => this._fmtDateTime(d),
      onDeleted: () => { this._pvChanged = true; },
      // a rotated picture is written when the viewer closes (after onClose):
      // show the new file everywhere, refreshing again if the viewer is gone
      onSaved: (path, rewritten) => {
        if (rewritten) bumpAsset(path);
        this._pvChanged = true;
        if (this.overlay !== this.photoViewer) { clearTimeout(this._pvRefT); this._pvRefT = setTimeout(() => this._afterPhotoViewer(), 60); }
      },
      onWallpaper: (path) => {
        if (!this.user) return;
        this.user.theme.wallpaper = path; this._persistUser(); this._applyWallpaper();
      },
      onAddToPlaylist: (item, thumb) => this._addPhotoToPlaylist(item, thumb),
      ...extra,
    };
  }
  async _afterPhotoViewer() {
    if (!this._pvChanged) return;
    this._pvChanged = false;
    await this._refreshMediaColumns();
    if (this.columns[this.selCat] && this.columns[this.selCat].id === "photo") this._rebuildAndStay();
  }
  // Add to Playlist (Photo Viewer): pick a photo playlist or make a new one;
  // the viewer stays open underneath
  _addPhotoToPlaylist(item, thumb) {
    const path = item.path;
    const back = () => { this.overlay = this.photoViewer; document.body.classList.add("menu-open"); };
    const pls = () => (this.user.photoPlaylists ||= []);
    const d = item.modified ? new Date(item.modified * 1000) : null;
    this.overlay = this.playlistPicker;
    this.playlistPicker.open({ thumb, name: noExt(item.title || item.name || ""), date: d ? this._fmtDateTime(d) : "",
      playlists: pls().map((p) => ({ name: p.name, count: (p.photos || []).length })), noun: ["Image", "Images"],
      folderIcon: "./assets/icons/theme/icon_playlist.png" }, (ch) => {
      this.playlistPicker.close();
      if (ch === "new") {
        this._askPlaylistName(`Playlist`, (name) => { pls().push({ name, photos: [path] }); this._persistUser(); this._pvChanged = true; back(); }, back);
        return;
      }
      const pl = pls()[ch];
      if (pl && !(pl.photos ||= []).includes(path)) { pl.photos.push(path); this._persistUser(); this._pvChanged = true; }
      back();
    }, () => { this.playlistPicker.close(); back(); });
  }
  // "Enter a name for the playlist." (a name that's taken gets a number)
  _askPlaylistName(def, done, cancel) {
    this.overlay = this.textForm;
    this.textForm.open({ title: "Create Playlist", prompt: "Enter a name for the playlist.", fields: [{ key: "name", label: "Playlist Name", value: def, required: true }], submit: "OK" },
      (out) => { this.textForm.close(); done(String(out.name || "").trim() || def); },
      () => { this.textForm.close(); cancel && cancel(); });
  }

  // Left/right handling. On a setting, adjust it in place and stay put. Inside a
  // drilled submenu the side keys do NOTHING else: a submenu is left ONLY with
  // Circle / Esc (the "back" action), never with Left. At the top level the side
  // keys move between category columns.
  // moving in a picture grid (rows of five; it's left only with Circle)
  _gridMove(d) {
    const lvl = this._level(), w = this.root.clientWidth, h = this.root.clientHeight;
    let n = lvl.sel + d;
    if (Math.abs(d) === GRID_COLS) {
      if (n < 0) return;
      if (n >= lvl.items.length) { if (Math.floor(lvl.sel / GRID_COLS) === Math.floor((lvl.items.length - 1) / GRID_COLS)) return; n = lvl.items.length - 1; }
    } else if (n < 0 || n >= lvl.items.length) return;
    lvl.sel = n;
    this.audio.play(d < 0 ? "cursor_up" : "cursor_down", 0.5);
    this._layoutItems(w, h); this._onSelect();
  }
  _navSide(dir) {
    if (this._level().grid && !this.overlay) {
      const lvl = this._level();
      // only Circle leaves the folder: left stops at the first column
      if (dir < 0 && lvl.sel % GRID_COLS === 0) return;
      if (dir > 0 && (lvl.sel % GRID_COLS === GRID_COLS - 1 || lvl.sel >= lvl.items.length - 1)) return;
      this._gridMove(dir); return;
    }
    const it = this._level().items[this._level().sel];
    // settings are changed only from their menu (✕)
    if (it?.kind === "setting") {
      return;
    }
    if (this.levels.length > 1) return;   // inside a submenu: side keys do nothing
    const ni = this.selCat + dir;
    if (!this.locked && ni >= 0 && ni < this.columns.length) this._gotoCat(ni);
  }

  // ------------------------------------------------------------------ input
  // Low performance mode: 1 while the app is out of focus, 2 while a game runs
  // (the wave slows down / stops, animations and background videos pause)
  setLowPower(level) {
    if (this._inGame && level < 2) level = 2;
    // Power Save Settings: off (a running game still stops everything)
    if (!this.settings?.behavior?.lowPowerMode && !this._inGame) level = 0;
    if (this._lowPower === level) return;
    this._lowPower = level;
    this.wave.setLowPower(level);
    document.body.classList.toggle("lowpower", level > 0);
    // everything on screen holds still (sound, the clock box and loading icons
    // aside): muted videos (background, overlay, game / video previews) pause,
    // GIFs freeze on the frame they're showing, CSS animations pause (styles.css)
    for (const v of document.querySelectorAll("video")) {
      if (v.closest("#mediaview") || !v.muted && !v.closest("#wallpaper, #overlay")) continue;   // the Video Player keeps playing
      if (level > 0) { if (!v.paused) { v.pause(); v._lpPaused = true; } }
      else if (v._lpPaused) {
        v._lpPaused = false;
        // (covered by the Photo Viewer / Video Player: it starts when they close)
        if (this._bgCovered && v.closest("#wallpaper, #overlay")) v._cover = { t: v.currentTime || 0, at: performance.now() };
        else v.play().catch(() => {});
      }
    }
    if (level > 0) this._freezeGifs(); else this._thawGifs();
  }
  _bgVideos() { return [...document.querySelectorAll("#wallpaper video, #overlay video")]; }
  _coverBgVideos(on) {
    if (!!this._bgCovered === on) return;
    this._bgCovered = on;
    const now = performance.now();
    for (const v of this._bgVideos()) {
      if (on) {
        if (!v.paused) { v._cover = { t: v.currentTime || 0, at: now }; v.pause(); }
        continue;
      }
      const c = v._cover; if (!c) continue;
      v._cover = null;
      // where it would be by now (a looping video goes round)
      let t = c.t + (now - c.at) / 1000;
      const d = v.duration;
      if (isFinite(d) && d > 0) t = v.loop ? t % d : Math.min(t, d);
      try { v.currentTime = t; } catch (e) {}
      // (with low performance mode on, it stays paused until that ends)
      if (this._lowPower > 0) v._lpPaused = true; else v.play().catch(() => {});
    }
  }
  // A GIF can't be paused, so a canvas showing its current frame takes its
  // place (same box, transform and fit) until low performance mode ends.
  _freezeGifs() {
    const isGif = (src) => /\.gif([?#]|$)/i.test(src || "") || /^data:image\/gif/i.test(src || "");
    for (const img of document.querySelectorAll("img")) {
      if (img._lpCanvas || !isGif(img.currentSrc || img.src) || !img.complete || !img.naturalWidth) continue;
      if (img.closest("#infobox") || img.offsetParent === null) continue;
      const cs = getComputedStyle(img), w = img.offsetWidth, h = img.offsetHeight;
      if (!w || !h) continue;
      const c = document.createElement("canvas"), dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const ctx = c.getContext("2d"), nw = img.naturalWidth, nh = img.naturalHeight;
      const fit = cs.objectFit;
      let k = fit === "cover" ? Math.max(w / nw, h / nh) : fit === "contain" || fit === "scale-down" ? Math.min(w / nw, h / nh) : null;
      if (fit === "scale-down") k = Math.min(1, k);
      const dw = k ? nw * k : w, dh = k ? nh * k : h;
      try { ctx.drawImage(img, (w - dw) / 2 * dpr, (h - dh) / 2 * dpr, dw * dpr, dh * dpr); } catch (e) { continue; }
      Object.assign(c.style, { position: "absolute", left: `${img.offsetLeft}px`, top: `${img.offsetTop}px`, width: `${w}px`, height: `${h}px`,
        margin: "0", transform: cs.transform === "none" ? "" : cs.transform, transformOrigin: cs.transformOrigin, opacity: cs.opacity,
        filter: cs.filter === "none" ? "" : cs.filter, borderRadius: cs.borderRadius, zIndex: cs.zIndex === "auto" ? "" : cs.zIndex, pointerEvents: "none" });
      c.className = "lp-frozen";
      img.insertAdjacentElement("afterend", c);
      img._lpCanvas = c; img._lpVis = img.style.visibility; img.style.visibility = "hidden";
      this._frozen = this._frozen || new Set(); this._frozen.add(img);
    }
  }
  _thawGifs() {
    for (const img of this._frozen || []) {
      if (img._lpCanvas) img._lpCanvas.remove();
      img._lpCanvas = null; img.style.visibility = img._lpVis || "";
    }
    this._frozen = null;
  }
  setContext(settings, appInfo) { this.settings = settings; this.appInfo = appInfo; VIRTUAL_KB.on = settings?.behavior?.virtualKeyboard !== false; }

  // After 4 s without any action on one row, the other rows' titles fade out
  // (Photo, Music, Video, Game, Network and PSN). Any action brings them back.
  _armIdle() {
    clearTimeout(this._idleT);
    if (this.$items) this.$items.classList.remove("labels-idle");
    const col = this.columns && this.columns[this.selCat];
    if (!col || !IDLE_FADE_COLS.includes(col.id) || this.overlay) return;
    const lvl = this._level(); const it = lvl && lvl.items[lvl.sel];
    if (!it) return;
    this._idleT = setTimeout(() => {
      const l2 = this._level();
      if (!this.overlay && l2 && l2.items[l2.sel] === it && this.$items) this.$items.classList.add("labels-idle");
    }, 4000);
  }

  onInput(a) {
    this._armIdle(); this._inputAt = performance.now();
    // while Preload All Songs is running, the menu is locked: no navigation,
    // no leaving, no other action until it finishes.
    if (this._preloadState === "loading" || this._busy || this._signingIn || this._launching) return;
    if (this.overlay) { this.overlay.onInput(a); return; }
    if (this._placing) { this._placeInput(a); return; }     // moving a section
    if (this._busy) return;                                   // converting a video
    if (this._actBusy) return;                                // something chosen is still working (see _trackBusy)
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const lvl = this._level();
    switch (a) {
      case "left": this._navSide(-1); break;
      case "right": this._navSide(1); break;
      case "up": if (lvl.grid) { this._gridMove(-GRID_COLS); break; } if (lvl.sel > 0) { lvl.sel--; this.audio.play("cursor_up", 0.5); this._layoutItems(w, h); this._onSelect(); } break;
      case "down": if (lvl.grid) { this._gridMove(GRID_COLS); break; } if (lvl.sel < lvl.items.length - 1) { lvl.sel++; this.audio.play("cursor_down", 0.5); this._layoutItems(w, h); this._onSelect(); } break;
      case "enter": this._trackBusy(this._activate()); break;
      case "options": this._trackBusy(this._options()); break;
      case "square": this._trackBusy(this._cycleMediaMode()); break;
      case "back": this._back(); break;
    }
  }

  // Square, at the top level of Music / Photo / Video, cycles the sort mode
  // (All / By Album / …) and rebuilds that section in place.
  _cycleMediaMode() {
    if (this._secCycleMode()) return;                   // inside a custom section's subsection
    if (this.levels.length > 1) return;                 // only at the section root
    const id = this.columns[this.selCat] && this.columns[this.selCat].id;
    if (!MEDIA_MODES[id]) return;
    const modes = MEDIA_MODES[id];
    const cur = Math.max(0, modes.findIndex((m) => m.id === this._mediaMode(id)));
    this.mediaMode[id] = modes[(cur + 1) % modes.length].id;
    // persist the chosen media ordering so it survives a restart
    if (this.user) { this.user.mediaMode = this.mediaMode; this._persistUser(); }
    this.audio.play("enter", 0.4);
    return Promise.resolve(this._rebuildAndStay()).then(() => this._updateMediaSort(true));
  }
}

// ---------------------------------------------------------- view helpers
// Named colours (common names) for the Background / Icon colour options.
// PS3 games a fake friend can be "playing". Derived from their message first,
// then their name, then a random PS3 title (exclusive-leaning). All PS3-era.
const GAME_KEYWORDS = [
  [/uncharted/i, "Uncharted 3: Drake's Deception"],
  [/(littlebigplanet|lbp)/i, "LittleBigPlanet 2"],
  [/demon'?s souls/i, "Demon's Souls"],
  [/last of us/i, "The Last of Us"],
  [/killzone/i, "Killzone 3"],
  [/gran turismo|gt5/i, "Gran Turismo 5"],
  [/(mgs|metal gear solid)/i, "Metal Gear Solid 4"],
  [/metal gear rising|revengeance|raiden/i, "Metal Gear Rising: Revengeance"],
  [/infamous/i, "inFAMOUS 2"],
  [/journey/i, "Journey"],
  [/twisted metal/i, "Twisted Metal"],
  [/ratchet/i, "Ratchet & Clank: A Crack in Time"],
  [/god of war|gow/i, "God of War III"],
  [/resistance/i, "Resistance 2"],
  [/heavy rain/i, "Heavy Rain"],
  [/dead space|isaac/i, "Dead Space 2"],
  [/sackboy|sack/i, "LittleBigPlanet 2"],
  [/kratos/i, "God of War III"],
  [/ellie/i, "The Last of Us"],
  [/cole|macgrath/i, "inFAMOUS 2"],
  [/snake/i, "Metal Gear Solid 4"],
  [/hale/i, "Resistance 2"],
  [/drake|sully|chloe|nate/i, "Uncharted 2: Among Thieves"],
];
const RANDOM_PS3_GAMES = [
  "Uncharted 2: Among Thieves", "God of War III", "The Last of Us", "LittleBigPlanet 2",
  "Gran Turismo 5", "inFAMOUS 2", "Killzone 3", "Demon's Souls", "Ratchet & Clank: A Crack in Time",
  "Heavy Rain", "Journey", "MotorStorm: Apocalypse", "Resistance 3", "Ni no Kuni: Wrath of the White Witch",
  "Metal Gear Solid 4", "Twisted Metal", "Uncharted 3: Drake's Deception", "Beyond: Two Souls",
  "3D Dot Game Heroes", "Tokyo Jungle", "LittleBigPlanet Karting", "Sly Cooper: Thieves in Time",
];
function gameFor(message, name) {
  for (const [re, game] of GAME_KEYWORDS) if (re.test(message)) return game;
  for (const [re, game] of GAME_KEYWORDS) if (re.test(name)) return game;
  return RANDOM_PS3_GAMES[Math.floor(Math.random() * RANDOM_PS3_GAMES.length)];
}

const NAMED_COLORS = [
  { name: "White", hex: "#ffffff" }, { name: "Light Blue", hex: "#4db3d0" },
  { name: "Blue", hex: "#3f6fd0" }, { name: "Green", hex: "#2f9e44" },
  { name: "Yellow", hex: "#e0b020" }, { name: "Orange", hex: "#d5702a" },
  { name: "Red", hex: "#c0392b" }, { name: "Pink", hex: "#d06fa0" },
  { name: "Purple", hex: "#8f7fd6" }, { name: "Brown", hex: "#8a6a3a" },
  { name: "Grey", hex: "#7a8391" }, { name: "Black", hex: "#1a1a1a" },
];
const BG_LIST = [{ name: "Original", hex: "auto" }, ...NAMED_COLORS];
// Background Color / Wave Color / Sparkle Color: the console's Theme Settings
// > Color squares (measured from a capture), after "Original"
const THEME_COLORS = [
  { name: "Silver", hex: "#b8bfca" }, { name: "Yellow", hex: "#ccb81c" }, { name: "Lime", hex: "#73a928" },
  { name: "Pink", hex: "#de6e81" }, { name: "Green", hex: "#1d7b1d" }, { name: "Lavender", hex: "#926fbd" },
  { name: "Turquoise", hex: "#24b8ab" }, { name: "Blue", hex: "#0837a6" }, { name: "Purple", hex: "#8d359b" },
  { name: "Orange", hex: "#c39011" }, { name: "Brown", hex: "#644317" }, { name: "Red", hex: "#b83524" },
];
const THEME_LIST = [{ name: "Original", hex: "auto" }, ...THEME_COLORS];
// Background Color: Original (the month's colours), the squares, the Visualizer Wave
const BG_SQUARES = [{ name: "Original", hex: "auto" }, ...SQUARE_LOOKS.map((q) => ({ name: q.name, hex: q.hex, swatch: q.swatch }))];
const SQUARE_CTLS = ["bgcolor"];
// the Visualizer Wave: in Background Color (its background) and Wave Color (its wave and sparkles)
// (shown by name, like Original and Custom Color…: no square)
const VIS_COLOR = { name: "Visualizer", hex: "visualizer" };
const colorListFor = (ctl) => ctl === "chromakey" ? KEY_LIST : ctl === "bgcolor" ? [...BG_SQUARES, VIS_COLOR] : (ctl === "wavecolor" || ctl === "dotcolor") ? [...BG_LIST, VIS_COLOR]
  : SQUARE_CTLS.includes(ctl) ? THEME_LIST : BG_LIST;
// Picture Duration (Background / Overlay Shuffle), seconds
// "1 Hour 2 Minutes 5 Seconds"
const fmtSecs = (n) => {
  const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), sec = n % 60, pl = (v, w) => `${v} ${w}${v !== 1 ? "s" : ""}`;
  return [h && pl(h, "Hour"), m && pl(m, "Minute"), (sec || !(h || m)) && pl(sec, "Second")].filter(Boolean).join(" ");
};
// Overlay Key Color: the two usual screens (a custom colour joins via △)
const KEY_LIST = [{ name: "Green", hex: "green" }, { name: "Blue", hex: "blue" }];
// Card background colours (player + friend cards): white is excluded because a
// white card reads poorly behind the white bubble and light text.
// Card colours (player + friend cards): the console's 20 profile colours, in
// its own order (5 × 4 squares, measured from a capture). Only the cards use
// these; the other colour settings keep NAMED_COLORS.
const CARD_COLORS = [
  { name: "Grey", hex: "#868485" }, { name: "Sky Blue", hex: "#3ab6ff" }, { name: "Turquoise", hex: "#37bba6" },
  { name: "Lime", hex: "#7bc015" }, { name: "Amber", hex: "#f7a911" },
  { name: "Orange", hex: "#f15211" }, { name: "Rose", hex: "#ef2f62" }, { name: "Pink", hex: "#f15dab" },
  { name: "Lavender", hex: "#9e69b9" }, { name: "Periwinkle", hex: "#6674cd" },
  { name: "Red", hex: "#c21322" }, { name: "Blue", hex: "#1b578d" }, { name: "Green", hex: "#2e7e49" },
  { name: "Olive", hex: "#566137" }, { name: "Bronze", hex: "#9a662d" },
  { name: "Indigo", hex: "#2f0048" }, { name: "Plum", hex: "#640036" }, { name: "Maroon", hex: "#62000d" },
  { name: "Brown", hex: "#534032" }, { name: "Charcoal", hex: "#2c2a2d" },
];
const CARD_DEFAULT = CARD_COLORS[0].hex;
function colorName(hex, includeAuto) {
  if (includeAuto && (!hex || hex === "auto")) return "Original";
  if (hex === "visualizer") return VIS_COLOR.name;
  const hit = [...SQUARE_LOOKS, ...NAMED_COLORS, ...THEME_COLORS].find((c) => c.hex.toLowerCase() === String(hex).toLowerCase());
  return hit ? hit.name : (hex ? `Custom Color (${String(hex).toUpperCase()})` : "Original");
}
// --icon-color takes the RGB part; a custom colour's opacity goes to --icon-alpha
// Music Player / Video Player / Photo Viewer icons take the Icon Color too: an
// SVG colour filter (#icon-tint) turns their white into the colour (format
// badges and the progress bar don't use it)
function setPlayerIconTint(c) {
  let f = document.getElementById("icon-tint-matrix");
  if (!f) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute";
    svg.innerHTML = `<filter id="icon-tint" color-interpolation-filters="sRGB"><feColorMatrix id="icon-tint-matrix" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>`;
    document.body.appendChild(svg);
    f = document.getElementById("icon-tint-matrix");
  }
  const r = c.r / 255, g = c.g / 255, b = c.b / 255, a = c.a ?? 1;
  const row = (k) => `${(k * 0.2126).toFixed(4)} ${(k * 0.7152).toFixed(4)} ${(k * 0.0722).toFixed(4)} 0 0`;
  f.setAttribute("values", `${row(r)} ${row(g)} ${row(b)} 0 0 0 ${a} 0`);
}
// Icon Color "Original": the colour the background gives the icons right now
// (set by the wave, see WaveBackground._updateIconAuto)
let ICON_AUTO_RGB = [1, 1, 1];
let ICON_AUTO_GAIN = 1;
let ICON_AUTO_DEFAULT = [1, 1, 1];
function applyIconColorVar(hex) {
  // "Original": the icons take the background's colour, paler
  if (!hex || hex === "auto") document.documentElement.dataset.iconAuto = "1";
  else delete document.documentElement.dataset.iconAuto;
  const original = !hex || hex === "auto";
  if (original) hex = "#" + ICON_AUTO_RGB.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  const c = parseColor(hex);
  // "Original": the icons inside the media players stay their default white
  setPlayerIconTint(!original && c ? c : { r: 255, g: 255, b: 255, a: 1 });
  const root = document.documentElement.style;
  if (!c) { root.setProperty("--icon-color", hex || "#ffffff"); root.setProperty("--icon-alpha", "1"); return; }
  root.setProperty("--icon-color", colorHex({ ...c, a: 1 }));
  root.setProperty("--icon-alpha", String(c.a));
}

// Icons that are full-colour brand marks (rendered as-is, never tinted).
const COLORED = new Set(["status_select.png", "item_tex_ps3game_folder.png", "store.png", "whatsnew.png", "ps_plus.png", "psn_sphere.png", "tex_psn.png", "pshome.png", "mychannels.png", "photo_gallery.png", "signin.png", "signup.png"]);

function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(String(hex || "#ffffff").trim());
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
function mask(icon) {
  const name = typeof icon === "string" ? icon : (icon && icon.sys);
  const url = name ? sysBase(name) : "";
  return `-webkit-mask-image:url('${url}');mask-image:url('${url}')`;
}
const maskUrl = (url) => `-webkit-mask-image:url('${url}');mask-image:url('${url}')`;
function iconHTML(name, extra = "") {
  if (!name) return `<span class="sysicon ${extra}"></span>`;
  // a picture of the user's own (custom sections): shown whole, as it is
  if (name.startsWith("url:")) return `<img class="sysicon customicon secpic ${extra}" src="${name.slice(4)}" alt="">`;
  // a custom section's picture with its Icon Effects ("cust:<flags>:<url>":
  // s = Icon Style, c = Icon Color, a = transparency)
  if (name.startsWith("cust:")) {
    const i = name.indexOf(":", 5);
    const f = name.slice(5, i), url = name.slice(i + 1);
    const m = `-webkit-mask-image:url('${url}');mask-image:url('${url}')`;
    const solid = f.includes("a") ? "" : " cust-solid";
    // the picture's shape filled like the other icons (Icon Color; with the
    // Icon Style's shading, or flat)
    if (f.includes("c") && !f.includes("s")) return `<span class="sysicon custmask cust-flat${solid} ${extra}" style="${m}"></span>`;
    // with the Icon Style: shaded like the system's icons (see
    // _shadeCustomIcons), in the Icon Color (c) or its own colours, in its own
    // shape; until then (and with the Flat style) the picture with a gloss
    if (f.includes("s")) {
      const k = esc(`${url}${solid ? "|solid" : ""}`);
      return `<span class="sysicon custwrap${f.includes("c") ? " cs-tint" : ""}${solid} ${extra}" data-tsrc="${esc(url)}" data-tkey="${k}"${f.includes("c") ? "" : ' data-own="1"'}><img class="cust-img" src="${url}" alt=""><span class="cust-gloss" style="${m}"></span></span>`;
    }
    return `<img class="sysicon customicon secpic${solid} ${extra}" src="${url}" alt="">`;
  }
  name = sysName(name);
  if (COLORED.has(name)) {
    // per-icon class (ic-<basename>) so specific colour icons can override the
    // uniform colour-icon scale to match their section reference exactly
    const ic = "ic-" + name.replace(/\.[a-z0-9]+$/i, "");
    // Sign In: while chosen, its picture changes smoothly to "Signing In"
    if (name === "signin.png") return `<span class="sysicon coloricon ${ic} signin-pair ${extra}"><img class="si-a" src="${esc(sysUrl(name))}" alt=""><img class="si-b" src="${esc(sysUrl("signing_in.png"))}" alt=""></span>`;
    // (an Icon Theme / PS3 theme can have its own picture for it too)
    return `<img class="sysicon coloricon ${ic} ${extra}" src="${esc(sysUrl(name))}" alt="">`;
  }
  // a theme's own picture for this icon (PS3 theme / Icon Theme), drawn as
  // that theme's Icon Color / Icon Style options say
  const t = themeIcon(name);
  if (t) {
    // (an Icon Set's Transparency off: its pictures are already made solid
    // (see _solidIconUrls), shaded as solid glass and not faded like the others)
    const so = t.opts.iconAlpha === false ? " cust-solid" : "";
    const c = t.opts.iconColor !== false, s = t.opts.iconStyle !== false, u = esc(t.url), k = esc(`${t.key}|${t.file}${so ? "|solid" : ""}`);
    if (c && s) return `<span class="sysicon${so} ${extra}" data-sys="${name}" data-tsrc="${u}" data-tkey="${k}" style="${maskUrl(u)}"></span>`;
    if (c) return `<span class="sysicon custmask cust-flat${so} ${extra}" style="${maskUrl(u)}"></span>`;
    if (s) return `<span class="sysicon themeown${so} ${extra}" data-sys="${name}" data-tsrc="${u}" data-tkey="${k}" data-own="1" style="${maskUrl(u)};--tsrc:url('${u}')"></span>`;
    return `<img class="sysicon customicon${so} ${extra}" src="${u}" alt="">`;
  }
  return `<span class="sysicon ${extra}" data-sys="${name}" style="${mask(name)}"></span>`;
}
// Shared friends-section card markup. The avatar sits in its own slot OUTSIDE the
// masked card (the card punches a transparent square hole so the app background
// shows through), with a subtly glossy glass square in front of it.
// status indicator next to the name (replaces the blue circle). Only "sign_in"
// (the blue circle) shows the currently-playing game; the others hide it.
const CARD_INDICATORS = {
  sign_in: "tex_indi_Sign_in.png",
  afk: "tex_indi_AFK.png",
  none: "tex_indi_None.png",
  sign_out: "tex_indi_Sign_out.png",
  sent_request: "tex_indi_None.png", // same glyph as "Received Friend Request"
};
// Friend group order (top to bottom): Received Friend Request, Online, Away,
// Signed Out, then Sent Friend Request last.
const FRIEND_ORDER = { none: 0, sign_in: 1, afk: 2, sign_out: 3, sent_request: 4 };
// Weighted random trophy level: 1-15 at 80%, 16-20 at 15%, 21-30 at 5%.
function randomTrophyLevel() {
  const r = Math.random();
  if (r < 0.80) return 1 + Math.floor(Math.random() * 15);   // 1-15
  if (r < 0.95) return 16 + Math.floor(Math.random() * 5);   // 16-20
  return 21 + Math.floor(Math.random() * 10);                // 21-30
}
// A last-sign-in value drawn from a chosen time bucket (for the friend creator's
// Signed Out time option). "random" spans every bucket.
function lastSignInForBucket(bucket) {
  const unit = (n, u) => `${n} ${u}${n === 1 ? "" : "s"}`;
  switch (bucket) {
    case "zero": return { label: "0 Minutes", mins: 0 };
    case "minutes": { const n = Math.floor(Math.random() * 120); return { label: unit(n, "Minute"), mins: n }; }
    case "hours": { const n = 2 + Math.floor(Math.random() * 46); return { label: unit(n, "Hour"), mins: n * 60 }; }
    case "days": { const n = 2 + Math.floor(Math.random() * 58); return { label: unit(n, "Day"), mins: n * 1440 }; }
    case "months": { const n = 2 + Math.floor(Math.random() * 22); return { label: unit(n, "Month"), mins: n * 43200 }; }
    case "years": return { label: "2 or More Years", mins: 2 * 525600 };
    default: return randomLastSignIn();
  }
}
const SIGNOUT_TIME_OPTIONS = [
  { label: "Random", id: "random" }, { label: "0 Minutes Ago", id: "zero" }, { label: "Minutes Ago", id: "minutes" },
  { label: "Hours Ago", id: "hours" }, { label: "Days Ago", id: "days" },
  { label: "Months Ago", id: "months" }, { label: "2 or More Years Ago", id: "years" }];
// Human-readable random "last sign-in" span for signed-out players. Returns
// both the display label and an elapsed-minutes value used to order the
// signed-out friends (least time ago first).
function randomLastSignIn() {
  const unit = (n, u) => `${n} ${u}${n === 1 ? "" : "s"}`;
  const r = Math.random();
  if (r < 0.35) { const n = Math.floor(Math.random() * 120); return { label: unit(n, "Minute"), mins: n }; }   // 0 Minutes included
  if (r < 0.65) { const n = 2 + Math.floor(Math.random() * 46); return { label: unit(n, "Hour"), mins: n * 60 }; }
  if (r < 0.85) { const n = 2 + Math.floor(Math.random() * 58); return { label: unit(n, "Day"), mins: n * 1440 }; }
  if (r < 0.97) { const n = 2 + Math.floor(Math.random() * 22); return { label: unit(n, "Month"), mins: n * 43200 }; }
  return { label: "2 or More Years", mins: 2 * 525600 };
}
// Convert a "Last Sign-In" label back to elapsed minutes (for ordering saved
// signed-out cards whose label is fixed).
function signInMins(label) {
  if (!label) return Number.MAX_SAFE_INTEGER;
  if (/year/i.test(label)) return 2 * 525600;
  const m = /(\d+)\s*(minute|hour|day|month)/i.exec(label);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  return u === "minute" ? n : u === "hour" ? n * 60 : u === "day" ? n * 1440 : n * 43200;
}
// Random PSN-style handle: a pair of words drawn from mixed pools (PS3-game
// references, common English first names, nouns, verbs, adjectives, animals,
// transportation) combined, with
// a trailing number some of the time. Original: never taken from any
// reference image.
const NAME_POOLS = {
  games: ["Drake", "Kratos", "Sackboy", "Ratchet", "Clank", "Cole", "Nariko", "Jak", "Daxter",
    "Sly", "Helghast", "Chimera", "Nomad", "Raiden", "Sev", "Spike", "Toro", "Kat", "Delsin", "Fortune"],
  nouns: ["Comet", "Ember", "Circuit", "Beacon", "Cipher", "Tempest", "Glitch", "Reactor", "Prism",
    "Warden", "Echo", "Relic", "Halo", "Vortex", "Specter", "Horizon", "Anvil", "Quartz", "Rift", "Aurora"],
  verbs: ["Strike", "Dash", "Blaze", "Surge", "Prowl", "Quake", "Vault", "Snipe", "Chase", "Wreck",
    "Glide", "Launch", "Charge", "Drift", "Bolt", "Crash", "Rush", "Smash", "Dive", "Roam"],
  adjectives: ["Swift", "Neon", "Crimson", "Silent", "Frozen", "Golden", "Shadow", "Electric", "Savage",
    "Lunar", "Rapid", "Iron", "Wild", "Hidden", "Velvet", "Rogue", "Cosmic", "Brave", "Toxic", "Ancient"],
  animals: ["Wolf", "Falcon", "Panther", "Cobra", "Raven", "Shark", "Lynx", "Bison", "Otter", "Mantis",
    "Jackal", "Heron", "Viper", "Stag", "Kraken", "Owl", "Fox", "Hawk", "Badger", "Orca"],
  people: ["James", "Robert", "John", "Michael", "David", "William", "Richard", "Joseph", "Thomas", "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin", "Brian", "George", "Timothy", "Ronald", "Edward", "Jason", "Jeffrey", "Ryan", "Jacob", "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin", "Scott", "Brandon", "Benjamin", "Samuel", "Gregory", "Alexander", "Patrick", "Frank", "Raymond", "Jack", "Dennis", "Jerry", "Tyler", "Aaron", "Jose", "Adam", "Nathan", "Henry", "Zachary", "Douglas", "Peter", "Kyle", "Noah", "Ethan", "Jeremy", "Walter", "Christian", "Keith", "Roger", "Terry", "Austin", "Sean", "Gerald", "Carl", "Harold", "Dylan", "Arthur", "Lawrence", "Jordan", "Jesse", "Bryan", "Billy", "Bruce", "Gabriel", "Joe", "Logan", "Alan", "Juan", "Albert", "Willie", "Elijah", "Wayne", "Randy", "Vincent", "Mason", "Roy", "Ralph", "Bobby", "Russell", "Bradley", "Philip", "Eugene", "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen", "Lisa", "Nancy", "Betty", "Sandra", "Margaret", "Ashley", "Kimberly", "Emily", "Donna", "Michelle", "Carol", "Amanda", "Melissa", "Deborah", "Stephanie", "Dorothy", "Rebecca", "Sharon", "Laura", "Cynthia", "Amy", "Kathleen", "Angela", "Shirley", "Brenda", "Emma", "Anna", "Pamela", "Nicole", "Samantha", "Katherine", "Christine", "Helen", "Debra", "Rachel", "Carolyn", "Janet", "Maria", "Catherine", "Heather", "Diane", "Olivia", "Julie", "Joyce", "Victoria", "Ruth", "Virginia", "Lauren", "Kelly", "Christina", "Joan", "Evelyn", "Judith", "Andrea", "Hannah", "Megan", "Cheryl", "Jacqueline", "Martha", "Madison", "Teresa", "Gloria", "Sara", "Janice", "Ann", "Kathryn", "Abigail", "Sophia", "Frances", "Jean", "Alice", "Judy", "Isabella", "Julia", "Grace", "Amber", "Denise", "Danielle", "Marilyn", "Beverly", "Charlotte", "Natalie", "Theresa", "Diana", "Brittany", "Doris", "Kayla", "Alexis", "Lori", "Marie"],
  transport: ["Rover", "Cruiser", "Jet", "Rocket", "Racer", "Copter", "Skiff", "Glider", "Tank",
    "Speeder", "Hauler", "Sled", "Frigate", "Buggy", "Zeppelin", "Tram", "Galleon", "Dropship", "Sub", "Coupe"],
};
function randomFriendName() {
  if (Math.random() < 0.0007) return "Maxi";
  const cats = Object.keys(NAME_POOLS);
  const p = (c) => { const a = NAME_POOLS[c]; return a[Math.floor(Math.random() * a.length)]; };
  const a = p(cats[Math.floor(Math.random() * cats.length)]);
  let b = p(cats[Math.floor(Math.random() * cats.length)]);
  while (b === a) b = p(cats[Math.floor(Math.random() * cats.length)]);
  let nm = a + b;
  if (Math.random() < 0.45) nm += String(Math.floor(Math.random() * 90) + 10); // a number some of the time
  return nm;
}
// Friend status-message pool. Gaming / console flavoured, with PlayStation and
// PS3 references (no other-console references).
const FRIEND_MSGS = [
  "Back online, finally", "AFK, grabbing coffee", "GG everyone, good matches", "Looking for a squad",
  "One more round then bed", "New headset, can you hear me?", "Trophy hunting all weekend",
  "Ranked grind tonight", "Chill co-op anyone?", "Testing my new setup", "Streaming later",
  "Taking a break, brb", "First time playing this one", "Almost at the platinum",
  "Grinding for the platinum trophy", "Anyone up for some Warhawk?", "Back to the campaign tonight",
  "Just got my DualShock charged", "Queuing for online multiplayer", "Beating this boss if it takes all night",
  "Split-screen co-op later?", "No mic today, sorry team", "Saving up for the season pass",
  "This loading screen again", "One trophy away from 100 percent", "Marathon session incoming",
  "Controller drift is getting bad", "Down for some ranked matches", "Finishing the story mode",
  "Sinking hours into this open world", "On the PlayStation all weekend", "Just hit a new high score",
  "Couch co-op with the crew", "Rage quit incoming, brb", "Farming XP before bed",
  "Anybody got a spare invite?", "Trophy sync is taking forever", "Blu-ray movie night after this",
  "Downloading a demo real quick", "My backlog is out of control", "Speedrunning this later",
  "Clutch win, GG", "Platinum number twelve, let's go", "Boosting for the last trophy",
  "Matchmaking is slow tonight", "Reinstalling for the DLC", "Who wants to run co-op?"];
// Weighted random for the message-icon number: 80% land in 1-10, 15% in 11-20,
// and 5% in 21-30.
function randomMboxNum() {
  const r = Math.random();
  if (r < 0.80) return 1 + Math.floor(Math.random() * 10);   // 1-10
  if (r < 0.95) return 11 + Math.floor(Math.random() * 10);  // 11-20
  return 21 + Math.floor(Math.random() * 10);                // 21-30
}
function cardHTML({ cls, color, avatar, msg, name, game, level, indicator, showGame, lastSignIn, hasPlus, hasMbox, mboxNum }) {
  const ind = CARD_INDICATORS[indicator] ? indicator : "sign_in";
  // the line under the name depends on the indicator:
  //   blue circle → the game (when shown); away → nothing;
  //   none → "You have received a Friend request."; signed out → last sign-in.
  let info = "";
  if (ind === "sign_in" && showGame !== false && game) {
    info = `<div class="fc-game"><span class="fc-gpad"></span><span class="fc-gm mq">${esc(game)}</span></div>`;
  } else if (ind === "none") {
    info = `<div class="fc-game fc-info"><span class="fc-gm mq">You have received a Friend request.</span></div>`;
  } else if (ind === "sent_request") {
    info = `<div class="fc-game fc-info"><span class="fc-gm mq">Pending response to your Friend request.</span></div>`;
  } else if (ind === "sign_out") {
    info = `<div class="fc-game fc-info"><span class="fc-gm mq">Last Sign-In: ${esc(lastSignIn || "2 or More Years")} Ago</span></div>`;
  }
  const lv = level == null ? "" : level === "-" ? "\u2013" : String(level);
  // speech bubble: only Online / Away cards (and the player's own), only with a message
  const bubble = !!(msg && String(msg).trim()) && (cls === "player" || ind === "sign_in" || ind === "afk");
  const trophy = `<div class="fc-trophy"><img class="fc-trophy-ic" src="./assets/icons/system/trophy_level.png" alt=""><span class="fc-level">${esc(lv)}</span></div>`;
  const diamond = `<div class="fc-diamond"></div>`;
  const dot = `<span class="fc-dot" style="background-image:url('./assets/icons/system/${CARD_INDICATORS[ind]}')"></span>`;
  // side badges (to the left of the card). "Received Friend Request" (none)
  // always shows the message badge with a "1" and never PS Plus. "Sent Friend
  // Request" shows no message badge but may show PS Plus.
  const showMbox = ind === "none" ? true : (ind === "sent_request" ? false : !!hasMbox);
  const mboxN = ind === "none" ? 1 : (mboxNum ?? 1);
  const showPlus = ind !== "none" && !!hasPlus;
  const plusBadge = showPlus ? `<div class="fc-plus"><img src="./assets/icons/system/ps_plus.png" alt=""></div>` : "";
  const mboxBadge = showMbox ? `<div class="fc-mbox"><img src="./assets/icons/theme/icon_mbox.png" alt=""><span class="fc-badge-num">${esc(String(mboxN))}</span></div>` : "";
  // The full card (coloured rectangle + bubble + trophy) only shows when this
  // item is selected (hovered); otherwise the compact form (framed avatar +
  // name + game) is shown. The two states are switched entirely in CSS.
  // The bubble and the trophy share one flex row, so the trophy always sits
  // right after the bubble (fixed gap) with the level number hugging the icon,
  // and the bubble gives up width only when a long level needs it.
  return `<div class="fc-root ${cls}" style="--card-bg:${color}">
    ${diamond}${plusBadge}${mboxBadge}
    <div class="friend-card"></div>
    ${bubble
      ? `<div class="fc-toprow"><div class="fc-msg"><span class="fc-msgtext mq">${esc(msg)}</span></div>${trophy}</div>
    <img class="fc-tail" src="./assets/icons/system/bubble_tail.png" alt="">`
      : `<div class="fc-toprow no-msg">${trophy}</div>`}
    <div class="fc-avslot av-wait"><img class="fc-av${isStockAvatar(avatar) ? " fc-stock" : ""}" src="${avatarSrc(avatar)}" alt=""><div class="fc-glass"></div></div>
    <div class="fc-name">${dot}<span class="fc-nm mq">${esc(name)}</span></div>
    ${info}
  </div>`;
}
// The user's own content (games, songs, photos, videos, media folders):
// its titles never fade on idle.
function isUserContent(it) {
  return !!it && (it.kind === "game" || !!it.media || !!(it.icon && it.icon.folder)
    || ["music", "photo", "video"].includes(it.kind));
}
// An artist's songs in discography order: albums oldest → newest (by the
// earliest year on the album, then name), each album in disc / track order.
// The same order "By Artist (In Order)" background music uses.
function discographyOrder(entries) {
  const byAlbum = new Map();
  for (const e of entries) { const al = (e.media.album || "").trim() || "Unknown"; if (!byAlbum.has(al)) byAlbum.set(al, []); byAlbum.get(al).push(e); }
  const yearOf = (arr) => { let y = Infinity; for (const e of arr) { const v = parseInt(e.media.year || "", 10); if (!isNaN(v)) y = Math.min(y, v); } return y; };
  return [...byAlbum.entries()]
    .sort((a, b) => (yearOf(a[1]) - yearOf(b[1])) || cmpText(a[0], b[0]))
    .flatMap(([, arr]) => [...arr].sort((a, b) => ((a.media.disc || 0) - (b.media.disc || 0)) || ((a.media.track || 0) - (b.media.track || 0))
      || cmpText(String(a.title || ""), String(b.title || ""))));
}
// x (fraction of width) of level `li` when `active` is the open level.
function drillX(li, active) {
  if (active === 0) return spineNow;
  if (li === active) return DRILL_ACTIVE_X;
  return DRILL_ANCHOR_X - (active - 1 - li) * DRILL_STEP;
}
// An item's own title label (travels with its icon). Media folders also show
// their count line ("4 Images") while not selected, like the XMB.
function labelHTML(it) {
  const pre = it.pre ? `<div class="il-pre">${esc(it.pre)}</div>` : "";
  const fk = it.icon && it.icon.folder ? ` il-f${it.icon.folder}` : "";
  return `<div class="item-label${it.kind === "game" || (it.icon && it.icon.gameArt && !it.icon.plainLabel) ? " il-game" : ""}${it.kind === "video" && it.icon && it.icon.art !== undefined ? " il-video" : ""}${fk}">${pre}`
    + `<div class="il-title">${esc(it.title || "")}</div><div class="il-body">${restingBody(it)}</div></div>`;
}
// Automatic Login on: the small arrow under the user's name (the Video Player's
// Instant Advance picture, IMG_3590)
const autoLogHTML = (it) => it && it.kind === "user" && it.user && it.user.autoLogin
  ? `<div class="il-autolog"><img src="./assets/icons/system/auto_login.png" alt=""></div>` : "";
function restingBody(it) {
  if (it.kind === "user") return autoLogHTML(it);
  if (it.userSub && it.sub) return `<div class="il-sub il-usub">${esc(it.sub)}</div>`;
  if (it.kind === "video" && it.sub) return `<div class="il-sub il-vsub">${esc(it.sub)}</div>`;
  return (it.icon && it.icon.folder && it.sub) ? `<div class="il-sub">${esc(it.sub)}</div>` : "";
}
function resetLabel(it) {
  const lab = it._el && it._el.querySelector(".item-label");
  if (lab) {
    lab.querySelector(".il-title").textContent = it.title || "";
    lab.querySelector(".il-body").innerHTML = restingBody(it);
  }
  it._labelDirty = false;
}
// a media picture (cover, thumbnail, game icon) that's still loading shows the
// rotating loading icon (as in preloads) instead of an empty frame
// (flat: the section's own icon, drawn flat in the Icon Color in the middle of
// the loading icon: the XMB's own lists only)
function watchArtLoading(root, flat = null) {
  root.querySelectorAll("img.art-img, img.ff-thumb, img.item-avatar").forEach((img) => {
    if (img.complete && img.naturalWidth) return;
    // the app's own pictures (default icons…) are loaded at start: no loading
    // icon for them (avatars get one while they load)
    if (!img.classList.contains("item-avatar") && /^(\.\/)?assets\//.test(img.getAttribute("src") || "")) return;
    const host = img.parentElement; if (!host) return;
    img.decoding = "async";
    host.classList.add("art-loading");
    if (!host.querySelector(".art-spin")) host.insertAdjacentHTML("beforeend", `<img class="art-spin" src="./assets/icons/system/loading_icon.png" alt="">`
      + (flat ? `<span class="art-flat" style="--flat:url('${flat}')"></span>` : ""));
    const done = () => { host.classList.remove("art-loading"); host.querySelectorAll(".art-spin, .art-flat").forEach((n) => n.remove()); };
    img.addEventListener("load", done, { once: true }); img.addEventListener("error", done, { once: true });
  });
}
// Game icons come square (1:1) or wide (16:9): the icon's frame takes the
// picture's shape (between the two) so it shows whole, never stretched or cut
function fitArtRatio(frame, w, h) {
  if (!frame || !w || !h) return;
  const ar = Math.max(1, Math.min(16 / 9, w / h));
  // (the item knows its icon's shape too: its title keeps one place beside it, see styles.css)
  const item = frame.closest(".item");
  if (Math.abs(ar - 16 / 9) < 0.02) {
    frame.classList.remove("ar-fit"); frame.style.removeProperty("--ar");
    if (item) { item.classList.remove("ar-item"); item.style.removeProperty("--ar"); }
    return;
  }
  frame.classList.add("ar-fit"); frame.style.setProperty("--ar", ar.toFixed(4));
  if (item) { item.classList.add("ar-item"); item.style.setProperty("--ar", ar.toFixed(4)); }
}
function watchArtRatio(root) {
  for (const img of root.querySelectorAll(".art-frame:not(.vid-thumb):not(.photo-thumb) > img.art-img:not(.disc-img)")) {
    const fr = img.parentElement;
    const fit = () => { fr._iconAr = [img.naturalWidth, img.naturalHeight]; if (!fr._previewOn) fitArtRatio(fr, img.naturalWidth, img.naturalHeight); };
    if (img.complete && img.naturalWidth) fit(); else img.addEventListener("load", fit, { once: true });
  }
}
function itemIcon(it) {
  if (it.kind === "game" || (it.icon && it.icon.gameArt)) {
    const art = it.icon.art;
    return `<div class="art-frame${it.icon.artCls ? " " + it.icon.artCls : ""}">${art ? `<img class="art-img${it.icon.disc ? " disc-img" : ""}" src="${art}" alt="">` : ""}</div>`;
  }
  // media grouping folder (Folders.zip): the NORMAL folder graphic sits behind
  // the first item's cover/thumbnail; if that first item has no thumbnail, the
  // "Default" folder (with the built-in section glyph) is used on its own.
  if (it.icon && it.icon.folder) {
    const kind = it.icon.folder; // music | photo | video | game
    const hasThumb = !!it.icon.art;
    // video and game folders holding a thumbnail / icon: the plain folder
    // (icon_gamedata); a game folder whose first game has no icon: the PS3 game
    // folder; otherwise each section's own folder graphics
    const bd = hasThumb && (kind === "video" || kind === "game");
    const fimg = bd ? "icon_gamedata.png" : hasThumb ? `${kind}_folder.png`
      : kind === "game" ? "item_tex_ps3game_folder.png" : `icon_${kind}_album_default.png`;
    const thumb = hasThumb ? `<img class="ff-thumb" src="${it.icon.art}" alt="">` : "";
    const furl = sysUrl(fimg);
    // .ff-tint is the folder shape filled with the current Icon Color, multiplied
    // over the folder graphic so the folder (and the Default folder's glyph) take
    // the icon colour while the inner photo/thumbnail is left untouched.
    return `<div class="folder-frame folder-${kind}${bd ? " ff-bd" : ""}" style="--fimg:url('${furl}')">`
      + `<img class="ff-folder" src="${furl}" alt="">`
      + `<span class="ff-tint"></span>${thumb}</div>`;
  }
  // videos with an icon (Change Icon): a 16:9 thumbnail, 140x80 / 367x211
  if (it.kind === "video" && it.icon && it.icon.art !== undefined) {
    // the 15-second icon clip (Change Icon) plays all the time, selected or not
    const clip = it.icon.clip ? `<video class="preview-vid" src="${it.icon.clip}" muted loop autoplay playsinline></video>` : "";
    return `<div class="art-frame vid-thumb">${it.icon.art ? `<img class="art-img" src="${it.icon.art}" alt="">` : ""}${clip}</div>`;
  }
  // Photo thumbnails (and any non-game item carrying an image) render as a
  // preview square instead of a placeholder icon.
  if (it.icon && it.icon.art !== undefined) {
    return `<div class="art-frame photo-thumb${it.kind === "music" ? " music-art" : ""}">${it.icon.art ? `<img class="art-img" src="${it.icon.art}" alt="">` : ""}</div>`;
  }
  if (it.kind === "playercard") {
    const a = it.acct;
    return cardHTML({ cls: "player", color: a.background || CARD_DEFAULT, avatar: a.avatar,
      msg: a.comment || "", name: a.onlineId, game: "", level: it.level,
      indicator: "sign_in", hasPlus: it.plusFn ? it.plusFn() : false });
  }
  if (it.kind === "friendcard") {
    const f = it.friend;
    return cardHTML({ cls: "friend", color: f.color, avatar: f.avatar, msg: f.message, name: f.name,
      game: f.game, level: f.trophyLevel, indicator: f.indicator || "sign_in", showGame: f.showGame,
      lastSignIn: f.lastSignIn, hasPlus: f.hasPlus, hasMbox: f.hasMbox, mboxNum: f.mboxNum });
  }
  if (it.icon && it.icon.avatar !== undefined) {
    const ref = it.icon.avatar;
    if (isMaskAvatar(ref)) return `<span class="sysicon item-sys" style="-webkit-mask-image:url('${avatarSrc(ref)}');mask-image:url('${avatarSrc(ref)}')"></span>`;
    // a picture of the user's own (not a stock / PSN avatar) is shown whole
    const own = it.kind === "user" && ref && !/^(stock|psn|sys):/.test(ref);
    const src = avatarSrc(ref);
    return `<img class="item-avatar${own ? " item-photo" : ""}" src="${src}" alt="">`;
  }
  return iconHTML(it.icon && it.icon.sys, "item-sys");
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
// PS3 media-folder duration: M'SS" (e.g. 3'07", 46'11")
const fmtDurClock = (s) => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}'${ss}''` : `${m}'${ss}''`;
};
const fmtSize = (b) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;

// custom sections (sections.js)
Object.assign(Xmb.prototype, SectionMethods);
