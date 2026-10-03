"""Bounded away-mode lighting. Window end explicitly turns off the whole list."""
import asyncio
import logging
import random
from copy import deepcopy
from datetime import date, datetime, time as time_cls, timedelta
from zoneinfo import ZoneInfo

from app import crud, homeassistant, scheduler_engine
from app.config import DEFAULT_TIMEZONE
from app.i18n import tr
from app.ws import manager

log = logging.getLogger("ha_smart_scheduler.presence")
TICK_SECONDS = 5
DEFAULT_CONFIG = {
    "enabled": False, "entity_ids": [], "days": list(range(7)),
    "start": "18:00", "end": "23:00", "start_mode": "time", "until": "",
    "on_min": 5, "on_max": 15, "gap_min": 12, "gap_max": 30,
    "max_concurrent": 1, "cooldown_minutes": 45, "max_total_minutes": 90,
    "brightness_pct": 35,
}
_on: dict[str, datetime] = {}
_owned: dict[str, dict] = {}
_cooldown: dict[str, datetime] = {}
_retry: dict[str, datetime] = {}
_failures: dict[str, int] = {}
_visits: dict[str, int] = {}
_shutdown: set[str] = set()
_next_start_at: datetime | None = None
_last_entity: str | None = None
_window_id = ""
_closed_window_id = ""
_window_entities: set[str] = set()
_used_minutes = 0.0
_phase = "disabled"
_warnings: dict[str, str] = {}
_last_status: dict | None = None
_last_runtime: dict | None = None
_planned: dict | None = None
_lock = asyncio.Lock()


def _tz() -> ZoneInfo:
    return ZoneInfo(crud.get_settings().get("timezone") or DEFAULT_TIMEZONE)


def normalize(data: dict) -> dict:
    cfg = {**DEFAULT_CONFIG, **{k: v for k, v in data.items() if k in DEFAULT_CONFIG and v is not None}}
    for key in ("start", "end"):
        time_cls.fromisoformat(cfg[key])
    if cfg["until"]:
        date.fromisoformat(cfg["until"])
    if cfg["start_mode"] not in ("time", "sunset"):
        raise ValueError("Invalid start mode")
    cfg["days"] = sorted(set(cfg["days"]))
    if any(d not in range(7) for d in cfg["days"]):
        raise ValueError("Invalid weekday")
    cfg["entity_ids"] = list(dict.fromkeys(cfg["entity_ids"]))
    for lo, hi, floor in (("on_min", "on_max", 1), ("gap_min", "gap_max", 0)):
        a, b = int(cfg[lo]), int(cfg[hi])
        if not floor <= a <= b <= 180:
            raise ValueError(tr("Khoảng thời gian không hợp lệ", "Invalid duration range"))
    for key, lo, hi in (("max_concurrent", 1, 2), ("cooldown_minutes", 0, 240), ("max_total_minutes", 1, 720), ("brightness_pct", 1, 100)):
        cfg[key] = int(cfg[key])
        if not lo <= cfg[key] <= hi:
            raise ValueError(f"{key}: {lo}..{hi}")
    return cfg


def get_config() -> dict:
    cfg = {**DEFAULT_CONFIG, **(crud.get_settings().get("presence") or {})}
    cfg["max_concurrent"] = min(2, max(1, cfg["max_concurrent"]))
    return cfg


def save_config(data: dict) -> dict:
    global _planned
    cfg = normalize({**get_config(), **{k: v for k, v in data.items() if v is not None}})
    crud.update_settings({"presence": cfg})
    _planned = None
    return cfg


def _window(cfg: dict, day: date, tz: ZoneInfo) -> tuple[datetime, datetime] | None:
    if day.weekday() not in cfg["days"] or (cfg["until"] and day > date.fromisoformat(cfg["until"])):
        return None
    start = scheduler_engine._sun_time_for_date("sunset", day, tz) if cfg["start_mode"] == "sunset" else datetime.combine(day, time_cls.fromisoformat(cfg["start"]), tz)
    if start is None:
        return None
    end = datetime.combine(day, time_cls.fromisoformat(cfg["end"]), tz)
    if end <= start:
        end += timedelta(days=1)
    if cfg["until"]:
        end = min(end, datetime.combine(date.fromisoformat(cfg["until"]) + timedelta(days=1), time_cls(), tz))
    return (start, end) if start < end else None


