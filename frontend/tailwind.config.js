/** @type {import('tailwindcss').Config} */

// Qadam design system — «Graphite & Cobalt».
// Brand-шкала идёт через CSS-переменные (RGB-каналы), чтобы tenant-брендинг
// (src/lib/branding.ts) реально перекрашивал интерфейс.
const brandVar = (step) => `rgb(var(--brand-${step}) / <alpha-value>)`;
const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Единая холодная графитовая шкала. zinc/neutral/gray/slate/stone указывают на неё,
// чтобы старые классы по всему проекту давали один и тот же оттенок серого.
const graphite = {
  50: "#F6F7F9",
  100: "#EEF0F3",
  200: "#E1E4E9",
  300: "#CBD0D8",
  400: "#979EAA",
  500: "#697180",
  600: "#4C5462",
  700: "#373D48",
  800: "#252A32",
  900: "#171A20",
  950: "#0D0F13",
};

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"IBM Plex Sans"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        brand: Object.fromEntries(BRAND_STEPS.map((s) => [s, brandVar(s)])),
        zinc: graphite,
        neutral: graphite,
        gray: graphite,
        slate: graphite,
        stone: graphite,
        ink: "#0D0F13",
        muted: "#697180",
        surface: {
          DEFAULT: "#ffffff",
          muted: "#F6F7F9",
          dark: "#0D0F13",
          darkMuted: "#14171C",
        },
        sidebar: {
          DEFAULT: "#12151B",
          hover: "#1B1F27",
          line: "#232830",
        },
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(13 15 19 / 0.05)",
        pop: "0 8px 24px -8px rgb(13 15 19 / 0.18), 0 2px 6px -2px rgb(13 15 19 / 0.08)",
      },
      borderRadius: {
        // Строже: контейнеры 10–12px, контролы 8px.
        xl: "0.625rem",
        "2xl": "0.75rem",
        "3xl": "1rem",
      },
      transitionTimingFunction: {
        "out-soft": "cubic-bezier(.2,.8,.2,1)",
        "in-sharp": "cubic-bezier(.4,0,1,1)",
        draw: "cubic-bezier(.4,0,.2,1)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        "slide-up": {
          "0%": { opacity: 0, transform: "translateY(4px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        pop: {
          "0%": { opacity: "0", transform: "scale(.6)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        draw: { to: { strokeDashoffset: "0" } },
        shake: {
          "12%,88%": { transform: "translateX(-1px)" },
          "24%,76%": { transform: "translateX(2px)" },
          "36%,60%": { transform: "translateX(-4px)" },
          "48%,72%": { transform: "translateX(4px)" },
          "100%": { transform: "none" },
        },
        breathe: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: ".5" },
        },
        ping2: {
          "0%": { transform: "scale(1)", opacity: ".5" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        settle: {
          "0%": { transform: "scale(1.03)" },
          "100%": { transform: "none" },
        },
        cardOut: {
          to: { opacity: "0", transform: "translateY(-6px)" },
        },
        driftA: {
          "0%,100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(0,0,0)" },
        },
        driftB: {
          "0%,100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(0,0,0)" },
        },
      },
      animation: {
        "fade-in": "fade-in .15s ease-out",
        "slide-up": "slide-up .18s ease-out",
        rise: "rise .32s cubic-bezier(.2,.8,.2,1) both",
        pop: "pop .24s cubic-bezier(.2,.8,.2,1) both",
        shake: "shake .4s cubic-bezier(.36,.07,.19,.97) both",
        breathe: "breathe 1.6s ease-in-out infinite",
        ping2: "ping2 .9s cubic-bezier(0,0,.2,1) both",
        settle: "settle .3s cubic-bezier(.2,.8,.2,1) both",
        "card-out": "cardOut .3s cubic-bezier(.4,0,1,1) both",
        "drift-a": "driftA 16s ease-in-out infinite",
        "drift-b": "driftB 21s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
