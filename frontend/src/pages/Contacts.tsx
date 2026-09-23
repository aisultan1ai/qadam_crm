import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Plus, Search, Trash2, BookUser, Building2, User as UserIcon, Pencil } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EmptyState, Modal, Avatar, FormError } from "@/components/ui";
import { Pagination } from "@/components/lib/Pagination";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { contactSchema, companySchema, type ContactForm, type CompanyForm } from "@/lib/validation";
import { SkeletonCard } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import type { Page } from "@/types";

import { SearchInput, Tabs } from "@/components/page";
// ============================================================================
// Types
// ============================================================================

type UserBrief = { id: number; name: string; email: string; avatar_url?: string | null };
type CompanyBrief = { id: number; name: string };

type Company = {
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
};

type Contact = {
  id: number;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  note?: string | null;
  source?: string | null;
  company?: CompanyBrief | null;
  owner?: UserBrief | null;
  created_at: string;
};

type Tab = "contacts" | "companies" | "mine";

const TABS: { key: Tab; label: string; icon: typeof UserIcon }[] = [
  { key: "contacts", label: "Контакты", icon: UserIcon },
  { key: "companies", label: "Компании", icon: Building2 },
  { key: "mine", label: "Мои", icon: BookUser },
];

// ============================================================================
// Page
// ============================================================================

