import { useSession, signOut } from '../lib/auth-client';

export const useAuth = () => {
    const { data: session, isPending: isLoading, error } = useSession();

    const handleSignOut = async () => {
        await signOut({
            fetchOptions: {
                onSuccess: () => {
                    // Optionally redirect after logout
                    window.location.href = '/';
                },
            },
        });
    };

    // Map session user to match the expected shape
    const user = session?.user ? {
        id: session.user.id,
        email: session.user.email,
        username: (session.user as { username?: string }).username || session.user.name,
        avatarUrl: session.user.image,
        name: session.user.name,
        firstName: (session.user as { firstName?: string }).firstName,
        lastName: (session.user as { lastName?: string }).lastName,
        image: session.user.image,
        createdAt: session.user.createdAt,
        recommendationsEnabled: (session.user as { recommendationsEnabled?: boolean }).recommendationsEnabled,
        recommendationsCollectionId: (session.user as { recommendationsCollectionId?: string }).recommendationsCollectionId,
    } : null;

    return {
        user,
        isLoggedIn: !!session?.user,
        isLoadingUser: isLoading,
        isUserError: !!error,
        userError: error,
        logout: handleSignOut,
        isLoggingOut: false, // Better Auth handles this internally
        session,
    };
};
