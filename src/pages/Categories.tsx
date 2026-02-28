import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { GenreRow } from "@/components/GenreRow";
import { fetchGenreListApi, fetchMoviesByGenreApi, fetchTvByGenreApi, fetchNowPlayingMoviesApi, fetchCategoryRecommendationsApi, fetchUserPreferencesApi, fetchTheatricalRecommendationsApi } from "@/lib/api";
import { Genre, CategoryRecommendationsResponse } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Film, Tv, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";

// Popular genres to feature (subset for better UX)
// Movie genres: Horror (27), Thriller (53), Drama (18), Sci-Fi (878), Animation (16), Action (28), Comedy (35), Romance (10749)
const FEATURED_MOVIE_GENRE_IDS = [27, 53, 18, 878, 16, 28, 35, 10749];
// TV genres: Mystery (9648), Crime (80), Drama (18), Sci-Fi & Fantasy (10765), Animation (16), Action & Adventure (10759), Comedy (35), Documentary (99)
// Note: TMDB doesn't have Horror/Thriller as separate TV genres - Mystery and Crime cover similar content
const FEATURED_TV_GENRE_IDS = [9648, 80, 18, 10765, 16, 10759, 35, 99];

const Categories = () => {
  const { user } = useAuth();

  // Fetch user preferences to check if category recommendations are enabled
  const { data: preferencesData } = useQuery({
    queryKey: ['user', 'preferences'],
    queryFn: fetchUserPreferencesApi,
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const categoryRecommendationsEnabled = preferencesData?.preferences?.category_recommendations_enabled ?? false;
  const recommendationsEnabled = preferencesData?.preferences?.recommendations_enabled ?? false;
  const showPersonalized = Boolean(user && categoryRecommendationsEnabled && recommendationsEnabled);

  return (
    <>
      <Navbar />
      <main className="container py-6 md:py-10">
        {/* Header */}
        <section className="mb-8 md:mb-12">
          <div className="relative">
            {/* Subtle gradient orb */}
            <div className="absolute -top-20 -left-20 w-72 h-72 bg-primary/[0.06] rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -top-10 left-40 w-48 h-48 bg-muted/30 rounded-full blur-3xl pointer-events-none" />

            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1]">
                  Browse by <span className="text-gradient">Category</span>
                </h1>
                {showPersonalized && (
                  <Badge variant="secondary" className="bg-secondary/90 text-secondary-foreground border-border/70 gap-1">
                    <Sparkles className="h-3 w-3" />
                    Personalized
                  </Badge>
                )}
              </div>
              <p className="text-lg text-muted-foreground max-w-md">
                {showPersonalized 
                  ? "Categories tailored to your taste based on your collections."
                  : "Discover movies and TV shows organized by genre."}
              </p>
              {!showPersonalized && user && (
                <p className="text-sm text-muted-foreground mt-2">
                  <Link to="/profile" className="text-primary hover:underline">
                    Enable personalized categories
                  </Link>{" "}
                  in your profile settings.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Tabs for Movies / TV Shows */}
        <Tabs defaultValue="movie" className="w-full">
          <div className="flex justify-start overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="mb-8 w-max">
              <TabsTrigger value="movie" className="gap-2 px-3">
                <Film className="h-4 w-4" />
                Movies
              </TabsTrigger>
              <TabsTrigger value="tv" className="gap-2 px-3">
                <Tv className="h-4 w-4" />
                TV Shows
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="movie">
            {showPersonalized ? (
              <PersonalizedCategoriesContent mediaType="movie" showNotInterested={showPersonalized} />
            ) : (
              <GenreRowsContent mediaType="movie" featuredGenreIds={FEATURED_MOVIE_GENRE_IDS} showNotInterested={false} />
            )}
          </TabsContent>

          <TabsContent value="tv">
            {showPersonalized ? (
              <PersonalizedCategoriesContent mediaType="tv" showNotInterested={showPersonalized} />
            ) : (
              <GenreRowsContent mediaType="tv" featuredGenreIds={FEATURED_TV_GENRE_IDS} showNotInterested={false} />
            )}
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
};

// Loading skeleton for categories
function CategoriesLoadingSkeleton() {
  return (
    <div className="space-y-12">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-7 w-32 rounded-lg" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 w-[140px] sm:w-[160px] md:w-[180px]">
                <Skeleton className="aspect-2/3 w-full rounded-xl" />
                <Skeleton className="h-4 w-[75%] mt-3 rounded-md" />
                <Skeleton className="h-3 w-[45%] mt-2 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Component to render personalized category recommendations
function PersonalizedCategoriesContent({ mediaType, showNotInterested }: { mediaType: 'movie' | 'tv'; showNotInterested: boolean }) {
  const { data, isLoading, isError } = useQuery<CategoryRecommendationsResponse>({
    queryKey: ['recommendations', 'categories', mediaType],
    queryFn: () => fetchCategoryRecommendationsApi(mediaType, 10),
    staleTime: 1000 * 60 * 10, // Cache for 10 minutes
  });

  if (isLoading) {
    return <CategoriesLoadingSkeleton />;
  }

  if (isError || !data || data.categories.length === 0) {
    // Fallback to default categories if personalized fails or is empty
    return (
      <GenreRowsContent 
        mediaType={mediaType} 
        featuredGenreIds={mediaType === 'movie' ? FEATURED_MOVIE_GENRE_IDS : FEATURED_TV_GENRE_IDS} 
        showNotInterested={showNotInterested}
      />
    );
  }

  return (
    <div className="space-y-12">
      {mediaType === 'movie' && <PersonalizedTheatricalReleasesRow showNotInterested={showNotInterested} />}
      {data.categories.map((category) => (
        <GenreRow
          key={`personalized-${mediaType}-${category.genre.id}`}
          genre={category.genre}
          movies={category.results}
          mediaType={mediaType}
          isLoading={false}
          limit={10}
          isPersonalized
          showNotInterested={showNotInterested}
        />
      ))}
    </div>
  );
}

// Component to render genre rows for a specific media type
function GenreRowsContent({ mediaType, featuredGenreIds, showNotInterested = false }: { mediaType: 'movie' | 'tv'; featuredGenreIds: number[]; showNotInterested?: boolean }) {
  // Fetch genre list
  const { data: genreData, isLoading: isLoadingGenres } = useQuery({
    queryKey: ['genres', mediaType],
    queryFn: () => fetchGenreListApi(mediaType),
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  // Filter to featured genres and maintain order
  const featuredGenres = featuredGenreIds
    .map(id => genreData?.genres.find(g => g.id === id))
    .filter((g): g is Genre => g !== undefined);

  if (isLoadingGenres) {
    return <CategoriesLoadingSkeleton />;
  }

  return (
    <div className="space-y-12">
      {mediaType === 'movie' && <TheatricalReleasesRow showNotInterested={showNotInterested} />}
      {featuredGenres.map((genre) => (
        <GenreRowWithData
          key={`${mediaType}-${genre.id}`}
          genre={genre}
          mediaType={mediaType}
          showNotInterested={showNotInterested}
        />
      ))}
    </div>
  );
}

// Separate component to fetch data for each genre row
function GenreRowWithData({ genre, mediaType, showNotInterested = false }: { genre: Genre; mediaType: 'movie' | 'tv'; showNotInterested?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['genre', mediaType, genre.id, 'preview'],
    queryFn: () => mediaType === 'movie'
      ? fetchMoviesByGenreApi(genre.id, 1)
      : fetchTvByGenreApi(genre.id, 1),
    staleTime: 1000 * 60 * 10, // Cache for 10 minutes
  });

  return (
    <GenreRow
      genre={genre}
      movies={data?.results || []}
      mediaType={mediaType}
      isLoading={isLoading}
      limit={10}
      showNotInterested={showNotInterested}
    />
  );
}

function TheatricalReleasesRow({ showNotInterested = false }: { showNotInterested?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['movies', 'now_playing'],
    queryFn: () => fetchNowPlayingMoviesApi(1),
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  return (
    <GenreRow
      title="Theatrical Releases"
      movies={data?.results || []}
      mediaType="movie"
      isLoading={isLoading}
      limit={10}
      customLink="/categories/movie/now-playing"
      showNotInterested={showNotInterested}
    />
  );
}

function PersonalizedTheatricalReleasesRow({ showNotInterested = true }: { showNotInterested?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['recommendations', 'theatrical', 'preview'],
    queryFn: () => fetchTheatricalRecommendationsApi(10, 1),
    staleTime: 1000 * 60 * 10, // 10 minutes
  });

  return (
    <GenreRow
      title="Theatrical Releases"
      movies={data?.results || []}
      mediaType="movie"
      isLoading={isLoading}
      limit={10}
      customLink="/categories/movie/now-playing"
      isPersonalized
      showNotInterested={showNotInterested}
    />
  );
}

export default Categories;
