import { sql } from '../lib/db.js';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getRedditRecommendations, getRedditPrimaryCandidates, type RedditPrimaryCandidate } from './redditService.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = process.env.TMDB_BASE_URL;

// Per-request context: carries the caller's `show_adult_items` preference through
// the deep call tree so `fetchTMDB` can enforce `include_adult` without
// threading a boolean through every internal helper.
interface RecommendationContext {
    includeAdult: boolean;
}
const recommendationContext = new AsyncLocalStorage<RecommendationContext>();

async function resolveShowAdultItems(userId: string): Promise<boolean> {
    try {
        const result = await sql`SELECT show_adult_items FROM "user" WHERE id = ${userId}`;
        if (result.length === 0) return false;
        return result[0].show_adult_items ?? false;
    } catch (error) {
        console.error('[recommendationService] failed to resolve show_adult_items:', error);
        return false;
    }
}

async function withRecommendationContext<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const includeAdult = await resolveShowAdultItems(userId);
    console.log(`[adult-filter] recommendation run user=${userId} includeAdult=${includeAdult}`);
    return recommendationContext.run({ includeAdult }, fn);
}

const getIncludeAdult = (): boolean => recommendationContext.getStore()?.includeAdult ?? false;

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
    retrieval_channels?: RetrievalChannel[];
    reddit_mentions?: number; // Number of Reddit mentions
    reddit_sentiment?: 'positive' | 'neutral' | 'negative'; // Reddit sentiment
    stage_scores?: {
        retrieval: number;
        ranking: number;
        rerank: number;
        bandit: number;
        final: number;
        ctr: number;
        cvr: number;
        engagement: number;
        uncertainty: number;
    };
    score_breakdown: {
        base: number;
        popularity: number;
        genre: number;
        source_boost: number;
        director_boost: number;
        actor_boost: number;
        primary_boost: number;
        reddit_boost: number; // Reddit popularity boost
        novelty_boost?: number;
        freshness_boost?: number;
        diversity_boost?: number;
        bandit_boost?: number;
        total: number;
    };
}

type RetrievalChannel =
    | 'tmdb_graph'
    | 'director_discover'
    | 'actor_discover'
    | 'discover_supplement'
    | 'trending_explore'
    | 'cold_start_seed'
    | 'reddit_signal'
    | 'reddit_primary';

interface RecommendationCandidate {
    item: TMDBMovie;
    score: number;
    sources: number;
}

interface UserEngagementSignals {
    watchedCount: number;
    notInterestedCount: number;
    watchRate: number;
    explorationRate: number;
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

const RECOMMENDATION_CACHE_VERSION = 'v6';
const RECOMMENDATION_CACHE_TTL_MINUTES = 30;
const RECOMMENDATION_CACHE_EXPIRED_RETENTION_MINUTES = 60 * 24;
const RECOMMENDATION_CACHE_CLEANUP_INTERVAL_MS = 1000 * 60 * 15;
const recommendationCacheLocks = new Map<string, Promise<void>>();
let lastRecommendationCacheCleanupAt = 0;
let recommendationCacheCleanupPromise: Promise<void> | null = null;

// Reddit boost configuration
const REDDIT_BOOST_ENABLED = true;
const REDDIT_BOOST_MULTIPLIER = 30; // Points per mention
const REDDIT_POSITIVE_SENTIMENT_BONUS = 20;
const CATEGORY_FOR_YOU_POOL_MIN = 240;
const CATEGORY_FOR_YOU_POOL_MAX = 500;
const MIN_THEATRICAL_TMDB_PAGES_TO_FETCH = 3;
const MAX_THEATRICAL_TMDB_PAGES_TO_FETCH = 12;

const WATCHED_COLLECTION_NAME = '__watched__';
const NOT_INTERESTED_COLLECTION_NAME = '__not_interested__';

/**
 * Fetch Reddit recommendations and create a lookup map by TMDB ID
 * Returns a map where key is tmdbId and value contains mention info
 * 
 * Note: Reddit data is scraped at build time (see scripts/scrapeReddit.mjs)
 * This function simply loads the pre-scraped data from the database.
 */
async function getRedditBoostMap(): Promise<Map<string, { mentions: number; sentiment: string | null; totalScore: number }>> {
    const boostMap = new Map<string, { mentions: number; sentiment: string | null; totalScore: number }>();
    
    if (!REDDIT_BOOST_ENABLED) {
        return boostMap;
    }

    try {
        const redditRecs = await getRedditRecommendations({
            minMentions: 1,
            limit: 5000,
            onlyWithTmdb: true,
        });

        for (const rec of redditRecs) {
            if (rec.tmdbId) {
                boostMap.set(rec.tmdbId, {
                    mentions: rec.mentionCount,
                    sentiment: rec.sentiment,
                    totalScore: rec.totalScore,
                });
            }
        }

        console.log(`Loaded ${boostMap.size} Reddit recommendations for boosting`);
    } catch (error) {
        console.error('Error loading Reddit recommendations for boosting:', error);
    }

    return boostMap;
}

/**
 * Calculate Reddit boost score for a given TMDB ID
 */
function calculateRedditBoost(
    tmdbId: string,
    redditBoostMap: Map<string, { mentions: number; sentiment: string | null; totalScore: number }>
): { boost: number; mentions: number; sentiment: string | null } {
    const redditData = redditBoostMap.get(tmdbId);
    
    if (!redditData) {
        return { boost: 0, mentions: 0, sentiment: null };
    }

    let boost = redditData.mentions * REDDIT_BOOST_MULTIPLIER;
    
    // Extra boost for positive sentiment
    if (redditData.sentiment === 'positive') {
        boost += REDDIT_POSITIVE_SENTIMENT_BONUS;
    }
    
    // Cap boost at a reasonable max to avoid overwhelming other signals
    boost = Math.min(boost, 200);

    return {
        boost,
        mentions: redditData.mentions,
        sentiment: redditData.sentiment,
    };
}

/**
 * Apply Reddit boosts to a list of recommendation candidates
 */
function applyRedditBoosts(
    candidates: RecommendationCandidate[],
    redditBoostMap: Map<string, { mentions: number; sentiment: string | null; totalScore: number }>
): RecommendationCandidate[] {
    return candidates.map(candidate => {
        const tmdbId = candidate.item.id.toString();
        const { boost, mentions, sentiment } = calculateRedditBoost(tmdbId, redditBoostMap);

        if (boost > 0) {
            const explainability = candidate.item.explainability;
            if (explainability) {
                explainability.reddit_mentions = mentions;
                explainability.reddit_sentiment = sentiment as 'positive' | 'neutral' | 'negative' | undefined;
                explainability.score_breakdown.reddit_boost = boost;
                explainability.score_breakdown.total += boost;
                explainability.retrieval_channels = addRetrievalChannel(
                    explainability.retrieval_channels,
                    'reddit_signal'
                );
                
                // Add reason code if not already present
                if (!explainability.reason_codes.includes('reddit_popular')) {
                    explainability.reason_codes.push('reddit_popular');
                }
            }
            
            return {
                ...candidate,
                score: candidate.score + boost,
            };
        }
        
        return candidate;
    });
}

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

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function safeNumber(value: number | undefined | null): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 0;
    }

    return value;
}

function logNormalize(value: number | undefined, maxReference: number): number {
    if (!value || value <= 0 || maxReference <= 0) {
        return 0;
    }

    return clamp(Math.log1p(value) / Math.log1p(maxReference), 0, 1);
}

function hashToUnitInterval(seed: string): number {
    const hashPrefix = createHash('sha256').update(seed).digest('hex').slice(0, 8);
    const parsed = Number.parseInt(hashPrefix, 16);

    if (Number.isNaN(parsed)) {
        return 0;
    }

    return parsed / 0xffffffff;
}

function deterministicSample<T>(
    values: T[],
    sampleSize: number,
    seed: string,
    keyFn: (value: T) => string
): T[] {
    if (sampleSize <= 0 || values.length === 0) {
        return [];
    }

    if (values.length <= sampleSize) {
        return [...values];
    }

    return [...values]
        .sort((a, b) => {
            const scoreA = hashToUnitInterval(`${seed}:${keyFn(a)}`);
            const scoreB = hashToUnitInterval(`${seed}:${keyFn(b)}`);

            if (scoreA === scoreB) {
                return keyFn(a).localeCompare(keyFn(b));
            }

            return scoreA - scoreB;
        })
        .slice(0, sampleSize);
}

