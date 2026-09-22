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
import { FormError } from "@/components/ui";
import { FormField } from "@/components/lib/FormField";
import { Button } from "@/components/lib/Button";
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
        <Link
          to="/"
          aria-label="На главную"
          className="mb-6 flex flex-col items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-md"
        >
          <LogoMark size={56} className="rounded-[14px]" />
          <Wordmark />
          <div className="text-sm text-neutral-500">Регистрация компании</div>
        </Link>

        <FormField label="Название компании" error={errors.company_name?.message} className="mb-3">
          <input className="input" type="text" autoComplete="organization" {...register("company_name")} />
        </FormField>

        <FormField label="Ваше имя" error={errors.full_name?.message} className="mb-3">
          <input className="input" type="text" autoComplete="name" {...register("full_name")} />
        </FormField>

        <FormField label="Email" error={errors.email?.message} className="mb-3">
          <input className="input" type="email" autoComplete="email" {...register("email")} />
        </FormField>

        <FormField label="Пароль" error={errors.password?.message} className="mb-4">
          <input className="input" type="password" autoComplete="new-password" {...register("password")} />
          <PasswordStrength password={passwordValue} />
        </FormField>

        <Turnstile onToken={setCaptchaToken} />

        {error && <FormError msg={error} />}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          isLoading={disabled}
          disabled={isCaptchaEnabled() && !captchaToken}
          className="mt-3 disabled:opacity-60"
        >
          {loading ? "Создаём компанию…" : "Создать компанию"}
        </Button>

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
