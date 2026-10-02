import { useState } from "react";
import { mdiStopCircleOutline } from "@mdi/js";
import { Icon } from "../Icon/Icon";
import { presencePhase } from "../../pages/Settings/subpages/PresenceSettings";
import { api } from "../../services/api";
import type { EntitySummary, PresenceStatus, Settings } from "../../types";
import { entityNames } from "../../utils/groupSchedules";
import { tr } from "../../i18n";
import { fmtDateTime, fmtTime } from "../../utils/appTime";

function formatWhen(iso: string): string {
  return fmtDateTime(iso, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

/** Cac bang thong bao dau trang Nha: dang tam dung lich, dang gia lap co
 * nguoi. Lich loi/bi bo qua CHI ghi o Cai dat -> Nhat ky, khong dua ra Nha
 * (phan hoi 2026-09-24, bo banner "lịch cần chú ý" co tu v0.5.32). */
export function HomeBanners({
  settings,
  entities,
  presence,
  reloadPresence,
  reload,
}: {
  settings: Settings;
  entities: EntitySummary[];
  presence: PresenceStatus | null;
  reloadPresence: () => void;
  reload: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const pauseEnd = settings.pause_until ? new Date(settings.pause_until) : null;
  const paused = pauseEnd && pauseEnd.getTime() > Date.now();

  async function resume() {
    await api.updateSettings({ pause_until: "" });
    reload();
  }

  async function stopPresence() {
    setStopping(true); setError("");
    try { await api.stopPresence(); reloadPresence(); reload(); }
    catch { setError(tr("Không gửi được lệnh dừng", "Could not send stop command")); }
    finally { setStopping(false); }
  }

  return (
    <>
      {paused && (
        <div className="home-banner home-banner--pause" role="status">
          <span className="home-banner__text">⏸ {tr("Đang tạm dừng mọi lịch đến", "All schedules paused until")} {formatWhen(pauseEnd!.toISOString())}</span>
          <button className="home-banner__btn" onClick={resume}>
            {tr("Tiếp tục", "Resume")}
          </button>
        </div>
      )}

      {(presence?.active || presence?.enabled) && presence && (
        <div className="home-banner home-banner--presence" role="status">
          <span className="home-banner__text">
            {tr("Giả lập có người", "Presence simulation")} · {presencePhase(presence)}
            {presence.on.map(o => <div className="home-banner__line" key={o.entity_id}>{entityNames([o.entity_id], entities)} · {tr("tắt lúc", "off at")} {fmtTime(o.off_at)}</div>)}
            {presence.next_start_at && <div className="home-banner__line">{tr("Lượt tiếp", "Next activation")}: ~{fmtTime(presence.next_start_at)}</div>}
            {!!presence.pending_off?.length && <div className="home-banner__line">{tr("Chờ xác nhận tắt", "Awaiting off confirmation")}: {entityNames(presence.pending_off, entities)}</div>}
            {error && <div role="alert">{error}</div>}
          </span>
          <button className="home-banner__btn" title={tr("Dừng và tắt toàn bộ danh sách", "Stop and turn off all selected devices")} aria-label={tr("Dừng và tắt toàn bộ danh sách", "Stop and turn off all selected devices")} disabled={stopping} onClick={stopPresence}><Icon path={mdiStopCircleOutline} size={24} /></button>
        </div>
      )}

    </>
  );
}
