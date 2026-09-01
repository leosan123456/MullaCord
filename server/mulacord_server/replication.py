"""Replicação em enxame (estilo torrent).

Cada nó de uma comunidade guarda uma réplica completa. Toda escrita nas tabelas
sincronizáveis é capturada por *triggers* num log de operações (`oplog`). Os nós
trocam esse log entre si por anti-entropia (`/api/replica/sync`) e por push rápido
quando estão online — o estado converge sozinho e cura buracos com o tempo.

Resolução de conflito: last-writer-wins por (ts_ms, origin, lamport) por linha.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
import urllib.error
import urllib.request

import anyio

from .config import COMMUNITY_ID, COMMUNITY_KEY, SERVER_ID
from .database import db

log = logging.getLogger("mulacord.replication")

NODE_ID = SERVER_ID

# tabela -> colunas (na ordem do schema) ; a 1ª entrada de PK abaixo é a chave
COLUMNS: dict[str, list[str]] = {
    "users": ["id", "username", "email", "password_hash", "display_name", "avatar", "created_at"],
    "friendships": ["id", "requester_id", "addressee_id", "status", "created_at"],
    "guilds": ["id", "name", "icon", "owner_id", "created_at"],
    "guild_members": ["guild_id", "user_id", "nickname", "joined_at"],
    "roles": ["id", "guild_id", "name", "color", "permissions", "position", "hoist", "mentionable", "is_default"],
    "member_roles": ["guild_id", "user_id", "role_id"],
    "categories": ["id", "guild_id", "name", "position"],
    "channels": ["id", "type", "name", "topic", "owner_id", "guild_id", "category_id", "position", "created_at"],
    "channel_members": ["channel_id", "user_id", "joined_at"],
    "channel_overwrites": ["channel_id", "target_type", "target_id", "allow", "deny"],
    "invites": ["code", "guild_id", "creator_id", "uses", "max_uses", "expires_at", "created_at"],
    "messages": ["id", "channel_id", "author_id", "content", "edited_at", "created_at"],
    "attachments": ["id", "message_id", "channel_id", "uploader_id", "filename", "stored_name",
                    "content_type", "size", "width", "height", "kind", "created_at"],
}
PK: dict[str, list[str]] = {
    "users": ["id"], "friendships": ["id"], "guilds": ["id"],
    "guild_members": ["guild_id", "user_id"], "roles": ["id"],
    "member_roles": ["guild_id", "user_id", "role_id"], "categories": ["id"],
    "channels": ["id"], "channel_members": ["channel_id", "user_id"],
    "channel_overwrites": ["channel_id", "target_type", "target_id"],
    "invites": ["code"], "messages": ["id"], "attachments": ["id"],
}

SYNC_TABLES = list(COLUMNS)
MAX_EVENTS_PER_SYNC = 1500

# ---------------------------------------------------------------- chave da comunidade
def community_key() -> str:
    return COMMUNITY_KEY


def check_key(header_value: str | None) -> bool:
    return bool(header_value) and hmac.compare_digest(header_value, COMMUNITY_KEY)


# ---------------------------------------------------------------- schema + triggers
_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"

SCHEMA = """
CREATE TABLE IF NOT EXISTS oplog (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    origin     TEXT NOT NULL,
    lamport    INTEGER NOT NULL,
    table_name TEXT NOT NULL,
    op         TEXT NOT NULL,
    pk         TEXT NOT NULL,
    data       TEXT,
    ts_ms      INTEGER NOT NULL,
    UNIQUE(origin, lamport)
);
CREATE INDEX IF NOT EXISTS idx_oplog_row ON oplog(table_name, pk, ts_ms);
CREATE INDEX IF NOT EXISTS idx_oplog_origin ON oplog(origin, lamport);

