/**
 * stressFill — DB injector that simulates "GradiumOS platform after 6 months
 * of real use" without using Groq or Serper APIs. Writes realistic data
 * directly into the tables AI/upload flows would write to:
 *
 *   - Learner.resumeProfile (Json)             ← simulated parseResume output
 *   - Curriculum.subjects + clusterCoverage    ← simulated mapCurriculum
 *   - EmployerRole.clusterTargets + jdExtraction ← simulated extractJD
 *   - CompetencyScore rows                     ← simulated assessment grades
 *   - TutorSession.transcript                  ← simulated lesson cards
 *   - PipelineCandidate                        ← simulated applications
 *
 * Then EVERY downstream feature (3-way map, augmentation path, gap report,
 * aggregated demand, market intel cache, mastery on subtopics) computes
 * from this data. Tests architecture without any external calls.
 *
 * Run with: npm run db:stress-fill
 *
 * Tagged STRESS-FILL — grep to find / remove.
 */
import { PrismaClient, ClusterCode, Role, Archetype } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

function genInviteCode(): string {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(8);
  let s = ''; for (let i = 0; i < 8; i++) s += cs[b[i] % cs.length];
  return s;
}

/* ─── INSTITUTION DATA ─────────────────────────────────────────────── */

const INSTITUTIONS = [
  { name: 'VIT Vellore',         tier: 1, deanEmail: 'dean@vit.ac.in',     deanName: 'Dr. Anand Krishnan' },
  { name: 'SRM Chennai',         tier: 1, deanEmail: 'dean@srm.edu',       deanName: 'Dr. K. Murthy' },
  { name: 'BITS Pilani',         tier: 1, deanEmail: 'dean@bits.ac.in',    deanName: 'Dr. R. Sharma' },
  { name: 'Anna University',     tier: 2, deanEmail: 'dean@annauniv.edu',  deanName: 'Dr. M. Iyer' },
];

/* ─── EMPLOYER DATA ────────────────────────────────────────────────── */

const EMPLOYERS = [
  { name: 'Razorpay',    archetype: 'Product' as Archetype, taEmail: 'ta@razorpay.com',    taName: 'Sarita Rajan' },
  { name: 'Freshworks',  archetype: 'Product' as Archetype, taEmail: 'ta@freshworks.com',  taName: 'Vikram Patel' },
  { name: 'Swiggy',      archetype: 'Product' as Archetype, taEmail: 'ta@swiggy.com',      taName: 'Priya Iyer' },
  { name: 'TCS Digital', archetype: 'Service' as Archetype, taEmail: 'ta@tcs.com',         taName: 'Rakesh Kumar' },
  { name: 'Cognizant',   archetype: 'MassRecruiter' as Archetype, taEmail: 'ta@cognizant.com', taName: 'Anjali Menon' },
];

/* ─── EMPLOYER ROLES ────────────────────────────────────────────────
 * Realistic spread: Product unicorns ask high C1+C3+C4, Service shops ask
 * balanced C3+C5+C7, MassRecruiter asks moderate-everything. */

