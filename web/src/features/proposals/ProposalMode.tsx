import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { METRIC_LABELS, OUTCOME_THRESHOLDS, PROPOSAL_STATUS_LABELS } from '@rmc/shared';
import type { MetricVote, Proposal, ProposalStatusValue, VotingResults } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCityWorkspace, type CityWorkspaceApi } from '@/features/builder/CityWorkspace';
import { useCityScene } from '@/features/builder/scene/useCityScene';
import { useToast } from '@/components/ui/Toast';
import {
  usePersonas,
  useProposal,
  useProposalResults,
  useProposals,
  useSubmitVotes,
} from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor, personaGlyph } from '@/lib/visuals';
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
  // The map is mounted by the shell; this renders inside a floating window over it.
  return <ProposalPanel workspace={useCityWorkspace()} />;
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

  // Open proposals first: they are the ones that still need something from you.
  const proposals = [...(proposalsQuery.data ?? [])].sort((a, b) => {
    if (a.status === b.status) return 0;
    if (a.status === 'open') return -1;
    if (b.status === 'open') return 1;
    return 0;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
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
              className="h-full rounded-pill"
              style={{
                width: `${Math.min(100, Math.max(0, results.overallApprovalPct))}%`,
                // Tinted by where the number sits against the outcome rule, so an
                // approved and a rejected proposal do not look identical in the list.
                backgroundColor:
                  results.overallApprovalPct >= OUTCOME_THRESHOLDS.approved
                    ? 'var(--color-good)'
                    : results.overallApprovalPct < OUTCOME_THRESHOLDS.rejected
                      ? 'var(--color-bad)'
                      : 'var(--color-warn)',
              }}
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

function personaName(personas: { id: string; name: string }[], personaId: string): string {
  return personas.find((persona) => persona.id === personaId)?.name ?? personaId.replace(/_/g, ' ');
}

/* ---------------------------------------------------------------- outcome */

/**
 * The decision is the point of the whole mode, so it gets said plainly and the rule
 * behind it is drawn rather than hidden: a scale with the two thresholds marked and the
 * community's overall approval sitting somewhere on it. Without this a user reads 58%
 * and "requires reconsideration" with no way to connect the two.
 */
function Outcome({
  results,
  closed,
  status,
}: {
  results: VotingResults;
  closed: boolean;
  status: ProposalStatusValue;
}) {
  const overall = Math.min(100, Math.max(0, results.overallApprovalPct));
  const decision = closed ? status : (results.outcomeIfClosedNow ?? 'reconsider');

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONES[decision]}>{PROPOSAL_STATUS_LABELS[decision]}</Badge>
        <span className="text-xs text-muted">
          {closed ? 'Final result of the vote.' : 'If voting closed now.'}
        </span>
      </div>

      {/* The rule, drawn: rejected below 40, approved from 60, reconsider between. */}
      <div>
        <div
          className="relative h-2.5 overflow-hidden rounded-pill"
          role="meter"
          aria-valuenow={Math.round(overall)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall community approval"
        >
          <span className="absolute inset-y-0 left-0 bg-bad/35" style={{ width: `${OUTCOME_THRESHOLDS.rejected}%` }} />
          <span
            className="absolute inset-y-0 bg-warn/30"
            style={{
              left: `${OUTCOME_THRESHOLDS.rejected}%`,
              width: `${OUTCOME_THRESHOLDS.approved - OUTCOME_THRESHOLDS.rejected}%`,
            }}
          />
          <span
            className="absolute inset-y-0 right-0 bg-good/35"
            style={{ width: `${100 - OUTCOME_THRESHOLDS.approved}%` }}
          />
          <span
            aria-hidden="true"
            className="absolute top-[-3px] bottom-[-3px] w-1 rounded-pill bg-cream shadow"
            style={{ left: `calc(${overall}% - 2px)` }}
          />
        </div>

        <div className="mt-1 flex justify-between text-[10px] text-faint tabular-nums">
          <span>rejected &lt;{OUTCOME_THRESHOLDS.rejected}%</span>
          <span className="font-bold text-cream">{pct(results.overallApprovalPct, 1)}</span>
          <span>&ge;{OUTCOME_THRESHOLDS.approved}% approved</span>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- detail */

function ProposalDetail({ proposalId, onBack }: { proposalId: string; onBack: () => void }) {
  const proposalQuery = useProposal(proposalId);
  const resultsQuery = useProposalResults(proposalId);
  const submit = useSubmitVotes(proposalId);
  const scene = useCityScene();
  const toast = useToast();

  const proposal = proposalQuery.data;

  /** Ballot state, seeded from `myVotes` so changing a vote starts from what you sent. */
  const [ballot, setBallot] = useState<Record<string, boolean>>({});
  /** Who you are speaking for. Optional - a ballot without one still counts. */
  const [voterGroup, setVoterGroup] = useState<string>('');
  const personas = usePersonas().data ?? [];

  useEffect(() => {
    if (!proposal?.myVotes) return;
    setBallot(Object.fromEntries(proposal.myVotes.map((vote) => [vote.metric, vote.support])));
  }, [proposal?.myVotes]);

  useEffect(() => {
    if (proposal?.myVoterGroup) setVoterGroup(proposal.myVoterGroup);
  }, [proposal?.myVoterGroup]);

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

    // The API rejects partial ballots, so build the list defensively rather than
    // asserting: if a quality is somehow unanswered we stop instead of sending undefined.
    const votes: MetricVote[] = [];
    for (const metric of proposal.votingMetrics) {
      const support = ballot[metric];
      if (typeof support !== 'boolean') return;
      votes.push({ metric, support });
    }

    submit.mutate(
      { votes, voterGroup: voterGroup || null },
      { onSuccess: () => toast.success('Your rating is in and counted below.') },
    );
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
        {/* Who is speaking. The product's claim is that groups differ; the ballot has to
            ask, or the results can never show it. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label htmlFor="voter-group" className="text-xs font-semibold text-muted">
            Rating as
          </label>
          <select
            id="voter-group"
            value={voterGroup}
            disabled={closed}
            onChange={(event) => setVoterGroup(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line-bright bg-ink-950 px-2 text-xs text-cream disabled:opacity-40"
          >
            <option value="">Myself - no group</option>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {personaGlyph(persona.id)} {persona.name}
              </option>
            ))}
          </select>
        </div>

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
                  tone="good"
                  active={ballot[metric] === true}
                  disabled={closed}
                  onClick={() => setBallot((prev) => ({ ...prev, [metric]: true }))}
                />
                <VoteButton
                  label="Oppose"
                  glyph={'\u{1F44E}'}
                  tone="bad"
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

        {results.totalVoters === 0 ? (
          <EmptyState
            glyph={'\u{1F5F3}'}
            title="No ratings yet"
            description="Nobody has rated this proposal. That is not the same as the community being against it - be the first."
          />
        ) : (
          <>
            <Outcome results={results} closed={closed} status={proposal.status} />

            {results.groupResults.length > 0 && (
              <div className="border-t border-line p-4">
                <p className="text-xs font-bold tracking-wide text-muted uppercase">
                  By who is speaking
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {results.groupResults.map((group) => (
                    <li key={group.personaId} className="flex items-center gap-2 text-xs">
                      <span aria-hidden="true">{personaGlyph(group.personaId)}</span>
                      <span className="w-28 shrink-0 truncate text-fog">
                        {personaName(personas, group.personaId)}
                      </span>
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-ink-800">
                        <span
                          className="block h-full rounded-pill bg-apricot"
                          style={{
                            width: `${Math.min(100, Math.max(0, group.overallApprovalPct))}%`,
                          }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right text-muted tabular-nums">
                        {pct(group.overallApprovalPct, 0)}{' '}
                        <span className="text-faint">
                          &middot; {plural(group.voterCount, 'voter')}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-faint">
                  The same ballots, split by the group each voter said they spoke for. This is
                  where a proposal that is popular overall can still be opposed by the people it
                  lands on.
                </p>
              </div>
            )}

            <ul className="flex flex-col gap-3 border-t border-line p-4">
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
                        width: `${Math.min(100, Math.max(0, metric.supportPct))}%`,
                        backgroundColor: metricColor(metric.metric),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
          Counted from {plural(results.totalVoters, 'ballot')}. Overall is the average of the
          qualities above &mdash; every quality counts the same, so a proposal cannot be carried by
          one popular quality alone. Outcomes come from these votes &mdash; never from AI, and never
          from a simulation.
        </p>
      </Card>
    </div>
  );
}

/**
 * A ballot answer. The word is visible, not just a thumb: on a voting control the
 * difference between the two options should never rest on a small emoji, and the
 * selected state should be obvious at a glance.
 */
function VoteButton({
  label,
  glyph,
  tone,
  active,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  tone: 'good' | 'bad';
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const accent = tone === 'good' ? 'var(--color-good)' : 'var(--color-bad)';

  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-line-bright',
        active ? 'text-cream' : 'border-line bg-ink-850 text-muted',
      ].join(' ')}
      style={active ? { borderColor: accent, backgroundColor: `${accent}26` } : undefined}
    >
      <span aria-hidden="true">{glyph}</span>
      {label}
    </button>
  );
}
