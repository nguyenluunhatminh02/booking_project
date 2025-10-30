import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
export function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const state = location.state;
    const redirectPath = state?.from?.pathname ?? '/dashboard';
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        setIsSubmitting(true);
        try {
            await login(email, password);
            navigate(redirectPath, { replace: true });
        }
        catch (err) {
            setError(err.message ?? 'Unable to login');
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-background px-4", children: _jsxs(Card, { className: "w-full max-w-md", children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Sign in" }), _jsx(CardDescription, { children: "Access the booking control center with your account." })] }), _jsxs(CardContent, { children: [_jsxs("form", { className: "space-y-4", onSubmit: handleSubmit, children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "email", children: "Email" }), _jsx(Input, { id: "email", type: "email", autoComplete: "email", required: true, value: email, onChange: (event) => setEmail(event.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "password", children: "Password" }), _jsx(Input, { id: "password", type: "password", autoComplete: "current-password", required: true, value: password, onChange: (event) => setPassword(event.target.value) })] }), error ? (_jsx("p", { className: "text-sm text-destructive", children: error })) : null, _jsx(Button, { type: "submit", className: "w-full", disabled: isSubmitting, children: isSubmitting ? 'Signing in...' : 'Sign in' })] }), _jsxs("p", { className: "mt-4 text-sm text-muted-foreground", children: ["Need an account?", ' ', _jsx(Link, { className: "text-primary hover:underline", to: "/register", children: "Register" })] })] })] }) }));
}
