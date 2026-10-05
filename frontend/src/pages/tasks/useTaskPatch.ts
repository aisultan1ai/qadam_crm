import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import type { TaskListItem } from "@/types";

export type TaskPatchVars = {
  id: number;
  /** Тело PATCH /api/tasks/:id. null явно очищает поле (исполнитель, срок, проект). */
  body: Record<string, unknown>;
  /** Что сразу показать в списке, не дожидаясь ответа сервера. */
  optimistic?: Partial<TaskListItem>;
};

/** Правка задачи из списка/канбана с оптимистичным обновлением кэша ["tasks", …]. */
export function useTaskPatch() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationKey: ["task-patch"],
    mutationFn: ({ id, body }: TaskPatchVars) => api.patch(`/api/tasks/${id}`, body),
    onMutate: async ({ id, optimistic }) => {
      if (!optimistic) return { snapshots: [] as [readonly unknown[], unknown][] };
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: ["tasks"] });
      qc.setQueriesData<unknown>({ queryKey: ["tasks"] }, (old: unknown) =>
        Array.isArray(old) ? (old as TaskListItem[]).map((t) => (t.id === id ? { ...t, ...optimistic } : t)) : old,
      );
      return { snapshots };
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error("Не удалось сохранить", extractApiError(e).message);
    },
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task", id] });
      qc.invalidateQueries({ queryKey: ["project-tasks"] });
    },
  });
}

/** Конец выбранного дня по локальному времени — задача «на сегодня» не просрочена до вечера. */
export function endOfDayISO(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return x.toISOString();
}
