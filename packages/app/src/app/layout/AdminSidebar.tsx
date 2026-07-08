import { cloneElement, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@shared/lib/utils';
import { Users, Shield, Home, LogOut, Database, ChevronLeft } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { useLogout } from '@entities/user/api/useAuth';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/ui/tooltip';

const adminRoutes = [
  {
    path: '/admin',
    label: 'Dashboard',
    icon: Home,
    exact: true,
  },
  {
    path: '/admin/users',
    label: 'Users',
    icon: Users,
  },
  {
    path: '/admin/database',
    label: 'Database',
    icon: Database,
  },
];

export default function AdminSidebar() {
  const location = useLocation();
  const logout = useLogout();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (path: string, exact = false) => {
    if (exact) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          'bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-300 ease-in-out',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Admin Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-3">
          <div
            className={cn(
              'flex items-center',
              collapsed ? 'justify-center' : 'justify-between gap-2'
            )}
          >
            <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
              <Shield className="text-purple-600 w-6 h-6" />
              {!collapsed && (
                <div>
                  <h2 className="font-bold text-lg">Admin Panel</h2>
                  <p className="text-xs text-muted-foreground">Budgero Management</p>
                </div>
              )}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setCollapsed((prev) => !prev)}
              className={cn(
                'ml-auto text-muted-foreground hover:text-foreground transition-transform',
                collapsed && 'rotate-180'
              )}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Navigation */}
        <nav className={cn('flex-1 space-y-1', collapsed ? 'px-2 py-4' : 'p-4')}>
          {adminRoutes.map((route) => {
            const Icon = route.icon;
            const active = isActive(route.path, route.exact);

            const link = (
              <Link
                to={route.path}
                className={cn(
                  'flex items-center rounded-lg text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
                  active
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <Icon className="w-4 h-4" />
                {!collapsed && <span>{route.label}</span>}
                {collapsed && <span className="sr-only">{route.label}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={route.path} delayDuration={200}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" align="center">
                    {route.label}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return cloneElement(link, { key: route.path });
          })}
        </nav>

        {/* Footer Actions */}
        <div
          className={cn(
            'border-t border-gray-200 dark:border-gray-700 space-y-2',
            collapsed ? 'px-2 py-3' : 'p-4'
          )}
        >
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Link to="/dashboard">
                <Button
                  variant="outline"
                  className={cn('w-full', collapsed ? 'justify-center' : 'justify-start')}
                  size="sm"
                >
                  <Home className={cn('w-4 h-4', !collapsed && 'mr-2')} />
                  {!collapsed && 'Back to App'}
                  {collapsed && <span className="sr-only">Back to App</span>}
                </Button>
              </Link>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Back to App</TooltipContent>}
          </Tooltip>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  'w-full text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20',
                  collapsed ? 'justify-center' : 'justify-start'
                )}
                size="sm"
                onClick={() => logout.mutate()}
              >
                <LogOut className={cn('w-4 h-4', !collapsed && 'mr-2')} />
                {!collapsed && 'Logout'}
                {collapsed && <span className="sr-only">Logout</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Logout</TooltipContent>}
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
