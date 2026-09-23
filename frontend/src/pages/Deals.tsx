import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, extractApiError } from "@/api/client";
import { Plus, Trash2, Pencil, Coins, TrendingUp, KanbanSquare, List } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { EmptyState, Modal, Avatar, FormError } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import type { Page } from "@/types";

import { FilterSelect, PageHeader, SearchInput, Segmented, Tabs, Toolbar } from "@/components/page";
type UserBrief = { id: number; name: string; avatar_url?: string | null };

type DealStage = "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
type DealStatus = "open" | "won" | "lost";

type Deal = {
  id: number;
  title: string;
  amount_cents: number;
  currency: string;
  stage: DealStage;
  status: DealStatus;
  probability: number;
  close_date?: string | null;
  note?: string | null;
  owner?: UserBrief | null;
  contact_id?: number | null;
  company_id?: number | null;
  order_index: number;
  created_at: string;
};

type Forecast = {
  currency: string;
  total_amount_cents: number;
  weighted_amount_cents: number;
  won_amount_cents: number;
  open_count: number;
  won_count: number;
  lost_count: number;
  by_stage: Record<string, { count: number; amount_cents: number; weighted_amount_cents: number }>;
};

const STAGE_ORDER: DealStage[] = ["new", "qualified", "proposal", "negotiation", "won", "lost"];

const STAGE_LABEL: Record<DealStage, string> = {
  new: "Новый",
  qualified: "Квалифицирован",
  proposal: "Предложение",
  negotiation: "Переговоры",
  won: "Успех",
  lost: "Провал",
};

// Цвет этапа — только тонкая полоса сверху колонки; заголовок остаётся нейтральным.
const STAGE_HEADER: Record<DealStage, string> = {
  new: "border-t-indigo-500 dark:border-t-indigo-500",
  qualified: "border-t-violet-500 dark:border-t-violet-500",
  proposal: "border-t-sky-500 dark:border-t-sky-500",
  negotiation: "border-t-amber-500 dark:border-t-amber-500",
  won: "border-t-emerald-500 dark:border-t-emerald-500",
  lost: "border-t-zinc-400 dark:border-t-zinc-400",
};

const STAGE_PROBABILITY: Record<DealStage, number> = {
  new: 10,
  qualified: 25,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};

