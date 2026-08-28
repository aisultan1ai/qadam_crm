import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Check, CheckCircle2, Circle, KanbanSquare, LineChart, MessageSquare,
  ShieldCheck, Sparkles, Users, Zap,
} from "lucide-react";

import { api, extractApiError } from "../api/client";
import { trackEvent } from "@/lib/analytics";
import { LogoMark } from "@/components/Logo";
import "./landing.css";

const NAV_LINKS = [
  { href: "#product", label: "Продукт" },
  { href: "#how", label: "Как это работает" },
  { href: "#pricing", label: "Тарифы" },
  { href: "#faq", label: "Вопросы" },
];

const FEATURES = [
  {
    icon: KanbanSquare,
    title: "Задачи и Kanban",
    text: "Проекты, задачи, статусы. Drag-and-drop доска, приоритеты, дедлайны и приложения к задачам.",
  },
  {
    icon: MessageSquare,
    title: "Мессенджер команды",
    text: "Каналы проектов, личные и групповые чаты, опросы, реакции — обсуждайте без прыжков между приложениями.",
  },
  {
    icon: LineChart,
    title: "Аналитика и лиды",
    text: "Отчёты по сотрудникам, воронка лидов из форм захвата, экспорт в Excel, интеграции с сайтом.",
  },
];

const HOW_STEPS = [
  { n: 1, title: "Создайте компанию", text: "Регистрация занимает минуту. Приглашайте команду по email." },
  { n: 2, title: "Настройте проект", text: "Заведите первый проект, добавьте задачи, распределите роли." },
  { n: 3, title: "Работайте в потоке", text: "Kanban, чат, уведомления и аналитика — всё в одном месте." },
];

const SUCCESS_WITH = [
  "Один инструмент — задачи, чат, лиды, аналитика",
  "Мгновенные обновления через WebSocket — без F5",
  "Автоматические напоминания и дайджест-письма",
];

const SUCCESS_WITHOUT = [
  "Задачи теряются в Excel, WhatsApp и почте",
  "Никто не знает, что сделано и что горит",
  "Ручная сборка отчётов и потерянные лиды",
];

const TESTIMONIALS = [
  {
    quote:
      "За неделю перенесли из чатов и Excel всё в Qadam. Kanban с реал-таймом убрал хаос — теперь видно кто что делает.",
    name: "Айгерим Нурланова",
    role: "Product Manager, ACME",
  },
  {
    quote:
      "Формы захвата с сайта падают прямо в CRM — менеджеры не пропускают ни одной заявки. Конверсия выросла на 30%.",
    name: "Данияр Абаев",
    role: "Founder, Startup KZ",
  },
  {
    quote:
      "Ролевая модель и изоляция данных — то что искали для нашего SaaS. Внедрили за 3 дня без разработчиков.",
    name: "Мария Ким",
    role: "Head of Ops, Digital Studio",
  },
];

const FAQ_ITEMS = [
  {
    q: "Сколько стоит Qadam CRM?",
    a: "Free — 0 KZT (5 пользователей, 3 проекта, 1 ГБ). Pro — 9 990 KZT/мес (50 пользователей, 50 проектов, 20 ГБ). Enterprise — по договорённости.",
  },
  {
    q: "Где хранятся данные?",
    a: "На серверах в Казахстане. Ежедневные резервные копии, шифрование при передаче (TLS) и в покое. Данные каждой компании полностью изолированы.",
  },
  {
    q: "Можно ли отменить подписку?",
    a: "Да, в любой момент из раздела «Настройки → Тариф». Доступ сохраняется до конца оплаченного периода, затем аккаунт переводится на Free.",
  },
  {
    q: "Есть ли API и интеграции?",
    a: "REST API покрывает все основные сущности. Формы захвата через embed-скрипт для любого сайта. Webhook'и и интеграции со Slack/Telegram — в разработке.",
  },
];

