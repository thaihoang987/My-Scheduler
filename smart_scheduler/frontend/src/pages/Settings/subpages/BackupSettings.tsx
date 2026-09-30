import { mdiDownload, mdiUpload } from "@mdi/js";
import { useRef, useState } from "react";
import { Icon } from "../../../components/Icon/Icon";
import { api } from "../../../services/api";
import { SubpageHeader } from "../SubpageHeader";
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
    a.download = `smart-scheduler-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.importBackup(data);
      setMessage(tr("✓ Đã khôi phục dữ liệu", "✓ Data restored"));
      reload();
    } catch (e) {
      setMessage(`${tr("⚠ File không hợp lệ", "⚠ Invalid file")}: ${e instanceof Error ? e.message : String(e)}`);
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
        <div className="readonly-value readonly-value--muted">{tr("Lịch · Tên thiết bị (alias) · Cài đặt hiển thị", "Schedules · Device names (aliases) · Display settings")}</div>
        <div className="readonly-value readonly-value--muted" style={{ marginTop: 4 }}>
          {tr("⚠ Khôi phục sẽ thay thế toàn bộ lịch và tên thiết bị hiện có.", "⚠ Restoring will replace all current schedules and device names.")}
        </div>
      </div>
    </div>
  );
}
