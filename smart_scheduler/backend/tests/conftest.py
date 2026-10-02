"""Moi test dung 1 file SQLite rieng (SCHEDULER_DB_PATH) va HA gia lap -
khong can Home Assistant that. Chay: `pip install -r requirements.txt pytest`
roi `pytest` trong thu muc backend/."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    from app import db

    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    conn = getattr(db._local, "conn", None)
    if conn is not None:
        conn.close()
        db._local.conn = None
    db.init_db()
    yield
    conn = getattr(db._local, "conn", None)
    if conn is not None:
        conn.close()
        db._local.conn = None


class FakeHA:
    def __init__(self):
        self.calls: list[tuple] = []
        self.states: list[dict] = []

    async def call_service(self, domain, service, entity_ids, data):
        self.calls.append((domain, service, list(entity_ids)))

    async def get_states(self):
        return self.states


@pytest.fixture
def fake_ha(monkeypatch):
    from app import homeassistant

    fake = FakeHA()
    monkeypatch.setattr(homeassistant, "call_service", fake.call_service)
    monkeypatch.setattr(homeassistant, "get_states", fake.get_states)
    return fake


@pytest.fixture(autouse=True)
def silent_ws(monkeypatch):
    from app.ws import manager

    async def broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(manager, "broadcast", broadcast)


@pytest.fixture
def presence_reset(monkeypatch, fake_ha):
    from app import presence, homeassistant
    for name in ("_on", "_owned", "_cooldown", "_retry", "_failures", "_visits", "_warnings"):
        monkeypatch.setattr(presence, name, {})
    for name in ("_shutdown", "_window_entities"):
        monkeypatch.setattr(presence, name, set())
    for name in ("_next_start_at", "_last_entity", "_last_status", "_last_runtime", "_planned"):
        monkeypatch.setattr(presence, name, None)
    for name in ("_window_id", "_closed_window_id"):
        monkeypatch.setattr(presence, name, "")
    monkeypatch.setattr(presence, "_used_minutes", 0.0)
    monkeypatch.setattr(presence, "_phase", "disabled")
    monkeypatch.setattr(presence.random, "uniform", lambda a, b: a)
    fake_ha.states = [{"entity_id": e, "state": "off", "attributes": {}, "context": {"id": "initial"}}
                      for e in ("light.a", "light.b", "switch.c")]
    fake_ha.unreachable = set()
    fake_ha.command_data = []

    async def call_service(domain, service, entity_ids, data):
        fake_ha.calls.append((domain, service, list(entity_ids)))
        fake_ha.command_data.append(dict(data))
        if set(entity_ids) & fake_ha.unreachable:
            raise ConnectionError("offline")
        changed = []
        for e in entity_ids:
            state = next(s for s in fake_ha.states if s["entity_id"] == e)
            state["state"] = "on" if service == "turn_on" else "off"
            state["context"] = {"id": str(len(fake_ha.calls))}
            changed.append(dict(state))
        return changed
    monkeypatch.setattr(homeassistant, "call_service", call_service)
    return fake_ha
