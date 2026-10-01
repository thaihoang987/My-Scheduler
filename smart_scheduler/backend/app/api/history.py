from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app import crud, homeassistant
from app.i18n import tr

router = APIRouter(prefix="/api/history", tags=["history"])

# Toi da 1 lan tai: tranh 1 request keo ca thang lich su (UI chi tai tung doan).
MAX_RANGE_DAYS = 31


@router.get("")
async def list_history(limit: int = 200, schedule_id: Optional[str] = None):
    return crud.list_history(limit=limit, schedule_id=schedule_id)


@router.get("/states")
async def state_history(entity_ids: str = Query(..., min_length=1), start: str = Query(...), end: str = Query(...)):
    """Lich su bat/tat that cua thiet bi (lay tu recorder cua HA) cho card
    timeline o Device Detail."""
    ids = [e.strip() for e in entity_ids.split(",") if e.strip()][:20]
    try:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="start/end must be ISO datetimes") from exc
    if start_dt.tzinfo is None or end_dt.tzinfo is None or end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="start/end must be timezone-aware and start < end")
    if (end_dt - start_dt).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"range must be <= {MAX_RANGE_DAYS} days")
    try:
        return await homeassistant.get_state_history(ids, start_dt.isoformat(), end_dt.isoformat())
    except Exception as exc:  # recorder tat / HA loi -> UI hien thong bao thay vi trang
        raise HTTPException(status_code=502, detail=tr(f"Không lấy được lịch sử từ Home Assistant: {exc}", f"Could not load history from Home Assistant: {exc}")) from exc
