import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { LogoMark, Wordmark } from "@/components/Logo";

type State = "loading" | "success" | "error";

export default function ConfirmEmailChange() {
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
          setMessage("Ссылка без токена. Откройте письмо целиком и нажмите на кнопку подтверждения.");
        }
        return;
      }
      try {
        const res = await api.post<{ message: string }>("/api/auth/confirm-email-change", { token });
        if (cancelled) return;
        setMessage(res.data?.message || "Email изменён");
        setState("success");
        fetchMe();
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setMessage(extractApiError(e).message || "Не удалось подтвердить смену email");
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
          <div className="text-sm text-neutral-500">Смена email</div>
        </div>

        {state === "loading" && (
          <div className="text-neutral-600 dark:text-neutral-300">Подтверждаем смену…</div>
        )}

        {state === "success" && (
          <div className="space-y-4">
            <div className="text-lg font-medium text-emerald-700 dark:text-emerald-300">Готово!</div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
            <div className="flex flex-col gap-2">
              <Link to="/profile" className="btn-primary">К профилю</Link>
              <Link to="/" className="link text-sm">На главную</Link>
            </div>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-4">
            <div className="text-lg font-medium text-rose-700 dark:text-rose-300">
              Не удалось подтвердить
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
            <div className="flex flex-col gap-2">
              <Link to="/profile" className="btn-primary">Открыть профиль</Link>
              <Link to="/login" className="link text-sm">Войти и запросить смену заново</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
