"""Thiet bi mo cung (v0.6.0): 1 thiet bi dung chung chay theo ca nhom.

Vi du 10 van tuoi mo lan luot, chi co 1 bom tang ap. Chi can 1 thiet bi trong
nhom bat la bat thiet bi mo cung (neu dang tat). Ca nhom tat het thi cho
`time` (do tre, "HH:MM:SS", mac dinh 2 giay) roi kiem tra lai: van tat het moi
tat thiet bi mo cung. Trong luc cho co thiet bi bat lai (2 van cach nhau duoi
2 giay) thi huy lenh tat, bom chay lien tuc.

Luu bang 1 dong `schedules` voi trigger_type="companion" (giong auto_off):
target_entities = nhom, action.service_data["companion"] = thiet bi mo cung.
Card hien tren trang Nha, bat/tat/xoa/sap xep/sao luu dung chung co che cua
lich thuong; scheduler_engine bo qua cac dong nay.

Chay theo su kien `state_changed` (chung WebSocket voi auto_off), khong poll.
Nhieu lich cung 1 thiet bi mo cung thi gop lai: nhom = hop cac nhom, do tre =
lon nhat - 2 nhom dung chung 1 bom khong tat bom cua nhau.
"""
import asyncio
import logging
from dataclasses import dataclass, field

from app import crud, homeassistant, sources
from app.i18n import tr

log = logging.getLogger("ha_smart_scheduler.companion")

INACTIVE = ("off", "closed", "closing", "unavailable", "unknown", None)
SERVICES = {"valve": ("open_valve", "close_valve"), "cover": ("open_cover", "close_cover")}
DEFAULT_DELAY = 2


@dataclass
class Rule:
    companion: str
    members: set[str] = field(default_factory=set)
    delay: float = 0
    schedule: dict | None = None  # lich dau tien (ten + id cho Nhat ky)


_states: dict[str, str | None] = {}  # entity dang theo doi -> state gan nhat
_rules: dict[str, Rule] = {}  # thiet bi mo cung -> quy tac da gop
_timers: dict[str, asyncio.Task] = {}  # thiet bi mo cung -> hen tat
_switching: dict[str, bool] = {}  # lenh bat (True)/tat (False) dang gui
_locks: dict[str, asyncio.Lock] = {}


def is_active(state: str | None) -> bool:
    """Bat = moi state khac off/closed (unavailable tinh la tat)."""
    return state not in INACTIVE


