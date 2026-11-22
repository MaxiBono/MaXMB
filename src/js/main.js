// Boots the launcher: intro -> XMB (locked to the Users column until a profile
// is chosen). Routes keyboard / mouse / gamepad input to the XMB, and keeps the
// top-right info box in sync with the signed-in PSN account.

import { call, Input, listen, assetUrl, bumpAsset, logLine } from "./api.js";
import { Keybinds } from "./keybinds.js";
import { AudioManager } from "./audio.js";
import { WaveBackground } from "./wave.js";
import { InfoBox } from "./clock.js";
import { playIntro } from "./intro.js";
import { Xmb } from "./xmb.js";
import { loadPsnAvatars, ColorPicker, OnScreenKeyboard } from "./ui.js";
import { startMarquees } from "./marquee.js";
import { startGlyphs } from "./glyphs.js";
import { preloadAppIcons } from "./iconshade.js";

const manifest = await (await fetch("./assets/manifest.json")).json();
await loadPsnAvatars(); // enumerate drop-in PSN avatars before the XMB uses them
const audio = new AudioManager(manifest);
const settings = await call("get_settings");
const appInfo = await call("app_info");
// Graphics safety for the Original wave, kept in the settings for this computer
// (not per user): "ok" once it ran well here, "trial" while it's being tried,
// "failed" (with why) when it couldn't run: then linkev's wave is used
const waveGuard = {
  state: () => settings.graphics || {},
  set: (st, reason) => {
    const g = (settings.graphics ||= {});
    if ((g.originalWave || "") === (st || "") && (g.reason || null) === (reason || null)) return;
    if (st) g.originalWave = st; else delete g.originalWave;
    if (reason) g.reason = reason; else delete g.reason;
    call("save_settings", { settings }).catch(() => {});
  },
};
// (it starts with the Wave Style last chosen here: xmb.js keeps it in settings.graphics.waveStyle)
// (Keep Personalization Options when Booting Off: the original look until someone signs in)
const keepLook = settings.behavior?.keepBootLook !== false;
const wave = new WaveBackground(document.getElementById("wave"), { guard: waveGuard, style: keepLook ? (settings.bootLook?.waveEngine || settings.graphics?.waveStyle) : undefined });
// (the rest of the look before anyone signs in: xmb.js start, _bootLookApply)
wave.resetWaveParams();
const infobox = new InfoBox(document.getElementById("infobox"));

// apply system-wide volumes + brightness + time format from saved settings at boot
audio.setMasterVolume((settings.behavior?.volume ?? 100) / 100);
audio.setMusicVolume((settings.behavior?.musicVolume ?? 100) / 100);
audio.setSfxVolume((settings.behavior?.sfxVolume ?? 100) / 100);
// the startup sound of the Sound Effects pack / Custom Theme the last user had in use
if (settings.behavior?.bootSoundFile) audio.setFile("coldboot", assetUrl(settings.behavior.bootSoundFile));
const _dim = document.getElementById("dim");
if (_dim) _dim.style.opacity = String(Math.max(0, Math.min(1, (100 - (settings.behavior?.brightness ?? 100)) / 100)));
audio.playInBackground = settings.behavior?.playAudioBackground !== false;
infobox.setTimeFormat(settings.behavior?.timeFormat || "24");
infobox.setDateFormat(settings.behavior?.dateFormat || "DD/MM/YYYY");


// Info box shows the *PSN* avatar + friends-online, and only when signed in.
// The friends-online COUNT is pushed separately by the XMB (onFriendsOnline)
// once the friend list is generated: it's the number of Online/AFK friends -
// so here we only set the avatar (and clear the count on sign-out).
async function updateInfobox(user) {
  // (logging in: the box grows, then its profile slots fade in -- styles.css body.ib-grow)
  if (user && document.body.classList.contains("no-user")) {
    document.body.classList.add("ib-grow"); clearTimeout(updateInfobox._t);
    updateInfobox._t = setTimeout(() => document.body.classList.remove("ib-grow"), 900);
  }
  document.body.classList.toggle("no-user", !user);
  setCursorLock(!user);
  if (user && user.psnAccountId) {
    const psn = await call("list_psn_accounts");
    const a = psn.accounts.find((x) => x.id === user.psnAccountId);
    if (a) { infobox.setProfile({ avatar: a.avatar, plus: !!user.friendConfig?.playerPlus }); return; }
  }
  infobox.setProfile({ avatar: null, friends: 0, plus: false, mail: false }); // hidden until signed in
}

document.body.classList.add("no-user");
// px-drawn pieces (friend cards) scale with the window: 1.0 at 1080 px tall
const _ux = () => document.documentElement.style.setProperty("--ux", String((window.innerHeight || 1080) / 1080));
_ux(); window.addEventListener("resize", _ux);
const xmb = new Xmb(audio, wave, {
  onProfileChange: (u) => updateInfobox(u),
  onFriendsOnline: (n, mail) => infobox.setProfile({ friends: n, mail: !!mail }),
  onTimeFormat: (fmt) => infobox.setTimeFormat(fmt),
  onDateFormat: (fmt) => infobox.setDateFormat(fmt),
  onFullscreen: (fs) => setFsMouse(fs),
  infobox,
});
xmb.setContext(settings, appInfo);

// Dev/debug hooks (harmless in production): let headless tests and the console
// reach the live XMB + wave instances.
window.__xmb = xmb; window.__wave = wave; window.__manifest = manifest;
// (a held Up / Down in a media list goes at the console's pace: holdPace)
window.__xmbListHold = () => { try { return !xmb.overlay && !xmb.locked && xmb._smoothList(xmb._level()); } catch (e) { return false; } };

