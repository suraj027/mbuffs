import dayjs from 'dayjs';
import {
    Movie, MovieDetails, SearchResults, User,
    CollectionSummary, CollectionDetails, CollectionCollaborator, UserCollectionsResponse,
    CreateCollectionInput, UpdateCollectionInput, AddMovieInput, AddCollaboratorInput,
    UpdateCollaboratorInput, AddMovieResponse, VideosResponse, CreditsResponse,
    Genre, GenreListResponse, PersonCreditsResponse, SeasonDetails, TmdbCollectionDetails,
    UserPreferences, UpdateUserPreferencesInput,
    RecommendationsResponse, RecommendationCollectionsResponse, CategoryRecommendationsResponse,
    CombinedRatingsResponse,
    RecommendationCacheDebugResponse
} from './types';

const _dayjs = dayjs();

// --- Backend API Configuration ---
const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

const interleaveArrays = <T>(arr1: T[], arr2: T[]): T[] => {
    const maxLength = Math.max(arr1.length, arr2.length);
    const result: T[] = [];
    for (let i = 0; i < maxLength; i++) {
        // Add item from arr1 if it exists
        if (i < arr1.length) {
            result.push(arr1[i]);
        }
        // Add item from arr2 if it exists
        if (i < arr2.length) {
            result.push(arr2[i]);
        }
    }
    return result;
};

// Helper function for backend fetch requests
export const fetchBackend = async (endpoint: string, options: RequestInit = {}) => {
    const url = `${BACKEND_BASE_URL}/api${endpoint}`;

    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');

    const requestOptions: RequestInit = {
        credentials: 'include', // Required for Better Auth cookies
        headers: headers,
        ...options,
    };

    try {
        const response = await fetch(url, requestOptions);
        if (!response.ok) {
            let errorData = { message: `HTTP error ${response.status}` };
            try {
                const jsonError = await response.json();
                errorData = { ...errorData, ...jsonError };
            } catch (e) { /* Ignore JSON parsing error */ }

            console.error(`API Error (${response.status}) on ${endpoint}:`, errorData);

            // --- Removed automatic token clearing on 401 --- 
            // It's generally better to handle token expiry/invalidation 
            // within the useAuth hook based on the query status, or 
            // implement a proper token refresh strategy.
            // if (response.status === 401) {
            //     localStorage.removeItem(JWT_TOKEN_KEY);
            // }

            const error = new Error(errorData.message) as any; // eslint-disable-line
            error.status = response.status;
            error.data = errorData;
            throw error;
        }

        if (response.status === 204 || (response.headers.get('content-length') === '0' && options.method !== 'GET')) {
            return null;
        }
        return await response.json();
    } catch (error) {
        // Log network errors or other unexpected issues
        console.error(`Network or unexpected error on ${endpoint}:`, error);
        throw error; // Re-throw the error to be caught by the caller (e.g., React Query)
    }
};

// --- Auth API Functions ---
export const fetchCurrentUserApi = async (): Promise<{ user: User }> => {
    return fetchBackend('/auth/me');
};

export const logoutUserApi = async (): Promise<void> => {
    try {
        await fetchBackend('/auth/logout', { method: 'POST' });
    } catch (error) {
        console.warn("Optional backend logout call failed:", error);
    }
};

// --- User Preferences API Functions ---
export const fetchUserPreferencesApi = async (): Promise<{ preferences: UserPreferences }> => {
    return fetchBackend('/user/preferences');
};

export const updateUserPreferencesApi = async (data: UpdateUserPreferencesInput): Promise<{ preferences: UserPreferences }> => {
    return fetchBackend('/user/preferences', {
        method: 'PUT',
        body: JSON.stringify(data),
    });
};

// --- Recommendation API Functions ---

export const fetchRecommendationsApi = async (limit: number = 20, page: number = 1): Promise<RecommendationsResponse> => {
    return fetchBackend(`/recommendations?limit=${limit}&page=${page}`);
};

