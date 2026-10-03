import { api } from "../../../services/api";
import type { Settings as SettingsType } from "../../../types";
import { SubpageHeader } from "../SubpageHeader";
import { tr } from "../../../i18n";
import { fmtDateTime } from "../../../utils/appTime";

export function SchedulerSettings({ settings, reload, onBack }: { settings: SettingsType; reload: () => void; onBack: () => void }) {
  async function update(patch: Partial<SettingsType>) {
    await api.updateSettings(patch);
    reload();
  }


  // Tam dung moi lich (che do di vang, v0.5.32) - backend bo qua moi khe
  // gio truoc moc nay va KHONG chay bu khi het tam dung.
  const pauseEnd = settings.pause_until ? new Date(settings.pause_until) : null;
  const paused = pauseEnd !== null && pauseEnd.getTime() > Date.now();
  function pauseDays(days: number) {
    const end = new Date(Date.now() + days * 86400000);
    return update({ pause_until: end.toISOString() });
  }
  function pauseUntilDate(value: string) {
    // Het tam dung vao 00:00 cua ngay da chon (gio dia phuong).
    if (value) update({ pause_until: new Date(`${value}T00:00:00`).toISOString() });
  }

  return (
    <div className="page">
      <SubpageHeader title="Scheduler" onBack={onBack} />

      <div className="settings-section">
        <div className="settings-section__title">{tr("Tạm dừng tất cả lịch (đi vắng / ngày lễ)", "Pause all schedules (away / holiday)")}</div>
        {paused ? (
          <div className="home-banner home-banner--pause">
            <span className="home-banner__text">
              ⏸ {tr("Đang tạm dừng đến", "Paused until")} {fmtDateTime(pauseEnd!, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })}
            </span>
            <button className="home-banner__btn" onClick={() => update({ pause_until: "" })}>
              {tr("Tiếp tục ngay", "Resume now")}
            </button>
          </div>
        ) : null}
        <div className="chip-row">
          {[1, 3, 7, 14].map((d) => (
            <button key={d} className="chip" onClick={() => pauseDays(d)}>
              {d} {tr("ngày", "days")}
            </button>
          ))}
        </div>
        <label className="presence-field">
          <span className="presence-field__label">{tr("Hoặc tạm dừng đến ngày (lịch chạy lại từ 00:00 ngày đó)", "Or pause until a date (schedules resume at 00:00 on that date)")}</span>
          <input type="date" className="input" onChange={(e) => pauseUntilDate(e.target.value)} />
        </label>
        <p className="settings-hint">
          {tr("Mọi lịch không chạy trong thời gian tạm dừng và không chạy bù khi hết. Thiết bị đang bật theo khung giờ sẽ được tắt ngay khi bấm tạm dừng. Tự chạy lại bình thường sau mốc này. Giả lập có người vẫn chạy trong lúc tạm dừng.", "Schedules do not run while paused and are not caught up afterward. Devices currently on in a time range are turned off immediately. Normal scheduling resumes after this point. Presence simulation continues while schedules are paused.")}
        </p>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Múi giờ", "Time zone")}</div>
        {/* v0.5.54: khong con chon rieng - moi lich/hien thi theo DUNG mui gio HA
            (Settings -> System -> General), tranh 2 noi chon mui gio gay lech. */}
        <div className="settings-row">
          <span>{settings.timezone}</span>
          <span className="settings-list-row__hint">{tr("theo Home Assistant", "from Home Assistant")}</span>
        </div>
        <p className="settings-hint">
          {tr("Đổi múi giờ trong Home Assistant: Cài đặt → Hệ thống → Chung.", "Change it in Home Assistant: Settings → System → General.")}
        </p>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Lịch bị lỡ (khi Add-on tắt lâu)", "Missed schedules (after a long add-on outage)")}</div>
        <div className="chip-row">
          {(["skip", "run_once"] as const).map((p) => (
            <button
              key={p}
              className={settings.missed_execution_policy === p ? "chip chip--active" : "chip"}
              onClick={() => update({ missed_execution_policy: p })}
            >
              {p === "skip" ? tr("Bỏ qua lịch đã lỡ", "Skip missed schedules") : tr("Chạy bù 1 lần", "Run once to catch up")}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Sắp xếp trên trang Nhà", "Home sorting")}</div>
        <div className="chip-row">
          {(["auto", "manual"] as const).map((s) => (
            <button key={s} className={settings.sort_mode === s ? "chip chip--active" : "chip"} onClick={() => update({ sort_mode: s })}>
              {s === "auto" ? tr("Tự động", "Automatic") : tr("Kéo thả thủ công", "Manual drag and drop")}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Tự kiểm tra trạng thái thiết bị", "Automatic device-state verification")}</div>
        <label className="settings-row">
          <span>{tr("Kiểm tra lại sau 30 giây mỗi lần lịch Bật/Tắt chạy", "Verify 30 seconds after each on/off schedule runs")}</span>
          <input type="checkbox" checked={settings.verify_state} onChange={(e) => update({ verify_state: e.target.checked })} />
        </label>
        <p className="settings-hint">
          {tr(
            "Tùy chọn chung cho mọi lịch, mặc định tắt. Relay xung (bấm 1 lần là đổi trạng thái) thì nên để tắt, vì gửi lại có thể đảo thêm 1 lần - add-on không tự nhận biết loại relay. Không gửi lại khi lịch đã sửa/tắt, hết khung giờ, đang tạm dừng, thiết bị đã nhận lệnh mới hơn hoặc kết nối Home Assistant chưa ổn định. Scene và script không bao giờ được kiểm tra lại.",
            "A single option for all schedules, off by default. Keep it off for pulse relays (one press toggles), since a retry could toggle again - the add-on cannot detect relay types. No retry when the schedule was edited/disabled, the range ended, schedules are paused, the device received a newer command or the Home Assistant connection is not stable. Scenes and scripts are never verified.",
          )}
        </p>
        <p className="settings-hint">
          {tr("30 giây sau khi lịch bật/tắt, đọc trạng thái THẬT từ Home Assistant. Thiết bị nào chưa đúng (mất lệnh Zigbee/WiFi, thiết bị chập chờn) sẽ được gửi lại lệnh 1 lần; 30 giây sau vẫn sai thì ghi cảnh báo vào Nhật ký.", "Thirty seconds after an on/off schedule, read the actual state from Home Assistant. A device with the wrong state receives one retry; if it is still wrong 30 seconds later, a warning is written to the log.")}
        </p>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("An toàn khi khởi động", "Startup safety")}</div>
        <label className="settings-row">
          <span>{tr("Tắt thiết bị có lịch đang bật khi Add-on khởi động", "Turn off scheduled devices when the add-on starts")}</span>
          <input
            type="checkbox"
            checked={settings.reset_devices_on_startup}
            onChange={(e) => update({ reset_devices_on_startup: e.target.checked })}
          />
        </label>
        <p className="settings-hint">
          {tr("Đề phòng Add-on restart đúng lúc giữa 1 khung giờ đang bật mà lịch Tắt tương ứng bị lỡ. Khi bật, mỗi lần Add-on khởi động lại, thiết bị có ít nhất một lịch và đang thực sự bật sẽ được gửi lệnh tắt ngay. Hẹn Bật cưỡng chế còn hạn vẫn được khôi phục bình thường.", "Protects against an add-on restart during an active time range that could miss its matching off event. When enabled, each startup immediately turns off devices that have schedules and are actually on. Active forced-on timers are then restored normally.")}
        </p>
      </div>
    </div>
  );
}
