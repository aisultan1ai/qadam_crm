import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Plus, Trash2, Palmtree } from "lucide-react";
import { EmptyState, Modal, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Holiday = { id: number; date: string; name: string; is_workday: boolean };

export default function HolidaysPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [openNew, setOpenNew] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["holidays", year],
    queryFn: async () => (await api.get<Holiday[]>("/api/holidays", { params: { year } })).data,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/holidays/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holidays"] });
      toast.success("Удалено");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Рабочий календарь</h1>
          <p className="text-sm text-neutral-500">Праздники и переносы для {year} года</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input !w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={() => setOpenNew(true)}>
            <Plus size={15} /> День
          </button>
        </div>
      </div>

      {isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !data || data.length === 0 ? (
        <EmptyState icon={<Palmtree size={32} />} title={`За ${year} год пусто`} description="Добавьте праздники и переносы" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900/60">
              <tr>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Название</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((h) => (
                <tr key={h.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2 tabular-nums">{new Date(h.date).toLocaleDateString("ru-RU")}</td>
                  <td className="px-3 py-2 font-medium">{h.name}</td>
                  <td className="px-3 py-2">
                    {h.is_workday ? (
                      <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">Рабочий (перенос)</span>
                    ) : (
                      <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Выходной</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className="btn-ghost !p-1.5 text-rose-500" onClick={() => del.mutate(h.id)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openNew && <NewHolidayModal onClose={() => setOpenNew(false)} />}
    </div>
  );
}

function NewHolidayModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [isWorkday, setIsWorkday] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.post("/api/holidays", { date, name, is_workday: isWorkday }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holidays"] });
      onClose();
    },
    onError: (e) => setErr(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Новый день" size="sm">
      <form onSubmit={(e) => { e.preventDefault(); if (date && name) save.mutate(); }} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Дата</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Наурыз" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isWorkday} onChange={(e) => setIsWorkday(e.target.checked)} />
          Рабочий день (перенос)
        </label>
        <FormError msg={err} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={!date || !name || save.isPending}>Создать</button>
        </div>
      </form>
    </Modal>
  );
}
