from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import auto_off, manual_timer

router = APIRouter(prefix="/api/manual", tags=["manual"])


class ForceOnIn(BaseModel):
    entity_ids: list[str] = Field(default_factory=list)
    auto_off_minutes: float | None = None


@router.get("/active")
async def active():
    # Kem dem nguoc "Tu tat sau khi bat" (source="auto_off", khong huy duoc
    # qua /cancel) de card ve chung 1 thanh tien trinh.
    return manual_timer.list_active() + auto_off.list_active()


@router.post("/force_on")
async def force_on(payload: ForceOnIn):
    if not payload.entity_ids:
        raise HTTPException(400, "entity_ids khong duoc rong")
    return await manual_timer.start(payload.entity_ids, payload.auto_off_minutes)


@router.post("/{timer_id}/cancel")
async def cancel(timer_id: str):
    if not await manual_timer.cancel(timer_id):
        raise HTTPException(404, "Timer not found")
    return {"ok": True}