const PLANS = [
  {
    key: "free",
    name: "Free",
    price: "0",
    priceLabel: "KZT",
    period: "навсегда",
    tagline: "Для команд до 5 человек — попробовать всё бесплатно",
    features: [
      "До 5 пользователей",
      "До 3 проектов",
      "1 ГБ хранилища",
      "Kanban, задачи, комментарии",
      "Мессенджер и опросы",
    ],
    cta: "Начать бесплатно",
    highlighted: false,
  },
  {
    key: "pro",
    name: "Pro",
    price: "9 990",
    priceLabel: "KZT",
    period: "в месяц",
    tagline: "Для растущих команд с реальной нагрузкой",
    features: [
      "До 50 пользователей",
      "До 50 проектов",
      "20 ГБ хранилища",
      "Формы захвата лидов + embed",
      "Экспорт в Excel, приоритетная поддержка",
    ],
    cta: "Перейти на Pro",
    highlighted: true,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "По запросу",
    priceLabel: "",
    period: "",
    tagline: "Кастомные лимиты, SSO, on-premise",
    features: [
      "Без лимитов пользователей и проектов",
      "Кастомный домен, брендирование",
      "SSO, кастомная интеграция",
      "SLA 99.9%, персональный менеджер",
    ],
    cta: "Связаться",
    highlighted: false,
  },
];

type FormState = {
  name: string;
  company: string;
  contact: string;
  team: "5-20" | "20-50" | "50+";
  note: string;
};

export default function Landing() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Qadam CRM — порядок в задачах с первого дня";
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".qadam-reveal"));
    if (!nodes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -80px 0px" },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  return (
    <div className="qadam-landing">
      <NavBar />
      <Hero />
      <Benefits />
      <HowItWorks />
      <SuccessStories />
      <Testimonials />
      <Pricing />
      <FAQ />
      <CTASection />
      <Footer />
    </div>
  );
}

// =========================================================================
// Navigation (sticky, transparent над hero)
// =========================================================================

