import { Promotion, User } from '@prisma/client';

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Server-side eligibility gate shared by GET /promotions (list) and
 * POST /promotions/:id/claim, per docs/05-api-design.md ("Validates
 * eligibility (age of account, jurisdiction, KYC, VIP level, claim limits,
 * max participants)"). Claim-limit / max-participants checks are done
 * separately in PromotionsService (they need claim counts, not just the
 * user/promotion rows).
 */
export function checkEligibility(
  user: Pick<User, 'createdAt' | 'stateOfRecord' | 'kycStatus'>,
  promotion: Pick<
    Promotion,
    'status' | 'startsAt' | 'endsAt' | 'jurisdictionAllowlist' | 'minAccountAgeDays' | 'requiresKyc'
  >,
  now: Date,
  userVipRankOrder: number | null,
  requiredVipRankOrder: number | null,
): EligibilityResult {
  if (promotion.status !== 'ACTIVE') {
    return { eligible: false, reason: 'Promotion is not active.' };
  }

  if (promotion.startsAt && promotion.startsAt > now) {
    return { eligible: false, reason: 'Promotion has not started yet.' };
  }

  if (promotion.endsAt && promotion.endsAt < now) {
    return { eligible: false, reason: 'Promotion has ended.' };
  }

  const allowlist = promotion.jurisdictionAllowlist ?? [];
  if (allowlist.length > 0 && (!user.stateOfRecord || !allowlist.includes(user.stateOfRecord))) {
    return { eligible: false, reason: 'Not available in your jurisdiction.' };
  }

  if (promotion.minAccountAgeDays != null) {
    const accountAgeMs = now.getTime() - user.createdAt.getTime();
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
    if (accountAgeDays < promotion.minAccountAgeDays) {
      return { eligible: false, reason: 'Account does not meet the minimum age requirement.' };
    }
  }

  if (promotion.requiresKyc && user.kycStatus !== 'VERIFIED') {
    return { eligible: false, reason: 'KYC verification is required for this promotion.' };
  }

  if (requiredVipRankOrder != null) {
    if (userVipRankOrder == null || userVipRankOrder < requiredVipRankOrder) {
      return { eligible: false, reason: 'Your VIP level does not qualify for this promotion.' };
    }
  }

  return { eligible: true };
}
