import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
export function ReviewManagerPage() {
    const queryClient = useQueryClient();
    const [propertyInput, setPropertyInput] = useState('');
    const [propertyId, setPropertyId] = useState(null);
    const [cursor, setCursor] = useState(undefined);
    const [createBookingId, setCreateBookingId] = useState('');
    const [createRating, setCreateRating] = useState(5);
    const [createBody, setCreateBody] = useState('');
    const [createIdem, setCreateIdem] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        setCursor(undefined);
    }, [propertyId]);
    const reviewsQuery = useQuery({
        queryKey: ['reviews', propertyId, cursor],
        enabled: Boolean(propertyId),
        queryFn: async () => {
            const { data } = await api.get('/reviews', {
                params: {
                    propertyId,
                    cursor,
                    limit: 10,
                },
            });
            return data;
        },
    });
    const items = reviewsQuery.data?.items ?? [];
    const nextCursor = reviewsQuery.data?.nextCursor;
    const hasMore = reviewsQuery.data?.hasMore ?? false;
    const createMutation = useMutation({
        mutationFn: async () => {
            if (!createBookingId) {
                throw new Error('Booking ID is required');
            }
            const payload = {
                bookingId: createBookingId,
                rating: Number(createRating),
                body: createBody.trim() ? createBody : undefined,
            };
            await api.post('/reviews', payload, {
                headers: createIdem
                    ? {
                        'Idempotency-Key': createIdem,
                    }
                    : undefined,
            });
        },
        onSuccess: () => {
            setFeedback('Review submitted successfully.');
            setError(null);
            setCreateBody('');
            setCreateBookingId('');
            setCreateIdem('');
            setCreateRating(5);
            if (propertyId) {
                queryClient.invalidateQueries({ queryKey: ['reviews', propertyId] });
            }
        },
        onError: (err) => {
            setFeedback(null);
            setError(toApiError(err).message);
        },
    });
    const deleteMutation = useMutation({
        mutationFn: async (id) => {
            await api.delete(`/reviews/${id}`);
        },
        onSuccess: () => {
            if (propertyId) {
                queryClient.invalidateQueries({ queryKey: ['reviews', propertyId] });
            }
        },
        onError: (err) => {
            setError(toApiError(err).message);
        },
    });
    const updateMutation = useMutation({
        mutationFn: async ({ id, draft }) => {
            await api.patch(`/reviews/${id}`, {
                rating: draft.rating,
                body: draft.body,
            });
        },
        onSuccess: () => {
            setError(null);
            if (propertyId) {
                queryClient.invalidateQueries({ queryKey: ['reviews', propertyId] });
            }
        },
        onError: (err) => {
            setError(toApiError(err).message);
        },
    });
    const [editingId, setEditingId] = useState(null);
    const [drafts, setDrafts] = useState({});
    const startEdit = (review) => {
        setEditingId(review.id);
        setDrafts((prev) => ({
            ...prev,
            [review.id]: {
                rating: review.rating,
                body: review.body ?? '',
            },
        }));
    };
    const cancelEdit = () => {
        setEditingId(null);
    };
    const submitEdit = (id) => {
        const draft = drafts[id];
        if (!draft)
            return;
        updateMutation.mutate({ id, draft });
        setEditingId(null);
    };
    const handlePropertySearch = (event) => {
        event.preventDefault();
        const trimmed = propertyInput.trim();
        setPropertyId(trimmed || null);
        setCursor(undefined);
    };
    const goToNextPage = () => {
        if (hasMore && nextCursor) {
            setCursor(nextCursor);
        }
    };
    const goBackToStart = () => {
        setCursor(undefined);
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: "Reviews" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Submit new reviews for completed stays, browse existing feedback by property, and manage your own entries." })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Submit a review" }), _jsx(CardDescription, { children: "Provide the booking you completed, rate the stay, and optionally add written feedback." })] }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-2", onSubmit: (event) => {
                                event.preventDefault();
                                createMutation.mutate();
                            }, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "bookingId", children: "Booking ID" }), _jsx(Input, { id: "bookingId", required: true, value: createBookingId, onChange: (event) => setCreateBookingId(event.target.value), placeholder: "bk_123" })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "rating", children: "Rating (1-5)" }), _jsx(Input, { id: "rating", type: "number", min: 1, max: 5, value: createRating, onChange: (event) => setCreateRating(Number(event.target.value)) })] }), _jsxs("div", { className: "space-y-2 md:col-span-2", children: [_jsx(Label, { htmlFor: "body", children: "Comments (optional)" }), _jsx(Textarea, { id: "body", rows: 4, value: createBody, onChange: (event) => setCreateBody(event.target.value), placeholder: "Share your experience with future guests" })] }), _jsxs("div", { className: "space-y-2 md:col-span-2", children: [_jsx(Label, { htmlFor: "idem", children: "Idempotency key (optional)" }), _jsx(Input, { id: "idem", value: createIdem, onChange: (event) => setCreateIdem(event.target.value), placeholder: "Use to safely retry a submission" })] }), feedback ? (_jsx("p", { className: "md:col-span-2 text-sm text-emerald-600", children: feedback })) : null, error ? (_jsx("p", { className: "md:col-span-2 text-sm text-destructive", children: error })) : null, _jsx("div", { className: "md:col-span-2", children: _jsx(Button, { type: "submit", disabled: createMutation.isPending, children: createMutation.isPending ? 'Submitting…' : 'Submit review' }) })] }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Browse reviews by property" }), _jsx(CardDescription, { children: "Enter a property ID to load the latest reviews. Only active reviews are returned." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("form", { className: "flex flex-col gap-3 md:flex-row", onSubmit: handlePropertySearch, children: [_jsxs("div", { className: "flex-1 space-y-2", children: [_jsx(Label, { htmlFor: "propertySearch", children: "Property ID" }), _jsx(Input, { id: "propertySearch", value: propertyInput, onChange: (event) => setPropertyInput(event.target.value), placeholder: "prop_123" })] }), _jsx("div", { className: "flex items-end", children: _jsx(Button, { type: "submit", variant: "secondary", children: "Load reviews" }) })] }), propertyId ? (_jsx("div", { className: "space-y-4", children: reviewsQuery.isLoading ? (_jsx("p", { className: "text-sm text-muted-foreground", children: "Loading reviews\u2026" })) : items.length ? (_jsxs("div", { className: "space-y-3", children: [items.map((review) => {
                                            const isEditing = editingId === review.id;
                                            const draft = drafts[review.id];
                                            return (_jsxs("div", { className: "rounded-lg border border-border p-4", children: [_jsxs("div", { className: "flex flex-wrap items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-sm text-muted-foreground", children: ["Review ID: ", _jsx("span", { className: "font-mono", children: review.id })] }), _jsxs("p", { className: "text-xs text-muted-foreground", children: ["Created ", new Date(review.createdAt).toLocaleString()] }), review.author ? (_jsxs("p", { className: "text-xs text-muted-foreground", children: ["Author: ", _jsx("span", { className: "font-mono", children: review.author.id })] })) : null] }), _jsx("div", { className: "flex gap-2", children: isEditing ? (_jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => submitEdit(review.id), disabled: updateMutation.isPending, children: "Save" }), _jsx(Button, { size: "sm", variant: "ghost", onClick: cancelEdit, children: "Cancel" })] })) : (_jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => startEdit(review), children: "Edit" }), _jsx(Button, { size: "sm", variant: "destructive", onClick: () => deleteMutation.mutate(review.id), children: "Delete" })] })) })] }), isEditing ? (_jsxs("div", { className: "mt-4 space-y-3", children: [_jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: `rating-${review.id}`, children: "Rating" }), _jsx(Input, { id: `rating-${review.id}`, type: "number", min: 1, max: 5, value: draft?.rating ?? review.rating, onChange: (event) => setDrafts((prev) => ({
                                                                            ...prev,
                                                                            [review.id]: {
                                                                                rating: Number(event.target.value),
                                                                                body: prev[review.id]?.body ?? review.body ?? '',
                                                                            },
                                                                        })) })] }), _jsxs("div", { className: "space-y-1", children: [_jsx(Label, { htmlFor: `body-${review.id}`, children: "Comment" }), _jsx(Textarea, { id: `body-${review.id}`, rows: 4, value: draft?.body ?? review.body ?? '', onChange: (event) => setDrafts((prev) => ({
                                                                            ...prev,
                                                                            [review.id]: {
                                                                                rating: prev[review.id]?.rating ?? review.rating,
                                                                                body: event.target.value,
                                                                            },
                                                                        })) })] })] })) : (_jsxs("div", { className: "mt-3 space-y-1 text-sm", children: [_jsxs("p", { children: ["Rating: ", _jsxs("span", { className: "font-semibold", children: [review.rating, "/5"] })] }), review.body ? (_jsx("p", { className: "text-muted-foreground", children: review.body })) : (_jsx("p", { className: "text-muted-foreground italic", children: "No comment provided." }))] }))] }, review.id));
                                        }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx(Button, { variant: "ghost", onClick: goBackToStart, disabled: !cursor || reviewsQuery.isFetching, children: "Back to first page" }), _jsx(Button, { variant: "secondary", onClick: goToNextPage, disabled: !hasMore || !nextCursor || reviewsQuery.isFetching, children: "Load more" })] })] })) : (_jsx("p", { className: "text-sm text-muted-foreground", children: "No reviews found for this property." })) })) : (_jsx("p", { className: "text-sm text-muted-foreground", children: "Enter a property ID to inspect reviews." }))] })] })] }));
}
