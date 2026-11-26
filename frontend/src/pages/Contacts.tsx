import { useEffect, useState } from "react";
import { useNewParam } from "@/hooks/useNewParam";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Plus, Search, Trash2, BookUser, Building2, User as UserIcon, Pencil, Sparkles, ImageUp } from "lucide-react";
import { useAi } from "@/hooks/useAi";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EmptyState, Modal, Avatar, FormError } from "@/components/ui";
import { Pagination } from "@/components/lib/Pagination";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { contactSchema, type ContactForm } from "@/lib/validation";
import { SkeletonCard } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import type { Page } from "@/types";
import { useOpenParam } from "@/hooks/useOpenParam";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { FilterSelect, SearchInput, Tabs, Toolbar } from "@/components/page";
import {
  COMPANY_STATUSES, COMPANY_TYPES, CompanyModal, CompanyStatusBadge, CompanyTypeBadges, useTeamMembers,
  type Company,
} from "./contacts/companyShared";
// ============================================================================
// Types
// ============================================================================

type UserBrief = { id: number; name: string; email: string; avatar_url?: string | null };
type CompanyBrief = { id: number; name: string };

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
  const nav = useNavigate();
  const [sp] = useSearchParams();

  const canCreate = can("contacts.create");
  useNewParam(() => setOpenContact("new"), canCreate);
  useNewParam(() => {
    setTab("companies");
    setOpenCompany("new");
  }, canCreate, "company");
  const canRead = can("contacts.view");
  // Ссылки из связей Объектов: /contacts?contact=12, /contacts?company=5
  useOpenParam<Contact>("contact", (id) => `/api/contacts/${id}`, setOpenContact, canRead);
  // /contacts?company=5 (ссылки из связей, превью записей) — открывает карточку контрагента
  const companyParam = sp.get("company");
  useEffect(() => {
    if (canRead && companyParam && /^\d+$/.test(companyParam)) nav(`/contacts/companies/${companyParam}`, { replace: true });
  }, [companyParam, canRead, nav]);

  if (!canRead) {
    return (
      <EmptyState
        icon={<BookUser size={32} />}
        title="Нет доступа к контактам"
        description="В вашей роли нет права на просмотр контактов. Его может выдать администратор компании."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <div className="mb-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">Продажи</div>
          <h1 className="page-title">Компании и контакты</h1>
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

      {tab !== "companies" && <SearchInput value={q} onChange={setQ} placeholder="Поиск" />}

      {tab === "companies" ? (
        <CompaniesList q={q} setQ={setQ} onEdit={setOpenCompany} />
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
          onSaved={(c) => {
            if (openCompany === "new") nav(`/contacts/companies/${c.id}`);
          }}
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
        description={q ? "Попробуйте другой запрос" : "Люди у клиентов, поставщиков и подрядчиков: должность, телефон, почта и компания."}
        help={q ? undefined : "contacts"}
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

function CompaniesList({ q, setQ, onEdit }: { q: string; setQ: (v: string) => void; onEdit: (c: Company) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const { data: users } = useTeamMembers();

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [responsible, setResponsible] = useState("");
  useEffect(() => { setPage(1); }, [q, perPage, type, status, responsible]);
  const filtered = !!(q || type || status || responsible);

  const { data, isPending } = useQuery({
    queryKey: ["companies", q, page, perPage, type, status, responsible],
    queryFn: async () =>
      (await api.get<Page<Company>>("/api/companies", {
        params: {
          q: q || undefined,
          type: type || undefined,
          status: status || undefined,
          responsible_user_id: responsible || undefined,
          per_page: perPage,
          page,
        },
      })).data,
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

  const toolbar = (
    <Toolbar>
      <SearchInput value={q} onChange={setQ} placeholder="Название, отрасль, БИН или рег. номер" />
      <FilterSelect label="Тип" value={type} onChange={setType}>
        <option value="">Все типы</option>
        {COMPANY_TYPES.map((t) => (
          <option key={t.key} value={t.key}>{t.label}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Статус" value={status} onChange={setStatus}>
        <option value="">Все статусы</option>
        {COMPANY_STATUSES.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </FilterSelect>
      <FilterSelect label="Ответственный" value={responsible} onChange={setResponsible}>
        <option value="">Все ответственные</option>
        {users?.map((u) => (
          <option key={u.id} value={String(u.id)}>{u.name}</option>
        ))}
      </FilterSelect>
      {filtered && (
        <Button variant="ghost" size="sm" onClick={() => { setQ(""); setType(""); setStatus(""); setResponsible(""); }}>
          Сбросить
        </Button>
      )}
    </Toolbar>
  );

  if (isPending) {
    return (
      <div className="space-y-3">
        {toolbar}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="space-y-3">
        {toolbar}
        <EmptyState
          icon={<Building2 size={32} />}
          title={filtered ? "По фильтру ничего не найдено" : "Компаний пока нет"}
          description={filtered ? "Измените запрос или сбросьте фильтры" : "Клиенты, поставщики, подрядчики, банки и госорганы с БИН. Список можно загрузить из Excel или выгрузки 1С."}
          help={filtered ? undefined : "contacts"}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
    {toolbar}
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => (
        <div
          key={c.id}
          className="card-interactive group flex cursor-pointer flex-col gap-2 p-4"
          onClick={() => nav(`/contacts/companies/${c.id}`)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                <Building2 size={20} />
              </div>
              <div className="min-w-0">
                <Link
                  to={`/contacts/companies/${c.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="block truncate font-semibold hover:text-brand-700 dark:hover:text-brand-300"
                >
                  {c.name}
                </Link>
                {(c.industry || c.tax_id || c.registration_number) && (
                  <div className="truncate text-xs text-neutral-500">
                    {[c.industry, c.tax_id ? `БИН ${c.tax_id}` : c.registration_number].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            </div>
            <div className="flex opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
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
          <div className="flex flex-wrap gap-1">
            <CompanyStatusBadge status={c.status} />
            <CompanyTypeBadges types={c.types} />
          </div>
          <div className="space-y-0.5 text-sm" onClick={(e) => e.stopPropagation()}>
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
          <div className="mt-auto flex items-center justify-between gap-2 text-xs text-neutral-500">
            <span>{c.contacts_count} контактов</span>
            {c.responsible && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Avatar name={c.responsible.name} url={c.responsible.avatar_url} size={18} />
                <span className="truncate">{c.responsible.name}</span>
              </span>
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
// Modals
// ============================================================================

function ContactModal({ initial, onClose }: { initial: Contact | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/api/companies")).data.items,
  });

  const { available: aiAvailable } = useAi();
  const [aiOpen, setAiOpen] = useState(false);
  // Компания, которую нашли по визитке, но её ещё нет в списке выбора
  const [extraCompany, setExtraCompany] = useState<CompanyBrief | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
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
        {!initial && aiAvailable && (
          aiOpen ? (
            <ContactFromSignature
              onClose={() => setAiOpen(false)}
              onApply={(r, companyId, companyName) => {
                const opts = { shouldDirty: true, shouldValidate: true } as const;
                if (r.person.first_name || r.person.name) setValue("first_name", r.person.first_name || r.person.name || "", opts);
                if (r.person.last_name) setValue("last_name", r.person.last_name, opts);
                if (r.person.email) setValue("email", r.person.email, opts);
                if (r.person.phone) setValue("phone", r.person.phone, opts);
                if (r.person.position) setValue("position", r.person.position, opts);
                if (companyId) {
                  if (!companies?.some((c) => c.id === companyId)) setExtraCompany({ id: companyId, name: companyName || `#${companyId}` });
                  setValue("company_id", companyId as any, opts);
                }
                setAiOpen(false);
              }}
            />
          ) : (
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="secondary" leftIcon={<Sparkles size={13} />} onClick={() => setAiOpen(true)}>
                Заполнить из подписи/визитки
              </Button>
            </div>
          )
        )}
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
            {extraCompany && !companies?.some((c) => c.id === extraCompany.id) && (
              <option value={extraCompany.id}>{extraCompany.name}</option>
            )}
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

// ============================================================================
// ИИ: контакт из подписи письма или фото визитки
// ============================================================================

type ExtractResult = {
  person: {
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
    email: string | null;
    phone: string | null;
  };
  company: { name: string | null; website: string | null; phone: string | null; address: string | null };
  existing_company_id: number | null;
  existing_company_name: string | null;
};

const MAX_CARD_BYTES = 5 * 1024 * 1024;

function ContactFromSignature({
  onApply,
  onClose,
}: {
  onApply: (r: ExtractResult, companyId: number | null, companyName: string | null) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ name: string; data: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [createCompany, setCreateCompany] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const pickFile = (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (!["image/jpeg", "image/png"].includes(f.type)) return setFileError("Подойдёт фото в формате JPEG или PNG");
    if (f.size > MAX_CARD_BYTES) return setFileError("Фото больше 5 МБ — уменьшите его и попробуйте снова");
    const reader = new FileReader();
    reader.onload = () => setImage({ name: f.name, data: String(reader.result) });
    reader.onerror = () => setFileError("Не удалось прочитать файл");
    reader.readAsDataURL(f);
  };

  const run = useMutation({
    mutationFn: async () =>
      (
        await api.post<ExtractResult>("/api/ai/contacts/extract", {
          text: text.trim() || null,
          image: image?.data ?? null,
        })
      ).data,
    onSuccess: (r) => {
      setResult(r);
      setCreateCompany(false);
    },
  });

  const apply = async () => {
    if (!result) return;
    setApplyError(null);
    let companyId = result.existing_company_id;
    let companyName = result.existing_company_name;
    if (!companyId && createCompany && result.company.name) {
      setApplying(true);
      try {
        const c = (
          await api.post<{ id: number; name: string }>("/api/companies", {
            name: result.company.name,
            website: result.company.website,
            phone: result.company.phone,
            address: result.company.address,
          })
        ).data;
        companyId = c.id;
        companyName = c.name;
        qc.invalidateQueries({ queryKey: ["companies"] });
      } catch (e) {
        setApplying(false);
        return setApplyError(extractApiError(e).message);
      }
      setApplying(false);
    }
    onApply(result, companyId, companyName);
  };

  const p = result?.person;
  const c = result?.company;
  const rows: [string, string | null | undefined][] = p
    ? [
        ["Имя", p.name],
        ["Должность", p.position],
        ["Email", p.email],
        ["Телефон", p.phone],
      ]
    : [];
  const companyRows: [string, string | null | undefined][] = c
    ? [
        ["Компания", c.name],
        ["Сайт", c.website],
        ["Телефон компании", c.phone],
        ["Адрес", c.address],
      ]
    : [];
  const nothing = result && [...rows, ...companyRows].every(([, v]) => !v);

  return (
    <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-sm dark:border-brand-900/50 dark:bg-brand-950/20">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-brand-600 dark:text-brand-300" />
        <span className="font-medium">Заполнить из подписи или визитки</span>
        <button type="button" className="ml-auto text-xs text-zinc-500 hover:underline" onClick={onClose}>
          Скрыть
        </button>
      </div>
      {!result ? (
        <>
          <textarea
            className="input min-h-[90px]"
            maxLength={20000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Вставьте подпись из письма: имя, должность, телефон, компания"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn-secondary !cursor-pointer !px-3 !py-1.5 !text-xs">
              <ImageUp size={13} className="mr-1 inline" />
              {image ? "Другое фото" : "Фото визитки"}
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {image && (
              <span className="flex min-w-0 items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                <span className="truncate">{image.name}</span>
                <button type="button" className="text-rose-600 hover:underline" onClick={() => setImage(null)}>
                  убрать
                </button>
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="ml-auto"
              isLoading={run.isPending}
              disabled={!text.trim() && !image}
              onClick={() => run.mutate()}
            >
              Распознать
            </Button>
          </div>
          <FormError msg={fileError || (run.isError ? extractApiError(run.error).message : null)} />
        </>
      ) : nothing ? (
        <div className="space-y-2">
          <div className="text-zinc-600 dark:text-zinc-300">Контактных данных в тексте или на фото не нашлось.</div>
          <Button type="button" size="sm" variant="secondary" onClick={() => setResult(null)}>
            Попробовать другой текст
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            {[...rows, ...companyRows]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="min-w-0 break-words">{v}</dd>
                </div>
              ))}
          </dl>
          {result.existing_company_id ? (
            <div className="text-xs text-emerald-700 dark:text-emerald-400">
              Компания «{result.existing_company_name}» уже есть в базе — контакт будет привязан к ней.
            </div>
          ) : c?.name ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={createCompany} onChange={(e) => setCreateCompany(e.target.checked)} />
              Компании «{c.name}» нет в базе — создать её с этими данными
            </label>
          ) : null}
          <div className="text-xs text-zinc-500">Данные распознал ИИ — проверьте поля формы перед сохранением.</div>
          <FormError msg={applyError} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setResult(null)}>
              Назад
            </Button>
            <Button type="button" size="sm" variant="primary" isLoading={applying} onClick={apply}>
              Подставить в форму
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
