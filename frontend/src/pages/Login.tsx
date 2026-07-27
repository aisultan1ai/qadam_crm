import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import { useAuth } from "@/store/auth";
import { loginSchema, type LoginForm } from "@/lib/validation";
import { FieldError } from "@/components/ui";
import { Wordmark, LogoMark } from "@/components/Logo";
import { useReducedMotion } from "@/hooks/useReducedMotion";

type BtnState = "idle" | "loading" | "done";

export default function Login() {
  const { login, me, error } = useAuth();
  const nav = useNavigate();
  const reduced = useReducedMotion();

  const [btn, setBtn] = useState<BtnState>("idle");
  const [shakeKey, setShakeKey] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [bgOut, setBgOut] = useState(false);
  const errorRef = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onBlur",
  });

  useEffect(() => {
    if (error && error !== errorRef.current) {
      errorRef.current = error;
      setBtn("idle");
      setShakeKey((k) => k + 1);
    } else if (!error) {
      errorRef.current = null;
    }
  }, [error]);

  if (me && !exiting) return <Navigate to="/" replace />;

  const submit = async (data: LoginForm) => {
    setBtn("loading");
    try {
      await login(data.email, data.password);
      setBtn("done");
      const t1 = window.setTimeout(() => {
        setExiting(true);
        window.setTimeout(() => setBgOut(true), 120);
      }, 620);
      const t2 = window.setTimeout(() => nav("/"), 620 + 520);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    } catch {
      // shake + reset обрабатываются через useEffect по error
    }
  };

  const hasFieldError = !!errors.email || !!errors.password;

  return (
    <div
      className={clsx(
        "relative flex min-h-screen items-center justify-center overflow-hidden p-4",
        "bg-[#fafaf9] dark:bg-[#1a1a22] transition-opacity duration-500 ease-out-soft",
        bgOut && "opacity-0",
      )}
    >
      {/* Ambient blobs */}
      {!reduced && (
        <>
          <span
            aria-hidden
            className="login-blob animate-drift-a"
            style={{
              left: "8%",
              top: "12%",
              width: 420,
              height: 420,
              background:
                "radial-gradient(circle, rgba(99,102,241,.30), transparent 68%)",
            }}
          />
          <span
            aria-hidden
            className="login-blob animate-drift-b"
            style={{
              right: "6%",
              bottom: "8%",
              width: 480,
              height: 480,
              background:
                "radial-gradient(circle, rgba(165,180,252,.34), transparent 70%)",
              filter: "blur(32px)",
            }}
          />
        </>
      )}

      <form
        key={shakeKey}
        onSubmit={handleSubmit(submit)}
        className={clsx(
          "card relative w-full max-w-sm p-8",
          !exiting && "animate-rise",
          exiting && "animate-card-out",
          error && "animate-shake",
        )}
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <LogoMark size={56} animated className="rounded-[14px]" />
          <div style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both", animationDelay: "240ms" }}>
            <Wordmark />
          </div>
        </div>

        <label
          className="mb-3 block"
          style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both", animationDelay: "420ms" }}
        >
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
          <input
            className="input transition-shadow duration-[180ms] ease-out-soft focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)]"
            type="email"
            autoComplete="email"
            {...register("email")}
          />
          <FieldError msg={errors.email?.message} />
        </label>

        <label
          className="mb-4 block"
          style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both", animationDelay: "510ms" }}
        >
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Пароль</span>
          <input
            className={clsx(
              "input transition-shadow duration-[180ms] ease-out-soft focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)]",
              error && "border-rose-300 focus:border-rose-400",
            )}
            type="password"
            autoComplete="current-password"
            {...register("password")}
          />
          <FieldError msg={errors.password?.message} />
        </label>

        {/* Анимируемый блок ошибки */}
        <div
          className="mb-3 overflow-hidden transition-[max-height,opacity] duration-[280ms] ease-out-soft"
          style={{
            maxHeight: error ? 60 : 0,
            opacity: error ? 1 : 0,
          }}
          aria-live="polite"
        >
          {error && (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Кнопка-морфер */}
        <div className="flex w-full justify-center">
          <button
            type="submit"
            disabled={btn !== "idle" || isSubmitting || hasFieldError}
            aria-label="Войти"
            className={clsx(
              "relative flex h-[38px] items-center justify-center overflow-hidden font-medium text-white shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_1px_2px_0_rgba(0,0,0,0.08)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-95 disabled:cursor-default",
              "transition-[width,border-radius,background-color] duration-[420ms] ease-out-soft",
            )}
            style={{
              width: btn === "idle" ? 320 : 38,
              borderRadius: btn === "idle" ? 8 : 9999,
              backgroundColor: btn === "done" ? "#10b981" : "#4f46e5",
              maxWidth: "100%",
            }}
          >
            {btn === "idle" && <span className="px-4 text-sm">Войти</span>}

            {btn === "loading" && (
              <span
                className="h-[18px] w-[18px] rounded-full border-2 border-white/35 border-t-white"
                style={{ animation: "spin .7s linear infinite" }}
                aria-label="Загрузка"
              />
            )}

            {btn === "done" && (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-pop"
                aria-label="Готово"
              >
                <path d="M5 12l5 5L20 7" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
