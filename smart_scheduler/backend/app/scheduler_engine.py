"""Scheduler engine chay o backend, doc lap trinh duyet (muc 7 SPEC.md).

Vong lap asyncio tick moi TICK_SECONDS, tu tinh lich den han cho tung
schedule dua tren days/time/timezone, goi HA service, ghi history, broadcast
qua WebSocket. Idempotent bang cot `last_scheduled_for` (muc 56) - 1 khe gio
(ngay + gio:phut) chi duoc xu ly dung 1 lan du tick nhieu vong.

Phuc hoi sau restart (muc 27): khong can code rieng - lan tick dau tien sau
khi khoi dong tu nhien phat hien cac khe da qua han (`last_scheduled_for`
chua khop) va xu ly theo `missed_execution_policy`:
  - qua han trong vong GRACE_SECONDS  -> van chay binh thuong (tick binh
    thuong, khong tinh la "missed").
  - qua han lau hon (vd App tat vai gio) -> ap dung policy:
      skip      -> khong chay, chi danh dau da xu ly khe do (mac dinh).
      run_once  -> chay bu dung 1 lan roi thoi.
"""
import asyncio
import hashlib
import json
import logging
import time
from datetime import date as date_cls, datetime, timedelta
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import sun as astral_sun

from app import crud, homeassistant
from app.config import DEFAULT_TIMEZONE
from app.db import now_iso
from app.ws import manager
from app.i18n import tr

log = logging.getLogger("ha_smart_scheduler.engine")

TICK_SECONDS = 0.25
GRACE_SECONDS = 120
_tz_cache: dict[str, ZoneInfo] = {}

# Vi tri HA (Settings -> System -> General) dung de tinh gio binh minh/hoang
# hon THUC TE (thu vien astral) cho trigger_type "sunrise"/"sunset" - muc
# "Kieu hen gio" 2026-09-22 (giong Google Home/Tuya/SmartThings). Nap 1 lan
# khi engine khoi dong, cache vo thoi han (vi tri nha hau nhu khong doi);
# thu lai moi OBSERVER_RETRY_SECONDS neu lan dau chua lay duoc (vd HA API
# chua san sang luc container moi start).
_observer: Observer | None = None
_observer_last_attempt: float = 0.0
OBSERVER_RETRY_SECONDS = 60


async def _ensure_observer() -> Observer | None:
    global _observer, _observer_last_attempt
    if _observer is not None:
        return _observer
    now_mono = time.monotonic()
    if now_mono - _observer_last_attempt < OBSERVER_RETRY_SECONDS:
        return None
    _observer_last_attempt = now_mono
    try:
        cfg = await homeassistant.get_core_config()
        _observer = Observer(latitude=cfg["latitude"], longitude=cfg["longitude"], elevation=cfg.get("elevation", 0))
        log.info("Da lay vi tri HA cho sunrise/sunset: lat=%s lon=%s", cfg["latitude"], cfg["longitude"])
    except Exception as exc:  # noqa: BLE001 - khong duoc lam chet scheduler_loop, thu lai sau
        log.warning("Chua lay duoc vi tri HA (sunrise/sunset se tam khong tinh duoc): %s", exc)
    return _observer


def _sun_time_for_date(kind: str, day: date_cls, tz: ZoneInfo) -> datetime | None:
    """Gio mat troi moc (sunrise/sunset) THUC te cho 1 ngay cu the, tinh
    bang astral (khong phu thuoc HA phai online lien tuc) - can _observer da
    duoc nap qua _ensure_observer()."""
    if _observer is None:
        return None
    try:
        info = astral_sun(_observer, date=day, tzinfo=tz)
    except Exception:  # noqa: BLE001 - vd vi do cuc, mat troi khong moc/lan ngay do
        return None
    return info.get(kind)


async def get_today_sun_times(tz_name: str) -> dict[str, str | None]:
    """API cong khai cho `api/sun.py` - gio binh minh/hoang hon HOM NAY, de
    ScheduleEditor xem truoc "~05:43" khi chon trigger_type sunrise/sunset
    thay vi chi thay do lech +/- phut mo ho (muc 2026-09-23)."""
    tz = _tz(tz_name)
    await _ensure_observer()
    today = datetime.now(tz).date()
    sunrise = _sun_time_for_date("sunrise", today, tz)
    sunset = _sun_time_for_date("sunset", today, tz)
    return {"sunrise": sunrise.isoformat() if sunrise else None, "sunset": sunset.isoformat() if sunset else None}


def _tz(name: str) -> ZoneInfo:
    tz = _tz_cache.get(name)
    if tz is None:
        try:
            tz = ZoneInfo(name)
        except Exception:
            tz = ZoneInfo(DEFAULT_TIMEZONE)
        _tz_cache[name] = tz
    return tz


def _parse_time(value: str) -> tuple[int, int, int]:
    parts = value.split(":")
    if len(parts) == 2:
        parts.append("0")
    if len(parts) != 3:
        raise ValueError(f"Invalid schedule time: {value}")
    h, m, s = (int(part) for part in parts)
    return h, m, s


def _scheduled_dt_for_date(schedule: dict, date, tz: ZoneInfo) -> datetime | None:
    trigger_type = schedule.get("trigger_type") or "time"
    if trigger_type in ("sunrise", "sunset"):
        base = _sun_time_for_date(trigger_type, date, tz)
        if base is None:
            return None  # chua co vi tri HA hoac ngay cuc dem/ngay - bo qua, engine se thu lai tick sau
        return (base + timedelta(minutes=schedule.get("offset_minutes") or 0)).replace(microsecond=0)
    h, m, s = _parse_time(schedule["time"])
    return datetime(date.year, date.month, date.day, h, m, s, tzinfo=tz)


