import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Outlet, NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/lib/toast';
const NAV_ITEMS = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/properties', label: 'Properties' },
    { to: '/bookings', label: 'My bookings' },
    { to: '/bookings/hold', label: 'Booking Hold' },
    { to: '/bookings/tools', label: 'Booking Tools' },
    { to: '/reviews', label: 'Reviews' },
    { to: '/invoices', label: 'Invoices' },
];
export function AppLayout() {
    const { user, logout } = useAuth();
    return (_jsxs("div", { className: "min-h-screen bg-background", children: [_jsx("header", { className: "border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60", children: _jsxs("div", { className: "mx-auto flex max-w-6xl flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-2 md:flex-row md:items-center md:gap-6", children: [_jsx("span", { className: "text-lg font-semibold", children: "Booking Control Center" }), _jsx("nav", { className: "flex flex-wrap gap-4 text-sm text-muted-foreground", children: NAV_ITEMS.map((item) => (_jsx(NavLink, { to: item.to, className: ({ isActive }) => cn('transition-colors hover:text-foreground', isActive ? 'text-foreground font-medium' : undefined), children: item.label }, item.to))) })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-sm text-muted-foreground", children: user?.email ?? user?.id ?? 'Guest' }), _jsx(Button, { variant: "outline", size: "sm", onClick: logout, children: "Logout" })] })] }) }), _jsx("main", { className: "mx-auto w-full max-w-6xl px-6 py-8", children: _jsx(ToastProvider, { children: _jsx(Outlet, {}) }) })] }));
}
