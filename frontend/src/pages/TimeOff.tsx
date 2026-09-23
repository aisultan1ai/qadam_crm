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

import { Tabs } from "@/components/page";
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
  vacation: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  sick: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25",
  personal: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25",
  remote: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/25",
};

const STATUS_COLOR: Record<TimeOffStatus, string> = {
  pending: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  approved: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  rejected: "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-500/25",
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
        <span className={clsx("inline-flex rounded-md px-2 py-0.5 text-xs font-medium", KIND_COLOR[row.kind])}>
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
        <span className={clsx("inline-flex rounded-md px-2 py-0.5 text-xs font-medium", STATUS_COLOR[row.status])}>
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
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Отпуска и больничные</h1>
          <p className="page-subtitle">Календарь отсутствий команды</p>
        </div>
        <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setOpenNew(true)}>
          Новая заявка
        </Button>
      </div>

      <Tabs
        label="Чьи заявки показать"
        value={tab}
        onChange={setTab}
        items={[
          { key: "all", label: "Вся команда" },
          { key: "mine", label: "Мои" },
        ]}
      />

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
