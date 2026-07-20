import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/store/auth";
import { Avatar, Modal } from "@/components/ui";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Mail, Shield, Layers, Clock, CheckCircle2, Camera, Trash2, KeyRound, Check, Pencil } from "lucide-react";

type EditFormState = { name: string; email: string; new_password: string; confirm_password: string; current_password: string };

export default function Profile() {
  const { me, fetchMe } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      await api.post("/api/users/me/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => {
      setError(null);
      fetchMe();
    },
    onError: (e: any) => setError(e?.response?.data?.detail || "Не удалось загрузить"),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete("/api/users/me/avatar");
    },
    onSuccess: () => fetchMe(),
  });

  if (!me) return null;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
    e.target.value = "";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Профиль</h1>
        <p className="text-sm text-neutral-500">Данные вашего аккаунта</p>
      </div>

      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="group relative">
            <Avatar name={me.name} size={72} url={me.avatar_url} />
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
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={onPick}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-semibold">{me.name}</h2>
              {me.is_superuser && (
                <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                  super
                </span>
              )}
              <span
                className={`chip ${
                  me.is_active
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                }`}
              >
                {me.is_active ? "активен" : "заблокирован"}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-neutral-500">
              <Mail size={14} /> {me.email}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn-ghost !px-2 !py-1"
                disabled={upload.isPending}
              >
                <Camera size={13} /> {me.avatar_url ? "Сменить аватар" : "Загрузить аватар"}
              </button>
              {me.avatar_url && (
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  className="btn-ghost !px-2 !py-1 text-rose-500"
                  disabled={remove.isPending}
                >
                  <Trash2 size={13} /> Удалить
                </button>
              )}
              {upload.isPending && <span className="text-neutral-500">Загрузка…</span>}
            </div>
            {error && <div className="mt-2 text-xs text-rose-500">{error}</div>}
            <div className="mt-1 text-[11px] text-neutral-400">PNG, JPG, WEBP или GIF, до 5 МБ</div>
          </div>

          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="btn-ghost !p-2"
            title="Редактировать профиль"
            aria-label="Редактировать профиль"
          >
            <Pencil size={16} />
          </button>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field icon={<Layers size={14} />} label="Отдел" value={me.department?.name || "—"} />
          <Field
            icon={<Clock size={14} />}
            label="Последний вход"
            value={me.last_login_at ? new Date(me.last_login_at).toLocaleString("ru-RU") : "—"}
          />
          <Field
            icon={<CheckCircle2 size={14} />}
            label="Аккаунт создан"
            value={new Date(me.created_at).toLocaleDateString("ru-RU")}
          />
          <Field icon={<Shield size={14} />} label="ID аккаунта" value={String(me.id)} />
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
            <Shield size={12} /> Роли
          </div>
          <div className="flex flex-wrap gap-1.5">
            {me.roles.length === 0 && <span className="text-sm text-neutral-500">Не назначено</span>}
            {me.roles.map((r) => (
              <span
                key={r.id}
                className="chip bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {r.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {editOpen && (
        <EditProfileModal
          initialName={me.name}
          initialEmail={me.email}
          onClose={() => setEditOpen(false)}
          onSaved={fetchMe}
        />
      )}
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-100 p-3 dark:border-neutral-800">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {icon} {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function EditProfileModal({
  initialName,
  initialEmail,
  onClose,
  onSaved,
}: {
  initialName: string;
  initialEmail: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<EditFormState>({
    name: initialName,
    email: initialEmail,
    new_password: "",
    confirm_password: "",
    current_password: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [showPasswordFields, setShowPasswordFields] = useState(false);

  const nameChanged = form.name.trim() !== initialName;
  const emailChanged = form.email.trim().toLowerCase() !== initialEmail.toLowerCase();
  const wantsPassword = showPasswordFields && form.new_password.length > 0;
  const passwordMismatch = wantsPassword && form.new_password !== form.confirm_password;
  const requiresCurrent = emailChanged || wantsPassword;
  const dirty = nameChanged || emailChanged || wantsPassword;
  const canSubmit = dirty && !passwordMismatch && (!requiresCurrent || form.current_password.length > 0);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (nameChanged) body.name = form.name.trim();
      if (emailChanged) body.email = form.email.trim();
      if (wantsPassword) body.new_password = form.new_password;
      if (requiresCurrent) body.current_password = form.current_password;
      await api.patch("/api/users/me", body);
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
    <Modal open onClose={onClose} title="Редактировать профиль" size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) save.mutate();
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Имя</span>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            autoComplete="name"
            autoFocus
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            autoComplete="email"
          />
        </label>

        <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
          {!showPasswordFields ? (
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-sm"
              onClick={() => setShowPasswordFields(true)}
            >
              <KeyRound size={14} /> Сменить пароль
            </button>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Новый пароль</span>
                <input
                  className="input"
                  type="password"
                  value={form.new_password}
                  onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))}
                  autoComplete="new-password"
                  placeholder="Мин. 8 символов, буквы и цифры"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Подтверждение</span>
                <input
                  className="input"
                  type="password"
                  value={form.confirm_password}
                  onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))}
                  autoComplete="new-password"
                />
                {passwordMismatch && (
                  <div className="mt-1 text-[11px] text-rose-500">Пароли не совпадают</div>
                )}
              </label>
            </div>
          )}
        </div>

        {requiresCurrent && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Текущий пароль <span className="text-rose-500">*</span>
            </span>
            <input
              className="input"
              type="password"
              value={form.current_password}
              onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))}
              autoComplete="current-password"
              placeholder="Требуется для смены email или пароля"
            />
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