function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className="fixed inset-x-0 z-50 flex justify-center transition-all duration-300 ease-out"
      style={{
        top: scrolled ? 14 : 12,
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <nav
        className="flex items-center justify-between transition-all duration-300 ease-out"
        style={{
          width: "100%",
          maxWidth: scrolled ? 1000 : 1140,
          height: scrolled ? 58 : 64,
          padding: scrolled ? "0 8px 0 22px" : "0 12px 0 26px",
          // Светлый прозрачный pill — сочетается со светлым hero и платформой.
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "saturate(180%) blur(18px)",
          WebkitBackdropFilter: "saturate(180%) blur(18px)",
          border: "1px solid rgba(10,10,18,0.08)",
          borderRadius: 999,
          boxShadow: scrolled
            ? "0 14px 34px -14px rgba(10,10,18,0.15), 0 2px 6px -2px rgba(10,10,18,0.08)"
            : "0 6px 20px -10px rgba(10,10,18,0.10)",
        }}
      >
        <Link to="/" className="flex items-center gap-2">
          <LogoMark size={26} className="!text-[#0A0A12]" />
          <span className="text-[17px] font-bold tracking-tight" style={{ color: "#0A0A12" }}>
            Qadam<span style={{ color: "#7C5CFF" }}>.</span>
          </span>
        </Link>
        <div className="qadam-hide-mobile flex items-center gap-7">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium transition-colors"
              style={{ color: "#3F4457" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#0A0A12")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#3F4457")}
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/login"
            className="hidden rounded-full px-4 py-1.5 text-sm font-medium transition-colors sm:inline-flex"
            style={{ color: "#3F4457" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(10,10,18,0.05)";
              e.currentTarget.style.color = "#0A0A12";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#3F4457";
            }}
          >
            Войти
          </Link>
          <Link
            to="/register"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium text-white transition-transform hover:scale-[1.03]"
            style={{
              background: "#7C5CFF",
              boxShadow: "0 8px 20px -8px rgba(124,92,255,0.6)",
            }}
          >
            Начать <ArrowRight size={13} />
          </Link>
        </div>
      </nav>
    </div>
  );
}

// =========================================================================
// Hero — dark, крупный h1 по центру
// =========================================================================

function Hero() {
  return (
    <section
      className="relative overflow-hidden pt-[140px] pb-[100px] text-center"
      style={{
        background: "linear-gradient(180deg, #FAFAFA 0%, #F3EFFF 100%)",
      }}
    >
      {/* Ambient violet blobs — светлые полупрозрачные, для мягкого glow */}
      <div
        className="qadam-blob qadam-blob-drift"
        style={{
          top: "-100px",
          left: "-100px",
          width: 400,
          height: 400,
          background: "#7C5CFF",
          opacity: 0.15,
        }}
      />
      <div
        className="qadam-blob qadam-blob-drift"
        style={{
          top: 100,
          right: "-120px",
          width: 340,
          height: 340,
          background: "#6B47F5",
          opacity: 0.12,
          animationDelay: "-8s",
        }}
      />

      <div className="qadam-container relative">
        <h1
          className="mx-auto max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-[72px]"
          style={{
            color: "#0A0A12",
            textWrap: "balance" as CSSProperties["textWrap"],
            letterSpacing: "-0.03em",
          }}
        >
          Порядок в задачах <br />
          <span style={{ color: "#7C5CFF" }}>с первого дня.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed sm:text-lg" style={{ color: "#52596E" }}>
          CRM для команд, которые устали от Excel и десяти вкладок. Задачи, мессенджер, лиды и
          аналитика — в одном спокойном месте.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/register"
            className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-medium text-white transition-transform hover:scale-[1.02]"
            style={{
              background: "#7C5CFF",
              boxShadow: "0 14px 34px -12px rgba(124,92,255,0.55)",
            }}
          >
            Начать бесплатно <ArrowRight size={16} />
          </Link>
          <a
            href="#pricing"
            className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-medium transition-colors"
            style={{
              color: "#0A0A12",
              border: "1px solid rgba(10,10,18,0.15)",
              background: "rgba(255,255,255,0.6)",
            }}
          >
            Смотреть цены
          </a>
        </div>

        {/* App peek */}
        <div className="qadam-reveal mx-auto mt-16 max-w-5xl">
          <div
            className="overflow-hidden rounded-t-2xl"
            style={{
              background: "#ffffff",
              border: "1px solid rgba(10,10,18,0.08)",
              boxShadow: "0 30px 80px -30px rgba(10,10,18,0.25)",
            }}
          >
            <DashboardPeek />
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardPeek() {
  return (
    <div style={{ padding: "18px 20px 0" }}>
      <div
        className="flex items-center gap-3 border-b pb-3"
        style={{ borderColor: "rgba(10,10,18,0.06)" }}
      >
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#E4DBFF" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#E4DBFF" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#E4DBFF" }} />
        </div>
        <div className="ml-4 flex items-center gap-2 text-xs" style={{ color: "#6B7280" }}>
          <LogoMark size={16} className="!text-[#0A0A12]" />
          <span>Qadam CRM</span>
        </div>
      </div>
      <div className="grid grid-cols-[220px_1fr] gap-4 pt-4 text-left">
        <aside
          className="rounded-lg p-3 text-xs"
          style={{ background: "#F7F7FA", border: "1px solid rgba(10,10,18,0.04)" }}
        >
          <div className="mb-3 text-[10px] uppercase tracking-wide" style={{ color: "#9CA3AF" }}>
            Меню
          </div>
          {["Панель", "Проекты", "Задачи", "Мессенджер", "Лиды", "Аналитика"].map((l, i) => (
            <div
              key={l}
              className="mb-1 flex items-center gap-2 rounded px-2 py-1.5"
              style={
                i === 0
                  ? { background: "rgba(124,92,255,0.12)", color: "#5A38DB", fontWeight: 500 }
                  : { color: "#52596E" }
              }
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#7C5CFF" }} />
              {l}
            </div>
          ))}
        </aside>
        <div className="grid grid-cols-3 gap-3 pb-5">
          {[
            { label: "Активных задач", val: "128", delta: "+12%" },
            { label: "В работе", val: "42", delta: "" },
            { label: "Просрочено", val: "3", delta: "" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-lg p-3"
              style={{ background: "#F7F7FA", border: "1px solid rgba(10,10,18,0.04)" }}
            >
              <div className="text-[11px]" style={{ color: "#6B7280" }}>{s.label}</div>
              <div className="mt-1 text-xl font-semibold" style={{ color: "#0A0A12" }}>{s.val}</div>
              {s.delta && <div className="mt-1 text-[10px]" style={{ color: "#10B981" }}>{s.delta}</div>}
            </div>
          ))}
          <div
            className="col-span-3 rounded-lg p-3"
            style={{ background: "#F7F7FA", border: "1px solid rgba(10,10,18,0.04)" }}
          >
            <div className="mb-2 text-[11px]" style={{ color: "#6B7280" }}>Динамика за неделю</div>
            <ChartPeek />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartPeek() {
  const bars = [40, 62, 54, 88, 76, 92, 70];
  return (
    <div className="flex h-24 items-end gap-2">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t"
          style={{ height: `${h}%`, background: i === 3 ? "#7C5CFF" : "rgba(124,92,255,0.35)" }}
        />
      ))}
    </div>
  );
}

// =========================================================================
// Benefits — light bg, 3 карточки фич
// =========================================================================

function Benefits() {
  return (
    <section id="product" className="qadam-reveal py-[120px]" style={{ background: "#ffffff" }}>
      <div className="qadam-container">
        <div className="mb-14 grid gap-6 md:grid-cols-[1fr_1fr] md:items-end">
          <div>
            <div className="qadam-eyebrow mb-3">Почему Qadam</div>
            <h2
              className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[42px]"
              style={{ color: "#0A0A12", letterSpacing: "-0.025em" }}
            >
              Просто, быстро, без лишнего.
            </h2>
          </div>
          <p className="text-base leading-relaxed text-[#52596E] md:pl-8">
            Мы собрали в одном приложении задачи, чат и лиды — чтобы вы перестали переключаться
            между Trello, Slack и Excel. Никаких лишних кнопок и мастеров-настройщиков.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl p-7 transition-all hover:-translate-y-1"
              style={{
                background: "#F7F7FA",
                border: "1px solid rgba(10,10,18,0.06)",
              }}
            >
              <div
                className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl text-white"
                style={{ background: "#7C5CFF" }}
              >
                <f.icon size={20} />
              </div>
              <div className="mb-2 text-lg font-semibold" style={{ color: "#0A0A12" }}>
                {f.title}
              </div>
              <p className="text-sm leading-relaxed text-[#52596E]">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// How it works — 3 нумерованных шага
// =========================================================================

function HowItWorks() {
  return (
    <section
      id="how"
      className="qadam-reveal py-[110px]"
      style={{ background: "#F7F7FA" }}
    >
      <div className="qadam-container">
        <div className="mb-14 text-center">
          <div className="qadam-eyebrow mb-3">Как это работает</div>
          <h2
            className="mx-auto max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[42px]"
            style={{ color: "#0A0A12", letterSpacing: "-0.025em" }}
          >
            Несколько простых шагов и готово
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-[#52596E]">
            От регистрации до первого проекта — пять минут. Вся команда на одной волне.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {HOW_STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl bg-white p-8 text-center"
              style={{
                border: "1px solid rgba(10,10,18,0.06)",
                boxShadow: "0 4px 14px -8px rgba(10,10,18,0.08)",
              }}
            >
              <div
                className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white"
                style={{ background: "#7C5CFF" }}
              >
                {s.n}
              </div>
              <div className="mb-2 text-lg font-semibold" style={{ color: "#0A0A12" }}>
                {s.title}
              </div>
              <p className="text-sm leading-relaxed text-[#52596E]">{s.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/register"
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02]"
            style={{
              background: "#7C5CFF",
              boxShadow: "0 12px 30px -12px rgba(124,92,255,0.55)",
            }}
          >
            Начать бесплатно <ArrowRight size={14} />
          </Link>
          <a
            href="#pricing"
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium"
            style={{
              color: "#0A0A12",
              border: "1px solid rgba(10,10,18,0.15)",
            }}
          >
            Смотреть цены
          </a>
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// Success stories — dark, tab-switcher, буллеты + fake chart
// =========================================================================

function SuccessStories() {
  const [tab, setTab] = useState<"with" | "without">("with");
  const items = tab === "with" ? SUCCESS_WITH : SUCCESS_WITHOUT;
  const chartColor = tab === "with" ? "#10B981" : "#EF4444";
  const value = tab === "with" ? "+45,6%" : "−45,6%";
  return (
    <section className="qadam-reveal py-[120px]" style={{ background: "#ffffff" }}>
      <div className="qadam-container">
        <div className="mb-10 max-w-2xl">
          <div className="qadam-eyebrow mb-3">Продуктивность команды</div>
          <h2
            className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[42px]"
            style={{ color: "#0A0A12", letterSpacing: "-0.025em" }}
          >
            Меньше рутины — больше результата
          </h2>
        </div>

        <div
          className="mb-8 inline-flex gap-1 rounded-full p-1"
          style={{ background: "rgba(10,10,18,0.05)" }}
        >
          <button
            className="rounded-full px-5 py-2 text-sm font-medium transition-colors"
            style={
              tab === "with"
                ? { background: "#7C5CFF", color: "#ffffff", boxShadow: "0 4px 12px -4px rgba(124,92,255,0.5)" }
                : { color: "#52596E" }
            }
            onClick={() => setTab("with")}
          >
            С Qadam CRM
          </button>
          <button
            className="rounded-full px-5 py-2 text-sm font-medium transition-colors"
            style={
              tab === "without"
                ? { background: "#0A0A12", color: "#ffffff" }
                : { color: "#52596E" }
            }
            onClick={() => setTab("without")}
          >
            Без Qadam CRM
          </button>
        </div>

        <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-start">
          <ul className="space-y-4">
            {items.map((t) => (
              <li key={t} className="flex items-start gap-3" style={{ color: "#3F4457" }}>
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: tab === "with" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.12)" }}
                >
                  {tab === "with" ? (
                    <Check size={13} className="text-[#10B981]" />
                  ) : (
                    <Circle size={7} className="fill-current text-[#EF4444]" />
                  )}
                </span>
                <span className="text-[15px] leading-relaxed">{t}</span>
              </li>
            ))}
          </ul>
          <div
            className="rounded-2xl p-6"
            style={{
              background: "#F7F7FA",
              border: "1px solid rgba(10,10,18,0.06)",
              boxShadow: "0 4px 14px -8px rgba(10,10,18,0.08)",
            }}
          >
            <div className="mb-2 flex items-center justify-between text-xs">
              <span style={{ color: "#6B7280" }}>Продуктивность команды</span>
              <span style={{ color: chartColor }}>{value}</span>
            </div>
            <div className="mb-3 text-2xl font-semibold" style={{ color: "#0A0A12" }}>
              {tab === "with" ? "85 211" : "25 780"}
            </div>
            <FakeChart color={chartColor} up={tab === "with"} />
          </div>
        </div>
      </div>
    </section>
  );
}

function FakeChart({ color, up }: { color: string; up: boolean }) {
  const points = up
    ? [30, 42, 38, 55, 48, 65, 60, 80, 78, 92]
    : [80, 72, 78, 60, 68, 45, 52, 30, 35, 20];
  const path = points
    .map((y, i) => {
      const x = (i / (points.length - 1)) * 100;
      return `${i === 0 ? "M" : "L"} ${x},${100 - y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 w-full">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L 100,100 L 0,100 Z`} fill={`url(#grad-${color})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// =========================================================================
// Testimonials — dark, 3 карточки отзывов
// =========================================================================

function Testimonials() {
  return (
    <section className="qadam-reveal py-[120px]" style={{ background: "#F7F7FA" }}>
      <div className="qadam-container">
        <div className="mb-14 text-center">
          <div className="qadam-eyebrow mb-3">Отзывы</div>
          <h2
            className="mx-auto max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[42px]"
            style={{ color: "#0A0A12", letterSpacing: "-0.025em" }}
          >
            Что говорят пользователи
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base" style={{ color: "#52596E" }}>
            Команды разных размеров — от 5 до 200 человек — уже упорядочили работу.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className="rounded-2xl p-6 transition-all hover:-translate-y-1"
              style={{
                background: "#ffffff",
                border: "1px solid rgba(10,10,18,0.06)",
                boxShadow: "0 4px 14px -8px rgba(10,10,18,0.08)",
              }}
            >
              <p className="text-[15px] leading-relaxed" style={{ color: "#3F4457" }}>"{t.quote}"</p>
              <div
                className="mt-6 flex items-center gap-3 border-t pt-4"
                style={{ borderColor: "rgba(10,10,18,0.06)" }}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: `hsl(${255 + i * 15}, 65%, 65%)` }}
                >
                  {t.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "#0A0A12" }}>{t.name}</div>
                  <div className="text-xs" style={{ color: "#6B7280" }}>{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// Pricing — light, 3 плана + Popular + toggle Monthly/Yearly
// =========================================================================

function Pricing() {
  const [yearly, setYearly] = useState(false);
  return (
    <section id="pricing" className="qadam-reveal py-[120px]" style={{ background: "#ffffff" }}>
      <div className="qadam-container">
        <div className="mb-8 text-center">
          <div className="qadam-eyebrow mb-3">Тарифы</div>
          <h2
            className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[42px]"
            style={{ color: "#0A0A12", letterSpacing: "-0.025em" }}
          >
            Тариф, который вам подходит
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-[#52596E]">
            Начните с Free — переходите на Pro когда команда вырастет.
          </p>
        </div>

        <div className="mb-10 flex items-center justify-center gap-3">
          <div
            className="inline-flex items-center gap-1 rounded-full p-1"
            style={{ background: "rgba(10,10,18,0.06)" }}
          >
            <button
              className={
                "rounded-full px-5 py-2 text-sm font-medium transition-colors " +
                (!yearly ? "bg-white text-[#0A0A12] shadow" : "text-[#52596E]")
              }
              onClick={() => setYearly(false)}
            >
              Помесячно
            </button>
            <button
              className={
                "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors " +
                (yearly ? "bg-white text-[#0A0A12] shadow" : "text-[#52596E]")
              }
              onClick={() => setYearly(true)}
            >
              Годовая
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                style={{ background: "#7C5CFF" }}
              >
                −20%
              </span>
            </button>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.key}
              className="relative rounded-2xl p-8 transition-transform hover:-translate-y-1"
              style={{
                background: "#ffffff",
                border: p.highlighted ? "2px solid #7C5CFF" : "1px solid rgba(10,10,18,0.08)",
                boxShadow: p.highlighted
                  ? "0 20px 40px -18px rgba(124,92,255,0.35)"
                  : "0 4px 14px -8px rgba(10,10,18,0.08)",
              }}
            >
              {p.highlighted && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white"
                  style={{ background: "#7C5CFF" }}
                >
                  Популярный
                </div>
              )}
              <div className="mb-1 text-sm font-semibold" style={{ color: "#7C5CFF" }}>
                {p.name}
              </div>
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-4xl font-bold" style={{ color: "#0A0A12" }}>
                  {p.key === "pro" && yearly ? "7 990" : p.price}
                </span>
                {p.priceLabel && (
                  <span className="text-sm text-[#52596E]">
                    {p.priceLabel}
                    {p.period && ` / ${p.period}`}
                  </span>
                )}
              </div>
              <p className="mt-2 min-h-[40px] text-sm text-[#52596E]">{p.tagline}</p>

              <ul className="mt-6 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-[#3F4457]">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: "#7C5CFF" }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                to={p.key === "enterprise" ? "#cta" : "/register"}
                className={
                  "mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.02] " +
                  (p.highlighted ? "text-white" : "")
                }
                style={
                  p.highlighted
                    ? {
                        background: "#7C5CFF",
                        boxShadow: "0 10px 24px -10px rgba(124,92,255,0.55)",
                      }
                    : { border: "1px solid rgba(10,10,18,0.15)", color: "#0A0A12" }
                }
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// FAQ
// =========================================================================

function FAQ() {
  return (
    <section id="faq" className="qadam-reveal py-[100px]" style={{ background: "#ffffff" }}>
      <div className="qadam-container max-w-3xl">
        <div className="mb-10 text-center">
          <div className="qadam-eyebrow mb-3">Вопросы и ответы</div>
          <h2
            className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[42px]"
            style={{ color: "#0A0A12", letterSpacing: "-0.025em" }}
          >
            Часто спрашивают
          </h2>
        </div>
        <div className="grid gap-3">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl bg-[#F7F7FA] p-6 transition-colors hover:bg-[#EFEFF5]"
            >
              <summary className="flex items-center justify-between gap-4 text-base font-medium" style={{ color: "#0A0A12" }}>
                <span>{item.q}</span>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform group-open:rotate-45"
                  style={{ background: "#ffffff", color: "#7C5CFF", border: "1px solid rgba(10,10,18,0.06)" }}
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[#52596E]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// CTA — dark панель с формой лидов
// =========================================================================

function CTASection() {
  const [form, setForm] = useState<FormState>({
    name: "",
    company: "",
    contact: "",
    team: "5-20",
    note: "",
  });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || sent) return;
    setError(null);
    const name = form.name.trim();
    const contact = form.contact.trim();
    if (name.length < 2) return setError("Укажите имя (минимум 2 символа).");
    if (contact.length < 3) return setError("Укажите телефон или email для связи.");
    setSending(true);
    try {
      await api.post("/api/leads", {
        name,
        company: form.company.trim() || null,
        contact,
        team_size: form.team,
        note: form.note.trim() || null,
      });
      trackEvent("lead_submitted", { team_size: form.team });
      setSent(true);
    } catch (err) {
      setError(extractApiError(err).message || "Не удалось отправить заявку.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="cta" className="qadam-reveal py-[120px]" style={{ background: "#ffffff" }}>
      <div className="qadam-container">
        <div
          className="relative overflow-hidden rounded-3xl p-10 md:p-14"
          style={{
            background: "linear-gradient(135deg, #F3EFFF 0%, #FAFAFA 100%)",
            border: "1px solid rgba(124,92,255,0.15)",
          }}
        >
          <div
            className="qadam-blob qadam-blob-drift"
            style={{
              top: "-100px",
              right: "-80px",
              width: 320,
              height: 320,
              background: "#7C5CFF",
              opacity: 0.18,
            }}
          />
          <div className="relative grid gap-10 md:grid-cols-[1.05fr_1fr] md:items-center">
            <div>
              <div className="qadam-eyebrow mb-3">Начать сегодня</div>
              <h2
                className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[44px]"
                style={{ color: "#0A0A12", letterSpacing: "-0.025em" }}
              >
                Соберите команду в одном месте
              </h2>
              <p className="mt-4 max-w-md text-base" style={{ color: "#52596E" }}>
                Оставьте заявку — наш менеджер перезвонит, поможет с настройкой и подберёт тариф.
                Или зарегистрируйтесь сами прямо сейчас.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02]"
                  style={{
                    background: "#7C5CFF",
                    boxShadow: "0 12px 30px -12px rgba(124,92,255,0.55)",
                  }}
                >
                  Начать бесплатно <ArrowRight size={14} />
                </Link>
                <a
                  href="mailto:hello@qadam.kz"
                  className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-colors"
                  style={{
                    color: "#0A0A12",
                    border: "1px solid rgba(10,10,18,0.15)",
                    background: "rgba(255,255,255,0.7)",
                  }}
                >
                  hello@qadam.kz
                </a>
              </div>
            </div>

            <form
              onSubmit={submit}
              className="relative rounded-2xl p-6"
              style={{
                background: "#ffffff",
                border: "1px solid rgba(10,10,18,0.08)",
                boxShadow: "0 20px 50px -20px rgba(10,10,18,0.15)",
              }}
            >
              {sent ? (
                <div className="py-8 text-center">
                  <div
                    className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                    style={{ background: "rgba(16,185,129,0.15)", color: "#10B981" }}
                  >
                    <Check size={22} />
                  </div>
                  <div className="text-lg font-semibold" style={{ color: "#0A0A12" }}>Спасибо! Мы на связи.</div>
                  <p className="mt-1 text-sm" style={{ color: "#6B7280" }}>Свяжемся в течение рабочего дня.</p>
                </div>
              ) : (
                <>
                  <div className="mb-2 text-sm font-medium" style={{ color: "#0A0A12" }}>Оставить заявку</div>
                  <div className="grid gap-2.5">
                    <input
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: "#F7F7FA",
                        color: "#0A0A12",
                        border: "1px solid rgba(10,10,18,0.06)",
                      }}
                      placeholder="Имя"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: "#F7F7FA",
                        color: "#0A0A12",
                        border: "1px solid rgba(10,10,18,0.06)",
                      }}
                      placeholder="Компания"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                    />
                    <input
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: "#F7F7FA",
                        color: "#0A0A12",
                        border: "1px solid rgba(10,10,18,0.06)",
                      }}
                      placeholder="Email или телефон"
                      value={form.contact}
                      onChange={(e) => setForm({ ...form, contact: e.target.value })}
                    />
                    <div className="flex gap-1.5">
                      {(["5-20", "20-50", "50+"] as const).map((v) => {
                        const active = form.team === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            className="flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors"
                            style={
                              active
                                ? { background: "#7C5CFF", color: "#ffffff" }
                                : { background: "#F7F7FA", color: "#52596E", border: "1px solid rgba(10,10,18,0.06)" }
                            }
                            onClick={() => setForm({ ...form, team: v })}
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      rows={2}
                      className="w-full resize-none rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: "#F7F7FA",
                        color: "#0A0A12",
                        border: "1px solid rgba(10,10,18,0.06)",
                      }}
                      placeholder="Задача или комментарий"
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                    />
                    {error && (
                      <div
                        className="rounded-lg px-3 py-2 text-xs"
                        style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}
                      >
                        {error}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={sending}
                      className="mt-1 inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
                      style={{
                        background: "#7C5CFF",
                        boxShadow: "0 10px 24px -10px rgba(124,92,255,0.55)",
                      }}
                    >
                      {sending ? "Отправляем…" : "Отправить заявку"}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// Footer — light, 4 колонки
// =========================================================================

function Footer() {
  return (
    <footer className="pb-10 pt-16" style={{ background: "#ffffff" }}>
      <div className="qadam-container">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <LogoMark size={26} className="!text-[#0A0A12]" />
              <span className="text-lg font-bold" style={{ color: "#0A0A12" }}>
                Qadam<span style={{ color: "#7C5CFF" }}>.</span>
              </span>
            </div>
            <p className="max-w-xs text-sm text-[#52596E]">
              CRM с задачами, чатом и лидами — для команд, которым важен порядок и скорость.
            </p>
          </div>
          <FooterCol
            title="Продукт"
            items={[
              { label: "Задачи и Kanban", href: "#product" },
              { label: "Мессенджер", href: "#product" },
              { label: "Формы лидов", href: "#product" },
              { label: "Аналитика", href: "#product" },
            ]}
          />
          <FooterCol
            title="Компания"
            items={[
              { label: "О проекте", href: "#" },
              { label: "Контакты", href: "mailto:hello@qadam.kz" },
              { label: "Партнёры", href: "#" },
              { label: "Карьера", href: "#" },
            ]}
          />
          <FooterCol
            title="Ресурсы"
            items={[
              { label: "Тарифы", href: "#pricing" },
              { label: "Вопросы", href: "#faq" },
              { label: "Документация", href: "#" },
              { label: "Блог", href: "#" },
            ]}
          />
          <FooterCol
            title="Соцсети"
            items={[
              { label: "Telegram", href: "#" },
              { label: "Instagram", href: "#" },
              { label: "LinkedIn", href: "#" },
              { label: "YouTube", href: "#" },
            ]}
          />
        </div>

        <div
          className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-xs text-[#6B7280]"
          style={{ borderColor: "rgba(10,10,18,0.08)" }}
        >
          <span>© {new Date().getFullYear()} Qadam CRM. Все права защищены.</span>
          <span className="flex flex-wrap gap-4">
            <Link to="/privacy" className="hover:text-[#0A0A12]">Политика конфиденциальности</Link>
            <Link to="/terms" className="hover:text-[#0A0A12]">Условия</Link>
            <a href="mailto:hello@qadam.kz" className="hover:text-[#0A0A12]">hello@qadam.kz</a>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, items }: { title: string; items: { label: string; href: string }[] }) {
  return (
    <div>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#0A0A12" }}>
        {title}
      </div>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.label}>
            <a href={i.href} className="text-sm text-[#52596E] transition-colors hover:text-[#0A0A12]">
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
