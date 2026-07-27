import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_URL } from "@/api/client";
import { useAuth } from "@/store/auth";

type WSMessage = { type: string; payload?: { task_id?: number } };

export function useRealtimeUpdates() {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.me?.id ?? null);

  useEffect(() => {
    if (!meId) return;

    let ws: WebSocket | null = null;
    let pingTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      // Токен читается backend'ом из httpOnly cookie (auto-sent на same-origin handshake).
      // Cookie должна быть на том же origin, что и WS — nginx проксирует /ws на backend,
      // so это работает out-of-the-box.
      const url = API_URL.replace(/^http/, "ws") + "/ws";
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempts = 0;
        pingTimer = window.setInterval(
          () => ws?.readyState === WebSocket.OPEN && ws.send("ping"),
          25000,
        );
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
  }, [qc, meId]);
}
