"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  key: string;
  label: string;
  disabled?: boolean;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  rightAdornment?: ReactNode;
}

export function Tabs({ tabs, active, onChange, className, rightAdornment }: TabsProps) {
  return (
    <div className={cn("flex items-center justify-between border-b border-border", className)}>
      <div className="no-scrollbar flex gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.key)}
            className={cn(
              "relative shrink-0 px-4 py-3 text-sm font-medium transition-colors",
              active === tab.key ? "text-text-primary" : "text-text-muted hover:text-text-primary",
              tab.disabled && "cursor-not-allowed opacity-40 hover:text-text-muted"
            )}
          >
            {tab.label}
            {active === tab.key && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent-sc" />
            )}
          </button>
        ))}
      </div>
      {rightAdornment}
    </div>
  );
}
