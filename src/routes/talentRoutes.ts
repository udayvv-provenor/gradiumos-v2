/**
 * Talent (learner-facing) routes — all require role=LEARNER.
 * Mounted at /api/talent in app.ts.
 */
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import * as overview from '../controllers/talent/overviewController.js';
import * as aug from '../controllers/talent/augmentationController.js';
import * as tutor from '../controllers/talent/tutorController.js';
import * as assess from '../controllers/talent/assessmentController.js';
import * as portfolio from '../controllers/talent/portfolioController.js';
import * as signal from '../controllers/talent/signalController.js';
import * as resume from '../controllers/talent/resumeController.js';
import * as opp from '../controllers/talent/opportunityController.js';

import {
  CareerTrackIdRequired,
  AssignmentIdParam,
  SessionIdParam,
  AssessmentIdParam,
  ResumeIdParam,
  RoleIdParam,
  InstitutionAndCareerQuery,
} from '../schemas/talent/common.js';
import { PathwayStatusQuery, StepCompleteParams } from '../schemas/talent/pathway.js';
import { StartSessionBody, SessionTurnBody } from '../schemas/talent/tutor.js';
import { AssessmentListQuery, AttemptSubmitBody } from '../schemas/talent/assessment.js';
import { GenerateResumeBody, ResumesListQuery } from '../schemas/talent/resume.js';
import { GenerateSignalBody } from '../schemas/talent/signal.js';
import { OpportunityQuery } from '../schemas/talent/opportunity.js';

const router = Router();
router.use(requireRole('LEARNER'));

// Overview
router.get('/me/tracks', asyncHandler(overview.getTracks));
router.get('/me/overview', validate(CareerTrackIdRequired, 'query'), asyncHandler(overview.getOverview));
router.get('/me/competency-profile', asyncHandler(overview.getCompetencyProfile));
router.get('/me/dcrb', validate(CareerTrackIdRequired, 'query'), asyncHandler(overview.getDcrb));

// Augmentation — gap intel, curriculum map, pathways
router.get('/me/gap-intel', validate(CareerTrackIdRequired, 'query'), asyncHandler(aug.getGapIntel));
router.get('/me/curriculum-map', validate(InstitutionAndCareerQuery, 'query'), asyncHandler(aug.getCurriculumMap));
router.get('/me/pathways', validate(PathwayStatusQuery, 'query'), asyncHandler(aug.listPathways));
router.get('/me/pathways/:assignmentId', validate(AssignmentIdParam, 'params'), asyncHandler(aug.getPathway));
router.post('/me/pathways/:assignmentId/steps/:stepIdx/complete', validate(StepCompleteParams, 'params'), asyncHandler(aug.completeStep));

// Tutor
router.post('/me/tutor/sessions', validate(StartSessionBody, 'body'), asyncHandler(tutor.startSession));
router.get('/me/tutor/sessions/:id', validate(SessionIdParam, 'params'), asyncHandler(tutor.getSession));
router.post('/me/tutor/sessions/:id/turn', validate(SessionIdParam, 'params'), validate(SessionTurnBody, 'body'), asyncHandler(tutor.addTurn));
router.post('/me/tutor/sessions/:id/end', validate(SessionIdParam, 'params'), asyncHandler(tutor.endSession));

// Assessments
router.get('/me/assessments', validate(AssessmentListQuery, 'query'), asyncHandler(assess.listAssessments));
router.get('/me/assessments/:id', validate(AssessmentIdParam, 'params'), asyncHandler(assess.getAssessment));
router.post('/me/assessments/:id/attempts', validate(AssessmentIdParam, 'params'), validate(AttemptSubmitBody, 'body'), asyncHandler(assess.submitAttempt));
router.get('/me/attempts', asyncHandler(assess.listAttempts));

// Portfolio
router.get('/me/portfolio', asyncHandler(portfolio.getPortfolio));
router.get('/me/portfolio/employer-view', asyncHandler(portfolio.getEmployerView));

// Signal
router.get('/me/signal', validate(CareerTrackIdRequired, 'query'), asyncHandler(signal.getSignal));
router.post('/me/signal/generate', validate(GenerateSignalBody, 'body'), asyncHandler(signal.generateSignal));

// Resumes
router.get('/me/resumes', validate(ResumesListQuery, 'query'), asyncHandler(resume.listResumes));
router.post('/me/resumes', validate(GenerateResumeBody, 'body'), asyncHandler(resume.generateResume));
router.get('/me/resumes/:id', validate(ResumeIdParam, 'params'), asyncHandler(resume.getResume));
router.get('/me/resumes/:id/html', validate(ResumeIdParam, 'params'), asyncHandler(resume.getResumeHtml));

// Opportunities
router.get('/me/opportunities', validate(OpportunityQuery, 'query'), asyncHandler(opp.listOpportunities));
router.get('/me/opportunities/:roleId', validate(RoleIdParam, 'params'), asyncHandler(opp.getOpportunity));
router.post('/me/opportunities/:roleId/apply', validate(RoleIdParam, 'params'), asyncHandler(opp.applyRole));

export default router;
