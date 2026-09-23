/**
 * Применяет primary_color tenant'а как CSS-переменные --brand-50…950 (RGB-каналы).
 * Tailwind читает brand-* через rgb(var(--brand-N) / α), поэтому смена переменных
 * перекрашивает кнопки, ссылки, фокус и бейджи по всему приложению.
 * Используется в Layout — вызывается при загрузке `me.current_tenant`.
 */
type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

const mixTo = (c: RGB, target: number, t: number): RGB => ({
  r: Math.round(c.r * (1 - t) + target * t),
  g: Math.round(c.g * (1 - t) + target * t),
  b: Math.round(c.b * (1 - t) + target * t),
});

const channels = (c: RGB) => `${c.r} ${c.g} ${c.b}`;

// Шаг → (куда смешивать, насколько). 600 = цвет компании как есть.
const SCALE: Record<number, [number, number]> = {
  50: [255, 0.92],
  100: [255, 0.84],
  200: [255, 0.68],
  300: [255, 0.48],
  400: [255, 0.28],
  500: [255, 0.12],
  600: [255, 0],
  700: [0, 0.18],
  800: [0, 0.32],
  900: [0, 0.45],
  950: [0, 0.62],
};

export function applyBrandColor(hex: string | null | undefined) {
  const root = document.documentElement;
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) {
    // Возвращаем дефолт из src/index.css (Qadam cobalt).
    for (const step of Object.keys(SCALE)) root.style.removeProperty(`--brand-${step}`);
    return;
  }
  for (const [step, [target, t]] of Object.entries(SCALE)) {
    root.style.setProperty(`--brand-${step}`, channels(mixTo(rgb, target, t)));
  }
}