def _in_date_range(schedule: dict, day: date_cls) -> bool:
    """Khoang ngay ap dung tuy chon (start_date/end_date, "YYYY-MM-DD") -
    rong = luon dung (muc "Toggle + khoang ngay" phan hoi 2026-09-22)."""
    start = schedule.get("start_date")
    end = schedule.get("end_date")
    if start and day < date_cls.fromisoformat(start):
        return False
    if end and day > date_cls.fromisoformat(end):
        return False
    return True


_UNSET = object()

# ---- Khung gio: ket thuc trong ngay hay hom sau (v0.5.79) ----
_SUN = ("sunrise", "sunset")
# Chay 1 lan (scene kich hoat, script chay): khong co lenh Tat/Dao that su,
# khong kiem tra trang thai, khong tu tat, khong tat bu.
ONE_SHOT_DOMAINS = ("scene", "script")


def _is_one_shot(entity_id: str) -> bool:
    return entity_id.split(".", 1)[0] in ONE_SHOT_DOMAINS


def one_shot_only(entity_ids: list[str]) -> bool:
    return bool(entity_ids) and all(_is_one_shot(e) for e in entity_ids)


def _clock_seconds(value: str) -> int:
    h, m, s = _parse_time(value)
    return h * 3600 + m * 60 + s


def range_day_offset(on: dict, off: dict) -> int:
    """Moc Tat cua khung gio roi vao cung ngay (0) hay ngay hom sau (1) cua moc
    Bat. Chon tay (range_day_offset 0/1, luu tren dong Bat) thi theo do; NULL =
    theo kieu gio:
    - 2 gio co dinh: Tat <= Bat la qua dem (nhu truoc);
    - hoang hon -> binh minh: hom sau; binh minh -> hoang hon: trong ngay;
      cung loai mat troi: so do lech phut;
    - tron gio co dinh + mat troi: trong ngay (du lieu cu da duoc chuyen sang
      gia tri chon tay theo hanh vi cu, xem normalize_range_days).
    Co dinh theo cau hinh, KHONG phu thuoc gio mat troi tung ngay - mua dong
    hoang hon som hon gio Tat co dinh khong lam khung bi hieu nham thanh qua dem."""
    explicit = on.get("range_day_offset")
    if explicit in (0, 1):
        return int(explicit)
    ton, toff = on.get("trigger_type") or "time", off.get("trigger_type") or "time"
    if ton == "time" and toff == "time":
        return 1 if _clock_seconds(off["time"]) <= _clock_seconds(on["time"]) else 0
    if ton in _SUN and toff in _SUN:
        if ton != toff:
            return 1 if ton == "sunset" else 0
        return 1 if (off.get("offset_minutes") or 0) <= (on.get("offset_minutes") or 0) else 0
    return 0


def _range_pair(schedule: dict, schedules: list[dict]) -> tuple[dict, dict] | None:
    """(Bat, Tat) cua khung gio chua `schedule`, None neu la lich don."""
    if not schedule.get("group_id") or schedule["action"].get("service") not in ("turn_on", "turn_off"):
        return None
    want = "turn_off" if schedule["action"]["service"] == "turn_on" else "turn_on"
    other = next((s for s in schedules if s["id"] != schedule["id"] and s.get("group_id") == schedule["group_id"]
                  and s["action"].get("service") == want), None)
    if other is None:
        return None
    return (schedule, other) if want == "turn_off" else (other, schedule)


def _range_inverted(on: dict, off: dict, on_date: date_cls) -> bool:
    """Khung TRONG NGAY ma hom do gio Tat <= gio Bat (vd Bat 17:00 -> Tat hoang
    hon, mua dong hoang hon 16:55): bo qua ca Bat lan Tat cua khung ngay do,
    khong bien thanh khung gan 24 gio."""
    if range_day_offset(on, off) != 0:
        return False
    tz = _tz(on.get("timezone") or DEFAULT_TIMEZONE)
    on_dt = _scheduled_dt_for_date(on, on_date, tz)
    off_dt = _scheduled_dt_for_date(off, on_date, tz)
    return on_dt is not None and off_dt is not None and off_dt <= on_dt


def _slot_inverted(schedule: dict, day: date_cls, schedules: list[dict] | None) -> bool:
    if not schedules:
        return False
    pair = _range_pair(schedule, schedules)
    if pair is None:
        return False
    on, off = pair
    on_date = day if schedule is on else day - timedelta(days=range_day_offset(on, off))
    return _range_inverted(on, off, on_date)


def _revision(schedule: dict) -> str:
    """Dau van tay cau hinh 1 moc (gio, kieu gio, hanh dong, thiet bi...) - KHONG
    gom updated_at vi keo tha doi thu tu cung cap nhat cot do."""
    raw = json.dumps([
        schedule.get("time"), schedule.get("trigger_type") or "time", schedule.get("offset_minutes") or 0,
        sorted(schedule.get("target_entities") or []), schedule.get("action"), schedule.get("group_id"),
        schedule.get("range_day_offset"),
    ], sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def paused_until(settings: dict | None = None) -> datetime | None:
    """Moc ket thuc "Tam dung tat ca lich" (che do di vang, Cai dat ->
    Scheduler) - None neu khong tam dung. Chuoi khong co mui gio duoc hieu
    theo mui gio mac dinh cua app."""
    raw = (settings if settings is not None else crud.get_settings()).get("pause_until") or ""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=_tz(crud.settings_timezone()))


