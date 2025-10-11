import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullScreenLoader />;
  if (!user)
    return <Navigate to="/login" replace state={{ from: location }} />;

  return <Outlet />;
}
