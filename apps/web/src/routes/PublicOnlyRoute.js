import { jsx as _jsx } from "react/jsx-runtime";
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
export function PublicOnlyRoute() {
    const { user, isLoading } = useAuth();
    if (isLoading)
        return _jsx(FullScreenLoader, {});
    if (user)
        return _jsx(Navigate, { to: "/dashboard", replace: true });
    return _jsx(Outlet, {});
}
