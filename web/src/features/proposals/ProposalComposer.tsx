import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type { BlockChange, MetricName, PlacedBlock, Proposal } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { CenteredSpinner } from '@/components/ui/Spinner';
import { CityCanvas } from '@/features/builder/CityCanvas';
import { useBlockTypes, useCouncilCity, useCreateProposal } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor } from '@/lib/visuals';

/**
 * Authoring a proposal against the fixed council city. The composer owns a local draft map,
 * so placing, moving, or removing a block never mutates the user's simulation city or writes
 * to the backend until the proposal is submitted.
 */
export function ProposalComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (proposal: Proposal) => void;
}) {
  const create = useCreateProposal();
  const councilQuery = useCouncilCity();
  const blockTypesQuery = useBlockTypes();
  const councilCity = councilQuery.data;
  const blockTypes = blockTypesQuery.data ?? [];

  const [title, setTitle] = useState('');
  const [issue, setIssue] = useState('');
  const [description, setDescription] = useState('');
  const [votingMetrics, setVotingMetrics] = useState<MetricName[]>(['accessibility', 'community']);
  const [armedTypeId, setArmedTypeId] = useState('');
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [draftBlocks, setDraftBlocks] = useState<PlacedBlock[]>([]);
  const baselineRef = useRef<PlacedBlock[]>([]);
  const baselineCityIdRef = useRef<string | null>(null);
  const tempIdRef = useRef(0);

  useEffect(() => {
    if (!councilCity || baselineCityIdRef.current === councilCity.id) return;
    baselineCityIdRef.current = councilCity.id;
    baselineRef.current = councilCity.blocks;
    setDraftBlocks(councilCity.blocks);
  }, [councilCity]);

  const changes = useMemo(() => diffBlocks(baselineRef.current, draftBlocks), [draftBlocks]);
  const blockCost = useMemo(
    () =>
      changes.reduce(
        (sum, change) =>
          change.op === 'place' && change.typeId
            ? sum + (blockTypes.find((type) => type.id === change.typeId)?.cost ?? 0)
            : sum,
        0,
      ),
    [blockTypes, changes],
  );

  const ready = title.trim() !== '' && description.trim() !== '' && votingMetrics.length > 0;

  function blockAt(cell: { x: number; y: number }) {
    return draftBlocks.find((block) => block.x === cell.x && block.y === cell.y) ?? null;
  }

  function canPlace(cell: { x: number; y: number }, typeId: string) {
    if (!councilCity || blockAt(cell)) return false;
    const cost = blockTypes.find((type) => type.id === typeId)?.cost ?? 0;
    const used = draftBlocks.reduce(
      (sum, block) => sum + (blockTypes.find((type) => type.id === block.typeId)?.cost ?? 0),
      0,
    );
    return used + cost <= councilCity.blockBudget;
  }

  function place(cell: { x: number; y: number }, typeId: string) {
    if (!canPlace(cell, typeId)) return;
    tempIdRef.current += 1;
    setDraftBlocks((current) => [
      ...current,
      { id: `proposal_tmp_${tempIdRef.current}`, typeId, x: cell.x, y: cell.y },
    ]);
  }

  function handleCellClick(cell: { x: number; y: number }, block: PlacedBlock | null) {
    if (armedTypeId) {
      place(cell, armedTypeId);
      return;
    }
    if (selectedCell) {
      const selected = blockAt(selectedCell);
      if (selected && !block) {
        setDraftBlocks((current) =>
          current.map((candidate) =>
            candidate.id === selected.id ? { ...candidate, x: cell.x, y: cell.y } : candidate,
          ),
        );
        setSelectedCell(cell);
        return;
      }
    }
    setSelectedCell(block ? cell : null);
  }

  function removeSelected() {
    if (!selectedCell) return;
    const selected = blockAt(selectedCell);
    if (!selected) return;
    setDraftBlocks((current) => current.filter((block) => block.id !== selected.id));
    setSelectedCell(null);
  }

  function toggleMetric(metric: MetricName) {
    setVotingMetrics((prev) =>
      prev.includes(metric) ? prev.filter((item) => item !== metric) : [...prev, metric],
    );
  }

  function handleSubmit() {
    const anchor = changes.find((change) => change.op === 'place') ?? changes[0];
    create.mutate(
      {
        title: title.trim(),
        issue: issue.trim() || undefined,
        description: description.trim(),
        changes: changes.length ? changes : undefined,
        location: anchor ? { x: anchor.x, y: anchor.y } : null,
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
          subtitle="Describe the issue and what the community should help decide."
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

      {/* ------------------------------------------------- draft planning map */}
      <Card>
        <CardHeader
          title="The change"
          subtitle="Edit a private draft of the council map - your edits become the proposal."
        />
        {councilQuery.isLoading || blockTypesQuery.isLoading ? (
          <div className="p-4">
            <CenteredSpinner label="Loading the planning map" />
          </div>
        ) : councilQuery.isError || blockTypesQuery.isError || !councilCity ? (
          <p role="alert" className="p-4 text-sm text-bad">
            {errorMessage(
              councilQuery.error ?? blockTypesQuery.error,
              'The planning map is unavailable.',
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-xs text-muted">
              Choose a block, then click an empty plot to place it. Click a block and then an empty
              plot to move it; use Remove for a selected block. These edits are draft-only.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="proposal-block-type" className="text-xs font-semibold text-fog">
                Place
              </label>
              <select
                id="proposal-block-type"
                value={armedTypeId}
                onChange={(event) => setArmedTypeId(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-line-bright bg-paper-50 px-2 text-sm text-ink"
              >
                <option value="">Select a block</option>
                {blockTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name} ({type.cost} blocks)
                  </option>
                ))}
              </select>
              {selectedCell && blockAt(selectedCell) && (
                <Button size="sm" variant="danger" onClick={removeSelected}>
                  Remove selected
                </Button>
              )}
            </div>
            <div className="relative h-64 overflow-hidden rounded-lg border border-line-bright bg-paper-100">
              <CityCanvas
                city={{
                  gridWidth: councilCity.gridWidth,
                  gridHeight: councilCity.gridHeight,
                  blocks: draftBlocks,
                }}
                selectedCell={selectedCell}
                armedTypeId={armedTypeId || null}
                interactive
                registerScene={false}
                onCellFocus={setSelectedCell}
                onCellClick={handleCellClick}
                canPlace={canPlace}
                onDropBlock={place}
                className="absolute inset-0"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>
                {changes.length
                  ? `${changes.length} map change${changes.length === 1 ? '' : 's'}`
                  : 'No map changes yet'}
              </span>
              <span>
                {blockCost} block{blockCost === 1 ? '' : 's'} added
              </span>
            </div>
            {changes.length > 0 && (
              <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
                {changes.map((change, index) => (
                  <li
                    key={`${change.op}-${change.blockId ?? change.typeId ?? index}-${change.x}-${change.y}`}
                    className="text-sm text-fog"
                  >
                    <span className="font-semibold capitalize text-ink">{change.op}</span>{' '}
                    {change.typeId?.replace(/_/g, ' ') ?? 'block'} at ({change.x}, {change.y})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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

function diffBlocks(before: PlacedBlock[], after: PlacedBlock[]): BlockChange[] {
  const changes: BlockChange[] = [];
  const beforeById = new Map(before.map((block) => [block.id, block]));

  for (const block of after) {
    const original = beforeById.get(block.id);
    if (!original) {
      changes.push({ op: 'place', typeId: block.typeId, x: block.x, y: block.y });
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
        className="rounded-2xl bg-paper-0 p-3 text-ink transition-shadow placeholder:text-faint focus:ring-2 focus:ring-ink focus:outline-none"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
