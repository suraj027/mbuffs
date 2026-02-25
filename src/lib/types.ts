// --- TMDB Types ---
export interface Network {
  id: number;
  logo_path: string | null;
  name: string;
  origin_country: string;
}

export interface Movie {
  id: number;
  title: string;
  name?: string;
  poster_path: string | null;
  release_date: string;
  first_air_date?: string;
  vote_average: number;
  vote_count?: number;
  popularity?: number;
  overview: string;
  backdrop_path: string | null;
}

export interface Creator {
  id: number;
  name: string;
  profile_path: string | null;
}

export interface WatchProvider {
  display_priority: number;
  logo_path: string;
  provider_id: number;
  provider_name: string;
}

export interface WatchProvidersResult {
  link: string;
  flatrate?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
}

export interface WatchProvidersResponse {
  results: Record<string, WatchProvidersResult>;
}

export interface Season {
  air_date: string;
  episode_count: number;
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  season_number: number;
  vote_average: number;
}

export interface BelongsToCollection {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface TmdbCollectionDetails {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: Movie[];
}

export interface MovieDetails extends Movie {
  genres: { id: number; name: string }[];
  runtime: number;
  tagline: string;
  networks: Network[];
  created_by?: Creator[]; // For TV shows
  seasons?: Season[]; // For TV shows
  belongs_to_collection?: BelongsToCollection | null;
  'watch/providers'?: WatchProvidersResponse;
}

export interface Video {
  id: string;
  key: string;
  name: string;
  site: string;
  size: number;
  type: string;
  official: boolean;
  published_at: string;
}

export interface VideosResponse {
  id: number;
  results: Video[];
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

export interface CreditsResponse {
  id: number;
  cast: CastMember[];
  crew: CrewMember[];
}

export interface PersonCredit extends Movie {
  media_type: 'movie' | 'tv';
  job?: string;
  department?: string;
  character?: string;
}

export interface PersonCreditsResponse {
  cast: PersonCredit[];
  crew: PersonCredit[];
  id: number;
}

export interface PersonDetails {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  known_for_department: string;
  also_known_as: string[];
  gender: number;
  popularity: number;
  imdb_id: string | null;
  homepage: string | null;
}

export interface PersonExternalIds {
  id: number;
  imdb_id: string | null;
  facebook_id: string | null;
  instagram_id: string | null;
  twitter_id: string | null;
  tiktok_id: string | null;
  youtube_id: string | null;
  wikidata_id: string | null;
}

export interface SearchResults {
  page: number;
  results: Movie[];
  total_pages: number;
  total_results: number;
}

// --- Backend User Type (Better Auth compatible) ---
export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  // Legacy fields for backward compatibility
  username?: string | null;
  avatarUrl?: string | null;
  // Timestamps
  createdAt?: Date | string;
  updatedAt?: Date | string;
  // Custom fields
  recommendationsEnabled?: boolean;
  recommendationsCollectionId?: string | null;
}

// --- User Preferences Types ---
export interface UserPreferences {
  recommendations_enabled: boolean;
  recommendations_collection_id: string | null;
  // New: multiple recommendation collections
  recommendations_collection_ids?: string[];
  // Category recommendations toggle
  category_recommendations_enabled: boolean;
}

export interface UpdateUserPreferencesInput {
  recommendations_enabled?: boolean;
  recommendations_collection_id?: string | null;
  category_recommendations_enabled?: boolean;
}

// --- Recommendation Types ---
export interface RecommendationCollection {
  id: string;
  name: string;
  description: string | null;
  added_at: string;
}

export interface RecommendationsResponse {
  results: Movie[];
  sourceCollections: { id: string; name: string }[];
  totalSourceItems: number;
  page: number;
  total_pages: number;
  total_results: number;
}

export interface RecommendationCollectionsResponse {
  collections: RecommendationCollection[];
}

// Category Recommendations Types
export interface CategoryRecommendation {
  genre: Genre;
  results: Movie[];
  total_results: number;
}

export interface CategoryRecommendationsResponse {
  categories: CategoryRecommendation[];
  mediaType: 'movie' | 'tv';
  sourceCollections: { id: string; name: string }[];
  totalSourceItems: number;
}

export interface RecommendationCacheDebugEntry {
  cache_key: string;
  cache_version: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  payload_size: number;
}

export interface RecommendationCacheDebugResponse {
  cache: {
    total: number;
    fresh: number;
    expired: number;
    entries: RecommendationCacheDebugEntry[];
  };
  ttl_minutes: number;
  allowed_debug_email: string;
}

// --- Backend Collection Types ---

// Basic Collection Info (used in lists)
export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string; // ISO string from DB
  updated_at: string; // ISO string from DB
  owner_username?: string | null; // Optional from join
  owner_avatar?: string | null; // Optional from join
  preview_movie_ids?: (number | string)[]; // Up to 4 movie IDs for preview collage
  user_permission?: 'owner' | 'edit' | 'view'; // User's permission on this collection
}