def compute_next_run(schedule: dict, now: datetime | None = None, pause=_UNSET,
                     schedules: list[dict] | None = None) -> str | None:
    tz = _tz(schedule.get("timezone") or DEFAULT_TIMEZONE)
    now = now.astimezone(tz) if now else datetime.now(tz)
    # Dang tam dung -> lan chay tiep theo tinh tu luc het tam dung.
    pause_end = paused_until() if pause is _UNSET else pause
    if pause_end is not None and pause_end > now:
        now = pause_end.astimezone(tz)
    # Nhom dang "Bo qua" (v0.5.85): lenh Bat tinh tu luc het bo qua, lenh Tat van chay.
    group_skip = _group_skip_end(schedule)
    if group_skip is not None and group_skip > now:
        now = group_skip.astimezone(tz)
    days = set(schedule.get("days") or [0, 1, 2, 3, 4, 5, 6])
    if not schedule.get("enabled", True) or not crud.card_on(schedule) or not days:
        return None
    if schedule.get("trigger_type") == "auto_off":
        return None  # khong chay theo gio - xem auto_off.py
    # Quet toi da 370 ngay de tim ngay hop le tiep theo trong start_date/
    # end_date - du de bao trum ca nam neu khoang ngay dat trong tuong lai.
    horizon = 370 if (schedule.get("start_date") or schedule.get("end_date")) else 8
    for offset in range(0, horizon):
        date = (now + timedelta(days=offset)).date()
        if date.weekday() not in days or not _in_date_range(schedule, date):
            continue
        candidate = _scheduled_dt_for_date(schedule, date, tz)
        if candidate is not None and _slot_inverted(schedule, date, schedules):
            continue  # khung trong ngay bi dao thu tu hom do - se bo qua
        if candidate is not None and candidate >= now.replace(microsecond=0):
            # Bug v0.5.51 (test "cho card tu bat"): frontend reload ngay khi lich
            # vua chay, CUNG GIAY voi moc -> `>= now` (da cat micro giay) van tra
            # lai chinh moc vua chay -> card ket "Due now", khong ve thanh dem
            # nguoc. Moc da xu ly (last_scheduled_for) thi bo qua.
            if _slot_key(candidate) == schedule.get("last_scheduled_for"):
                continue
            return candidate.isoformat()
    return None


def _slot_key(scheduled_dt: datetime) -> str:
    return scheduled_dt.isoformat()


async def _conditions_met(conditions: list[dict]) -> bool:
    """Dieu kien phu kieu HA Automation (muc "chỉ chạy khi có điều kiện"
    2026-09-23, vd "chỉ bật máy lạnh khi CB Tổng - Bơm Máy T7 đang on") -
    AND tat ca, rong = luon chay (hanh vi cu). Doc trang thai THAT tu HA
    ngay truoc luc dinh goi service - chi goi khi thuc su co dieu kien can
    kiem (schedule da qua het cac buoc idempotent/missed/skip_once o tren),
    khong lam tang tan suat goi HA cho schedule khong co dieu kien."""
    if not conditions:
        return True
    try:
        states = await homeassistant.get_states()
    except Exception as exc:  # noqa: BLE001 - HA tam thoi khong doc duoc -> coi la CHUA du dieu kien (an toan hon la cu chay bua khi khong biet chac)
        log.warning("Khong doc duoc trang thai HA de kiem tra dieu kien schedule: %s", exc)
        return False
    state_by_entity = {s["entity_id"]: s.get("state") for s in states}
    return all(condition_ok(state_by_entity.get(cond["entity_id"]), cond) for cond in conditions)


def condition_ok(actual: str | None, cond: dict) -> bool:
    """1 dieu kien: "eq"/"ne" so chuoi, "gt"/"gte"/"lt"/"lte" so sanh so
    (vd do am < 60). Khong doi duoc ve so (unavailable...) -> SAI."""
    op = cond.get("operator") or "eq"
    expected = cond.get("state")
    if op == "eq":
        return actual == expected
    if op == "ne":
        return actual is not None and actual != expected
    try:
        a, b = float(actual), float(expected)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}.get(op, False)


def _execution_action(schedule: dict) -> dict:
    action = dict(schedule["action"])
    # Match force-on for basic power commands, including legacy stored schedules.
    # HA dispatches by each target's actual domain. Keep specialized parameters.
    if action["service"] in ("turn_on", "turn_off") and not action.get("service_data"):
        action["domain"] = "homeassistant"
    return action


def _group_skip_end(schedule: dict) -> datetime | None:
    """Moc het "Bo qua" cua nhom - chi ap dung cho lenh khong phai Tat (Tat
    van chay de van tuoi dang mo do van dong dung gio)."""
    raw = schedule.get("group_skip_until")
    if not raw or schedule["action"].get("service") == "turn_off":
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=ZoneInfo("UTC"))


def _armed_at(schedule: dict) -> datetime:
    """Moc lich bat dau co hieu luc voi cau hinh hien tai = updated_at (moi
    lan tao/sua/bat/tat card deu cap nhat cot nay, chuoi UTC isoformat)."""
    raw = schedule.get("updated_at") or schedule.get("created_at") or ""
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return datetime.min.replace(tzinfo=ZoneInfo("UTC"))
    return dt if dt.tzinfo else dt.replace(tzinfo=ZoneInfo("UTC"))


_slot_locks: dict[str, asyncio.Lock] = {}


def _slot_lock(schedule_id: str) -> asyncio.Lock:
    """1 khe gio chi duoc xu ly 1 lan: vong lich binh thuong va tat bu sau restart
    (recover_ranges) cung giu khoa nay, doc lai last_scheduled_for sau khi giu."""
    lock = _slot_locks.get(schedule_id)
    if lock is None:
        lock = _slot_locks[schedule_id] = asyncio.Lock()
    return lock


def _close_if_off(schedule: dict, slot: str) -> None:
    if schedule.get("group_id") and schedule["action"].get("service") == "turn_off":
        crud.close_ranges_for_off(schedule["id"], slot)


