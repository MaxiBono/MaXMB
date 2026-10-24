// Keyboard / mouse bindings for every PlayStation-button action.
//
// Each action has two slots; a slot holds a KeyboardEvent.code ("Enter",
// "KeyT", "F12"…) or a mouse button ("Mouse1" middle, "Mouse3" back,
// "Mouse4" forward). Saved in settings.input.keybinds; "Default" restores the
// table below. The screenshot action also has fixed controller buttons
// (click R3).

export const ACTIONS = [
  { id: "up", label: "Up", pad: "D-pad Up" },
  { id: "down", label: "Down", pad: "D-pad Down" },
  { id: "left", label: "Left", pad: "D-pad Left" },
  { id: "right", label: "Right", pad: "D-pad Right" },
  { id: "ls_up", label: "Left Stick Up", pad: "Left Stick Up" },
  { id: "ls_down", label: "Left Stick Down", pad: "Left Stick Down" },
  { id: "ls_left", label: "Left Stick Left", pad: "Left Stick Left" },
  { id: "ls_right", label: "Left Stick Right", pad: "Left Stick Right" },
  { id: "enter", label: "Enter", pad: "✕ Cross" },
  { id: "back", label: "Back", pad: "○ Circle" },
  { id: "options", label: "Options", pad: "△ Triangle" },
  { id: "square", label: "Square", pad: "□ Square" },
  { id: "select", label: "Select", pad: "SELECT" },
  { id: "start", label: "Start", pad: "START" },
  { id: "l1", label: "L1", pad: "L1" },
  { id: "r1", label: "R1", pad: "R1" },
  { id: "l2", label: "L2", pad: "L2" },
  { id: "r2", label: "R2", pad: "R2" },
  { id: "l3", label: "L3", pad: "L3" },
  { id: "r3", label: "R3", pad: "R3" },
  { id: "screenshot", label: "Screenshot", pad: "R3" },
  { id: "hud", label: "Hide HUD", pad: "\u2014" },
  { id: "brnexttab", label: "Browser: Next Tab", pad: "R2" },
  { id: "quit", label: "Close System", pad: "\u2014" },
];

export const DEFAULT_BINDS = {
  up: ["ArrowUp", ""], down: ["ArrowDown", ""], left: ["ArrowLeft", ""], right: ["ArrowRight", ""],
  ls_up: ["KeyW", ""], ls_down: ["KeyS", ""], ls_left: ["KeyA", ""], ls_right: ["KeyD", ""],
  enter: ["Enter", ""], back: ["Escape", ""], options: ["KeyT", ""], square: ["KeyR", ""],
  select: ["KeyC", ""], start: ["Space", ""], l1: ["KeyQ", ""], r1: ["KeyE", ""], l2: ["Digit1", ""], r2: ["Digit3", ""],
  l3: ["KeyF", ""], r3: ["KeyG", ""],
  screenshot: ["F12", ""],
  // hides everything but the background (press again to bring it back)
  hud: ["F10", ""],
  // the Internet Browser: the next tab (left to right, then around)
  brnexttab: ["Tab", ""],
  // closes the app at once (a safeguard if it slows down or gets stuck)
  quit: ["F4", ""],
};

export const Keybinds = {
  map: clone(DEFAULT_BINDS),
  load(saved) {
    this.map = clone(DEFAULT_BINDS);
    if (saved && typeof saved === "object") {
      for (const a of ACTIONS) {
        const v = saved[a.id];
        if (Array.isArray(v)) this.map[a.id] = [String(v[0] || ""), String(v[1] || "")];
      }
      // keys saved before the new defaults: a key still on its old default
      // takes the new one (keys you changed yourself stay)
      if (!saved._v2) {
        for (const [id, old] of Object.entries(OLD_DEFAULTS)) {
          const v = saved[id];
          if (Array.isArray(v) && String(v[0] || "") === old[0] && String(v[1] || "") === old[1]) this.map[id] = [...DEFAULT_BINDS[id]];
        }
        // (a new or moved default that's already one of your own keys is left empty)
        const fresh = ACTIONS.filter((a) => !Array.isArray(saved[a.id]) || (a.id in OLD_DEFAULTS && this.map[a.id][0] === DEFAULT_BINDS[a.id][0]));
        const freshIds = new Set(fresh.map((a) => a.id));
        for (const a of fresh) this.map[a.id] = this.map[a.id].map((c) => c && ACTIONS.some((b) => !freshIds.has(b.id) && this.map[b.id].includes(c)) ? "" : c);
      } else {
        // Square's default moved from Backspace to R: kept on the old default →
        // the new one (if R isn't already one of your keys)
        if (!saved._v3 && Array.isArray(saved.square) && saved.square[0] === "Backspace" && !saved.square[1]
            && !ACTIONS.some((a) => a.id !== "square" && (this.map[a.id] || []).includes("KeyR"))) this.map.square = ["KeyR", ""];
        // actions added since the keys were saved: their default key is left
        // empty if it's already one of yours
        const fresh = ACTIONS.filter((a) => !Array.isArray(saved[a.id]));
        const freshIds = new Set(fresh.map((a) => a.id));
        for (const a of fresh) this.map[a.id] = this.map[a.id].map((c) => c && ACTIONS.some((b) => !freshIds.has(b.id) && this.map[b.id].includes(c)) ? "" : c);
      }
    }
  },
  // action bound to this code (keyboard code or "MouseN"), or null
  actionFor(code) {
    if (!code) return null;
    for (const a of ACTIONS) if (this.map[a.id].includes(code)) return a.id;
    return null;
  },
  codesFor(action) { return (this.map[action] || []).filter(Boolean); },
};

// (the defaults before October 2026, for the one-time move to the new ones)
const OLD_DEFAULTS = { back: ["Escape", "Backspace"], square: ["KeyV", ""], select: ["KeyG", ""], start: ["KeyF", ""],
  l2: ["KeyA", ""], r2: ["KeyD", ""] };
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// readable name of a binding
export function keyLabel(code) {
  if (!code) return "—";
  const m = /^Mouse(\d)$/.exec(code);
  if (m) return ["Left Click", "Middle Click", "Right Click", "Mouse Back", "Mouse Forward"][+m[1]] || `Mouse ${m[1]}`;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return "Num " + code.slice(6);
  const names = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Backspace: "Backspace",
    Enter: "Enter", Space: "Space", Tab: "Tab", ShiftLeft: "Left Shift", ShiftRight: "Right Shift",
    ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl", AltLeft: "Left Alt", AltRight: "Right Alt",
    PageUp: "Page Up", PageDown: "Page Down", PrintScreen: "Print Screen", ScrollLock: "Scroll Lock",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Backquote: "`",
    Backslash: "\\", Comma: ",", Period: ".", Slash: "/" };
  return names[code] || code;
}

// Windows virtual-key code for a KeyboardEvent.code (used while the browser
// window has focus, where the app reads the key directly). 0 = unsupported.
export function codeToVk(code) {
  if (!code) return 0;
  let m;
  if ((m = /^F(\d+)$/.exec(code))) return 0x6f + +m[1];
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1].charCodeAt(0);
  if ((m = /^Digit(\d)$/.exec(code))) return 0x30 + +m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 0x60 + +m[1];
  const t = { PrintScreen: 0x2c, Insert: 0x2d, Delete: 0x2e, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
    Pause: 0x13, ScrollLock: 0x91, Space: 0x20, Tab: 0x09, Enter: 0x0d, Backspace: 0x08,
    ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28 };
  return t[code] || 0;
}
