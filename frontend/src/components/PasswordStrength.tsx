import { useMemo } from "react";

type Level = 0 | 1 | 2 | 3 | 4;

const LABELS: Record<Level, string> = {
  0: "Очень слабый",
  1: "Слабый",
  2: "Средний",
  3: "Хороший",
  4: "Отличный",
};

const COLORS: Record<Level, string> = {
  0: "bg-rose-500",
  1: "bg-rose-500",
  2: "bg-amber-500",
  3: "bg-lime-500",
  4: "bg-emerald-500",
};

/**
 * Простой оценщик силы пароля (без внешних либ). Считает по:
 * - длине (>=8, >=12, >=16)
 * - наличию строчных, заглавных, цифр, спецсимволов
 * - штрафу за повторяющиеся паттерны и распространённые слова
 */
export function scorePassword(password: string): { level: Level; hints: string[] } {
  const hints: string[] = [];
  if (!password) return { level: 0, hints: ["Введите пароль"] };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-zа-яё]/.test(password)) score += 1;
  if (/[A-ZА-ЯЁ]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-zА-Яа-я0-9]/.test(password)) score += 1;

  // Штрафы
  if (/(.)\1{2,}/.test(password)) {
    score -= 1;
    hints.push("Избегайте повторяющихся символов");
  }
  if (/^[0-9]+$/.test(password) || /^[a-zа-я]+$/i.test(password)) {
    score -= 1;
    hints.push("Смешайте буквы, цифры и символы");
  }
  const common = ["password", "qwerty", "123456", "admin", "qadam", "letmein", "welcome"];
  if (common.some((w) => password.toLowerCase().includes(w))) {
    score -= 2;
    hints.push("Слишком очевидный пароль");
  }

  // Подсказки на минимумы
  if (password.length < 8) hints.push("Минимум 8 символов");
  if (!/[A-ZА-ЯЁ]/.test(password)) hints.push("Добавьте заглавную букву");
  if (!/\d/.test(password)) hints.push("Добавьте цифру");
  if (!/[^A-Za-zА-Яа-я0-9]/.test(password)) hints.push("Добавьте спецсимвол");

  const clamped = Math.max(0, Math.min(4, Math.floor(score / 2))) as Level;
  return { level: clamped, hints: hints.slice(0, 2) };
}

export function PasswordStrength({ password }: { password: string }) {
  const { level, hints } = useMemo(() => scorePassword(password), [password]);
  if (!password) return null;

  const label = LABELS[level];
  const color = COLORS[level];
  const filled = level + 1;

  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1" role="presentation">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < filled ? color : "bg-neutral-200 dark:bg-neutral-800"
            }`}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span
          className={
            level >= 3
              ? "text-emerald-600 dark:text-emerald-400"
              : level >= 2
                ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600 dark:text-rose-400"
          }
        >
          {label}
        </span>
        {hints.length > 0 && (
          <span className="text-neutral-500 dark:text-neutral-400">{hints.join(" · ")}</span>
        )}
      </div>
    </div>
  );
}
