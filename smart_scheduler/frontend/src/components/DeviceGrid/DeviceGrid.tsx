import { useEffect, useRef } from "react";
import Sortable from "sortablejs";
import type { DeviceGroup, DisplayMode, ManualTimer, Settings } from "../../types";
import { removeStaleFallbackClones } from "../../utils/sortableFallbackCleanup";
import { DeviceCard } from "../DeviceCard/DeviceCard";
import { tr } from "../../i18n";

/** Grid card thiet bi tren Home (muc 5/32 SPEC_UI.md) - keo tha ca CARD,
 * khong phai tung dong schedule nhu ban thiet ke cu.
 *
 * Dung SortableJS (thu vien addon PZEM Energy Log da vendor va dung on dinh
 * tren dien thoai that - xem tools/gen_deploy.py/sortable.min.js cua addon
 * do) thay vi dnd-kit tu ban dau - phan hoi 2026-09-23 "kéo thả quá khó
 * khăn ... trên điện thoại không thể nắm kéo được ... lấy github kéo thả
 * giống addon pzem". Khac voi dnd-kit (hook rieng tung item, ca card la
 * vung keo, de nham voi tap-de-mo), SortableJS thao tac truc tiep tren DOM
 * cua 1 container cha qua `Sortable.create()`, chi khoi dong keo tu 1 tay
 * cam rieng (`handle: '.drag-handle'`, xem DeviceCard.tsx) - phan con lai
 * cua card van bam mo binh thuong. */
export function DeviceGrid({
  groups,
  view,
  timeFormat,
  activeTimers,
  onOpen,
  onToggleFavorite,
  onToggleEnabled,
  onDeleteGroup,
  onReorder,
  setDragging,
  editMode,
}: {
  groups: DeviceGroup[];
  view: DisplayMode;
  timeFormat: Settings["time_format"];
  activeTimers: ManualTimer[];
  onOpen: (group: DeviceGroup) => void;
  onToggleFavorite: (group: DeviceGroup) => void;
  onToggleEnabled: (group: DeviceGroup) => void;
  onDeleteGroup: (group: DeviceGroup) => void;
  onReorder: (orderedKeys: string[]) => void | Promise<void>;
  setDragging: (dragging: boolean) => void;
  /** Chi hien tay cam keo (`.drag-handle`) luc dang o che do "Sap xep" (nut
   * but o Home.tsx) - xem ghi chu o Home.tsx. Khong render handle thi
   * SortableJS (handle: ".drag-handle") khong co gi de bat dau keo, khong
   * can tat rieng ca Sortable instance. */
  editMode: boolean;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const setDraggingRef = useRef(setDragging);
  setDraggingRef.current = setDragging;

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const sortable = Sortable.create(el, {
      handle: ".drag-handle",
      draggable: ".device-card",
      animation: 150,
      // forceFallback: phan hoi 2026-09-23 "kéo trên điện thoại giật giật" -
      // mac dinh SortableJS keo THANG the DOM that nam trong CSS Grid
      // (.device-grid), nen moi lan ngon tay di chuyen trinh duyet phai tinh
      // lai layout grid ngay lap tuc (grid reflow) -> giat. forceFallback bat
      // che do "keo bang 1 ban sao noi" (position:fixed, chi di theo toa do
      // ngon tay bang transform, khong dung cham vao grid that cho toi luc
      // tha) - muot hon nhieu tren dien thoai, cach chuan SortableJS khuyen
      // dung cho luoi CSS Grid/Flexbox nhieu phan tu.
      forceFallback: true,
      fallbackTolerance: 3,
      fallbackOnBody: true,
      // Bug thuc te 2026-09-23 (phan hoi "chưa có viền timer khi nắm kéo"):
      // don ban sao noi cu KHONG duoc dat o onStart - theo dung source
      // SortableJS (_dragStarted trong Sortable.js), `_appendGhost()` (tao
      // .sortable-fallback cho LAN KEO HIEN TAI) chay TRUOC roi moi
      // `_dispatchEvent('start')`, nen don o onStart se xoa nham luon chinh
      // ban sao vua tao cho lan keo dang cam - ban sao bien mat ngay lap
      // tuc, nhin nhu chua bao gio co vien. `onChoose` (dispatch trong
      // `_onTapStart`, tu pointerdown/mousedown/touchstart) chay SOM HON,
      // truoc bat ky lan tao ghost nao - don o day moi an toan, chi dong
      // ban sao SOT LAI tu 1 lan keo truoc do loi.
      onChoose: () => {
        removeStaleFallbackClones();
      },
      onStart: () => {
        setDraggingRef.current(true);
      },
      // Giu draggingRef=true xuyen suot ca luc persist (khong chi luc keo) -
      // xem ghi chu trong App.tsx: SortableJS da doi DOM that, phai chan moi
      // setState nen khac cho toi khi reload() (goi tu ben trong onReorder)
      // xac nhan xong, tranh crash removeChild do React re-render voi state
      // cu trong luc DOM da bi doi.
      onEnd: async () => {
        try {
          const orderedKeys = Array.from(el.children).map((child) => (child as HTMLElement).dataset.key!).filter(Boolean);
          await onReorderRef.current(orderedKeys);
        } finally {
          // Bug thuc te 2026-09-23 "kéo xong hiện 2 card": ban sao noi
          // (`.sortable-fallback`, forceFallback+fallbackOnBody append vao
          // document.body theo doi ngon tay luc keo) đôi khi khong duoc
          // SortableJS tu go bo sau khi tha (vd pointerup/touchend khong bat
          // dung trong app HA/webview) -> con lai 1 ban HTML "dong cung" (khong
          // cap nhat, khong phai React node that) nam dung vi tri vua tha, nhin
          // giong 1 the thu 2. Chu dong don sau moi lan keo cho chac, khong
          // phu thuoc SortableJS tu don kip.
          removeStaleFallbackClones();
          setDraggingRef.current(false);
        }
      },
    });
    return () => sortable.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (groups.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">{tr("Chưa có thiết bị nào được hẹn giờ", "No scheduled devices yet")}</div>
        <div className="empty-state__hint">{tr("Thêm thiết bị đầu tiên để bắt đầu tự động hóa.", "Add your first device to start automating.")}</div>
      </div>
    );
  }

  return (
    <div ref={gridRef} className={`device-grid device-grid--${view}`}>
      {groups.map((g) => (
        <DeviceCard
          key={g.key}
          group={g}
          view={view}
          timeFormat={timeFormat}
          activeTimers={activeTimers}
          onOpen={() => onOpen(g)}
          onToggleFavorite={() => onToggleFavorite(g)}
          onToggleEnabled={() => onToggleEnabled(g)}
          onDelete={() => onDeleteGroup(g)}
          sortable={editMode}
        />
      ))}
    </div>
  );
}
