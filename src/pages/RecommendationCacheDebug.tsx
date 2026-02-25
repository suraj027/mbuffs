import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock3, Database, RefreshCw, ShieldAlert } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { fetchRecommendationCacheDebugApi } from '@/lib/api';
import { RecommendationCacheDebugResponse } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const CACHE_DEBUG_QUERY_KEY = ['recommendations', 'cache', 'debug'];

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const RecommendationCacheDebug = () => {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<RecommendationCacheDebugResponse, Error>({
    queryKey: CACHE_DEBUG_QUERY_KEY,
    queryFn: fetchRecommendationCacheDebugApi,
    staleTime: 30 * 1000,
  });

  const cache = data?.cache;

  return (
    <>
      <Navbar />
      <main className="container py-6 md:py-10">
        <section className="mb-6 flex items-center justify-between gap-4">
          <div>
            <Link
              to="/profile"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Profile
            </Link>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Recommendation Cache</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Debug view for recommendation snapshots (TTL: {data?.ttl_minutes ?? 30} minutes).
            </p>
          </div>

          <Button onClick={() => refetch()} disabled={isFetching} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </section>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : isError ? (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <ShieldAlert className="h-5 w-5" />
                Unable to load cache debug
              </CardTitle>
              <CardDescription>{error?.message || 'This endpoint may be restricted to authorized users.'}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Entries</CardDescription>
                  <CardTitle className="text-3xl">{cache?.total ?? 0}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Fresh</CardDescription>
                  <CardTitle className="text-3xl text-emerald-500">{cache?.fresh ?? 0}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Expired</CardDescription>
                  <CardTitle className="text-3xl text-amber-500">{cache?.expired ?? 0}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Cache Entries
                </CardTitle>
                <CardDescription>
                  Showing newest entries first for {data?.allowed_debug_email}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!cache?.entries?.length ? (
                  <p className="text-sm text-muted-foreground">No cached recommendation entries found yet.</p>
                ) : (
                  <div className="space-y-3">
                    {cache.entries.map((entry) => {
                      const isFresh = new Date(entry.expires_at).getTime() > Date.now();

                      return (
                        <div
                          key={`${entry.cache_key}-${entry.updated_at}`}
                          className="rounded-lg border p-3 bg-card/50"
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <Badge variant={isFresh ? 'default' : 'secondary'}>
                              {isFresh ? 'fresh' : 'expired'}
                            </Badge>
                            <Badge variant="outline">{entry.cache_version}</Badge>
                            <Badge variant="outline">{formatBytes(entry.payload_size)}</Badge>
                          </div>

                          <p className="text-xs text-muted-foreground break-all">{entry.cache_key}</p>

                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3 w-3" /> Expires {formatDateTime(entry.expires_at)}
                            </span>
                            <span>Created {formatDateTime(entry.created_at)}</span>
                            <span>Updated {formatDateTime(entry.updated_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </>
  );
};

export default RecommendationCacheDebug;
