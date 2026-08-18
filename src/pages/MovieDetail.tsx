import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMovieDetailsApi, fetchTvDetailsApi, fetchVideosApi, fetchCreditsApi, fetchPersonCreditsApi, fetchStudioMoviesApi, fetchUserCollectionsApi, fetchRecommendationCollectionsApi, fetchCollectionDetailsApi, addMovieToCollectionApi, removeMovieFromCollectionApi, getImageUrl, fetchUserRegion, fetchTmdbCollectionDetailsApi, fetchCombinedRatingsApi, fetchOmdbRatingsApi, getWatchedStatusApi, toggleWatchedStatusApi, getNotInterestedStatusApi, toggleNotInterestedStatusApi, fetchUserPreferencesApi } from '@/lib/api';
import { MovieDetails, Network, ProductionCompany, Video, CastMember, CrewMember, CollectionSummary, WatchProvider, PersonCreditsResponse, PersonCredit, VideosResponse, CreditsResponse, TmdbCollectionDetails, CombinedRatingsResponse, OmdbRatingsResponse, UserPreferences, SearchResults, RecommendationCollectionsResponse } from '@/lib/types';
import { Navbar } from "@/components/Navbar";
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CertificationBadge } from '@/components/CertificationBadge';
import { ParentalGuidance } from '@/components/ParentalGuidance';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ImageOff, Star, Play, User, Bookmark, MoreHorizontal, Loader2, Plus, Clock, Calendar, Globe, X, MessageSquare, ChevronRight, Eye, EyeOff, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState, useRef, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
    getPreferencesQueryKey,
    setNotInterestedStatusBatchQueryData,
    setWatchedStatusBatchQueryData,
    RECOMMENDATION_TOGGLE_DEBOUNCE_MS,
} from '@/lib/recommendationQueries';
import { useWarmRecommendations } from '@/App';
import { toast } from 'sonner';
import { ReviewSection, getRatingTier, StarDisplay, InteractiveStarRating } from '@/components/reviews/ReviewSection';
import { deleteRatingApi, fetchReviewSummaryApi, upsertRatingApi } from '@/lib/api';
import type { ReviewSummaryResponse } from '@/lib/types';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useOmdbRatings, enrichMoviesWithImdbRatings } from '@/hooks/useOmdbRatings';

const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';
const PROVIDER_PREVIEW_COUNT = 3;
const RECOMMENDATION_COLLECTIONS_QUERY_KEY = ['recommendations', 'collections'];

