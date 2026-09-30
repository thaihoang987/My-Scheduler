import { mdiClose, mdiDragVertical, mdiFolderMoveOutline, mdiStar, mdiStarOutline } from "@mdi/js";
import type { DeviceGroup, ManualTimer, Settings } from "../../types";
import { activeOnWindow, anyEnabled, cardEnabled, nextRunOf } from "../../utils/groupSchedules";
import { visualFor } from "../../utils/deviceVisuals";
import { useMdiIcons } from "../../utils/mdiIcons";
import { formatTimeDisplay } from "../../utils/formatTime";
import { describeAction } from "../../utils/scheduleRange";
import { Countdown } from "../Countdown/Countdown";
import { Icon } from "../Icon/Icon";
import { OnTimeProgress } from "../OnTimeProgress/OnTimeProgress";
import { tr } from "../../i18n";

function actionWord(group: DeviceGroup, scheduleId: string | null): string {
  const s = group.schedules.find((x) => x.id === scheduleId);
  return s ? describeAction(s.action) : "";
}

export function DeviceCard({
  group,
  compact,
  timeFormat,
  activeTimers,
  onOpen,
  onToggleFavorite,
  onToggleEnabled,
  sortable = true,
  categoryLabel,
  onChangeCategory,
  onDelete,
}: {
  group: DeviceGroup;
  compact: boolean;
  timeFormat: Settings["time_format"];
  activeTimers: ManualTimer[];
  onOpen: () => void;
  onToggleFavorite: () => void;
  /** Bat/tat CA NHOM (moi lich cua thiet bi nay) cung luc - phan hoi
   * 2026-09-22: thieu toggle cho ca "1 timer" sau redesign UI. */
  onToggleEnabled: () => void;
  /** Cho phep keo-tha doi vi tri hay khong - cha (DeviceGrid/GroupedDeviceGrid)
   * tu quan ly SortableJS tren THE CHA CHUA (khong con dung dnd-kit's
   * useSortable() rieng tung the nhu truoc - phan hoi 2026-09-23 "kéo thả
   * quá khó khăn ... trên điện thoại không thể nắm kéo được": dnd-kit keo ca
   * card (trung voi vung bam mo Device Detail, kho phan biet tap/keo tren
   * dien thoai). Doi sang SortableJS (cung thu vien addon PZEM da dung on
   * dinh) VOI 1 TAY CAM RIENG (`.drag-handle`, xem duoi) - chi vung tay cam
   * moi bat dau keo, phan con lai cua card van bam mo binh thuong, khong
   * con nham lan. */
  sortable?: boolean;
  categoryLabel?: string;
  onChangeCategory?: () => void;
  /** Xoa CA CARD (moi lich cua thiet bi nay) - CHI hien khi dang o che do
   * "Sap xep" (sortable=true, xem Home.tsx nut but) - phan hoi 2026-09-23
   * "lúc nhấn cây bút cho hiển thị thêm nút x để xoá card timer tổng". Cha
   * (Home.tsx) tu hien popup xac nhan truoc khi thuc su goi ham nay. */
  onDelete?: () => void;
}) {
  useMdiIcons(); // render lai khi thu vien icon day du nap xong
  const visual = visualFor(group.domain, group.title, group.singleEntity?.icon);
  const { time: nextRun, scheduleId } = nextRunOf(group);
  const enabled = cardEnabled(group);
  const hasEnabledSchedule = anyEnabled(group);
  const hasSchedules = group.schedules.length > 0;
  const multiEntity = group.entityIds.length > 1;
  const onWindow = activeOnWindow(group, activeTimers);

  return (
    <div
      data-key={group.key}
      style={{ "--accent": visual.color } as React.CSSProperties}
      className={`device-card ${compact ? "device-card--compact" : ""} ${!enabled ? "device-card--dim" : ""}`}
      onClick={onOpen}
    >
      <div className="device-card__top">
        <button
          className={`device-card__favorite ${group.favorite ? "device-card__favorite--active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={tr("Yêu thích", "Favorite")}
        >
          <Icon path={group.favorite ? mdiStar : mdiStarOutline} size={20} />
        </button>

        <div className="device-card__top-actions">
          {sortable && (
            <span className="drag-handle" onClick={(e) => e.stopPropagation()} aria-label={tr("Kéo để đổi vị trí", "Drag to reorder")} title={tr("Kéo để đổi vị trí", "Drag to reorder")}>
              <Icon path={mdiDragVertical} size={20} />
            </span>
          )}
          {onChangeCategory && (
            <button
              className="device-card__group-btn"
              onClick={(e) => {
                e.stopPropagation();
                onChangeCategory();
              }}
              aria-label={`${tr("Chuyển nhóm, hiện tại", "Move group, current")}: ${categoryLabel || tr("Chưa phân nhóm", "Ungrouped")}`}
              title={`${tr("Chuyển nhóm", "Move group")}: ${categoryLabel || tr("Chưa phân nhóm", "Ungrouped")}`}
            >
              <Icon path={mdiFolderMoveOutline} size={19} />
            </button>
          )}
          {hasSchedules && (
            <label className="toggle toggle--small" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={enabled} onChange={onToggleEnabled} />
              <span className="toggle__slider" />
            </label>
          )}
          {sortable && onDelete && (
            <button
              className="device-card__delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label={tr("Xoá thiết bị này khỏi hẹn giờ", "Remove this device from schedules")}
              title={tr("Xoá thiết bị này khỏi hẹn giờ", "Remove this device from schedules")}
            >
              <Icon path={mdiClose} size={18} />
            </button>
          )}
        </div>
      </div>

      <div className={`device-card__icon ${group.isOn ? "device-card__icon--on" : ""}`}>
        <Icon path={visual.icon} size={compact ? 22 : 30} />
      </div>

      <div className="device-card__title">{group.title}</div>
      {group.area && !compact && <div className="device-card__area">{group.area}</div>}
      {multiEntity && <div className="device-card__area">{group.entityIds.length} {tr("thiết bị", "devices")}</div>}

      {group.singleEntity && !compact && !onWindow && (
        <div className={`device-card__state ${group.singleEntity.state === "on" ? "device-card__state--on" : ""}`}>
          {group.singleEntity.state === "on" ? tr("● Đang bật", "● On") : group.singleEntity.state === "off" ? tr("Đang tắt", "Off") : tr("Không khả dụng", "Unavailable")}
        </div>
      )}

      {hasSchedules ? (
        <>
          {nextRun ? (
            <div className="device-card__next">
              <div className="device-card__time">{formatTimeDisplay(new Date(nextRun).toTimeString().slice(0, 8), timeFormat)}</div>
              <div className="device-card__action">{actionWord(group, scheduleId)}</div>
              {!onWindow && <Countdown nextRun={nextRun} />}
            </div>
          ) : (
            <div className="device-card__next device-card__next--off">{!enabled ? tr("Tạm tắt", "Paused") : hasEnabledSchedule ? tr("Không có lần chạy tới", "No upcoming run") : tr("Chưa bật lịch nào", "No enabled schedules")}</div>
          )}
        </>
      ) : (
        <div className="device-card__next device-card__next--off">{tr("Chưa có lịch", "No schedules")}</div>
      )}
      {onWindow && <OnTimeProgress startAt={onWindow.startAt} endAt={onWindow.endAt} />}
    </div>
  );
}
