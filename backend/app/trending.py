import asyncio
import time

from app.tmdb import fetch_trending_movies

_TTL_SECONDS = 3600
_cache: list[dict] | None = None
_cache_time: float = 0.0
_lock = asyncio.Lock()


async def get_trending_movies() -> list[dict]:
    """In-memory cache of TMDB's daily trending list, refreshed hourly."""
    global _cache, _cache_time
    now = time.monotonic()
    if _cache is not None and (now - _cache_time) < _TTL_SECONDS:
        return _cache

    async with _lock:
        now = time.monotonic()
        if _cache is not None and (now - _cache_time) < _TTL_SECONDS:
            return _cache
        _cache = await fetch_trending_movies()
        _cache_time = now
        return _cache
