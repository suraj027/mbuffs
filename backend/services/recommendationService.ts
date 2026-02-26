import { sql } from '../lib/db.js';
import { createHash } from 'node:crypto';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = process.env.TMDB_BASE_URL;

interface CollectionMovie {
    movie_id: string;
    is_movie: boolean;
}

interface TMDBMovie {
    id: number;
    media_type?: 'movie' | 'tv' | 'person';
    title?: string;
    name?: string;
    poster_path: string | null;
    release_date?: string;
    first_air_date?: string;
    vote_average: number;
    vote_count?: number;
    popularity?: number;
    overview: string;
    backdrop_path: string | null;
    genre_ids?: number[];
    explainability?: RecommendationExplainability;
}

interface RecommendationExplainability {
    reason_codes: string[];
    source_appearances: number;
    matched_genres: number[];
    because_you_liked?: string[];
    score_breakdown: {
        base: number;
        popularity: number;
        genre: number;
        source_boost: number;
        director_boost: number;
        actor_boost: number;
        primary_boost: number;
        total: number;
    };
}

interface RecommendationCandidate {
    item: TMDBMovie;
    score: number;
    sources: number;
}

interface TMDBRecommendationsResponse {
    page: number;
    results: TMDBMovie[];
    total_pages: number;
    total_results: number;
}

interface TMDBDetailsResponse {
    id: number;
    title?: string;
    name?: string;
    genres: { id: number; name: string }[];
    keywords?: { keywords?: { id: number; name: string }[]; results?: { id: number; name: string }[] };
}

interface TMDBCrewMember {
    id: number;
    name: string;
    job: string;
    department: string;
    profile_path: string | null;
}

interface TMDBCastMember {
    id: number;
    name: string;
    character: string;
    order: number; // Billing order (0 = lead)
    profile_path: string | null;
}

interface TMDBCreditsResponse {
    id: number;
    cast: TMDBCastMember[];
    crew: TMDBCrewMember[];
}

interface TMDBDiscoverResponse {
    page: number;
    results: TMDBMovie[];
    total_pages: number;
    total_results: number;
}

interface TMDBTrendingResponse {
    page: number;
    results: TMDBMovie[];
    total_pages: number;
    total_results: number;
}

interface DirectorInfo {
    id: number;
    name: string;
    count: number; // How many times this director appears in source collections
}

interface ActorInfo {
    id: number;
    name: string;
    count: number; // How many times this actor appears in source collections
}

interface RecommendationResult {
    results: TMDBMovie[];
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
    page: number;
    total_pages: number;
    total_results: number;
}

interface Genre {
    id: number;
    name: string;
}

interface CategoryRecommendation {
    genre: Genre;
    results: TMDBMovie[];
    total_results: number;
}

interface CategoryRecommendationsResult {
    categories: CategoryRecommendation[];
    mediaType: 'movie' | 'tv';
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
}

type RecommendationCacheEndpoint = 'for_you' | 'categories' | 'genre' | 'theatrical' | 'exclusions';

interface RecommendationCacheDebugEntry {
    cache_key: string;
    cache_version: string;
    expires_at: string;
    created_at: string;
    updated_at: string;
    payload_size: number;
}

const RECOMMENDATION_CACHE_VERSION = 'v4';
const RECOMMENDATION_CACHE_TTL_MINUTES = 30;
const recommendationCacheLocks = new Map<string, Promise<void>>();

function selectTopKByScore(candidates: RecommendationCandidate[], k: number): RecommendationCandidate[] {
    if (k <= 0 || candidates.length === 0) {
        return [];
    }

    if (k >= candidates.length) {
        return [...candidates].sort((a, b) => b.score - a.score);
    }

    const heap: RecommendationCandidate[] = [];

    const swap = (i: number, j: number): void => {
        const temp = heap[i];
        heap[i] = heap[j];
        heap[j] = temp;
    };

    const bubbleUp = (index: number): void => {
        let current = index;

        while (current > 0) {
            const parent = Math.floor((current - 1) / 2);
            if (heap[parent].score <= heap[current].score) {
                break;
            }
            swap(parent, current);
            current = parent;
        }
    };

    const bubbleDown = (index: number): void => {
        let current = index;

        while (true) {
            const left = current * 2 + 1;
            const right = current * 2 + 2;
            let smallest = current;

            if (left < heap.length && heap[left].score < heap[smallest].score) {
                smallest = left;
            }

            if (right < heap.length && heap[right].score < heap[smallest].score) {
                smallest = right;
            }

            if (smallest === current) {
                break;
            }

            swap(current, smallest);
            current = smallest;
        }
    };

    for (const candidate of candidates) {
        if (heap.length < k) {
            heap.push(candidate);
            bubbleUp(heap.length - 1);
            continue;
        }

        if (candidate.score <= heap[0].score) {
            continue;
        }

        heap[0] = candidate;
        bubbleDown(0);
    }

    return heap.sort((a, b) => b.score - a.score);
}

function paginateTopCandidates(
    candidates: RecommendationCandidate[],
    page: number,
    limit: number
): RecommendationCandidate[] {
    if (limit <= 0 || page <= 0 || candidates.length === 0) {
        return [];
    }

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    if (startIndex >= candidates.length) {
        return [];
    }

    const topWindow = selectTopKByScore(candidates, Math.min(endIndex, candidates.length));
    return topWindow.slice(startIndex, startIndex + limit);
}

function addReasonCode(codes: string[], code: string): string[] {
    if (codes.includes(code)) {
        return codes;
    }

    return [...codes, code];
}

function addBecauseYouLiked(items: string[], value: string): string[] {
    if (!value || items.includes(value)) {
        return items;
    }

    return [...items, value].slice(0, 2);
}

function formatSourceLabel(label: string, isMovie: boolean): string {
    const suffix = isMovie ? 'movie' : 'tv show';
    return `${label} (${suffix})`;
}

function buildRecommendationCacheKey(
    endpoint: RecommendationCacheEndpoint,
    params: Record<string, string | number>
): string {
    const serialized = JSON.stringify({ endpoint, params, version: RECOMMENDATION_CACHE_VERSION });
    return createHash('sha256').update(serialized).digest('hex');
}

async function parseCachePayload<T>(payload: unknown): Promise<T | null> {
    if (typeof payload === 'string') {
        try {
            return JSON.parse(payload) as T;
        } catch {
            return null;
        }
    }

    if (payload && typeof payload === 'object') {
        return payload as T;
    }

    return null;
}

async function withRecommendationCacheLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    while (recommendationCacheLocks.has(lockKey)) {
        await recommendationCacheLocks.get(lockKey);
    }

    let releaseLock = () => {};
    const lockPromise = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });
    recommendationCacheLocks.set(lockKey, lockPromise);

    try {
        return await fn();
    } finally {
        recommendationCacheLocks.delete(lockKey);
        releaseLock();
    }
}

