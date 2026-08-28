import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar as BigCalendar, dateFnsLocalizer, View, Views } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { ru } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import clsx from "clsx";
import {
  Plus, Loader2, Trash2, Save, Copy, Users as UsersIcon, MapPin, Link as LinkIcon,
  Bell, Repeat, X as XIcon, ExternalLink,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";

const locales = { ru };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales,
});

// ============================================================================
// Types
// ============================================================================

type CalendarRow = {
  id: number;
  owner_id: number;
  name: string;
  color: string;
  is_visible: boolean;
  is_shared: boolean;
  ics_token: string | null;
};

type EventOcc = {
  id: string;
  event_id?: number;
  occurrence_start?: string;
  is_recurring?: boolean;
  is_master?: boolean;
  calendar_id?: number;
  calendar_name?: string | null;
  color?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  start: string;
  end: string;
  all_day?: boolean;
  kind?: string;
  task_id?: number;
};

type Participant = { user_id: number; status: string; is_organizer: boolean };
type Reminder = { id?: number; offset_minutes: number; kind: string };
type EventDetail = {
  id: number;
  calendar_id: number;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  kind: string;
  color: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  timezone: string;
  rrule: string | null;
  creator_id: number | null;
  participants: Participant[];
  reminders: Reminder[];
};

// ============================================================================
// Main
// ============================================================================

const RRULE_PRESETS = [
  { value: "", label: "Не повторять" },
  { value: "FREQ=DAILY", label: "Каждый день" },
  { value: "FREQ=DAILY;COUNT=5", label: "Ежедневно 5 раз" },
  { value: "FREQ=WEEKLY", label: "Каждую неделю" },
  { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "По будням" },
  { value: "FREQ=MONTHLY", label: "Каждый месяц" },
  { value: "FREQ=YEARLY", label: "Каждый год" },
];

const REMINDER_PRESETS = [
  { value: 0, label: "В момент начала" },
  { value: 5, label: "За 5 минут" },
  { value: 15, label: "За 15 минут" },
  { value: 30, label: "За 30 минут" },
  { value: 60, label: "За 1 час" },
  { value: 60 * 24, label: "За 1 день" },
];

