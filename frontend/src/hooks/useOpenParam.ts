import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import { api } from "@/api/client";

/**
 * Открыть карточку по ссылке: /contacts?contact=12 → загрузить контакт 12 и открыть его.
 * Параметр убирается из адреса, чтобы закрытие окна не открывало его снова.
 */
export function useOpenParam<T>(param: string, url: (id: string) => string, open: (item: T) => void, enabled = true) {
  const [sp, setSp] = useSearchParams();
  const id = sp.get(param);
  useEffect(() => {
    if (!enabled || !id || !/^\d+$/.test(id)) return;
    let cancelled = false;
    api
      .get<T>(url(id))
      .then((r) => {
        if (!cancelled) open(r.data);
      })
      .catch(() => {})
      .finally(() => {
        const next = new URLSearchParams(window.location.search);
        next.delete(param);
        setSp(next, { replace: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);
}