function fmtMoney(cents: number, currency: string) {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString("ru-RU")} ${currency}`;
  }
}

export default function DealsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [openDeal, setOpenDeal] = useState<Deal | "new" | null>(null);

  const canView = can("deals.view");
  const canCreate = can("deals.create");
  const canUpdate = can("deals.update");
  const canDelete = can("deals.delete");

  const { data: deals, isPending } = useQuery({
    queryKey: ["deals"],
    queryFn: async () => (await api.get<Page<Deal>>("/api/deals", { params: { per_page: 500 } })).data.items,
    enabled: canView,
  });
  const { data: forecast } = useQuery({
    queryKey: ["deals-forecast"],
    queryFn: async () => (await api.get<Forecast>("/api/deals/forecast")).data,
    enabled: canView,
  });

  const changeStage = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: DealStage }) => api.patch(`/api/deals/${id}`, { stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["deals"] });
      const snap = qc.getQueryData<Deal[]>(["deals"]);
      qc.setQueryData<Deal[]>(["deals"], (prev) => (prev || []).map((d) => (d.id === id ? { ...d, stage, probability: STAGE_PROBABILITY[stage] } : d)));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(["deals"], ctx.snap);
      toast.error("Не удалось перевести", extractApiError(e).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["deals-forecast"] });
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/deals/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["deals-forecast"] });
      toast.success("Сделка удалена");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [statusTab, setStatusTab] = useState<"all" | "open" | "won" | "lost">("all");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");

  const owners = useMemo(() => {
    const m = new Map<number, string>();
    (deals || []).forEach((d) => d.owner && m.set(d.owner.id, d.owner.name));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [deals]);

  const counts = useMemo(() => {
    const c = { all: 0, open: 0, won: 0, lost: 0 };
    (deals || []).forEach((d) => {
      c.all += 1;
      if (d.stage === "won") c.won += 1;
      else if (d.stage === "lost") c.lost += 1;
      else c.open += 1;
    });
    return c;
  }, [deals]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (deals || []).filter((d) => {
      if (statusTab === "open" && (d.stage === "won" || d.stage === "lost")) return false;
      if (statusTab === "won" && d.stage !== "won") return false;
      if (statusTab === "lost" && d.stage !== "lost") return false;
      if (owner && String(d.owner?.id ?? "") !== owner) return false;
      if (needle && !d.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [deals, statusTab, owner, q]);

  const grouped = useMemo(() => {
    const map: Record<DealStage, Deal[]> = {
      new: [], qualified: [], proposal: [], negotiation: [], won: [], lost: [],
    };
    filtered.forEach((d) => (map[d.stage] ||= []).push(d));
    return map;
  }, [filtered]);

  const askDelete = (d: Deal) =>
    confirm({
      title: "Удалить сделку?",
      message: `«${d.title}» будет удалена.`,
      danger: true,
      confirmLabel: "Удалить",
      onConfirm: () => del.mutateAsync(d.id),
    });

  if (!canView) {
    return <EmptyState icon={<Coins size={32} />} title="Нет доступа к сделкам" description="Обратитесь к администратору за правом deals.view" />;
  }

  const currency = forecast?.currency || "KZT";

  const stageTone: Record<DealStage, string> = {
    new: "bg-indigo-500",
    qualified: "bg-violet-500",
    proposal: "bg-sky-500",
    negotiation: "bg-amber-500",
    won: "bg-emerald-500",
    lost: "bg-zinc-400",
  };
  const today = new Date().setHours(0, 0, 0, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Сделки"
        subtitle="Воронка продаж и все сделки компании"
        actions={
          canCreate && (
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setOpenDeal("new")}>
              Новая сделка
            </Button>
          )
        }
      />

      {forecast && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 lg:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-800">
          <ForecastCard label="В работе" value={fmtMoney(forecast.total_amount_cents, currency)} sub={`${forecast.open_count} сделок`} icon={<Coins size={16} />} />
          <ForecastCard label="Взвешенный прогноз" value={fmtMoney(forecast.weighted_amount_cents, currency)} sub="с учётом вероятности" icon={<TrendingUp size={16} />} accent />
          <ForecastCard label="Выиграно" value={fmtMoney(forecast.won_amount_cents, currency)} sub={`${forecast.won_count} сделок`} icon={<TrendingUp size={16} />} />
          <ForecastCard label="Проиграно" value={String(forecast.lost_count)} sub="закрыты неудачно" icon={<Coins size={16} />} />
        </div>
      )}

      <Tabs
        label="Статус сделок"
        value={statusTab}
        onChange={setStatusTab}
        items={[
          { key: "all", label: "Все", count: counts.all },
          { key: "open", label: "Открытые", count: counts.open },
          { key: "won", label: "Выигранные", count: counts.won },
          { key: "lost", label: "Проигранные", count: counts.lost },
        ]}
      />

      <Toolbar
        right={
          <Segmented
            label="Вид"
            value={view}
            onChange={setView}
            items={[
              { key: "kanban", label: "Канбан", icon: KanbanSquare },
              { key: "table", label: "Таблица", icon: List },
            ]}
          />
        }
      >
        <SearchInput value={q} onChange={setQ} placeholder="Поиск по названию сделки" />
        <FilterSelect label="Ответственный" value={owner} onChange={setOwner}>
          <option value="">Все ответственные</option>
          {owners.map((o) => (
            <option key={o.id} value={String(o.id)}>
              {o.name}
            </option>
          ))}
        </FilterSelect>
        {(q || owner) && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setOwner(""); }}>
            Сбросить
          </Button>
        )}
      </Toolbar>

      {isPending ? (
        <div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-[#1B1F26]" />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Coins size={20} />}
            title={deals && deals.length > 0 ? "По фильтру ничего не найдено" : "Сделок пока нет"}
            description={deals && deals.length > 0 ? "Измените поиск или сбросьте фильтры." : "Создайте первую сделку — она появится в воронке."}
            action={
              canCreate && !(deals && deals.length > 0) ? (
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setOpenDeal("new")}>
                  Новая сделка
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : view === "kanban" ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {STAGE_ORDER.map((stage) => {
              const items = grouped[stage] || [];
              const stageTotal = items.reduce((s, d) => s + d.amount_cents, 0);
              return (
                <div key={stage} className={clsx("flex min-h-[220px] flex-col rounded-lg border border-t-2 border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-[#14171C]", STAGE_HEADER[stage])}>
                  <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    <span>{STAGE_LABEL[stage]}</span>
                    <span className="rounded bg-zinc-200/70 px-1.5 text-xs font-medium tabular-nums text-zinc-600 dark:bg-[#1B1F26] dark:text-zinc-400">{items.length}</span>
                  </div>
                  <div className="px-3 py-1 text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 tabular-nums">
                    {fmtMoney(stageTotal, currency)}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    {items.map((d) => (
                      <div key={d.id} className="group rounded-md border border-zinc-200 bg-white p-2.5 text-sm transition-[border-color,box-shadow] hover:border-zinc-300 hover:shadow-pop dark:border-zinc-800 dark:bg-[#1B1F26]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 font-medium">{d.title}</div>
                          <div className="opacity-0 transition-opacity group-hover:opacity-100 flex gap-0.5">
                            {canUpdate && (
                              <Button variant="ghost" size="icon" onClick={() => setOpenDeal(d)} title="Редактировать">
                                <Pencil size={12} />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-rose-500"
                                onClick={() =>
                                  confirm({
                                    title: "Удалить сделку?",
                                    message: `«${d.title}» будет удалена.`,
                                    danger: true,
                                    confirmLabel: "Удалить",
                                    onConfirm: () => del.mutateAsync(d.id),
                                  })
                                }
                              >
                                <Trash2 size={12} />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span className="font-semibold text-brand-700 dark:text-brand-300 tabular-nums">{fmtMoney(d.amount_cents, d.currency)}</span>
                          <span className="text-neutral-500">{d.probability}%</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                          {d.owner && <Avatar name={d.owner.name} url={d.owner.avatar_url} size={18} />}
                          {d.close_date && <span className="tabular-nums">{new Date(d.close_date).toLocaleDateString("ru-RU")}</span>}
                        </div>
                        {canUpdate && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {STAGE_ORDER.filter((s) => s !== d.stage).slice(0, 3).map((s) => (
                              <button
                                key={s}
                                className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-[10px] text-neutral-600 hover:border-brand-500 hover:text-brand-600 dark:border-neutral-700 dark:text-neutral-400"
                                onClick={() => changeStage.mutate({ id: d.id, stage: s })}
                                title={`Перевести в «${STAGE_LABEL[s]}»`}
                              >
                                → {STAGE_LABEL[s]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {items.length === 0 && (
                      <div className="py-3 text-center text-xs text-neutral-400">Пусто</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
      ) : (
        <div className="table-container table-scroll">
          <table className="w-full min-w-[760px]">
            <thead className="table-head">
              <tr>
                <th className="table-head-cell">Сделка</th>
                <th className="table-head-cell">Этап</th>
                <th className="table-head-cell">Ответственный</th>
                <th className="table-head-cell text-right">Сумма</th>
                <th className="table-head-cell text-right">Вероятность</th>
                <th className="table-head-cell">Срок</th>
                <th className="table-head-cell w-20" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const overdue = !!d.close_date && new Date(d.close_date).getTime() < today && d.stage !== "won" && d.stage !== "lost";
                return (
                  <tr key={d.id} className="table-row group">
                    <td className="table-cell">
                      <button
                        type="button"
                        className="text-left font-medium text-zinc-900 hover:text-brand-700 dark:text-zinc-100 dark:hover:text-brand-300"
                        onClick={() => canUpdate && setOpenDeal(d)}
                      >
                        {d.title}
                      </button>
                    </td>
                    <td className="table-cell">
                      <span className="inline-flex items-center gap-2">
                        <span className={clsx("h-2 w-2 rounded-sm", stageTone[d.stage])} />
                        {STAGE_LABEL[d.stage]}
                      </span>
                    </td>
                    <td className="table-cell">
                      {d.owner ? (
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={d.owner.name} url={d.owner.avatar_url} size={22} />
                          {d.owner.name}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="table-cell text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                      {fmtMoney(d.amount_cents, d.currency)}
                    </td>
                    <td className="table-cell text-right tabular-nums">{d.probability}%</td>
                    <td className={clsx("table-cell tabular-nums", overdue && "font-medium text-rose-600 dark:text-rose-400")}>
                      {d.close_date ? new Date(d.close_date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "—"}
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {canUpdate && (
                          <Button variant="ghost" size="icon" onClick={() => setOpenDeal(d)} aria-label="Редактировать сделку">
                            <Pencil size={14} />
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon" className="text-rose-600" onClick={() => askDelete(d)} aria-label="Удалить сделку">
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openDeal && (
        <DealModal
          initial={openDeal === "new" ? null : openDeal}
          onClose={() => setOpenDeal(null)}
        />
      )}
    </div>
  );
}

function ForecastCard({ label, value, sub, icon, accent }: { label: string; value: string; sub?: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className="bg-white p-5 dark:bg-[#14171C]">
      <div className="flex items-center justify-between text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        <span className={accent ? "text-brand-600 dark:text-brand-400" : undefined}>{icon}</span>
      </div>
      <div className={clsx("mt-3 text-xl font-semibold tabular-nums tracking-tight", accent && "text-brand-700 dark:text-brand-300")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const dealModalSchema = z.object({
  title: z.string().trim().min(2, "Минимум 2 символа").max(200),
  amount: z.coerce.number().min(0, "Не может быть отрицательным"),
  currency: z.enum(["KZT", "USD", "EUR", "RUB"]).default("KZT"),
  stage: z.enum(["new", "qualified", "proposal", "negotiation", "won", "lost"]).default("new"),
  probability: z.coerce.number().int().min(0).max(100).default(50),
  close_date: z.string().optional(),
  note: z.string().max(5000).optional(),
});
type DealModalForm = z.infer<typeof dealModalSchema>;

function DealModal({ initial, onClose }: { initial: Deal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DealModalForm>({
    resolver: zodResolver(dealModalSchema),
    defaultValues: {
      title: initial?.title || "",
      amount: initial ? initial.amount_cents / 100 : 0,
      currency: (initial?.currency as any) || "KZT",
      stage: initial?.stage || "new",
      probability: initial?.probability ?? STAGE_PROBABILITY[initial?.stage || "new"],
      close_date: initial?.close_date || "",
      note: initial?.note || "",
    },
  });
  const currentStage = watch("stage");

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    const body = {
      title: data.title,
      amount_cents: Math.round(data.amount * 100),
      currency: data.currency,
      stage: data.stage,
      probability: data.probability,
      close_date: data.close_date || null,
      note: data.note || null,
    };
    try {
      if (initial) await api.patch(`/api/deals/${initial.id}`, body);
      else await api.post(`/api/deals`, body);
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["deals-forecast"] });
      onClose();
    } catch (e) {
      setServerError(extractApiError(e).message);
    }
  });

  return (
    <Modal open onClose={onClose} title={initial ? "Редактировать сделку" : "Новая сделка"} size="md">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormField label="Название" required error={errors.title?.message}>
          <input className="input" autoFocus {...register("title")} />
        </FormField>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Сумма" error={errors.amount?.message} className="col-span-2">
            <input className="input tabular-nums" type="number" step="0.01" {...register("amount", { valueAsNumber: true })} />
          </FormField>
          <FormField label="Валюта" error={errors.currency?.message}>
            <select className="input" {...register("currency")}>
              <option value="KZT">KZT</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="RUB">RUB</option>
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Стадия" error={errors.stage?.message}>
            <select
              className="input"
              value={currentStage}
              onChange={(e) => {
                const s = e.target.value as DealStage;
                setValue("stage", s, { shouldDirty: true });
                setValue("probability", STAGE_PROBABILITY[s], { shouldDirty: true });
              }}
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Вероятность %" error={errors.probability?.message}>
            <input
              className="input tabular-nums"
              type="number"
              min={0}
              max={100}
              {...register("probability", { valueAsNumber: true })}
            />
          </FormField>
        </div>
        <FormField label="Дата закрытия" error={errors.close_date?.message}>
          <input className="input" type="date" {...register("close_date")} />
        </FormField>
        <FormField label="Заметка" error={errors.note?.message}>
          <textarea className="input min-h-[80px]" {...register("note")} />
        </FormField>
        <FormError msg={serverError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            {initial ? "Сохранить" : "Создать"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
