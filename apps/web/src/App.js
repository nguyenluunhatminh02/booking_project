import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { PropertiesListPage } from '@/pages/properties/PropertiesListPage';
import { PropertyDetailPage } from '@/pages/properties/PropertyDetailPage';
import { BookingHoldPage } from '@/pages/bookings/BookingHoldPage';
import { BookingsToolsPage } from '@/pages/bookings/BookingsToolsPage';
import { MyBookingsPage } from '@/pages/bookings/MyBookingsPage';
import { BookingDetailPage } from '@/pages/bookings/BookingDetailPage';
import { ReviewManagerPage } from '@/pages/reviews/ReviewManagerPage';
import { InvoiceToolsPage } from '@/pages/invoices/InvoiceToolsPage';
function App() {
    return (_jsx(AuthProvider, { children: _jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsxs(Route, { element: _jsx(PublicOnlyRoute, {}), children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/register", element: _jsx(RegisterPage, {}) })] }), _jsx(Route, { element: _jsx(ProtectedRoute, {}), children: _jsxs(Route, { element: _jsx(AppLayout, {}), children: [_jsx(Route, { index: true, element: _jsx(Navigate, { to: "/dashboard", replace: true }) }), _jsx(Route, { path: "/dashboard", element: _jsx(DashboardPage, {}) }), _jsx(Route, { path: "/properties", element: _jsx(PropertiesListPage, {}) }), _jsx(Route, { path: "/properties/:id", element: _jsx(PropertyDetailPage, {}) }), _jsx(Route, { path: "/bookings", element: _jsx(MyBookingsPage, {}) }), _jsx(Route, { path: "/bookings/:id", element: _jsx(BookingDetailPage, {}) }), _jsx(Route, { path: "/bookings/hold", element: _jsx(BookingHoldPage, {}) }), _jsx(Route, { path: "/bookings/tools", element: _jsx(BookingsToolsPage, {}) }), _jsx(Route, { path: "/reviews", element: _jsx(ReviewManagerPage, {}) }), _jsx(Route, { path: "/invoices", element: _jsx(InvoiceToolsPage, {}) })] }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/dashboard", replace: true }) })] }) }) }));
}
export default App;
