"""Turns a movie's metadata into a fixed-length numeric feature vector.

Every movie is represented the same way regardless of how much data TMDB has
for it, so any two movies' vectors can be compared directly (e.g. via cosine
similarity, added in a later step) to answer "how alike are these two movies".

Vector layout (114 dimensions total):
    genres      19 dims  - multi-hot over TMDB's 19 canonical genres           (weight 1.0)
    language    10 dims  - one-hot over a fixed set of common languages,
                           plus "other"                                        (weight 1.0)
    numeric      5 dims  - release year, runtime, vote count, popularity,
                           TMDB rating (all normalized to roughly 0-1)          (weight 2.0)
    director    16 dims  - hashed                                              (weight 0.5)
    cast        32 dims  - hashed                                              (weight 0.5)
    keywords    32 dims  - hashed                                              (weight 1.0)

Raw dimension count isn't the same as actual influence on cosine similarity —
cast and keywords together are 64 of 114 dimensions and tend to have several
non-zero entries each, while numeric is just 5 single values, so without
correction cast/keyword overlap quietly dominates more meaningful signals
like genre or rating. DIMENSION_WEIGHTS corrects this explicitly rather than
leaving it as an accident of the encoding scheme.

Cast, director, and keywords use the "hashing trick": each name/tag is mapped
into one of a small fixed number of buckets via a hash function, rather than
built from a real vocabulary. New actors and keywords appear constantly, and a
fixed one-hot vocabulary would either need retraining or silently ignore
anything it hadn't seen before — hashing sidesteps that entirely.
"""

import hashlib

import numpy as np

from app.tmdb import VALID_GENRES

LANGUAGES = ["en", "ko", "ja", "fr", "es", "hi", "zh", "de", "it"]
LANGUAGE_DIMS = len(LANGUAGES) + 1  # + one "other" bucket

DIRECTOR_DIMS = 16
CAST_DIMS = 32
KEYWORD_DIMS = 32
NUMERIC_DIMS = 5

VECTOR_DIMS = (
    len(VALID_GENRES) + LANGUAGE_DIMS + NUMERIC_DIMS + DIRECTOR_DIMS + CAST_DIMS + KEYWORD_DIMS
)

MIN_YEAR = 1920
MAX_YEAR = 2030
MAX_RUNTIME_MINUTES = 240
MAX_VOTE_COUNT = 50_000
MAX_POPULARITY = 500

# Raw dimension COUNT doesn't equal actual influence on cosine similarity —
# cast and keywords together are 64 of 114 dimensions and tend to have
# several non-zero entries each (5 cast members, many keywords), while the
# numeric block is just 5 single values, so cast/keyword overlap was quietly
# dominating match scores over more meaningful signals like genre or rating.
# These multipliers correct that directly: numeric counts for more, cast and
# director for less. Applied to the whole 114-dim vector as one weight mask,
# used identically for both real movie vectors (vectorize_movie) and the
# synthetic onboarding-preference vector (taste.py's _encode_preferences) —
# they have to share the same per-dimension scale or cosine similarity
# between a taste vector and a movie vector stops being meaningful.
GENRE_WEIGHT = 1.0
LANGUAGE_WEIGHT = 1.0
NUMERIC_WEIGHT = 2.0
DIRECTOR_WEIGHT = 0.5
CAST_WEIGHT = 0.5
KEYWORD_WEIGHT = 1.0

DIMENSION_WEIGHTS = np.concatenate(
    [
        np.full(len(VALID_GENRES), GENRE_WEIGHT),
        np.full(LANGUAGE_DIMS, LANGUAGE_WEIGHT),
        np.full(NUMERIC_DIMS, NUMERIC_WEIGHT),
        np.full(DIRECTOR_DIMS, DIRECTOR_WEIGHT),
        np.full(CAST_DIMS, CAST_WEIGHT),
        np.full(KEYWORD_DIMS, KEYWORD_WEIGHT),
    ]
)


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _hash_bucket_and_sign(token: str, dims: int) -> tuple[int, float]:
    digest = hashlib.md5(token.strip().lower().encode()).hexdigest()
    bucket = int(digest[:8], 16) % dims
    # A second slice of the same hash decides the sign, so two different names
    # that happen to land in the same bucket partially cancel out instead of
    # just stacking — that keeps one lucky collision from looking like a much
    # stronger signal than it actually is.
    sign = 1.0 if int(digest[8:16], 16) % 2 == 0 else -1.0
    return bucket, sign


def _hashed_encode(tokens: list[str], dims: int) -> np.ndarray:
    vector = np.zeros(dims)
    for token in tokens:
        if not token:
            continue
        bucket, sign = _hash_bucket_and_sign(token, dims)
        vector[bucket] += sign
    return vector


def _encode_genres(genres: list[str] | None) -> np.ndarray:
    vector = np.zeros(len(VALID_GENRES))
    for genre in genres or []:
        if genre in VALID_GENRES:
            vector[VALID_GENRES.index(genre)] = 1.0
    return vector


def _encode_language(language: str | None) -> np.ndarray:
    vector = np.zeros(LANGUAGE_DIMS)
    if language in LANGUAGES:
        vector[LANGUAGES.index(language)] = 1.0
    else:
        vector[-1] = 1.0
    return vector


def _encode_numeric(movie: dict) -> np.ndarray:
    release_date = movie.get("release_date")
    year = release_date.year if release_date else MIN_YEAR

    year_norm = _clamp01((year - MIN_YEAR) / (MAX_YEAR - MIN_YEAR))
    runtime_norm = _clamp01((movie.get("runtime_minutes") or 0) / MAX_RUNTIME_MINUTES)
    vote_count_norm = _clamp01(
        np.log1p(movie.get("vote_count") or 0) / np.log1p(MAX_VOTE_COUNT)
    )
    popularity_norm = _clamp01(
        np.log1p(movie.get("popularity") or 0) / np.log1p(MAX_POPULARITY)
    )
    rating_norm = _clamp01(float(movie.get("tmdb_rating") or 0) / 10)

    return np.array([year_norm, runtime_norm, vote_count_norm, popularity_norm, rating_norm])


def vectorize_movie(movie: dict) -> np.ndarray:
    """Build a movie's feature vector.

    `movie` should have the same shape as a row from the `movies` table:
    genres, main_cast, director, language, release_date, runtime_minutes,
    vote_count, popularity, tmdb_rating, keywords.
    """
    director = [movie["director"]] if movie.get("director") else []

    raw = np.concatenate(
        [
            _encode_genres(movie.get("genres")),
            _encode_language(movie.get("language")),
            _encode_numeric(movie),
            _hashed_encode(director, DIRECTOR_DIMS),
            _hashed_encode(movie.get("main_cast") or [], CAST_DIMS),
            _hashed_encode(movie.get("keywords") or [], KEYWORD_DIMS),
        ]
    )
    return raw * DIMENSION_WEIGHTS
