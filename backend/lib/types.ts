// --- Backend User Type (matches Lucia attributes) ---
export interface DatabaseUserAttributes {
    id: string;
    username: string | null;
    email: string | null;
    avatar_url: string | null;
    role: string;
    created_at: Date;
    updated_at: Date;
    recommendations_enabled: boolean;
    recommendations_collection_id: string | null;
    show_reddit_label: boolean;
}

export interface AdminUserResponse {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    username: string | null;
    avatarUrl: string | null;
    firstName: string | null;
    lastName: string | null;
    role: string;
    createdAt: string;
    updatedAt: string;
    providers: string[];
    recommendationsEnabled: boolean;
    recommendationsCollectionId: string | null;
    categoryRecommendationsEnabled: boolean;
    showRedditLabel: boolean;
    collectionCount: number;
}

// --- User Preferences Types ---
export interface UserPreferences {
    recommendations_enabled: boolean;
    recommendations_collection_id: string | null;
    // New: support for multiple recommendation collections
    recommendations_collection_ids?: string[];
    // Category recommendations toggle
    category_recommendations_enabled: boolean;
    show_adult_items: boolean;
    show_reddit_label: boolean;
}

export interface UpdateUserPreferencesInput {
    recommendations_enabled?: boolean;
    recommendations_collection_id?: string | null;
    category_recommendations_enabled?: boolean;
    show_adult_items?: boolean;
    show_reddit_label?: boolean;
}

// --- Recommendation Types ---
export interface RecommendationCollection {
    id: string;
    name: string;
    description: string | null;
    added_at: string;
}

// --- Backend Collection Types (Subset needed for backend operations/responses) ---

// Basic Collection Info (used in lists/summaries)
export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  is_public?: boolean;
  owner_id: string;
  created_at: string; // ISO string from DB
  updated_at: string; // ISO string from DB
  owner_username?: string | null; // Optional: added via join
  owner_avatar?: string | null;   // Optional: added via join
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
  username?: string | null;  // Optional: added via join
  email?: string | null;     // Optional: added via join
  avatar_url?: string | null; // Optional: added via join
}

// Define CollectionRow type used internally in controller
export interface CollectionRow {
    id: string;
    name: string;
    description: string | null;
    is_public?: boolean;
    owner_id: string;
    created_at: string; 
    updated_at: string; 
}

// Define GoogleUser type used internally in controller
export interface GoogleUser {
    sub: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    email?: string;
    email_verified?: boolean;
    locale?: string;
}

// --- Reviews Types ---
export type MediaType = 'movie' | 'tv';

export interface ReviewSummaryResponse {
    media: {
        mediaType: MediaType;
        tmdbId: number;
    };
    summary: {
        averageRating: number | null;
        ratingsCount: number;
        commentsCount: number;
    };
    userRating: number | null;
}

export interface ReviewCommentAuthor {
    id: string;
    name: string | null;
    avatarUrl: string | null;
}

export interface ReviewComment {
    id: string;
    mediaType: MediaType;
    tmdbId: number;
    parentCommentId: string | null;
    replyToCommentId: string | null;
    replyToAuthorName: string | null;
    comment: string;
    createdAt: string;
    updatedAt: string;
    isEdited: boolean;
    likesCount: number;
    likedByViewer: boolean;
    repliesCount: number;
    replies: ReviewComment[];
    author: ReviewCommentAuthor;
    isOwner: boolean;
}

export interface CommentLikeResponse {
    commentId: string;
    likesCount: number;
    likedByViewer: boolean;
}

export interface PaginatedCommentsResponse {
    media: {
        mediaType: MediaType;
        tmdbId: number;
    };
    comments: ReviewComment[];
    pagination: {
        nextCursor: string | null;
        hasMore: boolean;
        limit: number;
    };
}
