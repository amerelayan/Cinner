from app.recommendations.diversity import diversify


def _movie(id, collection_id=None):
    return {"id": id, "collection_id": collection_id}


class TestDiversify:
    def test_respects_the_limit(self):
        candidates = [_movie(i) for i in range(10)]
        assert len(diversify(candidates, limit=3)) == 3

    def test_caps_results_from_the_same_collection(self):
        candidates = [
            _movie(1, collection_id=99),
            _movie(2, collection_id=99),
            _movie(3, collection_id=99),
            _movie(4, collection_id=None),
        ]
        result = diversify(candidates, limit=4, per_key_cap=1)
        collection_99_count = sum(1 for m in result if m["collection_id"] == 99)
        assert collection_99_count == 1

    def test_movies_with_no_collection_are_never_capped(self):
        candidates = [_movie(i, collection_id=None) for i in range(5)]
        result = diversify(candidates, limit=5, per_key_cap=1)
        assert len(result) == 5

    def test_preserves_input_order_among_kept_items(self):
        candidates = [_movie(1), _movie(2), _movie(3)]
        result = diversify(candidates, limit=3)
        assert [m["id"] for m in result] == [1, 2, 3]

    def test_empty_input_returns_empty_list(self):
        assert diversify([], limit=5) == []
