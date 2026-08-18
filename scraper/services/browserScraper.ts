import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const NAVIGATION_TIMEOUT_MS = 30_000;
const CHALLENGE_SOLVE_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const WAF_CHALLENGE_MARKERS = ['AwsWafIntegration', 'challenge.js', 'gokuProps'];
const PARENTS_GUIDE_CONTENT_MARKERS = ['severitySummaryText', 'advisory-', 'ipl-alt-title-rating'];

export function isWafChallengeHtml(html: string): boolean {
    return WAF_CHALLENGE_MARKERS.some(marker => html.includes(marker));
}

function hasParentsGuideContent(html: string): boolean {
    return PARENTS_GUIDE_CONTENT_MARKERS.some(marker => html.includes(marker));
}

async function safeGetHtml(page: Page): Promise<string | null> {
    try {
        return await page.content();
    } catch {
        // Execution context can be destroyed mid-navigation (challenge reload); retry next poll.
        return null;
    }
}

/**
 * Render the IMDB parents guide page in headless Chrome and return the HTML.
 *
 * IMDB sits behind AWS WAF. Plain `fetch` calls get a JS challenge page
 * (HTTP 202 with AwsWafIntegration/challenge.js) or a 403. A real browser
 * executes the challenge, acquires the aws-waf-token cookie, and reloads
 * into the actual page. Headless browsers are themselves detectable, so we
 * mask the usual automation tells (webdriver flag, AutomationControlled).
 *
 * Uses @sparticuz/chromium's bundled binary on Vercel/serverless. For local
 * development, point CHROME_EXECUTABLE_PATH at an installed Chrome.
 */
export async function fetchParentalGuideHtmlWithBrowser(imdbId: string): Promise<string | null> {
    let browser: Browser | null = null;

    try {
        const localChromePath = process.env.CHROME_EXECUTABLE_PATH;
        const executablePath = localChromePath || await chromium.executablePath();

        browser = await puppeteer.launch({
            args: [
                ...(localChromePath ? ['--no-sandbox', '--disable-setuid-sandbox'] : chromium.args),
                '--disable-blink-features=AutomationControlled',
            ],
            executablePath,
            headless: true,
            defaultViewport: { width: 1280, height: 800 },
        });

        const page = await browser.newPage();
        await page.setUserAgent(BROWSER_USER_AGENT);
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

        // Mask the headless/automation tells AWS WAF looks for.
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        const url = `https://www.imdb.com/title/${imdbId}/parentalguide`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });

        // The WAF challenge page auto-submits and reloads into the real page.
        // Poll until the challenge markers are gone (or we run out of time).
        const deadline = Date.now() + CHALLENGE_SOLVE_TIMEOUT_MS;
        let html: string | null = null;

        while (Date.now() < deadline) {
            html = await safeGetHtml(page);

            if (html && !isWafChallengeHtml(html) && hasParentsGuideContent(html)) {
                return html;
            }

            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        // Last chance: whatever the page holds now.
        html = html ?? await safeGetHtml(page);
        return html;
    } catch (error) {
        console.warn(`Headless browser scrape failed for ${imdbId}:`, error);
        return null;
    } finally {
        if (browser) {
            await browser.close().catch(() => undefined);
        }
    }
}