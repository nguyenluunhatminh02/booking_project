import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { api, API_BASE_URL, toApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
export function InvoiceToolsPage() {
    const [bookingId, setBookingId] = useState('');
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    const [isSending, setIsSending] = useState(false);
    const openInvoice = (download) => {
        if (!bookingId) {
            setError('Booking ID is required.');
            return;
        }
        const query = download ? '?download=1' : '';
        const url = `${API_BASE_URL}/v1/invoices/${bookingId}.pdf${query}`;
        window.open(url, '_blank', 'noopener');
        setStatus('Invoice opened in a new tab.');
        setError(null);
    };
    const sendEmail = async () => {
        if (!bookingId) {
            setError('Booking ID is required.');
            return;
        }
        setIsSending(true);
        setStatus(null);
        setError(null);
        try {
            await api.post(`/v1/invoices/${bookingId}/email`);
            setStatus('Invoice email has been queued for delivery.');
        }
        catch (err) {
            setError(toApiError(err).message);
        }
        finally {
            setIsSending(false);
        }
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: "Invoices" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Download booking invoices as PDF documents or trigger customer delivery via email." })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Invoice actions" }), _jsx(CardDescription, { children: "Enter a booking identifier to generate the PDF or send it directly to the guest\u2019s inbox." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsx("div", { className: "space-y-2", children: _jsx(Input, { value: bookingId, onChange: (event) => setBookingId(event.target.value), placeholder: "Booking ID (e.g. bk_123)" }) }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Button, { variant: "outline", onClick: () => openInvoice(false), children: "View PDF" }), _jsx(Button, { variant: "secondary", onClick: () => openInvoice(true), children: "Download PDF" }), _jsx(Button, { onClick: sendEmail, disabled: isSending, children: isSending ? 'Sending…' : 'Email invoice' })] }), status ? (_jsx("p", { className: "text-sm text-emerald-600", children: status })) : null, error ? (_jsx("p", { className: "text-sm text-destructive", children: error })) : null] })] })] }));
}
