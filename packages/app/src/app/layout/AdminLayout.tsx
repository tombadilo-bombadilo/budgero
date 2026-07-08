import { Outlet, Navigate } from 'react-router-dom';
import { useProfile } from '@entities/user/api/useAuth';
import { getUserAccessStatus, canAccessAdmin } from '@shared/model/access';
import AdminSidebar from '@/app/layout/AdminSidebar';
import { AdminAccessRequiredCard } from '@/app/layout/AdminAccessRequiredCard';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { isConnectivityKnown } from '@shared/runtime/connectivity-service';

export default function AdminLayout() {
  const { data: user, isLoading } = useProfile();
  const connectivityKnown = isConnectivityKnown();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse">Loading admin panel...</div>
      </div>
    );
  }
  if (IS_SELF_HOSTABLE_BUILD && !connectivityKnown && !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse">Loading admin panel...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  const accessStatus = getUserAccessStatus(user);
  if (!canAccessAdmin(accessStatus)) {
    return <AdminAccessRequiredCard />;
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <AdminSidebar />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
