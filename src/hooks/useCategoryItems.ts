import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useCallback, useMemo } from "react";
import {
  fetchCategoryRecommendationsApi,
  fetchGenreListApi,
  fetchMoviesByGenreApi,
  fetchTvByGenreApi,
  fetchNowPlayingMoviesApi,
  fetchUserPreferencesApi,
  fetchUserRegion,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useWatchedStatus } from "@/hooks/useWatchedStatus";
import { useNotInterestedStatus } from "@/hooks/useNotInterestedStatus";
import { CategoryRecommendationsResponse, Genre, UserPreferences } from "@/lib/types";
import {
  CATEGORY_OVERVIEW_FETCH_LIMIT,
  dedupeRecommendations,
  excludeFeedbackRecommendations,
  getCategoryRecommendationsOverviewQueryKey,
  getPreferencesQueryKey,
  getRecommendationMediaId,
  getSharedPersonalizedGenreInfiniteQueryOptions,
  getSharedPersonalizedTheatricalInfiniteQueryOptions,
  mergePreviewWithPagedRecommendations,
} from "@/lib/recommendationQueries";

export const NOW_PLAYING_GENRE_ID = "now-playing";

// Sort so items whose primary genre (genre_ids[0]) is `genreId` come first.
function orderByPrimaryGenre<T extends { genre_ids?: number[] }>(items: T[], genreId: number): T[] {
  const rankOf = (item: T): number => {
    const position = item.genre_ids?.indexOf(genreId) ?? -1;
    return position < 0 ? Number.MAX_SAFE_INTEGER : position;
  };

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rankDiff = rankOf(a.item) - rankOf(b.item);
      return rankDiff !== 0 ? rankDiff : a.index - b.index;
    })
    .map(({ item }) => item);
}

export interface UseCategoryItemsParams {
  mediaType: "movie" | "tv";
  genreId: string | undefined;
  enabled?: boolean;
}

