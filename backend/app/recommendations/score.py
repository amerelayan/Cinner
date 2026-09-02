"""Turns a user's taste vector and a candidate movie into two numbers people
actually care about — Match % and Predicted Rating — plus a short, honest
explanation of why.

Two clearly separate ideas, on purpose:
    Match %            how well this movie fits their known taste overall
                        (cosine similarity between two vectors)
    Predicted Rating    the actual 1-10 score we think they'd give it
                        (a small per-user regression model, when there's
                        enough rating history to train one — otherwise a
                        documented, honest fallback)
"""

import numpy as np
from sklearn.linear_model import Ridge

MIN_RATINGS_FOR_REGRESSION = 5
FALLBACK_BASELINE_RATING = 6.5

# Small-sample, high-dimensional regression (a handful of ratings against a
# 114-dimension feature space) overfits and extrapolates wildly without
# strong regularization — this alpha trades some fit for a much more
# trustworthy prediction once ratings are still scarce.
RIDGE_ALPHA = 5.0

# Same idea as IMDB's own weighted-rating formula: a movie's own worldwide
# TMDB score is only as trustworthy as the number of people who voted on it.
# BAYESIAN_VOTE_WEIGHT is "how many votes worth of trust" a neutral prior
# gets — a movie with far fewer votes than that gets pulled hard toward the
# prior; one with far more is trusted almost at face value.
QUALITY_PRIOR_MEAN = 6.5
QUALITY_PRIOR_VOTE_WEIGHT = 200.0


def _quality_anchor(movie: dict) -> float:
    """The movie's own worldwide reception, independent of any one user's
    taste — used to keep Predicted Rating grounded in reality, especially
    when we don't yet have enough personal data to trust a learned model.
    Prefers the real IMDb rating (via OMDb) when we have it, since it's a
    more widely-trusted "is this actually good" signal than TMDB's own —
    falling back to TMDB's rating for movies OMDb has no match for."""
    imdb_rating = movie.get("imdb_rating")
    rating = float(imdb_rating) if imdb_rating else float(movie.get("tmdb_rating") or 0)
    vote_count = float(movie.get("vote_count") or 0)
    if rating <= 0:
        return QUALITY_PRIOR_MEAN
    return (vote_count * rating + QUALITY_PRIOR_VOTE_WEIGHT * QUALITY_PRIOR_MEAN) / (
        vote_count + QUALITY_PRIOR_VOTE_WEIGHT
    )


# Cosine similarity ranges -1..1 in theory, but in this 114-dimension space
# it never gets close to using that full range in practice, in either
# direction. Checked directly: even a real user's own literal favorite
# (a movie that helped build their taste vector) only reached cosine 0.79,
# and a genuinely mismatched movie (a modern blockbuster against a classic-
# crime-leaning taste) still scored 0.31 — not near 0. That's not a bug in
# any one movie; with 114 sparse dimensions, two *different* movies (even a
# person's own favorite vs. their own taste vector) essentially never align
# perfectly, and a completely unrelated movie still shares some baseline
# (language, being a movie at all, moderate popularity). Naively rescaling
# either the full -1..1 range or a clamped 0..1 range still compresses every
# real result into a narrow, high-looking band. These bounds are calibrated
# to where real cosine values actually land, so a genuine best-possible
# match reads near 100 and a genuinely poor one reads convincingly low
# instead of merely "less high."
MATCH_COSINE_FLOOR = 0.2
MATCH_COSINE_CEILING = 0.8


def compute_match_percentage(taste_vector: np.ndarray, movie_vector: np.ndarray) -> float:
    taste_norm = np.linalg.norm(taste_vector)
    movie_norm = np.linalg.norm(movie_vector)
    if taste_norm == 0 or movie_norm == 0:
        return 0.0

    cosine = float(np.dot(taste_vector, movie_vector) / (taste_norm * movie_norm))
    stretched = (cosine - MATCH_COSINE_FLOOR) / (MATCH_COSINE_CEILING - MATCH_COSINE_FLOOR)
    return round(max(0.0, min(1.0, stretched)) * 100, 1)


def fit_rating_model(rated_movies: list[tuple[np.ndarray, float]]) -> Ridge | None:
    """Fits the per-user regression once, so scoring many candidate movies
    (e.g. an entire For You page) reuses one fitted model instead of
    refitting it from scratch for every single candidate."""
    if len(rated_movies) < MIN_RATINGS_FOR_REGRESSION:
        return None
    X = np.array([vector for vector, _ in rated_movies])
    y = np.array([rating for _, rating in rated_movies])
    model = Ridge(alpha=RIDGE_ALPHA)
    model.fit(X, y)
    return model


