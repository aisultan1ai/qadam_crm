import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Filter, LayoutGrid, List, Search, Trash2, Upload, User as UserIcon, Zap, Plus, Loader2, CheckCircle2, XCircle, FileSpreadsheet } from "lucide-react";
import clsx from "clsx";
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from "@dnd-kit/core";

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
type TenantUser = { id: number; name: string; email: string };

export default function Leads() {
  const { can } = useAuth();
  const [view, setView] = useState<"table" | "board">("board");
  const [q, setQ] = useState("");
  const [formFilter, setFormFilter] = useState<string>("");
  const [openLeadId, setOpenLeadId] = useState<number | null>(null);
  const [convertLead, setConvertLead] = useState<TenantLead | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [openImport, setOpenImport] = useState(false);

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
        <div className="flex flex-wrap items-center gap-2">
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
          {can("leads.create") && (
            <button
              className="btn-ghost"
              onClick={() => setOpenImport(true)}
              title="Импорт лидов из Excel/CSV"
              aria-label="Импорт лидов"
            >
              <Upload size={15} /> <span className="hidden sm:inline">Импорт</span>
            </button>
          )}
          {can("leads.create") && (
            <button className="btn-primary" onClick={() => setOpenNew(true)} aria-label="Новый лид">
              <Plus size={16} /> <span className="hidden sm:inline">Новый лид</span>
            </button>
          )}
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
          canUpdate={can("leads.update")}
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
      {openNew && <NewLeadModal onClose={() => setOpenNew(false)} />}
      {openImport && <ImportLeadsModal onClose={() => setOpenImport(false)} />}
    </div>
  );
}

