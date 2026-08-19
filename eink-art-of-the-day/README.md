# E-ink Art of the Day

Pulls a random public-domain painting from the [Met Museum's Collection API](https://metmuseum.github.io/)
and displays it on a Waveshare 2.13" e-Paper HAT, with a "Title — Artist"
caption along the bottom.

## Hardware

- Raspberry Pi (Zero 2 W is plenty)
- [Waveshare 2.13" e-Paper HAT](https://www.waveshare.com/2.13inch-e-paper-hat.htm) —
  black/white only, 250×122, plugs straight onto the 40-pin GPIO header (no
  wiring needed).
- **Check your hardware revision.** Waveshare has released several
  controller versions of this panel (V2/V3/V4) with different driver module
  names. It's usually printed on a sticker on the ribbon cable, or check
  what your order confirmation/listing says. Set `EPD_DRIVER_MODULE` in
  [config.py](config.py) to match (e.g. `"epd2in13_V4"`).

Note this panel is black/white only. A photo of a painting gets converted to
a dithered 1-bit image — see [Image quality](#image-quality) below for what
that actually looks like and how to get the best result out of it.

## Setup on the Pi

```bash
sudo raspi-config   # Interface Options -> SPI -> enable, then reboot
git clone <this project>  # or just copy the folder over
cd eink-art-of-the-day
python3 -m venv .venv --system-site-packages
source .venv/bin/activate
pip install -r requirements.txt
pip install RPi.GPIO spidev
```

Unlike Pimoroni's `inky` package, Waveshare's driver isn't published on
PyPI — you vendor it directly:

```bash
git clone https://github.com/waveshare/e-Paper.git /tmp/e-Paper
cp -r /tmp/e-Paper/RaspberryPi_JetsonNano/python/lib/waveshare_epd .
```

That copies the `waveshare_epd` folder into this project so `import
waveshare_epd.epd2in13_V4` (or whichever version you have) works. Then:

```bash
python main.py
```

## Developing without the hardware

Everything except the final `epd.display()` call runs fine on a regular
machine — no GPIO/SPI packages needed. Use preview mode to check the
crop/dither/caption without a panel attached:

```bash
python main.py --preview   # writes data/preview.png
```

## Image quality

At 250×122px and black/white-only, a straight photo-to-1-bit conversion
turns into unreadable speckle noise — text and fine detail just disappear
into dither pattern. `prepare_image()` in [renderer.py](renderer.py)
auto-contrasts and slightly blurs the art before dithering, which trades
fine detail for recognizable light/dark shapes. Portraits, sculptures, and
high-contrast paintings read best; busy/low-contrast pieces (tapestries,
detailed patterns) will look muddier. If results look too smudged, lower
the `GaussianBlur` radius in `prepare_image()`; if they look too noisy,
raise it.

## Running daily

Cron is the simplest option — edit with `crontab -e`:

```cron
# refresh the art every morning at 6am
0 6 * * * /home/pi/eink-art-of-the-day/.venv/bin/python /home/pi/eink-art-of-the-day/main.py >> /home/pi/eink-art-of-the-day/data/run.log 2>&1
```

Or use a systemd timer if you prefer — more robust around reboots, same idea.

## Notes

- `data/history.json` keeps the last 60 artwork IDs shown, so it won't repeat
  the same painting for a couple of months.
- `data/last_rendered.png` is a fallback: if the Met API is unreachable on a
  given day, it re-displays whatever was shown last rather than leaving the
  panel blank.
- Only "highlight" objects are queried (`isHighlight=true`) — the Met's
  general collection includes a lot of non-visual objects (coins, textile
  fragments, etc.); highlights skew toward well-photographed, recognizable
  pieces, which matters more here given the display's limited resolution.
- I initially built this against the Art Institute of Chicago's API instead —
  its image CDN sits behind Cloudflare bot-protection that blocks
  non-browser requests, so it's a bad fit for a script running unattended.
  The Met's API doesn't have that problem.
- I originally scoped this around a Pimoroni Inky Impression (7-color), which
  reproduces paintings far more faithfully but costs ~₹6,000+ in India. This
  version targets a ~₹2,300 Waveshare B/W panel instead — expect a moodier,
  dithered look rather than a color print.
