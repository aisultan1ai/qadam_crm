import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Plus, Search, Trash2, BookUser, Building2, User as UserIcon, Pencil } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { EmptyState, Modal, Avatar, FieldError, FormError } from "@/components/ui";
import { SkeletonCard } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import type { Page } from "@/types";

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Контакты</h1>
          <p className="text-sm text-neutral-500">Адресная книга: люди и компании</p>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => setOpenCompany("new")}>
              <Plus size={15} /> Компания
            </button>
            <button className="btn-primary" onClick={() => setOpenContact("new")}>
              <Plus size={16} /> Контакт
            </button>
          </div>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Разделы контактов"
        className="flex flex-wrap items-center gap-1 border-b border-neutral-200 dark:border-neutral-800"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={clsx(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-brand-600 font-medium text-brand-700 dark:border-brand-400 dark:text-brand-300"
                  : "border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white",
              )}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
        <input
          className="input pl-8"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

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

  const { data, isPending } = useQuery({
    queryKey: ["contacts", q, scope],
    queryFn: async () =>
      (
        await api.get<Page<Contact>>("/api/contacts", {
          params: { q: q || undefined, scope: scope === "all" ? undefined : scope, per_page: 200 },
        })
      ).data.items,
  });

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

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<UserIcon size={32} />}
        title={q ? "По запросу ничего не найдено" : "Контактов пока нет"}
        description={q ? "Попробуйте другой запрос" : "Добавьте первый контакт — начните собирать базу"}
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {data.map((c) => (
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
                <button className="btn-ghost !p-1.5" onClick={() => onEdit(c)} title="Редактировать">
                  <Pencil size={14} />
                </button>
              )}
              {canDelete && (
                <button
                  className="btn-ghost !p-1.5 text-rose-500"
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
                </button>
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

  const { data, isPending } = useQuery({
    queryKey: ["companies", q],
    queryFn: async () =>
      (await api.get<Page<Company>>("/api/companies", { params: { q: q || undefined, per_page: 200 } })).data.items,
  });

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

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Building2 size={32} />}
        title={q ? "По запросу ничего не найдено" : "Компаний пока нет"}
        description={q ? "Попробуйте другой запрос" : "Добавьте первую компанию — организации-клиенты"}
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {data.map((c) => (
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
                <button className="btn-ghost !p-1.5" onClick={() => onEdit(c)} title="Редактировать">
                  <Pencil size={14} />
                </button>
              )}
              {canDelete && (
                <button
                  className="btn-ghost !p-1.5 text-rose-500"
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
                </button>
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
  );
}

// ============================================================================
// Modals
// ============================================================================

function ContactModal({ initial, onClose }: { initial: Contact | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(initial?.first_name || "");
  const [lastName, setLastName] = useState(initial?.last_name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [position, setPosition] = useState(initial?.position || "");
  const [companyId, setCompanyId] = useState<number | "">(initial?.company?.id ?? "");
  const [note, setNote] = useState(initial?.note || "");

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/api/companies")).data.items,
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        first_name: firstName,
        last_name: lastName || null,
        email: email || null,
        phone: phone || null,
        position: position || null,
        company_id: companyId === "" ? null : Number(companyId),
        note: note || null,
      };
      if (initial) return api.patch(`/api/contacts/${initial.id}`, body);
      return api.post(`/api/contacts`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  const invalid = !firstName.trim();

  return (
    <Modal open onClose={onClose} title={initial ? "Редактировать контакт" : "Новый контакт"} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate();
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Имя *</span>
            <input className="input" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <FieldError msg={invalid ? "Обязательно" : undefined} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Фамилия</span>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Телефон</span>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Должность</span>
          <input className="input" value={position} onChange={(e) => setPosition(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Компания</span>
          <select
            className="input"
            value={companyId === "" ? "" : String(companyId)}
            onChange={(e) => setCompanyId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">— Без компании —</option>
            {companies?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Заметка</span>
          <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={invalid || save.isPending}>
            {initial ? "Сохранить" : "Создать"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompanyModal({ initial, onClose }: { initial: Company | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name || "");
  const [industry, setIndustry] = useState(initial?.industry || "");
  const [website, setWebsite] = useState(initial?.website || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [taxId, setTaxId] = useState(initial?.tax_id || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [note, setNote] = useState(initial?.note || "");

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        industry: industry || null,
        website: website || null,
        email: email || null,
        phone: phone || null,
        tax_id: taxId || null,
        address: address || null,
        note: note || null,
      };
      if (initial) return api.patch(`/api/companies/${initial.id}`, body);
      return api.post(`/api/companies`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  const invalid = !name.trim();

  return (
    <Modal open onClose={onClose} title={initial ? "Редактировать компанию" : "Новая компания"} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate();
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название *</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <FieldError msg={invalid ? "Обязательно" : undefined} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Отрасль</span>
            <input className="input" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Сайт</span>
            <input className="input" placeholder="example.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Телефон</span>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">БИН / Tax ID</span>
          <input className="input" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Адрес</span>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Заметка</span>
          <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={invalid || save.isPending}>
            {initial ? "Сохранить" : "Создать"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
