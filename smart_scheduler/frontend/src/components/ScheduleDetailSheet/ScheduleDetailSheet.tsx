import { WEEKDAY_LABELS_VI, type Schedule, type Settings } from "../../types";
import { formatTimeDisplay } from "../../utils/formatTime";
import { describeAction, triggerLabelWithClock } from "../../utils/scheduleRange";
import { BottomSheet } from "../BottomSheet/BottomSheet";
import { appLanguage, tr } from "../../i18n";

function scheduleTimeLabel(s: Schedule, timeFormat: Settings["time_format"]): string {
  return s.trigger_type === "time" ? formatTimeDisplay(s.time, timeFormat) : triggerLabelWithClock(s.trigger_type, s.offset_minutes, s.time, s.next_run);
}

function daysLabel(days: number[]): string {
  if (days.length === 7) return tr("Hàng ngày", "Every day");
  if (days.length === 0) return tr("Không lặp", "No repeat");
  const labels = appLanguage() === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : WEEKDAY_LABELS_VI;
  return days
    .slice()
    .sort()
    .map((d) => labels[d])
    .join(" ");
}

/** Bottom sheet xem nhanh 1 schedule cu the (muc 53 SPEC_UI.md) - tap 1 dong
 * gio trong Device Detail se mo cai nay, tach biet voi ScheduleEditor (form
 * sua day du). */
export function ScheduleDetailSheet({
  open,
  schedule,
  deviceName,
  timeFormat,
  onClose,
  onSkip,
  onRunNow,
  onEdit,
  onDelete,
}: {
  open: boolean;
  schedule: Schedule | null;
  deviceName: string;
  timeFormat: Settings["time_format"];
  onClose: () => void;
  onSkip: () => void;
  onRunNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!schedule) return null;
  const autoOff = schedule.trigger_type === "auto_off";
  return (
    <BottomSheet open={open} title={scheduleTimeLabel(schedule, timeFormat)} onClose={onClose}>
      <div className="schedule-detail__summary">
        <div className="schedule-detail__name">{deviceName}</div>
        <div className="schedule-detail__action">
          {autoOff ? tr("Mỗi lần thiết bị bật, tự tắt sau khoảng thời gian này", "Every time the device turns on, it is turned off after this duration") : describeAction(schedule.action)}
        </div>
        {!autoOff && <div className="schedule-detail__days">{daysLabel(schedule.days)}</div>}
        {(schedule.start_date || schedule.end_date) && (
          <div className="schedule-detail__range">
            {schedule.start_date ?? "…"} → {schedule.end_date ?? "…"}
          </div>
        )}
      </div>
      <div className="schedule-detail__actions">
        {!autoOff && (
          <>
            <button className="btn btn--ghost btn--block" onClick={onSkip}>
              {schedule.skip_once ? tr("Hủy bỏ qua lần tới", "Cancel next-run skip") : tr("Bỏ qua lần tới", "Skip next run")}
            </button>
            <button className="btn btn--ghost btn--block" onClick={onRunNow}>
              {tr("Chạy ngay", "Run now")}
            </button>
          </>
        )}
        <button className="btn btn--ghost btn--block" onClick={onEdit}>
          {tr("Sửa lịch", "Edit schedule")}
        </button>
        <button className="btn btn--danger btn--block" onClick={onDelete}>
          {tr("Xóa lịch", "Delete schedule")}
        </button>
      </div>
    </BottomSheet>
  );
}
