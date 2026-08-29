"""Sniff de dimensões de imagem sem Pillow — lê só o cabeçalho.
Suporta PNG, GIF, JPEG, WebP, BMP. Retorna (w, h) ou (None, None)."""
from __future__ import annotations

import struct


def image_size(data: bytes) -> tuple[int | None, int | None]:
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", data[16:24])
            return w, h
        if data[:6] in (b"GIF87a", b"GIF89a"):
            w, h = struct.unpack("<HH", data[6:10])
            return w, h
        if data[:2] == b"BM":
            w, h = struct.unpack("<ii", data[18:26])
            return abs(w), abs(h)
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return _webp(data)
        if data[:2] == b"\xff\xd8":
            return _jpeg(data)
    except Exception:
        pass
    return None, None


def _webp(data: bytes) -> tuple[int | None, int | None]:
    fmt = data[12:16]
    if fmt == b"VP8 ":
        w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
        h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        return w, h
    if fmt == b"VP8L":
        b = data[21:25]
        n = int.from_bytes(b, "little")
        return (n & 0x3FFF) + 1, ((n >> 14) & 0x3FFF) + 1
    if fmt == b"VP8X":
        w = int.from_bytes(data[24:27], "little") + 1
        h = int.from_bytes(data[27:30], "little") + 1
        return w, h
    return None, None


def _jpeg(data: bytes) -> tuple[int | None, int | None]:
    i = 2
    n = len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", data[i + 5 : i + 9])
            return w, h
        seg_len = struct.unpack(">H", data[i + 2 : i + 4])[0]
        i += 2 + seg_len
    return None, None
