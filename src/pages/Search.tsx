import { useSearchParams } from "react-router-dom";
import { useQuery } from '@tanstack/react-query';
import { MovieGrid } from "@/components/MovieGrid";
import { searchMoviesApi } from "@/lib/api";
import { Navbar } from "@/components/Navbar";
import { SearchResults, Movie } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";

const Search = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";

  const searchMoviesQueryKey = ['movies', 'search', query];

  const { 
    data: searchData,
    isLoading,
    isError,
    error 
  } = useQuery<SearchResults, Error>({
    queryKey: searchMoviesQueryKey,
    queryFn: () => searchMoviesApi(query), // Pass query to the API function
    enabled: !!query, // Only run the query if there is a search term
    staleTime: 1000 * 60 * 5, // Cache search results for 5 minutes
  });

  const movies = searchData?.results || [];

  return (
    <>
      <Navbar /> {/* Navbar handles its own auth state */}
      <main className="container py-8">
        <h1 className="text-3xl font-bold mb-2">Search Results</h1>
        {query && (
          <p className="text-muted-foreground mb-8">
            Showing results for "<span className='font-medium text-foreground'>{query}</span>"
          </p>
        )}
        
        {!query && (
          <Alert>
            <Terminal className="h-4 w-4" />
            <AlertTitle>Start Searching!</AlertTitle>
            <AlertDescription>
              Enter a movie title in the search bar above to find movies.
            </AlertDescription>
          </Alert>
        )}

        {isLoading && query ? (
          // Skeleton loading state
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="aspect-2/3 w-full rounded-md" />
                  <Skeleton className="h-4 w-[80%]" />
                  <Skeleton className="h-4 w-[50%]" />
                </div>
              ))}
            </div>
          </div>
        ) : isError ? (
           <div className="text-destructive text-center py-12">
             <p>Error searching for movies: {error.message}</p>
           </div>
        ) : query && movies.length === 0 && !isLoading ? (
            <Alert variant="destructive">
              <Terminal className="h-4 w-4" />
              <AlertTitle>No Results Found</AlertTitle>
              <AlertDescription>
                Your search for "{query}" did not return any results. Try different keywords.
              </AlertDescription>
            </Alert>
        ) : query ? (
          <MovieGrid movies={movies} />
        ) : null}
      </main>
    </>
  );
};

export default Search;
