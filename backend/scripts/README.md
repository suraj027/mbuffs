# Backend Scripts

## Reddit Scraper

Scrapes movie/TV show recommendations from Reddit using AI-powered extraction (OpenRouter) and validates against TMDB.

### Setup

Add these environment variables to your `.env`:

```env
# Required
OPENROUTER_API_KEY=your_key_here   # Get free key at https://openrouter.ai/
TMDB_API_KEY=your_tmdb_key         # For validating movie titles
DATABASE_URL=your_neon_db_url      # For storing recommendations

# Optional
REDDIT_SUBREDDITS=MovieSuggestions,movies,horror  # Comma-separated list (default: see below)
REDDIT_POSTS_PER_SUB=25            # Posts to fetch per subreddit (default: 25)
REDDIT_MIN_SCORE=10                # Minimum upvote score (default: 10)
REDDIT_TIMEFRAME=week              # hour|day|week|month|year|all (default: week)
REDDIT_CACHE_TTL_HOURS=168         # Cache validity in hours (default: 168 = 1 week)
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
2. **AI Extraction**: Sends batched text to `z-ai/glm-4.5-air:free` model via OpenRouter to extract movie/show names
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

### Output

Recommendations are stored in the `reddit_recommendations` table and used to boost movie scores in the recommendation algorithm. Movies mentioned frequently on Reddit get higher visibility in "For You" recommendations.
