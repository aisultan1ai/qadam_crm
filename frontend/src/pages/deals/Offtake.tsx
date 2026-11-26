/**
 * Раздел «Offtake контракты» (/deals при включённом offtake вместо обычной воронки продаж).
 *
 * - график «Законтрактованный объём по годам» (подписанные контракты, т/год по годам поставки);
 * - канбан из 8 стадий с перетаскиванием и таблица;
 * - карточка offtake-контракта: продукт, объёмы, цена, Incoterms, документы.
 *
 * Правила стадий проверяет сервер: в «NDA подписан» и дальше — только с файлом NDA,
 * в «Term Sheet согласован» и дальше — с файлом Term Sheet; «Отказ» — с причиной.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import {
  Copy, Download, FileSignature, FileText, KanbanSquare, List, Mail, Pencil, Plus, Sparkles, Trash2, Upload,
} from "lucide-react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { Avatar, EmptyState, FormError, Modal } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { DatePicker } from "@/components/DatePicker";
import { RecordPicker } from "@/components/RecordPicker";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { FilterSelect, SearchInput, Segmented, Tabs, Toolbar } from "@/components/page";
import { useAuth } from "@/store/auth";
import { useAi } from "@/hooks/useAi";
import { legalEntityOptions, useLegalEntities, type LegalEntityBrief } from "@/hooks/useLegalEntities";
import {
  useOfftakeProducts, useOfftakeSettings, type OfftakeProduct, type OfftakeSettings, type OfftakeStage,
} from "@/hooks/useOfftake";
import type { Page } from "@/types";

export type OfftakeDeal = {
  id: number;
  title: string;
  amount_cents: number;
  currency: string;
  status: "open" | "won" | "lost";
  probability: number;
  probability_manual: boolean;
  close_date?: string | null;
  note?: string | null;
  owner?: { id: number; name: string; avatar_url?: string | null } | null;
  company_id?: number | null;
  company?: { id: number; name: string } | null;
  legal_entity_id?: number | null;
  legal_entity?: LegalEntityBrief | null;
  pipeline: string;
  offtake_stage?: OfftakeStage | null;
  loss_reason?: string | null;
  loss_comment?: string | null;
  product_id?: number | null;
  product?: { id: number; name: string } | null;
  volume_tpy?: number | null;
  term_years?: number | null;
  start_year?: number | null;
  total_volume?: number | null;
  price_type?: "fixed" | "index" | null;
  price_value?: number | null;
  index_name?: string | null;
  discount_value?: number | null;
  discount_unit?: "per_t" | "pct" | null;
  incoterms?: string | null;
  delivery_point?: string | null;
  created_at: string;
};

type DealDoc = {
  id: number;
  name: string;
  size: number;
  doc_kind?: string | null;
  created_by?: number | null;
  created_at: string;
};

const STAGE_TONE: Record<OfftakeStage, string> = {
  initial_contact: "border-t-indigo-500",
  materials_sent: "border-t-violet-500",
  nda_signed: "border-t-sky-500",
  loi_mou: "border-t-cyan-500",
  term_sheet: "border-t-amber-500",
  agreement_draft: "border-t-orange-500",
  signed: "border-t-emerald-500",
  refused: "border-t-zinc-400",
};

// Цвета продуктов на графике — в постоянном порядке справочника, не по рангу
const PRODUCT_COLORS = [
  "bg-indigo-500", "bg-sky-500", "bg-amber-500", "bg-emerald-500",
  "bg-violet-500", "bg-rose-500", "bg-teal-500", "bg-orange-500",
];
const OTHER_COLOR = "bg-zinc-400 dark:bg-zinc-500";

export function fmtTonnes(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
}

function fmtMoney(cents: number, currency: string) {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString("ru-RU")} ${currency}`;
  }
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

function stageLabel(s: OfftakeSettings | null, key?: string | null) {
  return s?.stages.find((x) => x.key === key)?.label ?? "—";
}

function invalidateDeals(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["deals"] });
  qc.invalidateQueries({ queryKey: ["deals-forecast"] });
  qc.invalidateQueries({ queryKey: ["offtake-volume"] });
}

// ---------------------------------------------------------------------------
// Экран воронки
// ---------------------------------------------------------------------------

export function OfftakeView({ onOpen, onCreate }: { onOpen: (d: OfftakeDeal) => void; onCreate: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { settings } = useOfftakeSettings();
  const le = useLegalEntities();
  const canCreate = can("deals.create");
  const canUpdate = can("deals.update");
  const canDelete = can("deals.delete");

  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [legal, setLegal] = useState("");
  const [lossFor, setLossFor] = useState<OfftakeDeal | null>(null);
  const [dragOver, setDragOver] = useState<OfftakeStage | null>(null);

  const { data: deals, isPending } = useQuery({
    queryKey: ["deals", "offtake"],
    queryFn: async () =>
      (await api.get<Page<OfftakeDeal>>("/api/deals", { params: { per_page: 200, pipeline: "offtake" } })).data.items,
  });

  const move = useMutation({
    mutationFn: (body: { id: number; offtake_stage: OfftakeStage; loss_reason?: string; loss_comment?: string | null }) => {
      const { id, ...rest } = body;
      return api.patch(`/api/deals/${id}`, rest);
    },
    onSuccess: () => invalidateDeals(qc),
    onError: (e) => toast.error("Не удалось перевести контракт", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/deals/${id}`),
    onSuccess: () => {
      invalidateDeals(qc);
      toast.success("Сделка удалена");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const moveTo = (d: OfftakeDeal, stage: OfftakeStage) => {
    if (stage === d.offtake_stage) return;
    if (stage === "refused") {
      setLossFor(d);
      return;
    }
    move.mutate({ id: d.id, offtake_stage: stage });
  };

  const owners = useMemo(() => {
    const m = new Map<number, string>();
    (deals || []).forEach((d) => d.owner && m.set(d.owner.id, d.owner.name));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [deals]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (deals || []).filter((d) => {
      if (owner && String(d.owner?.id ?? "") !== owner) return false;
      if (legal && le.multi && String(d.legal_entity_id ?? "") !== legal) return false;
      if (needle && !d.title.toLowerCase().includes(needle) && !(d.company?.name ?? "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [deals, owner, legal, q, le.multi]);

  const stages = settings?.stages ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string, OfftakeDeal[]>();
    filtered.forEach((d) => {
      const k = d.offtake_stage ?? "initial_contact";
      map.set(k, [...(map.get(k) ?? []), d]);
    });
    return map;
  }, [filtered]);

  const askDelete = (d: OfftakeDeal) =>
    confirm({
      title: "Удалить контракт?",
      message: `«${d.title}» будет удалена.`,
      danger: true,
      confirmLabel: "Удалить",
      onConfirm: () => del.mutateAsync(d.id),
    });

  return (
    <div className="space-y-5">
      <ContractedVolumeChart />

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
        <SearchInput value={q} onChange={setQ} placeholder="Поиск по контракту или покупателю" />
        <FilterSelect label="Ответственный" value={owner} onChange={setOwner}>
          <option value="">Все ответственные</option>
          {owners.map((o) => (
            <option key={o.id} value={String(o.id)}>
              {o.name}
            </option>
          ))}
        </FilterSelect>
        {le.multi && (
          <FilterSelect label="Юрлицо" value={legal} onChange={setLegal}>
            <option value="">Все юрлица</option>
            {le.all.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.short_name}
                {e.is_active ? "" : " (отключено)"}
              </option>
            ))}
          </FilterSelect>
        )}
        {(q || owner || legal) && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setOwner(""); setLegal(""); }}>
            Сбросить
          </Button>
        )}
      </Toolbar>

      {isPending ? (
        <div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-[#23262D]" />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileSignature size={20} />}
            title={deals && deals.length > 0 ? "По фильтру ничего не найдено" : "Offtake-контрактов пока нет"}
            description={
              deals && deals.length > 0
                ? "Измените поиск или сбросьте фильтры."
                : "Долгосрочные контракты на поставку: от первого контакта до подписанного соглашения, с объёмами по годам."
            }
            action={
              canCreate && !(deals && deals.length > 0) ? (
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={onCreate}>
                  Новый контракт
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : view === "kanban" ? (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1400px] grid-cols-8 gap-3">
            {stages.map((st, idx) => {
              const items = grouped.get(st.key) ?? [];
              const vol = items.reduce((s, d) => s + (d.volume_tpy ?? 0), 0);
              return (
                <div
                  key={st.key}
                  onDragOver={(e) => {
                    if (!canUpdate) return;
                    e.preventDefault();
                    setDragOver(st.key);
                  }}
                  onDragLeave={() => setDragOver((v) => (v === st.key ? null : v))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const id = Number(e.dataTransfer.getData("text/deal-id"));
                    const d = (deals || []).find((x) => x.id === id);
                    if (d && canUpdate) moveTo(d, st.key);
                  }}
                  className={clsx(
                    "flex min-h-[220px] flex-col rounded-lg border border-t-2 border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-[#1B1E23]",
                    STAGE_TONE[st.key],
                    dragOver === st.key && "ring-2 ring-brand-400",
                  )}
                >
                  <div className="flex items-start justify-between gap-2 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    <span>
                      <span className="mr-1 tabular-nums text-zinc-400">{idx + 1}.</span>
                      {st.label}
                    </span>
                    <span className="rounded bg-zinc-200/70 px-1.5 text-xs font-medium tabular-nums text-zinc-600 dark:bg-[#23262D] dark:text-zinc-400">
                      {items.length}
                    </span>
                  </div>
                  <div className="border-b border-zinc-200 px-3 py-1 text-xs tabular-nums text-zinc-500 dark:border-zinc-800">
                    {fmtTonnes(vol)}/год
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    {items.map((d) => (
                      <OfftakeCard
                        key={d.id}
                        deal={d}
                        multiLegal={le.multi}
                        canUpdate={canUpdate}
                        canDelete={canDelete}
                        nextStage={idx < 6 ? stages[idx + 1] : undefined}
                        onOpen={() => onOpen(d)}
                        onDelete={() => askDelete(d)}
                        onNext={(s) => moveTo(d, s)}
                      />
                    ))}
                    {items.length === 0 && <div className="py-3 text-center text-xs text-zinc-400">Пусто</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="table-container table-scroll">
          <table className="w-full min-w-[900px]">
            <thead className="table-head">
              <tr>
                <th className="table-head-cell">Сделка</th>
                <th className="table-head-cell">Стадия</th>
                <th className="table-head-cell">Продукт</th>
                <th className="table-head-cell text-right">т/год</th>
                <th className="table-head-cell text-right">Лет</th>
                <th className="table-head-cell text-right">Всего</th>
                <th className="table-head-cell">Incoterms</th>
                {le.multi && <th className="table-head-cell">Юрлицо</th>}
                <th className="table-head-cell text-right">Вероятность</th>
                <th className="table-head-cell w-20" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="table-row group">
                  <td className="table-cell">
                    <button
                      type="button"
                      className="text-left font-medium text-zinc-900 hover:text-brand-700 dark:text-zinc-100 dark:hover:text-brand-300"
                      onClick={() => onOpen(d)}
                    >
                      {d.title}
                    </button>
                    {d.company && <div className="text-xs text-zinc-500">{d.company.name}</div>}
                  </td>
                  <td className="table-cell">{stageLabel(settings, d.offtake_stage)}</td>
                  <td className="table-cell">{d.product?.name ?? "—"}</td>
                  <td className="table-cell text-right tabular-nums">{d.volume_tpy != null ? d.volume_tpy.toLocaleString("ru-RU") : "—"}</td>
                  <td className="table-cell text-right tabular-nums">{d.term_years ?? "—"}</td>
                  <td className="table-cell text-right tabular-nums">{fmtTonnes(d.total_volume)}</td>
                  <td className="table-cell">{d.incoterms ?? "—"}</td>
                  {le.multi && <td className="table-cell text-zinc-600 dark:text-zinc-300">{d.legal_entity?.short_name ?? "—"}</td>}
                  <td className="table-cell text-right tabular-nums">{d.probability}%</td>
                  <td className="table-cell text-right">
                    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <Button variant="ghost" size="icon" onClick={() => onOpen(d)} aria-label="Открыть контракт">
                        <Pencil size={14} />
                      </Button>
                      {canDelete && (
                        <Button variant="ghost" size="icon" className="text-rose-600" onClick={() => askDelete(d)} aria-label="Удалить контракт">
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lossFor && settings && (
        <LossReasonModal
          settings={settings}
          onClose={() => setLossFor(null)}
          onSubmit={async (reason, comment) => {
            await move.mutateAsync({ id: lossFor.id, offtake_stage: "refused", loss_reason: reason, loss_comment: comment });
            setLossFor(null);
          }}
        />
      )}
    </div>
  );
}

function OfftakeCard({
  deal: d,
  multiLegal,
  canUpdate,
  canDelete,
  nextStage,
  onOpen,
  onDelete,
  onNext,
}: {
  deal: OfftakeDeal;
  multiLegal: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  nextStage?: { key: OfftakeStage; label: string };
  onOpen: () => void;
  onDelete: () => void;
  onNext: (s: OfftakeStage) => void;
}) {
  return (
    <div
      draggable={canUpdate}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/deal-id", String(d.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      className={clsx(
        "group rounded-md border border-zinc-200 bg-white p-2.5 text-sm transition-[border-color,box-shadow] hover:border-zinc-300 hover:shadow-pop dark:border-zinc-800 dark:bg-[#23262D]",
        canUpdate && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" className="flex-1 text-left font-medium hover:text-brand-700 dark:hover:text-brand-300" onClick={onOpen}>
          {d.title}
        </button>
        {canDelete && (
          <Button variant="ghost" size="icon" className="text-rose-500 opacity-0 transition-opacity group-hover:opacity-100" onClick={onDelete} aria-label="Удалить контракт">
            <Trash2 size={12} />
          </Button>
        )}
      </div>
      {d.company && <div className="mt-0.5 truncate text-xs text-zinc-500">{d.company.name}</div>}
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-zinc-600 dark:text-zinc-300">
          {d.product?.name ?? "Продукт не указан"}
        </span>
        <span className="text-zinc-500 tabular-nums">{d.probability}%</span>
      </div>
      {d.volume_tpy != null && (
        <div className="mt-0.5 text-xs tabular-nums text-zinc-500">
          {fmtTonnes(d.volume_tpy)}/год{d.term_years ? ` × ${d.term_years} л.` : ""}
          {d.start_year ? ` с ${d.start_year}` : ""}
        </div>
      )}
      {multiLegal && d.legal_entity && <div className="mt-0.5 truncate text-xs text-zinc-500">Юрлицо: {d.legal_entity.short_name}</div>}
      {d.offtake_stage === "refused" && d.loss_reason && (
        <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">Отказ: {LOSS_LABEL[d.loss_reason] ?? d.loss_reason}</div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        {d.owner ? <Avatar name={d.owner.name} url={d.owner.avatar_url} size={18} /> : <span />}
        {canUpdate && nextStage && (
          <button
            type="button"
            className="truncate rounded-md border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600 hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700 dark:text-zinc-400"
            onClick={() => onNext(nextStage.key)}
            title={`Перевести в «${nextStage.label}»`}
          >
            → {nextStage.label}
          </button>
        )}
      </div>
    </div>
  );
}

const LOSS_LABEL: Record<string, string> = {
  price: "цена",
  volume: "объём",
  timing: "сроки",
  logistics: "логистика",
  other: "другое",
};

// ---------------------------------------------------------------------------
// Причина отказа
// ---------------------------------------------------------------------------

function LossReasonModal({
  settings,
  initialReason,
  initialComment,
  onClose,
  onSubmit,
}: {
  settings: OfftakeSettings;
  initialReason?: string | null;
  initialComment?: string | null;
  onClose: () => void;
  onSubmit: (reason: string, comment: string | null) => Promise<void>;
}) {
  const [reason, setReason] = useState(initialReason ?? "");
  const [comment, setComment] = useState(initialComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason) return setError("Выберите причину отказа");
    if (reason === "other" && !comment.trim()) return setError("Опишите причину отказа в комментарии");
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason, comment.trim() || null);
    } catch (e) {
      setError(extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Причина отказа" size="sm">
      <div className="space-y-3">
        <div className="space-y-1.5">
          {Object.entries(settings.loss_reasons).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="radio" name="loss_reason" checked={reason === k} onChange={() => setReason(k)} />
              {label}
            </label>
          ))}
        </div>
        <FormField label="Комментарий" required={reason === "other"}>
          <textarea
            className="input min-h-[70px]"
            value={comment}
            maxLength={5000}
            onChange={(e) => setComment(e.target.value)}
            placeholder={reason === "other" ? "Почему покупатель отказался" : "Подробности, если нужно"}
          />
        </FormField>
        <FormError msg={error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="danger" isLoading={busy} onClick={submit}>
            Перевести в «Отказ»
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// График «Законтрактованный объём по годам»
// ---------------------------------------------------------------------------

type VolumeResp = {
  years: { year: number; total: number; by_product: Record<string, number> }[];
  products: { id: number; name: string }[];
  deals_count: number;
};

function ContractedVolumeChart() {
  const le = useLegalEntities();
  const allProducts = useOfftakeProducts();
  const [legal, setLegal] = useState("");
  const [byProduct, setByProduct] = useState(true);
  const [hover, setHover] = useState<number | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["offtake-volume", legal],
    queryFn: async () =>
      (
        await api.get<VolumeResp>("/api/deals/offtake/contracted-volume", {
          params: legal ? { legal_entity_id: Number(legal) } : {},
        })
      ).data,
  });

  // Цвет закреплён за продуктом по его месту в справочнике — фильтр не перекрашивает столбцы
  const colorOf = useMemo(() => {
    const order = (allProducts.data ?? []).map((p) => p.id);
    return (key: string) => {
      if (key === "none") return OTHER_COLOR;
      const i = order.indexOf(Number(key));
      return i >= 0 && i < PRODUCT_COLORS.length ? PRODUCT_COLORS[i] : OTHER_COLOR;
    };
  }, [allProducts.data]);

  const series = useMemo(() => {
    if (!data) return [] as { key: string; name: string }[];
    const s = data.products.map((p) => ({ key: String(p.id), name: p.name }));
    if (data.years.some((y) => y.by_product.none)) s.push({ key: "none", name: "Продукт не указан" });
    return s;
  }, [data]);

  const max = Math.max(0, ...(data?.years.map((y) => y.total) ?? [0]));
  const stacked = byProduct && series.length > 1;
  const hovered = data?.years.find((y) => y.year === hover) ?? null;

  return (
    <section className="card">
      <div className="card-header flex-wrap gap-2">
        <div>
          <h2 className="card-title">Законтрактованный объём по годам</h2>
          <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
            Подписанные offtake-контракты: тонны в год за каждый год поставки
            {data ? ` · контрактов: ${data.deals_count}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {series.length > 1 && (
            <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={byProduct} onChange={(e) => setByProduct(e.target.checked)} />
              По продуктам
            </label>
          )}
          {le.multi && (
            <FilterSelect label="Юрлицо" value={legal} onChange={setLegal}>
              <option value="">Все юрлица</option>
              {le.all.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.short_name}
                </option>
              ))}
            </FilterSelect>
          )}
        </div>
      </div>
      <div className="px-5 pb-5 pt-2">
        {isPending ? (
          <div className="h-48 animate-pulse rounded-lg bg-zinc-100 dark:bg-[#23262D]" />
        ) : !data || data.years.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500">
            Здесь появится объём, когда контракт перейдёт в «Подписан» и в нём будут указаны объём в год, срок и год начала поставок.
          </div>
        ) : (
          <>
            <div className="mb-2 h-5 text-xs text-zinc-600 dark:text-zinc-300" aria-live="polite">
              {hovered ? (
                <>
                  <span className="font-semibold tabular-nums">{hovered.year}</span>: {fmtTonnes(hovered.total)}
                  {stacked &&
                    series
                      .filter((s) => hovered.by_product[s.key])
                      .map((s) => ` · ${s.name}: ${fmtTonnes(hovered.by_product[s.key])}`)
                      .join("")}
                </>
              ) : (
                <span className="text-zinc-400">Наведите на столбец, чтобы увидеть объём</span>
              )}
            </div>
            <div className="relative flex h-56 gap-3">
              <div className="flex w-20 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-zinc-400">
                <span>{fmtTonnes(max)}</span>
                <span>{fmtTonnes(max / 2)}</span>
                <span>0</span>
              </div>
              <div className="relative min-w-0 flex-1">
                <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                  <div className="border-t border-dashed border-zinc-200 dark:border-zinc-800" />
                  <div className="border-t border-dashed border-zinc-200 dark:border-zinc-800" />
                  <div className="border-t border-zinc-300 dark:border-zinc-700" />
                </div>
                <div className="relative flex h-full items-end gap-1 sm:gap-2">
                  {data.years.map((y) => {
                    const h = max > 0 ? (y.total / max) * 100 : 0;
                    const segs = stacked
                      ? series.filter((s) => y.by_product[s.key]).map((s) => ({ key: s.key, v: y.by_product[s.key] }))
                      : [{ key: series.length === 1 ? series[0].key : "__all", v: y.total }];
                    return (
                      <div
                        key={y.year}
                        className="flex h-full flex-1 cursor-default flex-col justify-end"
                        onMouseEnter={() => setHover(y.year)}
                        onMouseLeave={() => setHover((v) => (v === y.year ? null : v))}
                        title={`${y.year}: ${fmtTonnes(y.total)}`}
                      >
                        <div
                          className={clsx("mx-auto flex w-full max-w-[44px] flex-col-reverse gap-[2px] overflow-hidden rounded-t", hover === y.year && "opacity-90")}
                          style={{ height: `${h}%` }}
                        >
                          {segs.map((sg) => (
                            <div
                              key={sg.key}
                              className={sg.key === "__all" ? "bg-brand-500" : colorOf(sg.key)}
                              style={{ flexGrow: sg.v, flexBasis: 0, minHeight: 1 }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="ml-[92px] mt-1 flex gap-1 sm:gap-2">
              {data.years.map((y, i) => (
                <div key={y.year} className="flex-1 text-center text-[11px] tabular-nums text-zinc-500">
                  {data.years.length <= 12 || i % Math.ceil(data.years.length / 12) === 0 ? y.year : ""}
                </div>
              ))}
            </div>
            {stacked && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                {series.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5">
                    <span className={clsx("h-2.5 w-2.5 rounded-sm", colorOf(s.key))} />
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Карточка offtake-контракта
// ---------------------------------------------------------------------------

type FormValues = {
  title: string;
  offtake_stage: OfftakeStage;
  product_id: string;
  volume_tpy: string;
  term_years: string;
  start_year: string;
  price_type: "" | "fixed" | "index";
  price_value: string;
  index_name: string;
  discount_value: string;
  discount_unit: "per_t" | "pct";
  currency: string;
  amount: string;
  incoterms: string;
  delivery_point: string;
  close_date: string;
  note: string;
  loss_reason: string;
  loss_comment: string;
};

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".").replace(/\s/g, "")));

export function OfftakeDealModal({
  initial,
  onClose,
  variant = "modal",
  onSaved,
}: {
  initial: OfftakeDeal | null;
  onClose: () => void;
  /** page — карточка отдельной страницей /deals/:id с вкладками; modal — окно (создание контракта). */
  variant?: "modal" | "page";
  /** Для страницы: после сохранения остаёмся на ней. */
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const ai = useAi();
  const [tab, setTab] = useState<"terms" | "docs" | "ai">("terms");
  const { can } = useAuth();
  const le = useLegalEntities();
  const { settings } = useOfftakeSettings();
  const products = useOfftakeProducts();
  const [serverError, setServerError] = useState<string | null>(null);
  const [legalId, setLegalId] = useState<number | null>(initial?.legal_entity_id ?? null);
  const [companyId, setCompanyId] = useState<number | null>(initial?.company_id ?? null);
  // Вероятность: null — по стадии; число — задана вручную
  const [manualProb, setManualProb] = useState<number | null>(initial?.probability_manual ? initial.probability : null);
  const [probReset, setProbReset] = useState(false);
  const canEdit = initial ? can("deals.update") : can("deals.create");

  const { register, handleSubmit, watch, control, formState: { isSubmitting, errors } } = useForm<FormValues>({
    defaultValues: {
      title: initial?.title ?? "",
      offtake_stage: initial?.offtake_stage ?? "initial_contact",
      product_id: initial?.product_id ? String(initial.product_id) : "",
      volume_tpy: initial?.volume_tpy != null ? String(initial.volume_tpy) : "",
      term_years: initial?.term_years != null ? String(initial.term_years) : "",
      start_year: initial?.start_year != null ? String(initial.start_year) : "",
      price_type: initial?.price_type ?? "",
      price_value: initial?.price_value != null ? String(initial.price_value) : "",
      index_name: initial?.index_name ?? "",
      discount_value: initial?.discount_value != null ? String(initial.discount_value) : "",
      discount_unit: initial?.discount_unit ?? "per_t",
      currency: initial?.currency ?? "USD",
      amount: initial ? String(initial.amount_cents / 100) : "",
      incoterms: initial?.incoterms ?? "",
      delivery_point: initial?.delivery_point ?? "",
      close_date: initial?.close_date ?? "",
      note: initial?.note ?? "",
      loss_reason: initial?.loss_reason ?? "",
      loss_comment: initial?.loss_comment ?? "",
    },
  });

  const stage = watch("offtake_stage");
  const priceType = watch("price_type");
  const currency = watch("currency");
  const vol = num(watch("volume_tpy"));
  const years = num(watch("term_years"));
  const total = vol != null && years != null && !Number.isNaN(vol) && !Number.isNaN(years) ? vol * years : null;
  const price = num(watch("price_value"));
  const fixedAmount = priceType === "fixed" && total != null && price != null && !Number.isNaN(price) ? total * price : null;

  const stageDefault = settings?.stages.find((s) => s.key === stage)?.probability ?? 0;
  const forcedProb = stage === "signed" || stage === "refused";
  const shownProb = forcedProb ? stageDefault : manualProb ?? stageDefault;

  const stageOptions = (settings?.stages ?? []).filter((s, i) => (initial ? true : i < 2));
  const productOptions = (products.data ?? []).filter((p: OfftakeProduct) => p.is_active || p.id === initial?.product_id);

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    if (v.offtake_stage === "refused") {
      if (!v.loss_reason) return setServerError("Укажите причину отказа");
      if (v.loss_reason === "other" && !v.loss_comment.trim()) return setServerError("Опишите причину отказа в комментарии");
    }
    const body: Record<string, unknown> = {
      title: v.title.trim(),
      offtake_stage: v.offtake_stage,
      product_id: v.product_id ? Number(v.product_id) : null,
      volume_tpy: num(v.volume_tpy),
      term_years: num(v.term_years),
      start_year: num(v.start_year),
      price_type: v.price_type || null,
      price_value: v.price_type === "fixed" ? num(v.price_value) : null,
      index_name: v.price_type === "index" ? v.index_name.trim() || null : null,
      discount_value: v.price_type === "index" ? num(v.discount_value) : null,
      discount_unit: v.price_type === "index" ? v.discount_unit : null,
      currency: v.currency,
      incoterms: v.incoterms || null,
      delivery_point: v.delivery_point.trim() || null,
      close_date: v.close_date || null,
      note: v.note || null,
      ...(v.offtake_stage === "refused" ? { loss_reason: v.loss_reason, loss_comment: v.loss_comment.trim() || null } : {}),
      ...(le.multi && legalId ? { legal_entity_id: legalId } : {}),
      ...(companyId ? { company_id: companyId } : initial?.company_id ? { company_id: 0 } : {}),
    };
    // Сумма: при фиксированной цене её считает сервер (объём × цена), иначе — оценка вручную
    if (v.price_type !== "fixed") {
      const a = num(v.amount);
      if (a != null && !Number.isNaN(a)) body.amount_cents = Math.max(0, Math.round(a * 100));
    }
    if (probReset) body.probability_auto = true;
    else if (manualProb != null) body.probability = manualProb;
    for (const k of ["volume_tpy", "term_years", "start_year", "price_value", "discount_value"]) {
      if (typeof body[k] === "number" && Number.isNaN(body[k])) return setServerError("Проверьте числовые поля: допускаются только цифры");
    }
    try {
      if (initial) await api.patch(`/api/deals/${initial.id}`, body);
      else await api.post("/api/deals", { ...body, pipeline: "offtake" });
      invalidateDeals(qc);
      if (variant === "page" && initial) {
        toast.success("Контракт сохранён");
        onSaved?.();
      } else onClose();
    } catch (e) {
      setServerError(extractApiError(e).message);
    }
  });

  const fields = (
        <fieldset disabled={!canEdit} className="space-y-4">
          <FormField label="Название" required error={errors.title ? "Название — от 2 до 200 символов" : null}>
            <input className="input" autoFocus={variant !== "page"} {...register("title", { required: true, minLength: 2, maxLength: 200 })} />
          </FormField>

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Стадия" hint={!initial ? "Дальше второй стадии контракт переходит после прикрепления документов" : undefined}>
              <select className="input" {...register("offtake_stage")}>
                {stageOptions.map((s, i) => (
                  <option key={s.key} value={s.key}>
                    {i + 1}. {s.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Вероятность, %">
              <div className="flex items-center gap-2">
                <input
                  className="input w-24 tabular-nums"
                  type="number"
                  min={0}
                  max={100}
                  disabled={forcedProb}
                  value={shownProb}
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    setManualProb(n);
                    setProbReset(false);
                  }}
                />
                {forcedProb ? (
                  <span className="text-xs text-zinc-500">задаётся стадией</span>
                ) : manualProb != null ? (
                  <button
                    type="button"
                    className="text-xs text-brand-700 hover:underline dark:text-brand-300"
                    onClick={() => {
                      setManualProb(null);
                      setProbReset(true);
                    }}
                  >
                    Вернуть по стадии ({stageDefault} %)
                  </button>
                ) : (
                  <span className="text-xs text-zinc-500">по стадии</span>
                )}
              </div>
            </FormField>
          </div>

          {stage === "refused" && settings && (
            <div className="grid gap-3 rounded-lg border border-rose-200 bg-rose-50/50 p-3 md:grid-cols-2 dark:border-rose-900/50 dark:bg-rose-950/20">
              <FormField label="Причина отказа" required>
                <select className="input" {...register("loss_reason")}>
                  <option value="">Выберите причину</option>
                  {Object.entries(settings.loss_reasons).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Комментарий" required={watch("loss_reason") === "other"}>
                <input className="input" maxLength={5000} {...register("loss_comment")} placeholder="Почему покупатель отказался" />
              </FormField>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {can("contacts.view") && (
              <FormField label="Покупатель">
                <RecordPicker
                  target="company"
                  value={companyId}
                  known={initial?.company ? [{ id: initial.company.id, label: initial.company.name }] : []}
                  onChange={(v) => setCompanyId(typeof v === "number" ? v : null)}
                  placeholder="Найдите компанию по названию"
                />
              </FormField>
            )}
            {le.multi && (
              <FormField label="Юрлицо">
                <select
                  className="input"
                  value={String(legalId ?? le.defaultEntity?.id ?? "")}
                  onChange={(e) => setLegalId(e.target.value ? Number(e.target.value) : null)}
                >
                  {legalEntityOptions(le.all, initial?.legal_entity_id).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.short_name}
                      {e.is_default ? " — по умолчанию" : ""}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Объём</div>
            <div className="grid gap-3 md:grid-cols-5">
              <FormField label="Продукт" className="md:col-span-2">
                <select className="input" {...register("product_id")}>
                  <option value="">Не выбран</option>
                  {productOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.is_active ? "" : " (не используется)"}
                    </option>
                  ))}
                </select>
                {productOptions.length === 0 && (
                  <div className="mt-1 text-xs text-zinc-500">
                    Список продуктов задаётся в <Link to="/settings/offtake" className="text-brand-700 hover:underline dark:text-brand-300">настройках</Link>.
                  </div>
                )}
              </FormField>
              <FormField label="Тонн в год">
                <input className="input tabular-nums" inputMode="decimal" {...register("volume_tpy")} />
              </FormField>
              <FormField label="Срок, лет">
                <input className="input tabular-nums" type="number" min={1} max={100} {...register("term_years")} />
              </FormField>
              <FormField label="Год начала">
                <input className="input tabular-nums" type="number" min={1900} max={2200} {...register("start_year")} />
              </FormField>
            </div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Общий объём: <span className="font-semibold tabular-nums">{total != null ? fmtTonnes(total) : "—"}</span>
              <span className="ml-1 text-xs text-zinc-500">(тонн в год × срок, считается автоматически)</span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Цена и поставка</div>
            <div className="grid gap-3 md:grid-cols-4">
              <FormField label="Тип цены">
                <select className="input" {...register("price_type")}>
                  <option value="">Не указан</option>
                  <option value="fixed">Фикс</option>
                  <option value="index">Индекс + дисконт</option>
                </select>
              </FormField>
              <FormField label="Валюта">
                <select className="input" {...register("currency")}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="KZT">KZT</option>
                  <option value="RUB">RUB</option>
                  <option value="CNY">CNY</option>
                </select>
              </FormField>
              {priceType === "fixed" && (
                <FormField label={`Цена, ${currency}/т`} className="md:col-span-2">
                  <input className="input tabular-nums" inputMode="decimal" {...register("price_value")} />
                </FormField>
              )}
              {priceType === "index" && (
                <>
                  <FormField label="Индекс" className="md:col-span-2">
                    <input className="input" maxLength={200} {...register("index_name")} placeholder="Название ценового индекса" />
                  </FormField>
                  <FormField label="Дисконт" className="md:col-span-2">
                    <div className="flex gap-2">
                      <input className="input flex-1 tabular-nums" inputMode="decimal" {...register("discount_value")} />
                      <select className="input w-32" {...register("discount_unit")}>
                        <option value="per_t">{currency}/т</option>
                        <option value="pct">% от индекса</option>
                      </select>
                    </div>
                  </FormField>
                </>
              )}
              <FormField label="Incoterms">
                <select className="input" {...register("incoterms")}>
                  <option value="">Не указаны</option>
                  {(settings?.incoterms ?? []).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Пункт поставки" className="md:col-span-3">
                <input className="input" maxLength={300} {...register("delivery_point")} placeholder="Город, порт или станция по условиям Incoterms" />
              </FormField>
              {priceType === "fixed" ? (
                <div className="text-sm text-zinc-600 md:col-span-4 dark:text-zinc-300">
                  Сумма контракта:{" "}
                  <span className="font-semibold tabular-nums">
                    {fixedAmount != null ? fmtMoney(Math.round(fixedAmount * 100), currency) : "—"}
                  </span>
                  <span className="ml-1 text-xs text-zinc-500">(общий объём × цена)</span>
                </div>
              ) : (
                <FormField label={`Оценочная сумма, ${currency}`} className="md:col-span-2">
                  <input className="input tabular-nums" inputMode="decimal" {...register("amount")} />
                </FormField>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Ожидаемая дата подписания">
              <Controller
                control={control}
                name="close_date"
                render={({ field }) => (
                  <DatePicker value={field.value} onChange={field.onChange} onBlur={field.onBlur} aria-label="Ожидаемая дата подписания" />
                )}
              />
            </FormField>
            <FormField label="Заметка">
              <textarea className="input min-h-[40px]" maxLength={5000} {...register("note")} />
            </FormField>
          </div>
        </fieldset>
  );

  const stageLabel = settings?.stages.find((x) => x.key === initial?.offtake_stage)?.label;
  const stageIdx = settings?.stages.findIndex((x) => x.key === initial?.offtake_stage) ?? -1;

  if (variant === "page" && initial) {
    return (
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="page-header">
          <div className="min-w-0">
            <Link to="/deals" className="mb-0.5 inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
              Offtake контракты /
            </Link>
            <h1 className="page-title truncate">{initial.title}</h1>
            <p className="page-subtitle">
              {[stageLabel, initial.company?.name, initial.owner?.name].filter(Boolean).join(" · ")}
            </p>
          </div>
          {canEdit && (
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Сохранить
            </Button>
          )}
        </div>

        {settings && initial.offtake_stage !== "refused" && (
          <div className="flex gap-1" aria-label={`Стадия: ${stageLabel ?? ""}`}>
            {settings.stages
              .filter((x) => x.key !== "refused")
              .map((x, i) => (
                <div key={x.key} className="min-w-0 flex-1" title={x.label}>
                  <div className={clsx("h-1.5 rounded-full", i <= stageIdx ? "bg-brand-600" : "bg-zinc-200 dark:bg-zinc-700")} />
                  <div className={clsx("mt-1 hidden truncate text-[11px] lg:block", i === stageIdx ? "font-semibold text-zinc-800 dark:text-zinc-100" : "text-zinc-400")}>
                    {x.label}
                  </div>
                </div>
              ))}
          </div>
        )}

        {initial.offtake_stage === "signed" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <span>Контракт подписан — оформите договор в реестре.</span>
            <Link to={`/contracts?new=1&deal_id=${initial.id}`} className="btn-primary !px-3 !py-1.5 !text-xs">
              Создать договор
            </Link>
          </div>
        )}

        <Tabs
          label="Разделы контракта"
          value={tab}
          onChange={setTab}
          items={[
            { key: "terms", label: "Условия" },
            { key: "docs", label: "Документы" },
            { key: "ai", label: "ИИ-помощник", hidden: !ai.available },
          ]}
        />
        {/* Вкладки скрываются, а не размонтируются: несохранённые правки в полях не теряются */}
        <div hidden={tab !== "terms"} className="card p-5">
          {fields}
        </div>
        <div hidden={tab !== "docs"}>
          <DealDocuments deal={initial} settings={settings} />
        </div>
        <div hidden={tab !== "ai"}>
          <OfftakeAiPanel deal={initial} />
        </div>
        <FormError msg={serverError} />
      </form>
    );
  }

  return (
    <Modal open onClose={onClose} title={initial ? "Offtake-контракт" : "Новый контракт"} size="xl">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {fields}

        {initial && <DealDocuments deal={initial} settings={settings} />}

        {initial && <OfftakeAiPanel deal={initial} />}

        {initial && initial.offtake_stage === "signed" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <span>Сделка подписана — оформите договор в реестре.</span>
            <Link to={`/contracts?new=1&deal_id=${initial.id}`} className="btn-primary !px-3 !py-1.5 !text-xs" onClick={onClose}>
              Создать договор
            </Link>
          </div>
        )}

        <FormError msg={serverError} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? "Отмена" : "Закрыть"}
          </Button>
          {canEdit && (
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {initial ? "Сохранить" : "Создать"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Документы контракта
// ---------------------------------------------------------------------------

function DealDocuments({ deal, settings }: { deal: OfftakeDeal; settings: OfftakeSettings | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { can, me } = useAuth();
  const canUpload = can("files.upload");
  const canManageAll = can("files.delete");
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("nda");
  const [busy, setBusy] = useState(false);
  const kinds = settings?.doc_kinds ?? {};

  const { data, isPending } = useQuery({
    queryKey: ["deal-docs", deal.id],
    queryFn: async () => (await api.get<DealDoc[]>("/api/documents", { params: { deal_id: deal.id } })).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["deal-docs", deal.id] });
    qc.invalidateQueries({ queryKey: ["docs"] });
    qc.invalidateQueries({ queryKey: ["company-docs"] });
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("deal_id", String(deal.id));
      fd.append("doc_kind", kind);
      await api.post("/api/documents/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      refresh();
      toast.success("Документ прикреплён");
    } catch (e) {
      toast.error("Не удалось загрузить файл", extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (d: DealDoc) => {
    try {
      const res = await api.get(`/api/documents/${d.id}/download-internal`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = d.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error("Не удалось скачать файл", extractApiError(e).message);
    }
  };

  const remove = (d: DealDoc) =>
    confirm({
      title: "Удалить документ?",
      message: `«${d.name}» будет удалён из контракта и из раздела «Документы».`,
      danger: true,
      confirmLabel: "Удалить",
      onConfirm: async () => {
        try {
          await api.delete(`/api/documents/${d.id}`);
          refresh();
        } catch (e) {
          toast.error("Не удалось удалить", extractApiError(e).message);
        }
      },
    });

  const has = (k: string) => (data ?? []).some((d) => d.doc_kind === k);

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Документы контракта</div>
        {canUpload && (
          <div className="flex items-center gap-2">
            <select className="input !py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Вид документа">
              {Object.entries(kinds).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="secondary" size="sm" isLoading={busy} leftIcon={<Upload size={13} />} onClick={() => fileRef.current?.click()}>
              Прикрепить файл
            </Button>
          </div>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs">
        <span className={has("nda") ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}>
          {has("nda") ? "✓" : "○"} NDA — нужен для «NDA подписан»
        </span>
        <span className={has("term_sheet") ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}>
          {has("term_sheet") ? "✓" : "○"} Term Sheet — нужен для «Term Sheet согласован»
        </span>
      </div>
      {isPending ? (
        <div className="h-10 animate-pulse rounded bg-zinc-100 dark:bg-[#23262D]" />
      ) : !data || data.length === 0 ? (
        <div className="text-sm text-zinc-500">Файлов пока нет.</div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-1.5 text-sm">
              <FileText size={15} className="shrink-0 text-zinc-400" />
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {(d.doc_kind && kinds[d.doc_kind]) || "Без вида"}
              </span>
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="shrink-0 text-xs text-zinc-500">{fmtSize(d.size)}</span>
              <Button type="button" variant="ghost" size="icon" aria-label="Скачать" onClick={() => download(d)}>
                <Download size={13} />
              </Button>
              {(canManageAll || d.created_by === me?.id) && (
                <Button type="button" variant="ghost" size="icon" className="text-rose-500" aria-label="Удалить документ" onClick={() => remove(d)}>
                  <Trash2 size={13} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ИИ: письмо покупателю и сводка по контракту (кнопки видны только при доступном ИИ)
// ---------------------------------------------------------------------------

type EmailPurpose = "materials" | "nda" | "follow_up" | "term_sheet" | "custom";

const EMAIL_PURPOSES: { key: EmailPurpose; label: string }[] = [
  { key: "materials", label: "Презентация и материалы" },
  { key: "nda", label: "Предложение подписать NDA" },
  { key: "follow_up", label: "Напоминание (follow-up)" },
  { key: "term_sheet", label: "Term Sheet" },
  { key: "custom", label: "Своя цель" },
];

type AiSummary = {
  status_line: string;
  stuck_reason: string | null;
  missing_documents: string[];
  last_contact: string | null;
  next_steps: string[];
};

function OfftakeAiPanel({ deal }: { deal: OfftakeDeal }) {
  const { available } = useAi();
  const [mode, setMode] = useState<"none" | "email" | "summary">("none");
  if (!available) return null;
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-900/50 dark:bg-brand-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={15} className="text-brand-600 dark:text-brand-300" />
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">ИИ-помощник</span>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "summary" ? "primary" : "secondary"}
            onClick={() => setMode(mode === "summary" ? "none" : "summary")}
          >
            Сводка ИИ
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "email" ? "primary" : "secondary"}
            leftIcon={<Mail size={13} />}
            onClick={() => setMode(mode === "email" ? "none" : "email")}
          >
            Письмо с ИИ
          </Button>
        </div>
      </div>
      {mode === "summary" && <OfftakeAiSummary dealId={deal.id} />}
      {mode === "email" && <OfftakeAiEmail dealId={deal.id} />}
    </div>
  );
}

function OfftakeAiSummary({ dealId }: { dealId: number }) {
  const [data, setData] = useState<AiSummary | null>(null);
  const run = useMutation({
    mutationFn: async () => (await api.post<AiSummary>(`/api/ai/offtake/${dealId}/summary`)).data,
    onSuccess: setData,
  });
  return (
    <div className="mt-3 space-y-2 text-sm">
      {!data && !run.isPending && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-zinc-600 dark:text-zinc-300">Короткая сводка: где контракт, что мешает, какие шаги дальше.</span>
          <Button type="button" size="sm" variant="primary" onClick={() => run.mutate()}>
            Составить сводку
          </Button>
        </div>
      )}
      {run.isPending && <div className="h-16 animate-pulse rounded bg-white/60 dark:bg-[#23262D]" />}
      <FormError msg={run.isError ? extractApiError(run.error).message : null} />
      {data && !run.isPending && (
        <div className="space-y-2">
          <p>{data.status_line}</p>
          {data.stuck_reason && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <span className="font-medium">Что может мешать: </span>
              {data.stuck_reason}
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-zinc-500">Последний контакт</div>
              <div>{data.last_contact ?? "Писем и звонков по контракту не найдено"}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-zinc-500">Недостающие документы</div>
              {data.missing_documents.length === 0 ? (
                <div>Нужные на этой стадии документы прикреплены</div>
              ) : (
                <ul className="list-disc pl-4">
                  {data.missing_documents.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {data.next_steps.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-zinc-500">Следующие шаги</div>
              <ol className="list-decimal pl-4">
                {data.next_steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <span>Выводы и шаги предложил ИИ — проверьте перед тем, как действовать.</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => run.mutate()}>
              Обновить
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OfftakeAiEmail({ dealId }: { dealId: number }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [purpose, setPurpose] = useState<EmailPurpose>("follow_up");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const run = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ subject: string; body: string; to: string | null }>(`/api/ai/offtake/${dealId}/email-draft`, {
          purpose,
          note: note.trim() || null,
        })
      ).data,
    onSuccess: (d) => {
      setSubject(d.subject);
      setBody(d.body);
      setTo(d.to);
      setReady(true);
    },
  });

  const copy = async () => {
    const text = (subject ? `Тема: ${subject}\n\n` : "") + body;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Черновик скопирован");
    } catch {
      toast.error("Не удалось скопировать", "Выделите текст и скопируйте вручную");
    }
  };

  // Черновик передаётся в почту через хранилище вкладки, а не через адрес: текст и email не попадают в URL
  const openInMail = () => {
    try {
      sessionStorage.setItem("qadam.mail_draft", JSON.stringify({ to: to ?? "", subject, body }));
    } catch {
      toast.error("Не удалось открыть почту", "Скопируйте черновик вручную");
      return;
    }
    navigate("/mail?compose=1");
  };

  // Поля стоят внутри формы карточки: Enter не должен сохранять контракт
  const noEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
  };

  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Цель письма">
          <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value as EmailPurpose)}>
            {EMAIL_PURPOSES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={purpose === "custom" ? "О чём письмо" : "Пожелания (необязательно)"} required={purpose === "custom"}>
          <input
            className="input"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={noEnter}
            placeholder="Что упомянуть, тон, язык письма"
          />
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="primary"
          isLoading={run.isPending}
          disabled={purpose === "custom" && !note.trim()}
          onClick={() => run.mutate()}
        >
          {ready ? "Составить заново" : "Составить черновик"}
        </Button>
      </div>
      <FormError msg={run.isError ? extractApiError(run.error).message : null} />
      {ready && (
        <div className="space-y-2">
          {to && <div className="text-xs text-zinc-500">Кому: {to}</div>}
          <FormField label="Тема">
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} onKeyDown={noEnter} />
          </FormField>
          <FormField label="Текст письма">
            <textarea className="input min-h-[220px]" value={body} onChange={(e) => setBody(e.target.value)} />
          </FormField>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-zinc-500">Черновик составил ИИ — проверьте факты перед отправкой. Сам он никуда не отправляется.</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" leftIcon={<Copy size={13} />} onClick={copy}>
                Копировать
              </Button>
              {can("mail.use") && (
                <Button type="button" size="sm" variant="primary" onClick={openInMail}>
                  Открыть в почте
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
