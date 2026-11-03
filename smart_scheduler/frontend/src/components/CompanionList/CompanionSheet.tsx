import { mdiClose, mdiPlus } from "@mdi/js";
import { useEffect, useRef, useState } from "react";
import type { EntitySummary, Schedule } from "../../types";
import { visualFor } from "../../utils/deviceVisuals";
import { useMdiIcons } from "../../utils/mdiIcons";
import { entityNames } from "../../utils/groupSchedules";
import { companionOf, pausedOf, secondsToTime, timeToSeconds, updateCompanion } from "../../utils/scheduleRange";
import { BottomSheet } from "../BottomSheet/BottomSheet";
import { EntityPicker } from "../EntityPicker/EntityPicker";
import { Icon } from "../Icon/Icon";
import { tr } from "../../i18n";
import { isOn } from "./CompanionList";

/** Bang chi tiet 1 "Thiet bi mo cung" (v0.6.1) - bam card tren trang Nha mo
 * cai nay: xem tung thiet bi trong nhom dang bat/tat, tam ngung rieng tung
 * thiet bi (giong toggle tung moc gio), them/bot thiet bi, chinh do tre. Moi
 * thay doi luu ngay. "Sua" mo form day du (doi thiet bi mo cung). */
export function CompanionSheet({
  open,
  rule,
  entities,
  allSchedules,
  onClose,
  onEdit,
  onDelete,
  reload,
}: {
  open: boolean;
  rule: Schedule | null;
  entities: EntitySummary[];
  allSchedules: Schedule[];
  onClose: () => void;
  onEdit: (rule: Schedule) => void;
  onDelete: (id: string) => void;
  reload: () => void;
}) {
  useMdiIcons();
  type Local = { members: string[]; paused: string[]; delay: number };
  const [local, setLocal] = useState<Local>({ members: [], paused: [], delay: 0 });
  // Ban moi nhat + hang doi luu: bam nhanh nhieu lan van gui dung thu tu, moi
  // lan gui du ca 3 truong (khong de lan sau ghi de lan truoc bang lich cu).
  const latest = useRef(local);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rule) return;
    const next = { members: rule.target_entities, paused: pausedOf(rule), delay: timeToSeconds(rule.time) };
    latest.current = next;
    setLocal(next);
  }, [rule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rule) return null;
  const current = rule;
  const entityMap = new Map(entities.map((e) => [e.entity_id, e]));
  const companion = companionOf(current) ?? "";
  const pump = entityMap.get(companion);
  const pumpName = entityNames([companion], entities);
  const pumpVisual = visualFor(pump?.domain || companion.split(".", 1)[0], pumpName, pump?.icon);
  const pumpOn = isOn(pump?.state);
  const { members, paused, delay } = local;
  const following = members.filter((id) => !paused.includes(id)).length;

  function save(patch: Partial<Local>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setLocal(next);
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        await updateCompanion(current, { target_entities: next.members, paused: next.paused, time: secondsToTime(next.delay) });
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      }
      reload();
    });
  }

  function togglePaused(id: string) {
    const cur = latest.current.paused;
    save({ paused: cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id] });
  }

  function removeMember(id: string) {
    save({ members: latest.current.members.filter((m) => m !== id) });
  }

  function changeDelay(step: number) {
    save({ delay: Math.min(3600, Math.max(0, latest.current.delay + step)) });
  }

  return (
    <>
      <BottomSheet
        open={open}
        title={tr("Thiết bị mở cùng", "Companion device")}
        onClose={onClose}
        footer={
          <div className="sheet__actions">
            <button
              className="btn btn--danger"
              onClick={() => {
                if (window.confirm(tr(`Xoá "${pumpName}" khỏi Thiết bị mở cùng?`, `Remove "${pumpName}" from companion devices?`))) onDelete(current.id);
              }}
            >
              {tr("Xóa", "Delete")}
            </button>
            <button className="btn btn--ghost" onClick={() => onEdit(current)}>
              {tr("Sửa", "Edit")}
            </button>
            <button className="btn btn--primary" onClick={onClose}>
              {tr("Xong", "Done")}
            </button>
          </div>
        }
      >
        <div className="companion-sheet__pump" style={{ "--accent": pumpVisual.color } as React.CSSProperties}>
          <div className={`device-card__icon auto-off__icon ${pumpOn ? "device-card__icon--on" : ""}`}>
            <Icon path={pumpVisual.icon} size={22} />
          </div>
          <div className="auto-off__main">
            <div className="auto-off__name">{pumpName}</div>
            <div className="auto-off__state">{pumpOn ? tr("● Đang chạy", "● Running") : tr("Đang tắt", "Off")}</div>
          </div>
        </div>

        <label className="field-label">
          {tr("Thiết bị trong nhóm", "Devices in the group")} · {following}/{members.length} {tr("đang kéo theo", "active")}
        </label>
        <div className="companion-sheet__list">
          {members.map((id) => {
            const item = entityMap.get(id);
            const name = entityNames([id], entities);
            const visual = visualFor(item?.domain || id.split(".", 1)[0], name, item?.icon);
            const on = isOn(item?.state);
            const isPaused = paused.includes(id);
            return (
              <div
                key={id}
                className={`companion-sheet__row ${isPaused ? "companion-sheet__row--paused" : ""}`}
                style={{ "--accent": visual.color } as React.CSSProperties}
              >
                <div className={`device-card__icon auto-off__icon ${on ? "device-card__icon--on" : ""}`}>
                  <Icon path={visual.icon} size={20} />
                </div>
                <div className="auto-off__main">
                  <div className="auto-off__name">{name}</div>
                  <div className="auto-off__state">
                    {item?.missing ? tr("Không tìm thấy thiết bị", "Device not found") : on ? tr("● Đang bật", "● On") : tr("Đang tắt", "Off")}
                    {isPaused && ` · ${tr("tạm ngưng, không kéo theo", "paused, not followed")}`}
                  </div>
                </div>
                <label className="toggle toggle--small" title={tr("Kéo theo thiết bị mở cùng", "Drives the companion device")}>
                  <input type="checkbox" checked={!isPaused} onChange={() => togglePaused(id)} />
                  <span className="toggle__slider" />
                </label>
                <button
                  className="companion-sheet__remove"
                  disabled={members.length <= 1}
                  onClick={() => removeMember(id)}
                  aria-label={tr("Bỏ khỏi nhóm", "Remove from group")}
                  title={tr("Bỏ khỏi nhóm", "Remove from group")}
                >
                  <Icon path={mdiClose} size={18} />
                </button>
              </div>
            );
          })}
          <button className="companion-sheet__add" onClick={() => setPickerOpen(true)}>
            <Icon path={mdiPlus} size={18} />
            {tr("Thêm thiết bị", "Add device")}
          </button>
        </div>

        <label className="field-label">{tr("Trễ trước khi tắt", "Turn-off delay")}</label>
        <div className="companion-delay">
          <button type="button" className="btn btn--ghost" aria-label={tr("Bớt 1 giây", "1 second less")} onClick={() => changeDelay(-1)}>−</button>
          <span className="companion-delay__value">{delay} {tr("giây", "s")}</span>
          <button type="button" className="btn btn--ghost" aria-label={tr("Thêm 1 giây", "1 second more")} onClick={() => changeDelay(1)}>+</button>
        </div>
        <p className="settings-hint">
          {tr(
            "Tắt công tắc của một thiết bị để tạm ngưng: nó vẫn ở trong nhóm nhưng bật/tắt nó không kéo theo thiết bị mở cùng.",
            "Switch a device off to pause it: it stays in the group, but turning it on or off no longer drives the companion device.",
          )}
        </p>
        {error && <p className="form-error">{error}</p>}
      </BottomSheet>

      <EntityPicker
        open={pickerOpen}
        selected={members}
        schedules={allSchedules}
        exclude={[companion]}
        title={tr("Chọn các thiết bị trong nhóm", "Select the devices in the group")}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => {
          setPickerOpen(false);
          if (ids.length > 0) save({ members: ids });
        }}
      />
    </>
  );
}
