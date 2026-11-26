/**
 * Реестр договоров: общие типы, подписи, бейджи и форма создания/редактирования договора.
 */
import { useState } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, extractApiError } from "@/api/client";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { DatePicker } from "@/components/DatePicker";
import { RecordPicker, type RefItem } from "@/components/RecordPicker";
import { FormError, Modal } from "@/components/ui";
import { legalEntityOptions, useLegalEntities, type LegalEntityBrief } from "@/hooks/useLegalEntities";

export type ContractType = "offtake" | "epc" | "supply" | "services" | "lease" | "other";
export type ContractStatus = "draft" | "approval" | "signing" | "active" | "completed" | "terminated";
export type VatMode = "none" | "on_top" | "included";

export type UserMini = { id: number; name: string; avatar_url?: string | null };

export type Contract = {
  id: number;
  number: string;
  date_signed: string | null;
  legal_entity_id: number | null;
  legal_entity: LegalEntityBrief | null;
  company_id: number | null;
  company: { id: number; name: string } | null;
  contract_type: ContractType;
  subject: string | null;
  amount: string | number | null;
  currency: string;
  vat_mode: VatMode;
  vat_rate: string | number;
  vat_amount: string | number | null;
  total_with_vat: string | number | null;
  valid_from: string | null;
  valid_until: string | null;
  days_left: number | null;
  auto_renewal: boolean;
  responsible_user_id: number | null;
  responsible: UserMini | null;
  lawyer_user_id: number | null;
  lawyer: UserMini | null;
  deal_id: number | null;
  deal: { id: number; name: string } | null;
  project_id: number | null;
  project: { id: number; name: string } | null;
  status: ContractStatus;
  allowed_statuses: ContractStatus[];
  note: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  files_count: number;
};

export type Person = { id: number; name: string; avatar_url?: string | null; position?: string | null; is_lawyer: boolean };

export const TYPE_LABEL: Record<ContractType, string> = {
  offtake: "Оффтейк",
  epc: "EPC",
  supply: "Поставка",
  services: "Услуги",
  lease: "Аренда",
  other: "Прочее",
};

export const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "Черновик",
  approval: "На согласовании",
  signing: "На подписании",
  active: "Действует",
  completed: "Исполнен",
  terminated: "Расторгнут",
};

const STATUS_CLASS: Record<ContractStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300",
  approval: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  signing: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  completed: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  terminated: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
};

export const VAT_LABEL: Record<VatMode, string> = {
  none: "Без НДС",
  on_top: "НДС сверху суммы",
  included: "Сумма включает НДС",
};

export const CURRENCIES = ["KZT", "USD", "EUR", "RUB", "CNY"];

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <span className={clsx("chip whitespace-nowrap", STATUS_CLASS[status])}>{STATUS_LABEL[status] ?? status}</span>;
}

