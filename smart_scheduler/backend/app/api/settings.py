from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from app import crud
from app.models import SettingsIn
from app.scheduler_engine import paused_until, turn_off_running
from app.i18n import tr

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings():
    return crud.get_settings()


@router.put("")
async def update_settings(payload: SettingsIn):
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "timezone" in data:
        try:
            ZoneInfo(data["timezone"])
        except Exception:  # noqa: BLE001 - ten mui gio sai -> tu choi, khong luu
            raise HTTPException(400, tr(f"Múi giờ không hợp lệ: {data['timezone']}", f"Invalid time zone: {data['timezone']}"))
    if "language" in data and data["language"] not in ("vi", "en"):
        raise HTTPException(400, tr(f"Ngôn ngữ không hợp lệ: {data['language']}", f"Invalid language: {data['language']}"))
    # Mui gio khac HA: chi ghi Nhat ky (khong canh bao tren giao dien - v0.5.53).
    if "timezone" in data:
        from app import config
        if config.HA_TIMEZONE and data["timezone"] != config.HA_TIMEZONE:
            crud.add_history(None, tr("Múi giờ", "Time zone"), None, "warning",
                             tr(f"Đổi múi giờ sang {data['timezone']}, khác Home Assistant ({config.HA_TIMEZONE}). Lịch chạy theo {data['timezone']}.",
                                f"Time zone set to {data['timezone']}, different from Home Assistant ({config.HA_TIMEZONE}). Schedules follow {data['timezone']}."),
                             manual=True)
    before = paused_until()
    was_paused = before is not None and before > datetime.now(before.tzinfo)
    updated = crud.update_settings(data)
    # Vua bat "Tam dung tat ca lich" -> tat ngay thiet bi dang bat do khung
    # gio (phan hoi 2026-09-24 "tạm dừng thì tắt thiết bị luôn"): moc Tat
    # cua khung se bi tam dung theo, khong tat thi thiet bi bat suot ky nghi.
    end = paused_until(updated)
    if not was_paused and end is not None and end > datetime.now(end.tzinfo):
        await turn_off_running([s["id"] for s in crud.list_schedules()], "tạm dừng tất cả lịch")
    return updated
