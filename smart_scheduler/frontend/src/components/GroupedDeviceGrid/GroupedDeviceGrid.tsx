import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Sortable from "sortablejs";
import { api } from "../../services/api";
import type { DeviceGroup, EntitySummary, Group, ManualTimer, Settings } from "../../types";
import { removeStaleFallbackClones } from "../../utils/sortableFallbackCleanup";
import { DeviceCard } from "../DeviceCard/DeviceCard";
import { SectionHeader } from "../SectionHeader/SectionHeader";
import { tr } from "../../i18n";
import { backdropProps } from "../../utils/backdrop";

export const UNGROUPED = "__ungrouped__";
const SORTABLE_GROUP = "smart-scheduler-devices";

/** Thu/phong + doi vi tri 1 nhom (Home.tsx tinh, xem SectionHeader). */
export interface SectionControls {
  collapsed: boolean;
  onToggle: () => void;
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
}

interface Section {
  id: string;
  name: string;
  groups: DeviceGroup[];
}

function categoryOf(group: DeviceGroup, entities: EntitySummary[]): string {
  const e = entities.find((x) => group.entityIds.includes(x.entity_id));
  return e?.category_id || UNGROUPED;
}

/** The o Home khi da co it nhat 1 "Nhom" nguoi dung tao (muc "phan nhom +
 * keo tha" 2026-09-23) - the duoc keo qua lai TRONG 1 nhom (doi thu tu) VA
 * GIUA cac nhom khac nhau (doi nhom, gan lai category_id). Neu chua tao Nhom
 * nao, Home dung DeviceGrid cu (khong section).
 *
 * Dung SortableJS (giong DeviceGrid.tsx - xem ghi chu o do ve ly do doi tu
 * dnd-kit) voi 1 `group` CHUNG TEN giua moi section: SortableJS tu cho phep
 * keo giua cac container cung ten nay, KE CA container dang rong (khong can
 * hack "vung droppable rieng khi rong" nhu dnd-kit truoc day). Sau moi lan
 * keo (cung nhom hay khac nhom), doc lai thu tu THAT tren DOM cua TAT CA
 * section (SortableJS da tu di chuyen node that roi) de goi `onReorder`
 * (`sort_order` cua schedules van 1 truc GLOBAL duy nhat, khong doi schema);
 * neu doi nhom thi gan lai `category_id` cho cac entity cua the do truoc. */
