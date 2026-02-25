import { useQuery } from '@tanstack/react-query';
import { getWatchedStatusBatchApi } from '@/lib/api';
import { useAuth } from './useAuth';

/**
 * Hook to fetch watched status for a list of movies/shows
 * Returns a map of mediaId -> isWatched boolean
 */
export function useWatchedStatus(mediaIds: string[]) {
    const { isLoggedIn } = useAuth();
    
    const { data, isLoading } = useQuery({
        queryKey: ['watchedBatch', ...[...mediaIds].sort()],
        queryFn: () => getWatchedStatusBatchApi(mediaIds),
        enabled: isLoggedIn && mediaIds.length > 0,
        staleTime: 30000, // Consider data fresh for 30 seconds
    });

    const watchedMap: Record<string, boolean> = {};
    
    if (data?.watchedStatus) {
        for (const [id, status] of Object.entries(data.watchedStatus)) {
            watchedMap[id] = status.isWatched;
        }
    }

    return {
        watchedMap,
        isLoading,
    };
}
