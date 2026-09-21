"use client";

import { useCallback } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { RedemptionEligibility } from "@/lib/types";
import { Lock } from "@/components/ui/icons";

export default function RedemptionsPage() {
  const fetcher = useCallback(() => api.get<RedemptionEligibility>("/redemptions/eligibility"), []);
  const { data, loading } = useFetch(fetcher);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Redemptions</h1>

      {loading && <Skeleton className="h-40 w-full rounded-xl" />}

      {!loading && (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={<Lock className="h-10 w-10" />}
              title="Redemptions are pending compliance approval"
              description={
                data?.message ||
                "Sweeps Coin redemption is disabled by feature flag (redemptions.enabled=false) while jurisdiction, KYC, and payout compliance work is finalized. Your redemption history will appear here once the feature is enabled in your state."
              }
              phase="P2"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
