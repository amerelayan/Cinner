"""Powers the "Pick a Movie for Me" page: a lightweight, always-fresh quiz
(genre, era, mood, time available, acclaimed-classics preference) that
surfaces a small batch of matching movies. Deliberately independent of the
user's stored onboarding profile — answered fresh every visit, never read
from or written to `profiles` — so it stays a fun, no-commitment way to get
a pick, separate from the account-wide taste model "For You" builds on.

Logged-in users additionally get Match %/Predicted Rating on each pick (a
bonus, computed against their real taste vector) and already-tracked movies
are excluded, but the quiz answers alone decide which movies are even
considered — not stored history.
"""

import random
from datetime import date, timedelta

from app.recommendations.diversity import diversify
from app.recommendations.score import (
    compute_match_percentage,
    fit_rating_model,
    predict_rating_with_model,
)
from app.recommendations.taste import gather_user_taste
from app.recommendations.vectorize import vectorize_movie
from app.tmdb import GENRE_NAME_TO_TMDB_ID, ensure_movies_cached_bulk, fetch_discover_by_genres

BATCH_SIZE = 5

# Reuses the same "widely acclaimed classic" bar explain_match() already
# checks for, but as an actual filter here rather than just an explanation.
ACCLAIMED_MIN_RATING = 7.5
ACCLAIMED_MIN_VOTES = 5000

# A gentler floor for everyone else — keeps out genuinely bad movies without
# requiring acclaimed-classic status.
DEFAULT_MIN_RATING = 6.0
DEFAULT_MIN_VOTES = 200

ERA_YEARS_BACK = {"new": 1, "last_5_years": 5, "last_10_years": 10, "last_20_years": 20}


def _era_to_date_range(era: str) -> tuple[str | None, str | None]:
    today = date.today()
    if era in ERA_YEARS_BACK:
        return (today - timedelta(days=365 * ERA_YEARS_BACK[era])).isoformat(), None
    if era == "25_plus_years":
        return None, (today - timedelta(days=365 * 25)).isoformat()
    return None, None  # no_preference


# A deliberately simple, explainable mapping rather than a learned signal —
# there isn't remotely enough data to justify anything fancier. Each mood
# adds genres on top of whatever the person already picked (never replaces
# their choice), biasing the pool rather than overriding it. "Sad" and
# "stressed" lean toward comfort/uplift rather than more of the same mood,
# matching how mood-based curation generally works in practice (a "feeling
# down" playlist is rarely made of sadder songs).
MOOD_EXTRA_GENRES: dict[str, list[str]] = {
    "happy": ["Comedy", "Adventure", "Music"],
    "sad": ["Comedy", "Family", "Animation"],
    "stressed": ["Comedy", "Animation"],
    "excited": ["Action", "Thriller", "Science Fiction"],
    "neutral": [],
}

TIME_TO_RUNTIME: dict[str, tuple[int | None, int | None]] = {
    "short": (None, 100),
    "long": (140, None),
    "doesnt_matter": (None, None),
}


def _passes_runtime(movie: dict, runtime_gte: int | None, runtime_lte: int | None) -> bool:
    if runtime_gte is None and runtime_lte is None:
        return True
    runtime = movie.get("runtime_minutes")
    if runtime is None:
        return False
    if runtime_gte is not None and runtime < runtime_gte:
        return False
    if runtime_lte is not None and runtime > runtime_lte:
        return False
    return True


