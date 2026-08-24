import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { LogoMark, Wordmark } from "@/components/Logo";

type State = "loading" | "success" | "already" | "error";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { fetchMe } = useAuth();
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) {
          setState("error");
          setMessage("Ссылка без токена. Откройте письмо и нажмите на кнопку подтверждения.");
        }
        return;
      }
      try {
        const res = await api.post<{ message: string }>("/api/auth/verify-email", { token });
        if (cancelled) return;
        const text = res.data?.message || "Email подтверждён";
        setMessage(text);
        setState(text.toLowerCase().includes("уже") ? "already" : "success");
        fetchMe();
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setMessage(extractApiError(e).message || "Не удалось подтвердить email");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fetchMe]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf9] p-4 dark:bg-[#0F0F14]">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <LogoMark size={56} className="rounded-[14px]" />
          <Wordmark />
        </div>

        {state === "loading" && (
          <div className="text-neutral-600 dark:text-neutral-300">Подтверждаем email…</div>
        )}

        {(state === "success" || state === "already") && (
          <div className="space-y-4">
            <div className="text-lg font-medium text-emerald-700 dark:text-emerald-300">
              {state === "already" ? "Email уже подтверждён" : "Готово!"}
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
            <Link to="/" className="btn-primary inline-block">Продолжить</Link>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-4">
            <div className="text-lg font-medium text-rose-700 dark:text-rose-300">
              Не удалось подтвердить
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
            <div className="flex flex-col gap-2">
              <Link to="/" className="btn-primary">На главную</Link>
              <Link to="/login" className="link text-sm">Войти и запросить новое письмо</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
