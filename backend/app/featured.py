import asyncio
import random

from app.tmdb import MovieNotFoundError, fetch_movie_basic

# A curated pool of ~50 iconic, widely-recognizable movies spanning multiple decades
# and genres, used to populate the homepage's floating poster wall. IDs verified
# directly against the TMDB API (title + release year cross-checked) rather than
# assumed, to avoid picking the wrong entry (e.g. a remake or unrelated movie).
FEATURED_MOVIE_IDS = [
    238, 155, 680, 550, 27205, 157336, 769, 13, 278, 603,
    807, 103, 111, 274, 62, 539, 578, 597, 105, 120,
    98, 857, 424, 497, 1422, 1359, 1124, 68718, 106646, 500,
    629, 28, 348, 679, 78, 280, 1366, 489, 244786, 37165,
    38, 6977, 37799, 949, 524, 510, 14, 694, 289, 423,
]

_pool_cache: list[dict] | None = None
_pool_lock = asyncio.Lock()


async def get_featured_pool() -> list[dict]:
    """Fetch (once) and cache in-memory the display info for the featured pool.

    This is a static, hand-curated list of classics that essentially never changes,
    so a simple process-lifetime in-memory cache avoids repeated TMDB calls without
    needing a database table or any persistence for what is purely homepage
    decoration data.
    """
    global _pool_cache
    if _pool_cache is not None:
        return _pool_cache

    async with _pool_lock:
        if _pool_cache is not None:
            return _pool_cache

        movies = []
        for tmdb_id in FEATURED_MOVIE_IDS:
            try:
                movies.append(await fetch_movie_basic(tmdb_id))
            except MovieNotFoundError:
                continue
        _pool_cache = movies
        return _pool_cache


def pick_random_featured(pool: list[dict], count: int) -> list[dict]:
    return random.sample(pool, min(count, len(pool)))
