import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Activity as ActivityIcon, Plus, Pencil, Trash2, Archive, MessageSquare, CheckCircle2 } from "lucide-react";
import { Avatar, EmptyState } from "@/components/ui";
import type { Page } from "@/types";
import { fromNow } from "@/lib/date";

type Actor = { id: number; name: string; avatar_url?: string | null };

type ActivityItem = {
  id: number;
  action: string;
  entity?: string | null;
  entity_id?: number | null;
  task_id?: number | null;
  detail?: string | null;
  created_at: string;
  user?: Actor | null;
};

const ACTION_META: Record<string, { icon: typeof Plus; verb: string; color: string }> = {
  create: { icon: Plus, verb: "создал(а)", color: "text-emerald-600" },
  update: { icon: Pencil, verb: "обновил(а)", color: "text-sky-600" },
  delete: { icon: Trash2, verb: "удалил(а)", color: "text-rose-600" },
  archive: { icon: Archive, verb: "архивировал(а)", color: "text-amber-600" },
  unarchive: { icon: Archive, verb: "вернул(а) из архива", color: "text-amber-600" },
  bulk_update: { icon: Pencil, verb: "массово обновил(а)", color: "text-sky-600" },
};

const DEFAULT_META = { icon: ActivityIcon, verb: "", color: "text-neutral-600" };

const ENTITY_LABEL: Record<string, string> = {
  task: "задачу",
  project: "проект",
  comment: "комментарий",
  contact: "контакт",
  company: "компанию",
  lead: "лид",
  deal: "сделку",
  wiki_article: "статью",
};

function entityLink(item: ActivityItem): string | null {
  if (item.task_id) return `/tasks/${item.task_id}`;
  if (item.entity === "project" && item.entity_id) return `/projects/${item.entity_id}`;
  if (item.entity === "contact" && item.entity_id) return `/contacts`;
  if (item.entity === "company" && item.entity_id) return `/contacts`;
  return null;
}

function groupByDay(items: ActivityItem[]): { day: string; items: ActivityItem[] }[] {
  const map: Record<string, ActivityItem[]> = {};
  items.forEach((it) => {
    const day = new Date(it.created_at).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    (map[day] ||= []).push(it);
  });
  return Object.entries(map).map(([day, items]) => ({ day, items }));
}

export default function ActivityPage() {
  const { data, isPending } = useQuery({
    queryKey: ["activity"],
    queryFn: async () =>
      (await api.get<Page<ActivityItem>>("/api/activity", { params: { per_page: 200 } })).data.items,
  });

  const groups = useMemo(() => groupByDay(data || []), [data]);

  if (isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<ActivityIcon size={32} />}
        title="Хроника пуста"
        description="Как только начнётся работа в системе — события появятся здесь"
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Хроника</h1>
        <p className="page-subtitle">События по всем сущностям компании</p>
      </div>

      {groups.map((g) => (
        <div key={g.day}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {g.day}
          </div>
          <div className="space-y-1 card">
            {g.items.map((it) => {
              const meta = ACTION_META[it.action] || DEFAULT_META;
              const Icon = meta.icon;
              const link = entityLink(it);
              const entityWord = it.entity ? ENTITY_LABEL[it.entity] || it.entity : "";
              const body = (
                <div className="flex items-start gap-3 p-3">
                  <div className={`mt-0.5 shrink-0 ${meta.color}`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Avatar name={it.user?.name} url={it.user?.avatar_url} size={20} />
                      <div className="min-w-0 flex-1 text-sm">
                        <span className="font-medium">{it.user?.name || "Система"}</span>{" "}
                        <span className="text-neutral-600 dark:text-neutral-400">
                          {meta.verb} {entityWord}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs text-neutral-500" title={new Date(it.created_at).toLocaleString("ru-RU")}>
                        {fromNow(it.created_at)}
                      </span>
                    </div>
                    {it.detail && (
                      <div className="ml-7 mt-0.5 line-clamp-2 text-xs text-neutral-500">
                        {it.detail}
                      </div>
                    )}
                  </div>
                </div>
              );
              return link ? (
                <Link key={it.id} to={link} className="block border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40">
                  {body}
                </Link>
              ) : (
                <div key={it.id} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-800">
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
