import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Plus, Trash2, Pencil, Coins, TrendingUp } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { EmptyState, Modal, Avatar, FieldError, FormError } from "@/components/ui";
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
          <button className="btn-primary" onClick={() => setOpenDeal("new")}>
            <Plus size={16} /> Новая сделка
          </button>
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
                            <button className="btn-ghost !p-1" onClick={() => setOpenDeal(d)} title="Редактировать">
                              <Pencil size={12} />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              className="btn-ghost !p-1 text-rose-500"
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
                            </button>
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

function DealModal({ initial, onClose }: { initial: Deal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState(initial?.title || "");
  const [amount, setAmount] = useState(initial ? String(initial.amount_cents / 100) : "0");
  const [currency, setCurrency] = useState(initial?.currency || "KZT");
  const [stage, setStage] = useState<DealStage>(initial?.stage || "new");
  const [probability, setProbability] = useState<number>(initial?.probability ?? STAGE_PROBABILITY[stage]);
  const [closeDate, setCloseDate] = useState(initial?.close_date || "");
  const [note, setNote] = useState(initial?.note || "");

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        amount_cents: Math.round(parseFloat(amount || "0") * 100),
        currency,
        stage,
        probability,
        close_date: closeDate || null,
        note: note || null,
      };
      if (initial) return api.patch(`/api/deals/${initial.id}`, body);
      return api.post(`/api/deals`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["deals-forecast"] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  const invalid = !title.trim();

  return (
    <Modal open onClose={onClose} title={initial ? "Редактировать сделку" : "Новая сделка"} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate();
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название *</span>
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          <FieldError msg={invalid ? "Обязательно" : undefined} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Сумма</span>
            <input className="input tabular-nums" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Валюта</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="KZT">KZT</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="RUB">RUB</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Стадия</span>
            <select
              className="input"
              value={stage}
              onChange={(e) => {
                const s = e.target.value as DealStage;
                setStage(s);
                setProbability(STAGE_PROBABILITY[s]);
              }}
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Вероятность %</span>
            <input className="input tabular-nums" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(Number(e.target.value))} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Дата закрытия</span>
          <input className="input" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Заметка</span>
          <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={invalid || save.isPending}>
            {initial ? "Сохранить" : "Создать"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