export const fetchRecommendationCollectionsApi = async (): Promise<RecommendationCollectionsResponse> => {
    return fetchBackend('/recommendations/collections');
};

export const addRecommendationCollectionApi = async (collectionId: string): Promise<void> => {
    await fetchBackend('/recommendations/collections', {
        method: 'POST',
        body: JSON.stringify({ collection_id: collectionId }),
    });
};

export const removeRecommendationCollectionApi = async (collectionId: string): Promise<void> => {
    await fetchBackend(`/recommendations/collections/${collectionId}`, {
        method: 'DELETE',
    });
};

export const setRecommendationCollectionsApi = async (collectionIds: string[]): Promise<RecommendationCollectionsResponse> => {
    return fetchBackend('/recommendations/collections', {
        method: 'PUT',
        body: JSON.stringify({ collection_ids: collectionIds }),
    });
};

export const fetchCategoryRecommendationsApi = async (
    mediaType: 'movie' | 'tv' = 'movie',
    limit: number = 10
): Promise<CategoryRecommendationsResponse> => {
    return fetchBackend(`/recommendations/categories?mediaType=${mediaType}&limit=${limit}`);
};

export const fetchGenreRecommendationsApi = async (
    genreId: number,
    mediaType: 'movie' | 'tv' = 'movie',
    limit: number = 20,
    page: number = 1
): Promise<RecommendationsResponse> => {
    return fetchBackend(`/recommendations/genre/${genreId}?mediaType=${mediaType}&limit=${limit}&page=${page}`);
};

export const fetchTheatricalRecommendationsApi = async (
    limit: number = 20,
    page: number = 1
): Promise<RecommendationsResponse> => {
    return fetchBackend(`/recommendations/theatrical?limit=${limit}&page=${page}`);
};

export const fetchRecommendationCacheDebugApi = async (): Promise<RecommendationCacheDebugResponse> => {
    return fetchBackend('/recommendations/debug/cache');
};

// --- Collection API Functions (No changes needed, use fetchBackend) ---
export const fetchUserCollectionsApi = async (): Promise<UserCollectionsResponse> => {
    return fetchBackend('/collections');
};

export const fetchCollectionDetailsApi = async (collectionId: string): Promise<CollectionDetails> => {
    return fetchBackend(`/collections/${collectionId}`);
};

export const createCollectionApi = async (data: CreateCollectionInput): Promise<{ collection: CollectionSummary }> => {
    return fetchBackend('/collections', {
        method: 'POST',
        body: JSON.stringify(data),
    });
};

