import { api } from "../services/api";
import type { ClimateAttrs, CoverAttrs, EntitySummary, FanAttrs, HAAction, LightAttrs, Schedule, ScheduleCondition } from "../types";
import { ALL_DAYS } from "../types";
import { appLocale, tr } from "../i18n";

/** Lich dang "khung gio" (bat luc X -> tat luc Y, 1 don vi trong UI) duoc
 * luu thanh 2 dong Schedule (turn_on + turn_off) dung chung `group_id` (cot
 * co san tu SPEC.md, chua tung dung) - khong doi schema backend. Phan hoi
 * 2026-09-22: "lich thi dang tu gio nao toi gio nao, lam y chang [anh
 * daily-schedule-card] nhung thay bang wheel picker". */

export interface ScheduleDraft {
  target_entities: string[];
  // "climate_set"/"light_set"/"cover_set"/"fan_set" = hanh dong rieng theo
  // domain (xem ClimateActionEditor/LightActionEditor/CoverActionEditor/
  // FanActionEditor.tsx) - chi hien khi TAT CA thiet bi chon cung domain do,
  // chi ap dung che do "1 gio" (giong trigger_type sunrise/sunset).
  action_service: "turn_on" | "turn_off" | "toggle" | "climate_set" | "light_set" | "cover_set" | "fan_set";
  time: string;
  end_time: string | null; // co gia tri = che do "khung gio" (bat->tat)
  days: number[];
  start_date: string | null;
  end_date: string | null;
  // Kieu hen gio: "time" = gio co dinh (field `time`), "sunrise"/"sunset" =
  // binh minh/hoang hon +/- `offset_minutes`. Che do "Khung gio" chi ap dung
  // cho moc BAT (moc TAT luon la gio co dinh `end_time`). "auto_off" = tu
  // tat sau khi bat, `time` la DO DAI "HH:MM:SS" (xem backend auto_off.py).
  trigger_type: "time" | "sunrise" | "sunset" | "auto_off";
  offset_minutes: number;
  // Moc TAT cua "Khung gio" (v0.5.51): gio co dinh (`end_time`) hoac binh minh/
  // hoang hon +/- phut - vd bat luc hoang hon, tat luc binh minh.
  end_trigger_type: "time" | "sunrise" | "sunset";
  end_offset_minutes: number;
  // Chi dung khi action_service === "climate_set".
  climate_hvac_mode: string | null;
  climate_temperature: number | null;
  // Chi dung khi action_service === "light_set".
  light_brightness_pct: number | null;
  light_color_temp_kelvin: number | null;
  light_rgb_color: [number, number, number] | null;
  // Chi dung khi action_service === "cover_set".
  cover_position: number | null;
  // Chi dung khi action_service === "fan_set" - CHI 1 trong 2 co gia tri
  // tai 1 thoi diem (fan_preset_mode uu tien neu co, giong hanh vi thuc te
  // cua quat: dang "che do dung san" thi khong con la "% tho" nua).
  fan_percentage: number | null;
  fan_preset_mode: string | null;
  // Dieu kien phu (muc "chỉ chạy khi có điều kiện" 2026-09-23, kieu
  // Conditions cua HA Automation) - lich CHI thuc thi neu TAT CA dieu kien
  // dung (AND), rong = luon chay (hanh vi cu). Ap dung CHUNG cho ca 2 dong
  // Bat/Tat khi la "Khung gio" (khong tach rieng dieu kien theo huong).
  conditions: ScheduleCondition[];
  // Dieu kien rieng cua moc TAT khi la "Khung gio" (v0.5.35) - truoc day dung
  // chung `conditions` voi moc Bat: dieu kien sai luc toi gio Tat thi thiet
  // bi bat mai. Rong = luon tat dung gio.
  end_conditions: ScheduleCondition[];
}

export const EMPTY_DRAFT: ScheduleDraft = {
  target_entities: [],
  action_service: "turn_on",
  time: "18:30:00",
  end_time: "19:30:00",
  days: ALL_DAYS,
  start_date: null,
  end_date: null,
  trigger_type: "time",
  offset_minutes: 0,
  end_trigger_type: "time",
  end_offset_minutes: 0,
  climate_hvac_mode: null,
  climate_temperature: null,
  light_brightness_pct: null,
  light_color_temp_kelvin: null,
  light_rgb_color: null,
  cover_position: null,
  fan_percentage: null,
  fan_preset_mode: null,
  conditions: [],
  end_conditions: [],
};

