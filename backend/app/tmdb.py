import asyncio
import datetime
import os

import httpx

TMDB_ACCESS_TOKEN = os.environ.get("TMDB_ACCESS_TOKEN")
TMDB_BASE_URL = "https://api.themoviedb.org/3"

# TMDB's canonical movie genre list (stable, confirmed against their /genre/movie/list
# endpoint). Kept as a constant rather than fetched live since it essentially never changes.
VALID_GENRES = [
    "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama",
    "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance",
    "Science Fiction", "TV Movie", "Thriller", "War", "Western",
]

# TMDB's own numeric IDs for the genres above, needed to ask /discover for
# movies in a specific genre server-side rather than fetching a broad pool
# and filtering it ourselves afterward.
GENRE_NAME_TO_TMDB_ID = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80,
    "Documentary": 99, "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36,
    "Horror": 27, "Music": 10402, "Mystery": 9648, "Romance": 10749,
    "Science Fiction": 878, "TV Movie": 10770, "Thriller": 53, "War": 10752, "Western": 37,
}


class MovieNotFoundError(Exception):
    pass


def _headers() -> dict:
    return {"Authorization": f"Bearer {TMDB_ACCESS_TOKEN}"}


# A fresh httpx.AsyncClient() per call opens a brand-new TCP+TLS connection
# every time — the exact same class of bug as the database's per-request
# connection, just one layer up. Scoring a recommendation candidate pool can
# mean 50-80 of these in flight at once, so one shared, reused client (which
# keeps a warm connection pool of its own) matters here the same way the
# database's connection pool did.
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10.0)
    return _client


def _parse_date(date_str: str | None) -> datetime.date | None:
    return datetime.date.fromisoformat(date_str) if date_str else None


async def search_movies(query: str, page: int = 1) -> dict:
    response = await _get_client().get(
        f"{TMDB_BASE_URL}/search/movie",
        headers=_headers(),
        params={"query": query, "page": page, "include_adult": "false"},
    )
    response.raise_for_status()
    data = response.json()

    return {
        "page": data.get("page"),
        "total_pages": data.get("total_pages"),
        "total_results": data.get("total_results"),
        "results": [
            {
                "tmdb_id": movie["id"],
                "title": movie.get("title"),
                "release_date": movie.get("release_date") or None,
                "poster_path": movie.get("poster_path"),
            }
            for movie in data.get("results", [])
        ],
    }


async def fetch_movie_details(tmdb_id: int) -> dict:
    response = await _get_client().get(
        f"{TMDB_BASE_URL}/movie/{tmdb_id}",
        headers=_headers(),
        params={"append_to_response": "credits,keywords"},
    )
    if response.status_code == 404:
        raise MovieNotFoundError(f"TMDB movie {tmdb_id} not found")
    response.raise_for_status()
    data = response.json()

    crew = data.get("credits", {}).get("crew", [])
    cast = data.get("credits", {}).get("cast", [])
    director = next((person["name"] for person in crew if person.get("job") == "Director"), None)

    return {
        "id": data["id"],
        "title": data.get("title"),
        "release_date": _parse_date(data.get("release_date")),
        "poster_path": data.get("poster_path"),
        "synopsis": data.get("overview"),
        "director": director,
        "genres": [genre["name"] for genre in data.get("genres", [])],
        "main_cast": [person["name"] for person in cast[:5]],
        "language": data.get("original_language"),
        "runtime_minutes": data.get("runtime"),
        # Recommendation-engine signal: thematic tags, and how many people voted
        # (so a rating can be weighed against how much it should be trusted) plus
        # TMDB's own "how much buzz right now" score, both already in this response.
        "keywords": [kw["name"] for kw in data.get("keywords", {}).get("keywords", [])],
        "vote_count": data.get("vote_count"),
        "popularity": data.get("popularity"),
        "tmdb_rating": data.get("vote_average"),
    }


async def _fetch_movie_list(path: str, params: dict | None = None) -> list[dict]:
    response = await _get_client().get(f"{TMDB_BASE_URL}{path}", headers=_headers(), params=params)
    response.raise_for_status()
    data = response.json()

    return [
        {
            "tmdb_id": movie["id"],
            "title": movie.get("title"),
            "release_date": movie.get("release_date") or None,
            "poster_path": movie.get("poster_path"),
        }
        for movie in data.get("results", [])
    ]


async def fetch_trending_movies() -> list[dict]:
    return await _fetch_movie_list("/trending/movie/day")


async def fetch_top_rated_movies() -> list[dict]:
    # TMDB's own /movie/top_rated ranks by raw vote average with no vote-count floor,
    # so a brand-new release with a handful of 10/10 votes outranks genuine classics.
    # /discover/movie with a minimum vote count gives the actual highest-rated films.
    return await _fetch_movie_list(
        "/discover/movie",
        params={"sort_by": "vote_average.desc", "vote_count.gte": 5000, "include_adult": "false"},
    )