function ProviderStack({ title, logos }: { title: string, logos: { id: number | string; src: string; alt: string; isStudio?: boolean }[] }) {
    if (logos.length === 0) return null;
    const preview = logos.slice(0, PROVIDER_PREVIEW_COUNT);
    const remaining = logos.length - PROVIDER_PREVIEW_COUNT;

    return (
        <Dialog>
            <DialogTrigger asChild>
                <button className="flex flex-col items-center md:items-start gap-2 group/stack cursor-pointer">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
                    <div className="flex items-center">
                        <div className="flex -space-x-2.5">
                            {preview.map((logo, i) => (
                                <img
                                    key={logo.id}
                                    src={logo.src}
                                    alt={logo.alt}
                                    className={`w-9 h-9 rounded-md shadow-md border-2 border-background ${logo.isStudio ? 'bg-white object-contain p-0.5' : ''} transition-transform group-hover/stack:translate-x-0`}
                                    style={{ zIndex: PROVIDER_PREVIEW_COUNT - i }}
                                />
                            ))}
                        </div>
                        {remaining > 0 && (
                            <span className="ml-1.5 text-xs font-medium text-muted-foreground">+{remaining}</span>
                        )}
                    </div>
                </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-wrap gap-3 pt-2">
                    {logos.map(logo => (
                        <div key={logo.id} className="relative group" title={logo.alt}>
                            <img
                                src={logo.src}
                                alt={logo.alt}
                                className={`w-12 h-12 rounded-md shadow-md border border-border/60 transition-transform group-hover:scale-105 ${logo.isStudio ? 'bg-white object-contain p-1' : ''}`}
                            />
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function NetworkBadge({ network }: { network: Network }) {
    return (
        <div className="flex items-center justify-center rounded-md bg-secondary/40 border border-border/60 px-2 py-1 transition-colors hover:bg-secondary/70" title={network.name}>
            {network.logo_path ? (
                <img
                    src={`${TMDB_LOGO_BASE}${network.logo_path}`}
                    alt={network.name}
                    className="h-3 w-auto object-contain brightness-0 invert opacity-90"
                />
            ) : (
                <span className="text-xs font-medium text-foreground/70">{network.name}</span>
            )}
        </div>
    );
}


const OVERVIEW_CHAR_LIMIT = 150;

const CollectionSection = ({ collectionId, currentMediaId }: { collectionId: number, currentMediaId: string }) => {
    const { data: collectionDetails } = useQuery<TmdbCollectionDetails | null>({
        queryKey: ['collection', collectionId],
        queryFn: () => fetchTmdbCollectionDetailsApi(collectionId),
        enabled: !!collectionId,
    });

    if (!collectionDetails) return null;

    // Filter out parts without posters and sort by release date
    let parts = collectionDetails.parts || [];
    parts = parts
        .filter(part => part.poster_path)
        .sort((a, b) => new Date(a.release_date).getTime() - new Date(b.release_date).getTime());

    if (parts.length === 0) return null;

    return (
        <section className="space-y-6">
            <div className="flex items-baseline justify-between">
                <h2 className="text-xl md:text-2xl font-semibold text-foreground/90">
                    The Collection
                </h2>
            </div>

            <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                {parts.map((part) => (
                    <Link
                        key={part.id}
                        to={`/media/movie/${part.id}`}
                        className="shrink-0 w-36 md:w-44 snap-center group/card block"
                    >
                        <div className="aspect-2/3 rounded-lg overflow-hidden border border-border/60 bg-muted shadow-md mb-2 relative">
                            {part.poster_path ? (
                                <img
                                    src={getImageUrl(part.poster_path, 'w342')}
                                    alt={part.title}
                                    className="w-full h-full object-cover transition-transform duration-300 group-hover/card:scale-105"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-muted">
                                    <span className="text-muted-foreground text-xs text-center p-1">{part.title}</span>
                                </div>
                            )}
                            {String(part.id) === currentMediaId && (
                                <div className="absolute inset-0 bg-background/70 flex items-center justify-center backdrop-blur-[1px]">
                                    <span className="bg-primary/90 text-primary-foreground text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                                        Now Viewing
                                    </span>
                                </div>
                            )}
                        </div>
                        <p className={`text-sm font-medium line-clamp-2 leading-tight ${String(part.id) === currentMediaId ? 'text-primary' : 'text-foreground/90 group-hover/card:text-primary transition-colors'}`}>
                            {part.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">
                                {part.release_date ? new Date(part.release_date).getFullYear() : 'TBA'}
                            </span>
                            {part.vote_average > 0 && (
                                <span className="flex items-center text-xs text-yellow-500/80">
                                    <Star className="w-3 h-3 mr-0.5 fill-current" />
                                    {part.vote_average.toFixed(1)}
                                </span>
                            )}
                        </div>
                    </Link>
                ))}
            </div>
        </section>
    );
};

const MovieDetail = () => {
    const { mediaType, mediaId } = useParams<{ mediaType: 'movie' | 'tv', mediaId: string }>();
    const { isLoggedIn, user: currentUser } = useAuth();
    const { warmRecommendations } = useWarmRecommendations();
    const queryClient = useQueryClient();

    const isMovie = mediaType === 'movie';
    const queryKey = [mediaType, 'details', mediaId];

    const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
        queryKey: getPreferencesQueryKey(currentUser?.id),
        queryFn: fetchUserPreferencesApi,
        enabled: isLoggedIn,
        staleTime: 1000 * 60 * 5,
    });

    const recommendationsEnabled = preferencesData?.preferences?.recommendations_enabled ?? false;
    const showNotInterested = isLoggedIn && recommendationsEnabled;
    const activeActionClass = 'bg-accent border-border text-foreground';

    const { data: mediaDetails, isLoading, isError, error } = useQuery<MovieDetails, Error>({
        queryKey: queryKey,
        queryFn: () => {
            if (!mediaId) throw new Error("Media ID is required");
            if (isMovie) {
                return fetchMovieDetailsApi(Number(mediaId));
            } else {
                return fetchTvDetailsApi(mediaId as unknown as number);
            }
        },
        enabled: !!mediaId && !!mediaType,
        staleTime: 1000 * 60 * 60,
    });

    // Fetch videos/trailers
    const { data: videosData } = useQuery({
        queryKey: [mediaType, 'videos', mediaId],
        queryFn: () => fetchVideosApi(mediaType as 'movie' | 'tv', Number(mediaId)),
        enabled: !!mediaId && !!mediaType,
        staleTime: 1000 * 60 * 60,
    });

    // Fetch credits/cast
    const { data: creditsData } = useQuery({
        queryKey: [mediaType, 'credits', mediaId],
        queryFn: () => fetchCreditsApi(mediaType as 'movie' | 'tv', Number(mediaId)),
        enabled: !!mediaId && !!mediaType,
        staleTime: 1000 * 60 * 60,
    });

    // Get target person (Director for movies, Creator for TV)
    const directors = creditsData?.crew?.filter((c: CrewMember) => c.job === 'Director') ?? [];
    const creators = mediaDetails?.created_by ?? [];

    const targetPerson = isMovie ? directors[0] : creators[0];
    const targetPersonId = targetPerson?.id;

    // Fetch person's other works
    const { data: personCreditsData } = useQuery<PersonCreditsResponse | null>({
        queryKey: ['person', 'credits', targetPersonId],
        queryFn: () => targetPersonId ? fetchPersonCreditsApi(targetPersonId) : null,
        enabled: !!targetPersonId,
        staleTime: 1000 * 60 * 60,
    });

    const personWorks = useMemo(() => personCreditsData?.crew ?? [], [personCreditsData]);
    const { ratingsMap: personWorksRatingsMap } = useOmdbRatings(personWorks);

    const studioIds = useMemo(() => mediaDetails?.production_companies?.map(c => c.id) ?? [], [mediaDetails]);
    const { data: studioMoviesData } = useQuery<SearchResults | null>({
        queryKey: ['studio', 'movies', studioIds],
        queryFn: () => studioIds.length > 0 ? fetchStudioMoviesApi(studioIds) : null,
        enabled: studioIds.length > 0,
        staleTime: 1000 * 60 * 60,
    });

    const studioMovies = useMemo(() => studioMoviesData?.results?.filter(
        (m) => String(m.id) !== mediaId && (m.poster_path || m.backdrop_path)
    )?.slice(0, 10) ?? [], [studioMoviesData, mediaId]);
    const { ratingsMap: studioRatingsMap } = useOmdbRatings(studioMovies);

    // Find the best trailer: prefer official YouTube trailers
    // Filter videos: only YouTube, type Trailer or Teaser
    const videos = videosData?.results?.filter(
        (v: Video) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
    ).sort((a: Video, b: Video) => {
        // Sort by Type (Trailer < Teaser)
        if (a.type === 'Trailer' && b.type !== 'Trailer') return -1;
        if (a.type !== 'Trailer' && b.type === 'Trailer') return 1;
        // Then by Official (Official < Non-official)
        if (a.official && !b.official) return -1;
        if (!a.official && b.official) return 1;
        return 0;
    }) || [];

    // Get top cast members (limit to 12)
    const cast = creditsData?.cast?.slice(0, 12) ?? [];



    // Fetch user collections (only if logged in)
    const { data: collectionsData, isLoading: isLoadingCollections } = useQuery({
        queryKey: ['collections', 'user'],
        queryFn: fetchUserCollectionsApi,
        enabled: isLoggedIn,
        staleTime: 1000 * 60 * 5,
    });

    // Fetch user's region for watch providers
    const { data: userRegion } = useQuery({
        queryKey: ['userRegion'],
        queryFn: fetchUserRegion,
        staleTime: Infinity,
    });

    // Fetch combined ratings (certification + parental guidance)
    const { data: ratingsData, isLoading: isLoadingRatings } = useQuery<CombinedRatingsResponse | null>({
        queryKey: [mediaType, 'ratings', mediaId, userRegion],
        queryFn: () => fetchCombinedRatingsApi(mediaType as 'movie' | 'tv', Number(mediaId), userRegion || 'US'),
        enabled: !!mediaId && !!mediaType && isLoggedIn,
        // staleTime: 1000 * 60 * 60 * 24, // Cache for 24 hours
    });

    // Fetch OMDB ratings (IMDB + Rotten Tomatoes)
    const { data: omdbData } = useQuery<OmdbRatingsResponse | null>({
        queryKey: [mediaType, 'omdb-ratings', mediaId],
        queryFn: () => fetchOmdbRatingsApi(mediaType as 'movie' | 'tv', Number(mediaId)),
        enabled: !!mediaId && !!mediaType,
        staleTime: 1000 * 60 * 60 * 24,
    });

    // Review summary + rating (for sidebar)
    const reviewSummaryQueryKey = ['reviews', mediaType, Number(mediaId), 'summary'];
    const { data: summaryData } = useQuery<ReviewSummaryResponse>({
        queryKey: reviewSummaryQueryKey,
        queryFn: () => fetchReviewSummaryApi(mediaType as 'movie' | 'tv', Number(mediaId)),
        enabled: !!mediaId && !!mediaType,
        staleTime: 60_000,
    });

    const rateMutation = useMutation({
        mutationFn: (rating: number | null) => rating === null
            ? deleteRatingApi(mediaType as 'movie' | 'tv', Number(mediaId))
            : upsertRatingApi(mediaType as 'movie' | 'tv', Number(mediaId), rating),
        onMutate: async (nextRating) => {
            await queryClient.cancelQueries({ queryKey: reviewSummaryQueryKey });
            const prev = queryClient.getQueryData<ReviewSummaryResponse>(reviewSummaryQueryKey);
            if (!prev) return { prev };
            const prevCount = prev.summary.ratingsCount;
            const prevAvg = prev.summary.averageRating ?? 0;
            const nextCount = nextRating === null
                ? Math.max(0, prevCount - (prev.userRating == null ? 0 : 1))
                : prev.userRating == null
                    ? prevCount + 1
                    : prevCount;
            const total = nextRating === null
                ? prevAvg * prevCount - (prev.userRating ?? 0)
                : prev.userRating == null
                    ? prevAvg * prevCount + nextRating
                    : prevAvg * prevCount - prev.userRating + nextRating;
            queryClient.setQueryData<ReviewSummaryResponse>(reviewSummaryQueryKey, {
                ...prev,
                userRating: nextRating,
                summary: { ...prev.summary, averageRating: nextCount > 0 ? Number((total / nextCount).toFixed(1)) : null, ratingsCount: nextCount },
            });
            return { prev };
        },
        onSuccess: (result) => {
            queryClient.setQueryData<ReviewSummaryResponse>(reviewSummaryQueryKey, result.summary);
        },
        onError: (_err: Error, _v, ctx) => {
            if (ctx?.prev) queryClient.setQueryData(reviewSummaryQueryKey, ctx.prev);
            toast.error('Failed to save rating');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: reviewSummaryQueryKey, refetchType: 'inactive' });
        },
    });

    // Construct the media ID as stored in collections (TV shows have 'tv' suffix)
    const collectionMediaId = isMovie ? mediaId : `${mediaId}tv`;

    // Fetch details for each collection to check if current movie/show is in it
    const collections = collectionsData?.collections ?? [];
    const movieStatusQueryKey = ['collections', 'movie-status', collectionMediaId];
    const { data: movieStatusMap, isLoading: isLoadingMovieStatus, refetch: refetchMovieStatus } = useQuery({
        queryKey: movieStatusQueryKey,
        queryFn: async () => {
            const results = await Promise.all(
                collections.map(async (collection: CollectionSummary) => {
                    const details = await fetchCollectionDetailsApi(collection.id);
                    // movie_id is stored as string, with 'tv' suffix for TV shows
                    const movieEntry = details?.movies?.find(
                        m => String(m.movie_id) === collectionMediaId
                    );
                    return { 
                        collectionId: collection.id, 
                        hasMedia: !!movieEntry,
                        addedByUserId: movieEntry?.added_by_user_id ?? null
                    };
                })
            );
            return results.reduce((acc, { collectionId, hasMedia, addedByUserId }) => {
                acc[collectionId] = { hasMedia, addedByUserId };
                return acc;
            }, {} as Record<string, { hasMedia: boolean; addedByUserId: string | null }>);
        },
        enabled: isLoggedIn && collections.length > 0 && !!mediaId && !!mediaType,
    });

    // Check if movie is in at least one collection
    const isInAnyCollection = movieStatusMap ? Object.values(movieStatusMap).some(status => status.hasMedia) : false;

    // Type for movie status map
    type MovieStatusMap = Record<string, { hasMedia: boolean; addedByUserId: string | null }>;

    // Debounce rapid collection toggles (e.g. adding a movie to several
    // collections in quick succession) into a single batch of API calls so
    // the backend expires the recommendation cache once per burst instead of
    // per click. Optimistic UI is instant; the network write is deferred.
    const collectionToggleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingCollectionOpsRef = useRef<Map<string, 'add' | 'remove'>>(new Map());
    const originalMovieStatusRef = useRef<MovieStatusMap | null>(null);

    const flushPendingCollectionOps = async () => {
        const ops = pendingCollectionOpsRef.current;
        const original = originalMovieStatusRef.current;
        if (ops.size === 0) return;

        pendingCollectionOpsRef.current = new Map();
        originalMovieStatusRef.current = null;

        const tasks: Promise<void>[] = [];
        const successfulCollectionIds = new Set<string>();

        for (const [collectionId, operation] of ops.entries()) {
            // Skip no-ops: if the server already has this state, don't write.
            // (Handles e.g. add → remove → add within one burst.)
            const originalHasMedia = original?.[collectionId]?.hasMedia ?? false;
            if (operation === 'add' && originalHasMedia) continue;
            if (operation === 'remove' && !originalHasMedia) continue;

            if (operation === 'add') {
                tasks.push(
                    addMovieToCollectionApi(collectionId, { movieId: collectionMediaId as unknown as number, title: isMovie ? (mediaDetails as MovieDetails)?.title : (mediaDetails as MovieDetails)?.name, posterPath: mediaDetails?.poster_path ?? null, mediaType })
                        .then(() => {
                            successfulCollectionIds.add(collectionId);
                            queryClient.invalidateQueries({ queryKey: ['collection', collectionId] });
                        })
                        .catch((error: Error & { data?: { message?: string } }) => {
                            queryClient.setQueryData<MovieStatusMap>(movieStatusQueryKey, (old) => ({
                                ...old,
                                [collectionId]: { hasMedia: false, addedByUserId: null },
                            }));
                            if (error?.data?.message?.includes('already exists')) {
                                toast.error('Already in this collection');
                            } else {
                                toast.error('Failed to add to collection');
                            }
                        })
                );
            } else {
                tasks.push(
                    removeMovieFromCollectionApi(collectionId, collectionMediaId!)
                        .then(() => {
                            successfulCollectionIds.add(collectionId);
                            queryClient.invalidateQueries({ queryKey: ['collection', collectionId] });
                        })
                        .catch(() => {
                            queryClient.setQueryData<MovieStatusMap>(movieStatusQueryKey, (old) => ({
                                ...old,
                                [collectionId]: { hasMedia: true, addedByUserId: currentUser?.id ?? null },
                            }));
                            toast.error('Failed to remove from collection');
                        })
                );
            }
        }

        await Promise.allSettled(tasks);

        if (successfulCollectionIds.size > 0 && recommendationsEnabled) {
            const recommendationCollections = await queryClient.fetchQuery<RecommendationCollectionsResponse>({
                queryKey: RECOMMENDATION_COLLECTIONS_QUERY_KEY,
                queryFn: fetchRecommendationCollectionsApi,
                staleTime: 1000 * 60 * 5,
            }).catch(() => null);

            const changedRecommendationSource = recommendationCollections?.collections.some(({ id }) =>
                successfulCollectionIds.has(id)
            );

            if (changedRecommendationSource) {
                warmRecommendations();
            }
        }
    };

    const handleCollectionToggle = (collectionId: string, isCurrentlyInCollection: boolean) => {
        const operation: 'add' | 'remove' = isCurrentlyInCollection ? 'remove' : 'add';

        // Snapshot the server state at the start of a burst so we can skip
        // no-op operations at flush time (e.g. add → remove → add).
        if (!collectionToggleDebounceRef.current) {
            originalMovieStatusRef.current = queryClient.getQueryData<MovieStatusMap>(movieStatusQueryKey) ?? null;
        }

        pendingCollectionOpsRef.current.set(collectionId, operation);

        // Optimistic update — instant UI feedback.
        queryClient.cancelQueries({ queryKey: movieStatusQueryKey });
        queryClient.setQueryData<MovieStatusMap>(movieStatusQueryKey, (old) => ({
            ...old,
            [collectionId]: {
                hasMedia: operation === 'add',
                addedByUserId: operation === 'add' ? (currentUser?.id ?? null) : null,
            },
        }));

        if (collectionToggleDebounceRef.current) {
            clearTimeout(collectionToggleDebounceRef.current);
        }
        collectionToggleDebounceRef.current = setTimeout(() => {
            collectionToggleDebounceRef.current = null;
            void flushPendingCollectionOps();
        }, RECOMMENDATION_TOGGLE_DEBOUNCE_MS);
    };

    // Flush a pending burst on unmount or navigation to a different movie so
    // changes are not silently dropped.
    useEffect(() => {
        return () => {
            if (collectionToggleDebounceRef.current) {
                clearTimeout(collectionToggleDebounceRef.current);
                collectionToggleDebounceRef.current = null;
                void flushPendingCollectionOps();
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionMediaId, queryClient]);

    // Watched status query and mutation
    const watchedQueryKey = ['watched', collectionMediaId];
    
    const { data: watchedData, isLoading: isLoadingWatched } = useQuery({
        queryKey: watchedQueryKey,
        queryFn: () => getWatchedStatusApi(collectionMediaId!),
        enabled: !!collectionMediaId && isLoggedIn,
    });

    const isWatched = watchedData?.isWatched ?? false;

    const toggleWatchedMutation = useMutation({
        mutationFn: () => toggleWatchedStatusApi(collectionMediaId!),
        onMutate: async () => {
            const nextIsWatched = !isWatched;
            const watchedAt = nextIsWatched ? new Date().toISOString() : null;

            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: watchedQueryKey });
            await queryClient.cancelQueries({ queryKey: ['watchedBatch'] });
            
            // Snapshot previous value
            const previousData = queryClient.getQueryData<{ isWatched: boolean; watchedAt: string | null }>(watchedQueryKey);
            const previousBatchData = queryClient.getQueriesData({ queryKey: ['watchedBatch'] });
            
            // Optimistically update
            queryClient.setQueryData(watchedQueryKey, {
                isWatched: nextIsWatched,
                watchedAt,
            });
            setWatchedStatusBatchQueryData(queryClient, collectionMediaId!, nextIsWatched, watchedAt);
            
            return { previousData, previousBatchData };
        },
        onSuccess: (data) => {
            setWatchedStatusBatchQueryData(
                queryClient,
                collectionMediaId!,
                data.isWatched,
                data.isWatched ? new Date().toISOString() : null,
            );
            queryClient.invalidateQueries({ queryKey: ['watched'], refetchType: 'none' });
            queryClient.invalidateQueries({ queryKey: ['watchedBatch'], refetchType: 'none' });
            queryClient.invalidateQueries({ queryKey: ['collections', 'watched', 'items'] });
            // Warm server cache so the next set of recs reflects this change
            warmRecommendations();
        },
        onError: (_error: Error, _, context) => {
            // Rollback on error
            if (context?.previousData) {
                queryClient.setQueryData(watchedQueryKey, context.previousData);
            }
            context?.previousBatchData.forEach(([queryKey, data]) => {
                queryClient.setQueryData(queryKey, data);
            });
            toast.error('Failed to update watched status');
        },
    });

    // Not interested status query and mutation
    const notInterestedQueryKey = ['notInterested', collectionMediaId];

    const { data: notInterestedData, isLoading: isLoadingNotInterested } = useQuery({
        queryKey: notInterestedQueryKey,
        queryFn: () => getNotInterestedStatusApi(collectionMediaId!),
        enabled: !!collectionMediaId && showNotInterested,
    });

    const isNotInterested = notInterestedData?.isNotInterested ?? false;

    const toggleNotInterestedMutation = useMutation({
        mutationFn: () => toggleNotInterestedStatusApi(collectionMediaId!),
        onMutate: async () => {
            const nextIsNotInterested = !isNotInterested;
            const notInterestedAt = nextIsNotInterested ? new Date().toISOString() : null;

            await queryClient.cancelQueries({ queryKey: notInterestedQueryKey });
            await queryClient.cancelQueries({ queryKey: ['notInterestedBatch'] });

            const previousData = queryClient.getQueryData<{ isNotInterested: boolean; notInterestedAt: string | null }>(notInterestedQueryKey);
            const previousBatchData = queryClient.getQueriesData({ queryKey: ['notInterestedBatch'] });

            queryClient.setQueryData(notInterestedQueryKey, {
                isNotInterested: nextIsNotInterested,
                notInterestedAt,
            });
            setNotInterestedStatusBatchQueryData(queryClient, collectionMediaId!, nextIsNotInterested, notInterestedAt);

            return { previousData, previousBatchData };
        },
        onSuccess: (data) => {
            setNotInterestedStatusBatchQueryData(
                queryClient,
                collectionMediaId!,
                data.isNotInterested,
                data.isNotInterested ? new Date().toISOString() : null,
            );
            queryClient.invalidateQueries({ queryKey: ['notInterested'], refetchType: 'none' });
            queryClient.invalidateQueries({ queryKey: ['notInterestedBatch'], refetchType: 'none' });
            queryClient.invalidateQueries({ queryKey: ['collections', 'not-interested', 'items'] });
            // Warm server cache so the next set of recs reflects this change
            warmRecommendations();
        },
        onError: (_error: Error, _, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(notInterestedQueryKey, context.previousData);
            }
            context?.previousBatchData.forEach(([queryKey, data]) => {
                queryClient.setQueryData(queryKey, data);
            });
            toast.error('Failed to update not interested status');
        },
    });

    const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
    const [overviewExpanded, setOverviewExpanded] = useState(false);
    const [collectionsOpen, setCollectionsOpen] = useState(false);
    const castScrollRef = useRef<HTMLDivElement>(null);
    const crewScrollRef = useRef<HTMLDivElement>(null);

    const scrollRight = (ref: React.RefObject<HTMLDivElement | null>) => {
        if (ref.current) {
            ref.current.scrollBy({ left: 200, behavior: 'smooth' });
        }
    };

    const renderSkeletons = () => (
        <>
            {/* Skeleton backdrop — matches real backdrop area */}
            <div className="-mt-16 relative w-full h-[50vh] md:h-[60vh] overflow-hidden">
                <Skeleton className="absolute inset-0 rounded-none" />
                <div className="absolute inset-0 bg-linear-to-t from-background via-background/60 to-background/20" />
            </div>

            <main className="container relative z-10 -mt-40 md:-mt-48 pb-12">
                <div className="flex flex-col md:flex-row gap-6 md:gap-8">
                    {/* Poster skeleton */}
                    <div className="w-48 md:w-56 lg:w-64 shrink-0 mx-auto md:mx-0">
                        <Skeleton className="w-full aspect-2/3 rounded-xl" />
                    </div>

                    {/* Details skeleton */}
                    <div className="grow flex flex-col items-center md:items-start space-y-4 pt-2 md:pt-8 w-full">
                        <Skeleton className="h-10 w-64 md:w-80 rounded-lg" />
                        <Skeleton className="h-5 w-48 rounded-md" />
                        <Skeleton className="h-4 w-32 rounded-md" />
                        <div className="flex gap-2">
                            <Skeleton className="h-7 w-10 rounded-md" />
                            <Skeleton className="h-7 w-12 rounded-md" />
                        </div>
                        <div className="flex gap-2">
                            <Skeleton className="h-6 w-16 rounded-full" />
                            <Skeleton className="h-6 w-24 rounded-full" />
                        </div>
                        <div className="space-y-2 pt-2 w-full flex flex-col items-center md:items-start">
                            <Skeleton className="h-5 w-24 rounded-md" />
                            <Skeleton className="h-4 w-full max-w-2xl rounded-md" />
                            <Skeleton className="h-4 w-3/4 max-w-xl rounded-md" />
                        </div>
                    </div>
                </div>
            </main>
        </>
    );

    if (isLoading) {
        return (
            <>
                <Navbar />
                {renderSkeletons()}
            </>
        );
    }

    if (isError) {
        return (
            <>
                <Navbar />
                <main className="container py-20 text-center">
                    <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-8 max-w-lg mx-auto">
                        <p className="text-destructive font-medium">Error loading details: {error?.message ?? 'Unknown error'}</p>
                    </div>
                </main>
            </>
        );
    }

    if (!mediaDetails) {
        return (
            <>
                <Navbar />
                <main className="container py-20 text-center text-muted-foreground">
                    Media not found.
                </main>
            </>
        );
    }

    const title = isMovie ? (mediaDetails as MovieDetails).title : (mediaDetails).name;
    const releaseDate = isMovie ? (mediaDetails as MovieDetails).release_date : (mediaDetails).first_air_date;
    const posterPath = mediaDetails.poster_path;
    const backdropPath = mediaDetails.backdrop_path;
    const overview = mediaDetails.overview;
    const genres = mediaDetails.genres ?? [];
    const rating = mediaDetails.vote_average?.toFixed(1);
    const tagline = mediaDetails.tagline;
    const networks = mediaDetails.networks ?? [];
    const primaryStudio = mediaDetails.production_companies?.find(c => c.logo_path) ?? null;

    const watchProviders = mediaDetails['watch/providers']?.results?.[userRegion || 'US'];

    return (
        <>
            <Navbar />

            {/* Backdrop Hero — extends behind navbar and status bar */}
            <div 
                className="relative w-full h-[50vh] md:h-[60vh] overflow-hidden"
                style={{ marginTop: 'calc(-4rem - env(safe-area-inset-top))' }}
            >
                {backdropPath ? (
                    <img
                        src={getImageUrl(backdropPath, 'original')}
                        alt={`${title} backdrop`}
                        className="absolute inset-0 w-full h-full object-cover object-top"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                        <ImageOff className="w-16 h-16 text-muted-foreground/30" />
                    </div>
                )}
                {/* Multi-layer gradient overlay for smooth blending */}
                <div className="absolute inset-0 bg-linear-to-t from-background via-background/60 to-background/20" />
                <div className="absolute inset-0 bg-linear-to-r from-background/50 to-transparent" />
            </div>

            {/* Main Content — overlaps backdrop */}
            <main className="container relative z-10 -mt-40 md:-mt-48 pb-12">
                <div className="flex flex-col md:flex-row gap-6 md:gap-8">
                    {/* Poster */}
                    <div className="w-48 md:w-56 lg:w-64 shrink-0 mx-auto md:mx-0">
                        <div className="rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-border/60">
                            <img
                                src={posterPath ? getImageUrl(posterPath, 'w500') : '/placeholder.svg'}
                                alt={title}
                                className="w-full h-auto aspect-2/3 object-cover bg-muted"
                                onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                            />
                        </div>
                    </div>

                    {/* Details */}
                    <div className="grow space-y-5 md:space-y-4 text-center md:text-left pt-2 md:pt-8">
                        <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">{title}</h1>

                        {tagline && (
                            <p className="text-base md:text-lg text-muted-foreground italic">"{tagline}"</p>
                        )}

                        {/* Meta row */}
                        <div className="flex flex-wrap justify-center md:justify-start items-center gap-x-4 gap-y-3 text-sm text-muted-foreground">
                            {releaseDate && (
                                <span className="font-medium text-foreground/80">{new Date(releaseDate).getFullYear()}</span>
                            )}
                            {/* Certification Badge */}
                            {ratingsData?.certification?.certification && (
                                <>
                                    <span className="text-muted-foreground/40">|</span>
                                    <CertificationBadge certification={ratingsData.certification.certification} />
                                </>
                            )}
                            {/* IMDB Rating (preferred) or TMDB fallback */}
                            {omdbData?.imdbRating ? (
                                <>
                                    <span className="text-muted-foreground/40">|</span>
                                    <span className="flex items-center gap-1.5" title="IMDb rating">
                                        <span className="inline-flex items-center justify-center rounded bg-[#f5c518] px-1 py-px text-[10px] font-extrabold leading-none text-black tracking-tight">IMDb</span>
                                        <span className="font-medium text-foreground/80">{omdbData.imdbRating.toFixed(1)}</span>
                                    </span>
                                </>
                            ) : rating && rating !== '0.0' ? (
                                <>
                                    <span className="text-muted-foreground/40">|</span>
                                    <span className="flex items-center gap-1.5" title="TMDB rating">
                                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                                        <span className="font-medium text-foreground/80">{rating}</span>
                                    </span>
                                </>
                            ) : null}
                            {/* Rotten Tomatoes rating */}
                            {omdbData?.rottenTomatoesRating != null && (
                                <>
                                    <span className="text-muted-foreground/40">|</span>
                                    <span className="flex items-center gap-1" title="Rotten Tomatoes">
                                        <span className="text-xs leading-none">🍅</span>
                                        <span className="font-medium text-foreground/80">{omdbData.rottenTomatoesRating}%</span>
                                    </span>
                                </>
                            )}
                            {mediaDetails.runtime > 0 && (
                                <>
                                    <span className="text-muted-foreground/40">|</span>
                                    <span>{Math.floor(mediaDetails.runtime / 60)}h {mediaDetails.runtime % 60}m</span>
                                </>
                            )}
                            {genres.length > 0 && (
                                <>
                                    <span className="hidden md:inline text-muted-foreground/40">|</span>
                                    <div className="flex flex-wrap justify-center md:justify-start gap-2 w-full md:w-auto pt-1 md:pt-0">
                                        {genres.map(genre => (
                                            <Badge key={genre.id} variant="outline" className="border-border text-foreground/70 px-2.5 py-0.5 h-6 text-xs font-normal">
                                                {genre.name}
                                            </Badge>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Directed by (movies) / Created by (TV shows) */}
                        {isMovie && directors.length > 0 && (
                            <div className="pt-2 text-center md:text-left">
                                <span className="text-sm text-muted-foreground">Directed by </span>
                                <span className="text-sm font-medium text-foreground/90">
                                    {directors.map((d) => d.name).join(', ')}
                                </span>
                            </div>
                        )}
                        {!isMovie && creators.length > 0 && (
                            <div className="pt-2 text-center md:text-left">
                                <span className="text-sm text-muted-foreground">Created by </span>
                                <span className="text-sm font-medium text-foreground/90">
                                    {creators.map((c) => c.name).join(', ')}
                                </span>
                            </div>
                        )}

                        {/* Watch Providers & Studio */}
                        {(watchProviders || primaryStudio) && (
                            <div className="pt-4">
                                <div className="flex flex-wrap justify-center md:justify-start gap-x-8 gap-y-4">
                                    {watchProviders?.flatrate && watchProviders.flatrate.length > 0 ? (
                                        <ProviderStack
                                            title="Stream"
                                            logos={watchProviders.flatrate.map(p => ({ id: p.provider_id, src: `${TMDB_LOGO_BASE}${p.logo_path}`, alt: p.provider_name }))}
                                        />
                                    ) : (
                                        <>
                                            {watchProviders?.rent && watchProviders.rent.length > 0 && (
                                                <ProviderStack
                                                    title="Rent"
                                                    logos={watchProviders.rent.map(p => ({ id: p.provider_id, src: `${TMDB_LOGO_BASE}${p.logo_path}`, alt: p.provider_name }))}
                                                />
                                            )}
                                            {watchProviders?.buy && watchProviders.buy.length > 0 && (
                                                <ProviderStack
                                                    title="Buy"
                                                    logos={watchProviders.buy.map(p => ({ id: p.provider_id, src: `${TMDB_LOGO_BASE}${p.logo_path}`, alt: p.provider_name }))}
                                                />
                                            )}
                                        </>
                                    )}
                                    {primaryStudio && primaryStudio.logo_path && (
                                        <ProviderStack
                                            title="Studio"
                                            logos={[{ id: primaryStudio.id, src: `${TMDB_LOGO_BASE}${primaryStudio.logo_path}`, alt: primaryStudio.name, isStudio: true }]}
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Action Buttons - Mobile Only */}
                        <div className="pt-2 flex justify-center gap-4 md:hidden">
                            <Popover open={collectionsOpen} onOpenChange={setCollectionsOpen}>
                                <PopoverTrigger asChild>
                                    <button
                                        className="flex flex-col items-center justify-center w-20 h-20 rounded-2xl border border-border bg-secondary/40 hover:bg-secondary/70 transition-colors"
                                    >
                                        <Bookmark className={`h-6 w-6 text-foreground/90 ${isInAnyCollection ? 'fill-current' : ''}`} />
                                        <span className="text-xs font-semibold text-foreground/70 mt-1.5">Save</span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 p-0 border-border bg-popover shadow-xl shadow-black/40" align="start">
                                    <div className="px-4 py-3 border-b border-border">
                                        <p className="text-sm font-semibold text-foreground">
                                            Save to collection
                                        </p>
                                    </div>
                                    <div className="p-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                                        {!isLoggedIn ? (
                                            <div className="py-6 px-4 text-center space-y-3">
                                                <p className="text-sm text-muted-foreground">
                                                    Sign in to save this to your collections
                                                </p>
                                                <Button asChild size="sm" className="w-full">
                                                    <a href={`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000'}/api/auth/google`}>
                                                        Sign in with Google
                                                    </a>
                                                </Button>
                                            </div>
                                        ) : isLoadingCollections || isLoadingMovieStatus ? (
                                            <div className="flex items-center justify-center py-6">
                                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                            </div>
                                        ) : collectionsData?.collections?.length === 0 ? (
                                            <div className="py-6 px-4 text-center">
                                                <p className="text-sm text-muted-foreground">
                                                    No collections yet
                                                </p>
                                                <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-primary" asChild>
                                                    <a href="/collections">Create one</a>
                                                </Button>
                                            </div>
                                        ) : (
                                            collectionsData?.collections?.map((collection: CollectionSummary) => {
                                                const status = movieStatusMap?.[collection.id];
                                                const isInCollection = status?.hasMedia ?? false;
                                                const addedByUserId = status?.addedByUserId;

                                                const isOwner = collection.user_permission === 'owner';
                                                const isEditPermission = collection.user_permission === 'edit';
                                                const isViewOnly = collection.user_permission === 'view';

                                                const canAdd = isOwner || isEditPermission;
                                                const canRemove = isOwner || (isEditPermission && addedByUserId === currentUser?.id);
                                                const canToggle = isInCollection ? canRemove : canAdd;
                                                const isDisabled = !canToggle;

                                                return (
                                                    <div
                                                        key={collection.id}
                                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all group ${
                                                            isDisabled
                                                                ? 'opacity-50 cursor-not-allowed'
                                                                : 'hover:bg-accent/50 cursor-pointer'
                                                        }`}
                                                        onClick={() => canToggle && handleCollectionToggle(collection.id, isInCollection)}
                                                    >
                                                        <Checkbox
                                                            checked={isInCollection}
                                                            disabled={isDisabled}
                                                            onCheckedChange={() => canToggle && handleCollectionToggle(collection.id, isInCollection)}
                                                            className={`pointer-events-none rounded-full w-5 h-5 border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-all ${
                                                                isDisabled ? '' : 'group-hover:border-muted-foreground/50'
                                                            }`}
                                                        />
                                                        <span className={`text-sm truncate flex-1 transition-colors ${
                                                            isInCollection
                                                                ? 'text-foreground font-medium'
                                                                : isDisabled
                                                                    ? 'text-muted-foreground'
                                                                    : 'text-muted-foreground group-hover:text-foreground'
                                                        }`}>
                                                            {collection.name}
                                                            {isViewOnly && <span className="text-xs ml-1">(view only)</span>}
                                                        </span>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </PopoverContent>
                            </Popover>

                            {isLoggedIn && (
                                <>
                                    <button
                                        className={`flex flex-col items-center justify-center w-20 h-20 rounded-2xl border border-border transition-colors ${isWatched ? activeActionClass : 'bg-secondary/40 hover:bg-secondary/70'}`}
                                        onClick={() => toggleWatchedMutation.mutate()}
                                        disabled={isLoadingWatched}
                                    >
                                        {isWatched ? (
                                            <EyeOff className="h-6 w-6 text-foreground/90" />
                                        ) : (
                                            <Eye className="h-6 w-6 text-foreground/90" />
                                        )}
                                        <span className="text-xs font-semibold text-foreground/70 mt-1.5">{isWatched ? 'Unwatch' : 'Watched'}</span>
                                    </button>
                                    {showNotInterested && (
                                        <button
                                            className={`flex flex-col items-center justify-center w-20 h-20 rounded-2xl border border-border transition-colors ${isNotInterested ? activeActionClass : 'bg-secondary/40 hover:bg-secondary/70'}`}
                                            onClick={() => toggleNotInterestedMutation.mutate()}
                                            disabled={isLoadingNotInterested}
                                        >
                                            <ThumbsDown className={`h-6 w-6 ${isNotInterested ? 'text-foreground/90 fill-current' : 'text-foreground/90'}`} />
                                            <span className="text-xs font-semibold text-foreground/70 mt-1.5 leading-tight text-center">{isNotInterested ? 'Undo' : 'Skip'}</span>
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                    </div>
                </div>

                <div className="mt-10 md:mt-14 flex flex-col md:flex-row md:gap-10">
                    {/* Main content column */}
                    <div className="flex-1 min-w-0 space-y-10 md:space-y-14">

                    {/* Overview Section */}
                    {overview && (
                        <section className="space-y-4">
                                    <h2 className="text-xl md:text-2xl font-semibold text-foreground/90 text-center md:text-left">Overview</h2>
                                    <div className="flex flex-col items-center md:items-start text-center md:text-left">
                                        <p className="text-base leading-relaxed text-foreground/80">
                                            {overview.length > OVERVIEW_CHAR_LIMIT && !overviewExpanded
                                                ? overview.slice(0, OVERVIEW_CHAR_LIMIT).trimEnd() + '...'
                                                : overview}
                                        </p>
                                        {overview.length > OVERVIEW_CHAR_LIMIT && (
                                            <button
                                                onClick={() => setOverviewExpanded(!overviewExpanded)}
                                                className="mt-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                {overviewExpanded ? 'Show less' : 'Read more'}
                                            </button>
                                        )}
                                    </div>
                            
                            {/* Parental Guidance Badges */}
                            {isLoggedIn && (ratingsData?.parentalGuidance || isLoadingRatings) && (
                                <ParentalGuidance 
                                    data={ratingsData?.parentalGuidance || null}
                                    isLoading={isLoadingRatings}
                                    className="mt-6"
                                />
                            )}
                        </section>
                    )}
                    
                    {/* Parental Guidance (when no overview) */}
                    {!overview && isLoggedIn && (ratingsData?.parentalGuidance || isLoadingRatings) && (
                        <section>
                            <ParentalGuidance 
                                data={ratingsData?.parentalGuidance || null}
                                isLoading={isLoadingRatings}
                            />
                        </section>
                    )}

                    {/* Trailers Section */}
                    {videos.length > 0 && (
                        <section className="space-y-6">
                            <h2 className="text-xl md:text-2xl font-semibold text-foreground/90">Trailers & Clips</h2>
                            <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                                {videos.map((video: Video) => (
                                    <div key={video.key} className="shrink-0 w-80 md:w-96 snap-center group/card">
                                        <div className="relative aspect-video rounded-xl overflow-hidden border border-border/60 bg-muted shadow-lg shadow-black/20">
                                            {playingVideoId === video.key ? (
                                                <iframe
                                                    src={`https://www.youtube.com/embed/${video.key}?autoplay=1&rel=0`}
                                                    title={video.name}
                                                    className="w-full h-full"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                />
                                            ) : (
                                                <button
                                                    onClick={() => setPlayingVideoId(video.key)}
                                                    className="relative w-full h-full cursor-pointer"
                                                >
                                                    <img
                                                        src={`https://img.youtube.com/vi/${video.key}/maxresdefault.jpg`}
                                                        alt={video.name}
                                                        className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                                                        onLoad={(e) => {
                                                            const img = e.target as HTMLImageElement;
                                                            if (img.naturalWidth === 120 && img.naturalHeight === 90 && backdropPath) {
                                                                img.src = getImageUrl(backdropPath, 'w780');
                                                            }
                                                        }}
                                                        onError={(e) => {
                                                            const img = e.target as HTMLImageElement;
                                                            if (img.src.includes('maxresdefault')) {
                                                                img.src = `https://img.youtube.com/vi/${video.key}/sddefault.jpg`;
                                                            } else if (backdropPath) {
                                                                img.src = getImageUrl(backdropPath, 'w780');
                                                            }
                                                        }}
                                                    />
                                                    <div className="absolute inset-0 bg-background/30 transition-colors group-hover/card:bg-background/45" />
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <div className="w-12 h-12 rounded-full bg-background/50 backdrop-blur-md border border-border/70 flex items-center justify-center transition-all duration-300 group-hover/card:scale-110 group-hover/card:bg-background/65">
                                                            <Play className="w-5 h-5 text-foreground fill-foreground ml-0.5" />
                                                        </div>
                                                    </div>
                                                </button>
                                            )}
                                        </div>
                                        <div className="mt-3 space-y-1">
                                            <p className="text-sm font-medium text-foreground/90 line-clamp-1" title={video.name}>
                                                {video.name}
                                            </p>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Badge variant="secondary" className="h-5 px-1.5 font-normal bg-secondary/60 text-secondary-foreground hover:bg-secondary/80">
                                                    {video.type}
                                                </Badge>
                                                <span>YouTube</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {mediaType && mediaId && (
                        <ReviewSection mediaType={mediaType} tmdbId={Number(mediaId)} />
                    )}

                    {/* Seasons Section (TV Shows) */}
                    {!isMovie && mediaDetails.seasons && mediaDetails.seasons.length > 0 && (
                        <section className="space-y-6">
                            <h2 className="text-xl md:text-2xl font-semibold text-foreground/90">
                                {mediaDetails.seasons.some(s => s.name.includes('Part')) ? 'Parts' : 'Seasons'}
                            </h2>
                            <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                                {mediaDetails.seasons.map((season) => (
                                    <Link
                                        key={season.id}
                                        to={`/tv/${mediaId}/season/${season.season_number}`}
                                        className="shrink-0 w-36 md:w-44 snap-center group/card block"
                                    >
                                        <div className="aspect-2/3 rounded-lg overflow-hidden border border-border/60 bg-muted shadow-md mb-2 relative">
                                            {season.poster_path ? (
                                                <img
                                                    src={getImageUrl(season.poster_path, 'w342')}
                                                    alt={season.name}
                                                    className="w-full h-full object-cover transition-transform duration-300 group-hover/card:scale-105"
                                                    onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center bg-muted p-2 text-center">
                                                    <span className="text-sm text-muted-foreground">{season.name}</span>
                                                </div>
                                            )}
                                            <div className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] font-medium text-foreground/90">
                                                {season.episode_count} eps
                                            </div>
                                        </div>
                                        <p className="text-sm font-medium text-foreground/90 line-clamp-1 group-hover/card:text-primary transition-colors" title={season.name}>
                                            {season.name}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-muted-foreground">
                                                {season.air_date ? new Date(season.air_date).getFullYear() : 'TBA'}
                                            </span>
                                            {season.vote_average > 0 && (
                                                <span className="flex items-center text-xs text-yellow-500/80">
                                                    <Star className="w-3 h-3 mr-0.5 fill-current" />
                                                    {season.vote_average.toFixed(1)}
                                                </span>
                                            )}
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Cast Section */}
                    {cast.length > 0 && (
                        <section className="space-y-6">
                            <h2 className="text-xl md:text-2xl font-semibold text-foreground/90">Top Cast</h2>
                            {/* Mobile: horizontal scroll with gradient fade */}
                            <div className="md:hidden relative -mx-4">
                                <div 
                                    ref={castScrollRef}
                                    className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide px-4 pr-16"
                                >
                                    {cast.map((member: CastMember) => (
                                        <Link key={member.id} to={`/person/${member.id}`} className="shrink-0 w-24 flex flex-col items-center text-center snap-center group">
                                            <div className="w-20 h-20 rounded-full overflow-hidden bg-muted/30 border border-border/60 mb-2 transition-transform duration-300 group-hover:scale-105">
                                                {member.profile_path ? (
                                                    <img
                                                        src={getImageUrl(member.profile_path, 'w185')}
                                                        alt={member.name}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <User className="w-8 h-8 text-muted-foreground/50" />
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-sm font-medium text-foreground/90 line-clamp-1 group-hover:text-foreground transition-colors">{member.name}</p>
                                            <p className="text-xs text-muted-foreground line-clamp-1">{member.character}</p>
                                        </Link>
                                    ))}
                                </div>
                                <button
                                    onClick={() => scrollRight(castScrollRef)}
                                    className="absolute right-0 top-0 bottom-4 w-16 flex items-center justify-center bg-linear-to-l from-background via-background/80 to-transparent"
                                    aria-label="Scroll right"
                                >
                                    <ChevronRight className="w-5 h-5 text-foreground/60" />
                                </button>
                            </div>
                            {/* Desktop: left-aligned grid */}
                            <div className="hidden md:grid grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-6">
                                {cast.map((member: CastMember) => (
                                    <Link key={member.id} to={`/person/${member.id}`} className="flex flex-col items-center text-center group">
                                        <div className="w-24 h-24 rounded-full overflow-hidden bg-muted/30 border border-border/60 mb-2 transition-transform duration-300 group-hover:scale-105">
                                            {member.profile_path ? (
                                                <img
                                                    src={getImageUrl(member.profile_path, 'w185')}
                                                    alt={member.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <User className="w-8 h-8 text-muted-foreground/50" />
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-sm font-medium text-foreground/90 line-clamp-1 group-hover:text-foreground transition-colors">{member.name}</p>
                                        <p className="text-xs text-muted-foreground line-clamp-1">{member.character}</p>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Crew Section */}
                    {(() => {
                        const keyJobs = ['Director', 'Screenplay', 'Story', 'Writer', 'Producer', 'Executive Producer', 'Director of Photography', 'Original Music Composer', 'Editor'];
                        const crew = creditsData?.crew?.filter((c: CrewMember) => keyJobs.includes(c.job)) ?? [];

                        // Deduplicate crew members (combine jobs if same person)
                        const uniqueCrewMap = new Map<number, CrewMember & { jobs: string[] }>();

                        crew.forEach((member: CrewMember) => {
                            if (!uniqueCrewMap.has(member.id)) {
                                uniqueCrewMap.set(member.id, { ...member, jobs: [member.job] });
                            } else {
                                const existing = uniqueCrewMap.get(member.id)!;
                                if (!existing.jobs.includes(member.job)) {
                                    existing.jobs.push(member.job);
                                }
                            }
                        });

                        const uniqueCrew = Array.from(uniqueCrewMap.values());

                        // Sort by job priority (Director first)
                        uniqueCrew.sort((a, b) => {
                            const getPriority = (jobs: string[]) => {
                                if (jobs.includes('Director')) return 0;
                                if (jobs.includes('Writer') || jobs.includes('Screenplay') || jobs.includes('Story')) return 1;
                                if (jobs.includes('Producer') || jobs.includes('Executive Producer')) return 2;
                                return 3;
                            };
                            return getPriority(a.jobs) - getPriority(b.jobs);
                        });

                        if (uniqueCrew.length === 0) return null;

                        return (
                            <section className="space-y-6">
                                <h2 className="text-xl md:text-2xl font-semibold text-foreground/90">Crew</h2>
                                {/* Mobile: horizontal scroll with gradient fade */}
                                <div className="md:hidden relative -mx-4">
                                    <div 
                                        ref={crewScrollRef}
                                        className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide px-4 pr-16"
                                    >
                                        {uniqueCrew.map((member) => (
                                            <Link key={member.id} to={`/person/${member.id}`} className="shrink-0 w-24 flex flex-col items-center text-center snap-center group">
                                                <div className="w-20 h-20 rounded-full overflow-hidden bg-muted/30 border border-border/60 mb-2 transition-transform duration-300 group-hover:scale-105">
                                                    {member.profile_path ? (
                                                        <img
                                                            src={getImageUrl(member.profile_path, 'w185')}
                                                            alt={member.name}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <User className="w-8 h-8 text-muted-foreground/50" />
                                                        </div>
                                                    )}
                                                </div>
                                                <p className="text-sm font-medium text-foreground/90 line-clamp-1 group-hover:text-foreground transition-colors">{member.name}</p>
                                                <p className="text-xs text-muted-foreground line-clamp-2">{member.jobs.join(', ')}</p>
                                            </Link>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => scrollRight(crewScrollRef)}
                                        className="absolute right-0 top-0 bottom-4 w-16 flex items-center justify-center bg-linear-to-l from-background via-background/80 to-transparent"
                                        aria-label="Scroll right"
                                    >
                                        <ChevronRight className="w-5 h-5 text-foreground/60" />
                                    </button>
                                </div>
                                {/* Desktop: left-aligned grid */}
                                <div className="hidden md:grid grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-6">
                                    {uniqueCrew.map((member) => (
                                        <Link key={member.id} to={`/person/${member.id}`} className="flex flex-col items-center text-center group">
                                            <div className="w-24 h-24 rounded-full overflow-hidden bg-muted/30 border border-border/60 mb-2 transition-transform duration-300 group-hover:scale-105">
                                                {member.profile_path ? (
                                                    <img
                                                        src={getImageUrl(member.profile_path, 'w185')}
                                                        alt={member.name}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <User className="w-8 h-8 text-muted-foreground/50" />
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-sm font-medium text-foreground/90 line-clamp-1 group-hover:text-foreground transition-colors">{member.name}</p>
                                            <p className="text-xs text-muted-foreground line-clamp-2">{member.jobs.join(', ')}</p>
                                        </Link>
                                    ))}
                                </div>
                            </section>
                        );
                    })()}

                    {/* Collection Section */}
                    {mediaDetails.belongs_to_collection && (
                        <CollectionSection
                            collectionId={mediaDetails.belongs_to_collection.id}
                            currentMediaId={String(mediaId)}
                        />
                    )}


                    {/* More from Director Section */}
                    {/* More from Director/Creator Section */}
                    {personCreditsData && targetPerson && (
                        (() => {
                            // Filter works based on role
                            const curatedWorks = personCreditsData.crew.filter((c: PersonCredit) => {
                                // Exclude current media
                                if (String(c.id) === mediaId) return false;
                                // Must have image
                                if (!c.poster_path && !c.backdrop_path) return false;

                                if (isMovie) {
                                    // For Director: only show Directed works
                                    return c.job === 'Director';
                                } else {
                                    // For Creator (TV): show works where they are Creator, Exec Producer, Writer, or Director
                                    const significantJobs = ['Creator', 'Executive Producer', 'Writer', 'Screenplay', 'Director', 'Showrunner'];
                                    return significantJobs.includes(c.job || '');
                                }
                            });

                            // Deduplicate by ID (one person might have multiple credits on same show)
                            const uniqueWorks = Array.from(new Map(curatedWorks.map(item => [item.id, item])).values());

                            // Sort by popularity
                            uniqueWorks.sort((a, b) => {
                                const popA = a.popularity || 0;
                                const popB = b.popularity || 0;
                                return popB - popA;
                            });

                            const topWorks = enrichMoviesWithImdbRatings(uniqueWorks.slice(0, 10), personWorksRatingsMap);

                            if (topWorks.length === 0) return null;

                            return (
                                <section className="space-y-6">
                                    <h2 className="text-xl md:text-2xl font-semibold text-foreground/90">
                                        More from {targetPerson.name}
                                    </h2>
                                    <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                                        {topWorks.map((work: PersonCredit) => (
                                            <Link
                                                key={`${work.media_type}-${work.id}`}
                                                to={`/media/${work.media_type}/${work.id}`}
                                                className="shrink-0 w-32 md:w-40 snap-center group/card block"
                                            >
                                                <div className="aspect-2/3 rounded-lg overflow-hidden border border-border/60 bg-muted shadow-md mb-2">
                                                    <img
                                                        src={getImageUrl(work.poster_path, 'w342')}
                                                        alt={work.title || work.name}
                                                        className="w-full h-full object-cover transition-transform duration-300 group-hover/card:scale-105"
                                                    />
                                                </div>
                                                <p className="text-sm font-medium text-foreground/90 line-clamp-2 leading-tight">
                                                    {work.title || work.name}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs text-muted-foreground">
                                                        {work.release_date ? new Date(work.release_date).getFullYear() : (work.first_air_date ? new Date(work.first_air_date).getFullYear() : 'N/A')}
                                                    </span>
                                                    {(work.imdb_rating || work.vote_average > 0) && (
                                                        <span className="flex items-center text-xs text-yellow-500/80">
                                                            {work.imdb_rating ? (
                                                                <>
                                                                    <span className="inline-flex items-center justify-center rounded bg-[#f5c518] px-0.5 mr-0.5 text-[7px] font-extrabold leading-none text-black tracking-tight">IMDb</span>
                                                                    {work.imdb_rating.toFixed(1)}
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Star className="w-3 h-3 mr-0.5 fill-current" />
                                                                    {work.vote_average.toFixed(1)}
                                                                </>
                                                            )}
                                                        </span>
                                                    )}
                                                </div>
                                            </Link>
                                        ))}
                                    </div>
                                </section>
                            );
                        })()
                    )}

                    {/* More from Studio Section */}
                    {studioIds.length > 0 && studioMovies.length > 0 && (() => {
                        const topStudioWorks = enrichMoviesWithImdbRatings(studioMovies, studioRatingsMap);

                        return (
                            <section className="space-y-6">
                                <h2 className="text-xl md:text-2xl font-semibold text-foreground/90">
                                    Popular from Producers
                                </h2>
                                <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
                                    {topStudioWorks.map((work) => (
                                        <Link
                                            key={`studio-${work.id}`}
                                            to={`/media/movie/${work.id}`}
                                            className="shrink-0 w-32 md:w-40 snap-center group/card block"
                                        >
                                            <div className="aspect-2/3 rounded-lg overflow-hidden border border-border/60 bg-muted shadow-md mb-2">
                                                <img
                                                    src={getImageUrl(work.poster_path, 'w342')}
                                                    alt={work.title || work.name}
                                                    className="w-full h-full object-cover transition-transform duration-300 group-hover/card:scale-105"
                                                />
                                            </div>
                                            <p className="text-sm font-medium text-foreground/90 line-clamp-2 leading-tight">
                                                {work.title || work.name}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs text-muted-foreground">
                                                    {work.release_date ? new Date(work.release_date).getFullYear() : 'N/A'}
                                                </span>
                                                {(work.imdb_rating || work.vote_average > 0) && (
                                                    <span className="flex items-center text-xs text-yellow-500/80">
                                                        {work.imdb_rating ? (
                                                            <>
                                                                <span className="inline-flex items-center justify-center rounded bg-[#f5c518] px-0.5 mr-0.5 text-[7px] font-extrabold leading-none text-black tracking-tight">IMDb</span>
                                                                {work.imdb_rating.toFixed(1)}
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Star className="w-3 h-3 mr-0.5 fill-current" />
                                                                {work.vote_average.toFixed(1)}
                                                            </>
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </section>
                        );
                    })()}
                    </div>

                    {/* Right sidebar - Desktop only */}
                    <aside className="hidden md:block w-56 lg:w-64 shrink-0">
                        <div className="sticky top-20">
                            <div className="rounded-2xl border border-border bg-secondary/40 p-2 flex gap-1">
                                {isLoggedIn && (
                                    <>
                                        <button
                                            className={`flex-1 flex items-center justify-center h-12 rounded-xl transition-colors cursor-pointer ${isWatched ? 'bg-accent' : 'hover:bg-secondary/70'}`}
                                            onClick={() => toggleWatchedMutation.mutate()}
                                            disabled={isLoadingWatched}
                                            title={isWatched ? 'Unwatch' : 'Watched'}
                                        >
                                            {isWatched ? (
                                                <EyeOff className="h-5 w-5 text-foreground/90" />
                                            ) : (
                                                <Eye className="h-5 w-5 text-foreground/90" />
                                            )}
                                        </button>
                                        {showNotInterested && (
                                            <button
                                                className={`flex-1 flex items-center justify-center h-12 rounded-xl transition-colors cursor-pointer ${isNotInterested ? 'bg-accent' : 'hover:bg-secondary/70'}`}
                                                onClick={() => toggleNotInterestedMutation.mutate()}
                                                disabled={isLoadingNotInterested}
                                                title={isNotInterested ? 'Undo skip' : 'Skip'}
                                            >
                                                <ThumbsDown className={`h-5 w-5 ${isNotInterested ? 'text-foreground/90 fill-current' : 'text-foreground/90'}`} />
                                            </button>
                                        )}
                                    </>
                                )}

                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button
                                            className="flex-1 flex items-center justify-center h-12 rounded-xl hover:bg-secondary/70 transition-colors cursor-pointer"
                                            title="Save"
                                        >
                                            <Bookmark className={`h-5 w-5 text-foreground/90 ${isInAnyCollection ? 'fill-current' : ''}`} />
                                        </button>
                                    </PopoverTrigger>
                                <PopoverContent className="w-72 p-0 border-border bg-popover shadow-xl shadow-black/40" align="end">
                                    <div className="px-4 py-3 border-b border-border">
                                        <p className="text-sm font-semibold text-foreground">
                                            Save to collection
                                        </p>
                                    </div>
                                    <div className="p-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                                        {!isLoggedIn ? (
                                            <div className="py-6 px-4 text-center space-y-3">
                                                <p className="text-sm text-muted-foreground">
                                                    Sign in to save this to your collections
                                                </p>
                                                <Button asChild size="sm" className="w-full">
                                                    <a href={`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000'}/api/auth/google`}>
                                                        Sign in with Google
                                                    </a>
                                                </Button>
                                            </div>
                                        ) : isLoadingCollections || isLoadingMovieStatus ? (
                                            <div className="flex items-center justify-center py-6">
                                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                            </div>
                                        ) : collectionsData?.collections?.length === 0 ? (
                                            <div className="py-6 px-4 text-center">
                                                <p className="text-sm text-muted-foreground">
                                                    No collections yet
                                                </p>
                                                <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-primary" asChild>
                                                    <a href="/collections">Create one</a>
                                                </Button>
                                            </div>
                                        ) : (
                                            collectionsData?.collections?.map((collection: CollectionSummary) => {
                                                const status = movieStatusMap?.[collection.id];
                                                const isInCollection = status?.hasMedia ?? false;
                                                const addedByUserId = status?.addedByUserId;

                                                const isOwner = collection.user_permission === 'owner';
                                                const isEditPermission = collection.user_permission === 'edit';
                                                const isViewOnly = collection.user_permission === 'view';

                                                const canAdd = isOwner || isEditPermission;
                                                const canRemove = isOwner || (isEditPermission && addedByUserId === currentUser?.id);
                                                const canToggle = isInCollection ? canRemove : canAdd;
                                                const isDisabled = !canToggle;

                                                return (
                                                    <div
                                                        key={collection.id}
                                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all group ${
                                                            isDisabled
                                                                ? 'opacity-50 cursor-not-allowed'
                                                                : 'hover:bg-accent/50 cursor-pointer'
                                                        }`}
                                                        onClick={() => canToggle && handleCollectionToggle(collection.id, isInCollection)}
                                                    >
                                                        <Checkbox
                                                            checked={isInCollection}
                                                            disabled={isDisabled}
                                                            onCheckedChange={() => canToggle && handleCollectionToggle(collection.id, isInCollection)}
                                                            className={`pointer-events-none rounded-full w-5 h-5 border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-all ${
                                                                isDisabled ? '' : 'group-hover:border-muted-foreground/50'
                                                            }`}
                                                        />
                                                        <span className={`text-sm truncate flex-1 transition-colors ${
                                                            isInCollection
                                                                ? 'text-foreground font-medium'
                                                                : isDisabled
                                                                    ? 'text-muted-foreground'
                                                                    : 'text-muted-foreground group-hover:text-foreground'
                                                        }`}>
                                                            {collection.name}
                                                            {isViewOnly && <span className="text-xs ml-1">(view only)</span>}
                                                        </span>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </PopoverContent>
                                </Popover>
                            </div>

                            {/* Mbuff Score & Your Rating */}
                            <div className="mt-4 rounded-2xl border border-border bg-secondary/40 p-5 space-y-4">
                                {(summaryData?.summary.ratingsCount ?? 0) > 0 ? (
                                    <div className="space-y-2.5 flex flex-col items-center">
                                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-[0.2em]">
                                            mbuff score
                                        </span>
                                        <div className="flex items-baseline gap-1.5">
                                            <span className={cn(
                                                'text-4xl font-extrabold tabular-nums tracking-tighter leading-none transition-colors',
                                                summaryData?.summary.averageRating != null
                                                    ? getRatingTier(summaryData.summary.averageRating).color
                                                    : 'text-muted-foreground/20'
                                            )}>
                                                {summaryData?.summary.averageRating ?? '—'}
                                            </span>
                                            <span className="text-sm text-muted-foreground/50 font-semibold">/10</span>
                                        </div>
                                        {summaryData?.summary.averageRating != null && (() => {
                                            const tier = getRatingTier(summaryData.summary.averageRating);
                                            return (
                                                <div className="space-y-1.5 flex flex-col items-center">
                                                    <StarDisplay rating={summaryData.summary.averageRating} size="sm" />
                                                    <span className={cn(
                                                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border',
                                                        tier.color, tier.bgColor, tier.borderColor
                                                    )}>
                                                        {tier.label}
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                        <span className="text-xs text-muted-foreground">
                                            {summaryData?.summary.ratingsCount ?? 0}{' '}
                                            {(summaryData?.summary.ratingsCount ?? 0) === 1 ? 'rating' : 'ratings'}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="space-y-1.5 flex flex-col items-center">
                                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-[0.2em]">
                                            mbuff score
                                        </span>
                                        <p className="text-sm text-muted-foreground">No ratings yet</p>
                                    </div>
                                )}

                                {isLoggedIn && (
                                    <>
                                        <Separator className="opacity-40" />
                                        <div className="space-y-2 flex flex-col items-center">
                                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                                                Your Rating
                                            </span>
                                            <InteractiveStarRating
                                                value={summaryData?.userRating ?? null}
                                                onChange={(r) => rateMutation.mutate(r)}
                                                starSize="h-5 w-5"
                                                className="items-center"
                                                readoutClassName="items-center"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </aside>
                </div>
            </main>
        </>
    );
};

export default MovieDetail;
