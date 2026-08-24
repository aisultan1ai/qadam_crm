import { ReactNode, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { LogoMark, Wordmark } from "./Logo";

export default function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} — Qadam CRM`;
    return () => {
      document.title = prev;
    };
  }, [title]);

  return (
    <div className="min-h-screen bg-[#fafaf9] text-neutral-800 dark:bg-[#0F0F14] dark:text-neutral-200">
      <header className="border-b border-neutral-200 bg-white/70 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark size={28} className="rounded-md" />
            <Wordmark />
          </Link>
          <Link to="/" className="link inline-flex items-center gap-1 text-sm">
            <ArrowLeft size={14} /> На главную
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-2 text-sm text-neutral-500">Обновлено: {lastUpdated}</div>
        <article
          className="prose prose-neutral dark:prose-invert mt-8 max-w-none
            prose-h2:mt-8 prose-h2:text-lg prose-h2:font-semibold
            prose-p:leading-relaxed
            prose-ul:my-3
            prose-a:text-brand-600 dark:prose-a:text-brand-400"
        >
          {children}
        </article>

        <footer className="mt-16 border-t border-neutral-200 pt-6 text-sm text-neutral-500 dark:border-neutral-800">
          © {new Date().getFullYear()} Qadam CRM ·{" "}
          <Link to="/privacy" className="link">Политика конфиденциальности</Link> ·{" "}
          <Link to="/terms" className="link">Условия</Link>
        </footer>
      </main>
    </div>
  );
}
