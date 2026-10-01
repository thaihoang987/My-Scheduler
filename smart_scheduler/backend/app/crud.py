"""Truy van SQLite cho schedules/aliases/history/settings/groups. Tra ve
dict thuan (khong ORM) de FastAPI/Pydantic serialize truc tiep."""
import json
from typing import Any, Optional

from app import config
from app.config import DEFAULT_TIMEZONE
from app.db import get_conn, new_id, now_iso, tx
from app.i18n import tr


def settings_timezone() -> str:
    """Mui gio DUY NHAT cua add-on = mui gio Home Assistant (v0.5.54, phan hoi
    2026-10-01 "theo han mui gio hassio"): da bo o chon mui gio trong Cai dat - 2 noi
    chon mui gio chi gay lech. Moi lich/binh minh/tam dung/gia lap co nguoi tinh theo
    mui nay. Cot `schedules.timezone` chi con de tuong thich."""
    return default_timezone()


def clear_legacy_timezone() -> str | None:
    """Ban < 0.5.54 cho chon mui gio rieng -> xoa gia tri cu (tra ve de ghi Nhat ky)."""
    row = get_conn().execute("SELECT value FROM settings WHERE key='timezone'").fetchone()
    if not row:
        return None
    with tx() as c:
        c.execute("DELETE FROM settings WHERE key='timezone'")
    return json.loads(row["value"])


def default_timezone() -> str:
    """Mui gio cua Home Assistant (doc luc khoi dong), chua doc duoc thi TZ/mac dinh."""
    return config.HA_TIMEZONE or DEFAULT_TIMEZONE


def _row_to_schedule(row, tz: Optional[str] = None) -> dict[str, Any]:
    d = dict(row)
    d["timezone"] = tz or settings_timezone()
    d["enabled"] = bool(d["enabled"])
    d["card_enabled"] = bool(d.get("card_enabled", 1))
    d["favorite"] = bool(d["favorite"])
    d["skip_once"] = bool(d["skip_once"])
    d["target_entities"] = json.loads(d.pop("target_entities"))
    d["action"] = json.loads(d.pop("action"))
    d["days"] = json.loads(d.pop("days"))
    d["conditions"] = json.loads(d.pop("conditions", None) or "[]")
    d["last_scheduled_for"] = d.pop("last_scheduled_for", None)
    return d


def list_schedules() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM schedules ORDER BY sort_order ASC, time ASC").fetchall()
    tz = settings_timezone()
    return [_row_to_schedule(r, tz) for r in rows]


def get_schedule(schedule_id: str) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM schedules WHERE id = ?", (schedule_id,)).fetchone()
    return _row_to_schedule(row) if row else None