export function GroupedDeviceGrid({
  groups,
  entities,
  categoryGroups,
  compact,
  timeFormat,
  activeTimers,
  onOpen,
  onToggleFavorite,
  onToggleEnabled,
  onDeleteGroup,
  onCategoryChanged,
  onReorder,
  setDragging,
  editMode,
  controls,
  extra,
}: {
  /** Thu/phong + nut len/xuong cho tung nhom (theo section id). */
  controls: (sectionId: string) => SectionControls;
  /** Khoi chen them giua cac nhom (danh sach "Tu tat") tai vi tri `index`. */
  extra?: { index: number; node: ReactNode };
  groups: DeviceGroup[];
  entities: EntitySummary[];
  categoryGroups: Group[];
  compact: boolean;
  timeFormat: Settings["time_format"];
  activeTimers: ManualTimer[];
  onOpen: (group: DeviceGroup) => void;
  onToggleFavorite: (group: DeviceGroup) => void;
  onToggleEnabled: (group: DeviceGroup) => void;
  onDeleteGroup: (group: DeviceGroup) => void;
  onCategoryChanged: () => void;
  onReorder: (orderedKeys: string[]) => void | Promise<void>;
  /** Bao App.tsx tam dung setState nen ngoai trong luc SortableJS dang thao
   * tac DOM - xem ghi chu draggingRef trong App.tsx (bug thuc te: crash
   * removeChild khi 1 re-render xen vao giua luc DOM da bi doi cha). */
  setDragging: (dragging: boolean) => void;
  /** Che do "Sap xep" (nut but o Home.tsx) - xem ghi chu o Home.tsx. Luc tat:
   * an tay cam keo + nut doi nhom tren tung the, VA an luon cac nhom dang
   * rong (khong co gi de tuong tac, chi gay roi mat khi xem binh thuong). */
  editMode: boolean;
}) {
  const [pickerFor, setPickerFor] = useState<DeviceGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo<Section[]>(() => {
    const byCategory = new Map<string, DeviceGroup[]>();
    for (const g of groups) {
      const cat = categoryOf(g, entities);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(g);
    }
    const ordered = categoryGroups.map((cg): Section => ({ id: cg.id, name: cg.name, groups: byCategory.get(cg.id) ?? [] }));
    ordered.push({ id: UNGROUPED, name: tr("Chưa phân nhóm", "Ungrouped"), groups: byCategory.get(UNGROUPED) ?? [] });
    return ordered;
  }, [groups, entities, categoryGroups]);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const handleDragEnd = useCallback(
    async (fromSectionId: string, toSectionId: string, key: string) => {
      if (fromSectionId !== toSectionId) {
        const movedGroup = groupsRef.current.find((g) => g.key === key);
        if (movedGroup) {
          const newCategoryId = toSectionId === UNGROUPED ? "" : toSectionId;
          await Promise.all(movedGroup.entityIds.map((entityId) => api.setAlias(entityId, { category_id: newCategoryId })));
        }
      }
      const lists = containerRef.current ? Array.from(containerRef.current.querySelectorAll<HTMLElement>("[data-section-list]")) : [];
      const orderedKeys = lists.flatMap((list) => Array.from(list.children).map((child) => (child as HTMLElement).dataset.key!).filter(Boolean));
      await onReorder(orderedKeys);
      if (fromSectionId !== toSectionId) onCategoryChanged();
    },
    [onReorder, onCategoryChanged],
  );

  async function changeCategory(categoryId: string | null) {
    if (!pickerFor || saving) return;
    setSaving(true);
    try {
      await Promise.all(pickerFor.entityIds.map((entityId) => api.setAlias(entityId, { category_id: categoryId ?? "" })));
      setPickerFor(null);
      onCategoryChanged();
    } finally {
      setSaving(false);
    }
  }

  // Nhom rong (chua co thiet bi nao) chi hien luc dang "Sap xep" - can thay
  // de co cho tha thiet bi vao; luc xem binh thuong an di cho gon, khong con
  // gi de tuong tac voi 1 nhom rong ca.
  const visibleSections = editMode ? sections : sections.filter((s) => s.groups.length > 0);
  // Khoi "Tu tat" dat ngay truoc nhom HIEN dau tien co vi tri >= extra.index
  // (nhom rong bi an luc xem thuong khong lam mat khoi nay).
  const extraPlacedBefore = (section: Section) =>
    visibleSections.some((sec) => sec !== section && sections.indexOf(sec) >= (extra?.index ?? 0) && visibleSections.indexOf(sec) < visibleSections.indexOf(section));

  return (
    <div ref={containerRef}>
      {visibleSections.map((section) => (
        <Fragment key={section.id}>
        {extra && sections.indexOf(section) >= extra.index && !extraPlacedBefore(section) && extra.node}
        <SectionBlock
          controls={controls(section.id)}
          section={section}
          compact={compact}
          timeFormat={timeFormat}
          activeTimers={activeTimers}
          onOpen={onOpen}
          onToggleFavorite={onToggleFavorite}
          onToggleEnabled={onToggleEnabled}
          onDeleteGroup={onDeleteGroup}
          onChangeCategory={setPickerFor}
          onDragEnd={handleDragEnd}
          setDragging={setDragging}
          editMode={editMode}
        />
        </Fragment>
      ))}
      {extra && !visibleSections.some((sec) => sections.indexOf(sec) >= extra.index) && extra.node}
      {pickerFor && (
        <div className="sheet-backdrop" {...backdropProps(() => !saving && setPickerFor(null))}>
          <div className="sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sheet__title">{tr(`Chọn nhóm cho "${pickerFor.title}"`, `Select a group for "${pickerFor.title}"`)}</div>
            <div className="sheet__body">
              <div className="entity-list">
                <button
                  className={`entity-row entity-row--editable ${categoryOf(pickerFor, entities) === UNGROUPED ? "chip--active" : ""}`}
                  onClick={() => changeCategory(null)}
                  disabled={saving}
                >
                  {tr("Chưa phân nhóm", "Ungrouped")}
                </button>
                {categoryGroups.map((category) => (
                  <button
                    key={category.id}
                    className={`entity-row entity-row--editable ${categoryOf(pickerFor, entities) === category.id ? "chip--active" : ""}`}
                    onClick={() => changeCategory(category.id)}
                    disabled={saving}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="sheet__footer">
              <div className="sheet__actions">
                <button className="btn btn--ghost" onClick={() => setPickerFor(null)} disabled={saving}>
                  {tr("Đóng", "Close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionBlock({
  section,
  compact,
  timeFormat,
  activeTimers,
  onOpen,
  onToggleFavorite,
  onToggleEnabled,
  onDeleteGroup,
  onChangeCategory,
  onDragEnd,
  setDragging,
  editMode,
  controls,
}: {
  controls: SectionControls;
  section: Section;
  compact: boolean;
  timeFormat: Settings["time_format"];
  activeTimers: ManualTimer[];
  onOpen: (group: DeviceGroup) => void;
  onToggleFavorite: (group: DeviceGroup) => void;
  onToggleEnabled: (group: DeviceGroup) => void;
  onDeleteGroup: (group: DeviceGroup) => void;
  onChangeCategory: (group: DeviceGroup) => void;
  onDragEnd: (fromSectionId: string, toSectionId: string, key: string) => void | Promise<void>;
  setDragging: (dragging: boolean) => void;
  editMode: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const setDraggingRef = useRef(setDragging);
  setDraggingRef.current = setDragging;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const sortable = Sortable.create(el, {
      group: SORTABLE_GROUP,
      handle: ".drag-handle",
      draggable: ".device-card",
      animation: 150,
      // forceFallback: xem ghi chu chi tiet trong DeviceGrid.tsx - phan hoi
      // 2026-09-23 "kéo trên điện thoại giật giật" do keo truc tiep the DOM
      // that trong CSS Grid gay reflow lien tuc; dung ban sao noi muot hon.
      forceFallback: true,
      fallbackTolerance: 3,
      fallbackOnBody: true,
      // Bug thuc te 2026-09-23 ("chưa có viền timer khi nắm kéo") - xem ghi
      // chu chi tiet trong DeviceGrid.tsx: don ban sao noi phai dat o
      // `onChoose` (chay truoc moi lan tao ghost), KHONG duoc dat o onStart
      // (chay SAU khi `_appendGhost()` da tao xong ban sao cho lan keo hien
      // tai - don o do se xoa nham chinh ban sao vua tao).
      onChoose: () => {
        removeStaleFallbackClones();
      },
      onStart: () => {
        setDraggingRef.current(true);
      },
      // Giu draggingRef=true xuyen suot ca luc persist (API setAlias + reorder
      // + reload), khong chi luc keo - xem ghi chu draggingRef trong App.tsx.
      onEnd: async (evt) => {
        const { from, to, oldIndex, item } = evt;
        const key = item.dataset.key;
        const fromId = from.dataset.sectionId;
        const toId = to.dataset.sectionId;
        // Bug thuc te CONFIRMED 2026-09-23: khi keo QUA 2 section khac nhau,
        // SortableJS tu di chuyen node DOM THAT sang container ben kia. Day la
        // 2 cay <div> RIENG do React render (2 phan tu khac nhau trong
        // sections.map(...)), khong phai 1 list duy nhat - nen khi React sau
        // do re-render (kieu ca do reload() hop le, khong chi do poll nen)
        // reconciler cua no se lac vi DOM that da bi doi cha ma no khong hay
        // biet, dan toi goi removeChild() tren node khong con la con cua cha
        // no tuong -> crash "NotFoundError: Failed to execute 'removeChild'"
        // (trang trang, mat het UI). Cach sua (mau chuan cho SortableJS +
        // React voi nhieu container): TRA DOM VE VI TRI CU NGAY LAP TUC, truoc
        // khi lam gi khac, de React tu ve lai bang re-render khai bao binh
        // thuong (chi doi 1 cay No no tu quan ly), khong dua vao DOM SortableJS
        // da thao tac tay.
        if (from !== to) {
          from.insertBefore(item, (oldIndex !== undefined ? from.children[oldIndex] : undefined) ?? null);
        }
        try {
          if (key && fromId && toId) await onDragEndRef.current(fromId, toId, key);
        } finally {
          // Bug thuc te 2026-09-23 "kéo xong hiện 2 card": xem ghi chu chi
          // tiet trong DeviceGrid.tsx - ban sao noi cua SortableJS
          // (`.sortable-fallback`, forceFallback+fallbackOnBody) doi khi
          // khong duoc tu don sau khi tha, con lai 1 ban HTML dong cung nhin
          // giong the thu 2. Chu dong don sau moi lan keo cho chac.
          removeStaleFallbackClones();
          setDraggingRef.current(false);
        }
      },
    });
    return () => sortable.destroy();
  }, []);

  return (
    <div className="device-section">
      <SectionHeader title={section.name} count={section.groups.length} {...controls} />
      <div ref={listRef} data-section-list data-section-id={section.id} className={`device-grid ${compact ? "device-grid--compact" : ""} ${controls.collapsed ? "is-collapsed" : ""}`}>
        {section.groups.map((g) => (
          <DeviceCard
            key={g.key}
            group={g}
            compact={compact}
            timeFormat={timeFormat}
            activeTimers={activeTimers}
            onOpen={() => onOpen(g)}
            onToggleFavorite={() => onToggleFavorite(g)}
            onToggleEnabled={() => onToggleEnabled(g)}
            onDelete={() => onDeleteGroup(g)}
            sortable={editMode}
            categoryLabel={section.name}
            onChangeCategory={editMode ? () => onChangeCategory(g) : undefined}
          />
        ))}
        {editMode && section.groups.length === 0 && <div className="device-section__empty">{tr("Kéo thiết bị vào đây", "Drag devices here")}</div>}
      </div>
    </div>
  );
}
