import express, { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { deserializeUser } from '../middleware/authMiddleware.js';
import oauthRoutes from '../routes/oauthRoutes.js';
import collectionRoutes from '../routes/collectionRoutes.js';
import contentRoutes from '../routes/contentRoutes.js';
import userRoutes from '../routes/userRoutes.js';
import recommendationRoutes from '../routes/recommendationRoutes.js';
import parentalGuidanceRoutes from '../routes/parentalGuidanceRoutes.js';
import redditRoutes from '../routes/redditRoutes.js';

dotenv.config({
    path: './.env'
});

const app: Express = express();
const port = process.env.PORT || 5001;

// --- CORS Setup --- 
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:8080',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // Required for Better Auth cookies
};

console.log("CORS Options:", corsOptions);

// Apply CORS globally
app.use(cors(corsOptions));

app.use(cookieParser());

// IMPORTANT: Better Auth routes must be mounted BEFORE express.json()
// Better Auth handles its own body parsing
app.use('/api/auth', oauthRoutes);

// Apply JSON middleware for other routes
app.use(express.json());

// Attach userId info from session to req if available
app.use(deserializeUser);

// --- API Routes ---
app.use('/api/collections', collectionRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/user', userRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/ratings', parentalGuidanceRoutes);
app.use('/api/reddit', redditRoutes);

app.get('/api', (req: Request, res: Response) => {
    res.json({ message: `Welcome to the mbuffs API! ${process.env.FRONTEND_URL}` });
});

// --- Define Global Error Handler with explicit type ---
const globalErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
    console.error("[ERROR]", err);

    let statusCode = 500;
    let message = 'Internal Server Error';

    // Handle Zod validation errors
    if (err instanceof z.ZodError) {
        statusCode = 400; // Bad Request
        message = err.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    }

    // Send a JSON response
    res.status(statusCode).json({
        status: 'error',
        statusCode,
        message,
        // Optionally include stack trace in development
        ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
    });
};

app.use(globalErrorHandler);

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// Export the app instance for Vercel (or other serverless platforms)
export default app;
