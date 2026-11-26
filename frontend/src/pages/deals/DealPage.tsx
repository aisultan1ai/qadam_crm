/**
 * /deals/:id — карточка offtake-контракта отдельной страницей (вкладки: условия, документы, ИИ).
 * Сделки обычной воронки продаж по-прежнему открываются окном на странице «Сделки».
 */
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { EmptyState, Loader } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { OfftakeDealModal, type OfftakeDeal } from "./Offtake";

type PageDeal = OfftakeDeal & { pipeline?: string; updated_at?: string };

export default function DealPage() {
  const { id } = useParams();
  const valid = !!id && /^\d+$/.test(id);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["deal", Number(id)],
    queryFn: async () => (await api.get<PageDeal>(`/api/deals/${id}`)).data,
    enabled: valid,
  });

  // Версия, которая сейчас в форме. Новую версию с сервера (коллега сохранил контракт) подставляем
  // сами, только если в форме нет несохранённых правок; иначе — предупреждение и выбор за пользователем.
  const [shown, setShown] = useState<PageDeal | null>(null);
  const dirty = useRef(false);
  const current = shown && data && shown.id === data.id ? shown : null;
  const newer = !!current && !!data && (data.updated_at ?? "") !== (current.updated_at ?? "");
  useEffect(() => {
    if (!data) return;
    if (!current || (newer && !dirty.current)) setShown(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!valid || isError) {
    return (
      <EmptyState
        title="Контракт не найден"
        description="Возможно, его удалили или у вас нет к нему доступа."
        action={<Link to="/deals" className="btn-secondary">К списку</Link>}
      />
    );
  }
  if (isPending || !data) return <Loader />;
  if (data.pipeline !== "offtake") return <Navigate to={`/deals?deal=${data.id}`} replace />;
  if (!current) return <Loader />;
  return (
    <div className="space-y-3">
      {newer && dirty.current && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <span>Контракт изменил другой пользователь. Ваши правки ещё не сохранены — если сохраните их, изменения коллеги будут перезаписаны.</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              dirty.current = false;
              setShown(data);
            }}
          >
            Загрузить новую версию
          </Button>
        </div>
      )}
      <OfftakeDealModal
        // Форма заполняется заново только при смене показанной версии
        key={current.updated_at ?? current.id}
        variant="page"
        initial={current}
        onClose={() => {}}
        onDirtyChange={(d) => {
          dirty.current = d;
        }}
        onSaved={async () => {
          dirty.current = false;
          const r = await refetch();
          if (r.data) setShown(r.data);
        }}
      />
    </div>
  );
}