export default function Contacts() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("contacts");
  const [q, setQ] = useState("");
  const [openContact, setOpenContact] = useState<Contact | "new" | null>(null);
  const [openCompany, setOpenCompany] = useState<Company | "new" | null>(null);

  const canCreate = can("contacts.create");
  const canRead = can("contacts.view");

  if (!canRead) {
    return (
      <EmptyState
        icon={<BookUser size={32} />}
        title="Нет доступа к контактам"
        description="Обратитесь к администратору для получения права contacts.view"
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Контакты</h1>
          <p className="page-subtitle">Адресная книга: люди и компании</p>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setOpenCompany("new")}>
              <Plus size={15} /> Компания
            </Button>
            <Button variant="primary" onClick={() => setOpenContact("new")}>
              <Plus size={16} /> Контакт
            </Button>
          </div>
        )}
      </div>

      <Tabs label="Разделы контактов" value={tab} onChange={setTab} items={TABS} />

      <SearchInput value={q} onChange={setQ} placeholder="Поиск" />

      {tab === "companies" ? (
        <CompaniesList q={q} onEdit={setOpenCompany} />
      ) : (
        <ContactsList q={q} scope={tab === "mine" ? "mine" : "all"} onEdit={setOpenContact} />
      )}

      {openContact && (
        <ContactModal
          initial={openContact === "new" ? null : openContact}
          onClose={() => setOpenContact(null)}
        />
      )}
      {openCompany && (
        <CompanyModal
          initial={openCompany === "new" ? null : openCompany}
          onClose={() => setOpenCompany(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Contacts list
// ============================================================================

function ContactsList({
  q,
  scope,
  onEdit,
}: {
  q: string;
  scope: "all" | "mine";
  onEdit: (c: Contact) => void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  useEffect(() => { setPage(1); }, [q, scope, perPage]);

  const { data, isPending } = useQuery({
    queryKey: ["contacts", q, scope, page, perPage],
    queryFn: async () =>
      (
        await api.get<Page<Contact>>("/api/contacts", {
          params: { q: q || undefined, scope: scope === "all" ? undefined : scope, per_page: perPage, page },
        })
      ).data,
  });
  const items = data?.items;
  const total = data?.total ?? 0;

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Контакт удалён");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const canDelete = can("contacts.delete");
  const canUpdate = can("contacts.update");

  if (isPending) {
    return (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <EmptyState
        icon={<UserIcon size={32} />}
        title={q ? "По запросу ничего не найдено" : "Контактов пока нет"}
        description={q ? "Попробуйте другой запрос" : "Добавьте первый контакт — начните собирать базу"}
      />
    );
  }

  return (
    <div className="space-y-3">
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => (
        <div key={c.id} className="card-interactive group flex flex-col gap-2 p-4">
          <div className="flex items-start gap-3">
            <Avatar name={`${c.first_name} ${c.last_name || ""}`.trim()} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {c.first_name} {c.last_name || ""}
              </div>
              {c.position && (
                <div className="truncate text-xs text-neutral-500">{c.position}</div>
              )}
              {c.company && (
                <div className="truncate text-xs text-neutral-500">
                  <Building2 size={11} className="mr-1 inline" />
                  {c.company.name}
                </div>
              )}
            </div>
            <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
              {canUpdate && (
                <Button variant="ghost" size="icon" onClick={() => onEdit(c)} title="Редактировать">
                  <Pencil size={14} />
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-rose-500"
                  onClick={() =>
                    confirm({
                      title: "Удалить контакт?",
                      message: `«${c.first_name} ${c.last_name || ""}» будет удалён.`,
                      danger: true,
                      confirmLabel: "Удалить",
                      onConfirm: () => del.mutateAsync(c.id),
                    })
                  }
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-0.5 text-sm">
            {c.email && (
              <a href={`mailto:${c.email}`} className="block truncate text-brand-700 hover:underline dark:text-brand-300">
                {c.email}
              </a>
            )}
            {c.phone && (
              <a href={`tel:${c.phone}`} className="block truncate text-neutral-600 hover:underline dark:text-neutral-400">
                {c.phone}
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
    <Pagination
      page={page}
      perPage={perPage}
      total={total}
      onPageChange={setPage}
      onPerPageChange={setPerPage}
    />
    </div>
  );
}

// ============================================================================
// Companies list
// ============================================================================

function CompaniesList({ q, onEdit }: { q: string; onEdit: (c: Company) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  useEffect(() => { setPage(1); }, [q, perPage]);

  const { data, isPending } = useQuery({
    queryKey: ["companies", q, page, perPage],
    queryFn: async () =>
      (await api.get<Page<Company>>("/api/companies", { params: { q: q || undefined, per_page: perPage, page } })).data,
  });
  const items = data?.items;
  const total = data?.total ?? 0;

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/companies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Компания удалена");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const canDelete = can("contacts.delete");
  const canUpdate = can("contacts.update");

  if (isPending) {
    return (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <EmptyState
        icon={<Building2 size={32} />}
        title={q ? "По запросу ничего не найдено" : "Компаний пока нет"}
        description={q ? "Попробуйте другой запрос" : "Добавьте первую компанию — организации-клиенты"}
      />
    );
  }

  return (
    <div className="space-y-3">
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => (
        <div key={c.id} className="card-interactive group flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                <Building2 size={20} />
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{c.name}</div>
                {c.industry && (
                  <div className="truncate text-xs text-neutral-500">{c.industry}</div>
                )}
              </div>
            </div>
            <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
              {canUpdate && (
                <Button variant="ghost" size="icon" onClick={() => onEdit(c)} title="Редактировать">
                  <Pencil size={14} />
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-rose-500"
                  onClick={() =>
                    confirm({
                      title: "Удалить компанию?",
                      message: `«${c.name}» будет удалена. Связанные контакты останутся без компании.`,
                      danger: true,
                      confirmLabel: "Удалить",
                      onConfirm: () => del.mutateAsync(c.id),
                    })
                  }
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-0.5 text-sm">
            {c.website && (
              <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer" className="block truncate text-brand-700 hover:underline dark:text-brand-300">
                {c.website}
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="block truncate text-neutral-600 hover:underline dark:text-neutral-400">
                {c.email}
              </a>
            )}
            {c.phone && (
              <a href={`tel:${c.phone}`} className="block truncate text-neutral-600 hover:underline dark:text-neutral-400">
                {c.phone}
              </a>
            )}
          </div>
          <div className="mt-auto text-xs text-neutral-500">{c.contacts_count} контактов</div>
        </div>
      ))}
    </div>
    <Pagination
      page={page}
      perPage={perPage}
      total={total}
      onPageChange={setPage}
      onPerPageChange={setPerPage}
    />
    </div>
  );
}

// ============================================================================
// Modals
// ============================================================================

function ContactModal({ initial, onClose }: { initial: Contact | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/api/companies")).data.items,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      first_name: initial?.first_name || "",
      last_name: initial?.last_name || "",
      email: initial?.email || "",
      phone: initial?.phone || "",
      position: initial?.position || "",
      company_id: (initial?.company?.id ?? "") as any,
      note: initial?.note || "",
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    const body = {
      first_name: data.first_name,
      last_name: data.last_name || null,
      email: data.email || null,
      phone: data.phone || null,
      position: data.position || null,
      company_id: data.company_id === "" || data.company_id == null ? null : Number(data.company_id),
      note: data.note || null,
    };
    try {
      if (initial) await api.patch(`/api/contacts/${initial.id}`, body);
      else await api.post(`/api/contacts`, body);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      onClose();
    } catch (e) {
      setServerError(extractApiError(e).message);
    }
  });

  return (
    <Modal open onClose={onClose} title={initial ? "Редактировать контакт" : "Новый контакт"} size="md">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Имя" required error={errors.first_name?.message}>
            <input className="input" autoFocus {...register("first_name")} />
          </FormField>
          <FormField label="Фамилия" error={errors.last_name?.message}>
            <input className="input" {...register("last_name")} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Email" error={errors.email?.message}>
            <input className="input" type="email" {...register("email")} />
          </FormField>
          <FormField label="Телефон" error={errors.phone?.message}>
            <input className="input" {...register("phone")} />
          </FormField>
        </div>
        <FormField label="Должность" error={errors.position?.message}>
          <input className="input" {...register("position")} />
        </FormField>
        <FormField label="Компания">
          <select className="input" {...register("company_id")}>
            <option value="">— Без компании —</option>
            {companies?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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

function CompanyModal({ initial, onClose }: { initial: Company | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

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
    };
    try {
      if (initial) await api.patch(`/api/companies/${initial.id}`, body);
      else await api.post(`/api/companies`, body);
      qc.invalidateQueries({ queryKey: ["companies"] });
      onClose();
    } catch (e) {
      setServerError(extractApiError(e).message);
    }
  });

  return (
    <Modal open onClose={onClose} title={initial ? "Редактировать компанию" : "Новая компания"} size="md">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormField label="Название" required error={errors.name?.message}>
          <input className="input" autoFocus {...register("name")} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Отрасль" error={errors.industry?.message}>
            <input className="input" {...register("industry")} />
          </FormField>
          <FormField label="Сайт" error={errors.website?.message}>
            <input className="input" placeholder="example.com" {...register("website")} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Email" error={errors.email?.message}>
            <input className="input" type="email" {...register("email")} />
          </FormField>
          <FormField label="Телефон" error={errors.phone?.message}>
            <input className="input" {...register("phone")} />
          </FormField>
        </div>
        <FormField label="БИН / Tax ID" error={errors.tax_id?.message}>
          <input className="input" {...register("tax_id")} />
        </FormField>
        <FormField label="Адрес" error={errors.address?.message}>
          <input className="input" {...register("address")} />
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
