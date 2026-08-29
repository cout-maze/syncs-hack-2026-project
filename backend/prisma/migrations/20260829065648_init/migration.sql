-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "cities" (
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

-- CreateTable
CREATE TABLE "placed_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cityId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    CONSTRAINT "placed_blocks_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locationX" INTEGER,
    "locationY" INTEGER,
    "blockCost" INTEGER NOT NULL,
    "expectedBenefits" JSONB NOT NULL,
    "affectedPersonaIds" JSONB NOT NULL,
    "votingMetrics" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "support" BOOLEAN NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "votes_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "cities_ownerId_idx" ON "cities"("ownerId");

-- CreateIndex
CREATE INDEX "placed_blocks_cityId_idx" ON "placed_blocks"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "placed_blocks_cityId_x_y_key" ON "placed_blocks"("cityId", "x", "y");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_results_cityId_key" ON "simulation_results"("cityId");

-- CreateIndex
CREATE INDEX "votes_proposalId_idx" ON "votes"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "votes_userId_proposalId_metric_key" ON "votes"("userId", "proposalId", "metric");
