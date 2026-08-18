import type { Request, Response, NextFunction } from 'express';

/**
 * Authorize callers with a shared secret.
 * Accepted as the `x-scraper-key` header, or `key` query string as a fallback.
 * The expected value must be configured via the SCRAPER_API_KEY env var.
 */
export function requireScraperKey(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.SCRAPER_API_KEY;

    if (!expected) {
        console.error('SCRAPER_API_KEY is not configured');
        res.status(500).json({ ok: false, error: 'Scraper not configured' });
        return;
    }

    const provided = req.header('x-scraper-key') || (req.query.key as string | undefined);

    if (!provided || provided !== expected) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    next();
}