function actionLabel(action: "turn_on" | "turn_off" | "toggle"): string {
  return { turn_on: tr("Bật", "Turn on"), turn_off: tr("Tắt", "Turn off"), toggle: tr("Đảo trạng thái", "Toggle") }[action];
}

/** Nhan tieng Viet cho hvac_mode cua climate - dung chung ScheduleEditor
 * (chon mode) va draftName/describeAction (hien thi). Mode la khoa API
 * chuan cua HA (climate.hvac_mode), khong duoc dich nguoc lai khi goi service. */
export const HVAC_MODE_LABEL: Record<string, string> = {
  off: "Tắt",
  cool: "Làm lạnh",
  heat: "Sưởi ấm",
  heat_cool: "Nóng/Lạnh",
  auto: "Tự động",
  dry: "Hút ẩm",
  fan_only: "Quạt",
};

export function hvacModeLabel(mode: string): string {
  const vi = HVAC_MODE_LABEL[mode];
  const en: Record<string, string> = { off: "Off", cool: "Cool", heat: "Heat", heat_cool: "Heat/Cool", auto: "Auto", dry: "Dry", fan_only: "Fan" };
  return vi ? tr(vi, en[mode] ?? mode) : mode;
}

/** true neu mode nay khong dung nhiet do dich (an thanh phan chinh nhiet do
 * trong UI va khong gui `temperature` khi goi service). */
export function hvacModeIsTemperatureless(mode: string | null): boolean {
  return mode === "off" || mode === "fan_only";
}

function domainOf(entityId: string): string {
  return entityId.split(".", 1)[0];
}

/** Thong tin climate dung cho ScheduleEditor khi chon 1 hoac nhieu thiet bi
 * may lanh cung luc - lay giao cua hvac_modes (mode nao CA 2 may deu ho tro)
 * va khoang nhiet do AN TOAN cho ca 2 (min lon nhat, max nho nhat), tranh
 * gui nhiet do vuot gioi han rieng cua 1 trong so cac may. Truong hop don le
 * (1 thiet bi, da so thuc te) chi don gian la thong tin cua chinh no. */
export function mergeClimateAttrs(entityIds: string[], entities: EntitySummary[]): ClimateAttrs | null {
  const list = entityIds.map((id) => entities.find((e) => e.entity_id === id)?.climate).filter((c): c is ClimateAttrs => !!c);
  if (list.length === 0) return null;
  const modeSets = list.map((c) => new Set(c.hvac_modes));
  const hvac_modes = [...modeSets[0]].filter((m) => modeSets.every((s) => s.has(m)));
  const mins = list.map((c) => c.min_temp).filter((v): v is number => v != null);
  const maxs = list.map((c) => c.max_temp).filter((v): v is number => v != null);
  const steps = list.map((c) => c.temp_step).filter((v): v is number => v != null);
  return {
    hvac_modes,
    min_temp: mins.length ? Math.max(...mins) : null,
    max_temp: maxs.length ? Math.min(...maxs) : null,
    temp_step: steps.length ? Math.max(...steps) : null,
    fan_modes: null,
  };
}

/** Giao cua danh sach (vd hvac_modes/preset_modes) cua nhieu thiet bi cung
 * luc - mode nao CA TAT CA thiet bi deu ho tro. Dung chung cho climate/fan. */
function intersectLists(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  const sets = lists.map((l) => new Set(l));
  return [...sets[0]].filter((m) => sets.every((s) => s.has(m)));
}

/** Thong tin light dung cho ScheduleEditor - giao cua supported_color_modes,
 * khoang color_temp AN TOAN chung (giong logic mergeClimateAttrs). */
export function mergeLightAttrs(entityIds: string[], entities: EntitySummary[]): LightAttrs | null {
  const list = entityIds.map((id) => entities.find((e) => e.entity_id === id)?.light).filter((c): c is LightAttrs => !!c);
  if (list.length === 0) return null;
  const mins = list.map((c) => c.min_color_temp_kelvin).filter((v): v is number => v != null);
  const maxs = list.map((c) => c.max_color_temp_kelvin).filter((v): v is number => v != null);
  return {
    supported_color_modes: intersectLists(list.map((c) => c.supported_color_modes)),
    min_color_temp_kelvin: mins.length ? Math.max(...mins) : null,
    max_color_temp_kelvin: maxs.length ? Math.min(...maxs) : null,
    effect_list: null,
  };
}

