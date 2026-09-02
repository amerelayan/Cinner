"""Offline evaluation for the recommendation engine — run manually with:

    python -m app.recommendations.evaluate

Deliberately a standalone script, not a service: no new database tables,
no scheduler, nothing users ever hit. It connects read-only to the same
database everything else uses, and calls the *actual* production functions
(_build_taste_vector, fit_rating_model, predict_rating_with_model,
compute_match_percentage, _has_prestige_affinity) rather than a parallel
reimplementation — an evaluation that tested an approximation of the system
would prove nothing about the system that actually ships.

Method: leave-one-out. For every movie a user rated or favorited, that one
interaction is held out, the taste vector is rebuilt from everything else
they did, and the system scores the held-out movie exactly as it would for
a brand new recommendation — the held-out rating/favorite never appears in
its own taste vector, which is the actual leakage risk in this kind of
evaluation and the one this script is built around avoiding.

Small-sample caveat, stated once here rather than hedged in every section
below: this database has a handful of real accounts. The numbers this
script prints are real and leakage-free, but "real" and "statistically
powerful" are different claims — treat this as a working harness proven
correct on the data available, not a final verdict on accuracy.
"""

import asyncio
import os
import random

import numpy as np
from dotenv import load_dotenv

load_dotenv()

import asyncpg
from sklearn.metrics import roc_auc_score

from app.recommendations.score import (
    _quality_anchor,
    compute_match_percentage,
    fit_rating_model,
    predict_rating_with_model,
)
from app.recommendations.taste import (
    GENRE_DIMS,
    _build_taste_vector,
    _fetch_user_interactions,
    _has_prestige_affinity,
)
from app.recommendations.vectorize import vectorize_movie

RANK_K = 8  # matches SECTION_SIZE elsewhere — what a real "For You" row shows
NUM_NEGATIVES = 49  # candidate pool per fold = 1 relevant + 49 sampled negatives

MOVIE_COLUMNS = """id, genres, main_cast, director, language, release_date,
                   runtime_minutes, vote_count, popularity, tmdb_rating, imdb_rating, keywords"""


def _genre_only_similarity(taste_vector: np.ndarray, movie_vector: np.ndarray) -> float:
    """A minimal content-based baseline: cosine similarity using only the
    19 genre dimensions, ignoring cast/director/keywords/numeric entirely —
    answers "how much is the other 95 dimensions of vectorize.py actually
    buying us over the simplest possible content signal?"."""
    t, m = taste_vector[:GENRE_DIMS], movie_vector[:GENRE_DIMS]
    t_norm, m_norm = np.linalg.norm(t), np.linalg.norm(m)
    if t_norm == 0 or m_norm == 0:
        return 0.0
    return float(np.dot(t, m) / (t_norm * m_norm))


