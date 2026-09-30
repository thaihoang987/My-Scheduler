import { tr } from "../../i18n";
import { fmtTime } from "../../utils/appTime";

/** Chinh so phut lech +/- so voi 1 moc troi (Binh minh/Hoang hon) - thay the
 * TimeWheelPicker khi trigger_type khac "time" (xem ScheduleEditor.tsx).
 * Buoc 5 phut cho cham thuong, giu phim de chay nhanh qua onPointerDown lap
 * lai o cap goi (khong can rieng, click lien tuc la du cho pham vi +/-180). */
const STEP = 5;
const MIN = -180;
const MAX = 180;

/** `baseTimeIso`: gio moc troi HOM NAY tai vi tri HA that (tu GET /api/sun/today,
 * xem ScheduleEditor.tsx) - dung de hien "~05:43" ben duoi, giup nguoi dung
 * biet lich se chay khoang may gio thuc te thay vi chi thay do lech +/- phut
 * mo ho (phan hoi 2026-09-23: "phai co thoi gian hien thi nho cho nguoi dung
 * biet khi nao"). Gio thuc te MOI NGAY se xe di vai phut (mua he/dong khac
 * nhau) - day chi la uoc tinh cho HOM NAY, khong phai gio chinh xac se chay. */
export function OffsetStepper({
  label,
  minutes,
  baseTimeIso,
  onChange,
}: {
  label: string;
  minutes: number;
  baseTimeIso?: string | null;
  onChange: (minutes: number) => void;
}) {
  const clamp = (v: number) => Math.max(MIN, Math.min(MAX, v));
  const previewTime = baseTimeIso ? new Date(new Date(baseTimeIso).getTime() + minutes * 60000) : null;
  const previewText = previewTime ? fmtTime(previewTime) : null;
  return (
    <div className="offset-stepper">
      <button type="button" className="offset-stepper__btn" onClick={() => onChange(clamp(minutes - STEP))} aria-label={tr("Giảm", "Decrease")}>
        −
      </button>
      <div className="offset-stepper__value">
        <div className="offset-stepper__label">{label}</div>
        <div className="offset-stepper__minutes">{minutes === 0 ? tr("Đúng giờ", "On time") : `${minutes > 0 ? "+" : ""}${minutes} ${tr("phút", "minutes")}`}</div>
        <div className="offset-stepper__preview">{previewText ? `≈ ${previewText} ${tr("hôm nay", "today")}` : tr("Đang tính giờ theo vị trí HA...", "Calculating from the HA location...")}</div>
      </div>
      <button type="button" className="offset-stepper__btn" onClick={() => onChange(clamp(minutes + STEP))} aria-label={tr("Tăng", "Increase")}>
        +
      </button>
    </div>
  );
}
