import { Movie, UserPreferences } from "@/lib/types";
import { fetchUserPreferencesApi, getImageUrl, toggleNotInterestedStatusApi, toggleWatchedStatusApi } from "@/lib/api";
import { Star, Eye, EyeOff, MoreVertical, ThumbsDown, ThumbsUp } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getForYouRecommendationsQueryKey, getPreferencesQueryKey } from "@/lib/recommendationQueries";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useState, ReactNode } from "react";
import { haptics } from "@/lib/haptics";

interface MovieCardProps {
  movie: Movie;
  onClick?: () => void;
  isWatched?: boolean;
  isNotInterested?: boolean;
  showNotInterested?: boolean;
  /** Additional menu items to render after the watched option */
  additionalMenuItems?: ReactNode;
}

export function MovieCard({
  movie,
  onClick,
  isWatched = false,
  isNotInterested = false,
  showNotInterested = false,
  additionalMenuItems
}: MovieCardProps) {
  const releaseYear = (movie.release_date || movie.first_air_date) 
    ? new Date(movie.first_air_date || movie.release_date).getFullYear() 
    : "Unknown";
  
  const mediaType = movie.first_air_date ? "tv" : "movie";
  const navLink = `/media/${mediaType}/${movie.id}`;
  const mediaId = mediaType === "tv" ? `${movie.id}tv` : String(movie.id);
  const becauseYouLiked = movie.explainability?.because_you_liked?.[0];
  const isRedditRecommended = movie.explainability?.reason_codes?.includes('reddit_popular') || 
    (movie.explainability?.reddit_mentions ?? 0) > 0;
  const meetsExplainabilityCondition = Boolean(becauseYouLiked) && (
    (movie.explainability?.source_appearances ?? 0) >= 2 ||
    movie.explainability?.reason_codes?.includes('director_affinity') ||
    movie.explainability?.reason_codes?.includes('actor_affinity')
  );
  const randomBucket = ((movie.id * 7) + (movie.name || movie.title || '').length) % 10;
  const shouldShowBecauseYouLiked = meetsExplainabilityCondition && randomBucket === 0;
  
  const { isLoggedIn, user } = useAuth();
  const preferencesQueryKey = getPreferencesQueryKey(user?.id);
  const { data: preferencesData } = useQuery<{ preferences: UserPreferences }, Error>({
    queryKey: preferencesQueryKey,
    queryFn: fetchUserPreferencesApi,
    enabled: isLoggedIn && user?.role === 'admin',
    staleTime: 1000 * 60 * 5,
  });
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuItemClass = "cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/90 focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

  // Local optimistic overlays. We only use them while they differ from server props.
  const [optimisticWatched, setOptimisticWatched] = useState<boolean | null>(null);
  const [optimisticNotInterested, setOptimisticNotInterested] = useState<boolean | null>(null);

  const displayedWatched =
    optimisticWatched !== null && optimisticWatched !== isWatched
      ? optimisticWatched
      : isWatched;

  const displayedNotInterested =
    optimisticNotInterested !== null && optimisticNotInterested !== isNotInterested
      ? optimisticNotInterested
      : isNotInterested;

  const toggleWatchedMutation = useMutation({
    mutationFn: () => toggleWatchedStatusApi(mediaId),
    onMutate: async () => {
      const newValue = !displayedWatched;
      setOptimisticWatched(newValue);
      
      await queryClient.cancelQueries({ queryKey: ['watched', mediaId] });
      await queryClient.cancelQueries({ queryKey: ['watchedBatch'] });
      
      return { previousWatched: displayedWatched };
    },
    onSuccess: (data) => {
      setOptimisticWatched(data.isWatched);
      queryClient.invalidateQueries({ queryKey: ['watched'] });
      queryClient.invalidateQueries({ queryKey: ['watchedBatch'] });
      queryClient.invalidateQueries({ queryKey: ['collections', 'watched', 'items'] });
      if (user?.id) {
        queryClient.invalidateQueries({
          queryKey: getForYouRecommendationsQueryKey(user.id),
          refetchType: 'none',
        });
      }
    },
    onError: (_error: Error, _, context) => {
      if (context) {
        setOptimisticWatched(context.previousWatched);
      }
      toast.error('Failed to update watched status');
    },
  });

  const toggleNotInterestedMutation = useMutation({
    mutationFn: () => toggleNotInterestedStatusApi(mediaId),
    onMutate: async () => {
      const newValue = !displayedNotInterested;
      setOptimisticNotInterested(newValue);

      await queryClient.cancelQueries({ queryKey: ['notInterested', mediaId] });
      await queryClient.cancelQueries({ queryKey: ['notInterestedBatch'] });

      return { previousNotInterested: displayedNotInterested };
    },
    onSuccess: (data) => {
      setOptimisticNotInterested(data.isNotInterested);
      queryClient.invalidateQueries({ queryKey: ['notInterested'] });
      queryClient.invalidateQueries({ queryKey: ['notInterestedBatch'] });
      queryClient.invalidateQueries({ queryKey: ['collections', 'not-interested', 'items'] });
      if (user?.id) {
        queryClient.invalidateQueries({
          queryKey: getForYouRecommendationsQueryKey(user.id),
          refetchType: 'none',
        });
      }
    },
    onError: (_error: Error, _, context) => {
      if (context) {
        setOptimisticNotInterested(context.previousNotInterested);
      }
      toast.error('Failed to update not interested status');
    },
  });

  const handleWatchedClick = () => {
    if (!isLoggedIn) {
      toast.error('Please sign in to mark as watched');
      return;
    }
    toggleWatchedMutation.mutate();
  };

  const handleNotInterestedClick = () => {
    if (!showNotInterested) {
      return;
    }
    if (!isLoggedIn) {
      toast.error('Please sign in to mark as not interested');
      return;
    }
    toggleNotInterestedMutation.mutate();
  };

  return (
    <Link to={navLink} className="group block card-glow rounded-xl transition-transform duration-300 group-hover:scale-[1.03]" onClick={() => haptics.trigger("success")}>
      <div 
        className="relative overflow-hidden rounded-xl bg-card border border-border/60"
        onClick={onClick}
      >
        {/* Poster Image */}
        <div className="aspect-2/3 relative overflow-hidden">
          <img
            src={getImageUrl(movie.poster_path)}
            alt={movie.name || movie.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
          
          {/* Gradient overlay — always visible at bottom, intensifies on hover */}
          <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/40 to-transparent opacity-100 transition-opacity duration-300" />

          {/* Reddit Badge (admin-toggleable) */}
          {isRedditRecommended && user?.role === 'admin' && (preferencesData?.preferences?.show_reddit_label ?? true) && (
            <div className="absolute top-2 left-2 z-20">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-500/90 text-[10px] font-semibold text-white shadow-sm">
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
                </svg>
                Reddit
              </span>
            </div>
          )}

          {/* Three-dot Menu */}
          {isLoggedIn && (
            <div className="absolute top-2 right-2 z-20">
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 rounded-full bg-background/70 border border-border/70 hover:bg-background/90 transition-opacity ${
                      menuOpen ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
                    }`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <MoreVertical className="h-4 w-4 text-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-44 rounded-lg border-border bg-popover/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl"
                >
                  <DropdownMenuItem
                    className={menuItemClass}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleWatchedClick();
                    }}
                  >
                    {displayedWatched ? (
                      <EyeOff className="h-4 w-4 mr-2 text-foreground/80" />
                    ) : (
                      <Eye className="h-4 w-4 mr-2 text-foreground/80" />
                    )}
                    <span className="whitespace-nowrap">{displayedWatched ? 'Unwatch' : 'Watched'}</span>
                  </DropdownMenuItem>
                  {showNotInterested && (
                    <DropdownMenuItem
                      className={menuItemClass}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleNotInterestedClick();
                      }}
                    >
                      {displayedNotInterested ? (
                        <ThumbsUp className="h-4 w-4 mr-2 text-foreground/90" />
                      ) : (
                        <ThumbsDown className="h-4 w-4 mr-2 text-muted-foreground" />
                      )}
                      <span className="whitespace-nowrap">{displayedNotInterested ? 'Interested?' : 'Not interested?'}</span>
                    </DropdownMenuItem>
                  )}
                  {additionalMenuItems}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Title Overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-3 flex flex-col justify-end z-10">
            <h3 className="font-semibold text-xs sm:text-sm leading-tight text-foreground line-clamp-2 drop-shadow-md shadow-black">
              {movie.name || movie.title}
            </h3>
            <div className="flex items-center gap-1.5 mt-1">
              <p className="text-[10px] text-foreground/70 font-medium">{releaseYear}</p>
              <span className="text-[10px] text-foreground/40">•</span>
              <div className="flex items-center gap-1">
                <Star className="h-3 w-3 text-yellow-400" fill="currentColor" />
                <span className="text-[10px] font-medium text-foreground/90">
                  {movie.vote_average.toFixed(1)}
                </span>
              </div>
            </div>
            {shouldShowBecauseYouLiked && (
              <p className="mt-1 text-[10px] text-foreground/80 line-clamp-1">
                Because you liked {becauseYouLiked}
              </p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default MovieCard;
