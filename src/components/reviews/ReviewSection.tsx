import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    createCommentApi,
    deleteCommentApi,
    fetchCommentsApi,
    fetchReviewSummaryApi,
    updateCommentApi,
    upsertRatingApi,
} from '@/lib/api';
import type { ReviewComment } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Star, Pencil, Trash2, Loader2, MessageSquare, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

/* ========================================================================== */
/*  Props                                                                     */
/* ========================================================================== */

interface ReviewSectionProps {
    mediaType: 'movie' | 'tv';
    tmdbId: number;
}

/* ========================================================================== */
/*  Sub-components                                                            */
/* ========================================================================== */

/** Clamped 0-1 fill fraction for a given star index. */
function starFillFraction(filledStars: number, index: number): number {
    return Math.min(Math.max(filledStars - index, 0), 1);
}

const STAR_SIZE = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8' } as const;

/** Read-only fractional star display, maps a 1–10 rating to 5 visual stars. */
function StarDisplay({ rating, max = 10, size = 'sm', className }: { rating: number; max?: number; size?: 'sm' | 'md' | 'lg'; className?: string }) {
    const normalized = (rating / max) * 5;
    const px = STAR_SIZE[size];
    return (
        <div className={cn('flex items-center gap-0.5', className)} aria-label={`${rating} out of ${max}`}>
            {Array.from({ length: 5 }, (_, i) => {
                const fill = starFillFraction(normalized, i);
                return (
                    <div key={i} className={cn('relative', px)}>
                        <Star className={cn('absolute inset-0 text-muted-foreground/20', px)} />
                        <div
                            className="absolute inset-0 overflow-hidden"
                            style={{ width: `${fill * 100}%` }}
                        >
                            <Star className={cn('fill-amber-400 text-amber-400', px)} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Interactive 5-star rating with half-star precision.
 * Each half-star maps to one integer point on the 1–10 scale:
 *   Star 0 left = 1, right = 2 … Star 4 left = 9, right = 10.
 */
function InteractiveStarRating({
    value,
    onChange,
    disabled,
}: {
    value: number | null;
    onChange: (rating: number) => void;
    disabled?: boolean;
}) {
    const [hoverRating, setHoverRating] = useState<number | null>(null);
    const activeRating = hoverRating ?? value ?? 0;
    const filledStars = activeRating / 2;

    return (
        <div
            className={cn('flex items-center gap-0.5', disabled && 'pointer-events-none opacity-50')}
            onMouseLeave={() => setHoverRating(null)}
        >
            {Array.from({ length: 5 }, (_, i) => {
                const leftRating = i * 2 + 1;
                const rightRating = i * 2 + 2;
                const fill = starFillFraction(filledStars, i);

                return (
                    <div key={i} className="relative h-8 w-8 cursor-pointer group/star">
                        <Star className="absolute inset-0 h-8 w-8 text-muted-foreground/20 transition-colors group-hover/star:text-muted-foreground/30" />
                        <div
                            className="absolute inset-0 overflow-hidden transition-all duration-100"
                            style={{ width: `${fill * 100}%` }}
                        >
                            <Star
                                className={cn(
                                    'h-8 w-8 transition-colors duration-100',
                                    hoverRating !== null
                                        ? 'fill-amber-300 text-amber-300'
                                        : 'fill-amber-400 text-amber-400'
                                )}
                            />
                        </div>
                        {/* Invisible left/right hit areas for half-star precision */}
                        <div
                            className="absolute inset-y-0 left-0 w-1/2 z-10"
                            onMouseEnter={() => setHoverRating(leftRating)}
                            onClick={() => onChange(leftRating)}
                        />
                        <div
                            className="absolute inset-y-0 right-0 w-1/2 z-10"
                            onMouseEnter={() => setHoverRating(rightRating)}
                            onClick={() => onChange(rightRating)}
                        />
                    </div>
                );
            })}

            {/* Numeric readout */}
            <span
                className={cn(
                    'ml-2 text-sm font-semibold tabular-nums transition-all duration-150 min-w-[2.5rem]',
                    activeRating > 0
                        ? hoverRating !== null
                            ? 'text-amber-400'
                            : 'text-foreground/70'
                        : 'text-transparent select-none'
                )}
            >
                {activeRating > 0 ? `${activeRating}/10` : '—/10'}
            </span>
        </div>
    );
}

/** Short relative-time label. */
function timeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
}

/* ========================================================================== */
/*  Main Component                                                            */
/* ========================================================================== */

export const ReviewSection = ({ mediaType, tmdbId }: ReviewSectionProps) => {
    const { isLoggedIn, user } = useAuth();
    const queryClient = useQueryClient();
    const [draftComment, setDraftComment] = useState('');
    const [editingState, setEditingState] = useState<{ commentId: string; draft: string } | null>(null);

    /* ── Queries ─────────────────────────────────────────────────────────── */

    const summaryQueryKey = ['reviews', mediaType, tmdbId, 'summary'];
    const commentsQueryKey = ['reviews', mediaType, tmdbId, 'comments'];

    const { data: summaryData, isLoading: isLoadingSummary } = useQuery({
        queryKey: summaryQueryKey,
        queryFn: () => fetchReviewSummaryApi(mediaType, tmdbId),
        staleTime: 60_000,
    });

    const commentsQuery = useInfiniteQuery({
        queryKey: commentsQueryKey,
        queryFn: ({ pageParam }) =>
            fetchCommentsApi(mediaType, tmdbId, {
                cursor: pageParam as string | undefined,
                limit: 10,
            }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.pagination.nextCursor ?? undefined,
        maxPages: 20,
    });

    const comments = useMemo(
        () => commentsQuery.data?.pages.flatMap((page) => page.comments) ?? [],
        [commentsQuery.data?.pages]
    );

    /* ── Mutations ───────────────────────────────────────────────────────── */

    const refreshReviews = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: summaryQueryKey }),
            queryClient.invalidateQueries({ queryKey: commentsQueryKey }),
        ]);
    };

    const rateMutation = useMutation({
        mutationFn: (rating: number) => upsertRatingApi(mediaType, tmdbId, rating),
        onSuccess: () => {
            refreshReviews();
            toast.success('Rating saved');
        },
        onError: (error: Error) => toast.error(error.message || 'Failed to save rating'),
    });

    const createCommentMutation = useMutation({
        mutationFn: (comment: string) => createCommentApi(mediaType, tmdbId, comment),
        onSuccess: async () => {
            setDraftComment('');
            await refreshReviews();
            toast.success('Comment posted');
        },
        onError: (error: Error) => toast.error(error.message || 'Failed to post comment'),
    });

    const updateCommentMutation = useMutation({
        mutationFn: ({ commentId, comment }: { commentId: string; comment: string }) =>
            updateCommentApi(commentId, comment),
        onSuccess: async () => {
            setEditingState(null);
            await refreshReviews();
            toast.success('Comment updated');
        },
        onError: (error: Error) => toast.error(error.message || 'Failed to update comment'),
    });

    const deleteCommentMutation = useMutation({
        mutationFn: (commentId: string) => deleteCommentApi(commentId),
        onSuccess: async () => {
            await refreshReviews();
            toast.success('Comment deleted');
        },
        onError: (error: Error) => toast.error(error.message || 'Failed to delete comment'),
    });

    /* ── Handlers ────────────────────────────────────────────────────────── */

    const handleSubmitComment = () => {
        const trimmed = draftComment.trim();
        if (!trimmed) return;
        createCommentMutation.mutate(trimmed);
    };

    const handleSaveEdit = (commentId: string) => {
        const trimmed = editingState?.draft.trim();
        if (!trimmed) return;
        updateCommentMutation.mutate({ commentId, comment: trimmed });
    };

    const canModerate = user?.role === 'admin';

    /* ── Render ──────────────────────────────────────────────────────────── */

    return (
        <section className="space-y-6">
            {/* ────────── Section heading ────────── */}
            <div className="flex items-baseline gap-3">
                <h2 className="text-xl md:text-2xl font-semibold text-foreground/90">
                    Ratings & Reviews
                </h2>
                {!isLoadingSummary && (summaryData?.summary.commentsCount ?? 0) > 0 && (
                    <span className="text-sm text-muted-foreground">
                        {summaryData!.summary.commentsCount}{' '}
                        {summaryData!.summary.commentsCount === 1 ? 'review' : 'reviews'}
                    </span>
                )}
            </div>

            {/* ────────── Rating overview — community + user, side-by-side ────────── */}
            <div className="rounded-xl bg-card/50 border border-border/60 overflow-hidden">
                <div className="flex flex-col md:flex-row">
                    {/* Community rating */}
                    <div className="flex-1 p-5 md:p-6 flex flex-col items-center md:items-start gap-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Community Rating
                        </span>
                        <div className="flex items-end gap-1.5">
                            <span className="text-4xl md:text-5xl font-bold tabular-nums tracking-tighter leading-none">
                                {summaryData?.summary.averageRating ?? '—'}
                            </span>
                            <span className="text-sm text-muted-foreground/50 font-medium mb-1">
                                /10
                            </span>
                        </div>
                        {summaryData?.summary.averageRating != null ? (
                            <StarDisplay rating={summaryData.summary.averageRating} size="md" />
                        ) : (
                            <StarDisplay rating={0} size="md" />
                        )}
                        <span className="text-xs text-muted-foreground mt-0.5">
                            Based on {summaryData?.summary.ratingsCount ?? 0}{' '}
                            {(summaryData?.summary.ratingsCount ?? 0) === 1 ? 'rating' : 'ratings'}
                        </span>
                    </div>

                    {/* Divider */}
                    <Separator className="md:hidden" />
                    <Separator orientation="vertical" className="hidden md:block h-auto" />

                    {/* User rating */}
                    <div className="flex-1 p-5 md:p-6 flex flex-col items-center md:items-start gap-3">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {isLoggedIn ? 'Your Rating' : 'Rate This'}
                        </span>

                        {isLoggedIn ? (
                            <>
                                <InteractiveStarRating
                                    value={summaryData?.userRating ?? null}
                                    onChange={(r) => rateMutation.mutate(r)}
                                    disabled={rateMutation.isPending}
                                />
                                {rateMutation.isPending && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Saving...
                                    </div>
                                )}
                                {!summaryData?.userRating && !rateMutation.isPending && (
                                    <p className="text-xs text-muted-foreground">
                                        Tap a star to rate
                                    </p>
                                )}
                            </>
                        ) : (
                            <>
                                <StarDisplay rating={0} size="lg" className="opacity-40" />
                                <p className="text-sm text-muted-foreground">
                                    Sign in to rate and review
                                </p>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* ────────── Comment composer ────────── */}
            {isLoggedIn && (
                <div className="flex gap-3 items-start">
                    <Avatar className="h-8 w-8 mt-1.5 shrink-0">
                        <AvatarImage src={user?.avatarUrl || user?.image || undefined} />
                        <AvatarFallback className="text-xs">
                            {(user?.name?.[0] || 'U').toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-2">
                        <Textarea
                            placeholder="Share your thoughts..."
                            value={draftComment}
                            maxLength={2000}
                            rows={3}
                            className="resize-none text-sm bg-card/30 border-border/60 focus:bg-card/50 transition-colors"
                            onChange={(e) => setDraftComment(e.target.value)}
                        />
                        <div className="flex items-center justify-between">
                            <span className="text-xs tabular-nums text-muted-foreground/40">
                                {draftComment.length > 0
                                    ? `${draftComment.length} / 2,000`
                                    : '\u00A0'}
                            </span>
                            <Button
                                size="sm"
                                onClick={handleSubmitComment}
                                disabled={
                                    createCommentMutation.isPending ||
                                    draftComment.trim().length === 0
                                }
                                className="gap-1.5"
                            >
                                {createCommentMutation.isPending ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    'Post comment'
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* ────────── Comments feed ────────── */}
            {comments.length > 0 && (
                <>
                    {comments.map((comment: ReviewComment, index: number) => {
                        const isEditing = editingState?.commentId === comment.id;
                        const canEditOrDelete = comment.isOwner || canModerate;

                        return (
                            <div key={comment.id}>
                                {index > 0 && <Separator className="opacity-40" />}

                                <div className="flex gap-3 py-4">
                                    <Avatar className="h-8 w-8 mt-0.5 shrink-0">
                                        <AvatarImage
                                            src={comment.author.avatarUrl || undefined}
                                            alt={comment.author.name ?? 'User'}
                                        />
                                        <AvatarFallback className="text-xs">
                                            {(comment.author.name?.[0] || 'U').toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>

                                    <div className="flex-1 min-w-0 space-y-1.5">
                                        {/* Comment header */}
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 text-sm flex-wrap">
                                                <span className="font-medium text-foreground/90">
                                                    {comment.author.name ?? 'Anonymous'}
                                                </span>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="text-xs text-muted-foreground cursor-default">
                                                            {timeAgo(comment.createdAt)}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent className="text-xs">
                                                        {new Date(comment.createdAt).toLocaleString()}
                                                    </TooltipContent>
                                                </Tooltip>
                                                {comment.isEdited && (
                                                    <span className="text-xs text-muted-foreground/50 italic">
                                                        (edited)
                                                    </span>
                                                )}
                                            </div>

                                            {/* Overflow menu */}
                                            {canEditOrDelete && !isEditing && (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-muted-foreground/50 hover:text-foreground shrink-0 -mr-1"
                                                        >
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-36">
                                                        {comment.isOwner && (
                                                            <DropdownMenuItem
                                                                onClick={() => {
                                                                    setEditingState({ commentId: comment.id, draft: comment.comment });
                                                                }}
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                                Edit
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuItem
                                                            variant="destructive"
                                                            onClick={() =>
                                                                deleteCommentMutation.mutate(comment.id)
                                                            }
                                                            disabled={deleteCommentMutation.isPending}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            )}
                                        </div>

                                        {/* Comment body or inline edit */}
                                        {isEditing ? (
                                            <div className="space-y-2">
                                                <Textarea
                                                    value={editingState?.draft ?? ''}
                                                    onChange={(e) => setEditingState((prev) => prev ? { ...prev, draft: e.target.value } : prev)}
                                                    maxLength={2000}
                                                    rows={3}
                                                    className="resize-none text-sm"
                                                    autoFocus
                                                />
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setEditingState(null);
                                                        }}
                                                    >
                                                        Cancel
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleSaveEdit(comment.id)}
                                                        disabled={
                                                            updateCommentMutation.isPending ||
                                                            (editingState?.draft.trim().length ?? 0) === 0
                                                        }
                                                    >
                                                        {updateCommentMutation.isPending ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        ) : (
                                                            'Save'
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                                                {comment.comment}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </>
            )}

            {/* Loading state */}
            {commentsQuery.isLoading && (
                <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Empty state */}
            {comments.length === 0 && !commentsQuery.isLoading && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="rounded-full bg-muted/50 p-4 mb-3">
                        <MessageSquare className="h-6 w-6 text-muted-foreground/50 stroke-[1.5]" />
                    </div>
                    <p className="text-sm font-medium text-foreground/70">No reviews yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Be the first to share your thoughts
                    </p>
                </div>
            )}

            {/* Load more */}
            {commentsQuery.hasNextPage && (
                <div className="flex justify-center">
                    <Button
                        variant="outline"
                        size="sm"
                        className="border-border/60 bg-secondary/40 hover:bg-secondary/70 text-foreground/80"
                        onClick={() => commentsQuery.fetchNextPage()}
                        disabled={commentsQuery.isFetchingNextPage}
                    >
                        {commentsQuery.isFetchingNextPage ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                                Loading...
                            </>
                        ) : (
                            'Load more reviews'
                        )}
                    </Button>
                </div>
            )}
        </section>
    );
};
