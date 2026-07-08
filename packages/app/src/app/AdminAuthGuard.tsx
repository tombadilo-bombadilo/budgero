import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { useOptionalClerkAuth, useProfile } from '@entities/user/api/useAuth';
import { AdminAccessRequiredCard } from '@/app/layout/AdminAccessRequiredCard';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { buildAuthRedirect } from '@shared/lib/auth-redirect';
import { isConnectivityKnown } from '@shared/runtime/connectivity-service';
import { useSelfHostAuth } from '@shared/model/useSelfHostAuth';

export default function AdminAuthGuard() {
  const location = useLocation();
  const { data: user, isLoading } = useProfile();
  const clerkAuth = useOptionalClerkAuth();
  const isLoaded = clerkAuth?.isLoaded ?? true;
  const isSignedIn = clerkAuth?.isSignedIn ?? false;
  const token = useSelfHostAuth((state) => state.token);
  const connectivityKnown = isConnectivityKnown();

  if (!IS_SELF_HOSTABLE_BUILD && !isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!IS_SELF_HOSTABLE_BUILD && !isSignedIn) {
    return <Navigate to={buildAuthRedirect(location, { mode: 'signin' })} replace />;
  }
  if (IS_SELF_HOSTABLE_BUILD && !token) {
    return <Navigate to={buildAuthRedirect(location)} replace />;
  }
  if (IS_SELF_HOSTABLE_BUILD && token && !connectivityKnown) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user || !user.is_admin) {
    return <AdminAccessRequiredCard />;
  }

  return <Outlet />;
}
