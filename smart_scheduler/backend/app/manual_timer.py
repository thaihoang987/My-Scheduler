"""'Bat cuong che' + tu tat sau X phut - KHONG phai Schedule: bat NGAY
lap tuc qua HA, tuy chon hen 1 lan tu tat sau bao lau. Hen co moc tu tat
duoc luu rieng trong SQLite de khoi phuc qua restart Add-on, khong ghi vao
bang `schedules`. Dung service `homeassistant.turn_on`/
`turn_off` (umbrella service cua HA, hoat dong dung cho hau het domain -
light/switch/fan/climate/cover/media_player...) thay vi service rieng tung
domain, giu logic don gian vi day chi la bat/tat tho, khong dat che
do/nhiet do/do sang gi (muon chi tiet thi dung Schedule "Chay ngay" thay).
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from app import crud, homeassistant
from app.ws import manager
from app.i18n import tr

log = logging.getLogger("ha_smart_scheduler.manual_timer")

_active: dict[str, dict] = {}  # id -> {entity_ids, off_at (iso|None), task}
RETRY_SECONDS = 30


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_active() -> list[dict]:
    return [
        {"id": tid, "entity_ids": t["entity_ids"], "started_at": t["started_at"], "off_at": t["off_at"]}
        for tid, t in _active.items()
    ]


async def restore_active() -> None:
    """Nap lai hen tat sau restart; hen qua han duoc xu ly ngay lap tuc."""
    restored = 0
    now = datetime.now(timezone.utc)
    for record in crud.list_manual_timers():
        try:
            off_at = datetime.fromisoformat(record["off_at"])
            if off_at.tzinfo is None:
                off_at = off_at.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            log.warning("Xoa manual timer %s vi off_at khong hop le", record["id"])
            crud.delete_manual_timer(record["id"])
            continue
        delay_seconds = max(0.0, (off_at - now).total_seconds())
        task = asyncio.create_task(_auto_off(record["id"], record["entity_ids"], delay_seconds))
        _active[record["id"]] = {**record, "task": task}
        restored += 1
    if restored:
        log.info("Khoi phuc %d hen tat cuong che tu SQLite", restored)


async def start(entity_ids: list[str], auto_off_minutes: float | None) -> dict:
    await homeassistant.call_service("homeassistant", "turn_on", entity_ids, {})
    started_at = _now_iso()
    if not auto_off_minutes or auto_off_minutes <= 0:
        return {"id": None, "entity_ids": entity_ids, "started_at": started_at, "off_at": None}

    tid = str(uuid.uuid4())
    off_at = (datetime.fromisoformat(started_at) + timedelta(minutes=auto_off_minutes)).isoformat()
    record = {"id": tid, "entity_ids": entity_ids, "started_at": started_at, "off_at": off_at}
    crud.save_manual_timer(record)
    task = asyncio.create_task(_auto_off(tid, entity_ids, auto_off_minutes * 60))
    _active[tid] = {**record, "task": task}
    await manager.broadcast("manual_timer_started", record)
    return record


async def _auto_off(tid: str, entity_ids: list[str], delay_seconds: float) -> None:
    try:
        await asyncio.sleep(delay_seconds)
        attempt = 0
        while True:
            # Lan thu lai chi gui khi ket noi HA da on dinh (v0.5.79) - khong ban
            # lenh moi 30s trong luc HA/mang chap chon.
            if attempt and not await homeassistant.ensure_stable():
                await asyncio.sleep(RETRY_SECONDS)
                continue
            attempt += 1
            try:
                await homeassistant.call_service("homeassistant", "turn_off", entity_ids, {})
                break
            except Exception as exc:  # noqa: BLE001 - HA co the chua san sang sau restart
                log.warning("Manual timer %s tu tat that bai, thu lai khi HA on dinh: %s", tid, exc)
                await asyncio.sleep(RETRY_SECONDS)
    except asyncio.CancelledError:
        return  # shutdown giu DB; cancel() chu dong se xoa DB truoc khi huy task
    _active.pop(tid, None)
    crud.delete_manual_timer(tid)
    crud.add_history(None, tr("Bật cưỡng chế", "Forced on"), None, "success", tr("Tự tắt theo hẹn giờ thủ công", "Automatically turned off by manual timer"), manual=True)
    await manager.broadcast("manual_timer_finished", {"id": tid, "entity_ids": entity_ids, "status": "success"})


def replace_entity(old_id: str, new_id: str) -> None:
    """Doi entity trong cac hen dang chay (DB da duoc crud.replace_entity
    cap nhat) - task cu da dong entity_ids trong closure nen phai huy va tao
    lai voi thoi gian con lai, giu nguyen moc off_at."""
    now = datetime.now(timezone.utc)
    for tid, entry in list(_active.items()):
        if old_id not in entry["entity_ids"]:
            continue
        ids: list[str] = []
        for i in entry["entity_ids"]:
            j = new_id if i == old_id else i
            if j not in ids:
                ids.append(j)
        entry["task"].cancel()  # CancelledError -> return, khong xoa DB
        off_at = datetime.fromisoformat(entry["off_at"])
        if off_at.tzinfo is None:
            off_at = off_at.replace(tzinfo=timezone.utc)
        delay_seconds = max(0.0, (off_at - now).total_seconds())
        entry["entity_ids"] = ids
        entry["task"] = asyncio.create_task(_auto_off(tid, ids, delay_seconds))


async def cancel(tid: str) -> bool:
    """Huy hen bat cuong che - phan hoi 2026-09-23: "huỷ xong là tắt thiết
    bị bật cưỡng chế luôn" (truoc day Huy chi dung hen gio, KHONG tat thiet
    bi - hanh vi cu de lai thiet bi dang bat vo thoi han, gay hieu lam)."""
    entry = _active.pop(tid, None)
    if not entry:
        return False
    crud.delete_manual_timer(tid)
    entry["task"].cancel()
    try:
        await homeassistant.call_service("homeassistant", "turn_off", entry["entity_ids"], {})
    except Exception as exc:  # noqa: BLE001 - huy van coi la thanh cong, chi log loi tat
        log.warning("Huy hen bat cuong che %s nhung tat thiet bi that bai: %s", tid, exc)
    await manager.broadcast("manual_timer_finished", {"id": tid, "entity_ids": entry["entity_ids"], "status": "cancelled"})
    return True
