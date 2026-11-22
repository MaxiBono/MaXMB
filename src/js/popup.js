// The trophy pop-up's own window, shown over a game (trophypop.rs): the
// same box as the menus' (trophies.js), with the trophy sound.
import { popFit, popHTML, popIn, popOut } from "./tpop.js";

const T = window.__TAURI__;
const box = document.querySelector(".tpop");
let snd = null, t = 0;
// (the sound read and decoded as the window loads, not at the first trophy: the game is running
// by then and the window, hidden until a pop-up, may be given little time)
async function loadSound() {
  if (snd) return snd;
  const ctx = new AudioContext();
  const buf = await (await fetch("./assets/sounds/snd_trophy.wav")).arrayBuffer();
  snd = { ctx, buf: await ctx.decodeAudioData(buf) };
  return snd;
}
async function sound() {
  try {
    const s = await loadSound();
    // (a sound context the hidden window left waiting: started again first)
    if (s.ctx.state !== "running") await s.ctx.resume().catch(() => {});
    const src = s.ctx.createBufferSource(); src.buffer = s.buf; src.connect(s.ctx.destination); src.start();
  } catch (e) { T?.event?.emit?.("trophy-pop-note", "the trophy sound couldn't be played: " + String(e && e.message || e)).catch?.(() => {}); }
}
loadSound().catch(() => {});
// the menus' Font, Text Size, Text Color and a PS3 theme's notification picture
let fontSet = "";
function style(st) {
  const root = document.documentElement;
  if (!st) return;
  if (st.color) root.style.setProperty("--ptext", st.color); else root.style.removeProperty("--ptext");
  root.style.setProperty("--pop-scale", String(st.scale || 1));
  if (st.font !== fontSet) {
    fontSet = st.font || "";
    let el = document.getElementById("user-font");
    if (!el) { el = document.createElement("style"); el.id = "user-font"; document.head.appendChild(el); }
    el.textContent = fontSet ? `@font-face { font-family: "XmbUserFont"; src: url("${T.core.convertFileSrc(fontSet)}"); }` : "";
    document.body.style.fontFamily = fontSet ? `"XmbUserFont", "Rodin", "Segoe UI", system-ui, sans-serif` : "";
  }
  if (st.tnotify) { root.style.setProperty("--tnotify", st.tnotify); box.classList.add("tnot"); }
  else { root.style.removeProperty("--tnotify"); box.classList.remove("tnot"); }
}
function pop(p) {
  clearTimeout(t);
  style(p.style);
  // (a new pop-up: from hidden, so it fades in)
  box.classList.remove("on", "off");
  box.innerHTML = popHTML(p); popFit(box); document.fonts?.ready.then(() => popFit(box));
  let shown = false;
  const show = () => { if (shown) return; shown = true; popIn(box); if (p.kind === "trophy") sound();
    T?.event?.emit?.("trophy-pop-shown", String(p.name || p.text || "")).catch?.(() => {}); };
  const img = box.querySelector(".tpop-icon img");
  // (a trophy's own picture that can't be read: its grade's picture instead, never an empty box)
  const fallback = () => { if (img && p.kind === "trophy" && !img.dataset.fb) { img.dataset.fb = "1"; img.src = `./assets/icons/trophy/trophy128_tex_grade_${{ B: "bronze", S: "silver", G: "gold", P: "platinum" }[p.grade] || "bronze"}.png`;
    T?.event?.emit?.("trophy-pop-note", "a trophy's picture couldn't be shown: " + String(p.icon || "")).catch?.(() => {}); } };
  if (img) img.addEventListener("error", fallback);
  if (img && !img.complete) { img.addEventListener("load", show, { once: true }); img.addEventListener("error", () => setTimeout(show, 150), { once: true }); setTimeout(show, 600); } else show();
  t = setTimeout(() => popOut(box), 5200);
}
// (listening: the app is told, its pop-ups sent from then on, see trophypop.rs)
if (T && T.event) T.event.listen("pop", (e) => pop(e.payload)).then(() => T.event.emit("trophy-pop-ready", null)).catch(() => {});
