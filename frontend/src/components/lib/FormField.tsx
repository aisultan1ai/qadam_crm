import { ReactNode } from "react";
import clsx from "clsx";
import { FieldError as FieldErrorUI } from "@/components/ui";

export function FormField({
  label,
  required,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={clsx("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium">
          {label}
          {required && <span className="ml-0.5 text-rose-500" aria-hidden>*</span>}
        </label>
      )}
      {children}
      {hint && !error && (
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</div>
      )}
      <FieldErrorUI msg={error} />
    </div>
  );
}

export default FormField;
