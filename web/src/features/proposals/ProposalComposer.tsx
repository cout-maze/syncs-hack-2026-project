import { useId, useMemo, useState } from 'react';
import { METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type { BlockChange, MetricName, PlacedBlock, Proposal } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { useCreateProposal } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor } from '@/lib/visuals';
import { plural } from '@/lib/format';
import type { CityWorkspaceApi } from '@/features/builder/CityWorkspace';

/**
 * Authoring a proposal by editing the map - the feature that ties Proposal mode back to
 * the product's main mechanic.
 *
 * The user edits the shared builder as usual; we diff the live layout against the city
 * the server last confirmed and turn the difference into `changes[]` - the same shape
 * Simulation mode's auto-proposals emit, so the map previews both identically.
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

  const [title, setTitle] = useState('');
  const [issue, setIssue] = useState('');
  const [description, setDescription] = useState('');
  const [votingMetrics, setVotingMetrics] = useState<MetricName[]>(['accessibility', 'community']);

  /** The map edits made since the city was last saved, as a proposal's block delta. */
  const changes = useMemo(
    () => diffBlocks(city.blocks, layout.blocks),
    [city.blocks, layout.blocks],
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

  function toggleMetric(metric: MetricName) {
    setVotingMetrics((prev) =>
      prev.includes(metric) ? prev.filter((item) => item !== metric) : [...prev, metric],
    );
  }

  function handleSubmit() {
    create.mutate(
      {
        title: title.trim(),
        issue: issue.trim() || undefined,
        description: description.trim(),
        changes: changes.length ? changes : undefined,
        location: changes[0] ? { x: changes[0].x, y: changes[0].y } : null,
        blockCost,
        expectedBenefits: [],
        affectedPersonaIds: [],
        votingMetrics,
      },
      { onSuccess: onCreated },
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
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a community garden"
          />

          <TextArea
            label="The issue"
            hint="The problem this exists to solve, in plain language."
            value={issue}
            onChange={setIssue}
            placeholder="The northern housing has no green or shared space within walking distance."
          />

          <TextArea
            label="What you propose"
            value={description}
            onChange={setDescription}
            placeholder="Convert one block near the northern housing into a shared community garden."
          />
        </div>
      </Card>

      {/* ------------------------------------------------- the change itself */}
      <Card>
        <CardHeader
          title="The change"
          subtitle="Edit the map beside this form - your edits become the proposal."
        />
        <div className="p-4">
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
                    <span className="font-semibold text-ink capitalize">{change.op}</span>{' '}
                    {change.typeId?.replace(/_/g, ' ') ?? 'block'} at ({change.x}, {change.y})
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">{plural(blockCost, 'block')} of budget</p>
            </>
          )}
        </div>
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
          <p className="border-t border-line px-4 py-2.5 text-sm text-bad">
            {errorMessage(create.error, 'That proposal could not be created.')}
          </p>
        )}
      </Card>
    </div>
  );
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
        className="rounded-lg border border-line-bright bg-paper-100 p-2.5 text-ink transition-colors placeholder:text-faint focus:border-honey-deep focus:outline-none"
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
