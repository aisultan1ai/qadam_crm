/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        // Pickolab-inspired violet palette (Qadam brand adaptation).
        brand: {
          50: "#F3EFFF",
          100: "#E4DBFF",
          200: "#CBB8FF",
          300: "#B196FF",
          400: "#9678FF",
          500: "#7C5CFF",
          600: "#6B47F5",
          700: "#5A38DB",
          800: "#4826B0",
          900: "#2E1780",
          950: "#1A0C4B",
        },
        ink: "#0A0A12",
        muted: "#6B7280",
        surface: {
          DEFAULT: "#ffffff",
          muted: "#F7F7FA",
          dark: "#0F0F14",
          darkMuted: "#17171F",
        },
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 2px 8px -2px rgb(0 0 0 / 0.06)",
      },
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.15rem",
      },
      transitionTimingFunction: {
        "out-soft": "cubic-bezier(.2,.8,.2,1)",
        "in-sharp": "cubic-bezier(.4,0,1,1)",
        draw: "cubic-bezier(.4,0,.2,1)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        "slide-up": {
          "0%": { opacity: 0, transform: "translateY(6px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "none" },
        },
        pop: {
          "0%": { opacity: "0", transform: "scale(.4)" },
          "62%": { transform: "scale(1.10)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        draw: { to: { strokeDashoffset: "0" } },
        shake: {
          "12%,88%": { transform: "translateX(-2px)" },
          "24%,76%": { transform: "translateX(3px)" },
          "36%,60%": { transform: "translateX(-6px)" },
          "48%,72%": { transform: "translateX(6px)" },
          "100%": { transform: "none" },
        },
        breathe: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: ".45" },
        },
        ping2: {
          "0%": { transform: "scale(1)", opacity: ".55" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        settle: {
          "0%": { transform: "scale(1.05)" },
          "100%": { transform: "none" },
        },
        cardOut: {
          to: { opacity: "0", transform: "translateY(-10px) scale(1.04)" },
        },
        driftA: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(6%,-5%,0) scale(1.15)" },
        },
        driftB: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1.1)" },
          "50%": { transform: "translate3d(-7%,6%,0) scale(.95)" },
        },
      },
      animation: {
        "fade-in": "fade-in .18s ease-out",
        "slide-up": "slide-up .22s ease-out",
        rise: "rise .52s cubic-bezier(.2,.8,.2,1) both",
        pop: "pop .42s cubic-bezier(.2,.8,.2,1) both",
        shake: "shake .48s cubic-bezier(.36,.07,.19,.97) both",
        breathe: "breathe 2s ease-in-out infinite",
        ping2: "ping2 .9s cubic-bezier(0,0,.2,1) both",
        settle: "settle .42s cubic-bezier(.2,.8,.2,1) both",
        "card-out": "cardOut .38s cubic-bezier(.4,0,1,1) both",
        "drift-a": "driftA 16s ease-in-out infinite",
        "drift-b": "driftB 21s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
