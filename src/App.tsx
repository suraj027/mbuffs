import React from 'react';
import { Toaster } from "@/components/ui/toaster"; // Keep this Toaster
import { Toaster as Sonner } from "@/components/ui/sonner"; // Keep Sonner
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from "react-router-dom";
import Index from "./pages/Index";
import Search from "./pages/Search";
import Collections from "./pages/Collections";
import CollectionDetail from "./pages/CollectionDetail";
import Categories from "./pages/Categories";
import CategoryDetail from "./pages/CategoryDetail";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import { useAuth } from './hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

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
import { useToast } from "@/components/ui/use-toast"; // Import the correct useToast
import MovieDetail from './pages/MovieDetail';
import SeasonDetail from './pages/SeasonDetail';
import PersonDetail from './pages/PersonDetail';
import ForYou from './pages/ForYou';
import WatchedItems from './pages/WatchedItems';
import NotInterestedItems from './pages/NotInterestedItems';

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
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Index />} />
          <Route path="/search" element={<Search />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/categories/:mediaType/:genreId" element={<CategoryDetail />} />
          <Route path="/media/:mediaType/:mediaId" element={<MovieDetail />} />
          <Route path="/tv/:mediaId/season/:seasonNumber" element={<SeasonDetail />} />
          <Route path="/person/:personId" element={<PersonDetail />} />

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
            path="/collection/:collectionId"
            element={
              <ProtectedRoute>
                <CollectionDetail />
              </ProtectedRoute>
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

          {/* Catch-all Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </TooltipProvider>
);

// Helper component for protected routes
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isLoggedIn, isLoadingUser } = useAuth();
  const location = useLocation();
  const { toast } = useToast(); // Use the imported hook

  if (isLoadingUser) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  if (!isLoggedIn) {
    // Added a small delay for the toast to be potentially visible before redirect
    // This might not always work perfectly depending on browser rendering.
    toast({
      title: "Access Denied.",
      description: "Please log in to view this page.",
      variant: "destructive",
    });
    // Redirect them to the home page if not logged in.
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return children;
};

export default App;