// scroll any title that's too long to show in full (applies app-wide)
startMarquees();
startGlyphs();

// "Play Audio in Background" = Off pauses audio when the app loses focus.
const _bgAudioSync = () => {
  if (document.hidden) audio.suspendForBackground(); else audio.resumeFromBackground();
};
document.addEventListener("visibilitychange", _bgAudioSync);
window.addEventListener("blur", () => { if (!audio.playInBackground) audio.suspendForBackground(); xmb.setLowPower(1); });
window.addEventListener("focus", () => { audio.resumeFromBackground(); xmb.setLowPower(0);
  // (back in the System after adding files in Windows: a custom section on
  // screen is read again, so they show at once)
  const c = xmb.columns && xmb.columns[xmb.selCat];
  if (c && c.section) xmb._liveRefresh(c.id); });
// (the backend brings the app back when a controller button is pressed while
// the page has lost the focus; see focus.rs)
window.addEventListener("focus", () => call("page_focus", { focused: true }).catch(() => {}));
window.addEventListener("blur", () => call("page_focus", { focused: false }).catch(() => {}));
// (at the start, too: a window that opens without its page focused (another
// program kept the focus) gets no focus / blur event, so the controller
// wouldn't be read until a key was pressed; told now, the backend brings the
// page into focus at the first controller press. Checked again a few times
// while the system starts)
for (const ms of [0, 1500, 4000, 8000]) setTimeout(() => { if (!document.hasFocus()) call("page_focus", { focused: false }).catch(() => {}); }, ms);
document.addEventListener("visibilitychange", () => xmb.setLowPower(document.hidden ? 1 : 0));
// art found online for newly recognized games (in the background): the Game
// column shows it once the downloads settle
{ let t = 0; window.__TAURI__?.event?.listen?.("games-updated", () => { clearTimeout(t); t = setTimeout(() => xmb._refreshGameColumn(), 1500); }); }
// Steam's pictures put in by Game Recognition (in place of files of the same
// name): those games' pictures read again, not the ones the page still holds
window.__TAURI__?.event?.listen?.("game-art-changed", (e) => {
  for (const f of (e && e.payload) || []) { const g = xmb._gameByFolder(f); if (g) for (const k of ["icon", "background", "preview", "trophy"]) bumpAsset(g[k]); }
});

// The app's own icons and pictures are all loaded while the intro plays (after
// its sound is ready, so the sound isn't held up): every menu then shows its
// icons at once. Only the user's own files (covers, photos, game icons…) load
// as they come near the cursor.
const appIconsReady = (async () => {
  try { await audio.ready(settings.behavior?.bootSound || "coldboot", 2500); } catch (e) {}
  let urls = [];
  try { urls = await (await fetch("./assets/icons/index.json")).json(); } catch (e) {}
  await preloadAppIcons(urls);
})();

// ------------------------------------------------------------------- input
// (nothing reaches the menu while it waits behind the black screen / the intro)
function dispatch(a) {
  if (Input.picking || document.body.classList.contains("intro-hold") || document.body.classList.contains("hud-off")) return;
  xmb.onInput(a);
  syncGlows();
}
// Glows run on one clock: every glowing pulse (a selected title, a focused
// key or button, the glowing icons...) is set to have started at the same
// moment, so moving to another item doesn't start its glow over: it carries
// on from where every glow is. Checked after each button and on hovering.
const GLOW_ANIMS = new Set(["xmbLabelGlow", "xmbLabelGlowF", "xmbCardNameGlow", "xmbPickGlow", "iconOutlineGlow", "iconGlowPulse", "colorGlowPulse",
  "oskSel", "vbPulse", "vpThumbGlow", "swatchGlow", "secPulse", "gridHlGlow", "tfxFill", "tfxBtnFill"]);
let _glowRaf = 0;
function syncGlows() {
  if (_glowRaf) return;
  // (two frames on: the new item's style, and so its glow, is in place by then)
  _glowRaf = requestAnimationFrame(() => requestAnimationFrame(() => {
    _glowRaf = 0;
    try {
      for (const an of document.getAnimations()) {
        if (!GLOW_ANIMS.has(an.animationName) || an.playState !== "running" || an.startTime === 0) continue;
        an.startTime = 0;
      }
    } catch (e) {}
  }));
}
window.__syncGlows = syncGlows;
document.addEventListener("mouseover", syncGlows, { passive: true });
function toggleHud() {
  if (document.body.classList.contains("intro-hold") || xmb.browserActive) return;
  document.body.classList.toggle("hud-off");
}

// Fullscreen flag (kept for wheel/right-click gating); cursor visibility is now
// handled by the idle-hide manager below, not by fullscreen.
let mouseBlocked = false;
function setFsMouse(fs) { mouseBlocked = !!fs; document.body.classList.toggle("fs", !!fs); }
setFsMouse(settings.behavior?.fullscreen !== false);

