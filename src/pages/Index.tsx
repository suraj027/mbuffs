import { useQuery } from '@tanstack/react-query';
import { useRef, useMemo } from 'react';
import { MovieGrid } from "@/components/MovieGrid";
import { MovieCard } from "@/components/MovieCard";
import { fetchTrendingContentApi, fetchUserRegion, fetchRecommendationsApi, fetchUserPreferencesApi } from "@/lib/api";
import { Navbar } from "@/components/Navbar";
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useWatchedStatus } from '@/hooks/useWatchedStatus';
import { useNotInterestedStatus } from '@/hooks/useNotInterestedStatus';
import { Sparkles, Settings, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { UserPreferences } from '@/lib/types';

const TRENDING_CONTENT_QUERY_KEY = ['content', 'trending'];
const RECOMMENDATIONS_QUERY_KEY = ['recommendations'];
const PREFERENCES_QUERY_KEY = ['user', 'preferences'];

const Index = () => {
  const { user, isLoadingUser } = useAuth();
  
  // Fetch user preferences separately
  const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: fetchUserPreferencesApi,
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const recommendationsEnabled = preferencesData?.preferences?.recommendations_enabled ?? false;

  // Fetch user's region via IP for accurate location detection
  const { data: userRegion } = useQuery({
    queryKey: ['userRegion'],
    queryFn: fetchUserRegion,
    staleTime: Infinity, // Region unlikely to change in session
  });

  const {
    data: trendingContentData,
    isLoading: isTrendingContentLoading,
  } = useQuery({
    queryKey: [TRENDING_CONTENT_QUERY_KEY],
    queryFn: () => fetchTrendingContentApi(1),
    staleTime: 1000 * 60 * 10, // Cache for 10 minutes to reduce API calls
  });

  // Fetch personalized recommendations for logged in users with recommendations enabled
  const {
    data: recommendationsData,
    isLoading: isRecommendationsLoading,
  } = useQuery({
    queryKey: RECOMMENDATIONS_QUERY_KEY,
    queryFn: () => fetchRecommendationsApi(20),
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    enabled: !!user && recommendationsEnabled,
  });

  const trendingContent = trendingContentData?.results?.slice(0, 50) || [];
  const recommendations = recommendationsData?.results || [];
  const hasRecommendations = recommendationsEnabled && recommendations.length > 0;

  // Generate media IDs for watched status lookup (recommendations only)
  const recommendationMediaIds = useMemo(() => 
    recommendations.map(movie => {
      const isTV = !!movie.first_air_date;
      return isTV ? `${movie.id}tv` : String(movie.id);
    }),
    [recommendations]
  );

  const { watchedMap } = useWatchedStatus(recommendationMediaIds);
  const { notInterestedMap } = useNotInterestedStatus(recommendationsEnabled ? recommendationMediaIds : []);

  // For You scroll functionality
  const forYouScrollRef = useRef<HTMLDivElement>(null);

  const scrollForYouRight = () => {
    if (forYouScrollRef.current) {
      forYouScrollRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  return (
    <>
      <Navbar />
      <main className="container py-6 md:py-10">
        {/* Hero Section */}
        <section className="relative mb-12 md:mb-16">
          {/* Subtle gradient orb behind the text */}
          <div className="absolute -top-20 -left-20 w-72 h-72 bg-primary/6 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -top-10 left-40 w-48 h-48 bg-purple-500/4 rounded-full blur-3xl pointer-events-none" />

          <div className="relative">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-4">
              A place for your
              <br />
              <span className="text-gradient">movie buffs.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-md">
              Watch, Add, Share.
            </p>
          </div>
        </section>

        {/* Content Section */}
        <div className="space-y-16">
          {/* For You Section - Personalized Recommendations */}
          {user && recommendationsEnabled && (
            <section>
              {isRecommendationsLoading ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-6 w-1 rounded-full bg-primary" />
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      <Skeleton className="h-7 w-32 rounded-lg" />
                    </div>
                  </div>
                  <div className="relative -mx-4 px-4">
                    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide scroll-smooth">
                      {Array.from({ length: 8 }).map((_, index) => (
                        <div key={index} className="shrink-0 w-[140px] sm:w-[160px] md:w-[180px] space-y-3">
                          <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                          <Skeleton className="h-4 w-[75%] rounded-md" />
                          <Skeleton className="h-3 w-[45%] rounded-md" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : hasRecommendations ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-6 w-1 rounded-full bg-primary" />
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        <h2 className="text-xl md:text-2xl font-semibold tracking-tight">For You</h2>
                      </div>
                      <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        Beta
                      </span>
                    </div>
                    <Link to="/for-you" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                      <span>See all</span>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <p className="text-sm text-muted-foreground -mt-1">
                    {(recommendationsData?.totalSourceItems || 0) > 0
                      ? `Based on ${recommendationsData?.totalSourceItems || 0} items from ${recommendationsData?.sourceCollections?.length || 0} collection${(recommendationsData?.sourceCollections?.length || 0) !== 1 ? 's' : ''}`
                      : 'Add source collections to personalize your recommendations'}
                  </p>
                  <div className="relative -mx-4">
                    <div 
                      ref={forYouScrollRef}
                      className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide scroll-smooth px-4 pr-16"
                    >
                      {recommendations.map((movie) => {
                        const isTV = !!movie.first_air_date;
                        const mediaId = isTV ? `${movie.id}tv` : String(movie.id);
                        return (
                          <div key={movie.id} className="shrink-0 w-[140px] sm:w-[160px] md:w-[180px]">
                            <MovieCard
                              movie={movie}
                              isWatched={watchedMap[mediaId] ?? false}
                              isNotInterested={notInterestedMap[mediaId] ?? false}
                              showNotInterested={recommendationsEnabled}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <button
                      onClick={scrollForYouRight}
                      className="absolute right-0 top-0 bottom-4 w-16 flex items-center justify-center bg-gradient-to-l from-background via-background/80 to-transparent"
                      aria-label="Scroll right"
                    >
                      <ChevronRight className="w-5 h-5 text-foreground/60" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl bg-linear-to-br from-primary/5 via-purple-500/5 to-transparent border border-primary/10 p-6 md:p-8">
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6">
                    <div className="p-3 rounded-xl bg-primary/10">
                      <Sparkles className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-1">Get Personalized Recommendations</h3>
                      <p className="text-sm text-muted-foreground">
                        Select source collections in your profile settings to see recommendations tailored to your taste.
                      </p>
                    </div>
                    <Link to="/profile">
                      <Button variant="outline" className="whitespace-nowrap">
                        <Settings className="h-4 w-4 mr-2" />
                        Set Up Now
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Trending Content */}
          {isTrendingContentLoading ? (
            <div className="space-y-6">
              <Skeleton className="h-7 w-48 rounded-lg" />
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 md:gap-5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="space-y-3">
                    <Skeleton className="aspect-2/3 w-full rounded-xl" />
                    <Skeleton className="h-4 w-[75%] rounded-md" />
                    <Skeleton className="h-3 w-[45%] rounded-md" />
                  </div>
                ))}
              </div>
            </div>
          ) : trendingContent.length > 0 && (
            <MovieGrid
              movies={trendingContent}
              title="Trending This Week"
            />
          )}
        </div>
      </main>
    </>
  );
};

export default Index;
