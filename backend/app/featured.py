import asyncio
import random

from app.omdb import fetch_ratings as fetch_omdb_ratings
from app.tmdb import fetch_movie_basic

# A curated pool of ~100 iconic, widely-recognizable movies spanning multiple decades
# and genres, used to populate the homepage's floating poster wall. IDs verified
# directly against the TMDB API (title + release year cross-checked) rather than
# assumed, to avoid picking the wrong entry (e.g. a remake or unrelated movie).
FEATURED_MOVIE_IDS = [
    238, 155, 680, 550, 27205, 157336, 769, 13, 278, 603,
    807, 103, 111, 274, 62, 539, 578, 597, 105, 120,
    98, 857, 424, 497, 1422, 1359, 1124, 68718, 106646, 500,
    629, 28, 348, 679, 78, 280, 1366, 489, 244786, 37165,
    38, 6977, 37799, 949, 524, 510, 14, 694, 289, 423,
    11, 1891, 1892, 329, 601, 85, 8587, 862, 12, 14160,
    10681, 129, 12477, 496243, 313369, 194, 598, 490132, 389, 1585,
    872, 239, 213, 426, 567, 829, 185, 600, 792, 197,
    745, 77, 115, 275, 7345, 16869, 24, 466272, 475557, 299534,
    24428, 1726, 284054, 419430, 376867, 399055, 354912, 150540, 2062, 9806,
]

_pool_cache: list[dict] | None = None
_pool_lock = asyncio.Lock()

# Below this, a fetch attempt is treated as failed rather than cached — a
# transient TMDB error (rate limit, network blip) hitting most of the ~100
# concurrent calls would otherwise get permanently cached as a near-empty
# pool for the rest of the process's lifetime, with no way to recover short
# of a restart.
MIN_VIABLE_POOL_SIZE = 20


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

        # Fetched concurrently rather than one-by-one — sequentially awaiting ~100
        # TMDB calls took upwards of 9 seconds on a cold cache, which is exactly
        # the delay a visitor would see before the homepage's posters appear.
        results = await asyncio.gather(
            *(fetch_movie_basic(tmdb_id) for tmdb_id in FEATURED_MOVIE_IDS),
            return_exceptions=True,
        )
        movies = [r for r in results if not isinstance(r, Exception)]
        if len(movies) < MIN_VIABLE_POOL_SIZE:
            return movies

        # Real IMDb rating is nice to have but isn't worth blocking the very
        # first homepage visit on: fetching it for the whole ~100-movie pool
        # up front (an earlier version of this code did exactly that) added
        # another ~100 concurrent OMDb calls in *sequence* after the TMDB
        # fetch above, turning what should be one ~2-3s wait into ~12s —
        # exactly the delay a visitor would see before any poster appears.
        # TMDB's own rating is used immediately as a safe placeholder, and
        # a background task swaps in the real IMDb rating shortly after,
        # mutating these same cached dicts in place — so nobody's homepage
        # load is ever gated on OMDb, only its first render is briefly less
        # precise.
        for movie in movies:
            movie["imdb_rating"] = movie["tmdb_rating"]

        _pool_cache = movies
        asyncio.create_task(_enrich_with_imdb_ratings(movies))
        return _pool_cache


async def _enrich_with_imdb_ratings(movies: list[dict]) -> None:
    ratings_results = await asyncio.gather(
        *(fetch_omdb_ratings(movie["imdb_id"]) for movie in movies), return_exceptions=True
    )
    for movie, ratings in zip(movies, ratings_results):
        imdb_rating = None if isinstance(ratings, BaseException) else ratings["imdb_rating"]
        if imdb_rating is not None:
            movie["imdb_rating"] = imdb_rating


def pick_random_featured(pool: list[dict], count: int) -> list[dict]:
    return random.sample(pool, min(count, len(pool)))
