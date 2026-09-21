import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/Card";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="border-border/80">
      <CardContent className="p-6 sm:p-8">
        <h1 className="text-xl font-bold text-text-primary">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </CardContent>
    </Card>
  );
}