function getReleaseYear(item: TMDBMovie): number | null {
    const rawDate = item.release_date || item.first_air_date;
    if (!rawDate) {
        return null;
    }

    const parsedYear = Number.parseInt(rawDate.slice(0, 4), 10);
    return Number.isNaN(parsedYear) ? null : parsedYear;
}

function getFreshnessScore(item: TMDBMovie): number {
    const releaseYear = getReleaseYear(item);
    if (!releaseYear) {
        return 0.35;
    }

    const currentYear = new Date().getUTCFullYear();
    const age = Math.max(currentYear - releaseYear, 0);

    if (age <= 1) {
        return 1;
    }

    if (age <= 3) {
        return 0.85;
    }

    if (age <= 8) {
        return 0.6;
    }

    if (age <= 15) {
        return 0.35;
    }

    return 0.2;
}

function getCandidateKey(candidate: RecommendationCandidate): string {
    const isTv = candidate.item.media_type === 'tv' || (!!candidate.item.first_air_date && !candidate.item.release_date);
    return isTv ? `${candidate.item.id}tv` : `${candidate.item.id}`;
}

function getPrimaryGenre(item: TMDBMovie): number | null {
    if (!item.genre_ids || item.genre_ids.length === 0) {
        return null;
    }

    return item.genre_ids[0] ?? null;
}

function getItemMediaType(item: TMDBMovie): 'movie' | 'tv' {
    const isTv = item.media_type === 'tv' || (!!item.first_air_date && !item.release_date);
    return isTv ? 'tv' : 'movie';
}

async function getGenreNameMap(mediaType: 'movie' | 'tv'): Promise<Map<number, string>> {
    const response = await fetchTMDB<{ genres: Genre[] }>(`/genre/${mediaType}/list`);
    return new Map((response?.genres || []).map((genre) => [genre.id, genre.name]));
}

function addRetrievalChannel(channels: RetrievalChannel[] | undefined, channel: RetrievalChannel): RetrievalChannel[] {
    if (!channels) {
        return [channel];
    }

    if (channels.includes(channel)) {
        return channels;
    }

    return [...channels, channel];
}

function inferRetrievalChannels(reasonCodes: string[]): RetrievalChannel[] {
    const channels: RetrievalChannel[] = [];

    for (const reason of reasonCodes) {
        if (reason === 'tmdb_recommendation_or_similar') {
            channels.push('tmdb_graph');
        } else if (reason === 'director_affinity') {
            channels.push('director_discover');
        } else if (reason === 'actor_affinity') {
            channels.push('actor_discover');
        } else if (reason === 'discover_supplement') {
            channels.push('discover_supplement');
        } else if (reason === 'cold_start_trending') {
            channels.push('trending_explore');
        } else if (reason === 'cold_start_seeded') {
            channels.push('cold_start_seed');
        } else if (reason === 'reddit_popular') {
            channels.push('reddit_signal');
        }
    }

    if (channels.length === 0) {
        channels.push('tmdb_graph');
    }

    return Array.from(new Set(channels));
}

function getCandidateArm(candidate: RecommendationCandidate): RetrievalChannel {
    const reasonCodes = candidate.item.explainability?.reason_codes || [];
    const channels = inferRetrievalChannels(reasonCodes);

    return channels[0] ?? 'tmdb_graph';
}

function computeUncertaintyScore(candidate: RecommendationCandidate): number {
    const voteCountNorm = logNormalize(candidate.item.vote_count, 12000);
    const popularityNorm = logNormalize(candidate.item.popularity, 600);
    const sourceNorm = clamp(candidate.sources / 5, 0, 1);

    return clamp((1 - voteCountNorm) * 0.45 + (1 - popularityNorm) * 0.35 + (1 - sourceNorm) * 0.2, 0, 1);
}

function paginateOrderedCandidates(
    candidates: RecommendationCandidate[],
    page: number,
    limit: number
): RecommendationCandidate[] {
    if (limit <= 0 || page <= 0 || candidates.length === 0) {
        return [];
    }

    const startIndex = (page - 1) * limit;
    if (startIndex >= candidates.length) {
        return [];
    }

    return candidates.slice(startIndex, startIndex + limit);
}

function buildStringToken(values: string[]): string {
    if (values.length === 0) {
        return 'empty';
    }

    const normalized = Array.from(new Set(values)).sort();
    return createHash('sha256').update(normalized.join('|')).digest('hex').slice(0, 20);
}

function buildCollectionMovieToken(items: CollectionMovie[]): string {
    return buildStringToken(items.map((item) => item.movie_id));
}

function applyProfileJitter(
    candidates: RecommendationCandidate[],
    profileToken: string,
    magnitude: number = 4
): RecommendationCandidate[] {
    if (candidates.length <= 1 || magnitude <= 0) {
        return candidates;
    }

    return candidates
        .map((candidate) => {
            const key = getCandidateKey(candidate);
            const jitterBase = (hashToUnitInterval(`${profileToken}:${key}`) - 0.5) * 2;
            const uncertainty = computeUncertaintyScore(candidate);
            const jitter = jitterBase * magnitude * (0.35 + uncertainty * 0.65);
            const updatedScore = candidate.score + jitter;

            const explainability = candidate.item.explainability;
            if (explainability) {
                explainability.reason_codes = addReasonCode(explainability.reason_codes, 'profile_shuffle');
                explainability.score_breakdown.total = updatedScore;
                const stageScores = explainability.stage_scores;
                if (stageScores) {
                    stageScores.final = updatedScore;
                }
            }

            return {
                ...candidate,
                score: updatedScore
            };
        })
        .sort((a, b) => b.score - a.score);
}

function applyMultiObjectiveRanking(
    candidates: RecommendationCandidate[],
    genreScores: Map<number, number>,
    engagementSignals: UserEngagementSignals
): RecommendationCandidate[] {
    if (candidates.length === 0) {
        return [];
    }

    const sortedGenreScores = Array.from(genreScores.values()).sort((a, b) => b - a);
    const maxGenreAffinity = sortedGenreScores.slice(0, 3).reduce((sum, value) => sum + value, 0) || 1;
    const maxRetrievalScore = candidates.reduce((max, candidate) => Math.max(max, candidate.score), 1);

    const longTermWeight = engagementSignals.watchedCount >= 30 ? 0.3 : 0.24;
    const cvrWeight = engagementSignals.watchRate >= 0.6 ? 0.4 : 0.35;
    const ctrWeight = clamp(1 - longTermWeight - cvrWeight, 0.2, 0.5);
    const weightSum = ctrWeight + cvrWeight + longTermWeight;

    const ranked = candidates.map((candidate) => {
        const explainability = candidate.item.explainability;
        const scoreBreakdown = explainability?.score_breakdown;

        const retrievalNorm = clamp(candidate.score / maxRetrievalScore, 0, 1);
        const ratingNorm = clamp(safeNumber(candidate.item.vote_average) / 10, 0, 1);
        const popularityNorm = logNormalize(candidate.item.popularity, 600);
        const voteCountNorm = logNormalize(candidate.item.vote_count, 12000);
        const sourceNorm = clamp(candidate.sources / 5, 0, 1);
        // NOTE: Divisor kept at 100 intentionally - movies reach max CTR influence at boost=100.
        // To scale proportionally with the 200 cap, change to `/200`.
        const redditNorm = clamp(safeNumber(scoreBreakdown?.reddit_boost) / 100, 0, 1);

        const genreAffinityRaw = (candidate.item.genre_ids || []).reduce((sum, genreId) => {
            return sum + (genreScores.get(genreId) || 0);
        }, 0);
        const genreAffinityNorm = clamp(genreAffinityRaw / maxGenreAffinity, 0, 1);

        const directorAffinityNorm = clamp(safeNumber(scoreBreakdown?.director_boost) / 24, 0, 1);
        const actorAffinityNorm = clamp(safeNumber(scoreBreakdown?.actor_boost) / 20, 0, 1);
        const freshnessScore = getFreshnessScore(candidate.item);
        const noveltyScore = clamp(1 - (sourceNorm * 0.5 + popularityNorm * 0.35 + voteCountNorm * 0.15), 0, 1);

        const ctrScore = clamp(
            popularityNorm * 0.35 +
                voteCountNorm * 0.25 +
                sourceNorm * 0.2 +
                redditNorm * 0.2,
            0,
            1
        );

        const cvrScore = clamp(
            genreAffinityNorm * 0.45 +
                directorAffinityNorm * 0.2 +
                actorAffinityNorm * 0.15 +
                ratingNorm * 0.2,
            0,
            1
        );

        const longTermEngagementScore = clamp(
            freshnessScore * 0.45 +
                noveltyScore * 0.35 +
                ratingNorm * 0.2,
            0,
            1
        );

        const objectiveScore = (
            ctrWeight * ctrScore +
            cvrWeight * cvrScore +
            longTermWeight * longTermEngagementScore
        ) / weightSum;

        const rankingScore = retrievalNorm * 45 + objectiveScore * 165;

        if (explainability) {
            explainability.retrieval_channels = Array.from(
                new Set([
                    ...(explainability.retrieval_channels || []),
                    ...inferRetrievalChannels(explainability.reason_codes)
                ])
            );
            explainability.score_breakdown.novelty_boost = noveltyScore * 20;
            explainability.score_breakdown.freshness_boost = freshnessScore * 20;
            explainability.score_breakdown.total = rankingScore;
            explainability.stage_scores = {
                retrieval: retrievalNorm,
                ranking: objectiveScore,
                rerank: objectiveScore,
                bandit: 0,
                final: objectiveScore,
                ctr: ctrScore,
                cvr: cvrScore,
                engagement: longTermEngagementScore,
                uncertainty: computeUncertaintyScore(candidate)
            };

            if (ctrScore >= 0.72) {
                explainability.reason_codes = addReasonCode(explainability.reason_codes, 'high_ctr_signal');
            }
            if (cvrScore >= 0.72) {
                explainability.reason_codes = addReasonCode(explainability.reason_codes, 'high_cvr_signal');
            }
            if (longTermEngagementScore >= 0.72) {
                explainability.reason_codes = addReasonCode(
                    explainability.reason_codes,
                    'long_term_engagement_signal'
                );
            }
        }

        return {
            ...candidate,
            score: rankingScore
        };
    });

    return ranked.sort((a, b) => b.score - a.score);
}

