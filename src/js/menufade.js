// A menu panel fading out where it is (0.15 s, styles.css gmOut), then
// `finish()`: ended at once when something else takes over meanwhile (another
// menu, a panel, a dialog: anything the XMB hands its buttons to, xmb.overlay),
// so a fading menu is never seen over what opened after it. The check runs
// before each frame is drawn, so what opens straight away (Information, a
// dialog, the next menu) shows with the old menu already gone.
// Returns cancel(): the fade stopped without finish() (the menu opened again).
export const FADE_MS = 150;
export function fadeOut(el, finish) {
  let raf = 0, t = 0, over = false;
  const stop = () => { over = true; cancelAnimationFrame(raf); clearTimeout(t); };
  const end = () => { if (over) return; stop(); finish(); };
  const watch = () => {
    const o = window.__xmb && window.__xmb.overlay;
    if (o && o.el !== el) { end(); return; }
    raf = requestAnimationFrame(watch);
  };
  raf = requestAnimationFrame(watch);
  t = setTimeout(end, FADE_MS);
  return stop;
}
