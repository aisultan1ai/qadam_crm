import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Flame } from "lucide-react";
import clsx from "clsx";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";

/** Локальная дата пользователя (YYYY-MM-DD), а не UTC — чтобы «сегодня» совпадало с его днём. */
export function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function GoalStreak({ streak }: { streak: number }) {
  if (streak < 1) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <Flame size={12} /> {streak} {plural(streak, "день", "дня", "дней")} подряд
    </span>
  );
}

/** Кнопка «Выполнено сегодня» для ежедневной цели. Повторный клик снимает отметку. */
export function GoalCheckinButton({
  goalId, checked, disabled, className,
}: {
  goalId: number; checked: boolean; disabled?: boolean; className?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const mut = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/hr/goals/${goalId}/checkin`, { day: todayLocal(), done: !checked })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr", "goals"] }),
    onError: (e) => toast.error("Не удалось отметить", extractApiError(e).message),
  });

  return (
    <button
      type="button"
      disabled={disabled || mut.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        mut.mutate();
      }}
      title={checked ? "Нажмите, чтобы снять отметку" : "Отметить как выполненное сегодня"}
      className={clsx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors disabled:opacity-60",
        checked
          ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300"
          : "bg-brand-600 text-white hover:bg-brand-700",
        className,
      )}
    >
      <Check size={14} />
      {checked ? "Сегодня выполнено" : "Выполнено сегодня"}
    </button>
  );
}
