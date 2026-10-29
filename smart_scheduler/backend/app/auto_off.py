"""Tu tat sau khi bat N thoi gian (v0.5.44, viet lai theo su kien o v0.5.93).

Khac Schedule thuong: khong chay theo gio, ma theo TRANG THAI THAT cua thiet
bi. Thiet bi bat tu BAT KY dau (Lovelace, cong tac tay, automation, lich khac)
-> dem tu luc bat, du N thi tat DUNG 1 LAN.

Khong con vong lap hoi trang thai. App giu 1 WebSocket toi HA (xem
homeassistant.watch_states) va chi phan ung khi HA bao `state_changed`:
- off -> bat: dat MOC moi (xoa moc cu neu con sot), hen 1 lan toi moc.
- bat -> off: xoa moc, huy hen.
- unavailable/unknown: giu nguyen moc va hen (mat ket noi khong phai tat).
Het gio ma thiet bi van bat thi gui DUNG 1 lenh tat. Neu mat ket noi luc do,
khong gui lai lien tuc: den khi HA ket noi lai, app doc trang thai 1 lan va
chi tat khi CON moc (co) chua het VA thiet bi van dang bat.

Luu bang 1 dong `schedules` voi trigger_type="auto_off", `time`="HH:MM:SS" la
DO DAI (khong phai gio dong ho) - de card hien tren trang Nha, bat/tat/xoa/
sap xep/sao luu dung chung co che cua lich thuong. scheduler_engine bo qua
cac dong nay.

Moc bat (`on_since`) luu SQLite (bang `auto_off_state`) de SONG QUA restart/
backup: vd den bat 23:00, tat sau 3h, 01:00 Unraid tat VM Home Assistant de
backup image, 01:30 bat lai. Moc 23:00 van con -> tat dung 02:00, hoac tat
NGAY khi ket noi lai neu da qua han.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app import crud, homeassistant, manual_timer, sources
from app.ws import manager
from app.i18n import tr

log = logging.getLogger("ha_smart_scheduler.auto_off")

OFF_STATES = ("off", "closed")
NO_STATE = ("unavailable", "unknown", None)

_states: dict[str, str | None] = {}  # entity dang theo doi -> state gan nhat
_changed: dict[str, datetime | None] = {}  # entity -> last_changed gan nhat
_tasks: dict[str, asyncio.Task] = {}  # entity -> hen tat 1 lan
_sent: set[str] = set()  # da gui lenh tat trong lan ket noi nay (khong gui lai)
_ready_hook = None


def set_ready_hook(hook) -> None:
    """Viec them can lam 1 lan moi khi (re)connect HA (vd tat bu khung gio)."""
    global _ready_hook
    _ready_hook = hook


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _kind(state: str | None) -> str:
    if state in OFF_STATES:
        return "off"
    if state in NO_STATE:
        return "gone"
    return "on"


def duration_seconds(value: str) -> int:
    parts = [int(p) for p in (value or "0").split(":")]
    while len(parts) < 3:
        parts.append(0)
    h, m, s = parts[:3]
    return h * 3600 + m * 60 + s


def format_duration(secs: int) -> str:
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
    parts = [f"{h} " + tr("giờ", "h")] if h else []
    if m:
        parts.append(f"{m} " + tr("phút", "min"))
    if s:
        parts.append(f"{s} " + tr("giây", "s"))
    return " ".join(parts)


def rules(schedules: list[dict] | None = None) -> dict[str, tuple[int, dict]]:
    """entity -> (so giay, lich) cua cac lich auto_off dang bat. 1 entity co
    nhieu lich thi lay thoi gian NGAN nhat (an toan hon)."""
    out: dict[str, tuple[int, dict]] = {}
    for s in schedules if schedules is not None else crud.list_schedules():
        if s.get("trigger_type") != "auto_off" or not s.get("enabled", True) or not s.get("card_enabled", True):
            continue
        secs = duration_seconds(s.get("time") or "")
        if secs <= 0:
            continue
        for eid in s.get("target_entities") or []:
            if eid.split(".", 1)[0] in ("scene", "script"):
                continue  # chay 1 lan, khong co "dang bat" de tu tat (v0.5.79)
            if eid not in out or secs < out[eid][0]:
                out[eid] = (secs, s)
    return out


def list_active() -> list[dict]:
    """Dem nguoc dang chay (thiet bi dang bat, co moc) - frontend ve thanh
    tien trinh tren card nhu hen "Bat cuong che"."""
    active = []
    rule_map = rules()
    for eid, on_since in crud.list_auto_off_state().items():
        if eid not in rule_map:
            continue
        start = _parse(on_since)
        if start is None:
            continue
        secs = rule_map[eid][0]
        active.append({
            "id": f"auto_off:{eid}",
            "entity_ids": [eid],
            "started_at": start.isoformat(),
            "off_at": (start + timedelta(seconds=secs)).isoformat(),
            "source": "auto_off",
        })
    return active


def _manual_entities() -> set[str]:
    """Thiet bi dang "Bat cuong che" CO hen tat - nguoi dung chu dong chon
    thoi gian rieng, hen do quyet dinh (no tu tat khi het gio)."""
    return {e for t in manual_timer.list_active() if t.get("off_at") for e in t["entity_ids"]}


def _cancel(eid: str) -> None:
    task = _tasks.pop(eid, None)
    if task and task is not asyncio.current_task():
        task.cancel()


def _drop_mark(eid: str) -> bool:
    _cancel(eid)
    _sent.discard(eid)
    if eid in crud.list_auto_off_state():
        crud.delete_auto_off_state(eid)
        return True
    return False


def _first_mark(eid: str, schedule: dict, now: datetime) -> datetime:
    """Lan dau thay dang bat ma chua co moc: moc = last_changed cua HA, nhung
    khong som hon luc lich duoc tao/sua (vua dat lich cho thiet bi dang bat tu
    2 tieng truoc thi dem tu bay gio, khong tat bat ngo)."""
    on_since = min(now, _changed.get(eid) or now)
    armed = _parse(schedule.get("updated_at"))
    if armed and armed > on_since:
        on_since = min(now, armed)
    return on_since


async def _settle(eid: str, now: datetime, rule_map: dict[str, tuple[int, dict]]) -> list[str]:
    """Dat lai hen cho 1 entity theo moc dang luu. Da qua han thi tat ngay
    (1 lan), chua thi hen toi dung moc. Tra ve [eid] neu vua gui lenh tat."""
    _cancel(eid)
    rule = rule_map.get(eid)
    on_since = _parse(crud.list_auto_off_state().get(eid))
    if rule is None or on_since is None:
        return []
    left = (on_since + timedelta(seconds=rule[0]) - now).total_seconds()
    if left <= 0:
        return [eid] if await _expire(eid, now, rule_map) else []
    _tasks[eid] = asyncio.create_task(_wait_and_expire(eid, left))
    return []


async def _wait_and_expire(eid: str, delay: float) -> None:
    try:
        await asyncio.sleep(delay)
    except asyncio.CancelledError:
        return
    _tasks.pop(eid, None)
    try:
        now = _now()
        await _settle(eid, now, rules())  # kiem tra lai bang dong ho that (VM tam dung lam sleep lech)
    except Exception:  # noqa: BLE001
        log.exception("Loi khi tu tat %s", eid)


async def _expire(eid: str, now: datetime, rule_map: dict[str, tuple[int, dict]]) -> bool:
    """Het gio: gui DUNG 1 lenh tat neu thiet bi van bat. Tra ve True neu da gui."""
    secs, schedule = rule_map[eid]
    kind = _kind(_states.get(eid))
    if kind == "off":
        _drop_mark(eid)
        return False
    if kind == "gone":
        return False  # giu moc, thiet bi tro lai thi su kien se xu ly
    if eid in _manual_entities():
        return False  # hen "Bat cuong che" co gio rieng quyet dinh
    if eid in _sent:
        return False  # da gui trong lan ket noi nay, khong gui lai
    _sent.add(eid)
    dur = format_duration(secs)
    try:
        with sources.acting_as("auto_off", schedule["name"]):
            await homeassistant.call_service("homeassistant", "turn_off", [eid], {})
        status, message = "success", tr(f"Tự tắt sau khi bật {dur}", f"Auto-off after being on for {dur}")
    except Exception as exc:  # noqa: BLE001
        status, message = "error", tr(f"Tự tắt sau {dur} thất bại: {exc}", f"Auto-off after {dur} failed: {exc}")
        log.warning("Auto-off %s that bai: %s", eid, exc)
    crud.add_history(schedule["id"], schedule["name"], None, status, message)
    await manager.broadcast("auto_off_updated", {})
    return status == "success"


async def sync(now: datetime | None = None, states: list[dict] | None = None) -> list[str]:
    """Doi chieu 1 lan: lich vua doi, hoac vua (re)connect HA (kem snapshot
    `states`). Tra ve cac entity vua gui lenh tat."""
    now = now or _now()
    reconnect = states is not None
    rule_map = rules()
    if reconnect:
        _sent.clear()  # ket noi moi -> duoc phep gui 1 lan nua cho thiet bi con bat
        snapshot = {s["entity_id"]: s for s in states}
        for eid in rule_map:
            st = snapshot.get(eid)
            _states[eid] = st.get("state") if st else None
            _changed[eid] = _parse(st.get("last_changed")) if st else None
    changed = False
    for eid in [e for e in crud.list_auto_off_state() if e not in rule_map]:
        changed |= _drop_mark(eid)  # lich bi xoa/tat -> bo moc
    for eid in [e for e in _tasks if e not in rule_map]:
        _cancel(eid)
    for eid in [e for e in _states if e not in rule_map]:
        _states.pop(eid, None)
        _changed.pop(eid, None)
    if not reconnect and any(eid not in _states for eid in rule_map):
        try:  # co thiet bi moi duoc theo doi: doc trang thai hien tai 1 lan
            snapshot = {s["entity_id"]: s for s in await homeassistant.get_states()}
            for eid in rule_map:
                if eid not in _states and eid in snapshot:
                    _states[eid] = snapshot[eid].get("state")
                    _changed[eid] = _parse(snapshot[eid].get("last_changed"))
        except Exception as exc:  # noqa: BLE001
            log.debug("Chua doc duoc trang thai HA: %s", exc)
    for eid in rule_map:
        _states.setdefault(eid, None)  # van theo doi su kien du chua doc duoc state
        _changed.setdefault(eid, None)
    turned_off: list[str] = []
    for eid, (_, schedule) in rule_map.items():
        kind = _kind(_states.get(eid))
        if kind == "off":
            changed |= _drop_mark(eid)
            continue
        if kind == "on" and eid not in crud.list_auto_off_state():
            crud.save_auto_off_state(eid, _first_mark(eid, schedule, now).isoformat())
            changed = True
        turned_off += await _settle(eid, now, rule_map)
    if changed:
        await manager.broadcast("auto_off_updated", {})
    return turned_off


async def on_change(eid: str, old: dict | None, new: dict | None, now: datetime | None = None) -> list[str]:
    """1 su kien state_changed tu HA. Bo qua nhanh entity khong co lich Tu tat."""
    if eid not in _states:
        return []
    now = now or _now()
    old_kind = _kind(old.get("state") if old else None)
    state = new.get("state") if new else None
    _states[eid] = state
    _changed[eid] = _parse(new.get("last_changed")) if new else None
    kind = _kind(state)
    rule_map = rules()
    if eid not in rule_map or kind == "gone":
        return []  # mat ket noi/khoi dong: giu nguyen moc va hen
    if kind == "off":
        if _drop_mark(eid):
            await manager.broadcast("auto_off_updated", {})
        return []
    stored = crud.list_auto_off_state()
    if old_kind == "off" or eid not in stored:
        # Vua chuyen tu tat sang bat: moc MOI, bo moc cu con sot
        _sent.discard(eid)
        crud.save_auto_off_state(eid, now.isoformat() if old_kind == "off" else _first_mark(eid, rule_map[eid][1], now).isoformat())
        await manager.broadcast("auto_off_updated", {})
    elif eid in _tasks:
        return []  # bat -> bat (doi thuoc tinh): hen dang chay, khong dung toi
    return await _settle(eid, now, rule_map)


async def on_schedule_event(event: str) -> None:
    """Lich Tu tat vua duoc tao/sua/xoa/bat/tat -> dat lai hen (khong poll)."""
    if event in ("schedule_updated", "schedule_deleted"):
        await sync()


async def _on_ready(states: list[dict]) -> None:
    await sync(states=states)
    if _ready_hook:
        await _ready_hook(states)


async def _on_event(eid: str, old: dict | None, new: dict | None) -> None:
    """Moi su kien state_changed: ghi nguon bat/tat (sources) truoc, roi moi xu ly
    tu tat. Ghi nguon loi thi van phai xu ly tu tat."""
    try:
        await sources.record(eid, old, new)
    except Exception:  # noqa: BLE001
        log.exception("Loi khi ghi nguon doi trang thai %s", eid)
    await on_change(eid, old, new)


async def auto_off_loop() -> None:
    log.info("Auto-off watcher started (event-driven)")
    try:
        await homeassistant.watch_states(_on_ready, _on_event)
    finally:
        for eid in list(_tasks):
            _cancel(eid)
