-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('GC', 'SC');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'SELF_EXCLUDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'REVIEW_REQUIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "KycLevel" AS ENUM ('NONE', 'BASIC', 'FULL');

-- CreateEnum
CREATE TYPE "LoginResult" AS ENUM ('SUCCESS', 'FAILED_PASSWORD', 'FAILED_2FA', 'BLOCKED_JURISDICTION', 'BLOCKED_RISK');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('BET', 'WIN', 'REFUND', 'ROLLBACK', 'BONUS', 'PROMO_GRANT', 'DAILY_BONUS', 'PURCHASE', 'REDEMPTION_HOLD', 'REDEMPTION_PAYOUT', 'REDEMPTION_REVERSAL', 'ADMIN_ADJUSTMENT', 'VIP_REWARD');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('GAME', 'PROMOTION', 'PAYMENT', 'REDEMPTION', 'ADMIN', 'VIP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "GameRoundStatus" AS ENUM ('OPEN', 'SETTLED', 'REFUNDED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "GameProviderType" AS ENUM ('INTERNAL', 'AGGREGATOR', 'LIVE_DEALER');

-- CreateEnum
CREATE TYPE "GameProviderStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'DISABLED');

-- CreateEnum
CREATE TYPE "GameCategory" AS ENUM ('ORIGINALS', 'SLOTS', 'LIVE_CASINO', 'TABLE_GAMES', 'GAME_SHOWS');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "Volatility" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('SIGNUP', 'DAILY', 'WEEKLY', 'MONTHLY', 'LEADERBOARD', 'RAFFLE', 'CHALLENGE', 'GAME_SPECIFIC', 'PROVIDER', 'PROMO_CODE', 'PURCHASE', 'SOCIAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "PromotionCurrency" AS ENUM ('GC', 'SC', 'BOTH');

-- CreateEnum
CREATE TYPE "PromotionClaimStatus" AS ENUM ('GRANTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AmoeMethod" AS ENUM ('MAIL_IN', 'WEB_FORM', 'OTHER');

-- CreateEnum
CREATE TYPE "AmoeStatus" AS ENUM ('RECEIVED', 'UNDER_REVIEW', 'DUPLICATE', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VipRewardType" AS ENUM ('RANK_UP', 'WEEKLY', 'MONTHLY', 'RAKEBACK', 'RELOAD', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'ACH', 'PAYPAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('PURCHASE', 'REFUND', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('DRAFT', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiskOutcome" AS ENUM ('PASS', 'REVIEW', 'LIMIT', 'BLOCK');

-- CreateEnum
CREATE TYPE "JurisdictionStatus" AS ENUM ('ALLOWED', 'GC_ONLY', 'SC_DISABLED', 'REGISTRATION_DISABLED', 'REDEMPTION_DISABLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AdminRoleKey" AS ENUM ('SUPER_ADMIN', 'COMPLIANCE', 'FINANCE', 'SUPPORT', 'VIP_MANAGER', 'FRAUD_ANALYST', 'CONTENT_MANAGER', 'GAME_MANAGER', 'MODERATOR');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED_OPT_OUT');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'PENDING_USER', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('VISIBLE', 'DELETED_BY_MOD', 'FLAGGED');

-- CreateEnum
CREATE TYPE "ChatModerationAction" AS ENUM ('MUTE', 'BAN', 'SLOW_MODE', 'WARN');

-- CreateEnum
CREATE TYPE "LeaderboardPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('ID_FRONT', 'ID_BACK', 'SELFIE', 'PROOF_OF_ADDRESS');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password_hash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name_masked" BOOLEAN NOT NULL DEFAULT false,
    "date_of_birth" DATE NOT NULL,
    "state_of_record" CHAR(2),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "totp_secret_enc" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "backup_codes_enc" TEXT[],
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" TEXT NOT NULL,
    "avatar_url" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "chat_display_name" TEXT,
    "chat_anonymized" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "device_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fingerprint_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trusted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT,
    "ip" TEXT,
    "geo_state" CHAR(2),
    "result" "LoginResult" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance_before" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "game_round_id" TEXT,
    "payment_id" TEXT,
    "redemption_id" TEXT,
    "promotion_claim_id" TEXT,
    "admin_actor_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rounds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "GameRoundStatus" NOT NULL DEFAULT 'OPEN',
    "bet_amount" DECIMAL(18,2) NOT NULL,
    "win_amount" DECIMAL(18,2),
    "multiplier" DECIMAL(10,4),
    "server_seed_hash" TEXT NOT NULL,
    "server_seed_revealed" TEXT,
    "client_seed" TEXT NOT NULL,
    "nonce" BIGINT NOT NULL,
    "result_payload" JSONB NOT NULL,
    "provider_id" TEXT,
    "provider_round_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provably_fair_seeds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "server_seed" TEXT NOT NULL,
    "server_seed_hash" TEXT NOT NULL,
    "client_seed" TEXT NOT NULL,
    "nonce_counter" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revealed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provably_fair_seeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_providers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GameProviderType" NOT NULL,
    "status" "GameProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB,

    CONSTRAINT "game_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_game_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "GameCategory" NOT NULL,
    "tags" TEXT[],
    "image_url" TEXT,
    "supported_currencies" "Currency"[],
    "demo_available" BOOLEAN NOT NULL DEFAULT false,
    "rtp_bps" INTEGER,
    "volatility" "Volatility",
    "status" "GameStatus" NOT NULL DEFAULT 'ACTIVE',
    "restricted_jurisdictions" TEXT[],
    "sort_weight" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","game_id")
);

-- CreateTable
CREATE TABLE "recently_played" (
    "user_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "last_played_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "play_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recently_played_pkey" PRIMARY KEY ("user_id","game_id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms_url" TEXT,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "jurisdiction_allowlist" TEXT[],
    "min_account_age_days" INTEGER,
    "requires_kyc" BOOLEAN NOT NULL DEFAULT false,
    "min_vip_level_id" TEXT,
    "eligible_game_ids" TEXT[],
    "eligible_currency" "PromotionCurrency" NOT NULL DEFAULT 'BOTH',
    "reward_config" JSONB NOT NULL,
    "playthrough_requirement" JSONB,
    "claim_limit_per_user" INTEGER,
    "max_participants" INTEGER,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_claims" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "claim_sequence" INTEGER NOT NULL DEFAULT 1,
    "status" "PromotionClaimStatus" NOT NULL DEFAULT 'GRANTED',
    "granted_amount" DECIMAL(18,2),
    "currency" "Currency",
    "playthrough_progress" JSONB,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "promotion_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amoe_requests" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT,
    "user_id" TEXT NOT NULL,
    "method" "AmoeMethod" NOT NULL,
    "submission_ref" TEXT,
    "status" "AmoeStatus" NOT NULL DEFAULT 'RECEIVED',
    "reviewed_by" TEXT,
    "reason" TEXT,
    "sc_awarded" DECIMAL(18,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "amoe_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vip_levels" (
    "id" TEXT NOT NULL,
    "rank_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "min_points" DECIMAL(18,2) NOT NULL,
    "gc_points_multiplier" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "sc_points_multiplier" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "benefits" JSONB,
    "rank_up_reward" JSONB,
    "weekly_reward" JSONB,
    "monthly_reward" JSONB,
    "rakeback_bps" INTEGER,

    CONSTRAINT "vip_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vip_progress" (
    "user_id" TEXT NOT NULL,
    "current_level_id" TEXT NOT NULL,
    "lifetime_points" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "period_points" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_progress_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "vip_rewards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vip_level_id" TEXT NOT NULL,
    "type" "VipRewardType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "ledger_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vip_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "status" "PaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gc_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gc_amount" DECIMAL(18,2) NOT NULL,
    "bonus_sc_promo_id" TEXT,
    "price_usd" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "gc_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payment_method_id" TEXT,
    "provider_id" TEXT NOT NULL,
    "provider_payment_ref" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "gc_package_id" TEXT,
    "amount_usd" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "risk_signals" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'DRAFT',
    "sc_amount" DECIMAL(18,2) NOT NULL,
    "payout_method_id" TEXT,
    "eligibility_snapshot" JSONB NOT NULL,
    "risk_review" JSONB,
    "decided_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_audit" (
    "id" TEXT NOT NULL,
    "redemption_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redemption_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "provider" TEXT,
    "provider_session_ref" TEXT,
    "level" "KycLevel" NOT NULL DEFAULT 'NONE',
    "reviewed_by" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" TEXT NOT NULL,
    "kyc_record_id" TEXT NOT NULL,
    "type" "KycDocumentType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "signal_type" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "action" "RiskOutcome" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "signal_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "outcome" "RiskOutcome" NOT NULL,
    "details" JSONB,
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "state" CHAR(2) NOT NULL,
    "status" "JurisdictionStatus" NOT NULL DEFAULT 'REGISTRATION_DISABLED',
    "min_age" INTEGER NOT NULL DEFAULT 21,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "compliance_config_versions" (
    "id" TEXT NOT NULL,
    "config_key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "changed_by" TEXT,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout_meta" JSONB,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "responsible_play_controls" (
    "user_id" TEXT NOT NULL,
    "deposit_limit_daily" DECIMAL(18,2),
    "deposit_limit_weekly" DECIMAL(18,2),
    "deposit_limit_monthly" DECIMAL(18,2),
    "session_reminder_minutes" INTEGER,
    "cooling_off_until" TIMESTAMP(3),
    "self_exclusion_until" TIMESTAMP(3),
    "self_exclusion_permanent" BOOLEAN NOT NULL DEFAULT false,
    "self_excluded_at" TIMESTAMP(3),
    "marketing_opt_out" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "responsible_play_controls_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ChatMessageStatus" NOT NULL DEFAULT 'VISIBLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_moderation_actions" (
    "id" TEXT NOT NULL,
    "moderator_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "action" "ChatModerationAction" NOT NULL,
    "duration_minutes" INTEGER,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT,
    "period" "LeaderboardPeriod" NOT NULL,
    "metric" TEXT NOT NULL,
    "rankings" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" TEXT NOT NULL,
    "key" "AdminRoleKey" NOT NULL,
    "permissions" JSONB NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "role_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "old_state" JSONB,
    "new_state" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_user_id" TEXT,
    "author_admin_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "event_name" TEXT NOT NULL,
    "properties" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "devices_fingerprint_hash_idx" ON "devices"("fingerprint_hash");

-- CreateIndex
CREATE INDEX "login_events_user_id_idx" ON "login_events"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_currency_key" ON "wallets"("user_id", "currency");

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_created_at_idx" ON "ledger_entries"("wallet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_wallet_id_idempotency_key_key" ON "ledger_entries"("wallet_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "game_rounds_user_id_created_at_idx" ON "game_rounds"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "game_rounds_game_id_idx" ON "game_rounds"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_provider_id_provider_round_ref_key" ON "game_rounds"("provider_id", "provider_round_ref");

-- CreateIndex
CREATE INDEX "provably_fair_seeds_user_id_active_idx" ON "provably_fair_seeds"("user_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "game_providers_code_key" ON "game_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");

-- CreateIndex
CREATE INDEX "games_category_idx" ON "games"("category");

-- CreateIndex
CREATE INDEX "games_status_idx" ON "games"("status");

-- CreateIndex
CREATE INDEX "promotions_type_status_idx" ON "promotions"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_claims_promotion_id_user_id_claim_sequence_key" ON "promotion_claims"("promotion_id", "user_id", "claim_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "vip_levels_rank_order_key" ON "vip_levels"("rank_order");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_id_provider_payment_ref_key" ON "payments"("provider_id", "provider_payment_ref");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_config_versions_config_key_version_key" ON "compliance_config_versions"("config_key", "version");

-- CreateIndex
CREATE INDEX "chat_messages_room_created_at_idx" ON "chat_messages"("room", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_key_key" ON "admin_roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_user_id_key" ON "admin_users"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_created_at_idx" ON "audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_event_name_created_at_idx" ON "analytics_events"("event_name", "created_at");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_game_round_id_fkey" FOREIGN KEY ("game_round_id") REFERENCES "game_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "redemptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_promotion_claim_id_fkey" FOREIGN KEY ("promotion_claim_id") REFERENCES "promotion_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_admin_actor_id_fkey" FOREIGN KEY ("admin_actor_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "game_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provably_fair_seeds" ADD CONSTRAINT "provably_fair_seeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "game_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_played" ADD CONSTRAINT "recently_played_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_played" ADD CONSTRAINT "recently_played_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_min_vip_level_id_fkey" FOREIGN KEY ("min_vip_level_id") REFERENCES "vip_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_claims" ADD CONSTRAINT "promotion_claims_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_claims" ADD CONSTRAINT "promotion_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amoe_requests" ADD CONSTRAINT "amoe_requests_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amoe_requests" ADD CONSTRAINT "amoe_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amoe_requests" ADD CONSTRAINT "amoe_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_progress" ADD CONSTRAINT "vip_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_progress" ADD CONSTRAINT "vip_progress_current_level_id_fkey" FOREIGN KEY ("current_level_id") REFERENCES "vip_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_rewards" ADD CONSTRAINT "vip_rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_gc_package_id_fkey" FOREIGN KEY ("gc_package_id") REFERENCES "gc_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_payout_method_id_fkey" FOREIGN KEY ("payout_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_audit" ADD CONSTRAINT "redemption_audit_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_records" ADD CONSTRAINT "kyc_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_records" ADD CONSTRAINT "kyc_records_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kyc_record_id_fkey" FOREIGN KEY ("kyc_record_id") REFERENCES "kyc_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "risk_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_config_versions" ADD CONSTRAINT "compliance_config_versions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsible_play_controls" ADD CONSTRAINT "responsible_play_controls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_moderation_actions" ADD CONSTRAINT "chat_moderation_actions_moderator_id_fkey" FOREIGN KEY ("moderator_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
