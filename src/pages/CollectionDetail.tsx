import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
    fetchCollectionDetailsApi,
    fetchMovieDetailsApi,
    searchMoviesApi,
    addMovieToCollectionApi,
    removeMovieFromCollectionApi,
    addCollaboratorApi,
    updateCollaboratorApi,
    removeCollaboratorApi,
    fetchTvDetailsApi
} from '@/lib/api';
import { CollectionDetails, MovieDetails, CollectionCollaborator, AddCollaboratorInput, UpdateCollaboratorInput, SearchResults, AddMovieInput } from '@/lib/types';
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MovieCard } from "@/components/MovieCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getImageUrl } from "@/lib/api";
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { Film, Trash2, UserPlus, Loader2, Check, UserMinus, Plus, Search as SearchIcon, MoreVertical, LogOut, LogIn, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import React, { useState, useMemo, Fragment, useRef, useCallback, useEffect } from 'react';
import { toast } from "sonner";
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDebounce } from '@/hooks/use-debounce';
import { useWatchedStatus } from '@/hooks/useWatchedStatus';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const frontendAddCollaboratorSchema = z.object({
    email: z.string().email("Invalid email address"),
    permission: z.enum(['view', 'edit']),
});
type FrontendAddCollaboratorInput = z.infer<typeof frontendAddCollaboratorSchema>;

const ITEMS_PER_PAGE = 30;

