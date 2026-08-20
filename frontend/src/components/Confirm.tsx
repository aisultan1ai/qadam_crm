import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./ui";

type ConfirmOptions = {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  // Опциональный async-обработчик подтверждения. Пока промис не разрешится,
  // модалка остаётся открытой, а кнопка показывает спиннер. Если бросает —
  // модалка остаётся открытой (пользователь может отменить или попробовать снова).
  onConfirm?: () => Promise<unknown>;
};

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const close = (value: boolean) => {
    if (!pending || busy) return;
    pending.resolve(value);
    setPending(null);
  };

  const handleConfirm = async () => {
    if (!pending) return;
    if (!pending.onConfirm) {
      pending.resolve(true);
      setPending(null);
      return;
    }
    try {
      setBusy(true);
      await pending.onConfirm();
      pending.resolve(true);
      setPending(null);
    } catch {
      // Ошибку показывает вызывающий код (toast). Оставляем модалку открытой,
      // чтобы пользователь мог отменить или повторить попытку.
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => close(false)}
        title={pending?.title ?? "Подтверждение"}
        size="sm"
      >
        <div className="space-y-4">
          <div className="text-sm text-neutral-600 dark:text-neutral-300">{pending?.message}</div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => close(false)} disabled={busy}>
              {pending?.cancelLabel ?? "Отмена"}
            </button>
            <button
              className={pending?.danger ? "btn-danger" : "btn-primary"}
              autoFocus
              disabled={busy}
              onClick={handleConfirm}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {pending?.confirmLabel ?? "Подтвердить"}
            </button>
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
