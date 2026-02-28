import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUserCollectionsApi, createCollectionApi, deleteCollectionApi, updateCollectionApi, fetchMovieDetailsApi, fetchTvDetailsApi } from '@/lib/api';
import { UserCollectionsResponse, CreateCollectionInput, CollectionSummary, UpdateCollectionInput, MovieDetails } from '@/lib/types';
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { Plus, Film, Loader2, MoreHorizontal, Trash2, Copy, Edit } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { toast } from "sonner";
import { useAuth } from '@/hooks/useAuth';
import { getImageUrl } from '@/lib/api';

const frontendCreateCollectionSchema = z.object({
  name: z.string().min(1, "Collection name cannot be empty").max(255),
  description: z.string().max(1000).optional(),
  is_public: z.boolean().default(false),
});
type FrontendCreateCollectionInput = z.input<typeof frontendCreateCollectionSchema>;

const frontendUpdateCollectionSchema = z.object({
  name: z.string().min(1, "Collection name cannot be empty").max(255),
  description: z.string().max(1000).optional().nullable(),
  is_public: z.boolean().default(false),
});
type FrontendUpdateCollectionInput = z.input<typeof frontendUpdateCollectionSchema>;

const COLLECTIONS_QUERY_KEY = ['collections', 'user'];

