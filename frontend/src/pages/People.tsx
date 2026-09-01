import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Users2, Award, Send, Cake, Building2 } from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { Avatar, Modal } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Department = { id: number; name: string };
type User = {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
  is_active: boolean;
  position?: string | null;
  phone?: string | null;
  department?: { id: number; name: string } | null;
  department_id?: number | null;
  manager_id?: number | null;
  birthday?: string | null;
};
type Skill = { id: number; name: string; category?: string | null };
type UserSkill = { id: number; skill_id: number; skill: Skill; level: "novice" | "intermediate" | "expert" };

const BADGES = [
  { key: "teamwork", label: "Team-play", color: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  { key: "innovation", label: "Innovation", color: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
  { key: "help_other", label: "Helpful", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  { key: "excellence", label: "Excellence", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
] as const;

export default function People() {
  const { me, can } = useAuth();
  const [q, setQ] = useState("");
  const [depId, setDepId] = useState<number | "all">("all");
  const [skillId, setSkillId] = useState<number | "all">("all");
  const [kudosTarget, setKudosTarget] = useState<User | null>(null);

  const usersQ = useQuery({
    queryKey: ["hr", "people", { q }],
    queryFn: async () =>
      (await api.get<{ items: User[] }>("/api/users", { params: { q: q || undefined, per_page: 100 } })).data.items,
    staleTime: 30_000,
  });

  const depsQ = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/api/departments")).data,
    staleTime: 300_000,
  });

  const skillsQ = useQuery({
    queryKey: ["hr", "skills"],
    queryFn: async () => (await api.get<Skill[]>("/api/hr/skills")).data,
    staleTime: 300_000,
  });

  // Skills карта — грузим только если выбран фильтр по скиллу.
  const usersWithSkillQ = useQuery({
    queryKey: ["hr", "user-skills-by-skill", skillId],
    queryFn: async () => {
      if (skillId === "all") return [];
      const ids: number[] = [];
      // Простой fan-out: /api/hr/users/{id}/skills для каждого юзера. Для 100 юзеров — ок.
      for (const u of usersQ.data ?? []) {
        try {
          const skills = (await api.get<UserSkill[]>(`/api/hr/users/${u.id}/skills`)).data;
          if (skills.some((s) => s.skill_id === skillId)) ids.push(u.id);
        } catch {
          /* игнорируем — permission или сеть */
        }
      }
      return ids;
    },
    enabled: skillId !== "all" && !!usersQ.data,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const items = usersQ.data ?? [];
    return items.filter((u) => {
      if (depId !== "all" && u.department?.id !== depId) return false;
      if (skillId !== "all" && !(usersWithSkillQ.data ?? []).includes(u.id)) return false;
      return true;
    });
  }, [usersQ.data, depId, skillId, usersWithSkillQ.data]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Users2 size={22} /> Команда
        </h1>
        <p className="text-sm text-neutral-500">
          Сотрудники, отделы, скиллы. Кликните по карточке — откроется профиль.
        </p>
      </div>

      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="relative sm:col-span-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              className="input pl-9"
              placeholder="Поиск по имени или email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select
            className="input"
            value={depId}
            onChange={(e) => setDepId(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">Все отделы</option>
            {(depsQ.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            className="input"
            value={skillId}
            onChange={(e) => setSkillId(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">Все скиллы</option>
            {(skillsQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 text-xs text-neutral-500">
          Найдено: {filtered.length} из {usersQ.data?.length ?? 0}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {usersQ.isPending && (
          <div className="col-span-full text-sm text-neutral-500">Загрузка…</div>
        )}
        {filtered.map((u) => (
          <PersonCard
            key={u.id}
            user={u}
            currentUserId={me?.id ?? 0}
            canGiveKudos={can("kudos.give")}
            onGiveKudos={() => setKudosTarget(u)}
          />
        ))}
        {!usersQ.isPending && filtered.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
            Ничего не найдено
          </div>
        )}
      </div>

      {kudosTarget && (
        <KudosModal
          target={kudosTarget}
          onClose={() => setKudosTarget(null)}
        />
      )}
    </div>
  );
}

function PersonCard({
  user,
  currentUserId,
  canGiveKudos,
  onGiveKudos,
}: {
  user: User;
  currentUserId: number;
  canGiveKudos: boolean;
  onGiveKudos: () => void;
}) {
  const isSelf = user.id === currentUserId;
  const skillsQ = useQuery({
    queryKey: ["hr", "user-skills", user.id],
    queryFn: async () => (await api.get<UserSkill[]>(`/api/hr/users/${user.id}/skills`)).data,
    staleTime: 60_000,
  });

  const to = isSelf ? "/profile" : `/people/${user.id}`;

  return (
    <div className="card p-4 hover:shadow-md transition-shadow">
      <Link to={to} className="flex items-start gap-3">
        <Avatar name={user.name} url={user.avatar_url} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          {user.position && (
            <div className="truncate text-xs text-neutral-600 dark:text-neutral-400">{user.position}</div>
          )}
          {user.department?.name && (
            <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-neutral-500">
              <Building2 size={11} /> {user.department.name}
            </div>
          )}
        </div>
      </Link>
      <div className="mt-3 flex flex-wrap gap-1">
        {(skillsQ.data ?? []).slice(0, 4).map((s) => (
          <span
            key={s.id}
            className="chip bg-neutral-100 text-[10px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            title={`${s.skill.name} — ${SKILL_LEVELS[s.level]}`}
          >
            {s.skill.name}
          </span>
        ))}
        {(skillsQ.data?.length ?? 0) > 4 && (
          <span className="chip bg-neutral-100 text-[10px] text-neutral-500 dark:bg-neutral-800">
            +{(skillsQ.data?.length ?? 0) - 4}
          </span>
        )}
      </div>
      {user.birthday && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-neutral-500">
          <Cake size={11} /> {new Date(user.birthday).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
        </div>
      )}
      {!isSelf && canGiveKudos && (
        <button
          type="button"
          onClick={onGiveKudos}
          className="btn-ghost mt-3 !w-full !justify-center text-xs"
        >
          <Award size={13} /> Дать кудос
        </button>
      )}
    </div>
  );
}

const SKILL_LEVELS: Record<string, string> = {
  novice: "начинающий",
  intermediate: "средний",
  expert: "эксперт",
};

function KudosModal({ target, onClose }: { target: User; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [badge, setBadge] = useState<typeof BADGES[number]["key"]>("teamwork");

  const save = useMutation({
    mutationFn: async () => {
      await api.post("/api/hr/kudos", { to_user_id: target.id, message: message.trim(), badge });
    },
    onSuccess: () => {
      toast.success("Кудос отправлен", `${target.name} получит уведомление`);
      qc.invalidateQueries({ queryKey: ["hr", "kudos"] });
      onClose();
    },
    onError: (e) => toast.error("Не удалось отправить", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={`Кудос для ${target.name}`} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim().length > 0) save.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <div className="mb-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">Категория</div>
          <div className="flex flex-wrap gap-2">
            {BADGES.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setBadge(b.key)}
                className={`chip ${b.color} ${badge === b.key ? "ring-2 ring-offset-1 ring-brand-500" : "opacity-70"}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            За что благодарите
          </span>
          <textarea
            className="input min-h-[100px]"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            required
            placeholder="Опишите, что коллега сделал, за что вы благодарны"
          />
          <div className="mt-1 text-right text-[11px] text-neutral-400">{message.length}/500</div>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button
            type="submit"
            className="btn-primary"
            disabled={message.trim().length === 0 || save.isPending}
          >
            <Send size={14} /> Отправить
          </button>
        </div>
      </form>
    </Modal>
  );
}
