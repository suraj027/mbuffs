import express, { RequestHandler } from 'express';
import { getUserPreferences, updateUserPreferences, uploadAvatar, getAvatar, removeAvatar } from '../controllers/userController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/user/preferences - Get user's recommendation preferences
router.get('/preferences', requireAuth as RequestHandler, getUserPreferences as RequestHandler);

// PUT /api/user/preferences - Update user's recommendation preferences
router.put('/preferences', requireAuth as RequestHandler, updateUserPreferences as RequestHandler);

// POST /api/user/avatar - Upload avatar (base64 in JSON body)
router.post('/avatar', requireAuth as RequestHandler, uploadAvatar as RequestHandler);

// DELETE /api/user/avatar - Remove avatar
router.delete('/avatar', requireAuth as RequestHandler, removeAvatar as RequestHandler);

// GET /api/user/avatar/:userId - Serve avatar image (public)
router.get('/avatar/:userId', getAvatar as RequestHandler);

export default router;
