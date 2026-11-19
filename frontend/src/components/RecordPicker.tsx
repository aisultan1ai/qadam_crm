/**
 * Выбор связанной записи (контакт, компания, сделка, проект, задача, сотрудник, запись Объекта)
 * с поиском по названию, и чип связи с превью карточки по наведению.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import clsx from "clsx";

import { api } from "@/api/client";

export type RefItem = { id: number; label: string; subtitle?: string | null; url?: string | null };
type Preview = RefItem & { kind: string; details: [string, string][] };

export const SYSTEM_TARGETS: { key: string; label: string }[] = [
  { key: "contact", label: "Контакт" },
  { key: "company", label: "Компания (контрагент)" },
  { key: "deal", label: "Сделка" },
  { key: "project", label: "Проект" },
  { key: "task", label: "Задача" },
  { key: "user", label: "Сотрудник" },
  { key: "contract", label: "Договор" },
];

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Поле выбора: одна запись или несколько (multiple). value — id или массив id; known — подписи уже выбранных. */
export function RecordPicker({
  target,
  value,
  known,
  multiple,
  onChange,
  placeholder = "Найдите по названию…",
}: {
  target: string;
  value: number | number[] | null | undefined;
  known?: RefItem[];
  multiple?: boolean;
  onChange: (value: number | number[] | null, items: RefItem[]) => void;
  placeholder?: string;
}) {
  const ids: number[] = value == null ? [] : Array.isArray(value) ? value : [value];
  const [labels, setLabels] = useState<Record<number, RefItem>>(() =>
    Object.fromEntries((known ?? []).map((k) => [k.id, k])),
  );
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const { data, isFetching } = useQuery({
    enabled: open,
    queryKey: ["lookup", target, dq],
    queryFn: async () => (await api.get<RefItem[]>("/api/objects/lookup", { params: { target, q: dq || undefined } })).data,
    staleTime: 15_000,
  });

  const selected = ids.map((i) => labels[i] ?? { id: i, label: `#${i}` });
  const pick = (item: RefItem) => {
    const next = { ...labels, [item.id]: item };
    setLabels(next);
    if (multiple) {
      const nextIds = ids.includes(item.id) ? ids.filter((x) => x !== item.id) : [...ids, item.id];
      onChange(nextIds, nextIds.map((i) => next[i]));
    } else {
      onChange(item.id, [item]);
      setOpen(false);
    }
    setQ("");
  };
  const remove = (id: number) => {
    const nextIds = ids.filter((x) => x !== id);
    onChange(multiple ? nextIds : null, nextIds.map((i) => labels[i]));
  };

  return (
    <div ref={box} className="relative">
      <div
        className="input flex min-h-[38px] flex-wrap items-center gap-1 !py-1"
        onClick={() => setOpen(true)}
      >
        {selected.map((s) => (
          <span key={s.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[12.5px] text-brand-800 dark:bg-brand-500/15 dark:text-brand-200">
            <span className="truncate">{s.label}</span>
            <button
              type="button"
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                remove(s.id);
              }}
              aria-label={`Убрать ${s.label}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {(multiple || !selected.length) && (
          <span className="flex min-w-[120px] flex-1 items-center gap-1">
            <Search size={13} className="shrink-0 text-zinc-400" />
            <input
              className="w-full bg-transparent text-[13px] outline-none"
              value={q}
              placeholder={selected.length ? "" : placeholder}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
            />
          </span>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-[#1B1E23]">
          {isFetching && !data ? (
            <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-zinc-500">
              <Loader2 size={13} className="animate-spin" /> Ищем…
            </div>
          ) : !data?.length ? (
            <div className="px-3 py-2 text-[13px] text-zinc-500">
              {dq ? "Ничего не найдено" : "Записей нет или нет доступа к разделу"}
            </div>
          ) : (
            data.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => pick(item)}
                className={clsx(
                  "flex w-full flex-col px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-white/5",
                  ids.includes(item.id) && "bg-brand-50 dark:bg-brand-500/10",
                )}
              >
                <span className="truncate text-[13px] text-zinc-900 dark:text-zinc-100">{item.label}</span>
                {item.subtitle && <span className="truncate text-[11.5px] text-zinc-500">{item.subtitle}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Чип связи: название-ссылка, по наведению — карточка с основными полями. */
export function RefChip({ target, item }: { target: string; item: RefItem }) {
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const { data, isFetching, isError } = useQuery({
    enabled: hover && !item.label.startsWith("#"),
    queryKey: ["ref-preview", target, item.id],
    queryFn: async () => (await api.get<Preview>("/api/objects/preview", { params: { target, id: item.id } })).data,
    staleTime: 60_000,
    retry: false,
  });
  const inner = item.url ? (
    <Link to={item.url} className="truncate text-brand-700 hover:underline dark:text-brand-300" onClick={(e) => e.stopPropagation()}>
      {item.label}
    </Link>
  ) : (
    <span className="truncate">{item.label}</span>
  );
  return (
    <span
      className="relative inline-flex max-w-full"
      onMouseEnter={() => {
        timer.current = setTimeout(() => setHover(true), 300);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setHover(false);
      }}
    >
      {inner}
      {hover && !item.label.startsWith("#") && (
        <span className="absolute left-0 top-full z-40 mt-1 block w-64 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-700 dark:bg-[#1B1E23]">
          {isFetching && !data ? (
            <span className="flex items-center gap-2 text-[12px] text-zinc-500">
              <Loader2 size={12} className="animate-spin" /> Загрузка…
            </span>
          ) : isError || !data ? (
            <span className="text-[12px] text-zinc-500">Нет доступа к записи</span>
          ) : (
            <>
              <span className="block text-[11px] uppercase tracking-wide text-zinc-400">{data.kind}</span>
              <span className="block text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">{data.label}</span>
              {data.details.length > 0 && (
                <span className="mt-1.5 block space-y-0.5">
                  {data.details.map(([k, v]) => (
                    <span key={k} className="flex gap-2 text-[12px]">
                      <span className="shrink-0 text-zinc-500">{k}:</span>
                      <span className="truncate text-zinc-800 dark:text-zinc-200">{v}</span>
                    </span>
                  ))}
                </span>
              )}
            </>
          )}
        </span>
      )}
    </span>
  );
}
