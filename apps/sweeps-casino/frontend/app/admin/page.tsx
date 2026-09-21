"use client";

import { useCallback } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { AdminDashboardMetrics } from "@/lib/types";
import { formatCoins } from "@/lib/utils";

export default function AdminDashboardPage() {
  const fetcher = useCallback(() => api.get<AdminDashboardMetrics>("/admin/dashboard"), []);
  const { data, loading } = useFetch(fetcher);

  return (
    <div>
      <AdminPageHeader title="Dashboard" description="Platform-wide metrics, refreshed on load." />
      <div className="px-4 pb-8 lg:px-6">
        {loading && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!loading && data && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total users" value={data.totalUsers.toLocaleString()} />
            <StatCard label="New users today" value={data.newUsersToday.toLocaleString()} />
            <StatCard label="Pending KYC" value={data.pendingKyc.toLocaleString()} />
            <StatCard label="Active promotions" value={data.activePromotions.toLocaleString()} />
            <StatCard label="GC wagered" value={formatCoins(data.gcActivity.wagered)} accent="gc" />
            <StatCard label="GC won" value={formatCoins(data.gcActivity.won)} accent="gc" />
            <StatCard label="SC wagered" value={formatCoins(data.scActivity.wagered)} accent="sc" />
            <StatCard label="SC won" value={formatCoins(data.scActivity.won)} accent="sc" />
            <StatCard
              label="Purchases revenue"
              value={formatCoins(data.revenue.purchases)}
              hint="Zeroed until payments.purchases_enabled is on"
            />
            <StatCard
              label="Redemptions paid"
              value={formatCoins(data.revenue.redemptions)}
              hint="Zeroed until redemptions.enabled is on"
            />
          </div>
        )}

        {!loading && !data && (
          <p className="text-sm text-text-muted">Could not load dashboard metrics.</p>
        )}
      </div>
    </div>
  );
}
