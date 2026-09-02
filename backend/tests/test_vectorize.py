import datetime

import numpy as np

from app.recommendations.vectorize import VECTOR_DIMS, vectorize_movie


def _movie(**overrides):
    base = {
        "genres": ["Action", "Drama"],
        "main_cast": ["Actor One", "Actor Two"],
        "director": "Some Director",
        "language": "en",
        "release_date": datetime.date(2015, 6, 1),
        "runtime_minutes": 120,
        "vote_count": 5000,
        "popularity": 50.0,
        "tmdb_rating": 7.5,
        "keywords": ["heist", "revenge"],
    }
    base.update(overrides)
    return base


class TestVectorizeMovie:
    def test_output_has_expected_dimensionality(self):
        vector = vectorize_movie(_movie())
        assert vector.shape == (VECTOR_DIMS,)

    def test_handles_completely_missing_optional_fields(self):
        sparse_movie = {
            "genres": None,
            "main_cast": None,
            "director": None,
            "language": None,
            "release_date": None,
            "runtime_minutes": None,
            "vote_count": None,
            "popularity": None,
            "tmdb_rating": None,
            "keywords": None,
        }
        vector = vectorize_movie(sparse_movie)
        assert vector.shape == (VECTOR_DIMS,)
        assert np.all(np.isfinite(vector))

    def test_same_input_is_deterministic(self):
        movie = _movie()
        assert np.array_equal(vectorize_movie(movie), vectorize_movie(movie))

    def test_different_genres_produce_different_vectors(self):
        action = vectorize_movie(_movie(genres=["Action"]))
        romance = vectorize_movie(_movie(genres=["Romance"]))
        assert not np.array_equal(action, romance)

    def test_unknown_language_falls_back_to_other_bucket(self):
        known = vectorize_movie(_movie(language="en"))
        unknown = vectorize_movie(_movie(language="xx-not-real"))
        assert not np.array_equal(known, unknown)

    def test_extreme_runtime_and_votes_stay_finite_and_bounded(self):
        vector = vectorize_movie(
            _movie(runtime_minutes=99999, vote_count=10_000_000, popularity=1_000_000)
        )
        assert np.all(np.isfinite(vector))
