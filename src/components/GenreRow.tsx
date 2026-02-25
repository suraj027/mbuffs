import { Link } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";
import { Movie, Genre } from "@/lib/types";
import { MovieCard } from "./MovieCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchedStatus } from "@/hooks/useWatchedStatus";
import { useNotInterestedStatus } from "@/hooks/useNotInterestedStatus";
import { useMemo } from "react";

export interface GenreRowProps {
  genre?: Genre;
  title?: string;
  movies: Movie[];
  mediaType: 'movie' | 'tv';
  isLoading?: boolean;
  limit?: number;
  hideSeeAll?: boolean;
  customLink?: string;
  isPersonalized?: boolean;
  showNotInterested?: boolean;
}

export function GenreRow({
  genre,
  title,
  movies,
  mediaType,
  isLoading = false,
  limit = 10,
  hideSeeAll = false,
  customLink,
  isPersonalized = false,
  showNotInterested = false
}: GenreRowProps) {
  const displayMovies = movies.slice(0, limit);
  
  // Generate media IDs for watched status lookup
  const mediaIds = useMemo(() => 
    displayMovies.map(movie => {
      const isTV = !!movie.first_air_date;
      return isTV ? `${movie.id}tv` : String(movie.id);
    }),
    [displayMovies]
  );

  const { watchedMap } = useWatchedStatus(mediaIds);
  const { notInterestedMap } = useNotInterestedStatus(showNotInterested ? mediaIds : []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-32 rounded-lg" />
          <Skeleton className="h-5 w-16 rounded-md" />
        </div>
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="shrink-0 w-[140px] sm:w-[160px] md:w-[180px]">
              <Skeleton className="aspect-2/3 w-full rounded-xl" />
              <Skeleton className="h-4 w-[75%] mt-3 rounded-md" />
              <Skeleton className="h-3 w-[45%] mt-2 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (displayMovies.length === 0) {
    return null;
  }

  const rowTitle = title || genre?.name || "";
  const linkTarget = customLink || (genre?.id ? `/categories/${mediaType}/${genre.id}` : null);
  const showSeeAll = !hideSeeAll && linkTarget;

  return (
    <div className="space-y-4">
      {/* Header with title and See All link */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-6 w-1 rounded-full ${isPersonalized ? 'bg-gradient-to-b from-primary to-purple-500' : 'bg-primary'}`} />
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
            {rowTitle}
            {isPersonalized && (
              <Sparkles className="h-4 w-4 text-primary" />
            )}
          </h2>
        </div>
        {showSeeAll && (
          <Link
            to={linkTarget}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors group"
          >
            <span>See all</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>

      {/* Scrollable row */}
      <div className="relative -mx-4 px-4">
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide scroll-smooth">
          {displayMovies.map((movie) => {
            const isTV = !!movie.first_air_date;
            const mediaId = isTV ? `${movie.id}tv` : String(movie.id);
            return (
              <div
                key={movie.id}
                className="shrink-0 w-[140px] sm:w-[160px] md:w-[180px]"
              >
                <MovieCard
                  movie={movie}
                  isWatched={watchedMap[mediaId] ?? false}
                  isNotInterested={notInterestedMap[mediaId] ?? false}
                  showNotInterested={showNotInterested}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default GenreRow;
