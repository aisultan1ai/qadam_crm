import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import clsx from "clsx";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; title: string; description?: string };

type Ctx = {
  push: (t: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const push = useCallback<Ctx["push"]>((t) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    window.setTimeout(() => remove(id), 5000);
  }, [remove]);

  const api: Ctx = {
    push,
    success: (title, description) => push({ kind: "success", title, description }),
    error: (title, description) => push({ kind: "error", title, description }),
    info: (title, description) => push({ kind: "info", title, description }),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 4700);
    return () => clearTimeout(t);
  }, []);

  const palette: Record<ToastKind, { bar: string; icon: ReactNode }> = {
    success: {
      bar: "bg-emerald-500",
      icon: <CheckCircle2 size={18} className="text-emerald-500" />,
    },
    error: {
      bar: "bg-rose-500",
      icon: <AlertTriangle size={18} className="text-rose-500" />,
    },
    info: {
      bar: "bg-sky-500",
      icon: <Info size={18} className="text-sky-500" />,
    },
  };
  const { bar, icon } = palette[toast.kind];

  return (
    <div
      role="status"
      className={clsx(
        "pointer-events-auto relative flex gap-3 overflow-hidden rounded-xl border border-zinc-200 bg-white p-3 pr-8 shadow-soft transition-all dark:border-zinc-800 dark:bg-zinc-900",
        leaving ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100 animate-slide-up",
      )}
    >
      <span className={clsx("absolute inset-y-0 left-0 w-1", bar)} />
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{toast.title}</div>
        {toast.description && (
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{toast.description}</div>
        )}
      </div>
      <button
        aria-label="close"
        onClick={onClose}
        className="absolute right-2 top-2 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
      >
        <X size={14} />
      </button>
    </div>
  );
}
