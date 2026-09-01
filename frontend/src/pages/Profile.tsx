import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/store/auth";
import { Avatar, Modal } from "@/components/ui";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import {
  Mail, Shield, Layers, Clock, CheckCircle2, Camera, Trash2, KeyRound, Check, Pencil,
  Cake, Phone, Briefcase, User as UserIcon, Award, Target, X, Plus, Trophy,
} from "lucide-react";

type Role = { id: number; name: string };
type Department = { id: number; name: string };

type FullUser = {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
  is_active: boolean;
  is_superuser?: boolean;
  is_platform_admin?: boolean;
  roles: Role[];
  department?: Department | null;
  last_login_at?: string | null;
  created_at: string;
  position?: string | null;
  phone?: string | null;
  bio?: string | null;
  birthday?: string | null;
  hire_date?: string | null;
  manager_id?: number | null;
};

type Skill = { id: number; name: string; category?: string | null };
type UserSkill = { id: number; skill_id: number; skill: Skill; level: "novice" | "intermediate" | "expert" };
type Goal = {
  id: number; user_id: number; title: string; description?: string | null;
  target_value?: number | string | null; current_value?: number | string | null; unit?: string | null;
  deadline?: string | null;
  status: "not_started" | "in_progress" | "completed" | "cancelled";
  created_at: string; completed_at?: string | null;
};

const SKILL_LEVEL_LABEL: Record<UserSkill["level"], string> = {
  novice: "начинающий", intermediate: "средний", expert: "эксперт",
};

