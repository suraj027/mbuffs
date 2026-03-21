import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth, type User } from "../lib/auth.js";

const isDev = process.env.NODE_ENV !== "production";

const authDebug = (message: string, meta?: Record<string, unknown>) => {
    if (!isDev) {
        return;
    }

    if (meta) {
        console.debug(`[auth] ${message}`, meta);
        return;
    }

    console.debug(`[auth] ${message}`);
};

// Extend Express Request type
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            userId?: string | null;
            user?: User | null;
            session?: typeof auth.$Infer.Session.session | null;
        }
    }
}

// Middleware to get session and attach user info to request
export const deserializeUser = async (req: Request, res: Response, next: NextFunction) => {
    req.userId = null;
    req.user = null;
    req.session = null;

    try {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });

        if (session) {
            req.userId = session.user.id;
            req.user = session.user;
            req.session = session.session;
        }
    } catch (error) {
        console.error("[auth] Session lookup failed", {
            method: req.method,
            path: req.path,
            error,
        });
    }

    authDebug("Session resolved", {
        method: req.method,
        path: req.path,
        authenticated: Boolean(req.userId),
    });

    return next();
};

// Middleware to protect routes - requires a valid session
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        authDebug("Blocked unauthenticated request", {
            method: req.method,
            path: req.path,
        });
        return res.status(401).json({ message: "Unauthorized: Authentication required" });
    }

    next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized: Authentication required" });
    }

    if (!req.user || (req.user as any).role !== 'admin') {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
    }

    next();
};
