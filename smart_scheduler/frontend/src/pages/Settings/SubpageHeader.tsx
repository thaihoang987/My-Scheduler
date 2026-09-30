import { mdiChevronLeft } from "@mdi/js";
import { Icon } from "../../components/Icon/Icon";
import { tr } from "../../i18n";

export function SubpageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="subpage-header">
      <button className="icon-btn icon-btn--plain" onClick={onBack} aria-label={tr("Quay lại", "Back")}>
        <Icon path={mdiChevronLeft} size={26} />
      </button>
      <span className="subpage-header__title">{title}</span>
      <span className="subpage-header__spacer" />
    </div>
  );
}
