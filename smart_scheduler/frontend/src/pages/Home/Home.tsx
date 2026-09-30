import { mdiPencilOutline, mdiPlus } from "@mdi/js";
import { useMemo, useState } from "react";
import { AutoOffList } from "../../components/AutoOffList/AutoOffList";
import { Clock } from "../../components/Clock/Clock";
import { HomeBanners } from "../../components/HomeBanners/HomeBanners";
import { DeviceGrid } from "../../components/DeviceGrid/DeviceGrid";
import { GroupedDeviceGrid } from "../../components/GroupedDeviceGrid/GroupedDeviceGrid";
import { Icon } from "../../components/Icon/Icon";
import { ScheduleEditor } from "../../components/ScheduleEditor/ScheduleEditor";
import { api } from "../../services/api";
import type { DeviceGroup, EntitySummary, Group, ManualTimer, PresenceStatus, Schedule, Settings } from "../../types";
import { cardEnabled } from "../../utils/groupSchedules";
import { saveScheduleDraft, type ScheduleDraft } from "../../utils/scheduleRange";
import { tr } from "../../i18n";

type Filter = "all" | "on" | "off" | "favorite";

export function Home({
  groups,
  schedules,
  entities,
  settings,
  categoryGroups,
  activeTimers,
  presence,
  reload,
  onOpenDevice,
  setDragging,
}: {
  groups: DeviceGroup[];
  schedules: Schedule[];
  entities: EntitySummary[];
  settings: Settings;
  categoryGroups: Group[];
  activeTimers: ManualTimer[];
  presence: PresenceStatus | null;
  reload: () => void;
  onOpenDevice: (group: DeviceGroup) => void;
  /** Bao App.tsx tam dung moi setState nen tu poll/WebSocket trong luc
   * SortableJS dang thao tac DOM - xem ghi chu draggingRef trong App.tsx. */
  setDragging: (dragging: boolean) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  /** Lich "Tu tat sau khi bat" dang sua (bam 1 dong trong AutoOffList). */
  const [editingRule, setEditingRule] = useState<Schedule | null>(null);
  const autoOffRules = useMemo(() => schedules.filter((s) => s.trigger_type === "auto_off"), [schedules]);
  /** Che do "Sap xep": an mac dinh de tranh bam nham keo-tha/doi nhom khi chi
   * luot xem binh thuong (phan hoi 2026-09-23) - bam nut but goc tren phai de
   * bat, chi luc do moi hien tay cam keo + nut doi nhom + cac nhom rong (de
   * co cho tha thiet bi vao). Bam but lan nua de tat, ve lai y het truoc. */
  const [editMode, setEditMode] = useState(false);
  /** The dang cho xac nhan xoa (nut x tren card, CHI hien luc editMode) -
   * phan hoi 2026-09-23 "hiển thị thêm nút x để xoá card timer tổng - có
   * popup xác nhận". Xoa CA CARD = xoa TOAN BO schedule cua group do (ca
   * cap Bat/Tat neu la Khung gio), khong the hoan tac nen luon can popup. */
  const [deleteConfirm, setDeleteConfirm] = useState<DeviceGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "on") return groups.filter((g) => cardEnabled(g));
    if (filter === "off") return groups.filter((g) => !cardEnabled(g));
    if (filter === "favorite") return groups.filter((g) => g.favorite);
    return groups;
  }, [groups, filter]);

  const activeCount = schedules.filter((s) => s.enabled).length;

  async function handleSave(draft: ScheduleDraft) {
    await saveScheduleDraft(draft, entities, editingRule, schedules);
    setEditorOpen(false);
    setEditingRule(null);
    reload();
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingRule(null);
  }

  async function deleteRule(id: string) {
    await api.deleteSchedule(id);
    closeEditor();
    reload();
  }

  async function toggleRule(rule: Schedule) {
    await api.groupToggleSchedules([rule.id], !(rule.enabled && rule.card_enabled !== false));
    reload();
  }

  async function toggleFavorite(group: DeviceGroup) {
    if (group.singleEntity) {
      await api.setAlias(group.singleEntity.entity_id, {
        alias: group.singleEntity.alias,
        area: group.singleEntity.area,
        icon: group.singleEntity.icon,
        favorite: !group.favorite,
      });
    } else {
      const sid = group.schedules[0]?.id;
      if (sid) await api.favoriteSchedule(sid);
    }
    reload();
  }

  async function toggleEnabled(group: DeviceGroup) {
    // Cong tac tong chi doi card_enabled (xem crud.set_group_enabled), khong
    // dung toi bat/tat rieng cua tung lich con - card sang/toi theo dung
    // nut nay du ben trong co lich nao dang bat hay khong (phan hoi 2026-09-24).
    const targetEnabled = !cardEnabled(group);
    await api.groupToggleSchedules(group.schedules.map((s) => s.id), targetEnabled);
    reload();
  }

  async function confirmDeleteGroup() {
    if (!deleteConfirm || deleting) return;
    setDeleting(true);
    try {
      await api.deleteCard(deleteConfirm.schedules.map((s) => s.id));
      setDeleteConfirm(null);
      reload();
    } finally {
      setDeleting(false);
    }
  }

  async function handleReorder(orderedKeys: string[]) {
    const byKey = new Map(filtered.map((g) => [g.key, g]));
    const orderedIds: string[] = [];
    for (const key of orderedKeys) {
      const g = byKey.get(key);
      if (g) orderedIds.push(...g.schedules.map((s) => s.id));
    }
    // Cac group khong nam trong view hien tai (bi filter an) giu nguyen vi tri tuong doi o cuoi.
    const remaining = schedules.filter((s) => !orderedIds.includes(s.id)).map((s) => s.id);
    await api.reorderSchedules([...orderedIds, ...remaining]);
    reload();
  }

  return (
    <div className="page home-page">
      <Clock timeFormat={settings.time_format} timezone={settings.timezone} />
      <HomeBanners settings={settings} entities={entities} presence={presence} reload={reload} />
      <div className="home-page__header-row">
        <div className="home-page__summary">
          {groups.length} {tr("thiết bị", "devices")} · {schedules.length} {tr("lịch", "schedules")}{activeCount ? ` · ${activeCount} ${tr("đang bật", "enabled")}` : ""}
        </div>
        <button
          className={`home-page__edit-btn ${editMode ? "home-page__edit-btn--active" : ""}`}
          onClick={() => setEditMode((v) => !v)}
          aria-label={editMode ? tr("Xong sắp xếp", "Finish arranging") : tr("Sắp xếp thiết bị", "Arrange devices")}
          title={editMode ? tr("Xong sắp xếp", "Finish arranging") : tr("Sắp xếp thiết bị", "Arrange devices")}
        >
          <Icon path={mdiPencilOutline} size={18} />
        </button>
      </div>

      <div className="chip-row">
        {(["all", "on", "off", "favorite"] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? "chip chip--active" : "chip"} onClick={() => setFilter(f)}>
            {{ all: tr("Tất cả", "All"), on: tr("Đang chạy", "Running"), off: tr("Đã tắt", "Off"), favorite: `⭐ ${tr("Yêu thích", "Favorites")}` }[f]}
          </button>
        ))}
      </div>

      <AutoOffList
        rules={autoOffRules}
        entities={entities}
        activeTimers={activeTimers}
        onEdit={(rule) => {
          setEditingRule(rule);
          setEditorOpen(true);
        }}
        onToggle={toggleRule}
      />

      {groups.length === 0 && autoOffRules.length > 0 ? null : categoryGroups.length > 0 ? (
        <GroupedDeviceGrid
          groups={filtered}
          entities={entities}
          categoryGroups={categoryGroups}
          compact={settings.display_mode === "compact"}
          timeFormat={settings.time_format}
          activeTimers={activeTimers}
          onOpen={onOpenDevice}
          onToggleFavorite={toggleFavorite}
          onToggleEnabled={toggleEnabled}
          onDeleteGroup={setDeleteConfirm}
          onCategoryChanged={reload}
          onReorder={handleReorder}
          setDragging={setDragging}
          editMode={editMode}
        />
      ) : (
        <DeviceGrid
          groups={filtered}
          compact={settings.display_mode === "compact"}
          timeFormat={settings.time_format}
          activeTimers={activeTimers}
          onOpen={onOpenDevice}
          onToggleFavorite={toggleFavorite}
          onToggleEnabled={toggleEnabled}
          onDeleteGroup={setDeleteConfirm}
          onReorder={handleReorder}
          setDragging={setDragging}
          editMode={editMode}
        />
      )}

      <button className="fab" onClick={() => setEditorOpen(true)} aria-label={tr("Thêm lịch", "Add schedule")}>
        <Icon path={mdiPlus} size={26} />
      </button>

      <ScheduleEditor
        open={editorOpen}
        schedule={editingRule}
        allSchedules={schedules}
        entities={entities}
        onClose={closeEditor}
        onSave={handleSave}
        onDelete={editingRule ? deleteRule : undefined}
      />

      {deleteConfirm && (
        <div className="sheet-backdrop" onClick={() => !deleting && setDeleteConfirm(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__title">{tr(`Xoá "${deleteConfirm.title}"?`, `Delete "${deleteConfirm.title}"?`)}</div>
            <div className="sheet__body">
              <p className="settings-hint">
                {tr(`Sẽ xoá toàn bộ ${deleteConfirm.schedules.length} lịch của thiết bị này và tắt thiết bị ngay. Không thể hoàn tác.`, `This will delete all ${deleteConfirm.schedules.length} schedules for this device and turn it off immediately. This cannot be undone.`)}
              </p>
            </div>
            <div className="sheet__footer">
              <div className="sheet__actions">
                <button className="btn btn--ghost" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                  {tr("Huỷ", "Cancel")}
                </button>
                <button className="btn btn--danger" onClick={confirmDeleteGroup} disabled={deleting}>
                  {tr("Xoá", "Delete")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
