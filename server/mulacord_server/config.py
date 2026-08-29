"""Configuração e caminhos de runtime."""
from __future__ import annotations

import os
import secrets
import sys
import uuid
from pathlib import Path


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
JWT_ALGORITHM = "HS256"
