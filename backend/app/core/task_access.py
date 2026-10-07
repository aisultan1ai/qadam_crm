"""Кто может менять срок задачи напрямую.

Постановщик (автор) и аудиторы решают сроки сами. Исполнители и участники срок напрямую
не меняют — они отправляют запрос на перенос (см. api/deadline_requests.py).
Владелец компании и платформенный админ — всегда могут. Если у задачи нет постановщика
(удалён/системная) — срок может менять любой с правом редактирования.
"""
from __future__ import annotations


def can_set_deadline(user, membership, task) -> bool:
    if task.author_id is None:
        return True
    if user.id == task.author_id or user.id in task.auditor_ids:
        return True
    if membership is not None and getattr(membership, "is_owner", False):
        return True
    return bool(getattr(user, "is_platform_admin", False))
