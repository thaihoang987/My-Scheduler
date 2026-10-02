"""v0.5.78: moc Tat cua khung gio qua dem chay vao NGAY HOM SAU cua moc Bat."""
from datetime import datetime

from app import crud, scheduler_engine
from tests.test_backend import TZ, make_schedule

OFF = {"domain": "switch", "service": "turn_off", "service_data": {}}


def make_pair(on_t, off_t, days, gid="g1", domain="switch", **over):
    on = make_schedule(time=on_t, days=days, group_id=gid, target_entities=[f"{domain}.a"],
                       action={"domain": domain, "service": "turn_on", "service_data": {}}, **over)
    off = make_schedule(time=off_t, days=days, group_id=gid, target_entities=[f"{domain}.a"],
                        action={"domain": domain, "service": "turn_off", "service_data": {}}, **over)
    return on, off


def test_overnight_off_days_shift_to_next_day():
    on, off = make_pair("22:00:00", "02:00:00", [0])  # chi T2
    assert scheduler_engine.normalize_range_days() == 1
    assert crud.get_schedule(off["id"])["days"] == [1]  # T3
    assert crud.get_schedule(on["id"])["days"] == [0]
    assert scheduler_engine.normalize_range_days() == 0  # idempotent


def test_overnight_weekdays_wrap_sunday_to_monday_and_dates_shift():
    on, off = make_pair("23:30:00", "02:30:00", [4, 6], start_date="2026-10-01", end_date="2026-10-31")
    scheduler_engine.normalize_range_days()
    got = crud.get_schedule(off["id"])
    assert got["days"] == [0, 5]
    assert (got["start_date"], got["end_date"]) == ("2026-10-02", "2026-11-01")


def test_same_day_range_and_daily_overnight_unchanged():
    _, off1 = make_pair("06:00:00", "10:00:00", [4], gid="g1")
    _, off2 = make_pair("16:00:00", "02:05:00", [0, 1, 2, 3, 4, 5, 6], gid="g2")
    assert scheduler_engine.normalize_range_days() == 0
    assert crud.get_schedule(off1["id"])["days"] == [4]


def test_any_domain_range_is_fixed():
    for i, domain in enumerate(("climate", "cover", "light", "media_player")):
        _, off = make_pair("21:00:00", "05:00:00", [2], gid=f"g{i}", domain=domain)
        scheduler_engine.normalize_range_days()
        assert crud.get_schedule(off["id"])["days"] == [3], domain


def test_editing_back_to_unshifted_days_is_fixed_again():
    on, off = make_pair("22:00:00", "02:00:00", [0])
    scheduler_engine.normalize_range_days()
    crud.update_schedule(off["id"], {"days": [0]})  # editor gui lai days cua moc Bat
    scheduler_engine.normalize_range_days({"g1"})
    assert crud.get_schedule(off["id"])["days"] == [1]


def test_monday_only_window_ends_tuesday():
    on, off = make_pair("22:00:00", "02:00:00", [0])
    scheduler_engine.normalize_range_days()
    monday_22 = datetime(2026, 9, 28, 22, 0, tzinfo=TZ)
    end = scheduler_engine._window_end(crud.get_schedule(on["id"]), monday_22, crud.list_schedules())
    assert end == datetime(2026, 9, 29, 2, 0, tzinfo=TZ)
