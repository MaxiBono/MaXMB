// XMB: what the XMB's parts share (layout metrics, constants, the icon and
// row markup helpers...), from xmb.js. Imported by xmb.js and its parts
// (xmb-*.js).
import { noExt, cmpText } from "./api.js";
import { sysName, sysBase, sysUrl, themeIcon, activeThemes, P3T_FOLDER_PICS } from "./themes.js";
import { REAL_WAVE_DEFAULTS, REAL_PARTICLE_DEFAULTS, COMPLEX_EXTRA_DEFAULTS, COMPLEX_GRADIENT_PRESETS } from "./wavegl.js";
import { setPlayerGlowTint } from "./playericons.js";
import { loadedIcon } from "./iconshade.js";
import { parseColor, colorHex, avatarSrc, isMaskAvatar, isStockAvatar } from "./ui.js";


// Icon Style choices (Theme Settings), in the order they're listed
// (internal names: "glasslive" the reactive Liquid Glass, "glass" the same glass without bending
// what's behind; an Icon Style saved by an older version that isn't listed here is shown as
// Original (Reactive))
export const ICON_STYLES = [["glasslive", "Original (Reactive)"], ["glass", "Original"], ["glassglow", "Glow"], ["glasspulse", "Glow (Pulsating)"], ["glassclear", "Glass (Reactive)"], ["glossy", "Glossy"], ["flat", "Flat"]];
// a menu row's / category's dim level: as its opacity, and as --io, which
// Liquid Glass (Reactive) uses instead (styles.css: a dimmed parent would hide
// the background from the glass, so the icon and label are dimmed themselves)
export function dimTo(el, v) { el.style.opacity = v; el.style.setProperty("--io", v); }

