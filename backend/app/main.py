import json
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

import asyncpg
import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from app.auth import get_current_user, get_optional_user
from app.featured import get_featured_pool, pick_random_featured
from app.movie_lists import get_popular_movies, get_top_rated_movies, get_trending_movies
from app.omdb import fetch_ratings as fetch_omdb_ratings
from app.recommendations.foryou import build_for_you
from app.recommendations.pickforme import pick_movies
from app.recommendations.score import compute_match_percentage, explain_match, predict_rating
from app.recommendations.taste import gather_user_taste, get_reference_movies
from app.recommendations.vectorize import vectorize_movie
from app.tmdb import (
    GENRE_NAME_TO_TMDB_ID,
    VALID_GENRES,
    MovieNotFoundError,
    ensure_movie_cached,
    fetch_movie_details,
    search_movies,
)

VALID_AGE_PREFERENCES = [
    "new", "last_5_years", "last_10_years", "last_20_years", "25_plus_years", "no_preference",
]
VALID_MOODS = ["happy", "sad", "stressed", "excited", "neutral"]
VALID_TIME_AVAILABLE = ["short", "long", "doesnt_matter"]

DATABASE_URL = os.environ.get("DATABASE_URL")
TMDB_ACCESS_TOKEN = os.environ.get("TMDB_ACCESS_TOKEN")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # A pooled connection is reused instantly; opening a fresh TCP+TLS connection to the
    # remote Supabase Postgres on every single request (as this app used to do) added
    # multiple seconds of latency to endpoints like live search that run on every keystroke.
    app.state.pool = await asyncpg.create_pool(dsn=DATABASE_URL, min_size=1, max_size=10)
    yield
    await app.state.pool.close()


app = FastAPI(title="Cinner API", lifespan=lifespan)

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-health")
async def db_health():
    async with app.state.pool.acquire() as conn:
        result = await conn.fetchval("SELECT 1")
    return {"database": "connected", "result": result}


@app.get("/tmdb-health")
async def tmdb_health():
    if not TMDB_ACCESS_TOKEN:
        raise HTTPException(status_code=500, detail="TMDB_ACCESS_TOKEN is not configured")

    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.themoviedb.org/3/movie/550",
            headers={"Authorization": f"Bearer {TMDB_ACCESS_TOKEN}"},
        )

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"TMDB request failed: {response.status_code}")

    data = response.json()
    return {"tmdb": "connected", "title": data.get("title"), "release_date": data.get("release_date")}


@app.get("/movies/featured")
async def movies_featured(count: int = 22, user: dict | None = Depends(get_optional_user)):
    pool = await get_featured_pool()
    picked = pick_random_featured(pool, count)
    return {"movies": await _attach_tracking_flags(picked, user)}


async def _attach_tracking_flags(movies: list[dict], user: dict | None) -> list[dict]:
    if not user or not movies:
        return [{**m, "watched": False, "in_watchlist": False} for m in movies]

    async with app.state.pool.acquire() as conn:
        ids = [m["tmdb_id"] for m in movies]
        rows = await conn.fetch(
            """
            SELECT movie_id, 'watched' AS kind FROM public.watched
                WHERE user_id = $1 AND movie_id = ANY($2::int[])
            UNION ALL
            SELECT movie_id, 'watchlist' AS kind FROM public.watchlist
                WHERE user_id = $1 AND movie_id = ANY($2::int[])
            """,
            user["sub"],
            ids,
        )

    watched_ids = {r["movie_id"] for r in rows if r["kind"] == "watched"}
    watchlist_ids = {r["movie_id"] for r in rows if r["kind"] == "watchlist"}
    return [
        {**m, "watched": m["tmdb_id"] in watched_ids, "in_watchlist": m["tmdb_id"] in watchlist_ids}
        for m in movies
    ]


@app.get("/movies/search")
async def movies_search(q: str, page: int = 1, user: dict | None = Depends(get_optional_user)):
    if not q.strip():
        raise HTTPException(status_code=422, detail="Query parameter 'q' must not be empty")
    data = await search_movies(query=q, page=page)
    data["results"] = await _attach_tracking_flags(data["results"], user)
    if user:
        async with app.state.pool.acquire() as conn:
            await _log_event(conn, user["sub"], "search", metadata={"query": q})
    return data


@app.get("/movies/trending")
async def movies_trending(user: dict | None = Depends(get_optional_user)):
    movies = await get_trending_movies()
    return {"trending": await _attach_tracking_flags(movies, user)}


