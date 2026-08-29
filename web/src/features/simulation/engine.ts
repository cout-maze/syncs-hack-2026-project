import {
  ENGINE_VERSION,
  type EventType,
  type MetricName,
} from "@rmc/shared";

export type CatalogBlock = {
  id: string;
  cost: number;
};

export type CatalogPersona = {
  id: string;
  name?: string;
  description?: string;
  priorityServices: string[];
  maxComfortableJourneyMinutes?: number;
};

export type CityInput = {
  gridWidth: number;
  gridHeight: number;
  blockBudget: number;
  blocksUsed: number;
  blocks: Array<{ id: string; typeId: string; x: number; y: number }>;
};

type Coord = { x: number; y: number };

function neighbors(coord: Coord, width: number, height: number): Coord[] {
  return [
    { x: coord.x + 1, y: coord.y },
    { x: coord.x - 1, y: coord.y },
    { x: coord.x, y: coord.y + 1 },
    { x: coord.x, y: coord.y - 1 },
  ].filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height);
}

function key(coord: Coord) {
  return `${coord.x},${coord.y}`;
}

function shortestPath(
  city: CityInput,
  from: Coord,
  targets: Coord[],
  blocked: Set<string>,
) {
  const goal = new Set(targets.map(key));
  if (goal.has(key(from))) return { distance: 0, path: [from], target: from };
  const queue: Array<{ coord: Coord; cost: number; path: Coord[] }> = [
    { coord: from, cost: 0, path: [from] },
  ];
  const seen = new Map([[key(from), 0]]);
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (!current) break;
    for (const next of neighbors(current.coord, city.gridWidth, city.gridHeight)) {
      const id = key(next);
      if (blocked.has(id)) continue;
      const cell = city.blocks.find((block) => block.x === next.x && block.y === next.y);
      const step = cell?.typeId === "transport" ? 1 : 2;
      const cost = current.cost + step;
      if ((seen.get(id) ?? Infinity) <= cost) continue;
      seen.set(id, cost);
      const path = [...current.path, next];
      if (goal.has(id)) return { distance: cost, path, target: next };
      queue.push({ coord: next, cost, path });
    }
  }
  return { distance: Infinity, path: [] as Coord[], target: null as Coord | null };
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function assignHomes(city: CityInput, personas: CatalogPersona[]) {
  const homes = city.blocks.filter((block) => block.typeId === "housing");
  return personas.map((persona, index) => ({
    persona,
    home: homes[index % Math.max(homes.length, 1)] ?? null,
  }));
}