// Movie entry within a collection (as returned by backend)
export interface CollectionMovieEntry {
  movie_id: number | string; // Can be string with 'tv' suffix for TV shows (e.g., "12345tv")
  added_at: string; // ISO string from DB
  added_by_user_id: string;
  added_by_username: string | null;
  is_movie: boolean; // true if movie, false if TV show
}

// Collaborator entry within a collection
export interface CollectionCollaborator {
  user_id: string;
  permission: 'view' | 'edit';
  username?: string | null; // Optional from join
  email?: string | null; // Optional from join
  avatar_url?: string | null; // Optional from join
}

// Full Collection Details (returned by GET /api/collections/:id)
export interface CollectionDetails {
  movies: CollectionMovieEntry[];
  collaborators: CollectionCollaborator[];
  collection: CollectionSummary;
}

// Type for the response of GET /api/collections
export interface UserCollectionsResponse {
  collections: CollectionSummary[];
}

// Input type for creating a collection
export interface CreateCollectionInput {
  name: string;
  description?: string | null;
}

// Input type for updating collection details
export interface UpdateCollectionInput {
  name?: string;
  description?: string | null;
}

// Input type for adding a movie to a collection
export interface AddMovieInput {
  movieId: number; // TMDB movie ID
}

// Response type after adding a movie
export interface AddMovieResponse {
  movieEntry: {
    id: string;
    movie_id: number;
    added_at: string;
  }
}

// Input type for adding a collaborator
export interface AddCollaboratorInput {
  email: string;
  permission: 'view' | 'edit';
}

// Input type for updating collaborator permissions
export interface UpdateCollaboratorInput {
  permission: 'view' | 'edit';
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  userId: string;
  createdAt: string; // Or Date if you parse it
  updatedAt: string; // Or Date if you parse it
  movies: Movie[];
}

// --- Genre Types ---
export interface Genre {
  id: number;
  name: string;
}

export interface GenreListResponse {
  genres: Genre[];
}

export interface Episode {
  air_date: string;
  episode_number: number;
  id: number;
  name: string;
  overview: string;
  production_code: string;
  runtime: number | null;
  season_number: number;
  show_id: number;
  still_path: string | null;
  vote_average: number;
  vote_count: number;
  crew: CrewMember[];
  guest_stars: CastMember[];
}

export interface SeasonDetails {
  _id: string;
  air_date: string;
  episodes: Episode[];
  name: string;
  overview: string;
  id: number;
  poster_path: string | null;
  season_number: number;
  vote_average: number;
}

// --- Parental Guidance & Certification Types ---
export type SeverityLevel = 'none' | 'mild' | 'moderate' | 'severe';

export interface ParentalGuidanceData {
  imdbId: string;
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  nudity: SeverityLevel | null;
  violence: SeverityLevel | null;
  profanity: SeverityLevel | null;
  alcohol: SeverityLevel | null;
  frightening: SeverityLevel | null;
  nudityDescription: string | null;
  violenceDescription: string | null;
  profanityDescription: string | null;
  alcoholDescription: string | null;
  frighteningDescription: string | null;
}

export interface CertificationData {
  certification: string | null;
  region: string;
}

export interface CombinedRatingsResponse {
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  certification: CertificationData | null;
  parentalGuidance: {
    nudity: SeverityLevel | null;
    violence: SeverityLevel | null;
    profanity: SeverityLevel | null;
    alcohol: SeverityLevel | null;
    frightening: SeverityLevel | null;
  } | null;
}