const ROLES_BY_EMPLOYER: Record<string, Array<{
  title: string; track: string; seats: number; seniority: 'Junior'|'Mid'|'Senior';
  clusterTargets: Record<ClusterCode, number>;
  reqs: string[];
}>> = {
  'Razorpay': [
    { title: 'Senior Backend Engineer - Payments', track: 'SWE', seats: 3, seniority: 'Senior',
      clusterTargets: { C1:78, C2:75, C3:85, C4:82, C5:65, C6:75, C7:75, C8:60 },
      reqs: ['6+ years backend production', 'TypeScript or Go on AWS', 'Payments domain depth', 'System design at scale'] },
    { title: 'ML Engineer - Risk Models', track: 'MLAI', seats: 2, seniority: 'Mid',
      clusterTargets: { C1:78, C2:80, C3:70, C4:65, C5:55, C6:85, C7:65, C8:70 },
      reqs: ['3-5 years ML production', 'Python + PyTorch/TensorFlow', 'Tabular features + risk scoring', 'A/B testing experience'] },
  ],
  'Freshworks': [
    { title: 'Senior Backend Engineer - Platform', track: 'SWE', seats: 4, seniority: 'Senior',
      clusterTargets: { C1:75, C2:72, C3:80, C4:80, C5:60, C6:60, C7:70, C8:55 },
      reqs: ['5+ years backend', 'Distributed systems', 'CI/CD ownership', 'On-call comfort'] },
    { title: 'Product Designer', track: 'DESIGN', seats: 2, seniority: 'Mid',
      clusterTargets: { C1:35, C2:55, C3:50, C4:75, C5:80, C6:70, C7:65, C8:60 },
      reqs: ['3+ years SaaS UX', 'Figma + design systems', 'User research', 'Cross-functional collaboration'] },
  ],
  'Swiggy': [
    { title: 'Backend Engineer - Logistics', track: 'SWE', seats: 5, seniority: 'Mid',
      clusterTargets: { C1:72, C2:75, C3:78, C4:70, C5:55, C6:65, C7:65, C8:60 },
      reqs: ['3+ years', 'Distributed systems for logistics', 'Latency-sensitive design', 'Java or Go'] },
    { title: 'Data Scientist - Demand Forecasting', track: 'DATA', seats: 2, seniority: 'Mid',
      clusterTargets: { C1:70, C2:80, C3:65, C4:65, C5:60, C6:78, C7:60, C8:65 },
      reqs: ['3+ years DS', 'Time-series forecasting', 'SQL + Python', 'Production model deployment'] },
  ],
  'TCS Digital': [
    { title: 'Software Engineer - Java Backend', track: 'SWE', seats: 80, seniority: 'Junior',
      clusterTargets: { C1:60, C2:55, C3:60, C4:45, C5:50, C6:40, C7:50, C8:50 },
      reqs: ['0-2 years', 'Java + Spring', 'Client-facing project work', 'Strong communication'] },
    { title: 'Senior Consultant - Cloud', track: 'OPS', seats: 25, seniority: 'Senior',
      clusterTargets: { C1:55, C2:55, C3:65, C4:60, C5:75, C6:70, C7:70, C8:55 },
      reqs: ['6+ years client delivery', 'AWS or Azure cert', 'Stakeholder management', 'Pre-sales support'] },
  ],
  'Cognizant': [
    { title: 'Genc Software Engineer', track: 'SWE', seats: 250, seniority: 'Junior',
      clusterTargets: { C1:55, C2:50, C3:55, C4:40, C5:55, C6:35, C7:45, C8:55 },
      reqs: ['Fresh grad', 'CS fundamentals', 'Java or Python', 'Trainability'] },
  ],
};

/* ─── CURRICULUM SHAPES ────────────────────────────────────────────── */

