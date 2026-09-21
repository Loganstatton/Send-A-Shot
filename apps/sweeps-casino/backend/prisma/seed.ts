/* eslint-disable no-console */
import { PrismaClient, AdminRoleKey, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { hashServerSeed, generateServerSeed, generateClientSeed } from '../src/libs/provably-fair/provably-fair';

const prisma = new PrismaClient();

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

const DEMO_ALLOWED_STATES = (process.env.DEMO_ALLOWED_STATES ?? 'NJ,PA').split(',');

const DEMO_PASSWORD = 'DemoPass123!';

async function seedJurisdictions() {
  console.log(`Seeding ${US_STATES.length} jurisdictions (demo-allowed: ${DEMO_ALLOWED_STATES.join(', ')})...`);
  for (const state of US_STATES) {
    const allowed = DEMO_ALLOWED_STATES.includes(state);
    await prisma.jurisdiction.upsert({
      where: { state },
      create: {
        state,
        status: allowed ? 'ALLOWED' : 'REGISTRATION_DISABLED',
        minAge: 21,
      },
      update: {},
    });
  }
}

async function seedFeatureFlags() {
  const flags: Array<{ key: string; enabled: boolean }> = [
    { key: 'sc.enabled', enabled: false },
    { key: 'sc.promotional_issuance_enabled', enabled: false },
    { key: 'originals.sc_enabled', enabled: false },
    { key: 'payments.purchases_enabled', enabled: false },
    { key: 'redemptions.enabled', enabled: false },
    { key: 'kyc.required_for_redemption', enabled: true },
    { key: 'geolocation.enforcement_enabled', enabled: true },
  ];
  console.log(`Seeding ${flags.length} feature flags (all SC-adjacent flags default OFF)...`);
  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: { key: flag.key, enabled: flag.enabled },
      update: {},
    });
  }
}

const ADMIN_ROLE_PERMISSIONS: Record<string, { all: true } | string[]> = {
  SUPER_ADMIN: { all: true },
  COMPLIANCE: [
    'compliance.jurisdictions.read', 'compliance.jurisdictions.write',
    'compliance.flags.read', 'compliance.flags.write',
    'kyc.review', 'kyc.view_documents',
    'redemptions.decide',
    'admin.dashboard.view', 'admin.users.view', 'admin.audit_log.view',
  ],
  FINANCE: [
    'wallet.view_ledger', 'wallet.adjust_balance',
    'payments.view', 'redemptions.decide',
    'admin.dashboard.view', 'admin.users.view', 'admin.audit_log.view',
  ],
  SUPPORT: [
    'support.manage', 'admin.users.view', 'admin.users.manage',
    'admin.dashboard.view',
  ],
  VIP_MANAGER: ['vip.manage', 'promotions.manage', 'admin.dashboard.view', 'admin.users.view'],
  FRAUD_ANALYST: [
    'risk.view', 'risk.resolve', 'admin.users.view',
    'admin.dashboard.view', 'admin.audit_log.view',
  ],
  CONTENT_MANAGER: ['games.manage', 'promotions.manage', 'admin.dashboard.view'],
  GAME_MANAGER: ['games.manage', 'admin.dashboard.view'],
  MODERATOR: ['admin.users.view', 'admin.dashboard.view'],
};

async function seedAdminRoles() {
  console.log('Seeding admin roles...');
  const roles: Record<string, string> = {};
  for (const [key, permissions] of Object.entries(ADMIN_ROLE_PERMISSIONS)) {
    const roleKey = key as AdminRoleKey;
    const role = await prisma.adminRole.upsert({
      where: { key: roleKey },
      create: { key: roleKey, permissions: permissions as object },
      update: { permissions: permissions as object },
    });
    roles[key] = role.id;
  }
  return roles;
}

const VIP_LADDER = [
  { rankOrder: 1, name: 'Starter', minPoints: '0' },
  { rankOrder: 2, name: 'Bronze', minPoints: '1000' },
  { rankOrder: 3, name: 'Silver', minPoints: '5000' },
  { rankOrder: 4, name: 'Gold', minPoints: '15000' },
  { rankOrder: 5, name: 'Platinum I', minPoints: '35000' },
  { rankOrder: 6, name: 'Platinum II', minPoints: '75000' },
  { rankOrder: 7, name: 'Platinum III', minPoints: '150000' },
  { rankOrder: 8, name: 'Platinum IV', minPoints: '300000' },
  { rankOrder: 9, name: 'Diamond', minPoints: '600000' },
  { rankOrder: 10, name: 'Elite', minPoints: '1200000' },
];

