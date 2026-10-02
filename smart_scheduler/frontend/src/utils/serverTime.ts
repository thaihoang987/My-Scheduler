let anchor: { unixMs: number; monotonicMs: number; wallMs: number } | null = null;
const listeners = new Set<() => void>();

/** Gio may chu hien tai. Tinh tiep tu lan dong bo bang dong ho don dieu
 * (performance.now, khong bi anh huong khi nguoi dung chinh gio may) - NHUNG
 * tren dien thoai dong ho nay DUNG khi app/WebView bi dua xuong nen, quay lai
 * thi cham dung bang khoang thoi gian o nen (v0.5.65: bang 24h/theo gio/dem
 * nguoc sai gio sau khi ra vao app, chi dong ho tren Nha dung vi no tu dong bo
 * lai). Neu dong ho tuong (Date.now) di nhanh hon ro rang (>2s) thi coi la
 * vua bi treo o nen va dung dong ho tuong cho toi lan dong bo ke tiep. */
export function serverNow(): number {
  if (!anchor) return Date.now();
  const mono = performance.now() - anchor.monotonicMs;
  const wall = Date.now() - anchor.wallMs;
  return anchor.unixMs + (wall - mono > 2000 ? wall : mono);
}

export function isTimeSynced(): boolean { return anchor !== null; }

/** Bao cho cac component dang hien "bay gio" (DayViews...) cap nhat ngay sau
 * moi lan dong bo, khong phai cho toi nhip dem rieng cua chung. */
export function onServerTimeSync(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function syncServerTime(): Promise<void> {
  const start = performance.now();
  const response = await fetch("api/time", { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(tr("Không đọc được giờ máy chủ", "Could not read server time"));
  const data = await response.json();
  const end = performance.now();
  if (!Number.isFinite(data.unix_ms)) throw new Error(tr("Giờ máy chủ không hợp lệ", "Invalid server time"));
  // Approximate one-way latency, then advance using a monotonic clock.
  anchor = { unixMs: data.unix_ms + (end - start) / 2, monotonicMs: end, wallMs: Date.now() };
  listeners.forEach((cb) => cb());
}
import { tr } from "../i18n";
