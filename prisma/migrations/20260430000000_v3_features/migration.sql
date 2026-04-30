-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- AlterEnum
ALTER TYPE "RoleStatus" ADD VALUE 'draft';

-- AlterTable
ALTER TABLE "AssessmentAttemptV2" ADD COLUMN     "aiAuthoredLikelihood" DOUBLE PRECISION,
ADD COLUMN     "aiFeedback" JSONB,
ADD COLUMN     "aiGradedAt" TIMESTAMP(3),
ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "proctorFlags" JSONB,
ADD COLUMN     "suspicious" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CareerTrack" ADD COLUMN     "createdBy" TEXT NOT NULL DEFAULT 'veranox-seed',
ADD COLUMN     "institutionId" TEXT,
ADD COLUMN     "seedVersion" TEXT NOT NULL DEFAULT '1.0.0',
ADD COLUMN     "tier" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "archetype" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CompetencyScore" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Employer" ADD COLUMN     "kycStatus" TEXT NOT NULL DEFAULT 'Pending',
ALTER COLUMN "archetype" DROP NOT NULL;

-- AlterTable
ALTER TABLE "EmployerRole" ADD COLUMN     "jdExtractedAt" TIMESTAMP(3),
ADD COLUMN     "jdExtraction" JSONB,
ADD COLUMN     "jdFileName" TEXT,
ADD COLUMN     "jdSource" TEXT,
ADD COLUMN     "jdText" TEXT,
ADD COLUMN     "jdUploadedAt" TIMESTAMP(3),
ADD COLUMN     "jdVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "aisheCode" TEXT,
ADD COLUMN     "inviteCode" TEXT NOT NULL,
ADD COLUMN     "kycStatus" TEXT NOT NULL DEFAULT 'Pending',
ADD COLUMN     "naacGrade" TEXT,
ADD COLUMN     "nirfRank" INTEGER,
ALTER COLUMN "type" SET DEFAULT 'higher-ed';

-- AlterTable
ALTER TABLE "Learner" ADD COLUMN     "resumeProfile" JSONB,
ADD COLUMN     "uploadedResumeAt" TIMESTAMP(3),
ADD COLUMN     "uploadedResumeText" TEXT;

-- AlterTable
ALTER TABLE "Track" ALTER COLUMN "archetype" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Curriculum" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "careerTrackId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "clusterCoverage" JSONB NOT NULL,
    "subjects" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Curriculum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicDataCache" (
    "id" TEXT NOT NULL,
    "stakeholderKind" TEXT NOT NULL,
    "stakeholderId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fromFixture" BOOLEAN NOT NULL DEFAULT false,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicDataCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkShift" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "scenarioHash" TEXT NOT NULL,
    "scenarioCompany" TEXT,
    "state" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "perArtifact" JSONB NOT NULL,
    "shiftReadout" JSONB,

    CONSTRAINT "WorkShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "scope" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deepLink" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusUpdatedBy" TEXT NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnershipRequest" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,

    CONSTRAINT "PartnershipRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsoredPathway" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "pathwayId" TEXT NOT NULL,
    "careerTrackId" TEXT NOT NULL,
    "clusterTarget" TEXT NOT NULL,
    "fundingConfirmedAt" TIMESTAMP(3) NOT NULL,
    "firstLookWindowDays" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL,

    CONSTRAINT "SponsoredPathway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringBarProfile" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "careerTrackId" TEXT NOT NULL,
    "clusterTargets" JSONB NOT NULL,
    "seniority" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "HiringBarProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDemandSignal" (
    "id" TEXT NOT NULL,
    "careerTrackId" TEXT NOT NULL,
    "city" TEXT,
    "archetype" TEXT,
    "jobPostingVolume" INTEGER NOT NULL,
    "p50ClusterTargets" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketDemandSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "DisputeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "page" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Curriculum_institutionId_careerTrackId_idx" ON "Curriculum"("institutionId", "careerTrackId");

-- CreateIndex
CREATE INDEX "PublicDataCache_stakeholderKind_stakeholderId_idx" ON "PublicDataCache"("stakeholderKind", "stakeholderId");

-- CreateIndex
CREATE INDEX "PublicDataCache_expiresAt_idx" ON "PublicDataCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicDataCache_stakeholderKind_stakeholderId_slot_contextH_key" ON "PublicDataCache"("stakeholderKind", "stakeholderId", "slot", "contextHash");

-- CreateIndex
CREATE INDEX "WorkShift_learnerId_state_idx" ON "WorkShift"("learnerId", "state");

-- CreateIndex
CREATE INDEX "WorkShift_startedAt_idx" ON "WorkShift"("startedAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_purpose_idx" ON "ConsentRecord"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_name_key" ON "FeatureFlag"("name");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Application_learnerId_idx" ON "Application"("learnerId");

-- CreateIndex
CREATE INDEX "Application_roleId_status_idx" ON "Application"("roleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_learnerId_roleId_key" ON "Application"("learnerId", "roleId");

-- CreateIndex
CREATE INDEX "PartnershipRequest_employerId_status_idx" ON "PartnershipRequest"("employerId", "status");

-- CreateIndex
CREATE INDEX "PartnershipRequest_institutionId_status_idx" ON "PartnershipRequest"("institutionId", "status");

-- CreateIndex
CREATE INDEX "SponsoredPathway_institutionId_idx" ON "SponsoredPathway"("institutionId");

-- CreateIndex
CREATE INDEX "SponsoredPathway_employerId_idx" ON "SponsoredPathway"("employerId");

-- CreateIndex
CREATE INDEX "HiringBarProfile_employerId_careerTrackId_idx" ON "HiringBarProfile"("employerId", "careerTrackId");

-- CreateIndex
CREATE INDEX "MarketDemandSignal_careerTrackId_idx" ON "MarketDemandSignal"("careerTrackId");

-- CreateIndex
CREATE INDEX "DisputeRecord_userId_status_idx" ON "DisputeRecord"("userId", "status");

-- CreateIndex
CREATE INDEX "FeedbackRecord_type_createdAt_idx" ON "FeedbackRecord"("type", "createdAt");

-- CreateIndex
CREATE INDEX "CareerTrack_institutionId_idx" ON "CareerTrack"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_inviteCode_key" ON "Institution"("inviteCode");

-- CreateIndex
CREATE INDEX "Institution_inviteCode_idx" ON "Institution"("inviteCode");

-- AddForeignKey
ALTER TABLE "Curriculum" ADD CONSTRAINT "Curriculum_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Curriculum" ADD CONSTRAINT "Curriculum_careerTrackId_fkey" FOREIGN KEY ("careerTrackId") REFERENCES "CareerTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkShift" ADD CONSTRAINT "WorkShift_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

