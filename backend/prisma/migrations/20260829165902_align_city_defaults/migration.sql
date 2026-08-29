-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My City',
    "gridWidth" INTEGER NOT NULL DEFAULT 30,
    "gridHeight" INTEGER NOT NULL DEFAULT 30,
    "blockBudget" INTEGER NOT NULL DEFAULT 900,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_cities" ("blockBudget", "createdAt", "gridHeight", "gridWidth", "id", "name", "ownerId", "updatedAt") SELECT "blockBudget", "createdAt", "gridHeight", "gridWidth", "id", "name", "ownerId", "updatedAt" FROM "cities";
DROP TABLE "cities";
ALTER TABLE "new_cities" RENAME TO "cities";
CREATE INDEX "cities_ownerId_idx" ON "cities"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
