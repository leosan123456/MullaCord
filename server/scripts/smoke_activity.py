"""Teste de fumaça: status de jogo (set_activity) propagado a amigos.
Requer o servidor rodando em :8787."""
from __future__ import annotations

import asyncio
import json
import sys
import time
import urllib.request

import websockets

B = "http://127.0.0.1:8787"
WS = "ws://127.0.0.1:8787/gateway"


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


async def recv_until(ws, t, timeout=5):
    while True:
        evt = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if evt.get("t") == t:
            return evt


async def main() -> None:
    tag = str(int(time.time()))
    a = api("POST", "/api/auth/register", {"username": "g1" + tag, "password": "senha6x"})
    b = api("POST", "/api/auth/register", {"username": "g2" + tag, "password": "senha6x"})
    at, bt = a["access_token"], b["access_token"]
    a_id = a["user"]["id"]

    api("POST", "/api/friends/request", {"username": "g2" + tag}, token=at)
    for f in api("GET", "/api/friends", token=bt):
        if f["direction"] == "incoming":
            api("POST", f"/api/friends/{f['id']}/accept", token=bt)

    async with websockets.connect(WS) as wb:
        await wb.send(json.dumps({"op": "identify", "token": bt}))
        await recv_until(wb, "ready")

        async with websockets.connect(WS) as wa:
            await wa.send(json.dumps({"op": "identify", "token": at}))
            await recv_until(wa, "ready")

            since = int(time.time()) - 90
            await wa.send(json.dumps({"op": "set_activity",
                                     "activity": {"name": "ELDEN RING", "started_at": since}}))
            evt = await recv_until(wb, "activity")
            assert evt["user_id"] == a_id
            assert evt["activity"]["name"] == "ELDEN RING"
            assert evt["activity"]["started_at"] == since
            print(f"amigo recebeu: {evt['activity']['name']} (há {int(time.time()) - since}s)")

            # novo cliente do amigo pega o status no ready
            async with websockets.connect(WS) as wb2:
                await wb2.send(json.dumps({"op": "identify", "token": bt}))
                ready = await recv_until(wb2, "ready")
                assert str(a_id) in ready.get("activities", {}), ready.get("activities")
                print("status aparece no ready de uma nova conexão ✓")

            # limpar
            await wa.send(json.dumps({"op": "set_activity", "activity": None}))
            evt = await recv_until(wb, "activity")
            assert evt["activity"] is None
            print("status limpo propagado ✓")

    print("\nATIVIDADE OK ✅")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:  # noqa: BLE001
        print(f"\nFALHOU ❌  {type(e).__name__}: {e}")
        sys.exit(1)
