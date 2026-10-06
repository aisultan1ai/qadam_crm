import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Coins, MessageSquare, ShieldCheck } from "lucide-react";

import { LogoMark } from "./Logo";

// Тот же фон, что и в герое лендинга (frontend/public/landing/).
const HERO_VIDEO = "/landing/hero.mp4";
const HERO_POSTER = "/landing/hero-poster.jpg";

const FEATURES = [
  { icon: Coins, label: "Продажи и задачи" },
  { icon: MessageSquare, label: "Открытые линии" },
  { icon: ShieldCheck, label: "Права доступа" },
];

/** Левая половина: видео и заголовок героя лендинга, чтобы вход выглядел продолжением сайта. */
function BrandPanel() {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) v.pause();
    else v.play().catch(() => undefined);
  }, []);

  return (
    <aside className="relative hidden overflow-hidden bg-[#0B0D11] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
      <div aria-hidden className="absolute inset-0">
        <div className="absolute inset-0 [background-image:linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="qd-drift-1 absolute -left-[20%] top-[10%] h-[60vmax] w-[60vmax] rounded-full bg-[radial-gradient(closest-side,rgb(42_82_196/0.5),transparent)] blur-2xl" />
        <video
          ref={ref}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
          src={HERO_VIDEO}
          poster={HERO_POSTER}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          onCanPlay={() => setReady(true)}
        />
        <div className="absolute inset-0 bg-[#0B0D11]/55" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(11_13_17/0.55),transparent_35%,transparent_55%,rgb(11_13_17/0.9))]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_20%_80%,rgb(42_82_196/0.25),transparent)]" />
      </div>

      <div className="relative flex flex-1 flex-col p-10 xl:p-14">
        <Link
          to="/"
          aria-label="Qadam CRM — на главную"
          className="inline-flex w-fit items-center gap-2.5 rounded-md text-[17px] font-semibold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <LogoMark size={28} inverted />
          Qadam
        </Link>

        <div className="mt-auto max-w-[520px]">
          <p className="font-display text-[40px] font-bold leading-[1.06] tracking-[-0.04em] xl:text-[48px]">
            Клиенты, задачи и команда — <span className="text-brand-300">в одной системе</span>
          </p>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-white/70">
            Без таблиц и разрозненных чатов. Всё, что происходит в компании, — на одном экране.
          </p>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-[14px] text-white/80">
                <span className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.06]">
                  <Icon size={14} className="text-brand-300" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-12 text-[13px] text-white/40">© {new Date().getFullYear()} Qadam CRM</div>
      </div>
    </aside>
  );
}

/**
 * Разметка страниц входа, регистрации и восстановления пароля в стиле лендинга:
 * слева — видео и заголовок героя, справа — форма на белом (на телефоне — только форма).
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] dark:bg-[#14161A]">
      <BrandPanel />

      <div className="flex min-h-screen flex-col px-5 sm:px-10">
        <header className="flex h-16 items-center justify-between">
          <Link
            to="/"
            aria-label="Qadam CRM — на главную"
            className="inline-flex items-center gap-2.5 rounded-md text-[17px] font-semibold tracking-tight text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden dark:text-white"
          >
            <LogoMark size={26} />
            Qadam
          </Link>
          <Link
            to="/"
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-[#23262D] dark:hover:text-white"
          >
            <ArrowLeft size={14} /> На главную
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center py-10">
          <div
            className={[
              "w-full max-w-[420px]",
              // Поля и главная кнопка — как на лендинге: крупные, скруглённые, кнопка-«пилюля».
              "[&_.input]:h-12 [&_.input]:rounded-xl [&_.input]:px-4 [&_.input]:text-[15px]",
              "[&_button[type=submit]]:!h-12 [&_button[type=submit]]:!rounded-full [&_button[type=submit]]:!border-0 [&_button[type=submit]]:!bg-zinc-950 [&_button[type=submit]]:!text-[15px] [&_button[type=submit]]:!font-medium [&_button[type=submit]]:!text-white [&_button[type=submit]]:!shadow-none",
              "[&_button[type=submit]:hover]:!bg-zinc-800",
              "dark:[&_button[type=submit]]:!bg-white dark:[&_button[type=submit]]:!text-zinc-950 dark:[&_button[type=submit]:hover]:!bg-zinc-200",
            ].join(" ")}
          >
            <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.035em] text-zinc-950 sm:text-[38px] dark:text-white">
              {title}
            </h1>
            {subtitle && <p className="mt-3 text-[15px] leading-[22px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && (
              <div className="mt-8 border-t border-zinc-100 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{footer}</div>
            )}
          </div>
        </main>

        <footer className="flex flex-wrap justify-center gap-x-5 gap-y-1 pb-6 text-[13px] text-zinc-400 lg:justify-end">
          <span className="lg:hidden">© {new Date().getFullYear()} Qadam CRM</span>
          <Link to="/privacy" className="hover:text-zinc-700 dark:hover:text-white">
            Конфиденциальность
          </Link>
          <Link to="/terms" className="hover:text-zinc-700 dark:hover:text-white">
            Условия
          </Link>
        </footer>
      </div>
    </div>
  );
}
