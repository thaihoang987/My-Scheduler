import { mdiGithub } from "@mdi/js";
import { SubpageHeader } from "../SubpageHeader";
import { tr } from "../../../i18n";
import { DONATE_LINKS, GITHUB_URL } from "../../../utils/aboutLinks";

export function AboutSettings({ onBack }: { onBack: () => void }) {
  return (
    <div className="page about-page">
      <SubpageHeader title={tr("Về ứng dụng", "About")} onBack={onBack} />
      <div className="about-page__body">
        <div className="about-page__name">My Scheduler</div>
        <div className="about-page__version">{tr("Phiên bản", "Version")} {__APP_VERSION__}</div>
        <div className="about-page__donate-list">
          {DONATE_LINKS.map((link) => (
            <a key={link.modifier} className={`about-page__donate about-page__donate--${link.modifier}`} href={link.href} target="_blank" rel="noopener noreferrer">
              <svg className="about-page__donate-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={link.icon} /></svg>
              <span>{tr(link.vi, link.en)}</span>
            </a>
          ))}
          <a className="about-page__donate about-page__donate--github" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <svg className="about-page__donate-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={mdiGithub} /></svg>
            <span>{tr("Mã nguồn trên GitHub", "Source on GitHub")}</span>
          </a>
        </div>
        <p className="about-page__desc">
          {tr("Hẹn giờ/lập lịch thiết bị Home Assistant kiểu iOS — không cần YAML, không cần tạo Helper tay. Scheduler chạy ở backend, không phụ thuộc trình duyệt đang mở.", "An iOS-style timer and scheduler for Home Assistant devices, with no YAML or manually created Helpers required. The scheduler runs in the backend and does not depend on an open browser.")}
        </p>
        <p className="about-page__desc">
          {tr("Giải quyết: hẹn giờ trong Home Assistant thường phải viết automation YAML hoặc tạo Helper tay cho từng thiết bị. Ở đây chỉ cần chọn thiết bị, chọn giờ là xong — có khung giờ bật/tắt, bình minh/hoàng hôn, điều kiện, nhóm, giả lập có người.", "Problem it solves: timers in Home Assistant usually mean writing YAML automations or creating Helpers by hand for every device. Here you just pick a device and a time — with on/off ranges, sunrise/sunset, conditions, groups and presence simulation.")}
        </p>
        <p className="about-page__desc about-page__note">
          {tr("Đây là dự án cá nhân. Yêu cầu riêng sẽ được xem xét và sửa nếu hợp lý và có thời gian.", "This is a personal project. Feature requests will be considered and implemented when reasonable and time allows.")}
        </p>
        <p className="about-page__desc">
          {tr("Dùng", "Uses")} <code>@ncdai/react-wheel-picker</code> {tr("và", "and")} <code>SortableJS</code> (MIT).
        </p>
      </div>
    </div>
  );
}
