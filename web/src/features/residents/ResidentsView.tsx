import { METRIC_LABELS } from "@rmc/shared";
import type { CatalogPersona } from "../simulation/engine";

type Journey = {
  personaId: string;
  targetService: string;
  travelTimeMinutes: number;
  accessible: boolean;
  issues?: string[];
};

type Props = {
  personas: CatalogPersona[];
  journeys: Journey[];
};

export function ResidentsView({ personas, journeys }: Props) {
  return (
    <div className="panel">
      <header>
        <p className="eyebrow">People are the other kind of block</p>
        <h2>The same city is not the same journey.</h2>
      </header>
      <div className="cards">
        {personas.map((persona) => {
          const journey = journeys.find((item) => item.personaId === persona.id);
          const named = persona as CatalogPersona & { name?: string; description?: string };
          return (
            <article key={persona.id} className="card">
              <h3>{named.name ?? persona.id}</h3>
              <p>{named.description}</p>
              <p>
                Needs {persona.priorityServices.join(", ").replaceAll("_", " ")}
              </p>
              {journey ? (
                <p className={journey.accessible ? "ok" : "bad"}>
                  {journey.accessible
                    ? `${journey.travelTimeMinutes} min to ${journey.targetService.replaceAll("_", " ")}`
                    : journey.issues?.[0] ?? "Journey failed"}
                </p>
              ) : (
                <p>Run a simulation to see this journey.</p>
              )}
            </article>
          );
        })}
      </div>
      <p className="hint">Metric keys stay in sync with voting: {Object.values(METRIC_LABELS).join(" · ")}</p>
    </div>
  );
}
