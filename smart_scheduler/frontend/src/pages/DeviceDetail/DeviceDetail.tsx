import { mdiChevronLeft, mdiPencilOutline, mdiPlus } from "@mdi/js";
import { useEffect, useRef, useState } from "react";
import Sortable from "sortablejs";
import { Countdown } from "../../components/Countdown/Countdown";
import { EntityPicker } from "../../components/EntityPicker/EntityPicker";
import { ForceOnControl } from "../../components/ForceOnControl/ForceOnControl";
import { Icon } from "../../components/Icon/Icon";
import { OnTimeProgress } from "../../components/OnTimeProgress/OnTimeProgress";
import { ScheduleDetailSheet } from "../../components/ScheduleDetailSheet/ScheduleDetailSheet";
import { ScheduleEditor } from "../../components/ScheduleEditor/ScheduleEditor";
import { ScheduleRow } from "../../components/ScheduleRow/ScheduleRow";
import { skipLabel } from "../../components/GroupControls/GroupControls";
import { StateTimeline } from "../../components/StateTimeline/StateTimeline";
import { api } from "../../services/api";
import type { DeviceGroup, EntitySummary, ManualTimer, Schedule, Settings } from "../../types";
import { serverNow } from "../../utils/serverTime";
import { removeStaleFallbackClones } from "../../utils/sortableFallbackCleanup";
import { visualFor } from "../../utils/deviceVisuals";
import { useMdiIcons } from "../../utils/mdiIcons";
import { formatTimeDisplay } from "../../utils/formatTime";
import { activeOnWindow, cardEnabled, entityNames, isRangeRowRunning, nextRunOf } from "../../utils/groupSchedules";
import { deleteScheduleWithSibling, describeAction, groupIntoRows, saveScheduleDraft, triggerLabelWithClock, type ScheduleDraft } from "../../utils/scheduleRange";
import { tr } from "../../i18n";

