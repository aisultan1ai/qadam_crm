import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_URL, getAccessToken } from "@/api/client";

type WSMessage = { type: string; payload?: any };

export function useRealtimeUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    let ws: WebSocket | null = null;
    let pingTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      const token = getAccessToken();
      if (!token) return;
      const url = API_URL.replace(/^http/, "ws") + `/ws?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempts = 0;
        pingTimer = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25000);
      };

      ws.onmessage = (ev) => {
        let msg: WSMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "notification.new":
            qc.invalidateQueries({ queryKey: ["notifications"] });
            break;
          case "task.assigned":
          case "task.updated":
            qc.invalidateQueries({ queryKey: ["tasks"] });
            if (msg.payload?.task_id) {
              qc.invalidateQueries({ queryKey: ["task", msg.payload.task_id] });
            }
            break;
          case "task.comment":
            if (msg.payload?.task_id) {
              qc.invalidateQueries({ queryKey: ["task", msg.payload.task_id] });
            }
            break;
          case "pong":
            break;
        }
      };

      ws.onclose = () => {
        if (pingTimer !== null) clearInterval(pingTimer);
        pingTimer = null;
        if (stopped) return;
        attempts += 1;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts, 5));
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (pingTimer !== null) clearInterval(pingTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [qc]);
}
