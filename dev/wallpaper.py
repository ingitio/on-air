# Draws the flight wallpaper: a studio ON AIR sign, lit, on black.
#
#   python dev/wallpaper.py
#
# Sized for a large iPhone. iOS crops it to fit smaller ones, and the sign sits low
# enough to clear the Lock Screen clock.

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

WIDTH, HEIGHT = 1290, 2796
RED = (255, 48, 36)
HOT = (255, 214, 196)
FONT = "C:/Windows/Fonts/bahnschrift.ttf"


def spaced_text(draw, center, text, font, spacing, fill):
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = center[0] - total / 2
    for ch, width in zip(text, widths):
        draw.text((x, center[1]), ch, font=font, fill=fill, anchor="lm")
        x += width + spacing
    return total


def sign():
    layer = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font = ImageFont.truetype(FONT, 190)
    font.set_variation_by_axes([700, 100])

    center = (WIDTH / 2, 1740)
    total = spaced_text(draw, center, "ON AIR", font, 34, RED)
    pad_x, pad_y = 96, 150
    box = (center[0] - total / 2 - pad_x, center[1] - pad_y, center[0] + total / 2 + pad_x, center[1] + pad_y)
    draw.rounded_rectangle(box, radius=44, outline=RED, width=12)
    return layer


def main():
    lit = sign()
    wide = lit.filter(ImageFilter.GaussianBlur(120))
    middle = lit.filter(ImageFilter.GaussianBlur(36))
    near = lit.filter(ImageFilter.GaussianBlur(10))

    out = Image.new("RGB", (WIDTH, HEIGHT), (6, 5, 6))
    for glow, strength in ((wide, 0.7), (middle, 0.7), (near, 0.9)):
        out = Image.blend(out, Image.composite(glow, out, glow.convert("L").point(lambda v: min(255, v * 3))), strength)

    core = lit.filter(ImageFilter.GaussianBlur(1.2))
    mask = core.convert("L").point(lambda v: min(255, v * 3))
    out.paste(Image.new("RGB", (WIDTH, HEIGHT), HOT), (0, 0), mask.point(lambda v: int(v * 0.55)))
    out.paste(core, (0, 0), mask.point(lambda v: int(v * 0.5)))

    path = Path(__file__).resolve().parent.parent / "assets" / "on-air-wallpaper.png"
    path.parent.mkdir(exist_ok=True)
    out.save(path, optimize=True)
    print(path)


if __name__ == "__main__":
    main()
