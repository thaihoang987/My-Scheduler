import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

from app import config, crud, main


@pytest.mark.parametrize("reply", [ConnectionError("HA starting"), {}, {"time_zone": ""}, {"time_zone": "Invalid/Zone"}])
def test_failed_timezone_load_preserves_fallback(monkeypatch, reply):
    monkeypatch.setattr(config, "HA_TIMEZONE", None)
    before = crud.settings_timezone()
    api = AsyncMock(side_effect=reply) if isinstance(reply, Exception) else AsyncMock(return_value=reply)
    monkeypatch.setattr(main.homeassistant, "get_core_config", api)
    assert asyncio.run(main._load_ha_timezone()) is False
    assert config.HA_TIMEZONE is None
    assert crud.settings_timezone() == before


def test_retry_recovers_and_stops_after_valid_timezone(monkeypatch):
    monkeypatch.setattr(config, "HA_TIMEZONE", None)
    api = AsyncMock(side_effect=[ConnectionError("HA starting"), {}, {"time_zone": "Europe/Berlin"}])
    monkeypatch.setattr(main.homeassistant, "get_core_config", api)
    sleep = AsyncMock()
    monkeypatch.setattr(main.asyncio, "sleep", sleep)
    normalize = Mock()
    monkeypatch.setattr(main, "normalize_range_days", normalize)
    broadcast = AsyncMock()
    monkeypatch.setattr(main.manager, "broadcast", broadcast)
    asyncio.run(main._retry_ha_timezone())
    assert api.await_count == 3
    assert [c.args for c in sleep.await_args_list] == [(30,), (30,), (30,)]
    assert config.HA_TIMEZONE == "Europe/Berlin"
    assert crud.settings_timezone() == "Europe/Berlin"
    normalize.assert_called_once_with()
    broadcast.assert_awaited_once_with("schedule_updated", {"timezone_synced": True})


def test_successful_load_updates_existing_schedule_timezone(monkeypatch):
    monkeypatch.setattr(config, "HA_TIMEZONE", "UTC")
    schedule = crud.create_schedule({"name": "test", "time": "08:00", "action": {"domain": "switch", "service": "turn_on"}})
    monkeypatch.setattr(main.homeassistant, "get_core_config", AsyncMock(return_value={"time_zone": "Asia/Bangkok"}))
    assert asyncio.run(main._load_ha_timezone()) is True
    assert crud.get_schedule(schedule["id"])["timezone"] == "Asia/Bangkok"


@pytest.mark.parametrize("ready", [True, False])
def test_lifespan_does_not_wait_for_retry_and_cancels_on_shutdown(monkeypatch, ready):
    async def scenario():
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def retry():
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        async def idle():
            await asyncio.Event().wait()

        monkeypatch.setattr(main, "_load_ha_timezone", AsyncMock(return_value=ready))
        monkeypatch.setattr(main, "_retry_ha_timezone", retry)
        monkeypatch.setattr(main, "normalize_range_days", Mock(return_value=0))
        monkeypatch.setattr(main, "_reset_devices_on_startup", AsyncMock())
        monkeypatch.setattr(main.manual_timer, "restore_active", AsyncMock())
        monkeypatch.setattr(main, "scheduler_loop", idle)
        monkeypatch.setattr(main.presence, "presence_loop", idle)
        monkeypatch.setattr(main.auto_off, "auto_off_loop", idle)
        async with main.lifespan(main.app):
            if not ready:
                await asyncio.wait_for(started.wait(), timeout=1)
            assert not main._scheduler_task.done()
        assert started.is_set() is not ready
        assert cancelled.is_set() is not ready
        assert main._scheduler_task.cancelled()
        assert main._presence_task.cancelled()
        assert main._auto_off_task.cancelled()

    asyncio.run(scenario())
