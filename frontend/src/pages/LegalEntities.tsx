/**
 * Настройки → Юрлица: от имени каких юрлиц компания ведёт сделки, проекты, договоры и документы.
 * Пока юрлицо одно, в формах его выбор не показывается — всё идёт на юрлицо по умолчанию.
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Landmark, Pencil, Plus, Star, Trash2 } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { SettingsSection } from "@/components/page";
import { EmptyState, FormError, Loader, Modal } from "@/components/ui";
import { useAuth } from "@/store/auth";
import { useLegalEntities, type LegalEntity } from "@/hooks/useLegalEntities";

const CURRENCIES = ["KZT", "USD", "EUR", "RUB"];

export default function LegalEntities() {
  const { can, me } = useAuth();
  const canManage = can("settings.dictionaries") || !!me?.current_tenant?.is_owner;
  const { all, isPending } = useLegalEntities();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState<LegalEntity | "new" | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["legal-entities"] });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<LegalEntity> }) => api.patch(`/api/legal-entities/${id}`, body),
    onSuccess: refresh,
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/legal-entities/${id}`),
    onSuccess: () => {
      refresh();
      toast.success("Юрлицо удалено");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  return (
    <SettingsSection
      title="Юрлица"
      description="Юрлица вашей компании: от их имени ведутся сделки, проекты и документы. Когда юрлиц два и больше, в формах появляется выбор юрлица."
      actions={
        canManage && (
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen("new")}>
            Добавить
          </Button>
        )
      }
    >
      {isPending ? (
        <div className="py-6">
          <Loader />
        </div>
      ) : all.length === 0 ? (
        <EmptyState icon={<Landmark size={24} />} title="Юрлиц пока нет" description="Добавьте юрлицо, от имени которого работает компания." />
      ) : (
        all.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-3 py-3">
            {e.logo_url ? (
              <img src={e.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border object-contain dark:border-zinc-700" />
            ) : (
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-[#23262D]">
                <Landmark size={18} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{e.short_name}</span>
                {e.is_default && (
                  <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">По умолчанию</span>
                )}
                {!e.is_active && <span className="chip bg-zinc-100 text-zinc-500 dark:bg-white/5">Отключено</span>}
              </div>
              <div className="truncate text-[12px] text-zinc-500">
                {[e.full_name !== e.short_name ? e.full_name : null, e.bin ? `БИН ${e.bin}` : null, e.currency]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {canManage && (
              <div className="flex items-center gap-1">
                {!e.is_default && e.is_active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Star size={13} />}
                    onClick={() => patch.mutate({ id: e.id, body: { is_default: true } })}
                  >
                    Сделать основным
                  </Button>
                )}
                {!e.is_default && (
                  <Button variant="ghost" size="sm" onClick={() => patch.mutate({ id: e.id, body: { is_active: !e.is_active } })}>
                    {e.is_active ? "Отключить" : "Включить"}
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => setOpen(e)} aria-label="Изменить юрлицо" title="Изменить">
                  <Pencil size={14} />
                </Button>
                {!e.is_default && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-rose-500"
                    aria-label="Удалить юрлицо"
                    title="Удалить"
                    onClick={() =>
                      confirm({
                        title: "Удалить юрлицо?",
                        message: `«${e.short_name}» будет удалено. Если к нему уже привязаны сделки, проекты или документы, удалить не получится — его можно отключить.`,
                        danger: true,
                        confirmLabel: "Удалить",
                        onConfirm: () => remove.mutateAsync(e.id),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            )}
          </div>
        ))
      )}
      {open && <LegalEntityModal initial={open === "new" ? null : open} onClose={() => setOpen(null)} />}
    </SettingsSection>
  );
}

function LegalEntityModal({ initial, onClose }: { initial: LegalEntity | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    full_name: initial?.full_name ?? "",
    short_name: initial?.short_name ?? "",
    bin: initial?.bin ?? "",
    address: initial?.address ?? "",
    director_name: initial?.director_name ?? "",
    director_position: initial?.director_position ?? "",
    currency: initial?.currency ?? "KZT",
    is_default: initial?.is_default ?? false,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(initial?.logo_url ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const binDigits = form.bin.replace(/\D/g, "");
  const binError = form.bin.trim() && binDigits.length !== 12 ? "БИН состоит из 12 цифр" : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.full_name.trim().length < 2) {
      setError("Укажите полное название юрлица");
      return;
    }
    if (binError) {
      setError(binError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        full_name: form.full_name.trim(),
        short_name: form.short_name.trim() || null,
        bin: binDigits || null,
        address: form.address.trim() || null,
        director_name: form.director_name.trim() || null,
        director_position: form.director_position.trim() || null,
        currency: form.currency,
        ...(form.is_default && !initial?.is_default ? { is_default: true } : {}),
      };
      const saved = initial
        ? (await api.patch<LegalEntity>(`/api/legal-entities/${initial.id}`, body)).data
        : (await api.post<LegalEntity>("/api/legal-entities", body)).data;
      if (logoFile) {
        const fd = new FormData();
        fd.append("file", logoFile);
        try {
          await api.post(`/api/legal-entities/${saved.id}/logo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        } catch (err) {
          toast.error("Юрлицо сохранено, но логотип не загрузился", extractApiError(err).message);
        }
      } else if (initial?.logo_url && !logoUrl) {
        await api.delete(`/api/legal-entities/${saved.id}/logo`);
      }
      qc.invalidateQueries({ queryKey: ["legal-entities"] });
      onClose();
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const preview = logoFile ? URL.createObjectURL(logoFile) : logoUrl;

  return (
    <Modal open onClose={onClose} title={initial ? "Юрлицо" : "Новое юрлицо"} size="md">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <FormField label="Полное название" required hint="Как в учредительных документах">
          <input className="input" autoFocus value={form.full_name} onChange={set("full_name")} maxLength={300} />
        </FormField>
        <FormField label="Краткое название" hint="Показывается в списках и формах. Если не заполнить — возьмём полное">
          <input className="input" value={form.short_name} onChange={set("short_name")} maxLength={200} />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="БИН" error={binError ?? undefined} className="sm:col-span-2">
            <input className="input tabular-nums" inputMode="numeric" value={form.bin} onChange={set("bin")} maxLength={20} placeholder="12 цифр" />
          </FormField>
          <FormField label="Валюта">
            <select className="input" value={form.currency} onChange={set("currency")}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="Юридический адрес">
          <textarea className="input min-h-[60px]" value={form.address} onChange={set("address")} maxLength={1000} />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Подписант" hint="ФИО руководителя для подписи документов">
            <input className="input" value={form.director_name} onChange={set("director_name")} maxLength={200} />
          </FormField>
          <FormField label="Должность подписанта">
            <input className="input" value={form.director_position} onChange={set("director_position")} maxLength={200} />
          </FormField>
        </div>
        <FormField label="Логотип" hint="JPEG, PNG или WebP до 2 МБ">
          <div className="flex items-center gap-3">
            {preview ? (
              <img src={preview} alt="" className="h-12 w-12 rounded-lg border object-contain dark:border-zinc-700" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-[#23262D]">
                <Landmark size={18} />
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setLogoFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              {preview ? "Заменить" : "Загрузить"}
            </Button>
            {preview && (
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600"
                onClick={() => {
                  setLogoFile(null);
                  setLogoUrl(null);
                }}
              >
                Убрать
              </Button>
            )}
          </div>
        </FormField>
        {!initial?.is_default && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
            />
            Юрлицо по умолчанию — подставляется в новые сделки, проекты и документы
          </label>
        )}
        <FormError msg={error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" isLoading={busy}>
            {initial ? "Сохранить" : "Создать"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
