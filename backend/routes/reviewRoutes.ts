import express, { RequestHandler } from 'express';
import {
    createComment,
    deleteComment,
    getComments,
    getReviewSummary,
    updateComment,
    upsertRating,
} from '../controllers/reviewController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireTrustedOrigin } from '../middleware/originProtectionMiddleware.js';
import { createRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

const reviewWriteLimiter = createRateLimit({
    windowMs: 60 * 1000,
    maxRequests: 20,
    keyPrefix: 'reviews-write',
});

const commentWriteLimiter = createRateLimit({
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyPrefix: 'comments-write',
});

// Public read endpoints
router.get('/:mediaType/:tmdbId/summary', getReviewSummary as RequestHandler);
router.get('/:mediaType/:tmdbId/comments', getComments as RequestHandler);

// Authenticated + protected write endpoints
router.put(
    '/:mediaType/:tmdbId/rating',
    requireAuth as RequestHandler,
    requireTrustedOrigin as RequestHandler,
    reviewWriteLimiter as RequestHandler,
    upsertRating as RequestHandler
);

router.post(
    '/:mediaType/:tmdbId/comments',
    requireAuth as RequestHandler,
    requireTrustedOrigin as RequestHandler,
    commentWriteLimiter as RequestHandler,
    createComment as RequestHandler
);

router.patch(
    '/comments/:commentId',
    requireAuth as RequestHandler,
    requireTrustedOrigin as RequestHandler,
    commentWriteLimiter as RequestHandler,
    updateComment as RequestHandler
);

router.delete(
    '/comments/:commentId',
    requireAuth as RequestHandler,
    requireTrustedOrigin as RequestHandler,
    commentWriteLimiter as RequestHandler,
    deleteComment as RequestHandler
);

export default router;