async def _build_folds(conn, user_id: str) -> list[dict]:
    """One fold per rated-or-favorited movie: holds it out, rebuilds the
    taste vector from everything else, and scores it — both with and
    without the onboarding-preference term, so the cold-start ablation
    (section 3 below) doesn't need a second, separate pass over the data."""
    profile_row = await conn.fetchrow(
        "SELECT preferred_genres, preferred_movie_age, prefers_imdb_top_250 "
        "FROM public.profiles WHERE id = $1",
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
    if not all_ids:
        return []

    rows = await conn.fetch(
        f"SELECT {MOVIE_COLUMNS} FROM public.movies WHERE id = ANY($1::int[])", list(all_ids)
    )
    movie_rows = {r["id"]: dict(r) for r in rows}
    movie_vectors = {mid: vectorize_movie(row) for mid, row in movie_rows.items()}
    quality_by_id = {
        mid: float(row["imdb_rating"] or row["tmdb_rating"] or 0)
        for mid, row in movie_rows.items()
        if row["imdb_rating"] or row["tmdb_rating"]
    }

    labeled_ids = interactions["favorites"] | set(interactions["ratings"])
    folds = []
    for held_out_id in labeled_ids:
        if held_out_id not in movie_vectors:
            continue
        actual_rating = interactions["ratings"].get(held_out_id)
        is_favorite = held_out_id in interactions["favorites"]
        label = 1 if (is_favorite or (actual_rating is not None and actual_rating >= 7)) else 0

        fold_interactions = {
            "favorites": interactions["favorites"] - {held_out_id},
            "ratings": {k: v for k, v in interactions["ratings"].items() if k != held_out_id},
            "watched": interactions["watched"] - {held_out_id},
            "watchlist": interactions["watchlist"] - {held_out_id},
        }
        engaged_ids = fold_interactions["favorites"] | {
            m for m, r in fold_interactions["ratings"].items() if r >= 7
        }
        engaged_ratings = [quality_by_id[i] for i in engaged_ids if i in quality_by_id]
        prestige = _has_prestige_affinity(engaged_ratings)

        taste_with_onboarding = _build_taste_vector(fold_interactions, movie_vectors, profile, prestige)
        taste_no_onboarding = _build_taste_vector(fold_interactions, movie_vectors, None, False)

        movie_vector = movie_vectors[held_out_id]
        match_pct = compute_match_percentage(taste_with_onboarding, movie_vector)

        predicted_rating, personal_mean_baseline = None, None
        if actual_rating is not None:
            rated_movies_fold = [
                (movie_vectors[m], r) for m, r in fold_interactions["ratings"].items() if m in movie_vectors
            ]
            model = fit_rating_model(rated_movies_fold)
            predicted_rating, _ = predict_rating_with_model(
                model, rated_movies_fold, movie_vector, match_pct, movie_rows[held_out_id]
            )
            other_ratings = [r for _, r in rated_movies_fold]
            personal_mean_baseline = float(np.mean(other_ratings)) if other_ratings else 6.5

        folds.append(
            {
                "user_id": user_id,
                "movie_id": held_out_id,
                "label": label,
                "actual_rating": actual_rating,
                "match_pct": match_pct,
                "predicted_rating": predicted_rating,
                "personal_mean_baseline": personal_mean_baseline,
                "popularity_baseline": _quality_anchor(movie_rows[held_out_id]),
                "taste_with_onboarding": taste_with_onboarding,
                "taste_no_onboarding": taste_no_onboarding,
                "movie_vector": movie_vector,
                "movie": movie_rows[held_out_id],
                "exclude_ids": all_ids,
            }
        )
    return folds


def _mae_rmse(pairs: list[tuple[float, float]]) -> tuple[float, float]:
    diffs = np.array([actual - predicted for actual, predicted in pairs])
    return float(np.mean(np.abs(diffs))), float(np.sqrt(np.mean(diffs**2)))


def _spearman(x: list[float], y: list[float]) -> float:
    """Pearson correlation on ranks — avoids adding scipy as a dependency
    for one metric when numpy already gives us everything it needs."""
    rank_x = np.argsort(np.argsort(x)).astype(float)
    rank_y = np.argsort(np.argsort(y)).astype(float)
    if np.std(rank_x) == 0 or np.std(rank_y) == 0:
        return 0.0
    return float(np.corrcoef(rank_x, rank_y)[0, 1])


async def _rank_fold(conn, fold: dict) -> dict:
    """Leave-one-out ranking: mix the held-out (truly relevant) movie into
    a pool of sampled negatives, rank the whole pool four different ways,
    and see where the relevant movie landed in each ranking."""
    negative_rows = await conn.fetch(
        f"""
        SELECT {MOVIE_COLUMNS} FROM public.movies
        WHERE id != ALL($1::int[]) AND vote_count IS NOT NULL
        ORDER BY random() LIMIT $2
        """,
        list(fold["exclude_ids"] | {fold["movie_id"]}),
        NUM_NEGATIVES,
    )
    candidates = [fold["movie"]] + [dict(r) for r in negative_rows]
    relevant_id = fold["movie_id"]

    def rank_of(scores: dict[int, float]) -> int:
        ordered = sorted(scores.keys(), key=lambda mid: scores[mid], reverse=True)
        return ordered.index(relevant_id) + 1

    cinner_scores, cinner_ablated_scores, popularity_scores, rating_scores, genre_scores = {}, {}, {}, {}, {}
    for c in candidates:
        vec = fold["movie_vector"] if c["id"] == relevant_id else vectorize_movie(c)
        cinner_scores[c["id"]] = compute_match_percentage(fold["taste_with_onboarding"], vec)
        cinner_ablated_scores[c["id"]] = compute_match_percentage(fold["taste_no_onboarding"], vec)
        popularity_scores[c["id"]] = float(c.get("popularity") or 0)
        rating_scores[c["id"]] = _quality_anchor(c)
        genre_scores[c["id"]] = _genre_only_similarity(fold["taste_with_onboarding"], vec)

    return {
        "cinner": rank_of(cinner_scores),
        "cinner_no_onboarding": rank_of(cinner_ablated_scores),
        "popularity": rank_of(popularity_scores),
        "tmdb_rating": rank_of(rating_scores),
        "genre_only": rank_of(genre_scores),
    }


def _hit_rate_and_mrr(ranks: list[int], k: int) -> tuple[float, float]:
    hits = [1.0 if r <= k else 0.0 for r in ranks]
    reciprocal = [1.0 / r for r in ranks]
    return float(np.mean(hits)), float(np.mean(reciprocal))


async def run() -> None:
    pool = await asyncpg.create_pool(dsn=os.environ["DATABASE_URL"], min_size=1, max_size=5)
    async with pool.acquire() as conn:
        user_ids = [r["id"] for r in await conn.fetch("SELECT id FROM public.profiles")]

        all_folds = []
        for uid in user_ids:
            all_folds.extend(await _build_folds(conn, uid))

        rating_folds = [f for f in all_folds if f["actual_rating"] is not None]
        users_with_ratings = len({f["user_id"] for f in rating_folds})

        print("=" * 72)
        print("CINNER RECOMMENDATION ENGINE — OFFLINE EVALUATION")
        print("=" * 72)
        print(
            f"\nDataset: {len(user_ids)} accounts, {len(all_folds)} labeled interactions "
            f"(favorite or rating) usable as leave-one-out folds, "
            f"{len(rating_folds)} of them numeric ratings across {users_with_ratings} account(s)."
        )

        # 1. Prediction accuracy (MAE/RMSE) vs. two baselines
        print("\n" + "-" * 72)
        print("1. PREDICTED RATING — MAE / RMSE (lower is better)")
        print("-" * 72)
        if len(rating_folds) < 5:
            print("Not enough held-out ratings yet for a meaningful number (need 5+).")
        else:
            cinner_pairs = [(f["actual_rating"], f["predicted_rating"]) for f in rating_folds]
            personal_pairs = [(f["actual_rating"], f["personal_mean_baseline"]) for f in rating_folds]
            popularity_pairs = [(f["actual_rating"], f["popularity_baseline"]) for f in rating_folds]
            for name, pairs in [
                ("Cinner (regression + quality anchor)", cinner_pairs),
                ("Baseline: personal average rating", personal_pairs),
                ("Baseline: global popularity/rating", popularity_pairs),
            ]:
                mae, rmse = _mae_rmse(pairs)
                print(f"  {name:<38} MAE={mae:.2f}  RMSE={rmse:.2f}")
            print(
                f"\n  Caveat: {users_with_ratings} account(s) currently have enough ratings to "
                "contribute here — treat this as proof the harness is leakage-free and correct, "
                "not yet a statistically powerful verdict."
            )

        # 2. Match % validation — AUC + Spearman against real preference labels
        print("\n" + "-" * 72)
        print("2. MATCH % VALIDATION (does high Match % predict actual preference?)")
        print("-" * 72)
        print('Label = 1 if the movie was favorited or rated 7+, else 0 (from held-out data).')
        labels = [f["label"] for f in all_folds]
        scores = [f["match_pct"] for f in all_folds]
        if len(set(labels)) < 2:
            print("Not enough label variety yet (need both liked and disliked examples).")
        else:
            auc = roc_auc_score(labels, scores)
            spearman = _spearman(scores, [f["actual_rating"] or (10 if lbl else 3) for f, lbl in zip(all_folds, labels)])
            print(f"  AUC-ROC (Match % as a liked/disliked classifier): {auc:.3f}")
            print(f"  Spearman correlation (Match % vs. actual preference): {spearman:.3f}")
            print("  (0.5 AUC = no better than random; 1.0 = perfect separation)")

        # 3. Ranking quality + baselines + cold-start ablation
        print("\n" + "-" * 72)
        print(f"3. RANKING QUALITY — Hit Rate@{RANK_K} / MRR, {NUM_NEGATIVES} sampled negatives per fold")
        print("-" * 72)
        favorite_folds = [f for f in all_folds if f["label"] == 1]
        if not favorite_folds:
            print("No favorited/highly-rated movies to rank against yet.")
        else:
            rank_results = [await _rank_fold(conn, f) for f in favorite_folds]
            systems = [
                ("Cinner (full taste vector)", "cinner"),
                ("Cinner, no onboarding data (cold-start ablation)", "cinner_no_onboarding"),
                ("Baseline: global popularity", "popularity"),
                ("Baseline: TMDB/IMDb rating", "tmdb_rating"),
                ("Baseline: genre-only similarity", "genre_only"),
            ]
            for name, key in systems:
                ranks = [r[key] for r in rank_results]
                hit_rate, mrr = _hit_rate_and_mrr(ranks, RANK_K)
                print(f"  {name:<50} HitRate@{RANK_K}={hit_rate:.2f}  MRR={mrr:.3f}")
            num_accounts = len({f["user_id"] for f in favorite_folds})
            print(f"\n  {len(favorite_folds)} leave-one-out folds across {num_accounts} account(s).")

    await pool.close()
    print("\n" + "=" * 72)


if __name__ == "__main__":
    asyncio.run(run())
