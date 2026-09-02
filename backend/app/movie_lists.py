import asyncio
import time

import httpx
from fastapi import HTTPException

from app.tmdb import fetch_popular_movies, fetch_top_rated_movies, fetch_trending_movies

_TTL_SECONDS = 3600


class _CachedList:
    """In-memory cache for a TMDB list endpoint, refreshed hourly."""

    def __init__(self, fetch):
        self._fetch = fetch
        self._cache: list[dict] | None = None
        self._cache_time: float = 0.0
        self._lock = asyncio.Lock()

    async def get(self) -> list[dict]:
        now = time.monotonic()
        if self._cache is not None and (now - self._cache_time) < _TTL_SECONDS:
            return self._cache

        async with self._lock:
            now = time.monotonic()
            if self._cache is not None and (now - self._cache_time) < _TTL_SECONDS:
                return self._cache
            try:
                self._cache = await self._fetch()
            except (httpx.HTTPStatusError, httpx.RequestError):
                raise HTTPException(status_code=502, detail="TMDB is currently unavailable")
            self._cache_time = now
            return self._cache


_trending = _CachedList(fetch_trending_movies)
_top_rated = _CachedList(fetch_top_rated_movies)
_popular = _CachedList(fetch_popular_movies)


async def get_trending_movies() -> list[dict]:
    return await _trending.get()


async def get_top_rated_movies() -> list[dict]:
    return await _top_rated.get()


async def get_popular_movies() -> list[dict]:
    return await _popular.get()