async def pick_movies(
    pool,
    genre_ids: list[int],
    age_preference: str,
    prefers_imdb_top_250: bool,
    mood: str,
    time_available: str,
    user_id: str | None,
) -> list[dict]:
    release_date_gte, release_date_lte = _era_to_date_range(age_preference)
    min_rating, min_votes = (
        (ACCLAIMED_MIN_RATING, ACCLAIMED_MIN_VOTES)
        if prefers_imdb_top_250
        else (DEFAULT_MIN_RATING, DEFAULT_MIN_VOTES)
    )
    runtime_gte, runtime_lte = TIME_TO_RUNTIME.get(time_available, (None, None))

    mood_genre_ids = [
        GENRE_NAME_TO_TMDB_ID[g] for g in MOOD_EXTRA_GENRES.get(mood, []) if g in GENRE_NAME_TO_TMDB_ID
    ]
    combined_genre_ids = list(dict.fromkeys(genre_ids + mood_genre_ids))

    # Runtime is deliberately NOT passed to TMDB's discover call here — its
    # with_runtime.gte/lte filter proved unreliable in testing (movies well
    # outside the requested band still came back), and since we can't tell
    # which direction it's wrong in, it's safer to fetch a normal pool and
    # enforce the runtime band ourselves afterward against our own verified
    # cached data (see _passes_runtime below).
    candidates = await fetch_discover_by_genres(
        combined_genre_ids,
        vote_count_gte=min_votes,
        vote_average_gte=min_rating,
        release_date_gte=release_date_gte,
        release_date_lte=release_date_lte,
        pages=2,
    )

    exclude_ids: set[int] = set()
    taste_vector = rated_movies = model = None
    if user_id:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT movie_id FROM public.favorites WHERE user_id = $1
                UNION SELECT movie_id FROM public.watched WHERE user_id = $1
                UNION SELECT movie_id FROM public.watchlist WHERE user_id = $1
                UNION SELECT movie_id FROM public.ratings WHERE user_id = $1
                """,
                user_id,
            )
            exclude_ids = {r["movie_id"] for r in rows}
            taste_vector, rated_movies, _ = await gather_user_taste(conn, user_id)
        model = fit_rating_model(rated_movies)

    # The whole shuffled pool is cached and checked against the runtime band
    # (not just a small headroom slice) — runtime can only be verified after
    # a movie's full details are cached, so slicing first risked starving the
    # runtime filter down to nothing if an unlucky slice landed on the wrong
    # lengths. ensure_movies_cached_bulk only does real work for movies not
    # already cached, so this stays cheap in practice.
    candidate_ids = [c["tmdb_id"] for c in candidates if c["tmdb_id"] not in exclude_ids]
    random.shuffle(candidate_ids)
    if not candidate_ids:
        return []

    await ensure_movies_cached_bulk(pool, candidate_ids)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, title, release_date, poster_path, synopsis, director, genres,
                   main_cast, language, runtime_minutes, vote_count, popularity,
                   tmdb_rating, imdb_rating, rotten_tomatoes_rating, collection_id, keywords
            FROM public.movies WHERE id = ANY($1::int[])
            """,
            candidate_ids,
        )
    movies_by_id = {r["id"]: dict(r) for r in rows}
    # Preserve the shuffled order so diversify() sees a genuinely random walk,
    # not one re-sorted by whatever order Postgres happened to return rows in.
    ordered_movies = [movies_by_id[i] for i in candidate_ids if i in movies_by_id]
    # TMDB's own with_runtime.gte/lte discover filter turned out unreliable in
    # testing (movies outside the requested band still came back) — enforced
    # again here against our own verified cached runtime instead of trusting it.
    ordered_movies = [
        m for m in ordered_movies if _passes_runtime(m, runtime_gte, runtime_lte)
    ]
    picked_movies = diversify(ordered_movies, BATCH_SIZE)

    results = []
    for movie in picked_movies:
        entry = {
            "tmdb_id": movie["id"],
            "title": movie["title"],
            "release_date": movie["release_date"].isoformat() if movie["release_date"] else None,
            "poster_path": movie["poster_path"],
            "synopsis": movie["synopsis"],
            "director": movie["director"],
            "genres": movie["genres"],
            "main_cast": movie["main_cast"],
            "runtime_minutes": movie["runtime_minutes"],
            "imdb_rating": movie["imdb_rating"] or movie["tmdb_rating"],
            "rotten_tomatoes_rating": movie["rotten_tomatoes_rating"],
            "match_pct": None,
            "predicted_rating": None,
        }
        if user_id and taste_vector is not None:
            vector = vectorize_movie(movie)
            match_pct = compute_match_percentage(taste_vector, vector)
            predicted_rating, _ = predict_rating_with_model(
                model, rated_movies, vector, match_pct, movie
            )
            entry["match_pct"] = match_pct
            entry["predicted_rating"] = predicted_rating
        results.append(entry)

    return results