async def _process_schedule(schedule: dict, missed_policy: str, expires_at: datetime | None = None,
                            pause_end: datetime | None = None, schedules: list[dict] | None = None) -> None:
    tz = _tz(schedule.get("timezone") or DEFAULT_TIMEZONE)
    now = datetime.now(tz)
    if not schedule.get("enabled", True) or not crud.card_on(schedule):
        return
    if schedule.get("trigger_type") == "auto_off":
        return  # auto_off.py xu ly theo trang thai that, khong theo gio
    days = set(schedule.get("days") or [])
    if now.weekday() not in days:
        return
    if not _in_date_range(schedule, now.date()):
        return
    scheduled_dt = _scheduled_dt_for_date(schedule, now.date(), tz)
    if scheduled_dt is None or now < scheduled_dt:
        return
    slot = _slot_key(scheduled_dt)
    if schedule.get("last_scheduled_for") == slot:
        return  # da xu ly khe gio nay roi (idempotent)
    async with _slot_lock(schedule["id"]):
        fresh = crud.get_schedule(schedule["id"])
        if fresh is None or fresh.get("last_scheduled_for") == slot:
            return  # vua xoa, hoac tat bu da xu ly khe nay
        await _run_slot(schedule, missed_policy, expires_at, pause_end, schedules, now, scheduled_dt, slot)


async def _run_slot(schedule: dict, missed_policy: str, expires_at: datetime | None, pause_end: datetime | None,
                    schedules: list[dict] | None, now: datetime, scheduled_dt: datetime, slot: str) -> None:

    # Khe gio da qua TRUOC khi lich duoc tao/sua/bat (updated_at) thi khong
    # phai "lo gio" - vd tao khung 23:30->02:30 luc 22:12 thi moc Tat 02:30
    # hom nay da qua tu truoc, luc do lich chua ton tai (phan hoi 2026-09-24).
    # Danh dau im lang: khong ghi history, khong bao tren Home, khong tieu
    # skip_once. Van giu GRACE_SECONDS de sua lich sat gio van chay kip.
    if (now - scheduled_dt).total_seconds() > GRACE_SECONDS and scheduled_dt < _armed_at(schedule):
        crud.mark_executed(schedule["id"], slot, "skipped_inactive", consume_skip_once=False)
        return

    # Che do tam dung/di vang: danh dau da xu ly khe gio nay (khong chay bu
    # khi het tam dung, ke ca voi missed_policy="run_once").
    if pause_end is not None and scheduled_dt < pause_end:
        crud.mark_executed(schedule["id"], slot, "skipped_paused")
        _close_if_off(schedule, slot)
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_paused"})
        return

    group_skip = _group_skip_end(schedule)
    if group_skip is not None and scheduled_dt < group_skip:
        crud.mark_executed(schedule["id"], slot, "skipped_group", consume_skip_once=False)
        crud.add_history(schedule["id"], schedule["name"], slot, "skipped_group",
                         tr("Bỏ qua vì nhóm đang tạm bỏ qua (ví dụ trời mưa)", "Skipped because its group is skipping (e.g. rain)"))
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_group"})
        return

    # Khung trong ngay bi dao thu tu hom nay -> bo qua ca Bat lan Tat (v0.5.79).
    if _slot_inverted(schedule, scheduled_dt.date(), schedules if schedules is not None else crud.list_schedules()):
        crud.mark_executed(schedule["id"], slot, "skipped_inverted", consume_skip_once=False)
        _close_if_off(schedule, slot)
        crud.add_history(schedule["id"], schedule["name"], slot, "skipped_inverted",
                         tr("Hôm nay giờ Tắt đến trước giờ Bật (giờ mặt trời) - bỏ qua khung này",
                            "Today the end time comes before the start time (sun times) - range skipped"))
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_inverted"})
        return

    # Never replay an ON after its paired OFF deadline (including restart).
    if expires_at is not None and now >= expires_at:
        crud.mark_executed(schedule["id"], slot, "skipped_expired")
        crud.add_history(schedule["id"], schedule["name"], slot, "skipped_expired", "Khoang bat da ket thuc")
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_expired"})
        return

    is_missed = (now - scheduled_dt).total_seconds() > GRACE_SECONDS
    if is_missed and missed_policy == "skip":
        crud.mark_executed(schedule["id"], slot, "skipped_missed")
        crud.add_history(schedule["id"], schedule["name"], slot, "skipped_missed", tr("Lỡ giờ chạy (App tắt hoặc bận)", "Missed run (app was stopped or busy)"))
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_missed"})
        return

    if schedule.get("skip_once"):
        crud.mark_executed(schedule["id"], slot, "skipped_once")
        _close_if_off(schedule, slot)
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_once"})
        return

    if not await _conditions_met(schedule.get("conditions") or []):
        crud.mark_executed(schedule["id"], slot, "skipped_condition")
        _close_if_off(schedule, slot)
        crud.add_history(schedule["id"], schedule["name"], slot, "skipped_condition", tr("Điều kiện chưa thoả", "Conditions were not met"))
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_condition"})
        return

    action = _execution_action(schedule)
    targets = schedule.get("target_entities") or []
    # Scene/script khong co lenh Tat/Dao (du lieu cu, nhap tu file, nhom tron).
    if action["service"] in ("turn_off", "toggle") and any(_is_one_shot(e) for e in targets):
        targets = [e for e in targets if not _is_one_shot(e)]
        if not targets:
            crud.mark_executed(schedule["id"], slot, "skipped_unsupported")
            _close_if_off(schedule, slot)
            return
    status, message = "success", None
    started = time.monotonic()
    log.info("Dispatch schedule=%s service=%s.%s targets=%s due=%s lateness=%.3fs",
             schedule["id"], action["domain"], action["service"], targets, slot,
             (now - scheduled_dt).total_seconds())
    try:
        if not targets:
            raise ValueError("Schedule has no target entities")
        if targets:
            await homeassistant.call_service(action["domain"], action["service"], targets, action.get("service_data") or {})
    except Exception as exc:  # noqa: BLE001 - 1 schedule loi khong duoc lam chet vong lap (muc 54)
        status, message = "error", str(exc)
        log.warning("Schedule %s (%s) loi khi thuc thi: %s", schedule["id"], schedule["name"], exc)

    log.info("Complete schedule=%s status=%s elapsed=%.3fs", schedule["id"], status, time.monotonic() - started)
    crud.mark_executed(schedule["id"], slot, status)
    crud.add_history(schedule["id"], schedule["name"], slot, status, message)
    if status == "success":
        _track_range(schedule, scheduled_dt, slot, schedules)
    verify_targets = [e for e in targets if not _is_one_shot(e)]
    if status == "success" and verify_targets and action["service"] in ("turn_on", "turn_off") and crud.get_settings().get("verify_state"):
        task = asyncio.create_task(verify_state(schedule, action, verify_targets, slot_dt=scheduled_dt))
        _verify_tasks.add(task)
        task.add_done_callback(_verify_tasks.discard)
    await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": status, "message": message})


