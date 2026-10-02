import { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceGroup, EntitySummary, Group, Settings } from "../../types";
import { dayEvents, daySpans, hhmm, type DayEvent } from "../../utils/dayPlan";
import { dateInZone, secondsOfDayInZone, todayInZone } from "../../utils/appTime";
import { serverNow } from "../../utils/serverTime";
import { describeAction } from "../../utils/scheduleRange";
import { visualFor } from "../../utils/deviceVisuals";
import { useMdiIcons } from "../../utils/mdiIcons";
import { Icon } from "../Icon/Icon";
import { MissingMark } from "../DeviceCard/DeviceCard";
import { UNGROUPED } from "../GroupedDeviceGrid/GroupedDeviceGrid";
import { appLocale, tr } from "../../i18n";

/** 2 kieu xem "theo ngay" tren Nha (v0.5.64), khac han luoi/danh sach card:
 * - AgendaView "Theo gio": moi lan bat/tat cua CA NHA hom nay xep theo gio,
 *   co vach "Bay gio", moc da qua mo di + ket qua chay.
 * - TimelineView "Bang 24h": moi thiet bi 1 hang, thanh mau = khoang dang bat
 *   trong ngay, de thay thiet bi nao chay chong gio nhau. */

function useNowSeconds(): number {
  const [now, setNow] = useState(() => secondsOfDayInZone(new Date(serverNow())));
  useEffect(() => {
    const id = window.setInterval(() => setNow(secondsOfDayInZone(new Date(serverNow()))), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function clock(seconds: number, format: Settings["time_format"]): string {
  const text = hhmm(seconds);
  if (format === "24h") return text;
  const [h, m] = text.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "CH" : "SA"}`;
}

function todayLabel(): string {
  const [y, m, d] = todayInZone().split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(appLocale(), { weekday: "long", day: "2-digit", month: "2-digit" });
}

/** Ket qua lan chay da qua hom nay (chi khi last_run cua lich la hom nay). */
function pastResult(ev: DayEvent, today: string): { text: string; tone: "ok" | "warn" } | null {
  const s = ev.schedule;
  if (!s.last_run || dateInZone(s.last_run) !== today) return null;
  if (s.last_status === "success") return { text: "✓", tone: "ok" };
  if (s.last_status === "error") return { text: tr("Lỗi", "Error"), tone: "warn" };
  if (s.last_status?.startsWith("skipped")) return { text: tr("Bỏ qua", "Skipped"), tone: "warn" };
  return null;
}

export function AgendaView({
  groups,
  timeFormat,
  onOpen,
}: {
  groups: DeviceGroup[];
  timeFormat: Settings["time_format"];
  onOpen: (group: DeviceGroup) => void;
}) {
  useMdiIcons();
  const now = useNowSeconds();
  const today = todayInZone();
  const events = useMemo(() => dayEvents(groups, today), [groups, today]);
  const nowRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // Lan dau mo: cuon toi vach "Bay gio" (khong cuon lai moi lan tai du lieu).
  useEffect(() => {
    if (scrolled.current || !nowRef.current) return;
    scrolled.current = true;
    // KHONG dung scrollIntoView: no cuon ca html/body (overflow:hidden) lam xo
    // lech khung app trong iframe Ingress - chi cuon vung .app-main.
    const el = nowRef.current;
    const box = el.closest(".app-main") as HTMLElement | null;
    if (!box) return;
    const offset = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop += offset - box.clientHeight / 2;
  }, [events.length]);

  const nowIndex = events.findIndex((e) => e.seconds > now);
  const nowLine = (
    <div ref={nowRef} className="agenda__now" key="__now">
      <span>{tr("Bây giờ", "Now")} {clock(now, timeFormat)}</span>
    </div>
  );

  return (
    <div className="day-view agenda">
      <div className="day-view__head">
        <span className="day-view__date">{todayLabel()}</span>
        <span className="day-view__meta">{events.length} {tr("lần chạy", "runs")}</span>
      </div>
      {events.length === 0 && <div className="empty-hint">{tr("Hôm nay không có lịch nào chạy.", "Nothing runs today.")}</div>}
      <div className="agenda__list">
        {events.map((ev, i) => {
          const past = ev.seconds <= now;
          const visual = visualFor(ev.group.domain, ev.group.title, ev.group.singleEntity?.icon);
          const result = past ? pastResult(ev, today) : null;
          const row = (
            <button
              type="button"
              key={`${ev.schedule.id}`}
              className={`agenda__row ${past ? "agenda__row--past" : ""} ${ev.skipped ? "agenda__row--skipped" : ""}`}
              style={{ "--accent": visual.color } as React.CSSProperties}
              onClick={() => onOpen(ev.group)}
            >
              <span className="agenda__time">{clock(ev.seconds, timeFormat)}</span>
              <span className="agenda__icon">
                <Icon path={visual.icon} size={16} />
              </span>
              <span className="agenda__main">
                <span className="agenda__name">
                  <span className="agenda__name-text">{ev.group.title}</span>
                  <MissingMark missingIds={ev.group.missingIds} total={ev.group.entityIds.length} />
                </span>
                <span className="agenda__action">
                  {describeAction(ev.schedule.action)}
                  {ev.schedule.trigger_type !== "time" && ` · ${ev.schedule.trigger_type === "sunrise" ? tr("bình minh", "sunrise") : tr("hoàng hôn", "sunset")}`}
                  {ev.skipped && ` · ${tr("bỏ qua lần này", "skipped once")}`}
                </span>
              </span>
              {result && <span className={`agenda__result agenda__result--${result.tone}`}>{result.text}</span>}
            </button>
          );
          return i === nowIndex ? [nowLine, row] : row;
        })}
        {events.length > 0 && nowIndex === -1 && nowLine}
      </div>
    </div>
  );
}

const HOURS = [0, 6, 12, 18, 24];

export function TimelineView({
  groups,
  entities,
  categoryGroups,
  timeFormat,
  onOpen,
}: {
  groups: DeviceGroup[];
  entities: EntitySummary[];
  categoryGroups: Group[];
  timeFormat: Settings["time_format"];
  onOpen: (group: DeviceGroup) => void;
}) {
  useMdiIcons();
  const now = useNowSeconds();
  const today = todayInZone();
  const plans = useMemo(() => new Map(groups.map((g) => [g.key, daySpans(g, today)])), [groups, today]);

  // Chia muc theo Nhom giong luoi card (thu tu nhom, "Chua phan nhom" cuoi).
  const sections = useMemo(() => {
    const catOf = (g: DeviceGroup) => entities.find((e) => e.entity_id === g.entityIds[0])?.category_id || UNGROUPED;
    const ids = [...categoryGroups.map((c) => c.id), UNGROUPED];
    return ids
      .map((id) => ({
        id,
        name: id === UNGROUPED ? (categoryGroups.length ? tr("Chưa phân nhóm", "Ungrouped") : "") : categoryGroups.find((c) => c.id === id)!.name,
        groups: groups.filter((g) => (ids.includes(catOf(g)) ? catOf(g) : UNGROUPED) === id),
      }))
      .filter((s) => s.groups.length > 0);
  }, [groups, entities, categoryGroups]);

  // So thiet bi chay cung luc nhieu nhat trong ngay (quet cac moc bat/tat).
  const peak = useMemo(() => {
    const points: [number, number][] = [];
    for (const { spans } of plans.values()) for (const s of spans) points.push([s.start, 1], [s.end, -1]);
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let best = { count: 0, at: 0 };
    for (const [t, d] of points) {
      cur += d;
      if (cur > best.count) best = { count: cur, at: t };
    }
    return best;
  }, [plans]);

  const pct = (sec: number) => `${(sec / 864).toFixed(3)}%`;

  return (
    <div className="day-view timeline">
      <div className="day-view__head">
        <span className="day-view__date">{todayLabel()}</span>
        {peak.count > 1 && (
          <span className="day-view__meta">
            {tr(`Nhiều nhất ${peak.count} thiết bị chạy cùng lúc (${clock(peak.at, timeFormat)})`, `Up to ${peak.count} devices at once (${clock(peak.at, timeFormat)})`)}
          </span>
        )}
      </div>
      <div className="timeline__axis">
        <span className="timeline__name" />
        <span className="timeline__track timeline__track--axis">
          {HOURS.map((h) => (
            <span key={h} className="timeline__hour" style={{ left: pct(h * 3600) }}>
              {h}
            </span>
          ))}
        </span>
      </div>
      {sections.map((sec) => (
        <div key={sec.id} className="timeline__section">
          {sec.name && <div className="timeline__section-title">{sec.name}</div>}
          {sec.groups.map((g) => {
            const plan = plans.get(g.key)!;
            const visual = visualFor(g.domain, g.title, g.singleEntity?.icon);
            const empty = plan.spans.length === 0 && plan.marks.length === 0;
            return (
              <button
                type="button"
                key={g.key}
                className={`timeline__row ${empty ? "timeline__row--empty" : ""}`}
                style={{ "--accent": visual.color } as React.CSSProperties}
                onClick={() => onOpen(g)}
              >
                <span className="timeline__name">
                  <span className="timeline__name-text">{g.title}</span>
                  <MissingMark missingIds={g.missingIds} total={g.entityIds.length} />
                </span>
                <span className="timeline__track">
                  {plan.spans.map((s, i) => (
                    <span
                      key={i}
                      className={`timeline__bar ${s.start <= now && now < s.end ? "timeline__bar--live" : ""}`}
                      style={{ left: pct(s.start), width: pct(s.end - s.start) }}
                      title={`${clock(s.start, timeFormat)} → ${clock(s.end % 86400, timeFormat)}`}
                    />
                  ))}
                  {plan.marks.map((m) => (
                    <span
                      key={m.schedule.id}
                      className="timeline__mark"
                      style={{ left: pct(m.seconds) }}
                      title={`${clock(m.seconds, timeFormat)} · ${describeAction(m.schedule.action)}`}
                    />
                  ))}
                  <span className="timeline__now" style={{ left: pct(now) }} />
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {sections.length === 0 && <div className="empty-hint">{tr("Chưa có thiết bị nào được hẹn giờ.", "No scheduled devices yet.")}</div>}
    </div>
  );
}
