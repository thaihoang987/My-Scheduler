"""Pydantic schemas dung chung cho API request/response. Model Schedule theo
dung cau truc JSON o muc 8 SPEC.md."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class HAAction(BaseModel):
    domain: str
    service: str
    service_data: dict[str, Any] = Field(default_factory=dict)


class ScheduleCondition(BaseModel):
    """Dieu kien phu (muc "chỉ chạy khi có điều kiện" 2026-09-23, kieu
    Conditions cua HA Automation) - lich CHI thuc thi neu entity_id dang o
    dung state nay, kiem tra ngay truoc luc dinh goi service (xem
    scheduler_engine.py). Danh sach conditions cua 1 schedule la AND (phai
    dung HET), rong = luon chay (hanh vi cu, khong doi)."""

    entity_id: str
    state: str
    # So sanh (v0.5.32): "eq"/"ne" so chuoi; "gt"/"gte"/"lt"/"lte" doi ca 2
    # ve so (vd cam bien do am < 60) - state khong phai so thi coi la SAI.
    operator: str = "eq"


class ScheduleIn(BaseModel):
    name: str
    enabled: bool = True
    target_entities: list[str] = Field(default_factory=list)
    action: HAAction
    days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6])
    time: str  # "HH:MM:SS"; lich cu "HH:MM" van duoc ho tro nhu :00
    timezone: Optional[str] = None
    sort_order: int = 0
    group_id: Optional[str] = None
    favorite: bool = False
    # Khoang ngay ap dung (tuy chon, "YYYY-MM-DD") - rong = luon ap dung,
    # khong gioi han. Phan hoi thuc te 2026-09-22: muon "hen gio kieu keo tu
    # ngay toi ngay" (vd lich tuoi cay chi chay trong mua he).
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    # Kieu hen gio (muc "Cach thuc hen gio" 2026-09-22, giong cac app dieu
    # khien thiet bi khac - Google Home/Tuya/SmartThings): "time" = gio co
    # dinh (`time` phia tren), "sunrise"/"sunset" = tinh theo binh minh/hoang
    # hon THUC TE tai vi tri HA (thu vien astral, xem scheduler_engine.py),
    # +/- `offset_minutes` phut. `time` van luon co gia tri (fallback hien
    # thi khi chua tinh duoc vi tri) nhung bi bo qua boi engine khi
    # trigger_type khac "time".
    trigger_type: str = "time"  # "time" | "sunrise" | "sunset"
    offset_minutes: int = 0
    conditions: list[ScheduleCondition] = Field(default_factory=list)
    # Cong tac tong cua card (xem crud.set_group_enabled). None = khong gui,
    # giu nguyen gia tri cu khi sua lich; tao moi thi mac dinh bat.
    card_enabled: Optional[bool] = None


class ScheduleOut(ScheduleIn):
    id: str
    card_enabled: bool = True
    timezone: str
    skip_once: bool = False
    skip_until: Optional[str] = None
    next_run: Optional[str] = None
    last_run: Optional[str] = None
    last_status: Optional[str] = None
    created_at: str
    updated_at: str


class ScheduleReorder(BaseModel):
    ordered_ids: list[str]


class ScheduleIds(BaseModel):
    schedule_ids: list[str]


class ScheduleGroupToggle(BaseModel):
    """Bat/tat nhieu lich cung luc (nut tren DeviceCard) - xem
    crud.set_group_enabled() ve ly do can rieng khoi POST /{id}/toggle."""

    schedule_ids: list[str]
    enabled: bool


class EntityReplaceIn(BaseModel):
    new_entity_id: str


class EntityAliasIn(BaseModel):
    alias: Optional[str] = None
    area: Optional[str] = None
    icon: Optional[str] = None
    device_name: Optional[str] = None
    # Optional[bool] = None (khong phai `= False`) CO CHU DICH - de phan
    # biet "khong gui field nay" (giu nguyen gia tri cu) voi "gui False"
    # (tat that su). Bug thuc te 2026-09-22: `favorite: bool = False` lam 1
    # request chi sua field khac vo tinh reset added=True ve False vi
    # Pydantic tu dien gia tri mac dinh False (khong phai None) khi client
    # khong gui field do.
    favorite: Optional[bool] = None
    # "Da them" (muc 21 SPEC_UI.md, phan hoi 2026-09-22: chon entity chi
    # trong Cai dat, trang chu chi chon trong danh sach da them roi).
    added: Optional[bool] = None
    # Nhom PHAN LOAI tren trang Nha (muc "phan nhom + keo tha" 2026-09-23) -
    # tro toi `groups.id`, KHONG lien quan `schedules.group_id` (cot do chi
    # ghep cap bat/tat cua 1 "Khung gio", da dung tu truoc). Gui chuoi rong
    # "" (khac None) de XOA khoi nhom hien tai - cung quy uoc "khong gui =
    # giu nguyen" nhu favorite/added o tren.
    category_id: Optional[str] = None


class EntityAliasOut(EntityAliasIn):
    entity_id: str
    domain: str
    updated_at: str


class GroupIn(BaseModel):
    name: str


class GroupOut(GroupIn):
    id: str
    sort_order: int


class GroupReorder(BaseModel):
    ordered_ids: list[str]


class ClimateAttrs(BaseModel):
    """Rieng cho domain climate (muc 'Dat che do may lanh' 2026-09-23,
    tham khao custom:scheduler-card) - doc thang tu attributes cua state HA,
    de frontend dung lam gioi han/lua chon khi tao hanh dong set_temperature/
    set_hvac_mode (khong luu ban sao trong schedules, chi hien thi UI)."""
    hvac_modes: list[str] = Field(default_factory=list)
    min_temp: Optional[float] = None
    max_temp: Optional[float] = None
    temp_step: Optional[float] = None
    fan_modes: Optional[list[str]] = None


class LightAttrs(BaseModel):
    """Rieng cho domain light (muc 'Dat den' 2026-09-23) - doc tu
    attributes cua state HA. `supported_color_modes` la danh sach chuan HA
    (vd "brightness","color_temp","rgb","hs","xy","onoff") - frontend dung
    de biet den co ho tro chinh do sang/mau/nhiet mau hay khong."""
    supported_color_modes: list[str] = Field(default_factory=list)
    min_color_temp_kelvin: Optional[int] = None
    max_color_temp_kelvin: Optional[int] = None
    effect_list: Optional[list[str]] = None


class CoverAttrs(BaseModel):
    """Rieng cho domain cover (rem/cua cuon/cong) - suy tu bitmask
    `supported_features` cua HA (SET_POSITION=4, SET_TILT_POSITION=64)."""
    supports_position: bool = False
    supports_tilt_position: bool = False


class FanAttrs(BaseModel):
    """Rieng cho domain fan - `preset_modes` neu quat ho tro che do dung san
    (vd "sleep"/"turbo") ngoai tuy chinh % toc do tho."""
    preset_modes: Optional[list[str]] = None


class EntitySummary(BaseModel):
    entity_id: str
    domain: str
    ha_friendly_name: str
    state: str
    alias: Optional[str] = None
    area: Optional[str] = None
    device_name: Optional[str] = None
    icon: Optional[str] = None
    favorite: bool = False
    added: bool = False
    category_id: Optional[str] = None
    # True = da them trong add-on nhung entity khong con ton tai trong HA.
    missing: bool = False
    climate: Optional[ClimateAttrs] = None
    light: Optional[LightAttrs] = None
    cover: Optional[CoverAttrs] = None
    fan: Optional[FanAttrs] = None


class SettingsIn(BaseModel):
    timezone: Optional[str] = None
    missed_execution_policy: Optional[str] = None
    show_countdown: Optional[bool] = None
    show_entity_name: Optional[bool] = None
    show_action: Optional[bool] = None
    show_days: Optional[bool] = None
    show_entity_id: Optional[bool] = None
    show_area: Optional[bool] = None
    show_device: Optional[bool] = None
    show_last_run: Optional[bool] = None
    show_next_run: Optional[bool] = None
    display_mode: Optional[str] = None  # compact | normal
    theme: Optional[str] = None  # light | dark | auto
    time_format: Optional[str] = None  # "24h" | "12h"
    sort_mode: Optional[str] = None  # auto | manual
    language: Optional[str] = None  # en (mac dinh) | vi
    reset_devices_on_startup: Optional[bool] = None
    # Tam dung MOI lich toi moc nay (ISO datetime, che do "đi vắng"). "" =
    # khong tam dung (gui "" de tiep tuc ngay, None = khong doi).
    pause_until: Optional[str] = None
    # Sau khi lich Bat/Tat chay 30s, doc lai trang thai that tu HA; sai thi
    # gui lai lenh 1 lan va canh bao neu van sai (v0.5.35, mac dinh tat).
    verify_state: Optional[bool] = None
    auto_off_section_index: Optional[int] = None


class HistoryEntry(BaseModel):
    id: str
    schedule_id: Optional[str]
    schedule_name: Optional[str]
    scheduled_for: Optional[str]
    executed_at: str
    status: str
    message: Optional[str]
    manual: bool = False
