import { useId, useState } from 'react';
import { METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type { MetricName, Proposal } from '@rmc/shared';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { useCreateProposal } from '@/lib/api/hooks';
import { errorMessage } from '@/lib/api/errors';
import { metricColor } from '@/lib/visuals';

/**
 * Authoring a proposal from the fixed planning map. Proposal mode describes a city change;
 * Simulation mode remains the place where the live city can be edited and tested.
 *
 * The proposal map is intentionally read-only. Existing proposals preview their complete
 * `changes[]` list; a newly raised issue can be discussion-only until a concrete plan is
 * added by the planning team.
 */
export function ProposalComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (proposal: Proposal) => void;
}) {
  const create = useCreateProposal();

  const [title, setTitle] = useState('');
  const [issue, setIssue] = useState('');
  const [description, setDescription] = useState('');
  const [votingMetrics, setVotingMetrics] = useState<MetricName[]>(['accessibility', 'community']);

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
        changes: undefined,
        location: null,
        blockCost: 0,
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

      {/* ------------------------------------------------- fixed planning map */}
      <Card>
        <CardHeader
          title="Planning map"
          subtitle="Read-only city overview - the live simulation map is where planning experiments happen."
        />
        <div className="p-4">
          <p className="text-sm text-muted">
            This map stays fixed while you describe the issue. Open a proposal to see every
            planned addition, move, or removal highlighted on the city.
          </p>
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
