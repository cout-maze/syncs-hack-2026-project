import { METRIC_LABELS, type EventType, type MetricName } from "@rmc/shared";
import { api } from "../../api/client";
import { runSimulation, type CatalogBlock, type CatalogPersona, type CityInput } from "./engine";
import type { CityScene } from "../builder/CityScene";

type SimResult = ReturnType<typeof runSimulation>;

type Props = {
  city: CityInput & { id: string };
  personas: CatalogPersona[];
  blockTypes: CatalogBlock[];
  scene: CityScene | null;
  onResult: (result: SimResult) => void;
  result: SimResult | null;
};

const EVENTS: { id: EventType; label: string }[] = [
  { id: "flood", label: "Flood" },
  { id: "tech_outage", label: "Power / tech outage" },
  { id: "population_change", label: "Population shift" },
];

export function SimulationView({ city, personas, blockTypes, scene, onResult, result }: Props) {
  async function run(event: EventType | "baseline") {
    const next = runSimulation(city, personas, blockTypes, event);
    onResult(next);
    const failed = next.journeys.find((journey) => !journey.accessible);
    if (failed) scene?.animateResident(failed.pathBlockIds);
    if (event === "flood") {
      for (const id of next.events[0]?.affectedBlockIds ?? []) scene?.setBlockState(id, "flooded");
    }
    if (event === "tech_outage") {
      for (const block of city.blocks.filter((item) => item.typeId === "technology_hub")) {
        scene?.setBlockState(block.id, "offline");
      }
    }
    try {
      await api(`/cities/${city.id}/simulation`, { method: "PUT", body: JSON.stringify(next) });
    } catch {
      /* persist is best-effort during early integration */
    }
  }

  return (
    <div className="panel">
      <header>
        <p className="eyebrow">Build → test → discover</p>
        <h2>Run a short city test.</h2>
        <p>The engine runs in the browser. The server only stores the latest result.</p>
      </header>
      <div className="row">
        <button type="button" className="primary" onClick={() => run("baseline")}>
          Test current layout
        </button>
        {EVENTS.map((event) => (
          <button key={event.id} type="button" className="ghost" onClick={() => run(event.id)}>
            {event.label}
          </button>
        ))}
      </div>
      {result ? (
        <div className="metrics">
          {(Object.keys(METRIC_LABELS) as MetricName[]).map((key) => (
            <div key={key}>
              <span>{METRIC_LABELS[key]}</span>
              <strong>{result.metrics[key]}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {result ? (
        <ul className="alerts">
          {result.events.map((event) => (
            <li key={event.eventType}>{event.summary}</li>
          ))}
          {result.journeys
            .filter((journey) => !journey.accessible)
            .map((journey) => (
              <li key={journey.personaId}>
                {journey.personaId.replaceAll("_", " ")}: {journey.issues?.[0]}
              </li>
            ))}
        </ul>
      ) : (
        <p>Run a test to store a SimulationResult and feed it to the Advisor.</p>
      )}
    </div>
  );
}
