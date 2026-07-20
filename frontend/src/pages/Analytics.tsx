import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Loader } from "@/components/ui";

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

export default function Analytics() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-employees"],
    queryFn: async () => (await api.get<Employees>("/api/analytics/employees")).data,
    refetchOnMount: "always",
    staleTime: 0,
  });

  if (isLoading || !data) return <Loader />;

  const exportCSV = () => {
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
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Аналитика сотрудников</h1>
          <p className="text-sm text-neutral-500">За последние 30 дней</p>
        </div>
        <button className="btn-secondary" onClick={exportCSV}>Экспорт CSV</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/40">
            <tr>
              <th className="px-5 py-2.5 text-left">Сотрудник</th>
              <th className="px-5 py-2.5 text-left">Всего</th>
              <th className="px-5 py-2.5 text-left">Завершено</th>
              <th className="px-5 py-2.5 text-left">Просрочено</th>
              <th className="px-5 py-2.5 text-left">Эффективность</th>
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e) => (
              <tr key={e.user_id} className="table-row">
                <td className="px-5 py-3">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-neutral-500">{e.email}</div>
                </td>
                <td className="px-5 py-3">{e.total}</td>
                <td className="px-5 py-3 text-emerald-600">{e.done}</td>
                <td className="px-5 py-3 text-rose-600">{e.overdue}</td>
                <td className="px-5 py-3 w-64">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                      <div className="h-full bg-brand-500" style={{ width: `${e.efficiency}%` }} />
                    </div>
                    <span className="text-xs text-neutral-500 w-8">{e.efficiency}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {data.employees.length === 0 && (
              <tr><td className="py-10 text-center text-sm text-neutral-500" colSpan={5}>Нет данных</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
