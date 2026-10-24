// Fitting a picture / video into a box, the way the PS3's Screen Mode does:
//   normal   – the whole picture, scaled to fit (bars where the shapes differ)
//   zoom     – scaled to fill the box; the sides or top / bottom are cut
//   full     – stretched to exactly the box
//   original – the media's own pixel size at the app's resolution (smaller and
//              centred when it's lower resolution; fitted in when it's bigger)
// Sizes are set explicitly (not just object-fit) so they hold for <video>,
// <img> and <canvas> alike.

export const FIT_MODES = [["normal", "Normal"], ["zoom", "Zoom"], ["full", "Full Screen"], ["original", "Original"]];

// app pixels → CSS pixels: the app renders at the chosen resolution (or the
// screen's own), the layout is in CSS pixels
export function appPixelScale() {
  const resH = window.__xmbAppResH || (window.innerHeight * (window.devicePixelRatio || 1));
  return window.innerHeight / Math.max(1, resH);
}

function natural(el) {
  if (el.tagName === "VIDEO") return [el.videoWidth, el.videoHeight];
  if (el.tagName === "IMG") return [el.naturalWidth, el.naturalHeight];
  if (el.tagName === "CANVAS") return [el.width, el.height];
  return [0, 0];
}

export function fitMedia(el, mode, box) {
  if (!el) return;
  const [nw, nh] = natural(el);
  const bw = (box || el.parentElement)?.clientWidth || window.innerWidth;
  const bh = (box || el.parentElement)?.clientHeight || window.innerHeight;
  const st = el.style;
  st.inset = "auto"; st.right = "auto"; st.bottom = "auto";
  st.position = "absolute"; st.left = "50%"; st.top = "50%"; st.transform = "translate(-50%, -50%)";
  st.maxWidth = "none"; st.maxHeight = "none"; st.objectFit = "fill";
  if (!nw || !nh) {     // size not known yet: plain fit until it is
    st.width = "100%"; st.height = "100%"; st.objectFit = mode === "zoom" ? "cover" : mode === "full" ? "fill" : "contain";
    if (!el._fitWait) {
      el._fitWait = true;
      const again = () => { el._fitWait = false; fitMedia(el, el._fitMode || mode, box); };
      el.addEventListener(el.tagName === "VIDEO" ? "loadedmetadata" : "load", again, { once: true });
    }
    el._fitMode = mode;
    return;
  }
  el._fitMode = mode;
  let w, h;
  if (mode === "full") { w = bw; h = bh; }
  else {
    const fit = Math.min(bw / nw, bh / nh), fill = Math.max(bw / nw, bh / nh);
    let k = mode === "zoom" ? fill : fit;
    if (mode === "original") k = Math.min(fit, appPixelScale());
    w = nw * k; h = nh * k;
  }
  st.width = `${Math.round(w)}px`; st.height = `${Math.round(h)}px`;
}
