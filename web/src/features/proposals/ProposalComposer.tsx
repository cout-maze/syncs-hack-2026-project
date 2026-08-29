import { useEffect, useId, useMemo, useState } from 'react';
import { METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type { BlockChange, MetricName, PlacedBlock, Proposal } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { useCreateProposal, usePersonas } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor, personaGlyph } from '@/lib/visuals';
import { plural } from '@/lib/format';
import type { CityWorkspaceApi } from '@/features/builder/CityWorkspace';

/**
 * Authoring a proposal by editing the map - the feature that ties Proposal mode back to
 * the product's main mechanic.
 *
 * The map goes into DRAFT MODE for as long as this is open: edits show on screen but the
 * autosave is suspended, and closing the composer puts the map back. That is the whole
 * point of a proposal - the change is something the community has not agreed to yet, so
 * building it before the vote would be the product contradicting itself.
 *
 * We diff the live layout against the draft's baseline and turn the difference into
 * `changes[]` - the same shape Simulation mode's auto-proposals emit, so the map previews
 * both identically.
 */
export function ProposalComposer({
  workspace,
  onClose,
  onCreated,
}: {
  workspace: CityWorkspaceApi;
  onClose: () => void;
  onCreated: (proposal: Proposal) => void;
}) {
  const { city, layout } = workspace;
  const create = useCreateProposal();
  const personasQuery = usePersonas();
  const personas = personasQuery.data ?? [];

  const [draft, setDraft] = useState(() => loadComposerDraft(city.id));
  const [votingMetrics, setVotingMetrics] = useState<MetricName[]>(['accessibility', 'community']);
  const [affectedPersonaIds, setAffectedPersonaIds] = useState<string[]>([]);
  const { title, issue, description, benefits } = draft;

  // Typed text survives an accidental Escape, which closes the whole window.
  useEffect(() => saveComposerDraft(city.id, draft), [city.id, draft]);

  const { beginDraft, endDraft } = layout;

  // Suspend the autosave for as long as we are authoring, and put the map back after.
  useEffect(() => {
    beginDraft();
    return () => endDraft();
  }, [beginDraft, endDraft]);

  /** The map edits made since the draft opened, as a proposal's block delta. */
  const changes = useMemo(
    () => diffBlocks(layout.draftBaseline ?? city.blocks, layout.blocks),
    [layout.draftBaseline, city.blocks, layout.blocks],
  );

  const blockCost = useMemo(
    () =>
      changes.reduce(
        (sum, change) =>
          change.op === 'place' && change.typeId ? sum + layout.costOf(change.typeId) : sum,
        0,
      ),
    [changes, layout],
  );

  const ready = title.trim() !== '' && description.trim() !== '' && votingMetrics.length > 0;

  const set = (patch: Partial<ComposerDraft>) => setDraft((current) => ({ ...current, ...patch }));

  function toggleMetric(metric: MetricName) {
    setVotingMetrics((prev) =>
      prev.includes(metric) ? prev.filter((item) => item !== metric) : [...prev, metric],
    );
  }

  function handleSubmit() {
    // Point the map marker at what is being built, not at whatever the diff listed first.
    const anchor = changes.find((change) => change.op === 'place') ?? changes[0];

    create.mutate(
      {
        title: title.trim(),
        issue: issue.trim() || undefined,
        description: description.trim(),
        changes: changes.length ? changes : undefined,
        location: anchor ? { x: anchor.x, y: anchor.y } : null,
        blockCost,
        expectedBenefits: splitBenefits(benefits),
        affectedPersonaIds,
        votingMetrics,
      },
      {
        onSuccess: (proposal) => {
          clearComposerDraft(city.id);
          onCreated(proposal);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" variant="ghost" onClick={onClose}>
        &larr; Cancel
      </Button>

      <Card>
        <CardHeader
          title="Raise an issue"
          subtitle="Say what is wrong, show the change on the map, then choose what the community rates."
        />

        <div className="flex flex-col gap-4 p-4">
          <Field
            label="Title"
            value={title}
            onChange={(event) => set({ title: event.target.value })}
            placeholder="Add a community garden"
          />

          <TextArea
            label="The issue"
            hint="The problem this exists to solve, in plain language."
            value={issue}
            onChange={(value) => set({ issue: value })}
            placeholder="The northern housing has no green or shared space within walking distance."
          />

          <TextArea
            label="What you propose"
            value={description}
            onChange={(value) => set({ description: value })}
            placeholder="Convert one block near the northern housing into a shared community garden."
          />

          <TextArea
            label="Expected benefits"
            hint="One per line. These are shown to everyone who rates the proposal."
            value={benefits}
            onChange={(value) => set({ benefits: value })}
            placeholder={'Community connection\nSustainability'}
          />
        </div>
      </Card>

      {/* ------------------------------------------------- the change itself */}
      <Card>
        <CardHeader
          title="The change"
          subtitle="Edit the map beside this form - your edits become the proposal."
          action={<Badge tone="warn">Draft</Badge>}
        />
        <div className="p-4">
          <p className="mb-3 text-xs text-faint">
            The city is not being changed. These edits live in this draft until the community
            approves the proposal - cancel and the map goes back.
          </p>
          {changes.length === 0 ? (
            <p className="text-sm text-muted">
              No map edits yet. Place, move or remove blocks on the grid and they will show up here.
              A discussion-only proposal with no change is fine too.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {changes.map((change, index) => (
                  <li key={index} className="text-sm text-fog">
                    <span className="font-semibold text-cream capitalize">{change.op}</span>{' '}
                    {change.typeId?.replace(/_/g, ' ') ?? 'block'} at ({change.x}, {change.y})
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">{plural(blockCost, 'block')} of budget</p>
            </>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------- who is affected */}
      <Card>
        <CardHeader
          title="Who does this affect?"
          subtitle="Optional, but it is what lets the Advisor and the results talk about people."
        />
        <ul className="flex flex-wrap gap-1.5 p-4">
          {personas.map((persona) => {
            const selected = affectedPersonaIds.includes(persona.id);
            return (
              <li key={persona.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  title={persona.description}
                  onClick={() =>
                    setAffectedPersonaIds((prev) =>
                      prev.includes(persona.id)
                        ? prev.filter((id) => id !== persona.id)
                        : [...prev, persona.id],
                    )
                  }
                  className={
                    selected
                      ? 'rounded-pill border border-apricot bg-apricot/15 px-2 py-1 text-xs font-semibold text-apricot'
                      : 'rounded-pill border border-line-bright px-2 py-1 text-xs font-semibold text-muted hover:text-cream'
                  }
                >
                  <span aria-hidden="true">{personaGlyph(persona.id)}</span> {persona.name}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* ------------------------------------------------- qualities to rate */}
      <Card>
        <CardHeader
          title="What should people rate?"
          subtitle="Pick the qualities this change actually affects."
        />
        <ul className="flex flex-wrap gap-2 p-4">
          {METRIC_NAMES.map((metric) => {
            const selected = votingMetrics.includes(metric);
            return (
              <li key={metric}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleMetric(metric)}
                  className="rounded-pill border px-3 py-1 text-sm font-semibold transition-colors"
                  style={{
                    borderColor: selected ? metricColor(metric) : undefined,
                    color: selected ? metricColor(metric) : undefined,
                    backgroundColor: selected ? `${metricColor(metric)}1a` : undefined,
                  }}
                >
                  {METRIC_LABELS[metric]}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
          <Button disabled={!ready} loading={create.isPending} onClick={handleSubmit}>
            Put it to the community
          </Button>
          {!ready && (
            <span className="text-xs text-muted">
              A title, a description and at least one quality are needed.
            </span>
          )}
        </div>

        {create.isError && (
          <p className="border-t border-line px-4 py-2.5 text-sm text-rose">
            {errorMessage(create.error, 'That proposal could not be created.')}
          </p>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------- draft persistence */

interface ComposerDraft {
  title: string;
  issue: string;
  description: string;
  /** One benefit per line, parsed on submit. */
  benefits: string;
}

const EMPTY_DRAFT: ComposerDraft = { title: '', issue: '', description: '', benefits: '' };
const DRAFT_PREFIX = 'rmc.proposal-draft.v1.';

/**
 * Escape closes the whole floating window, so half-written text needs somewhere to
 * survive. Session storage is right: it is per-tab and it should not outlive the sitting.
 */
function loadComposerDraft(cityId: string): ComposerDraft {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_PREFIX + cityId);
    if (!raw) return EMPTY_DRAFT;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_DRAFT;
    const candidate = parsed as Partial<ComposerDraft>;
    return {
      title: typeof candidate.title === 'string' ? candidate.title : '',
      issue: typeof candidate.issue === 'string' ? candidate.issue : '',
      description: typeof candidate.description === 'string' ? candidate.description : '',
      benefits: typeof candidate.benefits === 'string' ? candidate.benefits : '',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function saveComposerDraft(cityId: string, draft: ComposerDraft): void {
  try {
    window.sessionStorage.setItem(DRAFT_PREFIX + cityId, JSON.stringify(draft));
  } catch {
    // Storage is a convenience; losing it must not break authoring.
  }
}

function clearComposerDraft(cityId: string): void {
  try {
    window.sessionStorage.removeItem(DRAFT_PREFIX + cityId);
  } catch {
    // As above.
  }
}

function splitBenefits(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Field's multi-line sibling - Field itself wraps an <input>. */
function TextArea({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-fog">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-line-bright bg-ink-950/60 p-2.5 text-cream transition-colors placeholder:text-faint focus:border-apricot focus:outline-none"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Turn "the city as saved" vs "the city on screen" into a proposal's block delta.
 *
 * A block that kept its id but changed cell is a move; anything else is a place or a
 * remove. Ids are stable per placed block, which is what makes the diff honest.
 */
function diffBlocks(before: PlacedBlock[], after: PlacedBlock[]): BlockChange[] {
  const changes: BlockChange[] = [];
  const beforeById = new Map(before.map((block) => [block.id, block]));

  for (const block of after) {
    const original = beforeById.get(block.id);
    if (!original) {
      changes.push({
        op: 'place',
        typeId: block.typeId,
        x: block.x,
        y: block.y,
      });
    } else if (original.x !== block.x || original.y !== block.y) {
      changes.push({ op: 'move', blockId: block.id, x: block.x, y: block.y });
    }
  }

  const afterIds = new Set(after.map((block) => block.id));
  for (const block of before) {
    if (!afterIds.has(block.id)) {
      changes.push({ op: 'remove', blockId: block.id, x: block.x, y: block.y });
    }
  }

  return changes;
}
