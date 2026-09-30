import { mdiDragVertical } from "@mdi/js";
import { useEffect, useRef } from "react";
import Sortable from "sortablejs";
import { api } from "../../services/api";
import { removeStaleFallbackClones } from "../../utils/sortableFallbackCleanup";
import type { EntitySummary, ManualTimer, Schedule } from "../../types";
import { visualFor } from "../../utils/deviceVisuals";
import { useMdiIcons } from "../../utils/mdiIcons";
import { entityNames } from "../../utils/groupSchedules";
import { formatDuration } from "../../utils/scheduleRange";
import { Icon } from "../Icon/Icon";
import { OnTimeProgress } from "../OnTimeProgress/OnTimeProgress";
import { tr } from "../../i18n";

/** Moi lich "Tu tat sau khi bat" gop thanh 1 danh sach tren trang Nha thay vi
 * moi thiet bi 1 card (phan hoi 2026-09-30): Icon | Ten + thanh dem nguoc |
 * thoi gian | toggle. Bam dong de sua/xoa. Che do "Sap xep" (nut but tren
 * Nha) hien tay cam keo doi thu tu - cung quy uoc SortableJS voi
 * DeviceDetail.tsx (sort_order la truc GLOBAL, lich khac giu vi tri o cuoi). */
export function AutoOffList({
  rules,
  entities,
  activeTimers,
  allSchedules,
  editMode,
  onEdit,
  onToggle,
  reload,
  setDragging,
}: {
  rules: Schedule[];
  allSchedules: Schedule[];
  editMode: boolean;
  reload: () => void;
  setDragging: (dragging: boolean) => void;
  entities: EntitySummary[];
  activeTimers: ManualTimer[];
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
    <div className="auto-off">
      <div className="device-detail__section-title">⏱ {tr("Tự tắt sau khi bật", "Auto-off after on")}</div>
      <div className="auto-off__list" ref={listRef}>
        {rules.map((rule) => {
          const first = entityMap.get(rule.target_entities[0]);
          const name = entityNames(rule.target_entities, entities);
          const visual = visualFor(first?.domain || rule.action.domain, name, first?.icon);
          const on = rule.target_entities.some((id) => {
            const st = entityMap.get(id)?.state;
            return st !== undefined && st !== "off" && st !== "closed" && st !== "unavailable" && st !== "unknown";
          });
          const enabled = rule.enabled && rule.card_enabled !== false;
          const timer = enabled
            ? activeTimers.find((t) => t.source === "auto_off" && t.started_at && t.off_at && rule.target_entities.includes(t.entity_ids[0]))
            : undefined;
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
              <div className={`device-card__icon auto-off__icon ${on ? "device-card__icon--on" : ""}`}>
                <Icon path={visual.icon} size={22} />
              </div>
              <div className="auto-off__main">
                <div className="auto-off__name">{name}</div>
                {timer && on ? (
                  <OnTimeProgress startAt={timer.started_at!} endAt={timer.off_at!} />
                ) : (
                  <div className="auto-off__state">{on ? tr("● Đang bật", "● On") : tr("Đang tắt", "Off")}</div>
                )}
              </div>
              <div className="auto-off__duration">{formatDuration(rule.time)}</div>
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
