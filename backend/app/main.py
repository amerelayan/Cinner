import os

from dotenv import load_dotenv

load_dotenv()

import asyncpg
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.auth import get_current_user

DATABASE_URL = os.environ.get("DATABASE_URL")

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
