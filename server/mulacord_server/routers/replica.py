"""Endpoints de replicação em enxame — troca de oplog entre nós da comunidade."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request

from .. import replication as R

router = APIRouter(prefix="/api/replica", tags=["replica"])


def _auth(key: str | None) -> None:
    if not R.check_key(key):
        raise HTTPException(status_code=403, detail="chave da comunidade inválida")


@router.post("/sync")
async def sync(payload: dict, request: Request, x_comm_key: str | None = Header(default=None)):
    _auth(x_comm_key)
    since = {str(k): int(v) for k, v in (payload.get("since") or {}).items()}

    # aprende quem chamou (endereço explícito ou o IP visto + porta padrão)
    caller = (payload.get("self") or "").strip().rstrip("/")
    if caller:
        await R.note_peer(caller if caller.startswith("http") else f"http://{caller}", R.COMMUNITY_ID)
    elif request.client:
        await R.note_peer(f"http://{request.client.host}:8787", R.COMMUNITY_ID)
    for p in payload.get("peers") or []:
        await R.note_peer(p, R.COMMUNITY_ID)

    events = await R.changes_since(since)
    return {
        "events": events,
        "vector": await R.vector(),
        "peers": (await R.known_peers())[:20],
        "community": R.COMMUNITY_ID,
    }


@router.post("/push")
async def push(payload: dict, x_comm_key: str | None = Header(default=None)):
    _auth(x_comm_key)
    applied = await R.apply(payload.get("events") or [])
    return {"ok": True, "applied": len(applied)}


@router.get("/status")
async def status():
    return {
        "node_id": R.NODE_ID,
        "community_id": R.COMMUNITY_ID,
        "events": (await R.vector()),
        "peers": await R.known_peers(),
    }
