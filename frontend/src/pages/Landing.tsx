import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Check, ChevronDown, Menu, X } from "lucide-react";

import { api, extractApiError } from "../api/client";
import { trackEvent } from "@/lib/analytics";
import { LogoMark } from "@/components/Logo";
import heroProduct from "@/assets/illustrations/hero-product.svg";
import moduleSales from "@/assets/illustrations/module-sales.svg";
import moduleProjects from "@/assets/illustrations/module-projects.svg";
import moduleComms from "@/assets/illustrations/module-comms.svg";
import moduleTeam from "@/assets/illustrations/module-team.svg";

// ---------------------------------------------------------------------------
// Минималистичный лендинг: видео-герой на весь экран, мало текста.
// Видео подхватывается из /landing/hero.mp4 (frontend/public/landing/). Пока файла нет —
// показывается анимированный фон в фирменных цветах.
// ---------------------------------------------------------------------------

const HERO_VIDEO = "/landing/hero.mp4";
const HERO_POSTER = "/landing/hero-poster.jpg";

const NAV_LINKS = [
  { href: "#product", label: "Продукт" },
  { href: "#modules", label: "Модули" },
  { href: "#pricing", label: "Тарифы" },
];

const MODULES = [
  { art: moduleSales, title: "Продажи", text: "Лиды, сделки и воронка с прогнозом." },
  { art: moduleProjects, title: "Проекты", text: "Задачи, канбан, Ганта и учёт времени." },
  { art: moduleComms, title: "Коммуникации", text: "Telegram, WhatsApp, Instagram и почта." },
  { art: moduleTeam, title: "Команда", text: "Оргструктура, отпуска, цели и календарь." },
];

type PlanInfo = {
  key: string;
  title: string;
  tagline?: string | null;
  price_month: number | null;
  currency: string;
  features: string[];
  limits: { max_users: number | null; max_projects: number | null; max_storage_bytes: number | null };
};

const container = "mx-auto w-full max-w-[1200px] px-5 sm:px-8";

export default function Landing() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Qadam CRM — клиенты, задачи и команда в одной системе";
    // Лендинг всегда светлый: снимаем .dark на время показа.
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const prevBg = root.style.backgroundColor;
    root.classList.remove("dark");
    root.style.backgroundColor = "#0B0D11";
    return () => {
      document.title = prev;
      if (wasDark) root.classList.add("dark");
      root.style.backgroundColor = prevBg;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white text-zinc-900 [color-scheme:light]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Перейти к содержимому
      </a>
      <NavBar />
      <main id="main">
        <Hero />
        <Product />
        <Modules />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------

function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const light = scrolled || open;
  return (
    <header
      className={clsx(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        light ? "border-b border-zinc-200 bg-white/90 backdrop-blur" : "border-b border-transparent bg-transparent",
      )}
    >
      <div className={clsx(container, "flex h-16 items-center gap-8")}>
        <Link to="/" aria-label="Qadam CRM — главная" className={clsx("flex items-center gap-2.5", light ? "text-zinc-950" : "text-white")}>
          <LogoMark size={26} inverted={!light} className={light ? "!text-zinc-950" : undefined} />
          <span className="text-[17px] font-semibold tracking-tight">Qadam</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Разделы">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={clsx("text-sm transition-colors", light ? "text-zinc-600 hover:text-zinc-950" : "text-white/75 hover:text-white")}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-5 md:flex">
          <Link to="/login" className={clsx("text-sm transition-colors", light ? "text-zinc-700 hover:text-zinc-950" : "text-white/80 hover:text-white")}>
            Войти
          </Link>
          <Link
            to="/register"
            onClick={() => trackEvent("cta_click", { place: "nav" })}
            className={clsx(
              "inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition-colors",
              light ? "bg-zinc-950 text-white hover:bg-zinc-800" : "bg-white text-zinc-950 hover:bg-white/90",
            )}
          >
            Начать бесплатно
          </Link>
        </div>
        <button
          type="button"
          className={clsx("ml-auto rounded-md p-2 md:hidden", light ? "text-zinc-800" : "text-white")}
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <div className="border-t border-zinc-200 bg-white md:hidden">
          <div className={clsx(container, "flex flex-col gap-1 py-3")}>
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-md px-2 py-2.5 text-[15px] text-zinc-800">
                {l.label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link to="/login" className="btn-secondary">Войти</Link>
              <Link to="/register" className="btn-primary">Начать</Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------

function HeroBackdrop() {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) v.pause();
    else v.play().catch(() => undefined);
  }, []);
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-[#0B0D11]">
      {/* Фон без видео: сетка, два медленных световых пятна, плавающие «ступени» */}
      <div className="absolute inset-0 [background-image:linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_45%,black,transparent)]" />
      <div className="qd-drift-1 absolute -left-[10%] top-[8%] h-[55vmax] w-[55vmax] rounded-full bg-[radial-gradient(closest-side,rgb(42_82_196/0.55),transparent)] blur-2xl" />
      <div className="qd-drift-2 absolute -right-[12%] bottom-[-10%] h-[50vmax] w-[50vmax] rounded-full bg-[radial-gradient(closest-side,rgb(100_136_234/0.35),transparent)] blur-2xl" />
      <svg viewBox="0 0 612 234" className="qd-float absolute -right-10 bottom-10 hidden w-[520px] opacity-60 lg:block" fill="none">
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} x={i * 84} y={150 - i * 20} width={108} height={84} rx={16} fill={i % 3 === 2 ? "rgb(42 82 196 / 0.45)" : `rgb(255 255 255 / ${i % 3 ? 0.06 : 0.035})`} />
        ))}
      </svg>

      {/* Видео (если положить файл в public/landing/hero.mp4) — плавно проявляется поверх */}
      <video
        ref={ref}
        className={clsx("absolute inset-0 h-full w-full object-cover transition-opacity duration-700", ready ? "opacity-100" : "opacity-90")}
        src={HERO_VIDEO}
        poster={HERO_POSTER}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onCanPlay={() => setReady(true)}
        onError={() => setReady(false)}
      />
      {/* Затемнение: общий слой + тень под текстом в центре + плавный переход вниз */}
      <div className="absolute inset-0 bg-[#0B0D11]/50" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgb(11_13_17/0.45),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(11_13_17/0.5),transparent_30%,transparent_65%,rgb(11_13_17))]" />
      <div className="absolute inset-0 bg-[rgb(42_82_196/0.08)] mix-blend-color" />
    </div>
  );
}

