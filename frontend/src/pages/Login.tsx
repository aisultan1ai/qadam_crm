import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { LayoutDashboard } from "lucide-react";

export default function Login() {
  const { login, me, loading, error } = useAuth();
  const [email, setEmail] = useState("admin@qadam.local");
  const [password, setPassword] = useState("admin123");
  const nav = useNavigate();

  if (me) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      nav("/");
    } catch {}
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-neutral-50 to-brand-50/60 p-4 dark:from-neutral-950 dark:to-brand-950/20">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
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
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Пароль</span>
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </label>

        {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Входим…" : "Войти"}
        </button>

        <div className="mt-5 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 dark:bg-neutral-800/50">
          Демо: <b>admin@qadam.local / admin123</b><br />
          <b>manager@qadam.local / manager123</b><br />
          <b>employee@qadam.local / employee123</b>
        </div>
      </form>
    </div>
  );
}
