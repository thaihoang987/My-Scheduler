import { useEffect, useState } from "react";
import { DaySelector } from "../../../components/DaySelector/DaySelector";
import { EntityPicker } from "../../../components/EntityPicker/EntityPicker";
import { api } from "../../../services/api";
import type { EntitySummary, PresenceConfig, PresenceStatus } from "../../../types";
import { entityNames } from "../../../utils/groupSchedules";
import { SubpageHeader } from "../SubpageHeader";
import { tr } from "../../../i18n";
import { fmtTime } from "../../../utils/appTime";

function hhmm(iso: string): string {
  return fmtTime(iso);
}

/** "Giả lập có người" (v0.5.32) - khi di vang, trong khung gio da chon bat
 * LAN LUOT ngau nhien tung thiet bi, moi lan sang 1 khoang ngau nhien, nghi
 * 1 khoang ngau nhien roi toi thiet bi khac, nhin tu ngoai giong co nguoi o
 * nha. Chay o backend (app/presence.py), khong can mo trinh duyet. */
export function PresenceSettings({
  entities,
  reloadPresence,
  onBack,
}: {
  entities: EntitySummary[];
  reloadPresence: () => void;
  onBack: () => void;
}) {
  const [config, setConfig] = useState<PresenceConfig | null>(null);
  const [status, setStatus] = useState<PresenceStatus | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getPresence().then((r) => {
      setConfig(r.config);
      setStatus(r.status);
    });
  }, []);

  if (!config) return <div className="page"><SubpageHeader title={tr("Giả lập có người", "Presence simulation")} onBack={onBack} /></div>;

  const set = (patch: Partial<PresenceConfig>) => {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    setSaved(false);
  };

  async function save(patch: Partial<PresenceConfig> = {}) {
    if (!config) return;
    setSaving(true);
    try {
      const r = await api.updatePresence({ ...config, ...patch });
      setConfig(r.config);
      setStatus(r.status);
      setSaved(true);
      reloadPresence();
    } finally {
      setSaving(false);
    }
  }

  const num = (key: keyof PresenceConfig, label: string, min = 0) => (
    <label className="presence-field">
      <span className="presence-field__label">{label}</span>
      <input
        type="number"
        className="input"
        inputMode="numeric"
        min={min}
        value={config[key] as number}
        onChange={(e) => set({ [key]: Math.max(min, Number(e.target.value) || 0) } as Partial<PresenceConfig>)}
      />
    </label>
  );

  return (
    <div className="page">
      <SubpageHeader title={tr("Giả lập có người", "Presence simulation")} onBack={onBack} />
      <p className="settings-hint">
        {tr("Khi đi vắng: trong khung giờ đã chọn, lần lượt bật ngẫu nhiên từng thiết bị, mỗi lần sáng một lúc rồi tắt, nghỉ một chút rồi bật thiết bị khác. Chạy ngay trên Add-on, không cần mở app.", "While away, randomly turn selected devices on one at a time during the chosen window, keep each on briefly, then pause before activating another. It runs in the add-on with no open app required.")}
      </p>

      <label className="settings-row">
        <span>
          <strong>{tr("Bật giả lập", "Enable simulation")}</strong>
        </span>
        <input type="checkbox" checked={config.enabled} onChange={(e) => save({ enabled: e.target.checked })} disabled={saving} />
      </label>

      {status?.active && (
        <div className="home-banner home-banner--presence">
          <span className="home-banner__text">
            {status.on.length > 0
              ? `${tr("Đang bật", "On")}: ${entityNames(status.on.map((o) => o.entity_id), entities)} ${tr("đến", "until")} ${hhmm(status.on[0].off_at)}`
              : status.next_start_at
                ? `${tr("Đang trong khung giờ · bật thiết bị tiếp theo lúc", "Within active window · next device at")} ~${hhmm(status.next_start_at)}`
                : tr("Đang chạy", "Running")}
          </span>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section__title">{tr("Thiết bị tham gia", "Participating devices")}</div>
        <button className="input input--button" onClick={() => setPickerOpen(true)}>
          {config.entity_ids.length === 0 ? `+ ${tr("Chọn thiết bị (nên chọn đèn)", "Select devices (lights recommended)")}` : entityNames(config.entity_ids, entities)}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Khung giờ chạy", "Active window")}</div>
        <div className="presence-grid">
          <label className="presence-field">
            <span className="presence-field__label">{tr("Từ", "From")}</span>
            <input type="time" className="input" value={config.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className="presence-field">
            <span className="presence-field__label">{tr("Đến", "To")}</span>
            <input type="time" className="input" value={config.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>
        <DaySelector value={config.days} onChange={(days) => set({ days })} />
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{tr("Mỗi thiết bị sáng trong (phút, ngẫu nhiên)", "On duration per device (random minutes)")}</div>
        <div className="presence-grid">
          {num("on_min", tr("Ít nhất", "Minimum"), 1)}
          {num("on_max", tr("Nhiều nhất", "Maximum"), 1)}
        </div>
        <div className="settings-section__title">{tr("Nghỉ giữa 2 lần bật (phút, ngẫu nhiên)", "Gap between activations (random minutes)")}</div>
        <div className="presence-grid">
          {num("gap_min", tr("Ít nhất", "Minimum"))}
          {num("gap_max", tr("Nhiều nhất", "Maximum"))}
        </div>
        <div className="settings-section__title">{tr("Số thiết bị sáng cùng lúc", "Devices on at once")}</div>
        <div className="chip-row">
          {[1, 2, 3].map((n) => (
            <button key={n} className={config.max_concurrent === n ? "chip chip--active" : "chip"} onClick={() => set({ max_concurrent: n })}>
              {n === 1 ? tr("1 (lần lượt)", "1 (sequential)") : n}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn--primary btn--block" onClick={() => save()} disabled={saving}>
        {saving ? tr("Đang lưu...", "Saving...") : saved ? tr("Đã lưu ✓", "Saved ✓") : tr("Lưu cài đặt", "Save settings")}
      </button>

      <EntityPicker
        open={pickerOpen}
        selected={config.entity_ids}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => {
          set({ entity_ids: ids });
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
