import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from app import crud, presence, scheduler_engine, homeassistant

TZ = ZoneInfo("Asia/Ho_Chi_Minh")
START = datetime(2026, 9, 24, 18, tzinfo=TZ)


def run(awaitable):
    return asyncio.run(awaitable)


def configure(**kw):
    return presence.save_config({"enabled": True, "entity_ids": ["light.a", "light.b", "switch.c"],
                                 "gap_min": 0, "gap_max": 0, "end": "18:20", **kw})


def test_end_turns_off_every_selected_device_including_manual_and_switch(presence_reset):
    ha = presence_reset
    configure()
    for s in ha.states:
        s["state"] = "on"  # all manually activated; simulation owns none
    run(presence.tick(START))
    assert not ha.calls
    run(presence.tick(START + timedelta(minutes=20)))
    assert {call[2][0] for call in ha.calls if call[1] == "turn_off"} == {"light.a", "light.b", "switch.c"}
    assert not presence.status()["pending_off"]
    count = len(ha.calls)
    run(presence.tick(START + timedelta(minutes=21)))
    assert len(ha.calls) == count  # do not continually override manual actions outside window


def test_end_retries_offline_and_restores_cleanup_queue(presence_reset):
    ha = presence_reset
    configure()
    for s in ha.states:
        s["state"] = "on"
    ha.unreachable.add("switch.c")
    run(presence.tick(START))
    end = START + timedelta(minutes=20)
    run(presence.tick(end))
    assert presence._shutdown == {"switch.c"}
    calls = len(ha.calls)
    run(presence.tick(end + timedelta(seconds=5)))
    assert len(ha.calls) == calls
    presence._shutdown.clear()
    run(presence.restore())
    assert presence._shutdown == {"switch.c"}
    ha.unreachable.clear()
    run(presence.tick(end + timedelta(seconds=30)))
    assert not presence._shutdown
    assert ha.states[-1]["state"] == "off"


def test_manual_override_respected_until_window_end(presence_reset):
    ha = presence_reset
    configure(entity_ids=["light.a"])
    run(presence.tick(START))
    ha.states[0]["context"] = {"id": "manual-change"}
    run(presence.tick(START + timedelta(minutes=1)))
    assert not presence._on
    assert len(ha.calls) == 1
    run(presence.tick(START + timedelta(minutes=20)))
    assert ha.calls[-1][1] == "turn_off"


def test_budget_reserves_concurrent_minutes_and_survives_restart(presence_reset):
    configure(max_concurrent=2, on_min=10, on_max=10, max_total_minutes=15)
    run(presence.tick(START))
    run(presence.tick(START + timedelta(seconds=5)))
    assert len(presence._on) == 2
    reserved = sum((off - datetime.fromisoformat(presence._owned[e]["started_at"])).total_seconds() / 60 for e, off in presence._on.items())
    assert reserved == 15
    run(presence.restore())
    assert len(presence._on) == 2
    run(presence.tick(START + timedelta(minutes=11)))
    assert not presence._on
    assert presence._used_minutes == 15
    assert presence.status()["phase"] == "budget_exhausted"


def test_existing_schedule_skipped_but_still_off_at_end(presence_reset):
    configure(entity_ids=["light.a"])
    crud.create_schedule({"name": "scheduled", "target_entities": ["light.a"], "trigger_type": "time", "time": "19:00:00", "days": list(range(7)), "action": {"domain": "light", "service": "turn_on"}, "enabled": True})
    presence_reset.states[0]["state"] = "on"
    run(presence.tick(START))
    assert not presence_reset.calls
    run(presence.tick(START + timedelta(minutes=20)))
    assert presence_reset.calls[-1][1] == "turn_off"


def test_expired_trip_cleans_whole_list_without_prior_activation(presence_reset):
    configure(until="2026-09-24")
    for s in presence_reset.states:
        s["state"] = "on"
    run(presence.tick(START + timedelta(days=1)))
    assert len(presence_reset.calls) == 3
    assert presence.status()["phase"] == "expired"


def test_stop_all_and_no_further_activation(presence_reset):
    configure()
    for s in presence_reset.states:
        s["state"] = "on"
    run(presence.stop())
    assert len(presence_reset.calls) == 3
    assert not presence.get_config()["enabled"]
    run(presence.tick(START))
    assert len(presence_reset.calls) == 3


def test_preview_is_read_only_and_obeys_cap_cooldown(presence_reset):
    configure(entity_ids=["light.a"], on_min=5, on_max=5, cooldown_minutes=10, max_total_minutes=12)
    before = crud.get_settings()
    plan = run(presence.preview({}, START))
    assert not presence_reset.calls
    assert crud.get_settings() == before
    assert plan["total_minutes"] <= 12
    for a, b in zip(plan["events"], plan["events"][1:]):
        assert datetime.fromisoformat(b["on_at"]) - datetime.fromisoformat(a["off_at"]) >= timedelta(minutes=10)


