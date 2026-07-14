import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/store/auth";
import { Avatar } from "@/components/ui";
import { api } from "@/api/client";
import { Mail, Shield, Layers, Clock, CheckCircle2, Camera, Trash2 } from "lucide-react";

export default function Profile() {
  const { me, fetchMe } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

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
        <div className="flex items-center gap-4">
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
