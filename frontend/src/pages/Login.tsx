import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { resolveMediaUrl } from "@/components/ui";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/store/auth";
import { loginSchema, type LoginForm } from "@/lib/validation";
import { FormError } from "@/components/ui";
import { FormField } from "@/components/lib/FormField";
import { Button } from "@/components/lib/Button";
import { AuthLayout } from "@/components/AuthLayout";

export default function Login() {
  const { login, me, error } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  // Куда вернуть после входа (например, обратно на приглашение). Только свои пути, без «//чужой-сайт».
  const rawNext = sp.get("next") || "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onBlur",
  });

  // На адресе компании (soli.qcrm.kz) — её название и логотип.
  const host = useQuery({
    queryKey: ["host-tenant"],
    queryFn: async () =>
      (await api.get<{ on_subdomain: boolean; found?: boolean; name?: string; logo_url?: string | null }>("/api/auth/host-tenant")).data,
    staleTime: Infinity,
    retry: false,
  });
  const brand = host.data?.on_subdomain ? host.data : null;

  if (me) return <Navigate to={next} replace />;

  const submit = async (data: LoginForm) => {
    try {
      await login(data.email, data.password);
      nav(next, { replace: true });
    } catch {
      // текст ошибки приходит через useAuth().error
    }
  };

  return (
    <AuthLayout
      title={brand?.found ? `Вход в ${brand.name}` : brand ? "Компания не найдена" : "Вход в рабочее пространство"}
      subtitle={
        brand && !brand.found
          ? "Такого адреса компании нет. Проверьте ссылку или войдите на основном адресе сайта."
          : "Войдите с рабочим email вашей компании"
      }
      footer={
        brand ? undefined : (
          <>
            Нет аккаунта?{" "}
            <Link to="/register" className="link font-medium">
              Зарегистрировать компанию
            </Link>
          </>
        )
      }
    >
      {brand?.found && brand.logo_url && (
        <img src={resolveMediaUrl(brand.logo_url) ?? undefined} alt="" className="mb-5 h-12 w-auto max-w-[200px] object-contain" />
      )}
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        <FormField label="Email" htmlFor="login-email" error={errors.email?.message}>
          <input
            id="login-email"
            className="input input-lg"
            type="email"
            autoComplete="email"
            autoFocus
            aria-invalid={!!errors.email}
            {...register("email")}
          />
        </FormField>

        <FormField
          label={
            <span className="flex items-center justify-between">
              Пароль
              <Link to="/forgot-password" className="link text-[13px] font-normal">
                Забыли пароль?
              </Link>
            </span>
          }
          htmlFor="login-password"
          error={errors.password?.message}
        >
          <input
            id="login-password"
            className="input input-lg"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
        </FormField>

        <div aria-live="polite">{error && <FormError msg={error} />}</div>

        <Button type="submit" variant="contrast" size="xl" fullWidth isLoading={isSubmitting}>
          {isSubmitting ? "Входим…" : "Войти"}
        </Button>
      </form>
    </AuthLayout>
  );
}