function BoardView({
  leads,
  onOpen,
  canConvert,
  canUpdate,
  onConvert,
}: {
  leads: TenantLead[];
  onOpen: (id: number) => void;
  canConvert: boolean;
  canUpdate: boolean;
  onConvert: (lead: TenantLead) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const buckets: Record<LeadStatus, TenantLead[]> = {
    new: [], contacted: [], qualified: [], converted: [], rejected: [],
  };
  for (const l of leads) buckets[l.status]?.push(l);

  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const activeDragLead = useMemo(
    () => (activeDragId != null ? leads.find((l) => l.id === activeDragId) ?? null : null),
    [activeDragId, leads],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const updateStatus = useMutation({
    mutationKey: ["lead-status-update"],
    mutationFn: ({ id, status }: { id: number; status: LeadStatus }) =>
      api.patch(`/api/tenant-leads/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tenant-leads"] });
      const snapshots = qc.getQueriesData<{ items: TenantLead[]; total: number }>({ queryKey: ["tenant-leads"] });
      snapshots.forEach(([key, data]) => {
        if (!data) return;
        qc.setQueryData(key, {
          ...data,
          items: data.items.map((l) => (l.id === id ? { ...l, status } : l)),
        });
      });
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error("Не удалось изменить статус", extractApiError(err).message);
    },
    onSettled: () => {
      const stillPending = qc
        .getMutationCache()
        .findAll({ mutationKey: ["lead-status-update"], status: "pending" }).length;
      if (stillPending === 0) qc.invalidateQueries({ queryKey: ["tenant-leads"] });
    },
  });

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id).split(":")[1];
    setActiveDragId(Number(id));
  };
  const onDragCancel = () => setActiveDragId(null);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const overId = e.over?.id;
    const activeId = e.active.id;
    if (!overId || typeof activeId !== "string" || typeof overId !== "string") return;
    const [, leadIdStr] = activeId.split(":");
    const [, newStatus] = overId.split(":");
    const id = Number(leadIdStr);
    const current = leads.find((l) => l.id === id);
    if (!current || current.status === newStatus) return;
    if (!canUpdate) {
      toast.error("Недостаточно прав", "У вас нет прав менять статус лидов");
      return;
    }
    updateStatus.mutate({ id, status: newStatus as LeadStatus });
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:px-0 md:grid-cols-3 xl:grid-cols-5">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="w-[85vw] shrink-0 snap-start sm:w-auto">
            <LeadColumn
              status={s}
              leads={buckets[s]}
              onOpen={onOpen}
              canConvert={canConvert}
              onConvert={onConvert}
              activeDragId={activeDragId}
            />
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragLead ? <LeadCardGhost lead={activeDragLead} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function LeadColumn({
  status,
  leads,
  onOpen,
  canConvert,
  onConvert,
  activeDragId,
}: {
  status: LeadStatus;
  leads: TenantLead[];
  onOpen: (id: number) => void;
  canConvert: boolean;
  onConvert: (lead: TenantLead) => void;
  activeDragId: number | null;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `col:${status}` });
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[220px] flex-col rounded-2xl border p-2 transition-colors duration-[180ms] ease-out-soft",
        isOver
          ? "border-brand-400 bg-brand-50/70 dark:border-brand-700 dark:bg-brand-900/10"
          : "border-neutral-200 bg-neutral-50/50 dark:border-neutral-700/50 dark:bg-neutral-900/40",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <div className={"chip " + STATUS_COLOR[status]}>{STATUS_LABEL[status]}</div>
        <span className="text-xs tabular-nums text-neutral-500">{leads.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto pr-0.5">
        {leads.map((l) => (
          <LeadCard
            key={l.id}
            lead={l}
            onOpen={onOpen}
            canConvert={canConvert}
            onConvert={onConvert}
            isActiveDrag={activeDragId === l.id}
          />
        ))}
      </div>
    </div>
  );
}

const LeadCard = memo(function LeadCard({
  lead,
  onOpen,
  canConvert,
  onConvert,
  isActiveDrag = false,
}: {
  lead: TenantLead;
  onOpen: (id: number) => void;
  canConvert: boolean;
  onConvert: (lead: TenantLead) => void;
  isActiveDrag?: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `lead:${lead.id}` });
  return (
    <div
      ref={setNodeRef}
      style={{
        visibility: isActiveDrag ? "hidden" : "visible",
        touchAction: "none",
      }}
      {...listeners}
      {...attributes}
      onClick={() => {
        if (isActiveDrag) return;
        onOpen(lead.id);
      }}
      className={clsx(
        "group w-full cursor-pointer rounded-xl border border-neutral-200 bg-white p-3 text-left transition-all duration-[180ms] ease-out-soft dark:border-neutral-800 dark:bg-neutral-900/60",
        !isActiveDrag && "hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-sm dark:hover:border-neutral-700",
      )}
    >
      <div className="font-medium">{lead.name}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{lead.contact}</div>
      {lead.form_name && (
        <div className="mt-1 text-xs text-neutral-400">Из формы: {lead.form_name}</div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-neutral-400">{fromNow(lead.created_at)}</span>
        {canConvert && lead.status !== "converted" && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onConvert(lead);
            }}
            className="text-[11px] text-brand-600 hover:underline dark:text-brand-400"
          >
            → задача
          </button>
        )}
      </div>
    </div>
  );
});

function LeadCardGhost({ lead }: { lead: TenantLead }) {
  return (
    <div
      className="rounded-xl border border-brand-300 bg-white p-3 shadow-[0_18px_40px_-12px_rgba(23,23,31,0.35)] dark:border-brand-500/60 dark:bg-neutral-900/90"
      style={{ width: 260, transform: "rotate(2deg) scale(1.02)", cursor: "grabbing" }}
    >
      <div className="font-medium">{lead.name}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{lead.contact}</div>
    </div>
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

const SOURCE_OPTIONS = [
  { value: "manual", label: "Ручной ввод" },
  { value: "phone", label: "Звонок" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "instagram", label: "Instagram" },
  { value: "referral", label: "Рекомендация" },
  { value: "site", label: "Сайт" },
  { value: "other", label: "Другое" },
];

function NewLeadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<LeadStatus>("new");
  const [source, setSource] = useState<string>("manual");
  const [assigneeId, setAssigneeId] = useState<string>("");

  const { data: users } = useQuery({
    queryKey: ["users-brief-leads"],
    queryFn: async () =>
      (await api.get<{ items: TenantUser[] }>("/api/users", { params: { per_page: 200 } })).data.items,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/tenant-leads", {
        name: name.trim(),
        contact: contact.trim(),
        note: note.trim() || null,
        status,
        source,
        assignee_id: assigneeId ? Number(assigneeId) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-leads"] });
      toast.success("Лид создан");
      onClose();
    },
    onError: (e) => toast.error("Не удалось создать лид", extractApiError(e).message),
  });

  const canSubmit = name.trim().length > 0 && contact.trim().length > 0 && !create.isPending;

  return (
    <Modal open onClose={onClose} title="Новый лид" size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) create.mutate();
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Имя *</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Иванов" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Контакт (email / телефон) *</span>
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+7 700 000 00 00 или ivan@company.kz" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Статус</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Источник</span>
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Исполнитель</span>
          <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Не назначен</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Заметка</span>
          <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Дополнительные детали…" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}

type LeadImportStatus = {
  job_id: string;
  state: string;
  progress?: string;
  total?: number;
  created?: number;
  error_count?: number;
  errors?: { row: number; name?: string; error: string }[];
  error?: string;
};

function ImportLeadsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<LeadImportStatus | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const { data } = await api.get<LeadImportStatus>(`/api/imports/${jobId}`);
        if (stop) return;
        setStatus(data);
        if (data.state === "SUCCESS" || data.state === "FAILURE") {
          qc.invalidateQueries({ queryKey: ["tenant-leads"] });
          return;
        }
      } catch (e) {
        if (stop) return;
        setStatus({ job_id: jobId, state: "FAILURE", error: extractApiError(e).message });
        return;
      }
      if (!stop) window.setTimeout(tick, 1000);
    };
    tick();
    return () => { stop = true; };
  }, [jobId, qc]);

  const start = async () => {
    if (!file) return;
    setStarting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<{ job_id: string; state: string }>(
        "/api/imports/leads",
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setJobId(data.job_id);
      setStatus({ job_id: data.job_id, state: data.state });
    } catch (e) {
      toast.error("Не удалось запустить импорт", extractApiError(e).message);
    } finally {
      setStarting(false);
    }
  };

  const done = status?.state === "SUCCESS";
  const failed = status?.state === "FAILURE";
  const inFlight = jobId && !done && !failed;

  return (
    <Modal open onClose={onClose} title="Импорт лидов из Excel/CSV" size="lg">
      <div className="space-y-4">
        {!jobId && (
          <>
            <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
              <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">
                Формат файла (XLSX или CSV, до 5 МБ)
              </div>
              <code className="block font-mono text-[11px]">name, contact, status, source, note, assignee_email</code>
              <div className="mt-2 space-y-0.5">
                <div>• <b>name</b> — обязательно</div>
                <div>• <b>contact</b> — обязательно (email или телефон)</div>
                <div>• <b>status</b> — new / contacted / qualified / converted / rejected (по умолчанию new)</div>
                <div>• <b>source</b> — произвольный ярлык (site, phone, whatsapp…), по умолчанию import</div>
                <div>• <b>assignee_email</b> — email существующего сотрудника компании</div>
                <div className="mt-1 text-neutral-500">
                  Первая строка — заголовки. Заголовки не чувствительны к регистру.
                </div>
              </div>
            </div>

            <div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-8 text-sm text-neutral-600 hover:border-brand-400 hover:bg-brand-50 dark:border-neutral-700 dark:bg-neutral-800/40 dark:hover:border-brand-600 dark:hover:bg-brand-950/20">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <FileSpreadsheet size={18} />
                {file ? (
                  <span className="font-medium">{file.name} · {Math.round(file.size / 1024)} КБ</span>
                ) : (
                  <span>Нажмите чтобы выбрать XLSX или CSV</span>
                )}
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>Отмена</button>
              <button className="btn-primary" disabled={!file || starting} onClick={start}>
                {starting ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                Запустить импорт
              </button>
            </div>
          </>
        )}

        {inFlight && (
          <div className="py-6 text-center">
            <Loader2 size={28} className="mx-auto animate-spin text-brand-500" />
            <div className="mt-3 text-sm font-medium">Обрабатываем файл…</div>
            {status?.progress && (
              <div className="mt-1 text-xs text-neutral-500">{status.progress}</div>
            )}
            <div className="mt-1 text-xs text-neutral-500">Состояние: {status?.state}</div>
          </div>
        )}

        {done && status && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 size={18} />
              <div>
                <div className="font-medium">Импорт завершён</div>
                <div className="text-xs">
                  Всего строк: {status.total ?? 0} · Создано: {status.created ?? 0}
                  {(status.error_count ?? 0) > 0 && <> · С ошибками: {status.error_count}</>}
                </div>
              </div>
            </div>

            {status.errors && status.errors.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">Ошибки</div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/60">
                  {status.errors.map((e, i) => (
                    <div key={i} className="py-0.5 text-rose-600 dark:text-rose-400">
                      Строка {e.row}{e.name ? ` — «${e.name}»` : ""}: {e.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button className="btn-primary" onClick={onClose}>Готово</button>
            </div>
          </div>
        )}

        {failed && status && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              <XCircle size={18} />
              <div>
                <div className="font-medium">Импорт не удался</div>
                <div className="text-xs">{status.error || "Неизвестная ошибка"}</div>
              </div>
            </div>
            <div className="flex justify-end">
              <button className="btn-ghost" onClick={onClose}>Закрыть</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
