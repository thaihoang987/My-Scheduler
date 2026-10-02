import { mdiDragVertical, mdiFilterOutline } from "@mdi/js";
import type { EntitySummary, Schedule, Settings } from "../../types";
import { formatTimeDisplay } from "../../utils/formatTime";
import { describeAction, triggerLabelWithClock, type ScheduleRowItem } from "../../utils/scheduleRange";
import { conditionSummary } from "../../utils/conditionStates";
import { Icon } from "../Icon/Icon";
import { tr } from "../../i18n";

function rowTimeLabel(s: Schedule, timeFormat: Settings["time_format"]): string {
  return s.trigger_type === "time" ? formatTimeDisplay(s.time, timeFormat) : triggerLabelWithClock(s.trigger_type, s.offset_minutes, s.time, s.next_run);
}

/** 1 dong trong Device Detail (muc 13/14/52 SPEC_UI.md) - dong don hien
 * "HH:MM:SS Bat/Tat", dong khung gio (2 Schedule turn_on+turn_off cung
 * group_id, xem scheduleRange.ts) hien "HH:MM:SS → HH:MM:SS". Tap vao dong de mo
 * sua, toggle rieng o cuoi dong bat/tat CA HAI ve cung 1 luc neu la khung
 * gio (phan hoi 2026-09-22). Tay cam keo rieng (`.drag-handle`, xem
 * DeviceDetail.tsx) - phan hoi 2026-09-23 "cho thêm drag drop đổi vị trí
 * Lịch trong config", cung 1 quy uoc voi DeviceCard.tsx (khong keo ca dong,
 * tranh nham voi bam-de-mo). */
export function ScheduleRow({
  item,
  entities,
  timeFormat,
  running = false,
  onOpen,
  onToggle,
}: {
  item: ScheduleRowItem;
  entities: EntitySummary[];
  timeFormat: Settings["time_format"];
  /** Dang trong khung gio bat -> to vang (xem isRangeRowRunning). */
  running?: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { primary, secondary, isRange } = item;
  const cond = conditionSummary(primary.conditions, primary.target_entities, entities);
  const condChip = cond && (
    <span className="schedule-row__cond" title={tr("Chỉ chạy khi", "Only runs if") + " " + cond}>
      <Icon path={mdiFilterOutline} size={12} />
      {cond}
    </span>
  );
  return (
    <div className={`schedule-row ${running ? "schedule-row--running" : ""}`} data-key={item.key}>
      <span className="drag-handle" onClick={(e) => e.stopPropagation()} aria-label={tr("Kéo để đổi vị trí", "Drag to reorder")} title={tr("Kéo để đổi vị trí", "Drag to reorder")}>
        <Icon path={mdiDragVertical} size={18} />
      </span>
      <button className="schedule-row__main" onClick={onOpen}>
        {isRange && secondary ? (
          <>
            <span className="schedule-row__time">
              {rowTimeLabel(primary, timeFormat)} → {rowTimeLabel(secondary, timeFormat)}
            </span>
            {condChip}
          </>
        ) : (
          <>
            <span className="schedule-row__time">{rowTimeLabel(primary, timeFormat)}</span>
            {primary.trigger_type !== "auto_off" && <span className="schedule-row__action">{describeAction(primary.action)}</span>}
            {condChip}
          </>
        )}
      </button>
      <label className="toggle toggle--small" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={primary.enabled} onChange={onToggle} />
        <span className="toggle__slider" />
      </label>
    </div>
  );
}
