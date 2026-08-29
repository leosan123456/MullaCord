"""Teste de fumaça: descoberta LAN por UDP + campos novos do /api/info.
Requer o servidor rodando em :8787 (com MULACORD_HOST=127.0.0.1 a descoberta ainda
escuta em 0.0.0.0:8788)."""
from __future__ import annotations

import json
import socket
import sys
import urllib.request


def main() -> None:
    info = json.load(urllib.request.urlopen("http://127.0.0.1:8787/api/info"))
    assert info["service"] == "mulacord"
    for k in ("server_id", "name", "version", "members", "open_registration", "discovery_port"):
        assert k in info, f"faltou {k} em /api/info"
    print(f"/api/info ok — server_id={info['server_id'][:8]}… discovery_port={info['discovery_port']}")

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(3)
    s.sendto(b"MULACORD_DISCOVER abc123", ("127.0.0.1", info["discovery_port"]))
    data, addr = s.recvfrom(2048)
    reply = json.loads(data)
    assert reply["service"] == "mulacord"
    assert reply["nonce"] == "abc123"
    assert reply["server_id"] == info["server_id"]
    assert reply["http_port"] == 8787
    print(f"descoberta UDP ok — '{reply['name']}' em {addr[0]}, {reply['members']} membros")
    print("\nDESCOBERTA OK ✅")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"\nFALHOU ❌  {type(e).__name__}: {e}")
        sys.exit(1)
