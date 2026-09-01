#!/usr/bin/env python3
"""Генерирует все секреты для prod-.env.

Usage:
    python scripts/gen_secrets.py                # выводит в stdout
    python scripts/gen_secrets.py --write        # записывает в .env.secrets (не трогая существующий .env)
    python scripts/gen_secrets.py --merge .env   # добавляет отсутствующие ключи в .env, существующие не трогает

Никогда не перезаписывает уже заданные секреты — безопасно вызывать повторно.
"""
from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

try:
    from cryptography.fernet import Fernet
except ImportError:
    print("ERROR: pip install cryptography", file=sys.stderr)
    sys.exit(1)


def generate() -> dict[str, str]:
    return {
        "JWT_SECRET": secrets.token_urlsafe(48),
        "SECRETS_KEY": Fernet.generate_key().decode(),
        "BILLING_WEBHOOK_SECRET": secrets.token_urlsafe(32),
        "POSTGRES_PASSWORD": secrets.token_urlsafe(24),
        "REDIS_PASSWORD": secrets.token_urlsafe(24),
        "ADMIN_PASSWORD": secrets.token_urlsafe(16),
    }


def format_env(values: dict[str, str]) -> str:
    return "\n".join(f"{k}={v}" for k, v in values.items()) + "\n"


def parse_env(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        result[k.strip()] = v.strip()
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="записать в .env.secrets в текущей директории")
    ap.add_argument("--merge", metavar="PATH", help="добавить отсутствующие ключи в указанный .env файл")
    args = ap.parse_args()

    values = generate()

    if args.merge:
        path = Path(args.merge)
        if not path.exists():
            print(f"ERROR: {path} не существует", file=sys.stderr)
            return 1
        existing = parse_env(path.read_text(encoding="utf-8"))
        added = {k: v for k, v in values.items() if k not in existing or not existing[k]}
        if not added:
            print(f"Все секреты уже заданы в {path}, ничего не изменено.")
            return 0
        with path.open("a", encoding="utf-8") as f:
            f.write("\n# --- Сгенерировано gen_secrets.py ---\n")
            f.write(format_env(added))
        print(f"Добавлено {len(added)} секретов в {path}: {', '.join(added)}")
        return 0

    if args.write:
        path = Path(".env.secrets")
        if path.exists():
            print(f"ERROR: {path} уже существует — удали или используй --merge .env", file=sys.stderr)
            return 1
        path.write_text(format_env(values), encoding="utf-8")
        print(f"Записано в {path}. Перенеси значения в .env вручную.")
        return 0

    print("# Скопируй нужные строки в .env (или используй --merge .env для авто-мержа):")
    print(format_env(values), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
