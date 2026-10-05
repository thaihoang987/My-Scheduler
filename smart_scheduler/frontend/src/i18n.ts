import type { Settings } from "./types";

let currentLanguage: Settings["language"] = "en";

export function setAppLanguage(language: Settings["language"]): void {
  currentLanguage = language;
  document.documentElement.lang = language;
}

export function appLanguage(): Settings["language"] {
  return currentLanguage;
}

/** Lightweight runtime translation for this single-page app. */
export function tr(vietnamese: string, english: string): string {
  return currentLanguage === "en" ? english : vietnamese;
}

export function appLocale(): string {
  return currentLanguage === "en" ? "en-US" : "vi-VN";
}

/** Translate known persisted backend text created before English support. */
export function storedText(value: string | null): string | null {
  if (!value || currentLanguage !== "en") return value;
  const exact: Record<string, string> = {
    "Bật cưỡng chế": "Forced on",
    "Giả lập có người": "Presence simulation",
    "Tự tắt theo hẹn giờ thủ công": "Automatically turned off by manual timer",
    "Lỡ giờ chạy (App tắt hoặc bận)": "Missed run (app was stopped or busy)",
    // Compatibility with history entries saved by older versions.
    "Lỡ giờ chạy (Add-on tắt hoặc bận)": "Missed run (app was stopped or busy)",
    "Điều kiện chưa thoả": "Conditions were not met",
    "Kiểm tra lại: đã gửi lại lệnh, thiết bị đã đúng trạng thái": "Verification: command retried and device state is now correct",
    "Tắt thiết bị vì xoá card hẹn giờ": "Turned off device because its schedule card was deleted",
  };
  if (exact[value]) return exact[value];
  const presence = value.match(/^Bật (.+) đến (\d{2}:\d{2})$/);
  if (presence) return `Turned on ${presence[1]} until ${presence[2]}`;
  return value;
}
