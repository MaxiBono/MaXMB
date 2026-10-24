// A PS3 theme's background: its animated 3D scene (dynamic themes), drawn with
// WebGL and directed by the theme's own script, or its still picture.
// Adapted from DeckyXMB's DynamicBackground (Callum Bell, BSD 3-Clause; see
// README.md, Credits). Plays at the theme's own rate (30 or 60 frames a
// second, or less with an FPS Cap), drawn at Display Settings > Resolution like
// the waves; holds still on its last frame while a game runs, the window is
// hidden or (Low Performance Mode) out of focus, like the background videos;
// shows the still picture until the scene can be drawn (or if WebGL isn't
// available).
import { assetUrl } from "./api.js";
import { Renderer } from "./p3t/render.js";
import { Scene } from "./p3t/scene.js";

const CATCH_UP = 3;   // frames made up for after a stall (beyond that the time is let go)
const join = (dir, f) => `${dir}${/[\\/]$/.test(dir) ? "" : (dir.includes("\\") ? "\\" : "/")}${f}`;

async function inflate(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class ThemeBackground {
  constructor(el) {
    this.el = el;
    this.key = null;
    this._stop = null;
  }
  get showing() { return !!this.key; }
  // the theme's own background is on screen (not just its overlay)
  get coversBackground() { return !!this.key && this.layers !== "ov"; }

  // theme: { key, dir, scene, background, screenshot, layers }  (null: nothing)
  // layers: "all", "bg" (its background only: the scene's solid pictures) or
  // "ov" (its overlay only: the rest of the scene, see-through, over your own
  // background and waves)
  show(theme) {
    const key = theme ? theme.key : null;
    if (key === this.key) return;
    this.hide();
    if (!theme) return;
    this.key = key;
    const layers = this.layers = theme.layers || "all";
    const el = this.el;
    el.innerHTML = "";
    el.classList.toggle("ovonly", layers === "ov");
    // the still: the theme's background picture, or (a dynamic theme with
    // none) nothing: its preview has the XMB drawn on it, so it isn't used
    const stillPath = layers === "ov" ? null : theme.background;
    let still = null;
    if (stillPath) {
      still = document.createElement("img");
      still.className = "p3t-still"; still.alt = ""; still.src = assetUrl(stillPath);
      el.appendChild(still);
    }
    el.classList.add("show");
    if (!theme.scene) return;
    const canvas = document.createElement("canvas");
    canvas.className = "p3t-canvas";
    el.appendChild(canvas);
    let alive = true, raf = 0, ro = null, renderer = null, onWinResize = null;
    this._stop = () => {
      alive = false; cancelAnimationFrame(raf); ro && ro.disconnect();
      if (onWinResize) window.removeEventListener("resize", onWinResize);
      try { renderer && renderer.dispose(); } catch (e) {}
    };
    (async () => {
      try {
        const [data, script] = await Promise.all([
          fetch(assetUrl(join(theme.dir, "scene.json"))).then((r) => r.json()),
          fetch(assetUrl(join(theme.dir, "script.vsmx"))).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
        ]);
        if (!alive) return;
        const scene = new Scene(data, script, canvas.offsetWidth / Math.max(1, canvas.offsetHeight) || undefined);
        renderer = new Renderer(canvas, scene, { transparent: layers === "ov" });
        // Which actors are the background (the rest is the overlay):
        // • as most themes are made: their backdrop is a solid 16:9 picture (1920x1080, 1280x720...),
        //   and everything drawn over it (smoke, snow, beams, cut-outs, logos) has see-through parts:
        //   the actors showing a solid 16:9 picture are the background;
        // • a theme without one: an actor is background when it has filled a fifth of the screen, isn't
        //   added on as light, and its picture is at least a tenth solid (a slideshow's page, a backdrop
        //   in another shape, cut-out scenery); smoke, snow, beams and glows (see-through throughout, or
        //   small) are the overlay.
        // (how solid each picture is was measured when the theme was unpacked)
        const solid = (i) => data.textures[i]?.solid ?? 0;
        const backdrop = (i) => { const t = data.textures[i]; return !!t && t.width > 0 && t.height > 0 && Math.abs(t.width / t.height - 16 / 9) < 0.03 && solid(i) >= 0.9; };
        const hasBackdrop = data.actors.some((a) => a.texture != null && a.blend !== "add" && backdrop(a.texture));
        const big = new WeakSet();
        const isBg = (a, share) => {
          if (a.data.blend === "add") return false;
          const t = a.data.texture;
          if (hasBackdrop) return t != null && backdrop(t);
          if (share >= 0.2) big.add(a);
          return big.has(a) && (t == null || solid(t) >= 0.1);
        };
        const pick = (seen) => layers === "all" ? seen.map((v) => v.actor) : seen.filter((v) => isBg(v.actor, v.share) === (layers === "bg")).map((v) => v.actor);
        // the textures, inflated as they arrive
        data.textures.forEach((meta, i) => {
          fetch(assetUrl(join(theme.dir, `tex${i}.z`))).then((r) => r.arrayBuffer()).then(inflate)
            .then((bytes) => { if (alive && !renderer.hasTexture(i)) renderer.setTexture(i, { ...meta, data: bytes }); })
            .catch(() => {});
        });
        let shown = false, complete = false, cleared = false, due = 0, at = 0, owed = 0;
        const resize = () => {
          // Display Settings > Resolution (full screen): drawn at the chosen
          // resolution and scaled to the screen, as the waves are
          const rs = window.__xmbRenderScale || 0;
          const dpr = rs ? (window.devicePixelRatio || 1) * rs : Math.min(2, Math.max(1, window.devicePixelRatio || 1));
          canvas.width = Math.max(1, Math.min(3840, Math.round(canvas.offsetWidth * dpr)));
          canvas.height = Math.max(1, Math.min(2160, Math.round(canvas.offsetHeight * dpr)));
          // scripts know only the PS3's 16:9 and 4:3 screens
          const wide = canvas.width / canvas.height >= (16 / 9 + 4 / 3) / 2;
          scene.aspect = wide ? 16 / 9 : 4 / 3;
          scene.resolution = wide ? [1920, 1080] : [canvas.width, canvas.height];
          cleared = true;
        };
        resize();
        ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
        ro && ro.observe(canvas);
        // (a new Resolution changes the drawing size, not the canvas's)
        onWinResize = () => { if (alive) resize(); };
        window.addEventListener("resize", onWinResize);
        const draw = (actors) => { cleared = false; renderer.draw(1, actors); };
        const frame = (now) => {
          if (!alive) return;
          raf = requestAnimationFrame(frame);
          // held still (time doesn't move on) while a game runs, the window is
          // hidden or Low Performance Mode is on and the window is out of focus
          const b = document.body.classList;
          const paused = document.hidden || b.contains("in-game") || b.contains("lowpower") || !canvas.offsetParent;
          if (paused) { at = 0; if (cleared && shown) draw(pick(renderer.visible())); return; }
          if (now < due - 3) { if (cleared && shown) draw(pick(renderer.visible())); return; }
          // FPS Cap: drawn less often; the scene still moves on in the theme's
          // own steps, so it keeps its speed
          const rate = Math.min(scene.fps, window.__xmbFpsCap || Infinity);
          due = Math.max(due + 1000 / rate, now);
          // moved on in whole frames of the theme's rate, as on the PS3 (its
          // script counts frames while its animations play by time)
          const step = 1 / scene.fps;
          owed = at ? Math.min(CATCH_UP * step, owed + Math.max(0, now - at) / 1000) : step;
          at = now;
          const frames = Math.round(owed / step);
          owed -= frames * step;
          for (let i = 0; i < frames; i++) scene.update(step);
          const seen = renderer.visible();
          complete ||= data.textures.every((_, i) => renderer.hasTexture(i));
          if (!shown) {
            // shown once what's mostly in view can be drawn
            const solid = seen.filter((v) => v.share > 0.3 && v.actor.color[3] >= 1).map((v) => v.actor);
            if (!complete && !(solid.length > 0 && solid.every((a) => a.data.texture == null || renderer.hasTexture(a.data.texture)))) return;
            shown = true;
            canvas.classList.add("ready");
            if (still) still.classList.add("hid");
          }
          draw(pick(seen));
        };
        raf = requestAnimationFrame(frame);
      } catch (e) {
        console.warn("p3t: the theme's animated background can't be shown", e);
        canvas.remove();
      }
    })();
  }

  hide() {
    if (this._stop) { this._stop(); this._stop = null; }
    this.key = null;
    this.el.innerHTML = "";
    this.el.classList.remove("show");
  }
}