export const updateCollectionApi = async (collectionId: string, data: UpdateCollectionInput): Promise<{ collection: CollectionSummary }> => {
    return fetchBackend(`/collections/${collectionId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
};

export const deleteCollectionApi = async (collectionId: string): Promise<void> => {
    await fetchBackend(`/collections/${collectionId}`, { method: 'DELETE' });
};

// --- Collection Movies API (No changes needed) ---
export const addMovieToCollectionApi = async (collectionId: string, data: AddMovieInput): Promise<AddMovieResponse> => {
    return fetchBackend(`/collections/${collectionId}/movies`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
};

export const removeMovieFromCollectionApi = async (collectionId: string, movieId: number | string): Promise<void> => {
    await fetchBackend(`/collections/${collectionId}/movies/${movieId}`, { method: 'DELETE' });
};

// --- Collection Collaborators API (No changes needed) ---
export const addCollaboratorApi = async (collectionId: string, data: AddCollaboratorInput): Promise<{ collaborator: CollectionCollaborator }> => {
    return fetchBackend(`/collections/${collectionId}/collaborators`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
};

export const updateCollaboratorApi = async (collectionId: string, userId: string, data: UpdateCollaboratorInput): Promise<{ collaborator: CollectionCollaborator }> => {
    return fetchBackend(`/collections/${collectionId}/collaborators/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
};

export const removeCollaboratorApi = async (collectionId: string, userId: string): Promise<void> => {
    await fetchBackend(`/collections/${collectionId}/collaborators/${userId}`, { method: 'DELETE' });
};

// --- Watched Status API ---
export interface WatchedStatusResponse {
    isWatched: boolean;
    watchedAt: string | null;
}

export interface SystemCollectionItem {
    movie_id: string;
    added_at: string;
}

export interface SystemCollectionItemsResponse {
    items: SystemCollectionItem[];
}

export interface WatchedStatusBatchResponse {
    watchedStatus: Record<string, { isWatched: boolean; watchedAt: string | null }>;
}

export const fetchWatchedItemsApi = async (): Promise<SystemCollectionItemsResponse> => {
    return fetchBackend('/collections/watched/items');
};

export const getWatchedStatusApi = async (mediaId: string): Promise<WatchedStatusResponse> => {
    return fetchBackend(`/collections/watched/${mediaId}`);
};

export const getWatchedStatusBatchApi = async (mediaIds: string[]): Promise<WatchedStatusBatchResponse> => {
    return fetchBackend('/collections/watched/batch', {
        method: 'POST',
        body: JSON.stringify({ mediaIds }),
    });
};

export const toggleWatchedStatusApi = async (mediaId: string): Promise<WatchedStatusResponse> => {
    return fetchBackend(`/collections/watched/${mediaId}/toggle`, {
        method: 'POST',
    });
};

// --- Not Interested Status API ---
export interface NotInterestedStatusResponse {
    isNotInterested: boolean;
    notInterestedAt: string | null;
}

export interface NotInterestedStatusBatchResponse {
    notInterestedStatus: Record<string, { isNotInterested: boolean; notInterestedAt: string | null }>;
}

export const fetchNotInterestedItemsApi = async (): Promise<SystemCollectionItemsResponse> => {
    return fetchBackend('/collections/not-interested/items');
};

export const getNotInterestedStatusApi = async (mediaId: string): Promise<NotInterestedStatusResponse> => {
    return fetchBackend(`/collections/not-interested/${mediaId}`);
};

export const getNotInterestedStatusBatchApi = async (mediaIds: string[]): Promise<NotInterestedStatusBatchResponse> => {
    return fetchBackend('/collections/not-interested/batch', {
        method: 'POST',
        body: JSON.stringify({ mediaIds }),
    });
};

export const toggleNotInterestedStatusApi = async (mediaId: string): Promise<NotInterestedStatusResponse> => {
    return fetchBackend(`/collections/not-interested/${mediaId}/toggle`, {
        method: 'POST',
    });
};

const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

export const getImageUrl = (path: string | null | undefined, size = 'w500') => {
    if (!path) return '/placeholder.svg';
    return `${IMAGE_BASE_URL}/${size}${path}`;
};



export const fetchUserRegion = async (): Promise<string> => {
    try {
        const response = await fetch('https://get.geojs.io/v1/ip/country.json');
        if (!response.ok) throw new Error('Geo fetch failed');
        const data = await response.json();
        return data.country || 'US';
    } catch (e) {
        console.warn('Failed to fetch user region, defaulting to US', e);
        return 'US';
    }
};

const MOVIE_GENRES = '9648|27|53|12|28|878'; // Mystery, Horror, Thriller, Action, Comedy (Feel Good), Family (Feel Good)
const TV_GENRES = '9648|10759|10765|80|37|10764'; // Mystery, Action & Adventure, Comedy, Family, Sci-Fi & Fantasy

export const fetchRecentContentApi = async (page = 1, region = 'US', timezone: string): Promise<SearchResults> => {
    try {
        // Date range: 6 months in the past to now
        const maxDate = dayjs().format('YYYY-MM-DD');
        const minDate = dayjs().subtract(12, 'month').format('YYYY-MM-DD');

        // Fetch Recent Movies
        const movieData = await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/discover/movie`,
                params: {
                    page: String(page),
                    region: region,
                    with_release_type: '2|3', // Theatrical releases
                    with_genres: MOVIE_GENRES,
                    // sort_by: 'vote_average.desc',
                    sort_by: 'revenue.desc', // Sort by revenue to surface more popular recent releases
                    'vote_count.gte': '2000',
                    'primary_release_date.gte': minDate,
                    'primary_release_date.lte': maxDate,
                    watch_region: region,
                    include_adult: true,
                    with_watch_providers: '8|119|350|2336|11' // Major streaming providers
                }
            }),
        });

        // Fetch Recent TV Shows
        const tvData = await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/discover/tv`,
                params: {
                    page: String(page),
                    timezone,
                    with_genres: TV_GENRES,
                    // sort_by: 'vote_average.desc',
                    sort_by: 'revenue.desc', // Sort by revenue to surface more popular recent releases
                    'vote_count.gte': '2000',
                    'air_date.gte': minDate,
                    'air_date.lte': maxDate,
                    watch_region: region,
                    include_adult: true,
                    with_watch_providers: '8|119|350|2336|11' // Major streaming providers
                }
            }),
        });

        const movieResults = movieData?.results || [];
        const tvResults = tvData?.results || [];

        // Interleave results
        const combinedResults = interleaveArrays(movieResults, tvResults) as Movie[];

        return {
            page: movieData?.page || 1,
            results: combinedResults,
            total_pages: Math.max(movieData?.total_pages || 0, tvData?.total_pages || 0),
            total_results: (movieData?.total_results || 0) + (tvData?.total_results || 0)
        };
    } catch (error) {
        console.error("Failed to fetch upcoming content:", error);
        return { page: 0, results: [], total_pages: 0, total_results: 0 };
    }
};

