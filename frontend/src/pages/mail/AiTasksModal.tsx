import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { DatePicker } from "@/components/DatePicker";
import { fetchAllUsers } from "@/lib/users";
import { endOfDayISO } from "@/pages/tasks/useTaskPatch";

type Priority = "low" | "medium" | "high" | "critical";

type Suggestion = {
  title: string;
  description: string;
  priority: Priority;
  due_date: string | null;
  assignee_id: number | null;
  assignee_hint: string | null;
};

type SuggestOut = {
  message_id: number;
  thread_id: number;
  thread_linked_task_id: number | null;
  tasks: Suggestion[];
};

type Row = {
  checked: boolean;
  title: string;
  description: string;
  priority: Priority;
  due: string;
  assignee: string;
  project: string;
  hint: string | null;
};

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  critical: "Критический",
};

/**
 * «Задачи из письма»: ИИ предлагает задачи, пользователь отмечает нужные и правит их,
 * задачи создаются обычным POST /api/tasks (с его проверками прав), первая — связывается с перепиской.
 */
export function AiTasksModal({ messageId, onClose, onCreated }: { messageId: number; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [creating, setCreating] = useState(false);

  const suggest = useQuery({
    queryKey: ["ai-mail-tasks", messageId],
    queryFn: async () => (await api.post<SuggestOut>(`/api/ai/mail/messages/${messageId}/tasks`)).data,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const { data: users } = useQuery({
    queryKey: ["users-all-brief"],
    queryFn: () => fetchAllUsers<{ id: number; name: string; is_active: boolean }>(),
    staleTime: 60_000,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects-brief"],
    queryFn: async () =>
      (await api.get<{ items: { id: number; name: string }[] }>("/api/projects", { params: { per_page: 200 } })).data.items,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (suggest.data && rows === null) {
      setRows(
        suggest.data.tasks.map((t) => ({
          checked: true,
          title: t.title,
          description: t.description,
          priority: t.priority,
          due: t.due_date || "",
          assignee: t.assignee_id ? String(t.assignee_id) : "",
          project: "",
          hint: t.assignee_hint,
        })),
      );
    }
  }, [suggest.data, rows]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rs));

  const selected = (rows || []).filter((r) => r.checked && r.title.trim());

  const createSelected = async () => {
    if (!suggest.data || selected.length === 0) return;
    setCreating(true);
    const created: number[] = [];
    try {
      for (const r of selected) {
        const { data } = await api.post<{ id: number }>("/api/tasks", {
          title: r.title.trim(),
          description: r.description.trim() || null,
          priority: r.priority,
          deadline: r.due ? endOfDayISO(new Date(`${r.due}T00:00`)) : null,
          assignee_id: r.assignee ? Number(r.assignee) : null,
          project_id: r.project ? Number(r.project) : null,
        });
        created.push(data.id);
      }
      // Связь переписки с задачей одна — ставим первую созданную, если связи ещё нет
      if (!suggest.data.thread_linked_task_id && created.length) {
        try {
          await api.post(`/api/mail/threads/${suggest.data.thread_id}/link`, { task_id: created[0] });
        } catch {
          /* задачи уже созданы — связь не критична */
        }
      }
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(created.length === 1 ? "Задача создана" : `Создано задач: ${created.length}`);
      onCreated();
    } catch (e) {
      const msg = extractApiError(e).message;
      if (created.length) {
        toast.error(`Создано задач: ${created.length} из ${selected.length}`, msg);
        onCreated();
      } else {
        toast.error("Не удалось создать задачи", msg);
      }
    } finally {
      setCreating(false);
    }
  };

  const activeUsers = (users || []).filter((u) => u.is_active !== false);

  return (
    <Modal open onClose={onClose} title="Задачи из письма" size="xl">
      {suggest.isPending ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> ИИ читает письмо…
        </div>
      ) : suggest.isError ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
            {extractApiError(suggest.error).message}
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>Закрыть</Button>
          </div>
        </div>
      ) : (rows || []).length === 0 ? (
        <div className="space-y-3">
          <div className="py-6 text-center text-sm text-zinc-500">ИИ не нашёл в письме задач.</div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>Закрыть</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[12.5px] text-zinc-500">
            <Sparkles size={13} className="text-brand-500" /> Отметьте нужные задачи и поправьте детали — создадутся только выбранные.
          </div>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {rows!.map((r, i) => (
              <div
                key={i}
                className={
                  "rounded-lg border p-3 " +
                  (r.checked ? "border-brand-200 dark:border-brand-500/30" : "border-zinc-200 opacity-60 dark:border-zinc-800")
                }
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-2.5"
                    checked={r.checked}
                    onChange={(e) => update(i, { checked: e.target.checked })}
                    aria-label="Создать эту задачу"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      className="input"
                      value={r.title}
                      maxLength={300}
                      onChange={(e) => update(i, { title: e.target.value })}
                      aria-label="Название задачи"
                      placeholder="Название задачи"
                    />
                    <textarea
                      className="input min-h-[60px] text-[13px]"
                      value={r.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                      aria-label="Описание задачи"
                      placeholder="Описание"
                    />
                    <div className="grid gap-2 sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-1 block text-[11.5px] font-medium text-zinc-500">Срок</span>
                        <DatePicker value={r.due} onChange={(v) => update(i, { due: v ? v.slice(0, 10) : "" })} aria-label="Срок" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11.5px] font-medium text-zinc-500">Исполнитель</span>
                        <select className="input" value={r.assignee} onChange={(e) => update(i, { assignee: e.target.value })}>
                          <option value="">— не назначен —</option>
                          {activeUsers.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                        {r.hint && !r.assignee && (
                          <span className="mt-0.5 block text-[11px] text-zinc-400">В письме: {r.hint}</span>
                        )}
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11.5px] font-medium text-zinc-500">Проект</span>
                        <select className="input" value={r.project} onChange={(e) => update(i, { project: e.target.value })}>
                          <option value="">— без проекта —</option>
                          {(projects || []).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11.5px] font-medium text-zinc-500">Приоритет</span>
                        <select className="input" value={r.priority} onChange={(e) => update(i, { priority: e.target.value as Priority })}>
                          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11.5px] text-zinc-400">Задачи предложил ИИ — проверьте их перед созданием.</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Отмена</Button>
              <Button variant="primary" disabled={selected.length === 0 || creating} onClick={createSelected}>
                {creating && <Loader2 size={14} className="animate-spin" />}
                Создать выбранные{selected.length ? ` (${selected.length})` : ""}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