const CURRICULA: Record<string, { subjects: Array<{ name: string; clusters: string[]; coverage: number; rationale: string }>; clusterCoverage: Record<string, number>; summary: string }> = {
  'VIT Vellore': {
    clusterCoverage: { C1: 85, C2: 75, C3: 70, C4: 60, C5: 45, C6: 55, C7: 50, C8: 55 },
    subjects: [
      { name: 'Programming Fundamentals + Discrete Math (Year 1)',  clusters: ['C1','C2'],     coverage: 80, rationale: 'Strong CS foundation in year 1' },
      { name: 'DSA + Algorithms (Year 2)',                          clusters: ['C1','C2'],     coverage: 90, rationale: 'Core DSA dedicated semester' },
      { name: 'OS + Networks + DBMS (Year 2)',                      clusters: ['C1','C4'],     coverage: 75, rationale: 'Systems block in year 2' },
      { name: 'Software Engineering + Web Tech (Year 3)',           clusters: ['C3','C4'],     coverage: 65, rationale: 'SE practice + web project' },
      { name: 'Mini-Project + Capstone (Year 3-4)',                 clusters: ['C3','C5','C7'], coverage: 70, rationale: 'Real project ownership' },
      { name: 'Technical Writing + Soft Skills (Year 3)',           clusters: ['C5'],          coverage: 65, rationale: 'Dedicated writing course' },
      { name: 'ML + Distributed Systems + Cloud (Year 4)',          clusters: ['C4','C6','C8'], coverage: 60, rationale: 'Year 4 specialisation electives' },
      { name: 'Internship (8 weeks)',                               clusters: ['C3','C5','C7'], coverage: 55, rationale: 'Industry exposure' },
    ],
    summary: 'Strong on C1+C2 (algorithms emphasis), moderate on C3+C4 (production engineering). Notable gaps on C5 (communication) and C7 (ownership) — typical for tier-1 Indian engineering. Recommend a stakeholder-comms elective + earlier capstone autonomy.',
  },
  'SRM Chennai': {
    clusterCoverage: { C1: 78, C2: 65, C3: 60, C4: 50, C5: 40, C6: 50, C7: 45, C8: 50 },
    subjects: [
      { name: 'Programming + Discrete Math (Year 1)',          clusters: ['C1','C2'],     coverage: 75, rationale: 'Standard year 1' },
      { name: 'Data Structures + Algorithms (Year 2)',         clusters: ['C1','C2'],     coverage: 80, rationale: 'Core CS' },
      { name: 'OOP + DBMS + OS (Year 2)',                      clusters: ['C1','C3'],     coverage: 65, rationale: 'Foundations' },
      { name: 'Software Engineering (Year 3)',                 clusters: ['C3'],          coverage: 55, rationale: 'SDLC overview only' },
      { name: 'Major Project (Year 4)',                        clusters: ['C3','C5','C7'], coverage: 60, rationale: '2-semester capstone' },
      { name: 'Cloud Computing + ML (Year 4)',                 clusters: ['C4','C6'],     coverage: 50, rationale: 'Intro-level only' },
    ],
    summary: 'Decent C1+C2 base but weak C3 and C5 — the SE course is conceptual not applied; communication training is minimal. Major project is the only real C7 surface.',
  },
  'BITS Pilani': {
    clusterCoverage: { C1: 90, C2: 85, C3: 78, C4: 75, C5: 60, C6: 70, C7: 65, C8: 70 },
    subjects: [
      { name: 'Algorithms + Theory (Year 1-2)',                clusters: ['C1','C2'],     coverage: 95, rationale: 'BITS algorithms reputation' },
      { name: 'Systems block (OS + Networks + Compilers)',     clusters: ['C1','C4'],     coverage: 85, rationale: 'Strong systems sequence' },
      { name: 'Software Engineering Practice',                 clusters: ['C3'],          coverage: 75, rationale: 'Hands-on SE' },
      { name: 'PS-1 + PS-2 internships (Year 3-4)',            clusters: ['C3','C5','C7'], coverage: 80, rationale: '8-month industry track' },
      { name: 'ML + Distributed Systems',                       clusters: ['C4','C6','C8'], coverage: 75, rationale: 'Strong electives' },
      { name: 'Communication + Liberal Arts',                   clusters: ['C5'],          coverage: 65, rationale: 'BITS liberal-arts mix' },
    ],
    summary: 'Top-tier C1+C2 (algorithms) and C4 (systems). Strong C3+C7 due to PS-1/PS-2 industry program. C5 still moderate — could be sharper.',
  },
  'Anna University': {
    clusterCoverage: { C1: 70, C2: 60, C3: 55, C4: 45, C5: 40, C6: 45, C7: 40, C8: 45 },
    subjects: [
      { name: 'Programming + Math (Year 1)',                   clusters: ['C1','C2'],     coverage: 70, rationale: 'Standard syllabus' },
      { name: 'DSA + DBMS + OS (Year 2)',                      clusters: ['C1','C3'],     coverage: 60, rationale: 'Foundations' },
      { name: 'Software Engineering (Year 3)',                 clusters: ['C3'],          coverage: 50, rationale: 'Theory-heavy' },
      { name: 'Project Work (Year 4)',                         clusters: ['C3','C7'],     coverage: 45, rationale: 'Limited scope' },
    ],
    summary: 'Standard tier-2 syllabus with good fundamentals but minimal practical engineering exposure. Significant gaps on C5/C7 — recommend industry partnership + project autonomy upgrades.',
  },
};

/* ─── LEARNER PROFILES ─────────────────────────────────────────────── */