async function getCachedRecommendationResult<T>(
    userId: string,
    endpoint: RecommendationCacheEndpoint,
    params: Record<string, string | number>,
    generator: () => Promise<T>
): Promise<T> {
    const cacheKey = buildRecommendationCacheKey(endpoint, params);
    const now = new Date();

    const existingRows = await sql`
        SELECT payload_json, expires_at
        FROM recommendation_cache
        WHERE user_id = ${userId} AND cache_key = ${cacheKey}
        LIMIT 1
    `;

    const existingRow = existingRows[0] as { payload_json: unknown; expires_at: string } | undefined;
    const cachedPayload = existingRow ? await parseCachePayload<T>(existingRow.payload_json) : null;
    const isFresh = existingRow ? new Date(existingRow.expires_at) > now : false;

    if (cachedPayload && isFresh) {
        return cachedPayload;
    }

    const lockKey = `${userId}:${cacheKey}`;

    return withRecommendationCacheLock(lockKey, async () => {
        const recheckRows = await sql`
            SELECT payload_json, expires_at
            FROM recommendation_cache
            WHERE user_id = ${userId} AND cache_key = ${cacheKey}
            LIMIT 1
        `;

        const recheckRow = recheckRows[0] as { payload_json: unknown; expires_at: string } | undefined;
        const recheckPayload = recheckRow ? await parseCachePayload<T>(recheckRow.payload_json) : null;
        const recheckFresh = recheckRow ? new Date(recheckRow.expires_at) > new Date() : false;

        if (recheckPayload && recheckFresh) {
            return recheckPayload;
        }

        try {
            const freshResult = await generator();

            await sql`
                INSERT INTO recommendation_cache (
                    id,
                    user_id,
                    cache_key,
                    payload_json,
                    cache_version,
                    expires_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    gen_random_uuid()::text,
                    ${userId},
                    ${cacheKey},
                    ${JSON.stringify(freshResult)},
                    ${RECOMMENDATION_CACHE_VERSION},
                    NOW() + (${RECOMMENDATION_CACHE_TTL_MINUTES} * INTERVAL '1 minute'),
                    NOW(),
                    NOW()
                )
                ON CONFLICT (user_id, cache_key)
                DO UPDATE SET
                    payload_json = EXCLUDED.payload_json,
                    cache_version = EXCLUDED.cache_version,
                    expires_at = EXCLUDED.expires_at,
                    updated_at = NOW()
            `;

            return freshResult;
        } catch (error) {
            if (recheckPayload) {
                return recheckPayload;
            }

            if (cachedPayload) {
                return cachedPayload;
            }

            throw error;
        }
    });
}

export async function invalidateRecommendationCache(userId: string): Promise<void> {
    await sql`
        DELETE FROM recommendation_cache
        WHERE user_id = ${userId}
    `;
}

export async function invalidateRecommendationCacheByCollection(collectionId: string): Promise<void> {
    await sql`
        DELETE FROM recommendation_cache rc
        USING user_recommendation_collections urc
        WHERE rc.user_id = urc.user_id
        AND urc.collection_id = ${collectionId}
    `;
}

export async function getRecommendationCacheDebug(userId: string): Promise<{
    total: number;
    fresh: number;
    expired: number;
    entries: RecommendationCacheDebugEntry[];
}> {
    const entriesResult = await sql`
        SELECT
            cache_key,
            cache_version,
            expires_at,
            created_at,
            updated_at,
            length(payload_json) AS payload_size
        FROM recommendation_cache
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
    `;

    const entries = (entriesResult as Array<{
        cache_key: string;
        cache_version: string;
        expires_at: string;
        created_at: string;
        updated_at: string;
        payload_size: number | string;
    }>).map((entry) => ({
        ...entry,
        payload_size: Number(entry.payload_size)
    }));

    const now = new Date();
    let fresh = 0;
    let expired = 0;

    for (const entry of entries) {
        if (new Date(entry.expires_at) > now) {
            fresh += 1;
        } else {
            expired += 1;
        }
    }

    return {
        total: entries.length,
        fresh,
        expired,
        entries
    };
}

/**
 * Fetch TMDB API data
 */
async function fetchTMDB<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
    if (!TMDB_API_KEY) {
        console.error("TMDB API key is missing");
        return null;
    }
    
    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.append('api_key', TMDB_API_KEY);
    url.searchParams.append('language', 'en-US');
    Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
    
    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            console.error(`TMDB API Error (${response.status}) on ${endpoint}`);
            return null;
        }
        return await response.json() as T;
    } catch (error) {
        console.error(`TMDB Network error on ${endpoint}:`, error);
        return null;
    }
}

/**
 * Get recommendations from TMDB for a specific movie/TV show
 */
async function getRecommendationsForItem(movieId: number, isMovie: boolean): Promise<TMDBMovie[]> {
    const mediaType = isMovie ? 'movie' : 'tv';
    const response = await fetchTMDB<TMDBRecommendationsResponse>(
        `/${mediaType}/${movieId}/recommendations`
    );
    return response?.results || [];
}

/**
 * Get similar content from TMDB for a specific movie/TV show
 */
async function getSimilarForItem(movieId: number, isMovie: boolean): Promise<TMDBMovie[]> {
    const mediaType = isMovie ? 'movie' : 'tv';
    const response = await fetchTMDB<TMDBRecommendationsResponse>(
        `/${mediaType}/${movieId}/similar`
    );
    return response?.results || [];
}

/**
 * Get details including genres for a movie/TV show
 */
async function getItemDetails(movieId: number, isMovie: boolean): Promise<TMDBDetailsResponse | null> {
    const mediaType = isMovie ? 'movie' : 'tv';
    const response = await fetchTMDB<TMDBDetailsResponse>(
        `/${mediaType}/${movieId}`,
        { append_to_response: 'keywords' }
    );
    return response;
}

/**
 * Get credits (including directors) for a movie/TV show
 */
async function getItemCredits(movieId: number, isMovie: boolean): Promise<TMDBCreditsResponse | null> {
    const mediaType = isMovie ? 'movie' : 'tv';
    const response = await fetchTMDB<TMDBCreditsResponse>(
        `/${mediaType}/${movieId}/credits`
    );
    return response;
}

/**
 * Extract directors from credits response
 * For movies: crew members with job "Director"
 * For TV shows: crew members with job "Director" or department "Directing"
 */
function extractDirectors(credits: TMDBCreditsResponse | null, isMovie: boolean): TMDBCrewMember[] {
    if (!credits?.crew) return [];
    
    if (isMovie) {
        return credits.crew.filter(member => member.job === 'Director');
    } else {
        // For TV shows, include showrunners and main directors
        return credits.crew.filter(member => 
            member.job === 'Director' || 
            member.department === 'Directing'
        );
    }
}

/**
 * Extract top cast from credits response
 * Returns lead actors (top 3 billed) from the cast
 */
function extractTopCast(credits: TMDBCreditsResponse | null): TMDBCastMember[] {
    if (!credits?.cast) return [];
    
    // Get top 3 billed actors (leads)
    return credits.cast
        .sort((a, b) => a.order - b.order)
        .slice(0, 3);
}

/**
 * Discover movies/TV shows by a specific director using TMDB discover API
 * Filters by user's preferred genres to show most relevant works
 * Returns high-rated works by the director in the specified genres
 */
async function discoverByDirector(
    directorId: number, 
    isMovie: boolean, 
    preferredGenreIds: number[] = []
): Promise<TMDBMovie[]> {
    const mediaType = isMovie ? 'movie' : 'tv';
    
    const params: Record<string, string> = {
        with_crew: directorId.toString(),
        sort_by: 'vote_average.desc',
        'vote_count.gte': '100', // Only include well-rated works
        page: '1'
    };
    
    // Filter by preferred genres if available (use OR logic with pipe separator)
    if (preferredGenreIds.length > 0) {
        params.with_genres = preferredGenreIds.join('|');
    }
    
    const response = await fetchTMDB<TMDBDiscoverResponse>(
        `/discover/${mediaType}`,
        params
    );
    return response?.results || [];
}

/**
 * Discover movies/TV shows by a specific actor using TMDB discover API
 * Filters by user's preferred genres to show most relevant works
 * Returns popular, high-rated works featuring the actor
 */
async function discoverByActor(
    actorId: number, 
    isMovie: boolean, 
    preferredGenreIds: number[] = []
): Promise<TMDBMovie[]> {
    const mediaType = isMovie ? 'movie' : 'tv';
    
    const params: Record<string, string> = {
        with_cast: actorId.toString(),
        sort_by: 'popularity.desc', // Popular works for actors
        'vote_count.gte': '100',
        page: '1'
    };
    
    // Filter by preferred genres if available
    if (preferredGenreIds.length > 0) {
        params.with_genres = preferredGenreIds.join('|');
    }
    
    const response = await fetchTMDB<TMDBDiscoverResponse>(
        `/discover/${mediaType}`,
        params
    );
    return response?.results || [];
}

/**
 * Parse movie ID from collection_movies format
 * Movies are stored as numeric IDs, TV shows as "12345tv"
 */
