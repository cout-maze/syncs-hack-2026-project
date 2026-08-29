import bcrypt from "bcryptjs";
import type { MetricName } from "@rmc/shared";
import { nowIso } from "./lib/ids";
import { store, type ProposalRow, type VoteRow } from "./lib/store";

const SEED_PASSWORD = process.env.DEMO_PASSWORD ?? "rebuild-city";

function shapedVotes(
  proposalId: string,
  userIds: string[],
  targets: Partial<Record<MetricName, number>>,
  metrics: MetricName[],
): VoteRow[] {
  const votes: VoteRow[] = [];
  for (const metric of metrics) {
    const supportCount = Math.round(pct * userIds.length);
    userIds.forEach((userId, index) => {
      votes.push({
        userId,
        proposalId,
        metric,
        support: index < supportCount,
      });
    });
  }
  return votes;
}

export function seedIfEmpty() {
  if (store.read().users.length > 0 && store.read().proposals.length > 0) return;

  const passwordHash = bcrypt.hashSync(SEED_PASSWORD, 10);
  const demo = {
    id: "usr_demo",
    email: (process.env.DEMO_EMAIL ?? "demo@city.dev").toLowerCase(),
    passwordHash,
    displayName: "Demo planner",
    createdAt: nowIso(),
  };
  const seedUsers = Array.from({ length: 20 }, (_, index) => ({
    id: `usr_seed${String(index + 1).padStart(2, "0")}`,
    email: `seed${index + 1}@city.dev`,
    passwordHash,
    displayName: `Citizen ${index + 1}`,
    createdAt: nowIso(),
  }));

  const garden: ProposalRow = {
    id: "prp_garden1",
    title: "Add a community garden",
    description:
      "Convert one or two undeveloped blocks near housing into a shared garden. Neighbours grow food, meet, and share tools.",
    location: { x: 2, y: 3 },
    blockCost: 2,
    expectedBenefits: ["Community connection", "Sustainability"],
    affectedPersonaIds: ["older_resident", "parent_stroller", "non_english_speaker"],
    votingMetrics: ["community", "sustainability", "accessibility", "efficiency"],
    status: "open",
    createdAt: nowIso(),
  };
  const transport: ProposalRow = {
    id: "prp_transport1",
    title: "Expand public transport",
    description:
      "Add a transport spine connecting western housing to healthcare and education in the east.",
    location: { x: 4, y: 4 },
    blockCost: 3,
    expectedBenefits: ["Accessibility", "Inclusion"],
    affectedPersonaIds: ["wheelchair_user", "older_resident", "child_student"],
    votingMetrics: ["accessibility", "inclusion", "efficiency", "resilience"],
    status: "open",
    createdAt: nowIso(),
  };
  const heritage: ProposalRow = {
    id: "prp_heritage1",
    title: "Convert heritage site into new development",
    description:
      "Replace a culture / heritage block with extra housing. More homes, less heritage in the centre of the city.",
    location: { x: 5, y: 5 },
    blockCost: 0,
    expectedBenefits: ["Housing capacity", "Efficiency"],
    affectedPersonaIds: ["non_english_speaker", "older_resident", "child_student"],
    votingMetrics: ["efficiency", "inclusion", "community", "sustainability"],
    status: "open",
    createdAt: nowIso(),
  };

  const seedIds = seedUsers.map((user) => user.id);
  const votes = [
    ...shapedVotes(garden.id, seedIds, {
      community: 0.91,
      sustainability: 0.75,
      accessibility: 0.8,
      efficiency: 0.58,
    }, garden.votingMetrics),
    ...shapedVotes(transport.id, seedIds, {
      accessibility: 0.92,
      inclusion: 0.83,
      efficiency: 0.55,
      resilience: 0.73,
    }, transport.votingMetrics),
    ...shapedVotes(heritage.id, seedIds, {
      efficiency: 0.58,
      inclusion: 0.25,
      community: 0.17,
      sustainability: 0.33,
    }, heritage.votingMetrics),
  ];

  store.write((data) => {
    if (!data.users.some((user) => user.email === demo.email)) data.users.push(demo);
    for (const user of seedUsers) {
      if (!data.users.some((row) => row.id === user.id)) data.users.push(user);
    }
    if (data.proposals.length === 0) {
      data.proposals.push(garden, transport, heritage);
      data.votes.push(...votes);
    }
  });
}
