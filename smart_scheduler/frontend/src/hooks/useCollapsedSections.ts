import { useCallback, useState } from "react";

const KEY = "smart-scheduler.collapsed-sections";

function load(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Trang thai thu gon tung nhom tren trang Nha - nho theo tung may (localStorage,
 * dien thoai va may tinh co the muon khac nhau). Loi storage thi chi mat nho. */
export function useCollapsedSections(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(load);
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // bo qua - van thu gon duoc trong phien nay
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
