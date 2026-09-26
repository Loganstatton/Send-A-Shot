import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "gc"
  | "sc"
  | "success"
  | "danger"
  | "neutral"
  | "new"
  | "hot"
  | "exclusive"
  | "jackpot";

const variantClasses: Record<BadgeVariant, string> = {
  gc: "bg-accent-gc/15 text-accent-gc border border-accent-gc/30",
  sc: "bg-accent-sc/15 text-accent-sc border border-accent-sc/30",
  success: "bg-success/15 text-success border border-success/30",
  danger: "bg-danger/15 text-danger border border-danger/30",
  neutral: "bg-surface-raised text-text-muted border border-border",
  new: "bg-accent-sc text-bg font-bold",
  hot: "bg-danger text-white font-bold",
  // Stands apart from the accent duo (violet reads as "special", not
  // Gold/Sweeps Coins currency) — used for catalog-exclusive titles.
  exclusive: "bg-violet-500/20 text-violet-300 border border-violet-400/40 font-bold",
  // Gold + a small glow so a jackpot-tagged game visibly pops off the row.
  jackpot: "bg-accent-gc text-bg font-bold shadow-glow-gc",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
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
