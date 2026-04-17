import { fetchRecommendationsApi } from "@/lib/api";
import { RecommendationsResponse } from "@/lib/types";

export const FOR_YOU_PREVIEW_ITEMS_PER_PAGE = 24;
export const FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE = 60;
// Backward-compatible alias for preview surfaces.
export const FOR_YOU_ITEMS_PER_PAGE = FOR_YOU_PREVIEW_ITEMS_PER_PAGE;
export const FOR_YOU_QUERY_STALE_TIME = 1000 * 60 * 5;
export const getPreferencesQueryKey = (userId?: string | null) =>
  ['user', 'preferences', userId ?? null] as const;

export const getForYouRecommendationsQueryKey = (userId?: string | null) =>
  ['recommendations', 'all', userId ?? null] as const;

export const getForYouRecommendationsPageQueryKey = (
  userId?: string | null,
  limit: number = FOR_YOU_PREVIEW_ITEMS_PER_PAGE,
) => [...getForYouRecommendationsQueryKey(userId), limit] as const;

const getForYouInfiniteQueryOptions = (
  userId?: string | null,
  limit: number = FOR_YOU_PREVIEW_ITEMS_PER_PAGE,
) => ({
  queryKey: getForYouRecommendationsPageQueryKey(userId, limit),
  queryFn: ({ pageParam = 1 }: { pageParam: number }) => fetchRecommendationsApi(limit, pageParam),
  initialPageParam: 1,
  getNextPageParam: (lastPage: RecommendationsResponse) => {
    if (lastPage.page < lastPage.total_pages) {
      return lastPage.page + 1;
    }
    return undefined;
  },
  staleTime: FOR_YOU_QUERY_STALE_TIME,
});

type RecommendationWithId = { id: number };

export const dedupeForYouRecommendations = <T extends RecommendationWithId>(
  recommendations: T[],
): T[] => {
  const seenIds = new Set<number>();
  const deduplicated: T[] = [];

  for (const recommendation of recommendations) {
    if (seenIds.has(recommendation.id)) {
      continue;
    }

    seenIds.add(recommendation.id);
    deduplicated.push(recommendation);
  }

  return deduplicated;
};

export const selectForYouPreviewRecommendations = <T extends RecommendationWithId>(
  recommendations: T[],
  previewLimit: number = FOR_YOU_PREVIEW_ITEMS_PER_PAGE,
): T[] => dedupeForYouRecommendations(recommendations).slice(0, previewLimit);

export const getSharedForYouInfiniteQueryOptions = (userId?: string | null) =>
  getForYouInfiniteQueryOptions(userId, FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE);