def predict_rating_with_model(
    model: Ridge | None,
    rated_movies: list[tuple[np.ndarray, float]],
    movie_vector: np.ndarray,
    match_pct: float,
    movie: dict,
) -> tuple[float, str]:
    """Returns (predicted_rating, method) — method is "regression" when a
    fitted model is available, "fallback" otherwise, so callers/UI can be
    honest about which one produced the number.

    Both branches blend in the movie's own worldwide TMDB score (see
    _quality_anchor) rather than relying purely on the personal signal. This
    matters most for the regression branch: Ridge is fit to minimize error
    against the user's past ratings, so if those ratings have little or no
    spread (e.g. someone has only ever rated movies 9 or 10 so far), there is
    nothing in the data for the model to learn a *difference* from — the
    mathematically correct fit degenerates to predicting that same constant
    for every movie, regardless of the movie's actual features. Weighting the
    personal prediction by how much real variance it was trained on (and
    otherwise leaning on the movie's real-world reception) keeps predictions
    grounded until there's enough personal signal to trust on its own.
    """
    quality_anchor = _quality_anchor(movie)

    if model is not None:
        raw_prediction = float(model.predict(movie_vector.reshape(1, -1))[0])

        ratings = [rating for _, rating in rated_movies]
        rating_spread = float(np.std(ratings))
        # A 2-point spread (e.g. rating movies anywhere from 6 to 8) is
        # treated as "plenty of variety to learn from"; less than that scales
        # trust in the model down smoothly rather than as a hard cutoff.
        variance_confidence = min(1.0, rating_spread / 2.0)
        personal_weight = 0.3 + 0.55 * variance_confidence  # ranges 0.3-0.85

        predicted = personal_weight * raw_prediction + (1 - personal_weight) * quality_anchor
        return round(min(10.0, max(1.0, predicted)), 1), "regression"

    baseline = (
        float(np.mean([rating for _, rating in rated_movies]))
        if rated_movies
        else FALLBACK_BASELINE_RATING
    )
    # Not enough ratings yet to trust a fitted model — nudge their own average
    # (or a neutral baseline, if they have no ratings at all) up or down by
    # how well this movie matches their taste, capped at +/-2 points so a
    # single data point can't swing the estimate to the extremes.
    adjustment = (match_pct - 50) / 50 * 2.0
    personal_guess = baseline + adjustment
    predicted = 0.5 * personal_guess + 0.5 * quality_anchor
    return round(min(10.0, max(1.0, predicted)), 1), "fallback"


def predict_rating(
    rated_movies: list[tuple[np.ndarray, float]],
    movie_vector: np.ndarray,
    match_pct: float,
    movie: dict,
) -> tuple[float, str]:
    """Convenience wrapper for scoring a single movie (fits and predicts in
    one call) — see fit_rating_model/predict_rating_with_model for scoring
    many candidates against one fitted model."""
    model = fit_rating_model(rated_movies)
    return predict_rating_with_model(model, rated_movies, movie_vector, match_pct, movie)


def explain_match(movie: dict, profile: dict, reference_movies: list[dict]) -> list[str]:
    """Short, honest reasons for the score — each one backed by an actual
    comparison against real data, not a canned line."""
    reasons: list[str] = []

    preferred_genres = set(profile.get("preferred_genres") or [])
    shared_genres = preferred_genres & set(movie.get("genres") or [])
    if shared_genres:
        reasons.append(f"Matches your taste for {', '.join(sorted(shared_genres))}")

    if movie.get("director"):
        same_director = next(
            (ref["title"] for ref in reference_movies if ref.get("director") == movie["director"]),
            None,
        )
        if same_director:
            reasons.append(f"Directed by {movie['director']}, who also made {same_director}")

    movie_cast = set(movie.get("main_cast") or [])
    for ref in reference_movies:
        shared_cast = movie_cast & set(ref.get("main_cast") or [])
        if shared_cast:
            reasons.append(f"Features {sorted(shared_cast)[0]}, also in {ref['title']}")
            break

    acclaimed_rating = movie.get("imdb_rating") or movie.get("tmdb_rating")
    if (
        profile.get("prefers_imdb_top_250")
        and (movie.get("vote_count") or 0) >= 5000
        and float(acclaimed_rating or 0) >= 7.5
    ):
        reasons.append("A widely acclaimed classic, matching your love of critically-rated films")

    return reasons[:3]
