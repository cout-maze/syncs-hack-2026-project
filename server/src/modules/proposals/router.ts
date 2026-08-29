import { Router } from "express";
import { proposalInputSchema, submitVotesBodySchema, type MetricName } from "@rmc/shared";
import { requireUser } from "../../lib/auth";
import { HttpError } from "../../lib/errors";
import { id, nowIso } from "../../lib/ids";
import { store, type ProposalRow, type VoteRow } from "../../lib/store";
import { aggregateVotes, ballotFor, publicProposal } from "../../lib/voting";

export const proposalsRouter = Router();

function findProposal(proposalId: string): ProposalRow {
  const proposal = store.read().proposals.find((row) => row.id === proposalId);
  if (!proposal) throw new HttpError(404, "NOT_FOUND", "Proposal not found.");
  return proposal;
}

proposalsRouter.get("/proposals", (req, res) => {
  requireUser(req);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const { proposals, votes } = store.read();
  const list = proposals
    .filter((proposal) => !status || proposal.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((proposal) => publicProposal(proposal, votes));
  res.json(list);
});

proposalsRouter.post("/proposals", (req, res) => {
  requireUser(req);
  const input = proposalInputSchema.parse(req.body);
  const proposal: ProposalRow = {
    id: id("prp"),
    title: input.title,
    description: input.description,
    location: input.location ?? null,
    blockCost: input.blockCost,
    expectedBenefits: input.expectedBenefits ?? [],
    affectedPersonaIds: input.affectedPersonaIds ?? [],
    votingMetrics: input.votingMetrics,
    status: "open",
    createdAt: nowIso(),
  };
  store.write((data) => {
    data.proposals.push(proposal);
  });
  res.status(201).json(publicProposal(proposal, []));
});

proposalsRouter.get("/proposals/:proposalId", (req, res) => {
  const user = requireUser(req);
  const { votes } = store.read();
  const proposal = findProposal(req.params.proposalId);
  res.json({
    ...publicProposal(proposal, votes),
    myVotes: ballotFor(user.id, proposal.id, votes),
  });
});

proposalsRouter.put("/proposals/:proposalId/votes", (req, res) => {
  const user = requireUser(req);
  const body = submitVotesBodySchema.parse(req.body);
  let myVotes: VoteRow[] = [];
  let results;
  store.write((data) => {
    const proposal = data.proposals.find((row) => row.id === req.params.proposalId);
    if (!proposal) throw new HttpError(404, "NOT_FOUND", "Proposal not found.");
    if (proposal.status !== "open") {
      throw new HttpError(409, "PROPOSAL_CLOSED", "Voting has closed for this proposal.");
    }
    const metrics = body.votes.map((vote) => vote.metric);
    const unique = new Set(metrics);
    if (unique.size !== metrics.length) {
      throw new HttpError(400, "BAD_REQUEST", "Duplicate metric in ballot.");
    }
    const required = new Set(proposal.votingMetrics);
    for (const metric of metrics) {
      if (!required.has(metric)) {
        throw new HttpError(400, "BAD_REQUEST", `Unknown metric for this proposal: ${metric}.`);
      }
    }
    for (const metric of proposal.votingMetrics) {
      if (!unique.has(metric)) {
        throw new HttpError(400, "BAD_REQUEST", `Ballot is missing metric: ${metric}.`);
      }
    }
    data.votes = data.votes.filter(
      (vote) => !(vote.userId === user.id && vote.proposalId === proposal.id),
    );
    myVotes = body.votes.map((vote) => ({
      userId: user.id,
      proposalId: proposal.id,
      metric: vote.metric as MetricName,
      support: vote.support,
    }));
    data.votes.push(...myVotes);
    results = aggregateVotes(proposal, data.votes);
  });
  res.json({
    myVotes: myVotes.map((vote) => ({ metric: vote.metric, support: vote.support })),
    results,
  });
});

proposalsRouter.get("/proposals/:proposalId/results", (req, res) => {
  requireUser(req);
  const proposal = findProposal(req.params.proposalId);
  res.json(aggregateVotes(proposal, store.read().votes));
});

proposalsRouter.post("/proposals/:proposalId/close", (req, res) => {
  requireUser(req);
  let closed;
  store.write((data) => {
    const proposal = data.proposals.find((row) => row.id === req.params.proposalId);
    if (!proposal) throw new HttpError(404, "NOT_FOUND", "Proposal not found.");
    if (proposal.status !== "open") {
      throw new HttpError(409, "PROPOSAL_CLOSED", "Proposal is already closed.");
    }
    const results = aggregateVotes(proposal, data.votes);
    proposal.status = results.outcomeIfClosedNow;
    closed = publicProposal(proposal, data.votes);
  });
  res.json(closed);
});
