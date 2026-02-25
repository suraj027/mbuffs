import express, { RequestHandler } from 'express';
import {
    getRecommendations,
    getCategoryRecommendations,
    getGenreRecommendations,
    getTheatricalRecommendations,
    getRecommendationCollections,
    getRecommendationCacheDebugHandler,
    addRecommendationCollectionHandler,
    removeRecommendationCollectionHandler,
    setRecommendationCollectionsHandler
} from '../controllers/recommendationController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/recommendations - Get personalized recommendations
router.get('/', requireAuth as RequestHandler, getRecommendations as RequestHandler);

// GET /api/recommendations/categories - Get personalized category-based recommendations
router.get('/categories', requireAuth as RequestHandler, getCategoryRecommendations as RequestHandler);

// GET /api/recommendations/theatrical - Get personalized theatrical releases
router.get('/theatrical', requireAuth as RequestHandler, getTheatricalRecommendations as RequestHandler);

// GET /api/recommendations/genre/:genreId - Get personalized recommendations for a specific genre
router.get('/genre/:genreId', requireAuth as RequestHandler, getGenreRecommendations as RequestHandler);

// GET /api/recommendations/collections - Get user's recommendation source collections
router.get('/collections', requireAuth as RequestHandler, getRecommendationCollections as RequestHandler);

// GET /api/recommendations/debug/cache - Recommendation cache debug endpoint (restricted)
router.get('/debug/cache', requireAuth as RequestHandler, getRecommendationCacheDebugHandler as RequestHandler);

// POST /api/recommendations/collections - Add a collection to recommendation sources
router.post('/collections', requireAuth as RequestHandler, addRecommendationCollectionHandler as RequestHandler);

// PUT /api/recommendations/collections - Set all recommendation source collections
router.put('/collections', requireAuth as RequestHandler, setRecommendationCollectionsHandler as RequestHandler);

// DELETE /api/recommendations/collections/:collectionId - Remove a collection from recommendation sources
router.delete('/collections/:collectionId', requireAuth as RequestHandler, removeRecommendationCollectionHandler as RequestHandler);

export default router;
