# Plan: Shared Recommendation Pool Architecture

## Context

The "For You" infinite scroll is slow because every page request runs the **entire recommendation pipeline** independently: sampling 10 source movies, making 40+ live TMDB API calls, building a candidate pool, running the full ranking pipeline, and then slicing to extract just 60 items. Pages are cached independently, so page 2 repeats all the work page 1 already did.

Meanwhile, category recommendations already call `generateRecommendations()` once with a large limit (240-500 items) and work from that single pool. The fix is to make For You work the same way: generate one large pool, cache it, and paginate cheaply from it.

## Approach

Introduce `generateRecommendationPool(userId)` that builds a single fully-ranked candidate pool per user per cache window. Both For You pagination and Category bucketing read from this cached pool.

**Single file changed:** `backend/services/recommendationService.ts`  
**Zero frontend changes** -- the API contract (request params + response shape) stays identical.

---

## Steps

### Step 1: Add pool type and cache endpoint

- Add `'for_you_pool'` to `RecommendationCacheEndpoint` union (line 207)
- Add `RecommendationPool` interface after line 205:

```typescript
interface RecommendationPool {
    candidates: RecommendationCandidate[];
    sourceCollections: { id: string; name: string }[];
    totalSourceItems: number;
    genreScores: Record<number, number>;  // serialized Map for category genre ordering
}
```

The `genreScores` field lets category recommendations read genre affinity directly from the pool instead of making 15 extra TMDB calls.

### Step 2: Create `generateRecommendationPool(userId)`

Extract the core pipeline from `generateRecommendations` (lines 1972-2569) into a new function. Key differences from the current code:

| Aspect | Current `generateRecommendations` | New `generateRecommendationPool` |
|--------|----------------------------------|----------------------------------|
| Parameters | `userId, limit, page` | `userId` only |
| Sample size | 10 (line 2038) | 20 |
| Sample seed | includes `page` and `limit` | `${userId}:for-you-pool:${token}` |
| Bandit policy | uses `page`/`limit` params | `page=1`, `limit=candidates.length` |
| Output | `RecommendationResult` (paginated) | `RecommendationPool` (full ranked list) |
| Pagination | `paginateOrderedCandidates` at end | None -- returns all candidates |

The function includes:
- All existing checks (recommendations enabled, source collections, engagement signals)
- Cold start fallback: when no source movies exist, call `generateColdStartRecommendations(userId, 500, 1, sourceCollections)` and wrap its results as a pool (converting `results` back to `RecommendationCandidate[]` with score=0)
- The full pipeline: TMDB fetches, director/actor discover, Reddit injection, Reddit boosts, multi-objective ranking, reranking, contextual bandit, profile jitter
- Returns `genreScores` as `Object.fromEntries(genreScores)` for serialization

### Step 3: Create `getOrGenerateRecommendationPoolCached(userId)`

Wraps pool generation with the existing cache infrastructure:

```typescript
async function getOrGenerateRecommendationPoolCached(userId: string): Promise<RecommendationPool> {
    return withRecommendationContext(userId, () =>
        getCachedRecommendationResult<RecommendationPool>(
            userId,
            'for_you_pool',
            {},  // no page/limit in cache key -- single entry per user
            () => generateRecommendationPool(userId)
        )
    );
}
```

One cache entry per user. 30-minute TTL. Stale-while-revalidate still applies.

### Step 4: Rewrite `generateRecommendations` as thin pagination wrapper

Replace the body of `generateRecommendations` (lines 1972-2569). The function signature stays the same:

```typescript
export async function generateRecommendations(
    userId: string, limit: number = 60, page: number = 1
): Promise<RecommendationResult> {
    // Keep the recommendations_enabled check (lines 1987-1993)
    
    const pool = await getOrGenerateRecommendationPoolCached(userId);
    if (pool.candidates.length === 0) { return emptyResult; }
    
    const totalResults = pool.candidates.length;
    const totalPages = Math.ceil(totalResults / limit);
    const paginatedResults = paginateOrderedCandidates(pool.candidates, page, limit)
        .map(c => c.item);
    
    return {
        results: paginatedResults,
        sourceCollections: pool.sourceCollections,
        totalSourceItems: pool.totalSourceItems,
        page,
        total_pages: totalPages,
        total_results: totalResults,
    };
}
```

Pagination is now a cheap array slice -- no TMDB calls, no ranking.

### Step 5: Simplify `generateRecommendationsCached`

At line 3482, remove the page-2 background prefetch (lines 3496-3499). Since `generateRecommendations` internally calls the cached pool, there's no need for per-page caching here:

```typescript
export async function generateRecommendationsCached(
    userId: string, limit: number = 60, page: number = 1
): Promise<RecommendationResult> {
    return generateRecommendations(userId, limit, page);
}
```

The pool's own cache handles staleness. Per-page caching is unnecessary since pagination is an O(1) slice.

### Step 6: Rewrite `generateCategoryRecommendations` to use pool

At line 2583, replace the function body:

- Replace `generateRecommendations(userId, forYouPoolLimit, 1)` call (line 2619) with `getOrGenerateRecommendationPoolCached(userId)`
- Read `rankedItems` from `pool.candidates.map(c => c.item).filter(item => getItemMediaType(item) === mediaType)` instead of `forYouRecommendations.results.filter(...)`
- **Eliminate the 15 extra TMDB calls** for genre profiling (lines 2639-2679). Instead, populate `sourceGenreScores` directly from `pool.genreScores`:

```typescript
const sourceGenreScores = new Map<number, { id: number; name: string; count: number }>();
for (const [genreIdStr, count] of Object.entries(pool.genreScores)) {
    const id = Number(genreIdStr);
    sourceGenreScores.set(id, {
        id,
        name: genreNameMap.get(id) || `Genre ${id}`,
        count,
    });
}
```

- Remove: `getUserRecommendationCollections`, `getMoviesFromRecommendationCollections`, `getWatchedSeedMovies`, `deterministicSample`, and per-source `getItemDetails` calls
- Keep: the existing genre bucketing logic (lines 2683-2754), `recommendationGenreScores` from ranked items, and category assembly
- Remove: `CATEGORY_FOR_YOU_POOL_MIN` / `CATEGORY_FOR_YOU_POOL_MAX` constants (line 230-231) and `forYouPoolLimit` calculation (lines 2614-2617) -- no longer needed

### Step 7: Update `warmPersonalizedRecommendationCache`

At line 1300, simplify:

```typescript
export function warmPersonalizedRecommendationCache(userId: string): void {
    void Promise.allSettled([
        getOrGenerateRecommendationPoolCached(userId),
        generatePersonalizedTheatricalReleasesCached(userId, 60, 1),
        generatePersonalizedTheatricalReleasesCached(userId, 60, 2),
    ]).catch((error) => {
        console.error("Error warming personalized recommendation cache:", error);
    });
}
```

Removes the 4 separate warm calls (For You pages 1+2, categories movie+tv). One pool generation covers all surfaces.

### Step 8: Bump cache version

At line 218, change `RECOMMENDATION_CACHE_VERSION` from `'v6'` to `'v7'`. Old per-page cache entries will be cleaned up by the existing version-mismatch cleanup logic (line 1122).

## What stays unchanged

- **`generateGenreRecommendations`** (line 2834) -- stays as its own independent pipeline. It has genre-specific TMDB Discover calls and different sampling that don't belong in the general pool.
- **`generateCategoryRecommendationsCached`** (line 3505) -- keeps its own cache layer. Category bucketing is cheap but worth caching to avoid re-running on every request.
- **All frontend files** -- API request/response shapes are identical.
- **Controller, routes, API fetch functions** -- no changes needed.
- **`generateColdStartRecommendations`** (line 1716) -- stays as-is, called by the pool function when needed. Its `page`-dependent seed should also be removed since the pool generates everything at once, but this is the same pattern as the main pipeline.

## Performance impact

| Scenario | Before | After |
|----------|--------|-------|
| For You page 1 (cold) | ~44 TMDB calls + ranking | ~88 TMDB calls + ranking (larger sample, but only once) |
| For You page 2 (cold) | ~44 TMDB calls + ranking | 0 (array slice from cached pool) |
| For You page 3+ (cold) | ~44 TMDB calls + ranking each | 0 each |
| Category overview (cold) | ~44 + 15 = ~59 TMDB calls | 0 (reads from same cached pool) |
| Total for pages 1-3 + categories | ~250 TMDB calls | ~88 TMDB calls |

First request is ~2x the TMDB calls (88 vs 44) due to larger sample size, but this is offset by the warm cache function running on login. All subsequent page requests within the 30-minute window are instant.

## Verification

1. Start the dev server (`npm run dev` or equivalent)
2. Open the For You page -- first load generates the pool
3. Scroll down to trigger page 2, 3 -- should load near-instantly (no visible spinner)
4. Navigate to Categories page -- should load instantly (reads from same pool)
5. Open a specific category detail page -- still uses its own genre pipeline (unchanged)
6. Check the debug cache endpoint (`/api/recommendations/debug/cache`) -- should show a single `for_you_pool` entry instead of multiple `for_you` page entries
7. Wait 30 minutes or invalidate cache -- next request regenerates the pool
8. Run `npx tsc --noEmit` to verify type safety
