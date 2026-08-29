import {
  DEFAULT_BLOCK_BUDGET,
  DEFAULT_GRID_HEIGHT,
  DEFAULT_GRID_WIDTH,
} from '../../config/constants.js';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { generateId, IdPrefix } from '../../lib/ids.js';
import { BLOCK_COST, isKnownBlockType } from './catalog/index.js';
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

interface CityRow {
  id: string;
  ownerId: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  blockBudget: number;
  createdAt: Date;
  updatedAt: Date;
}

interface BlockRow {
  id: string;
  typeId: string;
  x: number;
  y: number;
}

interface SimulationRow {
  id: string;
  cityId: string;
  metrics: unknown;
  journeys: unknown;
  events: unknown;
  engineVersion: string | null;
  runAt: Date;
}

// --- DTO helpers -----------------------------------------------------------

function toBlockDto(row: BlockRow): PlacedBlock {
  return { id: row.id, typeId: row.typeId, x: row.x, y: row.y };
}

function toSimulationDto(row: SimulationRow): SimulationResult {
  return {
    metrics: row.metrics as SimulationResult['metrics'],
    journeys: row.journeys as SimulationResult['journeys'],
    events: row.events as SimulationResult['events'],
    engineVersion: row.engineVersion ?? undefined,
    runAt: row.runAt.toISOString(),
  };
}

function sumCost(blocks: { typeId: string }[]): number {
  return blocks.reduce((total, b) => total + (BLOCK_COST[b.typeId] ?? 0), 0);
}

