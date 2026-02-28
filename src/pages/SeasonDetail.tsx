import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTvSeasonDetailsApi, getImageUrl } from '@/lib/api';
import { SeasonDetails, Episode } from '@/lib/types';
import { Navbar } from "@/components/Navbar";
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Star, ArrowLeft, Calendar, Clock, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SeasonDetail = () => {
    const { mediaId, seasonNumber } = useParams<{ mediaId: string, seasonNumber: string }>();

    const { data: seasonDetails, isLoading, isError, error } = useQuery<SeasonDetails | null, Error>({
        queryKey: ['tv', mediaId, 'season', seasonNumber],
        queryFn: () => {
            if (!mediaId || !seasonNumber) throw new Error("ID and Season Number required");
            return fetchTvSeasonDetailsApi(Number(mediaId), Number(seasonNumber));
        },
        enabled: !!mediaId && !!seasonNumber,
    });

    if (isLoading) {
        return (
            <>
                <Navbar />
                <main className="container py-20 space-y-8">
                    <div className="flex flex-col md:flex-row gap-8">
                        <Skeleton className="w-[300px] h-[450px] rounded-lg shrink-0" />
                        <div className="space-y-4 flex-1">
                            <Skeleton className="h-10 w-3/4" />
                            <Skeleton className="h-20 w-full" />
                            <div className="space-y-4 pt-8">
                                {[1, 2, 3].map(i => (
                                    <Skeleton key={i} className="h-32 w-full rounded-lg" />
                                ))}
                            </div>
                        </div>
                    </div>
                </main>
            </>
        );
    }

    if (isError || !seasonDetails) {
        return (
            <>
                <Navbar />
                <main className="container py-20 text-center text-muted-foreground">
                    <p>Failed to load season details.</p>
                    <Button variant="link" asChild className="mt-4">
                        <Link to={`/media/tv/${mediaId}`} className="gap-2 items-center">
                            <ArrowLeft className="w-4 h-4" /> Back to Show
                        </Link>
                    </Button>
                </main>
            </>
        );
    }

    return (
        <>
            <Navbar />
            <main className="container py-20 min-h-screen">
                <Button variant="ghost" asChild className="mb-6 pl-0 hover:bg-transparent hover:text-primary gap-2">
                    <Link to={`/media/tv/${mediaId}`}>
                        <ArrowLeft className="w-4 h-4" /> Back to Show
                    </Link>
                </Button>

                <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
                    {/* Sidebar / Poster */}
                    <div className="w-full sm:w-64 lg:w-72 shrink-0 mx-auto lg:mx-0">
                        <div className="rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-border/60 aspect-2/3">
                            {seasonDetails.poster_path ? (
                                <img
                                    src={getImageUrl(seasonDetails.poster_path, 'w500')}
                                    alt={seasonDetails.name}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-muted">
                                    <span className="text-muted-foreground">No Image</span>
                                </div>
                            )}
                        </div>
                        <div className="mt-4 text-center lg:text-left space-y-2">
                            <h1 className="text-2xl font-bold">{seasonDetails.name}</h1>
                            <div className="flex items-center justify-center lg:justify-start gap-3 text-sm text-muted-foreground">
                                {seasonDetails.air_date && (
                                    <span className="flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {new Date(seasonDetails.air_date).getFullYear()}
                                    </span>
                                )}
                                <span className="flex items-center gap-1">
                                    <Star className="w-3.5 h-3.5 text-yellow-500" />
                                    {seasonDetails.vote_average.toFixed(1)}
                                </span>
                                <span>{seasonDetails.episodes.length} Episodes</span>
                            </div>
                        </div>
                    </div>

                    {/* Episodes List */}
                    <div className="flex-1 space-y-6">
                        {seasonDetails.overview && (
                            <div className="bg-muted/30 p-6 rounded-xl border border-border/50">
                                <h3 className="font-semibold mb-2 text-lg">Season Overview</h3>
                                <p className="text-muted-foreground leading-relaxed">{seasonDetails.overview}</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            <h2 className="text-xl font-semibold">Episodes</h2>
                            <div className="grid gap-4">
                                {seasonDetails.episodes.map((episode: Episode) => (
                                    <div
                                        key={episode.id}
                                        className="flex flex-col md:flex-row bg-card hover:bg-accent/50 transition-colors rounded-lg overflow-hidden border border-border/50 group"
                                    >
                                        {/* Episode Still */}
                                        <div className="w-full md:w-48 aspect-video md:aspect-video shrink-0 relative bg-muted">
                                            {episode.still_path ? (
                                                <img
                                                    src={getImageUrl(episode.still_path, 'w300')}
                                                    alt={episode.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <ImageOff className="w-8 h-8 text-muted-foreground/30" />
                                                </div>
                                            )}
                                            <div className="absolute top-2 left-2 bg-background/80 backdrop-blur-md px-2 py-0.5 rounded text-xs font-medium text-foreground/90">
                                                Ep {episode.episode_number}
                                            </div>
                                        </div>

                                        {/* Content */}
                                        <div className="p-4 flex flex-col justify-center flex-1 gap-2">
                                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                                <div>
                                                    <h3 className="font-medium text-base md:text-lg group-hover:text-primary transition-colors">
                                                        {episode.name}
                                                    </h3>
                                                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                                        {episode.air_date && (
                                                            <span>{new Date(episode.air_date).toLocaleDateString()}</span>
                                                        )}
                                                        {episode.runtime && (
                                                            <span className="flex items-center gap-1">
                                                                <Clock className="w-3 h-3" />
                                                                {episode.runtime}m
                                                            </span>
                                                        )}
                                                        {episode.vote_average > 0 && (
                                                            <span className="flex items-center gap-1 text-yellow-500/80">
                                                                <Star className="w-3 h-3 fill-current" />
                                                                {episode.vote_average.toFixed(1)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <p className="text-sm text-muted-foreground line-clamp-2 md:line-clamp-3 leading-relaxed">
                                                {episode.overview || "No overview available."}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </>
    );
};

export default SeasonDetail;
