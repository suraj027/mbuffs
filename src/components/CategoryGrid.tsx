import { memo, ReactNode } from "react";
import { MovieCard } from "@/components/MovieCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Movie } from "@/lib/types";
import { getRecommendationMediaId } from "@/lib/recommendationQueries";

interface CategoryGridProps {
  movies: Movie[];
  mediaType: "movie" | "tv";
  watchedMap: Record<string, boolean>;
  notInterestedMap: Record<string, boolean>;
  showNotInterested: boolean;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  isInitialPagedLoad: boolean;
  loadMoreRef: (node: HTMLDivElement | null) => void;
  /** Rendered when there are no results and nothing is loading. */
  emptyState?: ReactNode;
}

function GridSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={`skeleton-${index}`} className="space-y-3">
          <Skeleton className="aspect-2/3 w-full rounded-xl" />
          <Skeleton className="h-4 w-[75%] rounded-md" />
          <Skeleton className="h-3 w-[45%] rounded-md" />
        </div>
      ))}
    </>
  );
}

const GRID_CLASSES =
  "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-5";

/**
 * Memoized grid cell. The parent grid re-renders on every infinite-scroll page
 * append and status change; passing only primitive props here lets React skip
 * re-rendering unchanged cards, which keeps large grids smooth while scrolling.
 */
const GridCard = memo(function GridCard({
  movie,
  isWatched,
  isNotInterested,
  showNotInterested,
}: {
  movie: Movie;
  isWatched: boolean;
  isNotInterested: boolean;
  showNotInterested: boolean;
}) {
  return (
    <MovieCard
      movie={movie}
      isWatched={isWatched}
      isNotInterested={isNotInterested}
      showNotInterested={showNotInterested}
    />
  );
});

export function CategoryGrid({
  movies,
  mediaType,
  watchedMap,
  notInterestedMap,
  showNotInterested,
  isLoading,
  isFetchingNextPage,
  isInitialPagedLoad,
  loadMoreRef,
  emptyState,
}: CategoryGridProps) {
  if (isLoading) {
    return (
      <div className={GRID_CLASSES}>
        <GridSkeletons count={18} />
      </div>
    );
  }

  if (movies.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <div className={GRID_CLASSES}>
        {movies.map((movie, index) => {
          const mediaId = getRecommendationMediaId(movie, mediaType);
          return (
            <GridCard
              key={`${movie.id}-${index}`}
              movie={movie}
              isWatched={watchedMap[mediaId] ?? false}
              isNotInterested={notInterestedMap[mediaId] ?? false}
              showNotInterested={showNotInterested}
            />
          );
        })}
        {(isFetchingNextPage || isInitialPagedLoad) && <GridSkeletons count={6} />}
      </div>

      {/* Infinite scroll trigger */}
      <div ref={loadMoreRef} />
    </>
  );
}

export default CategoryGrid;
