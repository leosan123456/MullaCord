"""Configuração e caminhos de runtime."""
from __future__ import annotations

import os
import secrets
import sys
import time
import uuid
from pathlib import Path

# Momento em que o processo do nó subiu — usado na eleição do coordenador
# (empate de prioridade vai pro nó que está no ar há mais tempo).
STARTED_AT = time.time()


def _default_data_dir() -> Path:
    """Diretório de dados: gravável mesmo quando empacotado com PyInstaller."""
    if os.environ.get("MULACORD_DATA_DIR"):
        return Path(os.environ["MULACORD_DATA_DIR"])
    if getattr(sys, "frozen", False):
        base = os.environ.get("APPDATA") or os.environ.get("HOME") or str(Path.home())
        return Path(base) / "Mulacord" / "server"
    return Path(__file__).resolve().parent.parent / "data"


DATA_DIR = _default_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "mulacord.sqlite3"
_SECRET_PATH = DATA_DIR / ".secret_key"
_SERVER_ID_PATH = DATA_DIR / ".server_id"

UPLOADS_DIR = DATA_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Limites de upload de anexos.
MAX_UPLOAD_BYTES = int(os.environ.get("MULACORD_MAX_UPLOAD_MB", "50")) * 1024 * 1024
MAX_FILES_PER_MESSAGE = 10

# Duração do token de acesso.
TOKEN_TTL_SECONDS = int(os.environ.get("MULACORD_TOKEN_TTL", str(30 * 24 * 3600)))

# Nome do servidor exibido aos clientes.
SERVER_NAME = os.environ.get("MULACORD_SERVER_NAME", "Servidor Mulla Cord")

# Comunidade: um grupo lógico de nós que compartilham contas e histórico. Todo nó
# de uma comunidade tem o mesmo COMMUNITY_ID; na LAN eles se descobrem e elegem um
# coordenador. O app Electron passa esses valores por env (persistidos em
# userData/community.json); sem env, o nó cria a própria comunidade (id abaixo).
_COMMUNITY_ID_ENV = os.environ.get("MULACORD_COMMUNITY_ID", "").strip()
COMMUNITY_NAME = os.environ.get("MULACORD_COMMUNITY_NAME", SERVER_NAME)
# Segredo de entrada da comunidade (vai no convite). Vazio = qualquer um na LAN entra.
COMMUNITY_SECRET = os.environ.get("MULACORD_COMMUNITY_SECRET", "")
# Prioridade na eleição do coordenador. Maior vence. Um nó "sempre ligado" usa > 0.
NODE_PRIORITY = int(os.environ.get("MULACORD_NODE_PRIORITY", "0"))
# Endereço público (host:porta) por onde amigos de fora da LAN alcançam este nó.
PUBLIC_HOST = os.environ.get("MULACORD_PUBLIC_HOST", "")

# Porta do responder de descoberta na LAN (UDP). 0 desliga.
DISCOVERY_PORT = int(os.environ.get("MULACORD_DISCOVERY_PORT", "8788"))

# Permitir criar contas novas neste servidor.
OPEN_REGISTRATION = os.environ.get("MULACORD_OPEN_REGISTRATION", "1") != "0"


def _load_or_create(path: Path, factory) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    value = factory()
    path.write_text(value, encoding="utf-8")
    return value


SECRET_KEY = os.environ.get("MULACORD_SECRET_KEY") or _load_or_create(
    _SECRET_PATH, lambda: secrets.token_urlsafe(48)
)
SERVER_ID = _load_or_create(_SERVER_ID_PATH, lambda: uuid.uuid4().hex)

import hashlib as _hashlib
import hmac as _hmac

# COMMUNITY_ID: prioridade -> env (o app mandou), senão persistido, senão cria um.
# Persistimos por DATA_DIR (que muda quando o app troca de comunidade), então
# um nó só "cria" comunidade no primeiro boot sem env.
_COMMUNITY_ID_PATH = DATA_DIR / ".community_id"
if _COMMUNITY_ID_ENV:
    COMMUNITY_ID = _COMMUNITY_ID_ENV
    try:
        _COMMUNITY_ID_PATH.write_text(_COMMUNITY_ID_ENV, encoding="utf-8")
    except OSError:
        pass
else:
    COMMUNITY_ID = _load_or_create(_COMMUNITY_ID_PATH, lambda: uuid.uuid4().hex)

JWT_ALGORITHM = "HS256"

# Chave de assinatura dos tokens: derivada da comunidade, então um token emitido
# por qualquer nó vale em todos os nós da mesma comunidade (o enxame é uma coisa só).
TOKEN_KEY = _hmac.new(
    (COMMUNITY_SECRET or COMMUNITY_ID).encode("utf-8"),
    b"mulacord-token:" + COMMUNITY_ID.encode("utf-8"),
    _hashlib.sha256,
).hexdigest()

# Chave compartilhada da comunidade (header X-Comm-Key entre nós).
COMMUNITY_KEY = _hmac.new(
    (COMMUNITY_SECRET or COMMUNITY_ID).encode("utf-8"),
    COMMUNITY_ID.encode("utf-8"),
    _hashlib.sha256,
).hexdigest()
