"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CheckCircle, Gift, Lock } from "@/components/ui/icons";
import { PromoArt } from "@/components/casino/promo-art";
import type { Promotion, PromotionType } from "@/lib/types";
import { cn, formatCoins } from "@/lib/utils";

// Cinematic, entertainment-page-style promo cards. Artwork is layered
// SVG-over-gradient (see promo-art.tsx) — an original per-type motif, no
// copied imagery — so the page reads as a promo wall, not a settings form.

const TYPE_LABELS: Record<string, string> = {
  SIGNUP: "Welcome",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  LEADERBOARD: "Leaderboard",
  RAFFLE: "Raffle",
  CHALLENGE: "Challenge",
  GAME_SPECIFIC: "Game Special",
  PROVIDER: "Provider",
  PROMO_CODE: "Promo Code",
  PURCHASE: "Purchase",
  SOCIAL: "Social",
  MANUAL: "Bonus",
};

/**
 * Best-effort human-readable reward line from the free-form `rewardConfig`
 * JSON. Shapes in active use (see backend reward-config.ts resolveReward()):
 *  - flat grant:      { currency: 'GC'|'SC', amount: '10.00' }
 *  - streak schedule: { schedule: [{ day, gc, sc }], cooldownHours }
 * Anything else degrades to a generic label rather than "[object Object]"
 * or a crash.
 */
export function describeReward(rewardConfig: Record<string, unknown> | undefined): string | null {
  if (!rewardConfig || typeof rewardConfig !== "object") return null;

  const currency = rewardConfig.currency;
  const amount = rewardConfig.amount;
  if ((currency === "GC" || currency === "SC") && typeof amount === "string") {
    const n = Number(amount);
    if (!Number.isNaN(n) && n > 0) {
      return `${formatCoins(n * 100)} ${currency}`;
    }
  }

  const schedule = rewardConfig.schedule;
  if (Array.isArray(schedule) && schedule.length > 0) {
    return "Reward grows the longer your streak";
  }

  return "Reward available";
}

function formatExpiry(endsAt: string | null): { label: string; urgent: boolean } | null {
  if (!endsAt) return null;
  const diffMs = new Date(endsAt).getTime() - Date.now();
  if (diffMs <= 0) return { label: "Ended", urgent: true };
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return { label: `Ends in ${days}d`, urgent: days <= 1 };
  if (hours > 0) return { label: `Ends in ${hours}h`, urgent: true };
  return { label: "Ends soon", urgent: true };
}

function eligibilityHints(promo: Promotion): string[] {
  const hints: string[] = [];
  if (promo.requiresKyc) hints.push("KYC required");
  if (promo.minAccountAgeDays) hints.push(`${promo.minAccountAgeDays}+ day account`);
  if (promo.eligibleCurrency !== "BOTH") hints.push(`${promo.eligibleCurrency} only`);
  return hints;
}

interface PromoCardProps {
  promo: Promotion;
  claimed?: boolean;
  claiming?: boolean;
  onClaim: (id: string) => void;
  index?: number;
}

export function PromoCard({ promo, claimed, claiming, onClaim, index }: PromoCardProps) {
  const rewardLine = describeReward(promo.rewardConfig);
  const expiry = formatExpiry(promo.endsAt);
  const hints = eligibilityHints(promo);

  return (
    <div
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card-lift transition-transform duration-300 ease-premium animate-fade-in-up hover:-translate-y-0.5"
      style={index != null ? { animationDelay: `${Math.min(index, 8) * 40}ms`, animationFillMode: "backwards" } : undefined}
    >
      {/* Large, artwork-forward cinematic banner — layered SVG motif over a
          generated gradient (promo-art.tsx), with a shimmer sweep and
          vignette for extra depth. */}
      <div className={cn("coin-shimmer relative h-36 sm:h-40", claimed && "grayscale")}>
        <PromoArt seed={promo.id} type={promo.type} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
        <div className="bg-casino-vignette absolute inset-0" />
        <div className="relative z-10 flex h-full flex-col justify-between p-4">
          <div className="flex items-start justify-between">
            <Badge variant="gc" className="bg-black/30 text-white backdrop-blur">
              {TYPE_LABELS[promo.type] ?? promo.type.replace(/_/g, " ")}
            </Badge>
            {expiry && (
              <span
                className={cn(
                  "rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur",
                  expiry.urgent && "text-accent-gc"
                )}
              >
                {expiry.label}
              </span>
            )}
          </div>
          <h3 className="text-xl font-black uppercase leading-tight tracking-tight text-white drop-shadow-md sm:text-2xl">
            {promo.name}
          </h3>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {promo.description && (
          <p className="line-clamp-2 flex-1 text-xs text-text-muted">{promo.description}</p>
        )}

        {rewardLine && (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-glow-gold">
            <Gift className="h-4 w-4" /> {rewardLine}
          </p>
        )}

        {hints.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {hints.map((h) => (
              <span
                key={h}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[10px] text-text-muted"
              >
                <Lock className="h-2.5 w-2.5" /> {h}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4">
          {claimed ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-success">
              <CheckCircle className="h-3.5 w-3.5" /> Claimed
            </span>
          ) : (
            <Button
              size="md"
              className="w-full font-black uppercase tracking-wide sm:w-auto"
              onClick={() => onClaim(promo.id)}
              loading={claiming}
            >
              Claim Now
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface PlaceholderPromoCardProps {
  title: string;
  description: string;
  type: PromotionType;
  seed: string;
  index?: number;
}

/**
 * A clearly-marked, disabled "coming soon" card for promotion concepts the
 * backend doesn't run yet (no promotion row, no reward data). Never shows a
 * reward amount or a live claim affordance — this is a roadmap teaser, not
 * a claimable promotion.
 */
export function ComingSoonPromoCard({ title, description, type, seed, index }: PlaceholderPromoCardProps) {
  return (
    <div
      className="group flex flex-col overflow-hidden rounded-2xl border border-dashed border-border bg-surface/60 opacity-80 animate-fade-in-up"
      style={index != null ? { animationDelay: `${Math.min(index, 8) * 40}ms`, animationFillMode: "backwards" } : undefined}
    >
      <div className="relative h-36 sm:h-40">
        <PromoArt seed={seed} type={type} dimmed />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />
        <div className="relative z-10 flex h-full flex-col justify-between p-4">
          <Badge variant="neutral" className="bg-black/40 text-text-muted backdrop-blur">
            <Lock className="mr-1 h-2.5 w-2.5" /> Coming Soon
          </Badge>
          <h3 className="text-xl font-black uppercase leading-tight tracking-tight text-white/70 sm:text-2xl">
            {title}
          </h3>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="flex-1 text-xs text-text-muted">{description}</p>
        <div className="mt-4">
          <Button size="md" variant="secondary" className="w-full cursor-not-allowed font-black uppercase tracking-wide sm:w-auto" disabled>
            Coming Soon
          </Button>
        </div>
      </div>
    </div>
  );
}
