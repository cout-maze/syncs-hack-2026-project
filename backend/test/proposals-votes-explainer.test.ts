import { hash } from '@node-rs/argon2';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { generateId, IdPrefix } from '../src/lib/ids.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let adminToken: string;
let userToken: string;
let adminId: string;
let userId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const pw = await hash('testpass');

  adminId = generateId(IdPrefix.user);
  userId = generateId(IdPrefix.user);

  await prisma.user.createMany({
    data: [
      { id: adminId, email: 'testadmin@test.dev', passwordHash: pw, displayName: 'Admin', role: 'admin' },
      { id: userId, email: 'testuser@test.dev', passwordHash: pw, displayName: 'User', role: 'user' },
    ],
  });

  await prisma.city.upsert({
    where: { id: 'cty_test' },
    update: {},
    create: { id: 'cty_test', kind: 'real', name: 'TestCity', gridWidth: 40, gridHeight: 40 },
  });

  await prisma.placedBlock.createMany({
    data: [
      { id: generateId(IdPrefix.block), cityId: 'cty_test', blockTypeId: 'housing', x: 5, y: 5 },
      { id: generateId(IdPrefix.block), cityId: 'cty_test', blockTypeId: 'transport', x: 10, y: 10 },
    ],
  });

  adminToken = app.jwt.sign({ sub: adminId, email: 'testadmin@test.dev', role: 'admin' });
  userToken = app.jwt.sign({ sub: userId, email: 'testuser@test.dev', role: 'user' });
});

