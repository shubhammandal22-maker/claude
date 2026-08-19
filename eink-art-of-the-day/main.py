"""Fetch today's artwork and push it to the e-ink display.

Usage:
    python main.py              # render to the physical Waveshare panel
    python main.py --preview    # save data/preview.png instead (no hardware needed)
"""
from __future__ import annotations

import argparse
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")

import art_source
import config
import renderer


def run(preview: bool) -> int:
    history = art_source.load_history()

    try:
        artwork = art_source.pick_new_artwork(history)
        raw_bytes = art_source.download_image(artwork)
    except Exception as exc:  # noqa: BLE001 - fall back rather than leave a blank/stale screen
        print(f"Fetch failed ({exc}); falling back to last rendered image if available.", file=sys.stderr)
        if config.LAST_IMAGE_FILE.exists() and not preview:
            from PIL import Image

            renderer.display_on_eink(Image.open(config.LAST_IMAGE_FILE))
        return 1

    image = renderer.prepare_image(raw_bytes, artwork.caption)

    if preview:
        renderer.save_preview(image)
        print(f"Saved preview to {config.PREVIEW_FILE}")
    else:
        renderer.display_on_eink(image)
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        image.save(config.LAST_IMAGE_FILE)

    history.append(artwork.id)
    art_source.save_history(history)

    print(f"Displayed: {artwork.caption} ({artwork.date})")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", action="store_true", help="save to data/preview.png instead of driving hardware")
    args = parser.parse_args()
    sys.exit(run(preview=args.preview))