export const fetchTrendingContentApi = async (page = 1): Promise<SearchResults> => {
    try {
        // Fetch Trending Movies
        const movieData = await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/trending/movie/week`,
                params: {
                    page: String(page),
                }
            }),
        });

        // Fetch Trending TV Shows
        const tvData = await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/trending/tv/week`,
                params: {
                    page: String(page),
                }
            }),
        });

        const movieResults = movieData?.results || [];
        const tvResults = tvData?.results || [];

        // Interleave results
        const combinedResults = interleaveArrays(movieResults, tvResults) as Movie[];

        return {
            page: movieData?.page || 1,
            results: combinedResults,
            total_pages: Math.max(movieData?.total_pages || 0, tvData?.total_pages || 0),
            total_results: (movieData?.total_results || 0) + (tvData?.total_results || 0)
        };
    } catch (error) {
        console.error("Failed to fetch trending content:", error);
        return { page: 0, results: [], total_pages: 0, total_results: 0 };
    }
};

export const fetchNowPlayingMoviesApi = async (page = 1, region?: string): Promise<SearchResults> => {
    try {
        const params: Record<string, string> = { page: String(page) };
        if (region) {
            params.region = region;
        }

        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/movie/now_playing`,
                params
            }),
        });
    } catch (error) {
        console.error("Failed to fetch now playing movies:", error);
        return { page: 0, results: [], total_pages: 0, total_results: 0 };
    }
};

export const fetchOnTheAirTvShowsApi = async (page = 1, timezone?: string): Promise<SearchResults> => {
    try {
        const params: Record<string, string> = { page: String(page) };
        if (timezone) {
            params.timezone = timezone;
        }

        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/tv/on_the_air`,
                params
            }),
        });
    } catch (error) {
        console.error("Failed to fetch on the air TV shows:", error);
        return { page: 0, results: [], total_pages: 0, total_results: 0 };
    }
};

export const fetchNewOnPlatformApi = async (providerId: number, region = 'US', page = 1): Promise<SearchResults> => {
    try {
        const sortBy = 'primary_release_date.desc';
        // Ensure we don't show future releases
        const maxDate = dayjs().format('YYYY-MM-DD');

        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/discover/movie`,
                params: {
                    with_watch_providers: String(providerId),
                    watch_region: region,
                    sort_by: sortBy,
                    'primary_release_date.lte': maxDate,
                    'vote_count.gte': '0', // Allow new movies with few votes
                    page: String(page)
                }
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch new on platform ${providerId}:`, error);
        return { page: 0, results: [], total_pages: 0, total_results: 0 };
    }
};

