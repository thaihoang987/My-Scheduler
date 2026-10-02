from fastapi import APIRouter, HTTPException

from app import crud
from app import homeassistant
from app.models import ScheduleGroupToggle, ScheduleIds, ScheduleIn, ScheduleOut, ScheduleReorder
from app.scheduler_engine import compute_next_run, normalize_range_days, run_schedule_now, turn_off_running
from app.ws import manager
from app.i18n import tr

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


def _with_next_run(schedule: dict) -> dict:
    schedule = dict(schedule)
    schedule["next_run"] = compute_next_run(schedule)
    return schedule


@router.get("", response_model=list[ScheduleOut])
async def list_schedules():
    return [_with_next_run(s) for s in crud.list_schedules()]


@router.post("", response_model=ScheduleOut)
async def create_schedule(payload: ScheduleIn):
    data = payload.model_dump()
    data["action"] = payload.action.model_dump()
    created = crud.create_schedule(data)
    if created.get("group_id") and normalize_range_days({created["group_id"]}):
        created = crud.get_schedule(created["id"])
    await manager.broadcast("schedule_updated", created)
    return _with_next_run(created)


@router.get("/{schedule_id}", response_model=ScheduleOut)
async def get_schedule(schedule_id: str):
    schedule = crud.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    return _with_next_run(schedule)


@router.put("/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(schedule_id: str, payload: ScheduleIn):
    data = payload.model_dump()
    data["action"] = payload.action.model_dump()
    updated = crud.update_schedule(schedule_id, data)
    if not updated:
        raise HTTPException(404, "Schedule not found")
    if updated.get("group_id") and normalize_range_days({updated["group_id"]}):
        updated = crud.get_schedule(schedule_id)
    await manager.broadcast("schedule_updated", updated)
    return _with_next_run(updated)


@router.post("/delete-card")
async def delete_card(payload: ScheduleIds):
    """Xoa CA CARD (nut x o trang Nha) - tat luon moi thiet bi cua card roi
    moi xoa lich (phan hoi 2026-09-24 "xoá timer card thì tắt thiết bị đó"),
    tranh thiet bi dang bat mat lich Tat nen bat mai. Loi goi HA chi ghi
    Nhat ky, van xoa."""
    schedules = [s for s in (crud.get_schedule(sid) for sid in payload.schedule_ids) if s]
    targets: list[str] = []
    for s in schedules:
        targets.extend(e for e in s.get("target_entities") or [] if e not in targets)
    if targets:
        name = schedules[0]["name"]
        try:
            await homeassistant.call_service("homeassistant", "turn_off", targets, {})
            crud.add_history(None, name, None, "success", tr("Tắt thiết bị vì xoá card hẹn giờ", "Turned off device because its schedule card was deleted"), manual=True)
        except Exception as exc:  # noqa: BLE001
            crud.add_history(None, name, None, "error", tr(f"Không tắt được thiết bị khi xoá card: {exc}", f"Could not turn off device while deleting schedule card: {exc}"), manual=True)
    for s in schedules:
        crud.delete_schedule(s["id"])
        await manager.broadcast("schedule_deleted", {"id": s["id"]})
    return {"ok": True, "turned_off": targets}


@router.delete("/{schedule_id}")
async def delete_schedule(schedule_id: str):
    # Xoa 1 dong Lich giua khung gio dang bat -> tat thiet bi luon (moc Tat
    # sap bi xoa theo, xem turn_off_running).
    await turn_off_running([schedule_id], "xoá lịch")
    if not crud.delete_schedule(schedule_id):
        raise HTTPException(404, "Schedule not found")
    await manager.broadcast("schedule_deleted", {"id": schedule_id})
    return {"ok": True}


@router.post("/reorder")
async def reorder(payload: ScheduleReorder):
    crud.reorder_schedules(payload.ordered_ids)
    await manager.broadcast("schedule_updated", {"reordered": True})
    return {"ok": True}


@router.post("/group-toggle", response_model=list[ScheduleOut])
async def group_toggle(payload: ScheduleGroupToggle):
    """Bat/tat CA NHOM lich cua 1 thiet bi cung luc (nut tren DeviceCard) -
    xem crud.set_group_enabled() ve ly do KHONG dung POST /{id}/toggle lap
    lai cho tung lich nhu truoc (phan hoi 2026-09-23 "timer option nho ben
    trong dang disable thi khi bat tat timer tong no deu thanh on ca")."""
    if not payload.enabled:
        await turn_off_running(payload.schedule_ids, "tắt công tắc tổng của card")
    updated = crud.set_group_enabled(payload.schedule_ids, payload.enabled)
    for s in updated:
        await manager.broadcast("schedule_updated", s)
    return [_with_next_run(s) for s in updated]


@router.post("/{schedule_id}/toggle", response_model=ScheduleOut)
async def toggle(schedule_id: str):
    schedule = crud.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    if schedule["enabled"]:
        await turn_off_running([schedule_id], "tắt lịch")
    updated = crud.set_enabled(schedule_id, not schedule["enabled"])
    await manager.broadcast("schedule_updated", updated)
    return _with_next_run(updated)


@router.post("/{schedule_id}/favorite", response_model=ScheduleOut)
async def toggle_favorite(schedule_id: str):
    schedule = crud.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    updated = crud.set_favorite(schedule_id, not schedule["favorite"])
    await manager.broadcast("schedule_updated", updated)
    return _with_next_run(updated)


@router.post("/{schedule_id}/skip", response_model=ScheduleOut)
async def skip_next(schedule_id: str):
    schedule = crud.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    updated = crud.set_skip_once(schedule_id, not schedule["skip_once"])
    await manager.broadcast("schedule_updated", updated)
    return _with_next_run(updated)


@router.post("/{schedule_id}/run")
async def run_now(schedule_id: str):
    schedule = crud.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    status, message = await run_schedule_now(schedule)
    return {"status": status, "message": message}
