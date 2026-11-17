"""Массовый импорт сотрудников из Excel/CSV: ФИО, email, должность, отдел, роль, руководитель.

Два шага, чтобы ничего не испортить по ошибке:
  POST /api/people-import/preview — разобрать файл и показать, что произойдёт с каждой строкой;
  POST /api/people-import/commit  — применить проверенные строки.

Новые люди получают приглашения (письмо или ссылка), уже работающие в компании — обновляются
(должность, отдел, роль, руководитель). Отсутствующие отделы создаются, если у импортирующего
есть право управлять справочниками. Руководитель — email или ФИО: из файла или из сотрудников.
"""
from __future__ import annotations

import csv
import io
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..core.departments import add_to_department, set_primary_department
from ..core.permissions import user_has
from ..core.plans import check_feature, count_users, get_limits
from ..database import get_db
from ..models import Department, Invitation, Role, TenantMembership, User
from .deps import TenantContext, log_action, require

router = APIRouter(prefix="/api/people-import", tags=["people-import"])

MAX_ROWS = 1000
MAX_BYTES = 5 * 1024 * 1024
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DEFAULT_ROLE = "Сотрудник"

# Заголовки колонок — как их пишут в реальных таблицах.
HEADERS = {
    "full_name": ("фио", "ф.и.о.", "ф.и.о", "имя", "сотрудник", "full name", "name", "аты-жөні"),
    "email": ("email", "e-mail", "почта", "эл. почта", "электронная почта", "mail"),
    "position": ("должность", "position", "лауазымы"),
    "department": ("отдел", "подразделение", "department", "бөлім"),
    "role": ("роль", "role", "права", "доступ"),
    "manager": ("руководитель", "начальник", "manager", "basshy", "басшы"),
}


class Row(BaseModel):
    row: int
    full_name: str = ""
    email: str = ""
    position: str = ""
    department: str = ""
    role: str = ""
    manager: str = ""


class RowResult(Row):
    action: str = "invite"  # invite | update | error
    errors: list[str] = []
    notes: list[str] = []
    manager_email: Optional[str] = None


class Preview(BaseModel):
    rows: list[RowResult]
    invite: int
    update: int
    errors: int
    new_departments: list[str]
    roles: list[str]
    limit_error: Optional[str] = None


class CommitIn(BaseModel):
    rows: list[Row] = Field(max_length=MAX_ROWS)
    send_emails: bool = True


class CommitResult(BaseModel):
    invited: int
    updated: int
    skipped: int
    departments_created: list[str]
    invites: list[dict]
    email_sent: bool


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _key(s: str) -> str:
    return _norm(s).lower().replace("ё", "е")


def _map_header(cells: list) -> dict[int, str]:
    out: dict[int, str] = {}
    for i, c in enumerate(cells):
        k = _key(c).rstrip(":*")
        for field, names in HEADERS.items():
            if k in names and field not in out.values():
                out[i] = field
    return out


def _read_rows(content: bytes, filename: str) -> list[Row]:
    name = (filename or "").lower()
    table: list[list] = []
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        try:
            wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception:
            raise HTTPException(400, "Не удалось открыть файл Excel — сохраните его как .xlsx и попробуйте снова")
        ws = wb.worksheets[0]
        for r in ws.iter_rows(values_only=True):
            table.append(list(r))
            if len(table) > MAX_ROWS + 20:
                break
    elif name.endswith(".csv"):
        text = None
        for enc in ("utf-8-sig", "cp1251"):
            try:
                text = content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise HTTPException(400, "Не удалось прочитать CSV — сохраните в кодировке UTF-8")
        dialect = csv.Sniffer().sniff(text[:2000], delimiters=",;\t") if text.strip() else csv.excel
        table = [r for r in csv.reader(io.StringIO(text), dialect)]
    else:
        raise HTTPException(400, "Поддерживаются файлы .xlsx и .csv")

    # Строка заголовков — первая, где нашлись «ФИО» и «Email» (сверху может быть шапка документа).
    header_idx, mapping = None, {}
    for i, r in enumerate(table[:15]):
        m = _map_header(r)
        if "email" in m.values() and "full_name" in m.values():
            header_idx, mapping = i, m
            break
    if header_idx is None:
        raise HTTPException(400, "Не нашли колонки «ФИО» и «Email». Скачайте шаблон и заполните по нему.")
    rows: list[Row] = []
    for n, r in enumerate(table[header_idx + 1:], start=header_idx + 2):
        vals = {f: _norm(r[i]) if i < len(r) else "" for i, f in mapping.items()}
        if not any(vals.values()):
            continue
        rows.append(Row(row=n, **vals))
        if len(rows) > MAX_ROWS:
            raise HTTPException(400, f"Слишком много строк — не больше {MAX_ROWS} за раз")
    if not rows:
        raise HTTPException(400, "В файле нет строк с сотрудниками")
    return rows


