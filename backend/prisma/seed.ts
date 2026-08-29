import { hash } from '@node-rs/argon2';
import { METRIC_NAMES } from '../src/config/constants.js';
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
    x: 9,
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
    y: 8,
    changeType: 'add',
    blockTypeId: 'park',
    targetUpPct: 50,
  },
  {
    id: 'prp_demolish',
    title: 'Remove derelict warehouse',
    description: 'Clear the abandoned warehouse blocking sight lines on the south bank.',
    x: 6,
    y: 9,
    changeType: 'remove',
    blockTypeId: null,
    targetUpPct: 30,
  },
  {
    id: 'prp_heritage_closed',
    title: 'Heritage centre restoration',
    description: 'Restore the old heritage building into a cultural centre.',
    x: 8,
    y: 5,
    changeType: 'replace',
    blockTypeId: 'culture_heritage',
    targetUpPct: 72,
    closed: true,
  },
];

async function seedUsers() {
  const sharedHash = await hash('demo1234');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@city.dev' },
    update: { passwordHash: sharedHash },
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
    update: { passwordHash: sharedHash },
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

/** Demo city for demo@city.dev so FE #1 sees state immediately after login. */
async function seedDemoCity(ownerId: string) {
  const existing = await prisma.city.findFirst({ where: { ownerId } });
  if (existing) return existing;

  const city = await prisma.city.create({
    data: {
      id: 'cty_demo',
      ownerId,
      name: 'Riverside',
    },
  });

  const blocks = [
    { typeId: 'housing', x: 1, y: 1 },
    { typeId: 'housing', x: 2, y: 1 },
    { typeId: 'housing', x: 1, y: 2 },
    { typeId: 'healthcare', x: 5, y: 2 },
    { typeId: 'education', x: 7, y: 3 },
    { typeId: 'transport', x: 3, y: 4 },
    { typeId: 'transport', x: 6, y: 4 },
    { typeId: 'park', x: 4, y: 7 },
    { typeId: 'community_hub', x: 2, y: 6 },
    { typeId: 'technology_hub', x: 7, y: 8 },
    { typeId: 'shared_resource_hub', x: 5, y: 6 },
    { typeId: 'culture_heritage', x: 8, y: 7 },
  ];

  await prisma.placedBlock.createMany({
    data: blocks.map((b) => ({
      id: generateId(IdPrefix.block),
      cityId: city.id,
      typeId: b.typeId,
      x: b.x,
      y: b.y,
    })),
  });

  await prisma.simulationResult.create({
    data: {
      id: generateId(IdPrefix.simulation),
      cityId: city.id,
      metrics: {
        accessibility: 58,
        sustainability: 61,
        efficiency: 54,
        community: 66,
        resilience: 49,
        inclusion: 57,
      },
      journeys: [
        {
          personaId: 'wheelchair_user',
          fromBlockId: null,
          targetService: 'healthcare',
          pathBlockIds: [],
          travelTimeMinutes: 9,
          accessible: true,
          issues: [],
        },
        {
          personaId: 'older_resident',
          fromBlockId: null,
          targetService: 'community_hub',
          pathBlockIds: [],
          travelTimeMinutes: 18,
          accessible: false,
          issues: ['Journey exceeds 12 minutes'],
        },
      ],
      events: [
        {
          eventType: 'flood',
          passed: false,
          affectedBlockIds: [],
          affectedPersonaIds: ['older_resident'],
          summary: 'The flood cut the western route, stranding residents without step-free access.',
        },
      ],
      engineVersion: '0.3.0',
    },
  });

  logger.info(`Seeded demo city "${city.name}" with ${blocks.length} blocks + a simulation result`);
  return city;
}

async function seedProposal(seed: ProposalSeed, voterIds: string[], adminId: string) {
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
      issue: null,
      locationX: seed.x,
      locationY: seed.y,
      changes: [
        {
          op: seed.changeType === 'remove' ? 'remove' : 'place',
          ...(seed.blockTypeId ? { typeId: seed.blockTypeId } : {}),
          x: seed.x,
          y: seed.y,
        },
      ],
      blockCost: 0,
      expectedBenefits: [],
      affectedPersonaIds: [],
      votingMetrics: [...METRIC_NAMES],
      status: seed.closed ? 'approved' : 'open',
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
      data: batch.flatMap((userId, idx) => {
        const support = i + idx < upCount;
        return METRIC_NAMES.map((metric) => ({
          id: generateId(IdPrefix.vote),
          userId,
          proposalId: seed.id,
          metric,
          support,
          value: support ? 'up' : 'down',
        }));
      }),
    });
  }

  const upActual = Math.min(upCount, voterIds.length);
  const downActual = voterIds.length - upActual;
  logger.info(
    `Seeded "${seed.title}" (${seed.id}): ${upActual} up / ${downActual} down${seed.closed ? ' [closed]' : ''}`,
  );
}

async function main() {
  const { admin, demo, voterIds } = await seedUsers();
  await seedDemoCity(demo.id);
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
