// The trophy pop-up's contents ("You have earned a trophy." / a menu
// notification): shared by the menus (trophies.js) and the pop-up's own
// window during a game (popup.js).
import { assetUrl } from "./api.js";

const GRADE = { B: "bronze", S: "silver", G: "gold", P: "platinum" };
export const gradeIcon = (g) => `./assets/icons/trophy/trophy128_tex_grade_${GRADE[g] || "bronze"}.png`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// (a name wraps only at its spaces, as the console's: "-INTERNATIONAL-" stays whole)
const words = (s) => String(s ?? "").split(/(\s+)/).map((w) => /^\s*$/.test(w) ? esc(w) : `<span class="tpop-word">${esc(w)}</span>`).join("");

export function popHTML(p) {
  if (p.kind === "trophy") {
    const icon = p.autoPlat ? gradeIcon("P") : p.icon ? assetUrl(p.icon) : gradeIcon(p.grade);
    return `<div class="tpop-icon"><img src="${icon}" alt=""></div><div class="tpop-text"><div class="tpop-l1">You have earned a trophy.</div>`
      + `<div class="tpop-l2"><img class="tpop-glyph" src="${gradeIcon(p.grade)}" alt=""><span class="tpop-name">${words(p.name)}</span></div></div>`;
  }
  // a notification: the "i", or the "!" when something didn't go as expected
  return `<img class="tpop-ntc" src="./assets/icons/system/tex_${p.note === "error" ? "error" : "info"}.png" alt=""><div class="tpop-text tpop-one">${esc(p.text)}</div>`;
}

// A trophy's name longer than "You have earned a trophy." (with its grade glyph): the box
// made wider (the console's, trophies.css .tpop-long), the name's words going on to the right
// until the next one doesn't fit before its end, then on the next line; two lines of the name
// or more (.tpop-multi): two lines in the console's 102 height, as BUZZ!'s; three or more, as
// tall as its lines and the space STAR OCEAN's has under them
// (the name's line as wide as the first line's this many times: BUZZ!'s second line fits,
// STAR OCEAN's "THE LAST HOPE®" doesn't, as on the console)
const LONG_LINE = 1.345;
// (under the last line's letters -- their font's own height, not counting the line's
// spacing -- in pixels of 1080 lines: two lines of the name (the 102 box as it is: only a bigger
// Text Size makes it taller), three or more)
const UNDER = { two: 7.6, more: 10.7 };
export function popFit(el) {
  el.classList.remove("tpop-long", "tpop-multi");
  el.querySelectorAll(".tpop-cut").forEach((w) => w.classList.remove("tpop-cut"));
  el.style.removeProperty("height"); el.style.removeProperty("--tl");
  const l1 = el.querySelector(".tpop-l1"), l2 = el.querySelector(".tpop-l2");
  if (!l1 || !l2 || el.classList.contains("tpop-plain")) return;
  const n = l2.querySelector(".tpop-name"), text = el.querySelector(".tpop-text");
  if (!n || !text) return;
  const r = document.createRange();
  // (both lines' own widths, unwrapped)
  text.style.width = "max-content"; l2.style.whiteSpace = "nowrap";
  r.selectNodeContents(l1); const w1 = r.getBoundingClientRect().width;
  r.selectNodeContents(l2); const w2 = r.getBoundingClientRect().width;
  text.style.removeProperty("width"); l2.style.removeProperty("white-space");
  if (!w1 || w2 <= w1 + 0.5) return;
  el.classList.add("tpop-long");
  const tu = el.getBoundingClientRect().width / 535;
  // (never past the box's end: 535 less the text's start, 108, and a little room)
  const tl = Math.min(w1 * LONG_LINE, 419 * tu);
  el.style.setProperty("--tl", `${tl}px`);
  // (a word longer than a whole line: cut where the line ends)
  for (const wd of n.querySelectorAll(".tpop-word")) if (wd.getBoundingClientRect().width > tl) wd.classList.add("tpop-cut");
  r.selectNodeContents(n);
  const lh = parseFloat(getComputedStyle(l2).lineHeight) || 29 * tu;
  const lines = new Set([...r.getClientRects()].map((b) => Math.round(b.top / Math.max(1, lh / 2)))).size;
  if (lines < 2) return;
  el.classList.add("tpop-multi");
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pop-scale")) || 1;
  const bottom = Math.max(...[...r.getClientRects()].map((b) => b.bottom));
  const under = (lines === 2 ? UNDER.two : UNDER.more) * tu * scale;
  el.style.height = `${Math.max(102 * tu, bottom - el.getBoundingClientRect().top + under)}px`;
}

// shown with a quick fade in (already showing: its contents change, no new fade);
// hidden with a quick fade out (trophies.css .tpop.on / .off)
export function popIn(el) {
  if (el.classList.contains("on")) return;
  el.classList.remove("off"); void el.offsetWidth; el.classList.add("on");
}
export function popOut(el) {
  if (!el.classList.contains("on")) return;
  el.classList.remove("on"); el.classList.add("off");
}