function parseMovieId(movieIdStr: string): { id: number; isMovie: boolean } {
    if (movieIdStr.endsWith('tv')) {
        return {
            id: parseInt(movieIdStr.slice(0, -2), 10),
            isMovie: false
        };
    }
    return {
        id: parseInt(movieIdStr, 10),
        isMovie: true
    };
}

/**
 * Get user's recommendation source collections
 */
async function getUserRecommendationCollections(userId: string): Promise<{ id: string; name: string }[]> {
    const result = await sql`
        SELECT c.id, c.name
        FROM user_recommendation_collections urc
        JOIN collections c ON urc.collection_id = c.id
        WHERE urc.user_id = ${userId}
        ORDER BY urc.added_at DESC
    `;
    return result as { id: string; name: string }[];
}

/**
 * Get all movies from user's recommendation source collections
 */
async function getMoviesFromRecommendationCollections(userId: string): Promise<CollectionMovie[]> {
    const result = await sql`
        SELECT DISTINCT cm.movie_id, cm.is_movie
        FROM collection_movies cm
        JOIN user_recommendation_collections urc ON cm.collection_id = urc.collection_id
        WHERE urc.user_id = ${userId}
    `;
    return result as CollectionMovie[];
}

function buildCollectionSnapshotToken(collectionIds: string[]): string {
    const normalized = [...collectionIds].sort();
    return createHash('sha256').update(normalized.join(',')).digest('hex');
}

async function getUserExcludedMovieIdsSnapshot(
    userId: string,
    sourceCollectionIds: string[]
): Promise<Set<string>> {
    const sourceCollectionsToken = buildCollectionSnapshotToken(sourceCollectionIds);

    const snapshot = await getCachedRecommendationResult<{ movieIds: string[] }>(
        userId,
        'exclusions',
        { sourceCollectionsToken },
        async () => {
            const result = await sql`
                SELECT DISTINCT cm.movie_id
                FROM collection_movies cm
                JOIN collections c ON cm.collection_id = c.id
                WHERE c.owner_id = ${userId}
                AND (
                    c.id::text = ANY(${sourceCollectionIds}::text[])
                    OR c.is_system = true
                )
            `;

            return {
                movieIds: (result as { movie_id: string }[]).map((row) => row.movie_id)
            };
        }
    );

    return new Set(snapshot.movieIds);
}

async function getUserSystemExcludedMovieIds(userId: string): Promise<Set<string>> {
    const result = await sql`
        SELECT DISTINCT cm.movie_id
        FROM collection_movies cm
        JOIN collections c ON cm.collection_id = c.id
        WHERE c.owner_id = ${userId}
        AND c.is_system = true
    `;

    return new Set((result as { movie_id: string }[]).map((row) => row.movie_id));
}

function getTrendingKey(item: TMDBMovie): string | null {
    if (item.media_type === 'person') {
        return null;
    }

    const isTv = item.media_type === 'tv' || (!!item.first_air_date && !item.release_date);
    return isTv ? `${item.id}tv` : `${item.id}`;
}

async function generateColdStartRecommendations(
    userId: string,
    limit: number,
    page: number,
    sourceCollections: { id: string; name: string }[]
): Promise<RecommendationResult> {
    const excludedMovieIds = await getUserSystemExcludedMovieIds(userId);
    const tmdbPagesToFetch = Math.min(Math.max(page + 1, 2), 6);

    const pagePromises = Array.from({ length: tmdbPagesToFetch }, (_, i) => i + 1).map(async (tmdbPage) => {
        const response = await fetchTMDB<TMDBTrendingResponse>('/trending/all/week', {
            page: tmdbPage.toString()
        });

        return {
            results: response?.results || [],
            total_pages: response?.total_pages || 0,
            total_results: response?.total_results || 0
        };
    });

    const pageResults = await Promise.all(pagePromises);
    const allResults = pageResults.flatMap((result) => result.results);
    const tmdbTotalPages = pageResults[0]?.total_pages || 0;
    const tmdbTotalResults = pageResults[0]?.total_results || 0;

    const seenIds = new Set<string>();
    const scoredResults: RecommendationCandidate[] = [];

    for (const item of allResults) {
        const key = getTrendingKey(item);
        if (!key) {
            continue;
        }

        if (excludedMovieIds.has(key) || seenIds.has(key)) {
            continue;
        }

        seenIds.add(key);

        const baseScore = (item.vote_average || 0) * 10;
        const popularityScore = Math.min((item.popularity || 0) / 10, 30);
        const voteCountScore = Math.min((item.vote_count || 0) / 200, 20);
        const totalScore = baseScore + popularityScore + voteCountScore;

        scoredResults.push({
            item: {
                ...item,
                explainability: {
                    reason_codes: ['cold_start_trending'],
                    source_appearances: 0,
                    matched_genres: [],
                    because_you_liked: [],
                    score_breakdown: {
                        base: baseScore,
                        popularity: popularityScore,
                        genre: 0,
                        source_boost: 0,
                        director_boost: 0,
                        actor_boost: 0,
                        primary_boost: 0,
                        total: totalScore
                    }
                }
            },
            score: totalScore,
            sources: 0
        });
    }

    const filterRatio = allResults.length > 0 ? scoredResults.length / allResults.length : 1;
    const estimatedTotalResults = Math.floor(tmdbTotalResults * filterRatio);
    const totalPages = Math.min(Math.ceil(estimatedTotalResults / limit), tmdbTotalPages);
    const paginatedResults = paginateTopCandidates(scoredResults, page, limit).map((result) => result.item);

    return {
        results: paginatedResults,
        sourceCollections,
        totalSourceItems: 0,
        page,
        total_pages: totalPages,
        total_results: estimatedTotalResults
    };
}

/**
 * Main recommendation algorithm
 * 
 * Strategy:
 * 1. Get all movies/TV shows from user's recommendation source collections
 * 2. For each item, fetch TMDB recommendations and similar content (PRIMARY source)
 * 3. Analyze genres to build a preference profile
 * 4. Analyze directors and actors to build preference profiles
 * 5. Fetch a small number of best works from favorite directors (supplementary)
 * 6. Fetch a small number of popular works from favorite actors (supplementary)
 * 7. Score and rank recommendations based on:
 *    - How many times they appear (popularity across sources)
 *    - Genre match with user preferences (primary factor)
 *    - TMDB rating and popularity
 *    - Small boost for director/actor matches
 * 8. Filter out items already in user's collections
 * 9. Return top recommendations
 */
