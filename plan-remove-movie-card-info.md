# Plan: Remove title/info from MovieCard, keep three-dot menu

## Context
The user wants a cleaner movie card that shows only the poster image and the three-dot menu (for watched/not-interested actions). The title, release year, rating, and "because you liked" text should be removed.

## File to modify
`/Users/murtuzaalisurti/Documents/Development/mbuffs/src/components/MovieCard.tsx`

## Changes

### 1. Remove the Title Overlay section (lines 288–308)
Delete the entire `{/* Title Overlay */}` block:
```tsx
{/* Title Overlay */}
<div className="absolute bottom-0 left-0 right-0 p-3 flex flex-col justify-end z-10">
  <h3 ...>{movie.name || movie.title}</h3>
  <div ...>  {/* year, rating */} </div>
  {shouldShowBecauseYouLiked && (...)}
</div>
```

### 2. Remove the `Star` import (line 3)
`Star` is only used in the rating display. Remove it from the lucide-react import.

### 3. Remove unused variables (lines 37–53)
These are only used for the title overlay:
- `releaseYear` (line 37–39)
- `becauseYouLiked` (line 44)
- `meetsExplainabilityCondition` (lines 47–51)
- `randomBucket` (line 52)
- `shouldShowBecauseYouLiked` (line 53)

### 4. Simplify the gradient overlay (line 216)
The heavy bottom gradient (`from-black/90 via-black/40`) was there to make the title readable. Without the title, lighten it or remove it. I'll reduce it to a subtle overlay so the three-dot menu remains visible.

## Verification
- Run `npm run dev` / dev server and visually confirm cards show poster + three-dot menu only, no title/year/rating/explainability text.
- Confirm the three-dot menu still works (watched, not interested actions).
- Check TypeScript compiles cleanly (`npx tsc --noEmit` or build).
