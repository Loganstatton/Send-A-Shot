import Link from "next/link";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Gift } from "@/components/ui/icons";

export function DailyRewardCard() {
  return (
    <Card className="border-accent-gc/25 bg-accent-gc/5">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-gc/15 text-accent-gc">
          <Gift className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">Daily Bonus</p>
          <p className="text-xs text-text-muted">Come back every day to grow your streak.</p>
        </div>
        <Link href="/rewards/daily-bonus">
          <Button size="sm" variant="primary">
            Claim
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