def test_sunset_and_inclusive_until(monkeypatch, presence_reset):
    configure(start_mode="sunset", end="01:00", until="2026-09-24")
    monkeypatch.setattr(scheduler_engine, "_sun_time_for_date", lambda event, day, tz: datetime.combine(day, START.time(), tz))
    cfg = presence.get_config()
    assert presence.window_end(cfg, START) == datetime(2026, 9, 25, tzinfo=TZ)
    assert presence.window_end(cfg, datetime(2026, 9, 25, tzinfo=TZ)) is None


def test_dimmable_lights_receive_brightness_only_on_activation(presence_reset):
    configure(entity_ids=["light.a"], brightness_pct=25)
    presence_reset.states[0]["attributes"]["supported_color_modes"] = ["brightness"]
    run(presence.tick(START))
    assert presence_reset.calls[-1][0] == "light"
    assert presence_reset.command_data[-1] == {"brightness_pct": 25}
    run(presence.tick(START + timedelta(minutes=20)))
    assert presence_reset.command_data[-1] == {}


def test_end_sends_off_even_to_devices_reported_off(presence_reset):
    configure(gap_min=30, gap_max=30)
    run(presence.tick(START))
    assert not presence_reset.calls
    run(presence.tick(START + timedelta(minutes=20)))
    assert len(presence_reset.calls) == 3
    assert all(c[1] == "turn_off" for c in presence_reset.calls)


def test_stop_attempts_all_off_even_when_state_read_fails(monkeypatch, presence_reset):
    configure()
    async def failed_states():
        raise ConnectionError("state API down")
    monkeypatch.setattr(homeassistant, "get_states", failed_states)
    run(presence.stop())
    assert len(presence_reset.calls) == 3
    assert all(c[1] == "turn_off" for c in presence_reset.calls)


def test_future_activation_is_stable_restored_and_used(presence_reset):
    configure(gap_min=2, gap_max=2)
    run(presence.tick(START))
    planned = presence.status()["planned"][0]
    assert not presence_reset.calls
    run(presence.tick(START + timedelta(seconds=5)))
    assert presence.status()["planned"][0] == planned
    run(presence.restore())
    assert presence.status()["planned"][0] == planned
    run(presence.tick(START + timedelta(minutes=2)))
    assert presence_reset.calls[-1][2] == [planned["entity_id"]]
    assert presence._on[planned["entity_id"]].isoformat() == planned["off_at"]
    assert not presence.status()["planned"]


def test_future_activation_skipped_if_manually_turned_on(presence_reset):
    configure(gap_min=2, gap_max=2)
    run(presence.tick(START))
    eid = presence.status()["planned"][0]["entity_id"]
    next(s for s in presence_reset.states if s["entity_id"] == eid)["state"] = "on"
    run(presence.tick(START + timedelta(minutes=2)))
    assert all(eid not in c[2] for c in presence_reset.calls)


def test_api_preview_and_invalid_update_are_read_only(presence_reset):
    from fastapi import HTTPException
    from app.api.presence import PresenceIn, preview_presence, update_presence
    configure()
    before = crud.get_settings()
    run(preview_presence(PresenceIn(on_min=6)))
    assert crud.get_settings() == before
    assert not presence_reset.calls
    with pytest.raises(HTTPException) as error:
        run(update_presence(PresenceIn(on_min=100, on_max=5)))
    assert error.value.status_code == 400
    assert crud.get_settings() == before


def test_shutdown_waits_for_confirmed_state_not_service_ack(monkeypatch, presence_reset):
    configure()
    for s in presence_reset.states:
        s["state"] = "on"
    async def ack_only(domain, service, ids, data):
        presence_reset.calls.append((domain, service, ids))
        return []
    monkeypatch.setattr(homeassistant, "call_service", ack_only)
    run(presence.stop())
    assert presence._shutdown == {"light.a", "light.b", "switch.c"}
    assert presence.status()["phase"] == "stopping"
    for s in presence_reset.states:
        s["state"] = "off"
    run(presence.tick())
    assert not presence._shutdown


@pytest.mark.parametrize("patch", [{"on_min": 20, "on_max": 5}, {"max_concurrent": 3}, {"max_total_minutes": 0}, {"until": "bad-date"}, {"start_mode": "bad"}])
def test_invalid_config_not_saved(patch, presence_reset):
    before = crud.get_settings()
    with pytest.raises(ValueError):
        presence.save_config(patch)
    assert crud.get_settings() == before
