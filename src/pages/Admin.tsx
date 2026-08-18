import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import {
  fetchAdminUsersApi, fetchUserPreferencesApi, updateUserPreferencesApi,
  fetchAdminCuratedItemsApi, addAdminCuratedItemApi, removeAdminCuratedItemApi,
  fetchCollageItemsApi, addCollageItemApi, removeCollageItemApi,
  searchMoviesApi, getImageUrl, fetchMovieDetailsApi, fetchTvDetailsApi,
  fetchRecommendationCacheDebugApi, invalidateRecommendationCacheDebugApi,
} from '@/lib/api';
import {
  AdminUser, AdminUsersResponse, UserPreferences,
  AdminCuratedItem, AdminCuratedItemsResponse,
  HomepageCollageItem, HomepageCollageItemsResponse,
  SearchResults, MovieDetails, Movie,
  RecommendationCacheDebugInvalidateMode, RecommendationCacheDebugInvalidateResponse, RecommendationCacheDebugResponse,
} from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { getPreferencesQueryKey } from '@/lib/recommendationQueries';
import { useDebounce } from '@/hooks/use-debounce';
import { MovieCard } from '@/components/MovieCard';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Plus, Search as SearchIcon, Loader2, Check, Trash2, Database, Clock3, RefreshCw, ShieldAlert, Zap } from 'lucide-react';

const ADMIN_USERS_QUERY_KEY = ['admin', 'users'];
const ADMIN_CURATED_QUERY_KEY = ['admin', 'curated-items'];
const ADMIN_COLLAGE_QUERY_KEY = ['admin', 'collage-items'];

