/**
 * Настройки → Статусы задач: свои статусы компании (как Statuses в ClickUp).
 * Каждый свой статус относится к базовой категории — по ней работают фильтры, отчёты, канбан и автоматизации.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from "lucide-react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { Button } from "@/components/lib/Button";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { SettingsSection } from "@/components/page";
import { Loader } from "@/components/ui";
import { STATUS_LABEL, type TaskStatus, type TaskStatusDef } from "@/types";
import { BASE_STATUS_COLOR, BASE_STATUS_ORDER } from "./tasks/grouping";

const CATEGORY_ORDER: TaskStatus[] = ["new", "in_progress", "review", "done", "cancelled"];

// Стандартный набор — стартовая точка, дальше компания переименовывает и добавляет свои.
const STARTER: { label: string; category: TaskStatus }[] = [
  { label: "Новая", category: "new" },
  { label: "В работе", category: "in_progress" },
  { label: "На проверке", category: "review" },
  { label: "Готово", category: "done" },
  { label: "Отменена", category: "cancelled" },
];

const newCode = () => `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function TaskStatuses() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<TaskStatus>("in_progress");
  const [color, setColor] = useState(BASE_STATUS_COLOR.in_progress);

  const { data: defs, isPending } = useQuery({
    queryKey: ["task-statuses"],
    queryFn: async () => (await api.get<TaskStatusDef[]>("/api/task-statuses")).data,
  });
  const list = [...(defs ?? [])].sort((a, b) => a.order_index - b.order_index || a.id - b.id);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["task-statuses"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };
  const onError = (title: string) => (e: unknown) => toast.error(title, extractApiError(e).message);

  const create = useMutation({
    mutationFn: (body: { label: string; category: TaskStatus; color: string; order_index: number; is_default?: boolean }) =>
      api.post("/api/task-statuses", { code: newCode(), ...body }),
    onSuccess: refresh,
    onError: onError("Не удалось создать статус"),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<TaskStatusDef> }) => api.patch(`/api/task-statuses/${id}`, body),
    onSuccess: refresh,
    onError: onError("Не удалось сохранить статус"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/task-statuses/${id}`),
    onSuccess: refresh,
    onError: onError("Не удалось удалить статус"),
  });

  const createStarter = async () => {
    try {
      for (const [i, s] of STARTER.entries()) {
        await api.post("/api/task-statuses", {
          code: newCode(),
          label: s.label,
          category: s.category,
          color: BASE_STATUS_COLOR[s.category],
          order_index: i * 10,
          is_default: s.category === "new",
        });
      }
      toast.success("Стандартный набор создан — переименуйте и добавьте свои");
    } catch (e) {
      toast.error("Не удалось создать набор", extractApiError(e).message);
    } finally {
      refresh();
    }
  };

  // Меняем местами соседей и перенумеровываем весь список, чтобы порядок был однозначным.
  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...list];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    try {
      await Promise.all(
        next.map((d, i) => (d.order_index !== i * 10 ? api.patch(`/api/task-statuses/${d.id}`, { order_index: i * 10 }) : null)),
      );
    } catch (e) {
      toast.error("Не удалось изменить порядок", extractApiError(e).message);
    } finally {
      refresh();
    }
  };

  const add = () => {
    const l = label.trim();
    if (!l) return;
    create.mutate(
      { label: l, category, color, order_index: (list.at(-1)?.order_index ?? -10) + 10 },
      { onSuccess: () => setLabel("") },
    );
  };

  if (isPending) return <Loader />;

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Статусы задач"
        description="Свои этапы работы вместо стандартных. Каждый статус относится к категории — по ней работают фильтры, отчёты, канбан и автоматизации."
      >
        {list.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Сейчас используются стандартные статусы.</p>
            <p className="mt-1 text-[13px] text-zinc-500">Создайте стартовый набор и переименуйте его под свои процессы или добавьте статус ниже.</p>
            <Button variant="secondary" className="mt-4" onClick={createStarter}>
              Создать из стандартных
            </Button>
          </div>
        ) : (
          <ul className="py-2">
            {list.map((d, i) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 sm:flex-nowrap">
                <ColorInput
                  label={`Цвет статуса «${d.label}»`}
                  value={d.color}
                  onSave={(c) => update.mutate({ id: d.id, body: { color: c } })}
                />
                <input
                  key={`${d.id}-${d.label}`}
                  defaultValue={d.label}
                  aria-label="Название статуса"
                  maxLength={100}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (!v) e.target.value = d.label;
                    else if (v !== d.label) update.mutate({ id: d.id, body: { label: v } });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="input !h-8 min-w-0 flex-1 !py-0 text-[13px]"
                />
                <select
                  aria-label="Категория"
                  value={d.category}
                  onChange={(e) => update.mutate({ id: d.id, body: { category: e.target.value as TaskStatus } })}
                  className="input !h-8 !w-40 !py-0 text-[13px]"
                >
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {STATUS_LABEL[c]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => !d.is_default && update.mutate({ id: d.id, body: { is_default: true } })}
                  title={d.is_default ? "Основной статус: в него попадают задачи его категории без своего статуса" : "Сделать основным статусом"}
                  aria-label="Статус по умолчанию"
                  aria-pressed={d.is_default}
                  className={clsx(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors",
                    d.is_default ? "text-amber-500" : "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-[#23262D]",
                  )}
                >
                  <Star size={15} className={clsx(d.is_default && "fill-current")} />
                </button>
                <div className="flex shrink-0">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label="Выше"
                    className="grid h-8 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-[#23262D]"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={i === list.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Ниже"
                    className="grid h-8 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-[#23262D]"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    confirm({
                      title: "Удалить статус?",
                      message: `Задачи со статусом «${d.label}» останутся в категории «${STATUS_LABEL[d.category]}».`,
                      danger: true,
                      confirmLabel: "Удалить",
                      onConfirm: () => remove.mutateAsync(d.id),
                    })
                  }
                  aria-label={`Удалить статус «${d.label}»`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex flex-wrap items-center gap-2 py-4 sm:flex-nowrap"
        >
          <input
            type="color"
            aria-label="Цвет нового статуса"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-[#14161A]"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Новый статус, например «Согласование»"
            aria-label="Название нового статуса"
            maxLength={100}
            className="input !h-8 min-w-0 flex-1 !py-0 text-[13px]"
          />
          <select
            aria-label="Категория нового статуса"
            value={category}
            onChange={(e) => {
              const c = e.target.value as TaskStatus;
              setCategory(c);
              setColor(BASE_STATUS_COLOR[c]);
            }}
            className="input !h-8 !w-40 !py-0 text-[13px]"
          >
            {BASE_STATUS_ORDER.map((c) => (
              <option key={c} value={c}>
                {STATUS_LABEL[c]}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" disabled={!label.trim() || create.isPending} leftIcon={<Plus size={15} />}>
            Добавить
          </Button>
        </form>
      </SettingsSection>
    </div>
  );
}

/** Выбор цвета: сохраняем с небольшой задержкой, пока пользователь двигает ползунок. */
function ColorInput({ label, value, onSave }: { label: string; value: string; onSave: (c: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v.toLowerCase() === value.toLowerCase()) return;
    const t = window.setTimeout(() => onSave(v), 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <input
      type="color"
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-[#14161A]"
    />
  );
}
