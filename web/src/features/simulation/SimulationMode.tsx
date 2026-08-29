import { useEffect, useRef, useState } from 'react';
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
import type { CitySceneApi } from '@/features/builder/scene/sceneApi';
import { AdvisorPanel } from '@/features/advisor/AdvisorPanel';
import { usePersonas, useSaveSimulation, useStoredSimulation } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor } from '@/lib/visuals';
import { relativeTime } from '@/lib/format';
import { ENGINE_VERSION, runSimulation } from './engine/runSimulation';
import { detectIssues, type SimIssue } from './engine/issues';
import {
  generateAutoProposals,
  metricLabel,
  signedDelta,
  type SimAutoProposal,
} from './engine/autoProposals';
import { computeZoneScores } from './engine/zones';
import { UNREACHABLE_MINUTES } from './engine/constants';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function animateRun(
  scene: CitySceneApi | null,
  result: SimulationResultInput,
  runId: number,
  runRef: { current: number },
): Promise<void> {
  if (!scene) return;

  scene.clearStates();
  scene.clearResidents();

  const journeys = result.journeys.filter((journey) => journey.pathBlockIds.length > 1).slice(0, 5);
  for (const journey of journeys) {
    if (runRef.current !== runId) return;
    scene.highlightPath(journey.pathBlockIds);
    await scene.animateResident({
      personaId: journey.personaId,
      pathBlockIds: journey.pathBlockIds,
      durationMs: Math.min(1800, Math.max(600, (journey.pathBlockIds.length - 1) * 120)),
      trail: true,
    });
    await wait(120);
  }

  if (runRef.current !== runId) return;
  for (const event of result.events) {
    const state = event.eventType === 'flood' ? 'flooded' : 'offline';
    for (const blockId of event.affectedBlockIds) scene.setBlockState(blockId, state);
  }
}

