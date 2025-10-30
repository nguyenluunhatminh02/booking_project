import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
const propertiesKey = ['properties'];
export function PropertiesListPage() {
    const queryClient = useQueryClient();
    const [formError, setFormError] = useState(null);
    const [formState, setFormState] = useState({
        title: '',
        address: '',
        description: '',
    });
    const propertiesQuery = useQuery({
        queryKey: propertiesKey,
        queryFn: async () => {
            const { data } = await api.get('/properties');
            return data;
        },
    });
    const createMutation = useMutation({
        mutationFn: async ({ title, address, description, }) => {
            const { data } = await api.post('/properties', {
                title,
                address,
                description: description?.trim() ? description : undefined,
            });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: propertiesKey });
            setFormState({ title: '', address: '', description: '' });
            setFormError(null);
        },
        onError: (error) => {
            const apiError = toApiError(error);
            setFormError(apiError.message);
        },
    });
    const handleSubmit = (event) => {
        event.preventDefault();
        createMutation.mutate(formState);
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold", children: "Properties" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Manage inventory and availability for each property connected to your account." })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Add property" }), _jsx(CardDescription, { children: "Provide a title and address. You can enrich data later in the detail view." })] }), _jsx(CardContent, { children: _jsxs("form", { className: "grid gap-4 md:grid-cols-2", onSubmit: handleSubmit, children: [_jsxs("div", { className: "space-y-2 md:col-span-1", children: [_jsx(Label, { htmlFor: "title", children: "Title" }), _jsx(Input, { id: "title", required: true, value: formState.title, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                title: event.target.value,
                                            })) })] }), _jsxs("div", { className: "space-y-2 md:col-span-1", children: [_jsx(Label, { htmlFor: "address", children: "Address" }), _jsx(Input, { id: "address", required: true, value: formState.address, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                address: event.target.value,
                                            })) })] }), _jsxs("div", { className: "space-y-2 md:col-span-2", children: [_jsx(Label, { htmlFor: "description", children: "Description" }), _jsx(Textarea, { id: "description", rows: 4, value: formState.description, onChange: (event) => setFormState((prev) => ({
                                                ...prev,
                                                description: event.target.value,
                                            })) })] }), formError ? (_jsx("p", { className: "md:col-span-2 text-sm text-destructive", children: formError })) : null, _jsx("div", { className: "md:col-span-2", children: _jsx(Button, { type: "submit", disabled: createMutation.isPending, children: createMutation.isPending ? 'Saving...' : 'Create property' }) })] }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Property list" }), _jsxs(CardDescription, { children: [propertiesQuery.data?.total ?? 0, " records found."] })] }), _jsx(CardContent, { children: propertiesQuery.isLoading ? (_jsx("p", { className: "text-sm text-muted-foreground", children: "Loading..." })) : propertiesQuery.data?.items.length ? (_jsx("div", { className: "grid gap-4 md:grid-cols-2", children: propertiesQuery.data.items.map((property) => (_jsxs("div", { className: "rounded-lg border border-border p-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-base font-semibold", children: property.title }), _jsx("p", { className: "text-sm text-muted-foreground", children: property.address })] }), _jsx(Link, { className: "text-sm text-primary hover:underline", to: `/properties/${property.id}`, children: "View" })] }), _jsxs("p", { className: "mt-2 text-xs text-muted-foreground", children: ["Created at", ' ', new Date(property.createdAt).toLocaleString(undefined, {
                                                dateStyle: 'medium',
                                                timeStyle: 'short',
                                            })] })] }, property.id))) })) : (_jsx("p", { className: "text-sm text-muted-foreground", children: "No properties yet. Use the form above to create one." })) })] })] }));
}
