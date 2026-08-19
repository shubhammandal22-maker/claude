from pathlib import Path

# --- Display -----------------------------------------------------------
# Waveshare 2.13" e-Paper HAT, black/white only. The panel's native buffer
# is portrait (122 wide x 250 tall), but the driver accepts a landscape
# image sized (250, 122) and rotates it internally - that's what we compose.
DISPLAY_SIZE = (250, 122)  # (width, height)

# Waveshare has revised this panel's controller several times (V2/V3/V4),
# which changes the driver module name. Check the sticker on the ribbon
# cable or your order page and set this to match - e.g. "epd2in13_V2",
# "epd2in13_V3", "epd2in13_V4". Get this wrong and init() will raise.
EPD_DRIVER_MODULE = "epd2in13_V4"

# Reserve a strip at the bottom of the panel for "Title — Artist" text.
# Kept small since the whole panel is only 122px tall.
CAPTION_HEIGHT = 18
FONT_SIZE = 11

# --- Art source ----------------------------------------------------------
# The Met's Collection API (met.org) — free, no key, and its image CDN
# doesn't sit behind a bot-challenge like some other museum APIs do.
MET_SEARCH_URL = "https://collectionapi.metmuseum.org/public/collection/v1/search"
MET_OBJECT_URL = "https://collectionapi.metmuseum.org/public/collection/v1/objects/{id}"

# How many recent artworks to remember, to avoid near-term repeats
HISTORY_SIZE = 60

# --- Paths -----------------------------------------------------------
DATA_DIR = Path(__file__).parent / "data"
HISTORY_FILE = DATA_DIR / "history.json"
LAST_IMAGE_FILE = DATA_DIR / "last_rendered.png"  # used as fallback if a fetch fails
PREVIEW_FILE = DATA_DIR / "preview.png"
