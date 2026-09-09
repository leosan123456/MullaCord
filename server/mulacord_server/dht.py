"""Descoberta de peers pela internet via BitTorrent Mainline DHT (BEP 5).

Não há servidor do Mulla Cord: a gente pega carona na DHT global do BitTorrent
(milhões de nós, bootstrap público já existente). Cada comunidade vira um
"infohash" = sha1(b"mullacord:v1:" + community_id). O nó:

  - a cada ~4 min faz get_peers(infohash) e announce_peer(infohash, porta_http);
  - os IPs:portas que voltam viram peers de replicação (replication.note_peer);
  - responde queries básicas (ping/find_node/get_peers/announce_peer) pra ficar
    na tabela de roteamento dos outros e o announce durar.

Só stdlib. Desliga com MULACORD_DHT=0. A porta HTTP anunciada precisa estar
alcançável (UPnP ou port-forward) pra conexão fechar — a DHT só *acha* o peer.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import secrets
import socket
import struct
import time

log = logging.getLogger("mulacord.dht")

BOOTSTRAP = [
    ("router.bittorrent.com", 6881),
    ("router.utorrent.com", 6881),
    ("dht.transmissionbt.com", 6881),
    ("dht.libtorrent.org", 25401),
    ("router.bittorrent.cloud", 42069),
]

ANNOUNCE_EVERY = int(os.environ.get("MULACORD_DHT_SECONDS", "240"))
K = 8  # nós por passo de busca


# ---------------------------------------------------------------- bencode
def _bencode(v) -> bytes:
    if isinstance(v, int):
        return b"i%de" % v
    if isinstance(v, bytes):
        return b"%d:%s" % (len(v), v)
    if isinstance(v, str):
        return _bencode(v.encode())
    if isinstance(v, list):
        return b"l" + b"".join(_bencode(x) for x in v) + b"e"
    if isinstance(v, dict):
        out = b"d"
        for k in sorted(v):
            kk = k if isinstance(k, bytes) else k.encode()
            out += _bencode(kk) + _bencode(v[k])
        return out + b"e"
    raise TypeError(type(v))


def _bdecode(data: bytes):
    def parse(i):
        c = data[i:i + 1]
        if c == b"i":
            j = data.index(b"e", i)
            return int(data[i + 1:j]), j + 1
        if c == b"l":
            i += 1
            out = []
            while data[i:i + 1] != b"e":
                x, i = parse(i)
                out.append(x)
            return out, i + 1
        if c == b"d":
            i += 1
            out = {}
            while data[i:i + 1] != b"e":
                k, i = parse(i)
                x, i = parse(i)
                out[k] = x
            return out, i + 1
        if c.isdigit():
            j = data.index(b":", i)
            n = int(data[i:j])
            s = data[j + 1:j + 1 + n]
            return s, j + 1 + n
        raise ValueError(f"bencode bad char {c!r} @ {i}")

    return parse(0)[0]


# ---------------------------------------------------------------- helpers
def _distance(a: bytes, b: bytes) -> int:
    return int.from_bytes(a, "big") ^ int.from_bytes(b, "big")


def _decode_nodes(blob: bytes):
    """compact node info: 20b id + 4b ip + 2b port, repetido."""
    out = []
    for i in range(0, len(blob) - 25, 26):
        nid = blob[i:i + 20]
        ip = socket.inet_ntoa(blob[i + 20:i + 24])
        port = struct.unpack("!H", blob[i + 24:i + 26])[0]
        if port:
            out.append((nid, ip, port))
    return out


def _decode_values(vals):
    out = []
    for v in vals or []:
        if isinstance(v, bytes) and len(v) == 6:
            ip = socket.inet_ntoa(v[:4])
            port = struct.unpack("!H", v[4:6])[0]
            if port:
                out.append((ip, port))
    return out


def infohash_for(community_id: str, secret: str = "") -> bytes:
    seed = b"mullacord:v1:" + community_id.encode()
    if secret:
        seed += b":" + hashlib.sha256(secret.encode()).digest()[:8]
    return hashlib.sha1(seed).digest()


# ---------------------------------------------------------------- protocol
class _KRPC(asyncio.DatagramProtocol):
    def __init__(self, dht: "DHT") -> None:
        self.dht = dht

    def connection_made(self, transport) -> None:
        self.dht.transport = transport

    def datagram_received(self, data: bytes, addr) -> None:
        try:
            msg = _bdecode(data)
        except Exception:
            return
        t = msg.get(b"y")
        if t == b"r":
            self.dht._on_response(msg, addr)
        elif t == b"q":
            self.dht._on_query(msg, addr)
        # y == b"e": erro, ignora


class DHT:
    def __init__(self, http_port: int, community_id: str, secret: str = "") -> None:
        self.http_port = http_port
        self.node_id = secrets.token_bytes(20)
        self.infohash = infohash_for(community_id, secret)
        self.transport: asyncio.DatagramTransport | None = None
        self.nodes: dict[bytes, tuple[str, int]] = {}   # node_id -> (ip, port)
        self._pending: dict[bytes, asyncio.Future] = {}  # tid -> future(response dict)
        self._tid = 0
        self._task: asyncio.Task | None = None
        self._on_peer = None  # callback(ip, port)

    # -- envio -------------------------------------------------------
    def _next_tid(self) -> bytes:
        self._tid = (self._tid + 1) & 0xFFFF
        return struct.pack("!H", self._tid)

    async def _query(self, addr, q: str, args: dict, timeout: float = 3.0):
        if not self.transport:
            return None
        tid = self._next_tid()
        args = {**args, "id": self.node_id}
        pkt = _bencode({b"t": tid, b"y": b"q", b"q": q.encode(), b"a": args})
        fut = asyncio.get_event_loop().create_future()
        self._pending[tid] = fut
        try:
            self.transport.sendto(pkt, addr)
            return await asyncio.wait_for(fut, timeout)
        except (asyncio.TimeoutError, OSError):
            return None
        finally:
            self._pending.pop(tid, None)

    def _reply(self, addr, tid: bytes, resp: dict) -> None:
        if not self.transport:
            return
        try:
            self.transport.sendto(
                _bencode({b"t": tid, b"y": b"r", b"r": {**resp, "id": self.node_id}}), addr
            )
        except OSError:
            pass

    # -- recepção --------------------------------------------------
    def _on_response(self, msg: dict, addr) -> None:
        tid = msg.get(b"t")
        fut = self._pending.get(tid)
        if fut and not fut.done():
            fut.set_result(msg.get(b"r") or {})
        r = msg.get(b"r") or {}
        for nid, ip, port in _decode_nodes(r.get(b"nodes", b"") or b""):
            if nid != self.node_id and len(self.nodes) < 400:
                self.nodes[nid] = (ip, port)

    def _closest(self, target: bytes, n: int = K):
        return sorted(self.nodes.items(), key=lambda kv: _distance(kv[0], target))[:n]

    def _on_query(self, msg: dict, addr) -> None:
        tid = msg.get(b"t", b"")
        q = msg.get(b"q")
        a = msg.get(b"a") or {}
        nid = a.get(b"id")
        if isinstance(nid, bytes) and len(nid) == 20 and len(self.nodes) < 400:
            self.nodes[nid] = addr
        if q == b"ping":
            self._reply(addr, tid, {})
        elif q == b"find_node":
            target = a.get(b"target") or self.node_id
            self._reply(addr, tid, {"nodes": self._compact_nodes(target)})
        elif q == b"get_peers":
            token = hashlib.sha1(socket.inet_aton(addr[0]) + b"mc").digest()[:4]
            self._reply(addr, tid, {"token": token, "nodes": self._compact_nodes(a.get(b"info_hash") or self.node_id)})
        elif q == b"announce_peer":
            self._reply(addr, tid, {})

    def _compact_nodes(self, target: bytes) -> bytes:
        out = b""
        for nid, (ip, port) in self._closest(target):
            try:
                out += nid + socket.inet_aton(ip) + struct.pack("!H", port)
            except OSError:
                pass
        return out

    # -- rotina ---------------------------------------------------
    async def _bootstrap(self) -> None:
        for host, port in BOOTSTRAP:
            try:
                addr = (socket.gethostbyname(host), port)
            except OSError:
                continue
            r = await self._query(addr, "find_node", {"target": self.node_id})
            if r:
                for nid, ip, p in _decode_nodes(r.get(b"nodes", b"") or b""):
                    self.nodes[nid] = (ip, p)

    async def _walk(self):
        """Aproxima da infohash com get_peers; devolve (peers, [(node, addr, token)])."""
        peers: set[tuple[str, int]] = set()
        holders: dict[bytes, tuple] = {}   # node_id -> (addr, token)
        seen: set[bytes] = set()
        for _ in range(6):
            targets = [kv for kv in self._closest(self.infohash, 12) if kv[0] not in seen]
            if not targets:
                break
            results = await asyncio.gather(
                *[self._query(addr, "get_peers", {"info_hash": self.infohash}, timeout=4.0)
                  for _, addr in targets],
                return_exceptions=True,
            )
            progressed = False
            for (nid, addr), r in zip(targets, results):
                seen.add(nid)
                if not isinstance(r, dict):
                    continue
                for ip, p in _decode_values(r.get(b"values")):
                    peers.add((ip, p))
                tok = r.get(b"token")
                if isinstance(tok, bytes) and tok:
                    holders[nid] = (addr, tok)
                for n2, ip2, p2 in _decode_nodes(r.get(b"nodes", b"") or b""):
                    if n2 not in self.nodes:
                        self.nodes[n2] = (ip2, p2)
                        progressed = True
            if not progressed and holders:
                break
        # os holders mais próximos da infohash são os que valem pro announce
        near = sorted(holders.items(), key=lambda kv: _distance(kv[0], self.infohash))
        return peers, [(nid, addr, tok) for nid, (addr, tok) in near]

    async def _cycle(self) -> None:
        if len(self.nodes) < 8:
            await self._bootstrap()
        if not self.nodes:
            return
        peers, holders = await self._walk()
        for ip, port in peers:
            if self._on_peer:
                try:
                    self._on_peer(ip, port)
                except Exception:  # noqa: BLE001
                    pass
        # anuncia nos K nós mais próximos que deram token
        for nid, addr, token in holders[:K]:
            await self._query(addr, "announce_peer", {
                "info_hash": self.infohash,
                "port": self.http_port,
                "token": token,
                "implied_port": 0,
            })
        if peers:
            log.info("DHT: %d peer(s) da comunidade, %d nós na tabela", len(peers), len(self.nodes))

    async def _loop(self) -> None:
        await asyncio.sleep(3)
        first = True
        while True:
            try:
                await self._cycle()
            except Exception as exc:  # noqa: BLE001
                log.debug("DHT ciclo: %s", exc)
            await asyncio.sleep(20 if first and len(self.nodes) < 30 else ANNOUNCE_EVERY)
            first = False

    async def start(self, on_peer) -> None:
        self._on_peer = on_peer
        loop = asyncio.get_event_loop()
        try:
            await loop.create_datagram_endpoint(
                lambda: _KRPC(self), local_addr=("0.0.0.0", 0)
            )
        except OSError as exc:
            log.warning("DHT: não abriu socket UDP: %s", exc)
            return
        self._task = asyncio.create_task(self._loop())
        log.info("DHT ligada — infohash %s", self.infohash.hex()[:16])

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        if self.transport:
            self.transport.close()
            self.transport = None


# ---------------------------------------------------------------- fachada
_dht: DHT | None = None


async def start(http_port: int, community_id: str, secret: str = "") -> None:
    global _dht
    if os.environ.get("MULACORD_DHT", "1") == "0":
        return
    from . import replication

    _dht = DHT(http_port, community_id, secret)

    def _peer(ip: str, port: int) -> None:
        if ip.startswith(("127.", "10.", "192.168.", "169.254.")) or ip == "0.0.0.0":
            return
        asyncio.create_task(replication.note_peer(f"http://{ip}:{port}", community_id))

    await _dht.start(_peer)


async def stop() -> None:
    global _dht
    if _dht:
        await _dht.stop()
        _dht = None
