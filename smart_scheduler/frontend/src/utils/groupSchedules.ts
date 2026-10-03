import { serverNow } from "./serverTime";
import type { DeviceGroup, EntitySummary, ManualTimer, Schedule } from "../types";
import { secondsOfDayInZone } from "./appTime";

/** Quy tac gom nhom (muc 6/71 SPEC_UI.md):
 * - Schedule chi co dung 1 target entity -> gom theo entity_id do (nhieu
 *   schedule cung 1 thiet bi = 1 card, nhieu gio).
 * - Schedule co >=2 target entities VA co group_id (kieu "Khung gio" bat/tat
 *   ghep cap - saveScheduleDraft() luu thanh 2 dong turn_on/turn_off dung
 *   chung group_id) -> gom theo group_id, ca 2 dong chung 1 card. Bug thuc
 *   te 2026-09-23: truoc day dung `schedule:${schedule.id}` cho moi truong
 *   hop nhieu-entity, MOI DONG rieng 1 id nen 1 "Khung gio" 2 thiet bi bi
 *   tach thanh 2 CARD KHAC NHAU (1 the chi hien "Bat", 1 the chi hien "Tat")
 *   thay vi gop lai thanh 1 the "Bat luc X -> Tat luc Y" nhu dung y.
 * - Schedule co >=2 target entities nhung KHONG co group_id (1 dong don le,
 *   dung y "3 thiet bi / Buoi toi" trong SPEC_UI.md muc 71) -> tu no la 1
 *   card rieng, gom theo schedule.id (khong co gi de ghep cung).
 */
export function groupSchedules(schedules: Schedule[], entities: EntitySummary[]): DeviceGroup[] {
  const entityMap = new Map(entities.map((e) => [e.entity_id, e]));
  const groups = new Map<string, DeviceGroup>();

  for (const schedule of schedules) {
    const isSingle = schedule.target_entities.length === 1;
    const key = isSingle
      ? `entity:${schedule.target_entities[0]}`
      : schedule.group_id
        ? `group:${schedule.group_id}`
        : `schedule:${schedule.id}`;
    let group = groups.get(key);
    if (!group) {
      const entity = isSingle ? entityMap.get(schedule.target_entities[0]) : undefined;
      group = {
        key,
        title: isSingle ? entity?.alias || entity?.ha_friendly_name || schedule.target_entities[0] || schedule.name : schedule.name,
        area: isSingle ? entity?.area ?? null : null,
        domain: isSingle ? entity?.domain || schedule.action.domain : schedule.action.domain,
        entityIds: [],
        singleEntity: isSingle ? entity ?? null : null,
        schedules: [],
        favorite: isSingle ? Boolean(entity?.favorite) : schedule.favorite,
        isOn: entity?.state === "on" || entity?.state === "open",
        missingIds: [],
        minSortOrder: schedule.sort_order,
      };
      groups.set(key, group);
    }
    group.schedules.push(schedule);
    group.minSortOrder = Math.min(group.minSortOrder, schedule.sort_order);
    for (const id of schedule.target_entities) {
      if (!group.entityIds.includes(id)) {
        group.entityIds.push(id);
        if (entityMap.get(id)?.missing) group.missingIds.push(id);
      }
      if (entityMap.get(id)?.state === "on" || entityMap.get(id)?.state === "open") group.isOn = true;
    }
  }

  return [...groups.values()].sort((a, b) => a.minSortOrder - b.minSortOrder);
}

export interface ActiveOnWindow {
  startAt: string;
  endAt: string;
  source: "schedule" | "manual" | "auto_off";
}

/** Tim khoang dang bat de ve thanh dem nguoc. Manual timer duoc uu tien;
 * lich khung gio suy ra moc bat tu next_run cua cap Tat tru di do dai khung. */
export function activeOnWindow(group: DeviceGroup, timers: ManualTimer[], nowMs = serverNow()): ActiveOnWindow | null {
  if (!group.isOn) return null;

  const entityIds = new Set(group.entityIds);
  const candidates: ActiveOnWindow[] = [];
  for (const manual of timers) {
    if (!manual.started_at || !manual.off_at || !manual.entity_ids.some((id) => entityIds.has(id))) continue;
    const startMs = new Date(manual.started_at).getTime();
    const endMs = new Date(manual.off_at).getTime();
    if (startMs <= nowMs && nowMs < endMs) {
      candidates.push({ startAt: manual.started_at, endAt: manual.off_at, source: manual.source ?? "manual" });
    }
  }

  for (const onSchedule of group.schedules) {
    if (!onSchedule.group_id || onSchedule.action.service !== "turn_on") continue;
    const offSchedule = group.schedules.find(
      (candidate) => candidate.group_id === onSchedule.group_id && candidate.action.service === "turn_off",
    );
    const window = offSchedule ? rangeWindow(onSchedule, offSchedule, nowMs) : null;
    if (window) candidates.push({ ...window, source: "schedule" });
  }
  return candidates.sort((a, b) => new Date(a.endAt).getTime() - new Date(b.endAt).getTime())[0] ?? null;
}

