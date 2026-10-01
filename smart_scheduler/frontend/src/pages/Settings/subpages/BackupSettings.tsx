import { mdiDownload, mdiUpload } from "@mdi/js";
import { useRef, useState } from "react";
import { Icon } from "../../../components/Icon/Icon";
import { api } from "../../../services/api";
import { SubpageHeader } from "../SubpageHeader";
import { fmtDateTime, todayInZone } from "../../../utils/appTime";
import { tr } from "../../../i18n";

export function BackupSettings({ reload, onBack }: { reload: () => void; onBack: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function exportData() {
    const data = await api.exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-scheduler-backup-${todayInZone()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setMessage(tr("⚠ File không phải JSON hợp lệ", "⚠ The file is not valid JSON"));
      return;
    }
    const count = Array.isArray(data.schedules) ? data.schedules.length : 0;
    const when = typeof data.exported_at === "string" ? fmtDateTime(data.exported_at) : tr("không rõ", "unknown");
    if (!window.confirm(tr(
      `Khôi phục bản sao lưu lúc ${when} (${count} lịch)?

Toàn bộ lịch, tên thiết bị, nhóm và cài đặt hiện có sẽ bị thay thế.`,
      `Restore the backup from ${when} (${count} schedules)?

All current schedules, device names, groups and settings will be replaced.`,
    ))) return;
    try {
      const { restored } = await api.importBackup(data);
      setMessage(tr(
        `✓ Đã khôi phục ${restored.schedules} lịch · ${restored.entity_aliases} thiết bị${restored.groups != null ? ` · ${restored.groups} nhóm` : ""} · ${restored.settings} cài đặt`,
        `✓ Restored ${restored.schedules} schedules · ${restored.entity_aliases} devices${restored.groups != null ? ` · ${restored.groups} groups` : ""} · ${restored.settings} settings`,
      ));
      reload();
    } catch (e) {
      // loi 400 cua backend co {"detail": "..."} - hien dung cau do, khong hien ca chuoi ky thuat
      const raw = e instanceof Error ? e.message : String(e);
      let detail = raw;
      try {
        detail = JSON.parse(raw.slice(raw.indexOf("{"))).detail || raw;
      } catch {
        /* khong phai JSON - giu nguyen chuoi loi */
      }
      setMessage(`⚠ ${detail}`);
    }
  }

  return (
    <div className="page">
      <SubpageHeader title={tr("Sao lưu", "Backup")} onBack={onBack} />

      <div className="settings-section">
        <div className="settings-section__title">{tr("Xuất dữ liệu", "Export data")}</div>
        <button className="btn btn--ghost btn--block" onClick={exportData}>
          <Icon path={mdiDownload} size={20} /> {tr("Xuất file backup", "Export backup file")}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Khôi phục", "Restore")}</div>
        <button className="btn btn--ghost btn--block" onClick={() => fileRef.current?.click()}>
          <Icon path={mdiUpload} size={20} /> {tr("Chọn file backup", "Select backup file")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importFile(file);
            e.target.value = "";
          }}
        />
        {message && <div className="empty-hint">{message}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Dữ liệu bao gồm", "Included data")}</div>
        <div className="readonly-value readonly-value--muted">
          {tr(
            "Lịch (khung giờ, bình minh/hoàng hôn, tự tắt, điều kiện, ngày lặp, thứ tự) · Thiết bị đã thêm (tên riêng, icon, yêu thích, nhóm) · Nhóm · Giả lập có người · Mọi cài đặt",
            "Schedules (ranges, sunrise/sunset, auto-off, conditions, repeat days, order) · Added devices (custom names, icons, favorites, groups) · Groups · Presence simulation · All settings",
          )}
        </div>
        <div className="readonly-value readonly-value--muted" style={{ marginTop: 4 }}>
          {tr(
            "Không gồm: nhật ký, hẹn bật cưỡng chế đang chạy, trạng thái tạm dừng. Múi giờ luôn theo Home Assistant.",
            "Not included: log, running forced-on timers, pause state. Time zone always follows Home Assistant.",
          )}
        </div>
        <div className="readonly-value readonly-value--muted" style={{ marginTop: 4 }}>
          {tr("⚠ Khôi phục sẽ thay thế toàn bộ lịch, thiết bị, nhóm và cài đặt hiện có.", "⚠ Restoring replaces all current schedules, devices, groups and settings.")}
        </div>
      </div>
    </div>
  );
}
