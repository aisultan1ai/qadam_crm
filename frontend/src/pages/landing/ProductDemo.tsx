/**
 * Интерактивное демо платформы на лендинге (в духе ClickUp): слева разделы, справа — «живой» экран.
 * Вёрстка повторяет настоящий интерфейс Qadam (светлый сайдбар, шапка, списки, канбан),
 * содержимое — иллюстративные примеры без цифр и обещаний.
 */
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  BookOpen, CalendarDays, CheckSquare, Coins, Inbox, LayoutDashboard, MessageSquare, Search, Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { LogoMark } from "@/components/Logo";

type TabKey = "tasks" | "deals" | "inbox" | "calendar" | "time" | "wiki";

const TABS: { key: TabKey; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "tasks", label: "Задачи", hint: "Список, канбан, Ганта", icon: CheckSquare },
  { key: "deals", label: "Сделки", hint: "Воронка продаж по этапам", icon: Coins },
  { key: "inbox", label: "Открытые линии", hint: "Все мессенджеры в одном окне", icon: Inbox },
  { key: "calendar", label: "Календарь", hint: "Встречи и онлайн-запись", icon: CalendarDays },
  { key: "time", label: "Учёт времени", hint: "Таймер на любой задаче", icon: Timer },
  { key: "wiki", label: "База знаний", hint: "Регламенты и инструкции", icon: BookOpen },
];

const AV = ["bg-indigo-700", "bg-emerald-700", "bg-rose-700", "bg-amber-700", "bg-sky-700", "bg-fuchsia-700", "bg-teal-700"];
function Av({ name, i, size = 22 }: { name: string; i: number; size?: number }) {
  const ini = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <span
      className={clsx("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white", AV[i % AV.length])}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {ini}
    </span>
  );
}

