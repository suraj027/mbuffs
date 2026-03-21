import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { fetchAdminUsersApi } from '@/lib/api';
import { AdminUser, AdminUsersResponse } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';

const ADMIN_USERS_QUERY_KEY = ['admin', 'users'];

const formatDate = (dateString: string | Date | undefined) => {
  if (!dateString) return 'Unknown';
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const getInitials = (user: AdminUser) => {
  const source = user.name || user.username || user.email || 'User';
  return source
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const Admin = () => {
  const { data, isLoading, isError, error } = useQuery<AdminUsersResponse, Error>({
    queryKey: ADMIN_USERS_QUERY_KEY,
    queryFn: fetchAdminUsersApi,
  });

  return (
    <>
      <Navbar />
      <main className="container py-8 max-w-5xl mx-auto px-4">
        <h1 className="text-3xl font-bold mb-2">Admin</h1>
        <p className="text-muted-foreground mb-8">All users and their recommendation preferences.</p>

        {isLoading ? (
          <Card>
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <CardDescription>Loading user data...</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Avatar</TableHead>
                    <TableHead className="px-4">Name / Username</TableHead>
                    <TableHead className="px-4">Email</TableHead>
                    <TableHead className="px-4">Role</TableHead>
                    <TableHead className="px-4">Provider</TableHead>
                    <TableHead className="px-4">Recommendations</TableHead>
                    <TableHead className="px-4">Category Recs</TableHead>
                    <TableHead className="px-4">Collections</TableHead>
                    <TableHead className="px-4">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 6 }).map((_, index) => (
                    <TableRow key={`skeleton-row-${index}`}>
                      <TableCell className="px-4"><Skeleton className="h-9 w-9 rounded-full" /></TableCell>
                      <TableCell className="px-4"><Skeleton className="h-4 w-44" /></TableCell>
                      <TableCell className="px-4"><Skeleton className="h-4 w-52" /></TableCell>
                      <TableCell className="px-4"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                      <TableCell className="px-4"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="px-4"><Skeleton className="h-5 w-9 rounded-full" /></TableCell>
                      <TableCell className="px-4"><Skeleton className="h-5 w-9 rounded-full" /></TableCell>
                      <TableCell className="px-4"><Skeleton className="h-4 w-8" /></TableCell>
                      <TableCell className="px-4"><Skeleton className="h-4 w-28" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : isError ? (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive">Failed to load users</CardTitle>
              <CardDescription>{error?.message || 'Unable to fetch admin user data.'}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <CardDescription>Total users: {data?.total ?? 0}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Avatar</TableHead>
                    <TableHead className="px-4">Name / Username</TableHead>
                    <TableHead className="px-4">Email</TableHead>
                    <TableHead className="px-4">Role</TableHead>
                    <TableHead className="px-4">Provider</TableHead>
                    <TableHead className="px-4">Recommendations</TableHead>
                    <TableHead className="px-4">Category Recs</TableHead>
                    <TableHead className="px-4">Collections</TableHead>
                    <TableHead className="px-4">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.users.map((user) => {
                    const avatarSrc = user.avatarUrl || user.image || undefined;
                    const role = user.role || 'user';

                    return (
                      <TableRow key={user.id}>
                        <TableCell className="px-4">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={avatarSrc} alt={user.name || user.email} referrerPolicy="no-referrer" />
                            <AvatarFallback>{getInitials(user)}</AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell className="px-4">
                          <div className="flex flex-col">
                            <span className="font-medium">{user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown'}</span>
                            <span className="text-xs text-muted-foreground">{user.username ? `@${user.username}` : 'No username'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          <div className="flex flex-col gap-1">
                            <span>{user.email}</span>
                            <Badge variant={user.emailVerified ? 'default' : 'secondary'} className="w-fit">
                              {user.emailVerified ? 'Verified' : 'Unverified'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
                            {role}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4">
                          <div className="flex flex-wrap gap-1">
                            {(user.providers ?? []).map((provider) => (
                              <Badge key={provider} variant="outline" className="capitalize">
                                {provider === 'credential' ? 'email' : provider}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          <Switch checked={Boolean(user.recommendationsEnabled)} disabled />
                        </TableCell>
                        <TableCell className="px-4">
                          <Switch checked={Boolean(user.categoryRecommendationsEnabled)} disabled />
                        </TableCell>
                        <TableCell className="px-4">{user.collectionCount}</TableCell>
                        <TableCell className="px-4">{formatDate(user.createdAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
};

export default Admin;
