"""Builds the "For You" page: five ranked lists of recommendations, each
scored with the same Match %/Predicted Rating pipeline used on individual
movie pages — but the expensive per-user parts (the taste vector, the fitted
rating model) happen once per page load, not once per candidate movie.

Candidate generation leans on TMDB doing the broad filtering (genre, vote
count band, "people who liked this also liked") via /discover and
/recommendations, so our own scoring only has to rank a small, already
relevant pool rather than TMDB's entire catalog.
"""

import asyncio
from collections import Counter

from app.recommendations.score import (
    compute_match_percentage,
    fit_rating_model,
    predict_rating_with_model,
)
from app.recommendations.taste import gather_user_taste
from app.recommendations.vectorize import vectorize_movie
from app.tmdb import (
    GENRE_NAME_TO_TMDB_ID,
    ensure_movies_cached_bulk,
    fetch_discover_by_genres,
    fetch_recommendations,
)

SECTION_SIZE = 8
DEFAULT_GENRE_IDS = list(GENRE_NAME_TO_TMDB_ID.values())[:3]


async def _score_pool(
    pool,
    candidates: list[dict],
    exclude_ids: set[int],
    taste_vector,
    rated_movies,
    model,
) -> list[dict]:
    seen: set[int] = set()
    candidate_ids = []
    for c in candidates:
        tmdb_id = c["tmdb_id"]
        if tmdb_id in exclude_ids or tmdb_id in seen:
            continue
        seen.add(tmdb_id)
        candidate_ids.append(tmdb_id)

    if not candidate_ids:
        return []

    await ensure_movies_cached_bulk(pool, candidate_ids)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, title, release_date, poster_path, genres, main_cast, director,
                   language, runtime_minutes, vote_count, popularity, tmdb_rating, keywords
            FROM public.movies WHERE id = ANY($1::int[])
            """,
            candidate_ids,
        )

    scored = []
    for row in rows:
        movie = dict(row)
        vector = vectorize_movie(movie)
        match_pct = compute_match_percentage(taste_vector, vector)
        predicted_rating, _ = predict_rating_with_model(model, rated_movies, vector, match_pct)
        scored.append(
            {
                "tmdb_id": movie["id"],
                "title": movie["title"],
                "release_date": movie["release_date"].isoformat() if movie["release_date"] else None,
                "poster_path": movie["poster_path"],
                "match_pct": match_pct,
                "predicted_rating": predicted_rating,
            }
        )

    scored.sort(key=lambda m: m["match_pct"], reverse=True)
    return scored[:SECTION_SIZE]


async def build_for_you(pool, user_id: str) -> dict:
    async with pool.acquire() as conn:
        favorites = await conn.fetch(
            """
            SELECT f.movie_id, m.title, m.genres FROM public.favorites f
            JOIN public.movies m ON m.id = f.movie_id
            WHERE f.user_id = $1 ORDER BY f.created_at
            """,
            user_id,
        )
        top_rated = await conn.fetchrow(
            """
            SELECT r.movie_id, m.title FROM public.ratings r
            JOIN public.movies m ON m.id = r.movie_id
            WHERE r.user_id = $1 ORDER BY r.rating DESC LIMIT 1
            """,
            user_id,
        )
        highly_rated_genres = await conn.fetch(
            """
            SELECT m.genres FROM public.ratings r
            JOIN public.movies m ON m.id = r.movie_id
            WHERE r.user_id = $1 AND r.rating >= 7
            """,
            user_id,
        )
        exclude_ids = {
            r["movie_id"]
            for r in await conn.fetch(
                """
                SELECT movie_id FROM public.favorites WHERE user_id = $1
                UNION SELECT movie_id FROM public.watched WHERE user_id = $1
                UNION SELECT movie_id FROM public.watchlist WHERE user_id = $1
                UNION SELECT movie_id FROM public.ratings WHERE user_id = $1
                """,
                user_id,
            )
        }

        taste_vector, rated_movies, profile = await gather_user_taste(conn, user_id)

    model = fit_rating_model(rated_movies)

    # The candidate pool for "Highest Match"/"Hidden Gems" comes from TMDB
    # /discover filtered by genre, so it has to reflect what the user
    # actually likes right now — not just the genres they picked once during
    # onboarding. Otherwise a taste vector that has since shifted (e.g. new
    # favorites in a genre outside the original onboarding picks) can score a
    # movie highly via /match while that same movie never even enters the
    # discover pool these sections rank from. We count genres across current
    # favorites and highly-rated movies, and put those ahead of the
    # onboarding preference (which still matters for someone with few/no
    # favorites yet).
    genre_counts: Counter = Counter()
    for row in favorites:
        for g in row["genres"] or []:
            genre_counts[g] += 1
    for row in highly_rated_genres:
        for g in row["genres"] or []:
            genre_counts[g] += 1

    taste_genre_ids = [
        GENRE_NAME_TO_TMDB_ID[g] for g, _ in genre_counts.most_common(4) if g in GENRE_NAME_TO_TMDB_ID
    ]
    onboarding_genre_ids = [
        GENRE_NAME_TO_TMDB_ID[g]
        for g in ((profile["preferred_genres"] if profile else None) or [])
        if g in GENRE_NAME_TO_TMDB_ID
    ]
    preferred_genre_ids = list(dict.fromkeys(taste_genre_ids + onboarding_genre_ids)) or DEFAULT_GENRE_IDS

    # "Because you liked X" seeds from their single highest-rated movie, or —
    # for someone who hasn't rated anything yet — their first favorite, so
    # the section still has something meaningful to seed from immediately
    # after onboarding.
    seed_row = top_rated or (favorites[0] if favorites else None)
    because_you_liked_title = seed_row["title"] if seed_row else None

    # Fetching each section's candidate *list* (cheap, one TMDB call each) is
    # sequenced here for clarity, but the truly expensive part — caching and
    # fully detailing every candidate movie in each pool — happens inside
    # _score_pool. Running all four pools' scoring concurrently (below)
    # rather than one after another is what actually matters for speed: it's
    # the same fix that took the homepage's poster wall from ~9s to ~2s,
    # applied one level up.
    genre_pool, hidden_gems_pool, favorite_recs_lists, seed_recs = await asyncio.gather(
        fetch_discover_by_genres(preferred_genre_ids, vote_count_gte=200),
        fetch_discover_by_genres(
            preferred_genre_ids, vote_count_gte=50, vote_count_lte=2000, vote_average_gte=6.5
        ),
        asyncio.gather(*(fetch_recommendations(row["movie_id"]) for row in favorites[:5])),
        fetch_recommendations(seed_row["movie_id"]) if seed_row else asyncio.sleep(0, result=[]),
    )
    favorite_recs = [movie for recs in favorite_recs_lists for movie in recs]

    genre_scored, based_on_favorites, because_you_liked, hidden_gems = await asyncio.gather(
        _score_pool(pool, genre_pool, exclude_ids, taste_vector, rated_movies, model),
        _score_pool(pool, favorite_recs, exclude_ids, taste_vector, rated_movies, model),
        _score_pool(pool, seed_recs, exclude_ids, taste_vector, rated_movies, model),
        _score_pool(pool, hidden_gems_pool, exclude_ids, taste_vector, rated_movies, model),
    )

    # "Highest Match" and "Rate Highly" are meant to surface the single best
    # score across everything scored this page load — not just the
    # genre-discover pool. That pool alone is popularity-sorted and only one
    # page deep, so it systematically misses movies that TMDB's own
    # per-favorite recommendations surface instead (e.g. an older sequel a
    # fan of the original would love, but that isn't "trending" right now).
    # We merge every already-scored pool and re-rank, so a high match found
    # via any source can appear here.
    combined: dict[int, dict] = {}
    for scored in (genre_scored, based_on_favorites, because_you_liked, hidden_gems):
        for movie in scored:
            existing = combined.get(movie["tmdb_id"])
            if existing is None or movie["match_pct"] > existing["match_pct"]:
                combined[movie["tmdb_id"]] = movie

    highest_match = sorted(combined.values(), key=lambda m: m["match_pct"], reverse=True)[:SECTION_SIZE]
    rate_highly = sorted(combined.values(), key=lambda m: m["predicted_rating"], reverse=True)[:SECTION_SIZE]

    return {
        "highest_match": highest_match,
        "rate_highly": rate_highly,
        "based_on_favorites": based_on_favorites,
        "because_you_liked": {"seed_title": because_you_liked_title, "movies": because_you_liked},
        "hidden_gems": hidden_gems,
    }