def window_end(cfg: dict, now: datetime) -> datetime | None:
    cfg = {**DEFAULT_CONFIG, **cfg}
    for offset in (0, -1):
        window = _window(cfg, (now + timedelta(days=offset)).date(), now.tzinfo)
        if window and window[0] <= now < window[1]:
            return window[1]
    return None


def _signature(state: dict) -> list:
    return [state.get("last_changed"), (state.get("context") or {}).get("id"), (state.get("attributes") or {}).get("brightness")]


def _spent(now: datetime) -> float:
    return _used_minutes + sum(max(0, (min(now, off) - datetime.fromisoformat(_owned[e]["started_at"])).total_seconds() / 60) for e, off in _on.items() if e in _owned)


def status() -> dict:
    cfg = get_config()
    next_start = _planned["on_at"] if _planned else None
    return {
        "on": [{"entity_id": e, "off_at": off.isoformat()} for e, off in _on.items()],
        "next_start_at": next_start,
        "active": bool(_on) or _next_start_at is not None or bool(_shutdown),
        "phase": _phase, "enabled": cfg["enabled"],
        "used_minutes": round(_spent(datetime.now(_tz())), 1),
        "max_total_minutes": cfg["max_total_minutes"],
        "pending_off": sorted(_shutdown),
        "planned": [dict(_planned)] if _planned else [],
        "warnings": [{"entity_id": e, "message": m} for e, m in _warnings.items()],
    }


def _persist() -> None:
    global _last_runtime
    runtime = {
        "version": 2, "on": {e: {**_owned[e], "off_at": off.isoformat()} for e, off in _on.items() if e in _owned},
        "cooldown": {e: t.isoformat() for e, t in _cooldown.items()},
        "next_start_at": _next_start_at.isoformat() if _next_start_at else None,
        "window_id": _window_id, "closed_window_id": _closed_window_id,
        "window_entities": sorted(_window_entities), "shutdown": sorted(_shutdown),
        "used_minutes": _used_minutes, "visits": dict(_visits), "last_entity": _last_entity,
        "planned": _planned,
    }
    if runtime != _last_runtime:
        crud.update_settings({"presence_runtime": runtime})
        _last_runtime = deepcopy(runtime)


def _gap(cfg: dict) -> timedelta:
    return timedelta(minutes=random.uniform(cfg["gap_min"], cfg["gap_max"]))


def _conflicts(now: datetime) -> set[str]:
    paused = scheduler_engine.paused_until()
    blocked = set()
    for s in crud.list_schedules():
        if s.get("enabled", True) and s.get("card_enabled", True):
            if s.get("trigger_type") == "auto_off" or not (paused and paused > now):
                blocked.update(s.get("target_entities") or [])
    for timer in crud.list_manual_timers():
        blocked.update(timer["entity_ids"])
    return blocked


def _choose(choices: list[str], visits: dict, last: str | None) -> str:
    alternatives = [e for e in choices if e != last]
    if alternatives:
        choices = alternatives
    aliases = crud.list_aliases()
    area = (aliases.get(last) or {}).get("area") if last else None
    other_rooms = [e for e in choices if area and (aliases.get(e) or {}).get("area") not in (None, area)]
    if other_rooms:
        choices = other_rooms
    return random.choices(choices, weights=[1 / (1 + visits.get(e, 0)) for e in choices], k=1)[0]


def _release(eid: str, now: datetime, cfg: dict) -> None:
    global _used_minutes
    meta = _owned.pop(eid, None)
    off = _on.pop(eid, now)
    if meta:
        _used_minutes += max(0, (min(now, off) - datetime.fromisoformat(meta["started_at"])).total_seconds() / 60)
    _cooldown[eid] = now + timedelta(minutes=cfg["cooldown_minutes"])


