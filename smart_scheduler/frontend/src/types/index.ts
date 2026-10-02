export interface HAAction {
  domain: string;
  service: string;
  service_data: Record<string, unknown>;
}

/** Dieu kien phu (muc "chỉ chạy khi có điều kiện" 2026-09-23, kieu Conditions
 * cua HA Automation) - lich CHI thuc thi neu entity_id dang o dung state
 * nay, kiem tra ngay truoc luc ban dinh goi service. Danh sach conditions
 * cua 1 Schedule la AND (phai dung HET moi dieu kien). */
export type ConditionOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

export interface ScheduleCondition {
  entity_id: string;
  state: string;
  /** Mac dinh "eq" (du lieu cu khong co field nay). gt/gte/lt/lte so sanh so. */
  operator?: ConditionOperator;
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  target_entities: string[];
  action: HAAction;
  days: number[]; // 0=Mon ... 6=Sun
  time: string; // "HH:MM:SS"; du lieu cu "HH:MM" duoc hieu la :00
  timezone: string;
  sort_order: number;
  group_id: string | null;
  favorite: boolean;
  skip_once: boolean;
  skip_until: string | null;
  start_date: string | null; // "YYYY-MM-DD", rong = khong gioi han
  end_date: string | null;
  // Kieu hen gio: "time" = gio co dinh (field `time` phia tren), "sunrise"/
  // "sunset" = tinh theo binh minh/hoang hon thuc te tai vi tri HA, +/-
  // `offset_minutes` phut (giong Google Home/Tuya/SmartThings).
  // "auto_off" (v0.5.44) = tu tat sau khi thiet bi BAT duoc `time` (do dai
  // HH:MM:SS, khong phai gio dong ho) - backend theo doi trang thai that.
  trigger_type: "time" | "sunrise" | "sunset" | "auto_off";
  offset_minutes: number;
  conditions: ScheduleCondition[];
  /** Cong tac TONG cua card tren trang Nha - doc lap voi `enabled` cua tung
   * lich (phan hoi 2026-09-24), lich chi chay khi ca hai deu bat. */
  card_enabled: boolean;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

/** Chi co gia tri khi domain === "climate" (muc "Dat che do may lanh"
 * 2026-09-23) - doc thang tu attributes cua HA, dung de gioi han UI chon
 * mode/nhiet do trong ScheduleEditor, khong luu rieng o backend. */
export interface ClimateAttrs {
  hvac_modes: string[];
  min_temp: number | null;
  max_temp: number | null;
  temp_step: number | null;
  fan_modes: string[] | null;
}

/** Chi co gia tri khi domain === "light". */
export interface LightAttrs {
  supported_color_modes: string[];
  min_color_temp_kelvin: number | null;
  max_color_temp_kelvin: number | null;
  effect_list: string[] | null;
}

/** Chi co gia tri khi domain === "cover". */
export interface CoverAttrs {
  supports_position: boolean;
  supports_tilt_position: boolean;
}

/** Chi co gia tri khi domain === "fan". */
export interface FanAttrs {
  preset_modes: string[] | null;
}

export interface EntitySummary {
  entity_id: string;
  domain: string;
  ha_friendly_name: string;
  state: string;
  alias: string | null;
  area: string | null;
  device_name: string | null;
  icon: string | null;
  favorite: boolean;
  added: boolean; // da duoc them thu cong trong Cai dat -> Thiet bi
  // Nhom PHAN LOAI tren trang Nha (muc "phan nhom + keo tha" 2026-09-23) -
  // tro toi Group.id, KHAC HOAN TOAN voi Schedule.group_id (cot do chi ghep
  // cap bat/tat cua 1 "Khung gio", xem utils/scheduleRange.ts). null = chua
  // phan nhom.
  category_id: string | null;
  /** Da them trong add-on nhung entity khong con trong HA (v0.5.27). */
  missing?: boolean;
  climate: ClimateAttrs | null;
  light: LightAttrs | null;
  cover: CoverAttrs | null;
  fan: FanAttrs | null;
}

/** Nhom PHAN LOAI thiet bi tren trang Nha, nguoi dung tu tao/doi ten/xoa/keo
 * sap thu tu trong Cai dat -> Nhom. Gan cho tung entity qua
 * `EntitySummary.category_id` (PUT /entities/{id}/alias). */
export interface Group {
  id: string;
  name: string;
  sort_order: number;
}

/** "Bat cuong che" + tu tat sau X phut - KHONG phai Schedule. Hen co
 * `off_at` duoc luu SQLite va khoi phuc qua restart Add-on. */
export interface ManualTimer {
  id: string | null;
  entity_ids: string[];
  started_at: string | null;
  off_at: string | null;
  /** "auto_off" = dem nguoc cua lich "Tu tat sau khi bat" (khong huy duoc). */
  source?: "auto_off";
}

export interface HistoryEntry {
  id: string;
  schedule_id: string | null;
  schedule_name: string | null;
  scheduled_for: string | null;
  executed_at: string;
  status: string;
  message: string | null;
  manual: boolean;
}

export interface Settings {
  timezone: string;
  missed_execution_policy: "skip" | "run_once";
  show_countdown: boolean;
  show_entity_name: boolean;
  show_action: boolean;
  show_days: boolean;
  show_entity_id: boolean;
  show_area: boolean;
  show_device: boolean;
  show_last_run: boolean;
  show_next_run: boolean;
  display_mode: DisplayMode;
  theme: "light" | "dark" | "auto";
  time_format: "24h" | "12h";
  sort_mode: "auto" | "manual";
  language: "vi" | "en";
  reset_devices_on_startup: boolean;
  /** Tam dung MOI lich toi moc nay (ISO), "" = khong tam dung. */
  pause_until: string;
  /** Tu doc lai trang thai thiet bi 30s sau khi lich Bat/Tat chay, sai thi gui lai lenh. */
  verify_state: boolean;
  /** Vi tri khoi "Tu tat sau khi bat" giua cac nhom tren Nha (0 = tren cung). */
  auto_off_section_index: number;
  /** Mui gio doc tu cau hinh Home Assistant (chi doc), null neu chua doc duoc. */
  ha_timezone?: string | null;
}

/** "Giả lập có người" - bat lan luot ngau nhien thiet bi da chon trong
 * khung gio, moi lan sang on_min..on_max phut, nghi gap_min..gap_max phut. */
export interface PresenceConfig {
  enabled: boolean;
  entity_ids: string[];
  days: number[];
  start: string; // "HH:MM"
  end: string;
  on_min: number;
  on_max: number;
  gap_min: number;
  gap_max: number;
  max_concurrent: number;
  start_mode: "time" | "sunset";
  until: string;
  cooldown_minutes: number;
  max_total_minutes: number;
  brightness_pct: number;
}

export interface PresenceStatus {
  planned?: { entity_id: string; on_at: string; off_at: string }[];
  on: { entity_id: string; off_at: string }[];
  next_start_at: string | null;
  active: boolean;
  enabled?: boolean;
  phase?: "disabled" | "expired" | "waiting_window" | "waiting_next" | "running" | "budget_exhausted" | "error" | "stopping";
  used_minutes?: number;
  max_total_minutes?: number;
  pending_off?: string[];
  warnings?: { entity_id: string; message: string }[];
}

export interface PresencePreview {
  events: { entity_id: string; on_at: string; off_at: string }[];
  total_minutes: number;
  window_start: string | null;
  window_end: string | null;
}

export interface HealthStatus {
  status: "ok";
  ha_connection_mode: "supervisor_proxy" | "direct_core_fallback" | "unavailable";
}

/** Nhom cac Schedule co cung 1 thiet bi (hoac cung 1 nhom thiet bi) thanh 1
 * "card" tren Home - day la don vi hien thi chinh cua UI moi (muc 6/102
 * SPEC_UI.md), khac han Schedule (don vi luu tru o backend). Tinh hoan
 * toan phia client tu danh sach schedules, khong doi schema backend. */
/** Kieu xem trang Nha: "compact" (luoi card), "list" (hang gon 1 dong/thiet
 * bi, v0.5.62), "agenda" (Theo gio) va "timeline" (Bang 24h) - v0.5.64. v0.5.63 bo "normal" vi gan nhu y het "compact" - gia tri
 * "normal" cu con luu trong Cai dat duoc hien thanh "compact". */
export type DisplayMode = "compact" | "list" | "agenda" | "timeline";

export interface DeviceGroup {
  key: string;
  title: string;
  area: string | null;
  domain: string;
  entityIds: string[];
  singleEntity: EntitySummary | null; // co gia tri khi group chi co 1 entity
  schedules: Schedule[];
  favorite: boolean;
  isOn: boolean;
  /** Entity cua card khong con trong HA (backend missing=True) - hien dau
   * nhac nhe, KHONG tinh "unavailable" (offline tam thoi). */
  missingIds: string[];
  minSortOrder: number;
}

export const WEEKDAY_LABELS_VI = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [0, 1, 2, 3, 4];
export const WEEKEND = [5, 6];
