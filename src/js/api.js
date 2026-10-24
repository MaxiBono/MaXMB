// Bridges the UI to the Rust backend. Inside Tauri it calls real commands and
// resolves on-disk paths via convertFileSrc. In a plain browser it serves mock
// data (an empty library) so the whole XMB is still explorable.

const T = window.__TAURI__;
export const IN_TAURI = !!(T && T.core && T.core.invoke);
const invoke = IN_TAURI ? T.core.invoke : null;
const convertFileSrc = IN_TAURI ? T.core.convertFileSrc : (p) => p;

// ---- the log (content\Logs\MaXMB.log, see log.rs) ------------------------
// Errors and warnings from the menus, anything that crashes in them and the
// requests to the back end that fail go in it, sent a few at a time.
const _logQ = [];
let _logT = 0, _logging = false;
const _str = (v) => { if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`; if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); } };
export function logLine(level, ...parts) {
  if (!IN_TAURI) return;
  _logQ.push([level, parts.map(_str).join(" ")]);
  if (_logQ.length > 500) _logQ.splice(0, _logQ.length - 500);
  if (!_logT) _logT = setTimeout(_logFlush, 500);
}
async function _logFlush() {
  _logT = 0; _logging = true;
  try { while (_logQ.length) { const [level, msg] = _logQ.shift(); await invoke("log_write", { level, msg }).catch(() => {}); } }
  finally { _logging = false; }
}
if (IN_TAURI) {
  for (const level of ["error", "warn"]) {
    const orig = console[level].bind(console);
    console[level] = (...a) => { orig(...a); if (!_logging) logLine(level, ...a); };
  }
  window.addEventListener("error", (e) => logLine("error", e.error || `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => logLine("error", "Unhandled:", e.reason));
}

// Subscribe to a backend event (no-op in the plain-browser preview).
export function listen(name, cb) {
  if (!IN_TAURI || !T.event || !T.event.listen) return Promise.resolve(() => {});
  return T.event.listen(name, (e) => cb(e.payload));
}

// A title without its file extension ("Trip.jpg" -> "Trip"): only known
// picture / video / document / program / disc-image extensions are taken off,
// so names like "Vol. 2" or "Version 1.5" stay as they are.
const FILE_EXT_RE = /\.(jpe?g|jfif|pjpeg|pjp|png|apng|gif|webp|bmp|tiff?|avif|heic|heif|ico|svg|mp4|m4v|mkv|webm|avi|mov|wmv|flv|mpe?g|mpg|ts|m2ts|mts|3gp|ogv|vob|divx|pdf|cbz|cbt|cbr|exe|lnk|url|bat|cmd|ps1|py|pyw|vbs|vbe|wsf|js|jar|ahk|msi|appref-ms|sh|iso|bin|cue|chd|cso|pbp|pkg|elf|self|zip|7z|rar)$/i;
// Sorting by name: one shared collator for each kind of comparison (a
// collator made once compares many times faster than localeCompare with
// options, which builds one on every call)
const _col = (o) => { const c = new Intl.Collator(undefined, o); return (a, b) => c.compare(a, b); };
/** Plain text order (as localeCompare). */
export const cmpText = _col();
/** Case- and accent-blind order. */
export const cmpBase = _col({ sensitivity: "base" });
/** Natural order (numbers by value: "Track 2" before "Track 10"), case- and accent-blind. */
export const cmpNatural = _col({ numeric: true, sensitivity: "base" });
export function noExt(name) { const s = String(name ?? ""); const t = s.replace(FILE_EXT_RE, ""); return t.trim() ? t : s; }

// a file the app rewrote (a rotated photo): its URL gets a new ?v= so the
// webview doesn't show the copy it already has
const _assetVer = new Map();
export function bumpAsset(path) { if (path) _assetVer.set(path, (_assetVer.get(path) || 0) + 1); }
/** A picture's small copy (at most 480 px on its longer side) for lists and
 * grids: made once by the backend (thumb://, see src-tauri/src/thumbs.rs)
 * and kept; small pictures, GIFs and kinds it can't read come as they are.
 * (In the plain-browser preview: the picture itself.) */
export function thumbUrl(path, still = false) {
  if (!path) return null;
  if (/^(data:|blob:)/.test(path)) return path;
  // (preview: the picture itself, marked so a test server can stand in)
  if (!IN_TAURI || /^(https?:|\.\/)/.test(path)) { const u = assetUrl(path); return `${u}${u.includes("?") ? "&" : "?"}thumb=1${still ? "&still=1" : ""}`; }
  const u = convertFileSrc(path, "thumb"), v = _assetVer.get(path);
  const q = [v ? `v=${v}` : "", still ? "still=1" : ""].filter(Boolean).join("&");
  return q ? `${u}?${q}` : u;
}
/** A still for a grid square: a video's Change Icon picture or its own frame
 * (at 0.5 s), a GIF's first frame, a picture's small copy. */
