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
  kycStatus?: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED" | "REVIEW_REQUIRED";
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

export interface Promotion {
  id: string;
  type: "DAILY_BONUS" | "WELCOME" | "RELOAD" | "CHALLENGE" | "RAFFLE" | string;
  title: string;
  description: string;
  status: "active" | "inactive";
  terms?: string;
  rewardConfig?: Record<string, unknown>;
}

export interface VipSummary {
  level: number;
  levelName: string;
  progress: number;
  progressTarget: number;
  nextLevelName?: string | null;
  benefits: string[];
  lifetimeWagered?: number;
}

export interface VipLevel {
  level: number;
  name: string;
  requiredPoints: number;
  benefits: string[];
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
export interface AdminDashboardMetrics {
  totalUsers: number;
  newUsersToday: number;
  gcActivity: { wagered: number; won: number };
  scActivity: { wagered: number; won: number };
  pendingKyc: number;
  activePromotions: number;
  revenue: { purchases: number; redemptions: number };
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
