import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { captcha } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import * as schema from "../db/schema.js";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error("DATABASE_URL is not defined in environment variables.");
}

// Create neon query function for raw SQL and drizzle instance for better-auth
const sqlQuery = neon(databaseUrl);
const db = drizzle(sqlQuery);

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: schema.user,
            session: schema.session,
            account: schema.account,
            verification: schema.verification,
        },
    }),
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5001",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [process.env.FRONTEND_URL || "http://localhost:8080"],
    emailAndPassword: {
        enabled: true,
    },
    socialProviders: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            updateUserOnSignIn: true,
            mapProfileToUser(profile) {
                return {
                    image: profile.picture || undefined,
                };
            },
        },
    },
    plugins: [
        captcha({
            provider: "cloudflare-turnstile",
            secretKey: process.env.TURNSTILE_SECRET_KEY!,
        }),
    ],
    session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // 1 day (refresh session if older than 1 day)
        cookieCache: {
            enabled: true,
            maxAge: 5 * 60, // 5 minutes cache
        },
    },
    advanced: {
        // Cross-origin cookie setup for separate frontend/backend domains (PWA support)
        // sameSite:"none" + secure:true is required for cross-origin fetch()
        // requests to send cookies (used by useSession() in the PWA).
        // Without this, cookies only travel on top-level navigations (the OAuth
        // redirect), so the session appears valid right after login but is gone
        // when the PWA is closed and reopened.
        // In development (HTTP) we fall back to "lax" because "none" requires HTTPS.
        defaultCookieAttributes: {
            // Force sameSite: "none" and secure: true for local network/ngrok testing
            // because the frontend (nip.io) and backend (ngrok) are cross-origin.
            sameSite: "none" as const,
            secure: true,
            // Explicit maxAge prevents iOS from treating these as session-only cookies
            // that get wiped when it kills the PWA's WKWebView process.
            maxAge: 60 * 60 * 24 * 7, // 7 days — matches session.expiresIn
        },
    },
    user: {
        additionalFields: {
            firstName: {
                type: "string",
                required: false,
                fieldName: "firstName",
            },
            lastName: {
                type: "string",
                required: false,
                fieldName: "lastName",
            },
            username: {
                type: "string",
                required: false,
            },
            role: {
                type: "string",
                required: false,
                defaultValue: "user",
            },
            recommendationsEnabled: {
                type: "boolean",
                required: false,
                defaultValue: false,
                fieldName: "recommendationsEnabled",
            },
            recommendationsCollectionId: {
                type: "string",
                required: false,
                fieldName: "recommendationsCollectionId",
            },
            showRedditLabel: {
                type: "boolean",
                required: false,
                defaultValue: true,
                fieldName: "showRedditLabel",
            },
        },
    },
    account: {
        accountLinking: {
            enabled: true,
            trustedProviders: ["google", "credential"],
        },
    },
    databaseHooks: {
        session: {
            create: {
                async before(session) {
                    // When a session is created after OAuth, check if the user
                    // is missing an image and has a Google account with an id_token
                    try {
                        const userResult = await sqlQuery`
                            SELECT u.id, u.image, a.id_token
                            FROM "user" u
                            JOIN account a ON a.user_id = u.id AND a.provider_id = 'google'
                            WHERE u.id = ${session.userId}
                        `;
                        if (userResult.length > 0 && !userResult[0].image && userResult[0].id_token) {
                            const idToken = userResult[0].id_token;
                            const payload = JSON.parse(
                                Buffer.from(idToken.split('.')[1], 'base64').toString()
                            );
                            if (payload.picture) {
                                await sqlQuery`
                                    UPDATE "user" SET image = ${payload.picture} WHERE id = ${session.userId}
                                `;
                                console.log(`[auth] Populated Google profile image for user ${session.userId}`);
                            }
                        }
                    } catch (err) {
                        console.error('[auth] Error populating Google image:', err);
                    }
                    return { data: session };
                },
            },
        },
    },
});

// Export type for use in other files
export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
