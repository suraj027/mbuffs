import { Movie } from "@/lib/types";
import { getImageUrl, toggleNotInterestedStatusApi, toggleWatchedStatusApi } from "@/lib/api";
import { Star, Eye, EyeOff, MoreVertical, ThumbsDown, ThumbsUp } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useState, ReactNode } from "react";

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
  
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuItemClass = "cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/90 focus:bg-white/10 focus:text-foreground data-[highlighted]:bg-white/10 data-[highlighted]:text-foreground";

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
    <Link to={navLink} className="group block card-glow rounded-xl transition-transform duration-300 group-hover:scale-[1.03]">
      <div 
        className="relative overflow-hidden rounded-xl bg-card border border-white/6"
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

          {/* Three-dot Menu */}
          {isLoggedIn && (
            <div className="absolute top-2 right-2 z-20">
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 rounded-full bg-black/55 border border-white/10 hover:bg-black/75 transition-opacity ${
                      menuOpen ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
                    }`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <MoreVertical className="h-4 w-4 text-white" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-44 rounded-xl border-white/15 bg-[#0d1424]/95 p-1.5 shadow-2xl shadow-black/45 backdrop-blur-xl"
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
                        <ThumbsUp className="h-4 w-4 mr-2 text-emerald-300" />
                      ) : (
                        <ThumbsDown className="h-4 w-4 mr-2 text-amber-300" />
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
            <h3 className="font-semibold text-xs sm:text-sm leading-tight text-white line-clamp-2 drop-shadow-md shadow-black">
              {movie.name || movie.title}
            </h3>
            <div className="flex items-center gap-1.5 mt-1">
              <p className="text-[10px] text-white/70 font-medium">{releaseYear}</p>
              <span className="text-[10px] text-white/40">•</span>
              <div className="flex items-center gap-1">
                <Star className="h-3 w-3 text-yellow-400" fill="currentColor" />
                <span className="text-[10px] font-medium text-white/90">
                  {movie.vote_average.toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default MovieCard;
