import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export type AiStatus = {
  /** На сервере задан ключ Claude API */
  configured: boolean;
  /** Владелец включил ИИ в настройках компании */
  enabled: boolean;
  /** Запросов в месяц по тарифу (0 — недоступно) */
  limit: number;
  used: number;
  /** Можно показывать кнопки ИИ */
  available: boolean;
};

/** Состояние ИИ-помощника компании. Кнопки ИИ в интерфейсе показываем только при `available`. */
export function useAi() {
  const { data, isPending } = useQuery({
    queryKey: ["ai-status"],
    queryFn: async () => (await api.get<AiStatus>("/api/ai/status")).data,
    staleTime: 60_000,
  });
  return { status: data ?? null, available: !!data?.available, isPending };
}
