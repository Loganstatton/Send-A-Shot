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
            <StatCard label="Active users (30d)" value={data.activeUsers.toLocaleString()} />
            <StatCard label="New users today" value={data.newUsersToday.toLocaleString()} />
            <StatCard label="Pending KYC" value={data.pendingKycCount.toLocaleString()} />
            <StatCard label="Suspicious accounts" value={data.suspiciousAccountsCount.toLocaleString()} />
            <StatCard label="Active promotions" value={data.activePromotionsCount.toLocaleString()} />
            <StatCard label="GC wagered today" value={formatCoins(Number(data.gcWageredToday) * 100)} accent="gc" />
            <StatCard label="SC wagered today" value={formatCoins(Number(data.scWageredToday) * 100)} accent="sc" />
            <StatCard
              label="Revenue today"
              value={`$${Number(data.revenueTodayUsd).toFixed(2)}`}
              hint={data.note ?? `${data.purchaseCountToday} purchases`}
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
