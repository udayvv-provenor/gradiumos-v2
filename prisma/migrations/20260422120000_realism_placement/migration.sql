-- CreateTable
CREATE TABLE "Placement" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "careerTrackId" TEXT,
    "ctcLpa" DOUBLE PRECISION NOT NULL,
    "joinDate" TIMESTAMP(3) NOT NULL,
    "graduationYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Placement_learnerId_idx" ON "Placement"("learnerId");
CREATE INDEX "Placement_employerId_idx" ON "Placement"("employerId");
CREATE INDEX "Placement_careerTrackId_idx" ON "Placement"("careerTrackId");
CREATE INDEX "Placement_joinDate_idx" ON "Placement"("joinDate");

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_careerTrackId_fkey" FOREIGN KEY ("careerTrackId") REFERENCES "CareerTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
