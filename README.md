# Cinner

A movie discovery app built around a personalized recommendation engine: it learns what a user likes from their ratings, favorites, and watch history, and scores every movie against that learned taste — a **Match %** (how well it fits) and a **Predicted Rating** (what they'd likely rate it), both computed on demand rather than precomputed for the whole catalog.

## Stack and architecture

```
Next.js (React, App Router)  →  FastAPI (Python)  →  Supabase Postgres
                                       ↓
                              TMDB (catalog/metadata)  +  OMDb (IMDb/RT ratings)
```

- **Frontend** — Next.js/React, TypeScript, Tailwind CSS. Talks to the backend only over HTTP; it never touches the database or third-party APIs directly.
- **Backend** — FastAPI. Owns all application logic: auth verification, the recommendation engine, and every read/write to Postgres. A single pooled `asyncpg` connection pool (`asyncpg.create_pool`, sized 1–10) is created once at startup and reused across requests — opening a fresh connection per request was an early, measured latency problem (multi-second overhead on every call to the remote Supabase instance), fixed by pooling.
- **Database** — Supabase-hosted Postgres. Tables of note: `profiles`, `movies` (a local cache of TMDB/OMDb data), `ratings`, `favorites`, `watched`, `watchlist`, `match_calculations`, `events`. The interaction tables (`ratings`, `favorites`, `watched`, `watchlist`) all use a composite primary key on `(user_id, movie_id)`, which keeps the recommendation engine's per-user lookups index-backed without any extra indexes.
- **Auth** — Supabase Auth issues JWTs; the frontend attaches them as `Authorization: Bearer <token>`. The backend verifies them itself, statelessly, against Supabase's published JWKS (`app/auth.py`, via `PyJWT`) — no session state or shared secret, no round trip to Supabase per request.
- **Movie data** — TMDB is the catalog (search, metadata, discovery). Ratings shown to users prefer real IMDb/Rotten Tomatoes numbers from OMDb when available, falling back to TMDB's own rating.

## The recommendation engine

This is the part of the project worth explaining carefully, since it's the main technical differentiator.

### Representing movies and taste as vectors

Every movie is encoded into a fixed 114-dimension numeric vector (`app/recommendations/vectorize.py`): genres (19 dims, multi-hot), language (10 dims, one-hot), five numeric features (release year, runtime, vote count, popularity, TMDB rating — all normalized to roughly 0–1), and director/cast/keywords (16/32/32 dims), which use the *hashing trick* — each name or tag is hashed into one of a small fixed number of buckets, so new actors and keywords never require retraining or an ever-growing vocabulary.

Raw dimension count doesn't equal actual influence on similarity: cast + keywords together are 64 of 114 dimensions and tend to have several non-zero entries each, so left uncorrected they'd quietly dominate more meaningful signals like genre or rating. A fixed per-dimension weight mask (numeric ×2, genre/keyword ×1, cast/director ×0.5) corrects that, and is applied identically everywhere a vector is built — real movies and the synthetic vector below alike — since two vectors are only comparable if they agree on what each dimension means.

A user's **taste vector** (`app/recommendations/taste.py`) is a weighted average of the vectors of every movie they've interacted with: ratings (weight scaled from -1 to +1 around a neutral 5.5, so a bad rating pulls the vector *away* from that movie, not just less toward it), favorites (full weight, a deliberate choice with no ambiguity), watched-but-unrated (a mild positive signal), watchlist (weaker still — interest without confirmation), and onboarding answers (encoded as a synthetic "movie" in the same vector space, at low weight, so real behavior can outweigh a one-time quiz answer). A movie that shows up under more than one signal — e.g. both rated and favorited — counts once, at whichever signal is strongest, so they can't double-count. The engine also detects "prestige sensitivity" empirically: a user whose actual favorites/high ratings skew toward widely-acclaimed films is treated as prestige-sensitive even if they never said so at onboarding, since behavior is stronger evidence than a single stated preference.

### Scoring: Match % and Predicted Rating

These are two deliberately separate numbers (`app/recommendations/score.py`):

- **Match %** is the cosine similarity between a user's taste vector and a movie's vector, rescaled so real scores spread meaningfully across 0–100. Raw cosine similarity in this 114-dimension space never gets close to its theoretical -1..1 range in either direction in practice (confirmed empirically — even a user's own favorite only scored ~0.79 against their own taste vector); a naive rescale of the full range would compress every real result into an indistinguishable, high-looking band, so the rescale bounds are calibrated to where real cosine values actually land.
- **Predicted Rating** blends two things: a small per-user Ridge regression (`scikit-learn`, fit on that user's own rated movies once they have at least 5) and a "quality anchor" — the movie's own real-world reception (IMDb rating when OMDb has one, else TMDB's), Bayesian-averaged toward a neutral prior so a movie with few votes doesn't get taken at face value. The regression is deliberately regularized (`alpha=5.0`) because fitting an unregularized model to a handful of ratings against a 114-dimension space overfits badly. How much weight the personal model gets versus the quality anchor scales with how much *variance* is in the user's own ratings — someone who has only ever rated things 9 or 10 has given the model nothing to learn a real difference from, so their prediction leans more on the movie's actual reception; someone with a real spread of ratings gets a prediction that trusts their personal taste more.
- New users with too little history get an honest, documented fallback (their own rating average, or a neutral baseline if they have none, nudged by Match % and blended with the quality anchor) rather than a model with nothing to learn from.

Match %/Predicted Rating on an individual movie page (`GET /movies/{id}/match`) is computed only when the user explicitly requests it — not automatically for every movie viewed.

### Building "For You"

The **For You** page (`app/recommendations/foryou.py`) is where personalized recommendations actually live. Rather than scoring the entire catalog, it leans on TMDB's own `/discover` and `/recommendations` endpoints to produce a handful of already-relevant candidate pools (by genre, by "people who liked your favorites also liked…", etc.), fits the user's taste vector and rating model once per page load, and scores each pool against it — so the expensive parts happen once, not once per candidate. Candidate genre/era filtering is driven by *actual recent behavior* (recent favorites and highly-rated movies), not just a one-time onboarding answer, so a taste that's shifted since signup isn't stuck with stale filters. A hard quality floor (real rating + minimum vote count) keeps the "Highest Match" and "Rate Highly" sections from surfacing movies that merely overlap on paper with a user's taste but are genuinely poorly received, and a diversification pass caps how many results from one franchise/collection can appear together, so a page doesn't read as five variations of the same series.

**Pick a Movie for Me** (`app/recommendations/pickforme.py`) is a separate, intentionally simpler surface — a quiz (genre, era, mood, time available) answered fresh each visit, independent of stored profile data, that maps mood to a small set of extra genres (e.g. "stressed" leans toward comfort genres, not more of the same mood) and applies the same quality/diversity logic. Logged-in users additionally get Match %/Predicted Rating on each pick, computed the same way as everywhere else.

### Why this design, not something fancier

The engine deliberately avoids "ML for its own sake." Cosine similarity and a small regularized linear regression are enough to produce genuinely personalized results while staying fully explainable: every score can be decomposed into which genres matched, which actor or director overlaps with a favorite, and how much personal history backs the number. Because every real production function is reused (not reimplemented) by a standalone offline evaluation harness (`app/recommendations/evaluate.py`, run manually via `python -m app.recommendations.evaluate`), the design was validated with real leave-one-out testing against the live database rather than assumption — it's a small-sample, non-final result (the honest caveat the script itself documents), but it's real.

## Testing

`backend/tests/` covers the recommendation engine's actual behavior, not just endpoint status codes: Match %/Predicted Rating math (bounds, cold-start users, low-variance rating histories that the model can't learn a difference from, extreme inputs), taste-vector construction (conflicting signals resolving to the stronger one, missing data handled without error), the movie vectorizer, and the franchise-diversification logic. Run with:

```bash
cd backend
source .venv/bin/activate   # or your own virtualenv
pip install -r requirements.txt
pytest
```

## Running locally

**Backend**

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL, SUPABASE_URL, TMDB_ACCESS_TOKEN, OMDB_API_KEY
uvicorn app.main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

The frontend defaults to `http://localhost:8000` for the API and expects the backend's CORS `ALLOWED_ORIGIN` to match wherever it's actually served from (`http://localhost:3000` by default) — both are environment-driven for anything beyond local dev.

## Project structure

```
backend/
  app/
    main.py               FastAPI app, routes, request/response models
    auth.py                Supabase JWT verification (JWKS-based)
    tmdb.py                 TMDB API client + local movie cache
    omdb.py                 OMDb API client (IMDb/RT ratings)
    movie_lists.py         Hourly-cached trending/top-rated/popular lists
    featured.py            Homepage poster wall selection
    recommendations/
      vectorize.py          Movie -> feature vector
      taste.py              User interactions -> taste vector
      score.py              Match % and Predicted Rating
      foryou.py             "For You" page: candidate pools + scoring
      pickforme.py           "Pick a Movie for Me" quiz logic
      diversity.py           Franchise/collection diversification
      era.py                 Onboarding era answer -> date range
      evaluate.py            Standalone offline evaluation harness
  tests/                   pytest suite

frontend/
  app/                     Next.js App Router pages (one folder per route)
  components/              Shared UI components
  lib/                     Supabase client, API base URL
```

## Known limitations

- The offline evaluation harness's own honest results (see its docstring and output) show the recommendation engine currently loses on raw ranking accuracy to a simple "sort by TMDB/IMDb rating" baseline on the small real-account sample available — expected at this data scale, and left as-is rather than tuned against a sample too small to trust the tuning.
- No CI pipeline is set up; tests run locally via `pytest`.
