"""Upload e entrega de anexos (imagens e vídeos)."""
from __future__ import annotations

import mimetypes
import secrets
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from ..config import MAX_FILES_PER_MESSAGE, MAX_UPLOAD_BYTES, UPLOADS_DIR
from ..database import db
from ..deps import CurrentUser
from ..guilds_service import channel_perms
from ..media import image_size
from ..permissions import P, has

router = APIRouter(prefix="/api", tags=["attachments"])

_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
    "image/webp": ".webp", "image/bmp": ".bmp", "image/avif": ".avif",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
    "video/x-matroska": ".mkv", "video/ogg": ".ogv",
}


def _kind(content_type: str) -> str | None:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    return None


def serialize_attachment(row) -> dict:
    return {
        "id": row["id"],
        "filename": row["filename"],
        "content_type": row["content_type"],
        "size": row["size"],
        "width": row["width"],
        "height": row["height"],
        "kind": row["kind"],
        "url": f"/api/attachments/{row['id']}/{row['filename']}",
    }


async def attachments_for(message_ids: list[int]) -> dict[int, list[dict]]:
    if not message_ids:
        return {}
    q = ",".join("?" * len(message_ids))
    rows = await db.fetchall(
        f"SELECT * FROM attachments WHERE message_id IN ({q}) ORDER BY created_at, id",
        message_ids,
    )
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["message_id"], []).append(serialize_attachment(r))
    return out


@router.post("/channels/{channel_id}/attachments", status_code=status.HTTP_201_CREATED)
async def upload(channel_id: int, files: list[UploadFile], user=CurrentUser) -> list[dict]:
    if not has(await channel_perms(channel_id, user["id"]), P.ATTACH_FILES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem permissão para anexar arquivos")
    if len(files) > MAX_FILES_PER_MESSAGE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Máximo de {MAX_FILES_PER_MESSAGE} arquivos por mensagem")

    out = []
    for f in files:
        ctype = f.content_type or mimetypes.guess_type(f.filename or "")[0] or "application/octet-stream"
        kind = _kind(ctype)
        if kind is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Só imagens e vídeos são aceitos")

        data = await f.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                               f"Arquivo maior que {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")

        aid = secrets.token_urlsafe(12)
        ext = _EXT.get(ctype) or Path(f.filename or "").suffix[:8] or ""
        stored = aid + ext
        (UPLOADS_DIR / stored).write_bytes(data)

        w = h = None
        if kind == "image":
            w, h = image_size(data)

        safe_name = Path(f.filename or ("anexo" + ext)).name[:120]
        await db.execute(
            """INSERT INTO attachments
               (id, channel_id, uploader_id, filename, stored_name, content_type, size, width, height, kind)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (aid, channel_id, user["id"], safe_name, stored, ctype, len(data), w, h, kind),
        )
        row = await db.fetchone("SELECT * FROM attachments WHERE id = ?", (aid,))
        out.append(serialize_attachment(row))
    return out


@router.get("/attachments/{aid}/{filename}")
async def download(aid: str, filename: str, user=CurrentUser):
    row = await db.fetchone("SELECT * FROM attachments WHERE id = ?", (aid,))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Anexo não encontrado")
    if not has(await channel_perms(row["channel_id"], user["id"]), P.VIEW_CHANNEL):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem acesso a este canal")
    path = UPLOADS_DIR / row["stored_name"]
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo removido")
    return FileResponse(path, media_type=row["content_type"], filename=row["filename"])
