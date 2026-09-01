"""Registro, login e perfil."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from ..database import db
from ..deps import CurrentUser, public_user
from ..replication import next_id
from ..realtime.manager import manager
from ..schemas import LoginIn, ProfilePatch, RegisterIn, TokenOut, UserOut
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn) -> dict:
    from ..config import OPEN_REGISTRATION

    if not OPEN_REGISTRATION:
        has_any = await db.fetchone("SELECT 1 FROM users LIMIT 1")
        if has_any:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Este servidor não aceita novos cadastros")
    email = body.email or f"{body.username.lower()}@mulacord.local"
    exists = await db.fetchone(
        "SELECT 1 FROM users WHERE username = ? OR email = ?", (body.username, email)
    )
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Usuário ou e-mail já cadastrado")
    uid = await next_id()
    await db.execute(
        """
        INSERT INTO users (id, username, email, password_hash, display_name)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            uid,
            body.username,
            email,
            hash_password(body.password),
            body.display_name or body.username,
        ),
    )
    row = await db.fetchone("SELECT * FROM users WHERE id = ?", (uid,))
    return {
        "access_token": create_token(row["id"]),
        "user": UserOut(**public_user(row), email=_visible_email(row["email"])),
    }


def _visible_email(email: str | None) -> str | None:
    """Esconde o e-mail sintético gerado quando o usuário não informou um."""
    if not email or email.endswith("@mulacord.local"):
        return None
    return email


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn) -> dict:
    row = await db.fetchone(
        "SELECT * FROM users WHERE username = ? OR email = ?",
        (body.username_or_email, body.username_or_email),
    )
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais inválidas")
    return {
        "access_token": create_token(row["id"]),
        "user": UserOut(**public_user(row), email=_visible_email(row["email"])),
    }


@router.get("/me", response_model=UserOut)
async def me(user=CurrentUser) -> dict:
    return UserOut(**public_user(user), email=_visible_email(user["email"]))


@router.patch("/me", response_model=UserOut)
async def update_me(body: ProfilePatch, user=CurrentUser) -> dict:
    sets, params = [], []
    if body.display_name is not None:
        sets.append("display_name = ?"); params.append(body.display_name)
    if body.avatar is not None:
        sets.append("avatar = ?"); params.append(body.avatar or None)
    if sets:
        params.append(user["id"])
        await db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", params)
    row = await db.fetchone("SELECT * FROM users WHERE id = ?", (user["id"],))
    await manager.broadcast_user_scope(
        user["id"], {"t": "user_update", "user": public_user(row)}
    )
    return UserOut(**public_user(row), email=_visible_email(row["email"]))
