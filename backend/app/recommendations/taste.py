"""Builds a user's "taste vector" — a point in the same 114-dimension space
movies live in (see vectorize.py), but representing what this person tends to
like, so any movie's vector can be compared directly against it.

Built from everything they've told us, weighted by how strong a signal each
source is:
    ratings              weight -1..1  (scaled from the rating itself, so a
                                         bad rating pulls the taste vector
                                         away from that movie's features, not
                                         just less toward them)
    favorites            weight  1.0   (picked on purpose, no ambiguity)
    watched (unrated)    weight  0.3   (finished it — a mild positive signal)
    watchlist            weight  0.15  (interested, but unconfirmed)
    onboarding answers   weight  0.5   (their stated genre/era/prestige
                                         preferences, encoded as a synthetic
                                         "movie" in the same vector space)

A movie that shows up in more than one of these — e.g. both favorited and
separately rated — only counts once, via whichever is the strongest signal
(rating beats favorite beats watched beats watchlist), so conflicting
signals about the same movie can't double-count.

gather_user_taste() is the one entry point this module is meant to be used
through: it fetches everything above in 3 database round trips total rather
than the 8 an earlier version needed (a separate query per table, plus a
second, overlapping fetch for the ratings used to train the predicted-rating
model). Each round trip to a remote database has real, compounding latency,
so this mattered more than the vector math itself once measured.
"""

import numpy as np

from app.recommendations.vectorize import LANGUAGE_DIMS, VECTOR_DIMS, _encode_genres, vectorize_movie
from app.tmdb import VALID_GENRES

FAVORITE_WEIGHT = 1.0
WATCHED_WEIGHT = 0.3
WATCHLIST_WEIGHT = 0.15
PREFERENCE_WEIGHT = 0.5

GENRE_DIMS = len(VALID_GENRES)
NUMERIC_START = GENRE_DIMS + LANGUAGE_DIMS

# Maps the onboarding era question onto the same 0-1 recency scale
# vectorize.py normalizes real release years into. "no_preference" is left
# out entirely rather than mapped to a mid-point, since it's a statement of
# indifference, not a preference for medium-aged movies.
ERA_TO_RECENCY = {
    "new": 1.0,
    "last_5_years": 0.9,
    "last_10_years": 0.8,
    "last_20_years": 0.65,
    "25_plus_years": 0.3,
}


def _rating_weight(rating: float) -> float:
    """Rescales the 1-10 rating scale to roughly -1..1 around a neutral 5.5."""
    return (rating - 5.5) / 4.5


def _encode_preferences(profile: dict) -> np.ndarray:
    """Turns the onboarding answers into a vector in the same space as a real
    movie, so they blend into the taste vector like any other signal, just
    with their own weight."""
    vector = np.zeros(VECTOR_DIMS)
    vector[:GENRE_DIMS] = _encode_genres(profile.get("preferred_genres"))

    recency = ERA_TO_RECENCY.get(profile.get("preferred_movie_age"))
    if recency is not None:
        vector[NUMERIC_START] = recency  # numeric block position 0 = release year

    if profile.get("prefers_imdb_top_250"):
        # Numeric block positions 2 and 4 are vote_count and tmdb_rating — a
        # stated taste for acclaimed classics nudges toward high-vote,
        # high-rating movies. Left neutral (not penalized) when False, since
        # "no" just means it isn't a stated priority, not that they dislike them.
        vector[NUMERIC_START + 2] = 0.9
        vector[NUMERIC_START + 4] = 0.9

    return vector


async def _fetch_user_interactions(conn, user_id: str) -> dict:
    """Every table a taste profile draws from, in one round trip instead of
    four, tagged by source so the caller can split them back apart."""
    rows = await conn.fetch(
        """
        SELECT movie_id, 'favorite' AS source, NULL::numeric AS rating
            FROM public.favorites WHERE user_id = $1
        UNION ALL
        SELECT movie_id, 'rating' AS source, rating
            FROM public.ratings WHERE user_id = $1
        UNION ALL
        SELECT movie_id, 'watched' AS source, NULL
            FROM public.watched WHERE user_id = $1
        UNION ALL
        SELECT movie_id, 'watchlist' AS source, NULL
            FROM public.watchlist WHERE user_id = $1
        """,
        user_id,
    )
    return {
        "favorites": {r["movie_id"] for r in rows if r["source"] == "favorite"},
        "ratings": {r["movie_id"]: float(r["rating"]) for r in rows if r["source"] == "rating"},
        "watched": {r["movie_id"] for r in rows if r["source"] == "watched"},
        "watchlist": {r["movie_id"] for r in rows if r["source"] == "watchlist"},
    }


