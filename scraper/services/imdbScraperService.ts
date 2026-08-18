import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { fetchParentalGuideHtmlWithBrowser, isWafChallengeHtml } from './browserScraper.js';

// Types
export interface ScrapedParentalGuidance {
    imdbId: string;
    nudity: string | null;
    violence: string | null;
    profanity: string | null;
    alcohol: string | null;
    frightening: string | null;
    nudityDescription: string | null;
    violenceDescription: string | null;
    profanityDescription: string | null;
    alcoholDescription: string | null;
    frighteningDescription: string | null;
}

// Severity level mapping
const SEVERITY_LEVELS = ['none', 'mild', 'moderate', 'severe'] as const;
type SeverityLevel = typeof SEVERITY_LEVELS[number];
type SeverityCategoryField = 'nudity' | 'violence' | 'profanity' | 'alcohol' | 'frightening';

// IMDB category IDs
const CATEGORY_MAPPING: Record<string, SeverityCategoryField> = {
    'nudity': 'nudity',
    'violence': 'violence',
    'profanity': 'profanity',
    'alcohol': 'alcohol',
    'frightening': 'frightening',
    'sex': 'nudity', // Sometimes labeled as 'sex' instead of 'nudity'
    'gore': 'violence', // Sometimes labeled as 'gore'
};

const IMDB_PARENTAL_GUIDANCE_CACHE_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const IMDB_PARENTAL_GUIDANCE_CACHE_FAILURE_TTL_MS = 15 * 60 * 1000;
const IMDB_PARENTAL_GUIDANCE_CACHE_MAX_ENTRIES = 1000;

interface ImdbParentalGuidanceCacheEntry {
    data: ScrapedParentalGuidance | null;
    expiresAt: number;
}

const imdbParentalGuidanceCache = new Map<string, ImdbParentalGuidanceCacheEntry>();
const imdbParentalGuidanceInFlight = new Map<string, Promise<ScrapedParentalGuidance | null>>();

/**
 * Parse severity level from IMDB page
 */
function parseSeverityLevel(text: string): SeverityLevel | null {
    const lowerText = text.toLowerCase();
    for (const level of SEVERITY_LEVELS) {
        if (lowerText.includes(level)) {
            return level;
        }
    }
    return null;
}

/**
 * Map IMDB severity text to our severity level
 */
function mapImdbSeverity(severityText: string | null | undefined): SeverityLevel | null {
    if (!severityText) return null;
    const lower = severityText.toLowerCase();
    if (lower === 'none' || lower.includes('none')) return 'none';
    if (lower === 'mild' || lower.includes('mild')) return 'mild';
    if (lower === 'moderate' || lower.includes('moderate')) return 'moderate';
    if (lower === 'severe' || lower.includes('severe')) return 'severe';
    return null;
}

function cloneScrapedParentalGuidance(data: ScrapedParentalGuidance | null): ScrapedParentalGuidance | null {
    if (!data) return null;
    return { ...data };
}

function getCachedImdbParentalGuidance(imdbId: string): ScrapedParentalGuidance | null | undefined {
    const cacheEntry = imdbParentalGuidanceCache.get(imdbId);
    if (!cacheEntry) {
        return undefined;
    }

    if (cacheEntry.expiresAt <= Date.now()) {
        imdbParentalGuidanceCache.delete(imdbId);
        return undefined;
    }

    return cloneScrapedParentalGuidance(cacheEntry.data);
}

function setCachedImdbParentalGuidance(
    imdbId: string,
    data: ScrapedParentalGuidance | null,
    ttlMs: number,
): void {
    while (imdbParentalGuidanceCache.size >= IMDB_PARENTAL_GUIDANCE_CACHE_MAX_ENTRIES) {
        const oldestKey = imdbParentalGuidanceCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        imdbParentalGuidanceCache.delete(oldestKey);
    }

    imdbParentalGuidanceCache.set(imdbId, {
        data: cloneScrapedParentalGuidance(data),
        expiresAt: Date.now() + ttlMs,
    });
}

function createEmptyScrapedResult(imdbId: string): ScrapedParentalGuidance {
    return {
        imdbId,
        nudity: null,
        violence: null,
        profanity: null,
        alcohol: null,
        frightening: null,
        nudityDescription: null,
        violenceDescription: null,
        profanityDescription: null,
        alcoholDescription: null,
        frighteningDescription: null,
    };
}

function hasAnySeverityData(result: ScrapedParentalGuidance): boolean {
    return Boolean(result.nudity || result.violence || result.profanity || result.alcohol || result.frightening);
}

function resolveCategoryField(categoryIdOrText: string | null | undefined): SeverityCategoryField | null {
    if (!categoryIdOrText) return null;

    const normalized = categoryIdOrText.toLowerCase();
    for (const key of Object.keys(CATEGORY_MAPPING)) {
        if (normalized.includes(key)) {
            return CATEGORY_MAPPING[key];
        }
    }

    return null;
}

function setCategorySeverity(
    result: ScrapedParentalGuidance,
    category: SeverityCategoryField | null,
    severity: SeverityLevel | null,
): void {
    if (!category || !severity) return;
    if (!result[category]) {
        result[category] = severity;
    }
}

