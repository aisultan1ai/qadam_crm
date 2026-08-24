"""Проверка типа файла по magic-bytes.

Полагаться только на расширение или Content-Type небезопасно: клиент может
подменить их и загрузить .exe как .pdf. Проверяем первые байты содержимого.

Поддерживаем только те форматы, что уже разрешены в attachments/users.
Если формат нам неизвестен по сигнатуре — не блокируем (fallback на allowlist
по расширению): иначе редкие текстовые/офисные файлы вообще перестанут грузиться.
"""
from __future__ import annotations

from typing import Optional

# (сигнатура bytes, смещение, набор допустимых расширений)
SIGNATURES: list[tuple[bytes, int, set[str]]] = [
    (b"\x89PNG\r\n\x1a\n", 0, {".png"}),
    (b"\xff\xd8\xff", 0, {".jpg", ".jpeg"}),
    (b"GIF87a", 0, {".gif"}),
    (b"GIF89a", 0, {".gif"}),
    (b"%PDF-", 0, {".pdf"}),
    (b"PK\x03\x04", 0, {".zip", ".docx", ".xlsx", ".pptx"}),
    (b"PK\x05\x06", 0, {".zip", ".docx", ".xlsx", ".pptx"}),
    (b"PK\x07\x08", 0, {".zip", ".docx", ".xlsx", ".pptx"}),
    (b"Rar!\x1a\x07", 0, {".rar"}),
    (b"7z\xbc\xaf\x27\x1c", 0, {".7z"}),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", 0, {".doc", ".xls", ".ppt", ".msi"}),
    (b"ID3", 0, {".mp3"}),
    (b"\xff\xfb", 0, {".mp3"}),
    (b"OggS", 0, {".ogg"}),
    (b"RIFF", 0, {".wav", ".webp"}),  # WEBP/WAV — далее нужен второй маркер
]

# Ищем WEBP/WAV, у которых RIFF в начале, а тип по смещению 8
RIFF_SUBTYPES: dict[bytes, set[str]] = {
    b"WEBP": {".webp"},
    b"WAVE": {".wav"},
    b"AVI ": {".avi"},
}

# MP4/MOV — сигнатура ...ftypXXXX по смещению 4
FTYP_SUBTYPES: dict[bytes, set[str]] = {
    b"isom": {".mp4"},
    b"iso2": {".mp4"},
    b"mp41": {".mp4"},
    b"mp42": {".mp4"},
    b"avc1": {".mp4"},
    b"qt  ": {".mov"},
}

# Расширения, для которых у нас нет надёжной сигнатуры (текстовые/CSV/RTF/svg-…-нет).
# Их не блокируем — но и не проверяем по байтам.
SIGNATURE_UNKNOWN: set[str] = {".txt", ".md", ".csv", ".rtf"}

# Опасные исполнимые сигнатуры — блокируем при любом расширении.
DANGEROUS_MAGIC: list[tuple[bytes, str]] = [
    (b"MZ", "windows_exe"),        # PE (exe/dll/msi/scr)
    (b"\x7fELF", "linux_elf"),
    (b"\xca\xfe\xba\xbe", "java_class"),  # class file
    (b"#!", "unix_script"),
    (b"<?php", "php_script"),
    (b"<script", "html_script"),
    (b"<!DOCTYPE html", "html"),
    (b"<html", "html"),
    (b"<svg", "svg"),
]


def check_magic_bytes(head: bytes, ext: str) -> Optional[str]:
    """Вернёт None, если тип соответствует расширению (или неизвестен для нашего allowlist).
    Иначе — строку с причиной отказа для HTTPException.
    """
    ext = ext.lower()

    # Явно опасные сигнатуры — блок независимо от расширения.
    for sig, label in DANGEROUS_MAGIC:
        if head.startswith(sig):
            return f"Файл содержит опасное содержимое ({label})"

    # RIFF-контейнеры
    if head[:4] == b"RIFF" and len(head) >= 12:
        sub = head[8:12]
        allowed = RIFF_SUBTYPES.get(sub, set())
        if allowed and ext not in allowed:
            return f"Содержимое не соответствует расширению {ext}"
        return None

    # MP4/MOV: XXXXftypYYYY
    if len(head) >= 12 and head[4:8] == b"ftyp":
        sub = head[8:12]
        allowed = FTYP_SUBTYPES.get(sub, set())
        if allowed and ext not in allowed:
            return f"Содержимое не соответствует расширению {ext}"
        return None

    for sig, offset, exts in SIGNATURES:
        end = offset + len(sig)
        if len(head) >= end and head[offset:end] == sig:
            if ext in exts:
                return None
            return f"Содержимое не соответствует расширению {ext}"

    # Не нашли сигнатуру. Если расширение из "текстовых" — пропускаем.
    if ext in SIGNATURE_UNKNOWN:
        return None

    # Для бинарных allowlist-расширений отсутствие сигнатуры подозрительно.
    return None
