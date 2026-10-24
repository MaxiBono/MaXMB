"""Writes src/assets/icons/index.json: every picture of the app's own icons
(system icons, the icons PS3 themes replace, stock avatars, console badges, discs, the on-screen
keyboard, photo viewer and video player icons). The app loads them all while
the intro plays, so every menu shows its icons at once.
Run it again after adding or removing pictures in src/assets/icons."""
import json, os
root = os.path.join(os.path.dirname(__file__), "..", "src", "assets")
out = []
for d, _, files in os.walk(os.path.join(root, "icons")):
    for f in sorted(files):
        if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")):
            out.append("./assets/" + os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
# the menus' own icons first, then the rest (avatars, badges…)
out.sort(key=lambda u: (0 if "/icons/system/" in u or "/icons/theme/" in u else 1, u))
with open(os.path.join(root, "icons", "index.json"), "w") as fh:
    json.dump(out, fh, indent=0)
print(len(out), "pictures")
