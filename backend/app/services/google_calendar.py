from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy.orm import Session

from ..core.secrets import decrypt, encrypt
from ..models import Calendar, CalendarEvent, GoogleCalendarAccount, Tenant

log = logging.getLogger("qadam.google_cal")

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/calendar.readonly",
]

GOOGLE_SOURCE = "google"


def tenant_configured(tenant: Tenant) -> bool:
    return bool(
        tenant.google_client_id
        and tenant.google_client_secret_enc
        and tenant.google_redirect_uri
    )


def _client_config_for(tenant: Tenant) -> dict:
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
    flow = Flow.from_client_config(_client_config_for(tenant), scopes=SCOPES, state=state)
    flow.redirect_uri = tenant.google_redirect_uri
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return auth_url


def exchange_code(tenant: Tenant, code: str, state: str) -> Tuple[Credentials, str]:
    flow = Flow.from_client_config(_client_config_for(tenant), scopes=SCOPES, state=state)
    flow.redirect_uri = tenant.google_redirect_uri
    flow.fetch_token(code=code)
    creds: Credentials = flow.credentials  # type: ignore[assignment]

    service = build("oauth2", "v2", credentials=creds, cache_discovery=False)
    info = service.userinfo().get().execute()
    email = info.get("email") or ""
    return creds, email


def save_account(db: Session, tenant_id: int, user_id: int, email: str, creds: Credentials) -> GoogleCalendarAccount:
    acc = (
        db.query(GoogleCalendarAccount)
        .filter(
            GoogleCalendarAccount.tenant_id == tenant_id,
            GoogleCalendarAccount.user_id == user_id,
        )
        .one_or_none()
    )
    if acc is None:
        acc = GoogleCalendarAccount(tenant_id=tenant_id, user_id=user_id, google_email=email)
        db.add(acc)

    acc.google_email = email
    acc.access_token_enc = encrypt(creds.token)
    if creds.refresh_token:
        acc.refresh_token_enc = encrypt(creds.refresh_token)
    acc.access_token_expires_at = creds.expiry.replace(tzinfo=timezone.utc) if creds.expiry else None
    acc.sync_enabled = True
    acc.last_sync_error = None
    db.flush()
    return acc


def _creds_from_account(tenant: Tenant, acc: GoogleCalendarAccount) -> Optional[Credentials]:
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


def _ensure_fresh(acc: GoogleCalendarAccount, creds: Credentials, db: Session) -> Credentials:
    if not creds.valid:
        try:
            creds.refresh(GoogleRequest())
            acc.access_token_enc = encrypt(creds.token)
            acc.access_token_expires_at = creds.expiry.replace(tzinfo=timezone.utc) if creds.expiry else None
            db.flush()
        except Exception as e:
            log.exception("google token refresh failed for account %s", acc.id)
            acc.last_sync_error = f"token refresh failed: {e}"
            db.flush()
            raise
    return creds


def _get_or_create_local_calendar(db: Session, acc: GoogleCalendarAccount) -> Calendar:
    name = f"Google — {acc.google_email}"
    cal = (
        db.query(Calendar)
        .filter(
            Calendar.tenant_id == acc.tenant_id,
            Calendar.owner_id == acc.user_id,
            Calendar.name == name,
        )
        .one_or_none()
    )
    if cal is None:
        cal = Calendar(
            tenant_id=acc.tenant_id,
            owner_id=acc.user_id,
            name=name,
            color="#4285F4",
            is_visible=True,
        )
        db.add(cal)
        db.flush()
    return cal


def _parse_dt(value: Optional[dict]) -> Tuple[Optional[datetime], bool]:
    if not value:
        return None, False
    if "dateTime" in value:
        s = value["dateTime"]
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc), False
    if "date" in value:
        dt = datetime.fromisoformat(value["date"]).replace(tzinfo=timezone.utc)
        return dt, True
    return None, False


