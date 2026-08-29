import {
  METRIC_LABELS,
  PROPOSAL_STATUS_LABELS,
  type Proposal,
  type ProposalStatusValue,
} from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProposals } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor } from '@/lib/visuals';
import { pct, plural } from '@/lib/format';

/**
 * ===========================================================================
 * FE #3 OWNS THIS TAB.
 * ===========================================================================
 *
 * Done: the list, the aggregated results, and the vote counts (shown as counts, not
 * just percentages - that is the point of the feature).
 *
 * Still to build:
 *   1. A detail view. `useProposal(id)` gives you `myVotes` and `votingMetrics`.
 *   2. The ballot: one support/oppose toggle per metric in `votingMetrics`, then
 *      `useSubmitVotes(id).mutate(votes)`. Partial ballots are rejected by the API,
 *      so build the form from `votingMetrics` and always send all of them.
 *      Re-submitting is how "change my vote" works - same call.
 *   3. Live results: `useProposalResults(id)` already polls every 7 seconds while it
 *      is mounted.
 *   4. Optional: "Explain this proposal" via `useProposalExplanation()`. Render it as
 *      a description of the trade-offs, never as a recommendation on how to vote.
 *
 * Hard rule from the proposal doc: outcomes come from citizen votes, never from AI.
 */
export function ProposalsTab() {
  const proposalsQuery = useProposals();

  if (proposalsQuery.isLoading) return <CenteredSpinner label="Loading council proposals" />;

  if (proposalsQuery.isError) {
    return (
      <Card>
        <EmptyState
          glyph={'\u{26A0}'}
          title="Could not load proposals"
          description={errorMessage(proposalsQuery.error)}
        />
      </Card>
    );
  }

  const proposals = proposalsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Council proposals</h1>
          <p className="max-w-2xl text-sm text-balance text-muted">
            The planner is not the only authority. Citizens vote on each proposal metric by
            metric, and the outcome is whatever those votes add up to.
          </p>
        </div>
        <Badge tone="warn">Voting UI: FE #3 to build</Badge>
      </div>

      {proposals.length === 0 ? (
        <Card>
          <EmptyState glyph={'\u{1F5F3}'} title="No proposals yet" />
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <ProposalCard proposal={proposal} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_TONES: Record<ProposalStatusValue, 'accent' | 'good' | 'bad' | 'warn'> = {
  open: 'accent',
  approved: 'good',
  rejected: 'bad',
  reconsider: 'warn',
};

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { results } = proposal;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title={proposal.title}
        subtitle={`${plural(proposal.blockCost, 'block')} · ${plural(results.totalVoters, 'voter')}`}
        action={<Badge tone={STATUS_TONES[proposal.status]}>{PROPOSAL_STATUS_LABELS[proposal.status]}</Badge>}
      />

      <div className="flex flex-1 flex-col gap-4 p-4">
        <p className="text-sm text-muted">{proposal.description}</p>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold tracking-wide text-muted uppercase">
              Community approval
            </span>
            <span className="font-display text-lg font-extrabold text-cream tabular-nums">
              {pct(results.overallApprovalPct, 1)}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-ink-800">
            <div
              className="h-full rounded-pill bg-apricot"
              style={{ width: `${Math.min(100, results.overallApprovalPct)}%` }}
            />
          </div>
        </div>

        {/* Counts, not just percentages - the result has to look derived from votes. */}
        <ul className="mt-auto flex flex-col gap-2">
          {results.metricResults.map((metric) => (
            <li key={metric.metric} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-fog">{METRIC_LABELS[metric.metric]}</span>
                <span className="text-muted tabular-nums">
                  {metric.supportCount} for &middot; {metric.opposeCount} against &middot;{' '}
                  <span className="font-semibold text-cream">{pct(metric.supportPct, 1)}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-pill bg-ink-800">
                <div
                  className="h-full rounded-pill"
                  style={{
                    width: `${metric.supportPct}%`,
                    backgroundColor: metricColor(metric.metric),
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
