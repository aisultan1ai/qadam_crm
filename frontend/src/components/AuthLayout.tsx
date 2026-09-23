import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Coins, MessageSquare, ShieldCheck } from "lucide-react";

import { LogoMark } from "./Logo";

const FEATURES = [
  { icon: Coins, label: "Продажи и задачи" },
  { icon: MessageSquare, label: "Открытые линии" },
  { icon: ShieldCheck, label: "Права доступа" },
];

/** Фирменные «ступени»: плитки логотипа лесенкой, светлые тона бренда. */
function Steps({ className }: { className?: string }) {
  const fills = ["rgb(var(--brand-50))", "rgb(var(--brand-100))", "rgb(var(--brand-200))"];
  return (
    <svg aria-hidden viewBox="0 0 612 234" className={className} fill="none">
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={i * 84} y={150 - i * 20} width={108} height={84} rx={16} fill={fills[i % 3]} />
      ))}
    </svg>
  );
}

/**
 * Разметка страниц входа, регистрации и восстановления пароля (вариант C из макетов):
 * одна карточка по центру на светлом фоне с сеткой, мягким свечением и «ступенями».
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
    <div className="relative flex min-h-screen flex-col items-center overflow-hidden bg-zinc-50 px-4 dark:bg-[#0D0F13]">
      {/* фон: сетка, свечение, ступени */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(13_15_19/0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgb(13_15_19/0.045)_1px,transparent_1px)] [background-size:48px_48px] dark:[background-image:linear-gradient(to_right,rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.035)_1px,transparent_1px)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-24 h-[700px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand-200)/0.75),transparent)] dark:bg-[radial-gradient(closest-side,rgb(var(--brand-600)/0.22),transparent)]"
      />
      <Steps className="pointer-events-none absolute -bottom-8 -left-10 hidden w-[560px] md:block dark:opacity-20" />

      <main className="relative flex w-full flex-1 flex-col items-center justify-center py-12 sm:py-16">
        <Link
          to="/"
          className="mb-7 inline-flex items-center gap-2.5 rounded-md text-[17px] font-semibold tracking-tight text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white"
          aria-label="Qadam CRM — на главную"
        >
          <LogoMark size={28} />
          Qadam CRM
        </Link>

        <div className="w-full max-w-[460px] rounded-2xl border border-zinc-200 bg-white p-7 shadow-[0_24px_60px_-24px_rgb(13_15_19/0.22),0_2px_6px_-2px_rgb(13_15_19/0.06)] sm:p-10 dark:border-zinc-800 dark:bg-[#14171C] dark:shadow-none [&_.input]:h-11 [&_.input]:text-[15px]">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-zinc-950 sm:text-[30px] sm:leading-9 dark:text-white">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-[15px] leading-[22px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">{footer}</div>}
        </div>

        <ul className="mt-7 flex flex-wrap justify-center gap-x-7 gap-y-2">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
              <Icon size={15} className="text-brand-600 dark:text-brand-400" />
              {label}
            </li>
          ))}
        </ul>
      </main>

      <footer className="relative flex flex-wrap justify-center gap-x-5 gap-y-1 pb-7 text-[13px] text-zinc-400">
        <span>© {new Date().getFullYear()} Qadam CRM</span>
        <Link to="/privacy" className="hover:text-zinc-700 dark:hover:text-white">
          Конфиденциальность
        </Link>
        <Link to="/terms" className="hover:text-zinc-700 dark:hover:text-white">
          Условия
        </Link>
      </footer>
    </div>
  );
}
