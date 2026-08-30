import os

from dotenv import load_dotenv

load_dotenv()

import asyncpg
from fastapi import FastAPI

DATABASE_URL = os.environ.get("DATABASE_URL")

app = FastAPI(title="Cinner API")


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