export default function CalendarPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>(Views.WEEK);
  const [date, setDate] = useState(new Date());
  const [editorOpen, setEditorOpen] = useState<{ mode: "create" | "edit"; initial?: Partial<EventDetail> } | null>(null);
  const [detailsFor, setDetailsFor] = useState<EventOcc | null>(null);

  const { data: calendars } = useQuery({
    queryKey: ["calendars"],
    queryFn: async () => (await api.get<CalendarRow[]>("/api/calendar/calendars")).data,
    staleTime: 30_000,
  });

  const range = useMemo(() => {
    // Считаем разумный диапазон в зависимости от view
    const d = new Date(date);
    if (view === Views.MONTH || view === Views.AGENDA) {
      const s = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const e = new Date(d.getFullYear(), d.getMonth() + 2, 1);
      return { start: s, end: e };
    }
    if (view === Views.WEEK || view === Views.WORK_WEEK) {
      const day = d.getDay() || 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day - 1));
      const s = new Date(monday);
      s.setDate(monday.getDate() - 7);
      const e = new Date(monday);
      e.setDate(monday.getDate() + 21);
      return { start: s, end: e };
    }
    const s = new Date(d);
    s.setDate(d.getDate() - 2);
    const e = new Date(d);
    e.setDate(d.getDate() + 5);
    return { start: s, end: e };
  }, [view, date]);

  const visibleCalIds = useMemo(
    () => (calendars ?? []).filter((c) => c.is_visible).map((c) => c.id).join(","),
    [calendars],
  );

  const { data: events, isFetching } = useQuery({
    enabled: !!calendars,
    queryKey: ["calendar-events", range.start.toISOString(), range.end.toISOString(), visibleCalIds],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        include_tasks: true,
      };
      if (visibleCalIds) params.calendar_ids = visibleCalIds;
      return (await api.get<EventOcc[]>("/api/calendar/events", { params })).data;
    },
  });

  const bcEvents = useMemo(() => {
    return (events ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      start: new Date(e.start),
      end: new Date(e.end),
      allDay: !!e.all_day,
      resource: e,
    }));
  }, [events]);

  const patchCalendar = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<CalendarRow> }) =>
      (await api.patch(`/api/calendar/calendars/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendars"] }),
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const createCalendar = useMutation({
    mutationFn: async (body: { name: string; color: string }) =>
      (await api.post("/api/calendar/calendars", body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendars"] }),
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const handleSelectSlot = ({ start, end }: { start: Date; end: Date }) => {
    setEditorOpen({
      mode: "create",
      initial: {
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: false,
      },
    });
  };

  const handleSelectEvent = (evt: { resource: EventOcc }) => {
    const occ = evt.resource;
    if (occ.task_id) {
      navigate(`/tasks/${occ.task_id}`);
      return;
    }
    setDetailsFor(occ);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Календарь</h1>
          <p className="text-sm text-neutral-500">Встречи, события, дедлайны задач</p>
        </div>
        <button className="btn-primary" onClick={() => setEditorOpen({ mode: "create" })}>
          <Plus size={14} /> Новое событие
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[240px_1fr]">
        <CalendarSidebar
          calendars={calendars ?? []}
          onToggleVisible={(c) => patchCalendar.mutate({ id: c.id, body: { is_visible: !c.is_visible } })}
          onCreate={(name, color) => createCalendar.mutate({ name, color })}
          onShare={(c) => patchCalendar.mutate({ id: c.id, body: { is_shared: !c.is_shared } })}
          onCopyIcs={(c) => {
            const url = `${window.location.origin}/api/calendar/public/${c.ics_token}.ics`;
            navigator.clipboard.writeText(url);
            toast.success("ICS-ссылка скопирована");
          }}
        />

        <div className="relative min-h-0 overflow-hidden rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          {isFetching && (
            <div className="absolute right-3 top-3 z-10">
              <Loader2 size={14} className="animate-spin text-neutral-400" />
            </div>
          )}
          <BigCalendar
            localizer={localizer}
            events={bcEvents}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
            selectable
            onSelectSlot={handleSelectSlot}
            onSelectEvent={handleSelectEvent}
            popup
            eventPropGetter={(evt) => {
              const color = (evt.resource as EventOcc).color || "#7C5CFF";
              return {
                style: {
                  backgroundColor: color,
                  borderColor: color,
                  color: "#fff",
                  fontSize: 12,
                },
              };
            }}
            messages={{
              week: "Неделя", day: "День", month: "Месяц", agenda: "Список",
              today: "Сегодня", previous: "‹", next: "›",
              date: "Дата", time: "Время", event: "Событие",
              allDay: "Весь день", noEventsInRange: "В этом периоде событий нет",
              showMore: (n) => `+${n}`,
            }}
            style={{ height: "100%" }}
          />
        </div>
      </div>

      {editorOpen && (
        <EventEditor
          mode={editorOpen.mode}
          initial={editorOpen.initial}
          calendars={calendars ?? []}
          onClose={() => setEditorOpen(null)}
          onSaved={() => {
            setEditorOpen(null);
            qc.invalidateQueries({ queryKey: ["calendar-events"] });
          }}
        />
      )}

      {detailsFor && (
        <EventDetailsModal
          occurrence={detailsFor}
          onClose={() => setDetailsFor(null)}
          onEdit={(detail) => {
            setDetailsFor(null);
            setEditorOpen({ mode: "edit", initial: detail });
          }}
          onDeleted={() => {
            setDetailsFor(null);
            qc.invalidateQueries({ queryKey: ["calendar-events"] });
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sidebar
// ============================================================================

function CalendarSidebar({
  calendars, onToggleVisible, onCreate, onShare, onCopyIcs,
}: {
  calendars: CalendarRow[];
  onToggleVisible: (c: CalendarRow) => void;
  onCreate: (name: string, color: string) => void;
  onShare: (c: CalendarRow) => void;
  onCopyIcs: (c: CalendarRow) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7C5CFF");

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Календари</span>
        <button className="btn-ghost !p-1" onClick={() => setCreateOpen(true)} title="Новый календарь">
          <Plus size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {calendars.map((c) => (
          <div key={c.id} className="group flex items-center gap-2 rounded px-2 py-1.5">
            <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={c.is_visible}
                onChange={() => onToggleVisible(c)}
              />
              <span
                className="inline-block h-3 w-3 rounded"
                style={{ background: c.color }}
              />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
            </label>
            <button
              className={clsx(
                "rounded p-1 opacity-0 group-hover:opacity-100",
                c.is_shared && "text-emerald-500 opacity-100",
              )}
              title={c.is_shared ? "Скопировать ICS" : "Расшарить"}
              onClick={() => c.is_shared ? onCopyIcs(c) : onShare(c)}
            >
              {c.is_shared ? <Copy size={12} /> : <ExternalLink size={12} />}
            </button>
          </div>
        ))}
      </div>

      {createOpen && (
        <Modal open onClose={() => setCreateOpen(false)} title="Новый календарь" size="sm">
          <div className="space-y-3">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border"
              />
              <input className="input flex-1" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setCreateOpen(false)}>Отмена</button>
              <button
                className="btn-primary"
                disabled={!name.trim()}
                onClick={() => {
                  onCreate(name.trim(), color);
                  setName("");
                  setCreateOpen(false);
                }}
              >
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================================
// Event editor
// ============================================================================

function _toInput(iso: string | Date | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // datetime-local: YYYY-MM-DDTHH:mm (local time)
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

function _fromInput(v: string): string {
  return new Date(v).toISOString();
}

function EventEditor({
  mode,
  initial,
  calendars,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: Partial<EventDetail>;
  calendars: CalendarRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [calendarId, setCalendarId] = useState<number>(
    initial?.calendar_id ?? calendars.find((c) => !c.is_shared || c.owner_id === undefined)?.id ?? calendars[0]?.id ?? 0,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [startAt, setStartAt] = useState(_toInput(initial?.start_at ?? new Date().toISOString()));
  const [endAt, setEndAt] = useState(
    _toInput(initial?.end_at ?? new Date(Date.now() + 60 * 60_000).toISOString()),
  );
  const [allDay, setAllDay] = useState(!!initial?.all_day);
  const [rrule, setRrule] = useState(initial?.rrule ?? "");
  const [reminders, setReminders] = useState<Reminder[]>(initial?.reminders ?? [{ offset_minutes: 10, kind: "notification" }]);
  const [participantIds, setParticipantIds] = useState<number[]>(
    (initial?.participants ?? []).map((p) => p.user_id),
  );

  const { data: users } = useQuery({
    queryKey: ["users-lite-for-calendar"],
    queryFn: async () => (await api.get<{ items: { id: number; name: string; email: string }[] }>("/api/users", { params: { per_page: 200 } })).data.items,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description || null,
        location: location || null,
        url: url || null,
        start_at: _fromInput(startAt),
        end_at: _fromInput(endAt),
        all_day: allDay,
        rrule: rrule || null,
        participant_user_ids: participantIds,
        reminders,
      };
      if (mode === "create") {
        body.calendar_id = calendarId;
        return (await api.post("/api/calendar/events", body)).data;
      }
      return (await api.patch(`/api/calendar/events/${initial!.id}`, body)).data;
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Событие создано" : "Обновлено");
      onSaved();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const toggleParticipant = (id: number) => {
    setParticipantIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const addReminder = () => setReminders((r) => [...r, { offset_minutes: 10, kind: "notification" }]);
  const removeReminder = (i: number) => setReminders((r) => r.filter((_, idx) => idx !== i));

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "create" ? "Новое событие" : "Редактирование события"}
      size="lg"
    >
      <div className="space-y-3">
        <input
          className="input text-lg font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название"
          autoFocus
        />

        {mode === "create" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Календарь</span>
            <select
              className="input"
              value={calendarId}
              onChange={(e) => setCalendarId(Number(e.target.value))}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Начало</span>
            <input
              type="datetime-local"
              className="input"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              disabled={allDay}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Конец</span>
            <input
              type="datetime-local"
              className="input"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              disabled={allDay}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          Весь день
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            <Repeat size={11} className="inline" /> Повторение
          </span>
          <select
            className="input"
            value={rrule ?? ""}
            onChange={(e) => setRrule(e.target.value)}
          >
            {RRULE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {rrule && (
            <div className="mt-1 text-[10px] text-neutral-500">RRULE: {rrule}</div>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            <MapPin size={11} className="inline" /> Место
          </span>
          <input className="input" value={location ?? ""} onChange={(e) => setLocation(e.target.value)} />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            <LinkIcon size={11} className="inline" /> Ссылка (Zoom / Meet)
          </span>
          <input className="input" value={url ?? ""} onChange={(e) => setUrl(e.target.value)} />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Описание</span>
          <textarea className="input min-h-[80px]" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-neutral-500">
            <span><UsersIcon size={11} className="inline" /> Участники ({participantIds.length})</span>
          </div>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            {(users ?? []).map((u) => (
              <label key={u.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={participantIds.includes(u.id)}
                  onChange={() => toggleParticipant(u.id)}
                />
                <span className="truncate">{u.name} <span className="text-neutral-400">({u.email})</span></span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-neutral-500">
            <span><Bell size={11} className="inline" /> Напоминания</span>
            <button className="btn-ghost !py-0.5 text-xs" onClick={addReminder}>
              <Plus size={11} /> добавить
            </button>
          </div>
          <div className="space-y-1">
            {reminders.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="input !py-1 text-xs"
                  value={r.offset_minutes}
                  onChange={(e) => setReminders((rs) => rs.map((x, idx) => idx === i ? { ...x, offset_minutes: Number(e.target.value) } : x))}
                >
                  {REMINDER_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <select
                  className="input !py-1 text-xs w-32"
                  value={r.kind}
                  onChange={(e) => setReminders((rs) => rs.map((x, idx) => idx === i ? { ...x, kind: e.target.value } : x))}
                >
                  <option value="notification">Уведомление</option>
                  <option value="email">Email</option>
                </select>
                <button className="btn-ghost !p-1" onClick={() => removeReminder(i)}>
                  <XIcon size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button
            className="btn-primary"
            disabled={!title.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {mode === "create" ? "Создать" : "Сохранить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Details modal
// ============================================================================

function EventDetailsModal({
  occurrence, onClose, onEdit, onDeleted,
}: {
  occurrence: EventOcc;
  onClose: () => void;
  onEdit: (detail: EventDetail) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const eventId = occurrence.event_id;
  const { data: event, isPending } = useQuery({
    enabled: !!eventId,
    queryKey: ["calendar-event", eventId],
    queryFn: async () => (await api.get<EventDetail>(`/api/calendar/events/${eventId}`)).data,
  });

  const respond = useMutation({
    mutationFn: async (status: string) =>
      (await api.post(`/api/calendar/events/${eventId}/respond`, { status })).data,
    onSuccess: () => toast.success("Ответ отправлен"),
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: async () => api.delete(`/api/calendar/events/${eventId}`),
    onSuccess: () => {
      toast.success("Событие удалено");
      onDeleted();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={occurrence.title} size="md">
      {isPending && (
        <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin" /></div>
      )}
      {event && (
        <div className="space-y-3">
          <div className="text-sm text-neutral-500">
            {new Date(occurrence.start).toLocaleString("ru-RU")} — {new Date(occurrence.end).toLocaleString("ru-RU")}
          </div>
          {event.location && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin size={13} /> {event.location}
            </div>
          )}
          {event.url && (
            <div className="flex items-center gap-2 text-sm">
              <LinkIcon size={13} />
              <a href={event.url} target="_blank" rel="noreferrer" className="link">{event.url}</a>
            </div>
          )}
          {event.description && (
            <div className="whitespace-pre-wrap rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
              {event.description}
            </div>
          )}
          {event.rrule && (
            <div className="text-xs text-neutral-500">
              <Repeat size={11} className="inline" /> {event.rrule}
            </div>
          )}
          {event.participants.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Участники</div>
              {event.participants.map((p) => (
                <div key={p.user_id} className="flex items-center justify-between text-sm">
                  <span>User #{p.user_id} {p.is_organizer && <span className="chip bg-brand-100 text-brand-700">организатор</span>}</span>
                  <span className={clsx(
                    "chip",
                    p.status === "accepted" && "bg-emerald-100 text-emerald-700",
                    p.status === "declined" && "bg-rose-100 text-rose-700",
                    p.status === "tentative" && "bg-amber-100 text-amber-700",
                    p.status === "pending" && "bg-neutral-100 text-neutral-600",
                  )}>{p.status}</span>
                </div>
              ))}
              <div className="mt-2 flex gap-1">
                <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => respond.mutate("accepted")}>Принять</button>
                <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => respond.mutate("tentative")}>Возможно</button>
                <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => respond.mutate("declined")}>Отклонить</button>
              </div>
            </div>
          )}
          <div className="flex justify-between pt-2">
            <button className="btn-ghost text-rose-600" onClick={() => {
              if (confirm("Удалить событие?")) del.mutate();
            }}>
              <Trash2 size={14} /> Удалить
            </button>
            <button className="btn-primary" onClick={() => onEdit(event)}>
              Редактировать
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
