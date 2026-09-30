import asyncio
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app import crud, db, presence, scheduler_engine
from app.scheduler_engine import compute_next_run, condition_ok

TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def run(coro):
    return asyncio.run(coro)


def make_schedule(**over):
    data = {
        "name": "Test",
        "target_entities": ["switch.a"],
        "action": {"domain": "switch", "service": "turn_on", "service_data": {}},
        "time": "06:00:00",
        "timezone": "Asia/Ho_Chi_Minh",
        "card_enabled": None,
    }
    data.update(over)
    return crud.create_schedule(data)


# ---- migration card_enabled ----

def test_card_enabled_migration_from_group_off(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    monkeypatch.setattr(db, "DB_PATH", str(path))
    db._local.conn.close()
    db._local.conn = None
    old_schema = db.SCHEMA.replace("    card_enabled INTEGER NOT NULL DEFAULT 1,\n", "")
    conn = sqlite3.connect(path)
    conn.executescript(old_schema)
    conn.execute("INSERT INTO schedules(id,name,enabled,time,group_off,created_at,updated_at) VALUES('a','A',0,'10:00',1,'x','x')")
    conn.execute("INSERT INTO schedules(id,name,enabled,time,group_off,created_at,updated_at) VALUES('b','B',0,'10:00',0,'x','x')")
    conn.commit()
    conn.close()
    db.init_db()
    db.init_db()  # chay lai khong duoc chuyen du lieu lan 2
    rows = {s["id"]: (s["enabled"], s["card_enabled"]) for s in crud.list_schedules()}
    assert rows == {"a": (True, False), "b": (False, True)}


def test_group_toggle_keeps_child_state():
    a = make_schedule()
    b = make_schedule()
    crud.set_enabled(b["id"], False)
    crud.set_group_enabled([a["id"], b["id"]], False)
    crud.set_group_enabled([a["id"], b["id"]], True)
    got = {s["id"]: (s["enabled"], s["card_enabled"]) for s in crud.list_schedules()}
    assert got[a["id"]] == (True, True)
    assert got[b["id"]] == (False, True)


def test_update_without_card_enabled_keeps_it():
    s = make_schedule()
    crud.set_group_enabled([s["id"]], False)
    assert crud.update_schedule(s["id"], {"name": "x", "card_enabled": None})["card_enabled"] is False


def test_card_disabled_has_no_next_run():
    s = make_schedule()
    crud.set_group_enabled([s["id"]], False)
    assert compute_next_run(crud.get_schedule(s["id"]), pause=None) is None


# ---- dieu kien ----

@pytest.mark.parametrize(
    "actual,op,expected,ok",
    [
        ("on", "eq", "on", True),
        ("off", "eq", "on", False),
        ("off", "ne", "on", True),
        (None, "ne", "on", False),
        ("55.2", "lt", "60", True),
        ("65", "lt", "60", False),
        ("30", "gte", "30", True),
        ("31", "gt", "30", True),
        ("unavailable", "gt", "30", False),
    ],
)
def test_condition_ok(actual, op, expected, ok):
    assert condition_ok(actual, {"entity_id": "sensor.x", "state": expected, "operator": op}) is ok


def test_condition_default_operator_is_eq():
    assert condition_ok("cool", {"entity_id": "climate.x", "state": "cool"})


# ---- tam dung ----

def test_pause_moves_next_run_after_pause():
    s = make_schedule(time="06:00:00")
    now = datetime(2026, 9, 24, 5, 0, tzinfo=TZ)
    assert compute_next_run(s, now, pause=None).startswith("2026-09-24T06:00")
    pause_end = datetime(2026, 9, 26, 12, 0, tzinfo=TZ)
    assert compute_next_run(s, now, pause=pause_end).startswith("2026-09-27T06:00")


def test_paused_until_parses_setting():
    assert scheduler_engine.paused_until({"pause_until": ""}) is None
    assert scheduler_engine.paused_until({"pause_until": "2026-09-30T08:00"}).tzinfo is not None


def test_process_schedule_skips_while_paused(fake_ha):
    now = datetime.now(TZ)
    s = make_schedule(time=(now - timedelta(seconds=5)).strftime("%H:%M:%S"))
    run(scheduler_engine._process_schedule(s, "skip", None, now + timedelta(days=1)))
    assert fake_ha.calls == []
    assert crud.get_schedule(s["id"])["last_status"] == "skipped_paused"


def test_process_schedule_runs_when_not_paused(fake_ha):
    now = datetime.now(TZ)
    s = make_schedule(time=(now - timedelta(seconds=5)).strftime("%H:%M:%S"))
    run(scheduler_engine._process_schedule(s, "skip", None, None))
    assert fake_ha.calls and fake_ha.calls[0][2] == ["switch.a"]


# ---- lo gio ----

def _ten_minutes_ago():
    now = datetime.now(TZ)
    if now.hour == 0 and now.minute < 15:
        pytest.skip("khe gio -10 phut roi sang ngay hom qua")
    return (now - timedelta(minutes=10)).strftime("%H:%M:%S")


def test_slot_before_schedule_created_is_not_missed(fake_ha):
    # Tao khung 23:30->02:30 luc 22:12: moc 02:30 hom nay qua truoc khi lich ton tai.
    s = make_schedule(time=_ten_minutes_ago())
    run(scheduler_engine._process_schedule(s, "skip", None, None))
    assert fake_ha.calls == []
    assert crud.get_schedule(s["id"])["last_status"] == "skipped_inactive"
    assert crud.list_history(50) == []


def test_slot_after_schedule_saved_is_missed(fake_ha):
    s = make_schedule(time=_ten_minutes_ago())
    s["updated_at"] = (datetime.now(TZ) - timedelta(days=1)).isoformat()
    run(scheduler_engine._process_schedule(s, "skip", None, None))
    assert fake_ha.calls == []
    assert [h["status"] for h in crud.list_history(50)] == ["skipped_missed"]


# ---- sao luu ----

def test_backup_roundtrip_keeps_groups_and_category():
    group = crud.create_group("Phòng Hoàng")
    crud.upsert_alias("switch.a", "switch", {"alias": "A", "icon": "mdi:sprinkler", "added": True, "category_id": group["id"]})
    s = make_schedule(conditions=[{"entity_id": "switch.b", "state": "on", "operator": "eq"}])
    crud.set_group_enabled([s["id"]], False)
    dump = crud.export_all()
    crud.import_all({"schedules": [], "entity_aliases": [], "groups": []})
    assert crud.list_groups() == []
    crud.import_all(dump)
    assert [g["name"] for g in crud.list_groups()] == ["Phòng Hoàng"]
    alias = crud.list_aliases()["switch.a"]
    assert alias["category_id"] == group["id"] and alias["icon"] == "mdi:sprinkler"
    restored = crud.get_schedule(s["id"])
    assert restored["card_enabled"] is False
    assert restored["conditions"][0]["entity_id"] == "switch.b"


def test_import_v1_backup_keeps_existing_groups():
    crud.create_group("Giữ lại")
    crud.import_all({"schedules": [], "entity_aliases": []})
    assert [g["name"] for g in crud.list_groups()] == ["Giữ lại"]


# ---- gia lap co nguoi ----

@pytest.fixture
def presence_reset(monkeypatch):
    presence._on.clear()
    presence._next_start_at = None
    presence._last_entity = None
    monkeypatch.setattr(presence.random, "uniform", lambda a, b: a)  # luon lay can duoi
    yield
    presence._on.clear()
    presence._next_start_at = None


def test_presence_window_overnight():
    cfg = {**presence.DEFAULT_CONFIG, "start": "20:00", "end": "01:00", "days": [3]}  # Thu 5
    thu_2130 = datetime(2026, 9, 24, 21, 30, tzinfo=TZ)
    fri_0030 = datetime(2026, 9, 25, 0, 30, tzinfo=TZ)
    fri_2130 = datetime(2026, 9, 25, 21, 30, tzinfo=TZ)
    assert presence.window_end(cfg, thu_2130) == datetime(2026, 9, 25, 1, 0, tzinfo=TZ)
    assert presence.window_end(cfg, fri_0030) is not None  # khung bat dau tu Thu 5
    assert presence.window_end(cfg, fri_2130) is None


def test_presence_turns_devices_on_one_at_a_time(fake_ha, presence_reset):
    presence.save_config({"enabled": True, "entity_ids": ["light.a", "light.b"], "start": "18:00", "end": "23:00",
                          "on_min": 10, "on_max": 20, "gap_min": 2, "gap_max": 5, "max_concurrent": 1})
    t = datetime(2026, 9, 24, 18, 0, tzinfo=TZ)
    run(presence.tick(t))  # vua vao khung -> hen luot dau sau 2 phut
    assert fake_ha.calls == []
    run(presence.tick(t + timedelta(minutes=2)))
    assert len(fake_ha.calls) == 1 and fake_ha.calls[0][1] == "turn_on"
    first = fake_ha.calls[0][2][0]
    run(presence.tick(t + timedelta(minutes=5)))  # van dang sang, chua bat them
    assert len(fake_ha.calls) == 1
    run(presence.tick(t + timedelta(minutes=12)))  # het 10 phut -> tat
    assert fake_ha.calls[-1] == ("homeassistant", "turn_off", [first])
    run(presence.tick(t + timedelta(minutes=14)))  # nghi 2 phut -> bat thiet bi KHAC
    assert fake_ha.calls[-1][1] == "turn_on" and fake_ha.calls[-1][2][0] != first


def test_presence_turns_off_at_window_end_and_when_disabled(fake_ha, presence_reset):
    presence.save_config({"enabled": True, "entity_ids": ["light.a"], "start": "18:00", "end": "18:10",
                          "on_min": 30, "on_max": 30, "gap_min": 0, "gap_max": 0})
    t = datetime(2026, 9, 24, 18, 0, tzinfo=TZ)
    run(presence.tick(t))
    assert fake_ha.calls[-1][1] == "turn_on"
    assert presence._on["light.a"] == datetime(2026, 9, 24, 18, 10, tzinfo=TZ)  # cat theo cuoi khung
    run(presence.tick(t + timedelta(minutes=10)))
    assert fake_ha.calls[-1] == ("homeassistant", "turn_off", ["light.a"])
    presence.save_config({"end": "23:00"})
    run(presence.tick(t + timedelta(minutes=11)))
    assert fake_ha.calls[-1][1] == "turn_on"
    presence.save_config({"enabled": False})
    run(presence.tick(t + timedelta(minutes=12)))
    assert fake_ha.calls[-1] == ("homeassistant", "turn_off", ["light.a"])
    assert presence.status()["active"] is False


def test_presence_runtime_survives_restart(fake_ha, presence_reset):
    presence.save_config({"enabled": True, "entity_ids": ["light.a"], "gap_min": 0, "gap_max": 0})
    t = datetime(2026, 9, 24, 18, 0, tzinfo=TZ)
    run(presence.tick(t))
    presence._on.clear()  # gia lap restart: mat bo nho
    run(presence.restore())
    assert "light.a" in presence._on


# ---- tat lich / card khi thiet bi dang bat do khung gio ----

def make_range(now, before_min=10, after_min=10, ran="success"):
    on_t = (now - timedelta(minutes=before_min)).strftime("%H:%M:%S")
    off_t = (now + timedelta(minutes=after_min)).strftime("%H:%M:%S")
    on = make_schedule(time=on_t, group_id="g1")
    off = make_schedule(time=off_t, group_id="g1", action={"domain": "switch", "service": "turn_off", "service_data": {}})
    if ran:
        start = datetime.combine(now.date(), datetime.strptime(on_t, "%H:%M:%S").time(), TZ)
        if start > now:  # khung qua dem: moc Bat la hom qua
            start -= timedelta(days=1)
        crud.mark_executed(on["id"], start.isoformat(), ran)
    return on, off


def test_turn_off_running_window_when_schedule_disabled(fake_ha):
    now = datetime.now(TZ)
    on, off = make_range(now)
    targets = run(scheduler_engine.turn_off_running([on["id"]], "tắt lịch"))
    assert targets == ["switch.a"]
    assert fake_ha.calls == [("homeassistant", "turn_off", ["switch.a"])]
    # tat bang dong Tat cua cap cung phat hien duoc
    fake_ha.calls.clear()
    assert run(scheduler_engine.turn_off_running([off["id"]], "tắt lịch")) == ["switch.a"]


def test_turn_off_running_skips_when_on_was_skipped(fake_ha):
    now = datetime.now(TZ)
    on, _ = make_range(now, ran="skipped_condition")
    assert run(scheduler_engine.turn_off_running([on["id"]], "tắt lịch")) == []
    assert fake_ha.calls == []


def test_turn_off_running_skips_outside_window(fake_ha):
    now = datetime.now(TZ)
    on, _ = make_range(now, before_min=-30, after_min=60, ran=None)  # khung chua bat dau
    assert run(scheduler_engine.turn_off_running([on["id"]], "tắt lịch")) == []


def test_turn_off_running_ignores_point_schedules(fake_ha):
    s = make_schedule(time=(datetime.now(TZ) - timedelta(minutes=5)).strftime("%H:%M:%S"))
    assert run(scheduler_engine.turn_off_running([s["id"]], "tắt lịch")) == []


# ---- v0.5.35 ----

def test_timezone_follows_settings():
    s = make_schedule(time="06:00:00")
    assert crud.get_schedule(s["id"])["timezone"] == "Asia/Ho_Chi_Minh"
    crud.update_settings({"timezone": "Asia/Tokyo"})
    got = crud.get_schedule(s["id"])
    assert got["timezone"] == "Asia/Tokyo"
    now = datetime(2026, 9, 24, 5, 0, tzinfo=ZoneInfo("Asia/Tokyo"))
    assert compute_next_run(got, now, pause=None) == "2026-09-24T06:00:00+09:00"


def test_split_conditions_migration_clears_copied_off_conditions(tmp_path, monkeypatch):
    cond = [{"entity_id": "sensor.h", "state": "60", "operator": "lt"}]
    on = make_schedule(group_id="g", conditions=cond)
    off = make_schedule(group_id="g", conditions=cond, action={"domain": "switch", "service": "turn_off", "service_data": {}})
    other_off = make_schedule(group_id="h", conditions=[{"entity_id": "x", "state": "on"}],
                              action={"domain": "switch", "service": "turn_off", "service_data": {}})
    db.get_conn().execute("DELETE FROM settings WHERE key='migrated_split_conditions'")
    db.init_db()
    assert crud.get_schedule(on["id"])["conditions"] == cond
    assert crud.get_schedule(off["id"])["conditions"] == []
    assert crud.get_schedule(other_off["id"])["conditions"] != []  # dieu kien rieng cua dong Tat -> giu
    # chay lai khong xoa dieu kien dong Tat nguoi dung vua dat moi
    crud.update_schedule(off["id"], {"conditions": cond, "card_enabled": None})
    db.init_db()
    assert crud.get_schedule(off["id"])["conditions"] == cond


def test_verify_state_resends_then_reports(fake_ha):
    s = make_schedule()
    action = {"domain": "homeassistant", "service": "turn_off", "service_data": {}}
    fake_ha.states = [{"entity_id": "switch.a", "state": "on"}]
    wrong = run(scheduler_engine.verify_state(s, action, ["switch.a"], delay=0))
    assert wrong == ["switch.a"]
    assert fake_ha.calls == [("homeassistant", "turn_off", ["switch.a"])]  # gui lai 1 lan
    assert crud.list_history(1)[0]["status"] == "verify_failed"


def test_verify_state_ok_does_nothing(fake_ha):
    s = make_schedule()
    fake_ha.states = [{"entity_id": "switch.a", "state": "on"}]
    action = {"domain": "homeassistant", "service": "turn_on", "service_data": {}}
    assert run(scheduler_engine.verify_state(s, action, ["switch.a"], delay=0)) == []
    assert fake_ha.calls == []


def test_pause_turns_off_running_windows(fake_ha):
    from app.api import settings as settings_api
    from app.models import SettingsIn

    now = datetime.now(TZ)
    make_range(now)
    run(settings_api.update_settings(SettingsIn(pause_until=(now + timedelta(days=3)).isoformat())))
    assert fake_ha.calls == [("homeassistant", "turn_off", ["switch.a"])]
    # doi moc tam dung khi dang tam dung -> khong gui them lenh
    run(settings_api.update_settings(SettingsIn(pause_until=(now + timedelta(days=5)).isoformat())))
    assert len(fake_ha.calls) == 1


def test_invalid_timezone_rejected():
    from fastapi import HTTPException

    from app.api import settings as settings_api
    from app.models import SettingsIn

    with pytest.raises(HTTPException):
        run(settings_api.update_settings(SettingsIn(timezone="Asia/Ho")))


def test_delete_card_turns_off_devices(fake_ha):
    from app.api import schedules as schedules_api
    from app.models import ScheduleIds

    a = make_schedule()
    b = make_schedule(action={"domain": "switch", "service": "turn_off", "service_data": {}})
    res = run(schedules_api.delete_card(ScheduleIds(schedule_ids=[a["id"], b["id"]])))
    assert res["turned_off"] == ["switch.a"]
    assert fake_ha.calls == [("homeassistant", "turn_off", ["switch.a"])]
    assert crud.list_schedules() == []


def test_delete_row_in_running_window_turns_off(fake_ha):
    from app.api import schedules as schedules_api

    now = datetime.now(TZ)
    on, off = make_range(now)
    run(schedules_api.delete_schedule(on["id"]))
    assert fake_ha.calls == [("homeassistant", "turn_off", ["switch.a"])]


# ---- doi entity (v0.5.27-v0.5.28, gop v0.5.36) ----

def test_replace_entity_moves_everything():
    crud.upsert_alias("switch.a", "switch", {"alias": "Bơm giếng", "icon": "mdi:water-well", "favorite": True, "added": True})
    target = make_schedule()
    other = make_schedule(
        target_entities=["light.b"],
        action={"domain": "light", "service": "turn_on", "service_data": {}},
        conditions=[{"entity_id": "switch.a", "state": "off", "operator": "eq"}],
    )
    crud.save_manual_timer({"id": "t1", "entity_ids": ["switch.a"], "started_at": "x", "off_at": "2099-01-01T00:00:00+00:00"})
    crud.update_settings({"presence": {**presence.DEFAULT_CONFIG, "entity_ids": ["switch.a", "light.b"]}})

    result = crud.replace_entity("switch.a", "switch.new", "switch")

    assert result == {"schedules": 1, "conditions": 1, "manual_timers": 1, "presence": 1}
    by_id = {s["id"]: s for s in crud.list_schedules()}
    assert by_id[target["id"]]["target_entities"] == ["switch.new"]
    assert by_id[other["id"]]["conditions"] == [{"entity_id": "switch.new", "state": "off", "operator": "eq"}]
    aliases = crud.list_aliases()
    assert "switch.a" not in aliases
    assert (aliases["switch.new"]["alias"], aliases["switch.new"]["icon"], aliases["switch.new"]["favorite"]) == ("Bơm giếng", "mdi:water-well", 1)
    assert crud.list_manual_timers()[0]["entity_ids"] == ["switch.new"]
    assert crud.get_settings()["presence"]["entity_ids"] == ["switch.new", "light.b"]


def test_replace_entity_rejects_other_domain():
    s = make_schedule()
    with pytest.raises(crud.ReplaceEntityError):
        crud.replace_entity("switch.a", "climate.ac", "climate")
    assert crud.get_schedule(s["id"])["target_entities"] == ["switch.a"]


def test_replace_entity_dedupes_when_target_already_listed():
    s = make_schedule(target_entities=["switch.a", "switch.new"])
    crud.replace_entity("switch.a", "switch.new", "switch")
    assert crud.get_schedule(s["id"])["target_entities"] == ["switch.new"]


# ---- tu tat sau khi bat (auto_off) ----

from app import auto_off  # noqa: E402

UTC = ZoneInfo("UTC")


def _utc(h, m=0, day=1):
    return datetime(2026, 10, day, h, m, tzinfo=UTC)


def make_auto_off(duration="03:00:00", entity="light.ngu", **over):
    auto_off._last_sent.clear()
    s = make_schedule(
        target_entities=[entity], time=duration, trigger_type="auto_off",
        action={"domain": "homeassistant", "service": "turn_off", "service_data": {}}, **over,
    )
    # lich tao tu truoc, khong anh huong moc bat
    db.get_conn().execute("UPDATE schedules SET updated_at=? WHERE id=?", (_utc(0, day=1).isoformat(), s["id"]))
    db.get_conn().commit()
    return s


def _state(fake_ha, state, last_changed, entity="light.ngu"):
    fake_ha.states = [{"entity_id": entity, "state": state, "last_changed": last_changed.isoformat()}]


def test_auto_off_not_scheduled_by_engine(fake_ha):
    s = make_auto_off(duration="00:00:05")
    assert compute_next_run(s) is None
    run(scheduler_engine._process_schedule(crud.get_schedule(s["id"]), "run_once", None, None))
    assert fake_ha.calls == []


def test_auto_off_turns_off_after_duration(fake_ha):
    make_auto_off("00:30:00")
    _state(fake_ha, "on", _utc(10))
    assert run(auto_off.check_once(_utc(10, 5))) == []
    assert run(auto_off.check_once(_utc(10, 29))) == []
    assert run(auto_off.check_once(_utc(10, 30))) == ["light.ngu"]
    assert fake_ha.calls == [("homeassistant", "turn_off", ["light.ngu"])]
    assert crud.list_history(10)[0]["status"] == "success"


def test_auto_off_survives_backup_restart(fake_ha):
    """Den ngu bat 23:00, tat sau 3h. 01:00 VM tat de backup, 01:30 bat lai:
    HA bao last_changed=01:30 nhung moc 23:00 da luu -> van tat luc 02:00."""
    make_auto_off("03:00:00")
    _state(fake_ha, "on", _utc(23, 0, day=1))
    run(auto_off.check_once(_utc(23, 0, day=1)))
    run(auto_off.check_once(_utc(0, 59, day=2)))
    assert fake_ha.calls == []

    # VM tat: add-on khong chay. Len lai: HA chua san sang -> get_states loi
    async def boom():
        raise RuntimeError("HA starting")
    fake_ha_get = fake_ha.get_states
    from app import homeassistant
    homeassistant.get_states = boom
    run(auto_off.check_once(_utc(1, 30, day=2)))
    homeassistant.get_states = fake_ha_get
    # entity dang khoi dong: unavailable -> giu moc
    _state(fake_ha, "unavailable", _utc(1, 31, day=2))
    run(auto_off.check_once(_utc(1, 31, day=2)))
    # restore lai "on", last_changed moi
    _state(fake_ha, "on", _utc(1, 32, day=2))
    run(auto_off.check_once(_utc(1, 35, day=2)))
    assert fake_ha.calls == []
    assert run(auto_off.check_once(_utc(2, 0, day=2))) == ["light.ngu"]


def test_auto_off_overdue_after_restart_turns_off_immediately(fake_ha):
    make_auto_off("03:00:00")
    _state(fake_ha, "on", _utc(23, 0, day=1))
    run(auto_off.check_once(_utc(23, 0, day=1)))
    # may tat tu 01:00 toi 02:30 -> qua han 02:00, len lai la tat ngay
    _state(fake_ha, "on", _utc(2, 29, day=2))
    assert run(auto_off.check_once(_utc(2, 30, day=2))) == ["light.ngu"]


def test_auto_off_off_resets_and_new_rule_counts_from_creation(fake_ha):
    s = make_auto_off("00:10:00")
    _state(fake_ha, "on", _utc(8))
    run(auto_off.check_once(_utc(8, 1)))
    _state(fake_ha, "off", _utc(8, 2))
    run(auto_off.check_once(_utc(8, 2)))
    assert crud.list_auto_off_state() == {}
    # dat lich luc 9:00 cho thiet bi da bat tu 7:00 -> dem tu 9:00
    _state(fake_ha, "on", _utc(7))
    db.get_conn().execute("UPDATE schedules SET updated_at=? WHERE id=?", (_utc(9).isoformat(), s["id"]))
    db.get_conn().commit()
    assert run(auto_off.check_once(_utc(9, 1))) == []
    assert run(auto_off.check_once(_utc(9, 10))) == ["light.ngu"]


def test_auto_off_disabled_card_clears_state(fake_ha):
    s = make_auto_off("00:10:00")
    _state(fake_ha, "on", _utc(8))
    run(auto_off.check_once(_utc(8, 1)))
    crud.set_group_enabled([s["id"]], False)
    assert run(auto_off.check_once(_utc(9))) == []
    assert crud.list_auto_off_state() == {}
    assert fake_ha.calls == []


def test_auto_off_active_list(fake_ha):
    make_auto_off("00:30:00")
    _state(fake_ha, "on", _utc(10))
    run(auto_off.check_once(_utc(10, 1)))
    [a] = auto_off.list_active()
    assert a["source"] == "auto_off" and a["off_at"] == _utc(10, 30).isoformat()


# ---- khung gio binh minh/hoang hon ca 2 moc (v0.5.51) ----

def test_range_sunset_to_sunrise_ends_next_morning(monkeypatch):
    from astral import Observer
    monkeypatch.setattr(scheduler_engine, "_observer", Observer(latitude=10.8, longitude=106.6))
    on = make_schedule(time="18:00:00", trigger_type="sunset", group_id="g1")
    off = make_schedule(time="06:00:00", trigger_type="sunrise", group_id="g1",
                        action={"domain": "switch", "service": "turn_off", "service_data": {}})
    start = scheduler_engine._scheduled_dt_for_date(on, datetime(2026, 10, 1).date(), TZ)
    end = scheduler_engine._window_end(on, start, [on, off])
    assert start.hour in (17, 18) and end.date() == datetime(2026, 10, 2).date() and end.hour in (5, 6)
    assert compute_next_run(off) is not None


def test_next_run_skips_slot_just_executed():
    """Frontend reload cung giay voi moc vua chay khong duoc thay lai chinh moc do."""
    now = datetime.now(TZ).replace(microsecond=0)
    s = make_schedule(time=now.strftime("%H:%M:%S"))
    assert compute_next_run(s, now=now) == now.isoformat()  # chua chay: dung hen
    s["last_scheduled_for"] = now.isoformat()
    nxt = datetime.fromisoformat(compute_next_run(s, now=now))
    assert nxt > now and nxt.date() > now.date()
