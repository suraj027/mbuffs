import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Copy, FolderInput, Trash2, X, MoreVertical, CheckCheck } from 'lucide-react';

interface BulkActionBarProps {
  selectedCount: number;
  isAllSelected: boolean;
  canEdit: boolean;
  isProcessing: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onExit: () => void;
  onRequestAction: (action: 'copy' | 'move' | 'remove') => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  isAllSelected,
  canEdit,
  isProcessing,
  onSelectAll,
  onClearSelection,
  onExit,
  onRequestAction,
}) => {
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-20 md:bottom-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center gap-1 rounded-2xl border border-border/60 bg-popover/95 shadow-2xl shadow-black/40 backdrop-blur-xl p-1.5">
        {/* Exit selection */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground"
          onClick={onExit}
          disabled={isProcessing}
          aria-label="Exit selection"
        >
          <X className="h-4 w-4" />
        </Button>

        {/* Count */}
        <span className="px-1.5 text-sm font-medium tabular-nums whitespace-nowrap">
          {selectedCount} selected
        </span>

        <div className="mx-0.5 h-6 w-px bg-border" />

        {/* Select all / Clear */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2.5 rounded-xl text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={isAllSelected ? onClearSelection : onSelectAll}
          disabled={isProcessing}
        >
          {isAllSelected ? <X className="h-3.5 w-3.5" /> : <CheckCheck className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{isAllSelected ? 'Deselect all' : 'Select all'}</span>
        </Button>

        {/* Actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-xl"
              disabled={selectedCount === 0 || isProcessing}
              aria-label="Actions"
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            sideOffset={10}
            className="w-36 rounded-xl border-border bg-popover/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl"
          >
            <DropdownMenuItem
              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium"
              onClick={() => onRequestAction('copy')}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem
                className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium"
                onClick={() => onRequestAction('move')}
              >
                <FolderInput className="mr-2 h-4 w-4" />
                Move
              </DropdownMenuItem>
            )}
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-destructive focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                  onClick={() => setShowRemoveConfirm(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Remove confirmation */}
      <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <AlertDialogContent className="w-[90%] sm:max-w-[400px] rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {selectedCount} {selectedCount === 1 ? 'item' : 'items'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They'll be removed from this collection. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onRequestAction('remove')}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
