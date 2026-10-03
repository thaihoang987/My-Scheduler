import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";

const LEGACY_KEY = "smart-scheduler.collapsed-sections";

/** Nhom dang thu gon tren trang Nha. Tu v0.5.90 luu o server (settings
 * `collapsed_sections`), rieng tung tai khoan HA va nam trong file sao luu -
 * truoc day o localStorage nen khoi phuc/doi may la mat. Lan dau mo ban moi:
 * chuyen gia tri cu trong localStorage len server (neu server chua co gi). */
export function useCollapsedSections(serverValue: string[] | undefined, reload: () => void): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(serverValue ?? []));
  const pending = useRef(false);

  // Dong bo lai khi server doi (tab/may khac, khoi phuc sao luu) - tru luc
  // vua bam xong chua luu kip, tranh nhay ve trang thai cu.
  const serverKey = (serverValue ?? []).join("|");
  useEffect(() => {
    if (!pending.current) setCollapsed(new Set(serverValue ?? []));
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      window.localStorage.removeItem(LEGACY_KEY);
      const legacy = JSON.parse(raw) as string[];
      if (legacy.length && !(serverValue ?? []).length) {
        setCollapsed(new Set(legacy));
        api.updateSettings({ collapsed_sections: legacy }).then(reload).catch(() => undefined);
      }
    } catch {
      // storage bi chan - bo qua
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      pending.current = true;
      // Khong reload ca app moi lan bam: trang thai tai cho da dung, lan tai sau
      // server tra ve dung gia tri vua luu.
      api.updateSettings({ collapsed_sections: [...next] })
        .catch(() => undefined)
        .finally(() => {
          pending.current = false;
        });
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
