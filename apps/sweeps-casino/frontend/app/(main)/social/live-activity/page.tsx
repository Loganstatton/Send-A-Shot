"use client";

import { useState } from "react";
import { ActivityPanel } from "@/components/layout/ActivityPanel";

// A dedicated page for the sidebar's "Live Activity" item, wrapping the
// same ActivityPanel already shown as a desktop-only right-hand rail
// (app/(main)/layout.tsx) so the feed is reachable as its own page too —
// useful on viewports narrower than the rail's `xl:` breakpoint.
export default function LiveActivityPage() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Live Activity</h1>
      <div className="mx-auto max-w-md">
        <ActivityPanel collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} standalone />
      </div>
    </div>
  );
}