// Cursor idle-hide (N2): the pointer starts hidden, reappears on any mouse move
// or click, then hides again after 3s with no mouse activity. In the video
// player it stays hidden the whole time (CSS body.video-open wins regardless).
const CURSOR_IDLE_MS = 1000;
let cursorTimer = null;
function hideCursor() { document.body.classList.add("hide-cursor"); }
function showCursor() {
  clearTimeout(cursorTimer);
  document.body.classList.remove("hide-cursor");
  cursorTimer = setTimeout(hideCursor, CURSOR_IDLE_MS);
}
hideCursor(); // start hidden until the mouse moves
// Until a user logs in, the pointer is hidden and parked in the middle of the
// screen (held there by the backend) and the mouse does nothing.
const cursorLocked = () => document.body.classList.contains("cursor-locked");
function setCursorLock(on) {
  document.body.classList.toggle("cursor-locked", !!on);
  call("cursor_lock", { lock: !!on }).catch(() => {});
}
for (const t of ["mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu", "mousemove", "pointerdown", "pointerup", "pointermove"]) {
  window.addEventListener(t, (e) => { if (cursorLocked()) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); } }, { capture: true, passive: false });
}
setCursorLock(true);
// (only a mouse that really moved: Chromium also sends a "mousemove" when what's under a still
// pointer changes -- the on-screen keyboard opening under it, a menu drawn again -- which showed
// the cursor for a moment over it. The pointer's place on the screen, not in the window, so going
// in or out of full screen, which moves the window under a still mouse, isn't taken for a move.)
let _mx = null, _my = null;
window.addEventListener("mousemove", (e) => {
  const moved = !!(e.movementX || e.movementY) || (_mx !== null && (e.screenX !== _mx || e.screenY !== _my));
  _mx = e.screenX; _my = e.screenY;
  if (moved) showCursor();
}, { passive: true });
window.addEventListener("mousedown", showCursor, { passive: true });

