// The PlayStation button symbols (✕ ○ □ △) shown as the console's own white
// outline pictures (assets/icons/system/glyph_*.png) instead of text
// characters: in the button hints of the menus' footers, and wherever a
// description or hint names a button ("Press ✕ to…"). Anything rendered later
// is converted as it appears. (Text you type, song names and the on-screen
// keyboard's own symbols are left as they are.)

const MAP = { "✕": "cross", "○": "circle", "□": "square", "△": "triangle" };
const RE = /[✕○□△]/;
const RE_G = /[✕○□△]/g;
// a span that is just the symbol (the footers' hints)
const GLYPH_EL = ".cf-glyph, .us-glyph, .ps-glyph, .af-g";
// text that may name a button somewhere in it
const TEXT_IN = ".d-sub:not(.il-usub), .d-desc, .pc-hint, .kb-mouse, .kb-pad, .shot-toast, .gi2-foot, .vp-dlg-foot, .pv-crop-foot";
const SKIP = "input, textarea, [contenteditable], #osk-layer";

function glyphEl(el) {
  const t = (el.textContent || "").trim();
  if (el.classList.contains("gl")) { if (!t) return; el.classList.remove("gl", "gl-cross", "gl-circle", "gl-square", "gl-triangle"); }
  const k = MAP[t];
  if (!k) return;
  el.textContent = "";
  el.classList.add("gl", `gl-${k}`);
}
function textIn(el) {
  if (el.closest(SKIP)) return;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (RE.test(n.nodeValue) && !n.parentElement.closest(GLYPH_EL)) nodes.push(n);
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0; const s = n.nodeValue;
    s.replace(RE_G, (ch, i) => {
      if (i > last) frag.append(s.slice(last, i));
      const g = document.createElement("span"); g.className = `gl gl-${MAP[ch]}`; frag.append(g);
      last = i + 1;
    });
    if (last < s.length) frag.append(s.slice(last));
    n.replaceWith(frag);
  }
}
function scan(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches(GLYPH_EL)) glyphEl(root);
  root.querySelectorAll(GLYPH_EL).forEach(glyphEl);
  const t = root.closest(TEXT_IN);
  if (t) textIn(t);
  else root.querySelectorAll(TEXT_IN).forEach(textIn);
}

export function startGlyphs() {
  scan(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") { const p = m.target.parentElement; if (p && RE.test(m.target.nodeValue)) scan(p); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) scan(n);
        else if (n.nodeType === 3 && RE.test(n.nodeValue) && n.parentElement) scan(n.parentElement);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