CREATE TABLE IF NOT EXISTS repl_meta (k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE IF NOT EXISTS repl_peers (
    url        TEXT PRIMARY KEY,
    community  TEXT,
    last_seen  INTEGER,
    last_ok    INTEGER
);
"""


def _json_object(table: str, ref: str) -> str:
    parts = []
    for c in COLUMNS[table]:
        parts.append(f"'{c}'")
        parts.append(f"{ref}.{c}")
    return "json_object(" + ", ".join(parts) + ")"


def _json_pk(table: str, ref: str) -> str:
    return "json_array(" + ", ".join(f"{ref}.{c}" for c in PK[table]) + ")"


def _trigger_sql(table: str) -> list[str]:
    guard = "(SELECT v FROM repl_meta WHERE k='apply_guard') IS '1'"
    bump = "UPDATE repl_meta SET v = CAST(v AS INTEGER) + 1 WHERE k='lamport';"
    lam = "(SELECT CAST(v AS INTEGER) FROM repl_meta WHERE k='lamport')"
    out = []
    for op, ref, when_extra in (("insert", "NEW", ""), ("update", "NEW", ""), ("delete", "OLD", "")):
        data_expr = "NULL" if op == "delete" else _json_object(table, ref)
        out.append(f"""
CREATE TRIGGER oplog_{table}_{op} AFTER {op.upper()} ON {table}
WHEN NOT {guard}
BEGIN
  {bump}
  INSERT INTO oplog(origin, lamport, table_name, op, pk, data, ts_ms)
  VALUES ('{NODE_ID}', {lam}, '{table}', '{op}', {_json_pk(table, ref)}, {data_expr}, {_MS});
END;""")
    return out


async def _get(k: str, default: str = "") -> str:
    row = await db.fetchone("SELECT v FROM repl_meta WHERE k=?", (k,))
    return row["v"] if row else default


async def _set(k: str, v: str) -> None:
    await db.execute(
        "INSERT INTO repl_meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (k, v),
    )


async def setup() -> None:
    """Cria oplog + triggers e faz o backfill inicial (idempotente)."""
    await db.conn.executescript(SCHEMA)
    await db.conn.commit()
    for k, v in (("lamport", "0"), ("apply_guard", "0"), ("backfilled", "0")):
        if await _get(k, None) is None:
            await _set(k, v)
    await _set("apply_guard", "0")  # nunca começa travado

    # recria triggers com o NODE_ID atual embutido
    for t in SYNC_TABLES:
        for op in ("insert", "update", "delete"):
            await db.conn.execute(f"DROP TRIGGER IF EXISTS oplog_{t}_{op}")
    for t in SYNC_TABLES:
        for sql in _trigger_sql(t):
            await db.conn.execute(sql)
    await db.conn.commit()

    if await _get("idcounter", None) is None:
        await _set("idcounter", "0")

    if await _get("backfilled") != "1":
        await _backfill()
        await _set("backfilled", "1")
    log.info("replicação pronta — nó %s, faixa de id %d, %d eventos no log",
             NODE_ID[:8], _node_band(), await _oplog_count())


# Cada nó emite ids numa faixa própria (estilo torrent: nós criam ids offline sem
# se falar). Não dá pra usar AUTOINCREMENT porque, depois que uma linha de id alto
# de outro nó replica pra cá, o MAX(rowid) local "pula" e passa a colidir. Então
# os ids são alocados pela aplicação: faixa_do_nó + contador_local.
# Faixa de 100M ids por nó, ~500k faixas -> id máx ~5e13, bem abaixo do limite
# seguro do JS (2^53 ≈ 9e15) que o cliente usa.
_ID_BAND = 100_000_000


def _node_band() -> int:
    h = int(hashlib.sha1(NODE_ID.encode("utf-8")).hexdigest()[:12], 16)
    return (h % 500_000 + 1) * _ID_BAND


async def next_id() -> int:
    """Id inteiro globalmente único neste nó (serve pra qualquer tabela)."""
    async with db.write_lock:
        cur = await db.conn.execute(
            "UPDATE repl_meta SET v = CAST(v AS INTEGER) + 1 WHERE k='idcounter' RETURNING v"
        )
        row = await cur.fetchone()
        await db.conn.commit()
    return _node_band() + int(row[0])


async def _oplog_count() -> int:
    row = await db.fetchone("SELECT COUNT(*) n FROM oplog")
    return row["n"] if row else 0


async def _backfill() -> None:
    """Gera um evento 'insert' para cada linha que já existe (installs antigos)."""
    lam = int(await _get("lamport", "0"))
    now_ms = int(time.time() * 1000)
    total = 0
    for table in SYNC_TABLES:
        cols = COLUMNS[table]
        rows = await db.fetchall(f"SELECT {', '.join(cols)} FROM {table}")
        for r in rows:
            lam += 1
            data = json.dumps({c: r[c] for c in cols})
            pkj = json.dumps([r[c] for c in PK[table]])
            await db.execute(
                "INSERT OR IGNORE INTO oplog(origin, lamport, table_name, op, pk, data, ts_ms) "
                "VALUES(?,?,?,?,?,?,?)",
                (NODE_ID, lam, table, "insert", pkj, data, now_ms),
            )
            total += 1
    await _set("lamport", str(lam))
    log.info("backfill: %d linhas viraram eventos", total)


# ---------------------------------------------------------------- vetor + export
async def vector() -> dict[str, int]:
    rows = await db.fetchall("SELECT origin, MAX(lamport) m FROM oplog GROUP BY origin")
    return {r["origin"]: r["m"] for r in rows}


async def changes_since(since: dict[str, int], limit: int = MAX_EVENTS_PER_SYNC) -> list[dict]:
    rows = await db.fetchall(
        "SELECT origin, lamport, table_name, op, pk, data, ts_ms FROM oplog ORDER BY seq ASC"
    )
    out = []
    for r in rows:
        if r["lamport"] <= since.get(r["origin"], 0):
            continue
        out.append({
            "origin": r["origin"], "lamport": r["lamport"], "table": r["table_name"],
            "op": r["op"], "pk": r["pk"], "data": r["data"], "ts_ms": r["ts_ms"],
        })
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------- apply (LWW)
async def _materialize(table: str, op: str, pk_vals: list, data: dict | None) -> None:
    cols = COLUMNS[table]
    pk_cols = PK[table]
    if op == "delete":
        where = " AND ".join(f"{c} IS ?" for c in pk_cols)
        await db.execute_nolock(f"DELETE FROM {table} WHERE {where}", pk_vals)
        return
    vals = [data.get(c) for c in cols]
    placeholders = ", ".join("?" for _ in cols)
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c not in pk_cols)
    conflict = ", ".join(pk_cols)
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT({conflict}) DO UPDATE SET {updates}"
        if updates else
        f"INSERT OR IGNORE INTO {table} ({', '.join(cols)}) VALUES ({placeholders})"
    )
    await db.execute_nolock(sql, vals)


async def _try_materialize(e: dict) -> bool:
    try:
        await _materialize(
            e["table"], e["op"], json.loads(e["pk"]),
            json.loads(e["data"]) if e.get("data") else None,
        )
        return True
    except Exception as exc:  # noqa: BLE001  (ex.: FK — o pai ainda não chegou)
        log.debug("materialize %s/%s adiado: %s", e["table"], e["op"], exc)
        return False


async def apply(events: list[dict]) -> list[dict]:
    """Aplica eventos remotos. Devolve os que foram materializados (pra realtime).

    Segura o write_lock o lote inteiro: com o guard dos triggers ligado, nenhuma
    escrita local pode se intercalar e escapar do oplog.
    """
    if not events:
        return []
    applied: list[dict] = []
    async with db.write_lock:
        await db.execute_nolock(
            "INSERT INTO repl_meta(k,v) VALUES('apply_guard','1') ON CONFLICT(k) DO UPDATE SET v='1'"
        )
        try:
            events = sorted(events, key=lambda e: (e["ts_ms"], e["origin"], e["lamport"]))
            deferred: list[dict] = []
            for e in events:
                dup = await db.fetchone(
                    "SELECT 1 FROM oplog WHERE origin=? AND lamport=?", (e["origin"], e["lamport"])
                )
                if dup:
                    continue
                await db.execute_nolock(
                    "INSERT INTO oplog(origin, lamport, table_name, op, pk, data, ts_ms) VALUES(?,?,?,?,?,?,?)",
                    (e["origin"], e["lamport"], e["table"], e["op"], e["pk"], e.get("data"), e["ts_ms"]),
                )
                newest = await db.fetchone(
                    "SELECT ts_ms, origin, lamport FROM oplog WHERE table_name=? AND pk=? "
                    "ORDER BY ts_ms DESC, origin DESC, lamport DESC LIMIT 1",
                    (e["table"], e["pk"]),
                )
                if (newest["ts_ms"], newest["origin"], newest["lamport"]) != (e["ts_ms"], e["origin"], e["lamport"]):
                    continue  # já existe um evento mais novo pra essa linha
                if await _try_materialize(e):
                    applied.append(e)
                else:
                    deferred.append(e)
            # 2 passadas extras: cobre "filho antes do pai" quando o clock desalinha
            for _ in range(2):
                if not deferred:
                    break
                still = []
                for e in deferred:
                    (applied if await _try_materialize(e) else still).append(e)
                deferred = still
        finally:
            await db.execute_nolock(
                "INSERT INTO repl_meta(k,v) VALUES('apply_guard','0') ON CONFLICT(k) DO UPDATE SET v='0'"
            )

    await _dispatch_realtime(applied)
    return applied


_GUILD_TABLES = {
    "guilds", "roles", "member_roles", "categories", "channel_overwrites", "guild_members",
}


async def _guild_id_of(table: str, pk_vals: list, data: dict | None) -> int | None:
    if table == "guilds":
        return pk_vals[0]
    if data and data.get("guild_id"):
        return data["guild_id"]
    if table == "roles":
        row = await db.fetchone("SELECT guild_id FROM roles WHERE id=?", (pk_vals[0],))
        return row["guild_id"] if row else None
    if table == "categories":
        row = await db.fetchone("SELECT guild_id FROM categories WHERE id=?", (pk_vals[0],))
        return row["guild_id"] if row else None
    if table == "channel_overwrites":
        row = await db.fetchone("SELECT guild_id FROM channels WHERE id=?", (pk_vals[0],))
        return row["guild_id"] if row else None
    if table in ("guild_members", "member_roles"):
        return pk_vals[0]
    return None


async def _dispatch_realtime(applied: list[dict]) -> None:
    if not applied:
        return
    try:
        from .realtime.manager import manager
        from .routers.messages import _serialize, attachments_for
        from .guilds_service import serialize_guild
        from .deps import serialize_channel
    except Exception:
        return

    touched_guilds: set[int] = set()
    new_members: list[tuple[int, int]] = []  # (guild_id, user_id)

    for e in applied:
        try:
            tbl, op = e["table"], e["op"]
            pk = json.loads(e["pk"])
            data = json.loads(e["data"]) if e.get("data") else None

            if tbl == "messages" and op in ("insert", "update"):
                mid = pk[0]
                row = await db.fetchone(
                    "SELECT m.*, u.username, u.display_name, u.avatar FROM messages m "
                    "JOIN users u ON u.id = m.author_id WHERE m.id = ?", (mid,)
                )
                if not row:
                    continue
                atts = (await attachments_for([mid])).get(mid)
                t = "message_create" if op == "insert" else "message_update"
                await manager.broadcast_channel(row["channel_id"], {"t": t, "message": _serialize(row, atts)})

            elif tbl == "messages" and op == "delete":
                cid = (data or {}).get("channel_id")
                if cid:
                    await manager.broadcast_channel(
                        cid, {"t": "message_delete", "channel_id": cid, "message_id": pk[0]}
                    )

            elif tbl == "friendships":
                d = data or {}
                evt = "friend_accepted" if d.get("status") == "accepted" else "friend_request"
                for uid in (d.get("requester_id"), d.get("addressee_id")):
                    if uid:
                        await manager.notify_user(uid, {"t": evt, "user": None})

            elif tbl == "channels" and (data or {}).get("guild_id") is None and op == "insert":
                cid = pk[0]
                rows = await db.fetchall("SELECT user_id FROM channel_members WHERE channel_id=?", (cid,))
                ch = await serialize_channel(cid)
                for r in rows:
                    await manager.notify_user(r["user_id"], {"t": "channel_create", "channel": ch})

            elif tbl == "channels" and (data or {}).get("guild_id"):
                touched_guilds.add(data["guild_id"])

            elif tbl in _GUILD_TABLES:
                gid = await _guild_id_of(tbl, pk, data)
                if gid:
                    touched_guilds.add(gid)
                    if tbl == "guild_members" and op == "insert":
                        new_members.append((gid, pk[1]))

        except Exception as exc:  # noqa: BLE001
            log.debug("dispatch realtime %s/%s: %s", e.get("table"), e.get("op"), exc)

    # um refresh de guild por guild afetada (grosso, mas correto)
    for gid in touched_guilds:
        try:
            payload = await serialize_guild(gid)
            await manager.broadcast_guild(gid, {"t": "guild_update", "guild": payload})
            for g2, uid in new_members:
                if g2 == gid:
                    await manager.notify_user(uid, {"t": "guild_create", "guild": payload})
        except Exception as exc:  # noqa: BLE001
            log.debug("dispatch guild %s: %s", gid, exc)


# ---------------------------------------------------------------- peers + gossip
async def note_peer(url: str, community: str | None = None) -> None:
    url = url.rstrip("/")
    if not url or "127.0.0.1" in url or "localhost" in url:
        return
    now = int(time.time())
    await db.execute(
        "INSERT INTO repl_peers(url, community, last_seen) VALUES(?,?,?) "
        "ON CONFLICT(url) DO UPDATE SET last_seen=excluded.last_seen, "
        "community=COALESCE(excluded.community, repl_peers.community)",
        (url, community, now),
    )


async def known_peers() -> list[str]:
    rows = await db.fetchall("SELECT url FROM repl_peers ORDER BY last_ok DESC NULLS LAST, last_seen DESC")
    peers = [r["url"] for r in rows]
    for p in os.environ.get("MULACORD_BOOTSTRAP_PEERS", "").split(","):
        p = p.strip().rstrip("/")
        if p and p not in peers:
            peers.append(p if p.startswith("http") else f"http://{p}")
    return peers


_gossip_task: "asyncio.Task | None" = None


def _http_post_json(url: str, body: dict, timeout: float = 8.0) -> dict | None:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json",
        "X-Comm-Key": community_key(),
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None


async def _post_json(url: str, body: dict, timeout: float = 8.0) -> dict | None:
    return await anyio.to_thread.run_sync(lambda: _http_post_json(url, body, timeout))


def _own_address() -> str:
    pub = os.environ.get("MULACORD_PUBLIC_HOST", "").strip()
    if pub:
        return pub if pub.startswith("http") else f"http://{pub}"
    port = os.environ.get("MULACORD_PORT", "8787")
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return f"http://{ip}:{port}"
    except OSError:
        return ""


async def _sync_with(peer: str) -> None:
    body = {
        "since": await vector(),
        "self": _own_address(),
        "peers": [p for p in await known_peers() if p != peer][:20],
        "community": COMMUNITY_ID,
    }
    data = await _post_json(f"{peer}/api/replica/sync", body)
    if not data:
        return
    await apply(data.get("events") or [])
    for p in data.get("peers") or []:
        await note_peer(p, COMMUNITY_ID)
    await db.execute("UPDATE repl_peers SET last_ok=? WHERE url=?", (int(time.time()), peer))


async def gossip_once() -> None:
    peers = await known_peers()
    for peer in peers[:6]:
        try:
            await _sync_with(peer)
        except Exception as exc:  # noqa: BLE001
            log.debug("sync com %s falhou: %s", peer, exc)


async def _prune_oplog() -> None:
    """Compacta o log: pra cada linha, só o evento mais novo precisa sobreviver
    (LWW). Mantém tudo dos últimos 10 min pra não atrapalhar a gossip em curso."""
    cutoff = int(time.time() * 1000) - 10 * 60 * 1000
    async with db.write_lock:
        cur = await db.conn.execute(
            """
            DELETE FROM oplog WHERE ts_ms < ? AND seq NOT IN (
              SELECT seq FROM (
                SELECT seq, ROW_NUMBER() OVER (
                  PARTITION BY table_name, pk ORDER BY ts_ms DESC, origin DESC, lamport DESC
                ) rn FROM oplog
              ) WHERE rn = 1
            )
            """,
            (cutoff,),
        )
        await db.conn.commit()
        if cur.rowcount:
            log.info("oplog: %d eventos superados removidos", cur.rowcount)


async def _gossip_loop() -> None:
    await asyncio.sleep(4)
    n = 0
    while True:
        try:
            await gossip_once()
            n += 1
            if n % 40 == 0:  # ~a cada 5 min
                await _prune_oplog()
        except Exception as exc:  # noqa: BLE001
            log.debug("gossip: %s", exc)
        await asyncio.sleep(int(os.environ.get("MULACORD_GOSSIP_SECONDS", "8")))


async def _push_loop() -> None:
    """Empurra eventos locais novos pros peers quase na hora (caminho rápido)."""
    await asyncio.sleep(2)
    last = 0
    row = await db.fetchone("SELECT MAX(lamport) m FROM oplog WHERE origin=?", (NODE_ID,))
    last = row["m"] or 0 if row else 0
    while True:
        await asyncio.sleep(0.5)
        try:
            rows = await db.fetchall(
                "SELECT origin, lamport, table_name, op, pk, data, ts_ms FROM oplog "
                "WHERE origin=? AND lamport>? ORDER BY lamport ASC", (NODE_ID, last),
            )
            if not rows:
                continue
            events = [{
                "origin": r["origin"], "lamport": r["lamport"], "table": r["table_name"],
                "op": r["op"], "pk": r["pk"], "data": r["data"], "ts_ms": r["ts_ms"],
            } for r in rows]
            last = rows[-1]["lamport"]
            await push_to_peers(events)
        except Exception as exc:  # noqa: BLE001
            log.debug("push loop: %s", exc)


async def push_to_peers(events: list[dict]) -> None:
    """Fast-path: manda eventos recém-criados localmente pros peers conhecidos."""
    if not events:
        return
    for peer in (await known_peers())[:12]:
        await _post_json(f"{peer}/api/replica/push", {"events": events}, timeout=5.0)


async def recent_local_events(limit: int = 50) -> list[dict]:
    rows = await db.fetchall(
        "SELECT origin, lamport, table_name, op, pk, data, ts_ms FROM oplog "
        "WHERE origin=? ORDER BY seq DESC LIMIT ?", (NODE_ID, limit),
    )
    return [{
        "origin": r["origin"], "lamport": r["lamport"], "table": r["table_name"],
        "op": r["op"], "pk": r["pk"], "data": r["data"], "ts_ms": r["ts_ms"],
    } for r in reversed(rows)]


_push_task: "asyncio.Task | None" = None


async def start_gossip() -> None:
    global _gossip_task, _push_task
    if _gossip_task is None:
        _gossip_task = asyncio.create_task(_gossip_loop())
    if _push_task is None:
        _push_task = asyncio.create_task(_push_loop())


async def stop_gossip() -> None:
    global _gossip_task, _push_task
    for t in (_gossip_task, _push_task):
        if t:
            t.cancel()
    _gossip_task = _push_task = None