// Keyboard / mouse bindings (Settings > System Settings > Change Keybinds).
Keybinds.load(settings.input?.keybinds);
// keys held down for hold-to-repeat actions (L2 / R2 / Cross)
// (and the directions, so the Photo Viewer can move a picture smoothly)
const HOLD_KEYS = ["l2", "r2", "enter", "up", "down", "left", "right"];
const kbHeld = Object.fromEntries(HOLD_KEYS.map((k) => [k, false]));
const holdOf = (code) => { const a = Keybinds.actionFor(code); return HOLD_KEYS.includes(a) ? a : null; };
const syncKbHeld = () => { for (const k of HOLD_KEYS) if (!_hadPad) Input.held[k] = kbHeld[k]; };
window.addEventListener("keyup", (e) => { _keysDown.delete(e.code); if (e.code === kbRep.code) kbRepStop(); const k = holdOf(e.code); if (k) { kbHeld[k] = false; syncKbHeld(); } });
window.addEventListener("blur", () => { _keysDown.clear(); kbRepStop(); for (const k of HOLD_KEYS) kbHeld[k] = false; syncKbHeld(); });
// Keys down now (pressed, not let go yet). Another keydown of one of them is a
// repeat of the held key, even when it isn't marked as one: some keyboards
// (or their drivers / helper programs) send a held key's repeats as new presses,
// and each was taken as a separate press (a row every repeat, with no slide)
const _keysDown = new Set();
// (the key event being handled is such a repeat: see "quit" below)
let _kbRepNow = false;
// Left Stick keys (W A S D by default): the stick's directions; on a screen
// that reads the stick itself (the Photo Viewer moves the picture with it)
// they push the stick while held
const LS = { ls_up: [0, -1], ls_down: [0, 1], ls_left: [-1, 0], ls_right: [1, 0] };
const lsHeld = new Set();
function lsTick() {
  if (!lsHeld.size) return;
  let lx = 0, ly = 0; for (const k of lsHeld) { lx += LS[k][0]; ly += LS[k][1]; }
  Input.sticks = { lx, ly, rx: 0, ry: 0, at: performance.now() };
  requestAnimationFrame(lsTick);
}
window.addEventListener("keyup", (e) => { const a = Keybinds.actionFor(e.code); if (a in LS) lsHeld.delete(a); });
window.addEventListener("blur", () => lsHeld.clear());
function bindAction(a, e) {
  if (!a) return;
  e && e.preventDefault();
  if (a in LS) {
    if (xmb.overlay && xmb.overlay.rawLeftStick) { if (!lsHeld.size) requestAnimationFrame(lsTick); lsHeld.add(a); return; }
    a = { ls_up: "up", ls_down: "down", ls_left: "left", ls_right: "right" }[a];
  }
  if (a === "screenshot") { xmb.screenshot(); return; }
  // Hide HUD (F10): everything but the background goes away (and the menu
  // stays as it is) until it's pressed again
  if (a === "hud") { toggleHud(); return; }
  if (a === "brnexttab") { if (xmb.browserActive) xmb.browserButton("brnexttab"); return; }
  if (a === "brfullscreen") { if (xmb.browserActive) xmb._browserCmd("fullscreen"); return; }
  // Close System (F4): no question asked. Not while Change Keybinds is open,
  // nor a key held down repeating (the key just bound mustn't close the system)
  if (a === "quit") {
    // (nor just as the window comes back to the front: a key pressed in
    // another program (Alt+F4 closing an emulator) reaching the app)
    if ((e && (e.repeat || _kbRepNow)) || Keybinds.resetHook || performance.now() - _focusedAt < 400) return;
    call("quit_app").catch(() => {}); return;
  }
  dispatch(a);
}
// A held direction key (arrows, and the Left Stick keys) repeats on the
// controller's own clock: the first repeat 380 ms after the press, then one
// every 130 ms, on the display's frames (see the gamepad's dir repeat in
// pollGamepad). Windows' own key repeat isn't used for them: its pace (about
// 30 a second, or much slower on some keyboards) and its unevenness, cut down
// to the controller's pace, made the long lists scroll in bursts.
const DIR_ACTIONS = ["up", "down", "left", "right", "ls_up", "ls_down", "ls_left", "ls_right"];
// The pace of a held direction: [first repeat after, then one every] ms. Up / Down in the media
// lists (xmb.js _smoothList) go at the console's own pace, measured on its capture frame by
// frame: the first repeat 300 ms after the press, then a row every 66.7 ms (15 a second).
const holdPace = (a) => ((a === "up" || a === "down" || a === "ls_up" || a === "ls_down") && window.__xmbListHold && window.__xmbListHold() ? [300, 1000 / 15] : [380, 130]);
const kbRep = { code: null, a: null, next: 0, raf: 0 };
function kbRepStop() { if (kbRep.raf) cancelAnimationFrame(kbRep.raf); kbRep.code = kbRep.a = null; kbRep.raf = 0; }
function kbRepTick() {
  kbRep.raf = 0;
  if (!kbRep.code) return;
  const now = performance.now();
  if (now >= kbRep.next) {
    // (on its own clock, not from this frame: the pace doesn't drift with the frames' length)
    const every = holdPace(kbRep.a)[1]; kbRep.next = Math.max(kbRep.next + every, now - every);
    // (as before: the Music Player doesn't take a held key's repeats)
    if (!document.getElementById("musicplayer")?.classList.contains("show") && !Keybinds.capture) {
      window.__inputRepeat = true; Input.lastKind = "keyboard";
      bindAction(kbRep.a, null);
      window.__inputRepeat = false;
    }
  }
  kbRep.raf = requestAnimationFrame(kbRepTick);
}
// when the window last came to the front (see "quit" above)
let _focusedAt = -1e9;
window.addEventListener("focus", () => { _focusedAt = performance.now(); });
window.addEventListener("keydown", (e) => {
  Input.lastKind = "keyboard";
  // (a key held down repeating, not pressed again (marked as a repeat or not,
  // see _keysDown): lists speed up only then, see holdAccel)
  const rep = e.repeat || _keysDown.has(e.code);
  _keysDown.add(e.code); _kbRepNow = rep;
  window.__inputRepeat = rep;
  // Change Keybinds: F11 always restores the default keys (can't be rebound)
  if (Keybinds.resetHook && e.code === "F11") { e.preventDefault(); e.stopPropagation(); Keybinds.resetHook(); return; }
  // the Change Keybinds menu is waiting for a key
  if (Keybinds.capture) { e.preventDefault(); e.stopPropagation(); Keybinds.capture(e.code); return; }
  { const k = holdOf(e.code); if (k) { kbHeld[k] = true; syncKbHeld(); } if (rep && k && document.getElementById("musicplayer")?.classList.contains("show")) { e.preventDefault(); return; } }
  // A held direction key repeats on the controller's clock (see kbRepTick):
  // Windows' own repeats of it are left out
  // (not in a text field: there the arrows move the typing point as usual)
  if (!(e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) {
    const a = Keybinds.actionFor(e.code);
    if (DIR_ACTIONS.includes(a)) {
      if (rep) { e.preventDefault(); return; }
      kbRepStop(); kbRep.code = e.code; kbRep.a = a; kbRep.next = performance.now() + holdPace(a)[0];
      kbRep.raf = requestAnimationFrame(kbRepTick);
    }
  }
  // in a text field the keys type; Enter / Esc and up / down (to move between
  // the field and the buttons) still work as usual
  if (e.target && e.target.tagName === "INPUT" && !["Enter", "Escape", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  bindAction(Keybinds.actionFor(e.code), e);
}, true);
// extra mouse buttons (middle / back / forward) can be bound too
window.addEventListener("mousedown", (e) => {
  if (![1, 3, 4].includes(e.button)) return;
  if (cursorLocked()) { e.preventDefault(); return; }
  if (Keybinds.capture) { e.preventDefault(); e.stopPropagation(); Keybinds.capture("Mouse" + e.button); return; }
  bindAction(Keybinds.actionFor("Mouse" + e.button), e);
}, true);
window.addEventListener("auxclick", (e) => e.preventDefault());

let wheelLock = false;
window.addEventListener("wheel", (e) => {
  showCursor();
  if (document.body.classList.contains("hud-off")) return;
  if (wheelLock) return; wheelLock = true; setTimeout(() => (wheelLock = false), 90);
  window.__inputRepeat = false;
  const dir = e.deltaY > 0 ? 1 : -1;
  // the Photo Viewer zooms with the wheel
  if (!e.shiftKey && xmb.overlay && xmb.overlay.onWheel && xmb.overlay.onWheel(dir)) { Input.lastKind = "mouse"; return; }
  dispatch(e.shiftKey ? (dir > 0 ? "right" : "left") : (dir > 0 ? "down" : "up"));
}, { passive: true });
// Click and drag across the XMB: dragging sideways moves between the
// sections (one section per section-width dragged), up / down between the
// items of the column or subsection (one item per item-height), like pulling
// the menu along. Only while no menu / window is open; a drag isn't a click.
{
  let drag = null;
  window.addEventListener("pointerdown", (e) => {
    drag = null;
    if (e.button !== 0 || cursorLocked() || xmb.overlay || document.body.classList.contains("menu-open")) return;
    if (!e.target.closest || !e.target.closest("#xmb")) return;
    drag = { x: e.clientX, y: e.clientY, axis: null, acc: 0, moved: false };
  }, true);
  window.addEventListener("pointermove", (e) => {
    if (!drag || !(e.buttons & 1)) { drag = null; return; }
    if (xmb.overlay) { drag = null; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    const step = drag.axis === "x" ? innerWidth * 0.105 : innerHeight * 0.085;
    const d = drag.axis === "x" ? dx : dy;
    // (dragging left goes to the section on the left, up to the item above)
    while (Math.abs(d - drag.acc) >= step) {
      const s = Math.sign(d - drag.acc);
      drag.acc += s * step; drag.moved = true; Input.lastKind = "mouse";
      dispatch(drag.axis === "x" ? (s < 0 ? "left" : "right") : (s < 0 ? "up" : "down"));
    }
  }, { passive: true });
  window.addEventListener("pointerup", () => {
    if (drag && drag.moved) window.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    drag = null;
  }, true);
}
// right click = Triangle (on an item of the XMB: that item's △ menu)
window.addEventListener("contextmenu", (e) => {
  e.preventDefault(); Input.lastKind = "mouse";
  if (Input.picking) return;
  if (!xmb.overlay && !document.body.classList.contains("menu-open") && xmb.selectAt && xmb.selectAt(e.target)) {}
  dispatch("options");
});

// item 2: help the webview see the controller. Some WebView2 builds only
// enumerate a pad after a gamepadconnected event or a focus change, so listen
// for connection and make sure the window/webview holds focus.
window.addEventListener("gamepadconnected", () => { Input.lastKind = "controller"; try { window.focus(); } catch (e) {} });
window.addEventListener("load", () => { try { window.focus(); } catch (e) {} });
window.addEventListener("pointerdown", () => { try { window.focus(); } catch (e) {} });

const gp = { prev: {}, axisCooldown: 0 };

// Resolve a button layout. Chromium/WebView2 reports DualShock 4 (USB *or*
// Bluetooth) as the "standard" mapping; some drivers expose the raw Sony HID
// layout instead, where the D-pad is a hat on axes[9] and Cross is button 1.
function padMap(pad) {
  const id = (pad.id || "").toLowerCase();
  const isSony = id.includes("054c") || id.includes("dualshock") ||
    id.includes("dualsense") || id.includes("wireless controller");
  if (pad.mapping === "standard") return { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, ps: 16, dpad: "buttons" };
  if (isSony) return { cross: 1, circle: 2, square: 0, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, ps: 12, dpad: "hat" };
  return { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, ps: 16, dpad: "buttons" };
}
// 8-way hat (axes[9]) → one of up/down/left/right (or null when centered)
function hatDir(v) {
  if (v == null || v > 1.1 || v < -1.1) return null;
  if (v <= -0.85 || v >= 0.95) return "up";        // up, up-left
  if (v > -0.85 && v < -0.5) return "up";           // up-right
  if (v >= -0.5 && v < -0.2) return "right";
  if (v >= -0.2 && v < 0.3) return "down";
  if (v >= 0.3 && v < 0.6) return "down";           // down-left
  if (v >= 0.6 && v < 0.95) return "left";
  return null;
}

let _hadPad = null;
// While the Internet Browser is up, LibreWolf is the foreground window and the
// webview's Gamepad API goes quiet, so the backend reads the controller
// natively and forwards every press as an "xmb-pad" event (and drives the
// pointer itself). Once that native feed is live, the webview's own gamepad
// reading is ignored for the rest of the browser session (no double input).
// After a game the backend asks whether the page is still running: it answers
// at once (one that doesn't answer has stopped during the game and is made
// anew, see focus.rs)
listen("game-exited", () => { call("page_alive").catch(() => {}); });

listen("xmb-pad", (p) => {
  if (!p) return;
  if (p.native) { xmb.nativePad = true; return; }
  if (p.exit) { if (xmb.browserActive) xmb.exitBrowser(); return; }
  if (p.screenshot) { xmb.screenshot(); return; }
  // the right stick, read natively while the browser is up: the on-screen keyboard moves
  if (p.rs) { if (xmb.browserActive && OnScreenKeyboard.active) OnScreenKeyboard.active.onRightStick(p.rs[0], p.rs[1]); return; }
  if (!p.a || !xmb.browserActive) return;
  if (p.rep && !OnScreenKeyboard.active) return;   // (held-button repeats: the on-screen keyboard only)
  // (kb: a keyboard key bound to that button, read while the browser had focus)
  Input.lastKind = p.kb ? "keyboard" : "controller";
  dispatch(p.a);
});
// PlayStation controllers read natively by the backend (DualShock 3 / 4,
// DualSense; hidpad.rs). Turned into a standard-layout gamepad so the code
// below treats it like any other; the motion sensors move the sparkles.
let hidPad = null, hidAt = 0;
const HB = { cross: 1 << 0, circle: 1 << 1, square: 1 << 2, triangle: 1 << 3, l1: 1 << 4, r1: 1 << 5, l2: 1 << 6, r2: 1 << 7,
  select: 1 << 8, start: 1 << 9, up: 1 << 10, down: 1 << 11, left: 1 << 12, right: 1 << 13, l3: 1 << 14, r3: 1 << 15, ps: 1 << 16 };
const motion = { x: 0, y: 0, base: null };
listen("xmb-hid", (s) => {
  if (!s) return;
  const b = (k) => !!(s.buttons & HB[k]);
  const order = ["cross", "circle", "square", "triangle", "l1", "r1", "l2", "r2", "select", "start", "l3", "r3", "up", "down", "left", "right", "ps"];
  hidPad = { id: "PlayStation controller (native)", mapping: "standard", native: true,
    buttons: order.map((k) => ({ pressed: b(k), value: k === "l2" ? Math.max(s.l2, b(k) ? 1 : 0) : k === "r2" ? Math.max(s.r2, b(k) ? 1 : 0) : (b(k) ? 1 : 0) })),
    axes: [s.lx, s.ly, s.rx, s.ry] };
  hidAt = performance.now();
  updateMotion(s);
});
// Sparkles follow the controller. Sideways: a sweep pushes them all along the
// wave, the quicker the sweep the harder (they glide on, wrap around the
// screen and slow down by themselves; see
// RealWave._motionShift). Up / down: they lean with the controller and ease
// back to the middle. A DualShock 3 (no pitch / yaw gyroscope) uses its
// accelerometer instead.
// Sparkle Motion: how far the sparkles drift with the controller, in % (fixed)
const SPARKLE_MOTION = 0.5;
function updateMotion(s) {

  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0.001, (now - (motion.at || now - 16)) / 1000));
  motion.at = now;
  // the strength the sparkles move with (always on, 0.5 %)
  const k = SPARKLE_MOTION / 100;
  let push = 0;   // added sideways speed (screen widths per second / 2)
  if (s.gyro) {
    const [pitch, yaw] = s.gyro;           // degrees per second
    const dz = (v) => (Math.abs(v) < 4 ? 0 : v);
    // how hard the sparkles are pushed grows faster than the turning speed:
    // a slow turn barely moves them, a quick flick sends them flying (a
    // 60° sweep in a third of a second at 5 % ≈ a screen and a half of glide)
    const yv = dz(yaw);
    push = -Math.sign(yv) * Math.pow(Math.abs(yv), 1.8) * dt * 0.0101 * k;
    motion.y += dz(pitch) * dt * 0.012 * k;
    motion.y *= 0.985;                     // eases back to the middle
  } else if (s.accel) {
    const [ax, ay, az] = s.accel;
    if (!motion.base) motion.base = [ax, ay, az];
    // the controller's own sideways speed (its acceleration added up, leaking
    // away so resting never drifts) is what pushes the sparkles
    motion.base[0] += (ax - motion.base[0]) * Math.min(1, dt * 0.5);
    motion.vx = ((motion.vx || 0) + (ax - motion.base[0]) * dt * 9.8) * Math.exp(-dt / 0.35);
    push = Math.abs(motion.vx) < 0.02 ? 0 : Math.sign(motion.vx) * Math.pow(Math.abs(motion.vx), 1.8) * dt * 60 * k;
    motion.y = (az - motion.base[2]) * 0.6 * k;
  }
  motion.y = Math.max(-0.4, Math.min(0.4, motion.y));
  if (xmb.wave) {
    if (push && xmb.wave.addMotionImpulse) xmb.wave.addMotionImpulse(push);
    if (xmb.wave.setMotion) xmb.wave.setMotion(1, motion.y);   // (x: not a reset)
  }
}
function pollGamepad() {
  // game mode: the controller belongs to the game, nothing is read
  if (document.body.classList.contains("in-game")) { setTimeout(pollGamepad, 500); return; }
  try { readGamepad(); } catch (e) { console.error("gamepad", e); }
  // always re-arm, even after an error; a page that's hidden (covered by
  // another window that just closed) gets no animation frames, so a timer
  // keeps the controller read until it shows again
  if (document.hidden) setTimeout(pollGamepad, 50); else requestAnimationFrame(pollGamepad);
}
function readGamepad() {
  const all = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  const hidLive = hidPad && performance.now() - hidAt < 300;
  // the native reading wins; the same controller seen by the webview is skipped
  const sonyId = (p) => /054c|dualshock|dualsense|wireless controller|playstation/i.test(p.id || "");
  const pad = hidLive ? hidPad : all.find((p) => !(hidPad && sonyId(p))) || all[0];
  // Track controller presence: in fullscreen, the cursor is allowed inside a
  // submenu/form only when NO controller is connected (CSS uses body.has-pad).
  const anyPad = !!pad;
  if (anyPad !== _hadPad) { _hadPad = anyPad; document.body.classList.toggle("has-pad", anyPad); }
  if (!xmb.browserActive) xmb.nativePad = false;
  if (pad) {
    const map = padMap(pad);
    const press = (i) => pad.buttons[i] && pad.buttons[i].pressed;
    // the intro playing: any button newly pressed skips it (as any key or a
    // click does; a button already held when it started doesn't)
    { const any = pad.buttons.some((b) => b && b.pressed);
      if (any && !gp.anyPrev && window.__introSkip) { Input.lastKind = "controller"; window.__introSkip(); }
      gp.anyPrev = any; }
    // native feed active: just keep the edge state current, act on nothing
    if (xmb.browserActive && xmb.nativePad) {
      for (const n of ["cross", "circle", "triangle", "square", "select", "start", "l1", "r1", "l2", "r2", "l3", "r3"]) gp.prev[n] = press(map[n]);
      gp.dir = null; gp.circAt = 0;
      return;
    }
    const gpd = (a) => { Input.lastKind = "controller"; dispatch(a); };
    Input.held.l2 = !!press(map.l2) || !!kbHeld.l2;
    Input.held.r2 = !!press(map.r2) || !!kbHeld.r2;
    Input.held.enter = !!press(map.cross) || !!kbHeld.enter;
    const edge = (i, n) => { const p = press(i), w = gp.prev[n]; gp.prev[n] = p; return p && !w; };
    // Fallback while the browser is up and there's no native feed: the left
    // stick drives the mouse, Cross presses / grabs, the right stick scrolls.
    const brLive = xmb.browserActive && xmb.browserLive;
    if (xmb.browserActive) {
      const ry = (pad.axes[3] != null ? pad.axes[3] : (pad.axes[5] || 0)) || 0;
      xmb.browserStick(pad.axes[0] || 0, pad.axes[1] || 0, ry, press(map.cross));
    }
    // Custom Color: the right stick moves around the colour wheel
    if (ColorPicker.active) {
      const rx = pad.axes[2] || 0, ry = (pad.axes[3] != null ? pad.axes[3] : (pad.axes[5] || 0)) || 0;
      ColorPicker.active.onStick(rx, ry);
    }
    // Directional input (d-pad buttons, d-pad hat, or the left stick) all share
    // one press-and-hold auto-repeat: fire once immediately, then after a short
    // initial delay keep firing at a steady interval until released.
    let dir = null;
    if (map.dpad === "buttons") {
      if (press(12)) dir = "up"; else if (press(13)) dir = "down";
      else if (press(14)) dir = "left"; else if (press(15)) dir = "right";
    } else {
      dir = hatDir(pad.axes[9]);
    }
    // the sticks' raw positions, for screens that use them directly (the Photo
    // Viewer pans with the left stick and zooms with the right one)
    Input.sticks = { lx: pad.axes[0] || 0, ly: pad.axes[1] || 0, rx: pad.axes[2] || 0,
      ry: (pad.axes[3] != null ? pad.axes[3] : (pad.axes[5] || 0)) || 0, at: performance.now() };
    if (brLive) dir = null;   // (the browser's buttons are handled below)
    if (!dir && !brLive && !(xmb.overlay && xmb.overlay.rawLeftStick)) {
      const dz = settings.input?.deadzone ?? 0.5;
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (ay < -dz) dir = "up"; else if (ay > dz) dir = "down";
      else if (ax < -dz) dir = "left"; else if (ax > dz) dir = "right";
    }
    for (const k of ["up", "down", "left", "right"]) Input.held[k] = dir === k || !!kbHeld[k];
    const tnow = performance.now();
    if (dir) {
      if (dir !== gp.dir) { gp.dir = dir; window.__inputRepeat = false; gpd(dir); gp.dirNext = tnow + holdPace(dir)[0]; }   // initial delay
      else if (tnow >= gp.dirNext) { const every = holdPace(dir)[1]; window.__inputRepeat = true; gpd(dir); window.__inputRepeat = false; gp.dirNext = Math.max(gp.dirNext + every, tnow - every); }        // repeat rate
    } else { gp.dir = null; gp.dirNext = 0; }
    // Change Keybinds: SELECT + R2 restores the default keys
    if (Keybinds.resetHook) {
      const rc = press(map.select) && press(map.r2);
      if (rc && !gp.resetCombo) { gp.resetCombo = true; Keybinds.resetHook(); }
      if (!press(map.select) && !press(map.r2)) gp.resetCombo = false;
      if (gp.resetCombo) { gp.prev.select = !!press(map.select); gp.prev.r2 = !!press(map.r2); }
    }
    // Screenshots: click R3. (Not while a Windows file picker is up: the
    // backend reads the controller then.)
    if (edge(map.r3, "r3") && !Input.picking) xmb.screenshot();
    // a screen that wants it (the on-screen keyboard): the right stick moves it
    if (OnScreenKeyboard.active) {
      OnScreenKeyboard.active.onRightStick(pad.axes[2] || 0, (pad.axes[3] != null ? pad.axes[3] : (pad.axes[5] || 0)) || 0);
    }
    // held buttons repeat on screens that want it (the on-screen keyboard:
    // holding □ keeps deleting, ✕ keeps typing…): once, then after a moment
    // over and over until let go
    const rep = !!OnScreenKeyboard.active;
    const fire = (i, n, a) => {
      if (edge(i, n)) { gpd(a); gp.rep = gp.rep || {}; gp.rep[n] = tnow + 420; return; }
      // (a slow frame doesn't slow the repeats down: the ones it missed are
      // made up, a few at most)
      if (rep && gp.prev[n] && gp.rep && gp.rep[n] && tnow >= gp.rep[n]) {
        for (let k = 0; k < 4 && tnow >= gp.rep[n]; k++) { gpd(a); gp.rep[n] += 75; }
        if (tnow >= gp.rep[n]) gp.rep[n] = tnow + 75;
      }
    };
    // the browser page (no native feed): ○ tap closes the window, held exits
    if (brLive) {
      const cDown = !!press(map.circle), cWas = gp.prev.circle;
      gp.prev.circle = cDown;
      if (cDown && !cWas) { gp.circAt = tnow; gp.circUsed = false; }
      if (cDown && gp.circAt && !gp.circUsed && tnow - gp.circAt >= 600) { gp.circUsed = true; xmb.exitBrowser(); }
      if (!cDown && gp.circAt) { if (!gp.circUsed) xmb.browserButton("back"); gp.circAt = 0; }
      for (const n of ["start", "l1", "r1", "l2", "r2", "l3"]) if (edge(map[n], n)) xmb.browserButton(n);
      for (const n of ["cross", "triangle", "square", "select"]) gp.prev[n] = press(map[n]);
      return;
    }
    gp.circAt = 0;
    // SELECT (SELECT + R2 above is neither)
    const selDown = !!press(map.select);
    if (selDown && !gp.prev.select && !gp.resetCombo) gpd("select");
    gp.prev.select = selDown;
    fire(map.cross, "cross", "enter");
    if (edge(map.circle, "circle")) gpd("back");
    fire(map.triangle, "triangle", "options");
    fire(map.square, "square", "square");
    if (edge(map.start, "start")) gpd("start");
    fire(map.l1, "l1", "l1");
    fire(map.r1, "r1", "r1");
    if (edge(map.l2, "l2")) gpd("l2");
    if (edge(map.r2, "r2")) gpd("r2");
    if (edge(map.l3, "l3")) gpd("l3");
  }
}
requestAnimationFrame(pollGamepad);

// --------------------------------------------------------------------- boot
async function boot() {
  // (the page starts with these already on (index.html), so nothing else
  // shows for a moment before the black screen with its loading clock)
  document.body.classList.add("booting");   // hide the clock box during the intro
  // the black screen before the intro: the loading clock turns at the top
  // right meanwhile (gone just before the intro starts)
  document.body.classList.add("clock-loading", "boot-loading");
  try { infobox.startSpin(); } catch (e) {}
  const endBootClock = () => {
    if (!document.body.classList.contains("boot-loading")) return;
    document.body.classList.remove("clock-loading", "boot-loading");
    try { infobox.stopSpin(); } catch (e) {}
  };
  // logged out (Users > Log Out): straight back to the user selection, no intro
  // and no Automatic Login
  let loggedOut = false;
  try { loggedOut = sessionStorage.getItem("xmbLogOut") === "1"; sessionStorage.removeItem("xmbLogOut"); } catch (e) {}
  // (the window made anew after a game -- Windows ended its page meanwhile --: back as from any
  // game, with no startup sound or intro, the same user signed in on the game played; focus.rs)
  let resume = null;
  try { resume = await call("resume_after_game"); } catch (e) {}
  if (resume) logLine("info", "the window made anew after the game: back on the game, with no startup");
  const introOn = !loggedOut && !resume && settings.behavior?.bootAnimation !== false;
  const t0 = performance.now();
  // Console Startup Sound (System Settings, On by default): the screen stays
  // black with the sound playing while the first menu is made (at least 3 s);
  // then it drops to the Buffering Sound Volume as the intro starts, and at
  // the end of the intro's sound it fades out (or, with the Buffering Sound
  // on, stays at that volume and carries on as that loop)
  let su = null;
  audio._bufOn = settings.behavior?.bufferingSound === true;
  audio.bufVol = Math.max(0, Math.min(1, (settings.behavior?.bufferingVolume ?? 15) / 100));   // (decides how the startup sound ends)
  // (with the intro off, the startup sound still plays: the same black screen
  // and the same drop, and the menu comes in the moment the intro would)
  if (!loggedOut && !resume && settings.behavior?.startupSound !== false) {
    su = await Promise.race([audio.startupSound(0.85), new Promise((r) => setTimeout(() => r(null), 2500))]);
    // (still loading after 2.5 s, as on a first start: it's left out this time;
    // started late it would play on at full volume with nothing to end it)
    if (!su) audio.cancelStartup();
  }
  // the first menu (the user selection, or Automatic Login's What's New) is
  // made now, hidden behind the black screen; no sound or music meanwhile
  document.body.classList.add("intro-hold");
  audio.hold = true;
  try {
    await Promise.race([appIconsReady, new Promise((r) => setTimeout(r, 4000))]);
    await xmb.start(manifest, { noAutoLogin: loggedOut, resume });
  } catch (e) { console.error(e); }
  if (su) {
    // (at least 3 s of the sound alone; this part can't be skipped)
    const left = 2500 - su.elapsed() * 1000;   // (the drop at 2.5 s, the intro at 3 s)
    if (left > 0) await new Promise((res) => setTimeout(res, left));
    // down to the Buffering Sound Volume (15 % unless changed), reached 0.1 s before the intro's sound starts
    su.half();
    await new Promise((r) => setTimeout(r, 500));
  }
  endBootClock();
  await playIntro(audio, {
    enabled: introOn,
    bootSound: settings.behavior?.bootSound || "coldboot",
    icon: keepLook && settings.behavior?.introIcon ? assetUrl(settings.behavior.introIcon) : null,
    title: keepLook && settings.behavior?.introTitle ? assetUrl(settings.behavior.introTitle) : null,
    onSound: (sec) => su && su.fadeOutIn(sec, 3),
    // skipped: the startup sound lowers quickly to nothing (to 15 % with the
    // Buffering Sound on, and carries on as its loop)
    onSkip: () => su && su.fadeOutIn(0.6, 0.6),
  });
  // intro off: the startup sound ends just as it would have with the intro
  // (at the end of where the intro's sound would be, fading over 3 s; or on at
  // the Buffering Sound's volume as its loop)
  if (su && !introOn) {
    const bs = settings.behavior?.bootSound || "coldboot";
    await Promise.race([audio.ready(bs), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
    const b = (audio.themeBuffers || {})[bs] || audio.buffers[bs];
    su.fadeOutIn(b ? b.duration : 10, 3);
  }
  // (skipped before its sound: the startup sound ends now)
  if (su) su.fadeOutIn(0.8, 0.8);
  document.body.classList.remove("booting", "intro-hold");
  audio.release();
  // (the System can't save in its own folder: said once, at the start)
  try { const w = await call("content_writable"); if (w && w.ok === false) xmb.warnNotWritable(w.dir); } catch (e) {}
  // Buffering Sound (System Settings, Off by default): the loop plays all the time
  audio.setBuffering((xmb.settings?.behavior?.bufferingSound ?? settings.behavior?.bufferingSound) === true);
}
boot();
