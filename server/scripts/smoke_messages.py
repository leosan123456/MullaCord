"""Teste de fumaça: perfil/avatar + editar/apagar mensagem. Requer o servidor em :8787."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

B = "http://127.0.0.1:8787"


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"  ! {method} {path} -> {e.code}: {e.read().decode()[:200]}")
        raise


def main() -> None:
    tag = str(int(time.time()))
    u1 = api("POST", "/api/auth/register",
             {"username": "u1" + tag, "email": f"u1{tag}@m.co", "password": "senha12345"})
    u2 = api("POST", "/api/auth/register",
             {"username": "u2" + tag, "email": f"u2{tag}@m.co", "password": "senha12345"})
    t1, t2 = u1["access_token"], u2["access_token"]

    prof = api("PATCH", "/api/auth/me",
               {"display_name": "Fulano", "avatar": "data:image/png;base64,AAAA"}, token=t1)
    assert prof["display_name"] == "Fulano" and prof["avatar"].startswith("data:"), prof
    print(f"perfil atualizado: {prof['display_name']} (avatar {len(prof['avatar'])} chars)")

    api("POST", "/api/friends/request", {"username": "u2" + tag}, token=t1)
    for f in api("GET", "/api/friends", token=t2):
        if f["direction"] == "incoming":
            api("POST", f"/api/friends/{f['id']}/accept", token=t2)
            assert f["user"]["display_name"] == "Fulano"
    dm = api("POST", "/api/channels/dm", {"user_id": u2["user"]["id"]}, token=t1)
    cid = dm["id"]

    msg = api("POST", f"/api/channels/{cid}/messages", {"content": "ola @u2"}, token=t1)
    assert msg["edited_at"] is None
    ed = api("PATCH", f"/api/channels/{cid}/messages/{msg['id']}", {"content": "editada"}, token=t1)
    assert ed["content"] == "editada" and ed["edited_at"], ed
    print(f"mensagem editada, edited_at = {ed['edited_at']}")

    try:
        api("PATCH", f"/api/channels/{cid}/messages/{msg['id']}", {"content": "hack"}, token=t2)
        print("  ! FALHA: u2 editou msg alheia"); sys.exit(1)
    except urllib.error.HTTPError as e:
        assert e.code == 403
    print("u2 bloqueado de editar msg alheia ✓")

    api("DELETE", f"/api/channels/{cid}/messages/{msg['id']}", token=t1)
    assert not api("GET", f"/api/channels/{cid}/messages", token=t1)
    print("mensagem apagada ✓")
    print("\nMENSAGENS/PERFIL OK ✅")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"\nFALHOU ❌  {type(e).__name__}: {e}")
        sys.exit(1)
