import { useParams, Link } from "react-router-dom";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useCallback, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { MovieCard } from "@/components/MovieCard";
import { 
  fetchGenreListApi, 
  fetchMoviesByGenreApi, 
  fetchTvByGenreApi, 
  fetchNowPlayingMoviesApi,
  fetchGenreRecommendationsApi,
  fetchTheatricalRecommendationsApi,
  fetchUserPreferencesApi
} from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWatchedStatus } from "@/hooks/useWatchedStatus";
import { useNotInterestedStatus } from "@/hooks/useNotInterestedStatus";
import { UserPreferences } from "@/lib/types";

const ITEMS_PER_PAGE = 20;

const CategoryDetail = () => {
  const { mediaType, genreId } = useParams<{ mediaType: 'movie' | 'tv'; genreId: string }>();
  const genreIdNum = genreId === 'now-playing' ? 0 : parseInt(genreId || '0', 10);
  const isTheatrical = genreId === 'now-playing';
  const { user } = useAuth();

  // Fetch user preferences to check if personalization is enabled
  const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
    queryKey: ['user', 'preferences'],
    queryFn: fetchUserPreferencesApi,
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const categoryRecommendationsEnabled = preferencesData?.preferences?.category_recommendations_enabled ?? false;
  const recommendationsEnabled = preferencesData?.preferences?.recommendations_enabled ?? false;
  const showPersonalized = Boolean(user && categoryRecommendationsEnabled && recommendationsEnabled);
  const showNotInterested = recommendationsEnabled && categoryRecommendationsEnabled;

  // Fetch genre name
  const { data: genreData } = useQuery({
    queryKey: ['genres', mediaType],
    queryFn: () => fetchGenreListApi(mediaType as 'movie' | 'tv'),
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
    enabled: !!mediaType && !isTheatrical,
  });

  const genreName = isTheatrical
    ? "Theatrical Releases"
    : (genreData?.genres.find(g => g.id === genreIdNum)?.name || 'Category');

  // Infinite query for personalized recommendations
  const {
    data: personalizedData,
    isLoading: isLoadingPersonalized,
    isFetchingNextPage: isFetchingNextPagePersonalized,
    hasNextPage: hasNextPagePersonalized,
    fetchNextPage: fetchNextPagePersonalized,
  } = useInfiniteQuery({
    queryKey: ['recommendations', isTheatrical ? 'theatrical' : 'genre', isTheatrical ? 'all' : genreIdNum, mediaType, 'all'],
    queryFn: ({ pageParam = 1 }) => {
      if (isTheatrical) {
        return fetchTheatricalRecommendationsApi(ITEMS_PER_PAGE, pageParam);
      }
      return fetchGenreRecommendationsApi(genreIdNum, mediaType as 'movie' | 'tv', ITEMS_PER_PAGE, pageParam);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.total_pages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    staleTime: 1000 * 60 * 5,
    enabled: showPersonalized && !!mediaType && (!!genreIdNum || isTheatrical),
  });

  // Infinite query for default (non-personalized) results
  const {
    data: defaultData,
    isLoading: isLoadingDefault,
    isFetchingNextPage: isFetchingNextPageDefault,
    hasNextPage: hasNextPageDefault,
    fetchNextPage: fetchNextPageDefault,
  } = useInfiniteQuery({
    queryKey: ['genre', mediaType, genreIdNum, 'all'],
    queryFn: ({ pageParam = 1 }) => {
      if (isTheatrical) {
        return fetchNowPlayingMoviesApi(pageParam);
      }
      return mediaType === 'movie'
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
    enabled: !showPersonalized && !!mediaType && (!!genreIdNum || isTheatrical),
  });

  // Use personalized data if available, otherwise default
  const data = showPersonalized ? personalizedData : defaultData;
  const isLoading = showPersonalized ? isLoadingPersonalized : isLoadingDefault;
  const isFetchingNextPage = showPersonalized ? isFetchingNextPagePersonalized : isFetchingNextPageDefault;
  const hasNextPage = showPersonalized ? hasNextPagePersonalized : hasNextPageDefault;
  const fetchNextPage = showPersonalized ? fetchNextPagePersonalized : fetchNextPageDefault;

  // Deduplicate movies by ID
  const allMovies = data?.pages.flatMap(page => page.results).filter((movie, index, self) => 
    self.findIndex(m => m.id === movie.id) === index
  ) || [];
  const totalResults = data?.pages[0]?.total_results || 0;

  // Get source info for personalized results
  const sourceCollections = showPersonalized ? (personalizedData?.pages[0]?.sourceCollections || []) : [];
  const totalSourceItems = showPersonalized ? (personalizedData?.pages[0]?.totalSourceItems || 0) : 0;

  // Generate media IDs for watched status lookup
  const mediaIds = useMemo(() => 
    allMovies.map(movie => {
      const isTV = mediaType === 'tv' || !!movie.first_air_date;
      return isTV ? `${movie.id}tv` : String(movie.id);
    }),
    [allMovies, mediaType]
  );

  const { watchedMap } = useWatchedStatus(mediaIds);
  const { notInterestedMap } = useNotInterestedStatus(showNotInterested ? mediaIds : []);

  // Infinite scroll with Intersection Observer
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (isFetchingNextPage) return;
    
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage) {
        fetchNextPage();
      }
    }, {
      rootMargin: '200px',
    });
    
    if (node) {
      observerRef.current.observe(node);
    }
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return (
    <>
      <Navbar />
      <main className="container py-6 md:py-10">
        {/* Header */}
        <section className="mb-8">
          <Link
            to="/categories"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Categories
          </Link>

          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-1 rounded-full bg-primary" />
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              {genreName}
            </h1>
            {showPersonalized && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 gap-1">
                <Sparkles className="h-3 w-3" />
                Personalized
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            {mediaType === 'movie' ? 'Movies' : 'TV Shows'}
            {totalResults > 0 && ` (${totalResults.toLocaleString()} results)`}
          </p>
          {showPersonalized && sourceCollections.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              Based on {totalSourceItems} items from {sourceCollections.length} collection{sourceCollections.length !== 1 ? 's' : ''}
            </p>
          )}
        </section>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-5">
            {Array.from({ length: 18 }).map((_, index) => (
              <div key={index} className="space-y-3">
                <Skeleton className="aspect-2/3 w-full rounded-xl" />
                <Skeleton className="h-4 w-[75%] rounded-md" />
                <Skeleton className="h-3 w-[45%] rounded-md" />
              </div>
            ))}
          </div>
        ) : allMovies.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-5">
              {allMovies.map((movie, index) => {
                const isTV = mediaType === 'tv' || !!movie.first_air_date;
                const mediaId = isTV ? `${movie.id}tv` : String(movie.id);
                return (
                  <MovieCard
                    key={`${movie.id}-${index}`}
                    movie={movie}
                    isWatched={watchedMap[mediaId] ?? false}
                    isNotInterested={notInterestedMap[mediaId] ?? false}
                    showNotInterested={showNotInterested}
                  />
                );
              })}
              {/* Skeleton loaders for infinite scroll - inside the same grid */}
              {isFetchingNextPage && Array.from({ length: 6 }).map((_, index) => (
                <div key={`skeleton-${index}`} className="space-y-3">
                  <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                  <Skeleton className="h-4 w-[75%] rounded-md" />
                  <Skeleton className="h-3 w-[45%] rounded-md" />
                </div>
              ))}
            </div>

            {/* Infinite scroll trigger */}
            <div ref={loadMoreRef} />
          </>
        ) : (
          <div className="text-center py-16">
            <p className="text-muted-foreground">No results found for this category.</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/categories">Browse other categories</Link>
            </Button>
          </div>
        )}
      </main>
    </>
  );
};

export default CategoryDetail;