// Component to display movie poster collage
const CollectionPreview = ({ movieIds }: { movieIds?: (number | string)[] }) => {
  // Fetch movie details for up to 4 movies
  const { data: moviesData } = useQuery({
    queryKey: ['preview-movies', movieIds],
    queryFn: async () => {
      if (!movieIds || movieIds.length === 0) return [];
      const promises = movieIds.slice(0, 4).map((id) => {
        const idStr = String(id);
        if (idStr.includes('tv')) {
          const numericId = parseInt(idStr.replace('tv', ''), 10);
          return fetchTvDetailsApi(numericId).catch(() => null);
        } else {
          return fetchMovieDetailsApi(Number(id)).catch(() => null);
        }
      });
      return Promise.all(promises);
    },
    enabled: !!movieIds && movieIds.length > 0,
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  const posters = moviesData?.filter(Boolean).map(m => m?.poster_path) ?? [];
  
  if (posters.length === 0) {
    return (
      <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <Film className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (posters.length === 1) {
    return (
      <div className="h-14 w-14 rounded-lg overflow-hidden shrink-0 bg-muted">
        <img 
          src={getImageUrl(posters[0], 'w92')} 
          alt="" 
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  // 2 posters - side by side (2 columns)
  if (posters.length === 2) {
    return (
      <div className="h-14 w-14 rounded-lg overflow-hidden shrink-0 grid grid-cols-2 gap-0.5 bg-muted">
        {posters.map((poster, i) => (
          <div key={i} className="overflow-hidden bg-muted">
            <img 
              src={getImageUrl(poster, 'w92')} 
              alt="" 
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>
    );
  }

  // 3 posters - 1 large on left, 2 stacked on right
  if (posters.length === 3) {
    return (
      <div className="h-14 w-14 rounded-lg overflow-hidden shrink-0 grid grid-cols-2 gap-0.5 bg-muted">
        <div className="row-span-2 overflow-hidden bg-muted">
          <img 
            src={getImageUrl(posters[0], 'w92')} 
            alt="" 
            className="h-full w-full object-cover"
          />
        </div>
        <div className="overflow-hidden bg-muted">
          <img 
            src={getImageUrl(posters[1], 'w92')} 
            alt="" 
            className="h-full w-full object-cover"
          />
        </div>
        <div className="overflow-hidden bg-muted">
          <img 
            src={getImageUrl(posters[2], 'w92')} 
            alt="" 
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    );
  }

  // 4 posters - 2x2 grid
  return (
    <div className="h-14 w-14 rounded-lg overflow-hidden shrink-0 grid grid-cols-2 grid-rows-2 gap-0.5 bg-muted">
      {posters.slice(0, 4).map((poster, i) => (
        <div key={i} className="overflow-hidden bg-muted">
          <img 
            src={getImageUrl(poster, 'w92')} 
            alt="" 
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
};

const Collections = () => {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<CollectionSummary | null>(null);
  const [deleteAlertOpen, setDeleteAlertOpen] = useState<string | null>(null);

  const { 
    data: collectionsData,
    isLoading,
    isError,
    error 
  } = useQuery<UserCollectionsResponse, Error>({
    queryKey: COLLECTIONS_QUERY_KEY,
    queryFn: fetchUserCollectionsApi,
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FrontendCreateCollectionInput>({
    resolver: zodResolver(frontendCreateCollectionSchema),
    defaultValues: {
      is_public: false,
    }
  });

  const createMutation = useMutation<{
    collection: CollectionSummary
  }, Error, CreateCollectionInput>({
    mutationFn: createCollectionApi,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: COLLECTIONS_QUERY_KEY });
      toast.success(`Collection "${data.collection.name}" created!`);
      reset();
      setValue('is_public', false);
      setIsCreateDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Failed to create collection: ${error.message}`);
    }
  });

  const onSubmit = (formData: FrontendCreateCollectionInput) => {
    createMutation.mutate(formData as CreateCollectionInput);
  };

  const deleteCollectionMutation = useMutation<void, Error, string>({
    mutationFn: deleteCollectionApi,
    onSuccess: () => {
      toast.success("Collection deleted successfully!");
      queryClient.invalidateQueries({ queryKey: COLLECTIONS_QUERY_KEY });
      setDeleteAlertOpen(null);
    },
    onError: (error) => {
      toast.error(`Failed to delete collection: ${error.message}`);
    }
  });

  const { register: registerEdit, handleSubmit: handleSubmitEdit, reset: resetEdit, setValue: setEditValue, watch: watchEdit, formState: { errors: editErrors } } = useForm<FrontendUpdateCollectionInput>({
    resolver: zodResolver(frontendUpdateCollectionSchema),
    defaultValues: {
      is_public: false,
    }
  });

  const editCollectionMutation = useMutation<{ collection: CollectionSummary }, Error, { collectionId: string; data: UpdateCollectionInput }>({
    mutationFn: async ({ collectionId, data }) => {
      await updateCollectionApi(collectionId, data);
      return {} as { collection: CollectionSummary };
    },
    onSuccess: () => {
      toast.success("Collection updated.");
      queryClient.invalidateQueries({ queryKey: COLLECTIONS_QUERY_KEY });
      setIsEditDialogOpen(false);
      setEditingCollection(null);
      resetEdit();
    },
    onError: (error) => {
      toast.error(`Failed to update collection: ${error.message}`);
    }
  });

  const onEditCollection = (formData: FrontendUpdateCollectionInput) => {
    if (!editingCollection) return;
    const dataToSend = { ...formData, description: formData.description || null };
    editCollectionMutation.mutate({ collectionId: editingCollection.id, data: dataToSend });
  };

  const handleEditClick = (collection: CollectionSummary) => {
    setEditingCollection(collection);
    setEditValue("name", collection.name);
    setEditValue("description", collection.description ?? '');
    setEditValue("is_public", Boolean(collection.is_public));
    setIsEditDialogOpen(true);
  };

  const copyCollectionLink = (collectionId: string) => {
    const link = `${window.location.origin}/collection/${collectionId}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success("Link copied to clipboard!");
    }, (err) => {
      toast.error("Failed to copy link.");
      console.error('Could not copy text: ', err);
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const isCreatePublic = watch('is_public');
  const isEditPublic = watchEdit('is_public');

  return (
    <>
      <Navbar />
      <main className="container py-10 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-end mb-10">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight mb-1">Collections</h1>
            <p className="text-muted-foreground">Organize your favorite movies and shows</p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Collection</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[90%] sm:max-w-[425px] rounded-lg">
              <form onSubmit={handleSubmit(onSubmit)}>
                <DialogHeader>
                  <DialogTitle>Create Collection</DialogTitle>
                  <DialogDescription>
                    Add a new collection to organize your movies.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-5">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input 
                      id="name"
                      placeholder="My Favorites"
                      {...register("name")}
                      aria-invalid={errors.name ? "true" : "false"}
                    />
                    {errors.name && <p className="text-destructive text-sm">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Textarea 
                      id="description"
                      placeholder="A brief description..."
                      {...register("description")}
                      className="resize-none"
                      rows={3}
                      aria-invalid={errors.description ? "true" : "false"}
                    />
                    {errors.description && <p className="text-destructive text-sm">{errors.description.message}</p>}
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="is-public" className="text-sm font-medium">Public collection</Label>
                        <p className="text-xs text-muted-foreground">
                          Anyone with the link can view. Only members can edit.
                        </p>
                      </div>
                      <Switch
                        id="is-public"
                        checked={Boolean(isCreatePublic)}
                        onCheckedChange={(checked) => setValue('is_public', checked)}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 p-4 rounded-xl bg-muted/40">
                <Skeleton className="h-14 w-14 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="h-8 w-8 rounded-md" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="text-center py-20">
            <p className="text-destructive">Error loading collections: {error.message}</p>
          </div>
        ) : collectionsData?.collections && collectionsData.collections.length > 0 ? (
          <div className="space-y-3">
            {collectionsData.collections.map((collection) => {
              const isOwner = collection.owner_id === currentUser?.id;
              return (
                <div key={collection.id} className="group relative">
                  <Link 
                    to={`/collection/${collection.id}`}
                    className="flex items-center gap-4 p-4 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all duration-200"
                  >
                    {/* Preview Collage */}
                    <CollectionPreview movieIds={collection.preview_movie_ids} />
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0 pr-12">
                      <h3 className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {collection.name}
                      </h3>
                      <div className="flex items-center gap-2 min-w-0">
                        {collection.is_public && (
                          <span className="text-[11px] font-medium uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                            Public
                          </span>
                        )}
                        <p className="text-sm text-muted-foreground truncate">
                          {collection.description || `Created ${formatDate(collection.created_at)}`}
                        </p>
                      </div>
                    </div>
                  </Link>

                  {/* Dropdown Menu - Always visible */}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.preventDefault()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => copyCollectionLink(collection.id)} className="cursor-pointer">
                          <Copy className="mr-2 h-4 w-4" />
                          Copy Link
                        </DropdownMenuItem>
                        {isOwner && (
                          <>
                            <DropdownMenuItem onClick={() => handleEditClick(collection)} className="cursor-pointer">
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive cursor-pointer"
                              onClick={() => setDeleteAlertOpen(collection.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Delete Confirmation Dialog */}
                  <AlertDialog open={deleteAlertOpen === collection.id} onOpenChange={(open) => !open && setDeleteAlertOpen(null)}>
                    <AlertDialogContent className="w-[90%] sm:max-w-md rounded-lg">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete collection?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete "<span className="font-medium text-foreground">{collection.name}</span>" and cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteCollectionMutation.mutate(collection.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={deleteCollectionMutation.isPending}
                        >
                          {deleteCollectionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted/50 mb-4">
              <Film className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-1">No collections yet</h3>
            <p className="text-muted-foreground mb-6">
              Create your first collection to start organizing.
            </p>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> New Collection
                </Button>
              </DialogTrigger>
            </Dialog>
          </div>
        )}

        {/* Edit Collection Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) {
            setEditingCollection(null);
            resetEdit();
          }
        }}>
          <DialogContent className="w-[90%] sm:max-w-[425px] rounded-lg">
            <form onSubmit={handleSubmitEdit(onEditCollection)}>
              <DialogHeader>
                <DialogTitle>Edit Collection</DialogTitle>
                <DialogDescription>Update your collection details.</DialogDescription>
              </DialogHeader>
                <div className="grid gap-4 py-5">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input id="edit-name" {...registerEdit("name")} aria-invalid={editErrors.name ? "true" : "false"} />
                  {editErrors.name && <p className="text-destructive text-sm">{editErrors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-description">Description</Label>
                  <Textarea id="edit-description" className="resize-none" rows={3} {...registerEdit("description")} aria-invalid={editErrors.description ? "true" : "false"} />
                  {editErrors.description && <p className="text-destructive text-sm">{editErrors.description.message}</p>}
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="edit-is-public" className="text-sm font-medium">Public collection</Label>
                      <p className="text-xs text-muted-foreground">
                        Anyone with the link can view. Only members can edit.
                      </p>
                    </div>
                    <Switch
                      id="edit-is-public"
                      checked={Boolean(isEditPublic)}
                      onCheckedChange={(checked) => setEditValue('is_public', checked)}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={editCollectionMutation.isPending}>
                  {editCollectionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </main>
    </>
  );
};

export default Collections;