@app.get("/movies/top-rated")
async def movies_top_rated(user: dict | None = Depends(get_optional_user)):
    movies = await get_top_rated_movies()
    return {"top_rated": await _attach_tracking_flags(movies, user)}


@app.get("/movies/popular")
async def movies_popular(user: dict | None = Depends(get_optional_user)):
    movies = await get_popular_movies()
    return {"popular": await _attach_tracking_flags(movies, user)}


@app.get("/for-you")
async def for_you(user: dict = Depends(get_current_user)):
    return await build_for_you(app.state.pool, user["sub"])


@app.get("/movies/{tmdb_id}")
async def get_movie(tmdb_id: int, user: dict | None = Depends(get_optional_user)):
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id AS tmdb_id, title, release_date, poster_path, synopsis, director,
                   genres, main_cast, language, runtime_minutes,
                   imdb_rating, rotten_tomatoes_rating
            FROM public.movies WHERE id = $1
            """,
            tmdb_id,
        )

        if row is None:
            try:
                details = await fetch_movie_details(tmdb_id)
            except MovieNotFoundError:
                raise HTTPException(status_code=404, detail="Movie not found")
            except (httpx.HTTPStatusError, httpx.RequestError):
                raise HTTPException(status_code=502, detail="TMDB is currently unavailable")

            ratings = await fetch_omdb_ratings(details["imdb_id"])

            return {
                "tmdb_id": details["id"],
                "title": details["title"],
                "release_date": details["release_date"],
                "poster_path": details["poster_path"],
                "synopsis": details["synopsis"],
                "director": details["director"],
                "genres": details["genres"],
                "main_cast": details["main_cast"],
                "language": details["language"],
                "runtime_minutes": details["runtime_minutes"],
                "imdb_rating": ratings["imdb_rating"],
                "rotten_tomatoes_rating": ratings["rotten_tomatoes_rating"],
                "cinner_average_rating": None,
                "cinner_ratings_count": 0,
                "your_rating": None,
                "watched": False,
                "in_watchlist": False,
            }

        movie = dict(row)

        # A user_id of NULL never matches a row's user_id, so this one query works
        # correctly for both logged-in and anonymous requests without branching.
        user_id = user["sub"] if user else None
        extra = await conn.fetchrow(
            """
            SELECT
                (SELECT avg(rating) FROM public.ratings WHERE movie_id = $1) AS avg_rating,
                (SELECT count(*) FROM public.ratings WHERE movie_id = $1) AS ratings_count,
                (SELECT rating FROM public.ratings WHERE user_id = $2 AND movie_id = $1) AS your_rating,
                EXISTS(SELECT 1 FROM public.watched WHERE user_id = $2 AND movie_id = $1) AS watched,
                EXISTS(SELECT 1 FROM public.watchlist WHERE user_id = $2 AND movie_id = $1) AS in_watchlist
            """,
            tmdb_id,
            user_id,
        )
        movie["cinner_average_rating"] = (
            float(extra["avg_rating"]) if extra["avg_rating"] is not None else None
        )
        movie["cinner_ratings_count"] = extra["ratings_count"]
        movie["your_rating"] = (
            float(extra["your_rating"]) if extra["your_rating"] is not None else None
        )
        movie["watched"] = extra["watched"]
        movie["in_watchlist"] = extra["in_watchlist"]

        if user:
            await _log_event(conn, user["sub"], "movie_opened", movie_id=tmdb_id)

        return movie


@app.get("/movies/{tmdb_id}/match")
async def calculate_match(tmdb_id: int, user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        await cache_movie_or_404(conn, tmdb_id)

        movie_row = await conn.fetchrow(
            """
            SELECT id, title, genres, main_cast, director, language, release_date,
                   runtime_minutes, vote_count, popularity, tmdb_rating, imdb_rating, keywords
            FROM public.movies WHERE id = $1
            """,
            tmdb_id,
        )
        movie = dict(movie_row)
        movie_vector = vectorize_movie(movie)

        taste_vector, rated_movies, profile = await gather_user_taste(conn, user["sub"])
        match_pct = compute_match_percentage(taste_vector, movie_vector)
        predicted_rating, method = predict_rating(rated_movies, movie_vector, match_pct, movie)

        reference_movies = await get_reference_movies(conn, user["sub"])
        reasons = explain_match(movie, profile or {}, reference_movies)

        await conn.execute(
            """
            INSERT INTO public.match_calculations
                (user_id, movie_id, match_pct, predicted_rating, method, reasons)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            ON CONFLICT (user_id, movie_id) DO UPDATE SET
                match_pct = EXCLUDED.match_pct,
                predicted_rating = EXCLUDED.predicted_rating,
                method = EXCLUDED.method,
                reasons = EXCLUDED.reasons,
                computed_at = now()
            """,
            user["sub"],
            tmdb_id,
            match_pct,
            predicted_rating,
            method,
            json.dumps(reasons),
        )

        await _log_event(
            conn,
            user["sub"],
            "match_calculated",
            movie_id=tmdb_id,
            metadata={"match_pct": match_pct, "predicted_rating": predicted_rating, "method": method},
        )

    return {
        "match_pct": match_pct,
        "predicted_rating": predicted_rating,
        "method": method,
        "reasons": reasons,
    }


async def cache_movie_or_404(conn, tmdb_id: int) -> None:
    try:
        await ensure_movie_cached(conn, tmdb_id)
    except MovieNotFoundError:
        raise HTTPException(status_code=404, detail="Movie not found")
    except (httpx.HTTPStatusError, httpx.RequestError):
        raise HTTPException(status_code=502, detail="TMDB is currently unavailable")


# The events log records meaningful user actions for the recommendation engine.
# Deliberately not tracking mouse movement, scroll, hover, etc. — just the actions
# a taste profile can actually be built from.
EVENT_TYPES_BY_TABLE = {
    "favorites": ("favorite_added", "favorite_removed"),
    "watched": ("watched_added", "watched_removed"),
    "watchlist": ("watchlist_added", "watchlist_removed"),
}


async def _log_event(
    conn, user_id: str, event_type: str, movie_id: int | None = None, metadata: dict | None = None
) -> None:
    await conn.execute(
        "INSERT INTO public.events (user_id, event_type, movie_id, metadata) VALUES ($1, $2, $3, $4::jsonb)",
        user_id,
        event_type,
        movie_id,
        json.dumps(metadata) if metadata is not None else None,
    )


async def _add_movie_membership(
    table: str, user_id: str, tmdb_id: int, max_count: int | None = None
) -> int:
    async with app.state.pool.acquire() as conn:
        async with conn.transaction():
            await cache_movie_or_404(conn, tmdb_id)

            if max_count is not None:
                already_has_this_one = await conn.fetchval(
                    f"SELECT 1 FROM public.{table} WHERE user_id = $1 AND movie_id = $2",
                    user_id,
                    tmdb_id,
                )
                current_count = await conn.fetchval(
                    f"SELECT count(*) FROM public.{table} WHERE user_id = $1", user_id
                )
                if not already_has_this_one and current_count >= max_count:
                    raise HTTPException(
                        status_code=409,
                        detail=f"You already have {max_count} favorite movies",
                    )

            result = await conn.execute(
                f"INSERT INTO public.{table} (user_id, movie_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                user_id,
                tmdb_id,
            )
            # ON CONFLICT DO NOTHING means the row count tells us whether this was
            # actually a new addition — skip logging a duplicate no-op event.
            if int(result.rsplit(" ", 1)[-1]) > 0:
                added_event, _ = EVENT_TYPES_BY_TABLE[table]
                await _log_event(conn, user_id, added_event, movie_id=tmdb_id)

            new_count = await conn.fetchval(
                f"SELECT count(*) FROM public.{table} WHERE user_id = $1", user_id
            )
        return new_count


async def _remove_movie_membership(table: str, user_id: str, tmdb_id: int) -> None:
    async with app.state.pool.acquire() as conn:
        result = await conn.execute(
            f"DELETE FROM public.{table} WHERE user_id = $1 AND movie_id = $2",
            user_id,
            tmdb_id,
        )
        if int(result.rsplit(" ", 1)[-1]) > 0:
            _, removed_event = EVENT_TYPES_BY_TABLE[table]
            await _log_event(conn, user_id, removed_event, movie_id=tmdb_id)


class MovieAction(BaseModel):
    tmdb_id: int


@app.get("/favorites")
async def get_favorites(user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT m.id AS tmdb_id, m.title, m.poster_path
            FROM public.favorites f
            JOIN public.movies m ON m.id = f.movie_id
            WHERE f.user_id = $1
            ORDER BY f.created_at
            """,
            user["sub"],
        )
    return {"favorites": [dict(row) for row in rows]}