const GOAL_STATUS_LABEL: Record<Goal["status"], { label: string; color: string }> = {
  not_started: { label: "Не начата", color: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" },
  in_progress: { label: "В работе", color: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  completed: { label: "Завершена", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  cancelled: { label: "Отменена", color: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
};

export default function Profile() {
  const { id: idParam } = useParams();
  const { me, fetchMe, can } = useAuth();
  const viewedId = idParam ? Number(idParam) : me?.id ?? 0;
  const isSelf = !idParam || viewedId === me?.id;

  // Свой профиль — берём из useAuth. Чужой — грузим отдельно.
  const otherUserQ = useQuery({
    queryKey: ["users", viewedId],
    queryFn: async () => (await api.get<FullUser>(`/api/users/${viewedId}`)).data,
    enabled: !isSelf && viewedId > 0,
    staleTime: 30_000,
  });

  const user: FullUser | null = isSelf
    ? (me as unknown as FullUser | null)
    : otherUserQ.data ?? null;

  const skillsQ = useQuery({
    queryKey: ["hr", "user-skills", viewedId],
    queryFn: async () => (await api.get<UserSkill[]>(`/api/hr/users/${viewedId}/skills`)).data,
    enabled: viewedId > 0 && can("hr.view_profiles"),
    staleTime: 60_000,
  });

  const goalsQ = useQuery({
    queryKey: ["hr", "goals", viewedId],
    queryFn: async () => (await api.get<Goal[]>("/api/hr/goals", { params: { user_id: viewedId } })).data,
    enabled: viewedId > 0 && (isSelf || can("hr.view_profiles")),
    staleTime: 30_000,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState<Goal | "new" | null>(null);

  const canEdit = isSelf || can("users.update");
  const canManageGoals = can("hr.manage_goals");

  if (!user && !isSelf && otherUserQ.isPending) {
    return <div className="text-sm text-neutral-500">Загрузка…</div>;
  }
  if (!user) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{isSelf ? "Профиль" : user.name}</h1>
        <p className="text-sm text-neutral-500">
          {isSelf ? "Данные вашего аккаунта и профиля" : "Профиль сотрудника"}
        </p>
      </div>

      <ProfileHeader user={user} isSelf={isSelf} canEdit={canEdit} onEdit={() => setEditOpen(true)} refetch={fetchMe} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Award size={16} /> Скиллы
            </h3>
            {canEdit && (
              <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setSkillsOpen(true)}>
                <Plus size={13} /> Управлять
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(skillsQ.data ?? []).length === 0 && (
              <span className="text-sm text-neutral-500">Ещё нет скиллов</span>
            )}
            {(skillsQ.data ?? []).map((s) => (
              <span
                key={s.id}
                className="chip bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                title={SKILL_LEVEL_LABEL[s.level]}
              >
                {s.skill.name}
                <span className="ml-1 text-[10px] opacity-60">· {SKILL_LEVEL_LABEL[s.level]}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Target size={16} /> Цели
            </h3>
            {canManageGoals && (
              <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setGoalOpen("new")}>
                <Plus size={13} /> Новая цель
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(goalsQ.data ?? []).length === 0 && (
              <div className="text-sm text-neutral-500">Пока целей нет</div>
            )}
            {(goalsQ.data ?? []).map((g) => (
              <GoalRow key={g.id} goal={g} onOpen={() => setGoalOpen(g)} />
            ))}
          </div>
        </div>
      </div>

      {isSelf && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Shield size={16} /> Роли
            </h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {user.roles.length === 0 && <span className="text-sm text-neutral-500">Не назначено</span>}
            {user.roles.map((r) => (
              <span key={r.id} className="chip bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                {r.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {editOpen && (
        <EditProfileModal
          user={user}
          isSelf={isSelf}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            if (isSelf) await fetchMe();
            else await otherUserQ.refetch();
          }}
        />
      )}
      {skillsOpen && (
        <ManageSkillsModal
          userId={viewedId}
          currentSkills={skillsQ.data ?? []}
          onClose={() => setSkillsOpen(false)}
        />
      )}
      {goalOpen && (
        <GoalModal
          userId={viewedId}
          goal={goalOpen === "new" ? null : goalOpen}
          canManage={canManageGoals}
          isOwner={isSelf}
          onClose={() => setGoalOpen(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Header card
// ============================================================================

function ProfileHeader({
  user, isSelf, canEdit, onEdit, refetch,
}: {
  user: FullUser; isSelf: boolean; canEdit: boolean; onEdit: () => void; refetch: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      await api.post("/api/users/me/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => { setError(null); refetch(); },
    onError: (e: any) => setError(e?.response?.data?.detail || "Не удалось загрузить"),
  });

  const removeAvatar = useMutation({
    mutationFn: async () => { await api.delete("/api/users/me/avatar"); },
    onSuccess: () => refetch(),
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
    e.target.value = "";
  };

  return (
    <div className="card p-6">
      <div className="flex items-start gap-4">
        <div className="group relative">
          <Avatar name={user.name} size={72} url={user.avatar_url} />
          {isSelf && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
                className="absolute inset-0 grid place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
                title="Сменить аватар"
              >
                <Camera size={20} />
              </button>
              <input
                ref={fileRef} type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden" onChange={onPick}
              />
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-xl font-semibold">{user.name}</h2>
            {user.is_superuser && (
              <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">super</span>
            )}
            <span className={`chip ${user.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
              {user.is_active ? "активен" : "заблокирован"}
            </span>
          </div>
          {user.position && (
            <div className="mt-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">{user.position}</div>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-sm text-neutral-500">
            <Mail size={14} /> {user.email}
          </div>
          {user.phone && (
            <div className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-500">
              <Phone size={14} /> {user.phone}
            </div>
          )}
          {isSelf && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost !px-2 !py-1" disabled={upload.isPending}>
                <Camera size={13} /> {user.avatar_url ? "Сменить аватар" : "Загрузить аватар"}
              </button>
              {user.avatar_url && (
                <button type="button" onClick={() => removeAvatar.mutate()} className="btn-ghost !px-2 !py-1 text-rose-500" disabled={removeAvatar.isPending}>
                  <Trash2 size={13} /> Удалить
                </button>
              )}
              {upload.isPending && <span className="text-neutral-500">Загрузка…</span>}
            </div>
          )}
          {error && <div className="mt-2 text-xs text-rose-500">{error}</div>}
          {user.bio && (
            <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-800/50">{user.bio}</div>
          )}
        </div>

        {canEdit && (
          <button type="button" onClick={onEdit} className="btn-ghost !p-2" title="Редактировать" aria-label="Редактировать">
            <Pencil size={16} />
          </button>
        )}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Field icon={<Layers size={14} />} label="Отдел" value={user.department?.name || "—"} />
        <Field icon={<Briefcase size={14} />} label="Должность" value={user.position || "—"} />
        <Field icon={<Cake size={14} />} label="День рождения" value={fmtDate(user.birthday)} />
        <Field icon={<UserIcon size={14} />} label="Дата найма" value={fmtDate(user.hire_date)} />
        {isSelf && (
          <>
            <Field icon={<Clock size={14} />} label="Последний вход" value={user.last_login_at ? new Date(user.last_login_at).toLocaleString("ru-RU") : "—"} />
            <Field icon={<CheckCircle2 size={14} />} label="Аккаунт создан" value={new Date(user.created_at).toLocaleDateString("ru-RU")} />
          </>
        )}
      </div>
    </div>
  );
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-100 p-3 dark:border-neutral-800">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {icon} {label}
      </div>
      <div className="text-sm truncate" title={value}>{value}</div>
    </div>
  );
}

// ============================================================================
// Edit profile modal (self + admin variant)
// ============================================================================

type EditFormState = {
  name: string; email: string;
  new_password: string; confirm_password: string; current_password: string;
  position: string; phone: string; bio: string; birthday: string; hire_date: string;
};

function EditProfileModal({
  user, isSelf, onClose, onSaved,
}: {
  user: FullUser; isSelf: boolean; onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<EditFormState>({
    name: user.name,
    email: user.email,
    new_password: "",
    confirm_password: "",
    current_password: "",
    position: user.position ?? "",
    phone: user.phone ?? "",
    bio: user.bio ?? "",
    birthday: user.birthday ?? "",
    hire_date: user.hire_date ?? "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [showPasswordFields, setShowPasswordFields] = useState(false);

  const nameChanged = form.name.trim() !== user.name;
  const emailChanged = isSelf && form.email.trim().toLowerCase() !== user.email.toLowerCase();
  const wantsPassword = isSelf && showPasswordFields && form.new_password.length > 0;
  const passwordMismatch = wantsPassword && form.new_password !== form.confirm_password;
  const requiresCurrent = emailChanged || wantsPassword;
  const canSubmit = !passwordMismatch && (!requiresCurrent || form.current_password.length > 0);

  const save = useMutation({
    mutationFn: async () => {
      if (isSelf) {
        const body: Record<string, unknown> = {};
        if (nameChanged) body.name = form.name.trim();
        if (emailChanged) body.email = form.email.trim();
        if (wantsPassword) body.new_password = form.new_password;
        if (requiresCurrent) body.current_password = form.current_password;
        if (form.position !== (user.position ?? "")) body.position = form.position;
        if (form.phone !== (user.phone ?? "")) body.phone = form.phone;
        if (form.bio !== (user.bio ?? "")) body.bio = form.bio;
        if (form.birthday !== (user.birthday ?? "")) body.birthday = form.birthday || null;
        await api.patch("/api/users/me", body);
      } else {
        // Админ-редактирование чужого профиля через /api/users/{id}
        const body: Record<string, unknown> = {};
        if (nameChanged) body.name = form.name.trim();
        if (form.position !== (user.position ?? "")) body.position = form.position;
        if (form.phone !== (user.phone ?? "")) body.phone = form.phone;
        if (form.bio !== (user.bio ?? "")) body.bio = form.bio;
        if (form.birthday !== (user.birthday ?? "")) body.birthday = form.birthday || null;
        if (form.hire_date !== (user.hire_date ?? "")) body.hire_date = form.hire_date || null;
        await api.patch(`/api/users/${user.id}`, body);
      }
    },
    onSuccess: async () => {
      setFormError(null);
      await onSaved();
      toast.success("Профиль обновлён");
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Редактировать профиль" size="lg">
      <form
        onSubmit={(e) => { e.preventDefault(); if (canSubmit) save.mutate(); }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Имя</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </label>
          {isSelf && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Должность</span>
            <input className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Телефон</span>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">День рождения</span>
            <input className="input" type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} />
          </label>
          {!isSelf && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Дата найма</span>
              <input className="input" type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
            </label>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">О себе</span>
          <textarea
            className="input min-h-[80px]"
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            placeholder="Кратко о себе, опыте, интересах"
          />
        </label>

        {isSelf && (
          <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
            {!showPasswordFields ? (
              <button type="button" className="btn-ghost !px-2 !py-1 text-sm" onClick={() => setShowPasswordFields(true)}>
                <KeyRound size={14} /> Сменить пароль
              </button>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Новый пароль</span>
                  <input className="input" type="password" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} placeholder="Мин. 8 символов, буквы и цифры" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Подтверждение</span>
                  <input className="input" type="password" value={form.confirm_password} onChange={(e) => setForm({ ...form, confirm_password: e.target.value })} />
                  {passwordMismatch && (<div className="mt-1 text-[11px] text-rose-500">Пароли не совпадают</div>)}
                </label>
              </div>
            )}
          </div>
        )}

        {requiresCurrent && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Текущий пароль <span className="text-rose-500">*</span>
            </span>
            <input className="input" type="password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} placeholder="Требуется для смены email или пароля" />
          </label>
        )}

        {formError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            {formError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={!canSubmit || save.isPending}>
            <Check size={14} /> Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// Skills modal
// ============================================================================

function ManageSkillsModal({
  userId, currentSkills, onClose,
}: {
  userId: number; currentSkills: UserSkill[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const skillsQ = useQuery({
    queryKey: ["hr", "skills"],
    queryFn: async () => (await api.get<Skill[]>("/api/hr/skills")).data,
    staleTime: 300_000,
  });

  const [newSkillName, setNewSkillName] = useState("");

  const createSkill = useMutation({
    mutationFn: async () => (await api.post<Skill>("/api/hr/skills", { name: newSkillName.trim() })).data,
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["hr", "skills"] });
      setNewSkillName("");
      // сразу присваиваем юзеру
      assign.mutate({ skill_id: s.id, level: "intermediate" });
    },
    onError: (e) => toast.error("Не удалось создать", extractApiError(e).message),
  });

  const assign = useMutation({
    mutationFn: async (payload: { skill_id: number; level: UserSkill["level"] }) => {
      await api.post(`/api/hr/users/${userId}/skills`, payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr", "user-skills", userId] }),
    onError: (e) => toast.error("Не удалось", extractApiError(e).message),
  });

  const remove = useMutation({
    mutationFn: async (skill_id: number) => {
      await api.delete(`/api/hr/users/${userId}/skills/${skill_id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr", "user-skills", userId] }),
    onError: (e) => toast.error("Не удалось", extractApiError(e).message),
  });

  const currentIds = new Set(currentSkills.map((s) => s.skill_id));
  const available = (skillsQ.data ?? []).filter((s) => !currentIds.has(s.id));

  return (
    <Modal open onClose={onClose} title="Скиллы" size="md">
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">Уже добавлены</div>
          <div className="flex flex-wrap gap-1.5">
            {currentSkills.length === 0 && <span className="text-sm text-neutral-500">Пока пусто</span>}
            {currentSkills.map((s) => (
              <span key={s.id} className="chip bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                {s.skill.name}
                <select
                  className="ml-1 bg-transparent text-[10px]"
                  value={s.level}
                  onChange={(e) => assign.mutate({ skill_id: s.skill_id, level: e.target.value as UserSkill["level"] })}
                >
                  <option value="novice">начинающий</option>
                  <option value="intermediate">средний</option>
                  <option value="expert">эксперт</option>
                </select>
                <button
                  type="button"
                  onClick={() => remove.mutate(s.skill_id)}
                  className="ml-1 opacity-60 hover:opacity-100"
                  title="Удалить"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">Доступные</div>
          <div className="flex flex-wrap gap-1.5">
            {available.length === 0 && <span className="text-sm text-neutral-500">Все доступные добавлены</span>}
            {available.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => assign.mutate({ skill_id: s.id, level: "intermediate" })}
                className="chip bg-neutral-100 text-neutral-700 hover:bg-brand-50 hover:text-brand-700 dark:bg-neutral-800 dark:text-neutral-300"
              >
                <Plus size={10} /> {s.name}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div className="mb-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">Создать новый скилл</div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              placeholder="Название скилла"
            />
            <button
              type="button"
              className="btn-primary"
              disabled={newSkillName.trim().length === 0 || createSkill.isPending}
              onClick={() => createSkill.mutate()}
            >
              <Plus size={14} /> Добавить
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button type="button" className="btn-primary" onClick={onClose}>Готово</button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Goals
// ============================================================================

function GoalRow({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  const status = GOAL_STATUS_LABEL[goal.status];
  const target = num(goal.target_value);
  const current = num(goal.current_value);
  const progress = target && target > 0 ? Math.min(100, ((current ?? 0) / target) * 100) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-neutral-200 p-3 text-left hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{goal.title}</div>
          {goal.deadline && (
            <div className="mt-0.5 text-xs text-neutral-500">
              до {new Date(goal.deadline).toLocaleDateString("ru-RU")}
            </div>
          )}
        </div>
        <span className={`chip text-[10px] ${status.color}`}>{status.label}</span>
      </div>
      {progress !== null && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
            <span>{current ?? 0}{goal.unit ? ` ${goal.unit}` : ""}</span>
            <span>{target}{goal.unit ? ` ${goal.unit}` : ""}</span>
          </div>
        </div>
      )}
    </button>
  );
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function GoalModal({
  userId, goal, canManage, isOwner, onClose,
}: {
  userId: number; goal: Goal | null; canManage: boolean; isOwner: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = !goal;

  const [form, setForm] = useState({
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    target_value: goal?.target_value != null ? String(goal.target_value) : "",
    current_value: goal?.current_value != null ? String(goal.current_value) : "",
    unit: goal?.unit ?? "",
    deadline: goal?.deadline ?? "",
    status: goal?.status ?? "not_started" as Goal["status"],
  });

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description || null,
        target_value: form.target_value ? Number(form.target_value) : null,
        current_value: form.current_value ? Number(form.current_value) : null,
        unit: form.unit || null,
        deadline: form.deadline || null,
        status: form.status,
      };
      if (isNew) {
        body.user_id = userId;
        await api.post("/api/hr/goals", body);
      } else {
        await api.patch(`/api/hr/goals/${goal!.id}`, body);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "goals", userId] });
      qc.invalidateQueries({ queryKey: ["hr", "goals"] });
      toast.success(isNew ? "Цель создана" : "Цель обновлена");
      onClose();
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: async () => { await api.delete(`/api/hr/goals/${goal!.id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "goals", userId] });
      qc.invalidateQueries({ queryKey: ["hr", "goals"] });
      toast.success("Цель удалена");
      onClose();
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  // Владелец без manage может только status/current_value обновить.
  const managingFieldsDisabled = !isNew && !canManage;

  return (
    <Modal open onClose={onClose} title={isNew ? "Новая цель" : "Цель"} size="md">
      <form
        onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) save.mutate(); }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            disabled={managingFieldsDisabled}
            required
            autoFocus
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
          <textarea
            className="input min-h-[80px]"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            disabled={managingFieldsDisabled}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Цель</span>
            <input
              className="input" type="number" step="0.01"
              value={form.target_value}
              onChange={(e) => setForm({ ...form, target_value: e.target.value })}
              disabled={managingFieldsDisabled}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Текущее</span>
            <input
              className="input" type="number" step="0.01"
              value={form.current_value}
              onChange={(e) => setForm({ ...form, current_value: e.target.value })}
              disabled={!isOwner && !canManage}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Единица</span>
            <input
              className="input"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              disabled={managingFieldsDisabled}
              placeholder="штук, %, тг"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Дедлайн</span>
            <input
              className="input" type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              disabled={managingFieldsDisabled}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Статус</span>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Goal["status"] })}
              disabled={!isOwner && !canManage}
            >
              {(Object.keys(GOAL_STATUS_LABEL) as Goal["status"][]).map((s) => (
                <option key={s} value={s}>{GOAL_STATUS_LABEL[s].label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex justify-between gap-2 pt-2">
          <div>
            {!isNew && canManage && (
              <button type="button" className="btn-ghost text-rose-500" onClick={() => del.mutate()} disabled={del.isPending}>
                <Trophy size={14} /> Удалить
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn-primary" disabled={form.title.trim().length === 0 || save.isPending}>
              <Check size={14} /> Сохранить
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
