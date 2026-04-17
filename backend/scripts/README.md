# Backend Scripts

## Reddit Scraper

Scrapes movie/TV show recommendations from Reddit using AI-powered extraction (OpenAI Codex SDK) and validates against TMDB.

### Setup

The extractor uses [`@openai/codex-sdk`](https://github.com/openai/codex/tree/main/sdk/typescript), which wraps the `codex` CLI and inherits its credentials. Run `codex login` once with your ChatGPT/Codex subscription before running this script — no API key env var is needed.

Add these environment variables to your `.env`:

```env
# Required
TMDB_API_KEY=your_tmdb_key         # For validating movie titles
DATABASE_URL=your_neon_db_url      # For storing recommendations

# Optional
CODEX_MODEL=gpt-5-codex             # Override the model Codex uses for extraction
REDDIT_SUBREDDITS=MovieSuggestions,movies,horror  # Comma-separated list (default: see below)
REDDIT_POSTS_PER_SUB=25            # Posts to fetch per subreddit (default: 25)
REDDIT_MIN_SCORE=10                # Minimum upvote score (default: 10)
REDDIT_TIMEFRAME=week              # hour|day|week|month|year|all (default: week)
REDDIT_CACHE_TTL_HOURS=720         # Cache validity in hours (default: 720 = 30 days)
REDDIT_SCRAPE_IN_CI=true           # Opt-in: allow scraping when CI=true (default: skip in CI)
REDDIT_AI_BATCH_SIZE=80            # Text items per AI extraction call
REDDIT_AI_CONCURRENCY=3            # Parallel AI extraction workers
REDDIT_AI_BATCH_DELAY_MS=0         # Optional delay between AI calls per worker
REDDIT_AI_TEXT_CHARS_PER_ITEM=500  # Max chars per text snippet sent to AI
REDDIT_AI_PROMPT_TEXT_BUDGET_CHARS=8000 # Total text budget per AI request
REDDIT_AI_TIMEOUT_MS=0             # Per AI extraction timeout in ms (default: disabled)
REDDIT_AI_MAX_RETRIES=2            # Retries for AI extraction failures/timeouts
REDDIT_TMDB_VALIDATE_LIMIT=150     # Max titles to validate (0 = validate all)
REDDIT_TMDB_CONCURRENCY=5          # Parallel title checks
REDDIT_TMDB_RPS=10                 # TMDB requests/sec cap across all workers
REDDIT_TMDB_TIMEOUT_MS=10000       # Per-request timeout in ms
REDDIT_TMDB_MAX_RETRIES=2          # Retries for 429/5xx/timeouts
```

### Commands

```bash
# Run scrape (respects cache - skips if data is fresh)
npm run scrape:reddit

# Force scrape (ignores cache)
npm run scrape:reddit -- --force

# Or directly
node scripts/scrapeReddit.mjs
node scripts/scrapeReddit.mjs --force
```

### Default Subreddits

| Subreddit | Description |
|-----------|-------------|
| `MovieSuggestions` | Primary recommendation subreddit (~2M members) |
| `movies` | General movie discussion (~35M members) |
| `flicks` | Quality-focused movie discussion (~150K members) |
| `TrueFilm` | Analytical film discussion (~1.5M members) |
| `horror` | Horror genre recommendations (~3M members) |
| `scifi` | Sci-fi genre recommendations (~2M members) |
| `televisionsuggestions` | TV show recommendations |

### How It Works

1. **Fetch Reddit Data**: Gets top posts and comments from configured subreddits
2. **AI Extraction**: Sends batched text to the Codex agent (via `@openai/codex-sdk`) with a JSON output schema to extract movie/show names
3. **TMDB Validation**: Validates each extracted title against TMDB API
4. **Save to Database**: Stores validated recommendations with mention counts and sentiment

### Cache Behavior

- Default cache TTL: **1 week** (168 hours)
- Cache is **invalidated** if:
  - Data is older than TTL
  - Subreddit list has changed
- Use `--force` to bypass cache

### Build Integration

The scraper runs automatically during `npm run build`:

```bash
npm run build          # Runs migrations + TypeScript + Reddit scrape
npm run build:no-scrape  # Runs migrations + TypeScript only (faster for dev)
```

By default, the scraper exits early when running in CI (`CI`, `VERCEL`, `GITHUB_ACTIONS`, or `GITLAB_CI`), so builds stay fast and avoid Reddit datacenter IP blocks. Set `REDDIT_SCRAPE_IN_CI=true` to opt in.

### Output

Recommendations are stored in the `reddit_recommendations` table and used to boost movie scores in the recommendation algorithm. Movies mentioned frequently on Reddit get higher visibility in "For You" recommendations.
