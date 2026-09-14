import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { LogoMark, Wordmark } from "@/components/Logo";
import { PasswordStrength } from "@/components/PasswordStrength";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafaf9] p-4 dark:bg-[#0F0F14]">
        <div className="card w-full max-w-md p-8 text-center">
          <div className="mb-6 flex flex-col items-center gap-3">
            <LogoMark size={56} className="rounded-[14px]" />
            <Wordmark />
          </div>
          <div className="mb-4 text-lg font-medium text-rose-700 dark:text-rose-300">
            Ссылка недействительна
          </div>
          <p className="mb-4 text-sm text-neutral-500">
            В ссылке отсутствует токен. Запросите новую по кнопке ниже.
          </p>
          <Link to="/forgot-password" className="btn-primary inline-block">
            Запросить новую ссылку
          </Link>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Пароль должен быть не короче 8 символов");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/reset-password", { token, new_password: password });
      setDone(true);
      // Даем секунду прочитать сообщение и уходим на логин
      setTimeout(() => nav("/login", { replace: true }), 1500);
    } catch (err) {
      setError(extractApiError(err).message || "Не удалось сменить пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf9] p-4 dark:bg-[#0F0F14]">
      <form
        onSubmit={submit}
        className={clsx("card relative w-full max-w-sm p-8 animate-rise", error && "animate-shake")}
      >
        <Link
          to="/"
          aria-label="На главную"
          className="mb-6 flex flex-col items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-md"
        >
          <LogoMark size={56} className="rounded-[14px]" />
          <Wordmark />
          <div className="text-sm text-neutral-500">Новый пароль</div>
        </Link>

        {done ? (
          <div className="space-y-4 text-center">
            <div className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              Пароль изменён. Сейчас перенаправим на страницу входа…
            </div>
          </div>
        ) : (
          <>
            <p className="mb-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Придумайте новый пароль — минимум 8 символов, латинские буквы и цифры.
            </p>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                Новый пароль
              </span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <PasswordStrength password={password} />
            </label>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                Повторите пароль
              </span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>

            {error && (
              <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-60"
            >
              {loading ? "Сохраняем…" : "Установить новый пароль"}
            </button>

            <div className="mt-4 text-center text-sm text-neutral-500">
              <Link to="/login" className="link">
                Вернуться ко входу
              </Link>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
