import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api, extractApiError } from "@/api/client";
import { LogoMark, Wordmark } from "@/components/Logo";
import { AuthLayout } from "@/components/AuthLayout";
import { PasswordStrength } from "@/components/PasswordStrength";
import { passwordSchema } from "@/lib/validation";
import { FormError } from "@/components/ui";
import { FormField } from "@/components/lib/FormField";
import { Button } from "@/components/lib/Button";

const schema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Пароли не совпадают",
    path: ["confirm"],
  });
type ResetForm = z.infer<typeof schema>;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") || "";
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });
  const password = watch("password");

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F7F9] p-4 dark:bg-[#0D0F13]">
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

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await api.post("/api/auth/reset-password", { token, new_password: data.password });
      setDone(true);
      setTimeout(() => nav("/login", { replace: true }), 1500);
    } catch (err) {
      setServerError(extractApiError(err).message || "Не удалось сменить пароль");
    }
  });

  const anyError = serverError || Object.keys(errors).length > 0;

  return (
    <AuthLayout title="Новый пароль">
      <form onSubmit={onSubmit} noValidate>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
              Пароль изменён. Сейчас перенаправим на страницу входа…
            </div>
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
              Придумайте новый пароль — минимум 8 символов, латинские буквы и цифры.
            </p>

            <FormField label="Новый пароль" error={errors.password?.message} className="mb-4">
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                autoFocus
                {...register("password")}
              />
              <PasswordStrength password={password || ""} />
            </FormField>

            <FormField label="Повторите пароль" error={errors.confirm?.message} className="mb-4">
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                {...register("confirm")}
              />
            </FormField>

            {serverError && <FormError msg={serverError} />}

            <Button
              type="submit"
              variant="primary"
              fullWidth
              isLoading={isSubmitting}
              className="mt-4 !h-11 !py-0 !text-[15px] disabled:opacity-60"
            >
              {isSubmitting ? "Сохраняем…" : "Установить новый пароль"}
            </Button>

            <div className="mt-5 text-sm text-zinc-500">
              <Link to="/login" className="link">
                Вернуться ко входу
              </Link>
            </div>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
