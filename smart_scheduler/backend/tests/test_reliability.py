"""v0.5.79 - do tin cay: kiem tra trang thai/gui lai, ket noi HA chap chon, tat bu
sau restart, khung gio theo mat troi, scene/script chay 1 lan."""
import asyncio
from datetime import datetime, timedelta

import pytest

from app import crud, homeassistant, manual_timer, scheduler_engine
from tests.test_backend import TZ, make_schedule

ON = {"domain": "switch", "service": "turn_on", "service_data": {}}
OFF = {"domain": "switch", "service": "turn_off", "service_data": {}}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def reset_ha_health(monkeypatch):
    monkeypatch.setattr(homeassistant, "_last_failure", None)
    monkeypatch.setattr(homeassistant, "_last_success", None)
    monkeypatch.setattr(homeassistant, "_command_seq", {})
    scheduler_engine._slot_locks.clear()


def make_pair(on_t, off_t, days=(0, 1, 2, 3, 4, 5, 6), gid="g1", **over):
    on = make_schedule(time=on_t, days=list(days), group_id=gid, action=ON, **over)
    off = make_schedule(time=off_t, days=list(days), group_id=gid, action=OFF, **over)
    scheduler_engine.normalize_range_days()
    return crud.get_schedule(on["id"]), crud.get_schedule(off["id"])


def ran_on(on, start: datetime):
    """Gia lap moc Bat da chay thanh cong luc `start` (ghi active_ranges)."""
    slot = start.isoformat()
    crud.mark_executed(on["id"], slot, "success")
    scheduler_engine._track_range(crud.get_schedule(on["id"]), start, slot, None)


# ---------------------------------------------------------------- 1. verify / gui lai

def _verify(s, service="turn_on", targets=("switch.a",), slot_dt=None):
    action = {"domain": "homeassistant", "service": service, "service_data": {}}
    return run(scheduler_engine.verify_state(s, action, list(targets), delay=0, slot_dt=slot_dt))


def test_verify_global_off_never_resends(fake_ha):
    s = make_schedule()
    fake_ha.states = [{"entity_id": "switch.a", "state": "off"}]
    assert _verify(s) == []
    assert fake_ha.calls == []


def test_verify_global_on_resends_once(fake_ha):
    crud.update_settings({"verify_state": True})
    s = make_schedule()
    fake_ha.states = [{"entity_id": "switch.a", "state": "off"}]
    assert _verify(s) == ["switch.a"]
    assert fake_ha.calls == [("homeassistant", "turn_on", ["switch.a"])]


@pytest.mark.parametrize("change", ["edited", "deleted", "disabled", "card_off", "paused", "newer_command", "unstable"])
def test_verify_does_not_resend_stale(fake_ha, change):
    crud.update_settings({"verify_state": True})
    s = make_schedule()
    fake_ha.states = [{"entity_id": "switch.a", "state": "off"}]

    real_sleep = asyncio.sleep

    async def sleep_then_change(_delay):
        await real_sleep(0)
        if change == "edited":
            crud.update_schedule(s["id"], {"time": "07:00:00"})
        elif change == "deleted":
            crud.delete_schedule(s["id"])
        elif change == "disabled":
            crud.set_enabled(s["id"], False)
        elif change == "card_off":
            crud.set_group_enabled([s["id"]], False)
        elif change == "paused":
            crud.update_settings({"pause_until": (datetime.now(TZ) + timedelta(days=1)).isoformat()})
        elif change == "newer_command":
            homeassistant.note_command(["switch.a"])  # vd hen tay / tu tat vua gui lenh
        elif change == "unstable":
            homeassistant._mark_failure()

    import unittest.mock as mock
    with mock.patch.object(scheduler_engine.asyncio, "sleep", sleep_then_change):
        assert _verify(s) == []
    assert fake_ha.calls == []


