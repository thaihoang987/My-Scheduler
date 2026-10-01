import { mdiCog, mdiHome } from "@mdi/js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./components/Icon/Icon";
import { goBack, useBackNavigation } from "./hooks/useBackNavigation";
import { useWebSocket } from "./hooks/useWebSocket";
import { DeviceDetail } from "./pages/DeviceDetail/DeviceDetail";
import { Home } from "./pages/Home/Home";
import { SettingsPage } from "./pages/Settings/SettingsPage";
import { api } from "./services/api";
import type { DeviceGroup, EntitySummary, Group, HealthStatus, ManualTimer, PresenceStatus, Schedule, Settings as SettingsType } from "./types";
import { groupSchedules } from "./utils/groupSchedules";
import { setAppLanguage, tr } from "./i18n";
import { setAppTimeZone } from "./utils/appTime";

type Tab = "home" | "settings";

const DEFAULT_SETTINGS: SettingsType = {
  timezone: "Asia/Ho_Chi_Minh",
  missed_execution_policy: "skip",
  show_countdown: true,
  show_entity_name: true,
  show_action: true,
  show_days: true,
  show_entity_id: false,
  show_area: false,
  show_device: false,
  show_last_run: false,
  show_next_run: false,
  display_mode: "compact",
  theme: "auto",
  time_format: "24h",
  sort_mode: "auto",
  language: "en",
  reset_devices_on_startup: false,
  pause_until: "",
  verify_state: false,
  auto_off_section_index: 0,
};

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [openDeviceKey, setOpenDeviceKey] = useState<string | null>(null);
  useBackNavigation(openDeviceKey !== null, () => setOpenDeviceKey(null));
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [haConnected, setHaConnected] = useState(true);
  const [haConnectionMode, setHaConnectionMode] = useState<HealthStatus["ha_connection_mode"]>("unavailable");
  const [loaded, setLoaded] = useState(false);
  const [activeTimers, setActiveTimers] = useState<ManualTimer[]>([]);
  const [presence, setPresence] = useState<PresenceStatus | null>(null);
  // "Nhom" nguoi dung tu tao de PHAN LOAI thiet bi tren trang Nha - khac
  // hoan toan `groups` (DeviceGroup[] tinh tu schedules) ben duoi, dat ten
  // rieng `categoryGroups` de khong nham.
  const [categoryGroups, setCategoryGroups] = useState<Group[]>([]);
  // Co qua trinh SortableJS dang keo/thao tac DOM truc tiep (xem
  // DeviceGrid/GroupedDeviceGrid.tsx) hay khong - phai CHAN moi lan
  // setState nen tu nguon khac (poll dinh ky, WebSocket) trong luc nay.
  // Bug thuc te 2026-09-23: SortableJS di chuyen DOM node that giua cac
  // container (doi nhom) MA REACT KHONG BIET; neu 1 setState tu nguon khac
  // lam React re-render xen vao giua luc do (vd poll entity 8s vua them),
  // React co the goi removeChild() tren node da bi SortableJS doi cha khac
  // -> crash "NotFoundError: Failed to execute 'removeChild'" (trang trang
  // xoa het UI). Chi rieng ban than luot keo/persist (onEnd trong
  // DeviceGrid/GroupedDeviceGrid) duoc phep cap nhat state trong luc nay,
  // vi no biet chinh xac DOM da doi the nao va se tu goi reload() dung luc.
  const draggingRef = useRef(false);
  const setDragging = useCallback((v: boolean) => {
    draggingRef.current = v;
  }, []);

  const reload = useCallback(async () => {
    const [s, st, health] = await Promise.all([api.listSchedules(), api.getSettings(), api.getHealth()]);
    setSchedules(s);
    setSettings(st);
    setHaConnectionMode(health.ha_connection_mode);
    try {
      const e = await api.listEntities("added");
      setEntities(e);
      setHaConnected(true);
    } catch {
      setHaConnected(false);
    }
    setLoaded(true);
  }, []);

  const reloadTimers = useCallback(async () => {
    setActiveTimers(await api.listActiveManualTimers());
  }, []);

  const reloadPresence = useCallback(async () => {
    try {
      setPresence((await api.getPresence()).status);
    } catch {
      setPresence(null);
    }
  }, []);

  const reloadCategoryGroups = useCallback(async () => {
    setCategoryGroups(await api.listGroups());
  }, []);

  // Chi doc lai trang thai bat/tat thuc te cua entity (khong dong ca schedules/
  // settings) - phan hoi 2026-09-23: "thiet bi bi tat tu Lovelace thi UI o day
  // khong thay cap nhat". App nay khong giu websocket rieng toi HA de nhan
  // state_changed truc tiep (chi co WS noi bo toi backend cho su kien
  // schedule/manual timer/groups) nen phai poll dinh ky; chi poll khi tab dang
  // hien (document.visibilityState) de do phi tai nguyen/API call khi an.
  const refreshEntityStates = useCallback(async () => {
    if (draggingRef.current) return;
    try {
      const e = await api.listEntities("added");
      if (draggingRef.current) return; // co the da bat dau keo trong luc cho fetch
      setEntities(e);
      setHaConnected(true);
    } catch {
      setHaConnected(false);
    }
  }, []);

  useEffect(() => {
    reload();
    reloadTimers();
    reloadCategoryGroups();
    reloadPresence();
  }, [reload, reloadTimers, reloadCategoryGroups, reloadPresence]);

  useEffect(() => {
    const ENTITY_POLL_MS = 8000;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(refreshEntityStates, ENTITY_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    // Quay lai tab/app: doc lai ca lich + dem nguoc (co the da lo tin WebSocket
    // luc an), khong chi trang thai thiet bi - card tu dung, khong reload trang.
    const onVisibility = () => (document.visibilityState === "visible" ? (reload(), reloadTimers(), start()) : stop());
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshEntityStates, reload, reloadTimers]);

  // Gop nhieu tin WS lien tiep (vd 12 lich cung gio -> 12 schedule_executed)
  // thanh 1 lan tai lai du lieu sau 300ms - do thuc te v0.5.53: truoc day 12 lan
  // reload song song (schedules + entities) moi lan.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadSoon = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      reload();
    }, 300);
  }, [reload]);

  useWebSocket(
    useCallback(
      (msg) => {
        if (draggingRef.current) return; // xem ghi chu o draggingRef phia tren
        if (["schedule_updated", "schedule_deleted", "schedule_executed"].includes(msg.event)) {
          reloadSoon();
        }
        if (msg.event === "ws_reconnected") {
          reload();
          reloadTimers();
        }
        if (msg.event === "auto_off_updated") {
          // Doc lai ca trang thai thiet bi: thanh dem nguoc can "dang bat" +
          // moc bat, 2 nguon khac nhau - khong doi poll 8s (het lech "● On" khi da tat).
          reloadTimers();
          refreshEntityStates();
        }
        if (["manual_timer_started", "manual_timer_finished"].includes(msg.event)) {
          reloadTimers();
          reload();
        }
        if (msg.event === "groups_updated") {
          reloadCategoryGroups();
        }
        if (msg.event === "presence_updated") {
          setPresence(msg.data as PresenceStatus);
        }
      },
      [reload, reloadSoon, reloadTimers, reloadCategoryGroups, refreshEntityStates],
    ),
  );

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  // Lich "Tu tat sau khi bat" hien rieng thanh 1 danh sach tren Nha (AutoOffList), khong thanh card.
  // Dat mui gio hien thi NGAY trong render (khong doi useEffect) de lan ve dau da dung.
  setAppTimeZone(settings.timezone);
  const groups = useMemo(() => groupSchedules(schedules.filter((s) => s.trigger_type !== "auto_off"), entities), [schedules, entities]);
  const openDevice = useMemo(() => groups.find((g) => g.key === openDeviceKey) ?? null, [groups, openDeviceKey]);
  setAppLanguage(settings.language);

  if (!loaded) {
    return <div className="app-loading">{tr("Đang tải My Scheduler...", "Loading My Scheduler...")}</div>;
  }

  return (
    <div className="app">
      {openDevice ? (
        <DeviceDetail
          group={openDevice}
          entities={entities}
          settings={settings}
          allSchedules={schedules}
          onBack={() => goBack(true, () => setOpenDeviceKey(null))}
          reload={reload}
          activeTimers={activeTimers}
          reloadTimers={reloadTimers}
          setDragging={setDragging}
        />
      ) : (
        <main className="app-main">
          <div className="app-header">
            My Scheduler <span className="app-header__version">v{__APP_VERSION__}</span>
          </div>
          {tab === "home" && (
            <Home
              groups={groups}
              schedules={schedules}
              entities={entities}
              settings={settings}
              categoryGroups={categoryGroups}
              activeTimers={activeTimers}
              presence={presence}
              reload={reload}
              onOpenDevice={(g) => setOpenDeviceKey(g.key)}
              setDragging={setDragging}
            />
          )}
          {tab === "settings" && (
            <SettingsPage
              entities={entities}
              settings={settings}
              schedules={schedules}
              groups={groups}
              categoryGroups={categoryGroups}
              reloadCategoryGroups={reloadCategoryGroups}
              haConnected={haConnected}
              haConnectionMode={haConnectionMode}
              reload={reload}
              reloadPresence={reloadPresence}
            />
          )}
        </main>
      )}

      {!openDevice && (
        <nav className="app-tabbar" aria-label={tr("Điều hướng chính", "Main navigation")}>
          <button type="button" aria-current={tab === "home" ? "page" : undefined} className={tab === "home" ? "tab tab--active" : "tab"} onClick={() => setTab("home")}>
            <span aria-hidden="true"><Icon path={mdiHome} size={25} /></span>
            <span>{tr("Nhà", "Home")}</span>
          </button>
          <button type="button" aria-current={tab === "settings" ? "page" : undefined} className={tab === "settings" ? "tab tab--active" : "tab"} onClick={() => setTab("settings")}>
            <span aria-hidden="true"><Icon path={mdiCog} size={25} /></span>
            <span>{tr("Cài đặt", "Settings")}</span>
          </button>
        </nav>
      )}
    </div>
  );
}
