import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LayoutDashboard } from "lucide-react";

import { useAuth } from "@/store/auth";
import { loginSchema, type LoginForm } from "@/lib/validation";
import { FieldError, FormError } from "@/components/ui";

export default function Login() {
  const { login, me, loading, error } = useAuth();
  const nav = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onBlur",
  });

  if (me) return <Navigate to="/" replace />;

  const submit = async (data: LoginForm) => {
    try {
      await login(data.email, data.password);
      nav("/");
    } catch {}
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-neutral-50 to-brand-50/60 p-4 dark:from-neutral-950 dark:to-brand-950/20">
      <form onSubmit={handleSubmit(submit)} className="card w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">
            <LayoutDashboard size={18} />
          </div>
          <div>
            <div className="text-lg font-semibold">Qadam CRM</div>
            <div className="text-xs text-neutral-500">Вход в систему</div>
          </div>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
          <input className="input" type="email" autoComplete="email" {...register("email")} />
          <FieldError msg={errors.email?.message} />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Пароль</span>
          <input className="input" type="password" autoComplete="current-password" {...register("password")} />
          <FieldError msg={errors.password?.message} />
        </label>

        {error && <div className="mb-3"><FormError msg={error} /></div>}

        <button type="submit" className="btn-primary w-full" disabled={loading || isSubmitting}>
          {loading || isSubmitting ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