def _build_taste_vector(
    interactions: dict, movie_vectors: dict[int, np.ndarray], profile: dict | None
) -> np.ndarray:
    weighted_vectors: list[tuple[np.ndarray, float]] = []
    rated_ids = set(interactions["ratings"])

    for movie_id, rating in interactions["ratings"].items():
        if movie_id in movie_vectors:
            weighted_vectors.append((movie_vectors[movie_id], _rating_weight(rating)))

    for movie_id in interactions["favorites"] - rated_ids:
        if movie_id in movie_vectors:
            weighted_vectors.append((movie_vectors[movie_id], FAVORITE_WEIGHT))

    for movie_id in interactions["watched"] - rated_ids - interactions["favorites"]:
        if movie_id in movie_vectors:
            weighted_vectors.append((movie_vectors[movie_id], WATCHED_WEIGHT))

    for movie_id in (
        interactions["watchlist"] - rated_ids - interactions["favorites"] - interactions["watched"]
    ):
        if movie_id in movie_vectors:
            weighted_vectors.append((movie_vectors[movie_id], WATCHLIST_WEIGHT))

    if profile is not None:
        weighted_vectors.append((_encode_preferences(profile), PREFERENCE_WEIGHT))

    if not weighted_vectors:
        return np.zeros(VECTOR_DIMS)

    total = np.zeros(VECTOR_DIMS)
    weight_sum = 0.0
    for vector, weight in weighted_vectors:
        total += weight * vector
        weight_sum += abs(weight)

    return total / weight_sum if weight_sum > 0 else total


async def gather_user_taste(
    conn, user_id: str
) -> tuple[np.ndarray, list[tuple[np.ndarray, float]], dict | None]:
    """Everything a match calculation needs about a user: their taste vector,
    the (movie vector, rating) pairs used to train the predicted-rating
    model, and their raw profile (reused for match-reason explanations) —
    built from one shared fetch instead of three separate, overlapping ones
    that each queried the profile and/or ratings and movies on their own."""
    profile_row = await conn.fetchrow(
        """
        SELECT preferred_genres, preferred_movie_age, prefers_imdb_top_250
        FROM public.profiles WHERE id = $1
        """,
        user_id,
    )
    profile = dict(profile_row) if profile_row else None
    interactions = await _fetch_user_interactions(conn, user_id)

    all_ids = (
        interactions["favorites"]
        | set(interactions["ratings"])
        | interactions["watched"]
        | interactions["watchlist"]
    )
    movie_vectors: dict[int, np.ndarray] = {}
    if all_ids:
        rows = await conn.fetch(
            """
            SELECT id, genres, main_cast, director, language, release_date,
                   runtime_minutes, vote_count, popularity, tmdb_rating, keywords
            FROM public.movies WHERE id = ANY($1::int[])
            """,
            list(all_ids),
        )
        movie_vectors = {r["id"]: vectorize_movie(dict(r)) for r in rows}

    taste_vector = _build_taste_vector(interactions, movie_vectors, profile)
    rated_movies = [
        (movie_vectors[movie_id], rating)
        for movie_id, rating in interactions["ratings"].items()
        if movie_id in movie_vectors
    ]

    return taste_vector, rated_movies, profile


async def get_reference_movies(conn, user_id: str) -> list[dict]:
    """Favorites and highly-rated movies (8+), used to explain a match in
    terms of real overlap — "also directed by...", "also stars..."."""
    rows = await conn.fetch(
        """
        SELECT DISTINCT m.title, m.director, m.main_cast
        FROM public.movies m
        WHERE m.id IN (
            SELECT movie_id FROM public.favorites WHERE user_id = $1
            UNION
            SELECT movie_id FROM public.ratings WHERE user_id = $1 AND rating >= 8
        )
        """,
        user_id,
    )
    return [dict(r) for r in rows]
