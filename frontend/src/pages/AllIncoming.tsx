/**
 * «Все входящие»: одна лента из уведомлений, писем своего ящика и сообщений клиентов (открытые линии).
 * Источники, на которые у сотрудника нет права, сервер не отдаёт — фильтр по ним тоже скрыт.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Inbox as InboxIcon, Mail, MessagesSquare } from "lucide-react";
import clsx from "clsx";

import { api } from "@/api/client";
import { EmptyState } from "@/components/ui";
import { Skeleton } from "@/components/Skeleton";
import { Tabs } from "@/components/page";
import { fromNow } from "@/lib/date";

type Source = "all" | "notifications" | "mail" | "clients";
type Item = {
  key: string;
  source: Exclude<Source, "all">;
  id: number;
  title: string;
  preview?: string | null;
  channel?: string | null;
  at?: string | null;
  unread: number;
  url: string;
};
type Feed = { items: Item[]; sources: Record<Exclude<Source, "all">, boolean> };

const SOURCE_META: Record<Item["source"], { label: string; icon: typeof Bell }> = {
  notifications: { label: "Уведомление", icon: Bell },
  mail: { label: "Почта", icon: Mail },
  clients: { label: "Клиент", icon: MessagesSquare },
};

export default function AllIncoming() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [source, setSource] = useState<Source>("all");
  const [unread, setUnread] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["incoming", source, unread],
    queryFn: async () => (await api.get<Feed>("/api/incoming", { params: { source, unread } })).data,
    refetchInterval: 60_000,
  });

  const open = async (it: Item) => {
    if (it.source === "notifications" && it.unread) {
      try {
        await api.post(`/api/notifications/${it.id}/read`);
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["incoming"] });
      } catch {
        /* открыть всё равно */
      }
    }
    nav(it.url);
  };

  const s = data?.sources;
  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="min-w-0">
          <div className="mb-0.5 text-[12px] text-zinc-500">Входящие</div>
          <h1 className="page-title">Все входящие</h1>
          <p className="page-subtitle">Уведомления, письма и сообщения клиентов в одной ленте</p>
        </div>
        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5">
          <input type="checkbox" className="accent-brand-600" checked={unread} onChange={(e) => setUnread(e.target.checked)} />
          Только непрочитанные
        </label>
      </div>

      <Tabs
        label="Источник"
        size="sm"
        value={source}
        onChange={setSource}
        items={[
          { key: "all", label: "Все" },
          { key: "notifications", label: "Уведомления" },
          { key: "mail", label: "Почта", hidden: s ? !s.mail : false },
          { key: "clients", label: "Клиенты", hidden: s ? !s.clients : false },
        ]}
      />

      {isPending ? (
        <div className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={32} />}
          title={unread ? "Непрочитанного нет" : "Пока пусто"}
          description={unread ? "Всё прочитано. Снимите фильтр, чтобы увидеть всю ленту." : "Здесь появятся уведомления, письма и сообщения клиентов."}
        />
      ) : (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {data.items.map((it) => {
            const meta = SOURCE_META[it.source];
            const Icon = meta.icon;
            return (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={() => open(it)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-white/[0.03]"
                >
                  <span
                    className={clsx(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                      it.unread ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "bg-zinc-100 text-zinc-500 dark:bg-white/5",
                    )}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block truncate text-[13px]", it.unread ? "font-semibold text-zinc-900 dark:text-white" : "text-zinc-700 dark:text-zinc-300")}>
                      {it.title}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {[it.source === "clients" ? it.channel ?? meta.label : meta.label, it.preview].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {it.at && <span className="text-xs tabular-nums text-zinc-400">{fromNow(it.at)}</span>}
                    {it.unread > 0 && it.source !== "notifications" && (
                      <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-[18px] text-white tabular-nums">{it.unread}</span>
                    )}
                    {it.unread > 0 && it.source === "notifications" && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Не прочитано" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
