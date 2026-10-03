import { api } from "../../../services/api";
import type { Settings as SettingsType } from "../../../types";
import { SubpageHeader } from "../SubpageHeader";
import { tr } from "../../../i18n";
import { VIEWS, VIEW_META } from "../../../utils/views";

const TOGGLE_FIELDS: [keyof SettingsType, string, string][] = [
  ["show_countdown", "Hiện countdown", "Show countdown"],
  ["show_entity_name", "Hiện tên thiết bị", "Show device name"],
  ["show_action", "Hiện hành động", "Show action"],
  ["show_days", "Hiện ngày chạy", "Show run days"],
  ["show_entity_id", "Hiện entity_id (nâng cao)", "Show entity_id (advanced)"],
  ["show_area", "Hiện khu vực", "Show area"],
];

export function AppearanceSettings({ settings, reload, onBack }: { settings: SettingsType; reload: () => void; onBack: () => void }) {
  async function update(patch: Partial<SettingsType>) {
    await api.updateSettings(patch);
    reload();
  }

  return (
    <div className="page">
      <SubpageHeader title={tr("Giao diện", "Appearance")} onBack={onBack} />

      <div className="settings-section">
        <div className="settings-section__title">{tr("Ngôn ngữ", "Language")}</div>
        <div className="chip-row">
          <button className={settings.language === "vi" ? "chip chip--active" : "chip"} onClick={() => update({ language: "vi" })}>Tiếng Việt</button>
          <button className={settings.language === "en" ? "chip chip--active" : "chip"} onClick={() => update({ language: "en" })}>English</button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Chủ đề", "Theme")}</div>
        <div className="chip-row">
          {(["light", "dark", "auto"] as const).map((t) => (
            <button key={t} className={settings.theme === t ? "chip chip--active" : "chip"} onClick={() => update({ theme: t })}>
              {{ light: tr("Sáng", "Light"), dark: tr("Tối", "Dark"), auto: tr("Theo hệ thống", "System") }[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Định dạng giờ", "Time format")}</div>
        <div className="chip-row">
          {(["24h", "12h"] as const).map((t) => (
            <button key={t} className={settings.time_format === t ? "chip chip--active" : "chip"} onClick={() => update({ time_format: t })}>
              {t === "24h" ? tr("24 giờ (18:30:45)", "24 hour (18:30:45)") : tr("12 giờ (6:30:45 CH)", "12 hour (6:30:45 PM)")}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Kiểu xem trang Nhà", "Home view")}</div>
        <div className="chip-row">
          {VIEWS.map((m) => (
            <button key={m} className={(VIEWS.includes(settings.display_mode) ? settings.display_mode : "compact") === m ? "chip chip--active" : "chip"} onClick={() => update({ display_mode: m })}>
              {tr(VIEW_META[m].vi, VIEW_META[m].en)}
            </button>
          ))}
        </div>
        <p className="settings-hint">{tr("Mỗi tài khoản Home Assistant có kiểu xem riêng.", "Each Home Assistant user has their own view.")}</p>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Thông tin hiển thị", "Displayed information")}</div>
        {TOGGLE_FIELDS.map(([key, vi, en]) => (
          <label key={key} className="settings-row">
            <span>{tr(vi, en)}</span>
            <input type="checkbox" checked={Boolean(settings[key])} onChange={(e) => update({ [key]: e.target.checked })} />
          </label>
        ))}
      </div>
    </div>
  );
}