const LEARNERS = [
  { name: 'Rahul Iyer',     email: 'rahul@vit.ac.in',     institution: 'VIT Vellore',
    yearsExp: 2, archetype: 'Product',
    scores: { C1: 78, C2: 70, C3: 75, C4: 60, C5: 65, C6: 50, C7: 55, C8: 80 },
    confidence: { C1: 0.85, C2: 0.80, C3: 0.75, C4: 0.65, C5: 0.70, C6: 0.50, C7: 0.55, C8: 0.85 },
    skills: ['Python', 'TypeScript', 'Go', 'AWS', 'Docker', 'PostgreSQL', 'Redis', 'Git'],
    summary: '2-year Razorpay intern, payments domain, picked up Go in 2 weeks. Strong execution + agility.',
    highlights: ['Built payments reconciliation in TS/Python on AWS, 50k+ tx/day', 'Reduced deploy time 14m→4m', 'Picked up Go in 2 weeks', 'ICPC Asia regionals 38th'] },
  { name: 'Aditi Sharma',   email: 'aditi@srm.edu',       institution: 'SRM Chennai',
    yearsExp: 1, archetype: 'Product',
    scores: { C1: 65, C2: 55, C3: 50, C4: 35, C5: 45, C6: 70, C7: 40, C8: 55 },
    confidence: { C1: 0.70, C2: 0.60, C3: 0.45, C4: 0.30, C5: 0.40, C6: 0.75, C7: 0.35, C8: 0.55 },
    skills: ['Python', 'NumPy', 'PyTorch', 'Pandas', 'Jupyter', 'SQL'],
    summary: '1-year ML research intern, deep on PyTorch + NLP, light on production engineering.',
    highlights: ['Published a workshop paper at NeurIPS 2025', 'Built BERT fine-tuning pipeline', 'Kaggle competition top-15%', 'Mentored 2 juniors in research lab'] },
  { name: 'Karthik Menon',  email: 'karthik@bits.ac.in',  institution: 'BITS Pilani',
    yearsExp: 2, archetype: 'Product',
    scores: { C1: 88, C2: 82, C3: 70, C4: 78, C5: 55, C6: 60, C7: 70, C8: 75 },
    confidence: { C1: 0.90, C2: 0.85, C3: 0.70, C4: 0.80, C5: 0.55, C6: 0.55, C7: 0.70, C8: 0.75 },
    skills: ['C++', 'Python', 'Go', 'Kubernetes', 'gRPC', 'Postgres', 'Linux'],
    summary: 'Senior at BITS, PS-2 at a fintech, system design contest finalist.',
    highlights: ['ICPC Asia regionalist (top-30)', 'PS-2 at Razorpay backend team', 'Open source: 3 PRs into popular Go HTTP library', 'Designed sharded ledger for college fintech project'] },
  { name: 'Sneha Reddy',    email: 'sneha@annauniv.edu',  institution: 'Anna University',
    yearsExp: 0, archetype: 'Unknown',
    scores: { C1: 55, C2: 45, C3: 30, C4: 25, C5: 50, C6: 30, C7: 30, C8: 45 },
    confidence: { C1: 0.55, C2: 0.45, C3: 0.25, C4: 0.20, C5: 0.45, C6: 0.25, C7: 0.25, C8: 0.40 },
    skills: ['Python', 'C', 'SQL'],
    summary: 'Final-year student, no industry experience. Coursework-only signal.',
    highlights: ['College final-year project on inventory management', 'Active in coding club', 'Completed online ML cert'] },
];

/* ─── TUTOR SESSIONS (synthetic transcripts) ──────────────────────── */

