/**
 * «Хроника» — личная лента: что происходит там, где вы участвуете
 * (ваши задачи и проекты, назначенные вам лиды). Свои действия и служебные события
 * (вход в систему и т.п.) сюда не попадают. У каждого события — «Прочитано» и «Лайк»,
 * клик по карточке открывает объект.
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, CheckCheck } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/lib/Button";
import { PageHeader, Tabs } from "@/components/page";
import { EmptyState, Loader } from "@/components/ui";
import { FeedRow, useFeedActions, type FeedItem, type FeedPage } from "@/components/ActivityFeed";

type Tab = "unread" | "all";
const PER_PAGE = 100;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Сегодня";
  if (same(d, yesterday)) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function groupByDay(items: FeedItem[]): { day: string; items: FeedItem[] }[] {
  const groups: { day: string; items: FeedItem[] }[] = [];
  for (const it of items) {
    const day = dayLabel(it.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }
  return groups;
}

export default function ActivityPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const actions = useFeedActions();
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get("tab") === "all" ? "all" : "unread";

  const queryKey = ["activity-feed", tab] as const;
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: async () =>
      (await api.get<FeedPage>("/api/activity/feed", { params: { tab, per_page: PER_PAGE } })).data,
    refetchInterval: 60_000,
  });

  const groups = useMemo(() => groupByDay(data?.items ?? []), [data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["activity-feed"] });

  const readAll = useMutation({
    mutationFn: async () => (await api.post("/api/activity/feed/read-all")).data,
    onSuccess: refresh,
    onError: (e) => toast.error("Не удалось отметить", extractApiError(e).message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Главная"
        title="Хроника"
        subtitle="Что происходит в ваших задачах, проектах и лидах"
        actions={
          <Button
            variant="secondary"
            leftIcon={<CheckCheck size={16} />}
            onClick={() => readAll.mutate()}
            disabled={readAll.isPending || !data?.unread}
          >
            Прочитать все
          </Button>
        }
      />

      <Tabs<Tab>
        label="Фильтр ленты"
        value={tab}
        onChange={(k) => setSp(k === "unread" ? {} : { tab: k }, { replace: true })}
        items={[
          { key: "unread", label: "Новое", count: data?.unread },
          { key: "all", label: "Все" },
        ]}
      />

      {isPending ? (
        <Loader />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon size={32} />}
          title={tab === "unread" ? "Нового нет" : "Пока пусто"}
          description={
            tab === "unread"
              ? "Вы в курсе всего. Здесь появятся комментарии, новые задачи, смена сроков и новые лиды."
              : "Когда в ваших задачах и проектах что-то произойдёт — события появятся здесь."
          }
        />
      ) : (
        groups.map((g) => (
          <div key={g.day}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{g.day}</div>
            <div className="card divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800">
              {g.items.map((it) => (
                <FeedRow
                  key={it.id}
                  it={it}
                  onOpen={() => actions.open(it)}
                  onToggleRead={() => actions.toggleRead(it)}
                  onToggleLike={() => actions.toggleLike(it)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

