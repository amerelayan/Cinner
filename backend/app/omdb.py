import os

import httpx

OMDB_API_KEY = os.environ.get("OMDB_API_KEY")
OMDB_BASE_URL = "http://www.omdbapi.com/"

# Neither IMDb nor Rotten Tomatoes offer a public API, so OMDb (a free-tier
# service that legitimately licenses and re-serves both) is the practical
# source for real scores here, rather than the placeholder nulls the movies
# table shipped with.
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10.0)
    return _client


def _parse_rotten_tomatoes(ratings: list[dict]) -> float | None:
    for entry in ratings:
        if entry.get("Source") == "Rotten Tomatoes":
            value = entry.get("Value", "")
            if value.endswith("%"):
                try:
                    return float(value[:-1])
                except ValueError:
                    return None
    return None


async def fetch_ratings(imdb_id: str | None) -> dict:
    """Real IMDb and Rotten Tomatoes scores for one title, looked up by IMDb
    ID (cross-referenced from TMDB's own `imdb_id` field) rather than title
    and year — title matching is ambiguous for remakes and identically-titled
    films, an ID lookup isn't."""
    empty = {"imdb_rating": None, "rotten_tomatoes_rating": None}
    if not imdb_id or not OMDB_API_KEY:
        return empty

    response = await _get_client().get(OMDB_BASE_URL, params={"i": imdb_id, "apikey": OMDB_API_KEY})
    response.raise_for_status()
    data = response.json()

    if data.get("Response") != "True":
        return empty

    imdb_rating = None
    raw_imdb_rating = data.get("imdbRating")
    if raw_imdb_rating and raw_imdb_rating != "N/A":
        try:
            imdb_rating = float(raw_imdb_rating)
        except ValueError:
            imdb_rating = None

    return {
        "imdb_rating": imdb_rating,
        "rotten_tomatoes_rating": _parse_rotten_tomatoes(data.get("Ratings") or []),
    }
