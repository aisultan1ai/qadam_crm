"""Dropbox integration — OAuth2 + list + download через официальный dropbox SDK.

App-key/secret/redirect_uri хранятся per-tenant в tenants.dropbox_*. Токены
пользователей — в StorageAccount(provider='dropbox').

Dropbox OAuth2:
- authorize URL: https://www.dropbox.com/oauth2/authorize
- token URL:     https://api.dropboxapi.com/oauth2/token
- token_access_type=offline → выдаётся refresh_token (иначе только short-lived).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from urllib.parse import urlencode

import httpx
import dropbox
from dropbox.files import FileMetadata, FolderMetadata
from sqlalchemy.orm import Session

from ..core.secrets import decrypt, encrypt
from ..models import StorageAccount, Tenant

log = logging.getLogger("qadam.dropbox")


def tenant_configured(tenant: Tenant) -> bool:
    return bool(
        tenant.dropbox_app_key
        and tenant.dropbox_app_secret_enc
        and tenant.dropbox_redirect_uri
    )


def build_auth_url(tenant: Tenant, state: str) -> str:
    params = {
        "client_id": tenant.dropbox_app_key,
        "response_type": "code",
        "redirect_uri": tenant.dropbox_redirect_uri,
        "state": state,
        "token_access_type": "offline",
    }
    return "https://www.dropbox.com/oauth2/authorize?" + urlencode(params)


def exchange_code(tenant: Tenant, code: str) -> Tuple[dict, dict]:
    """Обменивает authorization code на access + refresh token и возвращает (token_payload, account_info)."""
    secret = decrypt(tenant.dropbox_app_secret_enc) or ""
    resp = httpx.post(
        "https://api.dropboxapi.com/oauth2/token",
        data={
            "code": code,
            "grant_type": "authorization_code",
            "client_id": tenant.dropbox_app_key,
            "client_secret": secret,
            "redirect_uri": tenant.dropbox_redirect_uri,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    access_token = data.get("access_token")
    dbx = dropbox.Dropbox(oauth2_access_token=access_token, timeout=15)
    acc_info = dbx.users_get_current_account()
    info = {
        "email": acc_info.email,
        "name": acc_info.name.display_name,
        "account_id": acc_info.account_id,
    }
    return data, info


def save_account(
    db: Session, tenant_id: int, user_id: int, token_payload: dict, account_info: dict
) -> StorageAccount:
    acc = (
        db.query(StorageAccount)
        .filter(
            StorageAccount.tenant_id == tenant_id,
            StorageAccount.user_id == user_id,
            StorageAccount.provider == "dropbox",
        )
        .one_or_none()
    )
    if acc is None:
        acc = StorageAccount(
            tenant_id=tenant_id, user_id=user_id, provider="dropbox",
        )
        db.add(acc)

    acc.account_email = account_info.get("email")
    acc.account_name = account_info.get("name")
    acc.access_token_enc = encrypt(token_payload.get("access_token"))
    if token_payload.get("refresh_token"):
        acc.refresh_token_enc = encrypt(token_payload["refresh_token"])
    expires_in = int(token_payload.get("expires_in") or 0)
    if expires_in:
        acc.access_token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in - 60)
    acc.last_error = None
    db.flush()
    return acc


def _refresh_access_token(db: Session, tenant: Tenant, acc: StorageAccount) -> str:
    refresh_token = decrypt(acc.refresh_token_enc)
    if not refresh_token:
        raise RuntimeError("no refresh token — reconnect required")
    secret = decrypt(tenant.dropbox_app_secret_enc) or ""
    resp = httpx.post(
        "https://api.dropboxapi.com/oauth2/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": tenant.dropbox_app_key,
            "client_secret": secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    new_token = data["access_token"]
    acc.access_token_enc = encrypt(new_token)
    expires_in = int(data.get("expires_in") or 0)
    if expires_in:
        acc.access_token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in - 60)
    db.flush()
    return new_token


def _client_for(db: Session, tenant: Tenant, acc: StorageAccount) -> dropbox.Dropbox:
    token = decrypt(acc.access_token_enc)
    expiry = acc.access_token_expires_at
    if not token or (expiry and expiry <= datetime.now(timezone.utc)):
        token = _refresh_access_token(db, tenant, acc)
    return dropbox.Dropbox(oauth2_access_token=token, timeout=30)


def _entry_to_dict(entry) -> dict:
    if isinstance(entry, FolderMetadata):
        return {
            "id": entry.id,
            "path": entry.path_lower,
            "name": entry.name,
            "kind": "folder",
            "size": None,
            "modified": None,
        }
    if isinstance(entry, FileMetadata):
        return {
            "id": entry.id,
            "path": entry.path_lower,
            "name": entry.name,
            "kind": "file",
            "size": entry.size,
            "modified": entry.server_modified.isoformat() if entry.server_modified else None,
            "content_hash": entry.content_hash,
        }
    return {"id": getattr(entry, "id", None), "name": getattr(entry, "name", ""), "kind": "other"}


def list_files(
    db: Session,
    tenant: Tenant,
    acc: StorageAccount,
    path: Optional[str] = None,
    cursor: Optional[str] = None,
) -> dict:
    dbx = _client_for(db, tenant, acc)
    try:
        if cursor:
            resp = dbx.files_list_folder_continue(cursor)
        else:
            # Dropbox трактует "/" как корень, но передаёт его как "".
            root = "" if not path or path == "/" else path
            resp = dbx.files_list_folder(root, recursive=False, include_deleted=False)
    except dropbox.exceptions.ApiError as e:
        raise RuntimeError(f"dropbox list failed: {e}")
    return {
        "files": [_entry_to_dict(e) for e in resp.entries],
        "cursor": resp.cursor if resp.has_more else None,
    }


def download_file(
    db: Session, tenant: Tenant, acc: StorageAccount, path: str
) -> Tuple[bytes, str, Optional[str]]:
    dbx = _client_for(db, tenant, acc)
    try:
        metadata, resp = dbx.files_download(path)
    except dropbox.exceptions.ApiError as e:
        raise RuntimeError(f"dropbox download failed: {e}")
    return resp.content, metadata.name, None  # Dropbox не возвращает mime type


def revoke(db: Session, tenant: Tenant, acc: StorageAccount) -> None:
    try:
        dbx = _client_for(db, tenant, acc)
        dbx.auth_token_revoke()
    except Exception as e:
        log.warning("dropbox revoke failed for acc=%s: %s", acc.id, e)
    db.delete(acc)
    db.flush()