const TUTOR_TRANSCRIPTS: Record<string, Array<{ role: 'user' | 'tutor'; content: string; ts?: string }>> = {
  'C5.TECH-WRITING': [
    { role: 'tutor', content: 'Welcome — let\'s sharpen your technical writing. Tell me about a recent doc / PR description you wrote that you wish was clearer.' },
    { role: 'user',  content: 'I wrote a PR description for a refactor and reviewers said it was hard to find what actually changed.' },
    { role: 'tutor', content: 'Classic problem. The fix is BLUF — Bottom Line Up Front. Sentence one states what you changed. Try this: rewrite your description starting with "Renamed X to Y because Z."' },
    { role: 'user',  content: 'OK so: "Renamed UserController.deleteSession to deleteAllSessions because logout was killing only one session at a time."' },
    { role: 'tutor', content: 'Strong. Reviewer can decide in 5 seconds whether to approve. What goes next is evidence: what was the bug, what test confirms the fix, what risk if any.' },
  ],
  'C1.BIG-O': [
    { role: 'tutor', content: 'Big-O isn\'t about exact runtime — it\'s about how runtime grows with input size. Let me start: what\'s the Big-O of finding an element in a sorted array?' },
    { role: 'user',  content: 'O(log n) using binary search.' },
    { role: 'tutor', content: 'Right. Now — what if the array is unsorted but you only need to find ANY element matching a condition?' },
    { role: 'user',  content: 'O(n) — linear scan.' },
    { role: 'tutor', content: 'Good. So sorting cost matters: pre-sorting is O(n log n), then each query is O(log n). Worth it if you\'ll query many times.' },
  ],
};

/* ─── EXEC ─────────────────────────────────────────────────────────── */

