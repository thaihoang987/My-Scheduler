import { mdiGithub } from "@mdi/js";
import { BottomSheet } from "../BottomSheet/BottomSheet";
import { DONATE_LINKS, GITHUB_URL } from "../../utils/aboutLinks";
import { tr } from "../../i18n";

/** Bang gioi thieu ngan mo tu nut (i) canh so phien ban (v0.5.66): mo ta
 * add-on, link GitHub, cac nut donate. Ban day du van o Cai dat -> Ve ung dung. */
export function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} title="My Scheduler" onClose={onClose}>
      <div className="about-sheet">
        <div className="about-page__version">{tr("Phiên bản", "Version")} {__APP_VERSION__}</div>
        <p className="about-page__desc">
          {tr(
            "Hẹn giờ thiết bị Home Assistant kiểu iOS: chọn thiết bị, chọn giờ là xong, không cần YAML hay tạo Helper tay. Lịch chạy ở backend, không phụ thuộc trình duyệt đang mở.",
            "iOS-style device timers for Home Assistant: pick a device and a time, no YAML or hand-made Helpers. Schedules run in the backend, not in an open browser.",
          )}
        </p>
        <a className="about-page__donate about-page__donate--github" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <svg className="about-page__donate-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={mdiGithub} /></svg>
          <span>{tr("Mã nguồn trên GitHub", "Source on GitHub")}</span>
        </a>
        <div className="about-sheet__label">{tr("Ủng hộ tác giả", "Support the author")}</div>
        <div className="about-page__donate-list">
          {DONATE_LINKS.map((link) => (
            <a key={link.modifier} className={`about-page__donate about-page__donate--${link.modifier}`} href={link.href} target="_blank" rel="noopener noreferrer">
              <svg className="about-page__donate-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={link.icon} /></svg>
              <span>{tr(link.vi, link.en)}</span>
            </a>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