const secondsOfDay = secondsOfDayInZone;

/** Khoang Bat -> Tat cua 1 "Khung gio" neu DANG dien ra luc nowMs, null neu
 * khong. Suy tu next_run cua backend (khong tu tinh lai gio) nen dung ca khi
 * moc Bat theo binh minh/hoang hon (v0.5.32): dang trong khung <=> lich Tat
 * sap chay trong 24h toi VA lich Bat khong con chay truoc moc Tat do (tuc
 * lan Bat cua khung nay da qua). Moc bat = moc tat - do dai khung. */
export function rangeWindow(on: Schedule, off: Schedule, nowMs = serverNow()): { startAt: string; endAt: string } | null {
  if (!on.enabled || !off.enabled || on.card_enabled === false || off.card_enabled === false) return null;
  if (!on.next_run || !off.next_run) return null;
  const endMs = new Date(off.next_run).getTime();
  if (endMs <= nowMs || endMs - nowMs > 86400_000) return null;
  if (new Date(on.next_run).getTime() < endMs) return null; // lan Bat van con o phia truoc
  const durationSeconds = (secondsOfDay(off.next_run) - secondsOfDay(on.next_run) + 86400) % 86400;
  if (durationSeconds === 0) return null;
  const startMs = endMs - durationSeconds * 1000;
  if (startMs > nowMs) return null;
  return { startAt: new Date(startMs).toISOString(), endAt: off.next_run };
}

/** Dong Lich dang chay -> to vang trong Device Detail (phan hoi 2026-09-24
 * "dòng nào trong lịch chạy thì sáng vàng lên chạy xong thì bỏ màu"):
 * - Khung gio: dang trong khoang Bat -> Tat va thiet bi dang bat that
 *   (dieu kien khong thoa -> lich bi bo qua -> khong to).
 * - Lich 1 moc: sang trong JUST_RAN_MS ngay sau khi vua chay thanh cong. */
const JUST_RAN_MS = 15_000;
export function isRangeRowRunning(
  row: { isRange: boolean; primary: Schedule; secondary: Schedule | null },
  deviceOn: boolean,
  nowMs = serverNow(),
): boolean {
  if (!row.isRange || !row.secondary) {
    const s = row.primary;
    return Boolean(s.last_run && s.last_status === "success" && nowMs - new Date(s.last_run).getTime() < JUST_RAN_MS);
  }
  if (!deviceOn) return false;
  const on = row.primary.action.service === "turn_on" ? row.primary : row.secondary;
  const off = on === row.primary ? row.secondary : row.primary;
  return rangeWindow(on, off, nowMs) !== null;
}

/** next_run som nhat trong cac schedule dang bat & khong bi skip cua 1 card. */
export function nextRunOf(group: DeviceGroup): { time: string | null; scheduleId: string | null } {
  let best: Schedule | null = null;
  for (const s of group.schedules) {
    if (!s.enabled || s.skip_once || !s.next_run) continue;
    if (!best || s.next_run! < best.next_run!) best = s;
  }
  return { time: best?.next_run ?? null, scheduleId: best?.id ?? null };
}

export function anyEnabled(group: DeviceGroup): boolean {
  return group.schedules.some((s) => s.enabled);
}

/** Trang thai cong tac TONG cua card - KHONG phu thuoc lich con nao dang bat
 * (phan hoi 2026-09-24: bat toggle tong ma chua bat lich con nao thi card
 * van phai sang len). */
export function cardEnabled(group: DeviceGroup): boolean {
  return group.schedules.length > 0 && group.schedules.every((s) => s.card_enabled !== false);
}

export function entityNames(ids: string[], entities: EntitySummary[]): string {
  const map = new Map(entities.map((e) => [e.entity_id, e]));
  return ids.map((id) => map.get(id)?.alias || map.get(id)?.ha_friendly_name || id).join(", ");
}
