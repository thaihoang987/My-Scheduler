import type { ConditionOperator, EntitySummary, ScheduleCondition } from "../types";
import { tr } from "../i18n";

/** Cac trang thai co san de chon cho 1 dieu kien (phan hoi 2026-09-24 "để
 * sẵn các điều kiện để xổ ra chọn") - value la state THAT cua HA (so sanh
 * bang == o backend, scheduler_engine._conditions_met), label tieng Viet. */
export interface ConditionStateOption {
  value: string;
  label: string;
}

const ON_OFF: ConditionStateOption[] = [
  { value: "on", label: "Bật" },
  { value: "off", label: "Tắt" },
];

const HVAC_LABELS: Record<string, string> = {
  off: "Tắt",
  cool: "Làm lạnh (Cool)",
  heat: "Sưởi (Heat)",
  fan_only: "Quạt (Fan)",
  dry: "Hút ẩm (Dry)",
  auto: "Tự động (Auto)",
  heat_cool: "Nóng/Lạnh (Heat/Cool)",
};

const BY_DOMAIN: Record<string, ConditionStateOption[]> = {
  switch: ON_OFF,
  light: ON_OFF,
  fan: ON_OFF,
  input_boolean: ON_OFF,
  binary_sensor: ON_OFF,
  automation: ON_OFF,
  siren: ON_OFF,
  humidifier: ON_OFF,
  remote: ON_OFF,
  cover: [
    { value: "open", label: "Đang mở" },
    { value: "closed", label: "Đang đóng" },
    { value: "opening", label: "Đang mở ra" },
    { value: "closing", label: "Đang đóng lại" },
  ],
  lock: [
    { value: "locked", label: "Đã khoá" },
    { value: "unlocked", label: "Đã mở khoá" },
    { value: "jammed", label: "Bị kẹt" },
  ],
  media_player: [
    { value: "on", label: "Bật" },
    { value: "off", label: "Tắt" },
    { value: "playing", label: "Đang phát" },
    { value: "paused", label: "Tạm dừng" },
    { value: "idle", label: "Chờ" },
  ],
  alarm_control_panel: [
    { value: "disarmed", label: "Tắt báo động" },
    { value: "armed_home", label: "Bật - ở nhà" },
    { value: "armed_away", label: "Bật - đi vắng" },
    { value: "armed_night", label: "Bật - ban đêm" },
    { value: "triggered", label: "Đang báo động" },
  ],
  person: [
    { value: "home", label: "Ở nhà" },
    { value: "not_home", label: "Vắng nhà" },
  ],
  device_tracker: [
    { value: "home", label: "Ở nhà" },
    { value: "not_home", label: "Vắng nhà" },
  ],
  sun: [
    { value: "above_horizon", label: "Ban ngày" },
    { value: "below_horizon", label: "Ban đêm" },
  ],
  water_heater: [
    { value: "off", label: "Tắt" },
    { value: "eco", label: "Tiết kiệm" },
    { value: "electric", label: "Điện" },
    { value: "performance", label: "Hiệu suất cao" },
  ],
};

/** null = domain khong co danh sach san -> UI cho go tay. */
export function conditionStateOptions(entity: EntitySummary | undefined): ConditionStateOption[] | null {
  if (!entity) return null;
  if (entity.domain === "climate") {
    const modes = entity.climate?.hvac_modes?.length ? entity.climate.hvac_modes : Object.keys(HVAC_LABELS);
    const en: Record<string, string> = { off: "Off", cool: "Cool", heat: "Heat", fan_only: "Fan", dry: "Dry", auto: "Auto", heat_cool: "Heat/Cool" };
    return modes.map((m) => ({ value: m, label: tr(HVAC_LABELS[m] ?? m, en[m] ?? m) }));
  }
  const options = BY_DOMAIN[entity.domain];
  if (!options) return null;
  const english: Record<string, string> = {
    "Bật": "On", "Tắt": "Off", "Đang mở": "Open", "Đang đóng": "Closed", "Đang mở ra": "Opening", "Đang đóng lại": "Closing",
    "Đã khoá": "Locked", "Đã mở khoá": "Unlocked", "Bị kẹt": "Jammed", "Đang phát": "Playing", "Tạm dừng": "Paused", "Chờ": "Idle",
    "Tắt báo động": "Disarmed", "Bật - ở nhà": "Armed home", "Bật - đi vắng": "Armed away", "Bật - ban đêm": "Armed night", "Đang báo động": "Triggered",
    "Ở nhà": "Home", "Vắng nhà": "Away", "Ban ngày": "Daytime", "Ban đêm": "Nighttime", "Tiết kiệm": "Eco", "Điện": "Electric", "Hiệu suất cao": "Performance",
  };
  return options.map((option) => ({ ...option, label: tr(option.label, english[option.label] ?? option.label) }));
}

/** State mac dinh khi vua them dieu kien - climate uu tien "cool", cover
 * uu tien "open", con lai lay lua chon dau tien (thuong la "on"). */
export function defaultConditionState(entity: EntitySummary | undefined): string {
  const options = conditionStateOptions(entity);
  if (!options?.length) return "on";
  const preferred = options.find((o) => o.value === "cool" || o.value === "open");
  return (preferred ?? options[0]).value;
}

/** Phep so sanh cho dieu kien (v0.5.32). Thiet bi co danh sach trang thai
 * san chi can "là"/"không là"; cam bien/so (sensor, input_number...) them
 * so sanh lon/nho (vd "Độ ẩm < 60"). */
export function operatorLabel(operator: ConditionOperator): string {
  return { eq: tr("là", "is"), ne: tr("không là", "is not"), gt: ">", gte: "≥", lt: "<", lte: "≤" }[operator];
}

export function operatorsFor(entity: EntitySummary | undefined): ConditionOperator[] {
  return conditionStateOptions(entity) ? ["eq", "ne"] : ["eq", "ne", "gt", "gte", "lt", "lte"];
}

/** Tom tat dieu kien NGAN NHAT de hien ngoai danh sach lich (v0.5.77, dung
 * chung moi thiet bi): dieu kien tren chinh thiet bi cua lich thi bo ten
 * (vd may lanh "Làm lạnh"), thiet bi khac thi them ten ("Đèn hành lang Bật");
 * nhan bo phan "(Cool)" trong ngoac; nhieu dieu kien thi hien cai dau + "+N".
 * Khong co dieu kien -> null. */
export function conditionSummary(
  conditions: ScheduleCondition[] | undefined,
  targetIds: string[],
  entities: EntitySummary[],
): string | null {
  if (!conditions?.length) return null;
  const one = (c: ScheduleCondition) => {
    const entity = entities.find((e) => e.entity_id === c.entity_id);
    const op = c.operator ?? "eq";
    const option = conditionStateOptions(entity)?.find((o) => o.value === c.state);
    const state = option ? option.label.replace(/\s*\(.*\)$/, "") : c.state;
    const value = op === "eq" ? state : `${operatorLabel(op)} ${state}`;
    if (targetIds.length === 1 && targetIds[0] === c.entity_id) return value;
    const name = entity?.alias || entity?.ha_friendly_name || c.entity_id;
    return `${name} ${value}`;
  };
  return conditions.length === 1 ? one(conditions[0]) : `${one(conditions[0])} +${conditions.length - 1}`;
}
