import { mdiPencilOutline, mdiPlus, mdiWeatherNight, mdiWhiteBalanceSunny } from "@mdi/js";
import { useEffect, useMemo, useState } from "react";
import { AutoOffList } from "../../components/AutoOffList/AutoOffList";
import { Clock } from "../../components/Clock/Clock";
import { HomeBanners } from "../../components/HomeBanners/HomeBanners";
import { DeviceGrid } from "../../components/DeviceGrid/DeviceGrid";
import { AgendaView, TimelineView } from "../../components/DayViews/DayViews";
import { VIEWS, VIEW_META } from "../../utils/views";
import { GroupedDeviceGrid, UNGROUPED, type SectionControls } from "../../components/GroupedDeviceGrid/GroupedDeviceGrid";
import { useCollapsedSections } from "../../hooks/useCollapsedSections";
import { Icon } from "../../components/Icon/Icon";
import { ScheduleEditor } from "../../components/ScheduleEditor/ScheduleEditor";
import { api } from "../../services/api";
import type { DeviceGroup, DisplayMode, EntitySummary, Group, ManualTimer, PresenceStatus, Schedule, Settings } from "../../types";
import { cardEnabled } from "../../utils/groupSchedules";
import { saveScheduleDraft, type ScheduleDraft } from "../../utils/scheduleRange";
import { tr } from "../../i18n";
import { backdropProps } from "../../utils/backdrop";

type Filter = "all" | "on" | "off" | "favorite";


