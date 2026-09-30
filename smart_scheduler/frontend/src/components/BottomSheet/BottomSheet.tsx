import { useEffect, useRef, type ReactNode } from "react";
import { backdropProps } from "../../utils/backdrop";

const DISMISS_THRESHOLD_PX = 80;
// Cham bat dau tren cac vung nay van giu nguyen hanh vi rieng cua no (keo
// wheel picker doi gio, tay cam sap xep, nut/o nhap...) - khong duoc chan
// vuot-de-dong de len tren, tranh xung dot 2 cu chi cung luc.
const INTERACTIVE_SELECTOR = "[data-rwp], .time-wheel, .drag-handle, input, button, select, textarea, .light-range";

/** Bottom sheet kieu iOS tren mobile, modal can giua tren desktop (muc 37
 * SPEC.md).
 *
 * Vuot xuong de dong (phan hoi 2026-09-23 "lúc đang sửa lịch kéo xuống ở
 * những chỗ kia từ reload page có thể chuyển sang ẩn sửa lịch không? vẫn
 * bị reload page"): CSS `overscroll-behavior: none` (them o v0.5.22) khong
 * du tin cay tren moi trinh duyet/WebView di dong de chan hoan toan cu chi
 * keo-xuong-de-tai-lai-trang cua chinh no - thay vi tiep tuc vat lon voi 1
 * thuoc tinh CSS thieu nhat quan, chuyen huong: tu bat touchmove (native,
 * KHONG qua JSX onTouchMove vi React >=17 dang ky handler cham la passive
 * mac dinh, `preventDefault()` trong handler React se KHONG co tac dung -
 * phai addEventListener thu cong voi {passive:false}) va chu dong
 * preventDefault() ngay tu nguon khi phat hien keo xuong tu dinh vung cuon -
 * trinh duyet khong con co hoi nao de tu kich hoat cu chi cua no nua, dong
 * thoi TA lam 1 viec CO ICH voi cu chi do (dong sheet) thay vi de no "di vao
 * khoang khong" roi trinh duyet tu quyet dinh lam gi do (reload). Bo qua
 * hoan toan neu cham bat dau tren 1 vung tuong tac (wheel picker, tay cam
 * keo, input/button...) de khong xung dot voi cu chi rieng cua no. */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const drag = useRef({ active: false, ignore: false, startY: 0, deltaY: 0 });

  useEffect(() => {
    const sheet = sheetRef.current;
    const body = bodyRef.current;
    if (!sheet || !body) return;

    function reset() {
      sheet!.style.transform = "";
      sheet!.style.transition = "";
      drag.current = { active: false, ignore: false, startY: 0, deltaY: 0 };
    }

    function onTouchStart(e: TouchEvent) {
      const target = e.target as HTMLElement;
      const ignore = Boolean(target.closest(INTERACTIVE_SELECTOR));
      drag.current = { active: false, ignore, startY: e.touches[0].clientY, deltaY: 0 };
    }

    function onTouchMove(e: TouchEvent) {
      if (drag.current.ignore) return;
      const dy = e.touches[0].clientY - drag.current.startY;
      // Chi bat dau "keo de dong" khi dang keo XUONG VA vung cuon cua sheet
      // dang o dinh (scrollTop<=0) - keo len hoac dang cuon giua chung van
      // de trinh duyet/DOM xu ly cuon binh thuong, khong dong gi ca.
      if (dy <= 0 || body!.scrollTop > 0) return;
      drag.current.active = true;
      drag.current.deltaY = dy;
      sheet!.style.transition = "none";
      sheet!.style.transform = `translateY(${dy}px)`;
      e.preventDefault();
    }

    function onTouchEnd() {
      if (!drag.current.active) {
        reset();
        return;
      }
      sheet!.style.transition = "transform 200ms ease";
      if (drag.current.deltaY > DISMISS_THRESHOLD_PX) {
        sheet!.style.transform = "translateY(100%)";
        window.setTimeout(() => onCloseRef.current(), 180);
      } else {
        sheet!.style.transform = "";
      }
      drag.current = { active: false, ignore: false, startY: 0, deltaY: 0 };
    }

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd, { passive: true });
    sheet.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("touchcancel", reset);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" {...backdropProps(onClose)}>
      <div className="sheet" ref={sheetRef} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__title">{title}</div>
        <div className="sheet__body" ref={bodyRef}>
          {children}
        </div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </div>
  );
}
