// Shared types mirroring docs/05-api-design.md response shapes.
// Where the doc is ambiguous about exact field names, a best-effort shape
// is used and called out in the frontend build report.

export type Currency = "GC" | "SC";

export interface ApiEnvelope<T> {
  data: T;
  meta?: { requestId?: string };
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string };
}

export interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string | null;
  dob?: string;
  stateOfRecord?: string;
  kycStatus?: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" | "REVIEW_REQUIRED" | "SUSPENDED";
  vip?: { level: number; levelName: string } | null;
  featureFlags?: Record<string, boolean>;
  isAdmin?: boolean;
  chatAnonymized?: boolean;
  createdAt?: string;
}

export interface WalletBalances {
  gc: { balance: number };
  sc: { balance: number; eligible?: boolean; locked?: number };
}

export interface LedgerEntry {
  id: string;
  currency: Currency;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: string;
  description?: string;
  gameRoundId?: string | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Game {
  id: string;
  slug: string;
  name: string;
  provider: string;
  category: string;
  tags?: string[];
  rtp?: number | null;
  isNew?: boolean;
  isHot?: boolean;
  isFavorite?: boolean;
  thumbSeed?: string;
}

export interface LobbySection {
  key: string;
  title: string;
  games: Game[];
  nextCursor?: string | null;
}

export interface OriginalConfig {
  game: "dice" | "mines" | "plinko";
  minBet: number;
  maxBet: number;
  houseEdge: number;
  serverSeedHash: string;
  currency?: Currency;
}

export interface OriginalRoundResult {
  roundId: string;
  game: string;
  currency: Currency;
  betAmount: number;
  payout: number;
  multiplier: number;
  win: boolean;
  nonce: number;
  resultDetail: Record<string, unknown>;
  balanceAfter: number;
  serverSeedHash: string;
  clientSeed: string;
}

export interface SeedState {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  revealedServerSeed?: string | null;
  rotatedAt?: string;
}

// Matches the real Prisma `Promotion` model — the backend's
// PromotionsService.toPublicPromotion() returns the raw row as-is (see
// backend/src/modules/promotions/promotions.service.ts and
// backend/prisma/schema.prisma). `rewardConfig`'s shape varies by type;
// see backend/src/modules/promotions/lib/reward-config.ts's
// resolveReward() for the shapes actually in use (flat grant or streak
// schedule) — the UI should degrade gracefully for anything else.
export type PromotionType =
  | "SIGNUP"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "LEADERBOARD"
  | "RAFFLE"
  | "CHALLENGE"
  | "GAME_SPECIFIC"
  | "PROVIDER"
  | "PROMO_CODE"
  | "PURCHASE"
  | "SOCIAL"
  | "MANUAL";

export type PromotionStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";

export interface Promotion {
  id: string;
  type: PromotionType;
  name: string;
  description: string | null;
  termsUrl: string | null;
  status: PromotionStatus;
  startsAt: string | null;
  endsAt: string | null;
  jurisdictionAllowlist: string[];
  minAccountAgeDays: number | null;
  requiresKyc: boolean;
  minVipLevelId: string | null;
  eligibleGameIds: string[];
  eligibleCurrency: "GC" | "SC" | "BOTH";
  rewardConfig?: Record<string, unknown>;
  playthroughRequirement?: Record<string, unknown> | null;
  claimLimitPerUser: number | null;
  maxParticipants: number | null;
  createdAt: string;
  updatedAt: string;
}

// A row from PromotionsService.listClaims() — GET /promotions/claims.
export interface PromotionClaim {
  id: string;
  promotionId: string;
  userId: string;
  claimSequence: number;
  status: "GRANTED" | "IN_PROGRESS" | "COMPLETED" | "EXPIRED" | "REVOKED";
  grantedAmount: string | null;
  currency: Currency | null;
  claimedAt: string;
  completedAt: string | null;
  promotion?: { id: string; name: string; type: PromotionType };
}

// Matches backend VipService.getMe() exactly — see
// backend/src/modules/vip/vip.service.ts.
export interface VipSummary {
  currentLevel: { id: string; rankOrder: number; name: string; benefits: string[] | null };
  periodPoints: string;
  lifetimePoints: string;
  progress: {
    pointsIntoLevel: string;
    /** null once there's no next level (top of the ladder). */
    pointsForLevel: string | null;
    pointsNeeded: string | null;
  };
  nextLevel: { name: string; pointsNeeded: string } | null;
  rewardHistorySummary: {
    totalRewards: number;
    recent: Array<{ id: string; type: string; amount: string; currency: Currency; createdAt: string }>;
  };
}

// Matches backend VipService.listLevelsPublic() / PublicVipLevel — the
// public ladder intentionally omits point thresholds (internal formula);
// numeric progress comes from VipSummary.progress instead.
export interface VipLevel {
  id: string;
  rankOrder: number;
  name: string;
  benefits: string[] | null;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  gameId: string;
  gameName: string;
  displayName: string;
  amount: number;
  multiplier: number;
  currency: Currency;
  tab: "all" | "big-wins" | "lucky-wins" | "mine";
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  createdAt: string;
  messages?: { id: string; author: string; body: string; createdAt: string }[];
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category?: string;
}

export interface Session {
  id: string;
  device: string;
  ip?: string;
  lastActiveAt: string;
  current?: boolean;
}

export interface ResponsiblePlayState {
  depositLimit?: number | null;
  wagerLimit?: number | null;
  sessionTimeLimitMinutes?: number | null;
  coolingOffUntil?: string | null;
  selfExcluded?: boolean;
  selfExcludedUntil?: string | null;
}

export interface RedemptionEligibility {
  eligible: boolean;
  blockedBy?: "KYC" | "JURISDICTION" | "BALANCE" | "FLAG" | null;
  message?: string;
}

export interface JurisdictionStatus {
  state: string;
  status: "BLOCKED" | "REGISTRATION_DISABLED" | "SC_DISABLED" | "GC_ONLY" | "REDEMPTION_DISABLED" | "ALLOWED";
  featuresEnabled: string[];
}

// ---- Admin ----
// Matches backend AdminDashboardService.getMetrics() exactly — see
// backend/src/modules/admin/admin-dashboard.service.ts.
export interface AdminDashboardMetrics {
  totalUsers: number;
  activeUsers: number;
  newUsersToday: number;
  gcWageredToday: string;
  scWageredToday: string;
  pendingKycCount: number;
  suspiciousAccountsCount: number;
  activePromotionsCount: number;
  revenueTodayUsd: string;
  purchaseCountToday: number;
  note?: string;
}

export interface AdminUserSummary {
  id: string;
  username: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED" | "SELF_EXCLUDED";
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}
