import { Router } from "express";
import {
  DEFAULT_BLOCK_BUDGET,
  GRID_SIZE,
  placedBlockInputSchema,
  simulationResultInputSchema,
} from "@rmc/shared";
import { BLOCK_TYPES, PERSONAS, costOf } from "../../data/catalog";
import { requireUser } from "../../lib/auth";
import { HttpError } from "../../lib/errors";
import { id, nowIso } from "../../lib/ids";
import { store, type CityRow } from "../../lib/store";

export const cityRouter = Router();

function blocksUsed(blocks: CityRow["blocks"]) {
  return blocks.reduce((sum, block) => sum + costOf(block.typeId), 0);
}

function toCity(row: CityRow) {
  return {
    ...row,
    blocksUsed: blocksUsed(row.blocks),
    lastSimulation: row.lastSimulation,
  };
}

function ownedCity(userId: string, cityId: string) {
  const city = store.read().cities.find((row) => row.id === cityId && row.ownerId === userId);
  if (!city) throw new HttpError(404, "NOT_FOUND", "City not found.");
  return city;
}

function validateLayout(
  blocks: Array<{ typeId: string; x: number; y: number }>,
  width: number,
  height: number,
  budget: number,
) {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.x < 0 || block.y < 0 || block.x >= width || block.y >= height) {
      throw new HttpError(409, "OUT_OF_BOUNDS", "A block is outside the grid.", {
        x: block.x,
        y: block.y,
      });
    }
    const key = `${block.x},${block.y}`;
    if (seen.has(key)) {
      throw new HttpError(409, "CELL_OCCUPIED", "Two blocks occupy the same cell.", {
        x: block.x,
        y: block.y,
      });
    }
    seen.add(key);
  }
  const used = blocks.reduce((sum, block) => sum + costOf(block.typeId), 0);
  if (used > budget) {
    throw new HttpError(409, "BUDGET_EXCEEDED", `Layout uses ${used} blocks; budget is ${budget}.`, {
      used,
      budget,
    });
  }
}

cityRouter.get("/catalog/block-types", (_req, res) => {
  res.json(BLOCK_TYPES);
});

cityRouter.get("/catalog/personas", (_req, res) => {
  res.json(PERSONAS);
});

