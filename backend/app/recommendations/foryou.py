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
from datetime import date

from app.recommendations.diversity import diversify
from app.recommendations.era import era_to_date_range
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

# "Highest Match" and "Rate Highly" are meant to be movies worth actually
# watching, not just movies that share genre/cast/era patterns with your
# taste — Match % alone can't tell a beloved classic from a widely-seen dud
# that happens to overlap on paper, since TMDB rating is only 1 of 114
# vector dimensions and gets drowned out by the ~64 hashed cast/keyword
# dimensions. A hard floor keeps genuinely poorly-reviewed movies out of
# these two sections entirely, rather than just ranking them lower.
HIGHEST_MATCH_MIN_RATING = 6.0
HIGHEST_MATCH_MIN_VOTES = 200
# Used instead of the floor above when the user has said (at onboarding)
# that they specifically care about critically-acclaimed movies — "prefers
# high-rated movies" should mean something stronger than the default floor,
# not the same threshold as everyone else.
ACCLAIMED_MIN_RATING = 7.0

# Real behavior needs at least this many dated movies before it's trusted to
# override the onboarding era answer — mirrors the same threshold idea used
# for genre and prestige-affinity elsewhere in this module/taste.py.
MIN_ENGAGED_FOR_EMPIRICAL_ERA = 3
# How much newer than the median a candidate is still allowed to be — a
# person whose real history centers on 2005 clearly isn't limited to *only*
# 2005, so this gives room above the median rather than a hard cutoff at it.
EMPIRICAL_ERA_HEADROOM_YEARS = 8


