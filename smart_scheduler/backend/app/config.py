"""Doc option cua add-on (/data/options.json, do Supervisor tu ghi tu config.yaml
schema/options) + bien moi truong chuan cua HA add-on (SUPERVISOR_TOKEN)."""
import json
import os
from pathlib import Path

DB_PATH = os.environ.get("SCHEDULER_DB_PATH", "/data/scheduler.db")
OPTIONS_PATH = os.environ.get("SCHEDULER_OPTIONS_PATH", "/data/options.json")

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
CORE_API_BASE = "http://supervisor/core/api"
CORE_WS_URL = "ws://supervisor/core/websocket"
DIRECT_CORE_API_BASE = "http://homeassistant:8123/api"


def load_options() -> dict:
    defaults = {"ha_token": "", "ha_base_url": ""}
    path = Path(OPTIONS_PATH)
    if not path.exists():
        return defaults
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return defaults
    defaults.update({k: v for k, v in data.items() if v is not None})
    return defaults


OPTIONS = load_options()
# Mui gio MAC DINH (khi nguoi dung chua chon trong Cai dat cua app): option
# cu "timezone" neu options.json con giu (ban < 0.5.40), roi TZ do Supervisor
# truyen vao (= mui gio Home Assistant), cuoi cung Asia/Ho_Chi_Minh.
DEFAULT_TIMEZONE = OPTIONS.get("timezone") or os.environ.get("TZ") or "Asia/Ho_Chi_Minh"

# Du phong neu Supervisor that su khong cap token. Binh thuong run.sh chay
# qua /usr/bin/with-contenv de nhan bien do S6/Supervisor inject, khi do
# proxy noi bo luon duoc uu tien va khong can nguoi dung cau hinh gi.
HA_TOKEN = (OPTIONS.get("ha_token") or "").strip()
HA_BASE_URL_OVERRIDE = (OPTIONS.get("ha_base_url") or "").strip().rstrip("/")

# Mui gio doc truc tiep tu cau hinh Home Assistant (GET /api/config -> time_zone)
# luc add-on khoi dong (main.py, v0.5.53) - nguon DUY NHAT cho mac dinh; TZ o tren
# chi con la du phong khi chua doc duoc HA.
HA_TIMEZONE: str | None = None
