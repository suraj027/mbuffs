import express, { RequestHandler } from 'express';
import { getAllUsers } from '../controllers/adminController.js';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/users', requireAuth as RequestHandler, requireAdmin as RequestHandler, getAllUsers as RequestHandler);

export default router;
