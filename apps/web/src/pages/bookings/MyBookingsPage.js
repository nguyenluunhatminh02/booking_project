import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// automatic JSX runtime: no top-level React import required
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/lib/toast';
export function MyBookingsPage() {
    const { user } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const bookingsQ = useQuery({
        queryKey: ['bookings', 'my'],
        queryFn: async () => {
            const headers = user?.id ? { 'X-User-Id': user.id } : {};
            const { data } = await api.get('/bookings/my', { headers });
            return data;
        },
        enabled: !!user?.id,
    });
    const cancelMutation = useMutation({
        mutationFn: async ({ bookingId, status }) => {
            if (status === 'HOLD' || status === 'REVIEW') {
                const { data } = await api.post(`/bookings/${bookingId}/cancel`, { userId: user?.id });
                return data;
            }
            const { data } = await api.post(`/bookings/${bookingId}/cancel-paid-or-confirmed`, { userId: user?.id });
            return data;
        },
        onMutate: async ({ bookingId }) => {
            await queryClient.cancelQueries({ queryKey: ['bookings', 'my'] });
            const previous = queryClient.getQueryData(['bookings', 'my']);
            queryClient.setQueryData(['bookings', 'my'], (old) => old?.map((b) => (b.id === bookingId ? { ...b, status: 'CANCELLED' } : b)));
            return { previous };
        },
        onError: (err, _vars, ctx) => {
            if (ctx?.previous)
                queryClient.setQueryData(['bookings', 'my'], ctx.previous);
            toast.toast({ title: 'Cancel failed', description: toApiError(err).message, variant: 'error' });
        },
        onSuccess: () => {
            toast.toast({ title: 'Cancelled', variant: 'success' });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['bookings', 'my'] });
        },
    });
    const list = bookingsQ.data ?? [];
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: "My bookings" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "All bookings associated with your account." })] }), bookingsQ.isLoading ? (_jsxs("div", { className: "grid gap-4 md:grid-cols-2", children: [_jsx(Skeleton, { className: "h-24 w-full" }), _jsx(Skeleton, { className: "h-24 w-full" })] })) : null, _jsx("div", { className: "grid gap-4 md:grid-cols-2", children: list.map((b) => (_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsxs(CardTitle, { children: [b.property?.title ?? 'Booking', _jsxs("div", { className: "text-sm text-muted-foreground", children: [new Date(b.checkIn).toLocaleDateString(), " \u2192 ", new Date(b.checkOut).toLocaleDateString()] })] }) }), _jsxs(CardContent, { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-sm", children: ["Status: ", _jsx("span", { className: "font-medium", children: b.status })] }), _jsxs("div", { className: "text-sm", children: ["Total: ", b.totalPrice.toLocaleString(), " VND"] })] }), _jsxs("div", { className: "flex flex-col items-end gap-2", children: [_jsx(Link, { to: `/bookings/${b.id}`, className: "text-sm underline", children: "Details" }), b.status !== 'CANCELLED' ? (_jsx(Button, { variant: "destructive", size: "sm", onClick: () => {
                                                if (!confirm('Cancel this booking?'))
                                                    return;
                                                cancelMutation.mutate({ bookingId: b.id, status: b.status });
                                            }, disabled: cancelMutation.isPending, children: cancelMutation.isPending ? 'Cancelling…' : 'Cancel' })) : null] })] })] }, b.id))) })] }));
}
