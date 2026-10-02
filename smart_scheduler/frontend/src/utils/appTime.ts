import { appLocale } from "../i18n";

/** Mui gio de HIEN THI moi moc gio (v0.5.53) = mui gio cua add-on (Cai dat, mac
 * dinh theo Home Assistant) - KHONG dung mui gio cua trinh duyet/dien thoai. Truoc
 * day card/Nhat ky/binh minh... dung gio trinh duyet: dien thoai de mui khac HA thi
 * lich chay dung 23:30 gio nha nhung card hien 00:30. App.tsx goi setAppTimeZone
 * moi khi tai Cai dat. */
let zone: string | undefined;

export function setAppTimeZone(tz: string | undefined) {
  try {
    if (tz) new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    zone = tz || undefined;
  } catch {
    zone = undefined; // ten mui gio la -> dung mui trinh duyet thay vi crash
  }
}

function toDate(v: string | Date): Date {
  return typeof v === "string" ? new Date(v) : v;
}

/** "HH:MM" (hoac theo opts) theo mui gio add-on, dinh dang ngon ngu app. */
export function fmtTime(v: string | Date, opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }): string {
  return toDate(v).toLocaleTimeString(appLocale(), { ...opts, timeZone: zone });
}

export function fmtDateTime(v: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  return toDate(v).toLocaleString(appLocale(), { ...opts, timeZone: zone });
}

/** "HH:MM:SS" 24h theo mui gio add-on (dung de dua vao formatTimeDisplay). */
export function hmsInZone(v: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(toDate(v));
}

/** Giay trong ngay theo mui gio add-on. */
export function secondsOfDayInZone(v: string | Date): number {
  const [h, m, s] = hmsInZone(v).split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

/** "YYYY-MM-DD" hom nay theo mui gio add-on. */
export function todayInZone(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** "YYYY-MM-DD" cua 1 moc thoi gian theo mui gio add-on. */
export function dateInZone(v: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(toDate(v));
}
