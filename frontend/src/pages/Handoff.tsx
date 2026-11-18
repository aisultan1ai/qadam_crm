/** Приём входа на адресе компании: одноразовый код → сессия этого адреса. */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api, extractApiError } from "@/api/client";
import { AuthLayout } from "@/components/AuthLayout";
import { Loader } from "@/components/ui";
import { useAuth } from "@/store/auth";

export default function Handoff() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const fetchMe = useAuth((s) => s.fetchMe);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = sp.get("code") || "";
    const rawNext = sp.get("next") || "/";
    const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
    // Код не должен оставаться в адресной строке и истории браузера.
    window.history.replaceState({}, "", "/auth/handoff");
    (async () => {
      try {
        await api.post("/api/auth/handoff/exchange", { code });
        await fetchMe();
        nav(next, { replace: true });
      } catch (e) {
        setError(extractApiError(e).message || "Не удалось войти — войдите заново");
      }
    })();
  }, [sp, nav, fetchMe]);

  if (!error) return <Loader />;
  return (
    <AuthLayout title="Не удалось открыть компанию" subtitle={error} footer={<Link to="/login" className="link font-medium">Войти</Link>}>
      <div />
    </AuthLayout>
  );
}
