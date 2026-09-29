import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Star } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";

export type FavoriteEntity = "project" | "task" | "wiki";
export type Favorite = { entity: FavoriteEntity; entity_id: number; title: string; url: string; color?: string | null };

const KEY = ["favorites"];

/** Избранное текущего пользователя (сайдбар + звёздочки на страницах). */
export function useFavorites() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: favorites = [] } = useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<Favorite[]>("/api/favorites")).data,
    staleTime: 60_000,
  });
  const toggle = useMutation({
    mutationFn: async ({ entity, id, on }: { entity: FavoriteEntity; id: number; on: boolean }) =>
      on ? api.post("/api/favorites", { entity, entity_id: id }) : api.delete(`/api/favorites/${entity}/${id}`),
    onMutate: async ({ entity, id, on }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Favorite[]>(KEY);
      if (!on) qc.setQueryData<Favorite[]>(KEY, (old) => (old ?? []).filter((f) => !(f.entity === entity && f.entity_id === id)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error("Не удалось обновить избранное", extractApiError(e).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const isFavorite = (entity: FavoriteEntity, id: number) => favorites.some((f) => f.entity === entity && f.entity_id === id);
  return { favorites, isFavorite, toggle: (entity: FavoriteEntity, id: number) => toggle.mutate({ entity, id, on: !isFavorite(entity, id) }) };
}

/** Звёздочка «В избранное» для шапки страницы проекта / задачи / статьи. */
export function FavoriteButton({ entity, id, className }: { entity: FavoriteEntity; id: number; className?: string }) {
  const { isFavorite, toggle } = useFavorites();
  const on = isFavorite(entity, id);
  return (
    <button
      type="button"
      onClick={() => toggle(entity, id)}
      aria-pressed={on}
      aria-label={on ? "Убрать из избранного" : "Добавить в избранное"}
      title={on ? "Убрать из избранного" : "Добавить в избранное"}
      className={clsx(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors",
        on ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-[#1B1F26] dark:hover:text-zinc-200",
        className,
      )}
    >
      <Star size={17} className={clsx(on && "fill-current")} />
    </button>
  );
}
