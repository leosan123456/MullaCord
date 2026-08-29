"""Teste de fumaça: upload de imagem, mensagem com anexo, download com token.
Requer o servidor rodando em :8787."""
from __future__ import annotations

import io
import json
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib

B = "http://127.0.0.1:8787"


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def tiny_png(w=40, h=24) -> bytes:
    """PNG RGBA sólido, sem dependência."""
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\xf5\xc2\x1e\xff" * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def multipart_upload(channel_id, token, filename, content, ctype):
    boundary = "----mulla" + str(time.time())
    body = io.BytesIO()
    body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{filename}"\r\n'
               f'Content-Type: {ctype}\r\n\r\n'.encode())
    body.write(content)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        f"{B}/api/channels/{channel_id}/attachments", data=body.getvalue(), method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def main() -> None:
    tag = str(int(time.time()))
    a = api("POST", "/api/auth/register", {"username": "att" + tag, "password": "senha6x"})
    b = api("POST", "/api/auth/register", {"username": "out" + tag, "password": "senha6x"})
    at, bt = a["access_token"], b["access_token"]

    api("POST", "/api/friends/request", {"username": "out" + tag}, token=at)
    for f in api("GET", "/api/friends", token=bt):
        if f["direction"] == "incoming":
            api("POST", f"/api/friends/{f['id']}/accept", token=bt)
    dm = api("POST", "/api/channels/dm", {"user_id": b["user"]["id"]}, token=at)
    cid = dm["id"]

    png = tiny_png()
    uploaded = multipart_upload(cid, at, "foto.png", png, "image/png")
    assert len(uploaded) == 1
    att = uploaded[0]
    assert att["kind"] == "image" and att["width"] == 40 and att["height"] == 24, att
    print(f"upload ok — {att['filename']} {att['width']}x{att['height']} {att['size']}B")

    msg = api("POST", f"/api/channels/{cid}/messages",
              {"content": "olha isso", "attachment_ids": [att["id"]]}, token=at)
    assert msg["attachments"] and msg["attachments"][0]["id"] == att["id"]
    print("mensagem com anexo criada")

    hist = api("GET", f"/api/channels/{cid}/messages", token=bt)
    assert hist[-1]["attachments"][0]["id"] == att["id"]

    # download com ?t= (o outro membro pode ver)
    url = f"{B}{att['url']}?t={bt}"
    with urllib.request.urlopen(url) as r:
        got = r.read()
    assert got == png, "conteúdo baixado difere"
    print(f"download com token ok ({len(got)}B)")

    # terceiro (sem acesso ao DM) recebe 403
    c = api("POST", "/api/auth/register", {"username": "x" + tag, "password": "senha6x"})
    try:
        urllib.request.urlopen(f"{B}{att['url']}?t={c['access_token']}")
        print("  ! FALHA: estranho baixou anexo privado"); sys.exit(1)
    except urllib.error.HTTPError as e:
        assert e.code == 403
    print("estranho bloqueado (403) ✓")

    # arquivo não-mídia é rejeitado
    try:
        multipart_upload(cid, at, "x.txt", b"nope", "text/plain")
        print("  ! FALHA: aceitou .txt"); sys.exit(1)
    except urllib.error.HTTPError as e:
        assert e.code == 400
    print("upload de texto rejeitado (400) ✓")

    print("\nANEXOS OK ✅")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"\nFALHOU ❌  {type(e).__name__}: {e}")
        sys.exit(1)
