import { mdiChevronLeft, mdiChevronRight } from "@mdi/js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../Icon/Icon";
import { api } from "../../services/api";
import type { EntitySummary } from "../../types";
import { fmtDateTime, fmtTime, secondsOfDayInZone } from "../../utils/appTime";
import { serverNow } from "../../utils/serverTime";
import { tr } from "../../i18n";

/** Card lich su bat/tat kieu "history graph" cua HA (phan hoi 2026-10-01 "kéo
 * qua kéo lại để coi lịch sử bật tắt"): moi thiet bi 1 thanh, keo ngang de lui
 * ve qua khu, cham vao 1 doan de xem bat/tat luc nao, bao lau. Du lieu lay tu
 * recorder cua HA qua GET /api/history/states, tai THEM tung doan khi keo ra
 * ngoai vung da tai (khong tai lai tu dau). */

type Point = { t: number; s: string };
type Segment = { from: number; to: number; s: string };

const HOUR = 3600_000;
const SPANS = [
  { ms: 6 * HOUR, label: () => "6h" },
  { ms: 24 * HOUR, label: () => "24h" },
  { ms: 3 * 24 * HOUR, label: () => tr("3 ngày", "3d") },
  { ms: 7 * 24 * HOUR, label: () => tr("7 ngày", "7d") },
];
const TICK_STEPS = [15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * 60_000);
const TAIL_REFRESH_MS = 30_000;
const TAP_SLOP_PX = 5;
const ROW_PX = 30; // chieu cao 1 hang (26px thanh + 4px khe) - khop CSS .state-timeline__row

function stateKind(s: string): "on" | "off" | "na" {
  if (s === "unavailable" || s === "unknown" || !s) return "na";
  if (s === "off" || s === "closed" || s === "idle" || s === "standby") return "off";
  return "on";
}

function stateLabel(s: string): string {
  if (s === "on") return tr("Bật", "On");
  if (s === "off") return tr("Tắt", "Off");
  if (s === "unavailable") return tr("Mất kết nối", "Unavailable");
  if (s === "unknown") return tr("Không rõ", "Unknown");
  return s;
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return tr(`${Math.max(1, Math.round(ms / 1000))} giây`, `${Math.max(1, Math.round(ms / 1000))} sec`);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (d) parts.push(tr(`${d} ngày`, `${d}d`));
  if (h) parts.push(tr(`${h} giờ`, `${h}h`));
  if (m && !d) parts.push(tr(`${m} phút`, `${m}m`));
  return parts.join(" ");
}

/** Gop 2 day diem da sap xep, bo diem lien tiep trung trang thai (diem dau moi
 * doan HA tra ve = trang thai tai thoi diem bat dau doan, trung voi diem cuoi
 * doan truoc). */
function mergePoints(a: Point[], b: Point[]): Point[] {
  const all = [...a, ...b].sort((x, y) => x.t - y.t);
  const out: Point[] = [];
  for (const p of all) {
    const last = out[out.length - 1];
    if (last && last.s === p.s) continue;
    if (last && last.t === p.t) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

function segmentsIn(points: Point[], from: number, to: number, now: number): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = points[i].t;
    const end = i + 1 < points.length ? points[i + 1].t : now;
    if (end <= from || start >= to) continue;
    out.push({ from: Math.max(start, from), to: Math.min(end, to), s: points[i].s });
  }
  return out;
}

