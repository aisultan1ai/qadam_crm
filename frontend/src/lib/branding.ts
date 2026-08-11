/**
 * Применяет primary_color tenant'а как CSS-переменные --brand-*.
 * Используется в Layout — вызывается при загрузке `me.current_tenant`.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

function mix(a: number, b: number, t: number) {
  return Math.round(a * (1 - t) + b * t);
}

export function applyBrandColor(hex: string | null | undefined) {
  const root = document.documentElement;
  if (!hex) {
    // Возвращаем дефолт (indigo из tailwind.config).
    const defaults: Record<string, string> = {
      "--brand-50": "#eef2ff",
      "--brand-500": "#6366f1",
      "--brand-600": "#4f46e5",
      "--brand-700": "#4338ca",
    };
    for (const [k, v] of Object.entries(defaults)) root.style.setProperty(k, v);
    return;
  }
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const toHex = (r: number, g: number, b: number) =>
    "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

  // 600 = базовый; 700 темнее, 500 светлее, 50 очень светлый
  root.style.setProperty("--brand-600", toHex(rgb.r, rgb.g, rgb.b));
  root.style.setProperty("--brand-700", toHex(mix(rgb.r, 0, 0.2), mix(rgb.g, 0, 0.2), mix(rgb.b, 0, 0.2)));
  root.style.setProperty("--brand-500", toHex(mix(rgb.r, 255, 0.12), mix(rgb.g, 255, 0.12), mix(rgb.b, 255, 0.12)));
  root.style.setProperty("--brand-50", toHex(mix(rgb.r, 255, 0.9), mix(rgb.g, 255, 0.9), mix(rgb.b, 255, 0.9)));
}
