import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
const propertiesKey = ['properties', 'options'];
function generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export function BookingHoldPage() {
    const { user } = useAuth();
    const [formState, setFormState] = useState({
        propertyId: '',
        checkIn: '',
        checkOut: '',
    });
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const propertiesQuery = useQuery({
        queryKey: propertiesKey,
        queryFn: async () => {
            const { data } = await api.get('/properties', {
                params: { take: 50 },
            });
            return data.items;
        },
    });
    const holdMutation = useMutation({
        mutationFn: async ({ propertyId, checkIn, checkOut, }) => {
            if (!user?.id) {
                throw new Error('You must be logged in to create a hold.');
            }
            const headers = {
                'X-User-Id': user.id,
                'Idempotency-Key': generateIdempotencyKey(),
            };
            const { data } = await api.post('/bookings/hold', {
                propertyId,
                checkIn,
                checkOut,
            }, { headers });
            return data;
        },
        onSuccess: (data) => {
            setResult(data);
            setError(null);
        },
        onError: (err) => {
            const apiError = toApiError(err);
            setError(apiError.message);
            setResult(null);
        },
    });
    const handleSubmit = (event) => {
        event.preventDefault();
        holdMutation.mutate(formState);
    };
    const cancelMutation = useMutation({
        mutationFn: async (bookingId) => {
            if (!user?.id)
                throw new Error('Login required');
            const { data } = await api.post(`/bookings/${bookingId}/cancel`, {
                userId: user.id,
            });
            return data;
        },
        onSuccess: () => {
            // best-effort: refetch or mark result cancelled locally
            if (result)
                setResult({ ...result, status: 'CANCELLED' });
            setError(null);
        },
        onError: (err) => {
            setError(toApiError(err).message);
        },
    });
    const propertyOptions = useMemo(() => propertiesQuery.data ?? [], [propertiesQuery.data]);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: "Create booking hold" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Reserve inventory for a guest while payments or reviews are pending." })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Hold request" }), _jsx(CardDescription, { children: "Select a property and provide the desired stay range. The backend will automatically determine if the booking should be placed on hold or routed to manual review." })] }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-2", onSubmit: handleSubmit, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "propertyId", children: "Property" }), _jsxs("select", { id: "propertyId", required: true, value: formState.propertyId, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                propertyId: event.target.value,
                                            })), className: "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", children: [_jsx("option", { value: "", children: "Select property" }), propertyOptions.map((option) => (_jsx("option", { value: option.id, children: option.title }, option.id)))] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "checkIn", children: "Check-in" }), _jsx(Input, { id: "checkIn", type: "date", required: true, value: formState.checkIn, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                checkIn: event.target.value,
                                            })) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "checkOut", children: "Check-out" }), _jsx(Input, { id: "checkOut", type: "date", required: true, value: formState.checkOut, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                checkOut: event.target.value,
                                            })) })] }), error ? (_jsx("p", { className: "md:col-span-2 text-sm text-destructive", children: error })) : null, _jsx("div", { className: "md:col-span-2", children: _jsx(Button, { type: "submit", disabled: holdMutation.isPending, children: holdMutation.isPending ? 'Creating hold…' : 'Create hold' }) })] }) })] }), result ? (_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Hold created" }), _jsxs(CardDescription, { children: ["Booking ID ", _jsx("span", { className: "font-mono", children: result.id })] })] }), _jsxs(CardContent, { className: "space-y-3 text-sm", children: [_jsxs("p", { children: ["Status:", ' ', _jsx("span", { className: "font-medium", children: result.status === 'REVIEW'
                                            ? 'Requires manual review'
                                            : result.status })] }), _jsxs("p", { children: ["Total price: ", result.totalPrice.toLocaleString(), " VND"] }), _jsxs("p", { children: ["Hold expires at:", ' ', result.holdExpiresAt
                                        ? new Date(result.holdExpiresAt).toLocaleString()
                                        : 'N/A'] }), result.fraud ? (_jsxs("div", { children: [_jsx("p", { className: "font-medium", children: "Fraud assessment" }), _jsxs("p", { children: ["Level: ", _jsx("span", { className: "capitalize", children: result.fraud.level }), ' ', "\u00B7 Score: ", result.fraud.score] }), result.fraud.reasons.length ? (_jsx("ul", { className: "mt-1 list-disc pl-4 text-muted-foreground", children: result.fraud.reasons.map((reason) => (_jsx("li", { children: reason }, reason))) })) : null] })) : null, _jsx("div", { className: "pt-2", children: result.status !== 'CANCELLED' ? (_jsx(Button, { variant: "destructive", onClick: () => cancelMutation.mutate(result.id), disabled: cancelMutation.isPending, children: cancelMutation.isPending ? 'Cancelling…' : 'Cancel hold' })) : (_jsx("p", { className: "text-sm text-muted-foreground", children: "This hold is cancelled." })) })] })] })) : null] }));
}
