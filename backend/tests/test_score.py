import numpy as np
import pytest

from app.recommendations.score import (
    compute_match_percentage,
    fit_rating_model,
    predict_rating_with_model,
    MIN_RATINGS_FOR_REGRESSION,
)


def _movie(imdb_rating=None, tmdb_rating=7.0, vote_count=1000):
    return {"imdb_rating": imdb_rating, "tmdb_rating": tmdb_rating, "vote_count": vote_count}


def _vector(seed: int, dims: int = 114) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.random(dims)


class TestMatchPercentage:
    def test_identical_vectors_score_100(self):
        v = _vector(1)
        assert compute_match_percentage(v, v) == 100.0

    def test_zero_taste_vector_scores_zero(self):
        taste = np.zeros(114)
        movie = _vector(2)
        assert compute_match_percentage(taste, movie) == 0.0

    def test_zero_movie_vector_scores_zero(self):
        taste = _vector(3)
        movie = np.zeros(114)
        assert compute_match_percentage(taste, movie) == 0.0

    def test_orthogonal_vectors_score_at_or_below_floor(self):
        taste = np.zeros(114)
        taste[0] = 1.0
        movie = np.zeros(114)
        movie[1] = 1.0
        # cosine similarity is 0, which is below MATCH_COSINE_FLOOR (0.2),
        # so it should clamp to the bottom of the scale rather than go negative.
        assert compute_match_percentage(taste, movie) == 0.0

    def test_result_is_always_within_0_to_100(self):
        for seed in range(20):
            taste = _vector(seed)
            movie = _vector(seed + 100)
            pct = compute_match_percentage(taste, movie)
            assert 0.0 <= pct <= 100.0

    def test_more_similar_vectors_score_higher(self):
        taste = np.ones(114)
        close_movie = np.ones(114)
        close_movie[0] = 0.9
        far_movie = np.zeros(114)
        far_movie[0] = 1.0
        assert compute_match_percentage(taste, close_movie) > compute_match_percentage(
            taste, far_movie
        )


class TestPredictRatingFallback:
    """No fitted model yet — fewer than MIN_RATINGS_FOR_REGRESSION ratings."""

    def test_new_user_with_no_ratings_uses_neutral_baseline(self):
        movie = _movie(imdb_rating=None, tmdb_rating=0, vote_count=0)
        predicted, method = predict_rating_with_model(
            model=None,
            rated_movies=[],
            movie_vector=_vector(1),
            match_pct=50.0,
            movie=movie,
        )
        assert method == "fallback"
        # No personal history and no quality signal -> should land near the
        # documented neutral baseline/prior (6.5), not at either extreme.
        assert 5.0 <= predicted <= 8.0

    def test_fallback_never_leaves_1_to_10_range(self):
        movie = _movie(imdb_rating=9.5, tmdb_rating=9.5, vote_count=100000)
        predicted, _ = predict_rating_with_model(
            model=None,
            rated_movies=[(_vector(1), 10.0), (_vector(2), 10.0)],
            movie_vector=_vector(3),
            match_pct=100.0,
            movie=movie,
        )
        assert 1.0 <= predicted <= 10.0

    def test_higher_match_pct_nudges_fallback_prediction_up(self):
        movie = _movie(imdb_rating=7.0, tmdb_rating=7.0, vote_count=1000)
        rated_movies = [(_vector(1), 7.0), (_vector(2), 7.0)]
        low_match, _ = predict_rating_with_model(None, rated_movies, _vector(3), 10.0, movie)
        high_match, _ = predict_rating_with_model(None, rated_movies, _vector(3), 90.0, movie)
        assert high_match > low_match


class TestPredictRatingRegression:
    """Enough ratings to fit a real per-user model."""

    def test_uses_regression_once_enough_ratings_exist(self):
        rated_movies = [(_vector(i), float(5 + (i % 5))) for i in range(MIN_RATINGS_FOR_REGRESSION)]
        model = fit_rating_model(rated_movies)
        assert model is not None
        predicted, method = predict_rating_with_model(
            model, rated_movies, _vector(999), 50.0, _movie()
        )
        assert method == "regression"
        assert 1.0 <= predicted <= 10.0

    def test_no_model_below_minimum_ratings_threshold(self):
        rated_movies = [(_vector(i), 8.0) for i in range(MIN_RATINGS_FOR_REGRESSION - 1)]
        assert fit_rating_model(rated_movies) is None

    def test_low_variance_ratings_still_lean_on_quality_anchor(self):
        """A user who has only ever rated movies 9 or 10 gives Ridge nothing to
        learn a *difference* from — predictions should stay grounded near the
        movie's real-world quality anchor rather than blindly extrapolating."""
        rated_movies = [(_vector(i), 9.5) for i in range(10)]
        model = fit_rating_model(rated_movies)
        low_quality_movie = _movie(imdb_rating=3.0, tmdb_rating=3.0, vote_count=50000)
        predicted, _ = predict_rating_with_model(
            model, rated_movies, _vector(500), 50.0, low_quality_movie
        )
        # Should be pulled well below the user's own constant 9.5 average by
        # the movie's genuinely poor real-world reception.
        assert predicted < 9.5

    def test_high_variance_ratings_trust_the_personal_model_more(self):
        """More spread in past ratings should increase how much weight the
        personal regression gets relative to the quality anchor: with a
        low-quality movie, a high-variance rating history (which the model
        can actually learn a real relationship from) should pull the
        prediction further from the quality anchor than a flat, low-variance
        history does."""
        rng = np.random.default_rng(42)
        vectors = [rng.random(114) for _ in range(10)]
        varied_ratings = [(vectors[i], float(v)) for i, v in enumerate([1, 3, 5, 6, 8, 9, 10, 2, 7, 4])]
        flat_ratings = [(vectors[i], 9.5) for i in range(10)]

        low_quality_movie = _movie(imdb_rating=3.0, tmdb_rating=3.0, vote_count=50000)
        quality_anchor = 3.0
        target_vector = rng.random(114)

        varied_model = fit_rating_model(varied_ratings)
        flat_model = fit_rating_model(flat_ratings)

        varied_pred, _ = predict_rating_with_model(
            varied_model, varied_ratings, target_vector, 50.0, low_quality_movie
        )
        flat_pred, _ = predict_rating_with_model(
            flat_model, flat_ratings, target_vector, 50.0, low_quality_movie
        )

        assert 1.0 <= varied_pred <= 10.0
        assert 1.0 <= flat_pred <= 10.0
        # The flat/low-variance history has personal_weight capped near its
        # floor (0.3), so it should sit closer to the quality anchor than the
        # high-variance history, which earns a much higher personal_weight.
        assert abs(flat_pred - quality_anchor) < abs(varied_pred - quality_anchor)

    def test_regression_prediction_never_leaves_1_to_10_range(self):
        rated_movies = [(_vector(i), float(1 + i % 10)) for i in range(20)]
        model = fit_rating_model(rated_movies)
        for seed in range(30):
            predicted, _ = predict_rating_with_model(
                model, rated_movies, _vector(seed + 1000), 50.0, _movie()
            )
            assert 1.0 <= predicted <= 10.0
