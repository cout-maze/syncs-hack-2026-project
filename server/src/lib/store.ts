import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MetricName, ProposalStatus } from "@rmc/shared";

export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
};

export type CityRow = {
  id: string;
  ownerId: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  blockBudget: number;
  blocks: Array<{ id: string; typeId: string; x: number; y: number }>;
  lastSimulation: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type ProposalRow = {
  id: string;
  title: string;
  description: string;
  location: { x: number; y: number } | null;
  blockCost: number;
  expectedBenefits: string[];
  affectedPersonaIds: string[];
  votingMetrics: MetricName[];
  status: ProposalStatus;
  createdAt: string;
};

export type VoteRow = {
  userId: string;
  proposalId: string;
  metric: MetricName;
  support: boolean;
};

export type StoreData = {
  users: UserRow[];
  cities: CityRow[];
  proposals: ProposalRow[];
  votes: VoteRow[];
};

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataFile = path.join(dataDir, "store.json");

function empty(): StoreData {
  return { users: [], cities: [], proposals: [], votes: [] };
}

function load(): StoreData {
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8")) as StoreData;
  } catch {
    return empty();
  }
}

function save(data: StoreData) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

let cache = load();

export const store = {
  read(): StoreData {
    return cache;
  },
  write(mutator: (data: StoreData) => void) {
    mutator(cache);
    save(cache);
  },
  reset() {
    cache = empty();
    save(cache);
  },
};
