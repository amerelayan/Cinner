from app.recommendations.pickforme import _passes_runtime


class TestPassesRuntime:
    def test_no_bounds_always_passes(self):
        assert _passes_runtime({"runtime_minutes": 5}, None, None) is True

    def test_missing_runtime_fails_when_a_bound_is_set(self):
        assert _passes_runtime({"runtime_minutes": None}, None, 100) is False

    def test_within_bounds_passes(self):
        assert _passes_runtime({"runtime_minutes": 90}, None, 100) is True

    def test_below_minimum_fails(self):
        assert _passes_runtime({"runtime_minutes": 50}, 140, None) is False

    def test_above_maximum_fails(self):
        assert _passes_runtime({"runtime_minutes": 200}, None, 100) is False

    def test_exact_boundary_values_pass(self):
        assert _passes_runtime({"runtime_minutes": 100}, None, 100) is True
        assert _passes_runtime({"runtime_minutes": 140}, 140, None) is True
