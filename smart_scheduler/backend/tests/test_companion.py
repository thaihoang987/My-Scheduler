"""Thiet bi mo cung (companion.py): 1 bom chay theo ca nhom van."""
import asyncio

import pytest
from fastapi import HTTPException

from app import companion, crud, scheduler_engine
from app.api import schedules as schedules_api
from app.scheduler_engine import compute_next_run

VALVES = ["switch.van_1", "switch.van_2", "valve.van_3"]
PUMP = "switch.bom"
DELAY = 0.05


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def fresh_companion():
    companion.reset()
    yield
    companion.reset()


@pytest.fixture
def ha(fake_ha, monkeypatch):
    """HA gia lap: lenh bat/tat doi state that va ban su kien nhu HA."""
    from app import homeassistant

    fake_ha.states = []
    fake_ha.slow = {}  # service -> asyncio.Event phai set moi chay xong

    def state_of(eid):
        return next((s for s in fake_ha.states if s["entity_id"] == eid), None)

    def put(eid, state):
        old = state_of(eid)
        new = {"entity_id": eid, "state": state, "attributes": {}}
        fake_ha.states = [s for s in fake_ha.states if s["entity_id"] != eid] + [new]
        return old, new

    async def set_state(eid, state):
        old, new = put(eid, state)
        await companion.on_change(eid, old, new)

    async def call_service(domain, service, entity_ids, data):
        if service in fake_ha.slow:
            await fake_ha.slow[service].wait()
        fake_ha.calls.append((domain, service, list(entity_ids)))
        on = service in ("turn_on", "open_valve")
        for eid in entity_ids:
            await set_state(eid, ("open" if on else "closed") if domain == "valve" else ("on" if on else "off"))

    fake_ha.put = put
    fake_ha.set = set_state
    monkeypatch.setattr(homeassistant, "call_service", call_service)
    return fake_ha


def make_rule(targets=None, pump=PUMP, delay="00:00:00.05", **over):
    data = {
        "name": "Tuoi cay",
        "target_entities": targets or VALVES,
        "action": {"domain": "homeassistant", "service": "turn_on", "service_data": {"companion": pump}},
        "time": delay,
        "timezone": "Asia/Ho_Chi_Minh",
        "card_enabled": None,
        "trigger_type": "companion",
        "days": [0, 1, 2, 3, 4, 5, 6],
    }
    data.update(over)
    return crud.create_schedule(data)


async def settle(seconds=0.0):
    await asyncio.sleep(seconds)
    for _ in range(5):
        await asyncio.sleep(0)


async def connect(ha, pump="off", valves=("off", "off", "closed")):
    ha.put(PUMP, pump)
    for eid, state in zip(VALVES, valves):
        ha.put(eid, state)
    await companion.sync(states=list(ha.states))
    await settle()


def services(ha):
    return [c[1] for c in ha.calls]


def test_delay_seconds():
    assert companion.delay_seconds("00:00:02") == 2
    assert companion.delay_seconds("00:01:30") == 90
    assert companion.delay_seconds("2") == 2
    assert companion.delay_seconds("00:00:00.5") == 0.5


def test_not_scheduled_by_engine(ha):
    s = make_rule()
    assert compute_next_run(s) is None
    run(scheduler_engine._process_schedule(crud.get_schedule(s["id"]), "run_once", None, None))
    assert ha.calls == []


def test_valve_on_turns_pump_on(ha):
    make_rule()

    async def scenario():
        await connect(ha)
        await ha.set("switch.van_1", "on")
        await settle()

    run(scenario())
    assert ha.calls == [("homeassistant", "turn_on", [PUMP])]
    assert crud.list_history(5)[0]["status"] == "success"


def test_pump_already_on_is_left_alone(ha):
    make_rule()

    async def scenario():
        await connect(ha, pump="on")
        await ha.set("valve.van_3", "open")
        await settle()

    run(scenario())
    assert ha.calls == []