@pytest.mark.parametrize("change", ["disabled", "card_off", "deleted", "edited", "verify_off", "paused", "newer_command", "expired"])
def test_verify_rechecks_after_health_request(fake_ha, monkeypatch, change):
    crud.update_settings({"verify_state": True})
    start = datetime(2026, 10, 3, 18, tzinfo=TZ)
    on, _ = make_pair("18:00:00", "19:00:00")
    clock = [start + timedelta(minutes=1)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0].astimezone(tz) if tz else clock[0].replace(tzinfo=None)

    monkeypatch.setattr(scheduler_engine, "datetime", Clock)
    fake_ha.states = [{"entity_id": "switch.a", "state": "off"}]

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def health_request():
            entered.set()
            await release.wait()
            return True

        monkeypatch.setattr(homeassistant, "ensure_stable", health_request)
        task = asyncio.create_task(scheduler_engine.verify_state(on, ON, ["switch.a"], delay=0, slot_dt=start))
        await asyncio.wait_for(entered.wait(), timeout=1)
        if change == "disabled":
            crud.set_enabled(on["id"], False)
        elif change == "card_off":
            crud.set_group_enabled([on["id"]], False)
        elif change == "deleted":
            crud.delete_schedule(on["id"])
        elif change == "edited":
            crud.update_schedule(on["id"], {"time": "18:30:00"})
        elif change == "verify_off":
            crud.update_settings({"verify_state": False})
        elif change == "paused":
            crud.update_settings({"pause_until": (start + timedelta(days=1)).isoformat()})
        elif change == "newer_command":
            homeassistant.note_command(["switch.a"])
        elif change == "expired":
            clock[0] = start + timedelta(hours=1)
        release.set()
        assert await task == []

    run(scenario())
    assert fake_ha.calls == []


def test_verify_does_not_resend_after_range_ended(fake_ha):
    crud.update_settings({"verify_state": True})
    now = datetime.now(TZ)
    start = now - timedelta(minutes=20)
    on, _ = make_pair(start.strftime("%H:%M:%S"), (now - timedelta(minutes=1)).strftime("%H:%M:%S"))
    fake_ha.states = [{"entity_id": "switch.a", "state": "off"}]
    assert _verify(on, slot_dt=start.replace(microsecond=0)) == []
    assert fake_ha.calls == []


def test_verify_never_touches_scene_or_script(fake_ha):
    crud.update_settings({"verify_state": True})
    s = make_schedule(target_entities=["script.a"], action={"domain": "script", "service": "turn_on", "service_data": {}})
    fake_ha.states = [{"entity_id": "script.a", "state": "off"}]
    assert _verify(s, targets=["script.a", "scene.b"]) == []
    assert fake_ha.calls == []


# ---------------------------------------------------------------- 2. ket noi HA

def _clock(monkeypatch, value):
    monkeypatch.setattr(homeassistant.time, "monotonic", lambda: value)


def test_connection_offline_flapping_then_stable(monkeypatch):
    pings = []

    async def ping():
        pings.append(1)
        if len(pings) == 1:
            raise OSError("down again")  # chap chon
        homeassistant._mark_ok()

    monkeypatch.setattr(homeassistant, "ping", ping)
    _clock(monkeypatch, 1000.0)
    homeassistant._mark_failure()
    _clock(monkeypatch, 1030.0)
    assert run(homeassistant.ensure_stable()) is False and pings == []  # loi qua moi: khong doc thu
    _clock(monkeypatch, 1061.0)
    assert run(homeassistant.ensure_stable()) is False  # doc thu loi -> loi moi
    homeassistant._mark_failure()  # ping that se ghi loi
    _clock(monkeypatch, 1090.0)
    assert run(homeassistant.ensure_stable()) is False and len(pings) == 1
    _clock(monkeypatch, 1125.0)
    assert run(homeassistant.ensure_stable()) is True and len(pings) == 2


