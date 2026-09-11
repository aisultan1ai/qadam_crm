"""Google Drive integration — OAuth2 + list + download.

Переиспользует client_id/secret/redirect_uri из tenant.google_* (те же, что для
Calendar). Токены хранятся отдельно в StorageAccount(provider='google_drive'),
потому что scope у Drive и Calendar разный и combining scopes в один consent
даёт согласие на всё сразу — что не всегда желательно.
"""
from __future__ import annotations

import io
import logging
from datetime import timezone
from typing import Optional, Tuple

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from sqlalchemy.orm import Session

from ..core.secrets import decrypt, encrypt
from ..models import StorageAccount, Tenant

log = logging.getLogger("qadam.google_drive")

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.readonly",
]

# Google Docs / Sheets / Slides не имеют бинарного файла — их нужно экспортировать.
GOOGLE_DOC_EXPORTS = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pptx",
    ),
    "application/vnd.google-apps.drawing": ("image/png", ".png"),
}


def _client_config(tenant: Tenant) -> dict:
    secret = decrypt(tenant.google_client_secret_enc)
    return {
        "web": {
            "client_id": tenant.google_client_id,
            "client_secret": secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [tenant.google_redirect_uri],
        }
    }


def build_auth_url(tenant: Tenant, state: str) -> str:
    flow = Flow.from_client_config(_client_config(tenant), scopes=SCOPES, state=state)
    flow.redirect_uri = tenant.google_redirect_uri
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return url


def exchange_code(tenant: Tenant, code: str, state: str) -> Tuple[Credentials, str]:
    flow = Flow.from_client_config(_client_config(tenant), scopes=SCOPES, state=state)
    flow.redirect_uri = tenant.google_redirect_uri
    flow.fetch_token(code=code)
    creds: Credentials = flow.credentials  # type: ignore[assignment]

    service = build("oauth2", "v2", credentials=creds, cache_discovery=False)
    info = service.userinfo().get().execute()
    email = info.get("email") or ""
    return creds, email


def save_account(db: Session, tenant_id: int, user_id: int, email: str, creds: Credentials) -> StorageAccount:
    acc = (
        db.query(StorageAccount)
        .filter(
            StorageAccount.tenant_id == tenant_id,
            StorageAccount.user_id == user_id,
            StorageAccount.provider == "google_drive",
        )
        .one_or_none()
    )
    if acc is None:
        acc = StorageAccount(
            tenant_id=tenant_id, user_id=user_id, provider="google_drive", account_email=email,
        )
        db.add(acc)

    acc.account_email = email
    acc.access_token_enc = encrypt(creds.token)
    if creds.refresh_token:
        acc.refresh_token_enc = encrypt(creds.refresh_token)
    acc.access_token_expires_at = creds.expiry.replace(tzinfo=timezone.utc) if creds.expiry else None
    acc.last_error = None
    db.flush()
    return acc


def _creds_from_account(tenant: Tenant, acc: StorageAccount) -> Optional[Credentials]:
    refresh_token = decrypt(acc.refresh_token_enc)
    access_token = decrypt(acc.access_token_enc)
    if not refresh_token:
        return None
    client_secret = decrypt(tenant.google_client_secret_enc)
    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=tenant.google_client_id,
        client_secret=client_secret,
        scopes=SCOPES,
    )
    if acc.access_token_expires_at:
        creds.expiry = acc.access_token_expires_at.replace(tzinfo=None)
    return creds


def _ensure_fresh(db: Session, acc: StorageAccount, creds: Credentials) -> Credentials:
    if not creds.valid:
        try:
            creds.refresh(GoogleRequest())
            acc.access_token_enc = encrypt(creds.token)
            acc.access_token_expires_at = creds.expiry.replace(tzinfo=timezone.utc) if creds.expiry else None
            db.flush()
        except Exception as e:
            log.exception("google_drive token refresh failed for account %s", acc.id)
            acc.last_error = f"token refresh failed: {e}"
            db.flush()
            raise
    return creds


def _service_for(db: Session, tenant: Tenant, acc: StorageAccount):
    creds = _creds_from_account(tenant, acc)
    if creds is None:
        raise RuntimeError("no refresh token for account")
    _ensure_fresh(db, acc, creds)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_files(
    db: Session,
    tenant: Tenant,
    acc: StorageAccount,
    folder_id: Optional[str] = None,
    page_token: Optional[str] = None,
    query: Optional[str] = None,
    page_size: int = 100,
) -> dict:
    """Список файлов и папок в указанной папке (или в корне 'root')."""
    service = _service_for(db, tenant, acc)
    parent = folder_id or "root"
    q_parts = [f"'{parent}' in parents", "trashed = false"]
    if query:
        safe = query.replace("'", "\\'")
        q_parts.append(f"name contains '{safe}'")
    q = " and ".join(q_parts)
    resp = (
        service.files()
        .list(
            q=q,
            pageSize=page_size,
            pageToken=page_token,
            fields="nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, webViewLink)",
            orderBy="folder,name",
        )
        .execute()
    )
    return {
        "files": resp.get("files", []) or [],
        "next_page_token": resp.get("nextPageToken"),
    }


def download_file(
    db: Session, tenant: Tenant, acc: StorageAccount, file_id: str
) -> Tuple[bytes, str, str]:
    """Скачивает файл. Google Docs (native) экспортируется в docx/xlsx/pptx.

    Возвращает (bytes, filename, mime_type).
    """
    service = _service_for(db, tenant, acc)
    meta = service.files().get(fileId=file_id, fields="id,name,mimeType").execute()
    name = meta.get("name") or file_id
    mime = meta.get("mimeType") or "application/octet-stream"

    if mime in GOOGLE_DOC_EXPORTS:
        export_mime, ext = GOOGLE_DOC_EXPORTS[mime]
        if not name.lower().endswith(ext):
            name += ext
        request = service.files().export_media(fileId=file_id, mimeType=export_mime)
        mime = export_mime
    else:
        request = service.files().get_media(fileId=file_id)

    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue(), name, mime


def revoke(db: Session, tenant: Tenant, acc: StorageAccount) -> None:
    """Отзывает токен на стороне Google + удаляет запись."""
    try:
        creds = _creds_from_account(tenant, acc)
        if creds:
            import httpx
            token = creds.refresh_token or creds.token
            if token:
                httpx.post(
                    "https://oauth2.googleapis.com/revoke",
                    params={"token": token},
                    timeout=10,
                )
    except Exception as e:
        log.warning("google_drive revoke failed for acc=%s: %s", acc.id, e)
    db.delete(acc)
    db.flush()