// Layout metrics as FRACTIONS of the viewport, measured pixel-for-pixel from
// real 1920x1080 XMB captures (Settings / Network / Game / PSN / Friends), so
// the cross keeps the same proportions at any window size / display scale.
// Horizontal values are /1920 of the width, vertical values /1080 of the height.
export const SPINE_X = 0.295;        // selected category icon + sub-item spine, x (≈566px)
// Before anyone logs in the single "Log In" column sits in the centre of the
// screen (x 960, Log In capture); afterwards the cross uses SPINE_X.
export let spineNow = SPINE_X;
export const CAT_Y = 290 / 1080;     // UNselected category icon centres, y
export const CAT_SEL_Y = 281 / 1080; // selected category icon centre (bigger icon, same baseline)
export const CAT_GAP_SEL = 210 / 1920; // selected category ↔ its neighbours, x
export const CAT_GAP = 199 / 1920;     // pitch between the other category icons, x
export const ITEM_SPINE_Y = 505 / 1080;  // selected sub-item centre, y
export const ITEM_BELOW_Y = 680 / 1080;  // first sub-item BELOW the selection, centre y
export const ITEM_ABOVE_Y = 120 / 1080;  // first sub-item ABOVE the selection (above the category row), centre y
export const ITEM_PITCH = 80 / 1080;     // pitch between non-selected sub-items (and compact friend cards)
export const GAME_PITCH = 96 / 1080;     // game icons are 16:9 art, slightly taller rows
export const CARD_X = 86 / 1920;         // selected friend card: left edge sits this far left of the spine
export const CARD_COMPACT_X = 36 / 1920; // compact card: avatar frame starts this far left of the spine
// Drilled sub-menus (measured from a real capture, Music > album): the open
// list's icons sit at x 625, the parent's anchor icon at x 303 with the back
// arrow at x 425, and the parent's other rows stay barely visible at x 455.
export const DRILL_ACTIVE_X = 625 / 1920;
export const DRILL_ANCHOR_X = 303 / 1920;
export const DRILL_STEP = 322 / 1920;     // further ancestors step left by this much
export const GHOST_DX = 152 / 1920;       // parent's other rows, right of its anchor
export const DWELL_MS = 1200;
export const IDLE_FADE_COLS = ["photo", "music", "video", "game", "network", "psn"];
// fixed subsections at the top of the Photo / Video columns (before the media)
export const FIXED_ITEMS = { photo: 3, video: 4 };
export const HOME_DESC = "Play games and meet friends in PlayStation\u00aeHome,\nthe definitive social gaming network only on PlayStation\u00ae3 system.";
// a game folder named any way as "PlayStation Home" (PlayStation®Home,
// playstation_home, PS3 Home…) can be launched from PSN > PlayStation®Home
// a game's name as listed: games with the same title are numbered, "Title (2)"
// (the one that has been there longest keeps the title)
export const gameName = (g) => { const t = noExt(g.title); return g.copy > 1 ? `${t} (${g.copy})` : t; };
// a folder path as Windows shows it (one "\\" between folders)
export const winPath = (p) => String(p == null ? "" : p).replace(/\//g, "\\").replace(/\\{2,}/g, (m, o) => o === 0 ? m : "\\");
// the system's own columns after Users, in their order
export const BASE_COLUMNS = ["settings", "photo", "music", "video", "tvvideo", "game", "network", "psn", "friends"];
// (also "PlayStation Home (Beta)", "PlayStation Home 1.86", a shortcut's name,
// and any game with Home's Title ID, as Game Recognition finds it through RPCS3)
export const HOME_TITLE_IDS = ["NPIA00010"];
export const isHomeTitle = (t) => {
  const n = String(t || "").trim().replace(/\.(lnk|xmbl|url|exe)$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const m = /^(?:playstation3|playstation|ps3|ps)home(.*)$/.exec(n);
  return !!m && /^\d*$/.test(m[1].replace(/closedbeta|openbeta|beta|online|offline|hen|v/g, ""));
};
export const isHomeGame = (g) => !!g && (HOME_TITLE_IDS.includes(String(g.titleId || "").trim().toUpperCase()) || isHomeTitle(g.title || g.folder));
// game.json "console" values (Game Settings) and their "By Format" folder names
// Console (game.json "console"): [key, format name (By Format folders), badge]
export const CONSOLE_TABLE = [
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
export const CONSOLES = CONSOLE_TABLE.map((c) => c[0]);
export const FORMAT_NAMES = Object.fromEntries(CONSOLE_TABLE.map((c) => [c[0], c[1]]));
// the console badge shown on the right of the selected game (PS3-style); a
// console that isn't in the list gets the blank badge with its name written on
export function consoleBadge(c) {
  const key = String(c || "PS3");
  const row = CONSOLE_TABLE.find((r) => r[0].toLowerCase() === key.toLowerCase());
  return row
    ? `<img class="game-fmt" src="./assets/icons/consoles/${row[2]}" alt="">`
    : `<span class="game-fmt game-fmt-txt" style="background-image:url('./assets/icons/consoles/tex_vc_none.png')"><span style="font-size:${
      key.length <= 6 ? 1.35 : key.length <= 9 ? 1.1 : key.length <= 13 ? 0.85 : 0.7}vh">${esc(key)}</span></span>`;
}
// the disc shown for a game set as "Disc" (PS1 / PS2 / PS3, otherwise the default)
export const discIcon = (c) => `./assets/icons/discs/${["PS1", "PS2", "PS3"].includes(c) ? c : "default"}.png`;
export const DISC_HOLD_MS = 2000;   // the disc game keeps its disc this long when selected
// (names, Online IDs and messages: up to 255 characters, any character)
export const MSG_LIMIT = 255;
export const NAME_LIMIT = 255;
export const FRIEND_MAX = Infinity;  // most friends that can be shown (no limit)

// Sort/group modes for the media sections, cycled with the Square button.
// `flat: true` means a flat list (no folders), just re-sorted. Others group the
// items into folder drills by a key derived in _groupName().
// Game Settings: the game's own files (icon.*, background.*, preview.*, music.*)
export const GAME_MEDIA = [
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
export const folderName = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || String(p || "");
// "Tools" → "Tools'", "Hades" → "Hades'", "Portal" → "Portal's"
export const poss = (name) => { const n = String(name || "").trim(); return /s$/i.test(n) ? `${n}'` : `${n}'s`; };
export const MEDIA_MODES = {
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
export const USER_SETTING_KEYS = ["behavior", "input", "mediaMode", "gameMode"];
// Display Settings > Resolution
// picture folders: the grid (see _layoutGrid)
// column centres at x 630 + 243·n @1920 (the first one on the item spine);
// each picture fits a 207×155 box, the selected one a 255×190 box (captures)
export const GRID_COLS = 5, GRID_X0 = 5, GRID_DX = 243;
export const GRID_BOX = [207, 155], GRID_BOX_SEL = [255, 190];
// Display Settings > FPS Cap: "display" = the display's own refresh rate
export const FPS_CAPS = ["display", "30", "60", "120"];
export const fpsCapOf = (v) => FPS_CAPS.includes(String(v)) ? String(v) : "display";
export const fpsCapLabel = (v) => { const c = fpsCapOf(v); return c === "display" ? "Display Refresh Rate" : `${c} FPS`; };
export const RESOLUTIONS = ["native", "1280x720", "1600x900", "1920x1080", "2560x1440", "3840x2160"];
// "Complex" wave style (linkev/PlayStation-3-XMB, MIT): every setting of the
// original's Spline and Particles panels, plus the ones added here (its own
// background colours, the wave's height / tilt / thickness, band frequency,
// body fill, sparkle height). Each linkev range goes from 0 (or below, for
// the settings that can be negative) up to twice its original maximum.
// Entry: [group, key, label, min, max, step, decimals, description?, labels?]
export const COMPLEX_GRADIENT_LABELS = ["Custom Colors", ...COMPLEX_GRADIENT_PRESETS.map((p) => p[0])];
// With the Original wave, its settings go twice as far (and down to 0 where
// the setting can be 0): not the background's colour channels, angle, preset
// list, gradient length and curve, which have their own fixed ranges
export const ORIG_FIXED = new Set(["gradientPreset", "bgTopR", "bgTopG", "bgTopB", "bgBotR", "bgBotG", "bgBotB", "bgAngle", "bgSpan", "bgCurve"]);
export function origMeta(m) {
  if (ORIG_FIXED.has(m[1])) return m;
  const o = m.slice();
  o[4] = m[4] * 2;
  if (m[3] > 0) o[3] = 0;
  return o;
}
export const WAVE_PARAM_META = [
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
export const VISUALIZER_BG = {
  // (fitted to the reference picture's colours, top to bottom and left to right)
  params: {
    "spline:gradientPreset": 0, "spline:bgTopR": 106, "spline:bgTopG": 45, "spline:bgTopB": 118,
    "spline:bgBotR": 2, "spline:bgBotG": 0, "spline:bgBotB": 4, "spline:bgAngle": 94, "spline:bgSpan": 0.62, "spline:bgCurve": 2,
  },
};
export const VISUALIZER_WAVE = {
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
export const SQUARE_LOOKS = [
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
// The same squares' backgrounds with the Original wave, fitted to captures of
// the console with each colour (drawn under the console's own light and tone
// mapping, so it takes its own inputs): the gradient's start and end and its
// curve (how it brightens down the screen: fitted to the captures row by row).
// The wave and the sparkles are the same on every square: white, at the usual
// brightness (ORIG_SQUARE_WAVE / ORIG_SQUARE_SPARKLES: on the console, the
// light the wave and its sparkles add over each colour's background is plain
// white, measured on captures of all of them; they only look tinted because
// of the colour behind them).
export const ORIG_SQUARE_WAVE = "#ffffff";
export const ORIG_SQUARE_SPARKLES = "#ffffff";
export const ORIG_SQUARES = {
  "Red": { top: [154, 0, 10], bot: [207, 99, 110], curve: 0.241 },
  "Orange": { top: [82, 50, 14], bot: [165, 119, 32], curve: 0.4 },
  "Brown": { top: [36, 23, 10], bot: [127, 94, 84], curve: 0.4 },
  "Olive": { top: [107, 108, 32], bot: [161, 170, 58], curve: 0.4 },
  "Green": { top: [0, 122, 0], bot: [104, 143, 52], curve: 0.131 },
  "Turquoise": { top: [16, 95, 79], bot: [65, 174, 161], curve: 0.4 },
  "Blue": { top: [0, 27, 80], bot: [85, 95, 195], curve: 0.4 },
  "Royal Blue": { top: [41, 54, 143], bot: [58, 84, 209], curve: 0.664 },
  "Purple": { top: [105, 0, 81], bot: [142, 53, 198], curve: 0.267 },
  "Silver": { top: [106, 106, 106], bot: [154, 154, 154], curve: 0.4 },
  "Black": { top: [42, 42, 42], bot: [0, 0, 0], curve: 2, span: 0.55 },
};
export const squareLook = (hex) => SQUARE_LOOKS.find((q) => q.hex.toLowerCase() === String(hex || "").toLowerCase()) || null;
export const waveParamDefault = (group, key) => ({
  particle: REAL_PARTICLE_DEFAULTS, spline: { ...REAL_WAVE_DEFAULTS, ...COMPLEX_EXTRA_DEFAULTS },
}[group] || REAL_WAVE_DEFAULTS)[key];

// a user's / Account Management's icon while its △ panel is open (IMG_3734 / IMG_3736)
export const TRI_ZOOM = 1.26;

// ---------------------------------------------------------- view helpers
// Named colours (common names) for the Background / Icon colour options.
// PS3 games a fake friend can be "playing". Derived from their message first,
// then their name, then a random PS3 title (exclusive-leaning). All PS3-era.
export const GAME_KEYWORDS = [
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
export const RANDOM_PS3_GAMES = [
  "Uncharted 2: Among Thieves", "God of War III", "The Last of Us", "LittleBigPlanet 2",
  "Gran Turismo 5", "inFAMOUS 2", "Killzone 3", "Demon's Souls", "Ratchet & Clank: A Crack in Time",
  "Heavy Rain", "Journey", "MotorStorm: Apocalypse", "Resistance 3", "Ni no Kuni: Wrath of the White Witch",
  "Metal Gear Solid 4", "Twisted Metal", "Uncharted 3: Drake's Deception", "Beyond: Two Souls",
  "3D Dot Game Heroes", "Tokyo Jungle", "LittleBigPlanet Karting", "Sly Cooper: Thieves in Time",
];
export function gameFor(message, name) {
  for (const [re, game] of GAME_KEYWORDS) if (re.test(message)) return game;
  for (const [re, game] of GAME_KEYWORDS) if (re.test(name)) return game;
  return RANDOM_PS3_GAMES[Math.floor(Math.random() * RANDOM_PS3_GAMES.length)];
}

export const NAMED_COLORS = [
  { name: "White", hex: "#ffffff" }, { name: "Light Blue", hex: "#4db3d0" },
  { name: "Blue", hex: "#3f6fd0" }, { name: "Green", hex: "#2f9e44" },
  { name: "Yellow", hex: "#e0b020" }, { name: "Orange", hex: "#d5702a" },
  { name: "Red", hex: "#c0392b" }, { name: "Pink", hex: "#d06fa0" },
  { name: "Purple", hex: "#8f7fd6" }, { name: "Brown", hex: "#8a6a3a" },
  { name: "Grey", hex: "#7a8391" }, { name: "Black", hex: "#1a1a1a" },
];
export const BG_LIST = [{ name: "Original", hex: "auto" }, ...NAMED_COLORS];
// Background Color / Wave Color / Sparkle Color: the console's Theme Settings
// > Color squares (measured from a capture), after "Original"
export const THEME_COLORS = [
  { name: "Silver", hex: "#b8bfca" }, { name: "Yellow", hex: "#ccb81c" }, { name: "Lime", hex: "#73a928" },
  { name: "Pink", hex: "#de6e81" }, { name: "Green", hex: "#1d7b1d" }, { name: "Lavender", hex: "#926fbd" },
  { name: "Turquoise", hex: "#24b8ab" }, { name: "Blue", hex: "#0837a6" }, { name: "Purple", hex: "#8d359b" },
  { name: "Orange", hex: "#c39011" }, { name: "Brown", hex: "#644317" }, { name: "Red", hex: "#b83524" },
];
export const THEME_LIST = [{ name: "Original", hex: "auto" }, ...THEME_COLORS];
// Background Color: Original (the month's colours), the squares, the Visualizer Wave
export const BG_SQUARES = [{ name: "Original", hex: "auto" }, ...SQUARE_LOOKS.map((q) => ({ name: q.name, hex: q.hex, swatch: q.swatch }))];
export const SQUARE_CTLS = ["bgcolor"];
// the Visualizer Wave: in Background Color (its background) and Wave Color (its wave and sparkles)
// (shown by name, like Original and Custom Color…: no square)
export const VIS_COLOR = { name: "Visualizer", hex: "visualizer" };
export const colorListFor = (ctl) => ctl === "chromakey" ? KEY_LIST : ctl === "bgcolor" ? [...BG_SQUARES, VIS_COLOR] : (ctl === "wavecolor" || ctl === "dotcolor") ? [...BG_LIST, VIS_COLOR]
  : SQUARE_CTLS.includes(ctl) ? THEME_LIST : BG_LIST;
// Picture Duration (Background / Overlay Shuffle), seconds
// "1 Hour 2 Minutes 5 Seconds"
export const fmtSecs = (n) => {
  const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), sec = n % 60, pl = (v, w) => `${v} ${w}${v !== 1 ? "s" : ""}`;
  return [h && pl(h, "Hour"), m && pl(m, "Minute"), (sec || !(h || m)) && pl(sec, "Second")].filter(Boolean).join(" ");
};
// Overlay Key Color: the two usual screens (a custom colour joins via △)
export const KEY_LIST = [{ name: "Green", hex: "green" }, { name: "Blue", hex: "blue" }];
// Card background colours (player + friend cards): white is excluded because a
// white card reads poorly behind the white bubble and light text.
// Card colours (player + friend cards): the console's 20 profile colours, in
// its own order (5 × 4 squares, measured from a capture). Only the cards use
// these; the other colour settings keep NAMED_COLORS.
export const CARD_COLORS = [
  { name: "Grey", hex: "#868485" }, { name: "Sky Blue", hex: "#3ab6ff" }, { name: "Turquoise", hex: "#37bba6" },
  { name: "Lime", hex: "#7bc015" }, { name: "Amber", hex: "#f7a911" },
  { name: "Orange", hex: "#f15211" }, { name: "Rose", hex: "#ef2f62" }, { name: "Pink", hex: "#f15dab" },
  { name: "Lavender", hex: "#9e69b9" }, { name: "Periwinkle", hex: "#6674cd" },
  { name: "Red", hex: "#c21322" }, { name: "Blue", hex: "#1b578d" }, { name: "Green", hex: "#2e7e49" },
  { name: "Olive", hex: "#566137" }, { name: "Bronze", hex: "#9a662d" },
  { name: "Indigo", hex: "#2f0048" }, { name: "Plum", hex: "#640036" }, { name: "Maroon", hex: "#62000d" },
  { name: "Brown", hex: "#534032" }, { name: "Charcoal", hex: "#2c2a2d" },
];
export const CARD_DEFAULT = CARD_COLORS[0].hex;
export function colorName(hex, includeAuto) {
  if (includeAuto && (!hex || hex === "auto")) return "Original";
  if (hex === "visualizer") return VIS_COLOR.name;
  const hit = [...SQUARE_LOOKS, ...NAMED_COLORS, ...THEME_COLORS].find((c) => c.hex.toLowerCase() === String(hex).toLowerCase());
  return hit ? hit.name : (hex ? `Custom Color (${String(hex).toUpperCase()})` : "Original");
}
// --icon-color takes the RGB part; a custom colour's opacity goes to --icon-alpha
// Music Player / Video Player / Photo Viewer icons take the Icon Color too: an
// SVG colour filter (#icon-tint) turns their white into the colour (format
// badges and the progress bar don't use it)
export function setPlayerIconTint(c) {
  let f = document.getElementById("icon-tint-matrix");
  if (!f) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute";
    svg.innerHTML = `<filter id="icon-tint" color-interpolation-filters="sRGB"><feColorMatrix id="icon-tint-matrix" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>`;
    document.body.appendChild(svg);
    f = document.getElementById("icon-tint-matrix");
  }
  // (the players' glows take the same colour: playericons.js)
  setPlayerGlowTint(c || null);
  // (none: each picture as it is: the system's white ones, and an Icon Set's
  // own, coloured ones)
  if (!c) { f.setAttribute("values", "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"); return; }
  const r = c.r / 255, g = c.g / 255, b = c.b / 255, a = c.a ?? 1;
  const row = (k) => `${(k * 0.2126).toFixed(4)} ${(k * 0.7152).toFixed(4)} ${(k * 0.0722).toFixed(4)} 0 0`;
  f.setAttribute("values", `${row(r)} ${row(g)} ${row(b)} 0 0 0 ${a} 0`);
}
// Icon Color Off: the media players' icons keep their own colours too (see applyIconColorVar)
export let PLAYER_OWN = false;
// Icon Color "Original": the colour the background gives the icons right now
// (set by the wave, see WaveBackground._updateIconAuto)
export let ICON_AUTO_RGB = [1, 1, 1];
export let ICON_AUTO_GAIN = 1;
export let ICON_AUTO_DEFAULT = [1, 1, 1];
export function applyIconColorVar(hex) {
  // "Original": the icons take the background's colour, paler
  if (!hex || hex === "auto") document.documentElement.dataset.iconAuto = "1";
  else delete document.documentElement.dataset.iconAuto;
  const original = !hex || hex === "auto";
  if (original) hex = "#" + ICON_AUTO_RGB.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  const c = parseColor(hex);
  // "Original", or Icon Color Off: the icons inside the media players are shown
  // as they are (the system's white; an Icon Set's in its own colours: turning
  // them into grey, as the white tint did, made a set's look like the system's)
  setPlayerIconTint(!original && c && !PLAYER_OWN ? c : null);
  const root = document.documentElement.style;
  // (the opacity filter only while the colour has one: a filter on every icon,
  // even a no-op one, makes the browser redraw it whenever its glass changes)
  const see = !!c && c.a < 1;
  document.documentElement.classList.toggle("icon-alpha", see);
  if (!c) { root.setProperty("--icon-color", hex || "#ffffff"); root.setProperty("--icon-alpha", "1"); return; }
  root.setProperty("--icon-color", colorHex({ ...c, a: 1 }));
  root.setProperty("--icon-alpha", String(c.a));
}

// Icons that are full-colour brand marks (rendered as-is, never tinted).
export const COLORED = new Set(["status_select.png", "item_tex_ps3game_folder.png", "store.png", "whatsnew.png", "ps_plus.png", "psn_sphere.png", "tex_psn.png", "pshome.png", "mychannels.png", "photo_gallery.png", "signin.png", "signup.png"]);

export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(String(hex || "#ffffff").trim());
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
export function mask(icon) {
  const name = typeof icon === "string" ? icon : (icon && icon.sys);
  const url = name ? sysBase(name) : "";
  return `-webkit-mask-image:url('${url}');mask-image:url('${url}')`;
}
export const maskUrl = (url) => `-webkit-mask-image:url('${url}');mask-image:url('${url}')`;
export function iconHTML(name, extra = "") {
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
export const CARD_INDICATORS = {
  sign_in: "tex_indi_Sign_in.png",
  afk: "tex_indi_AFK.png",
  none: "tex_indi_None.png",
  sign_out: "tex_indi_Sign_out.png",
  sent_request: "tex_indi_None.png", // same glyph as "Received Friend Request"
};
// Friend group order (top to bottom): Received Friend Request, Online, Away,
// Signed Out, then Sent Friend Request last.
export const FRIEND_ORDER = { none: 0, sign_in: 1, afk: 2, sign_out: 3, sent_request: 4 };
// Weighted random trophy level: 1-15 at 80%, 16-20 at 15%, 21-30 at 5%.
export function randomTrophyLevel() {
  const r = Math.random();
  if (r < 0.80) return 1 + Math.floor(Math.random() * 15);   // 1-15
  if (r < 0.95) return 16 + Math.floor(Math.random() * 5);   // 16-20
  return 21 + Math.floor(Math.random() * 10);                // 21-30
}
// A last-sign-in value drawn from a chosen time bucket (for the friend creator's
// Signed Out time option). "random" spans every bucket.
export function lastSignInForBucket(bucket) {
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
export const SIGNOUT_TIME_OPTIONS = [
  { label: "Random", id: "random" }, { label: "0 Minutes Ago", id: "zero" }, { label: "Minutes Ago", id: "minutes" },
  { label: "Hours Ago", id: "hours" }, { label: "Days Ago", id: "days" },
  { label: "Months Ago", id: "months" }, { label: "2 or More Years Ago", id: "years" }];
// Human-readable random "last sign-in" span for signed-out players. Returns
// both the display label and an elapsed-minutes value used to order the
// signed-out friends (least time ago first).
export function randomLastSignIn() {
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
export function signInMins(label) {
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
export const NAME_POOLS = {
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
export function randomFriendName() {
  if (Math.random() < 0.0007) return "MaxiBono";
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
export const FRIEND_MSGS = [
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
export function randomMboxNum() {
  const r = Math.random();
  if (r < 0.80) return 1 + Math.floor(Math.random() * 10);   // 1-10
  if (r < 0.95) return 11 + Math.floor(Math.random() * 10);  // 11-20
  return 21 + Math.floor(Math.random() * 10);                // 21-30
}
export function cardHTML({ cls, color, avatar, msg, name, game, level, indicator, showGame, lastSignIn, hasPlus, hasMbox, mboxNum }) {
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
export function isUserContent(it) {
  return !!it && (it.kind === "game" || !!it.media || !!(it.icon && it.icon.folder)
    || ["music", "photo", "video"].includes(it.kind));
}
// An artist's songs in discography order: albums oldest → newest (by the
// earliest year on the album, then name), each album in disc / track order.
// The same order "By Artist (In Order)" background music uses.
export function discographyOrder(entries) {
  const byAlbum = new Map();
  for (const e of entries) { const al = (e.media.album || "").trim() || "Unknown"; if (!byAlbum.has(al)) byAlbum.set(al, []); byAlbum.get(al).push(e); }
  const yearOf = (arr) => { let y = Infinity; for (const e of arr) { const v = parseInt(e.media.year || "", 10); if (!isNaN(v)) y = Math.min(y, v); } return y; };
  return [...byAlbum.entries()]
    .sort((a, b) => (yearOf(a[1]) - yearOf(b[1])) || cmpText(a[0], b[0]))
    .flatMap(([, arr]) => [...arr].sort((a, b) => ((a.media.disc || 0) - (b.media.disc || 0)) || ((a.media.track || 0) - (b.media.track || 0))
      || cmpText(String(a.title || ""), String(b.title || ""))));
}
// x (fraction of width) of level `li` when `active` is the open level.
export function drillX(li, active) {
  if (active === 0) return spineNow;
  if (li === active) return DRILL_ACTIVE_X;
  return DRILL_ANCHOR_X - (active - 1 - li) * DRILL_STEP;
}
// An item's own title label (travels with its icon). Media folders also show
// their count line ("4 Images") while not selected, like the XMB.
export function labelHTML(it) {
  const pre = it.pre ? `<div class="il-pre">${esc(it.pre)}</div>` : "";
  const fk = it.icon && it.icon.folder ? ` il-f${it.icon.folder}` : "";
  return `<div class="item-label${it.kind === "game" || (it.icon && it.icon.gameArt && !it.icon.plainLabel) ? " il-game" : ""}${it.kind === "video" && it.icon && it.icon.art !== undefined ? " il-video" : ""}${fk}">${pre}`
    + `<div class="il-title">${esc(it.title || "")}</div><div class="il-body">${restingBody(it)}</div></div>`;
}
// Automatic Login on: the small arrow under the user's name (the Video Player's
// Instant Advance picture, IMG_3590)
export const autoLogHTML = (it) => it && it.kind === "user" && it.user && it.user.autoLogin
  ? `<div class="il-autolog"><img src="./assets/icons/system/auto_login.png" alt=""></div>` : "";
export function restingBody(it) {
  if (it.kind === "user") return autoLogHTML(it);
  if (it.userSub && it.sub) return `<div class="il-sub il-usub">${esc(it.sub)}</div>`;
  if (it.kind === "video" && it.sub) return `<div class="il-sub il-vsub">${esc(it.sub)}</div>`;
  return (it.icon && it.icon.folder && it.sub) ? `<div class="il-sub">${esc(it.sub)}</div>` : "";
}
export function resetLabel(it) {
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
// a row taken out of the page: its pictures and videos stop loading (a
// removed picture would otherwise go on loading, and scrolling quickly
// through a big library piled them up until nothing new could show)
export function dropMedia(el) {
  for (const img of el.querySelectorAll("img")) { const u = img.getAttribute("src"); if (u && !/^(\.\/)?assets\//.test(u) && !(img.complete && img.naturalWidth)) img.removeAttribute("src"); }
  for (const v of el.querySelectorAll("video")) { if (v.getAttribute("src")) { v.removeAttribute("src"); try { v.load(); } catch (e) {} } }
}
export function watchArtLoading(root, flat = null) {
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
export function fitArtRatio(frame, w, h) {
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
export function watchArtRatio(root) {
  for (const img of root.querySelectorAll(".art-frame:not(.vid-thumb):not(.photo-thumb) > img.art-img:not(.disc-img)")) {
    const fr = img.parentElement;
    const fit = () => { fr._iconAr = [img.naturalWidth, img.naturalHeight]; if (!fr._previewOn) fitArtRatio(fr, img.naturalWidth, img.naturalHeight); };
    if (img.complete && img.naturalWidth) fit(); else img.addEventListener("load", fit, { once: true });
  }
}
// A theme's folder picture (Theme Folders) fitted like the system's: themes
// draw their folders at their own sizes (a PS3 theme's icon_gamedata.png is a
// 128 x 128 square where the system's is 314 x 178; some album pictures fill
// two thirds of theirs), so the picture is scaled until what's drawn in it (its
// visible part) fills the same room as the system folder's, centred; the cover
// / icon inside goes where it sits in the system folder, in proportion to that
// visible part, so the folder always shows under it, beside it and over it as
// the system's does. (The visible part: its solid pixels, alpha over 128: a
// soft glow, shadow or faded decoration around the folder isn't counted, or
// the cover would be placed over the folder itself.) Measured once per picture (themes' pictures are loaded before
// the menus are drawn); not loaded yet: drawn as it is.
// The system folders' visible parts (fractions of their pictures: wide
// 314 x 178 for Game / Video, square 178 for Music, 237 x 178 for Photo) and
// where the cover goes in them (styles.css .ff-thumb, % of the frame).
// (their solid parts, alpha over 128, as the themes' pictures are measured)
const FF_SYS = {
  wide: { a: 314 / 178, x0: 59 / 314, x1: 254 / 314, y0: 16 / 178, y1: 148 / 178 },
  music: { a: 1, x0: 30 / 178, x1: 149 / 178, y0: 16 / 178, y1: 148 / 178 },
  photo: { a: 237 / 178, x0: 43 / 237, x1: 194 / 237, y0: 16 / 178, y1: 148 / 178 },
};
const FF_THUMB = { game: [21.7, 21.3, 56.4, 57.3], video: [19.7, 20.8, 60.5, 60.7], music: [18.5, 20.8, 63.5, 60.7], photo: [18.6, 20.8, 62.4, 60.7] };
const _ffBoxes = new Map();
function opaqueBox(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  try {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    // the solid part (alpha over 128) and everything seen (over 16: glows, shadows, faded decoration)
    let x0 = w, y0 = h, x1 = -1, y1 = -1, X0 = w, Y0 = h, X1 = -1, Y1 = -1;
    for (let y = 0; y < h; y++) for (let i = y * w * 4 + 3, xx = 0; xx < w; xx++, i += 4) {
      const al = d[i];
      if (al > 16) { if (xx < X0) X0 = xx; if (xx > X1) X1 = xx; if (y < Y0) Y0 = y; if (y > Y1) Y1 = y;
        if (al > 128) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    }
    if (X1 < 0) return null;
    const all = { x0: X0, y0: Y0, x1: X1 + 1, y1: Y1 + 1 };
    // (nothing solid in it, as a see-through glass folder: what's seen of it is the folder)
    if (x1 < 0) return { w, h, ...all, all };
    return { w, h, x0, y0, x1: x1 + 1, y1: y1 + 1, all };
  } catch (e) { return null; }
}
// ... and to the theme's own icon size: themes draw their icons bigger or
// smaller in their pictures than the system does (the system's item icons fill
// 58 % of their pictures' height, a typical value; Haunted Castle's 91 %), so
// its folders are scaled as much as its icons are, next to the system's
// (between 0.75 and 1.33 times: at most the frame's full height). Measured once
// per theme, on its item icons (icon_*, not its folders), as a median.
const SYS_ICON_FILL = 0.58;
const _themeScale = new Map();
// A theme's pictures let go of (xmb-themes.js, 10 s after it's no longer used):
// their measurements go too; `live`: the keys of the themes still in use
// (what's kept, for checking)
export const folderFitInfo = () => ({ boxes: _ffBoxes.size, scales: _themeScale.size });
export function forgetFolderFits(gone, live) {
  for (const u of gone || []) _ffBoxes.delete(u);
  for (const k of [..._themeScale.keys()]) if (!live || !live.has(k)) _themeScale.delete(k);
}
function themeFolderScale(key) {
  if (!key) return 1;
  if (_themeScale.has(key)) return _themeScale.get(key);
  const t = activeThemes().find((l) => l.key === key);
  if (!t || !t.icons) return 1;
  const fills = [];
  let missing = 0;
  for (const [name, u] of Object.entries(t.icons)) {
    if (!/^icon_/.test(name) || P3T_FOLDER_PICS.includes(name)) continue;
    const img = loadedIcon(u);
    if (!img) { missing++; continue; }
    const b = opaqueBox(img);
    if (b) fills.push((b.y1 - b.y0) / b.h);
  }
  // (too few to tell, as an Icon Set with only a few pictures: as the system's)
  let f = 1;
  if (fills.length >= 5) { fills.sort((a, b) => a - b); f = Math.max(0.75, Math.min(1.33, fills[fills.length >> 1] / SYS_ICON_FILL)); }
  if (!missing) _themeScale.set(key, f);
  return f;
}
function folderFit(url, kind, hasThumb, scale = 1) {
  const sys = FF_SYS[kind === "music" ? "music" : kind === "photo" ? "photo" : "wide"];
  let b = _ffBoxes.get(url);
  if (b === undefined) {
    const img = loadedIcon(url);
    if (!img) return null;
    b = opaqueBox(img); _ffBoxes.set(url, b);
  }
  if (!b) return null;
  const a = sys.a, pct = (v) => `${(v * 100).toFixed(3)}%`;
  // (in frame units: its height 1, its width a)
  // (the system folder's room, made larger or smaller about its middle by the theme's scale)
  const cx = (sys.x0 + sys.x1) / 2 * a, cy = (sys.y0 + sys.y1) / 2;
  const rw = (sys.x1 - sys.x0) * a * scale, rh = (sys.y1 - sys.y0) * scale, rx0 = cx - rw / 2, ry0 = cy - rh / 2;
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0, A = b.all;
  // (and everything seen in the picture stays inside the frame: a folder with
  // a big faded decoration around it comes out smaller instead of spilling out)
  const s = Math.min(rw / bw, rh / bh, a / (A.x1 - A.x0), 1 / (A.y1 - A.y0));
  const pw = bw * s, ph = bh * s;
  let px0 = rx0 + (rw - pw) / 2, py0 = ry0 + (rh - ph) / 2;
  // (moved back inside the frame where what's around the folder would leave it)
  const ax0 = px0 - (b.x0 - A.x0) * s, ax1 = px0 + (A.x1 - b.x0) * s, ay0 = py0 - (b.y0 - A.y0) * s, ay1 = py0 + (A.y1 - b.y0) * s;
  if (ax0 < 0) px0 -= ax0; else if (ax1 > a) px0 -= ax1 - a;
  if (ay0 < 0) py0 -= ay0; else if (ay1 > 1) py0 -= ay1 - 1;
  // (inset first: it would put back left / top set before it)
  const pic = `inset:auto;left:${pct((px0 - b.x0 * s) / a)};top:${pct(py0 - b.y0 * s)};width:${pct(b.w * s / a)};height:${pct(b.h * s)}`;
  let thumb = null;
  if (hasThumb) {
    const [tl, tt, tw, th] = FF_THUMB[kind] || FF_THUMB.video;
    // (the system folder's own room, as the cover's place is measured in it)
    const sx0 = sys.x0 * a, sw = (sys.x1 - sys.x0) * a, sy0 = sys.y0, shh = sys.y1 - sys.y0;
    const mx = (v) => px0 + ((v / 100) * a - sx0) / sw * pw, my = (v) => py0 + (v / 100 - sy0) / shh * ph;
    const l = mx(tl), r = mx(tl + tw), t = my(tt), bt = my(tt + th);
    thumb = `left:${pct(l / a)};top:${pct(t)};width:${pct((r - l) / a)};height:${pct(bt - t)}`;
  }
  return { pic, thumb };
}
export function itemIcon(it) {
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
    const thumbAt = () => (fit && fit.thumb ? ` style="${fit.thumb}"` : "");
    // (the system's own pictures unless Theme Folders is on; see themes.js themeIcon)
    let tpic = themeIcon(fimg, true);
    // Music / Photo folders holding a cover: a PS3 theme has no plain folder
    // picture for them (music_folder.png / photo_folder.png are the system's
    // and Icon Sets' own names), only its album picture: with Theme Folders on,
    // that one holds the cover (whole, as in the plain folder)
    if (!tpic && hasThumb && (kind === "music" || kind === "photo")) tpic = themeIcon(`icon_${kind}_album_default.png`, true);
    const furl = tpic ? tpic.url : sysUrl(fimg, true);
    // a theme's picture: fitted to the system folder's size, the cover in it (see folderFit)
    const fit = tpic ? folderFit(furl, kind, hasThumb, themeFolderScale(tpic.key)) : null;
    // .ff-tint is the folder shape filled with the current Icon Color, multiplied
    // over the folder graphic so the folder (and the Default folder's glyph) take
    // the icon colour while the inner photo/thumbnail is left untouched.
    return `<div class="folder-frame folder-${kind}${bd ? " ff-bd" : ""}" style="--fimg:url('${furl}')">`
      + `<img class="ff-folder" src="${furl}" alt=""${fit ? ` style="${fit.pic}"` : ""}>`
      + `<span class="ff-tint"${fit ? ` style="${fit.pic}"` : ""}></span>`
      + `${hasThumb ? `<img class="ff-thumb" src="${it.icon.art}" alt=""${thumbAt()}>` : ""}</div>`;
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
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
// PS3 media-folder duration: M'SS" (e.g. 3'07", 46'11")
export const fmtDurClock = (s) => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}'${ss}''` : `${m}'${ss}''`;
};
export const fmtSize = (b) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;

// (the shared `let`s, set from the XMB's parts)
export function __set_spineNow(v) { spineNow = v; }
export function __set_PLAYER_OWN(v) { PLAYER_OWN = v; }
export function __set_ICON_AUTO_RGB(v) { ICON_AUTO_RGB = v; }
export function __set_ICON_AUTO_GAIN(v) { ICON_AUTO_GAIN = v; }
export function __set_ICON_AUTO_DEFAULT(v) { ICON_AUTO_DEFAULT = v; }