def create_schedule(data: dict) -> dict:
    sid = new_id()
    ts = now_iso()
    conn = get_conn()
    max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM schedules").fetchone()[0]
    with tx() as c:
        c.execute(
            """INSERT INTO schedules
            (id, name, enabled, target_entities, action, days, time, timezone,
             sort_order, group_id, favorite, start_date, end_date, trigger_type,
             offset_minutes, conditions, card_enabled, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                sid,
                data["name"],
                1 if data.get("enabled", True) else 0,
                json.dumps(data.get("target_entities", [])),
                json.dumps(data["action"]),
                json.dumps(data.get("days", [0, 1, 2, 3, 4, 5, 6])),
                data["time"],
                data.get("timezone") or DEFAULT_TIMEZONE,
                data.get("sort_order", max_order + 10),
                data.get("group_id"),
                1 if data.get("favorite") else 0,
                data.get("start_date"),
                data.get("end_date"),
                data.get("trigger_type") or "time",
                data.get("offset_minutes", 0),
                json.dumps(data.get("conditions", [])),
                0 if data.get("card_enabled") is False else 1,
                ts,
                ts,
            ),
        )
    return get_schedule(sid)


def update_schedule(schedule_id: str, data: dict) -> Optional[dict]:
    existing = get_schedule(schedule_id)
    if not existing:
        return None
    # card_enabled=None = client khong gui -> giu nguyen cong tac tong cua card.
    merged = {**existing, **{k: v for k, v in data.items() if not (k == "card_enabled" and v is None)}}
    with tx() as c:
        c.execute(
            """UPDATE schedules SET name=?, enabled=?, target_entities=?, action=?, days=?, time=?,
               timezone=?, sort_order=?, group_id=?, favorite=?, start_date=?, end_date=?,
               trigger_type=?, offset_minutes=?, conditions=?, card_enabled=?, updated_at=?
               WHERE id=?""",
            (
                merged["name"],
                1 if merged.get("enabled", True) else 0,
                json.dumps(merged.get("target_entities", [])),
                json.dumps(merged["action"]),
                json.dumps(merged.get("days", [0, 1, 2, 3, 4, 5, 6])),
                merged["time"],
                merged.get("timezone") or DEFAULT_TIMEZONE,
                merged.get("sort_order", 0),
                merged.get("group_id"),
                1 if merged.get("favorite") else 0,
                merged.get("start_date"),
                merged.get("end_date"),
                merged.get("trigger_type") or "time",
                merged.get("offset_minutes", 0),
                json.dumps(merged.get("conditions", [])),
                1 if merged.get("card_enabled", True) else 0,
                now_iso(),
                schedule_id,
            ),
        )
    return get_schedule(schedule_id)


def delete_schedule(schedule_id: str) -> bool:
    with tx() as c:
        cur = c.execute("DELETE FROM schedules WHERE id=?", (schedule_id,))
    return cur.rowcount > 0


def set_enabled(schedule_id: str, enabled: bool) -> Optional[dict]:
    """Bat/tat 1 lich RIENG LE (dong trong Device Detail) - luon xoa co
    `group_off`: day la quyet dinh CHU DONG cua nguoi dung tren dung lich
    nay, khong con la trang thai "cho khoi phuc" tu nut bat/tat CA NHOM tren
    DeviceCard nua (xem set_group_enabled)."""
    with tx() as c:
        c.execute(
            "UPDATE schedules SET enabled=?, group_off=0, updated_at=? WHERE id=?",
            (1 if enabled else 0, now_iso(), schedule_id),
        )
    return get_schedule(schedule_id)


def set_group_enabled(schedule_ids: list[str], enabled: bool) -> list[dict]:
    """Cong tac TONG cua 1 card (nut tren DeviceCard/Home.tsx). Chi doi cot
    `card_enabled`, KHONG dung toi `enabled` cua tung lich con - lich nguoi
    dung da tat rieng van tat, va card van sang len duoc khi bat du chua co
    lich con nao dang bat (phan hoi 2026-09-24). Engine chi chay lich khi
    ca enabled lan card_enabled deu bat."""
    if not schedule_ids:
        return []
    placeholders = ",".join("?" for _ in schedule_ids)
    with tx() as c:
        c.execute(
            f"UPDATE schedules SET card_enabled=?, group_off=0, updated_at=? WHERE id IN ({placeholders})",
            (1 if enabled else 0, now_iso(), *schedule_ids),
        )
    conn = get_conn()
    rows = conn.execute(f"SELECT * FROM schedules WHERE id IN ({placeholders})", schedule_ids).fetchall()
    return [_row_to_schedule(r) for r in rows]


def set_favorite(schedule_id: str, favorite: bool) -> Optional[dict]:
    with tx() as c:
        c.execute(
            "UPDATE schedules SET favorite=?, updated_at=? WHERE id=?",
            (1 if favorite else 0, now_iso(), schedule_id),
        )
    return get_schedule(schedule_id)


def set_skip_once(schedule_id: str, skip: bool) -> Optional[dict]:
    with tx() as c:
        c.execute(
            "UPDATE schedules SET skip_once=?, updated_at=? WHERE id=?",
            (1 if skip else 0, now_iso(), schedule_id),
        )
    return get_schedule(schedule_id)


def reorder_schedules(ordered_ids: list[str]) -> None:
    with tx() as c:
        for idx, sid in enumerate(ordered_ids):
            c.execute("UPDATE schedules SET sort_order=?, updated_at=? WHERE id=?", (idx * 10, now_iso(), sid))


def mark_executed(schedule_id: str, scheduled_for: str, status: str, consume_skip_once: bool = True) -> None:
    with tx() as c:
        c.execute(
            "UPDATE schedules SET last_run=?, last_scheduled_for=?, last_status=?"
            + (", skip_once=0" if consume_skip_once else "") + " WHERE id=?",
            (now_iso(), scheduled_for, status, schedule_id),
        )


# ---- entity aliases ----

def list_aliases() -> dict[str, dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM entity_aliases").fetchall()
    return {r["entity_id"]: dict(r) for r in rows}


def upsert_alias(entity_id: str, domain: str, data: dict) -> dict:
    existing = list_aliases().get(entity_id, {})
    # Chi ghi de field co mat trong `data` (loai None) - giu nguyen field
    # khac (vd `added`) khi goi chi de sua alias/favorite rieng le.
    merged = {**existing, **{k: v for k, v in data.items() if v is not None}}
    # "" nghia la "xoa khoi nhom" (khac None = "khong gui, giu nguyen") -
    # chuan hoa ve NULL that su trong DB de query "chua phan nhom" don gian.
    category_id = merged.get("category_id") or None
    with tx() as c:
        c.execute(
            """INSERT INTO entity_aliases (entity_id, alias, area, icon, domain, device_name, favorite, added, category_id, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(entity_id) DO UPDATE SET
                 alias=excluded.alias, area=excluded.area, icon=excluded.icon,
                 domain=excluded.domain, device_name=excluded.device_name,
                 favorite=excluded.favorite, added=excluded.added,
                 category_id=excluded.category_id, updated_at=excluded.updated_at""",
            (
                entity_id,
                merged.get("alias"),
                merged.get("area"),
                merged.get("icon"),
                domain,
                merged.get("device_name"),
                1 if merged.get("favorite") else 0,
                1 if merged.get("added") else 0,
                category_id,
                now_iso(),
            ),
        )
    return list_aliases()[entity_id]


class ReplaceEntityError(ValueError):
    pass


def replace_entity(old_id: str, new_id: str, new_domain: str) -> dict:
    """Doi 1 thiet bi sang entity KHAC ma giu nguyen moi thu (phan hoi
    2026-09-24 "sửa thiết bị thành entities khác trực tiếp search từ
    hassio"): add-on noi moi du lieu bang entity_id tho, nen thay cong tac/
    tich hop moi lam lich goi vao entity khong con ton tai. Chuyen trong 1
    transaction: dong entity_aliases (ten rieng/icon/nhom/yeu thich - ghi de
    dong cua entity moi neu co), target_entities + conditions cua MOI lich,
    va manual_timers (DB; task dang chay do manual_timer.replace_entity lo).
    CHI cho doi CUNG domain (phan hoi 2026-09-24 "đổi entities thì phải cùng
    chủng loại chứ không sẽ làm sai timer card"): hanh dong, giao dien card
    va dieu kien (state) deu theo domain - doi khac loai se lam lich sai
    nghia du ve ky thuat van goi duoc service."""
    if old_id == new_id:
        raise ReplaceEntityError(tr("Entity mới trùng entity cũ.", "The new entity is the same as the old one."))
    old_domain = old_id.split(".", 1)[0]
    if new_domain != old_domain:
        raise ReplaceEntityError(
            tr(
                f"Chỉ đổi được sang entity cùng loại ({old_domain}), không đổi sang {new_domain}.",
                f"Can only replace with an entity of the same type ({old_domain}), not {new_domain}.",
            )
        )
    schedules = list_schedules()

    def swap(ids: list[str]) -> list[str]:
        out: list[str] = []
        for i in ids:
            j = new_id if i == old_id else i
            if j not in out:
                out.append(j)
        return out

    now = now_iso()
    n_schedules = n_conditions = n_timers = 0
    with tx() as c:
        for s in schedules:
            targets = s["target_entities"]
            conds = s["conditions"]
            new_targets = swap(targets) if old_id in targets else targets
            new_conds = [{**cd, "entity_id": new_id} if cd.get("entity_id") == old_id else cd for cd in conds]
            if new_targets == targets and new_conds == conds:
                continue
            n_schedules += old_id in targets
            n_conditions += sum(1 for cd in conds if cd.get("entity_id") == old_id)
            c.execute(
                "UPDATE schedules SET target_entities=?, conditions=?, updated_at=? WHERE id=?",
                (json.dumps(new_targets), json.dumps(new_conds), now, s["id"]),
            )

        for t in list_manual_timers():
            if old_id in t["entity_ids"]:
                c.execute("UPDATE manual_timers SET entity_ids=? WHERE id=?", (json.dumps(swap(t["entity_ids"])), t["id"]))
                n_timers += 1

        old_alias = c.execute("SELECT * FROM entity_aliases WHERE entity_id=?", (old_id,)).fetchone()
        if old_alias:
            c.execute("DELETE FROM entity_aliases WHERE entity_id=?", (new_id,))
            c.execute(
                "UPDATE entity_aliases SET entity_id=?, device_name=NULL, updated_at=? WHERE entity_id=?",
                (new_id, now, old_id),
            )

    # Danh sach thiet bi cua "Giả lập có người" (v0.5.32) luu trong settings.
    n_presence = 0
    presence_cfg = get_settings().get("presence") or {}
    if old_id in (presence_cfg.get("entity_ids") or []):
        update_settings({"presence": {**presence_cfg, "entity_ids": swap(presence_cfg["entity_ids"])}})
        n_presence = 1

    return {"schedules": n_schedules, "conditions": n_conditions, "manual_timers": n_timers, "presence": n_presence}


# ---- groups (phan loai thiet bi tren trang Nha, muc 2026-09-23) ----

def list_groups() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM groups ORDER BY sort_order ASC").fetchall()
    return [dict(r) for r in rows]


def create_group(name: str) -> dict:
    gid = new_id()
    conn = get_conn()
    max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM groups").fetchone()[0]
    with tx() as c:
        c.execute("INSERT INTO groups (id, name, sort_order) VALUES (?,?,?)", (gid, name, max_order + 10))
    return {"id": gid, "name": name, "enabled": True, "sort_order": max_order + 10}


def rename_group(group_id: str, name: str) -> Optional[dict]:
    with tx() as c:
        cur = c.execute("UPDATE groups SET name=? WHERE id=?", (name, group_id))
    if cur.rowcount == 0:
        return None
    return next((g for g in list_groups() if g["id"] == group_id), None)


def delete_group(group_id: str) -> bool:
    with tx() as c:
        # Thiet bi dang thuoc nhom nay ve lai "chua phan nhom" - khong xoa
        # theo (chi xoa cai NHOM, khong dong nghia xoa thiet bi/lich).
        c.execute("UPDATE entity_aliases SET category_id=NULL WHERE category_id=?", (group_id,))
        cur = c.execute("DELETE FROM groups WHERE id=?", (group_id,))
    return cur.rowcount > 0


def reorder_groups(ordered_ids: list[str]) -> None:
    with tx() as c:
        for idx, gid in enumerate(ordered_ids):
            c.execute("UPDATE groups SET sort_order=? WHERE id=?", (idx * 10, gid))


# ---- manual timers (hen tat cuong che, ben vung qua restart) ----

def list_manual_timers() -> list[dict]:
    rows = get_conn().execute("SELECT * FROM manual_timers ORDER BY off_at ASC").fetchall()
    return [
        {
            "id": row["id"],
            "entity_ids": json.loads(row["entity_ids"]),
            "started_at": row["started_at"],
            "off_at": row["off_at"],
        }
        for row in rows
    ]


def save_manual_timer(record: dict) -> None:
    with tx() as c:
        c.execute(
            """INSERT INTO manual_timers (id, entity_ids, started_at, off_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET entity_ids=excluded.entity_ids,
                 started_at=excluded.started_at, off_at=excluded.off_at""",
            (record["id"], json.dumps(record["entity_ids"]), record["started_at"], record["off_at"]),
        )


def delete_manual_timer(timer_id: str) -> bool:
    with tx() as c:
        cur = c.execute("DELETE FROM manual_timers WHERE id=?", (timer_id,))
    return cur.rowcount > 0


# ---- auto-off (moc bat cua thiet bi co lich "Tự tắt sau khi bật", xem auto_off.py) ----

def list_auto_off_state() -> dict[str, str]:
    rows = get_conn().execute("SELECT entity_id, on_since FROM auto_off_state").fetchall()
    return {row["entity_id"]: row["on_since"] for row in rows}


def save_auto_off_state(entity_id: str, on_since: str) -> None:
    with tx() as c:
        c.execute(
            "INSERT INTO auto_off_state (entity_id, on_since) VALUES (?, ?) "
            "ON CONFLICT(entity_id) DO UPDATE SET on_since=excluded.on_since",
            (entity_id, on_since),
        )


def delete_auto_off_state(entity_id: str) -> None:
    with tx() as c:
        c.execute("DELETE FROM auto_off_state WHERE entity_id=?", (entity_id,))


# ---- history ----

def add_history(schedule_id: Optional[str], schedule_name: Optional[str], scheduled_for: Optional[str],
                 status: str, message: Optional[str] = None, manual: bool = False, keep_last: int = 2000) -> None:
    with tx() as c:
        c.execute(
            """INSERT INTO execution_history (id, schedule_id, schedule_name, scheduled_for, executed_at,
               status, message, manual) VALUES (?,?,?,?,?,?,?,?)""",
            (new_id(), schedule_id, schedule_name, scheduled_for, now_iso(), status, message, 1 if manual else 0),
        )
        c.execute(
            """DELETE FROM execution_history WHERE id NOT IN (
                 SELECT id FROM execution_history ORDER BY executed_at DESC LIMIT ?)""",
            (keep_last,),
        )


def list_history(limit: int = 200, schedule_id: Optional[str] = None) -> list[dict]:
    conn = get_conn()
    if schedule_id:
        rows = conn.execute(
            "SELECT * FROM execution_history WHERE schedule_id=? ORDER BY executed_at DESC LIMIT ?",
            (schedule_id, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM execution_history ORDER BY executed_at DESC LIMIT ?", (limit,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["manual"] = bool(d["manual"])
        out.append(d)
    return out


# ---- settings (key/value) ----

DEFAULT_SETTINGS = {
    "timezone": DEFAULT_TIMEZONE,
    "missed_execution_policy": "skip",
    "show_countdown": True,
    "show_entity_name": True,
    "show_action": True,
    "show_days": True,
    "show_entity_id": False,
    "show_area": False,
    "show_device": False,
    "show_last_run": False,
    "show_next_run": False,
    "display_mode": "compact",
    "theme": "auto",
    "time_format": "24h",
    "sort_mode": "auto",
    "language": "en",
    # Phan hoi 2026-09-23: "khi app khởi động gửi lệnh tắt tới tất cả thiết
    # bị có timer" - an toan khi add-on restart giua chung 1 khung gio dang
    # bat (mat dau vet thiet bi nao dang thuc su bat), mac dinh TAT vi day la
    # hanh vi thay doi hanh vi thiet bi that, chi bat khi nguoi dung chu
    # dong chon (xem main.py lifespan()).
    "reset_devices_on_startup": False,
    # Xem SettingsIn.pause_until / scheduler_engine.paused_until().
    "pause_until": "",
    "verify_state": False,
    # Vi tri khoi "Tu tat sau khi bat" tren trang Nha giua cac nhom (0 = tren cung).
    "auto_off_section_index": 0,
}


def get_settings() -> dict:
    conn = get_conn()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    stored = {r["key"]: json.loads(r["value"]) for r in rows}
    # timezone mac dinh = mui gio HA; ha_timezone chi de hien thi/so sanh o Cai dat.
    return {**DEFAULT_SETTINGS, **stored, "timezone": default_timezone(), "ha_timezone": config.HA_TIMEZONE}


def update_settings(data: dict) -> dict:
    with tx() as c:
        for k, v in data.items():
            if v is None or k in ("timezone", "ha_timezone"):
                continue  # mui gio luon theo Home Assistant
            c.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )
    return get_settings()


# ---- backup / restore (muc 50 SPEC.md) ----

BACKUP_VERSION = 3

# Khoa settings KHONG dua vao ban sao luu (v0.5.56): trang thai dang chay hoac
# co noi bo, khong phai lua chon cua nguoi dung. Khoi phuc chung sang may khac/
# luc khac se sai: presence_runtime = thiet bi gia lap dang bat (cua phien cu),
# pause_until = dang tam dung (het han/khong mong muon), migrated_* = co da
# chuyen du lieu (khoi phuc len DB moi thi bo qua migration), mui gio theo HA.
_BACKUP_SKIP_SETTINGS = {"timezone", "ha_timezone", "presence_runtime", "pause_until"}


def _is_backup_setting(key: str) -> bool:
    return key not in _BACKUP_SKIP_SETTINGS and not key.startswith("migrated_")


def export_all() -> dict:
    conn = get_conn()
    schedules_raw = conn.execute("SELECT * FROM schedules").fetchall()
    return {
        "version": BACKUP_VERSION,
        "exported_at": now_iso(),
        "schedules": [dict(r) for r in schedules_raw],
        "entity_aliases": [dict(r) for r in conn.execute("SELECT * FROM entity_aliases").fetchall()],
        # v2: them nhom phan loai (Cai dat -> Nhom) - truoc day mat khi khoi phuc.
        "groups": [dict(r) for r in conn.execute("SELECT * FROM groups").fetchall()],
        # Chi cac gia tri nguoi dung DA CHINH (v0.5.53): truoc day xuat ca mac dinh
        # -> khoi phuc bien mui gio mac dinh thanh gia tri co dinh, het theo HA.
        # v3: bo trang thai chay/co noi bo (xem _BACKUP_SKIP_SETTINGS). Gom ca
        # cau hinh Gia lap co nguoi ("presence") va moi lua chon hien thi.
        "settings": {
            r["key"]: json.loads(r["value"])
            for r in conn.execute("SELECT key, value FROM settings").fetchall()
            if _is_backup_setting(r["key"])
        },
    }


def import_all(data: dict) -> dict:
    """Thay the TOAN BO schedules/aliases/settings hien co bang du lieu import
    (muc 51 "Reset" cung dung chung co che nay voi payload rong). Giu nguyen
    id goc de execution_history cu (neu con) van tham chieu dung. Tra ve so
    luong da khoi phuc de UI bao lai."""
    with tx() as c:
        c.execute("DELETE FROM schedules")
        c.execute("DELETE FROM entity_aliases")
        # Moc "dang bat tu luc" cua Tu tat thuoc ve lich CU - bo, auto_off tu
        # ghi lai theo lich moi o vong kiem tra tiep theo.
        c.execute("DELETE FROM auto_off_state")
        # Ban v3+ chua DAY DU cai dat nguoi dung -> xoa cai dat cu truoc de
        # khoi phuc dung nhu luc xuat (khoa nao khong co = ve mac dinh). Ban cu
        # (v1/v2) giu cach cu: chi ghi de cac khoa co trong file.
        if (data.get("version") or 0) >= 3:
            for (key,) in c.execute("SELECT key FROM settings").fetchall():
                if _is_backup_setting(key):
                    c.execute("DELETE FROM settings WHERE key=?", (key,))
        # Ban sao luu cu (v1) khong co "groups" -> giu nguyen nhom hien co thay
        # vi xoa trang, tranh thiet bi mat nhom sau khi khoi phuc.
        if "groups" in data:
            c.execute("DELETE FROM groups")
            for g in data.get("groups") or []:
                c.execute(
                    "INSERT INTO groups (id, name, enabled, sort_order) VALUES (?,?,?,?)",
                    (g["id"], g["name"], g.get("enabled", 1), g.get("sort_order", 0)),
                )
        for s in data.get("schedules", []):
            c.execute(
                """INSERT INTO schedules (id, name, enabled, target_entities, action, days, time, timezone,
                   sort_order, group_id, favorite, skip_once, skip_until, start_date, end_date,
                   trigger_type, offset_minutes, conditions, card_enabled, last_scheduled_for, last_run, last_status,
                   created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    s["id"], s["name"], s.get("enabled", 1), s.get("target_entities", "[]"), s.get("action", "{}"),
                    s.get("days", "[0,1,2,3,4,5,6]"), s["time"], s.get("timezone", DEFAULT_TIMEZONE),
                    s.get("sort_order", 0), s.get("group_id"), s.get("favorite", 0), s.get("skip_once", 0),
                    s.get("skip_until"), s.get("start_date"), s.get("end_date"),
                    s.get("trigger_type", "time"), s.get("offset_minutes", 0),
                    s.get("conditions") or "[]", s.get("card_enabled", 1),
                    s.get("last_scheduled_for"), s.get("last_run"), s.get("last_status"),
                    s.get("created_at", now_iso()), s.get("updated_at", now_iso()),
                ),
            )
        for a in data.get("entity_aliases", []):
            c.execute(
                """INSERT INTO entity_aliases (entity_id, alias, area, icon, domain, device_name, favorite, added,
                   category_id, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    a["entity_id"], a.get("alias"), a.get("area"), a.get("icon"), a.get("domain"),
                    a.get("device_name"), a.get("favorite", 0), a.get("added", 0), a.get("category_id"),
                    a.get("updated_at", now_iso()),
                ),
            )
        for k, v in (data.get("settings") or {}).items():
            if not _is_backup_setting(k):
                continue  # mui gio theo HA, trang thai chay khong khoi phuc
            c.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )
    return {
        "schedules": len(data.get("schedules") or []),
        "entity_aliases": len(data.get("entity_aliases") or []),
        "groups": len(data["groups"] or []) if "groups" in data else None,
        "settings": sum(1 for k in (data.get("settings") or {}) if _is_backup_setting(k)),
    }
