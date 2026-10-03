from fastapi import APIRouter, HTTPException

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from app import crud
from app.models import GroupEnabled, GroupIn, GroupOut, GroupReorder, GroupSkip
from app.scheduler_engine import turn_off_running
from app.ws import manager

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.get("", response_model=list[GroupOut])
async def list_groups():
    return crud.list_groups()


@router.post("", response_model=GroupOut)
async def create_group(payload: GroupIn):
    created = crud.create_group(payload.name)
    await manager.broadcast("groups_updated", {})
    return created


@router.put("/{group_id}", response_model=GroupOut)
async def rename_group(group_id: str, payload: GroupIn):
    updated = crud.rename_group(group_id, payload.name)
    if not updated:
        raise HTTPException(404, "Group not found")
    await manager.broadcast("groups_updated", {})
    return updated


@router.delete("/{group_id}")
async def delete_group(group_id: str):
    if not crud.delete_group(group_id):
        raise HTTPException(404, "Group not found")
    await manager.broadcast("groups_updated", {})
    return {"ok": True}


@router.post("/reorder")
async def reorder(payload: GroupReorder):
    crud.reorder_groups(payload.ordered_ids)
    await manager.broadcast("groups_updated", {})
    return {"ok": True}


@router.post("/{group_id}/enabled", response_model=GroupOut)
async def set_enabled(group_id: str, payload: GroupEnabled):
    """Cong tac nhom (v0.5.85): khong che moi card trong nhom, KHONG doi toggle
    rieng cua card. Tat nhom giua khung gio dang bat -> tat thiet bi luon (nhu
    tat cong tac card). Goi truoc khi luu: sau khi nhom tat thi khung khong con
    "dang chay" de tim."""
    if not payload.enabled:
        await turn_off_running(crud.group_schedule_ids(group_id), "tắt nhóm")
    updated = crud.set_group_state(group_id, enabled=payload.enabled)
    if not updated:
        raise HTTPException(404, "Group not found")
    await manager.broadcast("groups_updated", {})
    await manager.broadcast("schedule_updated", {"group": group_id})
    return updated


@router.post("/{group_id}/skip", response_model=GroupOut)
async def set_skip(group_id: str, payload: GroupSkip):
    """Bo qua lenh Bat cua ca nhom toi 00:00 sau `days` ngay (0 = het hom nay)
    theo mui gio cua app; days=None = huy."""
    until = None
    if payload.days is not None:
        tz = ZoneInfo(crud.settings_timezone())
        day = datetime.now(tz).date() + timedelta(days=payload.days + 1)
        until = datetime.combine(day, time(0), tz).isoformat()
    updated = crud.set_group_state(group_id, skip_until=until)
    if not updated:
        raise HTTPException(404, "Group not found")
    await manager.broadcast("groups_updated", {})
    await manager.broadcast("schedule_updated", {"group": group_id})
    return updated