// Shared data layer for a single category's item grid.
export function useCategoryItems({ mediaType, genreId, enabled = true }: UseCategoryItemsParams) {
  const isTheatrical = genreId === NOW_PLAYING_GENRE_ID;
  const genreIdNum = isTheatrical ? 0 : parseInt(genreId || "0", 10);
  const hasSelection = enabled && !!mediaType && (isTheatrical || !!genreIdNum);
  const { user } = useAuth();

  // User preferences gate personalization.
  const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
    queryKey: getPreferencesQueryKey(user?.id),
    queryFn: fetchUserPreferencesApi,
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const categoryRecommendationsEnabled = preferencesData?.preferences?.category_recommendations_enabled ?? false;
  const recommendationsEnabled = preferencesData?.preferences?.recommendations_enabled ?? false;
  const showPersonalized = Boolean(user && categoryRecommendationsEnabled && recommendationsEnabled);
  const showNotInterested = recommendationsEnabled && categoryRecommendationsEnabled;
  // Wait for preferences before choosing default vs. personalized, otherwise the
  // default query renders first and the grid swaps once preferences resolve.
  const preferencesReady = !user || preferencesData !== undefined;

  const { data: userRegion } = useQuery({
    queryKey: ["userRegion"],
    queryFn: fetchUserRegion,
    staleTime: Infinity,
  });

  // Genre list (names + ids) for the current media type.
  const { data: genreData, isLoading: isLoadingGenres } = useQuery({
    queryKey: ["genres", mediaType],
    queryFn: () => fetchGenreListApi(mediaType),
    staleTime: 1000 * 60 * 60,
    enabled: !!mediaType,
  });

  const genres: Genre[] = genreData?.genres ?? [];
  const genreName = isTheatrical
    ? "Theatrical Releases"
    : genres.find((g) => g.id === genreIdNum)?.name || "Category";

  // Fetched for all personalized loads (not just when a genre is selected) so the
  // page can default to the user's most preferred category.
  const { data: categoryOverviewData, isLoading: isLoadingCategoryOverview } = useQuery<CategoryRecommendationsResponse>({
    queryKey: getCategoryRecommendationsOverviewQueryKey(user?.id, mediaType, CATEGORY_OVERVIEW_FETCH_LIMIT),
    queryFn: () => fetchCategoryRecommendationsApi(mediaType, CATEGORY_OVERVIEW_FETCH_LIMIT),
    staleTime: 1000 * 60 * 10,
    enabled: showPersonalized && !!user?.id,
  });

  // Categories come back ranked by affinity, so the first is the most preferred.
  const preferredGenreId = categoryOverviewData?.categories?.[0]?.genre.id;

  const {
    data: personalizedData,
    isLoading: isLoadingPersonalized,
    isFetchingNextPage: isFetchingNextPagePersonalized,
    hasNextPage: hasNextPagePersonalized,
    fetchNextPage: fetchNextPagePersonalized,
  } = useInfiniteQuery({
    ...(isTheatrical
      ? getSharedPersonalizedTheatricalInfiniteQueryOptions(user?.id, userRegion)
      : getSharedPersonalizedGenreInfiniteQueryOptions(user?.id, mediaType, genreIdNum)),
    enabled: hasSelection && showPersonalized,
  });

  const {
    data: defaultData,
    isLoading: isLoadingDefault,
    isFetchingNextPage: isFetchingNextPageDefault,
    hasNextPage: hasNextPageDefault,
    fetchNextPage: fetchNextPageDefault,
  } = useInfiniteQuery({
    queryKey: isTheatrical
      ? ["movies", "now_playing", userRegion ?? null, "all"]
      : ["genre", mediaType, genreIdNum, "all"],
    queryFn: ({ pageParam = 1 }) => {
      if (isTheatrical) {
        return fetchNowPlayingMoviesApi(pageParam, userRegion);
      }
      return mediaType === "movie"
        ? fetchMoviesByGenreApi(genreIdNum, pageParam)
        : fetchTvByGenreApi(genreIdNum, pageParam);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.total_pages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    staleTime: 1000 * 60 * 10,
    enabled: hasSelection && preferencesReady && !showPersonalized,
  });

  const data = showPersonalized ? personalizedData : defaultData;
  const isFetchingNextPage = showPersonalized ? isFetchingNextPagePersonalized : isFetchingNextPageDefault;
  const hasNextPage = showPersonalized ? hasNextPagePersonalized : hasNextPageDefault;
  const fetchNextPage = showPersonalized ? fetchNextPagePersonalized : fetchNextPageDefault;

  const personalizedSeedResults = useMemo(() => {
    if (!showPersonalized || isTheatrical) {
      return [];
    }
    return categoryOverviewData?.categories.find((category) => category.genre.id === genreIdNum)?.results ?? [];
  }, [showPersonalized, isTheatrical, categoryOverviewData, genreIdNum]);

  const hasPagedData = (data?.pages?.length ?? 0) > 0;
  const hasSeedData = showPersonalized && !isTheatrical && personalizedSeedResults.length > 0;
  const isInitialPagedLoad = showPersonalized && !hasPagedData && isLoadingPersonalized;

  // In personalized mode the grid merges the overview "seed" (shown first) with
  // paged results. Wait for the overview to settle before the first paint so the
  // ordering is fixed up front and later pages only append (no reorder swap).
  const isLoadingPersonalizedGrid = isTheatrical
    ? !hasPagedData && isLoadingPersonalized
    : isLoadingCategoryOverview || (!hasSeedData && !hasPagedData && isLoadingPersonalized);

  const isLoading = !hasSelection
    ? false
    : !preferencesReady
      ? true
      : showPersonalized
        ? isLoadingPersonalizedGrid
        : isLoadingDefault;

  const allMovies = useMemo(() => {
    if (showPersonalized && !isTheatrical && personalizedSeedResults.length > 0) {
      const pagedResults = data?.pages.flatMap((page) => page.results) ?? [];
      return mergePreviewWithPagedRecommendations(personalizedSeedResults, pagedResults);
    }

    // Order each page so primary-genre matches come first (sort per page to keep infinite scroll stable).
    const shouldOrderByPrimaryGenre = !showPersonalized && !isTheatrical && !!genreIdNum;
    const pagedResults = shouldOrderByPrimaryGenre
      ? (data?.pages.flatMap((page) => orderByPrimaryGenre(page.results, genreIdNum)) ?? [])
      : (data?.pages.flatMap((page) => page.results) ?? []);

    return dedupeRecommendations(pagedResults);
  }, [data, showPersonalized, isTheatrical, personalizedSeedResults, genreIdNum]);

  const totalResults = showPersonalized
    ? personalizedData?.pages[0]?.total_results || personalizedSeedResults.length
    : defaultData?.pages[0]?.total_results || 0;

  const sourceCollections = showPersonalized
    ? personalizedData?.pages[0]?.sourceCollections || categoryOverviewData?.sourceCollections || []
    : [];
  const totalSourceItems = showPersonalized
    ? personalizedData?.pages[0]?.totalSourceItems || categoryOverviewData?.totalSourceItems || 0
    : 0;

  const mediaIds = useMemo(
    () => allMovies.map((movie) => getRecommendationMediaId(movie, mediaType)),
    [allMovies, mediaType],
  );

  const { watchedMap, isLoading: isLoadingWatched } = useWatchedStatus(mediaIds);
  const { notInterestedMap, isLoading: isLoadingNotInterested } = useNotInterestedStatus(
    showNotInterested ? mediaIds : [],
  );
  const isFeedbackStatusLoading = showPersonalized && (isLoadingWatched || isLoadingNotInterested);

  const visibleMovies = useMemo(
    () =>
      showPersonalized
        ? excludeFeedbackRecommendations(
            allMovies,
            watchedMap,
            showNotInterested ? notInterestedMap : {},
            mediaType,
          ).filter((movie) => movie.poster_path)
        : allMovies,
    [allMovies, watchedMap, notInterestedMap, showPersonalized, showNotInterested, mediaType],
  );

  // Infinite scroll trigger.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasNextPage) {
            fetchNextPage();
          }
        },
        { rootMargin: "200px" },
      );
      if (node) {
        observerRef.current.observe(node);
      }
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage],
  );

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return {
    // selection metadata
    isTheatrical,
    genres,
    genreName,
    isLoadingGenres,
    // personalization flags
    showPersonalized,
    showNotInterested,
    preferencesReady,
    // most preferred genre (for default selection)
    preferredGenreId,
    isLoadingPreferredGenre: isLoadingCategoryOverview,
    // grid data
    visibleMovies,
    watchedMap,
    notInterestedMap,
    totalResults,
    sourceCollections,
    totalSourceItems,
    // loading states
    isLoading: isLoading || isFeedbackStatusLoading,
    isFetchingNextPage,
    isInitialPagedLoad,
    // infinite scroll
    loadMoreRef,
  };
}
