-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('active', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "ShortlistState" AS ENUM ('watching', 'dismissed', 'piped');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('invited', 'assessed', 'decisioned');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('offer', 'hold', 'reject');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'TA_LEAD';

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "careerTrackId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "employerId" TEXT,
ALTER COLUMN "institutionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CareerTrack" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archetype" "Archetype" NOT NULL,
    "clusterWeights" JSONB NOT NULL,
    "clusterTargets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archetype" "Archetype" NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'growth',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerRole" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "careerTrackId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seatsPlanned" INTEGER NOT NULL DEFAULT 1,
    "status" "RoleStatus" NOT NULL DEFAULT 'active',
    "clusterWeights" JSONB NOT NULL,
    "clusterTargets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployerRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shortlist" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "state" "ShortlistState" NOT NULL DEFAULT 'watching',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineCandidate" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL DEFAULT 'invited',
    "decision" "Decision",
    "signalMatch" DOUBLE PRECISION NOT NULL,
    "augmentedMatch" DOUBLE PRECISION,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PipelineCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandSignal" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "careerTrackId" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "targetScore" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareerTrack_code_key" ON "CareerTrack"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employer_name_key" ON "Employer"("name");

-- CreateIndex
CREATE INDEX "Employer_archetype_idx" ON "Employer"("archetype");

-- CreateIndex
CREATE INDEX "EmployerRole_employerId_status_idx" ON "EmployerRole"("employerId", "status");

-- CreateIndex
CREATE INDEX "EmployerRole_careerTrackId_status_idx" ON "EmployerRole"("careerTrackId", "status");

-- CreateIndex
CREATE INDEX "Shortlist_learnerId_idx" ON "Shortlist"("learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Shortlist_roleId_learnerId_key" ON "Shortlist"("roleId", "learnerId");

-- CreateIndex
CREATE INDEX "PipelineCandidate_employerId_stage_idx" ON "PipelineCandidate"("employerId", "stage");

-- CreateIndex
CREATE INDEX "PipelineCandidate_learnerId_idx" ON "PipelineCandidate"("learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineCandidate_roleId_learnerId_key" ON "PipelineCandidate"("roleId", "learnerId");

-- CreateIndex
CREATE INDEX "DemandSignal_careerTrackId_clusterCode_idx" ON "DemandSignal"("careerTrackId", "clusterCode");

-- CreateIndex
CREATE INDEX "DemandSignal_employerId_idx" ON "DemandSignal"("employerId");

-- CreateIndex
CREATE INDEX "Track_careerTrackId_idx" ON "Track"("careerTrackId");

-- CreateIndex
CREATE INDEX "User_employerId_idx" ON "User"("employerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_careerTrackId_fkey" FOREIGN KEY ("careerTrackId") REFERENCES "CareerTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerRole" ADD CONSTRAINT "EmployerRole_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerRole" ADD CONSTRAINT "EmployerRole_careerTrackId_fkey" FOREIGN KEY ("careerTrackId") REFERENCES "CareerTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "EmployerRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineCandidate" ADD CONSTRAINT "PipelineCandidate_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineCandidate" ADD CONSTRAINT "PipelineCandidate_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "EmployerRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineCandidate" ADD CONSTRAINT "PipelineCandidate_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandSignal" ADD CONSTRAINT "DemandSignal_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandSignal" ADD CONSTRAINT "DemandSignal_careerTrackId_fkey" FOREIGN KEY ("careerTrackId") REFERENCES "CareerTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
