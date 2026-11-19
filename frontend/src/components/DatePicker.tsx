/**
 * Единый выбор даты: ввод в формате ДД.ММ.ГГГГ (независимо от языка браузера),
 * календарь месяца с понедельника, быстрые кнопки и (опционально) время ЧЧ:ММ.
 *
 * Значения совместимы с прежними нативными полями, чтобы не менять контракты API:
 *  - дата:        "YYYY-MM-DD" (как <input type="date">);
 *  - дата+время:  "YYYY-MM-DDTHH:mm" в местном времени (как <input type="datetime-local">);
 *  - пусто:       "".
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { addDays, addMonths, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover } from "@/components/Popover";

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /T(\d{2}):(\d{2})/;

function toIsoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** "YYYY-MM-DD..." → Date (местная полночь) или null. */
function parseIsoDate(v: string | null | undefined): Date | null {
  const m = v ? ISO_DATE_RE.exec(v) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoToRu(v: string | null | undefined): string {
  const d = parseIsoDate(v);
  return d ? format(d, "dd.MM.yyyy") : "";
}

function timeOf(v: string | null | undefined): string {
  const m = v ? TIME_RE.exec(v) : null;
  return m ? `${m[1]}:${m[2]}` : "";
}

/** Маска ДД.ММ.ГГГГ: оставляем цифры и расставляем точки. */
function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}

/** "ДД.ММ.ГГГГ" или "ДД.ММ.ГГ" → "YYYY-MM-DD" или null, если даты нет в календаре. */
function parseRu(text: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return toIsoDate(d);
}

function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** "9", "09", "930", "09:30" → "09:30" или null. */
function parseTime(text: string): string | null {
  const d = text.replace(/\D/g, "");
  if (!d) return null;
  let h: number;
  let mi: number;
  if (d.length <= 2) {
    h = Number(d);
    mi = 0;
  } else if (d.length === 3) {
    h = Number(d.slice(0, 1));
    mi = Number(d.slice(1));
  } else {
    h = Number(d.slice(0, 2));
    mi = Number(d.slice(2, 4));
  }
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

export type DatePickerProps = {
  /** "YYYY-MM-DD", а с withTime — "YYYY-MM-DDTHH:mm"; пусто — "" / null. */
  value: string | null | undefined;
  onChange: (value: string) => void;
  /** Показать отдельное поле времени ЧЧ:ММ. */
  withTime?: boolean;
  /** Время, которое подставляется при выборе даты без времени. */
  defaultTime?: string;
  /** Значение со временем (для API), но поле времени не показывать — выбор только по дате. */
  hideTime?: boolean;
  /** Границы выбора, "YYYY-MM-DD". */
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  "aria-label"?: string;
};

export function DatePicker({
  value,
  onChange,
  withTime = false,
  defaultTime = "09:00",
  hideTime = false,
  min,
  max,
  disabled,
  clearable = true,
  id,
  className,
  inputClassName,
  autoFocus,
  onBlur,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => isoToRu(value));
  const [timeText, setTimeText] = useState(() => timeOf(value));
  // Последнее отданное наружу значение: родитель (например, сохранение на сервер)
  // может обновить value не сразу — не шлём одно и то же дважды (ввод + blur).
  const lastRef = useRef<string>(value ?? "");

  // Внешнее изменение значения — обновляем текст полей.
  useEffect(() => {
    lastRef.current = value ?? "";
    setText(isoToRu(value));
    if (withTime) setTimeText(timeOf(value));
  }, [value, withTime]);

  const emit = (isoDate: string | null, time?: string) => {
    let next = "";
    if (isoDate) {
      next = withTime ? `${isoDate}T${hideTime ? defaultTime : time ?? (parseTime(timeText) || defaultTime)}` : isoDate;
    }
    if (next === lastRef.current) return;
    lastRef.current = next;
    onChange(next);
  };

  const outOfRange = (iso: string) => (min && iso < min) || (max && iso > max);

  const commitText = () => {
    const t = text.trim();
    if (!t) {
      emit(null);
      return;
    }
    const iso = parseRu(t);
    if (iso && !outOfRange(iso)) {
      setText(isoToRu(iso));
      emit(iso);
    } else {
      setText(isoToRu(lastRef.current)); // неверная дата — возвращаем прежнюю
    }
  };

  const commitTime = () => {
    const t = parseTime(timeText);
    if (!t) {
      setTimeText(timeOf(lastRef.current));
      return;
    }
    setTimeText(t);
    const iso = lastRef.current.slice(0, 10);
    if (iso) emit(iso, t);
  };

  const openCalendar = () => {
    if (disabled) return;
    setOpen((v) => !v);
  };

  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div ref={anchorRef} className="relative min-w-0 flex-1">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={clsx("input pr-14 tabular-nums", inputClassName)}
          placeholder="ДД.ММ.ГГГГ"
          aria-label={ariaLabel}
          value={text}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => {
            const masked = maskDate(e.target.value);
            setText(masked);
            if (masked.length === 10) {
              const iso = parseRu(masked);
              if (iso && !outOfRange(iso)) emit(iso);
            }
          }}
          onBlur={() => {
            commitText();
            onBlur?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            } else if (e.key === "ArrowDown" && e.altKey) {
              e.preventDefault();
              openCalendar();
            }
          }}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {clearable && value && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => emit(null)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-white/5"
              title="Очистить"
              aria-label="Очистить дату"
            >
              <X size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={openCalendar}
            disabled={disabled}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-not-allowed dark:hover:bg-white/5"
            title="Открыть календарь"
            aria-label="Открыть календарь"
            aria-expanded={open}
          >
            <CalendarDays size={15} />
          </button>
        </div>
      </div>

      {withTime && !hideTime && (
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={clsx("input w-[76px] shrink-0 text-center tabular-nums", inputClassName)}
          placeholder="ЧЧ:ММ"
          aria-label={ariaLabel ? `${ariaLabel}: время` : "Время"}
          value={timeText}
          disabled={disabled}
          onChange={(e) => {
            const masked = maskTime(e.target.value);
            setTimeText(masked);
            if (masked.length === 5) {
              const t = parseTime(masked);
              const iso = lastRef.current.slice(0, 10);
              if (t && iso) emit(iso, t);
            }
          }}
          onBlur={() => {
            commitTime();
            onBlur?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTime();
            }
          }}
        />
      )}

      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={272}>
        <DateCalendar
          value={value}
          min={min}
          max={max}
          onPick={(iso) => {
            emit(iso);
            setOpen(false);
          }}
          onClear={
            clearable
              ? () => {
                  emit(null);
                  setOpen(false);
                }
              : undefined
          }
        />
      </Popover>
    </div>
  );
}

