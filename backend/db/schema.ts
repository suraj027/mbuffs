import { pgTable, index, foreignKey, unique, text, varchar, timestamp, boolean, primaryKey, pgSequence } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const migrationsIdSeq = pgSequence("_migrations_id_seq", { startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })

// ============================================================================
// USER TABLE (Better Auth compatible)
// Note: Foreign key to collections.id for recommendations_collection_id exists in DB
// but is omitted here to avoid circular reference issues. See relations.ts for the relationship.
// ============================================================================
export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(), // Better Auth required field
	email: text().notNull(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text(), // Better Auth field (profile picture)
	// Legacy fields - keep for backward compatibility
	username: text(),
	avatarUrl: text("avatar_url"),
	hashedPassword: text("hashed_password"),
	// Timestamps
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	// Custom fields
	recommendationsEnabled: boolean("recommendations_enabled").default(false),
	recommendationsCollectionId: text("recommendations_collection_id"),
	categoryRecommendationsEnabled: boolean("category_recommendations_enabled").default(true),
}, (table) => [
	index("idx_user_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	unique("user_username_key").on(table.username),
	unique("user_email_key").on(table.email),
]);

// ============================================================================
// SESSION TABLE (Better Auth compatible)
// ============================================================================
export const session = pgTable("session", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	token: text().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
		columns: [table.userId],
		foreignColumns: [user.id],
		name: "session_user_id_fkey"
	}).onDelete("cascade"),
	unique("session_token_unique").on(table.token),
]);

// ============================================================================
// ACCOUNT TABLE (Better Auth - replaces oauth_account)
// ============================================================================
export const account = pgTable("account", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: 'string' }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: 'string' }),
	scope: text(),
	idToken: text("id_token"),
	password: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
		columns: [table.userId],
		foreignColumns: [user.id],
		name: "account_user_id_fkey"
	}).onDelete("cascade"),
	index("idx_account_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
]);

// ============================================================================
// VERIFICATION TABLE (Better Auth - for email verification, password reset, etc.)
// ============================================================================
export const verification = pgTable("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_verification_identifier").using("btree", table.identifier.asc().nullsLast().op("text_ops")),
]);

// ============================================================================
// LEGACY: OAUTH ACCOUNT TABLE (kept for migration purposes)
// ============================================================================
export const oauthAccount = pgTable("oauth_account", {
	providerId: text("provider_id").notNull(),
	providerUserId: text("provider_user_id").notNull(),
	userId: text("user_id").notNull(),
}, (table) => [
	foreignKey({
		columns: [table.userId],
		foreignColumns: [user.id],
		name: "oauth_account_user_id_fkey"
	}).onDelete("cascade"),
	primaryKey({ columns: [table.providerId, table.providerUserId], name: "oauth_account_pkey" }),
]);

// ============================================================================
// COLLECTIONS TABLE
// ============================================================================
export const collections = pgTable("collections", {
	id: text().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	isPublic: boolean("is_public").default(false).notNull(),
	ownerId: text("owner_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	shareableId: text("shareable_id"),
	isSystem: boolean("is_system").default(false).notNull(),
}, (table) => [
	index("collections_owner_id_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops")),
	index("idx_collections_owner_id").using("btree", table.ownerId.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.ownerId],
		foreignColumns: [user.id],
		name: "collections_owner_id_fkey"
	}).onDelete("cascade"),
	unique("collections_shareable_id_key").on(table.shareableId),
]);

