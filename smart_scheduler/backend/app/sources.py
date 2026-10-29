"""Ai da bat/tat thiet bi (v0.5.97): moi lan thiet bi duoc theo doi doi trang
thai, app ghi lai NGUON gay ra de lich su bat/tat tren Device Detail to mau va
Nhat ky co dau vet day du.

Nguon cua app (app tu gui lenh): schedule (lich), forced (Bat cuong che),
auto_off (Tu tat sau khi bat), presence (Gia lap co nguoi), app (thao tac khac
cua app: xoa card, tam dung, tat khi khoi dong).
Nguon ngoai app (HA tu bao): user (nguoi dung HA, vd dashboard), automation
(automation/script/add-on goi), device (cong tac tay, thiet bi tu doi).

Co che: call_service() ghi nho lenh vua gui (kem nguon dang dat bang
`acting_as`), khi HA bao `state_changed` cho cung entity trong vai chuc giay thi
ghep lai. Khong ghep duoc thi doan theo `context` cua HA (user_id / parent_id).
"""
import contextlib
import contextvars
import logging
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

from app.i18n import tr

log = logging.getLogger("ha_smart_scheduler.sources")

APP_SOURCES = ("schedule", "forced", "auto_off", "presence", "app")
EXTERNAL_SOURCES = ("user", "automation", "device")
NO_STATE = ("unavailable", "unknown", None)
MATCH_WINDOW_SECONDS = 30
POINT_TOLERANCE_SECONDS = 3
TRACK_TTL_SECONDS = 30
KEEP_DAYS = 35
PRUNE_EVERY = 500

_current: contextvars.ContextVar[tuple[str, str | None]] = contextvars.ContextVar("command_source", default=("app", None))
_recent: list[dict] = []  # lenh app vua gui, cho su kien state_changed ghep vao
_ctx_source: OrderedDict[str, tuple[str, str | None]] = OrderedDict()  # context id HA -> nguon da biet
_extra_tracked: set[str] = set()
_tracked_cache: tuple[float, frozenset[str]] = (0.0, frozenset())
_inserted = 0


@contextlib.contextmanager
def acting_as(source: str, label: str | None = None):
    """Moi call_service() trong khoi nay duoc ghi la lenh cua `source`."""
    token = _current.set((source, label))
    try:
        yield
    finally:
        _current.reset(token)


def current() -> tuple[str, str | None]:
    return _current.get()


def note_command(entity_ids: list[str], service: str) -> None:
    source, label = _current.get()
    direction = "off" if service == "turn_off" else "on" if service == "turn_on" else None
    now = time.monotonic()
    _recent[:] = [r for r in _recent if now - r["ts"] <= MATCH_WINDOW_SECONDS]
    for eid in entity_ids:
        _recent.append({"eid": eid, "ts": now, "direction": direction, "source": source, "label": label})
    track(entity_ids)


def track(entity_ids) -> None:
    """Theo doi them entity (thiet bi app vua dieu khien, hoac dang xem lich su)."""
    global _tracked_cache
    new = set(entity_ids) - _extra_tracked
    if new:
        _extra_tracked.update(new)
        _tracked_cache = (0.0, _tracked_cache[1])  # tinh lai lan toi


def tracked() -> frozenset[str]:
    """Thiet bi can ghi nguon: dich cua moi lich, thiet bi Gia lap co nguoi, hen
    Bat cuong che, cong them thiet bi app tung dieu khien. Cache ngan vi ham nay
    chay cho MOI su kien state_changed cua ca nha."""
    global _tracked_cache
    now = time.monotonic()
    if now - _tracked_cache[0] > TRACK_TTL_SECONDS:
        from app import crud
        ids = set(_extra_tracked)
        for schedule in crud.list_schedules():
            ids.update(schedule.get("target_entities") or [])
        ids.update((crud.get_settings().get("presence") or {}).get("entity_ids") or [])
        for timer in crud.list_manual_timers():
            ids.update(timer.get("entity_ids") or [])
        _tracked_cache = (now, frozenset(ids))
    return _tracked_cache[1]


def _kind(state: str | None) -> str:
    return "off" if state in ("off", "closed") else "on"


def _match(eid: str, state: str | None) -> dict | None:
    now = time.monotonic()
    kind = _kind(state)
    for i in range(len(_recent) - 1, -1, -1):
        r = _recent[i]
        if r["eid"] != eid or now - r["ts"] > MATCH_WINDOW_SECONDS:
            continue
        if r["direction"] not in (None, kind):
            continue
        del _recent[i]  # 1 lenh chi giai thich 1 lan doi trang thai
        return r
    return None


