import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Filter, LayoutGrid, List, Search, Trash2, User as UserIcon, Zap, Plus } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { EmptyState, Loader, Modal } from "@/components/ui";
import { fromNow } from "@/lib/date";

type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "rejected";

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "Новые",
  contacted: "Связались",
  qualified: "Целевые",
  converted: "Клиенты",
  rejected: "Отказ",
};

const STATUS_ORDER: LeadStatus[] = ["new", "contacted", "qualified", "converted", "rejected"];

const STATUS_COLOR: Record<LeadStatus, string> = {
  new: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  contacted: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  qualified: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  converted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  rejected: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

type TenantLead = {
  id: number;
  tenant_id: number;
  form_id: number | null;
  form_name: string | null;
  name: string;
  contact: string;
  custom_fields: Record<string, unknown>;
  note: string | null;
  status: LeadStatus;
  source: string;
  assignee_id: number | null;
  converted_task_id: number | null;
  created_at: string;
  updated_at: string;
};

type LeadForm = { id: number; name: string; slug: string };
type Project = { id: number; name: string };

export default function Leads() {
  const { can } = useAuth();
  const [view, setView] = useState<"table" | "board">("board");
  const [q, setQ] = useState("");
  const [formFilter, setFormFilter] = useState<string>("");
  const [openLeadId, setOpenLeadId] = useState<number | null>(null);
  const [convertLead, setConvertLead] = useState<TenantLead | null>(null);

  const params = useMemo(() => {
    const p: Record<string, string> = { per_page: "200" };
    if (q.trim()) p.q = q.trim();
    if (formFilter) p.form_id = formFilter;
    return p;
  }, [q, formFilter]);

  const { data, isPending } = useQuery({
    queryKey: ["tenant-leads", params],
    queryFn: async () =>
      (await api.get<{ items: TenantLead[]; total: number }>("/api/tenant-leads", { params })).data,
  });

  const { data: forms } = useQuery({
    queryKey: ["lead-forms"],
    queryFn: async () => (await api.get<LeadForm[]>("/api/lead-forms")).data,
    enabled: can("leads.manage_forms"),
  });

  const openLead = data?.items.find((l) => l.id === openLeadId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Лиды</h1>
          <p className="text-sm text-neutral-500">Заявки через формы захвата и вручную</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
            <button
              className={
                "flex items-center gap-1 px-3 py-1.5 text-sm " +
                (view === "board" ? "bg-neutral-100 dark:bg-neutral-800" : "")
              }
              onClick={() => setView("board")}
              title="Воронка"
            >
              <LayoutGrid size={14} /> Воронка
            </button>
            <button
              className={
                "flex items-center gap-1 px-3 py-1.5 text-sm " +
                (view === "table" ? "bg-neutral-100 dark:bg-neutral-800" : "")
              }
              onClick={() => setView("table")}
              title="Таблица"
            >
              <List size={14} /> Список
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
          <input
            className="input pl-8"
            placeholder="Поиск по имени или контакту…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter size={14} className="text-neutral-400" />
          <select
            className="input !py-1.5"
            value={formFilter}
            onChange={(e) => setFormFilter(e.target.value)}
          >
            <option value="">Все формы</option>
            {forms?.map((f) => (
              <option key={f.id} value={String(f.id)}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>

      {isPending ? (
        <Loader />
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="Пока нет лидов"
          description="Настройте форму захвата в Настройки → Формы, и заявки будут приходить сюда."
          icon={<Zap size={32} />}
        />
      ) : view === "board" ? (
        <BoardView
          leads={data!.items}
          onOpen={setOpenLeadId}
          canConvert={can("leads.convert")}
          onConvert={setConvertLead}
        />
      ) : (
        <TableView
          leads={data!.items}
          onOpen={setOpenLeadId}
          canConvert={can("leads.convert")}
          onConvert={setConvertLead}
        />
      )}

      {openLead && (
        <LeadDetailModal
          lead={openLead}
          onClose={() => setOpenLeadId(null)}
          onConvert={(l) => {
            setOpenLeadId(null);
            setConvertLead(l);
          }}
        />
      )}
      {convertLead && (
        <ConvertLeadModal lead={convertLead} onClose={() => setConvertLead(null)} />
      )}
    </div>
  );
}

function BoardView({
  leads,
  onOpen,
  canConvert,
  onConvert,
}: {
  leads: TenantLead[];
  onOpen: (id: number) => void;
  canConvert: boolean;
  onConvert: (lead: TenantLead) => void;
}) {
  const buckets: Record<LeadStatus, TenantLead[]> = {
    new: [], contacted: [], qualified: [], converted: [], rejected: [],
  };
  for (const l of leads) buckets[l.status]?.push(l);

  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:px-0 md:grid-cols-3 xl:grid-cols-5">
      {STATUS_ORDER.map((s) => (
        <div key={s} className="w-[85vw] shrink-0 snap-start sm:w-auto">
          <div className="mb-2 flex items-center justify-between px-1">
            <div className={"chip " + STATUS_COLOR[s]}>{STATUS_LABEL[s]}</div>
            <span className="text-xs tabular-nums text-neutral-500">{buckets[s].length}</span>
          </div>
          <div className="space-y-2">
            {buckets[s].map((l) => (
              <LeadCard key={l.id} lead={l} onOpen={onOpen} canConvert={canConvert} onConvert={onConvert} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LeadCard({
  lead,
  onOpen,
  canConvert,
  onConvert,
}: {
  lead: TenantLead;
  onOpen: (id: number) => void;
  canConvert: boolean;
  onConvert: (lead: TenantLead) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(lead.id)}
      className="w-full rounded-xl border border-neutral-200 bg-white p-3 text-left transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700"
    >
      <div className="font-medium">{lead.name}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{lead.contact}</div>
      {lead.form_name && (
        <div className="mt-1 text-xs text-neutral-400">Из формы: {lead.form_name}</div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-neutral-400">{fromNow(lead.created_at)}</span>
        {canConvert && lead.status !== "converted" && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onConvert(lead);
            }}
            className="text-[11px] text-brand-600 hover:underline dark:text-brand-400"
          >
            → задача
          </span>
        )}
      </div>
    </button>
  );
}

function TableView({
  leads,
  onOpen,
  canConvert,
  onConvert,
}: {
  leads: TenantLead[];
  onOpen: (id: number) => void;
  canConvert: boolean;
  onConvert: (lead: TenantLead) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/50">
          <tr>
            <th className="px-3 py-2">Имя</th>
            <th className="px-3 py-2">Контакт</th>
            <th className="px-3 py-2">Форма</th>
            <th className="px-3 py-2">Статус</th>
            <th className="px-3 py-2">Создан</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr
              key={l.id}
              className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-900/40"
              onClick={() => onOpen(l.id)}
            >
              <td className="px-3 py-2 font-medium">{l.name}</td>
              <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{l.contact}</td>
              <td className="px-3 py-2 text-neutral-500">{l.form_name || "—"}</td>
              <td className="px-3 py-2">
                <span className={"chip " + STATUS_COLOR[l.status]}>{STATUS_LABEL[l.status]}</span>
              </td>
              <td className="px-3 py-2 text-neutral-500">{fromNow(l.created_at)}</td>
              <td className="px-3 py-2 text-right">
                {canConvert && l.status !== "converted" && (
                  <button
                    className="btn-ghost !py-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onConvert(l);
                    }}
                  >
                    В задачу
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeadDetailModal({
  lead,
  onClose,
  onConvert,
}: {
  lead: TenantLead;
  onClose: () => void;
  onConvert: (lead: TenantLead) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [note, setNote] = useState<string>(lead.note || "");

  const patch = useMutation({
    mutationFn: (body: Partial<{ status: LeadStatus; note: string }>) =>
      api.patch(`/api/tenant-leads/${lead.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-leads"] });
      toast.success("Сохранено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/api/tenant-leads/${lead.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-leads"] });
      onClose();
      toast.success("Лид удалён");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const customEntries = Object.entries(lead.custom_fields || {}).filter(
    ([k]) => !["name", "phone", "email", "contact"].includes(k),
  );

  return (
    <Modal open onClose={onClose} title={lead.name} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <a href={`mailto:${lead.contact}`} className="link">{lead.contact}</a>
          {lead.form_name && <span className="text-neutral-500">· {lead.form_name}</span>}
          <span className="text-neutral-500">· {fromNow(lead.created_at)}</span>
        </div>

        {customEntries.length > 0 && (
          <div className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Дополнительно</div>
            <dl className="grid gap-1">
              {customEntries.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[120px_1fr] gap-2">
                  <dt className="text-neutral-500">{k}</dt>
                  <dd>{String(v ?? "")}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">Статус</label>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as LeadStatus)}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">Заметка</label>
          <textarea
            className="input min-h-[80px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Заметки менеджера…"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {can("leads.delete") ? (
            <button
              className="btn-ghost inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"
              onClick={async () => {
                if (await confirm({ title: "Удалить лид?", message: "Действие необратимо.", confirmLabel: "Удалить" })) del.mutate();
              }}
            >
              <Trash2 size={14} /> Удалить
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {can("leads.convert") && lead.status !== "converted" && (
              <button className="btn-ghost" onClick={() => onConvert(lead)}>В задачу</button>
            )}
            <button
              className="btn-primary"
              onClick={() => patch.mutate({ status, note })}
              disabled={patch.isPending}
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ConvertLeadModal({ lead, onClose }: { lead: TenantLead; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(`Лид: ${lead.name}`);
  const [projectId, setProjectId] = useState<string>("");

  const { data: projects } = useQuery({
    queryKey: ["projects", "brief"],
    queryFn: async () =>
      (await api.get<{ items: Project[] }>("/api/projects", { params: { per_page: 200 } })).data.items,
  });

  const convert = useMutation({
    mutationFn: () =>
      api.post(`/api/tenant-leads/${lead.id}/convert`, {
        title,
        project_id: projectId ? Number(projectId) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-leads"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
      toast.success("Лид сконвертирован в задачу");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Конвертировать в задачу" size="md">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Название задачи</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Проект (необязательно)</span>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Без проекта</option>
            {projects?.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.name}</option>
            ))}
          </select>
        </label>
        <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 dark:bg-neutral-900/50">
          <UserIcon size={12} className="mr-1 inline" />
          В описание задачи попадут: контакт лида, все дополнительные поля формы и текущая заметка.
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" onClick={() => convert.mutate()} disabled={convert.isPending}>
            <Plus size={14} className="mr-1" /> Создать задачу
          </button>
        </div>
      </div>
    </Modal>
  );
}
