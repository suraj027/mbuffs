import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    createCommentApi,
    createReplyApi,
    deleteCommentApi,
    fetchCommentsApi,
    fetchReviewSummaryApi,
    likeCommentApi,
    unlikeCommentApi,
    updateCommentApi,
    upsertRatingApi,
} from '@/lib/api';
import type { PaginatedCommentsResponse, ReviewComment, ReviewSummaryResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Star, Pencil, Trash2, Loader2, MessageSquare, MoreHorizontal, Send, Heart, Reply, ChevronDown, ChevronRight } from 'lucide-react';
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

const STAR_SIZE = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' } as const;

/** Rating tier — maps a 1–10 rating to a descriptive label and color scheme. */
function getRatingTier(rating: number) {
    if (rating <= 2) return { label: 'Skip It', color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/20', starColor: 'fill-red-400 text-red-400', starHoverColor: 'fill-red-300 text-red-300' };
    if (rating <= 4) return { label: 'Meh', color: 'text-orange-400', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/20', starColor: 'fill-orange-400 text-orange-400', starHoverColor: 'fill-orange-300 text-orange-300' };
    if (rating <= 6) return { label: 'Decent', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/20', starColor: 'fill-emerald-400 text-emerald-400', starHoverColor: 'fill-emerald-300 text-emerald-300' };
    if (rating <= 8) return { label: 'Must Watch', color: 'text-violet-400', bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/20', starColor: 'fill-violet-400 text-violet-400', starHoverColor: 'fill-violet-300 text-violet-300' };
    return { label: 'Masterpiece', color: 'text-amber-300', bgColor: 'bg-amber-400/15', borderColor: 'border-amber-400/25', starColor: 'fill-amber-400 text-amber-400', starHoverColor: 'fill-amber-300 text-amber-300' };
}

/** Read-only fractional star display, maps a 1–10 rating to 5 visual stars. */
function StarDisplay({ rating, max = 10, size = 'sm', className }: { rating: number; max?: number; size?: 'sm' | 'md' | 'lg'; className?: string }) {
    const normalized = (rating / max) * 5;
    const px = STAR_SIZE[size];
    const tier = getRatingTier(rating);
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
                            <Star className={cn(tier.starColor, px)} />
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
    starSize = 'h-7 w-7',
    className,
    readoutClassName,
}: {
    value: number | null;
    onChange: (rating: number) => void;
    disabled?: boolean;
    starSize?: string;
    className?: string;
    readoutClassName?: string;
}) {
    const [hoverRating, setHoverRating] = useState<number | null>(null);
    const activeRating = hoverRating ?? value ?? 0;
    const filledStars = activeRating / 2;
    const activeTier = activeRating > 0 ? getRatingTier(activeRating) : null;

    return (
        <div className={cn('flex flex-col items-center gap-1.5', disabled && 'pointer-events-none opacity-50', className)}>
            <div
                className="flex items-center gap-1"
                onMouseLeave={() => setHoverRating(null)}
            >
                {Array.from({ length: 5 }, (_, i) => {
                    const leftRating = i * 2 + 1;
                    const rightRating = i * 2 + 2;
                    const fill = starFillFraction(filledStars, i);

                    return (
                        <div key={i} className={cn('relative cursor-pointer group/star', starSize)}>
                            <Star className={cn('absolute inset-0 text-muted-foreground/20 transition-colors group-hover/star:text-muted-foreground/30', starSize)} />
                            <div
                                className="absolute inset-0 overflow-hidden transition-all duration-100"
                                style={{ width: `${fill * 100}%` }}
                            >
                                <Star
                                    className={cn(
                                        starSize,
                                        'transition-colors duration-100',
                                        hoverRating !== null
                                            ? activeTier?.starHoverColor ?? 'fill-amber-300 text-amber-300'
                                            : activeTier?.starColor ?? 'fill-amber-400 text-amber-400'
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
            </div>

            {/* Numeric readout + tier label */}
            <div className={cn('flex flex-col items-center gap-0.5 min-h-[2.75rem]', readoutClassName)}>
                <span
                    className={cn(
                        'text-sm font-semibold tabular-nums transition-all duration-150',
                        activeRating > 0
                            ? hoverRating !== null
                                ? activeTier?.color ?? 'text-amber-400'
                                : 'text-foreground'
                            : 'text-muted-foreground/50'
                    )}
                >
                    {activeRating > 0 ? `${activeRating}/10` : '\u00A0'}
                </span>
                {activeRating > 0 && (() => {
                    const tier = getRatingTier(activeRating);
                    return (
                        <span className={cn(
                            'text-[11px] font-medium transition-all duration-150',
                            tier.color,
                            hoverRating !== null ? 'opacity-80' : ''
                        )}>
                            {tier.label}
                        </span>
                    );
                })()}
            </div>
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

function updateCommentInTree(
    comment: ReviewComment,
    targetCommentId: string,
    updater: (comment: ReviewComment) => ReviewComment
): ReviewComment {
    if (comment.id === targetCommentId) {
        return updater(comment);
    }

    if (comment.replies.length === 0) {
        return comment;
    }

    let hasChanges = false;
    const nextReplies = comment.replies.map((reply) => {
        const nextReply = updateCommentInTree(reply, targetCommentId, updater);
        if (nextReply !== reply) {
            hasChanges = true;
        }
        return nextReply;
    });

    return hasChanges
        ? { ...comment, replies: nextReplies }
        : comment;
}

/* ========================================================================== */
/*  Main Component                                                            */
/* ========================================================================== */

export const ReviewSection = ({ mediaType, tmdbId }: ReviewSectionProps) => {
    const { isLoggedIn, user } = useAuth();
    const queryClient = useQueryClient();
    const [draftComment, setDraftComment] = useState('');
    const [editingState, setEditingState] = useState<{ commentId: string; draft: string } | null>(null);
    const [replyingState, setReplyingState] = useState<{
        threadCommentId: string;
        targetCommentId: string;
        draft: string;
        replyingToName: string | null;
        mentionPrefix: string;
    } | null>(null);
    const [collapsedThreads, setCollapsedThreads] = useState<Record<string, boolean>>({});
    const [isComposerFocused, setIsComposerFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
    const ratingPanelRef = useRef<HTMLDivElement>(null);
    const [ratingPanelHeight, setRatingPanelHeight] = useState<number | null>(null);

    /* ── Queries ─────────────────────────────────────────────────────────── */

    const summaryQueryKey = ['reviews', mediaType, tmdbId, 'summary'];
    const commentsQueryKey = ['reviews', mediaType, tmdbId, 'comments'];

    const { data: summaryData } = useQuery({
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

    useEffect(() => {
        if (!replyingState?.targetCommentId) {
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            const textarea = replyTextareaRef.current;
            if (!textarea) {
                return;
            }

            textarea.focus();
            const end = textarea.value.length;
            textarea.setSelectionRange(end, end);
            textarea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });

        return () => window.cancelAnimationFrame(frame);
    }, [replyingState?.targetCommentId]);

    useEffect(() => {
        const panel = ratingPanelRef.current;
        if (!panel || typeof ResizeObserver === 'undefined') {
            return;
        }

        const syncHeight = () => {
            const nextHeight = Math.ceil(panel.getBoundingClientRect().height);
            setRatingPanelHeight(nextHeight > 0 ? nextHeight : null);
        };

        syncHeight();

        const observer = new ResizeObserver(() => {
            syncHeight();
        });

        observer.observe(panel);

        return () => {
            observer.disconnect();
        };
    }, []);

    /* ── Mutations ───────────────────────────────────────────────────────── */

    type CommentsInfiniteData = {
        pages: PaginatedCommentsResponse[];
        pageParams: unknown[];
    };

    const refreshReviews = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: summaryQueryKey }),
            queryClient.invalidateQueries({ queryKey: commentsQueryKey }),
        ]);
    };

    const updateCachedCommentLikeState = (
        commentId: string,
        updater: (comment: ReviewComment) => ReviewComment
    ) => {
        queryClient.setQueryData<CommentsInfiniteData>(commentsQueryKey, (oldData) => {
            if (!oldData) {
                return oldData;
            }

            return {
                ...oldData,
                pages: oldData.pages.map((page) => ({
                    ...page,
                    comments: page.comments.map((comment) =>
                        updateCommentInTree(comment, commentId, updater)
                    ),
                })),
            };
        });
    };

    const rateMutation = useMutation({
        mutationFn: (rating: number) => upsertRatingApi(mediaType, tmdbId, rating),
        onMutate: async (nextRating) => {
            await queryClient.cancelQueries({ queryKey: summaryQueryKey });

            const previousSummary = queryClient.getQueryData<ReviewSummaryResponse>(summaryQueryKey);
            if (!previousSummary) {
                return { previousSummary };
            }

            const previousUserRating = previousSummary.userRating;
            const previousRatingsCount = previousSummary.summary.ratingsCount;
            const previousAverageRating = previousSummary.summary.averageRating ?? 0;

            const nextRatingsCount = previousUserRating == null
                ? previousRatingsCount + 1
                : previousRatingsCount;

            const baseTotalScore = previousAverageRating * previousRatingsCount;
            const adjustedTotalScore = previousUserRating == null
                ? baseTotalScore + nextRating
                : baseTotalScore - previousUserRating + nextRating;

            const nextAverageRating = nextRatingsCount > 0
                ? Number((adjustedTotalScore / nextRatingsCount).toFixed(1))
                : null;

            queryClient.setQueryData<ReviewSummaryResponse>(summaryQueryKey, {
                ...previousSummary,
                userRating: nextRating,
                summary: {
                    ...previousSummary.summary,
                    averageRating: nextAverageRating,
                    ratingsCount: nextRatingsCount,
                },
            });

            return { previousSummary };
        },
        onSuccess: (result) => {
            queryClient.setQueryData<ReviewSummaryResponse>(summaryQueryKey, result.summary);
        },
        onError: (error: Error, _nextRating, context) => {
            if (context?.previousSummary) {
                queryClient.setQueryData(summaryQueryKey, context.previousSummary);
            }

            toast.error(error.message || 'Failed to save rating');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: summaryQueryKey, refetchType: 'inactive' });
        },
    });

    const createCommentMutation = useMutation({
        mutationFn: (comment: string) => createCommentApi(mediaType, tmdbId, comment),
        onSuccess: async () => {
            setDraftComment('');
            setIsComposerFocused(false);
            await refreshReviews();
            toast.success('Comment posted');
        },
        onError: (error: Error) => toast.error(error.message || 'Failed to post comment'),
    });

    const createReplyMutation = useMutation({
        mutationFn: ({ commentId, comment }: { commentId: string; comment: string }) =>
            createReplyApi(commentId, comment),
        onSuccess: async () => {
            setReplyingState(null);
            await refreshReviews();
            toast.success('Reply posted');
        },
        onError: (error: Error) => toast.error(error.message || 'Failed to post reply'),
    });

    const likeCommentMutation = useMutation<
        { commentId: string; likesCount: number; likedByViewer: boolean },
        Error,
        { commentId: string; likedByViewer: boolean },
        { previousComments?: CommentsInfiniteData }
    >({
        mutationFn: ({ commentId, likedByViewer }: { commentId: string; likedByViewer: boolean }) =>
            likedByViewer ? unlikeCommentApi(commentId) : likeCommentApi(commentId),
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: commentsQueryKey });

            const previousComments = queryClient.getQueryData<CommentsInfiniteData>(commentsQueryKey);
            const nextLikedByViewer = !variables.likedByViewer;

            updateCachedCommentLikeState(variables.commentId, (comment) => ({
                ...comment,
                likedByViewer: nextLikedByViewer,
                likesCount: Math.max(0, comment.likesCount + (nextLikedByViewer ? 1 : -1)),
            }));

            return { previousComments };
        },
        onSuccess: (result, variables) => {
            updateCachedCommentLikeState(variables.commentId, (comment) => ({
                ...comment,
                likedByViewer: result.likedByViewer,
                likesCount: result.likesCount,
            }));
        },
        onError: (error: Error, _variables, context) => {
            if (context?.previousComments) {
                queryClient.setQueryData(commentsQueryKey, context.previousComments);
            }

            toast.error(error.message || 'Failed to update like');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: commentsQueryKey, refetchType: 'inactive' });
        },
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

    const handleSubmitReply = () => {
        if (!replyingState) return;
        const trimmed = replyingState?.draft.trim();
        if (!trimmed) return;
        createReplyMutation.mutate({ commentId: replyingState.targetCommentId, comment: trimmed });
    };

    const handleToggleLike = (comment: ReviewComment) => {
        if (!isLoggedIn) {
            toast.info('Sign in to like comments');
            return;
        }

        likeCommentMutation.mutate({
            commentId: comment.id,
            likedByViewer: comment.likedByViewer,
        });
    };

    const handleStartReply = (
        threadCommentId: string,
        targetCommentId: string,
        replyingToName: string | null,
        shouldMentionUserFirst = false
    ) => {
        if (!isLoggedIn) {
            toast.info('Sign in to reply');
            return;
        }

        const mentionPrefix = shouldMentionUserFirst && replyingToName
            ? `@${replyingToName} `
            : '';

        setReplyingState((prev) => {
            const sameThread = prev?.threadCommentId === threadCommentId;
            const previousBody = sameThread && prev
                ? prev.mentionPrefix && prev.draft.startsWith(prev.mentionPrefix)
                    ? prev.draft.slice(prev.mentionPrefix.length)
                    : prev.draft
                : '';

            const nextDraft = mentionPrefix
                ? `${mentionPrefix}${previousBody}`
                : sameThread && prev
                    ? previousBody
                    : '';

            return {
                threadCommentId,
                targetCommentId,
                draft: nextDraft,
                replyingToName,
                mentionPrefix,
            };
        });

        window.requestAnimationFrame(() => {
            const textarea = replyTextareaRef.current;
            if (!textarea) {
                return;
            }

            textarea.focus();
            const end = textarea.value.length;
            textarea.setSelectionRange(end, end);
        });
    };

    const toggleRepliesCollapsed = (commentId: string) => {
        setCollapsedThreads((prev) => ({
            ...prev,
            [commentId]: !prev[commentId],
        }));
    };

    const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmitComment();
        }
    };

    const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmitReply();
        }
    };

    const canModerate = user?.role === 'admin';
    const showComposerActions = isComposerFocused || draftComment.length > 0;

    const renderComment = (
        comment: ReviewComment,
        isReply = false,
        threadRootCommentId?: string
    ) => {
        const resolvedThreadRootCommentId = threadRootCommentId ?? comment.id;
        const isEditing = editingState?.commentId === comment.id;
        const canEditOrDelete = comment.isOwner || canModerate;
        const isReplyingToThisComment = replyingState?.targetCommentId === comment.id;
        const hasReplies = !isReply && comment.repliesCount > 0;
        const isThreadCollapsed = !isReply && (collapsedThreads[comment.id] ?? true);
        const linkedMentionPrefix = comment.replyToCommentId && comment.replyToAuthorName
            ? `@${comment.replyToAuthorName}`
            : null;
        const hasLinkedMention = Boolean(
            linkedMentionPrefix &&
            comment.comment.startsWith(`${linkedMentionPrefix} `)
        );
        const bodyWithoutMention = hasLinkedMention && linkedMentionPrefix
            ? comment.comment.slice(linkedMentionPrefix.length + 1)
            : comment.comment;

        return (
            <div id={`review-comment-${comment.id}`} className="flex gap-3 py-3.5 scroll-mt-24">
                <Avatar className="h-7 w-7 mt-0.5 shrink-0">
                    <AvatarImage
                        src={comment.author.avatarUrl || undefined}
                        alt={comment.author.name ?? 'User'}
                    />
                    <AvatarFallback className="text-[10px]">
                        {(comment.author.name?.[0] || 'U').toUpperCase()}
                    </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0 space-y-1">
                    {/* Comment header */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                            <span className="font-medium text-foreground text-[13px]">
                                {comment.author.name ?? 'Anonymous'}
                            </span>
                            <span className="flex items-center gap-1.5 text-muted-foreground/60">
                                <span className="text-[3px] leading-none">&#9679;</span>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="text-[11px] cursor-default">
                                            {timeAgo(comment.createdAt)}
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs">
                                        {new Date(comment.createdAt).toLocaleString()}
                                    </TooltipContent>
                                </Tooltip>
                                {comment.isEdited && (
                                    <>
                                        <span className="text-[3px] leading-none">&#9679;</span>
                                        <span className="text-[11px] italic">
                                            edited
                                        </span>
                                    </>
                                )}
                            </span>
                        </div>

                        {/* Overflow menu */}
                        {canEditOrDelete && !isEditing && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        className="text-muted-foreground/50 hover:text-foreground shrink-0 -mr-1"
                                    >
                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-32">
                                    {comment.isOwner && (
                                        <DropdownMenuItem
                                            onClick={() => {
                                                setEditingState({ commentId: comment.id, draft: comment.comment });
                                            }}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
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
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>

                    {/* Comment body or inline edit */}
                    {isEditing ? (
                        <div className="space-y-2">
                            <textarea
                                value={editingState?.draft ?? ''}
                                onChange={(e) => setEditingState((prev) => prev ? { ...prev, draft: e.target.value } : prev)}
                                maxLength={2000}
                                rows={3}
                                className="w-full bg-card/50 text-sm text-foreground resize-none outline-none rounded-lg border border-border/60 px-3 py-2 focus:border-border/80 focus:ring-1 focus:ring-border/30 transition-all"
                                autoFocus
                            />
                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                        setEditingState(null);
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => handleSaveEdit(comment.id)}
                                    disabled={
                                        updateCommentMutation.isPending ||
                                        (editingState?.draft.trim().length ?? 0) === 0
                                    }
                                >
                                    {updateCommentMutation.isPending ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        'Save'
                                    )}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
                                {hasLinkedMention && comment.replyToCommentId && linkedMentionPrefix ? (
                                    <>
                                        <a
                                            href={`#review-comment-${comment.replyToCommentId}`}
                                            className="font-medium text-primary hover:underline"
                                        >
                                            {linkedMentionPrefix}
                                        </a>{' '}
                                        {bodyWithoutMention}
                                    </>
                                ) : (
                                    comment.comment
                                )}
                            </p>

                            <div className="flex items-center gap-1.5">
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className={cn(
                                        'h-6 px-2 rounded-full text-[11px]',
                                        comment.likedByViewer
                                            ? 'text-rose-500 hover:text-rose-500'
                                            : 'text-muted-foreground hover:text-foreground'
                                    )}
                                    onClick={() => handleToggleLike(comment)}
                                >
                                    <Heart className={cn('h-3 w-3', comment.likedByViewer && 'fill-rose-500')} />
                                    {comment.likesCount > 0 ? comment.likesCount : 'Like'}
                                </Button>

                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className="h-6 px-2 rounded-full text-[11px] text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                        handleStartReply(
                                            resolvedThreadRootCommentId,
                                            comment.id,
                                            comment.author.name ?? 'Anonymous',
                                            isReply
                                        )
                                    }
                                >
                                    <Reply className="h-3 w-3" />
                                    Reply
                                </Button>

                                {!isReply && hasReplies && (
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className="h-6 px-2 rounded-full text-[11px] text-muted-foreground hover:text-foreground"
                                        onClick={() => toggleRepliesCollapsed(comment.id)}
                                    >
                                        {isThreadCollapsed ? (
                                            <ChevronRight className="h-3 w-3" />
                                        ) : (
                                            <ChevronDown className="h-3 w-3" />
                                        )}
                                        {isThreadCollapsed
                                            ? `Show replies (${comment.repliesCount})`
                                            : 'Hide replies'}
                                    </Button>
                                )}
                            </div>

                            {isReplyingToThisComment && (
                                <div className="rounded-lg border border-border/50 bg-card/40 p-2.5 space-y-2">
                                    <textarea
                                        ref={replyTextareaRef}
                                        value={replyingState?.draft ?? ''}
                                        onChange={(e) =>
                                            setReplyingState((prev) =>
                                                prev ? { ...prev, draft: e.target.value } : prev
                                            )
                                        }
                                        maxLength={2000}
                                        rows={2}
                                        placeholder={replyingState?.replyingToName
                                            ? `Reply to ${replyingState.replyingToName}...`
                                            : 'Write a reply...'}
                                        className="w-full bg-transparent text-sm text-foreground resize-none outline-none"
                                        onKeyDown={handleReplyKeyDown}
                                    />
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[11px] tabular-nums text-muted-foreground/50">
                                            {replyingState?.draft.length ?? 0}/2000
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => setReplyingState(null)}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="h-7 gap-1 text-xs"
                                                onClick={handleSubmitReply}
                                                disabled={
                                                    createReplyMutation.isPending ||
                                                    (replyingState?.draft.trim().length ?? 0) === 0
                                                }
                                            >
                                                {createReplyMutation.isPending ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    'Reply'
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!isReply && !isThreadCollapsed && comment.replies.length > 0 && (
                                <div className="mt-2 space-y-0 border-l border-border/40 pl-3 md:pl-4">
                                    {comment.replies.map((reply, index) => (
                                        <div key={reply.id}>
                                            {index > 0 && <Separator className="opacity-20" />}
                                            {renderComment(reply, true, resolvedThreadRootCommentId)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    /* ── Render ──────────────────────────────────────────────────────────── */

    return (
        <section className="space-y-5">
            <div className="flex items-baseline justify-center md:justify-start">
                <h2 className="text-xl md:text-2xl font-semibold text-foreground">
                    Ratings & Reviews
                </h2>
            </div>

            <div className="rounded-xl border border-border/60 bg-card/35 overflow-hidden">
                <div className="grid md:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)] md:items-start">
                    <div
                        ref={ratingPanelRef}
                        className="px-5 py-5 md:px-6 md:py-6 border-b md:border-b-0 md:border-r border-border/50 space-y-5 text-center md:text-left"
                    >
                        {(summaryData?.summary.ratingsCount ?? 0) > 0 ? (
                            <div className="space-y-2.5 flex flex-col items-center md:items-start">
                                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-[0.2em]">
                                    mbuff score
                                </span>
                                <div className="flex items-baseline gap-1.5">
                                    <span className={cn(
                                        'text-5xl font-extrabold tabular-nums tracking-tighter leading-none transition-colors',
                                        summaryData?.summary.averageRating != null
                                            ? getRatingTier(summaryData.summary.averageRating).color
                                            : 'text-muted-foreground/20'
                                    )}>
                                        {summaryData?.summary.averageRating ?? '—'}
                                    </span>
                                    <span className="text-base text-muted-foreground/50 font-semibold">/10</span>
                                </div>
                                {summaryData?.summary.averageRating != null && (() => {
                                    const tier = getRatingTier(summaryData.summary.averageRating);
                                    return (
                                        <div className="space-y-1.5">
                                            <StarDisplay rating={summaryData.summary.averageRating} size="md" />
                                            <span className={cn(
                                                'inline-flex items-center px-3 py-0.5 rounded-full text-[11px] font-semibold border',
                                                tier.color, tier.bgColor, tier.borderColor
                                            )}>
                                                {tier.label}
                                            </span>
                                        </div>
                                    );
                                })()}
                                <span className="text-xs text-muted-foreground">
                                    {summaryData?.summary.ratingsCount ?? 0}{' '}
                                    {(summaryData?.summary.ratingsCount ?? 0) === 1 ? 'rating' : 'ratings'}
                                </span>
                            </div>
                        ) : (
                            <div className="space-y-1.5 flex flex-col items-center md:items-start">
                                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-[0.2em]">
                                    mbuff score
                                </span>
                                <p className="text-sm text-muted-foreground">No ratings yet</p>
                            </div>
                        )}

                        {isLoggedIn && (
                            <>
                                <Separator className="opacity-40" />
                                <div className="space-y-2 flex flex-col items-center md:items-start">
                                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                                        Your Rating
                                    </span>
                                    <InteractiveStarRating
                                        value={summaryData?.userRating ?? null}
                                        onChange={(r) => rateMutation.mutate(r)}
                                        starSize="h-6 w-6"
                                        className="items-center md:items-start"
                                        readoutClassName="items-center md:items-start"
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="min-w-0">
                        <div
                            className="px-4 py-4 md:px-5 md:py-5 space-y-4 md:overflow-y-auto md:h-[var(--reviews-pane-height)]"
                            style={{ ['--reviews-pane-height' as string]: ratingPanelHeight ? `${ratingPanelHeight}px` : 'auto' }}
                        >
                            {isLoggedIn && (
                                <div
                                    className={cn(
                                        'rounded-xl border bg-card/30 transition-all duration-200',
                                        isComposerFocused
                                            ? 'border-border/80 bg-card/50 ring-1 ring-border/30'
                                            : 'border-border/50'
                                    )}
                                >
                                    <div className="flex items-start gap-3 p-3 md:p-4">
                                        <Avatar className="h-7 w-7 mt-0.5 shrink-0">
                                            <AvatarImage src={user?.avatarUrl || user?.image || undefined} />
                                            <AvatarFallback className="text-[10px]">
                                                {(user?.name?.[0] || 'U').toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <textarea
                                                ref={textareaRef}
                                                placeholder="Share your thoughts..."
                                                value={draftComment}
                                                maxLength={2000}
                                                rows={showComposerActions ? 3 : 1}
                                                className={cn(
                                                    'w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60',
                                                    'resize-none outline-none leading-relaxed',
                                                    'transition-all duration-200',
                                                    showComposerActions ? 'min-h-[4.5rem]' : 'min-h-0'
                                                )}
                                                onChange={(e) => setDraftComment(e.target.value)}
                                                onFocus={() => setIsComposerFocused(true)}
                                                onBlur={() => {
                                                    if (draftComment.trim().length === 0) {
                                                        setIsComposerFocused(false);
                                                    }
                                                }}
                                                onKeyDown={handleComposerKeyDown}
                                            />
                                        </div>
                                    </div>

                                    {showComposerActions && (
                                        <div className="flex items-center justify-between px-3 pb-3 md:px-4 md:pb-4 pt-0">
                                            <span className="text-[11px] tabular-nums text-muted-foreground/50">
                                                {draftComment.length > 0 && `${draftComment.length}/2000`}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] text-muted-foreground/50 hidden sm:inline">
                                                    {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter
                                                </span>
                                                <Button
                                                    size="sm"
                                                    onClick={handleSubmitComment}
                                                    disabled={
                                                        createCommentMutation.isPending ||
                                                        draftComment.trim().length === 0
                                                    }
                                                    className="h-8 gap-1.5 px-3 rounded-lg"
                                                >
                                                    {createCommentMutation.isPending ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <>
                                                            Post
                                                            <Send className="h-3 w-3" />
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {comments.length > 0 && (
                                <div className="rounded-xl border border-border/60 bg-card/40 px-4 md:px-5">
                                    {comments.map((comment: ReviewComment, index: number) => (
                                        <div key={comment.id}>
                                            {index > 0 && <Separator className="opacity-30" />}
                                            {renderComment(comment)}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {commentsQuery.isLoading && (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            )}

                            {comments.length === 0 && !commentsQuery.isLoading && (
                                <div className="flex flex-col items-center justify-center py-10 text-center">
                                    <div className="rounded-full bg-muted/30 p-3.5 mb-3">
                                        <MessageSquare className="h-5 w-5 text-muted-foreground/60 stroke-[1.5]" />
                                    </div>
                                    <p className="text-sm font-medium text-foreground/80">No reviews yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Be the first to share your thoughts
                                    </p>
                                </div>
                            )}

                            {commentsQuery.hasNextPage && (
                                <div className="flex justify-center pt-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground hover:text-foreground text-xs"
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
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
