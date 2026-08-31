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


class MovieNotFoundError(Exception):
    pass


def _headers() -> dict:
    return {"Authorization": f"Bearer {TMDB_ACCESS_TOKEN}"}


def _parse_date(date_str: str | None) -> datetime.date | None:
    return datetime.date.fromisoformat(date_str) if date_str else None


async def search_movies(query: str, page: int = 1) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
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
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{TMDB_BASE_URL}/movie/{tmdb_id}",
            headers=_headers(),
            params={"append_to_response": "credits"},
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
    }


async def _fetch_movie_list(path: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{TMDB_BASE_URL}{path}", headers=_headers())
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
    return await _fetch_movie_list("/movie/top_rated")


async def fetch_popular_movies() -> list[dict]:
    return await _fetch_movie_list("/movie/popular")


async def fetch_movie_basic(tmdb_id: int) -> dict:
    """Lightweight lookup (no credits) for display-only use cases like the homepage."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
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
            (id, title, release_date, poster_path, synopsis, director, genres, main_cast, language, runtime_minutes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    )
