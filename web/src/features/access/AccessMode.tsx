import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Persona, PlacedBlock } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { useCityWorkspace, type CityWorkspaceApi } from '@/features/builder/CityWorkspace';
import { useCityScene } from '@/features/builder/scene/useCityScene';
import { usePersonas } from '@/lib/api/hooks';
import { blockGlyph, personaGlyph } from '@/lib/visuals';
import { cx } from '@/lib/format';
import {
  MINUTES_PER_BLOCK,
  TRANSPORT_STEP_MINUTES,
  describeJourney,
} from '@/features/simulation/engine/journeyCost';
import {
  THRESHOLD_CHOICES,
  defaultThresholds,
  evaluateAccess,
  failingHomeIds,
  loadAccessPlan,
  saveAccessPlan,
  type AccessCheck,
  type AccessPlan,
  type GroupRule,
} from './accessRules';

/**
 * ===========================================================================
 * ACCESS MODE - the journey cost model (§ 7.1) as a mode of its own.
 * ===========================================================================
 *
 * Simulation asks "what happens to this city?". Proposal asks "what should we
 * do about it?". Access asks the question underneath both: **who has to reach
 * what, and how long does it take them?**
 *
 * You set it per home. Each home gets one or more groups of residents; each
 * group gets one or more essential-access thresholds - a service it must reach
 * and the time limit it must reach it in. Every requirement is then just the
 * cost model run against the layout on screen, so a red row on this list is a
 * red route on the map, and moving one transport block changes both.
 *
 * Nothing here is stored on the server or submitted anywhere: the rules are the
 * user's own annotation of their city, kept in the browser.
 */
export function AccessMode() {
  // The map is mounted by the shell; this renders inside a floating window over it.
  return <AccessPanel workspace={useCityWorkspace()} />;
}