function computeCandidateSimilarity(a: RecommendationCandidate, b: RecommendationCandidate): number {
    const aGenres = new Set(a.item.genre_ids || []);
    const bGenres = new Set(b.item.genre_ids || []);
    const unionSize = new Set([...(a.item.genre_ids || []), ...(b.item.genre_ids || [])]).size;

    let intersectionSize = 0;
    for (const genreId of aGenres) {
        if (bGenres.has(genreId)) {
            intersectionSize += 1;
        }
    }

    const genreSimilarity = unionSize > 0 ? intersectionSize / unionSize : 0;

    const releaseYearA = getReleaseYear(a.item);
    const releaseYearB = getReleaseYear(b.item);
    const yearSimilarity = releaseYearA && releaseYearB
        ? clamp(1 - Math.abs(releaseYearA - releaseYearB) / 20, 0, 1)
        : 0;

    const popularityA = safeNumber(a.item.popularity);
    const popularityB = safeNumber(b.item.popularity);
    const popularitySimilarity = clamp(1 - Math.abs(popularityA - popularityB) / 250, 0, 1);

    return genreSimilarity * 0.6 + yearSimilarity * 0.25 + popularitySimilarity * 0.15;
}

function rerankCandidatesWithConstraints(candidates: RecommendationCandidate[]): RecommendationCandidate[] {
    if (candidates.length <= 1) {
        return candidates;
    }

    const remaining = [...candidates].sort((a, b) => b.score - a.score);
    const reranked: RecommendationCandidate[] = [];
    const primaryGenreCounts = new Map<number, number>();

    while (remaining.length > 0) {
        let bestIndex = 0;
        let bestScore = Number.NEGATIVE_INFINITY;
        let bestFreshnessBoost = 0;
        let bestNoveltyBoost = 0;
        let bestDiversityPenalty = 0;

        for (let i = 0; i < remaining.length; i += 1) {
            const candidate = remaining[i];
            const explainability = candidate.item.explainability;
            const noveltyBoost = safeNumber(explainability?.score_breakdown.novelty_boost) * 0.35;
            const freshnessBoost = getFreshnessScore(candidate.item) * 9;

            let diversityPenalty = 0;
            if (reranked.length > 0) {
                const maxSimilarity = reranked.reduce((max, selected) => {
                    return Math.max(max, computeCandidateSimilarity(candidate, selected));
                }, 0);
                diversityPenalty += maxSimilarity * 28;
            }

            const primaryGenre = getPrimaryGenre(candidate.item);
            const genreCount = primaryGenre ? (primaryGenreCounts.get(primaryGenre) || 0) : 0;
            if (primaryGenre && reranked.length < 18 && genreCount >= 3) {
                diversityPenalty += 18;
            }

            if ((candidate.item.vote_average || 0) < 6 && (candidate.item.vote_count || 0) < 120) {
                diversityPenalty += 10;
            }

            const rerankScore = candidate.score + noveltyBoost + freshnessBoost - diversityPenalty;

            if (rerankScore > bestScore) {
                bestScore = rerankScore;
                bestIndex = i;
                bestFreshnessBoost = freshnessBoost;
                bestNoveltyBoost = noveltyBoost;
                bestDiversityPenalty = diversityPenalty;
            }
        }

        const [selected] = remaining.splice(bestIndex, 1);
        const explainability = selected.item.explainability;
        if (explainability) {
            explainability.score_breakdown.freshness_boost = safeNumber(explainability.score_breakdown.freshness_boost) + bestFreshnessBoost;
            explainability.score_breakdown.novelty_boost = safeNumber(explainability.score_breakdown.novelty_boost) + bestNoveltyBoost;
            explainability.score_breakdown.diversity_boost = -bestDiversityPenalty;
            explainability.score_breakdown.total = bestScore;

            const stageScores = explainability.stage_scores || {
                retrieval: 0,
                ranking: 0,
                rerank: 0,
                bandit: 0,
                final: 0,
                ctr: 0,
                cvr: 0,
                engagement: 0,
                uncertainty: computeUncertaintyScore(selected)
            };
            stageScores.rerank = bestScore;
            stageScores.final = bestScore;
            explainability.stage_scores = stageScores;

            if (bestFreshnessBoost >= 6) {
                explainability.reason_codes = addReasonCode(explainability.reason_codes, 'freshness_rerank');
            }
            if (bestNoveltyBoost >= 5) {
                explainability.reason_codes = addReasonCode(explainability.reason_codes, 'novelty_rerank');
            }
            if (bestDiversityPenalty >= 12) {
                explainability.reason_codes = addReasonCode(explainability.reason_codes, 'diversity_guardrail');
            }
        }

        const primaryGenre = getPrimaryGenre(selected.item);
        if (primaryGenre) {
            primaryGenreCounts.set(primaryGenre, (primaryGenreCounts.get(primaryGenre) || 0) + 1);
        }

        reranked.push({
            ...selected,
            score: bestScore
        });
    }

    return reranked;
}

