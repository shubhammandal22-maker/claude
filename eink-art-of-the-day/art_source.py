"""Fetches a random public-domain artwork from the Met Museum's Collection API.

Free, no API key required: https://metmuseum.github.io/
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass

import requests

import config


@dataclass
class Artwork:
    id: int
    title: str
    artist: str
    date: str
    image_url: str

    @property
    def caption(self) -> str:
        parts = [p for p in (self.title, self.artist) if p]
        return " — ".join(parts) if parts else "Unknown"


def load_history() -> list[int]:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    if config.HISTORY_FILE.exists():
        return json.loads(config.HISTORY_FILE.read_text())
    return []


def save_history(history: list[int]) -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = history[-config.HISTORY_SIZE :]
    config.HISTORY_FILE.write_text(json.dumps(trimmed))


def _search_object_ids() -> list[int]:
    resp = requests.get(
        config.MET_SEARCH_URL,
        params={"hasImages": "true", "isHighlight": "true", "q": "painting"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("objectIDs") or []


def _fetch_object(object_id: int) -> dict:
    resp = requests.get(config.MET_OBJECT_URL.format(id=object_id), timeout=15)
    resp.raise_for_status()
    return resp.json()


def pick_new_artwork(history: list[int], max_attempts: int = 15) -> Artwork:
    """Tries random highlighted objects until it finds one with a public-domain
    image that hasn't shown up in recent history."""
    seen = set(history)
    try:
        object_ids = _search_object_ids()
    except requests.RequestException as exc:
        raise RuntimeError(f"Met search failed: {exc}") from exc

    random.shuffle(object_ids)
    for object_id in object_ids[:max_attempts]:
        if object_id in seen:
            continue
        try:
            obj = _fetch_object(object_id)
        except requests.RequestException:
            continue
        image_url = obj.get("primaryImage")
        if not image_url or not obj.get("isPublicDomain"):
            continue
        return Artwork(
            id=object_id,
            title=obj.get("title") or "Untitled",
            artist=obj.get("artistDisplayName") or "",
            date=obj.get("objectDate") or "",
            image_url=image_url,
        )
    raise RuntimeError("Could not find a fresh artwork after several attempts")


def download_image(artwork: Artwork) -> bytes:
    resp = requests.get(artwork.image_url, timeout=30)
    resp.raise_for_status()
    return resp.content
