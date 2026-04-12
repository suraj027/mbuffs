import { fetchRecommendationsApi } from "@/lib/api";
import { RecommendationsResponse } from "@/lib/types";

export const FOR_YOU_ITEMS_PER_PAGE = 24;
export const FOR_YOU_QUERY_STALE_TIME = 1000 * 60 * 5;
export const getPreferencesQueryKey = (userId?: string | null) =>
  ['user', 'preferences', userId ?? null] as const;

export const getForYouRecommendationsQueryKey = (userId?: string | null) =>
  ['recommendations', 'all', FOR_YOU_ITEMS_PER_PAGE, userId ?? null] as const;

export const getForYouInfiniteQueryOptions = (userId?: string | null) => ({
  queryKey: getForYouRecommendationsQueryKey(userId),
  queryFn: ({ pageParam = 1 }: { pageParam: number }) => fetchRecommendationsApi(FOR_YOU_ITEMS_PER_PAGE, pageParam),
  initialPageParam: 1,
  getNextPageParam: (lastPage: RecommendationsResponse) => {
    if (lastPage.page < lastPage.total_pages) {
      return lastPage.page + 1;
    }
    return undefined;
  },
  staleTime: FOR_YOU_QUERY_STALE_TIME,
});
