import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Square } from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { useToast } from "./Toast";

type ActiveTimer = {
  id: number;
  task_id: number | null;
  elapsed_seconds: number;
};

export function TaskTimerButton({ taskId }: { taskId: number }) {
  const { can } = useAuth();
  const enabled = can("time.use");
  const qc = useQueryClient();
  const toast = useToast();

  const { data: timer } = useQuery<ActiveTimer | null>({
    enabled,
    queryKey: ["timer", "active"],
    queryFn: async () => (await api.get<ActiveTimer | null>("/api/time-tracking/timer")).data,
    staleTime: 30_000,
  });

  const isRunningForThisTask = timer?.task_id === taskId;
  const isRunningForOther = timer && timer.task_id !== taskId;

  const start = useMutation({
    mutationFn: () => api.post("/api/time-tracking/timer/start", { task_id: taskId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timer", "active"] });
      toast.success("Таймер запущен");
    },
    onError: (e) => toast.error("Не удалось запустить", extractApiError(e).message),
  });

  const stop = useMutation({
    mutationFn: () => api.post("/api/time-tracking/timer/stop"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timer", "active"] });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    },
    onError: (e) => toast.error("Не удалось остановить", extractApiError(e).message),
  });

  if (!enabled) return null;

  if (isRunningForThisTask) {
    return (
      <button
        type="button"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800/60 dark:bg-emerald-900/40 dark:text-emerald-200"
        title="Остановить таймер"
      >
        <Square size={12} fill="currentColor" />
        Остановить
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => start.mutate()}
      disabled={start.isPending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      title={isRunningForOther ? "Активный таймер будет остановлен" : "Запустить таймер"}
    >
      <Play size={12} fill="currentColor" />
      {isRunningForOther ? "Переключить" : "Старт"}
    </button>
  );
}
