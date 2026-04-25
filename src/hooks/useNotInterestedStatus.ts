import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getNotInterestedStatusBatchApi } from '@/lib/api';
import { useAuth } from './useAuth';

/**
 * Hook to fetch not interested status for a list of movies/shows.
 * Returns a map of mediaId -> isNotInterested boolean.
 *
 * Uses keepPreviousData so that when the mediaIds list grows (e.g. infinite
 * scroll appends a new page), the existing statuses stay visible while the
 * expanded batch query loads – preventing items from flashing back into view.
 */
export function useNotInterestedStatus(mediaIds: string[]) {
    const { isLoggedIn } = useAuth();
    
    const { data, isLoading } = useQuery({
        queryKey: ['notInterestedBatch', ...[...mediaIds].sort()],
        queryFn: () => getNotInterestedStatusBatchApi(mediaIds),
        enabled: isLoggedIn && mediaIds.length > 0,
        staleTime: 30000, // Consider data fresh for 30 seconds
        placeholderData: keepPreviousData,
    });

    const notInterestedMap: Record<string, boolean> = {};

    if (data?.notInterestedStatus) {
        for (const [id, status] of Object.entries(data.notInterestedStatus)) {
            notInterestedMap[id] = status.isNotInterested;
        }
    }

    return {
        notInterestedMap,
        isLoading,
    };
}
