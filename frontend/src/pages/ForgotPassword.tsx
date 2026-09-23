import { Link } from "react-router-dom";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api, extractApiError } from "@/api/client";
import { AuthLayout } from "@/components/AuthLayout";
import { Turnstile, isCaptchaEnabled } from "@/components/Turnstile";
import { emailSchema } from "@/lib/validation";
import { FormError } from "@/components/ui";
import { FormField } from "@/components/lib/FormField";
import { Button } from "@/components/lib/Button";

const schema = z.object({ email: emailSchema });
type ForgotForm = z.infer<typeof schema>;

export default function ForgotPassword() {
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    setCaptchaError(null);
    if (isCaptchaEnabled() && !captchaToken) {
      setCaptchaError("Пожалуйста, пройдите проверку CAPTCHA");
      return;
    }
    try {
      await api.post("/api/auth/forgot-password", {
        email: data.email.trim().toLowerCase(),
        captcha_token: captchaToken || undefined,
      });
      setDone(true);
    } catch (err) {
      setServerError(extractApiError(err).message || "Не удалось отправить письмо");
    }
  });

  const anyError = serverError || captchaError || Object.keys(errors).length > 0;

  return (
    <AuthLayout title="Сброс пароля">
      <form onSubmit={onSubmit} noValidate>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
              Если этот email зарегистрирован — мы отправили на него ссылку для сброса пароля.
              Проверьте почту (и папку «Спам»).
            </div>
            <Link to="/login" className="btn-primary inline-block">Вернуться ко входу</Link>
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
              Введите email, к которому привязан аккаунт. Мы пришлём ссылку для установки нового пароля.
            </p>

            <FormField label="Email" error={errors.email?.message} className="mb-4">
              <input
                className="input"
                type="email"
                autoComplete="email"
                autoFocus
                {...register("email")}
              />
            </FormField>

            <Turnstile onToken={setCaptchaToken} />

            {captchaError && <FormError msg={captchaError} />}
            {serverError && <FormError msg={serverError} />}

            <Button
              type="submit"
              variant="primary"
              fullWidth
              isLoading={isSubmitting}
              disabled={isCaptchaEnabled() && !captchaToken}
              className="mt-4 !h-11 !py-0 !text-[15px] disabled:opacity-60"
            >
              {isSubmitting ? "Отправляем…" : "Отправить ссылку"}
            </Button>

            <div className="mt-5 text-sm text-zinc-500">
              Вспомнили пароль?{" "}
              <Link to="/login" className="link">
                Войти
              </Link>
            </div>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