async def _command(service: str, eid: str, now: datetime, cfg: dict, state: dict | None = None) -> list[dict] | None:
    if eid in _failures and not await homeassistant.ensure_stable():
        return None  # lan truoc loi: chi thu lai khi ket noi HA on dinh (v0.5.79)
    try:
        data, domain = {}, "homeassistant"
        if service == "turn_on" and eid.startswith("light.") and state and set((state.get("attributes") or {}).get("supported_color_modes") or []) - {"onoff"}:
            domain, data = "light", {"brightness_pct": cfg["brightness_pct"]}
        result = await homeassistant.call_service(domain, service, [eid], data)
        _failures.pop(eid, None)
        _warnings.pop(eid, None)
        _retry[eid] = now + timedelta(seconds=30)
        crud.add_history(None, tr("Giả lập có người", "Presence simulation"), None, "success", f"{service}: {eid}", manual=True)
        return result or []
    except Exception as exc:
        count = _failures.get(eid, 0) + 1
        _failures[eid] = count
        _retry[eid] = now + timedelta(seconds=min(900, 30 * 2 ** min(count - 1, 5)))
        _warnings[eid] = tr("Không điều khiển được đèn; đang chờ thử lại", "Light command failed; waiting to retry")
        log.warning("Presence %s %s failed: %s", service, eid, exc)
        return None


async def tick(now: datetime | None = None) -> None:
    async with _lock:
        await _tick(now or datetime.now(_tz()))


async def stop() -> None:
    async with _lock:
        cfg = get_config()
        crud.update_settings({"presence": {**cfg, "enabled": False}})
        _shutdown.update(cfg["entity_ids"])
        _retry.clear()
        _persist()  # preserve the cleanup queue even if HA is down
        await _tick(datetime.now(_tz()))