export const stillUrl = (path, cover) => (cover ? thumbUrl(cover) : thumbUrl(path, /\.gif$/i.test(String(path || "")) || isVideoFile(path)));
const isVideoFile = (p) => /\.(mp4|m4v|webm|mkv|avi|mov|wmv|asf|flv|mpg|mpeg|m2ts|mts|ts|vob|3gp|ogv|divx|3g2|f4v|rm|rmvb|mxf|ogm|dv|mod|tod|m2v|m1v|mpe|mpv|m2t|trp|tp|evo|vro|qt|amv|nsv|xvid|h264|264|hevc|265|y4m|bik|nut)$/i.test(String(p || ""));
export function assetUrl(path) {
  if (!path) return null;
  const u = convertFileSrc(path), v = _assetVer.get(path);
  return v ? `${u}${u.includes("?") ? "&" : "?"}v=${v}` : u;
}

// ---- browser-preview mock state -------------------------------------------

const mock = {
  users: { users: [], active: null },
  psn: { accounts: [] },
  settings: {
    libraryPaths: [], musicPaths: [], photoPaths: [], videoPaths: [],
    mediaMode: "app", mediaFolders: {}, gameMode: "app", gameSources: [],
    behavior: { fullscreen: true, autostart: false, bootAnimation: true, bootSound: "coldboot" },
    input: { controller: true, keyboard: true, mouse: true, deadzone: 0.5 },
  },
};

// (browser preview only: a test can start the mock with saved users, PSN
// accounts and settings, as after a restart)
try { if (!IN_TAURI && typeof window !== "undefined" && window.__xmbMockSeed) Object.assign(mock, JSON.parse(JSON.stringify(window.__xmbMockSeed))); } catch (e) {}

// (the browser preview starts with an empty library)
const MOCK_GAMES = [];
const MOCK_MEDIA = { music: [], photo: [], video: [] };

let idc = 1;
const nid = (p) => `${p}${Date.now()}_${idc++}`;

