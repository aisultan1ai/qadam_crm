import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export type OfftakeStage =
  | "initial_contact"
  | "materials_sent"
  | "nda_signed"
  | "loi_mou"
  | "term_sheet"
  | "agreement_draft"
  | "signed"
  | "refused";

export type OfftakeSettings = {
  enabled: boolean;
  stages: { key: OfftakeStage; label: string; probability: number }[];
  loss_reasons: Record<string, string>;
  doc_kinds: Record<string, string>;
  incoterms: string[];
};

export type OfftakeProduct = { id: number; name: string; is_active: boolean; order_index: number };

/** Настройка «Продажи и offtake»: включена ли воронка offtake и её справочные значения (стадии, причины, виды документов). */
export function useOfftakeSettings() {
  const { data, isPending } = useQuery({
    queryKey: ["offtake-settings"],
    queryFn: async () => (await api.get<OfftakeSettings>("/api/deals/offtake/settings")).data,
    staleTime: 60_000,
  });
  return { settings: data ?? null, enabled: !!data?.enabled, isPending };
}

/** Название раздела /deals: при включённом offtake он целиком становится «Offtake контракты». */
export function useDealsTitle() {
  const { enabled } = useOfftakeSettings();
  return enabled ? "Offtake контракты" : "Сделки";
}

export function useOfftakeProducts(enabled = true) {
  return useQuery({
    queryKey: ["offtake-products"],
    queryFn: async () => (await api.get<OfftakeProduct[]>("/api/deals/offtake/products")).data,
    staleTime: 60_000,
    enabled,
  });
}
