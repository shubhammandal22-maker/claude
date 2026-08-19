"""Turns a downloaded artwork image into something the e-ink panel can show."""
from __future__ import annotations

import io

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

import config


def _load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Raspberry Pi OS
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",  # macOS, for local preview
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _cover_crop(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Resize+crop img to exactly fill target_w x target_h (like CSS object-fit: cover)."""
    src_ratio = img.width / img.height
    target_ratio = target_w / target_h
    if src_ratio > target_ratio:
        new_h = target_h
        new_w = int(new_h * src_ratio)
    else:
        new_w = target_w
        new_h = int(new_w / src_ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    return img.crop((left, top, left + target_w, top + target_h))


def prepare_image(raw_bytes: bytes, caption: str) -> Image.Image:
    """At 250x122px, a straight photo -> 1-bit dither turns into speckle
    noise you can't read. Autocontrast + a slight blur first concentrates
    the dither pattern into recognizable light/dark shapes instead."""
    panel_w, panel_h = config.DISPLAY_SIZE
    art_h = panel_h - config.CAPTION_HEIGHT

    art = Image.open(io.BytesIO(raw_bytes)).convert("L")
    art = _cover_crop(art, panel_w, art_h)
    art = ImageOps.autocontrast(art, cutoff=1)
    art = art.filter(ImageFilter.GaussianBlur(radius=0.8))

    canvas = Image.new("L", (panel_w, panel_h), 255)
    canvas.paste(art, (0, 0))

    # Caption is drawn after blurring so the text itself stays crisp.
    draw = ImageDraw.Draw(canvas)
    font = _load_font(config.FONT_SIZE)
    text = caption if len(caption) <= 45 else caption[:42] + "..."
    text_y = art_h + (config.CAPTION_HEIGHT - config.FONT_SIZE) // 2
    draw.text((4, text_y), text, fill=0, font=font)

    return canvas


def save_preview(image: Image.Image) -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    # convert('1') applies Floyd-Steinberg dithering, same as what actually
    # hits the panel - so the preview reflects real output, not the smooth grayscale.
    image.convert("1").convert("RGB").save(config.PREVIEW_FILE)


def display_on_eink(image: Image.Image) -> None:
    """Pushes the image to a physically-connected Waveshare 2.13" HAT.
    Imported lazily so this module still works for --preview on a dev machine
    without `waveshare_epd` (and its Pi-only GPIO/SPI deps) installed.
    """
    import importlib

    epd_module = importlib.import_module(f"waveshare_epd.{config.EPD_DRIVER_MODULE}")
    epd = epd_module.EPD()
    epd.init()
    epd.Clear(0xFF)
    epd.display(epd.getbuffer(image.convert("1")))
    epd.sleep()