/** true neu bat ky thiet bi nao trong danh sach ho tro vi tri (set_cover_position)
 * - khac climate/light/fan, cover khong the "giao" gioi han so nen chi can
 * biet co dung duoc set_cover_position hay khong (da so nha chi co 1 loai rem). */
export function mergeCoverAttrs(entityIds: string[], entities: EntitySummary[]): CoverAttrs | null {
  const list = entityIds.map((id) => entities.find((e) => e.entity_id === id)?.cover).filter((c): c is CoverAttrs => !!c);
  if (list.length === 0) return null;
  return {
    supports_position: list.every((c) => c.supports_position),
    supports_tilt_position: list.every((c) => c.supports_tilt_position),
  };
}

export function mergeFanAttrs(entityIds: string[], entities: EntitySummary[]): FanAttrs | null {
  const list = entityIds.map((id) => entities.find((e) => e.entity_id === id)?.fan).filter((c): c is FanAttrs => !!c);
  if (list.length === 0) return null;
  const withPresets = list.filter((c): c is FanAttrs & { preset_modes: string[] } => !!c.preset_modes?.length);
  return { preset_modes: withPresets.length === list.length ? intersectLists(withPresets.map((c) => c.preset_modes)) : null };
}

/** Nhan hien thi hanh dong tu 1 Schedule DA LUU (khong phai draft) - dung
 * chung ScheduleRow/ScheduleDetailSheet/DeviceDetail thay vi tu suy doan
 * rieng le tung noi. */
export function describeAction(action: HAAction): string {
  if (action.domain === "climate" && (action.service === "set_temperature" || action.service === "set_hvac_mode")) {
    const mode = (action.service_data.hvac_mode as string) ?? null;
    const temp = action.service_data.temperature as number | undefined;
    const modeText = mode ? hvacModeLabel(mode) : tr("Đặt chế độ", "Set mode");
    return temp != null ? `${modeText} ${temp}°C` : modeText;
  }
  if (action.domain === "light" && action.service === "turn_on") {
    const parts: string[] = [];
    if (action.service_data.brightness_pct != null) parts.push(`${action.service_data.brightness_pct}%`);
    if (action.service_data.color_temp_kelvin != null) parts.push(`${action.service_data.color_temp_kelvin}K`);
    if (action.service_data.rgb_color != null) parts.push(tr("Màu tùy chỉnh", "Custom color"));
    if (parts.length) return `${tr("Đèn", "Light")} ${parts.join(" · ")}`;
  }
  if (action.domain === "cover" && action.service === "set_cover_position") {
    const pos = action.service_data.position as number;
    if (pos === 0) return tr("Đóng hoàn toàn", "Fully closed");
    if (pos === 100) return tr("Mở hoàn toàn", "Fully open");
    return tr(`Mở ${pos}%`, `Open ${pos}%`);
  }
  if (action.domain === "fan" && action.service === "set_percentage") return `${tr("Quạt", "Fan")} ${action.service_data.percentage}%`;
  if (action.domain === "fan" && action.service === "set_preset_mode") return `${tr("Quạt", "Fan")}: ${action.service_data.preset_mode}`;
  if (action.service === "turn_on") return tr("Bật", "Turn on");
  if (action.service === "turn_off") return tr("Tắt", "Turn off");
  if (action.service === "toggle") return tr("Đảo trạng thái", "Toggle");
  return action.service;
}

/** Nhan hien thi cho 1 moc gio - "18:30:00" (kieu "time") hoac "Bình minh
 * +15p"/"Hoàng hôn -10p" (kieu sunrise/sunset), dung chung cho ten lich tu
 * dong sinh, ScheduleRow, ScheduleDetailSheet, DeviceDetail hero. */
/** "30 phút" / "1 giờ 30 phút" / "45 giây" tu chuoi do dai "HH:MM:SS". */
export function formatDuration(value: string): string {
  const [h = 0, m = 0, s = 0] = value.split(":").map(Number);
  const parts: string[] = [];
  if (h) parts.push(`${h} ${tr("giờ", h > 1 ? "hours" : "hour")}`);
  if (m) parts.push(`${m} ${tr("phút", "min")}`);
  if (s) parts.push(`${s} ${tr("giây", "sec")}`);
  return parts.join(" ") || `0 ${tr("phút", "min")}`;
}