export function DeviceDetail({
  group,
  entities,
  settings,
  allSchedules,
  onBack,
  reload,
  activeTimers,
  reloadTimers,
  setDragging,
}: {
  group: DeviceGroup;
  entities: EntitySummary[];
  settings: Settings;
  allSchedules: Schedule[];
  onBack: () => void;
  reload: () => void;
  activeTimers: ManualTimer[];
  reloadTimers: () => void;
  /** Bao App.tsx tam dung setState nen tu poll/WebSocket trong luc
   * SortableJS dang thao tac DOM cua danh sach Lich (xem ghi chu draggingRef
   * trong App.tsx) - can cho ca trang nay tu khi them keo-tha doi thu tu
   * Lich (phan hoi 2026-09-23), truoc do trang nay khong keo-tha gi nen
   * chua can. */
  setDragging: (dragging: boolean) => void;
}) {
  const [detailSchedule, setDetailSchedule] = useState<Schedule | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  /** Cong tac TONG ca card (v0.5.66) - CUNG du lieu (card_enabled) va cung API
   * voi cong tac tren card o trang Nha, nen bat/tat ben nao ben kia cung doi
   * theo (WebSocket/poll tai lai lich cho moi tab dang mo). */
  const [toggling, setToggling] = useState(false);
  async function toggleCard() {
    if (toggling) return;
    setToggling(true);
    try {
      await api.groupToggleSchedules(group.schedules.map((s) => s.id), !cardEnabled(group));
      reload();
    } finally {
      setToggling(false);
    }
  }
  const rowListRef = useRef<HTMLDivElement | null>(null);
  // Tick 1s de dong Lich tu sang vang khi toi gio bat va tu tat mau khi het
  // khung (isRangeRowRunning), khong can cho reload tu backend.
  const [nowMs, setNowMs] = useState(serverNow());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(serverNow()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useMdiIcons(); // render lai khi thu vien icon day du nap xong

  const visual = visualFor(group.domain, group.title, group.singleEntity?.icon);
  const { time: nextRun, scheduleId } = nextRunOf(group);
  const nextSchedule = group.schedules.find((s) => s.id === scheduleId);
  const skipUntil = group.schedules.find((s) => s.group_skip_until)?.group_skip_until ?? null;
  // "Tu tat sau khi bat" KHONG nam trong timer card (phan hoi 2026-10-03):
  // khong chiu cong tac Hen gio, de chung lam sai y nghia - chi quan ly o Nha.
  const defaultRows = groupIntoRows(group.schedules);
  const savedOrder = settings.detail_row_order?.[group.key] ?? [];
  const rows = [...defaultRows].sort((a, b) => {
    const ai = savedOrder.indexOf(a.key), bi = savedOrder.indexOf(b.key);
    if (ai >= 0 && bi >= 0) return ai - bi;
    return ai >= 0 ? -1 : bi >= 0 ? 1 : 0;
  });
  const onWindow = activeOnWindow(group, activeTimers);
  const stateMap = new Map(entities.map((e) => [e.entity_id, e.state]));
  const liveKey = group.entityIds.map((id) => stateMap.get(id) ?? "").join("|");

  async function handleSave(draft: ScheduleDraft, id?: string) {
    await saveScheduleDraft(draft, entities, editing, allSchedules, cardEnabled(group));
    setEditorOpen(false);
    setEditing(null);
    reload();
  }

  // Detail ordering is independent of the global order used by Home.
  const detailOrderRef = useRef(settings.detail_row_order ?? {});
  detailOrderRef.current = settings.detail_row_order ?? {};
  const groupKeyRef = useRef(group.key);
  groupKeyRef.current = group.key;

  useEffect(() => {
    const el = rowListRef.current;
    if (!el) return;
    const sortable = Sortable.create(el, {
      handle: ".drag-handle",
      draggable: ".schedule-row",
      animation: 150,
      forceFallback: true,
      fallbackTolerance: 3,
      fallbackOnBody: true,
      onChoose: () => {
        removeStaleFallbackClones();
      },
      onStart: () => {
        setDragging(true);
      },
      onEnd: async () => {
        try {
          const orderedRowKeys = Array.from(el.children).map((child) => (child as HTMLElement).dataset.key!).filter(Boolean);
          await api.updateSettings({ detail_row_order: { ...detailOrderRef.current, [groupKeyRef.current]: orderedRowKeys } });
          reload();
        } finally {
          removeStaleFallbackClones();
          setDragging(false);
        }
      },
    });
    return () => sortable.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Doi thiet bi cua CA THE (moi dong Schedule trong group) - tach rieng
  // khoi sheet cau hinh gio (phan hoi 2026-09-23 "đưa chỗ chọn thiết bị cho
  // timer ra ngoài chỗ config timer"): bam thang vao ten thiet bi tren dau
  // trang thay vi phai mo sheet Sua lich moi doi duoc. Ap dung target_entities
  // moi cho TAT CA dong (ca cap Bat/Tat neu la Khung gio) de giu dong bo.
  async function changeDevices(ids: string[]) {
    await Promise.all(group.schedules.map((s) => api.updateSchedule(s.id, { ...s, target_entities: ids })));
    setDevicePickerOpen(false);
    reload();
  }

  return (
    <div className="page device-detail">
      <div className="device-detail__topbar">
        <button className="back-button" onClick={onBack} aria-label={tr("Quay lại trang Nhà", "Back to Home")}>
          <Icon path={mdiChevronLeft} size={24} />
          <span>{tr("Nhà", "Home")}</span>
        </button>
      </div>

      <div className="device-detail__header">
        <div className={`device-detail__icon ${group.isOn ? "device-detail__icon--on" : ""}`} style={{ "--accent": visual.color } as React.CSSProperties}>
          <Icon path={visual.icon} size={36} />
        </div>
        <div className="device-detail__name">{group.title}</div>
        {group.area && <div className="device-detail__area">{group.area}</div>}
        {group.singleEntity && (
          <div className={`device-detail__state ${group.singleEntity.state === "on" ? "device-detail__state--on" : ""}`}>
            {group.singleEntity.missing ? tr("Không tìm thấy trong HA", "Not found in HA") : group.singleEntity.state === "on" ? tr("● Đang bật", "● On") : group.singleEntity.state === "off" ? tr("○ Đang tắt", "○ Off") : tr("⚠ Không khả dụng", "⚠ Unavailable")}
          </div>
        )}
        {group.entityIds.length > 1 && <div className="device-detail__state">{entityNames(group.entityIds, entities)}</div>}
        {/* v0.5.62: nhac nhe entity khong con trong HA, chi mau chu mo - co the
            chi tam vang mat luc HA vua khoi dong. */}
        {group.missingIds.length > 0 && (
          <div className="device-detail__missing">
            {tr(`Không tìm thấy ${group.missingIds.join(", ")} trong HA. Nếu entity đã bị xoá hoặc đổi tên, bấm "Đổi thiết bị" để chọn lại.`, `${group.missingIds.join(", ")} not found in HA. If it was deleted or renamed, tap "Change devices" to pick it again.`)}
          </div>
        )}
        <button className="device-detail__change-devices" onClick={() => setDevicePickerOpen(true)}>
          <Icon path={mdiPencilOutline} size={14} /> {tr("Đổi thiết bị", "Change devices")}
        </button>
        {group.schedules.length > 0 && (
          <label className="device-detail__master">
            <span>
              {tr("Hẹn giờ", "Scheduling")}{" "}
              <span className={`device-detail__master-state ${cardEnabled(group) ? "device-detail__master-state--on" : ""}`}>
                {cardEnabled(group) ? tr("đang bật", "on") : tr("đang tắt", "off")}
              </span>
            </span>
            <span className="toggle toggle--small">
              <input type="checkbox" checked={cardEnabled(group)} onChange={toggleCard} disabled={toggling} aria-label={tr("Bật/tắt toàn bộ hẹn giờ của thiết bị này", "Turn all schedules for this device on/off")} />
              <span className="toggle__slider" />
            </span>
          </label>
        )}
      </div>

      <div className="device-detail__manual">
        <div className="device-detail__section-title">{tr("Điều khiển thủ công", "Manual control")}</div>
        <ForceOnControl entityIds={group.entityIds} activeTimers={activeTimers} reloadTimers={reloadTimers} />
      </div>

      {nextRun && nextSchedule ? (
        <div className="device-detail__hero">
          <div className="device-detail__hero-label">{tr("Lần tiếp theo", "Next run")}</div>
          <div className="device-detail__hero-time">
            {nextSchedule.trigger_type === "time"
              ? formatTimeDisplay(nextSchedule.time, settings.time_format)
              : triggerLabelWithClock(nextSchedule.trigger_type, nextSchedule.offset_minutes, nextSchedule.time, nextRun)}
          </div>
          <div className="device-detail__hero-action">{describeAction(nextSchedule.action)}</div>
          <Countdown nextRun={nextRun} />
          {skipUntil && <div className="device-detail__skip">⏭ {tr(`Nhóm đang bỏ qua tới hết ${skipLabel(skipUntil)}`, `Group is skipping until the end of ${skipLabel(skipUntil)}`)}</div>}
          {onWindow?.source === "schedule" && <OnTimeProgress startAt={onWindow.startAt} endAt={onWindow.endAt} />}
        </div>
      ) : (
        <div className="device-detail__hero device-detail__hero--empty">
          {group.schedules.some((s) => s.group_paused) ? tr("Nhóm của thiết bị này đang tắt (bật lại ở trang Nhà)", "This device's group is turned off (turn it back on from Home)") : cardEnabled(group) ? tr("Chưa có lịch nào đang bật", "No enabled schedules") : tr("Hẹn giờ của thiết bị này đang tắt (bật lại bằng công tắc Hẹn giờ ở trên)", "Scheduling for this device is paused (turn it back on with the Scheduling switch above)")}
        </div>
      )}

      <StateTimeline entityIds={group.entityIds} entities={entities} liveKey={liveKey} />

      <div className="device-detail__section-title device-detail__schedule-title">{tr("Lịch", "Schedules")}</div>
      <div className="schedule-row-list" ref={rowListRef}>
        {rows.map((item) => (
          <ScheduleRow
            key={item.key}
            item={item}
            entities={entities}
            timeFormat={settings.time_format}
            running={isRangeRowRunning(item, group.isOn, nowMs)}
            onOpen={() => {
              if (item.isRange) {
                setEditing(item.primary);
                setEditorOpen(true);
              } else {
                setDetailSchedule(item.primary);
              }
            }}
            onToggle={async () => {
              await api.toggleSchedule(item.primary.id);
              if (item.secondary) await api.toggleSchedule(item.secondary.id);
              reload();
            }}
          />
        ))}
        {rows.length === 0 && <div className="empty-hint">{tr("Chưa có lịch cho thiết bị này.", "No schedules for this device.")}</div>}
      </div>

      <button
        className="btn btn--ghost btn--block add-time-btn"
        onClick={() => {
          setEditing(null);
          setEditorOpen(true);
        }}
      >
        <Icon path={mdiPlus} size={16} /> {tr("Thêm giờ", "Add time")}
      </button>

      <ScheduleDetailSheet
        open={Boolean(detailSchedule)}
        schedule={detailSchedule}
        deviceName={group.title}
        timeFormat={settings.time_format}
        onClose={() => setDetailSchedule(null)}
        onSkip={async () => {
          if (!detailSchedule) return;
          await api.skipSchedule(detailSchedule.id);
          setDetailSchedule(null);
          reload();
        }}
        onRunNow={async () => {
          if (!detailSchedule) return;
          await api.runSchedule(detailSchedule.id);
          setDetailSchedule(null);
          reload();
        }}
        onEdit={() => {
          setEditing(detailSchedule);
          setDetailSchedule(null);
          setEditorOpen(true);
        }}
        onDelete={async () => {
          if (!detailSchedule) return;
          await deleteScheduleWithSibling(detailSchedule, group.schedules);
          setDetailSchedule(null);
          reload();
        }}
      />

      <ScheduleEditor
        open={editorOpen}
        schedule={editing}
        allSchedules={allSchedules}
        entities={entities}
        presetEntities={group.entityIds}
        lockEntities
        mode="schedule"
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        onDelete={async (id) => {
          const s = group.schedules.find((x) => x.id === id);
          if (s) await deleteScheduleWithSibling(s, group.schedules);
          setEditorOpen(false);
          setEditing(null);
          reload();
        }}
      />

      <EntityPicker
        open={devicePickerOpen}
        selected={group.entityIds}
        schedules={allSchedules}
        onClose={() => setDevicePickerOpen(false)}
        onConfirm={changeDevices}
      />
    </div>
  );
}
