import { useState } from "react";
import { api } from "../../services/api";
import type { ManualTimer } from "../../types";
import { OnTimeProgress } from "../OnTimeProgress/OnTimeProgress";
import { tr } from "../../i18n";

const DURATION_PRESETS: { vi: string; en: string; minutes: number | null }[] = [
  { vi: "Không tự tắt", en: "No auto-off", minutes: null },
  { vi: "15 phút", en: "15 minutes", minutes: 15 },
  { vi: "30 phút", en: "30 minutes", minutes: 30 },
  { vi: "1 giờ", en: "1 hour", minutes: 60 },
  { vi: "2 giờ", en: "2 hours", minutes: 120 },
];

/** "Bat cuong che" + tu tat sau X phut (muc 2026-09-23) - nut THU CONG rieng
 * biet voi Schedule. Hen tu tat duoc luu ben vung qua restart App.
 * Bat NGAY qua `homeassistant.turn_on` (khong dat
 * che do/nhiet do/do sang gi - muon chi tiet thi dung "Chay ngay" cua 1
 * Schedule "Dat che do/den/vi tri/toc do" thay vi nut nay). */
export function ForceOnControl({ entityIds, activeTimers, reloadTimers }: { entityIds: string[]; activeTimers: ManualTimer[]; reloadTimers: () => void }) {
  const [selectedMinutes, setSelectedMinutes] = useState<number | null>(30);
  const [busy, setBusy] = useState(false);

  const idSet = new Set(entityIds);
  const active = activeTimers.find((t) => t.source !== "auto_off" && t.entity_ids.length === entityIds.length && t.entity_ids.every((id) => idSet.has(id)));

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
        {DURATION_PRESETS.map((p) => (
          <button key={p.vi} className={selectedMinutes === p.minutes ? "chip chip--active" : "chip"} onClick={() => setSelectedMinutes(p.minutes)}>
            {tr(p.vi, p.en)}
          </button>
        ))}
      </div>
      <button className="btn btn--primary btn--block" onClick={handleForceOn} disabled={busy}>
        ⚡ {tr("Bật cưỡng chế", "Force on")}
      </button>
    </div>
  );
}
