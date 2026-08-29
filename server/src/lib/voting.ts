import {
  APPROVAL_APPROVED_AT,
  APPROVAL_REJECTED_BELOW,
  type MetricName,
  type ProposalStatus,
} from "@rmc/shared";
import type { ProposalRow, VoteRow } from "../lib/store";

export function aggregateVotes(proposal: ProposalRow, votes: VoteRow[]) {
  const mine = votes.filter((vote) => vote.proposalId === proposal.id);
  const users = new Set(mine.map((vote) => vote.userId));
  const metricResults = proposal.votingMetrics.map((metric) => {
    const rows = mine.filter((vote) => vote.metric === metric);
    const supportCount = rows.filter((vote) => vote.support).length;
    const opposeCount = rows.filter((vote) => !vote.support).length;
    const total = supportCount + opposeCount;
    const supportPct = total === 0 ? 0 : Math.round((supportCount / total) * 1000) / 10;
    return { metric, supportCount, opposeCount, supportPct };
  });
  const overallApprovalPct =
    metricResults.length === 0
      ? 0
      : Math.round(
          (metricResults.reduce((sum, row) => sum + row.supportPct, 0) / metricResults.length) * 10,
        ) / 10;
  const outcomeIfClosedNow: Exclude<ProposalStatus, "open"> =
    overallApprovalPct >= APPROVAL_APPROVED_AT
      ? "approved"
      : overallApprovalPct < APPROVAL_REJECTED_BELOW
        ? "rejected"
        : "reconsider";
  return {
    totalVoters: users.size,
    metricResults,
    overallApprovalPct,
    outcomeIfClosedNow,
  };
}

export function publicProposal(proposal: ProposalRow, votes: VoteRow[]) {
  return {
    id: proposal.id,
    title: proposal.title,
    description: proposal.description,
    location: proposal.location,
    blockCost: proposal.blockCost,
    expectedBenefits: proposal.expectedBenefits,
    affectedPersonaIds: proposal.affectedPersonaIds,
    votingMetrics: proposal.votingMetrics,
    status: proposal.status,
    results: aggregateVotes(proposal, votes),
    createdAt: proposal.createdAt,
  };
}

export function ballotFor(userId: string, proposalId: string, votes: VoteRow[]) {
  const mine = votes.filter((vote) => vote.userId === userId && vote.proposalId === proposalId);
  if (mine.length === 0) return null;
  return mine.map((vote) => ({ metric: vote.metric as MetricName, support: vote.support }));
}
