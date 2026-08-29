import { useState } from "react";
import { METRIC_LABELS } from "@rmc/shared";
import { api } from "../../api/client";
import type { CityInput } from "../simulation/engine";
import type { runSimulation } from "../simulation/engine";

type SimResult = ReturnType<typeof runSimulation>;

type Report = {
  headline: string;
  biggestWeakness: { metric: keyof typeof METRIC_LABELS; explanation: string };
  affectedGroups: Array<{ personaId: string; impact: string }>;
  suggestions: Array<{ title: string; description: string }>;
  fallback?: boolean;
};

type Props = {
  city: CityInput;
  simulation: SimResult | null;
};

export function AdvisorPanel({ city, simulation }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!simulation) {
      setError("Run a simulation first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await api<Report>("/advisor/analysis", {
        method: "POST",
        body: JSON.stringify({
          city: {
            gridWidth: city.gridWidth,
            gridHeight: city.gridHeight,
            blockBudget: city.blockBudget,
            blocksUsed: city.blocksUsed,
            blocks: city.blocks,
          },
          simulation,
        }),
      });
      setReport(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Advisor unavailable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="advisor">
      <p className="eyebrow">City Advisor</p>
      <h2>Explains. Does not decide.</h2>
      <p>Proposal scores still come only from citizen votes.</p>
      <button type="button" className="primary" onClick={ask} disabled={loading}>
        {loading ? "Reading the city…" : "Ask for advice"}
      </button>
      {error ? <p className="error">{error}</p> : null}
      {report ? (
        <div className="card">
          {report.fallback ? <p className="eyebrow">Fallback explainer</p> : null}
          <p>{report.headline}</p>
          <p>
            <strong>{METRIC_LABELS[report.biggestWeakness.metric]}:</strong> {report.biggestWeakness.explanation}
          </p>
          <ul>
            {report.affectedGroups.map((group) => (
              <li key={group.personaId}>
                {group.personaId.replaceAll("_", " ")}: {group.impact}
              </li>
            ))}
          </ul>
          <ol>
            {report.suggestions.map((item) => (
              <li key={item.title}>
                <strong>{item.title}.</strong> {item.description}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p>Place blocks, simulate, then ask what the city is doing to people.</p>
      )}
    </aside>
  );
}
