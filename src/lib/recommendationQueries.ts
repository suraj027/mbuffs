import {
  fetchGenreRecommendationsApi,
  fetchRecommendationsApi,
  fetchTheatricalRecommendationsApi,
} from "@/lib/api";
import { RecommendationsResponse } from "@/lib/types";

export const FOR_YOU_PREVIEW_ITEMS_PER_PAGE = 24;
export const FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE = 60;
export const CATEGORY_PREVIEW_ITEMS_PER_ROW = 10;
export const CATEGORY_FULL_PAGE_ITEMS_PER_PAGE = 60;
export const CATEGORY_OVERVIEW_FETCH_LIMIT = 50;
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

export const getCategoryRecommendationsQueryKey = (userId?: string | null) =>
  ['recommendations', 'categories', userId ?? null] as const;

export const getCategoryRecommendationsOverviewQueryKey = (
  userId?: string | null,
  mediaType: 'movie' | 'tv' = 'movie',
  limit: number = CATEGORY_OVERVIEW_FETCH_LIMIT,
) => [...getCategoryRecommendationsQueryKey(userId), 'overview', mediaType, limit] as const;

export const getPersonalizedGenreRecommendationsQueryKey = (
  userId: string | null | undefined,
  mediaType: 'movie' | 'tv',
  genreId: number,
) => [...getCategoryRecommendationsQueryKey(userId), 'genre', mediaType, genreId] as const;

export const getPersonalizedGenreRecommendationsPageQueryKey = (
  userId: string | null | undefined,
  mediaType: 'movie' | 'tv',
  genreId: number,
  limit: number = CATEGORY_FULL_PAGE_ITEMS_PER_PAGE,
) => [...getPersonalizedGenreRecommendationsQueryKey(userId, mediaType, genreId), limit] as const;

export const getPersonalizedTheatricalRecommendationsQueryKey = (userId?: string | null) =>
  [...getCategoryRecommendationsQueryKey(userId), 'theatrical'] as const;

export const getPersonalizedTheatricalRecommendationsPageQueryKey = (
  userId?: string | null,
  limit: number = CATEGORY_FULL_PAGE_ITEMS_PER_PAGE,
) => [...getPersonalizedTheatricalRecommendationsQueryKey(userId), limit] as const;

const getPagedRecommendationsInfiniteQueryOptions = (
  queryKey: readonly unknown[],
  queryFn: (pageParam: number) => Promise<RecommendationsResponse>,
  staleTime: number = FOR_YOU_QUERY_STALE_TIME,
) => ({
  queryKey,
  queryFn: ({ pageParam = 1 }: { pageParam: number }) => queryFn(pageParam),
  initialPageParam: 1,
  getNextPageParam: (lastPage: RecommendationsResponse) => {
    if (lastPage.page < lastPage.total_pages) {
      return lastPage.page + 1;
    }
    return undefined;
  },
  staleTime,
});

type RecommendationWithId = { id: number };

export const dedupeRecommendations = <T extends RecommendationWithId>(
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

export const selectPreviewRecommendations = <T extends RecommendationWithId>(
  recommendations: T[],
  previewLimit: number,
): T[] => dedupeRecommendations(recommendations).slice(0, previewLimit);

const getForYouInfiniteQueryOptions = (
  userId?: string | null,
  limit: number = FOR_YOU_PREVIEW_ITEMS_PER_PAGE,
) => getPagedRecommendationsInfiniteQueryOptions(
  getForYouRecommendationsPageQueryKey(userId, limit),
  (pageParam) => fetchRecommendationsApi(limit, pageParam),
);

export const dedupeForYouRecommendations = dedupeRecommendations;

export const selectForYouPreviewRecommendations = <T extends RecommendationWithId>(
  recommendations: T[],
  previewLimit: number = FOR_YOU_PREVIEW_ITEMS_PER_PAGE,
): T[] => selectPreviewRecommendations(recommendations, previewLimit);

export const selectCategoryPreviewRecommendations = <T extends RecommendationWithId>(
  recommendations: T[],
  previewLimit: number = CATEGORY_PREVIEW_ITEMS_PER_ROW,
): T[] => selectPreviewRecommendations(recommendations, previewLimit);

export const mergePreviewWithPagedRecommendations = <T extends RecommendationWithId>(
  previewRecommendations: T[],
  pagedRecommendations: T[],
): T[] => dedupeRecommendations([...previewRecommendations, ...pagedRecommendations]);

export const getSharedForYouInfiniteQueryOptions = (userId?: string | null) =>
  getForYouInfiniteQueryOptions(userId, FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE);

export const getSharedPersonalizedGenreInfiniteQueryOptions = (
  userId: string | null | undefined,
  mediaType: 'movie' | 'tv',
  genreId: number,
) => getPagedRecommendationsInfiniteQueryOptions(
  getPersonalizedGenreRecommendationsPageQueryKey(
    userId,
    mediaType,
    genreId,
    CATEGORY_FULL_PAGE_ITEMS_PER_PAGE,
  ),
  (pageParam) => fetchGenreRecommendationsApi(
    genreId,
    mediaType,
    CATEGORY_FULL_PAGE_ITEMS_PER_PAGE,
    pageParam,
  ),
);

export const getSharedPersonalizedTheatricalInfiniteQueryOptions = (userId?: string | null) =>
  getPagedRecommendationsInfiniteQueryOptions(
    getPersonalizedTheatricalRecommendationsPageQueryKey(
      userId,
      CATEGORY_FULL_PAGE_ITEMS_PER_PAGE,
    ),
    (pageParam) => fetchTheatricalRecommendationsApi(CATEGORY_FULL_PAGE_ITEMS_PER_PAGE, pageParam),
  );