export function autoOffLabel(duration: string): string {
  return `⏱ ${tr("Tự tắt sau", "Auto-off after")} ${formatDuration(duration)}`;
}

export function triggerLabel(triggerType: Schedule["trigger_type"], offsetMinutes: number, time: string): string {
  if (triggerType === "time") return time;
  if (triggerType === "auto_off") return autoOffLabel(time);
  const base = triggerType === "sunrise" ? tr("Bình minh", "Sunrise") : tr("Hoàng hôn", "Sunset");
  if (!offsetMinutes) return base;
  return `${base} ${offsetMinutes > 0 ? "+" : ""}${offsetMinutes}p`;
}

/** Giong triggerLabel() nhung kem gio dong ho UOC TINH tu `next_run` da luu
 * (vd "Bình minh +15p (~05:58)") - phan hoi 2026-09-23: "phai co thoi gian
 * hien thi nho cho nguoi dung biet khi nao". `next_run` la lan chay THUC TE
 * tiep theo (co the la ngay mai neu hom nay da qua), nen chi ghi la uoc
 * tinh, khong phai gio chinh xac se chay MOI NGAY (gio mat troi xe di vai
 * phut/ngay theo mua). */
export function triggerLabelWithClock(
  triggerType: Schedule["trigger_type"],
  offsetMinutes: number,
  time: string,
  nextRun: string | null,
): string {
  const label = triggerLabel(triggerType, offsetMinutes, time);
  if (triggerType === "time" || triggerType === "auto_off" || !nextRun) return label;
  const clock = new Date(nextRun).toLocaleTimeString(appLocale(), { hour: "2-digit", minute: "2-digit" });
  return `${label} (~${clock})`;
}

/** Tu dat ten lich theo thiet bi + hanh dong - bo hoan toan o "Ten lich"
 * nguoi dung phai go tay (phan hoi truoc do: muon don gian nhu
 * daily-schedule-card, giam buoc trong form Them lich). */
export function draftName(draft: ScheduleDraft, entities: EntitySummary[]): string {
  const nameOf = (id: string) => entities.find((e) => e.entity_id === id)?.alias || entities.find((e) => e.entity_id === id)?.ha_friendly_name || id;
  const deviceLabel =
    draft.target_entities.length === 0
      ? tr("Chưa chọn thiết bị", "No device selected")
      : draft.target_entities.length === 1
        ? nameOf(draft.target_entities[0])
        : `${draft.target_entities.length} ${tr("thiết bị", "devices")}`;
  if (draft.trigger_type === "auto_off") return `${deviceLabel} · ${autoOffLabel(draft.time)}`;
  if (draft.end_time) {
    const on = triggerLabel(draft.trigger_type, draft.offset_minutes, draft.time);
    const off = triggerLabel(draft.end_trigger_type, draft.end_offset_minutes, draft.end_time);
    return `${deviceLabel} · ${on}→${off}`;
  }
  if (draft.action_service === "climate_set") {
    const modeText = draft.climate_hvac_mode ? hvacModeLabel(draft.climate_hvac_mode) : tr("Đặt chế độ", "Set mode");
    const tempText = draft.climate_temperature != null && !hvacModeIsTemperatureless(draft.climate_hvac_mode) ? ` ${draft.climate_temperature}°C` : "";
    return `${deviceLabel} · ${modeText}${tempText}`;
  }
  if (draft.action_service === "light_set") {
    return `${deviceLabel} · ${describeAction(draftToAction(draft))}`;
  }
  if (draft.action_service === "cover_set") {
    return `${deviceLabel} · ${describeAction(draftToAction(draft))}`;
  }
  if (draft.action_service === "fan_set") {
    return `${deviceLabel} · ${describeAction(draftToAction(draft))}`;
  }
  const triggerSuffix = draft.trigger_type === "time" ? "" : ` (${triggerLabel(draft.trigger_type, draft.offset_minutes, draft.time)})`;
  return `${deviceLabel} · ${actionLabel(draft.action_service)}${triggerSuffix}`;
}

