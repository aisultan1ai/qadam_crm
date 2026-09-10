import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Plus, Check, X, Trash2, Palmtree } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { EmptyState, Modal, Avatar, FieldError, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
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
  vacation: "bg-emerald-100 text-emerald-700",
  sick: "bg-rose-100 text-rose-700",
  personal: "bg-sky-100 text-sky-700",
  remote: "bg-violet-100 text-violet-700",
};

const STATUS_COLOR: Record<TimeOffStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-neutral-200 text-neutral-600",
};

const STATUS_LABEL: Record<TimeOffStatus, string> = {
  pending: "Ожидает",
  approved: "Одобрен",
  rejected: "Отклонён",
};

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Отпуска и больничные</h1>
          <p className="text-sm text-neutral-500">Календарь отсутствий команды</p>
        </div>
        <button className="btn-primary" onClick={() => setOpenNew(true)}>
          <Plus size={16} /> Новая заявка
        </button>
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

      {isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !data || data.length === 0 ? (
        <EmptyState icon={<Palmtree size={32} />} title="Заявок пока нет" description="Оформи первую — команда увидит календарь" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900/60">
              <tr>
                <th className="px-3 py-2">Сотрудник</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Период</th>
                <th className="px-3 py-2">Комментарий</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={row.user?.name} url={row.user?.avatar_url} size={24} />
                      <span>{row.user?.name || `#${row.user_id}`}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", KIND_COLOR[row.kind])}>
                      {KIND_LABEL[row.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {new Date(row.start_date).toLocaleDateString("ru-RU")} — {new Date(row.end_date).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-neutral-500">{row.note || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR[row.status])}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {row.status === "pending" && canApprove && (
                        <>
                          <button className="btn-ghost !p-1.5 text-emerald-600" title="Одобрить" onClick={() => approve.mutate(row.id)}>
                            <Check size={15} />
                          </button>
                          <button className="btn-ghost !p-1.5 text-rose-600" title="Отклонить" onClick={() => reject.mutate(row.id)}>
                            <X size={15} />
                          </button>
                        </>
                      )}
                      {(row.user_id === me?.id || canApprove) && (
                        <button
                          className="btn-ghost !p-1.5 text-rose-500"
                          title="Удалить"
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
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openNew && <TimeOffModal onClose={() => setOpenNew(false)} />}
    </div>
  );
}

function TimeOffModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [kind, setKind] = useState<TimeOffKind>("vacation");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () => api.post("/api/timeoff", { kind, start_date: startDate, end_date: endDate, note: note || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timeoff"] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  const invalid = !startDate || !endDate;

  return (
    <Modal open onClose={onClose} title="Новая заявка" size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate();
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Тип</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TimeOffKind)}>
            {(Object.keys(KIND_LABEL) as TimeOffKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">С</span>
            <input type="date" className="input" value={startDate} onChange={(e) => setStart(e.target.value)} />
            <FieldError msg={!startDate ? "Обязательно" : undefined} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">По</span>
            <input type="date" className="input" value={endDate} onChange={(e) => setEnd(e.target.value)} />
            <FieldError msg={!endDate ? "Обязательно" : undefined} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Комментарий</span>
          <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={invalid || save.isPending}>
            Отправить
          </button>
        </div>
      </form>
    </Modal>
  );
}