async function seedVipLevels() {
  console.log(`Seeding ${VIP_LADDER.length} VIP levels...`);
  const levels: Record<number, string> = {};
  for (const level of VIP_LADDER) {
    const created = await prisma.vipLevel.upsert({
      where: { rankOrder: level.rankOrder },
      create: {
        rankOrder: level.rankOrder,
        name: level.name,
        minPoints: level.minPoints,
        gcPointsMultiplier: '1.0',
        scPointsMultiplier: '2.0',
        benefits: { description: `${level.name} tier benefits` },
        rankUpReward:
          level.rankOrder > 1
            ? { currency: 'GC', amount: (level.rankOrder * 25).toFixed(2) }
            : Prisma.JsonNull,
      },
      update: {},
    });
    levels[level.rankOrder] = created.id;
  }
  return levels;
}

async function seedCasinoCatalog() {
  console.log('Seeding internal game provider + Originals catalog...');
  const provider = await prisma.gameProvider.upsert({
    where: { code: 'internal-originals' },
    create: { code: 'internal-originals', name: 'House Originals', type: 'INTERNAL', status: 'ACTIVE' },
    update: {},
  });

  const games = [
    { slug: 'dice', name: 'Dice', tags: ['HOT'], rtpBps: 9900, volatility: 'LOW' as const },
    { slug: 'mines', name: 'Mines', tags: ['NEW'], rtpBps: 9900, volatility: 'MEDIUM' as const },
    { slug: 'plinko', name: 'Plinko', tags: ['NEW', 'HOT'], rtpBps: 9900, volatility: 'HIGH' as const },
  ];

  for (const [i, g] of games.entries()) {
    await prisma.game.upsert({
      where: { slug: g.slug },
      create: {
        providerId: provider.id,
        providerGameId: g.slug,
        name: g.name,
        slug: g.slug,
        category: 'ORIGINALS',
        tags: g.tags,
        supportedCurrencies: ['GC', 'SC'],
        demoAvailable: true,
        rtpBps: g.rtpBps,
        volatility: g.volatility,
        status: 'ACTIVE',
        restrictedJurisdictions: [],
        sortWeight: 100 - i,
      },
      update: {},
    });
  }
}

async function seedDailyBonusPromotion() {
  console.log('Seeding the daily bonus promotion...');
  const existing = await prisma.promotion.findFirst({ where: { type: 'DAILY', status: 'ACTIVE' } });
  if (existing) return;

  await prisma.promotion.create({
    data: {
      type: 'DAILY',
      name: 'Daily Login Bonus',
      description: 'Claim free Gold Coins every day — the streak resets if you miss a day.',
      status: 'ACTIVE',
      eligibleCurrency: 'GC',
      rewardConfig: {
        cooldownHours: 20,
        schedule: [
          { day: 1, gc: '25.00', sc: '0' },
          { day: 2, gc: '35.00', sc: '0' },
          { day: 3, gc: '50.00', sc: '0' },
          { day: 4, gc: '75.00', sc: '0' },
          { day: 5, gc: '100.00', sc: '0' },
          { day: 6, gc: '150.00', sc: '0' },
          { day: 7, gc: '250.00', sc: '0' },
        ],
      },
    },
  });
}

interface DemoUserSpec {
  email: string;
  username: string;
  stateOfRecord: string;
  gcBalance: string;
  scBalance: string;
  vipRankOrder: number;
  adminRoleKey?: keyof typeof ADMIN_ROLE_PERMISSIONS;
}

const DEMO_USERS: DemoUserSpec[] = [
  {
    email: 'player@demo.sweeps-casino.local',
    username: 'demoplayer',
    stateOfRecord: DEMO_ALLOWED_STATES[0] ?? 'NJ',
    gcBalance: '5000.00',
    scBalance: '10.00',
    vipRankOrder: 1,
  },
  {
    email: 'vip-player@demo.sweeps-casino.local',
    username: 'demovipplayer',
    stateOfRecord: DEMO_ALLOWED_STATES[0] ?? 'NJ',
    gcBalance: '50000.00',
    scBalance: '100.00',
    vipRankOrder: 4,
  },
  {
    email: 'support-admin@demo.sweeps-casino.local',
    username: 'supportadmin',
    stateOfRecord: DEMO_ALLOWED_STATES[0] ?? 'NJ',
    gcBalance: '0.00',
    scBalance: '0.00',
    vipRankOrder: 1,
    adminRoleKey: 'SUPPORT',
  },
  {
    email: 'compliance-admin@demo.sweeps-casino.local',
    username: 'complianceadmin',
    stateOfRecord: DEMO_ALLOWED_STATES[0] ?? 'NJ',
    gcBalance: '0.00',
    scBalance: '0.00',
    vipRankOrder: 1,
    adminRoleKey: 'COMPLIANCE',
  },
  {
    email: 'super-admin@demo.sweeps-casino.local',
    username: 'superadmin',
    stateOfRecord: DEMO_ALLOWED_STATES[0] ?? 'NJ',
    gcBalance: '0.00',
    scBalance: '0.00',
    vipRankOrder: 1,
    adminRoleKey: 'SUPER_ADMIN',
  },
];