def _can_create_departments(ctx: TenantContext) -> bool:
    return ctx.membership.is_owner or user_has(ctx.user, ["settings.dictionaries"], tenant_id=ctx.tenant.id)


def _analyze(db: Session, ctx: TenantContext, rows: list[Row]) -> Preview:
    tid = ctx.tenant.id
    roles = {r.name.lower(): r for r in db.query(Role).filter(Role.tenant_id == tid)}
    deps = {_key(d.name): d for d in db.query(Department).filter(Department.tenant_id == tid)}
    members = {
        u.email.lower(): (u, m)
        for u, m in db.query(User, TenantMembership)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .filter(TenantMembership.tenant_id == tid)
    }
    member_by_name: dict[str, list[str]] = {}
    for email, (u, _m) in members.items():
        member_by_name.setdefault(_key(u.name), []).append(email)
    can_make_deps = _can_create_departments(ctx)

    file_emails: dict[str, int] = {}
    file_by_name: dict[str, list[str]] = {}
    for r in rows:
        e = r.email.lower()
        if e:
            file_emails[e] = file_emails.get(e, 0) + 1
            if r.full_name:
                file_by_name.setdefault(_key(r.full_name), []).append(e)

    results: list[RowResult] = []
    new_deps: dict[str, str] = {}
    for r in rows:
        res = RowResult(**r.model_dump())
        email = r.email.lower()
        res.email = email
        if not email:
            res.errors.append("Не указан email")
        elif not EMAIL_RE.match(email) or len(email) > 255:
            res.errors.append("Неверный email")
        elif file_emails.get(email, 0) > 1:
            res.errors.append("Этот email встречается в файле несколько раз")
        if not r.full_name and email not in members:
            res.errors.append("Не указано ФИО")
        if len(r.full_name) > 200 or len(r.position) > 150:
            res.errors.append("Слишком длинное ФИО или должность")

        existing = members.get(email)
        res.action = "update" if existing else "invite"
        if existing is None and email and db.query(User.id).filter(User.email == email).first():
            res.notes.append("У человека уже есть аккаунт Qadam — придёт приглашение в компанию")

        if r.role:
            if r.role.lower() not in roles:
                res.errors.append(f"Нет роли «{r.role}». Есть: {', '.join(sorted(x.name for x in roles.values()))}")
        elif existing is None and DEFAULT_ROLE.lower() not in roles:
            res.notes.append("Роль не указана — человек войдёт без прав, назначьте роль позже")

        if r.department and _key(r.department) not in deps:
            if can_make_deps:
                new_deps.setdefault(_key(r.department), r.department)
                res.notes.append(f"Будет создан отдел «{r.department}»")
            else:
                res.errors.append(f"Нет отдела «{r.department}» (создавать отделы может администратор)")

        if r.manager:
            m = r.manager.strip()
            boss: Optional[str] = None
            if "@" in m:
                boss = m.lower()
                if boss not in members and boss not in file_emails:
                    res.errors.append(f"Руководитель {m} не найден ни в компании, ни в файле")
                    boss = None
            else:
                cands = set(file_by_name.get(_key(m), [])) | set(member_by_name.get(_key(m), []))
                if len(cands) == 1:
                    boss = cands.pop()
                elif len(cands) > 1:
                    res.errors.append(f"Руководителей с именем «{m}» несколько — укажите email")
                else:
                    res.errors.append(f"Руководитель «{m}» не найден ни в компании, ни в файле")
            if boss and boss == email:
                res.errors.append("Сотрудник не может быть руководителем самому себе")
                boss = None
            res.manager_email = boss
        results.append(res)

    # Замкнутый круг руководителей внутри файла (А → Б → А).
    chain = {email: (u, m) for email, (u, m) in members.items()}
    boss_of: dict[str, Optional[str]] = {}
    id_to_email = {u.id: e for e, (u, _m) in chain.items()}
    for e, (_u, m) in chain.items():
        boss_of[e] = id_to_email.get(m.manager_id) if m.manager_id else None
    for res in results:
        if res.email and res.manager_email:
            boss_of[res.email] = res.manager_email
    for res in results:
        if not res.manager_email:
            continue
        cur, seen = res.manager_email, set()
        while cur and cur not in seen:
            if cur == res.email:
                res.errors.append("Получается замкнутый круг руководителей")
                break
            seen.add(cur)
            cur = boss_of.get(cur)

    for res in results:
        if res.errors:
            res.action = "error"
    invite = sum(1 for r in results if r.action == "invite")
    update = sum(1 for r in results if r.action == "update")
    limit_error = None
    max_users = get_limits(db, ctx.tenant.plan).get("max_users")
    if max_users is not None and count_users(db, tid) + invite > max_users:
        limit_error = (
            f"По тарифу в компании может быть до {max_users} сотрудников, сейчас {count_users(db, tid)}. "
            f"Новых в файле: {invite}. Обновите тариф или уменьшите список."
        )
    return Preview(
        rows=results, invite=invite, update=update,
        errors=sum(1 for r in results if r.action == "error"),
        new_departments=sorted(new_deps.values()),
        roles=sorted(x.name for x in roles.values()),
        limit_error=limit_error,
    )


