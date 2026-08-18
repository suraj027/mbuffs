import { useParams, Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { CategoryGrid } from "@/components/CategoryGrid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Sparkles } from "lucide-react";
import { useCategoryItems } from "@/hooks/useCategoryItems";

const CategoryDetail = () => {
  const { mediaType, genreId } = useParams<{ mediaType: "movie" | "tv"; genreId: string }>();

  const {
    genreName,
    showPersonalized,
    showNotInterested,
    visibleMovies,
    watchedMap,
    notInterestedMap,
    totalResults,
    sourceCollections,
    totalSourceItems,
    isLoading,
    isFetchingNextPage,
    isInitialPagedLoad,
    loadMoreRef,
  } = useCategoryItems({ mediaType: (mediaType as "movie" | "tv") ?? "movie", genreId });

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
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{genreName}</h1>
            {showPersonalized && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 gap-1">
                <Sparkles className="h-3 w-3" />
                Personalized
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            {mediaType === "movie" ? "Movies" : "TV Shows"}
            {totalResults > 0 && ` (${totalResults.toLocaleString()} results)`}
          </p>
          {showPersonalized && sourceCollections.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              Based on {totalSourceItems} items from {sourceCollections.length} collection
              {sourceCollections.length !== 1 ? "s" : ""}
            </p>
          )}
        </section>

        {/* Grid */}
        <CategoryGrid
          movies={visibleMovies}
          mediaType={(mediaType as "movie" | "tv") ?? "movie"}
          watchedMap={watchedMap}
          notInterestedMap={notInterestedMap}
          showNotInterested={showNotInterested}
          isLoading={isLoading}
          isFetchingNextPage={isFetchingNextPage}
          isInitialPagedLoad={isInitialPagedLoad}
          loadMoreRef={loadMoreRef}
          emptyState={
            <div className="text-center py-16">
              <p className="text-muted-foreground">No results found for this category.</p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/categories">Browse other categories</Link>
              </Button>
            </div>
          }
        />
      </main>
    </>
  );
};

export default CategoryDetail;
