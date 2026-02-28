import { Movie } from "@/lib/types";
import { MovieCard } from "./MovieCard";
import { useWatchedStatus } from "@/hooks/useWatchedStatus";
import { useNotInterestedStatus } from "@/hooks/useNotInterestedStatus";
import { useMemo } from "react";

interface MovieGridProps {
  movies: Movie[];
  title?: string;
  showNotInterested?: boolean;
}

export function MovieGrid({ movies, title, showNotInterested = false }: MovieGridProps) {
  // Generate media IDs for watched status lookup
  const mediaIds = useMemo(() => 
    movies.map(movie => {
      const isTV = !!movie.first_air_date;
      return isTV ? `${movie.id}tv` : String(movie.id);
    }),
    [movies]
  );

  const { watchedMap } = useWatchedStatus(mediaIds);
  const { notInterestedMap } = useNotInterestedStatus(showNotInterested ? mediaIds : []);

  if (movies.length === 0) {
    return (
      <div className="text-center py-16 rounded-2xl bg-muted/30 border border-border">
        <h2 className="text-xl font-semibold mb-2">
          {title ? title : "No movies found"}
        </h2>
        <p className="text-muted-foreground text-sm">
          Try searching for something else or check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {title && (
        <div className="flex items-center gap-3">
          <div className="h-6 w-1 rounded-full bg-primary" />
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight">{title}</h2>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 lg:grid-cols-5">
        {movies.map((movie) => {
          const isTV = !!movie.first_air_date;
          const mediaId = isTV ? `${movie.id}tv` : String(movie.id);
          return (
            <MovieCard
              key={movie.id}
              movie={movie}
              isWatched={watchedMap[mediaId] ?? false}
              isNotInterested={notInterestedMap[mediaId] ?? false}
              showNotInterested={showNotInterested}
            />
          );
        })}
      </div>
    </div>
  );
}

export default MovieGrid;
