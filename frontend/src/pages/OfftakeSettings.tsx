/**
 * Настройки → Продажи и offtake.
 * Включение воронки offtake для компании и справочник продуктов, которые компания продаёт по offtake-контрактам.
 * Пока воронка выключена, на странице сделок ничего offtake-го не показывается.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, X } from "lucide-react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { Button } from "@/components/lib/Button";
import { useToast } from "@/components/Toast";
import { SettingsRow, SettingsSection } from "@/components/page";
import { Loader } from "@/components/ui";
import { useAuth } from "@/store/auth";
import { useOfftakeProducts, useOfftakeSettings, type OfftakeProduct } from "@/hooks/useOfftake";

export default function OfftakeSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const canSystem = can("settings.system");
  const canDict = can("settings.dictionaries");
  const { settings, enabled, isPending } = useOfftakeSettings();
  const products = useOfftakeProducts(enabled);

  const toggle = useMutation({
    mutationFn: (value: boolean) => api.put("/api/deals/offtake/settings", { enabled: value }),
    onSuccess: (_r, value) => {
      qc.invalidateQueries({ queryKey: ["offtake-settings"] });
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast.success(value ? "Воронка offtake включена" : "Воронка offtake выключена");
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  if (isPending) return <Loader />;

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Воронка offtake"
        description="Отдельная воронка для долгосрочных контрактов на поставку продукции: стадии от первого контакта до подписания, объёмы по годам и обязательные документы."
      >
        <SettingsRow
          label="Использовать offtake"
          hint="На странице «Сделки» появится переключатель «Продажи / Offtake». Обычная воронка продаж не меняется."
        >
          <label className={clsx("inline-flex items-center gap-2 text-sm", !canSystem && "opacity-60")}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canSystem || toggle.isPending}
              onChange={(e) => toggle.mutate(e.target.checked)}
            />
            {enabled ? "Включено" : "Выключено"}
          </label>
          {!canSystem && (
            <div className="mt-1 text-xs text-zinc-500">Включать и выключать может владелец компании или сотрудник с правом «Системные настройки».</div>
          )}
        </SettingsRow>
        {enabled && settings && (
          <SettingsRow
            label="Стадии и вероятность"
            hint="Вероятность подставляется по стадии. Если в сделке указать свою, смена стадии её не меняет. «Подписан» — всегда 100 %, «Отказ» — 0 %."
          >
            <ol className="space-y-1 text-sm">
              {settings.stages.map((s, i) => (
                <li key={s.key} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="mr-2 tabular-nums text-zinc-400">{i + 1}.</span>
                    {s.label}
                  </span>
                  <span className="tabular-nums text-zinc-500">{s.probability} %</span>
                </li>
              ))}
            </ol>
            <div className="mt-2 text-xs text-zinc-500">
              Перейти в «NDA подписан» и дальше можно только с прикреплённым файлом NDA, в «Term Sheet согласован» и дальше — с файлом Term Sheet.
            </div>
          </SettingsRow>
        )}
      </SettingsSection>

      {enabled && (
        <ProductsSection products={products.data ?? []} loading={products.isPending} canEdit={canDict} />
      )}
    </div>
  );
}

function ProductsSection({ products, loading, canEdit }: { products: OfftakeProduct[]; loading: boolean; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["offtake-products"] });
    qc.invalidateQueries({ queryKey: ["deals"] });
  };
  const create = useMutation({
    mutationFn: (n: string) => api.post("/api/deals/offtake/products", { name: n }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (e) => toast.error("Не удалось добавить продукт", extractApiError(e).message),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<OfftakeProduct> }) => api.patch(`/api/deals/offtake/products/${id}`, body),
    onSuccess: () => {
      setEditId(null);
      refresh();
    },
    onError: (e) => toast.error("Не удалось сохранить продукт", extractApiError(e).message),
  });

  const swap = (i: number, j: number) => {
    const a = products[i];
    const b = products[j];
    if (!a || !b) return;
    // Порядковые номера могут совпадать — раздаём явные
    update.mutate({ id: a.id, body: { order_index: j * 10 } });
    update.mutate({ id: b.id, body: { order_index: i * 10 } });
    products.forEach((p, k) => {
      if (k !== i && k !== j && p.order_index !== k * 10) update.mutate({ id: p.id, body: { order_index: k * 10 } });
    });
  };

  return (
    <SettingsSection
      title="Продукты"
      description="Что ваша компания поставляет по offtake-контрактам. Продукт выбирается в сделке; по нему разбивается график законтрактованного объёма."
    >
      <div className="py-4">
        {loading ? (
          <Loader />
        ) : products.length === 0 ? (
          <div className="text-sm text-zinc-500">Продуктов пока нет. {canEdit ? "Добавьте первый ниже." : ""}</div>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {products.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                {editId === p.id ? (
                  <>
                    <input
                      className="input flex-1"
                      value={editName}
                      autoFocus
                      maxLength={200}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editName.trim()) update.mutate({ id: p.id, body: { name: editName.trim() } });
                        if (e.key === "Escape") setEditId(null);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Сохранить"
                      disabled={!editName.trim()}
                      onClick={() => update.mutate({ id: p.id, body: { name: editName.trim() } })}
                    >
                      <Check size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Отмена" onClick={() => setEditId(null)}>
                      <X size={14} />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={clsx("flex-1 truncate", !p.is_active && "text-zinc-400 line-through")}>{p.name}</span>
                    {!p.is_active && <span className="text-xs text-zinc-500">не используется</span>}
                    {canEdit && (
                      <>
                        <Button variant="ghost" size="icon" aria-label="Выше" disabled={i === 0} onClick={() => swap(i, i - 1)}>
                          <ArrowUp size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Ниже" disabled={i === products.length - 1} onClick={() => swap(i, i + 1)}>
                          <ArrowDown size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Переименовать"
                          onClick={() => {
                            setEditId(p.id);
                            setEditName(p.name);
                          }}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: p.id, body: { is_active: !p.is_active } })}>
                          {p.is_active ? "Отключить" : "Включить"}
                        </Button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate(name.trim());
            }}
          >
            <input
              className="input flex-1"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название продукта"
              aria-label="Название нового продукта"
            />
            <Button type="submit" variant="secondary" leftIcon={<Plus size={14} />} isLoading={create.isPending} disabled={!name.trim()}>
              Добавить
            </Button>
          </form>
        ) : (
          <div className="mt-2 text-xs text-zinc-500">Менять список может сотрудник с правом «Управление справочниками».</div>
        )}
        <div className="mt-2 text-xs text-zinc-500">
          Отключённый продукт не предлагается в новых сделках, но остаётся в уже заведённых.
        </div>
      </div>
    </SettingsSection>
  );
}
