"""Endpoints de replicação em enxame — troca de oplog entre nós da comunidade."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request

from .. import replication as R

router = APIRouter(prefix="/api/replica", tags=["replica"])


def _auth(key: str | None) -> None:
    if not R.check_key(key):
        raise HTTPException(status_code=403, detail="chave da comunidade inválida")


def _learn_callers(payload: dict, request: Request) -> list[str]:
    """Endereços do nó que chamou: o auto-declarado E o IP de origem observado.
    Anotar os dois cobre o caso do nó pegar a NIC errada (VMware/Hyper-V/WSL/VPN)
    ao se auto-descrever — o IP observado é sempre o que realmente alcança ele."""
    learned: list[str] = []
    caller = (payload.get("self") or "").strip().rstrip("/")
    if caller:
        learned.append(caller if caller.startswith("http") else f"http://{caller}")
    if request.client and request.client.host not in ("127.0.0.1", "::1", "localhost"):
        learned.append(f"http://{request.client.host}:8787")
    return learned


@router.post("/sync")
async def sync(payload: dict, request: Request, x_comm_key: str | None = Header(default=None)):
    _auth(x_comm_key)
    since = {str(k): int(v) for k, v in (payload.get("since") or {}).items()}

    for p in _learn_callers(payload, request):
        await R.note_peer(p, R.COMMUNITY_ID)
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
async def push(payload: dict, request: Request, x_comm_key: str | None = Header(default=None)):
    _auth(x_comm_key)
    for p in _learn_callers(payload, request):
        await R.note_peer(p, R.COMMUNITY_ID)
    applied = await R.apply(payload.get("events") or [])
    return {"ok": True, "applied": len(applied)}


@router.get("/status")
async def status():
    from ..database import db

    row = await db.fetchone("SELECT COUNT(*) AS n FROM users")
    peers = await db.fetchall(
        "SELECT url, last_seen, last_ok FROM repl_peers ORDER BY last_ok DESC NULLS LAST"
    )
    return {
        "node_id": R.NODE_ID,
        "community_id": R.COMMUNITY_ID,
        "local_members": row["n"] if row else 0,
        "events": (await R.vector()),
        "peers": [
            {"url": p["url"], "last_seen": p["last_seen"], "last_ok": p["last_ok"]}
            for p in peers
        ],
    }