@router.get("/template")
def template(ctx: TenantContext = Depends(require("users.create")), db: Session = Depends(get_db)):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = "Сотрудники"
    ws.append(["ФИО", "Email", "Должность", "Отдел", "Роль", "Руководитель"])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="2563EB")
    ws.append(["Иванов Иван Иванович", "ivanov@company.kz", "Начальник участка", "Производство", DEFAULT_ROLE, ""])
    ws.append(["Петрова Анна", "petrova@company.kz", "Мастер смены", "Производство", DEFAULT_ROLE, "ivanov@company.kz"])
    for col, w in zip("ABCDEF", (32, 30, 26, 22, 18, 30)):
        ws.column_dimensions[col].width = w
    ref = wb.create_sheet("Справка")
    ref.append(["Роли компании"])
    for r in db.query(Role).filter(Role.tenant_id == ctx.tenant.id).order_by(Role.name):
        ref.append([r.name])
    ref.append([])
    ref.append(["Отделы компании (новые создадутся при импорте)"])
    for d in db.query(Department).filter(Department.tenant_id == ctx.tenant.id).order_by(Department.name):
        ref.append([d.name])
    ref.append([])
    ref.append(["Руководитель — email или ФИО: из этого файла или уже работающего сотрудника."])
    ref.append(["Строки-примеры удалите перед импортом."])
    ref.column_dimensions["A"].width = 70
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=qadam-employees-template.xlsx"},
    )


@router.post("/preview", response_model=Preview)
async def preview(
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(require("users.create")),
    db: Session = Depends(get_db),
):
    check_feature(db, ctx.tenant, "invitations")
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise HTTPException(400, "Файл больше 5 МБ")
    return _analyze(db, ctx, _read_rows(content, file.filename or ""))


