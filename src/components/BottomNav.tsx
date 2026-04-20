import { NavLink, useLocation } from 'react-router-dom';
import { Home, LayoutGrid, Search, Sparkles, User, type LucideIcon } from 'lucide-react';
import { haptics } from '@/lib/haptics';

const HIDDEN_PATHS = ['/login'];

type Tab = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  action?: 'search';
};

const tabs: Tab[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/categories', label: 'Categories', icon: LayoutGrid },
  { to: 'search', label: 'Search', icon: Search, action: 'search' },
  { to: '/for-you', label: 'For You', icon: Sparkles },
  { to: '/profile', label: 'Profile', icon: User },
];

export const BottomNav = () => {
  const location = useLocation();

  if (HIDDEN_PATHS.some((path) => location.pathname.startsWith(path))) {
    return null;
  }

  const handleSearchClick = (event: React.MouseEvent) => {
    event.preventDefault();
    haptics.trigger('medium');
    window.dispatchEvent(new Event('open-search'));
  };

  const handleTabClick = (targetPath: string) => () => {
    if (location.pathname !== targetPath) {
      haptics.trigger('selection');
    }
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden glass border-t border-border/60"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <ul className="flex items-stretch justify-around h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;

          if (tab.action === 'search') {
            return (
              <li key={tab.label} className="flex-1">
                <button
                  type="button"
                  onClick={handleSearchClick}
                  className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors active:scale-95"
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium">{tab.label}</span>
                </button>
              </li>
            );
          }

          return (
            <li key={tab.label} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                onClick={handleTabClick(tab.to)}
                className={({ isActive }) =>
                  `flex h-full w-full flex-col items-center justify-center gap-1 transition-colors active:scale-95 ${
                    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 2} />
                    <span className="text-[10px] font-medium">{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
