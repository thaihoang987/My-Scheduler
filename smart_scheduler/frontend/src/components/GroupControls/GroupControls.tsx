import { mdiSkipNext } from "@mdi/js";
import { useState } from "react";
import { api } from "../../services/api";
import type { Group } from "../../types";
import { fmtDateTime } from "../../utils/appTime";
import { BottomSheet } from "../BottomSheet/BottomSheet";
import { Icon } from "../Icon/Icon";
import { tr } from "../../i18n";

/** Ngay cuoi cung dang bo qua (skip_until la 00:00 cua ngay KE TIEP). */
export function skipLabel(skipUntil: string): string {
  return fmtDateTime(new Date(Date.parse(skipUntil) - 1), { weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Nut tren tieu de 1 nhom o trang Nha (phan hoi 2026-10-03 "mua to thi khoi
 * tuoi"): ⏭ Bo qua lenh Bat cua ca nhom toi het ngay chon (lenh Tat van chay,
 * toi han tu chay lai) + cong tac nhom. Tat nhom KHONG doi toggle cua tung
 * card - card giu trang thai rieng, chi bi nhom khong che va mo di. */
export function GroupControls({ group, onChanged }: { group: Group; onChanged: () => void }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const skip = (days: number | null) => run(async () => {
    await api.setGroupSkip(group.id, days);
    setSheetOpen(false);
  });

  const options: { days: number; label: string }[] = [
    { days: 0, label: tr("Bỏ qua hết hôm nay", "Skip the rest of today") },
    { days: 1, label: tr("Bỏ qua tới hết ngày mai", "Skip through tomorrow") },
    { days: 2, label: tr("Bỏ qua 3 ngày", "Skip 3 days") },
  ];

  return (
    <span className="group-controls">
      <button
        className={`group-controls__skip ${group.skip_until ? "group-controls__skip--active" : ""}`}
        onClick={() => setSheetOpen(true)}
        disabled={!group.enabled}
        title={tr("Bỏ qua lệnh Bật của cả nhóm (ví dụ trời mưa)", "Skip the group's ON actions (e.g. rain)")}
      >
        <Icon path={mdiSkipNext} size={16} />
        <span className="group-controls__skip-text">
          {group.skip_until ? tr(`Tới hết ${skipLabel(group.skip_until)}`, `Until end of ${skipLabel(group.skip_until)}`) : tr("Bỏ qua", "Skip")}
        </span>
      </button>
      <label className="toggle toggle--small">
        <input
          type="checkbox"
          checked={group.enabled}
          disabled={busy}
          onChange={() => run(() => api.setGroupEnabled(group.id, !group.enabled))}
          aria-label={tr(`Bật/tắt cả nhóm ${group.name}`, `Turn group ${group.name} on/off`)}
        />
        <span className="toggle__slider" />
      </label>

      <BottomSheet
        open={sheetOpen}
        title={`⏭ ${tr("Bỏ qua", "Skip")} - ${group.name}`}
        onClose={() => setSheetOpen(false)}
        footer={
          <div className="sheet__actions">
            {group.skip_until && (
              <button className="btn btn--danger" onClick={() => skip(null)} disabled={busy}>
                {tr("Hủy bỏ qua", "Cancel skip")}
              </button>
            )}
            <button className="btn btn--ghost" onClick={() => setSheetOpen(false)}>
              {tr("Đóng", "Close")}
            </button>
          </div>
        }
      >
        {group.skip_until && (
          <div className="group-controls__current">
            {tr(`Đang bỏ qua tới hết ${skipLabel(group.skip_until)}`, `Skipping until the end of ${skipLabel(group.skip_until)}`)}
          </div>
        )}
        <div className="group-controls__options">
          {options.map((o) => (
            <button key={o.days} className="btn btn--ghost btn--block" onClick={() => skip(o.days)} disabled={busy}>
              {o.label}
            </button>
          ))}
        </div>
      </BottomSheet>
    </span>
  );
}