def test_all_off_turns_pump_off_after_delay(ha):
    make_rule()

    async def scenario():
        await connect(ha, pump="on", valves=("on", "off", "closed"))
        await ha.set("switch.van_1", "off")
        await settle()
        assert ha.calls == []  # dang cho het do tre
        await settle(DELAY * 2)

    run(scenario())
    assert ha.calls == [("homeassistant", "turn_off", [PUMP])]


def test_next_valve_within_delay_keeps_pump_running(ha):
    """Van 1 dong, van 2 mo sau chua toi do tre: bom khong tat."""
    make_rule(delay="00:00:00.2")

    async def scenario():
        await connect(ha, pump="on", valves=("on", "off", "closed"))
        await ha.set("switch.van_1", "off")
        await settle(0.05)
        await ha.set("switch.van_2", "on")
        await settle(0.4)

    run(scenario())
    assert ha.calls == []


def test_ten_valves_in_a_row(ha):
    """10 van mo lan luot, cach nhau ngan hon do tre: bat 1 lan, tat 1 lan."""
    valves = [f"switch.van_{i}" for i in range(10)]
    make_rule(targets=valves, delay="00:00:00.2")

    async def scenario():
        ha.put(PUMP, "off")
        for v in valves:
            ha.put(v, "off")
        await companion.sync(states=list(ha.states))
        for v in valves:
            await ha.set(v, "on")
            await settle(0.02)
            await ha.set(v, "off")
            await settle(0.05)
        await settle(0.4)

    run(scenario())
    assert services(ha) == ["turn_on", "turn_off"]


def test_overlapping_valves(ha):
    make_rule()

    async def scenario():
        await connect(ha)
        await ha.set("switch.van_1", "on")
        await ha.set("switch.van_2", "on")
        await ha.set("switch.van_1", "off")
        await settle(DELAY * 3)
        assert services(ha) == ["turn_on"]
        await ha.set("switch.van_2", "off")
        await settle(DELAY * 3)

    run(scenario())
    assert services(ha) == ["turn_on", "turn_off"]


def test_valve_opens_while_turn_off_in_flight(ha):
    """Lenh tat bom dang gui thi van mo lai: bom phai bat lai, cuoi cung dang bat."""
    make_rule()

    async def scenario():
        await connect(ha, pump="on", valves=("on", "off", "closed"))
        ha.slow["turn_off"] = asyncio.Event()
        await ha.set("switch.van_1", "off")
        await settle(DELAY * 3)  # lenh tat dang treo, bom van bao on
        await ha.set("switch.van_2", "on")
        ha.slow["turn_off"].set()
        await settle()

    run(scenario())
    assert services(ha) == ["turn_off", "turn_on"]
    assert next(s for s in ha.states if s["entity_id"] == PUMP)["state"] == "on"


def test_valves_close_while_turn_on_in_flight(ha):
    make_rule()

    async def scenario():
        await connect(ha)
        ha.slow["turn_on"] = asyncio.Event()
        await ha.set("switch.van_1", "on")
        await settle()
        await ha.set("switch.van_1", "off")  # bom van bao off
        ha.slow["turn_on"].set()
        await settle(DELAY * 3)

    run(scenario())
    assert services(ha) == ["turn_on", "turn_off"]


def test_many_valves_at_once_send_one_turn_on(ha):
    make_rule()

    async def scenario():
        await connect(ha)
        ha.slow["turn_on"] = asyncio.Event()
        for v in VALVES:
            await ha.set(v, "on" if v.startswith("switch") else "open")
        ha.slow["turn_on"].set()
        await settle()

    run(scenario())
    assert services(ha) == ["turn_on"]


def test_unavailable_valve_counts_as_closed(ha):
    make_rule()

    async def scenario():
        await connect(ha, pump="on", valves=("on", "off", "closed"))
        await ha.set("switch.van_1", "unavailable")
        await settle(DELAY * 3)

    run(scenario())
    assert services(ha) == ["turn_off"]


def test_pump_turned_off_manually_during_delay(ha):
    make_rule()

    async def scenario():
        await connect(ha, pump="on", valves=("on", "off", "closed"))
        await ha.set("switch.van_1", "off")
        await ha.set(PUMP, "off")
        await settle(DELAY * 3)

    run(scenario())
    assert ha.calls == []


