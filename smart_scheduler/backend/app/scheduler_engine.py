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
  - qua han lau hon (vd Add-on tat vai gio) -> ap dung policy:
      skip      -> khong chay, chi danh dau da xu ly khe do (mac dinh).
      run_once  -> chay bu dung 1 lan roi thoi.
"""
import asyncio
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


def paused_until(settings: dict | None = None) -> datetime | None:
    """Moc ket thuc "Tam dung tat ca lich" (che do di vang, Cai dat ->
    Scheduler) - None neu khong tam dung. Chuoi khong co mui gio duoc hieu
    theo mui gio mac dinh cua add-on."""
    raw = (settings if settings is not None else crud.get_settings()).get("pause_until") or ""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=_tz(crud.settings_timezone()))


def compute_next_run(schedule: dict, now: datetime | None = None, pause=_UNSET) -> str | None:
    tz = _tz(schedule.get("timezone") or DEFAULT_TIMEZONE)
    now = now.astimezone(tz) if now else datetime.now(tz)
    # Dang tam dung -> lan chay tiep theo tinh tu luc het tam dung.
    pause_end = paused_until() if pause is _UNSET else pause
    if pause_end is not None and pause_end > now:
        now = pause_end.astimezone(tz)
    days = set(schedule.get("days") or [0, 1, 2, 3, 4, 5, 6])
    if not schedule.get("enabled", True) or not schedule.get("card_enabled", True) or not days:
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


def _armed_at(schedule: dict) -> datetime:
    """Moc lich bat dau co hieu luc voi cau hinh hien tai = updated_at (moi
    lan tao/sua/bat/tat card deu cap nhat cot nay, chuoi UTC isoformat)."""
    raw = schedule.get("updated_at") or schedule.get("created_at") or ""
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return datetime.min.replace(tzinfo=ZoneInfo("UTC"))
    return dt if dt.tzinfo else dt.replace(tzinfo=ZoneInfo("UTC"))


async def _process_schedule(schedule: dict, missed_policy: str, expires_at: datetime | None = None,
                            pause_end: datetime | None = None) -> None:
    tz = _tz(schedule.get("timezone") or DEFAULT_TIMEZONE)
    now = datetime.now(tz)
    if not schedule.get("enabled", True) or not schedule.get("card_enabled", True):
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
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_paused"})
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
        crud.add_history(schedule["id"], schedule["name"], slot, "skipped_missed", tr("Lỡ giờ chạy (Add-on tắt hoặc bận)", "Missed run (add-on was stopped or busy)"))
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_missed"})
        return

    if schedule.get("skip_once"):
        crud.mark_executed(schedule["id"], slot, "skipped_once")
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_once"})
        return

    if not await _conditions_met(schedule.get("conditions") or []):
        crud.mark_executed(schedule["id"], slot, "skipped_condition")
        crud.add_history(schedule["id"], schedule["name"], slot, "skipped_condition", tr("Điều kiện chưa thoả", "Conditions were not met"))
        await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": "skipped_condition"})
        return

    action = _execution_action(schedule)
    targets = schedule.get("target_entities") or []
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
    if status == "success" and action["service"] in ("turn_on", "turn_off") and crud.get_settings().get("verify_state"):
        task = asyncio.create_task(verify_state(schedule, action, targets))
        _verify_tasks.add(task)
        task.add_done_callback(_verify_tasks.discard)
    await manager.broadcast("schedule_executed", {"id": schedule["id"], "status": status, "message": message})


VERIFY_DELAY_SECONDS = 30
_verify_tasks: set[asyncio.Task] = set()
_OFF_STATES = ("off",)
_NO_STATE = ("unavailable", "unknown", None)


def _state_matches(service: str, state: str | None) -> bool:
    if service == "turn_off":
        return state in _OFF_STATES
    return state not in _OFF_STATES and state not in _NO_STATE


async def verify_state(schedule: dict, action: dict, targets: list[str], delay: float = VERIFY_DELAY_SECONDS) -> list[str]:
    """Tuy chon "Tự kiểm tra trạng thái thiết bị" (v0.5.35): 30s sau khi lich
    Bat/Tat chay, doc trang thai THAT tu HA. Thiet bi nao chua dung (vd rot
    lenh Zigbee/WiFi, thiet bi mat ket noi) thi gui lai lenh 1 lan, doi them
    30s kiem lai; van sai -> ghi Nhat ky "verify_failed" (hien canh bao o
    trang Nha). Tra ve danh sach thiet bi van sai sau khi gui lai."""
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
                log.warning("Schedule %s: %s chua dung trang thai sau %ss - gui lai lenh", schedule["id"], wrong, delay)
                await homeassistant.call_service(action["domain"], action["service"], wrong, action.get("service_data") or {})
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
        tz = _tz(on.get("timezone") or DEFAULT_TIMEZONE)
        today = datetime.now(tz).date()
        on_dt = _scheduled_dt_for_date(on, today, tz)
        off_dt = _scheduled_dt_for_date(off, today, tz)
        if on_dt is None or off_dt is None:
            continue  # chua co vi tri HA cho binh minh/hoang hon - de lan sau
        on_days = sorted(set(on.get("days") or []))
        if off_dt.time() <= on_dt.time():
            want = (sorted({(d + 1) % 7 for d in on_days}), _shift_date(on.get("start_date")), _shift_date(on.get("end_date")))
        else:
            want = (on_days, on.get("start_date"), on.get("end_date"))
        if (sorted(set(off.get("days") or [])), off.get("start_date"), off.get("end_date")) != want:
            crud.set_days(off["id"], *want)
            changed += 1
    return changed


def _window_end(on: dict, start: datetime, schedules: list[dict], require_enabled: bool = True) -> datetime | None:
    """Moc Tat dong khung gio bat dau luc `start` cua lich Bat `on` (cung
    group_id, cung thiet bi); khung qua dem thi ket thuc ngay hom sau."""
    for other in schedules:
        if require_enabled and not (other.get("enabled", True) and other.get("card_enabled", True)):
            continue
        if (other.get("group_id") == on["group_id"]
                and other["action"]["service"] == "turn_off"
                and set(other.get("target_entities") or []) == set(on.get("target_entities") or [])):
            off_tz = _tz(other.get("timezone") or DEFAULT_TIMEZONE)
            day = start.astimezone(off_tz).date()
            end = _scheduled_dt_for_date(other, day, off_tz)
            if end is not None and end <= start:
                day += timedelta(days=1)
                end = _scheduled_dt_for_date(other, day, off_tz)
            if end and day.weekday() in (other.get("days") or []) and _in_date_range(other, day):
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
            or not on.get("enabled", True) or not on.get("card_enabled", True)):
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
            targets.extend(e for e in on.get("target_entities") or [] if e not in targets)
    if not targets:
        return []
    reason_en = {
        "xoá lịch": "schedule deletion",
        "tắt công tắc tổng của card": "card switch being turned off",
        "tắt lịch": "schedule being disabled",
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


async def scheduler_loop() -> None:
    log.info("Scheduler engine started (tick=%ss)", TICK_SECONDS)
    pending: dict[str, asyncio.Task] = {}
    observer_task: asyncio.Task | None = None
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
                            _on_deadline(schedule, schedules), pause_end,
                        ))
            except Exception:
                log.exception("Loi khong mong doi trong scheduler_loop")
            await asyncio.sleep(max(0, TICK_SECONDS - (time.monotonic() - tick_started)))
    finally:
        tasks = list(pending.values())
        if observer_task is not None:
            tasks.append(observer_task)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
