import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUserCollectionsApi, updateUserPreferencesApi, fetchRecommendationCollectionsApi, setRecommendationCollectionsApi, fetchUserPreferencesApi, fetchWatchedItemsApi, fetchNotInterestedItemsApi, uploadAvatarApi, removeAvatarApi, fetchCurrentUserApi } from '@/lib/api';
import { UserCollectionsResponse, UpdateUserPreferencesInput, RecommendationCollectionsResponse, UserPreferences } from '@/lib/types';
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/useAuth';
import { Mail, Calendar, Sparkles, FolderHeart, X, ChevronDown, Grid3X3, Eye, ThumbsDown, ArrowRight, Database, Camera, Loader2, Trash2 } from 'lucide-react';
import { toast } from "sonner";
import { Link } from 'react-router-dom';
import { getForYouInfiniteQueryOptions, getForYouRecommendationsQueryKey, getPreferencesQueryKey } from '@/lib/recommendationQueries';

// ============================================================================
// Image helpers
// ============================================================================
const MAX_IMAGE_SIZE = 512; // max width/height in px
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function resizeImageToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;

                // Scale down to fit within MAX_IMAGE_SIZE
                if (width > MAX_IMAGE_SIZE || height > MAX_IMAGE_SIZE) {
                    if (width > height) {
                        height = Math.round((height * MAX_IMAGE_SIZE) / width);
                        width = MAX_IMAGE_SIZE;
                    } else {
                        width = Math.round((width * MAX_IMAGE_SIZE) / height);
                        height = MAX_IMAGE_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Canvas not supported'));
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/webp', 0.8));
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = reader.result as string;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

const COLLECTIONS_QUERY_KEY = ['collections', 'user'];
const USER_QUERY_KEY = ['user'];
const USER_ME_QUERY_KEY = ['user', 'me'];
const RECOMMENDATION_COLLECTIONS_QUERY_KEY = ['recommendations', 'collections'];
const WATCHED_ITEMS_QUERY_KEY = ['collections', 'watched', 'items'];
const NOT_INTERESTED_ITEMS_QUERY_KEY = ['collections', 'not-interested', 'items'];

const Profile = () => {
    const queryClient = useQueryClient();
    const { user, isLoadingUser } = useAuth();
    const preferencesQueryKey = getPreferencesQueryKey(user?.id);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

    // Fetch full user data from /me (includes avatarUrl for custom uploads)
    const { data: meData } = useQuery({
        queryKey: USER_ME_QUERY_KEY,
        queryFn: fetchCurrentUserApi,
        enabled: !!user,
    });

    // Resolved avatar: custom upload > Google/OAuth image from DB > session image > null
    const resolvedAvatarUrl = meData?.user?.avatarUrl || meData?.user?.image || user?.avatarUrl || user?.image || undefined;

    // Fetch user preferences separately (not from session)
    const {
        data: preferencesData,
        isLoading: isLoadingPreferences,
    } = useQuery<{ preferences: UserPreferences }, Error>({
        queryKey: preferencesQueryKey,
        queryFn: fetchUserPreferencesApi,
        enabled: !!user,
    });

    // Fetch user's collections for the recommendation source selector
    const {
        data: collectionsData,
        isLoading: isLoadingCollections,
    } = useQuery<UserCollectionsResponse, Error>({
        queryKey: COLLECTIONS_QUERY_KEY,
        queryFn: fetchUserCollectionsApi,
        enabled: !!user,
    });

    // Fetch user's selected recommendation collections
    const {
        data: recommendationCollectionsData,
        isLoading: isLoadingRecommendationCollections,
    } = useQuery<RecommendationCollectionsResponse, Error>({
        queryKey: RECOMMENDATION_COLLECTIONS_QUERY_KEY,
        queryFn: fetchRecommendationCollectionsApi,
        enabled: !!user && (preferencesData?.preferences?.recommendations_enabled ?? false),
    });

    const {
        data: watchedItemsData,
        isLoading: isLoadingWatchedItems,
    } = useQuery({
        queryKey: WATCHED_ITEMS_QUERY_KEY,
        queryFn: fetchWatchedItemsApi,
        enabled: !!user,
    });

    const {
        data: notInterestedItemsData,
        isLoading: isLoadingNotInterestedItems,
    } = useQuery({
        queryKey: NOT_INTERESTED_ITEMS_QUERY_KEY,
        queryFn: fetchNotInterestedItemsApi,
        enabled: !!user,
    });

    // Mutation for updating preferences with optimistic updates
    const updatePreferencesMutation = useMutation({
        mutationFn: updateUserPreferencesApi,
        onMutate: async (newPreferences) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: preferencesQueryKey });
            
            // Snapshot previous value
            const previousPreferences = queryClient.getQueryData<{ preferences: UserPreferences }>(preferencesQueryKey);
            
            // Optimistically update
            queryClient.setQueryData(preferencesQueryKey, (old: { preferences: UserPreferences } | undefined) => ({
                preferences: {
                    ...old?.preferences,
                    ...newPreferences,
                }
            }));
            
            return { previousPreferences };
        },
        onError: (error: Error, _, context) => {
            // Rollback on error
            if (context?.previousPreferences) {
                queryClient.setQueryData(preferencesQueryKey, context.previousPreferences);
            }
            toast.error(`Failed to update preferences`);
        },
    });

    // Mutation for updating recommendation collections with optimistic updates
    const setRecommendationCollectionsMutation = useMutation({
        mutationFn: setRecommendationCollectionsApi,
        onMutate: async (newCollectionIds: string[]) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: RECOMMENDATION_COLLECTIONS_QUERY_KEY });
            
            // Snapshot previous value
            const previousCollections = queryClient.getQueryData<RecommendationCollectionsResponse>(RECOMMENDATION_COLLECTIONS_QUERY_KEY);
            
            // Optimistically update - we need to construct the new collections array
            // We'll use the collectionsData to get the collection details
            const allCollections = collectionsData?.collections || [];
            const newCollections = allCollections.filter(c => newCollectionIds.includes(c.id));
            
            queryClient.setQueryData(RECOMMENDATION_COLLECTIONS_QUERY_KEY, {
                collections: newCollections
            });
            
            return { previousCollections };
        },
        onError: (error: Error, _, context) => {
            // Rollback on error
            if (context?.previousCollections) {
                queryClient.setQueryData(RECOMMENDATION_COLLECTIONS_QUERY_KEY, context.previousCollections);
            }
            toast.error(`Failed to update collections`);
        },
        onSuccess: () => {
            if (!user?.id) return;
            queryClient.invalidateQueries({ queryKey: getForYouRecommendationsQueryKey(user.id) });
        },
    });

    const handleToggleRecommendations = (enabled: boolean) => {
        const updateData: UpdateUserPreferencesInput = {
            recommendations_enabled: enabled,
        };
        // If disabling, also clear the collection and disable category recommendations
        if (!enabled) {
            updateData.recommendations_collection_id = null;
            updateData.category_recommendations_enabled = false;
        } else {
            // Auto-enable category recommendations when enabling main recommendations
            updateData.category_recommendations_enabled = true;
        }
        updatePreferencesMutation.mutate(updateData, {
            onSuccess: () => {
                if (!user?.id) return;

                if (enabled) {
                    queryClient.invalidateQueries({ queryKey: getForYouRecommendationsQueryKey(user.id) });
                    void queryClient.prefetchInfiniteQuery(getForYouInfiniteQueryOptions(user.id));
                    return;
                }

                queryClient.removeQueries({ queryKey: getForYouRecommendationsQueryKey(user.id) });
            },
        });
        
        // If enabling, refetch recommendation collections
        if (enabled) {
            queryClient.invalidateQueries({ queryKey: RECOMMENDATION_COLLECTIONS_QUERY_KEY });
        }
    };

    const handleToggleCategoryRecommendations = (enabled: boolean) => {
        updatePreferencesMutation.mutate({
            category_recommendations_enabled: enabled,
        });
    };

    const handleCollectionToggle = (collectionId: string, isChecked: boolean) => {
        const currentIds = recommendationCollectionsData?.collections.map(c => c.id) || [];
        let newIds: string[];
        
        if (isChecked) {
            newIds = [...currentIds, collectionId];
        } else {
            newIds = currentIds.filter(id => id !== collectionId);
        }
        
        setRecommendationCollectionsMutation.mutate(newIds);
    };

    const handleRemoveCollection = (collectionId: string) => {
        const currentIds = recommendationCollectionsData?.collections.map(c => c.id) || [];
        const newIds = currentIds.filter(id => id !== collectionId);
        setRecommendationCollectionsMutation.mutate(newIds);
    };

    const formatDate = (dateString: string | Date | undefined) => {
        if (!dateString) return 'Unknown';
        return new Date(dateString).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const getInitials = (name: string | null | undefined) => {
        if (!name) return 'U';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset file input so the same file can be re-selected
        e.target.value = '';

        if (!ACCEPTED_TYPES.includes(file.type)) {
            toast.error('Please select a JPEG, PNG, WebP, or GIF image.');
            return;
        }

        if (file.size > MAX_FILE_SIZE) {
            toast.error('Image must be under 5 MB.');
            return;
        }

        setIsUploadingAvatar(true);
        try {
            const dataUrl = await resizeImageToDataUrl(file);
            await uploadAvatarApi(dataUrl);
            toast.success('Profile picture updated!');
            queryClient.invalidateQueries({ queryKey: USER_ME_QUERY_KEY });
        } catch {
            toast.error('Failed to update profile picture.');
        } finally {
            setIsUploadingAvatar(false);
        }
    };

    const handleRemoveAvatar = async () => {
        setIsUploadingAvatar(true);
        try {
            await removeAvatarApi();
            toast.success('Profile picture removed.');
            queryClient.invalidateQueries({ queryKey: USER_ME_QUERY_KEY });
        } catch {
            toast.error('Failed to remove profile picture.');
        } finally {
            setIsUploadingAvatar(false);
        }
    };

    if (isLoadingUser) {
        return (
            <>
                <Navbar />
                <main className="container py-8 max-w-2xl mx-auto">
                    <div className="space-y-6">
                        <Skeleton className="h-32 w-full rounded-xl" />
                        <Skeleton className="h-48 w-full rounded-xl" />
                    </div>
                </main>
            </>
        );
    }

    if (!user) {
        return (
            <>
                <Navbar />
                <main className="container py-8 max-w-2xl mx-auto">
                    <div className="text-center py-12">
                        <p className="text-muted-foreground">Please log in to view your profile.</p>
                    </div>
                </main>
            </>
        );
    }

    const recommendationsEnabled = preferencesData?.preferences?.recommendations_enabled ?? false;
    const categoryRecommendationsEnabled = preferencesData?.preferences?.category_recommendations_enabled ?? false;
    const selectedCollectionIds = new Set(recommendationCollectionsData?.collections.map(c => c.id) || []);
    const isLoading = isLoadingCollections || isLoadingRecommendationCollections || isLoadingPreferences;
    const watchedItemsCount = watchedItemsData?.items.length ?? 0;
    const notInterestedItemsCount = notInterestedItemsData?.items.length ?? 0;
    const canAccessRecommendationCacheDebug = user.email?.toLowerCase() === 'murtuza.creativity@gmail.com';

    return (
        <>
            <Navbar />
            <main className="container py-8 max-w-2xl mx-auto px-4">
                <h1 className="text-3xl font-bold mb-8">Profile</h1>

                {/* User Info Card */}
                <Card className="mb-6">
                    <CardContent>
                        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
                            {/* Editable avatar */}
                            <div className="relative group shrink-0">
                                <Avatar className="h-20 w-20">
                                    <AvatarImage
                                        src={resolvedAvatarUrl}
                                        alt={user.username || user.name || 'User'}
                                        referrerPolicy="no-referrer"
                                    />
                                    <AvatarFallback className="text-lg">
                                        {getInitials(user.username)}
                                    </AvatarFallback>
                                </Avatar>

                                {/* Upload overlay */}
                                <button
                                    type="button"
                                    onClick={handleAvatarClick}
                                    disabled={isUploadingAvatar}
                                    className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-wait"
                                    aria-label="Change profile picture"
                                >
                                    {isUploadingAvatar ? (
                                        <Loader2 className="h-5 w-5 text-white animate-spin" />
                                    ) : (
                                        <Camera className="h-5 w-5 text-white" />
                                    )}
                                </button>

                                {/* Hidden file input */}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                    className="hidden"
                                    onChange={handleFileChange}
                                />

                                {/* Remove button (only when there's a custom uploaded avatar) */}
                                {meData?.user?.avatarUrl && (
                                    <button
                                        type="button"
                                        onClick={handleRemoveAvatar}
                                        disabled={isUploadingAvatar}
                                        className="absolute -bottom-1 -right-1 rounded-full bg-destructive p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-wait"
                                        aria-label="Remove profile picture"
                                    >
                                        <Trash2 className="h-3 w-3 text-white" />
                                    </button>
                                )}
                            </div>

                            <div className="flex-1 min-w-0 space-y-1 text-center sm:text-left w-full">
                                <h2 className="text-2xl font-semibold">
                                    {user.username || 'User'}
                                </h2>
                                <div className="flex items-center justify-center sm:justify-start gap-2 text-muted-foreground">
                                    <Mail className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{user.email || 'No email'}</span>
                                </div>
                                {user.createdAt && (
                                    <div className="flex items-center justify-center sm:justify-start gap-2 text-muted-foreground text-sm">
                                        <Calendar className="h-4 w-4 shrink-0" />
                                        <span>Joined {formatDate(user.createdAt)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Recommendations Settings Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5" />
                            Recommendations
                            <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                Beta
                            </span>
                        </CardTitle>
                        <CardDescription>
                            Get personalized movie and TV show recommendations based on your collections.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Enable Recommendations Toggle */}
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="recommendations-toggle" className="text-base">
                                    Enable Recommendations
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Receive personalized suggestions based on your taste
                                </p>
                            </div>
                            <Switch
                                id="recommendations-toggle"
                                checked={recommendationsEnabled}
                                onCheckedChange={handleToggleRecommendations}
                            />
                        </div>

                        {recommendationsEnabled && (
                            <>
                                <Separator />

                                {/* Collection Multi-Select Dropdown */}
                                <div className="space-y-3">
                                    <div className="space-y-0.5">
                                        <Label className="text-base flex items-center gap-2">
                                            <FolderHeart className="h-4 w-4" />
                                            Source Collections
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            Select one or more collections to base your recommendations on
                                        </p>
                                    </div>

                                    {isLoading ? (
                                        <Skeleton className="h-10 w-full" />
                                    ) : collectionsData?.collections.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-4">
                                            You don't have any collections yet. Create one to enable personalized recommendations.
                                        </p>
                                    ) : (
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    role="combobox"
                                                    className="w-full justify-between h-auto min-h-10 py-2"
                                                >
                                                    <span className="flex flex-wrap gap-1 text-left">
                                                        {selectedCollectionIds.size === 0 ? (
                                                            <span className="text-muted-foreground">Select collections...</span>
                                                        ) : (
                                                            <span className="text-sm">
                                                                {selectedCollectionIds.size} collection{selectedCollectionIds.size !== 1 ? 's' : ''} selected
                                                            </span>
                                                        )}
                                                    </span>
                                                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                                                <div className="max-h-64 overflow-y-auto p-2">
                                                    {collectionsData?.collections.map((collection) => {
                                                        const isSelected = selectedCollectionIds.has(collection.id);
                                                        return (
                                                            <div
                                                                key={collection.id}
                                                                className="flex items-center space-x-3 py-2 px-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                                                                onClick={() => handleCollectionToggle(collection.id, !isSelected)}
                                                            >
                                                                <Checkbox
                                                                    id={`collection-${collection.id}`}
                                                                    checked={isSelected}
                                                                    onCheckedChange={(checked) =>
                                                                        handleCollectionToggle(collection.id, checked === true)
                                                                    }
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                                <label
                                                                    htmlFor={`collection-${collection.id}`}
                                                                    className="flex-1 text-sm font-medium cursor-pointer select-none"
                                                                >
                                                                    {collection.name}
                                                                </label>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </PopoverContent>
                                        </Popover>
                                    )}

                                    {/* Selected Collections Display */}
                                    {selectedCollectionIds.size > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {recommendationCollectionsData?.collections.map((collection) => (
                                                <Badge
                                                    key={collection.id}
                                                    variant="secondary"
                                                    className="flex items-center gap-1 pr-1"
                                                >
                                                    {collection.name}
                                                    <button
                                                        onClick={() => handleRemoveCollection(collection.id)}
                                                        className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <Separator />

                                {/* Category Recommendations Toggle */}
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label htmlFor="category-recommendations-toggle" className="text-base flex items-center gap-2">
                                            <Grid3X3 className="h-4 w-4" />
                                            Personalized Categories
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            Show personalized recommendations on the Categories page based on your taste
                                        </p>
                                    </div>
                                    <Switch
                                        id="category-recommendations-toggle"
                                        checked={categoryRecommendationsEnabled}
                                        onCheckedChange={handleToggleCategoryRecommendations}
                                        disabled={selectedCollectionIds.size === 0}
                                    />
                                </div>
                                {selectedCollectionIds.size === 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        Select at least one source collection to enable personalized categories
                                    </p>
                                )}

                                {canAccessRecommendationCacheDebug && (
                                    <>
                                        <Separator />
                                        <Button asChild variant="outline" className="w-full h-11 justify-between">
                                            <Link to="/recommendations/debug-cache">
                                                <span className="inline-flex items-center gap-2">
                                                    <Database className="h-4 w-4" />
                                                    Recommendation Cache Debug
                                                </span>
                                                <ArrowRight className="h-4 w-4" />
                                            </Link>
                                        </Button>
                                    </>
                                )}
                            </>
                        )}


                    </CardContent>
                </Card>

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle>Marked Items</CardTitle>
                        <CardDescription>
                            Review everything you have marked as watched or not interested.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button asChild variant="outline" className="w-full h-11 justify-between">
                            <Link to="/watched">
                                <span className="inline-flex items-center gap-2">
                                    <Eye className="h-4 w-4" />
                                    Watched Items
                                </span>
                                <span className="inline-flex items-center gap-2 text-muted-foreground">
                                    {isLoadingWatchedItems ? '...' : watchedItemsCount}
                                    <ArrowRight className="h-4 w-4" />
                                </span>
                            </Link>
                        </Button>

                        <Button asChild variant="outline" className="w-full h-11 justify-between">
                            <Link to="/not-interested">
                                <span className="inline-flex items-center gap-2">
                                    <ThumbsDown className="h-4 w-4" />
                                    Not Interested Items
                                </span>
                                <span className="inline-flex items-center gap-2 text-muted-foreground">
                                    {isLoadingNotInterestedItems ? '...' : notInterestedItemsCount}
                                    <ArrowRight className="h-4 w-4" />
                                </span>
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            </main>
        </>
    );
};

export default Profile;
