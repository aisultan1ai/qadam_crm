import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Users2, Award, Send, Cake, Building2 } from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { Avatar, Modal, EmptyState } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { useToast } from "@/components/Toast";

import { FilterSelect, SearchInput, Toolbar } from "@/components/page";
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
  { key: "teamwork", label: "Team-play", color: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25" },
  { key: "innovation", label: "Innovation", color: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/25" },
  { key: "help_other", label: "Helpful", color: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25" },
  { key: "excellence", label: "Excellence", color: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25" },
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
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Users2 size={22} /> Команда
        </h1>
        <p className="page-subtitle">
          Сотрудники, отделы, скиллы. Кликните по карточке — откроется профиль.
        </p>
      </div>

      <Toolbar right={<span className="text-[13px] tabular-nums text-zinc-500">Найдено: {filtered.length} из {usersQ.data?.length ?? 0}</span>}>
        <SearchInput value={q} onChange={setQ} placeholder="Поиск по имени или email" />
        <FilterSelect
          label="Отдел"
          value={depId === "all" ? "" : String(depId)}
          onChange={(v) => setDepId(v === "" ? "all" : Number(v))}
        >
          <option value="">Все отделы</option>
          {(depsQ.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Навык"
          value={skillId === "all" ? "" : String(skillId)}
          onChange={(v) => setSkillId(v === "" ? "all" : Number(v))}
        >
          <option value="">Все навыки</option>
          {(skillsQ.data ?? []).map((sk) => (
            <option key={sk.id} value={sk.id}>{sk.name}</option>
          ))}
        </FilterSelect>
      </Toolbar>

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
          <div className="col-span-full">
            <EmptyState
              icon={<Users2 size={32} />}
              title="Никого не найдено"
              description="Попробуйте изменить фильтры или поисковой запрос."
            />
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
    <div className="card p-5 hover:shadow-md transition-shadow">
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
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          className="mt-3 !justify-center"
          onClick={onGiveKudos}
          leftIcon={<Award size={13} />}
        >
          Дать кудос
        </Button>
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
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            type="submit"
            variant="primary"
            leftIcon={<Send size={14} />}
            isLoading={save.isPending}
            disabled={message.trim().length === 0}
          >
            Отправить
          </Button>
        </div>
      </form>
    </Modal>
  );
}
