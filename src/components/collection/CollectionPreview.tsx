import { useQuery } from '@tanstack/react-query';
import { fetchMovieDetailsApi, fetchTvDetailsApi, getImageUrl } from '@/lib/api';
import { Film } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollectionPreviewProps {
  movieIds?: (number | string)[];
  /** Size classes for the tile. Defaults to `h-14 w-14`. */
  className?: string;
}

/** Poster collage tile used to represent a collection across the app. */
export const CollectionPreview = ({ movieIds, className }: CollectionPreviewProps) => {
  const { data: moviesData } = useQuery({
    queryKey: ['preview-movies', movieIds],
    queryFn: async () => {
      if (!movieIds || movieIds.length === 0) return [];
      const promises = movieIds.slice(0, 4).map((id) => {
        const idStr = String(id);
        if (idStr.includes('tv')) {
          const numericId = parseInt(idStr.replace('tv', ''), 10);
          return fetchTvDetailsApi(numericId).catch(() => null);
        } else {
          return fetchMovieDetailsApi(Number(id)).catch(() => null);
        }
      });
      return Promise.all(promises);
    },
    enabled: !!movieIds && movieIds.length > 0,
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  const posters = moviesData?.filter(Boolean).map((m) => m?.poster_path) ?? [];
  const sizeClass = className ?? 'h-14 w-14';

  if (posters.length === 0) {
    return (
      <div className={cn('rounded-lg bg-muted flex items-center justify-center shrink-0', sizeClass)}>
        <Film className="h-1/3 w-1/3 text-muted-foreground" />
      </div>
    );
  }

  if (posters.length === 1) {
    return (
      <div className={cn('rounded-lg overflow-hidden shrink-0 bg-muted', sizeClass)}>
        <img src={getImageUrl(posters[0], 'w92')} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  if (posters.length === 2) {
    return (
      <div className={cn('rounded-lg overflow-hidden shrink-0 grid grid-cols-2 gap-0.5 bg-muted', sizeClass)}>
        {posters.map((poster, i) => (
          <div key={i} className="overflow-hidden bg-muted">
            <img src={getImageUrl(poster, 'w92')} alt="" className="h-full w-full object-cover" />
          </div>
        ))}
      </div>
    );
  }

  if (posters.length === 3) {
    return (
      <div className={cn('rounded-lg overflow-hidden shrink-0 grid grid-cols-2 gap-0.5 bg-muted', sizeClass)}>
        <div className="row-span-2 overflow-hidden bg-muted">
          <img src={getImageUrl(posters[0], 'w92')} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="overflow-hidden bg-muted">
          <img src={getImageUrl(posters[1], 'w92')} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="overflow-hidden bg-muted">
          <img src={getImageUrl(posters[2], 'w92')} alt="" className="h-full w-full object-cover" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg overflow-hidden shrink-0 grid grid-cols-2 grid-rows-2 gap-0.5 bg-muted', sizeClass)}>
      {posters.slice(0, 4).map((poster, i) => (
        <div key={i} className="overflow-hidden bg-muted">
          <img src={getImageUrl(poster, 'w92')} alt="" className="h-full w-full object-cover" />
        </div>
      ))}
    </div>
  );
};

export default CollectionPreview;
