"""Giao tiep Home Assistant Core qua Supervisor proxy noi bo (uu tien) hoac
Core truc tiep (du phong). SUPERVISOR_TOKEN do Supervisor cap tu dong qua S6
with-contenv va KHONG bao gio duoc gui xuong frontend. Long-Lived Access Token
chi duoc dung khi Supervisor token thuc su khong co.

REST (`/core/api/*` hoac Core API truc tiep) dung cho states + goi service.
WebSocket (`/core/websocket` hoac `/api/websocket`) dung mot lan/goi
de lay registry (area/device/entity) - khong giu ket noi thuong truc de don
gian cho MVP.
"""
import asyncio
import itertools
import json
import logging
import ssl
import time
from urllib.parse import quote

import httpx
import websockets

from app.config import (
    CORE_API_BASE,
    CORE_WS_URL,
    DIRECT_CORE_API_BASE,
    HA_BASE_URL_OVERRIDE,
    HA_TOKEN,
    SUPERVISOR_TOKEN,
)

log = logging.getLogger("ha_smart_scheduler.ha")


class HAError(RuntimeError):
    pass


# ---- Suc khoe ket noi HA (v0.5.79) ----
# Lenh GUI LAI (thu lai tat cua hen tay, tu tat, gia lap co nguoi, kiem tra
# trang thai, tat bu sau restart) chi duoc gui khi ket noi da ON DINH: khong co
# loi trong STABLE_SECONDS va da co 1 lan doc thanh cong SAU loi cuoi. Tranh
# ban lenh lien tuc luc HA/mang chap chon. Lenh theo lich binh thuong (lan dau)
# van gui ngay - khong bi chan.
STABLE_SECONDS = 60
_last_failure: float | None = None
_last_success: float | None = None


def _mark_ok() -> None:
    global _last_success
    _last_success = time.monotonic()


def _mark_failure() -> None:
    global _last_failure
    _last_failure = time.monotonic()


def connection_stable() -> bool:
    if _last_failure is None:
        return True
    return (_last_success is not None and _last_success > _last_failure
            and time.monotonic() - _last_failure >= STABLE_SECONDS)


async def ensure_stable() -> bool:
    """True khi duoc phep gui lai lenh. Loi cu hon STABLE_SECONDS ma chua co lan
    doc nao sau do -> doc thu 1 lan (GET, khong doi gi tren HA) de xac nhan."""
    if connection_stable():
        return True
    if _last_failure is not None and time.monotonic() - _last_failure < STABLE_SECONDS:
        return False
    try:
        await ping()
    except Exception as exc:  # noqa: BLE001
        log.info("HA van chua on dinh, hoan gui lai lenh: %s", exc)
        return False
    return connection_stable()