def test_manual_timer_retry_waits_for_stable(monkeypatch):
    calls, stable = [], iter([False, False, True])

    async def call_service(*args):
        calls.append(args)
        if len(calls) == 1:
            raise OSError("HA offline")

    async def ensure_stable():
        return next(stable)

    monkeypatch.setattr(homeassistant, "call_service", call_service)
    monkeypatch.setattr(homeassistant, "ensure_stable", ensure_stable)
    monkeypatch.setattr(manual_timer, "RETRY_SECONDS", 0)
    crud.save_manual_timer({"id": "t1", "entity_ids": ["switch.a"], "started_at": "x", "off_at": datetime.now(TZ).isoformat()})
    run(manual_timer._auto_off("t1", ["switch.a"], 0))
    assert len(calls) == 2  # 1 lan loi + 1 lan sau khi on dinh, khong ban moi vong


def test_failed_script_is_not_replayed(fake_ha, monkeypatch):
    """Timeout co the da chay script tren HA - khong tu phat lai."""
    async def timeout(*args):
        fake_ha.calls.append(args[:3])
        raise TimeoutError("timeout")

    monkeypatch.setattr(homeassistant, "call_service", timeout)
    now = datetime.now(TZ)
    s = make_schedule(time=(now - timedelta(seconds=5)).strftime("%H:%M:%S"), target_entities=["script.a"],
                      action={"domain": "script", "service": "turn_on", "service_data": {}})
    run(scheduler_engine._process_schedule(s, "run_once"))
    run(scheduler_engine._process_schedule(crud.get_schedule(s["id"]), "run_once"))
    run(scheduler_engine._maintenance())
    assert len(fake_ha.calls) == 1
    assert crud.get_schedule(s["id"])["last_status"] == "error"


# ---------------------------------------------------------------- 3. tat bu sau restart

def test_recover_overnight_range_after_restart_once(fake_ha):
    on, off = make_pair("23:59:00", "00:01:00", gid="g1")
    start = datetime(2026, 10, 1, 23, 59, tzinfo=TZ)
    ran_on(on, start)
    now = datetime(2026, 10, 2, 0, 30, tzinfo=TZ)  # add-on tat luc 00:01
    assert run(scheduler_engine.recover_ranges(now)) == [on["id"]]
    assert fake_ha.calls == [("homeassistant", "turn_off", ["switch.a"])]
    got = crud.get_schedule(off["id"])
    assert (got["last_scheduled_for"], got["last_status"]) == ("2026-10-02T00:01:00+07:00", "success")
    assert run(scheduler_engine.recover_ranges(now)) == []  # khong gui trung
    assert len(fake_ha.calls) == 1


def test_recover_same_day_range_from_yesterday(fake_ha):
    on, _ = make_pair("20:00:00", "22:00:00")
    ran_on(on, datetime(2026, 10, 1, 20, 0, tzinfo=TZ))
    assert run(scheduler_engine.recover_ranges(datetime(2026, 10, 2, 8, 0, tzinfo=TZ))) == [on["id"]]


def test_recover_weekday_boundary_monday_only(fake_ha):
    on, off = make_pair("22:00:00", "02:00:00", days=[0])
    assert crud.get_schedule(off["id"])["days"] == [1]
    ran_on(on, datetime(2026, 9, 28, 22, 0, tzinfo=TZ))  # T2
    row = crud.list_ranges()[0]
    assert row["deadline"] == "2026-09-29T02:00:00+07:00"  # sang T3
    assert run(scheduler_engine.recover_ranges(datetime(2026, 9, 29, 3, 0, tzinfo=TZ))) == [on["id"]]


def test_no_catch_up_when_on_never_ran(fake_ha):
    make_pair("20:00:00", "22:00:00")
    assert run(scheduler_engine.recover_ranges(datetime(2026, 10, 2, 8, 0, tzinfo=TZ))) == []
    assert fake_ha.calls == []


def test_no_catch_up_when_range_was_edited(fake_ha):
    on, _ = make_pair("20:00:00", "22:00:00")
    ran_on(on, datetime(2026, 10, 1, 20, 0, tzinfo=TZ))
    crud.update_schedule(on["id"], {"time": "20:30:00"})
    assert run(scheduler_engine.recover_ranges(datetime(2026, 10, 2, 8, 0, tzinfo=TZ))) == []
    assert fake_ha.calls == [] and crud.list_ranges() == []


