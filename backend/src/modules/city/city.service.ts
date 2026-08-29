import { DEFAULT_BLOCK_BUDGET, DEFAULT_GRID_SIZE } from '../../config/constants.js';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { generateId, IdPrefix } from '../../lib/ids.js';
import { blockCostById } from './catalog/index.js';
import type {
  BlockMutationResult,
  City,
  CitySummary,
  PlacedBlock,
  PlacedBlockInput,
  SimulationResult,
  SimulationResultInput,
} from './city.schemas.js';

type Prisma = typeof PrismaClient;
type CityRow = NonNullable<Awaited<ReturnType<Prisma['city']['findFirst']>>>;
type BlockRow = { id: string; typeId: string; x: number; y: number };
type SimRow = NonNullable<Awaited<ReturnType<Prisma['simulationResult']['findUnique']>>>;

const costOf = (typeId: string) => blockCostById.get(typeId) ?? 0;
const sumCost = (blocks: BlockRow[]) => blocks.reduce((total, b) => total + costOf(b.typeId), 0);

function toBlockDto(block: BlockRow): PlacedBlock {
  return { id: block.id, typeId: block.typeId, x: block.x, y: block.y };
}

function toSimulationDto(sim: SimRow): SimulationResult {
  return {
    metrics: sim.metrics as SimulationResult['metrics'],
    journeys: sim.journeys as SimulationResult['journeys'],
    events: sim.events as SimulationResult['events'],
    engineVersion: sim.engineVersion ?? undefined,
    runAt: sim.runAt.toISOString(),
  };
}

function toCityDto(city: CityRow & { blocks: BlockRow[]; simulation: SimRow | null }): City {
  return {
    id: city.id,
    ownerId: city.ownerId,
    name: city.name,
    gridWidth: city.gridWidth,
    gridHeight: city.gridHeight,
    blockBudget: city.blockBudget,
    blocksUsed: sumCost(city.blocks),
    blocks: city.blocks.map(toBlockDto),
    lastSimulation: city.simulation ? toSimulationDto(city.simulation) : null,
    createdAt: city.createdAt.toISOString(),
    updatedAt: city.updatedAt.toISOString(),
  };
}

/** Owner-scoped fetch — 404 (never 403) for another user's city, so existence isn't leaked. */
async function requireCity(prisma: Prisma, ownerId: string, cityId: string) {
  const city = await prisma.city.findFirst({
    where: { id: cityId, ownerId },
    include: { blocks: true, simulation: true },
  });
  if (!city) throw AppError.notFound('City not found.', 'CITY_NOT_FOUND');
  return city;
}

const touchCity = (prisma: Prisma, cityId: string) =>
  prisma.city.update({ where: { id: cityId }, data: {} });

function assertInBounds(city: { gridWidth: number; gridHeight: number }, x: number, y: number) {
  if (x < 0 || y < 0 || x >= city.gridWidth || y >= city.gridHeight) {
    throw AppError.conflict(
      `Cell (${x}, ${y}) is outside the ${city.gridWidth}x${city.gridHeight} grid.`,
      'OUT_OF_BOUNDS',
    );
  }
}

export async function listCities(prisma: Prisma, ownerId: string): Promise<CitySummary[]> {
  const cities = await prisma.city.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
    include: { blocks: true },
  });
  return cities.map((city) => ({
    id: city.id,
    name: city.name,
    blocksUsed: sumCost(city.blocks),
    blockBudget: city.blockBudget,
    updatedAt: city.updatedAt.toISOString(),
  }));
}

export async function createCity(prisma: Prisma, ownerId: string, name?: string): Promise<City> {
  const city = await prisma.city.create({
    data: {
      id: generateId(IdPrefix.city),
      ownerId,
      name: name?.trim() || 'My City',
      gridWidth: DEFAULT_GRID_SIZE,
      gridHeight: DEFAULT_GRID_SIZE,
      blockBudget: DEFAULT_BLOCK_BUDGET,
    },
  });
  return toCityDto({ ...city, blocks: [], simulation: null });
}

export async function getCity(prisma: Prisma, ownerId: string, cityId: string): Promise<City> {
  return toCityDto(await requireCity(prisma, ownerId, cityId));
}

export async function renameCity(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  name: string,
): Promise<City> {
  await requireCity(prisma, ownerId, cityId);
  const city = await prisma.city.update({
    where: { id: cityId },
    data: { name },
    include: { blocks: true, simulation: true },
  });
  return toCityDto(city);
}

export async function deleteCity(prisma: Prisma, ownerId: string, cityId: string): Promise<void> {
  await requireCity(prisma, ownerId, cityId);
  await prisma.city.delete({ where: { id: cityId } });
}

