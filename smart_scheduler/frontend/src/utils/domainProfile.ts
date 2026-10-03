import type { ScheduleDraft } from "./scheduleRange";
import { tr } from "../i18n";

/** Moi loai thiet bi chi hien dung nhung gi no lam duoc (v0.5.79, phan hoi
 * 2026-10-02 "mỗi loại entities khi chọn mới hiển thị cài đặt, chứ hiển thị
 * tất cả trong cài đặt timer card thì rối lắm"):
 * - script/scene: chay 1 lan vao gio do ("Chạy"/"Kích hoạt") - khong co khung
 *   gio, khong Tu tat (scene khong co lenh tat, script tat = dung giua chung).
 * - automation: Cho phep / Vo hieu hoa (= turn_on/turn_off), khung gio duoc.
 * - cover: Mo / Dong / Dung (+ Dat vi tri neu rem ho tro), khung gio Mo -> Dong.
 * - climate/light/fan: hanh dong rieng nhu truoc; den them do sang trong khung gio.
 * - con lai (switch, input_boolean, media_player...): Bat / Tat / Dao trang thai.
 * Chua chon thiet bi -> null (editor an phan hanh dong). */
export type ActionService = ScheduleDraft["action_service"];

export interface DomainProfile {
  /** Khoa de effect trong editor biet khi nao loai thiet bi doi. */
  key: string;
  domain: string | null;
  actions: ActionService[];
  range: boolean;
  autoOff: boolean;
  /** Tu cho 2 moc cua khung gio: "Bật"/"Tắt", "Mở"/"Đóng", "Cho phép"/"Vô hiệu". */
  onWord: string;
  offWord: string;
  /** Den: chon do sang/mau cho moc Bat cua khung gio. */
  rangeLight: boolean;
}

const ONE_SHOT = new Set(["scene", "script"]);

export function domainProfile(domains: string[], coverSupportsPosition: boolean): DomainProfile | null {
  if (domains.length === 0) return null;
  const set = new Set(domains);
  const domain = set.size === 1 ? domains[0] : null;
  const power = { onWord: tr("Bật", "On"), offWord: tr("Tắt", "Off"), rangeLight: false };
  const base = { key: domain ?? `mixed:${[...set].sort().join(",")}`, domain };

  if ([...set].some((d) => ONE_SHOT.has(d))) {
    return { ...base, ...power, actions: ["turn_on"], range: false, autoOff: false };
  }
  switch (domain) {
    case "automation":
      return { ...base, actions: ["turn_on", "turn_off"], range: true, autoOff: false, onWord: tr("Cho phép", "Enable"), offWord: tr("Vô hiệu", "Disable"), rangeLight: false };
    case "cover":
      return {
        ...base,
        actions: ["cover_open", "cover_close", "cover_stop", ...(coverSupportsPosition ? (["cover_set"] as const) : [])],
        range: true,
        autoOff: false,
        onWord: tr("Mở", "Open"),
        offWord: tr("Đóng", "Close"),
        rangeLight: false,
      };
    case "climate":
      return { ...base, ...power, actions: ["climate_set", "turn_off"], range: true, autoOff: true };
    case "light":
      return { ...base, ...power, actions: ["light_set", "turn_off"], range: true, autoOff: true, rangeLight: true };
    case "fan":
      return { ...base, ...power, actions: ["fan_set", "turn_off"], range: true, autoOff: true };
    default:
      return { ...base, ...power, actions: ["turn_on", "turn_off", "toggle"], range: true, autoOff: true };
  }
}

/** Nhan chip hanh dong theo loai thiet bi. */
export function actionChipLabel(service: ActionService, domain: string | null): string {
  if (service === "turn_on") {
    if (domain === "script") return `▶ ${tr("Chạy", "Run")}`;
    if (domain === "scene") return `🎬 ${tr("Kích hoạt", "Activate")}`;
    if (domain === "automation") return tr("Cho phép", "Enable");
    return tr("Bật", "Turn on");
  }
  if (service === "turn_off") return domain === "automation" ? tr("Vô hiệu hoá", "Disable") : tr("Tắt", "Turn off");
  return {
    toggle: tr("Đảo trạng thái", "Toggle"),
    climate_set: `❄️ ${tr("Đặt chế độ", "Set mode")}`,
    light_set: `💡 ${tr("Đặt độ sáng/màu", "Set brightness/color")}`,
    cover_open: tr("Mở", "Open"),
    cover_close: tr("Đóng", "Close"),
    cover_stop: tr("Dừng", "Stop"),
    cover_set: `🪟 ${tr("Đặt vị trí", "Set position")}`,
    fan_set: `🌀 ${tr("Đặt tốc độ", "Set speed")}`,
  }[service];
}
