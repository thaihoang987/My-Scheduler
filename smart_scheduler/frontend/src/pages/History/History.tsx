import { useEffect, useState } from "react";
import { api } from "../../services/api";
import type { HistoryEntry } from "../../types";
import { storedText, tr } from "../../i18n";
import { fmtDateTime } from "../../utils/appTime";

/** Cot trai chi co icon (rong 20px); chu mo ta trang thai hien duoi gio chay
 * - truoc day ca cum "⚠ bỏ qua (lỡ giờ)" nhet vao cot 20px nen tran ra ngoai. */
function statusInfo(status: string): [string, string] {
  return ({
    success: ["✓", ""],
    error: ["✕", ""],
    skipped_missed: ["⚠", tr("Bỏ qua (lỡ giờ)", "Skipped (missed)")],
    skipped_once: ["⏭", tr("Bỏ qua (thủ công)", "Skipped (manual)")],
    skipped_condition: ["⚠", tr("Bỏ qua (điều kiện)", "Skipped (condition)")],
    skipped_expired: ["⚠", tr("Bỏ qua (hết khung)", "Skipped (expired)")],
    verify_failed: ["⚠", tr("Sai trạng thái", "State mismatch")],
    warning: ["⚠", tr("Cảnh báo", "Warning")],
  } as Record<string, [string, string]>)[status] || ["•", status];
}

export function History() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [range, setRange] = useState<"today" | "7d" | "30d">("7d");

  useEffect(() => {
    api.listHistory(500).then(setEntries);
  }, []);

  const cutoff = { today: 1, "7d": 7, "30d": 30 }[range];
  const cutoffDate = new Date(Date.now() - cutoff * 86400000);
  const filtered = entries.filter((e) => new Date(e.executed_at) >= cutoffDate);

  return (
    <div className="page">
      <div className="chip-row">
        {(["today", "7d", "30d"] as const).map((r) => (
          <button key={r} className={range === r ? "chip chip--active" : "chip"} onClick={() => setRange(r)}>
            {{ today: tr("Hôm nay", "Today"), "7d": tr("7 ngày", "7 days"), "30d": tr("30 ngày", "30 days") }[r]}
          </button>
        ))}
      </div>
      <div className="history-list">
        {filtered.length === 0 && <div className="empty-hint">{tr("Chưa có lịch sử.", "No history yet.")}</div>}
        {filtered.map((e) => {
          const [icon, label] = statusInfo(e.status);
          return (
          <div key={e.id} className="history-row">
            <span className={`history-row__status history-row__status--${e.status}`}>{icon}</span>
            <div className="history-row__body">
              <div className="history-row__name">
                {storedText(e.schedule_name) || tr("(đã xóa)", "(deleted)")} {e.manual && <span className="badge">{tr("thủ công", "manual")}</span>}
              </div>
              <div className="history-row__time">
                {fmtDateTime(e.executed_at)}
                {label && <span className="history-row__label"> · {label}</span>}
              </div>
              {e.message && <div className="history-row__message">{storedText(e.message)}</div>}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