export function runSimulation(
  city: CityInput,
  personas: CatalogPersona[],
  _blockTypes: CatalogBlock[],
  event: EventType | "baseline" = "baseline",
) {
  const blocked = new Set<string>();
  if (event === "flood") {
    const mid = Math.floor(city.gridHeight / 2);
    for (let x = 0; x < city.gridWidth; x += 1) {
      const cell = city.blocks.find((block) => block.x === x && block.y === mid);
      if (cell?.typeId !== "transport") blocked.add(`${x},${mid}`);
    }
  }

  const housed = assignHomes(city, personas);
  const journeys = housed.map(({ persona, home }) => {
    const ignoreTech = persona.id === "limited_digital_access" || event === "tech_outage";
    const targetType = persona.priorityServices.find((service) =>
      ignoreTech ? service !== "technology_hub" : true,
    );
    const targets = city.blocks.filter((block) => block.typeId === targetType);
    if (!home) {
      return {
        personaId: persona.id,
        fromBlockId: null as string | null,
        targetService: targetType ?? "healthcare",
        pathBlockIds: [] as string[],
        travelTimeMinutes: 99,
        accessible: false,
        issues: ["No housing placed — this resident has nowhere to live."],
      };
    }
    if (!targetType || targets.length === 0) {
      return {
        personaId: persona.id,
        fromBlockId: home.id,
        targetService: targetType ?? "healthcare",
        pathBlockIds: [],
        travelTimeMinutes: 99,
        accessible: false,
        issues: [`No ${targetType?.replaceAll("_", " ") ?? "service"} block in the city.`],
      };
    }
    const { distance, path, target } = shortestPath(
      city,
      { x: home.x, y: home.y },
      targets.map((block) => ({ x: block.x, y: block.y })),
      blocked,
    );
    const minutes = Number.isFinite(distance) ? distance : 99;
    const limit = persona.maxComfortableJourneyMinutes ?? 15;
    const pathBlockIds = path
      .map((coord) => city.blocks.find((block) => block.x === coord.x && block.y === coord.y)?.id)
      .filter((id): id is string => Boolean(id));
    const hasTransport = pathBlockIds.some(
      (id) => city.blocks.find((block) => block.id === id)?.typeId === "transport",
    );
    const issues: string[] = [];
    if (minutes > limit) issues.push(`Journey exceeds ${limit} minutes (${minutes} min).`);
    if (persona.id === "wheelchair_user" && !hasTransport && minutes > 4) {
      issues.push("No accessible transport on route.");
    }
    if (!Number.isFinite(distance)) issues.push("Route is blocked.");
    return {
      personaId: persona.id,
      fromBlockId: home.id,
      targetService: targetType,
      pathBlockIds,
      travelTimeMinutes: minutes,
      accessible: issues.length === 0 && Boolean(target),
      issues,
    };
  });

  const housing = city.blocks.filter((block) => block.typeId === "housing");
  const healthcare = city.blocks.filter((block) => block.typeId === "healthcare");
  const parks = city.blocks.filter((block) => block.typeId === "park");
  const community = city.blocks.filter((block) => block.typeId === "community_hub");
  const transport = city.blocks.filter((block) => block.typeId === "transport");
  const tech = city.blocks.filter((block) => block.typeId === "technology_hub");
  const failed = journeys.filter((journey) => !journey.accessible).length;
  const metrics: Record<MetricName, number> = {
    accessibility: clamp(100 - failed * 14 - (healthcare.length ? 0 : 20)),
    sustainability: clamp(35 + parks.length * 12 + community.length * 8 - tech.length * 6),
    efficiency: clamp(40 + (city.blockBudget - city.blocksUsed) + housing.length * 4),
    community: clamp(20 + community.length * 16 + parks.length * 10),
    resilience: clamp(40 + transport.length * 10 - (event === "flood" ? 20 : 0) - (tech.length >= 3 ? 12 : 0)),
    inclusion: clamp(30 + (community.length ? 14 : 0) + (transport.length ? 10 : 0) - (tech.length >= 2 ? 12 : 0)),
  };

  const events =
    event === "baseline"
      ? []
      : [
          {
            eventType: event,
            passed: failed < personas.length / 2,
            affectedBlockIds: [...blocked]
              .map((id) => {
                const [x, y] = id.split(",").map(Number);
                return city.blocks.find((block) => block.x === x && block.y === y)?.id;
              })
              .filter((id): id is string => Boolean(id)),
            affectedPersonaIds: journeys.filter((journey) => !journey.accessible).map((journey) => journey.personaId),
            summary:
              event === "flood"
                ? "The flood cut the central row. Only transport blocks keep a crossing open."
                : event === "tech_outage"
                  ? "Technology hubs went dark. In-person services have to carry the city."
                  : "More older residents and families arrived; healthcare and education demand rose.",
          },
        ];

  return {
    metrics,
    journeys,
    events,
    engineVersion: ENGINE_VERSION,
  };
}

export function flawedLayout() {
  const cells: Array<{ typeId: string; x: number; y: number }> = [
    { typeId: "housing", x: 0, y: 0 },
    { typeId: "housing", x: 1, y: 0 },
    { typeId: "housing", x: 0, y: 1 },
    { typeId: "housing", x: 1, y: 1 },
    { typeId: "housing", x: 2, y: 0 },
    { typeId: "housing", x: 0, y: 2 },
    { typeId: "healthcare", x: 9, y: 9 },
    { typeId: "education", x: 8, y: 0 },
    { typeId: "technology_hub", x: 4, y: 4 },
    { typeId: "technology_hub", x: 5, y: 4 },
    { typeId: "technology_hub", x: 5, y: 5 },
    { typeId: "shared_resource_hub", x: 3, y: 3 },
  ];
  return cells;
}
