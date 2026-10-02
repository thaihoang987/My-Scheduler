import { useEffect, useState } from "react";
import { mdiEyeOutline, mdiContentSaveOutline } from "@mdi/js";
import { DaySelector } from "../../../components/DaySelector/DaySelector";
import { EntityPicker } from "../../../components/EntityPicker/EntityPicker";
import { BottomSheet } from "../../../components/BottomSheet/BottomSheet";
import { Icon } from "../../../components/Icon/Icon";
import { StateTimeline } from "../../../components/StateTimeline/StateTimeline";
import { api } from "../../../services/api";
import type { EntitySummary, PresenceConfig, PresencePreview, PresenceStatus } from "../../../types";
import { entityNames } from "../../../utils/groupSchedules";
import { SubpageHeader } from "../SubpageHeader";
import { tr } from "../../../i18n";
import { fmtTime } from "../../../utils/appTime";

export function presencePhase(status: PresenceStatus): string {
  const labels = {
    disabled: tr("Đã dừng", "Stopped"), expired: tr("Hết ngày đi vắng", "Away period ended"),
    waiting_window: tr("Chờ khung giờ", "Waiting for active window"),
    waiting_next: tr("Đang nghỉ giữa các lượt", "Resting between activations"),
    running: tr("Đang giả lập", "Simulating presence"),
    budget_exhausted: tr("Đã đủ tổng phút bật", "On-time limit reached"),
    error: tr("Cần kiểm tra kết nối hoặc lịch trùng", "Check connection or schedule conflicts"),
    stopping: tr("Đang tắt thiết bị · sẽ thử lại nếu chưa tắt", "Turning devices off · retrying unconfirmed devices"),
  };
  return labels[status.phase ?? (status.active ? "running" : "disabled")];
}

