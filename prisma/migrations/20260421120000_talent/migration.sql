-- CreateEnum
CREATE TYPE "ResumeVariant" AS ENUM ('general', 'matched_company', 'jd_tailored');

-- CreateEnum
CREATE TYPE "AssessmentItemKind" AS ENUM ('mcq', 'descriptive', 'coding', 'simulation');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'LEARNER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "learnerId" TEXT;

-- CreateTable
CREATE TABLE "CareerTrackEnrollment" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "careerTrackId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerTrackEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "careerTrackId" TEXT NOT NULL,
    "variant" "ResumeVariant" NOT NULL DEFAULT 'general',
    "matchedRoleId" TEXT,
    "jdText" TEXT,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "signalScoreAtGen" INTEGER NOT NULL,
    "signalConfAtGen" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAttemptV2" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "kind" "AssessmentItemKind" NOT NULL,
    "careerTrackId" TEXT,
    "assessmentRef" TEXT NOT NULL,
    "score" INTEGER,
    "timeSpentSec" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answers" JSONB NOT NULL,
    "feedback" JSONB,

    CONSTRAINT "AssessmentAttemptV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorSession" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "clusterCode" "ClusterCode" NOT NULL,
    "subtopicCode" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "transcript" JSONB NOT NULL,
    "rubric" JSONB,

    CONSTRAINT "TutorSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareerTrackEnrollment_learnerId_idx" ON "CareerTrackEnrollment"("learnerId");

-- CreateIndex
CREATE INDEX "CareerTrackEnrollment_careerTrackId_idx" ON "CareerTrackEnrollment"("careerTrackId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerTrackEnrollment_learnerId_careerTrackId_key" ON "CareerTrackEnrollment"("learnerId", "careerTrackId");

-- CreateIndex
CREATE INDEX "Resume_learnerId_careerTrackId_idx" ON "Resume"("learnerId", "careerTrackId");

-- CreateIndex
CREATE INDEX "Resume_careerTrackId_idx" ON "Resume"("careerTrackId");

-- CreateIndex
CREATE INDEX "AssessmentAttemptV2_learnerId_clusterCode_idx" ON "AssessmentAttemptV2"("learnerId", "clusterCode");

-- CreateIndex
CREATE INDEX "AssessmentAttemptV2_learnerId_submittedAt_idx" ON "AssessmentAttemptV2"("learnerId", "submittedAt");

-- CreateIndex
CREATE INDEX "TutorSession_learnerId_clusterCode_idx" ON "TutorSession"("learnerId", "clusterCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_learnerId_key" ON "User"("learnerId");

-- CreateIndex
CREATE INDEX "User_learnerId_idx" ON "User"("learnerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerTrackEnrollment" ADD CONSTRAINT "CareerTrackEnrollment_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerTrackEnrollment" ADD CONSTRAINT "CareerTrackEnrollment_careerTrackId_fkey" FOREIGN KEY ("careerTrackId") REFERENCES "CareerTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_careerTrackId_fkey" FOREIGN KEY ("careerTrackId") REFERENCES "CareerTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttemptV2" ADD CONSTRAINT "AssessmentAttemptV2_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorSession" ADD CONSTRAINT "TutorSession_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

