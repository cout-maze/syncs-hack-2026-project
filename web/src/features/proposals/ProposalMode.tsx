import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { METRIC_LABELS, PROPOSAL_STATUS_LABELS } from '@rmc/shared';
import type { MetricVote, Proposal, ProposalStatusValue } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { CityWorkspace, type CityWorkspaceApi } from '@/features/builder/CityWorkspace';
import { useCityScene } from '@/features/builder/scene/useCityScene';
import { useProposal, useProposalResults, useProposals, useSubmitVotes } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor } from '@/lib/visuals';
import { pct, plural } from '@/lib/format';
import { ProposalComposer } from './ProposalComposer';

/**
 * ===========================================================================
 * FE #3 OWNS THIS MODE.
 * ===========================================================================
 *
 * Proposal mode is the actual product: the vote and decision-making platform. Someone
 * states an issue, expresses the fix by editing the shared map, and the community rates
 * it on each quality. The outcome is whatever those votes add up to.
 *
 * Hard rules (docs/03):
 *   - Outcomes come from citizen votes. Never AI, never simulated.
 *   - Show counts, not just percentages - the result has to look derived from votes.
 *   - Nothing from Simulation mode is ever submitted here.
 */
export function ProposalMode() {
  return <CityWorkspace>{(workspace) => <ProposalPanel workspace={workspace} />}</CityWorkspace>;
}

const STATUS_TONES: Record<ProposalStatusValue, 'accent' | 'good' | 'bad' | 'warn'> = {
  open: 'accent',
  approved: 'good',
  rejected: 'bad',
  reconsider: 'warn',
};

function ProposalPanel({ workspace }: { workspace: CityWorkspaceApi }) {
  const { proposalId } = useParams();
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);

  if (composing) {
    return (
      <ProposalComposer
        workspace={workspace}
        onClose={() => setComposing(false)}
        onCreated={(proposal) => {
          setComposing(false);
          navigate(`/propose/${proposal.id}`);
        }}
      />
    );
  }

  if (proposalId) {
    return <ProposalDetail proposalId={proposalId} onBack={() => navigate('/propose')} />;
  }

  return (
    <ProposalList
      onOpen={(id) => navigate(`/propose/${id}`)}
      onCompose={() => setComposing(true)}
    />
  );
}

/* ------------------------------------------------------------------- list */

