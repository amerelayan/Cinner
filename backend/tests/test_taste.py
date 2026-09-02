import numpy as np

from app.recommendations.taste import (
    _build_taste_vector,
    _has_prestige_affinity,
    _rating_weight,
    FAVORITE_WEIGHT,
    WATCHED_WEIGHT,
    WATCHLIST_WEIGHT,
)
from app.recommendations.vectorize import VECTOR_DIMS


def _vector(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.random(VECTOR_DIMS)


class TestRatingWeight:
    def test_neutral_rating_is_near_zero(self):
        assert abs(_rating_weight(5.5)) < 0.01

    def test_bad_rating_is_negative(self):
        assert _rating_weight(1.0) < 0

    def test_great_rating_is_positive(self):
        assert _rating_weight(10.0) > 0


class TestPrestigeAffinity:
    def test_too_few_engaged_movies_never_qualifies(self):
        assert _has_prestige_affinity([9.0, 9.0]) is False

    def test_below_threshold_does_not_qualify(self):
        assert _has_prestige_affinity([7.0, 7.5, 7.2]) is False

    def test_at_or_above_threshold_qualifies(self):
        assert _has_prestige_affinity([8.0, 7.9, 8.5]) is True

    def test_ordinary_mix_of_decent_and_great_does_not_trigger_it(self):
        # Guards against the threshold being so low that a normal taste
        # profile gets mislabeled as prestige-sensitive.
        assert _has_prestige_affinity([6.5, 7.0, 7.5, 6.8]) is False


class TestBuildTasteVector:
    def test_empty_interactions_return_zero_vector(self):
        interactions = {"favorites": set(), "ratings": {}, "watched": set(), "watchlist": set()}
        vector = _build_taste_vector(interactions, {}, profile=None)
        assert np.allclose(vector, np.zeros(VECTOR_DIMS))

    def test_a_rated_and_favorited_movie_only_counts_once_at_the_stronger_signal(self):
        movie_vector = _vector(1)
        interactions = {
            "favorites": {1},
            "ratings": {1: 9.0},
            "watched": set(),
            "watchlist": set(),
        }
        movie_vectors = {1: movie_vector}
        with_both = _build_taste_vector(interactions, movie_vectors, profile=None)

        # Rating alone (the stronger/more specific signal) should produce the
        # identical taste vector as rating+favorite together.
        rating_only = {"favorites": set(), "ratings": {1: 9.0}, "watched": set(), "watchlist": set()}
        with_rating_only = _build_taste_vector(rating_only, movie_vectors, profile=None)

        assert np.allclose(with_both, with_rating_only)

    def test_watched_signal_weaker_than_favorite_signal(self):
        movie_vector = np.ones(VECTOR_DIMS)
        favorited = _build_taste_vector(
            {"favorites": {1}, "ratings": {}, "watched": set(), "watchlist": set()},
            {1: movie_vector},
            profile=None,
        )
        watched = _build_taste_vector(
            {"favorites": set(), "ratings": {}, "watched": {1}, "watchlist": set()},
            {1: movie_vector},
            profile=None,
        )
        # Both point the same direction (only one movie feeding the vector),
        # but favoriting is a stronger, more confident signal than watching.
        assert np.linalg.norm(favorited) >= np.linalg.norm(watched)
        assert FAVORITE_WEIGHT > WATCHED_WEIGHT > WATCHLIST_WEIGHT

    def test_a_single_negative_rating_pulls_the_vector_away_from_that_movie(self):
        movie_vector = np.ones(VECTOR_DIMS)
        interactions = {"favorites": set(), "ratings": {1: 1.0}, "watched": set(), "watchlist": set()}
        vector = _build_taste_vector(interactions, {1: movie_vector}, profile=None)
        # A rating of 1 has a negative weight, so the resulting taste vector
        # should point away from (not toward) the disliked movie's features.
        assert np.dot(vector, movie_vector) < 0

    def test_missing_movie_vectors_are_skipped_without_error(self):
        interactions = {"favorites": {999}, "ratings": {}, "watched": set(), "watchlist": set()}
        vector = _build_taste_vector(interactions, {}, profile=None)
        assert np.allclose(vector, np.zeros(VECTOR_DIMS))

    def test_onboarding_profile_alone_still_produces_a_nonzero_vector(self):
        profile = {"preferred_genres": ["Action", "Comedy"], "preferred_movie_age": "new"}
        interactions = {"favorites": set(), "ratings": {}, "watched": set(), "watchlist": set()}
        vector = _build_taste_vector(interactions, {}, profile=profile)
        assert np.linalg.norm(vector) > 0