export async function generateRecommendations(
    userId: string,
    limit: number = 20,
    page: number = 1
): Promise<RecommendationResult> {
    const emptyResult: RecommendationResult = { 
        results: [], 
        sourceCollections: [], 
        totalSourceItems: 0,
        page: 1,
        total_pages: 0,
        total_results: 0
    };

    // Check if user has recommendations enabled
    const userResult = await sql`
        SELECT recommendations_enabled FROM "user" WHERE id = ${userId}
    `;
    
    if (userResult.length === 0 || !userResult[0].recommendations_enabled) {
        return emptyResult;
    }
    
    // Get source collections
    const sourceCollections = await getUserRecommendationCollections(userId);
    if (sourceCollections.length === 0) {
        return generateColdStartRecommendations(userId, limit, page, []);
    }
    
    // Get all movies from recommendation source collections
    const sourceMovies = await getMoviesFromRecommendationCollections(userId);
    if (sourceMovies.length === 0) {
        return generateColdStartRecommendations(userId, limit, page, sourceCollections);
    }
    
    const sourceCollectionIds = sourceCollections.map(c => c.id);
    const existingMovieIds = await getUserExcludedMovieIdsSnapshot(userId, sourceCollectionIds);
    
    // Build genre, director, and actor preference profiles
    const genreScores: Map<number, number> = new Map();
    const directorScores: Map<number, DirectorInfo> = new Map();
    const actorScores: Map<number, ActorInfo> = new Map();
    const allRecommendations: Map<string, RecommendationCandidate> = new Map();
    
    // Sample a subset of source movies to avoid rate limiting (max 10 for API calls)
    const sampleSize = Math.min(sourceMovies.length, 10);
    const sampledMovies = sourceMovies
        .sort(() => Math.random() - 0.5)
        .slice(0, sampleSize);
    
    // Fetch details, credits, and recommendations for each sampled source item
    const fetchPromises = sampledMovies.map(async (movie) => {
        const { id, isMovie } = parseMovieId(movie.movie_id);
        
        // Get details for genre profiling and credits for director profiling
        const [details, credits, recommendations, similar] = await Promise.all([
            getItemDetails(id, isMovie),
            getItemCredits(id, isMovie),
            getRecommendationsForItem(id, isMovie),
            getSimilarForItem(id, isMovie)
        ]);
        
        // Build genre profile
        if (details?.genres) {
            details.genres.forEach(genre => {
                genreScores.set(genre.id, (genreScores.get(genre.id) || 0) + 1);
            });
        }
        
        // Build director profile
        const directors = extractDirectors(credits, isMovie);
        directors.forEach(director => {
            const existing = directorScores.get(director.id);
            if (existing) {
                existing.count += 1;
            } else {
                directorScores.set(director.id, {
                    id: director.id,
                    name: director.name,
                    count: 1
                });
            }
        });
        
        // Build actor profile (top billed cast)
        const topCast = extractTopCast(credits);
        topCast.forEach(actor => {
            const existing = actorScores.get(actor.id);
            if (existing) {
                existing.count += 1;
            } else {
                actorScores.set(actor.id, {
                    id: actor.id,
                    name: actor.name,
                    count: 1
                });
            }
        });
        
        const rawSourceLabel = details?.title || details?.name || `${id}`;
        const sourceLabel = formatSourceLabel(rawSourceLabel, isMovie);

        return { isMovie, recommendations, similar, sourceLabel };
    });
    
    const results = await Promise.all(fetchPromises);
    
    // Process all recommendations from TMDB recommendations/similar
    results.forEach(({ isMovie, recommendations, similar, sourceLabel }) => {
        const allItems = [...recommendations, ...similar];
        
        allItems.forEach(item => {
            // Create a unique key for deduplication
            const key = isMovie ? `${item.id}` : `${item.id}tv`;
            
            // Skip items already in user's collections
            if (existingMovieIds.has(key)) return;
            
            // Calculate genre match score
            let genreMatchScore = 0;
            if (item.genre_ids) {
                item.genre_ids.forEach(genreId => {
                    genreMatchScore += genreScores.get(genreId) || 0;
                });
            }
            
            const matchedGenres = (item.genre_ids || []).filter((genreId) => (genreScores.get(genreId) || 0) > 0);

            // Calculate combined score
            const baseScore = (item.vote_average || 0) * 10;
            const popularityScore = Math.min((item.popularity || 0) / 10, 50);
            const genreBoost = genreMatchScore * 5;
            const combinedScore = baseScore + popularityScore + genreBoost;
            
            const existing = allRecommendations.get(key);
            if (existing) {
                // Item appeared from multiple sources - boost its score
                existing.sources += 1;
                const sourceBoost = existing.sources * 20;
                existing.score = combinedScore + sourceBoost;
                const explainability = existing.item.explainability;
                if (explainability) {
                    explainability.source_appearances = existing.sources;
                    explainability.matched_genres = matchedGenres;
                    explainability.because_you_liked = addBecauseYouLiked(
                        explainability.because_you_liked || [],
                        sourceLabel
                    );
                    explainability.score_breakdown.base = baseScore;
                    explainability.score_breakdown.popularity = popularityScore;
                    explainability.score_breakdown.genre = genreBoost;
                    explainability.score_breakdown.source_boost = sourceBoost;
                    explainability.score_breakdown.total = existing.score;
                }
            } else {
                allRecommendations.set(key, {
                    item: {
                        ...item,
                        explainability: {
                            reason_codes: matchedGenres.length > 0
                                ? ['tmdb_recommendation_or_similar', 'genre_match']
                                : ['tmdb_recommendation_or_similar'],
                            source_appearances: 1,
                            matched_genres: matchedGenres,
                            because_you_liked: [sourceLabel],
                            score_breakdown: {
                                base: baseScore,
                                popularity: popularityScore,
                                genre: genreBoost,
                                source_boost: 0,
                                director_boost: 0,
                                actor_boost: 0,
                                primary_boost: 0,
                                total: combinedScore
                            }
                        }
                    },
                    score: combinedScore,
                    sources: 1
                });
            }
        });
    });
    
    // Get top directors/writers - keep it minimal (only top 2 with multiple appearances)
    const topDirectors = Array.from(directorScores.values())
        .filter(d => d.count >= 2) // Only directors appearing in 2+ source items
        .sort((a, b) => b.count - a.count)
        .slice(0, 2); // Limit to top 2 directors
    
    // Get top preferred genres (sorted by score, take top genres for filtering)
    const topGenreIds = Array.from(genreScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3) // Top 3 genres only for tighter filtering
        .map(([genreId]) => genreId);
    
    // Fetch a small number of best works from top directors, filtered by preferred genres
    const directorWorkPromises = topDirectors.map(async (director) => {
        // Fetch only movies by this director (skip TV to reduce volume)
        const movieWorks = await discoverByDirector(director.id, true, topGenreIds);
        
        return {
            director,
            // Limit to top 3 works per director
            movieWorks: movieWorks.slice(0, 3)
        };
    });
    
    const directorResults = await Promise.all(directorWorkPromises);
    
    // Process director-based recommendations (supplementary, not primary)
    // Only add a few best works from favorite directors that match user's genres
    directorResults.forEach(({ director, movieWorks }) => {
        movieWorks.forEach(item => {
            const key = `${item.id}`;
            
            // Skip items already in user's collections
            if (existingMovieIds.has(key)) return;
            
            // Calculate genre match score
            let genreMatchScore = 0;
            if (item.genre_ids) {
                item.genre_ids.forEach(genreId => {
                    genreMatchScore += genreScores.get(genreId) || 0;
                });
            }
            
            // Skip director works that don't match any preferred genres
            if (genreMatchScore === 0) return;
            
            // Genre match is primary, small director boost
            const genreWeight = genreMatchScore * 5;
            const directorBoost = director.count * 3;
            const baseScore = (item.vote_average || 0) * 10;
            const popularityScore = Math.min((item.popularity || 0) / 10, 20);
            const combinedScore = baseScore + popularityScore + genreWeight + directorBoost;
            const matchedGenres = (item.genre_ids || []).filter((genreId) => (genreScores.get(genreId) || 0) > 0);
            
            const existing = allRecommendations.get(key);
            if (existing) {
                // If already recommended via similar/recommendations, give small boost
                existing.sources += 1;
                existing.score = Math.max(existing.score, combinedScore) + 10;
                const explainability = existing.item.explainability;
                if (explainability) {
                    explainability.reason_codes = addReasonCode(explainability.reason_codes, 'director_affinity');
                    explainability.source_appearances = existing.sources;
                    explainability.matched_genres = matchedGenres;
                    explainability.score_breakdown.base = baseScore;
                    explainability.score_breakdown.popularity = popularityScore;
                    explainability.score_breakdown.genre = genreWeight;
                    explainability.score_breakdown.director_boost = Math.max(
                        explainability.score_breakdown.director_boost,
                        directorBoost
                    );
                    explainability.score_breakdown.total = existing.score;
                }
            } else {
                allRecommendations.set(key, {
                    item: {
                        ...item,
                        explainability: {
                            reason_codes: ['director_affinity', 'genre_match'],
                            source_appearances: 1,
                            matched_genres: matchedGenres,
                            score_breakdown: {
                                base: baseScore,
                                popularity: popularityScore,
                                genre: genreWeight,
                                source_boost: 0,
                                director_boost: directorBoost,
                                actor_boost: 0,
                                primary_boost: 0,
                                total: combinedScore
                            }
                        }
                    },
                    score: combinedScore,
                    sources: 1
                });
            }
        });
    });
    
    // Get top actors - keep it minimal (only top 2 with multiple appearances)
    const topActors = Array.from(actorScores.values())
        .filter(a => a.count >= 2) // Only actors appearing in 2+ source items
        .sort((a, b) => b.count - a.count)
        .slice(0, 2); // Limit to top 2 actors
    
    // Fetch a small number of popular works from top actors, filtered by preferred genres
    const actorWorkPromises = topActors.map(async (actor) => {
        // Fetch only movies by this actor (skip TV to reduce volume)
        const movieWorks = await discoverByActor(actor.id, true, topGenreIds);
        
        return {
            actor,
            // Limit to top 3 works per actor
            movieWorks: movieWorks.slice(0, 3)
        };
    });
    
    const actorResults = await Promise.all(actorWorkPromises);
    
    // Process actor-based recommendations (supplementary, not primary)
    // Only add a few popular works from favorite actors that match user's genres
    actorResults.forEach(({ actor, movieWorks }) => {
        movieWorks.forEach(item => {
            const key = `${item.id}`;
            
            // Skip items already in user's collections
            if (existingMovieIds.has(key)) return;
            
            // Calculate genre match score
            let genreMatchScore = 0;
            if (item.genre_ids) {
                item.genre_ids.forEach(genreId => {
                    genreMatchScore += genreScores.get(genreId) || 0;
                });
            }
            
            // Skip actor works that don't match any preferred genres
            if (genreMatchScore === 0) return;
            
            // Genre match is primary, small actor boost
            const genreWeight = genreMatchScore * 5;
            const actorBoost = actor.count * 3;
            const baseScore = (item.vote_average || 0) * 10;
            const popularityScore = Math.min((item.popularity || 0) / 10, 20);
            const combinedScore = baseScore + popularityScore + genreWeight + actorBoost;
            const matchedGenres = (item.genre_ids || []).filter((genreId) => (genreScores.get(genreId) || 0) > 0);
            
            const existing = allRecommendations.get(key);
            if (existing) {
                // If already recommended via similar/recommendations, give small boost
                existing.sources += 1;
                existing.score = Math.max(existing.score, combinedScore) + 10;
                const explainability = existing.item.explainability;
                if (explainability) {
                    explainability.reason_codes = addReasonCode(explainability.reason_codes, 'actor_affinity');
                    explainability.source_appearances = existing.sources;
                    explainability.matched_genres = matchedGenres;
                    explainability.score_breakdown.base = baseScore;
                    explainability.score_breakdown.popularity = popularityScore;
                    explainability.score_breakdown.genre = genreWeight;
                    explainability.score_breakdown.actor_boost = Math.max(
                        explainability.score_breakdown.actor_boost,
                        actorBoost
                    );
                    explainability.score_breakdown.total = existing.score;
                }
            } else {
                allRecommendations.set(key, {
                    item: {
                        ...item,
                        explainability: {
                            reason_codes: ['actor_affinity', 'genre_match'],
                            source_appearances: 1,
                            matched_genres: matchedGenres,
                            score_breakdown: {
                                base: baseScore,
                                popularity: popularityScore,
                                genre: genreWeight,
                                source_boost: 0,
                                director_boost: 0,
                                actor_boost: actorBoost,
                                primary_boost: 0,
                                total: combinedScore
                            }
                        }
                    },
                    score: combinedScore,
                    sources: 1
                });
            }
        });
    });
    
    const allCandidates = Array.from(allRecommendations.values());
    const totalResults = allCandidates.length;
    const totalPages = Math.ceil(totalResults / limit);
    const paginatedResults = paginateTopCandidates(allCandidates, page, limit).map(r => r.item);
    
    return {
        results: paginatedResults,
        sourceCollections,
        totalSourceItems: sourceMovies.length,
        page,
        total_pages: totalPages,
        total_results: totalResults
    };
}

