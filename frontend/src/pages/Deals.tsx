import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, extractApiError } from "@/api/client";
import { Plus, Trash2, Pencil, Coins, TrendingUp } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { EmptyState, Modal, Avatar, FormError } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import type { Page } from "@/types";

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

const STAGE_HEADER: Record<DealStage, string> = {
  new: "bg-pink-500 text-white",
  qualified: "bg-purple-500 text-white",
  proposal: "bg-sky-500 text-white",
  negotiation: "bg-amber-500 text-white",
  won: "bg-emerald-500 text-white",
  lost: "bg-neutral-500 text-white",
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

  const grouped = useMemo(() => {
    const map: Record<DealStage, Deal[]> = {
      new: [], qualified: [], proposal: [], negotiation: [], won: [], lost: [],
    };
    (deals || []).forEach((d) => (map[d.stage] ||= []).push(d));
    return map;
  }, [deals]);

  if (!canView) {
    return <EmptyState icon={<Coins size={32} />} title="Нет доступа к сделкам" description="Обратитесь к администратору за правом deals.view" />;
  }

  const currency = forecast?.currency || "KZT";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Сделки</h1>
          <p className="text-sm text-neutral-500">Воронка продаж</p>
        </div>
        {canCreate && (
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setOpenDeal("new")}>
            Новая сделка
          </Button>
        )}
      </div>

      {forecast && (
        <div className="grid gap-3 md:grid-cols-4">
          <ForecastCard label="В работе" value={fmtMoney(forecast.total_amount_cents, currency)} sub={`${forecast.open_count} шт.`} icon={<Coins size={16} />} />
          <ForecastCard label="Взвешенный прогноз" value={fmtMoney(forecast.weighted_amount_cents, currency)} sub="с учётом вероятности" icon={<TrendingUp size={16} />} accent />
          <ForecastCard label="Успешные" value={fmtMoney(forecast.won_amount_cents, currency)} sub={`${forecast.won_count} сделок`} icon={<TrendingUp size={16} />} />
          <ForecastCard label="Провальные" value={String(forecast.lost_count)} sub="закрыты неудачно" icon={<Coins size={16} />} />
        </div>
      )}

      {isPending ? (
        <div className="h-64 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {STAGE_ORDER.map((stage) => {
            const items = grouped[stage] || [];
            const stageTotal = items.reduce((s, d) => s + d.amount_cents, 0);
            return (
              <div key={stage} className="flex min-h-[220px] flex-col rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50">
                <div className={clsx("flex items-center justify-between rounded-t-lg px-3 py-2 text-sm font-semibold", STAGE_HEADER[stage])}>
                  <span>{STAGE_LABEL[stage]}</span>
                  <span className="text-xs opacity-90">{items.length}</span>
                </div>
                <div className="px-3 py-1 text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 tabular-nums">
                  {fmtMoney(stageTotal, currency)}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {items.map((d) => (
                    <div key={d.id} className="group rounded-md border border-neutral-200 bg-white p-2.5 text-sm shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-800/70">
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
                              className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] text-neutral-600 hover:border-brand-500 hover:text-brand-600 dark:border-neutral-700 dark:text-neutral-400"
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
    <div className={clsx("rounded-lg border p-3", accent ? "border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10" : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50")}>
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{label}</span>
        {icon}
      </div>
      <div className={clsx("mt-1 text-lg font-semibold tabular-nums", accent && "text-brand-700 dark:text-brand-300")}>{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
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
