import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
export function RegisterPage() {
    const { register } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        setIsSubmitting(true);
        try {
            await register(email, password);
            navigate('/dashboard', { replace: true });
        }
        catch (err) {
            setError(err.message ?? 'Unable to register');
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-background px-4", children: _jsxs(Card, { className: "w-full max-w-md", children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Create an account" }), _jsx(CardDescription, { children: "Provision a user to start managing bookings and properties." })] }), _jsxs(CardContent, { children: [_jsxs("form", { className: "space-y-4", onSubmit: handleSubmit, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "email", children: "Email" }), _jsx(Input, { id: "email", type: "email", autoComplete: "email", required: true, value: email, onChange: (event) => setEmail(event.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "password", children: "Password" }), _jsx(Input, { id: "password", type: "password", autoComplete: "new-password", required: true, value: password, onChange: (event) => setPassword(event.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "confirmPassword", children: "Confirm password" }), _jsx(Input, { id: "confirmPassword", type: "password", autoComplete: "new-password", required: true, value: confirmPassword, onChange: (event) => setConfirmPassword(event.target.value) })] }), error ? (_jsx("p", { className: "text-sm text-destructive", children: error })) : null, _jsx(Button, { type: "submit", className: "w-full", disabled: isSubmitting, children: isSubmitting ? 'Signing up...' : 'Create account' })] }), _jsxs("p", { className: "mt-4 text-sm text-muted-foreground", children: ["Already have an account?", ' ', _jsx(Link, { className: "text-primary hover:underline", to: "/login", children: "Sign in" })] })] })] }) }));
}
