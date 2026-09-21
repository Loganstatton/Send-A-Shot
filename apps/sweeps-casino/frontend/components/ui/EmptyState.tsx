import { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  phase?: "P2" | "P3";
  action?: ReactNode;
}

/**
 * Honest "not built yet" state used across every P2/P3 screen. Never a dead
 * link or a blank page — always explains why, per docs/04 cross-cutting
 * UI-state rules.
 */
export function EmptyState({ icon, title, description, phase, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/50 px-6 py-16 text-center">
      {icon && <div className="mb-4 text-text-muted">{icon}</div>}
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        {phase && <Badge variant="sc">{phase} — coming soon</Badge>}
      </div>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
