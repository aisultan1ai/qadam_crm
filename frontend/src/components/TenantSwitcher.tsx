import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { useTenants } from "@/store/tenant";
import { useConfirm } from "@/components/Confirm";

function hasUnsavedInput(): boolean {
  // Ищем видимые поля ввода с непустым значением — кроме поиска.
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea',
  );
  for (const el of Array.from(inputs)) {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    if (type === "search") continue;
    const name = (el.name || "").toLowerCase();
    const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
    if (name.includes("search") || name === "q" || placeholder.includes("поиск")) continue;
    if ((el.value ?? "").trim().length > 0) return true;
  }
  // Также — contentEditable-редакторы (комментарии/описания)
  const editors = document.querySelectorAll<HTMLElement>('[contenteditable="true"]');
  for (const el of Array.from(editors)) {
    if ((el.innerText || "").trim().length > 0) return true;
  }
  return false;
}

export default function TenantSwitcher() {
  const me = useAuth((s) => s.me);
  const { tenants, fetchTenants, switchTenant } = useTenants();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const confirm = useConfirm();

  const handleSwitch = async (targetId: number, targetName: string) => {
    // switchTenant делает window.location.assign("/") — весь несохранённый
    // ввод в формах пропадёт. Спрашиваем подтверждение, если есть открытая
    // модалка либо непустое поле ввода вне поиска.
    const hasOpenModal = document.querySelector('[role="dialog"], [aria-modal="true"]');
    const hasDirtyForm = hasUnsavedInput();
    if (hasOpenModal || hasDirtyForm) {
      const ok = await confirm({
        title: "Переключить компанию?",
        message: `Приложение перезагрузится и переключится на «${targetName}». Несохранённые данные в открытых формах будут утеряны.`,
        confirmLabel: "Переключить",
      });
      if (!ok) return;
    }
    switchTenant(targetId);
  };

  useEffect(() => {
    if (me) fetchTenants();
  }, [me?.id]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = me?.current_tenant;
  const currentName =
    current?.company_display_name || current?.name || tenants.find((t) => t.id === current?.id)?.name;

  // Если только один tenant — dropdown не нужен, просто чип.
  if (tenants.length <= 1) {
    if (!currentName) return null;
    return (
      <div className="hidden items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-700 dark:border-neutral-700/60 dark:text-neutral-300 sm:flex">
        <Building2 size={14} />
        <span className="truncate max-w-[10rem]">{currentName}</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white/70 px-2.5 py-1.5 text-sm text-neutral-700 hover:border-neutral-300 dark:border-neutral-700/60 dark:bg-[#17171F] dark:text-neutral-300 dark:hover:border-neutral-600"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Building2 size={14} />
        <span className="truncate max-w-[9rem]">{currentName ?? "Выберите"}</span>
        <ChevronsUpDown size={13} className="text-neutral-400" />
      </button>

      {open && (
        <div
          className="card absolute right-0 mt-2 w-64 animate-slide-up p-1"
          role="listbox"
        >
          {tenants.map((t) => {
            const active = t.id === current?.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!active) handleSwitch(t.id, t.company_display_name || t.name);
                }}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                )}
                role="option"
                aria-selected={active}
              >
                {t.logo_url ? (
                  <img src={t.logo_url} alt="" className="h-5 w-5 rounded" />
                ) : (
                  <div className="grid h-5 w-5 place-items-center rounded bg-neutral-200 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
                    {t.name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.company_display_name || t.name}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {t.plan} · {t.is_owner ? "владелец" : "участник"}
                  </div>
                </div>
                {active && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
