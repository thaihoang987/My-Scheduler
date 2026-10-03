import { mdiChevronDown, mdiChevronUp, mdiMenuDown, mdiMenuUp } from "@mdi/js";
import type { ReactNode } from "react";
import { Icon } from "../Icon/Icon";
import { tr } from "../../i18n";

/** Tieu de 1 nhom tren trang Nha: bam de thu/phong; che do "Sap xep" hien
 * them nut len/xuong de doi vi tri nhom (null = nhom khong dich duoc). */
export function SectionHeader({
  title,
  count,
  collapsed,
  onToggle,
  onMoveUp,
  onMoveDown,
  actions,
}: {
  /** Nut ben phai tieu de (cong tac nhom + Bo qua, v0.5.85). */
  actions?: ReactNode;
  title: ReactNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
}) {
  return (
    <div className="device-section__title section-header">
      <button className="section-header__toggle" onClick={onToggle} aria-expanded={!collapsed}>
        <Icon path={collapsed ? mdiChevronDown : mdiChevronUp} size={18} />
        <span>{title}</span>
        <span className="device-section__count">{count}</span>
      </button>
      {actions}
      {(onMoveUp !== undefined || onMoveDown !== undefined) && (
        <span className="section-header__move">
          <button onClick={onMoveUp ?? undefined} disabled={!onMoveUp} aria-label={tr("Dời nhóm lên", "Move group up")} title={tr("Dời nhóm lên", "Move group up")}>
            <Icon path={mdiMenuUp} size={22} />
          </button>
          <button onClick={onMoveDown ?? undefined} disabled={!onMoveDown} aria-label={tr("Dời nhóm xuống", "Move group down")} title={tr("Dời nhóm xuống", "Move group down")}>
            <Icon path={mdiMenuDown} size={22} />
          </button>
        </span>
      )}
    </div>
  );
}
