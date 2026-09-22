import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, extractApiError } from "@/api/client";
import { Phone, PhoneIncoming, PhoneOutgoing, Trash2, Plus } from "lucide-react";
import clsx from "clsx";
import { EmptyState, Modal, Avatar, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { DataTable, Column } from "@/components/lib/DataTable";
import type { Page } from "@/types";

type UserBrief = { id: number; name: string; avatar_url?: string | null };
type ContactBrief = { id: number; first_name: string; last_name?: string | null };

type Call = {
  id: number;
  provider: string;
  direction: "inbound" | "outbound";
  status: string;
  from_number?: string | null;
  to_number?: string | null;
  duration_sec: number;
  recording_url?: string | null;
  note?: string | null;
  started_at: string;
  ended_at?: string | null;
  user?: UserBrief | null;
  contact?: ContactBrief | null;
};

const callSchema = z.object({
  direction: z.enum(["inbound", "outbound"]).default("outbound"),
  from_number: z.string().trim().max(64).optional(),
  to_number: z.string().trim().max(64).optional(),
  duration_sec: z.coerce.number().int().min(0).default(0),
  note: z.string().max(2000).optional(),
});
type CallForm = z.infer<typeof callSchema>;

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function CallsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<"all" | "inbound" | "outbound">("all");
  const [openLog, setOpenLog] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["calls", filter],
    queryFn: async () =>
      (
        await api.get<Page<Call>>("/api/calls", {
          params: { direction: filter === "all" ? undefined : filter, per_page: 200 },
        })
      ).data.items,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/calls/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calls"] });
      toast.success("Звонок удалён");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const columns: Column<Call>[] = [
    {
      key: "direction",
      header: "Тип",
      width: 130,
      render: (c) =>
        c.direction === "inbound" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
            <PhoneIncoming size={11} /> Входящий
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-200 px-2 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
            <PhoneOutgoing size={11} /> Исходящий
          </span>
        ),
    },
    {
      key: "user",
      header: "Сотрудник",
      render: (c) =>
        c.user ? (
          <div className="flex items-center gap-2">
            <Avatar name={c.user.name} url={c.user.avatar_url} size={24} />
            <span>{c.user.name}</span>
          </div>
        ) : (
          "—"
        ),
    },
    {
      key: "contact",
      header: "Контакт",
      render: (c) => (c.contact ? `${c.contact.first_name} ${c.contact.last_name || ""}` : "—"),
    },
    {
      key: "numbers",
      header: "Номера",
      render: (c) => (
        <span className="text-xs text-neutral-500">
          {c.from_number || "?"} → {c.to_number || "?"}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Длительность",
      sortable: true,
      sortAccessor: (c) => c.duration_sec,
      render: (c) => <span className="tabular-nums">{fmtDuration(c.duration_sec)}</span>,
      width: 130,
    },
    {
      key: "started",
      header: "Начало",
      sortable: true,
      sortAccessor: (c) => new Date(c.started_at),
      render: (c) => (
        <span className="tabular-nums text-neutral-500">
          {new Date(c.started_at).toLocaleString("ru-RU")}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 100,
      render: (c) => (
        <div className="flex items-center justify-end gap-1">
          {c.recording_url && (
            <a
              className="btn-ghost !p-1.5 text-brand-600"
              href={c.recording_url}
              target="_blank"
              rel="noreferrer"
              title="Прослушать"
            >
              <Phone size={14} />
            </a>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-rose-500"
            onClick={() =>
              confirm({
                title: "Удалить запись?",
                message: `Звонок будет удалён из истории.`,
                danger: true,
                confirmLabel: "Удалить",
                onConfirm: () => del.mutateAsync(c.id),
              })
            }
            aria-label="Удалить"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Звонки</h1>
          <p className="text-sm text-neutral-500">История звонков. Twilio/Voximplant подключаются через webhook</p>
        </div>
        <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setOpenLog(true)}>
          Записать звонок
        </Button>
      </div>

      <div role="tablist" className="flex border-b border-neutral-200 dark:border-neutral-800">
        {(
          [
            ["all", "Все", Phone],
            ["inbound", "Входящие", PhoneIncoming],
            ["outbound", "Исходящие", PhoneOutgoing],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            className={clsx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
              filter === k
                ? "border-brand-600 font-medium text-brand-700 dark:border-brand-400 dark:text-brand-300"
                : "border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {!isPending && (!data || data.length === 0) ? (
        <EmptyState
          icon={<Phone size={32} />}
          title="Звонков пока нет"
          description="Настрой webhook Twilio: /api/webhooks/telephony/twilio?tenant_id=<ID>"
        />
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(c) => c.id}
          isLoading={isPending}
          initialSort={{ key: "started", direction: "desc" }}
        />
      )}

      {openLog && <LogCallModal onClose={() => setOpenLog(false)} />}
    </div>
  );
}

function LogCallModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CallForm>({
    resolver: zodResolver(callSchema),
    defaultValues: { direction: "outbound", from_number: "", to_number: "", duration_sec: 60, note: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await api.post("/api/calls", {
        direction: data.direction,
        from_number: data.from_number || null,
        to_number: data.to_number || null,
        duration_sec: data.duration_sec,
        note: data.note || null,
        status: "completed",
      });
      qc.invalidateQueries({ queryKey: ["calls"] });
      onClose();
    } catch (e) {
      setServerError(extractApiError(e).message);
    }
  });

  return (
    <Modal open onClose={onClose} title="Записать звонок" size="md">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormField label="Направление" error={errors.direction?.message}>
          <select className="input" {...register("direction")}>
            <option value="outbound">Исходящий</option>
            <option value="inbound">Входящий</option>
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Откуда" error={errors.from_number?.message}>
            <input className="input" placeholder="+7..." {...register("from_number")} />
          </FormField>
          <FormField label="Куда" error={errors.to_number?.message}>
            <input className="input" placeholder="+7..." {...register("to_number")} />
          </FormField>
        </div>
        <FormField label="Длительность (сек)" error={errors.duration_sec?.message}>
          <input className="input tabular-nums" type="number" min={0} {...register("duration_sec", { valueAsNumber: true })} />
        </FormField>
        <FormField label="Комментарий" error={errors.note?.message}>
          <textarea className="input min-h-[70px]" {...register("note")} />
        </FormField>
        <FormError msg={serverError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}
