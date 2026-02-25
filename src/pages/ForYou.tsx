import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useCallback, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { MovieCard } from "@/components/MovieCard";
import { fetchRecommendationsApi, fetchUserPreferencesApi } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Sparkles, Settings } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWatchedStatus } from "@/hooks/useWatchedStatus";
import { useNotInterestedStatus } from "@/hooks/useNotInterestedStatus";
import { UserPreferences } from "@/lib/types";

const ITEMS_PER_PAGE = 20;
const PREFERENCES_QUERY_KEY = ['user', 'preferences'];

const ForYou = () => {
  const { user } = useAuth();

  // Fetch user preferences separately
  const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: fetchUserPreferencesApi,
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const recommendationsEnabled = preferencesData?.preferences?.recommendations_enabled ?? false;

  // Infinite query for paginated recommendations
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['recommendations', 'all'],
    queryFn: ({ pageParam = 1 }) => fetchRecommendationsApi(ITEMS_PER_PAGE, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.total_pages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    enabled: !!user && recommendationsEnabled,
  });

  // Deduplicate movies by ID to prevent showing same items multiple times
  const allMovies = data?.pages.flatMap(page => page.results).filter((movie, index, self) => 
    self.findIndex(m => m.id === movie.id) === index
  ) || [];
  const totalResults = data?.pages[0]?.total_results || 0;
  const sourceCollections = data?.pages[0]?.sourceCollections || [];
  const totalSourceItems = data?.pages[0]?.totalSourceItems || 0;

  // Generate media IDs for watched status lookup
  const mediaIds = useMemo(() => 
    allMovies.map(movie => {
      const isTV = !!movie.first_air_date;
      return isTV ? `${movie.id}tv` : String(movie.id);
    }),
    [allMovies]
  );

  const { watchedMap } = useWatchedStatus(mediaIds);
  const { notInterestedMap } = useNotInterestedStatus(recommendationsEnabled ? mediaIds : []);

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
      rootMargin: '200px', // Start loading before reaching the end
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

  // Show message if recommendations are not enabled
  if (user && !recommendationsEnabled) {
    return (
      <>
        <Navbar />
        <main className="container py-6 md:py-10">
          <section className="mb-8">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to Home
            </Link>
          </section>

          <div className="rounded-2xl bg-gradient-to-br from-primary/5 via-purple-500/5 to-transparent border border-primary/10 p-8 md:p-12 text-center">
            <div className="p-4 rounded-xl bg-primary/10 w-fit mx-auto mb-4">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Enable Recommendations</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Turn on personalized recommendations in your profile settings to discover content tailored to your taste.
            </p>
            <Button asChild>
              <Link to="/profile">
                <Settings className="h-4 w-4 mr-2" />
                Go to Settings
              </Link>
            </Button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="container py-6 md:py-10">
        {/* Header */}
        <section className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Home
          </Link>
          
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="h-8 w-1 rounded-full bg-primary" />
              <div className="flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-primary" />
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                  For You
                </h1>
              </div>
              <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                Beta
              </span>
            </div>
            <Link to="/profile">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <Settings className="h-4 w-4 md:mr-1" />
                <span className="hidden md:inline">Customize</span>
              </Button>
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            {totalSourceItems > 0
              ? `Based on ${totalSourceItems} items from ${sourceCollections.length} collection${sourceCollections.length !== 1 ? 's' : ''}`
              : 'Add source collections to personalize your recommendations'}
          </p>
        </section>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-5">
            {Array.from({ length: 18 }).map((_, index) => (
              <div key={index} className="space-y-3">
                <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                <Skeleton className="h-4 w-[75%] rounded-md" />
                <Skeleton className="h-3 w-[45%] rounded-md" />
              </div>
            ))}
          </div>
        ) : allMovies.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-5">
              {allMovies.map((movie, index) => {
                const isTV = !!movie.first_air_date;
                const mediaId = isTV ? `${movie.id}tv` : String(movie.id);
                return (
                  <MovieCard
                    key={`${movie.id}-${index}`}
                    movie={movie}
                    isWatched={watchedMap[mediaId] ?? false}
                    isNotInterested={notInterestedMap[mediaId] ?? false}
                    showNotInterested={recommendationsEnabled}
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
            <div className="p-4 rounded-xl bg-primary/10 w-fit mx-auto mb-4">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No recommendations yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Select source collections in your profile settings to start getting personalized recommendations.
            </p>
            <Button asChild variant="outline">
              <Link to="/profile">
                <Settings className="h-4 w-4 mr-2" />
                Set Up Collections
              </Link>
            </Button>
          </div>
        )}
      </main>
    </>
  );
};

export default ForYou;
