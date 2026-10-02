from fastapi import APIRouter, HTTPException

from app import crud
from app.i18n import tr
from app.scheduler_engine import normalize_range_days
from app.ws import manager

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/export")
async def export_backup():
    return crud.export_all()


def _validate(payload: dict) -> None:
    """Chan file khong phai ban sao luu TRUOC khi xoa du lieu: truoc v0.5.56
    chon nham 1 file JSON bat ky (vd {}) la xoa sach lich + ten thiet bi."""
    def bad(vi: str, en: str):
        raise HTTPException(status_code=400, detail=tr(vi, en))

    if not isinstance(payload.get("schedules"), list) or not isinstance(payload.get("entity_aliases", []), list):
        bad("File không phải bản sao lưu My Scheduler (thiếu danh sách lịch).", "Not a My Scheduler backup file (no schedule list).")
    version = payload.get("version") or 1
    if not isinstance(version, int) or version > crud.BACKUP_VERSION:
        bad(f"Bản sao lưu từ phiên bản mới hơn (định dạng {version}) - hãy cập nhật add-on trước.",
            f"Backup comes from a newer version (format {version}) - update the add-on first.")
    for s in payload["schedules"]:
        if not isinstance(s, dict) or not s.get("id") or not s.get("name") or not s.get("time"):
            bad("Có lịch thiếu id/tên/giờ - file bị hỏng.", "A schedule is missing id/name/time - the file is damaged.")
    for a in payload.get("entity_aliases") or []:
        if not isinstance(a, dict) or not a.get("entity_id"):
            bad("Có thiết bị thiếu entity_id - file bị hỏng.", "A device is missing entity_id - the file is damaged.")
    if "groups" in payload and not isinstance(payload["groups"], list):
        bad("Danh sách nhóm không hợp lệ.", "Invalid group list.")
    if not isinstance(payload.get("settings", {}), dict):
        bad("Phần cài đặt không hợp lệ.", "Invalid settings section.")


@router.post("/import")
async def import_backup(payload: dict):
    _validate(payload)
    restored = crud.import_all(payload)
    normalize_range_days()  # file cu: moc Tat cua khung qua dem chua doi ngay
    # Cac tab/thiet bi khac dang mo tai lai ngay, khong phai cho poll.
    await manager.broadcast("schedule_updated", {"restored": True})
    await manager.broadcast("groups_updated", {})
    return {"ok": True, "restored": restored}
