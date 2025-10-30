import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
function formatDate(date) {
    return date.toISOString().split('T')[0];
}
function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
}
function enumerateDays(start, end) {
    const out = [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error('Invalid date range');
    }
    if (endDate < startDate) {
        throw new Error('End date must be after start date');
    }
    for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
        out.push(formatDate(cursor));
    }
    return out;
}
export function PropertyDetailPage() {
    const { id } = useParams();
    const queryClient = useQueryClient();
    const [updateError, setUpdateError] = useState(null);
    const [availability, setAvailability] = useState([]);
    const [availabilityStatus, setAvailabilityStatus] = useState('idle');
    const [availabilityError, setAvailabilityError] = useState(null);
    const [availabilityRange, setAvailabilityRange] = useState(() => {
        const today = new Date();
        return {
            from: formatDate(today),
            to: formatDate(addDays(today, 7)),
        };
    });
    const [calendarForm, setCalendarForm] = useState({
        from: '',
        to: '',
        price: '',
        remaining: '',
        isBlocked: false,
    });
    const propertyQuery = useQuery({
        queryKey: ['property', id],
        queryFn: async () => {
            const { data } = await api.get(`/properties/${id}`);
            return data;
        },
        enabled: Boolean(id),
    });
    const property = propertyQuery.data;
    const [formState, setFormState] = useState({
        title: '',
        address: '',
        description: '',
    });
    useEffect(() => {
        if (property) {
            setFormState({
                title: property.title ?? '',
                address: property.address ?? '',
                description: property.description ?? '',
            });
        }
    }, [property]);
    const updateMutation = useMutation({
        mutationFn: async (payload) => {
            const { data } = await api.patch(`/properties/${id}`, payload);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['property', id] });
            setUpdateError(null);
        },
        onError: (error) => {
            setUpdateError(toApiError(error).message);
        },
    });
    const reviewsQuery = useQuery({
        queryKey: ['reviews', id],
        queryFn: async () => {
            const { data } = await api.get(`/reviews?propertyId=${id}&limit=5`);
            return data;
        },
        enabled: Boolean(id),
    });
    const fetchAvailability = useMemo(() => async () => {
        if (!id)
            return;
        setAvailabilityStatus('loading');
        setAvailabilityError(null);
        try {
            const { data } = await api.get(`/properties/${id}/calendar`, {
                params: {
                    from: new Date(availabilityRange.from).toISOString(),
                    to: new Date(addDays(new Date(availabilityRange.to), 1)).toISOString(),
                },
            });
            setAvailability(data);
            setAvailabilityStatus('success');
        }
        catch (error) {
            setAvailabilityStatus('error');
            setAvailabilityError(toApiError(error).message);
        }
    }, [id, availabilityRange.from, availabilityRange.to]);
    useEffect(() => {
        if (id) {
            fetchAvailability();
        }
    }, [id, fetchAvailability]);
    const upsertMutation = useMutation({
        mutationFn: async () => {
            if (!id)
                return;
            const { from, to, price, remaining, isBlocked } = calendarForm;
            if (!from || !to) {
                throw new Error('Please provide a start and end date.');
            }
            const items = enumerateDays(from, to).map((date) => ({
                date,
                price: price ? Number(price) : undefined,
                remaining: remaining ? Number(remaining) : undefined,
                isBlocked,
            }));
            await api.post(`/properties/${id}/calendar`, { items });
        },
        onSuccess: () => {
            setCalendarForm({
                from: '',
                to: '',
                price: '',
                remaining: '',
                isBlocked: false,
            });
            setAvailabilityError(null);
            fetchAvailability();
        },
        onError: (error) => {
            setAvailabilityError(toApiError(error).message);
        },
    });
    const handleUpdate = (event) => {
        event.preventDefault();
        updateMutation.mutate({
            title: formState.title,
            address: formState.address,
            description: formState.description,
        });
    };
    if (propertyQuery.isLoading) {
        return _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading property\u2026" });
    }
    if (!property) {
        return _jsx("p", { className: "text-sm text-destructive", children: "Property not found." });
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: property.title }), _jsx("p", { className: "text-sm text-muted-foreground", children: property.address })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "General information" }), _jsx(CardDescription, { children: "Update the property metadata displayed to guests." })] }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-2", onSubmit: handleUpdate, children: [_jsxs("div", { className: "space-y-2 md:col-span-1", children: [_jsx(Label, { htmlFor: "title", children: "Title" }), _jsx(Input, { id: "title", value: formState.title, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                title: event.target.value,
                                            })) })] }), _jsxs("div", { className: "space-y-2 md:col-span-1", children: [_jsx(Label, { htmlFor: "address", children: "Address" }), _jsx(Input, { id: "address", value: formState.address, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                address: event.target.value,
                                            })) })] }), _jsxs("div", { className: "space-y-2 md:col-span-2", children: [_jsx(Label, { htmlFor: "description", children: "Description" }), _jsx(Textarea, { id: "description", rows: 4, value: formState.description, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                description: event.target.value,
                                            })) })] }), updateError ? (_jsx("p", { className: "md:col-span-2 text-sm text-destructive", children: updateError })) : null, _jsx("div", { className: "md:col-span-2", children: _jsx(Button, { type: "submit", disabled: updateMutation.isPending, children: updateMutation.isPending ? 'Saving…' : 'Save changes' }) })] }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Availability" }), _jsx(CardDescription, { children: "Inspect and adjust pricing, stock, or block dates for this property." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("form", { className: "grid items-end gap-4 md:grid-cols-5", onSubmit: (event) => {
                                    event.preventDefault();
                                    fetchAvailability();
                                }, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "from", children: "From" }), _jsx(Input, { id: "from", type: "date", value: availabilityRange.from, onChange: (event) => setAvailabilityRange((prev) => ({
                                                    ...prev,
                                                    from: event.target.value,
                                                })) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "to", children: "To" }), _jsx(Input, { id: "to", type: "date", value: availabilityRange.to, onChange: (event) => setAvailabilityRange((prev) => ({
                                                    ...prev,
                                                    to: event.target.value,
                                                })) })] }), _jsx(Button, { type: "submit", className: "md:col-span-2", disabled: availabilityStatus === 'loading', children: availabilityStatus === 'loading'
                                            ? 'Loading…'
                                            : 'Refresh availability' })] }), availabilityStatus === 'error' && availabilityError ? (_jsx("p", { className: "text-sm text-destructive", children: availabilityError })) : null, availability.length ? (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full text-left text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b bg-muted/30", children: [_jsx("th", { className: "px-3 py-2 font-medium", children: "Date" }), _jsx("th", { className: "px-3 py-2 font-medium", children: "Price" }), _jsx("th", { className: "px-3 py-2 font-medium", children: "Remaining" }), _jsx("th", { className: "px-3 py-2 font-medium", children: "Blocked" })] }) }), _jsx("tbody", { children: availability.map((day) => (_jsxs("tr", { className: "border-b last:border-none", children: [_jsx("td", { className: "px-3 py-2", children: new Date(day.date).toLocaleDateString() }), _jsx("td", { className: "px-3 py-2", children: day.price.toLocaleString() }), _jsx("td", { className: "px-3 py-2", children: day.remaining }), _jsx("td", { className: "px-3 py-2", children: day.isBlocked ? 'Yes' : 'No' })] }, day.id))) })] }) })) : (_jsx("p", { className: "text-sm text-muted-foreground", children: "No availability records for the selected range." })), _jsxs("form", { className: "grid gap-4 border-t border-border pt-4 md:grid-cols-5", onSubmit: (event) => {
                                    event.preventDefault();
                                    upsertMutation.mutate();
                                }, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "cal-from", children: "From" }), _jsx(Input, { id: "cal-from", type: "date", value: calendarForm.from, onChange: (event) => setCalendarForm((prev) => ({
                                                    ...prev,
                                                    from: event.target.value,
                                                })) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "cal-to", children: "To" }), _jsx(Input, { id: "cal-to", type: "date", value: calendarForm.to, onChange: (event) => setCalendarForm((prev) => ({
                                                    ...prev,
                                                    to: event.target.value,
                                                })) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "cal-price", children: "Price (optional)" }), _jsx(Input, { id: "cal-price", type: "number", min: 0, value: calendarForm.price, onChange: (event) => setCalendarForm((prev) => ({
                                                    ...prev,
                                                    price: event.target.value,
                                                })) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "cal-remaining", children: "Remaining (optional)" }), _jsx(Input, { id: "cal-remaining", type: "number", min: 0, value: calendarForm.remaining, onChange: (event) => setCalendarForm((prev) => ({
                                                    ...prev,
                                                    remaining: event.target.value,
                                                })) })] }), _jsxs("div", { className: "flex flex-col justify-end gap-2", children: [_jsxs("label", { className: "flex items-center gap-2 text-sm", children: [_jsx("input", { type: "checkbox", checked: calendarForm.isBlocked, onChange: (event) => setCalendarForm((prev) => ({
                                                            ...prev,
                                                            isBlocked: event.target.checked,
                                                        })) }), "Block dates"] }), _jsx(Button, { type: "submit", disabled: upsertMutation.isPending, children: upsertMutation.isPending ? 'Updating…' : 'Apply changes' })] })] })] })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Recent reviews" }), _jsx(CardDescription, { children: "Snapshot of the latest guest feedback associated with this listing." })] }), _jsx(CardContent, { children: reviewsQuery.isLoading ? (_jsx("p", { className: "text-sm text-muted-foreground", children: "Loading reviews\u2026" })) : reviewsQuery.data?.items?.length ? (_jsx("ul", { className: "space-y-4", children: reviewsQuery.data.items.map((review) => (_jsxs("li", { className: "rounded-lg border border-border p-4", children: [_jsxs("div", { className: "flex items-center justify-between text-sm", children: [_jsxs("span", { className: "font-medium", children: ["Rating: ", review.rating, "/5"] }), _jsx("span", { className: "text-muted-foreground", children: new Date(review.createdAt).toLocaleString() })] }), review.body ? (_jsx("p", { className: "mt-2 text-sm text-muted-foreground", children: review.body })) : null] }, review.id))) })) : (_jsx("p", { className: "text-sm text-muted-foreground", children: "No reviews yet for this property." })) })] })] }));
}