export function Home({
  groups,
  schedules,
  entities,
  settings,
  categoryGroups,
  activeTimers,
  presence,
  reloadPresence,
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
  reloadPresence: () => void;
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
  const [collapsed, toggleCollapsed] = useCollapsedSections();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeError, setThemeError] = useState(false);
  const isDark = settings.theme === "dark" || (settings.theme === "auto" && systemDark);
  const themeLabel = isDark ? tr("Chuyển sang giao diện sáng", "Switch to light theme") : tr("Chuyển sang giao diện tối", "Switch to dark theme");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  async function toggleTheme() {
    if (savingTheme) return;
    setSavingTheme(true);
    setThemeError(false);
    try {
      await api.updateSettings({ theme: isDark ? "light" : "dark" });
      await reload();
    } catch {
      setThemeError(true);
    } finally {
      setSavingTheme(false);
    }
  }

  // Thu tu cac khoi tren Nha: nhom phan loai (theo sort_order) + "Chua phan
  // nhom" (luon cuoi) + khoi "Tu tat" chen o vi tri auto_off_section_index
  // (luu Cai dat). Che do Sap xep: nut len/xuong doi nhom phan loai
  // (reorderGroups) hoac doi vi tri khoi Tu tat (updateSettings).
  const AUTO = "__auto_off__";
  const baseIds = categoryGroups.length > 0 ? [...categoryGroups.map((g) => g.id), UNGROUPED] : ["__all__"];
  const autoIndex = Math.max(0, Math.min(settings.auto_off_section_index ?? 0, baseIds.length));
  const order = [...baseIds.slice(0, autoIndex), AUTO, ...baseIds.slice(autoIndex)];
  const fixed = (id: string) => id === UNGROUPED || id === "__all__";

  async function moveSection(id: string, dir: -1 | 1) {
    const arr = [...order];
    const i = arr.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    const newAuto = arr.indexOf(AUTO);
    if (newAuto !== autoIndex) await api.updateSettings({ auto_off_section_index: newAuto });
    const cats = arr.filter((x) => x !== AUTO && !fixed(x));
    if (cats.join() !== categoryGroups.map((g) => g.id).join()) await api.reorderGroups(cats);
    reload();
  }

  function canMove(id: string, dir: -1 | 1): boolean {
    const j = order.indexOf(id) + dir;
    if (j < 0 || j >= order.length) return false;
    // Nhom thuong khong dich qua "Chua phan nhom"/luoi phang (luon co dinh) -
    // chi khoi Tu tat moi vuot qua duoc.
    return id === AUTO || !fixed(order[j]);
  }

  function controls(id: string): SectionControls {
    const movable = editMode && !fixed(id);
    return {
      collapsed: collapsed.has(id),
      onToggle: () => toggleCollapsed(id),
      ...(movable
        ? {
            onMoveUp: canMove(id, -1) ? () => moveSection(id, -1) : null,
            onMoveDown: canMove(id, 1) ? () => moveSection(id, 1) : null,
          }
        : {}),
    };
  }
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
  const view: DisplayMode = VIEWS.includes(settings.display_mode) ? settings.display_mode : "compact";
  const dayView = view === "agenda" || view === "timeline";
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  async function chooseView(next: DisplayMode) {
    setViewMenuOpen(false);
    if (next === view) return;
    setEditMode(false);
    await api.updateSettings({ display_mode: next });
    reload();
  }

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
      <HomeBanners settings={settings} entities={entities} presence={presence} reloadPresence={reloadPresence} reload={reload} />
      <div className="home-page__header-row">
        <div className="home-page__summary">
          {groups.length} {tr("thiết bị", "devices")} · {schedules.length} {tr("lịch", "schedules")}{activeCount ? ` · ${activeCount} ${tr("đang bật", "enabled")}` : ""}
        </div>
        <div className="home-page__actions">
          <button
            type="button"
            className="home-page__theme-btn"
            onClick={toggleTheme}
            disabled={savingTheme}
            aria-label={themeLabel}
            aria-busy={savingTheme}
            title={themeLabel}
          >
            <Icon path={isDark ? mdiWhiteBalanceSunny : mdiWeatherNight} size={18} />
          </button>
          <span className="view-menu">
            <button
              type="button"
              className={`home-page__edit-btn ${viewMenuOpen ? "home-page__edit-btn--active" : ""}`}
              onClick={() => setViewMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={viewMenuOpen}
              aria-label={tr(`Kiểu xem: ${VIEW_META[view].vi}`, `View: ${VIEW_META[view].en}`)}
              title={tr(`Kiểu xem: ${VIEW_META[view].vi}`, `View: ${VIEW_META[view].en}`)}
            >
              <Icon path={VIEW_META[view].icon} size={18} />
            </button>
            {viewMenuOpen && (
              <>
                <span className="view-menu__scrim" onClick={() => setViewMenuOpen(false)} />
                <span className="view-menu__popup" role="menu">
                  {VIEWS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="menuitemradio"
                      aria-checked={v === view}
                      className={`view-menu__item ${v === view ? "view-menu__item--active" : ""}`}
                      onClick={() => chooseView(v)}
                    >
                      <Icon path={VIEW_META[v].icon} size={18} />
                      {tr(VIEW_META[v].vi, VIEW_META[v].en)}
                    </button>
                  ))}
                </span>
              </>
            )}
          </span>
          {!dayView && (
          <button
            className={`home-page__edit-btn ${editMode ? "home-page__edit-btn--active" : ""}`}
            onClick={() => setEditMode((v) => !v)}
            aria-label={editMode ? tr("Xong sắp xếp", "Finish arranging") : tr("Sắp xếp thiết bị", "Arrange devices")}
            title={editMode ? tr("Xong sắp xếp", "Finish arranging") : tr("Sắp xếp thiết bị", "Arrange devices")}
          >
            <Icon path={mdiPencilOutline} size={18} />
          </button>
          )}
        </div>
      </div>
      {themeError && <div className="form-error" role="alert">{tr("Không đổi được giao diện. Vui lòng thử lại.", "Could not change theme. Please try again.")}</div>}

      <div className="chip-row">
        {(["all", "on", "off", "favorite"] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? "chip chip--active" : "chip"} onClick={() => setFilter(f)}>
            {{ all: tr("Tất cả", "All"), on: tr("Đang chạy", "Running"), off: tr("Đã tắt", "Off"), favorite: `⭐ ${tr("Yêu thích", "Favorites")}` }[f]}
          </button>
        ))}
      </div>

      {(() => {
        const autoNode = (
          <AutoOffList
            rules={autoOffRules}
            allSchedules={schedules}
            editMode={editMode}
            reload={reload}
            setDragging={setDragging}
            entities={entities}
            activeTimers={activeTimers}
            controls={controls(AUTO)}
            onEdit={(rule) => {
              setEditingRule(rule);
              setEditorOpen(true);
            }}
            onToggle={toggleRule}
          />
        );
        // 2 kieu xem theo ngay: thay luoi card, khoi Tu tat van o duoi.
        if (view === "agenda") {
          return <><AgendaView groups={filtered} timeFormat={settings.time_format} onOpen={onOpenDevice} />{autoNode}</>;
        }
        if (view === "timeline") {
          return (
            <>
              <TimelineView groups={filtered} entities={entities} categoryGroups={categoryGroups} timeFormat={settings.time_format} onOpen={onOpenDevice} />
              {autoNode}
            </>
          );
        }
        if (categoryGroups.length > 0) {
          return (
            <GroupedDeviceGrid
              groups={filtered}
              entities={entities}
              categoryGroups={categoryGroups}
              view={view}
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
              controls={controls}
              extra={{ index: autoIndex, node: autoNode }}
            />
          );
        }
        const grid =
          groups.length === 0 && autoOffRules.length > 0 ? null : (
            <DeviceGrid
              groups={filtered}
              view={view}
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
          );
        return autoIndex === 0 ? <>{autoNode}{grid}</> : <>{grid}{autoNode}</>;
      })()}

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
        <div className="sheet-backdrop" {...backdropProps(() => !deleting && setDeleteConfirm(null))}>
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
