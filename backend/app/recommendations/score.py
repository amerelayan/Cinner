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


def compute_match_percentage(taste_vector: np.ndarray, movie_vector: np.ndarray) -> float:
    taste_norm = np.linalg.norm(taste_vector)
    movie_norm = np.linalg.norm(movie_vector)
    if taste_norm == 0 or movie_norm == 0:
        return 0.0

    cosine = float(np.dot(taste_vector, movie_vector) / (taste_norm * movie_norm))
    # Cosine similarity ranges -1..1; movie vectors are mostly non-negative so
    # in practice this rarely goes very negative, but clamp before rescaling
    # to 0-100 so a genuinely opposite match still reads as a low percentage
    # rather than a nonsensical negative one.
    return round(max(0.0, min(1.0, (cosine + 1) / 2)) * 100, 1)


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
) -> tuple[float, str]:
    """Returns (predicted_rating, method) — method is "regression" when a
    fitted model is available, "fallback" otherwise, so callers/UI can be
    honest about which one produced the number."""
    if model is not None:
        predicted = float(model.predict(movie_vector.reshape(1, -1))[0])
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
    predicted = min(10.0, max(1.0, baseline + adjustment))
    return round(predicted, 1), "fallback"


def predict_rating(
    rated_movies: list[tuple[np.ndarray, float]],
    movie_vector: np.ndarray,
    match_pct: float,
) -> tuple[float, str]:
    """Convenience wrapper for scoring a single movie (fits and predicts in
    one call) — see fit_rating_model/predict_rating_with_model for scoring
    many candidates against one fitted model."""
    model = fit_rating_model(rated_movies)
    return predict_rating_with_model(model, rated_movies, movie_vector, match_pct)


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

    if (
        profile.get("prefers_imdb_top_250")
        and (movie.get("vote_count") or 0) >= 5000
        and float(movie.get("tmdb_rating") or 0) >= 7.5
    ):
        reasons.append("A widely acclaimed classic, matching your love of critically-rated films")

    return reasons[:3]
