import express, { RequestHandler } from 'express';
import {
    getRecommendationsHandler,
    getRecommendationsByGenreHandler,
    triggerScrapeHandler,
    getStatusHandler,
    getAvailableGenresHandler,
} from '../controllers/redditController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/reddit/recommendations - Get Reddit-sourced recommendations
// Public endpoint (no auth required for reading)
router.get('/recommendations', getRecommendationsHandler as RequestHandler);

// GET /api/reddit/recommendations/genre/:genre - Get recommendations by genre
router.get('/recommendations/genre/:genre', getRecommendationsByGenreHandler as RequestHandler);

// GET /api/reddit/genres - Get available genres
router.get('/genres', getAvailableGenresHandler as RequestHandler);

// GET /api/reddit/status - Get scraping status
router.get('/status', getStatusHandler as RequestHandler);

// POST /api/reddit/scrape - Trigger a scrape (requires auth)
router.post('/scrape', requireAuth as RequestHandler, triggerScrapeHandler as RequestHandler);

export default router;