export function StateTimeline({ entityIds, entities, liveKey }: { entityIds: string[]; entities: EntitySummary[]; liveKey: string }) {
  const [spanMs, setSpanMs] = useState(24 * HOUR);
  const [endMs, setEndMs] = useState(() => serverNow());
  const [follow, setFollow] = useState(true);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<Record<string, Point[]>>({});
  const [loaded, setLoaded] = useState<{ from: number; to: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<{ entityId: string; seg: Segment; x: number; row: number } | null>(null);
  const [width, setWidth] = useState(300);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const dragRef = useRef<{ x: number; end: number; moved: boolean; id: number } | null>(null);
  const idsKey = entityIds.join(",");
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const followRef = useRef(follow);
  followRef.current = follow;

  const startMs = endMs - spanMs;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 300));
    ro.observe(el);
    setWidth(el.clientWidth || 300);
    return () => ro.disconnect();
  }, []);

  // Doi thiet bi -> bo du lieu cu, tai lai tu dau.
  useEffect(() => {
    setData({});
    setLoaded(null);
    setTip(null);
  }, [idsKey]);

  const fetchRange = useCallback(
    async (from: number, to: number) => {
      if (busyRef.current || !entityIds.length || to <= from) return;
      busyRef.current = true;
      setLoading(true);
      try {
        const res = await api.stateHistory(entityIds, new Date(from), new Date(to));
        setData((prev) => {
          const next: Record<string, Point[]> = { ...prev };
          for (const id of entityIds) {
            const pts = (res[id] || []).map((p) => ({ t: Date.parse(p.t), s: p.s })).filter((p) => Number.isFinite(p.t));
            next[id] = mergePoints(prev[id] || [], pts);
          }
          return next;
        });
        setLoaded((prev) => (prev ? { from: Math.min(prev.from, from), to: Math.max(prev.to, to) } : { from, to }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busyRef.current = false;
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey],
  );

  // Dam bao da tai du vung dang xem + 1 khung ve truoc (keo lui khong bi trong).
  useEffect(() => {
    if (error) return;
    const wantFrom = startMs - spanMs;
    if (!loaded) {
      fetchRange(wantFrom, serverNow());
    } else if (wantFrom < loaded.from) {
      // tai them dung phan thieu, toi thieu 1 khung de keo tiep khong giat
      fetchRange(Math.min(wantFrom, loaded.from - spanMs), loaded.from);
    }
  }, [startMs, spanMs, loaded, error, fetchRange]);

  // Moi 30s (va ngay khi trang thai thiet bi doi - liveKey): tai phan moi o
  // duoi, dang xem "bay gio" thi cuon theo thoi gian.
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), TAIL_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const t = serverNow();
    if (followRef.current) setEndMs(t);
    const l = loadedRef.current;
    if (l) fetchRange(l.to - 60_000, t);
  }, [tick, liveKey, fetchRange]);

  function panTo(newEnd: number) {
    const t = serverNow();
    const clamped = Math.min(newEnd, t);
    setEndMs(clamped);
    setFollow(clamped >= t - 1000);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragRef.current = { x: e.clientX, end: endMs, moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < TAP_SLOP_PX) return;
    d.moved = true;
    setTip(null);
    panTo(d.end - (dx / width) * spanMs);
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    // Cham (khong keo): hien chi tiet doan duoi ngon tay, cham ra ngoai thi an.
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // con tro dang bi capture -> e.target luon la track, tinh hang theo toa do y
    const row = Math.floor((e.clientY - rect.top) / ROW_PX);
    if (row < 0 || row >= entityIds.length || x < 0 || x > rect.width) return setTip(null);
    const entityId = entityIds[row];
    const t = startMs + (x / rect.width) * spanMs;
    const seg = segmentsIn(data[entityId] || [], startMs, endMs, serverNow()).find((s) => s.from <= t && t < s.to);
    setTip(seg ? { entityId, seg, x, row } : null);
  }

  function onWheel(e: React.WheelEvent) {
    // chi cuon ngang (touchpad/shift+lan chuot) moi keo timeline, cuon doc de trang cuon binh thuong
    const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
    if (!dx) return;
    setTip(null);
    panTo(endMs + (dx / width) * spanMs);
  }

  // Vach truc thoi gian, can theo gio cua mui gio app.
  const minStep = (spanMs / Math.max(1, width)) * 64;
  const step = TICK_STEPS.find((s) => s >= minStep) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  const offset = (secondsOfDayInZone(new Date(startMs)) * 1000) % step;
  for (let t = startMs + ((step - offset) % step); t <= endMs; t += step) ticks.push(Math.round(t / 1000) * 1000);
  const pct = (t: number) => ((t - startMs) / spanMs) * 100;
  const nowLine = serverNow();
  const names = new Map(entities.map((e) => [e.entity_id, e.alias || e.ha_friendly_name || e.entity_id]));
  const rangeText = `${fmtDateTime(new Date(startMs), { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} – ${follow ? tr("bây giờ", "now") : fmtDateTime(new Date(endMs), { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="state-timeline">
      <div className="state-timeline__head">
        <div className="device-detail__section-title state-timeline__title">{tr("Lịch sử bật/tắt", "On/off history")}</div>
        <div className="state-timeline__spans">
          {SPANS.map((s) => (
            <button
              key={s.ms}
              className={`state-timeline__chip ${s.ms === spanMs ? "state-timeline__chip--active" : ""}`}
              onClick={() => {
                setTip(null);
                setSpanMs(s.ms);
              }}
            >
              {s.label()}
            </button>
          ))}
        </div>
      </div>

      <div className="state-timeline__card">
        <div className="state-timeline__nav">
          <button className="state-timeline__arrow" aria-label={tr("Lùi", "Back")} onClick={() => panTo(endMs - spanMs / 2)}>
            <Icon path={mdiChevronLeft} size={18} />
          </button>
          <div className="state-timeline__range">
            {rangeText}
            {loading && <span className="state-timeline__loading"> · {tr("đang tải…", "loading…")}</span>}
          </div>
          {!follow && (
            <button className="state-timeline__now" onClick={() => panTo(serverNow())}>
              {tr("Bây giờ", "Now")}
            </button>
          )}
          <button className="state-timeline__arrow" aria-label={tr("Tới", "Forward")} disabled={follow} onClick={() => panTo(endMs + spanMs / 2)}>
            <Icon path={mdiChevronRight} size={18} />
          </button>
        </div>

        <div className="state-timeline__body">
          <div className="state-timeline__labels">
            {entityIds.map((id) => (
              <div key={id} className="state-timeline__label" title={names.get(id) || id}>
                {names.get(id) || id}
              </div>
            ))}
          </div>
          <div
            className="state-timeline__track"
            ref={trackRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (dragRef.current = null)}
            onWheel={onWheel}
          >
            {ticks.map((t) => (
              <div key={`g${t}`} className="state-timeline__grid" style={{ left: `${pct(t)}%` }} />
            ))}
            {entityIds.map((id) => {
              const pts = data[id] || [];
              const segs = segmentsIn(pts, startMs, endMs, nowLine);
              return (
                <div key={id} className="state-timeline__row">
                  {segs.map((seg) => {
                    const w = ((seg.to - seg.from) / spanMs) * width;
                    const kind = stateKind(seg.s);
                    const selected = tip?.entityId === id && tip.seg.from === seg.from;
                    return (
                      <div
                        key={seg.from}
                        className={`state-timeline__seg state-timeline__seg--${kind} ${selected ? "state-timeline__seg--selected" : ""}`}
                        style={{ left: `${pct(seg.from)}%`, width: `${((seg.to - seg.from) / spanMs) * 100}%` }}
                      >
                        {w > 34 && <span>{stateLabel(seg.s)}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {nowLine >= startMs && nowLine <= endMs && <div className="state-timeline__nowline" style={{ left: `${pct(nowLine)}%` }} />}
            {tip && (
              <div
                className="state-timeline__tip"
                style={{ left: Math.min(Math.max(tip.x, 90), Math.max(90, width - 90)), top: (tip.row + 1) * ROW_PX }}
              >
                <b>{stateLabel(tip.seg.s)}</b>
                <div>
                  {fmtDateTime(new Date(tip.seg.from), { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} →{" "}
                  {tip.seg.to >= serverNow() - 1000 ? tr("bây giờ", "now") : fmtTime(new Date(tip.seg.to))}
                </div>
                <div className="state-timeline__tip-dur">{formatDuration(tip.seg.to - tip.seg.from)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="state-timeline__axis">
          {ticks.map((t) => {
            const midnight = secondsOfDayInZone(new Date(t)) === 0;
            return (
              <div key={`t${t}`} className={`state-timeline__tick ${midnight ? "state-timeline__tick--day" : ""}`} style={{ left: `${pct(t)}%` }}>
                {midnight ? fmtDateTime(new Date(t), { day: "numeric", month: "short" }) : fmtTime(new Date(t))}
              </div>
            );
          })}
        </div>

        {error && <div className="state-timeline__error">{error}</div>}
        {!error && loaded && entityIds.every((id) => !(data[id] || []).length) && (
          <div className="state-timeline__empty">{tr("Home Assistant chưa ghi lịch sử cho thiết bị này (kiểm tra Recorder).", "Home Assistant has no recorded history for this device (check Recorder).")}</div>
        )}
      </div>
    </div>
  );
}