def _track_range(schedule: dict, scheduled_dt: datetime, slot: str, schedules: list[dict] | None) -> None:
    """Bat khung gio thanh cong -> ghi active_ranges (tat bu neu lo moc Tat);
    Tat thanh cong -> dong."""
    if not schedule.get("group_id"):
        return
    service = schedule["action"].get("service")
    if service == "turn_off":
        crud.close_ranges_for_off(schedule["id"], slot)
        return
    if service != "turn_on":
        return
    all_schedules = schedules if schedules is not None else crud.list_schedules()
    pair = _range_pair(schedule, all_schedules)
    if pair is None:
        return
    end = _window_end(schedule, scheduled_dt, all_schedules, require_enabled=False)
    if end is not None:
        crud.open_range(schedule["id"], pair[1]["id"], slot, _slot_key(end), _revision(schedule), _revision(pair[1]))


VERIFY_DELAY_SECONDS = 30
_verify_tasks: set[asyncio.Task] = set()
_OFF_STATES = ("off", "closed")  # rem dong = "closed" (khung gio Mo -> Dong)
_NO_STATE = ("unavailable", "unknown", None)


def _state_matches(service: str, state: str | None) -> bool:
    if service == "turn_off":
        return state in _OFF_STATES
    return state not in _OFF_STATES and state not in _NO_STATE


def _eligible_retry_targets(schedule: dict, targets: list[str], seq: dict[str, int], slot_dt: datetime | None) -> list[str]:
    """Read current retry permissions without yielding to another task."""
    if not crud.get_settings().get("verify_state"):
        return []
    fresh = crud.get_schedule(schedule["id"])
    if (fresh is None or not fresh.get("enabled", True) or not crud.card_on(fresh)
            or _revision(fresh) != _revision(schedule)):
        return []
    tz = _tz(schedule.get("timezone") or DEFAULT_TIMEZONE)
    now = datetime.now(tz)
    pause_end = paused_until()
    if pause_end is not None and pause_end > now:
        return []
    if slot_dt is not None and fresh.get("group_id") and fresh["action"].get("service") == "turn_on":
        end = _window_end(fresh, slot_dt, crud.list_schedules(), require_enabled=False)
        if end is not None and now >= end:
            return []
    allowed = [e for e in targets if homeassistant.command_seq(e) == seq.get(e)]
    return allowed


async def _retry_targets(schedule: dict, targets: list[str], seq: dict[str, int], slot_dt: datetime | None) -> list[str]:
    """Check eligibility both before and after the HA health request."""
    allowed = _eligible_retry_targets(schedule, targets, seq, slot_dt)
    if not allowed or not await homeassistant.ensure_stable():
        return []
    # The health request yields: schedule/settings/deadline may have changed.
    # Re-read every guard, without another await before dispatch.
    return _eligible_retry_targets(schedule, allowed, seq, slot_dt)


async def verify_state(schedule: dict, action: dict, targets: list[str], delay: float = VERIFY_DELAY_SECONDS,
                       slot_dt: datetime | None = None) -> list[str]:
    """Tuy chon CHUNG "Tự kiểm tra trạng thái thiết bị" (v0.5.35, mac dinh tat):
    30s sau khi lich Bat/Tat chay, doc trang thai THAT tu HA. Thiet bi nao chua
    dung thi gui lai lenh 1 lan (chi khi _retry_targets cho phep), doi them 30s
    kiem lai; van sai -> ghi Nhat ky "verify_failed". Relay xung (bam 1 lan doi
    trang thai): nguoi dung tu tat tuy chon - app khong tu nhan dien. Scene/
    script khong bao gio kiem tra (chay xong tu ve "off" -> se bi chay lai)."""
    targets = [e for e in targets if not _is_one_shot(e)]
    if not targets:
        return []
    seq = {e: homeassistant.command_seq(e) for e in targets}
    try:
        wrong = targets
        for attempt in range(2):
            await asyncio.sleep(delay)
            states = {s["entity_id"]: s.get("state") for s in await homeassistant.get_states()}
            wrong = [e for e in wrong if not _state_matches(action["service"], states.get(e))]
            if not wrong:
                if attempt:
                    crud.add_history(schedule["id"], schedule["name"], None, "success",
                                     tr("Kiểm tra lại: đã gửi lại lệnh, thiết bị đã đúng trạng thái", "Verification: command retried and device state is now correct"))
                return []
            if attempt == 0:
                retry = await _retry_targets(schedule, wrong, seq, slot_dt)
                if not retry:
                    log.info("Schedule %s: %s chua dung trang thai nhung khong gui lai (lich/thiet bi da doi hoac HA chua on dinh)", schedule["id"], wrong)
                    return []
                log.warning("Schedule %s: %s chua dung trang thai sau %ss - gui lai lenh", schedule["id"], retry, delay)
                await homeassistant.call_service(action["domain"], action["service"], retry, action.get("service_data") or {})
                wrong = retry
        word = tr("tắt", "turn off") if action["service"] == "turn_off" else tr("bật", "turn on")
        crud.add_history(schedule["id"], schedule["name"], None, "verify_failed",
                         tr(f"Thiết bị vẫn chưa {word} sau khi gửi lại lệnh: {', '.join(wrong)}", f"Devices still failed to {word} after retry: {', '.join(wrong)}"))
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "verify_failed"})
        return wrong
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("Kiem tra trang thai schedule %s loi: %s", schedule["id"], exc)
        return []