def _connection_error(exc: BaseException) -> bool:
    """Loi ket noi/HA dang khoi dong (khong phai loi du lieu 4xx cua 1 lenh)."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return isinstance(exc, (httpx.TransportError, OSError))


# Thu tu lenh theo thiet bi: moi lan gui lenh toi 1 entity tang so nay. Kiem tra
# trang thai so lai truoc khi gui lai - co lenh MOI hon (hen tay, tu tat, lich
# khac...) thi khong gui lai lenh cu de lat nguoc thiet bi.
_command_counter = itertools.count(1)
_command_seq: dict[str, int] = {}


def note_command(entity_ids: list[str]) -> None:
    seq = next(_command_counter)
    for eid in entity_ids:
        _command_seq[eid] = seq


def command_seq(entity_id: str) -> int:
    return _command_seq.get(entity_id, 0)


def _effective_token() -> str:
    return SUPERVISOR_TOKEN or HA_TOKEN


def connection_mode() -> str:
    if SUPERVISOR_TOKEN:
        return "supervisor_proxy"
    if HA_TOKEN:
        return "direct_core_fallback"
    return "unavailable"


def _effective_api_base() -> str:
    if SUPERVISOR_TOKEN:
        return CORE_API_BASE
    return HA_BASE_URL_OVERRIDE or DIRECT_CORE_API_BASE


def _effective_ws_url() -> str:
    if SUPERVISOR_TOKEN:
        return CORE_WS_URL
    api_base = HA_BASE_URL_OVERRIDE or DIRECT_CORE_API_BASE
    scheme = "wss://" if api_base.startswith("https://") else "ws://"
    host_and_path = api_base.split("://", 1)[-1]
    return f"{scheme}{host_and_path}/websocket"


def _headers() -> dict:
    token = _effective_token()
    if not token:
        raise HAError(
            "Khong nhan duoc SUPERVISOR_TOKEN va chua co ha_token du phong. "
            "Hay rebuild/restart add-on de ap dung run.sh with-contenv; chi khi van loi moi can "
            "dien Long-Lived Access Token vao ha_token."
        )
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


_ssl_context: ssl.SSLContext | None = None


def _client(timeout: float) -> httpx.AsyncClient:
    """httpx.AsyncClient() moi lan tao lai SSL context (nap bo chung chi, DONG BO)
    ~0.2s chan ca event loop - 12 lich cung gio thi cai cuoi tre ~2s (do thuc te
    v0.5.53). Tao SSL context 1 lan, dung lai cho moi client."""
    global _ssl_context
    if _ssl_context is None:
        _ssl_context = ssl.create_default_context()
    return httpx.AsyncClient(timeout=timeout, verify=_ssl_context)


async def _get(path: str, timeout: float = 10, **kwargs):
    try:
        async with _client(timeout) as client:
            resp = await client.get(f"{_effective_api_base()}{path}", headers=_headers(), **kwargs)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        if _connection_error(exc):
            _mark_failure()
        raise
    _mark_ok()
    return data


async def ping() -> None:
    """GET /api/ - kiem tra HA dang tra loi (khong doc ca danh sach states)."""
    await _get("/")


async def get_states() -> list[dict]:
    return await _get("/states")


async def get_core_config() -> dict:
    """GET /config - lay latitude/longitude/elevation cua HA (Settings ->
    System -> General) de tinh gio moc troi/lan (sunrise/sunset trigger,
    muc "Kieu hen gio" moi)."""
    return await _get("/config")


async def get_state_history(entity_ids: list[str], start: str, end: str) -> dict[str, list[dict]]:
    """GET /history/period - lich su trang thai tu recorder cua HA (card timeline
    keo qua lai o Device Detail, v0.5.55). minimal_response + no_attributes cho
    nhe; thoi diem trong path phai URL-encode (dau "+" cua "+07:00" bi doc thanh
    dau cach neu de tho). Tra ve {entity_id: [{"s": state, "t": last_changed}]}."""
    params = {
        "filter_entity_id": ",".join(entity_ids),
        "end_time": end,
        "minimal_response": "1",
        "no_attributes": "1",
    }
    data = await _get(f"/history/period/{quote(start, safe='')}", timeout=20, params=params)
    out: dict[str, list[dict]] = {eid: [] for eid in entity_ids}
    for series in data:
        if not series:
            continue
        # minimal_response: chi phan tu dau co entity_id, cac phan tu sau chi co state/last_changed
        eid = series[0].get("entity_id")
        if eid not in out:
            continue
        out[eid] = [{"s": item.get("state"), "t": item.get("last_changed")} for item in series if item.get("last_changed")]
    return out


async def call_service(domain: str, service: str, entity_ids: list[str], service_data: dict) -> list[dict]:
    log.info("HA command service=%s.%s targets=%s", domain, service, entity_ids)
    note_command(entity_ids)
    payload = dict(service_data or {})
    payload["entity_id"] = entity_ids
    try:
        async with _client(15) as client:
            resp = await client.post(
                f"{_effective_api_base()}/services/{domain}/{service}",
                headers=_headers(),
                content=json.dumps(payload),
            )
    except Exception as exc:
        # Timeout: HA CO THE da thuc hien lenh - noi goi khong duoc tu phat lai
        # lenh khong idempotent (scene/script/toggle).
        if _connection_error(exc):
            _mark_failure()
        raise
    if resp.status_code >= 500:
        _mark_failure()
    if resp.status_code >= 400:
        raise HAError(f"HA service call failed ({resp.status_code}): {resp.text}")
    _mark_ok()
    data = resp.json()
    return data if isinstance(data, list) else []


_id_counter = itertools.count(1)

# Cache registry (v0.5.51): truoc day MOI lan GET /api/entities (tim kiem, xoa
# thiet bi, poll 8s cua trang Nha) deu mo WS va tai lai toan bo area/device/
# entity registry - nha nhieu entity mat ca giay, UI lag (phan hoi 2026-09-30).
# Registry chi dung de lay ten khu vuc/thiet bi, doi rat it -> cache 5 phut.
REGISTRY_TTL_SECONDS = 300
_registry_cache: tuple[float, dict] | None = None
_registry_lock = asyncio.Lock()


async def get_registries() -> dict:
    global _registry_cache
    async with _registry_lock:
        now = time.monotonic()
        if _registry_cache and now - _registry_cache[0] < REGISTRY_TTL_SECONDS:
            return _registry_cache[1]
        data = await _fetch_registries()
        # Loi (khong co area/device/entity nao) -> khong cache, lan sau thu lai.
        if data["entities"] or data["devices"] or data["areas"]:
            _registry_cache = (now, data)
        return data


async def _fetch_registries() -> dict:
    """Tra ve {areas: {area_id: name}, devices: {device_id: {name, area_id}},
    entities: {entity_id: {area_id, device_id, name}}} - dung de ghep area/
    device vao Entity Picker (muc 10 SPEC.md)."""
    areas: dict = {}
    devices: dict = {}
    entities: dict = {}
    try:
        token = _effective_token()
        if not token:
            raise HAError("Khong co SUPERVISOR_TOKEN hoac ha_token du phong")
        # Registry cua HA lon co the vuot gioi han mac dinh 1 MiB cua
        # websockets. Gioi han 16 MiB van co chan, nhung du cho nha co nhieu
        # entity/device ma khong lam mat area/device trong Entity Picker.
        async with websockets.connect(
            _effective_ws_url(),
            open_timeout=10,
            max_size=16 * 1024 * 1024,
        ) as ws:
            hello = json.loads(await ws.recv())
            if hello.get("type") != "auth_required":
                raise HAError("Unexpected HA WS handshake")
            await ws.send(json.dumps({"type": "auth", "access_token": token}))
            auth_result = json.loads(await ws.recv())
            if auth_result.get("type") != "auth_ok":
                raise HAError("HA WS auth failed")

            async def command(cmd_type: str):
                cmd_id = next(_id_counter)
                await ws.send(json.dumps({"id": cmd_id, "type": cmd_type}))
                while True:
                    raw = json.loads(await ws.recv())
                    if raw.get("id") == cmd_id:
                        return raw.get("result", [])

            for area in await command("config/area_registry/list"):
                areas[area["area_id"]] = area.get("name")
            for device in await command("config/device_registry/list"):
                devices[device["id"]] = {
                    "name": device.get("name_by_user") or device.get("name"),
                    "area_id": device.get("area_id"),
                }
            for entity in await command("config/entity_registry/list"):
                entities[entity["entity_id"]] = {
                    "area_id": entity.get("area_id"),
                    "device_id": entity.get("device_id"),
                    "name": entity.get("name"),
                }
    except (OSError, websockets.WebSocketException, HAError) as exc:
        log.warning("Khong lay duoc registry tu HA WS (%s) - area/device se trong", exc)
    return {"areas": areas, "devices": devices, "entities": entities}