export function draftToAction(draft: ScheduleDraft): HAAction {
  const domains = new Set(draft.target_entities.map(domainOf));
  const domain = domains.size === 1 ? [...domains][0] : "homeassistant";
  if (draft.action_service === "climate_set") {
    const mode = draft.climate_hvac_mode ?? undefined;
    const hasTemp = draft.climate_temperature != null && !hvacModeIsTemperatureless(draft.climate_hvac_mode);
    if (hasTemp) {
      return { domain: "climate", service: "set_temperature", service_data: { temperature: draft.climate_temperature, ...(mode ? { hvac_mode: mode } : {}) } };
    }
    return { domain: "climate", service: "set_hvac_mode", service_data: { hvac_mode: mode } };
  }
  if (draft.action_service === "light_set") {
    const service_data: Record<string, unknown> = {};
    if (draft.light_brightness_pct != null) service_data.brightness_pct = draft.light_brightness_pct;
    if (draft.light_color_temp_kelvin != null) service_data.color_temp_kelvin = draft.light_color_temp_kelvin;
    if (draft.light_rgb_color != null) service_data.rgb_color = draft.light_rgb_color;
    return { domain: "light", service: "turn_on", service_data };
  }
  if (draft.action_service === "cover_set") {
    return { domain: "cover", service: "set_cover_position", service_data: { position: draft.cover_position ?? 100 } };
  }
  if (draft.action_service === "fan_set") {
    if (draft.fan_preset_mode) {
      return { domain: "fan", service: "set_preset_mode", service_data: { preset_mode: draft.fan_preset_mode } };
    }
    return { domain: "fan", service: "set_percentage", service_data: { percentage: draft.fan_percentage ?? 100 } };
  }
  return { domain, service: draft.action_service, service_data: {} };
}

export function findSibling(schedule: Schedule, allSchedules: Schedule[]): Schedule | null {
  if (!schedule.group_id) return null;
  return allSchedules.find((s) => s.id !== schedule.id && s.group_id === schedule.group_id) ?? null;
}

/** Nap 1 Schedule (+ anh em cung group_id neu co) thanh ScheduleDraft de
 * hien thi trong ScheduleEditor. */
export function draftFromSchedule(schedule: Schedule, allSchedules: Schedule[]): ScheduleDraft {
  const sibling = findSibling(schedule, allSchedules);
  if (sibling) {
    const onS = schedule.action.service === "turn_on" ? schedule : sibling;
    const offS = schedule.action.service === "turn_off" ? schedule : sibling;
    return {
      target_entities: schedule.target_entities,
      action_service: "turn_on",
      time: onS.time,
      end_time: offS.time,
      days: schedule.days,
      start_date: schedule.start_date,
      end_date: schedule.end_date,
      // Moc BAT cua khung gio co the theo binh minh/hoang hon (v0.5.32),
      // moc TAT luon la gio co dinh.
      trigger_type: onS.trigger_type ?? "time",
      offset_minutes: onS.offset_minutes ?? 0,
      end_trigger_type: (offS.trigger_type === "sunrise" || offS.trigger_type === "sunset" ? offS.trigger_type : "time"),
      end_offset_minutes: offS.offset_minutes ?? 0,
      climate_hvac_mode: null,
      climate_temperature: null,
      light_brightness_pct: null,
      light_color_temp_kelvin: null,
      light_rgb_color: null,
      cover_position: null,
      fan_percentage: null,
      fan_preset_mode: null,
      conditions: onS.conditions,
      end_conditions: offS.conditions,
    };
  }
  const { domain, service, service_data } = schedule.action;
  const isClimateAction = domain === "climate" && (service === "set_temperature" || service === "set_hvac_mode");
  const isLightAction = domain === "light" && service === "turn_on" && (service_data.brightness_pct != null || service_data.color_temp_kelvin != null || service_data.rgb_color != null);
  const isCoverAction = domain === "cover" && service === "set_cover_position";
  const isFanAction = domain === "fan" && (service === "set_percentage" || service === "set_preset_mode");
  const actionService: ScheduleDraft["action_service"] = isClimateAction
    ? "climate_set"
    : isLightAction
      ? "light_set"
      : isCoverAction
        ? "cover_set"
        : isFanAction
          ? "fan_set"
          : (service as ScheduleDraft["action_service"]) || "turn_on";
  return {
    target_entities: schedule.target_entities,
    action_service: actionService,
    time: schedule.time,
    end_time: null,
    days: schedule.days,
    start_date: schedule.start_date,
    end_date: schedule.end_date,
    trigger_type: schedule.trigger_type,
    offset_minutes: schedule.offset_minutes,
    end_trigger_type: "time",
    end_offset_minutes: 0,
    climate_hvac_mode: isClimateAction ? ((service_data.hvac_mode as string) ?? null) : null,
    climate_temperature: isClimateAction ? ((service_data.temperature as number) ?? null) : null,
    light_brightness_pct: isLightAction ? ((service_data.brightness_pct as number) ?? null) : null,
    light_color_temp_kelvin: isLightAction ? ((service_data.color_temp_kelvin as number) ?? null) : null,
    light_rgb_color: isLightAction ? ((service_data.rgb_color as [number, number, number]) ?? null) : null,
    cover_position: isCoverAction ? ((service_data.position as number) ?? null) : null,
    fan_percentage: isFanAction && service === "set_percentage" ? ((service_data.percentage as number) ?? null) : null,
    fan_preset_mode: isFanAction && service === "set_preset_mode" ? ((service_data.preset_mode as string) ?? null) : null,
    conditions: schedule.conditions,
    end_conditions: [],
  };
}

