from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..core.security import verify_password, create_access_token
from ..core.permissions import all_permission_codes
from ..schemas.auth import LoginRequest, TokenResponse
from ..schemas.user import MeOut
from .deps import get_current_user, log_action

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Пользователь заблокирован")
    user.last_login_at = datetime.now(timezone.utc)
    log_action(db, user_id=user.id, action="login", entity="user", entity_id=user.id)
    db.commit()
    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    if user.is_superuser:
        perms = all_permission_codes()
    else:
        perms = sorted({p.code for r in user.roles for p in r.permissions})
    data = MeOut.model_validate(user).model_copy(update={"permissions": perms})
    return data
