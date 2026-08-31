import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  COUNCIL_CITY_BLOCK_BUDGET,
  COUNCIL_CITY_BLOCK_COUNT,
  COUNCIL_CITY_GRID_HEIGHT,
  COUNCIL_CITY_GRID_WIDTH,
} from '../src/modules/city/council.js';
import { prisma } from '../src/lib/db.js';
import { generateId, IdPrefix } from '../src/lib/ids.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let token: string;
let userId: string;
let otherToken: string;
let otherUserId: string;

const API = '/api/v1';

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

interface CityDto {
  id: string;
  ownerId: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  blockBudget: number;
  blocksUsed: number;
  blocks: { id: string; typeId: string; x: number; y: number }[];
  lastSimulation: { metrics: Record<string, number> } | null;
}

const validMetrics = {
  accessibility: 55,
  sustainability: 60,
  efficiency: 50,
  community: 65,
  resilience: 45,
  inclusion: 58,
};

async function createCity(name?: string): Promise<CityDto> {
  const res = await app.inject({
    method: 'POST',
    url: `${API}/cities`,
    headers: auth(token),
    ...(name === undefined ? {} : { payload: { name } }),
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function getCity(cityId: string): Promise<CityDto> {
  const res = await app.inject({
    method: 'GET',
    url: `${API}/cities/${cityId}`,
    headers: auth(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

it('returns the fixed council city for authenticated proposal previews', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `${API}/cities/council`,
    headers: auth(token),
  });

  expect(res.statusCode).toBe(200);
  const city = res.json();
  expect(city).toMatchObject({
    id: 'cty_council',
    ownerId: 'council',
    gridWidth: COUNCIL_CITY_GRID_WIDTH,
    gridHeight: COUNCIL_CITY_GRID_HEIGHT,
    blockBudget: COUNCIL_CITY_BLOCK_BUDGET,
    lastSimulation: null,
  });
  // Asserted against the fixture, not a hard-coded count: the council layout is
  // demo copy and gets re-dressed, but the endpoint must always return all of it.
  expect(city.blocks).toHaveLength(COUNCIL_CITY_BLOCK_COUNT);
  expect(city.blocksUsed).toBeGreaterThan(0);
});

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Primary user goes through the real register flow; the other user exists
  // only to prove cities are private (404, never 403).
  const reg = await app.inject({
    method: 'POST',
    url: `${API}/auth/register`,
    payload: {
      email: 'citytest-primary@test.dev',
      password: 'testpass123',
      displayName: 'City Tester',
    },
  });
  expect(reg.statusCode).toBe(201);
  token = reg.json().token;
  userId = reg.json().user.id;

  otherUserId = generateId(IdPrefix.user);
  await prisma.user.createMany({
    data: [
      {
        id: otherUserId,
        email: 'citytest-other@test.dev',
        passwordHash: await hash('testpass'),
        displayName: 'Other User',
        role: 'user',
      },
    ],
  });
  otherToken = app.jwt.sign({ sub: otherUserId, email: 'citytest-other@test.dev', role: 'user' });
});

afterAll(async () => {
  // Cities, blocks and simulation results cascade from their owner.
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await app.close();
});

describe('Catalog', () => {
  it('lists the 9 block types with costs, no auth', async () => {
    const res = await app.inject({ method: 'GET', url: `${API}/catalog/block-types` });
    expect(res.statusCode).toBe(200);
    const types = res.json() as { id: string; cost: number }[];
    expect(types).toHaveLength(9);
    const byId = Object.fromEntries(types.map((t) => [t.id, t]));
    expect(byId.housing.cost).toBe(2);
    expect(byId.transport.cost).toBe(1);
    expect(byId.technology_hub.cost).toBe(3);
  });

  it('lists the 7 personas, no auth', async () => {
    const res = await app.inject({ method: 'GET', url: `${API}/catalog/personas` });
    expect(res.statusCode).toBe(200);
    const personas = res.json() as { id: string; maxComfortableJourneyMinutes?: number }[];
    expect(personas).toHaveLength(7);
    expect(personas.find((p) => p.id === 'wheelchair_user')?.maxComfortableJourneyMinutes).toBe(15);
  });
});

describe('Auth guard', () => {
  it('allows browser preflight for mutating API requests', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: `${API}/cities/any/blocks`,
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });

  it('rejects missing token with 401', async () => {
    const res = await app.inject({ method: 'GET', url: `${API}/cities` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a garbage token with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/cities`,
      headers: auth('not-a-jwt'),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('City CRUD', () => {
  let cityA: string;
  let cityB: string;

  it('creates a default city from a body-less POST', async () => {
    const city = await createCity();
    cityA = city.id;
    expect(city.name).toBe('My City');
    expect(city.gridWidth).toBe(30);
    expect(city.gridHeight).toBe(30);
    expect(city.blockBudget).toBe(900);
    expect(city.blocksUsed).toBe(0);
    expect(city.blocks).toEqual([]);
    expect(city.lastSimulation).toBeNull();
  });

  it('accepts a 60-char name and rejects 61', async () => {
    const city = await createCity('X'.repeat(60));
    cityB = city.id;
    expect(city.name).toBe('X'.repeat(60));

    const res = await app.inject({
      method: 'POST',
      url: `${API}/cities`,
      headers: auth(token),
      payload: { name: 'X'.repeat(61) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('lists only the caller’s cities, newest first', async () => {
    const res = await app.inject({ method: 'GET', url: `${API}/cities`, headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { id: string; updatedAt: string }[];
    expect(list.map((c) => c.id)).toEqual([cityB, cityA]);
    const other = await app.inject({
      method: 'GET',
      url: `${API}/cities`,
      headers: auth(otherToken),
    });
    expect(other.json()).toHaveLength(0);
  });

  it('gets a city by id', async () => {
    const city = await getCity(cityA);
    expect(city.id).toBe(cityA);
    expect(city.ownerId).toBe(userId);
  });

  it('renames a city', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${API}/cities/${cityA}`,
      headers: auth(token),
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renamed');
  });

  it('treats another user’s city as 404 (never 403)', async () => {
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({
        method,
        url: `${API}/cities/${cityA}`,
        headers: auth(otherToken),
        ...(method === 'PATCH' ? { payload: { name: 'Stolen' } } : {}),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('CITY_NOT_FOUND');
    }
  });

  it('deletes a city (204) and it stays gone', async () => {
    const doomed = await createCity('Doomed');
    const res = await app.inject({
      method: 'DELETE',
      url: `${API}/cities/${doomed.id}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const after = await app.inject({
      method: 'GET',
      url: `${API}/cities/${doomed.id}`,
      headers: auth(token),
    });
    expect(after.statusCode).toBe(404);
  });
});

describe('Block placement', () => {
  let cityId: string;

  beforeAll(async () => {
    const city = await createCity('Placement');
    cityId = city.id;
  });

  it('places a block and reports Σ cost as blocksUsed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { typeId: 'housing', x: 2, y: 3 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.block.id.startsWith('blk_')).toBe(true);
    expect(body.block.typeId).toBe('housing');
    expect(body.blocksUsed).toBe(2);
    expect(body.blockBudget).toBe(900);
  });

  it('accumulates cost across block types', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { typeId: 'transport', x: 4, y: 3 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().blocksUsed).toBe(3); // housing 2 + transport 1
  });

  it('rejects unknown block types (400 BLOCK_TYPE_INVALID)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { typeId: 'fortress', x: 0, y: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BLOCK_TYPE_INVALID');
  });

  it('rejects out-of-bounds cells (409 OUT_OF_BOUNDS)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { typeId: 'park', x: 30, y: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('OUT_OF_BOUNDS');
  });

  it('rejects negative coordinates via schema (400 VALIDATION_ERROR)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { typeId: 'park', x: -1, y: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects double placement (409 CELL_OCCUPIED)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { typeId: 'park', x: 2, y: 3 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CELL_OCCUPIED');
  });

  it('rejects a placement that would exceed the budget', async () => {
    // Fill to exactly 900: 299× technology_hub (3) + 3× park (1).
    const blocks = Array.from({ length: 299 }, (_, i) => ({
      typeId: 'technology_hub',
      x: i % 30,
      y: Math.floor(i / 30),
    }));
    blocks.push(
      { typeId: 'park', x: 29, y: 29 },
      { typeId: 'park', x: 28, y: 29 },
      { typeId: 'park', x: 27, y: 29 },
    );
    const fill = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { blocks },
    });
    expect(fill.statusCode).toBe(200);
    expect(fill.json().blocksUsed).toBe(900);

    const res = await app.inject({
      method: 'POST',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { typeId: 'park', x: 26, y: 29 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BUDGET_EXCEEDED');
    expect(res.json().error.details.blockBudget).toBe(900);
    expect((await getCity(cityId)).blocksUsed).toBe(900);
  });
});

describe('Bulk replace (autosave)', () => {
  let cityId: string;

  const expectUnchanged = async (expectedUsed: number) => {
    expect((await getCity(cityId)).blocksUsed).toBe(expectedUsed);
  };

  beforeAll(async () => {
    const city = await createCity('Bulk');
    cityId = city.id;
  });

  it('replaces the layout and sums costs (2+1+1 = 4)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: {
        blocks: [
          { typeId: 'housing', x: 1, y: 1 },
          { typeId: 'park', x: 0, y: 3 },
          { typeId: 'transport', x: 5, y: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const city = res.json();
    expect(city.blocksUsed).toBe(4);
    // Blocks come back sorted by y then x.
    expect(city.blocks.map((b: { x: number; y: number }) => [b.x, b.y])).toEqual([
      [1, 1],
      [0, 3],
      [5, 3],
    ]);
  });

  it('replacing again swaps the whole layout', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { blocks: [{ typeId: 'park', x: 0, y: 0 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().blocksUsed).toBe(1);
  });

  it('an empty array clears the city', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { blocks: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().blocksUsed).toBe(0);
  });

  it('duplicate cells fail atomically — nothing is saved', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: {
        blocks: [
          { typeId: 'park', x: 0, y: 0 },
          { typeId: 'park', x: 0, y: 0 },
        ],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CELL_OCCUPIED');
    await expectUnchanged(0);
  });

  it('one out-of-bounds item fails atomically', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: {
        blocks: [
          { typeId: 'park', x: 0, y: 0 },
          { typeId: 'transport', x: 30, y: 5 },
        ],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('OUT_OF_BOUNDS');
    await expectUnchanged(0);
  });

  it('an over-budget layout fails atomically (301× tech hub = 903)', async () => {
    const blocks = Array.from({ length: 301 }, (_, i) => ({
      typeId: 'technology_hub',
      x: i % 30,
      y: Math.floor(i / 30),
    }));
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { blocks },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BUDGET_EXCEEDED');
    await expectUnchanged(0);
  });

  it('unknown types fail atomically', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: { blocks: [{ typeId: 'castle', x: 0, y: 0 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BLOCK_TYPE_INVALID');
    await expectUnchanged(0);
  });
});

describe('Move & remove blocks', () => {
  let cityId: string;
  let blockA: string;
  let blockB: string;

  beforeAll(async () => {
    const city = await createCity('Move');
    cityId = city.id;
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/blocks`,
      headers: auth(token),
      payload: {
        blocks: [
          { typeId: 'housing', x: 1, y: 1 },
          { typeId: 'housing', x: 2, y: 2 },
        ],
      },
    });
    blockA = res.json().blocks.find((b: { x: number }) => b.x === 1).id;
    blockB = res.json().blocks.find((b: { x: number }) => b.x === 2).id;
  });

  it('moves a block to a free cell without changing the budget', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${API}/cities/${cityId}/blocks/${blockA}`,
      headers: auth(token),
      payload: { x: 4, y: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().block).toMatchObject({ x: 4, y: 4 });
    expect(res.json().blocksUsed).toBe(4);
  });

  it('moving onto the same cell is a no-op', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${API}/cities/${cityId}/blocks/${blockA}`,
      headers: auth(token),
      payload: { x: 4, y: 4 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects moves onto occupied cells', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${API}/cities/${cityId}/blocks/${blockA}`,
      headers: auth(token),
      payload: { x: 2, y: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CELL_OCCUPIED');
  });

  it('rejects out-of-bounds moves', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${API}/cities/${cityId}/blocks/${blockA}`,
      headers: auth(token),
      payload: { x: 30, y: 9 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('OUT_OF_BOUNDS');
  });

  it('404s for unknown and foreign blocks', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${API}/cities/${cityId}/blocks/blk_nope`,
      headers: auth(token),
      payload: { x: 0, y: 0 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('BLOCK_NOT_FOUND');

    const foreign = await app.inject({
      method: 'PATCH',
      url: `${API}/cities/${cityId}/blocks/${blockB}`,
      headers: auth(otherToken),
      payload: { x: 0, y: 0 },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('CITY_NOT_FOUND');
  });

  it('removes a block and frees its budget', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `${API}/cities/${cityId}/blocks/${blockA}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().block.id).toBe(blockA);
    expect(res.json().blocksUsed).toBe(2);

    const again = await app.inject({
      method: 'DELETE',
      url: `${API}/cities/${cityId}/blocks/${blockA}`,
      headers: auth(token),
    });
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe('BLOCK_NOT_FOUND');
  });
});

describe('Simulation storage', () => {
  let cityId: string;
  let runAt: string;

  const payload = {
    metrics: validMetrics,
    journeys: [
      {
        personaId: 'wheelchair_user',
        fromBlockId: null,
        targetService: 'healthcare',
        travelTimeMinutes: 9,
        accessible: true,
      },
    ],
    events: [{ eventType: 'flood', passed: false, summary: 'West route flooded.' }],
    engineVersion: '0.3.0',
  };

  beforeAll(async () => {
    const city = await createCity('Sim');
    cityId = city.id;
  });

  it('404s before anything is saved (SIMULATION_NOT_FOUND)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/cities/${cityId}/simulation`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('SIMULATION_NOT_FOUND');
  });

  it('stores a valid result and returns it with runAt', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/simulation`,
      headers: auth(token),
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics).toEqual(validMetrics);
    expect(body.engineVersion).toBe('0.3.0');
    expect(body.journeys[0].pathBlockIds).toEqual([]); // schema default applied
    expect(body.events[0].affectedBlockIds).toEqual([]);
    expect(typeof body.runAt).toBe('string');
    runAt = body.runAt;
  });

  it('round-trips through GET', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/cities/${cityId}/simulation`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject(payload);
    expect(res.json().runAt).toBe(runAt);
  });

  it('overwrites the previous result (latest per city)', async () => {
    const next = {
      ...payload,
      metrics: { ...validMetrics, accessibility: 90 },
    };
    const put = await app.inject({
      method: 'PUT',
      url: `${API}/cities/${cityId}/simulation`,
      headers: auth(token),
      payload: next,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().runAt >= runAt).toBe(true);

    const get = await app.inject({
      method: 'GET',
      url: `${API}/cities/${cityId}/simulation`,
      headers: auth(token),
    });
    expect(get.json().metrics.accessibility).toBe(90);
  });

  it('shows the stored result as lastSimulation on the city', async () => {
    const city = await getCity(cityId);
    expect(city.lastSimulation).toMatchObject({ metrics: { accessibility: 90 } });
  });

  it('rejects invalid results with 400 VALIDATION_ERROR', async () => {
    const cases = [
      // missing one metric
      { ...payload, metrics: { ...validMetrics, inclusion: undefined } },
      // a metric above 100
      { ...payload, metrics: { ...validMetrics, efficiency: 101 } },
      // an extra metric key (strict schema)
      {
        ...payload,
        metrics: { ...validMetrics, walkability: 50 },
      },
      // unknown event type
      { ...payload, events: [{ eventType: 'earthquake', passed: true, summary: '?' }] },
      // journey missing the required `accessible` flag
      {
        ...payload,
        journeys: [
          { personaId: 'child_student', targetService: 'education', travelTimeMinutes: 5 },
        ],
      },
    ];
    for (const body of cases) {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/cities/${cityId}/simulation`,
        headers: auth(token),
        payload: body,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('foreign users get 404 on both endpoints', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const res = await app.inject({
        method,
        url: `${API}/cities/${cityId}/simulation`,
        headers: auth(otherToken),
        ...(method === 'PUT' ? { payload } : {}),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('CITY_NOT_FOUND');
    }
  });
});