async def _tick(now: datetime) -> None:
    global _next_start_at, _last_entity, _window_id, _closed_window_id, _used_minutes, _phase, _planned
    cfg = get_config()
    if cfg["enabled"] and cfg["start_mode"] == "sunset":
        if await scheduler_engine._ensure_observer() is None:
            _warnings["sun"] = tr("Chưa đọc được giờ hoàng hôn", "Sunset time is unavailable")
        else:
            _warnings.pop("sun", None)
    end = window_end(cfg, now) if cfg["enabled"] and cfg["entity_ids"] else None
    expired = bool(cfg["until"] and now.date() > date.fromisoformat(cfg["until"]))
    _phase = "disabled" if not cfg["enabled"] else "expired" if expired else "waiting_window"
    if cfg["enabled"] and not end:
        # Catch missed boundaries after downtime, even if no light was activated.
        for offset in (0, -1):
            past = _window(cfg, (now + timedelta(days=offset)).date(), now.tzinfo)
            if past and past[1] <= now and (not _window_id or past[1] > datetime.fromisoformat(_window_id)):
                _window_id = past[1].isoformat()
        if expired:
            deadline = datetime.combine(date.fromisoformat(cfg["until"]) + timedelta(days=1), time_cls(), now.tzinfo)
            if not _window_id or deadline > datetime.fromisoformat(_window_id):
                _window_id = deadline.isoformat()
    # End-of-window cleanup is a one-time operation with a persisted retry queue.
    # It deliberately includes manually lit devices, as requested for away mode.
    if _window_id and _closed_window_id != _window_id and (not end or datetime.fromisoformat(_window_id) <= now):
        _shutdown.update(_window_entities | set(cfg["entity_ids"]) | set(_on))
        _closed_window_id = _window_id
        _retry.clear()
    if end and not _on and not _shutdown and _window_id != end.isoformat():
        _window_id, _used_minutes = end.isoformat(), 0.0
        _window_entities.clear()
        _visits.clear()
    if end:
        _window_entities.update(cfg["entity_ids"])
    else:
        _next_start_at = None
        _planned = None
    if _on or end or _shutdown:
        try:
            states = {s["entity_id"]: s for s in await homeassistant.get_states()}
        except Exception:
            _phase = "error"
            _warnings[""] = tr("Không đọc được trạng thái Home Assistant", "Cannot read Home Assistant states")
            if not _shutdown:
                await _publish()
                return
            states = {}  # final OFF commands must not depend on a working state read
        else:
            _warnings.pop("", None)
        for eid in list(_shutdown):
            state = states.get(eid)
            if state and state.get("state") == "off" and eid in _retry:
                _shutdown.discard(eid)
                _warnings.pop(eid, None)
                _release(eid, now, cfg)
            elif now >= _retry.get(eid, now):
                result = await _command("turn_off", eid, now, cfg)
                confirmed = result is not None and any(s.get("entity_id") == eid and s.get("state") == "off" for s in result)
                if confirmed:
                    _shutdown.discard(eid)
                    _release(eid, now, cfg)
        blocked = _conflicts(now)
        for eid, off in list(_on.items()):
            if eid in _shutdown:
                continue
            state, meta = states.get(eid), _owned.get(eid)
            if not state or state.get("state") in ("unavailable", "unknown"):
                _warnings[eid] = tr("Đèn không khả dụng", "Light is unavailable")
                if now >= off:
                    _shutdown.add(eid)
                continue
            if not meta:
                _release(eid, now, cfg)
                continue
            if meta.get("signature") is None:
                if state.get("state") == "on":
                    meta["signature"] = _signature(state)
                elif (now - datetime.fromisoformat(meta["started_at"])).total_seconds() < 15:
                    continue
                else:
                    _release(eid, now, cfg)
                    _warnings[eid] = tr("Đèn không xác nhận đã bật", "Light did not confirm activation")
                    continue
            if state.get("state") != "on" or _signature(state) != meta["signature"] or eid in blocked:
                _release(eid, now, cfg)
                _next_start_at = now + _gap(cfg) if end else None
                _planned = None
                continue
            if not end or now >= off or eid not in cfg["entity_ids"] or _spent(now) >= cfg["max_total_minutes"]:
                if now >= _retry.get(eid, now):
                    result = await _command("turn_off", eid, now, cfg)
                    if result is not None:
                        if any(s.get("entity_id") == eid and s.get("state") == "off" for s in result):
                            _release(eid, now, cfg)
                        else:
                            _shutdown.add(eid)
                        _next_start_at = now + _gap(cfg) if end else None
                        _planned = None
        if end and not _shutdown:
            reserved = sum(max(0, (off - datetime.fromisoformat(_owned[e]["started_at"])).total_seconds() / 60) for e, off in _on.items() if e in _owned)
            remaining = cfg["max_total_minutes"] - _used_minutes - reserved
            _phase = "running" if _on else "waiting_next"
            if remaining < 1:
                _phase = "running" if _on else "budget_exhausted"
                _next_start_at = None
                _planned = None
            else:
                if _next_start_at is None:
                    _next_start_at = now + _gap(cfg)
                if len(_on) < min(2, cfg["max_concurrent"]):
                    planned_at = max(now, _next_start_at)
                    choices = []
                    for eid in cfg["entity_ids"]:
                        state = states.get(eid)
                        if eid in blocked:
                            _warnings[eid] = tr("Bỏ qua: có lịch khác đang bật", "Skipped: another schedule is enabled")
                        elif not state or state.get("state") in ("unavailable", "unknown"):
                            _warnings[eid] = tr("Đèn không khả dụng", "Light is unavailable")
                        elif state.get("state") == "off" and eid not in _on and planned_at >= max(_cooldown.get(eid, now), _retry.get(eid, now)):
                            _warnings.pop(eid, None)
                            choices.append(eid)
                    if _planned and _planned["entity_id"] not in choices:
                        _planned = None
                    if choices and _planned is None:
                        eid = _choose(choices, _visits, _last_entity)
                        minutes = min(random.uniform(cfg["on_min"], cfg["on_max"]), remaining, (end - planned_at).total_seconds() / 60)
                        if minutes >= 1:
                            _planned = {"entity_id": eid, "on_at": planned_at.isoformat(), "off_at": (planned_at + timedelta(minutes=minutes)).isoformat()}
                    if now >= _next_start_at:
                        if _planned and datetime.fromisoformat(_planned["off_at"]) > now:
                            eid = _planned["entity_id"]
                            changed = await _command("turn_on", eid, now, cfg, states[eid])
                            if changed is not None:
                                confirmed = next((s for s in changed if s.get("entity_id") == eid and s.get("state") == "on"), None)
                                _on[eid] = datetime.fromisoformat(_planned["off_at"])
                                _owned[eid] = {"started_at": now.isoformat(), "signature": _signature(confirmed) if confirmed else None}
                                _last_entity = eid
                                _visits[eid] = _visits.get(eid, 0) + 1
                                _phase = "running"
                        _planned = None
                        _next_start_at = now + (_gap(cfg) if choices else timedelta(seconds=30))
    if _shutdown:
        _phase = "stopping"
        _planned = None
    elif _warnings and not _on and _phase not in ("disabled", "expired", "budget_exhausted"):
        _phase = "error"
    await _publish()


