import { ReactNode } from "react";

export function AdminPageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4 border-b border-border px-4 pb-5 pt-6 lg:px-6">
      <div>
        <h1 className="text-xl font-bold text-text-primary">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
