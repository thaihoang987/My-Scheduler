import { useState } from "react";
import { api } from "../../services/api";
import type { ManualTimer } from "../../types";
import { OnTimeProgress } from "../OnTimeProgress/OnTimeProgress";
import { tr } from "../../i18n";

const DEFAULT_DURATIONS = [5, 10, 30, 60, 120];

function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return tr(`${m} phút`, `${m} min`);
  if (m === 0) return tr(`${h} giờ`, `${h} h`);
  return tr(`${h} giờ ${m} phút`, `${h} h ${m} min`);
}

/** "Bat cuong che" + tu tat sau X phut (muc 2026-09-23) - nut THU CONG rieng
 * biet voi Schedule. Hen tu tat duoc luu ben vung qua restart App.
 * Bat NGAY qua `homeassistant.turn_on` (khong dat
 * che do/nhiet do/do sang gi - muon chi tiet thi dung "Chay ngay" cua 1
 * Schedule "Dat che do/den/vi tri/toc do" thay vi nut nay). */
export function ForceOnControl({ entityIds, activeTimers, reloadTimers, durations, reloadSettings }: { entityIds: string[]; activeTimers: ManualTimer[]; reloadTimers: () => void; durations: number[]; reloadSettings: () => void }) {
  const [selectedMinutes, setSelectedMinutes] = useState<number | null>(30);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [newUnit, setNewUnit] = useState<1 | 60>(1);

  const idSet = new Set(entityIds);
  const active = activeTimers.find((t) => t.source !== "auto_off" && t.entity_ids.length === entityIds.length && t.entity_ids.every((id) => idSet.has(id)));

  async function saveDurations(next: number[]) {
    await api.updateSettings({ manual_durations: next });
    reloadSettings();
  }

  async function removeDuration(min: number) {
    if (selectedMinutes === min) setSelectedMinutes(null);
    await saveDurations(durations.filter((d) => d !== min));
  }

  async function addDuration() {
    const min = Math.round(Number(newValue) * newUnit);
    if (!Number.isFinite(min) || min < 1 || min > 10080) return;
    setNewValue("");
    if (!durations.includes(min)) await saveDurations([...durations, min].sort((a, b) => a - b));
    setSelectedMinutes(min);
  }

  async function handleForceOn() {
    setBusy(true);
    try {
      await api.forceOn(entityIds, selectedMinutes);
      reloadTimers();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!active?.id) return;
    setBusy(true);
    try {
      await api.cancelManualTimer(active.id);
      reloadTimers();
    } finally {
      setBusy(false);
    }
  }

  if (active) {
    return (
      <div className="force-on force-on--active">
        <div className="force-on__status">⚡ {tr("Đang bật cưỡng chế", "Forced on")}</div>
        {active.off_at ? (
          <>
            {active.started_at && <OnTimeProgress startAt={active.started_at} endAt={active.off_at} />}
            <button className="btn btn--ghost btn--block" onClick={handleCancel} disabled={busy}>
              {tr("Huỷ", "Cancel")}
            </button>
          </>
        ) : (
          <div className="force-on__countdown">{tr("Không hẹn tự tắt", "No auto-off scheduled")}</div>
        )}
      </div>
    );
  }

  return (
    <div className="force-on">
      <div className="chip-row">
        <button className={selectedMinutes === null ? "chip chip--active" : "chip"} onClick={() => setSelectedMinutes(null)}>
          {tr("Không tự tắt", "No auto-off")}
        </button>
        {durations.map((m) =>
          editing ? (
            <button key={m} className="chip chip--editing" onClick={() => removeDuration(m)} title={tr("Xoá mốc này", "Remove this preset")}>
              {durationLabel(m)} ✕
            </button>
          ) : (
            <button key={m} className={selectedMinutes === m ? "chip chip--active" : "chip"} onClick={() => setSelectedMinutes(m)}>
              {durationLabel(m)}
            </button>
          ),
        )}
        <button className={editing ? "chip chip--icon chip--active" : "chip chip--icon"} onClick={() => setEditing(!editing)} aria-label={tr("Sửa các mốc thời gian", "Edit presets")} title={tr("Sửa các mốc thời gian", "Edit presets")}>
          {editing ? "✓" : "✎"}
        </button>
      </div>
      {editing && (
        <div className="force-on__edit">
          <input className="input force-on__edit-input" type="number" inputMode="numeric" min={1} placeholder={tr("Số", "Value")} value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addDuration()} />
          <select className="input force-on__edit-unit" value={newUnit} onChange={(e) => setNewUnit(Number(e.target.value) as 1 | 60)}>
            <option value={1}>{tr("phút", "min")}</option>
            <option value={60}>{tr("giờ", "hours")}</option>
          </select>
          <button className="btn btn--ghost" onClick={addDuration} disabled={!newValue}>
            + {tr("Thêm", "Add")}
          </button>
          <button className="btn btn--ghost" onClick={() => saveDurations(DEFAULT_DURATIONS)}>
            {tr("Mặc định", "Reset")}
          </button>
        </div>
      )}
      <button className="btn btn--primary btn--block" onClick={handleForceOn} disabled={busy}>
        ⚡ {tr("Bật cưỡng chế", "Force on")}
      </button>
    </div>
  );
}
