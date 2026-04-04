import type { Request, Response, NextFunction } from 'express';

const parseOrigin = (value: string | undefined | null): string | null => {
    if (!value) {
        return null;
    }

    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
};

/**
 * Strict origin validation for state-changing endpoints.
 * This is a lightweight CSRF mitigation for cookie-based auth.
 */
export const requireTrustedOrigin = (req: Request, res: Response, next: NextFunction) => {
    const trustedOrigin = parseOrigin(process.env.FRONTEND_URL || 'http://localhost:8080');

    if (!trustedOrigin) {
        return res.status(500).json({ message: 'Server misconfiguration: FRONTEND_URL is invalid' });
    }

    const requestOrigin = parseOrigin(req.get('origin'));
    const refererOrigin = parseOrigin(req.get('referer'));
    const origin = requestOrigin ?? refererOrigin;

    if (!origin || origin !== trustedOrigin) {
        return res.status(403).json({ message: 'Forbidden: invalid request origin' });
    }

    next();
};
