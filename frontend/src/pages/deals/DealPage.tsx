/**
 * /deals/:id — карточка offtake-контракта отдельной страницей (вкладки: условия, документы, ИИ).
 * Сделки обычной воронки продаж по-прежнему открываются окном на странице «Сделки».
 */
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { EmptyState, Loader } from "@/components/ui";
import { OfftakeDealModal, type OfftakeDeal } from "./Offtake";

export default function DealPage() {
  const { id } = useParams();
  const valid = !!id && /^\d+$/.test(id);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["deal", Number(id)],
    queryFn: async () => (await api.get<OfftakeDeal & { pipeline?: string; updated_at?: string }>(`/api/deals/${id}`)).data,
    enabled: valid,
  });

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
  return (
    <OfftakeDealModal
      // Новая версия с сервера — заново заполнить форму
      key={data.updated_at ?? data.id}
      variant="page"
      initial={data}
      onClose={() => {}}
      onSaved={() => refetch()}
    />
  );
}
