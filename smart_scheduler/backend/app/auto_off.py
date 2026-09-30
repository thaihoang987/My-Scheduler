"""Tu tat sau khi bat N thoi gian (v0.5.44, phan hoi 2026-09-30 "de dam bao
tuoi cay khong qua lau") - khac Schedule thuong: khong chay theo gio, ma
theo doi TRANG THAI THAT cua thiet bi. Thiet bi bat tu BAT KY dau (Lovelace,
cong tac tay, automation, lich khac) -> dem tu luc bat, du N thi tat.

Luu bang 1 dong `schedules` voi trigger_type="auto_off", `time`="HH:MM:SS" la
DO DAI (khong phai gio dong ho) - de card hien tren trang Nha, bat/tat/xoa/
sap xep/sao luu dung chung co che cua lich thuong. scheduler_engine bo qua
cac dong nay; vong lap o day moi xu ly.

Moc bat (`on_since`) luu SQLite (bang `auto_off_state`) de SONG QUA restart/
backup: vd den bat 23:00, tat sau 3h, 01:00 Unraid tat VM Home Assistant de
backup image, 01:30 bat lai. Neu chi dung `last_changed` cua HA thi sau
restart moc bat bi reset ve 01:30 -> den sang toi 04:30. Voi moc luu san:
- con bat sau khi len lai -> giu moc 23:00, tat dung 02:00;
- da qua han trong luc may tat (vd len lai 02:30) -> tat NGAY lan doc dau.
Chi xoa moc khi thay ro "off"/"closed"; unavailable/unknown (dang khoi dong,
mat ket noi) giu nguyen moc.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app import crud, homeassistant, manual_timer
from app.ws import manager
from app.i18n import tr

log = logging.getLogger("ha_smart_scheduler.auto_off")

POLL_SECONDS = 5
RETRY_SECONDS = 30
OFF_STATES = ("off", "closed")
NO_STATE = ("unavailable", "unknown", None)

_last_sent: dict[str, datetime] = {}  # entity -> luc gui lenh tat gan nhat (chong spam khi HA cham)


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


async def check_once(now: datetime | None = None) -> list[str]:
    """1 vong kiem tra, tra ve danh sach entity vua gui lenh tat."""
    now = now or _now()
    rule_map = rules()
    stored = crud.list_auto_off_state()
    for eid in [e for e in stored if e not in rule_map]:
        crud.delete_auto_off_state(eid)  # lich bi xoa/tat -> bo moc
    if not rule_map:
        return []
    try:
        states = {s["entity_id"]: s for s in await homeassistant.get_states()}
    except Exception as exc:  # noqa: BLE001 - HA chua san sang (vd vua boot sau backup) -> thu lai vong sau, GIU moc
        log.debug("Chua doc duoc trang thai HA: %s", exc)
        return []

    changed = False
    turned_off: list[str] = []
    manual = _manual_entities()
    for eid, (secs, schedule) in rule_map.items():
        st = states.get(eid)
        state = st.get("state") if st else None
        if state in NO_STATE:
            continue
        if state in OFF_STATES:
            if eid in stored:
                crud.delete_auto_off_state(eid)
                changed = True
            _last_sent.pop(eid, None)
            continue
        on_since = _parse(stored.get(eid))
        if on_since is None:
            # Lan dau thay dang bat: moc = last_changed cua HA, nhung khong som
            # hon luc lich duoc tao/sua (vua dat lich cho thiet bi dang bat tu
            # 2 tieng truoc thi dem tu bay gio, khong tat bat ngo).
            on_since = min(now, _parse(st.get("last_changed")) or now)
            armed = _parse(schedule.get("updated_at"))
            if armed and armed > on_since:
                on_since = min(now, armed)
            crud.save_auto_off_state(eid, on_since.isoformat())
            changed = True
        if eid in manual:
            continue
        if now < on_since + timedelta(seconds=secs):
            continue
        sent = _last_sent.get(eid)
        if sent and (now - sent).total_seconds() < RETRY_SECONDS:
            continue
        _last_sent[eid] = now
        dur = format_duration(secs)
        try:
            await homeassistant.call_service("homeassistant", "turn_off", [eid], {})
            status, message = "success", tr(f"Tự tắt sau khi bật {dur}", f"Auto-off after being on for {dur}")
            turned_off.append(eid)
        except Exception as exc:  # noqa: BLE001
            status, message = "error", tr(f"Tự tắt sau {dur} thất bại: {exc}", f"Auto-off after {dur} failed: {exc}")
            log.warning("Auto-off %s that bai: %s", eid, exc)
        crud.add_history(schedule["id"], schedule["name"], None, status, message)
        changed = True
    if changed:
        await manager.broadcast("auto_off_updated", {})
    return turned_off


async def auto_off_loop() -> None:
    log.info("Auto-off watcher started (poll=%ss)", POLL_SECONDS)
    while True:
        try:
            await check_once()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("Loi khong mong doi trong auto_off_loop")
        await asyncio.sleep(POLL_SECONDS)
