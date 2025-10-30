import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, toApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/lib/toast';
export function BookingDetailPage() {
    const { id } = useParams();
    const { user } = useAuth();
    const toast = useToast();
    const queryClient = useQueryClient();
    const [cancelAt, setCancelAt] = useState('');
    const bookingQ = useQuery({
        queryKey: ['booking', id],
        queryFn: async () => {
            const { data } = await api.get(`/bookings/${id}`);
            return data;
        },
        enabled: !!id,
    });
    const previewQ = useQuery({
        queryKey: ['booking', id, 'preview', cancelAt],
        queryFn: async () => {
            const params = cancelAt ? `?cancelAt=${encodeURIComponent(new Date(cancelAt).toISOString())}` : '';
            const { data } = await api.get(`/bookings/${id}/preview-refund${params}`);
            return data;
        },
        enabled: !!id && !!cancelAt,
    });
    const cancelMutation = useMutation({
        mutationFn: async (bookingId) => {
            const status = bookingQ.data?.status;
            if (status === 'HOLD' || status === 'REVIEW') {
                const { data } = await api.post(`/bookings/${bookingId}/cancel`, { userId: user?.id });
                return data;
            }
            const { data } = await api.post(`/bookings/${bookingId}/cancel-paid-or-confirmed`, { userId: user?.id });
            return data;
        },
        onMutate: async (bookingId) => {
            await queryClient.cancelQueries({ queryKey: ['booking', id] });
            const previous = queryClient.getQueryData(['booking', id]);
            queryClient.setQueryData(['booking', id], (old) => ({ ...old, status: 'CANCELLED' }));
            queryClient.setQueryData(['bookings', 'my'], (old) => old?.map((b) => (b.id === bookingId ? { ...b, status: 'CANCELLED' } : b)));
            return { previous };
        },
        onError: (err, _vars, ctx) => {
            if (ctx?.previous)
                queryClient.setQueryData(['booking', id], ctx.previous);
            toast.toast({ title: 'Cancel failed', description: toApiError(err).message, variant: 'error' });
        },
        onSuccess: () => {
            toast.toast({ title: 'Cancelled', variant: 'success' });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['booking', id] });
            queryClient.invalidateQueries({ queryKey: ['bookings', 'my'] });
        },
    });
    if (bookingQ.isLoading) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsx(Skeleton, { className: "h-8 w-1/3" }), _jsx(Skeleton, { className: "h-36 w-full" })] }));
    }
    const b = bookingQ.data;
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { children: _jsx("h1", { className: "text-2xl font-semibold", children: "Booking detail" }) }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: b?.property?.title ?? 'Booking' }) }), _jsxs(CardContent, { children: [_jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { children: ["Booking ID: ", _jsx("span", { className: "font-mono", children: b?.id })] }), _jsxs("div", { children: ["Status: ", _jsx("span", { className: "font-medium", children: b?.status })] }), _jsxs("div", { children: ["Dates: ", b?.checkIn ? new Date(b.checkIn).toLocaleString() : '-', " \u2192 ", b?.checkOut ? new Date(b.checkOut).toLocaleString() : '-'] }), _jsxs("div", { children: ["Total: ", b?.totalPrice?.toLocaleString(), " VND"] })] }), _jsx("hr", { className: "my-4" }), _jsxs("div", { className: "grid gap-3 md:grid-cols-3", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "block text-sm", children: "Preview refund (cancelAt)" }), _jsx("input", { type: "date", value: cancelAt, onChange: (e) => setCancelAt(e.target.value), className: "h-9 w-full rounded-md border border-input px-3" })] }), _jsxs("div", { className: "md:col-span-3", children: [_jsx(Button, { onClick: () => previewQ.refetch(), disabled: !cancelAt, children: "Preview refund" }), previewQ.data ? _jsx("pre", { className: "mt-3 whitespace-pre-wrap text-sm", children: JSON.stringify(previewQ.data, null, 2) }) : null] })] }), _jsx("div", { className: "pt-4", children: b?.status !== 'CANCELLED' ? (_jsx(Button, { variant: "destructive", onClick: () => {
                                        if (!confirm('Are you sure you want to cancel this booking?'))
                                            return;
                                        cancelMutation.mutate(b.id);
                                    }, disabled: cancelMutation.isPending, children: cancelMutation.isPending ? 'Cancelling…' : 'Cancel booking' })) : (_jsx("div", { className: "text-sm text-muted-foreground", children: "This booking is cancelled." })) })] })] })] }));
}