afterAll(async () => {
  await prisma.vote.deleteMany({});
  await prisma.proposal.deleteMany({});
  await prisma.placedBlock.deleteMany({ where: { cityId: 'cty_test' } });
  await prisma.city.deleteMany({ where: { id: 'cty_test' } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  await app.close();
});

const API = '/api/v1';

describe('Vote flow: cast → switch → retract → closed rejection', () => {
  let proposalId: string;

  it('admin creates a proposal (add park at empty cell)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Test park', description: 'Add a park.', x: 0, y: 0, changeType: 'add', blockTypeId: 'park' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe('open');
    expect(body.counts).toEqual({ up: 0, down: 0 });
    proposalId = body.id;
  });

  it('user casts an UP vote', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/proposals/${proposalId}/vote`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { value: 'up' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.myVote).toBe('up');
    expect(body.counts.up).toBe(1);
    expect(body.counts.down).toBe(0);
  });

  it('user switches vote to DOWN', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/proposals/${proposalId}/vote`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { value: 'down' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.myVote).toBe('down');
    expect(body.counts.up).toBe(0);
    expect(body.counts.down).toBe(1);
  });

  it('GET proposal detail includes myVote when authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/proposals/${proposalId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().myVote).toBe('down');
  });

  it('GET proposal detail has null myVote when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/proposals/${proposalId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().myVote).toBeNull();
  });

  it('user retracts vote', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `${API}/proposals/${proposalId}/vote`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.myVote).toBeNull();
    expect(body.counts).toEqual({ up: 0, down: 0 });
  });

  it('admin closes the proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals/${proposalId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('closed');
  });

  it('voting on closed proposal returns 409 PROPOSAL_CLOSED', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${API}/proposals/${proposalId}/vote`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { value: 'up' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PROPOSAL_CLOSED');
  });

  it('closing an already-closed proposal returns 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals/${proposalId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PROPOSAL_CLOSED');
    expect(res.json().error.message).toContain('already closed');
  });
});

describe('Admin create/close with map validation', () => {
  it('non-admin gets 403 on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { title: 'Nope', description: 'Should fail.', x: 1, y: 1, changeType: 'add', blockTypeId: 'park' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects add on occupied cell (CELL_OCCUPIED)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Overlap', description: 'Cell taken.', x: 5, y: 5, changeType: 'add', blockTypeId: 'park' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CELL_OCCUPIED');
  });

  it('rejects remove on empty cell (CELL_EMPTY)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Ghost', description: 'Nothing there.', x: 39, y: 39, changeType: 'remove' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CELL_EMPTY');
  });

  it('rejects out-of-bounds cell (OUT_OF_BOUNDS)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'OOB', description: 'Way out.', x: 40, y: 0, changeType: 'add', blockTypeId: 'park' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('OUT_OF_BOUNDS');
  });

  it('rejects invalid block type (BLOCK_TYPE_INVALID)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Bad type', description: 'No such type.', x: 1, y: 1, changeType: 'add', blockTypeId: 'castle' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BLOCK_TYPE_INVALID');
  });

  it('rejects add without blockTypeId (BLOCK_TYPE_REQUIRED)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'No type', description: 'Missing type.', x: 1, y: 1, changeType: 'add' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BLOCK_TYPE_REQUIRED');
  });

  it('creates replace proposal on occupied cell', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Upgrade stop', description: 'Replace transport.', x: 10, y: 10, changeType: 'replace', blockTypeId: 'education' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().changeType).toBe('replace');
  });

  it('rejects duplicate open proposal at same cell (PROPOSAL_EXISTS_AT_CELL)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Dupe', description: 'Same cell.', x: 10, y: 10, changeType: 'replace', blockTypeId: 'park' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PROPOSAL_EXISTS_AT_CELL');
  });
});

describe('Public list proposals', () => {
  it('GET /proposals returns array without auth', async () => {
    const res = await app.inject({ method: 'GET', url: `${API}/proposals` });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('filters by status=open', async () => {
    const res = await app.inject({ method: 'GET', url: `${API}/proposals?status=open` });
    expect(res.statusCode).toBe(200);
    for (const p of res.json()) {
      expect(p.status).toBe('open');
    }
  });
});

describe('Fallback explainer', () => {
  let explainerProposalId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Explainer test', description: 'Park for explanation.', x: 3, y: 3, changeType: 'add', blockTypeId: 'park' },
    });
    explainerProposalId = res.json().id;
  });

  it('returns fallback:true with explanation text when no API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/proposal-explanation`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { proposalId: explainerProposalId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fallback).toBe(true);
    expect(body.explanation).toBeDefined();
    expect(typeof body.explanation).toBe('string');
    expect(body.explanation.length).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/proposal-explanation`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { proposalId: 'prp_nonexistent' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/proposal-explanation`,
      payload: { proposalId: explainerProposalId },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('City Newspaper', () => {
  let newspaperProposalId: string;

  beforeAll(async () => {
    const create = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Hospital wing', description: 'New healthcare block.', x: 7, y: 7, changeType: 'add', blockTypeId: 'healthcare' },
    });
    newspaperProposalId = create.json().id;

    await app.inject({
      method: 'PUT',
      url: `${API}/proposals/${newspaperProposalId}/vote`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { value: 'up' },
    });
  });

  it('returns fallback newspaper with headline and vote result', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/newspaper`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { proposalId: newspaperProposalId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fallback).toBe(true);
    expect(body.headline).toBeDefined();
    expect(body.summary).toBeDefined();
    expect(body.voteResult).toContain('100%');
    expect(body.otherHeadlines).toHaveLength(3);
  });

  it('returns 404 for non-existent proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/newspaper`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { proposalId: 'prp_nonexistent' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/newspaper`,
      payload: { proposalId: newspaperProposalId },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Citizen Perspectives', () => {
  let perspectivesProposalId: string;

  beforeAll(async () => {
    const create = await app.inject({
      method: 'POST',
      url: `${API}/proposals`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Tech hub upgrade', description: 'New tech hub.', x: 8, y: 8, changeType: 'add', blockTypeId: 'technology_hub' },
    });
    perspectivesProposalId = create.json().id;
  });

  it('returns fallback perspectives with 4 personas and advisor summary', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/citizen-perspectives`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { proposalId: perspectivesProposalId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fallback).toBe(true);
    expect(body.perspectives).toHaveLength(4);
    expect(body.advisorSummary).toBeDefined();

    const personaNames = body.perspectives.map((p: { persona: string }) => p.persona);
    expect(personaNames).toContain('Older residents');
    expect(personaNames).toContain('Families');
    expect(personaNames).toContain('Remote workers');
    expect(personaNames).toContain('Students');

    for (const p of body.perspectives) {
      expect(p.emoji).toBeDefined();
      expect(p.quote.length).toBeGreaterThan(0);
    }
  });

  it('tech hub proposal gives relevant remote worker quote', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/citizen-perspectives`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { proposalId: perspectivesProposalId },
    });
    const worker = res.json().perspectives.find((p: { persona: string }) => p.persona === 'Remote workers');
    expect(worker.quote).toContain('connectivity');
  });

  it('returns 404 for non-existent proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/citizen-perspectives`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { proposalId: 'prp_nonexistent' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/advisor/citizen-perspectives`,
      payload: { proposalId: perspectivesProposalId },
    });
    expect(res.statusCode).toBe(401);
  });
});
