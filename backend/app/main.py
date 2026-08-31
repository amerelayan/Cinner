import os

from dotenv import load_dotenv

load_dotenv()

import asyncpg
import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from app.auth import get_current_user
from app.tmdb import MovieNotFoundError, ensure_movie_cached, search_movies

DATABASE_URL = os.environ.get("DATABASE_URL")
TMDB_ACCESS_TOKEN = os.environ.get("TMDB_ACCESS_TOKEN")

app = FastAPI(title="Cinner API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-health")
async def db_health():
    conn = await asyncpg.connect(dsn=DATABASE_URL)
    try:
        result = await conn.fetchval("SELECT 1")
    finally:
        await conn.close()
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


@app.get("/movies/search")
async def movies_search(q: str, page: int = 1):
    if not q.strip():
        raise HTTPException(status_code=422, detail="Query parameter 'q' must not be empty")
    return await search_movies(query=q, page=page)


async def cache_movie_or_404(conn, tmdb_id: int) -> None:
    try:
        await ensure_movie_cached(conn, tmdb_id)
    except MovieNotFoundError:
        raise HTTPException(status_code=404, detail="Movie not found")
    except (httpx.HTTPStatusError, httpx.RequestError):
        raise HTTPException(status_code=502, detail="TMDB is currently unavailable")


async def _add_movie_membership(
    table: str, user_id: str, tmdb_id: int, max_count: int | None = None
) -> int:
    conn = await asyncpg.connect(dsn=DATABASE_URL)
    try:
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

            await conn.execute(
                f"INSERT INTO public.{table} (user_id, movie_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                user_id,
                tmdb_id,
            )
            new_count = await conn.fetchval(
                f"SELECT count(*) FROM public.{table} WHERE user_id = $1", user_id
            )
        return new_count
    finally:
        await conn.close()


async def _remove_movie_membership(table: str, user_id: str, tmdb_id: int) -> None:
    conn = await asyncpg.connect(dsn=DATABASE_URL)
    try:
        await conn.execute(
            f"DELETE FROM public.{table} WHERE user_id = $1 AND movie_id = $2",
            user_id,
            tmdb_id,
        )
    finally:
        await conn.close()


class MovieAction(BaseModel):
    tmdb_id: int


@app.post("/favorites", status_code=201)
async def add_favorite(payload: MovieAction, user: dict = Depends(get_current_user)):
    count = await _add_movie_membership("favorites", user["sub"], payload.tmdb_id, max_count=5)
    return {"tmdb_id": payload.tmdb_id, "favorites_count": count}


@app.delete("/favorites/{tmdb_id}", status_code=204)
async def remove_favorite(tmdb_id: int, user: dict = Depends(get_current_user)):
    await _remove_movie_membership("favorites", user["sub"], tmdb_id)


@app.post("/watched", status_code=201)
async def add_watched(payload: MovieAction, user: dict = Depends(get_current_user)):
    await _add_movie_membership("watched", user["sub"], payload.tmdb_id)
    return {"tmdb_id": payload.tmdb_id}


@app.delete("/watched/{tmdb_id}", status_code=204)
async def remove_watched(tmdb_id: int, user: dict = Depends(get_current_user)):
    await _remove_movie_membership("watched", user["sub"], tmdb_id)


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
    conn = await asyncpg.connect(dsn=DATABASE_URL)
    try:
        async with conn.transaction():
            await cache_movie_or_404(conn, payload.tmdb_id)
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
    finally:
        await conn.close()
    return {"tmdb_id": payload.tmdb_id, "rating": payload.rating}


@app.delete("/ratings/{tmdb_id}", status_code=204)
async def remove_rating(tmdb_id: int, user: dict = Depends(get_current_user)):
    conn = await asyncpg.connect(dsn=DATABASE_URL)
    try:
        await conn.execute(
            "DELETE FROM public.ratings WHERE user_id = $1 AND movie_id = $2",
            user["sub"],
            tmdb_id,
        )
    finally:
        await conn.close()


class ProfileCreate(BaseModel):
    username: str


@app.post("/profile", status_code=201)
async def create_profile(payload: ProfileCreate, user: dict = Depends(get_current_user)):
    user_id = user["sub"]
    conn = await asyncpg.connect(dsn=DATABASE_URL)
    try:
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
    finally:
        await conn.close()
    return {"id": user_id, "username": payload.username}
