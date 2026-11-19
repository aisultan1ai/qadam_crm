import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export type LegalEntity = {
  id: number;
  full_name: string;
  short_name: string;
  bin?: string | null;
  address?: string | null;
  director_name?: string | null;
  director_position?: string | null;
  logo_url?: string | null;
  currency: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LegalEntityBrief = { id: number; short_name: string };

/**
 * Юрлица компании. Выбор юрлица в формах и его название в списках показываем,
 * только когда активных юрлиц два и больше — иначе всё идёт на юрлицо по умолчанию.
 */
export function useLegalEntities() {
  const { data, isPending } = useQuery({
    queryKey: ["legal-entities"],
    queryFn: async () => (await api.get<LegalEntity[]>("/api/legal-entities")).data,
    staleTime: 60_000,
  });
  const all = data ?? [];
  const active = all.filter((e) => e.is_active);
  const defaultEntity = all.find((e) => e.is_default) ?? active[0] ?? null;
  return {
    all,
    active,
    defaultEntity,
    /** Показывать ли поле «Юрлицо» и названия юрлиц. */
    multi: active.length >= 2,
    isPending,
  };
}

/** Варианты для выбора: активные + уже выбранное (даже если его отключили). */
export function legalEntityOptions(all: LegalEntity[], currentId?: number | null): LegalEntity[] {
  return all.filter((e) => e.is_active || e.id === currentId);
}
