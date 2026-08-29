import { useState } from 'react';
import { METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type { SimulationResultInput } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { MetricBar } from '@/components/ui/MetricBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useCityWorkspace, type CityWorkspaceApi } from '@/features/builder/CityWorkspace';
import { AdvisorPanel } from '@/features/advisor/AdvisorPanel';
import { usePersonas, useSaveSimulation, useStoredSimulation } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor } from '@/lib/visuals';
import { relativeTime } from '@/lib/format';
import { ENGINE_VERSION, runSimulation } from './engine/runSimulation';
import { detectIssues, type SimIssue } from './engine/issues';
import { draftAutoProposals, type AutoProposal } from './engine/autoProposals';

/**
 * ===========================================================================
 * FE #2 OWNS THIS MODE.
 * ===========================================================================
 *
 * Simulation mode is the teaching sandbox - the half of the product that exists so a
 * first-time user understands the mechanic in sixty seconds. Build on the shared map,
 * hit Run, and the city raises its own issues, drafts its own fixes and rates them.
 *
 * Everything on this screen after the metrics is EPHEMERAL BROWSER STATE. Issues,
 * auto-proposals and auto-ratings are never stored and never submitted to the proposals
 * API - simulated is never real. The only thing that leaves this mode is the raw
 * `SimulationResultInput`, which is PUT to the city service.
 *
 * Still to finish: engine/runSimulation.ts, and the animated run through the map
 * contract (scene.animateResident / setBlockState) before the results appear.
 */
export function SimulationMode() {
  // The map is mounted by the shell; this renders inside a floating window over it.
  return <SimulationPanel workspace={useCityWorkspace()} />;
}

function SimulationPanel({ workspace }: { workspace: CityWorkspaceApi }) {
  const { city, blockTypes, layout } = workspace;
  const toast = useToast();
  const personasQuery = usePersonas();
  const storedQuery = useStoredSimulation(city.id);
  const saveSimulation = useSaveSimulation(city.id);

  /** The freshest local run. Falls back to whatever the backend has from last time. */
  const [run, setRun] = useState<SimulationResultInput | null>(null);
  const [issues, setIssues] = useState<SimIssue[]>([]);
  const [autoProposals, setAutoProposals] = useState<AutoProposal[]>([]);
  const [engineError, setEngineError] = useState<string | null>(null);

  const result: SimulationResultInput | null =
    run ?? storedQuery.data ?? city.lastSimulation ?? null;
  const lastRunAt = storedQuery.data?.runAt ?? city.lastSimulation?.runAt ?? null;

  function handleRun() {
    const personas = personasQuery.data ?? [];
    // The engine simulates the layout on screen, not the last-saved one.
    const liveCity = {
      ...city,
      blocks: layout.blocks,
      blocksUsed: layout.blocksUsed,
    };

    try {
      const next = runSimulation({ city: liveCity, personas, blockTypes });
      const nextIssues = detectIssues(next, personas);

      setEngineError(null);
      setRun(next);
      setIssues(nextIssues);
      setAutoProposals(
        draftAutoProposals({
          city: liveCity,
          personas,
          blockTypes,
          result: next,
          issues: nextIssues,
        }),
      );

      saveSimulation.mutate(next);
    } catch (error) {
      setEngineError(errorMessage(error, 'The simulation engine could not run.'));
      setRun(null);
      setIssues([]);
      setAutoProposals([]);
    }
  }

  function handleApply(proposal: AutoProposal) {
    if (!layout.applyChanges(proposal.changes)) return;
    toast.success('Applied to the map. Run the simulation again to see what changed.');
    // The run that produced these is now stale.
    setIssues([]);
    setAutoProposals([]);
  }

  if (personasQuery.isLoading) return <CenteredSpinner label="Loading the simulation" />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Run"
          subtitle={
            run
              ? 'Fresh run - issues and proposals below are generated from it'
              : lastRunAt
                ? `Last run ${relativeTime(lastRunAt)}`
                : 'Build something, then run the simulation'
          }
          action={
            <Button size="sm" onClick={handleRun} loading={saveSimulation.isPending}>
              Run simulation
            </Button>
          }
        />

        {engineError ? (
          <EmptyState
            glyph={'\u{1F52C}'}
            title="The engine is not built yet"
            description={engineError}
          />
        ) : result ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {METRIC_NAMES.map((metric) => (
              <MetricBar key={metric} metric={metric} value={result.metrics[metric]} />
            ))}
          </div>
        ) : (
          <EmptyState
            glyph={'\u{1F3D9}'}
            title="No run yet"
            description="Place a few blocks on the map, then run the simulation to see how the city holds up."
          />
        )}
      </Card>

      {issues.length > 0 && (
        <Card>
          <CardHeader title="What the city found" subtitle="Detected automatically from this run" />
          <ul className="divide-y divide-line">
            {issues.map((issue) => (
              <li key={issue.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: metricColor(issue.metric) }}
                />
                <div className="min-w-0">
                  <p className="text-sm text-ink">{issue.title}</p>
                  <p className="text-xs text-muted">Hurts {METRIC_LABELS[issue.metric]}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {autoProposals.length > 0 && (
        <Card>
          <CardHeader
            title="Suggested fixes"
            subtitle="Rated by re-running the simulation with each change applied"
            action={<Badge tone="warn">Simulated</Badge>}
          />
          <ul className="divide-y divide-line">
            {autoProposals.map((proposal) => (
              <li key={proposal.id} className="flex flex-col gap-2.5 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">{proposal.title}</span>
                  <span className="text-sm text-muted tabular-nums">
                    {proposal.overallPct}% overall &middot; {proposal.blockCost} blocks
                  </span>
                </div>

                <p className="text-sm text-muted">{proposal.issue}</p>

                <ul className="flex flex-wrap gap-1.5">
                  {proposal.ratings.map((rating) => (
                    <li
                      key={rating.metric}
                      className="rounded-pill border px-2 py-0.5 text-xs font-semibold tabular-nums"
                      style={{
                        borderColor: `${metricColor(rating.metric)}59`,
                        color: metricColor(rating.metric),
                      }}
                    >
                      {METRIC_LABELS[rating.metric]} {rating.delta > 0 ? '+' : ''}
                      {rating.delta}
                    </li>
                  ))}
                </ul>

                <div>
                  <Button size="sm" variant="secondary" onClick={() => handleApply(proposal)}>
                    Apply to map
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
            These ratings are arithmetic on the simulation, not votes and not AI. Nothing here is
            submitted anywhere &mdash; real decisions happen in Proposal mode.
          </p>
        </Card>
      )}

      {result && result.journeys.length > 0 && (
        <Card>
          <CardHeader
            title="Journeys"
            subtitle={`${result.journeys.filter((journey) => !journey.accessible).length} of ${result.journeys.length} fail`}
          />
          <ul className="divide-y divide-line">
            {result.journeys.slice(0, 10).map((journey, index) => (
              <li
                key={`${journey.personaId}-${index}`}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <Badge tone={journey.accessible ? 'good' : 'bad'}>
                  {journey.accessible ? 'OK' : 'Blocked'}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {journey.personaId.replace(/_/g, ' ')} &rarr;{' '}
                  {journey.targetService.replace(/_/g, ' ')}
                </span>
                <span className="text-sm text-muted tabular-nums">
                  {Math.round(journey.travelTimeMinutes)} min
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AdvisorPanel />

      <p className="text-xs text-faint">Engine version {ENGINE_VERSION}</p>
    </div>
  );
}
