import { api } from "@/api/client";
import type { Page, User } from "@/types";

/**
 * Все сотрудники компании, без ограничения в 500 (сервер без номера страницы отдаёт не больше 500).
 * Забираем страницами по 200 — максимум, который принимает сервер.
 */
export async function fetchAllUsers<T = User>(params: Record<string, unknown> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 200; page++) {
    const { data } = await api.get<Page<T>>("/api/users", { params: { ...params, page, per_page: 200 } });
    out.push(...data.items);
    if (page >= data.pages || data.items.length === 0) break;
  }
  return out;
}