async function seedDemoUsers(vipLevels: Record<number, string>, adminRoles: Record<string, string>) {
  console.log(`Seeding ${DEMO_USERS.length} demo accounts (password: ${DEMO_PASSWORD})...`);
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  for (const spec of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      create: {
        email: spec.email,
        username: spec.username,
        passwordHash,
        dateOfBirth: new Date('1990-01-01'),
        stateOfRecord: spec.stateOfRecord,
        emailVerifiedAt: new Date(),
        kycStatus: 'VERIFIED',
      },
      update: {},
    });

    await prisma.wallet.upsert({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
      create: { userId: user.id, currency: 'GC', balance: spec.gcBalance },
      update: {},
    });
    await prisma.wallet.upsert({
      where: { userId_currency: { userId: user.id, currency: 'SC' } },
      create: { userId: user.id, currency: 'SC', balance: spec.scBalance },
      update: {},
    });

    // Seed matching ledger entries so reconciliation is clean from day one.
    const gcWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    await prisma.ledgerEntry.upsert({
      where: { walletId_idempotencyKey: { walletId: gcWallet.id, idempotencyKey: `seed:${user.id}:gc` } },
      create: {
        walletId: gcWallet.id,
        currency: 'GC',
        type: 'ADMIN_ADJUSTMENT',
        amount: spec.gcBalance,
        balanceBefore: '0',
        balanceAfter: spec.gcBalance,
        source: 'SYSTEM',
        idempotencyKey: `seed:${user.id}:gc`,
        metadata: { reason: 'Seed script demo balance' },
      },
      update: {},
    });
    const scWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'SC' } },
    });
    await prisma.ledgerEntry.upsert({
      where: { walletId_idempotencyKey: { walletId: scWallet.id, idempotencyKey: `seed:${user.id}:sc` } },
      create: {
        walletId: scWallet.id,
        currency: 'SC',
        type: 'ADMIN_ADJUSTMENT',
        amount: spec.scBalance,
        balanceBefore: '0',
        balanceAfter: spec.scBalance,
        source: 'SYSTEM',
        idempotencyKey: `seed:${user.id}:sc`,
        metadata: { reason: 'Seed script demo balance' },
      },
      update: {},
    });

    await prisma.responsiblePlayControls.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
    await prisma.notificationPreferences.upsert({
      where: { userId: user.id },
      create: { userId: user.id, preferences: {} },
      update: {},
    });

    const vipLevelId = vipLevels[spec.vipRankOrder];
    if (vipLevelId) {
      await prisma.vipProgress.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          currentLevelId: vipLevelId,
          lifetimePoints:
            VIP_LADDER.find((l) => l.rankOrder === spec.vipRankOrder)?.minPoints ?? '0',
        },
        update: {},
      });
    }

    // Give each demo user an active provably-fair seed so Originals work immediately.
    const existingSeed = await prisma.provablyFairSeed.findFirst({
      where: { userId: user.id, active: true },
    });
    if (!existingSeed) {
      const seed = generateServerSeed();
      await prisma.provablyFairSeed.create({
        data: {
          userId: user.id,
          serverSeed: seed,
          serverSeedHash: hashServerSeed(seed),
          clientSeed: generateClientSeed(),
          active: true,
        },
      });
    }

    if (spec.adminRoleKey) {
      const roleId = adminRoles[spec.adminRoleKey];
      await prisma.adminUser.upsert({
        where: { userId: user.id },
        create: { userId: user.id, roleId, active: true },
        update: { roleId, active: true },
      });
    }
  }
}

async function main() {
  console.log('--- Seeding sweeps-casino Phase 1 demo data ---');
  await seedJurisdictions();
  await seedFeatureFlags();
  const adminRoles = await seedAdminRoles();
  const vipLevels = await seedVipLevels();
  await seedCasinoCatalog();
  await seedDailyBonusPromotion();
  await seedDemoUsers(vipLevels, adminRoles);
  console.log('--- Seed complete ---');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
