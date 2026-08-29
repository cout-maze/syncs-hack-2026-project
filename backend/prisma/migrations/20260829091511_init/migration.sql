/*
  Warnings:

  - You are about to drop the `simulation_results` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `blockBudget` on the `cities` table. All the data in the column will be lost.
  - You are about to drop the column `typeId` on the `placed_blocks` table. All the data in the column will be lost.
  - You are about to drop the column `affectedPersonaIds` on the `proposals` table. All the data in the column will be lost.
  - You are about to drop the column `blockCost` on the `proposals` table. All the data in the column will be lost.
  - You are about to drop the column `expectedBenefits` on the `proposals` table. All the data in the column will be lost.
  - You are about to drop the column `locationX` on the `proposals` table. All the data in the column will be lost.
  - You are about to drop the column `locationY` on the `proposals` table. All the data in the column will be lost.
  - You are about to drop the column `votingMetrics` on the `proposals` table. All the data in the column will be lost.
  - You are about to drop the column `metric` on the `votes` table. All the data in the column will be lost.
  - You are about to drop the column `support` on the `votes` table. All the data in the column will be lost.
  - Added the required column `kind` to the `cities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `blockTypeId` to the `placed_blocks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `changeType` to the `proposals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdById` to the `proposals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `x` to the `proposals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `y` to the `proposals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `value` to the `votes` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "simulation_results_cityId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "simulation_results";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'My City',
    "gridWidth" INTEGER NOT NULL DEFAULT 40,
    "gridHeight" INTEGER NOT NULL DEFAULT 40,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_cities" ("createdAt", "gridHeight", "gridWidth", "id", "name", "ownerId", "updatedAt") SELECT "createdAt", "gridHeight", "gridWidth", "id", "name", "ownerId", "updatedAt" FROM "cities";
DROP TABLE "cities";
ALTER TABLE "new_cities" RENAME TO "cities";
CREATE UNIQUE INDEX "cities_ownerId_key" ON "cities"("ownerId");
CREATE TABLE "new_placed_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cityId" TEXT NOT NULL,
    "blockTypeId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    CONSTRAINT "placed_blocks_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_placed_blocks" ("cityId", "id", "x", "y") SELECT "cityId", "id", "x", "y" FROM "placed_blocks";
DROP TABLE "placed_blocks";
ALTER TABLE "new_placed_blocks" RENAME TO "placed_blocks";
CREATE INDEX "placed_blocks_cityId_idx" ON "placed_blocks"("cityId");
CREATE UNIQUE INDEX "placed_blocks_cityId_x_y_key" ON "placed_blocks"("cityId", "x", "y");
CREATE TABLE "new_proposals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "blockTypeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "proposals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_proposals" ("createdAt", "description", "id", "status", "title") SELECT "createdAt", "description", "id", "status", "title" FROM "proposals";
DROP TABLE "proposals";
ALTER TABLE "new_proposals" RENAME TO "proposals";
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_users" ("createdAt", "displayName", "email", "id", "passwordHash") SELECT "createdAt", "displayName", "email", "id", "passwordHash" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE TABLE "new_votes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "votes_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_votes" ("id", "proposalId", "updatedAt", "userId") SELECT "id", "proposalId", "updatedAt", "userId" FROM "votes";
DROP TABLE "votes";
ALTER TABLE "new_votes" RENAME TO "votes";
CREATE INDEX "votes_proposalId_idx" ON "votes"("proposalId");
CREATE UNIQUE INDEX "votes_userId_proposalId_key" ON "votes"("userId", "proposalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
