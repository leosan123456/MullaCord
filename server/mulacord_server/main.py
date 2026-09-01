"""Aplicação FastAPI do Mulacord."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from . import discovery
from . import replication
from .config import (
    COMMUNITY_ID,
    COMMUNITY_NAME,
    DISCOVERY_PORT,
    NODE_PRIORITY,
    OPEN_REGISTRATION,
    PUBLIC_HOST,
    SERVER_ID,
    SERVER_NAME,
    STARTED_AT,
)
from .database import db
from .realtime.gateway import router as gateway_router
from .routers import accounts, attachments, channels, friends, guilds, messages, replica, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    import os
    await replication.setup()
    for p in os.environ.get("MULACORD_BOOTSTRAP_PEERS", "").split(","):
        p = p.strip()
        if p:
            await replication.note_peer(p if p.startswith("http") else f"http://{p}", COMMUNITY_ID)
    await replication.start_gossip()
    await discovery.start(int(os.environ.get("MULACORD_PORT", "8787")))
    yield
    await discovery.stop()
    await replication.stop_gossip()
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
        "node_id": SERVER_ID,
        "name": SERVER_NAME,
        "version": __version__,
        "members": row["n"] if row else 0,
        "open_registration": OPEN_REGISTRATION,
        "discovery_port": DISCOVERY_PORT,
        "community_id": COMMUNITY_ID,
        "community_name": COMMUNITY_NAME,
        "node_priority": NODE_PRIORITY,
        "started_at": STARTED_AT,
        "public_host": PUBLIC_HOST,
    }


app.include_router(accounts.router)
app.include_router(replica.router)
app.include_router(users.router)
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