/**
 * Generate category-based recommendations
 * 
 * This function uses the same recommendation algorithm as the "For You" page,
 * but organizes the recommendations by genre/category.
 * 
 * Strategy:
 * 1. Build genre preference profile from user's recommendation source collections
 * 2. For each preferred genre, generate personalized recommendations
 * 3. Use TMDB discover API with genre filtering combined with:
 *    - Director preferences (from source collections)
 *    - Actor preferences (from source collections)
 *    - Base quality filters (vote count, rating)
 * 4. Score and rank items within each category
 * 5. Filter out items already in user's collections
 */
export async function generateCategoryRecommendations(
    userId: string,
    mediaType: 'movie' | 'tv' = 'movie',
    limit: number = 10
): Promise<CategoryRecommendationsResult> {
    const emptyResult: CategoryRecommendationsResult = {
        categories: [],
        mediaType,
        sourceCollections: [],
        totalSourceItems: 0
    };

    // Check if user has category recommendations enabled
    const userResult = await sql`
        SELECT category_recommendations_enabled, recommendations_enabled 
        FROM "user" WHERE id = ${userId}
    `;
    
    if (userResult.length === 0 || !userResult[0].category_recommendations_enabled) {
        return emptyResult;
    }

    // Also need base recommendations to be enabled (for source collections)
    if (!userResult[0].recommendations_enabled) {
        return emptyResult;
    }

    // Get source collections
    const sourceCollections = await getUserRecommendationCollections(userId);
    if (sourceCollections.length === 0) {
        return emptyResult;
    }

    // Get all movies from recommendation source collections
    const sourceMovies = await getMoviesFromRecommendationCollections(userId);
    if (sourceMovies.length === 0) {
        return { ...emptyResult, sourceCollections };
    }

    const sourceCollectionIds = sourceCollections.map(c => c.id);
    const existingMovieIds = await getUserExcludedMovieIdsSnapshot(userId, sourceCollectionIds);

    // Filter by media type FIRST, then sample
    const sourceItemsOfType = sourceMovies.filter(movie => {
        const { isMovie } = parseMovieId(movie.movie_id);
        return isMovie === (mediaType === 'movie');
    });

    if (sourceItemsOfType.length === 0) {
        return { ...emptyResult, sourceCollections, totalSourceItems: sourceMovies.length };
    }

    // Sample a subset to avoid rate limiting (max 15 for category recommendations to get more variety)
    const sampleSize = Math.min(sourceItemsOfType.length, 15);
    const sampledItems = sourceItemsOfType
        .sort(() => Math.random() - 0.5)
        .slice(0, sampleSize);

    // Build genre profile and collect all recommendations (same as For You page)
    const genreScores: Map<number, { id: number; name: string; count: number }> = new Map();
    const allRecommendations: Map<string, RecommendationCandidate> = new Map();
    const isMovie = mediaType === 'movie';

    // Fetch details, recommendations, and similar for each sampled source item
    const fetchPromises = sampledItems.map(async (movie) => {
        const { id, isMovie: itemIsMovie } = parseMovieId(movie.movie_id);

        const [details, recommendations, similar] = await Promise.all([
            getItemDetails(id, itemIsMovie),
            getRecommendationsForItem(id, itemIsMovie),
            getSimilarForItem(id, itemIsMovie)
        ]);

        // Build genre profile with names
        if (details?.genres) {
            details.genres.forEach(genre => {
                const existing = genreScores.get(genre.id);
                if (existing) {
                    existing.count += 1;
                } else {
                    genreScores.set(genre.id, { id: genre.id, name: genre.name, count: 1 });
                }
            });
        }

        return { recommendations, similar };
    });

    const results = await Promise.all(fetchPromises);

    // Process all recommendations from TMDB recommendations/similar (same scoring as For You)
    results.forEach(({ recommendations, similar }) => {
        const allItems = [...recommendations, ...similar];
        
        allItems.forEach(item => {
            // Create a unique key for deduplication
            const key = isMovie ? `${item.id}` : `${item.id}tv`;
            
            // Skip items already in user's collections
            if (existingMovieIds.has(key)) return;
            
            // Calculate genre match score
            let genreMatchScore = 0;
            if (item.genre_ids) {
                item.genre_ids.forEach(genreId => {
                    const genreInfo = genreScores.get(genreId);
                    genreMatchScore += genreInfo?.count || 0;
                });
            }
            
            // Calculate combined score (same as For You)
            const baseScore = (item.vote_average || 0) * 10;
            const popularityScore = Math.min((item.popularity || 0) / 10, 50);
            const genreBoost = genreMatchScore * 5;
            const combinedScore = baseScore + popularityScore + genreBoost;
            const matchedGenres = (item.genre_ids || []).filter((genreId) => (genreScores.get(genreId)?.count || 0) > 0);
            
            const existing = allRecommendations.get(key);
            if (existing) {
                // Item appeared from multiple sources - boost its score
                existing.sources += 1;
                const sourceBoost = existing.sources * 20;
                existing.score = combinedScore + sourceBoost;
                const explainability = existing.item.explainability;
                if (explainability) {
                    explainability.source_appearances = existing.sources;
                    explainability.matched_genres = matchedGenres;
                    explainability.score_breakdown.base = baseScore;
                    explainability.score_breakdown.popularity = popularityScore;
                    explainability.score_breakdown.genre = genreBoost;
                    explainability.score_breakdown.source_boost = sourceBoost;
                    explainability.score_breakdown.total = existing.score;
                }
            } else {
                allRecommendations.set(key, {
                    item: {
                        ...item,
                        explainability: {
                            reason_codes: matchedGenres.length > 0
                                ? ['tmdb_recommendation_or_similar', 'genre_match', 'category_match']
                                : ['tmdb_recommendation_or_similar', 'category_match'],
                            source_appearances: 1,
                            matched_genres: matchedGenres,
                            score_breakdown: {
                                base: baseScore,
                                popularity: popularityScore,
                                genre: genreBoost,
                                source_boost: 0,
                                director_boost: 0,
                                actor_boost: 0,
                                primary_boost: 0,
                                total: combinedScore
                            }
                        }
                    },
                    score: combinedScore,
                    sources: 1
                });
            }
        });
    });

    // Sort genres by preference score (how often they appear in user's collections)
    const sortedGenres = Array.from(genreScores.values())
        .sort((a, b) => b.count - a.count);

    if (sortedGenres.length === 0) {
        return { ...emptyResult, sourceCollections, totalSourceItems: sourceMovies.length };
    }

    // Group recommendations by genre
    const categories: CategoryRecommendation[] = [];

    for (const genre of sortedGenres) {
        // Filter recommendations that have this genre
        const genreRecommendations = Array.from(allRecommendations.values())
            .filter(rec => rec.item.genre_ids?.includes(genre.id))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(rec => rec.item);

        if (genreRecommendations.length > 0) {
            categories.push({
                genre: { id: genre.id, name: genre.name },
                results: genreRecommendations,
                total_results: genreRecommendations.length
            });
        }
    }

    return {
        categories,
        mediaType,
        sourceCollections,
        totalSourceItems: sourceMovies.length
    };
}

