import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import { MovieCard } from "@/components/MovieCard";
import {
  fetchMovieDetailsApi,
  fetchTvDetailsApi,
  fetchUserPreferencesApi,
  fetchWatchedItemsApi,
  fetchNotInterestedItemsApi
} from "@/lib/api";
import { MovieDetails, UserPreferences } from "@/lib/types";
import { useAuth } from "@/hooks/useAuth";
import { useWatchedStatus } from "@/hooks/useWatchedStatus";
import { useNotInterestedStatus } from "@/hooks/useNotInterestedStatus";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Eye, ThumbsDown, Clock3 } from "lucide-react";

type SystemCollectionKind = "watched" | "not-interested";

interface SystemCollectionItemsPageProps {
  kind: SystemCollectionKind;
}

const ITEMS_PER_PAGE = 30;

const formatMarkedDate = (date: string) => {
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export function SystemCollectionItemsPage({ kind }: SystemCollectionItemsPageProps) {
  const { user } = useAuth();
  const [mediaTypeFilter, setMediaTypeFilter] = useState("all");
  const [visibleItemsCount, setVisibleItemsCount] = useState(ITEMS_PER_PAGE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
    queryKey: ["user", "preferences"],
    queryFn: fetchUserPreferencesApi,
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const recommendationsEnabled = preferencesData?.preferences?.recommendations_enabled ?? false;
  const showNotInterested = recommendationsEnabled;

  const title = kind === "watched" ? "Watched Items" : "Not Interested Items";
  const description =
    kind === "watched"
      ? "Everything you've marked as watched."
      : "Everything you've marked as not interested.";

  const icon = kind === "watched" ? (
    <Eye className="h-5 w-5 text-primary" />
  ) : (
    <ThumbsDown className="h-5 w-5 text-primary" />
  );

  const { data: itemsData, isLoading: isLoadingItems } = useQuery({
    queryKey: ["collections", kind, "items"],
    queryFn: kind === "watched" ? fetchWatchedItemsApi : fetchNotInterestedItemsApi,
    enabled: !!user,
    staleTime: 1000 * 60 * 2,
  });

  const allEntries = useMemo(() => itemsData?.items ?? [], [itemsData?.items]);
  const allMediaIds = useMemo(() => allEntries.map((entry) => String(entry.movie_id)), [allEntries]);

  const { watchedMap } = useWatchedStatus(allMediaIds);
  const shouldFetchNotInterestedStatus = kind === "not-interested" || showNotInterested;
  const { notInterestedMap } = useNotInterestedStatus(shouldFetchNotInterestedStatus ? allMediaIds : []);

  // Hide entries immediately when the user unmarks from this page.
  const activeEntries = useMemo(() => {
    if (kind === "watched") {
      return allEntries.filter((entry) => watchedMap[String(entry.movie_id)] ?? true);
    }
    return allEntries.filter((entry) => notInterestedMap[String(entry.movie_id)] ?? true);
  }, [allEntries, watchedMap, notInterestedMap, kind]);

  const mediaIds = useMemo(() => activeEntries.map((entry) => String(entry.movie_id)), [activeEntries]);

  const { data: moviesDetailsMap, isLoading: isLoadingMovies } = useQuery<Record<string, MovieDetails | null>, Error>({
    queryKey: ["system-items", kind, "details", ...mediaIds],
    queryFn: async () => {
      if (mediaIds.length === 0) return {};

      const promises = mediaIds.map((id) => {
        if (id.includes("tv")) {
          const numericId = parseInt(id.replace("tv", ""), 10);
          return fetchTvDetailsApi(numericId);
        }
        return fetchMovieDetailsApi(Number(id));
      });

      const results = await Promise.all(promises);
      const map: Record<string, MovieDetails | null> = {};
      mediaIds.forEach((id, index) => {
        map[id] = results[index];
      });
      return map;
    },
    enabled: mediaIds.length > 0,
    staleTime: 1000 * 60 * 60,
  });

  const filteredEntries = useMemo(() => {
    return activeEntries.filter((entry) => {
      const media = moviesDetailsMap?.[String(entry.movie_id)];
      if (!media) return false;

      switch (mediaTypeFilter) {
        case "movie":
          return "release_date" in media && media.release_date !== undefined;
        case "tv":
          return "first_air_date" in media && media.first_air_date !== undefined;
        default:
          return true;
      }
    });
  }, [activeEntries, moviesDetailsMap, mediaTypeFilter]);

  const visibleEntries = useMemo(() => {
    return filteredEntries.slice(0, visibleItemsCount);
  }, [filteredEntries, visibleItemsCount]);

  const hasMoreItems = filteredEntries.length > visibleItemsCount;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (isLoadingMore) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMoreItems) {
        setIsLoadingMore(true);
        setTimeout(() => {
          setVisibleItemsCount((prev) => prev + ITEMS_PER_PAGE);
          setIsLoadingMore(false);
        }, 250);
      }
    }, { rootMargin: "200px" });

    if (node) observerRef.current.observe(node);
  }, [isLoadingMore, hasMoreItems]);

  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, []);

  const isLoading = isLoadingItems || isLoadingMovies;

  return (
    <>
      <Navbar />
      <main className="container py-6 md:py-10">
        <section className="mb-8">
          <Link
            to="/profile"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Profile
          </Link>

          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-1 rounded-full bg-primary" />
            {icon}
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
          </div>
          <p className="text-muted-foreground">{description}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredEntries.length} item{filteredEntries.length !== 1 ? "s" : ""}
          </p>
        </section>

        <section className="mb-6">
          <Tabs value={mediaTypeFilter} onValueChange={setMediaTypeFilter}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="movie">Movies</TabsTrigger>
              <TabsTrigger value="tv">TV Shows</TabsTrigger>
            </TabsList>
          </Tabs>
        </section>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                <Skeleton className="h-4 w-[70%] rounded-md" />
                <Skeleton className="h-3 w-[55%] rounded-md" />
              </div>
            ))}
          </div>
        ) : visibleEntries.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {visibleEntries.map((entry) => {
                const mediaId = String(entry.movie_id);
                const movie = moviesDetailsMap?.[mediaId];
                if (!movie) {
                  return (
                    <div key={mediaId} className="space-y-3">
                      <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                      <Skeleton className="h-4 w-[70%] rounded-md" />
                      <Skeleton className="h-3 w-[55%] rounded-md" />
                    </div>
                  );
                }

                return (
                  <div key={mediaId}>
                    <MovieCard
                      movie={movie}
                      isWatched={watchedMap[mediaId] ?? false}
                      isNotInterested={notInterestedMap[mediaId] ?? false}
                      showNotInterested={showNotInterested}
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Clock3 className="h-3 w-3" />
                      {formatMarkedDate(entry.added_at)}
                    </p>
                  </div>
                );
              })}

              {isLoadingMore && Array.from({ length: 6 }).map((_, i) => (
                <div key={`more-${i}`} className="space-y-3">
                  <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                  <Skeleton className="h-4 w-[70%] rounded-md" />
                  <Skeleton className="h-3 w-[55%] rounded-md" />
                </div>
              ))}
            </div>

            <div ref={loadMoreRef} />
          </>
        ) : (
          <div className="text-center py-16 rounded-2xl bg-white/2 border border-white/6">
            <h2 className="text-xl font-semibold mb-2">No items yet</h2>
            <p className="text-muted-foreground text-sm">
              {kind === "watched"
                ? "Items you mark as watched will appear here."
                : "Items you mark as not interested will appear here."}
            </p>
          </div>
        )}
      </main>
    </>
  );
}

export default SystemCollectionItemsPage;
