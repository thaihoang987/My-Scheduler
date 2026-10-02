import { mdiChartGantt, mdiTimelineClockOutline, mdiViewGridOutline, mdiViewListOutline } from "@mdi/js";
import type { DisplayMode } from "../types";

/** Nut doi kieu xem tren Nha (v0.5.62, menu 4 kieu tu v0.5.64), luu vao Cai
 * dat (cung khoa display_mode voi Cai dat -> Giao dien). */
export const VIEWS: DisplayMode[] = ["compact", "list", "agenda", "timeline"];
export const VIEW_META: Record<DisplayMode, { icon: string; vi: string; en: string }> = {
  compact: { icon: mdiViewGridOutline, vi: "Thu gọn", en: "Compact" },
  list: { icon: mdiViewListOutline, vi: "Danh sách", en: "List" },
  agenda: { icon: mdiTimelineClockOutline, vi: "Theo giờ", en: "By time" },
  timeline: { icon: mdiChartGantt, vi: "Bảng 24h", en: "24h chart" },
};
