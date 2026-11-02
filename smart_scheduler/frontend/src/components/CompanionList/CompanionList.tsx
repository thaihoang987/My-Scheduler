import { mdiDragVertical } from "@mdi/js";
import { useEffect, useRef } from "react";
import Sortable from "sortablejs";
import { api } from "../../services/api";
import { removeStaleFallbackClones } from "../../utils/sortableFallbackCleanup";
import type { EntitySummary, Schedule } from "../../types";
import { visualFor } from "../../utils/deviceVisuals";
import { useMdiIcons } from "../../utils/mdiIcons";
import { entityNames } from "../../utils/groupSchedules";
import { companionOf, formatDuration } from "../../utils/scheduleRange";
import { Icon } from "../Icon/Icon";
import { MissingMark } from "../DeviceCard/DeviceCard";
import type { SectionControls } from "../GroupedDeviceGrid/GroupedDeviceGrid";
import { SectionHeader } from "../SectionHeader/SectionHeader";
import { tr } from "../../i18n";

const isOn = (state: string | undefined) =>
  state !== undefined && !["off", "closed", "closing", "unavailable", "unknown"].includes(state);

/** "Thiet bi mo cung" (v0.6.0) tren trang Nha - cung kieu AutoOffList: Icon |
 * ten thiet bi mo cung + nhom | do tre | toggle. Bam dong de sua/xoa, che do
 * "Sap xep" hien tay cam keo doi thu tu (sort_order chung voi moi lich). */
export function CompanionList({
  rules,
  entities,
  allSchedules,
  editMode,
  onEdit,
  onToggle,
  reload,
  setDragging,
  controls,
}: {
  controls: SectionControls;
  rules: Schedule[];
  allSchedules: Schedule[];
  editMode: boolean;
  reload: () => void;
  setDragging: (dragging: boolean) => void;
  entities: EntitySummary[];
  onEdit: (rule: Schedule) => void;
  onToggle: (rule: Schedule) => void;
}) {
  useMdiIcons();
  const listRef = useRef<HTMLDivElement>(null);
  const allRef = useRef(allSchedules);
  allRef.current = allSchedules;
  const hasRules = rules.length > 0;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const sortable = Sortable.create(el, {
      handle: ".drag-handle",
      draggable: ".auto-off__row",
      animation: 150,
      forceFallback: true,
      fallbackTolerance: 3,
      fallbackOnBody: true,
      onChoose: () => removeStaleFallbackClones(),
      onStart: () => setDragging(true),
      onEnd: async () => {
        try {
          const orderedIds = Array.from(el.children).map((c) => (c as HTMLElement).dataset.key!).filter(Boolean);
          const remaining = allRef.current.filter((s) => !orderedIds.includes(s.id)).map((s) => s.id);
          await api.reorderSchedules([...orderedIds, ...remaining]);
          reload();
        } finally {
          removeStaleFallbackClones();
          setDragging(false);
        }
      },
    });
    return () => sortable.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRules]);

  if (!hasRules) return null;
  const entityMap = new Map(entities.map((e) => [e.entity_id, e]));

  return (
    <div className="device-section auto-off">
      <SectionHeader title={`🔗 ${tr("Thiết bị mở cùng", "Companion devices")}`} count={rules.length} {...controls} />
      <div className={`auto-off__list ${controls.collapsed ? "is-collapsed" : ""}`} ref={listRef}>
        {rules.map((rule) => {
          const companion = companionOf(rule) ?? "";
          const item = entityMap.get(companion);
          const name = entityNames([companion], entities);
          const visual = visualFor(item?.domain || companion.split(".", 1)[0], name, item?.icon);
          const running = isOn(item?.state);
          const enabled = rule.enabled && rule.card_enabled !== false;
          const ids = [companion, ...rule.target_entities];
          const missingIds = ids.filter((id) => entityMap.get(id)?.missing);
          return (
            <div
              key={rule.id}
              data-key={rule.id}
              className={`auto-off__row ${!enabled ? "auto-off__row--dim" : ""}`}
              style={{ "--accent": visual.color } as React.CSSProperties}
              onClick={() => onEdit(rule)}
            >
              {editMode && (
                <span className="drag-handle" onClick={(e) => e.stopPropagation()} aria-label={tr("Kéo để đổi vị trí", "Drag to reorder")} title={tr("Kéo để đổi vị trí", "Drag to reorder")}>
                  <Icon path={mdiDragVertical} size={18} />
                </span>
              )}
              <div className={`device-card__icon auto-off__icon ${running ? "device-card__icon--on" : ""}`}>
                <Icon path={visual.icon} size={22} />
              </div>
              <div className="auto-off__main">
                <div className="auto-off__name">
                  {name}
                  <MissingMark missingIds={missingIds} total={ids.length} />
                </div>
                <div className="auto-off__state">
                  {running ? tr("● Đang chạy", "● Running") : tr("Đang tắt", "Off")}
                  {" · "}
                  {tr("theo", "follows")}{" "}
                  {rule.target_entities.length <= 2
                    ? entityNames(rule.target_entities, entities)
                    : `${rule.target_entities.length} ${tr("thiết bị", "devices")}`}
                </div>
              </div>
              <div className="auto-off__duration" title={tr("Trễ trước khi tắt", "Turn-off delay")}>
                {formatDuration(rule.time)}
              </div>
              <label className="toggle toggle--small" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={enabled} onChange={() => onToggle(rule)} />
                <span className="toggle__slider" />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
