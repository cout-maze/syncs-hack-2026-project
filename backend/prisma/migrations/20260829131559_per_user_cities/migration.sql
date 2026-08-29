/*
  Warnings:

  - You are about to drop the column `kind` on the `cities` table. All the data in the column will be lost.
  - You are about to drop the column `blockTypeId` on the `placed_blocks` table. All the data in the column will be lost.
  - Made the column `ownerId` on table `cities` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `typeId` to the `placed_blocks` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "simulation_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cityId" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "journeys" JSONB NOT NULL,
    "events" JSONB NOT NULL,
    "engineVersion" TEXT,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "simulation_results_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My City',
    "gridWidth" INTEGER NOT NULL DEFAULT 10,
    "gridHeight" INTEGER NOT NULL DEFAULT 10,
    "blockBudget" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_cities" ("createdAt", "gridHeight", "gridWidth", "id", "name", "ownerId", "updatedAt") SELECT "createdAt", "gridHeight", "gridWidth", "id", "name", "ownerId", "updatedAt" FROM "cities";
DROP TABLE "cities";
ALTER TABLE "new_cities" RENAME TO "cities";
CREATE INDEX "cities_ownerId_idx" ON "cities"("ownerId");
CREATE TABLE "new_placed_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cityId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    CONSTRAINT "placed_blocks_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_placed_blocks" ("cityId", "id", "x", "y") SELECT "cityId", "id", "x", "y" FROM "placed_blocks";
DROP TABLE "placed_blocks";
ALTER TABLE "new_placed_blocks" RENAME TO "placed_blocks";
CREATE INDEX "placed_blocks_cityId_idx" ON "placed_blocks"("cityId");
CREATE UNIQUE INDEX "placed_blocks_cityId_x_y_key" ON "placed_blocks"("cityId", "x", "y");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "simulation_results_cityId_key" ON "simulation_results"("cityId");