export function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtMoney(v: string | number | null | undefined, currency = "KZT"): string {
  const n = toNum(v);
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toLocaleString("ru-RU")} ${currency}`;
  }
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
}

/** Описание НДС для карточки: «В т.ч. НДС 12%», «НДС 12% сверху», «Без НДС». */
export function vatText(c: Pick<Contract, "vat_mode" | "vat_rate">): string {
  const rate = toNum(c.vat_rate) ?? 0;
  const r = `${rate.toLocaleString("ru-RU")}%`;
  if (c.vat_mode === "on_top") return `НДС ${r} сверху`;
  if (c.vat_mode === "included") return `В т.ч. НДС ${r}`;
  return "Без НДС";
}

/** Подсветка срока: истёк / меньше 30 дней / меньше 60 дней (только для незакрытых договоров). */
export function expiryTone(c: Pick<Contract, "days_left" | "status">): "expired" | "soon" | "warn" | null {
  if (c.days_left === null || c.status === "completed" || c.status === "terminated") return null;
  if (c.days_left < 0) return "expired";
  if (c.days_left <= 30) return "soon";
  if (c.days_left <= 60) return "warn";
  return null;
}

export function ExpiryText({ c }: { c: Pick<Contract, "valid_from" | "valid_until" | "days_left" | "status" | "auto_renewal"> }) {
  const tone = expiryTone(c);
  if (!c.valid_until) return <span className="text-zinc-400">{c.valid_from ? `с ${fmtDate(c.valid_from)}` : "—"}</span>;
  const hint =
    tone === "expired"
      ? "срок истёк"
      : tone && c.days_left !== null
        ? c.days_left === 0
          ? "истекает сегодня"
          : `осталось ${c.days_left} дн.`
        : null;
  return (
    <span className="whitespace-nowrap">
      <span
        className={clsx(
          "tabular-nums",
          tone === "expired" && "font-medium text-rose-600 dark:text-rose-400",
          tone === "soon" && "font-medium text-amber-600 dark:text-amber-400",
          tone === "warn" && "text-amber-600/80 dark:text-amber-300/80",
        )}
      >
        до {fmtDate(c.valid_until)}
      </span>
      {hint && <span className="ml-1 text-[11.5px] text-zinc-500">({hint})</span>}
      {c.auto_renewal && <span className="ml-1 text-[11.5px] text-zinc-500">· автопролонгация</span>}
    </span>
  );
}

export function useContractPeople(enabled = true) {
  return useQuery({
    queryKey: ["contract-people"],
    queryFn: async () => (await api.get<Person[]>("/api/contracts/people")).data,
    staleTime: 60_000,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Форма договора
// ---------------------------------------------------------------------------

export type ContractDraft = {
  number?: string;
  date_signed?: string | null;
  legal_entity_id?: number | null;
  company_id?: number | null;
  company_name?: string | null;
  contract_type?: ContractType;
  subject?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  vat_mode?: VatMode;
  vat_rate?: string | number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  auto_renewal?: boolean;
  responsible_user_id?: number | null;
  lawyer_user_id?: number | null;
  deal_id?: number | null;
  deal_title?: string | null;
  project_id?: number | null;
  project_name?: string | null;
  note?: string | null;
};

export function contractToDraft(c: Contract): ContractDraft {
  return {
    number: c.number,
    date_signed: c.date_signed,
    legal_entity_id: c.legal_entity_id,
    company_id: c.company_id,
    company_name: c.company?.name ?? null,
    contract_type: c.contract_type,
    subject: c.subject,
    amount: c.amount,
    currency: c.currency,
    vat_mode: c.vat_mode,
    vat_rate: c.vat_rate,
    valid_from: c.valid_from,
    valid_until: c.valid_until,
    auto_renewal: c.auto_renewal,
    responsible_user_id: c.responsible_user_id,
    lawyer_user_id: c.lawyer_user_id,
    deal_id: c.deal_id,
    deal_title: c.deal?.name ?? null,
    project_id: c.project_id,
    project_name: c.project?.name ?? null,
    note: c.note,
  };
}

function numText(v: string | number | null | undefined): string {
  const n = toNum(v);
  return n === null ? "" : String(n);
}

/** Создание (contractId не задан) или редактирование договора. */
export function ContractFormModal({
  contractId,
  initial,
  onClose,
  onSaved,
}: {
  contractId?: number;
  initial: ContractDraft;
  onClose: () => void;
  onSaved: (c: Contract) => void;
}) {
  const qc = useQueryClient();
  const le = useLegalEntities();
  const people = useContractPeople();
  const [f, setF] = useState(() => ({
    number: initial.number ?? "",
    date_signed: initial.date_signed ?? "",
    legal_entity_id: initial.legal_entity_id ?? null,
    company_id: initial.company_id ?? null,
    contract_type: initial.contract_type ?? ("other" as ContractType),
    subject: initial.subject ?? "",
    amount: numText(initial.amount),
    currency: initial.currency || "KZT",
    vat_mode: initial.vat_mode ?? ("none" as VatMode),
    vat_rate: numText(initial.vat_rate ?? 12) || "12",
    valid_from: initial.valid_from ?? "",
    valid_until: initial.valid_until ?? "",
    auto_renewal: !!initial.auto_renewal,
    responsible_user_id: initial.responsible_user_id ?? null,
    lawyer_user_id: initial.lawyer_user_id ?? null,
    deal_id: initial.deal_id ?? null,
    project_id: initial.project_id ?? null,
    note: initial.note ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const knownCompany: RefItem[] = initial.company_id && initial.company_name ? [{ id: initial.company_id, label: initial.company_name }] : [];
  const knownDeal: RefItem[] = initial.deal_id && initial.deal_title ? [{ id: initial.deal_id, label: initial.deal_title }] : [];
  const knownProject: RefItem[] = initial.project_id && initial.project_name ? [{ id: initial.project_id, label: initial.project_name }] : [];

  const lawyers = (people.data ?? []).filter((p) => p.is_lawyer);
  const others = (people.data ?? []).filter((p) => !p.is_lawyer);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.number.trim()) return setError("Укажите номер договора");
    if (!f.company_id) return setError("Выберите контрагента");
    const amount = f.amount.trim() ? Number(f.amount.replace(/\s/g, "").replace(",", ".")) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return setError("Сумма должна быть положительным числом");
    const rate = Number(f.vat_rate.replace(",", "."));
    if (f.vat_mode !== "none" && (!Number.isFinite(rate) || rate < 0 || rate > 100)) return setError("Ставка НДС — число от 0 до 100");
    if (f.valid_from && f.valid_until && f.valid_until < f.valid_from) return setError("Дата окончания раньше даты начала");
    setBusy(true);
    setError(null);
    const body = {
      number: f.number.trim(),
      date_signed: f.date_signed || null,
      ...(le.multi || f.legal_entity_id ? { legal_entity_id: f.legal_entity_id } : {}),
      company_id: f.company_id,
      contract_type: f.contract_type,
      subject: f.subject.trim() || null,
      amount,
      currency: f.currency,
      vat_mode: f.vat_mode,
      vat_rate: f.vat_mode === "none" ? 12 : rate,
      valid_from: f.valid_from || null,
      valid_until: f.valid_until || null,
      auto_renewal: f.auto_renewal,
      responsible_user_id: f.responsible_user_id,
      lawyer_user_id: f.lawyer_user_id,
      deal_id: f.deal_id,
      project_id: f.project_id,
      note: f.note.trim() || null,
    };
    try {
      const saved = contractId
        ? (await api.patch<Contract>(`/api/contracts/${contractId}`, body)).data
        : (await api.post<Contract>("/api/contracts", body)).data;
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["contract", saved.id] });
      onSaved(saved);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const personOption = (p: Person) => (
    <option key={p.id} value={p.id}>
      {p.name}
      {p.position ? ` — ${p.position}` : ""}
    </option>
  );

  return (
    <Modal open onClose={onClose} title={contractId ? "Изменить договор" : "Новый договор"} size="xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Номер договора" required htmlFor="c-number">
            <input id="c-number" className="input" value={f.number} onChange={(e) => set("number", e.target.value)} maxLength={100} autoFocus />
          </FormField>
          <FormField label="Дата подписания">
            <DatePicker value={f.date_signed} onChange={(v) => set("date_signed", v)} aria-label="Дата подписания" />
          </FormField>
          <FormField label="Тип договора" htmlFor="c-type">
            <select id="c-type" className="input" value={f.contract_type} onChange={(e) => set("contract_type", e.target.value as ContractType)}>
              {(Object.keys(TYPE_LABEL) as ContractType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className={clsx("grid gap-4", le.multi && "sm:grid-cols-2")}>
          <FormField label="Контрагент" required>
            <RecordPicker
              target="company"
              value={f.company_id}
              known={knownCompany}
              onChange={(v) => set("company_id", (v as number | null) ?? null)}
              placeholder="Найдите компанию по названию или БИН"
            />
          </FormField>
          {le.multi && (
            <FormField label="Наше юрлицо" htmlFor="c-le">
              <select
                id="c-le"
                className="input"
                value={f.legal_entity_id ?? le.defaultEntity?.id ?? ""}
                onChange={(e) => set("legal_entity_id", Number(e.target.value) || null)}
              >
                {legalEntityOptions(le.all, f.legal_entity_id).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.short_name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </div>

        <FormField label="Предмет договора" htmlFor="c-subject">
          <textarea
            id="c-subject"
            className="input min-h-[64px]"
            value={f.subject}
            onChange={(e) => set("subject", e.target.value)}
            placeholder="Кратко: что поставляется, какие работы или услуги"
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-4">
          <FormField label="Сумма" htmlFor="c-amount" className="sm:col-span-2">
            <input
              id="c-amount"
              className="input tabular-nums"
              inputMode="decimal"
              value={f.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="Сумма по договору"
            />
          </FormField>
          <FormField label="Валюта" htmlFor="c-cur">
            <select id="c-cur" className="input" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              {Array.from(new Set([...CURRENCIES, f.currency])).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="НДС" htmlFor="c-vat">
            <select id="c-vat" className="input" value={f.vat_mode} onChange={(e) => set("vat_mode", e.target.value as VatMode)}>
              {(Object.keys(VAT_LABEL) as VatMode[]).map((m) => (
                <option key={m} value={m}>
                  {VAT_LABEL[m]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {f.vat_mode !== "none" && (
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField
              label="Ставка НДС, %"
              htmlFor="c-rate"
              hint={f.vat_mode === "on_top" ? "НДС начисляется сверх суммы" : "НДС уже входит в сумму"}
            >
              <input id="c-rate" className="input tabular-nums" inputMode="decimal" value={f.vat_rate} onChange={(e) => set("vat_rate", e.target.value)} />
            </FormField>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Действует с">
            <DatePicker value={f.valid_from} onChange={(v) => set("valid_from", v)} aria-label="Действует с" />
          </FormField>
          <FormField label="Действует до">
            <DatePicker value={f.valid_until} onChange={(v) => set("valid_until", v)} aria-label="Действует до" />
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={f.auto_renewal} onChange={(e) => set("auto_renewal", e.target.checked)} />
            Автопролонгация
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Ответственный" htmlFor="c-resp">
            <select
              id="c-resp"
              className="input"
              value={f.responsible_user_id ?? ""}
              onChange={(e) => set("responsible_user_id", Number(e.target.value) || null)}
            >
              <option value="">Не назначен</option>
              {(people.data ?? []).map(personOption)}
            </select>
          </FormField>
          <FormField label="Ответственный юрист" htmlFor="c-lawyer" hint={lawyers.length === 0 ? "Сотрудников с ролью «Юрист» пока нет — можно выбрать любого" : undefined}>
            <select
              id="c-lawyer"
              className="input"
              value={f.lawyer_user_id ?? ""}
              onChange={(e) => set("lawyer_user_id", Number(e.target.value) || null)}
            >
              <option value="">Не назначен</option>
              {lawyers.length > 0 && <optgroup label="Юристы">{lawyers.map(personOption)}</optgroup>}
              {lawyers.length > 0 ? <optgroup label="Остальные сотрудники">{others.map(personOption)}</optgroup> : others.map(personOption)}
            </select>
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Сделка">
            <RecordPicker
              target="deal"
              value={f.deal_id}
              known={knownDeal}
              onChange={(v) => set("deal_id", (v as number | null) ?? null)}
              placeholder="Найдите сделку по названию"
            />
          </FormField>
          <FormField label="Проект">
            <RecordPicker
              target="project"
              value={f.project_id}
              known={knownProject}
              onChange={(v) => set("project_id", (v as number | null) ?? null)}
              placeholder="Найдите проект по названию"
            />
          </FormField>
        </div>

        <FormField label="Примечание" htmlFor="c-note">
          <textarea id="c-note" className="input min-h-[56px]" value={f.note} onChange={(e) => set("note", e.target.value)} />
        </FormField>

        <FormError msg={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" isLoading={busy}>
            {contractId ? "Сохранить" : "Создать договор"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Обязательства по договору и ИИ
// ---------------------------------------------------------------------------

export type ObligationParty = "us" | "counterparty" | "both";

export type Obligation = {
  id: number;
  contract_id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  party: ObligationParty;
  status: "open" | "done";
  source_quote: string | null;
  created_by: number | null;
  created_at: string;
  done_at: string | null;
};

export const PARTY_LABEL: Record<ObligationParty, string> = {
  us: "Мы",
  counterparty: "Контрагент",
  both: "Обе стороны",
};

/** Файлы, которые ИИ умеет читать: PDF, DOCX и текстовые (как на сервере, services/ai_text.py). */
export function isAiReadable(name: string | null | undefined, mime?: string | null): boolean {
  const n = (name ?? "").toLowerCase();
  const m = (mime ?? "").toLowerCase();
  return (
    /\.(pdf|docx|txt|md|csv)$/.test(n) ||
    m === "application/pdf" ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    m.startsWith("text/")
  );
}

/** Дней до даты (отрицательное — просрочено). */
export function daysUntil(iso: string): number {
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
  const target = new Date(y, mo - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}