function Hero() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const start = (e: React.FormEvent) => {
    e.preventDefault();
    trackEvent("cta_click", { place: "hero" });
    nav(`/register${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`);
  };
  return (
    <section className="relative isolate flex min-h-[640px] items-center overflow-hidden text-white [height:100svh]">
      <HeroBackdrop />
      <div className={clsx(container, "relative flex flex-col items-center text-center")}>
        <span className="qd-fade-up inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
          CRM и управление работой
        </span>
        <h1
          className="qd-fade-up mt-7 max-w-4xl text-[42px] font-light leading-[1.05] tracking-[-0.035em] text-[#F4F5F7] sm:text-[60px] lg:text-[76px]"
          style={{ animationDelay: "120ms" }}
        >
          Клиенты, задачи и команда —<br className="hidden sm:block" />{" "}
          <span className="text-brand-300">в одной системе</span>
        </h1>
        <p className="qd-fade-up mt-6 max-w-xl text-[17px] leading-relaxed text-white/70 sm:text-lg" style={{ animationDelay: "240ms" }}>
          Без таблиц и разрозненных чатов. Всё, что происходит в компании, — на одном экране.
        </p>
        <form
          onSubmit={start}
          className="qd-fade-up mt-10 flex w-full max-w-md items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] p-1.5 backdrop-blur-md focus-within:border-white/35"
          style={{ animationDelay: "360ms" }}
        >
          <label htmlFor="hero-email" className="sr-only">
            Рабочий email
          </label>
          <input
            id="hero-email"
            type="email"
            autoComplete="email"
            placeholder="Рабочий email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-w-0 flex-1 bg-transparent px-4 text-[15px] text-white placeholder:text-white/45 focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-zinc-950 transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Начать бесплатно <ArrowRight size={15} />
          </button>
        </form>
        <p className="qd-fade-up mt-4 text-[13px] text-white/50" style={{ animationDelay: "440ms" }}>
          Бесплатный тариф · Работает в браузере ·{" "}
          <Link to="/login" className="text-white/75 underline-offset-4 hover:text-white hover:underline">
            Уже есть аккаунт
          </Link>
        </p>
      </div>
      <a
        href="#product"
        aria-label="Прокрутить к описанию продукта"
        className="absolute bottom-7 left-1/2 -translate-x-1/2 rounded-full p-2 text-white/50 transition-colors hover:text-white"
      >
        <ChevronDown size={22} className="qd-float" />
      </a>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Product() {
  return (
    <section id="product" className="scroll-mt-16 bg-white py-24 lg:py-32">
      <div className={clsx(container, "flex flex-col items-center text-center")}>
        <h2 className="max-w-2xl text-[32px] font-light leading-[1.15] tracking-[-0.025em] text-zinc-950 sm:text-[44px]">
          Один экран вместо <span className="text-brand-600">десятка вкладок</span>
        </h2>
        <div className="relative mt-14 w-full max-w-[920px]">
          <div aria-hidden className="absolute inset-x-10 bottom-0 top-10 rounded-[40px] bg-[radial-gradient(closest-side,rgb(var(--brand-100)),transparent)] blur-2xl" />
          <img
            src={heroProduct}
            alt="Интерфейс Qadam: задачи на канбан-доске, карточка сделки, сообщение из открытых линий"
            width={640}
            height={480}
            loading="lazy"
            className="relative mx-auto w-full"
          />
        </div>
        <ul className="mt-12 flex flex-wrap justify-center gap-x-10 gap-y-3 text-[15px] text-zinc-600">
          {["Роли и права доступа", "Автоматизации без кода", "Отчёты в реальном времени"].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <Check size={16} className="text-brand-600" /> {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Modules() {
  return (
    <section id="modules" className="scroll-mt-16 bg-zinc-50 py-24 lg:py-32">
      <div className={container}>
        <h2 className="mx-auto max-w-2xl text-center text-[32px] font-light leading-[1.15] tracking-[-0.025em] text-zinc-950 sm:text-[44px]">
          Всё, чем живёт компания
        </h2>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <article
              key={m.title}
              className="group rounded-2xl border border-zinc-200 bg-white p-5 transition-[border-color,box-shadow] duration-300 hover:border-zinc-300 hover:shadow-pop"
            >
              <div className="overflow-hidden rounded-xl bg-zinc-50 px-3 py-4">
                <img
                  src={m.art}
                  alt=""
                  width={360}
                  height={180}
                  loading="lazy"
                  className="w-full transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <h3 className="mt-5 text-[17px] font-semibold text-zinc-950">{m.title}</h3>
              <p className="mt-1 text-sm text-zinc-500">{m.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

const fmtNumber = (n: number) => new Intl.NumberFormat("ru-RU").format(n);

function planHeadline(p: PlanInfo): string {
  const u = p.limits.max_users;
  return u == null ? "Без ограничения пользователей" : `До ${fmtNumber(u)} пользователей`;
}

function Pricing() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["billing-plans", "public"],
    queryFn: async () => (await api.get<PlanInfo[]>("/api/billing/plans")).data,
    staleTime: 5 * 60_000,
  });
  const plans = data ?? [];
  const highlightIdx = plans.length >= 3 ? 1 : -1;

  return (
    <section id="pricing" className="scroll-mt-16 bg-white py-24 lg:py-32">
      <div className={container}>
        <h2 className="mx-auto max-w-2xl text-center text-[32px] font-light leading-[1.15] tracking-[-0.025em] text-zinc-950 sm:text-[44px]">
          Начните бесплатно
        </h2>
        <p className="mt-4 text-center text-[15px] text-zinc-500">Тариф меняется в настройках в любой момент.</p>
        {isPending ? (
          <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[300px] animate-breathe rounded-2xl bg-zinc-100" />
            ))}
          </div>
        ) : isError || plans.length === 0 ? (
          <p className="mt-14 text-center text-sm text-zinc-500">Тарифы временно недоступны. Напишите нам — подберём вариант.</p>
        ) : (
          <div
            className={clsx(
              "mt-14 grid gap-4",
              plans.length <= 2 && "mx-auto max-w-3xl md:grid-cols-2",
              plans.length === 3 && "md:grid-cols-3",
              plans.length >= 4 && "md:grid-cols-2 lg:grid-cols-4",
            )}
          >
            {plans.map((p, i) => {
              const featured = i === highlightIdx;
              const price = p.price_month == null ? "По запросу" : p.price_month === 0 ? "0" : fmtNumber(p.price_month);
              return (
                <div
                  key={p.key}
                  className={clsx(
                    "flex flex-col rounded-2xl border p-7",
                    featured ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-[15px] font-medium">{p.title}</h3>
                    {featured && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs">Популярный</span>}
                  </div>
                  <div className="mt-6 flex items-baseline gap-1.5">
                    <span className="text-[40px] font-light leading-none tracking-tight tabular-nums">{price}</span>
                    {p.price_month != null && (
                      <span className={clsx("text-sm", featured ? "text-white/60" : "text-zinc-500")}>
                        {p.currency === "KZT" ? "₸" : p.currency} / мес
                      </span>
                    )}
                  </div>
                  <p className={clsx("mt-3 text-sm", featured ? "text-white/70" : "text-zinc-500")}>{planHeadline(p)}</p>
                  <ul className={clsx("mt-6 flex-1 space-y-2 text-sm", featured ? "text-white/80" : "text-zinc-600")}>
                    {p.features.slice(0, 4).map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check size={15} className={clsx("mt-0.5 shrink-0", featured ? "text-brand-300" : "text-brand-600")} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/register"
                    onClick={() => trackEvent("pricing_cta", { plan: p.key })}
                    className={clsx(
                      "mt-8 inline-flex h-10 items-center justify-center rounded-full text-sm font-medium transition-colors",
                      featured ? "bg-white text-zinc-950 hover:bg-white/90" : "border border-zinc-300 text-zinc-900 hover:border-zinc-950",
                    )}
                  >
                    {p.price_month === 0 ? "Начать бесплатно" : "Выбрать"}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function FinalCta() {
  const [contact, setContact] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = contact.trim();
    if (value.length < 5) return setError("Укажите email или телефон.");
    setError(null);
    setSending(true);
    try {
      const name = value.includes("@") ? value.split("@")[0] : "Заявка с сайта";
      await api.post("/api/leads", {
        name: name.length >= 2 ? name : "Заявка с сайта",
        contact: value,
        team_size: "5-20",
        note: "Запрос демонстрации с лендинга",
      });
      trackEvent("lead_submitted", { place: "final_cta" });
      setSent(true);
    } catch (err) {
      setError(extractApiError(err).message || "Не удалось отправить. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="contact" className="relative isolate scroll-mt-16 overflow-hidden bg-[#0B0D11] py-24 text-white lg:py-32">
      <div aria-hidden className="qd-drift-1 absolute -left-40 top-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(42_82_196/0.45),transparent)] blur-2xl" />
      <div className={clsx(container, "relative flex flex-col items-center text-center")}>
        <h2 className="max-w-2xl text-[32px] font-light leading-[1.15] tracking-[-0.025em] sm:text-[44px]">
          Покажем Qadam на ваших процессах
        </h2>
        <p className="mt-4 text-[15px] text-white/60">Оставьте контакт — созвонимся и поможем с настройкой.</p>
        {sent ? (
          <p role="status" className="mt-10 inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm">
            <Check size={16} className="text-emerald-400" /> Заявка отправлена. Свяжемся в течение рабочего дня.
          </p>
        ) : (
          <form
            onSubmit={submit}
            className="mt-10 flex w-full max-w-md items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] p-1.5 focus-within:border-white/35"
            noValidate
          >
            <label htmlFor="cta-contact" className="sr-only">
              Email или телефон
            </label>
            <input
              id="cta-contact"
              placeholder="Email или телефон"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="min-w-0 flex-1 bg-transparent px-4 text-[15px] text-white placeholder:text-white/45 focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-zinc-950 transition-colors hover:bg-white/90 disabled:opacity-60"
            >
              {sending ? "Отправляем…" : "Запросить демо"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[#0B0D11] pb-10 text-white/50">
      <div className={clsx(container, "flex flex-col gap-4 border-t border-white/10 pt-8 text-[13px] sm:flex-row sm:items-center sm:justify-between")}>
        <div className="flex items-center gap-2 text-white/70">
          <LogoMark size={20} inverted />
          <span>© {new Date().getFullYear()} Qadam CRM</span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Нижнее меню">
          <Link to="/privacy" className="hover:text-white">Конфиденциальность</Link>
          <Link to="/terms" className="hover:text-white">Условия</Link>
          <span className="select-all">hello@qadam.kz</span>
        </nav>
      </div>
    </footer>
  );
}
