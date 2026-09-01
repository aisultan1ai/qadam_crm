import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Cake, Target, Award, ArrowRight } from "lucide-react";
import { api } from "@/api/client";
import { Avatar } from "@/components/ui";
import { useAuth } from "@/store/auth";

type BirthdayUser = {
  id: number;
  name: string;
  avatar_url?: string | null;
  position?: string | null;
  department?: string | null;
  birthday: string;
  days_until: number;
};

type Goal = {
  id: number; title: string; deadline?: string | null;
  target_value?: number | string | null; current_value?: number | string | null; unit?: string | null;
  status: "not_started" | "in_progress" | "completed" | "cancelled";
};

type Kudos = {
  id: number; message: string; badge: "teamwork" | "innovation" | "help_other" | "excellence";
  from_user?: { id: number; name: string; avatar_url?: string | null } | null;
  to_user?: { id: number; name: string; avatar_url?: string | null } | null;
  created_at: string;
};

const BADGE_LABEL: Record<Kudos["badge"], { label: string; color: string }> = {
  teamwork: { label: "Team", color: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  innovation: { label: "Innovation", color: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
  help_other: { label: "Helpful", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  excellence: { label: "Excellence", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
};

// ============================================================================
// Birthdays
// ============================================================================

export function BirthdaysWidget() {
  const { can } = useAuth();
  const enabled = can("hr.view_profiles");
  const { data, isPending } = useQuery({
    enabled,
    queryKey: ["hr", "birthdays"],
    queryFn: async () =>
      (await api.get<BirthdayUser[]>("/api/hr/birthdays", { params: { days_ahead: 30 } })).data,
    staleTime: 60 * 60 * 1000, // раз в час
  });

  if (!enabled) return null;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Cake size={16} /> Дни рождения
        </h3>
        <Link to="/people" className="text-xs text-brand-600 hover:underline">Все</Link>
      </div>
      {isPending && <div className="text-sm text-neutral-500">Загрузка…</div>}
      {data && data.length === 0 && (
        <div className="text-sm text-neutral-500">В ближайший месяц ни у кого нет ДР</div>
      )}
      <div className="space-y-2">
        {(data ?? []).slice(0, 5).map((u) => (
          <Link
            key={u.id}
            to={`/people/${u.id}`}
            className="flex items-center gap-3 rounded-lg p-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
          >
            <Avatar name={u.name} url={u.avatar_url} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{u.name}</div>
              {u.position && <div className="truncate text-xs text-neutral-500">{u.position}</div>}
            </div>
            <div className="text-right text-xs">
              <div className="font-medium">
                {new Date(u.birthday).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
              </div>
              <div className={u.days_until === 0 ? "text-brand-600 font-medium" : "text-neutral-500"}>
                {u.days_until === 0 ? "сегодня 🎉" : `через ${u.days_until} дн.`}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// My goals
// ============================================================================

export function MyGoalsWidget() {
  const { me } = useAuth();
  const { data, isPending } = useQuery({
    enabled: !!me?.id,
    queryKey: ["hr", "goals", me?.id],
    queryFn: async () => (await api.get<Goal[]>("/api/hr/goals")).data,
    staleTime: 30_000,
  });

  const active = (data ?? []).filter((g) => g.status === "in_progress" || g.status === "not_started");

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Target size={16} /> Мои цели
        </h3>
        <Link to="/profile" className="text-xs text-brand-600 hover:underline flex items-center gap-1">
          Все <ArrowRight size={11} />
        </Link>
      </div>
      {isPending && <div className="text-sm text-neutral-500">Загрузка…</div>}
      {data && active.length === 0 && (
        <div className="text-sm text-neutral-500">Активных целей нет</div>
      )}
      <div className="space-y-2">
        {active.slice(0, 4).map((g) => {
          const target = num(g.target_value);
          const current = num(g.current_value);
          const progress = target && target > 0 ? Math.min(100, ((current ?? 0) / target) * 100) : null;
          return (
            <Link
              key={g.id}
              to="/profile"
              className="block rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
            >
              <div className="truncate text-sm font-medium">{g.title}</div>
              {g.deadline && (
                <div className="mt-0.5 text-[11px] text-neutral-500">
                  до {new Date(g.deadline).toLocaleDateString("ru-RU")}
                </div>
              )}
              {progress !== null && (
                <div className="mt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
                    <span>{current ?? 0}{g.unit ? ` ${g.unit}` : ""}</span>
                    <span>{target}{g.unit ? ` ${g.unit}` : ""}</span>
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// Kudos feed
// ============================================================================

export function KudosFeedWidget() {
  const { can } = useAuth();
  const enabled = can("hr.view_profiles") || can("kudos.give");
  const { data, isPending } = useQuery({
    enabled,
    queryKey: ["hr", "kudos", "recent"],
    queryFn: async () => (await api.get<Kudos[]>("/api/hr/kudos", { params: { limit: 8 } })).data,
    staleTime: 60_000,
  });

  if (!enabled) return null;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Award size={16} /> Кудос ленты
        </h3>
        <Link to="/people" className="text-xs text-brand-600 hover:underline">Отправить</Link>
      </div>
      {isPending && <div className="text-sm text-neutral-500">Загрузка…</div>}
      {data && data.length === 0 && (
        <div className="text-sm text-neutral-500">Ещё никто не благодарил коллег</div>
      )}
      <div className="space-y-3">
        {(data ?? []).map((k) => {
          const badge = BADGE_LABEL[k.badge];
          return (
            <div key={k.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex items-center gap-2 text-xs">
                {k.from_user && (
                  <Link to={`/people/${k.from_user.id}`} className="flex items-center gap-1 font-medium hover:underline">
                    <Avatar name={k.from_user.name} url={k.from_user.avatar_url} size={20} />
                    {k.from_user.name}
                  </Link>
                )}
                <ArrowRight size={11} className="text-neutral-400" />
                {k.to_user && (
                  <Link to={`/people/${k.to_user.id}`} className="flex items-center gap-1 font-medium hover:underline">
                    <Avatar name={k.to_user.name} url={k.to_user.avatar_url} size={20} />
                    {k.to_user.name}
                  </Link>
                )}
                <span className={`chip ml-auto text-[10px] ${badge.color}`}>{badge.label}</span>
              </div>
              <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-300 line-clamp-2">{k.message}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
