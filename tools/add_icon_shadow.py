#!/usr/bin/env python3
"""Adds the dark halo the PS3 player icons have (the ones made without it):
a black glow ~6 px wide around the white glyph, alpha 220 at the edge fading
to 0, matching the console's own Stop / Pause / Play icons."""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

PROFILE = [(0, 190), (1, 150), (2, 80), (3, 25), (4, 0)]   # thinner than the console halo (thin glyphs look heavy otherwise)


def add_shadow(src, dst):
    im = Image.open(src).convert("RGBA")
    a = np.array(im).astype(np.float32)
    up = 4
    big = np.array(Image.fromarray(a[..., 3].astype(np.uint8)).resize((im.width * up, im.height * up), Image.BILINEAR)) > 100
    dist = ndimage.distance_transform_edt(~big) / up
    dist = np.array(Image.fromarray(dist.astype(np.float32)).resize(im.size, Image.BOX))
    sh = np.interp(dist, [p[0] for p in PROFILE], [p[1] for p in PROFILE]) / 255.0
    ga = a[..., 3:4] / 255.0
    out = np.zeros_like(a)
    oa = ga[..., 0] + sh * (1 - ga[..., 0])
    out[..., :3] = a[..., :3] * ga / np.maximum(oa[..., None], 1e-6)
    out[..., 3] = oa * 255
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA").save(dst)


if __name__ == "__main__":
    for s, d in zip(sys.argv[1::2], sys.argv[2::2]):
        add_shadow(s, d)
