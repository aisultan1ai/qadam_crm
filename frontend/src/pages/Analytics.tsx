import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { api } from "@/api/client";
import { Skeleton } from "@/components/Skeleton";
import { useCountUp } from "@/hooks/useCountUp";

type Employees = {
  since: string;
  employees: {
    user_id: number;
    name: string;
    email: string;
    total: number;
    done: number;
    overdue: number;
    efficiency: number;
  }[];
};

type SortKey = "name" | "total" | "done" | "overdue" | "efficiency";
type SortDir = "asc" | "desc";

export default function Analytics() {
  const { data, isPending } = useQuery({
    queryKey: ["analytics-employees"],
    queryFn: async () => (await api.get<Employees>("/api/analytics/employees")).data,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const [showSkeleton, setShowSkeleton] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("efficiency");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? data.employees.filter(
          (e) => e.name.toLowerCase().includes(needle) || e.email.toLowerCase().includes(needle),
        )
      : data.employees;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey] as string | number;
      const bv = b[sortKey] as string | number;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, query, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // По имени — по алфавиту, по метрикам — от большего к меньшему по умолчанию.
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  useEffect(() => {
    if (!isPending && data) {
      setContentVisible(true);
      const t = window.setTimeout(() => setShowSkeleton(false), 460);
      return () => window.clearTimeout(t);
    }
  }, [isPending, data]);

  const exportCSV = () => {
    if (!data) return;
    const rows = [
      ["Имя", "Email", "Всего", "Завершено", "Просрочено", "Эффективность %"],
      ...data.employees.map((e) => [e.name, e.email, e.total, e.done, e.overdue, e.efficiency]),
    ];
    const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="relative">
      {showSkeleton && (
        <div
          className={clsx(
            "absolute inset-0 transition-opacity duration-[420ms] ease-out-soft",
            contentVisible ? "opacity-0" : "opacity-100",
          )}
        >
          <AnalyticsSkeleton />
        </div>
      )}
      {data && (
        <div
          className={clsx(
            "space-y-5 transition-opacity duration-[420ms] ease-out-soft",
            contentVisible ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Аналитика сотрудников</h1>
              <p className="text-sm text-neutral-500">
                За последние 30 дней · показано {rows.length} из {data.employees.length}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-neutral-400" />
                <input
                  className="input w-64 pl-8"
                  placeholder="Поиск по имени / email…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button className="btn-secondary" onClick={exportCSV}>Экспорт CSV</button>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" aria-label="Эффективность сотрудников за последние 30 дней">
              <caption className="sr-only">
                Эффективность сотрудников за 30 дней: всего задач, завершено, просрочено, эффективность в процентах.
              </caption>
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/40">
                <tr>
                  <SortableTh label="Сотрудник" col="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                  <SortableTh label="Всего" col="total" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortableTh label="Завершено" col="done" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortableTh label="Просрочено" col="overdue" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortableTh label="Эффективность" col="efficiency" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <EmployeeRow key={e.user_id} row={e} index={i} start={contentVisible} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="py-10 text-center text-sm text-neutral-500" colSpan={5}>
                      {query ? "Ничего не найдено" : "Нет данных"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableTh({
  label,
  col,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (col: SortKey) => void;
  align: "left" | "right";
}) {
  const active = sortKey === col;
  return (
    <th className={clsx("px-5 py-2.5", align === "left" ? "text-left" : "text-right")}>
      <button
        className={clsx(
          "inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-neutral-900 dark:hover:text-white",
          active && "text-neutral-900 dark:text-white",
        )}
        onClick={() => onClick(col)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        {active ? (
          sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
        ) : (
          <ArrowUpDown size={11} className="opacity-40" />
        )}
      </button>
    </th>
  );
}

function EmployeeRow({
  row,
  index,
  start,
}: {
  row: Employees["employees"][number];
  index: number;
  start: boolean;
}) {
  const total = useCountUp(row.total, { duration: 900, delay: 220 + Math.min(index, 12) * 40, enabled: start });
  const done = useCountUp(row.done, { duration: 900, delay: 220 + Math.min(index, 12) * 40, enabled: start });
  const overdue = useCountUp(row.overdue, { duration: 900, delay: 220 + Math.min(index, 12) * 40, enabled: start });
  const eff = useCountUp(row.efficiency, { duration: 900, delay: 220 + Math.min(index, 12) * 40, enabled: start });
  const [barGrown, setBarGrown] = useState(false);
  useEffect(() => {
    if (!start) return;
    const t = window.setTimeout(() => setBarGrown(true), 260 + Math.min(index, 12) * 40);
    return () => window.clearTimeout(t);
  }, [start, index]);

  return (
    <tr className="table-row">
      <td className="px-5 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-neutral-500">{row.email}</div>
      </td>
      <td className="px-5 py-3 text-right tabular-nums">{total}</td>
      <td className="px-5 py-3 text-right text-emerald-600 tabular-nums">{done}</td>
      <td className="px-5 py-3 text-right text-rose-600 tabular-nums">{overdue}</td>
      <td className="px-5 py-3 w-64">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-[width] duration-[760ms] ease-out-soft"
              style={{ width: barGrown ? `${row.efficiency}%` : "0%" }}
            />
          </div>
          <span className="text-xs text-neutral-500 w-8 tabular-nums">{eff}%</span>
        </div>
      </td>
    </tr>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="card overflow-hidden p-5 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, j) => (
              <Skeleton key={j} className="h-4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
