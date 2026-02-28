import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMovieDetailsApi, fetchTvDetailsApi, fetchVideosApi, fetchCreditsApi, fetchPersonCreditsApi, fetchUserCollectionsApi, fetchCollectionDetailsApi, addMovieToCollectionApi, removeMovieFromCollectionApi, getImageUrl, fetchUserRegion, fetchTmdbCollectionDetailsApi, fetchCombinedRatingsApi, getWatchedStatusApi, toggleWatchedStatusApi, getNotInterestedStatusApi, toggleNotInterestedStatusApi, fetchUserPreferencesApi } from '@/lib/api';
import { MovieDetails, Network, Video, CastMember, CrewMember, CollectionSummary, WatchProvider, PersonCreditsResponse, PersonCredit, VideosResponse, CreditsResponse, TmdbCollectionDetails, CombinedRatingsResponse, UserPreferences } from '@/lib/types';
import { Navbar } from "@/components/Navbar";
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CertificationBadge } from '@/components/CertificationBadge';
import { ParentalGuidance } from '@/components/ParentalGuidance';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ImageOff, Star, Play, User, Bookmark, MoreHorizontal, Loader2, Plus, Clock, Calendar, Globe, Share2, X, MessageSquare, ChevronRight, Eye, EyeOff, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

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

