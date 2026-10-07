"""Защита от SSRF: исходящие запросы по адресам, которые задаёт пользователь (вебхуки автоматизаций).

Без проверки администратор компании мог бы заставить сервер обращаться к внутренним сервисам
(база, Redis, внутренний backend, метаданные облака 169.254.169.254) и читать/менять их.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeUrl(ValueError):
    pass


def assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeUrl("Адрес должен начинаться с http:// или https://")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeUrl("Не удалось определить адрес сервера") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            or ip.is_multicast or ip.is_unspecified
        ):
            raise UnsafeUrl("Адрес ведёт во внутреннюю сеть — такие адреса запрещены")
