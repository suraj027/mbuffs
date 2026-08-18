import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchUserCollectionsApi } from '@/lib/api';
import { CollectionSummary } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Check, FolderPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CollectionPreview } from '@/components/collection/CollectionPreview';

interface CollectionPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: 'copy' | 'move';
  itemCount: number;
  sourceCollectionId: string;
  isProcessing: boolean;
  onConfirm: (targetCollectionId: string) => void;
}

export const CollectionPickerDialog: React.FC<CollectionPickerDialogProps> = ({
  open,
  onOpenChange,
  action,
  itemCount,
  sourceCollectionId,
  isProcessing,
  onConfirm,
}) => {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  // Reset the picked target as the dialog closes so it opens fresh next time
  const handleOpenChange = (next: boolean) => {
    if (!next) setSelectedTarget(null);
    onOpenChange(next);
  };

  const { data: collectionsData, isLoading } = useQuery<{ collections: CollectionSummary[] }, Error>({
    queryKey: ['collections'],
    queryFn: fetchUserCollectionsApi,
    enabled: open,
    staleTime: 1000 * 60 * 2,
  });

  const eligibleCollections = (collectionsData?.collections ?? []).filter(
    (c) =>
      c.id !== sourceCollectionId &&
      (c.user_permission === 'owner' || c.user_permission === 'edit')
  );

  const itemLabel = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[90%] sm:max-w-[420px] rounded-lg gap-4">
        <DialogHeader>
          <DialogTitle>{action === 'move' ? 'Move' : 'Copy'} {itemLabel}</DialogTitle>
          <DialogDescription>
            {action === 'move'
              ? 'Pick a collection. Items are removed from here.'
              : 'Pick a collection. Duplicates are skipped.'}
          </DialogDescription>
        </DialogHeader>

        {/* Fixed-height body prevents layout shift between loading / empty / list */}
        <div className="flex min-h-[220px] flex-col">
          {isLoading ? (
            <div className="space-y-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/2 rounded" />
                    <Skeleton className="h-3 w-1/4 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : eligibleCollections.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
                <FolderPlus className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="max-w-[260px] text-sm text-muted-foreground">
                No other collection you can edit. Create one first.
              </p>
            </div>
          ) : (
            <ScrollArea className="-mx-1 max-h-[320px] px-1">
              <div className="space-y-1">
                {eligibleCollections.map((collection) => {
                  const isSelected = selectedTarget === collection.id;
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      aria-pressed={isSelected}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        isSelected ? 'bg-primary/10' : 'hover:bg-muted/60'
                      )}
                      onClick={() => setSelectedTarget(collection.id)}
                    >
                      <CollectionPreview movieIds={collection.preview_movie_ids} className="h-12 w-12" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{collection.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {collection.user_permission === 'owner' ? 'Owner' : 'Editor'}
                          {' · '}
                          {collection.is_public ? 'Public' : 'Private'}
                        </p>
                      </div>
                      <div
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/30'
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" className="border border-border/70">Cancel</Button>
          </DialogClose>
          <Button
            disabled={!selectedTarget || isProcessing}
            onClick={() => selectedTarget && onConfirm(selectedTarget)}
          >
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {action === 'move' ? 'Move' : 'Copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