export const fetchPopularMoviesApi = async (pageToFetch: number = 1): Promise<SearchResults> => {
    const defaultResult: SearchResults = { page: 0, results: [], total_pages: 0, total_results: 0 };
    // Get the current date in the format YYYY-MM-DD
    const maxDate = _dayjs.format('YYYY-MM-DD');

    // Get the date one year in the past in the format YYYY-MM-DD
    const minDate = _dayjs.subtract(1, 'year').format('YYYY-MM-DD');

    const page = pageToFetch; // Default page number
    const sortBy = 'popularity.desc'; // Default sort order
    const includeVideo = false; // Default value for include_video
    const movieWatchProviders = '8|9|337|350|2|15'; // Default watch providers
    const tvWatchProviders = '8|9|337|350|2|15|2336'; // Default watch providers for TV shows
    const movieGenres = '28|12|16|80|53|878|9648|27'; // Default genres for movies
    const tvGenres = '10759|16|80|9648|10765'; // Default genres for TV shows
    const watchRegion = 'US'; // Default watch region
    const includeAdult = true; // Default value for include_adult

    try {
        const movieData = await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/discover/movie?include_adult=${includeAdult}&include_video=${includeVideo}&page=${page}&sort_by=${sortBy}&with_watch_providers=${movieWatchProviders}&with_genres=${movieGenres}&primary_release_date.gte=${minDate}&primary_release_date.lte=${maxDate}&watch_region=${watchRegion}`,
            }),
        });

        const tvData = await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/discover/tv?include_adult=${includeAdult}&include_video=${includeVideo}&page=${page}&sort_by=${sortBy}&with_watch_providers=${tvWatchProviders}&with_genres=${tvGenres}&first_air_date.gte=${minDate}&first_air_date.lte=${maxDate}&watch_region=${watchRegion}`,
            }),
        });

        // Get the results arrays, defaulting to empty arrays
        const movieResults = movieData?.results || [];
        const tvResults = tvData?.results || [];

        // Interleave the results for better relevance mixing
        const combinedResults = interleaveArrays(movieResults, tvResults) as Movie[];

        // If both searches failed or returned no results, return default
        if (combinedResults.length === 0 && !movieData && !tvData) {
            return defaultResult;
        }

        // Use movie data for primary pagination, sum total results
        const finalPage = movieData?.page ?? tvData?.page ?? 0;
        const finalTotalPages = Math.max(movieData?.total_pages ?? 0, tvData?.total_pages ?? 0); // Or use movieData's? Depends on desired UX
        const finalTotalResults = (movieData?.total_results ?? 0) + (tvData?.total_results ?? 0);

        return {
            page: finalPage,
            results: combinedResults,
            total_pages: finalTotalPages,
            total_results: finalTotalResults,
        };
    } catch (error) { console.error("Failed to fetch popular movies:", error); return defaultResult; }
};

export const fetchMovieDetailsApi = async (id: number): Promise<MovieDetails | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/movie/${id}`,
                params: {
                    append_to_response: 'watch/providers'
                }
            }),
        });
    }
    catch (error) {
        console.error(`Failed to fetch details for movie ${id}:`, error);
        return null;
    }
};

export const fetchTvDetailsApi = async (id: number): Promise<MovieDetails | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/tv/${id}`,
                params: {
                    append_to_response: 'watch/providers'
                }
            }),
        });
    }
    catch (error) {
        console.error(`Failed to fetch details for TV show ${id}:`, error);
        return null;
    }
};

export const fetchTvSeasonDetailsApi = async (tvId: number, seasonNumber: number): Promise<SeasonDetails | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/tv/${tvId}/season/${seasonNumber}`,
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch season details for TV ${tvId} S${seasonNumber}:`, error);
        return null;
    }
};

export const fetchTmdbCollectionDetailsApi = async (collectionId: number): Promise<TmdbCollectionDetails | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/collection/${collectionId}`,
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch TMDB collection details ${collectionId}:`, error);
        return null;
    }
};

