"""Nguon tac dong len thiet bi (sources.py): ghep lenh cua app voi su kien
state_changed, doan nguon ngoai app theo context HA, ghi state_events + Nhat ky,
gan nguon vao lich su recorder."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app import crud, homeassistant, sources


def run(coro):
    return asyncio.run(coro)


def _iso(delta_seconds: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_seconds)).isoformat()


def _st(state, ctx=None, name="Den"):
    return {"state": state, "last_changed": _iso(), "context": ctx or {}, "attributes": {"friendly_name": name}}


def test_app_command_is_matched_to_state_change():
    with sources.acting_as("schedule", "Tuoi cay"):
        sources.note_command(["switch.a"], "turn_on")
    assert sources.classify("switch.a", "on", {"id": "c1"}) == ("schedule", "Tuoi cay")
    # 1 lenh chi giai thich 1 lan doi trang thai
    assert sources.classify("switch.a", "off", {"id": "c2"}) == ("device", None)


def test_direction_must_agree_with_command():
    with sources.acting_as("forced", "Bat cuong che"):
        sources.note_command(["switch.a"], "turn_on")
    # thiet bi tat ngay sau lenh bat: khong phai do lenh bat
    assert sources.classify("switch.a", "off", {"id": "c1"})[0] == "device"
    assert sources.classify("switch.a", "on", {"id": "c2"}) == ("forced", "Bat cuong che")


def test_unmarked_command_counts_as_app():
    sources.note_command(["switch.a"], "turn_off")
    assert sources.classify("switch.a", "off", {"id": "c1"}) == ("app", None)


def test_external_sources_follow_ha_context():
    assert sources.classify("switch.a", "on", {"id": "1", "user_id": "u1"}, "Hoang") == ("user", "Hoang")
    assert sources.classify("switch.a", "on", {"id": "2", "parent_id": "p"}) == ("automation", None)
    assert sources.classify("switch.a", "on", {"id": "3"}) == ("device", None)
    assert sources.classify("switch.a", "unavailable", {"id": "4", "user_id": "u1"}, "Hoang")[0] == "user"


def test_same_context_inherits_source():
    with sources.acting_as("schedule", "Lich"):
        sources.note_command(["cover.a"], "open_cover")
    assert sources.classify("cover.a", "opening", {"id": "ctx"}) == ("schedule", "Lich")
    # trang thai "open" den sau, cung nguyen nhan -> van la lich
    assert sources.classify("cover.a", "open", {"id": "ctx"}) == ("schedule", "Lich")


def test_acting_as_restores_previous_source():
    with sources.acting_as("forced", "A"):
        with sources.acting_as("schedule", "B"):
            assert sources.current() == ("schedule", "B")
        assert sources.current() == ("forced", "A")
    assert sources.current() == ("app", None)


def test_record_stores_event_and_logs_only_external(monkeypatch):
    async def users():
        return {"u1": "Hoang"}

    monkeypatch.setattr(homeassistant, "get_users", users)
    sources.track(["light.a"])
    run(sources.record("light.a", {"state": "off"}, _st("on", {"id": "x", "user_id": "u1"})))
    with sources.acting_as("auto_off", "Tu tat"):
        sources.note_command(["light.a"], "turn_off")
    run(sources.record("light.a", {"state": "on"}, _st("off", {"id": "y"})))

    events = crud.list_state_events(["light.a"], "2000-01-01")
    assert [(e["state"], e["source"], e["label"]) for e in events] == [("on", "user", "Hoang"), ("off", "auto_off", "Tu tat")]
    history = crud.list_history()
    assert len(history) == 1  # lenh cua app da co Nhat ky rieng
    assert "Hoang" in history[0]["message"] and history[0]["manual"]


def test_record_ignores_untracked_and_attribute_only_changes():
    run(sources.record("light.zzz", {"state": "off"}, _st("on")))
    sources.track(["light.a"])
    run(sources.record("light.a", {"state": "on"}, _st("on")))
    run(sources.record("scene.x", {"state": "a"}, _st("b")))
    assert crud.list_state_events(["light.zzz", "light.a", "scene.x"], "2000-01-01") == []


def test_unavailable_is_recorded_but_not_logged():
    sources.track(["light.a"])
    run(sources.record("light.a", {"state": "on"}, _st("unavailable")))
    assert len(crud.list_state_events(["light.a"], "2000-01-01")) == 1
    assert crud.list_history() == []


def test_schedule_targets_are_tracked():
    crud.create_schedule({
        "name": "L", "time": "10:00:00", "days": [0, 1, 2, 3, 4, 5, 6],
        "action": {"domain": "homeassistant", "service": "turn_on"}, "target_entities": ["light.sched"],
    })
    assert "light.sched" in sources.tracked()


def test_annotate_matches_points_and_first_point():
    t0 = datetime.now(timezone.utc) - timedelta(hours=2)
    t1 = t0 + timedelta(hours=1)
    crud.add_state_event("light.a", (t0 - timedelta(hours=5)).isoformat(), "off", "on", "schedule", "Lich")
    crud.add_state_event("light.a", t1.isoformat(), "on", "off", "user", "Hoang")
    series = {"light.a": [
        {"s": "off", "t": t0.isoformat()},  # diem dau doan: lay su kien gan nhat cung trang thai
        {"s": "on", "t": (t1 + timedelta(seconds=1)).isoformat()},  # lech 1 giay van ghep
        {"s": "off", "t": (t1 + timedelta(minutes=30)).isoformat()},  # khong co su kien -> khong ro
    ]}
    out = sources.annotate(series)["light.a"]
    assert (out[0]["src"], out[0]["by"]) == ("schedule", "Lich")
    assert (out[1]["src"], out[1]["by"]) == ("user", "Hoang")
    assert "src" not in out[2]


def test_prune_removes_old_events():
    crud.add_state_event("light.a", (datetime.now(timezone.utc) - timedelta(days=40)).isoformat(), "on", "off", "device", None)
    crud.add_state_event("light.a", _iso(), "off", "on", "device", None)
    assert crud.prune_state_events(35) == 1
    assert len(crud.list_state_events(["light.a"], "2000-01-01")) == 1