const formatDate = (dateString: string | Date | undefined) => {
  if (!dateString) return 'Unknown';
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const getInitials = (user: AdminUser) => {
  const source = user.name || user.username || user.email || 'User';
  return source
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// ============================================================================
// Users Tab
// ============================================================================
const UsersTab = () => {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const preferencesQueryKey = getPreferencesQueryKey(currentUser?.id);

  const { data, isLoading, isError, error } = useQuery<AdminUsersResponse, Error>({
    queryKey: ADMIN_USERS_QUERY_KEY,
    queryFn: fetchAdminUsersApi,
  });

  const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
    queryKey: preferencesQueryKey,
    queryFn: fetchUserPreferencesApi,
    enabled: currentUser?.role === 'admin',
  });

  const updateRedditLabelMutation = useMutation<
    { preferences: UserPreferences },
    Error,
    boolean,
    {
      previousAdminUsers?: AdminUsersResponse;
      previousPreferences?: { preferences: UserPreferences };
    }
  >({
    mutationFn: (enabled: boolean) => updateUserPreferencesApi({ show_reddit_label: enabled }),
    onMutate: async (enabled: boolean) => {
      if (!currentUser?.id) {
        return {};
      }

      await queryClient.cancelQueries({ queryKey: ADMIN_USERS_QUERY_KEY });
      await queryClient.cancelQueries({ queryKey: preferencesQueryKey });

      const previousAdminUsers = queryClient.getQueryData<AdminUsersResponse>(ADMIN_USERS_QUERY_KEY);
      const previousPreferences = queryClient.getQueryData<{ preferences: UserPreferences }>(preferencesQueryKey);

      queryClient.setQueryData<{ preferences: UserPreferences }>(preferencesQueryKey, (old) => {
        const base = old?.preferences;
        return {
          preferences: {
            recommendations_enabled: base?.recommendations_enabled ?? false,
            recommendations_collection_id: base?.recommendations_collection_id ?? null,
            recommendations_collection_ids: base?.recommendations_collection_ids,
            category_recommendations_enabled: base?.category_recommendations_enabled ?? false,
            show_adult_items: base?.show_adult_items ?? false,
            show_reddit_label: enabled,
            show_movie_card_info: base?.show_movie_card_info ?? false,
          },
        };
      });

      queryClient.setQueryData<AdminUsersResponse>(ADMIN_USERS_QUERY_KEY, (old) => {
        if (!old) return old;
        return {
          ...old,
          users: old.users.map((adminUser) =>
            adminUser.id === currentUser.id
              ? { ...adminUser, showRedditLabel: enabled }
              : adminUser
          ),
        };
      });

      return { previousAdminUsers, previousPreferences };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previousAdminUsers) {
        queryClient.setQueryData(ADMIN_USERS_QUERY_KEY, context.previousAdminUsers);
      }
      if (context?.previousPreferences) {
        queryClient.setQueryData(preferencesQueryKey, context.previousPreferences);
      }
      toast.error('Failed to update Reddit label preference.');
    },
    onSuccess: (response) => {
      queryClient.setQueryData(preferencesQueryKey, response);
      const isEnabled = response.preferences.show_reddit_label;
      toast.success(isEnabled ? 'Reddit label enabled for your account.' : 'Reddit label hidden for your account.');
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Loading user data...</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Avatar</TableHead>
                <TableHead className="px-4">Name / Username</TableHead>
                <TableHead className="px-4">Email</TableHead>
                <TableHead className="px-4">Role</TableHead>
                <TableHead className="px-4">Provider</TableHead>
                <TableHead className="px-4">Recommendations</TableHead>
                <TableHead className="px-4">Category Recs</TableHead>
                <TableHead className="px-4">Reddit Label</TableHead>
                <TableHead className="px-4">Collections</TableHead>
                <TableHead className="px-4">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={`skeleton-row-${index}`}>
                  <TableCell className="px-4"><Skeleton className="h-9 w-9 rounded-full" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-4 w-44" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-4 w-52" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-5 w-9 rounded-full" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-5 w-9 rounded-full" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-5 w-9 rounded-full" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell className="px-4"><Skeleton className="h-4 w-28" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Failed to load users</CardTitle>
          <CardDescription>{error?.message || 'Unable to fetch admin user data.'}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>Total users: {data?.total ?? 0}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Avatar</TableHead>
              <TableHead className="px-4">Name / Username</TableHead>
              <TableHead className="px-4">Email</TableHead>
              <TableHead className="px-4">Role</TableHead>
              <TableHead className="px-4">Provider</TableHead>
              <TableHead className="px-4">Recommendations</TableHead>
              <TableHead className="px-4">Category Recs</TableHead>
              <TableHead className="px-4">Reddit Label</TableHead>
              <TableHead className="px-4">Collections</TableHead>
              <TableHead className="px-4">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.users.map((user) => {
              const avatarSrc = user.avatarUrl || user.image || undefined;
              const role = user.role || 'user';
              const isOwnAdminRow = currentUser?.id === user.id && role === 'admin';
              const redditLabelChecked = role !== 'admin'
                ? false
                : isOwnAdminRow
                  ? (preferencesData?.preferences?.show_reddit_label ?? user.showRedditLabel ?? true)
                  : Boolean(user.showRedditLabel ?? true);

              return (
                <TableRow key={user.id}>
                  <TableCell className="px-4">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={avatarSrc} alt={user.name || user.email} referrerPolicy="no-referrer" />
                      <AvatarFallback>{getInitials(user)}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex flex-col">
                      <span className="font-medium">{user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown'}</span>
                      <span className="text-xs text-muted-foreground">{user.username ? `@${user.username}` : 'No username'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex flex-col gap-1">
                      <span>{user.email}</span>
                      <Badge variant={user.emailVerified ? 'default' : 'secondary'} className="w-fit">
                        {user.emailVerified ? 'Verified' : 'Unverified'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
                      {role}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex flex-wrap gap-1">
                      {(user.providers ?? []).map((provider) => (
                        <Badge key={provider} variant="outline" className="capitalize">
                          {provider === 'credential' ? 'email' : provider}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <Switch checked={Boolean(user.recommendationsEnabled)} disabled />
                  </TableCell>
                  <TableCell className="px-4">
                    <Switch checked={Boolean(user.categoryRecommendationsEnabled)} disabled />
                  </TableCell>
                  <TableCell className="px-4">
                    <Switch
                      checked={redditLabelChecked}
                      disabled={!isOwnAdminRow || updateRedditLabelMutation.isPending}
                      onCheckedChange={(checked) => {
                        if (!isOwnAdminRow) return;
                        updateRedditLabelMutation.mutate(checked);
                      }}
                    />
                  </TableCell>
                  <TableCell className="px-4">{user.collectionCount}</TableCell>
                  <TableCell className="px-4">{formatDate(user.createdAt)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// Add Curated Item Dialog
// ============================================================================
interface AddItemDialogProps {
  existingTmdbIds: Set<string>;
  onAdd: (movie: Movie) => Promise<unknown>;
  title?: string;
  description?: string;
}

const AddItemDialog: React.FC<AddItemDialogProps> = ({ existingTmdbIds, onAdd, title = 'Add Item', description = 'Search for movies and TV shows to add.' }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const {
    data: searchResultsData,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading: isLoadingSearch,
    isError: isSearchError,
    error: searchError
  } = useInfiniteQuery<SearchResults, Error>({
    queryKey: ['movies', 'search', debouncedSearchTerm],
    queryFn: ({ pageParam = 1 }) => searchMoviesApi(debouncedSearchTerm, pageParam as number),
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.total_pages) return lastPage.page + 1;
      return undefined;
    },
    enabled: !!debouncedSearchTerm,
    initialPageParam: 1,
  });

  const handleAddClick = async (movie: Movie) => {
    const movieId = String(movie.id);
    setPendingIds((prev) => new Set(prev).add(movieId));
    try {
      await onAdd(movie);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(movieId);
        return next;
      });
    }
  };

  const movies = searchResultsData?.pages.flatMap(page => page.results) ?? [];

  return (
    <DialogContent className="w-[90%] sm:max-w-[550px] rounded-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="relative my-2">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search..."
          className="pl-9 pr-9"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {isFetching && !isFetchingNextPage ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        ) : searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        )}
      </div>

      <div className="h-[350px] overflow-y-auto">
        <div className="space-y-1 pr-2">
          {isLoadingSearch && debouncedSearchTerm && (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          )}
          {isSearchError && (
            <div className="text-destructive text-center py-8">Error: {searchError?.message}</div>
          )}
          {!debouncedSearchTerm && (
            <div className="text-muted-foreground text-center py-8">Start typing to search...</div>
          )}
          {debouncedSearchTerm && !isLoadingSearch && !isSearchError && movies.length === 0 && (
            <div className="text-muted-foreground text-center py-8">No results for &ldquo;{debouncedSearchTerm}&rdquo;</div>
          )}

          {movies.map((movie, i) => {
            const tmdbId = String(movie.id);
            const alreadyAdded = existingTmdbIds.has(tmdbId);
            const isPending = pendingIds.has(tmdbId);

            return (
              <div
                key={movie.id + '-' + i}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors overflow-hidden"
              >
                <img
                  src={getImageUrl(movie.poster_path, 'w92')}
                  alt={movie.name || movie.title}
                  className="h-14 w-auto rounded aspect-[2/3] object-cover bg-muted shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                />
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-medium truncate">{movie.name || movie.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {(movie.first_air_date || movie.release_date)?.substring(0, 4)}
                    {movie.first_air_date ? ' (TV)' : ''}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant={alreadyAdded ? "secondary" : "default"}
                  onClick={() => handleAddClick(movie)}
                  disabled={alreadyAdded || isPending}
                  className="shrink-0 h-8 w-8"
                >
                  {alreadyAdded ? (
                    <Check className="h-4 w-4" />
                  ) : isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </div>
            );
          })}

          {hasNextPage && (
            <div className="pt-2">
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load More
              </Button>
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary" className="border border-border/70">Done</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
};

// ============================================================================
// Curated Items Tab
// ============================================================================
const CuratedItemsTab = () => {
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);

  const { data: curatedData, isLoading, isError, error } = useQuery<AdminCuratedItemsResponse, Error>({
    queryKey: ADMIN_CURATED_QUERY_KEY,
    queryFn: fetchAdminCuratedItemsApi,
  });

  const curatedItems = curatedData?.items ?? [];

  const tmdbIds = useMemo(() => curatedItems.map((item) => item.tmdb_id), [curatedItems]);
  const existingTmdbIds = useMemo(() => new Set(tmdbIds), [tmdbIds]);

  const { data: moviesDetailsMap, isLoading: isLoadingDetails } = useQuery<Record<string, MovieDetails | null>, Error>({
    queryKey: ['movies', 'details', 'curated', ...tmdbIds].sort(),
    queryFn: async () => {
      if (curatedItems.length === 0) return {};
      const entries = await Promise.all(
        curatedItems.map(async (item) => {
          try {
            const details = item.media_type === 'movie'
              ? await fetchMovieDetailsApi(Number(item.tmdb_id))
              : await fetchTvDetailsApi(Number(item.tmdb_id));
            return [item.tmdb_id, details] as const;
          } catch {
            return [item.tmdb_id, null] as const;
          }
        })
      );
      return Object.fromEntries(entries);
    },
    enabled: curatedItems.length > 0,
  });

  const movies: Movie[] = useMemo(() => {
    if (!moviesDetailsMap) return [];
    return curatedItems
      .map((item) => moviesDetailsMap[item.tmdb_id])
      .filter((m): m is MovieDetails => m !== null && m !== undefined);
  }, [curatedItems, moviesDetailsMap]);

  const curatedIdByTmdbId = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of curatedItems) {
      map.set(Number(item.tmdb_id), item.id);
    }
    return map;
  }, [curatedItems]);

  const addedByNameByTmdbId = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of curatedItems) {
      if (item.added_by_name) map.set(Number(item.tmdb_id), item.added_by_name);
    }
    return map;
  }, [curatedItems]);

  const detailsQueryKey = useMemo(
    () => ['movies', 'details', 'curated', ...tmdbIds].sort(),
    [tmdbIds]
  );

  const addMutation = useMutation<
    { item: AdminCuratedItem },
    Error & { status?: number },
    Movie,
    { previousCurated?: AdminCuratedItemsResponse; previousDetails?: Record<string, MovieDetails | null> }
  >({
    mutationFn: (movie: Movie) => {
      const isTV = !!movie.first_air_date;
      return addAdminCuratedItemApi({
        tmdb_id: String(movie.id),
        media_type: isTV ? 'tv' : 'movie',
        title: movie.name || movie.title,
        poster_path: movie.poster_path,
      });
    },
    onMutate: async (movie) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_CURATED_QUERY_KEY });

      const previousCurated = queryClient.getQueryData<AdminCuratedItemsResponse>(ADMIN_CURATED_QUERY_KEY);
      const previousDetails = queryClient.getQueryData<Record<string, MovieDetails | null>>(detailsQueryKey);

      const isTV = !!movie.first_air_date;
      const optimisticItem: AdminCuratedItem = {
        id: `optimistic-${movie.id}`,
        tmdb_id: String(movie.id),
        media_type: isTV ? 'tv' : 'movie',
        title: movie.name || movie.title,
        poster_path: movie.poster_path,
        added_by_user_id: '',
        added_at: new Date().toISOString(),
      };

      queryClient.setQueryData<AdminCuratedItemsResponse>(ADMIN_CURATED_QUERY_KEY, (old) => {
        const items = old?.items ?? [];
        return { items: [optimisticItem, ...items], total: items.length + 1 };
      });

      queryClient.setQueryData<Record<string, MovieDetails | null>>(detailsQueryKey, (old) => ({
        ...old,
        [String(movie.id)]: movie as MovieDetails,
      }));

      return { previousCurated, previousDetails };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_CURATED_QUERY_KEY });
      toast.success('Item added to curated list.');
    },
    onError: (err, _movie, context) => {
      if (context?.previousCurated) {
        queryClient.setQueryData(ADMIN_CURATED_QUERY_KEY, context.previousCurated);
      }
      if (context?.previousDetails) {
        queryClient.setQueryData(detailsQueryKey, context.previousDetails);
      }
      if (err.status === 409) {
        toast.error('Item is already in the curated list.');
      } else {
        toast.error('Failed to add item.');
      }
    },
  });

  const removeMutation = useMutation<
    void,
    Error,
    string,
    { previousCurated?: AdminCuratedItemsResponse }
  >({
    mutationFn: removeAdminCuratedItemApi,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_CURATED_QUERY_KEY });

      const previousCurated = queryClient.getQueryData<AdminCuratedItemsResponse>(ADMIN_CURATED_QUERY_KEY);

      queryClient.setQueryData<AdminCuratedItemsResponse>(ADMIN_CURATED_QUERY_KEY, (old) => {
        if (!old) return old;
        const items = old.items.filter((item) => item.id !== id);
        return { items, total: items.length };
      });

      return { previousCurated };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_CURATED_QUERY_KEY });
      toast.success('Item removed from curated list.');
    },
    onError: (_err, _id, context) => {
      if (context?.previousCurated) {
        queryClient.setQueryData(ADMIN_CURATED_QUERY_KEY, context.previousCurated);
      }
      toast.error('Failed to remove item.');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {curatedItems.length} item{curatedItems.length !== 1 ? 's' : ''} curated for all users.
            Items appear in recommendations on next cache refresh.
          </p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span>Add Item</span>
            </Button>
          </DialogTrigger>
          <AddItemDialog
            existingTmdbIds={existingTmdbIds}
            onAdd={(movie) => addMutation.mutateAsync(movie)}
            title="Add Curated Item"
            description="Search for movies and TV shows to recommend to all users."
          />
        </Dialog>
      </div>

      {isLoading || (isLoadingDetails && curatedItems.length > 0) ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] w-full rounded-md" />
              <Skeleton className="h-4 w-[80%]" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load curated items</CardTitle>
            <CardDescription>{error?.message || 'Unable to fetch curated items.'}</CardDescription>
          </CardHeader>
        </Card>
      ) : movies.length === 0 ? (
        <div className="text-center py-16 rounded-2xl bg-muted/30 border border-border">
          <h2 className="text-xl font-semibold mb-2">No curated items yet</h2>
          <p className="text-muted-foreground text-sm">Add movies or TV shows to recommend to all users.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 lg:grid-cols-5">
          {movies.map((movie) => {
            const curatedId = curatedIdByTmdbId.get(movie.id);
            const addedByName = addedByNameByTmdbId.get(movie.id);
            return (
              <div key={movie.id}>
                <MovieCard
                  movie={movie}
                  showWatched={false}
                  additionalMenuItems={curatedId ? (
                    <DropdownMenuItem
                      className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-destructive focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeMutation.mutate(curatedId);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      <span>Remove</span>
                    </DropdownMenuItem>
                  ) : undefined}
                />
                {addedByName && (
                  <p className="text-xs text-muted-foreground mt-1.5 truncate">
                    {addedByName}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Collage Items Tab
// ============================================================================
const CollageItemsTab = () => {
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);

  const { data: collageData, isLoading, isError, error } = useQuery<HomepageCollageItemsResponse, Error>({
    queryKey: ADMIN_COLLAGE_QUERY_KEY,
    queryFn: fetchCollageItemsApi,
  });

  const collageItems = collageData?.items ?? [];
  const minItems = collageData?.minItems ?? 12;

  const tmdbIds = useMemo(() => collageItems.map((item) => item.tmdb_id), [collageItems]);
  const existingTmdbIds = useMemo(() => new Set(tmdbIds), [tmdbIds]);

  const { data: moviesDetailsMap, isLoading: isLoadingDetails } = useQuery<Record<string, MovieDetails | null>, Error>({
    queryKey: ['movies', 'details', 'collage', ...tmdbIds].sort(),
    queryFn: async () => {
      if (collageItems.length === 0) return {};
      const entries = await Promise.all(
        collageItems.map(async (item) => {
          try {
            const details = item.media_type === 'movie'
              ? await fetchMovieDetailsApi(Number(item.tmdb_id))
              : await fetchTvDetailsApi(Number(item.tmdb_id));
            return [item.tmdb_id, details] as const;
          } catch {
            return [item.tmdb_id, null] as const;
          }
        })
      );
      return Object.fromEntries(entries);
    },
    enabled: collageItems.length > 0,
  });

  const movies: Movie[] = useMemo(() => {
    if (!moviesDetailsMap) return [];
    return collageItems
      .map((item) => moviesDetailsMap[item.tmdb_id])
      .filter((m): m is MovieDetails => m !== null && m !== undefined);
  }, [collageItems, moviesDetailsMap]);

  const collageIdByTmdbId = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of collageItems) {
      map.set(Number(item.tmdb_id), item.id);
    }
    return map;
  }, [collageItems]);

  const addedByNameByTmdbId = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of collageItems) {
      if (item.added_by_name) map.set(Number(item.tmdb_id), item.added_by_name);
    }
    return map;
  }, [collageItems]);

  const detailsQueryKey = useMemo(
    () => ['movies', 'details', 'collage', ...tmdbIds].sort(),
    [tmdbIds]
  );

  const addMutation = useMutation<
    { item: HomepageCollageItem },
    Error & { status?: number },
    Movie,
    { previousCollage?: HomepageCollageItemsResponse; previousDetails?: Record<string, MovieDetails | null> }
  >({
    mutationFn: (movie: Movie) => {
      const isTV = !!movie.first_air_date;
      return addCollageItemApi({
        tmdb_id: String(movie.id),
        media_type: isTV ? 'tv' : 'movie',
        title: movie.name || movie.title,
        poster_path: movie.poster_path,
      });
    },
    onMutate: async (movie) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_COLLAGE_QUERY_KEY });

      const previousCollage = queryClient.getQueryData<HomepageCollageItemsResponse>(ADMIN_COLLAGE_QUERY_KEY);
      const previousDetails = queryClient.getQueryData<Record<string, MovieDetails | null>>(detailsQueryKey);

      const isTV = !!movie.first_air_date;
      const optimisticItem: HomepageCollageItem = {
        id: `optimistic-${movie.id}`,
        tmdb_id: String(movie.id),
        media_type: isTV ? 'tv' : 'movie',
        title: movie.name || movie.title,
        poster_path: movie.poster_path,
        added_by_user_id: '',
        added_at: new Date().toISOString(),
      };

      queryClient.setQueryData<HomepageCollageItemsResponse>(ADMIN_COLLAGE_QUERY_KEY, (old) => {
        const items = old?.items ?? [];
        return { items: [optimisticItem, ...items], total: items.length + 1, minItems: old?.minItems ?? 12 };
      });

      queryClient.setQueryData<Record<string, MovieDetails | null>>(detailsQueryKey, (old) => ({
        ...old,
        [String(movie.id)]: movie as MovieDetails,
      }));

      return { previousCollage, previousDetails };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_COLLAGE_QUERY_KEY });
      toast.success('Item added to collage.');
    },
    onError: (err, _movie, context) => {
      if (context?.previousCollage) {
        queryClient.setQueryData(ADMIN_COLLAGE_QUERY_KEY, context.previousCollage);
      }
      if (context?.previousDetails) {
        queryClient.setQueryData(detailsQueryKey, context.previousDetails);
      }
      if (err.status === 409) {
        toast.error('Item is already in the collage.');
      } else {
        toast.error('Failed to add item.');
      }
    },
  });

  const removeMutation = useMutation<
    void,
    Error,
    string,
    { previousCollage?: HomepageCollageItemsResponse }
  >({
    mutationFn: removeCollageItemApi,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_COLLAGE_QUERY_KEY });

      const previousCollage = queryClient.getQueryData<HomepageCollageItemsResponse>(ADMIN_COLLAGE_QUERY_KEY);

      queryClient.setQueryData<HomepageCollageItemsResponse>(ADMIN_COLLAGE_QUERY_KEY, (old) => {
        if (!old) return old;
        const items = old.items.filter((item) => item.id !== id);
        return { items, total: items.length, minItems: old.minItems };
      });

      return { previousCollage };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_COLLAGE_QUERY_KEY });
      toast.success('Item removed from collage.');
    },
    onError: (_err, _id, context) => {
      if (context?.previousCollage) {
        queryClient.setQueryData(ADMIN_COLLAGE_QUERY_KEY, context.previousCollage);
      }
      toast.error('Failed to remove item.');
    },
  });

  const itemCount = collageItems.length;
  const isBelowMin = itemCount < minItems;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {itemCount} item{itemCount !== 1 ? 's' : ''} in collage.
            {isBelowMin && (
              <span className="text-amber-500 font-medium ml-1">
                Minimum {minItems} required — {minItems - itemCount} more needed.
              </span>
            )}
            {!isBelowMin && ' Displayed on the homepage hero section.'}
          </p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span>Add Item</span>
            </Button>
          </DialogTrigger>
          <AddItemDialog
            existingTmdbIds={existingTmdbIds}
            onAdd={(movie) => addMutation.mutateAsync(movie)}
            title="Add Collage Item"
            description="Search for movies and TV shows to display in the homepage collage."
          />
        </Dialog>
      </div>

      {isLoading || (isLoadingDetails && collageItems.length > 0) ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] w-full rounded-md" />
              <Skeleton className="h-4 w-[80%]" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load collage items</CardTitle>
            <CardDescription>{error?.message || 'Unable to fetch collage items.'}</CardDescription>
          </CardHeader>
        </Card>
      ) : movies.length === 0 ? (
        <div className="text-center py-16 rounded-2xl bg-muted/30 border border-border">
          <h2 className="text-xl font-semibold mb-2">No collage items yet</h2>
          <p className="text-muted-foreground text-sm">Add at least {minItems} movies or TV shows for the homepage collage.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 lg:grid-cols-5">
          {movies.map((movie) => {
            const collageId = collageIdByTmdbId.get(movie.id);
            const addedByName = addedByNameByTmdbId.get(movie.id);
            return (
              <div key={movie.id}>
                <MovieCard
                  movie={movie}
                  showWatched={false}
                  additionalMenuItems={collageId ? (
                    <DropdownMenuItem
                      className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-destructive focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeMutation.mutate(collageId);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      <span>Remove</span>
                    </DropdownMenuItem>
                  ) : undefined}
                />
                {addedByName && (
                  <p className="text-xs text-muted-foreground mt-1.5 truncate">
                    {addedByName}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Cache Debug Tab
// ============================================================================
const CACHE_DEBUG_QUERY_KEY = ['recommendations', 'cache', 'debug'];

const formatDateTime = (value: string | null) => {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
};

const formatRelative = (value: string | null, now: number) => {
  if (!value) return 'n/a';
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return value;
  const diffMs = ms - now;
  const absMs = Math.abs(diffMs);
  const absSeconds = Math.round(absMs / 1000);
  if (absSeconds < 60) return diffMs >= 0 ? `in ${absSeconds}s` : `${absSeconds}s ago`;
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) return diffMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return diffMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  const absDays = Math.round(absHours / 24);
  return diffMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const CacheDebugTab = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<RecommendationCacheDebugResponse, Error>({
    queryKey: CACHE_DEBUG_QUERY_KEY,
    queryFn: fetchRecommendationCacheDebugApi,
    staleTime: 30 * 1000,
  });

  const invalidateMutation = useMutation<
    RecommendationCacheDebugInvalidateResponse,
    Error,
    { mode: RecommendationCacheDebugInvalidateMode; warm: boolean }
  >({
    mutationFn: ({ mode, warm }) => invalidateRecommendationCacheDebugApi(mode, { warm }),
    onSuccess: (result) => {
      queryClient.setQueryData(CACHE_DEBUG_QUERY_KEY, result);
      const warmText = result.warm_started ? ' Warm triggered.' : '';
      toast.success(`${result.message}.${warmText}`.trim());
    },
    onError: (mutationError) => {
      toast.error(mutationError.message || 'Failed to update recommendation cache.');
    },
  });

  const handleInvalidate = async (mode: RecommendationCacheDebugInvalidateMode, warm: boolean) => {
    if (mode === 'hard') {
      const confirmed = window.confirm('Hard invalidation clears all cache rows immediately. Continue?');
      if (!confirmed) return;
    }
    await invalidateMutation.mutateAsync({ mode, warm });
  };

  const cache = data?.cache;
  const entries = cache?.entries ?? [];
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const activeEntries = entries.filter((entry) => entry.slot === 'active');
  const stagingEntries = entries.filter((entry) => entry.slot === 'staging');
  const activeFresh = activeEntries.filter((entry) => new Date(entry.expires_at).getTime() > nowMs).length;
  const activeExpired = activeEntries.length - activeFresh;
  const generationLocks = entries.filter((entry) => Boolean(entry.generation_started_at)).length;
  const isMutating = invalidateMutation.isPending;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Recommendation Cache</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Debug view for recommendation snapshots (TTL: {data?.ttl_minutes ?? 30} minutes).
          </p>
        </div>
        <Button onClick={() => { setNowMs(Date.now()); void refetch(); }} disabled={isFetching || isMutating} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Unable to load cache debug
            </CardTitle>
            <CardDescription>{error?.message || 'This endpoint may be restricted to authorized users.'}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cache Controls</CardTitle>
              <CardDescription>
                Use soft expire to keep serving stale active cache while background refresh runs.
                Use hard invalidate only when you need a full reset.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button onClick={() => void handleInvalidate('soft', true)} disabled={isMutating || isFetching} className="gap-2">
                <Zap className="h-4 w-4" />
                Soft Expire + Warm
              </Button>
              <Button variant="destructive" onClick={() => void handleInvalidate('hard', true)} disabled={isMutating || isFetching} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Hard Invalidate + Warm
              </Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card><CardHeader className="pb-2"><CardDescription>Total Entries</CardDescription><CardTitle className="text-3xl">{cache?.total ?? 0}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Active Rows</CardDescription><CardTitle className="text-3xl">{activeEntries.length}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Staging Rows</CardDescription><CardTitle className="text-3xl">{stagingEntries.length}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Active Fresh</CardDescription><CardTitle className="text-3xl text-emerald-500">{activeFresh}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Active Expired</CardDescription><CardTitle className="text-3xl text-amber-500">{activeExpired}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Generation Locks</CardDescription><CardTitle className="text-3xl text-sky-500">{generationLocks}</CardTitle></CardHeader></Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Cache Entries
              </CardTitle>
              <CardDescription>Showing newest entries first.</CardDescription>
            </CardHeader>
            <CardContent>
              {!entries.length ? (
                <p className="text-sm text-muted-foreground">No cached recommendation entries found yet.</p>
              ) : (
                <div className="space-y-3">
                  {entries.map((entry) => {
                    const isFresh = new Date(entry.expires_at).getTime() > nowMs;
                    return (
                      <div key={`${entry.cache_key}-${entry.slot}-${entry.updated_at}`} className="rounded-lg border p-3 bg-card/50">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant={isFresh ? 'default' : 'secondary'}>{isFresh ? 'fresh' : 'expired'}</Badge>
                          <Badge variant={entry.slot === 'active' ? 'default' : 'outline'}>{entry.slot}</Badge>
                          <Badge variant="outline">{entry.cache_version}</Badge>
                          <Badge variant="outline">{formatBytes(entry.payload_size)}</Badge>
                          {entry.generation_started_at ? <Badge variant="secondary">generating</Badge> : null}
                        </div>
                        <p className="text-xs text-muted-foreground break-all">{entry.cache_key}</p>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3 w-3" /> Expires {formatDateTime(entry.expires_at)} ({formatRelative(entry.expires_at, nowMs)})
                          </span>
                          <span>Created {formatDateTime(entry.created_at)}</span>
                          <span>Updated {formatDateTime(entry.updated_at)}</span>
                          <span>
                            Generation started {formatDateTime(entry.generation_started_at)}
                            {entry.generation_started_at ? ` (${formatRelative(entry.generation_started_at, nowMs)})` : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Admin Page
// ============================================================================
const ADMIN_TAB_KEY = 'admin-active-tab';

const Admin = () => {
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem(ADMIN_TAB_KEY) || 'users');

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    sessionStorage.setItem(ADMIN_TAB_KEY, value);
  };

  return (
    <>
      <Navbar />
      <main className="container py-8 max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Admin</h1>
        <p className="text-muted-foreground mb-6">Manage users and curated recommendations.</p>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="mb-6">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="curated">Curated Items</TabsTrigger>
            <TabsTrigger value="collage">Collage</TabsTrigger>
            <TabsTrigger value="cache-debug">Cache Debug</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <UsersTab />
          </TabsContent>

          <TabsContent value="curated">
            <CuratedItemsTab />
          </TabsContent>

          <TabsContent value="collage">
            <CollageItemsTab />
          </TabsContent>

          <TabsContent value="cache-debug">
            <CacheDebugTab />
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
};

export default Admin;