@app.post("/favorites", status_code=201)
async def add_favorite(payload: MovieAction, user: dict = Depends(get_current_user)):
    count = await _add_movie_membership("favorites", user["sub"], payload.tmdb_id, max_count=5)
    return {"tmdb_id": payload.tmdb_id, "favorites_count": count}


@app.delete("/favorites/{tmdb_id}", status_code=204)
async def remove_favorite(tmdb_id: int, user: dict = Depends(get_current_user)):
    await _remove_movie_membership("favorites", user["sub"], tmdb_id)


@app.get("/watched")
async def get_watched(user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT m.id AS tmdb_id, m.title, m.release_date, m.poster_path
            FROM public.watched w
            JOIN public.movies m ON m.id = w.movie_id
            WHERE w.user_id = $1
            ORDER BY w.created_at DESC
            """,
            user["sub"],
        )
    return {"watched": [dict(row) for row in rows]}


@app.post("/watched", status_code=201)
async def add_watched(payload: MovieAction, user: dict = Depends(get_current_user)):
    await _add_movie_membership("watched", user["sub"], payload.tmdb_id)
    return {"tmdb_id": payload.tmdb_id}


@app.delete("/watched/{tmdb_id}", status_code=204)
async def remove_watched(tmdb_id: int, user: dict = Depends(get_current_user)):
    await _remove_movie_membership("watched", user["sub"], tmdb_id)


@app.get("/watchlist")
async def get_watchlist(user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT m.id AS tmdb_id, m.title, m.release_date, m.poster_path
            FROM public.watchlist wl
            JOIN public.movies m ON m.id = wl.movie_id
            WHERE wl.user_id = $1
            ORDER BY wl.created_at DESC
            """,
            user["sub"],
        )
    return {"watchlist": [dict(row) for row in rows]}


