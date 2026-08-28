import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_URL } from "@/api/client";
import { useAuth } from "@/store/auth";

let activeWs: WebSocket | null = null;

function sendWs(text: string) {
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    activeWs.send(text);
  }
}

export function subscribeChannel(channelId: number) {
  sendWs(`sub:channel:${channelId}`);
}

export function unsubscribeChannel(channelId: number) {
  sendWs(`unsub:channel:${channelId}`);
}

type WSMessage = {
  type: string;
  payload?: {
    task_id?: number;
    channel_id?: number;
    message_id?: number;
    message?: unknown;
    poll?: unknown;
    emoji?: string;
    user_id?: number;
    [key: string]: unknown;
  };
};

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
      activeWs = ws;

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
          case "lead.new":
          case "lead.update":
            qc.invalidateQueries({ queryKey: ["tenant-leads"] });
            break;
          case "message.new": {
            const cid = msg.payload?.channel_id;
            if (cid) {
              qc.invalidateQueries({ queryKey: ["messenger", "messages", cid], exact: true });
              // Обновляем sidebar точечно: last_message_at, preview, unread++
              qc.setQueryData<Array<Record<string, unknown>>>(["messenger", "channels"], (old) => {
                if (!old) return old;
                const message = (msg.payload?.message as Record<string, unknown> | undefined) ?? undefined;
                const body = message ? String((message.body as string) || "") : "";
                const preview = body.slice(0, 120) + (body.length > 120 ? "…" : "");
                const now = new Date().toISOString();
                return old.map((c) =>
                  (c.id as number) === cid
                    ? {
                        ...c,
                        last_message_at: now,
                        last_message_preview: preview || (c.last_message_preview as string),
                        // unread инкрементим только если не сам автор (сервер уже обеспечит согласованность через кеш)
                        unread_count: (c.unread_count as number) + 1,
                      }
                    : c,
                );
              });
            }
            break;
          }
          case "message.edit":
          case "message.delete":
          case "reaction.add":
          case "reaction.remove":
          case "poll.create":
          case "poll.vote":
          case "poll.close": {
            const cid = msg.payload?.channel_id;
            if (cid) {
              qc.invalidateQueries({ queryKey: ["messenger", "messages", cid], exact: true });
            }
            break;
          }
          case "read.receipt": {
            const cid = msg.payload?.channel_id;
            // Для собственных ридов уже обнулили локально; для чужих — обновляем receipts (пока не хранятся).
            if (cid) {
              qc.invalidateQueries({ queryKey: ["messenger", "channel", cid], exact: true });
            }
            break;
          }
          case "messenger.unread": {
            // Сервер шлёт один broadcast с массивом user_ids — фильтруем свой.
            const cid = msg.payload?.channel_id;
            const targets = (msg.payload?.user_ids as number[] | undefined) || [];
            if (!cid || (targets.length && meId !== null && !targets.includes(meId))) break;
            qc.setQueryData<Array<Record<string, unknown>>>(["messenger", "channels"], (old) => {
              if (!old) return old;
              return old.map((c) =>
                (c.id as number) === cid ? { ...c, unread_count: (c.unread_count as number) + 1 } : c,
              );
            });
            break;
          }
          case "channel.new":
          case "channel.updated":
          case "channel.deleted":
            qc.invalidateQueries({ queryKey: ["messenger", "channels"], exact: true });
            break;
          case "messenger.message.new": {
            // Открытые линии (Telegram/WhatsApp/Instagram): новое входящее сообщение.
            // Инвалидируем и список conversations, и messages конкретного разговора.
            qc.invalidateQueries({ queryKey: ["messenger-convs"] });
            const convId = msg.payload?.conversation_id as number | undefined;
            if (convId) {
              qc.invalidateQueries({ queryKey: ["messenger-messages", convId] });
            }
            break;
          }
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
      activeWs = null;
    };
  }, [qc, meId]);
}
