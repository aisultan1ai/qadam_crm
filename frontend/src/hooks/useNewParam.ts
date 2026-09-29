import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Открывает форму создания, если страница открыта с ?new=1 (меню «+ Создать» в шапке),
 * и сразу убирает параметр, чтобы форма не открывалась повторно при обновлении/назад.
 */
export function useNewParam(open: () => void, enabled = true) {
  const [sp, setSp] = useSearchParams();
  const flag = sp.get("new") === "1";
  useEffect(() => {
    if (!flag) return;
    if (enabled) open();
    const next = new URLSearchParams(sp);
    next.delete("new");
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag, enabled]);
}
