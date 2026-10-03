import { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceGroup, EntitySummary, Group, Settings } from "../../types";
import { dayEvents, daySpans, hhmm, type DayEvent } from "../../utils/dayPlan";
import { dateInZone, secondsOfDayInZone } from "../../utils/appTime";
import { onServerTimeSync, serverNow } from "../../utils/serverTime";
import { describeAction } from "../../utils/scheduleRange";
import { visualFor } from "../../utils/deviceVisuals";
import { useMdiIcons } from "../../utils/mdiIcons";
import { Icon } from "../Icon/Icon";
import { MissingMark } from "../DeviceCard/DeviceCard";
import { categoryOf, UNGROUPED } from "../GroupedDeviceGrid/GroupedDeviceGrid";
import { skipLabel } from "../GroupControls/GroupControls";
import { appLocale, tr } from "../../i18n";

/** 2 kieu xem "theo ngay" tren Nha (v0.5.64), khac han luoi/danh sach card:
 * - AgendaView "Theo gio": moi lan bat/tat cua CA NHA hom nay xep theo gio,
 *   co vach "Bay gio", moc da qua mo di + ket qua chay.
 * - TimelineView "Bang 24h": moi thiet bi 1 hang, thanh mau = khoang dang bat
 *   trong ngay, de thay thiet bi nao chay chong gio nhau. */

/** "Bay gio" (giay trong ngay) + "hom nay" theo GIO MAY CHU. Cap nhat ngay
 * khi quay lai app/tab (visibilitychange, pageshow, focus) va sau moi lan dong
 * bo gio, them nhip 5s phong khi trinh duyet khong bao su kien nao (v0.5.65:
 * ra vao app thi bang 24h/theo gio dung o gio cu). `stepSec`: chi render
 * lai khi doi buoc do (Theo gio 1s vi hien giay, Bang 24h 60s). */
function readNow(): { now: number; today: string } {
  const d = new Date(serverNow());
  return { now: secondsOfDayInZone(d), today: dateInZone(d) };
}

function useNow(stepSec: number): { now: number; today: string } {
  const [state, setState] = useState(readNow);
  useEffect(() => {
    const update = () =>
      setState((prev) => {
        const next = readNow();
        return Math.floor(next.now / stepSec) === Math.floor(prev.now / stepSec) && next.today === prev.today ? prev : next;
      });
    update();
    const id = window.setInterval(update, Math.min(stepSec, 5) * 1000);
    const onShow = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    const unsubscribe = onServerTimeSync(update);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      unsubscribe();
    };
  }, [stepSec]);
  return state;
}

function clock(seconds: number, format: Settings["time_format"], withSeconds = false): string {
  const total = Math.max(0, Math.min(86399, Math.floor(seconds)));
  const sec = withSeconds ? `:${String(total % 60).padStart(2, "0")}` : "";
  const text = hhmm(total);
  if (format === "24h") return text + sec;
  const [h, m] = text.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${sec} ${h >= 12 ? "CH" : "SA"}`;
}

function todayLabel(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
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
  const { now, today } = useNow(1);
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
      <span>{tr("Bây giờ", "Now")} {clock(now, timeFormat, true)}</span>
    </div>
  );

  return (
    <div className="day-view agenda">
      <div className="day-view__head">
        <span className="day-view__date">{todayLabel(today)}</span>
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
              <span className="agenda__time">{clock(ev.seconds, timeFormat, true)}</span>
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
  const { now, today } = useNow(60);
  const plans = useMemo(() => new Map(groups.map((g) => [g.key, daySpans(g, today)])), [groups, today]);

  // Chia muc theo Nhom giong luoi card (thu tu nhom, "Chua phan nhom" cuoi).
  const sections = useMemo(() => {
    const catOf = (g: DeviceGroup) => categoryOf(g, entities);
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
        <span className="day-view__date">{todayLabel(today)}</span>
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
          {sec.name && (
            <div className="timeline__section-title">
              {sec.name} <span className="timeline__section-count">{sec.groups.length}</span>
              {(() => {
                const cat = categoryGroups.find((c) => c.id === sec.id);
                if (!cat) return null;
                if (!cat.enabled) return <span className="timeline__section-state">{tr("Nhóm đang tắt", "Group off")}</span>;
                if (cat.skip_until) return <span className="timeline__section-state">⏭ {tr(`Bỏ qua tới hết ${skipLabel(cat.skip_until)}`, `Skipping until end of ${skipLabel(cat.skip_until)}`)}</span>;
                return null;
              })()}
            </div>
          )}
          {sec.groups.map((g) => {
            const plan = plans.get(g.key)!;
            // Bang 24h la 1 vong tron: khung qua dem bi cat 2 doan [bat, 24h) + [0, tat)
            // - 1 doan dang chay thi doan kia cung sang (biet con bat toi luc nao).
            const live = new Set(plan.spans.filter((s) => s.start <= now && now < s.end).map((s) => s.on.id));
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
                      className={`timeline__bar ${live.has(s.on.id) ? "timeline__bar--live" : ""}`}
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
