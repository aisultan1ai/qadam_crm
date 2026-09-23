import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, extractApiError } from "@/api/client";
import { Plus, Trash2, Palmtree } from "lucide-react";
import { EmptyState, Modal, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { DataTable, Column } from "@/components/lib/DataTable";
import { holidaySchema, type HolidayForm } from "@/lib/validation";

type Holiday = { id: number; date: string; name: string; is_workday: boolean };

const holidayFormSchema = holidaySchema.extend({
  is_workday: z.boolean().default(false),
});
type HolidayFullForm = z.infer<typeof holidayFormSchema>;

export default function HolidaysPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
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

  const columns: Column<Holiday>[] = [
    {
      key: "date",
      header: "Дата",
      sortable: true,
      sortAccessor: (h) => new Date(h.date),
      render: (h) => <span className="tabular-nums">{new Date(h.date).toLocaleDateString("ru-RU")}</span>,
      width: 140,
    },
    {
      key: "name",
      header: "Название",
      sortable: true,
      sortAccessor: (h) => h.name,
      render: (h) => <span className="font-medium">{h.name}</span>,
    },
    {
      key: "type",
      header: "Тип",
      render: (h) =>
        h.is_workday ? (
          <span className="rounded bg-sky-200 px-2 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
            Рабочий (перенос)
          </span>
        ) : (
          <span className="rounded bg-rose-200 px-2 py-0.5 text-xs font-medium text-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            Выходной
          </span>
        ),
      width: 200,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 80,
      render: (h) => (
        <Button
          variant="ghost"
          size="icon"
          className="text-rose-500"
          onClick={() =>
            confirm({
              title: "Удалить?",
              message: `«${h.name}» будет удалён из календаря.`,
              danger: true,
              confirmLabel: "Удалить",
              onConfirm: () => del.mutateAsync(h.id),
            })
          }
          aria-label="Удалить"
        >
          <Trash2 size={13} />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Рабочий календарь</h1>
          <p className="page-subtitle">Праздники и переносы для {year} года</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input !w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => setOpenNew(true)}>
            День
          </Button>
        </div>
      </div>

      {!isPending && (!data || data.length === 0) ? (
        <EmptyState icon={<Palmtree size={32} />} title={`За ${year} год пусто`} description="Добавьте праздники и переносы" />
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(h) => h.id}
          isLoading={isPending}
          initialSort={{ key: "date", direction: "asc" }}
        />
      )}

      {openNew && <NewHolidayModal onClose={() => setOpenNew(false)} />}
    </div>
  );
}

function NewHolidayModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<HolidayFullForm>({
    resolver: zodResolver(holidayFormSchema),
    defaultValues: { name: "", date: "", is_workday: false },
  });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    try {
      await api.post("/api/holidays", data);
      qc.invalidateQueries({ queryKey: ["holidays"] });
      onClose();
    } catch (e) {
      setServerError(extractApiError(e).message);
    }
  });

  return (
    <Modal open onClose={onClose} title="Новый день" size="sm">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormField label="Дата" required error={errors.date?.message}>
          <input type="date" className="input" {...register("date")} />
        </FormField>
        <FormField label="Название" required error={errors.name?.message}>
          <input className="input" placeholder="Наурыз" {...register("name")} />
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("is_workday")} />
          Рабочий день (перенос)
        </label>
        {serverError && <FormError msg={serverError} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>Создать</Button>
        </div>
      </form>
    </Modal>
  );
}
