"""Казахстанская специфика: проверка БИН/ИИН по контрольной сумме."""
from __future__ import annotations

import re


def normalize_bin(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def is_valid_bin(value: str | None) -> bool:
    """БИН/ИИН: 12 цифр, 12-я — контрольная (два прохода весами 1..11 и 3..11,1,2; результат 10 недопустим)."""
    d = normalize_bin(value)
    if len(d) != 12:
        return False
    digits = [int(x) for x in d]
    s = sum(digits[i] * (i + 1) for i in range(11)) % 11
    if s == 10:
        weights = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]
        s = sum(digits[i] * weights[i] for i in range(11)) % 11
        if s == 10:
            return False
    return s == digits[11]
