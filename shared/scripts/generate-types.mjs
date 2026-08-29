import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/generated");
fs.mkdirSync(outDir, { recursive: true });

const specs = [
  ["auth-service.yaml", "auth.ts"],
  ["city-service.yaml", "city.ts"],
  ["proposal-service.yaml", "proposals.ts"],
  ["advisor-service.yaml", "advisor.ts"],
];

for (const [spec, out] of specs) {
  const result = spawnSync(
    "npx",
    ["openapi-typescript", path.join(root, "specs", spec), "-o", path.join(outDir, out)],
    { stdio: "inherit", shell: true },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

fs.writeFileSync(
  path.join(outDir, "index.ts"),
  `export type * as Auth from "./auth";
export type * as City from "./city";
export type * as Proposals from "./proposals";
export type * as Advisor from "./advisor";
`,
);

console.log("Wrote OpenAPI types to shared/src/generated/");