async def fetch_popular_movies() -> list[dict]:
    # Sorting by total vote count (rather than TMDB's "popular" = trending-ish right now)
    # surfaces the most-watched, most iconic movies of all time.
    return await _fetch_movie_list(
        "/discover/movie",
        params={"sort_by": "vote_count.desc", "include_adult": "false"},
    )


async def fetch_recommendations(tmdb_id: int) -> list[dict]:
    """TMDB's own "people who liked this also liked" list for one movie —
    used to seed the For You page's per-favorite recommendation rows."""
    return await _fetch_movie_list(f"/movie/{tmdb_id}/recommendations")


async def fetch_discover_by_genres(
    genre_ids: list[int],
    vote_count_gte: int = 100,
    vote_count_lte: int | None = None,
    vote_average_gte: float | None = None,
) -> list[dict]:
    """Lets TMDB do the broad filtering (genre, vote-count band) server-side,
    so our own scoring only has to rank an already-relevant candidate pool
    rather than TMDB's entire catalog. Genres are OR'd together (TMDB's "|"
    separator) rather than AND'd ("," would require every genre to match at
    once) — the goal is "movies matching any genre this user likes," not
    "movies that are simultaneously every one of these genres," which for a
    varied taste (e.g. both Crime and Science Fiction) would return almost
    nothing."""
    params = {
        "with_genres": "|".join(str(g) for g in genre_ids),
        "sort_by": "popularity.desc",
        "vote_count.gte": vote_count_gte,
        "include_adult": "false",
    }
    if vote_count_lte is not None:
        params["vote_count.lte"] = vote_count_lte
    if vote_average_gte is not None:
        params["vote_average.gte"] = vote_average_gte
    return await _fetch_movie_list("/discover/movie", params=params)


async def fetch_movie_basic(tmdb_id: int) -> dict:
    """Lightweight lookup (no credits) for display-only use cases like the homepage."""
    response = await _get_client().get(
        f"{TMDB_BASE_URL}/movie/{tmdb_id}",
        headers=_headers(),
    )
    if response.status_code == 404:
        raise MovieNotFoundError(f"TMDB movie {tmdb_id} not found")
    response.raise_for_status()
    data = response.json()

    return {
        "tmdb_id": data["id"],
        "title": data.get("title"),
        "release_date": data.get("release_date") or None,
        "poster_path": data.get("poster_path"),
        "tmdb_rating": data.get("vote_average") or None,
    }


async def ensure_movie_cached(conn, tmdb_id: int) -> None:
    exists = await conn.fetchval("SELECT 1 FROM public.movies WHERE id = $1", tmdb_id)
    if exists:
        return

    movie = await fetch_movie_details(tmdb_id)

    await conn.execute(
        """
        INSERT INTO public.movies
            (id, title, release_date, poster_path, synopsis, director, genres, main_cast, language,
             runtime_minutes, keywords, vote_count, popularity, tmdb_rating)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO NOTHING
        """,
        movie["id"],
        movie["title"],
        movie["release_date"],
        movie["poster_path"],
        movie["synopsis"],
        movie["director"],
        movie["genres"],
        movie["main_cast"],
        movie["language"],
        movie["runtime_minutes"],
        movie["keywords"],
        movie["vote_count"],
        movie["popularity"],
        movie["tmdb_rating"],
    )


async def ensure_movies_cached_bulk(pool, tmdb_ids: list[int]) -> None:
    """Caches many movies at once — used when scoring a whole candidate pool
    for recommendations, where ensure_movie_cached's one-at-a-time approach
    would be a problem for a different reason than raw request count: it
    holds a database connection open for the entire TMDB network call, so
    running many of them "concurrently" against a small connection pool just
    serializes down to however many connections happen to be free. This
    checks what's already cached in one query, fetches only what's missing
    from TMDB with no database connection held open at all while doing so,
    then writes everything back in one batch.
    """
    if not tmdb_ids:
        return

    async with pool.acquire() as conn:
        cached_ids = {
            row["id"]
            for row in await conn.fetch(
                "SELECT id FROM public.movies WHERE id = ANY($1::int[])", tmdb_ids
            )
        }
    missing_ids = [tmdb_id for tmdb_id in tmdb_ids if tmdb_id not in cached_ids]
    if not missing_ids:
        return

    results = await asyncio.gather(
        *(fetch_movie_details(tmdb_id) for tmdb_id in missing_ids), return_exceptions=True
    )
    movies = [movie for movie in results if not isinstance(movie, BaseException)]
    if not movies:
        return

    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO public.movies
                (id, title, release_date, poster_path, synopsis, director, genres, main_cast, language,
                 runtime_minutes, keywords, vote_count, popularity, tmdb_rating)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id) DO NOTHING
            """,
            [
                (
                    movie["id"],
                    movie["title"],
                    movie["release_date"],
                    movie["poster_path"],
                    movie["synopsis"],
                    movie["director"],
                    movie["genres"],
                    movie["main_cast"],
                    movie["language"],
                    movie["runtime_minutes"],
                    movie["keywords"],
                    movie["vote_count"],
                    movie["popularity"],
                    movie["tmdb_rating"],
                )
                for movie in movies
            ],
        )
