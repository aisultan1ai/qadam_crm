import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "@/store/theme";
import "./landing.css";

const LOGO_SVG = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 512 512" aria-label="Qadam CRM">
    <path
      d="M256 90 a150 150 0 1 0 0.1 0 Z M256 130 a110 110 0 1 1 -0.1 0 Z"
      fill="var(--ink)"
      fillRule="evenodd"
    />
    <path d="M372 300 L409 399 L330 360 Z" fill="var(--ink)" />
    <rect x="274" y="176" width="80" height="60" rx="12" fill="var(--logo-1)" />
    <rect x="224" y="228" width="80" height="60" rx="12" fill="var(--logo-2)" />
    <g fill="var(--ink)">
      <rect x="184" y="278" width="70" height="50" rx="12" />
      <path d="M249 296 L318 340 L199 328 Z" />
    </g>
  </svg>
);

const NAV_LINKS = [
  { href: "#product", label: "Продукт" },
  { href: "#how", label: "Как это работает" },
  { href: "#ai", label: "ИИ-помощник" },
  { href: "#faq", label: "FAQ" },
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
  const { theme, toggle } = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    const prev = document.title;
    document.title = "Qadam CRM — Порядок в задачах с первого дня";
    return () => {
      document.title = prev;
    };
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
    padding: "11px 13px",
    border: "1px solid rgba(var(--line-rgb),.12)",
    borderRadius: 10,
    background: "var(--card)",
    color: "var(--ink)",
    fontFamily: "inherit",
    fontSize: 14,
    outline: "none",
  };
  const labelCap: CSSProperties = {
    display: "block",
    fontSize: 10,
    letterSpacing: ".10em",
    textTransform: "uppercase",
    color: "var(--dim)",
    marginBottom: 8,
  };
  const sectionLabel = (text: string, badge?: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
      <span style={{ width: 18, height: 1, background: "rgba(var(--line-rgb),.30)" }} />
      <span
        style={{
          fontSize: 11,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "var(--dim)",
        }}
      >
        {text}
      </span>
      {badge && (
        <span
          style={{
            padding: "3px 9px",
            border: "1px solid rgba(var(--line-rgb),.14)",
            borderRadius: 999,
            fontSize: 10,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: "var(--faint)",
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );

  return (
    <div className={`qadam-landing ${isLight ? "light-theme" : ""}`}>
      <div
        className="qadam-container"
        style={{ maxWidth: 1440, margin: "0 auto", overflow: "hidden", padding: "0 56px" }}
      >
        {/* NAV */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 80,
            marginLeft: -56,
            marginRight: -56,
            padding: "0 56px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {LOGO_SVG(26)}
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Qadam</span>
          </div>
          <div
            className="qadam-hide-mobile"
            style={{ display: "flex", alignItems: "center", gap: 28, margin: "0 auto" }}
          >
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} style={{ fontSize: 14 }}>
                {l.label}
              </a>
            ))}
          </div>
          <button
            onClick={toggle}
            type="button"
            aria-label="Сменить тему"
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              width: 58,
              height: 28,
              marginLeft: "auto",
              marginRight: 14,
              padding: 3,
              boxSizing: "border-box",
              border: "1px solid rgba(var(--line-rgb),.16)",
              borderRadius: 999,
              cursor: "pointer",
              background: "transparent",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 3,
                left: 3,
                width: 26,
                height: 20,
                borderRadius: 999,
                background: "rgba(var(--line-rgb),.10)",
                transform: "translateX(var(--sw-x))",
                transition: "transform .24s cubic-bezier(.2,.8,.2,1)",
              }}
            />
            <span
              style={{
                position: "relative",
                width: 26,
                textAlign: "center",
                fontSize: 11,
                color: "var(--sw-moon)",
              }}
            >
              ☾
            </span>
            <span
              style={{
                position: "relative",
                width: 26,
                textAlign: "center",
                fontSize: 11,
                color: "var(--sw-sun)",
              }}
            >
              ☀
            </span>
          </button>
          <Link
            to="/login"
            style={{
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--btn-fg)",
              background: "var(--btn-bg)",
              borderRadius: 999,
            }}
          >
            Log in
          </Link>
        </div>

        {/* HERO */}
        <div
          style={{
            position: "relative",
            padding: "96px 0 0",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          <span
            className="qadam-anim-beam"
            aria-hidden
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              width: 520,
              height: 420,
              transform: "translateX(-50%)",
              background: "var(--glow-beam)",
              filter: "blur(20px)",
              pointerEvents: "none",
            }}
          />
          <span
            className="qadam-anim-arc"
            aria-hidden
            style={{
              position: "absolute",
              left: "50%",
              top: 300,
              width: 900,
              height: 900,
              transform: "translateX(-50%)",
              borderRadius: 999,
              border: "1px solid rgba(var(--line-rgb),.16)",
              background: "var(--glow-arc)",
              pointerEvents: "none",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: "50%",
              top: 340,
              width: 640,
              height: 640,
              transform: "translateX(-50%)",
              borderRadius: 999,
              border: "1px solid rgba(var(--line-rgb),.10)",
              pointerEvents: "none",
            }}
          />
          {[
            { c: "qadam-anim-twinkle-a", l: "18%", t: "26%", bg: "var(--spark)" },
            { c: "qadam-anim-twinkle-b", l: "78%", t: "20%", bg: "var(--spark)" },
            { c: "qadam-anim-twinkle-c", l: "30%", t: "46%", bg: "var(--spark-2)" },
            { c: "qadam-anim-twinkle-d", l: "70%", t: "52%", bg: "var(--spark-2)" },
          ].map((s, i) => (
            <span
              key={i}
              className={s.c}
              aria-hidden
              style={{
                position: "absolute",
                left: s.l,
                top: s.t,
                width: 2,
                height: 2,
                borderRadius: 999,
                background: s.bg,
              }}
            />
          ))}

          <div style={{ position: "relative", maxWidth: 820, margin: "0 auto" }}>
            <h1
              className="qadam-h1"
              style={{
                margin: "0 0 20px",
                fontSize: 62,
                lineHeight: 1.04,
                fontWeight: 500,
                letterSpacing: "-0.042em",
                color: "var(--ink)",
                textWrap: "balance" as CSSProperties["textWrap"],
              }}
            >
              Порядок в задачах -<br />с первого дня
            </h1>
            <p
              style={{
                margin: "0 auto",
                maxWidth: 470,
                fontSize: 16,
                lineHeight: 1.6,
                color: "var(--muted-2)",
              }}
            >
              Задачи, роли, отчёты и ИИ-помощник - в одной системе.
            </p>
            <a
              href="#cta"
              style={{
                display: "inline-block",
                marginTop: 32,
                padding: "13px 24px",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--btn-fg)",
                background: "var(--btn-bg)",
                borderRadius: 999,
              }}
            >
              Узнать стоимость
            </a>
          </div>

          {/* app peek */}
          <div className="qadam-app-peek-wrap">
            <div
              className="qadam-app-peek"
              style={{
                position: "relative",
                margin: "64px auto 0",
                width: 1080,
                border: "1px solid rgba(var(--line-rgb),.12)",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                background: "var(--surface-2)",
                overflow: "hidden",
                textAlign: "left",
                boxShadow: "var(--glow-peek)",
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
                        className="qadam-anim-pulse"
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
                      <span
                        className="qadam-anim-ring"
                        style={{
                          position: "absolute",
                          right: -5,
                          top: -5,
                          width: 15,
                          height: 15,
                          borderRadius: 999,
                          background: "var(--accent-ring)",
                        }}
                      />
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

        {/* SPLIT: KANBAN */}
        <div id="product" style={{ padding: "120px 0 0" }}>
          <div
            className="qadam-grid-2"
            style={{
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
                  fontSize: 27,
                  fontWeight: 500,
                  lineHeight: 1.14,
                  letterSpacing: "-0.03em",
                  color: "var(--ink)",
                  marginBottom: 26,
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
                      padding: "12px 0 12px 14px",
                      borderLeft: `2px solid rgba(var(--line-rgb),${r.active ? ".55" : ".10"})`,
                      fontSize: 14,
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
                    className="qadam-anim-slide"
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

        {/* AI */}
        <div id="ai" style={{ position: "relative", padding: "120px 0 0", overflow: "hidden" }}>
          <div style={{ position: "relative", maxWidth: 1080, margin: "0 auto" }}>
            {sectionLabel("ИИ-помощник", "в разработке")}
            <div style={{ maxWidth: 540, marginBottom: 32 }}>
              <h2
                className="qadam-h2"
                style={{
                  margin: "0 0 12px",
                  fontSize: 36,
                  lineHeight: 1.1,
                  fontWeight: 500,
                  letterSpacing: "-0.035em",
                  color: "var(--ink)",
                }}
              >
                Помощник, который знает контекст задачи
              </h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
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
                    className="qadam-anim-float"
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
                    <span
                      style={{ marginLeft: "auto", display: "inline-flex", gap: 3 }}
                    >
                      <span
                        className="qadam-anim-typing-a"
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 999,
                          background: "var(--spark-2)",
                        }}
                      />
                      <span
                        className="qadam-anim-typing-b"
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 999,
                          background: "var(--spark-2)",
                        }}
                      />
                      <span
                        className="qadam-anim-typing-c"
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 999,
                          background: "var(--spark-2)",
                        }}
                      />
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

        {/* HOW */}
        <div id="how" style={{ position: "relative", padding: "120px 0 0", overflow: "hidden" }}>
          <span
            aria-hidden
            className="qadam-anim-drift"
            style={{
              position: "absolute",
              left: "50%",
              top: "40%",
              width: 900,
              height: 400,
              transform: "translateX(-50%)",
              background: "var(--glow-soft)",
              filter: "blur(40px)",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative", maxWidth: 1080, margin: "0 auto" }}>
            {sectionLabel("Внедрение")}
            <div style={{ maxWidth: 480, marginBottom: 36 }}>
              <h2
                className="qadam-h2"
                style={{
                  margin: "0 0 12px",
                  fontSize: 36,
                  lineHeight: 1.1,
                  fontWeight: 500,
                  letterSpacing: "-0.035em",
                  color: "var(--ink)",
                }}
              >
                Запуск за один день
              </h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
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
                { n: "01", t: "Регистрируем компанию", d: "Пространство и роли - 10 минут." },
                { n: "02", t: "Переносим задачи", d: "Импорт из CSV, приглашения по email." },
                { n: "03", t: "Смотрим, где зависает", d: "Аналитика покажет узкие места." },
              ].map((s, i, arr) => (
                <div
                  key={s.n}
                  className="qadam-how-cell"
                  style={{
                    padding: "26px 24px",
                    borderRight:
                      i < arr.length - 1
                        ? "1px solid rgba(var(--line-rgb),.10)"
                        : undefined,
                  }}
                >
                  <div
                    className="tnum"
                    style={{ fontSize: 12, color: "var(--dim)", marginBottom: 14 }}
                  >
                    {s.n}
                  </div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 500,
                      color: "var(--ink)",
                      marginBottom: 6,
                    }}
                  >
                    {s.t}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
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

        {/* FAQ */}
        <div id="faq" style={{ padding: "96px 0 0" }}>
          <div
            className="qadam-grid-2"
            style={{
              maxWidth: 1080,
              margin: "0 auto",
              display: "grid",
              gridTemplateColumns: "320px 1fr",
              gap: 56,
            }}
          >
            <div>
              {sectionLabel("Вопросы")}
              <h2
                className="qadam-h2"
                style={{
                  margin: "0 0 10px",
                  fontSize: 32,
                  lineHeight: 1.12,
                  fontWeight: 500,
                  letterSpacing: "-0.035em",
                  color: "var(--ink)",
                }}
              >
                Частые вопросы
              </h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--faint)" }}>
                Ответим текстом, а не звонком.
              </p>
            </div>
            <div>
              <FaqItem
                q="Сколько стоит?"
                a="По числу сотрудников и размещению. Расчёт - в тот же день."
              />
              <FaqItem
                q="Как переехать с таблиц?"
                a="Импортом из CSV - первый перенос делаем вместе."
              />
              <FaqItem
                q="Можно на свой сервер?"
                a="Да, Docker Compose в вашей сети."
              />
              <FaqItem q="Работает с телефона?" a="Да, интерфейс адаптивный." />
            </div>
          </div>
        </div>

        {/* CTA */}
        <div
          id="cta"
          style={{
            position: "relative",
            padding: "140px 0 0",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: "50%",
              top: 60,
              width: 2,
              height: 120,
              transform: "translateX(-50%)",
              background: "var(--beam-line)",
              pointerEvents: "none",
            }}
          />
          <span
            aria-hidden
            className="qadam-anim-arc-9"
            style={{
              position: "absolute",
              left: "50%",
              top: 120,
              width: 700,
              height: 420,
              transform: "translateX(-50%)",
              background: "var(--glow-cta)",
              filter: "blur(40px)",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative", maxWidth: 680, margin: "0 auto" }}>
            <h2
              className="qadam-h2"
              style={{
                margin: "0 0 12px",
                fontSize: 42,
                lineHeight: 1.06,
                fontWeight: 500,
                letterSpacing: "-0.04em",
                color: "var(--ink)",
              }}
            >
              Покажем на ваших задачах
            </h2>
            <p
              style={{
                margin: "0 auto 32px",
                maxWidth: 420,
                fontSize: 15,
                lineHeight: 1.6,
                color: "var(--muted)",
              }}
            >
              Оставьте заявку - вернёмся в тот же день.
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
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <button
                  type="submit"
                  disabled={sent}
                  style={{
                    padding: "12px 24px",
                    fontSize: 14,
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
                <span style={{ fontSize: 12, color: "var(--dim)" }}>
                  Или в Telegram - быстрее.
                </span>
              </div>
            </form>
          </div>
        </div>

        {/* FOOTER */}
        <div
          style={{
            marginTop: 120,
            borderTop: "1px solid rgba(var(--line-rgb),.08)",
            padding: "40px 0 36px",
          }}
        >
          <div
            className="qadam-grid-2"
            style={{
              maxWidth: 1080,
              margin: "0 auto",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 60,
              flexWrap: "wrap",
            }}
          >
            <div style={{ maxWidth: 260 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 10,
                }}
              >
                {LOGO_SVG(22)}
                <span
                  style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}
                >
                  Qadam CRM
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--dim)" }}>
                Трекинг задач компании.
              </p>
            </div>
            <div style={{ display: "flex", gap: 64, flexWrap: "wrap" }}>
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
                  { href: "#faq", label: "FAQ" },
                ]}
              />
              <FooterCol
                title="Связь"
                items={[
                  { href: "mailto:hello@qadam.kz", label: "hello@qadam.kz" },
                  { href: "#faq", label: "Telegram" },
                  { href: "tel:+77000000000", label: "+7 700 000 00 00" },
                ]}
              />
            </div>
          </div>
          <div
            style={{
              maxWidth: 1080,
              margin: "32px auto 0",
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "var(--dim-2)",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span>© 2026 Qadam CRM</span>
            <span>Политика конфиденциальности · Условия</span>
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

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        borderBottom: "1px solid rgba(var(--line-rgb),.09)",
        padding: "16px 0",
      }}
    >
      <summary
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          fontSize: 15,
          color: "var(--ink)",
        }}
      >
        {q}
        <span style={{ color: "var(--faint-2)" }}>{open ? "−" : "+"}</span>
      </summary>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 13,
          lineHeight: 1.65,
          color: "var(--faint)",
        }}
      >
        {a}
      </p>
    </details>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "var(--dim-2)",
        }}
      >
        {title}
      </div>
      {items.map((i) => (
        <a key={i.label} href={i.href} style={{ fontSize: 13 }}>
          {i.label}
        </a>
      ))}
    </div>
  );
}