def test_reorder_does_not_cancel_catch_up(fake_ha):
    on, off = make_pair("20:00:00", "22:00:00")
    ran_on(on, datetime(2026, 10, 1, 20, 0, tzinfo=TZ))
    crud.reorder_schedules([off["id"], on["id"]])  # chi doi updated_at
    assert run(scheduler_engine.recover_ranges(datetime(2026, 10, 2, 8, 0, tzinfo=TZ))) == [on["id"]]


def test_no_catch_up_when_off_condition_false(fake_ha):
    on, off = make_pair("20:00:00", "22:00:00")
    crud.update_schedule(off["id"], {"conditions": [{"entity_id": "switch.b", "state": "on"}]})
    fake_ha.states = [{"entity_id": "switch.b", "state": "off"}]
    ran_on(crud.get_schedule(on["id"]), datetime(2026, 10, 1, 20, 0, tzinfo=TZ))
    assert run(scheduler_engine.recover_ranges(datetime(2026, 10, 2, 8, 0, tzinfo=TZ))) == []
    assert fake_ha.calls == [] and crud.list_ranges() == []


def test_catch_up_waits_for_stable_connection(fake_ha, monkeypatch):
    on, _ = make_pair("20:00:00", "22:00:00")
    ran_on(on, datetime(2026, 10, 1, 20, 0, tzinfo=TZ))
    stable = [False]

    async def ensure_stable():
        return stable[0]

    monkeypatch.setattr(homeassistant, "ensure_stable", ensure_stable)
    now = datetime(2026, 10, 2, 8, 0, tzinfo=TZ)
    assert run(scheduler_engine.recover_ranges(now)) == [] and fake_ha.calls == []
    assert len(crud.list_ranges()) == 1  # giu lai
    stable[0] = True
    assert run(scheduler_engine.recover_ranges(now)) == [on["id"]]


def test_normal_off_closes_range_and_is_not_duplicated(fake_ha):
    now = datetime.now(TZ)
    on, off = make_pair((now - timedelta(minutes=10)).strftime("%H:%M:%S"), (now - timedelta(seconds=5)).strftime("%H:%M:%S"))
    ran_on(on, now.replace(microsecond=0) - timedelta(minutes=10))
    run(scheduler_engine._process_schedule(off, "skip"))
    assert crud.list_ranges() == []
    assert run(scheduler_engine.recover_ranges(now + timedelta(hours=1))) == []
    assert len(fake_ha.calls) == 1


def test_missed_off_is_caught_up_once(fake_ha):
    """Add-on khoi dong lai sau moc Tat (policy skip): vong lich ghi skipped_missed,
    tat bu gui 1 lan, vong lich sau khong gui lai."""
    now = datetime.now(TZ).replace(microsecond=0)
    on_t, off_t = now - timedelta(hours=2), now - timedelta(minutes=30)
    if on_t.date() != now.date() or off_t.date() != now.date():
        pytest.skip("gan nua dem")
    on, off = make_pair(on_t.strftime("%H:%M:%S"), off_t.strftime("%H:%M:%S"))
    for s in (on, off):  # lich da ton tai tu hom qua (khong phai "vua tao")
        crud.get_conn().execute("UPDATE schedules SET updated_at=? WHERE id=?", ((now - timedelta(days=1)).isoformat(), s["id"]))
    crud.get_conn().commit()
    ran_on(on, on_t)
    run(scheduler_engine._process_schedule(crud.get_schedule(off["id"]), "skip"))
    assert crud.get_schedule(off["id"])["last_status"] == "skipped_missed" and fake_ha.calls == []
    assert run(scheduler_engine.recover_ranges(now)) == [on["id"]]
    run(scheduler_engine._process_schedule(crud.get_schedule(off["id"]), "skip"))
    assert len(fake_ha.calls) == 1


