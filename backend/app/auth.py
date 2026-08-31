import os

import jwt
from fastapi import Header, HTTPException

SUPABASE_URL = os.environ.get("SUPABASE_URL")
_JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else None
_jwk_client = jwt.PyJWKClient(_JWKS_URL) if _JWKS_URL else None


def _verify_token(token: str) -> dict:
    if _jwk_client is None:
        raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured")

    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")

    return payload


def get_current_user(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return _verify_token(authorization.removeprefix("Bearer "))


def get_optional_user(authorization: str | None = Header(None)) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return _verify_token(authorization.removeprefix("Bearer "))
