import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "gc" | "sc" | "success" | "danger" | "neutral" | "new" | "hot";

const variantClasses: Record<Variant, string> = {
  gc: "bg-accent-gc/15 text-accent-gc border border-accent-gc/30",
  sc: "bg-accent-sc/15 text-accent-sc border border-accent-sc/30",
  success: "bg-success/15 text-success border border-success/30",
  danger: "bg-danger/15 text-danger border border-danger/30",
  neutral: "bg-surface-raised text-text-muted border border-border",
  new: "bg-accent-sc text-bg font-bold",
  hot: "bg-danger text-white font-bold",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
