import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { AdvisorPanel } from "../advisor/AdvisorPanel";
import { BuilderView } from "../builder/BuilderView";
import type { CityScene, PlacedBlock } from "../builder/CityScene";
import { ProposalsView } from "../proposals/ProposalsView";
import { ResidentsView } from "../residents/ResidentsView";
import { SimulationView } from "../simulation/SimulationView";
import type { CatalogBlock, CatalogPersona } from "../simulation/engine";
import { runSimulation } from "../simulation/engine";

type Tab = "city" | "residents" | "simulation" | "proposals";
type City = {
  id: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  blockBudget: number;
  blocksUsed: number;
  blocks: PlacedBlock[];
};

export function AppShell() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("city");
  const [city, setCity] = useState<City | null>(null);
  const [personas, setPersonas] = useState<CatalogPersona[]>([]);
  const [blockTypes, setBlockTypes] = useState<CatalogBlock[]>([]);
  const [sim, setSim] = useState<ReturnType<typeof runSimulation> | null>(null);
  const sceneRef = useRef<CityScene | null>(null);

  useEffect(() => {
    (async () => {
      const [personaList, types, cities] = await Promise.all([
        api<CatalogPersona[]>("/catalog/personas"),
        api<CatalogBlock[]>("/catalog/block-types"),
        api<Array<{ id: string }>>("/cities"),
      ]);
      setPersonas(personaList);
      setBlockTypes(types);
      const loaded = cities[0]
        ? await api<City>(`/cities/${cities[0].id}`)
        : await api<City>("/cities", { method: "POST", body: JSON.stringify({ name: "Riverside" }) });
      setCity(loaded);
    })().catch(() => undefined);
  }, []);

  if (!city) return <p className="panel">Loading city…</p>;

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="eyebrow">Hackathon MVP</p>
          <h1>Rebuild My City</h1>
          <p>Every block changes the people around it.</p>
        </div>
        <nav>
          {(["city", "residents", "simulation", "proposals"] as Tab[]).map((id) => (
            <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {id[0].toUpperCase() + id.slice(1)}
            </button>
          ))}
        </nav>
        <div className="user">
          <span>{user?.displayName}</span>
          <button type="button" className="ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <div className="body">
        <main>
          {tab === "city" ? <BuilderView city={city} onCity={setCity} sceneRef={sceneRef} /> : null}
          {tab === "residents" ? <ResidentsView personas={personas} journeys={sim?.journeys ?? []} /> : null}
          {tab === "simulation" ? (
            <SimulationView
              city={city}
              personas={personas}
              blockTypes={blockTypes}
              scene={sceneRef.current}
              result={sim}
              onResult={setSim}
            />
          ) : null}
          {tab === "proposals" ? <ProposalsView /> : null}
        </main>
        <AdvisorPanel city={city} simulation={sim} />
      </div>
    </div>
  );
}