function toCityDto(row: CityRow, blocks: BlockRow[], sim: SimulationRow | null): City {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    gridWidth: row.gridWidth,
    gridHeight: row.gridHeight,
    blockBudget: row.blockBudget,
    blocksUsed: sumCost(blocks),
    blocks: blocks.map(toBlockDto),
    lastSimulation: sim ? toSimulationDto(sim) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Block writes must touch the City row or its @updatedAt never moves. */
function touchCity(prisma: Prisma, cityId: string) {
  return prisma.city.update({ where: { id: cityId }, data: { updatedAt: new Date() } });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

// --- Shared lookups ----------------------------------------------------------

async function requireOwnedCity(prisma: Prisma, ownerId: string, cityId: string): Promise<CityRow> {
  const city = await prisma.city.findUnique({ where: { id: cityId } });
  // Spec convention: unowned and missing are the same 404 — never leak existence.
  if (!city || city.ownerId !== ownerId) {
    throw AppError.notFound('City not found.', 'CITY_NOT_FOUND');
  }
  return city;
}

async function requireCityBlock(
  prisma: Prisma,
  cityId: string,
  blockId: string,
): Promise<BlockRow> {
  const block = await prisma.placedBlock.findFirst({ where: { id: blockId, cityId } });
  if (!block) throw AppError.notFound('Block not found.', 'BLOCK_NOT_FOUND');
  return block;
}

async function blocksUsedIn(prisma: Prisma, cityId: string): Promise<number> {
  const groups = await prisma.placedBlock.groupBy({
    by: ['typeId'],
    where: { cityId },
    _count: { _all: true },
  });
  return groups.reduce((total, g) => total + g._count._all * (BLOCK_COST[g.typeId] ?? 0), 0);
}

function assertBounds(city: CityRow, x: number, y: number): void {
  if (x >= city.gridWidth || y >= city.gridHeight) {
    throw AppError.conflict(
      `Cell (${x}, ${y}) is outside the ${city.gridWidth}×${city.gridHeight} grid.`,
      'OUT_OF_BOUNDS',
    );
  }
}

function assertKnownBlockType(typeId: string, details?: Record<string, unknown>): void {
  if (!isKnownBlockType(typeId)) {
    throw AppError.badRequest(`Unknown block type: "${typeId}".`, 'BLOCK_TYPE_INVALID', details);
  }
}

// --- Catalog is served straight from catalog/index.ts (static seed data) ------

// --- Cities -----------------------------------------------------------------

export async function listCities(prisma: Prisma, ownerId: string): Promise<CitySummary[]> {
  const cities = await prisma.city.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
  });

  const usedByCity = new Map<string, number>();
  if (cities.length > 0) {
    const groups = await prisma.placedBlock.groupBy({
      by: ['cityId', 'typeId'],
      where: { cityId: { in: cities.map((c) => c.id) } },
      _count: { _all: true },
    });
    for (const g of groups) {
      const used = usedByCity.get(g.cityId) ?? 0;
      usedByCity.set(g.cityId, used + g._count._all * (BLOCK_COST[g.typeId] ?? 0));
    }
  }

  return cities.map((c) => ({
    id: c.id,
    name: c.name,
    blocksUsed: usedByCity.get(c.id) ?? 0,
    blockBudget: c.blockBudget,
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function createCity(
  prisma: Prisma,
  ownerId: string,
  input: { name?: string },
): Promise<City> {
  const city = await prisma.city.create({
    data: {
      id: generateId(IdPrefix.city),
      ownerId,
      name: input.name ?? 'My City',
      gridWidth: DEFAULT_GRID_WIDTH,
      gridHeight: DEFAULT_GRID_HEIGHT,
      blockBudget: DEFAULT_BLOCK_BUDGET,
    },
    include: { blocks: true, simulation: true },
  });
  return toCityDto(city, city.blocks, city.simulation);
}

export async function getCity(prisma: Prisma, ownerId: string, cityId: string): Promise<City> {
  const city = await requireOwnedCity(prisma, ownerId, cityId);
  const [blocks, sim] = await Promise.all([
    prisma.placedBlock.findMany({ where: { cityId }, orderBy: [{ y: 'asc' }, { x: 'asc' }] }),
    prisma.simulationResult.findUnique({ where: { cityId } }),
  ]);
  return toCityDto(city, blocks, sim);
}

export async function renameCity(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  name: string,
): Promise<City> {
  await requireOwnedCity(prisma, ownerId, cityId);
  await prisma.city.update({ where: { id: cityId }, data: { name } });
  return getCity(prisma, ownerId, cityId);
}

export async function deleteCity(prisma: Prisma, ownerId: string, cityId: string): Promise<void> {
  await requireOwnedCity(prisma, ownerId, cityId);
  await prisma.city.delete({ where: { id: cityId } });
}

// --- Blocks -----------------------------------------------------------------

export async function placeBlock(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  input: PlacedBlockInput,
): Promise<BlockMutationResult> {
  assertKnownBlockType(input.typeId);
  const city = await requireOwnedCity(prisma, ownerId, cityId);
  assertBounds(city, input.x, input.y);

  const occupied = await prisma.placedBlock.findUnique({
    where: { cityId_x_y: { cityId, x: input.x, y: input.y } },
  });
  if (occupied) {
    throw AppError.conflict(`Cell (${input.x}, ${input.y}) is already occupied.`, 'CELL_OCCUPIED');
  }

  const used = await blocksUsedIn(prisma, cityId);
  const requestedCost = BLOCK_COST[input.typeId] ?? 0;
  if (used + requestedCost > city.blockBudget) {
    throw AppError.conflict(
      `Placing this block would exceed the ${city.blockBudget}-block budget.`,
      'BUDGET_EXCEEDED',
      { blockBudget: city.blockBudget, blocksUsed: used, requestedCost },
    );
  }

  try {
    const [block] = await prisma.$transaction([
      prisma.placedBlock.create({
        data: {
          id: generateId(IdPrefix.block),
          cityId,
          typeId: input.typeId,
          x: input.x,
          y: input.y,
        },
      }),
      touchCity(prisma, cityId),
    ]);
    return {
      block: toBlockDto(block),
      blocksUsed: used + requestedCost,
      blockBudget: city.blockBudget,
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw AppError.conflict(
        `Cell (${input.x}, ${input.y}) is already occupied.`,
        'CELL_OCCUPIED',
      );
    }
    throw err;
  }
}

export async function replaceBlocks(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  input: { blocks: PlacedBlockInput[] },
): Promise<City> {
  const city = await requireOwnedCity(prisma, ownerId, cityId);

  // Validate the whole layout before touching anything — a bad autosave must
  // leave the stored city exactly as it was ("Nothing is saved").
  const seenCells = new Set<string>();
  let totalCost = 0;
  for (const [index, block] of input.blocks.entries()) {
    assertKnownBlockType(block.typeId, { index, typeId: block.typeId });
    assertBounds(city, block.x, block.y);
    const cell = `${block.x},${block.y}`;
    if (seenCells.has(cell)) {
      throw AppError.conflict(
        `Cell (${block.x}, ${block.y}) appears more than once in the submitted layout.`,
        'CELL_OCCUPIED',
        { index },
      );
    }
    seenCells.add(cell);
    totalCost += BLOCK_COST[block.typeId] ?? 0;
  }
  if (totalCost > city.blockBudget) {
    throw AppError.conflict(
      `This layout would exceed the ${city.blockBudget}-block budget.`,
      'BUDGET_EXCEEDED',
      { blockBudget: city.blockBudget, requiredCost: totalCost },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.placedBlock.deleteMany({ where: { cityId } });
    if (input.blocks.length > 0) {
      await tx.placedBlock.createMany({
        data: input.blocks.map((b) => ({
          id: generateId(IdPrefix.block),
          cityId,
          typeId: b.typeId,
          x: b.x,
          y: b.y,
        })),
      });
    }
    await tx.city.update({ where: { id: cityId }, data: { updatedAt: new Date() } });
  });

  return getCity(prisma, ownerId, cityId);
}

export async function moveBlock(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  blockId: string,
  input: { x: number; y: number },
): Promise<BlockMutationResult> {
  const city = await requireOwnedCity(prisma, ownerId, cityId);
  const block = await requireCityBlock(prisma, cityId, blockId);

  const sameCell = block.x === input.x && block.y === input.y;
  if (!sameCell) {
    assertBounds(city, input.x, input.y);
    const occupied = await prisma.placedBlock.findUnique({
      where: { cityId_x_y: { cityId, x: input.x, y: input.y } },
    });
    if (occupied) {
      throw AppError.conflict(
        `Cell (${input.x}, ${input.y}) is already occupied.`,
        'CELL_OCCUPIED',
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.placedBlock.update({
      where: { id: block.id },
      data: { x: input.x, y: input.y },
    });
    if (!sameCell) {
      await tx.city.update({ where: { id: cityId }, data: { updatedAt: new Date() } });
    }
    return row;
  });

  const used = await blocksUsedIn(prisma, cityId);
  return { block: toBlockDto(updated), blocksUsed: used, blockBudget: city.blockBudget };
}

export async function removeBlock(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  blockId: string,
): Promise<BlockMutationResult> {
  const city = await requireOwnedCity(prisma, ownerId, cityId);
  const block = await requireCityBlock(prisma, cityId, blockId);

  await prisma.$transaction([
    prisma.placedBlock.delete({ where: { id: block.id } }),
    touchCity(prisma, cityId),
  ]);

  const used = await blocksUsedIn(prisma, cityId);
  return { block: toBlockDto(block), blocksUsed: used, blockBudget: city.blockBudget };
}

// --- Simulation storage (the engine runs client-side; we only persist) --------

export async function saveSimulationResult(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
  input: SimulationResultInput,
): Promise<SimulationResult> {
  await requireOwnedCity(prisma, ownerId, cityId);

  const runAt = new Date();
  const data = {
    metrics: input.metrics,
    journeys: input.journeys,
    events: input.events,
    engineVersion: input.engineVersion ?? null,
    runAt,
  };

  const existing = await prisma.simulationResult.findUnique({ where: { cityId } });
  const row = existing
    ? await prisma.simulationResult.update({ where: { cityId }, data })
    : await prisma.simulationResult.create({
        data: { id: generateId(IdPrefix.simulation), cityId, ...data },
      });

  return toSimulationDto(row);
}

export async function getSimulationResult(
  prisma: Prisma,
  ownerId: string,
  cityId: string,
): Promise<SimulationResult> {
  await requireOwnedCity(prisma, ownerId, cityId);
  const row = await prisma.simulationResult.findUnique({ where: { cityId } });
  if (!row) {
    throw AppError.notFound(
      'No simulation has been saved for this city yet.',
      'SIMULATION_NOT_FOUND',
    );
  }
  return toSimulationDto(row);
}