const CollectionDetail = () => {
    const { collectionId } = useParams<{ collectionId: string }>();
    const { user: currentUser, isLoggedIn, signIn } = useAuth();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [isAddCollabOpen, setIsAddCollabOpen] = useState(false);
    const [isAddMovieOpen, setIsAddMovieOpen] = useState(false);
    const [isCollabListOpen, setIsCollabListOpen] = useState(false);
    const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
    const [visibleItemsCount, setVisibleItemsCount] = useState(ITEMS_PER_PAGE);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isBannerDismissed, setIsBannerDismissed] = useState(false);

    const collectionQueryKey = ['collection', collectionId];

    const {
        data: collectionDetails,
        isLoading: isLoadingCollection,
        isError: isCollectionError,
        error: collectionError
    } = useQuery<CollectionDetails, Error>({
        queryKey: collectionQueryKey,
        queryFn: () => fetchCollectionDetailsApi(collectionId!),
        enabled: !!collectionId,
    });

    const movieIds = collectionDetails?.movies.map(m => m.movie_id) ?? [];
    const {
        data: moviesDetailsMap,
        isLoading: isLoadingMovies
    } = useQuery<Record<number, MovieDetails | null>, Error>({
        queryKey: ['movies', 'details', ...movieIds].sort(),
        queryFn: async () => {
            if (!movieIds || movieIds.length === 0) return {};
            const promises = movieIds.map((id) => {
                const idStr = String(id);
                if (idStr.includes('tv')) {
                    const numericId = parseInt(idStr.replace('tv', ''), 10);
                    return fetchTvDetailsApi(numericId);
                } else {
                    return fetchMovieDetailsApi(Number(id));
                }
            });
            const results = await Promise.all(promises);
            const map: Record<number, MovieDetails | null> = {};
            movieIds.forEach((id, index) => { map[id] = results[index]; });
            return map;
        },
        enabled: movieIds.length > 0,
        staleTime: 1000 * 60 * 60,
    });

    const filteredMedia = useMemo(() => {
        if (!collectionDetails || !moviesDetailsMap) return [];
        return collectionDetails.movies.filter(entry => {
            const media = moviesDetailsMap[entry.movie_id];
            if (!media) return false;
            switch (mediaTypeFilter) {
                case 'movie':
                    return 'release_date' in media && media.release_date !== undefined;
                case 'tv':
                    return 'first_air_date' in media && media.first_air_date !== undefined;
                case 'all':
                default:
                    return true;
            }
        });
    }, [collectionDetails, moviesDetailsMap, mediaTypeFilter]);

    const currentVisibleMedia = useMemo(() => {
        return filteredMedia.slice(0, visibleItemsCount);
    }, [filteredMedia, visibleItemsCount]);

    const hasMoreItems = filteredMedia.length > visibleItemsCount;

    // Generate media IDs for watched status lookup
    const mediaIds = useMemo(() => 
        currentVisibleMedia.map(entry => String(entry.movie_id)),
        [currentVisibleMedia]
    );

    const { watchedMap } = useWatchedStatus(mediaIds);

    // Infinite scroll with Intersection Observer
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
        if (isLoadingMore) return;
        
        if (observerRef.current) {
            observerRef.current.disconnect();
        }
        
        observerRef.current = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && hasMoreItems) {
                setIsLoadingMore(true);
                // Small delay to show skeleton loaders
                setTimeout(() => {
                    setVisibleItemsCount(prevCount => prevCount + ITEMS_PER_PAGE);
                    setIsLoadingMore(false);
                }, 300);
            }
        }, {
            rootMargin: '200px',
        });
        
        if (node) {
            observerRef.current.observe(node);
        }
    }, [isLoadingMore, hasMoreItems]);

    // Cleanup observer on unmount
    useEffect(() => {
        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, []);

    // Mutations
    const removeMovieMutation = useMutation<void, Error, { collectionId: string; movieId: number | string }>({
        mutationFn: ({ collectionId, movieId }) => removeMovieFromCollectionApi(collectionId, movieId),
        onSuccess: (_, { movieId }) => {
            toast.success("Removed from collection.");
            queryClient.invalidateQueries({ queryKey: collectionQueryKey });
            queryClient.invalidateQueries({ queryKey: ['collections', 'movie-status', String(movieId)] });
        },
        onError: (error) => { toast.error(`Failed to remove: ${error.message}`); }
    });

    const { register: registerCollab, handleSubmit: handleSubmitCollab, reset: resetCollab, setValue: setCollabValue, watch: watchCollab, formState: { errors: collabErrors } } = useForm<FrontendAddCollaboratorInput>({
        resolver: zodResolver(frontendAddCollaboratorSchema),
        defaultValues: { permission: 'edit' },
    });
    
    const addCollaboratorMutation = useMutation<{ collaborator: CollectionCollaborator }, Error, { collectionId: string; data: AddCollaboratorInput }>({
        mutationFn: ({ collectionId, data }) => addCollaboratorApi(collectionId, data),
        onSuccess: (data) => {
            toast.success(`${data.collaborator.username || data.collaborator.email} added.`);
            queryClient.invalidateQueries({ queryKey: collectionQueryKey });
            resetCollab();
            setIsAddCollabOpen(false);
        },
        onError: (error) => { toast.error(`Failed to add: ${error.message}`); }
    });
    
    const onAddCollaborator = (formData: FrontendAddCollaboratorInput) => {
        if (!collectionId) return;
        addCollaboratorMutation.mutate({ collectionId, data: { email: formData.email, permission: formData.permission } });
    };

    const removeCollaboratorMutation = useMutation<void, Error, { collectionId: string; userId: string }>({
        mutationFn: ({ collectionId, userId }) => removeCollaboratorApi(collectionId, userId),
        onSuccess: () => {
            toast.success("Collaborator removed.");
            queryClient.invalidateQueries({ queryKey: collectionQueryKey });
        },
        onError: (error) => { toast.error(`Failed to remove: ${error.message}`); }
    });

    const updateCollaboratorMutation = useMutation<{ collaborator: CollectionCollaborator }, Error, { collectionId: string; userId: string; data: UpdateCollaboratorInput }>({
        mutationFn: ({ collectionId, userId, data }) => updateCollaboratorApi(collectionId, userId, data),
        onSuccess: (data) => {
            toast.success(`Role updated to ${data.collaborator.permission}.`);
            queryClient.invalidateQueries({ queryKey: collectionQueryKey });
        },
        onError: (error) => { toast.error(`Failed to update: ${error.message}`); }
    });

    const leaveCollectionMutation = useMutation<void, Error, { collectionId: string; userId: string }>({
        mutationFn: ({ collectionId, userId }) => removeCollaboratorApi(collectionId, userId),
        onSuccess: () => {
            toast.success("You have left the collection.");
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            setIsCollabListOpen(false);
            navigate('/');
        },
        onError: (error) => { toast.error(`Failed to leave: ${error.message}`); }
    });

    const addMovieMutation = useMutation<any, Error, { collectionId: string; data: AddMovieInput }>({
        mutationFn: ({ collectionId, data }) => addMovieToCollectionApi(collectionId, data),
        onSuccess: (data, variables) => {
            toast.success(`Added to collection.`);
            queryClient.invalidateQueries({ queryKey: collectionQueryKey });
            queryClient.invalidateQueries({ queryKey: ['collections', 'movie-status', String(variables.data.movieId)] });
        },
        onError: (error: any) => {
            if (error?.data?.message?.includes('already exists')) {
                toast.warning("Already in this collection.");
            } else {
                toast.error(`Failed to add: ${error.message}`);
            }
        }
    });

    const collection = collectionDetails?.collection;
    const isOwner = collection?.owner_id === currentUser?.id;
    const canEdit = isOwner || collectionDetails?.collaborators.some(c => c.user_id === currentUser?.id && c.permission === 'edit');
    const canViewMembers = collection?.user_permission === 'owner' || collection?.user_permission === 'edit' || collection?.user_permission === 'view';

    const isLoading = isLoadingCollection;
    const isError = isCollectionError;
    const error = collectionError;

    if (isLoading) {
        return (
            <>
                <Navbar />
                <main className="container py-10 max-w-6xl mx-auto">
                    <Skeleton className="h-10 w-1/3 mb-2" />
                    <Skeleton className="h-5 w-1/2 mb-8" />
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
                        ))}
                    </div>
                </main>
            </>
        );
    }

    if (isError) {
        return (
            <>
                <Navbar />
                <main className="container py-10 max-w-6xl mx-auto text-center">
                    <p className="text-destructive">Error: {error?.message ?? 'Unknown error'}</p>
                </main>
            </>
        );
    }

    if (!collection) {
        return (
            <>
                <Navbar />
                <main className="container py-10 max-w-6xl mx-auto text-center">
                    <p className="text-muted-foreground">Collection not found or you don't have permission to view it.</p>
                </main>
            </>
        );
    }

    const getInitials = (name?: string | null): string => {
        return name?.split(' ').map(n => n[0]).join('').toUpperCase() || '';
    }

    const totalCollaborators = collectionDetails.collaborators.length + 1;

    return (
        <>
            <Navbar />
            <main className="container py-6 sm:py-10 max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8 sm:mb-10">
                    {!isLoggedIn && !isBannerDismissed && (
                        <div className="relative mb-4 sm:mb-6 rounded-xl border border-primary/20 bg-primary/5 p-3.5 sm:p-5">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-2 top-2 h-8 w-8 text-muted-foreground hover:text-foreground sm:hidden"
                                onClick={() => setIsBannerDismissed(true)}
                                aria-label="Dismiss sign-in banner"
                            >
                                <X className="h-4 w-4" />
                            </Button>

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="max-w-2xl pr-10 sm:pr-0">
                                    <p className="text-base sm:text-lg font-medium">Enjoying this collection?</p>
                                    <p className="text-sm sm:text-base text-muted-foreground">Sign in to create and share your own public collections.</p>
                                </div>

                                <div className="mt-1 sm:mt-0 flex w-full sm:w-auto items-center gap-2 self-stretch sm:self-auto shrink-0 sm:justify-end">
                                    <Button onClick={signIn} size="sm" className="gap-2 h-11 sm:h-10 !px-10 sm:!px-7 flex-1 sm:flex-none sm:w-auto">
                                        <span>Create yours</span>
                                        <span className="inline-flex items-center">
                                            <LogIn className="h-4 w-4" />
                                        </span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="hidden sm:inline-flex h-8 w-8 text-muted-foreground hover:text-foreground"
                                        onClick={() => setIsBannerDismissed(true)}
                                        aria-label="Dismiss sign-in banner"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2 leading-tight break-words">{collection.name}</h1>
                    {collection.description && (
                        <p className="text-muted-foreground text-lg mb-4 max-w-2xl">{collection.description}</p>
                    )}
                    
                    <div className="flex items-center gap-4 flex-wrap">
                        {collection.is_public && (
                            <span className="text-[11px] font-medium uppercase tracking-wide text-primary bg-primary/10 px-2 py-1 rounded-full">
                                Public
                            </span>
                        )}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Avatar className="h-6 w-6">
                                <AvatarImage src={collection.owner_avatar} />
                                <AvatarFallback className="text-xs">{getInitials(collection.owner_username)}</AvatarFallback>
                            </Avatar>
                            <span>{collection.owner_username}</span>
                        </div>

                        {canViewMembers && (
                            <>
                                <span className="text-muted-foreground/30">|</span>

                                {/* Collaborators */}
                                <Dialog open={isCollabListOpen} onOpenChange={setIsCollabListOpen}>
                                    <DialogTrigger asChild>
                                        <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                            <div className="flex -space-x-2">
                                                <Avatar className="h-6 w-6 border-2 border-background">
                                                    <AvatarImage src={collection.owner_avatar} />
                                                    <AvatarFallback className="text-xs">{getInitials(collection.owner_username)}</AvatarFallback>
                                                </Avatar>
                                                {collectionDetails.collaborators.slice(0, 2).map((c) => (
                                                    <Avatar key={c.user_id} className="h-6 w-6 border-2 border-background">
                                                        <AvatarImage src={c.avatar_url} />
                                                        <AvatarFallback className="text-xs">{getInitials(c.username)}</AvatarFallback>
                                                    </Avatar>
                                                ))}
                                                {collectionDetails.collaborators.length > 2 && (
                                                    <div className="h-6 w-6 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs">
                                                        +{collectionDetails.collaborators.length - 2}
                                                    </div>
                                                )}
                                            </div>
                                            <span>{totalCollaborators} {totalCollaborators === 1 ? 'member' : 'members'}</span>
                                        </button>
                                    </DialogTrigger>
                                    <DialogContent className="w-[90%] sm:max-w-[400px] rounded-lg">
                                <DialogHeader>
                                    <DialogTitle>Members</DialogTitle>
                                    <DialogDescription>People who can access this collection.</DialogDescription>
                                </DialogHeader>
                                <ScrollArea className="max-h-[300px]">
                                    <div className="space-y-1 py-2">
                                        {/* Owner */}
                                        <div className="flex items-center justify-between gap-3 p-2 rounded-lg">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-9 w-9">
                                                    <AvatarImage src={collection.owner_avatar} />
                                                    <AvatarFallback>{getInitials(collection.owner_username)}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="text-sm font-medium">{collection.owner_username ?? 'Owner'}</p>
                                                    <p className="text-xs text-muted-foreground">Owner</p>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {/* Collaborators */}
                                        {collectionDetails.collaborators.map((c) => {
                                            const isCurrentUser = c.user_id === currentUser?.id;
                                            return (
                                                <div key={c.user_id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <Avatar className="h-9 w-9">
                                                            <AvatarImage src={c.avatar_url} />
                                                            <AvatarFallback>{getInitials(c.username)}</AvatarFallback>
                                                        </Avatar>
                                                        <div className="flex flex-col">
                                                            <p className="text-sm font-medium leading-tight">{c.username ?? c.email}{isCurrentUser && ' (You)'}</p>
                                                            {isOwner ? (
                                                                <Select 
                                                                    value={c.permission} 
                                                                    onValueChange={(value: 'view' | 'edit') => {
                                                                        updateCollaboratorMutation.mutate({ 
                                                                            collectionId: collectionId!, 
                                                                            userId: c.user_id, 
                                                                            data: { permission: value } 
                                                                        });
                                                                    }}
                                                                    disabled={updateCollaboratorMutation.isPending && updateCollaboratorMutation.variables?.userId === c.user_id}
                                                                >
                                                                    <SelectTrigger
                                                                        size="sm"
                                                                        className="h-5 w-fit border-0 bg-transparent px-0 py-0 gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-transparent data-[state=open]:bg-transparent shadow-none focus:ring-0 focus-visible:ring-0 justify-start"
                                                                    >
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="edit">Edit</SelectItem>
                                                                        <SelectItem value="view">View</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            ) : (
                                                                <p className="text-xs text-muted-foreground capitalize">{c.permission}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        {isCurrentUser && !isOwner ? (
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive gap-1">
                                                                        {leaveCollectionMutation.isPending 
                                                                            ? <Loader2 className="h-3 w-3 animate-spin" /> 
                                                                            : <LogOut className="h-3 w-3" />}
                                                                        Leave
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent className="w-[90%] sm:max-w-[400px] rounded-lg">
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Leave collection?</AlertDialogTitle>
                                                                        <AlertDialogDescription>Are you sure you want to leave this collection? You will no longer have access to it.</AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                        <AlertDialogAction 
                                                                            onClick={() => leaveCollectionMutation.mutate({ collectionId: collectionId!, userId: currentUser!.id })} 
                                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                                        >
                                                                            Leave
                                                                        </AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        ) : isOwner && (
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                                                        {(removeCollaboratorMutation.isPending && removeCollaboratorMutation.variables?.userId === c.user_id) 
                                                                            ? <Loader2 className="h-4 w-4 animate-spin" /> 
                                                                            : <UserMinus className="h-4 w-4" />}
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent className="w-[90%] sm:max-w-[400px] rounded-lg">
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Remove member?</AlertDialogTitle>
                                                                        <AlertDialogDescription>Remove {c.username ?? c.email} from this collection?</AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                        <AlertDialogAction 
                                                                            onClick={() => removeCollaboratorMutation.mutate({ collectionId: collectionId!, userId: c.user_id })} 
                                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                                        >
                                                                            Remove
                                                                        </AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </ScrollArea>
                                <DialogFooter className="flex-row gap-2 sm:justify-between">
                                    {isOwner && (
                                        <Dialog open={isAddCollabOpen} onOpenChange={setIsAddCollabOpen}>
                                            <DialogTrigger asChild>
                                                <Button variant="secondary" size="sm" className="gap-1.5">
                                                    <UserPlus className="h-4 w-4" />
                                                    Add
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent className="w-[90%] sm:max-w-[400px] rounded-lg">
                                                <form onSubmit={handleSubmitCollab(onAddCollaborator)}>
                                                    <DialogHeader>
                                                        <DialogTitle>Add Member</DialogTitle>
                                                        <DialogDescription>Invite someone by email.</DialogDescription>
                                                    </DialogHeader>
                                                    <div className="py-4 space-y-4">
                                                        <div className="space-y-2">
                                                            <Label htmlFor="collab-email">Email</Label>
                                                            <Input 
                                                                id="collab-email" 
                                                                type="email" 
                                                                placeholder="name@example.com"
                                                                {...registerCollab("email")} 
                                                                aria-invalid={collabErrors.email ? "true" : "false"} 
                                                            />
                                                            {collabErrors.email && <p className="text-destructive text-sm">{collabErrors.email.message}</p>}
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="collab-permission">Role</Label>
                                                            <Select 
                                                                value={watchCollab("permission")} 
                                                                onValueChange={(value: 'view' | 'edit') => setCollabValue("permission", value)}
                                                            >
                                                                <SelectTrigger id="collab-permission" className="w-full">
                                                                    <SelectValue placeholder="Select role" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="edit">Edit</SelectItem>
                                                                    <SelectItem value="view">View</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                            <p className="text-xs text-muted-foreground">
                                                                {watchCollab("permission") === 'edit' 
                                                                    ? "Can add items and remove their own items" 
                                                                    : "Can only view the collection"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button type="submit" disabled={addCollaboratorMutation.isPending}>
                                                            {addCollaboratorMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                                                            Add Member
                                                        </Button>
                                                    </DialogFooter>
                                                </form>
                                            </DialogContent>
                                        </Dialog>
                                    )}
                                    <DialogClose asChild>
                                        <Button variant="secondary" size="sm">Done</Button>
                                    </DialogClose>
                                </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </>
                        )}
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <Tabs value={mediaTypeFilter} onValueChange={(value) => {
                            setMediaTypeFilter(value);
                            setVisibleItemsCount(ITEMS_PER_PAGE);
                            setIsLoadingMore(false);
                        }}>
                            <TabsList className="h-9">
                                <TabsTrigger value="all" className="text-xs px-3">All</TabsTrigger>
                                <TabsTrigger value="movie" className="text-xs px-3">Movies</TabsTrigger>
                                <TabsTrigger value="tv" className="text-xs px-3">TV</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        <span className="text-sm text-muted-foreground">{filteredMedia.length} items</span>
                    </div>
                    
                    {canEdit && (
                        <Dialog open={isAddMovieOpen} onOpenChange={setIsAddMovieOpen}>
                            <DialogTrigger asChild>
                                <Button size="sm" className="gap-1.5 px-3.5 has-[>svg]:px-3.5">
                                    <Plus className="h-4 w-4" />
                                    <span className="hidden sm:inline">Add</span>
                                </Button>
                            </DialogTrigger>
                            <AddMovieDialog
                                collectionId={collectionId!}
                                existingMovieIds={movieIds as unknown as string[]}
                                onAddMovie={(movieId) => addMovieMutation.mutate({ collectionId: collectionId!, data: { movieId: movieId as unknown as number } })}
                                isAddingMovie={addMovieMutation.isPending}
                            />
                        </Dialog>
                    )}
                </div>

                {/* Grid */}
                {isLoadingMovies ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {Array.from({ length: collectionDetails.movies.length || 12 }).map((_, i) => (
                            <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
                        ))}
                    </div>
                ) : currentVisibleMedia.length > 0 ? (
                    <Fragment>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                            {currentVisibleMedia.map(movieEntry => {
                                const movie = moviesDetailsMap?.[movieEntry.movie_id];
                                if (!movie) return (
                                    <div key={movieEntry.movie_id} className="relative group">
                                        <Skeleton className="aspect-[2/3] rounded-lg" />
                                    </div>
                                );
                                const isAddedByMember = movieEntry.added_by_user_id === collection.owner_id || 
                                    collectionDetails.collaborators.some(c => c.user_id === movieEntry.added_by_user_id);
                                // Owner can remove any item, edit members can only remove their own items
                                const canRemoveItem = isOwner || movieEntry.added_by_user_id === currentUser?.id;
                                const isItemWatched = watchedMap[String(movieEntry.movie_id)] ?? false;
                                const showRemoveOption = canEdit && canRemoveItem;
                                    return (
                                    <div key={movieEntry.movie_id} className="relative group">
                                        <MovieCard 
                                            movie={movie} 
                                            isWatched={isItemWatched}
                                            additionalMenuItems={showRemoveOption ? (
                                                <DropdownMenuItem
                                                    className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-destructive focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                                                    disabled={removeMovieMutation.isPending && removeMovieMutation.variables?.movieId === movieEntry.movie_id}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        removeMovieMutation.mutate({ collectionId: collectionId!, movieId: movieEntry.movie_id });
                                                    }}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Remove
                                                </DropdownMenuItem>
                                            ) : undefined}
                                        />
                                        {movieEntry.added_by_username && (
                                            <p className="text-xs text-muted-foreground mt-1.5 truncate">
                                                {movieEntry.added_by_username}{!isAddedByMember && <span className="opacity-60"> (left)</span>}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                            {/* Skeleton loaders for infinite scroll - inside the same grid */}
                            {isLoadingMore && Array.from({ length: 6 }).map((_, index) => (
                                <div key={`skeleton-${index}`} className="space-y-3">
                                    <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                                    <Skeleton className="h-4 w-[75%] rounded-md" />
                                    <Skeleton className="h-3 w-[45%] rounded-md" />
                                </div>
                            ))}
                        </div>
                        
                        {/* Infinite scroll trigger */}
                        <div ref={loadMoreRef} />
                    </Fragment>
                ) : (
                    <div className="text-center py-20">
                        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted/50 mb-4">
                            <Film className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-medium mb-1">
                            {mediaTypeFilter === 'all' ? 'No items yet' : `No ${mediaTypeFilter === 'movie' ? 'movies' : 'TV shows'}`}
                        </h3>
                        <p className="text-muted-foreground">
                            {mediaTypeFilter === 'all' 
                                ? 'Add movies and shows to this collection.' 
                                : 'Try a different filter.'}
                        </p>
                    </div>
                )}
            </main>
        </>
    );
};


// --- Add Movie Dialog Component ---
interface AddMovieDialogProps {
    collectionId: string;
    existingMovieIds: string[];
    onAddMovie: (movieId: string) => void;
    isAddingMovie: boolean;
}

const AddMovieDialog: React.FC<AddMovieDialogProps> = ({ collectionId, existingMovieIds, onAddMovie, isAddingMovie }) => {
    const [searchTerm, setSearchTerm] = useState("");
    const debouncedSearchTerm = useDebounce(searchTerm, 500);
    const [selectedMovieId, setSelectedMovieId] = useState<number | string | null>(null);

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
            if (lastPage.page < lastPage.total_pages) { return lastPage.page + 1; }
            return undefined;
        },
        enabled: !!debouncedSearchTerm,
        initialPageParam: 1,
    });

    const handleAddClick = (movieId: string) => {
        setSelectedMovieId(movieId);
        onAddMovie(movieId);
    };

    const movies = searchResultsData?.pages.flatMap(page => page.results) ?? [];

    return (
        <DialogContent className="w-[90%] sm:max-w-[550px] rounded-lg">
            <DialogHeader>
                <DialogTitle>Add to Collection</DialogTitle>
                <DialogDescription>Search for movies and TV shows.</DialogDescription>
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
                        <div className="text-muted-foreground text-center py-8">No results for "{debouncedSearchTerm}"</div>
                    )}
                    
                    {movies.map((movie, i) => {
                        const movieId = Object.keys(movie).includes('first_air_date') ? (String(movie.id) + 'tv') : movie.id;
                        const alreadyAdded = existingMovieIds.map(m => m).includes(movieId as string);
                        const isCurrentMovieAdding = isAddingMovie && selectedMovieId === movieId;
                        
                        return (
                            <div 
                                key={movie.id + i} 
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
                                    </p>
                                </div>
                                <Button 
                                    size="icon" 
                                    variant={alreadyAdded ? "secondary" : "default"} 
                                    onClick={() => handleAddClick(movieId as string)} 
                                    disabled={alreadyAdded || isCurrentMovieAdding || isAddingMovie}
                                    className="shrink-0 h-8 w-8"
                                >
                                    {isCurrentMovieAdding ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : alreadyAdded ? (
                                        <Check className="h-4 w-4" />
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

export default CollectionDetail;
