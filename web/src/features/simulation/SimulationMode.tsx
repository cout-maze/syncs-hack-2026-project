import { useEffect, useState } from 'react';
import { generateFlawedCity, METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type { SimulationResultInput } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { MetricBar } from '@/components/ui/MetricBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { useCityWorkspace, type CityWorkspaceApi } from '@/features/builder/CityWorkspace';
import { useCityScene } from '@/features/builder/scene/useCityScene';
import { AdvisorPanel } from '@/features/advisor/AdvisorPanel';
import { usePersonas, useSaveSimulation, useStoredSimulation } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor } from '@/lib/visuals';
import { relativeTime } from '@/lib/format';
import { ENGINE_VERSION, runSimulation } from './engine/runSimulation';
import { detectIssues, type SimIssue } from './engine/issues';
import { computeZoneScores } from './engine/zones';
import { UNREACHABLE_MINUTES } from './engine/constants';

/**
 * ===========================================================================
 * FE #2 OWNS THIS MODE.
 * ===========================================================================
 *
 * Simulation mode is the teaching sandbox - the half of the product that exists so a
 * first-time user understands the mechanic in sixty seconds. Build on the shared map,
 * hit Run, and the city raises its own issues in plain language. Deliberately no
 * auto-generated fixes: the point is for the user to work out what to build themselves,
 * with the City Advisor's explanation as a nudge rather than a shortcut button.
 *
 * Everything on this screen after the metrics is EPHEMERAL BROWSER STATE. Issues are
 * never stored and never submitted to the proposals API - simulated is never real. The
 * only thing that leaves this mode is the raw `SimulationResultInput`, which is PUT to
 * the city service.
 *
 * Still to finish: the animated run through the map contract (scene.animateResident /
 * setBlockState) before the results appear.
 */
export function SimulationMode() {
  // The map is mounted by the shell; this renders inside a floating window over it.
  return <SimulationPanel workspace={useCityWorkspace()} />;
}