@app.post("/watchlist", status_code=201)
async def add_watchlist(payload: MovieAction, user: dict = Depends(get_current_user)):
    await _add_movie_membership("watchlist", user["sub"], payload.tmdb_id)
    return {"tmdb_id": payload.tmdb_id}


@app.delete("/watchlist/{tmdb_id}", status_code=204)
async def remove_watchlist(tmdb_id: int, user: dict = Depends(get_current_user)):
    await _remove_movie_membership("watchlist", user["sub"], tmdb_id)


class RatingCreate(BaseModel):
    tmdb_id: int
    rating: float

    @field_validator("rating")
    @classmethod
    def validate_rating(cls, value: float) -> float:
        if not (1 <= value <= 10):
            raise ValueError("rating must be between 1 and 10")
        if round(value * 10) % 5 != 0:
            raise ValueError("rating must be in 0.5 increments")
        return value


@app.post("/ratings")
async def upsert_rating(payload: RatingCreate, user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        async with conn.transaction():
            await cache_movie_or_404(conn, payload.tmdb_id)
            previous_rating = await conn.fetchval(
                "SELECT rating FROM public.ratings WHERE user_id = $1 AND movie_id = $2",
                user["sub"],
                payload.tmdb_id,
            )
            await conn.execute(
                """
                INSERT INTO public.ratings (user_id, movie_id, rating)
                VALUES ($1, $2, $3)
                ON CONFLICT (user_id, movie_id)
                DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()
                """,
                user["sub"],
                payload.tmdb_id,
                payload.rating,
            )
            await _log_event(
                conn,
                user["sub"],
                "rating_changed" if previous_rating is not None else "rating_created",
                movie_id=payload.tmdb_id,
                metadata={
                    "rating": payload.rating,
                    "previous_rating": float(previous_rating) if previous_rating is not None else None,
                },
            )
    return {"tmdb_id": payload.tmdb_id, "rating": payload.rating}


@app.delete("/ratings/{tmdb_id}", status_code=204)
async def remove_rating(tmdb_id: int, user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM public.ratings WHERE user_id = $1 AND movie_id = $2",
            user["sub"],
            tmdb_id,
        )


class ProfileCreate(BaseModel):
    username: str


@app.post("/profile", status_code=201)
async def create_profile(payload: ProfileCreate, user: dict = Depends(get_current_user)):
    user_id = user["sub"]
    async with app.state.pool.acquire() as conn:
        try:
            await conn.execute(
                "INSERT INTO public.profiles (id, username) VALUES ($1, $2)",
                user_id,
                payload.username,
            )
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail="Username is already taken")
        except asyncpg.CheckViolationError:
            raise HTTPException(
                status_code=422,
                detail="Username must be 3-20 characters, using only letters, numbers, and underscores",
            )
    return {"id": user_id, "username": payload.username}


@app.get("/genres")
def get_genres():
    return {"genres": VALID_GENRES}


