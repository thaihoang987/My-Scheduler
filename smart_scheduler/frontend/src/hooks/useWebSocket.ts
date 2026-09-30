import { useEffect, useRef } from "react";

export interface WSMessage {
  event: string;
  data: unknown;
}

/** Ket noi WebSocket toi backend, tu reconnect khi mat ket noi (khong dua
 * vao trinh duyet lam scheduler - day chi la kenh cap nhat UI realtime). */
export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let retryDelay = 1000;
    let everOpened = false;

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}${location.pathname.replace(/\/$/, "")}/ws`);
      ws.onmessage = (ev) => {
        try {
          cbRef.current(JSON.parse(ev.data));
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onopen = () => {
        retryDelay = 1000;
        // Noi lai sau khi rot (khoa man hinh, mat mang...) -> co the da lo tin
        // "lich vua chay" -> bao App doc lai du lieu (khong reload trang).
        if (everOpened) cbRef.current({ event: "ws_reconnected", data: null });
        everOpened = true;
      };
      ws.onclose = () => {
        if (closedByUs) return;
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      };
    }

    connect();
    return () => {
      closedByUs = true;
      ws?.close();
    };
  }, []);
}
