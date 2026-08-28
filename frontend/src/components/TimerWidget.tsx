import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Timer as TimerIcon, Square } from "lucide-react";
import clsx from "clsx";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { useToast } from "./Toast";

type ActiveTimer = {
  id: number;
  task_id: number | null;
  task_title: string | null;
  description: string | null;
  started_at: string;
  last_heartbeat_at: string;
  elapsed_seconds: number;
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TimerWidget() {
  const { can } = useAuth();
  const enabled = can("time.use");
  const qc = useQueryClient();
  const toast = useToast();

  const { data: timer } = useQuery<ActiveTimer | null>({
    enabled,
    queryKey: ["timer", "active"],
    queryFn: async () => (await api.get<ActiveTimer | null>("/api/time-tracking/timer")).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [timer]);

  // Heartbeat каждые 30 секунд, пока таймер активен
  useEffect(() => {
    if (!timer || !enabled) return;
    const iv = setInterval(() => {
      api.post("/api/time-tracking/timer/heartbeat").catch(() => {});
    }, 30_000);
    return () => clearInterval(iv);
  }, [timer?.id, enabled]);

  const stop = useMutation({
    mutationFn: () => api.post("/api/time-tracking/timer/stop"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timer", "active"] });
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      toast.success("Таймер остановлен");
    },
    onError: (e) => toast.error("Не удалось остановить", extractApiError(e).message),
  });

  if (!enabled || !timer) return null;

  const started = new Date(timer.started_at).getTime();
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const label = timer.task_title || timer.description || "Таймер";

  return (
    <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {timer.task_id ? (
        <Link to={`/tasks/${timer.task_id}`} className="max-w-[140px] truncate hover:underline" title={label}>
          {label}
        </Link>
      ) : (
        <span className="max-w-[140px] truncate" title={label}>{label}</span>
      )}
      <span className="font-mono tabular-nums font-semibold">{formatDuration(elapsed)}</span>
      <button
        type="button"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className={clsx(
          "flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50",
        )}
        title="Остановить"
        aria-label="Остановить таймер"
      >
        <Square size={10} fill="currentColor" />
      </button>
    </div>
  );
}
