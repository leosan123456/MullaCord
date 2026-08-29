"""Fluxo social completo com DOIS clientes reais no mesmo servidor:
cria contas -> busca -> pedido de amizade -> aceita -> DM -> conversa dos dois lados
-> edição -> digitando -> presença. Requer o servidor rodando em :8787."""
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


class Client:
    """Simula um app: mantém o gateway aberto e junta os eventos recebidos."""

    def __init__(self, name, token):
        self.name = name
        self.token = token
        self.ws = None
        self.events: list[dict] = []
        self.ready: dict | None = None
        self._task = None

    async def connect(self):
        self.ws = await websockets.connect(WS)
        await self.ws.send(json.dumps({"op": "identify", "token": self.token}))
        self._task = asyncio.create_task(self._loop())
        self.ready = await self.wait("ready")

    async def _loop(self):
        try:
            async for raw in self.ws:
                self.events.append(json.loads(raw))
        except Exception:
            pass

    async def send(self, obj):
        await self.ws.send(json.dumps(obj))

    async def wait(self, t, timeout=5, match=None):
        end = time.time() + timeout
        seen = 0
        while time.time() < end:
            for e in self.events[seen:]:
                seen += 1
                if e.get("t") == t and (match is None or match(e)):
                    return e
            await asyncio.sleep(0.05)
        raise AssertionError(f"[{self.name}] esperava '{t}' e não chegou")

    async def close(self):
        await self.ws.close()
        if self._task:
            self._task.cancel()


async def main() -> None:
    tag = str(int(time.time()))
    alice = api("POST", "/api/auth/register", {"username": "alice" + tag, "password": "senha6x"})
    bob = api("POST", "/api/auth/register", {"username": "bob" + tag, "password": "senha6x"})
    at, bt = alice["access_token"], bob["access_token"]
    a_id, b_id = alice["user"]["id"], bob["user"]["id"]
    print(f"2 contas criadas no mesmo servidor: {alice['user']['username']} (#{a_id}), {bob['user']['username']} (#{b_id})")

    ca, cb = Client("alice", at), Client("bob", bt)
    await ca.connect()
    await cb.connect()
    print("ambos conectados ao gateway")

    # alice acha bob no diretório
    found = api("GET", f"/api/users?q=bob{tag}", token=at)
    assert any(u["id"] == b_id and u["relationship"] == "none" for u in found), found
    print("alice encontrou bob na busca do servidor")

    # pedido de amizade -> bob recebe ao vivo
    api("POST", "/api/friends/request", {"username": "bob" + tag}, token=at)
    e = await cb.wait("friend_request")
    assert e["user"]["id"] == a_id
    print("bob recebeu o pedido de amizade em tempo real")

    # bob vê como 'incoming' e aceita -> alice recebe
    found_b = api("GET", f"/api/users?q=alice{tag}", token=bt)
    assert any(u["id"] == a_id and u["relationship"] == "incoming" for u in found_b)
    fid = next(f["id"] for f in api("GET", "/api/friends", token=bt) if f["direction"] == "incoming")
    api("POST", f"/api/friends/{fid}/accept", token=bt)
    e = await ca.wait("friend_accepted")
    assert e["user"]["id"] == b_id
    print("bob aceitou; alice recebeu a confirmação")

    # alice abre a DM -> bob recebe channel_create
    dm = api("POST", "/api/channels/dm", {"user_id": b_id}, token=at)
    cid = dm["id"]
    e = await cb.wait("channel_create", match=lambda x: x["channel"]["id"] == cid)
    assert {m["id"] for m in e["channel"]["members"]} == {a_id, b_id}
    print(f"DM #{cid} criada; bob foi adicionado")

    # conversa dos dois lados pelo gateway
    await ca.send({"op": "send_message", "channel_id": cid, "content": "oi bob, tudo certo?"})
    e = await cb.wait("message_create", match=lambda x: x["message"]["channel_id"] == cid)
    assert e["message"]["content"] == "oi bob, tudo certo?" and e["message"]["author"]["id"] == a_id
    print("  alice -> bob: entregue")

    await cb.send({"op": "send_message", "channel_id": cid, "content": "opa, tudo! e ai"})
    e = await ca.wait("message_create", match=lambda x: x["message"]["author"]["id"] == b_id)
    msg_bob_id = e["message"]["id"]
    print("  bob -> alice: entregue")

    # digitando
    await ca.send({"op": "typing", "channel_id": cid})
    e = await cb.wait("typing", match=lambda x: x["channel_id"] == cid)
    assert e["user_id"] == a_id
    print("  indicador 'digitando' chega no bob")

    # bob edita, alice vê
    api("PATCH", f"/api/channels/{cid}/messages/{msg_bob_id}", {"content": "opa, tudo! e aí, bora jogar?"}, token=bt)
    e = await ca.wait("message_update", match=lambda x: x["message"]["id"] == msg_bob_id)
    assert e["message"]["content"].endswith("bora jogar?") and e["message"]["edited_at"]
    print("  edição do bob propagada pra alice")

    # histórico igual dos dois lados
    ha = api("GET", f"/api/channels/{cid}/messages", token=at)
    hb = api("GET", f"/api/channels/{cid}/messages", token=bt)
    assert [m["content"] for m in ha] == [m["content"] for m in hb] and len(ha) == 2
    print(f"  histórico idêntico dos dois lados ({len(ha)} mensagens)")

    # bob sai -> alice recebe presença offline
    await cb.close()
    e = await ca.wait("presence", match=lambda x: x["user_id"] == b_id and x["status"] == "offline")
    print("bob desconectou; alice viu ele ficar offline")

    await ca.close()
    print("\nCOMUNICAÇÃO ENTRE 2 USUÁRIOS OK ✅")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:  # noqa: BLE001
        print(f"\nFALHOU ❌  {type(e).__name__}: {e}")
        sys.exit(1)
