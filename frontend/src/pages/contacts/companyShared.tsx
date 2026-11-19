/**
 * Контрагенты: общие типы, подписи типов/статусов и форма компании —
 * используются в списке «Контакты → Компании» и в карточке компании.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { Modal, FormError } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { companySchema, type CompanyForm } from "@/lib/validation";
import { fetchAllUsers } from "@/lib/users";

export type UserBrief = { id: number; name: string; email: string; avatar_url?: string | null };

export type CompanyType = "buyer" | "epc" | "supplier" | "consultant" | "bank" | "government";
export type CompanyStatus = "potential" | "nda" | "active" | "blocked";

export type Company = {
  id: number;
  name: string;
  industry?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  tax_id?: string | null;
  address?: string | null;
  note?: string | null;
  owner?: UserBrief | null;
  contacts_count: number;
  created_at: string;
  country?: string | null;
  registration_number?: string | null;
  types?: CompanyType[] | null;
  responsible_user_id?: number | null;
  responsible?: UserBrief | null;
  status?: CompanyStatus | null;
};

export const COMPANY_TYPES: { key: CompanyType; label: string }[] = [
  { key: "buyer", label: "Покупатель / offtaker" },
  { key: "epc", label: "EPC-подрядчик" },
  { key: "supplier", label: "Поставщик" },
  { key: "consultant", label: "Консультант" },
  { key: "bank", label: "Банк" },
  { key: "government", label: "Госорган" },
];
export const COMPANY_TYPE_LABEL = Object.fromEntries(COMPANY_TYPES.map((t) => [t.key, t.label])) as Record<CompanyType, string>;

export const COMPANY_STATUSES: { key: CompanyStatus; label: string; tone: string }[] = [
  { key: "potential", label: "Потенциальный", tone: "bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300" },
  { key: "nda", label: "NDA", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  { key: "active", label: "Активный", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  { key: "blocked", label: "Заблокирован", tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
];

export function CompanyStatusBadge({ status }: { status?: CompanyStatus | null }) {
  const s = COMPANY_STATUSES.find((x) => x.key === (status || "potential")) ?? COMPANY_STATUSES[0];
  return <span className={clsx("chip", s.tone)}>{s.label}</span>;
}

export function CompanyTypeBadges({ types }: { types?: CompanyType[] | null }) {
  if (!types || types.length === 0) return null;
  return (
    <>
      {types.map((t) => (
        <span key={t} className="chip bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          {COMPANY_TYPE_LABEL[t] ?? t}
        </span>
      ))}
    </>
  );
}

export function useTeamMembers() {
  return useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => fetchAllUsers(),
    staleTime: 60_000,
  });
}

export function CompanyModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Company | null;
  onClose: () => void;
  onSaved?: (c: Company) => void;
}) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [types, setTypes] = useState<CompanyType[]>(initial?.types ?? []);
  const [status, setStatus] = useState<CompanyStatus>(initial?.status ?? "potential");
  const [responsible, setResponsible] = useState<string>(initial?.responsible_user_id ? String(initial.responsible_user_id) : "");
  const [country, setCountry] = useState<string>(initial ? initial.country ?? "" : "Казахстан");
  const [regNo, setRegNo] = useState<string>(initial?.registration_number ?? "");
  const { data: users } = useTeamMembers();

  const isKz = !country.trim() || country.trim().toLowerCase() === "казахстан";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: initial?.name || "",
      industry: initial?.industry || "",
      website: initial?.website || "",
      email: initial?.email || "",
      phone: initial?.phone || "",
      tax_id: initial?.tax_id || "",
      address: initial?.address || "",
      note: initial?.note || "",
    },
  });

  const toggleType = (t: CompanyType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    const body = {
      name: data.name,
      industry: data.industry || null,
      website: data.website || null,
      email: data.email || null,
      phone: data.phone || null,
      tax_id: data.tax_id || null,
      address: data.address || null,
      note: data.note || null,
      country: country.trim() || null,
      registration_number: regNo.trim() || null,
      types,
      status,
      responsible_user_id: responsible ? Number(responsible) : initial ? 0 : null,
    };
    try {
      const saved = initial
        ? (await api.patch<Company>(`/api/companies/${initial.id}`, body)).data
        : (await api.post<Company>(`/api/companies`, body)).data;
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["company", saved.id] });
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setServerError(extractApiError(e).message);
    }
  });

  return (
    <Modal open onClose={onClose} title={initial ? "Редактировать компанию" : "Новая компания"} size="lg">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormField label="Название" required error={errors.name?.message}>
          <input className="input" autoFocus {...register("name")} />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Статус">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as CompanyStatus)}>
              {COMPANY_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Ответственный">
            <select className="input" value={responsible} onChange={(e) => setResponsible(e.target.value)}>
              <option value="">Не назначен</option>
              {users?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="Тип контрагента" hint="Можно выбрать несколько">
          <div className="flex flex-wrap gap-1.5">
            {COMPANY_TYPES.map((t) => {
              const on = types.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleType(t.key)}
                  className={clsx(
                    "rounded-md border px-2 py-1 text-[13px] transition-colors",
                    on
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-300"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Страна">
            <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={100} />
          </FormField>
          {isKz ? (
            <FormField label="БИН" error={errors.tax_id?.message}>
              <input className="input tabular-nums" inputMode="numeric" placeholder="12 цифр" {...register("tax_id")} />
            </FormField>
          ) : (
            <FormField label="Регистрационный номер" hint="Номер в реестре страны регистрации">
              <input className="input" value={regNo} onChange={(e) => setRegNo(e.target.value)} maxLength={100} />
            </FormField>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Отрасль" error={errors.industry?.message}>
            <input className="input" {...register("industry")} />
          </FormField>
          <FormField label="Сайт" error={errors.website?.message} hint="По домену сайта и почты находится переписка">
            <input className="input" placeholder="Адрес сайта" {...register("website")} />
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Email" error={errors.email?.message}>
            <input className="input" type="email" {...register("email")} />
          </FormField>
          <FormField label="Телефон" error={errors.phone?.message}>
            <input className="input" {...register("phone")} />
          </FormField>
        </div>
        <FormField label="Адрес" error={errors.address?.message}>
          <input className="input" {...register("address")} />
        </FormField>
        <FormField label="Заметка" error={errors.note?.message}>
          <textarea className="input min-h-[80px]" {...register("note")} />
        </FormField>
        <FormError msg={serverError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            {initial ? "Сохранить" : "Создать"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
