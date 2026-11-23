/**
 * Карточка контрагента: свойства слева-справа и вкладки
 * «Контакты», «Сделки», «Договоры», «Документы», «Переписка», «Хроника».
 * Открывается по /contacts/companies/:id (и по старой ссылке /contacts?company=:id).
 */
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Building2, Coins, FileSignature, FileText, Globe, Hash, Mail, MapPin, Pencil, Phone, Trash2, Upload,
  User as UserIcon, Users,
} from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Avatar, EmptyState, Loader } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { DetailLayout, PageHeader, Panel, PropertyList, PropertyRow, Tabs } from "@/components/page";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { DocumentMetaModal } from "@/components/DocumentMetaModal";
import { useLegalEntities } from "@/hooks/useLegalEntities";
import { useOfftakeSettings } from "@/hooks/useOfftake";
import { activityText } from "@/lib/activityLabels";
import { formatDateTime, fromNow } from "@/lib/date";
import type { Page } from "@/types";
import {
  CompanyModal, CompanyStatusBadge, CompanyTypeBadges, type Company,
} from "./contacts/companyShared";
import CompanyContractsTab from "./contacts/CompanyContractsTab";

type TabKey = "contacts" | "deals" | "contracts" | "documents" | "mail" | "timeline";

type ContactRow = {
  id: number;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
};

type DealRow = {
  id: number;
  title: string;
  amount_cents: number;
  currency: string;
  stage: string;
  pipeline?: string;
  offtake_stage?: string | null;
  close_date?: string | null;
  owner?: { id: number; name: string; avatar_url?: string | null } | null;
  legal_entity?: { id: number; short_name: string } | null;
};

type DocRow = {
  id: number;
  name: string;
  size: number;
  updated_at: string;
  created_by?: number | null;
  legal_entity_id?: number | null;
  legal_entity?: { id: number; short_name: string } | null;
  company_id?: number | null;
  company?: { id: number; name: string } | null;
};

type MailRow = {
  thread_id: number;
  subject?: string | null;
  last_at?: string | null;
  messages: number;
  participants: string[];
};
type MailResp = { items: MailRow[]; reason: "no_access" | "no_mailbox" | "no_domain" | null; domains: string[] };

type TimelineRow = {
  id: number;
  action: string;
  entity?: string | null;
  entity_id?: number | null;
  detail?: string | null;
  created_at?: string | null;
  user?: { id: number; name: string; avatar_url?: string | null } | null;
};

const STAGE_LABEL: Record<string, string> = {
  new: "Новый",
  qualified: "Квалифицирован",
  proposal: "Предложение",
  negotiation: "Переговоры",
  won: "Успех",
  lost: "Провал",
};

function fmtMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toLocaleString("ru-RU")} ${currency}`;
  }
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function CompanyCard() {
  const { id } = useParams();
  const companyId = Number(id);
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<TabKey>("contacts");
  const [editing, setEditing] = useState(false);

  const canView = can("contacts.view");
  const canDeals = can("deals.view");

  const { data: company, isPending, isError } = useQuery({
    queryKey: ["company", companyId],
    queryFn: async () => (await api.get<Company>(`/api/companies/${companyId}`)).data,
    enabled: canView && Number.isFinite(companyId),
    retry: false,
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/api/companies/${companyId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      toast.success("Компания удалена");
      nav("/contacts");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  if (!canView) {
    return (
      <EmptyState
        icon={<Building2 size={32} />}
        title="Нет доступа к контрагентам"
        description="В вашей роли нет права на просмотр контактов и компаний. Его может выдать администратор компании."
      />
    );
  }
  if (isPending) return <Loader />;
  if (isError || !company) {
    return (
      <EmptyState
        icon={<Building2 size={32} />}
        title="Компания не найдена"
        description="Возможно, её удалили или ссылка устарела."
        action={
          <Button variant="secondary" onClick={() => nav("/contacts")}>
            К списку контактов
          </Button>
        }
      />
    );
  }

  const site = company.website ? (company.website.startsWith("http") ? company.website : `https://${company.website}`) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: "/contacts", label: "Контакты" }}
        title={
          <>
            <Building2 size={20} className="text-zinc-400" />
            {company.name}
          </>
        }
        meta={
          <>
            <CompanyStatusBadge status={company.status} />
            <CompanyTypeBadges types={company.types} />
          </>
        }
        actions={
          <>
            {can("contacts.update") && (
              <Button variant="secondary" leftIcon={<Pencil size={14} />} onClick={() => setEditing(true)}>
                Изменить
              </Button>
            )}
            {can("contacts.delete") && (
              <Button
                variant="ghost"
                className="text-rose-600"
                leftIcon={<Trash2 size={14} />}
                onClick={() =>
                  confirm({
                    title: "Удалить компанию?",
                    message: `«${company.name}» будет удалена. Контакты, сделки и документы останутся, но без привязки к компании.`,
                    danger: true,
                    confirmLabel: "Удалить",
                    onConfirm: () => del.mutateAsync(),
                  })
                }
              >
                Удалить
              </Button>
            )}
          </>
        }
      />

      <DetailLayout
        main={
          <>
            <Tabs
              label="Разделы карточки контрагента"
              value={tab}
              onChange={setTab}
              items={[
                { key: "contacts", label: "Контакты", icon: Users, count: company.contacts_count },
                { key: "deals", label: "Сделки", icon: Coins, hidden: !canDeals },
                { key: "contracts", label: "Договоры", icon: FileSignature },
                { key: "documents", label: "Документы", icon: FileText },
                { key: "mail", label: "Переписка", icon: Mail },
                { key: "timeline", label: "Хроника", icon: Activity },
              ]}
            />
            {tab === "contacts" && <ContactsTab companyId={company.id} />}
            {tab === "deals" && canDeals && <DealsTab companyId={company.id} />}
            {tab === "contracts" && <CompanyContractsTab companyId={company.id} companyName={company.name} />}
            {tab === "documents" && <DocumentsTab company={company} />}
            {tab === "mail" && <MailTab companyId={company.id} />}
            {tab === "timeline" && <TimelineTab companyId={company.id} />}
          </>
        }
        aside={
          <PropertyList title="О компании">
            <PropertyRow icon={UserIcon} label="Ответственный">
              {company.responsible ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={company.responsible.name} url={company.responsible.avatar_url} size={20} />
                  {company.responsible.name}
                </span>
              ) : (
                <span className="text-zinc-400">Не назначен</span>
              )}
            </PropertyRow>
            <PropertyRow icon={MapPin} label="Страна">
              {company.country || <span className="text-zinc-400">—</span>}
            </PropertyRow>
            <PropertyRow icon={Hash} label={company.tax_id ? "БИН" : "Рег. номер"}>
              <span className="tabular-nums">{company.tax_id || company.registration_number || <span className="text-zinc-400">—</span>}</span>
            </PropertyRow>
            {company.industry && <PropertyRow label="Отрасль">{company.industry}</PropertyRow>}
            {site && (
              <PropertyRow icon={Globe} label="Сайт">
                <a href={site} target="_blank" rel="noreferrer" className="truncate text-brand-700 hover:underline dark:text-brand-300">
                  {company.website}
                </a>
              </PropertyRow>
            )}
            {company.email && (
              <PropertyRow icon={Mail} label="Email">
                <a href={`mailto:${company.email}`} className="truncate text-brand-700 hover:underline dark:text-brand-300">
                  {company.email}
                </a>
              </PropertyRow>
            )}
            {company.phone && (
              <PropertyRow icon={Phone} label="Телефон">
                <a href={`tel:${company.phone}`} className="hover:underline">
                  {company.phone}
                </a>
              </PropertyRow>
            )}
            {company.address && <PropertyRow label="Адрес">{company.address}</PropertyRow>}
            {company.note && (
              <div className="mt-2 whitespace-pre-line border-t border-zinc-100 pt-2 text-[13px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                {company.note}
              </div>
            )}
          </PropertyList>
        }
      />

      {editing && <CompanyModal initial={company} onClose={() => setEditing(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Вкладки
// ---------------------------------------------------------------------------

function ContactsTab({ companyId }: { companyId: number }) {
  const { data, isPending } = useQuery({
    queryKey: ["contacts", "company", companyId],
    queryFn: async () =>
      (await api.get<Page<ContactRow>>("/api/contacts", { params: { company_id: companyId, per_page: 200, page: 1 } })).data.items,
  });
  if (isPending) return <Loader />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Users size={24} />}
        title="Контактов пока нет"
        description="Добавьте контакт в разделе «Контакты» и укажите в нём эту компанию."
      />
    );
  }
  return (
    <Panel flush>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {data.map((c) => {
          const name = `${c.first_name} ${c.last_name || ""}`.trim();
          return (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={name} size={30} />
              <div className="min-w-0 flex-1">
                <Link to={`/contacts?contact=${c.id}`} className="block truncate font-medium hover:text-brand-700 dark:hover:text-brand-300">
                  {name}
                </Link>
                {c.position && <div className="truncate text-xs text-zinc-500">{c.position}</div>}
              </div>
              <div className="hidden min-w-0 text-right text-xs text-zinc-500 sm:block">
                {c.email && <div className="truncate">{c.email}</div>}
                {c.phone && <div className="truncate">{c.phone}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function DealsTab({ companyId }: { companyId: number }) {
  const le = useLegalEntities();
  const { settings: offtakeSettings } = useOfftakeSettings();
  const offtakeLabels: Record<string, string> = Object.fromEntries((offtakeSettings?.stages ?? []).map((s) => [s.key, s.label]));
  const { data, isPending } = useQuery({
    queryKey: ["deals", "company", companyId],
    queryFn: async () =>
      (await api.get<Page<DealRow>>("/api/deals", { params: { company_id: companyId, per_page: 200, page: 1 } })).data.items,
  });
  if (isPending) return <Loader />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Coins size={24} />}
        title="Сделок пока нет"
        description="Сделки появятся здесь, когда в них будет указан этот контрагент."
      />
    );
  }
  return (
    <div className="table-container table-scroll">
      <table className="w-full min-w-[560px]">
        <thead className="table-head">
          <tr>
            <th className="table-head-cell">Сделка</th>
            <th className="table-head-cell">Этап</th>
            {le.multi && <th className="table-head-cell">Юрлицо</th>}
            <th className="table-head-cell text-right">Сумма</th>
            <th className="table-head-cell">Ответственный</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id} className="table-row">
              <td className="table-cell">
                <Link to={`/deals?deal=${d.id}`} className="font-medium hover:text-brand-700 dark:hover:text-brand-300">
                  {d.title}
                </Link>
              </td>
              <td className="table-cell">
                {d.pipeline === "offtake" ? (
                  <>
                    <span className="mr-1.5 rounded bg-zinc-100 px-1 py-0.5 text-[10.5px] font-semibold uppercase text-zinc-500 dark:bg-white/10">Offtake</span>
                    {offtakeLabels[d.offtake_stage ?? ""] ?? d.offtake_stage ?? "—"}
                  </>
                ) : (
                  STAGE_LABEL[d.stage] ?? d.stage
                )}
              </td>
              {le.multi && <td className="table-cell text-zinc-600 dark:text-zinc-300">{d.legal_entity?.short_name ?? "—"}</td>}
              <td className="table-cell text-right tabular-nums">{fmtMoney(d.amount_cents, d.currency)}</td>
              <td className="table-cell">{d.owner?.name ?? <span className="text-zinc-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentsTab({ company }: { company: Company }) {
  const { can, me } = useAuth();
  const le = useLegalEntities();
  const canUpload = can("files.upload") || !!me?.current_tenant?.is_owner;
  const canManageAll = can("files.delete") || !!me?.current_tenant?.is_owner;
  const uploadRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [editDoc, setEditDoc] = useState<DocRow | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["company-docs", company.id],
    queryFn: async () => (await api.get<DocRow[]>("/api/documents", { params: { company_id: company.id } })).data,
  });

  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="flex justify-end">
          <input
            ref={uploadRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPendingFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="secondary" size="sm" leftIcon={<Upload size={14} />} onClick={() => uploadRef.current?.click()}>
            Загрузить документ
          </Button>
        </div>
      )}
      {isPending ? (
        <Loader />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<FileText size={24} />}
          title="Документов пока нет"
          description="Загрузите файл здесь или укажите эту компанию в свойствах документа в разделе «Документы»."
        />
      ) : (
        <Panel flush>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                <FileText size={16} className="shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {[fmtSize(d.size), fromNow(d.updated_at), le.multi ? d.legal_entity?.short_name : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {(canManageAll || d.created_by === me?.id) && (
                  <Button variant="ghost" size="icon" onClick={() => setEditDoc(d)} aria-label="Свойства документа" title="Свойства">
                    <Pencil size={13} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div className="text-xs text-zinc-500">
        Все документы компании — в разделе{" "}
        <Link to="/documents" className="text-brand-700 hover:underline dark:text-brand-300">
          «Документы»
        </Link>
        .
      </div>
      {pendingFile && (
        <DocumentMetaModal
          file={pendingFile}
          fixedCompany={{ id: company.id, name: company.name }}
          onClose={() => setPendingFile(null)}
        />
      )}
      {editDoc && <DocumentMetaModal doc={editDoc} onClose={() => setEditDoc(null)} />}
    </div>
  );
}

function MailTab({ companyId }: { companyId: number }) {
  const { data, isPending } = useQuery({
    queryKey: ["company-mail", companyId],
    queryFn: async () => (await api.get<MailResp>(`/api/companies/${companyId}/mail`)).data,
  });
  if (isPending) return <Loader />;
  if (!data) return null;
  if (data.reason === "no_access") {
    return (
      <EmptyState
        icon={<Mail size={24} />}
        title="Почта недоступна"
        description="В вашей роли нет доступа к почте. Его может выдать администратор компании."
      />
    );
  }
  if (data.reason === "no_mailbox") {
    return (
      <EmptyState
        icon={<Mail size={24} />}
        title="Почтовый ящик не подключён"
        description="Переписка берётся из вашего почтового ящика. Подключите его в настройках."
        action={
          <Link to="/settings/mailbox" className="btn-secondary">
            Подключить почту
          </Link>
        }
      />
    );
  }
  if (data.reason === "no_domain") {
    return (
      <EmptyState
        icon={<Mail size={24} />}
        title="Не по чему искать переписку"
        description="Укажите у компании сайт или корпоративную почту, либо добавьте контакты с email — письма найдутся по ним."
      />
    );
  }
  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={<Mail size={24} />}
        title="Переписки пока нет"
        description="В вашем почтовом ящике нет писем с адресов этой компании и её контактов."
      />
    );
  }
  return (
    <div className="space-y-2">
      <Panel flush>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.items.map((t) => (
            <li key={t.thread_id}>
              <Link to={`/mail?thread=${t.thread_id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/5">
                <Mail size={15} className="mt-0.5 shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.subject || "Без темы"}</div>
                  <div className="truncate text-xs text-zinc-500">{t.participants.join(", ")}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-zinc-500">
                  {t.last_at && <div>{formatDateTime(t.last_at)}</div>}
                  {t.messages > 1 && <div>писем: {t.messages}</div>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="text-xs text-zinc-500">Показаны письма только из вашего почтового ящика.</div>
    </div>
  );
}

function TimelineTab({ companyId }: { companyId: number }) {
  const { data, isPending } = useQuery({
    queryKey: ["company-timeline", companyId],
    queryFn: async () => (await api.get<TimelineRow[]>(`/api/companies/${companyId}/timeline`)).data,
  });
  if (isPending) return <Loader />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Activity size={24} />}
        title="Событий пока нет"
        description="Здесь появятся изменения по компании, её контактам и сделкам."
      />
    );
  }
  const linkOf = (r: TimelineRow) =>
    r.entity === "contact" && r.entity_id
      ? `/contacts?contact=${r.entity_id}`
      : r.entity === "deal" && r.entity_id
        ? `/deals?deal=${r.entity_id}`
        : null;
  return (
    <Panel flush>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {data.map((r) => {
          const href = linkOf(r);
          return (
            <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
              <Avatar name={r.user?.name ?? "Система"} url={r.user?.avatar_url} size={26} />
              <div className="min-w-0 flex-1 text-[13px]">
                <span className="font-medium">{r.user?.name ?? "Система"}</span>{" "}
                <span className="text-zinc-600 dark:text-zinc-300">{activityText(r.action, r.entity)}</span>
                {r.detail && (
                  <>
                    {" "}
                    {href ? (
                      <Link to={href} className="text-brand-700 hover:underline dark:text-brand-300">
                        «{r.detail}»
                      </Link>
                    ) : (
                      <span>«{r.detail}»</span>
                    )}
                  </>
                )}
                {!r.detail && href && (
                  <>
                    {" "}
                    <Link to={href} className="text-brand-700 hover:underline dark:text-brand-300">
                      открыть
                    </Link>
                  </>
                )}
              </div>
              {r.created_at && (
                <time className="shrink-0 text-xs text-zinc-500" dateTime={r.created_at} title={formatDateTime(r.created_at)}>
                  {fromNow(r.created_at)}
                </time>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