async def _publish() -> None:
    global _last_status
    _persist()
    current = status()
    if current != _last_status:
        _last_status = current
        await manager.broadcast("presence_updated", current)


async def restore() -> None:
    global _next_start_at, _window_id, _closed_window_id, _used_minutes, _last_entity, _last_runtime, _planned
    runtime = crud.get_settings().get("presence_runtime") or {}
    _on.clear()
    _owned.clear()
    _cooldown.clear()
    _window_entities.clear()
    _shutdown.clear()
    _visits.clear()
    _retry.clear()
    _failures.clear()
    _warnings.clear()
    _last_runtime = None
    _planned = None
    _next_start_at, _window_id, _closed_window_id, _used_minutes, _last_entity = None, "", "", 0.0, None
    if runtime.get("version") != 2:
        # Legacy runtime lacks ownership tokens; keep its list for final cleanup.
        _window_entities.update(runtime)
        if runtime:
            _window_id = min(runtime.values())
        return
    for eid, entry in runtime.get("on", {}).items():
        try:
            _on[eid] = datetime.fromisoformat(entry["off_at"])
            datetime.fromisoformat(entry["started_at"])
            _owned[eid] = entry
        except (TypeError, ValueError, KeyError):
            _on.pop(eid, None)
    _cooldown.update({e: datetime.fromisoformat(t) for e, t in runtime.get("cooldown", {}).items()})
    _next_start_at = datetime.fromisoformat(runtime["next_start_at"]) if runtime.get("next_start_at") else None
    _window_id, _closed_window_id = runtime.get("window_id", ""), runtime.get("closed_window_id", "")
    _window_entities.update(runtime.get("window_entities", []))
    _shutdown.update(runtime.get("shutdown", []))
    _used_minutes = runtime.get("used_minutes", 0.0)
    _visits.update(runtime.get("visits", {}))
    _last_entity = runtime.get("last_entity")
    _planned = runtime.get("planned")


async def preview(data: dict, now: datetime | None = None) -> dict:
    cfg = normalize({**get_config(), **data})
    now = now or datetime.now(_tz())
    if cfg["start_mode"] == "sunset":
        await scheduler_engine._ensure_observer()
    window = None
    for offset in range(-1, 8):
        candidate = _window(cfg, (now + timedelta(days=offset)).date(), now.tzinfo)
        if candidate and candidate[1] > now:
            window = candidate
            break
    if not window:
        return {"events": [], "total_minutes": 0, "window_start": None, "window_end": None}
    start, end = window
    t = max(now, start) + _gap(cfg)
    events, active, cooldown, visits = [], {}, {}, {}
    last, total = None, 0.0
    blocked = _conflicts(now)
    eligible = [e for e in cfg["entity_ids"] if e not in blocked]
    for _ in range(500):
        if t >= end or total >= cfg["max_total_minutes"]:
            break
        finished = [e for e, off in active.items() if off <= t]
        for e in finished:
            cooldown[e] = active.pop(e) + timedelta(minutes=cfg["cooldown_minutes"])
        if finished:
            t += _gap(cfg)
        choices = [e for e in eligible if e not in active and cooldown.get(e, t) <= t]
        if not choices or len(active) >= min(2, cfg["max_concurrent"]):
            wakes = [v for v in [*active.values(), *cooldown.values()] if v > t]
            if not wakes:
                break
            t = min(wakes)
            continue
        eid = _choose(choices, visits, last)
        minutes = min(random.uniform(cfg["on_min"], cfg["on_max"]), cfg["max_total_minutes"] - total, (end - t).total_seconds() / 60)
        if minutes < 1:
            break
        off = t + timedelta(minutes=minutes)
        events.append({"entity_id": eid, "on_at": t.isoformat(), "off_at": off.isoformat()})
        active[eid], last = off, eid
        visits[eid] = visits.get(eid, 0) + 1
        total += minutes
        t += _gap(cfg)
    return {"events": events, "total_minutes": round(total, 1), "window_start": start.isoformat(), "window_end": end.isoformat()}


async def presence_loop() -> None:
    await restore()
    while True:
        try:
            await tick()
        except Exception:
            log.exception("Presence loop failed")
        await asyncio.sleep(TICK_SECONDS)