function ProposalList({
  onOpen,
  onCompose,
}: {
  onOpen: (proposalId: string) => void;
  onCompose: () => void;
}) {
  const proposalsQuery = useProposals();

  if (proposalsQuery.isLoading) return <CenteredSpinner label="Loading proposals" />;

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
          <h1 className="text-xl font-extrabold">Proposals</h1>
          <p className="max-w-prose text-sm text-balance text-muted">
            The planner is not the only authority. Citizens rate each proposal quality by quality,
            and the outcome is whatever those ratings add up to.
          </p>
        </div>
        <Button size="sm" onClick={onCompose}>
          Raise an issue
        </Button>
      </div>

      {proposals.length === 0 ? (
        <Card>
          <EmptyState
            glyph={'\u{1F5F3}'}
            title="No proposals yet"
            description="Raise an issue and propose a change to the map for the community to rate."
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <ProposalCard proposal={proposal} onOpen={() => onOpen(proposal.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposalCard({ proposal, onOpen }: { proposal: Proposal; onOpen: () => void }) {
  const { results } = proposal;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title={proposal.title}
        subtitle={`${plural(proposal.blockCost, 'block')} · ${plural(results.totalVoters, 'voter')}`}
        action={
          <Badge tone={STATUS_TONES[proposal.status]}>
            {PROPOSAL_STATUS_LABELS[proposal.status]}
          </Badge>
        }
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        {proposal.issue && <p className="text-sm text-fog">{proposal.issue}</p>}
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

        <div className="mt-auto pt-1">
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Open and rate
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- detail */

function ProposalDetail({ proposalId, onBack }: { proposalId: string; onBack: () => void }) {
  const proposalQuery = useProposal(proposalId);
  const resultsQuery = useProposalResults(proposalId);
  const submit = useSubmitVotes(proposalId);
  const scene = useCityScene();

  const proposal = proposalQuery.data;

  /** Ballot state, seeded from `myVotes` so changing a vote starts from what you sent. */
  const [ballot, setBallot] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!proposal?.myVotes) return;
    setBallot(Object.fromEntries(proposal.myVotes.map((vote) => [vote.metric, vote.support])));
  }, [proposal?.myVotes]);

  // Show what this proposal would do to the city, and put the map back on the way out.
  useEffect(() => {
    if (!scene || !proposal) return;
    if (proposal.changes?.length) scene.previewChanges(proposal.changes);
    else if (proposal.location) scene.pulseCell(proposal.location);
    return () => scene.clearPreview();
  }, [scene, proposal]);

  if (proposalQuery.isLoading) return <CenteredSpinner label="Loading proposal" />;

  if (proposalQuery.isError || !proposal) {
    return (
      <Card>
        <EmptyState
          glyph={'\u{26A0}'}
          title="Could not load that proposal"
          description={errorMessage(proposalQuery.error)}
        />
      </Card>
    );
  }

  const results = resultsQuery.data ?? proposal.results;
  const closed = proposal.status !== 'open';
  const complete = proposal.votingMetrics.every((metric) => metric in ballot);

  function handleSubmit() {
    if (!proposal) return;
    const votes: MetricVote[] = proposal.votingMetrics.map((metric) => ({
      metric,
      support: ballot[metric] as boolean,
    }));
    submit.mutate(votes);
  }

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" variant="ghost" onClick={onBack}>
        &larr; All proposals
      </Button>

      <Card>
        <CardHeader
          title={proposal.title}
          subtitle={`${plural(proposal.blockCost, 'block')} · ${plural(results.totalVoters, 'voter')}`}
          action={
            <Badge tone={STATUS_TONES[proposal.status]}>
              {PROPOSAL_STATUS_LABELS[proposal.status]}
            </Badge>
          }
        />
        <div className="flex flex-col gap-3 p-4">
          {proposal.issue && (
            <div>
              <p className="text-xs font-bold tracking-wide text-muted uppercase">The issue</p>
              <p className="text-sm text-cream">{proposal.issue}</p>
            </div>
          )}
          <p className="text-sm text-muted">{proposal.description}</p>
          {proposal.expectedBenefits.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {proposal.expectedBenefits.map((benefit) => (
                <li
                  key={benefit}
                  className="rounded-pill border border-line-bright px-2 py-0.5 text-xs text-fog"
                >
                  {benefit}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------- ballot */}
      <Card>
        <CardHeader
          title="Rate this proposal"
          subtitle={
            closed
              ? 'Voting has closed for this proposal'
              : 'One answer per quality. All of them are needed before you can submit.'
          }
        />
        <ul className="divide-y divide-line">
          {proposal.votingMetrics.map((metric) => (
            <li key={metric} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span
                  className="block text-sm font-semibold"
                  style={{ color: metricColor(metric) }}
                >
                  {METRIC_LABELS[metric]}
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <VoteButton
                  label="Support"
                  glyph={'\u{1F44D}'}
                  active={ballot[metric] === true}
                  disabled={closed}
                  onClick={() => setBallot((prev) => ({ ...prev, [metric]: true }))}
                />
                <VoteButton
                  label="Oppose"
                  glyph={'\u{1F44E}'}
                  active={ballot[metric] === false}
                  disabled={closed}
                  onClick={() => setBallot((prev) => ({ ...prev, [metric]: false }))}
                />
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
          <Button
            size="sm"
            disabled={closed || !complete}
            loading={submit.isPending}
            onClick={handleSubmit}
          >
            {proposal.myVotes ? 'Update my rating' : 'Submit my rating'}
          </Button>
          <span className="text-xs text-muted">
            {closed
              ? PROPOSAL_STATUS_LABELS[proposal.status]
              : complete
                ? 'You can change your rating at any time while voting is open.'
                : 'Rate every quality to submit.'}
          </span>
        </div>

        {submit.isError && (
          <p className="border-t border-line px-4 py-2.5 text-sm text-rose">
            {errorMessage(submit.error, 'That rating could not be submitted.')}
          </p>
        )}
      </Card>

      {/* --------------------------------------------------------- results */}
      <Card>
        <CardHeader
          title="What the community said"
          subtitle={`${plural(results.totalVoters, 'voter')} · ${pct(results.overallApprovalPct, 1)} overall`}
        />
        <ul className="flex flex-col gap-3 p-4">
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
        <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
          Counted from {plural(results.totalVoters, 'ballot')}. Outcomes come from these votes
          &mdash; never from AI, and never from a simulation.
          {results.outcomeIfClosedNow && !closed && (
            <> If voting closed now: {PROPOSAL_STATUS_LABELS[results.outcomeIfClosedNow]}.</>
          )}
        </p>
      </Card>
    </div>
  );
}

function VoteButton({
  label,
  glyph,
  active,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      title={label}
      className={[
        'rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-line-bright',
        active ? 'border-apricot bg-apricot/10 text-cream' : 'border-line bg-ink-850 text-muted',
      ].join(' ')}
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
