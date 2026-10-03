"""SQLite DAL - 1 file ket noi dung chung, khong ORM (giu nhe giong quy uoc
cac add-on Local khac trong repo). Schema theo dung muc 8 cua SPEC.md, tach
entity_aliases/execution_history/settings rieng nhu de xuat."""
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from app.config import DB_PATH

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    target_entities TEXT NOT NULL DEFAULT '[]',
    action TEXT NOT NULL DEFAULT '{}',
    days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    time TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    sort_order INTEGER NOT NULL DEFAULT 0,
    group_id TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    skip_once INTEGER NOT NULL DEFAULT 0,
    skip_until TEXT,
    start_date TEXT,
    end_date TEXT,
    trigger_type TEXT NOT NULL DEFAULT 'time',
    offset_minutes INTEGER NOT NULL DEFAULT 0,
    range_day_offset INTEGER,
    last_scheduled_for TEXT,
    last_run TEXT,
    last_status TEXT,
    -- (CU, khong con dung tu khi co card_enabled ben duoi - chi con doc 1 lan
    -- de chuyen du lieu cu, xem _CARD_ENABLED_MIGRATION.)
    -- Danh dau lich nay dang bi TAT BOI NUT "bat/tat ca nhom" tren DeviceCard
    -- (khac voi tat RIENG tung dong o Device Detail) - de nut do khi bat lai
    -- chi khoi phuc DUNG nhung lich no da tat, khong dung nham vao lich nguoi
    -- dung da chu dong tat tu truoc (phan hoi 2026-09-23, xem crud.py
    -- set_group_enabled()). Luon bi xoa ve 0 khi nguoi dung bat/tat RIENG 1
    -- lich (crud.set_enabled) - luc do la quyet dinh ro rang tren dung lich
    -- do, khong con la trang thai "cho khoi phuc" nua.
    group_off INTEGER NOT NULL DEFAULT 0,
    -- Dieu kien phu (muc "chỉ chạy khi có điều kiện" 2026-09-23, kieu
    -- Conditions cua HA Automation) - JSON list [{entity_id, state}], AND
    -- voi nhau. Rong = luon chay (hanh vi cu, khong doi). Kiem tra ngay
    -- truoc luc dinh goi service trong scheduler_engine.py.
    conditions TEXT NOT NULL DEFAULT '[]',
    -- Cong tac TONG cua card tren trang Nha (phan hoi 2026-09-24: bat toggle
    -- tong ma khong co lich con nao dang bat thi card van khong sang). Doc
    -- lap voi `enabled` cua tung lich: lich chi chay khi CA HAI deu bat.
    card_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_aliases (
    entity_id TEXT PRIMARY KEY,
    alias TEXT,
    area TEXT,
    icon TEXT,
    domain TEXT,
    device_name TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    added INTEGER NOT NULL DEFAULT 0,
    category_id TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_history (
    id TEXT PRIMARY KEY,
    schedule_id TEXT,
    schedule_name TEXT,
    scheduled_for TEXT,
    executed_at TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    manual INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS manual_timers (
    id TEXT PRIMARY KEY,
    entity_ids TEXT NOT NULL,
    started_at TEXT NOT NULL,
    off_at TEXT NOT NULL
);

-- Khung gio da BAT thanh cong ma chua TAT (v0.5.79): de tat bu sau khi add-on
-- khoi dong lai/HA mat ket noi luc toi gio Tat. on_rev/off_rev = dau van tay
-- cau hinh 2 moc luc bat - lich bi sua thi bo, khong tat bu theo cau hinh cu.
CREATE TABLE IF NOT EXISTS active_ranges (
    on_id TEXT PRIMARY KEY,
    off_id TEXT NOT NULL,
    start TEXT NOT NULL,
    deadline TEXT NOT NULL,
    on_rev TEXT NOT NULL,
    off_rev TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_off_state (
    entity_id TEXT PRIMARY KEY,
    on_since TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_schedule ON execution_history(schedule_id);
CREATE INDEX IF NOT EXISTS idx_history_executed_at ON execution_history(executed_at);
CREATE INDEX IF NOT EXISTS idx_manual_timers_off_at ON manual_timers(off_at);
"""


def get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


_MIGRATIONS = [
    "ALTER TABLE schedules ADD COLUMN start_date TEXT",
    "ALTER TABLE schedules ADD COLUMN end_date TEXT",
    "ALTER TABLE entity_aliases ADD COLUMN added INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE schedules ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'time'",
    "ALTER TABLE schedules ADD COLUMN offset_minutes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE entity_aliases ADD COLUMN category_id TEXT",
    "ALTER TABLE schedules ADD COLUMN group_off INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE schedules ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]'",
    # Khung gio ket thuc trong ngay (0) / hom sau (1) / NULL = theo kieu gio (v0.5.79).
    "ALTER TABLE schedules ADD COLUMN range_day_offset INTEGER",
    # Nhom tren trang Nha: bo qua lenh Bat cua ca nhom toi moc nay (v0.5.85, "mua thi khoi tuoi").
    "ALTER TABLE groups ADD COLUMN skip_until TEXT",
]

# Chuyen du lieu cu 1 LAN DUY NHAT, ngay sau khi cot card_enabled vua duoc
# them: truoc day nut tong tat bang cach dat enabled=0 + group_off=1, nay
# doi thanh card_enabled=0 va tra lai enabled=1 cho dung lich con do.
_CARD_ENABLED_MIGRATION = (
    "ALTER TABLE schedules ADD COLUMN card_enabled INTEGER NOT NULL DEFAULT 1",
    "UPDATE schedules SET enabled=1, card_enabled=0, group_off=0 WHERE group_off=1",
)


def _split_range_conditions(conn: sqlite3.Connection) -> None:
    """1 lan (v0.5.35): truoc day "Khung gio" luu CUNG dieu kien vao ca dong
    Bat lan dong Tat - dieu kien sai luc toi gio Tat thi thiet bi bat mai (vd
    "bật bơm khi độ ẩm < 60", độ ẩm lên 70 -> không tắt). Nay dieu kien tach
    rieng tung moc; dong Tat nao dang co dieu kien Y HET dong Bat cung cap
    (tuc la do ban cu tu chep) duoc xoa ve rong = luon tat."""
    done = conn.execute("SELECT value FROM settings WHERE key='migrated_split_conditions'").fetchone()
    if done:
        return
    conn.execute(
        """UPDATE schedules SET conditions='[]'
           WHERE json_extract(action, '$.service')='turn_off' AND group_id IS NOT NULL
             AND conditions != '[]'
             AND conditions IN (SELECT s2.conditions FROM schedules s2
                                WHERE s2.group_id = schedules.group_id
                                  AND json_extract(s2.action, '$.service')='turn_on')"""
    )
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_split_conditions', 'true')")


def init_db() -> None:
    """CREATE TABLE IF NOT EXISTS khong tu them cot moi vao bang da ton tai -
    can ALTER TABLE rieng cho DB da co du lieu that tren may nguoi dung (vd
    sau ban them start_date/end_date, added). Bo qua loi "duplicate column"
    (DB moi tao qua SCHEMA da co san cot, ALTER se that bai - binh thuong)."""
    conn = get_conn()
    conn.executescript(SCHEMA)
    for stmt in _MIGRATIONS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass
    _split_range_conditions(conn)
    try:
        conn.execute(_CARD_ENABLED_MIGRATION[0])
    except sqlite3.OperationalError:
        pass
    else:
        conn.execute(_CARD_ENABLED_MIGRATION[1])
    conn.commit()


@contextmanager
def tx():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