/**
 * Сетка месяца (с понедельника) + быстрые кнопки. Отдельно — для встраивания
 * в уже открытые поповеры (вложенный поповер закрыл бы родительский).
 */
export function DateCalendar({
  value,
  onPick,
  onClear,
  min,
  max,
  quick = true,
}: {
  value: string | null | undefined;
  onPick: (isoDate: string) => void;
  onClear?: () => void;
  min?: string;
  max?: string;
  quick?: boolean;
}) {
  const selected = parseIsoDate(value);
  const [month, setMonth] = useState<Date>(() => startOfMonth(selected ?? new Date()));
  const days = useMemo(() => {
    const first = startOfWeek(month, { weekStartsOn: 1 });
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);
  const today = new Date();
  const outOfRange = (iso: string) => (min && iso < min) || (max && iso > max);
  const pick = (d: Date) => {
    const iso = toIsoDate(d);
    if (!outOfRange(iso)) onPick(iso);
  };

  return (
    <div className="p-1.5">
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth((m) => addMonths(m, -1))}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
          aria-label="Предыдущий месяц"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-[13px] font-semibold">
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </div>
        <button
          type="button"
          onClick={() => setMonth((m) => addMonths(m, 1))}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
          aria-label="Следующий месяц"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={clsx("py-1 text-[11px] font-medium", i >= 5 ? "text-rose-400" : "text-zinc-400")}>
            {w}
          </div>
        ))}
        {days.map((d) => {
          const iso = toIsoDate(d);
          const isSel = !!selected && isSameDay(d, selected);
          const isToday = isSameDay(d, today);
          return (
            <button
              key={iso}
              type="button"
              disabled={!!outOfRange(iso)}
              onClick={() => pick(d)}
              className={clsx(
                "h-8 rounded-md text-[13px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                isSel
                  ? "bg-brand-600 font-semibold text-white"
                  : isToday
                    ? "font-semibold text-brand-700 ring-1 ring-inset ring-brand-300 hover:bg-brand-50 dark:text-brand-300 dark:ring-brand-500/40 dark:hover:bg-brand-500/10"
                    : isSameMonth(d, month)
                      ? "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-white/5"
                      : "text-zinc-400 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-white/5",
              )}
              aria-label={format(d, "dd.MM.yyyy")}
              aria-pressed={isSel}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      {(quick || onClear) && (
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          {quick &&
            [
              { label: "Сегодня", days: 0 },
              { label: "Завтра", days: 1 },
              { label: "+1 неделя", days: 7 },
            ].map((q) => {
              const d = addDays(new Date(), q.days);
              return (
                <button
                  key={q.label}
                  type="button"
                  disabled={!!outOfRange(toIsoDate(d))}
                  onClick={() => pick(d)}
                  className="rounded-md px-2 py-1 text-xs text-brand-700 hover:bg-brand-50 disabled:opacity-40 dark:text-brand-300 dark:hover:bg-brand-500/10"
                >
                  {q.label}
                </button>
              );
            })}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="ml-auto rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
            >
              Очистить
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default DatePicker;