async function main() {
  console.log('STRESS-FILL — simulating "platform after 6 months of use"');
  console.log();

  const passwordHash = await bcrypt.hash('TestPass123!', 12);

  // 1. Pull canonical career tracks (already seeded by db:seed)
  const careerTracks = await prisma.careerTrack.findMany({});
  const trackByCode = new Map(careerTracks.map((t) => [t.code, t]));

  // 2. Pull weights/thresholds for IndexVersion
  const defaultWeights: Record<ClusterCode, number> = { C1:0.18, C2:0.16, C3:0.15, C4:0.16, C5:0.10, C6:0.10, C7:0.10, C8:0.05 };
  const defaultTargets: Record<ClusterCode, number> = { C1:70, C2:70, C3:65, C4:60, C5:55, C6:60, C7:60, C8:55 };

  // 3. Institutions + DEAN users + curriculum
  const institutionByName = new Map<string, { id: string; trackId: string; cohortId: string }>();
  for (const inst of INSTITUTIONS) {
    let i = await prisma.institution.findFirst({ where: { name: inst.name } });
    if (!i) {
      i = await prisma.institution.create({
        data: {
          name: inst.name,
          type: 'University',
          planValidUntil: new Date(Date.UTC(2027, 5, 30)),
          planFeatures: ['Overview', 'Curriculum Mapping', 'Augmentation', 'Roster', 'Signal'],
          inviteCode: genInviteCode(),
        },
      });
    }

    await prisma.user.upsert({
      where: { email: inst.deanEmail },
      update: {},
      create: { email: inst.deanEmail, passwordHash, name: inst.deanName, role: Role.DEAN, institutionId: i.id },
    });

    const idxVer = await prisma.indexVersion.upsert({
      where: { institutionId_versionTag: { institutionId: i.id, versionTag: 'v1.2' } },
      update: {},
      create: { institutionId: i.id, versionTag: 'v1.2', effectiveFrom: new Date(Date.UTC(2025, 6, 1)), locked: true, weights: defaultWeights, thresholds: defaultTargets },
    });

    // Create one Track bound to SWE per institution
    const sweCt = trackByCode.get('SWE')!;
    const t = await prisma.track.upsert({
      where: { institutionId_name: { institutionId: i.id, name: 'B.Tech CSE' } },
      update: {},
      create: { institutionId: i.id, name: 'B.Tech CSE', archetype: 'Product', careerTrackId: sweCt.id },
    });
    const cohort = await prisma.cohort.upsert({
      where: { institutionId_name: { institutionId: i.id, name: 'Batch of 2026' } },
      update: {},
      create: { institutionId: i.id, trackId: t.id, indexVersionId: idxVer.id, name: 'Batch of 2026', startYear: 2022 },
    });
    institutionByName.set(inst.name, { id: i.id, trackId: t.id, cohortId: cohort.id });

    // Curriculum (with realistic clusterCoverage from CURRICULA above)
    const cur = CURRICULA[inst.name];
    if (cur) {
      // Find existing curriculum for this institution+track or create
      const existing = await prisma.curriculum.findFirst({ where: { institutionId: i.id, careerTrackId: sweCt.id } });
      if (!existing) {
        await prisma.curriculum.create({
          data: {
            institutionId:   i.id,
            careerTrackId:   sweCt.id,
            rawText:         `STRESS-FILL synthetic curriculum for ${inst.name}. Year 1-4 standard B.Tech CSE.`,
            clusterCoverage: cur.clusterCoverage,
            subjects:        cur.subjects,
            source:          'paste',
            uploadedById:    (await prisma.user.findFirst({ where: { email: inst.deanEmail } }))!.id,
          },
        });
      }
    }
    console.log(`  inst: ${inst.name} (invite ${i.inviteCode})`);
  }

  // 4. Employers + TA users + roles
  const employerByName = new Map<string, { id: string }>();
  for (const emp of EMPLOYERS) {
    const e = await prisma.employer.upsert({
      where: { name: emp.name },
      update: {},
      create: { name: emp.name, archetype: emp.archetype, plan: 'growth' },
    });
    employerByName.set(emp.name, { id: e.id });
    await prisma.user.upsert({
      where: { email: emp.taEmail },
      update: {},
      create: { email: emp.taEmail, passwordHash, name: emp.taName, role: Role.TA_LEAD, employerId: e.id },
    });

    // Roles — simulate JD upload + AI extraction
    const roles = ROLES_BY_EMPLOYER[emp.name] ?? [];
    for (const r of roles) {
      const ct = trackByCode.get(r.track);
      if (!ct) continue;
      const existing = await prisma.employerRole.findFirst({ where: { employerId: e.id, title: r.title } });
      if (existing) continue;
      await prisma.employerRole.create({
        data: {
          employerId:     e.id,
          careerTrackId:  ct.id,
          title:          r.title,
          seatsPlanned:   r.seats,
          status:         'active',
          clusterWeights: defaultWeights,
          clusterTargets: r.clusterTargets,
          jdText:         `STRESS-FILL synthetic JD for ${r.title} at ${emp.name}. ${r.reqs.join(' ')}.`,
          jdSource:       'paste',
          jdUploadedAt:   new Date(),
          jdExtractedAt:  new Date(),
          jdExtraction:   {
            extractedTitle:        r.title,
            archetype:             emp.archetype,
            seniority:             r.seniority,
            extractedRequirements: r.reqs,
            domain:                r.track === 'FINTECH' || r.title.toLowerCase().includes('payment') ? 'Payments / FinTech' : null,
          },
        },
      });
    }
    console.log(`  emp: ${emp.name} (${roles.length} roles)`);
  }

  // 5. Learners + resume profiles + scores + tutor sessions
  for (const l of LEARNERS) {
    const inst = institutionByName.get(l.institution);
    if (!inst) continue;

    const learner = await prisma.learner.upsert({
      where: { email: l.email },
      update: {},
      create: {
        institutionId: inst.id,
        trackId:       inst.trackId,
        cohortId:      inst.cohortId,
        name:          l.name,
        email:         l.email,
        uploadedResumeText: `STRESS-FILL synthetic resume for ${l.name}. ${l.summary}. Skills: ${l.skills.join(', ')}.`,
        uploadedResumeAt: new Date(),
        resumeProfile: {
          candidateName:      l.name,
          yearsExp:           l.yearsExp,
          archetype:          l.archetype,
          clusterScores:      l.scores,
          clusterConfidence:  l.confidence,
          declaredSkills:     l.skills,
          experienceSummary:  l.summary,
          evidenceHighlights: l.highlights,
        },
      },
    });

    await prisma.user.upsert({
      where: { email: l.email },
      update: {},
      create: { email: l.email, passwordHash, name: l.name, role: Role.LEARNER, institutionId: inst.id, learnerId: learner.id },
    });

    // CompetencyScore rows — simulate scores accrued from N assessments per cluster
    for (const [code, score] of Object.entries(l.scores)) {
      const conf = l.confidence[code as ClusterCode] ?? 0.5;
      await prisma.competencyScore.upsert({
        where: { learnerId_clusterCode: { learnerId: learner.id, clusterCode: code as ClusterCode } },
        update: {
          scoreWeighted: score,
          confidence:    conf,
          freshness:     0.85,
          attemptsCount: 4 + Math.floor(Math.random() * 6),
          lastAttemptAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
        },
        create: {
          learnerId:     learner.id,
          clusterCode:   code as ClusterCode,
          scoreWeighted: score,
          confidence:    conf,
          freshness:     0.85,
          attemptsCount: 4 + Math.floor(Math.random() * 6),
          lastAttemptAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
        },
      });
    }

    // CareerTrackEnrollment
    const sweCt = trackByCode.get('SWE')!;
    await prisma.careerTrackEnrollment.upsert({
      where: { learnerId_careerTrackId: { learnerId: learner.id, careerTrackId: sweCt.id } },
      update: {},
      create: { learnerId: learner.id, careerTrackId: sweCt.id, isPrimary: true },
    });

    // Tutor sessions for the strongest learner only
    if (l.name === 'Rahul Iyer') {
      for (const [subtopicCode, transcript] of Object.entries(TUTOR_TRANSCRIPTS)) {
        const cluster = subtopicCode.split('.')[0] as ClusterCode;
        await prisma.tutorSession.create({
          data: {
            learnerId:    learner.id,
            clusterCode:  cluster,
            subtopicCode,
            transcript:   transcript.map((t) => ({ ...t, ts: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString() })),
            rubric:       { turns: transcript.length, status: 'completed' },
            endedAt:      new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
          },
        });
      }
    }

    console.log(`  learner: ${l.name} @ ${l.institution}`);
  }

  // 6. Pipeline candidates — top learners apply to top roles
  const rahul = await prisma.learner.findUnique({ where: { email: 'rahul@vit.ac.in' } });
  const karthik = await prisma.learner.findUnique({ where: { email: 'karthik@bits.ac.in' } });
  const razorRoles = await prisma.employerRole.findMany({ where: { employer: { name: 'Razorpay' } } });
  const fwRoles = await prisma.employerRole.findMany({ where: { employer: { name: 'Freshworks' } } });
  if (rahul && razorRoles[0]) {
    await prisma.pipelineCandidate.upsert({
      where: { roleId_learnerId: { roleId: razorRoles[0].id, learnerId: rahul.id } } as any,
      update: {},
      create: {
        employerId:   razorRoles[0].employerId,
        roleId:       razorRoles[0].id,
        learnerId:    rahul.id,
        stage:        'assessed',
        signalMatch:  0.78,
      },
    }).catch(() => null);
  }
  if (karthik && razorRoles[0]) {
    await prisma.pipelineCandidate.upsert({
      where: { roleId_learnerId: { roleId: razorRoles[0].id, learnerId: karthik.id } } as any,
      update: {},
      create: {
        employerId:   razorRoles[0].employerId,
        roleId:       razorRoles[0].id,
        learnerId:    karthik.id,
        stage:        'assessed',
        signalMatch:  0.85,
      },
    }).catch(() => null);
  }
  if (karthik && fwRoles[0]) {
    await prisma.pipelineCandidate.upsert({
      where: { roleId_learnerId: { roleId: fwRoles[0].id, learnerId: karthik.id } } as any,
      update: {},
      create: {
        employerId:   fwRoles[0].employerId,
        roleId:       fwRoles[0].id,
        learnerId:    karthik.id,
        stage:        'invited',
        signalMatch:  0.81,
      },
    }).catch(() => null);
  }

  console.log();
  console.log('Final counts:');
  console.log(JSON.stringify({
    institutions:       await prisma.institution.count(),
    employers:          await prisma.employer.count(),
    users:              await prisma.user.count(),
    learners:           await prisma.learner.count(),
    employerRoles:      await prisma.employerRole.count(),
    curricula:          await prisma.curriculum.count(),
    competencyScores:   await prisma.competencyScore.count(),
    tutorSessions:      await prisma.tutorSession.count(),
    pipelineCandidates: await prisma.pipelineCandidate.count(),
  }, null, 2));
  console.log();
  console.log('Login (all password TestPass123!):');
  console.log('  DEAN:    dean@vit.ac.in / dean@srm.edu / dean@bits.ac.in / dean@annauniv.edu');
  console.log('  TA_LEAD: ta@razorpay.com / ta@freshworks.com / ta@swiggy.com / ta@tcs.com / ta@cognizant.com');
  console.log('  LEARNER: rahul@vit.ac.in / aditi@srm.edu / karthik@bits.ac.in / sneha@annauniv.edu');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
