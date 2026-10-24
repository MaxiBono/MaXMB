#!/usr/bin/env python3
"""Builds codec badges in the PS3 style from the blank badge (None.png).

Video badges: 110x28, bar only. Audio badges for the video player: 120x28
(wider bar + the sound-wave mark). Music player badges: 110x28 (bar + wave).
Text: light grey letters with a soft, offset grey shadow (no outline), like
the console's own badges.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"


def bar(none_png, width):
    """The blank bar from None.png (x 4..91), stretched to `width` keeping the round ends."""
    src = Image.open(none_png).convert("RGBA").crop((4, 0, 92, 28))
    if width == src.width:
        return src
    cap = 10
    out = Image.new("RGBA", (width, 28), (0, 0, 0, 0))
    out.paste(src.crop((0, 0, cap, 28)), (0, 0))
    out.paste(src.crop((src.width - cap, 0, src.width, 28)), (width - cap, 0))
    mid = src.crop((cap, 0, src.width - cap, 28)).resize((width - 2 * cap, 28), Image.BILINEAR)
    out.paste(mid, (cap, 0))
    return out


def text_layer(text, w, h=28):
    """Heavy, slightly extended letters: a light vertical gradient fill, a dark
    rim and a soft drop shadow, centred on the bar (cap height ~15 px)."""
    import numpy as np
    from PIL import ImageFilter, ImageChops
    S = 4
    f = ImageFont.truetype(FONT, 21 * S)
    tmp = Image.new("L", (w * S * 3, h * S * 2), 0)
    d = ImageDraw.Draw(tmp)
    cx = 10 * S
    for ch in text:                                    # a little letter spacing
        d.text((cx, 4 * S), ch, font=f, fill=255, stroke_width=int(0.6 * S), stroke_fill=255)   # a touch heavier
        cx += d.textlength(ch, font=f) + (1.3 * S if ch != " " else 0)
    bb = tmp.getbbox()
    glyph = tmp.crop(bb)
    cap_h = 15 * S                                     # capitals ~15 px tall
    k = cap_h / glyph.height
    gw = glyph.width * k * 1.12                        # a little extended
    max_w = (w - 7) * S
    if gw > max_w:
        gw = max_w
    glyph = glyph.resize((max(1, int(gw)), cap_h), Image.LANCZOS)
    fill = Image.new("L", (w * S, h * S), 0)
    x = (w * S - glyph.width) // 2
    y = int(13.7 * S - cap_h / 2)
    fill.paste(glyph, (x, y))
    # soft shadow: the letters, blurred a little and moved ~1 px down-right,
    # in a muted blue-grey (the originals' shadow isn't black)
    shadow = fill.filter(ImageFilter.GaussianBlur(0.9 * S)).transform(
        fill.size, Image.AFFINE, (1, 0, -1.1 * S, 0, 1, -1.2 * S))
    yy = np.linspace(0, 1, h * S)[:, None]
    grad = np.clip(255 - (yy - y / (h * S)) / (cap_h / (h * S)) * 85, 160, 255)  # white top -> light grey
    out = np.zeros((h * S, w * S, 4), np.float32)
    sh = np.clip(np.array(shadow, np.float32) / 255 * 0.85, 0, 1)
    fl = np.array(fill, np.float32) / 255
    for layer_a, col in ((sh, np.broadcast_to(np.array([46.0, 52.0, 64.0]), (h * S, w * S, 3))),
                         (fl, np.repeat(grad.repeat(w * S, 1)[..., None], 3, 2))):
        a0 = out[..., 3:4]
        a1 = layer_a[..., None]
        out[..., :3] = col * a1 + out[..., :3] * (1 - a1)
        out[..., 3:4] = a1 + a0 * (1 - a1)
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
    # alpha channel was in 0..1: scale
    arr = np.array(img).astype(np.float32); arr[..., 3] = np.clip(out[..., 3] * 255, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA").resize((w, h), Image.LANCZOS)


def make(none_png, wave_src, text, kind, out):
    if kind == "video":            # 110 x 28, bar at x 4
        img = Image.new("RGBA", (110, 28), (0, 0, 0, 0)); b = bar(none_png, 88); bx = 4
    elif kind == "vaudio":         # 120 x 28, bar x 2..105, wave 107..119
        img = Image.new("RGBA", (120, 28), (0, 0, 0, 0)); b = bar(none_png, 104); bx = 2
        img.alpha_composite(Image.open(wave_src).convert("RGBA").crop((106, 0, 120, 28)), (106, 0))
    else:                          # music: 110 x 28, bar x 4..91, wave 93..105
        img = Image.new("RGBA", (110, 28), (0, 0, 0, 0)); b = bar(none_png, 88); bx = 4
        img.alpha_composite(Image.open(wave_src).convert("RGBA").crop((92, 0, 110, 28)), (92, 0))
    img.alpha_composite(b, (bx, 0))
    t = text_layer(text, b.width)
    img.alpha_composite(t, (bx, 0))
    img.save(out)


if __name__ == "__main__":
    make(*sys.argv[1:6])
