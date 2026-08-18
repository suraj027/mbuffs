import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { CategoryGrid } from "@/components/CategoryGrid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clapperboard, Sparkles, Tv } from "lucide-react";
import { useCategoryItems, NOW_PLAYING_GENRE_ID } from "@/hooks/useCategoryItems";

type MediaType = "movie" | "tv";

const isMediaType = (value: string | null): value is MediaType => value === "movie" || value === "tv";

const SELECT_ITEM_CLASS = "text-base py-2.5 pl-3 [&_svg]:size-5";

const Categories = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const typeParam = searchParams.get("type");
  const mediaType: MediaType = isMediaType(typeParam) ? typeParam : "movie";
  const genreId = searchParams.get("genre") ?? undefined;
  const hasSelection = !!genreId;

  const {
    genres,
    genreName,
    isLoadingGenres,
    showPersonalized,
    showNotInterested,
    visibleMovies,
    watchedMap,
    notInterestedMap,
    totalResults,
    isLoading,
    isFetchingNextPage,
    isInitialPagedLoad,
    loadMoreRef,
    preferencesReady,
    preferredGenreId,
    isLoadingPreferredGenre,
  } = useCategoryItems({ mediaType, genreId, enabled: hasSelection });

  const handleMediaTypeChange = useCallback(
    (value: string) => {
      if (!isMediaType(value) || value === mediaType) return;
      // Genres differ between movies and TV, so clear the selection on switch.
      setSearchParams({ type: value }, { replace: false });
    },
    [mediaType, setSearchParams],
  );

  const handleGenreChange = useCallback(
    (value: string) => {
      setSearchParams({ type: mediaType, genre: value }, { replace: false });
    },
    [mediaType, setSearchParams],
  );

  const sortedGenres = useMemo(
    () => [...genres].sort((a, b) => a.name.localeCompare(b.name)),
    [genres],
  );

  // Whether the current genre param maps to a real, selectable category.
  const genreResolved =
    hasSelection &&
    (genreId === NOW_PLAYING_GENRE_ID || genres.some((g) => String(g.id) === genreId));

  // Once genres load, ensure a valid category is selected. Defaults to the user's
  // most preferred genre (falling back to the first alphabetically). Waits for the
  // preferred genre to resolve so it doesn't select a fallback and then swap.
  const defaultSelectionReady =
    preferencesReady && (!showPersonalized || !isLoadingPreferredGenre);

  useEffect(() => {
    if (sortedGenres.length === 0 || !defaultSelectionReady) return;
    const isValid =
      genreId === NOW_PLAYING_GENRE_ID || sortedGenres.some((g) => String(g.id) === genreId);
    if (isValid) return;

    const preferredValid = preferredGenreId != null && sortedGenres.some((g) => g.id === preferredGenreId);
    const target = preferredValid ? String(preferredGenreId) : String(sortedGenres[0].id);
    setSearchParams({ type: mediaType, genre: target }, { replace: true });
  }, [genreId, sortedGenres, mediaType, defaultSelectionReady, preferredGenreId, setSearchParams]);

  const categoryPlaceholder = isLoadingGenres ? "Loading categories…" : "Choose a category";

  // Reserve header space with skeletons until a real category resolves, so the
  // grid never jumps down when the header fills in.
  const showHeaderSkeleton = !genreResolved;
  const gridLoading = !genreResolved || isLoading;

  return (
    <>
      <Navbar />
      <main className="container py-6 md:py-10">
        {/* Selectors */}
        <section className="mb-8 flex flex-col gap-2 sm:flex-row">
          <Select value={mediaType} onValueChange={handleMediaTypeChange}>
            <SelectTrigger
              className="w-full sm:w-[170px] !h-12 rounded-lg px-4 text-base font-medium"
              aria-label="Media type"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
              <SelectItem value="movie" className={SELECT_ITEM_CLASS}>
                <Clapperboard />
                Movies
              </SelectItem>
              <SelectItem value="tv" className={SELECT_ITEM_CLASS}>
                <Tv />
                TV Shows
              </SelectItem>
            </SelectContent>
          </Select>

          <Select value={genreId ?? ""} onValueChange={handleGenreChange} disabled={isLoadingGenres}>
            <SelectTrigger
              className="w-full sm:w-[260px] !h-12 rounded-lg px-4 text-base font-medium"
              aria-label="Category"
            >
              <SelectValue placeholder={categoryPlaceholder} />
            </SelectTrigger>
            <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
              {mediaType === "movie" && (
                <>
                  <SelectItem value={NOW_PLAYING_GENRE_ID} className={SELECT_ITEM_CLASS}>
                    Theatrical Releases
                  </SelectItem>
                  <SelectSeparator />
                </>
              )}
              {sortedGenres.map((genre) => (
                <SelectItem key={genre.id} value={String(genre.id)} className={SELECT_ITEM_CLASS}>
                  {genre.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        {/* Results */}
        <section>
          <div className="flex items-center gap-3 mb-6 min-h-9">
            {showHeaderSkeleton ? (
              <Skeleton className="h-7 w-44 rounded-lg" />
            ) : (
              <>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{genreName}</h2>
                {totalResults > 0 && (
                  <span className="text-sm text-muted-foreground">{totalResults.toLocaleString()}</span>
                )}
                {showPersonalized && (
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 gap-1">
                    <Sparkles className="h-3 w-3" />
                    Personalized
                  </Badge>
                )}
              </>
            )}
          </div>

          <CategoryGrid
            movies={visibleMovies}
            mediaType={mediaType}
            watchedMap={watchedMap}
            notInterestedMap={notInterestedMap}
            showNotInterested={showNotInterested}
            isLoading={gridLoading}
            isFetchingNextPage={isFetchingNextPage}
            isInitialPagedLoad={isInitialPagedLoad}
            loadMoreRef={loadMoreRef}
            emptyState={
              <div className="text-center py-16">
                <p className="text-muted-foreground">No results found for this category.</p>
              </div>
            }
          />
        </section>
      </main>
    </>
  );
};

export default Categories;