def _remember(ctx_id: str | None, result: tuple[str, str | None]) -> None:
    if not ctx_id:
        return
    _ctx_source[ctx_id] = result
    while len(_ctx_source) > 300:
        _ctx_source.popitem(last=False)


def classify(eid: str, state: str | None, context: dict | None, user_name: str | None = None) -> tuple[str, str | None]:
    context = context or {}
    ctx_id = context.get("id")
    if ctx_id in _ctx_source:
        return _ctx_source[ctx_id]  # cung 1 nguyen nhan (vd cover "opening" roi "open")
    if state not in NO_STATE:
        hit = _match(eid, state)
        if hit:
            result = (hit["source"], hit["label"])
            _remember(ctx_id, result)
            return result
    if context.get("user_id"):
        result = ("user", user_name or str(context["user_id"])[:8])
    elif context.get("parent_id"):
        result = ("automation", None)
    else:
        result = ("device", None)
    _remember(ctx_id, result)
    return result


async def _user_name(user_id: str | None) -> str | None:
    if not user_id:
        return None
    from app import homeassistant
    try:
        return (await homeassistant.get_users()).get(user_id)
    except Exception:  # noqa: BLE001 - ten nguoi dung chi de hien thi
        return None


def _actor_text(source: str, label: str | None) -> str:
    if source == "user":
        return tr(f"người dùng HA ({label})" if label else "người dùng HA", f"HA user ({label})" if label else "HA user")
    if source == "automation":
        return tr("automation / script / add-on HA", "HA automation / script / add-on")
    return tr("thiết bị / công tắc tay", "the device itself / physical switch")


async def record(eid: str, old: dict | None, new: dict | None) -> None:
    """1 su kien state_changed: ghi nguon neu la thiet bi dang theo doi. Lenh
    ngoai app (nguoi dung / automation / cong tac tay) ghi them vao Nhat ky de
    biet "ai tat" (lenh cua app da co dong Nhat ky rieng)."""
    global _inserted
    if not new or eid.split(".", 1)[0] in ("scene", "script"):
        return
    state = new.get("state")
    prev = old.get("state") if old else None
    if state == prev or eid not in tracked():
        return
    from app import crud
    context = new.get("context") or {}
    source, label = classify(eid, state, context, await _user_name(context.get("user_id")))
    ts = new.get("last_changed") or datetime.now(timezone.utc).isoformat()
    crud.add_state_event(eid, ts, state, prev, source, label)
    log.info("State %s: %s -> %s source=%s label=%s", eid, prev, state, source, label)
    _inserted += 1
    if _inserted % PRUNE_EVERY == 0:
        crud.prune_state_events(KEEP_DAYS)
    if source in EXTERNAL_SOURCES and prev is not None and state not in NO_STATE and prev not in NO_STATE:
        name = (new.get("attributes") or {}).get("friendly_name") or eid
        crud.add_history(None, name, None, "success",
                         tr(f"Trạng thái {prev} → {state} do {_actor_text(source, label)}",
                            f"State {prev} → {state} by {_actor_text(source, label)}"), manual=True)


def _parse(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def annotate(series: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """Gan `src`/`by` vao tung diem {s, t} cua lich su recorder bang cach ghep
    voi bang state_events (cung trang thai, lech toi da vai giay). Diem dau cua
    doan (trang thai tai luc bat dau doan, thoi diem doi that nam truoc do) lay
    su kien gan nhat cung trang thai. Khong ghep duoc thi de trong (UI: khong ro)."""
    from app import crud
    times = [t for pts in series.values() for p in pts if (t := _parse(p.get("t")))]
    if not times:
        return series
    since = (min(times) - timedelta(days=3)).isoformat()
    events: dict[str, list[tuple[datetime, dict]]] = {}
    for ev in crud.list_state_events(list(series), since):
        when = _parse(ev["ts"])
        if when:
            events.setdefault(ev["entity_id"], []).append((when, ev))
    for eid, pts in series.items():
        evs = events.get(eid, [])
        for index, point in enumerate(pts):
            when = _parse(point.get("t"))
            if when is None or not evs:
                continue
            best = None
            for ev_time, ev in evs:
                if ev["state"] != point.get("s"):
                    continue
                gap = abs((ev_time - when).total_seconds())
                if gap <= POINT_TOLERANCE_SECONDS and (best is None or gap < best[0]):
                    best = (gap, ev)
            if best is None and index == 0:
                earlier = [ev for ev_time, ev in evs if ev["state"] == point.get("s") and ev_time <= when]
                if earlier:
                    best = (0, earlier[-1])
            if best:
                point["src"] = best[1]["source"]
                if best[1]["label"]:
                    point["by"] = best[1]["label"]
    return series