export function PresenceSettings({ entities, reloadPresence, liveStatus, onBack }: {
  entities: EntitySummary[]; reloadPresence: () => void; liveStatus: PresenceStatus | null; onBack: () => void;
}) {
  const [config, setConfig] = useState<PresenceConfig | null>(null);
  const [status, setStatus] = useState<PresenceStatus | null>(liveStatus);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PresencePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyIds, setHistoryIds] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    api.getPresence().then(r => {
      if (!mounted) return;
      setConfig(r.config);
      setHistoryIds(r.config.entity_ids);
      setStatus(r.status);
    }).catch(() => { if (mounted) setError(tr("Không tải được cài đặt", "Could not load settings")); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!liveStatus) return;
    setStatus(liveStatus);
    if (liveStatus.enabled !== undefined) setConfig(c => c ? { ...c, enabled: liveStatus.enabled! } : c);
  }, [liveStatus]);
  const set = (patch: Partial<PresenceConfig>) => { setConfig(c => c ? { ...c, ...patch } : c); setSaved(false); };
  const validation = config && (config.on_min > config.on_max || config.gap_min > config.gap_max)
    ? tr("Giá trị ít nhất không được lớn hơn nhiều nhất", "Minimum must not exceed maximum") : "";

  async function operate(enabled: boolean) {
    setBusy(true); setError("");
    try {
      const r = enabled ? await api.updatePresence({ enabled: true }) : await api.stopPresence();
      setConfig(c => c ? { ...c, enabled: r.config.enabled } : c);
      setStatus(r.status); reloadPresence();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function save() {
    if (!config || validation) return;
    setBusy(true); setError("");
    try {
      const r = await api.updatePresence(config);
      setConfig(r.config); setHistoryIds(r.config.entity_ids); setStatus(r.status); setSaved(true); reloadPresence();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function showPreview() {
    if (!config || validation) return;
    setBusy(true); setError("");
    try { setPreview(await api.previewPresence(config)); setPreviewOpen(true); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  const num = (key: keyof PresenceConfig, label: string, min: number, max: number) => config && (
    <label className="presence-field"><span className="presence-field__label">{label}</span>
      <input type="number" className="input" inputMode="numeric" min={min} max={max} required
        value={config[key] as number} onChange={e => set({ [key]: Number(e.target.value) })} />
    </label>
  );

  return <div className="page presence-settings">
    <SubpageHeader title={tr("Giả lập có người", "Presence simulation")} onBack={onBack} />
    {error && <p className="settings-hint" role="alert">{error}</p>}
    {config && <>
      <label className="settings-row"><strong>{tr("Bật giả lập", "Enable simulation")}</strong>
        <input type="checkbox" checked={config.enabled} disabled={busy} onChange={e => operate(e.target.checked)} />
      </label>
      <p className="settings-hint">{tr("Hết giờ hoặc dừng: tắt toàn bộ thiết bị đã chọn, kể cả thiết bị bật tay.", "At window end or stop: turn off every selected device, including manually activated devices.")}</p>
      {status && <div className="presence-status" role="status">
        <strong>{presencePhase(status)}</strong>
        {status.on.map(o => <div key={o.entity_id}>{entityNames([o.entity_id], entities)} · {tr("tắt lúc", "off at")} {fmtTime(o.off_at)}</div>)}
        {status.next_start_at && <div>{tr("Lượt tiếp", "Next activation")}: ~{fmtTime(status.next_start_at)}</div>}
        <div>{tr("Tổng phút bật", "Total device-on minutes")}: {status.used_minutes ?? 0} / {status.max_total_minutes ?? config.max_total_minutes}</div>
        {!!status.pending_off?.length && <div>{tr("Chờ xác nhận tắt", "Awaiting off confirmation")}: {entityNames(status.pending_off, entities)}</div>}
        {status.warnings?.map(w => <div key={w.entity_id}>{w.entity_id && `${entityNames([w.entity_id], entities)}: `}{w.message}</div>)}
      </div>}
      {!!historyIds.length && <StateTimeline key={historyIds.join(",")} entityIds={historyIds} entities={entities}
        planned={status?.planned} lookAheadMs={6 * 3600_000}
        liveKey={`${entities.filter(e => historyIds.includes(e.entity_id)).map(e => `${e.entity_id}:${e.state}`).join(",")}|${JSON.stringify(status?.on)}`} />}
      <div className="settings-section">
        <div className="settings-section__title">{tr("Thiết bị tham gia", "Participating devices")}</div>
        <button className="input input--button" onClick={() => setPickerOpen(true)}>
          {config.entity_ids.length ? entityNames(config.entity_ids, entities) : tr("Chọn đèn hoặc công tắc đèn", "Select lights or light switches")}
        </button>
      </div>
      <div className="settings-section">
        <div className="settings-section__title">{tr("Khung giờ chạy", "Active window")}</div>
        <div className="chip-row" role="group" aria-label={tr("Bắt đầu", "Start mode")}>
          {(["time", "sunset"] as const).map(mode => <button key={mode} className={`chip ${config.start_mode === mode ? "chip--active" : ""}`} aria-pressed={config.start_mode === mode} onClick={() => set({ start_mode: mode })}>
            {mode === "time" ? tr("Giờ cố định", "Fixed time") : tr("Hoàng hôn", "Sunset")}
          </button>)}
        </div>
        <div className="presence-grid">
          {config.start_mode === "time" && <label className="presence-field"><span className="presence-field__label">{tr("Từ", "From")}</span>
            <input type="time" className="input" required value={config.start} onChange={e => set({ start: e.target.value })} /></label>}
          <label className="presence-field"><span className="presence-field__label">{tr("Đến", "To")}</span>
            <input type="time" className="input" required value={config.end} onChange={e => set({ end: e.target.value })} /></label>
        </div>
        <DaySelector value={config.days} onChange={days => set({ days })} />
        <label className="presence-field"><span className="presence-field__label">{tr("Ngày đi vắng cuối cùng (tùy chọn)", "Last away date (optional)")}</span>
          <input type="date" className="input" value={config.until} onChange={e => set({ until: e.target.value })} /></label>
      </div>
      <div className="settings-section">
        <div className="settings-section__title">{tr("Mỗi lượt bật (phút)", "On duration (minutes)")}</div>
        <div className="presence-grid">{num("on_min", tr("Ít nhất", "Minimum"), 1, 180)}{num("on_max", tr("Nhiều nhất", "Maximum"), 1, 180)}</div>
        <div className="settings-section__title">{tr("Nghỉ giữa các lượt (phút)", "Gap between activations (minutes)")}</div>
        <div className="presence-grid">{num("gap_min", tr("Ít nhất", "Minimum"), 0, 180)}{num("gap_max", tr("Nhiều nhất", "Maximum"), 0, 180)}</div>
        {num("cooldown_minutes", tr("Chờ trước khi bật lại cùng thiết bị (phút)", "Same-device cooldown (minutes)"), 0, 240)}
        {num("max_total_minutes", tr("Giới hạn tổng phút bật mỗi khung giờ", "Device-on minute limit per window"), 1, 720)}
        <p className="settings-hint">{tr("2 đèn bật 10 phút = 20 phút. Không phải số đo điện năng.", "2 lights on for 10 minutes = 20 minutes. Not an energy measurement.")}</p>
        <div className="settings-section__title">{tr("Số thiết bị sáng cùng lúc", "Devices on at once")}</div>
        <div className="chip-row">{[1, 2].map(n => <button key={n} className={`chip ${config.max_concurrent === n ? "chip--active" : ""}`} aria-pressed={config.max_concurrent === n} onClick={() => set({ max_concurrent: n })}>{n}</button>)}</div>
        <label className="presence-field"><span className="presence-field__label">{tr("Độ sáng đèn hỗ trợ dim", "Dimmable-light brightness")}: {config.brightness_pct}%</span>
          <input type="range" min={1} max={100} value={config.brightness_pct} onChange={e => set({ brightness_pct: Number(e.target.value) })} /></label>
      </div>
      {validation && <p role="alert" className="settings-hint">{validation}</p>}
      <button className="btn btn--block" onClick={showPreview} disabled={busy || !!validation}><Icon path={mdiEyeOutline} size={20} /> {tr("Xem lịch mẫu", "Preview sample plan")}</button>
      <button className="btn btn--primary btn--block" onClick={save} disabled={busy || !!validation}><Icon path={mdiContentSaveOutline} size={20} /> {busy ? tr("Đang xử lý...", "Working...") : saved ? tr("Đã lưu", "Saved") : tr("Lưu cài đặt", "Save settings")}</button>
      <EntityPicker open={pickerOpen} selected={config.entity_ids} onClose={() => setPickerOpen(false)} onConfirm={ids => { set({ entity_ids: ids }); setPickerOpen(false); }} />
      <BottomSheet open={previewOpen} title={tr("Lịch mẫu · không bật thiết bị", "Sample plan · no devices activated")} onClose={() => setPreviewOpen(false)}>
        <p className="settings-hint">{tr("Lượt thực tế sẽ thay đổi theo trạng thái thiết bị và lịch khác.", "Actual activations vary with device states and other schedules.")}</p>
        <p>{tr("Tổng phút bật", "Total device-on minutes")}: {preview?.total_minutes ?? 0}</p>
        {!preview?.events.length && <p>{tr("Không có lượt phù hợp", "No eligible activations")}</p>}
        {preview?.events.map((e, i) => <div className="presence-plan-row" key={i}><span>{entityNames([e.entity_id], entities)}</span><span>{fmtTime(e.on_at)} – {fmtTime(e.off_at)}</span></div>)}
      </BottomSheet>
    </>}
  </div>;
}
