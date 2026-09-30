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
  const rows = groupIntoRows(group.schedules);
  const onWindow = activeOnWindow(group, activeTimers);

  async function handleSave(draft: ScheduleDraft, id?: string) {
    await saveScheduleDraft(draft, entities, editing, allSchedules, cardEnabled(group));
    setEditorOpen(false);
    setEditing(null);
    reload();
  }

  // Keo-tha doi thu tu Lich (phan hoi 2026-09-23 "cho thêm drag drop đổi vị
  // trí Lịch trong config") - cung 1 quy uoc SortableJS voi DeviceGrid.tsx
  // (forceFallback muot tren mobile, tay cam rieng .drag-handle, don ban sao
  // noi o onChoose khong phai onStart - xem ghi chu chi tiet trong
  // DeviceGrid.tsx). `sort_order` la 1 truc GLOBAL duy nhat cho MOI schedule
  // (khong rieng theo thiet bi), nen phai giu nguyen vi tri tuong doi cua
  // cac schedule KHONG thuoc thiet bi nay (`remaining`) o cuoi, giong het
  // cach Home.tsx handleReorder() da lam.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const allSchedulesRef = useRef(allSchedules);
  allSchedulesRef.current = allSchedules;

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
          const byKey = new Map(rowsRef.current.map((r) => [r.key, r]));
          const orderedIds: string[] = [];
          for (const key of orderedRowKeys) {
            const row = byKey.get(key);
            if (!row) continue;
            orderedIds.push(row.primary.id);
            if (row.secondary) orderedIds.push(row.secondary.id);
          }
          const remaining = allSchedulesRef.current.filter((s) => !orderedIds.includes(s.id)).map((s) => s.id);
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
            {group.singleEntity.state === "on" ? tr("● Đang bật", "● On") : group.singleEntity.state === "off" ? tr("○ Đang tắt", "○ Off") : tr("⚠ Không khả dụng", "⚠ Unavailable")}
          </div>
        )}
        {group.entityIds.length > 1 && <div className="device-detail__state">{entityNames(group.entityIds, entities)}</div>}
        <button className="device-detail__change-devices" onClick={() => setDevicePickerOpen(true)}>
          <Icon path={mdiPencilOutline} size={14} /> {tr("Đổi thiết bị", "Change devices")}
        </button>
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
          {onWindow?.source === "schedule" && <OnTimeProgress startAt={onWindow.startAt} endAt={onWindow.endAt} />}
        </div>
      ) : (
        <div className="device-detail__hero device-detail__hero--empty">
          {cardEnabled(group) ? tr("Chưa có lịch nào đang bật", "No enabled schedules") : tr("Hẹn giờ của thiết bị này đang tắt (bật lại bằng công tắc trên card ở trang Nhà)", "Scheduling for this device is paused (enable it using the switch on its Home card)")}
        </div>
      )}

      <div className="device-detail__section-title device-detail__schedule-title">{tr("Lịch", "Schedules")}</div>
      <div className="schedule-row-list" ref={rowListRef}>
        {rows.map((item) => (
          <ScheduleRow
            key={item.key}
            item={item}
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