async def run_schedule_now(schedule: dict) -> tuple[str, str | None]:
    """Manual run (muc 22/25 SPEC.md) - khong dung toi last_scheduled_for/next_run."""
    action = _execution_action(schedule)
    targets = schedule.get("target_entities") or []
    status, message = "success", None
    try:
        if not targets:
            raise ValueError("Schedule has no target entities")
        if targets:
            await homeassistant.call_service(action["domain"], action["service"], targets, action.get("service_data") or {})
    except Exception as exc:  # noqa: BLE001
        status, message = "error", str(exc)
    crud.add_history(schedule["id"], schedule["name"], None, status, message, manual=True)
    await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": status, "message": message, "manual": True})
    return status, message


def _shift_date(value: str | None) -> str | None:
    return (date_cls.fromisoformat(value) + timedelta(days=1)).isoformat() if value else value


def normalize_range_days(group_ids: set[str] | None = None) -> int:
    """Ngay lap cua moc Tat trong 1 khung gio (cap turn_on/turn_off cung
    group_id - moi loai thiet bi: switch, may lanh, rem, quat, den, nhom...)
    luon suy ra tu moc Bat (v0.5.78): khung trong ngay -> giong het; khung
    QUA DEM (gio Tat <= gio Bat) -> doi +1 ngay (T2 -> T3, CN -> T2) va
    start_date/end_date +1 ngay, vi lan Tat cua lan Bat ngay D chay ngay D+1.
    Truoc day editor luu Tat cung `days` voi Bat: khung "chi T2 22:00 -> 02:00"
    tat luc 02:00 sang T2 (truoc khi bat), sang T3 khong tat -> thiet bi bat
    toi 02:00 T2 tuan sau. Lich hang ngay khong doi gi. Goi sau moi lan
    tao/sua lich, khoi phuc sao luu va luc khoi dong (sua du lieu cu) -
    idempotent vi chi tinh tu moc Bat. Tra ve so moc Tat da sua."""
    by_group: dict[str, list[dict]] = {}
    for s in crud.list_schedules():
        if s.get("group_id") and (group_ids is None or s["group_id"] in group_ids):
            by_group.setdefault(s["group_id"], []).append(s)
    changed = 0
    for items in by_group.values():
        ons = [s for s in items if s["action"].get("service") == "turn_on"]
        offs = [s for s in items if s["action"].get("service") == "turn_off"]
        if len(ons) != 1 or len(offs) != 1:
            continue
        on, off = ons[0], offs[0]
        mixed = ((on.get("trigger_type") or "time") == "time") != ((off.get("trigger_type") or "time") == "time")
        if mixed and on.get("range_day_offset") not in (0, 1):
            # Du lieu cu tron gio co dinh + mat troi (v0.5.79): giu hanh vi truoc
            # do (Tat <= Bat hom nay = qua dem) bang cach ghi gia tri chon tay.
            tz = _tz(on.get("timezone") or DEFAULT_TIMEZONE)
            today = datetime.now(tz).date()
            on_dt = _scheduled_dt_for_date(on, today, tz)
            off_dt = _scheduled_dt_for_date(off, today, tz)
            if on_dt is None or off_dt is None:
                continue  # chua co vi tri HA - de lan sau
            on["range_day_offset"] = 1 if off_dt.time() <= on_dt.time() else 0
            crud.set_range_day_offset([on["id"], off["id"]], on["range_day_offset"])
            changed += 1
        on_days = sorted(set(on.get("days") or []))
        if range_day_offset(on, off) == 1:
            want = (sorted({(d + 1) % 7 for d in on_days}), _shift_date(on.get("start_date")), _shift_date(on.get("end_date")))
        else:
            want = (on_days, on.get("start_date"), on.get("end_date"))
        if (sorted(set(off.get("days") or [])), off.get("start_date"), off.get("end_date")) != want:
            crud.set_days(off["id"], *want)
            changed += 1
    return changed


def _window_end(on: dict, start: datetime, schedules: list[dict], require_enabled: bool = True) -> datetime | None:
    """Moc Tat dong khung gio bat dau luc `start` cua lich Bat `on` (cung
    group_id, cung thiet bi); ngay cua moc Tat theo range_day_offset."""
    for other in schedules:
        if require_enabled and not (other.get("enabled", True) and crud.card_on(other)):
            continue
        if (other.get("group_id") == on["group_id"]
                and other["action"]["service"] == "turn_off"
                and set(other.get("target_entities") or []) == set(on.get("target_entities") or [])):
            off_tz = _tz(other.get("timezone") or DEFAULT_TIMEZONE)
            day = start.astimezone(off_tz).date() + timedelta(days=range_day_offset(on, other))
            end = _scheduled_dt_for_date(other, day, off_tz)
            if end is None or end <= start:
                return None  # chua tinh duoc gio mat troi, hoac khung trong ngay bi dao
            if day.weekday() in (other.get("days") or []) and _in_date_range(other, day):
                return end
    return None