@app.get("/profile")
async def get_profile(user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT username, profile_picture_url, location, preferred_genres,
                   preferred_movie_age, prefers_imdb_top_250
            FROM public.profiles WHERE id = $1
            """,
            user["sub"],
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        watched_count = await conn.fetchval(
            "SELECT count(*) FROM public.watched WHERE user_id = $1", user["sub"]
        )
        watchlist_count = await conn.fetchval(
            "SELECT count(*) FROM public.watchlist WHERE user_id = $1", user["sub"]
        )
    return {**dict(row), "watched_count": watched_count, "watchlist_count": watchlist_count}


class LocationUpdate(BaseModel):
    location: str


@app.post("/profile/location")
async def update_location(payload: LocationUpdate, user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "UPDATE public.profiles SET location = $1, updated_at = now() WHERE id = $2",
            payload.location,
            user["sub"],
        )
    return {"location": payload.location}


class PictureUpdate(BaseModel):
    profile_picture_url: str


@app.post("/profile/picture")
async def update_picture(payload: PictureUpdate, user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "UPDATE public.profiles SET profile_picture_url = $1, updated_at = now() WHERE id = $2",
            payload.profile_picture_url,
            user["sub"],
        )
    return {"profile_picture_url": payload.profile_picture_url}


class GenresUpdate(BaseModel):
    genres: list[str]

    @field_validator("genres")
    @classmethod
    def validate_genres(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("at least one genre must be selected")
        invalid = sorted(set(value) - set(VALID_GENRES))
        if invalid:
            raise ValueError(f"invalid genres: {invalid}")
        return value


@app.post("/profile/genres")
async def update_genres(payload: GenresUpdate, user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "UPDATE public.profiles SET preferred_genres = $1, updated_at = now() WHERE id = $2",
            payload.genres,
            user["sub"],
        )
    return {"preferred_genres": payload.genres}


class AgePreferenceUpdate(BaseModel):
    age_preference: str

    @field_validator("age_preference")
    @classmethod
    def validate_age_preference(cls, value: str) -> str:
        if value not in VALID_AGE_PREFERENCES:
            raise ValueError(f"age_preference must be one of {VALID_AGE_PREFERENCES}")
        return value


@app.post("/profile/age-preference")
async def update_age_preference(payload: AgePreferenceUpdate, user: dict = Depends(get_current_user)):
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "UPDATE public.profiles SET preferred_movie_age = $1, updated_at = now() WHERE id = $2",
            payload.age_preference,
            user["sub"],
        )
    return {"preferred_movie_age": payload.age_preference}


class ImdbTop250PreferenceUpdate(BaseModel):
    prefers_imdb_top_250: bool


@app.post("/profile/imdb-top-250-preference")
async def update_imdb_top_250_preference(
    payload: ImdbTop250PreferenceUpdate, user: dict = Depends(get_current_user)
):
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "UPDATE public.profiles SET prefers_imdb_top_250 = $1, updated_at = now() WHERE id = $2",
            payload.prefers_imdb_top_250,
            user["sub"],
        )
    return {"prefers_imdb_top_250": payload.prefers_imdb_top_250}


class PickForMeRequest(BaseModel):
    genres: list[str]
    age_preference: str
    prefers_imdb_top_250: bool
    mood: str = "neutral"
    time_available: str = "doesnt_matter"

    @field_validator("genres")
    @classmethod
    def validate_genres(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("at least one genre must be selected")
        invalid = sorted(set(value) - set(VALID_GENRES))
        if invalid:
            raise ValueError(f"invalid genres: {invalid}")
        return value

    @field_validator("age_preference")
    @classmethod
    def validate_age_preference(cls, value: str) -> str:
        if value not in VALID_AGE_PREFERENCES:
            raise ValueError(f"age_preference must be one of {VALID_AGE_PREFERENCES}")
        return value

    @field_validator("mood")
    @classmethod
    def validate_mood(cls, value: str) -> str:
        if value not in VALID_MOODS:
            raise ValueError(f"mood must be one of {VALID_MOODS}")
        return value

    @field_validator("time_available")
    @classmethod
    def validate_time_available(cls, value: str) -> str:
        if value not in VALID_TIME_AVAILABLE:
            raise ValueError(f"time_available must be one of {VALID_TIME_AVAILABLE}")
        return value


@app.post("/pick-for-me")
async def pick_for_me(payload: PickForMeRequest, user: dict | None = Depends(get_optional_user)):
    genre_ids = [GENRE_NAME_TO_TMDB_ID[g] for g in payload.genres]
    movies = await pick_movies(
        app.state.pool,
        genre_ids,
        payload.age_preference,
        payload.prefers_imdb_top_250,
        payload.mood,
        payload.time_available,
        user["sub"] if user else None,
    )
    return {"movies": movies}
