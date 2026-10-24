// D-pad paths through the media players' △ panels (Music Player, Photo Viewer,
// Slideshow, Video Player), from the console's paths:
//  • left / right go round the row (past the last icon back to the first);
//  • up / down follow the panel's own links (LINKS[id].up / .down):
//    1. back to the icon the cursor came from, if it is one of the choices
//       (Previous → up → Volume Control → down → Previous again);
//    2. an icon with two choices takes the one on the side opposite to where
//       the cursor came into it from (Fast Forward reached from Play goes
//       down to Repeat, reached from Fast Reverse down to Shuffle);
//    3. otherwise the choice nearest to it on screen.
export class PadNav {
  // rows: [[{ id }]], links: { id: { up: [ids], down: [ids] } }
  constructor(rows, links) { this.rows = rows; this.links = links; this.reset(); }
  reset() { this.came = null; this.origin = null; }
  _pos(id) {
    for (let r = 0; r < this.rows.length; r++) { const c = this.rows[r].findIndex((b) => b.id === id); if (c >= 0) return [r, c]; }
    return null;
  }
  // a: "left" | "right" | "up" | "down"; xOf(r, c) = the icon's centre on screen.
  // Returns [r, c] or null (no move).
  move(a, fr, fc, xOf) {
    const row = this.rows[fr] || [], cur = row[fc];
    if (!cur) return null;
    if (a === "left" || a === "right") {
      if (row.length < 2) return null;
      const c = (fc + (a === "right" ? 1 : -1) + row.length) % row.length;
      this.came = a === "right" ? "left" : "right"; this.origin = null;
      return [fr, c];
    }
    const targets = ((this.links[cur.id] || {})[a] || []).filter((id) => this._pos(id));
    if (!targets.length) return null;
    let pick = null;
    if (this.origin && targets.includes(this.origin)) pick = this.origin;
    else if (targets.length === 2 && this.came) pick = this.came === "left" ? targets[1] : targets[0];
    else if (targets.length === 1 || !xOf) pick = targets[0];
    else {
      const x = xOf(fr, fc); let bd = Infinity;
      for (const id of targets) { const [r, c] = this._pos(id); const d = Math.abs(xOf(r, c) - x); if (d < bd - 0.5) { bd = d; pick = id; } }
    }
    this.origin = cur.id; this.came = null;
    return this._pos(pick);
  }
}

// an icon's centre on screen (for the nearest choice): its button with data-r / data-c
export function nodeX(nodes, r, c) {
  const n = (nodes || []).find((x) => +x.dataset.r === r && +x.dataset.c === c);
  if (!n) return 0; const b = n.getBoundingClientRect(); return b.left + b.width / 2;
}

const all = (ids, to) => Object.fromEntries(ids.map((id) => [id, to]));
const merge = (...ls) => {
  const out = {};
  for (const l of ls) for (const [id, v] of Object.entries(l)) out[id] = { ...(out[id] || {}), ...v };
  return out;
};
const down = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { down: v }]));
const up = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { up: v }]));

// Music Player: Volume Control · Visual Player · Add to Playlist · Delete · Display /
// Previous · Next · Fast Reverse · Fast Forward · Play · Pause · Stop / Repeat · Shuffle
export const MUSIC_LINKS = merge(
  down({ vol: ["prev", "next"], visual: ["frev"], addpl: ["ffwd"], del: ["play"], display: ["pause", "stop"],
    prev: ["repeat"], next: ["repeat"], frev: ["repeat"], ffwd: ["repeat", "shuffle"],
    play: ["shuffle"], pause: ["shuffle"], stop: ["shuffle"] }),
  up({ prev: ["vol"], next: ["vol"], frev: ["visual"], ffwd: ["addpl"], play: ["del"], pause: ["display"], stop: ["display"],
    repeat: ["prev", "next", "frev", "ffwd"], shuffle: ["ffwd", "play", "pause", "stop"] }),
);

// Photo Viewer: the top row and the middle row column by column; the bottom row
// (Previous · Next · Slideshow) as in the console's paths
const PV_TOP = ["dmode", "effect", "trim", "playlist", "print", "wall", "del", "display"];
const PV_MID = ["zin", "zout", "rotl", "rotr", "up", "down", "left", "right"];
export const PHOTO_LINKS = merge(
  down(Object.fromEntries(PV_TOP.map((id, i) => [id, [PV_MID[i]]]))),
  up(Object.fromEntries(PV_MID.map((id, i) => [id, [PV_TOP[i]]]))),
  down({ ...all(["zin", "zout", "rotl", "rotr"], ["prev"]), up: ["next"], ...all(["down", "left", "right"], ["slide"]) }),
  up({ prev: ["rotl"], next: ["rotr"], slide: ["up"] }),
);

// Slideshow: Slideshow Style · Slideshow Speed / Previous · Next · Play · Pause · Stop / Repeat
export const SLIDESHOW_LINKS = merge(
  down({ ssstyle: ["play"], ssspeed: ["play"], ...all(["prev", "next", "play", "pause", "stop"], ["repeat"]) }),
  up({ ...all(["prev", "next", "play"], ["ssstyle"]), ...all(["pause", "stop"], ["ssspeed"]), repeat: ["play"] }),
);

// Video Player: the top row sits between the middle row's icons, so most icons
// have two choices (left / right) up or down
const VP_TOP = ["scene", "goto", "audio", "subs", "vol", "av", "screen", "icon", "del", "display"];
const VP_MID = ["begin", "next", "frev", "ffwd", "play", "pause", "stop", "ireplay", "iadv", "slowrev", "slowfwd", "framerev", "frameadv"];
export const VIDEO_LINKS = merge(
  down({ scene: ["begin", "next", "frev"], goto: ["ffwd"], audio: ["ffwd", "play"], subs: ["play", "pause"],
    vol: ["pause", "stop"], av: ["stop", "ireplay"], screen: ["ireplay", "iadv"], icon: ["iadv", "slowrev"],
    del: ["slowrev", "slowfwd"], display: ["slowfwd", "framerev", "frameadv"] }),
  up({ begin: ["scene"], next: ["scene"], frev: ["scene"], ffwd: ["goto", "audio"], play: ["audio", "subs"],
    pause: ["subs", "vol"], stop: ["vol", "av"], ireplay: ["av", "screen"], iadv: ["screen", "icon"],
    slowrev: ["icon", "del"], slowfwd: ["del", "display"], framerev: ["display"], frameadv: ["display"] }),
  down(all(VP_MID, ["repeat"])),
  up({ repeat: VP_MID }),
);