// A native file / folder picker is open: the controller drives the real mouse
// there (Rust side), so the XMB itself ignores all input until it closes.
const PICKERS = new Set(["pick_folder", "pick_font", "pick_file"]);
export async function call(cmd, args = {}) {
  if (IN_TAURI && PICKERS.has(cmd)) {
    Input.picking = (Input.picking || 0) + 1;
    try { return await invoke(cmd, args); }
    finally {
      try { window.focus(); } catch (e) {}   // the page takes the keys / controller again
      setTimeout(() => { Input.picking = Math.max(0, (Input.picking || 1) - 1); }, 250);
    }
  }
  if (IN_TAURI) return invoke(cmd, args).catch((e) => { logLine("warn", `${cmd} failed:`, e); throw e; });
  switch (cmd) {
    // in-app browser (preview only): a simulated LibreWolf session
    case "browser_status": return { installed: true, updater: true, ready: true, browserDir: "(preview)", profile: "(preview)" };
    case "browser_open": {
      mock.browser = { open: true, phase: "starting", focus: false, focusSeq: (mock.browser?.focusSeq || 0),
        focusValue: "", focusReplace: true, focusPassword: false, title: "", url: "", hover: "", cmds: [] };
      setTimeout(() => { if (mock.browser?.open) Object.assign(mock.browser, { phase: "ready",
        title: args.mode === "search" ? `${args.url} - Search` : "Home", url: args.mode === "search" ? `https://search.example/?q=${encodeURIComponent(args.url || "")}` : "https://home.example/" }); }, 700);
      return null;
    }
    case "browser_state": return { ...(mock.browser || { open: false, phase: "closed", focusSeq: 0 }) };
    case "browser_close": if (mock.browser) Object.assign(mock.browser, { open: false, phase: "closed" }); return null;
    case "browser_cmd": case "browser_type": if (mock.browser) mock.browser.cmds.push({ cmd, ...args }); return null;
    case "browser_input": case "browser_visible": return null;
    case "content_writable": return { ok: true, dir: "(preview)" };
    case "app_info": return { name: "MaXMB", version: "1.0.0", contentRoot: "(preview)" };
    case "scan_library": return structuredClone(MOCK_GAMES);
    case "game_sources_sync": return 0;
    case "media_recognize": case "media_source_remove": return 0;
    case "pick_file": return null;
    case "image_has_alpha": return /\.png$/i.test(args.path || "");
    case "game_mode_end": return null;
    case "list_fonts": return [];
    case "pick_font": return null;
    case "game_meta_save": { const g = MOCK_GAMES.find((x) => x.folder === args.folder);
      if (g) { if (args.patch.isDisc) MOCK_GAMES.forEach((x) => { x.isDisc = false; }); Object.assign(g, args.patch); } return null; }
    case "game_delete": { const i = MOCK_GAMES.findIndex((x) => x.folder === args.folder); if (i >= 0) MOCK_GAMES.splice(i, 1); return null; }
    case "icon_shades_load": return "{}";
    case "icon_shades_save": return null;
    case "game_sources_detected": return [];
    case "game_sources_delete": return null;
    case "game_sources_remove": return 0;
    case "pick_folder": return null;
    case "photo_deletable": return true;
    case "photo_delete": case "photo_write": return null;
    case "photo_save_copy": return args.path;
    case "photo_save_wallpaper": return args.dataUrl || null;
    // custom sections (preview): the mock media and games (none by default)
    case "section_folder": return `C:\\XMB\\content\\${args.section}${args.sub ? "\\" + args.sub : ""}`;
    case "section_list": {
      const ph = (MOCK_MEDIA.photo || []).map((m, i) => ({ kind: "photo", group: i < 2 ? "Trips" : "", media: structuredClone(m), game: null, meta: {} }));
      const mu = (MOCK_MEDIA.music || []).slice(0, 2).map((m) => ({ kind: "music", group: "", media: structuredClone(m), game: null, meta: {} }));
      const g = MOCK_GAMES[0] ? [{ kind: "game", group: "", media: null, game: structuredClone(MOCK_GAMES[0]), meta: {} }] : [];
      return [...ph, ...mu, ...g];
    }
    case "media_fingerprint": return `${(MOCK_MEDIA[args.kind] || []).length}`;
    case "list_media": return structuredClone(args.kind === "background"
      ? [...(MOCK_MEDIA.photo || []), ...(MOCK_MEDIA.video || [])] : (MOCK_MEDIA[args.kind] || []));
    case "get_settings": return structuredClone(mock.settings);
    case "save_settings": mock.settings = structuredClone(args.settings); return null;
    case "set_autostart": case "set_fullscreen": return null;
    case "list_users": return structuredClone(mock.users);
    case "create_user": {
      const u = { id: nid("u"), name: args.name, avatar: args.avatar, psnAccountId: null,
        theme: { backgroundColor: "auto", waveColor: "auto", iconColor: "auto" },
        soundEnabled: true, musicEnabled: true };
      mock.users.users.push(u); if (!mock.users.active) mock.users.active = u.id; return u;
    }
    case "save_user": {
      const i = mock.users.users.findIndex((u) => u.id === args.user.id);
      if (i >= 0) mock.users.users[i] = args.user; else mock.users.users.push(args.user);
      return null;
    }
    case "set_active_user": mock.users.active = args.id; return null;
    case "delete_user": mock.users.users = mock.users.users.filter((u) => u.id !== args.id); return null;
    case "list_psn_accounts": return structuredClone(mock.psn);
    case "list_psn_avatars": return { dir: "", files: [] };
    case "save_psn_account": {
      const a = structuredClone(args.account); if (!a.id) a.id = nid("p");
      const i = mock.psn.accounts.findIndex((x) => x.id === a.id);
      if (i >= 0) mock.psn.accounts[i] = a; else mock.psn.accounts.push(a);
      return a;
    }
    case "themes_p3t": return structuredClone(window.__mockThemes?.p3t || []);
    case "themes_icon": return structuredClone(window.__mockThemes?.icon || []);
    case "themes_custom": return structuredClone(window.__mockThemes?.custom || []);
    case "themes_sound": return structuredClone(window.__mockThemes?.sound || []);
    case "custom_theme_create": (window.__mockCreated ||= []).push(structuredClone(args)); return "Themes/" + args.name + ".zip";
    case "theme_extract": return "Themes Extracted/" + args.name;
    // video player (preview): no ffmpeg, so a fixed description
    case "video_info": return { vcodec: "h264", vkbps: 18100, width: 1280, height: 720, fps: 30, acodec: "aac", channels: 2,
      sampleRate: 44100, akbps: 124, duration: 0, subs: [{ index: 0, lang: "eng", title: "", codec: "subrip" }], audioTracks: 1, probed: true, vkey: "avc", akey: "aac" };
    case "video_prepare": throw "ffmpeg not found";
    case "video_subtitle": return "WEBVTT\n\n00:00:00.500 --> 00:00:04.000\nEmbedded subtitle sample\n";
    case "video_set_icon": return args.dataUrl || "";
    case "video_icon_files": return [null, null];
    case "video_deletable": return true;
    case "video_delete": return null;
    case "video_plan": return { mode: "direct", cached: null };
    case "video_preload": return false;
    case "music_deletable": return true;
    case "music_delete": return null;
    default: return null;
  }
}


// Tracks the most recent input source so text entry can switch to the
// on-screen keyboard when a controller is being used.
export const Input = { lastKind: "keyboard",
  // buttons held right now (gamepad + keyboard), for hold-to-repeat actions
  held: { l2: false, r2: false, enter: false } };
