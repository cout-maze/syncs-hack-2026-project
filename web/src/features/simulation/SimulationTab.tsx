import { METRIC_NAMES } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { MetricBar } from '@/components/ui/MetricBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { useActiveCity } from '@/app/ActiveCityProvider';
import { useStoredSimulation } from '@/lib/api/hooks';
import { relativeTime } from '@/lib/format';
import { AdvisorPanel } from '@/features/advisor/AdvisorPanel';
import { ENGINE_VERSION } from './engine/runSimulation';

/**
 * ===========================================================================
 * FE #2 OWNS THIS TAB.
 * ===========================================================================
 *
 * Wired up already: the active city, the stored simulation result, and the Advisor
 * panel. What is left is the run itself.
 *
 * To finish it:
 *   1. Implement engine/runSimulation.ts.
 *   2. On "Run simulation": call it, then `useSaveSimulation(cityId).mutate(result)`.
 *   3. Animate the run through the map contract:
 *        const scene = useCityScene();
 *        scene?.setBlockState(id, 'flooded');
 *        await scene?.animateResident({ personaId, pathBlockIds });
 *      (see features/builder/scene/sceneApi.ts - the scene only exists while the
 *       City tab is mounted, so null-check or run the animation from the City tab.)
 *   4. Render journeys and their `issues[]` below the metrics.
 */
export function SimulationTab() {
  const { cityId, city } = useActiveCity();
  const storedQuery = useStoredSimulation(cityId);
  const result = storedQuery.data ?? city?.lastSimulation ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Simulation"
            subtitle={
              result ? `Last run ${relativeTime(result.runAt)}` : 'No run recorded for this city yet'
            }
            action={<Badge tone="warn">FE #2 to build</Badge>}
          />

          {result ? (
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              {METRIC_NAMES.map((metric) => (
                <MetricBar key={metric} metric={metric} value={result.metrics[metric]} />
              ))}
            </div>
          ) : (
            <EmptyState
              glyph={'\u{1F52C}'}
              title="The engine is not built yet"
              description={
                <>
                  Implement{' '}
                  <code className="rounded bg-ink-800 px-1 py-0.5 text-xs text-apricot">
                    features/simulation/engine/runSimulation.ts
                  </code>
                  , then save each run with{' '}
                  <code className="rounded bg-ink-800 px-1 py-0.5 text-xs text-apricot">
                    useSaveSimulation
                  </code>
                  . Everything else on this screen is already wired to the API.
                </>
              }
            />
          )}
        </Card>

        {result && result.journeys.length > 0 && (
          <Card>
            <CardHeader
              title="Journeys"
              subtitle={`${result.journeys.filter((journey) => !journey.accessible).length} of ${result.journeys.length} fail`}
            />
            <ul className="divide-y divide-line">
              {result.journeys.slice(0, 10).map((journey, index) => (
                <li key={`${journey.personaId}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
                  <Badge tone={journey.accessible ? 'good' : 'bad'}>
                    {journey.accessible ? 'OK' : 'Blocked'}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {journey.personaId} &rarr; {journey.targetService}
                  </span>
                  <span className="text-sm text-muted tabular-nums">
                    {Math.round(journey.travelTimeMinutes)} min
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <p className="text-xs text-faint">Engine version {ENGINE_VERSION}</p>
      </div>

      <AdvisorPanel />
    </div>
  );
}
