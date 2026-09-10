import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Phone, PhoneIncoming, PhoneOutgoing, Trash2, Plus } from "lucide-react";
import clsx from "clsx";
import { EmptyState, Modal, Avatar, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Звонки</h1>
          <p className="text-sm text-neutral-500">История звонков. Twilio/Voximplant подключаются через webhook</p>
        </div>
        <button className="btn-primary" onClick={() => setOpenLog(true)}>
          <Plus size={16} /> Записать звонок
        </button>
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

      {isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !data || data.length === 0 ? (
        <EmptyState icon={<Phone size={32} />} title="Звонков пока нет" description="Настрой webhook Twilio: /api/webhooks/telephony/twilio?tenant_id=<ID>" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900/60">
              <tr>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Сотрудник</th>
                <th className="px-3 py-2">Контакт</th>
                <th className="px-3 py-2">Номера</th>
                <th className="px-3 py-2">Длительность</th>
                <th className="px-3 py-2">Начало</th>
                <th className="px-3 py-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    {c.direction === "inbound" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><PhoneIncoming size={11} /> Входящий</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700"><PhoneOutgoing size={11} /> Исходящий</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {c.user ? (
                      <div className="flex items-center gap-2">
                        <Avatar name={c.user.name} url={c.user.avatar_url} size={24} />
                        <span>{c.user.name}</span>
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">{c.contact ? `${c.contact.first_name} ${c.contact.last_name || ""}` : "—"}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {c.from_number || "?"} → {c.to_number || "?"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtDuration(c.duration_sec)}</td>
                  <td className="px-3 py-2 tabular-nums text-neutral-500">
                    {new Date(c.started_at).toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {c.recording_url && (
                        <a className="btn-ghost !p-1.5 text-brand-600" href={c.recording_url} target="_blank" rel="noreferrer" title="Прослушать">
                          <Phone size={14} />
                        </a>
                      )}
                      <button
                        className="btn-ghost !p-1.5 text-rose-500"
                        onClick={() =>
                          confirm({
                            title: "Удалить запись?",
                            danger: true,
                            confirmLabel: "Удалить",
                            onConfirm: () => del.mutateAsync(c.id),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openLog && <LogCallModal onClose={() => setOpenLog(false)} />}
    </div>
  );
}

function LogCallModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [fromN, setFromN] = useState("");
  const [toN, setToN] = useState("");
  const [duration, setDuration] = useState("60");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.post("/api/calls", {
        direction,
        from_number: fromN || null,
        to_number: toN || null,
        duration_sec: parseInt(duration || "0", 10),
        note: note || null,
        status: "completed",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calls"] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Записать звонок" size="md">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Направление</span>
          <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="outbound">Исходящий</option>
            <option value="inbound">Входящий</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Откуда</span>
            <input className="input" value={fromN} onChange={(e) => setFromN(e.target.value)} placeholder="+7..." />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Куда</span>
            <input className="input" value={toN} onChange={(e) => setToN(e.target.value)} placeholder="+7..." />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Длительность (сек)</span>
          <input className="input tabular-nums" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Комментарий</span>
          <textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}