def test_disabled_rule_does_nothing(ha):
    make_rule(enabled=False)

    async def scenario():
        await connect(ha)
        await ha.set("switch.van_1", "on")
        await settle()

    run(scenario())
    assert ha.calls == []


def test_card_switch_off_does_nothing(ha):
    s = make_rule()
    crud.set_group_enabled([s["id"]], False)

    async def scenario():
        await connect(ha)
        await ha.set("switch.van_1", "on")
        await settle()

    run(scenario())
    assert ha.calls == []


def test_reconnect_turns_pump_on_for_open_valve(ha):
    make_rule()
    run(connect(ha, pump="off", valves=("off", "on", "closed")))
    assert services(ha) == ["turn_on"]


def test_reconnect_turns_off_stale_pump(ha):
    """HA khoi dong lai dung luc dang cho tat: van da dong het, bom con chay."""
    make_rule()

    async def scenario():
        await connect(ha, pump="on")
        await settle(DELAY * 3)

    run(scenario())
    assert services(ha) == ["turn_off"]


def test_editing_another_rule_does_not_touch_this_pump(ha):
    """Sua lich khac khong duoc tat bom dang chay tay (khong co van nao mo)."""
    make_rule()

    async def scenario():
        await connect(ha, pump="off")
        ha.put(PUMP, "on")  # nguoi dung bat tay de rua ong
        await companion.on_change(PUMP, None, {"state": "on"})
        make_rule(targets=["switch.van_9"], pump="switch.bom_2")
        await companion.sync()
        await settle(DELAY * 3)

    run(scenario())
    assert PUMP not in [c[2][0] for c in ha.calls]


def test_deleting_rule_stops_reacting(ha):
    s = make_rule()

    async def scenario():
        await connect(ha)
        crud.delete_schedule(s["id"])
        await companion.sync()
        await ha.set("switch.van_1", "on")
        await settle()

    run(scenario())
    assert ha.calls == []


def test_two_rules_same_pump_are_merged(ha):
    """2 nhom dung chung 1 bom: nhom A tat het khong duoc tat bom khi nhom B dang chay."""
    make_rule(targets=["switch.van_1"])
    make_rule(targets=["switch.van_2"], name="Nhom B")

    async def scenario():
        await connect(ha, pump="on", valves=("on", "on", "closed"))
        await ha.set("switch.van_1", "off")
        await settle(DELAY * 3)
        assert ha.calls == []
        await ha.set("switch.van_2", "off")
        await settle(DELAY * 3)

    run(scenario())
    assert services(ha) == ["turn_off"]


def test_valve_entity_as_companion(ha):
    make_rule(pump="valve.van_tong")

    async def scenario():
        ha.put("valve.van_tong", "closed")
        await connect(ha)
        await ha.set("switch.van_1", "on")
        await settle()
        await ha.set("switch.van_1", "off")
        await settle(DELAY * 3)

    run(scenario())
    assert services(ha) == ["open_valve", "close_valve"]


def test_failed_call_is_logged_in_history(ha, monkeypatch):
    from app import homeassistant

    make_rule()

    async def failing(*_args):
        raise ConnectionError("offline")

    async def scenario():
        await connect(ha)
        monkeypatch.setattr(homeassistant, "call_service", failing)
        await ha.set("switch.van_1", "on")
        await settle()

    run(scenario())
    assert crud.list_history(5)[0]["status"] == "error"


def test_api_validation():
    def payload(targets, pump):
        return {"trigger_type": "companion", "target_entities": targets,
                "action": {"domain": "homeassistant", "service": "turn_on", "service_data": {"companion": pump}}}

    with pytest.raises(HTTPException):
        schedules_api._check_companion(payload(VALVES, None))
    with pytest.raises(HTTPException):
        schedules_api._check_companion(payload([PUMP, "switch.van_1"], PUMP))
    with pytest.raises(HTTPException):
        schedules_api._check_companion(payload([], PUMP))
    schedules_api._check_companion(payload(VALVES, PUMP))