/**
 * ===========================================================================
 * FE #2 OWNS THIS MODE.
 * ===========================================================================
 *
 * Simulation mode is the teaching sandbox - the half of the product that exists so a
 * first-time user understands the mechanic in sixty seconds. Build on the shared map,
 * hit Run, and the city raises its own issues in plain language. It also offers ephemeral,
 * deterministic fixes that can be applied through the same builder path as a human edit.
 * These suggestions are a safe way to explore trade-offs, not a shortcut into voting.
 *
 * Everything on this screen after the metrics is EPHEMERAL BROWSER STATE. Issues are
 * never stored and never submitted to the proposals API - simulated is never real. The
 * raw `SimulationResultInput` is PUT to the city service, and an explicit Apply action
 * may persist the resulting map edit through the builder.
 *
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
  const [autoProposals, setAutoProposals] = useState<SimAutoProposal[]>([]);
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
  const animationRun = useRef(0);
  const computeTimer = useRef<number | null>(null);
  const sceneRef = useRef<CitySceneApi | null>(null);
  sceneRef.current = scene;
  const activeCityIdRef = useRef(city.id);
  const [runContext, setRunContext] = useState<{
    cityId: string;
    layoutRevision: number;
  } | null>(null);

  // Simulation results are local to the city that produced them. Clear them when the
  // menu switches cities so an open Simulation window cannot show the previous city's
  // metrics or paint its zones onto the newly selected map.
  useEffect(() => {
    return () => {
      if (computeTimer.current !== null) {
        window.clearTimeout(computeTimer.current);
      }
      animationRun.current += 1;
      sceneRef.current?.clearStates();
      sceneRef.current?.clearResidents();
      sceneRef.current?.clearZoneScores();
    };
  }, []);

  useEffect(() => {
    if (activeCityIdRef.current === city.id) return;
    activeCityIdRef.current = city.id;
    if (computeTimer.current !== null) {
      window.clearTimeout(computeTimer.current);
      computeTimer.current = null;
    }
    setIsComputing(false);
    animationRun.current += 1;
    scene?.clearStates();
    scene?.clearResidents();
    scene?.clearZoneScores();
    setRun(null);
    setRunContext(null);
    setIssues([]);
    setAutoProposals([]);
    setGenerated(null);
    setEngineError(null);
    setShowZones(true);
  }, [city.id, scene]);

  const result: SimulationResultInput | null =
    runContext?.cityId === city.id && runContext.layoutRevision === layout.layoutRevision
      ? run
      : layout.layoutRevision === 0
        ? storedQuery.data ?? city.lastSimulation ?? null
        : null;
  const lastRunAt =
    layout.layoutRevision === 0
      ? storedQuery.data?.runAt ?? city.lastSimulation?.runAt ?? null
      : null;

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
    if (computeTimer.current !== null) {
      window.clearTimeout(computeTimer.current);
    }
    scene?.clearZoneScores();
    setShowZones(false);
    setIsComputing(true);
    // Deferred a tick so the "Running..." state paints before the synchronous rejection
    // sampling below (up to 8 full simulations) blocks the thread.
    computeTimer.current = window.setTimeout(() => {
      computeTimer.current = null;
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
        setRunContext(null);
        setIssues([]);
        setAutoProposals([]);
        setEngineError(null);
      } catch (error) {
        setEngineError(errorMessage(error, 'The city generator could not run.'));
        setGenerated(null);
      } finally {
        setIsComputing(false);
      }
    }, 0);
  }

  function handleRun() {
    if (computeTimer.current !== null) {
      window.clearTimeout(computeTimer.current);
    }
    setIsComputing(true);
    // Deferred a tick so the "Running..." state paints before the synchronous engine call
    // below blocks the thread.
    computeTimer.current = window.setTimeout(() => {
      computeTimer.current = null;
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
        setRunContext({ cityId: city.id, layoutRevision: layout.layoutRevision });
        setShowZones(true);
        scene?.setZoneScores(computeZoneScores(next));
        const nextIssues = detectIssues(next, personas);
        setIssues(nextIssues);
        setAutoProposals(
          generateAutoProposals({
            city: liveCity,
            result: next,
            issues: nextIssues,
            personas,
            blockTypes,
          }),
        );
        animationRun.current += 1;
        void animateRun(scene, next, animationRun.current, animationRun);

        saveSimulation.mutate(next);
      } catch (error) {
        scene?.clearZoneScores();
        setShowZones(false);
        setEngineError(errorMessage(error, 'The simulation engine could not run.'));
        setRun(null);
        setRunContext(null);
        setIssues([]);
        setAutoProposals([]);
      } finally {
        setIsComputing(false);
      }
    }, 0);
  }

  function handleApplyAutoProposal(proposal: SimAutoProposal) {
    if (!layout.applyChanges(proposal.changes)) return;

    animationRun.current += 1;
    scene?.clearStates();
    scene?.clearResidents();
    scene?.clearZoneScores();
    setRun(null);
    setRunContext(null);
    setIssues([]);
    setAutoProposals([]);
    setShowZones(false);
  }

  if (personasQuery.isLoading) return <CenteredSpinner label="Loading the simulation" />;

  if (personasQuery.isError) {
    return (
      <Card>
        <EmptyState
          glyph={'\u{26A0}'}
          title="Could not load resident profiles"
          description={errorMessage(personasQuery.error, 'The simulation catalog is unavailable.')}
          action={
            <Button size="sm" variant="secondary" onClick={() => void personasQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  }

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
            title="Simulation could not run"
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

        {saveSimulation.isError && (
          <p role="alert" className="border-t border-line px-4 py-2.5 text-sm text-bad">
            The run completed, but it could not be saved: {errorMessage(saveSimulation.error)}
          </p>
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

      {result &&
        runContext?.cityId === city.id &&
        runContext.layoutRevision === layout.layoutRevision &&
        autoProposals.length > 0 && (
          <Card>
            <CardHeader
              title="Try a simulated fix"
              subtitle="Calculated locally; these suggestions never become real proposals or votes"
            />
            <ul className="divide-y divide-line">
              {autoProposals.map((proposal) => (
                <li key={proposal.id} className="flex flex-col gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm text-ink">{proposal.title}</p>
                    <p className="text-xs text-muted">{proposal.description}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {METRIC_NAMES.map((metric) => (
                      <div key={metric} className="rounded border border-line px-2 py-1.5">
                        <p className="text-[11px] text-faint">{metricLabel(metric)}</p>
                        <p className="text-xs tabular-nums" style={{ color: metricColor(metric) }}>
                          {signedDelta(proposal.deltas[metric])} pts · {proposal.approval[metric]}%
                        </p>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleApplyAutoProposal(proposal)}
                  >
                    Apply this simulated fix ({proposal.blockCost} block
                    {proposal.blockCost === 1 ? '' : 's'})
                  </Button>
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
                key={`${journey.personaId}-${journey.fromBlockId}-${journey.targetService}`}
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

      <AdvisorPanel
        simulation={result}
        citySnapshot={{
          gridWidth: city.gridWidth,
          gridHeight: city.gridHeight,
          blockBudget: city.blockBudget,
          blocksUsed: layout.blocksUsed,
          blocks: layout.blocks,
        }}
      />

      <p className="text-xs text-faint">Engine version {ENGINE_VERSION}</p>
    </div>
  );
}