export const fetchVideosApi = async (mediaType: 'movie' | 'tv', id: number): Promise<VideosResponse | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/${mediaType}/${id}/videos`,
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch videos for ${mediaType} ${id}:`, error);
        return null;
    }
};

export const fetchCreditsApi = async (mediaType: 'movie' | 'tv', id: number): Promise<CreditsResponse | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/${mediaType}/${id}/credits`,
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch credits for ${mediaType} ${id}:`, error);
        return null;
    }
};

export const fetchPersonCreditsApi = async (personId: number): Promise<PersonCreditsResponse | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/person/${personId}/combined_credits`,
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch credits for person ${personId}:`, error);
        return null;
    }
};

export const fetchPersonDetailsApi = async (personId: number): Promise<import('./types').PersonDetails | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/person/${personId}`,
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch details for person ${personId}:`, error);
        return null;
    }
};

export const fetchPersonExternalIdsApi = async (personId: number): Promise<import('./types').PersonExternalIds | null> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/person/${personId}/external_ids`,
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch external IDs for person ${personId}:`, error);
        return null;
    }
};

export const searchMoviesApi = async (query: string, page = 1): Promise<SearchResults> => {
    const defaultResult: SearchResults = { page: 0, results: [], total_pages: 0, total_results: 0 };
    if (!query) return defaultResult;
    try {
        const movieData = await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/search/movie`,
                params: {
                    query,
                    page: String(page)
                },
            }),
        });

        const tvData = await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/search/tv`,
                params: {
                    query,
                    page: String(page)
                },
            }),
        });

        // Get the results arrays, defaulting to empty arrays
        const movieResults = movieData?.results || [];
        const tvResults = tvData?.results || [];

        // Interleave the results for better relevance mixing
        const combinedResults = interleaveArrays(movieResults, tvResults) as Movie[];

        // If both searches failed or returned no results, return default
        if (combinedResults.length === 0 && !movieData && !tvData) {
            return defaultResult;
        }

        // Use movie data for primary pagination, sum total results
        const finalPage = movieData?.page ?? tvData?.page ?? 0;
        const finalTotalPages = Math.max(movieData?.total_pages ?? 0, tvData?.total_pages ?? 0); // Or use movieData's? Depends on desired UX
        const finalTotalResults = (movieData?.total_results ?? 0) + (tvData?.total_results ?? 0);

        return {
            page: finalPage,
            results: combinedResults,
            total_pages: finalTotalPages,
            total_results: finalTotalResults,
        };
    } catch (error) {
        console.error(`Failed to search movies for query "${query}":`, error);
        return defaultResult;
    }
};

// --- Genre API Functions ---

export const fetchGenreListApi = async (mediaType: 'movie' | 'tv'): Promise<GenreListResponse> => {
    try {
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/genre/${mediaType}/list`,
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch ${mediaType} genres:`, error);
        return { genres: [] };
    }
};

export const fetchMoviesByGenreApi = async (genreId: number, page = 1): Promise<SearchResults> => {
    const defaultResult: SearchResults = { page: 0, results: [], total_pages: 0, total_results: 0 };
    try {
        const today = dayjs().format('YYYY-MM-DD');
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/discover/movie`,
                params: {
                    with_genres: String(genreId),
                    sort_by: 'primary_release_date.desc',
                    'primary_release_date.lte': today,
                    'vote_count.gte': '100',
                    'vote_average.gte': '5.5',
                    page: String(page),
                    include_adult: 'true',
                },
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch movies for genre ${genreId}:`, error);
        return defaultResult;
    }
};

export const fetchTvByGenreApi = async (genreId: number, page = 1): Promise<SearchResults> => {
    const defaultResult: SearchResults = { page: 0, results: [], total_pages: 0, total_results: 0 };
    try {
        const today = dayjs().format('YYYY-MM-DD');
        return await fetchBackend(`/content`, {
            method: 'POST',
            body: JSON.stringify({
                endpoint: `/discover/tv`,
                params: {
                    with_genres: String(genreId),
                    sort_by: 'first_air_date.desc',
                    'first_air_date.lte': today,
                    'vote_count.gte': '100',
                    'vote_average.gte': '5.5',
                    page: String(page),
                    include_adult: 'true',
                },
            }),
        });
    } catch (error) {
        console.error(`Failed to fetch TV shows for genre ${genreId}:`, error);
        return defaultResult;
    }
};

