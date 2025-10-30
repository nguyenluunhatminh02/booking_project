import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
const ToastContext = createContext(undefined);
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const toast = useCallback((t) => {
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const next = { id, ...t };
        setToasts((s) => [...s, next]);
        setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), 4000);
    }, []);
    const value = useMemo(() => ({ toast }), [toast]);
    return (_jsxs(ToastContext.Provider, { value: value, children: [children, _jsx("div", { "aria-live": "polite", className: "fixed right-4 top-4 z-50 flex w-80 flex-col gap-2", children: toasts.map((t) => (_jsxs("div", { role: "status", className: `rounded-md border px-3 py-2 shadow-sm ${t.variant === 'error'
                        ? 'bg-red-600 text-white'
                        : t.variant === 'success'
                            ? 'bg-green-600 text-white'
                            : 'bg-white text-slate-900'}`, children: [_jsx("div", { className: "font-medium", children: t.title }), t.description ? _jsx("div", { className: "text-sm", children: t.description }) : null] }, t.id))) })] }));
}
export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx)
        throw new Error('useToast must be used inside ToastProvider');
    return ctx;
}