cityRouter.get("/cities", (req, res) => {
  const user = requireUser(req);
  const cities = store
    .read()
    .cities.filter((city) => city.ownerId === user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((city) => ({
      id: city.id,
      name: city.name,
      blocksUsed: blocksUsed(city.blocks),
      blockBudget: city.blockBudget,
      updatedAt: city.updatedAt,
    }));
  res.json(cities);
});

cityRouter.post("/cities", (req, res) => {
  const user = requireUser(req);
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : "My City";
  const city: CityRow = {
    id: id("cty"),
    ownerId: user.id,
    name: name.slice(0, 60),
    gridWidth: GRID_SIZE,
    gridHeight: GRID_SIZE,
    blockBudget: DEFAULT_BLOCK_BUDGET,
    blocks: [],
    lastSimulation: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.write((data) => {
    data.cities.push(city);
  });
  res.status(201).json(toCity(city));
});

cityRouter.get("/cities/:cityId", (req, res) => {
  res.json(toCity(ownedCity(requireUser(req).id, req.params.cityId)));
});

cityRouter.patch("/cities/:cityId", (req, res) => {
  const user = requireUser(req);
  const name = String(req.body?.name ?? "").trim();
  if (!name) throw new HttpError(400, "BAD_REQUEST", "Name is required.");
  store.write((data) => {
    const city = data.cities.find((row) => row.id === req.params.cityId && row.ownerId === user.id);
    if (!city) throw new HttpError(404, "NOT_FOUND", "City not found.");
    city.name = name.slice(0, 60);
    city.updatedAt = nowIso();
    res.json(toCity(city));
  });
});

cityRouter.delete("/cities/:cityId", (req, res) => {
  const user = requireUser(req);
  ownedCity(user.id, req.params.cityId);
  store.write((data) => {
    data.cities = data.cities.filter((city) => city.id !== req.params.cityId);
  });
  res.status(204).end();
});

cityRouter.post("/cities/:cityId/blocks", (req, res) => {
  const user = requireUser(req);
  const input = placedBlockInputSchema.parse(req.body);
  let result: { block: CityRow["blocks"][number]; blocksUsed: number; blockBudget: number } | undefined;
  store.write((data) => {
    const city = data.cities.find((row) => row.id === req.params.cityId && row.ownerId === user.id);
    if (!city) throw new HttpError(404, "NOT_FOUND", "City not found.");
    if (city.blocks.some((block) => block.x === input.x && block.y === input.y)) {
      throw new HttpError(409, "CELL_OCCUPIED", "That cell already has a block.");
    }
    const next = [...city.blocks, { id: id("blk"), ...input }];
    validateLayout(next, city.gridWidth, city.gridHeight, city.blockBudget);
    city.blocks = next;
    city.updatedAt = nowIso();
    const block = next[next.length - 1];
    result = { block, blocksUsed: blocksUsed(city.blocks), blockBudget: city.blockBudget };
  });
  res.status(201).json(result);
});

cityRouter.put("/cities/:cityId/blocks", (req, res) => {
  const user = requireUser(req);
  const blocks = placedBlockInputSchema.array().parse(req.body?.blocks ?? []);
  let cityOut: CityRow | undefined;
  store.write((data) => {
    const city = data.cities.find((row) => row.id === req.params.cityId && row.ownerId === user.id);
    if (!city) throw new HttpError(404, "NOT_FOUND", "City not found.");
    validateLayout(blocks, city.gridWidth, city.gridHeight, city.blockBudget);
    city.blocks = blocks.map((block) => ({ id: id("blk"), ...block }));
    city.updatedAt = nowIso();
    cityOut = city;
  });
  res.json(toCity(cityOut!));
});

cityRouter.patch("/cities/:cityId/blocks/:blockId", (req, res) => {
  const user = requireUser(req);
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new HttpError(400, "BAD_REQUEST", "x and y are required.");
  }
  let result: { block: CityRow["blocks"][number]; blocksUsed: number; blockBudget: number } | undefined;
  store.write((data) => {
    const city = data.cities.find((row) => row.id === req.params.cityId && row.ownerId === user.id);
    if (!city) throw new HttpError(404, "NOT_FOUND", "City not found.");
    const block = city.blocks.find((item) => item.id === req.params.blockId);
    if (!block) throw new HttpError(404, "NOT_FOUND", "Block not found.");
    if (city.blocks.some((item) => item.id !== block.id && item.x === x && item.y === y)) {
      throw new HttpError(409, "CELL_OCCUPIED", "Target cell is occupied.");
    }
    const next = city.blocks.map((item) => (item.id === block.id ? { ...item, x, y } : item));
    validateLayout(next, city.gridWidth, city.gridHeight, city.blockBudget);
    city.blocks = next;
    city.updatedAt = nowIso();
    result = {
      block: next.find((item) => item.id === block.id)!,
      blocksUsed: blocksUsed(city.blocks),
      blockBudget: city.blockBudget,
    };
  });
  res.json(result);
});

cityRouter.delete("/cities/:cityId/blocks/:blockId", (req, res) => {
  const user = requireUser(req);
  let result: { block: CityRow["blocks"][number]; blocksUsed: number; blockBudget: number } | undefined;
  store.write((data) => {
    const city = data.cities.find((row) => row.id === req.params.cityId && row.ownerId === user.id);
    if (!city) throw new HttpError(404, "NOT_FOUND", "City not found.");
    const block = city.blocks.find((item) => item.id === req.params.blockId);
    if (!block) throw new HttpError(404, "NOT_FOUND", "Block not found.");
    city.blocks = city.blocks.filter((item) => item.id !== block.id);
    city.updatedAt = nowIso();
    result = { block, blocksUsed: blocksUsed(city.blocks), blockBudget: city.blockBudget };
  });
  res.json(result);
});

cityRouter.put("/cities/:cityId/simulation", (req, res) => {
  const user = requireUser(req);
  const input = simulationResultInputSchema.parse(req.body);
  const stored = { ...input, runAt: nowIso() };
  store.write((data) => {
    const city = data.cities.find((row) => row.id === req.params.cityId && row.ownerId === user.id);
    if (!city) throw new HttpError(404, "NOT_FOUND", "City not found.");
    city.lastSimulation = stored;
    city.updatedAt = nowIso();
  });
  res.json(stored);
});

cityRouter.get("/cities/:cityId/simulation", (req, res) => {
  const city = ownedCity(requireUser(req).id, req.params.cityId);
  if (!city.lastSimulation) {
    throw new HttpError(404, "NOT_FOUND", "No simulation has been saved yet.");
  }
  res.json(city.lastSimulation);
});