function Chip({ tone, children }: { tone: "indigo" | "sky" | "amber" | "emerald" | "rose" | "zinc"; children: React.ReactNode }) {
  const map = {
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    sky: "bg-sky-50 text-sky-700 ring-sky-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    zinc: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  } as const;
  return <span className={clsx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", map[tone])}>{children}</span>;
}

// ---------------------------------------------------------------------------- screens

function TasksScreen() {
  const groups = [
    { title: "В работе", dot: "bg-sky-500", rows: [
      ["Подготовить договор поставки", "Айгерим Садыкова", 0, "high"],
      ["Согласовать смету с клиентом", "Данияр Ермеков", 1, "medium"],
      ["Настроить открытые линии", "Алия Нурланова", 2, "medium"],
    ] },
    { title: "На проверке", dot: "bg-amber-500", rows: [
      ["Презентация для партнёров", "Тимур Касымов", 3, "low"],
      ["Обновить регламент продаж", "Мадина Ахметова", 4, "high"],
    ] },
    { title: "Новая", dot: "bg-indigo-500", rows: [["Созвон с командой склада", "Ержан Сулейменов", 5, "medium"]] },
  ] as const;
  const pr = { high: ["Высокий", "amber"], medium: ["Средний", "sky"], low: ["Низкий", "zinc"] } as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 border-b border-zinc-200 text-[12px]">
        {["Список", "Канбан", "Ганта", "Календарь"].map((v, i) => (
          <span key={v} className={clsx("-mb-px border-b-2 pb-2", i === 0 ? "border-brand-600 font-medium text-zinc-900" : "border-transparent text-zinc-500")}>{v}</span>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g.title}>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-zinc-700">
            <span className={clsx("h-2 w-2 rounded-full", g.dot)} />
            {g.title}
            <span className="rounded bg-zinc-100 px-1 text-[11px] font-medium text-zinc-500">{g.rows.length}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            {g.rows.map(([t, n, i, p]) => (
              <div key={t} className="flex items-center gap-3 border-b border-zinc-100 bg-white px-3 py-2 text-[12.5px] last:border-b-0">
                <span className="h-3.5 w-3.5 shrink-0 rounded border border-zinc-300" />
                <span className="min-w-0 flex-1 truncate text-zinc-800">{t}</span>
                <Av name={n} i={i} size={20} />
                <span className="hidden w-20 sm:inline-flex"><Chip tone={pr[p][1]}>{pr[p][0]}</Chip></span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DealsScreen() {
  const cols = [
    { t: "Новый", c: "border-t-indigo-500", cards: [["Поставка оборудования", "ТОО «Алтын Дала»", 0], ["Годовая подписка", "ИП Касымов", 3]] },
    { t: "Предложение", c: "border-t-sky-500", cards: [["Внедрение CRM", "АО «КазТрансЛог»", 1]] },
    { t: "Переговоры", c: "border-t-amber-500", cards: [["Расширение лицензий", "ТОО «Береке Агро»", 2], ["Интеграция телефонии", "ТОО «Шанырак»", 4]] },
    { t: "Успех", c: "border-t-emerald-500", cards: [["Обучение отдела продаж", "ТОО «Orda Coffee»", 5]] },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {cols.map((col) => (
        <div key={col.t} className={clsx("flex min-h-[260px] flex-col gap-2 rounded-lg border border-t-2 border-zinc-200 bg-zinc-50 p-2", col.c)}>
          <div className="flex items-center justify-between px-1 text-[12px] font-semibold text-zinc-800">
            {col.t}
            <span className="rounded bg-zinc-200/70 px-1 text-[11px] font-medium text-zinc-600">{col.cards.length}</span>
          </div>
          {col.cards.map(([t, co, i]) => (
            <div key={t} className="rounded-md border border-zinc-200 bg-white p-2.5 shadow-[0_1px_2px_rgb(13_15_19/0.04)]">
              <div className="text-[12.5px] font-medium text-zinc-900">{t}</div>
              <div className="mt-0.5 text-[11.5px] text-zinc-500">{co}</div>
              <div className="mt-2.5 flex items-center justify-between">
                <span className="h-1.5 w-12 rounded-full bg-zinc-200" />
                <Av name={co.replace(/[«»ТОИПАО ]/g, "") || "К"} i={i} size={18} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function InboxScreen() {
  const convs = [
    ["Нурлан Бекетов", "Можно счёт на оплату?", "bg-[#229ED9]", 3, true],
    ["ТОО «Orda Coffee»", "Спасибо, получили документы", "bg-[#25D366]", 5, false],
    ["Жанна Омарова", "А есть доставка в Шымкент?", "bg-[#E1306C]", 2, false],
    ["office@berekeagro.kz", "Re: Коммерческое предложение", "bg-zinc-500", 1, false],
  ] as const;
  return (
    <div className="grid h-full min-h-[300px] grid-cols-1 overflow-hidden rounded-lg border border-zinc-200 sm:grid-cols-[210px_1fr]">
      <div className="border-b border-zinc-200 bg-white sm:border-b-0 sm:border-r">
        {convs.map(([n, m, ch, i, active]) => (
          <div key={n} className={clsx("flex gap-2.5 border-b border-zinc-100 px-3 py-2.5", active && "bg-brand-50 shadow-[inset_3px_0_0_rgb(var(--brand-600))]")}>
            <span className="relative">
              <Av name={n} i={i} size={28} />
              <span className={clsx("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white", ch)} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium text-zinc-900">{n}</span>
              <span className="block truncate text-[11.5px] text-zinc-500">{m}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="hidden flex-col justify-end gap-2.5 bg-zinc-50 p-3 sm:flex">
        <div className="max-w-[75%] self-start rounded-[12px_12px_12px_4px] border border-zinc-200 bg-white px-3 py-2 text-[12.5px] text-zinc-800">
          Добрый день! Мы согласовали спецификацию, можно получить счёт?
        </div>
        <div className="max-w-[75%] self-end rounded-[12px_12px_4px_12px] bg-brand-600 px-3 py-2 text-[12.5px] text-white">
          Здравствуйте! Да, подготовлю и пришлю сюда в течение часа.
        </div>
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[12px] text-zinc-400">
          Ответ клиенту в Telegram…
          <span className="ml-auto rounded-md bg-brand-600 px-2 py-1 text-[11px] font-medium text-white">Отправить</span>
        </div>
      </div>
    </div>
  );
}

function CalendarScreen() {
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт"];
  const events: [number, number, number, string, string][] = [
    [0, 1, 2, "Планёрка отдела продаж", "bg-brand-50 text-brand-700 border-brand-200"],
    [1, 3, 2, "Демо для клиента", "bg-emerald-50 text-emerald-700 border-emerald-200"],
    [2, 0, 1, "Созвон с партнёром", "bg-amber-50 text-amber-700 border-amber-200"],
    [3, 2, 3, "Обучение команды", "bg-sky-50 text-sky-700 border-sky-200"],
    [4, 1, 1, "Итоги недели", "bg-rose-50 text-rose-700 border-rose-200"],
  ];
  return (
    <div className="grid grid-cols-5 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {days.map((d, di) => (
        <div key={d} className={clsx("relative min-h-[280px]", di > 0 && "border-l border-zinc-100")}>
          <div className="border-b border-zinc-100 px-2 py-1.5 text-[11.5px] font-medium text-zinc-500">{d}</div>
          <div className="relative h-[240px] [background-image:linear-gradient(to_bottom,rgb(13_15_19/0.05)_1px,transparent_1px)] [background-size:100%_40px]">
            {events.filter((e) => e[0] === di).map(([, top, h, t, cls]) => (
              <div key={t} className={clsx("absolute inset-x-1 rounded-md border px-1.5 py-1 text-[11px] font-medium leading-tight", cls)} style={{ top: top * 40 + 4, height: h * 40 - 8 }}>
                {t}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimeScreen({ active }: { active: boolean }) {
  // Живой таймер: считает с момента открытия вкладки.
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSec(0);
    const id = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-600 text-white">
          <span className="h-3 w-3 rounded-sm bg-white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-zinc-500">Сейчас в работе</div>
          <div className="truncate text-[13.5px] font-medium text-zinc-900">Подготовить договор поставки</div>
        </div>
        <div className="font-mono text-[22px] font-medium tabular-nums text-zinc-900">{hh}:{mm}:{ss}</div>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        {["Согласовать смету с клиентом", "Созвон с командой склада", "Обновить регламент продаж"].map((t, i) => (
          <div key={t} className="flex items-center gap-3 border-b border-zinc-100 bg-white px-3 py-2.5 text-[12.5px] last:border-b-0">
            <Timer size={14} className="text-zinc-400" />
            <span className="min-w-0 flex-1 truncate text-zinc-800">{t}</span>
            <span className="h-1.5 rounded-full bg-brand-200" style={{ width: 90 - i * 22 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function WikiScreen() {
  return (
    <div className="grid min-h-[300px] grid-cols-1 overflow-hidden rounded-lg border border-zinc-200 bg-white sm:grid-cols-[180px_1fr]">
      <div className="border-b border-zinc-200 p-3 text-[12px] sm:border-b-0 sm:border-r">
        {["Продажи", "Регламент работы с лидами", "Скрипты звонков", "Склад", "Приёмка товара", "HR", "Онбординг сотрудника"].map((t, i) => (
          <div key={t} className={clsx("truncate rounded px-2 py-1", [0, 3, 5].includes(i) ? "mt-1.5 font-semibold text-zinc-700" : "pl-4 text-zinc-500", i === 1 && "bg-brand-50 text-brand-700")}>
            {t}
          </div>
        ))}
      </div>
      <div className="p-4">
        <div className="text-[16px] font-semibold text-zinc-900">Регламент работы с лидами</div>
        <div className="mt-1 text-[11.5px] text-zinc-500">Продажи · обновлено недавно</div>
        <div className="mt-4 space-y-2">
          {[92, 78, 85, 60].map((w, i) => <div key={i} className="h-2 rounded bg-zinc-200" style={{ width: `${w}%` }} />)}
        </div>
        <div className="mt-4 text-[13px] font-semibold text-zinc-800">Распределение заявок</div>
        <div className="mt-2 space-y-2">
          {[88, 70, 80].map((w, i) => <div key={i} className="h-2 rounded bg-zinc-200" style={{ width: `${w}%` }} />)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- shell

const NAV: { icon: LucideIcon; label: string; tab?: TabKey }[] = [
  { icon: LayoutDashboard, label: "Дашборд" },
  { icon: CheckSquare, label: "Задачи", tab: "tasks" },
  { icon: Coins, label: "Сделки", tab: "deals" },
  { icon: MessageSquare, label: "Мессенджер" },
  { icon: Inbox, label: "Открытые линии", tab: "inbox" },
  { icon: CalendarDays, label: "Календарь", tab: "calendar" },
  { icon: Timer, label: "Время", tab: "time" },
  { icon: BookOpen, label: "База знаний", tab: "wiki" },
];

export function ProductDemo() {
  const [tab, setTab] = useState<TabKey>("tasks");
  const [auto, setAuto] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Автопереключение, пока пользователь сам не выбрал раздел (и если не просили меньше движения).
  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setTab((cur) => TABS[(TABS.findIndex((t) => t.key === cur) + 1) % TABS.length].key);
    }, 5500);
    return () => window.clearInterval(id);
  }, [auto]);

  const pick = (k: TabKey) => {
    setAuto(false);
    setTab(k);
  };
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div ref={rootRef} className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
      {/* Разделы */}
      <div role="tablist" aria-label="Разделы платформы" className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => pick(t.key)}
              className={clsx(
                "group relative flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                on ? "bg-white shadow-[0_1px_3px_rgb(13_15_19/0.08),0_0_0_1px_rgb(13_15_19/0.06)]" : "hover:bg-white/60",
              )}
            >
              <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors", on ? "bg-brand-600 text-white" : "bg-white text-zinc-500 ring-1 ring-zinc-200")}>
                <Icon size={16} />
              </span>
              <span className="min-w-0">
                <span className={clsx("block text-[14px]", on ? "font-semibold text-zinc-950" : "font-medium text-zinc-600")}>{t.label}</span>
                <span className="hidden text-[12px] text-zinc-500 lg:block">{t.hint}</span>
              </span>
              {on && auto && (
                <span aria-hidden className="absolute inset-x-3.5 bottom-1 hidden h-0.5 overflow-hidden rounded-full bg-zinc-100 lg:block">
                  <span key={tab} className="block h-full origin-left animate-[qd-progress_5.5s_linear_forwards] bg-brand-600" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Окно приложения */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_30px_80px_-30px_rgb(13_15_19/0.35)]">
        <div className="flex h-9 items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-3.5">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
        </div>
        <div className="flex min-h-[420px]">
          <aside className="hidden w-48 shrink-0 flex-col border-r border-zinc-200 bg-white p-2.5 md:flex">
            <div className="mb-3 flex items-center gap-2 px-1.5 pt-1 text-[13px] font-semibold text-zinc-900">
              <LogoMark size={20} /> Qadam CRM
            </div>
            {NAV.map(({ icon: Icon, label, tab: t }) => {
              const on = t === tab;
              return (
                <div
                  key={label}
                  className={clsx("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px]", on ? "bg-brand-50 font-medium text-brand-700" : "text-zinc-600")}
                >
                  <Icon size={14} /> {label}
                </div>
              );
            })}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-12 items-center gap-3 border-b border-zinc-200 px-4">
              <span className="text-[14px] font-semibold text-zinc-900">{current.label}</span>
              <span className="ml-auto hidden h-7 w-56 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[11.5px] text-zinc-400 sm:flex">
                <Search size={12} /> Поиск…
              </span>
              <span className="rounded-md bg-brand-600 px-2.5 py-1 text-[11.5px] font-medium text-white">+ Создать</span>
            </div>
            <div key={tab} className="flex-1 animate-[qd-fade-up_0.45s_cubic-bezier(.2,.8,.2,1)_both] bg-[#FAFBFC] p-4">
              {tab === "tasks" && <TasksScreen />}
              {tab === "deals" && <DealsScreen />}
              {tab === "inbox" && <InboxScreen />}
              {tab === "calendar" && <CalendarScreen />}
              {tab === "time" && <TimeScreen active={tab === "time"} />}
              {tab === "wiki" && <WikiScreen />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
