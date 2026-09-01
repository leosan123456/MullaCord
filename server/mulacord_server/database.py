"""Acesso ao SQLite via aiosqlite. Sem ORM — SQL direto e transparente."""
from __future__ import annotations

import asyncio
from typing import Any, Iterable, Optional

import aiosqlite

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    avatar        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS friendships (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS guilds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    icon       TEXT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guild_members (
    guild_id  INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname  TEXT,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT,
    permissions INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    hoist       INTEGER NOT NULL DEFAULT 0,
    mentionable INTEGER NOT NULL DEFAULT 0,
    is_default  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS member_roles (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id  INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (guild_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS categories (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,             -- dm | group | text | voice
    name        TEXT,                      -- null para dm
    topic       TEXT,
    owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    guild_id    INTEGER REFERENCES guilds(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Para dm/group: quem participa. Canais de guild não usam esta tabela
-- (o acesso vem das permissões).
CREATE TABLE IF NOT EXISTS channel_members (
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS channel_overwrites (
    channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,             -- role | member
    target_id   INTEGER NOT NULL,
    allow       INTEGER NOT NULL DEFAULT 0,
    deny        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    guild_id   INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    max_uses   INTEGER NOT NULL DEFAULT 0,   -- 0 = ilimitado
    expires_at TEXT,                          -- null = nunca
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    edited_at  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
    id           TEXT PRIMARY KEY,
    message_id   INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    uploader_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    stored_name  TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size         INTEGER NOT NULL,
    width        INTEGER,
    height       INTEGER,
    kind         TEXT NOT NULL,           -- image | video | file
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_members_user ON channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_guild ON channels(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_user ON guild_members(user_id);
CREATE INDEX IF NOT EXISTS idx_roles_guild ON roles(guild_id);
CREATE INDEX IF NOT EXISTS idx_member_roles ON member_roles(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_overwrites_channel ON channel_overwrites(channel_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
"""


class Database:
    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: Optional[aiosqlite.Connection] = None
        # Serializa todas as escritas. A replicação segura esse lock durante um
        # lote de apply pra nenhuma escrita local se intercalar (os triggers do
        # oplog ficam "desligados" durante o apply e voltariam a disparar no meio).
        self.write_lock = asyncio.Lock()

    async def connect(self) -> None:
        self._conn = await aiosqlite.connect(self._path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA foreign_keys = ON")
        await self._conn.execute("PRAGMA journal_mode = WAL")
        await self._conn.executescript(SCHEMA)
        await self._migrate()
        await self._conn.commit()

    async def _migrate(self) -> None:
        """Adiciona colunas novas em bancos antigos (idempotente)."""
        for table, column, ddl in (
            ("users", "avatar", "ALTER TABLE users ADD COLUMN avatar TEXT"),
            ("messages", "edited_at", "ALTER TABLE messages ADD COLUMN edited_at TEXT"),
        ):
            async with self._conn.execute(f"PRAGMA table_info({table})") as cur:
                cols = {r[1] for r in await cur.fetchall()}
            if column not in cols:
                await self._conn.execute(ddl)

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database não conectado")
        return self._conn

    async def execute(self, sql: str, params: Iterable[Any] = ()) -> aiosqlite.Cursor:
        async with self.write_lock:
            return await self.execute_nolock(sql, params)

    async def execute_nolock(self, sql: str, params: Iterable[Any] = ()) -> aiosqlite.Cursor:
        """Igual a execute() mas sem pegar o write_lock — só pra quem já o segura."""
        cur = await self.conn.execute(sql, tuple(params))
        await self.conn.commit()
        return cur

    async def fetchone(self, sql: str, params: Iterable[Any] = ()) -> Optional[aiosqlite.Row]:
        async with self.conn.execute(sql, tuple(params)) as cur:
            return await cur.fetchone()

    async def fetchall(self, sql: str, params: Iterable[Any] = ()) -> list[aiosqlite.Row]:
        async with self.conn.execute(sql, tuple(params)) as cur:
            return list(await cur.fetchall())


db = Database(str(DB_PATH))
