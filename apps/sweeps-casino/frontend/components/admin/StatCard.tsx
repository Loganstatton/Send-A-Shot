import { Card, CardContent } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "gc" | "sc" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <p
          className={cn(
            "mt-1.5 font-mono text-2xl font-bold",
            accent === "gc" && "text-accent-gc",
            accent === "sc" && "text-accent-sc",
            !accent && "text-text-primary"
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
      </CardContent>
    </Card>
  );
}
