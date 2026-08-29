import { hash } from '@node-rs/argon2';
import type { MetricName } from '../src/config/constants.js';
import { prisma } from '../src/lib/db.js';
import { generateId, IdPrefix } from '../src/lib/ids.js';
import { logger } from '../src/lib/logger.js';

const SEED_VOTER_COUNT = 20;

/** How many of `total` voters should support, given a target support percentage. */
const voteSplit = (targetPct: number, total: number) => Math.round((targetPct / 100) * total);

type ProposalSeed = {
  id: string;
  title: string;
  description: string;
  location: { x: number; y: number } | null;
  blockCost: number;
  expectedBenefits: string[];
  affectedPersonaIds: string[];
  targetSupportPct: Partial<Record<MetricName, number>>;
};

const PROPOSALS: ProposalSeed[] = [
  {
    id: 'prp_garden',
    title: 'Add a community garden',
    description: 'Convert one block near the northern housing into a shared community garden.',
    location: { x: 4, y: 2 },
    blockCost: 1,
    expectedBenefits: ['Community connection', 'Sustainability'],
    affectedPersonaIds: ['older_resident', 'parent_stroller'],
    targetSupportPct: { community: 91, sustainability: 78, accessibility: 65, efficiency: 55 },
  },
  {
    id: 'prp_transport',
    title: 'Expand public transport',
    description:
      'Add a second transport line connecting the eastern housing blocks to healthcare and education.',
    location: { x: 7, y: 5 },
    blockCost: 3,
    expectedBenefits: ['Shorter journeys', 'Better accessibility for wheelchair users'],
    affectedPersonaIds: ['wheelchair_user', 'older_resident', 'remote_worker'],
    targetSupportPct: { accessibility: 88, efficiency: 72, resilience: 60, inclusion: 68 },
  },
  {
    id: 'prp_heritage',
    title: 'Convert heritage site into new development',
    description: 'Replace the culture & heritage block on the riverside with additional housing.',
    location: { x: 1, y: 8 },
    blockCost: 2,
    expectedBenefits: ['More housing capacity'],
    affectedPersonaIds: ['non_english_speaker', 'older_resident'],
    targetSupportPct: { community: 30, inclusion: 35, sustainability: 45 },
  },
];

async function seedUsers() {
  const demo = await prisma.user.upsert({
    where: { email: 'demo@city.dev' },
    update: {},
    create: {
      id: generateId(IdPrefix.user),
      email: 'demo@city.dev',
      passwordHash: await hash('demo1234'),
      displayName: 'Demo Resident',
    },
  });

  const voters = [];
  for (let i = 1; i <= SEED_VOTER_COUNT; i++) {
    const email = `seed-voter-${String(i).padStart(2, '0')}@city.dev`;
    voters.push(
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          id: generateId(IdPrefix.user),
          email,
          passwordHash: await hash('seed-voter-password'),
          displayName: `Seed Voter ${i}`,
        },
      }),
    );
  }

  logger.info(`Seeded 1 demo user + ${voters.length} voter accounts`);
  return { demo, voters };
}

async function seedDemoCity(ownerId: string) {
  const existing = await prisma.city.findFirst({ where: { ownerId } });
  if (existing) return existing;

  const city = await prisma.city.create({
    data: {
      id: generateId(IdPrefix.city),
      ownerId,
      name: 'Riverside',
      blocks: {
        create: [
          { id: generateId(IdPrefix.block), typeId: 'housing', x: 2, y: 2 },
          { id: generateId(IdPrefix.block), typeId: 'healthcare', x: 4, y: 3 },
          { id: generateId(IdPrefix.block), typeId: 'transport', x: 3, y: 3 },
          { id: generateId(IdPrefix.block), typeId: 'education', x: 5, y: 5 },
          { id: generateId(IdPrefix.block), typeId: 'park', x: 6, y: 5 },
        ],
      },
    },
  });
  logger.info(`Seeded demo city "${city.name}" (${city.id}) with 5 blocks`);
  return city;
}

async function seedProposal(seed: ProposalSeed, voterIds: string[]) {
  const votingMetrics = Object.keys(seed.targetSupportPct) as MetricName[];

  await prisma.proposal.upsert({
    where: { id: seed.id },
    update: {},
    create: {
      id: seed.id,
      title: seed.title,
      description: seed.description,
      locationX: seed.location?.x ?? null,
      locationY: seed.location?.y ?? null,
      blockCost: seed.blockCost,
      expectedBenefits: seed.expectedBenefits,
      affectedPersonaIds: seed.affectedPersonaIds,
      votingMetrics,
    },
  });

  await prisma.vote.deleteMany({ where: { proposalId: seed.id, userId: { in: voterIds } } });

  const rows: {
    id: string;
    userId: string;
    proposalId: string;
    metric: string;
    support: boolean;
  }[] = [];
  for (const metric of votingMetrics) {
    const supportCount = voteSplit(seed.targetSupportPct[metric] ?? 50, voterIds.length);
    voterIds.forEach((userId, i) => {
      rows.push({
        id: generateId(IdPrefix.vote),
        userId,
        proposalId: seed.id,
        metric,
        support: i < supportCount,
      });
    });
  }
  await prisma.vote.createMany({ data: rows });
  logger.info(
    `Seeded "${seed.title}" (${seed.id}) with ${rows.length} votes across ${votingMetrics.length} metrics`,
  );
}

async function main() {
  const { demo, voters } = await seedUsers();
  await seedDemoCity(demo.id);
  for (const proposal of PROPOSALS) {
    await seedProposal(
      proposal,
      voters.map((v) => v.id),
    );
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