/**
 * Add a collection to user's recommendation sources
 */
export async function addRecommendationCollection(
    userId: string,
    collectionId: string
): Promise<boolean> {
    try {
        // Verify user has access to this collection
        const collectionCheck = await sql`
            SELECT id FROM collections 
            WHERE id = ${collectionId} 
            AND (owner_id = ${userId} OR id IN (
                SELECT collection_id FROM collection_collaborators WHERE user_id = ${userId}
            ))
        `;
        
        if (collectionCheck.length === 0) {
            return false;
        }
        
        // Add to recommendation collections
        await sql`
            INSERT INTO user_recommendation_collections (id, user_id, collection_id, added_at)
            VALUES (gen_random_uuid()::text, ${userId}, ${collectionId}, NOW())
            ON CONFLICT (user_id, collection_id) DO NOTHING
        `;

        await invalidateRecommendationCache(userId);
        
        return true;
    } catch (error) {
        console.error("Error adding recommendation collection:", error);
        return false;
    }
}

/**
 * Remove a collection from user's recommendation sources
 */
export async function removeRecommendationCollection(
    userId: string,
    collectionId: string
): Promise<boolean> {
    try {
        await sql`
            DELETE FROM user_recommendation_collections
            WHERE user_id = ${userId} AND collection_id = ${collectionId}
        `;

        await invalidateRecommendationCache(userId);

        return true;
    } catch (error) {
        console.error("Error removing recommendation collection:", error);
        return false;
    }
}

/**
 * Generate paginated recommendations for a specific genre
 * 
 * Hybrid approach:
 * 1. Primary: Use "For You" algorithm - fetch recommendations/similar from source items, filter by genre
 * 2. Supplement: Use TMDB discover API for additional results, scored by user preferences
 * 
 * This ensures we have enough results for infinite scroll while keeping personalization
 */
