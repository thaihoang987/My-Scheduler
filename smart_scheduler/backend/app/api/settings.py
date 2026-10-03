from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from app import crud
from app.models import SettingsIn
from app.scheduler_engine import paused_until, turn_off_running
from app.i18n import tr

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _user_id(request: Request) -> str | None:
    """Tai khoan HA dang mo add-on - Supervisor Ingress gui kem header nay.
    Mo thang qua cong (khong qua Ingress) thi khong co -> dung chung."""
    if request is None:
        return None
    return request.headers.get("x-remote-user-id") or None


def _for_user(settings: dict, uid: str | None) -> dict:
    """Kieu xem trang Nha (display_mode) RIENG tung tai khoan HA (v0.5.87, phan
    hoi 2026-10-03: admin xem Thu gon, user 1 xem bang 24h, user 2 xem Danh
    sach). Chua chon thi theo kieu dung chung."""
    out = dict(settings)
    per_user = out.pop("user_display_modes", None) or {}
    if uid and per_user.get(uid):
        out["display_mode"] = per_user[uid]
    return out


@router.get("")
async def get_settings(request: Request = None):  # type: ignore[assignment]
    return _for_user(crud.get_settings(), _user_id(request))


@router.put("")
async def update_settings(payload: SettingsIn, request: Request = None):  # type: ignore[assignment]
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    uid = _user_id(request)
    if uid and "display_mode" in data:
        per_user = dict(crud.get_settings().get("user_display_modes") or {})
        per_user[uid] = data.pop("display_mode")
        data["user_display_modes"] = per_user
    # Mui gio luon theo Home Assistant (v0.5.54) - client cu con gui thi bo qua.
    data.pop("timezone", None)
    if "language" in data and data["language"] not in ("vi", "en"):
        raise HTTPException(400, tr(f"Ngôn ngữ không hợp lệ: {data['language']}", f"Invalid language: {data['language']}"))
    before = paused_until()
    was_paused = before is not None and before > datetime.now(before.tzinfo)
    updated = crud.update_settings(data)
    # Vua bat "Tam dung tat ca lich" -> tat ngay thiet bi dang bat do khung
    # gio (phan hoi 2026-09-24 "tạm dừng thì tắt thiết bị luôn"): moc Tat
    # cua khung se bi tam dung theo, khong tat thi thiet bi bat suot ky nghi.
    end = paused_until(updated)
    if not was_paused and end is not None and end > datetime.now(end.tzinfo):
        await turn_off_running([s["id"] for s in crud.list_schedules()], "tạm dừng tất cả lịch")
    return _for_user(updated, uid)
