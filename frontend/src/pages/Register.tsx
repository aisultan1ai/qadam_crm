import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import clsx from "clsx";

import { PasswordStrength } from "@/components/PasswordStrength";
import { trackEvent } from "@/lib/analytics";

import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { registerSchema, type RegisterForm } from "@/lib/validation";
import { FieldError } from "@/components/ui";
import { Wordmark, LogoMark } from "@/components/Logo";
import { Turnstile, isCaptchaEnabled } from "@/components/Turnstile";

export default function Register() {
  const { me, fetchMe } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>("");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { company_name: "", full_name: "", email: "", password: "" },
    mode: "onBlur",
  });
  const passwordValue = watch("password") || "";

  if (me) return <Navigate to="/" replace />;

  const submit = async (data: RegisterForm) => {
    setError(null);
    if (isCaptchaEnabled() && !captchaToken) {
      setError("Пожалуйста, пройдите проверку CAPTCHA");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/register", { ...data, captcha_token: captchaToken || undefined });
      trackEvent("register_success", { plan: "free" });
      await fetchMe();
      nav("/", { replace: true });
    } catch (e) {
      setError(extractApiError(e).message || "Ошибка регистрации");
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || isSubmitting;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fafaf9] p-4 dark:bg-[#0F0F14]">
      <form
        onSubmit={handleSubmit(submit)}
        className={clsx("card relative w-full max-w-sm p-8", error && "animate-shake")}
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <LogoMark size={56} className="rounded-[14px]" />
          <Wordmark />
          <div className="text-sm text-neutral-500">Регистрация компании</div>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Название компании
          </span>
          <input className="input" type="text" autoComplete="organization" {...register("company_name")} />
          <FieldError msg={errors.company_name?.message} />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Ваше имя
          </span>
          <input className="input" type="text" autoComplete="name" {...register("full_name")} />
          <FieldError msg={errors.full_name?.message} />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
          <input className="input" type="email" autoComplete="email" {...register("email")} />
          <FieldError msg={errors.email?.message} />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Пароль</span>
          <input className="input" type="password" autoComplete="new-password" {...register("password")} />
          <PasswordStrength password={passwordValue} />
          <FieldError msg={errors.password?.message} />
        </label>

        <Turnstile onToken={setCaptchaToken} />

        {error && (
          <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={disabled || (isCaptchaEnabled() && !captchaToken)}
          className="btn-primary w-full disabled:opacity-60"
        >
          {loading ? "Создаём компанию…" : "Создать компанию"}
        </button>

        <div className="mt-4 text-center text-sm text-neutral-500">
          Уже есть аккаунт?{" "}
          <Link to="/login" className="link">
            Войти
          </Link>
        </div>
      </form>
    </div>
  );
}
