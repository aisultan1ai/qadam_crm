import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { LogoMark, Wordmark } from "@/components/Logo";

type InviteInfo = {
  token: string;
  email: string;
  tenant: { id: number; name: string; slug: string; logo_url: string | null };
  expires_at: string;
  requires_signup: boolean;
};

export default function Invite() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { fetchMe } = useAuth();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<InviteInfo>(`/api/invitations/${token}`);
        if (!cancelled) setInfo(data);
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message || "Приглашение недействительно");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = info.requires_signup ? { full_name: fullName, password } : {};
      await api.post(`/api/invitations/${token}/accept`, body);
      await fetchMe();
      nav("/", { replace: true });
    } catch (e) {
      setError(extractApiError(e).message || "Не удалось принять приглашение");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-neutral-500">Загрузка…</div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-sm p-6 text-center">
          <div className="mb-2 text-lg font-semibold">Приглашение недействительно</div>
          <div className="text-sm text-neutral-500">{error ?? "Ссылка просрочена или уже использована."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf9] p-4 dark:bg-[#1a1a22]">
      <form onSubmit={accept} className="card w-full max-w-sm p-8">
        <div className="mb-4 flex flex-col items-center gap-2">
          <LogoMark size={48} className="rounded-[12px]" />
          <Wordmark />
        </div>

        <div className="mb-4 text-center">
          <div className="text-sm text-neutral-500">Вас пригласили в компанию</div>
          <div className="mt-1 text-lg font-semibold">{info.tenant.name}</div>
          <div className="mt-1 text-xs text-neutral-500">{info.email}</div>
        </div>

        {info.requires_signup && (
          <>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Ваше имя</span>
              <input
                className="input"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Пароль</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
          </>
        )}

        {error && (
          <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full disabled:opacity-60" disabled={submitting}>
          {submitting ? "Принимаем…" : "Принять приглашение"}
        </button>
      </form>
    </div>
  );
}