def _on_deadline(schedule: dict, schedules: list[dict]) -> datetime | None:
    """The matching OFF closes this ON window; overnight windows end tomorrow."""
    if not schedule.get("group_id") or schedule["action"]["service"] != "turn_on":
        return None
    tz = _tz(schedule.get("timezone") or DEFAULT_TIMEZONE)
    start = _scheduled_dt_for_date(schedule, datetime.now(tz).date(), tz)
    if start is None:
        return None
    return _window_end(schedule, start, schedules)


def running_window_end(on: dict, schedules: list[dict], now: datetime | None = None) -> datetime | None:
    """Thiet bi cua lich Bat `on` (khung gio Bat -> Tat) co DANG bat do chinh
    lich nay khong: khung dang dien ra (ke ca khung qua dem bat dau hom qua)
    VA lan Bat cua khung do da thuc su chay thanh cong (khong bi bo qua vi
    dieu kien/tam dung/lo gio). Tra ve moc Tat, None neu khong."""
    if (not on.get("group_id") or on["action"]["service"] != "turn_on"
            or not on.get("enabled", True) or not crud.card_on(on)):
        return None
    tz = _tz(on.get("timezone") or DEFAULT_TIMEZONE)
    now = now.astimezone(tz) if now else datetime.now(tz)
    for day_offset in (0, -1):
        day = (now + timedelta(days=day_offset)).date()
        if day.weekday() not in (on.get("days") or []) or not _in_date_range(on, day):
            continue
        start = _scheduled_dt_for_date(on, day, tz)
        if start is None or start > now:
            continue
        if on.get("last_scheduled_for") != _slot_key(start) or on.get("last_status") != "success":
            continue
        end = _window_end(on, start, schedules, require_enabled=False)
        if end is not None and now < end:
            return end
    return None


async def turn_off_running(schedule_ids: list[str], reason: str) -> list[str]:
    """Goi TRUOC khi tat lich / cong tac tong card (phan hoi 2026-09-24 "nếu
    thiết bị đang on từ lịch mà off lịch hoặc card timer thì phải tắt thiết
    bị luôn"): thiet bi nao dang bat do 1 khung gio trong so cac lich nay
    thi tat ngay, khong doi toi moc Tat (moc Tat se khong chay nua vi lich
    da tat). Chi tat thiet bi thuc su do lich bat (xem running_window_end) -
    lich 1 moc "Bat" khong co moc Tat nen khong tinh. Loi goi HA chi ghi log,
    khong chan viec tat lich."""
    schedules = crud.list_schedules()
    by_id = {s["id"]: s for s in schedules}
    ons: dict[str, dict] = {}
    for sid in schedule_ids:
        s = by_id.get(sid)
        if not s or not s.get("group_id"):
            continue
        for cand in schedules:
            if cand.get("group_id") == s["group_id"] and cand["action"]["service"] == "turn_on":
                ons[cand["id"]] = cand
    targets: list[str] = []
    names: list[str] = []
    for on in ons.values():
        if running_window_end(on, schedules) is not None:
            names.append(on["name"])
            targets.extend(e for e in on.get("target_entities") or [] if e not in targets and not _is_one_shot(e))
        crud.close_range(on["id"])  # tat ngay o day, khong tat bu nua
    if not targets:
        return []
    reason_en = {
        "xoá lịch": "schedule deletion",
        "tắt công tắc tổng của card": "card switch being turned off",
        "tắt lịch": "schedule being disabled",
        "tắt nhóm": "the group being turned off",
        "tạm dừng tất cả lịch": "all schedules being paused",
    }.get(reason, reason)
    status, message = "success", tr(f"Tắt ngay vì {reason} khi đang trong khung giờ bật", f"Turned off immediately due to {reason_en} during an active time range")
    try:
        await homeassistant.call_service("homeassistant", "turn_off", targets, {})
    except Exception as exc:  # noqa: BLE001
        status, message = "error", tr(f"Không tắt được thiết bị khi {reason}: {exc}", f"Could not turn off devices due to {reason_en}: {exc}")
        log.warning("Tat thiet bi khi %s that bai: %s", reason, exc)
    crud.add_history(None, ", ".join(names), None, status, message, manual=True)
    return targets


RECOVERY_INTERVAL_SECONDS = 30
RECOVERY_MAX_AGE = timedelta(hours=48)