/** Luu 1 ScheduleDraft - tu dong xu ly ca 2 truong hop:
 * - draft.end_time = null -> 1 Schedule don (nhu truoc), neu schedule dang
 *   sua von la 1 nua cua cap khung gio (co group_id) thi xoa not nua kia
 *   (nguoi dung vua chuyen tu "Khung gio" ve "Chi 1 gio").
 * - draft.end_time co gia tri -> 2 Schedule (turn_on/turn_off) dung chung
 *   group_id, tao moi hoac update dung 2 dong da co san neu dang sua. */
/** `cardEnabled`: trang thai cong tac tong cua card dang them lich vao -
 * lich MOI ke thua theo de khong tu chay khi card dang tat. Sua lich co san
 * thi khong gui (backend giu nguyen). */
export async function saveScheduleDraft(
  draft: ScheduleDraft,
  entities: EntitySummary[],
  editing: Schedule | null,
  allSchedules: Schedule[],
  cardEnabled = true,
): Promise<void> {
  const sibling = editing ? findSibling(editing, allSchedules) : null;
  const base = {
    target_entities: draft.target_entities,
    days: draft.days,
    start_date: draft.start_date,
    end_date: draft.end_date,
    enabled: true,
  };

  if (!draft.end_time) {
    if (sibling) await api.deleteSchedule(sibling.id);
    const autoOff = draft.trigger_type === "auto_off";
    const payload = {
      ...base,
      // Tu tat khong dung ngay lap/khoang ngay/dieu kien - luon ap dung.
      ...(autoOff ? { days: ALL_DAYS, start_date: null, end_date: null, group_id: null } : {}),
      name: draftName(draft, entities),
      action: draftToAction(autoOff ? { ...draft, action_service: "turn_off" } : draft),
      conditions: autoOff ? [] : draft.conditions,
      time: draft.time,
      trigger_type: draft.trigger_type,
      offset_minutes: draft.offset_minutes,
    };
    if (editing) await api.updateSchedule(editing.id, payload);
    else await api.createSchedule({ ...payload, card_enabled: cardEnabled });
    return;
  }

  const onExisting = editing?.action.service === "turn_on" ? editing : sibling?.action.service === "turn_on" ? sibling : null;
  const offExisting = editing?.action.service === "turn_off" ? editing : sibling?.action.service === "turn_off" ? sibling : null;
  const groupId = editing?.group_id ?? crypto.randomUUID();
  const name = draftName(draft, entities);
  const domain = draftToAction({ ...draft, action_service: "turn_on" }).domain;

  // Moi moc Bat/Tat deu la gio co dinh hoac binh minh/hoang hon +/- phut (moc
  // Bat tu v0.5.32, moc Tat tu v0.5.51) - gui ro rang ca 2 field vi
  // update_schedule() merge tu ban cu neu thieu field se giu nham gia tri cu.
  const onPayload = {
    ...base,
    name,
    action: { domain, service: "turn_on", service_data: {} },
    time: draft.time,
    group_id: groupId,
    trigger_type: draft.trigger_type,
    offset_minutes: draft.trigger_type === "time" ? 0 : draft.offset_minutes,
    conditions: draft.conditions,
  };
  const offPayload = {
    ...base,
    name,
    action: { domain, service: "turn_off", service_data: {} },
    time: draft.end_time,
    group_id: groupId,
    trigger_type: draft.end_trigger_type,
    offset_minutes: draft.end_trigger_type === "time" ? 0 : draft.end_offset_minutes,
    conditions: draft.end_conditions,
  };

  const cardFlag = editing ? editing.card_enabled : cardEnabled;
  if (onExisting) await api.updateSchedule(onExisting.id, onPayload);
  else await api.createSchedule({ ...onPayload, card_enabled: cardFlag });
  if (offExisting) await api.updateSchedule(offExisting.id, offPayload);
  else await api.createSchedule({ ...offPayload, card_enabled: cardFlag });
}