export async function generateGenreRecommendations(
    userId: string,
    genreId: number,
    mediaType: 'movie' | 'tv' = 'movie',
    limit: number = 20,
    page: number = 1
): Promise<{
    results: TMDBMovie[];
    page: number;
    total_pages: number;
    total_results: number;
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
}> {
    const emptyResult = {
        results: [],
        page: 1,
        total_pages: 0,
        total_results: 0,
        sourceCollections: [] as { id: string; name: string }[],
        totalSourceItems: 0
    };

    // Check if user has category recommendations enabled
    const userResult = await sql`
        SELECT category_recommendations_enabled, recommendations_enabled 
        FROM "user" WHERE id = ${userId}
    `;
    
    if (userResult.length === 0 || !userResult[0].category_recommendations_enabled) {
        return emptyResult;
    }

    if (!userResult[0].recommendations_enabled) {
        return emptyResult;
    }

    // Get source collections
    const sourceCollections = await getUserRecommendationCollections(userId);
    if (sourceCollections.length === 0) {
        return emptyResult;
    }

    // Get all movies from recommendation source collections
    const sourceMovies = await getMoviesFromRecommendationCollections(userId);
    if (sourceMovies.length === 0) {
        return { ...emptyResult, sourceCollections };
    }

    const sourceCollectionIds = sourceCollections.map(c => c.id);
    const existingMovieIds = await getUserExcludedMovieIdsSnapshot(userId, sourceCollectionIds);

    // Filter by media type FIRST
    const sourceItemsOfType = sourceMovies.filter(movie => {
        const { isMovie } = parseMovieId(movie.movie_id);
        return isMovie === (mediaType === 'movie');
    });

    if (sourceItemsOfType.length === 0) {
        return { ...emptyResult, sourceCollections, totalSourceItems: sourceMovies.length };
    }

    // Use all source items for genre-specific recommendations (up to 20) to get more results
    const sampleSize = Math.min(sourceItemsOfType.length, 20);
    const sampledItems = sourceItemsOfType
        .sort(() => Math.random() - 0.5)
        .slice(0, sampleSize);

    const isMovie = mediaType === 'movie';
    const mediaEndpoint = isMovie ? 'movie' : 'tv';
    const genreScores: Map<number, number> = new Map();
    const allRecommendations: Map<string, RecommendationCandidate> = new Map();

    // STEP 1: Fetch recommendations/similar from source items (primary personalized results)
    const fetchPromises = sampledItems.map(async (movie) => {
        const { id, isMovie: itemIsMovie } = parseMovieId(movie.movie_id);

        const [details, recommendations, similar] = await Promise.all([
            getItemDetails(id, itemIsMovie),
            getRecommendationsForItem(id, itemIsMovie),
            getSimilarForItem(id, itemIsMovie)
        ]);

        // Build genre profile
        if (details?.genres) {
            details.genres.forEach(genre => {
                genreScores.set(genre.id, (genreScores.get(genre.id) || 0) + 1);
            });
        }

        return { recommendations, similar };
    });

    const results = await Promise.all(fetchPromises);

    // Process primary recommendations (from source items)
    results.forEach(({ recommendations, similar }) => {
        const allItems = [...recommendations, ...similar];
        
        allItems.forEach(item => {
            // Only include items that have the requested genre
            if (!item.genre_ids?.includes(genreId)) return;

            const key = isMovie ? `${item.id}` : `${item.id}tv`;
            if (existingMovieIds.has(key)) return;
            
            let genreMatchScore = 0;
            if (item.genre_ids) {
                item.genre_ids.forEach(gId => {
                    genreMatchScore += genreScores.get(gId) || 0;
                });
            }
            
            // Primary recommendations get a boost
            const baseScore = (item.vote_average || 0) * 10;
            const popularityScore = Math.min((item.popularity || 0) / 10, 50);
            const primaryBoost = 100; // Boost for being from recommendations/similar
            const genreBoost = genreMatchScore * 5;
            const combinedScore = baseScore + popularityScore + genreBoost + primaryBoost;
            const matchedGenres = (item.genre_ids || []).filter((gId) => (genreScores.get(gId) || 0) > 0);
            
            const existing = allRecommendations.get(key);
            if (existing) {
                existing.sources += 1;
                const sourceBoost = existing.sources * 20;
                existing.score = combinedScore + sourceBoost;
                const explainability = existing.item.explainability;
                if (explainability) {
                    explainability.reason_codes = addReasonCode(explainability.reason_codes, 'genre_match');
                    explainability.source_appearances = existing.sources;
                    explainability.matched_genres = matchedGenres;
                    explainability.score_breakdown.base = baseScore;
                    explainability.score_breakdown.popularity = popularityScore;
                    explainability.score_breakdown.genre = genreBoost;
                    explainability.score_breakdown.source_boost = sourceBoost;
                    explainability.score_breakdown.primary_boost = primaryBoost;
                    explainability.score_breakdown.total = existing.score;
                }
            } else {
                allRecommendations.set(key, {
                    item: {
                        ...item,
                        explainability: {
                            reason_codes: ['genre_specific_request', 'tmdb_recommendation_or_similar', 'genre_match'],
                            source_appearances: 1,
                            matched_genres: matchedGenres,
                            score_breakdown: {
                                base: baseScore,
                                popularity: popularityScore,
                                genre: genreBoost,
                                source_boost: 0,
                                director_boost: 0,
                                actor_boost: 0,
                                primary_boost: primaryBoost,
                                total: combinedScore
                            }
                        }
                    },
                    score: combinedScore,
                    sources: 1
                });
            }
        });
    });

    // STEP 2: Supplement with TMDB discover API results for more variety
    // Calculate how many pages we need from discover to fill the request
    const primaryCount = allRecommendations.size;
    const resultsNeeded = page * limit;
    const discoverPagesNeeded = Math.max(1, Math.ceil((resultsNeeded - primaryCount + limit) / 20));
    
    // Fetch discover results
    const discoverPromises = Array.from({ length: Math.min(discoverPagesNeeded, 10) }, (_, i) => i + 1).map(async (tmdbPage) => {
        const params: Record<string, string> = {
            with_genres: genreId.toString(),
            sort_by: 'vote_average.desc',
            'vote_count.gte': '100',
            'vote_average.gte': '6.0',
            page: tmdbPage.toString()
        };

        const response = await fetchTMDB<TMDBDiscoverResponse>(
            `/discover/${mediaEndpoint}`,
            params
        );
        return {
            results: response?.results || [],
            total_pages: response?.total_pages || 0,
            total_results: response?.total_results || 0
        };
    });

    const discoverResults = await Promise.all(discoverPromises);
    const discoverItems = discoverResults.flatMap(r => r.results);
    const discoverTotalResults = discoverResults[0]?.total_results || 0;

    // Add discover results (secondary, lower priority than primary)
    for (const item of discoverItems) {
        const key = isMovie ? `${item.id}` : `${item.id}tv`;
        
        // Skip if already in collections or already added from primary
        if (existingMovieIds.has(key)) continue;
        if (allRecommendations.has(key)) continue;

        let genreMatchScore = 0;
        if (item.genre_ids) {
            item.genre_ids.forEach(gId => {
                genreMatchScore += genreScores.get(gId) || 0;
            });
        }

        // Secondary results don't get the primary boost
        const baseScore = (item.vote_average || 0) * 10;
        const popularityScore = Math.min((item.popularity || 0) / 10, 50);
        const genreBoost = genreMatchScore * 5;
        const combinedScore = baseScore + popularityScore + genreBoost;
        const matchedGenres = (item.genre_ids || []).filter((gId) => (genreScores.get(gId) || 0) > 0);

        allRecommendations.set(key, {
            item: {
                ...item,
                explainability: {
                    reason_codes: ['genre_specific_request', 'discover_supplement'],
                    source_appearances: 0,
                    matched_genres: matchedGenres,
                    score_breakdown: {
                        base: baseScore,
                        popularity: popularityScore,
                        genre: genreBoost,
                        source_boost: 0,
                        director_boost: 0,
                        actor_boost: 0,
                        primary_boost: 0,
                        total: combinedScore
                    }
                }
            },
            score: combinedScore,
            sources: 0
        });
    }

    const allCandidates = Array.from(allRecommendations.values());

    // Estimate total - use discover total as baseline since it's larger
    const estimatedTotal = Math.max(allCandidates.length, discoverTotalResults);
    const totalPages = Math.ceil(estimatedTotal / limit);
    const paginatedResults = paginateTopCandidates(allCandidates, page, limit).map(r => r.item);

    return {
        results: paginatedResults,
        page,
        total_pages: totalPages,
        total_results: estimatedTotal,
        sourceCollections,
        totalSourceItems: sourceMovies.length
    };
}

/**
 * Generate personalized theatrical releases (now playing movies)
 * Scores and sorts based on user preferences
 */
