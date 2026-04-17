import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { Toaster } from "@/components/ui/toaster"; // Keep this Toaster
import { Toaster as Sonner } from "@/components/ui/sonner"; // Keep Sonner
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from "react-router-dom";
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast"; // Import the correct useToast
import { fetchUserPreferencesApi } from '@/lib/api';
import { FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE, FOR_YOU_QUERY_STALE_TIME, getForYouInfiniteQueryOptions, getPreferencesQueryKey } from '@/lib/recommendationQueries';

const Index = lazy(() => import("./pages/Index"));
const Search = lazy(() => import("./pages/Search"));
const Collections = lazy(() => import("./pages/Collections"));
const CollectionDetail = lazy(() => import("./pages/CollectionDetail"));
const Categories = lazy(() => import("./pages/Categories"));
const CategoryDetail = lazy(() => import("./pages/CategoryDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));
const MovieDetail = lazy(() => import('./pages/MovieDetail'));
const SeasonDetail = lazy(() => import('./pages/SeasonDetail'));
const PersonDetail = lazy(() => import('./pages/PersonDetail'));
const ForYou = lazy(() => import('./pages/ForYou'));
const WatchedItems = lazy(() => import('./pages/WatchedItems'));
const NotInterestedItems = lazy(() => import('./pages/NotInterestedItems'));
const RecommendationCacheDebug = lazy(() => import('./pages/RecommendationCacheDebug'));
const Auth = lazy(() => import('./pages/Auth'));
const Admin = lazy(() => import('./pages/Admin'));

// Scrolls to top on every navigation (except browser back/forward)
const ScrollToTop = () => {
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType !== 'POP') {
      window.scrollTo(0, 0);
    }
  }, [location.pathname, navType]);

  return null;
};

const RouteLoadingFallback = () => (
  <div className="flex justify-center items-center min-h-screen">
    <Loader2 className="h-16 w-16 animate-spin text-primary" />
  </div>
);

const AppPrefetchers = () => {
  const queryClient = useQueryClient();
  const { user, isLoadingUser } = useAuth();
  const prefetchedForUserRef = useRef<string | null>(null);
  const prefetchingForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoadingUser) return;

    if (!user?.id) {
      prefetchedForUserRef.current = null;
      prefetchingForUserRef.current = null;
      return;
    }

    if (prefetchedForUserRef.current === user.id || prefetchingForUserRef.current === user.id) {
      return;
    }

    let isCancelled = false;
    prefetchingForUserRef.current = user.id;

    const prefetchRecommendations = async () => {
      try {
        const preferences = await queryClient.ensureQueryData({
          queryKey: getPreferencesQueryKey(user.id),
          queryFn: fetchUserPreferencesApi,
          staleTime: FOR_YOU_QUERY_STALE_TIME,
        });

        if (isCancelled) return;
        if (!preferences?.preferences?.recommendations_enabled) {
          prefetchedForUserRef.current = user.id;
          return;
        }

        await queryClient.prefetchInfiniteQuery(getForYouInfiniteQueryOptions(user.id, FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE));

        if (!isCancelled) {
          prefetchedForUserRef.current = user.id;
        }
      } catch {
        // Best-effort prefetch only; page-level query handles errors.
      } finally {
        if (prefetchingForUserRef.current === user.id) {
          prefetchingForUserRef.current = null;
        }
      }
    };

    void prefetchRecommendations();

    return () => {
      isCancelled = true;
    };
  }, [isLoadingUser, user?.id, queryClient]);

  return null;
};

// AuthProvider wrapper to initialize auth and handle token from URL
const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  // Initialize the auth hook. The useEffect inside useAuth handles the token from URL.
  useAuth();
  return <>{children}</>; // Render children once auth is initialized
};

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <AppPrefetchers />
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Index />} />
            <Route path="/search" element={<Search />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/categories/:mediaType/:genreId" element={<CategoryDetail />} />
            <Route path="/media/:mediaType/:mediaId" element={<MovieDetail />} />
            <Route path="/tv/:mediaId/season/:seasonNumber" element={<SeasonDetail />} />
            <Route path="/person/:personId" element={<PersonDetail />} />
            <Route path="/collection/:collectionId" element={<CollectionDetail />} />
            <Route path="/login" element={<Auth />} />

            {/* Protected Routes */}
            <Route
              path="/for-you"
              element={
                <ProtectedRoute>
                  <ForYou />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/collections"
              element={
                <ProtectedRoute>
                  <Collections />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <Admin />
                </AdminRoute>
              }
            />
            <Route
              path="/watched"
              element={
                <ProtectedRoute>
                  <WatchedItems />
                </ProtectedRoute>
              }
            />
            <Route
              path="/not-interested"
              element={
                <ProtectedRoute>
                  <NotInterestedItems />
                </ProtectedRoute>
              }
            />
            <Route
              path="/recommendations/debug-cache"
              element={
                <ProtectedRoute>
                  <RecommendationCacheDebug />
                </ProtectedRoute>
              }
            />

            {/* Catch-all Route */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  </TooltipProvider>
);

// Helper component for protected routes
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isLoggedIn, isLoadingUser } = useAuth();
  const location = useLocation();
  const { toast } = useToast(); // Use the imported hook
  const hasShownToastRef = useRef(false);

  useEffect(() => {
    if (!isLoadingUser && !isLoggedIn && !hasShownToastRef.current) {
      hasShownToastRef.current = true;
      toast({
        title: "Access Denied.",
        description: "Please log in to view this page.",
        variant: "destructive",
      });
      return;
    }

    if (isLoggedIn) {
      hasShownToastRef.current = false;
    }
  }, [isLoadingUser, isLoggedIn, toast]);

  if (isLoadingUser) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  if (!isLoggedIn) {
    // Redirect them to the login page if not logged in.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { isLoggedIn, isLoadingUser, user } = useAuth();
  const location = useLocation();

  if (isLoadingUser) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!user?.role || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default App;
