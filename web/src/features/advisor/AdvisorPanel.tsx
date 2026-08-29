import { useEffect } from 'react';
import { METRIC_LABELS } from '@rmc/shared';
import type { SimulationResultInput } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveCity } from '@/app/ActiveCityProvider';
import { useAdvisorAnalysis, useStoredSimulation } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { personaGlyph } from '@/lib/visuals';

/**
 * ===========================================================================
 * FE #2 OWNS THIS PANEL.
 * ===========================================================================
 *
 * The call and the rendering are done; what is missing is a fresh simulation to
 * analyse. Once the engine runs, pass its result straight through instead of the
 * stored one so the Advisor sees the newest numbers.
 *
 * House rule from the proposal doc: the Advisor explains, it never judges. Do not
 * render its output as a score, a prediction, or a voting recommendation.
 */
export function AdvisorPanel({ simulation }: { simulation?: SimulationResultInput | null }) {
  const { cityId, city } = useActiveCity();
  const storedQuery = useStoredSimulation(cityId);
  const activeSimulation =
    simulation !== undefined ? simulation : storedQuery.data ?? city?.lastSimulation ?? null;
  const analysis = useAdvisorAnalysis();

  // An analysis belongs to the exact simulation it was requested for. Clear it when
  // the simulation changes (including when a layout edit invalidates the result) so
  // the panel cannot present advice for stale city data.
  useEffect(() => {
    analysis.reset();
  }, [simulation]);

  const report = analysis.data;

  return (
    <Card className="self-start">
      <CardHeader
        title="City Advisor"
        subtitle="Explains the trade-offs. Never decides them."
        action={
          <Button
            size="sm"
            loading={analysis.isPending}
            disabled={!city || !activeSimulation}
            onClick={() => {
              if (!city || !activeSimulation) return;
              analysis.mutate({
                city: {
                  gridWidth: city.gridWidth,
                  gridHeight: city.gridHeight,
                  blockBudget: city.blockBudget,
                  blocksUsed: city.blocksUsed,
                  blocks: city.blocks,
                },
                simulation: activeSimulation,
              });
            }}
          >
            Ask the Advisor
          </Button>
        }
      />

      <div className="p-4">
        {analysis.isPending && <Spinner label="Thinking about your city..." />}

        {analysis.isError && (
          <p role="alert" className="text-sm text-bad">
            {errorMessage(analysis.error, 'The Advisor is unavailable right now.')}
          </p>
        )}

        {!analysis.isPending && !report && !analysis.isError && (
          <EmptyState
            glyph={'\u{1F4AC}'}
            title={activeSimulation ? 'Ready when you are' : 'Run a simulation first'}
            description={
              activeSimulation
                ? 'The Advisor reads your latest simulation and explains what it sees.'
                : 'The Advisor needs journey and metric data before it has anything to say.'
            }
          />
        )}

        {report && (
          <div className="flex flex-col gap-4">
            {report.fallback && (
              <Badge tone="warn">Canned advice - the language model was unavailable</Badge>
            )}

            <p className="text-balance font-display text-lg font-bold text-ink">
              {report.headline}
            </p>

            <div className="rounded-lg border border-line bg-paper-100 p-3">
              <p className="text-xs font-bold tracking-wide text-muted uppercase">
                Biggest weakness &middot; {METRIC_LABELS[report.biggestWeakness.metric]}
              </p>
              <p className="mt-1 text-sm">{report.biggestWeakness.explanation}</p>
            </div>

            {report.affectedGroups.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
                  Who this affects
                </p>
                <ul className="flex flex-col gap-2">
                  {report.affectedGroups.map((group) => (
                    <li key={group.personaId} className="flex gap-2 text-sm">
                      <span aria-hidden="true">{personaGlyph(group.personaId)}</span>
                      <span>{group.impact}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.suggestions.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
                  Things you could try
                </p>
                <ul className="flex flex-col gap-2">
                  {report.suggestions.map((suggestion) => (
                    <li
                      key={suggestion.title}
                      className="rounded-lg border border-line bg-paper-100 p-3"
                    >
                      <p className="text-sm font-semibold text-ink">{suggestion.title}</p>
                      <p className="mt-1 text-sm text-muted">{suggestion.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.tradeoffs.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-muted">
                {report.tradeoffs.map((tradeoff) => (
                  <li key={tradeoff}>&middot; {tradeoff}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
