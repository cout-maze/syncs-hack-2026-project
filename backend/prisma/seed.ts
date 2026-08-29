import { hash } from '@node-rs/argon2';
import { prisma } from '../src/lib/db.js';
import { generateId, IdPrefix } from '../src/lib/ids.js';
import { logger } from '../src/lib/logger.js';

const SEED_VOTER_COUNT = 3000;
const VOTER_BATCH_SIZE = 500;

type ProposalSeed = {
  id: string;
  title: string;
  description: string;
  x: number;
  y: number;
  changeType: 'add' | 'replace' | 'remove';
  blockTypeId: string | null;
  targetUpPct: number;
  closed?: boolean;
};

const PROPOSALS: ProposalSeed[] = [
  {
    id: 'prp_lightrail',
    title: 'Light rail stop on Crown St',
    description:
      'Replace the car park with a light rail stop connecting the east side to the hospital precinct.',
    x: 12,
    y: 7,
    changeType: 'replace',
    blockTypeId: 'transport',
    targetUpPct: 85,
  },
  {
    id: 'prp_park_west',
    title: 'West end community park',
    description: 'Add a park on the empty lot at the western edge for families and dog walkers.',
    x: 2,
    y: 15,
    changeType: 'add',
    blockTypeId: 'park',
    targetUpPct: 50,
  },
  {
    id: 'prp_demolish',
    title: 'Remove derelict warehouse',
    description: 'Clear the abandoned warehouse blocking sight lines on the south bank.',
    x: 20,
    y: 30,
    changeType: 'remove',
    blockTypeId: null,
    targetUpPct: 30,
  },
  {
    id: 'prp_heritage_closed',
    title: 'Heritage centre restoration',
    description: 'Restore the old heritage building into a cultural centre.',
    x: 8,
    y: 22,
    changeType: 'replace',
    blockTypeId: 'culture_heritage',
    targetUpPct: 72,
    closed: true,
  },
];

async function seedUsers() {
  const sharedHash = await hash('password123');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@city.dev' },
    update: {},
    create: {
      id: 'usr_admin',
      email: 'admin@city.dev',
      passwordHash: sharedHash,
      displayName: 'City Admin',
      role: 'admin',
    },
  });

  const demo = await prisma.user.upsert({
    where: { email: 'demo@city.dev' },
    update: {},
    create: {
      id: 'usr_demo',
      email: 'demo@city.dev',
      passwordHash: sharedHash,
      displayName: 'Demo Resident',
      role: 'user',
    },
  });

  const voterIds: string[] = [];
  for (let batch = 0; batch < Math.ceil(SEED_VOTER_COUNT / VOTER_BATCH_SIZE); batch++) {
    const start = batch * VOTER_BATCH_SIZE + 1;
    const end = Math.min(start + VOTER_BATCH_SIZE - 1, SEED_VOTER_COUNT);
    const batchData = [];
    for (let i = start; i <= end; i++) {
      const padded = String(i).padStart(4, '0');
      batchData.push({
        id: `usr_voter_${padded}`,
        email: `voter${padded}@city.dev`,
        passwordHash: sharedHash,
        displayName: `Voter ${i}`,
        role: 'user' as const,
      });
    }
    await prisma.user.createMany({ data: batchData });
    voterIds.push(...batchData.map((v) => v.id));
  }

  logger.info(`Seeded admin + demo + ${voterIds.length} voter accounts`);
  return { admin, demo, voterIds };
}

async function seedRealCity() {
  const existing = await prisma.city.findFirst({ where: { kind: 'real' } });
  if (existing) return existing;

  const city = await prisma.city.create({
    data: {
      id: 'cty_real',
      kind: 'real',
      ownerId: null,
      name: 'Rebuildia',
      gridWidth: 40,
      gridHeight: 40,
    },
  });

  const blocks = [
    { blockTypeId: 'housing', x: 5, y: 5 },
    { blockTypeId: 'housing', x: 6, y: 5 },
    { blockTypeId: 'housing', x: 5, y: 6 },
    { blockTypeId: 'healthcare', x: 10, y: 10 },
    { blockTypeId: 'education', x: 15, y: 8 },
    { blockTypeId: 'transport', x: 12, y: 7 },       // prp_lightrail replaces this
    { blockTypeId: 'park', x: 18, y: 12 },
    { blockTypeId: 'community_hub', x: 9, y: 22 },
    { blockTypeId: 'technology_hub', x: 25, y: 15 },
    { blockTypeId: 'shared_resource_hub', x: 14, y: 20 },
    { blockTypeId: 'culture_heritage', x: 8, y: 22 }, // prp_heritage_closed replaces this
    { blockTypeId: 'housing', x: 20, y: 30 },         // prp_demolish removes this
  ];

  await prisma.placedBlock.createMany({
    data: dedupedBlocks.map((b) => ({
      id: generateId(IdPrefix.block),
      cityId: city.id,
      blockTypeId: b.blockTypeId,
      x: b.x,
      y: b.y,
    })),
  });

  logger.info(`Seeded real city "${city.name}" with ${dedupedBlocks.length} blocks`);
  return city;
}

async function seedProposal(
  seed: ProposalSeed,
  voterIds: string[],
  adminId: string,
) {
  await prisma.proposal.upsert({
    where: { id: seed.id },
    update: {},
    create: {
      id: seed.id,
      title: seed.title,
      description: seed.description,
      x: seed.x,
      y: seed.y,
      changeType: seed.changeType,
      blockTypeId: seed.blockTypeId,
      status: seed.closed ? 'closed' : 'open',
      createdById: adminId,
      closedAt: seed.closed ? new Date() : null,
    },
  });

  await prisma.vote.deleteMany({ where: { proposalId: seed.id } });

  const upCount = Math.round((seed.targetUpPct / 100) * voterIds.length);
  const voteBatchSize = 500;
  for (let i = 0; i < voterIds.length; i += voteBatchSize) {
    const batch = voterIds.slice(i, i + voteBatchSize);
    await prisma.vote.createMany({
      data: batch.map((userId, idx) => ({
        id: generateId(IdPrefix.vote),
        userId,
        proposalId: seed.id,
        value: (i + idx) < upCount ? 'up' : 'down',
      })),
    });
  }

  const upActual = Math.min(upCount, voterIds.length);
  const downActual = voterIds.length - upActual;
  logger.info(
    `Seeded "${seed.title}" (${seed.id}): ${upActual} up / ${downActual} down${seed.closed ? ' [closed]' : ''}`,
  );
}

async function main() {
  const { admin, voterIds } = await seedUsers();
  await seedRealCity();
  for (const proposal of PROPOSALS) {
    await seedProposal(proposal, voterIds, admin.id);
  }
  logger.info('Seed complete.');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
