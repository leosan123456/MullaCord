"""Aplicação FastAPI do Mulacord."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from . import discovery
from .config import DISCOVERY_PORT, OPEN_REGISTRATION, SERVER_ID, SERVER_NAME
from .database import db
from .realtime.gateway import router as gateway_router
from .routers import accounts, attachments, channels, friends, guilds, messages


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    import os
    await discovery.start(int(os.environ.get("MULACORD_PORT", "8787")))
    yield
    await discovery.stop()
    await db.close()


app = FastAPI(title="Mulacord", version=__version__, lifespan=lifespan)

# O app Electron roda em file:// (origin "null"); libera geral já que é self-hosted.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/info")
async def info() -> dict:
    row = await db.fetchone("SELECT COUNT(*) AS n FROM users")
    return {
        "service": "mulacord",
        "server_id": SERVER_ID,
        "name": SERVER_NAME,
        "version": __version__,
        "members": row["n"] if row else 0,
        "open_registration": OPEN_REGISTRATION,
        "discovery_port": DISCOVERY_PORT,
    }


app.include_router(accounts.router)
app.include_router(friends.router)
app.include_router(guilds.router)
app.include_router(channels.router)
app.include_router(attachments.router)
app.include_router(messages.router)
app.include_router(gateway_router)


@app.get("/api/permissions")
async def permission_flags() -> dict:
    from .permissions import PERMISSION_NAMES

    return {name: value for value, name in PERMISSION_NAMES.items()}
