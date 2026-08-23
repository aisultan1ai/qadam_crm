import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import "./landing.css";

const LOGO_SVG = (size: number, ink: string = "var(--ink)") => (
  <svg width={size} height={size} viewBox="0 0 512 512" aria-label="Qadam CRM">
    <path
      d="M256 90 a150 150 0 1 0 0.1 0 Z M256 130 a110 110 0 1 1 -0.1 0 Z"
      fill={ink}
      fillRule="evenodd"
    />
    <path d="M372 300 L409 399 L330 360 Z" fill={ink} />
    <rect x="274" y="176" width="80" height="60" rx="12" fill="var(--logo-1)" />
    <rect x="224" y="228" width="80" height="60" rx="12" fill="var(--logo-2)" />
    <g fill={ink}>
      <rect x="184" y="278" width="70" height="50" rx="12" />
      <path d="M249 296 L318 340 L199 328 Z" />
    </g>
  </svg>
);

const NAV_LINKS = [
  { href: "#product", label: "Продукт" },
  { href: "#how", label: "Как это работает" },
  { href: "#ai", label: "ИИ-помощник" },
  { href: "#cta", label: "Демо" },
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
    document.title = "Qadam CRM — Порядок в задачах с первого дня";
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

  // Sticky nav: смена стиля при скролле (dark → light)
  const [navScrolled, setNavScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [form, setForm] = useState<FormState>({
    name: "",
    company: "",
    contact: "",
    team: "5-20",
    note: "",
  });
  const [sent, setSent] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Пока эндпоинта нет — показываем локальное состояние успеха.
    setSent(true);
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 15px",
    border: "1px solid rgba(var(--line-rgb),.14)",
    borderRadius: 10,
    background: "var(--card)",
    color: "var(--ink)",
    fontFamily: "inherit",
    fontSize: 15,
    outline: "none",
  };
  const labelCap: CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "var(--muted)",
    marginBottom: 8,
  };
  const sectionLabel = (text: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
      <span style={{ width: 22, height: 1, background: "rgba(var(--line-rgb),.30)" }} />
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {text}
      </span>
    </div>
  );

  const navInk = navScrolled ? "#0d2758" : "#ffffff";
  const navMuted = navScrolled ? "rgba(13,39,88,.72)" : "rgba(255,255,255,.78)";

  return (
    <div className="qadam-landing">
      {/* NAV — fixed сверху, меняет стиль при скролле */}
      <div
        className={`qadam-nav ${navScrolled ? "qadam-nav-scrolled" : ""}`}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: navScrolled ? "rgba(255,255,255,0.92)" : "transparent",
          backdropFilter: navScrolled ? "saturate(140%) blur(10px)" : "none",
          WebkitBackdropFilter: navScrolled ? "saturate(140%) blur(10px)" : "none",
          borderBottom: navScrolled ? "1px solid rgba(13,39,88,.08)" : "1px solid transparent",
          transition: "background .28s ease, border-color .28s ease, backdrop-filter .28s ease",
        }}
      >
        <div
          style={{
            maxWidth: 1440,
            margin: "0 auto",
            padding: "0 56px",
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            height: 72,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifySelf: "start" }}>
            {LOGO_SVG(26, navInk)}
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: navInk,
                transition: "color .28s ease",
              }}
            >
              Qadam
            </span>
          </div>
          <div
            className="qadam-hide-mobile"
            style={{ display: "flex", alignItems: "center", gap: 28, justifySelf: "center" }}
          >
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                style={{
                  fontSize: 15,
                  color: navMuted,
                  transition: "color .28s ease",
                }}
              >
                {l.label}
              </a>
            ))}
          </div>
          <Link
            to="/login"
            style={{
              justifySelf: "end",
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 500,
              color: navScrolled ? "#ffffff" : "#0d2758",
              background: navScrolled ? "#0d2758" : "#ffffff",
              borderRadius: 999,
              transition: "background .28s ease, color .28s ease",
            }}
          >
            Войти
          </Link>
        </div>
      </div>

      <div
        className="qadam-container"
        style={{ maxWidth: 1440, margin: "0 auto", overflow: "hidden", padding: "0 56px" }}
      >

        {/* HERO */}
        <div
          style={{
            position: "relative",
            padding: "120px 0 0",
            textAlign: "center",
          }}
        >
          {/* Dark navy base — брендовый тёмно-синий */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: "0 -56px 0",
              background: "#0a1f47",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          {/* Photo layer — атмосферная текстура поверх navy */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: "0 -56px 0",
              backgroundImage: "url(/hero.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center 30%",
              opacity: 0.3,
              filter: "saturate(0.35) brightness(0.75)",
              mixBlendMode: "overlay",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          {/* Navy overlay — держит контраст под белый текст, снизу → к white */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: "0 -56px 0",
              background:
                "linear-gradient(180deg, rgba(10,31,71,0.55) 0%, rgba(10,31,71,0.35) 35%, rgba(10,31,71,0.15) 65%, rgba(255,255,255,0.85) 92%, #ffffff 100%)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          {/* Brand blue glow — акцентное свечение сверху */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: "0 -56px 0",
              background:
                "radial-gradient(ellipse 55% 40% at 50% 22%, rgba(15,103,253,0.28), transparent 68%)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          <div style={{ position: "relative", maxWidth: 820, margin: "0 auto", zIndex: 1 }}>
            <h1
              className="qadam-h1"
              style={{
                margin: "0 0 20px",
                fontSize: 62,
                lineHeight: 1.04,
                fontWeight: 500,
                letterSpacing: "-0.042em",
                color: "#ffffff",
                textWrap: "balance" as CSSProperties["textWrap"],
              }}
            >
              Порядок в задачах с первого дня.
            </h1>
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 40,
                height: 1,
                margin: "6px 0 22px",
                background: "rgba(255,255,255,.35)",
              }}
            />
            <p
              style={{
                margin: "0 auto",
                maxWidth: 520,
                fontSize: 19,
                lineHeight: 1.55,
                color: "rgba(255,255,255,.78)",
              }}
            >
              Задачи, роли, отчёты и ИИ-помощник — в одном спокойном месте.
            </p>
            <div
              style={{
                marginTop: 36,
                display: "inline-flex",
                alignItems: "center",
                gap: 24,
              }}
            >
              <a
                href="#cta"
                style={{
                  display: "inline-block",
                  padding: "15px 28px",
                  fontSize: 15,
                  fontWeight: 500,
                  color: "#ffffff",
                  background: "#0f67fd",
                  borderRadius: 999,
                }}
              >
                Начать →
              </a>
              <a
                href="#how"
                style={{
                  fontSize: 15,
                  color: "#ffffff",
                  borderBottom: "1px solid rgba(255,255,255,.38)",
                  paddingBottom: 3,
                }}
              >
                Как это работает
              </a>
            </div>
          </div>

          {/* app peek */}
          <div className="qadam-app-peek-wrap">
            <div
              className="qadam-app-peek"
              style={{
                position: "relative",
                margin: "88px auto 0",
                zIndex: 1,
                width: 1080,
                border: "1px solid rgba(var(--line-rgb),.10)",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                background: "var(--surface-2)",
                overflow: "hidden",
                textAlign: "left",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div style={{ display: "flex" }}>
                <div
                  style={{
                    width: 210,
                    flexShrink: 0,
                    borderRight: "1px solid rgba(var(--line-rgb),.08)",
                    background: "var(--surface-2)",
                    padding: "14px 10px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "0 8px 16px",
                    }}
                  >
                    {LOGO_SVG(20)}
                    <span
                      style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-2)" }}
                    >
                      Qadam
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "7px 10px",
                      borderRadius: 8,
                      background: "var(--accent-soft)",
                      color: "var(--accent-ink)",
                      fontSize: 13,
                    }}
                  >
                    Dashboard
                  </div>
                  {["Проекты", "Задачи", "Аналитика", "Пользователи", "Настройки"].map((l) => (
                    <div
                      key={l}
                      style={{ padding: "7px 10px", fontSize: 13, color: "var(--faint)" }}
                    >
                      {l}
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      height: 52,
                      padding: "0 16px",
                      borderBottom: "1px solid rgba(var(--line-rgb),.08)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flex: 1,
                        maxWidth: 360,
                        padding: "7px 10px",
                        border: "1px solid rgba(var(--line-rgb),.10)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--faint-2)",
                      }}
                    >
                      Поиск по всему CRM…
                      <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                        {["⌘", "K"].map((k) => (
                          <span
                            key={k}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              height: 18,
                              padding: "0 5px",
                              border: "1px solid rgba(var(--line-rgb),.12)",
                              borderRadius: 4,
                              fontFamily: "ui-monospace,monospace",
                              fontSize: 9,
                            }}
                          >
                            {k}
                          </span>
                        ))}
                      </span>
                    </div>
                    <span
                      style={{
                        marginLeft: "auto",
                        position: "relative",
                        display: "inline-flex",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 15,
                          height: 15,
                          borderRadius: 4,
                          border: "2px solid var(--faint-2)",
                          borderTopColor: "transparent",
                        }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          right: -5,
                          top: -5,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: 15,
                          minWidth: 15,
                          padding: "0 4px",
                          borderRadius: 999,
                          background: "var(--accent)",
                          color: "#fff",
                          fontSize: 9,
                          fontWeight: 600,
                        }}
                      >
                        3
                      </span>
                    </span>
                  </div>
                  <div style={{ padding: 20 }}>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 500,
                        color: "var(--ink)",
                        marginBottom: 4,
                      }}
                    >
                      Dashboard
                    </div>
                    <div
                      style={{ fontSize: 13, color: "var(--faint-2)", marginBottom: 18 }}
                    >
                      Обзор задач и активности
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4,1fr)",
                        gap: 10,
                        marginBottom: 12,
                      }}
                    >
                      {[
                        { l: "Всего задач", v: "248", c: "var(--ink)" },
                        { l: "В работе", v: "63", c: "var(--info)" },
                        { l: "Завершены", v: "154", c: "var(--ok)" },
                        { l: "Просрочены", v: "9", c: "var(--danger)" },
                      ].map((m) => (
                        <div
                          key={m.l}
                          style={{
                            border: "1px solid rgba(var(--line-rgb),.09)",
                            borderRadius: 16,
                            background: "var(--card-2)",
                            padding: 14,
                            boxShadow: "var(--soft)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--faint-2)",
                              marginBottom: 6,
                            }}
                          >
                            {m.l}
                          </div>
                          <div
                            className="tnum"
                            style={{ fontSize: 22, fontWeight: 500, color: m.c }}
                          >
                            {m.v}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        border: "1px solid rgba(var(--line-rgb),.09)",
                        borderRadius: 16,
                        background: "var(--card-2)",
                        padding: 16,
                        boxShadow: "var(--soft)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}
                        >
                          Задачи по статусам
                        </span>
                        <span style={{ fontSize: 11, color: "var(--faint-2)" }}>
                          Всего 248
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          height: 10,
                          borderRadius: 999,
                          overflow: "hidden",
                          background: "rgba(var(--line-rgb),.08)",
                        }}
                      >
                        {[
                          { w: "16%", b: "var(--faint)" },
                          { w: "25%", b: "#0ea5e9" },
                          { w: "9%", b: "#f59e0b" },
                          { w: "44%", b: "#10b981" },
                          { w: "6%", b: "#f43f5e" },
                        ].map((s, i) => (
                          <div key={i} style={{ width: s.w, background: s.b }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SPLIT: KANBAN — full-width светло-голубая панель */}
        <div
          id="product"
          className="qadam-reveal"
          style={{ position: "relative", padding: "120px 0 100px", overflow: "hidden" }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: "calc(50% - 50vw)",
              right: "calc(50% - 50vw)",
              background: "#f4f7fd",
              zIndex: 0,
            }}
          />
          {/* Ambient brand blobs — фон «дышит», не выглядит плоско-белым */}
          <span
            aria-hidden
            className="qadam-blob-a"
            style={{
              position: "absolute",
              top: "-8%",
              left: "-6%",
              width: 560,
              height: 560,
              background: "radial-gradient(circle, rgba(15,103,253,0.10), transparent 70%)",
              filter: "blur(60px)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          <span
            aria-hidden
            className="qadam-blob-b"
            style={{
              position: "absolute",
              top: "20%",
              right: "-8%",
              width: 520,
              height: 520,
              background: "radial-gradient(circle, rgba(251,191,36,0.10), transparent 70%)",
              filter: "blur(60px)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          {/* Плавающие стикеры — монотонные оттенки бренда */}
          <span
            aria-hidden
            className="qadam-sticker-a"
            style={{
              position: "absolute",
              top: 42,
              left: "8%",
              width: 84,
              height: 84,
              background: "#dbe6fb",
              borderRadius: 6,
              boxShadow: "0 8px 22px -8px rgba(13,39,88,0.16)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          <span
            aria-hidden
            className="qadam-sticker-b"
            style={{
              position: "absolute",
              top: 24,
              right: "10%",
              width: 78,
              height: 78,
              background: "#c9d9f7",
              borderRadius: 6,
              boxShadow: "0 8px 22px -8px rgba(13,39,88,0.16)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          <span
            aria-hidden
            className="qadam-sticker-c"
            style={{
              position: "absolute",
              top: 84,
              right: "22%",
              width: 66,
              height: 66,
              background: "#e5edfc",
              borderRadius: 6,
              boxShadow: "0 8px 22px -8px rgba(13,39,88,0.16)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          <div
            className="qadam-grid-2"
            style={{
              position: "relative",
              zIndex: 1,
              maxWidth: 1080,
              margin: "0 auto",
              display: "grid",
              gridTemplateColumns: "340px 1fr",
              border: "1px solid rgba(var(--line-rgb),.10)",
              borderRadius: 16,
              overflow: "hidden",
              background: "var(--surface)",
              boxShadow: "var(--soft)",
            }}
          >
            <div
              className="qadam-split-left"
              style={{
                padding: "34px 32px",
                borderRight: "1px solid rgba(var(--line-rgb),.10)",
              }}
            >
              {sectionLabel("Задачи")}
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 500,
                  lineHeight: 1.14,
                  letterSpacing: "-0.03em",
                  color: "var(--ink)",
                  marginBottom: 28,
                }}
              >
                Статус меняется мышкой
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {[
                  { t: "Kanban и календарь", active: true },
                  { t: "Комментарии и файлы" },
                  { t: "Уведомления сразу" },
                ].map((r) => (
                  <div
                    key={r.t}
                    style={{
                      padding: "13px 0 13px 16px",
                      borderLeft: `2px solid rgba(var(--line-rgb),${r.active ? ".55" : ".10"})`,
                      fontSize: 16,
                      color: r.active ? "var(--ink)" : "var(--faint)",
                    }}
                  >
                    {r.t}
                  </div>
                ))}
              </div>
            </div>
            <div
              className="qadam-kanban"
              style={{
                padding: "24px 0 24px 24px",
                overflow: "hidden",
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", gap: 10 }}>
                {/* Новая */}
                <KanbanColumn title="Новая" count={3} dot="var(--faint)">
                  <KanbanCard title="Согласовать смету" chip="Средний" />
                  <KanbanCard title="Документы к тендеру" />
                </KanbanColumn>
                {/* В работе (highlighted) */}
                <KanbanColumn
                  title="В работе"
                  count={4}
                  dot="var(--spark)"
                  highlighted
                >
                  <div
                    style={{
                      border: "1px solid rgba(var(--line-rgb),.22)",
                      borderRadius: 12,
                      background: "var(--card-4)",
                      padding: 11,
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 8 }}>
                      Отчёт для заказчика
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          padding: "2px 7px",
                          borderRadius: 999,
                          background: "rgba(var(--line-rgb),.08)",
                          color: "var(--text-2)",
                          fontSize: 10,
                        }}
                      >
                        Высокий
                      </span>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          borderRadius: 999,
                          background: "rgba(var(--line-rgb),.14)",
                          color: "var(--ink-3)",
                          fontSize: 8,
                          fontWeight: 600,
                        }}
                      >
                        АС
                      </span>
                    </div>
                  </div>
                </KanbanColumn>
                {/* На проверке */}
                <KanbanColumn title="На проверке" count={2} dot="var(--spark-2)">
                  <KanbanCard title="Договор с поставщиком" />
                  <KanbanCard title="Правки по логотипу" />
                </KanbanColumn>
                {/* Завершена */}
                <KanbanColumn title="Завершена" count={9} dot="var(--spark-2)">
                  <KanbanCard title="Заявка «Тау Строй»" />
                </KanbanColumn>
              </div>
            </div>
          </div>
        </div>

        {/* FEATURES — 4 icon-card плитки, как у Slack */}
        <div className="qadam-reveal" style={{ padding: "110px 0 0" }}>
          <div style={{ maxWidth: 1080, margin: "0 auto" }}>
            {sectionLabel("Возможности")}
            <div style={{ maxWidth: 560, marginBottom: 40 }}>
              <h2
                className="qadam-h2"
                style={{
                  margin: 0,
                  fontSize: 42,
                  lineHeight: 1.1,
                  fontWeight: 500,
                  letterSpacing: "-0.035em",
                  color: "var(--ink)",
                }}
              >
                Всё, что нужно команде
              </h2>
            </div>
            <div
              className="qadam-grid-features"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 16,
              }}
            >
              {[
                {
                  t: "Задачи и канбан",
                  d: "Kanban, календарь, комментарии, файлы.",
                  icon: (
                    <>
                      <rect x="3" y="4" width="4" height="14" rx="1.5" />
                      <rect x="10" y="4" width="4" height="9" rx="1.5" />
                      <rect x="17" y="4" width="4" height="17" rx="1.5" />
                    </>
                  ),
                },
                {
                  t: "Роли и права",
                  d: "Гибкие роли, приглашения, аудит.",
                  icon: (
                    <>
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6" />
                    </>
                  ),
                },
                {
                  t: "Отчёты и аналитика",
                  d: "SLA, загрузка людей, узкие места.",
                  icon: (
                    <>
                      <path d="M3 3v18h18" />
                      <path d="M7 15l4-4 3 3 5-6" />
                    </>
                  ),
                },
                {
                  t: "ИИ-помощник",
                  d: "Разбивает задачи, подсказывает срок.",
                  icon: (
                    <>
                      <path d="M12 2l2.4 5.4L20 8.6l-4 3.9.9 5.7L12 15.5 7.1 18.2 8 12.5l-4-3.9 5.6-1.2z" />
                    </>
                  ),
                },
              ].map((f) => (
                <div
                  key={f.t}
                  className="qadam-feature-card"
                  style={{
                    padding: 22,
                    border: "1px solid rgba(var(--line-rgb),.10)",
                    borderRadius: 16,
                    background: "var(--surface)",
                    transition:
                      "transform .22s ease, box-shadow .22s ease, border-color .22s ease",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: "#eef4ff",
                      marginBottom: 16,
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#0f67fd"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {f.icon}
                    </svg>
                  </div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 500,
                      color: "var(--ink)",
                      marginBottom: 6,
                    }}
                  >
                    {f.t}
                  </div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--faint)" }}>
                    {f.d}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI */}
        <div
          id="ai"
          className="qadam-reveal"
          style={{ position: "relative", padding: "120px 0 0", overflow: "hidden" }}
        >
          <div style={{ position: "relative", maxWidth: 1080, margin: "0 auto" }}>
            {sectionLabel("ИИ-помощник")}
            <div style={{ maxWidth: 620, marginBottom: 40 }}>
              <h2
                className="qadam-h2"
                style={{
                  margin: "0 0 14px",
                  fontSize: 42,
                  lineHeight: 1.1,
                  fontWeight: 500,
                  letterSpacing: "-0.035em",
                  color: "var(--ink)",
                }}
              >
                Помощник, который знает контекст задачи
              </h2>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "var(--muted)" }}>
                Разбивает задачу на шаги и подсказывает реальный срок.
              </p>
            </div>

            <div
              className="qadam-grid-2"
              style={{
                border: "1px solid rgba(var(--line-rgb),.10)",
                borderRadius: 16,
                background: "var(--surface)",
                overflow: "hidden",
                display: "grid",
                gridTemplateColumns: "1fr 380px",
                boxShadow: "var(--soft)",
              }}
            >
              <div
                style={{
                  padding: 24,
                  borderRight: "1px solid rgba(var(--line-rgb),.08)",
                }}
              >
                <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 12 }}>
                  Задача · Qadam / Объекты
                </div>
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 500,
                    color: "var(--ink)",
                    marginBottom: 8,
                  }}
                >
                  Подготовить отчёт для заказчика
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                  {["В работе", "Высокий", "до 24.08"].map((c) => (
                    <span
                      key={c}
                      style={{
                        padding: "3px 9px",
                        borderRadius: 999,
                        background: "rgba(var(--line-rgb),.07)",
                        fontSize: 11,
                        color: "var(--text-2)",
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 10 }}>
                  Шаги от ИИ
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <AiStep title="Собрать акты за июль" who="Мария К." done />
                  <AiStep title="Сверить суммы со сметой" who="Данияр О." done />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "11px 12px",
                      border: "1px dashed rgba(var(--line-rgb),.18)",
                      borderRadius: 12,
                      background: "rgba(var(--line-rgb),.02)",
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        border: "1.5px solid rgba(var(--line-rgb),.25)",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      Сформировать сводку и отправить
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 16,
                    height: 5,
                    borderRadius: 999,
                    background: "rgba(var(--line-rgb),.08)",
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: "62%",
                      background: "rgba(var(--line-rgb),.45)",
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  padding: 20,
                  background: "var(--surface-2)",
                  borderLeft: "1px solid rgba(var(--line-rgb),.08)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: "rgba(var(--line-rgb),.08)",
                      fontSize: 12,
                      color: "var(--ink-2)",
                    }}
                  >
                    ✦
                  </span>
                  <span
                    style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}
                  >
                    Помощник Qadam
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--dim)" }}>
                    в задаче
                  </span>
                </div>
                <div
                  style={{
                    padding: "11px 12px",
                    borderRadius: "12px 12px 12px 4px",
                    background: "rgba(var(--line-rgb),.05)",
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "var(--text)",
                  }}
                >
                  Разбил на 3 шага. Похожая задача в июне заняла 4 дня - советую срок
                  26.08.
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 2,
                  }}
                >
                  {["Разбить на шаги", "Оценить срок", "Итоги недели"].map((c) => (
                    <span
                      key={c}
                      style={{
                        padding: "6px 10px",
                        border: "1px solid rgba(var(--line-rgb),.12)",
                        borderRadius: 999,
                        fontSize: 11,
                        color: "var(--text-2)",
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 12px",
                    border: "1px solid rgba(var(--line-rgb),.10)",
                    borderRadius: 10,
                    fontSize: 12,
                    color: "var(--dim)",
                  }}
                >
                  Спросить о задаче…
                  <span
                    style={{
                      marginLeft: "auto",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "rgba(var(--line-rgb),.12)",
                      fontSize: 11,
                      color: "var(--ink-2)",
                    }}
                  >
                    ↑
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* HOW — soft warm panel */}
        <div
          id="how"
          className="qadam-reveal"
          style={{ position: "relative", padding: "120px 0 110px", overflow: "hidden" }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: "calc(50% - 50vw)",
              right: "calc(50% - 50vw)",
              background: "#eaf0fa",
              zIndex: 0,
            }}
          />
          <div style={{ position: "relative", zIndex: 1, maxWidth: 1080, margin: "0 auto" }}>
            {sectionLabel("Внедрение")}
            <div style={{ maxWidth: 560, marginBottom: 40 }}>
              <h2
                className="qadam-h2"
                style={{
                  margin: "0 0 14px",
                  fontSize: 42,
                  lineHeight: 1.1,
                  fontWeight: 500,
                  letterSpacing: "-0.035em",
                  color: "var(--ink)",
                }}
              >
                Запуск за один день
              </h2>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "var(--muted)" }}>
                Без внедренцев и курсов.
              </p>
            </div>
            <div
              className="qadam-grid-3"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 0,
                border: "1px solid rgba(var(--line-rgb),.10)",
                borderRadius: 16,
                overflow: "hidden",
                background: "var(--surface)",
                boxShadow: "var(--soft)",
              }}
            >
              {[
                { t: "Регистрируем компанию", d: "Пространство и роли — 10 минут." },
                { t: "Переносим задачи", d: "Импорт из CSV, приглашения по email." },
                { t: "Смотрим, где зависает", d: "Аналитика покажет узкие места." },
              ].map((s, i, arr) => (
                <div
                  key={s.t}
                  className="qadam-how-cell"
                  style={{
                    padding: "30px 28px",
                    borderRight:
                      i < arr.length - 1
                        ? "1px solid rgba(var(--line-rgb),.10)"
                        : undefined,
                  }}
                >
                  <div
                    style={{
                      fontSize: 19,
                      fontWeight: 500,
                      color: "var(--ink)",
                      marginBottom: 8,
                    }}
                  >
                    {s.t}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 15,
                      lineHeight: 1.6,
                      color: "var(--faint)",
                    }}
                  >
                    {s.d}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>


        {/* CTA — full-width dark navy panel */}
        <div
          id="cta"
          className="qadam-reveal"
          style={{
            position: "relative",
            padding: "140px 0 110px",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: "calc(50% - 50vw)",
              right: "calc(50% - 50vw)",
              background: "#0a1f47",
              zIndex: 0,
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -100,
              left: "50%",
              transform: "translateX(-50%)",
              width: 720,
              height: 420,
              background:
                "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(15,103,253,0.35), transparent 68%)",
              filter: "blur(40px)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          <div style={{ position: "relative", zIndex: 1, maxWidth: 680, margin: "0 auto" }}>
            <h2
              className="qadam-h2"
              style={{
                margin: "0 0 14px",
                fontSize: 48,
                lineHeight: 1.06,
                fontWeight: 500,
                letterSpacing: "-0.04em",
                color: "#ffffff",
              }}
            >
              Покажем на ваших задачах
            </h2>
            <p
              style={{
                margin: "0 auto 36px",
                maxWidth: 480,
                fontSize: 17,
                lineHeight: 1.6,
                color: "rgba(255,255,255,.78)",
              }}
            >
              Оставьте заявку — вернёмся в тот же день.
            </p>

            <form
              onSubmit={submit}
              style={{
                border: "1px solid rgba(var(--line-rgb),.12)",
                borderRadius: 18,
                background: "var(--surface)",
                padding: 28,
                textAlign: "left",
                boxShadow: "var(--soft)",
              }}
            >
              <div
                className="qadam-grid-2-form"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                <label style={{ display: "block" }}>
                  <span style={labelCap}>Имя</span>
                  <input
                    type="text"
                    placeholder="Айгерим"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <span style={labelCap}>Компания</span>
                  <input
                    type="text"
                    placeholder="Qadam"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    style={inputStyle}
                  />
                </label>
              </div>
              <div
                className="qadam-grid-2-form"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                <label style={{ display: "block" }}>
                  <span style={labelCap}>Телефон или email</span>
                  <input
                    type="text"
                    placeholder="+7 700 000 00 00"
                    value={form.contact}
                    onChange={(e) => setForm({ ...form, contact: e.target.value })}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <span style={labelCap}>Сколько сотрудников</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["5-20", "20-50", "50+"] as const).map((v) => {
                      const active = form.team === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setForm({ ...form, team: v })}
                          style={{
                            flex: 1,
                            textAlign: "center",
                            padding: "11px 0",
                            border: `1px solid rgba(var(--line-rgb),${active ? ".45" : ".12"})`,
                            borderRadius: 10,
                            background: active ? "rgba(var(--line-rgb),.06)" : "transparent",
                            fontSize: 13,
                            color: active ? "var(--ink)" : "var(--muted)",
                            fontFamily: "inherit",
                            cursor: "pointer",
                          }}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                </label>
              </div>
              <label style={{ display: "block", marginBottom: 18 }}>
                <span style={labelCap}>Задача</span>
                <textarea
                  rows={2}
                  placeholder="Задачи теряются в чатах…"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  style={{ ...inputStyle, resize: "none", lineHeight: 1.5 }}
                />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <button
                  type="submit"
                  disabled={sent}
                  style={{
                    padding: "14px 28px",
                    fontSize: 15,
                    fontWeight: 500,
                    color: "var(--btn-fg)",
                    background: "var(--btn-bg)",
                    borderRadius: 999,
                    border: "none",
                    cursor: sent ? "default" : "pointer",
                    fontFamily: "inherit",
                    opacity: sent ? 0.75 : 1,
                  }}
                >
                  {sent ? "Спасибо, свяжемся!" : "Отправить заявку"}
                </button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  Или в Telegram — быстрее.
                </span>
              </div>
            </form>
          </div>
        </div>

        {/* FOOTER — крупный, с soft-панелью */}
        <div
          style={{
            position: "relative",
            marginTop: 0,
            padding: "72px 0 32px",
            overflow: "hidden",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: "calc(50% - 50vw)",
              right: "calc(50% - 50vw)",
              background: "#f4f7fd",
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 1,
              maxWidth: 1080,
              margin: "0 auto",
            }}
          >
            <div
              className="qadam-grid-2"
              style={{
                display: "grid",
                gridTemplateColumns: "1.3fr 1fr 1fr 1fr",
                gap: 40,
                marginBottom: 56,
              }}
            >
              <div style={{ maxWidth: 300 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 14,
                  }}
                >
                  {LOGO_SVG(28)}
                  <span
                    style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}
                  >
                    Qadam CRM
                  </span>
                </div>
                <p
                  style={{
                    margin: "0 0 20px",
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "var(--muted)",
                  }}
                >
                  Порядок в задачах, ролях и отчётах. Для команд, которые растут.
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <a
                    href="mailto:hello@qadam.kz"
                    aria-label="Email"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: "#ffffff",
                      border: "1px solid rgba(var(--line-rgb),.10)",
                      color: "var(--ink-2)",
                      fontSize: 13,
                    }}
                  >
                    ✉
                  </a>
                  <a
                    href="tel:+77000000000"
                    aria-label="Phone"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: "#ffffff",
                      border: "1px solid rgba(var(--line-rgb),.10)",
                      color: "var(--ink-2)",
                      fontSize: 13,
                    }}
                  >
                    ☎
                  </a>
                </div>
              </div>
              <FooterCol
                title="Продукт"
                items={[
                  { href: "#product", label: "Возможности" },
                  { href: "#how", label: "Как это работает" },
                  { href: "#ai", label: "ИИ-помощник" },
                ]}
              />
              <FooterCol
                title="Компания"
                items={[
                  { href: "#cta", label: "Оставить заявку" },
                  { href: "/login", label: "Войти" },
                ]}
              />
              <FooterCol
                title="Связь"
                items={[
                  { href: "mailto:hello@qadam.kz", label: "hello@qadam.kz" },
                  { href: "tel:+77000000000", label: "+7 700 000 00 00" },
                ]}
              />
            </div>
            <div
              style={{
                borderTop: "1px solid rgba(var(--line-rgb),.10)",
                paddingTop: 24,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "var(--muted)",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <span>© 2026 Qadam CRM. Все права защищены.</span>
              <span>Политика конфиденциальности · Условия</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({
  title,
  count,
  dot,
  highlighted,
  children,
}: {
  title: string;
  count: number;
  dot: string;
  highlighted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: 190,
        flexShrink: 0,
        border: `1px solid rgba(var(--line-rgb),${highlighted ? ".14" : ".09"})`,
        borderRadius: 16,
        background: highlighted ? "rgba(var(--line-rgb),.03)" : "var(--surface-2)",
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 4px 4px" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 9px",
            borderRadius: 999,
            background: `rgba(var(--line-rgb),${highlighted ? ".10" : ".07"})`,
            fontSize: 11,
            color: highlighted ? "var(--ink-3)" : "var(--text)",
          }}
        >
          <span
            style={{ width: 5, height: 5, borderRadius: 999, background: dot }}
          />
          {title}
        </span>
        <span
          className="tnum"
          style={{ fontSize: 11, color: "var(--faint-2)" }}
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function KanbanCard({ title, chip }: { title: string; chip?: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(var(--line-rgb),.09)",
        borderRadius: 12,
        background: "var(--card-3)",
        padding: 11,
        boxShadow: "var(--soft)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-2)",
          marginBottom: chip ? 8 : 0,
        }}
      >
        {title}
      </div>
      {chip && (
        <span
          style={{
            padding: "2px 7px",
            borderRadius: 999,
            background: "rgba(var(--line-rgb),.08)",
            color: "var(--text-2)",
            fontSize: 10,
          }}
        >
          {chip}
        </span>
      )}
    </div>
  );
}

function AiStep({ title, who, done }: { title: string; who: string; done?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 12px",
        border: "1px solid rgba(var(--line-rgb),.09)",
        borderRadius: 12,
        background: "var(--card-3)",
        boxShadow: "var(--soft)",
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: done ? "rgba(var(--line-rgb),.55)" : "transparent",
          border: done ? "none" : "1.5px solid rgba(var(--line-rgb),.25)",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, color: "var(--text)" }}>{title}</span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--dim)" }}>{who}</span>
    </div>
  );
}

function FooterCol({
  title,
  items,
}: {
  title: string;
  items: { href: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {title}
      </div>
      {items.map((i) => (
        <a key={i.label} href={i.href} style={{ fontSize: 14 }}>
          {i.label}
        </a>
      ))}
    </div>
  );
}
