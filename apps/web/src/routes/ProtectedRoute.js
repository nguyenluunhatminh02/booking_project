import { jsx as _jsx } from "react/jsx-runtime";
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
export function ProtectedRoute() {
    const { user, isLoading } = useAuth();
    const location = useLocation();
    if (isLoading)
        return _jsx(FullScreenLoader, {});
    if (!user)
        return _jsx(Navigate, { to: "/login", replace: true, state: { from: location } });
    return _jsx(Outlet, {});
}