function toSeconds(t: string): number {
  const [h = 0, m = 0, s = 0] = t.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

/** Validate truoc khi ghi API. Cac lich va khung gio khac duoc phep trung
 * nhau; chi cam gio Bat va Tat trung chinh xac den giay trong cung 1 khung. */
export function validateScheduleDraft(draft: ScheduleDraft): string | null {
  if (draft.target_entities.length === 0) return tr("Hãy chọn ít nhất một thiết bị", "Select at least one device");
  if (draft.trigger_type === "auto_off") {
    return toSeconds(draft.time) > 0 ? null : tr("Thời gian tự tắt phải lớn hơn 0", "Auto-off duration must be greater than 0");
  }
  if (draft.days.length === 0) return tr("Hãy chọn ít nhất một ngày lặp", "Select at least one repeat day");
  if (draft.start_date && draft.end_date && draft.start_date > draft.end_date) {
    return tr("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc", "Start date must be before or equal to end date");
  }
  if (draft.end_time && draft.trigger_type === draft.end_trigger_type
      && (draft.trigger_type === "time" ? toSeconds(draft.time) === toSeconds(draft.end_time) : draft.offset_minutes === draft.end_offset_minutes)) {
    return tr("Giờ bật và giờ tắt không được cùng thời điểm", "Turn-on and turn-off times cannot be identical");
  }
  if (draft.action_service === "climate_set" && !draft.climate_hvac_mode) {
    return tr("Hãy chọn chế độ máy lạnh", "Select a climate mode");
  }
  return null;
}

export async function deleteScheduleWithSibling(schedule: Schedule, allSchedules: Schedule[]): Promise<void> {
  const sibling = findSibling(schedule, allSchedules);
  await api.deleteSchedule(schedule.id);
  if (sibling) await api.deleteSchedule(sibling.id);
}

/** Gop 2 Schedule cung group_id (turn_on + turn_off) thanh 1 "dong hien
 * thi" cho Device Detail - con lai la dong don binh thuong. Thu tu hien thi
 * theo dung `sort_order` (thu tu schedules truyen vao, da sap theo
 * sort_order/time tu backend - xem crud.list_schedules()), KHONG tu sap lai
 * theo gio nua - phan hoi 2026-09-23 "cho thêm drag drop đổi vị trí Lịch
 * trong config": neu van ep sort theo gio o day, moi lan keo xong reload()
 * se lam danh sach TU DONG NHAY VE THU TU CU (sort theo gio), xoa mat ket
 * qua vua keo. Nhat quan voi cach trang Nha da lam (groupSchedules() cung
 * luon sort theo sort_order, khong tu dong sort lai theo gio). */
export interface ScheduleRowItem {
  key: string;
  isRange: boolean;
  primary: Schedule; // dong "dai dien" (turn_on neu la range) - dung de sua/xoa
  secondary: Schedule | null; // turn_off neu la range
}

export function groupIntoRows(schedules: Schedule[]): ScheduleRowItem[] {
  const used = new Set<string>();
  const rows: ScheduleRowItem[] = [];
  for (const s of schedules) {
    if (used.has(s.id)) continue;
    const sibling = findSibling(s, schedules);
    const isPair =
      sibling &&
      !used.has(sibling.id) &&
      (s.action.service === "turn_on" || s.action.service === "turn_off") &&
      (sibling.action.service === "turn_on" || sibling.action.service === "turn_off") &&
      s.action.service !== sibling.action.service;
    if (isPair && sibling) {
      const onS = s.action.service === "turn_on" ? s : sibling;
      const offS = s.action.service === "turn_off" ? s : sibling;
      used.add(s.id);
      used.add(sibling.id);
      rows.push({ key: s.group_id!, isRange: true, primary: onS, secondary: offS });
    } else {
      used.add(s.id);
      rows.push({ key: s.id, isRange: false, primary: s, secondary: null });
    }
  }
  return rows;
}
