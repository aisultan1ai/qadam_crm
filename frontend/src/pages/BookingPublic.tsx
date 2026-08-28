import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarDays, Clock, Check, ArrowLeft, Loader2 } from "lucide-react";
import { api, extractApiError } from "@/api/client";

type PageInfo = {
  tenant_name: string;
  tenant_slug: string;
  title: string;
  description: string | null;
  color: string;
  duration_min: number;
  timezone: string;
  questions: Array<{ key: string; label: string; type: string; required: boolean }>;
  slug: string;
  min_notice_hours: number;
  max_days_ahead: number;
};

type Slot = { start: string; end: string };

type BookingResult = {
  id: number;
  status: string;
  start_at: string;
  end_at: string;
  cancel_url: string;
};

function formatDayHeader(dt: Date, tz: string): string {
  return dt.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  });
}

function formatSlotTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

function formatFull(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

export default function BookingPublic() {
  const { tenantSlug, pageSlug } = useParams<{ tenantSlug: string; pageSlug: string }>();
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState<{ name: string; email: string; phone: string; answers: Record<string, string> }>({
    name: "",
    email: "",
    phone: "",
    answers: {},
  });
  const [result, setResult] = useState<BookingResult | null>(null);

  const { data: info, isPending: infoLoading, error: infoError } = useQuery({
    enabled: !!tenantSlug && !!pageSlug,
    queryKey: ["booking-public-info", tenantSlug, pageSlug],
    queryFn: async () =>
      (await api.get<PageInfo>(`/api/public/book/${tenantSlug}/${pageSlug}`)).data,
    retry: false,
  });

  useEffect(() => {
    // Заголовок вкладки
    if (info) document.title = `${info.title} — ${info.tenant_name}`;
  }, [info]);

  const { data: slots, isPending: slotsLoading } = useQuery({
    enabled: !!info && !selectedSlot,
    queryKey: ["booking-public-slots", tenantSlug, pageSlug],
    queryFn: async () =>
      (
        await api.get<Slot[]>(`/api/public/book/${tenantSlug}/${pageSlug}/slots`)
      ).data,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Выберите слот");
      return (
        await api.post<BookingResult>(
          `/api/public/book/${tenantSlug}/${pageSlug}/bookings`,
          {
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim() || null,
            start_at: selectedSlot.start,
            answers: form.answers,
          },
        )
      ).data;
    },
    onSuccess: (data) => setResult(data),
  });

  const slotsByDay = useMemo(() => {
    if (!slots || !info) return [];
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = new Date(s.start).toLocaleDateString("ru-RU", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: info.timezone,
      });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).map(([key, arr]) => ({
      key,
      date: new Date(arr[0].start),
      slots: arr,
    }));
  }, [slots, info]);

  if (infoLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Loader2 size={20} className="animate-spin text-neutral-400" />
      </div>
    );
  }

  if (infoError || !info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="max-w-md text-center">
          <div className="text-2xl font-semibold text-neutral-700">Страница не найдена</div>
          <div className="mt-2 text-sm text-neutral-500">
            Проверьте ссылку — возможно бронирование отключено или адрес неверный.
          </div>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
        <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: `${info.color}22`, color: info.color }}
          >
            <Check size={28} />
          </div>
          <h1 className="text-2xl font-semibold">Готово!</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Встреча забронирована на{" "}
            <b>{formatFull(result.start_at, info.timezone)}</b> ({info.timezone}).
          </p>
          <p className="mt-3 text-xs text-neutral-500">
            Мы отправили подтверждение на {form.email}. Чтобы отменить встречу — используйте
            ссылку из письма.
          </p>
          <a
            href={result.cancel_url}
            className="mt-4 inline-block text-xs text-neutral-400 underline hover:text-neutral-600"
          >
            Отменить сейчас
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-4 dark:bg-neutral-950">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 pt-4 text-center">
          <div className="text-sm text-neutral-500">{info.tenant_name}</div>
          <h1 className="mt-1 text-3xl font-semibold" style={{ color: info.color }}>
            {info.title}
          </h1>
          {info.description && (
            <p className="mx-auto mt-2 max-w-xl text-sm text-neutral-600 dark:text-neutral-400">
              {info.description}
            </p>
          )}
          <div className="mt-3 flex items-center justify-center gap-3 text-xs text-neutral-500">
            <span className="flex items-center gap-1"><Clock size={12} /> {info.duration_min} мин</span>
            <span className="flex items-center gap-1"><CalendarDays size={12} /> {info.timezone}</span>
          </div>
        </header>

        {!selectedSlot ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slotsLoading && (
              <div className="col-span-full py-12 text-center text-neutral-500">
                <Loader2 size={16} className="mx-auto animate-spin" />
              </div>
            )}
            {!slotsLoading && slotsByDay.length === 0 && (
              <div className="col-span-full py-12 text-center text-sm text-neutral-500">
                Нет доступных слотов в ближайшее время. Попробуйте позже.
              </div>
            )}
            {slotsByDay.map((day) => (
              <div key={day.key} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {formatDayHeader(day.date, info.timezone)}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {day.slots.map((s) => (
                    <button
                      key={s.start}
                      onClick={() => setSelectedSlot(s)}
                      className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm hover:border-brand-400 hover:bg-brand-50 dark:border-neutral-700 dark:hover:bg-brand-950/30"
                    >
                      {formatSlotTime(s.start, info.timezone)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow dark:border-neutral-800 dark:bg-neutral-900">
            <button
              onClick={() => setSelectedSlot(null)}
              className="mb-3 flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
            >
              <ArrowLeft size={13} /> Выбрать другое время
            </button>
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Выбрано</div>
              <div className="mt-1 text-base font-semibold" style={{ color: info.color }}>
                {formatFull(selectedSlot.start, info.timezone)}
              </div>
              <div className="text-xs text-neutral-500">({info.timezone}, {info.duration_min} мин)</div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (form.name.trim() && form.email.trim()) submit.mutate();
              }}
              className="space-y-3"
            >
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-500">Имя *</span>
                <input
                  className="input"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-500">Email *</span>
                <input
                  type="email"
                  className="input"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-500">Телефон</span>
                <input
                  className="input"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
              {(info.questions ?? []).map((q) => (
                <label key={q.key} className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-500">
                    {q.label} {q.required && "*"}
                  </span>
                  {q.type === "textarea" ? (
                    <textarea
                      className="input min-h-[80px]"
                      required={q.required}
                      value={form.answers[q.key] || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, answers: { ...f.answers, [q.key]: e.target.value } }))
                      }
                    />
                  ) : (
                    <input
                      className="input"
                      required={q.required}
                      value={form.answers[q.key] || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, answers: { ...f.answers, [q.key]: e.target.value } }))
                      }
                    />
                  )}
                </label>
              ))}
              {submit.isError && (
                <div className="rounded bg-rose-50 p-2 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                  {extractApiError(submit.error).message}
                </div>
              )}
              <button
                type="submit"
                className="btn-primary w-full"
                disabled={!form.name.trim() || !form.email.trim() || submit.isPending}
                style={{ background: info.color }}
              >
                {submit.isPending ? <Loader2 size={14} className="animate-spin" /> : "Забронировать"}
              </button>
            </form>
          </div>
        )}

        <footer className="mt-8 pb-6 text-center text-xs text-neutral-400">
          Powered by Qadam CRM
        </footer>
      </div>
    </div>
  );
}