def test_seed_from_existing_last_run(fake_ha):
    on, off = make_pair("20:00:00", "22:00:00")
    crud.mark_executed(on["id"], "2026-10-01T20:00:00+07:00", "success")
    assert scheduler_engine.seed_active_ranges() == 1
    assert crud.list_ranges()[0]["deadline"] == "2026-10-01T22:00:00+07:00"
    crud.close_range(on["id"])
    crud.mark_executed(off["id"], "2026-10-01T22:00:00+07:00", "success")
    assert scheduler_engine.seed_active_ranges() == 0  # moc Tat da chay


# ---------------------------------------------------------------- 4. khung gio theo mat troi

def _sun(monkeypatch, sunrise=(5, 40), sunset=(17, 40)):
    def fake(kind, day, tz):
        h, m = sunrise if kind == "sunrise" else sunset
        return datetime(day.year, day.month, day.day, h, m, tzinfo=tz)
    monkeypatch.setattr(scheduler_engine, "_sun_time_for_date", fake)


def test_range_day_offset_policy():
    def s(trigger="time", time="00:00:00", offset=0, explicit=None):
        return {"trigger_type": trigger, "time": time, "offset_minutes": offset, "range_day_offset": explicit}
    f = scheduler_engine.range_day_offset
    assert f(s(time="22:00:00"), s(time="02:00:00")) == 1
    assert f(s(time="06:00:00"), s(time="10:00:00")) == 0
    assert f(s("sunset"), s("sunrise")) == 1
    assert f(s("sunrise"), s("sunset")) == 0
    assert f(s("sunset", offset=-30), s("sunset", offset=30)) == 0
    assert f(s(time="17:00:00"), s("sunset")) == 0  # tron: mac dinh trong ngay
    assert f(s(time="22:00:00", explicit=1), s("sunrise")) == 1
    assert f(s(time="22:00:00", explicit=0), s(time="02:00:00")) == 0


def test_sunset_to_sunrise_ends_next_morning(monkeypatch):
    _sun(monkeypatch)
    on, off = make_pair("00:00:00", "00:00:00", days=[0])
    crud.update_schedule(on["id"], {"trigger_type": "sunset"})
    crud.update_schedule(off["id"], {"trigger_type": "sunrise"})
    scheduler_engine.normalize_range_days()
    on, off = crud.get_schedule(on["id"]), crud.get_schedule(off["id"])
    assert off["days"] == [1]
    start = datetime(2026, 9, 28, 17, 40, tzinfo=TZ)
    assert scheduler_engine._window_end(on, start, crud.list_schedules()) == datetime(2026, 9, 29, 5, 40, tzinfo=TZ)


def test_inverted_same_day_range_skips_on_and_off(fake_ha, monkeypatch):
    """Bat 17:00 -> Tat hoang hon, mua dong hoang hon 16:55: bo qua ca 2 moc hom do."""
    _sun(monkeypatch, sunset=(16, 55))
    now = datetime.now(TZ).replace(microsecond=0)
    on, off = make_pair("17:00:00", "00:00:00")
    crud.update_schedule(off["id"], {"trigger_type": "sunset"})
    crud.set_range_day_offset([on["id"], off["id"]], 0)
    for s in (on, off):  # lich co tu hom qua
        crud.get_conn().execute("UPDATE schedules SET updated_at=? WHERE id=?", ((now - timedelta(days=1)).isoformat(), s["id"]))
    crud.get_conn().commit()
    on, off = crud.get_schedule(on["id"]), crud.get_schedule(off["id"])
    assert scheduler_engine._window_end(on, datetime.combine(now.date(), datetime.min.time(), TZ).replace(hour=17), crud.list_schedules()) is None

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(now.year, now.month, now.day, 17, 1, tzinfo=TZ).astimezone(tz)

    monkeypatch.setattr(scheduler_engine, "datetime", Clock)
    for s in (on, off):
        run(scheduler_engine._process_schedule(crud.get_schedule(s["id"]), "run_once"))
    assert fake_ha.calls == []
    assert {crud.get_schedule(s["id"])["last_status"] for s in (on, off)} == {"skipped_inverted"}