function SimulationPanel({ workspace }: { workspace: CityWorkspaceApi }) {
  const { city, blockTypes, layout } = workspace;
  const personasQuery = usePersonas();
  const storedQuery = useStoredSimulation(city.id);
  const saveSimulation = useSaveSimulation(city.id);
  const scene = useCityScene();

  /** The freshest local run. Falls back to whatever the backend has from last time. */
  const [run, setRun] = useState<SimulationResultInput | null>(null);
  const [issues, setIssues] = useState<SimIssue[]>([]);
  const [showZones, setShowZones] = useState(true);
  const [engineError, setEngineError] = useState<string | null>(null);
  /** Provenance of a generated city, so a good one can be found again from its seed. */
  const [generated, setGenerated] = useState<{
    seed: string;
    archetype: string;
    flaws: number;
  } | null>(null);
  /**
   * Generate calls the engine several times synchronously (rejection sampling retries up
   * to 8 times) with no network call in between, so there is nothing else to show a
   * "loading" state during that burst except this. Set before the heavy work and deferred
   * a tick so the browser paints it first - otherwise the button looks frozen rather than
   * busy.
   */
  const [isComputing, setIsComputing] = useState(false);

  const result: SimulationResultInput | null =
    run ?? storedQuery.data ?? city.lastSimulation ?? null;
  const lastRunAt = storedQuery.data?.runAt ?? city.lastSimulation?.runAt ?? null;

  useEffect(() => {
    if (showZones && result) scene?.setZoneScores(computeZoneScores(result));
    else scene?.clearZoneScores();
  }, [result, scene, showZones]);

  /**
   * Drop a generated starter city onto the map.
   *
   * A blank grid teaches nothing and a well-planned one teaches nothing either, so the
   * generator builds a plausible city and breaks it on purpose. We show the seed, the
   * recipe and how many flaws are in there - never which ones. Finding them is what Run
   * is for.
   */
  function handleGenerate() {
    scene?.clearZoneScores();
    setShowZones(false);
    setIsComputing(true);
    // Deferred a tick so the "Running..." state paints before the synchronous rejection
    // sampling below (up to 8 full simulations) blocks the thread.
    setTimeout(() => {
      try {
        const seed = Math.random().toString(36).slice(2, 8);
        const personas = personasQuery.data ?? [];

        // Rejection sampling: the generator checks its own defects against a travel-time
        // field, but only the engine knows whether a journey fails the way the engine
        // measures it.
        const next = generateFlawedCity({
          seed,
          gridWidth: city.gridWidth,
          gridHeight: city.gridHeight,
          blockBudget: city.blockBudget,
          blockTypes,
          personas,
          simulate: (blocks) =>
            runSimulation({
              city: {
                ...city,
                blocks: blocks.map((block, at) => ({ ...block, id: `gen_${at}` })),
              },
              personas,
              blockTypes,
            }),
        });

        layout.replaceAll(next.blocks);
        setGenerated({
          seed: next.seed,
          archetype: next.archetype.name,
          flaws: next.defects.length,
        });

        // Whatever the last run found is about a city that no longer exists.
        setRun(null);
        setIssues([]);
        setEngineError(null);
      } finally {
        setIsComputing(false);
      }
    }, 0);
  }

  function handleRun() {
    setIsComputing(true);
    // Deferred a tick so the "Running..." state paints before the synchronous engine call
    // below blocks the thread.
    setTimeout(() => {
      const personas = personasQuery.data ?? [];
      // The engine simulates the layout on screen, not the last-saved one.
      const liveCity = {
        ...city,
        blocks: layout.blocks,
        blocksUsed: layout.blocksUsed,
      };

      try {
        const next = runSimulation({ city: liveCity, personas, blockTypes });

        setEngineError(null);
        setRun(next);
        setShowZones(true);
        scene?.setZoneScores(computeZoneScores(next));
        setIssues(detectIssues(next, personas));

        saveSimulation.mutate(next);
      } catch (error) {
        scene?.clearZoneScores();
        setShowZones(false);
        setEngineError(errorMessage(error, 'The simulation engine could not run.'));
        setRun(null);
        setIssues([]);
      } finally {
        setIsComputing(false);
      }
    }, 0);
  }

  if (personasQuery.isLoading) return <CenteredSpinner label="Loading the simulation" />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Run"
          subtitle={
            run
              ? 'Fresh run - issues below are generated from it'
              : lastRunAt
                ? `Last run ${relativeTime(lastRunAt)}`
                : 'Build something, then run the simulation'
          }
          action={
            <span className="flex gap-2">
              {result && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={showZones}
                    onChange={(event) => setShowZones(event.target.checked)}
                    className="accent-good"
                  />
                  <span>Show zones</span>
                </label>
              )}
              <Button size="sm" variant="secondary" onClick={handleGenerate} loading={isComputing}>
                Generate a city
              </Button>
              <Button
                size="sm"
                onClick={handleRun}
                loading={isComputing || saveSimulation.isPending}
              >
                Run simulation
              </Button>
            </span>
          }
        />

        {engineError ? (
          <EmptyState
            glyph={'\u{1F52C}'}
            title="The engine is not built yet"
            description={engineError}
          />
        ) : result ? (
          <div className="p-4">
            <div className="mb-4 flex items-center gap-3 text-xs text-muted" aria-label="Zone score legend">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-bad" aria-hidden="true" />
                Struggling
              </span>
              <span className="size-2 rounded-full bg-warn" aria-hidden="true" title="Mixed" />
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-good" aria-hidden="true" />
                Well served
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {METRIC_NAMES.map((metric) => (
                <MetricBar key={metric} metric={metric} value={result.metrics[metric]} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            glyph={'\u{1F3D9}'}
            title="No run yet"
            description="Place a few blocks on the map, then run the simulation to see how the city holds up."
          />
        )}
      </Card>

      {generated && (
        <p className="text-xs text-faint">
          Generated city &middot; {generated.archetype} &middot; seed{' '}
          <code className="text-apricot">{generated.seed}</code> &middot; {generated.flaws}{' '}
          deliberate {generated.flaws === 1 ? 'flaw' : 'flaws'} to find. Run the simulation and
          see if you agree.
        </p>
      )}

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

      {result && result.journeys.length > 0 && (
        <Card>
          <CardHeader
            title="Journeys"
            subtitle={`${result.journeys.filter((journey) => !journey.accessible).length} of ${result.journeys.length} fail`}
          />
          <ul className="divide-y divide-line">
            {result.journeys.slice(0, 10).map((journey) => (
              <li
                key={`${journey.fromBlockId}-${journey.targetService}`}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <Badge tone={journey.accessible ? 'good' : 'bad'}>
                  {journey.accessible ? 'OK' : 'Blocked'}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm">
                  Nearest {journey.targetService.replace(/_/g, ' ')}
                </span>
                <span className="text-sm text-muted tabular-nums">
                  {journey.travelTimeMinutes < UNREACHABLE_MINUTES
                    ? `${Math.round(journey.travelTimeMinutes)} min`
                    : 'unreachable'}
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
