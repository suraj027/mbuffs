import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRef, useMemo } from 'react';
import { MovieGrid } from "@/components/MovieGrid";
import { MovieCard } from "@/components/MovieCard";
import { fetchTrendingContentApi, fetchUserRegion, fetchUserPreferencesApi, fetchCollageItemsPublicApi, getImageUrl } from "@/lib/api";
import { Navbar } from "@/components/Navbar";
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useWatchedStatus } from '@/hooks/useWatchedStatus';
import { useNotInterestedStatus } from '@/hooks/useNotInterestedStatus';
import { Sparkles, Settings, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { UserPreferences } from '@/lib/types';
import {
  dedupeForYouRecommendations,
  excludeFeedbackRecommendations,
  getRecommendationMediaId,
  getPreferencesQueryKey,
  getSharedForYouInfiniteQueryOptions,
  selectForYouPreviewRecommendations,
} from '@/lib/recommendationQueries';

const TRENDING_CONTENT_QUERY_KEY = ['content', 'trending'];
const COLLAGE_QUERY_KEY = ['content', 'collage'];
const Index = () => {
  const { user } = useAuth();

  // Fetch user preferences separately
  const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
    queryKey: getPreferencesQueryKey(user?.id),
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

  // Fetch admin-curated collage items for the hero section
  const { data: collageData } = useQuery({
    queryKey: COLLAGE_QUERY_KEY,
    queryFn: fetchCollageItemsPublicApi,
    staleTime: 1000 * 60 * 30,
  });

  // Fetch personalized recommendations for logged in users with recommendations enabled
  const {
    data: recommendationsData,
    isLoading: isRecommendationsLoading,
  } = useInfiniteQuery({
    ...getSharedForYouInfiniteQueryOptions(user?.id),
    enabled: !!user && recommendationsEnabled,
  });

  const trendingContent = trendingContentData?.results?.slice(0, 50) || [];
  const collageItems = collageData?.items ?? [];
  const collageMinItems = collageData?.minItems ?? 12;
  const hasEnoughCollageItems = collageItems.length >= collageMinItems;
  const heroPosters = useMemo(() => {
    const collagePosters = collageItems.map((item) => ({ id: item.tmdb_id, poster_path: item.poster_path }));
    for (let i = collagePosters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [collagePosters[i], collagePosters[j]] = [collagePosters[j], collagePosters[i]];
    }
    if (collagePosters.length >= collageMinItems) return collagePosters;
    const existingIds = new Set(collagePosters.map((p) => p.id));
    const trendingFill = trendingContent
      .filter((m) => !existingIds.has(String(m.id)))
      .map((m) => ({ id: String(m.id), poster_path: m.poster_path }));
    return [...collagePosters, ...trendingFill];
  }, [collageItems, collageMinItems, trendingContent]);
  const firstRecommendationsPage = recommendationsData?.pages?.[0];
  const recommendationCandidates = useMemo(
    () => dedupeForYouRecommendations(firstRecommendationsPage?.results ?? []),
    [firstRecommendationsPage]
  );

  // Generate media IDs for watched status lookup (recommendations only)
  const recommendationMediaIds = useMemo(
    () => recommendationCandidates.map((movie) => getRecommendationMediaId(movie)),
    [recommendationCandidates]
  );

  const { watchedMap, isLoading: isLoadingWatched } = useWatchedStatus(recommendationMediaIds);
  const { notInterestedMap, isLoading: isLoadingNotInterested } = useNotInterestedStatus(recommendationsEnabled ? recommendationMediaIds : []);
  const recommendations = useMemo(
    () => selectForYouPreviewRecommendations(
      excludeFeedbackRecommendations(
        recommendationCandidates,
        watchedMap,
        recommendationsEnabled ? notInterestedMap : {},
      ).filter((movie) => movie.poster_path),
    ),
    [recommendationCandidates, watchedMap, notInterestedMap, recommendationsEnabled]
  );
  const hasRecommendations = recommendationsEnabled && recommendations.length > 0;

  // For You scroll functionality
  const forYouScrollRef = useRef<HTMLDivElement>(null);

  const scrollForYouRight = () => {
    if (forYouScrollRef.current) {
      forYouScrollRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  return (
    <>
      {/* Hero Section — full viewport width, extends behind navbar */}
      <div className="relative overflow-hidden">
        {/* Poster collage background — slanted, positioned behind everything including navbar */}
        {heroPosters.length > 0 && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-[-20%] flex flex-wrap gap-1.5 rotate-[-6deg] origin-center">
              {heroPosters.map((item) => (
                <img
                  key={item.id}
                  src={getImageUrl(item.poster_path, 'w342')}
                  alt=""
                  className="w-[18%] md:w-[15%] lg:w-[11%] xl:w-[10%] aspect-[2/3] object-cover rounded-md"
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        )}
        {/* Base darkening over entire collage */}
        <div className="absolute inset-0 pointer-events-none bg-background/40" />
        {/* Dark radial over title area for text readability */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 55% 65% at 8% 70%, oklch(0.141 0.005 285.823) 0%, oklch(0.141 0.005 285.823 / 0.95) 35%, oklch(0.141 0.005 285.823 / 0.5) 55%, transparent 75%)' }} />
        {/* Smooth edge vignette on all sides */}
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 120px 60px oklch(0.141 0.005 285.823)' }} />
        {/* Bottom fade so sections below are not affected */}
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background to-transparent pointer-events-none" />

        {/* Navbar sits inside the hero so collage extends behind it */}
        <Navbar />

        {/* Text content — constrained to container */}
        <div className="relative z-10 container flex items-end min-h-[240px] md:min-h-[300px] lg:min-h-[360px] pb-8 md:pb-12">
          <div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-3">
              Track. Collect.
              <br />
              Discover.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-md">
              Track what you love. Find what you'll love next.
            </p>
          </div>
        </div>
      </div>

      <main className="container py-6 md:py-10">
        {/* Content Section */}
        <div className="space-y-16">
          {/* For You Section - Personalized Recommendations */}
          {user && recommendationsEnabled && (
            <section>
              {(isRecommendationsLoading || isLoadingWatched || isLoadingNotInterested) ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-7 w-32 rounded-lg" />
                    <Sparkles className="h-5 w-5 text-primary" />
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
                      <h2 className="text-xl md:text-2xl font-semibold tracking-tight">For You</h2>
                      <Sparkles className="h-5 w-5 text-primary" />
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
                    {(firstRecommendationsPage?.totalSourceItems || 0) > 0
                      ? `Based on ${firstRecommendationsPage?.totalSourceItems || 0} items from ${firstRecommendationsPage?.sourceCollections?.length || 0} collection${(firstRecommendationsPage?.sourceCollections?.length || 0) !== 1 ? 's' : ''}`
                      : 'Add source collections to personalize your recommendations'}
                  </p>
                  <div className="relative -mx-4">
                    <div 
                      ref={forYouScrollRef}
                      className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide scroll-smooth px-4 pr-16"
                    >
                      {recommendations.map((movie) => {
                        const mediaId = getRecommendationMediaId(movie);
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
                <div className="rounded-2xl bg-linear-to-br from-primary/5 via-muted/40 to-transparent border border-primary/10 p-6 md:p-8">
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