def delay_seconds(value: str | None) -> float:
    parts = [float(p) for p in (value or "0").split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, s = parts[-3:]
    return h * 3600 + m * 60 + s


def companion_of(schedule: dict) -> str | None:
    return ((schedule.get("action") or {}).get("service_data") or {}).get("companion") or None


def service_for(entity_id: str, turn_on: bool) -> tuple[str, str]:
    domain = entity_id.split(".", 1)[0]
    if domain in SERVICES:
        return domain, SERVICES[domain][0 if turn_on else 1]
    return "homeassistant", "turn_on" if turn_on else "turn_off"


def build_rules(schedules: list[dict] | None = None) -> dict[str, Rule]:
    out: dict[str, Rule] = {}
    for s in schedules if schedules is not None else crud.list_schedules():
        if s.get("trigger_type") != "companion" or not s.get("enabled", True) or not s.get("card_enabled", True):
            continue
        companion = companion_of(s)
        members = set(s.get("target_entities") or []) - {companion}
        if not companion or not members:
            continue
        rule = out.setdefault(companion, Rule(companion=companion, schedule=s))
        rule.members |= members
        rule.delay = max(rule.delay, delay_seconds(s.get("time")))
    return out


def _signature(rule: Rule | None):
    return None if rule is None else (frozenset(rule.members), rule.delay)


def _companion_on(companion: str) -> bool:
    """Lenh dang gui duoc coi nhu da xong."""
    if companion in _switching:
        return _switching[companion]
    return is_active(_states.get(companion))


def _cancel_timer(companion: str) -> None:
    task = _timers.pop(companion, None)
    if task and task is not asyncio.current_task():
        task.cancel()


def evaluate(companion: str) -> None:
    rule = _rules.get(companion)
    if rule is None:
        return
    if any(is_active(_states.get(e)) for e in rule.members):
        _cancel_timer(companion)
        if not _companion_on(companion):
            _switch(companion, True)
        return
    if companion in _timers or not _companion_on(companion):
        return
    _timers[companion] = asyncio.create_task(_wait_and_turn_off(companion, rule.delay))


async def _wait_and_turn_off(companion: str, delay: float) -> None:
    try:
        await asyncio.sleep(delay)
    except asyncio.CancelledError:
        return
    _timers.pop(companion, None)
    rule = _rules.get(companion)
    if rule is None:
        return
    # kiem tra lai: co the co thiet bi vua bat trong luc cho
    if any(is_active(_states.get(e)) for e in rule.members):
        return
    if _companion_on(companion):
        _switch(companion, False)


def _switch(companion: str, turn_on: bool) -> None:
    _switching[companion] = turn_on  # dat ngay: task chi chay o vong lap ke tiep
    asyncio.create_task(_do_switch(companion, turn_on))


async def _do_switch(companion: str, turn_on: bool) -> None:
    # Gui lan luot, de lenh tat dang gui khong xong SAU lenh bat moi hon
    async with _locks.setdefault(companion, asyncio.Lock()):
        if _switching.get(companion) is not turn_on:
            return  # da co lenh moi hon
        try:
            await _call(companion, turn_on)
        finally:
            if _switching.get(companion) is turn_on:
                _switching.pop(companion, None)


async def _call(companion: str, turn_on: bool) -> None:
    rule = _rules.get(companion)
    schedule = rule.schedule if rule else None
    name = (schedule or {}).get("name") or companion
    domain, service = service_for(companion, turn_on)
    try:
        with sources.acting_as("companion", name):
            await homeassistant.call_service(domain, service, [companion], {})
        # HA bao state_changed sau mot chut - ghi truoc de su kien den giua
        # chung khong tinh nham theo state cu
        on_state = "open" if domain == "valve" else "on"
        off_state = "closed" if domain == "valve" else "off"
        _states[companion] = on_state if turn_on else off_state
        status = "success"
        message = (tr("Thiết bị mở cùng: bật vì có thiết bị trong nhóm đang bật", "Companion device: turned on because a device in the group is on")
                   if turn_on else
                   tr(f"Thiết bị mở cùng: tắt vì cả nhóm đã tắt quá {_fmt(rule.delay if rule else 0)} giây",
                      f"Companion device: turned off, the whole group has been off for {_fmt(rule.delay if rule else 0)} s"))
    except Exception as exc:  # noqa: BLE001
        status = "error"
        message = tr(f"Thiết bị mở cùng: {'bật' if turn_on else 'tắt'} thất bại: {exc}",
                     f"Companion device: turning {'on' if turn_on else 'off'} failed: {exc}")
        log.warning("Companion %s %s that bai: %s", companion, service, exc)
    if schedule:
        crud.add_history(schedule["id"], name, None, status, message)


def _fmt(seconds: float) -> str:
    return f"{seconds:g}"


async def sync(states: list[dict] | None = None) -> None:
    """Doc lai quy tac (lich vua doi) hoac vua (re)connect HA (kem snapshot).
    Ket noi lai thi doi chieu MOI nhom 1 lan; lich doi thi chi doi chieu nhom
    vua doi, khong dong vao bom dang chay tay cua nhom khac."""
    global _rules
    old = _rules
    _rules = build_rules()
    for companion in [c for c in list(_timers) if c not in _rules]:
        _cancel_timer(companion)
    watched = {e for r in _rules.values() for e in (r.members | {r.companion})}
    for eid in [e for e in _states if e not in watched]:
        _states.pop(eid, None)
    if states is not None:
        snapshot = {s["entity_id"]: s.get("state") for s in states}
        for eid in watched:
            _states[eid] = snapshot.get(eid)
        changed = list(_rules)
    else:
        missing = [e for e in watched if e not in _states]
        if missing:
            try:  # thiet bi moi duoc theo doi: doc trang thai hien tai 1 lan
                snapshot = {s["entity_id"]: s.get("state") for s in await homeassistant.get_states()}
                for eid in missing:
                    _states[eid] = snapshot.get(eid)
            except Exception as exc:  # noqa: BLE001
                log.debug("Chua doc duoc trang thai HA: %s", exc)
        changed = [c for c, r in _rules.items() if _signature(r) != _signature(old.get(c))]
    for companion, rule in _rules.items():
        if companion in _timers and _signature(rule) != _signature(old.get(companion)):
            _cancel_timer(companion)  # do tre moi: hen lai
    for companion in changed:
        evaluate(companion)


async def on_change(eid: str, old: dict | None, new: dict | None) -> None:
    """1 su kien state_changed tu HA. Bo qua nhanh entity khong lien quan."""
    if eid not in _states:
        return
    was = is_active(_states.get(eid))
    _states[eid] = new.get("state") if new else None
    if was == is_active(_states[eid]):
        return  # chi doi thuoc tinh
    for companion, rule in _rules.items():
        if eid in rule.members:
            evaluate(companion)


async def on_schedule_event(event: str) -> None:
    if event in ("schedule_updated", "schedule_deleted"):
        await sync()


def reset() -> None:
    """Dung moi hen (tat app / test)."""
    for companion in list(_timers):
        _cancel_timer(companion)
    _states.clear()
    _rules.clear()
    _switching.clear()
    _locks.clear()