function AccessPanel({ workspace }: { workspace: CityWorkspaceApi }) {
  const { city, blockTypes, layout } = workspace;
  const scene = useCityScene();
  const personasQuery = usePersonas();
  const personas = useMemo(() => personasQuery.data ?? [], [personasQuery.data]);

  const [plan, setPlan] = useState<AccessPlan>(() => loadAccessPlan(city.id));
  const [openHomeId, setOpenHomeId] = useState<string | null>(null);
  const [focusedCheckId, setFocusedCheckId] = useState<string | null>(null);

  // Switching city switches rulebooks.
  useEffect(() => {
    setPlan(loadAccessPlan(city.id));
    setOpenHomeId(null);
    setFocusedCheckId(null);
  }, [city.id]);

  const update = useCallback(
    (next: AccessPlan) => {
      setPlan(next);
      saveAccessPlan(city.id, next);
    },
    [city.id],
  );

  const homes = useMemo(
    () =>
      layout.blocks
        .filter((block) => block.typeId === 'housing')
        .sort((a, b) => a.y - b.y || a.x - b.x),
    [layout.blocks],
  );

  const checks = useMemo(
    () =>
      evaluateAccess({
        blocks: layout.blocks,
        gridWidth: city.gridWidth,
        gridHeight: city.gridHeight,
        plan,
      }),
    [layout.blocks, city.gridWidth, city.gridHeight, plan],
  );

  const focused = checks.find((check) => check.id === focusedCheckId) ?? null;
  const met = checks.filter((check) => check.pass).length;

  /* ------------------------------------------------------------------ map */

  // The focused requirement is drawn as a route; everything else is cleared, so
  // the map never shows a journey the panel is not talking about.
  useEffect(() => {
    if (!scene) return;
    const journey = focused?.journey;
    scene.showJourney(
      journey
        ? {
            personaId: journey.personaId,
            cells: journey.cells,
            steps: journey.steps.map((step) => ({
              minutes: step.minutes,
              transport: step.transport,
            })),
            totalMinutes: journey.totalMinutes,
            thresholdMinutes: journey.thresholdMinutes,
            accessible: journey.accessible,
          }
        : null,
    );
    return () => scene.showJourney(null);
  }, [scene, focused]);

  // Homes that fail something are marked on the map itself, so the mode is
  // legible without reading the list.
  useEffect(() => {
    if (!scene) return;
    const failing = failingHomeIds(checks);
    for (const home of homes) {
      scene.setBlockState(home.id, failing.has(home.id) ? 'invalid' : 'normal');
    }
    return () => {
      for (const home of homes) scene.setBlockState(home.id, 'normal');
    };
  }, [scene, checks, homes]);

  /* -------------------------------------------------------------- editing */

  function groupsOf(blockId: string): GroupRule[] {
    return plan[blockId] ?? [];
  }

  function setGroups(blockId: string, groups: GroupRule[]) {
    const next = { ...plan };
    if (groups.length === 0) delete next[blockId];
    else next[blockId] = groups;
    update(next);
  }

  function toggleGroup(blockId: string, persona: Persona) {
    const groups = groupsOf(blockId);
    const existing = groups.find((group) => group.personaId === persona.id);
    setGroups(
      blockId,
      existing
        ? groups.filter((group) => group.personaId !== persona.id)
        : [...groups, { personaId: persona.id, thresholds: defaultThresholds(persona) }],
    );
  }

  function editThresholds(
    blockId: string,
    personaId: string,
    edit: (thresholds: GroupRule['thresholds']) => GroupRule['thresholds'],
  ) {
    setGroups(
      blockId,
      groupsOf(blockId).map((group) =>
        group.personaId === personaId ? { ...group, thresholds: edit(group.thresholds) } : group,
      ),
    );
  }

  if (personasQuery.isLoading) return <CenteredSpinner label="Loading the resident groups" />;

  if (homes.length === 0) {
    return (
      <EmptyState
        glyph={'\u{1F3E0}'}
        title="No homes yet"
        description="Place a housing block on the map. Access rules are set per home: who lives there, and what they have to be able to reach."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader
          title={checks.length === 0 ? 'No requirements yet' : `${met} of ${checks.length} met`}
          subtitle={`${MINUTES_PER_BLOCK} min per block, ${TRANSPORT_STEP_MINUTES} on transport, per-group time limits`}
          action={
            focused?.journey?.destination ? (
              <Button size="sm" variant="secondary" onClick={() => void scene?.walkJourney()}>
                Walk it
              </Button>
            ) : undefined
          }
        />

        {checks.length > 0 && (
          <div className="px-4 py-3" aria-live="polite">
            <div className="flex h-1.5 overflow-hidden rounded-pill bg-ink-800">
              <div
                className="bg-good transition-[width] duration-300"
                style={{ width: `${(met / checks.length) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              {checks.length - met === 0
                ? 'Every group can reach everything you asked for.'
                : `${checks.length - met} requirement${checks.length - met === 1 ? '' : 's'} the city does not meet. Failing homes are marked on the map.`}
            </p>
          </div>
        )}
      </Card>

      {focused && <FocusedJourney check={focused} blockTypes={blockTypes} />}

      <ul className="flex flex-col gap-2">
        {homes.map((home) => (
          <HomeRow
            key={home.id}
            home={home}
            groups={groupsOf(home.id)}
            personas={personas}
            checks={checks.filter((check) => check.blockId === home.id)}
            blockTypes={blockTypes}
            open={openHomeId === home.id}
            focusedCheckId={focusedCheckId}
            onToggleOpen={() => {
              const next = openHomeId === home.id ? null : home.id;
              setOpenHomeId(next);
              if (next) scene?.pulseCell({ x: home.x, y: home.y });
            }}
            onToggleGroup={(persona) => toggleGroup(home.id, persona)}
            onEditThresholds={(personaId, edit) => editThresholds(home.id, personaId, edit)}
            onFocusCheck={(id) => setFocusedCheckId((current) => (current === id ? null : id))}
          />
        ))}
      </ul>

      <p className="text-xs text-faint">
        Rules are kept in this browser, not on the server. They describe what you expect of the
        city; the minutes come from the journey cost model.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- one home */

function HomeRow({
  home,
  groups,
  personas,
  checks,
  blockTypes,
  open,
  focusedCheckId,
  onToggleOpen,
  onToggleGroup,
  onEditThresholds,
  onFocusCheck,
}: {
  home: PlacedBlock;
  groups: GroupRule[];
  personas: Persona[];
  checks: AccessCheck[];
  blockTypes: CityWorkspaceApi['blockTypes'];
  open: boolean;
  focusedCheckId: string | null;
  onToggleOpen: () => void;
  onToggleGroup: (persona: Persona) => void;
  onEditThresholds: (
    personaId: string,
    edit: (thresholds: GroupRule['thresholds']) => GroupRule['thresholds'],
  ) => void;
  onFocusCheck: (id: string) => void;
}) {
  const met = checks.filter((check) => check.pass).length;
  const failing = checks.length > 0 && met < checks.length;

  return (
    <li>
      <Card className={cx(failing && 'border-bad/40')}>
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        >
          <span aria-hidden="true" className="text-base">
            {blockGlyph('housing')}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-cream">
              Home ({home.x}, {home.y})
            </span>
            <span className="block truncate text-xs text-muted">
              {groups.length === 0
                ? 'Nobody assigned'
                : groups.map((group) => personaGlyph(group.personaId)).join(' ')}
              {groups.length > 0 &&
                ` · ${groups.length} group${groups.length === 1 ? '' : 's'}`}
            </span>
          </span>
          {checks.length > 0 && (
            <Badge tone={failing ? 'bad' : 'good'}>
              {met}/{checks.length}
            </Badge>
          )}
        </button>

        {open && (
          <div className="border-t border-line px-3 py-3">
            <p className="text-[11px] font-bold tracking-wide text-muted uppercase">
              Who lives here
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {personas.map((persona) => {
                const on = groups.some((group) => group.personaId === persona.id);
                return (
                  <li key={persona.id}>
                    <button
                      type="button"
                      onClick={() => onToggleGroup(persona)}
                      aria-pressed={on}
                      title={persona.description}
                      className={cx(
                        'rounded-pill border px-2 py-1 text-xs font-semibold transition-colors',
                        on
                          ? 'border-apricot bg-apricot/15 text-apricot'
                          : 'border-line-bright text-muted hover:text-cream',
                      )}
                    >
                      <span aria-hidden="true">{personaGlyph(persona.id)}</span> {persona.name}
                    </button>
                  </li>
                );
              })}
            </ul>

            {groups.length === 0 ? (
              <p className="mt-3 text-xs text-faint">
                Pick one or more groups. Each one gets its own set of things it must be able to
                reach.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {groups.map((group) => (
                  <GroupRules
                    key={group.personaId}
                    group={group}
                    persona={personas.find((persona) => persona.id === group.personaId) ?? null}
                    checks={checks.filter((check) => check.personaId === group.personaId)}
                    blockTypes={blockTypes}
                    focusedCheckId={focusedCheckId}
                    onEdit={(edit) => onEditThresholds(group.personaId, edit)}
                    onFocusCheck={onFocusCheck}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

/* ------------------------------------------------ one group's requirements */

function GroupRules({
  group,
  persona,
  checks,
  blockTypes,
  focusedCheckId,
  onEdit,
  onFocusCheck,
}: {
  group: GroupRule;
  persona: Persona | null;
  checks: AccessCheck[];
  blockTypes: CityWorkspaceApi['blockTypes'];
  focusedCheckId: string | null;
  onEdit: (edit: (thresholds: GroupRule['thresholds']) => GroupRule['thresholds']) => void;
  onFocusCheck: (id: string) => void;
}) {
  // Only services not already required by this group can be added.
  const unused = blockTypes.filter(
    (type) =>
      type.id !== 'housing' &&
      !group.thresholds.some((threshold) => threshold.service === type.id),
  );

  return (
    <div className="rounded-lg border border-line bg-ink-950/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-bold text-fog">
          <span aria-hidden="true">{personaGlyph(group.personaId)}</span>{' '}
          {persona?.name ?? group.personaId.replace(/_/g, ' ')}
        </p>
        {unused.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onEdit((thresholds) => [
                ...thresholds,
                {
                  service: unused[0]?.id ?? 'healthcare',
                  minutes: persona?.maxComfortableJourneyMinutes ?? 15,
                },
              ])
            }
            className="shrink-0 text-xs font-semibold text-apricot hover:underline"
          >
            + Requirement
          </button>
        )}
      </div>

      {group.thresholds.length === 0 ? (
        <p className="mt-2 text-xs text-faint">
          No requirements. This group lives here but the city owes it nothing.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {group.thresholds.map((threshold, index) => {
            const check = checks.find((candidate) => candidate.threshold.service === threshold.service);
            const focusedHere = check ? check.id === focusedCheckId : false;

            return (
              <li
                key={threshold.service}
                className={cx(
                  'flex flex-wrap items-center gap-1.5 rounded-md px-1.5 py-1',
                  focusedHere && 'bg-ink-800',
                )}
              >
                <select
                  aria-label="Service"
                  value={threshold.service}
                  onChange={(event) =>
                    onEdit((thresholds) =>
                      thresholds.map((candidate, position) =>
                        position === index
                          ? { ...candidate, service: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                  className="h-7 min-w-0 flex-1 rounded-md border border-line-bright bg-ink-950 px-1.5 text-xs text-cream"
                >
                  {blockTypes
                    .filter((type) => type.id !== 'housing')
                    .map((type) => (
                      <option key={type.id} value={type.id}>
                        {blockGlyph(type.id)} {type.name}
                      </option>
                    ))}
                </select>

                <span className="text-xs text-faint">within</span>

                <select
                  aria-label="Time limit in minutes"
                  value={threshold.minutes}
                  onChange={(event) =>
                    onEdit((thresholds) =>
                      thresholds.map((candidate, position) =>
                        position === index
                          ? { ...candidate, minutes: Number(event.target.value) }
                          : candidate,
                      ),
                    )
                  }
                  className="h-7 rounded-md border border-line-bright bg-ink-950 px-1.5 text-xs text-cream tabular-nums"
                >
                  {/* A persona's own limit (12 for the older resident) is not
                      always one of the presets, and a select with no matching
                      option would silently display the wrong number. */}
                  {minuteOptions(threshold.minutes).map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} min
                    </option>
                  ))}
                </select>

                {check && (
                  <button
                    type="button"
                    onClick={() => onFocusCheck(check.id)}
                    aria-pressed={focusedHere}
                    title="Show this journey on the map"
                    className={cx(
                      'rounded-pill border px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
                      check.pass
                        ? 'border-good/40 bg-good/15 text-good'
                        : 'border-bad/40 bg-bad/15 text-bad',
                    )}
                  >
                    {check.minutes === null ? 'no route' : `${check.minutes} min`}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onEdit((thresholds) => thresholds.filter((_, position) => position !== index))
                  }
                  aria-label="Remove this requirement"
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-ink-700 hover:text-cream"
                >
                  <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
                    <path
                      d="M3 3l10 10M13 3L3 13"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------------- the arithmetic behind one route */

function FocusedJourney({
  check,
  blockTypes,
}: {
  check: AccessCheck;
  blockTypes: CityWorkspaceApi['blockTypes'];
}) {
  const journey = check.journey;

  return (
    <Card className={cx(check.pass ? 'border-good/40' : 'border-bad/40')}>
      <div className="px-3 py-2.5" aria-live="polite">
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className="font-display text-xl font-extrabold tabular-nums"
            style={{ color: check.pass ? 'var(--color-good)' : 'var(--color-bad)' }}
          >
            {check.minutes === null ? 'No route' : `${check.minutes} min`}
          </span>
          <Badge tone={check.pass ? 'good' : 'bad'}>
            {check.pass ? 'Within limit' : `Limit ${check.threshold.minutes} min`}
          </Badge>
        </div>

        {journey?.destination ? (
          <p className="mt-1 text-xs text-muted">{describeJourney(journey, blockTypes)}</p>
        ) : (
          <p className="mt-1 text-xs text-bad">
            {journey?.issues[0] ?? 'This home is no longer on the map.'}
          </p>
        )}

        <ul className="mt-2 flex flex-wrap gap-3 text-[11px] text-faint">
          <Legend color="var(--color-good)" label={`Walked leg - ${MINUTES_PER_BLOCK} min`} />
          <Legend
            color="var(--color-block-transport)"
            label={`Transport leg - ${TRANSPORT_STEP_MINUTES} min`}
          />
          {journey && journey.multiplier !== 1 && (
            <Legend color="var(--color-apricot)" label={`×${journey.multiplier} this group`} />
          )}
        </ul>
      </div>
    </Card>
  );
}

/** The presets, plus whatever this requirement is actually set to. */
function minuteOptions(current: number): number[] {
  const choices = new Set<number>(THRESHOLD_CHOICES);
  choices.add(current);
  return [...choices].sort((a, b) => a - b);
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className="h-1 w-4 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </li>
  );
}
