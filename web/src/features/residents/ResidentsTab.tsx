import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { usePersonas, useBlockTypes } from '@/lib/api/hooks';
import { personaGlyph, blockColor } from '@/lib/visuals';
import { errorMessage } from '@/lib/api/errors';
import { minutes } from '@/lib/format';

/**
 * ===========================================================================
 * FE #2 OWNS THIS TAB.
 * ===========================================================================
 *
 * The persona cards are built from the catalog and are ready to demo. What is
 * still to come is the post-simulation half: after a run, show each persona's
 * journeys and issues in plain language, e.g.
 *
 *   "Maria's route to healthcare takes 22 min and has no step-free access."
 *
 * Read them from the stored `SimulationResult.journeys`, grouped by `personaId`.
 */
export function ResidentsTab() {
  const personasQuery = usePersonas();
  const blockTypesQuery = useBlockTypes();

  if (personasQuery.isLoading) return <CenteredSpinner label="Meeting the residents" />;

  if (personasQuery.isError) {
    return (
      <Card>
        <EmptyState
          glyph={'\u{26A0}'}
          title="Could not load the residents"
          description={errorMessage(personasQuery.error)}
        />
      </Card>
    );
  }

  const personas = personasQuery.data ?? [];
  const blockTypes = blockTypesQuery.data ?? [];
  const nameOf = (typeId: string) =>
    blockTypes.find((type) => type.id === typeId)?.name ?? typeId.replace(/_/g, ' ');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-extrabold">Who lives here</h1>
        <p className="max-w-2xl text-sm text-balance text-muted">
          The same city is a different city depending on who you are. These seven residents
          are how accessibility becomes something you can see and fix, rather than a single
          score.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {personas.map((persona) => (
          <li key={persona.id}>
            <Card className="flex h-full flex-col">
              <div className="flex items-start gap-3 p-4">
                <span aria-hidden="true" className="text-2xl">
                  {personaGlyph(persona.id)}
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-cream">{persona.name}</h2>
                  <p className="mt-1 text-sm text-muted">{persona.description}</p>
                </div>
              </div>

              <div className="mt-auto flex flex-col gap-3 border-t border-line p-4">
                <div>
                  <p className="mb-1.5 text-xs font-bold tracking-wide text-muted uppercase">
                    Needs to reach
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {persona.priorityServices.map((typeId) => (
                      <li key={typeId}>
                        <span
                          className="inline-flex rounded-pill border px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            color: blockColor(typeId),
                            borderColor: `${blockColor(typeId)}59`,
                            backgroundColor: `${blockColor(typeId)}1a`,
                          }}
                        >
                          {nameOf(typeId)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {persona.maxComfortableJourneyMinutes !== undefined && (
                  <p className="text-xs text-muted">
                    Comfortable journey:{' '}
                    <span className="font-semibold text-fog">
                      up to {minutes(persona.maxComfortableJourneyMinutes)}
                    </span>
                  </p>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Card>
        <CardHeader
          title="Journeys after a simulation"
          subtitle="Per-persona routes and issues land here"
          action={<Badge tone="warn">FE #2 to build</Badge>}
        />
        <EmptyState
          glyph={'\u{1F6B6}'}
          title="Run a simulation to see how each resident travels"
          description="Group the stored journeys by personaId and show the failing ones first - that is what makes the accessibility problem concrete."
        />
      </Card>
    </div>
  );
}
