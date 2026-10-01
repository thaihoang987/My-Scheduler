import { mdiAccountClockOutline, mdiBackupRestore, mdiChevronRight, mdiClockOutline, mdiDevices, mdiFolderMultipleOutline, mdiInformationOutline, mdiPaletteOutline, mdiPulse, mdiTextBoxOutline } from "@mdi/js";
import { Icon } from "../../components/Icon/Icon";
import { tr } from "../../i18n";

export type SettingsSubpage = "devices" | "groups" | "appearance" | "scheduler" | "presence" | "backup" | "status" | "log" | "about";

const SECTIONS: { group: [string, string]; items: { id: SettingsSubpage; icon: string; title: [string, string]; hint: [string, string] }[] }[] = [
  {
    group: ["Thiết bị", "Devices"],
    items: [
      { id: "devices", icon: mdiDevices, title: ["Thiết bị", "Devices"], hint: ["Tên riêng, khu vực, yêu thích", "Names, areas, favorites"] },
      { id: "groups", icon: mdiFolderMultipleOutline, title: ["Nhóm", "Groups"], hint: ["Phân loại thiết bị trên trang Nhà", "Organize devices on Home"] },
    ],
  },
  { group: ["Giao diện", "Appearance"], items: [{ id: "appearance", icon: mdiPaletteOutline, title: ["Giao diện", "Appearance"], hint: ["Ngôn ngữ, card, chế độ tối", "Language, cards, dark mode"] }] },
  {
    group: ["Lịch", "Schedules"],
    items: [
      { id: "scheduler", icon: mdiClockOutline, title: ["Scheduler", "Scheduler"], hint: ["Tạm dừng, múi giờ, lịch bị lỡ", "Pause, time zone, missed runs"] },
      { id: "presence", icon: mdiAccountClockOutline, title: ["Giả lập có người", "Presence simulation"], hint: ["Bật tắt ngẫu nhiên khi đi vắng", "Random activity while away"] },
    ],
  },
  {
    group: ["Dữ liệu", "Data"],
    items: [{ id: "backup", icon: mdiBackupRestore, title: ["Sao lưu", "Backup"], hint: ["Xuất / khôi phục dữ liệu", "Export / restore data"] }],
  },
  {
    group: ["Hệ thống", "System"],
    items: [
      { id: "status", icon: mdiPulse, title: ["Trạng thái", "Status"], hint: ["Scheduler, kết nối, số liệu", "Scheduler, connection, metrics"] },
      { id: "log", icon: mdiTextBoxOutline, title: ["Nhật ký", "Log"], hint: ["Lịch sử thực thi", "Execution history"] },
    ],
  },
  { group: ["Về ứng dụng", "About"], items: [{ id: "about", icon: mdiInformationOutline, title: ["Về ứng dụng", "About"], hint: ["My Scheduler", "My Scheduler"] }] },
];

export function SettingsHome({ onOpen }: { onOpen: (id: SettingsSubpage) => void }) {
  return (
    <div className="page settings-home">
      {SECTIONS.map((section) => (
        <div key={section.group[0]} className="settings-section">
          <div className="settings-section__title">{tr(...section.group)}</div>
          {section.items.map((item) => (
            <button key={item.id} className="settings-list-row" onClick={() => onOpen(item.id)}>
              <span className="settings-list-row__icon">
                <Icon path={item.icon} size={24} />
              </span>
              <span className="settings-list-row__text">
                <span className="settings-list-row__title">{tr(...item.title)}</span>
                <span className="settings-list-row__hint">{tr(...item.hint)}</span>
              </span>
              <Icon path={mdiChevronRight} size={22} className="settings-list-row__chevron" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
