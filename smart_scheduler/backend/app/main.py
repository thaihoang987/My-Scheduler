import asyncio
import contextlib
import logging
import os
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app import auto_off, crud, homeassistant, manual_timer, presence
from app.api import backup, entities, groups, history, manual, presence as presence_api, schedules, settings as settings_api, sun
from app.db import init_db
from app.homeassistant import connection_mode
from app.i18n import tr
from app.scheduler_engine import normalize_range_days, scheduler_loop
from app.ws import manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ha_smart_scheduler")

_scheduler_task: asyncio.Task | None = None
_presence_task: asyncio.Task | None = None
_auto_off_task: asyncio.Task | None = None


async def _reset_devices_on_startup() -> None:
    """Tuy chon Cai dat "Tat thiet bi co lich dang bat khi add-on khoi dong"
    (phan hoi 2026-09-23, sua lai lan 2: CHI tat thiet bi THUC SU dang bat -
    khong tat mu tat ca thiet bi co lich bat ke trang thai that) - mac dinh
    TAT, chi chay khi nguoi dung chu dong bat. An toan sau 1 lan restart
    giua chung 1 khung gio dang bat: add-on mat dau vet thiet bi nao dang
    bat do CHINH schedule cua no (khong tu dong nho lai "dang trong khung
    gio bat" sau restart), co the de thiet bi bat vinh vien neu lich tat
    tuong ung bi lo. Doc TRANG THAI THAT tu HA (khong doan qua schedule) de
    chi tat dung thiet bi dang "on", bo qua thiet bi co lich nhung dang tat
    san (khong can gui lenh thua). Goi TRUOC manual_timer.restore_active()
    (xem duoi) de hen "bat cuong che" con hop le van duoc khoi phuc dung sau
    do, khong bi lenh tat nay de len tren. Chi thu 1 LAN (khong retry) - day
    la tinh nang an toan, khong phai schedule; retry lap lai se lam cham
    khoi dong ca add-on neu HA chua san sang."""
    if not crud.get_settings().get("reset_devices_on_startup"):
        return
    scheduled_entity_ids = {eid for s in crud.list_schedules() for eid in (s.get("target_entities") or [])}
    if not scheduled_entity_ids:
        return
    try:
        states = await homeassistant.get_states()
    except Exception as exc:  # noqa: BLE001 - khong duoc lam chet lifespan neu HA chua san sang
        log.warning("Khong doc duoc trang thai HA de tat thiet bi luc khoi dong (bo qua lan nay): %s", exc)
        return
    state_by_entity = {s["entity_id"]: s.get("state") for s in states}
    # "dang bat" = state khac "off"/"unavailable"/"unknown" - bao trum ca
    # climate (hvac_mode "cool"/"heat"/... la state that, khong phai "on").
    on_entities = sorted(
        eid for eid in scheduled_entity_ids
        if state_by_entity.get(eid, "off") not in ("off", "unavailable", "unknown")
    )
    if not on_entities:
        log.info("Khong co thiet bi nao co lich dang bat luc add-on khoi dong - bo qua")
        return
    try:
        await homeassistant.call_service("homeassistant", "turn_off", on_entities, {})
        log.info("Da gui lenh tat cho %d thiet bi co lich dang bat luc add-on khoi dong: %s", len(on_entities), on_entities)
    except Exception as exc:  # noqa: BLE001
        log.warning("Tat thiet bi luc khoi dong that bai (HA co the chua san sang): %s", exc)


async def _load_ha_timezone() -> None:
    """Lay mui gio tu cau hinh HA (Settings -> System -> General) - moi tinh toan
    gio cua add-on theo DUNG mui nay (v0.5.54 bo o chon mui gio rieng). Loi (HA
    chua san sang) -> giu TZ do Supervisor truyen vao (cung = mui gio HA)."""
    from zoneinfo import ZoneInfo

    from app import config
    try:
        tz = (await homeassistant.get_core_config()).get("time_zone")
        if tz:
            ZoneInfo(tz)
            config.HA_TIMEZONE = tz
            log.info("Mui gio Home Assistant: %s", tz)
    except Exception as exc:  # noqa: BLE001
        log.warning("Chua doc duoc mui gio tu Home Assistant (dung TZ=%s): %s", config.DEFAULT_TIMEZONE, exc)
    # Ban cu tung chon mui gio rieng trong Cai dat -> bo, tu nay theo HA (v0.5.54).
    old = crud.clear_legacy_timezone()
    now_tz = crud.settings_timezone()
    if old and old != now_tz:
        log.warning("Bo mui gio rieng cua add-on (%s) - tu nay theo Home Assistant (%s)", old, now_tz)
        crud.add_history(None, tr("Múi giờ", "Time zone"), None, "warning",
                         tr(f"Bỏ múi giờ riêng {old}, từ nay theo Home Assistant ({now_tz}).",
                            f"Dropped the add-on's own time zone {old}; now following Home Assistant ({now_tz})."),
                         manual=True)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler_task, _presence_task, _auto_off_task
    init_db()
    log.info("Database ready")
    await _load_ha_timezone()
    fixed = normalize_range_days()
    if fixed:
        log.info("Moved repeat days of %d overnight range end(s) to the next day", fixed)
    await _reset_devices_on_startup()
    await manual_timer.restore_active()
    frontend_version_file = Path(os.environ.get("STATIC_DIR", "/app/static")) / "build-version.txt"
    frontend_version = frontend_version_file.read_text(encoding="utf-8").strip() if frontend_version_file.is_file() else "unknown"
    log.info("Frontend bundle version: %s", frontend_version)
    log.info("Home Assistant connection mode: %s", connection_mode())
    _scheduler_task = asyncio.create_task(scheduler_loop())
    _presence_task = asyncio.create_task(presence.presence_loop())
    _auto_off_task = asyncio.create_task(auto_off.auto_off_loop())
    yield
    for task in (_scheduler_task, _presence_task, _auto_off_task):
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="My Scheduler", lifespan=lifespan)
# Nen gzip - chunk thu vien icon MDI day du (~3MB, v0.5.26) chi con ~vai tram KB.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def disable_frontend_cache(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if "/assets/" in path:
        # File build cua Vite co hash trong ten -> doi noi dung la doi ten,
        # cache vinh vien an toan (index.html van no-store nen luon tro dung
        # ban moi). Tranh tai lai chunk icon ~3MB moi lan mo app.
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif not path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response

app.include_router(schedules.router)
app.include_router(entities.router)
app.include_router(history.router)
app.include_router(settings_api.router)
app.include_router(backup.router)
app.include_router(manual.router)
app.include_router(sun.router)
app.include_router(groups.router)
app.include_router(presence_api.router)


@app.get("/api/time")
async def server_time():
    from fastapi.responses import JSONResponse
    return JSONResponse({"unix_ms": time.time() * 1000}, headers={"Cache-Control": "no-store"})


@app.get("/api/health")
async def health():
    return {"status": "ok", "ha_connection_mode": connection_mode()}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # frontend khong can gui gi, chi giu ket noi song
    except WebSocketDisconnect:
        await manager.disconnect(ws)


# Static frontend (da build san boi stage Node trong Dockerfile) - mount SAU
# CUNG de khong che API/WS. html=True de SPA fallback phuc vu index.html cho
# moi route khong khop file tinh. STATIC_DIR chinh duoc de test backend cuc
# bo (khong co frontend build san) ma khong crash luc import module.
static_dir = Path(os.environ.get("STATIC_DIR", "/app/static"))
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
else:
    log.warning("STATIC_DIR '%s' khong ton tai - bo qua mount frontend (binh thuong khi test backend rieng)", static_dir)
