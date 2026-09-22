import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, extractApiError } from "@/api/client";
import { Plus, Check, X, Trash2, Palmtree } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { EmptyState, Modal, Avatar, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { DataTable, Column } from "@/components/lib/DataTable";
import type { Page } from "@/types";

type UserBrief = { id: number; name: string; avatar_url?: string | null };

type TimeOffKind = "vacation" | "sick" | "personal" | "remote";
type TimeOffStatus = "pending" | "approved" | "rejected";

type TimeOffRow = {
  id: number;
  user_id: number;
  kind: TimeOffKind;
  status: TimeOffStatus;
  start_date: string;
  end_date: string;
  note?: string | null;
  user?: UserBrief | null;
  approver?: UserBrief | null;
  created_at: string;
};

const KIND_LABEL: Record<TimeOffKind, string> = {
  vacation: "Отпуск",
  sick: "Больничный",
  personal: "Отгул",
  remote: "Удалённо",
};

const KIND_COLOR: Record<TimeOffKind, string> = {
  vacation: "bg-emerald-200 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  sick: "bg-rose-200 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200",
  personal: "bg-sky-200 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  remote: "bg-violet-200 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200",
};

const STATUS_COLOR: Record<TimeOffStatus, string> = {
  pending: "bg-amber-200 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  approved: "bg-emerald-200 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  rejected: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300",
};

const STATUS_LABEL: Record<TimeOffStatus, string> = {
  pending: "Ожидает",
  approved: "Одобрен",
  rejected: "Отклонён",
};

const timeOffFormSchema = z
  .object({
    kind: z.enum(["vacation", "sick", "personal", "remote"]).default("vacation"),
    start_date: z.string().min(1, "Обязательно"),
    end_date: z.string().min(1, "Обязательно"),
    note: z.string().max(2000).optional(),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "Дата окончания раньше начала",
    path: ["end_date"],
  });
type TimeOffFormValues = z.infer<typeof timeOffFormSchema>;

export default function TimeOffPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [openNew, setOpenNew] = useState(false);
  const [tab, setTab] = useState<"all" | "mine">("all");

  const canApprove = can("hr.manage_goals") || can("users.view");

  const { data, isPending } = useQuery({
    queryKey: ["timeoff", tab, me?.id],
    queryFn: async () =>
      (
        await api.get<Page<TimeOffRow>>("/api/timeoff", {
          params: { per_page: 200, user_id: tab === "mine" ? me?.id : undefined },
        })
      ).data.items,
  });

  const approve = useMutation({
    mutationFn: (id: number) => api.post(`/api/timeoff/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timeoff"] }),
    onError: (e) => toast.error("Не удалось одобрить", extractApiError(e).message),
  });
  const reject = useMutation({
    mutationFn: (id: number) => api.post(`/api/timeoff/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timeoff"] }),
    onError: (e) => toast.error("Не удалось отклонить", extractApiError(e).message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/timeoff/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timeoff"] });
      toast.success("Заявка удалена");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const columns: Column<TimeOffRow>[] = [
    {
      key: "user",
      header: "Сотрудник",
      render: (row) => (
        <div className="flex items-center gap-2">
          <Avatar name={row.user?.name} url={row.user?.avatar_url} size={24} />
          <span>{row.user?.name || `#${row.user_id}`}</span>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Тип",
      width: 140,
      render: (row) => (
        <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", KIND_COLOR[row.kind])}>
          {KIND_LABEL[row.kind]}
        </span>
      ),
    },
    {
      key: "period",
      header: "Период",
      sortable: true,
      sortAccessor: (row) => new Date(row.start_date),
      render: (row) => (
        <span className="tabular-nums">
          {new Date(row.start_date).toLocaleDateString("ru-RU")} — {new Date(row.end_date).toLocaleDateString("ru-RU")}
        </span>
      ),
    },
    {
      key: "note",
      header: "Комментарий",
      render: (row) => (
        <span className="line-clamp-1 max-w-xs text-neutral-500">{row.note || "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Статус",
      width: 130,
      render: (row) => (
        <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR[row.status])}>
          {STATUS_LABEL[row.status]}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 130,
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.status === "pending" && canApprove && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="text-emerald-600"
                title="Одобрить"
                onClick={() => approve.mutate(row.id)}
                aria-label="Одобрить"
              >
                <Check size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-rose-600"
                title="Отклонить"
                onClick={() => reject.mutate(row.id)}
                aria-label="Отклонить"
              >
                <X size={15} />
              </Button>
            </>
          )}
          {(row.user_id === me?.id || canApprove) && (
            <Button
              variant="ghost"
              size="icon"
              className="text-rose-500"
              title="Удалить"
              aria-label="Удалить"
              onClick={() =>
                confirm({
                  title: "Удалить заявку?",
                  message: "Заявка будет удалена без возможности восстановления.",
                  danger: true,
                  confirmLabel: "Удалить",
                  onConfirm: () => del.mutateAsync(row.id),
                })
              }
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Отпуска и больничные</h1>
          <p className="text-sm text-neutral-500">Календарь отсутствий команды</p>
        </div>
        <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setOpenNew(true)}>
          Новая заявка
        </Button>
      </div>

      <div role="tablist" className="flex border-b border-neutral-200 dark:border-neutral-800">
        {(
          [
            ["all", "Вся команда"],
            ["mine", "Мои"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === key
                ? "border-brand-600 font-medium text-brand-700 dark:border-brand-400 dark:text-brand-300"
                : "border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {!isPending && (!data || data.length === 0) ? (
        <EmptyState
          icon={<Palmtree size={32} />}
          title="Заявок пока нет"
          description="Оформи первую — команда увидит календарь"
        />
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(row) => row.id}
          isLoading={isPending}
          initialSort={{ key: "period", direction: "desc" }}
        />
      )}

      {openNew && <TimeOffModal onClose={() => setOpenNew(false)} />}
    </div>
  );
}

function TimeOffModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TimeOffFormValues>({
    resolver: zodResolver(timeOffFormSchema),
    defaultValues: { kind: "vacation", start_date: "", end_date: "", note: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await api.post("/api/timeoff", {
        kind: data.kind,
        start_date: data.start_date,
        end_date: data.end_date,
        note: data.note || null,
      });
      qc.invalidateQueries({ queryKey: ["timeoff"] });
      onClose();
    } catch (e) {
      setServerError(extractApiError(e).message);
    }
  });

  return (
    <Modal open onClose={onClose} title="Новая заявка" size="md">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormField label="Тип" error={errors.kind?.message}>
          <select className="input" {...register("kind")}>
            {(Object.keys(KIND_LABEL) as TimeOffKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="С" required error={errors.start_date?.message}>
            <input type="date" className="input" {...register("start_date")} />
          </FormField>
          <FormField label="По" required error={errors.end_date?.message}>
            <input type="date" className="input" {...register("end_date")} />
          </FormField>
        </div>
        <FormField label="Комментарий" error={errors.note?.message}>
          <textarea className="input min-h-[80px]" {...register("note")} />
        </FormField>
        <FormError msg={serverError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>Отправить</Button>
        </div>
      </form>
    </Modal>
  );
}
