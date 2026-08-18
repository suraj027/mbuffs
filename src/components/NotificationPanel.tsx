import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, CheckCheck, Trash2, Loader2 } from 'lucide-react';
import { fetchNotificationsApi, markAllNotificationsReadApi, clearAllNotificationsApi } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { NotificationItemComponent } from './NotificationItem';

interface NotificationPanelProps {
  onClose?: () => void;
}

export const NotificationPanel = ({ onClose }: NotificationPanelProps) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotificationsApi(),
    staleTime: 1000 * 15,
  });

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsReadApi,
    onMutate: () => {
      queryClient.setQueryData<{ count: number }>(['notifications', 'unread-count'], () => ({ count: 0 }));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: clearAllNotificationsApi,
    onMutate: () => {
      queryClient.setQueryData<{ count: number }>(['notifications', 'unread-count'], () => ({ count: 0 }));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleMarkAll = () => {
    haptics.trigger('selection');
    markAllMutation.mutate();
  };

  const handleClearAll = () => {
    haptics.trigger('medium');
    clearAllMutation.mutate();
  };

  const notifications = data?.notifications ?? [];
  const hasUnread = (data?.unreadCount ?? 0) > 0;
  const hasNotifications = notifications.length > 0;
  const isActing = markAllMutation.isPending || clearAllMutation.isPending;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Notifications</h3>
        <div className="flex items-center gap-1">
          {hasUnread && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={handleMarkAll}
              disabled={isActing}
            >
              {markAllMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              Mark all read
            </Button>
          )}
          {hasNotifications && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={handleClearAll}
              disabled={isActing}
            >
              {clearAllMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Clear all
            </Button>
          )}
        </div>
      </div>

      <div className="custom-scrollbar max-h-[60vh] overflow-y-auto overscroll-contain">
        <div className="py-1">
          {isLoading && (
            <div className="space-y-1 px-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="h-12 w-8 rounded shrink-0" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">No notifications yet</p>
            </div>
          )}

          {!isLoading && notifications.map((notification) => (
            <NotificationItemComponent
              key={notification.id}
              notification={notification}
              onNavigate={onClose}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
