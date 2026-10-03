import type { EntitySummary, Group, HealthStatus, HistoryEntry, ManualTimer, PresenceConfig, PresencePreview, PresenceStatus, Schedule, Settings } from "../types";

// Duong dan tuong doi - qua HA Ingress base path duoc proxy tu dong, khong
// duoc hard-code "/api" tuyet doi tu goc domain (xem vite base: "./" o
// vite.config.ts). Ingress se rewrite dung ca REST lan WebSocket.
const BASE = "api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} loi ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getHealth: () => request<HealthStatus>("/health"),
  listSchedules: () => request<Schedule[]>("/schedules"),
  createSchedule: (data: Partial<Schedule>) =>
    request<Schedule>("/schedules", { method: "POST", body: JSON.stringify(data) }),
  updateSchedule: (id: string, data: Partial<Schedule>) =>
    request<Schedule>(`/schedules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** Xoa ca card: backend tat thiet bi cua card truoc roi moi xoa lich. */
  deleteCard: (scheduleIds: string[]) =>
    request<{ ok: boolean; turned_off: string[] }>("/schedules/delete-card", { method: "POST", body: JSON.stringify({ schedule_ids: scheduleIds }) }),
  deleteSchedule: (id: string) => request<{ ok: boolean }>(`/schedules/${id}`, { method: "DELETE" }),
  reorderSchedules: (orderedIds: string[]) =>
    request<{ ok: boolean }>("/schedules/reorder", {
      method: "POST",
      body: JSON.stringify({ ordered_ids: orderedIds }),
    }),
  toggleSchedule: (id: string) => request<Schedule>(`/schedules/${id}/toggle`, { method: "POST" }),
  /** Bat/tat CA NHOM lich cua 1 thiet bi cung luc (nut tren DeviceCard) -
   * dung endpoint rieng (khong lap POST toggle cho tung lich) de backend giu
   * duoc phan biet "bi tat boi nut nay" vs "nguoi dung tat rieng tung lich" -
   * xem crud.set_group_enabled() o backend, phan hoi 2026-09-23. */
  groupToggleSchedules: (scheduleIds: string[], enabled: boolean) =>
    request<Schedule[]>("/schedules/group-toggle", {
      method: "POST",
      body: JSON.stringify({ schedule_ids: scheduleIds, enabled }),
    }),
  favoriteSchedule: (id: string) => request<Schedule>(`/schedules/${id}/favorite`, { method: "POST" }),
  skipSchedule: (id: string) => request<Schedule>(`/schedules/${id}/skip`, { method: "POST" }),
  runSchedule: (id: string) =>
    request<{ status: string; message: string | null }>(`/schedules/${id}/run`, { method: "POST" }),

  /** "all" = moi entity cua HA (Entity Picker); "added" = chi thiet bi da them (poll trang Nha). */
  listEntities: (scope: "all" | "added" = "all") => request<EntitySummary[]>(`/entities${scope === "added" ? "?scope=added" : ""}`),
  setAlias: (entityId: string, data: Partial<EntitySummary>) =>
    request<EntitySummary>(`/entities/${entityId}/alias`, { method: "PUT", body: JSON.stringify(data) }),
  /** Doi thiet bi sang entity khac, backend chuyen luon ten/icon/nhom/lich/
   * dieu kien/hen cuong che (v0.5.27). Loi 409 = khac domain khong an toan. */
  replaceEntity: (entityId: string, newEntityId: string) =>
    request<{ old_entity_id: string; new_entity_id: string; schedules: number; conditions: number; manual_timers: number }>(
      `/entities/${entityId}/replace`,
      { method: "POST", body: JSON.stringify({ new_entity_id: newEntityId }) },
    ),

  listHistory: (limit = 200, scheduleId?: string) =>
    request<HistoryEntry[]>(`/history?limit=${limit}${scheduleId ? `&schedule_id=${scheduleId}` : ""}`),

  /** Lich su trang thai that tu recorder HA (card timeline o Device Detail). */
  stateHistory: (entityIds: string[], start: Date, end: Date) =>
    request<Record<string, { s: string; t: string }[]>>(
      `/history/states?entity_ids=${encodeURIComponent(entityIds.join(","))}&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    ),

  getSettings: () => request<Settings>("/settings"),
  updateSettings: (data: Partial<Settings>) =>
    request<Settings>("/settings", { method: "PUT", body: JSON.stringify(data) }),

  exportBackup: () => request<Record<string, unknown>>("/backup/export"),
  importBackup: (data: Record<string, unknown>) =>
    request<{ ok: boolean; restored: { schedules: number; entity_aliases: number; groups: number | null; settings: number } }>("/backup/import", { method: "POST", body: JSON.stringify(data) }),

  listActiveManualTimers: () => request<ManualTimer[]>("/manual/active"),
  forceOn: (entityIds: string[], autoOffMinutes: number | null) =>
    request<ManualTimer>("/manual/force_on", {
      method: "POST",
      body: JSON.stringify({ entity_ids: entityIds, auto_off_minutes: autoOffMinutes }),
    }),
  cancelManualTimer: (id: string) => request<{ ok: boolean }>(`/manual/${id}/cancel`, { method: "POST" }),

  getSunToday: () => request<{ sunrise: string | null; sunset: string | null }>("/sun/today"),

  getPresence: () => request<{ config: PresenceConfig; status: PresenceStatus }>("/presence"),
  updatePresence: (data: Partial<PresenceConfig>) =>
    request<{ config: PresenceConfig; status: PresenceStatus }>("/presence", { method: "PUT", body: JSON.stringify(data) }),
  previewPresence: (data: Partial<PresenceConfig>) =>
    request<PresencePreview>("/presence/preview", { method: "POST", body: JSON.stringify(data) }),
  stopPresence: () => request<{ config: PresenceConfig; status: PresenceStatus }>("/presence/stop", { method: "POST" }),

  listGroups: () => request<Group[]>("/groups"),
  createGroup: (name: string) => request<Group>("/groups", { method: "POST", body: JSON.stringify({ name }) }),
  renameGroup: (id: string, name: string) => request<Group>(`/groups/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  setGroupEnabled: (id: string, enabled: boolean) =>
    request<Group>(`/groups/${id}/enabled`, { method: "POST", body: JSON.stringify({ enabled }) }),
  /** days: 0 = het hom nay, 1 = het ngay mai, 2 = 3 ngay; null = huy bo qua. */
  setGroupSkip: (id: string, days: number | null) =>
    request<Group>(`/groups/${id}/skip`, { method: "POST", body: JSON.stringify({ days }) }),
  deleteGroup: (id: string) => request<{ ok: boolean }>(`/groups/${id}`, { method: "DELETE" }),
  reorderGroups: (orderedIds: string[]) =>
    request<{ ok: boolean }>("/groups/reorder", { method: "POST", body: JSON.stringify({ ordered_ids: orderedIds }) }),
};
