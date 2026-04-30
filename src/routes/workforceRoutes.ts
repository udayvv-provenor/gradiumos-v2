/**
 * Workforce (employer-facing) routes — all require role=TA_LEAD.
 * Mounted at /api/workforce in app.ts.
 */
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import * as insight from '../controllers/workforce/insightController.js';
import * as role from '../controllers/workforce/roleController.js';
import * as pipeline from '../controllers/workforce/pipelineController.js';
import * as discovery from '../controllers/workforce/discoveryController.js';
import * as analytics from '../controllers/workforce/analyticsController.js';
import * as demand from '../controllers/workforce/demandController.js';
import * as peer from '../controllers/workforce/peerIntelController.js';
import * as verify from '../controllers/workforce/verifyController.js';
import * as matrix from '../controllers/workforce/opportunityMatrixController.js';

import { RoleCreateBody, RoleUpdateBody, RoleIdParam } from '../schemas/workforce/roles.js';
import { PipelineInviteBody, PipelineDecisionBody, PipelineIdParam, ShortlistBody } from '../schemas/workforce/pipeline.js';
import { DiscoveryQuery } from '../schemas/workforce/discovery.js';
import { DemandSubmitBody } from '../schemas/workforce/demand.js';
import { VerifyBody } from '../schemas/workforce/verify.js';
import {
  InstitutionsInsightQuery,
  CohortsInsightQuery,
  CohortLearnersQuery,
  CohortIdParam,
  PeerIntelQuery,
} from '../schemas/workforce/insight.js';

const router = Router();
router.use(requireRole('TA_LEAD'));

// Overview insight — career tracks → institutions → cohorts → learners
router.get('/overview/insight/career-tracks', asyncHandler(insight.careerTracks));
router.get(
  '/overview/insight/institutions',
  validate(InstitutionsInsightQuery, 'query'),
  asyncHandler(insight.institutions),
);
router.get(
  '/overview/insight/cohorts',
  validate(CohortsInsightQuery, 'query'),
  asyncHandler(insight.cohorts),
);
router.get(
  '/overview/insight/cohorts/:cohortId/learners',
  validate(CohortIdParam, 'params'),
  validate(CohortLearnersQuery, 'query'),
  asyncHandler(insight.cohortLearners),
);

// Career tracks lookup + peer intel
router.get('/career-tracks', asyncHandler(role.listCareerTracks));
router.get('/peer-intel', validate(PeerIntelQuery, 'query'), asyncHandler(peer.peerIntel));

// Roles CRUD
router.get('/roles', asyncHandler(role.listRoles));
router.post('/roles', validate(RoleCreateBody, 'body'), asyncHandler(role.createRole));
router.patch(
  '/roles/:id',
  validate(RoleIdParam, 'params'),
  validate(RoleUpdateBody, 'body'),
  asyncHandler(role.updateRole),
);

// Discovery (ranked learners for a role)
router.get('/discovery', validate(DiscoveryQuery, 'query'), asyncHandler(discovery.discovery));

// Shortlists
router.post('/shortlists', validate(ShortlistBody, 'body'), asyncHandler(pipeline.upsertShortlist));

// Pipeline
router.get('/pipeline', asyncHandler(pipeline.list));
router.get('/pipeline/timeseries', asyncHandler(pipeline.timeseries));
router.post('/pipeline', validate(PipelineInviteBody, 'body'), asyncHandler(pipeline.invite));
router.post(
  '/pipeline/:id/decision',
  validate(PipelineIdParam, 'params'),
  validate(PipelineDecisionBody, 'body'),
  asyncHandler(pipeline.decision),
);

// Opportunity Matrix (institution × role partnership view)
router.get('/opportunity-matrix', asyncHandler(matrix.getMatrix));

// Analytics
router.get('/analytics/funnel', asyncHandler(analytics.funnel));
router.get('/analytics/velocity', asyncHandler(analytics.velocity));

// Demand intelligence
router.get('/demand', asyncHandler(demand.getDemand));
router.post('/demand', validate(DemandSubmitBody, 'body'), asyncHandler(demand.postDemand));

// Verify signal (Ed25519)
router.post('/verify', validate(VerifyBody, 'body'), asyncHandler(verify.verifySignal));

export default router;
