import type { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
    keyPrefix?: string;
}

interface CounterEntry {
    count: number;
    resetAt: number;
}

const counters = new Map<string, CounterEntry>();

const getClientIp = (req: Request): string => {
    const xff = req.get('x-forwarded-for');
    if (xff) {
        return xff.split(',')[0].trim();
    }

    return req.ip || 'unknown';
};

export const createRateLimit = ({ windowMs, maxRequests, keyPrefix = 'global' }: RateLimitConfig) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const now = Date.now();
        const userKey = req.userId ?? 'anonymous';
        const ipKey = getClientIp(req);
        const key = `${keyPrefix}:${userKey}:${ipKey}`;

        const existing = counters.get(key);

        if (!existing || now > existing.resetAt) {
            counters.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (existing.count >= maxRequests) {
            const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
            res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
            return res.status(429).json({ message: 'Too many requests. Please try again shortly.' });
        }

        existing.count += 1;
        counters.set(key, existing);

        next();
    };
};
