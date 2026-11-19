/**
 * Карточка договора (/contracts/:id): условия, статус, файлы, EPC-разделы,
 * связи со сделкой/проектом/контрагентом, записи Объектов, ссылающиеся на договор,
 * и журнал «Кто открывал» (владельцу и администратору).
 */
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, CalendarDays, Coins, Download, FileSignature, FileText, FolderKanban, History, Landmark, Link2, Pencil,
  Plus, RefreshCw, Scale, Trash2, Upload, User as UserIcon,
} from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Avatar, EmptyState, FormError, Loader, Modal } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { DatePicker } from "@/components/DatePicker";
import { DetailLayout, PageHeader, Panel, PropertyList, PropertyRow } from "@/components/page";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { useLegalEntities } from "@/hooks/useLegalEntities";
import { useAuth } from "@/store/auth";
import { formatDateTime, fromNow } from "@/lib/date";
import {
  CURRENCIES, ContractFormModal, ContractStatusBadge, ExpiryText, STATUS_LABEL, TYPE_LABEL, contractToDraft, fmtDate,
  fmtMoney, toNum, vatText, type Contract, type ContractStatus,
} from "./contracts/shared";

type FileRow = { id: number; name: string; mime: string | null; size: number; created_by: number | null; created_at: string };

type Backlink = {
  schema_code: string;
  schema_label: string;
  field_label: string;
  record: { id: number; label: string; url?: string | null };
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function ContractCard() {
  const { id } = useParams();
  const contractId = Number(id);
  const { can, me } = useAuth();
  const isOwner = !!me?.current_tenant?.is_owner;
  const canView = can("contracts.view") || isOwner;
  const canUpdate = can("contracts.update") || isOwner;
  const canDelete = can("contracts.delete") || isOwner;
  const canSeeViews = can("settings.system") || isOwner || !!me?.is_platform_admin;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const le = useLegalEntities();
  const [editing, setEditing] = useState(false);
  const [showViews, setShowViews] = useState(false);

  const { data: c, isPending, isError } = useQuery({
    queryKey: ["contract", contractId],
    queryFn: async () => (await api.get<Contract>(`/api/contracts/${contractId}`)).data,
    enabled: canView && Number.isFinite(contractId),
    retry: false,
  });

  const setStatus = useMutation({
    mutationFn: async (status: ContractStatus) => (await api.post<Contract>(`/api/contracts/${contractId}/status`, { status })).data,
    onSuccess: (row) => {
      qc.setQueryData(["contract", contractId], row);
      qc.invalidateQueries({ queryKey: ["contracts"] });
      toast.success(`Статус: ${STATUS_LABEL[row.status]}`);
    },
    onError: (e) => toast.error("Не удалось сменить статус", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/api/contracts/${contractId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
      toast.success("Договор удалён");
      nav("/contracts");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  if (!canView) {
    return (
      <EmptyState
        icon={<FileSignature size={32} />}
        title="Нет доступа к договорам"
        description="В вашей роли нет права на просмотр реестра договоров. Его может выдать администратор компании."
      />
    );
  }
  if (isPending) return <Loader />;
  if (isError || !c) {
    return (
      <EmptyState
        icon={<FileSignature size={32} />}
        title="Договор не найден"
        description="Возможно, его удалили или ссылка устарела."
        action={
          <Button variant="secondary" onClick={() => nav("/contracts")}>
            К реестру договоров
          </Button>
        }
      />
    );
  }

  const changeStatus = (s: ContractStatus) => {
    if (s === "terminated" || s === "completed") {
      confirm({
        title: s === "terminated" ? "Расторгнуть договор?" : "Отметить договор исполненным?",
        message:
          "После этого договор закроется: менять статус дальше сможет только владелец компании. Напоминания о сроках по нему приходить перестанут.",
        danger: s === "terminated",
        confirmLabel: STATUS_LABEL[s],
        onConfirm: () => setStatus.mutateAsync(s),
      });
      return;
    }
    setStatus.mutate(s);
  };

  const closed = c.status === "completed" || c.status === "terminated";

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: "/contracts", label: "Договоры" }}
        title={
          <>
            <FileSignature size={20} className="text-zinc-400" />
            Договор № {c.number}
          </>
        }
        meta={
          <>
            <ContractStatusBadge status={c.status} />
            <span className="chip bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300">{TYPE_LABEL[c.contract_type]}</span>
            {c.company && <span className="text-[13px] text-zinc-500">с «{c.company.name}»</span>}
          </>
        }
        actions={
          <>
            {canUpdate && c.allowed_statuses.length > 0 && (
              <select
                aria-label="Сменить статус"
                className="input !h-9 !w-auto !py-0 text-[13px]"
                value=""
                disabled={setStatus.isPending}
                onChange={(e) => e.target.value && changeStatus(e.target.value as ContractStatus)}
              >
                <option value="">{closed ? "Вернуть в работу…" : "Сменить статус…"}</option>
                {c.allowed_statuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
            {canSeeViews && (
              <Button variant="ghost" leftIcon={<History size={14} />} onClick={() => setShowViews(true)}>
                Кто открывал
              </Button>
            )}
            {canUpdate && (
              <Button variant="secondary" leftIcon={<Pencil size={14} />} onClick={() => setEditing(true)}>
                Изменить
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                className="text-rose-600"
                leftIcon={<Trash2 size={14} />}
                onClick={() =>
                  confirm({
                    title: "Удалить договор?",
                    message: `Договор № ${c.number} будет удалён вместе с этапами, гарантиями, удержаниями и штрафами. Приложенные файлы останутся в «Документах».`,
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
            <Panel title="Условия">
              <div className="space-y-3 text-[13.5px]">
                <div>
                  <div className="text-xs text-zinc-500">Предмет договора</div>
                  <div className="mt-0.5 whitespace-pre-line">{c.subject || <span className="text-zinc-400">Не указан</span>}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-zinc-500">Сумма</div>
                    <div className="mt-0.5 text-[15px] font-semibold tabular-nums">{fmtMoney(c.amount, c.currency)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">НДС</div>
                    <div className="mt-0.5">
                      {vatText(c)}
                      {c.vat_mode !== "none" && toNum(c.vat_amount) !== null && (
                        <span className="ml-1 tabular-nums text-zinc-500">· {fmtMoney(c.vat_amount, c.currency)}</span>
                      )}
                    </div>
                  </div>
                  {c.vat_mode === "on_top" && (
                    <div>
                      <div className="text-xs text-zinc-500">Итого с НДС</div>
                      <div className="mt-0.5 font-medium tabular-nums">{fmtMoney(c.total_with_vat, c.currency)}</div>
                    </div>
                  )}
                </div>
                {c.note && (
                  <div>
                    <div className="text-xs text-zinc-500">Примечание</div>
                    <div className="mt-0.5 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{c.note}</div>
                  </div>
                )}
              </div>
            </Panel>

            <FilesPanel contract={c} canUpdate={canUpdate} />

            {c.contract_type === "epc" && <EpcSections contract={c} canUpdate={canUpdate} />}

            <BacklinksPanel contractId={c.id} />
          </>
        }
        aside={
          <PropertyList title="О договоре">
            <PropertyRow icon={Building2} label="Контрагент">
              {c.company ? (
                <Link to={`/contacts/companies/${c.company.id}`} className="text-brand-700 hover:underline dark:text-brand-300">
                  {c.company.name}
                </Link>
              ) : (
                <span className="text-zinc-400">—</span>
              )}
            </PropertyRow>
            {(le.multi || (c.legal_entity && le.all.length > 1)) && (
              <PropertyRow icon={Landmark} label="Наше юрлицо">
                {c.legal_entity?.short_name ?? <span className="text-zinc-400">—</span>}
              </PropertyRow>
            )}
            <PropertyRow icon={CalendarDays} label="Подписан">
              <span className="tabular-nums">{fmtDate(c.date_signed)}</span>
            </PropertyRow>
            <PropertyRow icon={CalendarDays} label="Действует">
              <span>
                {c.valid_from && <span className="tabular-nums">с {fmtDate(c.valid_from)} </span>}
                <ExpiryText c={{ ...c, auto_renewal: false }} />
              </span>
            </PropertyRow>
            <PropertyRow icon={RefreshCw} label="Автопролонгация">
              {c.auto_renewal ? "Включена" : "Нет"}
            </PropertyRow>
            <PropertyRow icon={UserIcon} label="Ответственный">
              {c.responsible ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={c.responsible.name} url={c.responsible.avatar_url} size={20} />
                  {c.responsible.name}
                </span>
              ) : (
                <span className="text-zinc-400">Не назначен</span>
              )}
            </PropertyRow>
            <PropertyRow icon={Scale} label="Юрист">
              {c.lawyer ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={c.lawyer.name} url={c.lawyer.avatar_url} size={20} />
                  {c.lawyer.name}
                </span>
              ) : (
                <span className="text-zinc-400">Не назначен</span>
              )}
            </PropertyRow>
            <PropertyRow icon={Coins} label="Сделка">
              {c.deal ? (
                <Link to={`/deals?deal=${c.deal.id}`} className="text-brand-700 hover:underline dark:text-brand-300">
                  {c.deal.name}
                </Link>
              ) : (
                <span className="text-zinc-400">—</span>
              )}
            </PropertyRow>
            <PropertyRow icon={FolderKanban} label="Проект">
              {c.project ? (
                <Link to={`/projects/${c.project.id}`} className="text-brand-700 hover:underline dark:text-brand-300">
                  {c.project.name}
                </Link>
              ) : (
                <span className="text-zinc-400">—</span>
              )}
            </PropertyRow>
            <div className="mt-2 border-t border-zinc-100 pt-2 text-[12px] text-zinc-500 dark:border-zinc-800">
              Создан {formatDateTime(c.created_at)} · изменён {fromNow(c.updated_at)}
            </div>
          </PropertyList>
        }
      />

      {editing && (
        <ContractFormModal
          contractId={c.id}
          initial={contractToDraft(c)}
          onClose={() => setEditing(false)}
          onSaved={(row) => {
            qc.setQueryData(["contract", c.id], row);
            setEditing(false);
            toast.success("Договор сохранён");
          }}
        />
      )}
      {showViews && <ViewsModal contract={c} onClose={() => setShowViews(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Файлы
// ---------------------------------------------------------------------------

function FilesPanel({ contract, canUpdate }: { contract: Contract; canUpdate: boolean }) {
  const { can, me } = useAuth();
  const isOwner = !!me?.current_tenant?.is_owner;
  const canUpload = isOwner || (can("files.upload") && (can("contracts.update") || can("contracts.create")));
  const canDeleteAny = isOwner || can("files.delete");
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["contract-files", contract.id],
    queryFn: async () => (await api.get<FileRow[]>(`/api/contracts/${contract.id}/files`)).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contract-files", contract.id] });
    qc.invalidateQueries({ queryKey: ["contracts"] });
  };

  const upload = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        await api.post(`/api/contracts/${contract.id}/files`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      }
      toast.success(files.length > 1 ? "Файлы загружены" : "Файл загружен");
    } catch (e) {
      toast.error("Не удалось загрузить файл", extractApiError(e).message);
    } finally {
      setUploading(false);
      refresh();
    }
  };

  const download = async (f: FileRow) => {
    try {
      const res = await api.get<Blob>(`/api/documents/${f.id}/download-internal`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error("Не удалось скачать файл", extractApiError(e).message);
    }
  };

  const remove = useMutation({
    mutationFn: (fid: number) => api.delete(`/api/contracts/${contract.id}/files/${fid}`),
    onSuccess: () => {
      refresh();
      toast.success("Файл удалён");
    },
    onError: (e) => toast.error("Не удалось удалить файл", extractApiError(e).message),
  });

  return (
    <Panel
      title={
        <>
          <FileText size={15} className="text-zinc-400" /> Файлы
        </>
      }
      actions={
        canUpload && (
          <>
            <input
              ref={ref}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) upload(e.target.files);
                e.target.value = "";
              }}
            />
            <Button variant="secondary" size="sm" leftIcon={<Upload size={13} />} isLoading={uploading} onClick={() => ref.current?.click()}>
              Загрузить
            </Button>
          </>
        )
      }
      flush
    >
      {isPending ? (
        <div className="p-4">
          <Loader />
        </div>
      ) : !data || data.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-zinc-500">
          Файлов пока нет. Приложите скан договора, допсоглашения и приложения.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileText size={16} className="shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => download(f)} className="block max-w-full truncate text-left font-medium hover:text-brand-700 dark:hover:text-brand-300">
                  {f.name}
                </button>
                <div className="text-xs text-zinc-500">
                  {fmtSize(f.size)} · {fromNow(f.created_at)}
                </div>
              </div>
              <Button variant="ghost" size="icon" title="Скачать" aria-label="Скачать файл" onClick={() => download(f)}>
                <Download size={13} />
              </Button>
              {canUpdate && (canDeleteAny || f.created_by === me?.id) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-rose-500"
                  title="Удалить"
                  aria-label="Удалить файл"
                  onClick={() =>
                    confirm({
                      title: "Удалить файл?",
                      message: `«${f.name}» будет удалён без возможности восстановления.`,
                      danger: true,
                      confirmLabel: "Удалить",
                      onConfirm: () => remove.mutateAsync(f.id),
                    })
                  }
                >
                  <Trash2 size={13} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// EPC: этапы, гарантии, удержания, штрафы
// ---------------------------------------------------------------------------

type EpcKind = "stages" | "guarantees" | "retentions" | "penalties";
type EpcRow = Record<string, unknown> & { id: number };
type EpcData = Record<EpcKind, EpcRow[]>;

type FieldSpec = {
  name: string;
  label: string;
  type: "text" | "textarea" | "date" | "number" | "percent" | "select" | "currency";
  required?: boolean;
  options?: Record<string, string>;
  hint?: string;
};

const GUARANTEE_KIND: Record<string, string> = {
  advance: "Авансовая",
  performance: "Исполнения обязательств",
  warranty: "Гарантийная",
  other: "Другая",
};

const EPC_SECTIONS: { kind: EpcKind; title: string; add: string; empty: string; fields: FieldSpec[] }[] = [
  {
    kind: "stages",
    title: "Этапы",
    add: "Добавить этап",
    empty: "Этапы работ с плановыми сроками, стоимостью и процентом выполнения.",
    fields: [
      { name: "name", label: "Название этапа", type: "text", required: true },
      { name: "planned_start", label: "Плановое начало", type: "date" },
      { name: "planned_end", label: "Плановое окончание", type: "date" },
      { name: "amount", label: "Стоимость", type: "number" },
      { name: "percent_complete", label: "Выполнено, %", type: "percent" },
    ],
  },
  {
    kind: "guarantees",
    title: "Банковские гарантии",
    add: "Добавить гарантию",
    empty: "Авансовые, гарантии исполнения и гарантийные: банк, сумма и срок. За 60, 30 и 7 дней до окончания придёт напоминание.",
    fields: [
      { name: "kind", label: "Вид гарантии", type: "select", options: GUARANTEE_KIND },
      { name: "bank_name", label: "Банк", type: "text" },
      { name: "amount", label: "Сумма", type: "number" },
      { name: "currency", label: "Валюта", type: "currency" },
      { name: "valid_until", label: "Действует до", type: "date" },
    ],
  },
  {
    kind: "retentions",
    title: "Удержания",
    add: "Добавить удержание",
    empty: "Суммы, которые удерживаются из оплаты до выполнения условия (например, гарантийное удержание).",
    fields: [
      { name: "description", label: "Описание", type: "text", required: true },
      { name: "percent", label: "Процент", type: "percent", hint: "Укажите процент или сумму" },
      { name: "amount", label: "Сумма", type: "number" },
      { name: "release_condition", label: "Условие возврата", type: "textarea" },
      { name: "release_date", label: "Дата возврата", type: "date" },
    ],
  },
  {
    kind: "penalties",
    title: "Штрафные санкции",
    add: "Добавить санкцию",
    empty: "Неустойки и штрафы по договору: размер и основание.",
    fields: [
      { name: "description", label: "Описание", type: "text", required: true },
      { name: "rate_percent", label: "Ставка, %", type: "percent", hint: "Например, за каждый день просрочки" },
      { name: "amount", label: "Сумма", type: "number" },
      { name: "basis", label: "Основание", type: "textarea", hint: "Пункт договора или условие применения" },
    ],
  },
];

function EpcSections({ contract, canUpdate }: { contract: Contract; canUpdate: boolean }) {
  const { data, isPending } = useQuery({
    queryKey: ["contract-epc", contract.id],
    queryFn: async () => (await api.get<EpcData>(`/api/contracts/${contract.id}/epc`)).data,
  });
  if (isPending) return <Loader />;
  return (
    <>
      {EPC_SECTIONS.map((s) => (
        <EpcSection key={s.kind} contract={contract} spec={s} rows={data?.[s.kind] ?? []} canUpdate={canUpdate} />
      ))}
    </>
  );
}

function cellValue(f: FieldSpec, row: EpcRow, currency: string): React.ReactNode {
  const v = row[f.name];
  if (v === null || v === undefined || v === "") return <span className="text-zinc-400">—</span>;
  switch (f.type) {
    case "date":
      return <span className="tabular-nums">{fmtDate(String(v))}</span>;
    case "number":
      return <span className="whitespace-nowrap tabular-nums">{fmtMoney(v as string, (row.currency as string) || currency)}</span>;
    case "percent":
      if (f.name === "percent_complete") {
        const n = Math.max(0, Math.min(100, toNum(v as string) ?? 0));
        return (
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <span className="block h-full rounded-full bg-brand-500" style={{ width: `${n}%` }} />
            </span>
            <span className="tabular-nums">{n}%</span>
          </span>
        );
      }
      return <span className="tabular-nums">{(toNum(v as string) ?? 0).toLocaleString("ru-RU")}%</span>;
    case "select":
      return f.options?.[String(v)] ?? String(v);
    case "currency":
      return String(v);
    default:
      return <span className="line-clamp-2 whitespace-pre-line">{String(v)}</span>;
  }
}

function EpcSection({
  contract,
  spec,
  rows,
  canUpdate,
}: {
  contract: Contract;
  spec: (typeof EPC_SECTIONS)[number];
  rows: EpcRow[];
  canUpdate: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<EpcRow | "new" | null>(null);
  const shown = spec.fields.filter((f) => f.type !== "currency");

  const remove = useMutation({
    mutationFn: (rid: number) => api.delete(`/api/contracts/${contract.id}/epc/${spec.kind}/${rid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contract-epc", contract.id] });
      toast.success("Удалено");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const totalStages =
    spec.kind === "stages" && rows.length > 0 ? rows.reduce((acc, r) => acc + (toNum(r.amount as string) ?? 0), 0) : null;

  return (
    <Panel
      title={spec.title}
      actions={
        canUpdate && (
          <Button variant="secondary" size="sm" leftIcon={<Plus size={13} />} onClick={() => setEditing("new")}>
            {spec.add}
          </Button>
        )
      }
      flush
    >
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-[13px] text-zinc-500">{spec.empty}</div>
      ) : (
        <div className="table-scroll">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="table-head">
              <tr>
                {shown.map((f) => (
                  <th key={f.name} className="table-head-cell">
                    {f.label}
                  </th>
                ))}
                {canUpdate && <th className="table-head-cell w-20" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="table-row">
                  {shown.map((f) => (
                    <td key={f.name} className="table-cell">
                      {cellValue(f, r, contract.currency)}
                    </td>
                  ))}
                  {canUpdate && (
                    <td className="table-cell text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Изменить" aria-label="Изменить" onClick={() => setEditing(r)}>
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-rose-500"
                          title="Удалить"
                          aria-label="Удалить"
                          onClick={() =>
                            confirm({
                              title: "Удалить запись?",
                              message: "Запись будет удалена из договора.",
                              danger: true,
                              confirmLabel: "Удалить",
                              onConfirm: () => remove.mutateAsync(r.id),
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {totalStages !== null && (
                <tr className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="table-cell font-medium" colSpan={3}>
                    Итого по этапам
                  </td>
                  <td className="table-cell font-medium tabular-nums">{fmtMoney(totalStages, contract.currency)}</td>
                  <td className="table-cell" colSpan={canUpdate ? 2 : 1} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <EpcModal
          contract={contract}
          spec={spec}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

function EpcModal({
  contract,
  spec,
  row,
  onClose,
}: {
  contract: Contract;
  spec: (typeof EPC_SECTIONS)[number];
  row: EpcRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = row?.[f.name];
      if (v !== null && v !== undefined) out[f.name] = String(v);
      else if (f.type === "select") out[f.name] = Object.keys(f.options ?? {})[0] ?? "";
      else if (f.type === "currency") out[f.name] = contract.currency || "KZT";
      else if (f.name === "percent_complete") out[f.name] = "0";
      else out[f.name] = "";
    }
    if (out.percent_complete) out.percent_complete = String(toNum(out.percent_complete) ?? 0);
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of spec.fields) {
      const raw = (values[f.name] ?? "").trim();
      if (f.required && !raw) return setError(`Заполните поле «${f.label}»`);
      if (f.type === "number" || f.type === "percent") {
        if (!raw) {
          body[f.name] = f.name === "percent_complete" ? 0 : null;
          continue;
        }
        const n = Number(raw.replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n) || n < 0) return setError(`В поле «${f.label}» нужно положительное число`);
        if (f.type === "percent" && n > 100) return setError(`В поле «${f.label}» — не больше 100`);
        body[f.name] = f.name === "percent_complete" ? Math.round(n) : n;
      } else {
        body[f.name] = raw || null;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (row) await api.patch(`/api/contracts/${contract.id}/epc/${spec.kind}/${row.id}`, body);
      else await api.post(`/api/contracts/${contract.id}/epc/${spec.kind}`, body);
      qc.invalidateQueries({ queryKey: ["contract-epc", contract.id] });
      onClose();
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <Modal open onClose={onClose} title={row ? `${spec.title}: изменить` : spec.add} size="md">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {spec.fields.map((f) => (
            <FormField
              key={f.name}
              label={f.label}
              required={f.required}
              hint={f.hint}
              htmlFor={`epc-${f.name}`}
              className={f.type === "textarea" || (f.type === "text" && f.required) ? "sm:col-span-2" : undefined}
            >
              {f.type === "date" ? (
                <DatePicker id={`epc-${f.name}`} value={values[f.name]} onChange={(v) => set(f.name, v)} />
              ) : f.type === "select" ? (
                <select id={`epc-${f.name}`} className="input" value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                  {Object.entries(f.options ?? {}).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : f.type === "currency" ? (
                <select id={`epc-${f.name}`} className="input" value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                  {Array.from(new Set([...CURRENCIES, values[f.name]])).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea id={`epc-${f.name}`} className="input min-h-[56px]" value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />
              ) : (
                <input
                  id={`epc-${f.name}`}
                  className={f.type === "text" ? "input" : "input tabular-nums"}
                  inputMode={f.type === "text" ? undefined : "decimal"}
                  value={values[f.name]}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </FormField>
          ))}
        </div>
        <FormError msg={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" isLoading={busy}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Записи Объектов, ссылающиеся на договор (акты, рекламации…)
// ---------------------------------------------------------------------------

function BacklinksPanel({ contractId }: { contractId: number }) {
  const { data } = useQuery({
    queryKey: ["backlinks", "contract", contractId],
    queryFn: async () =>
      (await api.get<Backlink[]>("/api/objects/backlinks", { params: { target: "contract", id: contractId } })).data,
    retry: false,
  });
  if (!data || data.length === 0) return null;
  return (
    <Panel
      title={
        <>
          <Link2 size={15} className="text-zinc-400" /> Связанные записи
        </>
      }
      flush
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {data.map((b) => (
          <li key={`${b.schema_code}-${b.record.id}-${b.field_label}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
            <span className="w-40 shrink-0 truncate text-zinc-500">{b.schema_label}</span>
            {b.record.url ? (
              <Link to={b.record.url} className="min-w-0 flex-1 truncate font-medium hover:text-brand-700 dark:hover:text-brand-300">
                {b.record.label}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate">{b.record.label}</span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Кто открывал
// ---------------------------------------------------------------------------

type RecordView = {
  id: number;
  user: { id: number; name: string; email?: string | null } | null;
  ip: string | null;
  user_agent: string | null;
  viewed_at: string;
};

function ViewsModal({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["record-views", "contract", contract.id],
    queryFn: async () =>
      (await api.get<RecordView[]>("/api/record-views", { params: { entity_type: "contract", entity_id: contract.id } })).data,
  });
  return (
    <Modal open onClose={onClose} title={`Кто открывал: договор № ${contract.number}`} size="lg">
      <p className="mb-3 text-xs text-zinc-500">
        Открытия карточки договора. Если человек открывал её несколько раз подряд, в течение 10 минут это одна запись.
      </p>
      {isPending ? (
        <div className="h-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
      ) : error ? (
        <FormError msg={extractApiError(error).message} />
      ) : !data || data.length === 0 ? (
        <div className="py-8 text-center text-sm text-zinc-500">Договор ещё никто не открывал</div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Кто</th>
                <th className="px-3 py-2 font-medium">Когда</th>
                <th className="px-3 py-2 font-medium">IP-адрес</th>
              </tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{v.user?.name ?? <span className="text-zinc-500">Неизвестно</span>}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400" title={fromNow(v.viewed_at)}>
                    {new Date(v.viewed_at).toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400" title={v.user_agent ?? undefined}>
                    {v.ip || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
