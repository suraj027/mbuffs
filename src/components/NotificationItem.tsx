import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markNotificationReadApi, deleteNotificationApi, getImageUrl } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import type { NotificationItem as NotificationItemType, MediaSharePayload, CollectionItemAddedPayload } from '@/lib/types';

interface NotificationItemProps {
  notification: NotificationItemType;
  onNavigate?: () => void;
}

const formatRelativeTime = (dateStr: string): string => {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const NotificationItemComponent = ({ notification, onNavigate }: NotificationItemProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const markReadMutation = useMutation({
    mutationFn: () => markNotificationReadApi(notification.id),
    onMutate: () => {
      queryClient.setQueryData<{ count: number }>(['notifications', 'unread-count'], (old) => {
        if (!old || old.count <= 0) return old;
        return { count: old.count - 1 };
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteNotificationApi(notification.id),
    onMutate: () => {
      if (!notification.is_read) {
        queryClient.setQueryData<{ count: number }>(['notifications', 'unread-count'], (old) => {
          if (!old || old.count <= 0) return old;
          return { count: old.count - 1 };
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleClick = () => {
    haptics.trigger('selection');

    if (!notification.is_read) {
      markReadMutation.mutate();
    }

    if (notification.type === 'media_share') {
      let payload: MediaSharePayload;
      try {
        payload = JSON.parse(notification.payload);
      } catch {
        return;
      }

      const path = payload.media_type === 'person'
        ? `/person/${payload.tmdb_id}`
        : `/media/${payload.media_type}/${payload.tmdb_id}`;

      onNavigate?.();
      navigate(path);
    } else if (notification.type === 'collection_item_added') {
      let payload: CollectionItemAddedPayload;
      try {
        payload = JSON.parse(notification.payload);
      } catch {
        return;
      }

      onNavigate?.();
      navigate(`/collection/${payload.collection_id}`);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptics.trigger('selection');
    deleteMutation.mutate();
  };

  if (notification.type === 'media_share') {
    let payload: MediaSharePayload;
    try {
      payload = JSON.parse(notification.payload);
    } catch {
      return null;
    }

    return (
      <div className="group relative">
        <button
          type="button"
          onClick={handleClick}
          className="flex items-center gap-3 w-full px-3 py-3 hover:bg-accent transition-colors text-left rounded-lg"
        >
          <img
            src={getImageUrl(payload.poster_path, 'w92')}
            alt=""
            className="h-12 w-8 rounded object-cover bg-muted shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
          />

          <div className="flex-1 min-w-0">
            <p className="text-sm leading-snug">
              <span className="font-medium">{notification.sender_name || 'Someone'}</span>
              {' shared '}
              <span className="font-medium">{payload.title}</span>
            </p>
            {payload.message && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                "{payload.message}"
              </p>
            )}
            <div className="mt-0.5 flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground">
                {formatRelativeTime(notification.created_at)}
              </p>
              {!notification.is_read && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
              )}
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {notification.sender_avatar_url ? (
              <img
                src={notification.sender_avatar_url}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserCircle className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1.5 right-1.5 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          aria-label="Remove notification"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  if (notification.type === 'collection_item_added') {
    let payload: CollectionItemAddedPayload;
    try {
      payload = JSON.parse(notification.payload);
    } catch {
      return null;
    }

    return (
      <div className="group relative">
        <button
          type="button"
          onClick={handleClick}
          className="flex items-center gap-3 w-full px-3 py-3 hover:bg-accent transition-colors text-left rounded-lg"
        >
          <img
            src={getImageUrl(payload.poster_path ?? null, 'w92')}
            alt=""
            className="h-12 w-8 rounded object-cover bg-muted shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
          />

          <div className="flex-1 min-w-0">
            <p className="text-sm leading-snug">
              <span className="font-medium">{notification.sender_name || 'Someone'}</span>
              {' added '}
              <span className="font-medium">{payload.title || 'an item'}</span>
              {' to '}
              <span className="font-medium">{payload.collection_name || 'a collection'}</span>
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground">
                {formatRelativeTime(notification.created_at)}
              </p>
              {!notification.is_read && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
              )}
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {notification.sender_avatar_url ? (
              <img
                src={notification.sender_avatar_url}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserCircle className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1.5 right-1.5 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          aria-label="Remove notification"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return null;
};