def _parse_dt(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


def seed_active_ranges() -> int:
    """Lan dau sau khi nang cap (bang active_ranges con trong): dung last_scheduled_for/
    last_status cua moc Bat de ghi lai khung dang mo ma moc Tat chua xu ly. Chi dung
    1 lan luc khoi dong - cot last_status bi lan sau ghi de nen khong dua mai vao no."""
    schedules = crud.list_schedules()
    existing = {r["on_id"] for r in crud.list_ranges()}
    added = 0
    for on in schedules:
        if (on["id"] in existing or on["action"].get("service") != "turn_on" or not on.get("group_id")
                or on.get("last_status") != "success"):
            continue
        start = _parse_dt(on.get("last_scheduled_for"))
        pair = _range_pair(on, schedules)
        if start is None or pair is None:
            continue
        off = pair[1]
        end = _window_end(on, start, schedules, require_enabled=False)
        if end is None:
            continue
        off_last = _parse_dt(off.get("last_scheduled_for"))
        if off_last is not None and (off_last > end or (off_last == end and off.get("last_status") not in ("skipped_missed", "error"))):
            continue  # moc Tat cua khung nay (hoac khung sau) da xu ly
        crud.open_range(on["id"], off["id"], _slot_key(start), _slot_key(end), _revision(on), _revision(off))
        added += 1
    return added


async def recover_ranges(now: datetime | None = None) -> list[str]:
    """Tat bu (v0.5.79): khung gio da BAT thanh cong ma qua moc Tat chua tat (app
    tat/khoi dong lai, HA mat ket noi luc toi gio Tat), ke ca khung bat tu hom
    truoc. Chi tat bu khi: 2 moc con nguyen cau hinh (dau van tay), lich + card
    con bat, khong tam dung, khong qua RECOVERY_MAX_AGE, moc Tat chua chay khe
    sau do, dieu kien Tat dung, skip_once chua dat va ket noi HA on dinh. Khung
    chua tung bat thi khong bao gio tat bu, cung khong bat bu. Tra ve on_id da tat."""
    now = now or datetime.now(_tz(DEFAULT_TIMEZONE))
    schedules = crud.list_schedules()
    by_id = {s["id"]: s for s in schedules}
    pause_end = paused_until()
    done: list[str] = []
    for row in crud.list_ranges():
        deadline = _parse_dt(row["deadline"])
        if deadline is not None and now < deadline + timedelta(seconds=GRACE_SECONDS):
            continue  # moc Tat binh thuong van dang phu trach
        on, off = by_id.get(row["on_id"]), by_id.get(row["off_id"])
        off_last = _parse_dt(off.get("last_scheduled_for")) if off else None
        stale = (
            deadline is None or on is None or off is None
            or _revision(on) != row["on_rev"] or _revision(off) != row["off_rev"]
            or not (on.get("enabled", True) and crud.card_on(on))
            or not (off.get("enabled", True) and crud.card_on(off))
            or now - deadline > RECOVERY_MAX_AGE
            or (pause_end is not None and pause_end > now)
            or (off_last is not None and off_last > deadline)
            or (off_last == deadline and off.get("last_status") not in ("skipped_missed", "error", "skipped_inactive"))
        )
        targets = [e for e in (off or {}).get("target_entities") or [] if not _is_one_shot(e)]
        if stale or not targets:
            crud.close_range(row["on_id"])
            continue
        async with _slot_lock(off["id"]):
            fresh = crud.get_schedule(off["id"])
            if fresh is None or (fresh.get("last_scheduled_for") == row["deadline"] and fresh.get("last_status") == "success"):
                crud.close_range(row["on_id"])
                continue
            if not await homeassistant.ensure_stable():
                continue  # giu lai, thu khi HA on dinh
            if fresh.get("skip_once"):
                crud.mark_executed(off["id"], row["deadline"], "skipped_once")
                crud.close_range(row["on_id"])
                continue
            if not await _conditions_met(fresh.get("conditions") or []):
                crud.mark_executed(off["id"], row["deadline"], "skipped_condition")
                crud.add_history(off["id"], off["name"], row["deadline"], "skipped_condition", tr("Điều kiện chưa thoả", "Conditions were not met"))
                crud.close_range(row["on_id"])
                continue
            action = _execution_action(fresh)
            try:
                await homeassistant.call_service(action["domain"], action["service"], targets, action.get("service_data") or {})
            except Exception as exc:  # noqa: BLE001 - giu lai, thu khi HA on dinh tro lai
                log.warning("Tat bu khung %s that bai: %s", row["on_id"], exc)
                continue
            crud.mark_executed(off["id"], row["deadline"], "success")
            crud.add_history(off["id"], off["name"], row["deadline"], "success",
                             tr("Tắt bù: quá giờ Tắt khi App/Home Assistant không chạy", "Catch-up off: the end time passed while the app/Home Assistant was down"))
            crud.close_range(row["on_id"])
            await manager.broadcast("schedule_executed", {"id": off["id"], "status": "success"})
            done.append(row["on_id"])
    return done


async def _maintenance() -> None:
    """Viec dinh ky, chay ngoai nhip dong ho: chuyen du lieu khung tron gio co
    dinh/mat troi khi da co vi tri HA, roi tat bu khung lo moc Tat."""
    try:
        if normalize_range_days():
            await manager.broadcast("schedule_updated", {"normalized": True})
        await recover_ranges()
    except Exception:  # noqa: BLE001
        log.exception("Loi khi tat bu khung gio")


async def scheduler_loop() -> None:
    log.info("Scheduler engine started (tick=%ss)", TICK_SECONDS)
    pending: dict[str, asyncio.Task] = {}
    observer_task: asyncio.Task | None = None
    maintenance_task: asyncio.Task | None = None
    last_maintenance = 0.0
    try:
        while True:
            tick_started = time.monotonic()
            try:
                # One in-flight task per schedule: slow HA calls never hold the clock.
                for sid, task in list(pending.items()):
                    if task.done():
                        del pending[sid]
                        if not task.cancelled() and task.exception():
                            log.error("Schedule %s failed: %s", sid, task.exception())
                settings = crud.get_settings()
                pause_end = paused_until(settings)
                schedules = crud.list_schedules()
                if any(s.get("trigger_type") in ("sunrise", "sunset") for s in schedules):
                    if observer_task is None or observer_task.done():
                        observer_task = asyncio.create_task(_ensure_observer())
                for schedule in schedules:
                    sid = schedule["id"]
                    if sid not in pending:
                        pending[sid] = asyncio.create_task(_process_schedule(
                            schedule, settings.get("missed_execution_policy", "skip"),
                            _on_deadline(schedule, schedules), pause_end, schedules,
                        ))
                if (time.monotonic() - last_maintenance >= RECOVERY_INTERVAL_SECONDS
                        and (maintenance_task is None or maintenance_task.done())):
                    last_maintenance = time.monotonic()
                    maintenance_task = asyncio.create_task(_maintenance())
            except Exception:
                log.exception("Loi khong mong doi trong scheduler_loop")
            await asyncio.sleep(max(0, TICK_SECONDS - (time.monotonic() - tick_started)))
    finally:
        tasks = list(pending.values()) + list(_verify_tasks)
        for extra in (observer_task, maintenance_task):
            if extra is not None:
                tasks.append(extra)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
