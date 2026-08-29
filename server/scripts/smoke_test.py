"""Teste de fumaça: sobe nada, assume servidor rodando em http://127.0.0.1:8787.

Uso:
    python run.py                       # noutro terminal
    python scripts/smoke_test.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.error
import urllib.request

import websockets

BASE = "http://127.0.0.1:8787"
WS = "ws://127.0.0.1:8787/gateway"


def api(method: str, path: str, body: dict | None = None, token: str | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"  ! {method} {path} -> {e.code} {e.read().decode()}")
        raise


async def main() -> None:
    print("info:", api("GET", "/api/info"))

    import time

    tag = str(int(time.time()))
    alice = api("POST", "/api/auth/register", {
        "username": f"alice{tag}", "email": f"alice{tag}@x.com", "password": "senha12345",
    })
    bob = api("POST", "/api/auth/register", {
        "username": f"bob{tag}", "email": f"bob{tag}@x.com", "password": "senha12345",
    })
    a_tok, b_tok = alice["access_token"], bob["access_token"]
    a_id, b_id = alice["user"]["id"], bob["user"]["id"]
    print(f"registrados: alice={a_id} bob={b_id}")

    api("POST", "/api/friends/request", {"username": f"bob{tag}"}, token=a_tok)
    fr = api("GET", "/api/friends", token=b_tok)
    api("POST", f"/api/friends/{fr[0]['id']}/accept", token=b_tok)
    print("amizade aceita")

    dm = api("POST", "/api/channels/dm", {"user_id": b_id}, token=a_tok)
    cid = dm["id"]
    print(f"dm criada: canal {cid}")

    # Bob conecta no gateway e escuta.
    async with websockets.connect(WS) as bws:
        await bws.send(json.dumps({"op": "identify", "token": b_tok}))
        ready = json.loads(await bws.recv())
        assert ready["t"] == "ready", ready
        print(f"bob ready: {len(ready['channels'])} canal(is)")

        # Alice manda mensagem via gateway.
        async with websockets.connect(WS) as aws:
            await aws.send(json.dumps({"op": "identify", "token": a_tok}))
            await aws.recv()
            await aws.send(json.dumps({"op": "send_message", "channel_id": cid, "content": "oi bob!"}))

            evt = json.loads(await asyncio.wait_for(bws.recv(), timeout=5))
            # Pode vir presence antes; pega até message_create.
            while evt["t"] != "message_create":
                evt = json.loads(await asyncio.wait_for(bws.recv(), timeout=5))
            assert evt["message"]["content"] == "oi bob!", evt
            print(f"bob recebeu: {evt['message']['author']['username']}: {evt['message']['content']}")

    hist = api("GET", f"/api/channels/{cid}/messages", token=b_tok)
    assert len(hist) == 1 and hist[0]["content"] == "oi bob!"
    print(f"histórico REST: {len(hist)} mensagem")
    print("\nTUDO OK ✅")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:  # noqa: BLE001
        print(f"\nFALHOU ❌  {type(e).__name__}: {e}")
        sys.exit(1)
