import express, { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { scrapeParentalGuidanceFromImdb } from '../services/imdbScraperService.js';
import { requireScraperKey } from '../middleware/authMiddleware.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

dotenv.config({
    path: './.env',
});

const port = process.env.PORT || 5002;

const corsOptions = {
    origin: '*',
    methods: 'GET,POST',
};

// Known crawler/bot user agents. This is an internal API, so none are welcome.
const BOT_UA_PATTERN = /(googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|facebookexternalhit|facebot|twitterbot|linkedinbot|discordbot|telegrambot|slackbot|applebot|whatsapp|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|perplexitybot|ia_archiver)/i;

const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

if (process.env.NODE_ENV !== 'production') {
    console.debug('[scraper] CORS configured', { origin: corsOptions.origin });
}

const IMDB_ID_PATTERN = /^tt\d+$/;

export const createApp = (): Express => {
    const app: Express = express();

    app.use(cors(corsOptions));
    app.use(express.json());

    // Belt-and-suspenders: tell crawlers not to index anything,
    // even if they fetch pages directly without reading robots.txt.
    app.use((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        next();
    });

    // The only public route - bots must be able to read the disallow rules.
    app.get('/robots.txt', (_req: Request, res: Response) => {
        res.type('text/plain').send(ROBOTS_TXT);
    });

    // Reject known bots outright.
    app.use((req: Request, res: Response, next: NextFunction) => {
        const userAgent = req.header('user-agent') || '';
        if (BOT_UA_PATTERN.test(userAgent)) {
            res.status(403).json({ ok: false, error: 'Forbidden' });
            return;
        }
        next();
    });

    // Everything below requires the shared secret - no public endpoints.
    app.use(requireScraperKey);

    app.get('/health', (_req: Request, res: Response) => {
        res.json({ ok: true, service: 'scraper' });
    });

    // Scrape parental guidance for a single IMDB title.
    // GET /scrape/parental-guidance/:imdbId
    app.get(
        '/scrape/parental-guidance/:imdbId',
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const rawParam = req.params.imdbId;
                const imdbId = (Array.isArray(rawParam) ? rawParam[0] : rawParam ?? '').trim();

                if (!imdbId || !IMDB_ID_PATTERN.test(imdbId)) {
                    res.status(400).json({ ok: false, error: 'Invalid or missing imdbId (expected tt\\d+)' });
                    return;
                }

                const data = await scrapeParentalGuidanceFromImdb(imdbId);

                res.json({ ok: true, imdbId, data });
            } catch (error) {
                next(error);
            }
        },
    );

    app.get('/', (_req: Request, res: Response) => {
        res.json({ service: 'scraper', endpoints: ['/health', '/scrape/parental-guidance/:imdbId'] });
    });

    const globalErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
        console.error('[scraper-error]', err);
        res.status(500).json({ ok: false, error: 'Internal Scraper Error' });
    };

    app.use(globalErrorHandler);

    return app;
};

const app = createApp();

const isDirectExecution = process.argv[1]
    ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
    : false;

if (isDirectExecution) {
    app.listen(port, () => {
        console.info(`[scraper] Server listening on port ${port}`);
    });
}

export default app;