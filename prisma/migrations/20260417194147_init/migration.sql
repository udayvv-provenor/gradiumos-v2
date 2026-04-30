-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DEAN', 'PLACEMENT_OFFICER', 'FACULTY_ADMIN', 'STUDENT');

-- CreateEnum
CREATE TYPE "Archetype" AS ENUM ('Product', 'Service', 'MassRecruiter');

-- CreateEnum
CREATE TYPE "ClusterCode" AS ENUM ('C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('mandatory', 'on_demand', 'stretch');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('assigned', 'in_progress', 'awaiting_assessment', 'complete');

-- CreateEnum
CREATE TYPE "AttemptKind" AS ENUM ('baseline', 'post_augmentation', 'retake');

-- CreateEnum
CREATE TYPE "StepKind" AS ENUM ('reading', 'video', 'practice', 'checkpoint');

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('baseline', 'post_augmentation', 'diagnostic');

-- CreateEnum
CREATE TYPE "SignalState" AS ENUM ('pending', 'issued', 'revoked');

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "planName" TEXT NOT NULL DEFAULT 'Institutional',
    "planValidUntil" TIMESTAMP(3) NOT NULL,
    "planFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexVersion" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "versionTag" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT true,
    "weights" JSONB NOT NULL,
    "thresholds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archetype" "Archetype" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "indexVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Learner" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Learner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyCluster" (
    "code" "ClusterCode" NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "archetypeWeights" JSONB NOT NULL,

    CONSTRAINT "CompetencyCluster_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CompetencyScore" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "scoreWeighted" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "freshness" DOUBLE PRECISION NOT NULL,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetencyScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "timeLimitSecs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "kind" "AttemptKind" NOT NULL,
    "scoreRaw" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "scoreNorm" DOUBLE PRECISION NOT NULL,
    "timeSecs" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAssignmentId" TEXT,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AugmentationProgramme" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "AugmentationProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AugmentationStep" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "StepKind" NOT NULL,
    "estMinutes" INTEGER NOT NULL,
    "contentItemId" TEXT,

    CONSTRAINT "AugmentationStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AugmentationAssignment" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'assigned',
    "stepsComplete" INTEGER NOT NULL DEFAULT 0,
    "stepsTotal" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "gateUnlockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AugmentationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AugmentationOutcome" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "scoreBefore" DOUBLE PRECISION NOT NULL,
    "scoreAfter" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AugmentationOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBankItem" (
    "id" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "kind" "StepKind" NOT NULL,
    "title" TEXT NOT NULL,
    "estMinutes" INTEGER NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentBankItem" (
    "id" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "timeLimitSecs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradiumSignal" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "state" "SignalState" NOT NULL DEFAULT 'pending',
    "portableToken" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GradiumSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Institution_name_idx" ON "Institution"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_institutionId_idx" ON "User"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "IndexVersion_institutionId_idx" ON "IndexVersion"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "IndexVersion_institutionId_versionTag_key" ON "IndexVersion"("institutionId", "versionTag");

-- CreateIndex
CREATE INDEX "Track_institutionId_idx" ON "Track"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_institutionId_name_key" ON "Track"("institutionId", "name");

-- CreateIndex
CREATE INDEX "Cohort_trackId_idx" ON "Cohort"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_institutionId_name_key" ON "Cohort"("institutionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Learner_email_key" ON "Learner"("email");

-- CreateIndex
CREATE INDEX "Learner_cohortId_idx" ON "Learner"("cohortId");

-- CreateIndex
CREATE INDEX "Learner_trackId_idx" ON "Learner"("trackId");

-- CreateIndex
CREATE INDEX "Learner_institutionId_idx" ON "Learner"("institutionId");

-- CreateIndex
CREATE INDEX "CompetencyScore_clusterCode_idx" ON "CompetencyScore"("clusterCode");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyScore_learnerId_clusterCode_key" ON "CompetencyScore"("learnerId", "clusterCode");

-- CreateIndex
CREATE INDEX "Assessment_clusterCode_idx" ON "Assessment"("clusterCode");

-- CreateIndex
CREATE INDEX "Attempt_learnerId_clusterCode_idx" ON "Attempt"("learnerId", "clusterCode");

-- CreateIndex
CREATE INDEX "Attempt_takenAt_idx" ON "Attempt"("takenAt");

-- CreateIndex
CREATE INDEX "AugmentationProgramme_institutionId_idx" ON "AugmentationProgramme"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AugmentationProgramme_cohortId_clusterCode_key" ON "AugmentationProgramme"("cohortId", "clusterCode");

-- CreateIndex
CREATE UNIQUE INDEX "AugmentationStep_programmeId_orderIndex_key" ON "AugmentationStep"("programmeId", "orderIndex");

-- CreateIndex
CREATE INDEX "AugmentationAssignment_learnerId_idx" ON "AugmentationAssignment"("learnerId");

-- CreateIndex
CREATE INDEX "AugmentationAssignment_status_idx" ON "AugmentationAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AugmentationAssignment_programmeId_learnerId_key" ON "AugmentationAssignment"("programmeId", "learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "AugmentationOutcome_assignmentId_key" ON "AugmentationOutcome"("assignmentId");

-- CreateIndex
CREATE INDEX "AugmentationOutcome_learnerId_clusterCode_idx" ON "AugmentationOutcome"("learnerId", "clusterCode");

-- CreateIndex
CREATE INDEX "ContentBankItem_clusterCode_idx" ON "ContentBankItem"("clusterCode");

-- CreateIndex
CREATE INDEX "AssessmentBankItem_clusterCode_idx" ON "AssessmentBankItem"("clusterCode");

-- CreateIndex
CREATE INDEX "GradiumSignal_state_idx" ON "GradiumSignal"("state");

-- CreateIndex
CREATE UNIQUE INDEX "GradiumSignal_learnerId_clusterCode_key" ON "GradiumSignal"("learnerId", "clusterCode");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexVersion" ADD CONSTRAINT "IndexVersion_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_indexVersionId_fkey" FOREIGN KEY ("indexVersionId") REFERENCES "IndexVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyScore" ADD CONSTRAINT "CompetencyScore_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyScore" ADD CONSTRAINT "CompetencyScore_clusterCode_fkey" FOREIGN KEY ("clusterCode") REFERENCES "CompetencyCluster"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_clusterCode_fkey" FOREIGN KEY ("clusterCode") REFERENCES "CompetencyCluster"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationProgramme" ADD CONSTRAINT "AugmentationProgramme_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationProgramme" ADD CONSTRAINT "AugmentationProgramme_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationProgramme" ADD CONSTRAINT "AugmentationProgramme_clusterCode_fkey" FOREIGN KEY ("clusterCode") REFERENCES "CompetencyCluster"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationStep" ADD CONSTRAINT "AugmentationStep_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AugmentationProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationStep" ADD CONSTRAINT "AugmentationStep_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentBankItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationAssignment" ADD CONSTRAINT "AugmentationAssignment_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AugmentationProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationAssignment" ADD CONSTRAINT "AugmentationAssignment_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationOutcome" ADD CONSTRAINT "AugmentationOutcome_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AugmentationAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationOutcome" ADD CONSTRAINT "AugmentationOutcome_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AugmentationOutcome" ADD CONSTRAINT "AugmentationOutcome_clusterCode_fkey" FOREIGN KEY ("clusterCode") REFERENCES "CompetencyCluster"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBankItem" ADD CONSTRAINT "ContentBankItem_clusterCode_fkey" FOREIGN KEY ("clusterCode") REFERENCES "CompetencyCluster"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBankItem" ADD CONSTRAINT "AssessmentBankItem_clusterCode_fkey" FOREIGN KEY ("clusterCode") REFERENCES "CompetencyCluster"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradiumSignal" ADD CONSTRAINT "GradiumSignal_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradiumSignal" ADD CONSTRAINT "GradiumSignal_clusterCode_fkey" FOREIGN KEY ("clusterCode") REFERENCES "CompetencyCluster"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
