/** Центр помощи: короткие инструкции по каждому разделу. */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, LifeBuoy } from "lucide-react";
import clsx from "clsx";

import { HELP_TOPICS } from "@/lib/help";
import { SearchInput } from "@/components/page";

export default function Help() {
  const { hash } = useLocation();
  const [q, setQ] = useState("");
  const active = hash.replace("#", "");

  useEffect(() => {
    if (active) document.getElementById(`help-${active}`)?.scrollIntoView({ block: "start" });
  }, [active]);

  const topics = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return HELP_TOPICS;
    return HELP_TOPICS.filter((x) => [x.title, x.why, ...x.steps].some((s) => s.toLowerCase().includes(t)));
  }, [q]);
  const groups = [...new Set(topics.map((t) => t.group))];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="page-header">
        <div>
          <div className="mb-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">Помощь</div>
          <h1 className="page-title flex items-center gap-2"><LifeBuoy size={20} className="text-brand-500" /> Центр помощи</h1>
        </div>
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Например: импорт, отделы, договоры" />
      {!topics.length && <p className="text-sm text-zinc-500">Ничего не нашли — попробуйте другое слово.</p>}
      {groups.map((g) => (
        <section key={g} className="space-y-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">{g}</h2>
          {topics.filter((t) => t.group === g).map((t) => (
            <article
              key={t.key}
              id={`help-${t.key}`}
              className={clsx("card scroll-mt-20 p-4", active === t.key && "ring-2 ring-brand-400")}
            >
              <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{t.title}</h3>
              <p className="mt-0.5 text-[13.5px] text-zinc-600 dark:text-zinc-300">{t.why}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-zinc-600 dark:text-zinc-400">
                {t.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              {t.link && (
                <Link to={t.link.to} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300">
                  {t.link.label} <ArrowRight size={13} />
                </Link>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
