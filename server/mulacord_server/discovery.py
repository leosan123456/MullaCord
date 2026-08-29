"""Responder de descoberta na LAN via UDP broadcast.

O cliente manda um datagrama `MULACORD_DISCOVER <nonce>` para a porta de descoberta
(broadcast). O servidor responde com um JSON descrevendo a si mesmo. Sem dependência
externa — só o socket UDP do asyncio.
"""
from __future__ import annotations

import asyncio
import json
import logging

from . import __version__
from .config import DISCOVERY_PORT, SERVER_ID, SERVER_NAME
from .database import db

log = logging.getLogger("mulacord.discovery")

PROBE = b"MULACORD_DISCOVER"
_http_port = 8787


class _Protocol(asyncio.DatagramProtocol):
    def __init__(self) -> None:
        self.transport = None

    def connection_made(self, transport) -> None:
        self.transport = transport

    def datagram_received(self, data: bytes, addr) -> None:
        if not data.startswith(PROBE):
            return
        nonce = data[len(PROBE):].strip().decode("utf-8", "replace")[:64]
        asyncio.get_event_loop().create_task(self._reply(addr, nonce))

    async def _reply(self, addr, nonce: str) -> None:
        try:
            row = await db.fetchone("SELECT COUNT(*) AS n FROM users")
            members = row["n"] if row else 0
        except Exception:
            members = 0
        payload = json.dumps({
            "service": "mulacord",
            "nonce": nonce,
            "server_id": SERVER_ID,
            "name": SERVER_NAME,
            "version": __version__,
            "http_port": _http_port,
            "members": members,
        }).encode("utf-8")
        try:
            self.transport.sendto(payload, addr)
        except Exception as exc:  # noqa: BLE001
            log.debug("falha ao responder discovery: %s", exc)


_transport = None


async def start(http_port: int) -> None:
    global _transport, _http_port
    _http_port = http_port
    if DISCOVERY_PORT <= 0:
        return
    loop = asyncio.get_event_loop()
    try:
        _transport, _ = await loop.create_datagram_endpoint(
            _Protocol, local_addr=("0.0.0.0", DISCOVERY_PORT), allow_broadcast=True
        )
        log.info("descoberta LAN ouvindo em udp/%d", DISCOVERY_PORT)
    except OSError as exc:
        log.warning("não consegui abrir a porta de descoberta udp/%d: %s", DISCOVERY_PORT, exc)


async def stop() -> None:
    global _transport
    if _transport is not None:
        _transport.close()
        _transport = None
