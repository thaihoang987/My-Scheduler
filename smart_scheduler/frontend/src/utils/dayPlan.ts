import type { DeviceGroup, Schedule } from "../types";
import { secondsOfDayInZone, todayInZone } from "./appTime";

/** Lich chay TRONG HOM NAY (theo mui gio add-on) - dung chung cho 2 kieu xem
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
  if (!s.enabled || s.card_enabled === false || s.trigger_type === "auto_off") return false;
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
 * thanh 1 doan, qua dem thi tach 2 doan [bat, 24h) + [0, tat). Lenh don (vd
 * may lanh dat nhiet do) thanh 1 moc. */
export interface DaySpan {
  start: number;
  end: number;
  on: Schedule;
  off: Schedule;
}

export function daySpans(group: DeviceGroup, date = todayInZone()): { spans: DaySpan[]; marks: DayEvent[] } {
  const events = dayEvents([group], date);
  const spans: DaySpan[] = [];
  const marks: DayEvent[] = [];
  const used = new Set<string>();
  for (const ev of events) {
    const s = ev.schedule;
    if (used.has(s.id)) continue;
    const partner = s.group_id ? group.schedules.find((x) => x.id !== s.id && x.group_id === s.group_id) : undefined;
    const partnerEv = partner && events.find((e) => e.schedule.id === partner.id);
    if (!partner || !partnerEv) {
      marks.push(ev);
      continue;
    }
    used.add(s.id);
    used.add(partner.id);
    const onEv = s.action.service === "turn_on" ? ev : partnerEv;
    const offEv = onEv === ev ? partnerEv : ev;
    if (offEv.seconds > onEv.seconds) {
      spans.push({ start: onEv.seconds, end: offEv.seconds, on: onEv.schedule, off: offEv.schedule });
    } else {
      spans.push({ start: onEv.seconds, end: 86400, on: onEv.schedule, off: offEv.schedule });
      if (offEv.seconds > 0) spans.push({ start: 0, end: offEv.seconds, on: onEv.schedule, off: offEv.schedule });
    }
  }
  return { spans, marks };
}

/** "HH:MM" tu so giay trong ngay (bo giay cho gon). */
export function hhmm(seconds: number): string {
  const s = Math.max(0, Math.min(86399, Math.round(seconds)));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}
