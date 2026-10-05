import type { DeviceGroup, Schedule } from "../types";
import { dateInZone, secondsOfDayInZone, todayInZone } from "./appTime";
import { rangeDayOffset } from "./scheduleRange";

/** Lich chay TRONG HOM NAY (theo mui gio app) - dung chung cho 2 kieu xem
 * "Theo gio" va "Bang 24h" tren Nha (v0.5.64). Tinh hoan toan phia client tu
 * du lieu lich da co, khong goi them API:
 * - Gio co dinh: lay `time`.
 * - Binh minh/hoang hon: lay gio trong ngay cua `next_run` backend da tinh
 *   (lech toi da ~1 phut so voi hom nay - du de xem, khong dung de chay).
 * - Bo qua lich Tu tat (khong co gio dong ho), lich/card dang tat, ngay khong
 *   nam trong `days` hoac ngoai khoang start_date/end_date. */
export interface DayEvent {
  schedule: Schedule;
  group: DeviceGroup;
  /** Giay trong ngay (0..86399). */
  seconds: number;
  /** Lan chay ke tiep cua lich nay dang bi "Bo qua 1 lan". */
  skipped: boolean;
}

/** 0=Thu 2 ... 6=Chu nhat cua 1 ngay "YYYY-MM-DD". */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function runsOn(s: Schedule, date: string): boolean {
  if (!s.enabled || s.card_enabled === false || s.group_paused || s.trigger_type === "auto_off") return false;
  // Nhom dang "Bo qua": lenh Bat khong chay toi het ngay bo qua (lenh Tat van chay).
  if (s.group_skip_until && s.action.service !== "turn_off" && date <= dateInZone(new Date(Date.parse(s.group_skip_until) - 1))) return false;
  if (!s.days.includes(weekdayOf(date))) return false;
  if (s.start_date && date < s.start_date) return false;
  if (s.end_date && date > s.end_date) return false;
  return true;
}

function timeSeconds(s: Schedule): number | null {
  if (s.trigger_type === "time") {
    const [h = 0, m = 0, sec = 0] = s.time.split(":").map(Number);
    return h * 3600 + m * 60 + sec;
  }
  return s.next_run ? secondsOfDayInZone(s.next_run) : null;
}

export function dayEvents(groups: DeviceGroup[], date = todayInZone()): DayEvent[] {
  const out: DayEvent[] = [];
  for (const group of groups) {
    for (const s of group.schedules) {
      if (!runsOn(s, date)) continue;
      const seconds = timeSeconds(s);
      if (seconds === null) continue;
      const skipped = s.skip_once && Boolean(s.next_run) && s.next_run!.slice(0, 10) === date;
      out.push({ schedule: s, group, seconds, skipped });
    }
  }
  return out.sort((a, b) => a.seconds - b.seconds || a.group.minSortOrder - b.group.minSortOrder);
}

/** Doan dang bat trong ngay cua 1 card (Bang 24h): moi cap Khung gio Bat->Tat
 * thanh 1 doan; khung qua dem bat dau hom nay ve [bat, 24h), con doan [0, tat)
 * dau ngay la DUOI cua khung bat dau HOM QUA - giong backend `_window_end`:
 * Bat chay hom qua + Tat chay hom nay (v0.5.76; truoc do lay Bat cua hom nay
 * nen ngay dau/cuoi chuoi ngay lap bi ve sai, sang thanh sai sau 0h). Lenh don
 * (vd may lanh dat nhiet do) thanh 1 moc. */
export interface DaySpan {
  start: number;
  end: number;
  on: Schedule;
  off: Schedule;
}

function previousDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function daySpans(group: DeviceGroup, date = todayInZone()): { spans: DaySpan[]; marks: DayEvent[] } {
  const events = dayEvents([group], date);
  const yesterday = previousDate(date);
  const spans: DaySpan[] = [];
  const marks: DayEvent[] = [];
  const used = new Set<string>();
  const partnerOf = (s: Schedule) =>
    s.group_id ? group.schedules.find((x) => x.id !== s.id && x.group_id === s.group_id) : undefined;

  // Duoi khung qua dem bat dau hom qua.
  for (const on of group.schedules) {
    const off = partnerOf(on);
    if (on.action.service !== "turn_on" || !off || !runsOn(on, yesterday) || !runsOn(off, date)) continue;
    const offSec = timeSeconds(off);
    if (rangeDayOffset(on, off) === 1 && offSec !== null && offSec > 0) {
      spans.push({ start: 0, end: offSec, on, off });
    }
  }

  for (const ev of events) {
    const s = ev.schedule;
    if (used.has(s.id)) continue;
    const partner = partnerOf(s);
    if (!partner) {
      marks.push(ev);
      continue;
    }
    used.add(s.id);
    used.add(partner.id);
    const on = s.action.service === "turn_on" ? s : partner;
    const off = on === s ? partner : s;
    const onEv = events.find((e) => e.schedule.id === on.id);
    const offEv = events.find((e) => e.schedule.id === off.id);
    if (!onEv) {
      // Chi co Tat hom nay: da ve o duoi khung hom qua, neu khong thi la 1 moc.
      if (offEv && !spans.some((sp) => sp.off.id === off.id)) marks.push(offEv);
      continue;
    }
    const offSec = timeSeconds(off);
    if (rangeDayOffset(on, off) === 1) {
      spans.push({ start: onEv.seconds, end: 86400, on, off });
    } else if (offSec !== null && offSec > onEv.seconds) {
      if (offEv) spans.push({ start: onEv.seconds, end: offEv.seconds, on, off });
      else marks.push(onEv);
    }
    // Khung trong ngay bi dao thu tu hom nay (gio mat troi): backend bo qua ca 2 moc.
  }
  return { spans: spans.sort((a, b) => a.start - b.start), marks };
}

/** "HH:MM" tu so giay trong ngay (bo giay cho gon). */
export function hhmm(seconds: number): string {
  const s = Math.max(0, Math.min(86399, Math.round(seconds)));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}