export async function placeBlock(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  input: PlacedBlockInput,
): Promise<BlockMutationResult> {
  const city = await requireCity(prisma, ownerId, cityId);
  assertInBounds(city, input.x, input.y);
  if (city.blocks.some((b) => b.x === input.x && b.y === input.y)) {
    throw AppError.conflict(`Cell (${input.x}, ${input.y}) is already occupied.`, 'CELL_OCCUPIED');
  }
  const blocksUsed = sumCost(city.blocks) + costOf(input.typeId);
  if (blocksUsed > city.blockBudget) {
    throw AppError.conflict(
      `Placing this block would exceed the ${city.blockBudget}-block budget.`,
      'BUDGET_EXCEEDED',
    );
  }

  const block = await prisma.placedBlock.create({
    data: { id: generateId(IdPrefix.block), cityId, typeId: input.typeId, x: input.x, y: input.y },
  });
  await touchCity(prisma, cityId);
  return { block: toBlockDto(block), blocksUsed, blockBudget: city.blockBudget };
}

export async function replaceBlocks(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  blocks: PlacedBlockInput[],
): Promise<City> {
  const city = await requireCity(prisma, ownerId, cityId);

  const seenCells = new Set<string>();
  let blocksUsed = 0;
  for (const block of blocks) {
    assertInBounds(city, block.x, block.y);
    const cell = `${block.x},${block.y}`;
    if (seenCells.has(cell)) {
      throw AppError.conflict(`Two blocks occupy the same cell (${cell}).`, 'CELL_OCCUPIED');
    }
    seenCells.add(cell);
    blocksUsed += costOf(block.typeId);
  }
  if (blocksUsed > city.blockBudget) {
    throw AppError.conflict(
      `This layout would exceed the ${city.blockBudget}-block budget.`,
      'BUDGET_EXCEEDED',
    );
  }

  await prisma.$transaction([
    prisma.placedBlock.deleteMany({ where: { cityId } }),
    prisma.placedBlock.createMany({
      data: blocks.map((b) => ({
        id: generateId(IdPrefix.block),
        cityId,
        typeId: b.typeId,
        x: b.x,
        y: b.y,
      })),
    }),
    prisma.city.update({ where: { id: cityId }, data: {} }),
  ]);

  return getCity(prisma, ownerId, cityId);
}

export async function moveBlock(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  blockId: string,
  target: { x: number; y: number },
): Promise<BlockMutationResult> {
  const city = await requireCity(prisma, ownerId, cityId);
  const block = city.blocks.find((b) => b.id === blockId);
  if (!block) throw AppError.notFound('Block not found.', 'BLOCK_NOT_FOUND');

  assertInBounds(city, target.x, target.y);
  const occupied = city.blocks.some(
    (b) => b.id !== blockId && b.x === target.x && b.y === target.y,
  );
  if (occupied) {
    throw AppError.conflict(
      `Cell (${target.x}, ${target.y}) is already occupied.`,
      'CELL_OCCUPIED',
    );
  }

  const updated = await prisma.placedBlock.update({ where: { id: blockId }, data: target });
  await touchCity(prisma, cityId);
  return {
    block: toBlockDto(updated),
    blocksUsed: sumCost(city.blocks),
    blockBudget: city.blockBudget,
  };
}

export async function removeBlock(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  blockId: string,
): Promise<BlockMutationResult> {
  const city = await requireCity(prisma, ownerId, cityId);
  const block = city.blocks.find((b) => b.id === blockId);
  if (!block) throw AppError.notFound('Block not found.', 'BLOCK_NOT_FOUND');

  await prisma.placedBlock.delete({ where: { id: blockId } });
  await touchCity(prisma, cityId);
  const remaining = city.blocks.filter((b) => b.id !== blockId);
  return {
    block: toBlockDto(block),
    blocksUsed: sumCost(remaining),
    blockBudget: city.blockBudget,
  };
}

export async function saveSimulationResult(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  input: SimulationResultInput,
): Promise<SimulationResult> {
  await requireCity(prisma, ownerId, cityId);
  const saved = await prisma.simulationResult.upsert({
    where: { cityId },
    create: {
      id: generateId(IdPrefix.simulation),
      cityId,
      metrics: input.metrics,
      journeys: input.journeys,
      events: input.events,
      engineVersion: input.engineVersion,
    },
    update: {
      metrics: input.metrics,
      journeys: input.journeys,
      events: input.events,
      engineVersion: input.engineVersion,
      runAt: new Date(),
    },
  });
  await touchCity(prisma, cityId);
  return toSimulationDto(saved);
}

export async function getSimulationResult(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
): Promise<SimulationResult> {
  await requireCity(prisma, ownerId, cityId);
  const sim = await prisma.simulationResult.findUnique({ where: { cityId } });
  if (!sim)
    throw AppError.notFound(
      'No simulation has been saved for this city yet.',
      'SIMULATION_NOT_FOUND',
    );
  return toSimulationDto(sim);
}
