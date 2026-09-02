"""A single, small idea: don't let one franchise crowd out a recommendation
batch just because it scores well repeatedly.

Real recommenders (Netflix's own published research included) explicitly
balance relevance against diversity/exploration — a purely relevance-sorted
list tends to cluster around whatever cluster scored highest (e.g. every
Spider-Man movie a user has ever shown interest in), which reads as
repetitive rather than genuinely varied, even though each individual pick is
"correct." This is the deliberately simple version of that idea: a hard cap
on how many results from the same TMDB collection (franchise/series) can
appear in one selected batch — not a bandit algorithm, just a rule.
"""


def diversify(candidates: list[dict], limit: int, key: str = "collection_id", per_key_cap: int = 1) -> list[dict]:
    """Walks `candidates` in their existing order (already ranked/shuffled by
    the caller) and takes up to `limit`, skipping any item that would push a
    non-null `key` value over `per_key_cap`."""
    picked = []
    key_counts: dict = {}
    for item in candidates:
        value = item.get(key)
        if value is not None and key_counts.get(value, 0) >= per_key_cap:
            continue
        picked.append(item)
        if value is not None:
            key_counts[value] = key_counts.get(value, 0) + 1
        if len(picked) >= limit:
            break
    return picked