export async function generatePersonalizedTheatricalReleases(
    userId: string,
    limit: number = 20,
    page: number = 1
): Promise<{
    results: TMDBMovie[];
    page: number;
    total_pages: number;
    total_results: number;
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
}> {
    const emptyResult = {
        results: [],
        page: 1,
        total_pages: 0,
        total_results: 0,
        sourceCollections: [] as { id: string; name: string }[],
        totalSourceItems: 0
    };

    // Check if user has recommendations enabled
    const userResult = await sql`
        SELECT category_recommendations_enabled, recommendations_enabled 
        FROM "user" WHERE id = ${userId}
    `;
    
    if (userResult.length === 0 || !userResult[0].category_recommendations_enabled) {
        return emptyResult;
    }

    if (!userResult[0].recommendations_enabled) {
        return emptyResult;
    }

    // Get source collections
    const sourceCollections = await getUserRecommendationCollections(userId);
    if (sourceCollections.length === 0) {
        return emptyResult;
    }

    // Get all movies from recommendation source collections
    const sourceMovies = await getMoviesFromRecommendationCollections(userId);
    if (sourceMovies.length === 0) {
        return { ...emptyResult, sourceCollections };
    }

    const sourceCollectionIds = sourceCollections.map(c => c.id);
    const existingMovieIds = await getUserExcludedMovieIdsSnapshot(userId, sourceCollectionIds);

    // Build genre preference profile from source items (movies only for theatrical)
    const genreScores: Map<number, number> = new Map();
    const directorScores: Map<number, DirectorInfo> = new Map();
    const actorScores: Map<number, ActorInfo> = new Map();

    // Filter to movies only
    const sourceMoviesOnly = sourceMovies.filter(movie => {
        const { isMovie } = parseMovieId(movie.movie_id);
        return isMovie;
    });

    // Sample a subset to avoid rate limiting
    const sampleSize = Math.min(sourceMoviesOnly.length, 10);
    const sampledItems = sourceMoviesOnly
        .sort(() => Math.random() - 0.5)
        .slice(0, sampleSize);

    // Fetch details and credits for each sampled source item
    const fetchPromises = sampledItems.map(async (movie) => {
        const { id, isMovie } = parseMovieId(movie.movie_id);

        const [details, credits] = await Promise.all([
            getItemDetails(id, isMovie),
            getItemCredits(id, isMovie)
        ]);

        if (details?.genres) {
            details.genres.forEach(genre => {
                genreScores.set(genre.id, (genreScores.get(genre.id) || 0) + 1);
            });
        }

        // Build director profile
        const directors = extractDirectors(credits, isMovie);
        directors.forEach(director => {
            const existing = directorScores.get(director.id);
            if (existing) {
                existing.count += 1;
            } else {
                directorScores.set(director.id, {
                    id: director.id,
                    name: director.name,
                    count: 1
                });
            }
        });

        // Build actor profile
        const topCast = extractTopCast(credits);
        topCast.forEach(actor => {
            const existing = actorScores.get(actor.id);
            if (existing) {
                existing.count += 1;
            } else {
                actorScores.set(actor.id, {
                    id: actor.id,
                    name: actor.name,
                    count: 1
                });
            }
        });
    });

    await Promise.all(fetchPromises);

    // Get top directors and actors
    const topDirectorIds = new Set(
        Array.from(directorScores.values())
            .filter(d => d.count >= 2)
            .map(d => d.id)
    );
    const topActorIds = new Set(
        Array.from(actorScores.values())
            .filter(a => a.count >= 2)
            .map(a => a.id)
    );

    // Calculate how many TMDB pages we need to fetch
    const resultsNeeded = page * limit;
    const tmdbPagesToFetch = Math.max(3, Math.ceil((resultsNeeded * 2) / 20));

    // Fetch now playing movies from TMDB (multiple pages)
    const pagePromises = Array.from({ length: tmdbPagesToFetch }, (_, i) => i + 1).map(async (tmdbPage) => {
        const response = await fetchTMDB<TMDBDiscoverResponse>(
            '/movie/now_playing',
            { page: tmdbPage.toString() }
        );
        return {
            results: response?.results || [],
            total_pages: response?.total_pages || 0,
            total_results: response?.total_results || 0
        };
    });

    const pageResults = await Promise.all(pagePromises);
    const allResults = pageResults.flatMap(p => p.results);
    const tmdbTotalPages = pageResults[0]?.total_pages || 0;
    const tmdbTotalResults = pageResults[0]?.total_results || 0;

    // For each now playing movie, score and optionally fetch credits for director/actor matching
    const scoredResults: RecommendationCandidate[] = [];
    const seenIds = new Set<number>();

    // Score results - batch credit fetches for efficiency
    const creditPromises = allResults.map(async (item) => {
        // Skip duplicates
        if (seenIds.has(item.id)) return null;
        seenIds.add(item.id);

        const key = `${item.id}`;
        
        // Skip items already in user's collections
        if (existingMovieIds.has(key)) return null;

        // Base score
        const baseScore = (item.vote_average || 0) * 10;
        const popularityScore = Math.min((item.popularity || 0) / 10, 30);
        let score = baseScore + popularityScore;
        let genreBoost = 0;
        let directorBoost = 0;
        let actorBoost = 0;
        const matchedGenres = (item.genre_ids || []).filter((genreId) => (genreScores.get(genreId) || 0) > 0);

        // Genre match boost
        if (item.genre_ids) {
            item.genre_ids.forEach(genreId => {
                const boost = (genreScores.get(genreId) || 0) * 5;
                genreBoost += boost;
                score += boost;
            });
        }

        // Fetch credits for director/actor matching (optional, but improves personalization)
        if (topDirectorIds.size > 0 || topActorIds.size > 0) {
            const credits = await getItemCredits(item.id, true);
            
            // Director match boost
            const directors = extractDirectors(credits, true);
            directors.forEach(director => {
                if (topDirectorIds.has(director.id)) {
                    const dirInfo = directorScores.get(director.id);
                    const boost = (dirInfo?.count || 1) * 10;
                    directorBoost += boost;
                    score += boost;
                }
            });

            // Actor match boost
            const cast = extractTopCast(credits);
            cast.forEach(actor => {
                if (topActorIds.has(actor.id)) {
                    const actorInfo = actorScores.get(actor.id);
                    const boost = (actorInfo?.count || 1) * 5;
                    actorBoost += boost;
                    score += boost;
                }
            });
        }

        const reasonCodes = ['theatrical_now_playing'];
        if (matchedGenres.length > 0) {
            reasonCodes.push('genre_match');
        }
        if (directorBoost > 0) {
            reasonCodes.push('director_affinity');
        }
        if (actorBoost > 0) {
            reasonCodes.push('actor_affinity');
        }

        return {
            item: {
                ...item,
                explainability: {
                    reason_codes: reasonCodes,
                    source_appearances: 0,
                    matched_genres: matchedGenres,
                    score_breakdown: {
                        base: baseScore,
                        popularity: popularityScore,
                        genre: genreBoost,
                        source_boost: 0,
                        director_boost: directorBoost,
                        actor_boost: actorBoost,
                        primary_boost: 0,
                        total: score
                    }
                }
            },
            score,
            sources: 0
        };
    });

    const creditResults = await Promise.all(creditPromises);
    
    for (const result of creditResults) {
        if (result) {
            scoredResults.push(result);
        }
    }

    // Estimate total results based on TMDB total and our filtering ratio
    const filterRatio = allResults.length > 0 ? scoredResults.length / allResults.length : 1;
    const estimatedTotalResults = Math.floor(tmdbTotalResults * filterRatio);
    const totalPages = Math.min(Math.ceil(estimatedTotalResults / limit), tmdbTotalPages);
    const paginatedResults = paginateTopCandidates(scoredResults, page, limit).map(r => r.item);

    return {
        results: paginatedResults,
        page,
        total_pages: totalPages,
        total_results: estimatedTotalResults,
        sourceCollections,
        totalSourceItems: sourceMovies.length
    };
}

/**
 * Set recommendation collections (replace all)
 */
export async function setRecommendationCollections(
    userId: string,
    collectionIds: string[]
): Promise<boolean> {
    try {
        // Verify user has access to all collections
        if (collectionIds.length > 0) {
            const collectionCheck = await sql`
                SELECT id FROM collections 
                WHERE id = ANY(${collectionIds})
                AND (owner_id = ${userId} OR id IN (
                    SELECT collection_id FROM collection_collaborators WHERE user_id = ${userId}
                ))
            `;
            
            if (collectionCheck.length !== collectionIds.length) {
                return false;
            }
        }
        
        // Remove all existing recommendation collections
        await sql`
            DELETE FROM user_recommendation_collections
            WHERE user_id = ${userId}
        `;
        
        // Add new ones
        for (const collectionId of collectionIds) {
            await sql`
                INSERT INTO user_recommendation_collections (id, user_id, collection_id, added_at)
                VALUES (gen_random_uuid()::text, ${userId}, ${collectionId}, NOW())
            `;
        }

        await invalidateRecommendationCache(userId);
        
        return true;
    } catch (error) {
        console.error("Error setting recommendation collections:", error);
        return false;
    }
}

export async function generateRecommendationsCached(
    userId: string,
    limit: number = 20,
    page: number = 1
): Promise<RecommendationResult> {
    return getCachedRecommendationResult(
        userId,
        'for_you',
        { limit, page },
        () => generateRecommendations(userId, limit, page)
    );
}

export async function generateCategoryRecommendationsCached(
    userId: string,
    mediaType: 'movie' | 'tv' = 'movie',
    limit: number = 10
): Promise<CategoryRecommendationsResult> {
    return getCachedRecommendationResult(
        userId,
        'categories',
        { mediaType, limit },
        () => generateCategoryRecommendations(userId, mediaType, limit)
    );
}

export async function generateGenreRecommendationsCached(
    userId: string,
    genreId: number,
    mediaType: 'movie' | 'tv' = 'movie',
    limit: number = 20,
    page: number = 1
): Promise<{
    results: TMDBMovie[];
    page: number;
    total_pages: number;
    total_results: number;
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
}> {
    return getCachedRecommendationResult(
        userId,
        'genre',
        { genreId, mediaType, limit, page },
        () => generateGenreRecommendations(userId, genreId, mediaType, limit, page)
    );
}

export async function generatePersonalizedTheatricalReleasesCached(
    userId: string,
    limit: number = 20,
    page: number = 1
): Promise<{
    results: TMDBMovie[];
    page: number;
    total_pages: number;
    total_results: number;
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
}> {
    return getCachedRecommendationResult(
        userId,
        'theatrical',
        { limit, page },
        () => generatePersonalizedTheatricalReleases(userId, limit, page)
    );
}