def test_old_mixed_range_keeps_overnight_behavior(monkeypatch):
    _sun(monkeypatch)
    on, off = make_pair("22:00:00", "00:00:00", days=[0])
    crud.update_schedule(off["id"], {"trigger_type": "sunrise"})  # 22:00 -> binh minh (du lieu cu)
    scheduler_engine.normalize_range_days()
    on, off = crud.get_schedule(on["id"]), crud.get_schedule(off["id"])
    assert on["range_day_offset"] == 1 and off["days"] == [1]


def test_range_day_offset_backup_roundtrip():
    on, _ = make_pair("22:00:00", "06:00:00")
    crud.set_range_day_offset([on["id"]], 1)
    data = crud.export_all()
    assert any(s["range_day_offset"] == 1 for s in data["schedules"])
    crud.open_range(on["id"], "x", "a", "b", "c", "d")
    crud.import_all(data)
    assert crud.get_schedule(on["id"])["range_day_offset"] == 1
    assert crud.list_ranges() == []  # khung dang mo cua du lieu cu bi bo khi khoi phuc


def test_range_day_offset_migration_on_old_db(tmp_path, monkeypatch):
    import sqlite3
    from app import db
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE schedules (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, "
                 "target_entities TEXT NOT NULL, action TEXT NOT NULL, days TEXT NOT NULL, time TEXT NOT NULL, "
                 "timezone TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, group_id TEXT, favorite INTEGER NOT NULL DEFAULT 0, "
                 "skip_once INTEGER NOT NULL DEFAULT 0, skip_until TEXT, last_scheduled_for TEXT, last_run TEXT, last_status TEXT, "
                 "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
    conn.commit()
    conn.close()
    monkeypatch.setattr(db, "DB_PATH", str(path))
    db._local.conn = None
    db.init_db()
    cols = {r[1] for r in db.get_conn().execute("PRAGMA table_info(schedules)")}
    assert "range_day_offset" in cols
    assert db.get_conn().execute("SELECT name FROM sqlite_master WHERE name='active_ranges'").fetchone()


# ---------------------------------------------------------------- 5. scene/script chay 1 lan

def test_off_for_script_is_never_sent(fake_ha):
    now = datetime.now(TZ)
    s = make_schedule(time=(now - timedelta(seconds=5)).strftime("%H:%M:%S"), target_entities=["script.a", "switch.b"],
                      action={"domain": "homeassistant", "service": "turn_off", "service_data": {}})
    run(scheduler_engine._process_schedule(s, "skip"))
    assert [c[2] for c in fake_ha.calls] == [["switch.b"]]  # nhom tron: bo script
    only = make_schedule(time=(now - timedelta(seconds=5)).strftime("%H:%M:%S"), target_entities=["scene.a"],
                         action={"domain": "scene", "service": "turn_off", "service_data": {}})
    run(scheduler_engine._process_schedule(only, "skip"))
    assert len(fake_ha.calls) == 1
    assert crud.get_schedule(only["id"])["last_status"] == "skipped_unsupported"


def test_api_rejects_off_or_auto_off_for_scene():
    from fastapi import HTTPException
    from app.api import schedules as schedules_api
    from app.models import ScheduleIn
    for over in ({"action": {"domain": "scene", "service": "turn_off"}},
                 {"action": {"domain": "script", "service": "turn_on"}, "trigger_type": "auto_off"}):
        payload = ScheduleIn(name="x", target_entities=["scene.a"], time="06:00:00", **{"action": {"domain": "scene", "service": "turn_on"}, **over})
        with pytest.raises(HTTPException):
            run(schedules_api.create_schedule(payload))
    ok = ScheduleIn(name="x", target_entities=["scene.a"], time="06:00:00", action={"domain": "scene", "service": "turn_on"})
    assert run(schedules_api.create_schedule(ok))["id"]


def test_auto_off_ignores_scene_and_script():
    from app import auto_off
    make_schedule(trigger_type="auto_off", time="00:10:00", target_entities=["script.a", "switch.b"],
                  action={"domain": "homeassistant", "service": "turn_off", "service_data": {}})
    assert set(auto_off.rules()) == {"switch.b"}
