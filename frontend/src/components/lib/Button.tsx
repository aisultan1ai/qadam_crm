import { forwardRef, ReactNode, ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "contrast";
type Size = "sm" | "md" | "lg" | "xl" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
  contrast: "btn-contrast",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "!px-3 !py-1.5 !text-xs",
  md: "",
  lg: "!px-5 !py-3 !text-base",
  xl: "btn-xl",
  icon: "!p-1.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    isLoading = false,
    leftIcon,
    rightIcon,
    fullWidth,
    disabled,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={clsx(
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {isLoading ? (
        <Loader2 size={size === "lg" || size === "xl" ? 18 : 14} className="animate-spin" />
      ) : (
        leftIcon
      )}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
});

export default Button;
