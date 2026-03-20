import { createAuthClient } from "better-auth/react";

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

export const authClient = createAuthClient({
    baseURL: BACKEND_BASE_URL,
    fetchOptions: {
        // Must be "include" for cross-origin requests (frontend and backend on
        // different domains) so the session cookie is attached to every fetch.
        // This is what lets useSession() read the auth state after the PWA
        // is closed and reopened — without it, the cookie is never sent and
        // the user appears logged out.
        credentials: "include",
    },
});

// Export commonly used functions for convenience
export const {
    signIn,
    signUp,
    signOut,
    useSession,
    getSession,
} = authClient;
