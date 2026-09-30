import type { MouseEvent, PointerEvent } from "react";

// Luu o muc module (khong phai closure theo render): trang Nha re-render moi
// giay (dong ho/dem nguoc), bien trong closure se bi tao lai giua luc nhan va nha.
let pressedOnBackdrop = false;

/** Props cho `.sheet-backdrop`: CHI dong popup khi ca luc nhan lan luc nha
 * chuot/ngon tay deu nam tren nen mo ben ngoai (phan hoi 2026-09-30: keo chuot
 * tu trong popup ra ngoai roi nha - vd boi den chu, keo wheel picker - trinh
 * duyet tinh la 1 cu click len nen mo va popup bi tat oan). */
export function backdropProps(onClose: () => void) {
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      pressedOnBackdrop = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const ok = pressedOnBackdrop && e.target === e.currentTarget;
      pressedOnBackdrop = false;
      if (ok) onClose();
    },
  };
}
