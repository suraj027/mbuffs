import { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';
import '../middleware/authMiddleware.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = process.env.TMDB_BASE_URL;

// Resolve whether adult items should be included for this request.
// Authenticated: user's show_adult_items preference (default false). Unauthenticated: false.
const resolveShowAdultItems = async (userId: string | null | undefined): Promise<boolean> => {
    if (!userId) return false;
    try {
        const result = await sql`SELECT show_adult_items FROM "user" WHERE id = ${userId}`;
        if (result.length === 0) return false;
        return result[0].show_adult_items ?? false;
    } catch (error) {
        console.error('Error resolving show_adult_items preference:', error);
        return false;
    }
};

// Strip include_adult from querystring-style endpoints like "/discover/movie?include_adult=true&..."
const stripIncludeAdultFromEndpoint = (endpoint: string): string => {
    const qIndex = endpoint.indexOf('?');
    if (qIndex === -1) return endpoint;
    const base = endpoint.slice(0, qIndex);
    const query = endpoint.slice(qIndex + 1);
    const filtered = query
        .split('&')
        .filter(pair => !/^include_adult=/i.test(pair))
        .join('&');
    return filtered ? `${base}?${filtered}` : base;
};

const fetchDetailsFromMoviesAPI = async (req: Request, res: Response, next: NextFunction) => {
    const { endpoint, params = {} } = req.body as { endpoint: string; params?: Record<string, unknown> };
    if (!TMDB_API_KEY) {
        throw new Error("TMDB API key (VITE_TMDB_API_KEY) is missing.");
    }

    const includeAdult = await resolveShowAdultItems(req.userId);

    const normalizedEndpoint = stripIncludeAdultFromEndpoint(endpoint);
    const url = new URL(`${TMDB_BASE_URL}${normalizedEndpoint}`);
    url.searchParams.append('api_key', TMDB_API_KEY);
    url.searchParams.append('language', 'en-US');
    Object.entries(params).forEach(([key, value]) => {
        if (key === 'include_adult') return; // server is authoritative
        url.searchParams.append(key, String(value));
    });
    url.searchParams.set('include_adult', includeAdult ? 'true' : 'false');

    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            let errorData = { status_message: `HTTP error ${response.status}` };
             try {
                const jsonError = await response.json() as Promise<{ status_message: string }>;
                errorData = { ...errorData, ...jsonError };
            } catch (e) { /* Ignore JSON parsing error */ }
            console.error(`TMDB API Error (${response.status}) on ${endpoint}:`, errorData);
            throw new Error(errorData.status_message);
        }
        const responseData = await response.json() as Record<string, unknown>;

        // Defense-in-depth: many TMDB endpoints (trending, popular, recommendations/similar,
        // append_to_response, etc.) ignore include_adult. Post-filter list-shaped responses
        // on the per-item `adult` flag when the user has opted out. We intentionally do NOT
        // filter single-item detail responses — a user visiting an item's URL directly should
        // still load the page; the toggle only controls what gets listed/recommended.
        if (!includeAdult && responseData && typeof responseData === 'object') {
            const dropped = filterAdultFromTmdbResponse(responseData);
            console.log(
                `[adult-filter] proxy endpoint=${endpoint} user=${req.userId ?? 'anon'} includeAdult=false dropped=${JSON.stringify(dropped)}`
            );
        } else {
            console.log(
                `[adult-filter] proxy endpoint=${endpoint} user=${req.userId ?? 'anon'} includeAdult=${includeAdult} (no filtering)`
            );
        }

        return res.json(responseData);
    } catch (error) {
        console.error(`TMDB Network or unexpected error on ${endpoint}:`, error);
        next(error);
    }
}

// Recursively strip items with `adult: true` from known TMDB result shapes.
// Returns a per-field drop count so callers can log what was removed.
const filterAdultFromTmdbResponse = (data: Record<string, unknown>): Record<string, number> => {
    const dropped: Record<string, number> = {};
    const dropAdult = <T,>(arr: T[]): { kept: T[]; removed: number } => {
        const kept = arr.filter(
            (item) => !(item && typeof item === 'object' && (item as { adult?: boolean }).adult === true)
        );
        return { kept, removed: arr.length - kept.length };
    };

    if (Array.isArray((data as { results?: unknown }).results)) {
        const { kept, removed } = dropAdult((data as { results: unknown[] }).results);
        (data as { results: unknown[] }).results = kept;
        if (removed > 0) dropped.results = removed;
    }
    // Known appended sub-responses (append_to_response=recommendations,similar,...)
    for (const key of ['recommendations', 'similar'] as const) {
        const sub = (data as Record<string, unknown>)[key];
        if (sub && typeof sub === 'object') {
            const subDropped = filterAdultFromTmdbResponse(sub as Record<string, unknown>);
            for (const [k, v] of Object.entries(subDropped)) {
                dropped[`${key}.${k}`] = v;
            }
        }
    }
    // person/combined_credits has cast[] and crew[] with `adult` on each entry
    for (const key of ['cast', 'crew'] as const) {
        const sub = (data as Record<string, unknown>)[key];
        if (Array.isArray(sub)) {
            const { kept, removed } = dropAdult(sub);
            (data as Record<string, unknown>)[key] = kept;
            if (removed > 0) dropped[key] = removed;
        }
    }
    return dropped;
};

export {
    fetchDetailsFromMoviesAPI
};
