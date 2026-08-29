import { METRIC_LABELS, type MetricName } from '@rmc/shared';
import { metricColor } from '@/lib/visuals';

/**
 * The single way a 0-100 metric is drawn, so simulation results and voting results
 * read as the same language (docs/03 asks for this explicitly).
 */
export function MetricBar({
  metric,
  value,
  caption,
  max = 100,
}: {
  metric: MetricName;
  value: number;
  caption?: string;
  max?: number;
}) {
  const clamped = Math.max(0, Math.min(max, value));
  const color = metricColor(metric);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-fog">{METRIC_LABELS[metric]}</span>
        <span className="font-display text-sm font-bold tabular-nums" style={{ color }}>
          {Math.round(clamped)}
          <span className="text-xs text-muted">/{max}</span>
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-pill bg-paper-200"
        role="meter"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={METRIC_LABELS[metric]}
      >
        <div
          className="h-full rounded-pill transition-[width] duration-500 ease-out"
          style={{ width: `${(clamped / max) * 100}%`, backgroundColor: color }}
        />
      </div>
      {caption && <p className="text-xs text-muted">{caption}</p>}
    </div>
  );
}
