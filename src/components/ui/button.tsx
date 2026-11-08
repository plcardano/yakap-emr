import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline" | "danger" | "link";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "bg-primary-soft text-navy hover:bg-line",
  outline: "border border-line bg-card text-navy hover:bg-surface",
  danger: "bg-danger text-white hover:opacity-90",
  link: "px-0 text-primary underline hover:text-primary-hover",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Disables the button and shows why beneath it. */
  disabledReason?: string;
};

export function Button({
  variant = "primary",
  disabledReason,
  disabled,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const button = (
    <button
      type={type}
      disabled={disabled || Boolean(disabledReason)}
      className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );

  if (!disabledReason) return button;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {button}
      <span className="text-xs text-muted">{disabledReason}</span>
    </span>
  );
}
