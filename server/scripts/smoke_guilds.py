"""Teste de fumaça dos servidores (guilds). Requer o servidor rodando em :8787."""
from __future__ import annotations

import asyncio
import json
import sys
import time
import urllib.error
import urllib.request

import websockets

BASE = "http://127.0.0.1:8787"
WS = "ws://127.0.0.1:8787/gateway"


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"  ! {method} {path} -> {e.code}: {e.read().decode()}")
        raise


async def recv_until(ws, t, timeout=5):
    while True:
        evt = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if evt.get("t") == t:
            return evt


async def main():
    perms = api("GET", "/api/permissions")
    assert "ADMINISTRATOR" in perms
    P = perms

    tag = str(int(time.time()))
    owner = api("POST", "/api/auth/register", {
        "username": f"own{tag}", "email": f"own{tag}@m.co", "password": "senha12345"})
    guest = api("POST", "/api/auth/register", {
        "username": f"gue{tag}", "email": f"gue{tag}@m.co", "password": "senha12345"})
    ot, gt = owner["access_token"], guest["access_token"]
    gid_user = guest["user"]["id"]

    guild = api("POST", "/api/guilds", {"name": f"Servidor {tag}"}, token=ot)
    gid = guild["id"]
    assert len(guild["channels"]) == 2, guild["channels"]
    text_ch = next(c for c in guild["channels"] if c["type"] == "text")
    voice_ch = next(c for c in guild["channels"] if c["type"] == "voice")
    everyone = next(r for r in guild["roles"] if r["is_default"])
    print(f"guild {gid}: #{text_ch['name']} + 🔊{voice_ch['name']}, @everyone perms={everyone['permissions']}")

    # convite + entrada
    inv = api("POST", f"/api/guilds/{gid}/invites", {"max_uses": 0}, token=ot)
    joined = api("POST", f"/api/invites/{inv['code']}", None, token=gt)
    assert any(m["id"] == gid_user for m in joined["members"]), "guest não entrou"
    print(f"guest entrou via convite {inv['code']} ({len(joined['members'])} membros)")

    # cargo Mod com MANAGE_MESSAGES + KICK
    role = api("POST", f"/api/guilds/{gid}/roles", {
        "name": "Mod", "permissions": P["MANAGE_MESSAGES"] | P["KICK_MEMBERS"], "hoist": True}, token=ot)
    api("PUT", f"/api/guilds/{gid}/members/{gid_user}/roles/{role['id']}", None, token=ot)
    print(f"cargo Mod {role['id']} atribuído ao guest")

    # canal privado: nega VIEW pro @everyone, guest não deve ver
    priv = api("POST", f"/api/guilds/{gid}/channels", {"name": "staff", "type": "text"}, token=ot)
    api("PUT", f"/api/channels/{priv['id']}/overwrites/role/{everyone['id']}",
        {"allow": 0, "deny": P["VIEW_CHANNEL"]}, token=ot)
    try:
        api("GET", f"/api/channels/{priv['id']}/messages", token=gt)
        print("  ! FALHA: guest leu canal privado"); sys.exit(1)
    except urllib.error.HTTPError as e:
        assert e.code == 403
    print("guest bloqueado no #staff (overwrite deny VIEW_CHANNEL) ✓")

    # guest fala no canal público
    api("POST", f"/api/channels/{text_ch['id']}/messages", {"content": "salve galera"}, token=gt)

    # realtime: owner conecta, guest manda msg no #geral via gateway
    async with websockets.connect(WS) as ows:
        await ows.send(json.dumps({"op": "identify", "token": ot}))
        ready = await recv_until(ows, "ready")
        assert ready["guilds"] and ready["guilds"][0]["id"] == gid

        async with websockets.connect(WS) as gws:
            await gws.send(json.dumps({"op": "identify", "token": gt}))
            await recv_until(gws, "ready")
            await gws.send(json.dumps({"op": "send_message", "channel_id": text_ch["id"], "content": "oi via gateway"}))
            evt = await recv_until(ows, "message_create")
            assert evt["message"]["content"] == "oi via gateway"
            print("owner recebeu msg do guild via gateway ✓")

            # voz: guest entra no canal de voz -> owner recebe voice_state_update
            await gws.send(json.dumps({"op": "rtc_join", "channel_id": voice_ch["id"]}))
            vs = await recv_until(ows, "voice_state_update")
            assert vs["channel_id"] == voice_ch["id"] and vs["user_id"] == gid_user
            print(f"voice_state_update: user {vs['user_id']} entrou em 🔊{voice_ch['name']} ✓")

    print("\nGUILDS OK ✅")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"\nFALHOU ❌  {type(e).__name__}: {e}")
        sys.exit(1)
