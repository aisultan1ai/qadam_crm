import { Link } from "react-router-dom";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { LogoMark, Wordmark } from "@/components/Logo";
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
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf9] p-4 dark:bg-[#0F0F14]">
      <form
        onSubmit={onSubmit}
        className={clsx("card relative w-full max-w-sm p-8 animate-rise", anyError && "animate-shake")}
        noValidate
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

            <FormField label="Email" error={errors.email?.message} className="mb-3">
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
              className="mt-3 disabled:opacity-60"
            >
              {isSubmitting ? "Отправляем…" : "Отправить ссылку"}
            </Button>

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
