import { Link } from "react-router-dom";
import { useState } from "react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { LogoMark, Wordmark } from "@/components/Logo";
import { Turnstile, isCaptchaEnabled } from "@/components/Turnstile";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Введите email");
      return;
    }
    if (isCaptchaEnabled() && !captchaToken) {
      setError("Пожалуйста, пройдите проверку CAPTCHA");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/forgot-password", {
        email: email.trim().toLowerCase(),
        captcha_token: captchaToken || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(extractApiError(err).message || "Не удалось отправить письмо");
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
          <div className="text-sm text-neutral-500">Сброс пароля</div>
        </Link>

        {done ? (
          <div className="space-y-4 text-center">
            <div className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              Если этот email зарегистрирован — мы отправили на него ссылку для сброса пароля.
              Проверьте почту (и папку «Спам»).
            </div>
            <Link to="/login" className="btn-primary inline-block">Вернуться ко входу</Link>
          </div>
        ) : (
          <>
            <p className="mb-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Введите email, к которому привязан аккаунт. Мы пришлём ссылку для установки нового пароля.
            </p>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                Email
              </span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>

            <Turnstile onToken={setCaptchaToken} />

            {error && (
              <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (isCaptchaEnabled() && !captchaToken)}
              className="btn-primary w-full disabled:opacity-60"
            >
              {loading ? "Отправляем…" : "Отправить ссылку"}
            </button>

            <div className="mt-4 text-center text-sm text-neutral-500">
              Вспомнили пароль?{" "}
              <Link to="/login" className="link">
                Войти
              </Link>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