// --- Ratings & Parental Guidance API Functions ---

export const fetchCombinedRatingsApi = async (
    mediaType: 'movie' | 'tv',
    tmdbId: number | string,
    region = 'US'
): Promise<CombinedRatingsResponse | null> => {
    try {
        return await fetchBackend(`/ratings/${mediaType}/${tmdbId}?region=${region}`);
    } catch (error) {
        console.error(`Failed to fetch ratings for ${mediaType} ${tmdbId}:`, error);
        return null;
    }
};

// --- Reddit Recommendations API Functions ---

export interface RedditRecommendation {
    id: string;
    title: string;
    tmdbId: string | null;
    mediaType: 'movie' | 'tv';
    subreddit: string;
    postId: string;
    postTitle: string;
    mentionCount: number;
    totalScore: number;
    sentiment: 'positive' | 'neutral' | 'negative' | null;
    genres: string[];
    scrapedAt: string;
    updatedAt: string;
}

export interface RedditRecommendationsResponse {
    success: boolean;
    count: number;
    recommendations: RedditRecommendation[];
}

export interface RedditGenresResponse {
    success: boolean;
    genres: { genre: string; count: number }[];
}

export interface RedditStatusResponse {
    success: boolean;
    status: {
        lastScrapedAt: string | null;
        totalRecommendations: number;
        needsScrape: boolean;
    };
}

export interface RedditScrapeResult {
    success: boolean;
    result?: {
        totalPostsScraped: number;
        totalMentionsFound: number;
        recommendationsMatched: number;
        recommendationsSaved: number;
    };
    message?: string;
    lastScrapedAt?: string;
    totalRecommendations?: number;
}

/**
 * Fetch Reddit-sourced movie recommendations
 */
export const fetchRedditRecommendationsApi = async (options: {
    genre?: string;
    minMentions?: number;
    sentiment?: 'positive' | 'neutral' | 'negative';
    limit?: number;
} = {}): Promise<RedditRecommendationsResponse> => {
    const params = new URLSearchParams();
    if (options.genre) params.append('genre', options.genre);
    if (options.minMentions) params.append('minMentions', options.minMentions.toString());
    if (options.sentiment) params.append('sentiment', options.sentiment);
    if (options.limit) params.append('limit', options.limit.toString());
    
    const queryString = params.toString();
    return fetchBackend(`/reddit/recommendations${queryString ? `?${queryString}` : ''}`);
};

/**
 * Fetch Reddit recommendations filtered by genre
 */
export const fetchRedditRecommendationsByGenreApi = async (
    genre: string,
    limit: number = 20
): Promise<RedditRecommendationsResponse & { genre: string }> => {
    return fetchBackend(`/reddit/recommendations/genre/${encodeURIComponent(genre)}?limit=${limit}`);
};

/**
 * Fetch available genres from Reddit recommendations
 */
export const fetchRedditGenresApi = async (): Promise<RedditGenresResponse> => {
    return fetchBackend('/reddit/genres');
};

/**
 * Fetch Reddit scraping status
 */
export const fetchRedditStatusApi = async (): Promise<RedditStatusResponse> => {
    return fetchBackend('/reddit/status');
};

/**
 * Trigger a Reddit scrape (requires authentication)
 */
export const triggerRedditScrapeApi = async (options: {
    subreddits?: string[];
    timeframe?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
    postsPerSubreddit?: number;
    genres?: string[];
    force?: boolean;
} = {}): Promise<RedditScrapeResult> => {
    return fetchBackend('/reddit/scrape', {
        method: 'POST',
        body: JSON.stringify(options),
    });
};