function applyContextualBanditPolicy(
    candidates: RecommendationCandidate[],
    engagementSignals: UserEngagementSignals,
    page: number,
    limit: number,
    seed: string
): RecommendationCandidate[] {
    if (candidates.length === 0 || limit <= 0) {
        return candidates;
    }

    const adjustedExplorationRate = page > 2
        ? clamp(engagementSignals.explorationRate - 0.04, 0.05, 0.18)
        : engagementSignals.explorationRate;

    const explorationSlots = Math.min(
        Math.max(1, Math.round(limit * adjustedExplorationRate)),
        Math.max(1, Math.floor(limit / 2))
    );

    if (candidates.length <= limit + 1 || explorationSlots <= 0) {
        return candidates;
    }

    const windowSize = Math.min(candidates.length, Math.max(page * limit + limit * 2, limit * 4));
    const baseWindow = candidates.slice(0, windowSize);
    const explorePool = baseWindow.slice(Math.min(limit, baseWindow.length));

    if (explorePool.length === 0) {
        return candidates;
    }

    const armStats = new Map<RetrievalChannel, { count: number; scoreSum: number }>();
    for (const candidate of baseWindow) {
        const arm = getCandidateArm(candidate);
        const rankingScore = clamp(
            safeNumber(candidate.item.explainability?.stage_scores?.ranking),
            0,
            1
        );

        const stat = armStats.get(arm);
        if (stat) {
            stat.count += 1;
            stat.scoreSum += rankingScore;
        } else {
            armStats.set(arm, { count: 1, scoreSum: rankingScore });
        }
    }

    const scoredPool = explorePool
        .map((candidate) => {
            const arm = getCandidateArm(candidate);
            const armStat = armStats.get(arm);
            const armMean = armStat ? armStat.scoreSum / armStat.count : 0.5;
            const armUcb = armStat
                ? Math.sqrt(Math.log(baseWindow.length + 1) / (armStat.count + 1))
                : 0.25;
            const uncertainty = computeUncertaintyScore(candidate);
            const exploratoryArmBonus = arm === 'trending_explore' || arm === 'discover_supplement' ? 0.05 : 0;
            const stableJitter = hashToUnitInterval(`${seed}:${getCandidateKey(candidate)}`) * 0.004;

            const banditScore = armMean + uncertainty * 0.35 + armUcb * 0.2 + exploratoryArmBonus + stableJitter;
            return {
                candidate,
                banditScore,
                uncertainty
            };
        })
        .sort((a, b) => b.banditScore - a.banditScore)
        .slice(0, explorationSlots);

    if (scoredPool.length === 0) {
        return candidates;
    }

    const promotedKeys = new Set(scoredPool.map((entry) => getCandidateKey(entry.candidate)));
    const exploitationWindow = baseWindow.filter((candidate) => !promotedKeys.has(getCandidateKey(candidate)));
    const interleavedWindow = [...exploitationWindow];

    scoredPool.forEach((entry, index) => {
        const candidate = entry.candidate;
        const explainability = candidate.item.explainability;
        const banditBoost = 8 + entry.uncertainty * 10;

        if (explainability) {
            explainability.reason_codes = addReasonCode(explainability.reason_codes, 'bandit_exploration');
            explainability.retrieval_channels = addRetrievalChannel(
                explainability.retrieval_channels,
                getCandidateArm(candidate)
            );
            explainability.score_breakdown.bandit_boost = banditBoost;
            explainability.score_breakdown.total = safeNumber(explainability.score_breakdown.total) + banditBoost;

            const stageScores = explainability.stage_scores || {
                retrieval: 0,
                ranking: 0,
                rerank: 0,
                bandit: 0,
                final: 0,
                ctr: 0,
                cvr: 0,
                engagement: 0,
                uncertainty: entry.uncertainty
            };
            stageScores.bandit = banditBoost;
            stageScores.final = safeNumber(stageScores.final) + banditBoost;
            stageScores.uncertainty = entry.uncertainty;
            explainability.stage_scores = stageScores;
        }

        candidate.score += banditBoost;

        const insertionIndex = Math.min(2 + index * 4, interleavedWindow.length);
        interleavedWindow.splice(insertionIndex, 0, candidate);
    });

    const remainingCandidates = candidates.slice(windowSize);
    return [...interleavedWindow, ...remainingCandidates];
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

function cleanupRecommendationCacheInBackground(): void {
    const now = Date.now();
    if (
        recommendationCacheCleanupPromise ||
        now - lastRecommendationCacheCleanupAt < RECOMMENDATION_CACHE_CLEANUP_INTERVAL_MS
    ) {
        return;
    }

    lastRecommendationCacheCleanupAt = now;
    recommendationCacheCleanupPromise = sql`
        DELETE FROM recommendation_cache
        WHERE cache_version <> ${RECOMMENDATION_CACHE_VERSION}
           OR expires_at < NOW() - (${RECOMMENDATION_CACHE_EXPIRED_RETENTION_MINUTES} * INTERVAL '1 minute')
    `.then(() => undefined)
        .catch((error) => {
            console.error("Error cleaning recommendation cache:", error);
        })
        .finally(() => {
            recommendationCacheCleanupPromise = null;
        });
}

async function writeCachedRecommendationResult<T>(
    userId: string,
    cacheKey: string,
    result: T
): Promise<void> {
    cleanupRecommendationCacheInBackground();

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
            ${JSON.stringify(result)},
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
}

function refreshRecommendationCacheInBackground<T>(
    userId: string,
    cacheKey: string,
    generator: () => Promise<T>
): void {
    const lockKey = `${userId}:${cacheKey}`;

    void withRecommendationCacheLock(lockKey, async () => {
        const recheckRows = await sql`
            SELECT expires_at
            FROM recommendation_cache
            WHERE user_id = ${userId} AND cache_key = ${cacheKey}
            LIMIT 1
        `;

        const recheckRow = recheckRows[0] as { expires_at: string } | undefined;
        if (recheckRow && new Date(recheckRow.expires_at) > new Date()) {
            return;
        }

        const freshResult = await generator();
        await writeCachedRecommendationResult(userId, cacheKey, freshResult);
    }).catch((error) => {
        console.error("Error refreshing recommendation cache in background:", error);
    });
}

async function getCachedRecommendationResult<T>(
    userId: string,
    endpoint: RecommendationCacheEndpoint,
    params: Record<string, string | number>,
    generator: () => Promise<T>
): Promise<T> {
    cleanupRecommendationCacheInBackground();

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

    if (cachedPayload) {
        refreshRecommendationCacheInBackground(userId, cacheKey, generator);
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
            await writeCachedRecommendationResult(userId, cacheKey, freshResult);
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

export async function expireRecommendationCache(userId: string): Promise<void> {
    await sql`
        UPDATE recommendation_cache
        SET expires_at = NOW() - INTERVAL '1 second',
            updated_at = NOW()
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

export async function expireRecommendationCacheByCollection(collectionId: string): Promise<void> {
    await sql`
        UPDATE recommendation_cache rc
        SET expires_at = NOW() - INTERVAL '1 second',
            updated_at = NOW()
        FROM user_recommendation_collections urc
        WHERE rc.user_id = urc.user_id
        AND urc.collection_id = ${collectionId}
    `;
}

export function warmPersonalizedRecommendationCache(userId: string): void {
    void Promise.allSettled([
        generateRecommendationsCached(userId, 60, 1),
        generateRecommendationsCached(userId, 60, 2),
        generateCategoryRecommendationsCached(userId, 'movie', 50),
        generateCategoryRecommendationsCached(userId, 'tv', 50),
        generatePersonalizedTheatricalReleasesCached(userId, 60, 1),
        generatePersonalizedTheatricalReleasesCached(userId, 60, 2),
    ]).catch((error) => {
        console.error("Error warming personalized recommendation cache:", error);
    });
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

    const includeAdult = getIncludeAdult();

    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.append('api_key', TMDB_API_KEY);
    url.searchParams.append('language', 'en-US');
    Object.entries(params).forEach(([key, value]) => {
        if (key === 'include_adult') return;
        url.searchParams.append(key, value);
    });
    url.searchParams.set('include_adult', includeAdult ? 'true' : 'false');

    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            console.error(`TMDB API Error (${response.status}) on ${endpoint}`);
            return null;
        }
        const data = await response.json() as T;
        if (!includeAdult && data && typeof data === 'object') {
            const obj = data as Record<string, unknown>;
            const results = obj.results;
            if (Array.isArray(results)) {
                const before = results.length;
                const kept = results.filter(
                    (item) => !(item && typeof item === 'object' && (item as { adult?: boolean }).adult === true)
                );
                obj.results = kept;
                const removed = before - kept.length;
                if (removed > 0) {
                    console.log(`[adult-filter] service endpoint=${endpoint} includeAdult=false dropped=${removed}/${before} results`);
                }
            } else if ((obj as { adult?: boolean }).adult === true) {
                // Single-item detail response for an adult-flagged title → treat as missing.
                console.log(`[adult-filter] service endpoint=${endpoint} includeAdult=false dropped single adult detail`);
                return null;
            }
        }
        return data;
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

async function getWatchedSeedMovies(userId: string, limit: number): Promise<CollectionMovie[]> {
    const rows = await sql`
        SELECT cm.movie_id
        FROM collection_movies cm
        JOIN collections c ON cm.collection_id = c.id
        WHERE c.owner_id = ${userId}
          AND c.is_system = true
          AND c.name = ${WATCHED_COLLECTION_NAME}
        ORDER BY cm.added_at DESC
        LIMIT ${limit}
    `;

    return (rows as Array<{ movie_id: string }>).map((row) => {
        const parsed = parseMovieId(row.movie_id);
        return {
            movie_id: row.movie_id,
            is_movie: parsed.isMovie
        };
    });
}

async function getUserEngagementSignals(userId: string): Promise<UserEngagementSignals> {
    const rows = await sql`
        SELECT c.name, COUNT(*)::int AS item_count
        FROM collection_movies cm
        JOIN collections c ON cm.collection_id = c.id
        WHERE c.owner_id = ${userId}
          AND c.is_system = true
          AND c.name IN (${WATCHED_COLLECTION_NAME}, ${NOT_INTERESTED_COLLECTION_NAME})
        GROUP BY c.name
    `;

    let watchedCount = 0;
    let notInterestedCount = 0;

    for (const row of rows as Array<{ name: string; item_count: number | string }>) {
        const count = Number(row.item_count) || 0;
        if (row.name === WATCHED_COLLECTION_NAME) {
            watchedCount = count;
        } else if (row.name === NOT_INTERESTED_COLLECTION_NAME) {
            notInterestedCount = count;
        }
    }

    const totalFeedback = watchedCount + notInterestedCount;
    const watchRate = totalFeedback > 0 ? watchedCount / totalFeedback : 0.55;

    const lowSignalBoost = totalFeedback < 8 ? 0.08 : totalFeedback < 20 ? 0.04 : 0;
    const dissatisfactionBoost = watchRate < 0.4 ? 0.08 : watchRate < 0.55 ? 0.04 : 0;
    const explorationRate = clamp(0.1 + lowSignalBoost + dissatisfactionBoost, 0.08, 0.24);

    return {
        watchedCount,
        notInterestedCount,
        watchRate,
        explorationRate
    };
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
    const engagementSignals = await getUserEngagementSignals(userId);
    const excludedToken = buildStringToken(Array.from(excludedMovieIds));
    const coldStartProfileTokenBase = buildStringToken([
        excludedToken,
        `${engagementSignals.watchedCount}:${engagementSignals.notInterestedCount}:${engagementSignals.watchRate.toFixed(3)}`
    ]);
    const genreScores: Map<number, number> = new Map();
    const allRecommendations: Map<string, RecommendationCandidate> = new Map();

    const watchedSeedItems = await getWatchedSeedMovies(userId, 8);
    const sampledSeeds = deterministicSample(
        watchedSeedItems,
        Math.min(watchedSeedItems.length, 6),
        `${userId}:cold-start-seeds:${page}:${coldStartProfileTokenBase}`,
        (item) => item.movie_id
    );

    if (sampledSeeds.length > 0) {
        const seedResults = await Promise.all(
            sampledSeeds.map(async (seed) => {
                const { id, isMovie } = parseMovieId(seed.movie_id);
                const [details, recommendations, similar] = await Promise.all([
                    getItemDetails(id, isMovie),
                    getRecommendationsForItem(id, isMovie),
                    getSimilarForItem(id, isMovie)
                ]);

                if (details?.genres) {
                    for (const genre of details.genres) {
                        genreScores.set(genre.id, (genreScores.get(genre.id) || 0) + 1);
                    }
                }

                const sourceLabel = formatSourceLabel(details?.title || details?.name || `${id}`, isMovie);

                return {
                    isMovie,
                    sourceLabel,
                    candidates: [...recommendations, ...similar]
                };
            })
        );

        for (const seedResult of seedResults) {
            for (const item of seedResult.candidates) {
                const key = seedResult.isMovie ? `${item.id}` : `${item.id}tv`;
                if (excludedMovieIds.has(key)) {
                    continue;
                }

                let genreMatchScore = 0;
                if (item.genre_ids) {
                    for (const genreId of item.genre_ids) {
                        genreMatchScore += genreScores.get(genreId) || 0;
                    }
                }

                const matchedGenres = (item.genre_ids || []).filter((genreId) => (genreScores.get(genreId) || 0) > 0);
                const baseScore = (item.vote_average || 0) * 10;
                const popularityScore = Math.min((item.popularity || 0) / 10, 45);
                const genreBoost = genreMatchScore * 5;
                const combinedScore = baseScore + popularityScore + genreBoost;

                const existing = allRecommendations.get(key);
                if (existing) {
                    existing.sources += 1;
                    const sourceBoost = existing.sources * 15;
                    existing.score = Math.max(existing.score, combinedScore) + sourceBoost;
                    const explainability = existing.item.explainability;
                    if (explainability) {
                        explainability.reason_codes = addReasonCode(explainability.reason_codes, 'cold_start_seeded');
                        explainability.source_appearances = existing.sources;
                        explainability.matched_genres = matchedGenres;
                        explainability.because_you_liked = addBecauseYouLiked(
                            explainability.because_you_liked || [],
                            seedResult.sourceLabel
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
                                reason_codes: ['cold_start_seeded', 'tmdb_recommendation_or_similar'],
                                source_appearances: 1,
                                matched_genres: matchedGenres,
                                because_you_liked: [seedResult.sourceLabel],
                                retrieval_channels: ['cold_start_seed', 'tmdb_graph'],
                                score_breakdown: {
                                    base: baseScore,
                                    popularity: popularityScore,
                                    genre: genreBoost,
                                    source_boost: 0,
                                    director_boost: 0,
                                    actor_boost: 0,
                                    primary_boost: 0,
                                    reddit_boost: 0,
                                    total: combinedScore
                                }
                            }
                        },
                        score: combinedScore,
                        sources: 1
                    });
                }
            }
        }
    }

    const tmdbPagesToFetch = Math.min(Math.max(page + 1, 2), 6);
    const pageResults = await Promise.all(
        Array.from({ length: tmdbPagesToFetch }, (_, i) => i + 1).map(async (tmdbPage) => {
            const response = await fetchTMDB<TMDBTrendingResponse>('/trending/all/week', {
                page: tmdbPage.toString()
            });

            return {
                results: response?.results || [],
                total_pages: response?.total_pages || 0,
                total_results: response?.total_results || 0
            };
        })
    );

    const trendingItems = pageResults.flatMap((result) => result.results);
    const tmdbTotalPages = pageResults[0]?.total_pages || 0;
    const seenTrendingIds = new Set<string>();

    for (const item of trendingItems) {
        const key = getTrendingKey(item);
        if (!key || excludedMovieIds.has(key) || seenTrendingIds.has(key)) {
            continue;
        }

        seenTrendingIds.add(key);

        let genreMatchScore = 0;
        if (item.genre_ids) {
            for (const genreId of item.genre_ids) {
                genreMatchScore += genreScores.get(genreId) || 0;
            }
        }

        const matchedGenres = (item.genre_ids || []).filter((genreId) => (genreScores.get(genreId) || 0) > 0);
        const baseScore = (item.vote_average || 0) * 10;
        const popularityScore = Math.min((item.popularity || 0) / 10, 35);
        const voteCountScore = Math.min((item.vote_count || 0) / 220, 18);
        const genreBoost = genreMatchScore * 4;
        const totalScore = baseScore + popularityScore + voteCountScore + genreBoost;

        if (allRecommendations.has(key)) {
            const existing = allRecommendations.get(key);
            if (existing?.item.explainability) {
                existing.item.explainability.reason_codes = addReasonCode(
                    existing.item.explainability.reason_codes,
                    'cold_start_trending'
                );
                existing.item.explainability.retrieval_channels = addRetrievalChannel(
                    existing.item.explainability.retrieval_channels,
                    'trending_explore'
                );
            }
            continue;
        }

        allRecommendations.set(key, {
            item: {
                ...item,
                explainability: {
                    reason_codes: sampledSeeds.length > 0
                        ? ['cold_start_seeded', 'cold_start_trending']
                        : ['cold_start_trending'],
                    source_appearances: 0,
                    matched_genres: matchedGenres,
                    because_you_liked: [],
                    retrieval_channels: sampledSeeds.length > 0
                        ? ['cold_start_seed', 'trending_explore']
                        : ['trending_explore'],
                    score_breakdown: {
                        base: baseScore,
                        popularity: popularityScore + voteCountScore,
                        genre: genreBoost,
                        source_boost: 0,
                        director_boost: 0,
                        actor_boost: 0,
                        primary_boost: 0,
                        reddit_boost: 0,
                        total: totalScore
                    }
                }
            },
            score: totalScore,
            sources: 0
        });
    }

    const redditBoostMap = await getRedditBoostMap();
    const withRedditBoost = applyRedditBoosts(Array.from(allRecommendations.values()), redditBoostMap);
    const ranked = applyMultiObjectiveRanking(withRedditBoost, genreScores, engagementSignals);
    const reranked = rerankCandidatesWithConstraints(ranked);
    const coldStartProfileToken = buildStringToken([
        coldStartProfileTokenBase,
        buildCollectionMovieToken(sampledSeeds)
    ]);
    const banditOrdered = applyContextualBanditPolicy(
        reranked,
        engagementSignals,
        page,
        limit,
        `${userId}:cold-start:${page}:${limit}:${coldStartProfileToken}`
    );
    const shuffledCandidates = applyProfileJitter(
        banditOrdered,
        `${userId}:cold-start:${coldStartProfileToken}`,
        4
    );

    const totalResults = shuffledCandidates.length;
    const totalPages = tmdbTotalPages > 0
        ? Math.min(Math.ceil(totalResults / limit), tmdbTotalPages)
        : Math.ceil(totalResults / limit);
    const paginatedResults = paginateOrderedCandidates(shuffledCandidates, page, limit).map((result) => result.item);

    return {
        results: paginatedResults,
        sourceCollections,
        totalSourceItems: sampledSeeds.length,
        page,
        total_pages: totalPages,
        total_results: totalResults
    };
}

/**
 * Main recommendation algorithm
 * 
 * Strategy:
 * 1. Retrieve candidates from TMDB graph edges (recommendations/similar) and creator affinity expansions
 * 2. Build user/context profile from genres, creators, and engagement feedback
 * 3. Rank with a multi-objective scorer (CTR proxy, CVR proxy, long-term engagement)
 * 4. Re-rank with diversity/novelty/freshness/business constraints
 * 5. Apply contextual-bandit exploration to avoid local optima
 * 6. Filter out items already in user's collections and return paginated results
 */
export async function generateRecommendations(
    userId: string,
    limit: number = 60,
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
    
    const engagementSignals = await getUserEngagementSignals(userId);

    // Get source collections
    let sourceCollections = await getUserRecommendationCollections(userId);
    let sourceMovies: CollectionMovie[] = [];
    let usingWatchedSeedFallback = false;

    if (sourceCollections.length > 0) {
        sourceMovies = await getMoviesFromRecommendationCollections(userId);
    }

    if (sourceCollections.length === 0 || sourceMovies.length === 0) {
        const watchedSeedMovies = await getWatchedSeedMovies(userId, 12);
        if (watchedSeedMovies.length > 0) {
            sourceMovies = watchedSeedMovies;
            usingWatchedSeedFallback = true;
            if (sourceCollections.length === 0) {
                sourceCollections = [{ id: WATCHED_COLLECTION_NAME, name: 'Watched history' }];
            }
        } else {
            return generateColdStartRecommendations(userId, limit, page, sourceCollections);
        }
    }
    
    const sourceCollectionIds = sourceCollections.map(c => c.id);
    const existingMovieIds = await getUserExcludedMovieIdsSnapshot(userId, sourceCollectionIds);
    const sourceCollectionsToken = buildStringToken(sourceCollectionIds);
    const sourceMoviesToken = buildCollectionMovieToken(sourceMovies);
    const exclusionsToken = buildStringToken(Array.from(existingMovieIds));
    const recommendationProfileToken = buildStringToken([
        sourceCollectionsToken,
        sourceMoviesToken,
        exclusionsToken,
        `${engagementSignals.watchedCount}:${engagementSignals.notInterestedCount}:${engagementSignals.watchRate.toFixed(3)}`
    ]);
    
    // Build genre, director, and actor preference profiles
    const genreScores: Map<number, number> = new Map();
    const directorScores: Map<number, DirectorInfo> = new Map();
    const actorScores: Map<number, ActorInfo> = new Map();
    const allRecommendations: Map<string, RecommendationCandidate> = new Map();
    
    // Sample a subset of source movies to avoid rate limiting (max 10 for API calls)
    const sampleSize = Math.min(sourceMovies.length, 10);
    const sampledMovies = deterministicSample(
        sourceMovies,
        sampleSize,
        `${userId}:for-you:${page}:${limit}:${recommendationProfileToken}`,
        (movie) => movie.movie_id
    );
    
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
                        if (usingWatchedSeedFallback) {
                            explainability.reason_codes = addReasonCode(explainability.reason_codes, 'cold_start_seeded');
                        }
                        explainability.source_appearances = existing.sources;
                        explainability.matched_genres = matchedGenres;
                        explainability.because_you_liked = addBecauseYouLiked(
                            explainability.because_you_liked || [],
                            sourceLabel
                        );
                        explainability.retrieval_channels = addRetrievalChannel(
                            explainability.retrieval_channels,
                            'tmdb_graph'
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
                            retrieval_channels: usingWatchedSeedFallback
                                ? ['tmdb_graph', 'cold_start_seed']
                                : ['tmdb_graph'],
                            score_breakdown: {
                                base: baseScore,
                                popularity: popularityScore,
                                genre: genreBoost,
                                source_boost: 0,
                                director_boost: 0,
                                actor_boost: 0,
                                primary_boost: 0,
                                reddit_boost: 0,
                                total: combinedScore
                            }
                        }
                    },
                    score: combinedScore,
                    sources: 1
                });

                if (usingWatchedSeedFallback) {
                    const created = allRecommendations.get(key);
                    const explainability = created?.item.explainability;
                    if (explainability) {
                        explainability.reason_codes = addReasonCode(explainability.reason_codes, 'cold_start_seeded');
                    }
                }
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
                    if (usingWatchedSeedFallback) {
                        explainability.reason_codes = addReasonCode(explainability.reason_codes, 'cold_start_seeded');
                    }
                    explainability.source_appearances = existing.sources;
                    explainability.matched_genres = matchedGenres;
                    explainability.retrieval_channels = addRetrievalChannel(
                        explainability.retrieval_channels,
                        'director_discover'
                    );
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
                            retrieval_channels: usingWatchedSeedFallback
                                ? ['director_discover', 'cold_start_seed']
                                : ['director_discover'],
                            score_breakdown: {
                                base: baseScore,
                                popularity: popularityScore,
                                genre: genreWeight,
                                source_boost: 0,
                                director_boost: directorBoost,
                                actor_boost: 0,
                                primary_boost: 0,
                                reddit_boost: 0,
                                total: combinedScore
                            }
                        }
                    },
                    score: combinedScore,
                    sources: 1
                });

                if (usingWatchedSeedFallback) {
                    const created = allRecommendations.get(key);
                    const explainability = created?.item.explainability;
                    if (explainability) {
                        explainability.reason_codes = addReasonCode(explainability.reason_codes, 'cold_start_seeded');
                    }
                }
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
                    if (usingWatchedSeedFallback) {
                        explainability.reason_codes = addReasonCode(explainability.reason_codes, 'cold_start_seeded');
                    }
                    explainability.source_appearances = existing.sources;
                    explainability.matched_genres = matchedGenres;
                    explainability.retrieval_channels = addRetrievalChannel(
                        explainability.retrieval_channels,
                        'actor_discover'
                    );
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
                            retrieval_channels: usingWatchedSeedFallback
                                ? ['actor_discover', 'cold_start_seed']
                                : ['actor_discover'],
                            score_breakdown: {
                                base: baseScore,
                                popularity: popularityScore,
                                genre: genreWeight,
                                source_boost: 0,
                                director_boost: 0,
                                actor_boost: actorBoost,
                                primary_boost: 0,
                                reddit_boost: 0,
                                total: combinedScore
                            }
                        }
                    },
                    score: combinedScore,
                    sources: 1
                });

                if (usingWatchedSeedFallback) {
                    const created = allRecommendations.get(key);
                    const explainability = created?.item.explainability;
                    if (explainability) {
                        explainability.reason_codes = addReasonCode(explainability.reason_codes, 'cold_start_seeded');
                    }
                }
            }
        });
    });

    // =========================================================================
    // STEP: Inject Reddit-sourced candidates as primary recommendations
    // =========================================================================
    // These are items highly mentioned on Reddit that may not appear in TMDB's
    // recommendation/similar graphs. We fetch them with full TMDB details and
    // inject them directly into the candidate pool.
    
    // Build set of IDs already in pool to pass to Reddit function
    const pooledIds = new Set<string>();
    for (const key of allRecommendations.keys()) {
        pooledIds.add(key);
    }
    // Also add user's excluded movies
    for (const id of existingMovieIds) {
        pooledIds.add(id);
    }

    const redditPrimaryCandidates = await getRedditPrimaryCandidates({
        excludedIds: pooledIds,
        limit: 100,
        minMentions: 2,
        minScore: 50,
    });

    for (const redditCandidate of redditPrimaryCandidates) {
        const item = redditCandidate.item;
        const key = item.media_type === 'tv' ? `${item.id}tv` : `${item.id}`;

        if (allRecommendations.has(key)) {
            // Item already exists from TMDB - add Reddit channel and boost
            const existing = allRecommendations.get(key)!;
            existing.sources += 1;
            
            const explainability = existing.item.explainability;
            if (explainability) {
                explainability.retrieval_channels = addRetrievalChannel(
                    explainability.retrieval_channels,
                    'reddit_primary'
                );
                explainability.reason_codes = addReasonCode(
                    explainability.reason_codes,
                    'reddit_popular'
                );
                explainability.reddit_mentions = redditCandidate.redditData.mentionCount;
                explainability.reddit_sentiment = redditCandidate.redditData.sentiment || undefined;
            }
        } else {
            // New item from Reddit - create full candidate with explainability
            const baseScore = (item.vote_average || 0) * 10;
            const popularityScore = Math.min((item.popularity || 0) / 10, 50);
            
            let redditBoostScore = redditCandidate.redditData.mentionCount * REDDIT_BOOST_MULTIPLIER;
            if (redditCandidate.redditData.sentiment === 'positive') {
                redditBoostScore += REDDIT_POSITIVE_SENTIMENT_BONUS;
            }
            redditBoostScore = Math.min(redditBoostScore, 200);

            const totalScore = baseScore + popularityScore + redditBoostScore;

            allRecommendations.set(key, {
                item: {
                    ...item,
                    explainability: {
                        reason_codes: ['reddit_popular'],
                        source_appearances: 1,
                        matched_genres: item.genre_ids || [],
                        retrieval_channels: ['reddit_primary'],
                        reddit_mentions: redditCandidate.redditData.mentionCount,
                        reddit_sentiment: redditCandidate.redditData.sentiment || undefined,
                        score_breakdown: {
                            base: baseScore,
                            popularity: popularityScore,
                            genre: 0,
                            source_boost: 0,
                            director_boost: 0,
                            actor_boost: 0,
                            primary_boost: 0,
                            reddit_boost: redditBoostScore,
                            total: totalScore,
                        },
                    },
                } as TMDBMovie,
                score: totalScore,
                sources: 1,
            });
        }
    }

    console.log(`[Reddit Primary] Injected ${redditPrimaryCandidates.length} Reddit primary candidates into pool (total pool: ${allRecommendations.size})`);
    
    // Apply Reddit popularity boosts to recommendations
    const redditBoostMap = await getRedditBoostMap();
    const withRedditBoost = applyRedditBoosts(
        Array.from(allRecommendations.values()),
        redditBoostMap
    );

    if (usingWatchedSeedFallback) {
        for (const candidate of withRedditBoost) {
            const explainability = candidate.item.explainability;
            if (explainability) {
                explainability.reason_codes = addReasonCode(explainability.reason_codes, 'cold_start_seeded');
                explainability.retrieval_channels = addRetrievalChannel(
                    explainability.retrieval_channels,
                    'cold_start_seed'
                );
            }
        }
    }

    const rankedCandidates = applyMultiObjectiveRanking(withRedditBoost, genreScores, engagementSignals);
    const rerankedCandidates = rerankCandidatesWithConstraints(rankedCandidates);
    const finalCandidates = applyContextualBanditPolicy(
        rerankedCandidates,
        engagementSignals,
        page,
        limit,
        `${userId}:for-you:${page}:${limit}:${recommendationProfileToken}`
    );

    const shuffledCandidates = applyProfileJitter(
        finalCandidates,
        `${userId}:for-you:${recommendationProfileToken}`,
        4
    );

    const totalResults = shuffledCandidates.length;
    const totalPages = Math.ceil(totalResults / limit);
    const paginatedResults = paginateOrderedCandidates(shuffledCandidates, page, limit).map((result) => result.item);
    
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
 * 1. Generate one ranked For You candidate pool using the main recommendation algorithm
 * 2. Filter that pool to the requested media type
 * 3. Order category rows by source-collection genre affinity when available
 * 4. Fill each row from the already-ranked For You pool, deduping across rows
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

    // Category recommendations are now a genre-bucketed view of the same ranked
    // candidate set used by the For You feed. This keeps retrieval, Reddit
    // signals, multi-objective ranking, diversity reranking, exploration, adult
    // filtering, and exclusions aligned with the main recommendation surface.
    if (!userResult[0].recommendations_enabled) {
        return emptyResult;
    }

    const normalizedLimit = Math.max(1, limit);
    const forYouPoolLimit = Math.min(
        Math.max(normalizedLimit * 8, CATEGORY_FOR_YOU_POOL_MIN),
        CATEGORY_FOR_YOU_POOL_MAX
    );

    const forYouRecommendations = await generateRecommendations(userId, forYouPoolLimit, 1);
    const sourceCollections = forYouRecommendations.sourceCollections;
    const totalSourceItems = forYouRecommendations.totalSourceItems;

    const rankedItems = forYouRecommendations.results.filter((item) => getItemMediaType(item) === mediaType);

    if (rankedItems.length === 0) {
        return {
            ...emptyResult,
            sourceCollections,
            totalSourceItems
        };
    }

    const genreNameMap = await getGenreNameMap(mediaType);
    const sourceGenreScores: Map<number, { id: number; name: string; count: number }> = new Map();

    // Preserve the user's source-genre priority when possible, but do not build a
    // separate recommendation pool here. The actual titles below all come from
    // the For You algorithm above.
    let sourceMovies: CollectionMovie[] = [];
    const explicitSourceCollections = await getUserRecommendationCollections(userId);
    if (explicitSourceCollections.length > 0) {
        sourceMovies = await getMoviesFromRecommendationCollections(userId);
    } else {
        sourceMovies = await getWatchedSeedMovies(userId, 15);
    }

    const sourceItemsOfType = sourceMovies.filter((movie) => {
        const { isMovie } = parseMovieId(movie.movie_id);
        return isMovie === (mediaType === 'movie');
    });

    const sampledSourceItems = deterministicSample(
        sourceItemsOfType,
        Math.min(sourceItemsOfType.length, 15),
        `${userId}:category-genre-profile:${mediaType}:${sourceItemsOfType.length}`,
        (item) => item.movie_id
    );

    await Promise.all(sampledSourceItems.map(async (movie) => {
        const { id, isMovie } = parseMovieId(movie.movie_id);
        const details = await getItemDetails(id, isMovie);

        if (!details?.genres) {
            return;
        }

        for (const genre of details.genres) {
            const existing = sourceGenreScores.get(genre.id);
            if (existing) {
                existing.count += 1;
            } else {
                sourceGenreScores.set(genre.id, {
                    id: genre.id,
                    name: genre.name || genreNameMap.get(genre.id) || `Genre ${genre.id}`,
                    count: 1
                });
            }
        }
    }));

    // Add any genres that appear in the For You-ranked pool so sparse profiles,
    // watched-history fallback, and cold-start users can still get category rows.
    const recommendationGenreScores = new Map<number, { id: number; name: string; count: number; rankScore: number }>();
    rankedItems.forEach((item, index) => {
        for (const genreId of item.genre_ids || []) {
            const existing = recommendationGenreScores.get(genreId);
            if (existing) {
                existing.count += 1;
                existing.rankScore += rankedItems.length - index;
            } else {
                recommendationGenreScores.set(genreId, {
                    id: genreId,
                    name: genreNameMap.get(genreId) || `Genre ${genreId}`,
                    count: 1,
                    rankScore: rankedItems.length - index
                });
            }
        }
    });

    const sourceSortedGenres = Array.from(sourceGenreScores.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const sourceGenreIds = new Set(sourceSortedGenres.map((genre) => genre.id));
    const recommendationSortedGenres = Array.from(recommendationGenreScores.values())
        .filter((genre) => !sourceGenreIds.has(genre.id))
        .sort((a, b) => b.count - a.count || b.rankScore - a.rankScore || a.name.localeCompare(b.name));

    const sortedGenres: Genre[] = [
        ...sourceSortedGenres.map((genre) => ({ id: genre.id, name: genre.name })),
        ...recommendationSortedGenres.map((genre) => ({ id: genre.id, name: genre.name }))
    ];

    if (sortedGenres.length === 0) {
        return {
            ...emptyResult,
            sourceCollections,
            totalSourceItems
        };
    }

    const categories: CategoryRecommendation[] = [];
    const usedItemKeys = new Set<string>();

    for (const genre of sortedGenres) {
        const genreRecommendations: TMDBMovie[] = [];

        for (const item of rankedItems) {
            if (!item.genre_ids?.includes(genre.id)) {
                continue;
            }

            const key = getCandidateKey({ item, score: 0, sources: 0 });
            if (usedItemKeys.has(key)) {
                continue;
            }

            genreRecommendations.push(item);
            if (genreRecommendations.length >= normalizedLimit) {
                break;
            }
        }

        for (const item of genreRecommendations) {
            usedItemKeys.add(getCandidateKey({ item, score: 0, sources: 0 }));
        }

        if (genreRecommendations.length > 0) {
            categories.push({
                genre,
                results: genreRecommendations,
                total_results: genreRecommendations.length
            });
        }
    }

    return {
        categories,
        mediaType,
        sourceCollections,
        totalSourceItems
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
        warmPersonalizedRecommendationCache(userId);
        
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
        warmPersonalizedRecommendationCache(userId);

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
    limit: number = 60,
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

    const engagementSignals = await getUserEngagementSignals(userId);

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
    const sourceCollectionsToken = buildStringToken(sourceCollectionIds);
    const exclusionsToken = buildStringToken(Array.from(existingMovieIds));

    // Filter by media type FIRST
    const sourceItemsOfType = sourceMovies.filter(movie => {
        const { isMovie } = parseMovieId(movie.movie_id);
        return isMovie === (mediaType === 'movie');
    });

    if (sourceItemsOfType.length === 0) {
        return { ...emptyResult, sourceCollections, totalSourceItems: sourceMovies.length };
    }

    const sourceItemsToken = buildCollectionMovieToken(sourceItemsOfType);
    const genreProfileToken = buildStringToken([
        sourceCollectionsToken,
        sourceItemsToken,
        exclusionsToken,
        `${genreId}:${mediaType}`,
        `${engagementSignals.watchedCount}:${engagementSignals.notInterestedCount}:${engagementSignals.watchRate.toFixed(3)}`
    ]);

    // Use all source items for genre-specific recommendations (up to 20) to get more results
    const sampleSize = Math.min(sourceItemsOfType.length, 20);
    const sampledItems = deterministicSample(
        sourceItemsOfType,
        sampleSize,
        `${userId}:genre:${genreId}:${mediaType}:${page}:${limit}:${genreProfileToken}`,
        (item) => item.movie_id
    );

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
                                reddit_boost: 0,
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
                        reddit_boost: 0,
                        total: combinedScore
                    }
                }
            },
            score: combinedScore,
            sources: 0
        });
    }

    const redditBoostMap = await getRedditBoostMap();
    const withRedditBoost = applyRedditBoosts(Array.from(allRecommendations.values()), redditBoostMap);
    const rankedCandidates = applyMultiObjectiveRanking(withRedditBoost, genreScores, engagementSignals);
    const rerankedCandidates = rerankCandidatesWithConstraints(rankedCandidates);
    const finalCandidates = applyContextualBanditPolicy(
        rerankedCandidates,
        engagementSignals,
        page,
        limit,
        `${userId}:genre:${genreId}:${mediaType}:${page}:${limit}:${genreProfileToken}`
    );
    const shuffledCandidates = applyProfileJitter(
        finalCandidates,
        `${userId}:genre:${genreId}:${mediaType}:${genreProfileToken}`,
        4
    );

    // Estimate total - use discover total as baseline since it's larger
    const estimatedTotal = Math.max(shuffledCandidates.length, discoverTotalResults);
    const totalPages = Math.ceil(estimatedTotal / limit);
    const paginatedResults = paginateOrderedCandidates(shuffledCandidates, page, limit).map((result) => result.item);

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
    limit: number = 60,
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

    const engagementSignals = await getUserEngagementSignals(userId);

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
    const sourceCollectionsToken = buildStringToken(sourceCollectionIds);
    const exclusionsToken = buildStringToken(Array.from(existingMovieIds));

    // Build genre preference profile from source items (movies only for theatrical)
    const genreScores: Map<number, number> = new Map();
    const directorScores: Map<number, DirectorInfo> = new Map();
    const actorScores: Map<number, ActorInfo> = new Map();

    // Filter to movies only
    const sourceMoviesOnly = sourceMovies.filter(movie => {
        const { isMovie } = parseMovieId(movie.movie_id);
        return isMovie;
    });

    const sourceMoviesOnlyToken = buildCollectionMovieToken(sourceMoviesOnly);
    const theatricalProfileToken = buildStringToken([
        sourceCollectionsToken,
        sourceMoviesOnlyToken,
        exclusionsToken,
        `${engagementSignals.watchedCount}:${engagementSignals.notInterestedCount}:${engagementSignals.watchRate.toFixed(3)}`
    ]);

    // Sample a subset to avoid rate limiting
    const sampleSize = Math.min(sourceMoviesOnly.length, 10);
    const sampledItems = deterministicSample(
        sourceMoviesOnly,
        sampleSize,
        `${userId}:theatrical:${page}:${limit}:${theatricalProfileToken}`,
        (item) => item.movie_id
    );

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
    const requestedTmdbPagesToFetch = Math.max(
        MIN_THEATRICAL_TMDB_PAGES_TO_FETCH,
        Math.ceil((resultsNeeded * 2) / 20)
    );
    const tmdbPagesToFetch = Math.min(requestedTmdbPagesToFetch, MAX_THEATRICAL_TMDB_PAGES_TO_FETCH);

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
                        reddit_boost: 0,
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

    const redditBoostMap = await getRedditBoostMap();
    const withRedditBoost = applyRedditBoosts(scoredResults, redditBoostMap);
    const rankedCandidates = applyMultiObjectiveRanking(withRedditBoost, genreScores, engagementSignals);
    const rerankedCandidates = rerankCandidatesWithConstraints(rankedCandidates);
    const finalCandidates = applyContextualBanditPolicy(
        rerankedCandidates,
        engagementSignals,
        page,
        limit,
        `${userId}:theatrical:${page}:${limit}:${theatricalProfileToken}`
    );
    const shuffledCandidates = applyProfileJitter(
        finalCandidates,
        `${userId}:theatrical:${theatricalProfileToken}`,
        4
    );

    // Estimate total results based on TMDB total and our filtering ratio
    const filterRatio = allResults.length > 0 ? shuffledCandidates.length / allResults.length : 1;
    const estimatedTotalResults = Math.floor(tmdbTotalResults * filterRatio);
    const totalPages = Math.min(Math.ceil(estimatedTotalResults / limit), tmdbTotalPages);
    const paginatedResults = paginateOrderedCandidates(shuffledCandidates, page, limit).map((result) => result.item);

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
        warmPersonalizedRecommendationCache(userId);
        
        return true;
    } catch (error) {
        console.error("Error setting recommendation collections:", error);
        return false;
    }
}

export async function generateRecommendationsCached(
    userId: string,
    limit: number = 60,
    page: number = 1
): Promise<RecommendationResult> {
    const result = await withRecommendationContext(userId, () =>
        getCachedRecommendationResult(
            userId,
            'for_you',
            { limit, page },
            () => generateRecommendations(userId, limit, page)
        )
    );

    if (page === 1 && result.page < result.total_pages) {
        void generateRecommendationsCached(userId, limit, 2).catch((error) => {
            console.error("Error warming next For You recommendation page:", error);
        });
    }

    return result;
}

export async function generateCategoryRecommendationsCached(
    userId: string,
    mediaType: 'movie' | 'tv' = 'movie',
    limit: number = 10
): Promise<CategoryRecommendationsResult> {
    return withRecommendationContext(userId, () =>
        getCachedRecommendationResult(
            userId,
            'categories',
            { mediaType, limit },
            () => generateCategoryRecommendations(userId, mediaType, limit)
        )
    );
}

export async function generateGenreRecommendationsCached(
    userId: string,
    genreId: number,
    mediaType: 'movie' | 'tv' = 'movie',
    limit: number = 60,
    page: number = 1
): Promise<{
    results: TMDBMovie[];
    page: number;
    total_pages: number;
    total_results: number;
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
}> {
    return withRecommendationContext(userId, () =>
        getCachedRecommendationResult(
            userId,
            'genre',
            { genreId, mediaType, limit, page },
            () => generateGenreRecommendations(userId, genreId, mediaType, limit, page)
        )
    );
}

export async function generatePersonalizedTheatricalReleasesCached(
    userId: string,
    limit: number = 60,
    page: number = 1
): Promise<{
    results: TMDBMovie[];
    page: number;
    total_pages: number;
    total_results: number;
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
}> {
    return withRecommendationContext(userId, () =>
        getCachedRecommendationResult(
            userId,
            'theatrical',
            { limit, page },
            () => generatePersonalizedTheatricalReleases(userId, limit, page)
        )
    );
}