def _empirical_release_date_ceiling(release_dates: list) -> str | None:
    """If real behavior (favorites, highly-rated, watched) clearly skews
    older, cap the candidate pool's release date so "Highest Match" can't be
    dominated by whatever's currently popular and new — which is exactly
    what TMDB's own popularity-sorted /discover otherwise tends to surface,
    regardless of what a person's actual history looks like. This is a real
    filter on which movies are even considered, not just one diluted number
    inside the 114-dimension taste vector."""
    years = sorted(d.year for d in release_dates if d)
    if len(years) < MIN_ENGAGED_FOR_EMPIRICAL_ERA:
        return None
    median_year = years[len(years) // 2]
    ceiling_year = min(median_year + EMPIRICAL_ERA_HEADROOM_YEARS, date.today().year)
    return date(ceiling_year, 12, 31).isoformat()


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
                   language, runtime_minutes, vote_count, popularity, tmdb_rating, imdb_rating,
                   collection_id, keywords
            FROM public.movies WHERE id = ANY($1::int[])
            """,
            candidate_ids,
        )

    scored = []
    for row in rows:
        movie = dict(row)
        vector = vectorize_movie(movie)
        match_pct = compute_match_percentage(taste_vector, vector)
        predicted_rating, _ = predict_rating_with_model(model, rated_movies, vector, match_pct, movie)
        scored.append(
            {
                "tmdb_id": movie["id"],
                "title": movie["title"],
                "release_date": movie["release_date"].isoformat() if movie["release_date"] else None,
                "poster_path": movie["poster_path"],
                "match_pct": match_pct,
                "predicted_rating": predicted_rating,
                "tmdb_rating": movie["tmdb_rating"],
                "imdb_rating": movie["imdb_rating"],
                "vote_count": movie["vote_count"],
                "collection_id": movie["collection_id"],
            }
        )

    scored.sort(key=lambda m: m["match_pct"], reverse=True)
    # Caps how many results from the same franchise/series can appear in one
    # section — otherwise the top of a ranked-by-similarity list tends to
    # cluster around whichever series scores highest (e.g. every Batman movie
    # a user has shown interest in), which reads as repetitive rather than
    # genuinely varied even though each individual pick is a fair match.
    return diversify(scored, SECTION_SIZE)


async def build_for_you(pool, user_id: str) -> dict:
    async with pool.acquire() as conn:
        favorites = await conn.fetch(
            """
            SELECT f.movie_id, m.title, m.genres, m.release_date FROM public.favorites f
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
        highly_rated = await conn.fetch(
            """
            SELECT m.genres, m.release_date FROM public.ratings r
            JOIN public.movies m ON m.id = r.movie_id
            WHERE r.user_id = $1 AND r.rating >= 7
            """,
            user_id,
        )
        watched_dates = await conn.fetch(
            """
            SELECT m.release_date FROM public.watched w
            JOIN public.movies m ON m.id = w.movie_id
            WHERE w.user_id = $1
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
    for row in highly_rated:
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

    # Same "real behavior over a one-time onboarding answer" precedent as
    # genre above, applied to era — previously era only ever came from the
    # onboarding question (often "no_preference", meaning no signal at all)
    # and only ever nudged one diluted vector dimension, never actually
    # filtered which movies got fetched as candidates in the first place.
    engaged_release_dates = (
        [row["release_date"] for row in favorites]
        + [row["release_date"] for row in highly_rated]
        + [row["release_date"] for row in watched_dates]
    )
    empirical_date_lte = _empirical_release_date_ceiling(engaged_release_dates)
    onboarding_date_gte, onboarding_date_lte = era_to_date_range(
        profile["preferred_movie_age"] if profile else None
    )
    release_date_lte = empirical_date_lte or onboarding_date_lte
    release_date_gte = onboarding_date_gte if empirical_date_lte is None else None

    # A stated preference for critically-acclaimed movies should mean a
    # meaningfully higher bar and a pool actually sorted by quality — not
    # just the same floor everyone else gets.
    prefers_acclaimed = bool(profile and profile.get("prefers_imdb_top_250"))
    genre_pool_min_rating = ACCLAIMED_MIN_RATING if prefers_acclaimed else HIGHEST_MATCH_MIN_RATING
    genre_pool_sort_by = "vote_average.desc" if prefers_acclaimed else "popularity.desc"

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
        fetch_discover_by_genres(
            preferred_genre_ids,
            vote_count_gte=HIGHEST_MATCH_MIN_VOTES,
            vote_average_gte=genre_pool_min_rating,
            release_date_gte=release_date_gte,
            release_date_lte=release_date_lte,
            sort_by=genre_pool_sort_by,
            pages=2,
        ),
        fetch_discover_by_genres(
            preferred_genre_ids,
            vote_count_gte=50,
            vote_count_lte=2000,
            vote_average_gte=6.5,
            release_date_gte=release_date_gte,
            release_date_lte=release_date_lte,
            pages=2,
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

    # Movies sourced via TMDB's own /recommendations (favorite_recs, seed_recs)
    # can't be pre-filtered by rating OR release date server-side the way the
    # genre-discover pool can, so both are enforced here too, uniformly
    # across every source, right before ranking these two specific sections.
    # Rating prefers the real IMDb rating (via OMDb) when we have it, over
    # TMDB's own. Release-date strings compare correctly as plain strings
    # since they're ISO 8601 (YYYY-MM-DD).
    quality_pool = [
        m
        for m in combined.values()
        if (m["imdb_rating"] or m["tmdb_rating"] or 0) >= genre_pool_min_rating
        and (m["vote_count"] or 0) >= HIGHEST_MATCH_MIN_VOTES
        and (release_date_lte is None or not m["release_date"] or m["release_date"] <= release_date_lte)
        and (release_date_gte is None or not m["release_date"] or m["release_date"] >= release_date_gte)
    ]

    highest_match = diversify(sorted(quality_pool, key=lambda m: m["match_pct"], reverse=True), SECTION_SIZE)
    rate_highly = diversify(
        sorted(quality_pool, key=lambda m: m["predicted_rating"], reverse=True), SECTION_SIZE
    )

    return {
        "highest_match": highest_match,
        "rate_highly": rate_highly,
        "based_on_favorites": based_on_favorites,
        "because_you_liked": {"seed_title": because_you_liked_title, "movies": because_you_liked},
        "hidden_gems": hidden_gems,
    }
