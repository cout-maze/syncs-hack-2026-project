import { useEffect, useMemo, useState } from 'react';
import type { City } from '@rmc/shared';
import { Badge } from '@/components/ui/Badge';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { useCityWorkspace, type CityWorkspaceApi } from '@/features/builder/CityWorkspace';
import { useCityScene, useCouncilScene } from '@/features/builder/scene/useCityScene';
import { useCouncilCity } from '@/lib/api/hooks';
import { blockGlyph } from '@/lib/visuals';
import { cx } from '@/lib/format';
import { computeJourneys, computeRouteCells } from '@/features/simulation/engine/journeys';
import {
  COMFORTABLE_MINUTES,
  SERVICE_TYPE_IDS,
  UNREACHABLE_MINUTES,
} from '@/features/simulation/engine/constants';

/**
 * ===========================================================================
 * ACCESS - a corner popup, not a mode. One dropdown, one number.
 * ===========================================================================
 *
 * Not a button and not a floating window - it shows itself top-right whenever a home
 * is selected on either map, the same way the selected-block card shows itself
 * bottom-left. Select a home, see it; select nothing, it's gone. The close icon and
 * switching between Simulation and Proposal mode both clear the selection the same way.
 *
 * Deliberately not persona-based: the journey model underneath (engine/journeys.ts)
 * already treats every house the same way, at one flat comfortable-minutes threshold -
 * "there is no persona here" per that file's own header.
 *
 * `mapSelection.source` says which city the selected block came from: the live layout
 * you're editing, or the council's fixed city shown in Proposal mode. Same popup either
 * way, just routed against a different grid.
 */
export function AccessMode() {
  return <AccessPanel workspace={useCityWorkspace()} />;
}

function AccessPanel({ workspace }: { workspace: CityWorkspaceApi }) {
  const { city, blockTypes, layout, mapSelection } = workspace;
  // The live map's registered scene, and the council map's separate one - each stays
  // out of the other's registry (see scene/sceneApi.ts), so pick whichever is relevant.
  const citySceneHandle = useCityScene();
  const councilSceneHandle = useCouncilScene();
  const scene = mapSelection?.source === 'council' ? councilSceneHandle : citySceneHandle;
  const councilCityQuery = useCouncilCity();

  const [selectedService, setSelectedService] = useState('');

  // A clear (close icon, Escape, switching Simulation/Proposal) drops mapSelection to
  // null - the service choice shouldn't survive that, even though it does survive
  // switching from one home straight to another.
  useEffect(() => {
    if (!mapSelection) setSelectedService('');
  }, [mapSelection]);

  // Council data is fetched lazily - Proposal mode is the only thing that needs it,
  // and it's already cached with staleTime: Infinity by the time you can select there.
  const grid: Pick<City, 'gridWidth' | 'gridHeight' | 'blocks'> | null =
    mapSelection?.source === 'council'
      ? councilCityQuery.data
        ? {
            gridWidth: councilCityQuery.data.gridWidth,
            gridHeight: councilCityQuery.data.gridHeight,
            blocks: councilCityQuery.data.blocks,
          }
        : null
      : { gridWidth: city.gridWidth, gridHeight: city.gridHeight, blocks: layout.blocks };

  const services = useMemo(
    () => blockTypes.filter((type) => (SERVICE_TYPE_IDS as readonly string[]).includes(type.id)),
    [blockTypes],
  );

  const home = mapSelection?.block.typeId === 'housing' ? mapSelection.block : null;

  const journeys = useMemo(() => (home && grid ? computeJourneys(grid) : []), [home, grid]);

  const journey = home
    ? (journeys.find(
        (candidate) => candidate.fromBlockId === home.id && candidate.targetService === selectedService,
      ) ?? null)
    : null;

  // The route to the selected service, as ground cells (not just the buildings on it) -
  // origin and destination stay at full contrast; drawRouteTrace dims everything else.
  const trace = useMemo(() => {
    if (!home || !grid || !journey || journey.travelTimeMinutes >= UNREACHABLE_MINUTES) return null;
    const cells = computeRouteCells(grid, home.id, selectedService);
    if (!cells || cells.length === 0) return null;
    const destinationId = journey.pathBlockIds[journey.pathBlockIds.length - 1];
    return { cells, endpointBlockIds: destinationId ? [home.id, destinationId] : [home.id] };
  }, [home, grid, journey, selectedService]);

  // Clearing the selection or switching homes clears the trace too.
  useEffect(() => {
    if (!scene) return;
    scene.traceRoute(trace);
    return () => scene.traceRoute(null);
  }, [scene, trace]);

  if (!mapSelection) return null;

  return (
    <div className="fixed top-20 right-3 z-[150] w-72 rounded-card border border-line-bright bg-paper-0/95 p-3 pr-9 shadow-2xl shadow-black/20 backdrop-blur-md">
      <button
        type="button"
        onClick={workspace.clearSelection}
        aria-label="Close"
        className="absolute top-2 right-2 grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-paper-100 hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {mapSelection.source === 'council' && !grid ? (
        <CenteredSpinner label="Loading the council's city" />
      ) : !home ? (
        <NotAHome typeId={mapSelection.block.typeId} x={mapSelection.block.x} y={mapSelection.block.y} />
      ) : services.length === 0 ? (
        <p className="text-sm text-muted">
          Place a service block - healthcare, education, a park - to check how long this
          home takes to reach it.
        </p>
      ) : (
        <HomeAccess
          x={home.x}
          y={home.y}
          services={services}
          selectedService={selectedService}
          onSelectService={setSelectedService}
          journey={journey}
        />
      )}
    </div>
  );
}

function NotAHome({ typeId, x, y }: { typeId: string; x: number; y: number }) {
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden="true" className="text-base">
        {blockGlyph(typeId)}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">
          Not a home ({x}, {y})
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Access only checks travel time from homes. Select a housing block instead.
        </p>
      </div>
    </div>
  );
}

function HomeAccess({
  x,
  y,
  services,
  selectedService,
  onSelectService,
  journey,
}: {
  x: number;
  y: number;
  services: CityWorkspaceApi['blockTypes'];
  selectedService: string;
  onSelectService: (service: string) => void;
  journey: ReturnType<typeof computeJourneys>[number] | null;
}) {
  const hasRoute = journey ? journey.travelTimeMinutes < UNREACHABLE_MINUTES : false;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-base">
          {blockGlyph('housing')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">
            Home ({x}, {y})
          </span>
          <span className="block text-xs text-muted">
            {COMFORTABLE_MINUTES} min comfortable limit
          </span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <select
          aria-label="Service to check"
          value={selectedService}
          onChange={(event) => onSelectService(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-md border border-line-bright bg-paper-100 px-2 text-sm text-ink"
        >
          <option value="" disabled>
            Choose a service…
          </option>
          {services.map((type) => (
            <option key={type.id} value={type.id}>
              {blockGlyph(type.id)} {type.name}
            </option>
          ))}
        </select>

        {journey && (
          <span
            className={cx(
              'shrink-0 rounded-pill border px-2.5 py-1 text-sm font-bold tabular-nums',
              journey.accessible
                ? 'border-good/40 bg-good/15 text-good'
                : 'border-bad/40 bg-bad/15 text-bad',
            )}
          >
            {hasRoute ? `${journey.travelTimeMinutes} min` : 'No route'}
          </span>
        )}
      </div>

      {journey && hasRoute && !journey.accessible && (
        <Badge tone="bad" className="self-start">
          over {COMFORTABLE_MINUTES} min comfortable limit
        </Badge>
      )}
    </div>
  );
}