// ============================================================================
// COLLECTION COLLABORATORS TABLE
// ============================================================================
export const collectionCollaborators = pgTable("collection_collaborators", {
	id: text().primaryKey().notNull(),
	collectionId: text("collection_id").notNull(),
	userId: text("user_id").notNull(),
	permission: text().default('view').notNull(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("collection_collaborators_collection_id_idx").using("btree", table.collectionId.asc().nullsLast().op("text_ops")),
	index("collection_collaborators_user_id_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	index("idx_collection_collaborators_collection_id").using("btree", table.collectionId.asc().nullsLast().op("text_ops")),
	index("idx_collection_collaborators_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.collectionId],
		foreignColumns: [collections.id],
		name: "collection_collaborators_collection_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [user.id],
		name: "collection_collaborators_user_id_fkey"
	}).onDelete("cascade"),
	unique("collection_collaborators_collection_id_user_id_key").on(table.collectionId, table.userId),
]);

// ============================================================================
// COLLECTION MOVIES TABLE
// ============================================================================
export const collectionMovies = pgTable("collection_movies", {
	id: text().primaryKey().notNull(),
	collectionId: text("collection_id").notNull(),
	movieId: varchar("movie_id").notNull(),
	addedByUserId: text("added_by_user_id").notNull(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	isMovie: boolean("is_movie"),
}, (table) => [
	index("collection_movies_collection_id_idx").using("btree", table.collectionId.asc().nullsLast().op("text_ops")),
	index("idx_collection_movies_collection_id").using("btree", table.collectionId.asc().nullsLast().op("text_ops")),
	index("idx_collection_movies_movie_id").using("btree", table.movieId.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.addedByUserId],
		foreignColumns: [user.id],
		name: "collection_movies_added_by_user_id_fkey"
	}).onDelete("set null"),
	foreignKey({
		columns: [table.collectionId],
		foreignColumns: [collections.id],
		name: "collection_movies_collection_id_fkey"
	}).onDelete("cascade"),
	unique("collection_movies_collection_id_movie_id_key").on(table.collectionId, table.movieId),
]);

// ============================================================================
// USER RECOMMENDATION COLLECTIONS TABLE (Junction table for multiple recommendation sources)
// ============================================================================
export const userRecommendationCollections = pgTable("user_recommendation_collections", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	collectionId: text("collection_id").notNull(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_user_recommendation_collections_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	index("idx_user_recommendation_collections_collection_id").using("btree", table.collectionId.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [user.id],
		name: "user_recommendation_collections_user_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.collectionId],
		foreignColumns: [collections.id],
		name: "user_recommendation_collections_collection_id_fkey"
	}).onDelete("cascade"),
	unique("user_recommendation_collections_user_collection_key").on(table.userId, table.collectionId),
]);

// ============================================================================
// RECOMMENDATION CACHE TABLE
// ============================================================================
export const recommendationCache = pgTable("recommendation_cache", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	cacheKey: text("cache_key").notNull(),
	payloadJson: text("payload_json").notNull(),
	cacheVersion: text("cache_version").default('v1').notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_recommendation_cache_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	unique("recommendation_cache_user_cache_key").on(table.userId, table.cacheKey),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [user.id],
		name: "recommendation_cache_user_id_fkey"
	}).onDelete("cascade"),
]);

// ============================================================================
// PARENTAL GUIDANCE TABLE (scraped from IMDB)
// ============================================================================
export const parentalGuidance = pgTable("parental_guidance", {
	id: text().primaryKey().notNull(),
	imdbId: text("imdb_id").notNull(),
	tmdbId: text("tmdb_id").notNull(),
	mediaType: text("media_type").notNull(), // 'movie' or 'tv'
	// Severity levels: 'none', 'mild', 'moderate', 'severe'
	nudity: text(),
	violence: text(),
	profanity: text(),
	alcohol: text(),
	frightening: text(),
	// Detailed descriptions for each category
	nudityDescription: text("nudity_description"),
	violenceDescription: text("violence_description"),
	profanityDescription: text("profanity_description"),
	alcoholDescription: text("alcohol_description"),
	frighteningDescription: text("frightening_description"),
	// Metadata
	scrapedAt: timestamp("scraped_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_parental_guidance_imdb_id").using("btree", table.imdbId.asc().nullsLast().op("text_ops")),
	index("idx_parental_guidance_tmdb_id").using("btree", table.tmdbId.asc().nullsLast().op("text_ops")),
	unique("parental_guidance_imdb_id_key").on(table.imdbId),
	unique("parental_guidance_tmdb_id_media_type_key").on(table.tmdbId, table.mediaType),
]);

// ============================================================================
// SCRAPE METADATA TABLE (tracks last scrape time)
// ============================================================================
export const scrapeMetadata = pgTable("scrape_metadata", {
	id: text().primaryKey().notNull(),
	scrapeType: text("scrape_type").notNull(), // e.g., 'parental_guidance'
	lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	itemsScraped: text("items_scraped"), // JSON array of scraped items
}, (table) => [
	unique("scrape_metadata_type_key").on(table.scrapeType),
]);
