import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";

import { PasswordStrength } from "@/components/PasswordStrength";
import { trackEvent } from "@/lib/analytics";

import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { registerSchema, type RegisterForm } from "@/lib/validation";
import { FormError } from "@/components/ui";
import { FormField } from "@/components/lib/FormField";
import { Button } from "@/components/lib/Button";
import { AuthLayout } from "@/components/AuthLayout";
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
    defaultValues: { company_name: "", full_name: "", email: new URLSearchParams(window.location.search).get("email") ?? "", password: "" },
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
    <AuthLayout
      title="Регистрация компании"
      subtitle="Создайте рабочее пространство — сотрудников пригласите после входа"
      footer={
        <>
          Уже есть аккаунт?{" "}
          <Link to="/login" className="link font-medium">
            Войти
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        <FormField label="Название компании" htmlFor="reg-company" error={errors.company_name?.message}>
          <input id="reg-company" className="input" type="text" autoComplete="organization" autoFocus {...register("company_name")} />
        </FormField>

        <FormField label="Ваше имя" htmlFor="reg-name" error={errors.full_name?.message}>
          <input id="reg-name" className="input" type="text" autoComplete="name" {...register("full_name")} />
        </FormField>

        <FormField label="Рабочий email" htmlFor="reg-email" error={errors.email?.message}>
          <input id="reg-email" className="input" type="email" autoComplete="email" {...register("email")} />
        </FormField>

        <FormField label="Пароль" htmlFor="reg-password" error={errors.password?.message}>
          <input id="reg-password" className="input" type="password" autoComplete="new-password" {...register("password")} />
          <PasswordStrength password={passwordValue} />
        </FormField>

        <Turnstile onToken={setCaptchaToken} />

        <div aria-live="polite">{error && <FormError msg={error} />}</div>

        <Button
          type="submit"
          variant="primary"
          fullWidth
          isLoading={disabled}
          disabled={isCaptchaEnabled() && !captchaToken}
          className="!h-11 !py-0 !text-[15px]"
        >
          {loading ? "Создаём компанию…" : "Создать компанию"}
        </Button>

        <p className="text-xs text-zinc-500">
          Нажимая «Создать компанию», вы принимаете{" "}
          <Link to="/terms" className="link">
            условия использования
          </Link>{" "}
          и{" "}
          <Link to="/privacy" className="link">
            политику конфиденциальности
          </Link>
          .
        </p>
      </form>
    </AuthLayout>
  );
}
