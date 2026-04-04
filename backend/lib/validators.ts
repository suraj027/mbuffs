import { z } from 'zod';

// --- Existing Auth Schemas (if any - remove if only using OAuth) ---
/*
export const registerSchema = z.object({ ... });
export const loginSchema = z.object({ ... });
*/

// --- Collection Schemas ---

export const createCollectionSchema = z.object({
  name: z.string().min(1, "Collection name cannot be empty").max(255),
  description: z.string().max(1000).optional(),
  is_public: z.boolean().optional(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const updateCollectionSchema = z.object({
  name: z.string().min(1, "Collection name cannot be empty").max(255).optional(),
  description: z.string().max(1000).optional().nullable(), // Allow explicitly setting description to null
  is_public: z.boolean().optional(),
});

export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

export const addMovieSchema = z.object({
  movieId: z.string({ message: "Movie ID is required and must be a number or a string." }).or(z.number({ message: "Movie ID is required and must be a number or a string." })),
  // Optional: could include title/poster directly if desired
  // title: z.string().optional(),
  // posterPath: z.string().optional(),
});

export type AddMovieInput = z.infer<typeof addMovieSchema>;

export const addCollaboratorSchema = z.object({
  email: z.string().email("Invalid email address"),
  permission: z.enum(['view', 'edit']).default('edit'), // Default to edit for simplicity
});

export type AddCollaboratorInput = z.infer<typeof addCollaboratorSchema>;

export const updateCollaboratorSchema = z.object({
  permission: z.enum(['view', 'edit']),
});

export type UpdateCollaboratorInput = z.infer<typeof updateCollaboratorSchema>;

// --- Movie Schemas ---

export const searchMovieSchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
});
export type SearchMovieInput = z.infer<typeof searchMovieSchema>;

// --- Reviews Schemas ---

export const mediaIdentityParamsSchema = z.object({
  mediaType: z.enum(['movie', 'tv']),
  tmdbId: z.coerce.number().int().positive(),
});

export type MediaIdentityParamsInput = z.infer<typeof mediaIdentityParamsSchema>;

export const upsertRatingSchema = z.object({
  rating: z.number().int().min(1).max(10),
});

export type UpsertRatingInput = z.infer<typeof upsertRatingSchema>;

export const createCommentSchema = z.object({
  comment: z.string().trim().min(1).max(2000),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  comment: z.string().trim().min(1).max(2000),
});

export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

export const deleteCommentSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>;

export const commentsPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CommentsPaginationInput = z.infer<typeof commentsPaginationSchema>;
