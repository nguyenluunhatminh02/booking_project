import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { api, toApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
export function BookingsToolsPage() {
    const [seedHost, setSeedHost] = useState('u1');
    const [seedFrom, setSeedFrom] = useState('2025-12-01');
    const [seedNights, setSeedNights] = useState('7');
    const [seedPrice, setSeedPrice] = useState('1000000');
    const [seedRemaining, setSeedRemaining] = useState('2');
    const [seedTitle, setSeedTitle] = useState('Dev Property');
    const [seedResult, setSeedResult] = useState(null);
    const [error, setError] = useState(null);
    const [forceBookingId, setForceBookingId] = useState('');
    const [forceStatus, setForceStatus] = useState('HOLD');
    const [forceHoldExpiresAt, setForceHoldExpiresAt] = useState('');
    const [forceResult, setForceResult] = useState(null);
    const [previewBookingId, setPreviewBookingId] = useState('');
    const [previewCancelAt, setPreviewCancelAt] = useState('');
    const [previewResult, setPreviewResult] = useState(null);
    const [expireResult, setExpireResult] = useState(null);
    const [cancelPaidBookingId, setCancelPaidBookingId] = useState('');
    const [cancelPaidResult, setCancelPaidResult] = useState(null);
    const submitSeed = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            const { data } = await api.post('/bookings/dev/seed-basic', {
                hostId: seedHost,
                from: seedFrom,
                nights: seedNights,
                price: seedPrice,
                remaining: seedRemaining,
                title: seedTitle,
            });
            setSeedResult(data);
        }
        catch (err) {
            setError(toApiError(err).message);
            setSeedResult(null);
        }
    };
    const doForce = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            const body = { status: forceStatus };
            if (forceHoldExpiresAt)
                body.holdExpiresAt = new Date(forceHoldExpiresAt).toISOString();
            const { data } = await api.post(`/bookings/dev/force-status/${forceBookingId}`, body);
            setForceResult(data);
        }
        catch (err) {
            setError(toApiError(err).message);
            setForceResult(null);
        }
    };
    const doPreview = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            const params = previewCancelAt ? `?cancelAt=${encodeURIComponent(new Date(previewCancelAt).toISOString())}` : '';
            const { data } = await api.get(`/bookings/${previewBookingId}/preview-refund${params}`);
            setPreviewResult(data);
        }
        catch (err) {
            setError(toApiError(err).message);
            setPreviewResult(null);
        }
    };
    const doExpire = async () => {
        setError(null);
        try {
            const { data } = await api.post('/bookings/expire-holds');
            setExpireResult(data);
        }
        catch (err) {
            setError(toApiError(err).message);
            setExpireResult(null);
        }
    };
    const doCancelPaid = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            const { data } = await api.post(`/bookings/${cancelPaidBookingId}/cancel-paid-or-confirmed`, {
                userId: 'host',
            });
            setCancelPaidResult(data);
        }
        catch (err) {
            setError(toApiError(err).message);
            setCancelPaidResult(null);
        }
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: "Booking tools (dev/admin)" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Utilities to exercise booking-related backend endpoints for development/testing." })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Seed basic property + availability" }), _jsx(CardDescription, { children: "Quickly create a property with consecutive availability days for local testing." })] }), _jsxs(CardContent, { children: [_jsxs("form", { className: "grid gap-3 md:grid-cols-3", onSubmit: submitSeed, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Host ID" }), _jsx(Input, { value: seedHost, onChange: (e) => setSeedHost(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "From" }), _jsx(Input, { type: "date", value: seedFrom, onChange: (e) => setSeedFrom(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Nights" }), _jsx(Input, { value: seedNights, onChange: (e) => setSeedNights(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Price" }), _jsx(Input, { value: seedPrice, onChange: (e) => setSeedPrice(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Remaining" }), _jsx(Input, { value: seedRemaining, onChange: (e) => setSeedRemaining(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Title (optional)" }), _jsx(Input, { value: seedTitle, onChange: (e) => setSeedTitle(e.target.value) })] }), _jsx("div", { className: "md:col-span-3", children: _jsx(Button, { type: "submit", children: "Create demo property" }) })] }), seedResult ? (_jsx("pre", { className: "mt-3 whitespace-pre-wrap text-sm", children: JSON.stringify(seedResult, null, 2) })) : null] })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Expire holds" }), _jsx(CardDescription, { children: "Run a sweep to expire HOLD/REVIEW bookings and return inventory." })] }), _jsx(CardContent, { children: _jsxs("div", { className: "flex gap-3", children: [_jsx(Button, { onClick: doExpire, children: "Expire holds now" }), expireResult ? _jsxs("div", { className: "text-sm", children: ["Result: ", JSON.stringify(expireResult)] }) : null] }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Force status / preview refund" }), _jsx(CardDescription, { children: "Force a booking status (dev) or preview refund amount for a booking." })] }), _jsxs(CardContent, { children: [_jsxs("form", { className: "grid gap-3 md:grid-cols-3", onSubmit: doForce, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Booking ID" }), _jsx(Input, { value: forceBookingId, onChange: (e) => setForceBookingId(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Status" }), _jsxs("select", { value: forceStatus, onChange: (e) => setForceStatus(e.target.value), className: "h-9 w-full rounded-md border border-input bg-background px-3 text-sm", children: [_jsx("option", { children: "HOLD" }), _jsx("option", { children: "REVIEW" }), _jsx("option", { children: "CONFIRMED" }), _jsx("option", { children: "PAID" }), _jsx("option", { children: "REFUNDED" }), _jsx("option", { children: "CANCELLED" })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "holdExpiresAt (optional)" }), _jsx(Input, { type: "datetime-local", value: forceHoldExpiresAt, onChange: (e) => setForceHoldExpiresAt(e.target.value) })] }), _jsxs("div", { className: "md:col-span-3", children: [_jsx(Button, { type: "submit", children: "Force status" }), forceResult ? _jsx("pre", { className: "mt-3 whitespace-pre-wrap text-sm", children: JSON.stringify(forceResult, null, 2) }) : null] })] }), _jsx("hr", { className: "my-4" }), _jsxs("form", { className: "grid gap-3 md:grid-cols-3", onSubmit: doPreview, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Booking ID" }), _jsx(Input, { value: previewBookingId, onChange: (e) => setPreviewBookingId(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Cancel at (optional)" }), _jsx(Input, { type: "date", value: previewCancelAt, onChange: (e) => setPreviewCancelAt(e.target.value) })] }), _jsxs("div", { className: "md:col-span-3", children: [_jsx(Button, { type: "submit", children: "Preview refund" }), previewResult ? _jsx("pre", { className: "mt-3 whitespace-pre-wrap text-sm", children: JSON.stringify(previewResult, null, 2) }) : null] })] })] })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Cancel PAID/CONFIRMED" }), _jsx(CardDescription, { children: "Trigger the cancelPaidOrConfirmed flow (mock refund + inventory return)." })] }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-3 md:grid-cols-3", onSubmit: doCancelPaid, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Booking ID" }), _jsx(Input, { value: cancelPaidBookingId, onChange: (e) => setCancelPaidBookingId(e.target.value) })] }), _jsxs("div", { className: "md:col-span-3", children: [_jsx(Button, { type: "submit", children: "Cancel PAID/CONFIRMED" }), cancelPaidResult ? _jsx("pre", { className: "mt-3 whitespace-pre-wrap text-sm", children: JSON.stringify(cancelPaidResult, null, 2) }) : null] })] }) })] }), error ? _jsx("p", { className: "text-sm text-destructive", children: error }) : null] }));
}