/**
 * Parse parental guidance severities out of a rendered IMDB parents guide page.
 * Tries embedded JSON snippets first, then HTML advisory sections.
 */
function parseParentalGuidanceFromHtml(imdbId: string, html: string): ScrapedParentalGuidance | null {
    const $ = cheerio.load(html);

    const result = createEmptyScrapedResult(imdbId);

    // Primary HTML method: parse embedded JSON snippets in multiple known formats.
    const categoryPatterns = [
        /"id":"(nudity|violence|profanity|alcohol|frightening)","title":"[^"]*","severitySummaryId":"[^"]*","severitySummaryText":"([^"]*)"/gi,
        /"category":\{"id":"(NUDITY|VIOLENCE|PROFANITY|ALCOHOL|FRIGHTENING)","text":"[^"]*"\},"severity":\{[\s\S]{0,200}?"text":"([^"]+)"/gi,
    ];

    for (const categoryPattern of categoryPatterns) {
        let match: RegExpExecArray | null;
        while ((match = categoryPattern.exec(html)) !== null) {
            const category = resolveCategoryField(match[1]);
            const severity = mapImdbSeverity(match[2]);
            setCategorySeverity(result, category, severity);
        }
    }

    if (hasAnySeverityData(result)) {
        console.log(`Successfully scraped parental guidance for ${imdbId} via HTML JSON patterns:`, {
            nudity: result.nudity,
            violence: result.violence,
            profanity: result.profanity,
            alcohol: result.alcohol,
            frightening: result.frightening,
        });
        return result;
    }

    // Fallback: parse HTML advisory sections.
    $('section[id^="advisory"]').each((_: number, section: Element) => {
        const $section = $(section);
        const sectionId = $section.attr('id') || '';

        const category = resolveCategoryField(sectionId);
        if (!category) return;

        const sectionText = $section.text().toLowerCase();
        const severity = parseSeverityLevel(sectionText);

        setCategorySeverity(result, category, severity);
    });

    // Secondary fallback: inspect raw page text around category IDs.
    const categories = ['nudity', 'violence', 'profanity', 'alcohol', 'frightening', 'sex', 'gore'] as const;
    const pageText = html.toLowerCase();

    for (const cat of categories) {
        const field = CATEGORY_MAPPING[cat];
        if (result[field]) continue;

        const catIndex = pageText.indexOf(`"id":"${cat}"`);

        if (catIndex !== -1) {
            const surroundingText = pageText.substring(
                catIndex,
                Math.min(pageText.length, catIndex + 300)
            );

            const severityMatch = surroundingText.match(/severitysummarytext":"([^"]+)"/);
            if (severityMatch) {
                const severity = mapImdbSeverity(severityMatch[1]);
                setCategorySeverity(result, field, severity);
            }
        }
    }

    if (!hasAnySeverityData(result)) {
        console.warn(`Could not scrape parental guidance for ${imdbId}: no category severities found on IMDB page`);
        return null;
    }

    console.log(`Scraped parental guidance for ${imdbId} (fallback methods):`, {
        nudity: result.nudity,
        violence: result.violence,
        profanity: result.profanity,
        alcohol: result.alcohol,
        frightening: result.frightening,
    });

    return result;
}

/**
 * Scrape parental guidance data from IMDB.
 * Goes straight to the headless browser - it executes the AWS WAF JS challenge
 * that plain fetches (403) and the GraphQL API (403) get blocked on.
 */
async function scrapeParentalGuidanceFromImdbUncached(imdbId: string): Promise<ScrapedParentalGuidance | null> {
    const html = await fetchParentalGuideHtmlWithBrowser(imdbId);

    if (!html) {
        console.warn(`Could not scrape parental guidance for ${imdbId}: headless browser returned no HTML`);
        return null;
    }

    if (isWafChallengeHtml(html)) {
        console.warn(`Could not scrape parental guidance for ${imdbId}: IMDB returned anti-bot challenge page even in headless browser`);
        return null;
    }

    return parseParentalGuidanceFromHtml(imdbId, html);
}

/**
 * Scrape parental guidance with in-memory caching and in-flight deduplication
 */
export async function scrapeParentalGuidanceFromImdb(imdbId: string): Promise<ScrapedParentalGuidance | null> {
    const cachedResult = getCachedImdbParentalGuidance(imdbId);
    if (cachedResult !== undefined) {
        console.log(`Using in-memory IMDB parental guidance cache for ${imdbId}`);
        return cachedResult;
    }

    const inFlightRequest = imdbParentalGuidanceInFlight.get(imdbId);
    if (inFlightRequest) {
        return inFlightRequest;
    }

    const scrapePromise = scrapeParentalGuidanceFromImdbUncached(imdbId);
    imdbParentalGuidanceInFlight.set(imdbId, scrapePromise);

    try {
        const scraped = await scrapePromise;
        const ttlMs = scraped
            ? IMDB_PARENTAL_GUIDANCE_CACHE_SUCCESS_TTL_MS
            : IMDB_PARENTAL_GUIDANCE_CACHE_FAILURE_TTL_MS;
        setCachedImdbParentalGuidance(imdbId, scraped, ttlMs);
        return scraped;
    } finally {
        imdbParentalGuidanceInFlight.delete(imdbId);
    }
}