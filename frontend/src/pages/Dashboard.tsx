import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Loader } from "@/components/ui";
import { CheckCircle2, Clock, ListTodo, AlertTriangle } from "lucide-react";
import { STATUS_LABEL, TaskStatus } from "@/types";
import { Link } from "react-router-dom";

type Dashboard = {
  total: number;
  in_progress: number;
  done: number;
  overdue: number;
  by_status: Record<string, number>;
  recent: {
    id: number;
    action: string;
    entity: string;
    entity_id: number;
    detail?: string | null;
    task_id?: number | null;
    created_at: string;
    user?: { id: number; name: string; email: string } | null;
  }[];
};

const STATUS_COLOR: Record<string, string> = {
  new: "bg-neutral-400",
  in_progress: "bg-sky-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
  cancelled: "bg-rose-500",
};

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get<Dashboard>("/api/analytics/dashboard")).data,
  });

  if (isLoading || !data) return <Loader />;

  const totalByStatus = Math.max(1, Object.values(data.by_status).reduce((a, b) => a + b, 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-neutral-500">Обзор задач и активности</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric icon={<ListTodo size={18} />} label="Всего задач" value={data.total} />
        <Metric icon={<Clock size={18} />} label="В работе" value={data.in_progress} accent="text-sky-600" />
        <Metric icon={<CheckCircle2 size={18} />} label="Завершены" value={data.done} accent="text-emerald-600" />
        <Metric icon={<AlertTriangle size={18} />} label="Просрочены" value={data.overdue} accent="text-rose-600" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Задачи по статусам</h2>
            <span className="text-xs text-neutral-500">Всего {totalByStatus}</span>
          </div>
          <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => {
              const v = data.by_status[s] || 0;
              const w = (v / totalByStatus) * 100;
              if (!w) return null;
              return <div key={s} className={STATUS_COLOR[s]} style={{ width: `${w}%` }} />;
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
              <div key={s} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[s]}`} />
                <div>
                  <div className="text-xs text-neutral-500">{STATUS_LABEL[s]}</div>
                  <div className="text-sm font-semibold">{data.by_status[s] || 0}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">Последние изменения</h2>
          <div className="space-y-3">
            {data.recent.length === 0 && <div className="text-sm text-neutral-500">Пока пусто</div>}
            {data.recent.map((r) => (
              <Link
                key={r.id}
                to={r.task_id ? `/tasks/${r.task_id}` : "#"}
                className="block rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              >
                <div className="text-sm">
                  <span className="font-medium">{r.user?.name || "Система"}</span>{" "}
                  <span className="text-neutral-500">— {r.action}</span>{" "}
                  {r.detail && <span className="text-neutral-500">· {r.detail}</span>}
                </div>
                <div className="text-[11px] text-neutral-400">{new Date(r.created_at).toLocaleString("ru-RU")}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: string }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2 text-neutral-500">
        <span className={accent}>{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