@router.post("/commit", response_model=CommitResult)
def commit(payload: CommitIn, ctx: TenantContext = Depends(require("users.create")), db: Session = Depends(get_db)):
    check_feature(db, ctx.tenant, "invitations")
    if not payload.rows:
        raise HTTPException(400, "Нет строк для импорта")
    result = _analyze(db, ctx, payload.rows)  # проверяем заново: данные могли измениться с момента просмотра
    if result.limit_error:
        raise HTTPException(402, result.limit_error)
    tid = ctx.tenant.id

    deps = {_key(d.name): d for d in db.query(Department).filter(Department.tenant_id == tid)}
    created: list[str] = []
    for name in result.new_departments:
        if _key(name) not in deps:
            d = Department(tenant_id=tid, name=name[:150])
            db.add(d)
            db.flush()
            deps[_key(name)] = d
            created.append(name)
    roles = {r.name.lower(): r for r in db.query(Role).filter(Role.tenant_id == tid)}
    default_role = roles.get(DEFAULT_ROLE.lower())
    members = {
        u.email.lower(): (u, m)
        for u, m in db.query(User, TenantMembership)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .filter(TenantMembership.tenant_id == tid)
    }

    invited, updated, skipped = 0, 0, 0
    invites: list[dict] = []
    now = datetime.now(timezone.utc)
    for r in result.rows:
        if r.action == "error":
            skipped += 1
            continue
        dep = deps.get(_key(r.department)) if r.department else None
        role = roles.get(r.role.lower()) if r.role else None
        if r.action == "update":
            u, m = members[r.email]
            if r.position:
                m.position = r.position
            if dep:
                set_primary_department(db, tid, u.id, dep.id)
            if role:
                others = [x for x in u.roles if x.tenant_id != tid]
                u.roles = others + [role]
                m.role_id = role.id
            if r.manager_email:
                boss = members.get(r.manager_email)
                if boss:
                    m.manager_id = boss[0].id
                    m.pending_manager_email = None
                else:
                    m.pending_manager_email = r.manager_email  # руководитель ещё приглашается
            updated += 1
            continue
        role = role or default_role
        token = secrets.token_urlsafe(32)
        inv = db.query(Invitation).filter(
            Invitation.tenant_id == tid, Invitation.email == r.email, Invitation.accepted_at.is_(None),
        ).first()
        if not inv:
            inv = Invitation(tenant_id=tid, email=r.email, token=token)
            db.add(inv)
        inv.token = token
        inv.role_id = role.id if role else None
        inv.department_id = dep.id if dep else None
        inv.position = r.position or None
        inv.full_name = r.full_name or None
        inv.manager_email = r.manager_email
        inv.invited_by = ctx.user.id
        inv.expires_at = now + timedelta(days=7)
        invited += 1
        invites.append({
            "email": r.email, "full_name": r.full_name,
            "invite_url": f"{settings.APP_BASE_URL.rstrip('/')}/invite/{token}",
        })
    # Обновлённые сотрудники, чей руководитель тоже уже в компании, связаны выше; новые — свяжутся при принятии.
    log_action(db, tenant_id=tid, user_id=ctx.user.id, action="import", entity="user",
               detail=f"Импорт сотрудников: приглашено {invited}, обновлено {updated}")
    db.commit()

    email_sent = False
    if payload.send_emails and invites and settings.SMTP_HOST:
        from ..tasks.email import send_invitation_email
        try:
            for i in invites:
                send_invitation_email.delay(
                    to=i["email"], tenant_name=ctx.tenant.name, invite_url=i["invite_url"], inviter_name=ctx.user.name,
                )
            email_sent = True
        except Exception:
            import logging
            logging.getLogger("qadam.import").warning("invite emails not queued", exc_info=True)
    return CommitResult(
        invited=invited, updated=updated, skipped=skipped, departments_created=created,
        invites=invites, email_sent=email_sent,
    )
