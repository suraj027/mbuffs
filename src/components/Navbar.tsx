import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, LogOut, UserCircle, Popcorn, List, LogIn, Loader2, LoaderCircle, Star, LayoutGrid, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '@/components/ui/use-toast';
import { useDebounce } from '@/hooks/use-debounce';
import { searchMoviesApi, getImageUrl } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { Movie } from '@/lib/types';
import { signIn } from '@/lib/auth-client';

export const Navbar = () => {
  const navigate = useNavigate();
  const { user, isLoggedIn, logout, isLoggingOut, isLoadingUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();
  const [scrolled, setScrolled] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSearchTerm, setMobileSearchTerm] = useState('');
  const debouncedMobileSearch = useDebounce(mobileSearchTerm, 400);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Mobile search query
  const { data: mobileSearchResults, isLoading: isMobileSearching } = useQuery({
    queryKey: ['movies', 'search', 'mobile', debouncedMobileSearch],
    queryFn: () => searchMoviesApi(debouncedMobileSearch),
    enabled: !!debouncedMobileSearch && mobileSearchOpen,
    staleTime: 1000 * 60 * 5,
  });

  const mobileResults = mobileSearchResults?.results ?? [];

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
    } else {
      toast({
        title: "Search Error",
        description: "Please enter a movie title to search.",
        variant: "destructive",
      });
    }
  };

  const handleMobileResultClick = (movie: Movie) => {
    const mediaType = movie.first_air_date ? 'tv' : 'movie';
    setMobileSearchOpen(false);
    setMobileSearchTerm('');
    navigate(`/media/${mediaType}/${movie.id}`);
  };

  const handleLogout = () => {
    logout();
    toast({
      title: "Logged Out",
      description: "You have been successfully logged out.",
    });
  };

  const handleLogin = async () => {
    await signIn.social({
      provider: "google",
      callbackURL: window.location.origin,
    });
  };

  return (
    <>
      <header 
        className={`sticky top-0 z-50 flex items-center gap-4 px-8 transition-all duration-300 ${scrolled ? 'glass border-b border-border/60' : 'bg-transparent border-b border-transparent'}`}
        style={{ 
          height: 'calc(4rem + env(safe-area-inset-top))', 
          paddingTop: 'env(safe-area-inset-top)' 
        }}
      >
        {/* Logo / Home Link */}
        <nav className="flex-col gap-6 text-lg font-medium md:flex md:flex-row md:items-center md:gap-5 md:text-sm lg:gap-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight md:text-base group"
          >
            <Popcorn className="h-5 w-5 transition-transform group-hover:scale-110" style={{ stroke: 'url(#logo-gradient)' }} />
            <svg width="0" height="0" className="absolute">
              <defs>
                <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--foreground)" />
                  <stop offset="100%" stopColor="var(--muted-foreground)" />
                </linearGradient>
              </defs>
            </svg>
            <span className="bg-linear-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">mbuffs</span>
          </Link>
          <Link
            to="/categories"
            className="hidden md:flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LayoutGrid className="h-4 w-4" />
            <span>Categories</span>
          </Link>
        </nav>

        {/* Search and User Actions */}
        <div className="flex w-full items-center gap-4 md:ml-auto md:gap-2 lg:gap-4">
          <div className="flex items-center gap-3 ml-auto">
            {/* Mobile search icon */}
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden h-9 w-9 rounded-full bg-muted/70 backdrop-blur-md border border-border hover:bg-muted"
              onClick={() => setMobileSearchOpen(true)}
            >
              <Search className="h-4 w-4 text-muted-foreground" />
            </Button>

            {/* Desktop search input */}
            <form onSubmit={handleSearch} className="hidden sm:block flex-1 md:flex-initial">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/90 pointer-events-none z-10" />
                <Input
                  type="text"
                  placeholder="Search movies..."
                  className="pl-10! pr-4! h-10! sm:w-56 md:w-72 lg:w-96 bg-card/75! backdrop-blur-md! text-foreground! placeholder:text-muted-foreground/90! rounded-lg! border-border/80! shadow-xs! ring-offset-0! focus-visible:ring-2! focus-visible:ring-ring/40! focus-visible:bg-card! focus-visible:border-ring/70! transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </form>

            {/* Auth Section */}
            {isLoggedIn && user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full hover:bg-transparent">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.username || 'User Avatar'} className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <UserCircle className="h-5 w-5" />
                    )}
                    <span className="sr-only">Toggle user menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{user.username || user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/profile')} className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/categories')} className="cursor-pointer md:hidden">
                    <LayoutGrid className="mr-2 h-4 w-4" />
                    <span>Categories</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/collections')} className="cursor-pointer">
                    <List className="mr-2 h-4 w-4" />
                    <span>My Collections</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} disabled={isLoggingOut} className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>{isLoggingOut ? 'Logging out...' : 'Logout'}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              isLoadingUser ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Button onClick={handleLogin}>
                  <LogIn className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">Login</span>
                  <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 48 48" className="h-4 w-4" fill="currentColor">
                    <path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                    <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z" />
                    <path d="M24 44c5.166 0 9.86-1.977 13.412-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                    <path d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.012 35.846 44 30.138 44 24c0-1.341-.138-2.65-.389-3.917z" />
                  </svg>
                </Button>
              )
            )}
          </div>
        </div>
      </header>

      {/* Mobile Search Dialog */}
      <Dialog open={mobileSearchOpen} onOpenChange={(open) => { setMobileSearchOpen(open); if (!open) setMobileSearchTerm(''); }}>
        <DialogContent className="w-[92%] max-w-md rounded-lg p-0 gap-0 top-[10%] translate-y-0 [&>button:last-child]:hidden">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="sr-only">Search</DialogTitle>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/90 pointer-events-none z-10" />
              <Input
                type="text"
                placeholder="Search movies & shows..."
                className="pl-10! h-10! rounded-lg! bg-card/80! border-border/80! text-foreground! placeholder:text-muted-foreground/90! shadow-xs! ring-offset-0! focus-visible:ring-2! focus-visible:ring-ring/40! focus-visible:border-ring/70!"
                value={mobileSearchTerm}
                onChange={(e) => setMobileSearchTerm(e.target.value)}
                autoFocus
              />
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            <div className="px-2 py-2">
              {/* Loading */}
              {isMobileSearching && debouncedMobileSearch && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Empty state */}
              {!debouncedMobileSearch && (
                <p className="text-sm text-muted-foreground text-center py-8">Start typing to search...</p>
              )}

              {/* No results */}
              {debouncedMobileSearch && !isMobileSearching && mobileResults.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No results found.</p>
              )}

              {/* Results */}
              {mobileResults.slice(0, 10).map((movie) => (
                <button
                  key={movie.id}
                  className="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-accent transition-colors text-left"
                  onClick={() => handleMobileResultClick(movie)}
                >
                  <img
                    src={getImageUrl(movie.poster_path, 'w92')}
                    alt={movie.name || movie.title}
                    className="h-14 w-10 rounded-md object-cover bg-muted shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                  />
                  <div className="grow min-w-0">
                    <p className="text-sm font-medium truncate">{movie.name || movie.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {(movie.release_date || movie.first_air_date) && (
                        <span>{new Date(movie.first_air_date || movie.release_date).getFullYear()}</span>
                      )}
                      {movie.vote_average > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                          {movie.vote_average.toFixed(1)}
                        </span>
                      )}
                      <span className="text-muted-foreground">{movie.first_air_date ? 'TV' : 'Movie'}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
};