def sync_account(db: Session, acc: GoogleCalendarAccount) -> Tuple[int, int, int]:
    tenant = db.get(Tenant, acc.tenant_id)
    if not tenant or not tenant_configured(tenant):
        raise RuntimeError("tenant Google credentials not configured")

    creds = _creds_from_account(tenant, acc)
    if creds is None:
        raise RuntimeError("no refresh token for account")

    _ensure_fresh(acc, creds, db)
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)

    local_cal = _get_or_create_local_calendar(db, acc)
    calendar_id = acc.primary_calendar_id or "primary"

    created = updated = deleted = 0
    page_token: Optional[str] = None
    next_sync_token: Optional[str] = None
    request_kwargs: dict = {"calendarId": calendar_id, "singleEvents": True, "showDeleted": True, "maxResults": 250}

    if acc.sync_token:
        request_kwargs["syncToken"] = acc.sync_token
    else:
        now = datetime.now(timezone.utc)
        request_kwargs["timeMin"] = (now - timedelta(days=90)).isoformat()
        request_kwargs["timeMax"] = (now + timedelta(days=365)).isoformat()

    while True:
        if page_token:
            request_kwargs["pageToken"] = page_token
        try:
            resp = service.events().list(**request_kwargs).execute()
        except HttpError as e:
            if e.resp.status == 410:
                acc.sync_token = None
                db.flush()
                raise RuntimeError("sync token expired, retry full sync next time")
            raise

        for item in resp.get("items", []) or []:
            gid = item.get("id")
            if not gid:
                continue

            existing = (
                db.query(CalendarEvent)
                .filter(
                    CalendarEvent.tenant_id == acc.tenant_id,
                    CalendarEvent.external_source == GOOGLE_SOURCE,
                    CalendarEvent.external_id == gid,
                )
                .one_or_none()
            )

            if item.get("status") == "cancelled":
                if existing:
                    db.delete(existing)
                    deleted += 1
                continue

            start_dt, all_day = _parse_dt(item.get("start"))
            end_dt, _ = _parse_dt(item.get("end"))
            if not start_dt or not end_dt:
                continue

            title = (item.get("summary") or "(Без названия)")[:300]
            desc = item.get("description")
            location = (item.get("location") or None)
            if location:
                location = location[:300]
            etag = item.get("etag")

            if existing is None:
                ev = CalendarEvent(
                    tenant_id=acc.tenant_id,
                    calendar_id=local_cal.id,
                    title=title,
                    description=desc,
                    location=location,
                    start_at=start_dt,
                    end_at=end_dt,
                    all_day=all_day,
                    timezone=(item.get("start") or {}).get("timeZone") or "UTC",
                    creator_id=acc.user_id,
                    external_source=GOOGLE_SOURCE,
                    external_id=gid,
                    external_calendar_id=calendar_id,
                    external_etag=etag,
                )
                db.add(ev)
                created += 1
            else:
                if existing.external_etag == etag:
                    continue
                existing.title = title
                existing.description = desc
                existing.location = location
                existing.start_at = start_dt
                existing.end_at = end_dt
                existing.all_day = all_day
                existing.timezone = (item.get("start") or {}).get("timeZone") or existing.timezone
                existing.external_etag = etag
                updated += 1

        page_token = resp.get("nextPageToken")
        next_sync_token = resp.get("nextSyncToken") or next_sync_token
        if not page_token:
            break

    if next_sync_token:
        acc.sync_token = next_sync_token
    acc.last_sync_at = datetime.now(timezone.utc)
    acc.last_sync_error = None
    db.flush()
    return created, updated, deleted


def delete_account(db: Session, acc: GoogleCalendarAccount) -> None:
    (
        db.query(CalendarEvent)
        .filter(
            CalendarEvent.tenant_id == acc.tenant_id,
            CalendarEvent.external_source == GOOGLE_SOURCE,
            CalendarEvent.calendar.has(owner_id=acc.user_id),
        )
        .delete(synchronize_session=False)
    )
    cal_name = f"Google — {acc.google_email}"
    cal = (
        db.query(Calendar)
        .filter(
            Calendar.tenant_id == acc.tenant_id,
            Calendar.owner_id == acc.user_id,
            Calendar.name == cal_name,
        )
        .one_or_none()
    )
    if cal:
        db.delete(cal)
    db.delete(acc)
    db.flush()