function ProviderList({ title, providers }: { title: string, providers: WatchProvider[] | undefined }) {
    if (!providers || providers.length === 0) return null;
    return (
        <div className="flex flex-col gap-2 items-center md:items-start">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
            <div className="flex flex-wrap justify-center md:justify-start gap-3">
                {providers.map(p => (
                    <div key={p.provider_id} className="relative group" title={p.provider_name}>
                        <img
                            src={`${TMDB_LOGO_BASE}${p.logo_path}`}
                            alt={p.provider_name}
                            className="w-10 h-10 rounded-md shadow-md border border-border/60 transition-transform group-hover:scale-105"
                        />
                    </div>
                ))}
            </div>
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
    const queryClient = useQueryClient();

    const isMovie = mediaType === 'movie';
    const queryKey = [mediaType, 'details', mediaId];

    const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
        queryKey: ['user', 'preferences'],
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

    // Add movie to collection mutation with optimistic updates
    const addToCollectionMutation = useMutation({
        mutationFn: ({ collectionId }: { collectionId: string }) =>
            addMovieToCollectionApi(collectionId, { movieId: collectionMediaId as unknown as number }), // API expects number but handles string with 'tv' suffix
        onMutate: async ({ collectionId }) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: movieStatusQueryKey });
            
            // Snapshot previous value
            const previousStatus = queryClient.getQueryData<MovieStatusMap>(movieStatusQueryKey);
            
            // Optimistically update - current user is adding, so they own it
            queryClient.setQueryData(movieStatusQueryKey, (old: MovieStatusMap | undefined) => ({
                ...old,
                [collectionId]: { hasMedia: true, addedByUserId: currentUser?.id ?? null },
            }));
            
            return { previousStatus };
        },
        onSuccess: (_, { collectionId }) => {
            queryClient.invalidateQueries({ queryKey: ['collection', collectionId] });
        },
        onError: (error: Error & { data?: { message?: string } }, _, context) => {
            // Rollback on error
            if (context?.previousStatus) {
                queryClient.setQueryData(movieStatusQueryKey, context.previousStatus);
            }
            if (error?.data?.message?.includes('already exists')) {
                toast.error('Already in this collection');
            } else {
                toast.error(`Failed to add to collection`);
            }
        },
    });

    // Remove movie from collection mutation with optimistic updates
    const removeFromCollectionMutation = useMutation({
        mutationFn: ({ collectionId }: { collectionId: string }) =>
            removeMovieFromCollectionApi(collectionId, collectionMediaId!),
        onMutate: async ({ collectionId }) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: movieStatusQueryKey });
            
            // Snapshot previous value
            const previousStatus = queryClient.getQueryData<MovieStatusMap>(movieStatusQueryKey);
            
            // Optimistically update
            queryClient.setQueryData(movieStatusQueryKey, (old: MovieStatusMap | undefined) => ({
                ...old,
                [collectionId]: { hasMedia: false, addedByUserId: null },
            }));
            
            return { previousStatus };
        },
        onSuccess: (_, { collectionId }) => {
            queryClient.invalidateQueries({ queryKey: ['collection', collectionId] });
        },
        onError: (error: Error, _, context) => {
            // Rollback on error
            if (context?.previousStatus) {
                queryClient.setQueryData(movieStatusQueryKey, context.previousStatus);
            }
            toast.error(`Failed to remove from collection`);
        },
    });

    const handleCollectionToggle = (collectionId: string, isCurrentlyInCollection: boolean) => {
        if (isCurrentlyInCollection) {
            removeFromCollectionMutation.mutate({ collectionId });
        } else {
            addToCollectionMutation.mutate({ collectionId });
        }
    };

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
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: watchedQueryKey });
            await queryClient.cancelQueries({ queryKey: ['watchedBatch'] });
            
            // Snapshot previous value
            const previousData = queryClient.getQueryData<{ isWatched: boolean; watchedAt: string | null }>(watchedQueryKey);
            
            // Optimistically update
            queryClient.setQueryData(watchedQueryKey, {
                isWatched: !isWatched,
                watchedAt: isWatched ? null : new Date().toISOString(),
            });
            
            return { previousData };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['watched'] });
            queryClient.invalidateQueries({ queryKey: ['watchedBatch'] });
            queryClient.invalidateQueries({ queryKey: ['collections', 'watched', 'items'] });
        },
        onError: (_error: Error, _, context) => {
            // Rollback on error
            if (context?.previousData) {
                queryClient.setQueryData(watchedQueryKey, context.previousData);
            }
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
            await queryClient.cancelQueries({ queryKey: notInterestedQueryKey });
            await queryClient.cancelQueries({ queryKey: ['notInterestedBatch'] });

            const previousData = queryClient.getQueryData<{ isNotInterested: boolean; notInterestedAt: string | null }>(notInterestedQueryKey);

            queryClient.setQueryData(notInterestedQueryKey, {
                isNotInterested: !isNotInterested,
                notInterestedAt: isNotInterested ? null : new Date().toISOString(),
            });

            return { previousData };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['notInterested'] });
            queryClient.invalidateQueries({ queryKey: ['notInterestedBatch'] });
            queryClient.invalidateQueries({ queryKey: ['collections', 'not-interested', 'items'] });
        },
        onError: (_error: Error, _, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(notInterestedQueryKey, context.previousData);
            }
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
                    <div className="grow space-y-4 text-center md:text-left pt-2 md:pt-8">
                        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">{title}</h1>

                        {tagline && (
                            <p className="text-base md:text-lg text-muted-foreground italic">"{tagline}"</p>
                        )}

                        {/* Meta row */}
                        <div className="flex flex-wrap justify-center md:justify-start items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
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
                            {rating && rating !== '0.0' && (
                                <>
                                    <span className="text-muted-foreground/40">|</span>
                                    <span className="flex items-center gap-1.5">
                                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                                        <span className="font-medium text-foreground/80">{rating}</span>
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
                                    <div className="flex flex-wrap justify-center md:justify-start gap-2">
                                        {genres.map(genre => (
                                            <Badge key={genre.id} variant="outline" className="border-border text-foreground/70 px-2 py-0 h-5 text-xs font-normal">
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

                        {/* Watch Providers */}
                        {watchProviders && (
                            <div className="pt-4 space-y-4">
                                {watchProviders.flatrate && watchProviders.flatrate.length > 0 ? (
                                    <ProviderList title="Stream" providers={watchProviders.flatrate} />
                                ) : (
                                    <div className="flex flex-wrap justify-center md:justify-start gap-x-8 gap-y-4">
                                        <ProviderList title="Rent" providers={watchProviders.rent} />
                                        <ProviderList title="Buy" providers={watchProviders.buy} />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Add to Collection and Watched Buttons - Mobile Only */}
                        <div className="pt-4 flex flex-wrap justify-center gap-3 md:hidden">
                            <Popover open={collectionsOpen} onOpenChange={setCollectionsOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="w-40 justify-center border-border bg-secondary/40 hover:bg-secondary/70 text-foreground/90 gap-2"
                                    >
                                        <Bookmark className={`h-4 w-4 ${isInAnyCollection ? 'fill-current' : ''}`} />
                                        <span>Save</span>
                                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                                    </Button>
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
                                                
                                                // Owner can always add/remove
                                                // Edit permission can add, but can only remove if they added the item
                                                // View permission cannot add or remove
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
                            
                            {/* Watched Button - Mobile */}
                            {isLoggedIn && (
                                <>
                                    <Button
                                        variant="outline"
                                        className={`w-40 justify-center border-border bg-secondary/40 hover:bg-secondary/70 text-foreground/90 gap-2 ${isWatched ? activeActionClass : ''}`}
                                        onClick={() => toggleWatchedMutation.mutate()}
                                        disabled={isLoadingWatched}
                                    >
                                        {isWatched ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                        <span>{isWatched ? 'Unwatch' : 'Watched'}</span>
                                    </Button>
                                    {showNotInterested && (
                                        <Button
                                            variant="outline"
                                            className={`w-40 justify-center border-border bg-secondary/40 hover:bg-secondary/70 text-foreground/90 gap-2 ${isNotInterested ? activeActionClass : ''}`}
                                            onClick={() => toggleNotInterestedMutation.mutate()}
                                            disabled={isLoadingNotInterested}
                                        >
                                            {isNotInterested ? (
                                                <ThumbsUp className="h-4 w-4" />
                                            ) : (
                                                <ThumbsDown className="h-4 w-4" />
                                            )}
                                            <span>{isNotInterested ? 'Interested?' : 'Not interested?'}</span>
                                        </Button>
                                    )}
                                </>
                            )}
                        </div>

                    </div>
                </div>

                <div className="mt-10 md:mt-14 space-y-10 md:space-y-14">

                    {/* Overview Section with Save Button on Desktop */}
                    {overview && (
                        <section className="space-y-4">
                            <div className="flex flex-col md:flex-row md:items-stretch md:gap-8">
                                {/* Overview Content - 70% on desktop */}
                                <div className="w-full md:w-[80%] space-y-4">
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
                                </div>

                                {/* Separator and Save/Watched Buttons - Desktop Only - 30% */}
                                <div className="hidden md:flex md:w-[20%] md:items-start md:gap-6">
                                    <Separator orientation="vertical" className="h-full bg-border" />
                                    <div className="flex w-full flex-col gap-3 pt-1">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    className="h-10 w-full justify-start border-border bg-secondary/40 hover:bg-secondary/70 text-foreground/90 gap-2"
                                                >
                                                    <Bookmark className={`h-4 w-4 ${isInAnyCollection ? 'fill-current' : ''}`} />
                                                    <span>Save</span>
                                                    <MoreHorizontal className="h-4 w-4 ml-auto text-muted-foreground" />
                                                </Button>
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
                                                            
                                                            // Owner can always add/remove
                                                            // Edit permission can add, but can only remove if they added the item
                                                            // View permission cannot add or remove
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
                                        
                                        {/* Watched Button - Desktop */}
                                        {isLoggedIn && (
                                            <>
                                                <Button
                                                    variant="outline"
                                                    className={`h-10 w-full justify-start border-border bg-secondary/40 hover:bg-secondary/70 text-foreground/90 gap-2 ${isWatched ? activeActionClass : ''}`}
                                                    onClick={() => toggleWatchedMutation.mutate()}
                                                    disabled={isLoadingWatched}
                                                >
                                                    {isWatched ? (
                                                        <EyeOff className="h-4 w-4" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
                                                    <span>{isWatched ? 'Unwatch' : 'Watched'}</span>
                                                </Button>
                                                {showNotInterested && (
                                                    <Button
                                                        variant="outline"
                                                        className={`h-10 w-full justify-start border-border bg-secondary/40 hover:bg-secondary/70 text-foreground/90 gap-2 ${isNotInterested ? activeActionClass : ''}`}
                                                        onClick={() => toggleNotInterestedMutation.mutate()}
                                                        disabled={isLoadingNotInterested}
                                                    >
                                                        {isNotInterested ? (
                                                            <ThumbsUp className="h-4 w-4" />
                                                        ) : (
                                                            <ThumbsDown className="h-4 w-4" />
                                                        )}
                                                        <span>{isNotInterested ? 'Interested?' : 'Not interested?'}</span>
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
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
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${video.key}/sddefault.jpg`;
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

                            const topWorks = uniqueWorks.slice(0, 10);

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
                                                    {work.vote_average > 0 && (
                                                        <span className="flex items-center text-xs text-yellow-500/80">
                                                            <Star className="w-3 h-3 mr-0.5 fill-current" />
                                                            {work.vote_average.toFixed(1)}
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
                </div>
            </main>
        </>
    );
};

export default MovieDetail;
